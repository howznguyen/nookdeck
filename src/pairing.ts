import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { loadDevices, saveDevices, type Device, type UsbUndo } from "./config";

export const MAX_FAILURES = 10;
/** A device token unused for this long stops working (the window slides on every connect). */
export const TOKEN_TTL_MS = 365 * 24 * 3600_000;
export const COOKIE_NAME = "pd_token";

export const expiryFrom = (t: number) => new Date(t + TOKEN_TTL_MS).toISOString();

/** True when the device has not connected for a year (older entries without expiresAt use lastSeen or createdAt). */
export function isExpired(d: Pick<Device, "expiresAt" | "lastSeen" | "createdAt">, now = Date.now()): boolean {
  const end = d.expiresAt ? Date.parse(d.expiresAt) : Date.parse(d.lastSeen ?? d.createdAt) + TOKEN_TTL_MS;
  return Number.isFinite(end) && now > end;
}

/** HttpOnly, one year, sliding: plain http on the LAN, so no Secure. */
export const tokenCookie = (token: string) => `${COOKIE_NAME}=${token}; Path=/; Max-Age=${TOKEN_TTL_MS / 1000}; HttpOnly; SameSite=Lax`;

export function cookieToken(header: string | null | undefined): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE_NAME) return part.slice(i + 1).trim() || undefined;
  }
  return undefined;
}

let devicesChain: Promise<unknown> = Promise.resolve();
/** Serializes read-modify-write cycles on devices.json (concurrent saves share one .tmp file). */
export function withDevicesLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = devicesChain.then(fn, fn);
  devicesChain = run.catch(() => {});
  return run;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export function newPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export class Pairing {
  pin: string;
  failures = 0;

  constructor(private onPinChange?: (pin: string) => void, initialPin?: string) {
    this.pin = initialPin ?? newPin();
  }

  regenerate(): string {
    this.pin = newPin();
    this.failures = 0;
    this.onPinChange?.(this.pin);
    return this.pin;
  }

  /** Returns a new device + plaintext token on success, or null on a bad PIN. */
  async pair(pin: unknown, name: unknown): Promise<{ token: string; deviceId: string } | null> {
    if (typeof pin !== "string" || !safeEqual(pin, this.pin)) {
      if (++this.failures >= MAX_FAILURES) this.regenerate();
      return null;
    }
    this.failures = 0;
    return this.addDevice(name);
  }

  /**
   * A device without the PIN, for a phone set up over USB: the cable and the phone's "Allow USB debugging" prompt stand in for it.
   * Only the localhost-only Android setup route calls this. The same adb serial set up again replaces its earlier entry.
   */
  async pairTrusted(name: unknown, usbSerial: string, undo?: UsbUndo): Promise<{ token: string; deviceId: string }> {
    return this.addDevice(name, usbSerial, undo);
  }

  private async addDevice(name: unknown, usbSerial?: string, undo?: UsbUndo): Promise<{ token: string; deviceId: string }> {
    const token = newToken();
    const device: Device = {
      id: randomBytes(8).toString("hex"),
      name: typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : "Phone",
      tokenHash: hashToken(token),
      createdAt: new Date().toISOString(),
      expiresAt: expiryFrom(Date.now()),
      ...(usbSerial ? { usbSerial } : {}),
    };
    await withDevicesLock(async () => {
      const all = await loadDevices();
      // setting the same phone up again keeps the value from before the first setup, not the one the first setup left behind
      const prev = usbSerial ? all.find((d) => d.usbSerial === usbSerial)?.usbUndo : undefined;
      const stayOn = prev?.stayOn ?? undo?.stayOn;
      const battery = !!(prev?.battery || undo?.battery);
      if (stayOn !== undefined || battery) device.usbUndo = { ...(stayOn !== undefined ? { stayOn } : {}), ...(battery ? { battery } : {}) };
      const devices = all.filter((d) => !usbSerial || d.usbSerial !== usbSerial);
      devices.push(device);
      await saveDevices(devices);
    });
    return { token, deviceId: device.id };
  }

  /** The device owning a token, unless it has expired. */
  async findDevice(token: string | null | undefined, now = Date.now()): Promise<Device | undefined> {
    if (!token) return undefined;
    const h = hashToken(token);
    const devices = await loadDevices();
    const d = devices.find((x) => safeEqual(x.tokenHash, h));
    return d && !isExpired(d, now) ? d : undefined;
  }
}
