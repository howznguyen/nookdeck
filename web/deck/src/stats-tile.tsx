import { useEffect, useRef, useState } from 'preact/hooks'
import { t, getLang } from './i18n'
import { linePath, areaPath, type Point } from './charts'
import { BarSpark, windowSeries } from './metric-charts'
import { AnimatedNumber, BAND_COLOR, DeltaPill } from './knowns'
import { tint } from './theme'
import { axisGutter, axisTops, procShare, shareText, valueEm, barFit, bootAt, labelW, pickFit, textW, chartDomain, coreGroups, gbText, loadBand, loadPerCore, loadText, memParts, minMax, placePoints, statBox, statSize, uptimeText, type StatBox } from './stats-logic'
import type { MetricChart, ProcInfo, Stats } from './types'
import './stats-tile.css'

/**
 * The system stat tiles (cpu, gpu, memory, network, load, uptime) for the default look and the history charts
 * (sparkline / area / bars / number). Layout per size from stats-logic.ts (statBox): 1x1 value + meter; 2x1 label, value
 * and a full-width sparkline; 2x2 big value, sub line, chart across the bottom; 3x2 / 4x2 header + side panel (per-core
 * bars, memory legend, load 1/5/15, VRAM) + an area chart with a light grid and min/max; 4x3+ adds the top processes.
 * One hierarchy: the label and secondary text muted, the value in the text colour, the metric's accent only on the chart,
 * colour for state only (the band dot). Charts never animate; numbers tween through AnimatedNumber (reduced motion: none).
 */

export interface StatHist {
  cpu: number[]
  mem: number[]
  rx: number[]
  tx: number[]
  load: number[]
  gpu?: number[]
}

export interface StatTileProps {
  kind: string
  s: Stats | null
  hist: StatHist
  tw: number
  th: number
  showLabel: boolean
  label: string
  color: string
  textColor?: string
  chart?: MetricChart
  windowSec: number
  showDelta: boolean
  showSub: boolean
  preview: boolean
}

const GB = 1024 * 1024 * 1024

/** bytes/s -> ["7.9", "MB/s"] (same steps as widgets.tsx fmtRate) */
function rate(bps: number): [string, string] {
  const v = Math.max(0, bps || 0)
  if (v >= GB) return [(v / GB).toFixed(1), 'GB/s']
  if (v >= 1048576) return [(v / 1048576).toFixed(1), 'MB/s']
  if (v >= 1024) return [Math.round(v / 1024) + '', 'KB/s']
  return [Math.round(v) + '', 'B/s']
}
const rateStr = (bps: number) => rate(bps).join(' ')
const mbOrGb = (b: number) => (b >= GB ? gbText(b) + ' GB' : Math.round(b / 1048576) + ' MB')

// ---------- top processes: the deck registers how to ask the agent; tiles poll at most every 5 s while shown ----------

type ProcSource = (sort: 'cpu' | 'mem', limit: number) => Promise<{ ok: boolean; list: ProcInfo[] }>
let procSource: ProcSource | null = null
export function setProcessSource(fn: ProcSource | null) {
  procSource = fn
}
const PROC_MS = 5000
const SAMPLE_PROCS: ProcInfo[] = [
  { pid: 1, name: 'Safari', cpu: 24.1, mem: 1.9 * GB },
  { pid: 2, name: 'Code Helper', cpu: 12.6, mem: 1.2 * GB },
  { pid: 3, name: 'WindowServer', cpu: 8.3, mem: 0.6 * GB },
  { pid: 4, name: 'nookdeck', cpu: 2.1, mem: 0.2 * GB },
  { pid: 5, name: 'Music', cpu: 1.4, mem: 0.3 * GB },
]

function useTop(sort: 'cpu' | 'mem', n: number, preview: boolean): ProcInfo[] | null {
  const [list, setList] = useState<ProcInfo[] | null>(null)
  useEffect(() => {
    if (!n || preview) return
    let alive = true
    const go = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      if (!procSource) return
      procSource(sort, n).then(
        (r) => {
          if (alive && r.ok) setList(r.list.slice(0, n))
        },
        () => undefined
      )
    }
    go()
    const id = setInterval(go, PROC_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [sort, n, preview])
  if (preview && n) return sortProcs(SAMPLE_PROCS, sort).slice(0, n)
  return list
}
const sortProcs = (l: ProcInfo[], sort: 'cpu' | 'mem') => l.slice().sort((a, b) => (sort === 'cpu' ? b.cpu - a.cpu : b.mem - a.mem))

// ---------- the chart ----------

interface Series {
  values: number[]
  color: string
  area: number
  width: number
  dot: boolean
}

let uid = 0

/** Real px width and height (no stretched viewBox), newest point at the right, a faint baseline across the full width. */
function StatChart(props: { w: number; h: number; series: Series[]; lo: number; hi: number; slots: number; grid: boolean; mm?: { min: number; max: number; minText: string; maxText: string } | null }) {
  const id = useRef(0)
  if (!id.current) id.current = ++uid
  const inset = 3
  // peak / low sit in a gutter right of the plot at the height of their values, never on the line
  const gut = props.mm ? axisGutter([props.mm.minText, props.mm.maxText]) : 0
  const pw = props.w - gut
  const yOf = (v: number) => props.h - inset - ((Math.min(props.hi, Math.max(props.lo, v)) - props.lo) / (props.hi > props.lo ? props.hi - props.lo : 1)) * (props.h - inset * 2)
  const tops = props.mm ? axisTops(yOf(props.mm.max), yOf(props.mm.min), props.h, props.mm.minText === props.mm.maxText) : null
  const gid = 'pd-stg' + id.current
  const lines: any[] = []
  if (props.grid) {
    for (let k = 1; k <= 3; k++) {
      const y = Math.round(inset + ((props.h - inset * 2) * k) / 4) + 0.5
      lines.push(<line key={'g' + k} x1="0" x2={pw} y1={y} y2={y} class="pd-sys__grid" />)
    }
  }
  const base = props.h - inset + 0.5
  lines.push(<line key="b" x1="0" x2={pw} y1={base} y2={base} class="pd-sys__base" />)
  const main = props.series[0]
  const paths: any[] = []
  let dot: any = null
  for (let i = props.series.length - 1; i >= 0; i--) {
    const se = props.series[i]
    const pts = placePoints(se.values, pw, props.h, props.lo, props.hi, props.slots, inset) as Point[]
    if (!pts.length) continue
    if (se.area > 0 && pts.length > 1) paths.push(<path key={'a' + i} d={areaPath(pts, props.h - inset, true)} fill={'url(#' + gid + ')'} />)
    if (pts.length > 1) paths.push(<path key={'l' + i} d={linePath(pts, true)} fill="none" stroke={se.color} stroke-width={se.width} stroke-linecap="round" stroke-linejoin="round" />)
    if (se.dot) {
      const p = pts[pts.length - 1]
      dot = <circle cx={p.x} cy={p.y as number} r="2.5" fill={se.color} />
    }
  }
  return (
    <div class="pd-sys__chart" data-part="chart" style={{ height: props.h + 'px' }} aria-hidden="true">
      <svg width={props.w} height={props.h} viewBox={'0 0 ' + props.w + ' ' + props.h}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color={main ? main.color : '#888'} stop-opacity={main ? main.area : 0} />
            <stop offset="1" stop-color={main ? main.color : '#888'} stop-opacity="0" />
          </linearGradient>
        </defs>
        {lines}
        {paths}
        {dot}
      </svg>
      {props.mm && tops ? (
        <span class="pd-sys__mm" data-part="num" style={{ width: gut + 'px' }}>
          <span style={{ top: tops.peak + 'px' }}>{props.mm.maxText}</span>
          {tops.low !== null ? <span style={{ top: tops.low + 'px' }}>{props.mm.minText}</span> : null}
        </span>
      ) : null}
    </div>
  )
}

// ---------- small parts ----------

/** Bar fill as a scale of the full height (at least 2 px): transform only, so a change eases without layout work. */
const sy = (v: number, h: number) => (Math.max(2, (v / 100) * h) / Math.max(1, h)).toFixed(3)

function CoreBars(props: { cores: number[]; w: number; h: number; color: string }) {
  const f0 = barFit(props.cores.length, props.w)
  const vals = coreGroups(props.cores, f0.max)
  const f = barFit(vals.length, props.w)
  return (
    <div class="pd-sys__cores" style={{ height: props.h + 'px' }} aria-hidden="true">
      {vals.map((v, i) => (
        <span key={i} class="pd-sys__core" style={{ width: f.bar + 'px', marginLeft: (i ? f.gap : 0) + 'px' }}>
          <i style={{ background: props.color, WebkitTransform: 'scaleY(' + sy(v, props.h) + ')', transform: 'scaleY(' + sy(v, props.h) + ')' }} />
        </span>
      ))}
    </div>
  )
}

/** One row of legend items under the memory bar; items drop from the end until the rest fits whole. */
function LegendRow(props: { items: { dot?: string; k: string; v: string }[]; w: number; px: number }) {
  const gap = 12
  const wOf = (it: { dot?: string; k: string; v: string }) => (it.dot ? 12 : 0) + textW(it.k + ' ' + it.v, props.px)
  let items = props.items
  const total = () => items.reduce((a, it) => a + wOf(it), 0) + gap * Math.max(0, items.length - 1)
  while (items.length > 1 && total() > props.w) items = items.slice(0, -1)
  if (total() > props.w) items = []
  return (
    <div class="pd-sys__lrowh" style={{ fontSize: props.px + 'px' }}>
      {items.map((r, i) => (
        <span class="pd-sys__litem" key={r.k} style={{ marginLeft: i ? gap + 'px' : 0 }}>
          {r.dot ? <i class="pd-sys__dot" style={{ background: r.dot }} /> : null}
          {r.k}
          <span class="pd-sys__lv" data-part="num">
            {r.v}
          </span>
        </span>
      ))}
    </div>
  )
}

function Legend(props: { rows: { dot?: string; k: string; v: string }[]; px: number }) {
  return (
    <div class="pd-sys__legend" style={{ fontSize: props.px + 'px' }}>
      {props.rows.map((r) => (
        <div class="pd-sys__lrow" key={r.k}>
          {r.dot ? <i class="pd-sys__dot" style={{ background: r.dot }} /> : null}
          <span class="pd-sys__lk">{r.k}</span>
          <span class="pd-sys__lv" data-part="num">
            {r.v}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Since text: "Sat 22 Nov, 21:14" in the deck language; numeric when Intl cannot. */
function sinceText(ms: number): string {
  const d = new Date(ms)
  const tag = getLang() === 'en' ? 'en-GB' : getLang()
  try {
    return new Intl.DateTimeFormat(tag, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  } catch (e) {
    const p = (n: number) => (n < 10 ? '0' : '') + n
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
  }
}

/** Shorter since text: "22 Nov 21:14". */
function sinceShort(ms: number): string {
  const d = new Date(ms)
  const tag = getLang() === 'en' ? 'en-GB' : getLang()
  try {
    return new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  } catch (e) {
    return sinceText(ms)
  }
}

const deltaOf = (a: number[]): number | null => {
  const r = a.slice(-30)
  return r.length >= 8 ? r[r.length - 1] - r[0] : null
}
const cpuBand = (v: number) => (v < 60 ? 'good' : v < 85 ? 'watch' : 'risk')
const BAND_TEXT: { [k: string]: string } = { good: 'Normal', watch: 'Elevated', risk: 'Overloaded' }

// ---------- the tile ----------

interface Model {
  value: number
  fmt: (n: number) => string
  unit: string
  dash: boolean
  sub: string
  /** shorter forms of the sub text, tried in order before the sub is dropped */
  subs: string[]
  band: string
  delta: { v: number; unit: string; dec: number; tone?: 'warn' | 'bad' } | null
  hist: number[] | null
  extra: number[] | null
  kindDomain: string
  meter: number | null
  procs: 'cpu' | 'mem' | null
}

function modelOf(kind: string, s: Stats | null, h: StatHist, size: string): Model {
  const mini = size === 'mini'
  const m: Model = { value: 0, fmt: (n) => String(Math.round(n)), unit: '', dash: !s, sub: '', subs: [], band: '', delta: null, hist: null, extra: null, kindDomain: kind, meter: null, procs: null }
  if (!s) return m
  if (kind === 'cpu') {
    m.value = s.cpu
    m.unit = '%'
    m.hist = h.cpu
    m.meter = s.cpu
    m.band = cpuBand(s.cpu)
    m.sub = t(BAND_TEXT[m.band])
    const d = deltaOf(h.cpu)
    // the chip is only coloured when the status says so too: "Normal" next to a red chip reads as a contradiction
    if (d !== null) m.delta = { v: d, unit: '%', dec: 0, tone: d >= 20 && m.band !== 'good' ? 'bad' : undefined }
    m.procs = 'cpu'
  } else if (kind === 'gpu') {
    if (!s.gpu) {
      m.dash = true
      m.sub = t('No GPU data')
      return m
    }
    m.value = s.gpu.util
    m.unit = '%'
    m.hist = h.gpu || []
    m.meter = s.gpu.util
    m.sub = s.gpu.name || ''
    const d = deltaOf(m.hist)
    if (d !== null) m.delta = { v: d, unit: '%', dec: 0, tone: d >= 20 && cpuBand(s.gpu.util) !== 'good' ? 'bad' : undefined }
  } else if (kind === 'memory') {
    m.value = s.memUsed / GB
    m.fmt = (n) => (n >= 100 ? String(Math.round(n)) : n.toFixed(1))
    m.unit = 'GB'
    m.hist = h.mem
    m.meter = s.memTotal ? (s.memUsed / s.memTotal) * 100 : 0
    m.sub = '/ ' + Math.round(s.memTotal / GB) + ' GB · ' + Math.round(m.meter) + '%'
    m.subs = ['/ ' + Math.round(s.memTotal / GB) + ' GB']
    const d = deltaOf(h.mem)
    if (d !== null) {
      const g = (d / 100) * (s.memTotal / GB)
      m.delta = { v: g, unit: ' GB', dec: 1, tone: g >= 1 ? 'warn' : undefined }
    }
    m.procs = 'mem'
  } else if (kind === 'network') {
    const r = rate(s.net ? s.net.rx : 0)
    m.value = parseFloat(r[0])
    const dec = r[0].indexOf('.') >= 0 ? 1 : 0
    m.fmt = (n) => n.toFixed(dec)
    m.unit = r[1]
    m.hist = h.rx
    m.extra = h.tx
    m.sub = '↑ ' + rateStr(s.net ? s.net.tx : 0)
  } else if (kind === 'load') {
    const l = s.load || []
    const l1 = Number(l[0] || 0)
    const per = loadPerCore(l1, s.ncpu)
    m.hist = h.load
    if (per === null) {
      m.kindDomain = 'load-raw'

      m.value = l1
      m.fmt = (n) => n.toFixed(mini ? 1 : 2)
      m.sub = Number(l[1] || 0).toFixed(1) + ' / ' + Number(l[2] || 0).toFixed(1)
    } else {
      const n = s.ncpu || 1
      m.hist = h.load.map((v) => v / n)
      m.value = per
      m.fmt = loadText
      m.unit = mini ? '' : size === 'strip' ? t('/ core') : t('per core')
      m.band = loadBand(per)
      m.meter = Math.min(100, per * 100)
      m.sub = t('{0} on {1} cores', l1.toFixed(1), s.ncpu || 0)
      m.subs = [l1.toFixed(1) + ' / ' + (s.ncpu || 0)]
    }
  } else if (kind === 'uptime') {
    m.value = s.uptime
    m.fmt = (n) => uptimeText(n, mini)
    const boot = bootAt(s.time || Date.now(), s.uptime)
    m.sub = t('since {0}', sinceText(boot))
    m.subs = [t('since {0}', sinceShort(boot))]
  }
  return m
}

export function StatTile(p: StatTileProps) {
  const s = p.s
  const kind = p.kind
  const m = modelOf(kind, s, p.hist, statSize(p.tw, p.th))
  const chartKind = p.chart || 'auto'
  const hasHist = !!m.hist && chartKind !== 'number' && !m.dash
  const valueText = m.dash ? '-' : m.fmt(m.value)
  const wideKind = kind === 'cpu' ? !!(s && s.cores && s.cores.length > 1) : kind === 'load' || (kind === 'gpu' && !!(s && s.gpu && (s.gpu.memUsed !== undefined || s.gpu.temp !== undefined)))
  // the caption is shortened ("SYSTEM LOAD" -> "LOAD") rather than cut with an ellipsis
  const sz = statSize(p.tw, p.th)
  const approxW = p.tw - 30
  const labelRoom = sz === 'strip' ? approxW * 0.5 : sz === 'mini' ? p.tw - 16 : wideKind && (sz === 'wide' || sz === 'big') ? approxW * 0.55 : approxW
  const label = kind === 'load' ? pickFit([p.label, t('Load').toUpperCase()], labelRoom, sz === 'mini' ? 10 : 11, labelW) || t('Load').toUpperCase() : p.label
  const subCands = [m.sub].concat(m.subs).filter(Boolean)
  const b: StatBox = statBox(p.tw, p.th, {
    labelText: label,
    subText: subCands.length ? subCands[subCands.length - 1] : '',
    label: p.showLabel,
    value: valueText,
    unit: m.dash ? '' : m.unit,
    chart: hasHist || (p.tw < 120 && p.th < 120 && m.meter !== null && !m.dash),
    side: wideKind && p.showSub,
    bar: kind === 'memory' && p.showSub,
    procs: !!m.procs,
  })
  const procs = useTop(m.procs || 'cpu', b.rows, p.preview)
  const muted = p.textColor || undefined
  const color = p.color
  const accent2 = tint(color, 0.45) || color

  const labelEl = p.showLabel ? (
    <div class="pd-sys__label" data-part="tile-label" style={{ fontSize: b.labelPx + 'px', color: muted }}>
      {label}
    </div>
  ) : null
  const numEl = (
    <div class="pd-sys__value" data-part="tile-value" style={{ fontSize: b.valuePx + 'px', color: p.textColor || undefined }}>
      {m.dash ? '-' : <AnimatedNumber value={m.value} format={m.fmt} />}
      {m.unit && !m.dash ? <span class="pd-sys__unit" style={{ fontSize: Math.max(10, Math.round(b.valuePx * 0.42)) + 'px' }}>{' ' + m.unit}</span> : null}
    </div>
  )
  const bandDot = m.band ? <i class="pd-sys__dot" style={{ background: BAND_COLOR[m.band] }} /> : null
  const netDots = kind === 'network'
  // the sub text in the longest form that fits whole (else nothing), then the delta chip only if it still fits beside it
  const headW = b.w - (b.sideW ? b.sideW + 12 : 0)
  const valueW = valueEm(valueText, m.dash ? '' : m.unit) * b.valuePx
  const subEl = (withDelta: boolean, avail?: number) => {
    if (!p.showSub || !subCands.length) return null
    const dotW = netDots || bandDot ? 12 : 0
    const room = (avail === undefined ? headW : avail) - dotW
    const text = pickFit(subCands, room, b.subPx)
    if (!text) return null
    const pillText = m.delta ? (m.delta.v >= 0 ? '+' : '-') + Math.abs(m.delta.v).toFixed(m.delta.dec) + m.delta.unit : ''
    const pill = withDelta && p.showDelta && m.delta && room - textW(text, b.subPx) - 6 >= textW(pillText, 11) + 26
    return (
      <div class="pd-sys__sub" data-part="tile-sub" style={{ fontSize: b.subPx + 'px', color: muted }}>
        {netDots ? <i class="pd-sys__dot" style={{ background: accent2 }} /> : bandDot}
        <span class="pd-sys__subt">{text}</span>
        {pill && m.delta ? <DeltaPill value={m.delta.v} unit={m.delta.unit} decimals={m.delta.dec} tone={m.delta.tone} size={11} /> : null}
      </div>
    )
  }

  // chart series in the shown window
  const winSlots = 60
  const ser = hasHist && m.hist ? windowSeries(m.hist, p.windowSec, winSlots) : []
  const exSer = hasHist && m.extra ? windowSeries(m.extra, p.windowSec, winSlots) : []
  const dom = m.kindDomain === 'load-raw' ? chartDomain('load', ser, s ? s.ncpu : undefined) : chartDomain(m.kindDomain, ser.concat(exSer), kind === 'load' ? 1 : undefined)
  const chartEl = (h: number, grid: boolean) => {
    if (!hasHist || h <= 0) return null
    if (chartKind === 'bars') {
      const slots = Math.max(12, Math.min(60, Math.floor(b.w / 5)))
      return <BarSpark values={windowSeries(m.hist || [], p.windowSec, slots)} color={color} height={h} slots={slots} domain={dom} />
    }
    const mm = grid ? minMax(ser) : null
    const mmText = mm ? { min: mm.min, max: mm.max, minText: fmtFor(kind, mm.min), maxText: fmtFor(kind, mm.max) } : null
    const series: Series[] = [{ values: ser, color: color, area: chartKind === 'area' || grid ? 0.22 : 0.14, width: 1.5, dot: true }]
    if (exSer.length) series.push({ values: exSer, color: accent2, area: 0, width: 1.25, dot: false })
    return <StatChart w={b.w} h={h} series={series} lo={dom[0]} hi={dom[1]} slots={winSlots} grid={grid} mm={mmText} />
  }

  const rootStyle = { padding: b.pad + 'px' }

  // 1x1: label, value, a thin meter
  if (b.size === 'mini') {
    return (
      <div class="pd-sys pd-sys--mini" style={rootStyle} data-size-class="mini">
        {labelEl}
        <div class="pd-sys__fill">{numEl}</div>
        {b.chartH && m.meter !== null ? (
          <div class="pd-sys__meter" style={{ height: b.chartH + 'px', borderRadius: b.chartH + 'px' }} aria-hidden="true">
            <i style={{ width: Math.min(100, Math.max(0, m.meter)) + '%', background: m.band === 'risk' ? BAND_COLOR.risk : color }} />
          </div>
        ) : null}
      </div>
    )
  }

  // one row high: label left, value right, the chart across the full width under them
  if (b.size === 'strip') {
    if (!b.chartH) {
      return (
        <div class="pd-sys pd-sys--strip pd-sys--stack" style={rootStyle}>
          {labelEl}
          {b.subInline ? (
            <div class="pd-sys__fill pd-sys__fill--row">
              {numEl}
              {subEl(false, b.w - valueW - 12)}
            </div>
          ) : (
            <div class="pd-sys__fill pd-sys__fill--col">
              {numEl}
              {b.sub ? subEl(false, b.w) : null}
            </div>
          )}
        </div>
      )
    }
    return (
      <div class="pd-sys pd-sys--strip" style={rootStyle}>
        <div class="pd-sys__head">
          {labelEl}
          {b.sub ? subEl(false, b.w - labelW(label, b.labelPx) - valueW - 20) : null}
          <div class="pd-sys__grow" />
          {numEl}
        </div>
        <div class="pd-sys__grow" />
        {chartEl(b.chartH, false)}
      </div>
    )
  }

  // block / wide / big
  const headH = b.labelH + (b.labelH ? 4 : 0) + b.valuePx + (b.sub ? 6 + 15 : 0)
  let side: any = null
  if (b.sideW && s) {
    if (kind === 'cpu' && s.cores && s.cores.length > 1) {
      side = <CoreBars cores={s.cores} w={b.sideW} h={Math.max(16, headH - 4)} color={color} />
    } else if (kind === 'load' && s.load) {
      const rows = [
        { k: t('1 min'), v: loadText(Number(s.load[0] || 0)) },
        { k: t('5 min'), v: loadText(Number(s.load[1] || 0)) },
        { k: t('15 min'), v: loadText(Number(s.load[2] || 0)) },
      ]
      side = <Legend rows={rows.slice(0, Math.max(1, Math.floor(headH / 15)))} px={11} />
    } else if (kind === 'gpu' && s.gpu) {
      const rows: { dot?: string; k: string; v: string }[] = []
      if (typeof s.gpu.memUsed === 'number') rows.push({ k: t('VRAM'), v: s.gpu.memTotal ? mbOrGb(s.gpu.memUsed) + ' / ' + mbOrGb(s.gpu.memTotal) : mbOrGb(s.gpu.memUsed) })
      if (typeof s.gpu.temp === 'number') rows.push({ k: t('Temp'), v: Math.round(s.gpu.temp) + '°' })
      if (rows.length) side = <Legend rows={rows} px={11} />
    }
  }
  // memory: the used / cached / free bar, and its legend in one row under it (values whole, items dropped from the end)
  let bar: any = null
  if (b.barH && s && kind === 'memory') {
    const mp = memParts(s.memUsed, s.memTotal, s.mem ? s.mem.cached : undefined)
    const items: { dot?: string; k: string; v: string }[] = []
    if (s.mem && s.mem.cached !== undefined) items.push({ dot: accent2, k: t('Cached'), v: gbText(mp.cached * s.memTotal) + ' GB' })
    items.push({ dot: 'var(--pd-sys-track)', k: t('Free'), v: gbText(mp.free * s.memTotal) + ' GB' })
    if (s.mem && s.mem.swapTotal) items.push({ k: t('Swap'), v: gbText(s.mem.swapUsed || 0) + ' / ' + gbText(s.mem.swapTotal) + ' GB' })
    bar = (
      <div style={{ marginTop: '6px' }}>
        <div class="pd-sys__parts" style={{ height: b.barH + 'px', borderRadius: b.barH + 'px' }} aria-hidden="true">
          <i style={{ width: mp.used * 100 + '%', background: color }} />
          <i style={{ width: mp.cached * 100 + '%', background: accent2 }} />
        </div>
        {b.legendH ? <LegendRow items={items} w={b.w} px={11} /> : null}
      </div>
    )
  }
  // top processes as a share of the whole machine, the same scale as the big number: ps gives per-core percent
  // (196% = two cores busy), so cpu is divided by the core count; memory is a share of the total; the bar is that share
  const rows = procs && b.rows ? procs.slice(0, b.rows) : null
  const ncpu = s && s.ncpu ? s.ncpu : 1
  const memTotal = s && s.memTotal ? s.memTotal : 1
  return (
    <div class={'pd-sys pd-sys--' + b.size} style={rootStyle}>
      <div class="pd-sys__top" style={{ height: headH + 'px' }}>
        <div class="pd-sys__headcol">
          {labelEl}
          {numEl}
          {b.sub ? subEl(b.size !== 'block' || !m.band) : null}
        </div>
        {side ? (
          <div class="pd-sys__side" style={{ width: b.sideW + 'px' }}>
            {side}
          </div>
        ) : null}
      </div>
      {bar}
      <div class="pd-sys__grow" />
      {b.chartH ? chartEl(b.chartH, b.grid) : null}
      {rows && rows.length ? (
        <div class="pd-sys__procs" style={{ marginTop: '6px' }}>
          {rows.map((r) => {
            const share = m.procs === 'mem' ? procShare(r.mem, memTotal) : procShare(r.cpu / 100, ncpu)
            return (
              <div class="pd-sys__proc" key={r.pid} style={{ height: b.rowH + 'px' }}>
                <span class="pd-sys__pn">{r.name}</span>
                <span class="pd-sys__pv" data-part="num">
                  {m.procs === 'mem' ? mbOrGb(r.mem) : shareText(share)}
                </span>
                <i class="pd-sys__pb" style={{ width: Math.max(2, Math.round(share)) + '%', background: color }} />
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/** Min / max label text per kind. */
function fmtFor(kind: string, v: number): string {
  if (kind === 'network') return rateStr(v)
  if (kind === 'load') return loadText(v)
  return Math.round(v) + '%'
}
