/** Pure logic for lite mode, dim schedule, standby and alarms. No DOM except the localStorage / navigator reads, no deck imports. */
import type { Alarm, HeaderMode, ScreenSettings } from './types'

export interface LocalScreen {
  lite?: 'auto' | 'on' | 'off'
  standby?: boolean
  alarms?: boolean
  header?: HeaderMode
  /** burn-in shift on this phone, either way; missing = what the layout says */
  shift?: boolean
  /** false = no night dim on this phone (the dim behind the standby clock stays) */
  nightDim?: boolean
  /** full-screen ON AIR sign on this phone while On Air is on (off unless switched on here) */
  onAirFull?: boolean
}

const K_LOCAL = 'pd.screen.local'
const K_FIRED = 'pd.alarm.fired'

const store = {
  get(k: string): string | null {
    try {
      return window.localStorage.getItem(k)
    } catch (e) {
      return null
    }
  },
  set(k: string, v: string) {
    try {
      window.localStorage.setItem(k, v)
    } catch (e) {
      /* ignore */
    }
  },
}

const listeners: Array<() => void> = []
export function onLocalScreen(fn: () => void): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i >= 0) listeners.splice(i, 1)
  }
}

export function localScreen(): LocalScreen {
  try {
    const o = JSON.parse(store.get(K_LOCAL) || '{}')
    return o && typeof o === 'object' ? o : {}
  } catch (e) {
    return {}
  }
}

export function saveLocalScreen(patch: LocalScreen) {
  store.set(K_LOCAL, JSON.stringify(Object.assign({}, localScreen(), patch)))
  for (const f of listeners.slice()) f()
}

export function deviceId(): string {
  return store.get('pd.deviceId') || ''
}

/** iOS major version from the user agent, 0 when not iOS. */
export function iosMajor(): number {
  const m = /OS (\d+)[_.]\d+/.exec(typeof navigator === 'undefined' ? '' : navigator.userAgent)
  return m && /iP(hone|ad|od)/.test(navigator.userAgent) ? parseInt(m[1], 10) : 0
}

export function liteAuto(): boolean {
  const nav: any = typeof navigator === 'undefined' ? {} : navigator
  const ios = iosMajor()
  if (ios > 0 && ios < 13) return true
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 2) return true
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2) return true
  return false
}

export function liteOn(s: ScreenSettings | undefined): boolean {
  const l = localScreen().lite || (s && s.lite) || 'auto'
  return l === 'on' ? true : l === 'off' ? false : liteAuto()
}

export function keepAwakeOn(s: ScreenSettings | undefined): boolean {
  return !(s && s.keepAwake === false)
}

export function standbyCfg(s: ScreenSettings | undefined) {
  const sb = s && s.standby
  if (!sb || !sb.enabled) return null
  if (localScreen().standby === false) return null
  return {
    afterMin: Math.min(120, Math.max(1, Math.round(sb.afterMin || 5))),
    style: sb.style === 'analog' || sb.style === 'words' ? sb.style : ('digital' as 'digital' | 'analog' | 'words'),
    showDate: sb.showDate !== false,
    showNext: sb.showNext !== false,
  }
}

/** local choice wins over theme.header; anything unknown = full */
export function headerMode(theme: { header?: string } | undefined): HeaderMode {
  const ok = (v: any): v is HeaderMode => v === 'full' || v === 'minimal' || v === 'hidden'
  const l = localScreen().header
  if (ok(l)) return l
  const h = theme && theme.header
  return ok(h) ? h : 'full'
}

export function alarmsOn(): boolean {
  return localScreen().alarms !== false
}

const toMin = (hm: string | undefined): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm || '')
  return m ? Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]) : -1
}

/** True when `now` is inside the dim schedule (from -> to, may wrap midnight). */
export function inDimWindow(s: ScreenSettings | undefined, now: Date): boolean {
  const d = s && s.dim
  if (!d) return false
  const a = toMin(d.from)
  const b = toMin(d.to)
  if (a < 0 || b < 0 || a === b) return false
  const n = now.getHours() * 60 + now.getMinutes()
  return a < b ? n >= a && n < b : n >= a || n < b
}

export function dimLevel(s: ScreenSettings | undefined): number {
  const l = s && s.dim && typeof s.dim.level === 'number' ? s.dim.level : 0.6
  return Math.min(0.9, Math.max(0, l))
}

/** The alarms this phone arms: enabled, valid time, matching device. */
export function myAlarms(list: Alarm[] | undefined, dev: string): Alarm[] {
  const out: Alarm[] = []
  const a = list || []
  for (let i = 0; i < a.length && i < 20; i++) {
    const x = a[i]
    if (!x || !x.enabled || toMin(x.time) < 0) continue
    if (x.devices && x.devices.length && x.devices.indexOf(dev) < 0) continue
    out.push(x)
  }
  return out
}

const DAY = 86400000

/** Occurrence timestamps of `a` around `now`: yesterday, today, tomorrow (a one-shot has all three; filtered by the caller). */
export function occurrences(a: Alarm, now: number): number[] {
  const m = toMin(a.time)
  const base = new Date(now)
  base.setHours(0, 0, 0, 0)
  const out: number[] = []
  for (let d = -1; d <= 7; d++) {
    const day = new Date(base.getTime() + d * DAY + 12 * 3600000) // noon: safe across DST
    const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60, 0, 0).getTime()
    if (a.days && a.days.length && a.days.indexOf(day.getDay()) < 0) continue
    out.push(t)
  }
  return out
}

function fired(): { [k: string]: string } {
  try {
    return JSON.parse(store.get(K_FIRED) || '{}') || {}
  } catch (e) {
    return {}
  }
}

/** A one-shot fires once per `time` value; remembered in localStorage. */
export function markFired(a: Alarm) {
  if (a.days && a.days.length) return
  const f = fired()
  f[a.id] = a.time
  store.set(K_FIRED, JSON.stringify(f))
}

function oneShotDone(a: Alarm): boolean {
  return !(a.days && a.days.length) && fired()[a.id] === a.time
}

export interface Due {
  alarm: Alarm
  /** the ring time */
  at: number
  key: string
}

/** The next ring time of every alarm after `now`, soonest first. */
export function upcoming(alarms: Alarm[], now: number): Due[] {
  const out: Due[] = []
  for (const a of alarms) {
    if (oneShotDone(a)) continue
    const occ = occurrences(a, now)
    for (const t of occ) {
      if (t > now) {
        out.push({ alarm: a, at: t, key: a.id + '@' + t })
        break
      }
    }
  }
  out.sort((x, y) => x.at - y.at)
  return out
}

export const RING_MS = 10 * 60000

/**
 * What is going on now: an occurrence whose window [at - sunrise, at + 10 min] holds `now` and that is not dismissed.
 * Returns the one with the latest start (the most relevant).
 */
export function active(alarms: Alarm[], now: number, dismissed: { [key: string]: true }): Due | null {
  let best: Due | null = null
  let bestStart = 0
  for (const a of alarms) {
    if (oneShotDone(a)) continue
    const sun = Math.min(30, Math.max(0, a.sunriseMin | 0)) * 60000
    const occ = occurrences(a, now)
    for (const t of occ) {
      const key = a.id + '@' + t
      if (dismissed[key]) continue
      if (now >= t - sun && now < t + RING_MS) {
        if (!best || t - sun > bestStart) {
          best = { alarm: a, at: t, key }
          bestStart = t - sun
        }
      }
    }
  }
  return best
}

/** Sunrise colour for progress 0..1: black -> deep red -> warm orange -> soft white. */
export function sunriseColor(p: number): string {
  const stops = [
    [0, 0, 0],
    [120, 20, 10],
    [255, 140, 50],
    [255, 244, 224],
  ]
  const x = Math.min(1, Math.max(0, p)) * 3
  const i = Math.min(2, Math.floor(x))
  const f = x - i
  const c = [0, 1, 2].map((k) => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f))
  return 'rgb(' + c.join(',') + ')'
}

// ---- screen care ----

export const SHIFT_MS = 3 * 60000
/** A slow ring around the resting place, never more than 2 px from it. */
export const SHIFT_PATH: ReadonlyArray<readonly [number, number]> = [[0, 0], [2, 0], [2, 2], [0, 2], [-2, 2], [-2, 0], [-2, -2], [0, -2], [2, -2]]

/** Where the grid sits at `now`. It comes from the clock, so a phone that slept lands on the right step without having counted. */
export function shiftAt(now: number): { x: number; y: number } {
  const p = SHIFT_PATH[Math.floor(now / SHIFT_MS) % SHIFT_PATH.length]
  return { x: p[0], y: p[1] }
}

export function shiftOn(s: ScreenSettings | undefined): boolean {
  const l = localScreen().shift
  return typeof l === 'boolean' ? l : !!(s && s.burnInShift === true)
}

export function nightDimOn(): boolean {
  return localScreen().nightDim !== false
}

/** The page parts runShift needs, so tests can drive it without a browser. */
export interface ShiftHost {
  hidden: () => boolean
  onVisibility: (fn: () => void) => () => void
  now: () => number
  setTimeout: (fn: () => void, ms: number) => number
  clearTimeout: (id: number) => void
}

/** Calls `apply` now and at every 3 minute step. While the page is hidden there is no timer at all. Returns the stop function. */
export function runShift(host: ShiftHost, apply: (p: { x: number; y: number }) => void): () => void {
  let timer = 0
  const stop = () => {
    if (timer) host.clearTimeout(timer)
    timer = 0
  }
  const step = () => {
    stop()
    if (host.hidden()) return
    const now = host.now()
    apply(shiftAt(now))
    timer = host.setTimeout(step, SHIFT_MS - (now % SHIFT_MS) + 50)
  }
  const off = host.onVisibility(step)
  step()
  return () => {
    off()
    stop()
  }
}

export const browserShiftHost = (): ShiftHost => ({
  hidden: () => document.visibilityState === 'hidden',
  onVisibility: (fn) => {
    document.addEventListener('visibilitychange', fn)
    return () => document.removeEventListener('visibilitychange', fn)
  },
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
})

export const pad2 = (n: number) => (n < 10 ? '0' : '') + n

/** The Nookdeck Android app (its WebView adds `NookdeckApp/<version>` to the user agent) is fullscreen and keeps the screen on itself. */
export const inNookdeckApp = (ua: string): boolean => /NookdeckApp\//.test(ua)

/**
 * Ask the Nookdeck Android app to hold the screen the layout's way ("landscape", "portrait", or "auto" for the phone's own setting).
 * Returns false in a browser, where the deck keeps rotating itself in CSS.
 */
export function askAppOrientation(w: { NookdeckApp?: { setOrientation?: (o: string) => void } }, orient: string): boolean {
  const app = w.NookdeckApp
  if (!app || typeof app.setOrientation !== 'function') return false
  try {
    app.setOrientation(orient)
    return true
  } catch {
    return false
  }
}

const K_AWAKE_HINT = 'pd.awakeHint'
/**
 * Android browsers give a page on http://<LAN address> no Wake Lock (it needs HTTPS), and Chrome no longer keeps the screen on for a
 * muted looping video, so the deck cannot promise to stay lit: say once how to make the phone itself keep the screen on.
 * iPhones and iPads keep the video trick, which still works there.
 */
export function awakeHintNeeded(ua: string, hasWakeLock: boolean, keepAwake: boolean, dismissed: boolean): boolean {
  // the Nookdeck Android app keeps the screen on itself
  return keepAwake && !hasWakeLock && !dismissed && /Android/i.test(ua) && !inNookdeckApp(ua)
}
export const awakeHintDismissed = (): boolean => store.get(K_AWAKE_HINT) === '1'
export const dismissAwakeHint = (): void => store.set(K_AWAKE_HINT, '1')
