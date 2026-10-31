// Kn5 material records for the Kunos shaders the track uses. Spec: docs/specs/materials.md.
//
// Property order is written to the kn5 as given, so it is part of the output: keep every list
// below in exactly this order. Parameter names are the ones the game's shaders declare; a
// misspelt one is silently ignored by the game.

import type { Kn5Material, Kn5ShaderProperty } from "./kn5";
import { GROUND_TILE, type GroundKind } from "./textures";

export type Light = { ambient: number; diffuse: number; specular: number; exp: number };

/** A float property. */
const f1 = (name: string, value: number): Kn5ShaderProperty => ({ name, a: value });
/** Several float properties, in order. */
const floats = (list: [string, number][]) => list.map(([name, value]) => f1(name, value));

/** The six properties every material here starts with. */
const lit = (l: Light): Kn5ShaderProperty[] => [
  ...floats([["ksAmbient", l.ambient], ["ksDiffuse", l.diffuse], ["ksSpecular", l.specular], ["ksSpecularEXP", l.exp]]),
  { name: "ksEmissive", c: [0, 0, 0] },
  f1("ksAlphaRef", 0),
];

const record = (name: string, shader: string, properties: Kn5ShaderProperty[], textures: Record<string, string>): Kn5Material =>
  ({ name, shader, properties, textures });

/** ksPerPixel: a lit diffuse texture. */
export function material(name: string, texture: string, light: Light): Kn5Material {
  return record(name, "ksPerPixel", lit(light), { txDiffuse: texture });
}

/** ksPerPixelNM: diffuse plus a tangent-space normal map; fresnel zeroed (relief, no reflection). */
export function nmMaterial(name: string, diffuse: string, normal: string, light: Light): Kn5Material {
  const relief = floats([["fresnelC", 0], ["fresnelEXP", 5], ["fresnelMaxLevel", 0], ["nmObjectSpace", 0], ["isAdditive", 0]]);
  return record(name, "ksPerPixelNM", [...lit(light), ...relief], { txDiffuse: diffuse, txNormal: normal });
}

export type DetailMaps = { normal: string; maps: string; detail: string; detailUV: number; sunSpecular?: number };

/**
 * ksPerPixelMultiMap (road and gravel with detail shaders): a normal map, txMaps (R specular,
 * G gloss, B sun specular) and a detail texture tiled `detailUV` times across the base UVs,
 * multiplied in wherever the diffuse alpha is 0. Note isAdditive comes before nmObjectSpace here,
 * unlike nmMaterial.
 */
export function multiMapMaterial(name: string, diffuse: string, light: Light, maps: DetailMaps): Kn5Material {
  const detail = floats([
    ["fresnelC", 0], ["fresnelEXP", 5], ["fresnelMaxLevel", 0], ["isAdditive", 0],
    ["useDetail", 1], ["detailUVMultiplier", maps.detailUV], ["shadowBiasMult", 0], ["nmObjectSpace", 0],
    ["sunSpecular", maps.sunSpecular ?? 0], ["sunSpecularEXP", 40],
  ]);
  const { normal: txNormal, maps: txMaps, detail: txDetail } = maps;
  return record(name, "ksPerPixelMultiMap", [...lit(light), ...detail], { txDiffuse: diffuse, txNormal, txMaps, txDetail });
}

/** One detail layer: a texture tiled once every `metres`, projected from above in world metres. */
export type Layer = { texture: string; metres: number };

/**
 * ksMultilayer: the diffuse times four details weighted by txMask's R, G, B and A, then by
 * `magicMult`. multA is a float2 in the shader, so it is written as `b`.
 */
export function multilayerMaterial(name: string, diffuse: string, mask: string, light: Light, layers: [Layer, Layer, Layer, Layer], magicMult: number): Kn5Material {
  const [R, G, B, A] = layers;
  const perMetre = 1 / A.metres;
  const tiling = [...floats([["multR", 1 / R.metres], ["multG", 1 / G.metres], ["multB", 1 / B.metres]]), { name: "multA", b: [perMetre, perMetre] }, f1("magicMult", magicMult)];
  const txDetail = { txDetailR: R.texture, txDetailG: G.texture, txDetailB: B.texture, txDetailA: A.texture };
  return record(name, "ksMultilayer", [...lit(light), ...tiling], { txDiffuse: diffuse, txMask: mask, ...txDetail });
}

const ground = (kind: GroundKind): Layer => ({ texture: `ground_${kind}.dds`, metres: GROUND_TILE[kind] });
/** A is black because a DXT1 mask reads alpha 1 there. */
const GROUND_LAYERS = (): [Layer, Layer, Layer, Layer] => [ground("grass"), ground("dirt"), ground("plain"), { texture: "black.png", metres: 1 }];

/**
 * Ground under a photo or a plain grass/verge texture: grass, dirt and plain detail by the mask's
 * R, G and B. The details average mid grey, so magicMult 2 keeps the photo's brightness from a
 * distance.
 */
export function groundMaterial(name: string, diffuse: string, mask: string, light: Light): Kn5Material {
  return multilayerMaterial(name, diffuse, mask, light, GROUND_LAYERS(), 2);
}
