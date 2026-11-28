import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aqiBand, chartBox, detailRows, fitCount, hasRain, hlFit, slotFit, tallRows, tempW, textW, isNight, linePoints, normWeather, pointsAttr, rainBars, rainText, rangeOf, skyOf, windArrowDeg, windUnitOf, wxFace, wxTimeOf } from "../web/deck/src/weather-logic";
import { parseOpenMeteo } from "../src/weather";

const NOW = new Date(2026, 10, 28, 10, 0).getTime();

describe("reading the weather answer", () => {
  test("local times: a bare date is local midnight, an ISO time without offset is local, epoch s and ms both work", () => {
    expect(wxTimeOf("2026-11-17", 0)).toBe(new Date(2026, 10, 17).getTime());
    expect(wxTimeOf("2026-11-17T10:00", 0)).toBe(new Date(2026, 10, 17, 10, 0).getTime());
    expect(wxTimeOf("2026-11-17T10:00:00Z", 0)).toBe(Date.UTC(2026, 10, 17, 10, 0));
    expect(wxTimeOf(1_700_000_000, 0)).toBe(1_700_000_000_000);
    expect(wxTimeOf(1_700_000_000_000, 0)).toBe(1_700_000_000_000);
    expect(wxTimeOf("soon", 7)).toBe(7);
    expect(wxTimeOf(undefined, 7)).toBe(7);
  });

  test("the agent's answer (src/weather.ts) reads end to end: code, min/max, tempUnit, new fields", () => {
    const j = {
      current: { time: "2026-11-28T10:00", temperature_2m: 30, apparent_temperature: 33, relative_humidity_2m: 70, weather_code: 61, wind_speed_10m: 12, wind_direction_10m: 90, is_day: 1 },
      hourly: { time: ["2026-11-28T10:00", "2026-11-28T11:00"], temperature_2m: [30, 31], weather_code: [61, 3] },
      daily: { time: ["2026-11-28", "2026-11-29"], weather_code: [61, 0], temperature_2m_max: [32, 33], temperature_2m_min: [24, 25], precipitation_sum: [4.2, 0], precipitation_probability_max: [70, 5], uv_index_max: [6, 8] },
    };
    const agent = parseOpenMeteo(j, { location: "Hanoi", units: "metric", now: NOW });
    agent.now.aqi = 42;
    const v = normWeather(JSON.parse(JSON.stringify(agent)), NOW)!;
    expect(v).toMatchObject({ temp: 30, feels: 33, humidity: 70, wind: 12, windDir: 90, aqi: 42, isDay: true, cond: 61, high: 32, low: 24, unit: "C", units: "metric", place: "Hanoi", source: "open-meteo", updatedAt: NOW });
    expect(v.hourly).toEqual([{ ms: new Date(2026, 10, 28, 10).getTime(), temp: 30, cond: 61 }, { ms: new Date(2026, 10, 28, 11).getTime(), temp: 31, cond: 3 }]);
    expect(v.daily[0]).toEqual({ ms: new Date(2026, 10, 28).getTime(), high: 32, low: 24, cond: 61, rain: 4.2, pop: 70, uv: 6 });
    expect(windUnitOf(v)).toBe("km/h");
  });

  test("the older deck shape (t, high/low, unit, text) still reads, and old data without the new fields has none of them", () => {
    const v = normWeather({ now: { temp: 70, condition: "sunny", text: "Sunny" }, hourly: [{ t: NOW / 1000, temp: 71 }], daily: [{ t: "2026-11-28", high: 75, low: 60, condition: "rainy" }], unit: "°F", location: "Home" }, NOW)!;
    expect(v).toMatchObject({ temp: 70, cond: "sunny", text: "Sunny", unit: "F", high: 75, low: 60 });
    expect(v.hourly[0]).toEqual({ ms: NOW, temp: 71, cond: "cloudy" });
    for (const k of ["windDir", "aqi", "feels", "humidity", "wind", "isDay", "updatedAt"]) expect(k in v).toBe(false);
    expect(["rain", "pop", "uv"].some((k) => k in v.daily[0]!)).toBe(false);
    expect(windUnitOf({ units: "imperial" })).toBe("mph");
    expect(windUnitOf({ windUnit: "m/s", units: "metric" })).toBe("m/s");
  });

  test("no data, no temperature or junk rows: null or skipped, never a throw", () => {
    expect(normWeather(undefined, NOW)).toBeNull();
    expect(normWeather({ now: {} }, NOW)).toBeNull();
    expect(normWeather({ error: "x" }, NOW)).toBeNull();
    const v = normWeather({ now: { temp: 1 }, hourly: [null, { temp: "x" }, { temp: 2 }], daily: [{ max: 3 }, 5, { max: 4, min: 1 }] }, NOW)!;
    expect(v.hourly.length).toBe(1);
    expect(v.daily.length).toBe(1);
    expect(v.unit).toBeUndefined();
  });

  test("wind arrow points where the wind blows to", () => {
    expect([windArrowDeg(0), windArrowDeg(90), windArrowDeg(270), windArrowDeg(359.6)]).toEqual([180, 270, 90, 180]);
  });
});

describe("faces by size", () => {
  const f = (cw: number, ch: number, show?: string, hourly = true, daily = true) => wxFace(cw, ch, cw * 140, ch * 140, show, hourly, daily);
  test("auto picks a face per grid span", () => {
    expect([f(1, 1).mode, f(2, 1).mode, f(2, 2).mode, f(3, 1).mode, f(4, 1).mode, f(3, 2).mode, f(4, 2).mode, f(4, 3).mode, f(4, 4).mode, f(3, 3).mode, f(2, 3).mode, f(1, 3).mode]).toEqual(["tiny", "row", "card", "wide", "wide", "hero", "hero", "full", "full", "full", "tall", "tall"]);
    expect(f(4, 1)).toEqual({ mode: "wide", forecast: true, series: "hourly" });
    expect(f(4, 2)).toEqual({ mode: "hero", forecast: true, series: "daily" });
    expect(f(4, 4).series).toBe("daily");
    expect(f(2, 2).forecast).toBe(false);
  });
  test("small pixels force the tiny face", () => {
    expect(wxFace(2, 1, 90, 60, "auto", true, true).mode).toBe("tiny");
  });
  test("show: now drops the forecast, hourly and daily pick the series, missing data falls back", () => {
    expect(f(4, 1, "now").mode).toBe("row");
    expect(f(2, 3, "now").mode).toBe("card");
    expect(f(4, 2, "now")).toEqual({ mode: "hero", forecast: false, series: "daily" });
    expect(f(4, 4, "now").forecast).toBe(false);
    expect(f(4, 2, "hourly").series).toBe("hourly");
    expect(f(4, 1, "daily").series).toBe("daily");
    expect(f(2, 3, "hourly").mode).toBe("card");
    expect(f(4, 2, "auto", true, false).series).toBe("hourly");
    expect(f(4, 1, "auto", false, true).series).toBe("daily");
    expect(f(4, 2, "auto", false, false).forecast).toBe(false);
  });
  test("how many columns fit", () => {
    expect(fitCount(360, 40, 7, 3, 9)).toBe(7);
    expect(fitCount(200, 40, 7, 3, 9)).toBe(5);
    expect(fitCount(80, 40, 7, 3, 9)).toBe(3);
    expect(fitCount(80, 40, 2, 3, 9)).toBe(2);
    expect(fitCount(1000, 40, 12, 3, 9)).toBe(9);
  });
});

describe("sky", () => {
  test("clear day has arcs, clear night a moon and stars, rain and storm none", () => {
    expect(skyOf("clear", false)).toEqual({ kind: "day", arcs: 2, moon: 0, stars: false });
    expect(skyOf("clear", true)).toEqual({ kind: "night", arcs: 0, moon: 2, stars: true });
    expect(skyOf("night", true).kind).toBe("night");
    expect(skyOf("partly", false)).toEqual({ kind: "day", arcs: 1, moon: 0, stars: false });
    expect(skyOf("partly", true)).toEqual({ kind: "cloudn", arcs: 0, moon: 1, stars: true });
    expect([skyOf("cloudy", false).kind, skyOf("fog", true).kind, skyOf("rain", false).kind, skyOf("pour", true).kind, skyOf("hail", false).kind, skyOf("storm", true).kind, skyOf("snow", false).kind, skyOf("snow", true).kind]).toEqual(["cloud", "cloudn", "rain", "rainn", "rain", "storm", "snow", "snown"]);
  });
  test("night: the source's day flag wins, else 19:00 to 06:00", () => {
    expect(isNight(true, new Date(2026, 0, 1, 23).getTime())).toBe(false);
    expect(isNight(false, new Date(2026, 0, 1, 12).getTime())).toBe(true);
    expect([5, 6, 18, 19].map((h) => isNight(undefined, new Date(2026, 0, 1, h).getTime()))).toEqual([true, false, false, true]);
  });
  test("white text keeps 4.5:1 on every sky stop (day with three light arcs over it)", () => {
    const css = readFileSync(join(import.meta.dir, "../web/deck/src/weather.css"), "utf8");
    const lum = (h: string) => {
      const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };
    const mix = (h: string, a: number) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - a) + 255 * a).toString(16).padStart(2, "0")).join("");
    const arc = Number((/\.pd-wx__arc \{ background: rgba\(255, 255, 255, ([\d.]+)\)/.exec(css) || [])[1]);
    expect(arc).toBeGreaterThan(0);
    const kinds: string[] = [];
    for (const m of css.matchAll(/\.pd-wx--(\w+) \{[^}]*linear-gradient\(([^)]*)\)/g)) {
      kinds.push(m[1]!);
      const over = m[1] === "day" ? 1 - Math.pow(1 - arc, 3) : 0;
      for (const s of m[2]!.match(/#[0-9a-f]{6}/g)!) expect({ sky: m[1], stop: s, ratio: Math.round((1.05 / (lum(mix(s, over)) + 0.05)) * 100) / 100 >= 4.5 }).toEqual({ sky: m[1], stop: s, ratio: true });
    }
    expect(kinds.sort()).toEqual(["cloud", "cloudn", "day", "night", "rain", "rainn", "snow", "snown", "storm"]);
  });
});

describe("air quality band", () => {
  test("US AQI bands and their words", () => {
    expect([0, 50, 51, 100, 101, 150, 151, 200, 201, 300, 301, 500].map((n) => aqiBand(n).label)).toEqual(["Good", "Good", "Moderate", "Moderate", "Sensitive", "Sensitive", "Unhealthy", "Unhealthy", "Very unhealthy", "Very unhealthy", "Hazardous", "Hazardous"]);
    expect(aqiBand(-3).label).toBe("Good");
    expect(aqiBand(50.4).label).toBe("Good");
    expect(aqiBand(20).ink).toBe("#052e16");
    expect(aqiBand(250).ink).toBe("#ffffff");
  });
});

describe("chart of the big face", () => {
  test("range: min and max, widened around the middle to the smallest span", () => {
    expect(rangeOf([24, 31, 25, 33], 4)).toEqual([24, 33]);
    expect(rangeOf([20, 21], 4)).toEqual([18.5, 22.5]);
    expect(rangeOf([], 4)).toEqual([0, 4]);
  });
  test("points: x at the column centres, the range mapped onto top..bottom with the high at the top", () => {
    const p = linePoints([10, 20, 15], 50, 10, 110, 10, 20);
    expect(p).toEqual([{ x: 25, y: 110 }, { x: 75, y: 10 }, { x: 125, y: 60 }]);
    expect(pointsAttr(p)).toBe("25,110 75,10 125,60");
    expect(linePoints([5, 5], 40, 0, 100, 5, 5)).toEqual([{ x: 20, y: 100 }, { x: 60, y: 100 }]);
  });
  test("rain bars: scaled to the wettest day (at least 5 mm), tiny amounts get no bar, a little rain a short visible one", () => {
    expect(hasRain([{}, { rain: 0 }, { rain: 0.05 }])).toBe(false);
    expect(hasRain([{ rain: 0.1 }])).toBe(true);
    expect(rainBars([{ rain: 10 }, { rain: 5 }, {}, { rain: 0.05 }], 30)).toEqual([30, 15, 0, 0]);
    expect(rainBars([{ rain: 1 }, { rain: 0.1 }], 30)).toEqual([6, 2]);
    expect([rainText(8.14), rainText(12.6), rainText(0), rainText(undefined), rainText(0.1)]).toEqual(["8.1", "13", "", "", "0.1"]);
  });
  test("vertical budget: room for names, glyphs, the chart and the bars only when it rains", () => {
    const dry = chartBox(200, false);
    expect(dry.bars + dry.barText).toBe(0);
    expect(dry.name + dry.glyph + dry.chart + 8).toBe(200);
    const wet = chartBox(200, true);
    expect(wet.bars).toBeGreaterThan(9);
    expect(wet.name + wet.glyph + wet.chart + wet.bars + wet.barText + 8).toBe(200);
    expect(chartBox(240, true).glyph).toBe(28);
  });
});

describe("fitting without cutting numbers", () => {
  test("text and temperature widths grow with length and size; CJK counts wider", () => {
    expect(textW("Today", 13)).toBeCloseTo(37.7, 1);
    expect(textW("今天", 13)).toBeGreaterThan(textW("ab", 13));
    expect(tempW(28, 100)).toBeCloseTo(144, 0);
    expect(tempW(-5, 100)).toBeCloseTo(144, 0);
  });
  test("high / low: the full text, else the short one, else nothing", () => {
    expect(hlFit(200, "H 33°  L 25°", "25/33°", 12)).toBe("H 33°  L 25°");
    expect(hlFit(50, "H 33°  L 25°", "25/33°", 12)).toBe("25/33°");
    expect(hlFit(20, "H 33°  L 25°", "25/33°", 12)).toBe("");
    expect(hlFit(200, "", "", 12)).toBe("");
  });
  test("3x3: detail rows drop before the chart does", () => {
    // a 3x3 on the phone: about 227 px inside, 48 px header, no footer
    expect(detailRows(227 - 48, 2, 30, 8, 128)).toBe(1);
    expect(detailRows(227 - 48, 2, 30, 8, 106)).toBe(2);
    expect(detailRows(120, 2, 30, 8, 128)).toBe(0);
    expect(detailRows(400, 2, 30, 8, 128)).toBe(2);
  });
  test("tall: only whole rows, which may grow to fill", () => {
    expect(tallRows(180, 26, 7, 40)).toEqual({ rows: 6, rowH: 30 });
    expect(tallRows(300, 26, 7, 40)).toEqual({ rows: 7, rowH: 40 });
    expect(tallRows(60, 26, 2, 40)).toEqual({ rows: 2, rowH: 30 });
    expect(tallRows(20, 26, 7, 40).rows).toBe(0);
    const f = tallRows(181, 26, 7, 40);
    expect(f.rows * f.rowH).toBeLessThanOrEqual(181);
  });
  test("one-row forecast slots: label, glyph and value fit, else the label goes", () => {
    expect(slotFit(64, 30)).toEqual({ label: true, glyph: 28 });
    expect(slotFit(80, 30)).toEqual({ label: true, glyph: 30 });
    expect(slotFit(50, 30)).toEqual({ label: false, glyph: 30 });
    expect(slotFit(30, 30)).toEqual({ label: false, glyph: 12 });
  });
});

describe("polish-round: upright 1x2 weather and the place pill", () => {
  const w = require("../web/deck/src/weather-logic");
  test("a 1x2 (about 75 x 160 px) stacks the condition and H/L under the number; a square 1x1 stays glyph + number", () => {
    for (const [tw, th] of [[70, 148], [75, 160], [90, 190]]) {
      const W = tw - 20, H = th - 20;
      const s = w.tinyStack(W, H, 28);
      expect(s.cond).toBe(true);
      expect(s.hl).toBe(true);
      expect(s.gl + 6 + s.ts + 6 + 17 + 16).toBeLessThanOrEqual(H);
      expect(w.tempW(28, s.ts)).toBeLessThanOrEqual(W);
      expect(w.hlFit(W, "H 33°  L 25°", "25/33°", 12)).not.toBe("");
    }
    const sq = w.tinyStack(60, 60, 28);
    expect([sq.cond, sq.hl]).toEqual([false, false]);
  });
  test("the place pill shrinks one step, then wraps to two lines, before it ellipses", () => {
    expect(w.pillFit("Hà Nội", 200)).toEqual({ px: 12, lines: 1, h: 22 });
    const place = "TP. Hồ Chí Minh";
    const at12 = w.textW(place, 12) + w.PILL_CHROME, at11 = w.textW(place, 11) + w.PILL_CHROME;
    expect(w.pillFit(place, Math.ceil(at12))).toMatchObject({ px: 12, lines: 1 });
    expect(w.pillFit(place, Math.ceil(at11))).toMatchObject({ px: 11, lines: 1 });
    expect(w.pillFit(place, Math.floor(at11) - 1)).toEqual({ px: 11, lines: 2, h: 34 });
  });
});

describe("polish-round follow-up: a two-line pill never runs into the hero number", () => {
  const w = require("../web/deck/src/weather-logic");
  test("3x2 on the S20 (about 236 x 152 px): the temperature column fits under the two-line pill", () => {
    const H = 152 - 28, top = 34 + 4;
    // wind on its row, the AQI chip moved under the condition: column = number + H/L 20 + wind 24
    const ts = w.heroTempFit(40, H, top, 24, true);
    expect(top + 4 + ts + 20 + 24).toBeLessThanOrEqual(H);
    expect(ts).toBeGreaterThanOrEqual(34);
  });
  test("a one-line pill keeps the number as it was (4x2 unchanged)", () => {
    expect(w.heroTempFit(62, 220, 26, 0, false)).toBe(62);
    expect(w.heroTempFit(40, 124, 26, 48, false)).toBe(40);
  });
  test("the hero render uses the fit and moves the chip only with a two-line pill", () => {
    const src = require("fs").readFileSync(require("path").join(import.meta.dir, "../web/deck/src/weather-tile.tsx"), "utf8");
    expect(src).toContain("heroTempFit(ts0, H, top, wrowH, two)");
    expect(src).toContain("const aqiGc = two && !showThird");
  });
});
