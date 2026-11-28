import { QuotaWidget, SessionsWidget } from './ai'
import { t } from './i18n'
import { getPlatform } from './platform'
import { formatTemp, tempUnit } from './temp'
import type { AiWidgetProps } from './ai'
import { Rings, SlotSpark } from './charts'
import { Donut, MeterBar, windowSeries } from './metric-charts'
import { NowPlayingTile } from './now-playing'
import { ClockWidget } from './clocks'
import { PluginTile } from './plugin'
import { clockWeatherOf, sampleWeatherSlot, type PluginSlot } from './plugin-logic'
import { EntityTile } from './entity'
import { CameraTile } from './camera'
import { NotificationsTile, ValueTile } from './automation'
import { WeatherTile } from './weather-tile'
import { StatTile } from './stats-tile'
import { AnimatedNumber, BAND_COLOR, DeltaPill, Gauge, type Band } from './knowns'
import { tint, chartColor } from './theme'
import type { AiData, ClockOptions, MetricOptions, QuotaOptions, EntityOptions, WeatherOptions, PushOptions, WeatherData, PushedValue, Notice, HassEntity, IconAssets, Media, MediaCommand, Stats, WidgetKind } from './types'

/** Live widgets: clock, cpu, memory, network, load, uptime, nowplaying. Sizes come from the tile (tw/th in px). */

export interface Hist {
  cpu: number[]
  mem: number[]
  rx: number[]
  tx: number[]
  load: number[]
  gpu?: number[]
}

/** ~15 min of 2 s samples (the longest chart window); charts downsample to their slot count */
export const HIST_LEN = 450

const GB = 1024 * 1024 * 1024

/** A built-in metric's own colour: the theme's chart colours in order when it has them. */
export function naturalColor(kind: string): string | undefined {
  return chartColor(['cpu', 'gpu', 'memory', 'network', 'load', 'uptime'].indexOf(kind), DEFAULT_COLOR[kind])
}
/** One calm accent per metric (mid tones that read on the dark and the light tile); state colours stay for state. */
export const DEFAULT_COLOR: { [k: string]: string } = {
  cpu: '#4fb3a6',
  gpu: '#8f86d9',
  memory: '#c98bb0',
  network: '#c9a25e',
  load: '#6fae8c',
  uptime: '#7c9fd0',
  clock: '#8b8b94',
}
const LABEL: { [k: string]: string } = {
  clock: 'Clock',
  cpu: 'CPU',
  gpu: 'GPU',
  memory: 'RAM',
  network: 'Network',
  load: 'System load',
  uptime: 'Uptime',
}

/** Font size (px) that keeps `chars` characters inside `avail` px (no clamp()/container queries on Safari 12). */
const fit = (chars: number, avail: number, max: number, min: number) => Math.max(min, Math.min(max, Math.floor(avail / (Math.max(1, chars) * 0.62))))

/** bytes/s -> ["7.9", "MB/s"] */
export function fmtRate(bps: number): [string, string] {
  const v = Math.max(0, bps || 0)
  if (v >= 1024 * 1024 * 1024) return [(v / (1024 * 1024 * 1024)).toFixed(1), 'GB/s']
  if (v >= 1024 * 1024) return [(v / (1024 * 1024)).toFixed(1), 'MB/s']
  if (v >= 1024) return [Math.round(v / 1024) + '', 'KB/s']
  return [Math.round(v) + '', 'B/s']
}

function fmtUptime(s: number, compact: boolean) {
  s = Math.max(0, Math.floor(s))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (compact) return d > 0 ? d + 'd' : h > 0 ? h + 'h' : m + 'm'
  return d > 0 ? d + 'd ' + h + 'h' : h + 'h ' + m + 'm'
}

export interface WidgetProps {
  kind: WidgetKind | string
  stats: Stats | null
  hist: Hist
  media: Media | null
  last: Media | null
  tw: number
  th: number
  /** grid span (cells) */
  cw?: number
  ch?: number
  scale: number
  showLabel: boolean
  /** item.color: tints the label and sparkline (widgets keep a neutral tile background) */
  color?: string
  /** item.textColor override */
  textColor?: string
  provider?: string
  clock?: ClockOptions
  metric?: MetricOptions
  quota?: QuotaOptions
  entity?: EntityOptions
  weather?: WeatherOptions
  push?: PushOptions
  wxData?: WeatherData
  pushed?: PushedValue
  plug?: PluginSlot | undefined
  plugStyle?: string
  onCard?: (action: string, args: { [k: string]: string | number | boolean } | undefined) => Promise<unknown>
  label?: string
  notes?: Notice[]
  hassEnt?: HassEntity
  hassForceOn?: boolean
  entPend?: number
  onStep?: (delta: number) => void
  onLight?: (op: string, value: unknown) => void
  hassConnected?: boolean
  assets?: IconAssets
  ai: AiData | null
  waitingProjects: string[]
  preview: boolean
  onMedia: (c: MediaCommand, app?: string) => Promise<unknown> | void
  onVolume: (v: { level: number } | { muted: boolean }) => Promise<unknown> | void
}

export function Widget(props: WidgetProps) {
  if (props.kind === 'clock') return <ClockWidget tw={props.tw} th={props.th} scale={props.scale} showLabel={props.showLabel} textColor={props.textColor} color={props.color} opts={props.clock} wx={props.clock && props.clock.style === 'weather' ? clockWeatherOf(props.preview ? sampleWeatherSlot() : props.plug, props.clock.weather && props.clock.weather.units ? (props.clock.weather.units === 'imperial' ? 'F' : 'C') : tempUnit()) : null} assets={props.assets} preview={props.preview} />
  if (props.kind === 'entity' && props.entity && props.entity.id.indexOf('camera.') === 0) return <CameraTile id={props.entity.id} cfg={props.entity} ent={props.hassEnt} connected={props.hassConnected !== false} showLabel={props.showLabel} preview={props.preview} />
  if (props.kind === 'entity' && props.entity) return <EntityTile id={props.entity.id} cfg={props.entity} ent={props.hassEnt} forceOn={props.hassForceOn} pend={props.entPend} onStep={props.onStep} onLight={props.onLight} connected={props.hassConnected !== false} tw={props.tw} th={props.th} scale={props.scale} showLabel={props.showLabel} color={props.color} textColor={props.textColor} assets={props.assets} />
  // the legacy weather and quota tiles are core plugins: when the plugin is off or missing, say so instead of showing stale data
  if ((props.kind === 'weather' || props.kind === 'quota') && props.plug && 'error' in props.plug) return <PluginTile entry={props.plug} tw={props.tw} th={props.th} showLabel={props.showLabel} color={props.color} textColor={props.textColor} assets={props.assets} label={props.label} />
  if (props.kind === 'weather') return <WeatherTile opts={props.weather} data={props.wxData} tw={props.tw} th={props.th} cw={props.cw} ch={props.ch} scale={props.scale} showLabel={props.showLabel} textColor={props.textColor} assets={props.assets} />
  if (props.kind === 'value' && props.push) return <ValueTile cfg={props.push} val={props.pushed} tw={props.tw} th={props.th} scale={props.scale} showLabel={props.showLabel} color={props.color} textColor={props.textColor} />
  if (props.kind === 'plugin') return <PluginTile onCard={props.onCard} style={props.plugStyle} entry={props.plug} tw={props.tw} th={props.th} showLabel={props.showLabel} color={props.color} textColor={props.textColor} assets={props.assets} label={props.label} />
  if (props.kind === 'notifications') return <NotificationsTile notes={props.notes || []} tw={props.tw} th={props.th} showLabel={props.showLabel} textColor={props.textColor} />
  if (props.kind === 'nowplaying') return <NowPlayingTile media={props.media} last={props.last} stats={props.stats} tw={props.tw} th={props.th} scale={props.scale} showLabel={props.showLabel} textColor={props.textColor} onMedia={props.onMedia} onVolume={props.onVolume} />
  if (props.kind === 'quota') return <QuotaWidget {...(props as AiWidgetProps)} />
  if (props.kind === 'sessions') return <SessionsWidget {...(props as AiWidgetProps)} />
  return <Metric {...props} />
}


/** First vs last sample of the history (~1 minute at one sample a second). */
const deltaOf = (a: number[]): number | null => {
  const r = a.slice(-30)
  return r.length >= 8 ? r[r.length - 1] - r[0] : null
}

const fmtVram = (b: number) => (b >= GB ? (b / GB).toFixed(1) + ' GB' : Math.round(b / (1024 * 1024)) + ' MB')
/** 'VRAM 2.1 / 8 GB' | 'GPU mem 420 MB', plus the temperature when known */
function gpuSub(g: NonNullable<Stats['gpu']>): string {
  let m = ''
  if (typeof g.memUsed === 'number') {
    if (g.memTotal && g.memTotal > 0) m = t('VRAM') + ' ' + (g.memUsed >= GB || g.memTotal >= GB ? (g.memUsed / GB).toFixed(1) + ' / ' + Math.round(g.memTotal / GB) + ' GB' : Math.round(g.memUsed / 1048576) + ' / ' + Math.round(g.memTotal / 1048576) + ' MB')
    else m = t('GPU mem') + ' ' + fmtVram(g.memUsed)
  }
  const tp = typeof g.temp === 'number' ? formatTemp(g.temp, 'C', undefined, 0) : ''
  return m && tp ? m + ' · ' + tp : m || tp
}

/** cpu < 60 good, < 85 watch, else risk (agent-health-utils.ts: statusFromThresholds with lower-is-better cuts). */
const cpuBand = (v: number): Band => (v < 60 ? 'good' : v < 85 ? 'watch' : 'risk')
const LOAD_LABEL: { [k: string]: string } = { loadavg: 'System load', queue: 'CPU queue', estimate: 'Load (est.)' }
/** stats.loadKind (also accepted as stats.load.kind) */
const loadKindOf = (s: Stats | null): string => (s ? s.loadKind || ((s.load as unknown as { kind?: string }) || {}).kind || '' : '')
const BAND_TEXT: { [k: string]: string } = { good: 'Normal', watch: 'Elevated', risk: 'Overloaded' }

/**
 * cpu / memory / load / network / uptime. Look of Knowns UI live-metrics.tsx (MetricCard number + DeltaPill + Chart line with
 * slots and endDot). Network uses the same Sparkline with a thin tx line on a shared scale; a big cpu tile uses the agent-health gauge.
 */
function Metric(props: WidgetProps) {
  const s = props.stats
  const kind = props.kind
  const color = props.color || naturalColor(kind) || '#8b8b94'
  const compact = props.tw < 120
  let num = 0
  let fmt: (n: number) => string = (n) => String(Math.round(n))
  let unit = ''
  let sub = ''
  let data: number[] | null = null
  let delta: { v: number; unit: string; dec: number; tone?: 'warn' | 'bad' } | null = null
  if (s) {
    if (kind === 'gpu') {
      if (s.gpu) {
        num = Math.round(s.gpu.util)
        unit = '%'
        sub = gpuSub(s.gpu)
        data = props.hist.gpu || []
        const d = deltaOf(data)
        if (d !== null) delta = { v: d, unit: '%', dec: 0, tone: d >= 20 ? 'bad' : undefined }
      }
    } else if (kind === 'cpu') {
      num = Math.round(s.cpu)
      unit = '%'
      data = props.hist.cpu
      const d = deltaOf(props.hist.cpu)
      if (d !== null) delta = { v: d, unit: '%', dec: 0, tone: d >= 20 ? 'bad' : undefined }
    } else if (kind === 'memory') {
      num = s.memUsed / GB
      fmt = (n) => n.toFixed(1)
      unit = 'GB'
      sub = '/ ' + Math.round(s.memTotal / GB) + ' GB'
      data = props.hist.mem
      const d = deltaOf(props.hist.mem)
      if (d !== null) {
        const g = (d / 100) * (s.memTotal / GB)
        delta = { v: g, unit: ' GB', dec: 1, tone: g >= 1 ? 'warn' : undefined }
      }
    } else if (kind === 'network') {
      const r = fmtRate(s.net ? s.net.rx : 0)
      num = parseFloat(r[0])
      const dec = r[0].indexOf('.') >= 0 ? 1 : 0
      fmt = (n) => n.toFixed(dec)
      unit = r[1]
      data = props.hist.rx
    } else if (kind === 'load') {
      const l = s.load || []
      num = Number(l[0] || 0)
      const dec = compact ? 1 : 2
      fmt = (n) => n.toFixed(dec)
      sub = Number(l[1] || 0).toFixed(1) + ' / ' + Number(l[2] || 0).toFixed(1)
      data = props.hist.load
      const d = deltaOf(props.hist.load)
      // a Windows agent without a load kind that always reports 0 has nothing to compare: no flat delta pill
      const flatZero = !loadKindOf(s) && getPlatform() === 'win32' && props.hist.load.every((v) => v === 0)
      if (d !== null && !flatZero) delta = { v: d, unit: '', dec: 2 }
    } else if (kind === 'uptime') {
      num = s.uptime
      fmt = (n) => fmtUptime(n, compact)
    }
  }
  const label = (kind === 'load' ? t(LOAD_LABEL[loadKindOf(s) || 'loadavg'] || 'System load') : LABEL[kind] ? t(LABEL[kind]) : String(kind)).toUpperCase()
  const pad = props.tw >= 170 ? 16 : props.tw >= 120 ? 12 : 8
  const avail = Math.max(20, props.tw - pad * 2)

  // ----- chart choice (item.metric): defaults cpu gauge on square-ish tiles, else sparkline -----
  const mo = props.metric || {}
  const noGpu = kind === 'gpu' && !(s && s.gpu)
  const pctKind = kind === 'cpu' || kind === 'memory' || kind === 'gpu'
  const pct = !s ? 0 : kind === 'gpu' ? (s.gpu ? s.gpu.util : 0) : kind === 'cpu' ? s.cpu : kind === 'memory' && s.memTotal ? (s.memUsed / s.memTotal) * 100 : 0
  // the default look and the history charts are the stat tiles (stats-tile.tsx); gauge / ring / donut / bar stay below
  const base = 'auto'
  let chart: string = mo.chart || base
  if (!pctKind && (chart === 'gauge' || chart === 'ring' || chart === 'bar' || chart === 'donut')) chart = base
  if ((kind === 'cpu' || kind === 'gpu') && chart === 'donut') chart = 'ring'
  if (noGpu) chart = 'number'
  if (kind === 'uptime') chart = 'number'
  if (chart === 'auto' || chart === 'sparkline' || chart === 'area' || chart === 'bars' || chart === 'number' || !s) {
    return (
      <StatTile
        kind={kind}
        s={s}
        hist={props.hist}
        tw={props.tw}
        th={props.th}
        showLabel={props.showLabel}
        label={label}
        color={color}
        textColor={props.textColor}
        chart={chart === 'auto' ? undefined : (chart as MetricOptions['chart'])}
        windowSec={mo.window || 120}
        showDelta={mo.showDelta !== false}
        showSub={mo.showSub !== false}
        preview={props.preview}
      />
    )
  }
  const showDeltaOpt = mo.showDelta !== false
  const showSubOpt = mo.showSub !== false
  const winSec = mo.window || 120
  const tc0 = props.textColor || undefined
  const lh = props.showLabel ? 16 : 0
  const band = cpuBand(pct)
  const labelEl = props.showLabel ? (
    <div class="pd-ml" data-part="tile-label" style={{ fontSize: '11px', color: props.textColor || color }}>
      {label}
    </div>
  ) : null
  const deltaEl = (size: number) => (delta && showDeltaOpt ? <DeltaPill value={delta.v} unit={delta.unit} decimals={delta.dec} tone={delta.tone} size={size} /> : null)
  const bigNum = (size: number) => (
    <div class="pd-mv" data-part="tile-value" style={{ fontSize: size + 'px', color: tc0 }}>
      <AnimatedNumber value={num} format={fmt} />
      {unit ? <span class="pd-mu" style={{ fontSize: Math.max(9, Math.round(size * 0.42)) + 'px' }}>{' ' + unit}</span> : null}
    </div>
  )

  // gauge: agent-health arc
  if (chart === 'gauge' && s) {
    const sparkRoom = props.th >= 210 && data && (kind === 'cpu' || kind === 'gpu') ? 40 : 0
    const statH = props.th >= 120 ? 30 : 0
    const gSize = Math.max(44, Math.min(avail, Math.floor((props.th - pad * 2 - lh - statH - sparkRoom) / 0.7), 210))
    return (
      <div class="pd-metric pd-metric--gauge" style={{ padding: pad + 'px' }}>
        {labelEl}
        <div class="pd-gwrap" data-part="gauge" style={{ width: gSize + 'px', height: Math.round(gSize * 0.7) + 'px' }}>
          <Gauge value={pct} size={gSize} band={band} />
          <div class="pd-gwrap__c">
            <AnimatedNumber value={kind === 'cpu' || kind === 'gpu' ? num : Math.round(pct)} class="pd-gwrap__n" style={{ fontSize: Math.round(gSize * 0.22) + 'px' }} suffix="%" />
          </div>
        </div>
        {statH ? (
          <div class="pd-gstat">
            <span class="pd-gstat__m" style={{ color: BAND_COLOR[band] }}>
              <i style={{ background: BAND_COLOR[band] }} />
              {t(BAND_TEXT[band])}
            </span>
            {deltaEl(11)}
          </div>
        ) : null}
        {sparkRoom && data ? <SlotSpark values={windowSeries(data, winSec, 60)} color={color} height={sparkRoom} minRange={20} /> : null}
      </div>
    )
  }

  // ring / donut: circular, beside the numbers when the tile is wide
  if ((chart === 'ring' || chart === 'donut') && s) {
    const wide = props.tw >= props.th * 1.5 && props.tw >= 150
    const dia = wide ? Math.max(40, Math.min(props.th - pad * 2, 200, Math.floor((props.tw - pad * 2) * 0.5))) : Math.max(36, Math.min(avail, props.th - pad * 2 - lh, 200))
    const centre = Math.round(pct) + '%'
    const fig =
      chart === 'donut' ? (
        <Donut size={dia} used={pct} color={color} center={centre} />
      ) : (
        <Rings size={dia} rings={[{ value: pct, goal: 100, color: color }]} center={centre} />
      )
    if (!wide) {
      return (
        <div class="pd-metric pd-metric--gauge" style={{ padding: pad + 'px' }}>
          {labelEl}
          <div class="pd-cfig">{fig}</div>
        </div>
      )
    }
    // the number + unit must fit the room beside the ring (a 3x2 tile on a small phone left "GB" outside the tile)
    const textW = Math.max(30, props.tw - pad * 2 - dia - 12)
    const vs = Math.max(10, Math.min(34 * props.scale, Math.floor((props.th - pad * 2 - lh) * 0.4), fit(fmt(num).length + (unit ? 1 + Math.ceil(unit.length * 0.5) : 0), textW, 34, 10)))
    const free = s.memTotal ? (s.memTotal - s.memUsed) / GB : 0
    return (
      <div class="pd-metric pd-metric--circ" style={{ padding: pad + 'px' }}>
        <div class="pd-cfig pd-cfig--l">{fig}</div>
        <div class="pd-ctxt">
          {labelEl}
          {bigNum(vs)}
          <div class="pd-cdelta">{deltaEl(11)}</div>
          {showSubOpt && chart === 'donut' && props.th >= 100 ? (
            <div class="pd-msub pd-legend" data-part="tile-sub">
              <span>
                <i class="pd-ldot" style={{ background: color }} />
                {t('Used {0} GB', (s.memUsed / GB).toFixed(1))}
              </span>
              <span>
                <i class="pd-ldot" style={{ background: tint(color, 0.28) || color }} />
                {t('Free {0} GB', free.toFixed(1))}
              </span>
            </div>
          ) : showSubOpt && sub ? (
            <div class="pd-msub" data-part="tile-sub">{sub}</div>
          ) : null}
        </div>
      </div>
    )
  }

  // bar: one horizontal meter with a limit tick
  if (chart === 'bar' && s) {
    const bp = props.th < 100 ? 8 : pad
    const thick = props.th >= 110 ? 10 : 6
    const subOn = showSubOpt && !!sub && props.th >= 130
    const vs = Math.max(14, Math.min(34 * props.scale, props.th - bp * 2 - lh - thick - 16 - (subOn ? 16 : 0), Math.floor(avail / 4)))
    return (
      <div class="pd-metric" style={{ padding: bp + 'px' }}>
        {labelEl}
        <div class="pd-mrow">
          {bigNum(vs)}
          {props.tw >= 150 && props.th >= 90 ? deltaEl(11) : null}
        </div>
        <div class="pd-mfill" />
        {subOn ? <div class="pd-msub" data-part="tile-sub">{sub}</div> : null}
        <MeterBar value={pct} limit={85} color={color} thick={thick} />
      </div>
    )
  }

  // every other chart choice was drawn above (the stat tile takes the default and the history charts)
  return null
}
