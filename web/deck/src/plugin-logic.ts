/** Pure validation for plugin tiles. No DOM, no deck imports: the agent sends {render, data} and the deck never trusts it. */
import { PLUGIN_STYLES } from '../../shared/plugin-styles'
import { validateCard } from '../../../src/plugins/card'
import type { CardData } from '../../../src/plugins/card'
import type { AiData, AiProviderInfo, QuotaChart, QuotaOptions, WeatherData, WeatherOptions } from './types'

export type PluginRender = 'stat' | 'gauge' | 'text' | 'list' | 'chart' | 'image' | 'status' | 'card'
export const PLUGIN_RENDERS: PluginRender[] = ['stat', 'gauge', 'text', 'list', 'chart', 'image', 'status', 'card']
export const MAX_LIST = 20
export const MAX_POINTS = 120
export type PluginState = 'ok' | 'warn' | 'error' | 'off'

export interface StatData { value: string | number; unit?: string; label?: string; delta?: number; color?: string; points?: number[] }
export interface GaugeData { value: number; label?: string; color?: string }
export interface TextData { title?: string; body: string }
export interface ListRow { title: string; subtitle?: string; value?: string; icon?: string }
export interface ListData { items: ListRow[] }
export interface ChartData { points: number[]; label?: string; unit?: string }
export interface ImageData { url: string; fit?: 'cover' | 'contain' }
export interface StatusData { state: PluginState; label: string; title?: string; value?: string; unit?: string; detail?: string; points?: number[] }

/** Display styles per renderer; the first is the default. One table, shared with the agent and the manage picker (web/shared/plugin-styles.ts). */
export { PLUGIN_STYLES }/** The style to draw: the tile's choice, else the widget's suggestion, else the renderer's default. */
export function pickStyle(render: string, choice: string | undefined, suggested: string | undefined): string {
  const all = PLUGIN_STYLES[render] || ['']
  if (choice && all.indexOf(choice) >= 0) return choice
  if (suggested && all.indexOf(suggested) >= 0) return suggested
  return all[0]
}

export type PluginEntry =
  | { render: 'stat'; data: StatData; style?: string }
  | { render: 'gauge'; data: GaugeData; style?: string }
  | { render: 'text'; data: TextData; style?: string }
  | { render: 'list'; data: ListData; style?: string }
  | { render: 'chart'; data: ChartData; style?: string }
  | { render: 'image'; data: ImageData; style?: string }
  | { render: 'status'; data: StatusData; style?: string }
  | { render: 'card'; data: CardData; style?: string }

const isObj = (x: unknown): x is { [k: string]: unknown } => !!x && typeof x === 'object' && !Array.isArray(x)
const isNum = (x: unknown): x is number => typeof x === 'number' && isFinite(x)
const optStr = (x: unknown): string | undefined | null => (x === undefined || x === null ? undefined : typeof x === 'string' ? x : null)
const COLOR = /^#[0-9a-fA-F]{3,8}$/

/** Only https and data:image URLs may load; never http, javascript: or file:. */
export function safeImageUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null
  const s = u.trim()
  if (s.length === 0 || s.length > 2000000) return null
  if (/^https:\/\/[^\s]+$/i.test(s)) return s
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif);/i.test(s)) return s
  return null
}

/** The validated entry for one tile, or null when the render is unknown or the data is invalid. */
export function validatePlugin(render: unknown, data: unknown): PluginEntry | null {
  if (typeof render !== 'string' || !isObj(data)) return null
  const d = data
  if (render === 'card') {
    const c = validateCard(d)
    return 'error' in c ? null : { render, data: c.data }
  }
  if (render === 'stat') {
    const v = d.value
    if (!(typeof v === 'string' || isNum(v))) return null
    const unit = optStr(d.unit)
    const label = optStr(d.label)
    if (unit === null || label === null) return null
    if (d.delta !== undefined && d.delta !== null && !isNum(d.delta)) return null
    if (d.color !== undefined && d.color !== null && !(typeof d.color === 'string' && COLOR.test(d.color))) return null
    const sp: number[] = []
    if (Array.isArray(d.points)) for (let i = 0; i < d.points.length; i++) if (isNum(d.points[i])) sp.push(d.points[i] as number)
    return { render, data: { value: v, unit, label, delta: isNum(d.delta) ? d.delta : undefined, color: typeof d.color === 'string' ? d.color : undefined, points: sp.length ? sp.slice(-60) : undefined } }
  }
  if (render === 'gauge') {
    if (!isNum(d.value) || d.value < 0 || d.value > 100) return null
    const label = optStr(d.label)
    if (label === null) return null
    if (d.color !== undefined && d.color !== null && !(typeof d.color === 'string' && COLOR.test(d.color))) return null
    return { render, data: { value: d.value, label, color: typeof d.color === 'string' ? d.color : undefined } }
  }
  if (render === 'text') {
    if (typeof d.body !== 'string') return null
    const title = optStr(d.title)
    if (title === null) return null
    return { render, data: { title, body: d.body } }
  }
  if (render === 'list') {
    if (!Array.isArray(d.items) || d.items.length > MAX_LIST) return null
    const items: ListRow[] = []
    for (let i = 0; i < d.items.length; i++) {
      const r = d.items[i]
      if (!isObj(r) || typeof r.title !== 'string') return null
      const sub = optStr(r.subtitle)
      const icon = optStr(r.icon)
      if (sub === null || icon === null) return null
      let val: string | undefined
      if (r.value !== undefined && r.value !== null) {
        if (typeof r.value === 'string') val = r.value
        else if (isNum(r.value)) val = String(r.value)
        else return null
      }
      items.push({ title: r.title, subtitle: sub, value: val, icon })
    }
    return { render, data: { items } }
  }
  if (render === 'chart') {
    if (!Array.isArray(d.points) || d.points.length > MAX_POINTS) return null
    for (let i = 0; i < d.points.length; i++) if (!isNum(d.points[i])) return null
    const label = optStr(d.label)
    const unit = optStr(d.unit)
    if (label === null || unit === null) return null
    return { render, data: { points: d.points as number[], label, unit } }
  }
  if (render === 'image') {
    const url = safeImageUrl(d.url)
    if (!url) return null
    if (d.fit !== undefined && d.fit !== null && d.fit !== 'cover' && d.fit !== 'contain') return null
    return { render, data: { url, fit: d.fit === 'contain' ? 'contain' : d.fit === 'cover' ? 'cover' : undefined } }
  }
  if (render === 'status') {
    const s = d.state
    if (s !== 'ok' && s !== 'warn' && s !== 'error' && s !== 'off') return null
    if (typeof d.label !== 'string') return null
    const str = (v: unknown, n: number): string | undefined => (typeof v === 'string' && v ? v.slice(0, n) : typeof v === 'number' && isFinite(v) ? String(v).slice(0, n) : undefined)
    const pts: number[] = []
    if (Array.isArray(d.points)) for (let i = 0; i < d.points.length; i++) { const n = d.points[i]; if (typeof n === 'number' && isFinite(n)) pts.push(n) }
    return { render, data: { state: s, label: d.label, title: str(d.title, 40), value: str(d.value, 12), unit: str(d.unit, 8), detail: str(d.detail, 60), points: pts.length ? pts.slice(-60) : undefined } }
  }
  return null
}

/** The base text size of a card, from the tile's own size; card.tsx steps it down when the parts do not fit. */
export function cardBase(tw: number, th: number): number {
  return Math.max(11, Math.min(15, Math.round(Math.min(tw, th * 1.5) / 12)))
}
export const CARD_SHRINK = [1, 0.92, 0.85, 0.78, 0.7]
export const CARD_MIN_PX = 9
/** A `stack: "auto"` row is drawn as a column when its box is about square or taller. */
export const cardStacks = (width: number, height: number): boolean => width < height * 1.4
/**
 * The size of a ring's centre text in a dial of `side` px: it fits inside the ring (0.62 of the dial across, with air around it; a tabular digit is
 * about 0.6 of the font size, ':' '.' and ' ' about half that) and is never larger than 0.28 of the dial.
 */
export function ringTextPx(side: number, text: string): number {
  const ems = Math.max(0.6, (text.length - (text.replace(/[:. ]/g, '').length)) * 0.3 + text.replace(/[:. ]/g, '').length * 0.6)
  return Math.floor(Math.min(side * 0.28, (side * 0.62) / ems) * 2) / 2
}

/** An error tile: `error` is the agent's text (may be empty when the data was just invalid). */
export interface PluginError { error: string }
/** A core plugin's own renderer (custom:weather, custom:quota): the deck draws its built-in tile from its own data, so only its errors matter here. */
export interface PluginCustom { custom: string; data?: { [k: string]: unknown } }
export type PluginSlot = PluginEntry | PluginError | PluginCustom | null

/** One wire item: {render, data} is validated; {error} keeps its text; anything else (missing, junk) is the empty error. */
export function parsePluginItem(x: unknown): PluginSlot {
  if (isObj(x) && x.error !== undefined) return { error: typeof x.error === 'string' ? x.error.slice(0, 200) : '' }
  if (isObj(x) && typeof x.render === 'string' && x.render.slice(0, 7) === 'custom:') return isObj(x.data) ? { custom: x.render.slice(7, 40), data: x.data } : { custom: x.render.slice(7, 40) }
  const v = isObj(x) ? validatePlugin(x.render, x.data) : null
  if (v && isObj(x) && typeof x.style === 'string' && x.style.length <= 20) return { ...v, style: x.style } as PluginEntry
  return v || { error: '' }
}

const FRIENDLY: { [msg: string]: string } = {
  'plugin missing': 'Plugin missing',
  'plugin disabled': 'Plugin off',
  'plugin not granted': 'Needs approval',
  'plugin widget missing': 'Tile removed',
}
/** The label for a known agent error (an English key for t()), or null for free text / empty. */
export function friendlyError(msg: string): string | null {
  return FRIENDLY[msg.trim().toLowerCase()] || null
}

/**
 * Merge a {type:'plugin', items} message into the current map by tile id: the latest value per tile wins.
 * The first message after connecting is the full map and later ones are partial, so tiles missing from a message keep their value.
 */
export function mergePlugins(cur: { [tileId: string]: PluginSlot } | undefined, items: unknown): { [tileId: string]: PluginSlot } {
  const out: { [tileId: string]: PluginSlot } = {}
  const c = cur || {}
  Object.keys(c).forEach((k) => (out[k] = c[k]))
  if (!isObj(items)) return out
  Object.keys(items).forEach((k) => (out[k] = parsePluginItem(items[k])))
  return out
}

/** Manage preview of one tile: the data the parent sent for this tile (checked like live data), else a sample by widget name. */
export function previewSlot(pluginData: unknown, tileId: string, widget: string, pluginId?: string): PluginSlot {
  void widget
  const core = pluginId !== undefined && pluginId.slice(0, 5) === 'core.'
  if (isObj(pluginData) && Object.prototype.hasOwnProperty.call(pluginData, tileId)) {
    const one = pluginData[tileId]
    // a plain state from the parent (plugin missing / off / no preview): shown as such
    if (isObj(one) && typeof one.error === 'string') return { error: one.error.slice(0, 200) }
    // a core quota / weather sample (custom:*) is only kept for a core.* plugin: coreTileOf then draws the real legacy tile
    if (isObj(one) && typeof one.render === 'string' && one.render.slice(0, 7) === 'custom:') return core ? parsePluginItem(one) : { error: 'invalid data' }
    const ok = isObj(one) ? validatePlugin(one.render, one.data) : null
    return ok || { error: 'invalid data' }
  }
  if (core && widget === 'quota') return { custom: 'quota', data: sampleQuota() }
  if (core && widget === 'weather') return { custom: 'weather', data: sampleWeather() }
  // nothing from the parent: no invented values, just "no preview"
  return { error: 'no preview|' }
}

/** Demo data in the shape of the agent's quota block (never a real account). */
function sampleQuota(): { [k: string]: unknown } {
  const now = Date.now()
  return { id: 'claude', name: 'Claude', plan: 'Max', updatedAt: now, windows: [
    { id: 'five_hour', label: '5 hours', usedPercent: 62, windowMinutes: 300, resetsAt: now + 140 * 60000 },
    { id: 'seven_day', label: '7 days', usedPercent: 34, windowMinutes: 10080, resetsAt: now + 3300 * 60000 },
  ] }
}

/** Demo data in the shape of the agent's weather answer. */
function sampleWeather(): { [k: string]: unknown } {
  const now = Date.now()
  const p = (n: number) => (n < 10 ? '0' : '') + n
  const day = (d: Date) => d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
  const hours: [number, string, number, string][] = [[31, 'Partly cloudy', 2, 'cloud-sun'], [32, 'Partly cloudy', 2, 'cloud-sun'], [31, 'Cloudy', 3, 'cloud'], [29, 'Cloudy', 3, 'cloud'], [28, 'Light rain', 61, 'rain'], [27, 'Light rain', 61, 'rain']]
  // min, max, condition, code, icon, rain mm, chance of rain %, UV
  const days: [number, number, string, number, string, number, number, number][] = [
    [25, 33, 'Partly cloudy', 2, 'cloud-sun', 0.2, 10, 8.4], [24, 31, 'Light rain', 61, 'rain', 6.8, 80, 3.1], [24, 32, 'Mostly clear', 1, 'sun', 0, 5, 9.2],
    [24, 30, 'Thunderstorm', 95, 'storm', 14.2, 90, 3], [23, 30, 'Light rain', 61, 'rain', 3.6, 65, 4.1], [24, 31, 'Partly cloudy', 2, 'cloud-sun', 0, 15, 8.7], [25, 33, 'Mostly clear', 1, 'sun', 0, 5, 9.5],
  ]
  return {
    now: { temp: 31, feels: 34, condition: 'Partly cloudy', code: 2, icon: 'cloud-sun', humidity: 62, wind: 11, windDir: 135, aqi: 42, isDay: true },
    hourly: hours.map((h, i) => { const d = new Date(now + (i + 1) * 3600000); return { time: day(d) + 'T' + p(d.getHours()) + ':00', temp: h[0], condition: h[1], code: h[2], icon: h[3] } }),
    daily: days.map((x, i) => ({ date: day(new Date(now + i * 86400000)), min: x[0], max: x[1], condition: x[2], code: x[3], icon: x[4], rain: x[5], pop: x[6], uv: x[7] })),
    source: 'open-meteo', location: 'Home', units: 'metric', tempUnit: 'c', updatedAt: now,
  }
}

/** Data used for the manage preview, so plugin tiles are not all error tiles there. Cycles the renderers by widget name. */
export function samplePlugin(widget: string): PluginEntry {
  let h = 0
  for (let i = 0; i < widget.length; i++) h = (h * 31 + widget.charCodeAt(i)) % 7
  const r = PLUGIN_RENDERS[h]
  if (r === 'stat') return { render: 'stat', data: { value: 64231, unit: 'USD', label: 'BTC', delta: 1.8 } }
  if (r === 'gauge') return { render: 'gauge', data: { value: 62, label: 'Battery' } }
  if (r === 'text') return { render: 'text', data: { title: 'Note', body: 'Sample text from a plugin.' } }
  if (r === 'list') return { render: 'list', data: { items: [{ title: 'Build', subtitle: 'main', value: 'ok' }, { title: 'Deploy', subtitle: 'prod', value: '2m' }, { title: 'Tests', value: '412' }] } }
  if (r === 'chart') return { render: 'chart', data: { points: [3, 5, 4, 7, 6, 9, 8, 11, 10, 13], label: 'Requests', unit: '/s' } }
  if (r === 'image') return { render: 'text', data: { title: 'Image', body: 'Shown in the live deck.' } }
  return { render: 'status', data: { state: 'ok', label: 'All good' } }
}

// ---- core plugin tiles ----
// A plugin-kind tile whose plugin id starts with "core." and whose item is custom:quota or custom:weather is drawn with the same
// quota / weather tile as the legacy widgets, from the item's data and the tile's settings. Community plugins never get this.

const QUOTA_CHARTS: QuotaChart[] = ['auto', 'bars', 'rings', 'gauge', 'meter', 'number', 'history']

/** The flat tile settings (string / number / boolean) back to the quota options the legacy tile takes. */
export function quotaOptionsOf(s: { [k: string]: unknown } | undefined): QuotaOptions {
  const o: QuotaOptions = {}
  const v = s || {}
  if (typeof v.chart === 'string' && QUOTA_CHARTS.indexOf(v.chart as QuotaChart) >= 0) o.chart = v.chart as QuotaChart
  if (v.windows === 'all' || v.windows === 'main') o.windows = v.windows
  else if (typeof v.windows === 'string' && v.windows.trim()) {
    const ids = v.windows.split(',').map((x) => x.trim()).filter((x) => !!x)
    if (ids.length) o.windows = ids
  }
  if (v.showReset === false) o.showReset = false
  if (typeof v.account === 'string' && v.account) o.account = v.account
  return o
}

/** The flat tile settings back to the weather options of the legacy tile. */
export function weatherOptionsOf(s: { [k: string]: unknown } | undefined): WeatherOptions {
  const o: WeatherOptions = {}
  const v = s || {}
  if (v.source === 'auto' || v.source === 'hass' || v.source === 'open-meteo') o.source = v.source
  if (typeof v.entity === 'string' && v.entity) o.entity = v.entity
  if (typeof v.lat === 'number' && typeof v.lon === 'number') o.location = { name: typeof v.locationName === 'string' ? v.locationName : '', lat: v.lat, lon: v.lon }
  if (v.show === 'now' || v.show === 'hourly' || v.show === 'daily' || v.show === 'auto') o.show = v.show
  if (v.units === 'metric' || v.units === 'imperial') o.units = v.units
  return o
}

export interface CoreTile {
  kind: 'quota' | 'weather'
  provider?: string
  quota?: QuotaOptions
  weather?: WeatherOptions
  /** quota: the one provider block, shaped like the deck's AI data */
  ai?: AiData
  /** weather: the agent's weather answer */
  wx?: WeatherData
}

/** What to draw for a plugin tile, or null when it is not a core quota / weather tile (then it goes through the community renderers). */
export function coreTileOf(plugin: { id: string; widget: string; settings?: { [k: string]: unknown } } | undefined, slot: PluginSlot): CoreTile | null {
  if (!plugin || !slot || !('custom' in slot) || !slot.data || plugin.id.slice(0, 5) !== 'core.') return null
  const s = plugin.settings
  if (slot.custom === 'quota' && plugin.widget === 'quota') {
    const d = slot.data
    if (typeof d.id !== 'string') return null
    return { kind: 'quota', provider: typeof (s && s.provider) === 'string' ? String(s && s.provider) : d.id, quota: quotaOptionsOf(s), ai: { providers: [d as unknown as AiProviderInfo], sessions: [] } }
  }
  if (slot.custom === 'weather' && plugin.widget === 'weather') {
    if (!isObj(slot.data.now) && typeof slot.data.error !== 'string') return null
    return { kind: 'weather', weather: weatherOptionsOf(s), wx: slot.data as unknown as WeatherData }
  }
  return null
}

/** What a weather-style clock shows, in the units the tile asks for. */
export interface ClockWx {
  /** current temperature, rounded, in `unit` */
  temp: number
  unit: 'C' | 'F'
  /** what the glyph and condition text are picked from: the WMO code when the agent sent one, else the condition word */
  cond: string | number
  high?: number
  low?: number
  /** the agent's now.isDay (Open-Meteo is_day); missing = unknown, the deck then guesses from the hour */
  isDay?: boolean
}

const numOr = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined)

/**
 * A weather-style clock's slot (st.plugins[tile id], the core.weather tile the agent made for it) as what the clock draws; null while
 * there is no data yet or on an error. Reads the agent's answer (src/weather.ts: now.code, daily[0].min/max, tempUnit 'c'|'f') and
 * also the older deck shape (now.high/low, daily[].high/low, unit). `want` is the unit to show (the clock's own units, else the theme's).
 */
export function clockWeatherOf(slot: PluginSlot | undefined, want: 'C' | 'F'): ClockWx | null {
  if (!slot || !('custom' in slot) || slot.custom !== 'weather' || !slot.data || !isObj(slot.data.now)) return null
  const d = slot.data
  const now = d.now as { [k: string]: unknown }
  const temp = numOr(now.temp)
  if (temp === undefined) return null
  const src = typeof d.tempUnit === 'string' ? d.tempUnit : typeof d.unit === 'string' ? d.unit : d.units === 'imperial' ? 'f' : 'c'
  const from: 'C' | 'F' = String(src).toUpperCase().indexOf('F') >= 0 ? 'F' : 'C'
  const conv = (v: number | undefined) => (v === undefined ? undefined : Math.round(from === want ? v : from === 'C' ? (v * 9) / 5 + 32 : ((v - 32) * 5) / 9))
  const day0 = Array.isArray(d.daily) && isObj(d.daily[0]) ? (d.daily[0] as { [k: string]: unknown }) : {}
  const hi = numOr(now.high) !== undefined ? numOr(now.high) : numOr(day0.max) !== undefined ? numOr(day0.max) : numOr(day0.high)
  const lo = numOr(now.low) !== undefined ? numOr(now.low) : numOr(day0.min) !== undefined ? numOr(day0.min) : numOr(day0.low)
  const cond = typeof now.code === 'number' ? now.code : typeof now.condition === 'string' || typeof now.condition === 'number' ? now.condition : typeof now.icon === 'string' ? now.icon : 'cloudy'
  const out: ClockWx = { temp: conv(temp) as number, unit: want, cond: cond }
  if (hi !== undefined) out.high = conv(hi)
  if (lo !== undefined) out.low = conv(lo)
  if (typeof now.isDay === 'boolean') out.isDay = now.isDay
  return out
}

/** The manage preview's weather slot (demo data in the agent's shape). */
export const sampleWeatherSlot = (): PluginSlot => ({ custom: 'weather', data: sampleWeather() })
