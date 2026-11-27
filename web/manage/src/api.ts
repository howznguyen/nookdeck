import type { ScreenshotTool } from "@shared/screenshot";
import { t } from "./lib/i18n";
import { asPlatform, type Platform } from "./lib/platform";
import { AI_PROVIDERS, type IconCatalog, type MacApp, type Sound, type HassConfig, type HassEntity, type HassService, type GeoPlace, type WebhookInfo, type AiProvider, type DeviceInfo, type About, type UpdateInfo, type DoctorItem, type DoctorStatus, type Integration, type AiAccounts, type AiAccountTool, type Layout, type Pairing, type PluginInfo, type RegistryEntry, type RegistryManifest, type RegistryResult, type PluginProcess, type PluginProcessState, type PluginField, type PluginPermissions, type Theme, type HassStatus, type ThemeLook, type ThemePack, type ThemeVariantInfo, type ThemeOptionInfo, type ThemeOptionValue, type ThemeSource, type ThemesResult } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const PLUGINS_CHANGED = "nookdeck:plugins-changed";

/** GET /api/screenshot-tools: the tools this computer offers, the known apps installed, and the automatic choice. */
export interface ScreenshotTools { os: string; tools: ScreenshotTool[]; installed: ScreenshotTool[]; auto: ScreenshotTool }

/** GET /api/android: USB setup of Android phones (adb). */
export interface UsbPhone { serial: string; state: string; model?: string; android?: string; app?: string; appCode?: number; appOld?: boolean; setUp: boolean; linked: boolean }
export interface UsbStatus { adb: { path: string; source: "path" | "nookdeck" } | null; phones: UsbPhone[]; error?: string; busy?: string }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  // Every mutating call carries X-Nookdeck (the agent refuses cross-site requests without it) and, unless it uploads a file, a JSON content type.
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const headers = new Headers(init?.headers);
    headers.set("X-Nookdeck", "1");
    if (!headers.has("content-type") && !(init?.body instanceof Blob)) headers.set("Content-Type", "application/json");
    init = { ...init, headers };
  }
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(t("Cannot reach the Nookdeck agent"), 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const msg = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `${res.status} ${res.statusText}`;
    throw new ApiError(msg, res.status);
  }
  // One shared signal: every view of the plugin list (sidebar, pages) reads again after any plugin change.
  if (method !== "GET" && method !== "HEAD" && path.startsWith("/api/plugins")) window.dispatchEvent(new Event(PLUGINS_CHANGED));
  return data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const NAMES: Record<AiProvider, string> = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity", opencode: "OpenCode", grok: "Grok" };
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/**
 * The agent returns an object keyed by provider id ({claude:{installed, settingsPath, cli, quota:{ok, error?, windows, plan, updatedAt}}, ...}).
 * Older/alternative shapes are still read tolerantly: an array or {integrations|providers: [...]},
 * status as "ok"/"error" or via ok/error/quota fields, hook as {supported, installed|enabled, settingsPath|path}.
 */
const isoOf = (v: unknown): string | undefined =>
  typeof v === "number" && Number.isFinite(v) ? new Date(v < 1e12 ? v * 1000 : v).toISOString() : typeof v === "string" ? v : undefined;

/** OpenCode installs a plugin, the others a hook. */
const hookUrl = (id: AiProvider) => `/api/integrations/${id}/${id === "opencode" ? "plugin" : "hook"}`;

export function normalizeIntegrations(raw: unknown): Integration[] {
  const r0 = rec(raw);
  const list = Array.isArray(raw)
    ? raw
    : r0.integrations ?? r0.providers ?? Object.entries(r0).map(([id, v]) => ({ id, ...rec(v) }));
  const out: Integration[] = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const e = rec(entry);
    const id = str(e.id) as AiProvider | undefined;
    if (!id || !AI_PROVIDERS.includes(id)) continue;
    const quota = rec(e.quota);
    const error = str(e.error) ?? str(quota.error);
    const st = str(e.status) ?? str(quota.status);
    const okFlag = typeof e.ok === "boolean" ? e.ok : typeof quota.ok === "boolean" ? quota.ok : undefined;
    const status: Integration["status"] = error || st === "error" || okFlag === false ? "error" : st === "ok" || okFlag === true || (Array.isArray(e.windows) && e.windows.length > 0) ? "ok" : "unknown";
    // OpenCode reports its plugin under "plugin", Grok its hooks file under "hook"; both are installed/path pairs.
    const hookRaw = id === "opencode" ? e.plugin : e.hook;
    const h = hookRaw === undefined || hookRaw === null ? undefined : rec(hookRaw);
    const settingsPath = str(h?.settingsPath) ?? str(h?.path) ?? str(e.settingsPath);
    const hook = h || settingsPath || e.hookSupported !== undefined
      ? {
          supported: typeof h?.supported === "boolean" ? h.supported : e.hookSupported !== false,
          enabled: !!(h?.installed ?? h?.enabled ?? e.hookInstalled ?? e.hookEnabled ?? e.installed),
          settingsPath,
        }
      : undefined;
    const rawWindows = Array.isArray(e.windows) ? e.windows : Array.isArray(quota.windows) ? quota.windows : [];
    const windows = rawWindows.flatMap((w: unknown, i: number) => {
      const r = rec(w);
      const used = Number(r.usedPercent);
      if (!Number.isFinite(used)) return [];
      const resets = r.resetsAt;
      return [{
        id: str(r.id) ?? String(i),
        label: str(r.label) ?? str(r.id) ?? t("Window {n}", { n: i + 1 }),
        usedPercent: Math.min(100, Math.max(0, used)),
        resetsAt: typeof resets === "number" ? new Date(resets < 1e12 ? resets * 1000 : resets).toISOString() : str(resets),
      }];
    });
    const ah = e.askHook === undefined || e.askHook === null ? undefined : rec(e.askHook);
    const askHook = ah ? { enabled: !!(ah.installed ?? ah.enabled), idleOnly: !!ah.idleOnly } : undefined;
    const srcRaw = e.source ?? quota.source;
    const source = typeof srcRaw === "string" && srcRaw ? (srcRaw as Integration["source"]) : undefined;
    const reason = str(e.reason) ?? str(quota.reason) ?? str(e.sourceNote);
    out.push({ windows, source, id, name: str(e.name) ?? NAMES[id], status, error, plan: str(e.plan) ?? str(quota.plan), updatedAt: isoOf(e.updatedAt) ?? isoOf(quota.updatedAt), hook, ...(reason ? { reason } : {}), ...(id === "opencode" || id === "grok" ? { cliInstalled: e.installed === true, version: str(e.version), line: typeof e.line === "number" ? e.line : undefined, sessions: typeof e.sessions === "number" ? e.sessions : undefined, quotaReason: str(e.quotaReason) } : {}), ...(askHook ? { askHook } : {}) });
  }
  return out;
}

const PLUGIN_FIELD_TYPES = ["string", "number", "boolean", "select", "secret", "entity"];
function normalizeFields(raw: unknown, saved: Record<string, unknown> = {}): PluginField[] {
  return (Array.isArray(raw) ? raw : []).flatMap((x: unknown) => {
    const r = rec(x);
    const key = str(r.key);
    const type = str(r.type);
    if (!key || !type || !PLUGIN_FIELD_TYPES.includes(type)) return [];
    const d = r.default;
    const options = (Array.isArray(r.options) ? r.options : []).flatMap((o: unknown) => {
      if (typeof o === "string") return [{ value: o, label: o }];
      const ro = rec(o);
      const value = str(ro.value);
      return value ? [{ value, label: str(ro.label) ?? value }] : [];
    });
    const optionsFrom = type === "select" ? str(r.optionsFrom) : undefined;
    return [{ key, type: type as PluginField["type"], label: str(r.label) ?? key, ...(typeof d === "string" || typeof d === "number" || typeof d === "boolean" ? { default: d } : {}), ...(options.length ? { options } : {}), ...(optionsFrom ? { optionsFrom } : {}), ...(type === "secret" ? { isSet: r.isSet === true || (saved[key] !== undefined && saved[key] !== null && saved[key] !== "") } : {}) }];
  });
}

/** permissions: {network?: string[], shell?: bool, keyboard?: bool, storage?: bool}; anything else is ignored. */
const osList = (v: unknown): string[] | undefined => { const l = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; return l.length ? l : undefined; };
export function normalizePermissions(raw: unknown): PluginPermissions {
  const r = rec(raw);
  return {
    network: (Array.isArray(r.network) ? r.network : []).filter((h): h is string => typeof h === "string" && !!h),
    shell: !!r.shell,
    keyboard: !!r.keyboard,
    storage: !!r.storage,
    onair: !!r.onair,
    notify: !!r.notify,
  };
}

const manifestCache = new Map<string, Promise<RegistryManifest | null>>();
function normalizeRegistryManifest(raw: unknown): RegistryManifest | null {
  const r = rec(raw);
  const id = str(r.id);
  if (!id) return null;
  return {
    id, name: str(r.name) ?? id, version: str(r.version) ?? "", registryVersion: str(r.registryVersion),
    permissions: normalizePermissions(r.permissions),
    permissionLines: (Array.isArray(r.permissionLines) ? r.permissionLines : []).filter((x): x is string => typeof x === "string"),
    widgets: (Array.isArray(r.widgets) ? r.widgets : []).flatMap((x: unknown) => { const o = rec(x); const i = str(o.id); return i ? [{ id: i, name: str(o.name) ?? i, render: str(o.render) ?? "", sizes: (Array.isArray(o.sizes) ? o.sizes : []).filter((s): s is string => typeof s === "string"), preview: o.preview }] : []; }),
    actions: (Array.isArray(r.actions) ? r.actions : []).flatMap((x: unknown) => { const o = rec(x); const i = str(o.id); return i ? [{ id: i, name: str(o.name) ?? i }] : []; }),
    main: typeof r.main === "string" ? r.main : null,
    os: osList(r.os), unavailable: str(r.unavailable),
  };
}
export function normalizeRegistryEntry(raw: unknown): RegistryEntry | null {
  const r = rec(raw);
  const id = str(r.id);
  if (!id) return null;
  return {
    id, name: str(r.name) ?? id, version: str(r.version) ?? "", repo: str(r.repo) ?? "", author: str(r.author), description: str(r.description), icon: str(r.icon),
    screenshot: str(r.screenshot), tier: str(r.tier), verified: r.tier === "verified" || r.verified === true,
    permissions: r.permissions && typeof r.permissions === "object" ? normalizePermissions(r.permissions) : undefined,
    installed: r.installed === true, installedVersion: str(r.installedVersion), updateAvailable: r.updateAvailable === true,
    os: osList(r.os), unavailable: str(r.unavailable),
  };
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");
function normalizeThemePack(raw: unknown, installed: boolean): ThemePack | null {
  const r = rec(raw);
  const id = str(r.id);
  if (!id) return null;
  const variants = arr(r.variants).flatMap((x): ThemeVariantInfo[] => {
    const v = rec(x); const vid = str(v.id);
    return vid ? [{ id: vid, name: str(v.name) ?? vid, mode: v.mode === "light" ? "light" : "dark", look: rec(v.look ?? v.theme) as Partial<ThemeLook>, preview: str(v.preview), ...(v.modeMismatch ? { modeMismatch: true } : {}) }] : [];
  });
  const options = arr(r.options).flatMap((x): ThemeOptionInfo[] => {
    const o = rec(x); const oid = str(o.id);
    if (!oid) return [];
    const values = arr(o.values).flatMap((y): ThemeOptionValue[] => { const w = rec(y); const wid = str(w.id); return wid ? [{ id: wid, name: str(w.name) ?? wid, ...(w.theme ? { theme: rec(w.theme) as Partial<ThemeLook> } : {}), ...(w.variants ? { variants: rec(w.variants) as Record<string, Partial<ThemeLook>> } : {}) }] : []; });
    return [{ id: oid, name: str(o.name) ?? oid, values }];
  });
  const a = rec(r.auto);
  return {
    id, name: str(r.name) ?? id, version: str(r.version) ?? "", author: str(r.author), description: str(r.description), preview: str(r.preview), repo: str(r.repo),
    variants, options, auto: str(a.light) && str(a.dark) ? { light: str(a.light)!, dark: str(a.dark)! } : undefined,
    hasCss: r.hasCss === true, fonts: strs(r.fonts), icons: strs(r.icons),
    builtin: r.builtin === true, installed: installed || r.installed === true, installedVersion: str(r.installedVersion) ?? (installed ? str(r.version) : undefined),
    updateAvailable: r.updateAvailable === true, applied: r.applied === true, appliedOlder: r.appliedOlder === true, reviewed: r.reviewed !== false,
  };
}

/** Until the agent has the process endpoints, open the page with ?mockprocess to see the UI with made-up data. */
const mockProcess = (): boolean => typeof window !== "undefined" && /[?&]mockprocess\b/.test(window.location.search);
const mockStates = new Map<string, { state: PluginProcessState; since: number; lines: string[] }>();
function mockEntry(id: string) {
  let e = mockStates.get(id);
  if (!e) {
    const crashed = id.length % 2 === 0;
    e = { state: crashed ? "crashed" : "running", since: Date.now() - 125_000, lines: Array.from({ length: 60 }, (_, i) => `2026-11-23T09:${String(i % 60).padStart(2, "0")}:00Z fetched stars (${100 + i})`) };
    if (crashed) e.lines.push("TypeError: Cannot read properties of undefined (reading 'stargazers_count')", "    at provide (src/index.ts:21:34)", "plugin exited with code 1");
    mockStates.set(id, e);
  }
  return e;
}
const mockState = (id: string): PluginProcess => { const e = mockEntry(id); return { state: e.state, pid: e.state === "running" ? 4242 : undefined, restarts: e.state === "crashed" ? 2 : 0, startedAt: e.since }; };
const mockLogs = (id: string): string[] => mockEntry(id).lines;
const mockSet = (id: string, state: PluginProcessState): void => { const e = mockEntry(id); e.state = state; e.since = Date.now(); e.lines.push(`${new Date().toISOString()} ${state === "running" ? "restarted by you" : "stopped by you"}`); };

export function normalizePlugin(raw: unknown): PluginInfo | null {
  const r = rec(raw);
  const id = str(r.id);
  if (!id) return null;
  const settings = rec(r.settings);
  return {
    id,
    name: str(r.name) ?? id,
    version: str(r.version) ?? "",
    description: str(r.description),
    icon: str(r.icon),
    author: str(r.author),
    source: str(r.source),
    reviewed: r.reviewed === true ? true : undefined,
    registryVersion: str(r.registryVersion),
    code: typeof r.main === "string" || mockProcess() ? true : undefined,
    enabled: r.enabled === true,
    builtin: r.builtin === true ? true : undefined,
    unreviewed: r.builtin === true ? false : r.unreviewed !== false,
    needsApproval: r.needsApproval === true,
    os: osList(r.os),
    error: str(r.error),
    permissions: normalizePermissions(r.permissions),
    granted: normalizePermissions(r.granted),
    widgets: (Array.isArray(r.widgets) ? r.widgets : []).flatMap((x: unknown) => {
      const w = rec(x);
      const wid = str(w.id);
      return wid ? [{ id: wid, name: str(w.name) ?? wid, render: str(w.render) ?? "", sizes: (Array.isArray(w.sizes) ? w.sizes : []).filter((s): s is string => typeof s === "string"), settings: normalizeFields(w.settings), preview: w.preview, ...(str(w.style) ? { style: str(w.style) } : {}) }] : [];
    }),
    actions: (Array.isArray(r.actions) ? r.actions : []).flatMap((x: unknown) => {
      const a = rec(x);
      const aid = str(a.id);
      return aid ? [{ id: aid, name: str(a.name) ?? aid, settings: normalizeFields(a.settings) }] : [];
    }),
    themes: (Array.isArray(r.themes) ? r.themes : []).flatMap((x: unknown) => { const o = rec(x); const id = str(o.id); return id && o.theme && typeof o.theme === "object" ? [{ id, name: str(o.name) ?? id, theme: o.theme as Theme }] : []; }),
    layouts: (Array.isArray(r.layouts) ? r.layouts : []).flatMap((x: unknown) => { const o = rec(x); const id = str(o.id); return id && o.layout && typeof o.layout === "object" ? [{ id, name: str(o.name) ?? id, layout: o.layout as Layout }] : []; }),
    fields: normalizeFields(r.fields, settings),
    settings,
  };
}

function normalizeApps(raw: unknown): MacApp[] {
  const list = Array.isArray(raw) ? raw : rec(raw).apps;
  return (Array.isArray(list) ? list : []).flatMap((x: unknown) => {
    const r = rec(x);
    // macOS: bundle id. Windows: the agent's opaque app id (sent as bundleId, or as id/appId).
    const bundleId = str(r.bundleId) ?? str(r.id) ?? str(r.appId);
    const name = str(r.name);
    return bundleId && name ? [{ name, bundleId, path: str(r.path), category: str(r.category) }] : [];
  });
}

/** Ids of uploaded images from GET /api/icons: ["abc…"], [{id}] or {icons|images:[…]}. */
function normalizeUploads(raw: unknown): string[] {
  const r = rec(raw);
  const list = Array.isArray(raw) ? raw : r.icons ?? r.images ?? r.items;
  return (Array.isArray(list) ? list : []).flatMap((x: unknown) => {
    const id = typeof x === "string" ? x : str(rec(x).id);
    return id && /^[a-f0-9]{16}$/.test(id) ? [id] : [];
  });
}

const SND_HEX = /^(?:snd:)?([a-f0-9]{16})$/;
export function normalizeSounds(raw: unknown): Sound[] {
  const r = rec(raw);
  const list = Array.isArray(raw) ? raw : r.sounds ?? r.items ?? r.clips;
  return (Array.isArray(list) ? list : []).flatMap((x: unknown) => {
    const o = rec(x);
    const m = SND_HEX.exec(typeof x === "string" ? x : str(o.id) ?? "");
    if (!m) return [];
    const id = `snd:${m[1]}`;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    return [{ id, name: str(o.name) ?? str(o.title) ?? str(o.filename) ?? m[1]!, size: num(o.size) ?? num(o.bytes), duration: num(o.duration), type: str(o.type) ?? str(o.mime) }];
  });
}
/** Playback URL of a clip (`snd:<hex>` or bare hex). */
export const soundUrl = (id: string) => `/sounds/${id.replace(/^snd:/, "")}`;
const asRec = rec;
export function normalizeHassEntities(raw: unknown): HassEntity[] {
  const list = Array.isArray(raw) ? raw : asRec(raw).entities;
  return (Array.isArray(list) ? list : []).flatMap((x: unknown) => {
    const o = asRec(x);
    const id = str(o.id) ?? str(o.entity_id);
    if (!id || !/^[a-z_]+\.[a-z0-9_]+$/.test(id)) return [];
    return [{ id, name: str(o.name) ?? id, domain: str(o.domain) ?? id.split(".")[0]!, area: str(o.area), state: o.state === undefined || o.state === null ? undefined : String(o.state), icon: str(o.icon) }];
  });
}
/** Accepts [{id|service, name?}], {"domain.service": {...}}, or HA's {domain: {service: {...}}}. */
export function normalizeHassServices(raw: unknown): HassService[] {
  const r = asRec(Array.isArray(raw) ? null : raw);
  const src = Array.isArray(raw) ? raw : r.services ?? raw;
  const out: HassService[] = [];
  if (Array.isArray(src)) {
    for (const x of src) {
      const o = asRec(x);
      const id = typeof x === "string" ? x : str(o.id) ?? str(o.service);
      if (id && /^[a-z_]+\.[a-z0-9_]+$/.test(id)) out.push({ id, name: str(o.name), description: str(o.description) });
    }
  } else {
    for (const [k, v] of Object.entries(asRec(src))) {
      if (/^[a-z_]+\.[a-z0-9_]+$/.test(k)) out.push({ id: k, name: str(asRec(v).name), description: str(asRec(v).description) });
      else for (const [s, d] of Object.entries(asRec(v))) out.push({ id: `${k}.${s}`, name: str(asRec(d).name), description: str(asRec(d).description) });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
export const appIconUrl = (bundleId: string) => `/api/apps/icon?bundleId=${encodeURIComponent(bundleId)}`;
export const uploadUrl = (id: string) => `/api/icons/img/${id}`;

export const api = {
  getCatalog: () => request<IconCatalog>("/api/icons/catalog"),
  getScreenshotTools: () => request<ScreenshotTools>("/api/screenshot-tools"),
  getApps: async () => normalizeApps(await request<unknown>("/api/apps")),
  listUploads: async () => normalizeUploads(await request<unknown>("/api/icons")),
  /** Sends the raw PNG/JPEG bytes (Content-Type = the file's type). Returns the 16-hex id. */
  uploadIcon: async (file: File) => {
    const res = await request<unknown>("/api/icons", { method: "POST", headers: { "content-type": file.type }, body: file });
    const id = str(rec(res).id);
    if (!id) throw new ApiError(t("The agent did not return an image id"), 0);
    return id;
  },
  deleteUpload: (id: string) => request<unknown>(`/api/icons/img/${id}`, { method: "DELETE" }),
  listSounds: async () => normalizeSounds(await request<unknown>("/api/sounds")),
  /** Raw audio bytes (Content-Type = the file's type); the display name goes in ?name=. */
  uploadSound: async (file: File) => {
    const res = await request<unknown>(`/api/sounds?name=${encodeURIComponent(file.name.replace(/\.[^.]+$/, ""))}`, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
    const s = normalizeSounds([res])[0];
    if (!s) throw new ApiError(t("The agent did not return a sound id"), 0);
    return s;
  },
  renameSound: (id: string, name: string) => request<unknown>(`/api/sounds/${id.replace(/^snd:/, "")}`, json("PATCH", { name })),
  deleteSound: (id: string) => request<unknown>(`/api/sounds/${id.replace(/^snd:/, "")}`, { method: "DELETE" }),
  /** Rejects (404) on an agent without the sign-in flow: the page then hides the button. */
  getHassStatus: async (): Promise<HassStatus> => {
    const o = rec(await request<unknown>("/api/hass/status"));
    const mode = o.mode === "oauth" ? "oauth" : o.mode === "token" ? "token" : undefined;
    // A null mode means nothing is set up, whatever "connected" says.
    return { connected: o.connected === true && !!mode, mode, haName: str(o.haName), haVersion: str(o.haVersion), user: str(o.user) ?? str(rec(o.user).name), error: str(o.error) };
  },
  /** Starts the sign-in: the agent returns the Home Assistant page to open, and handles the callback itself. */
  hassLogin: async (url: string): Promise<string> => {
    const a = str(rec(await request<unknown>("/api/hass/login", json("POST", { url }))).authorizeUrl);
    if (!a) throw new ApiError(t("The agent did not return a sign-in address"), 0);
    return a;
  },
  /** Revokes the sign-in and clears it. */
  hassLogout: () => request<unknown>("/api/hass/logout", json("POST")),
  getHass: () => request<HassConfig>("/api/hass/config"),
  putHassUrl: (url: string) => request<HassConfig>("/api/hass/config", json("PUT", { url })),
  /** The token is only ever sent, never read back. */
  putHassToken: (token: string) => request<unknown>("/api/hass/token", json("PUT", { token })),
  deleteHassToken: () => request<unknown>("/api/hass/token", { method: "DELETE" }),
  testHass: () => request<Partial<HassConfig> & { ok?: boolean }>("/api/hass/test", json("POST")),
  getHassEntities: async () => normalizeHassEntities(await request<unknown>("/api/hass/entities")),
  getHassServices: async () => normalizeHassServices(await request<unknown>("/api/hass/services")),
  geocode: async (q: string): Promise<GeoPlace[]> => {
    const raw = await request<unknown>(`/api/weather/geocode?q=${encodeURIComponent(q)}`);
    const list = Array.isArray(raw) ? raw : rec(raw).results ?? rec(raw).places ?? [];
    return (Array.isArray(list) ? list : []).flatMap((x: unknown) => {
      const o = rec(x);
      const lat = Number(o.lat ?? o.latitude), lon = Number(o.lon ?? o.longitude ?? o.lng);
      const name = str(o.name);
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
      return [{ name, lat, lon, detail: [str(o.admin1) ?? str(o.region), str(o.country)].filter(Boolean).join(", ") || undefined }];
    });
  },
  getWebhook: async (): Promise<WebhookInfo> => {
    const o = rec(await request<unknown>("/api/webhooks"));
    const keyMasked = str(o.keyMasked);
    if (!keyMasked) throw new ApiError(t("The agent did not return a webhook key"), 0);
    return { keyMasked, examples: (Array.isArray(o.examples) ? o.examples : []).filter((x): x is string => typeof x === "string") };
  },
  /** The full key, only when the user asks to copy it. */
  revealWebhookKey: async () => str(rec(await request<unknown>("/api/webhooks?reveal=1")).key),
  rotateWebhook: async () => str(rec(await request<unknown>("/api/webhooks/key/rotate", json("POST"))).key),
  /** Resolves app/upload icons for the preview: {assets:{<icon value>: …}} (the deck reads layout.assets). */
  layoutAssets: async (layout: Layout): Promise<Record<string, unknown>> => {
    const raw = rec(await request<unknown>("/api/layout/assets", json("POST", { layout })));
    return rec(raw.assets ?? raw);
  },
  /** Platform of the agent's machine: GET /api/info {platform}; undefined when the agent does not say. */
  getPlatform: async (): Promise<Platform | undefined> => {
    const o = rec(await request<unknown>("/api/info"));
    return asPlatform(o.platform ?? o.os);
  },
  getAbout: async (): Promise<About> => {
    const o = rec(await request<unknown>("/api/about"));
    const version = str(o.version);
    if (!version) throw new ApiError(t("The agent did not report a version"), 0);
    const repo = (str(o.repo) ?? str(o.repository) ?? str(o.homepage) ?? "https://github.com/howznguyen/nookdeck").replace(/(\.git)?\/*$/, "");
    const d = o.buildDate ?? o.builtAt ?? o.built;
    return { version: version.replace(/^v/, ""), commit: str(o.commit)?.replace(/-dirty$/, "").slice(0, 7), dirty: o.dirty === true || /dirty/.test(str(o.commit) ?? "") || undefined, buildDate: typeof d === "number" ? new Date(d < 1e12 ? d * 1000 : d).toISOString() : str(d), platform: str(o.platform), arch: str(o.arch), repo };
  },
  /** "Report a problem": a masked Markdown report for a GitHub issue. */
  getReport: async (): Promise<{ title: string; markdown: string; repo: string }> => {
    const o = rec(await request<unknown>("/api/report"));
    return { title: str(o.title) ?? "", markdown: str(o.markdown) ?? "", repo: (str(o.repo) ?? "https://github.com/howznguyen/nookdeck").replace(/(\.git)?\/*$/, "") };
  },
  getUpdate: async (): Promise<UpdateInfo> => {
    const o = rec(await request<unknown>("/api/update"));
    return { current: str(o.current) ?? "", latest: str(o.latest) ?? null, available: o.available === true, checkedAt: typeof o.checkedAt === "number" ? o.checkedAt : null, enabled: o.enabled !== false, error: str(o.error) };
  },
  /** `fresh`: run the checks now instead of the agent's answer from the last 30 s (opening the page, "check again"). */
  getDoctor: async (fresh = false): Promise<DoctorItem[]> => {
    const raw = rec(await request<unknown>(fresh ? "/api/doctor?fresh=1" : "/api/doctor"));
    const list = Array.isArray(raw.items) ? raw.items : [];
    return list.flatMap((x: unknown) => {
      const r = rec(x);
      const id = str(r.id);
      if (!id) return [];
      const st = r.status;
      const status: DoctorStatus = st === "ok" || st === "missing" || st === "denied" || st === "n/a" ? st : "unknown";
      const f = r.fix === undefined || r.fix === null ? undefined : rec(r.fix);
      const fixText = str(f?.text);
      return [{ id, status, name: str(r.name), detail: str(r.detail), ...(fixText || f?.settingsUrl ? { fix: { text: fixText ?? "", settingsUrl: str(f?.settingsUrl) } } : {}) }];
    });
  },
  openDoctorSettings: (id: string) => request<unknown>("/api/doctor/open", json("POST", { id })),
  requestDoctor: (id: string, reset = false) => request<unknown>("/api/doctor/request", json("POST", { id, reset })),
  getIntegrations: async () => {
    const raw = await request<unknown>("/api/integrations");
    // An old agent may still send an "openusage" block: it is ignored.
    return { integrations: normalizeIntegrations(raw) };
  },
  enableHook: (id: AiProvider) => request<unknown>(hookUrl(id), json("POST")),
  /** Installs (or updates) the AskUserQuestion hook; idleOnly = only when the user has been away for a minute. */
  enableAskHook: (idleOnly: boolean) => request<unknown>("/api/integrations/claude/ask-hook", json("POST", { idleOnly })),
  disableAskHook: () => request<unknown>("/api/integrations/claude/ask-hook", { method: "DELETE" }),
  disableHook: (id: AiProvider) => request<unknown>(hookUrl(id), { method: "DELETE" }),
  /** Several Claude accounts / Codex profiles: extra config folders, each with a name. Every call answers with the new list. */
  getAiAccounts: () => request<AiAccounts>("/api/ai/accounts"),
  addAiAccount: (tool: AiAccountTool, name: string, dir: string) => request<AiAccounts>("/api/ai/accounts", json("POST", { tool, name, dir })),
  renameAiAccount: (tool: AiAccountTool, id: string, name: string) => request<AiAccounts>(`/api/ai/accounts/${tool}/${encodeURIComponent(id)}`, json("PATCH", { name })),
  removeAiAccount: (tool: AiAccountTool, id: string) => request<AiAccounts>(`/api/ai/accounts/${tool}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getPlugins: async (): Promise<PluginInfo[]> => {
    const raw = await request<unknown>("/api/plugins");
    const list = Array.isArray(raw) ? raw : rec(raw).plugins;
    return (Array.isArray(list) ? list : []).flatMap((x: unknown) => normalizePlugin(x) ?? []);
  },
  /** source = an https URL or a local folder; the plugin comes back disabled until its permissions are granted. */
  installPlugin: async (source: string): Promise<PluginInfo> => {
    const p = normalizePlugin(await request<unknown>("/api/plugins", json("POST", { source })));
    if (!p) throw new ApiError(t("The agent did not return a plugin"), 0);
    return p;
  },
  grantPlugin: (id: string, permissions: PluginPermissions) => request<unknown>(`/api/plugins/${encodeURIComponent(id)}/grant`, json("POST", { permissions })),
  setPluginEnabled: (id: string, enabled: boolean) => request<unknown>(`/api/plugins/${encodeURIComponent(id)}/enabled`, json("POST", { enabled })),
  /** The choices of a select with optionsFrom, from the plugin's code (it may need OBS running: it can fail). */
  pluginOptions: async (id: string, provider: string, settings: Record<string, unknown>): Promise<string[]> => {
    const r = rec(await request<unknown>(`/api/plugins/${encodeURIComponent(id)}/options`, json("POST", { provider, settings })));
    return (Array.isArray(r.options) ? r.options : []).filter((x): x is string => typeof x === "string");
  },
  putPluginSettings: (id: string, settings: Record<string, unknown>) => request<unknown>(`/api/plugins/${encodeURIComponent(id)}/settings`, json("PUT", settings)),
  /** The community registry. null when this agent has no registry endpoint (older agent); throws when the agent has nothing to show (502). */
  /** Installed theme packs plus the registry's; an agent without themes answers 404 and this returns null. */
  getThemes: async (): Promise<ThemesResult | null> => {
    try {
      const o = rec(await request<unknown>("/api/themes"));
      const own = arr(o.themes).flatMap((x) => normalizeThemePack(x, true) ?? []);
      const have = new Set(own.map((p) => p.id));
      const reg = arr(o.registry).flatMap((x) => normalizeThemePack(x, false) ?? []).filter((p) => !have.has(p.id));
      const ap = rec(o.applied);
      return { packs: [...own, ...reg], applied: str(ap.pack) ? (ap as unknown as ThemeSource) : null };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  installTheme: async (body: { id: string } | { source: string }) => normalizeThemePack(await request<unknown>("/api/themes/install", json("POST", body)), true),
  /** A pack that is not installed, fetched by the agent into its preview cache (same hash check as Install, not installed). */
  previewTheme: async (id: string): Promise<ThemePack | null> => {
    const p = normalizeThemePack(await request<unknown>(`/api/themes/${encodeURIComponent(id)}/preview`, json("POST", {})), false);
    return p ? { ...p, live: true } : null;
  },
  applyTheme: (id: string, body: { variant?: string; auto?: { light: string; dark: string }; options?: Record<string, string> }) =>
    request<unknown>(`/api/themes/${encodeURIComponent(id)}/apply`, json("POST", body)),
  /** A local, editable copy of an installed pack (its applied variant and options by default). Does not apply it. */
  forkTheme: async (id: string, body: { name?: string; variant?: string; options?: Record<string, string> }) => normalizeThemePack(await request<unknown>(`/api/themes/${encodeURIComponent(id)}/fork`, json("POST", body)), true),
  removeTheme: (id: string) => request<unknown>(`/api/themes/${encodeURIComponent(id)}`, { method: "DELETE" }),
  undoLayout: () => request<unknown>("/api/layout/undo", { method: "POST" }),
  /** The theme package (a zip) for the current look. */
  exportTheme: async (body: { id: string; name: string; version?: string; author?: string; description?: string; preview?: string }): Promise<Blob> => {
    let res: Response;
    try { res = await fetch("/api/themes/export", { method: "POST", headers: { "X-Nookdeck": "1", "Content-Type": "application/json" }, body: JSON.stringify(body) }); } catch { throw new ApiError(t("Cannot reach the Nookdeck agent"), 0); }
    if (!res.ok) { let m = ""; try { m = str(rec(await res.json()).error) ?? ""; } catch { /* no body */ } throw new ApiError(m || t("Could not export the theme"), res.status); }
    return res.blob();
  },
  getThemeCss: async (id: string, variant?: string): Promise<string> => {
    const res = await fetch(`/api/themes/${encodeURIComponent(id)}/css${variant ? `?variant=${encodeURIComponent(variant)}` : ""}`);
    return res.ok ? res.text() : "";
  },
  getRegistry: async (refresh = false): Promise<RegistryResult | null> => {
    try {
      const o = rec(await request<unknown>(`/api/plugins/registry${refresh ? "?refresh=1" : ""}`));
      const list = Array.isArray(o.plugins) ? o.plugins : [];
      return { plugins: list.flatMap((x: unknown) => normalizeRegistryEntry(x) ?? []), stale: o.stale === true, fetchedAt: typeof o.fetchedAt === "number" ? o.fetchedAt : undefined };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  /** What a registry plugin adds and asks for (tiles with sample data). Cached for the session; null when unavailable. */
  getRegistryManifest: (id: string): Promise<RegistryManifest | null> => {
    let p = manifestCache.get(id);
    if (!p) {
      p = request<unknown>(`/api/plugins/registry/${encodeURIComponent(id)}/manifest`).then(normalizeRegistryManifest, () => null);
      manifestCache.set(id, p);
      p.then((m) => { if (!m) manifestCache.delete(id); });
    }
    return p;
  },
  /** README of a registry plugin, raw markdown; "" when it has none. */
  getRegistryReadme: async (id: string): Promise<string> => {
    let res: Response;
    try { res = await fetch(`/api/plugins/registry/${encodeURIComponent(id)}/readme`); } catch { throw new ApiError(t("Cannot reach the Nookdeck agent"), 0); }
    if (res.status === 404) return "";
    if (res.status === 413) return t("The description is too long to show here. Read it in the plugin's repository.");
    if (!res.ok) throw new ApiError(`${res.status} ${res.statusText}`, res.status);
    return res.text();
  },
  /** Installs a registry plugin; it comes back disabled until its permissions are granted. */
  installFromRegistry: async (id: string): Promise<PluginInfo> => {
    try {
      const p = normalizePlugin(await request<unknown>("/api/plugins/install-from-registry", json("POST", { id })));
      if (!p) throw new ApiError(t("The agent did not return a plugin"), 0);
      return p;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) throw new ApiError(t("Not installed, for your safety: the plugin's files do not match the version Nookdeck reviewed. Try again later, or tell the plugin's author."), 409);
      throw e;
    }
  },
  /** Updates an installed registry plugin. It may come back needsApproval when it now asks for more. */
  updatePlugin: async (id: string): Promise<PluginInfo> => {
    try {
      const p = normalizePlugin(await request<unknown>(`/api/plugins/${encodeURIComponent(id)}/update`, json("POST")));
      if (!p) throw new ApiError(t("The agent did not return a plugin"), 0);
      return p;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) throw new ApiError(t("Not updated: this plugin did not come from the Store, or the version is not newer. If the files changed after review, Nookdeck refuses them for your safety."), 409);
      throw e;
    }
  },
  /** Process state of a code plugin. null when the agent has no process endpoints (older agent). */
  getPluginProcess: async (id: string): Promise<PluginProcess | null> => {
    if (mockProcess()) return mockState(id);
    try {
      const o = rec(await request<unknown>(`/api/plugins/${encodeURIComponent(id)}/process`));
      const state = (["running", "stopped", "crashed", "failed"] as const).find((s) => s === o.state);
      return state ? { state, pid: typeof o.pid === "number" ? o.pid : undefined, restarts: typeof o.restarts === "number" ? o.restarts : undefined, startedAt: typeof o.startedAt === "number" ? o.startedAt : undefined, lastError: str(o.lastError) } : null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  /** The last `n` log lines of a code plugin. */
  getPluginLogs: async (id: string, n = 50): Promise<string[]> => {
    if (mockProcess()) return mockLogs(id).slice(-n);
    const o = await request<unknown>(`/api/plugins/${encodeURIComponent(id)}/logs?lines=${n}`);
    const list = Array.isArray(o) ? o : rec(o).lines;
    return (Array.isArray(list) ? list : []).filter((x): x is string => typeof x === "string").slice(-n);
  },
  restartPlugin: async (id: string): Promise<void> => { if (mockProcess()) { mockSet(id, "running"); return; } await request<unknown>(`/api/plugins/${encodeURIComponent(id)}/restart`, json("POST")); },
  stopPlugin: async (id: string): Promise<void> => { if (mockProcess()) { mockSet(id, "stopped"); return; } await request<unknown>(`/api/plugins/${encodeURIComponent(id)}/stop`, json("POST")); },
  deletePlugin: (id: string) => request<unknown>(`/api/plugins/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getLayout: () => request<Layout>("/api/layout"),
  putLayout: (layout: Layout) => request<unknown>("/api/layout", json("PUT", layout)),
  getDevices: () => request<DeviceInfo[]>("/api/devices"),
  /** Asks the deck on one device (or all, without deviceId) to reload. The reply may carry the number reached. */
  reloadDevices: (deviceId?: string) => request<unknown>("/api/devices/reload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(deviceId ? { deviceId } : {}) }),
  revokeDevice: (id: string) => request<unknown>(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getPairing: () => request<Pairing>("/api/pairing"),
  regeneratePairing: () => request<Pairing>("/api/pairing/regenerate", json("POST")),
  androidStatus: () => request<UsbStatus>("/api/android"),
  androidInstallAdb: () => request<{ ok: boolean }>("/api/android/adb", json("POST")),
  androidSetup: (serial: string, o: { stayAwake: boolean; battery: boolean }) => request<{ ok: true; model: string }>("/api/android/setup", json("POST", { serial, ...o })),
};
