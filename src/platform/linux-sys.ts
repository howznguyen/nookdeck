/**
 * Pure helpers for the Linux platform (L5 of specs/linux-support): /proc/meminfo, nvidia-smi, xprintidle, .desktop
 * files and the icon theme lookup. linux.ts does the process and file calls around them.
 */
import { cleanGpu, type GpuStats } from "../stats";

// ---------- memory, GPU, idle ----------

/** Bytes in use: MemTotal - MemAvailable (what free(1) calls "used" plus buffers it cannot give back). */
export function parseMeminfo(text: string): number | undefined {
  const kb = (key: string) => {
    const m = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, "m").exec(text);
    return m ? Number(m[1]) : undefined;
  };
  const total = kb("MemTotal"), avail = kb("MemAvailable");
  if (total === undefined || avail === undefined || avail > total) return undefined;
  return (total - avail) * 1024;
}

/** /proc/meminfo -> file cache (Cached + Buffers + SReclaimable) and swap, in bytes; undefined when none is there. */
export function parseMeminfoDetail(text: string): { cached?: number; swapUsed?: number; swapTotal?: number } | undefined {
  const kb = (key: string) => {
    const m = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, "m").exec(text);
    return m ? Number(m[1]) : undefined;
  };
  const out: { cached?: number; swapUsed?: number; swapTotal?: number } = {};
  const cached = kb("Cached");
  if (cached !== undefined) out.cached = (cached + (kb("Buffers") ?? 0) + (kb("SReclaimable") ?? 0)) * 1024;
  const st = kb("SwapTotal"), sf = kb("SwapFree");
  if (st !== undefined && st > 0) { out.swapTotal = st * 1024; out.swapUsed = Math.max(0, st - (sf ?? st)) * 1024; }
  return Object.keys(out).length ? out : undefined;
}

export const NVIDIA_SMI_ARGS = ["--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,name", "--format=csv,noheader,nounits"];

/** The first GPU of `nvidia-smi --query-gpu=... --format=csv,noheader,nounits` (memory in MiB). */
export function parseNvidiaSmi(csv: string): GpuStats | undefined {
  const line = csv.split("\n").map((l) => l.trim()).find(Boolean);
  if (!line) return undefined;
  const [util, used, total, temp, ...name] = line.split(",").map((s) => s.trim());
  const mib = (v: string | undefined) => (v && /^\d+(\.\d+)?$/.test(v) ? Number(v) * 1024 * 1024 : undefined);
  const num = (v: string | undefined) => (v && /^\d+(\.\d+)?$/.test(v) ? Number(v) : undefined);
  return cleanGpu({ util: num(util), memUsed: mib(used), memTotal: mib(total), temp: num(temp), name: name.join(",") });
}

/** xprintidle prints milliseconds. */
export function parseXprintidle(out: string): number | null {
  const t = out.trim();
  return /^\d+$/.test(t) ? Math.floor(Number(t) / 1000) : null;
}

// ---------- XDG dirs ----------

/** Data dirs in priority order: XDG_DATA_HOME, XDG_DATA_DIRS (default /usr/local/share:/usr/share), then Flatpak and Snap exports. */
export function xdgDataDirs(env: Record<string, string | undefined>, home: string): string[] {
  const dirs = [env.XDG_DATA_HOME || `${home}/.local/share`, ...(env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":")];
  dirs.push(`${home}/.local/share/flatpak/exports/share`, "/var/lib/flatpak/exports/share", "/var/lib/snapd/desktop");
  const out: string[] = [];
  for (const d of dirs) {
    const clean = d.replace(/\/+$/, "");
    if (clean.startsWith("/") && !out.includes(clean)) out.push(clean);
  }
  return out;
}

// ---------- .desktop files ----------

export interface DesktopEntry {
  name: string;
  exec?: string;
  icon?: string;
  categories: string[];
  terminal: boolean;
}

/**
 * The [Desktop Entry] group of a .desktop file, or null when it is not an app a person launches: Type is not
 * Application, NoDisplay or Hidden is true, or OnlyShowIn / NotShowIn rule out this desktop.
 */
export function parseDesktopEntry(text: string, desktops: string[] = []): DesktopEntry | null {
  const kv: Record<string, string> = {};
  let inMain = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) { inMain = line === "[Desktop Entry]"; continue; }
    if (!inMain) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!(key in kv)) kv[key] = line.slice(eq + 1).trim();
  }
  if (kv.Type !== "Application" || !kv.Name) return null;
  if (kv.NoDisplay === "true" || kv.Hidden === "true") return null;
  const list = (v: string | undefined) => (v ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  const mine = desktops.map((d) => d.toLowerCase());
  const only = list(kv.OnlyShowIn).map((d) => d.toLowerCase());
  if (only.length && !only.some((d) => mine.includes(d))) return null;
  if (list(kv.NotShowIn).some((d) => mine.includes(d.toLowerCase()))) return null;
  return { name: unescape(kv.Name), exec: kv.Exec, icon: kv.Icon ? unescape(kv.Icon) : undefined, categories: list(kv.Categories), terminal: kv.Terminal === "true" };
}

function unescape(v: string): string {
  return v.replace(/\\([sntr\\])/g, (_, c: string) => ({ s: " ", n: "\n", t: "\t", r: "\r", "\\": "\\" })[c]!);
}

/** Desktop file id ("org.gnome.Nautilus.desktop", "kde-foo.desktop" for kde/foo.desktop) from its path under applications/. */
export function desktopFileId(relPath: string): string {
  return relPath.replace(/\//g, "-");
}

/** An id the rest of Nookdeck accepts as a bundle id (BUNDLE_ID_RE): the desktop file id without .desktop, other characters as "-". */
export function linuxAppId(desktopId: string): string | null {
  const id = desktopId.replace(/\.desktop$/, "").replace(/[^A-Za-z0-9.\-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 128);
  return id || null;
}

const CATEGORY: Array<[string, string]> = [
  ["Development", "developer-tools"], ["IDE", "developer-tools"],
  ["Game", "games"],
  ["Chat", "social-networking"], ["InstantMessaging", "social-networking"], ["IRCClient", "social-networking"],
  ["Audio", "music"], ["Music", "music"],
  ["Video", "video"], ["AudioVideo", "video"], ["Photography", "photography"], ["Graphics", "graphics-design"],
  ["Office", "productivity"], ["Email", "productivity"], ["WebBrowser", "productivity"], ["Education", "education"], ["Science", "education"],
  ["Settings", "system"], ["System", "system"],
  ["Utility", "utilities"], ["Network", "utilities"],
];

/** A public.app-category.* like macOS gives, from freedesktop Categories; null when none fits. */
export function desktopCategory(categories: string[]): string | null {
  for (const [c, cat] of CATEGORY) if (categories.includes(c)) return `public.app-category.${cat}`;
  return null;
}

// ---------- icons ----------

const SIZES = ["128x128", "256x256", "512x512", "192x192", "96x96", "64x64", "48x48", "scalable", "32x32"];

/**
 * Files that may hold the icon `name`, best first: hicolor (and other theme dirs given) at the sizes near 128 px,
 * PNG before SVG, then /usr/share/pixmaps. An absolute Icon= path is returned as is.
 */
export function iconCandidates(name: string, dataDirs: string[], home: string, themes: string[] = ["hicolor"]): string[] {
  if (name.startsWith("/")) return [name];
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-+]*$/.test(name)) return [];
  const bases = [`${home}/.icons`, ...dataDirs.map((d) => `${d}/icons`)];
  const out: string[] = [];
  for (const theme of themes) {
    for (const size of SIZES) {
      for (const b of bases) {
        if (size === "scalable") out.push(`${b}/${theme}/scalable/apps/${name}.svg`);
        else out.push(`${b}/${theme}/${size}/apps/${name}.png`);
      }
    }
  }
  for (const d of ["/usr/share/pixmaps", ...dataDirs.map((x) => `${x}/pixmaps`)]) {
    for (const ext of [".png", ".svg"]) {
      const p = `${d}/${name}${ext}`;
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

// ---------- artwork ----------

/** The local path of a file:// artwork URL, or null. */
export function fileUrlPath(url: string | undefined): string | null {
  if (!url || !/^file:\/\//i.test(url)) return null;
  try {
    const u = new URL(url);
    if (u.host && u.host !== "localhost") return null;
    const p = decodeURIComponent(u.pathname);
    return p.startsWith("/") && !p.includes("\0") ? p : null;
  } catch { return null; }
}

/** "image/png" / "image/jpeg" from magic bytes, else null. */
export function imageMime(b: Uint8Array): string | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}
