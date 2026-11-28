import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

// These tests run the real shell scripts (several processes, some deliberate 2-3 s waits). Bun's 5 s default fails them on a busy machine; these are upper bounds only, an idle machine is as fast as before.
setDefaultTimeout(90_000);

// setup.sh / uninstall.sh against a temp release directory and a temp install home. launchctl is `echo`, and every
// directory the binary touches is inside the sandbox: never the real ~/.nookdeck, ~/.claude or ~/Library/LaunchAgents.
const root = join(import.meta.dir, "..");
const mac = process.platform === "darwin";
const linux = process.platform === "linux";
/** setup.sh / uninstall.sh run on macOS and Linux; what is launchd-, codesign- or PhoneDesk-specific stays macOS-only */
const unix = mac || linux;
const osTag = mac ? "darwin" : "linux";
const fetching = (gz: boolean) => new RegExp(`Fetching nookdeck-${osTag}-(arm64|x64)${gz ? "\\.gz" : ""} \\(\\d+ MB\\)`);
const sandbox = mkdtempSync(join(tmpdir(), "pd-inst-"));
const spawned: number[] = [];
/** Every fake home: setup.sh may start an agent there (detached, ppid 1), and a test that fails or times out never records its pid. */
const homes: string[] = [];
/** Stops every agent these tests started: the recorded pids plus whatever agent.pid each fake home holds, even after a failed test. */
function stopAgents() {
  const pids = new Set(spawned);
  for (const h of homes) {
    try { const p = Number(readFileSync(join(h, ".nookdeck", "agent.pid"), "utf8")); if (p > 0) pids.add(p); } catch { /* no agent there */ }
  }
  for (const pid of pids) try { process.kill(pid, "SIGTERM"); } catch { /* gone */ }
  // the agent's media helper (perl) exits with it; anything still alive after a moment gets SIGKILL
  const until = Date.now() + 1500;
  for (const pid of pids) {
    while (Date.now() < until) { try { process.kill(pid, 0); } catch { break; } Bun.sleepSync(50); }
    try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
  }
  spawned.length = 0;
  homes.length = 0;
}
afterAll(stopAgents);
// also when the runner is interrupted or stops the file early
process.on("exit", stopAgents);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => { stopAgents(); process.exit(130); });

const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const bunPath = process.execPath;

/** A "release": nookdeck-<os>-arm64/x64 are wrappers that run this checkout's real CLI, plus SHA256SUMS. */
function makeRelease(opts: { tamper?: boolean; omit?: boolean; gz?: "good" | "bad-sum" | "no-file" | "bad-content"; variant?: string } = {}) {
  const dir = mkdtempSync(join(sandbox, "release-"));
  const lines: string[] = [];
  for (const arch of ["arm64", "x64"]) {
    const f = join(dir, `nookdeck-${osTag}-${arch}`);
    writeFileSync(f, `#!/bin/bash\nexec "${bunPath}" "${join(root, "src", "index.ts")}" "$@"\n${opts.variant ? `# ${opts.variant}\n` : ""}`);
    chmodSync(f, 0o755);
    lines.push(`${opts.tamper ? "0".repeat(64) : sha(f)}  nookdeck-${osTag}-${arch}`);
    if (opts.gz) {
      const g = `${f}.gz`;
      // "bad-content": a valid, correctly summed gzip whose content is not the listed binary
      writeFileSync(g, gzipSync(opts.gz === "bad-content" ? Buffer.from("#!/bin/bash\necho nookdeck 9.9.9\n") : readFileSync(f)));
      lines.push(`${opts.gz === "bad-sum" ? "0".repeat(64) : sha(g)}  nookdeck-${osTag}-${arch}.gz`);
      if (opts.gz === "no-file") rmSync(g);
    }
  }
  writeFileSync(join(dir, "SHA256SUMS"), (opts.omit ? "" : lines.join("\n")) + "\n");
  return dir;
}

async function freePort(): Promise<number> {
  const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const p = s.port;
  s.stop(true);
  return p;
}

function env(home: string, release: string, extra: Record<string, string> = {}) {
  return {
    PATH: process.env.PATH!, TMPDIR: sandbox, SHELL: "/bin/zsh", // the PATH step picks the rc file from $SHELL: pin it so CI (bash) matches
    HOME: join(home, "fake-home"), // anything that falls back to $HOME stays in the sandbox too
    NOOKDECK_INSTALL_HOME: home, NOOKDECK_RELEASE_BASE: release, NOOKDECK_LAUNCHCTL: "echo", NOOKDECK_SYSTEMCTL: "echo",
    ...extra,
  };
}
const sh = (script: string, args: string[], e: Record<string, string>) => Bun.spawnSync(["bash", join(root, script), ...args], { env: e, stdout: "pipe", stderr: "pipe", stdin: new Blob([""]) });
const out = (r: ReturnType<typeof sh>) => r.stdout.toString() + r.stderr.toString();
const newHome = () => { const h = mkdtempSync(join(sandbox, "home-")); mkdirSync(join(h, "fake-home"), { recursive: true }); homes.push(h); return h; };

describe.skipIf(!unix)("setup.sh: compressed assets", () => {
  const run = (release: string, home = newHome()) => ({ home, r: sh("setup.sh", ["--yes", "--no-autostart", "--no-start", "--no-open"], env(home, release)) });
  test("a release with gzip assets: downloads the .gz with its size, verifies it, unpacks, verifies the binary too", () => {
    const { home, r } = run(makeRelease({ gz: "good" }));
    const text = out(r);
    expect(r.exitCode, text).toBe(0);
    expect(text).toMatch(fetching(true));
    expect(text.match(/checksum ok/g)?.length).toBe(2); // the .gz, then the unpacked binary
    expect(existsSync(join(home, ".nookdeck", "bin", "nookdeck"))).toBe(true);
  });
  test("over http: the size comes from HEAD, and a download cut in the middle continues with a Range request", async () => {
    const release = makeRelease({ gz: "good" });
    const hits: string[] = [];
    let cut = false;
    const server = createServer((req, res) => {
      const name = (req.url ?? "").slice(1);
      const f = join(release, name);
      if (!existsSync(f)) { res.writeHead(404).end("no"); return; }
      const body = readFileSync(f);
      const range = /bytes=(\d+)-/.exec(String(req.headers.range ?? ""));
      hits.push(`${req.method} ${name}${range ? " " + req.headers.range : ""}`);
      if (req.method === "HEAD") { res.writeHead(200, { "content-length": body.length }).end(); return; }
      if (range) { res.writeHead(206, { "content-length": body.length - Number(range[1]), "content-range": `bytes ${range[1]}-${body.length - 1}/${body.length}` }).end(body.subarray(Number(range[1]))); return; }
      if (name.endsWith(".gz") && !cut) {
        cut = true; // promise everything, deliver half, then drop the connection
        res.writeHead(200, { "content-length": body.length });
        res.write(body.subarray(0, Math.floor(body.length / 2)));
        setTimeout(() => res.socket?.destroy(), 50);
        return;
      }
      res.writeHead(200, { "content-length": body.length }).end(body);
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const port = (server.address() as any).port as number;
    try {
      const home = newHome();
      // env() carries NOOKDECK_INSTALL_HOME: a temp home
      const r = await Bun.spawn(["bash", join(root, "setup.sh"), "--yes", "--no-autostart", "--no-start", "--no-open"], { env: env(home, `http://127.0.0.1:${port}`), stdout: "pipe", stderr: "pipe", stdin: new Blob([""]) });
      const text = (await new Response(r.stdout).text()) + (await new Response(r.stderr).text());
      expect(await r.exited, text).toBe(0);
      expect(text).toMatch(fetching(true));
      expect(text).toContain("resuming from where it stopped");
      expect(hits.some((h) => h.startsWith("HEAD ") && h.includes(".gz"))).toBe(true);
      expect(hits.some((h) => /GET .*\.gz bytes=\d+-/.test(h))).toBe(true);
      expect(existsSync(join(home, ".nookdeck", "bin", "nookdeck"))).toBe(true);
    } finally { server.close(); }
  });
  test("an older release without gzip assets still installs from the plain binary", () => {
    const { r } = run(makeRelease());
    const text = out(r);
    expect(r.exitCode, text).toBe(0);
    expect(text).not.toContain(".gz");
    expect(text).toMatch(fetching(false));
    expect(text.match(/checksum ok/g)?.length).toBe(1);
  });
  test("the .gz is listed but cannot be downloaded: falls back to the plain binary", () => {
    const { r } = run(makeRelease({ gz: "no-file" }));
    const text = out(r);
    expect(r.exitCode, text).toBe(0);
    expect(text).toContain("falling back to the uncompressed binary");
  });
  test("a .gz that does not match SHA256SUMS is refused, nothing is installed", () => {
    const { home, r } = run(makeRelease({ gz: "bad-sum" }));
    expect(r.exitCode).not.toBe(0);
    expect(out(r)).toContain("checksum mismatch");
    expect(existsSync(join(home, ".nookdeck", "bin", "nookdeck"))).toBe(false);
  });
  test("an intact .gz whose content is not the listed binary is refused after unpacking", () => {
    const { home, r } = run(makeRelease({ gz: "bad-content" }));
    expect(r.exitCode).not.toBe(0);
    expect(out(r)).toContain("checksum mismatch");
    expect(existsSync(join(home, ".nookdeck", "bin", "nookdeck"))).toBe(false);
  });
});

describe.skipIf(!unix)("setup.sh", () => {
  test("downloads, verifies, installs, starts the agent, prints the phone URL and PIN; running it again updates", async () => {
    const home = newHome();
    const release = makeRelease();
    const port = await freePort();
    // an installed Claude hook that points at an older binary is re-pointed at the new one
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { PermissionRequest: [{ hooks: [{ type: "command", command: `'/old/place/nookdeck' hook claude --port ${port} --home '${join(home, ".nookdeck")}' # nookdeck hook`, timeout: 60 }] }] } }));

    const r = sh("setup.sh", ["--yes", "--no-autostart", "--no-open", "--port", String(port)], env(home, release));
    const text = out(r);
    expect(r.exitCode, text).toBe(0);
    const bin = join(home, ".nookdeck", "bin", "nookdeck");
    expect(existsSync(bin)).toBe(true);
    expect(statSync(bin).mode & 0o111).not.toBe(0);
    expect(text).toContain("checksum ok");
    expect(text).toMatch(/nookdeck \d+\.\d+\.\d+/);
    expect(text).toContain(`http://localhost:${port}/manage/`);
    const pin = /PIN\s+(\d{6})/.exec(text)?.[1];
    expect(pin).toBeDefined();
    expect(text).toMatch(new RegExp(`Phone\\s+http://[^\\s]+:${port}`));
    const pid = Number(readFileSync(join(home, ".nookdeck", "agent.pid"), "utf8"));
    spawned.push(pid);

    // the agent really answers, with that PIN, and its data lives in the sandbox
    const info = await (await fetch(`http://127.0.0.1:${port}/api/pairing`)).json() as any;
    expect(info.pin).toBe(pin);
    expect(existsSync(join(home, ".nookdeck"))).toBe(true);
    const hook = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")).hooks.PermissionRequest[0].hooks[0].command as string;
    expect(hook).not.toContain("/old/place");
    expect(hook).toContain("hook claude");
    expect(existsSync(join(home, ".claude", "settings.json.nookdeck.bak"))).toBe(true);

    // update: the same command again stops the running agent, replaces the binary and starts a new one
    const port2 = await freePort();
    const r2 = sh("setup.sh", ["--yes", "--no-autostart", "--no-open", "--force", "--port", String(port2)], env(home, release)); // --force: the same release again
    expect(r2.exitCode, out(r2)).toBe(0);
    expect(out(r2)).toContain("upgrading from nookdeck");
    const pid2 = Number(readFileSync(join(home, ".nookdeck", "agent.pid"), "utf8"));
    spawned.push(pid2);
    expect(pid2).not.toBe(pid);
    await Bun.sleep(300);
    await expect(fetch(`http://127.0.0.1:${port}/api/pairing`)).rejects.toThrow(); // the old one is gone
    expect((await fetch(`http://127.0.0.1:${port2}/api/pairing`)).status).toBe(200);
    expect(existsSync(join(home, ".nookdeck", "bin", ".nookdeck.new"))).toBe(false);
  }, 120_000);

  test.skipIf(!mac)("autostart: the launchd plist is written under the install home (launchctl is echo); --no-start leaves the agent off", () => {
    const home = newHome();
    const release = makeRelease();
    const r = sh("setup.sh", ["--yes", "--no-start", "--no-open", "--port", "7533"], env(home, release));
    expect(r.exitCode, out(r)).toBe(0);
    const plist = join(home, "Library", "LaunchAgents", "dev.nookdeck.agent.plist");
    expect(existsSync(plist)).toBe(true);
    expect(readFileSync(plist, "utf8")).toContain("<string>7533</string>");
    expect(readFileSync(plist, "utf8")).toContain(join(home, ".nookdeck"));
    expect(existsSync(join(home, ".nookdeck", "agent.pid"))).toBe(false);
  }, 90_000);

  test("a checksum mismatch is refused and nothing is installed", () => {
    const home = newHome();
    const r = sh("setup.sh", ["--yes", "--no-autostart", "--no-open", "--no-start"], env(home, makeRelease({ tamper: true })));
    expect(r.exitCode).not.toBe(0);
    expect(out(r)).toContain("checksum mismatch");
    expect(existsSync(join(home, ".nookdeck", "bin"))).toBe(false);
  });

  test("a binary missing from SHA256SUMS is refused", () => {
    const home = newHome();
    const r = sh("setup.sh", ["--yes", "--no-autostart", "--no-open", "--no-start"], env(home, makeRelease({ omit: true })));
    expect(r.exitCode).not.toBe(0);
    expect(out(r)).toContain("has no entry in SHA256SUMS");
    expect(existsSync(join(home, ".nookdeck", "bin"))).toBe(false);
  });

  test("a missing download is a clear error", () => {
    const home = newHome();
    const r = sh("setup.sh", ["--yes", "--no-start"], env(home, join(sandbox, "no-such-release")));
    expect(r.exitCode).not.toBe(0);
    expect(out(r)).toContain("could not fetch");
  });

  test("--dry-run verifies but changes nothing", () => {
    const home = newHome();
    const r = sh("setup.sh", ["--dry-run", "--yes"], env(home, makeRelease()));
    expect(r.exitCode, out(r)).toBe(0);
    expect(out(r)).toContain("dry run");
    expect(existsSync(join(home, ".nookdeck"))).toBe(false);
    expect(existsSync(join(home, "Library"))).toBe(false);
  });

  test("bad options are errors", () => {
    const home = newHome();
    expect(out(sh("setup.sh", ["--wat"], env(home, makeRelease())))).toContain("unrecognised flag");
    expect(sh("setup.sh", ["--port", "abc"], env(home, makeRelease())).exitCode).not.toBe(0);
    expect(sh("setup.sh", ["--help"], env(home, makeRelease())).stdout.toString()).toContain("--no-autostart");
  });
});

describe.skipIf(!mac)("uninstall.sh", () => {
  test("removes the service, our hooks (with a backup) and the program; keeps data; --purge deletes it", async () => {
    const home = newHome();
    const release = makeRelease();
    mkdirSync(join(home, ".claude"), { recursive: true });
    const other = { hooks: { Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }] } };
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify(other));
    const inst = sh("setup.sh", ["--yes", "--no-start", "--no-open"], env(home, release));
    expect(inst.exitCode, out(inst)).toBe(0);
    const bin = join(home, ".nookdeck", "bin", "nookdeck");
    // install our two hooks through the real code, into the sandbox
    const HI = await import("../src/hooks-install");
    await HI.installHook(join(home, ".claude", "settings.json"), HI.hookCommand("claude", { execPath: bin }));
    await HI.installAskHook(join(home, ".claude", "settings.json"), HI.askHookCommand({ execPath: bin }));
    writeFileSync(join(home, ".nookdeck", "layout.json"), "{}");
    const plist = join(home, "Library", "LaunchAgents", "dev.nookdeck.agent.plist");
    expect(existsSync(plist)).toBe(true);

    const dry = sh("uninstall.sh", ["--dry-run"], env(home, release));
    expect(dry.exitCode).toBe(0);
    expect(existsSync(bin)).toBe(true);

    const r = sh("uninstall.sh", ["--yes"], env(home, release));
    expect(r.exitCode, out(r)).toBe(0);
    expect(existsSync(plist)).toBe(false);
    expect(existsSync(join(home, ".nookdeck", "bin"))).toBe(false);
    expect(existsSync(join(home, ".nookdeck", "layout.json"))).toBe(true); // data stays
    expect(JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"))).toEqual(other);
    expect(existsSync(join(home, ".claude", "settings.json.nookdeck.bak"))).toBe(true);

    // again, with nothing left: still fine; --purge removes the data
    const again = sh("uninstall.sh", ["--yes"], env(home, release));
    expect(again.exitCode, out(again)).toBe(0);
    const purge = sh("uninstall.sh", ["--yes", "--purge"], env(home, release));
    expect(purge.exitCode, out(purge)).toBe(0);
    expect(existsSync(join(home, ".nookdeck"))).toBe(false);
  }, 120_000);
});

describe.skipIf(!unix)("setup.sh: finding the latest release when GitHub misbehaves", () => {
  // a local stand-in for github.com + api.github.com + the release downloads
  function githubStandIn(opts: { failFirst?: number; redirectWorks?: boolean; apiTag?: string | null; status?: number }) {
    const release = makeRelease({ gz: "good" });
    let n = 0;
    const hits: string[] = [];
    const server = createServer((req, res) => {
      const url = req.url ?? "";
      hits.push(`${req.method} ${url}`);
      if (n++ < (opts.failFirst ?? 0)) { res.writeHead(503).end("busy"); return; }
      if (url === "/howznguyen/nookdeck/releases/latest") {
        if (opts.redirectWorks === false) { res.writeHead(opts.status ?? 503).end("no"); return; }
        res.writeHead(302, { location: "/howznguyen/nookdeck/releases/tag/v9.9.9" }).end(); return;
      }
      if (url === "/howznguyen/nookdeck/releases/tag/v9.9.9") { res.writeHead(200).end("page"); return; }
      if (url === "/repos/howznguyen/nookdeck/releases/latest") {
        if (opts.apiTag) { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ tag_name: opts.apiTag, name: "x" })); return; }
        res.writeHead(opts.status ?? 503).end("no"); return;
      }
      const m = /^\/howznguyen\/nookdeck\/releases\/download\/v9\.9\.9\/(.+)$/.exec(url);
      if (m && existsSync(join(release, m[1]!))) { const b = readFileSync(join(release, m[1]!)); res.writeHead(200, { "content-length": b.length }).end(req.method === "HEAD" ? undefined : b); return; }
      res.writeHead(404).end("no");
    });
    return new Promise<{ base: string; hits: string[]; close: () => void }>((ok) => server.listen(0, "127.0.0.1", () => ok({ base: `http://127.0.0.1:${(server.address() as any).port}`, hits, close: () => server.close() })));
  }
  const run = async (gh: { base: string }, extra: Record<string, string> = {}, args: string[] = []) => {
    const home = newHome();
    const e = { ...env(home, "x"), NOOKDECK_GITHUB_URL: gh.base + "/", NOOKDECK_API_URL: gh.base, NOOKDECK_RETRY_SECONDS: "1", ...extra } as Record<string, string>;
    delete e.NOOKDECK_RELEASE_BASE;
    const p = Bun.spawn(["bash", join(root, "setup.sh"), "--yes", "--no-autostart", "--no-start", "--no-open", ...args], { env: e, stdout: "pipe", stderr: "pipe", stdin: new Blob([""]) }); // env: NOOKDECK_INSTALL_HOME (via env()) keeps this in the sandbox
    const text = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    return { code: await p.exited, text, home };
  };
  test("the redirect lookup answers 5xx for a while: it retries and installs", async () => {
    const gh = await githubStandIn({ failFirst: 2, apiTag: null });
    try {
      const r = await run(gh);
      expect(r.code, r.text).toBe(0);
      expect(r.text).toContain("release v9.9.9");
    } finally { gh.close(); }
  }, 120_000);
  test("the redirect keeps failing: it falls back to api.github.com tag_name", async () => {
    const gh = await githubStandIn({ redirectWorks: false, apiTag: "v9.9.9" });
    try {
      const r = await run(gh);
      expect(r.code, r.text).toBe(0);
      expect(r.text).toContain("release v9.9.9");
      expect(gh.hits.some((h) => h.includes("/repos/") && h.includes("/releases/latest"))).toBe(true);
    } finally { gh.close(); }
  }, 120_000);
  test("both fail: the error says what failed and suggests --version / NOOKDECK_VERSION; nothing is installed", async () => {
    const gh = await githubStandIn({ redirectWorks: false, apiTag: null, status: 404 });
    try {
      const r = await run(gh);
      expect(r.code).not.toBe(0);
      expect(r.text).toContain("look up the latest release");
      expect(r.text).toContain("--version");
      expect(r.text).toContain("NOOKDECK_VERSION");
      expect(r.text).toContain("retrying"); // it did retry
      expect(existsSync(join(r.home, ".nookdeck", "bin", "nookdeck"))).toBe(false);
    } finally { gh.close(); }
  }, 120_000);
  test("NOOKDECK_VERSION skips the lookup entirely", async () => {
    const gh = await githubStandIn({ redirectWorks: false, apiTag: null });
    try {
      const r = await run(gh, { NOOKDECK_VERSION: "9.9.9" });
      expect(r.code, r.text).toBe(0);
      expect(gh.hits.some((h) => h.includes("/releases/latest"))).toBe(false);
    } finally { gh.close(); }
  }, 120_000);

});

describe.skipIf(!unix)("setup.sh / uninstall.sh: PATH and the port check", () => {
  const base = ["--yes", "--no-autostart", "--no-open"];
  test("PATH: the marked line goes into the shell rc files, once; uninstall removes it and keeps the rest", () => {
    const home = newHome();
    writeFileSync(join(home, ".zshrc"), "alias ll='ls -l'\n# nookdeck is great\nexport FOO=1");
    const rel = makeRelease();
    for (let i = 0; i < 2; i++) {
      const r = sh("setup.sh", [...base, "--no-start"], env(home, rel));
      expect(r.exitCode, out(r)).toBe(0);
      if (i === 0) expect(out(r)).toMatch(/New terminal windows will find nookdeck[\s\S]*source ~?\/?.*\.zshrc/);
    }
    const rc = readFileSync(join(home, ".zshrc"), "utf8");
    expect(rc.match(/\.nookdeck\/bin:\$PATH" # nookdeck/g)?.length).toBe(1); // idempotent
    expect(rc).toContain("export FOO=1\nexport PATH="); // newline added before our line
    const u = sh("uninstall.sh", ["--yes"], env(home, rel));
    expect(u.exitCode, out(u)).toBe(0);
    const after = readFileSync(join(home, ".zshrc"), "utf8");
    expect(after).toBe("alias ll='ls -l'\n# nookdeck is great\nexport FOO=1\n"); // only our line is gone
    expect(existsSync(join(home, ".zshrc.nookdeck.bak"))).toBe(true);
  });
  test("PATH: with ~/.local/bin on PATH a symlink is made (no rc edit); uninstall removes it", () => {
    const home = newHome();
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    const rel = makeRelease();
    const e = env(home, rel, { PATH: `${join(home, ".local", "bin")}:${process.env.PATH}` });
    const r = sh("setup.sh", [...base, "--no-start"], e);
    expect(r.exitCode, out(r)).toBe(0);
    expect(readlinkSync(join(home, ".local", "bin", "nookdeck"))).toBe(join(home, ".nookdeck", "bin", "nookdeck"));
    expect(existsSync(join(home, ".zshrc"))).toBe(false);
    expect(out(r)).toContain("Try: nookdeck doctor");
    const u = sh("uninstall.sh", ["--yes"], e);
    expect(u.exitCode, out(u)).toBe(0);
    expect(existsSync(join(home, ".local", "bin", "nookdeck"))).toBe(false);
  });
  test("--no-path changes nothing", () => {
    const home = newHome();
    const r = sh("setup.sh", [...base, "--no-start", "--no-path"], env(home, makeRelease()));
    expect(r.exitCode, out(r)).toBe(0);
    expect(existsSync(join(home, ".zshrc"))).toBe(false);
    expect(existsSync(join(home, ".bash_profile"))).toBe(false);
  });
  test("a listener on the port: setup says who holds it and stops before starting anything", async () => {
    const which = (t: string) => Bun.spawnSync(["which", t], { env: { PATH: process.env.PATH!, HOME: join(sandbox, "fake-home") } }).exitCode === 0; // HOME: sandbox
    if (!which("lsof") && !which("ss")) return;
    const holder = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    try {
      const home = newHome();
      const r = sh("setup.sh", [...base, "--port", String(holder.port)], env(home, makeRelease()));
      const text = out(r);
      expect(r.exitCode).not.toBe(0);
      expect(text).toContain(`port ${holder.port} is taken by process ${process.pid}`);
      expect(text).toContain("--port");
      expect(existsSync(join(home, ".nookdeck", "agent.pid"))).toBe(false);
    } finally { holder.stop(true); }
  });
  test("the health check must be answered by the agent just installed", async () => {
    const home = newHome();
    const port = await freePort();
    const r = sh("setup.sh", [...base, "--port", String(port)], env(home, makeRelease()));
    const text = out(r);
    const pid = Number(readFileSync(join(home, ".nookdeck", "agent.pid"), "utf8").trim());
    if (pid) spawned.push(pid);
    expect(r.exitCode, text).toBe(0);
    expect(text).toContain(`agent is up on port ${port}`);
  }, 120_000);
});

describe.skipIf(!unix)("setup.sh: running it again does not redo what is done", () => {
  const sum = (t: string) => /Program\s+(.+)\n\s*PATH\s+(.+)\n\s*Service\s+(.+)/.exec(t)?.slice(1, 4).map((x) => x.trim());
  test("same release, agent running: no download, no questions, the same agent keeps running, summary says 'already set'", async () => {
    const home = newHome();
    const release = makeRelease({ gz: "good" });
    const port = await freePort();
    const args = ["--yes", "--no-open", "--no-autostart", "--port", String(port)];
    const r1 = sh("setup.sh", args, env(home, release));
    expect(r1.exitCode, out(r1)).toBe(0);
    expect(sum(out(r1))).toEqual(["installed", "installed", "skipped"]);
    const pidfile = join(home, ".nookdeck", "agent.pid");
    const pid = Number(readFileSync(pidfile, "utf8")); spawned.push(pid);
    const bin = join(home, ".nookdeck", "bin", "nookdeck");
    const before = statSync(bin).mtimeMs;
    const rc = readFileSync(join(home, ".zshrc"), "utf8");
    const t0 = Date.now();
    const r2 = sh("setup.sh", args, env(home, release));
    const text = out(r2);
    expect(r2.exitCode, text).toBe(0);
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(text).toMatch(/Nookdeck \d+\.\d+\.\d+ is up to date/);
    expect(text).not.toContain("Fetching");
    expect(text).not.toContain("[Y/n]");
    expect(text).toContain("already on PATH");
    expect(text).toContain("agent already running");
    expect(sum(text)).toEqual(["already set", "already set", "skipped"]);
    expect(statSync(bin).mtimeMs).toBe(before);
    expect(readFileSync(join(home, ".zshrc"), "utf8")).toBe(rc);
    expect(Number(readFileSync(pidfile, "utf8"))).toBe(pid); // not restarted
    expect((await fetch(`http://127.0.0.1:${port}/api/pairing`)).status).toBe(200);
    // --force reinstalls anyway
    const r3 = sh("setup.sh", [...args, "--force"], env(home, release));
    expect(r3.exitCode, out(r3)).toBe(0);
    expect(out(r3)).toContain("Fetching");
    expect(sum(out(r3))?.[0]).toMatch(/^updated/);
    spawned.push(Number(readFileSync(pidfile, "utf8")));
  }, 150_000);
  test.skipIf(!mac)("the launchd service: kept when it runs this program on this port; rewritten when the port changes", () => {
    const home = newHome();
    const release = makeRelease();
    const args = ["--yes", "--no-open", "--no-start"];
    const e = env(home, release);
    const r1 = sh("setup.sh", [...args, "--port", "7541"], e);
    expect(sum(out(r1))?.[2]).toBe("installed");
    const plist = join(home, "Library", "LaunchAgents", "dev.nookdeck.agent.plist");
    const same = readFileSync(plist, "utf8");
    const r2 = sh("setup.sh", [...args, "--port", "7541"], e);
    expect(out(r2)).toContain("service already registered");
    expect(sum(out(r2))?.[2]).toBe("already set");
    expect(readFileSync(plist, "utf8")).toBe(same);
    const r3 = sh("setup.sh", [...args, "--port", "7542"], e);
    expect(sum(out(r3))?.[2]).toBe("updated");
    expect(readFileSync(plist, "utf8")).toContain("<string>7542</string>");
  }, 150_000);
  test("a tampered install is not 'up to date'; a different release is an upgrade", () => {
    const home = newHome();
    const args = ["--yes", "--no-open", "--no-start", "--no-autostart"];
    expect(sh("setup.sh", args, env(home, makeRelease())).exitCode).toBe(0);
    const bin = join(home, ".nookdeck", "bin", "nookdeck");
    // a different release (another file, another sum): downloaded and replaced
    const up = sh("setup.sh", args, env(home, makeRelease({ variant: "v2" })));
    expect(up.exitCode, out(up)).toBe(0);
    expect(out(up)).not.toContain("up to date");
    expect(sum(out(up))?.[0]).toMatch(/^updated \(/);
    // the installed file changed behind our back: reinstalled even though the release is the same
    const rel = makeRelease({ variant: "v2" });
    writeFileSync(bin, readFileSync(bin, "utf8") + "# edited\n");
    const fix = sh("setup.sh", args, env(home, rel));
    expect(out(fix)).not.toContain("up to date");
    expect(fix.exitCode, out(fix)).toBe(0);
    expect(readFileSync(bin, "utf8")).not.toContain("# edited");
  }, 150_000);
  test("an install without the .release marker (older setup) is reinstalled once, then it is up to date", () => {
    const home = newHome();
    const rel = makeRelease();
    const args = ["--yes", "--no-open", "--no-start", "--no-autostart"];
    expect(sh("setup.sh", args, env(home, rel)).exitCode).toBe(0);
    rmSync(join(home, ".nookdeck", "bin", ".release"));
    expect(out(sh("setup.sh", args, env(home, rel)))).not.toContain("up to date");
    expect(out(sh("setup.sh", args, env(home, rel)))).toContain("up to date");
  }, 150_000);
});

// main is pushed before the new release has finished building: for a while the latest release is a 0.1.x one with phonedesk-* assets only
describe.skipIf(!mac)("setup.sh: a release from before the rename (phonedesk-* assets only)", () => {
  function oldRelease(gz = false) {
    const dir = mkdtempSync(join(sandbox, "oldrel-"));
    const calls = join(dir, "calls.log");
    const lines: string[] = [];
    for (const arch of ["arm64", "x64"]) {
      const f = join(dir, `phonedesk-darwin-${arch}`);
      // a 0.1.4 program: answers --version in the old way and knows no `migrate`; it records what it was asked
      writeFileSync(f, `#!/bin/bash\necho "$*" >> "${calls}"\ncase "$1" in --version) echo "phonedesk 0.1.4 (abc1234)";; migrate) echo "phonedesk: unknown command" >&2; exit 2;; *) exit 0;; esac\n`);
      chmodSync(f, 0o755);
      lines.push(`${sha(f)}  phonedesk-darwin-${arch}`);
      if (gz) { writeFileSync(`${f}.gz`, gzipSync(readFileSync(f))); lines.push(`${sha(`${f}.gz`)}  phonedesk-darwin-${arch}.gz`); }
    }
    writeFileSync(join(dir, "SHA256SUMS"), lines.join("\n") + "\n");
    return { dir, calls };
  }
  const flags = ["--yes", "--no-autostart", "--no-start", "--no-open", "--no-path"];

  test("installs the phonedesk-* binary as nookdeck, says so in one line, and does not call migrate", () => {
    const { dir, calls } = oldRelease();
    const home = newHome();
    const r = sh("setup.sh", flags, env(home, dir));
    const text = out(r);
    expect(r.exitCode, text).toBe(0);
    expect(text).toContain("before the rename");
    expect(text).toContain("installing it as nookdeck");
    expect(existsSync(join(home, ".nookdeck", "bin", "nookdeck"))).toBe(true);
    expect(existsSync(join(home, ".nookdeck", "bin", "phonedesk-darwin-arm64"))).toBe(false);
    expect(readFileSync(calls, "utf8")).not.toMatch(/^migrate/m);
    expect(text).toContain("nookdeck 0.1.4"); // the version line is shown under the new name
  });

  test("the .gz of the old name is used too", () => {
    const { dir } = oldRelease(true);
    const r = sh("setup.sh", flags, env(newHome(), dir));
    expect(r.exitCode, out(r)).toBe(0);
    expect(out(r)).toMatch(/Fetching phonedesk-darwin-(arm64|x64)\.gz/);
  });

  test("an existing ~/.phonedesk is copied to ~/.nookdeck by the script itself (the 0.1.x program cannot migrate); the old folder stays", () => {
    const { dir, calls } = oldRelease();
    const home = newHome();
    mkdirSync(join(home, ".phonedesk"), { recursive: true });
    writeFileSync(join(home, ".phonedesk", "devices.json"), '{"devices":[1]}');
    const r = sh("setup.sh", flags, env(home, dir));
    expect(r.exitCode, out(r)).toBe(0);
    expect(readFileSync(join(home, ".nookdeck", "devices.json"), "utf8")).toBe('{"devices":[1]}');
    expect(existsSync(join(home, ".phonedesk", "devices.json"))).toBe(true);
    expect(readFileSync(calls, "utf8")).not.toMatch(/^migrate/m);
  });

  test("a release that lists nookdeck-* is preferred even when it lists phonedesk-* too", () => {
    const dir = makeRelease();
    for (const arch of ["arm64", "x64"]) writeFileSync(join(dir, `phonedesk-darwin-${arch}`), "x");
    const r = sh("setup.sh", flags, env(newHome(), dir));
    expect(r.exitCode, out(r)).toBe(0);
    expect(out(r)).not.toContain("before the rename");
  });
});

// no PowerShell on this machine to run setup.ps1: pin the pieces of the same fallback by reading it
describe("setup.ps1: the pre-rename release fallback (static)", () => {
  const ps = readFileSync(join(root, "setup.ps1"), "utf8").replace(/\r\n/g, "\n");
  test("looks for nookdeck-* first, falls back to phonedesk-*, shows it as nookdeck, skips migrate for it", () => {
    expect(ps).toContain("$asset -replace '^nookdeck-', 'phonedesk-'");
    expect(ps.indexOf("if (-not (Sum-For $asset))")).toBeLessThan(ps.indexOf("Probe-Installed", ps.indexOf("function Fetch-Binary")));
    expect(ps).toContain("$v = 'nookdeck ' + ($v -replace '^phonedesk ', '')");
    expect(ps).toMatch(/if \(\$S\.legacy\) \{[^}]*copying its data[\s\S]*?return\s*\}\s*Say "found an existing PhoneDesk install \(\$oldHome\): moving it/);
    expect(ps).toContain("PHONEDESK_HOME = $dataDir");
    expect(ps).toContain("(?:nookdeck|phonedesk) (\\S+)");
  });
});

describe.skipIf(!mac)("setup.sh: signature and the port of our own agent", () => {
  /** A fake `codesign` first on PATH: records its calls, answers verify / -d -r- the way the test says. */
  function fakeCodesign(mode: "cert" | "adhoc") {
    const dir = mkdtempSync(join(sandbox, "fakebin-"));
    const log = join(dir, "codesign.log");
    const dr = mode === "cert" ? 'designated => identifier "dev.nookdeck.agent" and certificate root = H"abc"' : 'designated => cdhash H"abc"';
    writeFileSync(join(dir, "codesign"), `#!/bin/bash\necho "$*" >> "${log}"\ncase "$*" in *--verify*) exit ${mode === "cert" ? 0 : 1};; *"-r-"*) echo '${dr}'; exit 0;; *) exit 0;; esac\n`);
    chmodSync(join(dir, "codesign"), 0o755);
    return { dir, log };
  }
  const flags = ["--yes", "--no-autostart", "--no-start", "--no-open", "--no-path"];

  test("a binary signed with the release certificate is not re-signed", () => {
    const cs = fakeCodesign("cert");
    const home = newHome();
    const r = sh("setup.sh", flags, env(home, makeRelease(), { PATH: `${cs.dir}:${process.env.PATH}` }));
    expect(r.exitCode, out(r)).toBe(0);
    expect(out(r)).toContain("signed by the release identity");
    expect(out(r)).not.toContain("signed ad hoc");
    expect(readFileSync(cs.log, "utf8")).not.toContain("--force");
  });
  test("an unsigned or broken one is signed ad hoc, as before", () => {
    const cs = fakeCodesign("adhoc");
    const r = sh("setup.sh", flags, env(newHome(), makeRelease(), { PATH: `${cs.dir}:${process.env.PATH}` }));
    expect(r.exitCode, out(r)).toBe(0);
    expect(out(r)).toContain("signed ad hoc for this Mac");
    expect(readFileSync(cs.log, "utf8")).toContain("--force -s -");
  });
  test("the old launchd job of a PhoneDesk install is stopped by the script, its port kept, and migrate runs without a service step", () => {
    const home = newHome();
    const agents = join(home, "Library", "LaunchAgents");
    mkdirSync(agents, { recursive: true });
    mkdirSync(join(home, ".phonedesk"), { recursive: true });
    writeFileSync(join(home, ".phonedesk", "devices.json"), "{}");
    writeFileSync(join(agents, "dev.phonedesk.agent.plist"), "<array>\n    <string>/x/phonedesk</string>\n    <string>--port</string>\n    <string>7455</string>\n  </array>\n");
    const launch = join(home, "launchctl.log");
    writeFileSync(join(home, "lc"), `#!/bin/bash\necho "$*" >> "${launch}"\n`); chmodSync(join(home, "lc"), 0o755);
    const r = sh("setup.sh", ["--yes", "--no-autostart", "--no-start", "--no-open", "--no-path", "--dry-run"], env(home, makeRelease(), { NOOKDECK_LAUNCHCTL: join(home, "lc") }));
    // a dry run changes nothing
    expect(r.exitCode, out(r)).toBe(0);
    expect(existsSync(join(agents, "dev.phonedesk.agent.plist"))).toBe(true);
    const real = sh("setup.sh", ["--yes", "--no-autostart", "--no-start", "--no-open", "--no-path"], env(home, makeRelease(), { NOOKDECK_LAUNCHCTL: join(home, "lc") }));
    expect(real.exitCode, out(real)).toBe(0);
    expect(readFileSync(launch, "utf8")).toContain("bootout");
    expect(readFileSync(launch, "utf8")).toContain("dev.phonedesk.agent");
    expect(existsSync(join(agents, "dev.phonedesk.agent.plist"))).toBe(false);
    expect(existsSync(join(agents, "dev.phonedesk.agent.plist.nookdeck-old"))).toBe(true); // kept, not deleted
    expect(out(real)).toContain("keeping the port of your old install: 7455");
    expect(readFileSync(join(home, ".nookdeck", "devices.json"), "utf8")).toBe("{}");
    expect(readFileSync(launch, "utf8")).not.toContain("dev.nookdeck.agent"); // the new service is not started before the new program is in place
  });
  test("our own agent holding the port is restarted, not an error", async () => {
    const release = makeRelease();
    const home = newHome();
    const port = await freePort();
    // setup once to put the program in place and start it
    const first = sh("setup.sh", ["--yes", "--no-autostart", "--no-open", "--port", String(port)], env(home, release));
    expect(first.exitCode, out(first)).toBe(0);
    // another release: not "up to date", so setup replaces the program while the old agent may still be listening
    const second = sh("setup.sh", ["--yes", "--no-autostart", "--no-open", "--port", String(port)], env(home, makeRelease({ variant: "two" })));
    expect(second.exitCode, out(second)).toBe(0);
    expect(out(second)).not.toContain("is taken by");
  });
});

describe.skipIf(!unix)("uninstall.sh: the tray app's login entry", () => {
  const entry = (home: string) => join(home, ".config", "autostart", "nookdeck-tray.desktop");
  const put = (home: string, text: string) => { mkdirSync(join(home, ".config", "autostart"), { recursive: true }); writeFileSync(entry(home), text); };
  test("removed when its Exec starts nookdeck-tray; a dry run only lists it", () => {
    const home = newHome();
    put(home, "[Desktop Entry]\nType=Application\nName=Nookdeck\nExec=/usr/bin/nookdeck-tray\nIcon=dev.nookdeck.app\n");
    const dry = sh("uninstall.sh", ["--dry-run"], env(home, ""));
    expect(dry.exitCode, out(dry)).toBe(0);
    expect(out(dry)).toContain("the tray app's login entry");
    expect(existsSync(entry(home))).toBe(true);
    const u = sh("uninstall.sh", ["--yes"], env(home, ""));
    expect(u.exitCode, out(u)).toBe(0);
    expect(out(u)).toContain("removed the tray app's login entry");
    expect(existsSync(entry(home))).toBe(false);
  });
  test("a file of the same name that starts something else is left alone", () => {
    const home = newHome();
    put(home, "[Desktop Entry]\nType=Application\nName=My script\nExec=/home/me/bin/my-script\n");
    const u = sh("uninstall.sh", ["--yes"], env(home, ""));
    expect(u.exitCode, out(u)).toBe(0);
    expect(out(u)).not.toContain("tray app's login entry");
    expect(existsSync(entry(home))).toBe(true);
  });
});

describe.skipIf(!linux)("setup.sh / uninstall.sh on Linux", () => {
  const flags = ["--yes", "--no-autostart", "--no-start", "--no-open"];
  test("picks nookdeck-linux-<arch> and says Linux, never Mac", () => {
    const r = sh("setup.sh", flags, env(newHome(), makeRelease()));
    const text = out(r);
    expect(r.exitCode, text).toBe(0);
    expect(text).toContain("installer for Linux");
    expect(text).toMatch(/Linux on (x86_64|aarch64|arm64) .*nookdeck-linux-(x64|arm64)/);
    expect(text).not.toMatch(/\bMac\b|macOS/);
  });
  test("a dry run names the systemd user service", () => {
    const r = sh("setup.sh", ["--dry-run", "--yes"], env(newHome(), makeRelease()));
    expect(r.exitCode, out(r)).toBe(0);
    expect(out(r)).toContain("would register the systemd user service nookdeck.service");
  });
  test("bash: the PATH line goes into ~/.bashrc (what a terminal window reads), and uninstall takes it out again", () => {
    const home = newHome();
    const e = env(home, makeRelease(), { SHELL: "/bin/bash" });
    const r = sh("setup.sh", flags, e);
    expect(r.exitCode, out(r)).toBe(0);
    expect(readFileSync(join(home, ".bashrc"), "utf8")).toContain('.nookdeck/bin:$PATH" # nookdeck');
    expect(existsSync(join(home, ".bash_profile"))).toBe(false);
    const u = sh("uninstall.sh", ["--yes"], e);
    expect(u.exitCode, out(u)).toBe(0);
    expect(readFileSync(join(home, ".bashrc"), "utf8")).not.toContain(".nookdeck/bin");
  });
  test("program gone, no systemd: the agent the autostart entry started is stopped (only if /proc says it is ours), autostart.sh goes", async () => {
    const home = newHome();
    const data = join(home, ".nookdeck"), bin = join(data, "bin", "nookdeck"), autoDir = join(home, ".config", "autostart");
    mkdirSync(data, { recursive: true }); mkdirSync(autoDir, { recursive: true });
    writeFileSync(join(autoDir, "nookdeck.desktop"), "[Desktop Entry]\nExec=/bin/sh " + join(data, "autostart.sh") + "\n");
    writeFileSync(join(data, "autostart.sh"), "#!/bin/sh\nexec env '" + bin + "'\n");
    // stands in for the agent: its command line is the (now deleted) program
    const agent = Bun.spawn(["bash", "-c", `exec -a "${bin}" sleep 60`]);
    // a stale pid file must never kill a stranger
    const stranger = Bun.spawn(["sleep", "60"]);
    try {
      await Bun.sleep(200);
      writeFileSync(join(data, "service.pid"), `${agent.pid}\n`);
      const u = sh("uninstall.sh", ["--yes"], env(home, ""));
      expect(u.exitCode, out(u)).toBe(0);
      expect(out(u)).toContain(`stopped the agent started at login (pid ${agent.pid})`);
      expect(await Promise.race([agent.exited.then(() => "gone"), Bun.sleep(3000).then(() => "alive")])).toBe("gone");
      for (const f of [join(data, "autostart.sh"), join(data, "service.pid"), join(autoDir, "nookdeck.desktop")]) expect(existsSync(f)).toBe(false);

      const home2 = newHome();
      mkdirSync(join(home2, ".nookdeck"), { recursive: true });
      writeFileSync(join(home2, ".nookdeck", "service.pid"), `${stranger.pid}\n`);
      const u2 = sh("uninstall.sh", ["--yes"], env(home2, ""));
      expect(u2.exitCode, out(u2)).toBe(0);
      expect(out(u2)).not.toContain("stopped the agent started at login");
      expect(stranger.exitCode).toBeNull();
      expect(existsSync(join(home2, ".nookdeck", "service.pid"))).toBe(false);
    } finally { agent.kill(); stranger.kill(); }
  });
  test("uninstall with the program already gone stops and removes the unit and the autostart entry", () => {
    const home = newHome();
    const unitDir = join(home, ".config", "systemd", "user"), autoDir = join(home, ".config", "autostart");
    mkdirSync(unitDir, { recursive: true }); mkdirSync(autoDir, { recursive: true });
    writeFileSync(join(unitDir, "nookdeck.service"), "[Service]\nExecStart=/x/nookdeck\n");
    writeFileSync(join(autoDir, "nookdeck.desktop"), "[Desktop Entry]\n");
    mkdirSync(join(home, ".nookdeck"), { recursive: true });
    const log = join(home, "systemctl.log");
    writeFileSync(join(home, "sc"), `#!/bin/bash\necho "$*" >> "${log}"\n`); chmodSync(join(home, "sc"), 0o755);
    const u = sh("uninstall.sh", ["--yes"], env(home, "", { NOOKDECK_SYSTEMCTL: join(home, "sc") }));
    expect(u.exitCode, out(u)).toBe(0);
    expect(out(u)).toContain("uninstaller for Linux");
    expect(existsSync(join(unitDir, "nookdeck.service"))).toBe(false);
    expect(existsSync(join(autoDir, "nookdeck.desktop"))).toBe(false);
    expect(readFileSync(log, "utf8")).toContain("disable --now nookdeck.service");
    expect(readFileSync(log, "utf8")).toContain("daemon-reload");
  });
});

describe("setup.sh: the Linux branch (static, every system)", () => {
  const text = readFileSync(join(root, "setup.sh"), "utf8");
  test("Linux assets, the systemd unit, xdg-open only in a desktop session, never a bare open", () => {
    expect(text).toContain('asset="nookdeck-linux-$want"');
    expect(text).toContain("unit_name=nookdeck.service");
    expect(text).toContain("systemd/user}/$unit_name");
    expect(text).toMatch(/have xdg-open && \[ -n "\$\{DISPLAY:-\}\$\{WAYLAND_DISPLAY:-\}" \]/);
    expect(text).not.toMatch(/\bthen open "http/);
    expect(text).toContain('fail "this installer is for macOS and Linux only"');
  });
});

describe("setup.ps1: the same port rule (static)", () => {
  const ps = readFileSync(join(root, "setup.ps1"), "utf8").replace(/\r\n/g, "\n");
  test("our own program on the port is stopped and the rest of setup goes on; migrate runs in two steps", () => {
    expect(ps).toContain("$hp.Path -ieq $exe");
    expect(ps.indexOf("Stop-Process -Id $hp.Id")).toBeLessThan(ps.indexOf('Fail "port $Port is taken by $who"'));
    expect(ps).toContain("@('migrate', '--no-service', '--port'");
    expect(ps).toContain("Run-Bin $exe @('migrate', '--port'");
  });
});

describe.skipIf(!unix)("installers: the anonymous install count", () => {
  const URL_ = "http://analytics.test/api/event";
  /** A fake `curl` first on PATH: logs each call (one line) and exits with `code`, after `sleep` seconds. */
  function fakeCurl(code = 0, sleep = 0) {
    const dir = mkdtempSync(join(sandbox, "fakecurl-"));
    const log = join(dir, "curl.log");
    writeFileSync(join(dir, "curl"), `#!/bin/bash\necho "$*" >> "${log}"\n${sleep ? `sleep ${sleep}\n` : ""}exit ${code}\n`);
    chmodSync(join(dir, "curl"), 0o755);
    return { dir, log, path: `${dir}:${process.env.PATH}` };
  }
  const calls = (log: string) => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);
  const bodies = (log: string) => calls(log).map((l) => JSON.parse(/--data (\{.*\}) http/.exec(l)![1]!));
  async function waitFor(log: string, n: number) { for (let i = 0; i < 60 && calls(log).length < n; i++) await Bun.sleep(50); }
  const flags = ["--yes", "--no-autostart", "--no-start", "--no-open", "--no-path"];
  const ALLOWED = new Set(["name", "os", "os_version", "arch", "installer", "version", "from_version", "mode", "step", "reason"]);
  const VALUE = /^[\w .,:+()/-]{1,64}$/;
  const withUrl = (home: string, release: string, c: { path: string }, extra: Record<string, string> = {}) => env(home, release, { PATH: c.path, NOOKDECK_ANALYTICS_URL: URL_, ...extra });

  test("a fresh install sends install_started and install_finished with only the allowed fields", async () => {
    const c = fakeCurl();
    const home = newHome();
    const r = sh("setup.sh", flags, withUrl(home, makeRelease(), c));
    expect(r.exitCode, out(r)).toBe(0);
    expect(out(r)).toContain("Sends an anonymous install count to nookdeck.app (opt out: NOOKDECK_NO_ANALYTICS=1)");
    await waitFor(c.log, 2);
    const [a, b] = bodies(c.log);
    expect(a).toMatchObject({ name: "install_started", os: mac ? "macos" : "linux", installer: "setup.sh" });
    expect(a!.arch).toMatch(/^(arm64|x64)$/);
    expect(a!.os_version).toMatch(/^\d+(\.\d+)*$/);
    expect(b).toMatchObject({ name: "install_finished", mode: "fresh", installer: "setup.sh" });
    expect(b!.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(b!.from_version).toBeUndefined();
    for (const body of [a!, b!]) for (const [k, v] of Object.entries(body)) { expect(ALLOWED.has(k), k).toBe(true); expect(String(v), k).toMatch(VALUE); }
    // nothing that identifies the machine or the person
    const all = calls(c.log).join("\n");
    for (const secret of [home, join(home, "fake-home"), require("node:os").hostname(), require("node:os").userInfo().username]) expect(all).not.toContain(secret);
    expect(all).toContain(`-m 3`);
    expect(all).toContain(URL_);
  });

  test("a second install with another release says upgrade, with the previous version", async () => {
    const c = fakeCurl();
    const home = newHome();
    sh("setup.sh", flags, withUrl(home, makeRelease(), c));
    await waitFor(c.log, 2);
    const r = sh("setup.sh", [...flags, "--force"], withUrl(home, makeRelease({ variant: "b" }), c));
    expect(r.exitCode, out(r)).toBe(0);
    await waitFor(c.log, 4);
    const last = bodies(c.log).at(-1)!;
    expect(last).toMatchObject({ name: "install_finished", mode: "upgrade" });
    expect(String(last.from_version)).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("an install over PhoneDesk says migrated", async () => {
    const c = fakeCurl();
    const home = newHome();
    mkdirSync(join(home, ".phonedesk"), { recursive: true });
    writeFileSync(join(home, ".phonedesk", "devices.json"), "{}");
    const r = sh("setup.sh", flags, withUrl(home, makeRelease(), c));
    expect(r.exitCode, out(r)).toBe(0);
    await waitFor(c.log, 2);
    expect(bodies(c.log).at(-1)).toMatchObject({ name: "install_finished", mode: "migrated" });
  });

  test("a failure sends install_failed with the step and a short code, never the message or a path", async () => {
    const c = fakeCurl();
    const home = newHome();
    const r = sh("setup.sh", flags, withUrl(home, makeRelease({ tamper: true }), c));
    expect(r.exitCode).toBe(1);
    await waitFor(c.log, 2);
    const f = bodies(c.log).find((b) => b.name === "install_failed")!;
    expect(f).toMatchObject({ step: "fetch", reason: "checksum" });
    expect(JSON.stringify(f)).not.toContain(home);
    expect(Object.keys(f).every((k) => ALLOWED.has(k))).toBe(true);
  });

  test("opt-outs send nothing and print no notice: --no-analytics, NOOKDECK_NO_ANALYTICS=1, DO_NOT_TRACK=1", async () => {
    for (const [args, extra] of [[["--no-analytics"], {}], [[], { NOOKDECK_NO_ANALYTICS: "1" }], [[], { DO_NOT_TRACK: "1" }]] as Array<[string[], Record<string, string>]>) {
      const c = fakeCurl();
      const r = sh("setup.sh", [...flags, ...args], withUrl(newHome(), makeRelease(), c, extra));
      expect(r.exitCode, out(r)).toBe(0);
      expect(out(r)).not.toContain("anonymous install count");
      await Bun.sleep(300);
      expect(calls(c.log)).toEqual([]);
    }
  });

  test("local tests, dry runs and the test suite send nothing by default", async () => {
    const c = fakeCurl();
    // RELEASE_BASE and INSTALL_HOME are set by env(): no NOOKDECK_ANALYTICS_URL, so nothing goes out
    const r = sh("setup.sh", flags, env(newHome(), makeRelease(), { PATH: c.path }));
    expect(r.exitCode, out(r)).toBe(0);
    const d = sh("setup.sh", [...flags, "--dry-run"], withUrl(newHome(), makeRelease(), c));
    expect(d.exitCode, out(d)).toBe(0);
    const t = sh("setup.sh", flags, withUrl(newHome(), makeRelease(), c, { NOOKDECK_TEST_SANDBOX: "1" }));
    expect(t.exitCode, out(t)).toBe(0);
    await Bun.sleep(300);
    expect(calls(c.log).filter((l) => l.includes(URL_))).toHaveLength(2); // only the NOOKDECK_TEST_SANDBOX run still sends, because the URL override wins
  });

  test("an endpoint that fails, or hangs, does not fail or slow down the install", () => {
    for (const c of [fakeCurl(7), fakeCurl(28, 2)]) {
      const t0 = Date.now();
      const r = sh("setup.sh", flags, withUrl(newHome(), makeRelease(), c));
      expect(r.exitCode, out(r)).toBe(0);
      expect(Date.now() - t0).toBeLessThan(6000);
    }
  });

  test("uninstall.sh sends uninstall_finished (not on a dry run, not when opted out)", async () => {
    const c = fakeCurl();
    const home = newHome();
    expect(sh("setup.sh", flags, env(home, makeRelease())).exitCode).toBe(0);
    const dry = sh("uninstall.sh", ["--yes", "--dry-run"], withUrl(home, "", c));
    expect(dry.exitCode, out(dry)).toBe(0);
    const off = sh("uninstall.sh", ["--yes", "--no-analytics"], withUrl(home, "", c));
    expect(off.exitCode, out(off)).toBe(0);
    await Bun.sleep(200);
    expect(calls(c.log)).toEqual([]);
    expect(sh("setup.sh", flags, env(home, makeRelease())).exitCode).toBe(0);
    const r = sh("uninstall.sh", ["--yes"], withUrl(home, "", c));
    expect(r.exitCode, out(r)).toBe(0);
    await waitFor(c.log, 1);
    expect(bodies(c.log)[0]).toMatchObject({ name: "uninstall_finished", os: mac ? "macos" : "linux", installer: "uninstall.sh" });
  });
});

// no PowerShell here: pin the shape of the Windows scripts by reading them (a PC run checks the behaviour)
describe("setup.ps1 / uninstall.ps1: the anonymous install count (static)", () => {
  const setup = readFileSync(join(root, "setup.ps1"), "utf8").replace(/\r\n/g, "\n");
  const un = readFileSync(join(root, "uninstall.ps1"), "utf8").replace(/\r\n/g, "\n");
  test("opt-outs, skips, notice, no secret and a short timeout", () => {
    for (const src of [setup, un]) {
      expect(src).toContain("NOOKDECK_NO_ANALYTICS");
      expect(src).toContain("DO_NOT_TRACK");
      expect(src).toContain("-NoAnalytics");
      expect(src).toContain("-TimeoutSec 3");
      expect(src).toContain("catch { }");
      expect(src).toContain("NOOKDECK_TEST_SANDBOX");
      expect(src).toContain("NOOKDECK_INSTALL_HOME");
      expect(src).toContain("https://nookdeck.app/api/event");
      expect(src).not.toMatch(/\$env:(COMPUTERNAME|USERNAME|USERPROFILE)[^\n]*(body|Body)/);
    }
    expect(setup).toContain("NOOKDECK_RELEASE_BASE");
    expect(setup).toContain("Sends an anonymous install count to nookdeck.app (opt out: NOOKDECK_NO_ANALYTICS=1)");
    expect(un).toContain("Sends an anonymous uninstall count to nookdeck.app (opt out: NOOKDECK_NO_ANALYTICS=1)");
  });
  test("the events and fields of the setup script", () => {
    expect(setup).toContain("Track 'install_started'");
    expect(setup).toContain("Track 'install_finished' @{ mode = $mode; version = (VerOf $S.newVersion); from_version = (VerOf $S.oldVersion) } $true");
    expect(setup).toContain("Track 'install_failed' @{ step = $S.cur; reason = (Reason-Code $what) } $true");
    expect(setup).toContain("os = 'windows'");
    expect(setup).toContain("installer = 'setup.ps1'");
    expect(setup).toContain("'migrated'");
    expect(un).toContain("name = 'uninstall_finished'");
    expect(un).toContain("installer = 'uninstall.ps1'");
    // the failure reason is a code, not the message
    expect(setup).toContain("function Reason-Code");
    // the dry-run and the early return of the uninstaller never send
    expect(un.indexOf("if ($DryRun) { Warn 'dry run")).toBeLessThan(un.indexOf("Track-Uninstalled\n}"));
  });
});
