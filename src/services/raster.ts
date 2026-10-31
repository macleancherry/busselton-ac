// The aerial photo's colour anywhere near a set of lines, at the sharpest zoom the imagery has
// (docs/specs/raster.md). Downloads only the tiles within reach of the lines and returns a sampler
// from local metres to RGB in [0, 1], bilinear between pixel centres, null where there's no photo.
// Tracing, kerb and path detection, paint reading and the photo road surface all use it.
//
// The tile loader and colour lookup can be swapped (tests run in Node); by default they use
// tiles.ts (loadBitmap, colourBalance), which handles retries, parallel limits and dead hosts.

import type { ColourTransform } from "../core/colour";
import { lngLatToPixel, type LocalProjection, type Vec2 } from "../core/geo";
import type { RasterSampler } from "../core/trace";
import { colourBalance, IMAGERY, loadBitmap, tileUrl, type ImagerySource } from "./tiles";

const TILE = 256;
/** More tiles than this and tracing is skipped (4000 x 256 KB RGBA is about 1 GB). */
export const MAX_RASTER_TILES = 4000;
/** Lines are sampled at least this often (m) to find the tiles they need. */
const STEP = 5;

/** One source tile's pixels, 256 x 256 RGBA, top row first. */
export type TileLoader = (src: ImagerySource, z: number, x: number, y: number) => Promise<{ rgba: Uint8Array | Uint8ClampedArray } | null>;
export type ColourLookup = (src: ImagerySource, z: number, x: number, y: number) => Promise<ColourTransform | null>;

export interface RasterDeps {
  loadTile?: TileLoader;
  colourBalance?: ColourLookup;
  /** Told when the raster is skipped (too many tiles), for the build's missing-data report. */
  warn?: (message: string) => void;
}

let canvas: OffscreenCanvas | null = null;

/** The browser loader: the tile's bitmap drawn to a canvas and read back, then closed. */
const browserLoader: TileLoader = async (src, z, x, y) => {
  const bmp = await loadBitmap(tileUrl(src, z, x, y));
  if (!bmp) return null;
  try {
    canvas ??= new OffscreenCanvas(TILE, TILE);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    // Draw and read with no await in between: the canvas is shared by concurrent tiles.
    ctx.clearRect(0, 0, TILE, TILE);
    ctx.drawImage(bmp, 0, 0, TILE, TILE);
    return { rgba: ctx.getImageData(0, 0, TILE, TILE).data };
  } finally {
    bmp.close();
  }
};

/** The tile keys ("x,y") within `r` pixels (a square) of points sampled along the lines. */
export function tilesNear(proj: LocalProjection, lines: Vec2[][], r: number, z: number): Set<string> {
  const need = new Set<string>();
  const add = (p: Vec2) => {
    const [gx, gy] = proj.localToPixel(p, z);
    const tx0 = Math.floor((gx - r) / TILE), tx1 = Math.floor((gx + r) / TILE);
    const ty0 = Math.floor((gy - r) / TILE), ty1 = Math.floor((gy + r) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) need.add(`${tx},${ty}`);
  };
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP));
      for (let k = 0; k < steps; k++) add([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
    }
    if (line.length) add(line[line.length - 1]);
  }
  return need;
}

/** One line, or several. */
function asLines(path: Vec2[] | Vec2[][]): Vec2[][] {
  if (!path.length) return [];
  return Array.isArray(path[0][0]) ? (path as Vec2[][]) : [path as Vec2[]];
}

/**
 * RGB of the square (sx, sy, span) of a source tile, scaled to 256 x 256 (bilinear between pixel
 * centres, clamped at the tile's edges). span = 256 copies it.
 */
function cropRgb(rgba: Uint8Array | Uint8ClampedArray, sx: number, sy: number, span: number): Uint8Array {
  const out = new Uint8Array(TILE * TILE * 3);
  if (span === TILE) {
    for (let i = 0, o = 0; i < TILE * TILE; i++) {
      out[o++] = rgba[i * 4];
      out[o++] = rgba[i * 4 + 1];
      out[o++] = rgba[i * 4 + 2];
    }
    return out;
  }
  const scale = span / TILE;
  const clamp = (v: number) => Math.min(TILE - 1, Math.max(0, v));
  for (let oy = 0; oy < TILE; oy++) {
    const fy = sy + (oy + 0.5) * scale - 0.5;
    const y0 = Math.floor(fy), wy = fy - y0;
    const ya = clamp(y0), yb = clamp(y0 + 1);
    for (let ox = 0; ox < TILE; ox++) {
      const fx = sx + (ox + 0.5) * scale - 0.5;
      const x0 = Math.floor(fx), wx = fx - x0;
      const xa = clamp(x0), xb = clamp(x0 + 1);
      const o = (oy * TILE + ox) * 3;
      for (let c = 0; c < 3; c++) {
        const p00 = rgba[(ya * TILE + xa) * 4 + c], p10 = rgba[(ya * TILE + xb) * 4 + c];
        const p01 = rgba[(yb * TILE + xa) * 4 + c], p11 = rgba[(yb * TILE + xb) * 4 + c];
        const top = p00 + (p10 - p00) * wx, bottom = p01 + (p11 - p01) * wx;
        out[o + c] = Math.round(top + (bottom - top) * wy);
      }
    }
  }
  return out;
}

interface Tile { rgb: Uint8Array; look: ColourTransform | null }

export async function loadRouteRaster(
  proj: LocalProjection,
  path: Vec2[] | Vec2[][],
  reach: number,
  chain: ImagerySource[],
  maxZoom = 20,
  onProgress?: (done: number, total: number) => void,
  deps: RasterDeps = {},
): Promise<RasterSampler | null> {
  const loadTile = deps.loadTile ?? browserLoader;
  const balance = deps.colourBalance ?? colourBalance;
  const z = Math.min(maxZoom, IMAGERY[chain[0]].maxZoom);
  const mpp = proj.metresPerPixel(z);
  const need = tilesNear(proj, asLines(path), reach / mpp, z);
  if (need.size > MAX_RASTER_TILES) {
    deps.warn?.(`aerial trace skipped: ${need.size} tiles needed (limit ${MAX_RASTER_TILES})`);
    return null;
  }

  const tiles = new Map<string, Tile>();
  const total = need.size;
  let done = 0;
  await Promise.all([...need].map(async (key) => {
    const [tx, ty] = key.split(",").map(Number);
    for (const src of chain) {
      const sz = Math.min(z, IMAGERY[src].maxZoom), up = z - sz;
      let got: { rgba: Uint8Array | Uint8ClampedArray } | null = null;
      try {
        got = await loadTile(src, sz, tx >> up, ty >> up);
      } catch {
        got = null;
      }
      if (!got) continue;
      const span = TILE >> up;
      const rgb = cropRgb(got.rgba, (tx - ((tx >> up) << up)) * span, (ty - ((ty >> up) << up)) * span, span);
      const zb = Math.min(sz, 18);
      let look: ColourTransform | null = null;
      try {
        look = await balance(src, zb, tx >> (z - zb), ty >> (z - zb));
      } catch {
        look = null;
      }
      tiles.set(key, { rgb, look });
      break;
    }
    onProgress?.(++done, total);
  }));
  if (!tiles.size) return null;

  const pixel = (px: number, py: number, display: boolean): [number, number, number] | null => {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    const t = tiles.get(`${tx},${ty}`);
    if (!t) return null;
    const o = ((py - ty * TILE) * TILE + (px - tx * TILE)) * 3;
    const r = t.rgb[o], g = t.rgb[o + 1], b = t.rgb[o + 2];
    if (!display || !t.look) return [r, g, b];
    const { gain, offset } = t.look;
    const f = (v: number, c: number) => Math.min(255, Math.max(0, v * gain[c] + offset[c]));
    return [f(r, 0), f(g, 1), f(b, 2)];
  };

  const [ox, oy] = lngLatToPixel(proj.origin, z);
  const sampler = (display: boolean): RasterSampler => (x, y) => {
    const gx = ox + x / mpp - 0.5, gy = oy - y / mpp - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const a = pixel(x0, y0, display), b = pixel(x0 + 1, y0, display);
    const c = pixel(x0, y0 + 1, display), d = pixel(x0 + 1, y0 + 1, display);
    if (!a || !b || !c || !d) return null;
    const out: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const top = a[i] + (b[i] - a[i]) * fx, bottom = c[i] + (d[i] - c[i]) * fx;
      out[i] = (top + (bottom - top) * fy) / 255;
    }
    return out;
  };

  const raw = sampler(false);
  if ([...tiles.values()].some((t) => t.look)) raw.display = sampler(true);
  return raw;
}
