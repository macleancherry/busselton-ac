// Busselton fork: unsealed roads (ROADMAP.md phase C). Roads OSM tags unpaved, gravel, compacted,
// dirt and the like (and tracks with no surface tag) are built as limestone gravel: their own physics
// surface (less grip, a little rolling resistance, corrugations, dust under CSP), a pale gravel
// texture, and no line markings or kerbs. A route can be forced unsealed end to end
// (BuildOptions.unsealed) for Boranup-style forest drives OSM doesn't tag.
//
// Physics keys: AC finds a mesh's surface by the keys its name contains, its built-in ones too
// (ROAD, GRASS, KERB, SAND, GRAVEL, DIRT...), so neither key contains another key: the route's
// gravel is 1UNSEALED_..., a gravel side street 1UNPAVED_...

import { encodeDdsDxt1 } from "./dds";
import type { Vec2 } from "./geo";
import type { RoadPlan } from "./road";
import { rng, SEAL_LENGTH, valueNoise } from "./textures";

/** surfaces.ini key for the route where it's unsealed (valid track). */
export const UNSEALED_KEY = "UNSEALED";
/** surfaces.ini key for unsealed side streets (off the route unless streets are valid track). */
export const UNPAVED_KEY = "UNPAVED";
/** Material name prefix for gravel road surfaces. It starts with road_ so CSP's road_? rules (puddles, no grass through it) cover it. */
export const GRAVEL_MATERIAL = "road_gravel";

/** OSM surface=* values that mean no seal. */
const UNSEALED_VALUES = new Set([
  "unpaved", "gravel", "fine_gravel", "compacted", "dirt", "earth", "ground", "mud", "sand", "pebblestone", "rock", "limestone", "laterite", "shells", "woodchips",
]);

/**
 * Whether a road is unsealed from its OSM surface tag (or the vector tiles' "paved"/"unpaved"), its
 * highway class, and its tracktype: a track with no surface tag counts as unsealed unless it's
 * tracktype=grade1 (sealed or solid).
 */
export function isUnsealed(surface?: string, highway?: string, tracktype?: string): boolean {
  if (surface) return surface.split(";").some((s) => UNSEALED_VALUES.has(s.trim().toLowerCase()));
  return highway === "track" && tracktype !== "grade1";
}

/** Mesh name prefix (with the digit) for a road mesh with material `material`: gravel or not, route or side street. */
export function surfaceKeyFor(material: string, route: boolean): string | undefined {
  if (!material.startsWith(GRAVEL_MATERIAL)) return undefined;
  return route ? UNSEALED_KEY : UNPAVED_KEY;
}

/**
 * The two gravel surfaces for data/surfaces.ini, in its own key order. A firm, graded limestone road:
 * about 80% of the bitumen's grip, a touch of rolling resistance, low corrugations through the wheel
 * and seat, gravel noise. The _EXT_ keys are Custom Shaders Patch's (acc-extension-config wiki,
 * "Tracks - Surface tweaks"): SurfacesFX treats it as firm gravel (dust and stones thrown up), and the
 * bumps are Perlin noise rather than a regular sine. Plain AC ignores them.
 */
export function unsealedSurfaces(streetsValid: boolean): Record<string, string | number>[] {
  const gravel = (key: string, valid: boolean) => ({
    KEY: key, FRICTION: 0.8, DAMPING: 0.02, WAV: "gravel.wav", WAV_PITCH: 0, FF_EFFECT: "NULL",
    DIRT_ADDITIVE: 0.5, IS_VALID_TRACK: valid ? 1 : 0, BLACK_FLAG_TIME: 0, SIN_HEIGHT: 0.012, SIN_LENGTH: 0.7,
    IS_PITLANE: 0, VIBRATION_GAIN: 0.35, VIBRATION_LENGTH: 0.5,
    _EXT_SURFACE_TYPE: "GRAVEL", _EXT_SURFACE_TYPE_MODIFIER: "FIRM", _EXT_PERLIN_NOISE: 1, _EXT_PERLIN_OCTAVES: 3, _EXT_PERLIN_PERSISTENCE: 0.5,
  });
  return [gravel(UNSEALED_KEY, true), gravel(UNPAVED_KEY, streetsValid)];
}

/**
 * Which route samples are unsealed (1) or sealed (0). `lines` are unsealed roads (local metres): a
 * sample is unsealed where one runs along it (within half the road's width plus 3 m, and within
 * about 30 degrees of its direction, so a gravel road crossing or meeting the route doesn't count).
 * Gaps shorter than 25 m are filled and stretches shorter than 30 m dropped, so the surface doesn't
 * flicker at junctions. `force` makes the whole route unsealed.
 */
export function unsealedSamples(plan: RoadPlan, lines: Vec2[][], force = false): Uint8Array {
  const n = plan.samples.length;
  const out = new Uint8Array(n);
  if (force) return out.fill(1);
  if (!lines.length || !n) return out;
  const CELL = 25;
  const cells = new Map<string, [Vec2, Vec2][]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  for (const l of lines) {
    for (let i = 1; i < l.length; i++) {
      const a = l[i - 1], b = l[i];
      const x0 = Math.floor(Math.min(a[0], b[0]) / CELL), x1 = Math.floor(Math.max(a[0], b[0]) / CELL);
      const y0 = Math.floor(Math.min(a[1], b[1]) / CELL), y1 = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k)!.push([a, b]);
      }
    }
  }
  plan.samples.forEach((s, i) => {
    const reach = s.width / 2 + 3;
    const cx = Math.floor(s.pos[0] / CELL), cy = Math.floor(s.pos[1] / CELL);
    for (let dx = -1; dx <= 1 && !out[i]; dx++) for (let dy = -1; dy <= 1 && !out[i]; dy++) {
      for (const [a, b] of cells.get(key(cx + dx, cy + dy)) ?? []) {
        const ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey);
        if (L < 1e-6) continue;
        if (Math.abs((ex * s.tan[0] + ey * s.tan[1]) / L) < 0.85) continue;
        const t = Math.max(0, Math.min(1, ((s.pos[0] - a[0]) * ex + (s.pos[1] - a[1]) * ey) / (L * L)));
        if (Math.hypot(a[0] + ex * t - s.pos[0], a[1] + ey * t - s.pos[1]) <= reach) {
          out[i] = 1;
          break;
        }
      }
    }
  });
  const s = (i: number) => plan.samples[i].s;
  const runs = (v: number) => {
    const list: [number, number][] = [];
    for (let i = 0; i < n;) {
      if (out[i] !== v) { i++; continue; }
      let j = i;
      while (j + 1 < n && out[j + 1] === v) j++;
      list.push([i, j]);
      i = j + 1;
    }
    return list;
  };
  // Short gaps between gravel (not at the ends of the road) are gravel too; then short gravel goes.
  for (const [a, b] of runs(0)) if (a > 0 && b < n - 1 && s(b + 1) - s(a - 1) < 25) out.fill(1, a, b + 1);
  for (const [a, b] of runs(1)) if (s(b) - s(a) < 30 && !(a === 0 && b === n - 1)) out.fill(0, a, b + 1);
  return out;
}

/**
 * A graded limestone gravel road across its full width (u 0..1, left to right) and SEAL_LENGTH
 * metres along (v), tiling along the road, in the seal textures' layout (textures.ts sealTexture):
 * pale cream and buff fines with scattered stones, darker compacted wheel tracks, loose gravel
 * windrowed down the middle and along the edges, and the odd shallow pothole. RGBA 512 x 1024, as
 * DXT1 plus the raw pixels for the preview.
 */
export function gravelTexture(twoLane: boolean, variant: number): { dds: Uint8Array; rgba: Uint8Array; width: number; height: number } {
  const w = 512, h = 1024;
  const seed = 700 + variant * 17 + (twoLane ? 5 : 0);
  const r = rng(seed);
  const coarse = valueNoise(w, h, 5, seed + 1), mid = valueNoise(w, h, 40, seed + 2), fine = valueNoise(w, h, 150, seed + 3);
  const lanes = twoLane ? [0.25, 0.75] : [0.5];
  const laneW = twoLane ? 0.5 : 1;
  // Wheel tracks: two per lane, ~0.8 m either side of each lane's centre, wandering a little.
  const wheel = (u: number, v: number) => {
    let best = 0;
    const wander = Math.sin(v * Math.PI * 2 * 2 + variant) * 0.012;
    for (const c of lanes) for (const o of [-0.25, 0.25]) {
      best = Math.max(best, 1 - Math.min(1, Math.abs(u - (c + o * laneW + wander)) / (0.1 * laneW)));
    }
    return best * best * (3 - 2 * best);
  };
  // Loose gravel: the crown between the wheel tracks of each lane, the centre and the edges.
  const loose = (u: number) => {
    const edge = Math.max(0, 1 - Math.min(u, 1 - u) / 0.08);
    let crown = 0;
    for (const c of lanes) crown = Math.max(crown, 1 - Math.min(1, Math.abs(u - c) / (0.08 * laneW)));
    const centre = twoLane ? Math.max(0, 1 - Math.abs(u - 0.5) / 0.05) : 0;
    return Math.min(1, edge + crown * 0.6 + centre * 0.8);
  };
  const fines: [number, number, number] = [206, 192, 162];
  const stones: [number, number, number][] = [[232, 226, 210], [188, 170, 136], [150, 132, 104], [214, 200, 172], [170, 120, 80]];
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, u = x / w;
      const wp = wheel(u, v), lo = loose(u);
      // Fines: compacted darker and a touch browner in the wheel tracks.
      const k = 0.9 + (coarse[i] - 0.5) * 0.22 + (mid[i] - 0.5) * 0.14 + (fine[i] - 0.5) * 0.12 - wp * 0.12;
      let c: [number, number, number] = [fines[0] * k, fines[1] * k - wp * 4, fines[2] * k - wp * 8];
      // Stones: denser where the gravel is loose, few in the packed wheel tracks.
      if (r() < 0.05 + lo * 0.25 - wp * 0.04) {
        const st = stones[Math.floor(r() * stones.length)];
        const sk = 0.85 + r() * 0.25;
        c = [st[0] * sk, st[1] * sk, st[2] * sk];
      }
      px.set([c[0], c[1], c[2], 255].map((q) => Math.max(0, Math.min(255, q))), i * 4);
    }
  }
  const shade = (x: number, y: number, f: (c: number, k: number) => number) => {
    const xx = Math.max(0, Math.min(w - 1, Math.floor(x)));
    const yy = ((Math.floor(y) % h) + h) % h; // wrap along the road
    const i = (yy * w + xx) * 4;
    for (let k = 0; k < 3; k++) px[i + k] = Math.max(0, Math.min(255, f(px[i + k], k)));
  };
  // Potholes: shallow and darker, wet-looking brown, a lighter rim of kicked-out stones, in the wheel tracks.
  const holes = 2 + Math.floor(r() * 4);
  for (let p = 0; p < holes; p++) {
    const lane = lanes[Math.floor(r() * lanes.length)];
    const cu = (lane + (r() < 0.5 ? -0.25 : 0.25) * laneW) * w, cv = r() * h;
    const ru = (0.02 + r() * 0.03) * w, rv = ((0.25 + r() * 0.4) / SEAL_LENGTH) * h;
    for (let dy = -rv * 1.4; dy <= rv * 1.4; dy++) for (let dx = -ru * 1.4; dx <= ru * 1.4; dx++) {
      const d = Math.hypot(dx / ru, dy / rv) + (r() - 0.5) * 0.15;
      if (d < 1) shade(cu + dx, cv + dy, (c, k) => c * (0.6 + d * 0.25) - (k === 2 ? 10 : 0));
      else if (d < 1.35) shade(cu + dx, cv + dy, (c) => c * 1.06);
    }
  }
  return { dds: encodeDdsDxt1(px, w, h), rgba: px, width: w, height: h };
}
