/**
 * One-cable setup for Android phones (spec: specs/2026-11-27/android-app-and-usb-setup). With USB debugging on, the agent installs
 * the Nookdeck app, forwards the phone's localhost:<port> to this computer through the cable (`adb reverse`), pairs the phone without
 * a PIN and opens the app on the deck. Set-up phones get `adb reverse` again whenever they come back (cable, agent restart).
 *
 * Costs nothing until used: no adb runs while no phone was ever set up and nobody looks at the Devices tab.
 */
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { adbRunner, downloadPlatformTools, findAdb, hasReverse, parseDevices, parsePackage, type AdbFound, type AdbRun, type DeviceState, type OsId } from "./adb";
import type { UsbUndo } from "../config";

export const APP_ID = "app.nookdeck";
export const APP_ACTIVITY = `${APP_ID}/.MainActivity`;
/** How long the Devices tab keeps the watcher on after its last look. */
const LOOKING_MS = 2 * 60_000;
const POLL_MS = 4_000;

/** "0.8.1" -> 801: the app's versionCode for an agent version (the release builds the app with the same rule). */
export function versionCode(version: string): number {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
}

export interface UsbPhone {
  serial: string;
  state: DeviceState;
  model?: string;
  android?: string;
  /** installed app version (name), absent when not installed */
  app?: string;
  appCode?: number;
  /** the installed app is older than this agent's */
  appOld?: boolean;
  /** paired over USB before (a device in devices.json carries this serial) */
  setUp: boolean;
  /** localhost:<port> on the phone reaches this computer right now */
  linked: boolean;
}
export interface UsbStatus { adb: AdbFound | null; phones: UsbPhone[]; error?: string; busy?: string }

export interface SetupOptions { stayAwake?: boolean; battery?: boolean }
export interface UsbDeps {
  home: string;
  os: OsId;
  port: number;
  agentVersion: string;
  /** a device token without the PIN, replacing an earlier one for the same serial */
  pairTrusted: (name: string, serial: string, undo?: UsbUndo) => Promise<{ token: string }>;
  /** serials of phones paired over USB (devices.json) */
  usbSerials: () => Promise<string[]>;
  /** http://<LAN address>:<port> for the app to fall back to without the cable */
  lanUrls: () => Promise<string[]>;
  computerName: () => Promise<string>;
  /** this computer's id (/api/hello), so the app reconnects to it and not to another Nookdeck on the Wi-Fi */
  computerId?: () => Promise<string>;
  /** the APK to install: a file on disk */
  apk: () => Promise<string>;
  log: (line: string) => void;
  run?: (adb: string) => AdbRun;
  /** PATH lookup (tests) */
  which?: (cmd: string) => string | null;
  download?: (home: string, os: OsId) => Promise<AdbFound>;
  now?: () => number;
}

export class AndroidUsb {
  private lookedAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private phones: UsbPhone[] = [];
  private error: string | undefined;
  private busy: string | undefined;
  private info = new Map<string, { model?: string; android?: string }>();
  private polling = false;
  constructor(private d: UsbDeps) {}

  private now = () => (this.d.now ? this.d.now() : Date.now());
  private adb(): AdbFound | null { return findAdb(this.d.home, this.d.os, this.d.which); }
  private runner(a: AdbFound): AdbRun { return (this.d.run ?? adbRunner)(a.path); }

  /** At agent start: watch only when some phone was set up over USB before. */
  async start(): Promise<void> {
    if ((await this.d.usbSerials()).length && this.adb()) this.watch();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private watch(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    (this.timer as any).unref?.();
  }

  /** The Devices tab asks: refresh now and keep watching for a while. */
  async status(): Promise<UsbStatus> {
    this.lookedAt = this.now();
    const adb = this.adb();
    if (adb) {
      this.watch();
      await this.poll();
    }
    return { adb, phones: this.phones, ...(this.error ? { error: this.error } : {}), ...(this.busy ? { busy: this.busy } : {}) };
  }

  /**
   * The tray asks every few seconds: what the watcher saw last, without running adb now. Keeps the watcher on while adb is there,
   * so a phone plugged in shows up in the tray menu without opening the Devices tab.
   */
  peek(): UsbStatus {
    this.lookedAt = this.now();
    const adb = this.adb();
    if (adb) this.watch();
    return { adb, phones: this.phones, ...(this.error ? { error: this.error } : {}), ...(this.busy ? { busy: this.busy } : {}) };
  }

  /** Report: what USB setup knows, without starting anything. */
  snapshot(): UsbStatus {
    return { adb: this.adb(), phones: this.phones, ...(this.error ? { error: this.error } : {}) };
  }

  async installAdb(): Promise<AdbFound> {
    const found = this.adb();
    if (found) return found;
    this.busy = "adb";
    try {
      const got = await (this.d.download ?? downloadPlatformTools)(this.d.home, this.d.os);
      this.d.log(`[android] Android Platform Tools installed (${got.path})`);
      this.error = undefined;
      return got;
    } catch (e: any) {
      this.error = String(e?.message ?? e);
      throw e;
    } finally {
      this.busy = undefined;
    }
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    const adb = this.adb();
    if (!adb) return;
    this.polling = true;
    try {
      const run = this.runner(adb);
      const r = await run(["devices", "-l"], 8_000);
      if (r.code !== 0) { this.error = (r.err || r.out).trim().slice(0, 300) || `adb exited with ${r.code}`; return; }
      const serials = await this.d.usbSerials();
      const want = versionCode(this.d.agentVersion);
      const phones: UsbPhone[] = [];
      for (const dev of parseDevices(r.out)) {
        const phone: UsbPhone = { serial: dev.serial, state: dev.state, ...(dev.model ? { model: dev.model } : {}), setUp: serials.includes(dev.serial), linked: false };
        if (dev.state === "device") {
          let inf = this.info.get(dev.serial);
          if (!inf) {
            const p = await run(["-s", dev.serial, "shell", "getprop ro.product.model; getprop ro.build.version.release"], 8_000);
            const [model, android] = p.out.split(/\r?\n/).map((s) => s.trim());
            inf = { ...(model ? { model } : {}), ...(android ? { android } : {}) };
            this.info.set(dev.serial, inf);
          }
          Object.assign(phone, inf);
          const pkg = parsePackage((await run(["-s", dev.serial, "shell", `dumpsys package ${APP_ID}`], 8_000)).out);
          if (pkg) { phone.app = pkg.name; phone.appCode = pkg.code; phone.appOld = want > 0 && pkg.code < want; }
          let linked = hasReverse((await run(["-s", dev.serial, "reverse", "--list"], 8_000)).out, this.d.port);
          // a phone set up before: put the cable link back by itself (cable plugged again, agent restarted)
          if (!linked && phone.setUp && pkg) {
            const rv = await run(["-s", dev.serial, "reverse", `tcp:${this.d.port}`, `tcp:${this.d.port}`], 8_000);
            linked = rv.code === 0;
            if (linked) this.d.log(`[android] ${phone.model ?? dev.serial}: linked again through the cable`);
          }
          phone.linked = linked;
        }
        phones.push(phone);
      }
      this.phones = phones;
      this.error = undefined;
      // stop watching when nobody looks and no set-up phone exists
      if (!serials.length && this.now() - this.lookedAt > LOOKING_MS) this.stop();
    } catch (e: any) {
      this.error = String(e?.message ?? e).slice(0, 300);
    } finally {
      this.polling = false;
    }
  }

  /** Install or update the app, link it through the cable, pair it without a PIN and open it on the deck. */
  async setup(serial: string, o: SetupOptions = {}): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
    const adb = this.adb();
    if (!adb) return { ok: false, error: "adb is not installed" };
    if (!/^[\w.:\-]{1,64}$/.test(serial)) return { ok: false, error: "bad serial" };
    if (this.busy) return { ok: false, error: "another setup is running" };
    const run = this.runner(adb);
    const s = (args: string[], ms?: number) => run(["-s", serial, ...args], ms);
    const fail = (step: string, r: { out: string; err: string; code: number }) => ({ ok: false as const, error: `${step}: ${(r.err || r.out).trim().split(/\r?\n/).pop()?.slice(0, 300) || `exit ${r.code}`}` });
    this.busy = serial;
    try {
      const state = parseDevices((await run(["devices", "-l"], 8_000)).out).find((x) => x.serial === serial);
      if (!state) return { ok: false, error: "the phone is not connected" };
      if (state.state === "unauthorized") return { ok: false, error: "allow USB debugging on the phone first" };
      if (state.state !== "device") return { ok: false, error: `the phone is ${state.state}` };
      const model = (await s(["shell", "getprop ro.product.model"], 8_000)).out.trim() || state.model || "Android";

      const pkg = parsePackage((await s(["shell", `dumpsys package ${APP_ID}`], 8_000)).out);
      if (!pkg || pkg.code < versionCode(this.d.agentVersion)) {
        const apk = await this.d.apk();
        const r = await s(["install", "-r", apk], 180_000);
        if (r.code !== 0 || /Failure/i.test(r.out)) return fail("installing the app", r);
        this.d.log(`[android] ${model}: app ${pkg ? "updated" : "installed"}`);
      }
      const rv = await s(["reverse", `tcp:${this.d.port}`, `tcp:${this.d.port}`], 8_000);
      if (rv.code !== 0) return fail("linking through the cable", rv);

      const undo: UsbUndo = {};
      if (o.stayAwake) {
        const before = Number.parseInt((await s(["shell", "settings get global stay_on_while_plugged_in"], 8_000)).out.trim(), 10);
        if (Number.isInteger(before) && before >= 0 && before <= 15) undo.stayOn = before;
        await s(["shell", "svc power stayon usb"], 8_000);
      }
      if (o.battery) {
        await s(["shell", `dumpsys deviceidle whitelist +${APP_ID}`], 8_000);
        undo.battery = true;
      }

      const { token } = await this.d.pairTrusted(model, serial, undo);
      const lan = (await this.d.lanUrls()).join(",");
      const name = (await this.d.computerName()).replace(/[^\w .\-]/g, "").slice(0, 60) || "Computer";
      const computer = ((await this.d.computerId?.()) ?? "").replace(/[^0-9a-f]/g, "");
      // `adb shell` joins its arguments into one command line on the phone: quote each value
      const q = (v: string) => `'${v.replace(/'/g, "")}'`;
      const start = await s(["shell", `am start -n ${APP_ACTIVITY} -a android.intent.action.MAIN --es token ${q(token)} --es usb ${q(`http://localhost:${this.d.port}`)} --es lan ${q(lan)} --es name ${q(name)} --es computer ${q(computer)}`], 15_000);
      if (start.code !== 0 || /Error/i.test(start.out)) return fail("opening the app", start);
      this.d.log(`[android] ${model}: set up over USB`);
      this.watch();
      this.info.delete(serial);
      void this.poll();
      return { ok: true, model };
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e).slice(0, 300) };
    } finally {
      this.busy = undefined;
    }
  }

  /**
   * A USB phone was forgotten on the Devices tab: put back what setup changed (stay awake while charging, battery optimisation)
   * and drop the cable link. Only while the phone is plugged in and allowed; otherwise there is nothing to reach and it stays as it is.
   */
  async release(serial: string, undo: UsbUndo | undefined): Promise<boolean> {
    const adb = this.adb();
    if (!adb || !/^[\w.:\-]{1,64}$/.test(serial)) return false;
    const run = this.runner(adb);
    try {
      const state = parseDevices((await run(["devices", "-l"], 8_000)).out).find((x) => x.serial === serial);
      if (state?.state !== "device") return false;
      const s = (args: string[]) => run(["-s", serial, ...args], 8_000);
      if (Number.isInteger(undo?.stayOn) && undo!.stayOn! >= 0 && undo!.stayOn! <= 15) await s(["shell", `settings put global stay_on_while_plugged_in ${undo!.stayOn}`]);
      if (undo?.battery) await s(["shell", `dumpsys deviceidle whitelist -${APP_ID}`]);
      await s(["reverse", "--remove", `tcp:${this.d.port}`]);
      this.d.log(`[android] ${serial}: settings from setup put back`);
      this.info.delete(serial);
      void this.poll(); // the phone shows as not set up right away (the tray's pairing window, the manage page)
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * The APK for this agent version: NOOKDECK_APK (a development build) when set, else the release asset, downloaded once into
 * <home>/android and checked against the release's SHA256SUMS.
 */
export async function releaseApk(home: string, version: string, env: Record<string, string | undefined>, fetchFn: typeof fetch = fetch): Promise<string> {
  if (env.NOOKDECK_APK) {
    if (!existsSync(env.NOOKDECK_APK)) throw new Error(`NOOKDECK_APK points to a missing file: ${env.NOOKDECK_APK}`);
    return env.NOOKDECK_APK;
  }
  const dir = join(home, "android");
  const file = join(dir, `Nookdeck-${version}.apk`);
  if (existsSync(file)) return file;
  const base = `https://github.com/howznguyen/nookdeck/releases/download/v${version}/`;
  const sums = await fetchFn(base + "SHA256SUMS", { signal: AbortSignal.timeout(30_000) });
  if (!sums.ok) throw new Error(`could not read the release checksums (${sums.status})`);
  const want = /^([0-9a-f]{64})\s+\*?Nookdeck\.apk$/m.exec(await sums.text())?.[1];
  if (!want) throw new Error(`this release (${version}) has no Android app`);
  const res = await fetchFn(base + "Nookdeck.apk", { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`could not download the Android app (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (createHash("sha256").update(buf).digest("hex") !== want) throw new Error("the Android app download does not match the release checksum");
  await mkdir(dir, { recursive: true });
  await writeFile(file + ".part", buf);
  await rename(file + ".part", file);
  return file;
}

