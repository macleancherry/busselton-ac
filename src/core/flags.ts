// Flags that move in the wind.
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
// Used by the race-day marshal flags (raceDress.ts pieces); `cloth` and `flagMaterial` work for
// any other flag too. The sponsor feather flags in race dressing are drawn in the sign atlas, which
// can't hold a flag's u = 0 edge, so they stay still.

import type { Kn5Material, Kn5MeshNode } from "./kn5";
import type { Piece } from "./furniture";
import { MeshBuilder, type Vec3 } from "./mesh";
import { encodePng } from "./png";
import { fill } from "./textures";

type Vec2 = [number, number];

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

/* ---------------- race-day marshal flags ---------------- */

/** The marshal flags, one per row of the race flag texture. */
export const RACE_FLAGS = ["yellow", "green", "blue", "chequered"] as const;
export type RaceFlag = (typeof RACE_FLAGS)[number];
export const RACE_FLAG_MATERIAL = "flag_race";

/** One row per flag, each the full width (so every flag's u = 0 edge is the texture's left edge). */
export function raceFlagTexture(): Uint8Array {
  const w = 64, rowH = 32, h = rowH * RACE_FLAGS.length;
  return encodePng(fill(w, h, (x, y) => {
    const flag = RACE_FLAGS[Math.floor(y / rowH)], yy = y % rowH;
    if (flag === "yellow") return [250, 204, 20];
    if (flag === "green") return [24, 150, 60];
    if (flag === "blue") return [30, 80, 200];
    return ((x >> 3) + (yy >> 3)) % 2 ? [20, 20, 22] : [240, 240, 236];
  }), w, h, { alpha: false });
}

export interface FlagSpot {
  /** Bottom of the pole edge (local metres), and the way the cloth flies off it (unit, horizontal). */
  pole: Vec2;
  dir: Vec2;
  z0: number;
  height: number;
  width: number;
  flag: RaceFlag;
}

/** Marshal flags are 3:2. */
const RACE_FLAG_ASPECT = 1.5;

/**
 * Takes the marshal flags ("flag:<colour>" sign faces) out of a list of pieces, to be built as
 * cloth here instead of printed faces. The pole is the thin post nearest each flag (raceDress puts
 * one next to every flag); the cloth hangs off the end of the face nearest it.
 */
export function takeRaceFlags(pieces: Piece[]): { rest: Piece[]; flags: FlagSpot[] } {
  const rest: Piece[] = [], flags: FlagSpot[] = [];
  const posts = pieces.filter((p): p is Extract<Piece, { kind: "box" }> => p.kind === "box" && p.length <= 0.2 && p.depth <= 0.2);
  for (const p of pieces) {
    const m = p.kind === "face" ? /^flag:(\w+)$/.exec(p.art) : null;
    const flag = m && (RACE_FLAGS as readonly string[]).includes(m[1]) ? (m[1] as RaceFlag) : null;
    if (!flag || p.kind !== "face") {
      rest.push(p);
      continue;
    }
    const width = p.height * RACE_FLAG_ASPECT;
    const r: Vec2 = [-p.normal[1], p.normal[0]];
    const ends: Vec2[] = [[p.at[0] - r[0] * width / 2, p.at[1] - r[1] * width / 2], [p.at[0] + r[0] * width / 2, p.at[1] + r[1] * width / 2]];
    let post: Vec2 | null = null, bd = width;
    for (const b of posts) {
      const d = Math.hypot(b.at[0] - p.at[0], b.at[1] - p.at[1]);
      if (d < bd) [bd, post] = [d, b.at];
    }
    const near = post ? (Math.hypot(ends[0][0] - post[0], ends[0][1] - post[1]) <= Math.hypot(ends[1][0] - post[0], ends[1][1] - post[1]) ? 0 : 1) : 0;
    const pole = ends[near], free = ends[1 - near];
    const l = Math.hypot(free[0] - pole[0], free[1] - pole[1]) || 1;
    flags.push({ pole, dir: [(free[0] - pole[0]) / l, (free[1] - pole[1]) / l], z0: p.z0, height: p.height, width, flag });
  }
  return { rest, flags };
}

/** The marshal flags as cloth: one mesh for the fronts, one for the vanilla backs. */
export function buildRaceFlags(flags: FlagSpot[]): Kn5MeshNode[] {
  if (!flags.length) return [];
  const front = new MeshBuilder(), back = new MeshBuilder();
  front.normals = []; back.normals = [];
  const rows = RACE_FLAGS.length, inset = 0.02;
  for (const f of flags) {
    const row = RACE_FLAGS.indexOf(f.flag);
    cloth(front, back, (u, v) => [f.pole[0] + f.dir[0] * f.width * u, f.pole[1] + f.dir[1] * f.width * u, f.z0 + f.height * (1 - v)], 6, 3,
      (u, v) => [u, (row + inset + v * (1 - 2 * inset)) / rows]);
  }
  return [front.toKn5("RACE_FLAGS", RACE_FLAG_MATERIAL), back.toKn5(`${FLAG_BACK_PREFIX}RACE_FLAGS`, RACE_FLAG_MATERIAL, { castShadows: false })];
}

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
