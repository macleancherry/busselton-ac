import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildSpecHouse, clearRects, type HouseSpec } from "../src/core/specHouse";
import { landmarkModel, LANDMARK_KEEP_OFF } from "../src/core/landmarkLayer";

// A spec facing north (the street to the north): seen from the street spec x runs east to west, and
// spec y runs back south. Its centre (10, 5) at the origin, a spec point (x, y) is on the map at (10 - x, 5 - y).
const yard: HouseSpec = {
  blocks: [{ name: "pub", x0: 0, x1: 20, y0: 0, y1: 10, roof: "none" }],
  paving: [{ x0: 0, y0: -10, x1: 20, y1: 0 }],
  hedges: [{ x0: 0, x1: 20, y0: -9, depth: 1 }],
  fences: [{ x0: 0, y0: -6, x1: 20, y1: -5.9, open: true }],
  trees: [{ x: 5, y: -8, height: 6 }, { x: 5, y: -2, height: 6 }],
  tables: [{ x: 15, y: -8 }, { x: 15, y: -2 }],
  umbrellas: [{ x: 10, y: -8 }],
  flags: [{ x: 2, y: -8 }],
};
const place = { centre: [0, 0] as [number, number], toRoad: [0, 1] as [number, number], z: 0 };
// The spec's centre is (10, 5): spec y = -7 is map y 12, so the road covers spec y < -7 (the front 3 m of the yard).
const roadNorthOf = (y: number) => ({ blocked: (_x: number, my: number) => my > y });

const area = (n: { positions: Float32Array; indices: Uint16Array }) => {
  let a = 0;
  for (let i = 0; i < n.indices.length; i += 3) {
    const p = (k: number) => [n.positions[n.indices[i + k] * 3], n.positions[n.indices[i + k] * 3 + 2]];
    const [p0, p1, p2] = [p(0), p(1), p(2)];
    a += Math.abs((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1])) / 2;
  }
  return a;
};

describe("landmarks keep off the built road", () => {
  it("without a road, builds exactly what it always did", () => {
    const rr = JSON.parse(readFileSync("routes/landmarks/rocky_ridge.json", "utf8")) as HouseSpec;
    const a = buildSpecHouse(rr, place, "rr");
    const b = buildSpecHouse(rr, place, "rr", { blocked: () => false });
    expect(b.nodes.map((n) => [n.name, n.positions.length])).toEqual(a.nodes.map((n) => [n.name, n.positions.length]));
    expect(b.clipped).toEqual([]);
    expect(b.overRoad).toEqual([]);
  });

  it("cuts the paving and hedge back off the road, and leaves out the trees, tables, umbrellas and flags on it", () => {
    const h = buildSpecHouse(yard, place, "y", roadNorthOf(12));
    const paving = h.nodes.find((n) => n.material.endsWith("paving0"))!;
    // 20 x 10 of paving, the front 3 m on the road: 20 x 7 left, still facing up.
    expect(area(paving)).toBeCloseTo(140, 0);
    for (let i = 1; i < paving.normals.length; i += 3) expect(paving.normals[i]).toBeGreaterThan(0.99);
    // No hedge (it's all on the road), the fence (2 m behind the road's edge) whole.
    expect(h.nodes.some((n) => n.material === "hedge")).toBe(false);
    expect(h.trees).toHaveLength(1);
    expect(h.trees[0].y).toBeCloseTo(7, 5);
    expect(h.clipped.join("\n")).toMatch(/paving0: 60 of 200 m2 cut off the road/);
    expect(h.clipped.join("\n")).toMatch(/hedge0: 20 of 20 m cut/);
    expect(h.clipped.join("\n")).toMatch(/1 of 2 trees left off/);
    expect(h.clipped.join("\n")).toMatch(/1 of 2 tables left off/);
    expect(h.clipped.join("\n")).toMatch(/1 of 1 umbrellas left off/);
    expect(h.clipped.join("\n")).toMatch(/1 of 1 flags left off/);
    expect(h.clipped.some((c) => c.startsWith("fence"))).toBe(false);
    expect(h.overRoad).toEqual([]);
  });

  it("cuts a fence to the pieces off the road, keeping its walls to hit", () => {
    // A road 4 m wide crossing the yard north-south at map x -2..2 (spec x 8..12).
    const h = buildSpecHouse(yard, place, "y", { blocked: (x) => Math.abs(x) < 2 });
    expect(h.clipped.join("\n")).toMatch(/fence0: 4\.0 of 20 m cut/);
    const wall = h.nodes.find((n) => n.name.startsWith("1WALL_SPECHOUSE"))!;
    // The fence's walls (map y 10.9 to 11, AC z -11 to -10.9) have none on the road; some either side.
    let either = 0;
    for (let i = 0; i < wall.positions.length; i += 3) {
      if (wall.positions[i + 2] < -11.05 || wall.positions[i + 2] > -10.85) continue;
      expect(Math.abs(wall.positions[i])).toBeGreaterThan(1.9);
      either++;
    }
    expect(either).toBeGreaterThan(8);
  });

  it("reports a building on the road, but never cuts it", () => {
    const h = buildSpecHouse(yard, place, "y", roadNorthOf(3)); // spec y < 2: the front 2 m of the pub
    expect(h.overRoad).toEqual([{ part: "block pub", area: 40 }]);
    const free = buildSpecHouse(yard, place, "y");
    const walls = (x: typeof h) => x.nodes.filter((n) => n.material.startsWith("facade_")).reduce((a, n) => a + n.positions.length, 0);
    expect(walls(h)).toBe(walls(free));
  });

  it("landmark layers pass it through and say what they cut", () => {
    const lm = landmarkModel(yard, place, "y", () => 0, { blocked: roadNorthOf(12).blocked });
    expect(lm.clipped.length).toBeGreaterThan(3);
    expect(lm.overRoad).toEqual([]);
  });

  it("keeps off roads, streets and kerbs, not paths, driveways or car parks", () => {
    for (const n of ["1ROAD_000", "1ROAD_GUTTER_000", "1STREET_004_T3", "1KERB_000", "1KERB_RB_001", "1UNSEALED_0"]) expect(LANDMARK_KEEP_OFF.test(n), n).toBe(true);
    for (const n of ["1ROAD_PATH_FOOT_T1", "1STREET_PATH_0", "1STREET_DRIVE_0", "1STREET_CARPARK_0", "1GRASS_t", "1WALL_X"]) expect(LANDMARK_KEEP_OFF.test(n), n).toBe(false);
  });
});

describe("clearRects", () => {
  it("returns the rectangle itself when nothing is cut, and merges what's left into few rectangles", () => {
    const r = { x0: 0, y0: 0, x1: 10, y1: 6 };
    expect(clearRects(r, () => true).rects).toEqual([r]);
    // A 2 m wide road through the middle: two rectangles either side.
    const c = clearRects(r, (x) => x < 4 || x > 6);
    expect(c.rects).toHaveLength(2);
    expect(c.rects.reduce((a, q) => a + (q.x1 - q.x0) * (q.y1 - q.y0), 0)).toBeCloseTo(48, 5);
    expect(clearRects(r, () => false).rects).toEqual([]);
  });
});
