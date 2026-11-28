import "./_fetch";
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WIN } from "./_os";

process.env.NOOKDECK_HOME = mkdtempSync(join(tmpdir(), "pd-host-home-"));
const { PluginStore } = await import("../src/plugins/store");
const { PluginHosts } = await import("../src/plugins/hosts");
const { PluginServices } = await import("../src/plugins/capabilities");
const { hostArgv, hostEnv } = await import("../src/plugins/process");
const { scaffold, zipFiles, pluginPack, pluginDev } = await import("../src/plugins/cli");
const { parseManifest } = await import("../src/plugins/manifest");

const tmp = (p = "pd-host-") => mkdtempSync(join(tmpdir(), p));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hosts: Array<InstanceType<typeof PluginHosts>> = [];
afterAll(async () => { await Promise.all(hosts.map((h) => h.stopAll())); });

/** A plugin folder: manifest + index.js with the given activate() body. */
function plugin(id: string, body: string, o: { permissions?: Record<string, unknown>; widgets?: string[]; actions?: string[]; version?: string } = {}): string {
  const dir = tmp("pd-plugsrc-");
  writeFileSync(join(dir, "nookdeck.json"), JSON.stringify({
    id, name: id, version: o.version ?? "1.0.0", main: "index.js", permissions: o.permissions ?? {},
    widgets: (o.widgets ?? ["w"]).map((w) => ({ id: w, name: w, render: "text" })),
    actions: (o.actions ?? ["a"]).map((a) => ({ id: a, name: a })),
  }));
  writeFileSync(join(dir, "index.js"), `export function activate(ctx) {\n${body}\n}\n`);
  return dir;
}

async function setup(plugins: Array<{ dir: string; id: string }>, over: Record<string, unknown> = {}) {
  const d = tmp();
  const store = new PluginStore({ dir: join(d, "plugins"), stateFile: join(d, "plugins.json"), agentVersion: "0.3.1" });
  await store.load();
  for (const p of plugins) {
    const r = await store.install(p.dir);
    await store.grant(p.id, r.plugin.permissions);
    await store.setEnabled(p.id, true);
  }
  const fetchLog: string[] = [];
  const h = new PluginHosts(store, {
    fetch: (async (u: any) => { fetchLog.push(String(u)); return new Response("ok", { status: 200 }); }) as any,
    shell: async (c) => ({ code: 0, stdout: `ran ${c}` }),
    keys: { hotkey: async () => {}, type: async () => {} },
    logDir: join(d, "logs"), dataDir: join(d, "data"),
    timing: { pingIntervalMs: 150, pingTimeoutMs: 500, callTimeoutMs: 8000, backoffMs: [60, 120], restartMax: 5 },
    ...over,
  } as any);
  hosts.push(h);
  return { store, h, d, fetchLog };
}
const textOf = (u: any): string => String(u?.data?.body ?? "");

describe("code plugin: the happy path", () => {
  test("provider, action, settings, storage, log, push — through a real host process", async () => {
    const dir = plugin("dev.t.happy", `
      ctx.log("hello", { a: 1 });
      ctx.widgets.provide("w", async (s) => {
        const n = Number((await ctx.storage.get("n")) ?? 0) + 1;
        await ctx.storage.set("n", n);
        return { render: "text", data: { body: "n=" + n + " id=" + ctx.id + " who=" + (s.who ?? "-") + " shell=" + typeof ctx.shell + " keys=" + typeof ctx.keys } };
      }, { every: 7 });
      ctx.actions.handle("a", async (s) => { ctx.widgets.push("w", { render: "text", data: { body: "pushed " + s.x } }); });
    `, { permissions: { storage: true } });
    const { h, store, d } = await setup([{ dir, id: "dev.t.happy" }]);
    const pushed: string[] = [];
    h.onPush((_p, w, u) => pushed.push(`${w}:${textOf(u)}`));
    const u1 = await h.widget("dev.t.happy", "w", { who: "me" });
    expect(textOf(u1)).toBe("n=1 id=dev.t.happy who=me shell=undefined keys=undefined");
    expect(textOf(await h.widget("dev.t.happy", "w", {}))).toContain("n=2");
    expect(h.every("dev.t.happy", "w")).toBe(7);
    await h.action("dev.t.happy", "a", { x: 5 });
    await sleep(100);
    expect(pushed).toEqual(["w:pushed 5"]);
    expect(h.info("dev.t.happy")).toMatchObject({ state: "running", restarts: 0 });
    expect(h.info("dev.t.happy").pid).toBeGreaterThan(0);
    // the plugin's log
    expect(h.logs("dev.t.happy", 20).join("\n")).toContain('hello {"a":1}');
    // storage is a JSON file per plugin, 0600
    expect(JSON.parse(readFileSync(join(d, "data", "dev.t.happy.json"), "utf8")).n).toBe(2);
    // an unknown widget id is a clean error
    await expect(h.widget("dev.t.happy", "nope", {})).rejects.toThrow("no provider");
    void store;
  });

  test("settings changes reach the running plugin", async () => {
    const dir = plugin("dev.t.set", `
      let cur = ctx.settings.get();
      ctx.settings.onChange?.((s) => { cur = s; });
      ctx.widgets.provide("w", async () => ({ render: "text", data: { body: JSON.stringify(cur) } }));
    `);
    const m = JSON.parse(readFileSync(join(dir, "nookdeck.json"), "utf8"));
    m.settings = [{ key: "k", type: "string", label: "K" }];
    writeFileSync(join(dir, "nookdeck.json"), JSON.stringify(m));
    const { h, store } = await setup([{ dir, id: "dev.t.set" }]);
    expect(textOf(await h.widget("dev.t.set", "w", {}))).toBe("{}");
    await store.setSettings("dev.t.set", { k: "v1" });
    await sleep(300);
    expect(textOf(await h.widget("dev.t.set", "w", {}))).toBe('{"k":"v1"}');
  });

  test("ctx.settings.get() holds the manifest defaults until the owner saves a value", async () => {
    const dir = plugin("dev.t.defaults", `
      let cur = ctx.settings.get();
      ctx.settings.onChange?.((s) => { cur = s; });
      ctx.widgets.provide("w", async () => ({ render: "text", data: { body: JSON.stringify(cur) + " " + JSON.stringify(ctx.settings.get()) } }));
    `);
    const m = JSON.parse(readFileSync(join(dir, "nookdeck.json"), "utf8"));
    m.settings = [
      { key: "coins", type: "string", label: "Coins", default: "BTC, ETH, SOL" },
      { key: "currency", type: "select", label: "Currency", options: ["usd", "eur"], default: "usd" },
      { key: "key", type: "secret", label: "Key" },
    ];
    writeFileSync(join(dir, "nookdeck.json"), JSON.stringify(m));
    const { h, store } = await setup([{ dir, id: "dev.t.defaults" }]);
    const both = (o: unknown) => `${JSON.stringify(o)} ${JSON.stringify(o)}`;
    expect(textOf(await h.widget("dev.t.defaults", "w", {}))).toBe(both({ coins: "BTC, ETH, SOL", currency: "usd" }));
    // a saved value wins, and reaches the running plugin with the defaults of the fields left alone
    await store.setSettings("dev.t.defaults", { coins: "DOGE", key: "s3cret" });
    await sleep(300);
    expect(textOf(await h.widget("dev.t.defaults", "w", {}))).toBe(both({ coins: "DOGE", currency: "usd", key: "s3cret" }));
    // a cleared field is removed by the store, so its default comes back
    await store.setSettings("dev.t.defaults", { coins: "", currency: "eur" });
    await sleep(300);
    expect(textOf(await h.widget("dev.t.defaults", "w", {}))).toBe(both({ coins: "BTC, ETH, SOL", currency: "eur", key: "s3cret" }));
  });
});

describe("crash isolation, hang kill, backoff", () => {
  test("a crash in one plugin does not touch another; the crashed one restarts", async () => {
    const a = plugin("dev.t.crashy", `
      ctx.widgets.provide("w", async () => ({ render: "text", data: { body: "pid " + process.pid } }));
      ctx.actions.handle("a", async () => { setTimeout(() => process.exit(3), 10); });
    `);
    const b = plugin("dev.t.steady", `ctx.widgets.provide("w", async () => ({ render: "text", data: { body: "steady" } }));`);
    const { h } = await setup([{ dir: a, id: "dev.t.crashy" }, { dir: b, id: "dev.t.steady" }]);
    const pid1 = textOf(await h.widget("dev.t.crashy", "w", {}));
    expect(textOf(await h.widget("dev.t.steady", "w", {}))).toBe("steady");
    await h.action("dev.t.crashy", "a", {});
    await sleep(80);
    expect(["crashed", "stopped", "running"]).toContain(h.info("dev.t.crashy").state);
    expect(h.info("dev.t.crashy").restarts).toBeGreaterThanOrEqual(1);
    expect(textOf(await h.widget("dev.t.steady", "w", {}))).toBe("steady"); // the other plugin never noticed
    // after the backoff it is back, as a new process
    let pid2 = "";
    for (let i = 0; i < 40 && !pid2; i++) { await sleep(100); try { pid2 = textOf(await h.widget("dev.t.crashy", "w", {})); } catch { /* still restarting */ } }
    expect(pid2).toStartWith("pid ");
    expect(pid2).not.toBe(pid1);
    expect(h.logs("dev.t.crashy", 50).join("\n")).toContain("process ended with code 3");
  });

  test("a plugin stuck in a loop stops answering its ping: killed, and it comes back", async () => {
    const dir = plugin("dev.t.hang", `
      ctx.widgets.provide("w", async () => ({ render: "text", data: { body: "alive" } }));
      ctx.actions.handle("a", async () => { while (true) {} });
    `);
    const { h } = await setup([{ dir, id: "dev.t.hang" }]);
    expect(textOf(await h.widget("dev.t.hang", "w", {}))).toBe("alive");
    const t0 = Date.now();
    await expect(h.action("dev.t.hang", "a", {})).rejects.toThrow(); // the process is killed, the pending call fails
    expect(Date.now() - t0).toBeLessThan(5000); // not the 8 s call timeout: the heartbeat killed it
    expect(h.info("dev.t.hang").lastError).toContain("stopped answering");
    expect(h.info("dev.t.hang").restarts).toBeGreaterThanOrEqual(1);
    let ok = "";
    for (let i = 0; i < 40 && !ok; i++) { await sleep(100); try { ok = textOf(await h.widget("dev.t.hang", "w", {})); } catch { /* restarting */ } }
    expect(ok).toBe("alive");
  });

  test("a plugin that cannot even start is given up on after restartMax and switched off", async () => {
    const dir = plugin("dev.t.broken", `throw new Error("boom");`);
    const failed: string[] = [];
    const { h } = await setup([{ dir, id: "dev.t.broken" }], { timing: { pingIntervalMs: 150, backoffMs: [20], restartMax: 2 } });
    h.onFailed((id) => failed.push(id));
    await expect(h.widget("dev.t.broken", "w", {})).rejects.toThrow("activate failed");
    for (let i = 0; i < 60 && !failed.length; i++) await sleep(100);
    expect(failed).toEqual(["dev.t.broken"]);
    expect(h.info("dev.t.broken").state).toBe("failed");
    expect(h.info("dev.t.broken").lastError).toContain("crashed");
  });
});

describe("permissions and the fetch host check", () => {
  test("what an undeclared plugin may and may not do", async () => {
    const dir = plugin("dev.t.none", `
      ctx.widgets.provide("w", async () => {
        const out = [];
        for (const [n, f] of [["storage", () => ctx.storage.set("k", 1)], ["net", () => ctx.net.fetch("https://example.com/")]]) {
          try { await f(); out.push(n + ":allowed"); } catch (e) { out.push(n + ":" + e.name + ":" + (e.permission ?? "")); }
        }
        out.push("shell:" + typeof ctx.shell, "keys:" + typeof ctx.keys);
        return { render: "text", data: { body: out.join(" ") } };
      });
    `);
    const { h, fetchLog } = await setup([{ dir, id: "dev.t.none" }]);
    expect(textOf(await h.widget("dev.t.none", "w", {}))).toBe("storage:PluginPermissionError:storage net:PluginPermissionError:network shell:undefined keys:undefined");
    expect(fetchLog).toEqual([]);
  });

  test("a granted plugin gets shell and keys; revoking a permission takes effect at once", async () => {
    const dir = plugin("dev.t.all", `
      ctx.widgets.provide("w", async () => {
        const r = await ctx.shell.run("echo hi");
        await ctx.keys.hotkey("cmd+c");
        return { render: "text", data: { body: r.stdout } };
      });
    `, { permissions: { shell: true, keyboard: true } });
    const { h, store } = await setup([{ dir, id: "dev.t.all" }]);
    expect(textOf(await h.widget("dev.t.all", "w", {}))).toBe("ran echo hi");
    // narrowing the grant disables the plugin: no further call reaches it
    await store.grant("dev.t.all", { network: [], shell: true });
    await expect(h.widget("dev.t.all", "w", {})).rejects.toThrow("plugin not running");
  });

  test("net.fetch: declared hosts only, checked on every redirect hop, body capped", async () => {
    const calls: string[] = [];
    const responses: Record<string, () => Response> = {
      "https://api.ok.com/a": () => new Response(null, { status: 302, headers: { location: "https://api.ok.com/b" } }),
      "https://api.ok.com/b": () => new Response("hello", { status: 200, headers: { "x-t": "1", "set-cookie": "s=1" } }),
      "https://api.ok.com/evil": () => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }),
      "https://api.ok.com/big": () => new Response(new Uint8Array(6_000_000)),
      "https://evil.example/steal": () => new Response("stolen"),
    };
    const svc = new PluginServices({
      granted: () => ({ network: ["api.ok.com", "*.cdn.ok.com"] }),
      fetch: (async (u: any, init: any) => { calls.push(`${init?.method} ${u}`); return responses[String(u)]?.() ?? new Response("?", { status: 404 }); }) as any,
      shell: async () => ({ code: 0, stdout: "" }), keys: { hotkey: async () => {}, type: async () => {} }, dataFile: join(tmp(), "d.json"),
    });
    const r = await svc.netFetch("https://api.ok.com/a");
    expect(r).toMatchObject({ status: 200, url: "https://api.ok.com/b" });
    expect(Buffer.from(r.bodyBase64, "base64").toString()).toBe("hello");
    expect(r.headers["x-t"]).toBe("1");
    expect(r.headers["set-cookie"]).toBeUndefined();
    await expect(svc.netFetch("https://evil.example/x")).rejects.toMatchObject({ code: -32002 });
    await expect(svc.netFetch("https://api.ok.com/evil")).rejects.toMatchObject({ code: -32002 }); // the redirect hop
    expect(calls.some((c) => c.includes("evil.example"))).toBe(false); // never even asked
    await expect(svc.netFetch("ftp://api.ok.com/x")).rejects.toThrow("only http");
    await expect(svc.netFetch("https://user:pw@api.ok.com/x")).rejects.toThrow("user name");
    await expect(svc.netFetch("https://api.ok.com/big")).rejects.toMatchObject({ code: -32005 });
    await expect(svc.netFetch("https://x.cdn.ok.com/y")).resolves.toMatchObject({ status: 404 });
    await expect(svc.netFetch("https://cdn.ok.com/y")).rejects.toMatchObject({ code: -32002 }); // *.cdn.ok.com is subdomains only
  });

  test("storage: size limit, no prototype tricks", async () => {
    const svc = new PluginServices({
      granted: () => ({ network: [], storage: true }), fetch: fetch as any, shell: async () => ({ code: 0, stdout: "" }),
      keys: { hotkey: async () => {}, type: async () => {} }, dataFile: join(tmp(), "d.json"),
    });
    await svc.storageSet("__proto__", { x: 1 });
    expect(await svc.storageGet("__proto__")).toEqual({ x: 1 });
    expect(({} as any).x).toBeUndefined();
    await expect(svc.storageSet("big", "x".repeat(1_100_000))).rejects.toMatchObject({ code: -32005 });
    expect(await svc.storageGet("big")).toBeNull();
  });
});

describe("the host removes the raw escape hatches (D5, best effort)", () => {
  test("spawn, child_process, raw fetch and file writes are refused with a hint", async () => {
    const dir = plugin("dev.t.guards", `
      const out = [];
      ctx.widgets.provide("w", async () => {
        const probes = {
          bunSpawn: () => Bun.spawn(["echo", "x"]),
          bunSpawnSync: () => Bun.spawnSync(["echo", "x"]),
          bunShell: () => Bun.$\`echo x\`,
          cp: () => require("node:child_process").execSync("echo x"),
          fetch: () => fetch("https://example.com"),
          fsWrite: () => require("node:fs").writeFileSync(${JSON.stringify(join(tmpdir(), "pd-guard-escape.txt"))}, "x"),
          bunWrite: () => Bun.write(${JSON.stringify(join(tmpdir(), "pd-guard-escape2.txt"))}, "x"),
        };
        const res = [];
        for (const [n, f] of Object.entries(probes)) { try { await f(); res.push(n + ":ALLOWED"); } catch (e) { res.push(n + ":" + (String(e.message).includes("not available to plugins") ? "blocked" : e.message)); } }
        return { render: "text", data: { body: res.join(" ") } };
      });
    `);
    const { h } = await setup([{ dir, id: "dev.t.guards" }]);
    const body = textOf(await h.widget("dev.t.guards", "w", {}));
    expect(body).toBe("bunSpawn:blocked bunSpawnSync:blocked bunShell:blocked cp:blocked fetch:blocked fsWrite:blocked bunWrite:blocked");
    expect(existsSync(join(tmpdir(), "pd-guard-escape.txt"))).toBe(false);
    expect(existsSync(join(tmpdir(), "pd-guard-escape2.txt"))).toBe(false);
  });

  test("the plugin's console and stdout do not break the channel; the host gets no secrets from the agent's environment", async () => {
    process.env.NOOKDECK_SECRET_PROBE = "leak";
    const dir = plugin("dev.t.env", `
      console.log("to the log");
      process.stdout.write("garbage that is not json\\n");
      ctx.widgets.provide("w", async () => ({ render: "text", data: { body: "probe=" + (process.env.NOOKDECK_SECRET_PROBE ?? "none") } }));
    `);
    const { h } = await setup([{ dir, id: "dev.t.env" }]);
    expect(textOf(await h.widget("dev.t.env", "w", {}))).toBe("probe=none");
    const log = h.logs("dev.t.env", 20).join("\n");
    expect(log).toContain("to the log");
    expect(log).toContain("garbage that is not json");
    expect(Object.keys(hostEnv({ PATH: "/bin", NOOKDECK_X: "1", SECRET: "s", HOME: "/h" })).sort()).toEqual(["BUN_OPTIONS", "HOME", "NOOKDECK_PLUGIN_HOST", "PATH"]);
    delete process.env.NOOKDECK_SECRET_PROBE;
  });
});

describe("hostArgv", () => {
  test("a compiled binary runs itself; from source it runs bun on index.ts", () => {
    expect(hostArgv("/p", "/usr/local/bin/nookdeck", "/x/index.ts")).toEqual(["/usr/local/bin/nookdeck", "__plugin-host", "/p"]);
    expect(hostArgv("/p", "/home/u/.bun/bin/bun", "/x/index.ts")).toEqual(["/home/u/.bun/bin/bun", "/x/index.ts", "__plugin-host", "/p"]);
  });
});

describe("plugin dev: link, reload on change", () => {
  test("link reads the folder in place; reload restarts the process with the new code", async () => {
    const dir = plugin("dev.t.dev", `ctx.widgets.provide("w", async () => ({ render: "text", data: { body: "v1" } }));`);
    const d = tmp();
    const store = new PluginStore({ dir: join(d, "plugins"), stateFile: join(d, "plugins.json"), agentVersion: "0.2.0" });
    await store.load();
    const h = new PluginHosts(store, {
      fetch: fetch as any, shell: async () => ({ code: 0, stdout: "" }), keys: { hotkey: async () => {}, type: async () => {} },
      logDir: join(d, "logs"), dataDir: join(d, "data"), timing: { pingIntervalMs: 500 },
    } as any);
    hosts.push(h);
    const linked = await store.link(dir);
    expect(linked.plugin).toMatchObject({ id: "dev.t.dev", enabled: true, linked: true, code: true, main: "index.js" });
    expect(store.dirOf("dev.t.dev")).toBe(dir); // in place, not copied
    expect(textOf(await h.widget("dev.t.dev", "w", {}))).toBe("v1");
    const pid1 = h.info("dev.t.dev").pid;
    writeFileSync(join(dir, "index.js"), `export function activate(ctx) { ctx.widgets.provide("w", async () => ({ render: "text", data: { body: "v2" } })); }\n`);
    await store.reload("dev.t.dev");
    await sleep(100);
    expect(textOf(await h.widget("dev.t.dev", "w", {}))).toBe("v2");
    expect(h.info("dev.t.dev").pid).not.toBe(pid1);
    // a plugin installed from a package cannot be linked over, and only a linked one reloads
    await store.remove("dev.t.dev");
    expect(existsSync(join(dir, "index.js"))).toBe(true); // the author's folder is never deleted
    const other = plugin("dev.t.pkg", `ctx.widgets.provide("w", async () => ({ render: "text", data: { body: "x" } }));`);
    await store.install(other);
    await expect(store.link(other)).rejects.toThrow("already installed");
    await expect(store.reload("dev.t.pkg")).rejects.toThrow("only a plugin linked");
  });

  test("the dev command links through the agent's REST and reloads on a file change", async () => {
    const calls: Array<{ path: string; body: any; csrf: string | null }> = [];
    const fakeFetch = (async (u: any, init: any) => {
      const path = new URL(String(u)).pathname;
      calls.push({ path, body: JSON.parse(init.body), csrf: new Headers(init.headers).get("x-nookdeck") });
      return Response.json(path.endsWith("/reload") ? { id: "dev.t.x", version: "1.0.1" } : { id: "dev.t.x", version: "1.0.0", code: true }, { status: 201 });
    }) as any;
    let fire: (ev: string, name: string) => void = () => {};
    const closed: boolean[] = [];
    const fakeWatch = ((_dir: string, _o: any, cb: any) => { fire = cb; return { close: () => closed.push(true) }; }) as any;
    const lines: string[] = [];
    const dev = await pluginDev(tmp(), 7499, { fetch: fakeFetch, watch: fakeWatch, log: (s) => lines.push(s), debounceMs: 20 });
    expect(calls[0]).toMatchObject({ path: "/api/plugins", csrf: "1", body: { link: true } });
    fire("change", "index.ts"); fire("change", "node_modules/x/y.js"); fire("change", "index.ts");
    await sleep(120);
    expect(calls.filter((c) => c.path.endsWith("/reload")).length).toBe(1); // debounced, node_modules ignored
    dev.stop();
    expect(closed).toEqual([true]);
    expect(lines.join("\n")).toContain("Linked dev.t.x");
    // no agent: a clear message
    await expect(pluginDev(tmp(), 7499, { fetch: (async () => { throw new Error("fetch failed"); }) as any, watch: fakeWatch, log: () => {} })).rejects.toThrow("Start it first");
  });
});

describe("plugin new and pack", () => {
  test("the scaffold is a valid code plugin", () => {
    const s = scaffold("My Clock", { user: "Alice" });
    expect(s.id).toBe("dev.alice.my-clock");
    const m = parseManifest(JSON.parse(s.files["nookdeck.json"]!));
    expect(m).toMatchObject({ main: "index.ts", permissions: { storage: true } });
    expect(m.widgets[0]!.source).toEqual({ agent: {} });
    expect(Object.keys(s.files).sort()).toEqual([".gitignore", "README.md", "index.ts", "nookdeck.json", "package.json", "tsconfig.json"]);
    expect(() => scaffold("!!!")).toThrow("give the plugin a name");
  });

  test("the scaffolded plugin really runs in a host", async () => {
    const s = scaffold("Smoke", { id: "dev.t.smoke" });
    const dir = tmp("pd-new-");
    for (const [f, text] of Object.entries(s.files)) writeFileSync(join(dir, f), text);
    const { h } = await setup([{ dir, id: "dev.t.smoke" }]);
    expect(String((await h.widget("dev.t.smoke", "clock", {})).data && "ok")).toBe("ok");
    await h.action("dev.t.smoke", "ping", {});
    expect((await h.widget("dev.t.smoke", "clock", {}) as any).data.label).toBe("opened 1x");
  });

  test("pack: a zip, deterministic, with the sha256 the registry pins", async () => {
    const dir = plugin("dev.t.pack", `ctx.log("x");`);
    const out = join(tmp(), "p.zip");
    const a = await pluginPack([dir, "--out", out], () => {});
    const bytes1 = readFileSync(out);
    const b = await pluginPack([dir, "--out", out], () => {});
    expect(b.zipSha256).toBe(a.zipSha256); // same files, same bytes
    expect(readFileSync(out).equals(bytes1)).toBe(true);
    expect(a.packageSha256).toMatch(/^[0-9a-f]{64}$/);
    // the install pins the same hash the pack printed
    const d = tmp();
    const store = new PluginStore({ dir: join(d, "p"), stateFile: join(d, "p.json"), agentVersion: "0.2.0" });
    await store.load();
    expect((await store.install(dir)).plugin.sha256).toBe(a.packageSha256);
    // a real zip: local headers, central directory, end record
    expect(bytes1.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes1.readUInt32LE(bytes1.length - 22)).toBe(0x06054b50);
    expect(bytes1.readUInt16LE(bytes1.length - 22 + 10)).toBe(2); // nookdeck.json + index.js
    if (!WIN && Bun.which("unzip")) {
      const r = Bun.spawnSync(["unzip", "-t", out]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.toString()).toContain("No errors");
    }
    expect(zipFiles(new Map()).length).toBe(22);
  });
});

describe("REST: process, logs, restart, stop, reload (local only)", () => {
  test("the manage page can see and control a plugin's process", async () => {
    const { startServer } = await import("../src/server");
    const dir = plugin("dev.t.rest", `
      console.log("rest hello");
      ctx.widgets.provide("w", async () => ({ render: "text", data: { body: "rest ok" } }));
    `);
    const d = tmp();
    const store = new PluginStore({ dir: join(d, "plugins"), stateFile: join(d, "plugins.json"), agentVersion: "0.2.0" });
    const app = await startServer({
      port: 0, pin: "111111", plugins: store, hostName: async () => "x", deps: { startStats: () => () => {} } as any,
      pluginHostDeps: { logDir: join(d, "logs"), dataDir: join(d, "data"), timing: { pingIntervalMs: 500 } },
      hookSecret: "s", hookPaths: { claude: join(d, "c.json"), codex: join(d, "x.json") },
    } as any);
    try {
      const base = `http://localhost:${app.port}`;
      const post = (path: string, body: unknown = {}) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-nookdeck": "1" }, body: JSON.stringify(body) });
      const linked = await post("/api/plugins", { source: dir, link: true });
      expect(linked.status).toBe(201);
      const sum = await linked.json() as any;
      expect(sum).toMatchObject({ id: "dev.t.rest", code: true, main: "index.js", linked: true, enabled: true });
      expect(await (await fetch(`${base}/api/plugins/dev.t.rest/process`)).json()).toMatchObject({ state: "stopped", restarts: 0 }); // lazy: nothing asked yet
      const r = await post("/api/plugins/dev.t.rest/restart");
      expect(r.status).toBe(200);
      // a tile on the layout would start it; here the restart endpoint only resets it, so start it through a widget call
      const hostsApi = await fetch(`${base}/api/plugins/dev.t.rest/logs?lines=5`);
      expect(await hostsApi.json()).toEqual({ lines: [] });
      expect((await post("/api/plugins/dev.t.rest/stop")).status).toBe(200);
      expect((await fetch(`${base}/api/plugins/dev.t.nope/process`)).status).toBe(404);
      expect((await post("/api/plugins/dev.t.rest/reload")).status).toBe(200);
      // not from a stranger: wrong Host, or no CSRF header
      expect((await fetch(`${base}/api/plugins/dev.t.rest/process`, { headers: { host: "evil.example" } })).status).toBeGreaterThanOrEqual(400);
      const { rawFetch } = await import("./_fetch");
      expect((await rawFetch(`${base}/api/plugins/dev.t.rest/restart`, { method: "POST" })).status).toBeGreaterThanOrEqual(400);
    } finally { app.stop(); }
  });
});

describe("settings never become code in a command line", () => {
  const evil = ["it's", "'; touch PWNED; '", "$(touch PWNED)", "`touch PWNED`", "a\" & echo x & \"", "x\nreboot", "'' ; $env:X"];
  test("{{key}} is refused in shell steps and command sources, and still fine in other fields", () => {
    const base = { id: "dev.t.inj", name: "I", version: "1.0.0", permissions: { shell: true } };
    const settings = [{ key: "text", type: "string", label: "T" }];
    expect(() => parseManifest({ ...base, actions: [{ id: "a", name: "A", settings, run: { macro: [{ kind: "shell", command: "printf '%s' '{{text}}' | pbcopy" }] } }] })).toThrow("must not use {{settings}}");
    expect(() => parseManifest({ ...base, widgets: [{ id: "w", name: "W", render: "text", settings, source: { command: { run: "echo {{text}}" } } }] })).toThrow("NOOKDECK_SETTING_");
    expect(() => parseManifest({ ...base, actions: [{ id: "a", name: "A", settings, run: { macro: [{ kind: "shell", command: "pbcopy < /dev/null" }, { kind: "notify", text: "{{text}}" }] } }] })).not.toThrow();
  });

  test("a shell step carries the values in its environment, not in the command", async () => {
    const { actionSteps, settingsEnv } = await import("../src/plugins/sources");
    const m = parseManifest({ id: "dev.t.inj2", name: "I", version: "1.0.0", permissions: { shell: true }, actions: [{ id: "a", name: "A", settings: [{ key: "text", type: "string", label: "T" }], run: { macro: [{ kind: "shell", command: 'printf %s "$NOOKDECK_SETTING_TEXT"' }] } }] });
    const [st] = actionSteps(m.actions[0]!, { text: "'; rm -rf ~; '" }) as any[];
    expect(st.command).toBe('printf %s "$NOOKDECK_SETTING_TEXT"');
    expect(st.env).toEqual({ NOOKDECK_SETTING_TEXT: "'; rm -rf ~; '" });
    expect(settingsEnv({ apiKey: "k", n: 3, on: true })).toEqual({ NOOKDECK_SETTING_APIKEY: "k", NOOKDECK_SETTING_N: "3", NOOKDECK_SETTING_ON: "true" });
  });

  test.skipIf(WIN)("injection attempts come out as plain text through the real shell", async () => {
    const { realShell } = await import("../src/plugins/runtime");
    const { settingsEnv } = await import("../src/plugins/sources");
    const cwd = process.cwd();
    const dir = tmp("pd-inj-");
    process.chdir(dir);
    try {
      for (const v of evil) {
        const r = await realShell('printf %s "$NOOKDECK_SETTING_TEXT"', 5000, settingsEnv({ text: v }));
        expect(r.stdout).toBe(v);
      }
      expect(existsSync(join(dir, "PWNED"))).toBe(false);
    } finally { process.chdir(cwd); }
  });

  test("the example plugin reads the environment", () => {
    const m = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/plugins/clipboard-snippets/nookdeck.json"), "utf8"));
    expect(() => parseManifest(m)).not.toThrow();
    expect(JSON.stringify(m)).not.toContain("{{");
  });
});

describe("the SDK import and load errors", () => {
  const { cpSync } = require("node:fs") as typeof import("node:fs");
  test("github-stars (import from @nookdeck/plugin, no node_modules) gives a stat tile and a chart", async () => {
    const dir = tmp("pd-stars-");
    cpSync(join(import.meta.dir, "fixtures/plugins/github-stars"), dir, { recursive: true });
    const seen: string[] = [];
    const { h } = await setup([{ dir, id: "dev.nookdeck.github-stars" }], {
      fetch: (async (u: any, init: any) => { seen.push(`${u} ${init?.headers?.Authorization ?? ""}`); return Response.json({ stargazers_count: 4242 }); }) as any,
    });
    const s: any = await h.widget("dev.nookdeck.github-stars", "stars", { repo: "a/b" });
    expect(s).toEqual({ render: "stat", data: { value: 4242, label: "a/b" } });
    const c: any = await h.widget("dev.nookdeck.github-stars", "history", { repo: "a/b" });
    expect(c.data.points).toEqual([4242]);
    expect(seen[0]).toContain("https://api.github.com/repos/a/b");
    expect(h.every("dev.nookdeck.github-stars", "stars")).toBe(300);
  });

  test("another bare package is refused with a clear message, and a load error goes straight to failed", async () => {
    const dir = plugin("dev.t.dep", `ctx.log("never");`);
    writeFileSync(join(dir, "index.js"), `import x from "left-pad";\nexport function activate(ctx) { x(); }\n`);
    const failed: string[] = [];
    const { h } = await setup([{ dir, id: "dev.t.dep" }], { timing: { pingIntervalMs: 150, backoffMs: [20], restartMax: 5 } });
    h.onFailed((id) => failed.push(id));
    await expect(h.widget("dev.t.dep", "w", {})).rejects.toThrow('cannot import "left-pad"');
    for (let i = 0; i < 30 && !failed.length; i++) await sleep(50);
    expect(failed).toEqual(["dev.t.dep"]);
    expect(h.info("dev.t.dep")).toMatchObject({ state: "failed", restarts: 0 });
    expect(h.info("dev.t.dep").lastError).toContain("left-pad");
  });

  test("a syntax error is fatal too; an activate() that throws is retried", async () => {
    const dir = plugin("dev.t.syn", ``);
    writeFileSync(join(dir, "index.js"), `export function activate( {{{\n`);
    const { h } = await setup([{ dir, id: "dev.t.syn" }]);
    await expect(h.widget("dev.t.syn", "w", {})).rejects.toThrow("cannot load");
    await sleep(100);
    expect(h.info("dev.t.syn").state).toBe("failed");
  });
});

import { runPluginCli as __runCli } from "../src/plugins/cli";
test("plugin dev / pack take the folder argument even without --port or --out", async () => {
  // regression: rest.indexOf("--port") was -1, so rest[0] (the folder) was treated as the flag's value and "." was used
  const seen: string[] = [];
  const cli = await import("../src/plugins/cli");
  const orig = cli.pluginPack;
  expect(typeof orig).toBe("function");
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "nd-pack-"));
  const plug = join(dir, "p"); mkdirSync(plug);
  writeFileSync(join(plug, "nookdeck.json"), JSON.stringify({ id: "dev.test.packarg", name: "P", version: "1.0.0", nookdeck: ">=0.1.0", permissions: { network: [] }, widgets: [], actions: [], main: null }));
  const r = await cli.pluginPack([plug, "--out", join(dir, "out.zip")], (s: string) => seen.push(s));
  expect(r.file).toBe(join(dir, "out.zip"));
  // without --out the zip lands in the current folder: run it from the temp dir so the repo stays clean
  const cwd = process.cwd(); process.chdir(dir);
  try { const r2 = await cli.pluginPack([plug], () => {}); expect(r2.packageSha256).toBe(r.packageSha256); } finally { process.chdir(cwd); }
  void __runCli;
});
