/**
 * Pure maths of the weather tile (web/deck/src/weather-tile.tsx): reading the agent's answer (and the older deck shape), the face for a
 * tile size, the sky for a condition and hour, the AQI band, and the chart geometry of the big face. No DOM, no Preact: tested from
 * test/weather-layout.test.ts.
 */

export type WxCond = 'clear' | 'night' | 'partly' | 'cloudy' | 'rain' | 'pour' | 'storm' | 'snow' | 'fog' | 'wind' | 'hail'

export interface WxHour {
  ms: number
  temp: number
  cond: string | number
}
export interface WxDay {
  ms: number
  high: number
  low: number
  cond: string | number
  /** precipitation, mm */
  rain?: number
  /** chance of precipitation, % */
  pop?: number
  uv?: number
}
/** One shape for the tile, whatever the data came as. Temperatures are in `unit` (missing = unknown, the tile decides). */
export interface WxView {
  temp: number
  feels?: number
  humidity?: number
  wind?: number
  /** degrees the wind comes from (0 = north) */
  windDir?: number
  windUnit?: string
  aqi?: number
  /** the source's day flag; missing = guess from the hour */
  isDay?: boolean
  /** what the glyph is picked from: the WMO code when there is one, else the condition word */
  cond: string | number
  /** a condition text the source wants shown as is (older deck shape) */
  text?: string
  high?: number
  low?: number
  hourly: WxHour[]
  daily: WxDay[]
  unit?: 'C' | 'F'
  units?: 'metric' | 'imperial'
  place: string
  source: string
  updatedAt?: number
}

const isObj = (v: unknown): v is { [k: string]: unknown } => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined)

/**
 * A time as the agent writes it ("2026-11-17", "2026-11-17T10:00", epoch s or ms) to epoch ms, read as LOCAL time. Safari 12 reads an
 * ISO text without an offset as UTC (and a bare date as UTC midnight everywhere), so the fields are taken apart by hand.
 */
export function wxTimeOf(v: unknown, fallback: number): number {
  if (typeof v === 'number' && isFinite(v)) return v < 1e12 ? v * 1000 : v
  if (typeof v !== 'string') return fallback
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d))?/.exec(v)
  if (m && !/[zZ]|[+-]\d\d:?\d\d$/.test(v.slice(10))) return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0).getTime()
  const t = Date.parse(v)
  return isFinite(t) ? t : fallback
}

const condField = (o: { [k: string]: unknown }): string | number => {
  if (typeof o.code === 'number') return o.code
  if (typeof o.condition === 'string' || typeof o.condition === 'number') return o.condition
  if (typeof o.icon === 'string') return o.icon
  return 'cloudy'
}

/**
 * The agent's weather answer (src/weather.ts WeatherData: now.code, hourly[].time, daily[].date/min/max, tempUnit 'c'|'f') or the older
 * deck shape (hourly[].t, daily[].t/high/low, unit) as one view. Null when there is no current temperature.
 */
export function normWeather(d: unknown, now: number): WxView | null {
  if (!isObj(d) || !isObj(d.now)) return null
  const n = d.now
  const temp = num(n.temp)
  if (temp === undefined) return null
  const hourly: WxHour[] = []
  if (Array.isArray(d.hourly)) {
    for (let i = 0; i < d.hourly.length; i++) {
      const h = d.hourly[i]
      if (!isObj(h) || num(h.temp) === undefined) continue
      hourly.push({ ms: wxTimeOf(h.time !== undefined ? h.time : h.t, now + (i + 1) * 3600000), temp: h.temp as number, cond: condField(h) })
    }
  }
  const daily: WxDay[] = []
  if (Array.isArray(d.daily)) {
    for (let i = 0; i < d.daily.length; i++) {
      const x = d.daily[i]
      if (!isObj(x)) continue
      const high = num(x.max) !== undefined ? num(x.max) : num(x.high)
      const low = num(x.min) !== undefined ? num(x.min) : num(x.low)
      if (high === undefined || low === undefined) continue
      const day: WxDay = { ms: wxTimeOf(x.date !== undefined ? x.date : x.t, now + i * 86400000), high: high, low: low, cond: condField(x) }
      if (num(x.rain) !== undefined) day.rain = x.rain as number
      if (num(x.pop) !== undefined) day.pop = x.pop as number
      if (num(x.uv) !== undefined) day.uv = x.uv as number
      daily.push(day)
    }
  }
  const src = typeof d.tempUnit === 'string' ? d.tempUnit : typeof d.unit === 'string' ? d.unit : ''
  const v: WxView = {
    temp: temp,
    cond: condField(n),
    hourly: hourly,
    daily: daily,
    place: typeof d.location === 'string' ? d.location : '',
    source: typeof d.source === 'string' ? d.source : '',
  }
  if (src) v.unit = src.toUpperCase().indexOf('F') >= 0 ? 'F' : 'C'
  if (d.units === 'metric' || d.units === 'imperial') v.units = d.units
  if (typeof n.text === 'string' && n.text) v.text = n.text
  const opt: [keyof WxView, unknown][] = [['feels', n.feels], ['humidity', n.humidity], ['wind', n.wind], ['windDir', n.windDir], ['aqi', n.aqi]]
  for (let i = 0; i < opt.length; i++) if (num(opt[i][1]) !== undefined) (v as any)[opt[i][0]] = opt[i][1]
  if (typeof n.windUnit === 'string' && n.windUnit) v.windUnit = n.windUnit
  if (typeof n.isDay === 'boolean') v.isDay = n.isDay
  const hi = num(n.high) !== undefined ? num(n.high) : daily[0] ? daily[0].high : undefined
  const lo = num(n.low) !== undefined ? num(n.low) : daily[0] ? daily[0].low : undefined
  if (hi !== undefined) v.high = hi
  if (lo !== undefined) v.low = lo
  const up = d.updatedAt !== undefined ? wxTimeOf(d.updatedAt, NaN) : NaN
  if (isFinite(up)) v.updatedAt = up
  return v
}

/** The wind unit to print: the source's own, else from the units the agent asked Open-Meteo for. */
export const windUnitOf = (v: { windUnit?: string; units?: string }): string => v.windUnit || (v.units === 'imperial' ? 'mph' : 'km/h')

/** Degrees the arrow turns: it points where the wind blows TO (a north wind, 0°, points down). */
export const windArrowDeg = (from: number): number => (((Math.round(from) + 180) % 360) + 360) % 360

// ---- faces ----

export type WxMode = 'tiny' | 'row' | 'card' | 'wide' | 'hero' | 'full' | 'tall'
export interface WxFace {
  mode: WxMode
  /** wide / hero: the forecast column on the right; full: the forecast columns under the header */
  forecast: boolean
  /** what the forecast part shows */
  series: 'hourly' | 'daily'
}

/**
 * The face for a tile: by grid span first (cw x ch cells), pixels only for very small tiles, then the `show` option.
 *   tiny 1x1 | row 2x1 | card 2x2 | wide 3x1, 4x1 | hero 3x2, 4x2 | full 3x3 and bigger | tall 1xN, 2x3 and taller
 */
export function wxFace(cw: number, ch: number, tw: number, th: number, show: string | undefined, hasHourly: boolean, hasDaily: boolean): WxFace {
  let mode: WxMode = 'card'
  if (ch <= 1) mode = cw <= 1 ? 'tiny' : cw === 2 ? 'row' : 'wide'
  else if (cw <= 1) mode = 'tall'
  else if (cw === 2) mode = ch >= 3 ? 'tall' : 'card'
  else mode = ch >= 3 ? 'full' : 'hero'
  if (tw < 100 || th < 70) mode = 'tiny'
  const s = show || 'auto'
  if (s === 'hourly' && mode === 'tall') mode = 'card'
  if (s === 'now') {
    if (mode === 'wide') mode = 'row'
    if (mode === 'tall') mode = 'card'
  }
  // auto: the next hours on a one-row strip, the next days where there is room for them
  let series: 'hourly' | 'daily' = s === 'hourly' ? 'hourly' : s === 'daily' ? 'daily' : mode === 'wide' ? 'hourly' : 'daily'
  if (series === 'daily' && !hasDaily && hasHourly) series = 'hourly'
  if (series === 'hourly' && !hasHourly && hasDaily) series = 'daily'
  const forecast = s !== 'now' && (mode === 'wide' || mode === 'hero' || mode === 'full') && (hasHourly || hasDaily)
  return { mode: mode, forecast: forecast, series: series }
}

/** How many columns of at least `minCol` px fit in `width`, between `lo` and the number of items. */
export function fitCount(width: number, minCol: number, items: number, lo: number, hi: number): number {
  const n = Math.floor(width / Math.max(1, minCol))
  return Math.max(Math.min(lo, items), Math.min(hi, items, n))
}

// ---- sky ----

export type SkyKind = 'day' | 'night' | 'cloud' | 'cloudn' | 'rain' | 'rainn' | 'storm' | 'snow' | 'snown'
export interface Sky {
  kind: SkyKind
  /** light arcs from the top right corner: 0 none, 1 faint, 2 full */
  arcs: 0 | 1 | 2
  /** moon disc: 0 none, 1 dim (behind cloud), 2 full */
  moon: 0 | 1 | 2
  stars: boolean
}

/** The sky behind the tile for a condition key (condOf) and whether it is night. */
export function skyOf(c: WxCond, night: boolean): Sky {
  if (c === 'storm') return { kind: 'storm', arcs: 0, moon: 0, stars: false }
  if (c === 'rain' || c === 'pour' || c === 'hail') return { kind: night ? 'rainn' : 'rain', arcs: 0, moon: 0, stars: false }
  if (c === 'snow') return { kind: night ? 'snown' : 'snow', arcs: 0, moon: 0, stars: false }
  if (c === 'clear' || c === 'night') return night ? { kind: 'night', arcs: 0, moon: 2, stars: true } : { kind: 'day', arcs: 2, moon: 0, stars: false }
  if (c === 'partly') return night ? { kind: 'cloudn', arcs: 0, moon: 1, stars: true } : { kind: 'day', arcs: 1, moon: 0, stars: false }
  return { kind: night ? 'cloudn' : 'cloud', arcs: 0, moon: 0, stars: false }
}

/** Night by the source's day flag when there is one, else 19:00 to 06:00. */
export const isNight = (isDay: boolean | undefined, ms: number): boolean => {
  if (isDay !== undefined) return !isDay
  const h = new Date(ms).getHours()
  return h >= 19 || h < 6
}

// ---- air quality ----

export interface AqiBand {
  /** English text, through t() */
  label: string
  bg: string
  ink: string
}
const AQI: [number, string, string, string][] = [
  [50, 'Good', '#4ade80', '#052e16'],
  [100, 'Moderate', '#facc15', '#2a2000'],
  [150, 'Sensitive', '#fb923c', '#2c1200'],
  [200, 'Unhealthy', '#ef4444', '#ffffff'],
  [300, 'Very unhealthy', '#a855f7', '#ffffff'],
  [Infinity, 'Hazardous', '#9f1239', '#ffffff'],
]
/** US AQI band: Good 0-50, Moderate 51-100, Unhealthy for sensitive groups 101-150 ("Sensitive"), Unhealthy, Very unhealthy, Hazardous. */
export function aqiBand(n: number): AqiBand {
  const v = Math.max(0, Math.round(n))
  for (let i = 0; i < AQI.length; i++) if (v <= AQI[i][0]) return { label: AQI[i][1], bg: AQI[i][2], ink: AQI[i][3] }
  return { label: 'Hazardous', bg: '#9f1239', ink: '#ffffff' }
}

// ---- chart of the big face ----

export interface Pt {
  x: number
  y: number
}

/** The min and max of a set of values, widened so the span is at least `minSpan`. */
export function rangeOf(values: number[], minSpan: number): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < values.length; i++) {
    if (values[i] < lo) lo = values[i]
    if (values[i] > hi) hi = values[i]
  }
  if (!isFinite(lo)) return [0, minSpan]
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2
    lo = mid - minSpan / 2
    hi = mid + minSpan / 2
  }
  return [lo, hi]
}

/**
 * Points of a line through `values`, one per column of `colW` px (x at the column centre), with `lo..hi` mapped onto `top..bottom`
 * (hi at the top). Rounded to 0.1 px.
 */
export function linePoints(values: number[], colW: number, top: number, bottom: number, lo: number, hi: number): Pt[] {
  const span = hi - lo || 1
  const r = (n: number) => Math.round(n * 10) / 10
  return values.map((v, i) => ({ x: r(colW * (i + 0.5)), y: r(bottom - ((v - lo) / span) * (bottom - top)) }))
}

/** An SVG polyline `points` attribute. */
export const pointsAttr = (pts: Pt[]): string => pts.map((p) => p.x + ',' + p.y).join(' ')

/** True when any day has rain worth a bar (0.1 mm or more). */
export const hasRain = (days: { rain?: number }[]): boolean => days.some((d) => typeof d.rain === 'number' && d.rain >= 0.1)

/** Bar heights in px for the days' rain: `maxH` is the tallest bar, scaled to at least 5 mm so a drizzle stays short; under 0.1 mm is 0. */
export function rainBars(days: { rain?: number }[], maxH: number): number[] {
  let max = 5
  days.forEach((d) => {
    if (typeof d.rain === 'number' && d.rain > max) max = d.rain
  })
  return days.map((d) => (typeof d.rain === 'number' && d.rain >= 0.1 ? Math.max(2, Math.round((d.rain / max) * maxH)) : 0))
}

/** Rain text under a bar: one decimal under 10 mm, whole mm above, empty when there is none. */
export const rainText = (mm: number | undefined): string => (typeof mm !== 'number' || mm < 0.1 ? '' : mm < 10 ? (Math.round(mm * 10) / 10).toFixed(1) : String(Math.round(mm)))

/**
 * The vertical budget of the big face's forecast part, top to bottom: day name, glyph, the chart (with room for the value labels above
 * the highs and below the lows) and, when any day has rain, the bars and their text. `h` is the height left under the header.
 */
export function chartBox(h: number, rain: boolean): { name: number; glyph: number; chart: number; bars: number; barText: number } {
  const name = 16
  const glyph = h >= 220 ? 28 : 22
  const barText = rain ? 14 : 0
  const rest = Math.max(40, h - name - glyph - 8 - barText)
  const bars = rain ? Math.max(10, Math.min(36, Math.round(rest * 0.22))) : 0
  return { name: name, glyph: glyph, chart: rest - bars, bars: bars, barText: barText }
}

// ---- fitting text without an ellipsis on numbers ----

/** A rough width of `s` at `px` (system sans, Roboto on Android, is about 0.58 em a character; CJK counts double). */
export function textW(s: string, px: number): number {
  let n = 0
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i) > 0x2e80 ? 1.7 : s[i] === ' ' ? 0.5 : 1
  return n * px * 0.58
}

/** Width of the big temperature: its digits plus the raised degree sign. */
export const tempW = (value: number, px: number): number => (String(Math.round(value)).length * 0.56 + 0.32) * px

/** The high / low text that fits `room` px: the full one, else the short "25/33°", else nothing (never a cut number). */
export function hlFit(room: number, full: string, short: string, px: number): string {
  if (full && textW(full, px) <= room) return full
  if (short && textW(short, px) <= room) return short
  return ''
}

/**
 * The place pill in `max` px: 12 px on one line when it fits, else one step smaller (11 px), else two lines at 11 px (the second
 * one ellipsed only when even that is too long). `chrome` is the pin, its gap and the padding (6 + 12 + 4 + 9).
 */
export const PILL_CHROME = 31
export function pillFit(place: string, max: number): { px: number; lines: 1 | 2; h: number } {
  if (textW(place, 12) + PILL_CHROME <= max) return { px: 12, lines: 1, h: 22 }
  if (textW(place, 11) + PILL_CHROME <= max) return { px: 11, lines: 1, h: 22 }
  return { px: 11, lines: 2, h: 34 }
}

/**
 * The hero's big number when the place pill takes two lines: the temperature column (number, H/L 20, the wind / AQI rows `extra`)
 * must fit under the pill and a 4 px gap, so the number shrinks until it does (never under 28 px). With a one-line pill it is `ts`.
 */
export function heroTempFit(ts: number, H: number, top: number, extra: number, twoLines: boolean): number {
  if (!twoLines) return ts
  const room = H - top - 4 - 20 - extra
  return Math.max(28, Math.min(ts, Math.floor(room)))
}

/**
 * The 1x1-wide upright face (a 1x2 tile, `tiny` mode taller than wide): glyph and temperature sized from the width, then the condition
 * and the high / low stacked under them when the height has room (each line about 17 px). On a square tile it is glyph + temperature.
 */
export function tinyStack(W: number, H: number, temp: number): { gl: number; ts: number; cond: boolean; hl: boolean } {
  const m = Math.min(W, H)
  if (H < W * 1.4) {
    return { gl: Math.round(Math.max(20, Math.min(m * 0.36, 56))), ts: Math.round(Math.max(20, Math.min(m * 0.34, W * 0.42))), cond: false, hl: false }
  }
  const gl = Math.round(Math.max(20, Math.min(W * 0.6, 48)))
  let ts = Math.round(Math.max(20, Math.min(W * 0.5, 44)))
  while (ts > 20 && tempW(temp, ts) > W) ts--
  const used = gl + 6 + ts
  const cond = H - used >= 6 + 17
  const hl = cond && H - used >= 6 + 17 + 16
  return { gl: gl, ts: ts, cond: cond, hl: hl }
}

/**
 * How many detail rows (0 to `max`) the big face keeps so the forecast chart still gets `minChart` px; detail rows go before the chart.
 * `room` is the height under the header (and over the footer); each row is `rowH`, the block adds `pad` once.
 */
export function detailRows(room: number, max: number, rowH: number, pad: number, minChart: number): number {
  for (let r = max; r > 0; r--) if (room - r * rowH - pad >= minChart) return r
  return 0
}

/** Whole day rows that fit `avail` px at `rh` each (never a row cut by the edge), and their height when they may grow to `maxH`. */
export function tallRows(avail: number, rh: number, items: number, maxH: number): { rows: number; rowH: number } {
  const rows = Math.max(0, Math.min(items, Math.floor(avail / rh)))
  return { rows: rows, rowH: rows ? Math.max(rh, Math.min(maxH, Math.floor(avail / rows))) : rh }
}

/** A forecast slot in `h` px: label (16) + glyph + value (16). The label goes when a glyph of 16 px would not fit with it. */
export function slotFit(h: number, maxGlyph: number): { label: boolean; glyph: number } {
  const withLabel = Math.min(maxGlyph, h - 36)
  if (withLabel >= 16) return { label: true, glyph: Math.round(withLabel) }
  return { label: false, glyph: Math.round(Math.max(12, Math.min(maxGlyph, h - 20))) }
}
