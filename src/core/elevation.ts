// The DEM height grid: one mosaic of 256 x 256 height tiles on the web-map tile grid, sampled
// bilinearly at any local point, plus Terrarium decoding. Fetching tiles and picking zooms live in
// services/tiles.ts; smoothing the road's profile lives in road.ts (applyElevation).
// Written fresh from docs/specs/elevation.md.

import { tilesCovering, type Bounds, type LocalProjection } from "./geo";

/** Ground height in metres at a local point (x east, y north). */
export type HeightFn = (x: number, y: number) => number;

const TILE = 256;

/** Terrarium RGB to metres. Pass the alpha too: fully transparent means no data (NaN). */
export function decodeTerrarium(r: number, g: number, b: number, a = 255): number {
  return a === 0 ? NaN : r * 256 + g + b / 256 - 32768;
}

/** A whole RGBA tile to metres, one value per pixel; NaN where the pixel is transparent. */
export function decodeTerrariumTile(rgba: Uint8Array | Uint8ClampedArray): Float32Array {
  const out = new Float32Array(rgba.length >> 2);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = decodeTerrarium(rgba[p], rgba[p + 1], rgba[p + 2], rgba[p + 3]);
  return out;
}

/** A 256 x 256 RGBA Terrarium tile at tile coordinates (x, y). */
export interface DecodedTile { x: number; y: number; rgba: Uint8Array | Uint8ClampedArray }

/**
 * Replaces every non-finite value: from the nearest finite value in the same row, else the nearest
 * in the same column (after the row pass), else 0 (sea level). Returns how many it replaced.
 */
export function fillGaps(data: Float32Array, width: number, height: number): number {
  let bad = 0;
  for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i])) bad++;
  if (!bad) return 0;
  // Row pass: distance to the nearest finite value either way along the row.
  const left = new Int32Array(width), right = new Int32Array(width);
  for (let r = 0; r < height; r++) {
    const o = r * width;
    let last = -1;
    for (let c = 0; c < width; c++) {
      if (Number.isFinite(data[o + c])) last = c;
      left[c] = last;
    }
    last = -1;
    for (let c = width - 1; c >= 0; c--) {
      if (Number.isFinite(data[o + c])) last = c;
      right[c] = last;
    }
    if (left[width - 1] < 0) continue; // no finite value in this row: the column pass does it
    for (let c = 0; c < width; c++) {
      if (Number.isFinite(data[o + c])) continue;
      const l = left[c], rr = right[c];
      const pick = l < 0 ? rr : rr < 0 ? l : c - l <= rr - c ? l : rr;
      data[o + c] = data[o + pick];
    }
  }
  // Column pass, for rows that had nothing at all.
  const up = new Int32Array(height), down = new Int32Array(height);
  for (let c = 0; c < width; c++) {
    let last = -1;
    for (let r = 0; r < height; r++) {
      if (Number.isFinite(data[r * width + c])) last = r;
      up[r] = last;
    }
    last = -1;
    for (let r = height - 1; r >= 0; r--) {
      if (Number.isFinite(data[r * width + c])) last = r;
      down[r] = last;
    }
    for (let r = 0; r < height; r++) {
      const i = r * width + c;
      if (Number.isFinite(data[i])) continue;
      const u = up[r], d = down[r];
      const pick = u < 0 ? d : d < 0 ? u : r - u <= d - r ? u : d;
      data[i] = pick < 0 ? 0 : data[pick * width + c];
    }
  }
  return bad;
}

export class DemGrid {
  /**
   * Height at a local point: bilinear between the stored values, clamped to the edge outside the
   * grid. An arrow property so it can be passed around detached (`const dem = grid.sample`).
   */
  readonly sample: HeightFn;

  private constructor(
    proj: LocalProjection,
    readonly z: number,
    /** Global pixel coordinate that data[0] stands for. */
    readonly px0: number,
    readonly py0: number,
    readonly width: number,
    readonly height: number,
    /** Heights, row by row from the north. */
    readonly data: Float32Array,
    /** How many cells had no data (missing tiles, NaN) and were filled from their neighbours. */
    readonly filled = 0,
  ) {
    const maxX = width - 1.001, maxY = height - 1.001;
    this.sample = (x, y) => {
      const [gx, gy] = proj.localToPixel([x, y], z);
      const fx = Math.min(maxX, Math.max(0, gx - px0));
      const fy = Math.min(maxY, Math.max(0, gy - py0));
      const c = Math.floor(fx), r = Math.floor(fy);
      const tx = fx - c, ty = fy - r;
      const i = r * width + c;
      const top = data[i] + (data[i + 1] - data[i]) * tx;
      const bottom = data[i + width] + (data[i + width + 1] - data[i + width]) * tx;
      return top + (bottom - top) * ty;
    };
  }

  /** From decoded RGBA Terrarium tiles (transparent pixels are no data and get filled). */
  static fromTiles(proj: LocalProjection, z: number, tiles: DecodedTile[]): DemGrid {
    return DemGrid.fromHeights(proj, z, tiles.map((t) => ({ x: t.x, y: t.y, heights: decodeTerrariumTile(t.rgba) })));
  }

  /**
   * From 256 x 256 height tiles (rows from the north) at tile coordinates on zoom z. The grid spans
   * the tiles' bounding rectangle; tiles missing from it, and non-finite values, are filled from the
   * nearest data (`filled` says how many cells).
   */
  static fromHeights(proj: LocalProjection, z: number, tiles: { x: number; y: number; heights: Float32Array }[]): DemGrid {
    if (!tiles.length) throw new Error("DemGrid.fromHeights: no tiles");
    let tx0 = Infinity, ty0 = Infinity, tx1 = -Infinity, ty1 = -Infinity;
    for (const t of tiles) {
      tx0 = Math.min(tx0, t.x); ty0 = Math.min(ty0, t.y);
      tx1 = Math.max(tx1, t.x); ty1 = Math.max(ty1, t.y);
    }
    const width = (tx1 - tx0 + 1) * TILE, height = (ty1 - ty0 + 1) * TILE;
    const data = new Float32Array(width * height).fill(NaN);
    for (const t of tiles) {
      const ox = (t.x - tx0) * TILE, oy = (t.y - ty0) * TILE;
      for (let r = 0; r < TILE; r++) data.set(t.heights.subarray(r * TILE, (r + 1) * TILE), (oy + r) * width + ox);
    }
    const filled = fillGaps(data, width, height);
    return new DemGrid(proj, z, tx0 * TILE + 0.5, ty0 * TILE + 0.5, width, height, data, filled);
  }

  /**
   * From a function (tests and offline runs): the function at every whole pixel coordinate over the
   * bounds, with a 2-pixel margin. Reproduces the function exactly at those points.
   */
  static fromFunction(proj: LocalProjection, z: number, bounds: Bounds, fn: HeightFn): DemGrid {
    const nw = proj.localToPixel([bounds.minX, bounds.maxY], z);
    const se = proj.localToPixel([bounds.maxX, bounds.minY], z);
    const px0 = Math.floor(nw[0]) - 2, py0 = Math.floor(nw[1]) - 2;
    const width = Math.ceil(se[0]) - px0 + 4, height = Math.ceil(se[1]) - py0 + 4;
    const data = new Float32Array(width * height);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const [x, y] = proj.pixelToLocal([px0 + c, py0 + r], z);
        data[r * width + c] = fn(x, y);
      }
    }
    const filled = fillGaps(data, width, height);
    return new DemGrid(proj, z, px0, py0, width, height, data, filled);
  }
}

/** Every tile covering the bounds at zoom z: rows (y) outer, columns (x) inner. */
export function demTilesFor(proj: LocalProjection, bounds: Bounds, z: number): { x: number; y: number }[] {
  const { x0, y0, x1, y1 } = tilesCovering(proj, bounds, z);
  const out: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}
