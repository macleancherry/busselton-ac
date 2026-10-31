// The horizon ground: a coarse, visual-only ground out to `horizon` metres from what's built, held
// a few metres under the detailed terrain near the corridor and rising to the real height further
// out. Buildings, tree lines and shore works beyond the base stand on it (backdropSurface).
// Written fresh from docs/specs/backdrop.md.

import type { Area, Cover } from "./area";
import type { HeightFn } from "./elevation";
import type { Kn5MeshNode } from "./kn5";
import { MeshBuilder } from "./mesh";
import type { BuildOptions } from "./options";
import type { RoadPlan, SegmentIndex } from "./road";
import type { TerrainChunk } from "./terrain";

/** Horizon chunk side, metres (track.ts grows the far DEM's box by horizon + this). */
export const BACKDROP_CHUNK = 1000;
/** Grid spacing; a whole number of steps per chunk, so nodes sit on multiples of 20 m everywhere. */
const STEP = 20;
/** How far under the ground the horizon sits near the corridor. */
const SINK = 3;
/** Distance past the corridor over which the far DEM's sink eases out. */
const RISE = 300;
/** How far past the corridor the horizon is still held under the detailed terrain. */
const UNDER_REACH = 60;
/** That limit rises 1 in 10 past the corridor. */
const UNDER_SLOPE = 0.1;
/** Past the corridor, the hold starts easing out here (it's gone by UNDER_REACH). */
const FADE_FROM = 20;
/** The hole in the horizon starts this far inside the corridor. */
const HOLE_IN = 2 * STEP;

const smoothstep = (x: number) => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

export function planBackdrop(plan: RoadPlan, index: SegmentIndex, opts: BuildOptions, area: Area | null = null): TerrainChunk[] {
  if (opts.horizon <= 0) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of plan.samples) {
    minX = Math.min(minX, s.pos[0]); maxX = Math.max(maxX, s.pos[0]);
    minY = Math.min(minY, s.pos[1]); maxY = Math.max(maxY, s.pos[1]);
  }
  if (area) {
    minX = Math.min(minX, area.minX); maxX = Math.max(maxX, area.maxX);
    minY = Math.min(minY, area.minY); maxY = Math.max(maxY, area.maxY);
  }
  if (!Number.isFinite(minX)) return [];
  const size = BACKDROP_CHUNK, pad = opts.horizon, reach = opts.horizon + 0.71 * size;
  const out: TerrainChunk[] = [];
  for (let j = Math.floor((minY - pad) / size); j <= Math.floor((maxY + pad) / size); j++) {
    for (let i = Math.floor((minX - pad) / size); i <= Math.floor((maxX + pad) / size); i++) {
      const cx = (i + 0.5) * size, cy = (j + 0.5) * size;
      const keep = index.nearest(cx, cy, reach) !== null || (area !== null && area.signed(cx, cy) < reach);
      if (!keep) continue;
      out.push({ key: "b" + String(out.length).padStart(3, "0"), minX: i * size, minY: j * size, maxX: (i + 1) * size, maxY: (j + 1) * size });
    }
  }
  return out;
}

/** Distance from what's built: the build's cover when given, else the route distance. */
function distanceFn(index: SegmentIndex, opts: BuildOptions, cover?: Cover): (x: number, y: number) => number {
  if (cover) return cover;
  return (x, y) => index.nearest(x, y, opts.corridor + RISE)?.dist ?? Infinity;
}

function heightAt(dem: HeightFn, opts: BuildOptions, d: number, x: number, y: number, terrain?: HeightFn): number {
  const h = dem(x, y) - SINK * (1 - smoothstep((d - opts.corridor) / RISE));
  if (!terrain || d > opts.corridor + UNDER_REACH) return h;
  const past = Math.max(0, d - opts.corridor);
  const held = Math.min(h, terrain(x, y) - SINK + UNDER_SLOPE * past);
  // Held under the detailed terrain to FADE_FROM past the corridor, then eased out to the plain
  // height by UNDER_REACH, so the horizon doesn't step up where the limit ends. An ease-in (t²)
  // over 40 m: the steepest of the shapes tried was a 20 m smoothstep (0.24 m per metre with the
  // far DEM 7 m over the ground); this keeps it under 0.16.
  const t = Math.min(1, Math.max(0, (past - FADE_FROM) / (UNDER_REACH - FADE_FROM)));
  return held + (h - held) * t * t;
}

/** Horizon height at a point (see the spec): the far DEM, sunk near the corridor, held under the detailed terrain. */
export function backdropHeight(dem: HeightFn, index: SegmentIndex, opts: BuildOptions, x: number, y: number, cover?: Cover, terrain?: HeightFn): number {
  return heightAt(dem, opts, distanceFn(index, opts, cover)(x, y), x, y, terrain);
}

export function buildBackdropChunk(
  chunk: TerrainChunk,
  dem: HeightFn,
  index: SegmentIndex,
  opts: BuildOptions,
  textured: boolean,
  cover?: Cover,
  terrain?: HeightFn,
): Kn5MeshNode | null {
  const cells = Math.max(1, Math.round((chunk.maxX - chunk.minX) / STEP));
  const step = (chunk.maxX - chunk.minX) / cells;
  const dOf = distanceFn(index, opts, cover);
  const hole = Math.max(0, opts.corridor - HOLE_IN);
  const N = cells + 1, P = cells + 3;
  const ph = new Float64Array(P * P);
  const kept = new Uint8Array(N * N);
  for (let pj = 0; pj < P; pj++) {
    for (let pi = 0; pi < P; pi++) {
      const i = pi - 1, j = pj - 1;
      const x = chunk.minX + i * step, y = chunk.minY + j * step;
      const d = dOf(x, y);
      ph[pj * P + pi] = heightAt(dem, opts, d, x, y, terrain);
      if (i >= 0 && j >= 0 && i <= cells && j <= cells) kept[j * N + i] = hole === 0 || d > hole ? 1 : 0;
    }
  }
  const H = (i: number, j: number) => ph[(j + 1) * P + (i + 1)];
  const mb = new MeshBuilder();
  const normals: number[] = [];
  const vid = new Int32Array(N * N).fill(-1);
  const v = (i: number, j: number) => {
    const n = j * N + i;
    if (vid[n] >= 0) return vid[n];
    const x = chunk.minX + i * step, y = chunk.minY + j * step;
    const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * step), dy = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
    const l = Math.hypot(dx, dy, 1);
    normals.push(-dx / l, -dy / l, 1 / l);
    vid[n] = textured ? mb.vertex([x, y, H(i, j)], i / cells, 1 - j / cells) : mb.vertex([x, y, H(i, j)], x / 40, -y / 40);
    return vid[n];
  };
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      if (!kept[j * N + i] || !kept[j * N + i + 1] || !kept[(j + 1) * N + i] || !kept[(j + 1) * N + i + 1]) continue;
      // Split along (i, j)-(i+1, j+1): backdropSurface reads the same triangles.
      mb.quad(v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1));
    }
  }
  if (!mb.indices.length) return null;
  mb.normals = normals;
  return mb.toKn5(`BACKDROP_${chunk.key}`, textured ? `backdrop_${chunk.key}` : "grass", { castShadows: false });
}

/**
 * The horizon mesh's height as drawn at a point: the plane of the grid triangle it falls in (nodes
 * every 20 m from the origin, split along (0,0)-(1,1)), whether or not a chunk covers it.
 */
export function backdropSurface(dem: HeightFn, index: SegmentIndex, opts: BuildOptions, cover?: Cover, terrain?: HeightFn): (x: number, y: number) => number {
  const dOf = distanceFn(index, opts, cover);
  const cache = new Map<number, number>();
  const node = (i: number, j: number) => {
    const k = (i + 2_000_000) * 4_000_000 + (j + 2_000_000);
    let h = cache.get(k);
    if (h === undefined) {
      if (cache.size > 200_000) cache.clear();
      const x = i * STEP, y = j * STEP;
      h = heightAt(dem, opts, dOf(x, y), x, y, terrain);
      cache.set(k, h);
    }
    return h;
  };
  return (x, y) => {
    const fx = x / STEP, fy = y / STEP;
    const i = Math.floor(fx), j = Math.floor(fy);
    const u = fx - i, w = fy - j;
    const h00 = node(i, j), h11 = node(i + 1, j + 1);
    return u >= w ? h00 + u * (node(i + 1, j) - h00) + w * (h11 - node(i + 1, j)) : h00 + u * (h11 - node(i, j + 1)) + w * (node(i, j + 1) - h00);
  };
}
