// Busselton fork: flags that move in the wind.
//
// AC has a flag shader of its own, ksFlags, and Custom Shaders Patch turns meshes that use it into
// "dynamic flags" that react to its wind, with tessellation for smooth folds:
//
//   [WIND]
//   DYNAMIC_FLAGS = AUTO   ; Valid values: NONE, AUTO, or regular mesh filter
//
// (CSP wiki, "Tracks - General options", the [WIND] section; DYNAMIC_FLAGS_TESSELLATION = 1 as in
// CSP's own configs for ks_nurburgring and monaco_1966, and a filter like ours in its ks_monza66
// and ks_silverstone configs: '{ shader:ksFlags & !... }'.) Without CSP, ksFlags waves the cloth
// in its own simple way. What a flag mesh needs (from track makers' notes on assettocorsamods.net,
// "Dynamic Flags issue", and the shipped configs):
//
//  - the ksFlags shader on its material, with low frequency and distortion for the vanilla wave;
//  - UVs inside 0..1, with the texture's left edge (u = 0) along the pole: CSP holds that edge
//    and lets the rest fly;
//  - a single-sided cloth, drawn from both sides by a shader replacement (CULL_MODE = DOUBLESIDED,
//    CSP wiki "General - Shader replacements"). Two coincident sides would cut through each other
//    as they move. For AC without CSP the back is a second mesh (FLAGBACK_...), which CSP hides.
//  - enough vertices along and across for the wave to bend (a grid, not one quad).
//
// Used by the landmark specs' feather flags (specHouse.ts) and landmark layers (landmarkLayer.ts).

import type { Kn5Material } from "./kn5";
import { MeshBuilder, type Vec3 } from "./mesh";

export const FLAG_SHADER = "ksFlags";
/** Prefix of the vanilla back faces, which CSP hides (it draws the front from both sides). */
export const FLAG_BACK_PREFIX = "FLAGBACK_";

/** A flag's material: ksFlags with its gentle vanilla wave (property names as CSP's configs set them). */
export function flagMaterial(name: string, texture: string, light = { ambient: 0.5, diffuse: 0.5, specular: 0.05, exp: 10 }): Kn5Material {
  return {
    name,
    shader: FLAG_SHADER,
    properties: [
      { name: "ksAmbient", a: light.ambient },
      { name: "ksDiffuse", a: light.diffuse },
      { name: "ksSpecular", a: light.specular },
      { name: "ksSpecularEXP", a: light.exp },
      { name: "ksEmissive", c: [0, 0, 0] },
      { name: "ksAlphaRef", a: 0 },
      { name: "frequency", a: 0.3 },
      { name: "distortion", a: 0.05 },
    ],
    textures: { txDiffuse: texture },
  };
}

/**
 * A flag's cloth: a grid of `nu` by `nv` quads. `at(u, v)` places it (u from 0 at the pole to 1 at
 * the free edge, v from 0 at the top to 1 at the bottom); `uv(u, v)` gives its texture coordinates
 * (u = 0 must stay on the pole). The front faces the side the grid's u x down cross product points
 * to; `back`, when given, gets the same grid facing the other way (AC without CSP).
 */
export function cloth(front: MeshBuilder, back: MeshBuilder | null, at: (u: number, v: number) => Vec3, nu = 6, nv = 3, uv: (u: number, v: number) => [number, number] = (u, v) => [u, v]): void {
  for (const [mb, flip] of [[front, false], [back, true]] as const) {
    if (!mb) continue;
    if (!mb.normals) mb.normals = [];
    const base = mb.vertexCount;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv;
        const p = at(u, v);
        // Normal from the grid's directions here (a flat cloth, but follow it if it isn't).
        const du = sub(at(Math.min(1, u + 1e-3), v), at(Math.max(0, u - 1e-3), v));
        const dv = sub(at(u, Math.min(1, v + 1e-3)), at(u, Math.max(0, v - 1e-3)));
        let n = cross(du, dv);
        const l = Math.hypot(...n) || 1;
        n = [n[0] / l, n[1] / l, n[2] / l];
        if (flip) n = [-n[0], -n[1], -n[2]];
        mb.vertex(p, ...uv(u, v));
        mb.normals.push(...n);
      }
    }
    const row = nu + 1;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * row + i, b = a + 1, c = a + row + 1, d = a + row;
        // Counter-clockwise seen from the side the normal points to.
        if (flip) mb.quad(a, d, c, b); else mb.quad(a, b, c, d);
      }
    }
  }
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/* ---------------- CSP config ---------------- */

/** ext_config lines: ksFlags meshes as dynamic flags in CSP's wind, drawn from both sides, the vanilla backs hidden. */
export function flagCspLines(): string[] {
  return [
    "[WIND]",
    `DYNAMIC_FLAGS = '{ shader:${FLAG_SHADER} & !${FLAG_BACK_PREFIX}? }'`,
    "DYNAMIC_FLAGS_TESSELLATION = 1",
    "",
    "[SHADER_REPLACEMENT_...]",
    `MATERIALS = shader:${FLAG_SHADER}`,
    "CULL_MODE = DOUBLESIDED",
    "DOUBLE_FACE_SHADOW_BIASED = 1",
    "",
    "[SHADER_REPLACEMENT_...]",
    `MESHES = ${FLAG_BACK_PREFIX}?`,
    "IS_VISIBLE = 0",
    "CAST_SHADOWS = 0",
    "",
  ];
}
