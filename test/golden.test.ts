// The clean-room rewrites of mesh.ts, materials.ts, photoSurface.ts and fences.ts against output
// captured from the old modules before they were deleted (test/fixtures/golden). Byte for byte:
// float32 bit patterns, sha256 of the photo strips, deep-equal materials with property order.
// Deliberate output change: fences split meshes on the true vertex count (8 or 12 per slab, not
// 24). No fixture here comes near 60000 vertices, so the fixtures don't show it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { MeshBuilder } from "../src/core/mesh";
import { groundMaterial, material, multiMapMaterial, nmMaterial } from "../src/core/materials";
import { photoRoadTexture } from "../src/core/photoSurface";
import { buildBarriers, buildWireFences, box, ribbon } from "../src/core/fences";
import type { Kn5MeshNode } from "../src/core/kn5";
import { fenceCases, LIGHTS, meshCases, photoCases } from "./fixtures/golden/inputs";

const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/golden/${f}`, import.meta.url), "utf8"));
type Stored = Record<string, unknown>;

function sameNode(got: Kn5MeshNode, want: Stored, where: string) {
  expect(Object.keys(got), where).toEqual(Object.keys(want));
  for (const [k, v] of Object.entries(want)) {
    const g = (got as unknown as Record<string, unknown>)[k];
    if (v && typeof v === "object" && "type" in v) {
      const { type, data, bits } = v as { type: string; data?: number[]; bits?: number[] };
      expect((g as object).constructor.name, `${where}.${k}`).toBe(type);
      if (bits) {
        const f = g as Float32Array;
        expect(Array.from(new Uint32Array(f.buffer, f.byteOffset, f.length)), `${where}.${k}`).toEqual(bits);
      } else expect(Array.from(g as Uint16Array), `${where}.${k}`).toEqual(data);
    } else expect(g, `${where}.${k}`).toEqual(v);
  }
}
const sameNodes = (got: Kn5MeshNode[], want: Stored[], where: string) => {
  expect(got.map((n) => n.name), where).toEqual(want.map((n) => n.name));
  got.forEach((n, i) => sameNode(n, want[i], `${where}[${i}]`));
};

describe("golden: mesh", () => {
  const want = load("mesh.json");
  for (const [key, c] of Object.entries(meshCases(() => new MeshBuilder()))) {
    it(key, () => sameNode(c.mb.toKn5(c.name, c.material, c.extra), want[key], key));
  }
});

describe("golden: materials", () => {
  const want = load("materials.json");
  const got = {
    material: material("g", "g.png", LIGHTS.ground),
    nmMaterial: nmMaterial("b", "b.png", "b_nm.png", LIGHTS.fence),
    roadAsphalt: multiMapMaterial("road_asphalt_0", "road_asphalt_0.dds", LIGHTS.asphalt, { normal: "road_asphalt_0_nm.dds", maps: "maps_asphalt.png", detail: "detail_asphalt.png", detailUV: 9, sunSpecular: 0.15 }),
    roadGravel: multiMapMaterial("road_gravel_2_1", "road_gravel_2_1.dds", LIGHTS.gravel, { normal: "road_gravel_2_1_nm.dds", maps: "maps_ground.png", detail: "detail_chipseal.png", detailUV: 9, sunSpecular: 0.02 }),
    multiMapNoSun: multiMapMaterial("mm", "mm.dds", LIGHTS.asphalt, { normal: "mm_nm.dds", maps: "maps_asphalt.png", detail: "detail_chipseal.png", detailUV: 7 }),
    terrain: groundMaterial("terrain_3_4", "terrain_3_4.dds", "terrain_3_4_mask.dds", LIGHTS.ground),
    grass: groundMaterial("grass", "grass.png", "mask_grass.png", LIGHTS.ground),
  };
  for (const [key, m] of Object.entries(got)) {
    it(key, () => {
      // JSON keeps key order, so stringify compares property order and texture key order too.
      expect(JSON.stringify(m)).toBe(JSON.stringify(want[key]));
    });
  }
});

describe("golden: photo surface", () => {
  const want = load("photoSurface.json");
  for (const [key, c] of Object.entries(photoCases())) {
    it(key, () => {
      const t = photoRoadTexture(c.plan, c.raster, c.a, c.b, c.trusted, c.W, c.H);
      expect([t.width, t.height]).toEqual([want[key].width, want[key].height]);
      expect(createHash("sha256").update(t.rgba).digest("hex")).toBe(want[key].sha256);
    });
  }
});

describe("golden: fences", () => {
  const want = load("fences.json");
  const f = fenceCases();
  it("barriers", () => sameNodes(buildBarriers(f.barriers, f.index, f.opts, f.ground, f.clear), want.barriers, "barriers"));
  it("barriers with cover", () => sameNodes(buildBarriers(f.barriers, f.index, f.opts, f.ground, () => true, f.cover), want.barriersCover, "barriersCover"));
  it("wire boundary", () => sameNodes(buildWireFences(...f.wireBoundary), want.wireBoundary, "wireBoundary"));
  it("wire mixed", () => sameNodes(buildWireFences(...f.wireMixed), want.wireMixed, "wireMixed"));
  it("wire budget", () => sameNodes(buildWireFences(...f.wireBudget), want.wireBudget, "wireBudget"));
  it("box and ribbon", () => {
    const mb = new MeshBuilder();
    box(mb, ...f.box);
    sameNode(mb.toKn5("box", "timber"), want.box, "box");
    const rb = new MeshBuilder();
    ribbon(rb, ...f.ribbon);
    sameNode(rb.toKn5("ribbon", "wire"), want.ribbon, "ribbon");
  });
});
