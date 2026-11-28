/**
 * Copied from Knowns UI: registry/knowns/ui/knowns/now-playing/now-playing-utils.ts at commit cff14e21 (knowns-ui repo, owner-approved).
 * Deviations: coverGradient() builds an hsl() gradient instead of oklch() (Safari 12 has no oklch), and coverFallback() is unchanged.
 * Everything else is as is.
 */
/** Pure helpers for Now Playing: time text, clamping, local position ticking, labels and the generated cover colours. No React, no DOM. */

/** 83 -> "1:23", 3725 -> "1:02:05". Negative, NaN and Infinity read as 0:00. */
export function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** What a screen reader hears for the scrubber: "1:23 of 3:45". */
export function spokenPosition(position: number, duration: number, join: (p: string, d: string) => string = (p, d) => `${p} of ${d}`): string {
  return join(formatTime(position), formatTime(duration));
}

/** Keeps a position inside 0..duration. An unknown duration (0, NaN) only floors at 0. */
export function clampPosition(position: number, duration: number): number {
  const p = Number.isFinite(position) ? Math.max(0, position) : 0;
  return duration > 0 && Number.isFinite(duration) ? Math.min(p, duration) : p;
}

/** Played share, 0 to 1. */
export function progressOf(position: number, duration: number): number {
  return duration > 0 && Number.isFinite(duration) ? clampPosition(position, duration) / duration : 0;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A gradient cover from the track's own words, so a track without art still has a stable face. Pass `hue` (0 to 360) to pick the colour yourself; otherwise it is one of five clearly different families (orange, violet-blue, teal, rose, green). */
const FAMILIES: [number, number][] = [[48, 22], [268, 232], [182, 205], [345, 312], [145, 118]];
export function coverGradient(seed: string, hue?: number): string {
  const h = hash(seed);
  const [a, b] = hue !== undefined ? [hue, (hue + 36) % 360] : FAMILIES[h % FAMILIES.length]!;
  const angle = 120 + ((h >>> 17) % 90);
  return `linear-gradient(${angle}deg, hsl(${Math.round(a)} 76% 62%), hsl(${Math.round(b)} 62% 44%))`;
}

/** A plain colour for where oklch() is unsupported (an old phone browser): the same family in hsl, set as the background colour under the gradient. */
export function coverFallback(seed: string, hue?: number): string {
  const h = hash(seed);
  const a = hue !== undefined ? hue : FAMILIES[h % FAMILIES.length]![0];
  return `hsl(${Math.round(a)} 72% 58%)`;
}

/** The resting level bars: a fixed, calm skyline so a paused or static player still has a shape. Values 0 to 1. */
export const STATIC_LEVELS = [0.45, 0.8, 0.55, 0.95, 0.65];

/** Turns any list of levels into exactly `count` bars, each 0.12 to 1 (a bar never vanishes). */
export function fitLevels(levels: readonly number[] | undefined, count = 5): number[] {
  const src = levels && levels.length > 0 ? levels : STATIC_LEVELS;
  return Array.from({ length: count }, (_, i) => {
    const v = src[Math.min(src.length - 1, Math.floor((i / count) * src.length))] ?? 0;
    return Math.min(1, Math.max(0.12, Number.isFinite(v) ? v : 0.12));
  });
}

/* ── Remote, pushed state ── */

/**
 * Where a position pushed from outside is now. `updatedAt` is when the host read it (ms since the epoch). While playing the clock keeps
 * running since then; paused, it stands still. Clamped to 0..duration when the duration is known.
 */
export function projectPosition({ position, updatedAt, playing, now, duration }: { position: number; updatedAt?: number; playing: boolean; now: number; duration?: number }): number {
  const base = Number.isFinite(position) ? Math.max(0, position) : 0;
  const run = playing && updatedAt !== undefined && Number.isFinite(updatedAt) ? Math.max(0, now - updatedAt) / 1000 : 0;
  const p = base + run;
  return duration && duration > 0 ? Math.min(p, duration) : p;
}

/**
 * What to show when a push arrives while a local clock is already running. A push slightly behind what is on screen (a late or
 * stale reading, up to `tolerance` seconds) is ignored so the time never jumps back; ahead of the screen, or a real seek back
 * further than the tolerance, is taken. Paused or a new track: always take the push.
 */
export function reconcilePosition({ shown, pushed, playing, tolerance = 2.5 }: { shown: number; pushed: number; playing: boolean; tolerance?: number }): number {
  if (!playing) return pushed;
  if (pushed >= shown) return pushed;
  return shown - pushed <= tolerance ? shown : pushed;
}

/** 0 to 100, whole numbers. NaN reads as 0. */
export function clampVolume(v: number): number {
  return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 0;
}

/* ── Text ── */

/** Every string the player shows or says. Pass any of them in `labels` (a translation, a brand word); the rest stay English. */
export interface NowPlayingLabels {
  nowPlaying: string;
  nothingPlaying: string;
  play: string;
  pause: string;
  previous: string;
  next: string;
  mute: string;
  unmute: string;
  position: string;
  volume: string;
  /** Spoken value of the scrubber. Default "1:23 of 3:45". */
  positionText: (position: string, duration: string) => string;
  /** Spoken and shown volume. Default "50%". */
  volumeText: (volume: number) => string;
  /** The pill's own button name, used when it opens. Default "Title, Artist". */
  trackText: (title: string, artist: string) => string;
}

export const DEFAULT_LABELS: NowPlayingLabels = {
  nowPlaying: "Now playing",
  nothingPlaying: "Nothing playing",
  play: "Play",
  pause: "Pause",
  previous: "Previous track",
  next: "Next track",
  mute: "Mute",
  unmute: "Unmute",
  position: "Position",
  volume: "Volume",
  positionText: (p, d) => `${p} of ${d}`,
  volumeText: (v) => `${v}%`,
  trackText: (t, a) => `${t}, ${a}`,
};

export function resolveLabels<T extends object>(defaults: T, given?: Partial<T>): T {
  const out = { ...defaults };
  for (const k of Object.keys(given ?? {}) as (keyof T)[]) if (given![k] !== undefined) out[k] = given![k] as T[keyof T];
  return out;
}

/** What each layout needs (px) to show every control without clipping: compact is one row (cover, text?, volume button?, play); square is a cover with play over it and the title under it; the others stack rows. */
export type NpVariant = 'capsule' | 'mini' | 'compact' | 'square' | 'medium' | 'mid' | 'large' | 'tall'
export const NP_NEED: { [v: string]: { w: number; h: number } } = { capsule: { w: 0, h: 0 }, mini: { w: 130, h: 56 }, compact: { w: 280, h: 56 }, square: { w: 130, h: 120 }, medium: { w: 180, h: 150 }, mid: { w: 260, h: 150 }, large: { w: 360, h: 180 }, tall: { w: 220, h: 220 } }
/**
 * The layout for a tile: the richest one whose width and height both fit. Square or upright tiles get a real square face: `square`
 * (cover, play, title) under 220 px, `tall` (centred disc, rows, transport) from 220 px: xs under 260 px wide (a 3x3 on the S20,
 * about 245 px), snug under 340 px high. Short tiles get the one-row strip.
 */
export function npVariant(tw: number, th: number): NpVariant {
  if (tw < 130 || th < 56) return 'capsule'
  const sq = th >= tw * 0.75
  if (sq && tw < NP_NEED.tall.w && th >= NP_NEED.square.h) return 'square'
  if (sq && tw >= NP_NEED.tall.w && th >= NP_NEED.tall.h) return 'tall'
  if (sq && tw < 260 && th >= NP_NEED.square.h) return 'square'
  if (th < NP_NEED.medium.h || tw < NP_NEED.medium.w) return tw < NP_NEED.compact.w ? 'mini' : 'compact'
  if (tw < 260) return 'medium'
  if (tw >= NP_NEED.large.w && th >= NP_NEED.large.h) return 'large'
  return 'mid'
}

/** Play button of the one-row strip, and the room the strip keeps around it (margins 6 + 6). */
export const NP_PLAY_ROW = 48
/**
 * What the one-row strip shows in `tw` x `th`: the cover and the play button always; the volume button only while the text keeps
 * 110 px, and the text only when it gets 88 px (else the strip is cover + play, never a title cut to one or two letters).
 * Level bars only when the text still keeps 110 px after them.
 */
export function npCompactParts(tw: number, th: number, hasVol: boolean): { cover: number; text: boolean; vol: boolean; levels: boolean } {
  const cover = Math.max(32, Math.min(44, th - 16))
  let room = tw - 24 - (cover + 10) - (NP_PLAY_ROW + 12)
  let vol = hasVol
  if (vol) {
    if (room - 44 >= 110) room -= 44
    else vol = false
  }
  const text = room >= 88
  return { cover: cover, text: text, vol: vol, levels: text && room - 30 >= 110 }
}

/** The square face: the cover as big as the tile leaves after the padding (12) and the text under it (title 22, artist 18, chip 22). */
export function npSquareCover(tw: number, th: number, artist: boolean, chip: boolean): number {
  const text = 22 + (artist ? 18 : 0) + (chip ? 22 : 0) + 8
  return Math.max(48, Math.min(tw - 24, th - 24 - text))
}
/** The artist line of the square face, when the tile is tall enough to keep a 72 px cover with it. */
export const npSquareArtist = (tw: number, th: number, chip: boolean) => Math.min(tw - 24, th - 24 - 30 - 18 - (chip ? 22 : 0)) >= 72

/** The volume slider gets its own row when the tile is tall enough (large layouts fit it from 236 px); otherwise the volume button in the transport row opens the popover. */
export function npInlineVol(variant: string, tw: number, th: number): boolean {
  if (variant === 'tall') return !npTallXs(tw) && npTallVol(th)
  return tw >= 260 && th >= (variant === 'large' ? 236 : 250)
}
/** The tall layout under 340 px high is snug: 12 px padding, a one-line title, a 52 px play button. */
export const npTallSnug = (th: number) => th < 340
/** Height of the tall layout without its cover: padding 32, text 46, the progress row 20, the transport 60, three gaps of 12, and 16 more between the disc and the title. */
export const NP_TALL_REST = 32 + 46 + 20 + 60 + 36 + 16
/** The same for the snug tall layout: padding 24, text 42, progress 20, transport 52, three gaps of 6, 10 between the disc and the title. */
export const NP_TALL_REST_SNUG = 24 + 42 + 20 + 52 + 18 + 10
export const npTallRest = (th: number) => (npTallSnug(th) ? NP_TALL_REST_SNUG : NP_TALL_REST)
/** The volume slider row of the tall layout (44 plus a gap), only when the cover still gets 120 px. */
export const NP_TALL_VOL = 52
/** The tall layout keeps its volume row whenever the disc still gets 88 px with it (a 4x4 shrinks the disc a little rather than dropping the row). */
export const npTallVol = (th: number) => th - npTallRest(th) - NP_TALL_VOL >= 88
/**
 * The xs tall layout (220 to 260 px wide, e.g. 3x3 on the S20): the same card shrunk. Padding 24, title + artist 38, progress 20,
 * a 48 px play with 44 px prev / next, three gaps of 6, 8 between the disc and the title. No volume row: the speaker button sits in
 * the top right corner (44 px, 8 px in) beside the disc and opens the popover.
 */
export const npTallXs = (tw: number) => tw < 260
export const NP_TALL_REST_XS = 24 + 38 + 20 + 48 + 18 + 8
/** The disc of the xs layout keeps clear of the corner button: (tw - disc) / 2 >= 12 + 44 + 4. */
export const npTallXsCover = (tw: number, th: number) => Math.max(56, Math.min(200, tw - 120, th - NP_TALL_REST_XS))
/** Cover (a disc, centred) of the tall layout: as big as the rows under it leave room for, up to 200 px. */
export function npTallCover(tw: number, th: number): number {
  if (npTallXs(tw)) return npTallXsCover(tw, th)
  return Math.max(56, Math.min(200, tw - (npTallSnug(th) ? 40 : 64), th - npTallRest(th) - (npTallVol(th) ? NP_TALL_VOL : 0)))
}
/** Width of the controls column of the large layout that always fits: 3 transport buttons + the volume button. */
export const NP_COL_MIN = 44 + 52 + 44 + 44 + 8
/** Cover of the large layout: as big as the height allows, but never so wide that the controls column drops under NP_COL_MIN. */
export function npCoverSize(tw: number, th: number): number {
  return Math.max(48, Math.min(168, th - 24, tw - 32 - 14 - NP_COL_MIN))
}

/**
 * Width of a text in em at weight 600, without the DOM: CJK and full-width characters are about 1 em, wide capitals and digits about
 * 0.68, the rest about 0.55. Good enough to pick a font size; the line is still clamped with an ellipsis at the minimum size.
 */
export function textEm(text: string): number {
  let w = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) continue // first half of a surrogate pair (emoji): counted once, below
    if ((c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xdc00 && c <= 0xdfff)) w += 1
    else if (c === 32) w += 0.28
    else if ((c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 87 || c === 109 || c === 77) w += 0.68
    else if (c === 105 || c === 108 || c === 106 || c === 46 || c === 44 || c === 39 || c === 73 || c === 124) w += 0.3
    else w += 0.55
  }
  return w
}

/**
 * Font size (px) for a line that should fit `lines` lines of `room` px: the largest size up to `max` that fits, never under `min`
 * (at `min` the line is cut with an ellipsis as before). Two lines lose some room to word wrapping, so they count as 1.85 lines.
 * room <= 0 (not measured yet): `max`. Rounded down to half pixels so it does not jitter.
 */
export function fitTextSize(text: string, room: number, lines: number, max: number, min: number): number {
  if (!(room > 0) || !text) return max
  const em = textEm(text)
  if (em <= 0) return max
  const usable = room * (lines > 1 ? lines - 0.15 : 1)
  const s = Math.min(max, usable / em)
  return Math.max(min, Math.floor(s * 2) / 2)
}

/* ── Volume steps ── */

/** One press of volume down / up moves this many points. */
export const VOL_STEP = 5
/** Press and hold: the first repeat after this many ms, then one every VOL_REPEAT ms until release. */
export const VOL_HOLD = 400
export const VOL_REPEAT = 120
/** The level after one step down (-1) or up (+1), clamped to 0..100. */
export const stepVolume = (level: number, dir: 1 | -1): number => clampVolume(level + dir * VOL_STEP)
/** How many steps a press held for `ms` has made: one at once, then a repeat at VOL_HOLD and every VOL_REPEAT after it. */
export function holdSteps(ms: number): number {
  return 1 + (ms >= VOL_HOLD ? 1 + Math.floor((ms - VOL_HOLD) / VOL_REPEAT) : 0)
}
/** Width (px) a volume row needs to show [-] and [+] beside the slider: mute 44, two steps 88, the slider 80 at least, the percent 38, margins 8. */
export const NP_VOL_STEPS_W = 44 + 88 + 80 + 38 + 8
/** Width a transport row needs to carry volume down and up (44 each) after previous, play and next: 44 + 52 + 44 + 12 margins + 88 + 8. */
export const NP_TR_STEPS_W = 44 + 52 + 44 + 12 + 88 + 8

/** The play badge of the 1x1 capsule: about 38% of the tile's short side, 20 to 40 px. The tap target is the whole tile. */
export const npCapsuleBadge = (tw: number, th: number): number => Math.max(20, Math.min(40, Math.round(Math.min(tw, th) * 0.38)))

/**
 * The 2x1 face (`mini`, under 280 px wide and short). Idea: see what is playing and pause or resume it without leaving the page.
 * Always the title and a 44 px play button; the artist as a second line from 72 px high (else the title may take two lines);
 * the cover only while the title keeps 96 px beside it; a 2 px progress line on the bottom edge from 64 px high.
 * No previous / next and no volume at this size: the title is what makes the tile worth having.
 */
export const NP_MINI_PLAY = 44
export function npMiniParts(tw: number, th: number): { cover: number; titleLines: 1 | 2; artist: boolean; progress: boolean; titleRoom: number } {
  const room = tw - 24 - (NP_MINI_PLAY + 6)
  const coverSize = Math.max(32, Math.min(40, th - 24))
  const withCover = room - (coverSize + 10) >= 96
  const artist = th >= 72
  return { cover: withCover ? coverSize : 0, titleLines: artist ? 1 : 2, artist: artist, progress: th >= 64, titleRoom: withCover ? room - coverSize - 10 : room }
}
