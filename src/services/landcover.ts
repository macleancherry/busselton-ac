// Busselton fork: vineyards and paddocks beside the road (ROADMAP.md phase C, landscape zones),
// from the OpenFreeMap vector tiles' landcover layer (OpenMapTiles schema: class farmland with
// subclass vineyard, farmland or farm; class grass with subclass meadow). Only the z14 tiles the
// route passes through are fetched, so a 30 km country road asks for a strip of tiles, not its box.

import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { lngLatToPixel, pixelToLngLat, type LngLat } from "../core/geo";
import type { FarmPolygon } from "../core/farm";
import { fetchRetry, warnMissing } from "./dataWarnings";
import { clipToTile, signedArea, tileTemplate, type P } from "./vectorTiles";

const Z = 14;

/** Which farm kind a landcover feature is, or undefined to skip it. */
export function farmKind(p: Record<string, unknown>): FarmPolygon["kind"] | undefined {
  if (p.class === "farmland" && p.subclass === "vineyard") return "vineyard";
  if (p.class === "farmland" && (p.subclass === "farmland" || p.subclass === "farm")) return "paddock";
  if (p.class === "grass" && p.subclass === "meadow") return "paddock";
  return undefined;
}

/** z14 tiles within `reach` metres of the points (sampled every ~100 m), in a fixed order. */
export function tilesNear(pts: LngLat[], reach: number): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  const add = (p: LngLat) => {
    const m = 256 * 2 ** Z / (40075016 * Math.cos((p[1] * Math.PI) / 180)); // pixels per metre
    const a = lngLatToPixel(p, Z);
    for (const dx of [-reach, 0, reach]) for (const dy of [-reach, 0, reach]) {
      const tx = Math.floor((a[0] + dx * m) / 256), ty = Math.floor((a[1] + dy * m) / 256);
      const k = `${tx},${ty}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push([tx, ty]);
      }
    }
  };
  for (let i = 0; i < pts.length; i++) {
    add(pts[i]);
    // Fill gaps between far-apart points so no tile along the way is missed.
    if (i + 1 < pts.length) {
      const q = pts[i + 1];
      const d = Math.hypot((q[0] - pts[i][0]) * 111320 * Math.cos((q[1] * Math.PI) / 180), (q[1] - pts[i][1]) * 111320);
      const n = Math.floor(d / 100);
      for (let k = 1; k <= n; k++) add([pts[i][0] + ((q[0] - pts[i][0]) * k) / (n + 1), pts[i][1] + ((q[1] - pts[i][1]) * k) / (n + 1)]);
    }
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** Vineyard and paddock polygons in the tiles within `reach` m of the route (clipped to their tiles). */
export async function fetchFarmland(pts: LngLat[], reach: number): Promise<FarmPolygon[]> {
  const url = await tileTemplate();
  const tiles = tilesNear(pts, reach);
  if (tiles.length > 600) throw new Error("Route too long for farmland tiles");
  let missing = 0;
  // One slot per tile, joined in tile order, so every build comes out the same.
  const slots = await Promise.all(tiles.map(async ([tx, ty]) => {
    const out: FarmPolygon[] = [];
    const r = await fetchRetry(url.replace("{z}", String(Z)).replace("{x}", String(tx)).replace("{y}", String(ty)));
    if (!r?.ok) {
      if (r?.status !== 404) missing++;
      return out;
    }
    const tile = new VectorTile(new PbfReader(new Uint8Array(await r.arrayBuffer())));
    const l = tile.layers.landcover;
    for (let i = 0; l && i < l.length; i++) {
      const f = l.feature(i);
      const kind = f.type === 3 ? farmKind(f.properties) : undefined;
      if (!kind) continue;
      const ext = l.extent;
      let poly: FarmPolygon | null = null;
      for (const ring of f.loadGeometry()) {
        const clipped = clipToTile(ring.slice(0, -1), ext);
        if (clipped.length < 3) continue;
        const onSeam = (p: P, q: P) => (p.x <= 0 && q.x <= 0) || (p.x >= ext && q.x >= ext) || (p.y <= 0 && q.y <= 0) || (p.y >= ext && q.y >= ext);
        const edge = clipped.map((p, k) => !onSeam(p, clipped[(k + 1) % clipped.length]));
        const ll = clipped.map((p) => pixelToLngLat([(tx + p.x / ext) * 256, (ty + p.y / ext) * 256], Z));
        if (signedArea(ring) > 0) {
          poly = { kind, rings: [ll], edge: [edge] };
          out.push(poly);
        } else if (poly) {
          poly.rings.push(ll);
          poly.edge.push(edge);
        }
      }
    }
    return out;
  }).map((p) => p.catch(() => {
    missing++;
    return [] as FarmPolygon[];
  })));
  if (missing) warnMissing(`${missing} farmland tiles (vineyards, paddock fences)`);
  return slots.flat();
}
