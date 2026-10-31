// OpenFreeMap vector tiles (OpenMapTiles schema): keyless, from a CDN, so reliably up where the
// public Overpass servers often aren't. z14 gives buildings, roads, names, points of interest,
// waterways and shopping landuse; z13 the sea, piers, beaches and landcover.
//
// Written from docs/specs/vectorTiles.md. Tiles are always joined in row-major order (rows outer,
// columns inner), never arrival order, so the same answers give the same track.

import { VectorTile, type VectorTileLayer } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { lngLatToPixel, pixelToLngLat, type LngLat } from "../core/geo";
import type { LandcoverPolygon } from "../core/zones";
import { fetchRetry, warnMissing } from "./dataWarnings";
import { nearestLine } from "./nearestLine";

const TILEJSON = "https://tiles.openfreemap.org/planet";

let template: Promise<string> | null = null;

/** The tile URL template from OpenFreeMap's TileJSON, fetched once a session (again after a failure). */
export function tileTemplate(): Promise<string> {
  template ??= (async () => {
    const r = await fetchRetry(TILEJSON);
    if (!r || !r.ok) throw new Error("map tile index unavailable");
    const tj = (await r.json()) as { tiles?: string[] };
    if (!tj?.tiles?.[0]) throw new Error("map tile index unavailable");
    return tj.tiles[0];
  })().catch((e) => {
    template = null;
    throw e;
  });
  return template;
}

const tileUrl = (t: string, z: number, x: number, y: number) => t.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));

export interface TileBuilding { ring: LngLat[]; tags: Record<string, string> }
export interface TileRoad { pts: LngLat[]; cls: string; subclass?: string; bicycle?: string; surface?: string; brunnel?: string; oneway?: 1 | -1; service?: string }
export interface TileName { pts: LngLat[]; name: string; cls: string }
export interface TilePoi { at: LngLat; cls: string; subclass: string; name?: string; rank?: number }
export interface TileWaterway { pts: LngLat[]; cls: string; brunnel?: string }
export interface TileFeatures {
  buildings: TileBuilding[];
  roads: TileRoad[];
  names: TileName[];
  pois: TilePoi[];
  waterways: TileWaterway[];
  landuse: { ring: LngLat[]; cls: string }[];
}

export type P = { x: number; y: number };

/** Sutherland-Hodgman clip of an open ring to [0, extent] on both axes (points on the border are inside). */
export function clipToTile(ring: P[], extent: number): P[] {
  type Edge = { inside: (p: P) => boolean; cross: (a: P, b: P) => P };
  const atX = (c: number) => (a: P, b: P): P => ({ x: c, y: a.y + ((b.y - a.y) * (c - a.x)) / (b.x - a.x) });
  const atY = (c: number) => (a: P, b: P): P => ({ x: a.x + ((b.x - a.x) * (c - a.y)) / (b.y - a.y), y: c });
  const edges: Edge[] = [
    { inside: (p) => p.x >= 0, cross: atX(0) },
    { inside: (p) => p.x <= extent, cross: atX(extent) },
    { inside: (p) => p.y >= 0, cross: atY(0) },
    { inside: (p) => p.y <= extent, cross: atY(extent) },
  ];
  let out = ring;
  for (const edge of edges) {
    if (!out.length) break;
    const input = out;
    out = [];
    let a = input[input.length - 1];
    for (const b of input) {
      if (edge.inside(b)) {
        if (!edge.inside(a)) out.push(edge.cross(a, b));
        out.push(b);
      } else if (edge.inside(a)) {
        out.push(edge.cross(a, b));
      }
      a = b;
    }
  }
  return out;
}

/** Half the shoelace sum over an open ring: positive when clockwise on screen (y down), OpenMapTiles' exteriors. */
export function signedArea(r: P[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j].x * r[i].y) - (r[i].x * r[j].y);
  return s / 2;
}

/** The ring without its closing repeat. */
const open = (ring: P[]): P[] => {
  const n = ring.length;
  return n > 1 && ring[0].x === ring[n - 1].x && ring[0].y === ring[n - 1].y ? ring.slice(0, -1) : ring;
};

const str = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));

/** The tile range covering a [w, s, e, n] box at a zoom. */
function tileRange(bbox: [number, number, number, number], z: number) {
  const [w, s, e, n] = bbox;
  const nw = lngLatToPixel([w, n], z), se = lngLatToPixel([e, s], z);
  const x0 = Math.floor(nw[0] / 256), y0 = Math.floor(nw[1] / 256);
  const x1 = Math.floor(se[0] / 256), y1 = Math.floor(se[1] / 256);
  const list: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) list.push({ x, y });
  return list;
}

/** Fetch and decode one tile: the tile, null for an empty tile (404), or "missing". */
async function loadTile(url: string, notOkIsMissing: (status: number) => boolean): Promise<VectorTile | null | "missing"> {
  const r = await fetchRetry(url);
  if (!r) return "missing";
  if (!r.ok) return notOkIsMissing(r.status) ? "missing" : null;
  try {
    return new VectorTile(new PbfReader(new Uint8Array(await r.arrayBuffer())));
  } catch {
    return "missing";
  }
}

/** Buildings, roads, names, POIs, waterways and shopping landuse over the box (z14). */
export async function fetchTileFeatures(bbox: [number, number, number, number]): Promise<TileFeatures> {
  const t = await tileTemplate();
  const Z = 14;
  const tiles = tileRange(bbox, Z);
  if (tiles.length > 400) throw new Error("Area too large for building tiles");
  let missing = 0;
  const slots = await Promise.all(tiles.map(async ({ x, y }) => {
    const tile = await loadTile(tileUrl(t, Z, x, y), (status) => status !== 404);
    if (tile === "missing") {
      missing++;
      return null;
    }
    if (!tile) return null;
    try {
      return readFeatureTile(tile, x, y);
    } catch {
      missing++;
      return null;
    }
  }));
  const out: TileFeatures = { buildings: [], roads: [], names: [], pois: [], waterways: [], landuse: [] };
  for (const s of slots) {
    if (!s) continue;
    out.buildings.push(...s.buildings);
    out.roads.push(...s.roads);
    out.names.push(...s.names);
    out.pois.push(...s.pois);
    out.waterways.push(...s.waterways);
    out.landuse.push(...s.landuse);
  }
  if (missing > 0) warnMissing(`${missing} map tiles (buildings, streets, shops)`);
  return out;
}

function converter(tx: number, ty: number, extent: number, z: number) {
  return (p: P): LngLat => pixelToLngLat([(tx + p.x / extent) * 256, (ty + p.y / extent) * 256], z);
}

function eachFeature(layer: VectorTileLayer | undefined, fn: (f: ReturnType<VectorTileLayer["feature"]>) => void): void {
  if (!layer) return;
  for (let i = 0; i < layer.length; i++) fn(layer.feature(i));
}

/** Exterior rings (positive area) without the closing point, clipped to the tile, 3+ points. */
function exteriors(geom: P[][], extent: number): P[][] {
  const out: P[][] = [];
  for (const ring of geom) {
    if (signedArea(ring) <= 0) continue;
    const clipped = clipToTile(open(ring), extent);
    if (clipped.length >= 3) out.push(clipped);
  }
  return out;
}

function readFeatureTile(tile: VectorTile, tx: number, ty: number): TileFeatures {
  const out: TileFeatures = { buildings: [], roads: [], names: [], pois: [], waterways: [], landuse: [] };
  const L = tile.layers;

  const building = L.building;
  if (building) {
    const ll = converter(tx, ty, building.extent, 14);
    eachFeature(building, (f) => {
      const tags: Record<string, string> = {};
      for (const [k, v] of Object.entries(f.properties)) tags[k] = String(v);
      for (const ring of exteriors(f.loadGeometry(), building.extent)) out.buildings.push({ ring: ring.map(ll), tags });
    });
  }

  const transport = L.transportation;
  if (transport) {
    const ll = converter(tx, ty, transport.extent, 14);
    eachFeature(transport, (f) => {
      if (f.type !== 2) return;
      const p = f.properties;
      const road: Omit<TileRoad, "pts"> = { cls: str(p.class) ?? "" };
      if (p.surface !== undefined) road.surface = String(p.surface);
      if (p.brunnel !== undefined) road.brunnel = String(p.brunnel);
      if (p.subclass !== undefined) road.subclass = String(p.subclass);
      if (p.bicycle !== undefined) road.bicycle = String(p.bicycle);
      const oneway = Number(p.oneway);
      if (oneway === 1 || oneway === -1) road.oneway = oneway;
      if (p.service !== undefined) road.service = String(p.service);
      for (const line of f.loadGeometry()) out.roads.push({ pts: line.map(ll), ...road });
    });
  }

  const water = L.waterway;
  if (water) {
    const ll = converter(tx, ty, water.extent, 14);
    eachFeature(water, (f) => {
      if (f.type !== 2) return;
      const brunnel = str(f.properties.brunnel);
      for (const line of f.loadGeometry()) {
        const w: TileWaterway = { pts: line.map(ll), cls: str(f.properties.class) ?? "" };
        if (brunnel !== undefined) w.brunnel = brunnel;
        out.waterways.push(w);
      }
    });
  }

  const names = L.transportation_name;
  if (names) {
    const ll = converter(tx, ty, names.extent, 14);
    eachFeature(names, (f) => {
      if (f.type !== 2 || f.properties.name === undefined) return;
      const name = String(f.properties.name), cls = str(f.properties.class) ?? "";
      for (const line of f.loadGeometry()) out.names.push({ pts: line.map(ll), name, cls });
    });
  }

  const poi = L.poi;
  if (poi) {
    const ll = converter(tx, ty, poi.extent, 14);
    eachFeature(poi, (f) => {
      if (f.type !== 1) return;
      const pt = f.loadGeometry()[0]?.[0];
      if (!pt || pt.x < 0 || pt.x >= poi.extent || pt.y < 0 || pt.y >= poi.extent) return;
      const p = f.properties;
      const item: TilePoi = { at: ll(pt), cls: str(p.class) ?? "", subclass: str(p.subclass) ?? "" };
      if (p.name !== undefined) item.name = String(p.name);
      if (typeof p.rank === "number") item.rank = p.rank;
      out.pois.push(item);
    });
  }

  const landuse = L.landuse;
  if (landuse) {
    const ll = converter(tx, ty, landuse.extent, 14);
    eachFeature(landuse, (f) => {
      const cls = f.properties.class;
      if (f.type !== 3 || (cls !== "retail" && cls !== "commercial")) return;
      for (const ring of exteriors(f.loadGeometry(), landuse.extent)) out.landuse.push({ ring: ring.map(ll), cls });
    });
  }
  return out;
}

/* ---------------- coast (z13) ---------------- */

export interface TilePolygon {
  rings: LngLat[][];
  edge: boolean[][];
  /** Busselton fork: the OSM way id, where the tile has it (piers; OpenFreeMap feature id = way id * 10 + 2). */
  id?: number;
}

interface CoastTile { ocean: TilePolygon[]; piers: TilePolygon[]; beaches: TilePolygon[]; landcover: LandcoverPolygon[]; water: TilePolygon[] }

/** Busselton fork: inland water no tree may stand in (OpenMapTiles water classes other than the ocean and pools). */
const INLAND_WATER = new Set(["lake", "river", "pond", "dock", "reservoir", "basin", "lagoon", "water"]);

const LANDCOVER = new Set(["wood", "forest", "wetland", "farmland", "grass", "sand", "rock"]);

/** The sea, polygon piers, beaches and landcover over the box (z13). */
export async function fetchCoast(bbox: [number, number, number, number]): Promise<CoastTile> {
  const t = await tileTemplate();
  const Z = 13;
  const tiles = tileRange(bbox, Z);
  if (tiles.length > 100) throw new Error("Area too large for coast tiles");
  let missing = 0;
  const slots = await Promise.all(tiles.map(async ({ x, y }) => {
    const tile = await loadTile(tileUrl(t, Z, x, y), (status) => status !== 404);
    if (tile === "missing") {
      missing++;
      return null;
    }
    if (!tile) return null;
    try {
      return readCoastTile(tile, x, y);
    } catch {
      missing++;
      return null;
    }
  }));
  const out: CoastTile = { ocean: [], piers: [], beaches: [], landcover: [], water: [] };
  for (const s of slots) {
    if (!s) continue;
    out.ocean.push(...s.ocean);
    out.piers.push(...s.piers);
    out.beaches.push(...s.beaches);
    out.landcover.push(...s.landcover);
    out.water.push(...s.water);
  }
  if (missing > 0) warnMissing(`${missing} coast tiles (sea, piers, beaches)`);
  return out;
}

function readCoastTile(tile: VectorTile, tx: number, ty: number): CoastTile {
  const out: CoastTile = { ocean: [], piers: [], beaches: [], landcover: [], water: [] };
  const read = (
    layer: VectorTileLayer | undefined,
    keep: (p: Record<string, unknown>) => boolean,
    into: TilePolygon[],
    onPolygon?: (poly: TilePolygon, props: Record<string, unknown>, id?: number) => void,
  ) => {
    if (!layer) return;
    const extent = layer.extent;
    const ll = converter(tx, ty, extent, 13);
    eachFeature(layer, (f) => {
      if (f.type !== 3 || !keep(f.properties)) return;
      let current: TilePolygon | null = null;
      for (const raw of f.loadGeometry()) {
        const ring = open(raw);
        const clipped = clipToTile(ring, extent);
        if (clipped.length < 3) continue;
        const edge = clipped.map((a, i) => {
          const b = clipped[(i + 1) % clipped.length];
          const seam = (a.x <= 0 && b.x <= 0) || (a.x >= extent && b.x >= extent) || (a.y <= 0 && b.y <= 0) || (a.y >= extent && b.y >= extent);
          return !seam;
        });
        const pts = clipped.map(ll);
        if (signedArea(ring) > 0) {
          current = { rings: [pts], edge: [edge] };
          into.push(current);
          onPolygon?.(current, f.properties, typeof f.id === "number" ? f.id : undefined);
        } else if (current) {
          current.rings.push(pts);
          current.edge.push(edge);
        }
      }
    });
  };
  const L = tile.layers;
  read(L.water, (p) => p.class === "ocean", out.ocean);
  read(L.water, (p) => INLAND_WATER.has(String(p.class)), out.water);
  read(L.transportation, (p) => p.class === "pier", out.piers, (poly, _p, id) => {
    // Pieces of one pier cut by tile seams share it (swimJetty.ts measures them together).
    if (id && id % 10 === 2) poly.id = Math.floor(id / 10);
  });
  read(L.landcover, (p) => p.class === "sand" && (p.subclass === "beach" || p.subclass === undefined || p.subclass === null), out.beaches);
  read(L.landcover, (p) => LANDCOVER.has(String(p.class)), [], (poly, p) => {
    out.landcover.push({ cls: String(p.class), subclass: typeof p.subclass === "string" ? p.subclass : undefined, rings: poly.rings });
  });
  return out;
}

/* ---------------- class widths and lookups ---------------- */

/** Asphalt width by OpenMapTiles class; other classes (path, rail, ferry...) aren't drivable. */
const CLASS_WIDTH: Record<string, number> = {
  motorway: 7.5, trunk: 7.5, primary: 7.5, secondary: 7, tertiary: 6.5, minor: 6, service: 4, track: 3.5, raceway: 10,
};

/** The drivable roads with their class widths, in input order (for osm.ts widthLookup when Overpass failed). */
export function classWidths(roads: TileRoad[]): { width: number; pts: LngLat[] }[] {
  return roads.filter((r) => Object.hasOwn(CLASS_WIDTH, r.cls)).map((r) => ({ width: CLASS_WIDTH[r.cls], pts: r.pts }));
}

/** p => the class of the drivable road nearest p within 12 m. */
export function roadClassLookup(roads: TileRoad[], lat: number): (p: LngLat) => string | undefined {
  return nearestLine(roads.filter((r) => Object.hasOwn(CLASS_WIDTH, r.cls)).map((r) => ({ pts: r.pts, value: r.cls })), lat, 12);
}
