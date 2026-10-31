// Aerial imagery and elevation: where the photos and heights come from, loading their tiles
// politely, one aerial texture per terrain chunk, and a height sampler for a box (global
// Terrarium plus state bare-earth models where they cover it).
//
// Written from docs/specs/tiles.md. The URLs below are cache and snapshot keys: keep them byte for byte.

import { applyColours, matchColours, type ColourTransform } from "../core/colour";
import { encodeDdsDxt1 } from "../core/dds";
import { DemGrid, decodeTerrariumTile, demTilesFor, type HeightFn } from "../core/elevation";
import { tilesCovering, type Bounds, type LngLat, type LocalProjection } from "../core/geo";
import type { TerrainChunk } from "../core/terrain";
import { dataWarnings, warnMissing } from "./dataWarnings";

/* ---------------- imagery sources ---------------- */

export type ImagerySource = "esri" | "qld" | "nsw" | "wa";

interface Imagery { label: string; template: string; credit: string; maxZoom: number }

// key: [label, URL template, credit (README), deepest zoom]
const IMAGERY_TABLE: [ImagerySource, string, string, string, number][] = [
  ["esri", "Esri World Imagery", "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", "Esri World Imagery (Esri, Maxar, Earthstar Geographics, and the GIS User Community)", 19],
  ["qld", "Queensland Government", "https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestStateProgram_AllUsers/ImageServer/tile/{z}/{y}/{x}", "State of Queensland aerial imagery (latest public State Program; includes material (c) Planet Labs)", 20],
  ["nsw", "NSW Government", "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/{z}/{y}/{x}", "NSW Spatial Services imagery ((c) Department of Customer Service NSW)", 21],
  // Landgate's Locate is an ImageServer with no tile cache: each web-map tile is asked for by its Mercator box.
  ["wa", "Landgate WA (Locate)", "https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Locate/ImageServer/exportImage?bbox={bbox}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&interpolation=RSP_BilinearInterpolation&f=image", "Locate mosaic (c) Western Australian Land Information Authority (Landgate), personal use", 20],
];

export const IMAGERY: Readonly<Record<ImagerySource, Readonly<Imagery>>> = Object.fromEntries(
  IMAGERY_TABLE.map(([key, label, template, credit, maxZoom]) => [key, { label, template, credit, maxZoom }]),
) as Record<ImagerySource, Imagery>;

/** Web Mercator world width, metres. */
const WORLD = 40075016.68557849;
const HALF = WORLD / 2;

/** A run of tiles' box in Web Mercator metres (nx by ny tiles from tx0, ty0 at zoom z). */
function mercatorBox(z: number, tx0: number, ty0: number, nx = 1, ny = 1): [number, number, number, number] {
  const size = WORLD / 2 ** z;
  const xmin = tx0 * size - HALF;
  const ymax = HALF - ty0 * size;
  return [xmin, ymax - ny * size, xmin + nx * size, ymax];
}

/** The tile's box in Web Mercator metres, "xmin,ymin,xmax,ymax" with three decimals. */
export function tileBbox(z: number, x: number, y: number): string {
  return mercatorBox(z, x, y).map((v) => v.toFixed(3)).join(",");
}

export function tileUrl(src: ImagerySource, z: number, x: number, y: number): string {
  return IMAGERY[src].template
    .replace("{z}", String(z))
    .replace("{y}", String(y))
    .replace("{x}", String(x))
    .replace("{bbox}", () => tileBbox(z, x, y));
}

/** Rough boxes where each state's imagery is worth trying first (strict inequalities). */
const STATE_IMAGERY: [ImagerySource, (lng: number, lat: number) => boolean][] = [
  ["qld", (lng, lat) => lat > -29.3 && lat < -9 && lng > 137.9 && lng < 154],
  ["nsw", (lng, lat) => lat > -37.6 && lat < -28.1 && lng > 140.9 && lng < 154],
  ["wa", (lng, lat) => lat > -35.4 && lat < -13.5 && lng > 112.8 && lng < 129.1],
];

/** Sources to try for a place, best first, always ending with Esri. */
export function imageryChain(at: LngLat, pick: "auto" | ImagerySource = "auto"): ImagerySource[] {
  if (pick !== "auto") return pick === "esri" ? ["esri"] : [pick, "esri"];
  const chain = STATE_IMAGERY.filter(([, inside]) => inside(at[0], at[1])).map(([k]) => k);
  return [...chain, "esri"];
}

/* ---------------- loading tiles ---------------- */

const MAX_IN_FLIGHT = 6;
const HOST_GIVE_UP = 6;
const TILE_TIMEOUT = 20_000;

let inFlight = 0;
const waiting: (() => void)[] = [];
const hostFailures = new Map<string, number>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const hostDead = (host: string) => (hostFailures.get(host) ?? 0) >= HOST_GIVE_UP;
const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

async function takeSlot(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++;
    return;
  }
  // The slot is handed over directly by the finishing load, so inFlight stays counted.
  await new Promise<void>((ok) => waiting.push(ok));
}

function giveSlot(): void {
  const next = waiting.shift();
  if (next) next();
  else inFlight--;
}

/**
 * A tile as an ImageBitmap with no colour management (Terrarium heights are raw RGB). null for a
 * 404 (no tile there) or a host given up for the session; throws after the last failed attempt.
 * At most six loads run at once, module-wide.
 */
export async function loadBitmap(url: string, attempts = 3): Promise<ImageBitmap | null> {
  const host = hostOf(url);
  if (hostDead(host)) return null;
  await takeSlot();
  try {
    for (let a = 0; a < attempts; a++) {
      if (hostDead(host)) return null;
      try {
        const r = await fetch(url, { mode: "cors", signal: AbortSignal.timeout(TILE_TIMEOUT) });
        if (r.status === 404) {
          hostFailures.set(host, 0);
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        hostFailures.set(host, 0);
        return bmp;
      } catch (e) {
        hostFailures.set(host, (hostFailures.get(host) ?? 0) + 1);
        if (a === attempts - 1) throw new Error(`Could not load ${url}: ${(e as Error).message}`);
        await sleep(500 * 2 ** a);
      }
    }
    return null;
  } finally {
    giveSlot();
  }
}

/** Pixels of a bitmap (or part of it, unscaled), via a small canvas. */
function readPixels(bmp: ImageBitmap, sx = 0, sy = 0, span = 256): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(span, span);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  if (sx === 0 && sy === 0 && span === 256) ctx.drawImage(bmp, 0, 0);
  else ctx.drawImage(bmp, sx, sy, span, span, 0, 0, span, span);
  return ctx.getImageData(0, 0, span, span).data;
}

/* ---------------- colour balance ---------------- */

/** Sources whose colour is matched to Esri's (NSW's mosaic can carry a strong blue cast). */
const BALANCED = new Set<ImagerySource>(["nsw"]);
const balanceCache = new Map<string, Promise<ColourTransform | null>>();

export function colourBalance(source: ImagerySource, z: number, x: number, y: number): Promise<ColourTransform | null> {
  if (!BALANCED.has(source)) return Promise.resolve(null);
  const key = `${source}/${z}/${x},${y}`;
  let p = balanceCache.get(key);
  if (!p) {
    p = fitBalance(source, z, x, y).catch(() => null);
    balanceCache.set(key, p);
  }
  return p;
}

async function fitBalance(source: ImagerySource, z: number, x: number, y: number): Promise<ColourTransform | null> {
  const zr = Math.min(z, 18);
  const up = z - zr;
  const rx = x >> up, ry = y >> up;
  const [ours, ref] = await Promise.all([loadBitmap(tileUrl(source, z, x, y)), loadBitmap(tileUrl("esri", zr, rx, ry))]);
  if (!ours || !ref) return null;
  const span = 256 >> up;
  const reference = readPixels(ref, (x - (rx << up)) * span, (y - (ry << up)) * span, span);
  const own = readPixels(ours);
  ours.close?.();
  ref.close?.();
  return matchColours(own, reference);
}

/* ---------------- chunk imagery ---------------- */

const OLIVE = "#56603f";
let gapChunks = 0;
let gapMessage: string | null = null;

/** Count a chunk whose last source still left gaps, as one data warning for the build. */
function noteGapChunk(): void {
  const at = gapMessage ? dataWarnings.indexOf(gapMessage) : -1;
  gapChunks = at < 0 ? 1 : gapChunks + 1;
  const message = `${gapChunks} aerial photo chunks with gaps`;
  if (at < 0) warnMissing(message);
  else dataWarnings[at] = message;
  gapMessage = message;
}

/** One north-up aerial texture (size x size) for a terrain chunk, best source first, gaps filled from the next. */
export async function loadChunkImagery(
  proj: LocalProjection,
  chunk: TerrainChunk,
  zoom: number,
  size: number,
  previews: Map<string, OffscreenCanvas>,
  chain: ImagerySource[] = ["esri"],
  used?: Set<ImagerySource>,
): Promise<{ data: Uint8Array; ext: "dds"; rgba: Uint8ClampedArray } | null> {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  const box: Bounds = { minX: chunk.minX, minY: chunk.minY, maxX: chunk.maxX, maxY: chunk.maxY };
  const usedHere: ImagerySource[] = [];
  let drewAny = false;
  let gaps = false;

  for (let k = 0; k < chain.length; k++) {
    const source = chain[k];
    const z = Math.min(IMAGERY[source].maxZoom, zoom);
    const p0 = proj.localToPixel([chunk.minX, chunk.maxY], z);
    const p1 = proj.localToPixel([chunk.maxX, chunk.minY], z);
    const scale = size / (p1[0] - p0[0]);
    const range = tilesCovering(proj, box, z);
    const jobs: { tx: number; ty: number; bmp: Promise<ImageBitmap | null> }[] = [];
    for (let ty = range.y0; ty <= range.y1; ty++) {
      for (let tx = range.x0; tx <= range.x1; tx++) jobs.push({ tx, ty, bmp: loadBitmap(tileUrl(source, z, tx, ty)).catch(() => null) });
    }
    const bitmaps = await Promise.all(jobs.map((j) => j.bmp));
    ctx.globalCompositeOperation = k === 0 ? "source-over" : "destination-over";
    gaps = false;
    jobs.forEach(({ tx, ty }, i) => {
      const bmp = bitmaps[i];
      if (!bmp) {
        gaps = true;
        return;
      }
      const side = 256 * scale + 0.5;
      ctx.drawImage(bmp, (tx * 256 - p0[0]) * scale, (ty * 256 - p0[1]) * scale, side, side);
      bmp.close?.();
      drewAny = true;
      used?.add(source);
      if (!usedHere.includes(source)) usedHere.push(source);
    });
    if (!gaps) break;
  }
  if (gaps) noteGapChunk();
  if (!drewAny) return null;

  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = OLIVE;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "source-over";

  const image = ctx.getImageData(0, 0, size, size);
  const rgba = image.data;
  const centre: [number, number] = [(chunk.minX + chunk.maxX) / 2, (chunk.minY + chunk.maxY) / 2];
  for (const source of usedHere) {
    const z = Math.min(IMAGERY[source].maxZoom, zoom);
    const [cx, cy] = proj.localToPixel(centre, z);
    const t = await colourBalance(source, z, Math.floor(cx / 256), Math.floor(cy / 256));
    if (t) {
      applyColours(rgba, t);
      ctx.putImageData(image, 0, 0);
      break;
    }
  }
  previews.set(chunk.key, canvas);
  return { data: encodeDdsDxt1(rgba, size, size), ext: "dds", rgba };
}

/* ---------------- elevation ---------------- */

export type DemSource = "qld" | "nsw" | "vic" | "wa";

/** The app's own static files (the WA tiles live under public/). */
const BASE_URL: string = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";

interface StateDem { label: string; url: string; box: [number, number, number, number]; credit: string }

// key: [label, where, box (west, south, east, north), credit (README)], in the order they fill (Terrarium measures tree tops).
const DEM_TABLE: [DemSource, string, string, [number, number, number, number], string][] = [
  ["qld", "Qld", "https://spatial-img.information.qld.gov.au/arcgis/rest/services/Elevation/QldDem/ImageServer/exportImage", [137.9, -29.3, 153.7, -9], "Queensland Digital Elevation Model (c) State of Queensland; (c) Commonwealth of Australia (Geoscience Australia)"],
  ["nsw", "NSW", "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer/exportImage", [140.9, -37.6, 153.7, -28.1], "NSW 5 m elevation (c) Department of Customer Service NSW (Spatial Services)"],
  ["vic", "Vic", "https://tiles-ap1.arcgis.com/P744lA0wf4LlBZ84/arcgis/rest/services/Vicmap_10m_DEM/ImageServer/tile", [140.9, -39.3, 150.1, -33.9], "Vicmap Elevation 10 m DEM (c) State of Victoria (Department of Transport and Planning)"],
  // The box must take in every box scripts/dem/make_wa_tiles.py has cut. Tiles at zooms 10 to 15
  // (WA_ZOOMS); 10 to 14 are averaged from 15 by scripts/dem/make_wa_overviews.py.
  ["wa", "WA 5 m", `${BASE_URL}dem/wa`, [114.98, -33.74, 115.54, -33.52], "Digital Elevation Model of Australia derived from LiDAR 5 m grid (c) Commonwealth of Australia (Geoscience Australia), CC BY 4.0"],
];

export const STATE_DEMS: Readonly<Record<DemSource, Readonly<StateDem>>> = Object.fromEntries(
  DEM_TABLE.map(([key, label, url, box, credit]) => [key, { label, url, box, credit: `Elevation: ${credit}` }]),
) as Record<DemSource, StateDem>;

const DEM_KEYS = Object.keys(STATE_DEMS) as DemSource[];
export const DEM_CREDIT = Object.fromEntries(DEM_KEYS.map((k) => [k, STATE_DEMS[k].credit])) as Record<DemSource, string>;
export const DEM_LABEL = Object.fromEntries(DEM_KEYS.map((k) => [k, STATE_DEMS[k].label])) as Record<DemSource, string>;

/** The zooms public/dem/wa holds: 15 cut from the LiDAR, 10 to 14 averaged from it. */
export const WA_ZOOMS = [10, 15] as const;

const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const TILE = 256;

/** Terrarium RGBA to heights (NaN where alpha is 0): core's decoder, re-exported. */
export const decodeTerrarium = decodeTerrariumTile;

/**
 * The (ox, oy) sub-tile, 2^up to a side, of a 256 x 256 tile, resampled bilinearly to 256 x 256.
 * Positions clamp at the tile's edge (there's no neighbour tile to blend with).
 */
export function upsample(parent: Float32Array, ox: number, oy: number, up: number): Float32Array {
  const span = TILE >> up;
  const k = 2 ** up;
  const out = new Float32Array(TILE * TILE);
  const clamp = (v: number) => Math.min(254.999, Math.max(0, v));
  for (let r = 0; r < TILE; r++) {
    const fy = clamp(oy * span + (r + 0.5) / k - 0.5);
    const y0 = Math.floor(fy), ty = fy - y0;
    for (let c = 0; c < TILE; c++) {
      const fx = clamp(ox * span + (c + 0.5) / k - 0.5);
      const x0 = Math.floor(fx), tx = fx - x0;
      const i = y0 * TILE + x0;
      const top = parent[i] + (parent[i + 1] - parent[i]) * tx;
      const bottom = parent[i + TILE] + (parent[i + TILE + 1] - parent[i + TILE]) * tx;
      out[r * TILE + c] = top + (bottom - top) * ty;
    }
  }
  return out;
}

const usable = (h: number) => Number.isFinite(h) && h > -100 && h < 9000;

/** Global Terrarium heights over the bounds; missing tiles are no data, filled from their neighbours. */
async function loadTerrarium(proj: LocalProjection, bounds: Bounds, zoom: number, onTile?: (done: number, total: number) => void): Promise<HeightFn> {
  let z = Math.min(15, zoom);
  while (z > 10 && demTilesFor(proj, bounds, z).length > 300) z--;
  const tiles = demTilesFor(proj, bounds, z);
  let done = 0;
  let missing = 0;
  const canvas = new OffscreenCanvas(TILE, TILE);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const decoded = await Promise.all(tiles.map(async ({ x, y }) => {
    const url = TERRARIUM_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
    const bmp = await loadBitmap(url).catch(() => null);
    onTile?.(++done, tiles.length);
    let rgba: Uint8Array | Uint8ClampedArray;
    if (bmp) {
      ctx.clearRect(0, 0, TILE, TILE);
      ctx.drawImage(bmp, 0, 0);
      rgba = ctx.getImageData(0, 0, TILE, TILE).data;
      bmp.close?.();
    } else {
      missing++;
      rgba = new Uint8Array(TILE * TILE * 4); // transparent: no data, never a made-up height
    }
    return { x, y, rgba };
  }));
  if (missing) warnMissing(`${missing} elevation tiles (Terrarium)`);
  const grid = DemGrid.fromTiles(proj, z, decoded);
  if (grid.filled > 0) console.warn(`elevation: ${grid.filled} cells without data, filled from their neighbours`);
  return grid.sample;
}

/** A height sampler over the bounds: state bare-earth models where they cover, Terrarium for the rest. */
export async function loadDem(
  proj: LocalProjection,
  bounds: Bounds,
  zoom: number,
  onTile?: (done: number, total: number) => void,
  used?: Set<DemSource>,
): Promise<HeightFn> {
  const terrarium = await loadTerrarium(proj, bounds, zoom, onTile);
  const [lng, lat] = proj.toLngLat([(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2]);
  const models = DEM_KEYS.filter((k) => {
    const [w, s, e, n] = STATE_DEMS[k].box;
    return lng > w && lng < e && lat > s && lat < n;
  });
  if (!models.length) return terrarium;

  let z = zoom >= 14 ? 16 : 13;
  while (demTilesFor(proj, bounds, z).length > 200 && z > Math.min(15, zoom)) z--;
  const tiles = demTilesFor(proj, bounds, z).map(({ x, y }) => ({ x, y, heights: new Float32Array(TILE * TILE).fill(NaN) }));

  const found: DemSource[] = [];
  for (const model of models) {
    const pending = tiles.filter((t) => !t.heights.every(usable));
    if (!pending.length) break;
    const got = await fetchModel(model, z, pending);
    let any = false;
    for (const t of pending) {
      const h = got.get(`${t.x},${t.y}`);
      if (!h) continue;
      any = true;
      for (let i = 0; i < h.length; i++) if (!usable(t.heights[i]) && usable(h[i])) t.heights[i] = h[i];
    }
    if (any) found.push(model);
  }
  if (!found.length) return terrarium;

  for (const t of tiles) {
    for (let row = 0; row < TILE; row++) {
      for (let col = 0; col < TILE; col++) {
        const i = row * TILE + col;
        if (usable(t.heights[i])) continue;
        const [x, y] = proj.pixelToLocal([t.x * TILE + col + 0.5, t.y * TILE + row + 0.5], z);
        t.heights[i] = terrarium(x, y);
      }
    }
  }
  for (const k of found) used?.add(k);
  return DemGrid.fromHeights(proj, z, tiles).sample;
}

/* ---- state models: fetching one model's tiles ---- */

type Heights = Map<string, Float32Array | null>;
type Job = () => Promise<void>;

const MODEL_GIVE_UP = 4;
const modelFailures = new Map<DemSource, number>();

/** A request that failed after its retries (network, timeout, 5xx), as opposed to an answer of "no data". */
class Unreachable extends Error {}

/**
 * GET with the downloads' usual retries (4 attempts, backing off 1, 3, 7 s on network errors,
 * timeouts, 429 and 5xx; as fetchRetry, but each attempt gets its own timeout). The answer when
 * OK, null for any other answer (404 and the like: no data), throws when it never answered.
 */
async function getOrThrow(url: string, timeout: number): Promise<Response | null> {
  let last = "no answer";
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      if (r.ok) return r;
      if (r.status !== 429 && r.status < 500) return null;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
    if (a < 3) await sleep(1000 * (2 ** (a + 1) - 1));
  }
  throw new Unreachable(last);
}

const allUnusable = (h: Float32Array) => !h.some(usable);

async function fetchModel(model: DemSource, z: number, tiles: { x: number; y: number }[]): Promise<Heights> {
  const out: Heights = new Map();
  const jobs: Job[] = [];
  const put = (x: number, y: number, h: Float32Array | null) => out.set(`${x},${y}`, h && !allUnusable(h) ? h : null);

  if (model === "wa" || model === "vic") {
    const zp = Math.min(z, 15);
    const up = z - zp;
    // One request per parent tile, shared by its children.
    const parents = new Map<string, { px: number; py: number; children: { x: number; y: number }[] }>();
    for (const t of tiles) {
      const px = t.x >> up, py = t.y >> up;
      const key = `${px},${py}`;
      const p = parents.get(key);
      if (p) p.children.push(t);
      else parents.set(key, { px, py, children: [t] });
    }
    for (const { px, py, children } of parents.values()) {
      jobs.push(async () => {
        // Below WA_ZOOMS[0] there are no WA tiles: no data, without asking.
        const h = model === "vic" ? await readLercTile(`${STATE_DEMS.vic.url}/${zp}/${py}/${px}`)
          : zp >= WA_ZOOMS[0] ? await readTerrariumPng(`${STATE_DEMS.wa.url}/${zp}/${px}/${py}.png`) : null;
        for (const { x, y } of children) put(x, y, h && up > 0 ? upsample(h, x - (px << up), y - (py << up), up) : h);
      });
    }
  } else {
    const blocks = new Map<string, { x: number; y: number }[]>();
    for (const t of tiles) {
      const key = `${Math.floor(t.x / 8)},${Math.floor(t.y / 8)}`;
      const list = blocks.get(key);
      if (list) list.push(t);
      else blocks.set(key, [t]);
    }
    for (const list of blocks.values()) {
      jobs.push(async () => {
        const tx0 = Math.min(...list.map((t) => t.x)), ty0 = Math.min(...list.map((t) => t.y));
        const nx = Math.max(...list.map((t) => t.x)) - tx0 + 1, ny = Math.max(...list.map((t) => t.y)) - ty0 + 1;
        const block = await readExportImage(STATE_DEMS[model].url, z, tx0, ty0, nx, ny);
        const w = nx * TILE;
        for (const { x, y } of list) {
          if (!block) {
            put(x, y, null);
            continue;
          }
          const h = new Float32Array(TILE * TILE);
          const ox = (x - tx0) * TILE, oy = (y - ty0) * TILE;
          for (let r = 0; r < TILE; r++) h.set(block.subarray((oy + r) * w + ox, (oy + r) * w + ox + TILE), r * TILE);
          put(x, y, h);
        }
      });
    }
  }

  let unreachable = false;
  for (let i = 0; i < jobs.length; i += 4) {
    await Promise.all(jobs.slice(i, i + 4).map(async (job) => {
      if ((modelFailures.get(model) ?? 0) >= MODEL_GIVE_UP) return;
      try {
        await job();
        modelFailures.set(model, 0);
      } catch (e) {
        modelFailures.set(model, (modelFailures.get(model) ?? 0) + 1);
        unreachable = true;
        console.warn(`elevation: ${STATE_DEMS[model].label} request failed`, (e as Error).message);
      }
    }));
  }
  if (unreachable || (modelFailures.get(model) ?? 0) >= MODEL_GIVE_UP) warnMissing(`elevation: ${STATE_DEMS[model].label} model unreachable`);
  return out;
}

/** A Terrarium PNG served by the app (null when absent: a 404, or Vite's index.html for a missing file). */
async function readTerrariumPng(url: string): Promise<Float32Array | null> {
  const r = await getOrThrow(url, 20_000);
  if (!r || !/png/i.test(r.headers.get("content-type") ?? "")) return null;
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const px = readPixels(bmp);
  bmp.close?.();
  return decodeTerrarium(px);
}

type Lerc = typeof import("lerc");
let lerc: Promise<Lerc> | null = null;

function loadLerc(): Promise<Lerc> {
  lerc ??= (async () => {
    const mod = await import("lerc");
    const wasm = (await import("lerc/lerc-wasm.wasm?url")).default;
    await mod.load({ locateFile: () => wasm });
    return mod;
  })().catch((e) => {
    lerc = null;
    throw e;
  });
  return lerc;
}

/** One Vicmap LERC tile: 257 x 257 corner samples, each pixel the mean of its four corners. */
async function readLercTile(url: string): Promise<Float32Array | null> {
  const r = await getOrThrow(url, 20_000);
  if (!r) return null;
  const bytes = await r.arrayBuffer();
  const { decode } = await loadLerc();
  const img = decode(bytes);
  const N = TILE + 1;
  if (img.width < N || img.height < N) return null;
  const band = img.pixels[0];
  const mask = img.mask;
  const at = (c: number, r: number) => {
    const i = r * img.width + c;
    return mask && mask[i] === 0 ? NaN : Number(band[i]);
  };
  const out = new Float32Array(TILE * TILE);
  for (let row = 0; row < TILE; row++) {
    for (let col = 0; col < TILE; col++) out[row * TILE + col] = (at(col, row) + at(col + 1, row) + at(col, row + 1) + at(col + 1, row + 1)) / 4;
  }
  return out;
}

/** An ArcGIS exportImage block of raw float32 heights (rows from the north). */
async function readExportImage(base: string, z: number, tx0: number, ty0: number, nx: number, ny: number): Promise<Float32Array | null> {
  const [xmin, ymin, xmax, ymax] = mercatorBox(z, tx0, ty0, nx, ny);
  const w = nx * TILE, h = ny * TILE;
  const url = `${base}?bbox=${xmin},${ymin},${xmax},${ymax}&bboxSR=3857&imageSR=3857&size=${w},${h}&format=bip&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`;
  const r = await getOrThrow(url, 45_000);
  if (!r) return null;
  const buf = await r.arrayBuffer();
  if (buf.byteLength < w * h * 4) return null;
  const view = new DataView(buf);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}
