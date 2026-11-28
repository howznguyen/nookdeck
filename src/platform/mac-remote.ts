/**
 * Now Playing for every app on macOS 15.4+, through ungive/mediaremote-adapter (BSD-3, vendor/mediaremote-adapter): Apple only lets
 * Apple-signed processes use MediaRemote, so the adapter is a dylib that /usr/bin/perl (an Apple binary) loads. One long-lived
 * `perl adapter.pl <framework> stream` process feeds an in-memory state; reads never spawn anything. It runs only while the media
 * loop asks for it (a phone is connected) and stops itself a few seconds after the last read.
 */
import { chmod, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { HOME } from "../config";
import type { RawMedia } from "../media";
import {
  LineSplitter, MAX_STREAM_FAILURES, MR_COMMANDS, applyStreamLine, backoffMs, mixedDiff, parseGet, stateArtwork, stateToMedia,
  type MrCommand, type NowPlayingState,
} from "../mediaremote";

export const PERL = "/usr/bin/perl";

export interface AdapterFiles { perl: string; framework: string; script: string }

export interface EmbeddedAdapter { binary: string; script: string }

/**
 * Writes the embedded adapter to <lib>/mediaremote-<hash>/ (once per version: the folder name carries the hash of both files, so a
 * changed adapter lands in a new folder and an existing one is reused). Returns null when this build has no adapter.
 */
export async function extractAdapter(embed: EmbeddedAdapter | null, lib = join(HOME, "lib")): Promise<AdapterFiles | null> {
  if (!embed) return null;
  const binary = new Uint8Array(await Bun.file(embed.binary).arrayBuffer());
  const script = new Uint8Array(await Bun.file(embed.script).arrayBuffer());
  const hash = createHash("sha256").update(binary).update("\0").update(script).digest("hex").slice(0, 12);
  const dir = join(lib, `mediaremote-${hash}`);
  const framework = join(dir, "MediaRemoteAdapter.framework");
  const bin = join(framework, "MediaRemoteAdapter");
  const pl = join(dir, "mediaremote-adapter.pl");
  const ok = async () => (await stat(bin).then((s) => s.size === binary.length, () => false)) && (await stat(pl).then((s) => s.size === script.length, () => false));
  if (!(await ok())) {
    const tmp = `${dir}.tmp-${process.pid}`;
    await rm(tmp, { recursive: true, force: true });
    await mkdir(join(tmp, "MediaRemoteAdapter.framework"), { recursive: true, mode: 0o700 });
    await writeFile(join(tmp, "MediaRemoteAdapter.framework", "MediaRemoteAdapter"), binary);
    await writeFile(join(tmp, "mediaremote-adapter.pl"), script);
    await chmod(join(tmp, "MediaRemoteAdapter.framework", "MediaRemoteAdapter"), 0o755);
    await chmod(join(tmp, "mediaremote-adapter.pl"), 0o644);
    await rm(dir, { recursive: true, force: true });
    await rename(tmp, dir);
    // the file carries its ad-hoc signature from the build; sign again only when it does not verify (a copy can lose it)
    try {
      const v = Bun.spawnSync(["codesign", "--verify", bin], { stdout: "ignore", stderr: "ignore" });
      if (v.exitCode !== 0) Bun.spawnSync(["codesign", "--force", "-s", "-", bin], { stdout: "ignore", stderr: "ignore" });
    } catch { /* no codesign here: nothing to do */ }
    // older versions are no longer needed
    for (const name of await readdir(lib).catch(() => [] as string[])) {
      if (name.startsWith("mediaremote-") && name !== `mediaremote-${hash}`) await rm(join(lib, name), { recursive: true, force: true }).catch(() => {});
    }
  }
  return { perl: PERL, framework, script: pl };
}

export interface StreamProc {
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}
export type StreamSpawn = (argv: string[]) => StreamProc;

/**
 * The adapter only writes when Now Playing changes, so an agent that died without stopping it (SIGKILL, a killed test run) left it
 * running for good. A watcher holds our stdin pipe: when this process is gone the pipe closes and the watcher stops the adapter
 * (`$$` is the adapter itself after `exec`). The pipe goes through fd 3: dash gives a background job /dev/null as its stdin.
 * Stopping it ourselves closes the pipe too, so the watcher never outlives it.
 */
export const WATCHED = ["/bin/sh", "-c", 'exec 3<&0; (cat <&3 >/dev/null; kill $$ 2>/dev/null) & exec "$@" </dev/null 3<&-', "nookdeck-mediaremote"];

export const realStreamSpawn: StreamSpawn = (argv) => {
  const p = Bun.spawn([...WATCHED, ...argv], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  const close = () => { try { p.stdin.end(); } catch { /* closed */ } };
  void p.exited.then(close, close);
  return { stdout: p.stdout as ReadableStream<Uint8Array>, exited: p.exited, kill: () => { try { p.kill(); } catch { /* gone */ } close(); } };
};

export interface RemoteDeps {
  files: () => Promise<AdapterFiles | null>;
  spawn?: StreamSpawn;
  now?: () => number;
  /** Run a one-shot adapter command (send); resolves true on exit 0. */
  once?: (argv: string[]) => Promise<boolean>;
  /** The stream stops when nobody has read for this long (ms). */
  idleMs?: number;
  /** How long the first read waits for the stream's first message (ms). */
  firstMs?: number;
  /** Runs the adapter's one-shot `get` and returns its stdout, or null (tests). */
  get?: (argv: string[]) => Promise<string | null>;
  /** Schedules the restart after a failure (tests run it at once). */
  backoff?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

const realOnce = async (argv: string[]): Promise<boolean> => {
  try {
    const p = Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    const timer = setTimeout(() => p.kill(), 4000);
    const code = await p.exited;
    clearTimeout(timer);
    return code === 0;
  } catch { return false; }
};

const realGet = async (argv: string[]): Promise<string | null> => {
  try {
    const p = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => p.kill(), 4000);
    const out = await new Response(p.stdout).text();
    const code = await p.exited;
    clearTimeout(timer);
    return code === 0 ? out : null;
  } catch { return null; }
};

/** "unavailable": the adapter cannot be used (not in this build, perl missing, or it kept dying): use the Spotify/Music reader. */
export type RemoteRead = RawMedia | null | "unavailable";

export class NowPlayingStream {
  private state: NowPlayingState = {};
  private proc: StreamProc | undefined;
  private gen = 0;
  private lastUse = 0;
  private failures = 0;
  private gotData = false;
  private startedAt = 0;
  private waiter: (() => void) | undefined;
  private idleTimer: ReturnType<typeof setInterval> | undefined;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private startPromise: Promise<void> | undefined;
  private down = false; // gave up for good
  private artKey = "";
  private refreshing: Promise<void> | undefined;
  private readonly now: () => number;

  constructor(private deps: RemoteDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** True while the stream process is supposed to be running. */
  get running(): boolean { return !!this.proc; }
  get gaveUp(): boolean { return this.down; }
  get failureCount(): number { return this.failures; }

  async read(): Promise<RemoteRead> {
    if (this.down) return "unavailable";
    this.lastUse = this.now();
    this.armIdle();
    if (!this.proc && !this.restartTimer) await this.start();
    if (this.down) return "unavailable";
    if (!this.gotData && this.proc) await this.firstMessage();
    if (this.down) return "unavailable";
    return stateToMedia(this.state, this.now());
  }

  /** The cover of the current item as base64 + mime, with a key that changes when the cover does. */
  artwork(): { b64: string; mime: string; key: string } | undefined {
    const a = stateArtwork(this.state);
    return a ? { ...a, key: `${this.state.uniqueIdentifier ?? ""}|${a.b64.length}` } : undefined;
  }

  /** The app that owns the current item has a now-playing session (controls can target it). */
  get hasSession(): boolean {
    return this.gotData && !!this.state.title;
  }

  /** Sends a transport command to the now playing app. Resolves true when the adapter accepted it. */
  async send(cmd: MrCommand): Promise<boolean> {
    const files = await this.deps.files().catch(() => null);
    if (!files) return false;
    return (this.deps.once ?? realOnce)([files.perl, files.script, files.framework, "send", String(MR_COMMANDS[cmd])]);
  }

  stop(): void {
    this.gen++;
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.idleTimer = this.restartTimer = undefined;
    const p = this.proc;
    this.proc = undefined;
    this.gotData = false;
    this.state = {};
    this.wake();
    p?.kill();
  }

  private armIdle(): void {
    if (this.idleTimer) return;
    const idle = this.deps.idleMs ?? 10_000;
    const every = Math.max(10, Math.min(5000, idle / 2));
    this.idleTimer = setInterval(() => { if (this.now() - this.lastUse > idle) this.stop(); }, every);
    (this.idleTimer as any).unref?.();
  }

  private wake(): void {
    const w = this.waiter;
    this.waiter = undefined;
    w?.();
  }

  private firstMessage(): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => { this.waiter = undefined; resolve(); }, this.deps.firstMs ?? 2000);
      this.waiter = () => { clearTimeout(timer as any); resolve(); };
    });
  }

  private start(): Promise<void> {
    return (this.startPromise ??= this.spawnNow().finally(() => { this.startPromise = undefined; }));
  }

  private async spawnNow(): Promise<void> {
    const files = await this.deps.files().catch(() => null);
    if (!files) { this.down = true; return; }
    const gen = ++this.gen;
    let proc: StreamProc;
    try {
      proc = (this.deps.spawn ?? realStreamSpawn)([files.perl, files.script, files.framework, "stream", "--debounce=200"]);
    } catch { this.failed(gen); return; }
    this.proc = proc;
    this.gotData = false;
    this.state = {};
    this.startedAt = this.now();
    void this.pump(proc, gen);
  }

  private async pump(proc: StreamProc, gen: number): Promise<void> {
    const split = new LineSplitter();
    const dec = new TextDecoder();
    try {
      const reader = proc.stdout.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (gen !== this.gen) return;
        for (const line of split.push(dec.decode(value, { stream: true }))) {
          const mixed = mixedDiff(this.state, line);
          const ev = applyStreamLine(this.state, line);
          if (ev.kind !== "state") continue;
          this.state = ev.state;
          if (mixed) void this.refresh(gen);
          this.gotData = true;
          this.failures = 0;
          this.wake();
        }
      }
    } catch { /* treated as the process ending */ }
    await proc.exited.catch(() => 1);
    if (gen !== this.gen) return; // stopped on purpose
    this.proc = undefined;
    this.gotData = false;
    this.state = {};
    this.failed(gen);
    this.wake();
  }

  /**
   * Reads the whole state again with a one-shot `get` (about 0.1 s) after a diff that would mix two items, so the title, position
   * and duration on the tile come from one item. One read at a time; diffs that come meanwhile are merged as usual.
   */
  private refresh(gen: number): Promise<void> {
    return (this.refreshing ??= (async () => {
      try {
        const files = await this.deps.files().catch(() => null);
        if (!files) return;
        const out = await (this.deps.get ?? realGet)([files.perl, files.script, files.framework, "get"]);
        const fresh = out ? parseGet(out) : null;
        if (fresh && gen === this.gen && this.proc) this.state = fresh;
      } finally {
        this.refreshing = undefined;
      }
    })());
  }

  /** The process ended (or never started) without being stopped: back off and restart, or give up. */
  private failed(gen: number): void {
    if (gen !== this.gen) return;
    this.proc = undefined;
    this.failures++;
    if (this.failures >= MAX_STREAM_FAILURES) { this.down = true; return; }
    if (this.restartTimer) return;
    const wait = backoffMs(this.failures);
    this.restartTimer = ((this.deps.backoff ?? setTimeout) as NonNullable<RemoteDeps["backoff"]>)(() => {
      this.restartTimer = undefined;
      if (this.now() - this.lastUse <= (this.deps.idleMs ?? 10_000)) void this.start();
    }, wait);
    (this.restartTimer as any)?.unref?.();
  }
}
