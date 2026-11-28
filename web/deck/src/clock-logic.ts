/**
 * Pure helpers for the newer clock styles (clocks.tsx): lunar text, 7-segment digits, ring progress, bloc calendar sizing.
 * No Preact here so the tests can import it. Safari 12: no ?. / ??.
 */
import { lunarInfo, lunarMonthName, solarHoliday, type LunarInfo, type LunarLang } from './lunar'

/** The lunar language for a deck language: Chinese for zh, Vietnamese for everything else. */
export const lunarLangOf = (lang: string): LunarLang => (lang === 'zh' ? 'zh' : 'vi')

const ZH_DIGIT = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
/** 1 -> 初一, 10 -> 初十, 15 -> 十五, 20 -> 二十, 21 -> 廿一, 30 -> 三十 */
export function lunarDayZh(d: number): string {
  if (d < 1 || d > 30) return ''
  if (d <= 10) return '初' + ZH_DIGIT[d]
  if (d < 20) return '十' + ZH_DIGIT[d - 10]
  if (d === 20) return '二十'
  if (d < 30) return '廿' + ZH_DIGIT[d - 20]
  return '三十'
}

export interface LunarDay extends LunarInfo {
  /** "9 tháng Mười Bính Ngọ" / "丙午年十月初九" */
  line: string
  /** "Ngày Giáp Tý · Tháng Kỷ Hợi" / "甲子日 · 己亥月" */
  canChi: string
  /** the big lunar number on the bloc page: "9" / "初九" */
  dayText: string
  /** "Tháng Mười" / "十月" (with nhuận / 闰 for a leap month) */
  monthText: string
}

/**
 * Lunar facts for a wall-clock calendar day (y, mo 1-12, d), in the lunar language. Built from noon of that day so the result
 * does not depend on the phone's own zone when the clock follows another one. The holiday is the lunar one first, else the solar one.
 */
export function lunarDay(y: number, mo: number, d: number, lang: LunarLang): LunarDay {
  const info = lunarInfo(new Date(y, mo - 1, d, 12, 0, 0), lang)
  const l = info.lunar
  const mName = lunarMonthName(l.month, l.leap, lang)
  const holiday = info.holiday || solarHoliday(d, mo, lang)
  if (lang === 'zh') {
    return {
      lunar: info.lunar, yearName: info.yearName, monthName: info.monthName, dayName: info.dayName, term: info.term, luckyHours: info.luckyHours, holiday: holiday,
      line: info.yearName + '年' + mName + lunarDayZh(l.day),
      canChi: info.dayName + '日 · ' + info.monthName + '月',
      dayText: lunarDayZh(l.day),
      monthText: mName,
    }
  }
  return {
    lunar: info.lunar, yearName: info.yearName, monthName: info.monthName, dayName: info.dayName, term: info.term, luckyHours: info.luckyHours, holiday: holiday,
    line: l.day + ' tháng ' + mName + ' ' + info.yearName,
    canChi: 'Ngày ' + info.dayName + ' · Tháng ' + info.monthName,
    dayText: String(l.day),
    monthText: 'Tháng ' + mName,
  }
}

/**
 * Segments a..g of a 7-segment digit (a top, b top right, c bottom right, d bottom, e bottom left, f top left, g middle),
 * '1' = lit. Anything that is not 0-9 is blank.
 */
const SEG: { [k: string]: string } = {
  '0': '1111110',
  '1': '0110000',
  '2': '1101101',
  '3': '1111001',
  '4': '0110011',
  '5': '1011011',
  '6': '1011111',
  '7': '1110000',
  '8': '1111111',
  '9': '1111011',
}
export function segmentsOf(ch: string): boolean[] {
  const m = SEG[ch] || '0000000'
  const out: boolean[] = []
  for (let i = 0; i < 7; i++) out.push(m.charAt(i) === '1')
  return out
}

/**
 * Whether the ring fills with the seconds: yes unless the clock's `seconds` option is explicitly false. Not the tile's size-based
 * seconds default (that only decides whether a seconds NUMBER is printed; a small ring tile still sweeps with the seconds).
 */
/** The caption every clock face shows: only a label the user set (clock.label), never the item's default name. '' when none. */
export const clockCaption = (o: { label?: string } | undefined | null): string => (o && o.label ? o.label.trim() : '')

/**
 * The bloc's three can chi lines. Chinese puts the 年/月/日 suffix after the name; every other language prefixes the translated
 * word (en "Year Bính Ngọ", vi "Năm Bính Ngọ"). The can chi names themselves stay Vietnamese.
 */
export function blocCanChi(year: string, month: string, day: string, lang: string, tr: (en: string) => string): string[] {
  if (lang === 'zh') return [year + '年', month + '月', day + '日']
  return [tr('Year') + ' ' + year, tr('Month') + ' ' + month, tr('Day') + ' ' + day]
}

export const ringUsesSeconds = (secondsOpt: boolean | undefined): boolean => secondsOpt !== false

/** Ring fill 0..1: seconds of the minute, or minutes of the hour when seconds are off. Day ring: the share of the day gone. */
export function ringProgress(h: number, m: number, s: number, secs: boolean): { outer: number; day: number } {
  return { outer: secs ? s / 60 : (m + s / 60) / 60, day: (h * 3600 + m * 60 + s) / 86400 }
}

export type BlocMode = 'strip' | 'page' | 'tall'
/** 2x1 and other short tiles: day number + lunar day only. Upright tiles with room add the lucky hours list. */
export function blocMode(tw: number, th: number): BlocMode {
  if (th < 130 || tw < 90) return 'strip'
  if (th >= 380 && th >= tw * 1.4) return 'tall'
  return 'page'
}

/**
 * The AM/PM label of an hour, in the deck language (`tr` is the deck's t(): AM/PM, SA/CH, 上午/下午), and whether it goes before
 * the time (Chinese writes 上午 10:42) or after it (10:42 AM). Every clock style takes its label from here.
 */
export function meridiem(h: number, lang: string, tr: (en: string) => string): { text: string; before: boolean } {
  return { text: tr(h % 24 < 12 ? 'AM' : 'PM'), before: lang === 'zh' }
}

/** "09" -> ["0", "9"]: the flip clock draws one card per digit, so only the digit that changed turns. */
export function splitDigits(group: string): string[] {
  return String(group).split('')
}

/**
 * Flip card size for `groups` two-digit groups in a box of tw x th px (label / date already taken off th), with `apW` px kept for AM/PM.
 * Cards (one per digit, 4 px apart, groups 8 px apart) grow until the height or the width stops them; a card is at most 0.72 of its
 * height wide, and the glyph is about 0.95 of the card height in font size (digits fill ~70% of the card).
 */
export function flipSize(tw: number, th: number, groups: number, apW: number): { w: number; h: number; font: number } {
  const digits = groups * 2
  const gaps = groups * 4 + (groups - 1) * 8 + apW
  const fromW = (tw - 24 - gaps) / digits
  const maxH = Math.max(20, th - 20)
  const h = Math.max(20, Math.floor(Math.min(maxH, fromW / 0.6)))
  const w = Math.max(10, Math.floor(Math.min(fromW, h * 0.72)))
  const font = Math.max(10, Math.floor(Math.min(h * 0.95, w * 1.45)))
  return { w: w, h: h, font: font }
}

export interface BlocLayout {
  pad: number
  headH: number
  headF: number
  /** the big solar day number (font px; its line box is 0.95 of it) */
  n: number
  /** weekday font (line box 1.2) */
  wdF: number
  /** lunar day number font (line box 1) */
  lunN: number
  /** can chi / time line font (line box 1.35) */
  small: number
  /** chip font; 0 = no chip row */
  chipF: number
  /** the three can chi lines fit (else only the time sits left of the lunar day) */
  canChi: boolean
  /** giờ hoàng đạo row fits */
  hours: boolean
  hoursF: number
  /** lucky hours per row */
  perRow: number
  /** total height the blocks take, for the tests: never more than th */
  used: number
}

/**
 * Sizes for the bloc page face (not the strip), budgeted top to bottom so nothing overlaps or clips:
 * quiet header (month + year over a hairline) | number | weekday | chip row | lower row (time + can chi lines left, lunar day right)
 * | lucky hours. The lower row uses ONE small size for everything except the lunar day number (kn-visual: one secondary size).
 * The number takes what is left after the fixed blocks, capped by the width and by 42% of the height on big tiles, whose
 * leftover then goes to the lucky hours. The can chi lines are dropped (never truncated) when the number would get too small or
 * when the longest line (`ccChars`) and the lunar side (`lunChars`, its month text) do not fit side by side.
 * The chip row is kept on tiles 260 px or taller even without a holiday (the term shows there), so the layout does not jump.
 */
export function blocLayout(tw: number, th: number, holiday: boolean, hourCount: number, ccChars?: number, lunChars?: number): BlocLayout {
  const pad = Math.max(10, Math.round(Math.min(tw, th) * 0.05))
  const headH = Math.max(22, Math.min(34, Math.round(th * 0.085)))
  const headF = Math.max(12, Math.min(15, Math.round(headH * 0.45)))
  const small = Math.max(12, Math.min(15, Math.round(th * 0.045)))
  const line = small * 1.35
  const lowPad = 15 // margin 8 + border 1 + padding 6
  const slack = 4 // px for rounding in the browser
  const wdOf = (n: number) => Math.max(12, Math.min(20, Math.round(n * 0.13)))
  const lunOf = (n: number) => Math.max(15, Math.round(n * 0.28))
  // chip: font * 1.3 line + 4 padding + 2 border + 6 margin
  const chipFont = holiday || th >= 260 ? Math.max(11, Math.min(13, Math.round(Math.min(tw, th) * 0.04))) : 0
  const lunWidth = (n: number) => Math.max(lunOf(n) * 1.3, (lunChars || 10) * small * 0.56)
  const heightOf = (n: number, chipF: number, cc: boolean) => {
    const chipH = chipF ? Math.ceil(chipF * 1.3 + 12) : 0
    const low = lowPad + Math.max(Math.ceil(cc ? 4 * line : line), lunOf(n) + Math.ceil(line))
    return headH + pad * 2 + chipH + Math.ceil(n * 0.95) + Math.ceil(wdOf(n) * 1.2 + 2) + low + slack
  }
  // the largest number that fits: capped by the width (n * 1.25) and 42% of the height, then walked down until the blocks fit
  const cap = Math.floor(Math.min((tw - pad * 2) / 1.25, Math.max(th * 0.42, 40)))
  const fitN = (chipF: number, cc: boolean) => {
    let n = cap
    while (n > 16 && heightOf(n, chipF, cc) > th) n--
    return n
  }
  let chipF = chipFont
  let canChi = (ccChars || 13) * small * 0.56 + 12 + lunWidth(cap) <= tw - pad * 2
  let n = fitN(chipF, canChi)
  // the can chi lines go first when they cost the number too much (or do not fit side by side), then the chip row
  if (canChi && (n < Math.max(28, th * 0.34) || (ccChars || 13) * small * 0.56 + 12 + lunWidth(n) > tw - pad * 2)) {
    canChi = false
    n = fitN(chipF, false)
  }
  if (chipF && heightOf(n, chipF, canChi) > th) {
    chipF = 0
    n = fitN(0, canChi)
  }
  let used = heightOf(n, chipF, canChi) - slack
  const hoursF = Math.max(12, Math.min(13, small))
  const perRow = Math.max(2, Math.min(6, Math.floor((tw - pad * 2) / (hoursF * 6.6))))
  const rows = Math.ceil(Math.max(1, hourCount) / perRow)
  // title line + rows + 10 margin
  const hoursH = Math.ceil(hoursF * 1.35 + 4 + rows * hoursF * 1.5 + 10)
  const hours = hourCount > 0 && th - used - slack >= hoursH
  if (hours) used += hoursH
  return { pad: pad, headH: headH, headF: headF, n: n, wdF: wdOf(n), lunN: lunOf(n), small: small, chipF: chipF, canChi: canChi, hours: hours, hoursF: hoursF, perRow: perRow, used: used }
}

/**
 * The weather glyph's condition for a clock: a clear sky becomes 'night' (the moon) when the source says it is not day (now.isDay false),
 * or, when the source does not say, between 19:00 and 06:00 like the weather tile. `kind` is condOf() of the condition.
 */
export function nightCond(kind: string, isDay: boolean | undefined, hour: number): string {
  const dark = isDay === false || (isDay === undefined && (hour >= 19 || hour < 6))
  return kind === 'clear' && dark ? 'night' : kind
}

/* ---------- ticks: 60 marks around the tile's rounded outline ---------- */

export interface Tick {
  /** outer end, on the rounded-rectangle path */
  x: number
  y: number
  /** inner end, `len` px towards the inside along the inward normal */
  x2: number
  y2: number
  /** outward normal as an angle in degrees: 0 up, 90 right (clockwise) */
  a: number
  /** arc length from the top centre, clockwise */
  at: number
  /** every 5th tick (0, 5, 10, ...) is a little longer */
  major: boolean
}

/**
 * The point and outward normal at arc length `at` (clockwise from the top centre) along a rounded rectangle x0..x1 / y0..y1
 * with corner radius r (r > 0, at most half of each side).
 */
function roundRectAt(x0: number, y0: number, x1: number, y1: number, r: number, at: number): { x: number; y: number; nx: number; ny: number } {
  const w = x1 - x0
  const h = y1 - y0
  const sx = w - 2 * r // straight top / bottom
  const sy = h - 2 * r // straight sides
  const q = (Math.PI * r) / 2 // a quarter arc
  const per = 2 * sx + 2 * sy + 4 * q
  let d = ((at % per) + per) % per
  const cx = x0 + w / 2
  // corner arc around (ccx, ccy), starting at angle a0 (radians, 0 = up, clockwise)
  const arc = (ccx: number, ccy: number, a0: number, len: number) => {
    const t = a0 + len / r
    const nx = Math.sin(t)
    const ny = -Math.cos(t)
    return { x: ccx + nx * r, y: ccy + ny * r, nx: nx, ny: ny }
  }
  // top, right half
  if (d <= sx / 2) return { x: cx + d, y: y0, nx: 0, ny: -1 }
  d -= sx / 2
  if (d <= q) return arc(x1 - r, y0 + r, 0, d)
  d -= q
  if (d <= sy) return { x: x1, y: y0 + r + d, nx: 1, ny: 0 }
  d -= sy
  if (d <= q) return arc(x1 - r, y1 - r, Math.PI / 2, d)
  d -= q
  if (d <= sx) return { x: x1 - r - d, y: y1, nx: 0, ny: 1 }
  d -= sx
  if (d <= q) return arc(x0 + r, y1 - r, Math.PI, d)
  d -= q
  if (d <= sy) return { x: x0, y: y1 - r - d, nx: -1, ny: 0 }
  d -= sy
  if (d <= q) return arc(x0 + r, y0 + r, (3 * Math.PI) / 2, d)
  d -= q
  return { x: x0 + r + d, y: y0, nx: 0, ny: -1 }
}

/** Perimeter of a w x h rounded rectangle with corner radius r. */
export const roundRectLength = (w: number, h: number, r: number) => 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r

/**
 * Corner radius of the ticks' outline inside a w x h tile: about a fifth of the outline's short side (the reference's big soft
 * corner), never less than the tile's own radius nor 3 long ticks (so the ticks round a corner fan out instead of meeting in an L),
 * and at most half the short side.
 */
export function tickCorner(w: number, h: number, radius: number, inset: number, lenMajor: number): number {
  const short = Math.max(4, Math.min(w, h) - 2 * inset)
  return Math.min(short / 2, Math.max(radius, short * 0.2, lenMajor * 3))
}

/**
 * The 60 ticks of the ticks clock, for a tile w x h px whose corners have radius `radius`: a rounded rectangle `inset` px inside
 * the tile edge with the corner radius of tickCorner, ticks evenly spaced by arc length, tick 0 at the top centre, then clockwise,
 * each drawn inwards along the normal: `len` px long, `lenMajor` px for every fifth.
 */
export function tickRing(w: number, h: number, radius: number, inset: number, len: number, lenMajor: number): Tick[] {
  const x0 = inset
  const y0 = inset
  const x1 = Math.max(x0 + 4, w - inset)
  const y1 = Math.max(y0 + 4, h - inset)
  const r = tickCorner(x1 - x0 + 2 * inset, y1 - y0 + 2 * inset, radius, inset, lenMajor)
  const per = roundRectLength(x1 - x0, y1 - y0, r)
  const out: Tick[] = []
  for (let i = 0; i < 60; i++) {
    const at = (i * per) / 60
    const p = roundRectAt(x0, y0, x1, y1, r, at)
    const major = i % 5 === 0
    const l = major ? lenMajor : len
    let a = (Math.atan2(p.nx, -p.ny) * 180) / Math.PI
    if (a < 0) a += 360
    out.push({ x: p.x, y: p.y, x2: p.x - p.nx * l, y2: p.y - p.ny * l, a: a, at: at, major: major })
  }
  return out
}

/**
 * Opacity of tick i when `cur` (0-59: the second, or the minute when seconds are off) is the newest lit one: ticks up to and
 * including it are full ink; the 15 after it fade from 0.5 down to the faint rest, which stays at 0.14.
 */
export function tickOpacity(i: number, cur: number): number {
  if (i <= cur) return 1
  const d = i - cur
  if (d >= 15) return 0.14
  return Math.round((0.5 - ((0.5 - 0.14) * (d - 1)) / 14) * 1000) / 1000
}
