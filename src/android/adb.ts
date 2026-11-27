/**
 * Finding, downloading and running adb (Android Debug Bridge). A user's own adb on PATH wins; otherwise Google's Platform Tools are
 * downloaded once into <Nookdeck home>/android/platform-tools, checked against the size and hashes pinned here (from Google's own
 * repository2-3.xml), and run from there. Every command has a timeout, so a stuck phone never blocks the agent.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { extractZip } from "./zip";

export type OsId = "darwin" | "win32" | "linux";
export const osId = (p: string): OsId => (p === "darwin" ? "darwin" : p === "win32" ? "win32" : "linux");

/** Platform Tools r37.0.3; sha1 and size as Google lists them, sha256 computed from the same files (2026-11-27). */
export const PLATFORM_TOOLS: Record<OsId, { file: string; size: number; sha1: string; sha256: string }> = {
  darwin: { file: "platform-tools_r37.0.3-darwin.zip", size: 16597626, sha1: "d48920e2650321710b4d15d3acd9e277d59cd55b", sha256: "df21339b9371fef9b19264404338dc686f59a88a1dce634b963da344909001d6" },
  win32: { file: "platform-tools_r37.0.3-win.zip", size: 8188601, sha1: "7fea85bc18d0480bc81d3603952d666f49496e5a", sha256: "89d108360a3bf2924d3bea837239edaccc22fd6ff5befd3787c4348a9fe4f09d" },
  linux: { file: "platform-tools_r37.0.3-linux.zip", size: 9571024, sha1: "e1579b288a7ae4e9bc28dedec6a154d78b3c04ed", sha256: "214548146cadb2ca3508143d8a1d4be4c59de5bb837253e3ede89ed74cf450d1" },
};
export const PLATFORM_TOOLS_BASE = "https://dl.google.com/android/repository/";

export interface AdbFound { path: string; source: "path" | "nookdeck" }

const exe = (os: OsId) => (os === "win32" ? "adb.exe" : "adb");
export const ownAdbPath = (home: string, os: OsId) => join(home, "android", "platform-tools", exe(os));

/** The adb to use: the user's own on PATH, else the one Nookdeck downloaded; null when neither is there. */
export function findAdb(home: string, os: OsId, which: (cmd: string) => string | null = (c) => Bun.which(c)): AdbFound | null {
  const onPath = which("adb");
  if (onPath) return { path: onPath, source: "path" };
  const own = ownAdbPath(home, os);
  return existsSync(own) ? { path: own, source: "nookdeck" } : null;
}

/** The archive checked: right size, and both hashes match. Returns the reason when it does not. */
export function checkArchive(buf: Uint8Array, os: OsId): string | null {
  const want = PLATFORM_TOOLS[os];
  if (buf.length !== want.size) return `the download has ${buf.length} bytes, expected ${want.size}`;
  if (createHash("sha1").update(buf).digest("hex") !== want.sha1) return "the download does not match Google's checksum";
  if (createHash("sha256").update(buf).digest("hex") !== want.sha256) return "the download does not match the pinned SHA-256";
  return null;
}

/** Downloads and installs Platform Tools under <home>/android. Throws a readable error; leaves nothing half-written. */
export async function downloadPlatformTools(home: string, os: OsId, fetchFn: typeof fetch = fetch): Promise<AdbFound> {
  const want = PLATFORM_TOOLS[os];
  const res = await fetchFn(PLATFORM_TOOLS_BASE + want.file, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`could not download Android Platform Tools (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const bad = checkArchive(buf, os);
  if (bad) throw new Error(`Android Platform Tools not installed: ${bad}`);
  const dir = join(home, "android");
  const tmp = join(dir, `.platform-tools-${process.pid}`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  try {
    await extractZip(buf, tmp);
    if (!existsSync(join(tmp, "platform-tools", exe(os)))) throw new Error("the archive has no adb");
    await rm(join(dir, "platform-tools"), { recursive: true, force: true });
    await rename(join(tmp, "platform-tools"), join(dir, "platform-tools"));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return { path: ownAdbPath(home, os), source: "nookdeck" };
}

export interface RunResult { code: number; out: string; err: string }
export type AdbRun = (args: string[], timeoutMs?: number) => Promise<RunResult>;

/** Runs adb with a timeout (killed after it). */
export function adbRunner(adb: string): AdbRun {
  return async (args, timeoutMs = 15_000) => {
    const p = Bun.spawn([adb, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true } as any);
    const timer = setTimeout(() => { try { p.kill(); } catch {} }, timeoutMs);
    try {
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      return { code, out, err };
    } finally {
      clearTimeout(timer);
    }
  };
}

export type DeviceState = "device" | "unauthorized" | "offline" | "no permissions" | "recovery" | "sideload" | "bootloader" | "unknown";
export interface AdbDevice { serial: string; state: DeviceState; model?: string }

/**
 * `adb devices -l`:
 *   List of devices attached
 *   R58M12ABCDE    device usb:1-1 product:j7xelte model:SM_J710F device:j7xelte transport_id:3
 *   0123456789     unauthorized usb:1-2 transport_id:4
 */
export function parseDevices(out: string): AdbDevice[] {
  const list: AdbDevice[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^(\S+)\s+(device|unauthorized|offline|no permissions|recovery|sideload|bootloader|\S+)(?:\s+(.*))?$/.exec(line.trim());
    if (!m || line.startsWith("List of devices") || line.startsWith("*")) continue;
    const known = ["device", "unauthorized", "offline", "no permissions", "recovery", "sideload", "bootloader"];
    const model = /(?:^|\s)model:(\S+)/.exec(m[3] ?? "")?.[1]?.replace(/_/g, " ");
    list.push({ serial: m[1]!, state: (known.includes(m[2]!) ? m[2] : "unknown") as DeviceState, ...(model ? { model } : {}) });
  }
  return list;
}

/** `dumpsys package app.nookdeck`: the installed versionCode and versionName, or null when the app is not installed. */
export function parsePackage(out: string): { code: number; name: string } | null {
  const code = /versionCode=(\d+)/.exec(out)?.[1];
  if (!code) return null;
  return { code: Number(code), name: /versionName=(\S+)/.exec(out)?.[1] ?? "" };
}

/** `adb reverse --list`: is tcp:<port> on the phone forwarded to tcp:<port> here? */
export const hasReverse = (out: string, port: number): boolean => new RegExp(`(^|\\s)tcp:${port}\\s+tcp:${port}(\\s|$)`, "m").test(out);
