import { describe, expect, it } from "vitest";
import { bayBand, clearOffsets, lanesOverBays, LANE_CLEAR, LANE_SLACK, RAMP, withBayBands, type BayBox } from "../src/core/bayLanes";
import { buildKerbside, type Carriageway, type KerbsideWay } from "../src/core/kerbside";
import { carFootprint, LANE_HALF } from "../src/core/parkedClear";
import { trafficGraph, type TrafficRoad } from "../src/core/traffic";
import { keepLeftOffsets } from "../src/core/keepLeft";
import { buildAiLine } from "../src/core/aiLine";
import { withDefaults } from "../src/core/options";
import { planRoad } from "../src/core/road";
import type { Vec2 } from "../src/core/geo";

/** An east-west street from x0 to x1 at y = 0, `w` wide, flat. */
function street(x0: number, x1: number, w: number, extra: Partial<Carriageway> = {}): Carriageway {
  const pts: Vec2[] = [];
  for (let x = x0; x <= x1 + 1e-9; x += 4) pts.push([x, 0]);
  return { pts, widths: pts.map(() => w), z: () => 10, ...extra };
}
const tagged = (left: KerbsideWay["left"], right: KerbsideWay["right"], x0 = -10, x1 = 210): KerbsideWay => ({ pts: [[x0, 0.3], [x1, 0.3]], left, right });

/** Bay paint triangles (local x, y) from kerbside's nodes. */
function bayPaint(nodes: { name: string; positions: number[] | Float32Array; indices: number[] | Uint16Array | Uint32Array }[]): [Vec2, Vec2, Vec2][] {
  const out: [Vec2, Vec2, Vec2][] = [];
  for (const m of nodes.filter((n) => n.name.startsWith("KERBSIDE_BAY_"))) {
    const p = m.positions, v = (i: number): Vec2 => [p[i * 3], -p[i * 3 + 2]];
    for (let t = 0; t < m.indices.length; t += 3) out.push([v(m.indices[t]), v(m.indices[t + 1]), v(m.indices[t + 2])]);
  }
  return out;
}
const lanePts = (g: ReturnType<typeof trafficGraph>) => g.lanes.map((l) => l.points.map((p) => [p[0], -p[2]] as Vec2));
const distToLine = (pts: Vec2[], q: Vec2) => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2));
    best = Math.min(best, Math.hypot(q[0] - a[0] - dx * t, q[1] - a[1] - dy * t));
  }
  return best;
};

describe("lane offsets clear of bays", () => {
  it("leaves lanes alone where no bay is near them", () => {
    expect(clearOffsets([1.75, -1.75], null, null, 3.5, false)).toEqual([1.75, -1.75]);
    // Bays both sides of an 11 m street: the lanes already clear them.
    expect(clearOffsets([1.75, -1.75], -3.4, 3.4, 5.5, false)).toEqual([1.75, -1.75]);
  });

  it("moves the lane on the bays' side in", () => {
    // 10 m street, parallel bays both sides: lanes at +-1.5, still 3 m apart.
    const o = clearOffsets([1.75, -1.75], -2.9, 2.9, 5, false);
    expect(o[0]).toBeCloseTo(2.9 - LANE_CLEAR);
    expect(o[1]).toBeCloseTo(-(2.9 - LANE_CLEAR));
  });

  it("spreads both lanes over what's left on a narrow two-way street", () => {
    // 7.7 m, bays on the left 2.1 m deep: 5.6 m left, two 2.8 m lanes.
    const o = clearOffsets([1.75, -1.75], null, 1.75, 3.85, false);
    expect(o[0]).toBeCloseTo(1.75 - 1.4);
    expect(o[1]).toBeCloseTo(-3.85 + 1.4);
    expect(o[0] - o[1]).toBeGreaterThanOrEqual(2.8 - 1e-9);
  });

  it("keeps the lanes where they were when the street is too narrow for both and the bays", () => {
    expect(clearOffsets([1.75, -1.75], null, 1.4, 3.5, false)).toEqual([1.75, -1.75]);
  });

  it("closes the lanes a few centimetres under 2.8 m rather than leave them in the bays", () => {
    // Margaret River: 7.43 m traced street, a narrowed bay's car reaching 1.84 m in from the right.
    const o = clearOffsets([1.75, -1.75], -1.84, null, 3.715, false);
    expect(o[1]).toBeCloseTo(-1.84 + LANE_CLEAR);
    expect(o[0]).toBeCloseTo(3.715 - 1.4);
    expect(o[0] - o[1]).toBeGreaterThan(2.8 - LANE_SLACK);
    // Further short than the slack: still kept where they were (kerbside.ts drops those bays).
    expect(clearOffsets([1.75, -1.75], -1.6, null, 3.715, false)).toEqual([1.75, -1.75]);
  });

  it("moves a one-way street's lane off the bays, keeping 3 m", () => {
    const o = clearOffsets([0], null, 0.9, 3, true);
    expect(o[0]).toBeCloseTo(0.9 - LANE_CLEAR);
    expect(clearOffsets([0], -0.2, 0.5, 2.5, true)).toEqual([0]);
    // Two one-way lanes squeezed: spread, or kept when under 3 m each.
    const two = clearOffsets([1.75, -1.75], -2, 4, 4, true);
    expect(two[0] - two[1]).toBeCloseTo(3);
    expect(Math.max(...two)).toBeLessThanOrEqual(4 - LANE_CLEAR + 1e-9);
  });
});

describe("bay band", () => {
  const box = (x: number, y: number, halfDepth = 1.05): BayBox => ({ c: [x, y], along: [1, 0], halfLen: 3, halfDepth, street: 1 });

  it("finds the bays' inner edge on each side, and eases in and out", () => {
    const pts: Vec2[] = Array.from({ length: 51 }, (_, i) => [i * 2, 0]);
    // Bays on the left from x 40 to 58, on a 7.7 m street (kerb paint 0.1 m in).
    const boxes = [43, 49, 55].map((x) => box(x, 3.85 - 0.1 - 1.05));
    const band = bayBand(pts, 7.7, boxes)!;
    expect(band).not.toBeNull();
    const at = (x: number) => pts.findIndex((p) => p[0] >= x);
    expect(band.hi[at(50)]).toBeCloseTo(3.85 - 0.1 - 2.1, 3);
    expect(band.lo[at(50)]).toBeNull();
    // Already clear half a car before the first bay's end (x 37.75), easing out at RAMP.
    expect(band.hi[at(38)]).toBeCloseTo(1.65, 3);
    expect(band.hi[at(30)]).toBeCloseTo(1.65 + RAMP * 8, 3);
    for (let i = 1; i < pts.length; i++) expect(Math.abs(band.hi[i]! - band.hi[i - 1]!)).toBeLessThanOrEqual(RAMP * 2 + 1e-6);
  });

  it("ignores another street's bays", () => {
    const pts: Vec2[] = Array.from({ length: 21 }, (_, i) => [i * 2, 0]);
    // Across the road (a crossing street's bays), and on a parallel street 15 m away.
    expect(bayBand(pts, 7, [{ c: [20, 2], along: [0, 1], halfLen: 3, halfDepth: 1, street: 2 }, box(20, 15)])).toBeNull();
  });
});

describe("traffic lanes and parked cars on a narrow two-way street", () => {
  // 7.7 m two-way street, 200 m, parallel bays along its left (north) kerb.
  const cw = street(0, 200, 7.7);
  const k = buildKerbside([cw], [tagged({ parking: "parallel" }, {})]);
  const road: TrafficRoad = { pts: cw.pts, h: cw.pts.map(() => 10), width: 7.7, speed: 50 };

  it("paints the bays as their own meshes, with a box per slot", () => {
    expect(k.bays).toBeGreaterThan(20);
    expect(k.boxes.length).toBe(k.slots.length);
    expect(k.nodes.some((n) => n.name.startsWith("KERBSIDE_BAY_"))).toBe(true);
    // The box reaches from the kerb's paint to the bay's inner line: 2.0 m deep, 6 m long.
    expect(k.boxes[0].halfDepth * 2).toBeCloseTo(2.0, 2);
    expect(k.boxes[0].c[1]).toBeCloseTo(3.85 - 0.1 - 1.0, 2);
  });

  it("used to run a lane through the bays; with the bands it clears them and every bay's car", () => {
    const paint = bayPaint(k.nodes);
    const before = trafficGraph([road], []);
    expect(lanesOverBays(lanePts(before), paint).length).toBeGreaterThan(0);
    const after = trafficGraph(withBayBands([road], k.boxes), []);
    expect(lanesOverBays(lanePts(after), paint)).toEqual([]);
    // Every bay's car keeps half a lane off every lane (parkedClear.ts would keep it).
    const lanes = lanePts(after);
    for (const sl of k.slots) {
      const d = Math.min(...carFootprint(sl.at, sl.dir).map((q) => Math.min(...lanes.map((l) => distToLine(l, q)))));
      expect(d).toBeGreaterThanOrEqual(LANE_HALF - 1e-6);
    }
    // Both lanes still on the asphalt and 2.8 m apart mid-street.
    const fwd = after.lanes.find((l) => l.name.includes("forward"))!, back = after.lanes.find((l) => l.name.includes("back"))!;
    const mid = (l: typeof fwd) => -l.points[Math.floor(l.points.length / 2)][2];
    expect(mid(fwd) - mid(back)).toBeGreaterThanOrEqual(2.8 - 1e-6);
    expect(mid(back)).toBeGreaterThanOrEqual(-3.85 + 1.4 - 1e-6);
  });

  it("keeps the lanes and leaves the bays to kerbside.ts on a street too narrow for both", () => {
    // kerbside.ts paints nothing on a 7 m two-way street with one side's parking...
    const narrow = street(0, 200, 7);
    expect(buildKerbside([narrow], [tagged({ parking: "parallel" }, {})]).bays).toBe(0);
    // ...and if bays were there anyway, the lanes don't squeeze under 2.8 m.
    const boxes = k.boxes.map((b) => ({ ...b, c: [b.c[0], b.c[1] - 0.35] as Vec2 }));
    const g = trafficGraph(withBayBands([{ ...road, width: 7 }], boxes), []);
    for (const l of g.lanes) for (const p of l.points) expect(Math.abs(Math.abs(p[2]) - 1.75)).toBeLessThan(1e-6);
  });

  it("clears angle bays too", () => {
    // 11 m two-way street with 45 degree bays on the left (3.9 m deep).
    const wide = street(0, 200, 11);
    const ka = buildKerbside([wide], [tagged({ parking: "diagonal" }, {})]);
    expect(ka.bays).toBeGreaterThan(10);
    const g = trafficGraph(withBayBands([{ pts: wide.pts, h: wide.pts.map(() => 10), width: 11, speed: 50 }], ka.boxes), []);
    expect(lanesOverBays(lanePts(g), bayPaint(ka.nodes))).toEqual([]);
    const lanes = lanePts(g);
    for (const sl of ka.slots) {
      const d = Math.min(...carFootprint(sl.at, sl.dir).map((q) => Math.min(...lanes.map((l) => distToLine(l, q)))));
      expect(d).toBeGreaterThanOrEqual(LANE_HALF - 1e-6);
    }
  });
});

describe("keep-left line clear of the route's bays", () => {
  const pts: Vec2[] = [];
  for (let x = 0; x <= 400; x += 10) pts.push([x, 0]);
  const plan = planRoad(pts, withDefaults({ defaultWidth: 7.7, banking: false }));

  it("moves in off bays on the left, and back out past them", () => {
    const k = buildKerbside([street(0, 400, 7.7)], [tagged({ parking: "parallel" }, {}, 150, 250)]);
    expect(k.bays).toBeGreaterThan(5);
    const plain = keepLeftOffsets(plan);
    const off = keepLeftOffsets(plan, k.boxes);
    const at = (x: number) => plan.samples.findIndex((s) => s.pos[0] >= x);
    expect(plain[at(200)]).toBeCloseTo(1.925, 2);
    expect(off[at(200)]).toBeCloseTo(3.85 - 2.1 - LANE_CLEAR, 2);
    expect(off[at(50)]).toBeCloseTo(plain[at(50)], 6);
    expect(off[at(350)]).toBeCloseTo(plain[at(350)], 6);
    const ai = buildAiLine(plan, { keepLeft: true, bays: k.boxes });
    expect(-ai[at(200)].position[2]).toBeCloseTo(off[at(200)], 2);
  });

  it("goes right of centre when the bays leave no room left of it", () => {
    const k = buildKerbside([street(0, 400, 11.5)], [tagged({ parking: "perpendicular" }, {}, 150, 250)]);
    expect(k.bays).toBeGreaterThan(5);
    const wide = planRoad(pts, withDefaults({ defaultWidth: 11.5, banking: false }));
    const off = keepLeftOffsets(wide, k.boxes);
    const at = (x: number) => wide.samples.findIndex((s) => s.pos[0] >= x);
    // 5.4 m bays from the left kerb, 5.75 m out: their inner edge 0.35 m left of centre, the line half a lane right of that.
    expect(off[at(200)]).toBeCloseTo(0.35 - LANE_CLEAR, 2);
    const ai = buildAiLine(wide, { keepLeft: true, bays: k.boxes });
    expect(-ai[at(200)].position[2]).toBeCloseTo(off[at(200)], 2);
  });
});
