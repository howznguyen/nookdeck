import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LADDER, MIN_SLOTS, axisGutter, axisTops, labelW, pickFit, procShare, shareText, textW, barFit, bootAt, chartDomain, coreGroups, fitValue, loadBand, loadPerCore, loadText, memParts, minMax, niceCeil, onLadder,
  placePoints, statBox, statSize, uptimeText, valueEm, type StatNeeds,
} from "../web/deck/src/stats-logic";
import { cleanMemDetail, coreDeltas, parseSwapUsage, parseVmStatCached, startStats, type Stats } from "../src/stats";
import { parseMeminfoDetail } from "../src/platform/linux-sys";
import { processCache } from "../src/processes";

// S20 css tile sizes (2400x1080 at dpr 2.6-ish): 1x1, 2x1, 3x1, 5x1, 2x2, 3x2, 4x2, 2x3, 3x3, 4x3, 4x4, wide 9x2
const SIZES: [string, number, number][] = [
  ["1x1", 65, 65], ["2x1", 144, 65], ["3x1", 220, 65], ["5x1", 374, 65], ["2x2", 144, 144], ["3x2", 220, 144], ["4x2", 298, 144],
  ["2x3", 144, 223], ["3x3", 220, 223], ["4x3", 298, 223], ["4x4", 298, 298], ["9x2", 680, 144],
];
const NEEDS: { [k: string]: StatNeeds } = {
  cpu: { label: true, value: "82", unit: "%", chart: true, side: true, bar: false, procs: true },
  memory: { label: true, value: "12.2", unit: "GB", chart: true, side: false, bar: true, procs: true },
  network: { label: true, value: "9", unit: "KB/s", chart: true, side: false, bar: false, procs: false },
  load: { label: true, value: "6.51", unit: "per core", chart: true, side: true, bar: false, procs: false },
  uptime: { label: true, value: "5d 12h", unit: "", chart: false, side: false, bar: false, procs: false, subText: "since 22 Nov, 21:14" },
  gpuNone: { label: true, value: "-", unit: "", chart: false, side: false, bar: false, procs: false },
};

describe("stat tile layout", () => {
  test("size classes", () => {
    const cls = (n: string) => { const s = SIZES.find((x) => x[0] === n)!; return statSize(s[1], s[2]); };
    expect(cls("1x1")).toBe("mini");
    expect(cls("2x1")).toBe("strip");
    expect(cls("5x1")).toBe("strip");
    expect(cls("2x2")).toBe("block");
    expect(cls("2x3")).toBe("block");
    expect(cls("3x2")).toBe("wide");
    expect(cls("4x2")).toBe("wide");
    expect(cls("9x2")).toBe("wide");
    expect(cls("4x3")).toBe("big");
    expect(cls("4x4")).toBe("big");
  });

  for (const [name, tw, th] of SIZES) {
    for (const k of Object.keys(NEEDS)) {
      test(`${name} ${k}: everything fits the content box, text on the ladder`, () => {
        const n = NEEDS[k]!;
        const b = statBox(tw, th, n);
        expect(b.w).toBeLessThanOrEqual(tw - 2 - b.pad * 2);
        for (const px of [b.labelPx, b.valuePx, b.subPx]) expect(LADDER).toContain(px);
        // the value fits the width it is given
        expect(valueEm(n.value, n.unit) * b.valuePx).toBeLessThanOrEqual(b.w + 0.5);
        // heights add up inside the box
        let used = 0;
        if (b.size === "mini") used = b.labelH + b.valuePx + (b.chartH ? b.chartH + 6 : 0);
        else if (b.size === "strip" && b.chartH) used = Math.max(b.labelH, b.valuePx) + 4 + 6 + b.chartH;
        else if (b.size === "strip") used = b.labelH + b.valuePx + (b.sub && !b.subInline ? 19 : 0);
        else used = b.labelH + (b.labelH ? 4 : 0) + b.valuePx + (b.sub ? 21 : 0) + (b.barH ? 6 + b.barH + 4 + b.legendH : 0) + (b.chartH ? 6 + b.chartH : 0) + (b.rows ? 6 + b.rows * b.rowH : 0);
        expect(used).toBeLessThanOrEqual(b.h + 6);
        if (!n.chart) expect(b.chartH === 0 || b.size === "mini").toBe(true);
      });
    }
  }

  test("big tiles are not empty: the chart takes the free height and the value is large", () => {
    const b42 = statBox(298, 144, NEEDS.cpu!);
    expect(b42.chartH).toBeGreaterThanOrEqual(40);
    expect(b42.grid).toBe(true);
    expect(b42.sideW).toBeGreaterThan(80);
    const b22 = statBox(144, 144, NEEDS.memory!);
    expect(b22.valuePx).toBeGreaterThanOrEqual(28);
    expect(b22.chartH).toBeGreaterThanOrEqual(24);
    expect(b22.sub).toBe(true);
    const b21 = statBox(144, 65, NEEDS.network!);
    expect(b21.chartH).toBeGreaterThanOrEqual(14);
  });

  test("4x3 and 4x4 cpu / memory list top processes, other kinds do not", () => {
    expect(statBox(298, 223, NEEDS.cpu!).rows).toBeGreaterThanOrEqual(2);
    expect(statBox(298, 298, NEEDS.memory!).rows).toBeGreaterThanOrEqual(4);
    expect(statBox(298, 298, NEEDS.network!).rows).toBe(0);
    expect(statBox(220, 144, NEEDS.cpu!).rows).toBe(0);
  });

  test("uptime on a 2x1: label and value stacked, the label is never squeezed", () => {
    const b = statBox(144, 65, NEEDS.uptime!);
    expect(b.chartH).toBe(0);
    expect(b.labelH + b.valuePx).toBeLessThanOrEqual(b.h);
    expect(b.valuePx).toBeGreaterThanOrEqual(20);
  });

  test("ladder", () => {
    expect(onLadder(5)).toBe(10);
    expect(onLadder(33)).toBe(28);
    expect(onLadder(34)).toBe(34);
    expect(fitValue("100", "%", 40, 100, 64)).toBeLessThanOrEqual(24);
  });
});

describe("stat tile text: shorter forms before an ellipsis", () => {
  test("pickFit takes the first form that fits whole, else nothing", () => {
    expect(pickFit(["/ 16 GB · 76%", "/ 16 GB"], textW("/ 16 GB · 76%", 12), 12)).toBe("/ 16 GB · 76%");
    expect(pickFit(["/ 16 GB · 76%", "/ 16 GB"], textW("/ 16 GB", 12) + 1, 12)).toBe("/ 16 GB");
    expect(pickFit(["Apple M1 Pro"], 40, 12)).toBe("");
    expect(pickFit(["SYSTEM LOAD", "LOAD"], labelW("LOAD", 11) + 2, 11, labelW)).toBe("LOAD");
  });
  test("uptime strips get the since line whole, beside the value or under it", () => {
    const wide = statBox(374, 81, NEEDS.uptime!);
    expect(wide.sub).toBe(true);
    expect(wide.subInline).toBe(true);
    const mid = statBox(270, 81, NEEDS.uptime!);
    expect(mid.sub).toBe(true);
    expect(mid.labelH + mid.valuePx + (mid.subInline ? 0 : 19)).toBeLessThanOrEqual(mid.h);
    const small = statBox(144, 65, NEEDS.uptime!);
    if (small.sub) expect(textW("since 22 Nov, 21:14", small.subPx)).toBeLessThanOrEqual(small.w);
  });
  test("memory legend gets its own row under the bar on wide tiles", () => {
    const b = statBox(298, 223, NEEDS.memory!);
    expect(b.sideW).toBe(0);
    expect(b.barH).toBe(6);
    expect(b.legendH).toBe(15);
  });
  test("process share of the whole machine", () => {
    expect(procShare(1.96, 8)).toBeCloseTo(24.5);
    expect(shareText(procShare(1.96, 8))).toBe("25%");
    expect(procShare(9, 8)).toBe(100);
    expect(shareText(0.42)).toBe("0.4%");
    expect(shareText(0.01)).toBe("<0.1%");
    expect(shareText(0)).toBe("0%");
    expect(procShare(2 * 1024 ** 3, 16 * 1024 ** 3)).toBeCloseTo(12.5);
  });
});

describe("stat tile charts", () => {
  test("peak / low labels sit in a gutter, at their values, never overlapping", () => {
    expect(axisGutter(["66%", "28%"])).toBeGreaterThan(textW("66%", 10));
    expect(axisGutter([])).toBe(0);
    const a = axisTops(5, 40, 50, false);
    expect(a.peak).toBe(0);
    expect(a.low).toBe(34);
    const close = axisTops(20, 22, 50, false);
    expect(close.low! - close.peak).toBeGreaterThanOrEqual(12);
    for (const v of [close.peak, close.low!]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(38); }
    const bottom = axisTops(48, 49, 50, false);
    expect(bottom.low!).toBeLessThanOrEqual(38);
    expect(bottom.low! - bottom.peak).toBeGreaterThanOrEqual(12);
    expect(axisTops(10, 10, 50, true).low).toBeNull();
  });
  test("a short history sits at the right edge and grows leftwards, never clipped", () => {
    const pts = placePoints([10, 20, 30], 200, 40, 0, 100, 60, 3);
    expect(pts).toHaveLength(3);
    expect(pts[2]!.x).toBe(197);
    const step = (200 - 6) / (MIN_SLOTS - 1);
    expect(pts[1]!.x).toBeCloseTo(197 - step, 1);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(3);
      expect(p.x).toBeLessThanOrEqual(197);
      expect(p.y).toBeGreaterThanOrEqual(3);
      expect(p.y).toBeLessThanOrEqual(37);
    }
  });
  test("a full window spans the whole width", () => {
    const vals = Array.from({ length: 60 }, (_, i) => i);
    const pts = placePoints(vals, 300, 50, 0, 100, 60, 3);
    expect(pts[0]!.x).toBeCloseTo(3, 5);
    expect(pts[59]!.x).toBeCloseTo(297, 5);
  });
  test("values outside the domain are clamped into the box", () => {
    const pts = placePoints([-5, 500], 100, 20, 0, 100, 60, 3);
    expect(pts[0]!.y).toBe(17);
    expect(pts[1]!.y).toBe(3);
  });
  test("one sample still gives one point (the dot)", () => {
    expect(placePoints([4], 100, 20, 0, 10, 60, 3)).toHaveLength(1);
    expect(placePoints([], 100, 20, 0, 10, 60, 3)).toHaveLength(0);
  });
  test("domains", () => {
    expect(chartDomain("cpu", [3, 4, 5])).toEqual([0, 25]);
    expect(chartDomain("cpu", [40, 82])).toEqual([0, 100]);
    expect(chartDomain("network", [0, 0])).toEqual([0, 2000]);
    const [, hi] = chartDomain("network", [9000, 12000]);
    expect(hi).toBeGreaterThanOrEqual(12000 * 1.15);
    expect(chartDomain("load", [0.2, 0.4], 1)).toEqual([0, 1]);
    expect(chartDomain("load", [12, 30], 10)[1]).toBeGreaterThanOrEqual(33);
    expect(niceCeil(0.3)).toBe(0.5);
    expect(niceCeil(7)).toBe(10);
    expect(niceCeil(2.2)).toBe(2.5);
    expect(minMax([3, 9, 1])).toEqual({ min: 1, max: 9 });
    expect(minMax([])).toBeNull();
  });
});

describe("stat tile parts", () => {
  test("cores group down to the bars that fit", () => {
    expect(coreGroups([10, 20, 30], 8)).toEqual([10, 20, 30]);
    const g = coreGroups(Array.from({ length: 64 }, (_, i) => (i % 2 ? 100 : 0)), 16);
    expect(g).toHaveLength(16);
    for (const v of g) expect(v).toBe(50);
    const f = barFit(64, 120);
    expect(f.max * 3 + (f.max - 1) * f.gap).toBeLessThanOrEqual(120);
    const f10 = barFit(10, 120);
    expect(10 * f10.bar + 9 * f10.gap).toBeLessThanOrEqual(120);
    expect(f10.bar).toBeGreaterThanOrEqual(3);
  });
  test("memory parts: cached comes out of free, sum is 1", () => {
    const p = memParts(12, 16, 3);
    expect(p.used).toBeCloseTo(0.75);
    expect(p.cached).toBeCloseTo(3 / 16);
    expect(p.used + p.cached + p.free).toBeCloseTo(1);
    const over = memParts(15, 16, 8);
    expect(over.cached).toBeCloseTo(1 / 16);
    expect(over.free).toBe(0);
    expect(memParts(1, 0)).toEqual({ used: 0, cached: 0, free: 1 });
  });
  test("load per core makes the number mean something", () => {
    expect(loadPerCore(65.11, 10)).toBeCloseTo(6.511);
    expect(loadText(6.511)).toBe("6.51");
    expect(loadText(12.34)).toBe("12.3");
    expect(loadPerCore(3, undefined)).toBeNull();
    expect(loadBand(0.5)).toBe("good");
    expect(loadBand(0.9)).toBe("watch");
    expect(loadBand(6.5)).toBe("risk");
  });
  test("uptime text and boot time", () => {
    expect(uptimeText(5 * 86400 + 12 * 3600 + 7, false)).toBe("5d 12h");
    expect(uptimeText(3 * 3600 + 4 * 60, false)).toBe("3h 4m");
    expect(uptimeText(12 * 60, true)).toBe("12m");
    const now = Date.UTC(2026, 10, 28, 10, 0, 30);
    expect(bootAt(now, 3600)).toBe(Date.UTC(2026, 10, 28, 9, 1, 0));
    expect(bootAt(now, 3600) % 60000).toBe(0);
  });
});

describe("agent stats additions", () => {
  const core = (user: number, idle: number) => ({ model: "", speed: 0, times: { user, nice: 0, sys: 0, idle, irq: 0 } });
  test("per-core deltas", () => {
    expect(coreDeltas([core(0, 0), core(0, 0)], [core(50, 50), core(10, 90)])).toEqual([50, 10]);
    expect(coreDeltas([core(0, 0)], [core(1, 1), core(1, 1)])).toBeUndefined();
    expect(coreDeltas([], [])).toBeUndefined();
  });
  test("vm_stat cached and swap usage", () => {
    const vm = "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages inactive:   100.\nPages speculative:   10.\nFile-backed pages:   163072.\n";
    expect(parseVmStatCached(vm)).toBe(163072 * 16384);
    expect(parseVmStatCached(vm.replace(/File-backed.*\n/, ""))).toBe(110 * 16384);
    expect(parseVmStatCached("")).toBeUndefined();
    expect(parseSwapUsage("total = 8192.00M  used = 6711.44M  free = 1480.56M  (encrypted)")).toEqual({ swapTotal: 8192 * 1048576, swapUsed: Math.round(6711.44 * 1048576) });
    expect(parseSwapUsage("total = 2.00G  used = 0.00M  free = 2.00G")!.swapTotal).toBe(2 * 1024 ** 3);
    expect(parseSwapUsage("nothing")).toBeUndefined();
  });
  test("linux meminfo detail", () => {
    const mi = "MemTotal: 1000 kB\nMemAvailable: 600 kB\nBuffers: 10 kB\nCached: 200 kB\nSReclaimable: 30 kB\nSwapTotal: 500 kB\nSwapFree: 400 kB\n";
    expect(parseMeminfoDetail(mi)).toEqual({ cached: 240 * 1024, swapTotal: 500 * 1024, swapUsed: 100 * 1024 });
    expect(parseMeminfoDetail("MemTotal: 1 kB\nSwapTotal: 0 kB\n")).toBeUndefined();
  });
  test("cleanMemDetail keeps only sane numbers", () => {
    expect(cleanMemDetail({ cached: 5e9, swapUsed: 9, swapTotal: 4 }, 2e9)).toEqual({ cached: 2e9, swapUsed: 4, swapTotal: 4 });
    expect(cleanMemDetail({ cached: -1, swapTotal: 0 }, 1)).toBeUndefined();
    expect(cleanMemDetail(null, 1)).toBeUndefined();
  });
  test("process list: one OS read serves every tile for a few seconds", async () => {
    let reads = 0;
    let now = 0;
    const read = async (_s: "cpu" | "mem", n: number) => { reads++; return Array.from({ length: n }, (_, i) => ({ pid: i, name: "p" + i, cpu: 10 - i, mem: i })); };
    const top = processCache(read, 4000, () => now);
    expect(await top("cpu", 30)).toHaveLength(30);
    expect(await top("cpu", 5)).toHaveLength(5);
    expect(reads).toBe(1);
    await top("mem", 5);
    expect(reads).toBe(2);
    now = 4500;
    await top("cpu", 5);
    expect(reads).toBe(3);
  });

  test("what the agent sends is what the deck type declares (no drift)", async () => {
    const seen: Stats[] = [];
    const stop = startStats((s) => seen.push(s), 50);
    await Bun.sleep(process.platform === "win32" ? 4000 : 400);
    stop();
    const s = seen[seen.length - 1]!;
    expect(s.ncpu).toBeGreaterThan(0);
    if (s.cores) {
      expect(s.cores.length).toBe(s.ncpu);
      for (const c of s.cores) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(100); }
    }
    const deck = readFileSync(join(import.meta.dir, "../web/deck/src/types.ts"), "utf8");
    const body = /export interface Stats \{([\s\S]*?)\n\}/.exec(deck)![1]!;
    const declared = new Set([...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]));
    for (const k of ["cpu", "memUsed", "memTotal", "uptime", "load", "loadKind", "time", "host", "net", "volume", "gpu", "ncpu", "cores", "mem"]) expect(declared.has(k)).toBe(true);
    for (const k of Object.keys(s)) expect(declared.has(k)).toBe(true);
    // the deck tile reads the new fields
    const tile = readFileSync(join(import.meta.dir, "../web/deck/src/stats-tile.tsx"), "utf8");
    for (const f of ["s.ncpu", "s.cores", "s.mem.cached", "s.mem.swapTotal"]) expect(tile).toContain(f);
  }, 15000);
});
