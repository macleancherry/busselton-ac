// Plain and normal-mapped building materials (ksPerPixel, ksPerPixelNM), shared by the track build
// and the landmark layers (landmarkLayer.ts).
import type { Kn5Material } from "./kn5";

export function material(name: string, texture: string, light: { ambient: number; diffuse: number; specular: number; exp: number }): Kn5Material {
  return {
    name,
    shader: "ksPerPixel",
    properties: [
      { name: "ksAmbient", a: light.ambient },
      { name: "ksDiffuse", a: light.diffuse },
      { name: "ksSpecular", a: light.specular },
      { name: "ksSpecularEXP", a: light.exp },
      { name: "ksEmissive", c: [0, 0, 0] },
      { name: "ksAlphaRef", a: 0 },
    ],
    textures: { txDiffuse: texture },
  };
}

/** A normal-mapped material (ksPerPixelNM): relief without reflections. Parameter names as the shader declares them. */
export function nmMaterial(name: string, diffuse: string, normal: string, light: { ambient: number; diffuse: number; specular: number; exp: number }): Kn5Material {
  const base = material(name, diffuse, light);
  return {
    ...base,
    shader: "ksPerPixelNM",
    properties: [
      ...base.properties,
      { name: "fresnelC", a: 0 },
      { name: "fresnelEXP", a: 5 },
      { name: "fresnelMaxLevel", a: 0 },
      { name: "nmObjectSpace", a: 0 },
      { name: "isAdditive", a: 0 },
    ],
    textures: { txDiffuse: diffuse, txNormal: normal },
  };
}

