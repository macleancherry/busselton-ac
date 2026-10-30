// Busselton fork: the sea and the beaches from the aerial photo (`photoSea`, on unless false).
//
// Geographe Bay goes from turquoise over the sand to deep blue further out, with dark patches of
// seagrass and reef, and the beaches are near-white. As one flat CSP water colour it lost all of
// that. So:
//
// - A photo layer just under the water: the aerial photo of the bay (the shallows, sand bars and
//   weed patches) on a flat mesh 0.4 m below the surface. Past the photos' edge, the photo's own
//   typical colour at that distance from the shore (turquoise shallows, then darker), with patchy
//   weed beds; deep blue far out (`deep`: the photo's own deep water where it has some). Jetties
//   are painted out of it (their deck and shadow are in the photo). Sharp (about 1 m a pixel) in
//   500 m tiles where the drive's own photos are, about 4 m a pixel elsewhere.
// - The water surface on top stays CSP's water (reflections, waves, caustics) but partly
//   transparent, so the photo layer shows through: `[Material_Water]` with UseAlphaFromDiffuse
//   and DepthAware on a transparent mesh, as CSP's own config for ks_laguna_seca does (CSP wiki,
//   Tracks - Water shader; `[TEMPLATE: Material_Water]` in common/materials_track.ini: "DepthAware:
//   use depth buffer for refraction and caustics (for it to work you need to set alpha from
//   txDiffuse and set mesh transparent flag)"). Whether smWaterSurface also tints by txDiffuse's
//   colour isn't documented; its alpha is, and that's all this relies on. The surface keeps its
//   24 m tiling UVs, so CSP's wave normals look as they did. Without CSP, the same surface is a
//   glossy, half-clear tint over the photo.
// - Beaches: the photo's sand inside OSM beaches (and sand-coloured photo right at the water)
//   brightened toward the real near-white, wet and darker in a band at the water's edge, with a
//   fine sand grain as the ground detail up close, and a thin foam line on the water along the
//   shore.

import earcut from "earcut";
import type { Vec2 } from "./geo";
import { BlendMode, DepthMode, type Kn5Material, type Kn5MeshNode, type Kn5Texture } from "./kn5";
import { MeshBuilder } from "./mesh";
import { material } from "./materials";
import { encodeDdsDxt1 } from "./dds";
import { encodePng } from "./png";
import { SEA_LEVEL, SeaMask, type CoastPolygon } from "./coast";
import { fill, rng, valueNoise } from "./textures";

export type Rgb = [number, number, number];

export const PHOTO_SEA = {
  /** The water surface's opacity over the photo layer (0 clear, 1 the CSP water colour only). To tune in game. */
  surfaceAlpha: 0.42,
  /** The photo layer's depth under the water surface, metres. */
  layerDepth: 0.4,
  /** Blend to `deep` from this far out from the shore, metres... */
  deepFrom: 1500,
  /** ...all deep by here. */
  deepTo: 4000,
  /** Blend from the photo to the colour by distance (its own, by distance from the shore) over this distance inside the photos' edge, metres. */
  feather: 500,
  /** Jetties painted out of the photo layer: their footprint plus this, metres (the deck's shadow). */
  pierPad: 8,
  /** Sharp tiles: this size, metres, at `nearRes` pixels, where there's a photo finer than `nearPhoto` m a pixel. */
  nearTile: 500,
  nearRes: 512,
  nearPhoto: 1.2,
  /** The whole bay: at least this many metres a pixel, at most `farMax` pixels across. */
  farCell: 4,
  farMax: 4096,
  /** Deep water when the photo has none of its own: Geographe Bay a few km out. */
  deep: [22, 70, 104] as Rgb,
  /** Dry sand, sRGB: Busselton's near-white quartz sand. */
  sand: [243, 239, 228] as Rgb,
  /** Wet sand: this far up the beach from the water, metres. */
  wetBand: 5,
  /** Sand-coloured photo counts as beach this close to the sea even outside an OSM beach, metres. */
  shoreSand: 25,
  /** Foam line: from this far up the sand to this far out on the water, metres. */
  foamIn: 0.3,
  foamOut: 1.7,
  /** Sand grain detail: one tile covers this many metres. */
  sandTile: 1.5,
};

/** Four samples a quarter-texel in from each corner. */
const QUAD: [number, number][] = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

/* ---------------- the photos ---------------- */

/** An aerial photo of a square of ground (top row first), as the build fetched it. */
export interface SeaPhoto {
  chunk: { minX: number; minY: number; maxX: number; maxY: number };
  rgba: Uint8Array | Uint8ClampedArray;
  size: number;
}

/** Colour (0-255) at a point from the sharpest photo there (bilinear), or null outside every photo. */
export function photoLookup(photos: SeaPhoto[]): { at: (x: number, y: number) => Rgb | null; mpp: (x: number, y: number) => number } {
  // A grid of squares per chunk size, sharpest (fewest metres a pixel) first.
  const bySpan = new Map<number, { span: number; mpp: number; g: Map<number, SeaPhoto> }>();
  const cellKey = (i: number, j: number) => (i + 50000) * 100000 + (j + 50000);
  for (const p of photos) {
    const span = p.chunk.maxX - p.chunk.minX;
    const e = bySpan.get(span) ?? { span, mpp: span / p.size, g: new Map<number, SeaPhoto>() };
    e.mpp = Math.min(e.mpp, span / p.size);
    e.g.set(cellKey(Math.round(p.chunk.minX / span), Math.round(p.chunk.minY / span)), p);
    bySpan.set(span, e);
  }
  const grids = [...bySpan.values()].sort((a, b) => a.mpp - b.mpp);
  const find = (x: number, y: number) => {
    for (const { span, g } of grids) {
      const p = g.get(cellKey(Math.floor(x / span), Math.floor(y / span)));
      if (p) return p;
    }
    return null;
  };
  return {
    at: (x, y) => {
      const p = find(x, y);
      if (!p) return null;
      const { chunk, rgba, size } = p;
      const span = chunk.maxX - chunk.minX;
      const fx = Math.max(0, Math.min(size - 1.001, ((x - chunk.minX) / span) * size - 0.5));
      const fy = Math.max(0, Math.min(size - 1.001, ((chunk.maxY - y) / span) * size - 0.5));
      const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const out: Rgb = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const a = rgba[(iy * size + ix) * 4 + k], b = rgba[(iy * size + ix + 1) * 4 + k];
        const c = rgba[((iy + 1) * size + ix) * 4 + k], d = rgba[((iy + 1) * size + ix + 1) * 4 + k];
        out[k] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      }
      return out;
    },
    mpp: (x, y) => {
      const p = find(x, y);
      return p ? (p.chunk.maxX - p.chunk.minX) / p.size : Infinity;
    },
  };
}

/* ---------------- distance fields ---------------- */

/** Distance (in cells) from each cell to the nearest source cell (8-neighbour chamfer, 1 and √2). */
export function distanceField(source: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  const BIG = 1e9, D = Math.SQRT2;
  for (let i = 0; i < w * h; i++) d[i] = source[i] ? 0 : BIG;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + D);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + D);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + D);
        if (x > 0) v = Math.min(v, d[i + w - 1] + D);
      }
      d[i] = v;
    }
  }
  return d;
}

/** A raster over local metres, row 0 at the top (maxY), like a photo. */
export class Grid {
  readonly w: number;
  readonly h: number;
  constructor(readonly x0: number, readonly yTop: number, readonly cell: number, w: number, h: number) {
    this.w = w;
    this.h = h;
  }
  /** The cell's centre. */
  x(i: number) { return this.x0 + (i + 0.5) * this.cell; }
  y(j: number) { return this.yTop - (j + 0.5) * this.cell; }
  /** Bilinear sample of a per-cell field (clamped at the edges). */
  sample(f: Float32Array, x: number, y: number): number {
    const fx = Math.max(0, Math.min(this.w - 1.001, (x - this.x0) / this.cell - 0.5));
    const fy = Math.max(0, Math.min(this.h - 1.001, (this.yTop - y) / this.cell - 0.5));
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const i = iy * this.w + ix;
    return (f[i] * (1 - tx) + f[i + 1] * tx) * (1 - ty) + (f[i + this.w] * (1 - tx) + f[i + this.w + 1] * tx) * ty;
  }
  index(x: number, y: number): number {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((this.yTop - y) / this.cell);
    return i >= 0 && j >= 0 && i < this.w && j < this.h ? j * this.w + i : -1;
  }
}

/* ---------------- the photo layer ---------------- */

export interface SeaField {
  grid: Grid;
  /** Distance out from the shore, metres (0 on land). */
  shore: Float32Array;
  /** Distance in from the edge of the photos, metres (0 where there's no photo). */
  cover: Float32Array;
  /** Distance from a jetty, metres. */
  pier: Float32Array;
  /** Distance to the sea, metres (0 in it). */
  toSea: Float32Array;
  /** The photo's colour per cell, jetties filled in from round them (r, g, b per cell). */
  colour: Float32Array;
  /** The deep-water colour. */
  deep: Rgb;
  /** The photo's typical colour by distance from the shore (`PROFILE_BANDS`), for sea it doesn't cover. */
  profile: Rgb[];
}

/** Distance bands from the shore, metres, for the colour profile. */
export const PROFILE_BANDS = [0, 40, 120, 250, 500, 1000, 2000, 4000];
/** The profile with no photo at all: sand-bottomed turquoise to Geographe Bay blue. */
const DEFAULT_PROFILE: Rgb[] = [[96, 196, 188], [70, 178, 176], [44, 140, 150], [30, 104, 124], [24, 84, 112], [22, 74, 106], [22, 70, 104]];

/** Smooth value noise in world metres (seeded hash lattice), 0-1: patchy weed beds where there's no photo. */
function hash2(i: number, j: number): number {
  let s = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  s = Math.imul(s ^ (s >>> 13), 1274126177);
  return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
}

export function worldNoise(x: number, y: number, scale: number): number {
  const fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  const h = hash2;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * sx, b = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * sx;
  return a + (b - a) * sy;
}

/** The profile's colour at a distance from the shore, with patchy weed beds out past the sandy shallows. */
const PROFILE_MIDS = PROFILE_BANDS.slice(0, -1).map((b, i) => (b + PROFILE_BANDS[i + 1]) / 2);

export function profileAt(profile: Rgb[], d: number, x: number, y: number): Rgb {
  const mids = PROFILE_MIDS;
  let i = 0;
  while (i < mids.length - 1 && d > mids[i + 1]) i++;
  const t = i >= mids.length - 1 ? 0 : clamp01((d - mids[i]) / (mids[i + 1] - mids[i]));
  const a = profile[i], b = profile[Math.min(i + 1, profile.length - 1)];
  const weed = smooth((worldNoise(x, y, 160) * 0.65 + worldNoise(x, y, 45) * 0.35 - 0.5) / 0.2) * smooth((d - 60) / 120) * (1 - smooth((d - 1500) / 1000));
  const k = 1 - 0.35 * weed;
  return [(a[0] + (b[0] - a[0]) * t) * k, (a[1] + (b[1] - a[1]) * t) * k, (a[2] + (b[2] - a[2]) * t) * k];
}

/** The bay at `farCell` metres: where the sea is, how far out, how far into the photos, the jetties painted out. */
export function seaField(
  ocean: CoastPolygon[],
  piers: CoastPolygon[],
  photo: ReturnType<typeof photoLookup>,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  cfg = PHOTO_SEA,
): SeaField | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ocean) for (const [x, y] of p.rings[0] ?? []) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  x0 = Math.max(x0, bounds.minX); y0 = Math.max(y0, bounds.minY); x1 = Math.min(x1, bounds.maxX); y1 = Math.min(y1, bounds.maxY);
  if (!(x1 > x0 && y1 > y0)) return null;
  // A margin so the shore's distance and the texture's edge texels are right.
  const margin = 2 * cfg.farCell;
  x0 -= margin; y0 -= margin; x1 += margin; y1 += margin;
  const cell = Math.max(cfg.farCell, Math.max(x1 - x0, y1 - y0) / cfg.farMax);
  const w = Math.ceil((x1 - x0) / cell / 4) * 4, h = Math.ceil((y1 - y0) / cell / 4) * 4;
  const grid = new Grid(x0, y0 + h * cell, cell, w, h);
  const mask = new SeaMask(ocean, grid.x0, grid.yTop - h * cell, grid.x0 + w * cell, grid.yTop, cell);
  const pierMask = new SeaMask(piers, grid.x0, grid.yTop - h * cell, grid.x0 + w * cell, grid.yTop, cell);
  // Land: not sea and inside the world (outside it, the sea just stops: that's no shore).
  const land = new Uint8Array(w * h), wet = new Uint8Array(w * h), bare = new Uint8Array(w * h), pierSrc = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i, x = grid.x(i), y = grid.y(j);
      if (mask.has(x, y)) wet[k] = 1;
      else if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) land[k] = 1;
      pierSrc[k] = pierMask.has(x, y) ? 1 : 0;
    }
  }
  const toSea = distanceField(wet, w, h);
  const colour = new Float32Array(w * h * 3);
  const known = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i, x = grid.x(i), y = grid.y(j);
      // Only the sea and the texels next to it are ever seen.
      if (toSea[k] > 2) continue;
      // Averaged over the cell, so a sharp photo doesn't alias.
      let n = 0;
      const sum = [0, 0, 0];
      for (const [dx, dy] of QUAD) {
        const c = photo.at(x + dx * cell, y + dy * cell);
        if (!c) continue;
        sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2];
        n++;
      }
      if (n) {
        colour.set([sum[0] / n, sum[1] / n, sum[2] / n], k * 3);
        known[k] = 1;
      } else bare[k] = 1;
    }
  }
  const shore = distanceField(land, w, h), cover = distanceField(bare, w, h), pier = distanceField(pierSrc, w, h);
  for (const f of [shore, cover, pier]) for (let k = 0; k < f.length; k++) f[k] *= cell;
  // The jetties painted out: their cells filled from the photo round them, ring by ring.
  const padCells: number[] = [];
  // Only from the water round them: the sand where a jetty comes ashore would smear out along it.
  for (let k = 0; k < w * h; k++) if (!wet[k]) known[k] = 0;
  for (let k = 0; k < w * h; k++) if (pier[k] < cfg.pierPad + cell && known[k]) { known[k] = 0; padCells.push(k); }
  for (let pass = 0; pass < 64 && padCells.length; pass++) {
    const done: number[] = [];
    for (const k of padCells) {
      const i = k % w, j = (k - i) / w;
      const sum = [0, 0, 0];
      let n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
        const q = jj * w + ii;
        if (!known[q]) continue;
        sum[0] += colour[q * 3]; sum[1] += colour[q * 3 + 1]; sum[2] += colour[q * 3 + 2];
        n++;
      }
      if (n) { colour.set([sum[0] / n, sum[1] / n, sum[2] / n], k * 3); done.push(k); }
    }
    for (const k of done) known[k] = 1;
    const left = padCells.filter((k) => !known[k]);
    if (left.length === padCells.length) break;
    padCells.splice(0, padCells.length, ...left);
  }
  // Deep water: the photo's own, well out from the shore, if it has enough of it and it's blue.
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let k = 0; k < w * h; k++) {
    if (wet[k] && cover[k] > cell && pier[k] > cfg.pierPad && shore[k] >= cfg.deepFrom * 0.7 && shore[k] <= cfg.deepTo) {
      rs.push(colour[k * 3]); gs.push(colour[k * 3 + 1]); bs.push(colour[k * 3 + 2]);
    }
  }
  const median = (a: number[]) => a.sort((p, q) => p - q)[Math.floor(a.length / 2)];
  let deep: Rgb = [...cfg.deep];
  if (rs.length >= 50) {
    const own: Rgb = [median(rs), median(gs), median(bs)];
    if (own[2] >= own[0] + 15 && own[2] >= own[1] * 0.8 && own[2] < 200) deep = own;
  }
  // The photo's colour by distance from the shore, for the sea it doesn't cover.
  const bands: number[][][] = PROFILE_BANDS.slice(0, -1).map(() => [[], [], []]);
  for (let k = 0; k < w * h; k++) {
    if (!wet[k] || cover[k] <= cell || pier[k] <= cfg.pierPad) continue;
    const b = PROFILE_BANDS.findIndex((v, i) => i + 1 < PROFILE_BANDS.length && shore[k] >= v && shore[k] < PROFILE_BANDS[i + 1]);
    if (b < 0) continue;
    for (let c = 0; c < 3; c++) bands[b][c].push(colour[k * 3 + c]);
  }
  const own = bands.map((b) => (b[0].length >= 30 ? [median(b[0]), median(b[1]), median(b[2])] as Rgb : null));
  // A band the photo has none of: the nearest band it has (the default's with no photo at all).
  const profile: Rgb[] = own.map((c, i) => {
    for (let d = 0; d < own.length; d++) {
      const n = c ?? own[i - d] ?? own[i + d];
      if (n) return n;
    }
    return DEFAULT_PROFILE[i];
  });
  for (let k = 0; k < toSea.length; k++) toSea[k] *= cell;
  return { grid, shore, cover, pier, toSea, colour, deep, profile };
}

/** The photo layer's colour at a point (0-255). */
export function seaColourAt(f: SeaField, photo: ReturnType<typeof photoLookup>, x: number, y: number, step: number, cfg = PHOTO_SEA): Rgb {
  const { grid } = f;
  const shoreD = grid.sample(f.shore, x, y), coverD = grid.sample(f.cover, x, y), pierD = grid.sample(f.pier, x, y);
  let c: Rgb | null = null;
  if (pierD < cfg.pierPad) {
    const k = grid.index(x, y);
    if (k >= 0) c = [f.colour[k * 3], f.colour[k * 3 + 1], f.colour[k * 3 + 2]];
  } else if (step < grid.cell) {
    // Sharp tiles: the photo itself, averaged over the texel.
    let n = 0;
    const s = [0, 0, 0];
    for (const [dx, dy] of QUAD) {
      const p = photo.at(x + dx * step, y + dy * step);
      if (!p) continue;
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2];
      n++;
    }
    if (n) c = [s[0] / n, s[1] / n, s[2] / n];
  } else {
    const k = grid.index(x, y);
    if (k >= 0 && f.cover[k] > 0) c = [f.colour[k * 3], f.colour[k * 3 + 1], f.colour[k * 3 + 2]];
  }
  // Past the photos' edge (feathered, the edge wandering so it doesn't run straight), the profile.
  const prof = profileAt(f.profile, shoreD, x, y);
  const edgeW = c ? 1 - smooth((coverD - cfg.feather * 0.4 * worldNoise(x, y, 220)) / cfg.feather) : 1;
  const base: Rgb = c ? [c[0] + (prof[0] - c[0]) * edgeW, c[1] + (prof[1] - c[1]) * edgeW, c[2] + (prof[2] - c[2]) * edgeW] : prof;
  const deepW = smooth((shoreD - cfg.deepFrom) / (cfg.deepTo - cfg.deepFrom)), d = f.deep;
  return [base[0] + (d[0] - base[0]) * deepW, base[1] + (d[1] - base[1]) * deepW, base[2] + (d[2] - base[2]) * deepW];
}

/** Sutherland-Hodgman: a convex or concave polygon clipped to an axis-aligned square. */
export function clipToBox(poly: Vec2[], x0: number, y0: number, x1: number, y1: number): Vec2[] {
  let out = poly;
  const edges: [(p: Vec2) => boolean, (a: Vec2, b: Vec2) => Vec2][] = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ];
  for (const [inside, cut] of edges) {
    if (!out.length) break;
    const next: Vec2[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length];
      const ia = inside(a), ib = inside(b);
      if (ia) next.push(a);
      if (ia !== ib) next.push(cut(a, b));
    }
    out = next;
  }
  return out;
}

export interface PhotoSeaInput {
  ocean: CoastPolygon[];
  piers: CoastPolygon[];
  photos: SeaPhoto[];
  /** The world's extent (the sea polygons are clipped to it). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface PhotoSeaLayer {
  nodes: Kn5MeshNode[];
  textures: Kn5Texture[];
  materials: Kn5Material[];
  /** For the build log: sharp tiles, the far map's size and metres a pixel, the deep colour. */
  stats: { tiles: number; far: [number, number]; cell: number; deep: Rgb };
}

/**
 * The photo layer under the water: the sea polygons at SEA_LEVEL - layerDepth, textured with the bay's
 * photo colour. Sharp 500 m tiles (each its own texture, `sea_photo_<n>`) where the drive's photos are,
 * one map of the whole bay (`sea_photo`) elsewhere. Meshes SEA_PHOTO_<n>.
 */
export function buildPhotoSea(input: PhotoSeaInput, cfg = PHOTO_SEA): PhotoSeaLayer | null {
  if (!input.ocean.length) return null;
  const photo = photoLookup(input.photos);
  const field = seaField(input.ocean, input.piers, photo, input.bounds, cfg);
  if (!field) return null;
  const { grid } = field;
  const z = SEA_LEVEL - cfg.layerDepth;
  // Sharp tiles: squares holding sea that a fine photo covers.
  const T = cfg.nearTile;
  const fine = new Set<string>();
  for (const p of input.photos) {
    if ((p.chunk.maxX - p.chunk.minX) / p.size > cfg.nearPhoto) continue;
    for (let tx = Math.floor(p.chunk.minX / T); tx * T < p.chunk.maxX; tx++) for (let ty = Math.floor(p.chunk.minY / T); ty * T < p.chunk.maxY; ty++) fine.add(`${tx},${ty}`);
  }
  const hasSea = (tx: number, ty: number) => {
    for (let y = ty * T + 2; y < (ty + 1) * T; y += grid.cell) for (let x = tx * T + 2; x < (tx + 1) * T; x += grid.cell) {
      const k = grid.index(x, y);
      if (k >= 0 && field.toSea[k] === 0) return true;
    }
    return false;
  };
  const near = new Map<string, { tx: number; ty: number; mb: MeshBuilder[] }>();
  for (const key of [...fine].sort()) {
    const [tx, ty] = key.split(",").map(Number);
    if (hasSea(tx, ty)) near.set(key, { tx, ty, mb: [] });
  }
  const farW = grid.w * grid.cell, farH = grid.h * grid.cell;
  const farUv = (x: number, y: number): Vec2 => [(x - grid.x0) / farW, (grid.yTop - y) / farH];
  const far: MeshBuilder[] = [];
  const builder = (list: MeshBuilder[], verts: number) => {
    let mb = list[list.length - 1];
    if (!mb || mb.vertexCount + verts > 60000) {
      mb = new MeshBuilder();
      mb.normals = [];
      list.push(mb);
    }
    return mb;
  };
  const emit = (list: MeshBuilder[], poly: Vec2[], uv: (x: number, y: number) => Vec2) => {
    if (poly.length < 3) return;
    const mb = builder(list, poly.length);
    const i0 = mb.vertexCount;
    for (const [x, y] of poly) {
      const [u, v] = uv(x, y);
      mb.vertex([x, y, z], u, v);
      mb.normals!.push(0, 0, 1);
    }
    // Counter-clockwise seen from above (the way earcut's triangles are turned below).
    let area = 0;
    for (let i = 0; i < poly.length; i++) area += poly[i][0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * poly[i][1];
    for (let i = 1; i + 1 < poly.length; i++) {
      if (area >= 0) mb.tri(i0, i0 + i, i0 + i + 1);
      else mb.tri(i0, i0 + i + 1, i0 + i);
    }
  };
  const { minX, minY, maxX, maxY } = input.bounds;
  for (const p of input.ocean) {
    const flat = p.rings.flatMap((r) => r.flatMap((v) => v));
    const holes: number[] = [];
    let n = 0;
    p.rings.forEach((r, i) => { if (i > 0) holes.push(n); n += r.length; });
    if (n > 60000) continue;
    const tris = earcut(flat, holes);
    for (let t = 0; t < tris.length; t += 3) {
      const tri: Vec2[] = [0, 1, 2].map((k) => [flat[tris[t + k] * 2], flat[tris[t + k] * 2 + 1]] as Vec2);
      const bx0 = Math.min(...tri.map((q) => q[0])), bx1 = Math.max(...tri.map((q) => q[0]));
      const by0 = Math.min(...tri.map((q) => q[1])), by1 = Math.max(...tri.map((q) => q[1]));
      if (bx1 < minX || bx0 > maxX || by1 < minY || by0 > maxY) continue;
      const touches: { tx: number; ty: number; mb: MeshBuilder[] }[] = [];
      for (let tx = Math.floor(bx0 / T); tx * T <= bx1; tx++) for (let ty = Math.floor(by0 / T); ty * T <= by1; ty++) {
        const t2 = near.get(`${tx},${ty}`);
        if (t2) touches.push(t2);
      }
      if (!touches.length) {
        emit(far, tri, farUv);
        continue;
      }
      // Split at the tile edges: sharp tiles get their pieces, the rest goes on the far map.
      for (let tx = Math.floor(bx0 / T); tx * T <= bx1; tx++) for (let ty = Math.floor(by0 / T); ty * T <= by1; ty++) {
        const piece = clipToBox(tri, tx * T, ty * T, (tx + 1) * T, (ty + 1) * T);
        if (piece.length < 3) continue;
        const t2 = near.get(`${tx},${ty}`);
        // Texel centres on the tile's edges, so filtering never wraps round to the far side.
        if (t2) emit(t2.mb, piece, (x, y) => [(0.5 + ((x - tx * T) / T) * (cfg.nearRes - 1)) / cfg.nearRes, (0.5 + (((ty + 1) * T - y) / T) * (cfg.nearRes - 1)) / cfg.nearRes]);
        else emit(far, piece, farUv);
      }
    }
  }
  const textures: Kn5Texture[] = [], materials: Kn5Material[] = [], nodes: Kn5MeshNode[] = [];
  // Lit like the ground photos (they carry their own light), a touch of sheen.
  const light = { ambient: 0.6, diffuse: 0.2, specular: 0, exp: 1 };
  const farPx = new Uint8Array(grid.w * grid.h * 4);
  for (let j = 0; j < grid.h; j++) for (let i = 0; i < grid.w; i++) {
    // Texels away from the sea are never seen: the deep colour keeps the mips clean.
    const c = field.toSea[j * grid.w + i] > 2 * grid.cell ? field.deep : seaColourAt(field, photo, grid.x(i), grid.y(j), grid.cell, cfg);
    farPx.set([c[0], c[1], c[2], 255], (j * grid.w + i) * 4);
  }
  textures.push({ name: "sea_photo.dds", data: encodeDdsDxt1(farPx, grid.w, grid.h) });
  materials.push(material("sea_photo", "sea_photo.dds", light));
  const out = (list: MeshBuilder[], mat: string) => {
    for (const mb of list) if (mb.indices.length) nodes.push(mb.toKn5(`SEA_PHOTO_${String(nodes.length).padStart(2, "0")}`, mat, { castShadows: false }));
  };
  out(far, "sea_photo");
  let tiles = 0;
  for (const t of near.values()) {
    if (!t.mb.some((mb) => mb.indices.length)) continue;
    const res = cfg.nearRes, step = T / (res - 1);
    const px = new Uint8Array(res * res * 4);
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const x = t.tx * T + i * step, y = (t.ty + 1) * T - j * step;
      const c = grid.sample(field.toSea, x, y) > 3 * grid.cell ? field.deep : seaColourAt(field, photo, x, y, step, cfg);
      px.set([c[0], c[1], c[2], 255], (j * res + i) * 4);
    }
    const name = `sea_photo_${tiles}`;
    textures.push({ name: `${name}.dds`, data: encodeDdsDxt1(px, res, res) });
    materials.push(material(name, `${name}.dds`, light));
    out(t.mb, name);
    tiles++;
  }
  return { nodes, textures, materials, stats: { tiles, far: [grid.w, grid.h], cell: grid.cell, deep: field.deep } };
}

/* ---------------- the water surface ---------------- */

/** The water surface, 24 m repeat: turquoise with soft ripples, alpha `surfaceAlpha` (the photo layer shows through). */
export function seaSurfaceTexture(alpha = PHOTO_SEA.surfaceAlpha): Uint8Array {
  const w = 256, h = 256;
  const r = rng(41);
  const px = fill(w, h, (x, y) => {
    const k = 0.92 + 0.05 * Math.sin((x / w) * Math.PI * 2 * 9 + Math.sin((y / h) * Math.PI * 2 * 3) * 2)
      + 0.04 * Math.sin((y / h) * Math.PI * 2 * 13 + Math.sin((x / w) * Math.PI * 2 * 2) * 1.5) + (r() - 0.5) * 0.03;
    return [58 * k, 136 * k, 142 * k];
  });
  const a = Math.round(clamp01(alpha) * 255);
  for (let i = 3; i < px.length; i += 4) px[i] = a;
  return encodePng(px, w, h);
}

/** The water surface's material: as before (glossy), alpha-blended over the photo layer. */
export function seaSurfaceMaterial(): Kn5Material {
  return { ...material("sea", "sea.png", { ambient: 0.4, diffuse: 0.35, specular: 0.7, exp: 90 }), blendMode: BlendMode.AlphaBlend };
}

/* ---------------- beaches ---------------- */

/** Fine sand, tiling (`sandTile` m), mid grey on average for the multilayer shader: grains, a few dark mineral and pale shell flecks. Procedural (CC0). */
export function sandDetailTexture(): Uint8Array {
  const w = 512, h = 512;
  const r = rng(517);
  const mottle = valueNoise(w, h, 6, 518), fine = valueNoise(w, h, 96, 519), ripple = valueNoise(w, h, 3, 520);
  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    // Faint wind ripples across the tile, mottling, and per-pixel grain.
    const rip = 0.025 * Math.sin((y / h) * Math.PI * 2 * 7 + ripple[i] * 6);
    lum[i] = 0.5 + 0.05 * (mottle[i] - 0.5) + 0.07 * (fine[i] - 0.5) + rip + (r() - 0.5) * 0.12;
  }
  const wrap = (x: number, y: number) => ((y % h + h) % h) * w + ((x % w + w) % w);
  for (let k = 0; k < 2600; k++) {
    const cx = Math.floor(r() * w), cy = Math.floor(r() * h), dark = r() < 0.7, rad = dark ? 1 : 1 + Math.floor(r() * 2);
    for (let dy = -rad; dy < rad; dy++) for (let dx = -rad; dx < rad; dx++) lum[wrap(cx + dx, cy + dy)] = dark ? 0.32 + r() * 0.08 : 0.64 + r() * 0.06;
  }
  let mean = 0;
  for (const v of lum) mean += v;
  mean /= lum.length;
  const px = fill(w, h, (_x, _y, i) => {
    const v = (lum[i] - mean + 0.5) * 255;
    return [v * 1.01, v, v * 0.98];
  });
  return encodeDdsDxt1(px, w, h);
}

/** A multilayer ground material with the fine sand grain in place of the plain detail (the mask's blue: sand, water). */
export function withSandDetail(m: Kn5Material, texture = "ground_sand.dds", metres = PHOTO_SEA.sandTile): Kn5Material {
  if (m.shader !== "ksMultilayer" || !m.textures.txDetailB) return m;
  return {
    ...m,
    textures: { ...m.textures, txDetailB: texture },
    properties: m.properties.map((p) => (p.name === "multB" ? { ...p, a: 1 / metres } : p)),
  };
}

/** Sand in a photo pixel (0-1): bright and pale, not grass. */
export function sandiness(r: number, g: number, b: number): number {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx > 0 ? (mx - mn) / mx : 0;
  const notGreen = 1 - clamp01((g - Math.max(r, b)) / 12);
  const notBlue = 1 - clamp01((b - r - 6) / 14);
  return smooth((lum - 0.36) / 0.24) * (1 - smooth((sat - 0.2) / 0.2)) * notGreen * notBlue;
}

/** Dry beach sand: the photo's own variation, lifted toward the real near-white. */
export function drySand([r, g, b]: Rgb, cfg = PHOTO_SEA): Rgb {
  const lift = (v: number) => 255 - (255 - v) * 0.45;
  return [lift(r), lift(g), lift(b)].map((v, k) => v + (cfg.sand[k] - v) * 0.3) as Rgb;
}

/** Wet sand: darker and a little cooler. */
export function wetSand([r, g, b]: Rgb): Rgb {
  return [r * 0.7, g * 0.72, b * 0.76];
}

/** Beaches in the ground photos: white dry sand, wet sand at the water's edge. */
export class BeachLook {
  private readonly box: { minX: number; minY: number; maxX: number; maxY: number } | null;
  constructor(private readonly beaches: CoastPolygon[], private readonly sea: SeaMask, private readonly cfg = PHOTO_SEA) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of beaches) for (const [x, y] of p.rings[0] ?? []) {
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    this.box = beaches.length ? { minX, minY, maxX, maxY } : null;
  }

  /** The photo (top row first, `size` square over `chunk`) with its beaches toned, or null if it has none. */
  tone(chunk: { minX: number; minY: number; maxX: number; maxY: number }, rgba: Uint8Array | Uint8ClampedArray, size: number): Uint8Array | null {
    const cfg = this.cfg;
    const m = 1, pad = cfg.shoreSand + 10;
    const x0 = chunk.minX - pad, y0 = chunk.minY - pad, x1 = chunk.maxX + pad, y1 = chunk.maxY + pad;
    const inBox = this.box && !(this.box.maxX < x0 || this.box.minX > x1 || this.box.maxY < y0 || this.box.minY > y1);
    if (!inBox && !this.sea.near((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2)) return null;
    const w = Math.ceil((x1 - x0) / m), h = Math.ceil((y1 - y0) / m);
    const g = new Grid(x0, y0 + h * m, m, w, h);
    const beach = inBox ? new SeaMask(this.beaches, x0, y0, x0 + w * m, y0 + h * m, m) : null;
    const seaSrc = new Uint8Array(w * h), notBeach = new Uint8Array(w * h);
    let anySea = false, anyBeach = false;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = g.x(i), y = g.y(j), k = j * w + i;
      if (this.sea.has(x, y)) { seaSrc[k] = 1; anySea = true; }
      if (beach?.has(x, y) && !seaSrc[k]) anyBeach = true;
      else notBeach[k] = 1;
    }
    if (!anySea && !anyBeach) return null;
    const seaD = anySea ? distanceField(seaSrc, w, h) : new Float32Array(w * h).fill(1e9);
    const inBeach = anyBeach ? distanceField(notBeach, w, h) : new Float32Array(w * h);
    const out = Uint8Array.from(rgba);
    const span = chunk.maxX - chunk.minX, mpp = span / size;
    let changed = 0;
    for (let py = 0; py < size; py++) {
      const y = chunk.maxY - (py + 0.5) * mpp;
      for (let px = 0; px < size; px++) {
        const x = chunk.minX + (px + 0.5) * mpp;
        const k = g.index(x, y);
        if (k < 0 || seaSrc[k]) continue;
        const dSea = seaD[k] * m;
        // In an OSM beach (soft over its first 3 m), or sand-coloured right at the water.
        const wPoly = smooth(inBeach[k] * m / 3);
        const wShore = 1 - smooth((dSea - cfg.shoreSand) / 10);
        if (wPoly <= 0 && wShore <= 0) continue;
        const i = (py * size + px) * 4;
        const c: Rgb = [rgba[i], rgba[i + 1], rgba[i + 2]];
        const sand = sandiness(c[0], c[1], c[2]);
        const wBeach = Math.max(wPoly * (0.35 + 0.65 * sand), wShore * sand);
        if (wBeach <= 0.01) continue;
        // The wet band, its upper edge wandering a metre or so.
        const wobble = 1.2 * Math.sin(x * 0.11 + Math.sin(y * 0.07) * 2) + 0.6 * Math.sin(y * 0.23 + x * 0.05);
        const wet = 1 - smooth((dSea - (cfg.wetBand + wobble) * 0.6) / (cfg.wetBand * 0.5));
        const dry = drySand(c, cfg), damp = wetSand(c);
        for (let ch = 0; ch < 3; ch++) {
          const target = dry[ch] + (damp[ch] - dry[ch]) * wet;
          out[i + ch] = Math.round(Math.max(0, Math.min(255, c[ch] + (target - c[ch]) * wBeach)));
        }
        changed++;
      }
    }
    return changed ? out : null;
  }
}

/* ---------------- foam ---------------- */

/** Foam along the shore, 8 m along by `foamIn + foamOut` across: a bright broken line at the sand, lacy toward the water. RGBA PNG. */
export function foamTexture(): Uint8Array {
  const w = 256, h = 64;
  const n1 = valueNoise(w, h, 16, 611), n2 = valueNoise(w, h, 48, 612), n3 = valueNoise(w, h, 5, 613);
  const px = new Uint8Array(w * h * 4);
  const r = rng(614);
  const edge = PHOTO_SEA.foamIn / (PHOTO_SEA.foamIn + PHOTO_SEA.foamOut);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = (y + 0.5) / h;
    // v = 0 up the sand, `edge` the waterline, 1 out on the water.
    const line = Math.exp(-(((v - edge - 0.06) / 0.08) ** 2));
    const lace = clamp01((n2[i] - 0.45) * 4) * (1 - smooth((v - edge) / (1 - edge))) * 0.8;
    const broken = 0.55 + 0.45 * smooth((n3[i] - 0.25) / 0.5);
    const a = clamp01((line * (0.75 + 0.35 * n1[i]) + lace * (1 - line)) * broken) * smooth(v / (edge * 0.9));
    const k = 236 + r() * 14;
    px.set([k, k + 4, k + 2, Math.round(a * 230)], i * 4);
  }
  return encodePng(px, w, h);
}

/** The foam's material: alpha-blended, no depth write (so the water under it still draws). */
export function foamMaterial(): Kn5Material {
  return { ...material("shore_foam", "shore_foam.png", { ambient: 0.55, diffuse: 0.45, specular: 0.1, exp: 10 }), blendMode: BlendMode.AlphaBlend, depthMode: DepthMode.NoWrite };
}

/**
 * The foam line: a strip along every real coastline edge (not tile seams), from `foamIn` up the sand to
 * `foamOut` out on the water, just above the water, clear of jetties. Meshes SHORE_FOAM_<n>.
 */
export function buildShoreFoam(ocean: CoastPolygon[], sea: SeaMask, piers: CoastPolygon[], cfg = PHOTO_SEA): Kn5MeshNode[] {
  const out: Kn5MeshNode[] = [];
  let mb = new MeshBuilder();
  mb.normals = [];
  const flush = () => {
    if (mb.indices.length) out.push(mb.toKn5(`SHORE_FOAM_${String(out.length).padStart(2, "0")}`, "shore_foam", { castShadows: false, transparent: true }));
    mb = new MeshBuilder();
    mb.normals = [];
  };
  const pierEdges = piers.flatMap((p) => (p.rings[0] ?? []).map((a, i, r) => [a, r[(i + 1) % r.length]] as const));
  const nearPier = (x: number, y: number) => pierEdges.some(([a, b]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
    return Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y) < 10;
  });
  const z = SEA_LEVEL + 0.03;
  for (const p of ocean) {
    p.rings.forEach((ring, ri) => {
      const n = ring.length;
      if (n < 3) return;
      let run: { p: Vec2; out: Vec2; s: number }[] = [];
      const emit = () => {
        if (run.length >= 2) {
          if (mb.vertexCount + run.length * 2 > 60000) flush();
          const base = mb.vertexCount;
          for (const q of run) {
            mb.vertex([q.p[0] - q.out[0] * cfg.foamIn, q.p[1] - q.out[1] * cfg.foamIn, z], q.s / 8, 0);
            mb.vertex([q.p[0] + q.out[0] * cfg.foamOut, q.p[1] + q.out[1] * cfg.foamOut, z], q.s / 8, 1);
            mb.normals!.push(0, 0, 1, 0, 0, 1);
          }
          for (let k = 0; k + 1 < run.length; k++) {
            const a = base + k * 2, c = a + 2;
            // Facing up whichever way round the ring runs.
            const d: Vec2 = [run[k + 1].p[0] - run[k].p[0], run[k + 1].p[1] - run[k].p[1]];
            const outLeft = d[0] * run[k].out[1] - d[1] * run[k].out[0] > 0;
            if (outLeft) mb.quad(a, c, c + 1, a + 1);
            else mb.quad(a, a + 1, c + 1, c);
          }
        }
        run = [];
      };
      let s = 0;
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (!p.edge[ri]?.[i] || L < 1e-6) {
          emit();
          continue;
        }
        const d: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
        const left: Vec2 = [-d[1], d[0]];
        const steps = Math.max(1, Math.ceil(L / 2));
        for (let k = 0; k < steps; k++) {
          const q: Vec2 = [a[0] + (b[0] - a[0]) * (k / steps), a[1] + (b[1] - a[1]) * (k / steps)];
          // Out onto the water: whichever side the sea is.
          const l = sea.has(q[0] + left[0] * 6, q[1] + left[1] * 6), r = sea.has(q[0] - left[0] * 6, q[1] - left[1] * 6);
          if (l === r || nearPier(q[0], q[1])) {
            emit();
            s += L / steps;
            continue;
          }
          const o: Vec2 = l ? left : [-left[0], -left[1]];
          if (run.length && (run[run.length - 1].out[0] * o[0] + run[run.length - 1].out[1] * o[1]) < 0) emit();
          run.push({ p: q, out: o, s });
          s += L / steps;
        }
      }
      emit();
    });
  }
  flush();
  return out;
}
