import { t } from './i18n'
import { condOf, hourLabel, relTime, useTick, weekdayOf, condTextOf } from './automation'
import { convTemp, tempUnit } from './temp'
import type { IconAssets, WeatherData, WeatherOptions } from './types'
import {
  aqiBand,
  chartBox,
  detailRows,
  fitCount,
  hlFit,
  pillFit,
  heroTempFit,
  tinyStack,
  slotFit,
  tallRows,
  tempW,
  textW,
  hasRain,
  isNight,
  linePoints,
  normWeather,
  pointsAttr,
  rainBars,
  rainText,
  rangeOf,
  skyOf,
  windArrowDeg,
  windUnitOf,
  wxFace,
  type Sky,
  type WxCond,
} from './weather-logic'
import './weather.css'

// ---------------- line glyphs ----------------
// Outline paths from Tabler Icons (MIT), drawn thin like a weather card; partly cloudy and cloud with moon are composed from them.

const CLOUD_B = 'M7 18a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7'
const SUN_P = ['M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0', 'M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7']
const MOON_P = ['M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008']
const GLYPH: { [k: string]: string[] } = {
  sun: SUN_P,
  moon: MOON_P,
  cloud: ['M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 1.927 -1.551 3.487 -3.465 3.487h-11.878'],
  rain: [CLOUD_B, 'M11 13v2m0 3v2m4 -5v2m0 3v2'],
  pour: [CLOUD_B, 'M9 13v2m0 3v2m4 -7v2m0 3v2m4 -7v2m0 3v2'],
  storm: [CLOUD_B + 'h-1', 'M13 14l-2 4l3 0l-2 4'],
  hail: [CLOUD_B, 'M11 15v.01m0 3v.01m0 3v.01m4 -4v.01m0 3v.01'],
  snow: ['M10 4l2 1l2 -1', 'M12 2v6.5l3 1.72', 'M17.928 6.268l.134 2.232l1.866 1.232', 'M20.66 7l-5.629 3.25l.01 3.458', 'M19.928 14.268l-1.866 1.232l-.134 2.232', 'M20.66 17l-5.629 -3.25l-2.99 1.738', 'M14 20l-2 -1l-2 1', 'M12 22v-6.5l-3 -1.72', 'M6.072 17.732l-.134 -2.232l-1.866 -1.232', 'M3.34 17l5.629 -3.25l-.01 -3.458', 'M4.072 9.732l1.866 -1.232l.134 -2.232', 'M3.34 7l5.629 3.25l2.99 -1.738'],
  fog: ['M7 16a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7h-12', 'M5 20l14 0'],
  wind: ['M5 8h8.5a2.5 2.5 0 1 0 -2.34 -3.24', 'M3 12h15.5a2.5 2.5 0 1 1 -2.34 3.24', 'M4 16h5.5a2.5 2.5 0 1 1 -2.34 3.24'],
  pin: ['M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0', 'M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0'],
  drop: ['M7.502 19.423c2.602 2.105 6.395 2.105 8.996 0c2.602 -2.105 3.262 -5.708 1.566 -8.546l-4.89 -7.26c-.42 -.625 -1.287 -.803 -1.936 -.397a1.376 1.376 0 0 0 -.41 .397l-4.893 7.26c-1.695 2.838 -1.035 6.441 1.567 8.546'],
  feels: ['M10 13.5a4 4 0 1 0 4 0v-8.5a2 2 0 0 0 -4 0v8.5', 'M10 9l4 0'],
  uv: ['M3 12h1m16 0h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7m-9.7 5.7a4 4 0 1 1 8 0', 'M12 4v-1', 'M13 16l2 5h1l2 -5', 'M6 16v3a2 2 0 1 0 4 0v-3'],
  arrow: ['M12 5l0 14', 'M16 9l-4 -4', 'M8 9l4 -4'],
}
/** a small sun (or moon) up left with the cloud in front, lower right; the cloud body is cut where it would cross the disc */
const COMBO_CLOUD = 'M9.6 20.5a3.7 3.5 0 0 1 0 -7.2a4 3.6 0 0 1 8.8 1.6h.8a2.8 2.8 0 0 1 0 5.6z'

/** The line glyph name for a condition key (condOf) by day or night; the weather clock uses it too. */
export const glyphKey = (c: WxCond, night: boolean): string => {
  if (c === 'clear' || c === 'night') return night ? 'moon' : 'sun'
  if (c === 'partly') return night ? 'cloud-moon' : 'cloud-sun'
  if (c === 'cloudy') return 'cloud'
  return c
}

/** A thin line weather glyph (white ink on the sky). `px` is the stroke in screen pixels, whatever the size. */
export function WxLine(props: { name: string; size: number; px?: number; class?: string }) {
  const s = props.size
  const sw = Math.round(((props.px || (s >= 40 ? 1.6 : 1.5)) * 24 * 100) / s) / 100
  const p = (d: string, i: number) => <path key={i} d={d} />
  let inner: any
  if (props.name === 'cloud-sun' || props.name === 'cloud-moon') {
    const disc = props.name === 'cloud-sun' ? SUN_P : MOON_P
    // the small disc keeps the same screen stroke: its group is scaled, so its stroke is widened by the same factor
    inner = (
      <>
        <g transform="translate(0.6 0.6) scale(0.6)" stroke-width={Math.round((sw / 0.6) * 100) / 100}>{disc.map(p)}</g>
        <path d={COMBO_CLOUD} />
      </>
    )
  } else inner = (GLYPH[props.name] || GLYPH.cloud).map(p)
  return (
    <svg class={'pd-wx__ln' + (props.class ? ' ' + props.class : '')} width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {inner}
    </svg>
  )
}

// ---------------- sky ----------------

/** stars at fixed spots (left %, top %, px), so a re-render never moves them */
const STARS: [number, number, number][] = [[7, 22, 2], [19, 74, 1.5], [33, 12, 1.5], [46, 58, 2], [58, 30, 1.5], [71, 82, 1.5], [84, 46, 2], [92, 16, 1.5]]

/**
 * `moonRight`: px from the right edge (default near the corner). `peek`: only the lower part of the disc shows below the top edge, so it
 * stays in the padding above the text (faces whose header runs the full width).
 */
export function SkyLayer(props: { sky: Sky; tw: number; th: number; moonRight?: number; peek?: boolean }) {
  const sky = props.sky
  const tw = props.tw
  const th = props.th
  const els: any[] = []
  if (sky.arcs) {
    const r0 = Math.max(tw, th) * 0.42
    const k = [2.2, 1.6, 1.05, 0.6]
    for (let i = 0; i < k.length; i++) {
      const r = Math.round(r0 * k[i])
      els.push(<i key={'a' + i} class={'pd-wx__arc' + (sky.arcs === 1 ? ' pd-wx__arc--faint' : '')} style={{ width: r * 2 + 'px', height: r * 2 + 'px', top: -r + 'px', right: -r + 'px' }} />)
    }
  }
  if (sky.stars) {
    for (let i = 0; i < STARS.length; i++) {
      const s = STARS[i]
      els.push(<i key={'s' + i} class="pd-wx__star" style={{ left: s[0] + '%', top: s[1] + '%', width: s[2] + 'px', height: s[2] + 'px' }} />)
    }
  }
  if (sky.moon) {
    const m = props.peek ? Math.round(Math.max(30, Math.min(tw * 0.18, 76))) : Math.round(Math.max(26, Math.min(th * 0.5, tw * 0.3, 120)))
    const right = props.moonRight !== undefined ? props.moonRight : Math.round(m * 0.1)
    const top = -Math.round(m * (props.peek ? 0.62 : 0.3))
    const halo = Math.round(m * 1.9)
    els.push(<i key="h" class="pd-wx__halo" style={{ width: halo + 'px', height: halo + 'px', top: top - (halo - m) / 2 + 'px', right: right - (halo - m) / 2 + 'px', opacity: sky.moon === 1 ? 0.5 : 1 }} />)
    // a crescent: an empty disc whose inset shadow is the lit part
    els.push(<i key="m" class="pd-wx__moon" style={{ width: m + 'px', height: m + 'px', top: top + 'px', right: right + 'px', boxShadow: 'inset ' + Math.round(m * 0.24) + 'px ' + -Math.round(m * 0.16) + 'px 0 0 #fbe7a7', opacity: sky.moon === 1 ? 0.5 : 0.95 }} />)
  }
  return (
    <span class="pd-wx__sky" aria-hidden="true">
      {els}
    </span>
  )
}

// ---------------- tile ----------------

export interface WeatherProps {
  opts?: WeatherOptions
  data?: WeatherData
  tw: number
  th: number
  /** grid span of the tile in cells; the face is picked from it first */
  cw?: number
  ch?: number
  scale: number
  showLabel: boolean
  textColor?: string
  assets?: IconAssets
}

const SOURCE_NAME: { [k: string]: string } = { hass: 'Home Assistant', 'open-meteo': 'Open-Meteo' }

/**
 * The weather card. The tile owns its sky (condition and day or night), so it looks the same on both deck themes; ink is white.
 * Faces (weather-logic wxFace): tiny 1x1, row 2x1, card 2x2, wide 3x1 / 4x1, hero 3x2 / 4x2, full 3x3 and up, tall 1xN / 2x3.
 */
export function WeatherTile(props: WeatherProps) {
  const now = useTick(30000)
  const tw = props.tw
  const th = props.th
  const v = normWeather(props.data, now)
  const cw = props.cw || Math.max(1, Math.round(tw / 140))
  const ch = props.ch || Math.max(1, Math.round(th / 140))
  const face = wxFace(cw, ch, tw, th, props.opts && props.opts.show, !!(v && v.hourly.length), !!(v && v.daily.length > 1))
  const mode = face.mode
  const pad = mode === 'hero' || mode === 'full' ? (tw >= 300 ? 16 : 14) : tw >= 170 ? 14 : 10
  // one-row tiles keep a thinner top and bottom so the forecast labels fit
  const vpad = (mode === 'row' || mode === 'wide') && th < 100 ? 7 : pad
  const W = tw - pad * 2
  const H = th - vpad * 2

  if (!v) {
    const sky = skyOf('partly', isNight(undefined, now))
    return (
      <div class={'pd-wx pd-wx--sky pd-wx--' + sky.kind + ' pd-wx--empty'}>
        <SkyLayer sky={sky} tw={tw} th={th} />
        <div class="pd-wx__in pd-wx__in--c" style={{ padding: pad + 'px' }}>
          <span class="pd-wx__quiet">{t('Loading weather…')}</span>
        </div>
      </div>
    )
  }

  const toU: 'C' | 'F' = props.opts && props.opts.units ? (props.opts.units === 'imperial' ? 'F' : 'C') : tempUnit()
  const fromU: 'C' | 'F' = v.unit ? v.unit : v.source === 'open-meteo' ? toU : 'C'
  const n = (x: number) => Math.round(convTemp(x, fromU, toU))
  const deg = (x: number | undefined) => (typeof x === 'number' && isFinite(x) ? n(x) + '°' : '–')
  const night = isNight(v.isDay, now)
  const c0 = condOf(v.cond) as WxCond
  const sky = skyOf(c0, night)
  const condText = v.text || condTextOf(v.cond, now)
  const ageMin = v.updatedAt ? Math.round((now - v.updatedAt) / 60000) : 0
  const stale = ageMin > 45
  const hl = v.high !== undefined || v.low !== undefined ? t('H {0}  L {1}', deg(v.high), deg(v.low)) : ''
  /** "25/33°": the short high / low for tight rows */
  const hlShort = v.high !== undefined && v.low !== undefined ? n(v.low) + '/' + n(v.high) + '°' : ''
  const glyph = (c: string | number, size: number, isNightNow: boolean, cls?: string) => <WxLine name={glyphKey(condOf(c) as WxCond, isNightNow)} size={size} class={cls} />
  const nightAt = (ms: number) => isNight(undefined, ms)

  /** the big number with a raised, smaller degree sign */
  const temp = (size: number, cls?: string) => (
    <span class={'pd-wx__t' + (cls ? ' ' + cls : '')} data-part="num" style={{ fontSize: size + 'px' }}>
      {Math.abs(n(v.temp)) < 0.5 ? 0 : n(v.temp)}
      <span class="pd-wx__dg">°</span>
    </span>
  )
  // the place pill shrinks one step, then wraps to two lines, before it ellipses (pillFit)
  const pill = (max: number) => {
    if (!v.place) return null
    const f = pillFit(v.place, max)
    return (
      <span class={'pd-wx__pill' + (f.lines === 2 ? ' pd-wx__pill--2' : '')} style={{ maxWidth: max + 'px' }}>
        <WxLine name="pin" size={12} px={1.6} />
        <span class="pd-wx__pt" style={f.px === 12 ? undefined : { fontSize: f.px + 'px' }}>{v.place}</span>
      </span>
    )
  }
  const pillH = (max: number) => (v.place ? pillFit(v.place, max).h : 22)
  const aqi = (small?: boolean) => {
    if (typeof v.aqi !== 'number') return null
    const b = aqiBand(v.aqi)
    return (
      <span class={'pd-wx__aqi' + (small ? ' pd-wx__aqi--s' : '')} style={{ background: b.bg, color: b.ink }} title={t('Air quality')}>
        <b data-part="num">{Math.round(v.aqi)}</b>
        {small ? null : ' ' + t(b.label)}
      </span>
    )
  }
  const wind = () => {
    if (typeof v.wind !== 'number') return null
    return (
      <span class="pd-wx__wind">
        {typeof v.windDir === 'number' ? (
          <span class="pd-wx__arw" style={{ WebkitTransform: 'rotate(' + windArrowDeg(v.windDir) + 'deg)', transform: 'rotate(' + windArrowDeg(v.windDir) + 'deg)' }}>
            <WxLine name="arrow" size={12} px={1.8} />
          </span>
        ) : null}
        <span data-part="num">{Math.round(v.wind) + ' ' + windUnitOf(v)}</span>
      </span>
    )
  }
  const staleEl = stale ? <span class="pd-wx__age">{t('Updated {0}', relTime(v.updatedAt as number, now))}</span> : null
  const dayName = (ms: number, i: number) => (i === 0 ? t('Today') : weekdayOf(ms))

  let body: any = null
  let moonRight: number | undefined
  let peek = false

  if (mode === 'tiny') {
    // upright (1x2): the condition and the high / low stacked under the number when the height has room
    const st = tinyStack(W, H, n(v.temp))
    const hlt = st.hl ? hlFit(W, hl, hlShort, 12) : ''
    body = (
      <div class="pd-wx__in pd-wx__in--c" style={{ padding: pad + 'px' }}>
        {glyph(v.cond, st.gl, night)}
        {temp(st.ts, 'pd-wx__t--tiny')}
        {st.cond ? <span class="pd-wx__cond pd-wx__cond--n pd-wx__cond--tiny">{condText}</span> : null}
        {hlt ? <span class="pd-wx__sub" data-part="num">{hlt}</span> : null}
      </div>
    )
  } else if (mode === 'row') {
    const gl = Math.round(Math.max(24, Math.min(46, H * 0.5)))
    const ts = Math.round(Math.max(26, Math.min(H * 0.7, W * 0.22, 60)))
    const hlr = hlFit(W - gl - 10 - tempW(n(v.temp), ts) - 12, hl, hlShort, 12)
    body = (
      <div class="pd-wx__in pd-wx__in--row" style={{ padding: vpad + 'px ' + pad + 'px' }}>
        {glyph(v.cond, gl, night, 'pd-wx__gl')}
        {temp(ts)}
        <span class="pd-wx__col">
          <span class="pd-wx__cond">{condText}</span>
          {hlr ? <span class="pd-wx__sub" data-part="num">{hlr}</span> : null}
          {staleEl}
        </span>
      </div>
    )
  } else if (mode === 'card') {
    // the place wins the top row; the AQI chip (number only, the band colour says the rest) sits by H/L, or top right with no place
    const showAqi = typeof v.aqi === 'number' && (H >= 120 || W >= 150)
    const aqiTop = showAqi && !v.place
    const top = v.place ? pillH(W) + 2 : aqiTop ? 24 : 0
    const ts = Math.round(Math.max(30, Math.min((H - top) * 0.42, W * 0.36, 84)))
    const gl = Math.round(Math.max(26, Math.min(ts * 0.72, 56)))
    const hlc = hlFit(W - (showAqi && !aqiTop ? 44 : 0), hl, hlShort, 12)
    body = (
      <div class="pd-wx__in" style={{ padding: pad + 'px' }}>
        {top ? (
          <div class="pd-wx__top" style={top > 24 ? { height: top - 2 + 'px' } : undefined}>
            {pill(W)}
            <span class="pd-wx__sp" />
            {aqiTop ? aqi(true) : null}
          </div>
        ) : null}
        <div class="pd-wx__main">
          {glyph(v.cond, gl, night, 'pd-wx__gl')}
          {temp(ts)}
        </div>
        <div class="pd-wx__foot">
          <span class="pd-wx__cond">{condText}</span>
          {hlc || (showAqi && !aqiTop) ? (
            <span class="pd-wx__hrow">
              {hlc ? <span class="pd-wx__sub" data-part="num">{hlc}</span> : null}
              {showAqi && !aqiTop ? aqi(true) : null}
            </span>
          ) : null}
          {staleEl}
        </div>
      </div>
    )
  } else if (mode === 'wide' || mode === 'hero') {
    const hero = mode === 'hero'
    // the forecast column on the right: hours from now, or the days from tomorrow
    const hours = face.series === 'hourly'
    const list: { ms: number; cond: string | number; a: string; b?: string }[] = hours
      ? v.hourly.map((h) => ({ ms: h.ms, cond: h.cond, a: deg(h.temp) }))
      : v.daily.slice(1).map((d) => ({ ms: d.ms, cond: d.cond, a: deg(d.low).replace('°', '') + '/' + deg(d.high) }))
    // wide: the current part takes what its words need, the forecast fills the rest (hours or days, as many as fit)
    const wGl = Math.round(Math.max(24, Math.min(44, H * 0.5)))
    const wTs = Math.round(Math.max(28, Math.min(H * 0.62, 64)))
    const wText = Math.max(Math.min(textW(condText, 13), 96), textW(hlShort || '00/00°', 12))
    const wNeed = (glyphIn: boolean) => (glyphIn ? wGl + 10 : 0) + tempW(n(v.temp), wTs) + 12 + wText
    const colMin = hero ? (hours ? 50 : 76) : hours ? 46 : 52
    let wGlyph = true
    let asideMax = hero ? Math.round(W * 0.4) : Math.round(W - wNeed(true) - 17)
    if (!hero && face.forecast && asideMax < colMin * 2) {
      // the forecast column has the glyphs, so the current one gives its room first
      wGlyph = false
      asideMax = Math.round(W - wNeed(false) - 17)
    }
    const cols = face.forecast && list.length && asideMax >= colMin ? fitCount(asideMax, colMin, list.length, 1, hero ? 3 : 6) : 0
    const asideW = cols ? Math.min(asideMax, cols * (hero ? (hours ? 58 : 92) : hours ? 56 : 64)) : 0
    const mainW = W - (asideW ? asideW + 17 : 0)
    moonRight = asideW ? asideW + pad + 24 : undefined
    peek = !hero
    // a slot never clips: the label row goes before the glyph gets too small
    const slot = hero ? { label: true, glyph: Math.round(Math.max(24, Math.min(40, H * 0.3))) } : slotFit(H, 30)
    const aside = cols ? (
      <div class="pd-wx__aside" style={{ width: asideW + 'px' }}>
        {list.slice(0, cols).map((x, i) => (
          <span class="pd-wx__fc" key={i}>
            {slot.label ? <span class="pd-wx__fn">{hours ? (i === 0 ? t('Now') : hourLabel(x.ms)) : weekdayOf(x.ms)}</span> : null}
            {glyph(x.cond, slot.glyph, hours ? nightAt(x.ms) : false)}
            <span class="pd-wx__fv" data-part="num">{x.a}</span>
          </span>
        ))}
      </div>
    ) : null
    if (!hero) {
      const gl = wGl
      const ts = Math.min(wTs, Math.round(Math.max(28, mainW * 0.24)))
      const noGlyph = !wGlyph
      const hlw = hlFit(mainW - (noGlyph ? 0 : gl + 10) - tempW(n(v.temp), ts) - 12, hl, hlShort, 12)
      body = (
        <div class="pd-wx__in pd-wx__in--row" style={{ padding: vpad + 'px ' + pad + 'px' }}>
          <div class="pd-wx__now">
            {noGlyph ? null : glyph(v.cond, gl, night, 'pd-wx__gl')}
            {temp(ts)}
            <span class="pd-wx__col">
              <span class="pd-wx__cond">{condText}</span>
              {hlw ? <span class="pd-wx__sub" data-part="num">{hlw}</span> : null}
              {staleEl}
            </span>
          </div>
          {aside ? <i class="pd-wx__rule" /> : null}
          {aside}
        </div>
      )
    } else {
      const top = v.place ? pillH(mainW) + 4 : 0
      const ts0 = Math.round(Math.max(40, Math.min((H - top) * 0.62, mainW * 0.27, 110)))
      const gl0 = Math.round(Math.max(30, Math.min(ts0 * 0.62, 64)))
      const third = typeof v.aqi === 'number' || typeof v.wind === 'number'
      // wide enough (4x2): the AQI chip and the wind get their own column; else the chip goes up by the pill and the wind under H/L
      const showThird = third && mainW >= gl0 + ts0 * 1.3 + 125
      // wind and the AQI number on one line when they fit beside the glyph column, else the chip goes under the wind
      const gcW = Math.max(gl0, Math.min(textW(condText, 13), mainW * 0.42))
      const wrowFits = mainW - gcW - 20 >= (typeof v.wind === 'number' ? textW(Math.round(v.wind) + ' ' + windUnitOf(v), 12.5) + 24 : 0) + (typeof v.aqi === 'number' ? 36 : 0)
      // a two-line pill: the number shrinks so the temperature column never runs up into it (heroTempFit)
      const hasW = typeof v.wind === 'number', hasA = typeof v.aqi === 'number'
      const two = top > 26
      // with a two-line pill there is no height for the wind and the chip on two rows: the chip moves under the condition
      const aqiGc = two && !showThird && hasW && hasA && !wrowFits
      const wrowH = showThird || (!hasW && !hasA) ? 0 : wrowFits || aqiGc || !(hasW && hasA) ? 24 : 48
      const ts = heroTempFit(ts0, H, top, wrowH, two)
      // the glyph column (glyph, 6, condition 17, the chip 24) fits the same room
      const glMax = two ? H - top - 4 - 23 - (aqiGc ? 24 : 0) : 64
      const gl = Math.round(Math.max(24, Math.min(ts === ts0 ? gl0 : ts * 0.62, 64, glMax)))
      body = (
        <div class="pd-wx__in pd-wx__in--row" style={{ padding: vpad + 'px ' + pad + 'px' }}>
          <div class="pd-wx__hero">
            {top ? <div class="pd-wx__top" style={top > 26 ? { height: top - 4 + 'px', marginBottom: '4px' } : undefined}>{pill(mainW)}</div> : null}
            <div class="pd-wx__hm">
              <span class="pd-wx__gc" style={{ maxWidth: Math.round(mainW * 0.42) + 'px' }}>
                {glyph(v.cond, gl, night)}
                <span class="pd-wx__cond">{condText}</span>
                {aqiGc ? <span class="pd-wx__gca">{aqi(true)}</span> : null}
              </span>
              <span class="pd-wx__tc">
                {temp(ts)}
                {hl ? <span class="pd-wx__sub" data-part="num">{hl}</span> : null}
                {showThird ? null : (
                  <span class={'pd-wx__wrow' + (wrowFits || aqiGc ? '' : ' pd-wx__wrow--wrap')}>
                    {wind()}
                    {aqiGc ? null : aqi(true)}
                  </span>
                )}
              </span>
              {showThird ? (
                <span class="pd-wx__xc">
                  {aqi()}
                  {wind()}
                </span>
              ) : null}
            </div>
            {staleEl}
          </div>
          {aside ? <i class="pd-wx__rule" /> : null}
          {aside}
        </div>
      )
    }
  } else if (mode === 'full') {
    // header, two detail rows, then the forecast columns with the high and low lines and the rain bars
    const hdrGl = W >= 360 ? 48 : 40
    const ts = W >= 360 ? 44 : 36
    const det: { k: string; label: string; val: any }[] = []
    if (typeof v.feels === 'number') det.push({ k: 'feels', label: t('Feels like'), val: deg(v.feels) })
    if (typeof v.humidity === 'number') det.push({ k: 'drop', label: t('Humidity'), val: Math.round(v.humidity) + '%' })
    if (typeof v.wind === 'number') det.push({ k: 'wind', label: t('Wind'), val: wind() })
    const uv = v.daily[0] && typeof v.daily[0].uv === 'number' ? v.daily[0].uv : undefined
    if (uv !== undefined) det.push({ k: 'uv', label: t('UV index'), val: String(Math.round(uv)) })
    else if (v.daily[0] && typeof v.daily[0].pop === 'number') det.push({ k: 'rain', label: t('Chance of rain'), val: Math.round(v.daily[0].pop) + '%' })
    const perRow = W >= 300 ? 2 : 1
    const hdrH = hdrGl + 8
    const hours = face.series === 'hourly'
    // the source name only where there is room for it; "Updated ..." always shows when the data is old
    const foot = stale || (v.source && H >= 300) ? 16 : 0
    // the chart wins over the detail rows: they drop (bottom first) until the forecast gets its minimum height
    const minChart = !hours && hasRain(v.daily) ? 128 : 106
    const maxRows = Math.min(2, Math.ceil(det.length / perRow))
    const rowsN = face.forecast ? detailRows(H - hdrH - foot, maxRows, 30, 8, minChart) : maxRows
    const shown = det.slice(0, rowsN * perRow)
    const detH = rowsN * 30 + (rowsN ? 8 : 0)
    const left = H - hdrH - detH - foot
    let fc: any = null
    if (face.forecast && left >= minChart - 8) {
      const pts = hours ? v.hourly.map((h) => ({ ms: h.ms, cond: h.cond, hi: n(h.temp), lo: NaN, rain: undefined as number | undefined })) : v.daily.map((d) => ({ ms: d.ms, cond: d.cond, hi: n(d.high), lo: n(d.low), rain: d.rain }))
      const cols = fitCount(W, hours ? 44 : 40, pts.length, 3, hours ? 12 : 9)
      const list = pts.slice(0, cols)
      const colW = W / cols
      const rain = !hours && hasRain(list)
      const box = chartBox(left, rain)
      const vals: number[] = []
      list.forEach((p) => {
        vals.push(p.hi)
        if (!hours) vals.push(p.lo)
      })
      const rg = rangeOf(vals, 4)
      const cTop = 18
      const cBot = box.chart - (hours ? 8 : 18)
      const hiPts = linePoints(list.map((p) => p.hi), colW, cTop, cBot, rg[0], rg[1])
      const loPts = hours ? [] : linePoints(list.map((p) => p.lo), colW, cTop, cBot, rg[0], rg[1])
      const bars = rain ? rainBars(list, box.bars) : []
      const barW = Math.max(6, Math.min(16, Math.round(colW * 0.36)))
      const fs = colW >= 44 ? 11 : 10
      // "8.4 mm" under each bar when every one fits its column, else the numbers alone and one "mm" at the row start
      const unitEach = list.every((p) => textW(rainText(p.rain) + ' mm', 10.5) <= colW - 4)
      fc = (
        <div class="pd-wx__fcs">
          <div class="pd-wx__cols">
            {list.map((p, i) => (
              <span class="pd-wx__cl" key={i} style={{ width: colW + 'px' }}>
                <span class="pd-wx__fn" style={{ height: box.name + 'px', fontSize: (colW < 54 ? 11 : 12) + 'px' }}>{hours ? (i === 0 ? t('Now') : hourLabel(p.ms)) : dayName(p.ms, i)}</span>
                {glyph(p.cond, box.glyph - 4, hours ? nightAt(p.ms) : false)}
              </span>
            ))}
          </div>
          <svg class="pd-wx__chart" width={W} height={box.chart} viewBox={'0 0 ' + W + ' ' + box.chart} aria-hidden="true">
            {list.map((_p, i) => (i ? <line key={'g' + i} class="pd-wx__grid" x1={Math.round(colW * i) + 0.5} y1={0} x2={Math.round(colW * i) + 0.5} y2={box.chart} /> : null))}
            <polyline class="pd-wx__lh" points={pointsAttr(hiPts)} />
            {loPts.length ? <polyline class="pd-wx__ll" points={pointsAttr(loPts)} /> : null}
            {hiPts.map((p, i) => (
              <g key={'h' + i}>
                <circle class="pd-wx__dot pd-wx__dot--hi" cx={p.x} cy={p.y} r={2.5} />
                <text class="pd-wx__val" x={p.x} y={p.y - 7} text-anchor="middle" font-size={fs}>
                  {list[i].hi + '°'}
                </text>
              </g>
            ))}
            {loPts.map((p, i) => (
              <g key={'l' + i}>
                <circle class="pd-wx__dot pd-wx__dot--lo" cx={p.x} cy={p.y} r={2.5} />
                <text class="pd-wx__val pd-wx__val--lo" x={p.x} y={p.y + 15} text-anchor="middle" font-size={fs}>
                  {list[i].lo + '°'}
                </text>
              </g>
            ))}
          </svg>
          {rain ? (
            <div class="pd-wx__rain">
              {unitEach ? null : <span class="pd-wx__ru">mm</span>}
              {list.map((p, i) => (
                <span class="pd-wx__rc" key={i} style={{ width: colW + 'px' }}>
                  <span class="pd-wx__rb" style={{ height: box.bars + 'px' }}>
                    {bars[i] ? <i style={{ width: barW + 'px', height: bars[i] + 'px' }} /> : null}
                  </span>
                  <span class="pd-wx__rt" data-part="num">{rainText(p.rain) ? rainText(p.rain) + (unitEach ? ' mm' : '') : ''}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )
    }
    const src = v.source ? SOURCE_NAME[v.source] || v.source : ''
    peek = true
    moonRight = Math.round(tw * 0.4 - Math.min(tw * 0.18, 76) / 2)
    body = (
      <div class="pd-wx__in" style={{ padding: pad + 'px' }}>
        <div class="pd-wx__hdr" style={{ height: hdrH + 'px' }}>
          {glyph(v.cond, hdrGl, night, 'pd-wx__gl')}
          <span class="pd-wx__col">
            {/* the place keeps its own line; on narrow tiles the AQI number moves up beside the condition */}
            {W < 330 && v.place ? (
              <span class="pd-wx__hrow">
                <span class="pd-wx__cond pd-wx__cond--lg">{condText}</span>
                {aqi(true)}
              </span>
            ) : (
              <span class="pd-wx__cond pd-wx__cond--lg">{condText}</span>
            )}
            {v.place || typeof v.aqi === 'number' ? (
              <span class="pd-wx__hrow">
                {v.place ? <span class="pd-wx__sub">{v.place}</span> : null}
                {W < 330 && v.place ? null : aqi(W < 330)}
              </span>
            ) : null}
          </span>
          <span class="pd-wx__hr">
            {temp(ts)}
            {hl ? <span class="pd-wx__sub" data-part="num">{hl}</span> : null}
          </span>
        </div>
        {rowsN ? (
          <div class="pd-wx__det">
            {shown.map((x, i) => (
              <span class={'pd-wx__dr' + (perRow === 2 ? ' pd-wx__dr--half' : '') + (perRow === 2 && i % 2 === 1 ? ' pd-wx__dr--r' : '')} key={x.k}>
                <WxLine name={x.k === 'rain' ? 'drop' : x.k} size={16} px={1.5} />
                <span class="pd-wx__dl">{x.label}</span>
                <span class="pd-wx__dv" data-part="num">{x.val}</span>
              </span>
            ))}
          </div>
        ) : null}
        {fc}
        {foot ? (
          <span class="pd-wx__src">
            {staleEl || <span class="pd-wx__age" />}
            <span class="pd-wx__sp" />
            {src}
          </span>
        ) : null}
      </div>
    )
  } else {
    // tall: a slim header, then a row per day (name, glyph, low, range bar, high)
    const narrow = W < 200
    peek = true
    const gl = narrow ? 28 : 36
    const ts = narrow ? 30 : 40
    const rh = H >= 330 ? 30 : 26
    // header (time-high number, plus the condition line on narrow tiles), the hairline block, the stale line: whole rows in the rest
    const hdr = Math.max(gl, ts) + (narrow ? 21 : 0)
    const fit = tallRows(H - hdr - 13 - (stale ? 18 : 0), rh, Math.min(7, v.daily.length), 40)
    const list = v.daily.slice(0, Math.max(1, fit.rows))
    const rowH = fit.rowH
    // the day column: 56 px with the range bar, else what is left; "Today" becomes its weekday when it would be cut
    const nameW = narrow ? W - 18 - 16 - 64 : 56
    const todayFits = textW(t('Today'), 13) <= nameW - 10
    const rg = rangeOf(
      list.reduce((a: number[], d) => a.concat([d.low, d.high]), []),
      1,
    )
    const span = rg[1] - rg[0] || 1
    body = (
      <div class="pd-wx__in" style={{ padding: pad + 'px' }}>
        <div class="pd-wx__slim">
          {glyph(v.cond, gl, night, 'pd-wx__gl')}
          {temp(ts)}
          {narrow ? null : (
            <span class="pd-wx__col">
              <span class="pd-wx__cond">{condText}</span>
              {v.place ? <span class="pd-wx__sub">{v.place}</span> : null}
            </span>
          )}
        </div>
        {narrow ? <span class="pd-wx__cond pd-wx__cond--n">{condText}</span> : null}
        <div class={'pd-wx__days' + (narrow ? ' pd-wx__days--n' : '')}>
          {list.map((d, i) => (
            <span class="pd-wx__dy" key={i} style={{ height: rowH + 'px' }}>
              <span class="pd-wx__dn">{i === 0 && !todayFits ? weekdayOf(d.ms) : dayName(d.ms, i)}</span>
              {glyph(d.cond, 18, false)}
              <span class="pd-wx__dlo" data-part="num">{deg(d.low)}</span>
              {narrow ? null : (
                <span class="pd-wx__rg">
                  <i style={{ left: ((d.low - rg[0]) / span) * 100 + '%', width: Math.max(6, ((d.high - d.low) / span) * 100) + '%' }} />
                </span>
              )}
              <span class="pd-wx__dhi" data-part="num">{deg(d.high)}</span>
            </span>
          ))}
        </div>
        {staleEl}
      </div>
    )
  }

  return (
    <div class={'pd-wx pd-wx--sky pd-wx--' + sky.kind + ' pd-wx--' + mode + (stale ? ' pd-wx--old' : '')}>
      <SkyLayer sky={sky} tw={tw} th={th} moonRight={moonRight} peek={peek} />
      {body}
    </div>
  )
}
