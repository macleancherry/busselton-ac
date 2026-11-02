// Busselton fork: the beach side of the sea (`beachDetail`, on unless false; only with photoSea).
//
// photoSea.ts already tones the beaches in the ground photos (dry sand lifted toward the South
// West's near-white, a darker wet band at the water) and puts a fine sand grain in the ground's
// detail layer. What a photo can't do is shine: wet sand at the water's edge is glossy. So:
//
// - Wet sand: a strip on the sand from the waterline `wetTo` metres up the beach, just above the
//   ground, alpha-blended and darker, with a strong, tight specular: the photo's wet band
//   underneath stays the colour, the strip adds the sheen. Its upper edge wanders like the photo's.
//   Only on sand: inside an OSM beach, or where the photo is sand-coloured (photoSea's `sandiness`,
//   as BeachLook decides it). Visual only (no digit prefix, so no physics), no shadows, no depth write.
// - It follows the same shore runs as the foam line (photoSea.ts `shoreRuns`), so foam, wet sand and
//   the photo's wet band all meet the water at one line, and stops 10 m from jetties as the foam does.
//
// CSP: the strip and the foam are listed as GrassFX occluders (cspConfig.ts), so no grass grows
// through the wet band. Nothing else is needed: the material's own specular gives the gloss.

import type { Vec2 } from "./geo";
import { BlendMode, DepthMode, type Kn5Material, type Kn5MeshNode } from "./kn5";
import { material } from "./materials";
import { encodePng } from "./png";
import { SEA_LEVEL, SeaMask, type CoastPolygon } from "./coast";
import { PHOTO_SEA, photoLookup, sandiness, shoreRuns, shoreStrip, type SeaPhoto } from "./photoSea";
import { rng, valueNoise } from "./textures";

export const BEACH_DETAIL = {
  /** The wet strip: from just out on the water (under the foam, so there's no gap)... */
  wetFrom: -0.3,
  /** ...to this far up the beach, metres (photoSea's wet band plus its wandering edge). */
  wetTo: PHOTO_SEA.wetBand + 1.5,
  /** Rows across the strip, so it follows the beach's slope (the terrain grid is 1.5 m in town). */
  rows: 4,
  /** Height above the ground, metres. */
  lift: 0.05,
  /** Strongest darkening at the water (alpha 0-1); fades to none at the top. */
  alpha: 0.3,
  /** The sand test: sample the photo this far up the beach, metres (past the wet band, where the sand is dry). */
  sandProbe: [3, 7, 11],
  /** Sand: an OSM beach, or the photo at least this sandy. */
  sandy: 0.45,
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

/** Wet sand, 8 m along by the strip across (v 0 at the water, 1 at the top): dark sand, alpha fading up the beach with a wandering edge and faint backwash streaks. RGBA PNG. */
export function wetSandTexture(cfg = BEACH_DETAIL): Uint8Array {
  const w = 256, h = 64;
  const edge = valueNoise(w, h, 10, 711), streak = valueNoise(w, h, 40, 712), grain = valueNoise(w, h, 128, 713);
  const r = rng(714);
  const px = new Uint8Array(w * h * 4);
  // Where the waterline sits across the strip (wetFrom is out on the water).
  const water = -cfg.wetFrom / (cfg.wetTo - cfg.wetFrom);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = (y + 0.5) / h;
    // Up the beach from the waterline, 0-1, the top edge wandering by a fifth of the strip.
    const t = (v - water) / (1 - water);
    const top = 0.62 + 0.3 * (edge[i] - 0.5);
    const fade = 1 - smooth((t - top * 0.55) / (top * 0.6));
    // Out over the water the strip fades in, so it never draws a line on the sea.
    const fadeIn = smooth((v + 0.02) / (water + 0.04));
    const a = clamp01(cfg.alpha * fade * fadeIn * (0.85 + 0.3 * (streak[i] - 0.5)));
    const k = 0.92 + 0.12 * (grain[i] - 0.5) + (r() - 0.5) * 0.04;
    px.set([120 * k, 110 * k, 94 * k, Math.round(a * 255)], i * 4);
  }
  return encodePng(px, w, h);
}

/** The wet sand's material: alpha-blended, no depth write, a tight bright highlight (the gloss). */
export function wetSandMaterial(): Kn5Material {
  return {
    ...material("shore_wet", "shore_wet.png", { ambient: 0.45, diffuse: 0.4, specular: 1.6, exp: 160 }),
    blendMode: BlendMode.AlphaBlend,
    depthMode: DepthMode.NoWrite,
  };
}

/** Whether the shore at a point is sand: in an OSM beach, or the photo sand-coloured a few metres up the beach. */
export function sandTest(beaches: CoastPolygon[], photos: SeaPhoto[], cfg = BEACH_DETAIL): (p: Vec2, out: Vec2) => boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of beaches) for (const [x, y] of b.rings[0] ?? []) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const pad = 20;
  const mask = beaches.length ? new SeaMask(beaches, minX - pad, minY - pad, maxX + pad, maxY + pad, 1) : null;
  const photo = photos.length ? photoLookup(photos) : null;
  return (p, out) => {
    for (const d of cfg.sandProbe) {
      const x = p[0] - out[0] * d, y = p[1] - out[1] * d;
      if (mask?.has(x, y)) return true;
      const c = photo?.at(x, y);
      if (c && sandiness(c[0], c[1], c[2]) >= cfg.sandy) return true;
    }
    return false;
  };
}

/**
 * The wet sand strip along the sandy shore: meshes SHORE_WET_<n>, from `wetFrom` (out on the water)
 * to `wetTo` up the beach, `lift` above the ground (never below the water).
 */
export function buildWetSand(
  ocean: CoastPolygon[],
  sea: SeaMask,
  piers: CoastPolygon[],
  ground: (x: number, y: number) => number,
  onSand: (p: Vec2, out: Vec2) => boolean,
  cfg = BEACH_DETAIL,
): Kn5MeshNode[] {
  // Split each shore run where the sand starts and stops (a run of 2+ sandy points).
  const runs = shoreRuns(ocean, sea, piers).flatMap((run) => {
    const parts: typeof run[] = [];
    let cur: typeof run = [];
    for (const q of run) {
      if (onSand(q.p, q.out)) cur.push(q);
      else {
        if (cur.length >= 2) parts.push(cur);
        cur = [];
      }
    }
    if (cur.length >= 2) parts.push(cur);
    return parts;
  });
  // Offsets are out from the waterline: negative is up the beach.
  const offsets = Array.from({ length: cfg.rows }, (_, i) => -(cfg.wetFrom + ((cfg.wetTo - cfg.wetFrom) * i) / (cfg.rows - 1)));
  const z = (x: number, y: number, d: number) => (d > 0 ? SEA_LEVEL : Math.max(ground(x, y), SEA_LEVEL)) + cfg.lift;
  return shoreStrip(runs, offsets, z, "SHORE_WET", "shore_wet");
}
