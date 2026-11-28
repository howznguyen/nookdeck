import { describe, expect, test } from "bun:test";
import { CARD_LIMITS, card, validateCard } from "../src/plugins/card";
import { commonParts, rowRoomEm, sparkGeom, tickerParts, trendOf } from "../web/deck/src/card-ticker-logic";

const err = (d: unknown): string => { const r = validateCard(d); return "error" in r ? r.error : ""; };

describe("the ticker part", () => {
  test("every field passes and comes back unchanged; the builder keeps the last 60 points", () => {
    const t = card.ticker("BTC", "$59,521", { name: "Bitcoin", change: "−3.48%", tone: "bad", points: [1, 2, 3], note: "7d high $61,210 · low $58,100", hero: true });
    const data = card.root(card.col([t, card.ticker("ETH", "$1,651")], { gap: 0 }));
    expect(validateCard(data)).toEqual({ data });
    const long = card.ticker("X", "1", { points: Array.from({ length: 100 }, (_, i) => i) }) as { points: number[] };
    expect(long.points.length).toBe(CARD_LIMITS.points);
    expect(long.points[0]).toBe(40);
    expect(card.ticker("X", "1")).toEqual({ t: "ticker", symbol: "X", price: "1" });
  });
  test("what it refuses", () => {
    const t = (o: Record<string, unknown>) => ({ root: { t: "ticker", symbol: "BTC", price: "$1", ...o } });
    expect(err(t({ symbol: "" }))).toContain("symbol must not be empty");
    expect(err(t({ symbol: "X".repeat(17) }))).toContain("longer than 16");
    expect(err(t({ price: 5 }))).toContain("price must be text");
    expect(err(t({ points: [1, NaN] }))).toContain("points");
    expect(err(t({ points: Array.from({ length: 61 }, () => 1) }))).toContain("points");
    expect(err(t({ note: "n".repeat(81) }))).toContain("longer than 80");
    expect(err(t({ hero: "yes" }))).toContain("true or false");
    expect(err(t({ tone: "green" }))).toContain("tone");
    expect(err(t({ color: "red" }))).toContain('"color" is not a field of ticker');
    expect(err({ root: { t: "ticker", symbol: "BTC" } })).toContain("price must be text");
  });
});

describe("ticker layout", () => {
  const all = { name: true, chart: true, change: true };
  test("a wide row shows everything; narrower, the name beside goes first, then the chart, then the chip; symbol and price always stay", () => {
    expect(tickerParts(24, 3, all)).toEqual({ name: "under", chart: true, change: true });
    expect(tickerParts(22, 1.9, all)).toEqual({ name: "side", chart: true, change: true });
    expect(tickerParts(18, 1.9, all)).toEqual({ name: "none", chart: true, change: true });
    expect(tickerParts(14, 1.9, all)).toEqual({ name: "none", chart: false, change: true });
    expect(tickerParts(11.5, 1.9, all)).toEqual({ name: "none", chart: false, change: true });
    expect(tickerParts(12, 3, all)).toEqual({ name: "under", chart: false, change: true });
    expect(tickerParts(10, 1.9, all)).toEqual({ name: "none", chart: false, change: true });
    expect(tickerParts(8, 1.9, all)).toEqual({ name: "none", chart: false, change: false });
    expect(tickerParts(24, 2.6, all).name).toBe("side");
  });
  test("parts a row was not given never show", () => {
    expect(tickerParts(40, 4, { name: false, chart: false, change: false })).toEqual({ name: "none", chart: false, change: false });
  });
  test("one card: the least any row allows, so the columns line up", () => {
    expect(commonParts([])).toBeNull();
    expect(commonParts([
      { name: "under", chart: true, change: true },
      { name: "side", chart: false, change: true },
      { name: "under", chart: true, change: false },
    ])).toEqual({ name: "side", chart: false, change: false });
  });
  test("the room of a row: the column less its other parts, shared, at least one line and a little", () => {
    expect(rowRoomEm(300, 20, 4, 14)).toBe(5);
    expect(rowRoomEm(100, 90, 4, 14)).toBe(1.4);
    expect(rowRoomEm(100, 0, 0, 14)).toBe(0);
  });
});

describe("the chart", () => {
  test("its direction: the last point against the first, a hair of change is flat", () => {
    expect([trendOf([1, 3, 2]), trendOf([5, 7, 4]), trendOf([100, 120, 100.005]), trendOf([3]), trendOf(undefined)]).toEqual(["up", "down", "flat", "flat", "flat"]);
  });
  test("geometry in a 100 x 30 box, 3 units of air above and below; a flat line sits in the middle", () => {
    const g = sparkGeom([10, 20, 15])!;
    expect(g.line).toBe("0.00,27.00 50.00,3.00 100.00,15.00");
    expect(g.area).toBe("0,30 " + g.line + " 100,30");
    expect([g.baseY, g.endY]).toEqual([27, 15]);
    expect(sparkGeom([5, 5])!.endY).toBe(15);
    expect(sparkGeom([1])).toBeNull();
  });
});
