// networkCore phase 3: the checks and placement see the network's meshes, streets are thinned to the
// rows their heights need, terrain isn't held under the network's kerbs and strips, and parked cars
// sit with their tyres' whole length out of the ground.
import { describe, expect, it } from "vitest";
import { checkGround, SURFACE_GROUPS } from "../src/core/groundCheck";
import { IDENTITY, type Kn5GroupNode, type Kn5Node } from "../src/core/kn5";
import { MeshBuilder } from "../src/core/mesh";
import { buildGraph } from "../src/core/network";
import { planGraphStreets } from "../src/core/network/streets";
import { buildStreetMeshes, thinRows, THIN_TOL, type MeshStreet, type StreetMeshOptions } from "../src/core/network/streetMesh";
import { carSeat, TYRE_SINK } from "../src/core/parkedCars";
import { topSurface } from "../src/core/sceneGround";
import { isNetSurfaceNode } from "../src/core/terrain";

const group = (name: string, children: Kn5Node[]): Kn5GroupNode => ({ kind: "node", name, transform: IDENTITY, children });
/** A flat square at height h, `half` metres either side of (cx, cy). */
const square = (name: string, cx: number, cy: number, half: number, h: number) => {
  const mb = new MeshBuilder();
  const a = mb.vertex([cx - half, cy - half, h], 0, 0), b = mb.vertex([cx + half, cy - half, h], 1, 0);
  const c = mb.vertex([cx + half, cy + half, h], 1, 1), d = mb.vertex([cx - half, cy + half, h], 0, 1);
  mb.quad(a, b, c, d);
  return mb.toKn5(name, "m");
};
/** A thin box standing from h0 to h1 at (cx, cy). */
const post = (name: string, cx: number, cy: number, h0: number, h1: number) => {
  const mb = new MeshBuilder();
  const r = 0.05, ids: number[] = [];
  for (const h of [h0, h1]) for (const [dx, dy] of [[-r, -r], [r, -r], [r, r], [-r, r]]) ids.push(mb.vertex([cx + dx, cy + dy, h], 0, 0));
  for (let k = 0; k < 4; k++) { const k1 = (k + 1) % 4; mb.quad(ids[k], ids[k1], ids[4 + k1], ids[4 + k]); }
  return mb.toKn5(name, "m");
};

describe("the ground check and networkCore's junctions", () => {
  it("counts JUNCTIONS as ground: a post on a junction's raised surface stands", () => {
    expect(SURFACE_GROUPS.has("JUNCTIONS")).toBe(true);
    const root = group("root", [
      group("TERRAIN", [square("1GRASS_t000", 0, 0, 20, 0)]),
      group("JUNCTIONS", [square("1KERB_JS000", 0, 0, 2, 0.4)]),
      group("FURNITURE", [post("SIGN_000", 0, 0, 0.4, 2.4)]),
    ]);
    const r = checkGround(root);
    expect(r.checked.FURNITURE).toBe(1);
    expect(r.off).toEqual([]);
  });
});

describe("terrain under networkCore's meshes", () => {
  it("is held under its drivable surfaces, not its kerbs, strips or islands", () => {
    const m = (name: string) => square(name, 0, 0, 1, 0);
    for (const n of ["1ROAD_J000", "1STREET_J001", "1STREET_004", "1ROAD_GUTTER_J000", "1STREET_GUTTER_S000"]) expect(isNetSurfaceNode(m(n))).toBe(true);
    for (const n of ["1KERB_S000", "1GRASS_STRIP_J002", "1GRASS_MEDIAN_S000", "1KERB_SM001", "1GRASS_ISLAND_J000", "MARKINGS_S000"]) expect(isNetSurfaceNode(m(n))).toBe(false);
  });
});

describe("thinRows", () => {
  const s = Array.from({ length: 21 }, (_, k) => k * 3);
  const none = s.map(() => false);
  it("keeps the ends of a straight slope, split at the longest span", () => {
    expect(thinRows(s, s.map((x) => [x * 0.01]), none)).toEqual([0, 8, 16, 20]);
    expect(thinRows(s, s.map((x) => [x * 0.01]), none, THIN_TOL, 100)).toEqual([0, 20]);
  });
  it("keeps fixed rows and the rows a bend in height needs", () => {
    const fixed = none.slice(); fixed[5] = true;
    expect(thinRows(s, s.map(() => [0]), fixed, THIN_TOL, 100)).toEqual([0, 5, 20]);
    const vee = s.map((x) => [Math.abs(x - 30) * 0.02]);
    const keep = thinRows(s, vee, none, THIN_TOL, 100);
    expect(keep).toContain(10);
    // Every row left out is on the line between its kept neighbours.
    for (let q = 0; q < keep.length - 1; q++) {
      const a = keep[q], b = keep[q + 1];
      for (let m = a + 1; m < b; m++) {
        const f = (s[m] - s[a]) / (s[b] - s[a]);
        expect(Math.abs(vee[m][0] - (vee[a][0] + (vee[b][0] - vee[a][0]) * f))).toBeLessThanOrEqual(THIN_TOL);
      }
    }
  });
});

describe("street meshes, thinned", () => {
  const street: MeshStreet = { pts: [[0, 0], [60, 0]], width: 7, joins: [], cls: "residential" };
  const opts = (ground: (x: number, y: number) => number): StreetMeshOptions => ({
    ground, lift: 0.1, joinZ: () => null, kerbed: () => true, markings: false, material: () => "asphalt",
  });
  const tris = (nodes: { indices: ArrayLike<number> }[]) => nodes.reduce((a, m) => a + m.indices.length / 3, 0);
  it("lays a flat street with few rows (24 m quads), kerbs and all", () => {
    const flat = buildStreetMeshes([street], opts(() => 1));
    expect(tris(flat.road)).toBe(6);
    expect(flat.kerbed.has(0)).toBe(true);
    // Kerb, strip, gutter: 5 profile segments a side, 2 triangles each, 3 quads along.
    expect(tris(flat.dress)).toBe(2 * 5 * 2 * 3);
  });
  it("keeps the rows a bumpy ground needs, and the surface stays on it", () => {
    const bumpy = (x: number) => 1 + 0.05 * Math.sin(x / 10);
    const m = buildStreetMeshes([street], opts((x) => bumpy(x)));
    expect(tris(m.road)).toBeGreaterThan(6);
    expect(tris(m.road)).toBeLessThan(40);
    // Where the old rows were (every 3 m), the surface is within THIN_TOL of the draped height.
    const top = topSurface(m.road);
    for (let x = 0; x <= 60; x += 3) expect(Math.abs(top(x, 0)! - (bumpy(x) + 0.1))).toBeLessThanOrEqual(THIN_TOL + 1e-6);
  });
});

describe("parked cars' tyres", () => {
  it("count a tyre's ends against the ground, not just its middle", () => {
    const car = { at: [0, 0] as [number, number], dir: [1, 0] as [number, number] };
    // A ridge across the car at each axle: level under the tyres' middles, 15 cm up at their ends.
    const ridge = (x: number) => 0.5 * Math.max(0, Math.abs(Math.abs(x) - 1.4) - 0.03);
    const seat = carSeat(car as Parameters<typeof carSeat>[0], (x) => ridge(x));
    expect(seat.sink).toBeGreaterThan(TYRE_SINK);
    expect(carSeat(car as Parameters<typeof carSeat>[0], () => 2).sink).toBe(0);
    // A small rise at the ends is lifted clear (up to MAX_LIFT), so no tyre goes more than TYRE_SINK in.
    const low = carSeat(car as Parameters<typeof carSeat>[0], (x) => 0.15 * Math.max(0, Math.abs(Math.abs(x) - 1.4) - 0.03));
    expect(low.sink).toBeLessThanOrEqual(TYRE_SINK + 1e-9);
    expect(low.z).toBeGreaterThan(-0.02);
  });
});

describe("streets from a junction's inner edges", () => {
  it("are planned (marked internal), so a junction the network refuses leaves no hole in the road", () => {
    const line = (a: [number, number], b: [number, number], n = 10): [number, number][] =>
      Array.from({ length: n + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    // Two T-junctions 10 m apart on a through street: they merge, and the 10 m between is an inner edge.
    const g = buildGraph([
      { pts: line([-150, 0], [0, 0]), cls: "residential" },
      { pts: line([0, 0], [10, 0], 2), cls: "residential" },
      { pts: line([10, 0], [150, 0]), cls: "residential" },
      { pts: line([0, 0], [0, 100]), cls: "residential" },
      { pts: line([10, 0], [10, -100]), cls: "residential" },
    ]);
    const inner = g.edges.filter((e) => e.internal);
    expect(inner).toHaveLength(1);
    const { streets } = planGraphStreets(g, { route: null, rings: [], inArea: () => true, corridor: 30, vergeWidth: 1.5 });
    const link = streets.filter((s) => s.edge === inner[0].id);
    expect(link).toHaveLength(1);
    expect(link[0].internal).toBe(true);
    expect(streets.filter((s) => s.internal)).toHaveLength(1);
  });
});
