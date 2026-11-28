/**
 * Core plugins (spec D2): plugins/core/<name> in this repo, embedded in the binary, trusted, run in the agent with the same
 * PluginContext (src/plugins/api.ts) that community plugins get out of process. They may use `custom:*` renderers: the deck draws
 * its own tile for them. parseManifest never accepts one, so a community plugin cannot.
 * Legacy layout kinds (widget "weather", "quota") map to a core plugin at load time (D7); layout.json is never rewritten.
 */
import weatherManifest from "../../plugins/core/weather/nookdeck.json";
import quotaManifest from "../../plugins/core/quota/nookdeck.json";
import { makeWeatherPlugin, type WeatherDeps } from "../../plugins/core/weather";
import { makeQuotaPlugin, type QuotaDeps } from "../../plugins/core/quota";
import type { Layout, PluginRef } from "../config";
import { EVERY_DEFAULT_S, EVERY_MIN_S, PluginPermissionError, STORAGE_MAX_BYTES, type ActionHandler, type PluginContext, type PluginFetchInit, type PluginModule, type ProvideOptions, type Provider, type Settings, type WidgetUpdate } from "./api";
import type { PushUpdate, TileSize } from "./api";
import { parseManifest, settingFields } from "./manifest";
import type { CustomRenderer, Manifest, WidgetDef } from "./types";

/** Core widgets get their data from code (the plugin's provider), like any code plugin. */
const CODE_SOURCE: WidgetDef["source"] = { agent: {} };

const isRecord = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/** Validates a core manifest: the normal fields through parseManifest (core.* allowed), widgets here because they may use custom:*. */
export function parseCoreManifest(raw: unknown): Manifest {
  if (!isRecord(raw)) throw new Error("a core manifest must be an object");
  const base = parseManifest({ ...raw, widgets: [] }, { allowCore: true });
  if (!base.id.startsWith("core.")) throw new Error(`${base.id}: a core plugin id starts with "core."`);
  const list: unknown[] = raw.widgets === undefined ? [] : Array.isArray(raw.widgets) ? raw.widgets : [];
  const seen = new Set<string>();
  const widgets = list.map((w, i): WidgetDef => {
    if (!isRecord(w) || typeof w.id !== "string" || !/^[a-z0-9_-]{1,48}$/.test(w.id)) throw new Error(`${base.id}: widgets[${i}].id is not valid`);
    if (typeof w.render !== "string" || !/^custom:[a-z0-9_-]{1,32}$/.test(w.render)) throw new Error(`${base.id}: widgets[${i}].render must be custom:<name>`);
    if (seen.has(w.id)) throw new Error(`${base.id}: widget "${w.id}" is used twice`);
    seen.add(w.id);
    const sizes = Array.isArray(w.sizes) && w.sizes.every((s: unknown) => typeof s === "string" && /^\d+x\d+$/.test(s)) ? (w.sizes as string[]) : ["2x1"];
    let preview: unknown;
    if (w.preview !== undefined) {
      const bad = checkCustomPreview(w.render, materializePreview(w.render, w.preview));
      if (bad) throw new Error(`${base.id}: widgets[${i}].preview is not valid ${w.render} data: ${bad}`);
      preview = w.preview;
    }
    return { id: w.id, name: typeof w.name === "string" ? w.name : w.id, render: w.render as CustomRenderer, sizes, settings: settingFields(w.settings, `widgets[${i}].settings`), ...(preview !== undefined ? { preview } : {}), source: CODE_SOURCE };
  });
  return { ...base, widgets };
}

// ---- previews of the custom renderers ----
// A core widget's `preview` is sample data in the LEGACY data shape of its tile (what the deck's quota / weather tile takes), so
// manage can draw the real tile before anything runs. Times are written relative (`resetsInMinutes`, `inHours`, `inDays`) so a
// sample never goes stale; `materializePreview` turns them into the real fields at the moment it is shown.

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The preview with its relative times made absolute (resetsAt in ms, hourly `time` and daily `date` as local ISO text). */
export function materializePreview(render: string, preview: unknown, now = Date.now()): unknown {
  if (!isRecord(preview)) return preview;
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (render === "custom:quota") {
    return { ...preview, updatedAt: now, windows: Array.isArray(preview.windows) ? preview.windows.map((w: any) => {
      if (!isRecord(w)) return w;
      const { resetsInMinutes, ...rest } = w;
      return num(resetsInMinutes) ? { ...rest, resetsAt: now + resetsInMinutes * 60_000 } : rest;
    }) : preview.windows };
  }
  if (render === "custom:weather") {
    return { ...preview, updatedAt: now,
      hourly: Array.isArray(preview.hourly) ? preview.hourly.map((h: any) => {
        if (!isRecord(h)) return h;
        const { inHours, ...rest } = h;
        if (!num(inHours)) return rest;
        const d = new Date(now + inHours * 3_600_000);
        return { ...rest, time: `${day(d)}T${pad(d.getHours())}:00` };
      }) : preview.hourly,
      daily: Array.isArray(preview.daily) ? preview.daily.map((x: any) => {
        if (!isRecord(x)) return x;
        const { inDays, ...rest } = x;
        return num(inDays) ? { ...rest, date: day(new Date(now + inDays * 86_400_000)) } : rest;
      }) : preview.daily };
  }
  return preview;
}

/** Checks a (materialized) custom-renderer sample against the data shape the deck's tile reads. Returns an error text, or null. */
export function checkCustomPreview(render: string, d: unknown): string | null {
  if (!isRecord(d)) return "must be an object";
  const str = (v: unknown) => typeof v === "string" && v.length > 0;
  if (render === "custom:quota") {
    if (!str(d.id) || !str(d.name)) return "needs id and name";
    if (!Array.isArray(d.windows) || !d.windows.length || d.windows.length > 8) return "needs 1 to 8 windows";
    for (const w of d.windows) {
      if (!isRecord(w) || !str(w.id) || !str(w.label) || !num(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100) return "each window needs id, label and usedPercent (0-100)";
      if (w.resetsAt !== undefined && !num(w.resetsAt) && !str(w.resetsAt)) return "resetsAt must be a time";
    }
    return null;
  }
  if (render === "custom:weather") {
    const n = d.now;
    if (!isRecord(n) || !num(n.temp) || !str(n.condition) || !num(n.code) || !str(n.icon)) return "needs now with temp, condition, code and icon";
    if (!Array.isArray(d.hourly) || d.hourly.length > 24 || !Array.isArray(d.daily) || d.daily.length > 10) return "needs hourly (up to 24) and daily (up to 10)";
    for (const h of d.hourly) if (!isRecord(h) || !str(h.time) || !num(h.temp) || !str(h.condition) || !num(h.code) || !str(h.icon)) return "each hour needs time, temp, condition, code and icon";
    for (const x of d.daily) if (!isRecord(x) || !str(x.date) || !num(x.min) || !num(x.max) || !str(x.condition) || !num(x.code) || !str(x.icon)) return "each day needs date, min, max, condition, code and icon";
    if (!str(d.location) || (d.tempUnit !== "c" && d.tempUnit !== "f") || (d.units !== "metric" && d.units !== "imperial") || (d.source !== "hass" && d.source !== "open-meteo")) return "needs location, tempUnit, units and source";
    return null;
  }
  return "has no preview shape";
}

/** What the server hands the core plugins (they are trusted and may use agent services; community plugins cannot). */
export interface CoreServices {
  weather: WeatherDeps;
  quota: QuotaDeps;
  shell?: (cmd: string, timeoutMs: number) => Promise<{ code: number; stdout: string }>;
  keys?: { hotkey(k: string): Promise<void>; type(t: string): Promise<void> };
  fetch?: typeof fetch;
  /** Plugin-level settings of a core plugin (from the store). */
  settings?: (id: string) => Settings;
  log?: (id: string, ...a: unknown[]) => void;
}

export interface CoreEntry { manifest: Manifest; module: PluginModule }

export function loadCorePlugins(s: CoreServices): CoreEntry[] {
  return [
    { manifest: parseCoreManifest(weatherManifest), module: makeWeatherPlugin(s.weather) },
    { manifest: parseCoreManifest(quotaManifest), module: makeQuotaPlugin(s.quota) },
  ];
}

export const CORE_IDS = ["core.weather", "core.quota"] as const;

/** Legacy widget kinds -> the core plugin tile they stand for (D7). Settings are flattened to string/number/boolean. */
export function legacyRef(it: Layout["pages"][number]["items"][number]): PluginRef | null {
  if (it.kind !== "widget") return null;
  // a weather-style clock shows the current conditions next to the time: the same core.weather data, only "now"
  const wxClock = it.widget === "clock" && it.clock?.style === "weather";
  if (it.widget === "weather" || wxClock) {
    const w = (wxClock ? it.clock?.weather : it.weather) ?? {};
    const settings: NonNullable<PluginRef["settings"]> = {};
    if (w.source) settings.source = w.source;
    if (w.entity) settings.entity = w.entity;
    if (w.location) { settings.locationName = w.location.name; settings.lat = w.location.lat; settings.lon = w.location.lon; }
    if (wxClock) settings.show = "now";
    else if (w.show) settings.show = w.show;
    if (w.units) settings.units = w.units;
    return { id: "core.weather", widget: "weather", settings };
  }
  if (it.widget === "quota") {
    const q = it.quota ?? {};
    const settings: NonNullable<PluginRef["settings"]> = { provider: it.provider ?? "claude" };
    if (q.chart) settings.chart = q.chart;
    if (q.windows) settings.windows = Array.isArray(q.windows) ? q.windows.join(",") : q.windows;
    if (q.showReset !== undefined) settings.showReset = q.showReset;
    if (q.account) settings.account = q.account;
    return { id: "core.quota", widget: "quota", settings };
  }
  return null;
}

/** Every plugin tile of a layout by tile id, legacy kinds included. */
export function layoutPluginTiles(layout: Layout): Map<string, PluginRef> {
  const out = new Map<string, PluginRef>();
  for (const p of layout.pages) for (const it of p.items) {
    if (it.kind !== "widget") continue;
    if (it.widget === "plugin") { if (it.plugin) out.set(it.id, it.plugin); continue; }
    const ref = legacyRef(it);
    if (ref) out.set(it.id, ref);
  }
  return out;
}

/** The size in grid cells of every tile that can show a plugin, by tile id. */
export function layoutTileSizes(layout: Layout): Map<string, TileSize> {
  const out = new Map<string, TileSize>();
  for (const p of layout.pages) for (const it of p.items) out.set(it.id, { w: it.w ?? 1, h: it.h ?? 1 });
  return out;
}

interface Registered { fn: Provider; every: number }

/** Runs the core plugins in the agent: builds their PluginContext, keeps their providers, answers `get`. */
export class CoreHost {
  private entries = new Map<string, CoreEntry>();
  private providers = new Map<string, Registered>(); // `${plugin}/${widget}`
  private actions = new Map<string, ActionHandler>();
  private data = new Map<string, Map<string, unknown>>();
  private pushListeners = new Set<(plugin: string, widget: string, u: PushUpdate) => void>();
  private mods: PluginModule[] = [];

  constructor(private services: CoreServices, entries: CoreEntry[] = loadCorePlugins(services)) {
    for (const e of entries) this.entries.set(e.manifest.id, e);
  }

  manifests(): Manifest[] { return [...this.entries.values()].map((e) => e.manifest); }
  has(id: string): boolean { return this.entries.has(id); }
  onPush(fn: (plugin: string, widget: string, u: PushUpdate) => void): () => void { this.pushListeners.add(fn); return () => this.pushListeners.delete(fn); }

  async activate(): Promise<void> {
    for (const e of this.entries.values()) {
      try { await e.module.activate(this.context(e.manifest)); this.mods.push(e.module); }
      catch (err) { this.services.log?.(e.manifest.id, "activate failed", err); }
    }
  }

  async deactivate(): Promise<void> {
    for (const m of this.mods) { try { await m.deactivate?.(); } catch { /* going away */ } }
    this.mods = [];
  }

  /** Seconds between refreshes of a widget (the provider's `every`, 5 s at least). */
  every(plugin: string, widget: string): number { return this.providers.get(`${plugin}/${widget}`)?.every ?? EVERY_DEFAULT_S; }

  /** The widget's update with the manifest's renderer applied (a provider cannot change it). Throws when the provider does. */
  async get(plugin: string, widget: string, tile: Settings = {}, size: TileSize = { w: 1, h: 1 }): Promise<WidgetUpdate> {
    const p = this.providers.get(`${plugin}/${widget}`);
    const def = this.entries.get(plugin)?.manifest.widgets.find((w) => w.id === widget);
    if (!p || !def) throw new Error("plugin widget missing");
    const u = await p.fn({ ...(this.services.settings?.(plugin) ?? {}), ...tile }, { w: size.w, h: size.h });
    return { render: def.render as WidgetUpdate["render"], data: u.data };
  }

  private context(m: Manifest): PluginContext {
    const id = m.id;
    const svc = this.services;
    const store = (this.data.get(id) ?? this.data.set(id, new Map()).get(id))!;
    const ctx: PluginContext = {
      id,
      log: (...a) => { try { svc.log?.(id, ...a); } catch { /* never throws */ } },
      // no core plugin has a select with optionsFrom, nor a WebSocket: these are for community plugins
      settings: { get: () => svc.settings?.(id) ?? {}, options: () => {} },
      storage: {
        async get(key) { return store.has(key) ? JSON.parse(JSON.stringify(store.get(key))) : undefined; },
        async set(key, value) {
          const copy = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
          const next = new Map(store); next.set(key, copy);
          if (JSON.stringify([...next]).length > STORAGE_MAX_BYTES) throw new Error("plugin storage is full");
          store.set(key, copy);
        },
      },
      net: {
        // core plugins are trusted: any https host, no declared-host check (their manifests still list what they use)
        fetch: (url: string, init?: PluginFetchInit) => {
          if (!/^https:\/\//i.test(url)) return Promise.reject(new PluginPermissionError("network", "only https"));
          return (svc.fetch ?? fetch)(url, init);
        },
        websocket: () => Promise.reject(new PluginPermissionError("network", "core plugins do not open WebSockets")),
      },
      widgets: {
        provide: (wid, fn, o?: ProvideOptions) => {
          if (!m.widgets.some((w) => w.id === wid)) throw new Error(`${id}: widget "${wid}" is not in the manifest`);
          this.providers.set(`${id}/${wid}`, { fn, every: Math.max(EVERY_MIN_S, o?.every ?? EVERY_DEFAULT_S) });
        },
        push: (wid, u) => { for (const fn of this.pushListeners) { try { fn(id, wid, u); } catch { /* listener bug */ } } },
      },
      actions: { handle: (aid, fn) => { this.actions.set(`${id}/${aid}`, fn); } },
    };
    if (svc.shell) { const sh = svc.shell; ctx.shell = { run: (cmd) => sh(cmd, 30_000) }; }
    if (svc.keys) ctx.keys = svc.keys;
    return ctx;
  }
}
