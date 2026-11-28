/**
 * A small zip reader for Google's Platform Tools archive: stored and deflated entries, no zip64, no encryption. Enough for that one
 * file on every OS (GNU tar on Linux cannot read zip, and not every Linux has unzip). Entry names that climb out of the target
 * folder are refused.
 */
import { inflateRawSync } from "node:zlib";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export interface ZipEntry { name: string; data: Uint8Array; /** unix mode from the external attributes, 0 when none */ mode: number }

export function readZip(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // the end of central directory record: the last 0x06054b50 within the final 64 KiB + 22 bytes
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("broken zip directory");
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const ext = dv.getUint32(p + 38, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (dv.getUint32(local, true) !== 0x04034b50) throw new Error("broken zip entry");
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? new Uint8Array(inflateRawSync(raw)) : null;
    if (!data) throw new Error(`zip entry ${name} uses an unknown compression (${method})`);
    out.push({ name, data, mode: (ext >>> 16) & 0o777 });
  }
  return out;
}

/** Writes every entry under `dir`, keeping the executable bit. */
export async function extractZip(buf: Uint8Array, dir: string): Promise<string[]> {
  const root = resolve(dir);
  const written: string[] = [];
  for (const e of readZip(buf)) {
    const target = resolve(join(root, e.name));
    if (target !== root && !target.startsWith(root + sep)) throw new Error(`zip entry ${e.name} points outside the folder`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, e.data);
    if (e.mode & 0o111) await chmod(target, 0o755).catch(() => {});
    written.push(target);
  }
  return written;
}
