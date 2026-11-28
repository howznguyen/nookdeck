// Vietnamese lunar calendar, after Ho Ngoc Duc's algorithm.
// Pure functions, no DOM, plain ES2017 so old WebViews can run it.

export interface LunarDate { day: number; month: number; year: number; leap: boolean }
export type LunarLang = 'vi' | 'zh'

const PI = Math.PI
const SYNODIC = 29.530588853
const DEFAULT_TZ = 7

const CAN_VI = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý']
const CHI_VI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi']
const CAN_ZH = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
const CHI_ZH = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']

// Indexed by sun longitude / 15 degrees, 0 = spring equinox.
const TERMS_VI = [
  'Xuân phân', 'Thanh minh', 'Cốc vũ', 'Lập hạ', 'Tiểu mãn', 'Mang chủng',
  'Hạ chí', 'Tiểu thử', 'Đại thử', 'Lập thu', 'Xử thử', 'Bạch lộ',
  'Thu phân', 'Hàn lộ', 'Sương giáng', 'Lập đông', 'Tiểu tuyết', 'Đại tuyết',
  'Đông chí', 'Tiểu hàn', 'Đại hàn', 'Lập xuân', 'Vũ thủy', 'Kinh trập',
]
const TERMS_ZH = [
  '春分', '清明', '谷雨', '立夏', '小满', '芒种',
  '夏至', '小暑', '大暑', '立秋', '处暑', '白露',
  '秋分', '寒露', '霜降', '立冬', '小雪', '大雪',
  '冬至', '小寒', '大寒', '立春', '雨水', '惊蛰',
]

const MONTHS_VI = ['Giêng', 'Hai', 'Ba', 'Tư', 'Năm', 'Sáu', 'Bảy', 'Tám', 'Chín', 'Mười', 'Mười một', 'Chạp']
const MONTHS_ZH = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '腊月']

// Lucky hour masks, by day chi mod 6 (from Ho Ngoc Duc's amlich).
const LUCKY = ['110100101100', '001101001011', '110011010010', '101100110100', '001011001101', '010010110011']

const int = Math.floor

/** Julian day number of a solar date (Gregorian, Julian before 1582-10-15). */
export function jdFromDate(d: number, m: number, y: number): number {
  const a = int((14 - m) / 12)
  const yy = y + 4800 - a
  const mm = m + 12 * a - 3
  let jd = d + int((153 * mm + 2) / 5) + 365 * yy + int(yy / 4) - int(yy / 100) + int(yy / 400) - 32045
  if (jd < 2299161) jd = d + int((153 * mm + 2) / 5) + 365 * yy + int(yy / 4) - 32083
  return jd
}

/** Solar date [d, m, y] of a Julian day number. */
export function jdToDate(jd: number): [number, number, number] {
  let a: number, b: number, c: number
  if (jd > 2299160) {
    a = jd + 32044
    b = int((4 * a + 3) / 146097)
    c = a - int((b * 146097) / 4)
  } else {
    b = 0
    c = jd + 32082
  }
  const d = int((4 * c + 3) / 1461)
  const e = c - int((1461 * d) / 4)
  const m = int((5 * e + 2) / 153)
  const day = e - int((153 * m + 2) / 5) + 1
  const month = m + 3 - 12 * int(m / 10)
  const year = b * 100 + d - 4800 + int(m / 10)
  return [day, month, year]
}

// Julian date (fractional, UT) of the k-th new moon after 1900-01-01.
function newMoon(k: number): number {
  const T = k / 1236.85
  const T2 = T * T
  const T3 = T2 * T
  const dr = PI / 180
  let Jd1 = 2415020.75933 + SYNODIC * k + 0.0001178 * T2 - 0.000000155 * T3
  Jd1 = Jd1 + 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr)
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M)
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr)
  C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr)
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr))
  C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M))
  C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr))
  C1 = C1 + 0.001 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M))
  let deltat: number
  if (T < -11) deltat = 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
  else deltat = -0.000278 + 0.000265 * T + 0.000262 * T2
  return Jd1 + C1 - deltat
}

// Sun longitude in radians [0, 2pi) at a fractional Julian date (UT).
function sunLongitude(jdn: number): number {
  const T = (jdn - 2451545.0) / 36525
  const T2 = T * T
  const dr = PI / 180
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M)
  DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M)
  let L = (L0 + DL) * dr
  L = L - PI * 2 * int(L / (PI * 2))
  return L
}

function newMoonDay(k: number, tz: number): number {
  return int(newMoon(k) + 0.5 + tz / 24)
}

// Sun longitude at local midnight starting day jdn, in 30 degree sectors 0..11.
function sunSector(jdn: number, tz: number): number {
  return int((sunLongitude(jdn - 0.5 - tz / 24) / PI) * 6)
}

// Day number of the start of lunar month 11 of solar year y.
function lunarMonth11(y: number, tz: number): number {
  const off = jdFromDate(31, 12, y) - 2415021
  const k = int(off / SYNODIC)
  let nm = newMoonDay(k, tz)
  if (sunSector(nm, tz) >= 9) nm = newMoonDay(k - 1, tz)
  return nm
}

// Offset of the leap month after month 11 starting at a11.
function leapMonthOffset(a11: number, tz: number): number {
  const k = int((a11 - 2415021.076998695) / SYNODIC + 0.5)
  let last: number
  let i = 1
  let arc = sunSector(newMoonDay(k + i, tz), tz)
  do {
    last = arc
    i++
    arc = sunSector(newMoonDay(k + i, tz), tz)
  } while (arc !== last && i < 14)
  return i - 1
}

function jdToLunar(dayNumber: number, tz: number): LunarDate {
  const k = int((dayNumber - 2415021.076998695) / SYNODIC)
  let n = k + 1
  let monthStart = newMoonDay(n, tz)
  // The mean month estimate can be one off: step back until the month has begun.
  while (monthStart > dayNumber) {
    n--
    monthStart = newMoonDay(n, tz)
  }
  const yy = jdToDate(dayNumber)[2]
  let a11 = lunarMonth11(yy, tz)
  let b11 = a11
  let lunarYear: number
  if (a11 >= monthStart) {
    lunarYear = yy
    a11 = lunarMonth11(yy - 1, tz)
  } else {
    lunarYear = yy + 1
    b11 = lunarMonth11(yy + 1, tz)
  }
  const day = dayNumber - monthStart + 1
  const diff = int((monthStart - a11) / 29)
  let leap = false
  let month = diff + 11
  if (b11 - a11 > 365) {
    const leapDiff = leapMonthOffset(a11, tz)
    if (diff >= leapDiff) {
      month = diff + 10
      if (diff === leapDiff) leap = true
    }
  }
  if (month > 12) month = month - 12
  if (month >= 11 && diff < 4) lunarYear -= 1
  return { day: day, month: month, year: lunarYear, leap: leap }
}

// Day number of a lunar date, or 0 if the leap month does not exist.
function lunarToJd(ld: number, lm: number, ly: number, leap: boolean, tz: number): number {
  let a11: number, b11: number
  if (lm < 11) {
    a11 = lunarMonth11(ly - 1, tz)
    b11 = lunarMonth11(ly, tz)
  } else {
    a11 = lunarMonth11(ly, tz)
    b11 = lunarMonth11(ly + 1, tz)
  }
  const k = int(0.5 + (a11 - 2415021.076998695) / SYNODIC)
  let off = lm - 11
  if (off < 0) off += 12
  if (b11 - a11 > 365) {
    const leapOff = leapMonthOffset(a11, tz)
    let leapMonth = leapOff - 2
    if (leapMonth < 0) leapMonth += 12
    if (leap && lm !== leapMonth) return 0
    if (leap || off >= leapOff) off += 1
  } else if (leap) {
    return 0
  }
  const monthStart = newMoonDay(k + off, tz)
  return monthStart + ld - 1
}

export function solarToLunar(d: number, m: number, y: number, tz?: number): LunarDate {
  return jdToLunar(jdFromDate(d, m, y), tz === undefined ? DEFAULT_TZ : tz)
}

/** Solar [d, m, y] of a lunar date, [0, 0, 0] if no such lunar date. */
export function lunarToSolar(ld: number, lm: number, ly: number, leap: boolean, tz?: number): [number, number, number] {
  const z = tz === undefined ? DEFAULT_TZ : tz
  if (ld < 1 || ld > 30 || lm < 1 || lm > 12) return [0, 0, 0]
  const jd = lunarToJd(ld, lm, ly, leap, z)
  if (jd === 0) return [0, 0, 0]
  // Day 30 in a 29 day month rolls into the next month: reject it.
  const back = jdToLunar(jd, z)
  if (back.day !== ld || back.month !== lm || back.year !== ly || back.leap !== leap) return [0, 0, 0]
  return jdToDate(jd)
}

function canChi(can: number, chi: number, lang: LunarLang | undefined): string {
  const c = ((can % 10) + 10) % 10
  const h = ((chi % 12) + 12) % 12
  if (lang === 'zh') return CAN_ZH[c] + CHI_ZH[h]
  return CAN_VI[c] + ' ' + CHI_VI[h]
}

export function canChiYear(lunarYear: number, lang?: LunarLang): string {
  return canChi(lunarYear + 6, lunarYear + 8, lang)
}

/** Leap months share the stem and branch of the month they repeat. */
export function canChiMonth(lunarMonth: number, lunarYear: number, lang?: LunarLang): string {
  return canChi(lunarYear * 12 + lunarMonth + 3, lunarMonth + 1, lang)
}

export function canChiDay(d: number, m: number, y: number, lang?: LunarLang): string {
  const jd = jdFromDate(d, m, y)
  return canChi(jd + 9, jd + 1, lang)
}

/** The solar term in force at the end of the day, so the day a term starts shows it. */
export function solarTerm(d: number, m: number, y: number, tz?: number, lang?: LunarLang): string {
  const z = tz === undefined ? DEFAULT_TZ : tz
  const jd = jdFromDate(d, m, y)
  const i = int((sunLongitude(jd + 0.5 - z / 24) / PI) * 12) % 24
  return lang === 'zh' ? TERMS_ZH[i] : TERMS_VI[i]
}

export function luckyHours(d: number, m: number, y: number, lang?: LunarLang): string[] {
  const chiOfDay = (jdFromDate(d, m, y) + 1) % 12
  const mask = LUCKY[chiOfDay % 6]
  const names = lang === 'zh' ? CHI_ZH : CHI_VI
  const out: string[] = []
  for (let i = 0; i < 12; i++) {
    if (mask.charAt(i) === '1') out.push(names[i] + ' (' + ((i * 2 + 23) % 24) + '-' + ((i * 2 + 1) % 24) + ')')
  }
  return out
}

export function lunarMonthName(month: number, leap: boolean, lang?: LunarLang): string {
  const i = month - 1
  if (i < 0 || i > 11) return ''
  if (lang === 'zh') return (leap ? '闰' : '') + MONTHS_ZH[i]
  return MONTHS_VI[i] + (leap ? ' nhuận' : '')
}

const LUNAR_FIXED: { [key: string]: [string, string] } = {
  '1/1': ['Tết Nguyên Đán', '春节'],
  '2/1': ['Mùng 2 Tết', '正月初二'],
  '3/1': ['Mùng 3 Tết', '正月初三'],
  '15/1': ['Rằm tháng Giêng', '元宵节'],
  '3/3': ['Tết Hàn thực', '寒食节'],
  '10/3': ['Giỗ Tổ Hùng Vương', '雄王忌日'],
  '15/4': ['Lễ Phật đản', '佛诞'],
  '5/5': ['Tết Đoan ngọ', '端午节'],
  '15/7': ['Lễ Vu Lan', '中元节'],
  '15/8': ['Tết Trung thu', '中秋节'],
  '23/12': ['Ông Công Ông Táo', '灶君节'],
}

const SOLAR_FIXED: { [key: string]: [string, string] } = {
  '1/1': ['Tết Dương lịch', '元旦'],
  '14/2': ['Lễ Tình nhân', '情人节'],
  '8/3': ['Quốc tế Phụ nữ', '国际妇女节'],
  '30/4': ['Giải phóng miền Nam', '南方解放日'],
  '1/5': ['Quốc tế Lao động', '国际劳动节'],
  '1/6': ['Quốc tế Thiếu nhi', '国际儿童节'],
  '2/9': ['Quốc khánh', '国庆节'],
  '20/10': ['Phụ nữ Việt Nam', '越南妇女节'],
  '20/11': ['Nhà giáo Việt Nam', '越南教师节'],
  '24/12': ['Giáng sinh', '圣诞节'],
}

function pick(pair: [string, string], lang: LunarLang | undefined): string {
  return lang === 'zh' ? pair[1] : pair[0]
}

export function lunarHoliday(l: LunarDate, lang?: LunarLang): string | null {
  if (!l.leap) {
    const fixed = LUNAR_FIXED[l.day + '/' + l.month]
    if (fixed) return pick(fixed, lang)
  }
  if (l.month === 12 && l.day >= 29) {
    // New Year's Eve: the next day is 1/1 of the next lunar year.
    const jd = lunarToJd(l.day, l.month, l.year, l.leap, DEFAULT_TZ)
    if (jd !== 0) {
      const next = jdToLunar(jd + 1, DEFAULT_TZ)
      if (next.day === 1 && next.month === 1 && !next.leap) return lang === 'zh' ? '除夕' : 'Giao thừa'
    }
  }
  if (l.day === 1) return lang === 'zh' ? '初一' : 'Mùng 1'
  if (l.day === 15) return lang === 'zh' ? '十五' : 'Rằm'
  return null
}

export function solarHoliday(d: number, m: number, lang?: LunarLang): string | null {
  const fixed = SOLAR_FIXED[d + '/' + m]
  return fixed ? pick(fixed, lang) : null
}

export interface LunarInfo { lunar: LunarDate; yearName: string; monthName: string; dayName: string; term: string; luckyHours: string[]; holiday: string | null }

/** Lunar facts for the device's local calendar day, Vietnam time zone. */
export function lunarInfo(date: Date, lang?: LunarLang): LunarInfo {
  const d = date.getDate()
  const m = date.getMonth() + 1
  const y = date.getFullYear()
  const lunar = solarToLunar(d, m, y, DEFAULT_TZ)
  return {
    lunar: lunar,
    yearName: canChiYear(lunar.year, lang),
    monthName: canChiMonth(lunar.month, lunar.year, lang),
    dayName: canChiDay(d, m, y, lang),
    term: solarTerm(d, m, y, DEFAULT_TZ, lang),
    luckyHours: luckyHours(d, m, y, lang),
    holiday: lunarHoliday(lunar, lang),
  }
}
