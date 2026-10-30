import { describe, expect, it } from "vitest";
import { planRoad, SegmentIndex } from "../src/core/road";
import { withDefaults } from "../src/core/options";
import { buildFarmRoadsides, farmTextures, FENCE_BACK, findDriveways, gridProfile, isFarmDrive, placeCattleGrids, type FarmLine } from "../src/core/farmRoadsides";
import { buildTrack, type DataSources } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import { readKn5, type Kn5MeshNode, type Kn5Node } from "../src/core/kn5";
import type { LngLat, Vec2 } from "../src/core/geo";

// A 7 m country road running east along y = 0 (left of travel is north, +y).
const path: Vec2[] = Array.from({ length: 41 }, (_, i) => [i * 20, 0]);
const opts = withDefaults({ widthOverride: 7, banking: false });
const plan = planRoad(path, opts);
const index = new SegmentIndex(plan);
const fenceE = opts.vergeWidth + FENCE_BACK;
/** ENU vertices of a kn5 mesh (kn5 is X east, Y up, Z south). */
const verts = (n: { positions: Float32Array }) => Array.from({ length: n.positions.length / 3 }, (_, i) => [n.positions[i * 3], -n.positions[i * 3 + 2], n.positions[i * 3 + 1]]);

const lines: FarmLine[] = [
  { cls: "service", service: "driveway", pts: [[100, 0], [100, 40]] }, // a driveway off the centreline, north
  { cls: "track", pts: [[200, -40], [200, 40]] }, // a track crossing the road: a mouth each side
  { cls: "service", pts: [[300, 5], [400, 8]] }, // runs along the road: not a driveway
  { cls: "service", service: "parking_aisle", pts: [[450, 0], [450, 30]] }, // a car park aisle
  { cls: "track", pts: [[500, 6], [500, 30]] }, // stops short of the road, still joins it
  { cls: "track", pts: [[600, 0], [600, 7]] }, // too short for a fence line
];

describe("farm driveways", () => {
  it("knows a farm driveway from other service roads", () => {
    expect(isFarmDrive({ cls: "track" })).toBe(true);
    expect(isFarmDrive({ cls: "service" })).toBe(true);
    expect(isFarmDrive({ cls: "service", service: "driveway" })).toBe(true);
    expect(isFarmDrive({ cls: "service", service: "parking_aisle" })).toBe(false);
    expect(isFarmDrive({ cls: "service", service: "drive-through" })).toBe(false);
    expect(isFarmDrive({ cls: "minor" })).toBe(false);
  });

  const drives = findDriveways(lines, plan, index, opts);

  it("finds where tracks and driveways leave the road, and their fence line", () => {
    const xs = drives.map((d) => Math.round(d.at[0])).sort((a, b) => a - b);
    expect(xs).toEqual([100, 200, 200, 500, 600]);
    const d100 = drives.find((d) => Math.round(d.at[0]) === 100)!;
    expect(d100.side).toBe(1);
    expect(d100.at[1]).toBeCloseTo(3.5, 1);
    expect(d100.dir[1]).toBeGreaterThan(0.99);
    expect(d100.gate![1]).toBeCloseTo(3.5 + fenceE, 0);
    // The crossing track: one each side, heading away from the road.
    const d200 = drives.filter((d) => Math.round(d.at[0]) === 200);
    expect(d200.map((d) => d.side).sort()).toEqual([-1, 1]);
    for (const d of d200) expect(Math.sign(d.dir[1])).toBe(d.side);
    expect(drives.find((d) => Math.round(d.at[0]) === 500)!.gate![1]).toBeCloseTo(3.5 + fenceE, 0);
    // Too short to reach a fence line: a mouth, no gate.
    expect(drives.find((d) => Math.round(d.at[0]) === 600)!.gate).toBeNull();
  });

  it("leaves out driveways where told to (a town street)", () => {
    expect(findDriveways(lines, plan, index, opts, (_seg, side) => side === 1).every((d) => d.side === -1)).toBe(true);
  });
});

describe("cattle grids", () => {
  const drives = findDriveways(lines, plan, index, opts);

  it("puts a grid across the road where OSM maps one on it, and at a driveway's gate", () => {
    const { grids, gated } = placeCattleGrids([[150, 0.5], [151, -0.5], [100, 3.5 + fenceE - 1], [150, 60]], plan, index, drives);
    expect(grids).toHaveLength(2);
    const road = grids.find((g) => g.route)!;
    expect(road.at[0]).toBeCloseTo(150, 0);
    expect(road.at[1]).toBeCloseTo(0, 1);
    expect(Math.abs(road.along[0])).toBeGreaterThan(0.99);
    expect(road.half).toBeCloseTo(3.5, 1);
    const gate = grids.find((g) => !g.route)!;
    expect(gated.has(gate.drive!)).toBe(true);
    expect(Math.round(drives[gate.drive!].at[0])).toBe(100);
  });

  it("has steel bars over a pit, flush with the road at both ends", () => {
    const p = gridProfile();
    expect(p[0][1]).toBeLessThan(0.003);
    expect(p[p.length - 1][1]).toBeLessThan(0.003);
    expect(p[p.length - 1][0]).toBeCloseTo(2.4, 5);
    for (let k = 1; k < p.length; k++) expect(p[k][0]).toBeGreaterThan(p[k - 1][0]);
    expect(Math.max(...p.map((q) => q[1]))).toBeLessThanOrEqual(0.015);
    expect(p.filter((q) => q[1] > 0.01).length).toBeGreaterThan(20); // 15 bars, two top corners each
  });
});

describe("buildFarmRoadsides", () => {
  // The scene ground (sceneGround.ts): the crowned road (2%) out to its edge, the ground beyond.
  const ground = (_x: number, y: number) => (Math.abs(y) <= 3.51 ? -0.02 * Math.abs(y) : -0.15);
  const res = buildFarmRoadsides({ lines, cattleGrids: [[150, 0.5], [100, 3.5 + fenceE]], plan, index, opts, ground });
  const byName = (re: RegExp) => res.nodes.filter((n) => re.test(n.name));

  it("builds aprons, gates, mailboxes and grids with the right names and materials", () => {
    expect(byName(/^1GRASS_FARMDRIVE_/)).toHaveLength(1);
    expect(byName(/^1GRASS_FARMDRIVE_/)[0].material).toBe("farm_gravel");
    expect(byName(/^1KERB_CATTLEGRID_/)).toHaveLength(2);
    expect(byName(/^FURNITURE_FARM_TIMBER_/).length).toBeGreaterThan(0);
    expect(byName(/^FURNITURE_FARM_WIRE_/).length).toBeGreaterThan(0);
    expect(res.mailboxes).toBe(res.drives.length);
    const mats = new Set(res.nodes.map((n) => n.material));
    const own = new Set(farmTextures().map((t) => t.name));
    for (const m of mats) expect(own.has(m) || ["steel", "timber", "wire", "letterbox", "canopy"].includes(m)).toBe(true);
  });

  it("keeps the gravel off the asphalt, meeting it at the edge", () => {
    const v = verts(byName(/^1GRASS_FARMDRIVE_/)[0]);
    for (const [, y] of v) expect(Math.abs(y)).toBeGreaterThan(3.5 - 0.06);
    // At the road edge it sits on the road surface (2% crown: 7 cm below the centre), beyond on the ground.
    const edge = v.filter(([, y]) => Math.abs(Math.abs(y) - 3.5) < 0.05);
    expect(edge.length).toBeGreaterThan(0);
    for (const [, , z] of edge) expect(z).toBeCloseTo(-0.07 + 0.005, 2);
    const far = v.filter(([, y]) => Math.abs(y) > 8);
    for (const [, , z] of far) expect(z).toBeCloseTo(-0.15 + 0.04, 2);
    // Every face looks up.
    const n = byName(/^1GRASS_FARMDRIVE_/)[0].normals;
    for (let i = 1; i < n.length; i += 3) expect(n[i]).toBeGreaterThan(0.9);
  });

  it("lays the road grid across the asphalt, a centimetre or so proud", () => {
    const grid = byName(/^1KERB_CATTLEGRID_/).find((g) => verts(g).some(([, y]) => Math.abs(y) < 1))!;
    const v = verts(grid);
    for (const [x, y, z] of v) {
      expect(Math.abs(x - 150)).toBeLessThanOrEqual(1.21);
      expect(Math.abs(y)).toBeLessThanOrEqual(3.51);
      const road = -0.02 * Math.abs(y);
      expect(z - road).toBeGreaterThan(0.001);
      expect(z - road).toBeLessThan(0.016);
    }
  });

  it("builds no apron where a side street is drawn already, but keeps the gate and mailbox", () => {
    const r = buildFarmRoadsides({ lines, cattleGrids: [], plan, index, opts, ground, drawn: () => true });
    expect(r.nodes.some((n) => n.name.startsWith("1GRASS_FARMDRIVE_"))).toBe(false);
    expect(r.nodes.some((n) => n.name.startsWith("FURNITURE_FARM_TIMBER_"))).toBe(true);
  });

  it("builds nothing where everything is blocked", () => {
    const r = buildFarmRoadsides({ lines, cattleGrids: [], plan, index, opts, ground, blocked: () => true, drawn: () => true });
    expect(r.nodes).toHaveLength(0);
  });
});

function meshes(n: Kn5Node): Kn5MeshNode[] {
  return n.kind === "mesh" ? [n] : n.children.flatMap(meshes);
}

describe("buildTrack with farm roadsides", async () => {
  const lat0 = -33.9, lng0 = 115.2;
  const mLat = 111_320, mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const at = (x: number, y: number): LngLat => [lng0 + x / mLng, lat0 + y / mLat];
  const route = Array.from({ length: 21 }, (_, i) => at(i * 20 - 200, 0));
  const sources: DataSources = {
    dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, () => 50).sample,
    osm: { buildings: [], guardRails: [], cattleGrids: [at(-20, 0.4)] },
    streets: { lines: [{ cls: "track", pts: [at(60, 0), at(60, 50)] }], names: [] },
  };
  const build = (farmRoadsides: boolean) => buildTrack(route, { name: "Farm", corridor: 50, horizon: 0, imageryZoom: 0, trees: 0, farmRoadsides }, sources);
  const on = await build(true);
  const off = await build(false);

  it("adds the grid, gate and mailbox when on, and nothing when off", () => {
    const all = meshes(readKn5(on.files["farm/farm.kn5"]).root);
    expect(all.some((m) => m.name.startsWith("1KERB_CATTLEGRID_"))).toBe(true);
    expect(all.some((m) => m.name.startsWith("FURNITURE_FARM_"))).toBe(true);
    const k = readKn5(on.files["farm/farm.kn5"]);
    expect(k.materials.some((m) => m.name === "cattle_grid")).toBe(true);
    const none = meshes(readKn5(off.files["farm/farm.kn5"]).root);
    expect(none.some((m) => /CATTLEGRID|FARM/.test(m.name))).toBe(false);
  });
});
