import { describe, expect, it } from "vitest";
import { planRoad, type RoadPlan } from "../src/core/road";
import { withDefaults } from "../src/core/options";
import { buildRoadMeshes } from "../src/core/roadMesh";
import { surfacesIni } from "../src/core/acFiles";
import { GRAVEL_MATERIAL, gravelTexture, isUnsealed, surfaceKeyFor, UNPAVED_KEY, UNSEALED_KEY, unsealedSamples, unsealedSurfaces } from "../src/core/unsealed";
import { sealTexture } from "../src/core/textures";
import { buildTrack, type DataSources } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import type { LngLat, Vec2 } from "../src/core/geo";
import { readKn5, type Kn5MeshNode, type Kn5Node } from "../src/core/kn5";

function road(path: Vec2[]): RoadPlan {
  const plan = planRoad(path, withDefaults({ widthOverride: 7 }));
  plan.samples.forEach((s) => (s.h = 10));
  return plan;
}
const straight = (len: number): Vec2[] => Array.from({ length: 51 }, (_, i) => [(i / 50) * len, 0]);
const flags = (plan: RoadPlan, u: Uint8Array) => plan.samples.filter((_, i) => u[i]).map((s) => s.s);

describe("which roads are unsealed", () => {
  it("reads OSM surface tags and the tiles' unpaved", () => {
    for (const s of ["unpaved", "gravel", "compacted", "dirt", "fine_gravel", "ground", "Gravel", "asphalt;gravel"]) expect(isUnsealed(s)).toBe(true);
    for (const s of ["asphalt", "paved", "concrete", "chipseal", "paving_stones"]) expect(isUnsealed(s)).toBe(false);
    expect(isUnsealed(undefined, "residential")).toBe(false);
  });

  it("counts an untagged track as unsealed unless it's grade 1", () => {
    expect(isUnsealed(undefined, "track")).toBe(true);
    expect(isUnsealed(undefined, "track", "grade3")).toBe(true);
    expect(isUnsealed(undefined, "track", "grade1")).toBe(false);
    expect(isUnsealed("asphalt", "track")).toBe(false);
  });
});

describe("unsealed stretches of the route", () => {
  const plan = road(straight(1000));

  it("follows an unsealed way that runs along the route", () => {
    const u = unsealedSamples(plan, [[[400, 1], [700, 1]]]);
    const s = flags(plan, u);
    expect(Math.min(...s)).toBeGreaterThanOrEqual(393);
    expect(Math.max(...s)).toBeLessThanOrEqual(707);
    expect(s.length).toBeGreaterThan(140);
  });

  it("ignores gravel roads that cross or meet it, and ones off to the side", () => {
    expect(unsealedSamples(plan, [[[500, -100], [500, 100]]]).includes(1)).toBe(false);
    expect(unsealedSamples(plan, [[[200, 0], [200, 80]]]).includes(1)).toBe(false);
    expect(unsealedSamples(plan, [[[100, 30], [900, 30]]]).includes(1)).toBe(false);
  });

  it("fills short gaps and drops short stretches", () => {
    // Two ways with a 10 m gap between them: one stretch.
    const s = flags(plan, unsealedSamples(plan, [[[200, 0], [400, 0]], [[410, 0], [600, 0]]]));
    expect(s.some((x) => x > 402 && x < 408)).toBe(true);
    // 16 m of gravel isn't worth a surface change.
    expect(unsealedSamples(plan, [[[500, 0], [516, 0]]]).includes(1)).toBe(false);
  });

  it("can be forced for the whole route", () => {
    expect(unsealedSamples(plan, [], true).every((v) => v === 1)).toBe(true);
    expect(unsealedSamples(plan, []).includes(1)).toBe(false);
  });
});

describe("gravel physics", () => {
  const reserved = ["ROAD", "STREET", "GRASS", "KERB", "WALL", "SAND", "GRAVEL", "DIRT"];

  it("uses keys AC won't confuse with another surface", () => {
    for (const k of [UNSEALED_KEY, UNPAVED_KEY]) for (const r of reserved) expect(k.includes(r)).toBe(false);
    expect(UNSEALED_KEY.includes(UNPAVED_KEY) || UNPAVED_KEY.includes(UNSEALED_KEY)).toBe(false);
    expect(surfaceKeyFor(`${GRAVEL_MATERIAL}_2_0`, true)).toBe(UNSEALED_KEY);
    expect(surfaceKeyFor(`${GRAVEL_MATERIAL}_1_1`, false)).toBe(UNPAVED_KEY);
    expect(surfaceKeyFor("road_asphalt_2_0", true)).toBeUndefined();
  });

  it("writes gravel surfaces only when the track has gravel", () => {
    expect(surfacesIni()).not.toContain(UNSEALED_KEY);
    const ini = surfacesIni(true);
    const blocks = ini.split(/\n\n/).filter((b) => b.startsWith("[SURFACE_"));
    expect(blocks.map((b) => /KEY=(\w+)/.exec(b)![1])).toEqual(["ROAD", "STREET", "GRASS", "KERB", "WALL", UNSEALED_KEY, UNPAVED_KEY]);
    const gravel = blocks[5];
    expect(gravel).toMatch(/^\[SURFACE_5\]/);
    const num = (k: string) => Number(new RegExp(`\\n${k}=([\\d.]+)`).exec(gravel)![1]);
    expect(num("FRICTION")).toBeGreaterThan(0.7);
    expect(num("FRICTION")).toBeLessThan(0.9);
    expect(num("IS_VALID_TRACK")).toBe(1);
    expect(num("DIRT_ADDITIVE")).toBeGreaterThan(0);
    expect(gravel).toContain("_EXT_SURFACE_TYPE=GRAVEL");
    expect(blocks[6]).toContain("IS_VALID_TRACK=0");
  });

  it("makes gravel side streets valid track when streets are", () => {
    expect(unsealedSurfaces(true)[1].IS_VALID_TRACK).toBe(1);
    expect(unsealedSurfaces(false)[1].IS_VALID_TRACK).toBe(0);
  });
});

describe("gravel texture", () => {
  const lum = (rgba: Uint8Array, row0: number, rows: number, w: number) => {
    let sum = 0;
    for (let y = row0; y < row0 + rows; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      sum += 0.3 * rgba[i] + 0.59 * rgba[i + 1] + 0.11 * rgba[i + 2];
    }
    return sum / (rows * w);
  };

  it("is pale limestone, much lighter than bitumen, and the same every time", () => {
    const g = gravelTexture(true, 0);
    expect([g.width, g.height]).toEqual([512, 1024]);
    expect(g.rgba.length).toBe(512 * 1024 * 4);
    const a = sealTexture("asphalt", true, 0);
    expect(lum(g.rgba, 0, 1024, 512)).toBeGreaterThan(lum(a.rgba, 0, 1024, 512) + 80);
    // Warm: more red than blue.
    let r = 0, b = 0;
    for (let i = 0; i < g.rgba.length; i += 4) { r += g.rgba[i]; b += g.rgba[i + 2]; }
    expect(r).toBeGreaterThan(b * 1.1);
    expect(gravelTexture(true, 0).rgba).toEqual(g.rgba);
    expect(gravelTexture(true, 1).rgba).not.toEqual(g.rgba);
  }, 60_000);

  it("tiles along the road: the first and last rows match in tone", () => {
    const g = gravelTexture(false, 2);
    expect(Math.abs(lum(g.rgba, 0, 4, 512) - lum(g.rgba, 1020, 4, 512))).toBeLessThan(6);
  }, 60_000);
});

describe("road meshes with gravel", () => {
  const plan = road(straight(1000));
  const opts = withDefaults({ widthOverride: 7 });
  const tris = (m: Kn5MeshNode) => m.indices.length / 3;

  it("splits a chunk at the change of surface and keeps every triangle", () => {
    const plain = buildRoadMeshes(plan, opts, () => "road_asphalt_2_0");
    const u = unsealedSamples(plan, [[[300, 0], [1000, 0]]]);
    const mixed = buildRoadMeshes(plan, opts, () => "road_asphalt_2_0", undefined, { at: (i) => u[i] === 1, material: () => "road_gravel_2_0" });
    const gravel = mixed.road.filter((m) => m.name.startsWith("1UNSEALED_"));
    expect(gravel.length).toBeGreaterThan(0);
    expect(gravel.every((m) => m.material === "road_gravel_2_0")).toBe(true);
    expect(mixed.road.reduce((a, m) => a + tris(m), 0)).toBe(plain.road.reduce((a, m) => a + tris(m), 0));
    // Sealed meshes only before 300 m (AC x = east), gravel only after.
    for (const m of mixed.road) {
      const xs: number[] = [];
      for (const i of m.indices) xs.push(m.positions[i * 3]);
      if (m.name.startsWith("1ROAD_")) expect(Math.max(...xs)).toBeLessThan(308);
      else expect(Math.min(...xs)).toBeGreaterThan(291);
    }
    // No vertex left unused in a split mesh.
    for (const m of mixed.road) expect(new Set(m.indices).size).toBe(m.positions.length / 3);
  });

  it("is unchanged with no gravel", () => {
    const a = buildRoadMeshes(plan, opts, () => "road_asphalt_2_0");
    const b = buildRoadMeshes(plan, opts, () => "road_asphalt_2_0", undefined, { at: () => false, material: () => "x" });
    expect(b.road.map((m) => [m.name, m.indices.length, m.positions.length])).toEqual(a.road.map((m) => [m.name, m.indices.length, m.positions.length]));
  });
});

describe("a track with gravel", async () => {
  const lat0 = -34.05, lng0 = 115.1;
  const mLat = 111_320, mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const at = (x: number, y: number): LngLat => [lng0 + x / mLng, lat0 + y / mLat];
  const meshes = (n: Kn5Node): Kn5MeshNode[] => (n.kind === "mesh" ? [n] : n.children.flatMap(meshes));
  const route = Array.from({ length: 41 }, (_, i) => at(i * 20 - 400, 0));
  const sources = (unsealed: LngLat[][]): DataSources => ({
    dem: async (p, b, z) => DemGrid.fromFunction(p, z, b, () => 20).sample,
    osm: { buildings: [], guardRails: [], unsealed },
    streets: {
      lines: [
        { pts: [at(-200, 0), at(-200, 80)], cls: "minor", surface: "unpaved" },
        { pts: [at(200, 0), at(200, 80)], cls: "minor" },
      ],
      names: [],
    },
  });
  const base = { corridor: 60, horizon: 0, imageryZoom: 0, widthOverride: 7, streetSigns: false, landmarks: false };
  const half = await buildTrack(route, { ...base, name: "Gravel" }, sources([[at(0, 0), at(400, 0)]]));
  const all = meshes(readKn5(half.files["gravel/gravel.kn5"]).root);

  it("lays gravel where OSM says, with its own surface", () => {
    const gravel = all.filter((m) => m.name.startsWith("1UNSEALED_"));
    expect(gravel.length).toBeGreaterThan(0);
    expect(gravel.every((m) => m.material.startsWith(GRAVEL_MATERIAL))).toBe(true);
    for (const m of gravel) for (const i of m.indices) expect(m.positions[i * 3]).toBeGreaterThan(-8);
    expect(all.some((m) => m.name.startsWith("1ROAD_"))).toBe(true);
    const ini = new TextDecoder().decode(half.files["gravel/data/surfaces.ini"]);
    expect(ini).toContain(`KEY=${UNSEALED_KEY}`);
  });

  it("makes an unpaved side street gravel, a sealed one not", () => {
    const side = all.filter((m) => m.name.startsWith("1UNPAVED_"));
    expect(side.length).toBe(1);
    expect(side[0].material.startsWith(GRAVEL_MATERIAL)).toBe(true);
    for (const i of side[0].indices) expect(side[0].positions[i * 3]).toBeLessThan(-150);
    expect(all.some((m) => m.name.startsWith("1STREET_"))).toBe(true);
  });

  it("paints no lines on the gravel", () => {
    const paint = all.filter((m) => /^MARKINGS|^RRPM/.test(m.name) || m.material.startsWith("paint"));
    expect(paint.length).toBeGreaterThan(0);
    // The gravel runs from about x = -6 to 406; the run-off past the finish is sealed again.
    for (const m of paint) for (const i of m.indices) {
      const x = m.positions[i * 3];
      expect(x < 2 || x > 393).toBe(true);
    }
  });

  it("can make the whole route gravel", async () => {
    const r = await buildTrack(route, { ...base, name: "Forest", unsealed: true, sideStreets: false }, sources([]));
    const ms = meshes(readKn5(r.files["forest/forest.kn5"]).root);
    expect(ms.some((m) => /^1ROAD_\d/.test(m.name))).toBe(false);
    expect(ms.some((m) => m.name.startsWith("1UNSEALED_"))).toBe(true);
    expect(ms.some((m) => m.material.startsWith("paint"))).toBe(false);
 }, 120_000);

  it("leaves a track with no gravel as it was", async () => {
    const r = await buildTrack(route, { ...base, name: "Sealed", sideStreets: false }, sources([]));
    const ms = meshes(readKn5(r.files["sealed/sealed.kn5"]).root);
    expect(ms.some((m) => /UNSEALED|UNPAVED/.test(m.name))).toBe(false);
    expect(new TextDecoder().decode(r.files["sealed/data/surfaces.ini"])).not.toContain(UNSEALED_KEY);
 }, 120_000);
});
