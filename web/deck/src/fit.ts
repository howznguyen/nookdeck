/**
 * Fit text to its box. Sizes in the clocks, metric tiles and rings are tuned for the system font; a wide pack font (Orbitron,
 * Press Start 2P, Archivo Black, VT323) is wider, so after layout every element below that is wider than the room it has
 * is scaled down. The sizes the components compute stay the first guess, and Preact never sees the change.
 *  - row text (clock digits, values, `data-part="num"`): scaled with a transform to the room in its row.
 *  - ring text (gauge / donut / ring centres): scaled about its centre to the inner circle (0.7 of the diameter, 0.6 for half rings);
 *    when it still does not fit at 70% the unit is dropped.
 *  - labels (tile-label on buttons): up to 2 lines, then the font steps down, then an ellipsis.
 * Safari 12: no ResizeObserver, so it re-runs on window resize, DOM and style changes, and when fonts finish loading.
 */

export const FIT_ROW = '.pd-clock__t, .pd-clk__min, .pd-fl__h span, .pd-wd__t, .pd-sb__time, .pd-mv, .pd-vl__v, .pd-wx__t, .pd-pl__cv, .pd-ent__v, .pd-wx__dhi, .pd-wx__dlo'
export const FIT_RING = '.pd-gwrap__n, .pd-ring__t, .pd-pl__gv'
export const FIT_LABEL = '.pd-tile__lb, .pd-ios__lb'
const RING_BOX = '.pd-gwrap, .pd-ring, .pd-pl__g'

/** The scale (<= 1) that makes `content` fit in `room`; never below 0.2 so a broken measurement cannot shrink text to nothing. */
export function fitScale(content: number, room: number): number {
  if (!(content > 0) || !(room > 0) || content <= room + 0.5) return 1
  return Math.max(0.2, Math.floor((room / content) * 1000) / 1000)
}

/** The text room inside a ring of `diameter`: the inner circle's usable width; half rings have only the chord at the baseline. */
export function ringRoom(diameter: number, half: boolean): number {
  return diameter * (half ? 0.6 : 0.7)
}

/** Font-size factors tried for a label that does not fit in 2 lines. */
export const LABEL_STEPS = [1, 0.9, 0.8, 0.7]

const px = (v: string | null): number => parseFloat(v || '') || 0
const num = (el: HTMLElement, k: string): number => parseFloat(el.getAttribute(k) || '') || 0

/** The natural width of an element's text (a range rect, so it is right for block elements that span their parent too). */
function textWidth(el: HTMLElement): number {
  const r = document.createRange()
  r.selectNodeContents(el)
  const w = r.getBoundingClientRect().width
  const k = num(el, 'data-fk') || 1
  return w / k
}

function rowRoom(el: HTMLElement): number {
  const p = el.parentElement
  if (!p) return el.clientWidth
  const cs = getComputedStyle(p)
  let w = p.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight)
  if (/flex/.test(cs.display) && !/column/.test(cs.flexDirection || '')) {
    for (let i = 0; i < p.children.length; i++) {
      const c = p.children[i] as HTMLElement
      if (c === el) continue
      const ccs = getComputedStyle(c)
      if (ccs.position === 'absolute') continue
      w -= c.offsetWidth + px(ccs.marginLeft) + px(ccs.marginRight)
    }
  }
  return w
}

function setTransform(el: HTMLElement, transform: string, origin: string, k: number) {
  if (el.style.transform === transform && el.style.transformOrigin === origin) return
  el.style.transformOrigin = origin
  el.style.transform = transform
  if (k < 1) {
    el.setAttribute('data-fit', '1')
    el.setAttribute('data-fk', String(k))
  } else {
    el.removeAttribute('data-fit')
    el.removeAttribute('data-fk')
  }
}

function fitRow(el: HTMLElement): boolean {
  const cur = el.style.transform
  if (cur && !el.hasAttribute('data-fit')) return false // a transform some other code set inline
  if (!cur && el.getAttribute('data-ft0') === null) {
    // a transform that comes from css (not ours): leave it alone
    const c = getComputedStyle(el).transform
    if (c && c !== 'none') return false
  }
  const room = rowRoom(el)
  const content = el.scrollWidth > el.clientWidth + 1 || !el.clientWidth ? el.scrollWidth || el.offsetWidth : textWidth(el) || el.offsetWidth
  const k = fitScale(content, room)
  if (k >= 1) {
    setTransform(el, '', '', 1)
    return false
  }
  const p = el.parentElement
  const pr = p ? p.getBoundingClientRect() : null
  const er = el.getBoundingClientRect()
  const kPrev = num(el, 'data-fk') || 1
  const w = er.width / kPrev // the unscaled width of the box
  const own = el.scrollWidth <= el.clientWidth + 1 // the box itself holds the text (shrink-wrapped)
  const cs = getComputedStyle(el)
  const centredText = cs.textAlign === 'center'
  if (own && pr) {
    // shrink-wrapped: scale about whichever edge it is anchored to
    const mid = Math.abs(er.left + er.width / 2 - (pr.left + pr.width / 2)) < 3
    const right = !mid && Math.abs(er.right - (pr.right - px(getComputedStyle(p as HTMLElement).paddingRight))) < 3
    setTransform(el, 'scale(' + k + ')', mid ? '50% 50%' : right ? '100% 50%' : '0 50%', k)
  } else {
    // the text overflows a box that spans the room: start at the left edge, centred text is moved to stay centred
    const dx = centredText ? Math.max(0, (room - content * k) / 2) : 0
    setTransform(el, (dx ? 'translateX(' + Math.round(dx * 10) / 10 + 'px) ' : '') + 'scale(' + k + ')', '0 50%', k)
  }
  void w
  return true
}

function fitRing(el: HTMLElement): boolean {
  const box = el.closest(RING_BOX) as HTMLElement | null
  if (!box) return false
  const base = el.getAttribute('data-ft0')
  const css = base === null ? getComputedStyle(el).transform : base
  if (base === null && el.style.transform && !el.hasAttribute('data-fit')) return false
  const baseT = !css || css === 'none' ? '' : css + ' '
  if (base === null && baseT) el.setAttribute('data-ft0', css)
  const half = box.classList.contains('pd-pl__g') && el.classList.contains('pd-pl__gv') && box.querySelectorAll('svg')[0] !== undefined && box.getBoundingClientRect().height < box.getBoundingClientRect().width * 0.7
  const room = ringRoom(Math.min(box.offsetWidth, box.offsetHeight > 0 && !half ? box.offsetHeight : box.offsetWidth), half)
  const units = el.querySelectorAll('i')
  let content = textWidth(el)
  const hidden = el.getAttribute('data-fu') === '1'
  if (hidden) content += num(el, 'data-fuw')
  let k = fitScale(content, room)
  if (units.length && k < 0.7) {
    // still too big at 70%: drop the unit and measure again
    if (!hidden) {
      let uw = 0
      for (let i = 0; i < units.length; i++) uw += (units[i] as HTMLElement).getBoundingClientRect().width / (num(el, 'data-fk') || 1)
      el.setAttribute('data-fuw', String(uw))
      for (let i = 0; i < units.length; i++) (units[i] as HTMLElement).style.display = 'none'
      el.setAttribute('data-fu', '1')
      content -= uw
    }
    k = fitScale(content, room)
  } else if (hidden) {
    for (let i = 0; i < units.length; i++) (units[i] as HTMLElement).style.display = ''
    el.removeAttribute('data-fu')
  }
  if (k >= 1) {
    setTransform(el, baseT.trim(), '', 1)
    return false
  }
  setTransform(el, baseT + 'scale(' + k + ')', '50% 50%', k)
  return true
}

function fitLabel(el: HTMLElement) {
  const mine = el.getAttribute('data-fs')
  if (mine === null || el.style.fontSize !== mine) el.setAttribute('data-fo', el.style.fontSize || '') // a new size from the component
  const orig = el.getAttribute('data-fo') || ''
  const natural = orig ? parseFloat(orig) : (() => { el.style.fontSize = ''; return px(getComputedStyle(el).fontSize) })()
  const over = () => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
  let used = ''
  for (let i = 0; i < LABEL_STEPS.length; i++) {
    used = i === 0 ? orig : Math.max(8, Math.round(natural * LABEL_STEPS[i] * 10) / 10) + 'px'
    el.style.fontSize = used
    if (!over()) break
  }
  el.setAttribute('data-fs', used)
}

/** Measure and scale everything fit-able under `root`. Returns how many elements are scaled down. */
export function fitAll(root: HTMLElement): number {
  let n = 0
  const rings = root.querySelectorAll(FIT_RING)
  for (let i = 0; i < rings.length; i++) if (fitRing(rings[i] as HTMLElement)) n++
  const rows = root.querySelectorAll(FIT_ROW + ", [data-part='tile-value'], [data-part='num']")
  for (let i = 0; i < rows.length; i++) {
    const el = rows[i] as HTMLElement
    if (el.matches(FIT_RING) || (el.closest(FIT_RING) && !el.matches(FIT_ROW))) continue // ring text is fitted to the circle, and numbers inside it are part of it
    if (fitRow(el)) n++
  }
  const labels = root.querySelectorAll(FIT_LABEL)
  for (let i = 0; i < labels.length; i++) fitLabel(labels[i] as HTMLElement)
  return n
}

/** Keep `root` fitted. Returns a function that stops it. */
export function installFit(root: HTMLElement): () => void {
  let raf = 0
  let off = false
  let mo: MutationObserver | null = null
  const opts = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'data-theme-pkg', 'data-theme-variant', 'data-pd-bg'] }
  const run = () => {
    raf = 0
    if (off) return
    if (mo) mo.disconnect() // our own writes must not schedule another pass
    try {
      fitAll(root)
    } finally {
      if (mo) mo.observe(root, opts)
    }
  }
  const soon = () => {
    if (!raf && !off) raf = window.requestAnimationFrame(run)
  }
  if (typeof MutationObserver !== 'undefined') {
    mo = new MutationObserver(soon)
    mo.observe(root, opts)
  }
  window.addEventListener('resize', soon)
  window.addEventListener('orientationchange', soon)
  const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown>; addEventListener?: (n: string, f: () => void) => void } }).fonts
  if (fonts) {
    if (fonts.ready) fonts.ready.then(soon, soon)
    if (fonts.addEventListener) fonts.addEventListener('loadingdone', soon)
  }
  const timers = [300, 1200, 3500].map((ms) => window.setTimeout(soon, ms)) // Safari 12 has no FontFaceSet events
  soon()
  return () => {
    off = true
    if (raf) window.cancelAnimationFrame(raf)
    if (mo) mo.disconnect()
    window.removeEventListener('resize', soon)
    window.removeEventListener('orientationchange', soon)
    timers.forEach((t) => window.clearTimeout(t))
  }
}
