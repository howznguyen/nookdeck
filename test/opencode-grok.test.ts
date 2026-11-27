import "./_fetch";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as OC from "../src/ai/opencode";
import * as GK from "../src/ai/grok";
import { ToolStates, withToolState } from "../src/ai/states";
import { validateRules } from "../src/automation";
const parseRules = (v: any) => validateRules(v, new Set())!;

// Everything here lives in temp dirs: the tools' real data (~/.grok, ~/.config/opencode, ~/.local/share/opencode) is never read or written.
const tmp = () => mkdtempSync(join(tmpdir(), "pd-ocgk-"));
const NOW = 1_800_000_000_000;

describe("OpenCode paths and version", () => {
  test("OPENCODE_DB wins (absolute or relative to the data dir); the channel gets its own file name", () => {
    const keep = { ...process.env };
    try {
      process.env.OPENCODE_DB = "/x/y/custom.db";
      expect(OC.opencodeDbPath()).toBe("/x/y/custom.db");
      process.env.OPENCODE_DB = "rel.db";
      expect(OC.opencodeDbPath()).toBe(join(OC.opencodeDataDir(), "rel.db"));
      delete process.env.OPENCODE_DB;
      process.env.XDG_DATA_HOME = "/d";
      expect(OC.opencodeDbPath()).toBe(join("/d", "opencode", "opencode.db"));
      process.env.OPENCODE_CHANNEL = "dev";
      expect(OC.opencodeDbPath()).toBe(join("/d", "opencode", "opencode-dev.db"));
      process.env.OPENCODE_CHANNEL = "latest";
      expect(OC.opencodeDbPath()).toBe(join("/d", "opencode", "opencode.db"));
    } finally { for (const k of ["OPENCODE_DB", "XDG_DATA_HOME", "OPENCODE_CHANNEL"]) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
  });
  test("the line comes from `opencode --version`", async () => {
    expect(OC.parseOpencodeVersion("1.19.6\n")).toEqual({ version: "1.19.6", major: 1 });
    expect(OC.parseOpencodeVersion("opencode 2.3.2")).toEqual({ version: "2.3.2", major: 2 });
    expect(OC.parseOpencodeVersion("garbage")).toBeNull();
    expect(await OC.detectOpencode(async () => "2.3.2", "/bin/opencode")).toMatchObject({ major: 2 });
    expect(await OC.detectOpencode(async () => { throw new Error("x"); }, "/bin/opencode")).toBeNull();
    expect(await OC.detectOpencode(async () => "1.0.0", null)).toBeNull();
  });
});

describe("finding the binaries outside PATH (the agent runs as a service)", () => {
  const withEnv = async (vars: Record<string, string | undefined>, fn: () => void | Promise<void>) => {
    const keep: Record<string, string | undefined> = {};
    for (const k of Object.keys(vars)) { keep[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
    try { await fn(); } finally { for (const k of Object.keys(vars)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
  };
  test.skipIf(process.platform === "win32")("~/.opencode/bin/opencode and ~/.grok/bin/grok are found with an empty PATH; nothing found -> null", async () => {
    const home = tmp();
    mkdirSync(join(home, ".opencode", "bin"), { recursive: true });
    writeFileSync(join(home, ".opencode", "bin", "opencode"), "#!/bin/sh\necho 1.18.35\n"); chmodSync(join(home, ".opencode", "bin", "opencode"), 0o755);
    mkdirSync(join(home, ".grok", "bin"), { recursive: true });
    writeFileSync(join(home, ".grok", "bin", "grok"), "#!/bin/sh\n"); chmodSync(join(home, ".grok", "bin", "grok"), 0o755);
    await withEnv({ HOME: home, PATH: "/nonexistent", NOOKDECK_OPENCODE: undefined, NOOKDECK_GROK: undefined, GROK_HOME: join(home, ".grok") }, async () => {
      expect(OC.opencodePath()).toBe(join(home, ".opencode", "bin", "opencode"));
      expect(GK.grokPath()).toBe(join(home, ".grok", "bin", "grok"));
      expect(await OC.detectOpencode(undefined, OC.opencodePath())).toEqual({ version: "1.18.35", major: 1 }); // runs it by absolute path
    });
    const empty = tmp();
    await withEnv({ HOME: empty, PATH: "/nonexistent", NOOKDECK_OPENCODE: undefined, NOOKDECK_GROK: undefined, GROK_HOME: join(empty, ".grok") }, () => {
      if (!existsSync("/opt/homebrew/bin/opencode") && !existsSync("/usr/local/bin/opencode")) expect(OC.opencodePath()).toBeNull();
    });
  });
  test("the data directory / database is evidence of an install", async () => {
    const d = tmp();
    await withEnv({ OPENCODE_DB: join(d, "data", "opencode.db"), XDG_DATA_HOME: join(d, "xdg") }, () => { expect(OC.opencodeDataFound()).toBe(false); });
    mkdirSync(join(d, "data")); writeFileSync(join(d, "data", "opencode.db"), "");
    await withEnv({ OPENCODE_DB: join(d, "data", "opencode.db"), XDG_DATA_HOME: join(d, "xdg") }, () => { expect(OC.opencodeDataFound()).toBe(true); });
    await withEnv({ GROK_HOME: join(d, "nogrok") }, () => { expect(GK.grokDataFound()).toBe(false); });
    await withEnv({ GROK_HOME: d }, () => { expect(GK.grokDataFound()).toBe(true); });
  });
});

describe("OpenCode sessions from opencode.db (read-only)", () => {
  const dir = tmp();
  const file = join(dir, "opencode.db");
  const db = new Database(file);
  db.run("CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, title TEXT, agent TEXT, model TEXT, cost REAL, tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER, time_created INTEGER, time_updated INTEGER, time_archived INTEGER)");
  const ins = db.prepare("INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  ins.run("s1", null, "/work/app", "Fix the login", "build", "anthropic/claude-x", 0.1234, 100, 50, 10, NOW - 9e5, NOW - 5_000, null);
  ins.run("s2", null, "/work/api", "Old chat", "build", '{"providerID":"openai","modelID":"gpt-9"}', 0, 0, 0, 0, NOW - 9e8, NOW - 3 * 24 * 3600_000, null);
  ins.run("s3", "s1", "/work/app", "sub agent", "task", "m", 0, 1, 1, 0, NOW - 1e4, NOW - 1_000, null);
  ins.run("s4", null, "/work/old", "Archived", "build", "m", 0, 1, 1, 0, NOW - 1e4, NOW - 1_000, NOW - 500);
  ins.run("s5", null, "/work/lib", "Waiting one", "build", "m2", 0, 0, 0, 0, NOW - 1e6, NOW - 120_000, null);
  db.close();

  test("recent top-level, non-archived sessions: project, title, model, tokens, cost, state", () => {
    const s = OC.readOpencodeSessions(file, NOW);
    expect(s.map((x) => x.id)).toEqual(["s1", "s5", "s2"]); // s2 is 3 days old: inside the 7-day window
    expect(s[0]).toMatchObject({ tool: "opencode", project: "app", title: "Fix the login", model: "anthropic/claude-x", state: "working", tokens: 160, cost: 0.123, updatedAt: NOW - 5000 });
    expect(s[1]!.state).toBe("idle");
    expect(OC.readOpencodeSessions(file, NOW, 12, 24 * 3600_000).map((x) => x.id)).toEqual(["s1", "s5"]);
  });
  test("a JSON model column is read; a missing or foreign database gives nothing, never an error", () => {
    const d2 = tmp(); const f2 = join(d2, "o.db");
    const x = new Database(f2); x.run("CREATE TABLE session (id TEXT, directory TEXT, model TEXT, time_updated INTEGER)"); x.run("INSERT INTO session VALUES ('a','/p/q','{\"providerID\":\"openai\",\"modelID\":\"gpt-9\"}', ?)", [NOW - 1000]); x.close();
    expect(OC.readOpencodeSessions(f2, NOW)[0]).toMatchObject({ id: "a", model: "gpt-9", project: "q" });
    expect(OC.readOpencodeSessions(join(d2, "none.db"), NOW)).toEqual([]);
    writeFileSync(join(d2, "junk.db"), "not sqlite at all");
    expect(OC.readOpencodeSessions(join(d2, "junk.db"), NOW)).toEqual([]);
  });
  test("the database is opened read-only: our reader cannot change it", () => {
    const before = readFileSync(file);
    OC.readOpencodeSessions(file, NOW);
    expect(readFileSync(file).equals(before)).toBe(true);
    const ro = new Database(file, { readonly: true });
    expect(() => ro.run("DELETE FROM session")).toThrow();
    ro.close();
  });
  test("2.x keeps new sessions in session_v2: both tables are read, newest first, an id in both counts once and its newest copy decides", () => {
    const d3 = tmp(); const f3 = join(d3, "o.db");
    const x = new Database(f3);
    const cols = "id TEXT, parent_id TEXT, directory TEXT, title TEXT, model TEXT, time_updated INTEGER, time_archived INTEGER";
    x.run(`CREATE TABLE session (${cols})`); x.run(`CREATE TABLE session_v2 (${cols})`);
    const legacy = x.prepare("INSERT INTO session VALUES (?,?,?,?,?,?,?)"), v2 = x.prepare("INSERT INTO session_v2 VALUES (?,?,?,?,?,?,?)");
    legacy.run("a", null, "/p/legacy", "1.x chat", "m", NOW - 2 * 24 * 3600_000, null);
    legacy.run("b", null, "/p/both", "in both", "m", NOW - 9_000, null); // the session_v2 copy is newer and wins
    v2.run("b", null, "/p/both", "in both", "m", NOW - 1_000, null);
    v2.run("c", null, "/p/new", "2.x chat", "m", NOW - 5_000, null);
    v2.run("d", "c", "/p/new", "sub agent", "m", NOW - 500, null); // sub-agent sessions stay out
    legacy.run("e", null, "/p/gone", "stale copy", "m", NOW - 3_000, null); // not archived in the old table...
    v2.run("e", null, "/p/gone", "archived copy", "m", NOW - 800, NOW - 700); // ...but archived in the newer copy, which decides
    x.close();
    const s = OC.readOpencodeSessions(f3, NOW);
    expect(s.map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(s[0]!.updatedAt).toBe(NOW - 1_000);
  });
});

describe("OpenCode 2.x local service", () => {
  test("service.json: localhost only; Basic auth with user opencode; active sessions and usage limits", async () => {
    const d = tmp(); const f = join(d, "service.json");
    writeFileSync(f, JSON.stringify({ url: "http://127.0.0.1:4096/", password: "pw" }));
    const svc = await OC.readService(f);
    expect(svc).toEqual({ url: "http://127.0.0.1:4096", password: "pw" });
    writeFileSync(f, JSON.stringify({ url: "https://evil.example.com", password: "pw" }));
    expect(await OC.readService(f)).toBeNull();
    expect(await OC.readService(join(d, "missing.json"))).toBeNull();

    const seen: { url: string; auth: string | null }[] = [];
    const fake = (async (u: string, init: any) => {
      seen.push({ url: u, auth: new Headers(init.headers).get("authorization") });
      if (u.endsWith("/api/session/active")) return Response.json([{ id: "s1" }, "s9"]);
      return Response.json({ rolling: { status: "ok", percent: 12.5, resetsAt: NOW + 3600_000 }, weekly: { status: "ok", percent: 40, resetsAt: Math.floor((NOW + 86400_000) / 1000) }, monthly: { status: "warn", percent: 91 } });
    }) as any;
    expect(await OC.activeOpencodeSessions(fake, svc)).toEqual(["s1", "s9"]);
    const q = await OC.fetchOpencodeQuota({ fetch: fake, service: svc, now: NOW });
    expect(q.windows.map((w) => [w.id, w.usedPercent])).toEqual([["rolling", 12.5], ["weekly", 40], ["monthly", 91]]);
    expect(q.windows[0]).toMatchObject({ resetsAt: NOW + 3600_000, windowMinutes: 300 });
    expect(q.windows[1]!.resetsAt).toBe(Math.floor((NOW + 86400_000) / 1000) * 1000);
    const basic = "Basic " + Buffer.from("opencode:pw").toString("base64");
    expect(seen.every((x) => x.auth === basic)).toBe(true);
    expect(seen.map((x) => new URL(x.url).pathname)).toEqual(["/api/session/active", "/api/experimental/usage/limits"]);
  });
  test("no service (1.x or not running) or a failing service: no windows and a reason, never a throw", async () => {
    const a = await OC.fetchOpencodeQuota({ service: null, version: { version: "1.19.6", major: 1 }, now: NOW });
    expect(a.windows).toEqual([]); expect(a.error).toContain("1.x");
    const svc = { url: "http://127.0.0.1:1" };
    const b = await OC.fetchOpencodeQuota({ service: svc, fetch: (async () => new Response("no", { status: 403 })) as any, now: NOW });
    expect(b.windows).toEqual([]); expect(b.error).toBeTruthy();
    expect(await OC.activeOpencodeSessions((async () => { throw new Error("down"); }) as any, svc)).toEqual([]);
  });
  test("2.4 wraps the windows as {data: {go: {...}}}; without a Go plan there is nothing to show", async () => {
    const svc = { url: "http://127.0.0.1:1" };
    const win = (percent: number, at: number) => ({ percent, limited: false, resetsAt: at });
    const go = { rolling: win(0, NOW + 1_000), weekly: win(11, NOW + 2_000), monthly: win(9, NOW + 3_000) };
    const answer = (data: unknown) => (async () => Response.json({ location: { directory: "/x" }, data })) as any;
    const a = await OC.fetchOpencodeQuota({ service: svc, fetch: answer({ workspace: { id: "w" }, go, budgets: [] }), now: NOW });
    expect(a.windows.map((w) => [w.id, w.usedPercent])).toEqual([["rolling", 0], ["weekly", 11], ["monthly", 9]]);
    expect(a.windows[1]).toMatchObject({ resetsAt: NOW + 2_000, windowMinutes: 10080 });
    expect(a.error).toBeUndefined();
    const b = await OC.fetchOpencodeQuota({ service: svc, fetch: answer({ workspace: { id: "w" }, go: null, budgets: [] }), now: NOW });
    expect(b.windows).toEqual([]); expect(b.error).toContain("No usage limits");
  });
});

describe("OpenCode plugin (opt-in)", () => {
  const params = (major: 1 | 2) => ({ port: 7420, home: "/h/.nookdeck", major });
  test("install writes a marked file for the right line, again is a no-op, uninstall removes only ours", async () => {
    const d = tmp(); const f = join(d, "plugins", "nookdeck.js");
    expect(await OC.isPluginInstalled(f)).toBe(false);
    expect(await OC.installPlugin(params(1), f)).toEqual({ changed: true });
    expect(await OC.isPluginInstalled(f)).toBe(true);
    const v1 = readFileSync(f, "utf8");
    expect(v1).toContain("nookdeck-plugin"); expect(v1).toContain("permission.asked"); expect(v1).toContain("question.asked"); expect(v1).toContain("7420");
    expect(await OC.installPlugin(params(1), f)).toEqual({ changed: false });
    expect(await OC.installPlugin(params(2), f)).toEqual({ changed: true }); // the line changed
    const v2 = readFileSync(f, "utf8");
    expect(v2).toContain("evaluate"); expect(v2).toContain("form.created"); expect(v2).not.toContain("permission.asked");
    expect(() => new Function("require", "module", v1)).not.toThrow(); // both templates are valid JavaScript
    expect(() => new Function("require", "module", v2)).not.toThrow();
    expect(await OC.uninstallPlugin(f)).toEqual({ changed: true });
    expect(existsSync(f)).toBe(false);
    expect(await OC.uninstallPlugin(f)).toEqual({ changed: false });
    // a file that is not ours is never overwritten or removed
    writeFileSync(f, "// my own plugin\n");
    await expect(OC.installPlugin(params(1), f)).rejects.toThrow("not written by Nookdeck");
    expect(await OC.uninstallPlugin(f)).toEqual({ changed: false });
    expect(readFileSync(f, "utf8")).toBe("// my own plugin\n");
  });

  // run the real template with fakes: the agent (localhost) and OpenCode's server
  async function runPlugin(major: 1 | 2, agentAnswers: Record<string, any>, events: any[], ctxExtra: any = {}) {
    const home = tmp(); writeFileSync(join(home, "hook-secret"), "sec\n");
    const src = OC.pluginSource({ port: 7420, home, major });
    const calls: { url: string; body: any; headers: any }[] = [];
    const fakeFetch = async (url: string, init: any = {}) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, body, headers: init.headers });
      const route = new URL(url).pathname;
      if (url.startsWith("http://127.0.0.1:7420")) { const a = agentAnswers[route]; return a === undefined ? new Response("{}", { status: 500 }) : Response.json(a); }
      return new Response("{}");
    };
    const module: any = { exports: {} };
    new Function("require", "module", "fetch", "Buffer", "AbortController", "setTimeout", "clearTimeout", src)(require, module, fakeFetch, Buffer, AbortController, setTimeout, clearTimeout);
    const plugin = await module.exports({ serverUrl: "http://localhost:4096/", directory: "/work/app", ...ctxExtra });
    let hookResult: any;
    for (const ev of events) {
      if (ev.hook) hookResult = await plugin.permission.hook[1](ev.hook);
      else await plugin.event({ event: ev });
    }
    return { calls, hookResult };
  }
  test("1.x: permission.asked -> phone allows -> reply once; deny -> reject; no answer -> nothing is sent back", async () => {
    const ev = (id: string) => ({ type: "permission.asked", properties: { id, sessionID: "ses1", permission: "bash", patterns: ["rm -rf build"] } });
    const allow = await runPlugin(1, { "/api/hooks/permission": { decision: "allow" } }, [ev("p1")]);
    const agentCall = allow.calls.find((c) => c.url.includes("/api/hooks/permission"))!;
    expect(agentCall.headers["x-nookdeck-hook"]).toBe("sec");
    expect(agentCall.body).toMatchObject({ source: "opencode", sessionId: "ses1", cwd: "/work/app", toolName: "bash" });
    expect(allow.calls.find((c) => c.url === "http://localhost:4096/permission/p1/reply")!.body).toEqual({ reply: "once" });
    const deny = await runPlugin(1, { "/api/hooks/permission": { decision: "deny" } }, [ev("p2")]);
    expect(deny.calls.find((c) => c.url.endsWith("/permission/p2/reply"))!.body).toEqual({ reply: "reject" });
    const none = await runPlugin(1, { "/api/hooks/permission": { decision: null } }, [ev("p3")]);
    expect(none.calls.some((c) => c.url.includes("/reply"))).toBe(false); // released: the terminal asks
    const down = await runPlugin(1, {}, [ev("p4")]);
    expect(down.calls.some((c) => c.url.includes("/reply"))).toBe(false);
  });
  test("1.x: question.asked -> answers -> /question/{id}/reply with label arrays; busy/idle events become states", async () => {
    const question = { type: "question.asked", properties: { id: "q1", sessionID: "ses1", questions: [{ question: "Which?", header: "H", options: [{ label: "A" }, { label: "B" }], multiple: true }, { question: "Sure?", options: [{ label: "yes" }] }] } };
    const r = await runPlugin(1, { "/api/hooks/question": { answers: { "Which?": "A, B", "Sure?": "yes" } }, "/api/hooks/state": { ok: true } }, [
      question, { type: "session.status", properties: { sessionID: "ses1", status: { type: "busy" } } }, { type: "session.idle", properties: { sessionID: "ses1" } },
    ]);
    const asked = r.calls.find((c) => c.url.includes("/api/hooks/question"))!.body;
    expect(asked).toMatchObject({ source: "opencode", sessionId: "ses1", questions: [{ question: "Which?", multiSelect: true, options: [{ label: "A" }, { label: "B" }] }, { question: "Sure?" }] });
    expect(r.calls.find((c) => c.url === "http://localhost:4096/question/q1/reply")!.body).toEqual({ answers: [["A", "B"], ["yes"]] });
    expect(r.calls.filter((c) => c.url.includes("/api/hooks/state")).map((c) => c.body.state)).toEqual(["busy", "idle"]);
  });
  test("2.x: the evaluate hook answers allow/deny or leaves the decision to the terminal", async () => {
    const hook = { sessionID: "s", permission: "edit", patterns: ["a.ts"] };
    expect((await runPlugin(2, { "/api/hooks/permission": { decision: "allow" } }, [{ hook }])).hookResult).toEqual({ action: "allow" });
    expect((await runPlugin(2, { "/api/hooks/permission": { decision: "deny" } }, [{ hook }])).hookResult).toEqual({ action: "deny" });
    expect((await runPlugin(2, { "/api/hooks/permission": { decision: null } }, [{ hook }])).hookResult).toBeUndefined();
  });
  test("2.x: form.created -> answer posted to /api/session/{sid}/form/{formID}/reply with Basic auth", async () => {
    const r = await runPlugin(2, { "/api/hooks/question": { answers: { "Pick": "x" } } }, [{ type: "form.created", properties: { sessionID: "S1", formID: "F1", questions: [{ question: "Pick", options: [{ label: "x" }] }] } }], { service: { url: "http://127.0.0.1:5000", password: "pw" } });
    const c = r.calls.find((x) => x.url === "http://127.0.0.1:5000/api/session/S1/form/F1/reply")!;
    expect(c.body).toEqual({ answer: { Pick: "x" } });
    expect(c.headers.authorization).toBe("Basic " + Buffer.from("opencode:pw").toString("base64"));
  });
});

describe("Grok sessions, state and hook file", () => {
  const home = tmp();
  const mk = (cwd: string, id: string, summary: any, mtime?: number) => {
    const d = join(home, "sessions", encodeURIComponent(cwd), id);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "summary.json"), JSON.stringify(summary));
  };
  mk("/work/app", "g1", { title: "Refactor", current_model_id: "grok-code-1", created_at: new Date(NOW - 1e6).toISOString(), updated_at: new Date(NOW - 3_000).toISOString(), num_messages: 12 });
  mk("/work/lib", "g2", { title: "Idle one", current_model_id: "grok-4", updated_at: NOW - 600_000 });
  mk("/work/old", "g3", { title: "Ancient", updated_at: NOW - 5 * 24 * 3600_000 });
  writeFileSync(join(home, "active_sessions.json"), JSON.stringify(["g1", "g3"]));

  test("sessions from summary.json under the url-encoded cwd; GROK_HOME-style dir; old ones dropped", async () => {
    const s = await GK.readGrokSessions({ dir: home, now: NOW });
    expect(s.map((x) => x.id)).toEqual(["g1", "g2", "g3"]); // g3 is old but still listed as active
    expect(s[0]).toMatchObject({ tool: "grok", project: "app", title: "Refactor", model: "grok-code-1", state: "working" });
    expect(s[1]).toMatchObject({ project: "lib", state: "idle" });
    expect(await GK.readGrokSessions({ dir: join(home, "nowhere"), now: NOW })).toEqual([]);
  });
  test("real summary.json shape: info.cwd/id, session_summary, 7-day window, newest first, idle; active ones are marked running", async () => {
    const h = tmp();
    const put = (folder: string, id: string, extra: any) => {
      const d = join(h, "sessions", encodeURIComponent(folder), id); mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "summary.json"), JSON.stringify({ info: { id, cwd: folder }, session_summary: "Summary " + id, current_model_id: "grok-4.7", num_messages: 76, ...extra }));
      writeFileSync(join(d, "prompt_history.jsonl"), "");
    };
    put("/Users/me/Workspaces/app", "a1", { generated_title: "Generated A", created_at: "2026-01-01T00:00:00Z", updated_at: new Date(NOW - 2 * 24 * 3600_000).toISOString(), last_active_at: new Date(NOW - 2 * 24 * 3600_000).toISOString() });
    put("/Users/me/Workspaces/lib", "b2", { updated_at: new Date(NOW - 6 * 24 * 3600_000).toISOString() });
    put("/Users/me/Workspaces/old", "c3", { updated_at: new Date(NOW - 20 * 24 * 3600_000).toISOString() });
    put("/Users/me/Workspaces/run", "d4", { updated_at: new Date(NOW - 30 * 24 * 3600_000).toISOString() });
    writeFileSync(join(h, "sessions", encodeURIComponent("/Users/me/Workspaces/app"), "prompt_history.jsonl"), "{}"); // a stray file next to the session folders
    writeFileSync(join(h, "active_sessions.json"), JSON.stringify([{ id: "d4" }]));
    const s = await GK.readGrokSessions({ dir: h, now: NOW });
    expect(s.map((x) => x.id)).toEqual(["a1", "b2", "d4"]); // c3 is older than 7 days; d4 is active so it stays
    expect(s[0]).toMatchObject({ tool: "grok", project: "app", title: "Generated A", model: "grok-4.7", state: "idle" });
    expect(s[0]!.running).toBeUndefined();
    expect(s[2]).toMatchObject({ project: "run", running: true });
    expect(s[1]!.title).toBe("Summary b2");
    expect((await GK.readGrokSessions({ dir: h, now: NOW, limit: 1 })).length).toBe(1);
  });
  test("hook-reported state wins: busy -> working, waiting -> waiting, idle -> idle", async () => {
    const st = new ToolStates(() => NOW);
    st.set("grok", "g2", "waiting");
    st.set("grok", "g1", "idle");
    const s = await GK.readGrokSessions({ dir: home, now: NOW, states: st });
    expect(s.find((x) => x.id === "g2")!.state).toBe("waiting");
    expect(s.find((x) => x.id === "g1")!.state).toBe("idle");
    expect(withToolState({ id: "x", tool: "grok", project: "p", state: "idle", updatedAt: 1 }, { state: "busy", at: 1 }).state).toBe("working");
    const old = new ToolStates(() => NOW, 1000);
    old.set("grok", "g1", "waiting");
    expect(new ToolStates(() => NOW + 5000, 1000).get("grok", "g1")).toBeUndefined();
    expect(old.get("grok", "g1")?.state).toBe("waiting");
  });
  test("active_sessions.json shapes", () => {
    expect(GK.parseActiveSessions(["a", { id: "b" }, { session_id: "c" }])).toEqual(["a", "b", "c"]);
    expect(GK.parseActiveSessions({ a: {}, b: {} })).toEqual(["a", "b"]);
    expect(GK.parseActiveSessions({ sessions: [{ sessionId: "z" }] })).toEqual(["z"]);
    expect(GK.parseActiveSessions(null)).toEqual([]);
  });
  test("no grok binary: the provider says why", async () => {
    GK.resetGrokQuotaCache();
    expect(await GK.grokQuota({ now: NOW, bin: null })).toMatchObject({ id: "grok", windows: [], error: "Grok was not found" });
  });
  test("hook file: the five events with explicit timeouts and the right states; refuses a foreign file; uninstall removes only ours", async () => {
    const d = tmp(); const f = join(d, "hooks", "nookdeck.json");
    const base = "'/bin/nookdeck' hook claude --port 7500 # nookdeck hook";
    expect(await GK.isGrokHookInstalled(f)).toBe(false);
    expect(await GK.installGrokHook(base, f)).toEqual({ changed: true });
    expect(await GK.installGrokHook(base, f)).toEqual({ changed: false });
    const j = JSON.parse(readFileSync(f, "utf8"));
    expect(Object.keys(j.hooks)).toEqual(["UserPromptSubmit", "Stop", "StopFailure", "StopCancelled", "Notification"]);
    const cmd = (e: string) => j.hooks[e][0].hooks[0];
    expect(cmd("UserPromptSubmit").command).toBe("'/bin/nookdeck' hook grok busy --port 7500 # nookdeck hook grok");
    for (const e of ["Stop", "StopFailure", "StopCancelled"]) expect(cmd(e).command).toContain("hook grok idle");
    expect(cmd("Notification").command).toContain("hook grok waiting");
    expect(j.hooks.Notification[0].matcher).toBe("idle_prompt|permission_prompt");
    for (const e of Object.keys(j.hooks)) { expect(cmd(e).type).toBe("command"); expect(cmd(e).timeout).toBe(5); }
    expect(await GK.isGrokHookInstalled(f)).toBe(true);
    expect(await GK.uninstallGrokHook(f)).toEqual({ changed: true });
    expect(existsSync(f)).toBe(false);
    writeFileSync(f, '{"hooks":{}}');
    await expect(GK.installGrokHook(base, f)).rejects.toThrow("not written by Nookdeck");
    expect(await GK.uninstallGrokHook(f)).toEqual({ changed: false });
  });
  test("the hook's stdin: camelCase and snake_case", () => {
    expect(GK.grokStateFromStdin('{"sessionId":"g1","cwd":"/p","hookEventName":"stop"}')).toEqual({ sessionId: "g1", cwd: "/p" });
    expect(GK.grokStateFromStdin('{"session_id":"g2"}')).toEqual({ sessionId: "g2" });
    expect(GK.grokStateFromStdin("nope")).toEqual({});
  });
});

describe("rules accept the new providers", () => {
  test("ai-waiting provider: opencode | grok", () => {
    for (const provider of ["opencode", "grok"]) {
      const r = parseRules([{ id: "r", when: { kind: "ai-waiting", provider }, then: [{ kind: "notify", text: "x" }] }] as any);
      expect((r[0]!.when as any).provider).toBe(provider);
    }
    expect(() => parseRules([{ id: "r", when: { kind: "ai-waiting", provider: "nope" }, then: [{ kind: "notify", text: "x" }] }] as any)).toThrow();
  });
});

describe("agent: /api/hooks/state, /api/integrations and the install endpoints", () => {
  let app: any, base = "";
  const dir = tmp();
  const pluginFile = join(dir, "oc-config", "plugins", "nookdeck.js");
  const hookFile = join(dir, "grok", "hooks", "nookdeck.json");
  beforeAll(async () => {
    const { startServer } = await import("../src/server");
    const grokHome = process.env.GROK_HOME!;
    const sd = join(grokHome, "sessions", encodeURIComponent("/work/g"), "gs1");
    mkdirSync(sd, { recursive: true });
    writeFileSync(join(sd, "summary.json"), JSON.stringify({ title: "T", current_model_id: "m", updated_at: new Date().toISOString() }));
    const q = (id: string) => ({ id, name: id, windows: [], updatedAt: 1 });
    app = await startServer({
      port: 0, pin: "777777", hostName: async () => "h", hookSecret: "sec",
      webhookKeyFile: join(dir, "wk"), layoutHistoryDir: join(dir, "hist"),
      opencodePluginFile: pluginFile, grokHookFile: hookFile,
      deps: { runAction: async () => {}, startStats: () => () => {}, setVolume: async () => {}, readVolume: async () => null },
      aiSources: { claude: async () => q("claude"), codex: async () => q("codex"), antigravity: async () => q("antigravity"), sessions: async () => [] } as any,
    } as any);
    base = `http://localhost:${app.port}`;
  });
  afterAll(() => app?.stop());
  const post = (p: string, body: any, headers: any = {}) => fetch(base + p, { method: "POST", headers: { "x-nookdeck-hook": "sec", ...headers }, body: JSON.stringify(body) });

  test("/api/hooks/state: secret, shape and states are checked", async () => {
    expect((await fetch(base + "/api/hooks/state", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await post("/api/hooks/state", { source: "claude", state: "busy", sessionId: "x" })).status).toBe(400);
    expect((await post("/api/hooks/state", { source: "grok", state: "dancing", sessionId: "x" })).status).toBe(400);
    expect(await (await post("/api/hooks/state", { source: "grok", state: "waiting" })).json()).toMatchObject({ ignored: true });
    expect(await (await post("/api/hooks/state", { source: "grok", state: "busy", sessionId: "gs1" })).json()).toEqual({ ok: true });
  });
  test("/api/integrations: opencode and grok blocks", async () => {
    const j = (await (await fetch(base + "/api/integrations")).json()) as any;
    expect(j.grok).toMatchObject({ installed: true /* no binary, but its data dir exists */, sessions: 1, quota: null, quotaReason: expect.stringContaining("grok agent stdio"), hook: { installed: false, path: hookFile } });
    expect(j.opencode).toMatchObject({ installed: false, sessions: 0, quota: null, plugin: { installed: false, path: pluginFile } });
    expect(j.opencode.quotaReason).toBeTruthy();
  });
  test("install / remove the grok hook and the opencode plugin (temp files only)", async () => {
    expect(await (await fetch(base + "/api/integrations/grok/hook", { method: "POST" })).json()).toMatchObject({ ok: true, changed: true, installed: true });
    expect(existsSync(hookFile)).toBe(true);
    expect(readFileSync(hookFile, "utf8")).toContain(`--port ${app.port}`.replace(/^/, ""));
    expect(((await (await fetch(base + "/api/integrations")).json()) as any).grok.hook.installed).toBe(true);
    expect(await (await fetch(base + "/api/integrations/grok/hook", { method: "DELETE" })).json()).toMatchObject({ ok: true, installed: false });
    expect(existsSync(hookFile)).toBe(false);

    const r = (await (await fetch(base + "/api/integrations/opencode/plugin", { method: "POST" })).json()) as any;
    expect(r).toMatchObject({ ok: true, installed: true, line: 1 }); // no opencode on PATH in the test: the 1.x template
    expect(readFileSync(pluginFile, "utf8")).toContain(String(app.port));
    expect(((await (await fetch(base + "/api/integrations")).json()) as any).opencode.plugin.installed).toBe(true);
    expect(await (await fetch(base + "/api/integrations/opencode/plugin", { method: "DELETE" })).json()).toMatchObject({ installed: false });
    expect(existsSync(pluginFile)).toBe(false);
    expect((await fetch(base + "/api/integrations/grok/hook", { method: "POST", headers: { host: "evil.example" } })).status).toBe(403);
  });
  test.skipIf(process.platform === "win32")("a fake opencode 2.x on PATH selects the 2.x template and is reported with its version", async () => {
    const bin = join(dir, "bin"); mkdirSync(bin, { recursive: true });
    const fake = join(bin, process.platform === "win32" ? "opencode.cmd" : "opencode");
    writeFileSync(fake, process.platform === "win32" ? "@echo 2.3.2\r\n" : "#!/bin/sh\necho 2.3.2\n"); chmodSync(fake, 0o755);
    const keep = process.env.NOOKDECK_OPENCODE; process.env.NOOKDECK_OPENCODE = fake;
    try {
      const j = (await (await fetch(base + "/api/integrations")).json()) as any;
      expect(j.opencode).toMatchObject({ installed: true, version: "2.3.2", line: 2 });
      const r = (await (await fetch(base + "/api/integrations/opencode/plugin", { method: "POST" })).json()) as any;
      expect(r.line).toBe(2);
      expect(readFileSync(pluginFile, "utf8")).toContain("form.created");
      await fetch(base + "/api/integrations/opencode/plugin", { method: "DELETE" });
    } finally { if (keep === undefined) delete process.env.NOOKDECK_OPENCODE; else process.env.NOOKDECK_OPENCODE = keep; }
  });
  test("a permission request from the opencode plugin is accepted (source opencode) and shown to phones", async () => {
    const ws = new WebSocket(`ws://localhost:${app.port}/ws?token=${((await (await fetch(base + "/api/pair", { method: "POST", body: JSON.stringify({ pin: "777777", name: "t" }) })).json()) as any).token}`);
    const msgs: any[] = [];
    ws.onmessage = (e) => msgs.push(JSON.parse(String(e.data)));
    await new Promise((r) => (ws.onopen = r as any));
    for (let i = 0; i < 100 && !msgs.some((m) => m.type === "hello"); i++) await Bun.sleep(20);
    const reqP = post("/api/hooks/permission", { source: "opencode", sessionId: "ocs", cwd: "/work/app", toolName: "bash", toolInput: { command: "ls" } });
    const end = Date.now() + 3000;
    let perm: any;
    while (!perm && Date.now() < end) { perm = msgs.find((m) => m.type === "permission"); await Bun.sleep(20); }
    expect(perm.request).toMatchObject({ source: "opencode", project: "app", tool: "bash" });
    ws.send(JSON.stringify({ type: "permission-answer", id: perm.request.id, decision: "allow" }));
    expect(await (await reqP).json()).toEqual({ decision: "allow" });
    ws.close();
  });
});

// The fake CLI is a bash script, which Windows cannot run; the parser and quota shaping are covered on every OS above.
describe.skipIf(process.platform === "win32")("Grok usage through `grok agent stdio` (fake CLI)", () => {
  // a fake grok: newline-delimited JSON-RPC on stdin/stdout; MODE picks the behaviour; every start is logged to $LOG
  const fake = (mode: string, billing: unknown = {}) => {
    const d = tmp();
    const f = join(d, "grok");
    writeFileSync(join(d, "billing.json"), JSON.stringify(billing));
    writeFileSync(f, `#!/bin/bash
echo "$$ $*" >> "${d}/starts.log"
[ "$1 $2" = "agent stdio" ] || exit 2
MODE=${mode}
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\\([0-9]*\\).*/\\1/p')
  case "$line" in
    *'"initialize"'*) echo '{"jsonrpc":"2.0","method":"notice","params":{}}'; echo '{"jsonrpc":"2.0","id":'$id',"result":{"protocolVersion":1,"authMethods":[]}}' ;;
    *'"_x.ai/billing"'*)
      echo "$line" > "${d}/billing-request.json"
      case $MODE in
        ok) echo '{"jsonrpc":"2.0","id":'$id',"result":'"$(cat "${d}/billing.json")"'}' ;;
        nomethod) echo '{"jsonrpc":"2.0","id":'$id',"error":{"code":-32601,"message":"Method not found"}}' ;;
        autherr) echo '{"jsonrpc":"2.0","id":'$id',"error":{"code":-32000,"message":"authentication required, run grok login"}}' ;;
        hang) sleep 60 ;;
        garbage) echo 'not json'; echo '{"jsonrpc":"2.0","id":'$id',"result":' ;;
      esac ;;
  esac
done
`);
    chmodSync(f, 0o755);
    return { f, d };
  };
  const starts = (d: string) => (existsSync(join(d, "starts.log")) ? readFileSync(join(d, "starts.log"), "utf8").trim().split("\n").length : 0);
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

  test("the real Mac payload (grok 1.0.70, Free): a weekly window with no percentage, the plan, no prepaid extra", () => {
    const real = { jsonrpc: "2.0", id: 2, result: { config: { currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-11-11T15:45:58.364+00:00", end: "2026-11-18T15:45:58.364+00:00" }, prepaidBalance: { val: 0 }, isUnifiedBillingUser: true, billingPeriodStart: "2026-11-11T15:45:58.364+00:00", billingPeriodEnd: "2026-11-18T15:45:58.364+00:00" }, subscription_tier: "Free" } };
    const q = GK.grokQuotaFrom(GK.parseGrokBilling(real.result), NOW);
    expect(q).toMatchObject({ id: "grok", plan: "Free", source: "grok-cli" });
    expect(q.windows).toEqual([{ id: "weekly", label: "Weekly", usedPercent: null, resetsAt: Date.parse("2026-11-18T15:45:58.364Z"), windowMinutes: 10080 }]);
    expect(q.extras).toBeUndefined();
    expect(q.error).toBeUndefined();
  });
  test("weekly credits window with a percentage, reset and prepaid balance", () => {
    const q = GK.grokQuotaFrom(GK.parseGrokBilling({ config: { creditUsagePercent: 41.26, currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-11-11T00:00:00Z", end: "2026-11-18T00:00:00Z" }, prepaidBalance: { val: 1250 } }, subscription_tier: "SuperGrok" }), NOW);
    expect(q.plan).toBe("SuperGrok");
    expect(q.windows).toEqual([{ id: "weekly", label: "7 days", usedPercent: 41.3, resetsAt: Date.parse("2026-11-18T00:00:00Z"), windowMinutes: 10080 }]);
    expect(q.extras).toEqual([{ label: "Prepaid balance", value: 12.5, unit: "USD" }]);
    expect(q.error).toBeUndefined();
  });
  test("percentage from onDemandUsed / onDemandCap, and the legacy monthlyLimit / usage.totalUsed shape", () => {
    expect(GK.parseGrokBilling({ config: { onDemandUsed: { val: 250 }, onDemandCap: { val: 1000 }, billingPeriodStart: "2026-11-01T00:00:00Z", billingPeriodEnd: "2026-11-08T00:00:00Z" } })?.window?.usedPercent).toBe(25);
    const legacy = GK.parseGrokBilling({ billingCycle: { billingPeriodStart: "2026-11-01T00:00:00Z", billingPeriodEnd: "2026-12-01T00:00:00Z" }, monthlyLimit: { val: 2000 }, usage: { totalUsed: { val: 500 } } });
    expect(legacy?.window).toMatchObject({ usedPercent: 25, weekly: false });
    expect(GK.parseGrokBilling({})).toBeNull();
    expect(GK.parseGrokBilling(null)).toBeNull();
  });
  test("a real call to a fake CLI: sends initialize then _x.ai/billing with no params; result parsed; cached 5 minutes; the child is gone", async () => {
    GK.resetGrokQuotaCache();
    const { f, d } = fake("ok", { config: { creditUsagePercent: 12, currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-11-11T00:00:00Z", end: "2026-11-18T00:00:00Z" } }, subscription_tier: "SuperGrok" });
    const q = await GK.grokQuota({ now: NOW, bin: f });
    expect(q).toMatchObject({ plan: "SuperGrok", windows: [{ usedPercent: 12 }] });
    expect(JSON.parse(readFileSync(join(d, "billing-request.json"), "utf8"))).toMatchObject({ jsonrpc: "2.0", method: "_x.ai/billing", params: {} });
    expect(starts(d)).toBe(1);
    await GK.grokQuota({ now: NOW + 4 * 60_000, bin: f });
    expect(starts(d)).toBe(1); // cached
    await GK.grokQuota({ now: NOW + 6 * 60_000, bin: f });
    expect(starts(d)).toBe(2); // expired
    await Bun.sleep(200);
    for (const l of readFileSync(join(d, "starts.log"), "utf8").trim().split("\n")) expect(alive(Number(l.split(" ")[0]))).toBe(false);
  });
  test("-32601, an auth error and garbage all give quota null-ish with a reason, never a throw", async () => {
    for (const [mode, text] of [["nomethod", "no usage method"], ["autherr", "authentication required"], ["garbage", "did not answer in time"]] as const) {
      GK.resetGrokQuotaCache();
      const { f } = fake(mode);
      const q = await GK.grokQuota({ now: NOW, bin: f, timeoutMs: 3000 });
      expect(q.windows).toEqual([]);
      expect(q.error).toContain(text);
    }
  });
  test("a CLI that never answers: hard timeout, and the child is killed", async () => {
    GK.resetGrokQuotaCache();
    const { f, d } = fake("hang");
    const t0 = Date.now();
    const q = await GK.grokQuota({ now: NOW, bin: f, timeoutMs: 800 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(q.error).toContain("did not answer in time");
    await Bun.sleep(300);
    for (const l of readFileSync(join(d, "starts.log"), "utf8").trim().split("\n")) expect(alive(Number(l.split(" ")[0]))).toBe(false);
  });
  test("concurrent callers share one in-flight call", async () => {
    GK.resetGrokQuotaCache();
    const { f, d } = fake("ok", { subscription_tier: "Free" });
    const rs = await Promise.all([GK.grokQuota({ now: NOW, bin: f }), GK.grokQuota({ now: NOW, bin: f }), GK.grokQuota({ now: NOW, bin: f })]);
    expect(starts(d)).toBe(1);
    expect(rs[0]).toBe(rs[1]);
  });
});
