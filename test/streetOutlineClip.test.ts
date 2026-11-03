import { describe, expect, it } from "vitest";
import type { Vec2 } from "../src/core/geo";
import { clipStreetsAtOutlines, STREET_ROOM } from "../src/core/streetOutlineClip";

const box = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** A street along x from 0 to 100, a point every 2 m; left is +y. */
const street = (width: number, median?: number): { pts: Vec2[]; width: number; widths?: number[]; median?: number } => ({ pts: Array.from({ length: 51 }, (_, i) => [i * 2, 0] as Vec2), width, ...(median !== undefined ? { median } : {}) });
const edgeAt = (st: ReturnType<typeof street>, i: number) => ({ l: st.pts[i][1] + (st.widths?.[i] ?? st.width) / 2, r: st.pts[i][1] - (st.widths?.[i] ?? st.width) / 2 });

describe("networkCore streets keep clear of landmarks", () => {
  it("draws the edge in off a canopy, the far edge staying put", () => {
    const st = street(11.5, 1); // two 5.25 m carriageways and a 1 m median
    expect(clipStreetsAtOutlines([st], [box(40, 3.5, 60, 20)])).toBe(1);
    const mid = edgeAt(st, 25);
    expect(mid.l).toBeCloseTo(3.5 - STREET_ROOM, 5);
    expect(mid.r).toBeCloseTo(-5.75, 5);
    // Unchanged at the ends (the junctions' caps), eased in between.
    expect(edgeAt(st, 0).l).toBeCloseTo(5.75, 5);
    expect(edgeAt(st, 50).l).toBeCloseTo(5.75, 5);
    for (let i = 1; i < 51; i++) expect(Math.abs(edgeAt(st, i).l - edgeAt(st, i - 1).l)).toBeLessThanOrEqual(0.2 * 2 + 1e-9);
  });

  it("keeps each carriageway 3 m, and leaves streets clear of every outline alone", () => {
    const st = street(11.5, 1);
    clipStreetsAtOutlines([st], [box(40, 0.5, 60, 20)]);
    expect(edgeAt(st, 25).l - edgeAt(st, 25).r).toBeCloseTo(7, 5); // 1 + 2 x 3
    const clear = street(7);
    expect(clipStreetsAtOutlines([clear], [box(40, 4.5, 60, 20)])).toBe(0);
    expect(clear.widths).toBeUndefined();
  });
});
