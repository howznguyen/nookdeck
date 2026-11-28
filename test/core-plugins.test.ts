import "./_fetch";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// every plugin file goes to a temp dir: never the real ~/.nookdeck
process.env.NOOKDECK_HOME = mkdtempSync(join(tmpdir(), "pd-core-home-"));
const { parseManifest } = await import("../src/plugins/manifest");
const { PluginStore, PluginError } = await import("../src/plugins/store");
const { PluginRuntime } = await import("../src/plugins/runtime");
const { CoreHost, parseCoreManifest, legacyRef, layoutPluginTiles, loadCorePlugins } = await import("../src/plugins/core");
const { weatherOptionsOf } = await import("../plugins/core/weather");
const { materializePreview, checkCustomPreview } = await import("../src/plugins/core");

const tmp = (p = "pd-core-") => mkdtempSync(join(tmpdir(), p));
const newStore = () => { const d = tmp(); return { d, store: new PluginStore({ dir: join(d, "plugins"), stateFile: join(d, "plugins.json"), agentVersion: "0.2.0" }) }; };
const services = (calls: any[] = []) => ({
  weather: { get: async (o: any, _f?: boolean, unit?: string) => { calls.push({ o, unit }); return { temp: 21, location: o.location?.name ?? "auto" } as any; }, tempUnit: () => "c" as const },
  quota: { quota: (p: string) => (p === "claude" ? ({ id: "claude", name: "Claude", windows: [], updatedAt: 1 } as any) : undefined) },
});

describe("core manifests", () => {
  test("core manifests may use custom:*, community manifests may not", () => {
    const raw = JSON.parse(readFileSync(join(import.meta.dir, "..", "plugins/core/weather/nookdeck.json"), "utf8"));
    const m = parseCoreManifest(raw);
    expect(m).toMatchObject({ id: "core.weather" });
    expect(m.widgets[0]!.render).toBe("custom:weather");
    // the community parser still refuses both the id and the renderer
    expect(() => parseManifest(raw)).toThrow("reserved");
    expect(() => parseManifest({ ...raw, id: "dev.x.y", widgets: [{ id: "w", render: "custom:weather", source: { http: { url: "https://a.b/" } } }] })).toThrow("render must be one of");
    expect(() => parseCoreManifest({ ...raw, id: "dev.x.y" })).toThrow();
    expect(() => parseCoreManifest({ ...raw, widgets: [{ id: "w", render: "stat" }] })).toThrow("custom:");
  });
  test("both core plugins ship and parse", () => {
    expect(loadCorePlugins(services() as any).map((e) => e.manifest.id)).toEqual(["core.weather", "core.quota"]);
  });
});

describe("core widget previews", () => {
  const load = (n: string) => JSON.parse(readFileSync(join(import.meta.dir, "..", `plugins/core/${n}/nookdeck.json`), "utf8"));
  test("both shipped manifests carry a preview in the legacy data shape, with demo values", () => {
    const q = parseCoreManifest(load("quota")).widgets[0]!;
    const w = parseCoreManifest(load("weather")).widgets[0]!;
    const mq = materializePreview(q.render, q.preview, 1_000_000) as any;
    expect(checkCustomPreview(q.render, mq)).toBeNull();
    expect(mq).toMatchObject({ id: "claude", plan: "Max" });
    expect(mq.windows.map((x: any) => [x.id, x.usedPercent])).toEqual([["five_hour", 62], ["seven_day", 34]]);
    expect(mq.windows[1].resetsAt).toBe(1_000_000 + 3300 * 60_000); // a reset time, relative to now
    expect(mq.windows[0]).not.toHaveProperty("resetsInMinutes");
    const mw = materializePreview(w.render, w.preview, Date.UTC(2026, 0, 10, 12)) as any;
    expect(checkCustomPreview(w.render, mw)).toBeNull();
    expect(mw).toMatchObject({ location: "Home", now: { temp: 31, condition: "Partly cloudy" } });
    expect(mw.hourly).toHaveLength(6);
    expect(mw.hourly[0].time).toMatch(/^\d{4}-\d\d-\d\dT\d\d:00$/);
    expect(mw.daily[0].date).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(JSON.stringify([q.preview, w.preview])).not.toMatch(/@|email|\.local/); // demo data only
  });
  test("the core parser refuses a preview that is not the legacy shape", () => {
    const m = load("quota");
    m.widgets[0].preview = { id: "claude", name: "Claude", windows: [{ id: "x", label: "x", usedPercent: 400 }] };
    expect(() => parseCoreManifest(m)).toThrow("preview is not valid custom:quota data");
    m.widgets[0].preview = "nope";
    expect(() => parseCoreManifest(m)).toThrow("preview");
    const w = load("weather");
    w.widgets[0].preview = { now: { temp: 1 } };
    expect(() => parseCoreManifest(w)).toThrow("preview is not valid custom:weather data");
  });
  test("the store summary of a built-in plugin carries fresh previews; a community plugin's stay as written", async () => {
    const { store } = newStore();
    await store.load();
    store.registerCore(new CoreHost(services() as any).manifests());
    const before = Date.now();
    const q = store.summary("core.quota")!.widgets[0]!.preview as any;
    expect(q.updatedAt).toBeGreaterThanOrEqual(before);
    expect(q.windows[0].resetsAt).toBeGreaterThan(before);
    expect(checkCustomPreview("custom:weather", store.summary("core.weather")!.widgets[0]!.preview)).toBeNull();
  });
});

describe("legacy widget kinds map to core plugins (D7)", () => {
  const layout: any = { version: 1, pages: [{ id: "p", name: "P", items: [
    { id: "wx", kind: "widget", widget: "weather", weather: { source: "open-meteo", location: { name: "Hue", lat: 16.46, lon: 107.59 }, show: "daily", units: "metric" } },
    { id: "q1", kind: "widget", widget: "quota", provider: "codex" },
    { id: "cpu", kind: "widget", widget: "cpu" },
    { id: "pl", kind: "widget", widget: "plugin", plugin: { id: "dev.a.b", widget: "w" } },
  ] }] };
  test("weather and quota map, everything else does not, and the layout is untouched", () => {
    const before = JSON.stringify(layout);
    expect(legacyRef(layout.pages[0].items[0])).toEqual({ id: "core.weather", widget: "weather", settings: { source: "open-meteo", locationName: "Hue", lat: 16.46, lon: 107.59, show: "daily", units: "metric" } });
    expect(legacyRef(layout.pages[0].items[1])).toEqual({ id: "core.quota", widget: "quota", settings: { provider: "codex" } });
    expect(legacyRef({ id: "q2", kind: "widget", widget: "quota", provider: "claude", quota: { chart: "rings", windows: ["five_hour", "seven_day"], showReset: false, account: "me" } } as any)).toEqual({ id: "core.quota", widget: "quota", settings: { provider: "claude", chart: "rings", windows: "five_hour,seven_day", showReset: false, account: "me" } });
    expect(legacyRef(layout.pages[0].items[2])).toBeNull();
    expect([...layoutPluginTiles(layout).keys()]).toEqual(["wx", "q1", "pl"]);
    expect(JSON.stringify(layout)).toBe(before);
  });
  test("a weather-style clock maps to core.weather showing now, other clocks do not map", () => {
    const clk = { id: "ck", kind: "widget", widget: "clock", clock: { style: "weather", weather: { source: "open-meteo", location: { name: "Hue", lat: 16.46, lon: 107.59 }, show: "daily", units: "imperial" } } } as any;
    expect(legacyRef(clk)).toEqual({ id: "core.weather", widget: "weather", settings: { source: "open-meteo", locationName: "Hue", lat: 16.46, lon: 107.59, show: "now", units: "imperial" } });
    expect(legacyRef({ id: "c0", kind: "widget", widget: "clock", clock: { style: "weather" } } as any)).toEqual({ id: "core.weather", widget: "weather", settings: { show: "now" } });
    expect(legacyRef({ id: "c1", kind: "widget", widget: "clock", clock: { style: "lunar", weather: { source: "hass" } } } as any)).toBeNull();
    expect(legacyRef({ id: "c2", kind: "widget", widget: "clock" } as any)).toBeNull();
    const l: any = { version: 1, pages: [{ id: "p", name: "P", items: [clk, { id: "c2", kind: "widget", widget: "clock" }] }] };
    expect([...layoutPluginTiles(l).keys()]).toEqual(["ck"]);
  });
  test("the flat settings give back the same weather options", () => {
    const o = weatherOptionsOf(legacyRef({ id: "wx", kind: "widget", widget: "weather", weather: { source: "hass", entity: "weather.home", show: "now" } } as any)!.settings as any);
    expect(o).toEqual({ source: "hass", entity: "weather.home", show: "now" });
  });
});

describe("CoreHost", () => {
  test("a provider runs through the PluginContext and the manifest's renderer is applied", async () => {
    const calls: any[] = [];
    const host = new CoreHost(services(calls) as any);
    await host.activate();
    const u = await host.get("core.weather", "weather", { source: "open-meteo", locationName: "Hue", lat: 1, lon: 2 });
    expect(u.render).toBe("custom:weather");
    expect(u.data).toMatchObject({ location: "Hue" });
    expect(calls[0]).toEqual({ o: { source: "open-meteo", location: { name: "Hue", lat: 1, lon: 2 } }, unit: "c" });
    expect(host.every("core.weather", "weather")).toBe(900);
    const q = await host.get("core.quota", "quota", { provider: "claude" });
    expect(q).toMatchObject({ render: "custom:quota", data: { id: "claude" } });
    await expect(host.get("core.quota", "quota", { provider: "nope" })).rejects.toThrow("unknown provider");
    await expect(host.get("core.quota", "nothing")).rejects.toThrow("plugin widget missing");
  });
  test("a plugin cannot register a widget its manifest does not declare", async () => {
    const entries = loadCorePlugins(services() as any);
    entries[0]!.module = { activate: (ctx) => { ctx.widgets.provide("other", () => ({ render: "text", data: {} })); } };
    const logs: any[] = [];
    const host = new CoreHost({ ...(services() as any), log: (...a: unknown[]) => logs.push(a) }, entries);
    await host.activate();
    expect(logs[0]![1]).toBe("activate failed");
  });
  test("push reaches listeners; storage round-trips; net is https only", async () => {
    const entries = loadCorePlugins(services() as any);
    let ctx: any;
    entries[1]!.module = { activate: (c) => { ctx = c; } };
    const host = new CoreHost(services() as any, entries);
    const seen: any[] = [];
    host.onPush((p, w, u) => seen.push([p, w, u.data]));
    await host.activate();
    ctx.widgets.push("quota", { render: "text", data: { n: 1 } });
    expect(seen).toEqual([["core.quota", "quota", { n: 1 }]]);
    await ctx.storage.set("k", { a: 1 });
    expect(await ctx.storage.get("k")).toEqual({ a: 1 });
    await expect(ctx.net.fetch("http://x.example/")).rejects.toThrow("permission denied");
  });
});

describe("built-in plugins in the store", () => {
  test("they are listed as built-in, can be turned off, cannot be removed or installed over, and the choice persists", async () => {
    const { d, store } = newStore();
    await store.load();
    store.registerCore(new CoreHost(services() as any).manifests());
    const w = store.list().find((p) => p.id === "core.weather")!;
    expect(w).toMatchObject({ builtin: true, unreviewed: false, enabled: true, needsApproval: false, source: "built-in" });
    expect(store.runnable("core.weather")).toBe("ok");
    await expect(store.remove("core.weather")).rejects.toBeInstanceOf(PluginError);
    await store.setEnabled("core.weather", false);
    expect(store.runnable("core.weather")).toBe("disabled");
    const file = JSON.parse(readFileSync(join(d, "plugins.json"), "utf8"));
    expect(file.core["core.weather"].enabled).toBe(false);
    expect(file.plugins).toEqual({}); // the plugin itself is never stored
    const again = new PluginStore({ dir: join(d, "plugins"), stateFile: join(d, "plugins.json"), agentVersion: "0.2.0" });
    await again.load();
    again.registerCore(new CoreHost(services() as any).manifests());
    expect(again.runnable("core.weather")).toBe("disabled");
    expect(again.runnable("core.quota")).toBe("ok");
  });
});

describe("runtime serves legacy tiles through the core plugins", () => {
  test("data when on, the plugin's error when off, data again when back on", async () => {
    const { store } = newStore();
    await store.load();
    const host = new CoreHost(services() as any);
    await host.activate();
    store.registerCore(host.manifests());
    const got: any[] = [];
    const rt = new PluginRuntime(store, { fetch: fetch as any, shell: async () => ({ code: 0, stdout: "" }), onItems: (i) => got.push(i), core: host, scale: 0.0001 });
    rt.setLayout({ version: 1, pages: [{ id: "p", name: "P", items: [{ id: "q1", kind: "widget", widget: "quota", provider: "claude" }] }] } as any);
    rt.setActive(true);
    await Bun.sleep(30);
    expect(rt.snapshot().q1).toMatchObject({ render: "custom:quota", data: { id: "claude" } });
    await store.setEnabled("core.quota", false);
    expect(rt.snapshot().q1).toEqual({ error: "plugin disabled" });
    await store.setEnabled("core.quota", true);
    await Bun.sleep(30);
    expect(rt.snapshot().q1).toMatchObject({ render: "custom:quota" });
    rt.stop();
  });
});

describe("server: the legacy weather tile follows core.weather", () => {
  test("data on the old WS message while on, 'plugin disabled' when off, data again when on; layout.json unchanged", async () => {
    const home = process.env.NOOKDECK_HOME!;
    const { startServer } = await import("../src/server");
    const { defaultLayout } = await import("../src/config");
    const q = (id: string) => ({ id, name: id, windows: [], updatedAt: 1 });
    const app: any = await startServer({
      port: 0, pin: "555555", hostName: async () => "my-mac",
      webhookKeyFile: join(home, "webhook-key"), layoutHistoryDir: tmp("pd-core-hist-"),
      plugins: new PluginStore({ dir: join(home, "plugins"), stateFile: join(home, "plugins.json"), agentVersion: "0.2.0" }),
      weatherFetch: async (url: string) => new Response(JSON.stringify({ current: { temperature_2m: 25, weather_code: 0, is_day: 1 }, hourly: { time: [], temperature_2m: [], weather_code: [] }, daily: { time: [], temperature_2m_max: [], temperature_2m_min: [], weather_code: [] } }), { headers: { "content-type": "application/json" } }),
      deps: { runAction: async () => {}, startStats: () => () => {}, setVolume: async () => {}, readVolume: async () => null },
      aiSources: { claude: async () => q("claude"), codex: async () => q("codex"), antigravity: async () => q("antigravity"), sessions: async () => [] },
    } as any);
    try {
      const base = `http://localhost:${app.port}`;
      const layout = { ...defaultLayout(), pages: [{ id: "p", name: "P", items: [{ id: "wx", kind: "widget", widget: "weather", weather: { source: "open-meteo", location: { name: "Hue", lat: 16.46, lon: 107.59 } }, x: 0, y: 0, w: 2, h: 2 }] }] };
      expect((await fetch(`${base}/api/layout`, { method: "PUT", body: JSON.stringify(layout) })).status).toBe(200);
      const token = ((await (await fetch(`${base}/api/pair`, { method: "POST", body: JSON.stringify({ pin: "555555", name: "t" }) })).json()) as any).token;
      const ws = new WebSocket(`ws://localhost:${app.port}/ws?token=${token}`);
      const msgs: any[] = [];
      ws.onmessage = (e) => msgs.push(JSON.parse(String(e.data)));
      const until = async (pred: (m: any) => boolean, ms = 3000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) { const i = msgs.findIndex(pred); if (i >= 0) return msgs.splice(i, 1)[0]; await Bun.sleep(20); }
        throw new Error("timeout; got " + JSON.stringify(msgs.map((m) => [m.type, m.items])));
      };
      expect((await until((m) => m.type === "weather")).items.wx).toMatchObject({ source: "open-meteo", location: "Hue" });
      const list = (await (await fetch(`${base}/api/plugins`)).json()) as any[];
      expect(list.filter((p) => p.builtin).map((p) => p.id).sort()).toEqual(["core.quota", "core.weather"]);
      // GET /api/plugins gives the built-ins' previews (manage draws the real tile from them)
      expect((list.find((p) => p.id === "core.quota").widgets[0].preview).windows[0].resetsAt).toBeGreaterThan(Date.now());
      expect(list.find((p) => p.id === "core.weather").widgets[0].preview.location).toBe("Home");
      await fetch(`${base}/api/plugins/core.weather/enabled`, { method: "POST", body: JSON.stringify({ enabled: false }) });
      expect((await until((m) => m.type === "weather" && m.items.wx.error)).items.wx).toEqual({ error: "plugin disabled" });
      expect((await until((m) => m.type === "plugin" && m.items.wx?.error)).items.wx).toEqual({ error: "plugin disabled" });
      expect((await fetch(`${base}/api/plugins/core.weather`, { method: "DELETE" })).status).toBe(409);
      await fetch(`${base}/api/plugins/core.weather/enabled`, { method: "POST", body: JSON.stringify({ enabled: true }) });
      expect((await until((m) => m.type === "weather" && !m.items.wx.error)).items.wx).toMatchObject({ location: "Hue" });
      // the stored layout still says "weather": nothing was rewritten
      expect(((await (await fetch(`${base}/api/layout`)).json()) as any).pages[0].items[0].widget).toBe("weather");
      ws.close();
    } finally { app.stop(); }
  });
});
