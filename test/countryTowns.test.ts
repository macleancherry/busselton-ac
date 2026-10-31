// Country towns on hilly ground (Margaret River, Augusta, Dunsborough): shops and buildings on slopes
// and at the terrain mesh's edge, and traffic lanes on traced streets with bays.
import { describe, expect, it } from "vitest";
import { slopeSteps } from "../src/core/slopeSteps";
import { buildShopfronts, findShopfronts } from "../src/core/shops";
import { buildBuildings, plainHouse, type Building } from "../src/core/buildings";
import { ROOF_COLOURS } from "../src/core/buildingStyles";
import { checkGround } from "../src/core/groundCheck";
import { groundOver, ringTouches, topSurface } from "../src/core/sceneGround";
import { MeshBuilder } from "../src/core/mesh";
import type { Kn5MeshNode, Kn5Node } from "../src/core/kn5";
import type { Vec2 } from "../src/core/geo";
import { lanesOverBays, withBayBands } from "../src/core/bayLanes";
import { buildKerbside, type Carriageway } from "../src/core/kerbside";
import { trafficGraph, type TrafficRoad } from "../src/core/traffic";

const group = (name: string, children: Kn5Node[]): Kn5Node => ({ kind: "node", name, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children });
/** A ground mesh over x0..x1, y0..y1 in 1 m squares, height h(x, y). */
function ground(name: string, x0: number, y0: number, x1: number, y1: number, h: (x: number, y: number) => number): Kn5MeshNode {
  const mb = new MeshBuilder();
  for (let x = x0; x < x1; x += 2) {
    for (let y = y0; y < y1; y += 2) {
      const xa = Math.min(x + 2, x1), ya = Math.min(y + 2, y1);
      const a = mb.vertex([x, y, h(x, y)], 0, 0), b = mb.vertex([xa, y, h(xa, y)], 1, 0), c = mb.vertex([xa, ya, h(xa, ya)], 1, 1), d = mb.vertex([x, ya, h(x, ya)], 0, 1);
      mb.quad(a, b, c, d);
    }
  }
  return mb.toKn5(name, "grass");
}
/** AC positions back to local ENU. */
const enu = (m: Kn5MeshNode): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i < m.positions.length; i += 3) out.push([m.positions[i], -m.positions[i + 2], m.positions[i + 1]]);
  return out;
};
const shopBox = (x0: number, y0: number, w: number, d: number): Building => ({
  ...plainHouse("flat", ROOF_COLOURS.findIndex((r) => r.name === "surfmist"), 4), ring: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + d], [x0, y0 + d]], type: "shop", height: 4, roof: "flat", source: "osm",
});
// A street along y = 0, its edge at y = 5; shops to the north, fronts facing south.
const gap = (_x: number, y: number) => Math.max(0, y - 5);

describe("slope steps", () => {
  it("one step on the level", () => {
    const s = slopeSteps(40, () => [10, 10.2]);
    expect(s).toEqual([{ t0: 0, t1: 40, lo: 10, hi: 10.2 }]);
  });

  it("steps down a slope, each step within the rise (or the shortest step), covering the front", () => {
    const s = slopeSteps(48, (t) => [100 + 0.13 * t], { rise: 0.6, minLen: 2.5 });
    expect(s.length).toBeGreaterThan(5);
    expect(s[0].t0).toBe(0);
    expect(s.at(-1)!.t1).toBe(48);
    for (let k = 1; k < s.length; k++) expect(s[k].t0).toBeCloseTo(s[k - 1].t1, 9);
    for (const st of s) {
      expect(st.t1 - st.t0).toBeGreaterThanOrEqual(2.5 - 1e-9);
      expect(st.hi - st.lo).toBeLessThanOrEqual(Math.max(0.6, 0.13 * (st.t1 - st.t0)) + 1e-9);
    }
  });

  it("never leaves a sliver at the end", () => {
    const s = slopeSteps(6, (t) => [t * 0.5], { rise: 0.6, minLen: 2.5 });
    for (const st of s) expect(st.t1 - st.t0).toBeGreaterThanOrEqual(2.5 - 1e-9);
  });
});

describe("shop fronts on a sloping street", () => {
  // Margaret River: a 48 m shop front along a street climbing 13%.
  const h = (x: number) => 100 + 0.13 * x;
  const terrain = ground("1GRASS_t000", -10, -10, 60, 30, (x) => h(x));
  const shop = shopBox(0, 8, 48, 15);
  const g = (x: number) => h(x);

  it("steps the verandah, windows and posts down the slope: nothing sunk, nothing floating", () => {
    const fronts = findShopfronts([shop], [], gap, g);
    expect(fronts).toHaveLength(1);
    const f = fronts[0];
    expect(f.posts).toBe(true);
    expect(f.steps!.length).toBeGreaterThan(5);
    // Each step's ground floor is the lowest ground along its wall; the verandah climbs with it.
    for (let k = 1; k < f.steps!.length; k++) expect(f.steps![k].ground).toBeGreaterThan(f.steps![k - 1].ground);
    const shops = buildShopfronts(fronts, g);
    const r = checkGround(group("track", [group("TERRAIN", [terrain]), group("BUILDINGS", buildBuildings([shop], g)), group("SHOPS", shops)]));
    expect(r.off).toEqual([]);
    expect(r.checked.SHOPS).toBeGreaterThan(10);
    // Every post reaches from its own ground up to the verandah over it, at least 2.3 m.
    const posts = shops.filter((m) => m.name.startsWith("SHOP_POST")).flatMap(enu);
    for (let i = 0; i < posts.length; i += 2) {
      const [x, , foot] = posts[i], top = posts[i + 1][2];
      expect(Math.abs(foot - (h(x) - 0.02))).toBeLessThan(0.01); // x is a corner, 5 cm off the post's middle
      expect(top - foot).toBeGreaterThan(2.3);
    }
  });

  it("used to lay the whole verandah from its lowest corner, under the footpath at the high end", () => {
    const fronts = findShopfronts([shop], [], gap, g).map(({ steps: _s, ...f }) => f);
    const r = checkGround(group("track", [group("TERRAIN", [terrain]), group("BUILDINGS", buildBuildings([shop], g)), group("SHOPS", buildShopfronts(fronts, g))]));
    expect(r.off.some((o) => o.group === "SHOPS" && o.kind === "sunk")).toBe(true);
  });

  it("keeps one step, as before, on the level", () => {
    const fronts = findShopfronts([shop], [], gap, () => 2);
    expect(fronts[0].steps).toBeUndefined();
    expect(fronts[0].ground).toBe(2);
  });

  it("raises a verandah on the level where the footpath under it is higher than the shop floor", () => {
    // The shop floor 1 m under the street (a cut): the verandah clears the footpath by 2.3 m.
    const cut = (_x: number, y: number) => (y < 8 ? 3 : 2);
    const [f] = findShopfronts([shop], [], gap, cut);
    expect(f.steps).toHaveLength(1);
    expect(f.steps![0].ground + f.steps![0].under).toBeGreaterThanOrEqual(3 + 2.3 - 1e-9);
  });
});

describe("a shop at the terrain mesh's edge", () => {
  // The mesh stops at x = 10; past it the analytic terrain is 3 m lower.
  const mesh = topSurface([ground("1GRASS_t000", 10, -10, 60, 30, () => 100)]);
  const scene = groundOver(mesh, () => 97);
  const shop = shopBox(0, 8, 20, 12);

  it("stands its front on the building's own ground, not the terrain past the edge", () => {
    const old = findShopfronts([shop], [], gap, scene);
    expect(old[0].ground).toBe(97);
    const [f] = findShopfronts([shop], [], gap, scene, () => false, (b) => scene.forRing(b.ring));
    expect(f.ground).toBe(100);
    // Posts past the edge stand at the mesh's lowest round the footprint too.
    expect(f.feet!.every((z) => Math.abs(z - (100 - 0.02)) < 1e-9)).toBe(true);
    const terrain = ground("1GRASS_t000", 10, -10, 60, 30, () => 100);
    const r = checkGround(group("track", [
      group("TERRAIN", [terrain]),
      group("BUILDINGS", buildBuildings([shop], scene, undefined, (b) => scene.forRing(b.ring))),
      group("SHOPS", buildShopfronts([f], scene)),
    ]));
    expect(r.off).toEqual([]);
  });

  it("counts a footprint whose corners are all past the mesh but an edge crosses it as on the mesh", () => {
    // Corners at x 5 and 15 either side of a mesh strip x 9..11.
    const strip = topSurface([ground("1GRASS_t000", 9, -50, 11, 50, () => 1)]);
    expect(ringTouches(strip, [[5, 0], [15, 0], [15, 6], [5, 6]])).toBe(true);
    expect(ringTouches(strip, [[0, 0], [6, 0], [6, 6], [0, 6]])).toBe(false);
  });
});

describe("a building's awning on a slope", () => {
  const rect = (w: number, d: number): Vec2[] => [[0, 0], [w, 0], [w, d], [0, d]];

  it("steps along the front and keeps 2.4 m over the footpath", () => {
    const ring = rect(14, 10);
    const b: Building = { ...plainHouse("flat", 0, 3), ring, front: [ring[0], ring[1]], setback: 4, awning: true, type: "shop", roof: "flat", source: "osm" };
    const g = (x: number) => 0.3 * x;
    const aw = buildBuildings([b], g).filter((m) => m.name.startsWith("AWNING_")).flatMap(enu);
    expect(aw.length).toBeGreaterThan(0);
    for (const [x, , z] of aw) expect(z).toBeGreaterThan(g(x) + 2.3);
    // Not all at one height: it steps.
    expect(new Set(aw.map(([, , z]) => z.toFixed(2))).size).toBeGreaterThan(2);
    // On the level, as before: 3 m over the floor.
    const flat = buildBuildings([b], () => 0).filter((m) => m.name.startsWith("AWNING_")).flatMap(enu);
    expect(Math.min(...flat.map((p) => p[2]))).toBeCloseTo(3, 4);
  });
});

describe("traffic lanes on a traced street wider than mapped", () => {
  // Mapped 6 m, traced 9 m from the photo; its bays painted for 9 m along the left (north) kerb.
  const pts: Vec2[] = [];
  for (let x = 0; x <= 200; x += 4) pts.push([x, 0]);
  const cw: Carriageway = { pts, widths: pts.map(() => 9), z: () => 10 };
  const k = buildKerbside([cw], [{ pts: [[-10, 0.3], [210, 0.3]], left: { parking: "parallel" }, right: {} }]);
  const paint: [Vec2, Vec2, Vec2][] = [];
  for (const m of k.nodes.filter((n) => n.name.startsWith("KERBSIDE_BAY_"))) {
    const p = m.positions, v = (i: number): Vec2 => [p[i * 3], -p[i * 3 + 2]];
    for (let t = 0; t < m.indices.length; t += 3) paint.push([v(m.indices[t]), v(m.indices[t + 1]), v(m.indices[t + 2])]);
  }
  const lanes = (g: ReturnType<typeof trafficGraph>) => g.lanes.map((l) => l.points.map((q) => [q[0], -q[2]] as Vec2));
  const road: TrafficRoad = { pts, h: pts.map(() => 10), width: 6, speed: 50 };

  it("clears the bays with the street's own widths; held inside the mapped 6 m it couldn't", () => {
    expect(k.bays).toBeGreaterThan(20);
    expect(lanesOverBays(lanes(trafficGraph(withBayBands([road], k.boxes), [])), paint).length).toBeGreaterThan(0);
    const traced = { ...road, widths: pts.map(() => 9) };
    const g = trafficGraph(withBayBands([traced], k.boxes), []);
    expect(lanesOverBays(lanes(g), paint)).toEqual([]);
    // Still on the asphalt: within 4.5 m of the centreline, 2.8 m apart.
    for (const l of lanes(g)) for (const p of l) expect(Math.abs(p[1])).toBeLessThanOrEqual(4.5 - 1.4 + 1e-6);
  });

  it("never gives less room than the mapped width", () => {
    const narrow = { ...road, width: 9, widths: pts.map(() => 6) };
    const g = trafficGraph(withBayBands([narrow], k.boxes), []);
    expect(lanesOverBays(lanes(g), paint)).toEqual([]);
  });
});
