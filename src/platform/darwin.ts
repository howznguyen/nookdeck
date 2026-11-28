import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCommand } from "../actions";
import { MEDIA_BUNDLES, macReadScript, parseMacTrackOutput, resumeScript, MEDIA_APPS, type MediaApp, type RawMedia } from "../media";
import { hotkeyPlan, typePlan, type MediaKey } from "./mac-keys";
import { MAC_LAUNCH_TIMEOUT_MS, MAC_READ_TIMEOUT_MS, macNative } from "./mac-client";
import { NowPlayingStream, extractAdapter, type AdapterFiles } from "./mac-remote";
import { MRA_EMBED } from "./mra-embed.gen";
import { parseNetstat } from "../stats";
import { parsePs, topProcessesFrom } from "../processes";
import { parseAfinfo } from "../sounds";
import { t } from "../i18n";
import { runCapture } from "./exec";
import type { Platform, SecretStore } from "./types";

type Runner = (argv: string[], timeoutMs?: number) => Promise<string>;

/** macOS Keychain through `security` (generic passwords). `run` is injectable for tests. */
export function keychainStore(run: Runner = (argv, ms) => runCapture(argv, ms ?? 5000)): SecretStore {
  return {
    async get(service, account) {
      try {
        const v = (await run(["security", "find-generic-password", "-s", service, "-a", account, "-w"])).trim();
        return v || undefined;
      } catch { return undefined; }
    },
    async set(service, account, value) {
      try { await run(["security", "add-generic-password", "-U", "-s", service, "-a", account, "-w", value]); return true; } catch { return false; }
    },
    async remove(service, account) {
      try { await run(["security", "delete-generic-password", "-s", service, "-a", account]); } catch { /* none stored */ }
    },
  };
}

/** Seconds since the last input (HIDIdleTime from ioreg), or null. */
export async function macIdleSeconds(run: (argv: string[]) => Promise<string> = (a) => runCapture(a, 3000)): Promise<number | null> {
  try {
    const m = /"HIDIdleTime"\s*=\s*(\d+)/.exec(await run(["ioreg", "-c", "IOHIDSystem"]));
    return m ? Number(m[1]) / 1e9 : null;
  } catch {
    return null;
  }
}

async function macMemUsed(): Promise<number | undefined> {
  try {
    const proc = Bun.spawn(["vm_stat"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    const { parseVmStat } = await import("../stats");
    return parseVmStat(text);
  } catch {
    return undefined;
  }
}

const mac = () => macNative();

/** The title of the frontmost window (System Events; asks once for permission to control System Events). */
export const FRONT_TITLE_SCRIPT = 'tell application "System Events" to tell (first application process whose frontmost is true) to if (count of windows) > 0 then return name of front window';

// ---------- Now Playing from every app (mediaremote-adapter stream) ----------

let adapterFiles: Promise<AdapterFiles | null> | undefined;
/** The adapter written to ~/.nookdeck/lib (once); null when this build does not carry it. */
const adapter = () => (adapterFiles ??= extractAdapter(MRA_EMBED).catch(() => null));
const remote = new NowPlayingStream({ files: adapter });

/** Is the all-apps reader usable? ok:false carries the reason for the doctor. */
async function nowPlayingStatus(): Promise<{ ok: boolean; why?: string }> {
  if (!MRA_EMBED) return { ok: false, why: "this build does not include the Now Playing adapter" };
  const files = await adapter();
  if (!files) return { ok: false, why: "the Now Playing adapter could not be unpacked into ~/.nookdeck/lib" };
  if (remote.gaveUp) return { ok: false, why: "the adapter stopped repeatedly; only Spotify and Music are read" };
  try {
    await runCapture([files.perl, files.script, files.framework, "get", "--no-artwork"], 8000);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, why: String(e?.message ?? e).split("\n")[0]!.slice(0, 120) || "the adapter did not run" };
  }
}

/** Spotify/Music through the native helper; a player that is not running is skipped without sending any Apple Event. */
async function readMac(): Promise<RawMedia | null> {
  const r = await remote.read();
  if (r !== "unavailable") return r;
  return readPlayers();
}

async function readPlayers(): Promise<RawMedia | null> {
  const out = await mac().call<string>("readMedia", { scripts: MEDIA_APPS.map((a) => ({ bundle: MEDIA_BUNDLES[a], source: macReadScript(a) })) }, MAC_READ_TIMEOUT_MS);
  const media = parseMacTrackOutput(out);
  if (media?.app === "Spotify") {
    const url = (await mac().call<string>("script", { requires: MEDIA_BUNDLES.Spotify, source: `tell application "Spotify" to artwork url of current track` }, MAC_READ_TIMEOUT_MS).catch(() => "")).trim();
    if (url) media.artworkUrl = url;
  }
  return media;
}

async function sipsToJpegDataUrl(input: string, dir: string): Promise<string> {
  const out = join(dir, "art.jpg");
  await runCapture(["sips", "-Z", "300", "-s", "format", "jpeg", input, "--out", out], 5000);
  return `data:image/jpeg;base64,${Buffer.from(await readFile(out)).toString("base64")}`;
}

/** Artwork as a data URL, resized to max 300px with sips. Undefined when unavailable. */
async function macArtwork(raw: RawMedia): Promise<string | undefined> {
  if (!remote.gaveUp) {
    // the cover from the now playing stream (often a big TIFF): JPEG of at most 300 px, made by ImageIO inside the worker
    const a = remote.artwork();
    if (a) {
      const jpg = await mac().call<string | null>("jpeg", { b64: a.b64, max: 300 }, 8000).catch(() => null);
      if (jpg) return `data:image/jpeg;base64,${jpg}`;
    }
    if (raw.app !== "Spotify" && raw.app !== "Music") return undefined;
  }
  const dir = await mkdtemp(join(tmpdir(), "pd-art-"));
  try {
    const src = join(dir, "src");
    if (raw.app === "Spotify" && raw.artworkUrl) {
      const res = await fetch(raw.artworkUrl, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return undefined;
      await writeFile(src, new Uint8Array(await res.arrayBuffer()));
    } else if (raw.app === "Music") {
      const script = [
        `set f to POSIX file "${src.replace(/["\\]/g, "")}"`,
        `tell application "Music" to set d to (raw data of artwork 1 of current track)`,
        `set fh to open for access f with write permission`,
        `try`,
        `set eof fh to 0`,
        `write d to fh`,
        `end try`,
        `close access fh`,
      ].join("\n");
      await mac().call("script", { requires: MEDIA_BUNDLES.Music, source: script }, 6000);
    } else {
      return undefined;
    }
    return await sipsToJpegDataUrl(src, dir);
  } catch {
    return undefined;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runningApps(): Promise<Record<MediaApp, boolean>> {
  const r = await mac().call<Record<string, boolean>>("running", { bundles: Object.values(MEDIA_BUNDLES) }, MAC_READ_TIMEOUT_MS).catch(() => ({} as Record<string, boolean>));
  return { Music: !!r[MEDIA_BUNDLES.Music], Spotify: !!r[MEDIA_BUNDLES.Spotify] };
}

export function createDarwin(): Platform {
  return {
    id: "darwin",
    label: "macOS",
    keyNames: { cmd: "Cmd", alt: "Option", ctrl: "Control" },

    async runAction(a) {
      // keys, typing, media keys and volume are native calls; open / shell are plain commands
      switch (a.type) {
        case "hotkey": hotkeyPlan(a.keys); return void (await mac().call("hotkey", { keys: a.keys }));
        case "type": typePlan(a.text); return void (await mac().call("type", { text: a.text }, 15000));
        case "media": {
          // the adapter targets whatever app is now playing and needs no Accessibility; the media keys are the fallback
          if (!remote.gaveUp && remote.hasSession && (await remote.send(a.command))) return;
          return void (await mac().call("media", { command: a.command as MediaKey }));
        }
        case "volume": return void (await mac().call("volumeStep", { command: a.command }));
        case "lock": return void (await mac().call("hotkey", { keys: "ctrl+cmd+q" })); // the system "Lock Screen" shortcut
      }
      await runCapture(buildCommand(a, "darwin"), undefined, undefined, a.type === "shell" ? a.env : undefined);
    },

    async readVolume() {
      try { return await mac().call("volumeGet"); } catch { return null; }
    },
    async setVolume(v) {
      if ("level" in v) {
        if (!Number.isInteger(v.level) || v.level < 0 || v.level > 100) throw new Error("volume level must be an integer 0-100");
        await mac().call("volumeSet", { level: v.level });
      } else {
        if (typeof v.muted !== "boolean") throw new Error("muted must be a boolean");
        await mac().call("mute", { muted: v.muted });
      }
    },

    readMedia: readMac,
    fetchArtwork: macArtwork,
    nowPlayingStatus,
    async resumeMedia(lastApp) {
      // a browser or another app was the last player: ask the system to play whatever is paused there
      if (lastApp && !(MEDIA_APPS as readonly string[]).includes(lastApp) && !remote.gaveUp && (await remote.send("play"))) return;
      const plan = resumeScript(await runningApps(), lastApp);
      // `tell application ... to play` launches the app when it is not running: that is the point of resume
      await mac().call("script", { source: plan.lines.join("\n") }, plan.launches ? MAC_LAUNCH_TIMEOUT_MS : MAC_READ_TIMEOUT_MS);
    },
    async openMediaApp(app) {
      if (!(MEDIA_APPS as readonly string[]).includes(app)) throw new Error(t("Opening the music app is not supported on this operating system"));
      await runCapture(["open", "-b", MEDIA_BUNDLES[app]], 15000);
    },

    async netCounters() {
      try { return parseNetstat(await runCapture(["netstat", "-ibn"], 3000)); } catch { return undefined; }
    },
    memUsed: macMemUsed,
    async memDetail() {
      const { parseVmStatCached, parseSwapUsage } = await import("../stats");
      const [vm, sw] = await Promise.all([runCapture(["vm_stat"], 3000).catch(() => ""), runCapture(["sysctl", "-n", "vm.swapusage"], 3000).catch(() => "")]);
      const cached = parseVmStatCached(vm);
      const swap = parseSwapUsage(sw);
      return cached === undefined && !swap ? undefined : { ...(cached !== undefined ? { cached } : {}), ...(swap || {}) };
    },
    async gpu() {
      try { return (await mac().call("gpu", {}, MAC_READ_TIMEOUT_MS)) ?? undefined; } catch { return undefined; }
    },
    async topProcesses(sort, limit) {
      return topProcessesFrom(parsePs(await runCapture(["ps", "-Ao", "pid,pcpu,rss,comm"], 5000)), sort, limit);
    },
    async lanName() {
      try { return (await runCapture(["scutil", "--get", "LocalHostName"], 2000)).trim(); } catch { return undefined; }
    },

    apps: null, // macOS apps are read from the .app bundles by icons.ts (Info.plist + sips)
    soundCommand: (path, volume) => ["afplay", "-v", String(Math.round(volume) / 100), path],
    async soundDuration(path) {
      try { return parseAfinfo(await runCapture(["afinfo", path], 5000)); } catch { return undefined; }
    },

    secrets: keychainStore(),
    async claudeCredentials(service = "Claude Code-credentials") {
      if (!/^Claude Code-credentials(-[0-9a-f]{8})?$/.test(service)) return null; // only Claude Code's own entries
      try { return (await runCapture(["security", "find-generic-password", "-s", service, "-w"], 8000)).trim() || null; } catch { return null; }
    },
    loadKind: "loadavg",
    idleSeconds: () => macIdleSeconds(),

    openExternal: async (url) => void (await runCapture(["open", url], 5000)),
    hookPath: (p) => p,
    dispose: () => { remote.stop(); macNative().dispose(); },

    async avUsage(ignorePid) {
      const r = await mac().call<{ mic: { inUse: boolean; apps: string[] }; camera: boolean }>("avUsage", { ignorePid: ignorePid ?? 0 });
      return { mic: { inUse: r.mic.inUse, apps: r.mic.apps }, camera: { inUse: r.camera, apps: [] } };
    },
    async readMic() {
      const m = await mac().call<{ muted: boolean | null; canMute: boolean; volume: number | null } | null>("micRead");
      return m ? { muted: m.muted, canMute: m.canMute, volume: m.volume } : null;
    },
    setMicMuted: async (muted) => void (await mac().call("micMute", { muted })),
    setMicVolume: async (level) => void (await mac().call("micVolume", { level })),
    async frontApp(withTitle) {
      let id = "";
      try { id = await mac().call<string>("frontApp"); } catch { return null; }
      if (!id) return null;
      if (!withTitle) return { id };
      try {
        const title = await mac().call<string>("script", { source: FRONT_TITLE_SCRIPT });
        return { id, title: String(title ?? "") };
      } catch { return { id }; }
    },
    activateApp: async (id) => { try { return !!(await mac().call<boolean>("activate", { bundle: id })); } catch { return false; } },
    async runningApps(ids) {
      try { const r = await mac().call<Record<string, boolean>>("running", { bundles: ids }); return ids.filter((b) => r[b]); } catch { return []; }
    },
  };
}
