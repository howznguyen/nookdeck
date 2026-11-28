import { Component } from 'preact'
import type { CardNode } from '../../../src/plugins/card'
import { commonParts, rowRoomEm, sparkGeom, tickerParts, trendOf, type TickerParts } from './card-ticker-logic'
import './card-ticker.css'

/**
 * The card's market parts: `ticker` rows (symbol, name, price, change chip, chart) and the chart they share with `sparkline`.
 * A row draws every part it was given; layTickers() then picks, for the card's width and font, which show, the same for every
 * row of the card, and alignTickers() makes the columns line up. Safari 12: no flex gap, no color-mix(): the chip's tint is a
 * pseudo-element in currentColor.
 */

const TREND_COLOR = { up: 'var(--pd-live)', down: 'var(--pd-bad)', flat: 'var(--pd-muted)' }
/**
 * A ticker's chart covers another period than its change (a coin's week beside its 24 hours), so it is drawn neutral: colour
 * belongs to the change chip alone, and a green week next to a red day never reads as a contradiction.
 */
const TICKER_CHART = 'var(--pd-muted)'

let sparkSeq = 0

export interface SparkProps {
  points: number[]
  /** a CSS colour; missing: coloured by its own direction */
  color?: string
  /** a dashed line at the first value */
  base?: boolean
  cls?: string
}

/** A thin line with a fade under it and a dot on the latest point. The SVG stretches to its box; the dot and the base line are HTML, so they stay round and crisp. */
export class Spark extends Component<SparkProps> {
  private id = 'pd-pcard__spk' + ++sparkSeq

  render() {
    const p = this.props
    const g = sparkGeom(p.points)
    const cls = 'pd-pcard__spk' + (p.cls ? ' ' + p.cls : '')
    if (!g) return <span class={cls} aria-hidden="true" />
    const color = p.color || TREND_COLOR[trendOf(p.points)]
    return (
      <span class={cls} aria-hidden="true" style={{ color: color }}>
        <span class="pd-pcard__spk-in">
          {p.base ? <i class="pd-pcard__spk-base" style={{ top: ((g.baseY / 30) * 100).toFixed(1) + '%' }} /> : null}
          <svg width="100%" height="100%" viewBox="0 0 100 30" preserveAspectRatio="none">
            <defs>
              <linearGradient id={this.id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: color, stopOpacity: 0.22 }} />
                <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <polygon points={g.area} fill={'url(#' + this.id + ')'} />
            <polyline points={g.line} fill="none" vector-effect="non-scaling-stroke" style={{ stroke: color }} stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <i class="pd-pcard__spk-dot" style={{ top: ((g.endY / 30) * 100).toFixed(1) + '%' }} />
        </span>
      </span>
    )
  }
}

export interface TickerProps {
  node: Extract<CardNode, { t: 'ticker' }>
  /** the chip's colour */
  tone: string
  textColor?: string
}

export function Ticker(props: TickerProps) {
  const n = props.node
  const pts = n.points && n.points.length > 1 ? n.points : null
  const id = (
    <span class="pd-pcard__tk-id">
      <span class="pd-pcard__tk-sym" style={{ color: props.textColor }}>{n.symbol}</span>
      {n.name ? <span class="pd-pcard__tk-name" data-part="tile-sub">{n.name}</span> : null}
    </span>
  )
  const chip = n.change ? <span class="pd-pcard__tk-ch" style={{ color: props.tone }}>{n.change}</span> : null
  const label = n.symbol + (n.name ? ' ' + n.name : '') + ' ' + n.price + (n.change ? ' ' + n.change : '')
  if (n.hero) {
    return (
      <div class="pd-pcard__box pd-pcard__tk pd-pcard__tk--hero" role="group" aria-label={label}>
        <div class="pd-pcard__tk-head">
          {id}
          <span class="pd-pcard__tk-right">
            <span class="pd-pcard__tk-big" data-part="tile-value" style={{ color: props.textColor }}>{n.price}</span>
            {chip}
          </span>
        </div>
        {pts ? <Spark points={pts} base color={TICKER_CHART} cls="pd-pcard__tk-chart" /> : null}
        {n.note ? <span class="pd-pcard__tk-note" data-part="tile-sub">{n.note}</span> : null}
      </div>
    )
  }
  return (
    <div class="pd-pcard__box pd-pcard__tk" data-name="under" role="group" aria-label={label}>
      {id}
      {pts ? <Spark points={pts} color={TICKER_CHART} cls="pd-pcard__tk-chart" /> : null}
      <span class="pd-pcard__tk-px" style={{ color: props.textColor }}>{n.price}</span>
      {chip}
    </div>
  )
}

const rowsOf = (card: HTMLElement): HTMLElement[] => {
  const found = card.querySelectorAll('.pd-pcard__tk:not(.pd-pcard__tk--hero)')
  const out: HTMLElement[] = []
  for (let i = 0; i < found.length; i++) out.push(found[i] as HTMLElement)
  return out
}

function apply(row: HTMLElement, p: TickerParts) {
  row.setAttribute('data-name', p.name)
  row.classList.toggle('pd-pcard__tk--nochart', !p.chart)
  row.classList.toggle('pd-pcard__tk--nochip', !p.change)
}

/**
 * Picks the parts of every ticker row for the card's font now: the chart, the name (under or beside the symbol) and the chip,
 * the least any row of the card allows. Call it at every font step of the fit, before asking for overflow.
 */
export function layTickers(card: HTMLElement) {
  layHeroes(card)
  const rows = rowsOf(card)
  if (!rows.length) return
  const font = parseFloat(card.style.fontSize) || 14
  const full: TickerParts = { name: 'under', chart: true, change: true }
  for (let i = 0; i < rows.length; i++) apply(rows[i], full)
  const parts: TickerParts[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const col = r.parentElement as HTMLElement
    let count = 0
    let other = 0
    for (let j = 0; j < col.children.length; j++) {
      const c = col.children[j] as HTMLElement
      if (c.classList.contains('pd-pcard__tk') && !c.classList.contains('pd-pcard__tk--hero')) count++
      else if (c.classList.contains('pd-pcard__tk--hero')) other += font * 5 // a hero takes what is left: leave it room for a chart
      else other += c.offsetHeight + 4
    }
    const vertical = col.classList.contains('pd-pcard__col') || col.classList.contains('pd-pcard')
    const h = vertical ? rowRoomEm(col.clientHeight, other, count, font) : col.clientHeight / font
    parts.push(tickerParts(r.clientWidth / font, h, { name: !!r.querySelector('.pd-pcard__tk-name'), chart: !!r.querySelector('.pd-pcard__tk-chart'), change: !!r.querySelector('.pd-pcard__tk-ch') }))
  }
  const common = commonParts(parts)
  if (common) for (let i = 0; i < rows.length; i++) apply(rows[i], common)
  alignTickers(card)
}

/** A hero's price and chip side by side when they fit beside the symbol, else the chip under the price. */
function layHeroes(card: HTMLElement) {
  const found = card.querySelectorAll('.pd-pcard__tk--hero')
  for (let i = 0; i < found.length; i++) {
    const h = found[i] as HTMLElement
    const head = h.querySelector('.pd-pcard__tk-head') as HTMLElement
    h.classList.remove('pd-pcard__tk--narrow')
    if (head.scrollWidth > head.clientWidth + 1) h.classList.add('pd-pcard__tk--narrow')
  }
}

/** the widest a symbol and its name take before a chart starts, in em */
const ID_MAX_EM = 7

function widest(rows: HTMLElement[], sel: string, natural?: boolean): number {
  let w = 0
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].offsetParent) continue // left out by the fit
    const el = rows[i].querySelector(sel) as HTMLElement | null
    // the fractional width: a name 42.4px wide in a 42px box would ellipsize
    if (el && el.offsetParent) w = Math.max(w, natural ? Math.max(el.scrollWidth, el.getBoundingClientRect().width) : el.getBoundingClientRect().width)
  }
  return w
}

/** One width for each column of the card's ticker rows: the charts start and end on one line, prices and chips stand under each other. */
export function alignTickers(card: HTMLElement) {
  const rows = rowsOf(card)
  if (!rows.length) return
  const font = parseFloat(card.style.fontSize) || 14
  const reset = (sel: string) => {
    for (let i = 0; i < rows.length; i++) {
      const el = rows[i].querySelector(sel) as HTMLElement | null
      if (el) el.style.minWidth = el.style.width = ''
    }
  }
  reset('.pd-pcard__tk-id'); reset('.pd-pcard__tk-px'); reset('.pd-pcard__tk-ch')
  const set = (sel: string, w: number, fixed: boolean) => {
    if (!w) return
    for (let i = 0; i < rows.length; i++) {
      const el = rows[i].querySelector(sel) as HTMLElement | null
      if (!el) continue
      el.style.minWidth = Math.ceil(w + 0.5) + 'px'
      if (fixed) el.style.width = Math.ceil(w + 0.5) + 'px'
    }
  }
  const sym = widest(rows, '.pd-pcard__tk-sym', true)
  const chart = rows[0].querySelector('.pd-pcard__tk-chart') && !rows[0].classList.contains('pd-pcard__tk--nochart')
  if (chart) {
    const name = rows[0].getAttribute('data-name')
    const nameW = name === 'none' ? 0 : widest(rows, '.pd-pcard__tk-name', true)
    const natural = name === 'side' ? sym + font * 0.4 + nameW : Math.max(sym, nameW)
    set('.pd-pcard__tk-id', Math.max(sym, Math.min(natural, font * ID_MAX_EM)), true)
  } else set('.pd-pcard__tk-id', sym, false)
  set('.pd-pcard__tk-px', widest(rows, '.pd-pcard__tk-px'), false)
  set('.pd-pcard__tk-ch', widest(rows, '.pd-pcard__tk-ch'), false)
}
