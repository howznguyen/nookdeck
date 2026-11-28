import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIT_LABEL, FIT_RING, FIT_ROW, LABEL_STEPS, fitScale, ringRoom } from "../web/deck/src/fit";

const src = (f: string) => readFileSync(join(import.meta.dir, "../web/deck/src", f), "utf8");

describe("fit-to-box", () => {
  test("fitScale: fits -> 1; wider -> the ratio; a broken measurement never shrinks to nothing", () => {
    expect(fitScale(100, 120)).toBe(1);
    expect(fitScale(100.4, 100)).toBe(1);
    expect(fitScale(200, 100)).toBe(0.5);
    expect(fitScale(1000, 10)).toBe(0.2);
    expect(fitScale(0, 100)).toBe(1);
    expect(fitScale(100, 0)).toBe(1);
  });
  test("rings: text gets 0.7 of the diameter, half rings 0.6; labels step down four times", () => {
    expect(ringRoom(100, false)).toBe(70);
    expect(ringRoom(100, true)).toBe(60);
    expect(LABEL_STEPS).toEqual([1, 0.9, 0.8, 0.7]);
  });
  test("every numeric display is hooked: AnimatedNumber, delta, weather, media times, ring centres, entity values carry data-part=num", () => {
    expect(src("knowns.tsx")).toContain('data-part="num"');
    expect(src("weather-tile.tsx").match(/data-part="num"/g)!.length).toBeGreaterThanOrEqual(4);
    expect(src("now-playing.tsx")).toContain('<span data-part="num">{formatTime(shownAt)}</span>');
    expect(src("charts.tsx")).toContain('class="pd-ring__t" data-part="num"');
    expect(src("metric-charts.tsx")).toContain('class="pd-ring__t" data-part="num"');
    expect(src("entity.tsx")).toContain('data-part="num"');
  });
  test("css: one rule gives num and tile-value the number font (font as the fallback); tiles clip; button labels wrap to 2 lines", () => {
    const css = src("deck.css");
    expect(css).toContain(".pd-root [data-part='num'], .pd-root [data-part='tile-value'] { font-family: var(--pd-ff-num, var(--pd-ff, inherit)); }");
    expect(css).toContain(".pd-root [data-part='tile'] { overflow: hidden; }");
    expect(css).toMatch(/\.pd-tile__lb, \.pd-root \.pd-ios__lb \{[^}]*-webkit-line-clamp: 2/);
  });
  test("every fit selector refers to a class that exists in the deck source", () => {
    const all = ["Deck.tsx", "widgets.tsx", "clocks.tsx", "automation.tsx", "weather-tile.tsx", "plugin.tsx", "entity.tsx", "screen.tsx", "charts.tsx", "metric-charts.tsx", "ai.tsx"].map(src).join("\n");
    for (const sel of [FIT_ROW, FIT_RING, FIT_LABEL].join(",").split(",")) {
      const cls = sel.trim().replace(/^\./, "").split(" ")[0]!;
      expect(all).toContain(cls);
    }
  });
  test("quota tiles: the brand colour is an accent on a themed tile, and usage sets data-state", () => {
    const d = src("Deck.tsx");
    expect(d).toContain("const quotaOnTheme = item.widget === 'quota' && !!props.tt.tileSet");
    expect(d).toContain("used >= 90 ? 'error' : used >= 75 ? 'warn' : 'ok'");
  });
});
