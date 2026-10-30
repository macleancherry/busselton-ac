// Busselton fork: W-beam ("Armco") guard rail on country roads, where Australian practice puts it
// (Austroads Guide to Road Design Part 6, AS/NZS 3845):
//   - the outside of bends taken well below the road's speed (curve speed from radius and side friction);
//   - fill embankments: a batter steeper than 1:3 more than a metre high, or a deep drop further out;
//   - bridges and culverts: the road on an OSM bridge, or a river, stream or canal (or a mapped
//     culvert on a drain) under it, with approach rail either side;
//   - wherever OSM maps barrier=guard_rail (railNeeds already does that one, and the deep drop-offs).
// Built as a W profile on steel posts with blockouts every 2 m, buried "fish-tail" ends, and a
// separate invisible collision wall (1WALL_ARMCO_*) so the visual mesh can stay cheap and culled.
// Turned on by the `armco` build option (on in the country preset, off for towns).

import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import type { Kn5MeshNode } from "./kn5";
import { MeshBuilder } from "./mesh";
import type { BuildOptions } from "./options";
import { surfaceHeight, type RoadPlan, type SegmentIndex } from "./road";
import { pad } from "./roadMesh";
import { box, ChunkedMesh } from "./scenery";

export type Needs = [boolean[], boolean[]];

/** Roads signed below this, km/h, get no bend rail (town streets). */
export const BEND_MIN_SPEED = 70;
/** A bend gets rail on its outside when its curve speed is this far under the road's speed, km/h. */
export const BEND_DROP = 20;
/** Rail runs on past each end of a bend (or a crossing) this far, metres: the approach and departure. */
export const APPROACH = 20;
/** Waterways that get rail where they cross under the road (any class does when mapped as a culvert, except ditches). */
const BIG_WATER = /^(river|canal|stream)$/;

/**
 * Desirable maximum side friction for cars by speed (Austroads, roughly): 0.35 at 40 km/h falling to
 * 0.11 at 120. Lower friction at speed is why fast roads need flatter bends.
 */
export function sideFriction(kmh: number): number {
  const table: [number, number][] = [[40, 0.35], [60, 0.27], [80, 0.19], [100, 0.13], [120, 0.11]];
  if (kmh <= table[0][0]) return table[0][1];
  for (let k = 1; k < table.length; k++) {
    const [v1, f1] = table[k], [v0, f0] = table[k - 1];
    if (kmh <= v1) return f0 + ((f1 - f0) * (kmh - v0)) / (v1 - v0);
  }
  return table[table.length - 1][1];
}

/** Comfortable speed round a bend of this radius (m) with this superelevation, km/h: V^2 = 127 R (e + f). */
export function curveSpeed(radius: number, superelevation = 0): number {
  if (!Number.isFinite(radius) || radius <= 0) return Infinity;
  // Friction falls with speed, so solve V = sqrt(127 R (e + f(V))) by bisection (the right side minus V only falls).
  const g = (v: number) => Math.sqrt(127 * radius * Math.max(0.05, superelevation + sideFriction(v))) - v;
  let lo = 0, hi = 250;
  if (g(hi) > 0) return hi;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (g(mid) > 0) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Rail on the outside of bends taken at least BEND_DROP under the speed limit, on roads of BEND_MIN_SPEED and up. */
export function bendNeeds(plan: RoadPlan, opts: BuildOptions, speedAt: (i: number) => number): Needs {
  const s = plan.samples, n = s.length;
  const needs: Needs = [new Array(n).fill(false), new Array(n).fill(false)];
  const half = Math.max(1, Math.round(10 / opts.spacing));
  const ext = Math.round(APPROACH / opts.spacing);
  for (let i = 0; i < n; i++) {
    const speed = speedAt(i);
    if (speed < BEND_MIN_SPEED) continue;
    // Curvature averaged over 20 m, so a kink in the line doesn't count as a bend.
    let k = 0, c = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++, c++) k += s[j].curvature;
    k /= c;
    if (Math.abs(k) < 1e-4) continue;
    // Banking toward the inside of the bend helps; tilt the wrong way (crown) is ignored.
    const e = Math.max(0, Math.sign(k) * -s[i].bank);
    if (speed - curveSpeed(1 / Math.abs(k), e) < BEND_DROP) continue;
    // Positive curvature turns left: the outside is the right (side 1).
    const side = k > 0 ? 1 : 0;
    for (let j = Math.max(0, i - ext); j <= Math.min(n - 1, i + ext); j++) needs[side][j] = true;
  }
  return needs;
}

/**
 * Fill embankments read off the ground beside the verge: a batter steeper than 1:3 that drops a metre
 * or more (sampled 2, 4 and 7 m out), or more than 1.8 m by 7 m out.
 */
export function embankmentNeeds(plan: RoadPlan, opts: BuildOptions, ground: HeightFn): Needs {
  const n = plan.samples.length;
  const needs: Needs = [new Array(n).fill(false), new Array(n).fill(false)];
  plan.samples.forEach((s, i) => {
    const half = s.width / 2;
    for (const side of [0, 1] as const) {
      const sign = side === 0 ? 1 : -1;
      const edge = surfaceHeight(s, sign * half, opts.crown);
      for (const d of [2, 4, 7]) {
        const t = sign * (half + opts.vergeWidth + d);
        const drop = edge - ground(s.pos[0] + s.left[0] * t, s.pos[1] + s.left[1] * t);
        if ((drop >= 1 && drop / (d + opts.vergeWidth) >= 1 / 3) || (d === 7 && drop > 1.8)) needs[side][i] = true;
      }
    }
  });
  return needs;
}

export interface Crossings {
  /** Bridge centrelines (OSM bridge=yes on a road), local metres. */
  bridges: Vec2[][];
  /** Waterways with their OpenMapTiles class (river, stream, canal, drain, ditch) and brunnel (tunnel = culvert). */
  waterways: { pts: Vec2[]; cls: string; brunnel?: string }[];
}

/** Walks a line at roughly `step` metres. */
function densify(pts: Vec2[], step: number, visit: (p: Vec2, dir: Vec2) => void): void {
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const dir: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const m = Math.max(1, Math.ceil(L / step));
    for (let j = 0; j <= m; j++) visit([a[0] + (b[0] - a[0]) * (j / m), a[1] + (b[1] - a[1]) * (j / m)], dir);
  }
}

/** Both sides along a bridge the route runs over, and over a waterway crossing under it, plus approach rail. */
export function crossingNeeds(plan: RoadPlan, opts: BuildOptions, index: SegmentIndex, crossings: Crossings): Needs {
  const s = plan.samples, n = s.length;
  const hit = new Array(n).fill(false);
  for (const line of crossings.bridges) {
    densify(line, 1, (p, dir) => {
      const near = index.nearest(p[0], p[1], 6);
      if (!near) return;
      const at = s[near.seg];
      // The route itself on the bridge: close to the centreline and running the same way (not a bridge over it).
      if (near.dist > Math.max(2, at.width / 2) || Math.abs(dir[0] * at.tan[0] + dir[1] * at.tan[1]) < 0.9) return;
      hit[near.seg] = true;
      if (near.seg + 1 < n) hit[near.seg + 1] = true;
    });
  }
  // A crossing waterway: a culvert or bridge span of about 6 m, centred where it passes under the road.
  const span = Math.max(1, Math.round(3 / opts.spacing));
  for (const w of crossings.waterways) {
    const big = BIG_WATER.test(w.cls) || (w.brunnel === "tunnel" && w.cls !== "ditch");
    if (!big) continue;
    densify(w.pts, 0.5, (p) => {
      const near = index.nearest(p[0], p[1], 20);
      if (!near || near.dist > s[near.seg].width / 2) return;
      for (let k = -span; k <= span; k++) {
        const i = near.seg + k;
        if (i >= 0 && i < n) hit[i] = true;
      }
    });
  }
  const ext = Math.round(APPROACH / opts.spacing);
  const out: Needs = [new Array(n).fill(false), new Array(n).fill(false)];
  for (let i = 0; i < n; i++) {
    if (!hit[i]) continue;
    for (let j = Math.max(0, i - ext); j <= Math.min(n - 1, i + ext); j++) out[0][j] = out[1][j] = true;
  }
  return out;
}

/** Bridges gaps under `gap` metres, then drops runs shorter than `minRun` metres (in place). */
export function tidyRuns(needs: Needs, spacing: number, gap = 10, minRun = 24): Needs {
  const g = Math.round(gap / spacing), m = Math.round(minRun / spacing);
  for (const need of needs) {
    const n = need.length;
    let last = -1;
    for (let i = 0; i < n; i++) {
      if (!need[i]) continue;
      if (last >= 0 && i - last > 1 && i - last <= g) for (let k = last; k < i; k++) need[k] = true;
      last = i;
    }
    for (let i = 0; i < n;) {
      if (!need[i]) { i++; continue; }
      let j = i;
      while (j < n && need[j]) j++;
      if (j - i < m) for (let k = i; k < j; k++) need[k] = false;
      i = j;
    }
  }
  return needs;
}

/** railNeeds (deep drop-offs, OSM guard rails) plus bends, embankments and crossings, tidied into runs. */
export function armcoNeeds(
  plan: RoadPlan,
  opts: BuildOptions,
  base: Needs,
  src: { ground: HeightFn; index: SegmentIndex; speedAt: (i: number) => number; crossings?: Crossings },
): Needs {
  const parts = [
    base,
    bendNeeds(plan, opts, src.speedAt),
    embankmentNeeds(plan, opts, src.ground),
    ...(src.crossings ? [crossingNeeds(plan, opts, src.index, src.crossings)] : []),
  ];
  const n = plan.samples.length;
  const out: Needs = [new Array(n).fill(false), new Array(n).fill(false)];
  for (const p of parts) for (const side of [0, 1] as const) for (let i = 0; i < n; i++) if (p[side][i]) out[side][i] = true;
  return tidyRuns(out, opts.spacing);
}

/* ---------------- the mesh ---------------- */

/**
 * W-beam profile: [offset toward the road from the beam's back, height above the verge], bottom to top.
 * A 310 mm beam, 83 mm deep, top at 730 mm (AS/NZS 3845).
 */
export const W_PROFILE: [number, number][] = [[0, 0.42], [0.083, 0.49], [0.03, 0.575], [0.083, 0.66], [0, 0.73]];
const BEAM_TOP = 0.73, BEAM_BOTTOM = 0.42;
/** Post spacing, metres (2 m in Australia). */
export const POST_SPACING = 2;
/** Length of each buried end, metres, and how far it flares away from the road. */
const END_LENGTH = 4, END_FLARE = 0.6;
/** Rail samples per visual mesh, to stay under the kn5 vertex limit. */
const MAX_RUN = 4000;

/**
 * Visual rails (ARMCO_L_000...), posts with blockouts (ARMCOPOSTS_000...) and invisible collision walls
 * (1WALL_ARMCO_L_000...). `rails` holds both the visual beams and the walls.
 */
export function buildArmco(plan: RoadPlan, opts: BuildOptions, needs: Needs): { rails: Kn5MeshNode[]; posts: Kn5MeshNode[] } {
  const s = plan.samples;
  const beams: Kn5MeshNode[] = [], walls: Kn5MeshNode[] = [];
  const posts = new ChunkedMesh(40);
  const postEvery = Math.max(1, Math.round(POST_SPACING / opts.spacing));
  for (const side of [0, 1] as const) {
    const sign = side === 0 ? 1 : -1;
    const tag = side === 0 ? "L" : "R";
    const need = needs[side];
    let run = 0;
    for (let i = 0; i < s.length;) {
      if (!need[i]) { i++; continue; }
      let j = i;
      while (j < s.length && need[j] && j - i < MAX_RUN) j++;
      if (j - i < 2) { i = j; continue; }
      // Rings along the run: [x, y] of the beam's front line, the outward unit vector, ground z.
      const rings: { p: Vec2; out: Vec2; z: number; u: number; drop: number }[] = [];
      for (let k = i; k < j; k++) {
        const q = s[k];
        const half = q.width / 2;
        const t = sign * (half + opts.vergeWidth * 0.55);
        rings.push({
          p: [q.pos[0] + q.left[0] * t, q.pos[1] + q.left[1] * t],
          out: [q.left[0] * sign, q.left[1] * sign],
          z: surfaceHeight(q, sign * half, opts.crown) - 0.2 * 0.55,
          u: q.s / 4,
          drop: 0,
        });
      }
      // Buried ends: the beam turns away from the road and down into the ground.
      const endRings = (r: (typeof rings)[number], dir: Vec2, du: 1 | -1) =>
        [0.5, 1].map((f) => ({
          p: [r.p[0] + dir[0] * END_LENGTH * f + r.out[0] * END_FLARE * f, r.p[1] + dir[1] * END_LENGTH * f + r.out[1] * END_FLARE * f] as Vec2,
          out: r.out,
          z: r.z,
          u: r.u + (du * END_LENGTH * f) / 4,
          drop: (BEAM_TOP + 0.05) * f,
        }));
      const first = s[i], last = s[j - 1];
      const all = [
        ...endRings(rings[0], [-first.tan[0], -first.tan[1]], -1).reverse(),
        ...rings,
        ...endRings(rings[rings.length - 1], last.tan, 1),
      ];
      beams.push(beamMesh(all, sign).toKn5(`ARMCO_${tag}_${pad(run)}`, "rail", { castShadows: true }));
      walls.push(wallMesh(rings, sign).toKn5(`1WALL_ARMCO_${tag}_${pad(run)}`, "wall", { renderable: false, castShadows: false }));
      run++;
      for (let k = 0; k < rings.length; k += postEvery) {
        const r = rings[k], q = s[i + k];
        const P = W_PROFILE[1][0];
        // Blockout between beam and post, then the post (C-section read as a box) behind it.
        const blk: Vec2 = [r.p[0] + r.out[0] * (P + 0.075), r.p[1] + r.out[1] * (P + 0.075)];
        box(posts.next(), blk, q.tan, 0.1, 0.15, r.z + BEAM_BOTTOM + 0.04, r.z + BEAM_TOP - 0.04);
        const post: Vec2 = [r.p[0] + r.out[0] * (P + 0.2), r.p[1] + r.out[1] * (P + 0.2)];
        box(posts.next(), post, q.tan, 0.15, 0.1, r.z - 0.5, r.z + BEAM_TOP - 0.03);
      }
      i = j;
    }
  }
  return { rails: [...beams, ...walls], posts: posts.all().map((m, i) => m.toKn5(`ARMCOPOSTS_${pad(i)}`, "steel")) };
}

/** The W profile swept along the rings, a road-facing and a back face. */
function beamMesh(rings: { p: Vec2; out: Vec2; z: number; u: number; drop: number }[], sign: 1 | -1): MeshBuilder {
  const mb = new MeshBuilder();
  const np = W_PROFILE.length;
  const apex = W_PROFILE[1][0];
  for (const face of [0, 1]) {
    const base = mb.vertexCount;
    for (const r of rings) {
      for (const [o, h] of W_PROFILE) {
        // Offset measured from the beam's back; the front apex sits on the ring's line. The back face sits 4 mm behind.
        const back = apex - o + (face ? 0.004 : 0);
        mb.vertex([r.p[0] + r.out[0] * back, r.p[1] + r.out[1] * back, r.z + h - r.drop], r.u, (BEAM_TOP - h) / (BEAM_TOP - BEAM_BOTTOM));
      }
    }
    for (let k = 0; k + 1 < rings.length; k++) {
      for (let j = 0; j + 1 < np; j++) {
        const A = base + k * np + j, B = A + np, C = B + 1, D = A + 1;
        // A,B,C,D faces right of travel: the road side of a left rail; the back of a right rail.
        const facesRight = (sign > 0) === (face === 0);
        if (facesRight) mb.quad(A, B, C, D);
        else mb.quad(A, D, C, B);
      }
    }
  }
  return mb;
}

/** Invisible collision wall on the beam's front line, from below the verge to above the beam. */
function wallMesh(rings: { p: Vec2; z: number }[], sign: 1 | -1): MeshBuilder {
  const mb = new MeshBuilder();
  for (const r of rings) {
    mb.vertex([r.p[0], r.p[1], r.z - 0.3], 0, 1);
    mb.vertex([r.p[0], r.p[1], r.z + 0.9], 0, 0);
  }
  for (let k = 0; k + 1 < rings.length; k++) {
    const a = k * 2, b = a + 2;
    if (sign > 0) mb.quad(a, b, b + 1, a + 1);
    else mb.quad(a, a + 1, b + 1, b);
  }
  return mb;
}
