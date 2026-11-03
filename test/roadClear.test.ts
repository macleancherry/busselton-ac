import { describe, expect, it } from "vitest";
import type { Kn5Node } from "../src/core/kn5";
import { decodeOwnPng, encodePng } from "../src/core/png";
import {
  along, meshRole, obstaclePieces, pathState, PlanGrid, rasterise, runsOf, streetGapPieces, streetMapCore, streetState, trunksOf,
} from "../src/core/roadClear";

type Mesh = Extract<Kn5Node, { kind: "mesh" }>;
const mesh = (name: string, pts: number[][], tris: number[]): Mesh => ({
  kind: "mesh", name, material: "m",
  // Local (x east, y north, h) to AC (x, h, z south).
  positions: new Float32Array(pts.flatMap(([x, y, h]) => [x, h, -y])),
  normals: new Float32Array(pts.length * 3), uvs: new Float32Array(pts.length * 2), indices: new Uint16Array(tris),
});
/** A flat rectangle at height h. */
const flat = (name: string, x0: number, y0: number, x1: number, y1: number, h = 0) =>
  mesh(name, [[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]], [0, 1, 2, 0, 2, 3]);
/** A box's four walls from h0 to h1. */
const box = (name: string, x0: number, y0: number, x1: number, y1: number, h0 = 0, h1 = 3) => {
  const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const pts: number[][] = [], tris: number[] = [];
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = c[k], [bx, by] = c[(k + 1) % 4], o = pts.length;
    pts.push([ax, ay, h0], [bx, by, h0], [bx, by, h1], [ax, ay, h1]);
    tris.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  return mesh(name, pts, tris);
};
/** A crossed-sprite tree: two vertical quads through (x, y), `r` either side, up to 8 m. */
const tree = (name: string, x: number, y: number, r = 3) => {
  const pts = [[x - r, y, 0], [x + r, y, 0], [x + r, y, 8], [x - r, y, 8], [x, y - r, 0], [x, y + r, 0], [x, y + r, 8], [x, y - r, 8]];
  return mesh(name, pts, [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
};
const group = (name: string, children: Kn5Node[]): Kn5Node => ({ kind: "node", name, transform: [], children });
const world = (...groups: Kn5Node[]) => ({ file: "t/t.kn5", root: group("root", groups) as Kn5Node });

// A street 40 m long, 8 m wide, along x; grass all round.
const base = () => [
  group("SIDESTREETS", [flat("1STREET", 0, -4, 40, 4, 0.1)]),
  group("TERRAIN", [flat("1GRASS_t", -20, -30, 60, 30, 0)]),
];

describe("roadClear: what a mesh is", () => {
  it("tells the road, kerbs, paths, ground and obstacles apart", () => {
    expect(meshRole("1ROAD", "ROAD", "t/t.kn5")).toBe("road");
    expect(meshRole("1STREET_CARPARK", "CARPARKS", "t/t.kn5")).toBe("road");
    expect(meshRole("1STREET_PATH", "KERBS", "t/t.kn5")).toBe("ground");
    expect(meshRole("1KERB", "KERBS", "t/t.kn5")).toBe("kerb");
    expect(meshRole("1ROAD_PATH_SHARED_T", "PATHS", "t/t.kn5")).toBe("path");
    expect(meshRole("1WALL_BLD_brick", "BUILDINGS", "t/t.kn5")).toBe("building");
    expect(meshRole("ROOF_zinc_000", "BUILDINGS", "t/t.kn5")).toBe("building");
    expect(meshRole("1WALL_FENCE_basalt", "LOTS", "t/t.kn5")).toBe("lot");
    expect(meshRole("1WALL_TREE_000", "WALLS", "t/t.kn5")).toBe("tree");
    expect(meshRole("TREES_000_T3", "TREES", "t/t.kn5")).toBe("tree");
    expect(meshRole("SPECHOUSE_x_3", "", "t/lm_x.kn5")).toBe("landmark");
    expect(meshRole("shelter_frames", "", "t/layer_x.kn5")).toBe("landmark");
    // Course markings close streets on purpose; paint, lamps, parked cars and wires aren't obstacles.
    expect(meshRole("CM_BARRIER_RED", "", "t/layout_town.kn5")).toBeNull();
    expect(meshRole("1RIPPLE_RED", "", "t/layout_town.kn5")).toBeNull();
    expect(meshRole("FURNITURE_LAMP", "FURNITURE", "t/t.kn5")).toBeNull();
    expect(meshRole("PARKED_CARS", "PARKED_CARS", "t/t.kn5")).toBeNull();
    expect(meshRole("1WALL_L", "WALLS", "t/t.kn5")).toBeNull();
  });
});

describe("roadClear: things standing on the road", () => {
  it("finds a building in the street, not one beside it or just over its edge", () => {
    const p = rasterise([world(...base(), group("BUILDINGS", [
      box("1WALL_BLD_a", 10, -2, 16, 2), // in the street
      box("1WALL_BLD_b", 25, 5, 30, 10), // beside it
      box("1WALL_BLD_c", 33, 3.8, 38, 9), // 0.2 m over its edge
    ]))]);
    const ps = obstaclePieces(p);
    expect(ps).toHaveLength(1);
    expect(ps[0].kind).toBe("building");
    expect(ps[0].at[0]).toBeGreaterThan(9);
    expect(ps[0].at[0]).toBeLessThan(17);
    expect(ps[0].on).toBe("street");
    expect(ps[0].low).toBeLessThan(0.1);
  });

  it("ignores an awning high over the road", () => {
    const p = rasterise([world(...base(), group("BUILDINGS", [flat("AWNING_000", 10, -2, 16, 2, 5)]))]);
    expect(obstaclePieces(p)).toHaveLength(0);
  });

  it("finds a tree by its trunk: in the street, not beside it with its crown over the road", () => {
    const p = rasterise([world(...base(), group("TREES", [tree("TREES_000", 20, 0), tree("TREES_001", 30, 6)]))]);
    const ps = obstaclePieces(p);
    expect(ps.map((x) => x.kind)).toEqual(["tree"]);
    expect(ps[0].at[0]).toBeCloseTo(20, 0);
    expect(trunksOf(tree("t", 5, 7))).toEqual([[5, 7, 0], [5, 7, 0]]);
  });

  it("puts a sprite cut across two area tiles back together: no trunk at its end", () => {
    // A 16 m card beside the street (trunk at y 9, outside it), its end reaching into the street;
    // front and back faces with their own vertices, each face's two triangles in different tiles.
    const a = [-8, 4.5, 0], b = [8, 4.5, 0], bh = [8, 4.5, 14], ah = [-8, 4.5, 14];
    const at = ([x, y, h]: number[]) => [x + 20, y + 4.5, h];
    const t1 = mesh("TREES_000_T1", [a, b, bh, b, ah, bh].map(at), [0, 1, 2, 3, 4, 5]);
    const t2 = mesh("TREES_000_T2", [a, bh, ah, b, a, ah].map(at), [0, 1, 2, 3, 4, 5]);
    // Turned about the trunk so the card's end reaches into the street.
    const turn = (m: Mesh) => {
      const p = m.positions;
      for (let v = 0; v < p.length; v += 3) {
        const x = p[v] - 20, y = -p[v + 2] - 9;
        const c = Math.cos(1.2), s = Math.sin(1.2);
        p[v] = 20 + x * c - y * s;
        p[v + 2] = -(9 + x * s + y * c);
      }
      return m;
    };
    const p = rasterise([world(...base(), group("TREES", [turn(t1), turn(t2)]))]);
    expect(obstaclePieces(p).filter((x) => x.kind === "tree")).toHaveLength(0);
    // A triangle alone (a tile's part of a face) has its trunk at the card's end, in the street.
    expect(trunksOf(turn(mesh("TREES_000_T1", [a, bh, ah].map(at), [0, 1, 2]))).some(([, y]) => y < 3)).toBe(true);
  });
});

describe("roadClear: lines along the streets and paths", () => {
  it("says where a street is missing, buried or a median", () => {
    const p = rasterise([world(
      group("SIDESTREETS", [flat("1STREET", 0, -4, 18, 4, 0.1), flat("1STREET", 22, -4, 40, 4, 0.1), flat("1STREET", 0, 6, 40, 10, 0.1), flat("1STREET", 0, 16, 40, 20, 0.1)]),
      group("TERRAIN", [flat("1GRASS_t", -20, -30, 60, 30, 0)]),
      group("KERBS", [flat("1GRASS_STRIP", 5, -4, 8, 4, 0.3)]), // ground over the street
    )]);
    expect(streetState(p, [12, 0], 0.75)).toBe("ok");
    expect(streetState(p, [20, 0], 0.75)).toBe("missing");
    expect(streetState(p, [6.5, 0], 0.75)).toBe("buried");
    // Between the two carriageways at y 6..10 and 16..20: a median across, a hole along.
    expect(streetState(p, [20, 13], 0.75, [0, 1])).toBe("ok");
    expect(streetState(p, [20, 0], 0.75, [0, 1])).toBe("missing");
    expect(streetState(p, [20, 13], 0.75)).toBe("missing");
    // Past the built ground.
    expect(streetState(p, [59.9, 40], 0.75)).toBe("outside");
  });

  it("says where a path shows, is missing, buried or under a road", () => {
    const p = rasterise([world(...base(),
      group("PATHS", [flat("1ROAD_PATH_SHARED_T", -10, 10, 10, 12.5, 0.025), flat("1ROAD_PATH_SHARED_T", 20, 10, 30, 12.5, 0.025)]),
      group("KERBS", [flat("1GRASS_STRIP", 25, 9, 30, 13, 0.2)]))]);
    expect(pathState(p, [0, 11.25], 0.75)).toBe("ok");
    expect(pathState(p, [15, 11.25], 0.75)).toBe("missing");
    expect(pathState(p, [27, 11.25], 0.75)).toBe("buried");
    expect(pathState(p, [12, 0], 0.75)).toBe("road");
    expect(pathState(p, [100, 100], 0.75)).toBe("outside");
    // A shared path's line 2.5 m from its ribbon: missing, unless the ribbon may have been moved there.
    expect(pathState(p, [0, 8.25], 0.75)).toBe("missing");
    expect(pathState(p, [0, 8.25], 0.75, 2.5)).toBe("ok");
  });

  it("counts only a shared ribbon as a moved shared path", () => {
    const p = rasterise([world(...base(), group("PATHS", [flat("1ROAD_PATH_FOOT_T", -10, 10, 10, 11.6, 0.025)]))]);
    expect(pathState(p, [0, 8.25], 0.75, 2.5)).toBe("missing");
    expect(pathState(p, [0, 10.8], 0.75, 2.5)).toBe("ok");
  });

  it("runs of bad points, and holes told from street ends", () => {
    const pts = along([[0, 0], [10, 0]], 1);
    expect(pts).toHaveLength(11);
    const st = pts.map(([x]): "missing" | "ok" => (x >= 3 && x <= 6 ? "missing" : "ok"));
    expect(runsOf(pts, st, 1, ["missing"], 2)).toEqual([{ kind: "missing", length: 4, at: [4, 0] }]);
    const g = new PlanGrid(0, 0, 10, 3, 1);
    const planned = new Uint8Array(g.nx * g.ny), label = new Uint8Array(g.nx * g.ny);
    for (let i = 0; i < 10; i++) planned[10 + i] = 1;
    label[14] = label[15] = 1; // a hole in the middle
    label[19] = 1; // the end
    const gaps = streetGapPieces(g, label, planned);
    expect(gaps.map((x) => [x.cells, x.between])).toEqual([[2, true], [1, false]]);
  });

  it("reads the street map's middles, half widths and directions", () => {
    // A 9 px street along x on a 40 x 20 image, 0.5 m a pixel.
    const w = 40, h = 20, rgba = new Uint8Array(w * h * 4);
    for (let y = 6; y < 15; y++) for (let x = 0; x < w; x++) rgba.set([205, 208, 214, 255], (y * w + x) * 4);
    const png = decodeOwnPng(encodePng(rgba, w, h));
    const core = streetMapCore(png, "[PARAMETERS]\nSCALE_FACTOR=0.5\nX_OFFSET=0\nZ_OFFSET=0\n");
    const mid = core.find((q) => Math.abs(q.at[0] - 10.25) < 0.01 && Math.abs(q.at[1] + 5.25) < 0.01);
    expect(mid).toBeDefined();
    expect(mid!.half).toBeCloseTo(2.5, 1);
    expect(Math.abs(mid!.across[1])).toBeCloseTo(1, 5);
    expect(core.every((q) => q.at[1] < -3 && q.at[1] > -7.5)).toBe(true);
  });
});
