/**
 * The demo deck (dist-demo): the real deck in preview mode with no agent, driven by a message from the page that embeds it.
 * Pure helpers live here so they can be tested without a browser. Everything the parent sends is checked before use.
 */
import type { Layout, Stats } from './types'
import type { Hist } from './widgets'

const GB = 1024 * 1024 * 1024

/** The sample Overview a demo shows when the parent sends no layout. */
export const DEMO_LAYOUT = {
  pages: [
    {
      id: 'overview',
      name: 'Overview',
      columns: 8,
      rows: 4,
      items: [
        { id: 'd-clock', kind: 'widget', widget: 'clock', x: 0, y: 0, w: 2, h: 1 },
        { id: 'd-weather', kind: 'widget', widget: 'weather', x: 2, y: 0, w: 2, h: 1 },
        { id: 'd-quota', kind: 'widget', widget: 'quota', provider: 'claude', x: 4, y: 0, w: 2, h: 1 },
        { id: 'd-cpu', kind: 'widget', widget: 'cpu', x: 6, y: 0, w: 2, h: 1 },
        { id: 'd-np', kind: 'widget', widget: 'nowplaying', x: 0, y: 1, w: 4, h: 2 },
        { id: 'd-mem', kind: 'widget', widget: 'memory', x: 4, y: 1, w: 2, h: 1 },
        { id: 'd-gpu', kind: 'widget', widget: 'gpu', x: 6, y: 1, w: 2, h: 1 },
        { id: 'd-net', kind: 'widget', widget: 'network', x: 4, y: 2, w: 2, h: 1 },
        { id: 'd-load', kind: 'widget', widget: 'load', x: 6, y: 2, w: 2, h: 1 },
        { id: 'd-b1', kind: 'button', label: 'Slack', icon: 'brand-slack', color: '#e8b339', x: 0, y: 3 },
        { id: 'd-b2', kind: 'button', label: 'Mail', icon: 'mail', color: '#8b5cf6', x: 1, y: 3 },
        { id: 'd-b3', kind: 'button', label: 'Music', icon: 'music', x: 2, y: 3 },
        { id: 'd-b4', kind: 'button', label: 'Lock', icon: 'lock', color: '#6b7280', x: 3, y: 3 },
        { id: 'd-b5', kind: 'button', label: 'Sleep', icon: 'moon', color: '#38bdf8', x: 4, y: 3 },
        { id: 'd-b6', kind: 'button', label: 'Home', icon: 'home', x: 5, y: 3 },
        { id: 'd-b7', kind: 'button', label: 'Terminal', icon: 'terminal', color: '#10b981', x: 6, y: 3 },
        { id: 'd-b8', kind: 'button', label: 'Browser', icon: 'world', color: '#f59e0b', x: 7, y: 3 },
      ],
    },
  ],
} as unknown as Layout

/** Deterministic wave in [-1, 1]: no randomness, so a screenshot of tick N is always the same. */
const wave = (t: number, seed: number, speed: number): number => Math.sin(t * speed + seed * 1.7)

/** Sample stats for tick `t`: they drift a little, never jump. */
export function demoStats(t: number): Stats {
  const cpu = Math.round(37 + 12 * wave(t, 1, 0.5))
  return {
    cpu,
    memUsed: (8.2 + 0.25 * wave(t, 2, 0.21)) * GB,
    memTotal: 16 * GB,
    uptime: 3 * 86400 + 4 * 3600 + t * 2,
    load: [1.2 + 0.3 * wave(t, 3, 0.3), 0.9, 0.8],
    time: 0,
    host: 'My computer',
    net: { rx: (2.4 + 1.1 * wave(t, 4, 0.6)) * 1024 * 1024, tx: (245 + 90 * wave(t, 5, 0.45)) * 1024 },
    volume: { level: 62, muted: false },
    gpu: { util: Math.round(46 + 18 * wave(t, 6, 0.4)), memUsed: 3.4 * GB, memTotal: 8 * GB, temp: Math.round(61 + 3 * wave(t, 7, 0.2)), name: 'Sample GPU' },
    ncpu: 8,
    cores: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => Math.max(0, Math.min(100, Math.round(cpu + 22 * wave(t, 8 + i, 0.5) - i * 4)))),
    mem: { cached: 3.1 * GB, swapUsed: 0.4 * GB, swapTotal: 2 * GB },
  } as Stats
}

const series = (t: number, seed: number, mid: number, amp: number, n = 40): number[] => {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(Math.max(0, mid + amp * Math.sin((i + t) * 0.42 + seed * 1.3) * (0.6 + 0.4 * Math.sin((i + t) * 0.11 + seed))))
  return out
}

/** Sample history for the sparklines at tick `t` (the window slides one sample per tick). */
export function demoHist(t: number): Hist {
  return { cpu: series(t, 1, 37, 15), mem: series(t, 2, 51, 4), rx: series(t, 3, 2.4e6, 1.4e6), tx: series(t, 5, 4e5, 2.5e5), load: series(t, 4, 1.2, 0.5), gpu: series(t, 6, 46, 20) }
}

// ---- what the parent may send ----

export const DEMO_CSS_MAX = 128 * 1024
const URL_OK = /^(?:data:(?:image|font)\/[a-z0-9.+-]+[;,]|blob:|\.{0,2}\/?[A-Za-z0-9._~%@+-][A-Za-z0-9._~%@+/ -]*$)/i

/** A url the demo may load: relative (its own files), data: image/font, blob:, or an absolute address on the demo's own origin. */
export function sameOriginUrl(u: unknown, origin: string): u is string {
  if (typeof u !== 'string' || u.length === 0 || u.length > 700000) return false
  if (/^data:|^blob:/i.test(u)) return URL_OK.test(u)
  if (u.length > 2000) return false
  if (/[\\"'()\s]/.test(u)) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return !!origin && u.indexOf(origin + '/') === 0
  if (u.indexOf('//') === 0 || u.indexOf('..') >= 0) return false
  return URL_OK.test(u)
}

/** The parent's css: already scoped and checked by the agent's tooling, but the demo still refuses what could load or leak data. Returns '' to ignore it. */
export function checkDemoCss(css: unknown, origin: string): string {
  if (typeof css !== 'string' || css.length === 0 || css.length > DEMO_CSS_MAX) return ''
  if (/@import|@namespace|@charset|expression\s*\(|behavior\s*:|-moz-binding|javascript:|<\/?style|<script/i.test(css)) return ''
  const re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) {
    const u = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]
    if (!sameOriginUrl(u, origin)) return ''
  }
  return css
}

/** @font-face rules for the parent's fonts [{family, url, weight?}]; a font whose url is not the demo's own is dropped. */
export function demoFontCss(fonts: unknown, origin: string): string {
  if (!Array.isArray(fonts)) return ''
  let out = ''
  for (let i = 0; i < fonts.length && i < 4; i++) {
    const f = fonts[i] as { family?: unknown; url?: unknown; weight?: unknown } | null
    if (!f || typeof f.family !== 'string' || !/^[A-Za-z0-9 _-]{1,40}$/.test(f.family) || !sameOriginUrl(f.url, origin)) continue
    const w = typeof f.weight === 'number' && f.weight >= 100 && f.weight <= 900 ? Math.round(f.weight) : 400
    const fmt = /\.woff2(\?|$)|font\/woff2/i.test(f.url as string) ? 'woff2' : 'woff'
    out += "@font-face{font-family:'" + f.family + "';src:url('" + f.url + "') format('" + fmt + "');font-weight:" + w + ';font-display:swap;}'
  }
  return out
}

/** One pack icon (a whole <svg> document) as a deck icon asset, or null when it has anything active in it. */
export function demoIcon(svg: unknown): { svg: string; vb: string; brand: true } | null {
  if (typeof svg !== 'string' || svg.length > 20 * 1024 || !/<svg[\s>]/i.test(svg)) return null
  if (/<\s*(script|foreignObject|iframe|object|embed|audio|video|animate|set)\b|<!\s*(ENTITY|DOCTYPE)|\son[a-z]+\s*=|javascript:|vbscript:|data:text|@import/i.test(svg)) return null
  const refs = svg.match(/(?:xlink:)?href\s*=\s*(?:"[^"]*"|'[^']*')|url\(\s*[^)]*\)/gi) || []
  for (let i = 0; i < refs.length; i++) if (!/(?:["'(]\s*#)/.test(refs[i])) return null
  const inner = /<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/i.exec(svg)
  if (!inner) return null
  const vb = /viewBox\s*=\s*"([\d.\s-]+)"/i.exec(svg)
  return { svg: inner[1].trim(), vb: vb ? vb[1].trim() : '0 0 24 24', brand: true }
}

export interface DemoMessage {
  type: 'nd-demo'
  layout?: unknown
  /** page id or index to show */
  page?: unknown
  /** the resolved look (the variant's fields; kinds and fonts allowed) */
  theme?: unknown
  /** pack id and variant id: become data-theme-pkg / data-theme-variant */
  pkg?: unknown
  variant?: unknown
  css?: unknown
  fonts?: unknown
  icons?: unknown
  /** { "theme:<pack>/<file>": url } for a background image the look names */
  files?: unknown
  /** playing | last | empty */
  np?: unknown
}

const isObj = (v: unknown): v is { [k: string]: unknown } => !!v && typeof v === 'object' && !Array.isArray(v)

/** base64url(JSON) -> value, or null. For the `?d=` / `#d=` form. */
export function decodeDemoParam(s: string | null | undefined): unknown {
  if (!s || s.length > 400000) return null
  try {
    let b = s.replace(/-/g, '+').replace(/_/g, '/')
    while (b.length % 4) b += '='
    const bin = atob(b)
    let txt = ''
    for (let i = 0; i < bin.length; i++) txt += '%' + ('0' + bin.charCodeAt(i).toString(16)).slice(-2)
    return JSON.parse(decodeURIComponent(txt))
  } catch {
    return null
  }
}

/** A message from the URL or the parent -> one validated message, or null. */
export function asDemoMessage(d: unknown): DemoMessage | null {
  return isObj(d) && d.type === 'nd-demo' ? (d as unknown as DemoMessage) : null
}
export { isObj as demoIsObj }

/** Paths of an agent the demo must never call. The demo page is static: any other request is for its own files. */
const AGENT_PATH = /^\/(?:api|ws)(?:\/|$)/

/**
 * Runtime guard for the demo: fetch, XHR, WebSocket, EventSource and sendBeacon refuse anything that is not a file of the demo's own origin,
 * and anything under /api or /ws. Every refused attempt is recorded in the returned list (empty in a healthy demo). The page's CSP
 * (connect-src 'self', default-src 'none') is the second layer that the browser itself enforces.
 */
export function installNetGuard(w: { [k: string]: any }, origin: string): string[] {
  const attempts: string[] = []
  const bad = (u: unknown): boolean => {
    let abs: URL
    try { abs = new URL(String(u), origin + '/') } catch { return true }
    if (abs.protocol === 'data:' || abs.protocol === 'blob:') return false
    return abs.origin !== origin || AGENT_PATH.test(abs.pathname)
  }
  const refuse = (kind: string, u: unknown): Error => { attempts.push(kind + ' ' + String(u).slice(0, 120)); return new Error('the demo deck makes no network requests') }
  if (typeof w.fetch === 'function') {
    const f = w.fetch.bind(w)
    w.fetch = (input: unknown, init?: unknown) => {
      const u = input && typeof input === 'object' && 'url' in (input as object) ? (input as { url: string }).url : input
      return bad(u) ? Promise.reject(refuse('fetch', u)) : f(input, init)
    }
  }
  if (w.XMLHttpRequest && w.XMLHttpRequest.prototype) {
    const open = w.XMLHttpRequest.prototype.open
    w.XMLHttpRequest.prototype.open = function (this: unknown, _m: string, u: string) {
      if (bad(u)) throw refuse('xhr', u)
      return open.apply(this, arguments as unknown as unknown[])
    }
  }
  for (const name of ['WebSocket', 'EventSource']) {
    if (w[name]) w[name] = function (u: unknown) { throw refuse(name, u) }
  }
  if (w.navigator && typeof w.navigator.sendBeacon === 'function') w.navigator.sendBeacon = (u: unknown) => { refuse('beacon', u); return false }
  return attempts
}
