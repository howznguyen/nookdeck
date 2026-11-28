import { describe, expect, test } from "bun:test";
import { readFileSync as readRaw } from "node:fs";
import { join } from "node:path";
import { assetName } from "../src/update";

// spec linux-support L1 / AC-9: the release workflow builds and publishes the Linux agent and runs the tests on Linux
const root = join(import.meta.dir, "..");
// a Windows checkout may turn LF into CRLF: compare the text, not the line endings
const readFileSync = (p: string, enc: "utf8") => readRaw(p, enc).replace(/\r\n/g, "\n");
const wf = readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8");
/** The text of one job: from "  <name>:" to the next job at the same indent. */
const job = (name: string): string => {
  const m = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:\\n|$)`).exec(wf);
  if (!m) throw new Error(`no job ${name}`);
  return m[1]!;
};
const LINUX = ["x64", "arm64"].map((a) => assetName("linux", a));

describe("release.yml: the Linux agent", () => {
  test("the asset names are the ones nookdeck update and setup.sh look for", () => {
    expect(LINUX).toEqual(["nookdeck-linux-x64", "nookdeck-linux-arm64"]);
    expect(readFileSync(join(root, "setup.sh"), "utf8")).toContain('asset="nookdeck-linux-$want"');
  });
  test("test-linux runs the whole suite on ubuntu, and the macOS release job waits for it", () => {
    const t = job("test-linux");
    expect(t).toContain("runs-on: ubuntu-latest");
    expect(t).toContain("run: bun run test");
    expect(job("release")).toMatch(/needs: \[test-windows, test-linux\]/);
  });
  test("linux-cli compiles both on Linux, checks the version, and sums the binaries and their gzip copies", () => {
    const l = job("linux-cli");
    expect(l).toContain("runs-on: ubuntu-latest");
    expect(l).toContain("needs: test-linux");
    expect(l).toContain('--target="bun-linux-$arch"');
    expect(l).toMatch(/for arch in x64 arm64/);
    expect(l).toContain("bun run gen-assets");
    expect(l).toContain("./dist/nookdeck-linux-x64 --version");
    for (const n of LINUX) {
      expect(l).toContain(`gzip -9 -n -k`);
      expect(" " + l.split("sha256sum ")[1]!.split("\n")[0]).toContain(` ${n} `);
      expect(l.split("sha256sum ")[1]!.split("\n")[0]).toContain(` ${n}.gz`);
      expect(l).toContain(`dist/${n}\n`);
      expect(l).toContain(`dist/${n}.gz\n`);
    }
  });
  test("publish needs it, adds its sums to SHA256SUMS and attaches all four files; a dry run bundles them too", () => {
    const p = job("publish");
    expect(p).toMatch(/needs: \[release, linux-cli, linux-packages, windows-app, mac-app, android-app\]/);
    expect(p).toContain("needs.linux-cli.result == 'success'");
    expect(p).toContain("cat SHA256SUMS.linux >> SHA256SUMS");
    const create = p.split("gh release create")[1]!.split("\n")[0]!;
    for (const n of LINUX) { expect(create).toContain(`dist/${n} `); expect(create).toContain(`dist/${n}.gz `); }
    const d = job("dry-run-bundle");
    expect(d).toContain("linux-cli");
    expect(d).toContain("cat SHA256SUMS.linux >> SHA256SUMS");
  });
});

// spec linux-support L7 / L9: .deb, .rpm and tarball from packaging/linux and scripts/package-linux.sh
describe("Linux packages", () => {
  const nfpm = readFileSync(join(root, "packaging", "linux", "nfpm.yaml"), "utf8");
  const desktop = readFileSync(join(root, "packaging", "linux", "dev.nookdeck.app.desktop"), "utf8");
  test("nfpm.yaml: the tray, the agent, the menu entry and hicolor icons, at the paths the tray app expects", () => {
    for (const dst of ["/usr/bin/nookdeck-tray", "/usr/lib/nookdeck/nookdeck", "/usr/share/applications/dev.nookdeck.app.desktop", "/usr/share/icons/hicolor/scalable/apps/dev.nookdeck.app.svg"])
      expect(nfpm).toContain(`dst: ${dst}\n`);
    for (const n of [22, 24, 32, 48, 64, 128, 256]) expect(nfpm).toContain(`dst: /usr/share/icons/hicolor/${n}x${n}/apps/dev.nookdeck.app.png`);
  });
  test("nfpm.yaml: weak dependencies only, and nothing that runs as root at install time", () => {
    expect(nfpm).not.toMatch(/^\s*depends:/m);
    expect(nfpm).not.toMatch(/^\s*scripts:/m);
    expect(nfpm).not.toMatch(/postinstall|preinstall|postremove|preremove|systemd\/system/);
    const deb = nfpm.split("  deb:\n")[1]!.split("  rpm:\n")[0]!;
    for (const p of ["gnome-shell-extension-appindicator", "xdotool", "ydotool", "playerctl", "pulseaudio-utils", "libsecret-tools"]) expect(deb).toContain(`- ${p}\n`);
  });
  test("the menu entry starts the tray app with the shared icon name", () => {
    expect(desktop).toContain("Exec=/usr/bin/nookdeck-tray\n");
    expect(desktop).toContain("Icon=dev.nookdeck.app\n");
    expect(desktop).toContain("Type=Application\n");
  });
  test.skipIf(process.platform === "win32")("package-linux.sh: fills in nfpm.yaml, names the files as L7 and the tray updater expect, and builds the tarball", () => {
    const { mkdtempSync, writeFileSync, chmodSync, mkdirSync, existsSync } = require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "nd-pkg-"));
    const icons = join(dir, "icons"); mkdirSync(icons);
    for (const n of [22, 24, 32, 48, 64, 128, 256]) writeFileSync(join(icons, `app-${n}.png`), "png");
    writeFileSync(join(icons, "app.svg"), "<svg/>");
    for (const b of ["agent", "tray"]) { writeFileSync(join(dir, b), `#!/bin/sh\necho ${b}\n`); chmodSync(join(dir, b), 0o755); }
    // a fake nfpm: keeps the config it was given and creates the target
    const fake = join(dir, "nfpm");
    writeFileSync(fake, `#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in --config) cfg="$2"; shift ;; --packager) p="$2"; shift ;; --target) t="$2"; shift ;; esac; shift; done\ncp "$cfg" "${dir}/config.$p"; echo "$p" > "$t"\n`);
    chmodSync(fake, 0o755);
    const out = join(dir, "out");
    // the script needs no home, but give it a throwaway one (test/home-guard.test.ts)
    const home = join(dir, "home"); mkdirSync(home);
    const sandboxed = { HOME: home, NOOKDECK_HOME: join(home, ".nookdeck") };
    const run = (arch: string) => Bun.spawnSync(["sh", join(root, "scripts", "package-linux.sh"), arch, join(dir, "agent"), join(dir, "tray"), out], {
      env: { PATH: process.env.PATH!, ...sandboxed, NFPM: fake, ICONS_DIR: icons, NOOKDECK_VERSION: "9.8.7" },
    });
    for (const arch of ["amd64", "arm64"]) { const r = run(arch); expect(r.exitCode, r.stderr.toString()).toBe(0); }
    for (const f of ["nookdeck_9.8.7_amd64.deb", "nookdeck_9.8.7_arm64.deb", "nookdeck-9.8.7.x86_64.rpm", "nookdeck-9.8.7.aarch64.rpm", "nookdeck-linux-x64.tar.gz", "nookdeck-linux-arm64.tar.gz"])
      expect(existsSync(join(out, f))).toBe(true);
    const cfg = readFileSync(join(dir, "config.deb"), "utf8");
    expect(cfg).not.toMatch(/\$\{NFPM_[A-Z]+\}/);
    expect(cfg).toContain("arch: arm64\n");
    expect(cfg).toContain("version: 9.8.7\n");
    expect(cfg).toContain(`src: ${join(dir, "tray")}\n`);
    const list = Bun.spawnSync(["tar", "-tzf", join(out, "nookdeck-linux-x64.tar.gz")]).stdout.toString().split("\n");
    for (const p of ["nookdeck/nookdeck-tray", "nookdeck/agent/nookdeck", "nookdeck/README.txt", "nookdeck/share/applications/dev.nookdeck.app.desktop", "nookdeck/share/icons/hicolor/48x48/apps/dev.nookdeck.app.png"])
      expect(list).toContain(p);
    // a missing icon is an error, not a package without it
    const bad = Bun.spawnSync(["sh", join(root, "scripts", "package-linux.sh"), "amd64", join(dir, "agent"), join(dir, "tray"), out], { env: { PATH: process.env.PATH!, HOME: home, NOOKDECK_HOME: join(home, ".nookdeck"), NFPM: fake, ICONS_DIR: join(dir, "none") } });
    expect(bad.exitCode).not.toBe(0);
    expect(bad.stderr.toString()).toContain("missing:");
  });
  test("release.yml: linux-packages builds them after linux-cli, checks the .deb, and publish attaches and sums them", () => {
    const l = job("linux-packages");
    expect(l).toContain("needs: linux-cli");
    expect(l).toContain("sh scripts/package-linux.sh amd64 cli/nookdeck-linux-x64");
    expect(l).toContain("sh scripts/package-linux.sh arm64 cli/nookdeck-linux-arm64");
    expect(l).toContain("SHA256SUMS.linux-packages");
    const p = job("publish");
    expect(p).toContain("linux-packages");
    expect(p).toContain("cat SHA256SUMS.linux-packages >> SHA256SUMS");
    expect(p).toContain("dist/nookdeck_*.deb dist/nookdeck-*.rpm dist/nookdeck-linux-*.tar.gz");
  });
});

// spec android-app-and-usb-setup: the signed app goes into the release and SHA256SUMS, never a debug-signed one
describe("release.yml: the Android app", () => {
  test("built only with the release key, refused when debug-signed, attached and summed", () => {
    const a = job("android-app");
    expect(a).toContain("secrets.ANDROID_KEYSTORE_BASE64");
    expect(a).toContain("CN=Android Debug");
    expect(a).toContain("-PnookdeckVersion=");
    expect(a).toContain("rm -f \"$RUNNER_TEMP/release.jks\"");
    const p = job("publish");
    expect(p).toContain("Nookdeck-Setup.exe Nookdeck.apk; do");
    expect(p.split("gh release create")[1]!.split("\n")[0]!).toContain("dist/Nookdeck.apk ");
    expect(job("dry-run-bundle")).toContain("Nookdeck.apk; do");
  });
});
