/**
 * Pure maths for the system stat tiles (cpu, gpu, memory, network, load, uptime): which layout a tile size gets, type sizes
 * on the px ladder, chart scaling and where the points of a short history go, per-core bar grouping, memory parts, load per
 * core and the uptime text. No DOM here: stats-tile.tsx draws what these return. Safari 12: no ?. / ??.
 */

/** mini 1x1, strip one row high (2x1, 3x1, 9x1), block 2x2 / 2x3, wide 3x2 / 4x2 / 3x3 / 9x2, big 4x3 and larger */
export type StatSize = 'mini' | 'strip' | 'block' | 'wide' | 'big'

export function statSize(tw: number, th: number): StatSize {
  if (tw < 120 && th < 120) return 'mini'
  if (th < 110) return 'strip'
  if (tw < 200) return 'block'
  if (tw >= 280 && th >= 210) return 'big'
  return 'wide'
}

/** The deck's type ladder (px). Every text size of a stat tile is one of these. */
export const LADDER = [10, 11, 12, 13, 15, 17, 20, 24, 28, 34, 40, 48, 56, 64]

/** Largest ladder step that is at most `px` (never below the first step). */
export function onLadder(px: number): number {
  let out = LADDER[0]
  for (let i = 0; i < LADDER.length; i++) if (LADDER[i] <= px) out = LADDER[i]
  return out
}

/** Width of a value in em: digits ~0.6em (tabular, semibold), the unit at 0.42 of the size. */
export function valueEm(text: string, unit: string): number {
  return text.length * 0.6 + (unit ? 0.42 * (unit.length * 0.6 + 0.3) : 0)
}

/** Ladder size for a value that must fit `w` x `h` px, at most `max`. */
export function fitValue(text: string, unit: string, w: number, h: number, max: number): number {
  const byW = w / Math.max(0.6, valueEm(text, unit))
  return onLadder(Math.min(max, byW, h))
}

export interface StatBox {
  size: StatSize
  /** padding inside the tile (px), and the content box it leaves (the tile's 1px border taken off) */
  pad: number
  w: number
  h: number
  labelPx: number
  valuePx: number
  subPx: number
  /** px height of the label line (0 = hidden) */
  labelH: number
  /** show the sub line under the value */
  sub: boolean
  /** the extra panel right of the header (core bars, memory legend, load 1/5/15, network up): its width, 0 = none */
  sideW: number
  /** a full-width strip under the header (memory parts bar): its height, 0 = none */
  barH: number
  /** the history chart: height in px (0 = none) and whether it carries a grid with min/max */
  chartH: number
  grid: boolean
  /** top process rows (big tiles of cpu / memory) */
  rows: number
  rowH: number
  /** a one-line legend under the parts bar (memory on wide tiles): its height, 0 = none */
  legendH: number
  /** the sub text sits beside the value in the same row (strips) */
  subInline: boolean
}

export interface StatNeeds {
  label: boolean
  /** the value text and its unit, used to size the number */
  value: string
  unit: string
  /** the tile has a history chart at all (uptime and a missing GPU do not) */
  chart: boolean
  /** the kind has a side panel on wide tiles */
  side: boolean
  /** a full-width parts bar (memory) */
  bar: boolean
  /** top processes are possible (cpu, memory) */
  procs: boolean
  /** the label text (its width decides the room left for the value on a strip) */
  labelText?: string
  /** the longest sub text (a strip without a chart puts it beside or under the value when it fits whole) */
  subText?: string
}

const GAP = 6
const LABEL_H = 13
const SUB_H = 15
export const ROW_H = 18

/** Box per size: everything stays inside w x h, so nothing is clipped from 1x1 to 4x4 and 9x2. */
export function statBox(tw: number, th: number, n: StatNeeds): StatBox {
  const size = statSize(tw, th)
  const pad = size === 'mini' ? 8 : size === 'strip' ? 10 : size === 'block' ? 12 : 14
  const w = Math.max(10, tw - 2 - pad * 2)
  const h = Math.max(10, th - 2 - pad * 2)
  const labelPx = size === 'mini' ? 10 : 11
  const subPx = size === 'mini' || size === 'strip' ? 11 : 12
  const out: StatBox = { size, pad, w, h, labelPx, valuePx: 10, subPx, labelH: 0, sub: false, sideW: 0, barH: 0, chartH: 0, grid: false, rows: 0, rowH: ROW_H, legendH: 0, subInline: false }
  if (size === 'mini') {
    out.labelH = n.label ? LABEL_H : 0
    const meter = n.chart ? Math.max(3, Math.round(h * 0.08)) : 0
    out.chartH = meter
    const room = h - out.labelH - (meter ? meter + GAP : 0)
    out.valuePx = fitValue(n.value, n.unit, w, room * 0.8, 28)
    return out
  }
  if (size === 'strip') {
    // one header row (label left, value right), the chart fills the rest of the height across the full width
    const head = Math.min(24, Math.max(LABEL_H, Math.round(h * 0.45)))
    const labW = n.label ? Math.min(w * 0.5, labelW(n.labelText || '', 11)) : 0
    out.labelH = n.label ? LABEL_H : 0
    out.valuePx = fitValue(n.value, n.unit, w - labW - 6, head, 24)
    const rest = h - Math.max(out.valuePx, out.labelH) - 4
    out.chartH = n.chart && rest >= 14 ? rest : 0
    if (!out.chartH) {
      // no chart (uptime, no GPU data): the label on top, the value under it, and the sub text whole beside it or under it
      out.valuePx = fitValue(n.value, n.unit, w, h - out.labelH - 2, 34)
      const sw = n.subText ? textW(n.subText, out.subPx) : 0
      if (sw && valueEm(n.value, n.unit) * out.valuePx + 12 + sw <= w) {
        out.sub = true
        out.subInline = true
      } else if (sw && sw <= w && h - out.labelH - SUB_H - 4 >= 17) {
        out.sub = true
        out.valuePx = fitValue(n.value, n.unit, w, h - out.labelH - SUB_H - 4, 34)
      }
      return out
    }
    // with a chart, a long strip has room for the sub text in the header row
    out.sub = !!n.subText && w - labW - valueEm(n.value, n.unit) * out.valuePx - 20 >= textW(n.subText, out.subPx)
    out.subInline = out.sub
    return out
  }
  out.labelH = n.label ? LABEL_H : 0
  const big = size === 'big'
  const wide = size === 'wide' || big
  out.sideW = wide && n.side ? Math.min(Math.round(w * 0.42), 200) : 0
  const headW = w - (out.sideW ? out.sideW + 12 : 0)
  // the value takes a share of the height that leaves the chart room to read
  const valueMax = size === 'block' ? 40 : big ? 48 : 40
  const valueRoom = n.chart ? h * (size === 'block' ? 0.3 : big && n.procs ? 0.2 : 0.28) : h * 0.45
  out.valuePx = fitValue(n.value, n.unit, headW, valueRoom, valueMax)
  out.sub = h - out.labelH - out.valuePx >= SUB_H + GAP * 2 + (n.chart ? 24 : 0)
  const header = out.labelH + (out.labelH ? 4 : 0) + out.valuePx + (out.sub ? GAP + SUB_H : 0)
  out.barH = n.bar && wide ? 6 : 0
  out.legendH = out.barH ? SUB_H : 0
  let rest = h - header - (out.barH ? GAP + out.barH + 4 + out.legendH : 0)
  if (big && n.procs) {
    const minChart = 40
    out.rows = Math.max(0, Math.min(5, Math.floor((rest - GAP * 2 - minChart) / ROW_H)))
    if (out.rows < 2) out.rows = 0
    rest -= out.rows ? out.rows * ROW_H + GAP : 0
  }
  out.chartH = n.chart && rest - GAP >= 18 ? rest - GAP : 0
  out.grid = wide && out.chartH >= 30
  return out
}

// ---------- text widths (estimates, so a part is dropped or shortened before it would end in "...") ----------

/** Width of mixed text at `px`: ~0.56 em a character (digits, lower case, spaces). */
export function textW(text: string, px: number): number {
  return text.length * 0.56 * px
}
/** Width of an upper case caption with 0.08 em letter spacing. */
export function labelW(text: string, px: number): number {
  return text.length * 0.72 * px
}
/** The first candidate that fits `avail` px whole, or '' (nothing rather than an ellipsis). */
export function pickFit(cands: string[], avail: number, px: number, width?: (t: string, px: number) => number): string {
  const f = width || textW
  for (let i = 0; i < cands.length; i++) if (cands[i] && f(cands[i], px) <= avail) return cands[i]
  return ''
}

// ---------- charts ----------

/** A short history never draws as a stub at the left: at least this many slots, newest point on the right edge. */
export const MIN_SLOTS = 12

export interface XY {
  x: number
  y: number
}

/**
 * Points of the last `slots` values in a w x h box. The newest value sits at the right (inset by `inset` so an end dot is
 * never clipped) and older ones step left by a fixed slot width; a history shorter than MIN_SLOTS keeps MIN_SLOTS slots so
 * it grows leftwards instead of stretching. y runs from `inset` (hi) to h - inset (lo); values outside [lo, hi] are clamped.
 */
export function placePoints(values: number[], w: number, h: number, lo: number, hi: number, slots: number, inset: number): XY[] {
  const vals = values.slice(-Math.max(2, slots))
  const n = vals.length
  if (!n) return []
  const s = Math.max(2, Math.min(Math.max(slots, 2), Math.max(n, MIN_SLOTS)))
  const step = (w - inset * 2) / (s - 1)
  const span = hi > lo ? hi - lo : 1
  const out: XY[] = []
  for (let i = 0; i < n; i++) {
    const v = Math.min(hi, Math.max(lo, vals[i]))
    out.push({ x: r2(w - inset - (n - 1 - i) * step), y: r2(h - inset - ((v - lo) / span) * (h - inset * 2)) })
  }
  return out
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** 1, 2, 2.5, 5 x 10^k at or above v (v > 0). */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1
  const p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10))
  const m = v / p
  const k = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10
  return r2(k * p) || k * p
}

/**
 * Chart scale per kind. Percent kinds: 0 to a nice top of at least 25 and at most 100, so a quiet CPU is not a flat line
 * on the floor yet 100 means 100. Network: 0 to a nice top above the peak (at least 1 KB/s). Load: 0 to the larger of the
 * peak and the core count (a load that fits the cores stays under the top line).
 */
export function chartDomain(kind: string, values: number[], ncpu?: number): [number, number] {
  let mx = 0
  for (let i = 0; i < values.length; i++) if (values[i] > mx) mx = values[i]
  if (kind === 'cpu' || kind === 'gpu' || kind === 'memory') return [0, Math.min(100, Math.max(25, niceCeil(mx * 1.1)))]
  if (kind === 'network') return [0, niceCeil(Math.max(1024, mx * 1.15))]
  if (kind === 'load') return [0, niceCeil(Math.max(ncpu || 1, mx * 1.1))]
  return [0, niceCeil(Math.max(1, mx * 1.1))]
}

/** Right-hand axis gutter for small value labels (10 px), so they never sit on the plot. */
export function axisGutter(labels: string[]): number {
  let w = 0
  for (let i = 0; i < labels.length; i++) w = Math.max(w, textW(labels[i], 10))
  return w ? Math.ceil(w) + 6 : 0
}

/**
 * Tops (px) of the peak and low labels in the gutter, at the height of their values, 12 px lines that never overlap and
 * never leave the chart; null for the low label when peak and low are the same text.
 */
export function axisTops(yPeak: number, yLow: number, h: number, same: boolean): { peak: number; low: number | null } {
  const L = 12
  const clamp = (v: number) => Math.max(0, Math.min(h - L, v))
  let p = clamp(yPeak - L / 2)
  if (same) return { peak: p, low: null }
  let l = clamp(yLow - L / 2)
  if (l - p < L) {
    const mid = (p + l) / 2
    p = clamp(mid - L / 2 - 0.5)
    l = clamp(p + L)
    if (l - p < L) p = Math.max(0, l - L)
  }
  return { peak: Math.round(p), low: Math.round(l) }
}

/** Min and max of the shown window (for the small labels on a grid chart), or null without data. */
export function minMax(values: number[]): { min: number; max: number } | null {
  if (!values.length) return null
  let mn = values[0]
  let mx = values[0]
  for (let i = 1; i < values.length; i++) {
    if (values[i] < mn) mn = values[i]
    if (values[i] > mx) mx = values[i]
  }
  return { min: mn, max: mx }
}

// ---------- cpu cores ----------

/** Cores averaged into at most `maxBars` groups (a 64-core box still fits a 3x2 tile), each 0-100. */
export function coreGroups(cores: number[], maxBars: number): number[] {
  const n = cores.length
  const m = Math.max(1, Math.floor(maxBars))
  if (n <= m) return cores.map(clampPct)
  const per = Math.ceil(n / m)
  const out: number[] = []
  for (let i = 0; i < n; i += per) {
    let sum = 0
    let c = 0
    for (let j = i; j < Math.min(n, i + per); j++) {
      sum += cores[j]
      c++
    }
    out.push(clampPct(sum / c))
  }
  return out
}
const clampPct = (v: number) => Math.min(100, Math.max(0, Number(v) || 0))

/** Bar width and gap for `count` bars in `w` px: bars 3-12 px, gap 2 px (3 px for fewer than 9 bars); how many bars fit. */
export function barFit(count: number, w: number): { bar: number; gap: number; max: number } {
  const gap = count < 9 ? 3 : 2
  const max = Math.max(1, Math.floor((w + gap) / (3 + gap)))
  const n = Math.min(count, max)
  const bar = Math.max(3, Math.min(12, Math.floor((w - gap * (n - 1)) / Math.max(1, n))))
  return { bar, gap, max }
}

// ---------- top processes ----------

/** A process's share of the whole machine in percent (0-100): `used` out of `total` (cores busy / core count, bytes / RAM). */
export function procShare(used: number, total: number): number {
  if (!(total > 0)) return 0
  return Math.min(100, Math.max(0, (used / total) * 100))
}
/** "25%", "0.4%" under 1, "<0.1%" for a sliver, so a busy list never reads as all zeros. */
export function shareText(pct: number): string {
  if (pct >= 1) return Math.round(pct) + '%'
  if (pct >= 0.1) return pct.toFixed(1) + '%'
  return pct > 0 ? '<0.1%' : '0%'
}

// ---------- memory ----------

/** used / cached / free as fractions of total (sum 1); cached comes out of the free part, never out of used. */
export function memParts(used: number, total: number, cached?: number): { used: number; cached: number; free: number } {
  if (!(total > 0)) return { used: 0, cached: 0, free: 1 }
  const u = Math.min(1, Math.max(0, used / total))
  const c = Math.min(1 - u, Math.max(0, (cached || 0) / total))
  return { used: u, cached: c, free: Math.max(0, 1 - u - c) }
}

const GB = 1024 * 1024 * 1024
/** "12.2" GB with one decimal under 100 GB, whole numbers above. */
export const gbText = (b: number) => {
  const g = Math.max(0, b) / GB
  return g >= 100 ? String(Math.round(g)) : g.toFixed(1)
}

// ---------- load ----------

/** Load per core (what makes the number mean something), or null when the core count is unknown (older agents). */
export function loadPerCore(load: number, ncpu?: number): number | null {
  if (!ncpu || ncpu < 1) return null
  return Math.max(0, load) / ncpu
}

/** Per-core load -> state: under 0.7 fine, under 1 busy, else over the cores. */
export function loadBand(perCore: number): 'good' | 'watch' | 'risk' {
  return perCore < 0.7 ? 'good' : perCore < 1 ? 'watch' : 'risk'
}

/** Two decimals under 10, one above (load 65.11 per 10 cores -> "6.5"). */
export function loadText(v: number): string {
  return v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : String(Math.round(v))
}

// ---------- uptime ----------

/** "5d 12h" / "3h 4m" / "12m"; compact "5d" / "3h" / "12m". */
export function uptimeText(sec: number, compact: boolean): string {
  const s = Math.max(0, Math.floor(sec))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (compact) return d > 0 ? d + 'd' : h > 0 ? h + 'h' : m + 'm'
  return d > 0 ? d + 'd ' + h + 'h' : h > 0 ? h + 'h ' + m + 'm' : m + 'm'
}

/** Boot time in ms: the sample time minus the uptime, rounded to the minute so the text does not flicker. */
export function bootAt(sampleMs: number, uptimeSec: number): number {
  return Math.round((sampleMs - Math.max(0, uptimeSec) * 1000) / 60000) * 60000
}
