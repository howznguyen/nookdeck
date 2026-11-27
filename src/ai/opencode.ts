import { userHome } from "../home";
import { platform } from "../platform";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import { runCapture } from "../actions";
import { t } from "../i18n";
import { clampPercent, safeHome, windowLabel, type AiSession, type ProviderQuota, type QuotaWindow } from "./types";
import { projectName, sessionState, MAX_SESSIONS } from "./sessions";

/*
 * OpenCode (anomalyco/opencode). Read-only, from the tool's own local data and service:
 *  - sessions: the SQLite database, opened read-only;
 *  - running state + quota (2.x): the local service described by service.json, Basic auth, never any other endpoint;
 *  - permissions / questions: an opt-in plugin file that Nookdeck installs and removes (marked).
 */

const env = (k: string) => process.env[k];

/** ~/.local/share/opencode (XDG_DATA_HOME honoured; the same layout under %USERPROFILE% on Windows). */
export function opencodeDataDir(): string {
  return join(env("XDG_DATA_HOME") || join(safeHome() || userHome(), ".local", "share"), "opencode");
}
export function opencodeStateDir(): string {
  return join(env("XDG_STATE_HOME") || join(safeHome() || userHome(), ".local", "state"), "opencode");
}
export function opencodeConfigDir(): string {
  return env("NOOKDECK_OPENCODE_CONFIG_DIR") || join(env("XDG_CONFIG_HOME") || join(safeHome() || userHome(), ".config"), "opencode");
}

/** OPENCODE_DB (absolute, or relative to the data dir; ":memory:" is ignored) else opencode.db / opencode-<channel>.db. */
export function opencodeDbPath(): string {
  const o = env("OPENCODE_DB");
  if (o && o !== ":memory:") return isAbsolute(o) ? o : join(opencodeDataDir(), o);
  const channel = (env("OPENCODE_CHANNEL") ?? "").replace(/[^\w.-]/g, "");
  return join(opencodeDataDir(), channel && !["latest", "beta", "prod"].includes(channel) ? `opencode-${channel}.db` : "opencode.db");
}

export const serviceJsonPath = () => env("NOOKDECK_OPENCODE_SERVICE") || join(opencodeStateDir(), "service.json");
export const pluginPath = () => join(opencodeConfigDir(), "plugins", "nookdeck.js");
/** The file 0.1.x wrote. Found by its marker, never by name alone; removed once the new one is written, or both would fire. */
export const legacyPluginPath = (file = pluginPath()) => join(dirname(file), "phonedesk.js");
const LEGACY_PLUGIN_MARKER = "phonedesk-plugin";
async function removeLegacyPlugin(file: string): Promise<boolean> {
  const old = legacyPluginPath(file);
  const text = await readFile(old, "utf8").catch(() => null);
  if (text === null || !text.includes(LEGACY_PLUGIN_MARKER)) return false;
  await rm(old, { force: true });
  return true;
}

// ---------- version ----------

export interface OpencodeVersion { version: string; major: 1 | 2 }

export function parseOpencodeVersion(out: string): OpencodeVersion | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(out);
  if (!m) return null;
  return { version: m[0], major: Number(m[1]) >= 2 ? 2 : 1 };
}

/** Sessions of the last 7 days are listed (OpenCode and Grok keep long histories; Claude/Codex use 24 h). */
export const SESSION_WINDOW_MS = 7 * 24 * 3600_000;

/**
 * The opencode binary: NOOKDECK_OPENCODE (authoritative, for tests), PATH, then the places its installers use. The agent often
 * runs as a service or background process whose PATH lacks ~/.opencode/bin, so PATH alone misses a working install.
 */
export function opencodePath(): string | null {
  const forced = process.env.NOOKDECK_OPENCODE;
  if (forced) return existsSync(forced) ? forced : null;
  const onPath = Bun.which("opencode", { PATH: process.env.PATH ?? "" });
  if (onPath) return onPath;
  const home = safeHome() || userHome();
  const exe = platform.id === "win32" ? [".exe", ".cmd"] : [""];
  const dirs = [
    join(home, ".opencode", "bin"), join(home, ".local", "bin"), join(home, ".bun", "bin"), join(home, ".npm-global", "bin"), join(home, ".volta", "bin"),
    "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/home/linuxbrew/.linuxbrew/bin",
    ...(platform.id === "win32" ? [join(env("APPDATA") ?? join(home, "AppData", "Roaming"), "npm"), join(env("LOCALAPPDATA") ?? join(home, "AppData", "Local"), "Programs", "opencode")] : []),
  ];
  for (const d of dirs) for (const e of exe) { const f = join(d, `opencode${e}`); if (existsSync(f)) return f; }
  return null;
}

/** Evidence of an install without a runnable binary: its database or data directory. */
export const opencodeDataFound = (): boolean => existsSync(opencodeDbPath()) || existsSync(opencodeDataDir());

export async function detectOpencode(run: (argv: string[], ms: number) => Promise<string> = (a, ms) => runCapture(a, ms), bin = opencodePath()): Promise<OpencodeVersion | null> {
  if (!bin) return null;
  try { return parseOpencodeVersion(await run([bin, "--version"], 8000)); } catch { return null; }
}

// ---------- sessions (SQLite, read-only) ----------

interface Row { id: string; parent_id?: string | null; directory?: string | null; title?: string | null; model?: unknown; cost?: number | null; time_updated?: number | null; time_archived?: number | null; [k: string]: unknown }

/** "provider/model" from whatever the model column holds (text, or JSON {providerID, modelID|id}). */
export function modelName(m: unknown): string | undefined {
  if (typeof m !== "string" || !m) return undefined;
  if (m.startsWith("{")) {
    try { const o = JSON.parse(m); const id = o.modelID ?? o.id ?? o.model; return typeof id === "string" ? id : undefined; } catch { return undefined; }
  }
  return m;
}

/** Newest top-level sessions touched in the last 24 h. Returns [] when the database is missing or unreadable. */
export function readOpencodeSessions(file = opencodeDbPath(), now = Date.now(), limit = MAX_SESSIONS, windowMs = SESSION_WINDOW_MS): AiSession[] {
  if (!existsSync(file)) return [];
  let db: Database | undefined;
  try {
    db = new Database(file, { readonly: true });
    // 2.x writes new sessions to session_v2; session is the 1.x table: read both, newest first
    const rows: Row[] = [];
    for (const table of ["session_v2", "session"]) {
      const cols = new Set((db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
      if (!cols.has("id")) continue;
      const tok = [...cols].filter((c) => /^tokens_(input|output|reasoning)$/.test(c));
      const q = `SELECT ${["id", "parent_id", "directory", "title", "model", "cost", "time_updated", "time_archived"].filter((c) => cols.has(c)).join(", ")}${tok.length ? ", " + tok.map((c) => `COALESCE(${c}, 0)`).join(" + ") + " AS tokens_total" : ""} FROM ${table} ${cols.has("time_updated") ? "ORDER BY time_updated DESC" : ""} LIMIT 200`;
      rows.push(...(db.query(q).all() as Row[]));
    }
    rows.sort((a, b) => Number(b.time_updated ?? 0) - Number(a.time_updated ?? 0));
    const out: AiSession[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const id = String(r.id);
      if (seen.has(id)) continue; // an id in both tables: its newest copy decides, even when that copy is archived or a sub-agent
      seen.add(id);
      if (r.parent_id || r.time_archived) continue; // sub-agent sessions and archived ones stay out
      const at = Number(r.time_updated ?? 0);
      if (!at || now - at >= windowMs) continue;
      const model = modelName(r.model);
      const tokens = Number(r.tokens_total ?? 0);
      out.push({
        id: String(r.id), tool: "opencode",
        project: r.directory ? projectName(String(r.directory)) : "opencode",
        ...(r.title ? { title: String(r.title).slice(0, 80) } : {}),
        ...(model ? { model } : {}),
        state: sessionState(at, now, false),
        updatedAt: at,
        ...(tokens > 0 ? { tokens } : {}),
        ...(typeof r.cost === "number" && r.cost > 0 ? { cost: Math.round(r.cost * 1000) / 1000 } : {}),
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  } finally {
    try { db?.close(); } catch { /* closed */ }
  }
}

// ---------- the 2.x local service ----------

export interface Service { url: string; password?: string }

export async function readService(file = serviceJsonPath()): Promise<Service | null> {
  try {
    const o = JSON.parse(await readFile(file, "utf8"));
    const url = typeof o?.url === "string" ? o.url : typeof o?.baseUrl === "string" ? o.baseUrl : "";
    // only the machine itself: the service.json of someone else's machine on a shared home is not ours to call
    if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(url)) return null;
    return { url: url.replace(/\/+$/, ""), ...(typeof o.password === "string" ? { password: o.password } : {}) };
  } catch { return null; }
}

async function serviceGet(s: Service, path: string, f: typeof fetch = fetch, ms = 4000): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await f(`${s.url}${path}`, { headers: { ...(s.password ? { authorization: "Basic " + Buffer.from(`opencode:${s.password}`).toString("base64") } : {}), accept: "application/json" }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

/** Ids of the sessions the service says are running right now (the answer is an array, or {sessions|items|data: [...]}). */
export function parseActive(j: any): string[] {
  const list = Array.isArray(j) ? j : Array.isArray(j?.sessions) ? j.sessions : Array.isArray(j?.items) ? j.items : Array.isArray(j?.data) ? j.data : [];
  return list.map((x: any) => (typeof x === "string" ? x : x?.id ?? x?.sessionID ?? x?.sessionId)).filter((x: unknown): x is string => typeof x === "string");
}

export async function activeOpencodeSessions(f: typeof fetch = fetch, svc?: Service | null): Promise<string[]> {
  const s = svc === undefined ? await readService() : svc;
  if (!s) return [];
  try { return parseActive(await serviceGet(s, "/api/session/active", f)); } catch { return []; }
}

const LIMIT_WINDOWS: Record<string, { label: string; minutes: number }> = {
  rolling: { label: "5 hours", minutes: 300 }, weekly: { label: "7 days", minutes: 10080 }, monthly: { label: "30 days", minutes: 43200 },
};

/**
 * `GET /api/experimental/usage/limits`: {rolling|weekly|monthly: {status, percent, resetsAt}} (or the same as an array with a name/window).
 * 2.4 wraps it: {location, data: {workspace, go: {rolling, weekly, monthly}, budgets}}; without a Go plan `go` is missing or null.
 */
export function parseLimits(j: any): QuotaWindow[] {
  const src = j?.data?.go ?? j?.limits ?? j;
  const entries: [string, any][] = Array.isArray(src) ? src.map((x: any) => [String(x?.window ?? x?.name ?? x?.id ?? ""), x]) : Object.entries(src ?? {});
  const out: QuotaWindow[] = [];
  for (const [key, w] of entries) {
    const k = key.toLowerCase();
    const def = LIMIT_WINDOWS[k] ?? (/roll|5/.test(k) ? LIMIT_WINDOWS.rolling : /week/.test(k) ? LIMIT_WINDOWS.weekly : /month/.test(k) ? LIMIT_WINDOWS.monthly : undefined);
    if (!def || !w || typeof w !== "object") continue;
    const pct = typeof w.percent === "number" ? w.percent : typeof w.usedPercent === "number" ? w.usedPercent : undefined;
    if (pct === undefined) continue;
    const reset = typeof w.resetsAt === "number" ? (w.resetsAt < 1e12 ? w.resetsAt * 1000 : w.resetsAt) : Date.parse(String(w.resetsAt ?? ""));
    out.push({
      id: LIMIT_WINDOWS[k] ? k : Object.keys(LIMIT_WINDOWS).find((n) => LIMIT_WINDOWS[n] === def)!,
      label: windowLabel(def.minutes),
      usedPercent: clampPercent(pct),
      ...(Number.isFinite(reset) ? { resetsAt: reset } : {}),
      windowMinutes: def.minutes,
    });
  }
  return out;
}

/** 2.x with OpenCode Go: the quota windows. 1.x (or no service): no windows and the reason. */
export async function fetchOpencodeQuota(o: { fetch?: typeof fetch; service?: Service | null; version?: OpencodeVersion | null; now?: number } = {}): Promise<ProviderQuota> {
  const now = o.now ?? Date.now();
  const base = { id: "opencode" as const, name: "OpenCode", updatedAt: now };
  const svc = o.service === undefined ? await readService() : o.service;
  if (!svc) return { ...base, windows: [], error: o.version && o.version.major < 2 ? t("OpenCode 1.x has no usage limits (cost and tokens are shown per session)") : t("OpenCode's local service is not running (usage limits need OpenCode 2.x with OpenCode Go)") };
  try {
    const windows = parseLimits(await serviceGet(svc, "/api/experimental/usage/limits", o.fetch));
    return windows.length ? { ...base, windows } : { ...base, windows: [], error: t("No usage limits (they exist for OpenCode Go)") };
  } catch (e: any) {
    return { ...base, windows: [], error: t("Could not read OpenCode's usage limits: {m}", { m: String(e?.message ?? e).slice(0, 80) }) };
  }
}

// ---------- the opt-in plugin ----------

export const PLUGIN_MARKER = "// nookdeck-plugin v1 (installed by Nookdeck; remove it from the management page)";

export interface PluginParams { port: number; home: string; major: 1 | 2 }

/**
 * The plugin forwards permission and question requests to the Nookdeck agent (localhost only, the hook secret is read
 * from the Nookdeck home at the time of the request) and answers OpenCode with what the phone chose. It never blocks:
 * every request has a timeout, and on no answer (no phone, timeout, agent down) the plugin does nothing so the terminal asks.
 */
export function pluginSource(p: PluginParams): string {
  const head = `${PLUGIN_MARKER}
const PORT = ${JSON.stringify(p.port)};
const HOME = ${JSON.stringify(p.home)};
const fs = require("node:fs");
const path = require("node:path");

function secret() { try { return fs.readFileSync(path.join(HOME, "hook-secret"), "utf8").trim(); } catch { return ""; } }

// POST to the agent; null on any problem (the terminal then asks as usual)
async function agent(route, body, ms) {
  const s = secret();
  if (!s) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch("http://127.0.0.1:" + PORT + route, { method: "POST", headers: { "content-type": "application/json", "x-nookdeck-hook": s }, body: JSON.stringify(body), signal: ctl.signal });
    return res.ok ? await res.json() : null;
  } catch { return null; } finally { clearTimeout(timer); }
}
`;
  if (p.major === 1) return head + `
// OpenCode 1.x: events permission.asked / question.asked; replies go to the server the plugin runs against
module.exports = async function Nookdeck(ctx) {
  const base = String(ctx.serverUrl || "").replace(/\\/$/, "");
  const reply = (route, body) => fetch(base + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
  const state = (sessionId, s) => agent("/api/hooks/state", { source: "opencode", sessionId, cwd: ctx.directory, state: s }, 3000);
  return {
    event: async ({ event }) => {
      const p = event && event.properties ? event.properties : {};
      if (event.type === "permission.asked") {
        const r = await agent("/api/hooks/permission", { source: "opencode", sessionId: p.sessionID, cwd: ctx.directory, toolName: String(p.permission || "permission"), toolInput: { command: Array.isArray(p.patterns) ? p.patterns.join(" ") : undefined, path: p.metadata && p.metadata.filepath } }, 58000);
        if (r && (r.decision === "allow" || r.decision === "deny")) await reply("/permission/" + p.id + "/reply", { reply: r.decision === "allow" ? "once" : "reject" });
      } else if (event.type === "question.asked") {
        const qs = Array.isArray(p.questions) ? p.questions : [];
        const r = await agent("/api/hooks/question", { source: "opencode", sessionId: p.sessionID, cwd: ctx.directory, questions: qs.map((q) => ({ question: q.question, header: q.header, multiSelect: !!q.multiple, options: (q.options || []).map((o) => ({ label: o.label, description: o.description })) })) }, 590000);
        if (r && r.answers) await reply("/question/" + p.id + "/reply", { answers: qs.map((q) => { const a = r.answers[q.question]; return typeof a === "string" && a ? a.split(", ") : []; }) });
      } else if (event.type === "session.status" && p.status && p.status.type === "busy") await state(p.sessionID, "busy");
      else if (event.type === "session.idle") await state(p.sessionID, "idle");
    },
  };
};
`;
  return head + `
// OpenCode 2.x: permission evaluate hook and form.created; form answers go to the local service
module.exports = async function Nookdeck(ctx) {
  return {
    permission: { hook: ["evaluate", async (req) => {
      const r = await agent("/api/hooks/permission", { source: "opencode", sessionId: req.sessionID, cwd: ctx.directory, toolName: String(req.permission || req.tool || "permission"), toolInput: { command: Array.isArray(req.patterns) ? req.patterns.join(" ") : undefined } }, 58000);
      if (r && r.decision === "allow") return { action: "allow" };
      if (r && r.decision === "deny") return { action: "deny" };
      return undefined; // no answer: OpenCode asks in the terminal
    }] },
    event: async ({ event }) => {
      const p = event && event.properties ? event.properties : {};
      if (event.type !== "form.created") return;
      const qs = Array.isArray(p.questions) ? p.questions : [];
      const r = await agent("/api/hooks/question", { source: "opencode", sessionId: p.sessionID, cwd: ctx.directory, questions: qs.map((q) => ({ question: q.question, header: q.header, multiSelect: !!q.multiple, options: (q.options || []).map((o) => ({ label: o.label, description: o.description })) })) }, 590000);
      if (!r || !r.answers) return;
      const svc = ctx.service || {};
      await fetch(String(svc.url || ctx.serverUrl || "").replace(/\\/$/, "") + "/api/session/" + p.sessionID + "/form/" + p.formID + "/reply", { method: "POST", headers: Object.assign({ "content-type": "application/json" }, svc.password ? { authorization: "Basic " + Buffer.from("opencode:" + svc.password).toString("base64") } : {}), body: JSON.stringify({ answer: r.answers }) }).catch(() => {});
    },
  };
};
`;
}

export async function isPluginInstalled(file = pluginPath()): Promise<boolean> {
  try { return (await readFile(file, "utf8")).includes("nookdeck-plugin"); } catch { return (await readFile(legacyPluginPath(file), "utf8").catch(() => "")).includes(LEGACY_PLUGIN_MARKER); }
}

/** Writes (or refreshes) the plugin. Refuses to overwrite a file we did not write. */
export async function installPlugin(p: PluginParams, file = pluginPath()): Promise<{ changed: boolean }> {
  let current: string | null = null;
  try { current = await readFile(file, "utf8"); } catch { /* new */ }
  if (current !== null && !current.includes("nookdeck-plugin")) throw new Error(`${file} exists and was not written by Nookdeck; refusing to overwrite it`);
  const src = pluginSource(p);
  if (current === src) return { changed: await removeLegacyPlugin(file) };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, src);
  await chmod(file, 0o644).catch(() => {});
  await removeLegacyPlugin(file);
  return { changed: true };
}

export async function uninstallPlugin(file = pluginPath()): Promise<{ changed: boolean }> {
  let current: string;
  try { current = await readFile(file, "utf8"); } catch { return { changed: await removeLegacyPlugin(file) }; }
  if (!current.includes("nookdeck-plugin")) return { changed: await removeLegacyPlugin(file) }; // not ours
  await rm(file, { force: true });
  await removeLegacyPlugin(file);
  return { changed: true };
}
