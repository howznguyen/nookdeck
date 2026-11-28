import { PLUGIN_STYLES } from "../web/shared/plugin-styles";
import { validOnairAction, type CameraAction, type MicAction, type OnAirAction } from "../web/shared/onair";
import { LOCK_SLEEP, isLockKeys, type LockSleep } from "../web/shared/lock";
import { SCREENSHOT_MODES, SCREENSHOT_TOOLS, screenshotModeForKeys, type ScreenshotChoice, type ScreenshotMode } from "../web/shared/screenshot";
import { userHome } from "./home";
import "./compat";

import { join } from "node:path";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { ICON_ALIASES } from "../web/shared/icons";
import { macroSteps, pushOptions, validateRules, weatherOptions, type MacroStep, type PushOptions, type Rule, type WeatherOptions } from "./automation";
export type { MacroStep, PushOptions, Rule, WeatherOptions } from "./automation";

export type Action =
  | { type: "open"; target: string }
  | { type: "hotkey"; keys: string }
  | { type: "type"; text: string }
  /** `env`: set only by the plugin runtime (values of a plugin's settings as NOOKDECK_SETTING_<KEY>); never read from a layout file. */
  | { type: "shell"; command: string; env?: Record<string, string> }
  | { type: "media"; command: "playpause" | "next" | "previous" }
  | { type: "volume"; command: "up" | "down" | "mute" }
  | { type: "page"; page: string }
  /** Soundboard: play an uploaded clip (~/.nookdeck/sounds/<id>.<ext>) on the Mac (afplay), the phone, or both. */
  | { type: "sound"; sound: string; on?: SoundTarget; volume?: number; mode?: SoundMode }
  | { type: "sound-stop" }
  /** Lock the computer: ctrl+cmd+q on macOS, LockWorkStation on Windows, loginctl / xdg-screensaver on Linux (src/actions.ts buildCommand). */
  | { type: "lock" }
  /**
   * Take a screenshot with a tool (web/shared/screenshot.ts): the system one (the Screenshot app on macOS, Snipping on Windows, the
   * desktop's tool on Linux), a known app, the person's shortcut (keys) or a command. No tool: the screen's default (src/screenshot.ts).
   */
  | ({ type: "screenshot"; mode?: ScreenshotMode } & ScreenshotChoice)
  /** Home Assistant service call through the agent's HA connection, e.g. {service:"scene.turn_on", entityId:"scene.movie"}. */
  | { type: "hass"; service: string; entityId?: string; data?: Record<string, unknown> }
  /** Several steps in order (keys, text, waits, other buttons, HA calls…), see src/automation.ts. */
  | { type: "macro"; steps: MacroStep[] }
  /** On Air (manual source), the computer's mic mute, and the meeting app's camera (src/onair.ts, src/mic-camera.ts). */
  | OnAirAction | MicAction | CameraAction
  /** A no-code action of an installed plugin (src/plugins). `settings` override the plugin's own for this button. */
  | { type: "plugin"; plugin: string; action: string; settings?: Record<string, string | number | boolean> };

/** Plugin ids are reverse-DNS style ("dev.author.name"); "core.*" is reserved for plugins that ship with Nookdeck. */
export const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}(\.[a-z0-9][a-z0-9_-]{0,47}){1,4}$/;
export const PLUGIN_PART_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
/** A plugin widget on a tile: which plugin and widget, and the tile's own settings. */
/** Display styles per renderer (one table in web/shared/plugin-styles.ts, shared with the deck and the manage picker): the first is the default. A tile picks one with plugin.view.style; a manifest can suggest one with widgets[].style. */
export const STYLES: Record<string, string[]> = PLUGIN_STYLES;
export const ALL_STYLES: string[] = [...new Set(Object.values(STYLES).flat())];

export interface PluginRef { id: string; widget: string; settings?: Record<string, string | number | boolean>; view?: { style?: string } }

export const HASS_ENTITY_RE = /^[a-z_]+\.[a-z0-9_]+$/;
export const HASS_SERVICE_RE = /^[a-z_]+\.[a-z0-9_]+$/;

/** Home Assistant entity tile: live state; tapping toggles/activates it when the domain allows (unless readOnly). */
export interface EntityOptions {
  id: string;            // entity_id, e.g. "light.living_room"
  name?: string;         // display name override
  readOnly?: boolean;    // show state only
  show?: "auto" | "state" | "value" | "toggle"; // auto: toggle for switchable domains, value for sensors
  /** What a tap does for climate/light/fan/cover/vacuum: open the control sheet (default) or just toggle. */
  tap?: "sheet" | "toggle";
  /** Show -/+ or a slider on the tile itself when it is big enough (default true). */
  inlineControls?: boolean;
  /** camera.*: seconds between pictures on the tile, 5 to 60 (default 10). */
  refresh?: number;
}

export type SoundTarget = "mac" | "phone" | "both";
export type SoundMode = "overlap" | "restart" | "toggle";
export const SOUND_ID_RE = /^snd:[a-f0-9]{16}$/;

/** nowplaying = current track + transport + volume (agent sends {type:"media"}); network = rx/tx rates. */
export type WidgetKind = "clock" | "cpu" | "gpu" | "memory" | "uptime" | "load" | "network" | "nowplaying" | "quota" | "sessions" | "entity" | "weather" | "value" | "notifications" | "plugin" | "onair";

/** AI coding tools Nookdeck reads quotas/sessions from. A "quota" widget shows one provider (item.provider). */
export type AiProvider = "claude" | "codex" | "antigravity" | "opencode" | "grok";
export const AI_PROVIDERS: AiProvider[] = ["claude", "codex", "antigravity", "opencode", "grok"];

/**
 * Tile placement on the page grid: x/y = top-left cell (0-based), w/h = span in cells (default 1x1).
 * validateLayout always returns x and y (it auto-places items that have none, in order).
 */
export interface Size { x?: number; y?: number; w?: number; h?: number }

/** How a coloured tile is painted: tint = soft fill + coloured border/icon, solid = full fill, outline = border + icon only. */
/** ios = Shortcuts-style button: coloured squircle with a vertical gradient, white glyph, label under the tile. */
export type TileStyle = "tint" | "solid" | "outline" | "ios";
export const TILE_STYLES: TileStyle[] = ["tint", "solid", "outline", "ios"];

/** Per-tile look overrides. Unset fields fall back to the theme. */
export interface ItemStyle {
  style?: TileStyle;
  textColor?: string;   // label/value colour
  hideLabel?: boolean;  // icon only (buttons) / value only (widgets)
}

export type Item =
  | ({ id: string; kind: "button"; label: string; icon?: string; color?: string; action?: Action } & Size & ItemStyle)
  | ({ id: string; kind: "widget"; widget: WidgetKind; color?: string; provider?: AiProvider; clock?: ClockOptions; metric?: MetricOptions; quota?: QuotaOptions; entity?: EntityOptions; weather?: WeatherOptions; push?: PushOptions; plugin?: PluginRef; /** On Air tiles only: "Tap turns On Air on or off" ({type:"onair"}) */ action?: Action } & Size & ItemStyle);

/**
 * Quota widget looks. auto (default) picks by tile width: ring on small tiles, bars when wide, meter when wide and tall.
 * bars = one horizontal bar per window, rings = concentric rings (Knowns goal-rings), gauge = arc of the main window,
 * meter = Knowns usage-meter card, number = percentage only, history = usage over the last hours (sparkline per window).
 */
export type QuotaChart = "auto" | "bars" | "rings" | "gauge" | "meter" | "number" | "history";
export const QUOTA_CHARTS: QuotaChart[] = ["auto", "bars", "rings", "gauge", "meter", "number", "history"];
export interface QuotaOptions {
  chart?: QuotaChart;
  /**
   * Which usage windows to show: "all", "main" (5 h for Claude), or a list of window ids in display order
   * (ids as the agent reports them, e.g. "five_hour", "seven_day", "seven_day_opus", "primary", "secondary").
   * Unknown ids are skipped at render time (a provider may not have that window today).
   */
  windows?: "all" | "main" | string[];
  showReset?: boolean;       // reset countdown, default true
  account?: string;          // pin one account id when the provider has several
}

/**
 * How a metric widget (cpu, memory, network, load) is drawn. Every chart comes from the Knowns UI chart family.
 * sparkline = line + end dot, area = filled sparkline, bars = column history, gauge = 0-100 arc,
 * ring = progress ring, bar = one horizontal meter, number = value only, donut = used/free split (memory).
 */
export type MetricChart = "sparkline" | "area" | "bars" | "gauge" | "ring" | "bar" | "number" | "donut";
export const METRIC_CHARTS: MetricChart[] = ["sparkline", "area", "bars", "gauge", "ring", "bar", "number", "donut"];
export const METRIC_WIDGETS = ["cpu", "gpu", "memory", "network", "load"] as const;
/** Charts that need a 0-100 scale are not offered for network/load (they have no fixed maximum). */
export const METRIC_CHARTS_FOR: Record<(typeof METRIC_WIDGETS)[number], MetricChart[]> = {
  cpu: ["sparkline", "area", "bars", "gauge", "ring", "bar", "number"],
  gpu: ["sparkline", "area", "bars", "gauge", "ring", "bar", "number"],
  memory: ["sparkline", "area", "bars", "gauge", "ring", "bar", "number", "donut"],
  network: ["sparkline", "area", "bars", "number"],
  load: ["sparkline", "area", "bars", "number"],
};
export const METRIC_WINDOWS = [60, 300, 900] as const; // seconds of history: 1, 5, 15 min

export interface MetricOptions {
  chart?: MetricChart;       // default: cpu gauge on square-ish tiles else sparkline; memory/network/load sparkline
  window?: 60 | 300 | 900;   // history shown by sparkline/area/bars, default 120 s worth of 2 s samples
  showDelta?: boolean;       // the change pill, default true
  showSub?: boolean;         // the secondary line ("/ 16 GB", "↑ tx"), default true when it fits
}

/**
 * Clock widget looks. digital = big thin digits (default), flip = split-flap cards, analog = dial with hands,
 * minimal = time only, word = the time written out in words ("ten to five", or in Vietnamese "mười giờ kém năm"), world = several time zones,
 * weather = time with the current weather (served by core.weather, see legacyRef), lunar = time with the lunar date and can chi,
 * bloc = a tear-off wall calendar page (lịch bloc), segment = 7-segment LED digits, ring = time inside a seconds ring, stack = hours over minutes.
 */
export type ClockStyle = "digital" | "flip" | "analog" | "minimal" | "word" | "world" | "weather" | "lunar" | "bloc" | "segment" | "ring" | "stack" | "ticks" | "dither";
export const CLOCK_STYLES: ClockStyle[] = ["digital", "flip", "analog", "minimal", "word", "world", "weather", "lunar", "bloc", "segment", "ring", "stack", "ticks", "dither"];

export interface ClockOptions {
  style?: ClockStyle;      // default "digital"
  seconds?: boolean;       // default true on big tiles
  hour12?: boolean;        // default false (24 h)
  showDate?: boolean;      // default true on big tiles
  timeZone?: string;       // IANA name, default the phone's zone (world: the first zone)
  zones?: string[];        // world style: up to 4 extra IANA zones
  label?: string;          // optional caption, e.g. "Tokyo"
  weather?: WeatherOptions; // weather style: where and how to fetch (same shape as the weather widget's options)
}

/** Overrides of the deck's design tokens (Knowns look). Unset fields use the built-in token values. */
export const FONTS = ["system", "rounded", "mono", "serif", "condensed"] as const;
export type FontKind = (typeof FONTS)[number];
export type PaletteKey = "ok" | "warn" | "error" | "info";
/** Every look field, in the order the manage Theme page shows them: what a theme package carries and what `page.theme` may override. Behaviour fields (language, orientation, header, screen, updateCheck, temperatureUnit) are not here. */
export const LOOK_KEYS = [
  "mode", "accent", "background", "tile", "text", "muted", "radius", "gap", "fontScale", "tileStyle", "iconScale", "iconStroke", "showLabels",
  "font", "numberFont", "backgroundImage", "backgroundFit", "backgroundDim", "backgroundBlur", "gradient", "tileOpacity", "tileBlur",
  "border", "shadow", "labelPosition", "labelWeight", "iconStyle", "palette", "chartColors",
] as const;
export type LookKey = (typeof LOOK_KEYS)[number];
/** The look fields added with theme packages (all optional). */
export interface LookExtra {
  /** a system stack, or "pkg:<Family>" for a font the theme package declares in `fonts` */
  font?: string;
  numberFont?: string;
  /** "theme:<id>/<file>" (a file of an installed theme package) or "img:<id>" (an uploaded image). */
  backgroundImage?: string;
  backgroundFit?: "cover" | "contain" | "tile";
  backgroundDim?: number;   // 0-0.9
  backgroundBlur?: number;  // px, 0-30
  gradient?: { from: string; to: string; angle: number };
  tileOpacity?: number;     // 0.05-1
  tileBlur?: number;        // px, 0-30
  border?: { width: number; color?: string };
  shadow?: "none" | "soft" | "strong";
  labelPosition?: "bottom" | "top" | "hidden";
  labelWeight?: "regular" | "medium" | "bold";
  iconStyle?: "line" | "filled";
  palette?: Partial<Record<PaletteKey, string>>;
  chartColors?: string[];   // up to 6
}
export type Look = Partial<Pick<Theme, "mode" | "accent" | "background" | "tile" | "text" | "muted" | "radius" | "gap" | "fontScale" | "tileStyle" | "iconScale" | "iconStroke" | "showLabels">> & LookExtra;

export const TILE_KINDS = ["button", "clock", "metric", "media", "weather", "quota", "entity", "plugin", "folder", "header", "standby", "sheet"] as const;
export type TileKind = (typeof TILE_KINDS)[number];
/** State tokens of one tile kind (pressed, active = on / playing, alert). */
export interface StateLook { tile?: string; text?: string; accent?: string; border?: { width: number; color?: string }; shadow?: "none" | "soft" | "strong" }
/** The look tokens one tile kind may override, plus its state tokens. */
export interface KindLook {
  tile?: string; text?: string; muted?: string; accent?: string; radius?: number; border?: { width: number; color?: string }; shadow?: "none" | "soft" | "strong";
  tileOpacity?: number; tileBlur?: number; font?: string; numberFont?: string; labelPosition?: "bottom" | "top" | "hidden"; labelWeight?: "regular" | "medium" | "bold"; tileStyle?: TileStyle;
  states?: { pressed?: StateLook; active?: StateLook; alert?: StateLook };
}
export interface ThemeFont { family: string; file: string; weight?: number }
/** Where a theme's look came from: the pack, the variant (or an auto pair) and the chosen option values. */
export interface ThemeSource { pack: string; variant?: string; auto?: { light: string; dark: string }; options?: Record<string, string> }

export interface Theme extends LookExtra {
  source?: ThemeSource;
  /** Auto mode: the resolved light and dark looks; the deck picks by the phone's colour scheme when mode is "auto". */
  auto?: { light: Look; dark: Look };
  kinds?: Partial<Record<TileKind, KindLook>>;
  fonts?: ThemeFont[];
  muted?: string;
  mode?: "dark" | "light" | "auto"; // default "dark"
  accent?: string;      // CSS color, default "#22d3ee" (brand cyan; green is only the live/connected status colour)
  background?: string;  // CSS color (--bg), default "#0b0b0d"
  tile?: string;        // tile background (--surface), default "#141417"
  radius?: number;      // px, 0-40, default 14
  gap?: number;         // px, 0-40, default 10
  fontScale?: number;   // 0.5-2, default 1
  tileStyle?: TileStyle; // default "tint"
  iconScale?: number;   // 0.5-2, default 1
  iconStroke?: number;  // outline icon stroke width on a 24px grid, 1-3, default 2.25 ("bold")
  showLabels?: boolean; // default true
  text?: string;        // main text colour (--text)
  /**
   * landscape (default): the grid is laid out for a phone held sideways; when the phone is upright the deck
   * rotates 90deg to fill the screen. portrait: the reverse. auto: follow the phone, no rotation.
   */
  orientation?: Orientation;
  /** UI language for the phone overlay and the management page. English is the default; Vietnamese is the extra one. */
  language?: Language;
  /** Temperature unit for every widget (weather, climate, sensors); missing = "c". A widget-level weather.units still wins. */
  temperatureUnit?: "c" | "f";
  /** false = never ask GitHub whether a newer Nookdeck exists (GET /api/update then reports enabled:false). Missing = on. */
  updateCheck?: boolean;
  /** Phone screen behaviour: lite mode, keep awake, standby clock, dim. Missing = every default below. */
  screen?: ScreenSettings;
  /** Deck header bar: full (default), minimal (no computer name / CPU / RAM chips) or hidden (floating round button). */
  header?: HeaderMode;
}

export type HeaderMode = "full" | "minimal" | "hidden";
export const HEADER_MODES: HeaderMode[] = ["full", "minimal", "hidden"];

export type LiteMode = "auto" | "on" | "off";
export const LITE_MODES: LiteMode[] = ["auto", "on", "off"];
export type StandbyStyle = "digital" | "analog" | "words";
export const STANDBY_STYLES: StandbyStyle[] = ["digital", "analog", "words"];

export interface StandbySettings {
  enabled: boolean;      // default false
  afterMin: number;      // 1..120 idle minutes before standby; default 5
  style: StandbyStyle;   // default "digital"
  showDate?: boolean;    // default true
  showNext?: boolean;    // show the next alarm under the clock; default true
}
export interface DimSettings {
  level: number;         // 0..0.9 black overlay opacity; default 0.6
  from?: string;         // "HH:MM" schedule start (phone local time); from and to both missing = never auto-dim
  to?: string;           // "HH:MM" schedule end; may wrap midnight
}
export interface ScreenSettings {
  lite?: LiteMode;       // default "auto"
  keepAwake?: boolean;   // default true
  standby?: StandbySettings;
  dim?: DimSettings;
  /** Move the whole grid by up to 2 px every 3 minutes against burn-in. Missing = off; new layouts start with it on. */
  burnInShift?: boolean;
  /** Swiping past the last page goes to the first, and back from the first to the last. Missing = off. */
  wrap?: boolean;
  /** Hide the page dots; they show for a moment while swiping. Missing = shown. */
  hideDots?: boolean;
  /** After a button that locks the computer: the phone that pressed it goes black (default), every phone, or none. */
  lockSleep?: LockSleep;
  /** The screenshot tool of buttons that do not pick their own. Missing = the first installed known app, else the system tool. */
  screenshot?: ScreenshotChoice;
}
export const SCREEN_DEFAULTS = {
  lite: "auto" as LiteMode,
  keepAwake: true,
  standby: { enabled: false, afterMin: 5, style: "digital" as StandbyStyle, showDate: true, showNext: true },
  dim: { level: 0.6 },
};

export type AlarmSound = "chime" | "birds" | "soft" | "none";
export const ALARM_SOUNDS: AlarmSound[] = ["chime", "birds", "soft", "none"];
export const MAX_ALARMS = 20;
export const ALARM_ID_RE = /^[a-z0-9-]{1,40}$/;
export interface Alarm {
  id: string;            // [a-z0-9-]{1,40}
  time: string;          // "HH:MM" 24h, phone local time
  days?: number[];       // 0=Sun..6=Sat, unique; missing/empty = one-shot
  label?: string;        // <= 60 chars
  enabled: boolean;
  sound: AlarmSound;
  sunriseMin: number;    // 0..30
  snoozeMin: number;     // 1..30, default 9
  devices?: string[];    // device ids; missing/empty = every phone
}

export type Orientation = "landscape" | "portrait" | "auto";
export const ORIENTATIONS: Orientation[] = ["landscape", "portrait", "auto"];
export const LANGUAGES = ["en", "vi", "zh", "fr", "pt"] as const;
export type Language = (typeof LANGUAGES)[number];

/** A fixed Stream Deck-style grid of square cells: columns x rows. */
export interface Page {
  id: string;
  name: string;
  /** A partial look override while this page is shown (same fields as a theme package). */
  theme?: Look;
  columns: number; // 1-12
  rows: number;    // 1-8
  items: Item[];
}

export const MAX_COLUMNS = 12;
export const MAX_ROWS = 8;

export interface Layout {
  version: 1;
  theme?: Theme;
  pages: Page[];
  /** Automation rules: see src/automation.ts. */
  rules?: Rule[];
  /** Alarms the phones ring on their own (max 20). */
  alarms?: Alarm[];
}

export interface Device {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  lastSeen?: string;
  /** lastSeen (or createdAt) + 365 days; a token unused for a year stops working. Refreshed on every connect. */
  expiresAt?: string;
  /** set up over USB (Android, adb): the phone's adb serial, so setting the same phone up again replaces this entry */
  usbSerial?: string;
  /** what USB setup changed on the phone, put back when the device is forgotten: the "stay awake while charging" value before setup, and whether it took the app off battery optimisation */
  usbUndo?: UsbUndo;
}
export interface UsbUndo { stayOn?: number; battery?: boolean }

export const HOME = process.env.NOOKDECK_HOME ?? join(userHome(), ".nookdeck");
const LAYOUT_FILE = join(HOME, "layout.json");
const DEVICES_FILE = join(HOME, "devices.json");

export const ACTION_TYPES = ["open", "hotkey", "type", "shell", "media", "volume", "page", "sound", "sound-stop", "lock", "screenshot", "hass", "macro", "plugin", "onair", "mic", "camera"] as const;
/** The On Air tile's sizes (w x h). */
export const ONAIR_SIZES = ["1x1", "2x1", "2x2"];
export const WIDGET_KINDS: WidgetKind[] = ["clock", "cpu", "gpu", "memory", "uptime", "load", "network", "nowplaying", "quota", "sessions", "entity", "weather", "value", "notifications", "plugin", "onair"];

export function defaultLayout(): Layout {
  return {
    version: 1,
    theme: { mode: "dark", orientation: "landscape", tileStyle: "ios", iconStroke: 2.25, screen: { burnInShift: true } },
    pages: [
      {
        // Dashboard: big clock + now playing on top, four metric tiles below.
        id: "overview",
        name: "Overview",
        columns: 8,
        rows: 3,
        items: [
          { id: "w-clock", kind: "widget", widget: "clock", x: 0, y: 0, w: 4, h: 2 },
          { id: "w-media", kind: "widget", widget: "nowplaying", x: 4, y: 0, w: 4, h: 2 },
          { id: "w-cpu", kind: "widget", widget: "cpu", color: "#2dd4bf", x: 0, y: 2, w: 2 },
          { id: "w-mem", kind: "widget", widget: "memory", color: "#22d3ee", x: 2, y: 2, w: 2 },
          { id: "w-net", kind: "widget", widget: "network", color: "#f59e0b", x: 4, y: 2, w: 2 },
          { id: "w-load", kind: "widget", widget: "load", color: "#60a5fa", metric: { chart: "bars" }, x: 6, y: 2, w: 2 },
        ],
      },
      {
        id: "ai",
        name: "AI",
        columns: 8,
        rows: 3,
        items: [
          { id: "w-q-claude", kind: "widget", widget: "quota", provider: "claude", color: "#d97757", x: 0, y: 0, w: 2, h: 2 },
          { id: "w-q-codex", kind: "widget", widget: "quota", provider: "codex", color: "#e5e7eb", x: 2, y: 0, w: 2, h: 2 },
          { id: "w-q-agy", kind: "widget", widget: "quota", provider: "antigravity", color: "#60a5fa", x: 4, y: 0, w: 2, h: 2 },
          { id: "w-sessions", kind: "widget", widget: "sessions", x: 6, y: 0, w: 2, h: 3 },
          { id: "w-cpu-ai", kind: "widget", widget: "cpu", color: "#2dd4bf", x: 0, y: 2, w: 2 },
          { id: "w-mem-ai", kind: "widget", widget: "memory", color: "#22d3ee", x: 2, y: 2, w: 2 },
          { id: "w-clock-ai", kind: "widget", widget: "clock", clock: { style: "world", zones: ["America/Los_Angeles", "Europe/London"] }, x: 4, y: 2, w: 2 },
        ],
      },
      {
        id: "home",
        name: "Keys",
        columns: 8,
        rows: 3,
        items: [
          // row 0: media
          { id: "w-clock2", kind: "widget", widget: "clock", clock: { style: "flip" }, x: 0, y: 0, w: 2 },
          { id: "w-cpu2", kind: "widget", widget: "cpu", x: 2, y: 0 },
          { id: "w-mem2", kind: "widget", widget: "memory", metric: { chart: "ring" }, x: 3, y: 0 },
          { id: "b-prev", kind: "button", label: "Previous", icon: "player-skip-back", x: 4, y: 0, action: { type: "media", command: "previous" } },
          { id: "b-play", kind: "button", label: "Play / Pause", icon: "player-play", color: "#22d3ee", x: 5, y: 0, action: { type: "media", command: "playpause" } },
          { id: "b-next", kind: "button", label: "Next", icon: "player-skip-forward", x: 6, y: 0, action: { type: "media", command: "next" } },
          { id: "b-mute", kind: "button", label: "Mute", icon: "volume-3", x: 7, y: 0, action: { type: "volume", command: "mute" } },
          // row 1: apps + volume
          { id: "b-web", kind: "button", label: "GitHub", icon: "brand-github", x: 0, y: 1, action: { type: "open", target: "https://github.com" } },
          { id: "b-term", kind: "button", label: "Terminal", icon: "terminal-2", x: 1, y: 1, action: { type: "open", target: "Terminal" } },
          { id: "b-copy", kind: "button", label: "Copy", icon: "copy", x: 2, y: 1, action: { type: "hotkey", keys: "cmd+c" } },
          { id: "b-paste", kind: "button", label: "Paste", icon: "clipboard", x: 3, y: 1, action: { type: "hotkey", keys: "cmd+v" } },
          { id: "b-voldn", kind: "button", label: "Volume down", icon: "volume-2", x: 6, y: 1, action: { type: "volume", command: "down" } },
          { id: "b-volup", kind: "button", label: "Volume up", icon: "volume", x: 7, y: 1, action: { type: "volume", command: "up" } },
          // row 2
          { id: "b-shot", kind: "button", label: "Screenshot", icon: "camera", x: 0, y: 2, action: { type: "screenshot" } },
          { id: "b-dev", kind: "button", label: "Tools", icon: "layout-grid", color: "#38bdf8", x: 7, y: 2, action: { type: "page", page: "dev" } },
        ],
      },
      {
        id: "dev",
        name: "Tools",
        columns: 8,
        rows: 2,
        items: [
          { id: "w-load", kind: "widget", widget: "load", x: 0, y: 0, w: 2 },
          { id: "w-up", kind: "widget", widget: "uptime", x: 2, y: 0, w: 2 },
          { id: "b-undo", kind: "button", label: "Undo", icon: "arrow-back-up", x: 4, y: 0, action: { type: "hotkey", keys: "cmd+z" } },
          { id: "b-redo", kind: "button", label: "Redo", icon: "arrow-forward-up", x: 5, y: 0, action: { type: "hotkey", keys: "cmd+shift+z" } },
          { id: "b-save", kind: "button", label: "Save", icon: "device-floppy", x: 6, y: 0, action: { type: "hotkey", keys: "cmd+s" } },
          { id: "b-find", kind: "button", label: "Find", icon: "search", x: 7, y: 0, action: { type: "hotkey", keys: "cmd+f" } },
          { id: "b-lock", kind: "button", label: "Lock", icon: "lock", x: 0, y: 1, action: { type: "lock" } },
          { id: "b-home", kind: "button", label: "Home", icon: "home", color: "#38bdf8", x: 7, y: 1, action: { type: "page", page: "home" } },
        ],
      },
    ],
  };
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err: any) {
    if (err?.code === "ENOENT") return undefined;
    throw new Error(`Cannot read ${file}: ${err?.message ?? err}`);
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(HOME, { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, file);
}

export async function loadLayout(): Promise<Layout> {
  const raw = await readJson<unknown>(LAYOUT_FILE);
  if (raw === undefined) {
    const layout = defaultLayout();
    await writeJson(LAYOUT_FILE, layout);
    return layout;
  }
  const { platform } = await import("./platform"); // lazy: config is imported by the platform code
  return migrateScreenshotHotkeys(migrateLockHotkeys(validateLayout(raw), platform.id));
}

/** Rewrites button actions (and the steps of macro buttons); fn returns null for "unchanged". Unchanged pages are the same objects. */
function mapActions(layout: Layout, fn: (a: Action) => Action | null, step: (s: MacroStep) => MacroStep | null): Layout {
  let changed = false;
  const pages = layout.pages.map((p) => {
    let hit = false;
    const items = p.items.map((it) => {
      if (it.kind !== "button" || !it.action) return it;
      let next = fn(it.action);
      if (!next && it.action.type === "macro") {
        let stepHit = false;
        const steps = it.action.steps.map((st) => { const n = step(st); if (n) stepHit = true; return n ?? st; });
        if (stepHit) next = { ...it.action, steps };
      }
      if (!next) return it;
      hit = true;
      return { ...it, action: next };
    });
    if (!hit) return p;
    changed = true;
    return { ...p, items };
  });
  return changed ? { ...layout, pages } : layout;
}

/**
 * "Lock computer" used to be the macOS hotkey ctrl+cmd+q everywhere; on Windows that is Ctrl+Win+Q (Quick Assist) and on Linux nothing.
 * At load, on Windows and Linux, a button whose action is exactly that hotkey becomes {type:"lock"}, and so does such a hotkey step in a
 * macro (isLockAction counts it as a lock, so the phone sleeps: the computer must lock too). Only in memory: layout.json is rewritten
 * the next time the layout is saved. macOS keeps the hotkey (it locks there).
 */
export function migrateLockHotkeys(layout: Layout, os: NodeJS.Platform): Layout {
  if (os !== "win32" && os !== "linux") return layout;
  return mapActions(layout,
    (a) => (a.type === "hotkey" && isLockKeys(a.keys) ? { type: "lock" } : null),
    (st) => (st.kind === "hotkey" && isLockKeys(st.keys) ? { kind: "lock" } : null));
}

/**
 * "Screenshot" / "Capture region" used to be the macOS hotkey cmd+shift+4 (cmd+shift+3 for the whole screen) everywhere: nothing on
 * Windows and Linux, and nothing on a Mac whose screenshot shortcuts are off or taken by another app. At load, on every OS, a button
 * whose action is exactly one of those hotkeys becomes {type:"screenshot"} with that mode, and so does such a macro step. Only in
 * memory, like migrateLockHotkeys.
 */
export function migrateScreenshotHotkeys(layout: Layout): Layout {
  return mapActions(layout,
    (a) => {
      const mode = a.type === "hotkey" ? screenshotModeForKeys(a.keys) : null;
      return mode ? (mode === "region" ? { type: "screenshot" } : { type: "screenshot", mode }) : null;
    },
    (st) => {
      const mode = st.kind === "hotkey" ? screenshotModeForKeys(st.keys) : null;
      return mode ? (mode === "region" ? { kind: "screenshot" } : { kind: "screenshot", mode }) : null;
    });
}

export async function saveLayout(layout: Layout): Promise<void> {
  await writeJson(LAYOUT_FILE, layout);
}

/**
 * This computer's Nookdeck, as a random id kept in <home>/computer-id. Not a secret: /api/hello shows it so the Android app reconnects
 * to the computer that set it up, and not to another Nookdeck it finds on the same Wi-Fi.
 */
let computerIdMemo: string | undefined;
export async function computerId(): Promise<string> {
  if (computerIdMemo) return computerIdMemo;
  const file = join(HOME, "computer-id");
  const have = (await readFile(file, "utf8").catch(() => "")).trim();
  if (/^[0-9a-f]{16,64}$/.test(have)) return (computerIdMemo = have);
  const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  await mkdir(HOME, { recursive: true });
  await writeFile(file, id + "\n");
  return (computerIdMemo = id);
}

export async function loadDevices(): Promise<Device[]> {
  return (await readJson<Device[]>(DEVICES_FILE)) ?? [];
}

export async function saveDevices(devices: Device[]): Promise<void> {
  await writeJson(DEVICES_FILE, devices);
}

const num = (v: unknown, field: string, min: number, max: number, int = true): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw new Error(`${field} must be ${int ? "an integer " : ""}between ${min} and ${max}`);
  return n;
};

const optColor = (v: unknown, field: string): string | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const c = str(v, field);
  // Rendered into CSS: allow only plain color syntaxes.
  if (!/^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)|[a-zA-Z]{3,20})$/.test(c)) throw new Error(`${field} is not a valid color`);
  return c;
};

const BG_IMAGE_RE = /^(theme:[a-z0-9][a-z0-9._-]*(\.[a-z0-9][a-z0-9._-]*)+\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*|img:[A-Za-z0-9_-]{4,64})$/;
const enumOf = <T extends string>(v: unknown, list: readonly T[], field: string): T => {
  if (typeof v !== "string" || !(list as readonly string[]).includes(v)) throw new Error(`${field} must be one of ${list.join(", ")}`);
  return v as T;
};

/** The look fields only (the part a theme package carries and `page.theme` may override). Unknown keys are ignored. `p` names the field for errors. */
export function validateLook(t: any, p = "theme"): Look {
  if (t === undefined || t === null) return {};
  if (typeof t !== "object" || Array.isArray(t)) throw new Error(`${p} must be an object`);
  const out: Look = {};
  if (t.mode !== undefined) {
    if (!["dark", "light", "auto"].includes(t.mode)) throw new Error(`${p}.mode must be "dark", "light" or "auto"`);
    out.mode = t.mode;
  }
  const accent = optColor(t.accent, `${p}.accent`); if (accent) out.accent = accent;
  const background = optColor(t.background, `${p}.background`); if (background) out.background = background;
  const tile = optColor(t.tile, `${p}.tile`); if (tile) out.tile = tile;
  const text = optColor(t.text, `${p}.text`); if (text) out.text = text;
  const muted = optColor(t.muted, `${p}.muted`); if (muted) out.muted = muted;
  if (t.radius !== undefined) out.radius = num(t.radius, `${p}.radius`, 0, 40);
  if (t.gap !== undefined) out.gap = num(t.gap, `${p}.gap`, 0, 40);
  if (t.fontScale !== undefined) out.fontScale = num(t.fontScale, `${p}.fontScale`, 0.5, 2, false);
  if (t.tileStyle !== undefined) out.tileStyle = tileStyle(t.tileStyle, `${p}.tileStyle`);
  if (t.iconScale !== undefined) out.iconScale = num(t.iconScale, `${p}.iconScale`, 0.5, 2, false);
  if (t.iconStroke !== undefined) out.iconStroke = num(t.iconStroke, `${p}.iconStroke`, 1, 3, false);
  if (t.showLabels !== undefined) out.showLabels = bool(t.showLabels, `${p}.showLabels`);
  const fontOf = (v: unknown, f: string): string => (typeof v === "string" && /^pkg:[A-Za-z0-9 _-]{1,40}$/.test(v) ? v : enumOf(v, FONTS, f));
  if (t.font !== undefined) out.font = fontOf(t.font, `${p}.font`);
  if (t.numberFont !== undefined) out.numberFont = fontOf(t.numberFont, `${p}.numberFont`);
  if (t.backgroundImage !== undefined && t.backgroundImage !== "") {
    if (typeof t.backgroundImage !== "string" || !BG_IMAGE_RE.test(t.backgroundImage) || t.backgroundImage.includes("..")) throw new Error(`${p}.backgroundImage must be "theme:<id>/<file>" or "img:<id>"`);
    out.backgroundImage = t.backgroundImage;
  }
  if (t.backgroundFit !== undefined) out.backgroundFit = enumOf(t.backgroundFit, ["cover", "contain", "tile"] as const, `${p}.backgroundFit`);
  if (t.backgroundDim !== undefined) out.backgroundDim = num(t.backgroundDim, `${p}.backgroundDim`, 0, 0.9, false);
  if (t.backgroundBlur !== undefined) out.backgroundBlur = num(t.backgroundBlur, `${p}.backgroundBlur`, 0, 30, false);
  if (t.gradient !== undefined && t.gradient !== null) {
    if (typeof t.gradient !== "object" || Array.isArray(t.gradient)) throw new Error(`${p}.gradient must be { from, to, angle }`);
    const from = optColor(t.gradient.from, `${p}.gradient.from`), to = optColor(t.gradient.to, `${p}.gradient.to`);
    if (!from || !to) throw new Error(`${p}.gradient needs from and to colours`);
    out.gradient = { from, to, angle: t.gradient.angle === undefined ? 135 : num(t.gradient.angle, `${p}.gradient.angle`, 0, 360) };
  }
  if (t.tileOpacity !== undefined) out.tileOpacity = num(t.tileOpacity, `${p}.tileOpacity`, 0.05, 1, false);
  if (t.tileBlur !== undefined) out.tileBlur = num(t.tileBlur, `${p}.tileBlur`, 0, 30, false);
  if (t.border !== undefined && t.border !== null) {
    if (typeof t.border !== "object" || Array.isArray(t.border)) throw new Error(`${p}.border must be { width, color? }`);
    const color = optColor(t.border.color, `${p}.border.color`);
    out.border = { width: num(t.border.width ?? 1, `${p}.border.width`, 0, 3, false), ...(color ? { color } : {}) };
  }
  if (t.shadow !== undefined) out.shadow = enumOf(t.shadow, ["none", "soft", "strong"] as const, `${p}.shadow`);
  if (t.labelPosition !== undefined) out.labelPosition = enumOf(t.labelPosition, ["bottom", "top", "hidden"] as const, `${p}.labelPosition`);
  if (t.labelWeight !== undefined) out.labelWeight = enumOf(t.labelWeight, ["regular", "medium", "bold"] as const, `${p}.labelWeight`);
  if (t.iconStyle !== undefined) out.iconStyle = enumOf(t.iconStyle, ["line", "filled"] as const, `${p}.iconStyle`);
  if (t.palette !== undefined && t.palette !== null) {
    if (typeof t.palette !== "object" || Array.isArray(t.palette)) throw new Error(`${p}.palette must be { ok, warn, error, info }`);
    const pal: Partial<Record<PaletteKey, string>> = {};
    for (const k of ["ok", "warn", "error", "info"] as const) { const c = optColor(t.palette[k], `${p}.palette.${k}`); if (c) pal[k] = c; }
    if (Object.keys(pal).length) out.palette = pal;
  }
  if (t.chartColors !== undefined && t.chartColors !== null) {
    if (!Array.isArray(t.chartColors) || t.chartColors.length > 6) throw new Error(`${p}.chartColors must be a list of up to 6 colours`);
    const cc = t.chartColors.map((c: unknown, i: number) => optColor(c, `${p}.chartColors[${i}]`)).filter((c: string | undefined): c is string => !!c);
    if (cc.length) out.chartColors = cc;
  }
  return out;
}

const PACK_REF_RE = /^[a-z0-9][a-z0-9._-]*(\.[a-z0-9][a-z0-9._-]*)+@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const PART_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
/** A look plus the pack-only layers: per-kind tokens and declared fonts. */
export type PackLook = Look & { kinds?: Partial<Record<TileKind, KindLook>>; fonts?: ThemeFont[] };
export function validatePackLook(t: any, p: string): PackLook {
  const out: PackLook = { ...validateLook(t, p) };
  if (t && t.kinds !== undefined && t.kinds !== null) { const k = validateKinds(t.kinds, `${p}.kinds`); if (k) out.kinds = k; }
  if (t && t.fonts !== undefined && t.fonts !== null) { const f = validateFonts(t.fonts, `${p}.fonts`); if (f) out.fonts = f; }
  return out;
}
export function validateSource(v: any, p: string): ThemeSource {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${p} must be { pack, variant | auto, options }`);
  if (typeof v.pack !== "string" || !PACK_REF_RE.test(v.pack)) throw new Error(`${p}.pack must look like "dev.author.name@1.0.0"`);
  const out: ThemeSource = { pack: v.pack };
  if (v.variant !== undefined) { if (typeof v.variant !== "string" || !PART_ID_RE.test(v.variant)) throw new Error(`${p}.variant is not a valid id`); out.variant = v.variant; }
  if (v.auto !== undefined) {
    if (!v.auto || typeof v.auto.light !== "string" || typeof v.auto.dark !== "string" || !PART_ID_RE.test(v.auto.light) || !PART_ID_RE.test(v.auto.dark)) throw new Error(`${p}.auto must be { light, dark } variant ids`);
    out.auto = { light: v.auto.light, dark: v.auto.dark };
  }
  if (v.options !== undefined) {
    if (!v.options || typeof v.options !== "object" || Array.isArray(v.options)) throw new Error(`${p}.options must be an object`);
    const o: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.options)) { if (!PART_ID_RE.test(k) || typeof val !== "string" || !PART_ID_RE.test(val)) throw new Error(`${p}.options has an invalid id`); o[k] = val; }
    if (Object.keys(o).length > 4) throw new Error(`${p}.options has more than 4 options`);
    if (Object.keys(o).length) out.options = o;
  }
  return out;
}
const stateLook = (v: any, p: string): StateLook => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${p} must be an object`);
  const o: StateLook = {};
  for (const k of ["tile", "text", "accent"] as const) { const c = optColor(v[k], `${p}.${k}`); if (c) o[k] = c; }
  if (v.border !== undefined) { const c = optColor(v.border?.color, `${p}.border.color`); o.border = { width: num(v.border?.width ?? 1, `${p}.border.width`, 0, 3, false), ...(c ? { color: c } : {}) }; }
  if (v.shadow !== undefined) o.shadow = enumOf(v.shadow, ["none", "soft", "strong"] as const, `${p}.shadow`);
  return o;
};
export function validateKinds(v: any, p: string): Partial<Record<TileKind, KindLook>> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${p} must be an object keyed by tile kind`);
  const out: Partial<Record<TileKind, KindLook>> = {};
  for (const [kind, raw] of Object.entries(v) as Array<[string, any]>) {
    if (!(TILE_KINDS as readonly string[]).includes(kind)) throw new Error(`${p}.${kind}: unknown tile kind (use ${TILE_KINDS.join(", ")})`);
    const k: KindLook = {};
    const look = validateLook(raw, `${p}.${kind}`) as Record<string, any>;
    for (const f of ["tile", "text", "muted", "accent", "radius", "border", "shadow", "tileOpacity", "tileBlur", "font", "numberFont", "labelPosition", "labelWeight", "tileStyle"]) if (look[f] !== undefined) (k as any)[f] = look[f];
    if (raw.states !== undefined) {
      if (!raw.states || typeof raw.states !== "object") throw new Error(`${p}.${kind}.states must be an object`);
      const st: NonNullable<KindLook["states"]> = {};
      for (const s of ["pressed", "active", "alert"] as const) if (raw.states[s] !== undefined) st[s] = stateLook(raw.states[s], `${p}.${kind}.states.${s}`);
      if (Object.keys(st).length) k.states = st;
    }
    if (Object.keys(k).length) out[kind as TileKind] = k;
  }
  return Object.keys(out).length ? out : undefined;
}
export function validateFonts(v: any, p: string): ThemeFont[] | undefined {
  if (!Array.isArray(v) || v.length > 4) throw new Error(`${p} must be a list of up to 4 fonts`);
  const out = v.map((f: any, i: number) => {
    const family = typeof f?.family === "string" && /^[A-Za-z0-9 _-]{1,40}$/.test(f.family) ? f.family : (() => { throw new Error(`${p}[${i}].family must be 1-40 letters, digits, spaces, - or _`); })();
    const file = typeof f?.file === "string" && /^fonts\/[A-Za-z0-9._-]+\.woff2?$/i.test(f.file) ? f.file : (() => { throw new Error(`${p}[${i}].file must be fonts/<name>.woff or .woff2`); })();
    return { family, file, ...(f.weight !== undefined ? { weight: num(f.weight, `${p}[${i}].weight`, 100, 900) } : {}) };
  });
  return out.length ? out : undefined;
}

export function validateTheme(t: any): Theme | undefined {
  if (t === undefined || t === null) return undefined;
  if (typeof t !== "object") throw new Error("theme must be an object");
  const out: Theme = { ...validateLook(t, "theme") };
  if (t.source !== undefined && t.source !== null && t.source !== "") out.source = validateSource(t.source, "theme.source");
  if (t.auto !== undefined && t.auto !== null) {
    if (typeof t.auto !== "object" || !t.auto.light || !t.auto.dark) throw new Error("theme.auto must be { light, dark } looks");
    out.auto = { light: validateLook(t.auto.light, "theme.auto.light"), dark: validateLook(t.auto.dark, "theme.auto.dark") };
  }
  if (t.kinds !== undefined && t.kinds !== null) { const k = validateKinds(t.kinds, "theme.kinds"); if (k) out.kinds = k; }
  if (t.fonts !== undefined && t.fonts !== null) { const f = validateFonts(t.fonts, "theme.fonts"); if (f) out.fonts = f; }
  if (t.temperatureUnit !== undefined) {
    if (t.temperatureUnit !== "c" && t.temperatureUnit !== "f") throw new Error("theme.temperatureUnit must be c or f");
    out.temperatureUnit = t.temperatureUnit;
  }
  if (t.header !== undefined) {
    if (!HEADER_MODES.includes(t.header)) throw new Error(`theme.header must be one of ${HEADER_MODES.join(", ")}`);
    out.header = t.header;
  }
  if (t.updateCheck !== undefined) out.updateCheck = bool(t.updateCheck, "theme.updateCheck");
  if (t.language !== undefined) {
    if (!LANGUAGES.includes(t.language)) throw new Error(`theme.language must be one of ${LANGUAGES.join(", ")}`);
    out.language = t.language;
  }
  if (t.orientation !== undefined) {
    if (!ORIENTATIONS.includes(t.orientation)) throw new Error(`theme.orientation must be one of ${ORIENTATIONS.join(", ")}`);
    out.orientation = t.orientation;
  }
  const screen = validateScreen(t.screen);
  if (screen) out.screen = screen;
  return out;
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !HHMM_RE.test(v)) throw new Error(`${field} must be HH:MM`);
  return v;
};
const obj = (v: unknown, field: string): any => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${field} must be an object`);
  return v;
};

function validateScreen(v: any): ScreenSettings | undefined {
  if (v === undefined || v === null) return undefined;
  obj(v, "theme.screen");
  const out: ScreenSettings = {};
  if (v.lite !== undefined) {
    if (!LITE_MODES.includes(v.lite)) throw new Error(`theme.screen.lite must be one of ${LITE_MODES.join(", ")}`);
    out.lite = v.lite;
  }
  if (v.keepAwake !== undefined) out.keepAwake = bool(v.keepAwake, "theme.screen.keepAwake");
  if (v.burnInShift !== undefined) out.burnInShift = bool(v.burnInShift, "theme.screen.burnInShift");
  if (v.wrap !== undefined) out.wrap = bool(v.wrap, "theme.screen.wrap");
  if (v.hideDots !== undefined) out.hideDots = bool(v.hideDots, "theme.screen.hideDots");
  if (v.lockSleep !== undefined) {
    if (!LOCK_SLEEP.includes(v.lockSleep)) throw new Error(`theme.screen.lockSleep must be one of ${LOCK_SLEEP.join(", ")}`);
    out.lockSleep = v.lockSleep;
  }
  if (v.screenshot !== undefined && v.screenshot !== null) {
    const c = screenshotChoice(obj(v.screenshot, "theme.screen.screenshot"), "theme.screen.screenshot");
    if (c.tool) out.screenshot = c;
  }
  if (v.standby !== undefined && v.standby !== null) {
    const s = obj(v.standby, "theme.screen.standby");
    const d = SCREEN_DEFAULTS.standby;
    const style = s.style ?? d.style;
    if (!STANDBY_STYLES.includes(style)) throw new Error(`theme.screen.standby.style must be one of ${STANDBY_STYLES.join(", ")}`);
    out.standby = {
      enabled: s.enabled === undefined ? d.enabled : bool(s.enabled, "theme.screen.standby.enabled"),
      afterMin: s.afterMin === undefined ? d.afterMin : num(s.afterMin, "theme.screen.standby.afterMin", 1, 120),
      style,
      ...(s.showDate !== undefined ? { showDate: bool(s.showDate, "theme.screen.standby.showDate") } : {}),
      ...(s.showNext !== undefined ? { showNext: bool(s.showNext, "theme.screen.standby.showNext") } : {}),
    };
  }
  if (v.dim !== undefined && v.dim !== null) {
    const m = obj(v.dim, "theme.screen.dim");
    const from = m.from === undefined || m.from === "" ? undefined : hhmm(m.from, "theme.screen.dim.from");
    const to = m.to === undefined || m.to === "" ? undefined : hhmm(m.to, "theme.screen.dim.to");
    out.dim = {
      level: m.level === undefined ? SCREEN_DEFAULTS.dim.level : num(m.level, "theme.screen.dim.level", 0, 0.9, false),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    };
  }
  return out;
}

function validateAlarms(raw: any): Alarm[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new Error("alarms must be an array");
  if (raw.length > MAX_ALARMS) throw new Error(`alarms: at most ${MAX_ALARMS}`);
  const seen = new Set<string>();
  return raw.map((a: any, i: number): Alarm => {
    const w = `alarms[${i}]`;
    obj(a, w);
    const id = str(a.id, `${w}.id`);
    if (!ALARM_ID_RE.test(id)) throw new Error(`${w}.id must be 1-40 characters of a-z, 0-9 and -`);
    if (seen.has(id)) throw new Error(`${w}.id "${id}" is used twice`);
    seen.add(id);
    const time = hhmm(a.time, `${w}.time`);
    let days: number[] | undefined;
    if (a.days !== undefined && a.days !== null) {
      if (!Array.isArray(a.days)) throw new Error(`${w}.days must be an array`);
      const ds = a.days.map((d: unknown, j: number) => num(d, `${w}.days[${j}]`, 0, 6));
      days = [...new Set<number>(ds)].sort((x, y) => x - y);
    }
    let label: string | undefined;
    if (a.label !== undefined && a.label !== null && a.label !== "") {
      label = str(a.label, `${w}.label`);
      if (label.length > 60) throw new Error(`${w}.label must be at most 60 characters`);
    }
    const sound = a.sound ?? "chime";
    if (!ALARM_SOUNDS.includes(sound)) throw new Error(`${w}.sound must be one of ${ALARM_SOUNDS.join(", ")}`);
    let devices: string[] | undefined;
    if (a.devices !== undefined && a.devices !== null) {
      if (!Array.isArray(a.devices)) throw new Error(`${w}.devices must be an array`);
      devices = [...new Set<string>(a.devices.map((d: unknown, j: number) => str(d, `${w}.devices[${j}]`)))];
    }
    return {
      id, time,
      ...(days && days.length ? { days } : {}),
      ...(label ? { label } : {}),
      enabled: a.enabled === undefined ? true : bool(a.enabled, `${w}.enabled`),
      sound,
      sunriseMin: a.sunriseMin === undefined ? 0 : num(a.sunriseMin, `${w}.sunriseMin`, 0, 30),
      snoozeMin: a.snoozeMin === undefined ? 9 : num(a.snoozeMin, `${w}.snoozeMin`, 1, 30),
      ...(devices && devices.length ? { devices } : {}),
    };
  });
}

/**
 * Places items on a columns x rows grid. Items with x/y keep their cell (checked for bounds and overlap);
 * items without are put in the first free cell, row by row, in list order. When `rows` is undefined
 * (legacy layouts saved before fixed grids) the grid grows to fit and the resulting row count is returned.
 */
export function placeItems(items: Item[], columns: number, rows: number | undefined, where: string): { items: Item[]; rows: number } {
  const limit = rows ?? MAX_ROWS;
  const taken: (string | undefined)[][] = Array.from({ length: limit }, () => new Array(columns).fill(undefined));
  const fits = (x: number, y: number, w: number, h: number) => {
    if (x < 0 || y < 0 || x + w > columns || y + h > limit) return false;
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) if (taken[r][c]) return false;
    return true;
  };
  const mark = (id: string, x: number, y: number, w: number, h: number) => {
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) taken[r][c] = id;
  };
  const out = items.map((it) => ({ ...it }));
  // Fixed positions first, so auto-placed items flow around them.
  for (const it of out) {
    if (it.x === undefined || it.y === undefined) continue;
    const w = it.w ?? 1, h = it.h ?? 1;
    if (it.x + w > columns || it.y + h > limit) throw new Error(`${where}: item "${it.id}" does not fit in the ${columns}x${limit} grid`);
    if (!fits(it.x, it.y, w, h)) {
      const other = taken[it.y][it.x] ?? "another item";
      throw new Error(`${where}: item "${it.id}" overlaps "${other}"`);
    }
    mark(it.id, it.x, it.y, w, h);
  }
  for (const it of out) {
    if (it.x !== undefined && it.y !== undefined) continue;
    const w = it.w ?? 1, h = it.h ?? 1;
    let placed = false;
    for (let y = 0; y < limit && !placed; y++) for (let x = 0; x < columns && !placed; x++) {
      if (fits(x, y, w, h)) { it.x = x; it.y = y; mark(it.id, x, y, w, h); placed = true; }
    }
    if (!placed) throw new Error(`${where}: no free space for item "${it.id}" in the ${columns}x${limit} grid`);
  }
  const used = out.reduce((m, it) => Math.max(m, (it.y ?? 0) + (it.h ?? 1)), 1);
  return { items: out, rows: rows ?? used };
}

function tileStyle(v: unknown, field: string): TileStyle {
  if (!TILE_STYLES.includes(v as TileStyle)) throw new Error(`${field} must be one of ${TILE_STYLES.join(", ")}`);
  return v as TileStyle;
}

const isZone = (z: string) => { try { new Intl.DateTimeFormat("en", { timeZone: z }); return true; } catch { return false; } };

function clockOptions(c: any, where: string): ClockOptions | undefined {
  if (c === undefined || c === null) return undefined;
  if (typeof c !== "object" || Array.isArray(c)) throw new Error(`${where} must be an object`);
  const out: ClockOptions = {};
  if (c.style !== undefined) {
    if (!CLOCK_STYLES.includes(c.style)) throw new Error(`${where}.style must be one of ${CLOCK_STYLES.join(", ")}`);
    out.style = c.style;
  }
  for (const k of ["seconds", "hour12", "showDate"] as const) if (c[k] !== undefined) out[k] = bool(c[k], `${where}.${k}`);
  if (c.timeZone !== undefined && c.timeZone !== "") {
    const z = str(c.timeZone, `${where}.timeZone`);
    if (!isZone(z)) throw new Error(`${where}.timeZone "${z}" is not a known time zone`);
    out.timeZone = z;
  }
  if (c.zones !== undefined) {
    if (!Array.isArray(c.zones) || c.zones.length > 4) throw new Error(`${where}.zones must be a list of up to 4 time zones`);
    out.zones = c.zones.map((z: unknown, i: number) => {
      const v = str(z, `${where}.zones[${i}]`);
      if (!isZone(v)) throw new Error(`${where}.zones[${i}] "${v}" is not a known time zone`);
      return v;
    });
  }
  if (c.label !== undefined && c.label !== "") out.label = str(c.label, `${where}.label`).slice(0, 40);
  const wx = weatherOptions(c.weather, `${where}.weather`);
  if (wx) out.weather = wx;
  return Object.keys(out).length ? out : undefined;
}

function quotaOptions(q: any, where: string): QuotaOptions | undefined {
  if (q === undefined || q === null) return undefined;
  if (typeof q !== "object" || Array.isArray(q)) throw new Error(`${where} must be an object`);
  const out: QuotaOptions = {};
  if (q.chart !== undefined) {
    if (!QUOTA_CHARTS.includes(q.chart)) throw new Error(`${where}.chart must be one of ${QUOTA_CHARTS.join(", ")}`);
    out.chart = q.chart;
  }
  if (q.windows !== undefined) {
    if (Array.isArray(q.windows)) {
      if (q.windows.length < 1 || q.windows.length > 6) throw new Error(`${where}.windows must list 1-6 window ids`);
      for (const w of q.windows) if (typeof w !== "string" || !/^[a-z0-9_.:-]{1,48}$/i.test(w)) throw new Error(`${where}.windows has an invalid window id`);
      out.windows = [...new Set(q.windows as string[])];
    } else {
      if (q.windows !== "all" && q.windows !== "main") throw new Error(`${where}.windows must be "all", "main" or a list of window ids`);
      out.windows = q.windows;
    }
  }
  if (q.showReset !== undefined) out.showReset = bool(q.showReset, `${where}.showReset`);
  if (q.account !== undefined && q.account !== "") out.account = str(q.account, `${where}.account`).slice(0, 80);
  return Object.keys(out).length ? out : undefined;
}

function metricOptions(m: any, widget: string, where: string): MetricOptions | undefined {
  if (m === undefined || m === null) return undefined;
  if (typeof m !== "object" || Array.isArray(m)) throw new Error(`${where} must be an object`);
  const out: MetricOptions = {};
  if (m.chart !== undefined) {
    const allowed = METRIC_CHARTS_FOR[widget as (typeof METRIC_WIDGETS)[number]];
    if (!allowed.includes(m.chart)) throw new Error(`${where}.chart for ${widget} must be one of ${allowed.join(", ")}`);
    out.chart = m.chart;
  }
  if (m.window !== undefined) {
    if (!(METRIC_WINDOWS as readonly number[]).includes(m.window)) throw new Error(`${where}.window must be one of ${METRIC_WINDOWS.join(", ")} seconds`);
    out.window = m.window;
  }
  if (m.showDelta !== undefined) out.showDelta = bool(m.showDelta, `${where}.showDelta`);
  if (m.showSub !== undefined) out.showSub = bool(m.showSub, `${where}.showSub`);
  return Object.keys(out).length ? out : undefined;
}

function bool(v: unknown, field: string): boolean {
  if (typeof v !== "boolean") throw new Error(`${field} must be true or false`);
  return v;
}

function itemStyle(it: any, w: string): ItemStyle {
  const out: ItemStyle = {};
  if (it.style !== undefined && it.style !== null && it.style !== "") out.style = tileStyle(it.style, `${w}.style`);
  const textColor = optColor(it.textColor, `${w}.textColor`); if (textColor) out.textColor = textColor;
  if (it.hideLabel !== undefined && it.hideLabel !== null) { const h = bool(it.hideLabel, `${w}.hideLabel`); if (h) out.hideLabel = true; }
  return out;
}

/** Layouts saved before the Lucide/Reicon -> Tabler switch use old names: store the new one. */
/**
 * An item's icon is one of:
 *   - a Tabler icon name (built-in set in web/shared/icons.ts, or any of the full catalog web/shared/icon-catalog.json),
 *   - a brand mark name (BRANDS), an old Lucide name (ICON_ALIASES, renamed here),
 *   - "app:<bundleId>"   the icon of an installed Mac app (the agent extracts it),
 *   - "lobe:<name>"      any LobeHub brand mark (web/shared/icon-catalog.json brands),
 *   - "img:<16 hex id>"  an image the owner uploaded (~/.nookdeck/icons/<id>.png),
 *   - any short text or emoji (max 8 characters / 4 graphemes is the UI's limit; the schema allows 64).
 */
export const APP_ICON_RE = /^app:[A-Za-z0-9][A-Za-z0-9.\-]{0,127}$/;
export const IMG_ICON_RE = /^img:[a-f0-9]{16}$/;
/** Any LobeHub brand mark from web/shared/icon-catalog.json "brands" (AI providers, models, apps). */
export const LOBE_ICON_RE = /^lobe:[a-z0-9][a-z0-9.-]{0,63}$/;

/** Layouts saved before the Lucide/Reicon -> Tabler switch use old names: store the new one. Also checks app:/img: forms. */
function normalizeIcon(v: string, where = "icon"): string {
  if (v.length > 140) throw new Error(`${where} is too long`);
  if (v.startsWith("app:") && !APP_ICON_RE.test(v)) throw new Error(`${where} "${v}" is not a valid app icon (app:<bundle id>)`);
  if (v.startsWith("lobe:") && !LOBE_ICON_RE.test(v)) throw new Error(`${where} "${v}" is not a valid brand icon (lobe:<name>)`);
  if (v.startsWith("img:") && !IMG_ICON_RE.test(v)) throw new Error(`${where} "${v}" is not a valid image icon`);
  return Object.prototype.hasOwnProperty.call(ICON_ALIASES, v) ? ICON_ALIASES[v]! : v;
}

/** A screenshot tool choice: a known tool, with its shortcut (hotkey) or command (command); other fields are dropped. */
function screenshotChoice(v: any, where: string): ScreenshotChoice {
  if (v.tool === undefined) return {};
  if (!(SCREENSHOT_TOOLS as unknown[]).includes(v.tool)) throw new Error(`${where}.tool must be one of ${SCREENSHOT_TOOLS.join(", ")}`);
  if (v.tool === "hotkey") {
    const keys = str(v.keys, `${where}.keys`);
    if (keys.length > 100) throw new Error(`${where}.keys is too long`);
    return { tool: "hotkey", keys };
  }
  if (v.tool === "command") return { tool: "command", command: str(v.command, `${where}.command`) };
  return { tool: v.tool };
}

function str(v: unknown, field: string): string {
  if (typeof v !== "string") throw new Error(`${field} must be a string`);
  return v;
}

/** Plugin settings on a tile or button: a small flat object of strings, numbers and booleans. */
function pluginSettings(v: unknown, where: string): Record<string, string | number | boolean> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error(`${where} must be an object`);
  const out: Record<string, string | number | boolean> = {};
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 30) throw new Error(`${where} can have at most 30 settings`);
  for (const [k, val] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(k)) throw new Error(`${where}.${k} is not a valid setting name`);
    if (typeof val === "string") { if (val.length > 2000) throw new Error(`${where}.${k} is too long`); out[k] = val; }
    else if (typeof val === "number" && Number.isFinite(val)) out[k] = val;
    else if (typeof val === "boolean") out[k] = val;
    else throw new Error(`${where}.${k} must be a string, number or boolean`);
  }
  return Object.keys(out).length ? out : undefined;
}

/** An onair / mic / camera action (On Air spec FR-10..12); only known fields are kept. */
export function liveAction(a: any, where: string): OnAirAction | MicAction | CameraAction {
  const why = validOnairAction({ type: a.type, ...(a.mode !== undefined ? { mode: a.mode } : {}) });
  if (why) throw new Error(`${where}: ${why}`);
  if (a.type === "camera") return { type: "camera" };
  return { type: a.type, ...(a.mode !== undefined ? { mode: a.mode } : {}) } as OnAirAction | MicAction;
}

function validateAction(a: any, where: string): Action {
  if (!a || typeof a !== "object") throw new Error(`${where}.action must be an object`);
  switch (a.type) {
    case "open": return { type: "open", target: str(a.target, `${where}.action.target`) };
    case "hotkey": return { type: "hotkey", keys: str(a.keys, `${where}.action.keys`) };
    case "type": return { type: "type", text: str(a.text, `${where}.action.text`) };
    case "shell": return { type: "shell", command: str(a.command, `${where}.action.command`) };
    case "page": return { type: "page", page: str(a.page, `${where}.action.page`) };
    case "sound": {
      const sound = str(a.sound, `${where}.action.sound`);
      if (!SOUND_ID_RE.test(sound)) throw new Error(`${where}.action.sound must be an uploaded sound (snd:<id>)`);
      const out: Action = { type: "sound", sound };
      if (a.on !== undefined) { if (!["mac", "phone", "both"].includes(a.on)) throw new Error(`${where}.action.on must be mac, phone or both`); (out as any).on = a.on; }
      if (a.volume !== undefined) (out as any).volume = num(a.volume, `${where}.action.volume`, 0, 100);
      if (a.mode !== undefined) { if (!["overlap", "restart", "toggle"].includes(a.mode)) throw new Error(`${where}.action.mode must be overlap, restart or toggle`); (out as any).mode = a.mode; }
      return out;
    }
    case "sound-stop": return { type: "sound-stop" };
    case "lock": return { type: "lock" };
    case "screenshot": {
      if (a.mode !== undefined && !(SCREENSHOT_MODES as unknown[]).includes(a.mode)) throw new Error(`${where}.action.mode must be region, screen or window`);
      return { type: "screenshot", ...(a.mode !== undefined ? { mode: a.mode } : {}), ...screenshotChoice(a, `${where}.action`) };
    }
    case "onair": case "mic": case "camera": return liveAction(a, `${where}.action`);
    case "macro": return { type: "macro", steps: macroSteps(a.steps, `${where}.action.steps`) };
    case "plugin": {
      const plugin = str(a.plugin, `${where}.action.plugin`);
      if (!PLUGIN_ID_RE.test(plugin)) throw new Error(`${where}.action.plugin must be a plugin id like dev.author.name`);
      const action = str(a.action, `${where}.action.action`);
      if (!PLUGIN_PART_RE.test(action)) throw new Error(`${where}.action.action must be an action id of that plugin`);
      const settings = pluginSettings(a.settings, `${where}.action.settings`);
      return { type: "plugin", plugin, action, ...(settings ? { settings } : {}) };
    }
    case "hass": {
      const service = str(a.service, `${where}.action.service`);
      if (!HASS_SERVICE_RE.test(service)) throw new Error(`${where}.action.service must look like "domain.service"`);
      const out: any = { type: "hass", service };
      if (a.entityId !== undefined && a.entityId !== "") {
        const e = str(a.entityId, `${where}.action.entityId`);
        if (!HASS_ENTITY_RE.test(e)) throw new Error(`${where}.action.entityId must look like "domain.object_id"`);
        out.entityId = e;
      }
      if (a.data !== undefined && a.data !== null) {
        if (typeof a.data !== "object" || Array.isArray(a.data)) throw new Error(`${where}.action.data must be an object`);
        if (JSON.stringify(a.data).length > 2048) throw new Error(`${where}.action.data is too large`);
        out.data = a.data;
      }
      return out;
    }
    case "media":
      if (!["playpause", "next", "previous"].includes(a.command)) throw new Error(`${where}.action.command is invalid`);
      return { type: "media", command: a.command };
    case "volume":
      if (!["up", "down", "mute"].includes(a.command)) throw new Error(`${where}.action.command is invalid`);
      return { type: "volume", command: a.command };
    default:
      throw new Error(`${where}.action.type "${a.type}" is not supported`);
  }
}

/** Validates untrusted layout JSON and returns a normalized copy. Throws with a readable message. */
export function validateLayout(raw: any): Layout {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.pages)) throw new Error("layout.pages must be an array");
  if (raw.pages.length === 0) throw new Error("layout needs at least one page");
  const pageIds = new Set<string>();
  const pages: Page[] = raw.pages.map((p: any, pi: number) => {
    const where = `pages[${pi}]`;
    const id = str(p?.id, `${where}.id`);
    if (pageIds.has(id)) throw new Error(`duplicate page id "${id}"`);
    pageIds.add(id);
    const columns = Number(p.columns ?? 4);
    if (!Number.isInteger(columns) || columns < 1 || columns > MAX_COLUMNS) throw new Error(`${where}.columns must be 1-${MAX_COLUMNS}`);
    const rows = p.rows === undefined || p.rows === null ? undefined : num(p.rows, `${where}.rows`, 1, MAX_ROWS);
    if (!Array.isArray(p.items)) throw new Error(`${where}.items must be an array`);
    const itemIds = new Set<string>();
    const items: Item[] = p.items.map((it: any, ii: number) => {
      const w = `${where}.items[${ii}]`;
      const itemId = str(it?.id, `${w}.id`);
      if (itemIds.has(itemId)) throw new Error(`duplicate item id "${itemId}" on page "${id}"`);
      itemIds.add(itemId);
      const color = optColor(it.color, `${w}.color`);
      const size: Size = {};
      if (it.w !== undefined && it.w !== null) size.w = num(it.w, `${w}.w`, 1, columns);
      if (it.h !== undefined && it.h !== null) size.h = num(it.h, `${w}.h`, 1, MAX_ROWS);
      const hasX = it.x !== undefined && it.x !== null, hasY = it.y !== undefined && it.y !== null;
      if (hasX !== hasY) throw new Error(`${w} needs both x and y, or neither`);
      if (hasX) { size.x = num(it.x, `${w}.x`, 0, columns - 1); size.y = num(it.y, `${w}.y`, 0, MAX_ROWS - 1); }
      if (it.kind === "widget") {
        if (!WIDGET_KINDS.includes(it.widget)) throw new Error(`${w}.widget "${it.widget}" is not supported`);
        if (it.widget === "onair" && !ONAIR_SIZES.includes(`${size.w ?? 1}x${size.h ?? 1}`)) throw new Error(`${w}: an On Air tile is 1x1, 2x1 or 2x2`);
        let provider: AiProvider | undefined;
        if (it.provider !== undefined && it.provider !== null && it.provider !== "") {
          if (!AI_PROVIDERS.includes(it.provider)) throw new Error(`${w}.provider must be one of ${AI_PROVIDERS.join(", ")}`);
          provider = it.provider;
        }
        if (it.widget === "quota" && !provider) throw new Error(`${w}: a quota widget needs a provider`);
        const clock = it.widget === "clock" ? clockOptions(it.clock, `${w}.clock`) : undefined;
        const metric = (METRIC_WIDGETS as readonly string[]).includes(it.widget) ? metricOptions(it.metric, it.widget, `${w}.metric`) : undefined;
        const quota = it.widget === "quota" ? quotaOptions(it.quota, `${w}.quota`) : undefined;
        const weather = it.widget === "weather" ? weatherOptions(it.weather, `${w}.weather`) : undefined;
        const push = it.widget === "value" ? pushOptions(it.push, `${w}.push`) : undefined;
        let entity: EntityOptions | undefined;
        if (it.widget === "entity") {
          const e = it.entity;
          if (!e || typeof e !== "object") throw new Error(`${w}: an entity widget needs entity.id`);
          const id = str(e.id, `${w}.entity.id`);
          if (!HASS_ENTITY_RE.test(id)) throw new Error(`${w}.entity.id must look like "domain.object_id"`);
          entity = { id };
          if (e.name !== undefined && e.name !== "") entity.name = str(e.name, `${w}.entity.name`).slice(0, 60);
          if (e.readOnly !== undefined) entity.readOnly = bool(e.readOnly, `${w}.entity.readOnly`);
          if (e.tap !== undefined) { if (e.tap !== "sheet" && e.tap !== "toggle") throw new Error(`${w}.entity.tap must be sheet or toggle`); entity.tap = e.tap; }
          if (e.inlineControls !== undefined) entity.inlineControls = bool(e.inlineControls, `${w}.entity.inlineControls`);
          if (e.refresh !== undefined) {
            if (!Number.isInteger(e.refresh) || e.refresh < 5 || e.refresh > 60) throw new Error(`${w}.entity.refresh must be a whole number of seconds from 5 to 60`);
            entity.refresh = e.refresh;
          }
          if (e.show !== undefined) { if (!["auto", "state", "value", "toggle"].includes(e.show)) throw new Error(`${w}.entity.show is invalid`); entity.show = e.show; }
        }
        let plugin: PluginRef | undefined;
        if (it.widget === "plugin") {
          const pr = it.plugin;
          if (!pr || typeof pr !== "object") throw new Error(`${w}: a plugin widget needs plugin.id and plugin.widget`);
          const pid = str(pr.id, `${w}.plugin.id`);
          if (!PLUGIN_ID_RE.test(pid)) throw new Error(`${w}.plugin.id must be a plugin id like dev.author.name`);
          const pw = str(pr.widget, `${w}.plugin.widget`);
          if (!PLUGIN_PART_RE.test(pw)) throw new Error(`${w}.plugin.widget must be a widget id of that plugin`);
          const ps = pluginSettings(pr.settings, `${w}.plugin.settings`);
          let view: PluginRef["view"];
          if (pr.view !== undefined && pr.view !== null) {
            if (typeof pr.view !== "object" || Array.isArray(pr.view)) throw new Error(`${w}.plugin.view must be an object`);
            if (pr.view.style !== undefined && pr.view.style !== "") {
              if (typeof pr.view.style !== "string" || !ALL_STYLES.includes(pr.view.style)) throw new Error(`${w}.plugin.view.style must be one of: ${ALL_STYLES.join(", ")}`);
              view = { style: pr.view.style };
            }
          }
          plugin = { id: pid, widget: pw, ...(ps ? { settings: ps } : {}), ...(view ? { view } : {}) };
        }
        // an On Air tile may toggle On Air when tapped; no other widget keeps an action
        let action: Action | undefined;
        if (it.widget === "onair" && it.action !== undefined && it.action !== null) {
          action = validateAction(it.action, w);
          if (action.type !== "onair") throw new Error(`${w}.action: an On Air tile can only run an On Air action`);
        }
        return { id: itemId, kind: "widget", widget: it.widget, color, ...(action ? { action } : {}), ...(plugin ? { plugin } : {}), ...(provider ? { provider } : {}), ...(clock ? { clock } : {}), ...(metric ? { metric } : {}), ...(quota ? { quota } : {}), ...(entity ? { entity } : {}), ...(weather ? { weather } : {}), ...(push ? { push } : {}), ...size, ...itemStyle(it, w) };
      }
      if (it.kind === "button") {
        return {
          id: itemId,
          kind: "button",
          label: str(it.label ?? "", `${w}.label`),
          icon: it.icon === undefined || it.icon === "" ? undefined : normalizeIcon(str(it.icon, `${w}.icon`), `${w}.icon`),
          color,
          action: it.action === undefined || it.action === null ? undefined : validateAction(it.action, w),
          ...size,
          ...itemStyle(it, w),
        };
      }
      throw new Error(`${w}.kind must be "button" or "widget"`);
    });
    const placed = placeItems(items, columns, rows, `page "${id}"`);
    const pageLook = p.theme === undefined || p.theme === null ? undefined : validateLook(p.theme, `${where}.theme`);
    return { id, name: str(p.name ?? id, `${where}.name`), columns, rows: placed.rows, items: placed.items, ...(pageLook && Object.keys(pageLook).length ? { theme: pageLook } : {}) };
  });
  // the phone gets plugin data keyed by tile id, so a plugin tile id must be unique in the whole layout
  const pluginTiles = new Set<string>();
  for (const pg of pages) for (const it of pg.items) {
    if (it.kind !== "widget" || it.widget !== "plugin") continue;
    if (pluginTiles.has(it.id)) throw new Error(`plugin tile id "${it.id}" is used twice: plugin tiles need ids that are unique across all pages`);
    pluginTiles.add(it.id);
  }
  const theme = validateTheme(raw.theme);
  const rules = validateRules(raw.rules, new Set(pages.map((p) => p.id)));
  const alarms = validateAlarms(raw.alarms);
  return { version: 1, ...(theme ? { theme } : {}), pages, ...(rules ? { rules } : {}), ...(alarms && alarms.length ? { alarms } : {}) };
}
