// Wire types shared with the agent (mirrors src/config.ts; kept local so web/deck builds on its own).
import type { CameraAction, MicAction, OnAirAction } from '../../shared/onair'
export type Action =
  | { type: 'open'; target: string }
  | { type: 'hotkey'; keys: string }
  | { type: 'type'; text: string }
  | { type: 'shell'; command: string }
  | { type: 'media'; command: 'playpause' | 'next' | 'previous' }
  | { type: 'volume'; command: 'up' | 'down' | 'mute' }
  | { type: 'page'; page: string }
  | { type: 'sound'; sound: string; on?: 'mac' | 'phone' | 'both'; volume?: number; mode?: 'overlap' | 'restart' | 'toggle' }
  | { type: 'sound-stop' }
  | { type: 'lock' }
  | { type: 'screenshot'; mode?: 'region' | 'screen' | 'window' }
  | { type: 'macro'; steps: { kind: string; [k: string]: unknown }[] }
  | { type: 'plugin'; plugin: string; action: string; args?: { [k: string]: unknown } }
  | { type: 'hass'; service: string; entityId?: string; data?: { [k: string]: unknown } }
  | OnAirAction
  | MicAction
  | CameraAction

export type WidgetKind = 'clock' | 'cpu' | 'gpu' | 'memory' | 'uptime' | 'load' | 'network' | 'nowplaying' | 'quota' | 'sessions' | 'entity' | 'weather' | 'value' | 'notifications' | 'plugin' | 'onair'

export type ClockStyle = 'digital' | 'flip' | 'analog' | 'minimal' | 'word' | 'world' | 'weather' | 'lunar' | 'bloc' | 'segment' | 'ring' | 'stack' | 'ticks' | 'dither'
export interface ClockOptions {
  style?: ClockStyle
  seconds?: boolean
  hour12?: boolean
  showDate?: boolean
  timeZone?: string
  zones?: string[]
  label?: string
  /** weather style: where to read the weather (the agent serves it as a core.weather tile keyed by the clock's id) */
  weather?: WeatherOptions
}

export type QuotaChart = 'auto' | 'bars' | 'rings' | 'gauge' | 'meter' | 'number' | 'history'
export interface QuotaOptions {
  chart?: QuotaChart
  /** 'all' | 'main' (first window) | window ids in display order; the first is the hero */
  windows?: 'all' | 'main' | string[]
  showReset?: boolean
  account?: string
}

export type MetricChart = 'sparkline' | 'area' | 'bars' | 'gauge' | 'ring' | 'bar' | 'number' | 'donut'
export interface MetricOptions {
  chart?: MetricChart
  window?: 60 | 300 | 900
  showDelta?: boolean
  showSub?: boolean
}

export interface WeatherOptions {
  source?: 'auto' | 'hass' | 'open-meteo'
  entity?: string
  location?: { name: string; lat: number; lon: number }
  show?: 'now' | 'hourly' | 'daily' | 'auto'
  units?: 'metric' | 'imperial'
}
export interface PushOptions {
  key: string
  label?: string
  unit?: string
}
/**
 * The agent's weather answer (src/weather.ts WeatherData, keep the two in step) and the older deck shape it replaced (hourly[].t,
 * daily[].t/high/low, unit). The tile reads both through weather-logic normWeather.
 */
export interface WeatherData {
  now: {
    temp: number
    feels?: number
    condition?: string | number
    /** WMO weather code */
    code?: number
    icon?: string
    text?: string
    high?: number
    low?: number
    humidity?: number
    wind?: number
    /** degrees the wind comes from, 0 = north */
    windDir?: number
    /** the source's wind unit ("km/h", "m/s", "mph"); missing = from `units` */
    windUnit?: string
    /** US AQI (Open-Meteo air quality), missing when it could not be read */
    aqi?: number
    isDay?: boolean
  }
  hourly?: { time?: string; t?: number | string; temp: number; condition?: string | number; code?: number; icon?: string }[]
  daily?: {
    date?: string
    t?: number | string
    min?: number
    max?: number
    high?: number
    low?: number
    condition?: string | number
    code?: number
    icon?: string
    /** precipitation, mm */
    rain?: number
    /** chance of precipitation, % */
    pop?: number
    uv?: number
  }[]
  source?: string
  /** agent: the unit every temperature is in */
  tempUnit?: 'c' | 'f'
  units?: 'metric' | 'imperial'
  /** older shape: unit the numbers are in ('C' | 'F' | '°C' ...); missing = the unit that was requested (open-meteo) or C */
  unit?: string
  location?: string
  updatedAt?: number | string
}
export interface PushedValue {
  value: string | number
  sub?: string
  unit?: string
  ttl?: number
  at: number
}
export interface Notice {
  id: string
  title: string
  body?: string
  level?: 'info' | 'warn' | 'alert'
  at: number
  ttl?: number
  /** a plugin's ctx.notify sound, played when the notification arrives */
  sound?: 'chime' | 'soft' | 'birds'
}
export interface GotoReq {
  id: string
  pageId: string
  countdown: number
  reason?: string
  at: number
}

export interface EntityOptions {
  id: string
  name?: string
  readOnly?: boolean
  show?: 'auto' | 'state' | 'value' | 'toggle'
  /** camera.*: seconds between pictures on the tile, 5 to 60 (default 10) */
  refresh?: number
}
/** one Home Assistant entity as the agent sends it ({type:'hass', entities, connected}) */
export interface HassEntity {
  state: string
  name?: string
  unit?: string
  icon?: string
  domain?: string
  attrs?: { [k: string]: unknown }
}
export interface HassState {
  entities: { [id: string]: HassEntity }
  connected: boolean
}

export type TileStyle = 'tint' | 'solid' | 'outline' | 'ios'
export type Orientation = 'landscape' | 'portrait' | 'auto'

export type Item = {
  id: string
  kind: 'button' | 'widget'
  x?: number
  y?: number
  style?: TileStyle
  textColor?: string
  hideLabel?: boolean
  provider?: AiProvider
  clock?: ClockOptions
  metric?: MetricOptions
  quota?: QuotaOptions
  entity?: EntityOptions
  weather?: WeatherOptions
  push?: PushOptions
  /** widget 'plugin': which plugin widget this tile shows, with its settings (secrets stay on the agent) */
  plugin?: { id: string; widget: string; settings?: { [k: string]: unknown }; view?: { style?: string } }
  label?: string
  icon?: string
  color?: string
  action?: Action
  widget?: WidgetKind
  w?: number
  h?: number
}

export interface StateLook { tile?: string; text?: string; accent?: string; border?: { width: number; color?: string }; shadow?: string }
export interface KindLook { tile?: string; text?: string; muted?: string; accent?: string; radius?: number; border?: { width: number; color?: string }; shadow?: string; tileOpacity?: number; tileBlur?: number; font?: string; numberFont?: string; labelPosition?: string; labelWeight?: string; states?: { pressed?: StateLook; active?: StateLook; alert?: StateLook } }
/** The look fields (also on a page: page.theme overrides while that page is shown). */
export interface Look {
  mode?: 'dark' | 'light' | 'auto'
  accent?: string
  background?: string
  tile?: string
  text?: string
  muted?: string
  radius?: number
  gap?: number
  fontScale?: number
  font?: string
  numberFont?: string
  backgroundImage?: string
  backgroundFit?: 'cover' | 'contain' | 'tile'
  backgroundDim?: number
  backgroundBlur?: number
  gradient?: { from: string; to: string; angle: number }
  tileOpacity?: number
  tileBlur?: number
  border?: { width: number; color?: string }
  shadow?: 'none' | 'soft' | 'strong'
  labelPosition?: 'bottom' | 'top' | 'hidden'
  labelWeight?: 'regular' | 'medium' | 'bold'
  iconStyle?: 'line' | 'filled'
  palette?: { ok?: string; warn?: string; error?: string; info?: string }
  chartColors?: string[]
}
export interface Theme extends Look {
  source?: { pack: string; variant?: string; auto?: { light: string; dark: string }; options?: { [k: string]: string } }
  auto?: { light: Look; dark: Look }
  kinds?: { [kind: string]: KindLook }
  fonts?: { family: string; file: string; weight?: number }[]
  mode?: 'dark' | 'light' | 'auto'
  /** UI language of the overlays; missing = 'en' */
  language?: 'en' | 'vi' | 'zh' | 'fr' | 'pt'
  accent?: string
  background?: string
  tile?: string
  radius?: number
  gap?: number
  fontScale?: number
  tileStyle?: TileStyle
  iconStroke?: number
  iconScale?: number
  showLabels?: boolean
  text?: string
  orientation?: Orientation
  /** every temperature on the phone; missing = 'c' */
  temperatureUnit?: 'c' | 'f'
  /** lite mode, keep awake, standby clock, dim */
  screen?: ScreenSettings
  /** top bar: full (default), minimal (no computer name / CPU / RAM), hidden (no bar, a small corner button) */
  header?: HeaderMode
}

export type HeaderMode = 'full' | 'minimal' | 'hidden'

export interface ScreenSettings {
  /** 'auto' = the deck decides (old iOS, <= 2 CPU cores, deviceMemory <= 2); default 'auto' */
  lite?: 'auto' | 'on' | 'off'
  /** keep the phone screen on; default true */
  keepAwake?: boolean
  /** move the grid by up to 2 px every 3 minutes against burn-in; missing = off */
  burnInShift?: boolean
  /** swiping past the last page goes to the first and back; missing = off */
  wrap?: boolean
  /** hide the page dots (they show for a moment while swiping); missing = shown */
  hideDots?: boolean
  /** after a button that locks the computer: this phone goes black (default), every phone, or none (the agent sends {type:'sleep'}) */
  lockSleep?: 'phone' | 'all' | 'off'
  standby?: {
    enabled: boolean
    /** idle minutes (no touch) before standby, 1..120; default 5 */
    afterMin: number
    style: 'digital' | 'analog' | 'words'
    showDate?: boolean
    showNext?: boolean
  }
  dim?: {
    /** black overlay opacity while dimmed, 0..0.9; default 0.6 */
    level: number
    /** "HH:MM" phone local time; both missing = never auto-dim; the window may wrap midnight */
    from?: string
    to?: string
  }
}

export interface Alarm {
  id: string
  /** "HH:MM" 24h, phone local time */
  time: string
  /** 0=Sun..6=Sat; missing/empty = one-shot */
  days?: number[]
  label?: string
  enabled: boolean
  sound: 'chime' | 'birds' | 'soft' | 'none'
  /** 0..30 minutes of sunrise before time */
  sunriseMin: number
  /** 1..30, default 9 */
  snoozeMin: number
  /** device ids; missing/empty = every phone */
  devices?: string[]
}

export interface Page {
  id: string
  name: string
  columns: number
  rows?: number
  items: Item[]
  theme?: Look
}

/** icon values the phone does not know: {svg: inner markup of a 24x24 icon} or {img: data URL} (app icons, uploaded images, catalog icons) */
export type IconAssets = { [value: string]: { svg?: string; img?: string; variant?: 'O' | 'F'; vb?: string; brand?: boolean } }

export interface Layout {
  version: 1
  theme?: Theme
  assets?: IconAssets
  alarms?: Alarm[]
  pages: Page[]
}

export interface Stats {
  cpu: number
  memUsed: number
  memTotal: number
  uptime: number
  load: number[]
  /** what `load` measures: loadavg (unix load average), queue (Windows processor queue length), estimate (derived from CPU use) */
  loadKind?: 'loadavg' | 'queue' | 'estimate'
  time: number
  host?: string
  net?: { rx: number; tx: number }
  volume?: { level: number; muted: boolean } | null
  /** graphics card; absent = unknown (Linux, read failed) */
  gpu?: { util: number; memUsed?: number; memTotal?: number; temp?: number; name?: string }
  /** logical CPU count (older agents: absent) */
  ncpu?: number
  /** per-core busy percent, same order as the OS lists the cores */
  cores?: number[]
  /** file cache and swap in bytes, when the OS tells (Windows: absent) */
  mem?: { cached?: number; swapUsed?: number; swapTotal?: number }
}

export type MediaCommand = 'playpause' | 'next' | 'previous' | 'resume' | 'open'

export interface Media {
  app?: string
  title?: string
  artist?: string
  album?: string
  playing?: boolean
  position?: number
  duration?: number
  artwork?: string
  /** client clock (ms) when this update arrived, to advance the position locally */
  at?: number
}

export type AiProvider = 'claude' | 'codex' | 'antigravity' | 'opencode' | 'grok'

export interface AiWindow {
  id: string
  label: string
  usedPercent: number
  resetsAt?: number | string
  windowMinutes?: number
  /** usedPercent samples [ms, percent], every 5 min for up to 24 h */
  history?: [number, number][]
}
export interface AiAccount {
  id: string
  email?: string
  label?: string
  status?: string
  displayName?: string
  plan?: string
  windows: AiWindow[]
  stale?: boolean
  /** why this account has no current reading (the agent sends it per account) */
  error?: string
  fetchedAt?: number | string
}
export interface AiExtra {
  label: string
  value: number | string
  unit?: string
}
export interface AiProviderInfo {
  id: string
  source?: string
  status?: string
  email?: string
  label?: string
  accounts?: AiAccount[]
  extras?: AiExtra[]
  name: string
  plan?: string
  windows: AiWindow[]
  error?: string
  updatedAt?: number | string
}
export interface AiSession {
  id: string
  tool: string
  project: string
  title?: string
  model?: string
  state: 'working' | 'waiting' | 'idle'
  updatedAt: number | string
  tokens?: number
}
export interface AiData {
  providers: AiProviderInfo[]
  sessions: AiSession[]
}

export interface PermissionRequest {
  id: string
  source: 'claude' | 'codex' | 'opencode'
  project: string
  tool: string
  summary: string
  detail?: string
  risk?: 'low' | 'medium' | 'high'
  riskReason?: string
  sessionId?: string
  createdAt?: number | string
  expiresAt: number | string
}

/** Claude Code AskUserQuestion forwarded to the phone (PreToolUse hook) */
export interface QuestionItem {
  question: string
  header?: string
  options: { label: string; description?: string }[]
  /** Claude: multiSelect. OpenCode: multiple. Either one turns the options into checkboxes. */
  multiSelect?: boolean
  multiple?: boolean
  /** OpenCode: false when only the listed options are allowed (no 'Other' field). Default true. */
  custom?: boolean
}
export interface QuestionRequest {
  id: string
  /** which tool is asking: 'claude' (default) or 'opencode' */
  source?: 'claude' | 'opencode'
  project: string
  sessionId?: string
  questions: QuestionItem[]
  createdAt?: number | string
  expiresAt: number | string
}

export interface ProcInfo {
  pid: number
  name: string
  cpu: number
  mem: number
}
