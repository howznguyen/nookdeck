import { hostname, homedir } from "node:os";
import { readFile, stat } from "node:fs/promises";
import { buildCommand, buildVolumeCommand, parsePactlVolume } from "../actions";
import { parsePlayerctl, type RawMedia } from "../media";

const US = "\u001f"; // not imported from ../media: that module imports this one, and a const read during the cycle is still in its TDZ
import { parseProcNetDev } from "../stats";
import { parsePs, topProcessesFrom } from "../processes";
import { t } from "../i18n";
import { runCapture, runCode } from "./exec";
import type { Platform, SecretStore } from "./types";
import { linuxInputBackend, linuxSession, ydotoolGeneration } from "./linux-input";
import type { LinuxInputTool } from "./linux-keys";
import { createLinuxApps } from "./linux-apps";
import { activateX11App } from "./linux-activate";
import { NVIDIA_SMI_ARGS, fileUrlPath, imageMime, parseMeminfo, parseMeminfoDetail, parseNvidiaSmi, parseXprintidle } from "./linux-sys";
import { shrinkPng } from "./png";
import { PACTL_GET_SOURCE_MUTE, PACTL_GET_SOURCE_VOLUME, PACTL_SHORT_SOURCES, PACTL_SOURCE_OUTPUTS, cameraApps, micApps, pactlSourceMuteCommand, parseShortSources, parseSourceMute, parseSourceOutputs, type ProcFs } from "./linux-av";

const LINUX_FORMAT = ["{{playerName}}", "{{status}}", "{{title}}", "{{artist}}", "{{album}}", "{{position}}", "{{mpris:length}}", "{{mpris:artUrl}}"].join(US);
const ART_MAX_BYTES = 1024 * 1024;

async function readLinux(): Promise<RawMedia | null> {
  if (!Bun.which("playerctl")) return null;
  try {
    return parsePlayerctl(await runCapture(["playerctl", "metadata", "--format", LINUX_FORMAT], 3000));
  } catch {
    return null; // "No players found" exits non-zero
  }
}

type Run = (argv: string[], timeoutMs?: number, stdin?: string) => Promise<string>;
type Code = (argv: string[], timeoutMs?: number) => Promise<{ code: number; out: string }>;

/**
 * The key and typing tool for this session, or an error that names the package to install. ydotool's line (1.x event
 * codes or 0.1.x key names) is asked once through `ydotool help` and cached by the caller.
 */
export async function inputTool(env: Record<string, string | undefined>, which: (n: string) => string | null, ydotoolLine: () => Promise<"1" | "0.1">): Promise<LinuxInputTool> {
  const b = linuxInputBackend(env, which);
  if (b.kind === "ydotool") return (await ydotoolLine()) === "0.1" ? "ydotool-0.1" : "ydotool";
  if (b.kind) return b.kind;
  if (b.session === "unknown") throw new Error(t("No desktop session to send keys to (DISPLAY and WAYLAND_DISPLAY are not set)"));
  if (b.missing === "ydotool") throw new Error(t("Keys and typing on Wayland need ydotool: install the ydotool package"));
  throw new Error(t("Keys and typing need {pkg}: install the {pkg} package", { pkg: b.missing || "xdotool" }));
}

/** ydotool errors a person can act on: no access to /dev/uinput, or (1.x) no ydotoold. */
export function explainInputError(tool: LinuxInputTool, err: unknown): Error {
  const msg = String((err as any)?.message ?? err);
  if (tool.startsWith("ydotool") && /uinput/i.test(msg)) return new Error(t("ydotool cannot open /dev/uinput: run nookdeck doctor for the fix"));
  if (tool === "ydotool" && /ydotoold|socket/i.test(msg)) return new Error(t("ydotool needs ydotoold running: run nookdeck doctor for the fix"));
  return err instanceof Error ? err : new Error(msg);
}

/** secret-tool (libsecret) with the attributes service and account. */
export function secretToolStore(run: Run): SecretStore {
  return {
    async get(service, account) {
      try { return (await run(["secret-tool", "lookup", "service", service, "account", account], 5000)) || undefined; } catch { return undefined; }
    },
    async set(service, account, value) {
      try { await run(["secret-tool", "store", `--label=Nookdeck ${service}`, "service", service, "account", account], 5000, value); return true; } catch { return false; }
    },
    async remove(service, account) {
      try { await run(["secret-tool", "clear", "service", service, "account", account], 5000); } catch { /* none stored */ }
    },
  };
}

/** A file:// cover as a data URL (PNG shrunk to 300 px; JPEG as is up to 1 MB); http(s) URLs pass through. */
export async function linuxArtwork(url: string | undefined, read: (p: string) => Promise<Uint8Array> = async (p) => new Uint8Array(await readFile(p))): Promise<string | undefined> {
  if (url && /^https?:/i.test(url)) return url;
  const path = fileUrlPath(url);
  if (!path) return undefined;
  try {
    const s = await stat(path).catch(() => null);
    if (s && (!s.isFile() || s.size > 8 * ART_MAX_BYTES)) return undefined;
    let bytes = await read(path);
    const mime = imageMime(bytes);
    if (mime === "image/png") bytes = shrinkPng(bytes, 300) ?? new Uint8Array(0);
    if (!mime || !bytes.length || bytes.length > ART_MAX_BYTES) return undefined;
    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch { return undefined; }
}

export interface LinuxDeps {
  run?: Run;
  code?: Code;
  readText?: (path: string) => Promise<string>;
  home?: string;
  host?: () => string;
  /** /proc access for the camera check (tests). */
  procFs?: ProcFs;
}

/** Linux (experimental): X11 and Wayland input, PulseAudio/PipeWire, MPRIS, and the readings in L5 of specs/linux-support. */
export function createLinux(
  id: NodeJS.Platform = "linux",
  which: (n: string) => string | null = (n) => Bun.which(n),
  env: Record<string, string | undefined> = process.env,
  deps: LinuxDeps = {},
): Platform {
  const run: Run = deps.run ?? ((argv, ms, stdin) => runCapture(argv, ms, stdin));
  const code: Code = deps.code ?? ((argv, ms) => runCode(argv, ms));
  const readText = deps.readText ?? ((p: string) => Bun.file(p).text());
  const home = deps.home ?? homedir();

  let line: Promise<"1" | "0.1"> | undefined;
  // `ydotool help` exits 1 on 0.1.x and prints to stderr: runCode keeps both
  const ydotoolLine = () => (line ??= code(["ydotool", "help"], 3000).then((r) => ydotoolGeneration(r.out), () => "1" as const));

  return {
    id,
    label: "Linux",
    keyNames: { cmd: "Super", alt: "Alt", ctrl: "Ctrl" },

    async runAction(a) {
      if (a.type === "hotkey" || a.type === "type") {
        const tool = await inputTool(env, which, ydotoolLine);
        try { await runCapture(buildCommand(a, "linux", tool)); } catch (err) { throw explainInputError(tool, err); }
        return;
      }
      if (a.type === "open" && a.target.trim().startsWith("bundle:")) return this.apps!.open(a.target.trim().slice(7));
      await runCapture(buildCommand(a, "linux"), undefined, undefined, a.type === "shell" ? a.env : undefined);
    },

    async readVolume() {
      try {
        const [v, m] = await Promise.all([
          runCapture(["pactl", "get-sink-volume", "@DEFAULT_SINK@"], 3000),
          runCapture(["pactl", "get-sink-mute", "@DEFAULT_SINK@"], 3000),
        ]);
        return parsePactlVolume(v, m);
      } catch { return null; }
    },
    async setVolume(v) { await runCapture(buildVolumeCommand(v, "linux")); },

    readMedia: readLinux,
    async fetchArtwork(raw) { return linuxArtwork(raw.artworkUrl); },
    async resumeMedia() {
      if (which("playerctl")) { await runCapture(["playerctl", "play"], 3000); return; }
      throw new Error(t("Playing music is not supported on this operating system"));
    },
    async openMediaApp() { throw new Error(t("Opening the music app is not supported on this operating system")); },

    async netCounters() {
      try { return parseProcNetDev(await readText("/proc/net/dev")); } catch { return undefined; }
    },
    async memUsed() {
      try { return parseMeminfo(await readText("/proc/meminfo")); } catch { return undefined; }
    },
    async memDetail() {
      try { return parseMeminfoDetail(await readText("/proc/meminfo")); } catch { return undefined; }
    },
    async nowPlayingStatus() { return { ok: false, why: "macOS only" }; },
    async gpu() {
      if (!which("nvidia-smi")) return undefined;
      try { return parseNvidiaSmi(await run(["nvidia-smi", ...NVIDIA_SMI_ARGS], 4000)); } catch { return undefined; }
    },
    async topProcesses(sort, limit) {
      return topProcessesFrom(parsePs(await runCapture(["ps", "-Ao", "pid,pcpu,rss,comm"], 5000)), sort, limit);
    },
    async lanName() {
      // the name Avahi announces as <name>.local is the host name's first label
      const name = (deps.host ?? hostname)().split(".")[0]!.trim();
      return name || undefined;
    },

    apps: createLinuxApps({ env, home, which, run }),
    soundCommand(path, volume) {
      if (which("paplay")) return ["paplay", `--volume=${Math.round((volume / 100) * 65536)}`, path];
      if (which("aplay")) return ["aplay", "-q", path];
      throw new Error("paplay or aplay is not installed");
    },
    async soundDuration() { return undefined; },

    secrets: which("secret-tool") ? secretToolStore(run) : null,
    async claudeCredentials() { return null; },
    loadKind: "loadavg",
    async idleSeconds() {
      if (linuxSession(env) !== "x11" || !which("xprintidle")) return null; // Wayland has no common idle query
      try { return parseXprintidle(await run(["xprintidle"], 2000)); } catch { return null; }
    },

    openExternal: async (url) => void (await runCapture(["xdg-open", url], 5000)),
    hookPath: (p) => p,
    dispose: () => {},

    async avUsage(ignorePid) {
      let mic: string[] = [];
      if (which("pactl")) {
        try {
          const [outs, srcs] = await Promise.all([run(PACTL_SOURCE_OUTPUTS, 3000), run(PACTL_SHORT_SOURCES, 3000)]);
          mic = micApps(parseSourceOutputs(outs), parseShortSources(srcs), ignorePid);
        } catch { /* no sound server: not in use */ }
      }
      const camera = await cameraApps(deps.procFs, ignorePid);
      return { mic: { inUse: mic.length > 0, apps: mic }, camera: { inUse: camera.length > 0, apps: camera } };
    },
    async readMic() {
      if (!which("pactl")) return null;
      try {
        const muted = parseSourceMute(await run(PACTL_GET_SOURCE_MUTE, 3000));
        const pct = /(\d+)%/.exec(await run(PACTL_GET_SOURCE_VOLUME, 3000).catch(() => ""))?.[1];
        return { muted, canMute: muted !== null, volume: pct === undefined ? null : Math.min(1, Number(pct) / 100) };
      } catch { return null; }
    },
    async setMicMuted(muted) {
      if (!which("pactl")) throw new Error(t("pactl is not installed"));
      await run(pactlSourceMuteCommand(muted), 3000);
    },
    setMicVolume: async () => { throw new Error("not used on Linux: the source is muted instead"); },
    async frontApp() {
      // X11 with xdotool only; Wayland has no common way to ask
      if (linuxSession(env) !== "x11" || !which("xdotool")) return null;
      try {
        const [cls, title] = await Promise.all([run(["xdotool", "getactivewindow", "getwindowclassname"], 2000), run(["xdotool", "getactivewindow", "getwindowname"], 2000)]);
        return cls.trim() ? { id: cls.trim().toLowerCase(), title: title.trim() } : null;
      } catch { return null; }
    },
    // X11 with xdotool; Wayland has no common way to raise another program's window
    activateApp: async (id) => (linuxSession(env) === "x11" ? activateX11App(id, run, which).catch(() => false) : false),
    runningApps: async () => [],
  };
}
