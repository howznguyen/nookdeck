/**
 * Pure helpers for the macOS Now Playing stream (ungive/mediaremote-adapter, run as `perl adapter.pl <framework> stream`):
 * line parsing, merging diffs into one state, position math and app names. No process, no OS access: see platform/mac-remote.ts.
 */
import type { RawMedia } from "./media";

/** What the adapter has said about the now playing item so far (the JSON `payload` keys, merged). */
export type NowPlayingState = Record<string, unknown>;

/** MediaRemote command ids the adapter accepts for `send` (include/MediaRemoteAdapter.h). */
export const MR_COMMANDS = { play: 0, pause: 1, playpause: 2, next: 4, previous: 5 } as const;
export type MrCommand = keyof typeof MR_COMMANDS;

/** Names shown on the tile. The bundle id is the app that owns the media session; a browser's media process reports the browser as its parent. */
const APP_NAMES: [RegExp, string][] = [
  [/^com\.spotify\.client$/i, "Spotify"],
  [/^com\.apple\.Music$/i, "Music"],
  [/^com\.apple\.Safari(\.|$)/i, "Safari"],
  [/^com\.google\.Chrome(\.|$)/i, "Chrome"],
  [/^com\.brave\.Browser(\.|$)/i, "Brave"],
  [/^com\.microsoft\.edgemac(\.|$)/i, "Edge"],
  [/^org\.mozilla\.firefox$/i, "Firefox"],
  [/^company\.thebrowser\.Browser$/i, "Arc"],
  [/^com\.apple\.podcasts$/i, "Podcasts"],
  [/^com\.apple\.TV$/i, "TV"],
  [/^org\.videolan\.vlc$/i, "VLC"],
  [/^com\.colliderli\.iina$/i, "IINA"],
  [/^tv\.plex\./i, "Plex"],
];
/** A YouTube Music (or any Chromium) app-mode PWA: the bundle id ends in the extension id. */
const YT_MUSIC_PWA = /cinhimbnkkaeohfgghhklpknlkffjgod|youtube.*music/i;

/** App name from the session's bundle ids; `parent` (the app hosting a web media process) wins over `bundle`. */
export function nowPlayingApp(bundle: unknown, parent?: unknown): string {
  for (const id of [parent, bundle]) {
    if (typeof id !== "string" || !id) continue;
    if (YT_MUSIC_PWA.test(id)) return "YouTube Music";
    const hit = APP_NAMES.find(([re]) => re.test(id));
    if (hit) return hit[1];
  }
  const id = [parent, bundle].find((x): x is string => typeof x === "string" && !!x);
  if (!id) return "Now Playing";
  const last = id.split(".").pop() ?? "";
  return last.replace(/[_-]+/g, " ") || "Now Playing";
}

/** Result of feeding one stdout line to the state. */
export type StreamEvent = { kind: "ignored" } | { kind: "state"; state: NowPlayingState };

/** Applies one JSON line of `stream` output. `diff:false` replaces the state (an empty payload means nothing is playing); `diff:true` merges, and a null value deletes the key. */
export function applyStreamLine(state: NowPlayingState, line: string): StreamEvent {
  const text = line.trim();
  if (!text.startsWith("{")) return { kind: "ignored" };
  let msg: any;
  try { msg = JSON.parse(text); } catch { return { kind: "ignored" }; }
  if (msg?.type !== "data" || typeof msg.payload !== "object" || msg.payload === null || Array.isArray(msg.payload)) return { kind: "ignored" };
  if (!msg.diff) return { kind: "state", state: { ...msg.payload } };
  const next = { ...state };
  for (const [k, v] of Object.entries(msg.payload)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return { kind: "state", state: next };
}

/**
 * A diff that moves the clock of another item while keeping this item's title: a browser with media in two tabs (seen with a
 * Chromium browser) sends the other tab's duration and position without its title, so merging would pair one tab's title with the
 * other's time. True when the diff changes the duration and carries no title or artist: read the whole state again instead.
 */
export function mixedDiff(state: NowPlayingState, line: string): boolean {
  let msg: any;
  try { msg = JSON.parse(line.trim()); } catch { return false; }
  if (msg?.type !== "data" || !msg.diff || typeof msg.payload !== "object" || msg.payload === null) return false;
  const p = msg.payload as Record<string, unknown>;
  if ("title" in p || "artist" in p) return false;
  if (typeof p.duration !== "number" || typeof state.duration !== "number") return false;
  return Math.abs(p.duration - state.duration) > 1;
}

/** The output of the adapter's `get`: the whole now playing state as one JSON object, or null when it is not that. */
export function parseGet(text: string): NowPlayingState | null {
  try {
    const j = JSON.parse(text.trim());
    return j && typeof j === "object" && !Array.isArray(j) ? (j as NowPlayingState) : null;
  } catch { return null; }
}

/** Splits a byte stream into lines (a chunk may end mid-line). */
export class LineSplitter {
  private rest = "";
  push(chunk: string): string[] {
    const parts = (this.rest + chunk).split("\n");
    this.rest = parts.pop() ?? "";
    return parts;
  }
}

const nonNeg = (x: unknown): number => {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** Seconds into the item at `nowMs`: elapsedTime was true at `timestamp`; while playing the clock keeps running at playbackRate. */
export function positionAt(state: NowPlayingState, nowMs: number): number {
  const elapsed = nonNeg(state.elapsedTime);
  const duration = nonNeg(state.duration);
  const playing = isPlaying(state);
  let pos = elapsed;
  if (playing) {
    const at = typeof state.timestamp === "string" ? Date.parse(state.timestamp) : NaN;
    const rate = typeof state.playbackRate === "number" && state.playbackRate > 0 ? state.playbackRate : 1;
    if (Number.isFinite(at)) pos = elapsed + Math.max(0, (nowMs - at) / 1000) * rate;
  }
  return Math.round((duration > 0 ? Math.min(pos, duration) : pos) * 1000) / 1000;
}

export function isPlaying(state: NowPlayingState): boolean {
  if (typeof state.playing === "boolean") return state.playing;
  return nonNeg(state.playbackRate) > 0;
}

/** The tile's media from the merged state, or null when nothing (with a title or artist) is there. */
export function stateToMedia(state: NowPlayingState, nowMs: number): RawMedia | null {
  const title = typeof state.title === "string" ? state.title : "";
  const artist = typeof state.artist === "string" ? state.artist : "";
  if (!title && !artist) return null;
  return {
    app: nowPlayingApp(state.bundleIdentifier, state.parentApplicationBundleIdentifier),
    title,
    artist,
    album: typeof state.album === "string" ? state.album : "",
    playing: isPlaying(state),
    position: positionAt(state, nowMs),
    duration: nonNeg(state.duration),
  };
}

/** Base64 cover from the state (the adapter sends it as artworkData, often TIFF), or undefined. */
export function stateArtwork(state: NowPlayingState): { b64: string; mime: string } | undefined {
  const b64 = typeof state.artworkData === "string" ? state.artworkData.replace(/\s/g, "") : "";
  if (!b64) return undefined;
  return { b64, mime: typeof state.artworkMimeType === "string" ? state.artworkMimeType : "" };
}

/** Restart delay after the stream process died: 1 s, 2 s, 4 s ... up to 30 s. */
export const backoffMs = (failures: number): number => Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1));
/** Consecutive failed starts after which the reader gives up and the Spotify/Music reader takes over. */
export const MAX_STREAM_FAILURES = 3;
