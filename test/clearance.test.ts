import { describe, expect, it } from "vitest";
import { clearOfRoute, keepOffRoute, KEEP_OFF, onRoute } from "../src/core/clearance";
import type { Vec2 } from "../src/core/geo";
import type { Kn5MeshNode } from "../src/core/kn5";
import { withDefaults } from "../src/core/options";
import { planRoad, SegmentIndex } from "../src/core/road";
import type { Roundabout } from "../src/core/roundabout";

const opts = withDefaults({ widthOverride: 8, banking: false });
const straight: Vec2[] = Array.from({ length: 11 }, (_, i) => [i * 20, 0]);

function road() {
  const plan = planRoad(straight, opts);
  return { plan, index: new SegmentIndex(plan) };
}

function mesh(name: string, pos: number[], idx: number[]): Kn5MeshNode {
  const n = pos.length / 3;
  return {
    kind: "mesh", name, material: "m",
    positions: Float32Array.from(pos), normals: new Float32Array(n * 3), uvs: new Float32Array(n * 2),
    indices: Uint16Array.from(idx),
  };
}

/** 1 m quads (two triangles) centred at local points, in AC space (z = -y). */
function quads(name: string, centres: Vec2[]): Kn5MeshNode {
  const pos: number[] = [], idx: number[] = [];
  centres.forEach(([x, y], q) => {
    const z = -y;
    pos.push(x - 0.5, 0, z - 0.5, x + 0.5, 0, z - 0.5, x + 0.5, 0, z + 0.5, x - 0.5, 0, z + 0.5);
    const b = q * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return mesh(name, pos, idx);
}

/** Small triangles whose centroids are exactly the given local points. */
function tris(name: string, centres: Vec2[]): Kn5MeshNode {
  const pos: number[] = [], idx: number[] = [];
  centres.forEach(([x, y], k) => {
    const z = -y;
    pos.push(x - 0.1, 0, z - 0.1, x + 0.2, 0, z, x - 0.1, 0, z + 0.1);
    idx.push(k * 3, k * 3 + 1, k * 3 + 2);
  });
  return mesh(name, pos, idx);
}

describe("clearOfRoute", () => {
  it("drops only the quad on the asphalt", () => {
    const { plan, index } = road();
    const r = clearOfRoute(quads("1KERB_000", [[100, 0], [100, 4.6], [100, 7]]), onRoute(plan, index));
    expect(r.dropped).toBe(2);
    expect(r.node!.indices.length).toBe(12);
  });

  it("keeps a 15 cm band inside the edge by default", () => {
    const { plan, index } = road();
    const on = onRoute(plan, index);
    const r = clearOfRoute(tris("1KERB_000", [[100, 3.9], [100, 3.8]]), on);
    expect(r.dropped).toBe(1);
    expect(Array.from(r.node!.indices)).toEqual([0, 1, 2]);
    const r0 = clearOfRoute(tris("1KERB_000", [[100, 3.9]]), onRoute(plan, index, 0));
    expect(r0.dropped).toBe(1);
    expect(r0.node).toBeNull();
  });

  it("returns the same node when nothing is dropped, null when everything is", () => {
    const { plan, index } = road();
    const on = onRoute(plan, index);
    const off = quads("1KERB_000", [[100, 10]]);
    const r = clearOfRoute(off, on);
    expect(r.node).toBe(off);
    expect(r.dropped).toBe(0);
    const all = clearOfRoute(quads("1KERB_000", [[100, 0], [50, 1]]), on);
    expect(all.node).toBeNull();
    expect(all.dropped).toBe(4);
    const empty = mesh("1KERB_000", [], []);
    expect(clearOfRoute(empty, on).node).toBe(empty);
  });

  it("keeps the survivors' order and winding and shares the vertex data", () => {
    const { plan, index } = road();
    const m = quads("1KERB_000", [[100, 8], [100, 0], [120, 9]]);
    const r = clearOfRoute(m, onRoute(plan, index));
    expect(Array.from(r.node!.indices)).toEqual([0, 1, 2, 0, 2, 3, 8, 9, 10, 8, 10, 11]);
    expect(r.node!.positions).toBe(m.positions);
    expect(r.node!.normals).toBe(m.normals);
    expect(r.node!.name).toBe("1KERB_000");
  });
});

describe("keepOffRoute", () => {
  it("clears only KEEP_OFF meshes and keeps the order", () => {
    const { plan, index } = road();
    const nodes = [
      quads("1KERB_RET", [[50, 1]]),
      quads("1GRASS_STRIP_000", [[60, -6]]),
      quads("1ROAD_000", [[70, 0]]),
      quads("1WALL_RAIL_L_000", [[80, 0.5]]),
    ];
    const r = keepOffRoute(nodes, onRoute(plan, index));
    expect(r.dropped).toBe(4);
    expect(r.nodes.map((n) => n.name)).toEqual(["1GRASS_STRIP_000", "1ROAD_000"]);
    expect(r.nodes[0]).toBe(nodes[1]);
    expect(r.nodes[1]).toBe(nodes[2]);
  });
});

describe("KEEP_OFF", () => {
  it("matches the listed prefixes only", () => {
    for (const p of ["1KERB", "1GRASS_STRIP", "1ROAD_GUTTER", "1STREET_GUTTER", "1STREET_PATH", "1STREET_DRIVE", "1WALL_RAIL", "1WALL_FENCE", "1WALL_ARMCO"]) {
      expect(KEEP_OFF.test(p + "_J004"), p).toBe(true);
    }
    expect(KEEP_OFF.test("ARMCO_POST")).toBe(true);
    for (const n of ["1ROAD_000", "1GRASS_VERGE_0", "1STREET_0", "X1KERB", "1kerb_000"]) expect(KEEP_OFF.test(n), n).toBe(false);
  });
});

describe("onRoute", () => {
  it("covers a roundabout's carriageway with the margin on both edges", () => {
    const { plan, index } = road();
    const rb: Roundabout = { c: [100, 60], r: 12, w: 8, lanes: 1, hc: 0, sIn: 0, sOut: 0, crossings: [] };
    plan.roundabouts = [rb];
    const on = onRoute(plan, index);
    const at = (d: number) => on(100 + d, 60);
    expect(at(12)).toBe(true);
    expect(at(15.9)).toBe(false);
    expect(at(15.8)).toBe(true);
    expect(at(8.05)).toBe(false);
    expect(at(9)).toBe(true);
    expect(at(0)).toBe(false);
  });

  it("counts the closing segment of a loop", () => {
    const loop: Vec2[] = [];
    for (let x = 100; x <= 200; x += 20) loop.push([x, 0]);
    for (let y = 20; y <= 200; y += 20) loop.push([200, y]);
    for (let x = 180; x >= 0; x -= 20) loop.push([x, 200]);
    for (let y = 180; y >= 0; y -= 20) loop.push([0, y]);
    for (let x = 20; x <= 100; x += 20) loop.push([x, 0]);
    const plan = planRoad(loop, opts);
    expect(plan.closed).toBe(true);
    const index = new SegmentIndex(plan);
    const first = plan.samples[0].pos, last = plan.samples[plan.samples.length - 1].pos;
    const mid: Vec2 = [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2];
    expect(onRoute(plan, index)(mid[0], mid[1] + 0.5)).toBe(true);
  });
});
