// Material builders (docs/specs/materials.md, "Tests to write").
import { describe, expect, it } from "vitest";
import { groundMaterial, material, multilayerMaterial, multiMapMaterial, nmMaterial } from "../src/core/materials";
import { IDENTITY, readKn5, writeKn5, type Kn5Material } from "../src/core/kn5";

const light = { ambient: 0.45, diffuse: 0.4, specular: 0.05, exp: 10 };
const BASE = ["ksAmbient", "ksDiffuse", "ksSpecular", "ksSpecularEXP", "ksEmissive", "ksAlphaRef"];
const names = (m: Kn5Material) => m.properties.map((p) => p.name);
const prop = (m: Kn5Material, n: string) => m.properties.find((p) => p.name === n)!;

function roundTrip(m: Kn5Material): Kn5Material {
  const mesh = { kind: "mesh" as const, name: "x", material: m.name, positions: new Float32Array(9), normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), uvs: new Float32Array(6), indices: new Uint16Array([0, 1, 2]) };
  const bytes = writeKn5({ textures: Object.values(m.textures).map((name) => ({ name, data: new Uint8Array(4) })), materials: [m], root: { kind: "node", name: "root", transform: IDENTITY, children: [mesh] } });
  return readKn5(bytes).materials[0];
}

describe("material", () => {
  it("is a plain ksPerPixel record", () => {
    const m = material("g", "g.png", light);
    expect(Object.keys(m)).toEqual(["name", "shader", "properties", "textures"]);
    expect(m.shader).toBe("ksPerPixel");
    expect(names(m)).toEqual(BASE);
    expect(m.properties.slice(0, 4).map((p) => p.a)).toEqual([0.45, 0.4, 0.05, 10]);
    expect(prop(m, "ksEmissive")).toEqual({ name: "ksEmissive", c: [0, 0, 0] });
    expect(prop(m, "ksAlphaRef")).toEqual({ name: "ksAlphaRef", a: 0 });
    for (const p of m.properties) expect(Object.keys(p).length).toBe(2);
    expect(m.textures).toEqual({ txDiffuse: "g.png" });
  });

  it("can be spread and overridden", () => {
    const m = material("t", "t.png", light);
    const at = { ...m, shader: "ksPerPixelAT", alphaTested: true };
    expect(at.properties).toEqual(m.properties);
    expect(at.textures).toEqual(m.textures);
    expect(at.shader).toBe("ksPerPixelAT");
  });
});

describe("nmMaterial", () => {
  it("adds a normal map and zeroed fresnel", () => {
    const m = nmMaterial("b", "b.png", "b_nm.png", light);
    expect(Object.keys(m)).toEqual(["name", "shader", "properties", "textures"]);
    expect(m.shader).toBe("ksPerPixelNM");
    expect(names(m)).toEqual([...BASE, "fresnelC", "fresnelEXP", "fresnelMaxLevel", "nmObjectSpace", "isAdditive"]);
    expect(m.properties.slice(6).map((p) => p.a)).toEqual([0, 5, 0, 0, 0]);
    expect(Object.entries(m.textures)).toEqual([["txDiffuse", "b.png"], ["txNormal", "b_nm.png"]]);
  });

  it("binds diffuse to register 0 and the normal map to 1 in a kn5", () => {
    expect(roundTrip(nmMaterial("b", "b.png", "b_nm.png", light)).registers).toEqual({ txDiffuse: 0, txNormal: 1 });
  });
});

describe("detail materials", () => {
  it("multiMapMaterial", () => {
    const m = multiMapMaterial("road", "road.dds", light, { normal: "road_nm.dds", maps: "maps_asphalt.png", detail: "detail_asphalt.png", detailUV: 9, sunSpecular: 0.15 });
    expect(m.shader).toBe("ksPerPixelMultiMap");
    expect(names(m)).toEqual([...BASE, "fresnelC", "fresnelEXP", "fresnelMaxLevel", "isAdditive", "useDetail", "detailUVMultiplier", "shadowBiasMult", "nmObjectSpace", "sunSpecular", "sunSpecularEXP"]);
    expect(prop(m, "useDetail").a).toBe(1);
    expect(prop(m, "detailUVMultiplier").a).toBe(9);
    expect(prop(m, "sunSpecular").a).toBe(0.15);
    expect(prop(m, "sunSpecularEXP").a).toBe(40);
    expect(roundTrip(m).registers).toEqual({ txDiffuse: 0, txNormal: 1, txMaps: 2, txDetail: 3 });
    const noSun = multiMapMaterial("r", "r.dds", light, { normal: "n", maps: "m", detail: "d", detailUV: 4 });
    expect(prop(noSun, "sunSpecular").a).toBe(0);
  });

  it("multilayerMaterial writes multA as a float2", () => {
    const L = (t: string, metres: number) => ({ texture: t, metres });
    const m = multilayerMaterial("x", "x.dds", "mask.dds", light, [L("r", 2), L("g", 4), L("b", 5), L("a", 8)], 3);
    expect(m.shader).toBe("ksMultilayer");
    expect(names(m)).toEqual([...BASE, "multR", "multG", "multB", "multA", "magicMult"]);
    expect(prop(m, "multA")).toEqual({ name: "multA", b: [0.125, 0.125] });
    expect(prop(m, "multB").a).toBe(0.2);
    expect(prop(m, "magicMult").a).toBe(3);
    expect(roundTrip(m).registers).toEqual({ txDiffuse: 0, txMask: 1, txDetailR: 2, txDetailG: 3, txDetailB: 4, txDetailA: 5 });
  });

  it("groundMaterial uses the ground tiles and doubles the detail", () => {
    const m = groundMaterial("terrain_0_0", "t.dds", "m.dds", light);
    expect(prop(m, "multR").a).toBeCloseTo(1 / 1.6, 12);
    expect(prop(m, "magicMult").a).toBe(2);
    expect([m.textures.txDetailR, m.textures.txDetailG, m.textures.txDetailB, m.textures.txDetailA]).toEqual(["ground_grass.dds", "ground_dirt.dds", "ground_plain.dds", "black.png"]);
  });
});
