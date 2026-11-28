import { Component, createRef } from 'preact'
import { TileIcon } from './icon'
import type { IconAssets } from './types'
import { CardMonth, CardWeek, type CalBox } from './card-calendar'
import { monthWidth } from './card-calendar-logic'
import { Spark, Ticker, alignTickers, layTickers } from './card-ticker'
import { CARD_MIN_PX, CARD_SHRINK, cardBase, cardStacks, ringTextPx } from './plugin-logic'
import type { CardArgs, CardData, CardNode, CardTone } from '../../../src/plugins/card'

/**
 * The `card` renderer (spec release 0.5, D2): the deck draws only these parts, with theme tokens. The data was checked by
 * validateCard (plugin-logic.ts) before it gets here. Sizes are in em from one base size per tile; when the parts do not fit,
 * the base steps down (never below CARD_MIN_PX), then the last parts of the overflowing column are left out, so a small tile
 * shows the top of the card rather than half-cut parts. Safari 12: no flex gap (margins), no ResizeObserver, no color-mix().
 */

export interface CardTileProps {
  data: CardData
  tw: number
  th: number
  /** the tile's own colour: the "accent" tone */
  color?: string
  textColor?: string
  assets?: IconAssets
  /** a button was tapped; resolves when the agent answered. Missing in previews: buttons do nothing. */
  onAction?: (action: string, args: CardArgs | undefined) => Promise<unknown>
}

const GAPS = ['0', '4px', '8px', '12px']
const FIT_TIGHT = [false, true]

type CardState = { busy: { [path: string]: boolean }; boxes: { [path: string]: CalBox } }

export class CardTile extends Component<CardTileProps, CardState> {
  state: CardState = { busy: {}, boxes: {} }
  private el = createRef<HTMLDivElement>()
  private alive = true
  private fontsAsked = false

  componentDidMount() {
    this.fit()
  }
  componentDidUpdate(prev: CardTileProps) {
    if (prev.data !== this.props.data || prev.tw !== this.props.tw || prev.th !== this.props.th) this.fit()
  }
  componentWillUnmount() {
    this.alive = false
  }

  /**
   * Steps the base size down until no row or column of the card overflows and every button label shows in full; then the same
   * with tighter buttons. A label that fits at no size (a very long one) leaves the card at the smallest size, so as much of
   * every label shows as can, and it keeps its ellipsis. Last, trailing parts that still do not fit are left out.
   */
  private fit() {
    const el = this.el.current
    if (!el) return
    const base = cardBase(this.props.tw, this.props.th)
    show(el)
    el.style.fontSize = base + 'px'
    layStacks(el) // the direction is settled first: the text is then fitted to the boxes it gives
    let done = false
    for (let k = 0; k < FIT_TIGHT.length && !done; k++) {
      el.classList.toggle('pd-pcard--tight', FIT_TIGHT[k])
      for (let s = 0; s < CARD_SHRINK.length && !done; s++) {
        el.style.fontSize = Math.max(CARD_MIN_PX, Math.round(base * CARD_SHRINK[s] * 10) / 10) + 'px'
        arrangeTiles(el)
        layTickers(el)
        sizeMonths(el)
        done = !overflows(el) && !labelClipped(el)
      }
    }
    trim(el)
    alignTickers(el) // the rows left out no longer widen the columns
    dropSlivers(el)
    sizeMonths(el)
    sizeRings(el)
    sizeTiles(el)
    this.measureCalendars(el, base)
    const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts
    if (!this.fontsAsked && fonts && fonts.ready) {
      this.fontsAsked = true
      fonts.ready.then(() => { if (this.alive) this.fit() }, () => {})
    }
  }

  /** Calendars draw to the size of their box, which does not depend on what is in them: they are measured once the rest is laid out. */
  private measureCalendars(el: HTMLElement, base: number) {
    const found = el.querySelectorAll('[data-cal]')
    const boxes: { [path: string]: CalBox } = {}
    let changed = false
    for (let i = 0; i < found.length; i++) {
      const c = found[i] as HTMLElement
      const path = c.getAttribute('data-cal') as string
      const next = { w: c.clientWidth, h: c.clientHeight, base: base }
      const had = this.state.boxes[path]
      boxes[path] = had && had.w === next.w && had.h === next.h && had.base === next.base ? had : next
      if (boxes[path] !== had) changed = true
    }
    if (changed) this.setState({ boxes: boxes })
  }

  private tap(path: string, action: string, args: CardArgs | undefined) {
    if (!this.props.onAction || this.state.busy[path]) return
    this.setState({ busy: assign(this.state.busy, path, true) })
    const since = Date.now()
    const done = () => window.setTimeout(() => { if (this.alive) this.setState({ busy: assign(this.state.busy, path, false) }) }, Math.max(0, 180 - (Date.now() - since)))
    this.props.onAction(action, args).then(done, done)
  }

  private tone(t: CardTone | undefined, fallback?: string): string | undefined {
    if (t === 'muted') return 'var(--pd-muted)'
    if (t === 'accent') return this.props.color || 'var(--pd-accent)'
    if (t === 'ok') return 'var(--pd-live)'
    if (t === 'warn') return 'var(--pd-warn)'
    if (t === 'bad') return 'var(--pd-bad)'
    return fallback
  }

  private node(n: CardNode, path: string): preact.JSX.Element | null {
    const text = this.props.textColor || undefined
    if (n.t === 'row' || n.t === 'col') {
      return (
        <div
          key={path}
          class={'pd-pcard__box pd-pcard__' + n.t + ' pd-pcard__al-' + (n.align || 'start') + (n.grow ? ' pd-pcard__grow' : '') + (n.children.some(fills) || (n.t === 'row' && n.stack) ? ' pd-pcard__fills' : '') + (n.t === 'row' && n.stack ? ' pd-pcard__stack' : '') + (n.t === 'row' && n.children.some((c) => c.t === 'month') ? ' pd-pcard__withmonth' : '')}
          data-stack={n.t === 'row' ? n.stack : undefined}
          data-gap={GAPS[n.gap === undefined ? 1 : n.gap]}
        >
          {n.children.map((c, i) => this.node(c, path + '.' + i))}
        </div>
      )
    }
    if (n.t === 'text') {
      return <span key={path} class={'pd-pcard__text pd-pcard__text--' + (n.size || 'm') + (n.bold ? ' pd-pcard__b' : '')} data-part={n.tone === 'muted' ? 'tile-sub' : undefined} style={{ color: this.tone(n.tone, text) }}>{n.text}</span>
    }
    if (n.t === 'number') {
      return (
        <span key={path} class={'pd-pcard__num pd-pcard__num--' + (n.size || 'l')}>
          <span class="pd-pcard__nv" data-part="tile-value" style={{ color: this.tone(n.tone, text) }}>
            {typeof n.value === 'number' ? fmt(n.value) : n.value}
            {n.unit ? <i>{n.unit}</i> : null}
          </span>
        </span>
      )
    }
    if (n.t === 'pill') {
      return (
        <span key={path} class="pd-pcard__pill" style={{ color: this.tone(n.tone, text) }}>{n.text}</span>
      )
    }
    if (n.t === 'progress') {
      return (
        <span key={path} class="pd-pcard__prog" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(n.value * 100)}>
          <i style={{ width: n.value * 100 + '%', background: this.tone(n.tone, this.props.color || 'var(--pd-accent)') }} />
        </span>
      )
    }
    if (n.t === 'ring') return <Ring key={path} node={n} color={this.tone(n.tone, 'var(--pd-accent)') as string} textColor={text} assets={this.props.assets} />
    if (n.t === 'month' || n.t === 'week') {
      const accent = this.props.color || 'var(--pd-accent)'
      const paint = { tone: (x: CardTone | undefined, fallback: string) => this.tone(x, fallback) as string, accent: accent, textColor: text }
      return n.t === 'month'
        ? <CardMonth key={path} node={n} path={path} box={this.state.boxes[path]} paint={paint} />
        : <CardWeek key={path} node={n} path={path} box={this.state.boxes[path]} paint={paint} />
    }
    if (n.t === 'sparkline') return <Spark key={path} points={n.points} cls="pd-pcard__spark" color={this.tone(n.tone, this.props.color || 'var(--pd-accent)') as string} />
    if (n.t === 'ticker') return <Ticker key={path} node={n} tone={this.tone(n.tone || 'muted', text) as string} textColor={text} />
    if (n.t === 'icon') {
      return <span key={path} class="pd-pcard__icon" style={{ color: this.tone(n.tone, text) }}><TileIcon value={n.name} size={24} assets={this.props.assets} /></span>
    }
    if (n.t === 'image') {
      return <span key={path} class="pd-pcard__img" role="img" style={{ backgroundImage: 'url("' + n.src + '")', backgroundSize: n.fit === 'contain' ? 'contain' : 'cover' }} />
    }
    if (n.t === 'button') {
      const c = this.tone(n.tone, n.active ? this.props.color || 'var(--pd-accent)' : text)
      const busy = !!this.state.busy[path]
      return (
        <button
          key={path}
          type="button"
          // an attribute, not a class: a changed class string would wipe the classes fit() put on the button
          data-busy={busy ? '' : undefined}
          class={'pd-pcard__btn' + (n.active ? ' pd-pcard__btn--active' : '') + (n.layout === 'tile' ? ' pd-pcard__btn--tile' : n.label ? '' : ' pd-pcard__btn--icon')}
          style={n.active ? { background: c || 'var(--pd-accent)', borderColor: c || 'var(--pd-accent)' } : { color: c }}
          aria-label={n.label || n.icon}
          aria-pressed={n.active === undefined ? undefined : n.active}
          onClick={(e: Event) => { e.stopPropagation(); this.tap(path, n.action, n.args) }}
        >
          {n.icon ? <span class="pd-pcard__bi"><TileIcon value={n.icon} size={16} assets={this.props.assets} /></span> : null}
          {n.label ? <span class="pd-pcard__bl">{n.label}</span> : null}
        </button>
      )
    }
    return <span key={path} class="pd-pcard__spacer" />
  }

  render() {
    const pad = this.props.th < 100 ? 6 : this.props.tw >= 170 ? 12 : 8
    return (
      <div ref={this.el} class="pd-pcard" style={{ padding: pad + 'px', fontSize: cardBase(this.props.tw, this.props.th) + 'px' }}>
        {this.node(this.props.data.root, 'r')}
      </div>
    )
  }
}

function assign(o: { [k: string]: boolean }, k: string, v: boolean): { [k: string]: boolean } {
  return Object.assign({}, o, { [k]: v })
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : String(Math.round(v * 100) / 100))

/** Brings back the parts an earlier fit left out. */
function show(card: HTMLElement) {
  const hidden = card.querySelectorAll('.pd-pcard__cut')
  for (let i = 0; i < hidden.length; i++) (hidden[i] as HTMLElement).classList.remove('pd-pcard__cut')
  // dials sized by an earlier fit would hold their boxes open
  const dials = card.querySelectorAll('.pd-pcard__dial')
  for (let i = 0; i < dials.length; i++) (dials[i] as HTMLElement).style.width = (dials[i] as HTMLElement).style.height = '0px'
}

const hasCalendar = (el: Element): boolean => el.classList.contains('pd-pcard__cal') || !!el.querySelector('.pd-pcard__cal')

/** A month beside other parts of a row is as wide as its square days need; the others take the rest. */
function sizeMonths(card: HTMLElement) {
  const found = card.querySelectorAll('.pd-pcard__row > .pd-pcard__cal--month')
  for (let i = 0; i < found.length; i++) {
    const m = found[i] as HTMLElement
    const row = m.parentElement as HTMLElement
    setFlex(m, row.children.length > 1 ? '0 0 ' + monthWidth(row.clientWidth, row.clientHeight, +(m.getAttribute('data-weeks') as string)) + 'px' : '')
  }
}

/** Deepest columns first: hides a column's last parts while it is taller than its room (at least one part stays). */
function trim(card: HTMLElement) {
  const cols = card.querySelectorAll('.pd-pcard__col')
  for (let i = cols.length - 1; i >= 0; i--) {
    const col = cols[i] as HTMLElement
    // a calendar takes what room is left, so it is never the part that goes
    for (let j = col.children.length - 1; j > 0 && col.scrollHeight > col.clientHeight + 1; j--) if (!hasCalendar(col.children[j])) col.children[j].classList.add('pd-pcard__cut')
  }
}

function overflows(card: HTMLElement): boolean {
  const boxes = card.querySelectorAll('.pd-pcard__box')
  for (let i = -1; i < boxes.length; i++) {
    const b = (i < 0 ? card : boxes[i]) as HTMLElement
    if (b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1) return true
  }
  return false
}

/** A button's or ring's label ellipsizes instead of overflowing its row, so it is asked itself. */
function labelClipped(card: HTMLElement): boolean {
  const labels = card.querySelectorAll('.pd-pcard__bl, .pd-pcard__rl')
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i] as HTMLElement
    if (upright(l.parentElement as HTMLElement)) continue // a tile button's label wraps and is fitted by itself (sizeTiles)
    if (l.scrollWidth > l.clientWidth) return true
  }
  return false
}

/**
 * A label with next to no room, beside an icon, is left out: the icon alone reads better than a sliver of a letter. Then every
 * button with an icon shows its icon alone, so one card does not mix bare icons with cut words.
 */
function dropSlivers(card: HTMLElement) {
  const labels = card.querySelectorAll('.pd-pcard__bi + .pd-pcard__bl')
  let sliver = false
  for (let i = 0; i < labels.length && !sliver; i++) {
    const l = labels[i] as HTMLElement
    sliver = !upright(l.parentElement as HTMLElement) && l.scrollWidth > l.clientWidth && l.clientWidth < parseFloat(getComputedStyle(l).fontSize) * 2
  }
  if (sliver) for (let i = 0; i < labels.length; i++) if (!upright(labels[i].parentElement as HTMLElement)) (labels[i] as HTMLElement).classList.add('pd-pcard__cut')
}

/** Parts that take a share of the free space (rings, tile buttons, stack rows); so do the boxes around them. */
const fills = (n: CardNode): boolean =>
  n.t === 'ring' || n.t === 'month' || n.t === 'week' || (n.t === 'ticker' && !!n.hero) || (n.t === 'button' && n.layout === 'tile') || (n.t === 'row' && !!n.stack) || ((n.t === 'row' || n.t === 'col') && n.children.some(fills))

/**
 * `stack: "auto"` rows, outer ones first: a column when the box is about square or taller. Side by side with one ring among
 * other parts, the ring is as wide as the row is high (at most 0.6 of its width) and the rest takes what is left.
 */
function layStacks(card: HTMLElement) {
  const rows = card.querySelectorAll('[data-stack]')
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as HTMLElement
    const rings = directRings(row)
    row.classList.remove('pd-pcard__col', 'pd-pcard__stacked', 'pd-pcard__sided')
    row.classList.add('pd-pcard__row')
    for (let j = 0; j < rings.length; j++) setFlex(rings[j], '')
    if (cardStacks(row.clientWidth, row.clientHeight)) {
      row.classList.remove('pd-pcard__row')
      row.classList.add('pd-pcard__col', 'pd-pcard__stacked')
    } else {
      row.classList.add('pd-pcard__sided')
      if (rings.length === 1 && row.children.length > 1) {
        setFlex(rings[0], '0 0 ' + Math.min(row.clientHeight, Math.floor(row.clientWidth * 0.6)) + 'px')
        rings[0].setAttribute('data-full', '')
      }
    }
  }
}

function directRings(row: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  for (let i = 0; i < row.children.length; i++) if (row.children[i].classList.contains('pd-pcard__ring')) out.push(row.children[i] as HTMLElement)
  return out
}

function setFlex(el: HTMLElement, v: string) {
  el.removeAttribute('data-full')
  const s = el.style as CSSStyleDeclaration & { webkitFlex: string }
  s.webkitFlex = v
  s.flex = v
}

const RING_SCALE: { [size: string]: number } = { s: 0.6, m: 0.8, l: 1 }
/** a dial smaller than this beside its label: the card leaves all ring labels out, as a small battery widget does */
const RING_LABEL_MIN = 28

/** a tile button narrower than this has no room for words */
const TILE_WORDS_MIN = 40

/** A tile button drawn as one: icon above label. */
const upright = (b: HTMLElement) => b.classList.contains('pd-pcard__btn--tile') && !b.classList.contains('pd-pcard__btn--side')

/**
 * Tile buttons: when any cell is too short for an icon above a line of text, all of the card's take the side-by-side form;
 * when any is too narrow for words, all with an icon show the icon alone.
 */
function arrangeTiles(card: HTMLElement) {
  const tiles = card.querySelectorAll('.pd-pcard__btn--tile')
  if (!tiles.length) return
  const font = parseFloat(card.style.fontSize)
  let short = false
  let narrow = false
  for (let i = 0; i < tiles.length; i++) tiles[i].classList.remove('pd-pcard__btn--side', 'pd-pcard__btn--bare')
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i] as HTMLElement
    if (!t.querySelector('.pd-pcard__bi') || !t.querySelector('.pd-pcard__bl')) continue
    if (t.clientWidth < TILE_WORDS_MIN) narrow = true
    else if (t.clientHeight < font * 2.7 + 4) short = true
  }
  for (let i = 0; i < tiles.length; i++) {
    if (narrow) { if (tiles[i].querySelector('.pd-pcard__bi')) tiles[i].classList.add('pd-pcard__btn--bare') }
    else if (short) tiles[i].classList.add('pd-pcard__btn--side')
  }
}

/** The sizes a tile label may take, largest first (parts of the card's font). */
const TILE_LABEL = [1, 0.92, 0.85, 0.8]

/**
 * The icons of upright tiles grow with their cell (1.4 to 2.4 em). A label that needs two lines gets them if the icon can
 * shrink enough, no further than 1.4 em; failing that the labels get a little smaller (and that least icon with them),
 * before any is cut to one line. Cells of one height get labels of one size and icons of one size. A word too wide for
 * its tile gets smaller text again.
 */
function sizeTiles(card: HTMLElement) {
  const tiles = card.querySelectorAll('.pd-pcard__btn--tile')
  const font = parseFloat(card.style.fontSize)
  const setLabel = (label: HTMLElement, step: number) => { label.style.fontSize = step ? TILE_LABEL[step] + 'em' : '' }
  const found: { tile: HTMLElement; icon: HTMLElement | null; label: HTMLElement | null; key: string; step: number }[] = []
  const stepOf: { [cell: string]: number } = {}
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i] as HTMLElement
    const icon = t.querySelector('.pd-pcard__bi') as HTMLElement | null
    let label = t.querySelector('.pd-pcard__bl') as HTMLElement | null
    if (label) { setLabel(label, 0); label.classList.remove('pd-pcard__bl--one', 'pd-pcard__bl--break') }
    if (icon) icon.style.width = icon.style.height = icon.style.fontSize = ''
    if (!upright(t)) continue
    if (t.classList.contains('pd-pcard__btn--bare')) label = null
    const key = (label ? '' : 'bare ') + t.clientHeight
    // the first size at which the label, as it wraps then, leaves room for the least icon (7: the margin between them and the button's padding)
    let step = -1
    for (let k = 0; label && step < 0 && k < TILE_LABEL.length; k++) {
      setLabel(label, k)
      if (t.clientHeight - label.offsetHeight >= (icon ? Math.round(font * TILE_LABEL[k] * 1.4) + 7 : 4)) step = k
    }
    if (label) setLabel(label, 0)
    if (step > (stepOf[key] || 0)) stepOf[key] = step
    found.push({ tile: t, icon, label, key, step })
  }
  const smallest: { [cell: string]: number } = {}
  for (let i = 0; i < found.length; i++) {
    const f = found[i]
    const step = f.step < 0 ? 0 : stepOf[f.key] || 0
    if (f.label) {
      if (f.step < 0) f.label.classList.add('pd-pcard__bl--one') // no size leaves two lines
      else setLabel(f.label, step)
    }
    if (!f.icon) continue
    const least = Math.round(font * TILE_LABEL[step] * 1.4)
    const want = Math.min(f.tile.clientHeight * (f.label ? 0.38 : 0.55), f.tile.clientWidth * 0.55)
    let px = Math.round(Math.max(font * 1.4, Math.min(font * 2.4, want)))
    if (f.label) px = Math.max(least, Math.min(px, Math.floor(f.tile.clientHeight - f.label.offsetHeight - 7)))
    if (smallest[f.key] === undefined || px < smallest[f.key]) smallest[f.key] = px
  }
  for (let i = 0; i < found.length; i++) {
    const f = found[i]
    if (f.icon) f.icon.style.width = f.icon.style.height = f.icon.style.fontSize = smallest[f.key] + 'px'
    const label = f.label
    if (!label) continue
    const now = f.step < 0 ? 1 : TILE_LABEL[stepOf[f.key] || 0]
    const narrower = [0.92, 0.85, 0.78].filter((x) => x < now)
    for (let k = 0; k < narrower.length && label.scrollWidth > label.clientWidth; k++) label.style.fontSize = narrower[k] + 'em'
    if (label.scrollWidth > label.clientWidth) label.classList.add('pd-pcard__bl--break')
  }
}

/** A ring with no `size` beside its card's other parts (a stack row) fills the height; elsewhere the default is "m". */
const sizeOf = (r: HTMLElement): string => r.getAttribute('data-size') || (r.hasAttribute('data-full') ? 'full' : 'm')

/**
 * Gives every dial its pixel size, once the text has settled: each ring is a share of the card's free space (flex, in
 * deck.css), and the dial is the largest square in it, above the label, scaled by `size`. Rings of one size are all as big
 * as the smallest of them, so a grid looks even.
 */
function sizeRings(card: HTMLElement) {
  const found = card.querySelectorAll('.pd-pcard__ring')
  const rings: HTMLElement[] = []
  for (let i = 0; i < found.length; i++) rings.push(found[i] as HTMLElement)
  const labelOf = (r: HTMLElement) => r.querySelector('.pd-pcard__rl') as HTMLElement | null
  const room = (r: HTMLElement, label: HTMLElement | null) => Math.min(r.clientWidth, r.clientHeight - (label ? label.offsetHeight + 2 : 0))
  let labels = true
  for (let i = 0; i < rings.length; i++) {
    const l = labelOf(rings[i])
    if (l && rings[i].offsetParent && room(rings[i], l) < RING_LABEL_MIN) labels = false
  }
  const side: { [size: string]: number } = {}
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i]
    const l = labelOf(r)
    if (l && !labels) l.classList.add('pd-pcard__cut')
    if (!r.offsetParent) continue // left out by trim()
    const size = sizeOf(r)
    const s = Math.floor(room(r, labels ? l : null) * (RING_SCALE[size] || 1))
    if (side[size] === undefined || s < side[size]) side[size] = s
  }
  for (let i = 0; i < rings.length; i++) {
    const dial = rings[i].querySelector('.pd-pcard__dial') as HTMLElement
    const s = Math.max(8, side[sizeOf(rings[i])] || 0)
    dial.style.width = dial.style.height = s + 'px'
    const text = dial.querySelector('.pd-pcard__rt') as HTMLElement | null
    if (text) text.style.fontSize = ringTextPx(s, text.textContent || '') + 'px'
    const icon = dial.querySelector('.pd-pcard__ri') as HTMLElement | null
    if (icon) {
      icon.style.width = icon.style.height = Math.round(s * 0.42) + 'px'
      icon.style.fontSize = Math.round(s * 0.36) + 'px'
    }
  }
}

/** An SVG ring: stroke-dasharray draws the arc, and a CSS transition on the offset moves it when the value changes. */
function Ring(props: { node: Extract<CardNode, { t: 'ring' }>; color: string; textColor?: string; assets?: IconAssets }) {
  const n = props.node
  const gauge = n.arc === 'gauge'
  const around = 2 * Math.PI * 44
  const length = gauge ? around * 0.75 : around
  const dash = length.toFixed(2) + ' ' + around.toFixed(2)
  const turn = 'rotate(' + (gauge ? 135 : -90) + ' 50 50)'
  return (
    <span class="pd-pcard__ring" data-size={n.size} role="progressbar" aria-label={n.label || n.text || n.icon} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(n.value * 100)}>
      <span class="pd-pcard__ringin">
        <span class="pd-pcard__dial">
          <svg width="100%" height="100%" viewBox="0 0 100 100" aria-hidden="true">
            <circle class="pd-pcard__rtrack" cx="50" cy="50" r="44" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray={dash} transform={turn} />
            {/* a round cap would leave a dot at 0, so the arc is hidden there */}
            <circle class="pd-pcard__rarc" cx="50" cy="50" r="44" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray={dash} transform={turn}
              style={{ stroke: props.color, strokeDashoffset: (length * (1 - n.value)).toFixed(2), strokeOpacity: n.value > 0 ? '1' : '0' }} />
          </svg>
          {n.text !== undefined && n.text !== '' ? (
            // keys: the two centres get their sizes by hand (sizeRings), so one must never be reused as the other
            <span key="text" class="pd-pcard__rmid"><span class="pd-pcard__rt" data-part="tile-value" style={{ color: props.textColor }}>{n.text}</span></span>
          ) : n.icon ? (
            <span key="icon" class="pd-pcard__rmid" style={{ color: props.textColor }}><span class="pd-pcard__ri"><TileIcon value={n.icon} size={24} assets={props.assets} /></span></span>
          ) : null}
        </span>
        {n.label ? <span class="pd-pcard__rl" data-part="tile-sub">{n.label}</span> : null}
      </span>
    </span>
  )
}
