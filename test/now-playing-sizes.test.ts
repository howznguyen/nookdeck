import { describe, expect, test } from "bun:test";
import { NP_COL_MIN, NP_NEED, NP_TALL_VOL, npCompactParts, npCoverSize, npInlineVol, npSquareArtist, npSquareCover, npTallCover, npTallRest, npTallSnug, npVariant } from "../web/deck/src/now-playing-utils";

// Tile sizes of 2x1, 2x2, 3x2 and 4x2 cells at cell sizes 90-140 px with the usual gaps: whatever layout is chosen must have room for
// all its controls (nothing clipped), and the volume control is always there (a slider row, or the volume button of the transport row).
describe("Now Playing: no control is cut off", () => {
  for (const gap of [8, 10, 12]) {
    for (const [cw, ch] of [[2, 1], [2, 2], [3, 2], [4, 2]] as const) {
      for (let cell = 90; cell <= 140; cell += 2) {
        const tw = cell * cw + gap * (cw - 1), th = cell * ch + gap * (ch - 1);
        test(`${cw}x${ch} cell ${cell} gap ${gap} (${tw}x${th})`, () => {
          const v = npVariant(tw, th);
          expect(v).not.toBe("capsule");
          expect(tw).toBeGreaterThanOrEqual(NP_NEED[v]!.w);
          expect(th).toBeGreaterThanOrEqual(NP_NEED[v]!.h);
          if (v === "large") {
            // the controls column keeps the room for 3 transport buttons + the volume button
            const col = tw - 32 - 14 - npCoverSize(tw, th);
            expect(col).toBeGreaterThanOrEqual(NP_COL_MIN);
            expect(npCoverSize(tw, th)).toBeLessThanOrEqual(th - 24);
          }
          // the slider row only when the column is tall enough for it; otherwise the volume button (always rendered by every layout above capsule)
          if (npInlineVol(v, tw, th) && v !== "tall") expect(th).toBeGreaterThanOrEqual(v === "large" ? 236 : 250);
        });
      }
    }
  }
  test("a short wide tile gets the one-row layout, not stacked rows", () => {
    expect(npVariant(390, 100)).toBe("compact");
    expect(npVariant(260, 125)).toBe("mini"); // under 280 px wide: the 2x1 face
    expect(npVariant(506, 248)).toBe("large");
  });
  test("a square or upright tile gets the tall layout with a big cover that leaves room for the rows under it", () => {
    for (const gap of [8, 10, 12]) {
      for (let cell = 70; cell <= 140; cell += 2) {
        for (const [cw, ch] of [[4, 4], [3, 4], [3, 3]] as const) {
          const tw = cell * cw + gap * (cw - 1), th = cell * ch + gap * (ch - 1);
          if (tw < 260 || th < 260) continue;
          expect(npVariant(tw, th)).toBe("tall");
          const cs = npTallCover(tw, th);
          const rest = npTallRest(th) + (npInlineVol("tall", tw, th) ? NP_TALL_VOL : 0);
          expect(cs + rest).toBeLessThanOrEqual(Math.max(th, 56 + rest));
          expect(cs).toBeLessThanOrEqual(tw - (npTallSnug(th) ? 40 : 64));
        }
      }
    }
    expect(npVariant(572, 288)).toBe("large");
  });
});

describe("Now Playing: small and square tiles (media-fix1)", () => {
  test("2x2 (about 180 px) gets the square face, from 220 px (3x3 on the S20, about 245 px) the tall one", () => {
    expect(npVariant(180, 180)).toBe("square");
    expect(npVariant(150, 150)).toBe("square");
    expect(npVariant(215, 215)).toBe("square");
    expect(npVariant(250, 250)).toBe("tall");
    expect(npVariant(280, 280)).toBe("tall");
    expect(npTallSnug(280)).toBe(true);
    expect(npTallCover(280, 280)).toBeGreaterThanOrEqual(100);
    expect(npVariant(800, 800)).toBe("tall");
    expect(npTallSnug(800)).toBe(false);
  });
  test("the square face fits: cover + text never taller than the tile, the cover never wider", () => {
    for (let side = 130; side < 260; side += 5) for (const chip of [false, true]) {
      const a = npSquareArtist(side, side, chip);
      const cs = npSquareCover(side, side, a, chip);
      expect(cs).toBeLessThanOrEqual(side - 24);
      expect(cs + 24 + 22 + (a ? 18 : 0) + (chip ? 22 : 0) + 8).toBeLessThanOrEqual(Math.max(side, 48 + 24 + 30));
    }
    expect(npSquareArtist(180, 180, false)).toBe(true);
  });
  test("the one-row strip drops the volume button first, then the text, never a title of one or two letters", () => {
    // 2x1 at about 230 px: no volume button, cover + 2-line title + play
    expect(npCompactParts(230, 90, true)).toMatchObject({ vol: false, text: true });
    // narrow (180 px): cover + play only
    expect(npCompactParts(180, 90, true)).toMatchObject({ vol: false, text: false });
    // 4x1 strip keeps everything (unchanged)
    expect(npCompactParts(390, 90, true)).toMatchObject({ vol: true, text: true, levels: true });
    for (let tw = 130; tw <= 600; tw += 10) {
      const p = npCompactParts(tw, 90, true);
      const room = tw - 24 - (p.cover + 10) - 60 - (p.vol ? 44 : 0) - (p.levels ? 30 : 0);
      if (p.text) expect(room).toBeGreaterThanOrEqual(88);
      if (p.vol) expect(room).toBeGreaterThanOrEqual(p.levels ? 80 : 110);
    }
  });
});

describe("Now Playing: design pass (kn-visual / kn-motion)", () => {
  const fs = require("fs"), path = require("path");
  const css = fs.readFileSync(path.join(import.meta.dir, "../web/deck/src/deck.css"), "utf8");
  const tsx = fs.readFileSync(path.join(import.meta.dir, "../web/deck/src/now-playing.tsx"), "utf8");
  test("no coloured glow behind the disc, no fixed cyan outside the theme accent", () => {
    expect(tsx).not.toContain("pd-npl__glow");
    expect(css).not.toContain(".pd-npl__glow");
    expect(css.slice(css.indexOf(".pd-npc--ph {"), css.indexOf(".pd-npl__chip {"))).not.toMatch(/#67e8f9|34, 211, 238/);
  });
  test("motion: the disc spin is -webkit- prefixed and stops under reduced motion; the progress fill scales linearly with its tick", () => {
    expect(css).toContain("@-webkit-keyframes pd-vinyl-spin");
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.pd-npc--disc \{ -webkit-animation: none; animation: none; \} \}/);
    expect(css).toContain("transition: transform 250ms linear");
    expect(tsx).toContain("pd-npl__fill--prog");
    expect(tsx).toContain("const TR_MS = 420");
    expect(tsx).not.toMatch(/0\.88 \+ 0\.12/);
  });
  test("one looping playing signal: the level bars only stand in when there is no artwork disc to spin", () => {
    expect(tsx).toContain("const levelsOn = state === 'playing' && (!(track && track.cover) || reducedMotion())");
    expect(tsx).not.toContain("state === 'playing' ? <Levels");
  });
});

describe("Now Playing: 2x1 and 1x1 (media-2x1)", () => {
  const u = require("../web/deck/src/now-playing-utils");
  for (const gap of [8, 10, 12]) for (let cell = 70; cell <= 140; cell += 2) {
    test(`2x1 and 1x1 at cell ${cell} gap ${gap}`, () => {
      // 2x1
      const tw = cell * 2 + gap, th = cell;
      const v = u.npVariant(tw, th);
      expect(["mini", "compact"]).toContain(v);
      if (v === "mini") {
        const m = u.npMiniParts(tw, th);
        // the title keeps at least 72 px (about 12 letters a line), never a few letters
        expect(m.titleRoom).toBeGreaterThanOrEqual(72);
        // padding + cover + title + play fit the width; the text lines fit the height
        expect(24 + (m.cover ? m.cover + 10 : 0) + m.titleRoom + u.NP_MINI_PLAY + 6).toBeLessThanOrEqual(tw);
        expect(24 + (m.titleLines === 2 ? 2 * 13 * 1.2 : 14 * 1.25 + (m.artist ? 12.5 * 1.25 + 2 : 0))).toBeLessThanOrEqual(th);
        expect(u.NP_MINI_PLAY).toBeGreaterThanOrEqual(44);
        if (m.cover) expect(m.cover).toBeLessThanOrEqual(th - 24);
      } else {
        const p = u.npCompactParts(tw, th, true);
        if (p.text) expect(tw - 24 - (p.cover + 10) - 60 - (p.vol ? 44 : 0)).toBeGreaterThanOrEqual(88);
      }
      // 1x1: the whole tile is the hit area; the badge is about 38% of it, 20 to 40 px
      const v1 = u.npVariant(cell, cell);
      if (v1 === "capsule") {
        const b = u.npCapsuleBadge(cell, cell);
        expect(cell).toBeGreaterThanOrEqual(44);
        expect(b).toBeGreaterThanOrEqual(20);
        expect(b).toBeLessThanOrEqual(Math.max(20, Math.round(cell * 0.4)));
      } else expect(v1).toBe("square");
    });
  }
});

describe("Now Playing: volume steps (media-volume)", () => {
  const u = require("../web/deck/src/now-playing-utils");
  test("a press is 5 points, clamped to 0..100", () => {
    expect([u.stepVolume(38, 1), u.stepVolume(38, -1), u.stepVolume(98, 1), u.stepVolume(3, -1)]).toEqual([43, 33, 100, 0]);
  });
  test("press and hold: one step at once, the first repeat at 400 ms, then every 120 ms", () => {
    expect([u.holdSteps(0), u.holdSteps(399), u.holdSteps(400), u.holdSteps(519), u.holdSteps(520), u.holdSteps(1000)]).toEqual([1, 1, 2, 2, 3, 7]);
  });
  test("where the steps go: a 4x4 keeps its volume row with -/+ (the disc shrinks a little), narrow rows keep the speaker", () => {
    for (const side of [330, 400, 500, 800]) { // 4x4 on the S20 is about 330 css px
      expect(u.npVariant(side, side)).toBe("tall");
      expect(u.npTallVol(side)).toBe(true);
      expect(u.npTallCover(side, side)).toBeGreaterThanOrEqual(88);
      expect(side - (u.npTallSnug(side) ? 24 : 32)).toBeGreaterThanOrEqual(u.NP_VOL_STEPS_W);
    }
    expect(u.NP_TR_STEPS_W).toBe(44 + 52 + 44 + 12 + 88 + 8);
    expect(u.NP_VOL_STEPS_W).toBeGreaterThanOrEqual(44 * 3 + 80);
  });
});

describe("Now Playing: 3x3 gets the shrunken tall card (polish-round)", () => {
  const u = require("../web/deck/src/now-playing-utils");
  for (const gap of [8, 10, 12]) for (let cell = 70; cell <= 84; cell += 2) {
    const side = cell * 3 + gap * 2;
    test(`3x3 at cell ${cell} gap ${gap} (${side} px)`, () => {
      expect(u.npVariant(side, side)).toBe("tall");
      if (!u.npTallXs(side)) return;
      const cs = u.npTallCover(side, side);
      // the disc and the rows under it fit the height; the disc keeps clear of the 44 px corner speaker (8 px in, 4 px air)
      expect(cs + u.NP_TALL_REST_XS).toBeLessThanOrEqual(side);
      expect((side - cs) / 2).toBeGreaterThanOrEqual(12 + 44 + 4);
      expect(cs).toBeGreaterThanOrEqual(56);
      // prev 44 + play 48 (6 px each side) + next 44 fit the row; no volume row at this size
      expect(44 + 48 + 12 + 44).toBeLessThanOrEqual(side - 24);
      expect(u.npInlineVol("tall", side, side)).toBe(false);
    });
  }
});
