import { useEffect, useRef, useState } from 'preact/hooks'
import { getLang } from './i18n'
import { t } from './i18n'
import { isMac } from './platform'
import { Icon, iconStroke } from './icon'
import { reducedMotion } from './knowns'
import { crossfadeGains, easeOut } from './crossfade'
import { clampPosition, clampVolume, coverFallback, coverGradient, fitLevels, formatTime, projectPosition, reconcilePosition, resolveLabels, spokenPosition, DEFAULT_LABELS, npVariant, npInlineVol, npCoverSize, npTallCover, npTallSnug, npTallXs, npCompactParts, npSquareCover, npSquareArtist, NP_PLAY_ROW, NP_TR_STEPS_W, NP_VOL_STEPS_W, VOL_HOLD, VOL_REPEAT, stepVolume, npCapsuleBadge, npMiniParts, NP_MINI_PLAY, progressOf, fitTextSize, type NowPlayingLabels } from './now-playing-utils'
import type { Media, MediaCommand, Stats } from './types'

/**
 * Level bars: while playing they move with a decorative CSS equalizer (5 bars, own periods and negative delays, 25%-100% scaleY). The motion is NOT
 * audio-driven (Nookdeck is a remote and has no audio signal); real `levels`, if ever passed, replace it. Paused or reduced motion: calm static bars.
 *
 * Now Playing tile: a Preact + Safari 12 port of Knowns UI registry/knowns/ui/knowns/now-playing/now-playing.tsx (commit cff14e21):
 * NowPlayingCover, NowPlayingLevels, useShownPosition (time keeps running between pushes and never jumps back), Scrub (read-only
 * progress bar, no onSeek), Times, Transport, VolumeRow, TrackText and the compact / medium / large Tile layouts, Vietnamese labels
 * from src/docs/now-playing-page.tsx (VI). Commit cff14e21 (compact pill keeps one 280px width and 20px corner when opened) only touches the Live Activity capsule, which is not ported, so no code change was needed. Not ported: the Live Activity capsule that opens into a card (a plain capsule is used for tiny
 * tiles), Button and Slider components (small styled buttons and a custom slider with a plain rgba track instead of color-mix),
 * the audio hook, markFrom and the children rows. Sizes come from the tile pixels (no container queries).
 */

const VI: Partial<NowPlayingLabels> = {
  nowPlaying: 'Đang phát',
  nothingPlaying: 'Không có nhạc đang phát',
  play: 'Phát',
  pause: 'Tạm dừng',
  previous: 'Bài trước',
  next: 'Bài tiếp',
  mute: 'Tắt tiếng',
  unmute: 'Bật tiếng',
  position: 'Vị trí',
  volume: 'Âm lượng',
  positionText: (p, d) => p + ' / ' + d,
  volumeText: (v) => v + '%',
}

/** Strings new to this tile; kept here so i18n-vi.ts (owned elsewhere) is untouched. */
const NPVI: { [en: string]: string } = {
  'Last played': 'Phát gần nhất',
  'Spotify · Music': 'Spotify · Music',
  'Spotify · Media player': 'Spotify · Trình phát',
  now: 'vừa xong',
  '{0} min': '{0} phút',
  '{0} h': '{0} giờ',
  '{0} d': '{0} ngày',
  Play: 'Phát',
}
const NPFR: { [en: string]: string } = {
  'Last played': 'Dernière écoute',
  'Spotify · Music': 'Spotify · Music',
  'Spotify · Media player': 'Spotify · Lecteur',
  now: "à l'instant",
  '{0} min': '{0} min',
  '{0} h': '{0} h',
  '{0} d': '{0} j',
  Play: 'Lire',
}
const NPPT: { [en: string]: string } = {
  'Last played': 'Tocada por último',
  'Spotify · Music': 'Spotify · Music',
  'Spotify · Media player': 'Spotify · Player',
  now: 'agora',
  '{0} min': '{0} min',
  '{0} h': '{0} h',
  '{0} d': '{0} d',
  Play: 'Tocar',
}
const NP_EXTRA: { [lang: string]: { [en: string]: string } } = { vi: NPVI, fr: NPFR, pt: NPPT }
const tn = (en: string, a?: string | number): string => {
  const d = NP_EXTRA[getLang()]
  return d && d[en] ? d[en].split('{0}').join(String(a)) : t(en, a)
}

/** Labels of the player in Simplified Chinese (resolveLabels matches by field name, not by English text). */
const ZH_LABELS: Partial<NowPlayingLabels> = {
  nowPlaying: '正在播放',
  nothingPlaying: '没有正在播放的内容',
  play: '播放',
  pause: '暂停',
  previous: '上一首',
  next: '下一首',
  mute: '静音',
  unmute: '取消静音',
  position: '进度',
  volume: '音量',
}
const FR_LABELS: Partial<NowPlayingLabels> = {
  nowPlaying: 'En cours de lecture',
  nothingPlaying: 'Aucune lecture en cours',
  play: 'Lire',
  pause: 'Pause',
  previous: 'Précédent',
  next: 'Suivant',
  mute: 'Couper le son',
  unmute: 'Rétablir le son',
  position: 'Position',
  volume: 'Volume',
  positionText: (p, d) => p + ' sur ' + d,
}
const PT_LABELS: Partial<NowPlayingLabels> = {
  nowPlaying: 'Tocando agora',
  nothingPlaying: 'Nada tocando',
  play: 'Tocar',
  pause: 'Pausar',
  previous: 'Anterior',
  next: 'Próxima',
  mute: 'Silenciar',
  unmute: 'Ativar som',
  position: 'Posição',
  volume: 'Volume',
  positionText: (p, d) => p + ' de ' + d,
}
const LABELS: { [lang: string]: Partial<NowPlayingLabels> } = { vi: VI, zh: ZH_LABELS, fr: FR_LABELS, pt: PT_LABELS }
/** Short age for the "Last played" chip: "11 min", "3 h", "2 d". */
export function agoShort(at: number, now: number): string {
  const min = Math.max(0, Math.floor((now - at) / 60000))
  if (min < 1) return tn('now')
  if (min < 60) return tn('{0} min', min)
  const h = Math.floor(min / 60)
  return h < 24 ? tn('{0} h', h) : tn('{0} d', Math.floor(h / 24))
}

/** "just now", "12 min ago", "3h ago", "2d ago" */
export function agoText(at: number, now: number): string {
  const min = Math.max(0, Math.floor((now - at) / 60000))
  if (min < 1) return t('just now')
  if (min < 60) return t('{0} min ago', min)
  const h = Math.floor(min / 60)
  if (h < 24) return t('{0}h ago', h)
  return t('{0}d ago', Math.floor(h / 24))
}

interface Track {
  title: string
  artist: string
  album?: string
  cover?: string
}

/**
 * The cover: an image, or a gradient made from the words. With no track a calm placeholder: a brand-tinted record (CSS rings on a soft
 * gradient) with a music note; `bare` leaves the note out when a play button sits on top. (now-playing.tsx: NowPlayingCover)
 */
function Cover(props: { track: Track | null; size: number; round: number; bare?: boolean; playing?: boolean }) {
  const st = { width: props.size + 'px', height: props.size + 'px', borderRadius: props.round + 'px' }
  const disc = !!(props.track && props.track.cover)
  const cls = 'pd-npc' + (disc ? ' pd-npc--disc' : '') + (disc && props.playing && !reducedMotion() ? ' pd-npc--spin' : '')
  if (!props.track) {
    return (
      <span class="pd-npc pd-npc--ph" style={st} aria-hidden="true">
        {props.bare ? null : <Icon name="music" size={Math.round(props.size * 0.42)} />}
      </span>
    )
  }
  if (props.track.cover) return <span class={cls} style={Object.assign({ backgroundImage: 'url("' + props.track.cover.replace(/"/g, '%22') + '")' }, st)} aria-hidden="true" />
  const seed = props.track.title + props.track.artist
  return <span class="pd-npc" style={Object.assign({ backgroundColor: coverFallback(seed), backgroundImage: coverGradient(seed) }, st)} aria-hidden="true" />
}

/** Bars beside the title: static calm skyline, lit while playing. (now-playing.tsx: NowPlayingLevels) */
function Levels(props: { playing: boolean; levels?: readonly number[] }) {
  const bars = fitLevels(props.levels, 5)
  const real = !!props.levels && props.levels.length > 0
  const anim = props.playing && !real && !reducedMotion()
  return (
    <span class="pd-npl__lv" aria-hidden="true">
      {bars.map((v, i) =>
        real ? (
          // real levels (when a host passes them): plain scaleY, no keyframes
          <i key={i} style={{ transform: 'scaleY(' + (props.playing ? v : Math.min(v, 0.5)) + ')', WebkitTransform: 'scaleY(' + (props.playing ? v : Math.min(v, 0.5)) + ')', opacity: props.playing ? 1 : 0.35 }} />
        ) : anim ? (
          // decorative equalizer: the bar is v tall and breathes between 25% and 100% of that, each on its own period and phase
          <i key={i} class="pd-npl__lvb" style={{ height: Math.round(v * 100) + '%', animationDuration: EQ_DUR[i] + 's', WebkitAnimationDuration: EQ_DUR[i] + 's', animationDelay: EQ_DELAY[i] + 's', WebkitAnimationDelay: EQ_DELAY[i] + 's' }} />
        ) : (
          <i key={i} style={{ height: '100%', transform: 'scaleY(' + (props.playing ? v : Math.min(v, 0.5)) + ')', WebkitTransform: 'scaleY(' + (props.playing ? v : Math.min(v, 0.5)) + ')', opacity: props.playing ? 1 : 0.35 }} />
        )
      )}
    </span>
  )
}
const EQ_DUR = [0.9, 1.15, 0.75, 1.3, 1.0]
const EQ_DELAY = [-0.3, -0.8, -0.1, -0.55, -0.95]

/** The time on screen. (now-playing.tsx: useShownPosition) */
function useShownPosition(position: number, updatedAt: number | undefined, playing: boolean, duration: number, trackKey: string): number {
  const remote = updatedAt !== undefined
  const at = (now: number) => projectPosition({ position, updatedAt, playing, now, duration })
  const [shown, setShown] = useState(() => at(Date.now()))
  const last = useRef({ key: trackKey, shown: shown, tick: Date.now() })
  useEffect(() => {
    if (!remote) return
    const now = Date.now()
    const pushed = at(now)
    const fresh = last.current.key !== trackKey
    const next = fresh ? pushed : reconcilePosition({ shown: last.current.shown, pushed, playing })
    last.current = { key: trackKey, shown: next, tick: now }
    setShown(next)
  }, [position, updatedAt, playing, trackKey, remote])
  useEffect(() => {
    if (!remote || !playing) return
    const id = window.setInterval(() => {
      const now = Date.now()
      const next = clampPosition(last.current.shown + (now - last.current.tick) / 1000, duration)
      last.current = { key: last.current.key, shown: next, tick: now }
      setShown(next)
    }, 250)
    return () => clearInterval(id)
  }, [remote, playing, duration])
  return remote ? clampPosition(shown, duration) : clampPosition(position, duration)
}

export interface NowPlayingTileProps {
  media: Media | null
  last: Media | null
  stats: Stats | null
  tw: number
  th: number
  scale: number
  showLabel: boolean
  textColor?: string
  onMedia: (c: MediaCommand, app?: string) => Promise<unknown> | void
  onVolume: (v: { level: number } | { muted: boolean }) => Promise<unknown> | void
}

type Variant = 'capsule' | 'mini' | 'compact' | 'square' | 'medium' | 'mid' | 'large' | 'tall'

/** Touch target sizes (px): every control is at least 44, play/pause is the largest. */
/** track change length, ms: kn-motion travel (the cover and the text cross their place), = --pd-dur-travel in deck.css */
const TR_MS = 420
const layer = (opacity: number, x: number, scale?: number) => {
  const tf = 'translateX(' + x.toFixed(1) + 'px)' + (scale !== undefined ? ' scale(' + scale.toFixed(3) + ')' : '')
  return { opacity: opacity, transform: tf, WebkitTransform: tf }
}

/**
 * A title or artist line that shrinks its font to fit its width (PhoneBox #643), down to `min`; at `min` it is still cut with an ellipsis.
 * Measures its own box (ResizeObserver, else window resize: Safari 12 has no ResizeObserver).
 */
function FitLine(props: { text: string; cls: string; max: number; min: number; lines: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const nw = el.clientWidth
      setW((o) => (Math.abs(o - nw) > 1 ? nw : o))
    }
    read()
    const RO = (window as any).ResizeObserver
    const ro = RO ? new RO(read) : null
    if (ro) ro.observe(el)
    else window.addEventListener('resize', read)
    return () => {
      if (ro) ro.disconnect()
      else window.removeEventListener('resize', read)
    }
  }, [])
  const size = fitTextSize(props.text, w, props.lines, props.max, props.min)
  return (
    <span ref={ref} class={props.cls} style={{ fontSize: size + 'px' }} title={size <= props.min ? props.text : undefined}>
      {props.text}
    </span>
  )
}

export const NP_HIT = { ghost: 44, play: 52, playRow: 48, slider: 44, thumb: 22 }

export function NowPlayingTile(props: NowPlayingTileProps) {
  const L = LABELS[getLang()] ? resolveLabels(DEFAULT_LABELS, LABELS[getLang()]) : DEFAULT_LABELS
  const m = props.media
  const track: Track | null = m && (m.title || m.artist) ? { title: m.title || '-', artist: m.artist || '', album: m.album, cover: m.artwork } : null
  const total = Math.max(0, (m && m.duration) || 0)
  const playing = !!track && !!(m && m.playing)
  const at = useShownPosition((m && m.position) || 0, m ? m.at : undefined, playing, total, track ? track.title + '\u0000' + track.artist : '')
  const vol = props.stats && props.stats.volume ? props.stats.volume : null

  // ---- track change transition (display only, ~900 ms) ----
  const trackKey = track ? track.title + '\u0000' + track.artist : ''
  const snap = useRef<{ key: string; track: Track | null; app?: string; total: number; at: number }>({ key: trackKey, track: track, app: m ? m.app : undefined, total: total, at: at })
  const [tr, setTr] = useState<{ from: Track; fromApp?: string; start: number; label: string } | null>(null)
  const [trP, setTrP] = useState(0)
  if (snap.current.key === trackKey) {
    snap.current.at = at
    snap.current.total = total
    snap.current.track = track
    snap.current.app = m ? m.app : undefined
  }
  useEffect(() => {
    const prev = snap.current
    if (prev.key !== trackKey) {
      if (prev.key && trackKey && prev.track && !reducedMotion()) {
        const remaining = prev.total - prev.at
        const newPos = (m && m.position) || 0
        const mix = prev.total > 0 && remaining > 3 && newPos > 2
        setTrP(0)
        setTr({ from: prev.track, fromApp: prev.app, start: Date.now(), label: (mix ? t('Mixed into ') : t('Switching to ')) + (track ? track.title : '') })
      }
      snap.current = { key: trackKey, track: track, app: m ? m.app : undefined, total: total, at: at }
    }
  }, [trackKey])
  useEffect(() => {
    if (!tr) return
    let raf = 0
    const step = () => {
      const p = (Date.now() - tr.start) / TR_MS
      if (p >= 1) {
        setTr(null)
        return
      }
      setTrP(p)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [tr ? tr.start : 0])

  // pending: from sending a command until its result (or 3 s)
  const [pending, setPending] = useState(false)
  const [pop, setPop] = useState(false)
  const pendTimer = useRef(0)
  const run = (p: Promise<unknown> | void) => {
    setPending(true)
    clearTimeout(pendTimer.current)
    const end = () => {
      clearTimeout(pendTimer.current)
      setPending(false)
    }
    pendTimer.current = window.setTimeout(end, 3000)
    if (p && typeof (p as Promise<unknown>).then === 'function') (p as Promise<unknown>).then(end, end)
  }
  useEffect(() => () => clearTimeout(pendTimer.current), [])
  const onPlay = () => run(props.onMedia('playpause'))
  const onNext = () => run(props.onMedia('next'))
  const onPrev = () => run(props.onMedia('previous'))

  // ---- what the tile shows: the playing track, the last played one (resume), or a calm placeholder
  const lastTrack: Track | null = props.last && (props.last.title || props.last.artist) ? { title: props.last.title || '-', artist: props.last.artist || '', album: props.last.album, cover: props.last.artwork } : null
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (track || !lastTrack) return
    setNowTick(Date.now())
    const id = window.setInterval(() => setNowTick(Date.now()), 30000)
    return () => clearInterval(id)
  }, [!!track, !!lastTrack])
  const state: 'playing' | 'last' | 'empty' = track ? 'playing' : lastTrack ? 'last' : 'empty'
  const vt: Track | null = track || lastTrack
  const lastTotal = Math.max(0, (props.last && props.last.duration) || 0)
  const shownAt = state === 'playing' ? at : state === 'last' ? clampPosition((props.last && props.last.position) || 0, lastTotal) : 0
  const shownTotal = state === 'playing' ? total : state === 'last' ? lastTotal : 0
  const onResume = () => run(props.onMedia('resume'))
  const onOpen = () => run(props.onMedia('open', 'Music'))

  const tw = props.tw
  const th = props.th
  const variant: Variant = npVariant(tw, th)
  const tc = props.textColor || undefined
  const disabled = pending || state !== 'playing' // transport needs a live session
  const idle = state === 'playing' ? '' : ' pd-npl--idle pd-npl--' + state
  const tall = variant === 'tall'
  const xs = tall && npTallXs(tw)
  const snug = tall && (xs || npTallSnug(th))
  // narrow row: the title may use two lines instead of truncating to 5 letters; the tall layout has room for two (one when snug)
  const mini = variant === 'mini' ? npMiniParts(tw, th) : null
  const two = (variant === 'compact' && tw < 260) || (tall && !snug) || (!!mini && mini.titleLines === 2)
  const inlineVol = npInlineVol(variant, tw, th) && !!vol
  // kn-motion 1.3: one looping "playing" signal, never two. The artwork disc spins while playing; the level bars only stand in when
  // there is no artwork to spin (a generated cover), or when motion is reduced (then they are static bars, the pause icon says the rest)
  const levelsOn = state === 'playing' && (!(track && track.cover) || reducedMotion())

  const PlayBtn = (size: number) => (
    <button type="button" class="pd-npl__play" style={{ width: size + 'px', height: size + 'px' }} aria-label={state === 'playing' ? (playing ? L.pause : L.play) : state === 'last' ? t('Resume') : tn('Play')} aria-pressed={state === 'playing' ? playing : undefined} disabled={pending} onClick={state === 'playing' ? onPlay : state === 'last' ? onResume : onOpen}>
      <Icon name={playing ? 'player-pause' : 'player-play'} size={Math.round(size * 0.44)} weight="Filled" />
    </button>
  )
  const Ghost = (name: string, label: string, fn: () => void, pressed?: boolean) => (
    <button type="button" class="pd-npl__ghost" style={{ width: NP_HIT.ghost + 'px', height: NP_HIT.ghost + 'px' }} aria-label={label} aria-pressed={pressed} disabled={name === 'volume' || name === 'volume-3' ? pending : disabled} onClick={fn}>
      <Icon name={name} size={22} />
    </button>
  )
  const VolBtn = () => (vol ? Ghost(vol.muted ? 'volume-3' : 'volume', L.volume, () => setPop(!pop), pop) : <span class="pd-npl__sp" />)

  // ---- volume steps: optimistic. A press shows the new level at once and sends it on the slider's path (onVolume({ level }));
  // presses in a row build on the shown level, and 1.5 s after the last one the tile follows the agent's value again.
  const [optVol, setOptVol] = useState<number | null>(null)
  const optRef = useRef<number | null>(null)
  const optTimer = useRef(0)
  useEffect(() => () => clearTimeout(optTimer.current), [])
  const shownLevel = vol ? (optVol !== null ? optVol : vol.level) : 0
  const onStep = (dir: 1 | -1) => {
    if (!vol) return
    const next = stepVolume(optRef.current !== null ? optRef.current : vol.level, dir)
    optRef.current = next
    setOptVol(next)
    props.onVolume({ level: next })
    clearTimeout(optTimer.current)
    optTimer.current = window.setTimeout(() => {
      optRef.current = null
      setOptVol(null)
    }, 1500)
  }
  /** The end of a transport row: volume down and up when the row (rowW px) has room for both at 44 px, else the speaker + popover. */
  const VolEnd = (rowW: number) =>
    vol && rowW >= NP_TR_STEPS_W ? (
      <div class="pd-npl__tr3">
        <StepBtn dir={-1} icon="speaker-minus" label={t('Volume down')} onStep={onStep} />
        <StepBtn dir={1} icon="speaker-plus" label={t('Volume up')} onStep={onStep} />
      </div>
    ) : (
      VolBtn()
    )

  // the title shrinks to fit (one line, or two on a narrow row) down to 72% of its size; the artist line down to 10 px
  const titleMax = (big: boolean) => (tall ? (snug ? 16 : 19) : big ? 16 : two ? 13 : 14) * Math.min(1.15, props.scale)
  const Title = (text: string, big: boolean) => (
    <FitLine text={text} cls={'pd-npl__title' + (two ? ' pd-npl__title--two' : '')} max={titleMax(big)} min={Math.max(10, Math.round(titleMax(big) * 0.72))} lines={two ? 2 : 1} />
  )
  const Artist = (text: string) => (text ? <FitLine text={text} cls="pd-npl__artist" max={tall && !snug ? 13.5 : 12.5} min={10} lines={1} /> : <span class="pd-npl__artist" />)
  const TextInner = (t: Track | null, big: boolean, app?: string, label?: string) => (
    <>
      {big && t && app ? <span class="pd-npl__src">{app}</span> : null}
      {Title(t ? t.title : L.nothingPlaying, big)}
      {label ? <span class="pd-npl__artist pd-npx__label">{label}</span> : t ? Artist([t.artist, big ? t.album : undefined].filter(Boolean).join(' · ')) : null}
    </>
  )
  // track change: the outgoing block fades and slides out while the incoming one comes in (Knowns Pro now-playing transition look)
  const g = tr ? crossfadeGains(easeOut(trP)) : null
  const emptySub = isMac() ? tn('Spotify · Music') : tn('Spotify · Media player')
  const StaticText = (big: boolean) => (
    <span class="pd-npl__txt">
      {state === 'last' && (big || !two) ? <span class="pd-npl__chip">{variant === 'compact' || variant === 'medium' ? agoText((props.last && props.last.at) || nowTick, nowTick) : tn('Last played') + ' · ' + agoShort((props.last && props.last.at) || nowTick, nowTick)}</span> : null}
      {Title(vt ? vt.title : t('Nothing playing'), big)}
      {vt || !two ? Artist(vt ? [vt.artist, big ? vt.album : undefined].filter(Boolean).join(' · ') : emptySub) : null}
    </span>
  )
  const Text = (big: boolean) =>
    state !== 'playing' ? StaticText(big) : tr && g ? (
      <span class="pd-npl__txt pd-npx__t">
        <span class="pd-npx__out" style={layer(g.out, -8 * easeOut(trP))}>
          {TextInner(tr.from, big, tr.fromApp)}
        </span>
        <span style={layer(g.in, 8 * (1 - easeOut(trP)))} class="pd-npx__in">
          {TextInner(track, big, m ? m.app : undefined, trP < 0.85 ? tr.label : undefined)}
        </span>
      </span>
    ) : (
      <span class="pd-npl__txt">{TextInner(track, big, m ? m.app : undefined)}</span>
    )
  const CoverX = (size: number, round: number) =>
    state !== 'playing' ? (
      <Cover track={vt} size={size} round={round} playing={false} />
    ) : tr && g ? (
      <span class="pd-npx__cv" style={{ width: size + 'px', height: size + 'px' }}>
        <span class="pd-npx__lay" style={layer(0.35 + 0.65 * g.out, -8 * easeOut(trP), 0.92 + 0.08 * g.out)}>
          <Cover track={tr.from} size={size} round={round} playing={playing} />
        </span>
        <span class="pd-npx__lay" style={layer(0.2 + 0.8 * g.in, 8 * (1 - easeOut(trP)), 0.92 + 0.08 * g.in)}>
          <Cover track={track} size={size} round={round} playing={playing} />
        </span>
      </span>
    ) : (
      <Cover track={track} size={size} round={round} playing={playing} />
    )

  const Scrub = () => {
    const pct = shownTotal > 0 ? Math.min(100, (shownAt / shownTotal) * 100) : 0
    return (
      <div role="progressbar" aria-label={L.position} aria-valuemin={0} aria-valuemax={Math.round(shownTotal)} aria-valuenow={Math.round(shownAt)} aria-valuetext={spokenPosition(shownAt, shownTotal, L.positionText)} class="pd-npl__scrub">
        <div class="pd-npl__track">
          <div class="pd-npl__fill pd-npl__fill--prog" style={{ transform: 'scaleX(' + (pct / 100).toFixed(4) + ')', WebkitTransform: 'scaleX(' + (pct / 100).toFixed(4) + ')' }} />
        </div>
      </div>
    )
  }
  const Times = () => (
    <div class="pd-npl__times" aria-hidden="true">
      <span data-part="num">{formatTime(shownAt)}</span>
      <span data-part="num">{shownTotal > 0 ? '-' + formatTime(shownTotal - shownAt) : '-:--'}</span>
    </div>
  )
  const volChange = (v: number) => run(props.onVolume({ level: v }))
  const volMute = () => run(props.onVolume({ muted: !(vol && vol.muted) }))
  const Popover = () =>
    pop && vol ? (
      <>
        <div class="pd-npl__bd" onClick={(e) => { e.stopPropagation(); setPop(false) }} />
        <div class="pd-npl__pop" role="group" aria-label={L.volume}>
          <VolumeRow L={L} level={shownLevel} muted={vol.muted} disabled={pending} onVolume={volChange} onMute={volMute} onTouched={() => undefined} idleClose={() => setPop(false)} />
        </div>
      </>
    ) : null

  if (variant === 'capsule') {
    const s = Math.min(tw, th) - 12
    return (
      <div class={'pd-npl pd-npl--capsule' + idle} style={{ color: tc }} aria-busy={pending || undefined}>
        {state === 'empty' ? <Cover track={null} size={s} round={10} bare /> : CoverX(s, 10)}
        {/* the whole 1x1 tile is the play / pause target (>= 44 px); what shows is a small translucent badge, about 38% of the tile,
            hidden while playing (it shows while pressed) and visible when paused or idle */}
        <button
          type="button"
          class={'pd-npl__over pd-npl__hit' + (playing ? ' pd-npl__hit--quiet' : '')}
          aria-label={state === 'playing' ? (playing ? L.pause : L.play) : state === 'last' ? t('Resume') : tn('Play')}
          aria-pressed={state === 'playing' ? playing : undefined}
          disabled={pending}
          onClick={state === 'playing' ? onPlay : state === 'last' ? onResume : onOpen}
        >
          <span class="pd-npl__badge" style={{ width: npCapsuleBadge(tw, th) + 'px', height: npCapsuleBadge(tw, th) + 'px' }}>
            <Icon name={playing ? 'player-pause' : 'player-play'} size={Math.round(npCapsuleBadge(tw, th) * 0.46)} weight="Filled" />
          </span>
        </button>
      </div>
    )
  }

  if (variant === 'mini' && mini) {
    // 2x1: the title (and artist) beside a quiet play button; the cover only when the title keeps its room; progress on the bottom edge
    const pct = progressOf(shownAt, shownTotal)
    return (
      <div class={'pd-npl pd-npl--mini' + (mini.artist ? '' : ' pd-npl--mini2') + idle} style={{ color: tc }} aria-busy={pending || undefined}>
        {mini.cover ? (state === 'empty' ? <Cover track={null} size={mini.cover} round={8} /> : CoverX(mini.cover, 8)) : null}
        {Text(false)}
        <button type="button" class="pd-npl__ghost pd-npl__ghost--play" style={{ width: NP_MINI_PLAY + 'px', height: NP_MINI_PLAY + 'px' }} aria-label={state === 'playing' ? (playing ? L.pause : L.play) : state === 'last' ? t('Resume') : tn('Play')} aria-pressed={state === 'playing' ? playing : undefined} disabled={pending} onClick={state === 'playing' ? onPlay : state === 'last' ? onResume : onOpen}>
          <Icon name={playing ? 'player-pause' : 'player-play'} size={24} weight="Filled" />
        </button>
        {mini.progress && shownTotal > 0 ? (
          <span class="pd-npl__edge" aria-hidden="true">
            <span class="pd-npl__fill pd-npl__fill--prog" style={{ transform: 'scaleX(' + pct.toFixed(4) + ')', WebkitTransform: 'scaleX(' + pct.toFixed(4) + ')' }} />
          </span>
        ) : null}
      </div>
    )
  }

  if (variant === 'compact') {
    // what fits (npCompactParts): the volume button goes first, then the text; the cover and play always stay
    const cp = npCompactParts(tw, th, !!vol)
    return (
      <div class={'pd-npl pd-npl--compact' + (cp.text ? '' : ' pd-npl--notext') + idle} style={{ color: tc }} aria-busy={pending || undefined}>
        {state === 'empty' && !cp.text ? <Cover track={null} size={cp.cover} round={8} /> : CoverX(cp.cover, 8)}
        {cp.text ? Text(false) : null}
        {cp.levels && levelsOn ? <Levels playing={playing} /> : null}
        {cp.vol ? VolBtn() : null}
        {PlayBtn(NP_PLAY_ROW)}
        {cp.vol ? Popover() : null}
      </div>
    )
  }

  if (variant === 'square') {
    // a square tile (2x2): the cover on top with play on its corner, the title (and the artist when it fits) centred under it
    const chip = state === 'last'
    const artist = npSquareArtist(tw, th, chip)
    const cs = npSquareCover(tw, th, artist, chip)
    return (
      <div class={'pd-npl pd-npl--square' + idle} style={{ color: tc }} aria-busy={pending || undefined}>
        <div class="pd-npl__sq" style={{ width: cs + 'px', height: cs + 'px' }}>
          {CoverX(cs, 14)}
          <div class="pd-npl__sqp">{PlayBtn(NP_HIT.playRow)}</div>
        </div>
        <span class={'pd-npl__txt' + (artist ? '' : ' pd-npl__txt--solo')}>
          {chip ? <span class="pd-npl__chip">{agoText((props.last && props.last.at) || nowTick, nowTick)}</span> : null}
          {Title(vt ? vt.title : L.nothingPlaying, false)}
          {artist ? Artist(vt ? vt.artist : emptySub) : null}
        </span>
      </div>
    )
  }

  if (variant === 'medium') {
    return (
      <div class={'pd-npl pd-npl--medium' + (tw < 230 ? ' pd-npl--tight' : '') + idle} style={{ color: tc }} aria-busy={pending || undefined}>
        <div class="pd-npl__top pd-npl__top--row">
          {CoverX(44, 8)}
          {Text(false)}
        </div>
        <div class="pd-npl__prog">
          {Scrub()}
          {Times()}
        </div>
        <div class="pd-npl__tr pd-npl__tr--sb">
          {Ghost('player-skip-back', L.previous, onPrev)}
          {PlayBtn(NP_HIT.play)}
          {Ghost('player-skip-forward', L.next, onNext)}
          {VolBtn()}
        </div>
        {Popover()}
      </div>
    )
  }

  if (variant === 'mid') {
    const VOLW = tw - 24
    return (
      <div class={'pd-npl pd-npl--medium pd-npl--mid' + idle} style={{ color: tc }} aria-busy={pending || undefined}>
        <div class="pd-npl__top pd-npl__top--row">
          {CoverX(Math.min(60, Math.max(44, th - 150)), 10)}
          {Text(false)}
          {levelsOn ? <Levels playing={playing} /> : null}
        </div>
        <div class="pd-npl__prog">
          {Scrub()}
          {Times()}
        </div>
        {inlineVol && vol ? (
          <div class="pd-npl__tr">
            {Ghost('player-skip-back', L.previous, onPrev)}
            {PlayBtn(NP_HIT.play)}
            {Ghost('player-skip-forward', L.next, onNext)}
          </div>
        ) : (
          <div class="pd-npl__tr pd-npl__tr--sb">
            {vol && VOLW >= NP_TR_STEPS_W ? null : <span class="pd-npl__sp" />}
            <div class="pd-npl__tr3">
              {Ghost('player-skip-back', L.previous, onPrev)}
              {PlayBtn(NP_HIT.play)}
              {Ghost('player-skip-forward', L.next, onNext)}
            </div>
            {VolEnd(VOLW)}
          </div>
        )}
        {inlineVol && vol ? <VolumeRow L={L} level={shownLevel} muted={vol.muted} disabled={pending} onVolume={volChange} onMute={volMute} onStep={onStep} steps={VOLW >= NP_VOL_STEPS_W} /> : null}
        {Popover()}
      </div>
    )
  }

  if (tall) {
    // square or upright tile, centred: the disc with its artwork glowing behind it, the title and artist, the time on both sides of the bar, then the transport
    const cs = npTallCover(tw, th)
    const VOLW = tw - (snug ? 24 : 32)
    return (
      <div class={'pd-npl pd-npl--tall' + (snug ? ' pd-npl--snug' : '') + (xs ? ' pd-npl--xs' : '') + idle} style={{ color: tc }} aria-busy={pending || undefined}>
        {levelsOn ? <span class="pd-npl__lvc"><Levels playing={playing} /></span> : null}
        {/* xs (3x3): no room for a fourth button in the transport row, so the speaker sits in the free top corner beside the disc */}
        {xs && vol ? <span class="pd-npl__xsv">{VolBtn()}</span> : null}
        {/* kn-visual 4 / kn-taste: no coloured glow or halo behind the disc; the disc stands on a hairline ring */}
        <div class="pd-npl__art">{CoverX(cs, 16)}</div>
        {Text(true)}
        <div class="pd-npl__prog pd-npl__prog--row" aria-hidden="false">
          <span class="pd-npl__t" data-part="num" aria-hidden="true">{formatTime(shownAt)}</span>
          {Scrub()}
          <span class="pd-npl__t" data-part="num" aria-hidden="true">{shownTotal > 0 ? '-' + formatTime(shownTotal - shownAt) : '-:--'}</span>
        </div>
        {xs ? (
          <div class="pd-npl__tr">
            <div class="pd-npl__tr3">
              {Ghost('player-skip-back', L.previous, onPrev)}
              {PlayBtn(NP_HIT.playRow)}
              {Ghost('player-skip-forward', L.next, onNext)}
            </div>
          </div>
        ) : (
          <div class="pd-npl__tr pd-npl__tr--sb">
            <span class="pd-npl__sp" />
            <div class="pd-npl__tr3">
              {Ghost('player-skip-back', L.previous, onPrev)}
              {PlayBtn(snug ? NP_HIT.play : 60)}
              {Ghost('player-skip-forward', L.next, onNext)}
            </div>
            {inlineVol ? <span class="pd-npl__sp" /> : VolEnd(VOLW)}
          </div>
        )}
        {inlineVol && vol ? <VolumeRow L={L} level={shownLevel} muted={vol.muted} disabled={pending} onVolume={volChange} onMute={volMute} onStep={onStep} steps={VOLW >= NP_VOL_STEPS_W} /> : null}
        {Popover()}
      </div>
    )
  }

  // large (4x2 and up): cover on the left, controls on the right
  const cs = npCoverSize(tw, th)
  const VOLW = tw - 32 - 14 - cs
  return (
    <div class={'pd-npl pd-npl--large' + idle} style={{ color: tc }} aria-busy={pending || undefined}>
      {CoverX(cs, 12)}
      <div class="pd-npl__col">
        <div class="pd-npl__top">
          {Text(true)}
          {levelsOn ? <Levels playing={playing} /> : null}
        </div>
        <div class="pd-npl__prog">
          {Scrub()}
          {Times()}
        </div>
        <div class="pd-npl__tr pd-npl__tr--sb">
          <div class="pd-npl__tr3">
            {Ghost('player-skip-back', L.previous, onPrev)}
            {PlayBtn(NP_HIT.play)}
            {Ghost('player-skip-forward', L.next, onNext)}
          </div>
          {inlineVol ? VolBtn() : VolEnd(VOLW)}
        </div>
        {inlineVol && vol ? <VolumeRow L={L} level={shownLevel} muted={vol.muted} disabled={pending} onVolume={volChange} onMute={volMute} onStep={onStep} steps={VOLW >= NP_VOL_STEPS_W} /> : null}
      </div>
      {Popover()}
    </div>
  )
}

/**
 * Volume down / up with press and hold: one step at once, the first repeat after VOL_HOLD ms, then one every VOL_REPEAT ms until the
 * finger lifts, leaves or is cancelled. Touch first (Safari 12 has no pointer events), the mouse as the desktop fallback, a click only
 * from the keyboard. Feedback (kn-motion 4): a ghost icon button does not scale; its background shows while held, on the fast token.
 */
/**
 * Volume down / up on the transport row: the speaker of the 4x4 volume row with a "-" or "+" where its waves would be, so the two
 * buttons read as one pair and match the [speaker] [-] slider [+] row. Tabler's speaker body, same stroke as the other icons.
 */
function SpeakerStep(props: { plus: boolean }) {
  const w = iconStroke()
  const body = 'M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5'
  return (
    <span class="pd-svg" style={{ width: '22px', height: '22px' }} aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={w} stroke-linecap="round" stroke-linejoin="round">
        <path d={body} />
        <path d={props.plus ? 'M15 12h6M18 9v6' : 'M15 12h6'} />
      </svg>
    </span>
  )
}

function StepBtn(props: { dir: 1 | -1; icon: string; label: string; onStep: (dir: 1 | -1) => void; size?: number }) {
  const [on, setOn] = useState(false)
  const first = useRef(0)
  const rep = useRef(0)
  const pressed = useRef(false)
  const latest = useRef(props)
  latest.current = props
  const fire = () => latest.current.onStep(latest.current.dir)
  const stop = () => {
    clearTimeout(first.current)
    clearInterval(rep.current)
    setOn(false)
  }
  const start = () => {
    stop()
    pressed.current = true
    setOn(true)
    fire()
    first.current = window.setTimeout(() => {
      fire()
      rep.current = window.setInterval(fire, VOL_REPEAT)
    }, VOL_HOLD)
  }
  useEffect(() => stop, [])
  const n = props.size || NP_HIT.ghost
  return (
    <button
      type="button"
      class={'pd-npl__ghost' + (on ? ' pd-npl__ghost--on' : '')}
      style={{ width: n + 'px', height: n + 'px' }}
      aria-label={props.label}
      onTouchStart={(e) => {
        e.stopPropagation()
        e.preventDefault()
        start()
      }}
      onTouchEnd={(e) => {
        e.stopPropagation()
        e.preventDefault()
        stop()
      }}
      onTouchCancel={stop}
      onMouseDown={(e) => {
        e.stopPropagation()
        start()
      }}
      onMouseUp={stop}
      onMouseLeave={stop}
      onClick={(e) => {
        e.stopPropagation()
        // a touch or mouse press already stepped; a click without one is the keyboard (Enter / Space)
        if (pressed.current) pressed.current = false
        else fire()
      }}
    >
      {props.icon === 'speaker-minus' || props.icon === 'speaker-plus' ? <SpeakerStep plus={props.icon === 'speaker-plus'} /> : <Icon name={props.icon} size={22} />}
    </button>
  )
}

/**
 * Mute button + slider (now-playing.tsx: VolumeRow). The slider is our own: a 44px tall hit box around a thin track, a 22px thumb,
 * touchstart/touchmove (non-passive, preventDefault + stopPropagation so the page strip does not scroll) with mouse as the desktop fallback.
 * Works inside the rotated deck (local axis = screen y when .pd-root--rot).
 */
function VolumeRow(props: { L: NowPlayingLabels; level: number; muted: boolean; disabled: boolean; onVolume: (v: number) => void; onMute: () => void; onTouched?: () => void; idleClose?: () => void; onStep?: (dir: 1 | -1) => void; steps?: boolean }) {
  const [drag, setDrag] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const idle = useRef(0)
  const bump = () => {
    clearTimeout(idle.current)
    if (latest.current.idleClose) idle.current = window.setTimeout(() => latest.current.idleClose && latest.current.idleClose(), 5000)
  }
  useEffect(() => {
    bump()
    return () => clearTimeout(idle.current)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const INSET = NP_HIT.thumb / 2
    let on = false
    let lastSend = 0
    let val = 0
    const rotated = () => !!el.closest('.pd-root--rot')
    const calc = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect()
      const rot = rotated()
      const w = Math.max(1, (rot ? r.height : r.width) - INSET * 2)
      const pos = (rot ? cy - r.top : cx - r.left) - INSET
      return clampVolume((pos / w) * 100)
    }
    const move = (cx: number, cy: number, final: boolean) => {
      val = calc(cx, cy)
      setDrag(val)
      bump()
      const now = Date.now()
      if (final || now - lastSend > 160) {
        lastSend = now
        latest.current.onVolume(val)
      }
    }
    const end = () => {
      if (!on) return
      on = false
      latest.current.onVolume(val)
      window.setTimeout(() => setDrag(null), 700)
    }
    const ts = (e: TouchEvent) => {
      if (latest.current.disabled || !e.touches.length) return
      e.preventDefault()
      e.stopPropagation()
      on = true
      move(e.touches[0].clientX, e.touches[0].clientY, false)
    }
    const tm = (e: TouchEvent) => {
      if (!on || !e.touches.length) return
      e.preventDefault()
      e.stopPropagation()
      move(e.touches[0].clientX, e.touches[0].clientY, false)
    }
    const te = (e: TouchEvent) => {
      e.stopPropagation()
      end()
    }
    const mm = (e: MouseEvent) => on && move(e.clientX, e.clientY, false)
    const mu = () => {
      window.removeEventListener('mousemove', mm)
      window.removeEventListener('mouseup', mu)
      end()
    }
    const md = (e: MouseEvent) => {
      if (latest.current.disabled) return
      e.stopPropagation()
      on = true
      move(e.clientX, e.clientY, false)
      window.addEventListener('mousemove', mm)
      window.addEventListener('mouseup', mu)
    }
    const nopass = { passive: false } as AddEventListenerOptions
    el.addEventListener('touchstart', ts, nopass)
    el.addEventListener('touchmove', tm, nopass)
    el.addEventListener('touchend', te)
    el.addEventListener('touchcancel', te)
    el.addEventListener('mousedown', md)
    return () => {
      el.removeEventListener('touchstart', ts)
      el.removeEventListener('touchmove', tm)
      el.removeEventListener('touchend', te)
      el.removeEventListener('touchcancel', te)
      el.removeEventListener('mousedown', md)
      window.removeEventListener('mousemove', mm)
      window.removeEventListener('mouseup', mu)
    }
  }, [])
  const v = clampVolume(props.muted ? 0 : drag !== null ? drag : props.level)
  const key = (e: KeyboardEvent) => {
    const k = e.key
    if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowUp' && k !== 'ArrowDown') return
    e.preventDefault()
    props.onVolume(clampVolume(v + (k === 'ArrowLeft' || k === 'ArrowDown' ? -5 : 5)))
  }
  return (
    <div class="pd-npl__vol" onClick={(e) => e.stopPropagation()}>
      <button type="button" class="pd-npl__ghost" style={{ width: NP_HIT.ghost + 'px', height: NP_HIT.ghost + 'px' }} aria-label={props.muted ? props.L.unmute : props.L.mute} aria-pressed={props.muted} disabled={props.disabled} onClick={props.onMute}>
        <Icon name={props.muted ? 'volume-3' : 'volume'} size={22} />
      </button>
      {props.steps && props.onStep ? <StepBtn dir={-1} icon="minus" label={t('Volume down')} onStep={props.onStep} /> : null}
      <div class="pd-npl__sl" ref={ref} role="slider" tabIndex={0} aria-label={props.L.volume} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-valuetext={props.L.volumeText(v)} aria-disabled={props.disabled} onKeyDown={key as any}>
        <div class="pd-npl__track pd-npl__track--v">
          <div class="pd-npl__fill pd-npl__fill--acc" style={{ width: v + '%' }} />
        </div>
        <span class="pd-npl__thumb" style={{ left: 'calc(' + NP_HIT.thumb / 2 + 'px + (100% - ' + NP_HIT.thumb + 'px) * ' + v / 100 + ')' }} />
      </div>
      {props.steps && props.onStep ? <StepBtn dir={1} icon="plus" label={t('Volume up')} onStep={props.onStep} /> : null}
      <span class="pd-npl__vt">{props.L.volumeText(v)}</span>
    </div>
  )
}
