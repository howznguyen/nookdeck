import type { Server, ServerWebSocket } from "bun";
import { HOME, PLUGIN_ID_RE, loadDevices, loadLayout, saveDevices, saveLayout, validateLayout, type Action, type Layout } from "./config";
import { resolveAsset } from "./assets";

/** Embedded text assets served gzipped when the client accepts it; compressed once and kept (they never change). */
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|manifest\+json)|image\/svg\+xml)/;
const gzCache = new Map<string, Uint8Array>();
import { defaultAddress, isLocal, lanIp, localHostName, localResolves, ownNetworks, phoneAddresses, tailnetName } from "./net";
import { Pairing, cookieToken, expiryFrom, tokenCookie, withDevicesLock } from "./pairing";
import { SOUND_MAX, SOUND_TYPES, SoundLibrary, SoundPlayer, bareId, SOUND_ID_HEX, type SpawnFn } from "./sounds";
import type { HassLike } from "./automation-types";
import { HassClient } from "./hass/client";
import { HassConfigStore } from "./hass/config";
import { OnAir } from "./onair";
import { MicControl, avProbe, cameraToggle, type AvPlatform } from "./mic-camera";
import { HassOAuth } from "./hass/oauth";
import { cameraTiles, wantedEntities } from "./hass/entities";
import { entityPress } from "./hass/press";
import { CAMERA_ENTITY_RE, CameraError } from "./hass/camera";
import { planControl } from "./hass/control";
import { tempUnitOf } from "./temperature";
import { PUSH_KEY_RE } from "./automation";
import { RuleEngine } from "./rules";
import { WeatherService } from "./weather";
import { NotificationStore, PushStore, WebhookKey, parsePushBody, webhookExamples, type NotifyLevel } from "./webhooks";
import { abortableSleep, runMacro, type MacroCtx } from "./macro";
import { hostAllowed, localRequestError, originAllowed, phoneNames } from "./guard";
import { LayoutHistory } from "./layout-history";
import { Icons, IMG_ID_RE, BUNDLE_ID_RE, UPLOAD_MAX } from "./icons";
import { QuotaHistory } from "./ai/history";
import { CATALOG, DECK_BUILD } from "./assets.gen";
import { NEAR_END_MS, NEAR_END_S, LastMediaStore, MediaTracker, openMediaApp as realOpenMediaApp, parseControl, resumeMedia as realResumeMedia, type MediaApp, type RawMedia } from "./media";
import type { Stats } from "./stats";
import type { VolumeChange, VolumeState } from "./actions";
import { AiHub, QUOTA_SOURCE, realAiSources, type AiProviderId, type AiSources } from "./ai";
import { ACCOUNT_TOOLS, AccountStore, type AccountTool } from "./ai/accounts";
import { claudeDir } from "./ai/claude";
import { codexDir } from "./ai/codex";
import { agyPath } from "./ai/antigravity";
import { findCli } from "./ai/find-cli";
import { ToolStates, type ToolState } from "./ai/states";
import { detectOpencode, opencodeDataFound, installPlugin, isPluginInstalled, opencodePath, pluginPath, readOpencodeSessions, uninstallPlugin } from "./ai/opencode";
import { UpdateChecker } from "./update";
import { grokDataFound, grokQuota, grokHookFile, grokPath, installGrokHook, isGrokHookInstalled, readGrokSessions, uninstallGrokHook } from "./ai/grok";
import { PermissionBroker, ensureHookSecret, parseHookInput, secretMatches, PERMISSION_TIMEOUT_MS } from "./permissions";
import { classifyRisk } from "./risk";
import { askHookCommand, hookCommand, hookConfigPath, installAskHook, installHook, isAskHookInstalled, isHookInstalled, uninstallAskHook, uninstallHook, type HookTool } from "./hooks-install";
import { AWAY_IDLE_SECONDS, AskSettingsStore, QUESTION_TIMEOUT_MS, QuestionBroker, parseQuestionInput, readIdleSeconds } from "./questions";
import { parseProcessesRequest, topProcesses as realTopProcesses, type ProcessInfo, type ProcessSort } from "./processes";
import { setLanguage, t } from "./i18n";
import { describeRequest, macIdentifier, realProbes, runDoctor, tccServiceFor, type DoctorReport, type Probes } from "./doctor";

/** One mDNS query to 224.0.0.251:5353: enough for macOS to list this binary under Local Network and show its prompt. */
async function touchLocalNetwork(): Promise<void> {
  // DNS header (1 question) + "_services._dns-sd._udp.local" PTR IN
  const q = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
  for (const label of ["_services", "_dns-sd", "_udp", "local"]) { q.push(label.length); for (const ch of label) q.push(ch.charCodeAt(0)); }
  q.push(0, 0, 12, 0, 1);
  const sock = await Bun.udpSocket({});
  try { sock.send(new Uint8Array(q), 5353, "224.0.0.251"); } finally { setTimeout(() => sock.close(), 500); }
}
import { currentInstance } from "./service";
import { platform } from "./platform";
import { automaticScreenshotTool, installedScreenshotApps, resolveScreenshot } from "./screenshot";
import { userHome } from "./home";
import { screenshotToolsFor } from "../web/shared/screenshot";
import pkg from "../package.json" with { type: "json" };
import { aboutInfo, compatVersion } from "./about";
import { AndroidUsb, releaseApk } from "./android/usb";
import { osId } from "./android/adb";
import { PluginStore, PluginError } from "./plugins/store";
import { PluginRuntime, realShell } from "./plugins/runtime";
import { PluginHosts, type HostsDeps } from "./plugins/hosts";
import { CoreHost, legacyRef } from "./plugins/core";
import { Registry, compareVersions, type RegistryEntry } from "./plugins/registry";
import { ThemeRegistry } from "./plugins/theme-registry";
import { BUILTIN_THEMES } from "./plugins/builtin-themes";
import { ThemeStore, THEME_MIME, isLicenseFile, applyLook, buildThemePackage, extractLook, manifestSummary } from "./plugins/themes";
import { isLockAction, sleepTargets } from "../web/shared/lock";
import { ThemePreviewCache } from "./plugins/theme-preview";
import { zipFiles } from "./plugins/cli";
import { ERR_DISABLED, ERR_MISSING, ERR_NOT_GRANTED } from "./plugins/types";
import type { SourceDeps } from "./plugins/sources";
import { forbiddenPage, pickLanguage, wantsPage } from "./forbidden-page";
import { layoutFrames, unusualClose } from "./ws-frames";
import { DropLog, buildReport, windowsVersion } from "./report";
import { VisitorLog } from "./visitors";
import { homedir, hostname as osHostname, release as osRelease, userInfo } from "node:os";
import { join } from "node:path";

export type { Stats };

export interface Deps {
  runAction: (a: Action) => Promise<void>;
  startStats: (onTick: (s: Stats) => void, intervalMs?: number) => () => void;
  setVolume: (v: VolumeChange) => Promise<void>;
  /** Fresh volume read, used to push the new value right after a change. */
  readVolume: () => Promise<VolumeState | null>;
  readMedia: () => Promise<RawMedia | null>;
  fetchArtwork: (raw: RawMedia) => Promise<string | undefined>;
  /** User-initiated: play, launching the last app if no player is running. */
  resumeMedia: (lastApp?: string) => Promise<void>;
  /** User-initiated: launch/activate a player without playing. */
  openMediaApp: (app: MediaApp) => Promise<void>;
  topProcesses: (sort: ProcessSort, limit: number) => Promise<ProcessInfo[]>;
}

export interface StartOptions {
  port?: number;
  hostname?: string;
  deps?: Partial<Deps>;
  pin?: string;
  onPinChange?: (pin: string) => void;
  /** Media poll interval while a socket is connected (default 1500 ms). */
  mediaPollMs?: number;
  /** last-media.json location (tests: a temp file). */
  lastMediaFile?: string;
  /** quota-history.json location (tests: a temp file). */
  quotaHistoryFile?: string;
  /** App/icon service (tests: fake sips/plutil and temp dirs). */
  icons?: Icons;
  /** Home Assistant client (built separately); weather, hass actions, macros and rules use it when present. */
  hass?: HassLike;
  /** Where the Home Assistant url and tokens are kept (tests use a temp dir and no Keychain). */
  hassStore?: HassConfigStore;
  /** fetch for the Home Assistant sign-in calls (tests). */
  hassFetch?: typeof fetch;
  /** Webhook key file (tests). */
  webhookKeyFile?: string;
  /** Mic / camera / front app access for On Air and the Mic and Camera buttons (tests: a fake). */
  av?: AvPlatform;
  /** On Air settings file, and the file that keeps a mic volume to restore (tests: temp paths). */
  onairFile?: string;
  micSavedFile?: string;
  /** On Air mic / camera poll interval (tests). */
  onairPollMs?: number;
  /** fetch for Open-Meteo (tests). */
  weatherFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Weather refresh while phones are connected, default 15 min. */
  weatherMs?: number;
  /** Rules time/idle tick, default 30 s. */
  rulesTickMs?: number;
  /** Soundboard library (tests: temp home and fake afinfo). */
  sounds?: SoundLibrary;
  /** How sound player processes are started (tests: a fake; never plays audio). */
  soundSpawn?: SpawnFn;
  /** Which player programs exist (tests: so the Linux player does not depend on paplay/aplay being installed). */
  soundWhich?: (name: string) => string | null;
  /** tests: the MagicDNS name, the interface table and the mDNS check */
  tailnetName?: () => Promise<string | null>;
  interfaces?: () => NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]>;
  localResolves?: (name: string) => Promise<boolean>;
  /** Machine name for the .local address (tests). */
  hostName?: () => Promise<string>;
  /** layout-history folder (tests: a temp dir). */
  layoutHistoryDir?: string;
  /** Quota/session sources (fakes in tests). */
  aiSources?: AiSources;
  aiSessionsMs?: number; // default 5000
  /** Extra Claude accounts / Codex profiles file (tests). */
  aiAccountsFile?: string;
  aiQuotaMs?: number; // how often to check quota staleness, default 60000 (a real fetch happens every 5 min)
  permissionTimeoutMs?: number;
  hookSecret?: string;
  /** Hook config file per tool (defaults to the real ~/.claude/settings.json and ~/.codex/hooks.json: tests must override). */
  hookPaths?: Partial<Record<HookTool, string>>;
  /** Where the OpenCode plugin / the Grok hook file go (tests point these into a temp dir). */
  opencodePluginFile?: string;
  /** Tests: a checker with a fake release lookup. */
  updateChecker?: import("./update").UpdateChecker;
  grokHookFile?: string;
  /** Claude's questions on the phone: settings file, idle-time reader (seconds, null = unknown) and timeout (tests). */
  askSettingsFile?: string;
  /** Probes for GET /api/doctor (fakes in tests: the real ones ask macOS). */
  doctorProbes?: Probes;
  /** How long a doctor report is reused (default 30 s; 0 with fake probes so tests see every change). */
  doctorCacheMs?: number;
  /** How long GET /api/doctor waits for the first Claude quota read (default 5000). */
  doctorWaitMs?: number;
  idleSeconds?: () => Promise<number | null>;
  questionTimeoutMs?: number;
  /** Plugin store and the network/shell the plugins use (tests: temp dirs and fakes). */
  plugins?: PluginStore;
  /** The community registry (tests: a fake address or fetch). */
  registry?: Registry;
  /** Installed theme packages (tests: a temp folder). */
  themes?: ThemeStore;
  /** The theme registry (tests: a fake fetch). */
  themeRegistry?: ThemeRegistry;
  /** Packs not installed yet, cached for the live preview (tests: a temp folder and a fake download). */
  themePreviews?: ThemePreviewCache;
  pluginDeps?: Partial<SourceDeps>;
  /** Code plugins (tests: fake spawn, temp log/data folders, short timers). */
  pluginHostDeps?: Partial<HostsDeps>;
}

interface WsData {
  deviceId: string | null;
  /** this phone keeps the full-screen ON AIR sign on (onair-watch), so mic / camera are checked */
  onairWatch?: boolean;
  /** this phone's screen in CSS px, as the deck reports it (the manage page previews at it) */
  viewport?: { w: number; h: number };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * Reads and drops a request body (up to 16 MB) before an early error reply. Answering while the client is still sending
 * can make the connection reset mid-upload, and the client then fails with "Unable to connect" instead of seeing the status.
 */
async function drainBody(req: Request): Promise<void> {
  if (Number(req.headers.get("content-length") ?? 0) > 16 * 1024 * 1024) return;
  try { await req.arrayBuffer(); } catch { /* the client went away */ }
}

export async function startServer(opts: StartOptions = {}) {
  // Real modules are loaded lazily so tests can inject fakes without them.
  const actions = opts.deps?.runAction && opts.deps.setVolume && opts.deps.readVolume ? undefined : await import("./actions");
  const media = opts.deps?.readMedia && opts.deps.fetchArtwork ? undefined : await import("./media");
  const deps: Deps = {
    runAction: opts.deps?.runAction ?? actions!.runAction,
    startStats: opts.deps?.startStats ?? (await import("./stats")).startStats,
    setVolume: opts.deps?.setVolume ?? actions!.setVolume,
    readVolume: opts.deps?.readVolume ?? actions!.readVolume,
    readMedia: opts.deps?.readMedia ?? media!.readMedia,
    fetchArtwork: opts.deps?.fetchArtwork ?? media!.fetchArtwork,
    resumeMedia: opts.deps?.resumeMedia ?? realResumeMedia,
    openMediaApp: opts.deps?.openMediaApp ?? realOpenMediaApp,
    topProcesses: opts.deps?.topProcesses ?? realTopProcesses,
  };
  const toolStates = new ToolStates();
  // several Claude accounts / Codex profiles (PhoneBox #538, #633): extra config folders, read-only
  const aiAccounts = new AccountStore({ claude: claudeDir, codex: codexDir }, opts.aiAccountsFile);
  await aiAccounts.load();
  const baseSources = opts.aiSources ?? realAiSources(toolStates, aiAccounts);
  const quotaHistory = new QuotaHistory(opts.quotaHistoryFile);
  await quotaHistory.load();
  const hub = new AiHub(baseSources, undefined, quotaHistory);
  const hookSecret = opts.hookSecret ?? (await ensureHookSecret());
  // the integrations blocks for the two newer tools (read-only facts about the local install)
  const opencodeBlock = async (quota: any) => {
    const bin = opencodePath();
    const v = await detectOpencode(undefined, bin);
    const sessions = readOpencodeSessions().length;
    const everything = readOpencodeSessions(undefined, Date.now(), 500, Number.POSITIVE_INFINITY);
    const last = everything[0];
    const noQuota = !v || v.major < 2;
    return {
      // a binary outside PATH (~/.opencode/bin ...) counts, and so does its data directory
      installed: bin !== null || opencodeDataFound(), ...(bin ? { binary: bin } : {}), ...(v ? { version: v.version, line: v.major } : {}), sessions, total: everything.length,
      ...(last ? { lastSessionAt: last.updatedAt } : {}), sessionsRule: "top-level sessions updated in the last 7 days, newest first",
      quota: noQuota ? null : quota,
      ...(noQuota ? { quotaReason: v ? "OpenCode 1.x has no usage limits (cost and tokens are shown per session)" : bin ? "could not read the OpenCode version" : "OpenCode was not found" } : {}),
      plugin: { installed: await isPluginInstalled(opts.opencodePluginFile ?? pluginPath()), path: opts.opencodePluginFile ?? pluginPath() },
    };
  };
  const grokBlock = async () => {
    const bin = grokPath();
    const recent = await readGrokSessions();
    const all = await readGrokSessions({ windowMs: Number.POSITIVE_INFINITY, limit: 500 });
    return {
    installed: bin !== null || grokDataFound(), ...(bin ? { binary: bin } : {}), sessions: recent.length, total: all.length, running: recent.filter((s) => s.running).length,
    ...(all[0] ? { lastSessionAt: all[0].updatedAt } : {}), sessionsRule: "sessions updated in the last 7 days, newest first; idle unless active_sessions.json lists them (running) or a hook reports busy/waiting",
    quota: await grokQuota().then((q) => (q.windows.length || q.plan ? q : null)).catch(() => null),
    quotaReason: "Usage comes from the Grok CLI itself (grok agent stdio, an internal and undocumented method); Nookdeck never reads your Grok login or cookies",
    hook: { installed: await isGrokHookInstalled(opts.grokHookFile ?? grokHookFile()), path: opts.grokHookFile ?? grokHookFile() },
    };
  };
  const updates = opts.updateChecker ?? new UpdateChecker();
  const pathFor = (t: HookTool) => opts.hookPaths?.[t] ?? hookConfigPath(t);
  let layout: Layout = await loadLayout();
  setLanguage(layout.theme?.language);
  const icons = opts.icons ?? new Icons({ catalog: async () => (CATALOG ? Bun.file(CATALOG.path).text() : null) });
  /** Icons the phone cannot draw by itself (catalog SVGs, app icons, uploads), recomputed on every layout change. */
  /** The layout's icon assets plus the icon pack of the applied theme (keys `pack:<name>`, which the deck prefers over its built-in icons). */
  const cssReferences = (css: string, file: string): boolean => css.includes(file);
  const layoutAssetsAll = async (l: Layout): Promise<Record<string, any>> => {
    const base: Record<string, any> = await icons.layoutAssets(l).catch(() => ({}));
    const pack = l.theme?.source?.pack.split("@")[0];
    if (pack) Object.assign(base, await themeStore.packIcons(pack).catch(() => ({})));
    return base;
  };
  let layoutAssets: Record<string, any> = await icons.layoutAssets(layout).catch(() => ({}));
  /** The layout and its icons as WebSocket messages (big icon maps go in parts first: see ws-frames.ts). */
  const sendLayout = (ws: ServerWebSocket<WsData>) => { try { for (const f of layoutFrames(layout, layoutAssets)) ws.send(f); } catch {} };
  const broadcastLayout = () => { const frames = layoutFrames(layout, layoutAssets); for (const ws of sockets) { try { for (const f of frames) ws.send(f); } catch {} } syncOnAirNeed(); };
  let catalogGz: Uint8Array | undefined;
  const sounds = opts.sounds ?? new SoundLibrary();
  const player = new SoundPlayer({ spawn: opts.soundSpawn, which: opts.soundWhich, onChange: (ids) => broadcast({ type: "sounds-playing", ids }) });
  const history = new LayoutHistory(opts.layoutHistoryDir);
  // the layout in force is always the newest history entry (so the first undo has something to go back to)
  await history.push(layout).catch(() => {});
  const sockets = new Set<ServerWebSocket<WsData>>();
  const drops = new DropLog();
  const visitors = new VisitorLog();
  const startedAt = Date.now();
  const pairing = new Pairing(opts.onPinChange, opts.pin);

  const send = (ws: ServerWebSocket<WsData>, msg: unknown) => {
    try { ws.send(JSON.stringify(msg)); } catch {}
  };
  const broadcast = (msg: unknown) => {
    for (const ws of sockets) send(ws, msg);
  };


  // ----- automation: pushed values, notifications, macros, rules, weather -----
  // Home Assistant: the real client stays idle until a url and token are configured (then it connects and reconnects by itself)
  const hassStore = opts.hassStore ?? new HassConfigStore();
  const hassClient: HassClient | undefined = opts.hass ? (opts.hass instanceof HassClient ? opts.hass : undefined) : new HassClient({ store: hassStore, oauth: new HassOAuth({ store: hassStore, fetch: opts.hassFetch }), fetch: opts.hassFetch });
  const hass: HassLike = opts.hass ?? hassClient!;
  const syncHass = () => hassClient?.setWanted(wantedEntities(layout));
  syncHass();
  hassClient?.onEntities((changed) => broadcast({ type: "hass", entities: changed, connected: hassClient.connected() }));
  let hassWasConnected = false;
  hassClient?.onStatus((st) => {
    broadcast({ type: "hass", entities: {}, connected: st.connected });
    // weather tiles on "auto" depend on whether Home Assistant is there: re-evaluate when that changes
    if (st.connected !== hassWasConnected) { hassWasConnected = st.connected; if (sockets.size) void pushWeather(); }
  });
  if (hassClient) void hassClient.start().catch((e) => console.error("hass", e));
  const webhookKey = new WebhookKey(opts.webhookKeyFile);
  // On Air (spec obs-integration-and-on-air FR-5..12): OBS live, mic / camera in use, the manual button and the API. Mic and
  // camera are read only while a phone shows something that uses them (NFR-4); the apps using them stay here (NFR-3).
  const av: AvPlatform = opts.av ?? {
    id: platform.id,
    avUsage: (p) => platform.avUsage(p), readMic: () => platform.readMic(), setMicMuted: (m) => platform.setMicMuted(m),
    setMicVolume: (l) => platform.setMicVolume(l), frontApp: (w) => platform.frontApp(w), activateApp: (id) => platform.activateApp(id),
    runningApps: (ids) => platform.runningApps(ids), runAction: (a) => deps.runAction(a),
  };
  const onair = new OnAir({ probe: avProbe(av), settingsFile: opts.onairFile ?? join(HOME, "onair.json"), onChange: (m) => broadcast(m), pollMs: opts.onairPollMs });
  await onair.load();
  const micControl = new MicControl(av, opts.micSavedFile ?? join(HOME, "mic-restore.json"));
  void micControl.restore().catch(() => {}); // a volume left at 0 by a crash comes back (NFR-6)
  const AV_ACTIONS = ["onair", "mic", "camera"];
  function syncOnAirNeed(): void {
    let need = false;
    if (sockets.size) {
      for (const ws of sockets) if (ws.data.onairWatch) need = true;
      if (!need) need = layout.pages.some((p) => p.items.some((it) => (it.kind === "widget" && it.widget === "onair") || (it.kind === "button" && !!it.action && AV_ACTIONS.includes(it.action.type))));
    }
    onair.setNeeded(need);
  }
  const notes = new NotificationStore();
  let themeOverride: "dark" | "light" | null = null;
  const stopCtl = new AbortController();
  const pushes = new PushStore((key, v) => {
    rules.setPush(key, v?.value);
    broadcast({ type: "pushed", values: { [key]: v ? { value: v.value, ...(v.sub ? { sub: v.sub } : {}), at: v.at } : null } });
  });
  const addNote = (n: { title: string; body?: string; level?: NotifyLevel; ttl?: number; source?: string; sound?: string }) => {
    const notification = notes.add(n);
    broadcast({ type: "notify", notification });
    return notification;
  };
  // ----- plugins (no-code, P1): installed plugins, their tiles' data, their buttons -----
  const pluginStore = opts.plugins ?? new PluginStore({ agentVersion: compatVersion() });
  await pluginStore.load().catch((e) => console.error("plugins", e));
  // core plugins (core.weather, core.quota) run in this process through the same PluginContext as community code; the services
  // are read lazily because the weather service and the AI hub are built a little later than the runtime
  const coreHost = new CoreHost({
    weather: { get: (o, force, unit) => weather.get(o, force, unit), tempUnit: () => layout.theme?.temperatureUnit },
    quota: { quota: (provider) => hub.snapshot().providers.find((x) => x.id === provider) },
    shell: opts.pluginDeps?.shell ?? realShell,
    fetch: opts.pluginDeps?.fetch ?? fetch,
    settings: (id) => (pluginStore.entry(id)?.state.settings ?? {}) as Record<string, string | number | boolean>,
  });
  pluginStore.registerCore(coreHost.manifests());
  await coreHost.activate();
  const pluginHosts = new PluginHosts(pluginStore, {
    fetch: opts.pluginDeps?.fetch ?? fetch,
    shell: opts.pluginDeps?.shell ?? realShell,
    keys: { hotkey: (keys) => platform.runAction({ type: "hotkey", keys }), type: (text) => platform.runAction({ type: "type", text }) },
    // ctx.onair.set of a plugin granted "onair" (the OBS plugin): its own On Air source, cleared when it stops
    onair: { set: (pid, kind, on, since) => onair.setPluginSource(pid, kind, on, since), clear: (pid) => onair.clearPlugin(pid) },
    notify: (pid, n) => { addNote({ ...n, source: `plugin:${pid}` }); },
    ...opts.pluginHostDeps,
  });
  pluginHosts.startEager();
  // a plugin that keeps crashing is switched off (the owner can turn it on again on the Plugins tab)
  pluginHosts.onFailed((id) => { void pluginStore.setEnabled(id, false).catch(() => {}); });
  const registry = opts.registry ?? new Registry();
  const themeRegistry = opts.themeRegistry ?? new ThemeRegistry(registry.url);
  const themeStore = opts.themes ?? new ThemeStore({ agentVersion: compatVersion(), resolve: (s) => pluginStore.resolveSource(s), builtin: BUILTIN_THEMES });
  await themeStore.load();
  const themePreviews = opts.themePreviews ?? new ThemePreviewCache({ agentVersion: compatVersion(), resolve: (s) => pluginStore.resolveSource(s) });
  layoutAssets = await layoutAssetsAll(layout); // now that the theme store can supply the icon pack
  /** A registry entry with what this computer has of it. */
  const annotate = (e: RegistryEntry) => {
    const have = pluginStore.has(e.id) && !pluginStore.isBuiltin(e.id) ? pluginStore.entry(e.id) : undefined;
    const installedVersion = have?.state.version;
    const unavailable = pluginStore.osReason(e);
    return { ...e, ...(unavailable ? { unavailable } : {}), installed: !!have, ...(installedVersion ? { installedVersion } : {}), updateAvailable: !!installedVersion && compareVersions(e.version, installedVersion) > 0 };
  };
  const pluginRuntime = new PluginRuntime(pluginStore, {
    core: coreHost,
    hosts: pluginHosts,
    fetch: opts.pluginDeps?.fetch ?? fetch,
    shell: opts.pluginDeps?.shell ?? realShell,
    onItems: (items) => broadcast({ type: "plugin", items }),
    log: (id, line) => pluginHosts.note(id, line),
  });
  pluginRuntime.setLayout(layout);
  const findAction = (pageId: string, itemId: string) => {
    const it = layout.pages.find((p) => p.id === pageId)?.items.find((i) => i.id === itemId);
    return it && it.kind === "button" ? it.action : undefined;
  };
  async function execute(action: Action, depth = 0, ws?: ServerWebSocket<WsData>): Promise<void> {
    switch (action.type) {
      case "page": return;
      case "sound-stop":
        player.stopAll();
        broadcast({ type: "stop-sounds" });
        return;
      case "sound": {
        const info = await sounds.get(action.sound);
        if (!info) throw new Error(t("the sound is no longer in the library"));
        const on = action.on ?? "mac", volume = action.volume ?? 100, mode = action.mode ?? "restart";
        if (on === "mac" || on === "both") player.play(info.id, info.path, volume, mode);
        if ((on === "phone" || on === "both") && ws) send(ws, { type: "play-sound", id: info.id, url: `/sounds/${bareId(info.id)}`, volume, mode });
        return;
      }
      case "macro": {
        const ctx: MacroCtx = {
          exec: (a, d) => execute(a, d, ws),
          item: findAction,
          notify: (text) => void addNote({ title: text, source: "macro" }),
          sleep: abortableSleep,
          signal: stopCtl.signal,
        };
        return runMacro(action.steps, ctx, depth);
      }
      case "plugin":
        return pluginRuntime.runAction(action, (steps) => execute({ type: "macro", steps }, depth, ws));
      case "onair": { onair.setManual(action.mode ?? "toggle"); return; }
      case "mic": { onair.noteMicMuted(await micControl.set(action.mode ?? "toggle")); return; }
      case "camera": { await cameraToggle(av); return; }
      case "screenshot":
        // the button's tool, else the screen's default, else the first installed known app, else the system tool
        return deps.runAction(resolveScreenshot(action, layout.theme?.screen?.screenshot, installedScreenshotApps(platform.id, process.env, userHome()), platform.id));
      case "hass":
        if (!hass.connected()) throw new Error(t("Home Assistant is not connected"));
        return hass.callService(action.service, action.entityId, action.data);
      default: return deps.runAction(action);
    }
  }
  const rules: RuleEngine = new RuleEngine({
    rules: () => layout.rules ?? [],
    actions: {
      gotoPage: (pageId, o) => broadcast({ type: "goto", pageId, countdown: o.countdown, reason: o.reason, ruleId: o.ruleId, revert: o.revert }),
      gotoRevert: (ruleId) => broadcast({ type: "goto-revert", ruleId }),
      notify: (text, level, ruleId) => void addNote({ title: text, level, source: `rule:${ruleId}` }),
      themeMode: (mode) => { themeOverride = mode; broadcast({ type: "theme-override", mode }); },
      onair: (mode) => void onair.setManual(mode),
      runItem: async (pageId, itemId) => {
        const a = findAction(pageId, itemId);
        if (!a) throw new Error(t("button {id} not found", { id: `${pageId}/${itemId}` }));
        await execute(a);
      },
    },
  });
  const rulesTimer = setInterval(() => rules.tick(), opts.rulesTickMs ?? 30_000);
  (rulesTimer as any).unref?.();
  const unsubHass = hass.onState?.((id, st) => rules.setHass(id, st?.state));

  const weather = new WeatherService({ fetch: opts.weatherFetch, hass: () => hass });
  async function weatherItems(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    const jobs: Promise<void>[] = [];
    for (const page of layout.pages) for (const it of page.items) {
      if (it.kind !== "widget" || it.widget !== "weather") continue;
      const id = it.id;
      // the legacy widget stands for core.weather (D7): off, or not runnable, shows the plugin's error instead of data
      const ref = legacyRef(it)!;
      const status = pluginStore.runnable(ref.id);
      if (status !== "ok") { out[id] = { error: status === "missing" ? ERR_MISSING : status === "disabled" ? ERR_DISABLED : ERR_NOT_GRANTED }; continue; }
      jobs.push(coreHost.get(ref.id, ref.widget, ref.settings ?? {}).then((u) => { out[id] = u.data; }, (e) => { out[id] = { error: e?.message ?? String(e) }; }));
    }
    await Promise.all(jobs);
    return out;
  }
  let weatherTimer: ReturnType<typeof setInterval> | undefined;
  async function pushWeather(to?: ServerWebSocket<WsData>) {
    const items = await weatherItems();
    if (stopped || !Object.keys(items).length) return;
    if (to) send(to, { type: "weather", items }); else broadcast({ type: "weather", items });
  }
  // turning core.weather off or on re-sends the weather tiles at once
  pluginStore.onChange(() => { if (sockets.size) void pushWeather(); });

  const pairingInfo = async (all = false) => {
    const ip = lanIp();
    const port = server.port as number;
    const host = await (opts.hostName ?? localHostName)();
    const tail = await (opts.tailnetName ?? tailnetName)().catch(() => null);
    const list = phoneAddresses({ hostName: host, tailnetName: tail, all, ...(opts.interfaces ? { interfaces: opts.interfaces() } : {}) });
    const addresses = list.map((a) => ({ ...a, url: `http://${a.host}:${port}/?pin=${pairing.pin}` }));
    const resolves = await (opts.localResolves ?? localResolves)(host).catch(() => false);
    return {
      addresses,
      defaultAddress: defaultAddress(list, { localResolves: resolves, lanIp: ip }),
      pin: pairing.pin,
      url: `http://${ip}:${port}/?pin=${pairing.pin}`,
      lanIp: ip,
      port,
      host,
      /** Survives IP changes: the Bonjour/mDNS name of this machine. */
      urlLocal: `http://${host}.local:${port}/?pin=${pairing.pin}`,
    };
  };

  // one-cable setup for Android phones (adb): created on first use, once the port is known
  let usbSetup: AndroidUsb | undefined;
  const androidUsb = (): AndroidUsb => (usbSetup ??= new AndroidUsb({
    home: HOME,
    os: osId(platform.id),
    port: server.port as number,
    agentVersion: aboutInfo().version,
    pairTrusted: (name, serial) => pairing.pairTrusted(name, serial),
    usbSerials: async () => (await loadDevices()).flatMap((d) => (d.usbSerial ? [d.usbSerial] : [])),
    lanUrls: async () => (await pairingInfo()).addresses.filter((a) => a.kind === "lan").map((a) => `http://${a.host}:${server.port}`).slice(0, 4),
    computerName: () => (opts.hostName ?? localHostName)(),
    apk: () => releaseApk(HOME, aboutInfo().version, process.env),
    log: (line) => console.log(line),
  }));

  let lastStats: Stats | undefined;
  const stopStats = deps.startStats((stats) => {
    lastStats = stats;
    rules.setCpu(stats.cpu);
    broadcast({ type: "stats", stats });
  });

  // ----- media: polled only while at least one socket is connected -----
  const tracker = new MediaTracker({ read: deps.readMedia, artwork: deps.fetchArtwork });
  const lastMedia = new LastMediaStore(opts.lastMediaFile);
  await lastMedia.load();
  /** The media message: `last` rides along only when nothing is playing. */
  const mediaMsg = (media: unknown) => ({ type: "media", media, ...(media === null && lastMedia.last ? { last: lastMedia.last } : {}) });
  const pollMs = opts.mediaPollMs ?? 1500;
  let mediaTimer: ReturnType<typeof setTimeout> | undefined;
  let mediaGen = 0;
  let polling = false;
  let stopped = false;

  /** 1.5 s normally; 0.3 s while a playing track has under 15 s left, so the next track shows up at once. */
  function mediaDelay(): number {
    const m = tracker.seen;
    return m && m.playing && m.duration > 0 && m.duration - m.position < NEAR_END_S ? Math.min(NEAR_END_MS, pollMs) : pollMs;
  }
  function startMediaLoop() {
    const gen = ++mediaGen;
    const tick = async () => {
      await pollMedia();
      if (gen === mediaGen && !stopped) mediaTimer = setTimeout(() => void tick(), mediaDelay());
    };
    mediaTimer = setTimeout(() => void tick(), 0);
  }
  function stopMediaLoop() {
    mediaGen++;
    if (mediaTimer) clearTimeout(mediaTimer);
    mediaTimer = undefined;
  }

  async function pollMedia() {
    if (polling || stopped) return;
    polling = true;
    try {
      const r = await tracker.poll();
      if (tracker.seen) {
        lastMedia.remember(tracker.seen);
        void lastMedia.persist();
      } else if (r.changed) void lastMedia.persist(true); // stopped: keep the final position
      if (!r.changed || stopped) return;
      rules.setMedia(!!r.media?.playing);
      // artwork rides along on connect, track changes and when a cached cover changes
      const media = r.media && !r.trackChanged && !r.artworkChanged ? { ...r.media, artwork: undefined } : r.media;
      broadcast(mediaMsg(media));
    } finally {
      polling = false;
    }
  }

  // ----- AI quotas / sessions / permissions -----
  const broker = new PermissionBroker(
    {
      hasPhones: () => sockets.size > 0,
      notify: (request) => {
        broadcast({ type: "permission", request });
        rules.setAiPrompts(promptProviders());
        void refreshSessions();
      },
      resolved: (id, decision) => {
        broadcast({ type: "permission-resolved", id, decision });
        queueMicrotask(() => rules.setAiPrompts(promptProviders()));
        void refreshSessions();
      },
    },
    opts.permissionTimeoutMs ?? PERMISSION_TIMEOUT_MS,
  );
  const askSettings = new AskSettingsStore(opts.askSettingsFile);
  const doctorProbes = () => opts.doctorProbes ?? realProbes(pkg.version);
  // One doctor run at a time, and its answer reused for a while: each run starts several OS probes (four PowerShell processes on
  // Windows), and callers that give up (the tray waits 4 s) do not cancel it, so polling every few seconds piled them up (issue #15).
  const DOCTOR_CACHE_MS = opts.doctorCacheMs ?? (opts.doctorProbes ? 0 : 30_000);
  let doctorCached: { at: number; report: DoctorReport } | null = null;
  let doctorRunning: Promise<DoctorReport> | null = null;
  function doctorReport(fresh = false): Promise<DoctorReport> {
    if (!fresh && doctorCached && Date.now() - doctorCached.at < DOCTOR_CACHE_MS) return Promise.resolve(doctorCached.report);
    if (doctorRunning) return doctorRunning;
    doctorRunning = doctorReportNow().then((report) => { doctorCached = { at: Date.now(), report }; return report; }).finally(() => { doctorRunning = null; });
    return doctorRunning;
  }
  async function doctorReportNow(): Promise<DoctorReport> {
    // the first quota read can still be in flight right after start: wait for it a little before judging
    const read = () => hub.snapshot().providers.find((x) => x.id === "claude");
    // quotas are only polled while a phone shows them; without one the read never starts, so start it here
    // (refreshQuotas keeps its own cache, like /api/integrations)
    if (read()?.updatedAt === 0) await hub.refreshQuotas().catch(() => false);
    let claude = read();
    for (let i = 0; i < Math.round((opts.doctorWaitMs ?? 5000) / 200) && claude && claude.updatedAt === 0; i++) { await new Promise((r) => setTimeout(r, 200)); claude = read(); }
    return runDoctor(doctorProbes(), {
      hass: hassClient ? await hassClient.status() : null,
      claude: claude ? (claude.updatedAt === 0 ? { ok: false, pending: true } : { ok: !claude.error && claude.windows.length > 0, ...(claude.error ? { error: claude.error } : {}) }) : null,
      instance: currentInstance(server.port),
    });
  }
  const questions: QuestionBroker = new QuestionBroker(
    {
      hasPhones: () => sockets.size > 0,
      notify: (request) => {
        broadcast({ type: "question", request });
        rules.setAiPrompts(promptProviders());
        void refreshSessions();
      },
      resolved: (id, how) => {
        broadcast({ type: "question-resolved", id, how });
        queueMicrotask(() => rules.setAiPrompts(promptProviders()));
        void refreshSessions();
      },
    },
    opts.questionTimeoutMs ?? QUESTION_TIMEOUT_MS,
  );
  const promptProviders = () => [...broker.list().map((r) => r.source), ...questions.hints().map((h) => h.source)];
  const pushAi = () => {
    const ai = hub.snapshot();
    const q: Partial<Record<"claude" | "codex" | "antigravity" | "opencode", number>> = {};
    for (const pr of ai.providers) { const used = pr.windows.flatMap((w) => (w.usedPercent === null ? [] : [w.usedPercent])); if (used.length && pr.id !== "grok") q[pr.id] = Math.max(...used); }
    rules.setQuota(q);
    rules.setAiInput(ai.sessions.filter((x) => x.state === "waiting" && !x.prompt).map((x) => x.tool));
    broadcast({ type: "ai", ai });
  };
  async function refreshSessions() {
    if (stopped) return;
    if (await hub.refreshSessions([...broker.hints(), ...questions.hints()])) pushAi();
  }
  async function refreshQuotas(force = false) {
    if (stopped) return;
    if (await hub.refreshQuotas(force)) pushAi();
  }
  let aiSessionsTimer: ReturnType<typeof setInterval> | undefined;
  let aiQuotaTimer: ReturnType<typeof setInterval> | undefined;
  /** AI data is read while a phone or the management page is listening. */
  function startAi() {
    if (!aiSessionsTimer) {
      aiSessionsTimer = setInterval(() => void refreshSessions(), opts.aiSessionsMs ?? 5000);
      aiQuotaTimer = setInterval(() => void refreshQuotas(), opts.aiQuotaMs ?? 60_000);
      void refreshSessions();
    }
    if (hub.quotasStale) void refreshQuotas();
  }
  function stopAiIfIdle() {
    if (sockets.size === 0 && aiSessionsTimer) {
      clearInterval(aiSessionsTimer);
      clearInterval(aiQuotaTimer);
      aiSessionsTimer = aiQuotaTimer = undefined;
    }
  }

  /** Shortly after a control action the player/volume state has changed: push it without waiting for the timer. */
  function refreshSoon(what: "media" | "volume") {
    setTimeout(async () => {
      if (stopped || sockets.size === 0) return;
      if (what === "media") return void pollMedia();
      const volume = await deps.readVolume().catch(() => null);
      if (lastStats && !stopped) {
        lastStats = { ...lastStats, volume };
        broadcast({ type: "stats", stats: lastStats });
      }
    }, what === "media" ? 250 : 0);
  }

  // Localhost-only routes: peer must be this machine AND the request must come from our own pages (Host, Origin,
  // JSON content type, X-Nookdeck header), so a web page open in a browser here cannot drive the API.
  const guardLocal = (server: Server<WsData>, req: Request, kind: { upload?: boolean; hook?: boolean } = {}): Response | null => {
    // a browser opening a page here from another machine gets a readable HTML page; the JSON API keeps JSON
    const refuse = (error: string): Response => {
      const path = new URL(req.url).pathname;
      if (!wantsPage(req.method, path)) return json({ error }, 403);
      const html = forbiddenPage(server.port as number, pickLanguage(layout.theme?.language, req.headers.get("accept-language")));
      return new Response(req.method === "HEAD" ? null : html, { status: 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    };
    if (!isLocal(server.requestIP(req)?.address)) return refuse("forbidden: localhost only");
    const why = localRequestError({ port: server.port as number, method: req.method, headers: req.headers, ...kind });
    return why ? refuse(why) : null;
  };
  const isLocalPeer = (server: Server<WsData>, req: Request) => isLocal(server.requestIP(req)?.address);
  /** Phone-facing routes: only names that really are this machine (LAN IP, .local, localhost); other Hosts are rebinding. */
  const guardPhone = async (server: Server<WsData>, req: Request): Promise<Response | null> => {
    const host = await (opts.hostName ?? localHostName)().catch(() => "");
    const port = server.port as number;
    const ips = opts.interfaces ? Object.values(opts.interfaces()).flatMap((l) => (l ?? []).map((a) => a.address)) : [];
    if (hostAllowed(req.headers.get("host"), port, phoneNames([host], ips))) return null;
    // a Tailscale MagicDNS name (cached, asked only when the cheap check failed)
    const tail = await (opts.tailnetName ?? tailnetName)().catch(() => null);
    return tail && hostAllowed(req.headers.get("host"), port, phoneNames([host], [...ips, tail])) ? null : json({ error: "forbidden: bad Host" }, 403);
  };

  async function readBody(req: Request): Promise<any> {
    try { return await req.json(); } catch { return undefined; }
  }

  const sndPhone = /^\/sounds\/[^/]+$/;
  const camPhone = /^\/api\/hass\/camera\/([^/]+)$/;

  /** A request that takes more than 10 s is logged (once, while it is still running): a hung route shows up in agent.err.log. */
  const slowWatch = <A extends unknown[], R>(h: (req: Request, ...rest: A) => Promise<R>) => async (req: Request, ...rest: A): Promise<R> => {
    const t0 = Date.now();
    const timer = setTimeout(() => console.warn(`[watchdog] ${req.method} ${new URL(req.url).pathname} has been running for more than 10 s`), 10_000);
    try { return await h(req, ...rest); } finally { clearTimeout(timer); const ms = Date.now() - t0; if (ms > 10_000) console.warn(`[watchdog] ${req.method} ${new URL(req.url).pathname} finished after ${Math.round(ms / 1000)} s`); }
  };

  const server = Bun.serve<WsData>({
    idleTimeout: 120, // permission hooks long-poll for up to 55 s
    port: opts.port ?? 7420,
    hostname: opts.hostname ?? "0.0.0.0",
    fetch: slowWatch(async (req: Request, server: any) => {
      const url = new URL(req.url);
      const path = url.pathname;
      const peer: string | undefined = server.requestIP(req)?.address;
      if (path !== "/ws" && path !== "/api/pair") visitors.seen(peer, path === "/" || path === "/index.html" ? "page" : "request");

      if (path === "/ws" || path === "/api/pair" || sndPhone.test(path) || camPhone.test(path)) {
        const bad = await guardPhone(server, req);
        if (bad) return bad;
      }
      if (path === "/ws") {
        const org = req.headers.get("origin");
        if (org && org.replace(/^https?:\/\//i, "") !== req.headers.get("host")) return json({ error: "forbidden: Origin does not match Host" }, 403);
        // the token comes from ?token= or from the pd_token cookie set at pairing
        const token = url.searchParams.get("token") || cookieToken(req.headers.get("cookie"));
        const device = await pairing.findDevice(token);
        visitors.seen(peer, "ws", device?.name);
        // a valid connect renews the cookie for another year
        const headers = device && token ? { "set-cookie": tokenCookie(token) } : undefined;
        if (server.upgrade(req, { data: { deviceId: device?.id ?? null }, ...(headers ? { headers } : {}) })) return undefined;
        return json({ error: "upgrade failed" }, 400);
      }

      if (path === "/api/pair" && req.method === "POST") {
        const body = await readBody(req);
        const res = await pairing.pair(body?.pin, body?.name);
        visitors.seen(peer, res ? "pair-ok" : "pair-fail");
        return res ? new Response(JSON.stringify(res), { headers: { "content-type": "application/json", "set-cookie": tokenCookie(res.token) } }) : json({ error: "invalid pin" }, 401);
      }

      if (path === "/api/apps" && req.method === "GET") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        return json(await icons.listApps());
      }
      if (path === "/api/layout/assets" && req.method === "POST") {
        // the assets map the phone would get for this (unsaved) layout, so the management preview can draw every icon
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const body = await readBody(req);
        let l: Layout;
        try { l = validateLayout(body?.layout); } catch (err: any) { return json({ error: err?.message ?? String(err) }, 400); }
        return json(await layoutAssetsAll(l));
      }
      if (path === "/api/apps/icon" && req.method === "GET") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const id = url.searchParams.get("bundleId") ?? "";
        if (!BUNDLE_ID_RE.test(id)) return json({ error: "invalid bundleId" }, 400);
        const png = await icons.appIcon(id);
        return png ? new Response(png as unknown as BodyInit, { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" } }) : json({ error: "no icon" }, 404);
      }
      if (path === "/api/icons/catalog" && req.method === "GET") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        if (!CATALOG) return json({ error: "catalog not embedded" }, 404);
        const headers: Record<string, string> = { "content-type": CATALOG.type, "cache-control": "public, max-age=604800", vary: "accept-encoding" };
        if (/\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")) {
          catalogGz ??= Bun.gzipSync(new Uint8Array(await Bun.file(CATALOG.path).arrayBuffer()));
          return new Response(catalogGz as unknown as BodyInit, { headers: { ...headers, "content-encoding": "gzip" } });
        }
        return new Response(Bun.file(CATALOG.path), { headers });
      }
      if (path === "/api/icons" && req.method === "POST") {
        const denied = guardLocal(server, req, { upload: true });
        if (denied) return denied;
        const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
        if (type !== "image/png" && type !== "image/jpeg") { await drainBody(req); return json({ error: "content-type must be image/png or image/jpeg" }, 415); }
        if (Number(req.headers.get("content-length") ?? 0) > UPLOAD_MAX) { await drainBody(req); return json({ error: "image is larger than 512 KB" }, 413); }
        const bytes = new Uint8Array(await req.arrayBuffer());
        try {
          return json({ id: await icons.saveUpload(bytes) });
        } catch (err: any) {
          return json({ error: err?.message ?? String(err) }, bytes.length > UPLOAD_MAX ? 413 : 400);
        }
      }
      const imgRoute = path.match(/^\/api\/icons\/img\/([^/]+)$/);
      if (imgRoute) {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const id = imgRoute[1]!;
        if (!IMG_ID_RE.test(id)) return json({ error: "invalid id" }, 400);
        if (req.method === "GET") {
          const png = await icons.upload(id);
          return png ? new Response(png as unknown as BodyInit, { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" } }) : json({ error: "not found" }, 404);
        }
        if (req.method === "DELETE") {
          if (!(await icons.deleteUpload(id))) return json({ error: "not found" }, 404);
          layoutAssets = await layoutAssetsAll(layout);
          broadcastLayout(); // a layout still using it falls back to its text
          return json({ ok: true });
        }
        return json({ error: "method not allowed" }, 405);
      }

      if (path === "/api/sounds" && req.method === "POST") {
        const denied = guardLocal(server, req, { upload: true });
        if (denied) return denied;
        const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
        if (!SOUND_TYPES.includes(type)) return json({ error: "content-type must be audio/mpeg, audio/mp4, audio/wav, audio/aac or audio/ogg" }, 415);
        if (Number(req.headers.get("content-length") ?? 0) > SOUND_MAX) { await drainBody(req); return json({ error: "file is larger than 5 MB" }, 413); }
        const bytes = new Uint8Array(await req.arrayBuffer());
        const rawName = url.searchParams.get("name") ?? req.headers.get("x-sound-name");
        let name = rawName ?? undefined;
        try { if (name && req.headers.get("x-sound-name") === name) name = decodeURIComponent(name); } catch { /* keep raw */ }
        try {
          const info = await sounds.add(bytes, name);
          return json({ id: info.id, name: info.name, durationMs: info.durationMs, size: info.size });
        } catch (err: any) {
          return json({ error: err?.message ?? String(err) }, bytes.length > SOUND_MAX ? 413 : 400);
        }
      }
      if (path === "/api/sounds" && req.method === "GET") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        return json((await sounds.list()).map(({ id, name, durationMs, size, createdAt }) => ({ id, name, durationMs, size, createdAt })));
      }
      const sndApi = path.match(/^\/api\/sounds\/([^/]+)$/);
      if (sndApi && (req.method === "PATCH" || req.method === "DELETE")) {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const id = decodeURIComponent(sndApi[1]!);
        if (!SOUND_ID_HEX.test(bareId(id))) return json({ error: "invalid id" }, 400);
        if (req.method === "DELETE") {
          player.stopId(`snd:${bareId(id)}`);
          return (await sounds.remove(id)) ? json({ ok: true }) : json({ error: "not found" }, 404);
        }
        const body = await readBody(req);
        if (typeof body?.name !== "string" || !body.name.trim()) return json({ error: "name must be a non-empty string" }, 400);
        const info = await sounds.rename(id, body.name);
        return info ? json({ id: info.id, name: info.name, durationMs: info.durationMs, size: info.size }) : json({ error: "not found" }, 404);
      }
      const camFile = camPhone.exec(path);
      if (camFile && req.method === "GET") {
        // Home Assistant camera stills (D7): paired phones, for cameras that are on the layout; this computer (the preview) for any
        const local = isLocalPeer(server, req);
        if (!local && !(await pairing.findDevice(cookieToken(req.headers.get("cookie")) || url.searchParams.get("token")))) return json({ error: "unauthorized" }, 401);
        const id = camFile[1]!;
        if (!CAMERA_ENTITY_RE.test(id) || (!local && !cameraTiles(layout).has(id))) return json({ error: "that camera is not on the layout" }, 404);
        if (!hassClient) return json({ error: "Home Assistant client is not available" }, 501);
        try {
          const image = await hassClient.cameraImage(id);
          // same-origin only: another website must not be able to put a camera picture on its own page
          return new Response(image.bytes as unknown as BodyInit, { headers: { "content-type": image.type, "cache-control": "no-store", "cross-origin-resource-policy": "same-origin", "x-content-type-options": "nosniff" } });
        } catch (err: any) {
          return json({ error: err?.message ?? String(err) }, err instanceof CameraError ? err.status : 502);
        }
      }
      const sndFile = path.match(/^\/sounds\/([^/]+)$/);
      if (sndFile && (req.method === "GET" || req.method === "HEAD")) {
        // paired phones (token or cookie) and this computer
        if (!isLocalPeer(server, req)) {
          const device = await pairing.findDevice(url.searchParams.get("token") || cookieToken(req.headers.get("cookie")));
          if (!device) return json({ error: "unauthorized" }, 401);
        }
        const hex = bareId(decodeURIComponent(sndFile[1]!));
        const info = SOUND_ID_HEX.test(hex) ? await sounds.get(hex) : null;
        if (!info) return json({ error: "not found" }, 404);
        const file = Bun.file(info.path);
        const size = file.size;
        const headers: Record<string, string> = { "content-type": sounds.mime(info.ext), "accept-ranges": "bytes", "cache-control": "private, max-age=3600" };
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
        if (range && (range[1] || range[2])) {
          let start = range[1] ? Number(range[1]) : size - Number(range[2]);
          let end = range[1] && range[2] ? Number(range[2]) : size - 1;
          start = Math.max(0, start);
          end = Math.min(size - 1, end);
          if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
          return new Response(req.method === "HEAD" ? null : file.slice(start, end + 1), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
        }
        return new Response(req.method === "HEAD" ? null : file, { headers: { ...headers, "content-length": String(size) } });
      }

      if (path === "/api/layout/history" && req.method === "GET") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        return json(await history.list());
      }
      if (path === "/api/layout/undo" && req.method === "POST") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const prev = await history.undo();
        if (!prev) return json({ error: "nothing to undo" }, 409);
        await saveLayout(prev);
        layout = prev;
        setLanguage(layout.theme?.language);
        syncHass();
        pluginRuntime.setLayout(layout);
        layoutAssets = await layoutAssetsAll(layout);
        broadcastLayout();
        return json({ ok: true, layout });
      }

      if (path === "/api/layout") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        if (req.method === "GET") return json(layout);
        if (req.method === "PUT") {
          const body = await readBody(req);
          let next: Layout;
          try { next = validateLayout(body); } catch (err: any) { return json({ error: err?.message ?? String(err) }, 400); }
          await saveLayout(next);
          layout = next;
          setLanguage(layout.theme?.language);
          syncHass();
          pluginRuntime.setLayout(layout);
          await history.push(next).catch((e) => console.error("layout history", e));
          layoutAssets = await layoutAssetsAll(layout);
          broadcastLayout();
          void pushWeather();
          rules.tick();
          return json({ ok: true });
        }
        return json({ error: "method not allowed" }, 405);
      }

      if (path === "/api/android" && req.method === "GET") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        return json(url.searchParams.get("peek") === "1" ? androidUsb().peek() : await androidUsb().status());
      }
      if (path === "/api/android/adb" && req.method === "POST") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        try { return json({ ok: true, adb: await androidUsb().installAdb() }); } catch (e: any) { return json({ ok: false, error: String(e?.message ?? e) }, 502); }
      }
      if (path === "/api/android/setup" && req.method === "POST") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const body = await readBody(req);
        const r = await androidUsb().setup(String(body?.serial ?? ""), { stayAwake: body?.stayAwake === true, battery: body?.battery === true });
        return json(r, r.ok ? 200 : 400);
      }
      if (path === "/api/hello" && req.method === "GET") {
        // the Android app looks for computers on the Wi-Fi: is this Nookdeck, and what is it called (no PIN, no secret)
        const bad = await guardPhone(server, req);
        if (bad) return bad;
        return json({ app: "nookdeck", name: await (opts.hostName ?? localHostName)().catch(() => ""), version: aboutInfo().version });
      }
      if (path === "/api/devices" && req.method === "GET") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const devices = await loadDevices();
        const online = new Set([...sockets].map((s) => s.data.deviceId));
        // the screen size each online phone reported last (a phone with two tabs open: the newest one)
        const viewports = new Map<string, { w: number; h: number }>();
        for (const s of sockets) if (s.data.deviceId && s.data.viewport) viewports.set(s.data.deviceId, s.data.viewport);
        return json(devices.map(({ tokenHash, ...d }) => ({ ...d, online: online.has(d.id), ...(viewports.has(d.id) ? { viewport: viewports.get(d.id) } : {}) })));
      }

      if (path === "/api/devices/reload" && req.method === "POST") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        let target: string | undefined;
        const raw = (await req.text()).trim();
        if (raw) {
          let body: any;
          try { body = JSON.parse(raw); } catch { return json({ error: "invalid JSON" }, 400); }
          if (body?.deviceId !== undefined) {
            if (typeof body.deviceId !== "string" || !body.deviceId) return json({ error: "deviceId must be a string" }, 400);
            target = body.deviceId;
          }
        }
        let count = 0;
        for (const ws of sockets) {
          if (target !== undefined && ws.data.deviceId !== target) continue;
          send(ws, { type: "reload" });
          count++;
        }
        return json({ ok: true, count });
      }

      const m = path.match(/^\/api\/devices\/([^/]+)$/);
      if (m && req.method === "DELETE") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const id = decodeURIComponent(m[1]);
        const found = await withDevicesLock(async () => {
          const devices = await loadDevices();
          if (!devices.some((d) => d.id === id)) return false;
          await saveDevices(devices.filter((d) => d.id !== id));
          return true;
        });
        if (!found) return json({ error: "not found" }, 404);
        for (const ws of [...sockets]) {
          if (ws.data.deviceId !== id) continue;
          send(ws, { type: "pair-revoked" });
          ws.close(4403, "revoked");
        }
        return json({ ok: true });
      }

      if (path === "/api/hooks/permission" && req.method === "POST") {
        const denied = guardLocal(server, req, { hook: true });
        if (denied) return denied;
        if (!secretMatches((req.headers.get("x-nookdeck-hook") ?? req.headers.get("x-phonedesk-hook")), hookSecret)) return json({ error: "bad hook secret" }, 401);
        const input = parseHookInput(await readBody(req));
        if ("error" in input) return json({ error: input.error }, 400);
        // risk is shown next to the request, it never decides anything
        const { risk, reason } = classifyRisk(input.toolName, input.toolInput, input.cwd);
        return json({ decision: await broker.request(input, req.signal, { risk, ...(reason ? { riskReason: reason } : {}) }) });
      }

      if (path === "/api/hooks/question" && req.method === "POST") {
        const denied = guardLocal(server, req, { hook: true });
        if (denied) return denied;
        if (!secretMatches((req.headers.get("x-nookdeck-hook") ?? req.headers.get("x-phonedesk-hook")), hookSecret)) return json({ error: "bad hook secret" }, 401);
        const input = parseQuestionInput(await readBody(req));
        if ("error" in input) return json({ error: input.error }, 400);
        // "only when I am away": while the user is typing at this computer, Claude asks in the terminal
        if ((await askSettings.get()).onlyWhenAway) {
          const idle = await (opts.idleSeconds ?? readIdleSeconds)();
          if (idle !== null && idle <= AWAY_IDLE_SECONDS) return json({ answers: null, reason: "present" });
        }
        return json({ answers: await questions.request(input, req.signal) });
      }

      // busy / idle / waiting as the tools themselves report it (Grok hooks, the OpenCode 1.x plugin)
      if (path === "/api/hooks/state" && req.method === "POST") {
        const denied = guardLocal(server, req, { hook: true });
        if (denied) return denied;
        if (!secretMatches((req.headers.get("x-nookdeck-hook") ?? req.headers.get("x-phonedesk-hook")), hookSecret)) return json({ error: "bad hook secret" }, 401);
        const b = await readBody(req);
        if (b?.source !== "grok" && b?.source !== "opencode") return json({ error: "source must be grok or opencode" }, 400);
        if (!["busy", "idle", "waiting"].includes(b?.state)) return json({ error: "state must be busy, idle or waiting" }, 400);
        if (typeof b.sessionId !== "string" || !b.sessionId) {
          // a Grok notification without a session id: nothing to attach it to
          return json({ ok: true, ignored: true });
        }
        toolStates.set(b.source, b.sessionId.slice(0, 200), b.state as ToolState);
        void refreshSessions();
        return json({ ok: true });
      }

      // ----- plugin registry (read, install a reviewed plugin, README) -----
      const regRoute = /^\/api\/plugins\/(registry|install-from-registry)(?:\/([^/]+)\/(readme|manifest))?$/.exec(path);
      if (regRoute) {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const fail = (err: unknown) => json({ error: err instanceof Error ? err.message : String(err) }, err instanceof PluginError ? err.status : 400);
        try {
          if (regRoute[1] === "registry" && !regRoute[2] && req.method === "GET") {
            const r = await registry.get(url.searchParams.get("refresh") === "1");
            return json({ plugins: r.plugins.filter((p) => p.type !== "theme").map(annotate), fetchedAt: r.fetchedAt, ...(r.stale ? { stale: true } : {}) });
          }
          if (regRoute[1] === "registry" && regRoute[2] && regRoute[3] === "manifest" && req.method === "GET") {
            const entry = await registry.entry(regRoute[2]);
            if (!entry) return json({ error: "that plugin is not in the registry" }, 404);
            const m = await registry.manifest(entry);
            const unavailable = pluginStore.osReason(m);
            return json(unavailable ? { ...m, unavailable } : m);
          }
          if (regRoute[1] === "registry" && regRoute[2] && regRoute[3] === "readme" && req.method === "GET") {
            const entry = await registry.entry(regRoute[2]);
            if (!entry) return json({ error: "that plugin is not in the registry" }, 404);
            const text = await registry.readme(entry);
            if (text === null) return json({ error: "that plugin has no README" }, 404);
            return new Response(text, { headers: { "content-type": "text/markdown; charset=utf-8", "x-content-type-options": "nosniff" } });
          }
          if (regRoute[1] === "install-from-registry" && req.method === "POST") {
            const id = (await readBody(req))?.id;
            if (typeof id !== "string") return json({ error: "id must be a plugin id" }, 400);
            const entry = await registry.entry(id);
            if (!entry) return json({ error: "that plugin is not in the registry" }, 404);
            const r = await pluginStore.install(entry.repo, { sha256: entry.sha256, version: entry.version });
            return json(r.plugin, r.updated || r.unchanged ? 200 : 201);
          }
        } catch (err) { return fail(err); }
        return json({ error: "method not allowed" }, 405);
      }

      // ----- themes (spec D14) -----
      const themeFile = /^\/api\/themes\/([^/]+)\/files\/(.+)$/.exec(path);
      if (themeFile && (req.method === "GET" || req.method === "HEAD")) {
        // phones load a theme's images and fonts, so this is open to the phone hosts too; the path cannot leave the theme folder
        if (!isLocalPeer(server, req)) { const d = await guardPhone(server, req); if (d) return d; }
        let rel = "";
        try { rel = decodeURIComponent(themeFile[2]!); } catch { return json({ error: "not found" }, 404); }
        const fid = decodeURIComponent(themeFile[1]!);
        // a pack that is only in the preview cache (not installed) is served to this computer only: the manage page's live preview
        const f = themeStore.has(fid) ? await themeStore.file(fid, rel) : isLocalPeer(server, req) ? await themePreviews.file(fid, rel) : null;
        if (!f) return json({ error: "not found" }, 404);
        const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase();
        return new Response(req.method === "HEAD" ? null : (f.bytes as unknown as BodyInit), { headers: { "content-type": isLicenseFile(rel) ? "text/plain; charset=utf-8" : THEME_MIME[ext] ?? "application/octet-stream", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'", "cache-control": "private, max-age=300" } });
      }
      const themeRoute = /^\/api\/themes(?:\/(install|export)|\/([^/]+)(?:\/(apply|css|fork|preview))?)?$/.exec(path);
      if (themeRoute) {
        const phoneCss = themeRoute[3] === "css" && req.method === "GET"; // the stylesheet is read by phones too
        const denied = phoneCss ? null : guardLocal(server, req);
        if (denied) return denied;
        const failT = (err: unknown) => json({ error: err instanceof Error ? err.message : String(err) }, err instanceof PluginError ? err.status : 400);
        try {
          const [, verb, tid, sub] = themeRoute;
          if (!verb && !tid) {
            if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
            const r = await themeRegistry.get(false);
            const installed = themeStore.list();
            const applied = layout.theme?.source ?? null;
            return json({
              themes: installed.map((t) => {
                const mine = !!applied && applied.pack.split("@")[0] === t.id;
                return { ...t, applied: mine && applied!.pack === `${t.id}@${t.version}`, appliedOlder: mine && applied!.pack !== `${t.id}@${t.version}`, ...(mine ? { appliedSource: applied } : {}) };
              }),
              registry: r.themes.map((e) => { const have = installed.find((t) => t.id === e.id); return { ...e, installed: !!have, ...(have ? { installedVersion: have.version } : {}), updateAvailable: !!have && compareVersions(e.version, have.version) > 0 }; }),
              applied,
            });
          }
          if (verb === "install" && req.method === "POST") {
            const body = await readBody(req);
            if (typeof body?.id === "string") {
              const entry = (await themeRegistry.get(false)).themes.find((p) => p.id === body.id);
              if (!entry) return json({ error: "that theme is not in the registry" }, 404);
              const pin = { sha256: entry.sha256, version: entry.version };
              // a pack previewed before is installed from its cached files when they still hash to the registry's pin
              const hit = await themePreviews.take(entry).catch(() => null);
              const r = hit ? await themeStore.installFiles(hit.files, hit.shown, pin) : await themeStore.install(entry.repo, pin);
              return json(r.theme, r.updated || r.unchanged ? 200 : 201);
            }
            if (typeof body?.source !== "string") return json({ error: "source must be a folder path, an https address, or give a registry id" }, 400);
            const r = await themeStore.install(body.source);
            return json(r.theme, r.updated || r.unchanged ? 200 : 201);
          }
          if (verb === "export" && req.method === "POST") {
            const body = (await readBody(req)) ?? {};
            const id = typeof body.id === "string" && body.id ? body.id : "";
            if (!PLUGIN_ID_RE.test(id)) return json({ error: 'id must look like "dev.author.name"' }, 400);
            const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : id;
            const files = new Map<string, Uint8Array>();
            const bg = layout.theme?.backgroundImage;
            const m = typeof bg === "string" ? /^theme:([^/]+)\/(.+)$/.exec(bg) : null;
            if (m) { const f = await themeStore.file(m[1]!, m[2]!); if (f) files.set(m[2]!, f.bytes); }
            let preview: Uint8Array | undefined;
            if (typeof body.preview === "string") { const pm = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.preview); if (pm) preview = new Uint8Array(Buffer.from(pm[1]!, "base64")); }
            const pkg = buildThemePackage(layout.theme, { id, name, version: typeof body.version === "string" ? body.version : undefined, author: typeof body.author === "string" ? body.author.slice(0, 80) : undefined, description: typeof body.description === "string" ? body.description.slice(0, 300) : undefined }, { files, preview });
            return new Response(zipFiles(pkg) as unknown as BodyInit, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${id}.zip"` } });
          }
          if (tid && !sub) {
            if (req.method === "DELETE") { await themeStore.remove(decodeURIComponent(tid)); return json({ ok: true }); }
            if (req.method === "GET") { const s = themeStore.summary(decodeURIComponent(tid)); return s ? json(s) : json({ error: "that theme is not installed" }, 404); }
          }
          if (tid && sub === "apply" && req.method === "POST") {
            const id = decodeURIComponent(tid);
            const body = (await readBody(req).catch(() => null)) ?? {};
            const r = themeStore.resolveApply(id, body, layout.theme?.source); // an empty body re-applies the same variant / auto pair / options
            const previous = layout.theme ?? null; // the whole previous theme object: PUT it back as layout.theme to undo
            const next: Layout = validateLayout({ ...layout, theme: applyLook(layout.theme, r.look, r.source, r.auto) });
            await saveLayout(next);
            layout = next;
            setLanguage(layout.theme?.language);
            await history.push(next).catch((e) => console.error("layout history", e));
            layoutAssets = await layoutAssetsAll(layout);
            broadcastLayout();
            return json({ ok: true, theme: layout.theme, previous, source: r.source });
          }
          if (tid && sub === "fork" && req.method === "POST") {
            // "Edit as a copy": the look in force from this pack (variant and options as applied, or the body's) becomes a local one-variant pack
            const id = decodeURIComponent(tid);
            const body = (await readBody(req).catch(() => null)) ?? {};
            const r = themeStore.resolveApply(id, body, layout.theme?.source);
            const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : `${themeStore.summary(id)?.name ?? "Theme"} copy`;
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "copy";
            const newId = `local.fork.${slug}-${Math.random().toString(36).slice(2, 6)}`;
            const all = await themeStore.packFiles(id);
            const keep = new Map([...all].filter(([n]) => /^(fonts|icons)\//.test(n) || (typeof (r.look as any).backgroundImage === "string" && (r.look as any).backgroundImage.endsWith(`/${n}`))));
            const pkg = buildThemePackage(r.look as any, { id: newId, name, description: `A copy of ${id}` }, { files: keep });
            // the pack's css (base, then the chosen variant's) travels as one theme.css; files it references are copied too
            const m = themeStore.manifest(id);
            const vid = r.source.variant ?? m?.auto?.dark ?? m?.variants[0]?.id;
            const cssFiles = [m?.css, m?.variants.find((v) => v.id === vid)?.css].filter((f): f is string => !!f && all.has(f));
            if (cssFiles.length) {
              const dec = new TextDecoder();
              pkg.set("theme.css", new TextEncoder().encode(cssFiles.map((f) => dec.decode(all.get(f)!)).join("\n")));
              for (const [n, bytes] of all) if (!pkg.has(n) && /^(fonts|icons)\//.test(n) === false && !/\.(json|css)$/i.test(n) && cssReferences(cssFiles.map((f) => dec.decode(all.get(f)!)).join("\n"), n)) pkg.set(n, bytes);
              const man = JSON.parse(dec.decode(pkg.get("nookdeck.json")!));
              man.css = "theme.css";
              pkg.set("nookdeck.json", new TextEncoder().encode(JSON.stringify(man, null, 2) + "\n"));
            }
            const made = await themeStore.installFiles(pkg, "a copy", undefined);
            return json(made.theme, 201);
          }
          if (tid && sub === "preview" && req.method === "POST") {
            // the details sheet of a pack that is not installed: fetch it at the registry's pin into the preview cache, never install it (POST: it downloads, so it needs the CSRF header)
            const id = decodeURIComponent(tid);
            if (themeStore.has(id)) return json({ error: "that theme is installed" }, 409);
            const entry = (await themeRegistry.get(false)).themes.find((p) => p.id === id);
            if (!entry) return json({ error: "that theme is not in the registry" }, 404);
            let got;
            try { got = await themePreviews.get(entry); }
            catch (err) { return json({ error: err instanceof Error ? err.message : String(err) }, err instanceof PluginError && err.status === 409 ? 409 : 502); }
            return json({ ...manifestSummary(got.manifest, got.meta.files), sha256: got.meta.sha256, installed: false, cached: got.cached, ...(entry.license ? { license: entry.license } : {}) });
          }
          if (tid && sub === "css" && req.method === "GET") {
            // phones load this stylesheet; it is checked and scoped when served
            if (!isLocalPeer(server, req)) { const d = await guardPhone(server, req); if (d) return d; }
            const cid = decodeURIComponent(tid);
            if (!themeStore.has(cid) && isLocalPeer(server, req) && (await themePreviews.has(cid))) {
              const pcss = await themePreviews.css(cid, url.searchParams.get("variant") ?? undefined);
              return new Response(pcss, { headers: { "content-type": "text/css; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-cache" } });
            }
            const css = await themeStore.css(cid, url.searchParams.get("variant") ?? undefined);
            return new Response(css, { headers: { "content-type": "text/css; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-cache" } });
          }
        } catch (err) { return failT(err); }
        return json({ error: "method not allowed" }, 405);
      }

      // ----- plugins -----
      const pluginRoute = /^\/api\/plugins(?:\/([^/]+)(?:\/(grant|enabled|settings|options|process|logs|restart|stop|reload|update))?)?$/.exec(path);
      if (pluginRoute) {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const [, pid, sub] = pluginRoute;
        const fail = (err: unknown) => json({ error: err instanceof Error ? err.message : String(err) }, err instanceof PluginError ? err.status : 400);
        try {
          if (!pid) {
            if (req.method === "GET") return json(pluginStore.list());
            if (req.method === "POST") {
              const body = await readBody(req);
              if (typeof body?.source !== "string") return json({ error: "source must be a folder path or an https address" }, 400);
              if (body.link === true) { const r = await pluginStore.link(body.source); return json(r.plugin, r.updated ? 200 : 201); } // nookdeck plugin dev
              const r = await pluginStore.install(body.source);
              return json(r.plugin, r.updated || r.unchanged ? 200 : 201);
            }
            return json({ error: "method not allowed" }, 405);
          }
          if (!pluginStore.has(pid)) return json({ error: "that plugin is not installed" }, 404);
          if (!sub && req.method === "DELETE") { await pluginStore.remove(pid); return json({ ok: true }); }
          if (sub === "grant" && req.method === "POST") return json(await pluginStore.grant(pid, (await readBody(req))?.permissions));
          if (sub === "enabled" && req.method === "POST") return json(await pluginStore.setEnabled(pid, (await readBody(req))?.enabled));
          if (sub === "settings" && req.method === "PUT") return json(await pluginStore.setSettings(pid, await readBody(req)));
          // the choices of a select with optionsFrom, asked by the manage form when it opens: { provider, settings? } -> { options }
          if (sub === "options" && req.method === "POST") {
            const b = await readBody(req);
            const e = pluginStore.entry(pid)!;
            const m = e.manifest;
            const fields = [...m.settings, ...m.widgets.flatMap((w) => w.settings), ...m.actions.flatMap((a) => a.settings)];
            if (typeof b?.provider !== "string" || !fields.some((f) => f.optionsFrom === b.provider)) return json({ error: "no setting of this plugin takes its options from that provider" }, 400);
            if (pluginStore.runnable(pid) !== "ok") return json({ error: "the plugin is not enabled" }, 409);
            // what the form has so far over the saved values; secrets come from the saved settings only (the form never has them)
            const secret = new Set(fields.filter((f) => f.type === "secret").map((f) => f.key));
            const settings: Record<string, string | number | boolean> = { ...e.state.settings };
            if (b.settings && typeof b.settings === "object") for (const [k, v] of Object.entries(b.settings)) {
              if (secret.has(k) || !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(k)) continue;
              if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 2000)) settings[k] = v;
            }
            try { return json({ options: await pluginHosts.options(pid, b.provider, settings) }); }
            catch (err: any) { return json({ error: String(err?.message ?? err).slice(0, 200) }, 502); }
          }
          if (!sub && req.method === "GET") return json(pluginStore.summary(pid));
          if (sub === "process" && req.method === "GET") return json(pluginHosts.info(pid));
          if (sub === "logs" && req.method === "GET") return json({ lines: pluginHosts.logs(pid, Math.max(1, Math.min(1000, Number(url.searchParams.get("lines")) || 50))) });
          if (sub === "restart" && req.method === "POST") {
            if (pluginStore.runnable(pid) !== "ok") return json({ error: "the plugin is not enabled" }, 409);
            await pluginHosts.restart(pid);
            return json(pluginHosts.info(pid));
          }
          if (sub === "stop" && req.method === "POST") { await pluginHosts.stop(pid); return json(pluginHosts.info(pid)); }
          if (sub === "reload" && req.method === "POST") return json(await pluginStore.reload(pid));
          if (sub === "update" && req.method === "POST") {
            // registry plugins only: the newer reviewed files, same checks, settings kept, a re-grant when permissions grew
            if (!pluginStore.summary(pid)?.registryVersion) return json({ error: "only plugins installed from the registry can be updated here" }, 409);
            const entry = await registry.entry(pid);
            if (!entry) return json({ error: "that plugin is not in the registry any more" }, 404);
            if (compareVersions(entry.version, pluginStore.summary(pid)!.version) < 0) return json({ error: "the registry has an older version than the one installed" }, 409);
            const r = await pluginStore.install(entry.repo, { sha256: entry.sha256, version: entry.version });
            return json(r.plugin, 200);
          }
        } catch (err) { return fail(err); }
        return json({ error: "method not allowed" }, 405);
      }

      if (path === "/api/about" && req.method === "GET") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        return json(aboutInfo());
      }
      if (path === "/api/screenshot-tools" && req.method === "GET") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const installed = installedScreenshotApps(platform.id, process.env, userHome());
        return json({ os: platform.id, tools: screenshotToolsFor(platform.id), installed, auto: automaticScreenshotTool(installed) });
      }
      if (path === "/api/update" && req.method === "GET") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        return json(await updates.get(layout.theme?.updateCheck !== false, url.searchParams.get("refresh") === "1"));
      }
      if (path === "/api/platform" && req.method === "GET") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        // what the management page needs to show the right key names: layouts always store cmd / option
        return json({ id: platform.id, label: platform.label, keyNames: platform.keyNames });
      }
      if (path === "/api/report" && req.method === "GET") {
        // "Report a problem" on the manage page: a masked Markdown report for a GitHub issue (see report.ts)
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const about = aboutInfo();
        const devices = await loadDevices().catch(() => []);
        const names = new Map(devices.map((d) => [d.id, d.name]));
        const tail = async (file: string, maxAgeMs?: number) => {
          const f = Bun.file(join(HOME, "logs", file));
          if (!(await f.exists())) return "";
          if (maxAgeMs !== undefined && Date.now() - f.lastModified > maxAgeMs) return "";
          const size = f.size;
          const text = await f.slice(Math.max(0, size - 48 * 1024), size).text();
          return size > 48 * 1024 ? text.slice(text.indexOf("\n") + 1) : text; // a cut first line is dropped
        };
        const frames = layoutFrames(layout, layoutAssets);
        const markdown = buildReport({
          now: Date.now(), version: about.version, commit: about.commit || undefined, os: `${platform.label} ${platform.id === "win32" ? windowsVersion(osRelease()) : osRelease()}`, arch: about.arch,
          doctor: (await doctorReport().catch(() => ({ items: [] as DoctorReport["items"] }))).items,
          layout: { pages: layout.pages.length, tiles: layout.pages.reduce((n, p) => n + p.items.length, 0), bytes: frames.reduce((n, f) => n + f.length, 0), assets: Object.keys(layoutAssets).length, assetBytes: JSON.stringify(layoutAssets).length },
          devices: devices.map((d) => ({ name: d.name, lastSeen: d.lastSeen, createdAt: d.createdAt })),
          drops: drops.list().map((d) => ({ ...d, device: names.get(d.device) ?? "unknown device" })),
          errLog: await tail("agent.err.log").catch(() => ""),
          phoneCheck: await tail("phone-check.log", 7 * 86_400_000).catch(() => ""),
          network: { listen: opts.hostname ?? "0.0.0.0", port: server.port, startedAt, nets: ownNetworks(), visitors: visitors.list() },
        }, { home: homedir(), user: (() => { try { return userInfo().username; } catch { return undefined; } })(), hosts: [osHostname()] });
        return json({ title: `[${about.version}] ${platform.label}: `, markdown, repo: about.repo });
      }
      if (path === "/api/doctor" && req.method === "GET") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        return json(await doctorReport(new URL(req.url).searchParams.get("fresh") === "1"));
      }
      if (path === "/api/doctor/open" && req.method === "POST") {
        // opens the System Settings pane of one check (the "Open Settings" button); only panes the report itself names
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const body = await readBody(req);
        const id = String(body?.id ?? "");
        const item = (await doctorReport()).items.find((i) => i.id === id);
        const url = item?.fix?.settingsUrl;
        if (!url) return json({ error: "this check has no settings page to open" }, 400);
        if (!opts.doctorProbes) await platform.openExternal(url);
        return json({ ok: true, url });
      }
      if (path === "/api/doctor/request" && req.method === "POST") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const body = await readBody(req);
        const what = describeRequest(String(body?.id ?? ""));
        if (!what) return json({ error: "this check cannot be requested" }, 400);
        const probes = doctorProbes();
        // reset: clear a stale grant (an older build) so macOS asks again; only when the user pressed Reset
        if (body?.reset === true && platform.id === "darwin" && !opts.doctorProbes) {
          const svc = tccServiceFor(what.id);
          const ident = svc ? macIdentifier() : null;
          if (svc && ident) Bun.spawnSync(["tccutil", "reset", svc, ident], { stdout: "ignore", stderr: "ignore" });
        }
        // shows macOS's own prompt for THIS process (the nookdeck binary under the LaunchAgent)
        if (what.kind === "accessibility") await probes.requestAccessibility();
        else if (what.kind === "local-network") {
          // macOS shows the Local Network prompt when this process first reaches the LAN: an mDNS query plus a Home Assistant test
          if (!opts.doctorProbes) await touchLocalNetwork().catch(() => {});
          await hassClient?.test().catch(() => null);
        } else await probes.requestAutomation(what.bundle!);
        const item = (await doctorReport(true)).items.find((i) => i.id === what.id);
        return json({ ok: true, item });
      }

      // ----- several Claude accounts / Codex profiles: list, add, rename, remove (manage page only; folders never reach phones) -----
      if (path === "/api/ai/accounts" || path.startsWith("/api/ai/accounts/")) {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const listing = () => {
          const snap = hub.snapshot();
          const out: Record<string, unknown[]> = {};
          for (const tool of ACCOUNT_TOOLS) {
            const p = snap.providers.find((x) => x.id === tool);
            out[tool] = aiAccounts.list(tool).map((a) => {
              const q = p?.accounts ? p.accounts.find((x) => x.id === a.id) : a.isDefault ? p : undefined;
              return { id: a.id, name: a.name, dir: a.dir, isDefault: a.isDefault,
                ...(q ? { plan: q.plan, status: q.status, stale: q.stale, error: q.error, windows: q.windows.length } : {}) };
            });
          }
          return out;
        };
        const changed = async () => { await hub.refreshQuotas(true).catch(() => false); pushAi(); return json(listing()); };
        try {
          if (path === "/api/ai/accounts" && req.method === "GET") {
            await hub.refreshQuotas().catch(() => false); // the readers keep their own 5 min cache
            return json(listing());
          }
          if (path === "/api/ai/accounts" && req.method === "POST") {
            const b = await readBody(req);
            if (!ACCOUNT_TOOLS.includes(b?.tool)) return json({ error: "tool must be claude or codex" }, 400);
            await aiAccounts.add(b.tool, b.name, b.dir);
            return await changed();
          }
          const m = path.match(/^\/api\/ai\/accounts\/(claude|codex)\/([A-Za-z0-9-]{1,40})$/);
          if (m && req.method === "PATCH") { await aiAccounts.rename(m[1] as AccountTool, m[2]!, (await readBody(req))?.name); return await changed(); }
          if (m && req.method === "DELETE") { await aiAccounts.remove(m[1] as AccountTool, m[2]!); return await changed(); }
        } catch (err: any) {
          return json({ error: err?.message ?? String(err) }, 400);
        }
        return json({ error: "not found" }, 404);
      }

      if (path === "/api/integrations" && req.method === "GET") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        // The management page is not a paired phone, so it never triggers the WS-driven refresh: refresh here
        // (refreshQuotas keeps its own 5 min cache, so reloading the page does not hammer the providers).
        // ?refresh=1 (the refresh button) reads again at once and lets agy retry after a sign-in problem
        await hub.refreshQuotas(new URL(req.url).searchParams.get("refresh") === "1").catch(() => false);
        const snap = hub.snapshot();
        const quota = (id: string) => {
          const p = snap.providers.find((x) => x.id === id);
          const ok = !!p && !p.error && p.windows.length > 0;
          return {
            ok,
            // read-only sources: "claude-code" | "codex-sessions" | "antigravity-local"; reason = why there is nothing to show
            source: QUOTA_SOURCE[id as AiProviderId],
            ...(!ok && (p?.error ?? "") ? { reason: p!.error, error: p!.error } : {}),
            ...(p ? { name: p.name, plan: p.plan, windows: p.windows, updatedAt: p.updatedAt } : { windows: [] }),
            ...(p?.extras ? { extras: p.extras } : {}),
          };
        };
        const claudeFile = pathFor("claude");
        const codexFile = pathFor("codex");
        return json({
          claude: { installed: await isHookInstalled(claudeFile), askHook: { installed: await isAskHookInstalled(claudeFile), ...(await askSettings.get()) }, settingsPath: claudeFile, cli: !!findCli("claude"), quota: quota("claude") },
          codex: { installed: await isHookInstalled(codexFile), settingsPath: codexFile, cli: !!findCli("codex"), quota: quota("codex") },
          antigravity: { available: agyPath() !== null, quota: quota("antigravity") },
          opencode: await opencodeBlock(quota("opencode")),
          grok: await grokBlock(),
        });
      }

      if (path === "/api/integrations/opencode/plugin" && (req.method === "POST" || req.method === "DELETE")) {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const file = opts.opencodePluginFile ?? pluginPath();
        try {
          if (req.method === "DELETE") return json({ ok: true, ...(await uninstallPlugin(file)), installed: false, pluginPath: file });
          const v = await detectOpencode();
          const r = await installPlugin({ port: server.port as number, home: HOME, major: v?.major ?? 1 }, file);
          return json({ ok: true, ...r, installed: true, pluginPath: file, line: v?.major ?? 1, ...(v ? {} : { note: "opencode was not found, installed the 1.x plugin" }) });
        } catch (err: any) {
          return json({ error: err?.message ?? String(err) }, 500);
        }
      }
      if (path === "/api/integrations/grok/hook" && (req.method === "POST" || req.method === "DELETE")) {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const file = opts.grokHookFile ?? grokHookFile();
        try {
          if (req.method === "DELETE") return json({ ok: true, ...(await uninstallGrokHook(file)), installed: false, hookPath: file });
          const r = await installGrokHook(hookCommand("claude", { port: server.port as number, home: HOME }), file);
          return json({ ok: true, ...r, installed: true, hookPath: file });
        } catch (err: any) {
          return json({ error: err?.message ?? String(err) }, 500);
        }
      }

      if (path === "/api/integrations/claude/ask-hook" && (req.method === "POST" || req.method === "DELETE" || req.method === "PUT")) {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const file = pathFor("claude");
        try {
          if (req.method === "PUT") {
            const b = await readBody(req);
            if (typeof b?.onlyWhenAway !== "boolean") return json({ error: "onlyWhenAway must be true or false" }, 400);
            return json({ ok: true, installed: await isAskHookInstalled(file), ...(await askSettings.set({ onlyWhenAway: b.onlyWhenAway })) });
          }
          const r = req.method === "POST" ? await installAskHook(file, askHookCommand({ port: server.port as number, home: HOME })) : await uninstallAskHook(file);
          return json({ ok: true, changed: r.changed, installed: req.method === "POST", settingsPath: file, ...(await askSettings.get()) });
        } catch (err: any) {
          return json({ error: err?.message ?? String(err) }, 500);
        }
      }

      const hookRoute = path.match(/^\/api\/integrations\/(claude|codex)\/hook$/);
      if (hookRoute && (req.method === "POST" || req.method === "DELETE")) {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const tool = hookRoute[1] as HookTool;
        const file = pathFor(tool);
        try {
          const r = req.method === "POST" ? await installHook(file, hookCommand(tool, { port: server.port as number, home: HOME })) : await uninstallHook(file);
          return json({ ok: true, changed: r.changed, installed: req.method === "POST", settingsPath: file });
        } catch (err: any) {
          return json({ error: err?.message ?? String(err) }, 500);
        }
      }

      // ---- webhooks: Bearer key from the LAN, or the usual localhost rules ----
      const hookAuth = async (): Promise<Response | null> => {
        if (await webhookKey.check(req.headers.get("authorization"))) return guardPhone(server, req);
        if (isLocalPeer(server, req)) return guardLocal(server, req);
        return json({ error: "unauthorized: send Authorization: Bearer <webhook key>" }, 401);
      };
      const pushRoute = path.match(/^\/api\/push\/([^/]+)$/);
      if (pushRoute && req.method === "POST") {
        const denied = await hookAuth();
        if (denied) return denied;
        const key = decodeURIComponent(pushRoute[1]!);
        if (!PUSH_KEY_RE.test(key)) return json({ error: "invalid key" }, 400);
        const v = parsePushBody((await req.text()).slice(0, 4096), req.headers.get("content-type") ?? "");
        if (!v) return json({ error: "send a value as plain text or JSON {value, sub?, ttl?}" }, 400);
        pushes.set(key, v.value, { sub: v.sub, ttl: v.ttl });
        return json({ ok: true });
      }
      if (path === "/api/notify" && req.method === "POST") {
        const denied = await hookAuth();
        if (denied) return denied;
        const b = await readBody(req);
        if (typeof b?.title !== "string" || !b.title.trim()) return json({ error: "title is required" }, 400);
        if (b.level !== undefined && !["info", "warn", "alert"].includes(b.level)) return json({ error: "level must be info, warn or alert" }, 400);
        const n = addNote({ title: b.title.trim(), body: typeof b.body === "string" ? b.body : undefined, level: b.level, ttl: Number(b.ttl) || undefined, source: "webhook" });
        return json({ ok: true, id: n.id });
      }
      const gotoRoute = path.match(/^\/api\/goto\/([^/]+)$/);
      if (gotoRoute && req.method === "POST") {
        const denied = await hookAuth();
        if (denied) return denied;
        const pageId = decodeURIComponent(gotoRoute[1]!);
        if (!layout.pages.some((p) => p.id === pageId)) return json({ error: "no such page" }, 404);
        const c = Number(url.searchParams.get("countdown") ?? 0);
        if (!Number.isFinite(c) || c < 0 || c > 60) return json({ error: "countdown must be 0-60" }, 400);
        const body = await readBody(req);
        const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 80) : "webhook";
        broadcast({ type: "goto", pageId, countdown: Math.round(c), reason, revert: false });
        return json({ ok: true });
      }
      // On Air: GET the state and settings, PUT the settings (manage page); POST from anything with the webhook key (FR-12)
      if (path === "/api/onair" && req.method === "POST") {
        const denied = await hookAuth();
        if (denied) return denied;
        try { onair.setApi(await readBody(req)); } catch (err: any) { return json({ error: err?.message ?? String(err) }, 400); }
        return json({ ok: true, ...onair.snapshot() });
      }
      if ((path === "/api/onair" && req.method === "GET") || path === "/api/onair/settings") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        if (path === "/api/onair/settings" && req.method !== "PUT") return json({ error: "method not allowed" }, 405);
        if (req.method === "PUT") {
          try { await onair.setSettings(await readBody(req)); } catch (err: any) { return json({ error: err?.message ?? String(err) }, 400); }
          return json({ ...onair.snapshot(), settings: onair.settings() });
        }
        return json({ ...(await onair.current()), settings: onair.settings() });
      }
      if (path === "/api/webhooks" && req.method === "GET") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const key = await webhookKey.get();
        const info = await pairingInfo();
        return json({
          keyMasked: WebhookKey.mask(key),
          ...(url.searchParams.get("reveal") === "1" ? { key } : {}),
          examples: webhookExamples({ ip: info.lanIp, host: info.host, port: info.port, key: "<KEY>" }),
        });
      }
      if (path === "/api/webhooks/key/rotate" && req.method === "POST") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const key = await webhookKey.rotate();
        return json({ ok: true, key, keyMasked: WebhookKey.mask(key) });
      }
      if (path === "/api/notifications" && req.method === "GET") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        return json(notes.list());
      }
      if (path === "/api/weather/geocode" && req.method === "GET") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        try { return json(await weather.geocode(url.searchParams.get("q") ?? "")); }
        catch (err: any) { return json({ error: err?.message ?? String(err) }, 502); }
      }

      if (path.startsWith("/api/hass/")) {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        if (!hassClient) return json({ error: "Home Assistant client is not available" }, 501);
        const sub = path.slice("/api/hass/".length);
        if (["login", "logout", "callback"].includes(sub) && !hassClient.oauth) return json({ error: "Sign in with Home Assistant is not available" }, 501);
        if (sub === "callback" && req.method === "GET") {
          // the browser comes back from Home Assistant (a plain navigation: no CSRF header, but Host must be local)
          const u = new URL(req.url);
          const back = (q: string) => new Response(null, { status: 302, headers: { location: `/manage/#plugins/core.hass?${q}` } });
          const haError = u.searchParams.get("error");
          if (haError) return back(`hass=error&reason=${encodeURIComponent(haError.slice(0, 100))}`);
          try {
            await hassClient.oauth!.callback(u.searchParams.get("code"), u.searchParams.get("state"));
            await hassClient.reconfigure();
            return back("hass=ok");
          } catch (err: any) { return back(`hass=error&reason=${encodeURIComponent(String(err?.message ?? err).slice(0, 120))}`); }
        }
        try {
          if (sub === "config" && req.method === "GET") return json(await hassClient.status());
          if (sub === "config" && req.method === "PUT") {
            const b = await readBody(req);
            await hassClient.store.setUrl(b?.url);
            await hassClient.reconfigure();
            return json(await hassClient.status());
          }
          if (sub === "token" && req.method === "PUT") {
            const b = await readBody(req);
            await hassClient.store.setToken(b?.token);
            await hassClient.reconfigure();
            return json(await hassClient.status());
          }
          if (sub === "token" && req.method === "DELETE") {
            await hassClient.store.clearToken();
            await hassClient.reconfigure();
            return json(await hassClient.status());
          }
          if (sub === "test" && req.method === "POST") return json(await hassClient.test());
          // Sign in with Home Assistant (OAuth): the token itself is never in any answer
          if (sub === "login" && req.method === "POST") {
            const b = await readBody(req);
            const origin = `http://127.0.0.1:${server.port}`;
            return json(hassClient.oauth!.login(b?.url, origin));
          }
          if (sub === "status" && req.method === "GET") return json(await hassClient.oauthStatus());
          if (sub === "logout" && req.method === "POST") {
            await hassClient.oauth!.logout();
            await hassClient.reconfigure();
            return json(await hassClient.oauthStatus());
          }
          if (req.method === "GET" && (sub === "entities" || sub === "areas" || sub === "services")) {
            if (!hassClient.connected()) return json({ error: t("Home Assistant is not connected") }, 503);
            return json(await (sub === "entities" ? hassClient.entities() : sub === "areas" ? hassClient.areas() : hassClient.services()));
          }
        } catch (err: any) {
          const msg = err?.message ?? String(err);
          return json({ error: msg }, /not valid|required|must|do not put/.test(msg) ? 400 : 502);
        }
        return json({ error: "not found" }, 404);
      }

      if (path === "/api/pairing" || path === "/api/pairing/regenerate") {
        const denied = guardLocal(server, req);
        if (denied) return denied;
        const regen = path.endsWith("/regenerate");
        if (regen ? req.method !== "POST" : req.method !== "GET") return json({ error: "method not allowed" }, 405);
        if (regen) pairing.regenerate();
        return json(await pairingInfo(url.searchParams.get("all") === "1"));
      }

      if (path === "/editor" || path === "/editor/") {
        return new Response(null, { status: 302, headers: { location: "/manage/" } });
      }

      if (req.method === "GET" || req.method === "HEAD") {
        const asset = resolveAsset(path);
        if (asset) {
          if (asset.localOnly) {
            const denied = guardLocal(server, req);
            if (denied) return denied;
          } else {
            const bad = await guardPhone(server, req);
            if (bad) return bad;
          }
          const headers: Record<string, string> = { "content-type": asset.file.type, "cache-control": asset.cache };
          // text assets go out gzipped (the deck JS is ~420 KB raw, ~130 KB gzipped: a big difference on an old phone)
          if (COMPRESSIBLE.test(asset.file.type)) {
            headers.vary = "accept-encoding";
            if (/\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")) {
              let gz = gzCache.get(asset.file.path);
              if (!gz) {
                gz = Bun.gzipSync(new Uint8Array(await Bun.file(asset.file.path).arrayBuffer()));
                gzCache.set(asset.file.path, gz);
              }
              headers["content-encoding"] = "gzip";
              return new Response(req.method === "HEAD" ? null : (gz as unknown as BodyInit), { headers });
            }
          }
          return new Response(req.method === "HEAD" ? null : Bun.file(asset.file.path), { headers });
        }
      }
      return json({ error: "not found" }, 404);
    }),
    websocket: {
      // off: Bun never compressed our frames anyway (send() without the compress flag), and negotiating the extension only exposes
      // Safari's permessage-deflate bugs (WebKit 228296, 326651) to old iPhones
      perMessageDeflate: false,
      async open(ws) {
        if (!ws.data.deviceId) {
          ws.close(4401, "invalid token");
          return;
        }
        try {
          await withDevicesLock(async () => {
            const devices = await loadDevices();
            const d = devices.find((x) => x.id === ws.data.deviceId);
            if (d) {
              const t = Date.now();
              d.lastSeen = new Date(t).toISOString();
              d.expiresAt = expiryFrom(t);
              await saveDevices(devices);
            }
          });
        } catch (e) { console.error("lastSeen", e); }
        sockets.add(ws);
        send(ws, { type: "hello", deviceId: ws.data.deviceId, build: DECK_BUILD, pages: layout.pages.map((p) => ({ id: p.id, name: p.name })) });
        sendLayout(ws);
        send(ws, mediaMsg(tracker.current ?? null));
        send(ws, { type: "ai", ai: hub.snapshot() });
        for (const request of broker.list()) send(ws, { type: "permission", request });
        for (const request of questions.list()) send(ws, { type: "question", request });
        if (player.playing().length) send(ws, { type: "sounds-playing", ids: player.playing() });
        const pv = pushes.snapshot();
        if (Object.keys(pv).length) send(ws, { type: "pushed", values: Object.fromEntries(Object.entries(pv).map(([k, v]) => [k, { value: v.value, ...(v.sub ? { sub: v.sub } : {}), at: v.at }])) });
        send(ws, { type: "notifications", items: notes.list() });
        if (hassClient) send(ws, { type: "hass", entities: hassClient.snapshot(), connected: hassClient.connected() });
        send(ws, onair.snapshot());
        syncOnAirNeed();
        if (themeOverride) send(ws, { type: "theme-override", mode: themeOverride });
        { const pi = pluginRuntime.snapshot(); if (Object.keys(pi).length) send(ws, { type: "plugin", items: pi }); }
        pluginRuntime.setActive(true);
        void pushWeather(ws);
        if (!weatherTimer) weatherTimer = setInterval(() => void pushWeather(), opts.weatherMs ?? 15 * 60_000);
        startAi();
        if (!mediaTimer) {
          startMediaLoop();
        }
      },
      async message(ws, raw) {
        let msg: any;
        try { msg = JSON.parse(String(raw)); } catch { return; }
        if (msg?.type === "ping") return send(ws, { type: "pong" });
        if (msg?.type === "onair-watch") { ws.data.onairWatch = msg.on === true; return syncOnAirNeed(); }
        if (msg?.type === "viewport") {
          const w = Math.round(Number(msg.w)), h = Math.round(Number(msg.h));
          if (w >= 200 && w <= 4000 && h >= 200 && h <= 4000) ws.data.viewport = { w, h };
          return;
        }
        const reqId = msg?.reqId;
        if (msg?.type === "media" || msg?.type === "volume") {
          const c = parseControl(msg);
          if ("error" in c) return send(ws, { type: "result", reqId, ok: false, error: c.error });
          try {
            if (c.kind === "media" && c.command === "resume") await deps.resumeMedia(lastMedia.last?.app);
            else if (c.kind === "media" && c.command === "open") await deps.openMediaApp(c.app);
            else if (c.kind === "media") await deps.runAction({ type: "media", command: c.command });
            else await deps.setVolume("level" in c ? { level: c.level } : { muted: c.muted });
            send(ws, { type: "result", reqId, ok: true });
            refreshSoon(c.kind);
          } catch (err: any) {
            send(ws, { type: "result", reqId, ok: false, error: err?.message ?? String(err) });
          }
          return;
        }
        if (msg?.type === "permission-answer") {
          const d = msg.decision;
          if (typeof msg.id !== "string" || (d !== "allow" && d !== "deny")) {
            return send(ws, { type: "result", reqId, ok: false, error: "invalid permission answer" });
          }
          const ok = broker.answer(msg.id, d); // a "scope" field from older clients is ignored
          return send(ws, ok ? { type: "result", reqId, ok: true } : { type: "result", reqId, ok: false, error: t("request already handled or expired") });
        }
        if (msg?.type === "question-answer") {
          if (typeof msg.id !== "string") return send(ws, { type: "result", reqId, ok: false, error: "invalid question answer" });
          if (msg.release === true) {
            return send(ws, questions.release(msg.id) ? { type: "result", reqId, ok: true } : { type: "result", reqId, ok: false, error: t("question already answered or expired") });
          }
          const r = questions.answer(msg.id, msg.answers, msg.other);
          return send(ws, r.ok ? { type: "result", reqId, ok: true } : { type: "result", reqId, ok: false, error: r.error });
        }
        if (msg?.type === "processes") {
          const r = parseProcessesRequest(msg);
          if ("error" in r) return send(ws, { type: "result", reqId, ok: false, error: r.error });
          try {
            send(ws, { type: "processes", reqId, sort: r.sort, processes: await deps.topProcesses(r.sort, r.limit) });
          } catch (err: any) {
            send(ws, { type: "result", reqId, ok: false, error: err?.message ?? String(err) });
          }
          return;
        }
        if (msg?.type === "hass-control") {
          // the target is ONLY the entity of that layout item; the phone cannot name another one
          rules.pressed();
          try {
            const item = layout.pages.find((p) => p.id === msg.pageId)?.items.find((i) => i.id === msg.itemId);
            const entityId = item?.kind === "widget" && item.widget === "entity" ? item.entity?.id : item?.kind === "button" && item.action?.type === "hass" ? item.action.entityId : undefined;
            if (!entityId) throw new Error(t("this tile is not linked to a Home Assistant device"));
            if (item?.kind === "widget" && item.entity?.readOnly) throw new Error(t("this tile only shows status"));
            const plan = planControl(entityId, hass.getState(entityId), msg.op, msg.value, { valueUnit: tempUnitOf(msg.unit), deviceUnit: hass.systemTempUnit?.(), related: hass.related?.(entityId) });
            if ("error" in plan) throw new Error(plan.error);
            await execute({ type: "hass", service: plan.service, entityId: plan.entityId ?? entityId, ...(plan.data ? { data: plan.data } : {}) });
            send(ws, { type: "result", reqId, ok: true });
          } catch (err: any) {
            send(ws, { type: "result", reqId, ok: false, error: err?.message ?? String(err) });
          }
          return;
        }
        if (msg?.type === "plugin-card-action") {
          rules.pressed();
          try {
            await pluginRuntime.cardAction(msg.tile, msg.action, msg.args, (steps) => execute({ type: "macro", steps }, 0, ws));
            send(ws, { type: "result", reqId, ok: true });
          } catch (err: any) {
            send(ws, { type: "result", reqId, ok: false, error: err?.message ?? String(err) });
          }
          return;
        }
        if (msg?.type !== "press") return;
        const item = layout.pages.find((p) => p.id === msg.pageId)?.items.find((i) => i.id === msg.itemId);
        if (item?.kind === "widget" && item.widget === "entity" && item.entity) {
          rules.pressed();
          if (item.entity.readOnly) return send(ws, { type: "result", reqId, ok: false, error: t("this tile only shows status") });
          const p = entityPress(item.entity.id);
          if ("error" in p) return send(ws, { type: "result", reqId, ok: false, error: p.error });
          try {
            await execute({ type: "hass", service: p.service, entityId: p.entityId });
            return send(ws, { type: "result", reqId, ok: true });
          } catch (err: any) {
            return send(ws, { type: "result", reqId, ok: false, error: err?.message ?? String(err) });
          }
        }
        // an On Air tile set to "Tap turns On Air on or off" carries an onair action; other widgets have nothing to run
        const onairTile = item?.kind === "widget" && item.widget === "onair" && item.action?.type === "onair";
        if (!item || (item.kind !== "button" && !onairTile) || !item.action) {
          return send(ws, { type: "result", reqId, ok: false, error: "no action for this item" });
        }
        rules.pressed();
        try {
          await execute(item.action, 0, ws);
          send(ws, { type: "result", reqId, ok: true });
          // "Lock sleeps the phone": after a button that locks the computer, the presser (or every phone) goes to the black sleep screen
          if (isLockAction(item.action)) {
            const to = sleepTargets(layout.theme?.screen?.lockSleep);
            if (to === "all") broadcast({ type: "sleep" });
            else if (to === "presser") send(ws, { type: "sleep" });
          }
        } catch (err: any) {
          send(ws, { type: "result", reqId, ok: false, error: err?.message ?? String(err) });
        }
      },
      close(ws, code, reason) {
        sockets.delete(ws);
        syncOnAirNeed();
        if (unusualClose(code)) {
          console.error(`websocket closed by device ${ws.data.deviceId ?? "?"}: ${code}${reason ? " " + reason : ""}`);
          drops.add({ at: Date.now(), code, reason: String(reason ?? "").slice(0, 120), device: ws.data.deviceId ?? "?" });
        }
        if (sockets.size === 0 && mediaTimer) {
          stopMediaLoop();
        }
        stopAiIfIdle();
        if (sockets.size === 0) pluginRuntime.setActive(false);
        if (sockets.size === 0 && weatherTimer) { clearInterval(weatherTimer); weatherTimer = undefined; }
      },
    },
  });
  // phones set up over USB before: link them through the cable again when they are plugged in
  void androidUsb().start().catch((e) => console.error("android", e));

  return {
    server,
    port: server.port as number,
    get pin() { return pairing.pin; },
    pairing,
    /** Puts back a mic volume the Mic button set to 0 (NFR-6); the agent awaits it before exiting. */
    restoreMic: () => micControl.restore().then(() => {}, () => {}),
    onair,
    stop() {
      stopped = true;
      void lastMedia.persist(true);
      stopMediaLoop();
      pluginRuntime.stop();
      void pluginHosts.stopAll();
      void coreHost.deactivate();
      player.stopAll();
      stopCtl.abort();
      clearInterval(rulesTimer);
      if (weatherTimer) clearInterval(weatherTimer);
      pushes.close();
      unsubHass?.();
      hassClient?.stop();
      onair.dispose();
      if (aiSessionsTimer) clearInterval(aiSessionsTimer);
      if (aiQuotaTimer) clearInterval(aiQuotaTimer);
      broker.clear();
      questions.clear();
      stopStats();
      usbSetup?.stop();
      for (const ws of sockets) ws.close();
      server.stop(true);
    },
  };
}
