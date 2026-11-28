import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WIN } from "./_os";
import { LineSplitter, MR_COMMANDS, applyStreamLine, backoffMs, isPlaying, nowPlayingApp, positionAt, stateArtwork, stateToMedia } from "../src/mediaremote";
import { NowPlayingStream, extractAdapter, type StreamProc } from "../src/platform/mac-remote";

const SAFARI = {
  playbackRate: 1, album: "", elapsedTime: 0, timestamp: "2026-11-22T09:43:12Z", bundleIdentifier: "com.apple.WebKit.GPU",
  parentApplicationBundleIdentifier: "com.apple.Safari", processIdentifier: 95376, title: "Christmas Jazz", uniqueIdentifier: 414916,
  duration: 6960.56, artist: "라라상점", playing: true,
};
const line = (payload: object, diff = false) => JSON.stringify({ type: "data", diff, payload });
const T0 = Date.parse("2026-11-22T09:43:12Z");

describe("stream lines", () => {
  test("a full payload replaces the state, a diff merges, null deletes, an empty payload clears", () => {
    let s: Record<string, unknown> = {};
    const a = applyStreamLine(s, line(SAFARI));
    expect(a.kind === "state" && a.state.title).toBe("Christmas Jazz");
    s = (a as any).state;
    const b = applyStreamLine(s, line({ playing: false, elapsedTime: 41.5 }, true));
    s = (b as any).state;
    expect(s).toMatchObject({ title: "Christmas Jazz", playing: false, elapsedTime: 41.5 });
    const c = applyStreamLine(s, line({ artist: null, album: "X" }, true));
    s = (c as any).state;
    expect("artist" in s).toBe(false);
    expect(s.album).toBe("X");
    expect((applyStreamLine(s, line({}, false)) as any).state).toEqual({});
  });
  test("junk, other types and bad payloads are ignored", () => {
    for (const l of ["", "warning: x", "{not json", JSON.stringify({ type: "other", payload: {} }), JSON.stringify({ type: "data", payload: [] }), JSON.stringify({ type: "data", diff: false })]) {
      expect(applyStreamLine({ a: 1 }, l)).toEqual({ kind: "ignored" });
    }
  });
  test("LineSplitter keeps a partial line until it ends", () => {
    const sp = new LineSplitter();
    expect(sp.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(sp.push(":2}\n")).toEqual(['{"b":2}']);
  });
});

describe("position and media", () => {
  test("playing: elapsedTime at timestamp plus the time since, at the playback rate", () => {
    expect(positionAt({ ...SAFARI, elapsedTime: 10 }, T0 + 5000)).toBe(15);
    expect(positionAt({ ...SAFARI, elapsedTime: 10, playbackRate: 2 }, T0 + 5000)).toBe(20);
    expect(positionAt(SAFARI, T0 + 82_400)).toBeCloseTo(82.4, 1);
  });
  test("paused: frozen at elapsedTime; never past the duration; never negative", () => {
    expect(positionAt({ ...SAFARI, playing: false, elapsedTime: 33 }, T0 + 60_000)).toBe(33);
    expect(positionAt({ ...SAFARI, duration: 20 }, T0 + 60_000)).toBe(20);
    expect(positionAt({ ...SAFARI }, T0 - 5000)).toBe(0); // a clock a little behind the agent's
    expect(positionAt({ title: "t" }, T0)).toBe(0);
  });
  test("playing falls back to playbackRate when the flag is missing", () => {
    expect(isPlaying({ playbackRate: 1 })).toBe(true);
    expect(isPlaying({ playbackRate: 0 })).toBe(false);
    expect(isPlaying({ playing: false, playbackRate: 1 })).toBe(false);
  });
  test("stateToMedia builds the tile's media; no title and no artist means nothing", () => {
    expect(stateToMedia(SAFARI, T0 + 2000)).toEqual({ app: "Safari", title: "Christmas Jazz", artist: "라라상점", album: "", playing: true, position: 2, duration: 6960.56 });
    expect(stateToMedia({ playing: true }, T0)).toBeNull();
    expect(stateToMedia({}, T0)).toBeNull();
  });
  test("artwork comes from artworkData, whitespace removed", () => {
    expect(stateArtwork({ artworkData: "AB CD\n", artworkMimeType: "image/tiff" })).toEqual({ b64: "ABCD", mime: "image/tiff" });
    expect(stateArtwork({})).toBeUndefined();
  });
});

describe("app names", () => {
  test("the parent app wins for a browser's media process", () => {
    expect(nowPlayingApp("com.apple.WebKit.GPU", "com.apple.Safari")).toBe("Safari");
    expect(nowPlayingApp("com.google.Chrome.helper", "com.google.Chrome")).toBe("Chrome");
    expect(nowPlayingApp("com.brave.Browser")).toBe("Brave");
    expect(nowPlayingApp("com.spotify.client")).toBe("Spotify");
    expect(nowPlayingApp("com.apple.Music")).toBe("Music");
    expect(nowPlayingApp("com.brave.Browser.app.cinhimbnkkaeohfgghhklpknlkffjgod")).toBe("YouTube Music");
    expect(nowPlayingApp("com.google.Chrome.app.abc", "com.google.Chrome.app.cinhimbnkkaeohfgghhklpknlkffjgod")).toBe("YouTube Music");
  });
  test("unknown and missing ids", () => {
    expect(nowPlayingApp("com.example.Cool_Player")).toBe("Cool Player");
    expect(nowPlayingApp(undefined)).toBe("Now Playing");
    expect(nowPlayingApp("", "")).toBe("Now Playing");
  });
  test("command ids match the adapter's enum and backoff doubles up to 30 s", () => {
    expect(MR_COMMANDS).toEqual({ play: 0, pause: 1, playpause: 2, next: 4, previous: 5 });
    expect([1, 2, 3, 4, 10].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 30000]);
  });
});

// ---- the process wrapper, with a fake process ----

class FakeProc {
  killed = false;
  private ctl!: ReadableStreamDefaultController<Uint8Array>;
  private done!: (c: number) => void;
  stdout = new ReadableStream<Uint8Array>({ start: (c) => { this.ctl = c; } });
  exited = new Promise<number>((r) => { this.done = r; });
  emit(l: string) { this.ctl.enqueue(new TextEncoder().encode(l + "\n")); }
  die(code = 1) { try { this.ctl.close(); } catch { /* closed */ } this.done(code); }
  kill() { this.killed = true; this.die(0); }
}
const FILES = { perl: "/usr/bin/perl", framework: "/x/MediaRemoteAdapter.framework", script: "/x/a.pl" };
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function make(over: Partial<ConstructorParameters<typeof NowPlayingStream>[0]> = {}) {
  const procs: FakeProc[] = [];
  const argvs: string[][] = [];
  let now = T0;
  const s = new NowPlayingStream({
    files: async () => FILES,
    spawn: (argv) => { argvs.push(argv); const p = new FakeProc(); procs.push(p); return p as unknown as StreamProc; },
    now: () => now,
    idleMs: 10_000,
    firstMs: 50,
    backoff: (fn) => setTimeout(fn, 1), // the restart delay runs fast
    ...over,
  });
  return { s, procs, argvs, advance: (ms: number) => { now += ms; } };
}

describe("NowPlayingStream", () => {
  test("one long-lived process: started on the first read, never again per read", async () => {
    const { s, procs, argvs } = make();
    const first = s.read();
    await tick();
    procs[0]!.emit(line(SAFARI));
    expect(await first).toMatchObject({ app: "Safari", title: "Christmas Jazz", playing: true });
    await s.read(); await s.read();
    expect(procs.length).toBe(1);
    expect(argvs[0]).toEqual(["/usr/bin/perl", "/x/a.pl", "/x/MediaRemoteAdapter.framework", "stream", "--debounce=200"]);
    s.stop();
  });
  test("diffs update what the next read returns; the position keeps running between messages", async () => {
    const { s, procs, advance } = make();
    const p = s.read(); await tick(); procs[0]!.emit(line({ ...SAFARI, elapsedTime: 10 })); await p;
    advance(3000);
    expect((await s.read())!).toMatchObject({ position: 13 });
    procs[0]!.emit(line({ playing: false, elapsedTime: 14 }, true)); await tick();
    expect((await s.read())!).toMatchObject({ playing: false, position: 14 });
    procs[0]!.emit(line({}, false)); await tick();
    expect(await s.read()).toBeNull();
    s.stop();
  });
  test("exposes the cover of the current item", async () => {
    const { s, procs } = make();
    const p = s.read(); await tick(); procs[0]!.emit(line({ ...SAFARI, artworkData: "QUJD", artworkMimeType: "image/tiff" })); await p;
    expect(s.artwork()).toMatchObject({ b64: "QUJD", mime: "image/tiff" });
    expect(s.hasSession).toBe(true);
    s.stop();
  });
  test("no message at all: the first read returns after the wait with nothing playing", async () => {
    const { s } = make();
    expect(await s.read()).toBeNull();
    s.stop();
  });
  test("stops itself when nobody reads for a while", async () => {
    const { s, procs, advance } = make({ idleMs: 30 });
    const p = s.read(); await tick(); procs[0]!.emit(line(SAFARI)); await p;
    expect(s.running).toBe(true);
    advance(60_000);
    await tick(40);
    expect(procs[0]!.killed).toBe(true);
    expect(s.running).toBe(false);
    // a later read starts a new one
    const again = s.read(); await tick(); expect(procs.length).toBe(2); procs[1]!.emit(line(SAFARI)); await again;
    s.stop();
  });
  test("a process that dies is restarted; data resets the failure count", async () => {
    const { s, procs } = make();
    const p = s.read(); await tick(); procs[0]!.emit(line(SAFARI)); await p;
    procs[0]!.die(1);
    await tick(30);
    expect(procs.length).toBe(2);
    procs[1]!.emit(line(SAFARI)); await tick();
    expect(s.failureCount).toBe(0);
    s.stop();
  });
  test("after repeated failures it reports unavailable so the Spotify/Music reader takes over", async () => {
    const { s, procs } = make();
    const r1 = s.read(); await tick(); procs[0]!.die(1); await r1;
    for (let i = 1; i < 4 && !s.gaveUp; i++) { await tick(30); await s.read(); await tick(); procs[i]?.die(1); }
    await tick(30);
    expect(s.gaveUp).toBe(true);
    expect(await s.read()).toBe("unavailable");
  });
  test("no adapter in this build: unavailable at once, nothing spawned", async () => {
    const { s, procs } = make({ files: async () => null });
    expect(await s.read()).toBe("unavailable");
    expect(procs.length).toBe(0);
  });
  test("send runs one adapter command with the right id; false when no adapter", async () => {
    const calls: string[][] = [];
    const { s } = make({ once: async (argv) => { calls.push(argv); return true; } });
    expect(await s.send("next")).toBe(true);
    expect(await s.send("playpause")).toBe(true);
    expect(calls).toEqual([
      ["/usr/bin/perl", "/x/a.pl", "/x/MediaRemoteAdapter.framework", "send", "4"],
      ["/usr/bin/perl", "/x/a.pl", "/x/MediaRemoteAdapter.framework", "send", "2"],
    ]);
    expect(await make({ files: async () => null }).s.send("next")).toBe(false);
    expect(await make({ once: async () => false }).s.send("next")).toBe(false);
  });
});

describe("extractAdapter", () => {
  test("null without an embedded adapter", async () => {
    expect(await extractAdapter(null, join(mkdtempSync(join(tmpdir(), "pd-mra-")), "lib"))).toBeNull();
  });
  test("writes a versioned folder once, reuses it, replaces it when the content changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pd-mra-"));
    const bin = join(dir, "bin"); const pl = join(dir, "a.pl");
    writeFileSync(bin, "BINARY-ONE"); writeFileSync(pl, "#!/usr/bin/perl\n");
    const lib = join(dir, "lib");
    const a = await extractAdapter({ binary: bin, script: pl }, lib);
    expect(a!.framework.endsWith("MediaRemoteAdapter.framework")).toBe(true);
    expect(readFileSync(join(a!.framework, "MediaRemoteAdapter"), "utf8")).toBe("BINARY-ONE");
    if (!WIN) expect(statSync(join(a!.framework, "MediaRemoteAdapter")).mode & 0o111).not.toBe(0); // no exec bit on Windows
    const marker = join(a!.framework, "..", "marker"); writeFileSync(marker, "x");
    const again = await extractAdapter({ binary: bin, script: pl }, lib);
    expect(again).toEqual(a);
    expect(readdirSync(join(a!.framework, "..")).includes("marker")).toBe(true); // untouched: no re-extract
    writeFileSync(bin, "BINARY-TWO");
    const b = await extractAdapter({ binary: bin, script: pl }, lib);
    expect(b!.framework).not.toBe(a!.framework);
    expect(readFileSync(join(b!.framework, "MediaRemoteAdapter"), "utf8")).toBe("BINARY-TWO");
    expect(readdirSync(lib).filter((n) => n.startsWith("mediaremote-")).length).toBe(1); // the old version is gone
  });
});

describe.skipIf(WIN)("the adapter process never outlives the agent", () => {
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  // a stand-in adapter that writes its pid (the watcher execs it, so that pid is the one the watcher stops)
  const fake = (dir: string) => ["/bin/sh", "-c", `echo $$ > ${JSON.stringify(join(dir, "pid"))}; exec sleep 60`];
  const pidIn = async (dir: string) => {
    for (let i = 0; i < 60; i++) { const n = Number(readFileSafe(join(dir, "pid")).trim()); if (n > 0) return n; await Bun.sleep(50); }
    return 0;
  };
  const readFileSafe = (f: string) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };

  test("an agent killed with SIGKILL takes the adapter with it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nd-mr-"));
    const script = join(dir, "agent.ts");
    writeFileSync(script, `import { realStreamSpawn } from ${JSON.stringify(join(import.meta.dir, "../src/platform/mac-remote.ts"))};\nrealStreamSpawn(${JSON.stringify(fake(dir))});\nawait new Promise(() => {});\n`);
    const agent = Bun.spawn([process.execPath, script], { stdout: "ignore", stderr: "ignore" });
    const adapter = await pidIn(dir);
    expect(adapter).toBeGreaterThan(0);
    expect(alive(adapter)).toBe(true);
    agent.kill("SIGKILL");
    await agent.exited;
    for (let i = 0; i < 60 && alive(adapter); i++) await Bun.sleep(50);
    expect(alive(adapter)).toBe(false);
  });

  test("stopping it stops the adapter and leaves no watcher behind", async () => {
    const { realStreamSpawn } = await import("../src/platform/mac-remote");
    const dir = mkdtempSync(join(tmpdir(), "nd-mr-"));
    const p = realStreamSpawn(fake(dir));
    const adapter = await pidIn(dir);
    expect(adapter).toBeGreaterThan(0);
    p.kill();
    await p.exited;
    for (let i = 0; i < 40 && alive(adapter); i++) await Bun.sleep(50);
    expect(alive(adapter)).toBe(false);
    await Bun.sleep(200);
    expect(Bun.spawnSync(["pgrep", "-f", `nookdeck-mediaremote /bin/sh -c echo .* ${dir}`]).stdout.toString().trim()).toBe("");
  });
});

// ---- two browser tabs with media (recorded from a Chromium browser on 2026-11-28) ----

describe("two tabs: a diff with another tab's clock", () => {
  const PBN = { title: "PBN 65", artist: "Thuy Nga", duration: 417.201, elapsedTime: 222.57, playbackRate: 0, playing: false, bundleIdentifier: "com.ardia.browser", timestamp: "2026-11-27T19:00:23Z" };
  test("a duration change without a title is a mix; one with the title, or the same duration, is not", async () => {
    const { mixedDiff, parseGet } = await import("../src/mediaremote");
    expect(mixedDiff(PBN, line({ playbackRate: 1, elapsedTime: 0, duration: 1287.281 }, true))).toBe(true);
    expect(mixedDiff(PBN, line({ title: "Liên Khúc", duration: 1287.281 }, true))).toBe(false);
    expect(mixedDiff(PBN, line({ elapsedTime: 230, duration: 417.2 }, true))).toBe(false);
    expect(mixedDiff(PBN, line({ ...PBN, duration: 99 }, false))).toBe(false); // a full state replaces, nothing to mix
    expect(parseGet('{"title":"x","duration":5}\n')).toEqual({ title: "x", duration: 5 });
    expect(parseGet("nope")).toBeNull();
  });
  test("the tile reads the whole state again instead of pairing one tab's title with the other's time", async () => {
    const gets: string[][] = [];
    const truth = { ...PBN, elapsedTime: 317.56, playbackRate: 1, playing: true, timestamp: "2026-11-27T19:01:09Z" };
    const { s, procs } = make({ get: async (argv) => { gets.push(argv); return JSON.stringify(truth); } });
    const p = s.read(); await tick(); procs[0]!.emit(line(PBN)); await p;
    procs[0]!.emit(line({ playbackRate: 1, elapsedTime: 0, duration: 1287.281, timestamp: "2026-11-27T19:00:24Z" }, true));
    await tick(20);
    expect(gets).toEqual([["/usr/bin/perl", "/x/a.pl", "/x/MediaRemoteAdapter.framework", "get"]]);
    expect((await s.read())!).toMatchObject({ title: "PBN 65", duration: 417.201, playing: true });
    s.stop();
  });
});
