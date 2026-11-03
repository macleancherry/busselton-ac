import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BUILDING_ROOM, clipTraceAtOutlines } from "../src/core/buildingTraceClip";
import type { Vec2 } from "../src/core/geo";
import { landmarkModel, landmarkOutline } from "../src/core/landmarkLayer";
import { frontRoom, ringRoom } from "../src/core/stages/houses";
import type { TraceResult, TraceSample } from "../src/core/trace";

// A straight road along x, sampled every 2 m, mapped 7 m wide; left is +y.
const road = (n = 51, width = 7): TraceSample[] => Array.from({ length: n }, (_, i) => ({ pos: [i * 2, 0] as Vec2, left: [0, 1] as Vec2, width, s: i * 2 }));
/** A trace that found the road `w` wide, its middle `off` to the left, fully trusted. */
const traced = (n: number, w: number, off = 0, conf = 1): TraceResult => ({ offset: new Array(n).fill(off * conf), width: new Array(n).fill(w), conf: new Array(n).fill(conf), coverage: 1 });
const box = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** The edges applyTrace will lay. */
const edges = (s: TraceSample[], tr: TraceResult, i: number) => {
  const w = s[i].width + (tr.width[i] - s[i].width) * tr.conf[i];
  return { l: tr.offset[i] + w / 2, r: tr.offset[i] - w / 2 };
};

describe("traced edges keep clear of buildings", () => {
  it("pulls an edge that took the footpath back to short of a shopfront, eased out along the road", () => {
    // Traced 12 m wide: the left edge at 6 m, over a 1.5 m footpath to a building at 5.5 m.
    const s = road(), tr = traced(s.length, 12);
    expect(clipTraceAtOutlines(s, tr, [box(40, 5.5, 60, 20)])).toBeGreaterThan(0);
    const mid = edges(s, tr, 25);
    expect(mid.l).toBeCloseTo(5.5 - BUILDING_ROOM, 5);
    expect(mid.r).toBeCloseTo(-6, 5); // the other side untouched
    // Eased: back to the trace's edge well away from the building, never over it in between.
    expect(edges(s, tr, 0).l).toBeCloseTo(6, 5);
    for (let i = 0; i < s.length; i++) {
      const x = s[i].pos[0];
      if (x >= 40 && x <= 60) expect(edges(s, tr, i).l).toBeLessThanOrEqual(5.5 - BUILDING_ROOM + 1e-6);
    }
  });

  it("goes at most INTO_MAPPED inside the mapped width, and keeps 60% of it", () => {
    const s = road(51, 10), tr = traced(s.length, 10);
    clipTraceAtOutlines(s, tr, [box(40, 3, 60, 20)]); // a building 3 m from the middle of a 10 m road
    expect(edges(s, tr, 25).l).toBeCloseTo(3.5, 5); // 5 - 1.5
    const s2 = road(51, 6), tr2 = traced(s2.length, 6);
    clipTraceAtOutlines(s2, tr2, [box(40, 1.5, 60, 20)]);
    expect(edges(s2, tr2, 25).l).toBeCloseTo(1.8, 5); // 60% of 6 m, from the middle
  });

  it("works through a part trust: the laid edge lands where it should", () => {
    const s = road(), tr = traced(s.length, 12, 0, 0.5); // laid 9.5 m wide
    expect(edges(s, tr, 25).l).toBeCloseTo(4.75, 5);
    clipTraceAtOutlines(s, tr, [box(40, 4.5, 60, 20)]);
    expect(edges(s, tr, 25).l).toBeCloseTo(4, 5);
    expect(tr.conf[25]).toBe(0.5); // the trust isn't changed (kerb evidence and paint read it)
  });

  it("leaves alone a building clear of the edge, one across the middle, and untraced rows", () => {
    const s = road(), tr = traced(s.length, 7);
    const before = JSON.stringify(tr);
    expect(clipTraceAtOutlines(s, tr, [box(40, 4.2, 60, 20)])).toBe(0); // 0.7 m clear of the 3.5 m edge
    expect(clipTraceAtOutlines(s, tr, [box(40, -2, 60, 20)])).toBe(0); // over the middle: bad data
    expect(JSON.stringify(tr)).toBe(before);
    // A row a noTrace zone faded out keeps its mapped line.
    const faded = traced(s.length, 12, 0, 0);
    expect(clipTraceAtOutlines(s, faded, [box(40, 3, 60, 20)])).toBe(0);
  });

  it("clips an untraced row from its mapped edges", () => {
    const s = road(), un = traced(s.length, 12);
    un.width.fill(NaN);
    un.conf.fill(0);
    expect(clipTraceAtOutlines(s, un, [box(40, 3, 60, 20)])).toBeGreaterThan(0);
    expect(edges(s, un, 25).l).toBeCloseTo(2.5, 5);
    expect(edges(s, un, 25).r).toBeCloseTo(-3.5, 5);
    expect(un.conf[25]).toBeLessThan(0.7);
    expect(Number.isNaN(un.width[0])).toBe(true); // far from it, still untraced
  });
});

describe("a landmark's outline", () => {
  const tav = JSON.parse(readFileSync("routes/landmarks/the_tav.json", "utf8"));
  const place = { centre: [100, 200] as Vec2, toRoad: [-1, 0] as Vec2 };

  it("covers its blocks and its awning out to the awning's edge", () => {
    const rings = landmarkOutline(tav, place);
    const lm = landmarkModel(tav, { ...place, z: 0 }, "t", () => 0);
    // Every block footprint is one of the rings.
    for (const f of lm.footprints) expect(rings.some((r) => r.every((p, k) => Math.hypot(p[0] - f[k][0], p[1] - f[k][1]) < 1e-9))).toBe(true);
    // Facing west (toRoad -x): the awning reaches further west than any block.
    const west = (rs: Vec2[][]) => Math.min(...rs.flat().map((p) => p[0]));
    expect(west(rings)).toBeLessThan(west(lm.footprints) - 2);
  });
});

describe("a front wall's room to the road", () => {
  it("is the least along the whole wall, not its middle", () => {
    // A road edge along y = 0; the wall from (0, 5) to (10, 2): 3.5 m at its middle, 2 m at its end.
    expect(frontRoom([[0, 5], [10, 2]], (_x, y) => y)).toBeCloseTo(2, 5);
  });
});

describe("a footprint's room to the road", () => {
  it("sees a corner on the road", () => {
    expect(ringRoom([[0, 2], [10, 2], [10, 8], [0, 8]], (_x, y) => y)).toBeCloseTo(2, 5);
    expect(ringRoom([[0, -1], [10, 2], [10, 8], [0, 8]], (_x, y) => y)).toBeCloseTo(-1, 5);
  });
});
