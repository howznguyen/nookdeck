/**
 * All code-plugin processes of the agent: creates one per enabled, granted code plugin when it is first needed, keeps them in step with
 * the store (disable, remove, update, settings change) and answers the runtime's questions (widget data, action runs, status, logs).
 */
import { userHome } from "../home";
import { join } from "node:path";

import { HOME } from "../config";
import { EVERY_DEFAULT_S, type InitResult, type OnAirKind, type Settings, type WidgetUpdate } from "./api";
import type { TileSize, WidgetTile } from "./api";
import { PluginServices, type WebSocketLike } from "./capabilities";
import { PluginLog, PluginProcess, hostArgv, realSpawn, type ProcessInfo, type SpawnFn } from "./process";
import type { PluginStore } from "./store";
import { resolveSettings, type SourceDeps } from "./sources";

/** A plugin that must keep running without a phone asking: it reports On Air or sends notifications (reminders, a timer's end). */
/**
 * What `ctx.settings.get()` returns: the plugin's saved settings over the manifest defaults, coerced like a provider's, so a
 * plugin with nothing saved yet sees `{ coins: "BTC, ETH, SOL" }` rather than `{}`.
 */
export const ownSettings = (e: { manifest: { settings: Parameters<typeof resolveSettings>[0] }; state: { settings?: Parameters<typeof resolveSettings>[1][number] } } | undefined): Settings =>
  e ? resolveSettings(e.manifest.settings, [e.state.settings]) : {};

const alwaysOn = (g: { onair?: boolean; notify?: boolean } | null | undefined): boolean => !!(g?.onair || g?.notify);

export interface HostsDeps extends SourceDeps {
  keys: { hotkey(k: string): Promise<void>; type(t: string): Promise<void> };
  spawn?: SpawnFn;
  /** Overrides the host command line (tests run their own fake or a short-timeout setup). */
  argv?: (dir: string) => string[];
  logDir?: string;
  dataDir?: string;
  timing?: Partial<Pick<ConstructorParameters<typeof PluginProcess>[0], "pingIntervalMs" | "pingTimeoutMs" | "callTimeoutMs" | "idleStopMs" | "backoffMs" | "restartResetMs" | "restartMax">>;
  /** On Air, for plugins granted `onair` (ctx.onair.set). `clear` = this plugin reports nothing any more (stopped, disabled, revoked). */
  onair?: { set(pluginId: string, kind: OnAirKind, on: boolean, since?: number): void; clear(pluginId: string): void };
  /** Notifications for plugins granted `notify` (ctx.notify), already checked and limited. */
  notify?: (pluginId: string, n: { title: string; body?: string; level?: "info" | "warn" | "alert"; sound?: string }) => void;
  /** Client WebSockets for ctx.net.websocket (tests); the runtime's WebSocket otherwise. */
  websocket?: (url: string, protocols: string[]) => WebSocketLike;
}

interface Slot { proc: PluginProcess; version: string; sha: string; settingsJson: string; every: Record<string, number>; log: PluginLog }

export class PluginHosts {
  private slots = new Map<string, Slot>();
  private pushFns = new Set<(pluginId: string, widgetId: string, update: WidgetUpdate, key?: string) => void>();
  private tilesFn: ((pluginId: string, widgetId: string) => WidgetTile[]) | undefined;
  private registeredFns = new Set<(pluginId: string) => void>();
  private failedFns = new Set<(pluginId: string, message: string) => void>();
  readonly logDir: string;
  readonly dataDir: string;

  constructor(private store: PluginStore, private deps: HostsDeps) {
    this.logDir = deps.logDir ?? join(HOME, "logs", "plugins");
    this.dataDir = deps.dataDir ?? join(HOME, "plugins-data");
    store.onChange(() => void this.reconcile());
  }

  /**
   * Plugins granted `onair` report live state, and plugins granted `notify` send reminders, even with no phone open or with the
   * phone asleep: start them now (the agent calls this once it is up), and never stop them as idle.
   */
  startEager(): void {
    for (const id of this.store.ids()) {
      if (!alwaysOn(this.store.entry(id)?.state.granted)) continue;
      const s = this.slot(id);
      s?.proc.ensureStarted().catch((e) => s.log.append(`[agent] start failed: ${e?.message ?? e}`));
    }
  }

  /** The choices of a select with optionsFrom, from the plugin's code (ctx.settings.options). Throws a short message. */
  async options(id: string, providerId: string, settings: Settings): Promise<string[]> {
    const s = this.slot(id);
    if (!s) throw new Error("plugin not running");
    return s.proc.call<string[]>("settings.options", { id: providerId, settings });
  }

  onPush(fn: (pluginId: string, widgetId: string, update: WidgetUpdate, key?: string) => void): void { this.pushFns.add(fn); }
  /** Who knows the layout: answers for the tiles a widget has now. */
  setTiles(fn: (pluginId: string, widgetId: string) => WidgetTile[]): void { this.tilesFn = fn; }
  /** A host (re)started and told which widgets it serves (and how often). */
  onRegistered(fn: (pluginId: string) => void): void { this.registeredFns.add(fn); }
  onFailed(fn: (pluginId: string, message: string) => void): void { this.failedFns.add(fn); }

  private log(id: string): PluginLog { return new PluginLog(join(this.logDir, `${id}.log`)); }

  /** The slot of a plugin that may run code now; undefined for a no-code, missing, disabled or not granted plugin. */
  private slot(id: string): Slot | undefined {
    const e = this.store.entry(id);
    if (!e || !e.manifest.main || this.store.runnable(id) !== "ok") return undefined;
    const have = this.slots.get(id);
    if (have && have.sha === e.state.sha256 && have.version === e.state.version) return have;
    if (have) void have.proc.stop();
    const dir = this.store.dirOf(id);
    const log = this.log(id);
    const services = new PluginServices({
      granted: () => this.store.entry(id)?.state.granted ?? null,
      fetch: this.deps.fetch, shell: this.deps.shell, keys: this.deps.keys,
      dataFile: join(this.dataDir, `${id}.json`),
      ...(this.deps.websocket ? { websocket: this.deps.websocket } : {}),
      onair: (kind, on, since) => this.deps.onair?.set(id, kind, on, since),
      notify: (n) => this.deps.notify?.(id, n),
    });
    const slot: Slot = {
      version: e.state.version, sha: e.state.sha256, settingsJson: JSON.stringify(ownSettings(e)), every: {}, log,
      proc: new PluginProcess({
        id, dir, entry: join(dir, e.manifest.main), version: e.state.version, log, services,
        spawn: this.deps.spawn ?? realSpawn,
        argv: this.deps.argv ? this.deps.argv(dir) : hostArgv(dir),
        granted: () => this.store.entry(id)?.state.granted ?? { network: [] },
        settings: () => ownSettings(this.store.entry(id)),
        onPush: ({ widgetId, update, key }) => { for (const f of this.pushFns) f(id, widgetId, update, key); },
        tiles: (widgetId) => this.tilesFn?.(id, widgetId) ?? [],
        onRegistered: (r: InitResult) => {
          slot.every = r.every ?? {};
          // the manifest says the code serves these; a missing provide()/handle() is the author's bug: say so in the plugin's log
          const m = this.store.entry(id)?.manifest;
          for (const w of m?.widgets ?? []) if ("agent" in w.source && !r.widgets.includes(w.id)) log.append(`[agent] warning: widget "${w.id}" has no ctx.widgets.provide("${w.id}", ...)`);
          for (const a of m?.actions ?? []) if ("agent" in a.run && !r.actions.includes(a.id)) log.append(`[agent] warning: action "${a.id}" has no ctx.actions.handle("${a.id}", ...)`); for (const f of this.registeredFns) f(id); },
        onFailed: (m) => { for (const f of this.failedFns) f(id, m); },
        onEnded: () => this.deps.onair?.clear(id),
        keepAlive: () => alwaysOn(this.store.entry(id)?.state.granted),
        ...this.deps.timing,
      }),
    };
    this.slots.set(id, slot);
    return slot;
  }

  /** Refresh interval (seconds) the plugin asked for in provide(), else the manifest's, else the default. */
  every(id: string, widgetId: string): number {
    const fromCode = this.slots.get(id)?.every[widgetId];
    if (fromCode) return fromCode;
    const w = this.store.entry(id)?.manifest.widgets.find((x) => x.id === widgetId);
    return (w && "agent" in w.source ? w.source.agent.every : undefined) ?? EVERY_DEFAULT_S;
  }

  /** Data for a widget. Throws an Error with a short message the owner can read. */
  async widget(id: string, widgetId: string, settings: Settings, tile: TileSize = { w: 1, h: 1 }): Promise<WidgetUpdate> {
    const s = this.slot(id);
    if (!s) throw new Error("plugin not running");
    return s.proc.call<WidgetUpdate>("widget.get", { id: widgetId, settings, tile });
  }

  async action(id: string, actionId: string, settings: Settings): Promise<void> {
    const s = this.slot(id);
    if (!s) throw new Error("plugin not running");
    await s.proc.call<null>("action.run", { id: actionId, settings });
  }

  info(id: string): ProcessInfo {
    return this.slots.get(id)?.proc.info() ?? { state: "stopped", restarts: 0 };
  }

  logs(id: string, lines = 50): string[] { return this.log(id).tail(lines); }

  /** An agent line in a plugin's log. */
  note(id: string, line: string): void { this.log(id).append(line); }

  async restart(id: string): Promise<void> {
    const s = this.slots.get(id);
    if (s) { await s.proc.restart(); this.slots.delete(id); }
    // started again by the next call; a runtime refresh asks for it now
    for (const f of this.registeredFns) f(id);
  }

  async stop(id: string): Promise<void> {
    const s = this.slots.get(id);
    if (s) await s.proc.stop();
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.slots.values()].map((s) => s.proc.stop()));
    this.slots.clear();
  }

  /** The store changed: stop what may no longer run, tell running plugins about new settings. A changed install restarts lazily. */
  private async reconcile(): Promise<void> {
    for (const [id, s] of [...this.slots]) {
      const e = this.store.entry(id);
      if (!e || !e.manifest.main || this.store.runnable(id) !== "ok" || e.state.sha256 !== s.sha || e.state.version !== s.version) {
        this.slots.delete(id);
        await s.proc.stop();
        continue;
      }
      if (!e.state.granted?.onair) this.deps.onair?.clear(id);
      const own = ownSettings(e);
      const json = JSON.stringify(own);
      if (json !== s.settingsJson) { s.settingsJson = json; s.proc.notifySettings(own); }
    }
    this.startEager(); // a plugin just enabled or granted onair starts without waiting for a phone
  }

  /** Where plugin files live, for the CLI messages. */
  static homeHint = () => join(userHome(), ".nookdeck");
}
