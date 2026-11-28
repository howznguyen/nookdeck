/**
 * Pure logic of the dither clock (clocks.tsx Dither): two bitmap fonts (5 x 7, and 3 x 5 for small tiles), the layout of the time on a
 * monospace character grid that fills the tile, the glyph layer (each font pixel a solid block of sx x sy cells, dithered into the
 * dense end of the ramp, with a 1-cell dithered falloff round the strokes on big glyphs), deterministic background noise and the
 * scramble a changed digit resolves through. No Preact here so the tests can import it. Safari 12: no ?. / ??.
 */

/** Light to dense. Index 0 is a blank cell. */
export const RAMP = ' .:-=+*#%@'
/** Background noise uses only these (never the dense end of the ramp). */
const NOISE = '.:-'
/** Scramble frames draw from the middle of the ramp. */
const SCRAMBLE = '-=+*#%'

export type FontId = 5 | 3

/** 5 x 7 glyphs ('#' = on); ':' is 1 wide. */
const FONT5: { [ch: string]: string[] } = {
  '0': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ':': ['.', '.', '#', '.', '#', '.', '.'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
}

/** 3 x 5 glyphs for small tiles and the small seconds / AM-PM; ':' is 1 wide. */
const FONT3: { [ch: string]: string[] } = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  ':': ['.', '#', '.', '#', '.'],
  A: ['###', '#.#', '###', '#.#', '#.#'],
  P: ['###', '#.#', '###', '#..', '#..'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  S: ['###', '#..', '###', '..#', '###'],
  C: ['###', '#..', '#..', '#..', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
}

const fontOf = (f: FontId) => (f === 5 ? FONT5 : FONT3)
/** Glyph height in font pixels. */
export const glyphH = (f: FontId): number => (f === 5 ? 7 : 5)
/** Whether every character of `text` has a bitmap glyph (AM/PM, SA/CH do; 上午 does not). */
export const hasGlyphs = (text: string): boolean => text.length > 0 && text.split('').every((c) => !!FONT3[c])
/** Width of a glyph in font pixels. */
export const glyphW = (ch: string, f?: FontId): number => {
  const g = fontOf(f || 5)[ch]
  return g ? g[0].length : f === 3 ? 3 : 5
}
/** Width of a string in font pixels, 1 px between glyphs. */
export const textUnits = (text: string, f?: FontId): number => {
  let w = 0
  for (let i = 0; i < text.length; i++) w += glyphW(text.charAt(i), f) + (i ? 1 : 0)
  return w
}
export const pixelOn = (ch: string, f: FontId, x: number, y: number): boolean => {
  const g = fontOf(f)[ch]
  return !!g && y >= 0 && y < g.length && x >= 0 && x < g[0].length && g[y].charAt(x) === '#'
}

/** Cell column where font pixel column px of a glyph starts (narrow glyphs have a 1-cell middle column). */
export function colStart(g: { ch: string; font: FontId; sx: number; narrow?: boolean }, px: number): number {
  if (!g.narrow) return px * g.sx
  if (glyphW(g.ch, g.font) !== 3) return 0
  return px === 0 ? 0 : px === 1 ? g.sx : g.sx + 1
}
/** Width of a glyph in cells. */
export function glyphCols(g: { ch: string; font: FontId; sx: number; narrow?: boolean }): number {
  const w = glyphW(g.ch, g.font)
  if (g.narrow) return w === 3 ? 2 * g.sx + 1 : 1
  return w * g.sx
}
/** Width of a string in cells, with the gap between glyphs (1 cell when narrow, one font pixel otherwise). */
export function textCols(text: string, font: FontId, sx: number, narrow?: boolean): number {
  let w = 0
  for (let i = 0; i < text.length; i++) w += glyphCols({ ch: text.charAt(i), font: font, sx: sx, narrow: narrow }) + (i ? (narrow ? 1 : sx) : 0)
  return w
}

/** 4 x 4 Bayer matrix (values 0..15). */
export const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

/** Coverage 0..1 -> a ramp index, ordered-dithered between the two nearest levels by the Bayer threshold of cell (c, r). */
export function rampIndex(cov: number, c: number, r: number): number {
  const v = Math.max(0, Math.min(1, cov))
  const q = v * (RAMP.length - 1)
  const base = Math.floor(q)
  const t = (BAYER[r & 3][c & 3] + 0.5) / 16
  return Math.min(RAMP.length - 1, base + (q - base > t ? 1 : 0))
}

/** Deterministic 32-bit hash of a few integers (seed, column, row, ...), 0 <= h < 2^32. */
export function hash4(a: number, b: number, c: number, d: number): number {
  let h = (a | 0) ^ 0x9e3779b9
  const mix = (k: number) => {
    k = Math.imul(k | 0, 0xcc9e2d51)
    k = (k << 15) | (k >>> 17)
    k = Math.imul(k, 0x1b873593)
    h ^= k
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 0xe6546b64) | 0
  }
  mix(b)
  mix(c)
  mix(d)
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}
const unit = (h: number) => h / 4294967296

/**
 * The faint background character of cell (c, r): about 7% of cells carry a dim mark from NOISE, the rest are blank. `tick` (seconds)
 * shimmers it: each cell re-rolls once every 6 ticks, cells out of phase, so about a sixth of the marks change per tick.
 */
export function noiseChar(seed: number, c: number, r: number, tick: number): string {
  const phase = hash4(seed, c, r, 7) % 6
  const epoch = Math.floor((tick + phase) / 6)
  const h = hash4(seed, c, r, epoch)
  if (unit(h) >= 0.07) return ' '
  return NOISE.charAt(hash4(seed ^ 0x55, c, r, epoch) % NOISE.length)
}

export interface PlacedGlyph {
  ch: string
  font: FontId
  /** top left cell */
  c: number
  r: number
  /** cells per font pixel, across and down */
  sx: number
  sy: number
  /** narrow counters (3 x 5 font at sx 2): the middle column is 1 cell, the outer ones 2, the colon and the gap 1, so strokes stay solid "@@" */
  narrow?: boolean
  part: 'main' | 'sec' | 'ap'
  /** position of the glyph in its part's string */
  idx: number
}

export interface DitherText {
  row: number
  /** first column; -1 = centred */
  col: number
  text: string
}

export interface DitherLayout {
  /** font px; a cell is CELL_W of it wide and exactly it tall (line-height = font size) */
  f: number
  cellW: number
  cellH: number
  cols: number
  rows: number
  /** the grid is centred in the tile: offsets of its box in px */
  offX: number
  offY: number
  glyphs: PlacedGlyph[]
  texts: DitherText[]
  /** 'row' = HH:MM on one line, 'stack' = HH over MM */
  mode: 'row' | 'stack'
  /** a 1-cell dithered falloff round the strokes (only when a font pixel is at least 3 x 2 cells, so glyphs never run together) */
  halo: boolean
}

export interface DitherInput {
  hh: string
  mm: string
  /** seconds text ("07") or '' */
  ss: string
  /** AM/PM text or '' */
  ap: string
  /** caption (only a label the user set) or '' */
  label: string
  /** date line or '' */
  date: string
}

/** Advance width of a monospace character (Menlo, Roboto Mono, Droid Sans Mono, Courier: 0.6 em). */
export const CELL_W = 0.6
/** Smallest grid font: characters stay legible on a phone (fewer, bigger cells on small tiles). */
export const MIN_F = 11
/** Strip tiles (2x1, 3x1) may go this small, and only when no 11 px grid gives solid 2-cell strokes. */
export const STRIP_F = 9
const MAX_F = 24

interface Cand {
  f: number
  cols: number
  rows: number
  font: FontId
  mode: 'row' | 'stack'
  sx: number
  sy: number
  narrow: boolean
  /** small glyphs beside the time for seconds / AM-PM */
  side: boolean
  ssx: number
  ssy: number
  top: boolean
  bottom: boolean
  blockW: number
  blockH: number
  score: number
}

/**
 * Lays the time out on a grid filling a W x H px tile. Every font size from MIN_F up, both fonts, HH:MM on one line or HH over MM,
 * and every whole number of cells per font pixel are tried; the one with the tallest digits in px wins (a font pixel only 1 row tall,
 * or squashed narrow, counts less, and so does dropping the caption / date rows or the small seconds and AM/PM glyphs). Ties go to the
 * smaller font. Strip tiles too narrow for solid 2-cell strokes at MIN_F may use a STRIP_F..MIN_F font with narrow counters
 * (outer columns 2 cells, the middle one 1). The hours and minutes are centred as one block; seconds and AM/PM that do not get glyphs become their own short text beside the time (or in the bottom row), never
 * glued to the caption. The caption takes the top row, the date the bottom row.
 */
export function ditherLayout(W: number, H: number, inp: DitherInput): DitherLayout {
  const apGlyph = !!inp.ap && hasGlyphs(inp.ap)
  const wantSide = !!inp.ss || apGlyph
  const wantTop = !!inp.label
  const wantBottom = !!inp.date
  let best: Cand | null = null
  const fonts: FontId[] = [5, 3]
  // stack first: on a tie (a 3x2 can fit both) HH over MM wins
  const modes: ('row' | 'stack')[] = ['stack', 'row']
  for (let f = STRIP_F; f <= MAX_F; f++) {
    const cols = Math.floor(W / (f * CELL_W))
    const rows = Math.floor(H / f)
    if (cols < 6 || rows < 3) continue
    for (let fi = 0; fi < 2; fi++) {
      const font = fonts[fi]
      const gh = glyphH(font)
      for (let mi = 0; mi < 2; mi++) {
        const mode = modes[mi]
        const uh = mode === 'row' ? gh : gh * 2 + 1
        for (let sy = 1; sy <= 8; sy++) {
          const sq = Math.max(1, Math.round(sy / CELL_W))
          const opts: { sx: number; narrow: boolean }[] = []
          if (sq > 1) opts.push({ sx: sq, narrow: false }, { sx: sq - 1, narrow: false })
          else opts.push({ sx: 1, narrow: false })
          if (font === 3 && sy === 1) opts.push({ sx: 2, narrow: true })
          for (let k = 0; k < opts.length; k++) {
            const sx = opts[k].sx
            const narrow = opts[k].narrow
            const mainW = mode === 'row' ? textCols(inp.hh + ':' + inp.mm, font, sx, narrow) : Math.max(textCols(inp.hh, font, sx, narrow), textCols(inp.mm, font, sx, narrow))
            const blockH = uh * sy
            for (let v = 0; v < 8; v++) {
              if ((v & 1 && !wantSide) || (v & 2 && !wantTop) || (v & 4 && !wantBottom)) continue
              const side = (v & 1) === 1
              const top = (v & 2) === 2
              const bottom = (v & 4) === 4
              // small glyphs: the 3 x 5 font at half the main scale, beside the hours (AM/PM) and the minutes (seconds)
              const ssy = Math.max(1, Math.floor(sy / 2))
              const ssx = Math.max(1, Math.round(ssy / CELL_W))
              const sideW = side ? sx + Math.max(inp.ss ? textUnits(inp.ss, 3) : 0, apGlyph ? textUnits(inp.ap, 3) : 0) * ssx : 0
              const sideH = side ? (inp.ss && apGlyph ? 11 : 5) * ssy : 0
              if (side && (sideH > blockH || sy < 2)) continue
              // the time is centred on its own; the small glyphs hang after it, so they need the room on the right only
              const blockW = mainW
              const availR = rows - (top ? 2 : 0) - (bottom ? 2 : 0)
              if (mainW > cols - (f < MIN_F ? 1 : 2) || blockH > availR) continue
              if (side && Math.floor((cols - mainW) / 2) + mainW + sideW > cols - 1) continue
              // the small strip font is only for the digits themselves: no caption or date rows on it
              if (f < MIN_F && (sx < 2 || rows > 7 || top || bottom)) continue
              if (top && inp.label.length > cols - 2) continue
              if (bottom && inp.date.length > cols - 2) continue
              let score = gh * sy * f
              // a stroke only 1 cell thick does not read as bold: a font pixel 1 row tall or 1 column wide counts much less
              if (sy === 1) score *= 0.6
              if (sx === 1) score *= 0.4
              if (f < MIN_F) score *= 0.9
              if ((sx * CELL_W) / sy < 0.85) score *= 0.85
              if (wantSide && !side) score *= 0.9
              // seconds / AM-PM as short texts need room right of the time or a free bottom row, else they would be lost
              const looseLen = Math.max(inp.ss && !side ? inp.ss.length + 1 : 0, inp.ap && !(side && apGlyph) ? inp.ap.length : 0)
              if (looseLen && Math.floor((cols - mainW) / 2) + mainW + 1 + looseLen > cols - 1 && !(blockH < availR) && !bottom) score *= 0.4
              if (wantTop && !top) score *= 0.85
              if (wantBottom && !bottom) score *= 0.85
              if (!best || score > best.score + 0.5) {
                best = { f: f, cols: cols, rows: rows, font: font, mode: mode, sx: sx, sy: sy, narrow: narrow, side: side, ssx: ssx, ssy: ssy, top: top, bottom: bottom, blockW: blockW, blockH: blockH, score: score }
              }
            }
          }
        }
      }
    }
  }
  if (!best) {
    // a tile too small for any glyph: the time as plain text
    const f = MIN_F
    const cols = Math.max(1, Math.floor(W / (f * CELL_W)))
    const rows = Math.max(1, Math.floor(H / f))
    return { f: f, cellW: f * CELL_W, cellH: f, cols: cols, rows: rows, offX: Math.max(0, (W - cols * f * CELL_W) / 2), offY: Math.max(0, (H - rows * f) / 2), glyphs: [], texts: [{ row: Math.floor(rows / 2), col: -1, text: inp.hh + ':' + inp.mm }], mode: 'row', halo: false }
  }
  const B = best
  const cellW = B.f * CELL_W
  const y0 = B.top ? 2 : 0
  const availR = B.rows - y0 - (B.bottom ? 2 : 0)
  // the hours and minutes are centred as one block; seconds and AM/PM hang after it and never move that centre
  const bc = Math.floor((B.cols - B.blockW) / 2)
  const br = y0 + Math.floor((availR - B.blockH) / 2)
  const glyphs: PlacedGlyph[] = []
  const put = (text: string, font: FontId, c: number, r: number, sx: number, sy: number, part: 'main' | 'sec' | 'ap', from: number, narrow?: boolean) => {
    let cc = c
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i)
      const g: PlacedGlyph = { ch: ch, font: font, c: cc, r: r, sx: sx, sy: sy, part: part, idx: from + i }
      if (narrow) g.narrow = true
      glyphs.push(g)
      cc += glyphCols(g) + (narrow ? 1 : sx)
    }
  }
  const N = B.narrow
  const gh = glyphH(B.font)
  let mainRight: number
  if (B.mode === 'row') {
    put(inp.hh + ':' + inp.mm, B.font, bc, br, B.sx, B.sy, 'main', 0, N)
    mainRight = bc + textCols(inp.hh + ':' + inp.mm, B.font, B.sx, N)
  } else {
    const wh = textCols(inp.hh, B.font, B.sx, N)
    const wm = textCols(inp.mm, B.font, B.sx, N)
    // each line centred in the block (both are two digits, so they line up)
    put(inp.hh, B.font, bc + Math.floor((B.blockW - wh) / 2), br, B.sx, B.sy, 'main', 0, N)
    put(inp.mm, B.font, bc + Math.floor((B.blockW - wm) / 2), br + (gh + 1) * B.sy, B.sx, B.sy, 'main', inp.hh.length + 1, N)
    mainRight = bc + B.blockW
  }
  const texts: DitherText[] = []
  const blockBottom = br + B.blockH - 1
  if (B.side) {
    const sideC = mainRight + B.sx
    if (apGlyph) put(inp.ap, 3, sideC, br, B.ssx, B.ssy, 'ap', 0)
    if (inp.ss) put(inp.ss, 3, sideC, br + B.blockH - 5 * B.ssy, B.ssx, B.ssy, 'sec', 0)
  }
  // seconds / AM-PM without glyphs: their own short texts right of the time (its top and bottom line), else in the bottom row
  const loose: { text: string; at: 'top' | 'bottom' }[] = []
  if (inp.ap && !(B.side && apGlyph)) loose.push({ text: inp.ap, at: 'top' })
  if (inp.ss && !B.side) loose.push({ text: ':' + inp.ss, at: 'bottom' })
  let bottomText = B.bottom ? inp.date : ''
  loose.forEach((x) => {
    const col = mainRight + 1
    if (col + x.text.length <= B.cols - 1) texts.push({ row: x.at === 'top' ? br : blockBottom, col: col, text: x.text })
    else if (bottomText && bottomText.length + 2 + x.text.length <= B.cols - 2) bottomText += '  ' + x.text
    else if (br + B.blockH < B.rows) bottomText = bottomText ? bottomText + '  ' + x.text : x.text
  })
  // a bottom row that only got the loose bits (no date row was planned) stays clear of the time
  if (!B.bottom && bottomText && br + B.blockH >= B.rows) bottomText = ''
  if (B.top) texts.push({ row: 0, col: -1, text: inp.label })
  if (bottomText && bottomText.length <= B.cols) texts.push({ row: B.rows - 1, col: -1, text: bottomText })
  return {
    f: B.f,
    cellW: cellW,
    cellH: B.f,
    cols: B.cols,
    rows: B.rows,
    offX: (W - B.cols * cellW) / 2,
    offY: (H - B.rows * B.f) / 2,
    glyphs: glyphs,
    texts: texts,
    mode: B.mode,
    halo: B.sx >= 3 && B.sy >= 2,
  }
}

/** One grid: a string of characters per row, and per row a string of kinds ('0' background, '1' stroke, '3' falloff, '2' text). */
export interface DitherGrid {
  chars: string[]
  kinds: string[]
}

/** Whether cell (c, r) lies in a lit font pixel of glyph G. */
export function glyphHit(G: PlacedGlyph, c: number, r: number): boolean {
  if (c < G.c || r < G.r || c >= G.c + glyphCols(G)) return false
  const w = glyphW(G.ch, G.font)
  let px = 0
  while (px + 1 < w && G.c + colStart(G, px + 1) <= c) px++
  return pixelOn(G.ch, G.font, px, Math.floor((r - G.r) / G.sy))
}

/**
 * The glyph layer: stroke cells from the dense end of the ramp ('%' and '@' mixed by the Bayer matrix), on big glyphs a 1-cell
 * dithered falloff round them (side neighbours denser than corner ones), the text rows; background cells left as '\0' for the noise.
 */
export function glyphLayer(L: DitherLayout): DitherGrid {
  const core: boolean[][] = []
  for (let r = 0; r < L.rows; r++) {
    const row: boolean[] = []
    for (let c = 0; c < L.cols; c++) row.push(false)
    core.push(row)
  }
  L.glyphs.forEach((G) => {
    const w = glyphW(G.ch, G.font)
    const h = glyphH(G.font)
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        if (!pixelOn(G.ch, G.font, px, py)) continue
        const c0 = G.c + colStart(G, px)
        const c1 = G.c + (px + 1 < w ? colStart(G, px + 1) : glyphCols(G))
        for (let r = G.r + py * G.sy; r < G.r + (py + 1) * G.sy; r++) {
          for (let c = c0; c < c1; c++) if (r >= 0 && r < L.rows && c >= 0 && c < L.cols) core[r][c] = true
        }
      }
    }
  })
  const at = (c: number, r: number) => r >= 0 && r < L.rows && c >= 0 && c < L.cols && core[r][c]
  const chars: string[] = []
  const kinds: string[] = []
  for (let r = 0; r < L.rows; r++) {
    let cs = ''
    let ks = ''
    for (let c = 0; c < L.cols; c++) {
      if (core[r][c]) {
        cs += RAMP.charAt(rampIndex(0.96, c, r))
        ks += '1'
        continue
      }
      // the falloff: one light cell beside a stroke (side neighbours only, no corners), so the digits stay sharp
      const cov = L.halo && (at(c - 1, r) || at(c + 1, r) || at(c, r - 1) || at(c, r + 1)) ? 0.26 : 0
      const i = cov > 0 ? rampIndex(cov, c, r) : 0
      if (i > 0) {
        cs += RAMP.charAt(i)
        ks += '3'
      } else {
        cs += '\0'
        ks += '0'
      }
    }
    chars.push(cs)
    kinds.push(ks)
  }
  for (let t = 0; t < L.texts.length; t++) {
    const T = L.texts[t]
    if (T.row < 0 || T.row >= L.rows) continue
    const start = T.col >= 0 ? T.col : Math.max(0, Math.floor((L.cols - T.text.length) / 2))
    const end = Math.min(L.cols, start + T.text.length)
    if (end <= start) continue
    chars[T.row] = chars[T.row].slice(0, start) + T.text.slice(0, end - start) + chars[T.row].slice(end)
    kinds[T.row] = kinds[T.row].slice(0, start) + repeat('2', end - start) + kinds[T.row].slice(end)
  }
  return { chars: chars, kinds: kinds }
}

function repeat(ch: string, n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += ch
  return s
}

/** The full grid at second `tick`: the glyph layer with every background cell filled by its noise character. */
export function fillNoise(layer: DitherGrid, seed: number, tick: number): DitherGrid {
  const chars: string[] = []
  for (let r = 0; r < layer.chars.length; r++) {
    const row = layer.chars[r]
    let s = ''
    for (let c = 0; c < row.length; c++) {
      const ch = row.charAt(c)
      s += ch === '\0' ? noiseChar(seed, c, r, tick) : ch
    }
    chars.push(s)
  }
  return { chars: chars, kinds: layer.kinds }
}

/** The cell box a glyph covers (inclusive), one cell of margin for the falloff, clipped to the grid. */
export function glyphCells(L: DitherLayout, G: PlacedGlyph): { c0: number; r0: number; c1: number; r1: number } {
  return {
    c0: Math.max(0, G.c - 1),
    r0: Math.max(0, G.r - 1),
    c1: Math.min(L.cols - 1, G.c + glyphCols(G)),
    r1: Math.min(L.rows - 1, G.r + glyphH(G.font) * G.sy),
  }
}

/**
 * A scramble frame over a cell box: each cell settles on its final character once `prog` (0..1) passes its own random point, before
 * that it shows a random mid-ramp character that changes with `frame` (only the cells the glyph lights plus a sparse scatter, so the
 * box is not filled solid). prog >= 1 gives the grid back unchanged. Only the rows of the box are rebuilt.
 */
export function scramble(g: DitherGrid, box: { c0: number; r0: number; c1: number; r1: number }, prog: number, frame: number, seed: number): DitherGrid {
  if (prog >= 1) return g
  const chars = g.chars.slice()
  const kinds = g.kinds.slice()
  for (let r = box.r0; r <= box.r1 && r < chars.length; r++) {
    let cs = ''
    let ks = ''
    const row = chars[r]
    const kr = kinds[r]
    for (let c = box.c0; c <= box.c1 && c < row.length; c++) {
      const k = kr.charAt(c)
      const settled = unit(hash4(seed, c, r, 99)) < prog
      const lit = k === '1' || k === '3' || unit(hash4(seed, c, r, frame + 1000)) < 0.18
      if (settled || k === '2' || !lit) {
        cs += row.charAt(c)
        ks += k
      } else {
        cs += SCRAMBLE.charAt(hash4(seed, c, r, frame) % SCRAMBLE.length)
        ks += '3'
      }
    }
    const end = Math.min(row.length, box.c1 + 1)
    chars[r] = row.slice(0, box.c0) + cs + row.slice(end)
    kinds[r] = kr.slice(0, box.c0) + ks + kr.slice(end)
  }
  return { chars: chars, kinds: kinds }
}

/** Runs of one kind in a row, for rendering a few spans per line instead of one per cell. */
export function runsOf(chars: string, kinds: string): { k: string; t: string }[] {
  const out: { k: string; t: string }[] = []
  let i = 0
  while (i < chars.length) {
    const k = kinds.charAt(i)
    let j = i + 1
    while (j < chars.length && kinds.charAt(j) === k) j++
    out.push({ k: k, t: chars.slice(i, j) })
    i = j
  }
  return out
}
