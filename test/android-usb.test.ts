import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkArchive, findAdb, hasReverse, parseDevices, parsePackage, type AdbRun } from "../src/android/adb";
import { extractZip, readZip } from "../src/android/zip";
import { AndroidUsb, versionCode, type UsbDeps } from "../src/android/usb";

/** A zip with stored and deflated entries, as the Platform Tools archive has them. */
function makeZip(files: { name: string; data: string; mode?: number; deflate?: boolean }[]): Uint8Array {
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    const raw = new TextEncoder().encode(f.data);
    const body = f.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, f.deflate ? 8 : 0, true); lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, name.length, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, f.deflate ? 8 : 0, true); ch.setUint32(20, body.length, true); ch.setUint32(24, raw.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(38, ((0o100000 | (f.mode ?? 0o644)) << 16) >>> 0, true); ch.setUint32(42, off, true);
    parts.push(new Uint8Array(lh.buffer), name, body);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

describe("adb output", () => {
  test("devices: ready, unauthorized, model with spaces", () => {
    const out = "List of devices attached\nR58M12ABCDE            device usb:1-1 product:j7xelte model:SM_J710F device:j7xelte transport_id:3\n0123456789ABCDEF       unauthorized usb:1-2 transport_id:4\nemulator-5554\toffline\n\n";
    expect(parseDevices(out)).toEqual([
      { serial: "R58M12ABCDE", state: "device", model: "SM J710F" },
      { serial: "0123456789ABCDEF", state: "unauthorized" },
      { serial: "emulator-5554", state: "offline" },
    ]);
    expect(parseDevices("* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n")).toEqual([]);
  });
  test("package version, reverse list, version code", () => {
    expect(parsePackage("Packages:\n  Package [app.nookdeck] (1a2b):\n    versionCode=801 minSdk=21 targetSdk=35\n    versionName=0.8.1\n")).toEqual({ code: 801, name: "0.8.1" });
    expect(parsePackage("Unable to find package: app.nookdeck")).toBeNull();
    expect(hasReverse("UsbFfs tcp:7420 tcp:7420\n", 7420)).toBe(true);
    expect(hasReverse("UsbFfs tcp:74200 tcp:7420\n", 7420)).toBe(false);
    expect([versionCode("0.8.1"), versionCode("1.12.3-beta"), versionCode("dev")]).toEqual([801, 11203, 0]);
  });
  test("the user's adb on PATH wins; else the downloaded one; else none", () => {
    const home = mkdtempSync(join(tmpdir(), "pd-adb-"));
    expect(findAdb(home, "linux", () => "/usr/bin/adb")).toEqual({ path: "/usr/bin/adb", source: "path" });
    expect(findAdb(home, "linux", () => null)).toBeNull();
  });
  test("a download that is not Google's file is refused", () => {
    expect(checkArchive(new Uint8Array(10), "linux")).toContain("bytes");
    expect(checkArchive(new Uint8Array(9571024), "linux")).toContain("checksum");
  });
});

describe("zip", () => {
  test("stored and deflated entries, the executable bit kept", async () => {
    const zip = makeZip([{ name: "platform-tools/adb", data: "#!/bin/sh\necho adb\n", mode: 0o755, deflate: true }, { name: "platform-tools/NOTICE.txt", data: "notice" }]);
    expect(readZip(zip).map((e) => [e.name, new TextDecoder().decode(e.data)])).toEqual([["platform-tools/adb", "#!/bin/sh\necho adb\n"], ["platform-tools/NOTICE.txt", "notice"]]);
    const dir = mkdtempSync(join(tmpdir(), "pd-zip-"));
    await extractZip(zip, dir);
    expect(readFileSync(join(dir, "platform-tools/NOTICE.txt"), "utf8")).toBe("notice");
    expect(statSync(join(dir, "platform-tools/adb")).mode & 0o111).toBeTruthy();
  });
  test("an entry that climbs out of the folder is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pd-zip-"));
    await expect(extractZip(makeZip([{ name: "../evil", data: "x" }]), dir)).rejects.toThrow("outside");
    expect(existsSync(join(dir, "..", "evil"))).toBe(false);
  });
});

/** A fake phone behind a fake adb: records every command. */
function fakeAdb(o: { state?: string; installed?: number; reverse?: boolean } = {}) {
  const calls: string[][] = [];
  const phone = { state: o.state ?? "device", installed: o.installed, reverse: !!o.reverse };
  const run: AdbRun = async (args) => {
    calls.push(args);
    const a = args.join(" ");
    const ok = (out = "") => ({ code: 0, out, err: "" });
    if (a === "devices -l") return ok(`List of devices attached\nR58M ${phone.state} usb:1-1 model:SM_J710F transport_id:3\n`);
    if (a.endsWith("getprop ro.product.model; getprop ro.build.version.release")) return ok("SM-J710F\n8.1.0\n");
    if (a.endsWith("getprop ro.product.model")) return ok("SM-J710F\n");
    if (a.includes("dumpsys package")) return ok(phone.installed ? `versionCode=${phone.installed} minSdk=21\n    versionName=x\n` : "Unable to find package");
    if (a.endsWith("reverse --list")) return ok(phone.reverse ? "UsbFfs tcp:7420 tcp:7420\n" : "");
    if (a.endsWith("reverse tcp:7420 tcp:7420")) { phone.reverse = true; return ok(); }
    if (a.includes(" install -r ")) { phone.installed = 801; return ok("Performing Streamed Install\nSuccess\n"); }
    if (a.endsWith("settings get global stay_on_while_plugged_in")) return ok("0\n");
    if (a.includes("am start")) return ok("Starting: Intent { cmp=app.nookdeck/.MainActivity }\n");
    return ok();
  };
  return { calls, phone, run };
}

function deps(f: ReturnType<typeof fakeAdb>, more: Partial<UsbDeps> = {}) {
  const paired: { name: string; serial: string; undo?: unknown }[] = [];
  const serials: string[] = [];
  const d: UsbDeps = {
    home: mkdtempSync(join(tmpdir(), "pd-usb-")), os: "linux", port: 7420, agentVersion: "0.8.1",
    pairTrusted: async (name, serial, undo) => { paired.push({ name, serial, undo }); serials.push(serial); return { token: "a".repeat(64) }; },
    usbSerials: async () => serials,
    lanUrls: async () => ["http://192.168.1.10:7420"],
    computerName: async () => "PC-Phong",
    apk: async () => "/tmp/Nookdeck.apk",
    log: () => {},
    run: () => f.run,
    which: () => null,
    ...more,
  };
  return { d, paired, serials };
}
// the fake adb has to be "found": point findAdb at a file that exists
const withAdb = (d: UsbDeps) => { const p = join(d.home, "android", "platform-tools"); require("node:fs").mkdirSync(p, { recursive: true }); require("node:fs").writeFileSync(join(p, "adb"), ""); return d; };

describe("USB setup", () => {
  test("a new phone: install, link through the cable, pair without a PIN, open the app with its addresses", async () => {
    const f = fakeAdb();
    const { d, paired } = deps(f);
    const usb = new AndroidUsb(withAdb(d));
    const r = await usb.setup("R58M", { stayAwake: true });
    expect(r).toEqual({ ok: true, model: "SM-J710F" });
    expect(paired).toEqual([{ name: "SM-J710F", serial: "R58M", undo: { stayOn: 0 } }]);
    const cmds = f.calls.map((c) => c.join(" "));
    expect(cmds).toContain("-s R58M install -r /tmp/Nookdeck.apk");
    expect(cmds).toContain("-s R58M reverse tcp:7420 tcp:7420");
    expect(cmds).toContain("-s R58M shell svc power stayon usb");
    expect(cmds.some((c) => c.includes("deviceidle"))).toBe(false); // not asked
    const start = cmds.find((c) => c.includes("am start"))!;
    expect(start).toContain("-n app.nookdeck/.MainActivity");
    expect(start).toContain(`--es token '${"a".repeat(64)}'`);
    expect(start).toContain("--es usb 'http://localhost:7420'");
    expect(start).toContain("--es lan 'http://192.168.1.10:7420'");
    expect(start).toContain("--es name 'PC-Phong'");
    // the order: the app is there and linked before it is opened
    expect(cmds.findIndex((c) => c.includes(" install "))).toBeLessThan(cmds.findIndex((c) => c.includes("am start")));
    expect(cmds.findIndex((c) => c.endsWith("reverse tcp:7420 tcp:7420"))).toBeLessThan(cmds.findIndex((c) => c.includes("am start")));
    usb.stop();
  });
  test("an up-to-date app is not installed again", async () => {
    const f = fakeAdb({ installed: 801 });
    const usb = new AndroidUsb(withAdb(deps(f).d));
    expect((await usb.setup("R58M")).ok).toBe(true);
    expect(f.calls.some((c) => c.includes("install"))).toBe(false);
    usb.stop();
  });
  test("a phone that has not allowed USB debugging: say so, touch nothing", async () => {
    const f = fakeAdb({ state: "unauthorized" });
    const { d, paired } = deps(f);
    const usb = new AndroidUsb(withAdb(d));
    expect(await usb.setup("R58M")).toEqual({ ok: false, error: "allow USB debugging on the phone first" });
    expect(paired).toEqual([]);
    expect(f.calls.map((c) => c.join(" "))).toEqual(["devices -l"]);
  });
  test("a serial that could carry a command is refused", async () => {
    const usb = new AndroidUsb(withAdb(deps(fakeAdb()).d));
    expect(await usb.setup("R58M; reboot")).toEqual({ ok: false, error: "bad serial" });
  });
  test("a set-up phone plugged in again is linked through the cable without a click", async () => {
    const f = fakeAdb({ installed: 801, reverse: false });
    const { d, serials } = deps(f);
    serials.push("R58M");
    const usb = new AndroidUsb(withAdb(d));
    const s = await usb.status();
    expect(s.phones).toEqual([{ serial: "R58M", state: "device", model: "SM-J710F", android: "8.1.0", app: "x", appCode: 801, appOld: false, setUp: true, linked: true }]);
    expect(f.calls.map((c) => c.join(" "))).toContain("-s R58M reverse tcp:7420 tcp:7420");
    usb.stop();
  });
  test("a phone never set up is listed but not linked by itself; an old app is flagged", async () => {
    const f = fakeAdb({ installed: 700 });
    const usb = new AndroidUsb(withAdb(deps(f).d));
    const s = await usb.status();
    expect(s.phones[0]).toMatchObject({ setUp: false, linked: false, appOld: true });
    expect(f.calls.some((c) => c.join(" ").endsWith("reverse tcp:7420 tcp:7420"))).toBe(false);
    usb.stop();
  });
  test("no adb: status says so and runs nothing", async () => {
    const f = fakeAdb();
    const usb = new AndroidUsb({ ...deps(f).d, which: () => null });
    const s = await usb.status();
    expect(s.adb).toBeNull();
    expect(f.calls).toEqual([]);
  });
});

describe("pairing without a PIN (USB)", () => {
  test("the same phone set up again replaces its entry", async () => {
    const { Pairing } = await import("../src/pairing");
    const { loadDevices } = await import("../src/config");
    const p = new Pairing(undefined, "111111");
    const a = await p.pairTrusted("SM-J710F", "SER-1");
    const b = await p.pairTrusted("SM-J710F", "SER-1");
    const mine = (await loadDevices()).filter((d) => d.usbSerial === "SER-1");
    expect(mine.length).toBe(1);
    expect(await p.findDevice(a.token)).toBeUndefined();
    expect((await p.findDevice(b.token))?.name).toBe("SM-J710F");
  });
});

describe("forgetting a USB phone", () => {
  test("puts back stay-awake and battery optimisation, and drops the cable link", async () => {
    const f = fakeAdb({ installed: 801, reverse: true });
    const usb = new AndroidUsb(withAdb(deps(f).d));
    expect(await usb.release("R58M", { stayOn: 2, battery: true })).toBe(true);
    const cmds = f.calls.map((c) => c.join(" "));
    expect(cmds).toContain("-s R58M shell settings put global stay_on_while_plugged_in 2");
    expect(cmds).toContain("-s R58M shell dumpsys deviceidle whitelist -app.nookdeck");
    expect(cmds).toContain("-s R58M reverse --remove tcp:7420");
  });
  test("nothing changed by setup: only the cable link goes", async () => {
    const f = fakeAdb({ installed: 801 });
    const usb = new AndroidUsb(withAdb(deps(f).d));
    expect(await usb.release("R58M", undefined)).toBe(true);
    const cmds = f.calls.map((c) => c.join(" "));
    expect(cmds.some((c) => c.includes("settings put") || c.includes("deviceidle"))).toBe(false);
    expect(cmds).toContain("-s R58M reverse --remove tcp:7420");
  });
  test("a phone that is unplugged or not allowed is left alone", async () => {
    const f = fakeAdb({ state: "unauthorized" });
    const usb = new AndroidUsb(withAdb(deps(f).d));
    expect(await usb.release("R58M", { stayOn: 2 })).toBe(false);
    expect(f.calls.map((c) => c.join(" "))).toEqual(["devices -l"]);
  });
  test("a stored value that is not a setting number is not sent", async () => {
    const f = fakeAdb();
    const usb = new AndroidUsb(withAdb(deps(f).d));
    await usb.release("R58M", { stayOn: "7; reboot" as unknown as number });
    expect(f.calls.some((c) => c.join(" ").includes("settings put"))).toBe(false);
  });
  test("setting the phone up again keeps the value from before the first setup", async () => {
    const { Pairing } = await import("../src/pairing");
    const { loadDevices } = await import("../src/config");
    const p = new Pairing(undefined, "111111");
    await p.pairTrusted("SM-G981B", "SER-U", { stayOn: 0, battery: true });
    await p.pairTrusted("SM-G981B", "SER-U", { stayOn: 7 }); // the first setup left 7
    expect((await loadDevices()).find((d) => d.usbSerial === "SER-U")?.usbUndo).toEqual({ stayOn: 0, battery: true });
  });
});

describe("deck inside the Android app", () => {
  test("the app is told the layout's orientation; a browser is not", async () => {
    const { askAppOrientation, inNookdeckApp } = await import("../web/deck/src/screen-logic");
    const got: string[] = [];
    expect(askAppOrientation({ NookdeckApp: { setOrientation: (o) => got.push(o) } }, "landscape")).toBe(true);
    expect(got).toEqual(["landscape"]);
    expect(askAppOrientation({}, "portrait")).toBe(false);
    expect(inNookdeckApp("Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36 NookdeckApp/0.7.3")).toBe(true);
    expect(inNookdeckApp("Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36")).toBe(false);
  });
});
