import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { getLang } from './i18n'
import { t } from './i18n'
import { timeWordsIn } from './clock-words'
import { AnimatedNumber, reducedMotion } from './knowns'
import { tint } from './theme'
import { condOf, condTextOf } from './automation'
import { SkyLayer, WxLine, glyphKey } from './weather-tile'
import { isNight, skyOf, type WxCond } from './weather-logic'
import { blocCanChi, blocLayout, blocMode, clockCaption, flipSize, lunarDay, nightCond, lunarLangOf, meridiem, ringProgress, ringUsesSeconds, segmentsOf, splitDigits, tickOpacity, tickRing } from './clock-logic'
import './clock-ticks.css'
import './clock-dither.css'
import { ditherLayout, fillNoise, glyphCells, glyphLayer, runsOf, scramble, type DitherLayout } from './dither-logic'
import type { ClockWx } from './plugin-logic'
import type { ClockOptions, IconAssets } from './types'

/**
 * Clock widget styles: digital (AnimatedNumber rolling digits), flip (split-flap cards), analog (SVG dial + hands),
 * minimal, word (spoken time in the deck language, see clock-words.ts) and world (local time + up to 4 IANA zones via Intl.DateTimeFormat),
 * weather (time + the core.weather "now" data the agent serves for the clock's tile id), lunar (time + lunar date and can chi, lunar.ts),
 * bloc (Vietnamese tear-off calendar page), segment (7-segment LED digits), ring (time inside a seconds ring), stack (hours over minutes)
 * ticks (60 marks around the tile's rounded outline, lit up to the current second, round a big condensed time) and dither (the time as
 * dithered ASCII art on a character grid filling the tile, dither-logic.ts).
 * Safari 12: no ?. / ??, flex gap, clamp(); keyframes are -webkit- prefixed; the dial hands are HTML elements (CSS transforms on SVG are unreliable).
 */

export interface ClockProps {
  tw: number
  th: number
  scale: number
  showLabel: boolean
  textColor?: string
  color?: string
  opts?: ClockOptions
  /** weather style: the current weather, null until the agent sends some */
  wx?: ClockWx | null
  assets?: IconAssets
  preview?: boolean
}

const WEEKDAY_VI = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy']
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEKDAY_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const MONTH_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const WEEKDAY_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const MONTH_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad2 = (n: number) => (n < 10 ? '0' : '') + n
const fit = (chars: number, avail: number, max: number, min: number) => Math.max(min, Math.min(max, Math.floor(avail / (Math.max(1, chars) * 0.62))))

export interface Parts {
  h: number
  m: number
  s: number
  y: number
  mo: number
  d: number
  wd: number
}

/** Wall-clock parts of `date` in an IANA zone (the phone's zone when tz is empty or unknown). */
export function zoneParts(date: Date, tz?: string): Parts {
  const local = (): Parts => ({ h: date.getHours(), m: date.getMinutes(), s: date.getSeconds(), y: date.getFullYear(), mo: date.getMonth() + 1, d: date.getDate(), wd: date.getDay() })
  if (!tz) return local()
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    const o: { [k: string]: number } = {}
    f.formatToParts(date).forEach((p) => {
      if (p.type !== 'literal') o[p.type] = parseInt(p.value, 10)
    })
    if (o.hour === undefined || isNaN(o.hour)) return local()
    const wd = new Date(Date.UTC(o.year, o.month - 1, o.day)).getUTCDay()
    return { h: o.hour % 24, m: o.minute, s: o.second, y: o.year, mo: o.month, d: o.day, wd: wd }
  } catch (e) {
    return local()
  }
}

const dayNum = (p: Parts) => Math.round(Date.UTC(p.y, p.mo - 1, p.d) / 86400000)

const CITY: { [k: string]: string } = {
  Ho_Chi_Minh: 'TP. Hồ Chí Minh',
  Saigon: 'TP. Hồ Chí Minh',
  Hanoi: 'Hà Nội',
  London: 'Luân Đôn',
  Paris: 'Pa-ri',
  Berlin: 'Béc-lin',
  Moscow: 'Mát-xcơ-va',
  Shanghai: 'Thượng Hải',
  Hong_Kong: 'Hồng Kông',
  Beijing: 'Bắc Kinh',
  Tokyo: 'Tokyo',
  Seoul: 'Seoul',
  Bangkok: 'Bangkok',
  Singapore: 'Singapore',
  Sydney: 'Sydney',
  Dubai: 'Dubai',
  Kolkata: 'Kolkata',
  New_York: 'New York',
  Los_Angeles: 'Los Angeles',
  Chicago: 'Chicago',
  Phnom_Penh: 'Phnom Penh',
}

/** French and Brazilian names where they differ from the English one. */
const CITY_FR: { [k: string]: string } = {
  Ho_Chi_Minh: 'Hô Chi Minh-Ville',
  Saigon: 'Hô Chi Minh-Ville',
  Hanoi: 'Hanoï',
  London: 'Londres',
  Moscow: 'Moscou',
  Beijing: 'Pékin',
  Seoul: 'Séoul',
  Singapore: 'Singapour',
  Dubai: 'Dubaï',
  Kolkata: 'Calcutta',
}
const CITY_PT: { [k: string]: string } = {
  Ho_Chi_Minh: 'Ho Chi Minh',
  Saigon: 'Ho Chi Minh',
  Hanoi: 'Hanói',
  London: 'Londres',
  Berlin: 'Berlim',
  Moscow: 'Moscou',
  Shanghai: 'Xangai',
  Beijing: 'Pequim',
  Tokyo: 'Tóquio',
  Seoul: 'Seul',
  Singapore: 'Singapura',
  Kolkata: 'Calcutá',
  New_York: 'Nova York',
}

const CITY_ZH: { [k: string]: string } = {
  Ho_Chi_Minh: '胡志明市',
  Saigon: '胡志明市',
  Hanoi: '河内',
  London: '伦敦',
  Paris: '巴黎',
  Berlin: '柏林',
  Moscow: '莫斯科',
  Shanghai: '上海',
  Hong_Kong: '香港',
  Beijing: '北京',
  Tokyo: '东京',
  Seoul: '首尔',
  Bangkok: '曼谷',
  Singapore: '新加坡',
  Sydney: '悉尼',
  Dubai: '迪拜',
  Kolkata: '加尔各答',
  New_York: '纽约',
  Los_Angeles: '洛杉矶',
  Chicago: '芝加哥',
  Phnom_Penh: '金边',
}

/** "Europe/London" -> "London", "America/New_York" -> "New York". */
export function cityName(tz: string): string {
  const last = tz.split('/').pop() || tz
  if (getLang() === 'zh') return CITY_ZH[last] || last.replace(/_/g, ' ')
  const names = getLang() === 'vi' ? CITY : getLang() === 'fr' ? CITY_FR : getLang() === 'pt' ? CITY_PT : null
  return (names && names[last]) || last.replace(/_/g, ' ')
}

const hour12Of = (h: number) => h % 12 || 12
const dateText = (p: Parts) =>
  getLang() === 'zh'
    ? p.mo + '月' + p.d + '日 ' + WEEKDAY_ZH[p.wd]
    : getLang() === 'vi'
      ? WEEKDAY_VI[p.wd] + ', ' + p.d + ' tháng ' + p.mo
      : getLang() === 'fr'
        ? WEEKDAY_FR[p.wd] + ' ' + p.d + ' ' + MONTH_FR[p.mo - 1]
        : getLang() === 'pt'
          ? WEEKDAY_PT[p.wd] + ', ' + p.d + ' de ' + MONTH_PT[p.mo - 1]
          : WEEKDAY_EN[p.wd] + ', ' + MONTH_EN[p.mo - 1] + ' ' + p.d

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    setNow(new Date())
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** An angle that only grows, so a CSS transition never spins backwards across 360 -> 0. */
function useUnwrapped(angle: number): number {
  const last = useRef(angle)
  let a = angle
  while (a < last.current - 180) a += 360
  last.current = a
  return a
}

export function ClockWidget(props: ClockProps) {
  const o = props.opts || {}
  const now = useNow()
  const style = o.style || 'digital'
  const big = props.tw >= 170 && props.th >= 110
  const tc = props.textColor || undefined
  const p = zoneParts(now, o.timeZone)
  // Seconds only need horizontal room (a 3x1 tile is ~93px tall but wide enough), the date needs height too.
  const secs = o.seconds === undefined ? props.tw >= 200 || big : !!o.seconds
  const date = o.showDate === undefined ? big && props.showLabel : !!o.showDate
  const hr = o.hour12 ? hour12Of(p.h) : p.h
  // the caption is only a label the user set; the item's default name ("Clock") never shows on a clock face
  const label = clockCaption(o)
  const common = { p: p, o: o, tw: props.tw, th: props.th, scale: props.scale, secs: secs, date: date, hr: hr, label: label, big: big, color: props.color, wx: props.wx || null, assets: props.assets, ms: now.getTime() }
  let body
  if (style === 'flip') body = <Flip {...common} />
  else if (style === 'analog') body = <Analog {...common} />
  else if (style === 'minimal') body = <Minimal {...common} />
  else if (style === 'word') body = <Words {...common} />
  else if (style === 'world') body = <World {...common} now={now} />
  else if (style === 'weather') body = <WeatherClock {...common} />
  else if (style === 'lunar') body = <LunarClock {...common} />
  else if (style === 'bloc') body = <Bloc {...common} />
  else if (style === 'segment') body = <Segment {...common} />
  else if (style === 'ring') body = <Ring {...common} />
  else if (style === 'stack') body = <Stack {...common} />
  else if (style === 'ticks') body = <Ticks {...common} />
  else if (style === 'dither') body = <Dither {...common} />
  else body = <Digital {...common} />
  return (
    <div class={'pd-clk pd-clk--' + style} style={{ color: tc }}>
      {body}
    </div>
  )
}

interface Sub {
  p: Parts
  o: ClockOptions
  tw: number
  th: number
  scale: number
  secs: boolean
  date: boolean
  hr: number
  label: string
  big: boolean
  color?: string
  wx: ClockWx | null
  assets?: IconAssets
  ms: number
}

/** AM/PM of the wall-clock hour in the deck language; `.before` for Chinese (上午 10:42). */
const ampmOf = (p: Parts) => meridiem(p.h, getLang(), t)
/** The label as a small span on the side it goes (before or after the time); null when it belongs on the other side or 12 h is off. */
const apSpan = (s: Sub, side: 'before' | 'after', cls: string, style?: { [k: string]: string }) => {
  if (!s.o.hour12) return null
  const a = ampmOf(s.p)
  if (a.before !== (side === 'before')) return null
  return (
    <span class={cls + (a.before ? ' pd-ck__pre' : '')} style={style}>
      {a.text}
    </span>
  )
}
const hm = (s: Sub) => s.hr * 100 + s.p.m
const hmFormat = (n: number) => pad2(Math.floor(n / 100)) + ':' + pad2(n % 100)

function Label(props: { text: string; tw: number; scale: number }) {
  if (!props.text) return null
  return (
    <div class="pd-clk__l" style={{ fontSize: Math.max(9, fit(props.text.length, Math.max(20, props.tw - 28), 12 * Math.min(1.2, props.scale), 9)) + 'px' }}>
      {props.text}
    </div>
  )
}

function DateLine(props: { p: Parts; size: number }) {
  return (
    <div class="pd-clock__d" style={{ fontSize: props.size + 'px' }}>
      {dateText(props.p)}
    </div>
  )
}

/** digital: big thin rolling digits with a small superscript. */
function Digital(s: Sub) {
  const pad = s.tw >= 240 ? 18 : 14
  const inner = s.tw - pad * 2
  const wide = s.secs ? 3.2 : s.o.hour12 ? 3.2 : 2.9
  const size = Math.max(14, Math.floor(Math.min(s.th * (s.date || s.label ? 0.46 : 0.55), inner / wide) * Math.min(1.2, s.scale)))
  return (
    <div class="pd-clk__c" style={{ padding: '0 ' + pad + 'px' }}>
      {s.big ? <Label text={s.label} tw={s.tw} scale={s.scale} /> : null}
      <div class="pd-clock__t" style={{ fontSize: size + 'px' }}>
        {apSpan(s, 'before', 'pd-clock__s', { fontSize: Math.max(10, Math.round(size * 0.3)) + 'px' })}
        <AnimatedNumber value={hm(s)} format={hmFormat} />
        {s.secs || (s.o.hour12 && !ampmOf(s.p).before) ? (
          <sup class="pd-clock__s" style={{ fontSize: Math.max(10, Math.round(size * 0.3)) + 'px' }}>
            {s.secs ? <AnimatedNumber value={s.p.s} format={pad2} /> : null}
            {apSpan(s, 'after', 'pd-clk__ap')}
          </sup>
        ) : null}
      </div>
      {s.date ? <DateLine p={s.p} size={Math.max(11, Math.min(16, Math.round(size * 0.22))) * Math.min(1.2, s.scale)} /> : null}
      {!s.big ? <Label text={s.label} tw={s.tw} scale={s.scale} /> : null}
    </div>
  )
}

/** minimal: the time only, as large as the tile allows. */
function Minimal(s: Sub) {
  const chars = s.secs ? 8 : 5
  const size = Math.max(12, Math.floor(Math.min(s.th * 0.7, (s.tw - 16) / (chars * 0.56))))
  const text = pad2(s.hr) + ':' + pad2(s.p.m) + (s.secs ? ':' + pad2(s.p.s) : '')
  return (
    <div class="pd-clk__c pd-clk__c--mid">
      <div class="pd-clk__min" style={{ fontSize: size + 'px' }}>
        {text}
      </div>
    </div>
  )
}

/** word: "half past ten" / "mười giờ rưỡi" (rules in clock-words.ts). */
function Words(s: Sub) {
  const w = timeWordsIn(getLang(), s.p.h, s.p.m)
  const cap = Math.round(s.th * 0.11)
  const showPart = s.th >= 90
  const areaW = s.tw - 28
  const areaH = s.th - 24 - (showPart ? 18 : 0) - (s.date ? 22 : 0)
  const size = Math.max(11, Math.min(46, Math.floor(Math.sqrt((Math.max(20, areaW) * Math.max(20, areaH) * 0.62) / (w.text.length * 0.62)))))
  return (
    <div class="pd-clk__c pd-clk__c--mid pd-clk__words">
      <div class="pd-clk__w" style={{ fontSize: size + 'px' }}>
        {w.text}
      </div>
      {showPart ? (
        <div class="pd-clk__part" style={{ fontSize: Math.max(10, Math.min(14, cap)) + 'px' }}>
          {w.part}
        </div>
      ) : null}
      {s.date ? <DateLine p={s.p} size={Math.max(11, Math.min(15, Math.round(size * 0.4)))} /> : null}
    </div>
  )
}

/* ---------- flip ---------- */

/** Length of one flap turn (ms): kn-motion travel (a digit that rolls), matches --pd-dur-travel in deck.css. */
const FLIP_MS = 420

/**
 * One split-flap card per digit. Static halves: the upper shows the NEXT digit, the lower the CURRENT one. On top a flap (the upper
 * half box, hinged at its bottom edge) carries the upper half of CURRENT on its front and the lower half of NEXT on its back, pre-turned
 * 180 degrees; a flip turns the flap to -180 deg, then on transitionend (or a timeout, for a hidden tab) current = next and the flap
 * snaps back without a transition. A value that arrives mid-flip only updates next. Reduced motion = instant swap.
 */
function FlipDigit(props: { ch: string; w: number; h: number; font: number }) {
  const [st, setSt] = useState({ cur: props.ch, next: props.ch, go: false })
  const flap = useRef<HTMLDivElement>(null)
  const timer = useRef(0)
  if (props.ch !== st.next) {
    if (reducedMotion()) setSt({ cur: props.ch, next: props.ch, go: false })
    else setSt({ cur: st.cur, next: props.ch, go: st.go || props.ch !== st.cur })
  }
  const done = () => {
    clearTimeout(timer.current)
    setSt((s) => (s.go ? { cur: s.next, next: s.next, go: false } : s))
  }
  useEffect(() => {
    const el = flap.current
    if (!el) return
    const onEnd = (e: Event) => {
      if (e.target === el) done()
    }
    el.addEventListener('transitionend', onEnd)
    el.addEventListener('webkitTransitionEnd', onEnd)
    return () => {
      el.removeEventListener('transitionend', onEnd)
      el.removeEventListener('webkitTransitionEnd', onEnd)
    }
  }, [])
  useEffect(() => {
    if (!st.go) return
    clearTimeout(timer.current)
    timer.current = window.setTimeout(done, FLIP_MS + 250)
    return () => clearTimeout(timer.current)
  }, [st.go])
  const dim = { width: props.w + 'px', height: props.h + 'px', fontSize: props.font + 'px', lineHeight: props.h + 'px' }
  const persp = Math.round(props.h * 2.6) + 'px'
  // kn-visual: radius follows the size of the thing; a card is an inner panel, 12 px at most
  const r = Math.max(4, Math.min(12, Math.round(props.w * 0.08))) + 'px'
  const half = (cls: string, text: string) => (
    <div class={'pd-fl__h ' + cls} data-part="clock-digit" style={cls.indexOf('pd-fl__bot') >= 0 ? { borderRadius: '0 0 ' + r + ' ' + r } : { borderRadius: r + ' ' + r + ' 0 0' }}>
      <span style={dim}>{text}</span>
      <i class="pd-fl__sh" />
    </div>
  )
  return (
    <div class={'pd-fl' + (st.go ? ' pd-fl--go' : '')} data-part="clock-card" style={{ width: props.w + 'px', height: props.h + 'px', WebkitPerspective: persp, perspective: persp, borderRadius: r }} aria-hidden="true">
      {half('pd-fl__top', st.next)}
      {half('pd-fl__bot', st.cur)}
      <div class="pd-fl__flap" ref={flap}>
        {half('pd-fl__top pd-fl__face', st.cur)}
        {half('pd-fl__bot pd-fl__face pd-fl__back', st.next)}
      </div>
      <i class="pd-fl__line" />
    </div>
  )
}

function Flip(s: Sub) {
  const groups = [pad2(s.hr), pad2(s.p.m)]
  if (s.secs) groups.push(pad2(s.p.s))
  const n = groups.length
  const dateH = s.date ? 22 : 0
  const labelH = s.label ? 16 : 0
  const gapW = 8
  const digitGap = 4
  const sz = flipSize(s.tw, s.th - dateH - labelH, n, s.o.hour12 ? Math.max(24, Math.round((s.th - dateH - labelH) * 0.22)) : 0)
  const ch = sz.h
  const dw = sz.w
  const font = sz.font
  const ap = s.o.hour12 ? ampmOf(s.p) : null
  const apEl = ap ? (
    <span class={'pd-fl__ap' + (ap.before ? ' pd-ck__pre' : '')} style={{ fontSize: Math.max(9, Math.round(ch * 0.18)) + 'px' }}>
      {ap.text}
    </span>
  ) : null
  return (
    <div class="pd-clk__c pd-clk__c--mid">
      {s.label ? <Label text={s.label} tw={s.tw} scale={s.scale} /> : null}
      <div class="pd-fl__row" role="img" aria-label={groups.join(':') + (ap ? ' ' + ap.text : '')}>
        {ap && ap.before ? apEl : null}
        {groups.map((g, i) => (
          <div key={i} class="pd-fl__grp" style={{ marginLeft: i ? gapW + 'px' : '0' }}>
            {splitDigits(g).map((d, j) => (
              <div key={j} style={{ marginLeft: j ? digitGap + 'px' : '0' }}>
                <FlipDigit ch={d} w={dw} h={ch} font={font} />
              </div>
            ))}
          </div>
        ))}
        {ap && !ap.before ? apEl : null}
      </div>
      {s.date ? <DateLine p={s.p} size={13} /> : null}
    </div>
  )
}

/* ---------- analog ---------- */

function Analog(s: Sub) {
  const showDate = s.date && s.th >= 200
  const dateH = showDate ? 26 : 0
  const d = Math.max(40, Math.floor(Math.min(s.tw - 16, s.th - 16 - dateH)))
  const sec = s.p.s
  const minA = s.p.m * 6 + sec * 0.1
  const hourA = (s.p.h % 12) * 30 + s.p.m * 0.5
  const aS = useUnwrapped(sec * 6)
  const aM = useUnwrapped(minA)
  const aH = useUnwrapped(hourA)
  const accent = s.color || 'var(--pd-accent)'
  const ticks = []
  const showMinorTicks = d >= 90
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0
    if (!major && !showMinorTicks) continue
    const a = (i * Math.PI) / 30
    const r1 = 47
    const r2 = major ? 41 : 44.5
    ticks.push(<line key={i} x1={50 + r1 * Math.sin(a)} y1={50 - r1 * Math.cos(a)} x2={50 + r2 * Math.sin(a)} y2={50 - r2 * Math.cos(a)} stroke={major ? 'rgba(139,139,148,0.95)' : 'rgba(139,139,148,0.45)'} stroke-width={major ? 1.6 : 0.7} stroke-linecap="round" />)
  }
  const anim = reducedMotion() ? 'none' : ''
  const hand = (cls: string, angle: number, len: number, w: number, color: string, trans: string, tail: number) => (
    <div class="pd-an__hand" style={{ height: d + 'px', width: w + 'px', marginLeft: -w / 2 + 'px', WebkitTransform: 'rotate(' + angle + 'deg)', transform: 'rotate(' + angle + 'deg)', transition: anim || trans, WebkitTransition: anim || trans }}>
      <i class={cls} style={{ top: (50 - len) + '%', bottom: 50 - tail + '%', background: color, borderRadius: w + 'px' }} />
    </div>
  )
  const secOn = s.secs
  return (
    <div class="pd-clk__c pd-clk__c--mid">
      <div class="pd-an__dial" style={{ width: d + 'px', height: d + 'px' }} role="img" aria-label={pad2(s.p.h) + ':' + pad2(s.p.m)}>
        <svg viewBox="0 0 100 100" width={d} height={d}>
          <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(139,139,148,0.28)" stroke-width="0.8" />
          {ticks}
        </svg>
        {hand('pd-an__h', aH, 26, Math.max(3, d * 0.035), 'var(--pd-text)', 'transform 0.4s ease-out', -6)}
        {hand('pd-an__m', aM, 38, Math.max(2, d * 0.025), 'var(--pd-text)', 'transform 0.4s ease-out', -6)}
        {secOn ? hand('pd-an__s', aS, 42, Math.max(1, d * 0.012), accent, 'transform 1s linear', -10) : null}
        <b class="pd-an__pin" style={{ background: secOn ? accent : 'var(--pd-text)' }} />
      </div>
      {showDate ? <DateLine p={s.p} size={13} /> : null}
    </div>
  )
}

/* ---------- world ---------- */

function World(s: Sub & { now: Date }) {
  const zones = (s.o.zones || []).slice(0, 4)
  const rowsAll: { name: string; p: Parts; tz?: string }[] = [{ name: s.o.label || (s.o.timeZone ? cityName(s.o.timeZone) : t('Local')), p: s.p, tz: s.o.timeZone }]
  zones.forEach((z) => rowsAll.push({ name: cityName(z), p: zoneParts(s.now, z), tz: z }))
  const pad = 10
  const rowMin = 24
  const maxRows = Math.max(1, Math.floor((s.th - pad * 2) / rowMin))
  const rows = rowsAll.slice(0, maxRows)
  const rowH = Math.min(46, Math.floor((s.th - pad * 2) / rows.length))
  const font = Math.max(12, Math.min(26, Math.floor(rowH * 0.5))) * Math.min(1.15, s.scale)
  const nameFont = Math.max(10, Math.min(15, Math.round(font * 0.6)))
  const base = dayNum(s.p)
  const narrow = s.tw < 150
  return (
    <div class="pd-clk__c pd-clk__c--mid pd-wd">
      {rows.map((r, i) => {
        const diff = dayNum(r.p) - base
        return (
          <div class="pd-wd__row" key={i} style={{ height: rowH + 'px' }}>
            <span class="pd-wd__n" style={{ fontSize: nameFont + 'px' }}>
              {r.name}
            </span>
            {diff !== 0 && i > 0 ? (
              <span class="pd-wd__off" style={{ fontSize: Math.max(9, nameFont - 3) + 'px' }}>
                {diff > 0 ? '+' + diff : String(diff)}
              </span>
            ) : null}
            <span class="pd-wd__t" style={{ fontSize: font + 'px', color: i === 0 ? undefined : tint(s.color || '', 0) || undefined }}>
              {!narrow && s.o.hour12 && ampmOf(r.p).before ? ampmOf(r.p).text + ' ' : ''}
              {pad2(s.o.hour12 ? hour12Of(r.p.h) : r.p.h) + ':' + pad2(r.p.m)}
              {!narrow && s.o.hour12 && !ampmOf(r.p).before ? ' ' + ampmOf(r.p).text : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ---------- shared bits of the newer styles ---------- */

const MONTH_LONG_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTH_LONG_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const MONTH_LONG_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const WEEKDAY_ZH_LONG = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
/** "Tháng 11 · 2026" / "2026年11月" / "November 2026" */
const monthYear = (p: Parts) => {
  const l = getLang()
  if (l === 'zh') return p.y + '年' + p.mo + '月'
  if (l === 'vi') return 'Tháng ' + p.mo + ' · ' + p.y
  if (l === 'fr') return MONTH_LONG_FR[p.mo - 1] + ' ' + p.y
  if (l === 'pt') return MONTH_LONG_PT[p.mo - 1] + ' ' + p.y
  return MONTH_LONG_EN[p.mo - 1] + ' ' + p.y
}
const weekdayOf = (p: Parts) => {
  const l = getLang()
  return l === 'zh' ? WEEKDAY_ZH_LONG[p.wd] : l === 'vi' ? WEEKDAY_VI[p.wd] : l === 'fr' ? WEEKDAY_FR[p.wd] : l === 'pt' ? WEEKDAY_PT[p.wd] : WEEKDAY_EN[p.wd]
}
const timeText = (s: Sub, withSecs: boolean) => pad2(s.hr) + ':' + pad2(s.p.m) + (withSecs ? ':' + pad2(s.p.s) : '')
const accentOf = (s: Sub) => s.color || 'var(--pd-accent)'
const lunarOf = (p: Parts) => lunarDay(p.y, p.mo, p.d, lunarLangOf(getLang()))

/**
 * Design rules for the newer faces (kn-visual): one primary (the time or the day number), ONE secondary text size per face, two
 * weights (light numbers, medium text), muted ink for everything secondary, the accent used once (the lunar date, the lit LED, the
 * ring arc, a holiday). The caption sits where the old faces put it: above the time on left-aligned faces (like digital on big tiles,
 * below it on small ones), centred above the face on centred ones (like flip). Lines are dropped when they do not fit, never cut.
 */

/** The one secondary text size of a face: 12 to 16 px (the type ladder) by tile height. */
const secondarySize = (th: number, scale: number) => Math.max(12, Math.min(16, Math.round(th * 0.07 * Math.min(1.15, scale))))
/** rough rendered width of `chars` characters at `size` px in the deck's sans */
const textW = (chars: number, size: number) => chars * size * 0.56

function Chip(props: { text: string; size: number; accent?: string }) {
  return (
    <span class={'pd-ck__chip' + (props.accent ? ' pd-ck__chip--accent' : '')} style={{ fontSize: props.size + 'px', color: props.accent || undefined }}>
      {props.text}
    </span>
  )
}

/** The time with seconds and AM/PM as a small trailing (or, in Chinese, leading) muted note. */
function TimeLine(props: { s: Sub; size: number }) {
  const s = props.s
  const small = Math.max(11, Math.round(props.size * 0.32))
  return (
    <div class="pd-ck__time" data-part="num" style={{ fontSize: props.size + 'px' }}>
      {apSpan(s, 'before', 'pd-ck__sec', { fontSize: small + 'px' })}
      {pad2(s.hr) + ':' + pad2(s.p.m)}
      {s.secs ? (
        <span class="pd-ck__sec" style={{ fontSize: small + 'px' }}>
          {pad2(s.p.s)}
        </span>
      ) : null}
      {apSpan(s, 'after', 'pd-ck__sec', { fontSize: small + 'px' })}
    </div>
  )
}

/** Characters the time line takes in digit widths (seconds and AM/PM are smaller). */
const timeChars = (s: Sub) => 5 + (s.secs ? 1.2 : 0) + (s.o.hour12 ? 1.4 : 0)

/* ---------- weather ---------- */

/**
 * weather: the time is the one primary; the weather is a single secondary row under it (glyph, temperature, condition, high / low),
 * left-aligned on the time's edge, then the date. Parts of the row drop from the right when the tile is narrow.
 * No data yet: a quiet muted "–°" in the same row, never an error.
 */
function WeatherClock(s: Sub) {
  const w = s.wx
  const pad = s.tw >= 240 ? 18 : 14
  const inner = s.tw - pad * 2
  const sub = secondarySize(s.th, s.scale)
  const glyph = w ? nightCond(condOf(w.cond), w.isDay, new Date(s.ms).getHours()) : 'cloudy'
  // the same sky and thin glyph as the weather tile (weather-tile.tsx); with no data yet, the sky of the hour
  const night = isNight(w ? w.isDay : undefined, s.ms)
  const kind = (w ? condOf(w.cond) : 'partly') as WxCond
  const sky = skyOf(kind, night)
  const cond = w ? condTextOf(glyph, s.ms) : ''
  const hl = w && (w.high !== undefined || w.low !== undefined) ? t('H {0}  L {1}', w.high !== undefined ? w.high + '°' : '–', w.low !== undefined ? w.low + '°' : '–') : ''
  const temp = w ? w.temp + '°' : '–°'
  const g = Math.round(sub * 1.35)
  // the row, dropping the high / low first, then the condition
  let room = inner - (w ? g + 6 : 0) - textW(temp.length, sub)
  const showCond = !!cond && room >= textW(cond.length + 2, sub)
  if (showCond) room -= textW(cond.length + 2, sub)
  const showHl = !!hl && showCond && room >= textW(hl.length + 2, sub)
  const labelTop = s.big && !!s.label
  const labelBottom = !s.big && !!s.label && s.th >= 120
  const rowH = Math.max(g, sub * 1.3) + 6
  const dateOn = s.date && s.th >= 110
  const availH = s.th - 20 - rowH - (dateOn ? sub * 1.3 + 4 : 0) - (labelTop || labelBottom ? 20 : 0)
  const tSize = Math.max(16, Math.floor(Math.min(availH * 0.95, inner / (timeChars(s) * 0.6)) * Math.min(1.15, s.scale)))
  return (
    <div class="pd-clk__c pd-ck pd-ckwx" style={{ padding: '0 ' + pad + 'px' }}>
      <div class={'pd-wx pd-wx--sky pd-wx--' + sky.kind}>
        <SkyLayer sky={sky} tw={s.tw} th={s.th} peek={true} />
      </div>
      {labelTop ? <Label text={s.label} tw={s.tw} scale={s.scale} /> : null}
      <TimeLine s={s} size={tSize} />
      <div class="pd-ck__wxr" style={{ fontSize: sub + 'px', marginTop: Math.round(tSize * 0.12) + 'px' }}>
        {w ? <WxLine name={glyphKey(kind, night)} size={g} class="pd-ckwx__g" /> : null}
        <span class={w ? 'pd-ck__temp' : 'pd-ck__wxnone'} data-part="num">
          {temp}
        </span>
        {showCond ? <span class="pd-ck__note">{cond}</span> : null}
        {showHl ? (
          <span class="pd-ck__note" data-part="num">
            {hl}
          </span>
        ) : null}
      </div>
      {dateOn ? <DateLine p={s.p} size={sub} /> : null}
      {labelBottom ? <Label text={s.label} tw={s.tw} scale={s.scale} /> : null}
    </div>
  )
}

/* ---------- lunar ---------- */

/**
 * lunar: the time is the one primary; under it up to three lines in one size: the solar date (muted), the lunar date (the one accent,
 * with the holiday in front of it) and the day's can chi (muted, plus the tiết khí when it fits). Lines drop from the bottom.
 */
function LunarClock(s: Sub) {
  const L = lunarOf(s.p)
  const pad = s.tw >= 240 ? 18 : 14
  const inner = s.tw - pad * 2
  const sub = secondarySize(s.th, s.scale)
  const lunarLine = (L.holiday ? L.holiday + ' · ' : '') + L.line
  const ccTerm = L.term ? L.canChi + ' · ' + L.term : L.canChi
  const canChi = textW(ccTerm.length, sub) <= inner ? ccTerm : L.canChi
  const lineH = sub * 1.35 + 2
  const labelOn = !!s.label && s.th >= 120
  // the time needs at least ~2.2 lines of height; lines drop until it has that
  const fixed = 20 + (labelOn ? 20 : 0)
  const want = [s.date || s.th >= 150, true, s.th >= 130 && textW(canChi.length, sub) <= inner]
  const lines: string[] = []
  if (want[0] && textW(dateText(s.p).length, sub) <= inner) lines.push('date')
  lines.push('lunar')
  if (want[2]) lines.push('cc')
  while (lines.length > 1 && s.th - fixed - lines.length * lineH < sub * 2.2) lines.splice(lines[0] === 'date' ? 0 : lines.length - 1, 1)
  const availH = s.th - fixed - lines.length * lineH
  const tSize = Math.max(16, Math.floor(Math.min(availH * 0.95, inner / (timeChars(s) * 0.6)) * Math.min(1.15, s.scale)))
  const lunarFits = textW(lunarLine.length, sub) <= inner
  return (
    <div class="pd-clk__c pd-ck" style={{ padding: '0 ' + pad + 'px' }}>
      {labelOn ? <Label text={s.label} tw={s.tw} scale={s.scale} /> : null}
      <TimeLine s={s} size={tSize} />
      <div style={{ marginTop: Math.round(tSize * 0.1) + 'px' }}>
        {lines.map((k) =>
          k === 'date' ? (
            <div key={k} class="pd-ck__sub" style={{ fontSize: sub + 'px' }}>
              {dateText(s.p)}
            </div>
          ) : k === 'lunar' ? (
            <div key={k} class="pd-ck__lun" style={{ fontSize: sub + 'px', color: accentOf(s) }}>
              {lunarFits ? lunarLine : L.line}
            </div>
          ) : (
            <div key={k} class="pd-ck__sub" style={{ fontSize: sub + 'px' }}>
              {canChi}
            </div>
          )
        )}
      </div>
    </div>
  )
}

/* ---------- bloc (lịch bloc, the tear-off wall calendar) ---------- */

/**
 * bloc: a well-set paper page. A quiet header (month and year in muted ink over a hairline, the caption on the right), one huge
 * day number (text ink; the accent only on Sundays and holidays, like the red pages), the weekday, then one calm row: the time and
 * the can chi in one small size on the left, the lunar day in the accent on the right. Sizes come from blocLayout (clock-logic.ts);
 * lines that do not fit are dropped, never truncated.
 */
function Bloc(s: Sub) {
  const L = lunarOf(s.p)
  const mode = blocMode(s.tw, s.th)
  const accent = accentOf(s)
  const red = s.p.wd === 0 || !!L.holiday
  const numColor = red ? accent : undefined
  if (mode === 'strip') {
    const n = Math.max(18, Math.floor(Math.min(s.th * 0.74, s.tw * 0.3)))
    const sub = Math.max(12, Math.min(16, Math.round(n * 0.3)))
    return (
      <div class="pd-bl pd-bl--strip">
        <span class="pd-bl__n" data-part="num" style={{ fontSize: n + 'px', color: numColor }}>
          {s.p.d}
        </span>
        <span class="pd-bl__sl" style={{ fontSize: sub + 'px' }}>
          <b data-part="num" style={{ color: accent }}>
            {L.dayText + '/' + L.lunar.month}
          </b>
          <i>{weekdayOf(s.p)}</i>
        </span>
      </div>
    )
  }
  const canChiParts = blocCanChi(L.yearName, L.monthName, L.dayName, getLang(), t)
  let ccChars = 0
  canChiParts.forEach((x) => {
    if (x.length > ccChars) ccChars = x.length
  })
  const lay = blocLayout(s.tw, s.th, !!L.holiday, L.luckyHours.length, ccChars, L.monthText.length)
  const chipText = L.holiday || L.term || ''
  return (
    <div class="pd-bl">
      <div class="pd-bl__head" style={{ height: lay.headH + 'px', fontSize: lay.headF + 'px', margin: '0 ' + lay.pad + 'px' }}>
        <span>{monthYear(s.p)}</span>
        {s.label ? <span class="pd-bl__hl">{s.label}</span> : null}
      </div>
      <div class="pd-bl__body" style={{ padding: lay.pad + 'px' }}>
        <div class="pd-bl__n" data-part="num" style={{ fontSize: lay.n + 'px', color: numColor }}>
          {s.p.d}
        </div>
        <div class="pd-bl__wd" style={{ fontSize: lay.wdF + 'px', color: numColor }}>
          {weekdayOf(s.p)}
        </div>
        {lay.chipF ? (
          <div class="pd-bl__chip" style={{ height: Math.ceil(lay.chipF * 1.3 + 12) + 'px' }}>
            {chipText ? <Chip text={chipText} size={lay.chipF} accent={L.holiday ? accent : undefined} /> : null}
          </div>
        ) : null}
        <div class="pd-bl__low" style={{ width: s.tw - lay.pad * 2 + 'px', fontSize: lay.small + 'px' }}>
          <div class="pd-bl__cc">
            <div class="pd-bl__t" data-part="num">
              {apSpan(s, 'before', 'pd-ck__sec')}
              {timeText(s, s.secs && s.tw >= 200)}
              {apSpan(s, 'after', 'pd-ck__sec')}
            </div>
            {lay.canChi
              ? canChiParts.map((x, i) => (
                  <div key={i}>{x}</div>
                ))
              : null}
          </div>
          <div class="pd-bl__lun">
            <div class="pd-bl__ln" data-part="num" style={{ fontSize: lay.lunN + 'px', color: accent }}>
              {L.dayText}
            </div>
            <div>{L.monthText}</div>
          </div>
        </div>
        {lay.hours ? (
          <div class="pd-bl__hours" style={{ fontSize: lay.hoursF + 'px' }}>
            <div class="pd-bl__ht">{t('Lucky hours')}</div>
            <div class="pd-bl__hg">
              {L.luckyHours.map((h, i) => (
                <span key={i} style={{ width: 100 / lay.perRow + '%' }}>
                  {h}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/* ---------- segment ---------- */

// segment polygons in a 60 x 100 box, 5 units thick with a 1 unit gap at each joint: a top, b top right, c bottom right, d bottom,
// e bottom left, f top left, g middle
const SEG_PATH = [
  '12,4 48,4 43,9 17,9',
  '51,7 51,46 46,43 46,12',
  '51,54 51,93 46,88 46,57',
  '12,96 48,96 43,91 17,91',
  '9,54 14,57 14,88 9,93',
  '9,7 14,12 14,43 9,46',
  '12,50 17,47.5 43,47.5 48,50 43,52.5 17,52.5',
]

/** One LED digit: lit segments in the accent, unlit ones a faint ghost of the text ink (no dark blocks). */
function SegDigit(props: { ch: string; w: number; on: string }) {
  const lit = segmentsOf(props.ch)
  return (
    <svg class="pd-sg__d" viewBox="0 0 60 100" width={props.w} height={Math.round((props.w * 100) / 60)} aria-hidden="true">
      {SEG_PATH.map((pts, i) => (
        <polygon key={i} points={pts} fill={lit[i] ? props.on : 'currentColor'} fill-opacity={lit[i] ? 1 : 0.045} />
      ))}
    </svg>
  )
}

function Segment(s: Sub) {
  const groups = [pad2(s.hr), pad2(s.p.m)]
  if (s.secs) groups.push(pad2(s.p.s))
  const digits = groups.length * 2
  const colons = groups.length - 1
  const sub = secondarySize(s.th, s.scale)
  const dateOn = s.date && s.th >= 110
  const labelOn = !!s.label && s.th >= 100
  const extraH = (dateOn ? sub * 1.3 + 8 : 0) + (labelOn ? 20 : 0)
  // a digit is 0.6 wide by 1 tall, a colon 0.3, the gap inside a group 0.08 (all in digit heights)
  const unitW = digits * 0.6 + colons * 0.3 + groups.length * 0.08 + (s.o.hour12 ? 0.5 : 0)
  const h = Math.max(18, Math.floor(Math.min((s.tw - 28) / unitW, (s.th - 24 - extraH) * 0.85)))
  const dw = Math.round(h * 0.6)
  const on = accentOf(s)
  const blink = reducedMotion() ? '' : ' pd-sg__col--blink'
  const dot = Math.max(3, Math.round(h * 0.075))
  const apStyle = { fontSize: Math.max(11, Math.round(h * 0.2)) + 'px', color: on }
  return (
    <div class="pd-clk__c pd-clk__c--mid">
      {labelOn ? <Label text={s.label} tw={s.tw} scale={s.scale} /> : null}
      <div class="pd-sg" role="img" aria-label={groups.join(':')} style={{ height: h + 'px' }}>
        {apSpan(s, 'before', 'pd-sg__ap', apStyle)}
        {groups.map((g, i) => (
          <div class="pd-sg__g" key={i}>
            {i ? (
              <span class={'pd-sg__col' + blink} style={{ width: Math.round(h * 0.3) + 'px', height: h + 'px' }}>
                <i style={{ width: dot + 'px', height: dot + 'px', top: Math.round(h * 0.32 - dot / 2) + 'px', marginLeft: -dot / 2 + 'px', background: on }} />
                <i style={{ width: dot + 'px', height: dot + 'px', top: Math.round(h * 0.68 - dot / 2) + 'px', marginLeft: -dot / 2 + 'px', background: on }} />
              </span>
            ) : null}
            <SegDigit ch={g.charAt(0)} w={dw} on={on} />
            <span style={{ width: Math.round(h * 0.08) + 'px' }} class="pd-sg__sp" />
            <SegDigit ch={g.charAt(1)} w={dw} on={on} />
          </div>
        ))}
        {apSpan(s, 'after', 'pd-sg__ap', apStyle)}
      </div>
      {dateOn ? <DateLine p={s.p} size={sub} /> : null}
    </div>
  )
}

/* ---------- ring ---------- */

/** One SVG arc 0..1 that starts at 12 o'clock. Rotated with the SVG transform attribute (CSS transforms on SVG are unreliable on Safari 12). */
function Arc(props: { r: number; w: number; frac: number; color: string; anim: boolean }) {
  const c = 2 * Math.PI * props.r
  const f = Math.max(0, Math.min(1, props.frac))
  const tr = props.anim ? 'stroke-dashoffset 1s linear' : 'none'
  return (
    <circle
      cx="50"
      cy="50"
      r={props.r}
      fill="none"
      stroke={props.color}
      stroke-width={props.w}
      stroke-linecap={f > 0 && f < 1 ? 'round' : 'butt'}
      stroke-dasharray={c + ' ' + c}
      stroke-dashoffset={c * (1 - f)}
      transform="rotate(-90 50 50)"
      style={{ transition: tr, WebkitTransition: tr }}
    />
  )
}

/**
 * ring: one thin ring filling with the seconds (minutes when seconds are off), its stroke lighter than the digits; the time inside,
 * the date under it in muted ink when there is room. The caption sits above the ring like the other centred faces.
 * The arc follows the clock: linear, as long as its tick (kn-motion: a bar that follows a clock), and no sweep back at the restart.
 */
function Ring(s: Sub) {
  const labelOn = !!s.label && s.th >= 140
  const d = Math.max(50, Math.floor(Math.min(s.tw - 20, s.th - 20 - (labelOn ? 22 : 0))))
  // the ring follows the seconds unless the option turns them off (not the size-based default, which hid them on small tiles)
  const pr = ringProgress(s.p.h, s.p.m, s.p.s, ringUsesSeconds(s.o.seconds))
  const anim = !reducedMotion() && pr.outer > 0.001
  const tSize = Math.max(14, Math.floor(Math.min((d * 0.66) / (timeChars(s) * 0.6), d * 0.26)))
  const sub = Math.max(12, Math.min(15, Math.round(d * 0.07)))
  const dateOn = s.date && d >= 150 && textW(dateText(s.p).length, sub) <= d * 0.66
  // stroke in viewBox units: about the weight of the light digits, never heavier
  const sw = Math.max(1.6, Math.min(2.6, (tSize * 0.09 * 100) / d))
  return (
    <div class="pd-clk__c pd-clk__c--mid">
      {labelOn ? <Label text={s.label} tw={s.tw} scale={s.scale} /> : null}
      <div class="pd-rg" style={{ width: d + 'px', height: d + 'px' }} role="img" aria-label={pad2(s.p.h) + ':' + pad2(s.p.m)}>
        <svg viewBox="0 0 100 100" width={d} height={d}>
          <circle cx="50" cy="50" r={48 - sw / 2} fill="none" stroke="currentColor" stroke-opacity="0.1" stroke-width={sw} />
          <Arc r={48 - sw / 2} w={sw} frac={pr.outer} color={accentOf(s)} anim={anim} />
        </svg>
        <div class="pd-rg__in">
          <div class="pd-ck__time" data-part="num" style={{ fontSize: tSize + 'px' }}>
            {apSpan(s, 'before', 'pd-ck__sec', { fontSize: Math.max(11, Math.round(tSize * 0.3)) + 'px' })}
            {pad2(s.hr) + ':' + pad2(s.p.m)}
            {apSpan(s, 'after', 'pd-ck__sec', { fontSize: Math.max(11, Math.round(tSize * 0.3)) + 'px' })}
          </div>
          {dateOn ? (
            <div class="pd-ck__sub" style={{ fontSize: sub + 'px' }}>
              {dateText(s.p)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ---------- stack ---------- */

/**
 * stack: hours over minutes in one ink and one light weight, as large as the tile allows; seconds and AM/PM are small muted notes
 * hung beside the digits (like digital's superscript), the date one muted line under them. Made for upright tiles.
 */
function Stack(s: Sub) {
  const sub = secondarySize(s.th, s.scale)
  const labelOn = !!s.label && s.th >= 140
  const dateOn = s.date && s.th >= 160
  const extra = (dateOn ? sub * 1.3 + 8 : 0) + (labelOn ? 20 : 0)
  const side = s.secs || s.o.hour12
  // two lines of two digits (line box 0.88 em, two digits ~1.15 em wide); notes hang beside, so a centred block keeps room both sides
  const size = Math.max(16, Math.floor(Math.min((s.th - 20 - extra) / 1.8, (s.tw - 24) / (side ? 1.85 : 1.2))))
  const note = { fontSize: Math.max(11, Math.round(size * 0.2)) + 'px' }
  return (
    <div class="pd-clk__c pd-clk__c--mid pd-st">
      {labelOn ? <Label text={s.label} tw={s.tw} scale={s.scale} /> : null}
      <div class="pd-st__n" data-part="num" style={{ fontSize: size + 'px' }}>
        {apSpan(s, 'before', 'pd-st__ap pd-st__ap--pre', note)}
        {pad2(s.hr)}
        {apSpan(s, 'after', 'pd-st__ap', note)}
      </div>
      <div class="pd-st__n" data-part="num" style={{ fontSize: size + 'px' }}>
        {pad2(s.p.m)}
        {s.secs ? (
          <span class="pd-st__s" style={note}>
            {pad2(s.p.s)}
          </span>
        ) : null}
      </div>
      {dateOn ? <DateLine p={s.p} size={sub} /> : null}
    </div>
  )
}

/* ---------- ticks ---------- */

/** The tile's inner box (inside its border) and its inner corner radius; null until measured. */
interface TileBox {
  w: number
  h: number
  r: number
}

/**
 * Measures the tile the clock sits in (its offsetParent, the positioned .pd-tile): inner size and corner radius, so the ticks follow
 * whatever rounded rectangle the theme gives the tile (radius 0 to 40, the small-screen 12 px). Re-read each render (once a second,
 * cheap) and only stored when it changed.
 */
function useTileBox(ref: { current: HTMLElement | null }, tw: number, th: number): TileBox | null {
  const [box, setBox] = useState<TileBox | null>(null)
  useEffect(() => {
    const el = ref.current
    const tile = el ? (el.offsetParent as HTMLElement | null) : null
    // only a parent about the tile's size counts (a preview may sit in some other positioned box): else tw x th is used
    if (!tile || !tile.clientWidth || Math.abs(tile.clientWidth - tw) > 24 || Math.abs(tile.clientHeight - th) > 24) {
      if (box) setBox(null)
      return
    }
    let r = 16
    let b = 1
    try {
      const cs = window.getComputedStyle(tile)
      r = parseFloat(cs.borderTopLeftRadius) || 0
      b = parseFloat(cs.borderTopWidth) || 0
    } catch (e) {
      // keep the defaults
    }
    const next = { w: tile.clientWidth, h: tile.clientHeight, r: Math.max(0, r - b) }
    if (!box || box.w !== next.w || box.h !== next.h || box.r !== next.r) setBox(next)
  })
  return box
}

/**
 * ticks: 60 short marks running round the tile's own rounded outline (geometry in tickRing, clock-logic.ts), lit in text ink up to the
 * current second (the minute when seconds are off), the 15 after it fading to a faint rest, every fifth a little longer; a big tall
 * condensed bold time in the middle, the caption above it and the date under it when they fit. Motion (kn-motion): only the newly lit
 * tick fades in, linear over its one second like the ring's arc; the reset at the top of the minute and the first render are instant;
 * reduced motion = none. The colon blinks with the seconds only when the seconds are off (and not with reduced motion).
 */
function Ticks(s: Sub) {
  const ref = useRef<HTMLDivElement>(null)
  const box = useTileBox(ref, s.tw, s.th)
  // before the first measure: the tile's size inside a 1 px border and the default 16 px radius
  const W = box ? box.w : s.tw - 2
  const H = box ? box.h : s.th - 2
  const R = box ? box.r : 15
  const m = Math.min(W, H)
  const inset = Math.max(5, Math.round(m * 0.035))
  const len = Math.max(4, Math.round(m * 0.034))
  const lenMajor = Math.round(len * 1.5)
  const sw = Math.max(1.5, Math.min(3, Math.round(m * 0.009 * 2) / 2))
  const ticks = tickRing(W, H, R, inset, len, lenMajor)
  const useSecs = ringUsesSeconds(s.o.seconds)
  const cur = useSecs ? s.p.s : s.p.m
  const still = reducedMotion()
  // the content box keeps clear of the longest ticks; the tile already pads 8 px and has its 1 px border
  const clear = inset + lenMajor + Math.max(6, Math.round(m * 0.03))
  const padX = Math.max(0, clear - 9)
  const innerW = W - clear * 2
  const innerH = H - clear * 2
  const sub = Math.max(12, Math.min(16, Math.round(m * 0.055 * Math.min(1.15, s.scale))))
  const ap = s.o.hour12 ? ampmOf(s.p) : null
  // a condensed bold digit is ~0.5 em wide, the colon ~0.25; 2.6 em leaves room for a wider fallback face; AM/PM adds ~0.9 em
  const wide = 2.6 + (ap ? 0.9 : 0)
  let labelOn = !!s.label && innerH >= 90 && innerW >= 60
  let dateOn = s.date && innerH >= 110 && textW(dateText(s.p).length, sub) <= innerW
  const sizeFor = () => Math.floor(Math.min(innerW / wide, (innerH - (labelOn ? 20 : 0) - (dateOn ? sub * 1.3 + 6 : 0)) * 0.92))
  // the extra lines go (date first) when they would leave the time too small to be the face
  if (dateOn && sizeFor() < innerH * 0.42) dateOn = false
  if (labelOn && sizeFor() < innerH * 0.42) labelOn = false
  const size = Math.max(14, sizeFor())
  const blink = !useSecs && !still && s.p.s % 2 === 1
  const apEl = ap ? (
    <span class={'pd-tck__ap' + (ap.before ? ' pd-ck__pre' : '')} style={{ fontSize: Math.max(11, Math.round(size * 0.2)) + 'px' }}>
      {ap.text}
    </span>
  ) : null
  return (
    <div class="pd-clk__c pd-clk__c--mid pd-tck" ref={ref} style={{ padding: '0 ' + padX + 'px' }}>
      <svg class="pd-tck__ring" width={W} height={H} viewBox={'0 0 ' + W + ' ' + H} aria-hidden="true">
        {ticks.map((k, i) => (
          <line
            key={i}
            class={i === cur && !still ? 'pd-tck__i pd-tck__i--new' : 'pd-tck__i'}
            x1={k.x}
            y1={k.y}
            x2={k.x2}
            y2={k.y2}
            stroke="currentColor"
            stroke-width={sw}
            stroke-linecap="round"
            style={{ opacity: tickOpacity(i, cur) }}
          />
        ))}
      </svg>
      {labelOn ? <Label text={s.label} tw={innerW + 28} scale={s.scale} /> : null}
      <div class="pd-tck__t" role="img" aria-label={pad2(s.hr) + ':' + pad2(s.p.m) + (ap ? ' ' + ap.text : '')} style={{ fontSize: size + 'px' }}>
        {ap && ap.before ? apEl : null}
        {pad2(s.hr)}
        <span class={'pd-tck__col' + (blink ? ' pd-tck__col--off' : '')}>:</span>
        {pad2(s.p.m)}
        {ap && !ap.before ? apEl : null}
      </div>
      {dateOn ? <DateLine p={s.p} size={sub} /> : null}
    </div>
  )
}

/* ---------- dither ---------- */

/** One scramble lasts this long (ms): kn-motion travel, a digit that changes. Frames every SCRAMBLE_STEP ms, only while one runs. */
const SCRAMBLE_MS = 420
const SCRAMBLE_STEP = 70

interface Settle {
  box: { c0: number; r0: number; c1: number; r1: number }
  start: number
}

/**
 * dither: the whole tile is a monospace character grid (dither-logic.ts). The time is drawn from a 5 x 7 bitmap font as coverage,
 * dithered into the ramp " .:-=+*#%@" with a 4 x 4 Bayer matrix, so the digits have soft dithered edges; background cells carry a
 * faint sparse noise. Seconds and AM/PM are small glyphs beside the time (dropped or moved to the top text row when too small); the
 * caption is the top text row and the date the bottom one, in the same font.
 * Motion (kn-motion): a changed hour or minute digit resolves from noise to the new digit over 420 ms (frames only while that runs,
 * only that digit's cells change); the seconds digits change in place (they change every second); the background shimmers on the
 * clock's own one-second render, about a sixth of its marks re-rolling. Nothing plays on the first render, with reduced motion
 * (no scramble, no shimmer) or while the page is hidden. The glyph layer is only rebuilt when the text or the tile size changes.
 */
function Dither(s: Sub) {
  const ref = useRef<HTMLDivElement>(null)
  const box = useTileBox(ref, s.tw, s.th)
  const W = box ? box.w : s.tw - 2
  const H = box ? box.h : s.th - 2
  const ap = s.o.hour12 ? ampmOf(s.p).text : ''
  const inp = { hh: pad2(s.hr), mm: pad2(s.p.m), ss: s.secs ? pad2(s.p.s) : '', ap: ap, label: s.label ? s.label.toUpperCase() : '', date: s.date ? dateText(s.p) : '' }
  const key = W + 'x' + H + '|' + inp.hh + inp.mm + '|' + inp.ss + '|' + inp.ap + '|' + inp.label + '|' + inp.date
  const L = useMemo(() => ditherLayout(W, H, inp), [key])
  const layer = useMemo(() => glyphLayer(L), [L])
  const still = reducedMotion()
  const seed = 7 + Math.round(W) * 131 + Math.round(H)
  const tick = still ? 0 : Math.floor(s.ms / 1000)
  const grid = useMemo(() => fillNoise(layer, seed, tick), [layer, seed, tick])
  // which main digits changed since the last layout: those cells settle from noise (decided during render so no frame shows the end state first)
  const prev = useRef<DitherLayout | null>(null)
  const settles = useRef<Settle[]>([])
  if (prev.current !== L) {
    const old = prev.current
    const hidden = typeof document !== 'undefined' && !!document.hidden
    if (old && !still && !hidden && old.mode === L.mode && old.cols === L.cols && old.rows === L.rows) {
      const now = Date.now()
      L.glyphs.forEach((g) => {
        if (g.part !== 'main') return
        let was = ''
        old.glyphs.forEach((o) => {
          if (o.part === 'main' && o.idx === g.idx) was = o.ch
        })
        if (was && was !== g.ch) settles.current.push({ box: glyphCells(L, g), start: now })
      })
    } else settles.current = []
    prev.current = L
  }
  const [frame, setFrame] = useState(0)
  const now = Date.now()
  settles.current = settles.current.filter((x) => now - x.start < SCRAMBLE_MS)
  const active = settles.current.length > 0
  useEffect(() => {
    if (!active) return
    const t = window.setTimeout(() => setFrame((f) => f + 1), SCRAMBLE_STEP)
    return () => clearTimeout(t)
  })
  let shown = grid
  settles.current.forEach((x) => {
    shown = scramble(shown, x.box, (now - x.start) / SCRAMBLE_MS, frame, seed)
  })
  const label = pad2(s.hr) + ':' + pad2(s.p.m) + (inp.ss ? ':' + inp.ss : '') + (ap ? ' ' + ap : '')
  return (
    <div class="pd-clk__c pd-dt" ref={ref}>
      <pre class="pd-dt__g" role="img" aria-label={label} style={{ fontSize: L.f + 'px', lineHeight: L.cellH + 'px', left: L.offX + 'px', top: L.offY + 'px', width: L.cols * L.cellW + 'px', height: L.rows * L.cellH + 'px' }}>
        {shown.chars.map((row, r) => (
          <div key={r} class="pd-dt__r">
            {runsOf(row, shown.kinds[r]).map((run, i) => (
              <span key={i} class={'pd-dt__k' + run.k} style={(run.k === '1' || run.k === '3') && s.color ? { color: s.color } : undefined}>
                {run.t}
              </span>
            ))}
          </div>
        ))}
      </pre>
    </div>
  )
}
