import { describe, expect, it } from "vitest";
import { planRoad, SegmentIndex } from "../src/core/road";
import { withDefaults } from "../src/core/options";
import { buildBarriers, buildWireFences, isWireFence, WIRE_FENCE } from "../src/core/fences";
import { buildFarmland, buildVines, farmBoundaries, rowDirection, VINE, vineRows, type FarmPolygon } from "../src/core/farm";
import { extConfig } from "../src/core/cspConfig";
import { farmKind, tilesNear } from "../src/services/landcover";
import type { Vec2 } from "../src/core/geo";
import { buildTrack, type DataSources } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import type { Kn5Node } from "../src/core/kn5";
// @ts-expect-error plain .mjs module without types
import { PRESETS } from "../scripts/headless/presets.mjs";

// An 8 m country road along y = 0, x 0 to 300.
const path: Vec2[] = Array.from({ length: 16 }, (_, i) => [i * 20, 0]);
const opts = withDefaults({ widthOverride: 8, corridor: 70, farmland: true });
const plan = planRoad(path, opts);
const index = new SegmentIndex(plan);
const verts = (n: { positions: Float32Array }) => Array.from({ length: n.positions.length / 3 }, (_, i) => [n.positions[i * 3], -n.positions[i * 3 + 2], n.positions[i * 3 + 1]]);
const tris = (nodes: { indices: ArrayLike<number> }[]) => nodes.reduce((s, n) => s + n.indices.length / 3, 0);
const dist = (_x: number, y: number) => Math.abs(y);

/** A rectangle w x h centred at c, turned by `deg`. */
function block(c: Vec2, w: number, h: number, deg: number, kind: FarmPolygon["kind"] = "vineyard"): FarmPolygon {
  const t = (deg * Math.PI) / 180, u: Vec2 = [Math.cos(t), Math.sin(t)], v: Vec2 = [-Math.sin(t), Math.cos(t)];
  const ring: Vec2[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [c[0] + u[0] * a * w / 2 + v[0] * b * h / 2, c[1] + u[1] * a * w / 2 + v[1] * b * h / 2]);
  return { kind, rings: [ring], edge: [ring.map(() => true)] };
}

describe("vineyards", () => {
  it("runs the rows along the block's long axis", () => {
    const d = rowDirection(block([0, 0], 200, 60, 30));
    expect(Math.abs(d[0] * Math.cos(Math.PI / 6) + d[1] * Math.sin(Math.PI / 6))).toBeCloseTo(1, 2);
    const e = rowDirection(block([0, 0], 40, 150, 10));
    // Long along the 100-degree axis.
    expect(Math.abs(e[0] * Math.cos((100 * Math.PI) / 180) + e[1] * Math.sin((100 * Math.PI) / 180))).toBeCloseTo(1, 2);
  });

  it("ignores tile seams when finding the direction", () => {
    // A block at 20 degrees cut square by a tile seam: the long seam edge mustn't decide.
    const b = block([0, 0], 200, 80, 20);
    const ring: Vec2[] = [...b.rings[0], [b.rings[0][3][0], -200]];
    // Fake a seam: an extra long axis-aligned edge flagged as seam.
    const poly: FarmPolygon = { kind: "vineyard", rings: [ring], edge: [[true, true, true, false, false]] };
    const d = rowDirection(poly);
    expect(Math.abs(d[0] * Math.cos(Math.PI / 9) + d[1] * Math.sin(Math.PI / 9))).toBeGreaterThan(0.99);
  });

  it("spaces rows about 3 m apart, leaving a headland at the ends", () => {
    const rows = vineRows(block([0, 0], 100, 30, 0));
    expect(rows.length).toBe(10);
    const ys = rows.map((r) => r[0][1]).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(VINE.spacing, 5);
    for (const [a, b] of rows) {
      expect(Math.min(a[0], b[0])).toBeCloseTo(-50 + VINE.headland, 5);
      expect(Math.max(a[0], b[0])).toBeCloseTo(50 - VINE.headland, 5);
    }
  });

  it("cuts rows round a hole (a shed in the block)", () => {
    const b = block([0, 0], 100, 30, 0);
    b.rings.push([[-10, -5], [-10, 5], [10, 5], [10, -5]]);
    b.edge.push([true, true, true, true]);
    const through = vineRows(b).filter((r) => Math.abs(r[0][1]) < 4.5);
    expect(through.length).toBeGreaterThan(0);
    for (const [a, c] of through) expect(Math.max(a[0], c[0]) < -10 || Math.min(a[0], c[0]) > 10).toBe(true);
  });

  it("builds canopy, posts and a trellis wire that follow the ground, visual only", () => {
    const { nodes, metres } = buildVines([block([150, 40], 60, 30, 0)], (x) => 5 + x * 0.02, () => true, dist);
    expect(metres).toBeGreaterThan(400);
    const names = nodes.map((n) => n.name);
    expect(names.some((n) => /^VINES_/.test(n))).toBe(true);
    expect(names.some((n) => /^VINEPOSTS_/.test(n))).toBe(true);
    expect(names.some((n) => /^VINEWIRE_/.test(n))).toBe(true);
    expect(names.every((n) => !/^[0-9]/.test(n))).toBe(true);
    const leaf = nodes.find((n) => n.name.startsWith("VINES_"))!;
    expect(leaf.material).toBe("vine_leaf");
    for (const [x, , z] of verts(leaf)) {
      const g = 5 + x * 0.02;
      expect(z - g).toBeGreaterThan(VINE.canopyBase - 0.01);
      expect(z - g).toBeLessThan(VINE.canopyTop + 0.01);
    }
  });

  it("keeps the rows nearest the road when over the triangle cap", () => {
    const polys = [block([150, 20], 200, 20, 0), block([150, 60], 200, 20, 0)];
    const all = buildVines(polys, () => 0, () => true, dist);
    const capped = buildVines(polys, () => 0, () => true, dist, 2000);
    expect(tris(capped.nodes)).toBeLessThanOrEqual(2000 * 1.05);
    expect(tris(capped.nodes)).toBeLessThan(tris(all.nodes));
    const ys = capped.nodes.flatMap(verts).map((p) => p[1]);
    expect(Math.max(...ys)).toBeLessThan(35);
  });
});

describe("farm fences", () => {
  it("tells wire fences from solid ones", () => {
    expect(isWireFence({ pts: [], kind: "fence", fenceType: "barbed_wire" })).toBe(true);
    expect(isWireFence({ pts: [], kind: "fence", fenceType: "electric" })).toBe(true);
    expect(isWireFence({ pts: [], kind: "fence" })).toBe(false);
    expect(isWireFence({ pts: [], kind: "wall", fenceType: "wire" })).toBe(false);
  });

  it("builds posts and three wires along a paddock boundary beside the road", () => {
    const nodes = buildWireFences([[[20, 15], [200, 15]]], index, opts, (x) => 2 + x * 0.01, () => true);
    const posts = nodes.filter((n) => n.name.startsWith("1WALL_FENCE_WIREPOST_"));
    const wires = nodes.filter((n) => n.name.startsWith("1WALL_FENCE_WIRE_"));
    expect(posts.length).toBe(1);
    expect(wires.length).toBe(1);
    // 45 spans of 4 m, a post at each end of each: 46 posts.
    expect(posts[0].indices.length / 3).toBe(46 * 8);
    const top = Math.max(...verts(posts[0]).filter((p) => Math.abs(p[0] - 200) < 0.1).map((p) => p[2]));
    expect(top).toBeCloseTo(2 + 2 + WIRE_FENCE.postHeight, 2);
    const heights = new Set(verts(wires[0]).filter((p) => Math.abs(p[0] - 20) < 0.01).map((p) => Math.round((p[2] - 2.2) * 100)));
    expect(heights.size).toBe(WIRE_FENCE.wires.length * 2);
  });

  it("never fences the road, beyond reach, or twice along a shared boundary", () => {
    const nodes = buildWireFences([
      [[0, 4.5], [300, 4.5]], // on the road edge
      [[20, 60], [200, 60]], // too far back
      [[40, 20], [120, 20]], // a shared boundary, mapped in both directions
      [[120, 20], [40, 20]],
    ], index, opts, () => 0, () => true);
    const v = nodes.flatMap(verts);
    for (const [, y] of v) {
      expect(y).toBeGreaterThan(4 + opts.vergeWidth + 2.5 - 0.2);
      expect(y).toBeLessThan(41);
    }
    const posts = nodes.find((n) => n.name.startsWith("1WALL_FENCE_WIREPOST_"))!;
    expect(posts.indices.length / 3).toBe(21 * 8);
  });

  it("fences only real boundaries, not tile seams", () => {
    const poly: FarmPolygon = { kind: "paddock", rings: [[[0, 10], [100, 10], [100, 50], [0, 50]]], edge: [[true, false, true, true]] };
    const lines = farmBoundaries([poly]);
    expect(lines).toEqual([[[0, 10], [100, 10]], [[100, 50], [0, 50], [0, 10]]]);
  });

  it("leaves OSM wire fences to the farm fences when farmland is on", () => {
    const wire = [{ pts: [[40, 20], [120, 20]] as Vec2[], kind: "fence" as const, fenceType: "barbed_wire" }];
    expect(buildBarriers(wire, index, opts, () => 0, () => true)).toHaveLength(0);
    expect(buildBarriers(wire, index, withDefaults({ widthOverride: 8 }), () => 0, () => true)).toHaveLength(1);
    const farm = buildFarmland([block([150, 40], 60, 30, 0)], wire, index, opts, () => 0, () => true, dist);
    expect(farm.vineMetres).toBeGreaterThan(0);
    expect(farm.nodes.some((n) => n.name.startsWith("1WALL_FENCE_WIRE_"))).toBe(true);
  });
});

describe("farmland data and config", () => {
  it("reads vineyards and paddocks from the landcover layer", () => {
    expect(farmKind({ class: "farmland", subclass: "vineyard" })).toBe("vineyard");
    expect(farmKind({ class: "farmland", subclass: "farmland" })).toBe("paddock");
    expect(farmKind({ class: "grass", subclass: "meadow" })).toBe("paddock");
    expect(farmKind({ class: "farmland", subclass: "orchard" })).toBeUndefined();
    expect(farmKind({ class: "wood", subclass: "forest" })).toBeUndefined();
  });

  it("fetches only the tiles along the route", () => {
    // 20 km due east from Busselton: a strip of z14 tiles (~2 km), not a box.
    const tiles = tilesNear([[115.35, -33.65], [115.565, -33.65]], 90);
    expect(tiles.length).toBeGreaterThan(9);
    expect(tiles.length).toBeLessThan(30);
  });

  it("tints vine leaves in autumn with CSP", () => {
    const ini = extConfig([], { vines: true });
    expect(ini).toMatch(/NAME = VINE_AUTUMN/);
    expect(ini).toMatch(/MATERIALS = vine_leaf/);
    expect(extConfig([], {})).not.toMatch(/vine_leaf/);
  });

  it("is on in the country preset", () => {
    expect(PRESETS.country.build.farmland).toBe(true);
    expect(PRESETS.town.build.farmland).toBeUndefined();
  });
});

describe("farmland in a build", () => {
  const lat0 = -33.8, lng0 = 115.05;
  const mx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ll = (x: number, y: number): [number, number] => [lng0 + x / mx, lat0 + y / 111_320];
  const names = (root: Kn5Node): string[] => (root.kind === "mesh" ? [root.name] : root.children.flatMap(names));

  it("puts vine rows and farm fences in the track, with the leaf material and its season tint", { timeout: 60_000 }, async () => {
    const route = Array.from({ length: 21 }, (_, i) => ll(i * 20, 0));
    const vineyard: FarmPolygon = { kind: "vineyard", rings: [[ll(100, 15), ll(300, 15), ll(300, 60), ll(100, 60)]], edge: [[true, true, true, true]] };
    const sources: DataSources = {
      dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, () => 50).sample,
      widthAt: () => 7,
      farmland: [vineyard],
    };
    const base = { name: "Farm", imageryZoom: 0, corridor: 70, horizon: 0, trees: 0, buildings: false, origin: ll(200, 0) };
    const built = await buildTrack(route, { ...base, farmland: true }, sources);
    const got = names(built.model.root);
    expect(got.some((n) => n.startsWith("VINES_"))).toBe(true);
    expect(got.some((n) => n.startsWith("1WALL_FENCE_WIRE"))).toBe(true);
    expect(built.model.materials.some((m) => m.name === "vine_leaf")).toBe(true);
    const ini = new TextDecoder().decode(Object.entries(built.files).find(([k]) => k.endsWith("ext_config.ini"))![1] as Uint8Array);
    expect(ini).toMatch(/VINE_AUTUMN/);
    // Off: none of it.
    const plain = await buildTrack(route, base, sources);
    expect(names(plain.model.root).some((n) => /^VINE|FENCE_WIRE/.test(n))).toBe(false);
  });
});
