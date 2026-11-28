import { PAL } from './theme'
import { useEffect, useState } from 'preact/hooks'
import { getLang } from './i18n'
import { t } from './i18n'
import { TileIcon } from './icon'
import { isIconName } from '../../shared/icons'
import type { IconAssets, Notice, PushedValue, PushOptions } from './types'

/** Re-render every `ms` so relative times ("3 min ago") stay fresh. */
export function useTick(ms: number): number {
  const [n, setN] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setN(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return n
}

export function relTime(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 10) return t('just now')
  if (s < 60) return t('{0}s ago', s)
  const m = Math.round(s / 60)
  if (m < 60) return t('{0} min ago', m)
  const h = Math.round(m / 60)
  if (h < 24) return t('{0}h ago', h)
  return t('{0}d ago', Math.round(h / 24))
}

const toMs = (v: unknown): number => {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return isFinite(t) ? t : Date.now()
  }
  return Date.now()
}
export const atOf = toMs

// ---------------- weather ----------------

type Cond = 'clear' | 'night' | 'partly' | 'cloudy' | 'rain' | 'pour' | 'storm' | 'snow' | 'fog' | 'wind' | 'hail'
/** Accepts Home Assistant weather states, Open-Meteo style words and WMO codes. */
export function condOf(c: unknown): Cond {
  if (typeof c === 'number') {
    if (c === 0 || c === 1) return 'clear'
    if (c === 2) return 'partly'
    if (c === 3) return 'cloudy'
    if (c === 45 || c === 48) return 'fog'
    if ((c >= 51 && c <= 57) || c === 61 || c === 80) return 'rain'
    if (c === 63 || c === 65 || c === 66 || c === 67 || c === 81 || c === 82) return 'pour'
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow'
    if (c >= 95) return 'storm'
    return 'cloudy'
  }
  const s = String(c || '').toLowerCase()
  if (s.indexOf('night') >= 0) return 'night'
  if (s.indexOf('partly') >= 0 || s.indexOf('mainly') >= 0) return 'partly'
  if (s.indexOf('pour') >= 0 || s.indexOf('heavy') >= 0) return 'pour'
  if (s.indexOf('light') >= 0 && s.indexOf('ning') >= 0) return 'storm'
  if (s.indexOf('storm') >= 0 || s.indexOf('thunder') >= 0) return 'storm'
  if (s.indexOf('hail') >= 0) return 'hail'
  if (s.indexOf('snow') >= 0 || s.indexOf('sleet') >= 0) return 'snow'
  if (s.indexOf('rain') >= 0 || s.indexOf('drizzle') >= 0 || s.indexOf('shower') >= 0) return 'rain'
  if (s.indexOf('fog') >= 0 || s.indexOf('mist') >= 0 || s.indexOf('haze') >= 0) return 'fog'
  if (s.indexOf('wind') >= 0) return 'wind'
  if (s.indexOf('cloud') >= 0 || s.indexOf('overcast') >= 0) return 'cloudy'
  if (s.indexOf('sun') >= 0 || s.indexOf('clear') >= 0) return 'clear'
  return 'cloudy'
}
const COND_TEXT: { [k in Cond]: string } = { clear: 'Clear', night: 'Clear', partly: 'Partly cloudy', cloudy: 'Cloudy', rain: 'Rain', pour: 'Heavy rain', storm: 'Thunderstorm', snow: 'Snow', fog: 'Fog', wind: 'Windy', hail: 'Hail' }
/** Tabler names first (drawn when built in or shipped in layout.assets), emoji when they are not. */
const COND_ICON: { [k in Cond]: { names: string[]; emoji: string; color: string } } = {
  clear: { names: ['sun'], emoji: '☀️', color: '#fbbf24' },
  night: { names: ['moon'], emoji: '🌙', color: '#a5b4fc' },
  partly: { names: ['cloud-sun', 'sun'], emoji: '⛅', color: '#fbbf24' },
  cloudy: { names: ['cloud'], emoji: '☁️', color: '#9ca3af' },
  rain: { names: ['cloud-rain'], emoji: '🌧️', color: '#60a5fa' },
  pour: { names: ['cloud-rain'], emoji: '🌧️', color: '#3b82f6' },
  storm: { names: ['cloud-storm', 'bolt'], emoji: '⛈️', color: '#a78bfa' },
  snow: { names: ['snowflake'], emoji: '❄️', color: '#bae6fd' },
  fog: { names: ['cloud-fog'], emoji: '🌫️', color: '#9ca3af' },
  wind: { names: ['wind'], emoji: '💨', color: '#9ca3af' },
  hail: { names: ['cloud-snow', 'cloud-rain'], emoji: '🌨️', color: '#bae6fd' },
}
/** Names the weather widget can draw; the orchestrator's gen-assets should include them. */
export const WEATHER_ICON_NAMES = ['sun', 'moon', 'cloud', 'cloud-sun', 'cloud-rain', 'cloud-storm', 'cloud-snow', 'cloud-fog', 'snowflake', 'wind', 'bolt']

/** The weather glyph for a condition (Tabler icon when available, else emoji); also used by the weather-style clock. */
export function WxGlyph(props: { cond: unknown; size: number; assets?: IconAssets }) {
  const c = COND_ICON[condOf(props.cond)]
  let name = ''
  for (let i = 0; i < c.names.length; i++) {
    if (isIconName(c.names[i]) || (props.assets && Object.prototype.hasOwnProperty.call(props.assets, c.names[i]))) {
      name = c.names[i]
      break
    }
  }
  return (
    <span class="pd-wx__g" style={{ color: c.color, width: props.size + 'px', height: props.size + 'px', fontSize: Math.round(props.size * 0.8) + 'px', lineHeight: props.size + 'px' }}>
      {name ? <TileIcon value={name} size={props.size} assets={props.assets} /> : c.emoji}
    </span>
  )
}

const DAY_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const DAY_FR = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
const DAY_PT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const DAY = (): string[] => (getLang() === 'zh' ? DAY_ZH : getLang() === 'vi' ? DAY_VI : getLang() === 'fr' ? DAY_FR : getLang() === 'pt' ? DAY_PT : DAY_EN)
/** Short weekday name of a time, in the deck language. */
export const weekdayOf = (ms: number): string => DAY()[new Date(ms).getDay()]
/** The deck's own text for a condition (code or word), translated: what the weather tile shows. */
export const condTextOf = (c: unknown, ms: number): string => t(COND_TEXT[condAt(c, ms)])
const isNightAt = (ms: number) => {
  const h = new Date(ms).getHours()
  return h >= 19 || h < 6
}
/** condition with the sun swapped for the moon after dark */
const condAt = (c: unknown, ms: number): Cond => {
  const k = condOf(c)
  return k === 'clear' && isNightAt(ms) ? 'night' : k
}
/** An hour label ("3 PM", "15h", "15时") in the deck language. */
export const hourLabel = (ms: number) => {
  const h = new Date(ms).getHours()
  return getLang() === 'zh' ? h + '时' : getLang() === 'vi' || getLang() === 'pt' ? h + 'h' : getLang() === 'fr' ? h + ' h' : (h % 12 || 12) + (h < 12 ? ' AM' : ' PM')
}

// ---------------- pushed value ----------------

export interface ValueProps {
  cfg: PushOptions
  val?: PushedValue
  tw: number
  th: number
  scale: number
  showLabel: boolean
  color?: string
  textColor?: string
}

export function ValueTile(props: ValueProps) {
  const now = useTick(15000)
  const v = props.val
  const tw = props.tw
  const th = props.th
  const pad = tw >= 170 ? 14 : 10
  const label = props.cfg.label || props.cfg.key
  const stale = !!v && typeof v.ttl === 'number' && v.ttl > 0 && now - v.at > v.ttl * 1000
  const text = v ? String(v.value) : '–'
  const unit = props.cfg.unit || (v && v.unit) || ''
  const len = (text + unit).length
  const vs = Math.max(16, Math.min(Math.floor(th * (v && v.sub ? 0.34 : 0.42)), Math.floor((tw - pad * 2) / (Math.max(2, len) * 0.56)), 56))
  const col = props.textColor || props.color || undefined
  return (
    <div class={'pd-vl' + (stale ? ' pd-vl--stale' : '')} style={{ padding: pad + 'px' }}>
      <span class="pd-vl__lb" data-part="tile-label" style={{ color: props.color || undefined }}>
        {label}
      </span>
      <span class="pd-vl__v" data-part="tile-value" style={{ fontSize: vs + 'px', color: col }}>
        {text}
        {unit ? <i style={{ fontSize: Math.max(10, Math.round(vs * 0.42)) + 'px' }}>{unit}</i> : null}
      </span>
      {v && v.sub && th >= 80 ? <span class="pd-vl__sub">{v.sub}</span> : null}
      <span class="pd-vl__t">{v ? (stale ? t('Stale') + ' · ' : '') + relTime(v.at, now) : t('No data yet')}</span>
    </div>
  )
}

// ---------------- notifications ----------------

export const LEVEL_COLOR: { [k: string]: string } = { get info() { return PAL.info }, get warn() { return PAL.warn }, get alert() { return PAL.error } }

export function NotificationsTile(props: { notes: Notice[]; tw: number; th: number; showLabel: boolean; textColor?: string }) {
  const now = useTick(20000)
  const pad = props.tw >= 170 ? 14 : 10
  const rows = Math.max(1, Math.floor((props.th - pad * 2 - (props.showLabel ? 20 : 0)) / 38))
  const list = props.notes.filter((n) => !n.ttl || now - n.at < n.ttl * 1000).slice(0, rows)
  return (
    <div class="pd-nt" style={{ padding: pad + 'px' }}>
      {props.showLabel ? <span class="pd-nt__h">{t('Notifications')}</span> : null}
      {list.length === 0 ? <span class="pd-nt__e">{t('No notifications')}</span> : null}
      {list.map((n) => (
        <div class="pd-nt__r" key={n.id}>
          <i class="pd-nt__d" style={{ background: LEVEL_COLOR[n.level || 'info'] || LEVEL_COLOR.info }} />
          <span class="pd-nt__b">
            <span class="pd-nt__t" style={{ color: props.textColor || undefined }}>{n.title}</span>
            {n.body && props.th >= 130 ? <span class="pd-nt__s">{n.body}</span> : null}
          </span>
          <span class="pd-nt__a">{relTime(n.at, now)}</span>
        </div>
      ))}
    </div>
  )
}
