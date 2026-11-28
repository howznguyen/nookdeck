/**
 * Pure layout maths of the card's `ticker` rows and the chart they share with `sparkline` (card-ticker.tsx draws them).
 * Safari 12: no ?. or ??.
 */

/** Which way a chart went: its last point against its first. */
export type Trend = 'up' | 'down' | 'flat'

export function trendOf(points: number[] | undefined): Trend {
  if (!points || points.length < 2) return 'flat'
  const a = points[0]
  const b = points[points.length - 1]
  // under a hundredth of a percent of the first value reads as flat
  const eps = Math.abs(a) * 0.0001
  return b - a > eps ? 'up' : a - b > eps ? 'down' : 'flat'
}

/** A chart's geometry in a 100 x 30 box, the line kept 3 units from the top and bottom: the polyline, the last point, and the first value's height. */
export interface SparkGeom { line: string; area: string; endY: number; baseY: number }

export function sparkGeom(points: number[]): SparkGeom | null {
  if (points.length < 2) return null
  let lo = points[0]
  let hi = points[0]
  for (let i = 1; i < points.length; i++) { if (points[i] < lo) lo = points[i]; if (points[i] > hi) hi = points[i] }
  if (hi === lo) { lo -= 1; hi += 1 }
  const y = (v: number) => 27 - ((v - lo) / (hi - lo)) * 24
  const out: string[] = []
  for (let i = 0; i < points.length; i++) out.push(((i / (points.length - 1)) * 100).toFixed(2) + ',' + y(points[i]).toFixed(2))
  const line = out.join(' ')
  return { line: line, area: '0,30 ' + line + ' 100,30', endY: y(points[points.length - 1]), baseY: y(points[0]) }
}

/** What a ticker row shows at its width and the height it may take, both in em of the card's font. */
export interface TickerParts {
  /** the name under the symbol, beside it, or left out */
  name: 'under' | 'side' | 'none'
  chart: boolean
  /** the change chip */
  change: boolean
}

/**
 * em a row needs for: the symbol, the price, the chip, the least chart, a name beside the symbol, the gaps. On the small side
 * on purpose: a part shown here that does not fit makes the card's font step down (card.tsx), a part left out here never comes back.
 */
const SYM = 2.6
const PRICE = 4
const CHIP = 3.4
/** below this the chip goes: a row keeps its change as long as the font can step down for it */
const CHIP_MIN_ROW = 8.5
const CHART = 4
const SIDE_NAME = 4.5
const GAP = 0.6

/**
 * As the row gets narrower a name beside the symbol goes first, then the chart, then the chip: a watchlist row always keeps
 * its symbol and price. A name under the symbol needs a row about 2.9 lines high (a row with one is about 2.8).
 */
export function tickerParts(wEm: number, hEm: number, has: { name: boolean; chart: boolean; change: boolean }): TickerParts {
  const change = has.change && wEm >= CHIP_MIN_ROW
  const base = SYM + PRICE + (change ? CHIP + GAP : 0) + GAP
  const chart = has.chart && wEm >= base + CHART + GAP
  let name: TickerParts['name'] = 'none'
  if (has.name) {
    if (hEm >= 2.9) name = 'under'
    else if (wEm >= base + (chart ? CHART + GAP : 0) + SIDE_NAME + GAP) name = 'side'
  }
  return { name: name, chart: chart, change: change }
}

/** The parts every ticker of one card shows: the least any row allows, so the columns line up. */
export function commonParts(list: TickerParts[]): TickerParts | null {
  if (!list.length) return null
  const rank = { under: 2, side: 1, none: 0 }
  let out: TickerParts = { name: list[0].name, chart: list[0].chart, change: list[0].change }
  for (let i = 1; i < list.length; i++) {
    const p = list[i]
    out = { name: rank[p.name] < rank[out.name] ? p.name : out.name, chart: out.chart && p.chart, change: out.change && p.change }
  }
  return out
}

/**
 * The height (em) each ticker row of a column may take: the column's height less its other parts, shared by its rows. A row
 * is never given less than one line and a little air.
 */
export function rowRoomEm(colPx: number, otherPx: number, rows: number, fontPx: number): number {
  if (rows < 1 || fontPx <= 0) return 0
  return Math.max(1.4, (colPx - otherPx) / rows / fontPx)
}
