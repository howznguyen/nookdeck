import { PAL } from './theme'
import { t } from './i18n'
import { Icon, TileIcon } from './icon'
import { SlotSpark } from './charts'
import { Gauge, DeltaPill } from './knowns'
import { BarSpark, Donut, MeterBar } from './metric-charts'
import type { Band } from './knowns'
import type { IconAssets } from './types'
import { friendlyError, pickStyle } from './plugin-logic'
import { CardTile } from './card'
import type { CardArgs } from '../../../src/plugins/card'
import type { PluginSlot, PluginState } from './plugin-logic'

/** Plugin tiles: eight renderers (card.tsx is one) fed by validated data (plugin-logic.ts). Reuses the value tile look and the shared charts. */

export const STATE_COLOR: { [k in PluginState]: string } = { get ok() { return PAL.ok }, get warn() { return PAL.warn }, get error() { return PAL.error }, off: '#8b8b94' }
const band = (v: number): Band => (v >= 85 ? 'risk' : v >= 65 ? 'watch' : 'good')
const fmtNum = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : String(Math.round(v * 100) / 100))

export interface PluginTileProps {
  entry: PluginSlot | undefined
  tw: number
  th: number
  showLabel: boolean
  color?: string
  textColor?: string
  assets?: IconAssets
  /** the tile's own label, used when the data carries none */
  label?: string
  /** the tile's chosen display style (plugin.view.style); the widget's suggestion and the default follow */
  style?: string
  /** a card button was tapped (absent in previews) */
  onCard?: (action: string, args: CardArgs | undefined) => Promise<unknown>
}

export function PluginTile(props: PluginTileProps) {
  const e = props.entry
  const tw = props.tw
  const th = props.th
  const pad = tw >= 170 ? 14 : 10
  const col = props.textColor || undefined
  if (!e || 'error' in e || 'custom' in e) {
    const msg = e && 'error' in e ? e.error : ''
    // "no preview|Name · Kind": the manage preview has no sample data for this tile
    const np = msg.indexOf('no preview|') === 0 ? msg.slice(11) : null
    const fr = np === null ? friendlyError(msg) : null
    return (
      <div class="pd-vl pd-pl pd-pl--err" style={{ padding: pad + 'px' }}>
        <Icon name="plug-off" size={Math.max(16, Math.min(28, Math.floor(th * 0.3)))} />
        <span class="pd-pl__e">{np !== null ? t('No preview') : fr ? t(fr) : t('Plugin unavailable')}</span>
        {np ? <span class="pd-pl__m">{np}</span> : msg && !fr && np === null && th >= 80 ? <span class="pd-pl__m">{msg}</span> : null}
      </div>
    )
  }
  if (e.render === 'card') return <CardTile data={e.data} tw={tw} th={th} color={props.color} textColor={col} assets={props.assets} onAction={props.onCard} />
  const st = pickStyle(e.render, props.style, e.style)
  if (e.render === 'stat') {
    const d = e.data
    const text = typeof d.value === 'number' ? fmtNum(d.value) : d.value
    const unit = d.unit || ''
    const big = st === 'big'
    const sp = st === 'spark' && d.points && d.points.length > 1 ? d.points : null
    const showDelta = d.delta !== undefined && !big
    // a short tile has no room under the value: the change sits beside it, when the width allows both
    const sideDelta = showDelta && th < 80 && !sp && tw - pad * 2 >= 130
    const deltaW = sideDelta ? 76 : 0
    const vs = Math.max(16, Math.min(Math.floor(th * (big ? 0.6 : sp ? 0.3 : showDelta && !sideDelta ? 0.34 : 0.42)), Math.floor((tw - pad * 2 - deltaW) / (Math.max(2, (text + unit).length) * 0.56)), big ? 80 : 56))
    const delta = showDelta && d.delta !== undefined ? <DeltaPill value={d.delta} unit="%" decimals={1} tone={d.delta < 0 ? 'bad' : undefined} /> : null
    const value = (
      <span class="pd-vl__v" data-part="tile-value" style={{ fontSize: vs + 'px', color: d.color || col }}>
        {text}
        {unit ? <i style={{ fontSize: Math.max(10, Math.round(vs * 0.42)) + 'px' }}>{unit}</i> : null}
      </span>
    )
    return (
      <div class="pd-vl pd-pl" style={{ padding: pad + 'px' }}>
        {sp ? <SlotSpark values={sp} color={d.color || props.color || '#22d3ee'} height={Math.max(20, Math.floor(th * 0.4))} slots={Math.max(2, sp.length)} fill={0.14} /> : null}
        {props.showLabel && !big && (d.label || props.label) ? <span class="pd-vl__lb" data-part="tile-label" style={{ color: d.color || props.color || undefined }}>{d.label || props.label}</span> : null}
        {sideDelta ? (
          <span style={{ display: 'flex', WebkitAlignItems: 'center', alignItems: 'center', WebkitJustifyContent: 'space-between', justifyContent: 'space-between', width: '100%', minWidth: 0 }}>
            {value}
            <span data-part="tile-sub" style={{ marginLeft: '8px', WebkitFlex: '0 0 auto', flex: '0 0 auto' }}>{delta}</span>
          </span>
        ) : value}
        {delta && !sideDelta && th >= 80 ? <span class="pd-pl__d" data-part="tile-sub">{delta}</span> : null}
      </div>
    )
  }
  if (e.render === 'gauge') {
    const d = e.data
    const gl = props.showLabel && (d.label || props.label) ? <span class="pd-vl__lb" data-part="tile-label">{d.label || props.label}</span> : null
    if (st === 'bar') {
      return (
        <div class="pd-vl pd-pl" style={{ padding: pad + 'px', justifyContent: 'center' }}>
          {gl}
          <span class="pd-pl__cv" data-part="tile-value" style={{ color: d.color || col }}>{Math.round(d.value)}<i>%</i></span>
          <MeterBar value={d.value} limit={101} color={d.color || (d.value >= 85 ? PAL.error : d.value >= 65 ? PAL.warn : PAL.ok)} thick={Math.max(6, Math.min(14, Math.floor(th * 0.1)))} />
        </div>
      )
    }
    if (st === 'ring') {
      const rs = Math.max(48, Math.min(tw - pad * 2, th - pad * 2 - (gl ? 16 : 0), 140))
      return (
        <div class="pd-vl pd-pl pd-pl--c" style={{ padding: pad + 'px' }}>
          <Donut size={rs} used={d.value} color={d.color || (d.value >= 85 ? PAL.error : d.value >= 65 ? PAL.warn : PAL.ok)} center={Math.round(d.value) + '%'} centerSize={Math.round(rs * 0.22)} />
          {gl}
        </div>
      )
    }
    if (st === 'half') {
      const hs = Math.max(60, Math.min(tw - pad * 2, (th - pad * 2 - (gl ? 16 : 0)) * 2, 180))
      const rr = 50, len = Math.PI * rr, v = Math.min(100, Math.max(0, d.value))
      const gc = d.color || (d.value >= 85 ? PAL.error : d.value >= 65 ? PAL.warn : PAL.ok)
      return (
        <div class="pd-vl pd-pl pd-pl--c" style={{ padding: pad + 'px' }}>
          <div class="pd-pl__g" data-part="gauge" style={{ width: hs + 'px' }}>
            <svg width={hs} height={Math.round(hs * 0.58)} viewBox="0 0 120 70" aria-hidden="true">
              <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke="var(--pd-border-strong)" stroke-width="9" stroke-linecap="round" />
              {v >= 0.5 ? <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke={gc} stroke-width="9" stroke-linecap="round" stroke-dasharray={(len * v / 100).toFixed(1) + ' ' + (len + 4).toFixed(1)} /> : null}
            </svg>
            <span class="pd-pl__gv" data-part="tile-value" style={{ top: '34%', fontSize: Math.round(hs * 0.2) + 'px', color: d.color || col }}>{Math.round(d.value)}<i>%</i></span>
          </div>
          {gl}
        </div>
      )
    }
    const size = Math.max(60, Math.min(tw - pad * 2, Math.floor((th - pad * 2 - (props.showLabel && d.label ? 16 : 0)) / 0.7), 150))
    return (
      <div class="pd-vl pd-pl pd-pl--c" style={{ padding: pad + 'px' }}>
        <div class="pd-pl__g" data-part="gauge" style={{ width: size + 'px' }}>
          <Gauge value={d.value} size={size} band={band(d.value)} color={d.color} />
          <span class="pd-pl__gv" data-part="tile-value" style={{ fontSize: Math.round(size * 0.24) + 'px', color: d.color || col }}>{Math.round(d.value)}<i>%</i></span>
        </div>
        {gl}
      </div>
    )
  }
  if (e.render === 'text') {
    const d = e.data
    return (
      <div class="pd-vl pd-pl" style={{ padding: pad + 'px', justifyContent: 'flex-start' }}>
        {d.title && st !== 'minimal' ? <span class="pd-vl__lb" data-part="tile-label" style={{ color: props.color || undefined }}>{d.title}</span> : null}
        <span class="pd-pl__b" style={{ color: col, fontSize: st === 'minimal' ? (th >= 110 ? '18px' : '15px') : th >= 110 ? '15px' : '13px', WebkitLineClamp: Math.max(1, Math.floor((th - pad * 2 - (d.title && st !== 'minimal' ? 18 : 0)) / (st === 'minimal' ? (th >= 110 ? 24 : 20) : th >= 110 ? 20 : 17))) } as any}>{d.body}</span>
      </div>
    )
  }
  if (e.render === 'list') {
    const rows = e.data.items
    const compact = st === 'compact'
    const rh = compact ? 24 : tw >= 170 ? 40 : 34
    const n = Math.max(1, Math.floor((th - pad * 2 + 4) / rh))
    return (
      <div class="pd-vl pd-pl" style={{ padding: pad + 'px', justifyContent: 'flex-start' }}>
        {rows.length === 0 ? <span class="pd-pl__e">{t('Nothing to show')}</span> : null}
        {rows.slice(0, n).map((r, i) => (
          <div class="pd-pl__r" key={i} style={{ height: rh - 4 + 'px' }}>
            {r.icon && !compact ? <span class="pd-pl__i" data-part="tile-icon"><TileIcon value={r.icon} size={18} assets={props.assets} /></span> : null}
            <span class="pd-pl__rb">
              <span class="pd-pl__rt" style={{ color: col }}>{r.title}</span>
              {r.subtitle && rh >= 40 && !compact ? <span class="pd-pl__rs" data-part="tile-sub">{r.subtitle}</span> : null}
            </span>
            {r.value ? <span class="pd-pl__rv" data-part="tile-value" style={{ color: col }}>{r.value}</span> : null}
          </div>
        ))}
        {rows.length > n ? <span class="pd-pl__more">+{rows.length - n}</span> : null}
      </div>
    )
  }
  if (e.render === 'chart') {
    const d = e.data
    const pts = d.points
    const last = pts.length ? pts[pts.length - 1] : null
    const c = props.color || '#22d3ee'
    const hh = Math.max(16, th - pad * 2 - 72 - (props.showLabel && (d.label || props.label) ? 14 : 0))
    return (
      <div class="pd-vl pd-pl" style={{ padding: pad + 'px', justifyContent: 'flex-start' }}>
        {props.showLabel && (d.label || props.label) ? <span class="pd-vl__lb" data-part="tile-label" style={{ color: props.color || undefined }}>{d.label || props.label}</span> : null}
        {last !== null ? <span class="pd-pl__cv" data-part="tile-value" style={{ color: col }}>{fmtNum(last)}{d.unit ? <i>{d.unit}</i> : null}</span> : <span class="pd-pl__e">{t('No data yet')}</span>}
        {pts.length >= 2 ? (st === 'bars'
          ? <BarSpark values={pts} color={c} height={hh} slots={Math.min(pts.length, Math.max(8, Math.floor(tw / 9)))} domain={[Math.min.apply(null, pts), Math.max.apply(null, pts)]} />
          : st === 'dots' ? <DotSpark values={pts} color={c} height={hh} slots={Math.min(pts.length, Math.max(8, Math.floor(tw / 9)))} />
          : <SlotSpark values={pts} color={c} height={hh} slots={Math.max(2, pts.length)} fill={st === 'area' ? 0.38 : 0.14} />) : null}
      </div>
    )
  }
  if (e.render === 'image') {
    const d = e.data
    return (
      <div class="pd-pl pd-pl--img" style={{ backgroundImage: 'url("' + d.url.replace(/"/g, '%22') + '")', backgroundSize: st === 'contain' || (st === 'cover' && props.style === undefined && d.fit === 'contain') ? 'contain' : 'cover' }} role="img" />
    )
  }
  const d = e.data
  const c = STATE_COLOR[d.state]
  const pill = d.state === 'ok' ? t('OK') : d.state === 'warn' ? t('Slow') : d.state === 'error' ? t('Down') : t('Off')
  if (st === 'dot') {
    const ds = Math.max(14, Math.min(Math.floor(Math.min(tw, th) * 0.34), 44))
    return (
      <div class="pd-vl pd-pl pd-pl--c" style={{ padding: pad + 'px' }}>
        <i class="pd-pl__dot" style={{ width: ds + 'px', height: ds + 'px', marginBottom: th >= 70 ? 8 : 0, background: c, boxShadow: '0 0 0 ' + Math.round(ds * 0.35) + 'px ' + c + '33' }} />
        {th >= 70 ? <span class="pd-pl__sl" style={{ color: col, fontSize: '12px' }}>{d.title || d.label}</span> : null}
      </div>
    )
  }
  if (st === 'pill') {
    const txt = d.value !== undefined ? d.value + (d.unit ? ' ' + d.unit : '') : pill
    return (
      <div class="pd-vl pd-pl pd-pl--c" style={{ padding: pad + 'px' }}>
        {th >= 70 ? <span class="pd-pl__st" style={{ color: props.color || undefined, marginRight: 0, marginBottom: 8, maxWidth: '100%' }}>{d.title || d.label}</span> : null}
        <span class="pd-pl__bigpill" style={{ color: c, background: c + '26', fontSize: Math.max(12, Math.min(20, Math.floor((tw - pad * 2 - 20) / Math.max(4, txt.length * 0.62)))) + 'px' }}>{txt}</span>
      </div>
    )
  }
  const rich = d.value !== undefined || d.title !== undefined || d.detail !== undefined || (d.points !== undefined && d.points.length > 1)
  if (!rich) {
    return (
      <div class="pd-vl pd-pl pd-pl--c" style={{ padding: pad + 'px' }}>
        <i class="pd-pl__dot" style={{ background: c, boxShadow: '0 0 0 6px ' + c + '33' }} />
        <span class="pd-pl__sl" style={{ color: col }}>{d.label}</span>
        <span class="pd-vl__lb" data-part="tile-label" style={{ color: c }}>{pill}</span>
      </div>
    )
  }
  // layout from the tile's own size and shape (any grid): tiny, wide, tall or large
  const inW = tw - pad * 2
  const inH = th - pad * 2
  const tiny = tw < 130 && th < 130
  const wide = !tiny && tw >= th * 1.5 && th < 130
  const tall = !tiny && th >= tw * 1.5 && !wide
  const large = !tiny && !wide && !tall
  const pts = d.points && d.points.length > 1 ? d.points : null
  const title = d.title || d.label
  const val = d.value !== undefined ? d.value : pill
  const unit = d.unit && d.value !== undefined ? d.unit : ''
  const chars = Math.max(2, (val + unit).length + (unit ? 0.4 : 0))
  const sparkRight = wide && !!pts && tw >= 170
  const colW = sparkRight ? Math.floor(inW * 0.55) : inW
  const byW = Math.floor(colW / (chars * 0.68))
  const byH = Math.floor(inH * (tiny ? 0.42 : wide ? (th >= 110 ? 0.42 : 0.36) : tall ? 0.2 : 0.3))
  const vs = Math.max(16, Math.min(byW, byH, 52))
  const showDetail = !!d.detail && (tiny ? false : wide ? th >= 80 : true)
  const showTitle = !tiny && (!tall || tw >= 110)
  const headH = 20
  const valH = vs + 8
  const detH = showDetail ? 18 : 0
  const statH = large && pts && th >= 160 ? 18 : 0
  let sh = 0
  if (pts && !tiny && !sparkRight) sh = inH - headH - valH - detH - statH - 6
  if (sparkRight) sh = Math.max(24, inH - headH - 4)
  const showSpark = !!pts && ((sparkRight && sh >= 24) || (!sparkRight && !tiny && !wide && sh >= 28))
  let lo = 0, hi = 0, avg = 0
  if (pts && statH) { lo = Math.min.apply(null, pts); hi = Math.max.apply(null, pts); let t = 0; for (let k = 0; k < pts.length; k++) t += pts[k]; avg = t / pts.length }
  const tint = d.state === 'error' ? 'linear-gradient(0deg, rgba(248,113,113,0.12), rgba(248,113,113,0.12))' : d.state === 'warn' ? 'linear-gradient(0deg, rgba(245,158,11,0.07), rgba(245,158,11,0.07))' : undefined
  const ring = tiny ? '0 0 0 2px ' + c + '55 inset' : undefined
  return (
    <div class={'pd-vl pd-pl pd-pl--s' + (tiny ? ' pd-pl--s1' : '')} style={{ padding: pad + 'px', backgroundImage: tint, boxShadow: ring }}>
      <div class="pd-pl__sh">
        {showTitle ? <span class="pd-pl__st" style={{ color: props.color || undefined }}>{title}</span> : null}
        <span class="pd-pl__pill" style={{ color: c, background: c + '26' }}>{pill}</span>
      </div>
      <div class="pd-pl__sb">
        <div class="pd-pl__sc" style={{ width: sparkRight ? colW + 'px' : undefined }}>
          <span class="pd-pl__sv" style={{ color: c, fontSize: vs + 'px' }}>
            {val}
            {unit ? <i style={{ fontSize: Math.max(10, Math.round(vs * 0.4)) + 'px' }}>{unit}</i> : null}
          </span>
          {showDetail ? <span class="pd-pl__sd">{d.detail}</span> : null}
        </div>
        {sparkRight && showSpark && pts ? <div class="pd-pl__sr" style={{ height: sh + 'px' }}><SlotSpark values={pts} color={c} height={sh} slots={Math.max(2, pts.length)} fill={0.14} /></div> : null}
      </div>
      {!sparkRight && showSpark && pts ? <div class="pd-pl__ss" style={{ height: sh + 'px' }}><SlotSpark values={pts} color={c} height={sh} slots={Math.max(2, pts.length)} fill={0.14} /></div> : null}
      {statH ? (
        <div class="pd-pl__sm">
          <span>min {fmtNum(lo)}</span><span>avg {Math.round(avg)}</span><span>max {fmtNum(hi)}</span>
        </div>
      ) : null}
    </div>
  )
}

/** Dots chart: one dot per reading (the last one solid), laid out like the bars chart. */
function DotSpark(props: { values: number[]; color: string; height: number; slots: number }) {
  const vals = props.values.slice(-props.slots)
  let lo = Math.min.apply(null, vals)
  let hi = Math.max.apply(null, vals)
  if (hi === lo) { lo -= 1; hi += 1 }
  const cols = []
  for (let i = 0; i < vals.length; i++) {
    const last = i === vals.length - 1
    cols.push(<div class="pd-pl-dots__c" key={i}><i style={{ bottom: ((vals[i] - lo) / (hi - lo)) * 88 + '%', background: props.color, opacity: last ? 1 : 0.6 }} /></div>)
  }
  return <div class="pd-pl-dots" style={{ height: props.height + 'px' }} aria-hidden="true">{cols}</div>
}
