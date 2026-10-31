// Geographic helpers and the local frame every build is placed in.
// Written from docs/specs/geo.md.
//
// The local frame is Web Mercator scaled by cos(origin latitude): true metres at the origin,
// conformal everywhere, and a linear map of web-map tile pixels, so DEM and aerial tiles line
// up with the geometry without reprojection. scripts/blender/landmarks/common.py and
// scripts/check/check_build.py copy these formulas and constants: don't change them.
//
// No antimeridian or polar handling anywhere: fine for Australia.
// Local metres are x east, y north. Converting to Assetto Corsa (x east, y up, z south) is the
// caller's job (AC z = -local y), not this module's.

/** [longitude, latitude] in degrees, WGS84, longitude first. */
export type LngLat = [lng: number, lat: number];
/** Local metres [x, y]: x east, y north, origin at the projection's origin. Also used for global pixels. */
export type Vec2 = [x: number, y: number];
/** An axis-aligned box in local metres. */
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
/** Inclusive tile index ranges; y0 is the northern row. */
export type TileRange = { x0: number; y0: number; x1: number; y1: number };

/** WGS84 semi-major axis in metres (the Web Mercator sphere). */
export const EARTH_RADIUS = 6378137;

/** Mean Earth radius in metres, used by `haversine` only (see the spec on the two radii). */
const MEAN_RADIUS = 6371008.8;
const TILE_PX = 256;
const LAT_LIMIT = 85.0511;
const DEG = Math.PI / 180;

const worldPixels = (zoom: number): number => TILE_PX * Math.pow(2, zoom);
const clampTo = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Spherical Mercator metres of a point (no clamp). */
function mercator(lngDeg: number, latDeg: number): Vec2 {
  return [EARTH_RADIUS * lngDeg * DEG, EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (latDeg * DEG) / 2))];
}

/** Great-circle distance in metres on a sphere of the mean Earth radius (not EARTH_RADIUS). */
export function haversine(from: LngLat, to: LngLat): number {
  const lat1 = from[1] * DEG, lat2 = to[1] * DEG;
  const halfDLat = Math.sin((lat2 - lat1) / 2);
  const halfDLng = Math.sin(((to[0] - from[0]) * DEG) / 2);
  const h = halfDLat * halfDLat + Math.cos(lat1) * Math.cos(lat2) * halfDLng * halfDLng;
  return 2 * MEAN_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Global Web Mercator pixel position at a zoom (256 px tiles, x east, y south, (0, 0) at the
 * world's north-west corner). The result is pixels, not metres. Latitude is clamped to ±85.0511.
 */
export function lngLatToPixel(ll: LngLat, zoom: number): Vec2 {
  const world = worldPixels(zoom);
  const sinLat = Math.sin(clampTo(ll[1], -LAT_LIMIT, LAT_LIMIT) * DEG);
  const x = world * (ll[0] + 180) / 360;
  const y = world * (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI));
  return [x, y];
}

/** Inverse of `lngLatToPixel` (no clamping). */
export function pixelToLngLat(pixel: Vec2, zoom: number): LngLat {
  const world = worldPixels(zoom);
  const lng = 360 * (pixel[0] / world) - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * pixel[1] / world))) / DEG;
  return [lng, lat];
}

/** The local metric frame around an origin. */
export class LocalProjection {
  /** cos(origin latitude): the frame's scale against Mercator metres. */
  private readonly scale: number;
  /** The origin in Mercator metres. */
  private readonly base: Vec2;
  /** The origin's global pixel position per zoom (callers convert per DEM sample). */
  private readonly pixelOrigins = new Map<number, Vec2>();

  constructor(readonly origin: LngLat) {
    this.scale = Math.cos(origin[1] * DEG);
    this.base = mercator(origin[0], origin[1]);
  }

  toLocal(ll: LngLat): Vec2 {
    const [mx, my] = mercator(ll[0], ll[1]);
    return [(mx - this.base[0]) * this.scale, (my - this.base[1]) * this.scale];
  }

  toLngLat(local: Vec2): LngLat {
    const mx = this.base[0] + local[0] / this.scale;
    const my = this.base[1] + local[1] / this.scale;
    const lat = 2 * Math.atan(Math.exp(my / EARTH_RADIUS)) - Math.PI / 2;
    return [mx / EARTH_RADIUS / DEG, lat / DEG];
  }

  /** Local metres per global pixel at a zoom; the same everywhere in the frame. */
  metresPerPixel(zoom: number): number {
    return this.scale * (2 * Math.PI * EARTH_RADIUS) / worldPixels(zoom);
  }

  localToPixel(local: Vec2, zoom: number): Vec2 {
    const at = this.pixelOrigin(zoom);
    const perPx = this.metresPerPixel(zoom);
    return [at[0] + local[0] / perPx, at[1] - local[1] / perPx];
  }

  pixelToLocal(pixel: Vec2, zoom: number): Vec2 {
    const at = this.pixelOrigin(zoom);
    const perPx = this.metresPerPixel(zoom);
    return [perPx * (pixel[0] - at[0]), perPx * (at[1] - pixel[1])];
  }

  private pixelOrigin(zoom: number): Vec2 {
    const cached = this.pixelOrigins.get(zoom);
    if (cached) return cached;
    const fresh = lngLatToPixel(this.origin, zoom);
    this.pixelOrigins.set(zoom, fresh);
    return fresh;
  }
}

/**
 * The box around the points, each side pushed out by `pad`. An empty list gives an inverted
 * infinite box (min = +Infinity, max = -Infinity), so ranges built from it are empty.
 */
export function boundsOf(pts: Vec2[], pad = 0): Bounds {
  const box: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    box.minX = Math.min(box.minX, p[0]);
    box.maxX = Math.max(box.maxX, p[0]);
    box.minY = Math.min(box.minY, p[1]);
    box.maxY = Math.max(box.maxY, p[1]);
  }
  box.minX -= pad;
  box.minY -= pad;
  box.maxX += pad;
  box.maxY += pad;
  return box;
}

/** Inclusive tile index ranges at a zoom covering the box; north is the lower y index. */
export function tilesCovering(projection: LocalProjection, box: Bounds, zoom: number): TileRange {
  const lastTile = Math.pow(2, zoom) - 1;
  const tileOf = (px: number): number => clampTo(Math.floor(px / TILE_PX), 0, lastTile);
  const [nwX, nwY] = projection.localToPixel([box.minX, box.maxY], zoom);
  const [seX, seY] = projection.localToPixel([box.maxX, box.minY], zoom);
  return { x0: tileOf(nwX), y0: tileOf(nwY), x1: tileOf(seX), y1: tileOf(seY) };
}
