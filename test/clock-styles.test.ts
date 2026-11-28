import { describe, expect, test } from "bun:test";
import { blocMode, lunarDay, lunarDayZh, lunarLangOf, ringProgress, roundRectLength, segmentsOf, tickCorner, tickOpacity, tickRing } from "../web/deck/src/clock-logic";
import { clockWeatherOf } from "../web/deck/src/plugin-logic";

describe("lunar text for the lunar and bloc clocks", () => {
  test("Chinese lunar day names", () => {
    expect([1, 9, 10, 11, 15, 20, 21, 29, 30].map(lunarDayZh)).toEqual(["初一", "初九", "初十", "十一", "十五", "二十", "廿一", "廿九", "三十"]);
    expect(lunarDayZh(0)).toBe("");
  });
  test("lunar language: zh for zh, Vietnamese otherwise", () => {
    expect([lunarLangOf("zh"), lunarLangOf("vi"), lunarLangOf("en"), lunarLangOf("fr")]).toEqual(["zh", "vi", "vi", "vi"]);
  });
  test("Tết 2026 (17 Feb 2026) is 1 tháng Giêng Bính Ngọ, with its holiday", () => {
    const v = lunarDay(2026, 2, 17, "vi");
    expect(v.lunar).toMatchObject({ day: 1, month: 1, leap: false });
    expect(v.line).toBe("1 tháng Giêng Bính Ngọ");
    expect(v.dayText).toBe("1");
    expect(v.monthText).toBe("Tháng Giêng");
    expect(v.canChi.indexOf("Ngày ")).toBe(0);
    expect(v.holiday).toBe("Tết Nguyên Đán");
    const z = lunarDay(2026, 2, 17, "zh");
    expect(z.line).toBe("丙午年正月初一");
    expect(z.dayText).toBe("初一");
  });
  test("a solar holiday shows when the lunar day has none", () => {
    expect(lunarDay(2026, 9, 2, "vi").holiday).not.toBeNull();
  });
});

describe("segment, ring and bloc helpers", () => {
  test("7-segment maps", () => {
    expect(segmentsOf("8")).toEqual([true, true, true, true, true, true, true]);
    expect(segmentsOf("1")).toEqual([false, true, true, false, false, false, false]);
    expect(segmentsOf("0")[6]).toBe(false);
    expect(segmentsOf("x").some((x) => x)).toBe(false);
  });
  test("ring progress follows seconds, or minutes when seconds are off", () => {
    expect(ringProgress(12, 30, 15, true)).toEqual({ outer: 0.25, day: (12 * 3600 + 30 * 60 + 15) / 86400 });
    expect(ringProgress(0, 30, 0, false).outer).toBe(0.5);
  });
  test("bloc faces by tile size", () => {
    expect(blocMode(290, 140 - 20)).toBe("strip"); // 2x1
    expect(blocMode(290, 290)).toBe("page"); // 2x2
    expect(blocMode(440, 440)).toBe("page"); // 3x3
    expect(blocMode(290, 600)).toBe("tall"); // 2x4
    expect(blocMode(590, 590)).toBe("page"); // 4x4
  });
});

describe("weather-style clock data", () => {
  const agent = { now: { temp: 31, condition: "Partly cloudy", code: 2, icon: "cloud-sun" }, hourly: [], daily: [{ date: "2026-11-28", min: 25, max: 33, condition: "x", code: 2, icon: "sun" }], source: "open-meteo", location: "Hue", units: "metric", tempUnit: "c", updatedAt: 1 };
  test("reads the agent's core.weather answer (daily min/max, tempUnit)", () => {
    expect(clockWeatherOf({ custom: "weather", data: agent }, "C")).toEqual({ temp: 31, unit: "C", cond: 2, high: 33, low: 25 });
    expect(clockWeatherOf({ custom: "weather", data: agent }, "F")).toEqual({ temp: 88, unit: "F", cond: 2, high: 91, low: 77 });
    expect(clockWeatherOf({ custom: "weather", data: { ...agent, tempUnit: "f" } }, "F")!.temp).toBe(31);
  });
  test("no data, errors and other slots give null (the clock then shows its quiet placeholder)", () => {
    expect(clockWeatherOf(undefined, "C")).toBeNull();
    expect(clockWeatherOf(null, "C")).toBeNull();
    expect(clockWeatherOf({ error: "plugin off" }, "C")).toBeNull();
    expect(clockWeatherOf({ custom: "weather" }, "C")).toBeNull();
    expect(clockWeatherOf({ custom: "quota", data: agent }, "C")).toBeNull();
    expect(clockWeatherOf({ custom: "weather", data: { now: { temp: "hot" } } }, "C")).toBeNull();
  });
  test("the older deck shape (now.high/low, unit) still works", () => {
    expect(clockWeatherOf({ custom: "weather", data: { now: { temp: 20, condition: "rainy", high: 22, low: 18 }, unit: "°C" } }, "C")).toEqual({ temp: 20, unit: "C", cond: "rainy", high: 22, low: 18 });
  });
});

describe("AM/PM label (every clock style uses meridiem)", () => {
  const { meridiem } = require("../web/deck/src/clock-logic");
  const { setLang, t } = require("../web/deck/src/i18n");
  const at = (lang: string, h: number) => { setLang(lang); return meridiem(h, lang, t); };
  test("label per language, Chinese before the time, the others after", () => {
    expect([at("en", 9), at("en", 15)]).toEqual([{ text: "AM", before: false }, { text: "PM", before: false }]);
    expect([at("vi", 0), at("vi", 12)]).toEqual([{ text: "SA", before: false }, { text: "CH", before: false }]);
    expect([at("zh", 11), at("zh", 23)]).toEqual([{ text: "上午", before: true }, { text: "下午", before: true }]);
    expect([at("fr", 10).text, at("pt", 20).text]).toEqual(["AM", "PM"]);
    setLang("en");
  });
  test("no clock style hard-codes SA/CH any more", () => {
    const src = require("fs").readFileSync(require("path").join(import.meta.dir, "../web/deck/src/clocks.tsx"), "utf8");
    expect(src).not.toContain("'SA'");
    expect(src).not.toContain("'CH'");
  });
});

describe("flip clock", () => {
  const { splitDigits } = require("../web/deck/src/clock-logic");
  test("one card per digit", () => {
    expect(splitDigits("09")).toEqual(["0", "9"]);
    expect(splitDigits("59")).toEqual(["5", "9"]);
  });
  test("the flap is Safari 12 safe: prefixed 3D and transitionend, with a timeout fallback", () => {
    const fs = require("fs"), path = require("path");
    const css = fs.readFileSync(path.join(import.meta.dir, "../web/deck/src/deck.css"), "utf8");
    const tsx = fs.readFileSync(path.join(import.meta.dir, "../web/deck/src/clocks.tsx"), "utf8");
    for (const k of ["-webkit-transform-style: preserve-3d", "-webkit-backface-visibility: hidden", "-webkit-transition: -webkit-transform var(--pd-dur-travel, 420ms) var(--pd-ease-inout"]) expect(css).toContain(k);
    expect(tsx).toContain("webkitTransitionEnd");
    expect(tsx).toContain("FLIP_MS + 250");
  });
});

describe("clock-fix1 (S20 checks)", () => {
  const { blocLayout, blocMode, flipSize } = require("../web/deck/src/clock-logic");
  const { clockWeatherOf } = require("../web/deck/src/plugin-logic");
  const { nightCond } = require("../web/deck/src/clock-logic");
  // tile px on the S20 (9x4 grid, landscape) and the other sizes the brief names
  const tiles: [number, number][] = [[380, 200], [290, 290], [380, 400], [440, 440], [290, 600], [800, 800], [180, 380], [1770, 370]];
  test("bloc: the blocks never take more height than the tile, with or without a holiday", () => {
    for (const [w, h] of tiles) for (const hol of [false, true]) {
      expect(blocMode(w, h)).not.toBe("strip");
      const l = blocLayout(w, h, hol, 6);
      expect(l.used).toBeLessThanOrEqual(h);
      expect(l.n * 1.25).toBeLessThanOrEqual(w - l.pad * 2 + 1);
    }
    expect(blocMode(380, 90)).toBe("strip");
  });
  test("bloc: lucky hours show on big square and tall tiles, can chi lines go before the number gets tiny", () => {
    expect(blocLayout(800, 800, false, 6).hours).toBe(true);
    expect(blocLayout(290, 600, false, 6).hours).toBe(true);
    expect(blocLayout(380, 200, false, 6).hours).toBe(false);
    const short = blocLayout(380, 150, true, 6);
    expect(short.used).toBeLessThanOrEqual(150);
    expect(short.canChi).toBe(false);
  });
  test("flip: cards on a wide tile grow until the height stops them, digits fill the card", () => {
    const s = flipSize(1770, 332, 3, 0);
    expect(s.h).toBe(312);
    expect(s.font / s.h).toBeGreaterThan(0.9);
    const narrow = flipSize(290, 120, 3, 0);
    expect(6 * narrow.w + 3 * 4 + 2 * 8).toBeLessThanOrEqual(290 - 24);
  });
  test("flip halves are opaque (no ghosting through the flap)", () => {
    const css = require("fs").readFileSync(require("path").join(import.meta.dir, "../web/deck/src/deck.css"), "utf8");
    const h = css.slice(css.indexOf(".pd-fl__h {"), css.indexOf("}", css.indexOf(".pd-fl__h {")));
    expect(h).toContain("background-color: var(--pd-bg");
    expect(h).not.toMatch(/background: rgba/);
  });
  test("weather clock: the moon at night", () => {
    const slot = { custom: "weather", data: { now: { temp: 26, code: 0, isDay: false }, tempUnit: "c" } };
    const w = clockWeatherOf(slot, "C");
    expect(w.isDay).toBe(false);
    expect(nightCond("clear", w.isDay, 12)).toBe("night");
    expect(nightCond("clear", true, 4)).toBe("clear");
    expect(nightCond("clear", undefined, 4)).toBe("night");
    expect(nightCond("clear", undefined, 12)).toBe("clear");
    expect(nightCond("cloudy", false, 4)).toBe("cloudy");
  });
});

describe("ring follows the seconds (S20 05:10:55 showed 10/60)", () => {
  const { ringProgress, ringUsesSeconds } = require("../web/deck/src/clock-logic");
  test("seconds on by default, even where the tile hides the seconds number", () => {
    expect(ringUsesSeconds(undefined)).toBe(true);
    expect(ringUsesSeconds(true)).toBe(true);
    expect(ringUsesSeconds(false)).toBe(false);
  });
  test("the fill at 05:10:55 and 05:12:06", () => {
    expect(ringProgress(5, 10, 55, ringUsesSeconds(undefined)).outer).toBeCloseTo(55 / 60, 6);
    expect(ringProgress(5, 12, 6, ringUsesSeconds(undefined)).outer).toBeCloseTo(6 / 60, 6);
    expect(ringProgress(5, 10, 55, ringUsesSeconds(false)).outer).toBeCloseTo((10 + 55 / 60) / 60, 6);
    expect(ringProgress(5, 0, 0, true).outer).toBe(0);
  });
});

describe("ticks clock geometry", () => {
  // 2x2, 4x4, a wide 4x2 and a 9x2 tile, with the default radius, a small one and a big one
  // [w, h, tile radius, tick length]; 395 x 395 is the S20's 4x4 (~790 device px) that drew L-shaped corners
  const tiles: [number, number, number, number][] = [[288, 288, 15, 8], [588, 588, 15, 14], [395, 395, 15, 13], [588, 288, 11, 10], [1338, 288, 15, 10], [288, 288, 40, 8], [140, 140, 0, 5]];
  for (const [w, h, R, L] of tiles) {
    const inset = 8;
    const LM = Math.round(L * 1.5);
    const ticks = tickRing(w, h, R, inset, L, LM);
    const rOf = () => tickCorner(w, h, R, inset, LM);
    test(`${w}x${h} r${R}: 60 ticks, tick 0 at the top centre, majors every 5`, () => {
      expect(ticks.length).toBe(60);
      expect(ticks[0].x).toBeCloseTo(w / 2, 6);
      expect(ticks[0].y).toBeCloseTo(inset, 6);
      expect(ticks[0].a).toBeCloseTo(0, 6);
      expect(ticks.filter((t) => t.major).map((t) => ticks.indexOf(t))).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
      expect(Math.hypot(ticks[5].x2 - ticks[5].x, ticks[5].y2 - ticks[5].y)).toBeCloseTo(LM, 6);
      expect(Math.hypot(ticks[1].x2 - ticks[1].x, ticks[1].y2 - ticks[1].y)).toBeCloseTo(L, 6);
    });
    test(`${w}x${h} r${R}: evenly spaced by arc length, clockwise`, () => {
      const r = rOf();
      const per = roundRectLength(w - 2 * inset, h - 2 * inset, r);
      ticks.forEach((t, i) => expect(t.at).toBeCloseTo((i * per) / 60, 6));
      // clockwise: right side first, bottom at the middle, left side last
      expect(ticks[15].x).toBeGreaterThan(w / 2);
      expect(ticks[30].y).toBeGreaterThan(h / 2);
      expect(ticks[45].x).toBeLessThan(w / 2);
      // neighbours are never further apart than the arc step (a chord is never longer than its arc)
      for (let i = 0; i < 60; i++) {
        const a = ticks[i];
        const b = ticks[(i + 1) % 60];
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(per / 60 + 1e-6);
      }
    });
    test(`${w}x${h} r${R}: inside the tile and perpendicular to the outline`, () => {
      const r = rOf();
      for (const t of ticks) {
        for (const [x, y] of [[t.x, t.y], [t.x2, t.y2]]) {
          expect(x).toBeGreaterThanOrEqual(inset - 1e-6);
          expect(x).toBeLessThanOrEqual(w - inset + 1e-6);
          expect(y).toBeGreaterThanOrEqual(inset - 1e-6);
          expect(y).toBeLessThanOrEqual(h - inset + 1e-6);
        }
        // the outward normal of a rounded rectangle points from the nearest point of the rect shrunk by r
        const cx = Math.min(Math.max(t.x, inset + r), w - inset - r);
        const cy = Math.min(Math.max(t.y, inset + r), h - inset - r);
        const dx = t.x - cx;
        const dy = t.y - cy;
        expect(Math.hypot(dx, dy)).toBeCloseTo(r, 6);
        const rad = (t.a * Math.PI) / 180;
        expect(Math.sin(rad)).toBeCloseTo(dx / r, 6);
        expect(-Math.cos(rad)).toBeCloseTo(dy / r, 6);
        // the tick itself runs along the inward normal
        const l = Math.hypot(t.x2 - t.x, t.y2 - t.y);
        expect((t.x - t.x2) / l).toBeCloseTo(dx / r, 6);
        expect((t.y - t.y2) / l).toBeCloseTo(dy / r, 6);
      }
    });
    test(`${w}x${h} r${R}: no two neighbouring ticks touch, corners included`, () => {
      const per = roundRectLength(w - 2 * inset, h - 2 * inset, rOf());
      // closest approach of two segments (sampled): at least half the arc step and 3 px, so corner ticks never meet in an L
      const gap = (a: (typeof ticks)[0], b: (typeof ticks)[0]) => {
        let best = Infinity;
        for (let i = 0; i <= 20; i++) {
          for (let j = 0; j <= 20; j++) {
            const ax = a.x + ((a.x2 - a.x) * i) / 20, ay = a.y + ((a.y2 - a.y) * i) / 20;
            const bx = b.x + ((b.x2 - b.x) * j) / 20, by = b.y + ((b.y2 - b.y) * j) / 20;
            best = Math.min(best, Math.hypot(ax - bx, ay - by));
          }
        }
        return best;
      };
      for (let i = 0; i < 60; i++) expect(gap(ticks[i], ticks[(i + 1) % 60])).toBeGreaterThanOrEqual(Math.max(3, (per / 60) * 0.5));
    });
  }
  test("ticks corner radius: about a fifth of the short side, at least the tile radius, at most half", () => {
    expect(tickCorner(395, 395, 15, 8, 20)).toBeCloseTo((395 - 16) * 0.2, 6);
    expect(tickCorner(288, 288, 80, 8, 12)).toBe(80);
    expect(tickCorner(100, 100, 200, 8, 12)).toBe(42);
  });
  test("lit up to the current tick, a fade over the next 15, then a faint rest", () => {
    expect(tickOpacity(0, 0)).toBe(1);
    expect(tickOpacity(30, 30)).toBe(1);
    expect(tickOpacity(29, 30)).toBe(1);
    expect(tickOpacity(31, 30)).toBe(0.5);
    for (let d = 1; d < 15; d++) expect(tickOpacity(30 + d + 1, 30)).toBeLessThan(tickOpacity(30 + d, 30));
    expect(tickOpacity(45, 30)).toBe(0.14);
    expect(tickOpacity(59, 30)).toBe(0.14);
    expect(tickOpacity(59, 59)).toBe(1);
  });
});

import { BAYER, MIN_F, RAMP, STRIP_F, ditherLayout, fillNoise, glyphCells, glyphCols, glyphH, glyphHit, glyphLayer, hasGlyphs, noiseChar, rampIndex, runsOf, scramble } from "../web/deck/src/dither-logic";

describe("dither clock", () => {
  const inp = { hh: "05", mm: "44", ss: "", ap: "", label: "", date: "" };
  // S20 css sizes (dpr 2.625): 4x4, 2x2, 3x2, 2x1, 3x1, 5x1, and a wide 9x2
  const tiles: [number, number][] = [[298, 298], [144, 144], [220, 144], [144, 65], [220, 65], [374, 65], [700, 144], [586, 586]];
  const variants = [inp, { ...inp, ss: "07" }, { ...inp, ap: "PM" }, { ...inp, ap: "上午", ss: "07" }, { ...inp, ss: "59", ap: "AM", label: "OFFICE", date: "Saturday, Nov 28" }];
  for (const [W, H] of tiles) {
    test(`${W}x${H}: the grid fits the tile, glyphs and texts sit inside it, characters stay legible`, () => {
      for (const v of variants) {
        const L = ditherLayout(W, H, v);
        expect(L.f).toBeGreaterThanOrEqual(H < 100 ? STRIP_F : MIN_F);
        expect(L.cols * L.cellW).toBeLessThanOrEqual(W + 1e-6);
        expect(L.rows * L.cellH).toBeLessThanOrEqual(H + 1e-6);
        expect(L.offX).toBeGreaterThanOrEqual(0);
        expect(L.offY).toBeGreaterThanOrEqual(0);
        expect(L.glyphs.filter((g) => g.part === "main").map((g) => g.ch).join("")).toBe(L.mode === "row" ? "05:44" : "0544");
        for (const g of L.glyphs) {
          expect(g.c).toBeGreaterThanOrEqual(0);
          expect(g.r).toBeGreaterThanOrEqual(0);
          expect(g.c + glyphCols(g)).toBeLessThanOrEqual(L.cols);
          expect(g.r + glyphH(g.font) * g.sy).toBeLessThanOrEqual(L.rows);
        }
        for (const t of L.texts) {
          expect(t.row).toBeGreaterThanOrEqual(0);
          expect(t.row).toBeLessThan(L.rows);
          expect((t.col < 0 ? 0 : t.col) + t.text.length).toBeLessThanOrEqual(L.cols);
        }
        const grid = fillNoise(glyphLayer(L), 3, 0);
        expect(grid.chars.length).toBe(L.rows);
        grid.chars.forEach((row, r) => {
          expect(row.length).toBe(L.cols);
          expect(grid.kinds[r].length).toBe(L.cols);
        });
      }
    });
  }
  test("the caption is only the label given; AM/PM is never glued to it", () => {
    const L = ditherLayout(220, 144, { ...inp, ap: "PM" });
    expect(L.texts.some((t) => t.text.indexOf("CLOCK") >= 0)).toBe(false);
    const big = ditherLayout(298, 298, { ...inp, ap: "上午", label: "OFFICE" });
    const top = big.texts.filter((t) => t.text.indexOf("OFFICE") >= 0);
    expect(top).toEqual([{ row: 0, col: -1, text: "OFFICE" }]);
    expect(big.texts.some((t) => t.text === "上午")).toBe(true);
  });
  test("big tiles get bold strokes: a font pixel at least 2 cells each way and a solid dense core", () => {
    for (const [W, H] of [[298, 298], [586, 586], [700, 144]]) {
      const L = ditherLayout(W, H, inp);
      const main = L.glyphs.filter((g) => g.part === "main");
      for (const g of main) {
        expect(g.sx).toBeGreaterThanOrEqual(2);
        expect(g.sy).toBeGreaterThanOrEqual(2);
      }
      const grid = glyphLayer(L);
      for (let r = 0; r < L.rows; r++) {
        for (let c = 0; c < L.cols; c++) {
          if (main.some((g) => glyphHit(g, c, r))) {
            expect(grid.kinds[r].charAt(c)).toBe("1");
            expect(RAMP.indexOf(grid.chars[r].charAt(c))).toBeGreaterThanOrEqual(8);
          }
        }
      }
      // the falloff is one light cell right beside a stroke (no corners, nothing two cells out)
      const stroke = (c: number, r: number) => grid.kinds[r] !== undefined && grid.kinds[r].charAt(c) === "1";
      grid.kinds.forEach((ks, r) => ks.split("").forEach((k, c) => {
        if (k !== "3") return;
        expect(RAMP.indexOf(grid.chars[r].charAt(c))).toBeLessThanOrEqual(3);
        expect(stroke(c - 1, r) || stroke(c + 1, r) || stroke(c, r - 1) || stroke(c, r + 1)).toBe(true);
      }));
    }
  });
  test("small tiles use fewer, bigger cells: digits at least 5 rows tall, strokes a solid run of 2 cells (2x2, 2x1, 3x1, 5x1)", () => {
    for (const [W, H] of [[144, 144], [144, 65], [220, 65], [374, 65], [220, 144]]) {
      const L = ditherLayout(W, H, inp);
      for (const g of L.glyphs.filter((x) => x.part === "main" && x.ch !== ":")) {
        expect(glyphH(g.font) * g.sy).toBeGreaterThanOrEqual(5);
        expect(g.sx).toBeGreaterThanOrEqual(2);
        // every lit pixel is at least 2 cells wide, except the narrow 1-cell middle column, which is never lit beside a lit neighbour gap
        const grid = glyphLayer(L);
        for (let r = g.r; r < g.r + glyphH(g.font) * g.sy; r++) {
          const run = grid.kinds[r].slice(g.c, g.c + glyphCols(g));
          for (const m of run.match(/1+/g) || []) expect(m.length).toBeGreaterThanOrEqual(2);
        }
      }
      expect(L.f).toBeGreaterThanOrEqual(STRIP_F);
    }
    // the 11 px floor holds wherever it can: only strips go below it
    expect(ditherLayout(144, 144, inp).f).toBeGreaterThanOrEqual(MIN_F);
    expect(ditherLayout(298, 298, inp).f).toBeGreaterThanOrEqual(MIN_F);
  });
  test("the hours and minutes are centred as one block; seconds hang after it without moving it", () => {
    for (const [W, H] of [[298, 298], [586, 586], [144, 144], [220, 144], [700, 144]]) {
      for (const v of [inp, { ...inp, ss: "07" }, { ...inp, ss: "07", ap: "PM" }]) {
        const L = ditherLayout(W, H, v);
        const main = L.glyphs.filter((g) => g.part === "main");
        const lines = L.mode === "row" ? [main] : [main.slice(0, 2), main.slice(2)];
        for (const line of lines) {
          const left = line[0].c;
          const right = L.cols - (line[line.length - 1].c + glyphCols(line[line.length - 1]));
          expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
        }
        // on the same grid and scale, adding the seconds / AM-PM never moves the digits
        const P = ditherLayout(W, H, inp);
        const plain = P.glyphs.filter((g) => g.part === "main");
        if (P.f === L.f && P.mode === L.mode && plain[0].sx === main[0].sx && plain[0].sy === main[0].sy) expect(main.map((g) => g.c)).toEqual(plain.map((g) => g.c));
      }
    }
  });
  test("square tiles stack HH over MM, wide ones put HH:MM on one line", () => {
    expect(ditherLayout(298, 298, inp).mode).toBe("stack");
    expect(ditherLayout(144, 144, inp).mode).toBe("stack");
    expect(ditherLayout(700, 144, inp).mode).toBe("row");
    expect(ditherLayout(374, 65, inp).mode).toBe("row");
  });
  test("stroke cells use the dense end of the ramp, the background never does", () => {
    const L = ditherLayout(586, 586, inp);
    const grid = fillNoise(glyphLayer(L), 11, 5);
    let dense = 0;
    for (let r = 0; r < L.rows; r++) {
      for (let c = 0; c < L.cols; c++) {
        const ch = grid.chars[r].charAt(c);
        const k = grid.kinds[r].charAt(c);
        if (k === "1") { dense++; expect("%@").toContain(ch); }
        if (k === "0") expect(RAMP.indexOf(ch)).toBeLessThanOrEqual(3);
      }
    }
    expect(dense).toBeGreaterThan(100);
  });
  test("ordered dithering: levels at the ends, a Bayer mix between", () => {
    expect(rampIndex(0, 0, 0)).toBe(0);
    expect(rampIndex(1, 3, 2)).toBe(RAMP.length - 1);
    const q = 4.5 / (RAMP.length - 1);
    let up = 0;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (rampIndex(q, c, r) === 5) up++;
    expect(up).toBe(8);
    expect(BAYER.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });
  test("same input gives the same grid; noise is sparse and shimmers a little per tick", () => {
    const a = fillNoise(glyphLayer(ditherLayout(298, 298, { ...inp, ss: "07" })), 9, 100);
    const b = fillNoise(glyphLayer(ditherLayout(298, 298, { ...inp, ss: "07" })), 9, 100);
    expect(a).toEqual(b);
    let marks = 0;
    let changed = 0;
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < 60; c++) {
        const n0 = noiseChar(9, c, r, 100);
        if (n0 !== " ") marks++;
        if (n0 !== noiseChar(9, c, r, 101)) changed++;
      }
    }
    expect(marks / 2400).toBeGreaterThan(0.03);
    expect(marks / 2400).toBeLessThan(0.12);
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(marks);
  });
  test("seconds: small glyphs beside the minutes where they fit (9x2), else a short text beside the time", () => {
    const L = ditherLayout(1336, 286, { ...inp, ss: "07" });
    const sec = L.glyphs.filter((g) => g.part === "sec");
    const main = L.glyphs.filter((g) => g.part === "main");
    expect(sec.map((g) => g.ch).join("")).toBe("07");
    expect(sec[0].sy).toBeLessThan(main[0].sy);
    expect(sec[0].c).toBeGreaterThan(main[main.length - 1].c);
    for (const [W, H] of [[298, 298], [144, 144]]) {
      const S = ditherLayout(W, H, { ...inp, ss: "07" });
      const asGlyphs = S.glyphs.filter((g) => g.part === "sec").length === 2;
      expect(asGlyphs || S.texts.some((t) => t.text === ":07")).toBe(true);
    }
    const S = ditherLayout(144, 144, { ...inp, ss: "07" });
    expect(S.glyphs.some((g) => g.part === "sec")).toBe(false);
    expect(S.texts.some((t) => t.text === ":07")).toBe(true);
    expect(hasGlyphs("PM")).toBe(true);
    expect(hasGlyphs("SA")).toBe(true);
    expect(hasGlyphs("上午")).toBe(false);
  });
  test("label and date rows only when they fit", () => {
    const big = ditherLayout(298, 298, { ...inp, label: "OFFICE", date: "Saturday, Nov 28" });
    expect(big.texts.map((t) => t.text)).toEqual(["OFFICE", "Saturday, Nov 28"]);
    const tiny = ditherLayout(144, 65, { ...inp, date: "Saturday, Nov 28" });
    expect(tiny.texts.length).toBe(0);
  });
  test("a scramble only touches its box and ends on the final grid", () => {
    const L = ditherLayout(586, 586, inp);
    const g = fillNoise(glyphLayer(L), 4, 0);
    const box = glyphCells(L, L.glyphs[L.glyphs.length - 1]);
    expect(scramble(g, box, 1, 3, 4)).toBe(g);
    const mid = scramble(g, box, 0.3, 3, 4);
    let diff = 0;
    for (let r = 0; r < L.rows; r++) {
      for (let c = 0; c < L.cols; c++) {
        if (mid.chars[r].charAt(c) !== g.chars[r].charAt(c)) {
          diff++;
          expect(c >= box.c0 && c <= box.c1 && r >= box.r0 && r <= box.r1).toBe(true);
        }
      }
    }
    expect(diff).toBeGreaterThan(0);
    expect(scramble(g, box, 0.3, 3, 4)).toEqual(mid);
  });
  test("rows render as a few runs of one kind", () => {
    expect(runsOf("ab  c", "11002")).toEqual([{ k: "1", t: "ab" }, { k: "0", t: "  " }, { k: "2", t: "c" }]);
  });
});

describe("polish-round: clock caption and bloc can chi words", () => {
  const cl = require("../web/deck/src/clock-logic");
  test("the caption is only a label the user set, never the default item name", () => {
    expect(cl.clockCaption(undefined)).toBe("");
    expect(cl.clockCaption({})).toBe("");
    expect(cl.clockCaption({ label: "  " })).toBe("");
    expect(cl.clockCaption({ label: "Tokyo" })).toBe("Tokyo");
  });
  test("every clock face reads its caption from the shared helper", () => {
    const src = require("fs").readFileSync(require("path").join(import.meta.dir, "../web/deck/src/clocks.tsx"), "utf8");
    expect(src).toContain("const label = clockCaption(o)");
    expect(src).not.toContain("props.caption");
    expect(src).not.toMatch(/'Năm '|'Tháng ' \+ L|'Ngày ' \+ L/);
  });
  test("bloc can chi lines: translated words, Vietnamese names; Chinese keeps its suffixes", () => {
    const en = (s: string) => s;
    const vi = (s: string) => ({ Year: "Năm", Month: "Tháng", Day: "Ngày" } as Record<string, string>)[s] || s;
    expect(cl.blocCanChi("Bính Ngọ", "Kỷ Hợi", "Giáp Tý", "en", en)).toEqual(["Year Bính Ngọ", "Month Kỷ Hợi", "Day Giáp Tý"]);
    expect(cl.blocCanChi("Bính Ngọ", "Kỷ Hợi", "Giáp Tý", "vi", vi)).toEqual(["Năm Bính Ngọ", "Tháng Kỷ Hợi", "Ngày Giáp Tý"]);
    expect(cl.blocCanChi("丙午", "己亥", "甲子", "zh", en)).toEqual(["丙午年", "己亥月", "甲子日"]);
    for (const l of ["vi", "zh", "fr", "pt"]) {
      const d = require("../web/deck/src/i18n-" + l);
      const dict = d[Object.keys(d)[0]];
      for (const k of ["Year", "Month", "Day"]) expect(typeof dict[k]).toBe("string");
    }
  });
});
