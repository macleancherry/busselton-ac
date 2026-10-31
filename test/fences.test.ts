// Fences, walls, hedges and wire fences (docs/specs/fences.md, "Tests to write").
import { describe, expect, it } from "vitest";
import { barrierStyle, box, buildBarriers, buildWireFences, isWireFence, ribbon, WIRE_FENCE, type Barrier } from "../src/core/fences";
import { MeshBuilder } from "../src/core/mesh";
import { planRoad, SegmentIndex } from "../src/core/road";
import { withDefaults } from "../src/core/options";
import { SINK } from "../src/core/sceneGround";
import type { Kn5MeshNode } from "../src/core/kn5";
import type { Vec2 } from "../src/core/geo";

// A 10 m street along y = 0, x -200..200.
const path: Vec2[] = Array.from({ length: 21 }, (_, i) => [i * 20 - 200, 0]);
const opts = withDefaults({ widthOverride: 10 });
const index = new SegmentIndex(planRoad(path, opts));
const slope = (x: number, y: number) => 2 + x * 0.04 + y * 0.03;
const flat = () => 0;
const all = () => true;
/** Vertices back in ENU. */
const enu = (n: Kn5MeshNode) => Array.from({ length: n.positions.length / 3 }, (_, i) => [n.positions[i * 3], -n.positions[i * 3 + 2], n.positions[i * 3 + 1]]);
const enuNormals = (n: Kn5MeshNode) => Array.from({ length: n.normals.length / 3 }, (_, i) => [n.normals[i * 3], -n.normals[i * 3 + 2], n.normals[i * 3 + 1]]);
const fence = (pts: Vec2[], extra: Partial<Barrier> = {}): Barrier => ({ pts, kind: "fence", ...extra });

describe("barrierStyle", () => {
  it("picks look, height and thickness from the tags", () => {
    expect(barrierStyle(fence([]))).toEqual({ look: "colorbond", height: 1.8, thick: 0.05 });
    expect(barrierStyle(fence([], { fenceType: "wood" })).look).toBe("paling");
    expect(barrierStyle(fence([], { material: "timber" })).look).toBe("paling");
    expect(barrierStyle(fence([], { fenceType: "picket" })).look).toBe("paling");
    expect(barrierStyle({ pts: [], kind: "wall" })).toEqual({ look: "brickwall", height: 1.2, thick: 0.23 });
    expect(barrierStyle({ pts: [], kind: "retaining_wall" })).toEqual({ look: "brickwall", height: 0.8, thick: 0.23 });
    expect(barrierStyle({ pts: [], kind: "hedge" })).toEqual({ look: "hedge", height: 1.5, thick: 0.8 });
    expect(barrierStyle({ pts: [], kind: "hedge", height: 2.2 }).height).toBe(2.2);
    expect(barrierStyle({ pts: [], kind: "hedge", height: 0.3 }).height).toBe(1.5);
    expect(barrierStyle({ pts: [], kind: "hedge", height: 4 }).height).toBe(1.5);
  });

  it("matches tags case-insensitively", () => {
    expect(barrierStyle(fence([], { material: "Timber" })).look).toBe("paling");
    expect(isWireFence(fence([], { fenceType: "Barbed_Wire" }))).toBe(true);
  });
});

describe("isWireFence", () => {
  it("tells wire fences from solid ones", () => {
    for (const fenceType of ["barbed_wire", "electric", "post_and_rail"]) expect(isWireFence(fence([], { fenceType }))).toBe(true);
    expect(isWireFence(fence([]))).toBe(false);
    expect(isWireFence({ pts: [], kind: "wall", fenceType: "wire" })).toBe(false);
  });
});

describe("buildBarriers", () => {
  it("builds a back fence that follows sloping ground", () => {
    const nodes = buildBarriers([fence([[-100, 30], [-60, 30]])], index, opts, slope, all);
    expect(nodes.map((n) => [n.name, n.material])).toEqual([["1WALL_FENCE_COLORBOND_000", "barrier_colorbond"]]);
    const v = enu(nodes[0]);
    for (const end of [-100, -60]) {
      const zs = v.filter((p) => Math.abs(p[0] - end) < 0.05).map((p) => p[2]);
      const g = slope(end, 30);
      expect(Math.max(...zs)).toBeCloseTo(g + 1.8, 2);
      expect(Math.min(...zs)).toBeCloseTo(g - SINK, 2);
    }
  });

  it("never builds on the road, its verge or across a side street", () => {
    const clear = (x: number) => !(x > 20 && x < 26);
    const nodes = buildBarriers([
      { pts: [[-150, 5], [-100, 5]], kind: "wall" }, // on the road edge
      fence([[0, 10], [50, 10]]), // crosses the side street at x 20..26
    ], index, opts, flat, clear);
    const v = nodes.flatMap(enu);
    expect(v.length).toBeGreaterThan(0);
    const keep = 10 / 2 + opts.vergeWidth + 2.5;
    for (const [x, y] of v) {
      expect(Math.abs(y)).toBeGreaterThan(keep - 0.2);
      expect(x > 20.01 && x < 25.99).toBe(false);
    }
  });

  it("builds nothing beyond the corridor, with or without cover", () => {
    const far = [fence([[0, opts.corridor - 1], [30, opts.corridor - 1]])];
    expect(buildBarriers(far, index, opts, flat, all)).toEqual([]);
    expect(buildBarriers(far, index, opts, flat, all, (_x, y) => Math.abs(y))).toEqual([]);
    expect(buildBarriers(far, index, opts, flat, all, () => 0)).toHaveLength(1);
  });

  it("tops thick barriers only", () => {
    const hedge = buildBarriers([{ pts: [[0, 20], [1.5, 20]], kind: "hedge" }], index, opts, flat, all)[0];
    expect([hedge.positions.length / 3, hedge.indices.length / 3]).toEqual([12, 6]);
    const panel = buildBarriers([fence([[0, 20], [1.5, 20]])], index, opts, flat, all)[0];
    expect([panel.positions.length / 3, panel.indices.length / 3]).toEqual([8, 4]);
  });

  it("winds faces outward", () => {
    // p -> q runs east, so right is south (-y).
    const n = buildBarriers([{ pts: [[0, 20], [1.5, 20]], kind: "wall" }], index, opts, flat, all)[0];
    const ns = enuNormals(n);
    for (let i = 0; i < 4; i++) expect(ns[i]).toEqual([0, -1, 0].map((c) => expect.closeTo(c, 5)));
    for (let i = 4; i < 8; i++) expect(ns[i]).toEqual([0, 1, 0].map((c) => expect.closeTo(c, 5)));
    for (let i = 8; i < 12; i++) expect(ns[i]).toEqual([0, 0, 1].map((c) => expect.closeTo(c, 5)));
  });

  it("restarts u at each OSM vertex and puts v 1.1 at the bottom, 1 - h/2 at the top", () => {
    const n = buildBarriers([fence([[0, 20], [5, 20], [5, 27]])], index, opts, flat, all)[0];
    const v = enu(n);
    const uv = Array.from({ length: v.length }, (_, i) => [n.uvs[i * 2], n.uvs[i * 2 + 1]]);
    // First segment (5 m): u from 0 to 2.5. Second (7 m): u from 0 to 3.5 again.
    // First-segment faces sit 0.025 m either side of y = 20; second-segment ones either side of x = 5.
    const first = (i: number) => Math.abs(Math.abs(v[i][1] - 20) - 0.025) < 1e-3;
    const firstU = uv.filter((_, i) => first(i)).map((t) => t[0]);
    expect(Math.min(...firstU)).toBeCloseTo(0, 5);
    expect(Math.max(...firstU)).toBeCloseTo(2.5, 5);
    const secondU = uv.filter((_, i) => !first(i)).map((t) => t[0]);
    expect(Math.min(...secondU)).toBeCloseTo(0, 5);
    expect(Math.max(...secondU)).toBeCloseTo(3.5, 5);
    uv.forEach(([, t], i) => expect(t).toBeCloseTo(v[i][2] < 0 ? 1.1 : 1 - 1.8 / 2, 5));
  });

  it("leaves OSM wire fences to the farm fences when farmland is on", () => {
    const wire = [fence([[40, 20], [120, 20]], { fenceType: "barbed_wire" })];
    expect(buildBarriers(wire, index, { ...opts, farmland: true }, flat, all)).toHaveLength(0);
    expect(buildBarriers(wire, index, opts, flat, all)).toHaveLength(1);
  });

  it("splits long runs into meshes under the vertex limit", () => {
    // 3 parallel 5.2 km zig-zag runs of 1.9 m panels: 8 vertices each, well over 60000 in all.
    const runs: Barrier[] = [12, 16, 20].map((y) => fence(Array.from({ length: 2601 }, (_, i) => [-180 + (i % 2) * 1.9, y + i * 0.0001] as Vec2)));
    const nodes = buildBarriers(runs, index, opts, flat, all);
    expect(nodes.map((n) => n.name)).toEqual(["1WALL_FENCE_COLORBOND_000", "1WALL_FENCE_COLORBOND_001"]);
    for (const n of nodes) expect(n.positions.length / 3).toBeLessThanOrEqual(60000);
    expect(nodes[0].positions.length / 3).toBe(60000);
  });
});

describe("buildWireFences", () => {
  // farm.test.ts's country road: 8 m along y = 0, x 0..300.
  const fopts = withDefaults({ widthOverride: 8, corridor: 70, farmland: true });
  const findex = new SegmentIndex(planRoad(Array.from({ length: 16 }, (_, i) => [i * 20, 0] as Vec2), fopts));

  it("puts a post every 4 m and three wires along a boundary", () => {
    const g = (x: number) => 2 + x * 0.01;
    const nodes = buildWireFences([[[20, 15], [200, 15]]], findex, fopts, g, all);
    expect(nodes.map((n) => [n.name, n.material])).toEqual([["1WALL_FENCE_WIREPOST_000", "timber"], ["1WALL_FENCE_WIRE_000", "wire"]]);
    expect(nodes[0].indices.length / 3).toBe(46 * 8);
    const top = Math.max(...enu(nodes[0]).filter((p) => Math.abs(p[0] - 200) < 0.1).map((p) => p[2]));
    expect(top).toBeCloseTo(g(200) + WIRE_FENCE.postHeight, 4);
    const heights = new Set(enu(nodes[1]).filter((p) => Math.abs(p[0] - 20) < 0.01).map((p) => Math.round((p[2] - g(20)) * 1000)));
    expect(heights.size).toBe(6);
  });

  it("keeps off the road, within reach, and builds a shared boundary once", () => {
    const nodes = buildWireFences([[[0, 4.5], [300, 4.5]], [[20, 60], [200, 60]], [[40, 20], [120, 20]], [[120, 20], [40, 20]]], findex, fopts, flat, all);
    for (const [, y] of nodes.flatMap(enu)) {
      expect(y).toBeGreaterThan(4 + fopts.vergeWidth + 2.5 - 0.2);
      expect(y).toBeLessThan(41);
    }
    expect(nodes[0].indices.length / 3).toBe(21 * 8);
  });

  it("keeps the spans nearest the road when over budget", () => {
    const nodes = buildWireFences([[[20, 35], [200, 35]], [[20, 15], [200, 15]]], findex, fopts, flat, all, (_x, y) => Math.abs(y), 40, 400);
    const ys = nodes.flatMap(enu).map((p) => p[1]);
    expect(Math.max(...ys)).toBeLessThan(16);
    // 400 / 20 = 20 spans: 21 posts.
    expect(nodes[0].indices.length / 3).toBe(21 * 8);
  });
});

describe("primitives", () => {
  it("box: four outward sides from ground + z0 to ground + z1", () => {
    const mb = new MeshBuilder();
    box(mb, [3, 4], 0.2, -0.1, 1.5, (x, y) => x + y);
    const n = mb.toKn5("b", "m");
    expect([n.positions.length / 3, n.indices.length / 3]).toEqual([16, 8]);
    const v = enu(n);
    expect(Math.min(...v.map((p) => p[2]))).toBeCloseTo(6.9, 5);
    expect(Math.max(...v.map((p) => p[2]))).toBeCloseTo(8.5, 5);
    enuNormals(n).forEach((nm, i) => {
      const out = [v[i][0] - 3, v[i][1] - 4];
      expect(nm[0] * out[0] + nm[1] * out[1]).toBeGreaterThan(0);
      expect(nm[2]).toBeCloseTo(0, 6);
    });
  });

  it("ribbon: two faces with opposite normals", () => {
    const mb = new MeshBuilder();
    ribbon(mb, [0, 0], [4, 0], 1, 1.2, 0.05);
    const n = mb.toKn5("r", "m");
    expect([n.positions.length / 3, n.indices.length / 3]).toEqual([8, 4]);
    const ns = enuNormals(n);
    for (let c = 0; c < 3; c++) expect(ns[0][c] + ns[4][c]).toBeCloseTo(0, 6);
    expect(Math.abs(ns[0][1])).toBeCloseTo(1, 2);
  });
});
