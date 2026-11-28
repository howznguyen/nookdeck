// Mirrors src/config.ts of the agent (that file imports node modules, so the types are duplicated here).
import type { CameraAction, MicAction, OnAirAction } from "@shared/onair";
import type { ScreenshotChoice, ScreenshotMode } from "@shared/screenshot";
export type Action =
  | { type: "open"; target: string }
  | { type: "hotkey"; keys: string }
  | { type: "type"; text: string }
  | { type: "shell"; command: string }
  | { type: "media"; command: "playpause" | "next" | "previous" }
  | { type: "volume"; command: "up" | "down" | "mute" }
  | { type: "page"; page: string }
  | { type: "sound"; sound: string; on?: SoundTarget; volume?: number; mode?: SoundMode }
  | { type: "sound-stop" }
  | { type: "lock" }
  | ({ type: "screenshot"; mode?: ScreenshotMode } & ScreenshotChoice)
  | { type: "hass"; service: string; entityId?: string; data?: Record<string, unknown> }
  | { type: "macro"; steps: MacroStep[] }
  | { type: "plugin"; plugin: string; action: string; settings?: Record<string, unknown> }
  | OnAirAction
  | MicAction
  | CameraAction;

export type SoundTarget = "mac" | "phone" | "both";
export type SoundMode = "overlap" | "restart" | "toggle";
/** An uploaded clip. `id` is the value stored in actions (`snd:<16hex>`). */
export interface Sound {
  id: string;
  name: string;
  size?: number;
  duration?: number;
  type?: string;
}

export type ActionType = Action["type"];
export const ACTION_TYPES: ActionType[] = ["open", "hotkey", "type", "shell", "media", "volume", "page", "sound", "sound-stop", "lock", "screenshot", "hass", "onair", "mic", "camera", "macro"];

export type AiProvider = "claude" | "codex" | "antigravity" | "opencode" | "grok";
export const AI_PROVIDERS: AiProvider[] = ["claude", "codex", "antigravity", "opencode", "grok"];
/** Providers whose quota can be read (Grok has no usage API). */
export const QUOTA_PROVIDERS: AiProvider[] = ["claude", "codex", "antigravity", "opencode"];

export type ClockStyle = "digital" | "flip" | "analog" | "minimal" | "word" | "world" | "weather" | "lunar" | "bloc" | "segment" | "ring" | "stack" | "ticks" | "dither";
export const CLOCK_STYLES: ClockStyle[] = ["digital", "flip", "analog", "minimal", "word", "world", "weather", "lunar", "bloc", "segment", "ring", "stack", "ticks", "dither"];
export interface ClockOptions {
  style?: ClockStyle;
  seconds?: boolean;
  hour12?: boolean;
  showDate?: boolean;
  timeZone?: string;
  zones?: string[];
  label?: string;
  /** weather style: where to read the weather (same shape as the weather widget's options) */
  weather?: WeatherOptions;
}

export type QuotaChart = "auto" | "bars" | "rings" | "gauge" | "meter" | "number" | "history";
export const QUOTA_CHARTS: QuotaChart[] = ["auto", "bars", "rings", "gauge", "meter", "number", "history"];
/** One Claude account (config folder) or Codex profile (CODEX_HOME), GET /api/ai/accounts. Local to the manage page. */
export interface AiAccountInfo {
  id: string;
  name: string;
  dir: string;
  isDefault: boolean;
  plan?: string;
  status?: "needs_login";
  stale?: boolean;
  error?: string;
  /** number of quota windows read */
  windows?: number;
}
export type AiAccountTool = "claude" | "codex";
export type AiAccounts = Record<AiAccountTool, AiAccountInfo[]>;

export interface QuotaOptions {
  chart?: QuotaChart;
  /** Which quota windows to show: all, the main one, or a list of window ids in display order (1-6, first is the main one). */
  windows?: "all" | "main" | string[];
  showReset?: boolean;
  account?: string;
}

export interface MacApp {
  name: string;
  bundleId: string;
  path?: string;
  /** App category (macOS LSApplicationCategoryType short id; Windows may send none). `bundleId` is the opaque app id on every platform. */
  category?: string;
}

export interface CatalogIcon {
  c: string;
  t: string[];
  /** Outline (stroke) inner markup; a few Tabler icons only have F. */
  O?: string;
  /** Filled inner markup. */
  F?: string;
}
/** A LobeHub brand mark: `color` marks ones that carry their own fills; the rest are monochrome (currentColor). */
export interface CatalogBrand {
  vb: string;
  body: string;
  color: boolean;
}
export interface IconCatalog {
  categories: string[];
  icons: Record<string, CatalogIcon>;
  brands?: Record<string, CatalogBrand>;
}

export type MetricChart = "sparkline" | "area" | "bars" | "gauge" | "ring" | "bar" | "number" | "donut";
export const METRIC_WIDGETS = ["cpu", "gpu", "memory", "network", "load"] as const;
export type MetricWidget = (typeof METRIC_WIDGETS)[number];
export const METRIC_CHARTS_FOR: Record<MetricWidget, MetricChart[]> = {
  cpu: ["sparkline", "area", "bars", "gauge", "ring", "bar", "number"],
  gpu: ["sparkline", "area", "bars", "gauge", "ring", "bar", "number"],
  memory: ["sparkline", "area", "bars", "gauge", "ring", "bar", "number", "donut"],
  network: ["sparkline", "area", "bars", "number"],
  load: ["sparkline", "area", "bars", "number"],
};
export const METRIC_WINDOWS = [60, 300, 900] as const;
export interface MetricOptions {
  chart?: MetricChart;
  window?: 60 | 300 | 900;
  showDelta?: boolean;
  showSub?: boolean;
}

export type WidgetKind = "clock" | "cpu" | "gpu" | "memory" | "uptime" | "load" | "network" | "nowplaying" | "quota" | "sessions" | "entity" | "weather" | "value" | "notifications" | "plugin" | "onair";
export const WIDGET_KINDS: WidgetKind[] = ["clock", "cpu", "gpu", "memory", "uptime", "load", "network", "nowplaying", "quota", "sessions", "entity", "weather", "value", "notifications", "onair"];
/** A plugin tile or button points at the plugin by id (see GET /api/plugins). */
export interface PluginRef { id: string; widget: string; settings?: Record<string, unknown>; /** How the tile is drawn; omit for the manifest suggestion or the renderer default. */ view?: { style?: string } }

export interface WeatherOptions {
  source?: "auto" | "hass" | "open-meteo";
  entity?: string;
  location?: { name: string; lat: number; lon: number };
  show?: "now" | "hourly" | "daily" | "auto";
  units?: "metric" | "imperial";
}
export interface PushOptions { key: string; label?: string; unit?: string }

export type MacroStep =
  | { kind: "hotkey"; keys: string }
  | { kind: "type"; text: string }
  | { kind: "wait"; ms: number }
  | { kind: "open"; target: string }
  | { kind: "shell"; command: string }
  | { kind: "media"; command: "playpause" | "next" | "previous" }
  | { kind: "volume"; command: "up" | "down" | "mute" }
  | { kind: "hass"; service: string; entityId?: string; data?: Record<string, unknown> }
  | { kind: "item"; pageId: string; itemId: string }
  | { kind: "lock" }
  | { kind: "screenshot"; mode?: ScreenshotMode }
  | { kind: "notify"; text: string };
export const MACRO_MAX_STEPS = 20;
export const MACRO_MAX_WAIT_MS = 30000;

export type RuleWhen =
  | { kind: "ai-waiting"; provider?: "claude" | "codex"; includePrompts?: boolean }
  | { kind: "media-playing" }
  | { kind: "media-stopped" }
  | { kind: "cpu-above"; percent: number; forSec?: number }
  | { kind: "quota-above"; provider: "claude" | "codex" | "antigravity"; percent: number }
  | { kind: "time-between"; from: string; to: string; days?: number[] }
  | { kind: "push"; key: string; op?: "=" | "!=" | ">" | "<"; value?: string | number }
  | { kind: "hass-state"; entityId: string; state: string }
  | { kind: "idle"; minutes: number };
export type RuleThen =
  | { kind: "goto-page"; pageId: string; countdown?: number }
  | { kind: "notify"; text: string; level?: "info" | "warn" | "alert" }
  | { kind: "theme-mode"; mode: "dark" | "light" }
  | { kind: "run-item"; pageId: string; itemId: string };
export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  when: RuleWhen;
  then: RuleThen[];
  revert?: boolean;
}
export const RULES_MAX = 40;

export interface GeoPlace { name: string; lat: number; lon: number; detail?: string }
export interface WebhookInfo {
  /** Key with the middle hidden; the full key is only fetched on demand (copy). */
  keyMasked: string;
  /** curl examples from the agent with "<KEY>" as the placeholder, using its LAN IP and .local name. */
  examples: string[];
}

/** Home Assistant entity tile options. */
export interface EntityOptions {
  id: string;
  name?: string;
  readOnly?: boolean;
  show?: "auto" | "state" | "value" | "toggle";
  /** Tap action for domains with a detail sheet: open the control sheet or just toggle. */
  tap?: "sheet" | "toggle";
  /** Show the domain's controls on the tile itself when it is big enough. */
  inlineControls?: boolean;
  /** camera.*: seconds between pictures on the tile, 5 to 60 (default 10) */
  refresh?: number
}

export interface HassConfig {
  url: string;
  hasToken: boolean;
  connected: boolean;
  error?: string;
  version?: string;
}
/** GET /api/hass/status once the agent supports "Sign in with Home Assistant". */
export interface HassStatus {
  connected: boolean;
  /** "oauth" = signed in with Home Assistant, "token" = a long-lived access token. */
  mode?: "oauth" | "token";
  haName?: string;
  haVersion?: string;
  user?: string;
  error?: string;
}
export interface HassEntity {
  id: string;
  name: string;
  domain: string;
  area?: string;
  state?: string;
  icon?: string;
}
export interface HassService {
  id: string;
  name?: string;
  description?: string;
}

export interface Size {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export type TileStyle = "tint" | "solid" | "outline" | "ios";
export const TILE_STYLES: TileStyle[] = ["tint", "solid", "outline", "ios"];

export interface ItemStyle {
  style?: TileStyle;
  textColor?: string;
  hideLabel?: boolean;
}

export type Item =
  | ({ id: string; kind: "button"; label: string; icon?: string; color?: string; action?: Action } & Size & ItemStyle)
  | ({ id: string; kind: "widget"; widget: WidgetKind; color?: string; provider?: AiProvider; clock?: ClockOptions; metric?: MetricOptions; quota?: QuotaOptions; entity?: EntityOptions; weather?: WeatherOptions; push?: PushOptions; plugin?: PluginRef; action?: Action } & Size & ItemStyle);

export type ThemeOrientation = "landscape" | "portrait" | "auto";

export interface ScreenSettings {
  lite?: "auto" | "on" | "off";
  keepAwake?: boolean;
  /** Move the grid by up to 2 px every 3 minutes against burn-in. Missing = off. */
  burnInShift?: boolean;
  /** Swiping past the last page goes to the first, and back. Missing = off. */
  wrap?: boolean;
  /** Hide the page dots; they show for a moment while swiping. Missing = shown. */
  hideDots?: boolean;
  /** After a button that locks the computer: the phone that pressed it goes black (default), every phone, or none. */
  lockSleep?: "phone" | "all" | "off";
  /** the screenshot tool of buttons that do not pick their own; missing = the first installed known app, else the system tool */
  screenshot?: ScreenshotChoice;
  standby?: { enabled: boolean; afterMin: number; style: "digital" | "analog" | "words"; showDate?: boolean; showNext?: boolean };
  /** Black overlay opacity 0..0.9; from/to "HH:MM" is the schedule (may wrap midnight); both missing = never auto-dim. */
  dim?: { level: number; from?: string; to?: string };
}

export type AlarmSoundId = "chime" | "birds" | "soft" | "none";
export interface Alarm {
  id: string;
  time: string;
  /** 0=Sun..6=Sat; missing or empty = once. */
  days?: number[];
  label?: string;
  enabled: boolean;
  sound: AlarmSoundId;
  sunriseMin: number;
  snoozeMin: number;
  /** Device ids; missing or empty = every phone. */
  devices?: string[];
}
export const ALARMS_MAX = 20;

export interface Theme {
  /** UI language for this page and the phone overlay; missing means English. */
  language?: "en" | "vi" | "zh" | "fr" | "pt";
  /** Unit for every temperature on the phone; missing means Celsius. A weather widget's own `units` wins for that widget. */
  temperatureUnit?: "c" | "f";
  /** Look for a newer Nookdeck once a day; missing means on. */
  updateCheck?: boolean;
  /** Phone screen behaviour: lite mode, keep awake, standby clock, dimming. */
  screen?: ScreenSettings;
  /** Top bar on the phone: full (default), minimal (no computer name or CPU/RAM) or hidden. */
  header?: "full" | "minimal" | "hidden";
  mode?: "dark" | "light" | "auto";
  accent?: string;
  background?: string;
  tile?: string;
  radius?: number;
  gap?: number;
  fontScale?: number;
  tileStyle?: TileStyle;
  iconScale?: number;
  /** Outline icon stroke width, 1-3 (default 2.25). */
  iconStroke?: number;
  showLabels?: boolean;
  text?: string;
  /** Secondary text colour. */
  muted?: string;
  orientation?: ThemeOrientation;
  // Look fields added with theme packages (specs/plugin-system D14). All optional; system font stacks only.
  font?: ThemeFont;
  numberFont?: ThemeFont;
  /** An uploaded image id (GET /api/icons) or a theme package file. */
  backgroundImage?: string;
  backgroundFit?: "cover" | "contain" | "tile";
  /** 0 to 0.9 */
  backgroundDim?: number;
  /** px, 0 to 30 */
  backgroundBlur?: number;
  gradient?: { from: string; to: string; angle: number };
  /** 0.05 to 1 */
  tileOpacity?: number;
  /** px, 0 to 30 */
  tileBlur?: number;
  border?: { width: number; color?: string };
  shadow?: "none" | "soft" | "strong";
  labelPosition?: "bottom" | "top" | "hidden";
  labelWeight?: "regular" | "medium" | "bold";
  iconStyle?: "line" | "filled";
  palette?: { ok?: string; warn?: string; error?: string; info?: string };
  /** Up to 6 series colours */
  chartColors?: string[];
  /** Which theme pack, variant and options are applied, when one is. */
  source?: ThemeSource;
}
export type ThemeFont = "system" | "rounded" | "mono" | "serif" | "condensed";
/** The look fields (no behaviour): what a theme package carries and what one screen can override with page.theme. */
export type ThemeLook = Pick<Theme, "mode" | "accent" | "background" | "tile" | "text" | "muted" | "radius" | "gap" | "fontScale" | "tileStyle" | "iconScale" | "iconStroke" | "showLabels" | "font" | "numberFont" | "backgroundImage" | "backgroundFit" | "backgroundDim" | "backgroundBlur" | "gradient" | "tileOpacity" | "tileBlur" | "border" | "shadow" | "labelPosition" | "labelWeight" | "iconStyle" | "palette" | "chartColors">;

export interface Page {
  id: string;
  name: string;
  columns: number;
  rows: number;
  items: Item[];
  /** A partial look for this screen only (same fields as the theme's look). */
  theme?: Partial<ThemeLook>;
}

export interface Layout {
  version: 1;
  theme?: Theme;
  pages: Page[];
  rules?: Rule[];
  alarms?: Alarm[];
  /** Icon images the deck needs (app icons, uploads), keyed by icon value; only sent to the preview, never saved by this page. */
  assets?: Record<string, unknown>;
}

export interface DeviceInfo {
  id: string;
  name: string;
  createdAt: string;
  lastSeen?: string;
  /** When the pairing lapses if the device is not used (ISO string or epoch ms). */
  expiresAt?: string | number;
  online?: boolean;
  /** The phone's screen in CSS px, as its deck reported it (online phones only). */
  viewport?: { w: number; h: number };
}

export type PairAddressKind = "local" | "lan" | "tailscale" | "vpn" | "other";

export interface PairAddress {
  id: string;
  kind: PairAddressKind;
  host: string;
  label: string;
  note?: string;
}

export interface Pairing {
  pin: string;
  /** Every address a phone could use; missing on older agents. */
  addresses?: PairAddress[];
  defaultAddress?: string;
  /** Link using the IP address. */
  url: string;
  /** Link using the .local name (http://<name>.local:<port>/?pin=...), when the agent has one. */
  urlLocal?: string;
  lanIp?: string;
  port?: number;
}

export const THEME_DEFAULTS = {
  mode: "dark" as const,
  accent: "#22d3ee",
  background: "#0b0b0d",
  tile: "#141417",
  radius: 14,
  gap: 10,
  fontScale: 1,
  tileStyle: "tint" as TileStyle,
  iconScale: 1,
  iconStroke: 2.25,
  showLabels: true,
  orientation: "landscape" as ThemeOrientation,
};

export const MAX_COLUMNS = 12;
export const MAX_ROWS = 8;

/** What GET /api/integrations returns for one tool, after normalising (see api.ts). */
export type DoctorStatus = "ok" | "missing" | "denied" | "unknown" | "n/a";
/** One macOS permission / dependency check from GET /api/doctor. */
export interface DoctorItem {
  id: string;
  status: DoctorStatus;
  name?: string;
  detail?: string;
  fix?: { text: string; settingsUrl?: string };
}

/** GET /api/about: what is running and where it comes from. */
export interface About {
  version: string;
  commit?: string;
  /** Built from a working tree with uncommitted changes: the commit does not match the code. */
  dirty?: boolean;
  buildDate?: string;
  platform?: string;
  arch?: string;
  /** Repository web URL, no trailing slash. */
  repo: string;
}

/** GET /api/update. */
export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  checkedAt: number | null;
  enabled: boolean;
  error?: string;
}

export interface Integration {
  id: AiProvider;
  name: string;
  /** Quota readable? "ok", "error" or "unknown" (not reported / not installed). */
  status: "ok" | "error" | "unknown";
  error?: string;
  plan?: string;
  updatedAt?: string;
  /** Where the quota comes from. */
  source?: "oauth" | "local" | "claude-code" | "codex" | "agy";
  /** Human reason the agent gives for where the quota comes from (read-only, no sign-in in Nookdeck). */
  reason?: string;
  /** Quota windows as in the WebSocket "ai" message: usedPercent 0-100. */
  windows: { id: string; label: string; usedPercent: number; resetsAt?: string }[];
  hook?: { supported: boolean; enabled: boolean; settingsPath?: string };
  /** OpenCode and Grok: the tool is installed on this machine, its version (OpenCode), major line and running-session count. */
  cliInstalled?: boolean;
  version?: string;
  line?: number;
  sessions?: number;
  /** Why there is no quota (e.g. "Grok has no usage API"). */
  quotaReason?: string;
  /** Claude only: answer AskUserQuestion on the phone (separate PreToolUse hook). */
  askHook?: { enabled: boolean; idleOnly: boolean };
}


// Plugins (GET /api/plugins). Mirrors the manifest of specs/plugin-system; the agent adds enabled, granted and the saved settings.
export type PluginFieldType = "string" | "number" | "boolean" | "select" | "secret" | "entity";
export interface PluginField {
  key: string;
  type: PluginFieldType;
  label: string;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  /** select: the choices come from the plugin's code (POST /api/plugins/:id/options) when the form opens. */
  optionsFrom?: string;
  /** A secret that already has a value on the agent (the value itself is never sent back). */
  isSet?: boolean;
}
export interface PluginPermissions {
  /** Host names (fetch) and WebSocket origins like ws://127.0.0.1:4455. */
  network: string[];
  shell: boolean;
  keyboard: boolean;
  storage: boolean;
  /** May turn On Air on (the OBS plugin reports live / recording). */
  onair: boolean;
  /** May show notifications on the phones, with a sound (a reminder plugin). */
  notify: boolean;
}
/** One plugin of the community registry (GET /api/plugins/registry). Entries carry no tiles or buttons: see RegistryManifest. */
export interface RegistryEntry {
  /** The systems it works on ("darwin" ...); missing = every one. */
  os?: string[];
  /** Why this computer cannot install it. */
  unavailable?: string;
  id: string;
  name: string;
  version: string;
  /** The plugin's repository (https). */
  repo: string;
  author?: string;
  description?: string;
  /** https URL or an icon name; the card falls back to a puzzle piece. */
  icon?: string;
  /** A picture of the plugin, used when a tile has no sample data. */
  screenshot?: string;
  tier?: string;
  /** tier "verified" (or the registry's own verified flag). */
  verified: boolean;
  /** What the registry says it asks for, when it says; the manifest is the authority. */
  permissions?: PluginPermissions;
  installed: boolean;
  installedVersion?: string;
  updateAvailable: boolean;
  /** Set by the page: installed from a link or folder, not from the Store, so the Store version is a switch, not an update. */
  fromLink?: boolean;
}
export interface RegistryResult {
  plugins: RegistryEntry[];
  /** The agent could not reach the registry and sent its saved copy. */
  stale: boolean;
  fetchedAt?: number;
}
export interface TileDef {
  id: string;
  name: string;
  render: string;
  /** "2x1"; the first is the default. */
  sizes?: string[];
  /** Sample data for the renderer, shown on the card. */
  preview?: unknown;
}
/** GET /api/plugins/registry/:id/manifest: what a not-yet-installed plugin adds and asks for. */
export interface RegistryManifest {
  /** The systems it works on ("darwin" ...); missing = every one. */
  os?: string[];
  /** Why this computer cannot install it. */
  unavailable?: string;
  id: string;
  name: string;
  version: string;
  registryVersion?: string;
  permissions: PluginPermissions;
  permissionLines: string[];
  widgets: TileDef[];
  actions: { id: string; name: string }[];
  main: string | null;
}

/** Process state of a code plugin (the agent runs each in its own process). */
export type PluginProcessState = "running" | "stopped" | "crashed" | "failed";
export interface PluginProcess {
  state: PluginProcessState;
  pid?: number;
  /** Crashes in a row since the last good run. */
  restarts?: number;
  /** Epoch ms when the current process started. */
  startedAt?: number;
  lastError?: string;
}
export interface PluginInfo {
  /** The systems it works on ("darwin" ...); missing = every one. */
  os?: string[];
  /** Reviewed through the registry (not just installed from a link). */
  reviewed?: boolean;
  registryVersion?: string;
  /** The plugin has code (its manifest sets "main"); only those have a process. */
  code?: boolean;
  /** Ships with Nookdeck (core.weather ...): cannot be removed, is never "unreviewed", has no install source. */
  builtin?: boolean;
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  author?: string;
  source?: string;
  enabled: boolean;
  /** Everything installed from a link or folder is unreviewed (the agent says so). */
  unreviewed: boolean;
  /** The manifest asks for something that is not granted yet. */
  needsApproval: boolean;
  /** Set when the plugin is installed but cannot run, for example "files changed, disabled". */
  error?: string;
  permissions: PluginPermissions;
  granted: PluginPermissions;
  widgets: { id: string; name: string; render: string; sizes: string[]; settings: PluginField[]; preview?: unknown; style?: string }[];
  actions: { id: string; name: string; settings: PluginField[] }[];
  themes: { id: string; name: string; theme: Theme }[];
  layouts: { id: string; name: string; layout: Layout }[];
  /** Plugin-level fields (optional manifest "settings") and their saved values. */
  fields: PluginField[];
  settings: Record<string, unknown>;
}

// Theme packs (GET /api/themes). A pack holds 1 to 12 variants and optional choices (options); see specs/plugin-system D14 to D16.
export interface ThemeVariantInfo { id: string; name: string; mode: "light" | "dark"; look: Partial<ThemeLook>; preview?: string; /** The agent found that the declared mode does not match the colours. */ modeMismatch?: boolean }
export interface ThemeOptionValue { id: string; name: string; theme?: Partial<ThemeLook>; variants?: Record<string, Partial<ThemeLook>> }
export interface ThemeOptionInfo { id: string; name: string; values: ThemeOptionValue[] }
export interface ThemeSource { pack: string; variant?: string; auto?: { light: string; dark: string }; options?: Record<string, string> }
export interface ThemePack {
  id: string; name: string; version: string; author?: string; description?: string; preview?: string; repo?: string;
  variants: ThemeVariantInfo[]; options: ThemeOptionInfo[]; auto?: { light: string; dark: string };
  hasCss: boolean; fonts: string[]; icons: string[];
  builtin: boolean; installed: boolean; installedVersion?: string; updateAvailable: boolean;
  /** This pack is the one applied now; appliedOlder: an older version of it is applied (offer Re-apply). */
  applied: boolean; appliedOlder: boolean; reviewed: boolean;
  /** Not installed, but the agent holds its files for a live preview (POST /api/themes/<id>/preview), so it can be drawn on the user's screen. */
  live?: boolean;
}
export interface ThemesResult { packs: ThemePack[]; applied: ThemeSource | null }
