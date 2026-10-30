// Busselton fork: landscape zones (ROADMAP.md phase C). Each part of the South West gets its own
// trees, ground and roadside: white sand and peppermints on the coast, low heath on the capes,
// tuart woodland on the coastal plain, jarrah-marri forest inland, karri at Boranup and in the
// southern forests, paddocks and vineyards, paperbark and sedge round the Vasse-Wonnerup.
//
// The zone at a point comes from data the build already has, cheapest first:
//   1. landcover polygons from the vector tiles the coast already downloads (wood, wetland,
//      farmland and its vineyards, heath and scrub, sand, rock);
//   2. distance to the sea (the coast polygons), for the coastal band;
//   3. a coarse region map keyed by lng/lat (REGIONS), which says what "wood", "open land" and
//      "the coastal band" mean in that part of the South West.
//
// zoneAt(x, y) is the one interface the rest of the build uses: the zone, and the tree species
// weights there by species name (so new tree models just add names; see resolveSpecies).

import type { LngLat, Vec2 } from "./geo";
import type { TerrainChunk } from "./terrain";
import { decodeOwnPng, encodePng } from "./png";
import { vergeTexture } from "./textures";

export type ZoneName = "coast" | "heath" | "tuart" | "jarrah" | "karri" | "farm" | "vineyard" | "wetland";

/**
 * Tree species by name. The first five have models today (treeSprites.ts TREE_SPECIES, treeModels.ts
 * MODEL_NAMES); the rest fall back to the nearest one that exists (SPECIES_FALLBACK) until their
 * models arrive.
 */
export type SpeciesName = "peppermint" | "sheoak" | "norfolk" | "tuart" | "palm" | "jarrah" | "marri" | "karri" | "paperbark" | "banksia";
export type SpeciesWeights = Partial<Record<SpeciesName, number>>;

/** Ground detail weights for the ksMultilayer mask (textures.ts groundMask): grass, dirt, plain. */
export interface GroundMix {
  grass: number;
  dirt: number;
  plain: number;
}

export interface Zone {
  name: ZoneName;
  /** Tree species weights; null takes the region's woodland species (paddock and vineyard trees are remnant bush). */
  species: SpeciesWeights | null;
  /** Share of the canopy found in the photo that is kept as trees (heath is mostly too low to be a tree). */
  density: number;
  /** Tree scale is multiplied by this and capped at maxScale (heath stays low, coast trees are wind-pruned). */
  scale: number;
  maxScale: number;
  ground: GroundMix;
  /** Gravel verge colour, sRGB. */
  verge: [number, number, number];
}

export const ZONES: Record<ZoneName, Zone> = {
  // White sand, peppermint and she-oak, granite at the capes.
  coast: { name: "coast", species: { peppermint: 4, sheoak: 3, banksia: 1 }, density: 0.7, scale: 0.85, maxScale: 1, ground: { grass: 0.1, dirt: 0.2, plain: 0.7 }, verge: [196, 188, 164] },
  // Capes heath: low scrub on grey sand, no tall trees.
  heath: { name: "heath", species: { banksia: 3, peppermint: 1, sheoak: 1 }, density: 0.25, scale: 0.6, maxScale: 0.45, ground: { grass: 0.15, dirt: 0.45, plain: 0.4 }, verge: [170, 160, 138] },
  // Tuart woodland with a peppermint understorey on the coastal plain's grey sand.
  tuart: { name: "tuart", species: { tuart: 5, peppermint: 4, banksia: 1 }, density: 1, scale: 1, maxScale: 2, ground: { grass: 0.45, dirt: 0.4, plain: 0.15 }, verge: [140, 128, 104] },
  // Jarrah-marri forest on laterite gravel: leaf litter underfoot, orange-brown shoulders.
  jarrah: { name: "jarrah", species: { jarrah: 5, marri: 4, banksia: 1 }, density: 1, scale: 1, maxScale: 2, ground: { grass: 0.15, dirt: 0.75, plain: 0.1 }, verge: [150, 104, 70] },
  // Karri on red-brown loam, marri among it, karri hazel underneath.
  karri: { name: "karri", species: { karri: 6, marri: 3, peppermint: 1 }, density: 1, scale: 1, maxScale: 2.5, ground: { grass: 0.2, dirt: 0.7, plain: 0.1 }, verge: [138, 88, 62] },
  // Paddocks: grass, scattered remnant trees of whatever the bush there was.
  farm: { name: "farm", species: null, density: 0.8, scale: 1, maxScale: 2, ground: { grass: 0.75, dirt: 0.2, plain: 0.05 }, verge: [128, 116, 88] },
  // Vineyards: bare gravelly loam between the rows, few trees (vine rows themselves are separate work).
  vineyard: { name: "vineyard", species: null, density: 0.3, scale: 1, maxScale: 2, ground: { grass: 0.35, dirt: 0.55, plain: 0.1 }, verge: [146, 112, 82] },
  // Vasse-Wonnerup wetlands: paperbark and sedge on dark wet ground.
  wetland: { name: "wetland", species: { paperbark: 6, sheoak: 2, peppermint: 2 }, density: 1, scale: 0.8, maxScale: 1.2, ground: { grass: 0.6, dirt: 0.25, plain: 0.15 }, verge: [96, 92, 78] },
};

/** A species without its own model yet: the model it borrows, and the scale that makes it read right. */
export const SPECIES_FALLBACK: Record<SpeciesName, { as: SpeciesName; scale: number }[]> = {
  peppermint: [],
  sheoak: [{ as: "peppermint", scale: 1 }],
  norfolk: [{ as: "sheoak", scale: 1.6 }],
  tuart: [{ as: "peppermint", scale: 1.6 }],
  palm: [{ as: "peppermint", scale: 1 }],
  // Tall pale gums: the tuart model, karri half as tall again.
  karri: [{ as: "tuart", scale: 1.6 }],
  marri: [{ as: "tuart", scale: 1 }],
  jarrah: [{ as: "marri", scale: 1 }, { as: "tuart", scale: 0.95 }],
  // Bushy, pale-barked, smaller: the peppermint shape.
  paperbark: [{ as: "peppermint", scale: 0.8 }],
  banksia: [{ as: "peppermint", scale: 0.6 }],
};

/** One choice of model for a species: its index in the build's model list, and a scale factor. */
export interface ResolvedSpecies {
  variant: number;
  scale: number;
}

/**
 * Turns species weights into weights over the models the build has (`models`, e.g. MODEL_NAMES or
 * TREE_SPECIES names), following SPECIES_FALLBACK for species without one. Unresolvable species drop out.
 */
export function resolveSpecies(weights: SpeciesWeights, models: readonly string[]): { pick: ResolvedSpecies; weight: number }[] {
  const out: { pick: ResolvedSpecies; weight: number }[] = [];
  const find = (name: SpeciesName, scale: number, depth: number): ResolvedSpecies | null => {
    const i = models.indexOf(name);
    if (i >= 0) return { variant: i, scale };
    if (depth > 4) return null;
    for (const f of SPECIES_FALLBACK[name] ?? []) {
      const r = find(f.as, scale * f.scale, depth + 1);
      if (r) return r;
    }
    return null;
  };
  for (const [name, w] of Object.entries(weights) as [SpeciesName, number][]) {
    if (!(w > 0)) continue;
    const pick = find(name, 1, 0);
    if (!pick) continue;
    const same = out.find((o) => o.pick.variant === pick.variant && o.pick.scale === pick.scale);
    if (same) same.weight += w;
    else out.push({ pick, weight: w });
  }
  return out;
}

/** A weighted choice from resolveSpecies' list with r in [0, 1); null when the list is empty. */
export function choose(list: { pick: ResolvedSpecies; weight: number }[], r: number): ResolvedSpecies | null {
  const total = list.reduce((s, o) => s + o.weight, 0);
  if (!(total > 0)) return null;
  let t = r * total;
  for (const o of list) {
    t -= o.weight;
    if (t < 0) return o.pick;
  }
  return list[list.length - 1].pick;
}

// ---------------------------------------------------------------------------
// The coarse region map.

export interface Region {
  name: string;
  /** Corners, [lng, lat]. */
  poly: LngLat[];
  /** What wooded land (landcover wood, or canopy with no landcover) is here. */
  wood: ZoneName;
  /** What open land with no better landcover is here. */
  open: ZoneName;
  /** The band along the sea and how wide it is, metres. */
  coast: ZoneName;
  coastWidth: number;
}

/**
 * The South West, roughly: first match wins, so the specific places come first. Boundaries are a
 * few kilometres out at best; landcover decides within them, and zoneAt frays the edges.
 */
export const REGIONS: Region[] = [
  // Boranup karri forest, between Caves Road and the coast south of Margaret River.
  { name: "Boranup", poly: [[115.03, -34.04], [115.12, -34.04], [115.13, -34.25], [115.02, -34.25]], wood: "karri", open: "farm", coast: "heath", coastWidth: 1500 },
  // The southern forests: Pemberton, Northcliffe, Walpole.
  { name: "southern forests", poly: [[115.65, -34.25], [116.6, -34.25], [116.6, -34.95], [115.65, -34.95]], wood: "karri", open: "farm", coast: "heath", coastWidth: 1200 },
  // The Vasse and Wonnerup estuaries and their flats, east of Busselton.
  { name: "Vasse-Wonnerup", poly: [[115.36, -33.6], [115.46, -33.59], [115.46, -33.64], [115.4, -33.665], [115.36, -33.655]], wood: "wetland", open: "farm", coast: "coast", coastWidth: 300 },
  // Geographe Bay's sheltered shore, Cape Naturaliste to Busselton: peppermint and tuart.
  { name: "Geographe Bay coast", poly: [[115.0, -33.54], [115.08, -33.57], [115.2, -33.62], [115.36, -33.635], [115.36, -33.675], [115.2, -33.665], [115.08, -33.64], [115.0, -33.6]], wood: "tuart", open: "farm", coast: "coast", coastWidth: 600 },
  // The Leeuwin-Naturaliste capes: heath along the west coast, jarrah-marri on the ridge, vineyards.
  { name: "capes", poly: [[114.95, -33.5], [115.1, -33.5], [115.2, -33.7], [115.22, -34.0], [115.2, -34.45], [114.95, -34.45]], wood: "jarrah", open: "farm", coast: "heath", coastWidth: 1500 },
  // The Swan Coastal Plain, Busselton to Capel and north: tuart woodland and paddocks.
  { name: "coastal plain", poly: [[115.2, -33.2], [115.8, -33.2], [115.8, -33.72], [115.36, -33.7], [115.2, -33.7]], wood: "tuart", open: "farm", coast: "coast", coastWidth: 300 },
  // Whicher Range and the Blackwood Plateau: jarrah-marri.
  { name: "Blackwood Plateau", poly: [[115.2, -33.65], [116.6, -33.65], [116.6, -34.25], [115.2, -34.45]], wood: "jarrah", open: "farm", coast: "coast", coastWidth: 300 },
];

export const DEFAULT_REGION: Region = { name: "elsewhere", poly: [], wood: "tuart", open: "farm", coast: "coast", coastWidth: 300 };

function inRing(x: number, y: number, ring: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The region a lng/lat falls in. */
export function regionAt(lng: number, lat: number): Region {
  return REGIONS.find((r) => inRing(lng, lat, r.poly)) ?? DEFAULT_REGION;
}

// ---------------------------------------------------------------------------
// Landcover: what the vector tiles say the ground is.

/** A landcover polygon from the vector tiles (OpenMapTiles landcover layer): class, subclass, rings. */
export interface LandcoverPolygon {
  cls: string;
  subclass?: string;
  rings: LngLat[][];
}

/** The zone a landcover class means in a region, or null when it says nothing useful (parks, lawns). */
export function landcoverZone(cls: string, subclass: string | undefined, region: Region): ZoneName | null {
  switch (cls) {
    case "wood":
    case "forest":
      return region.wood;
    case "wetland":
      return "wetland";
    case "farmland":
      return subclass === "vineyard" || subclass === "orchard" ? "vineyard" : "farm";
    case "sand":
      return "coast";
    case "rock":
      // Granite at the capes; bare rock inland reads as the coast's ground too.
      return "coast";
    case "grass":
      if (subclass === "heath" || subclass === "scrub" || subclass === "shrubbery" || subclass === "fell") return "heath";
      if (subclass === "grassland" || subclass === "meadow" || subclass === "farmland") return "farm";
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The zone map.

/** What zoneAt answers: the zone, its region, and the tree species weights there. */
export interface ZoneInfo {
  zone: Zone;
  region: Region;
  species: SpeciesWeights;
}

export interface ZoneMapInput {
  /** Local metres to [lng, lat] (Projection.toLngLat). */
  toLngLat: (v: Vec2) => LngLat;
  /** Local metres from [lng, lat] (Projection.toLocal). */
  toLocal: (p: LngLat) => Vec2;
  landcover?: LandcoverPolygon[];
  /** Is this point in the sea (SeaMask.has)? Omit when the build has no sea. */
  sea?: (x: number, y: number) => boolean;
  /** The area the build covers, local metres (for the distance-to-sea grid). */
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
}

interface LocalPoly {
  zoneOf: (r: Region) => ZoneName | null;
  rings: Vec2[][];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Cheap hash of a point to [0, 1), so choices are stable from one build to the next. */
export function hash01(x: number, y: number, salt = 0): number {
  let h = Math.imul(Math.round(x * 10) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(y * 10) | 0, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Distance to the sea on a grid (two-pass chamfer), metres; Infinity with no sea in the bounds.
 * `cell` metres a cell; points outside the grid get the nearest edge cell's distance.
 */
export function seaDistanceField(sea: (x: number, y: number) => boolean, b: { minX: number; minY: number; maxX: number; maxY: number }, cell = 25): (x: number, y: number) => number {
  const w = Math.max(1, Math.ceil((b.maxX - b.minX) / cell) + 1), h = Math.max(1, Math.ceil((b.maxY - b.minY) / cell) + 1);
  const d = new Float32Array(w * h).fill(Infinity);
  let any = false;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (sea(b.minX + c * cell, b.minY + r * cell)) {
        d[r * w + c] = 0;
        any = true;
      }
    }
  }
  if (!any) return () => Infinity;
  const D = cell, DD = cell * Math.SQRT2;
  const relax = (i: number, j: number, k: number) => {
    if (d[j] + k < d[i]) d[i] = d[j] + k;
  };
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      if (c > 0) relax(i, i - 1, D);
      if (r > 0) {
        relax(i, i - w, D);
        if (c > 0) relax(i, i - w - 1, DD);
        if (c < w - 1) relax(i, i - w + 1, DD);
      }
    }
  }
  for (let r = h - 1; r >= 0; r--) {
    for (let c = w - 1; c >= 0; c--) {
      const i = r * w + c;
      if (c < w - 1) relax(i, i + 1, D);
      if (r < h - 1) {
        relax(i, i + w, D);
        if (c < w - 1) relax(i, i + w + 1, DD);
        if (c > 0) relax(i, i + w - 1, DD);
      }
    }
  }
  return (x, y) => {
    const c = Math.max(0, Math.min(w - 1, Math.round((x - b.minX) / cell))), r = Math.max(0, Math.min(h - 1, Math.round((y - b.minY) / cell)));
    return d[r * w + c];
  };
}

/** How far region borders are frayed, metres, so a zone edge isn't a straight line across the land. */
const FRAY = 60;
/** zoneAt answers are cached on a grid this fine, metres. */
const CACHE_CELL = 8;

export class ZoneMap {
  private readonly polys: LocalPoly[];
  private readonly seaDist: (x: number, y: number) => number;
  private readonly cache = new Map<number, ZoneInfo>();

  constructor(private readonly input: ZoneMapInput) {
    this.polys = [];
    for (const p of input.landcover ?? []) {
      // Skip classes that never mean anything (same answer for every region).
      if (landcoverZone(p.cls, p.subclass, DEFAULT_REGION) === null) continue;
      const rings = p.rings.map((r) => r.map((q) => input.toLocal(q)));
      if (!rings.length || rings[0].length < 3) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of rings[0]) {
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      this.polys.push({ zoneOf: (r) => landcoverZone(p.cls, p.subclass, r), rings, minX, minY, maxX, maxY });
    }
    this.seaDist = input.sea && input.bounds ? seaDistanceField(input.sea, input.bounds) : () => Infinity;
  }

  /** The zone at a local point, its region and the tree species weights there. */
  zoneAt(x: number, y: number): ZoneInfo {
    const key = Math.round(x / CACHE_CELL) * 1_000_003 + Math.round(y / CACHE_CELL);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const info = this.compute(x, y);
    if (this.cache.size < 2_000_000) this.cache.set(key, info);
    return info;
  }

  private compute(x: number, y: number): ZoneInfo {
    const fx = x + (hash01(x, y, 1) - 0.5) * 2 * FRAY, fy = y + (hash01(x, y, 2) - 0.5) * 2 * FRAY;
    const [lng, lat] = this.input.toLngLat([fx, fy]);
    const region = regionAt(lng, lat);
    let name: ZoneName | null = null;
    // Landcover: the last polygon drawn wins (tiles list smaller features later); holes count.
    for (let i = this.polys.length - 1; i >= 0 && name === null; i--) {
      const p = this.polys[i];
      if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) continue;
      let inside = false;
      for (const ring of p.rings) if (inRing(x, y, ring)) inside = !inside;
      if (inside) name = p.zoneOf(region);
    }
    // Wood and farmland inside the coastal band are still the coast's: wind-pruned and sandy.
    const coastal = this.seaDist(x, y) < region.coastWidth * (0.75 + 0.5 * hash01(x, y, 3));
    if (coastal && (name === null || name === "farm" || name === region.wood) && name !== "wetland") name = region.coast;
    name ??= region.open;
    const zone = ZONES[name];
    return { zone, region, species: zone.species ?? ZONES[region.wood].species ?? {} };
  }

  /** Tree species weights at a local point (what treeModels' speciesWeightsAt was for). */
  speciesAt(x: number, y: number): SpeciesWeights {
    return this.zoneAt(x, y).species;
  }

  /**
   * A tree found in the photo, given its zone's species, density and size; null when the zone
   * thins it out. `models` is the build's model list by name; `r` a random number in [0, 1).
   */
  tree<T extends { x: number; y: number; scale: number; variant: number }>(t: T, models: readonly string[], r: number): T | null {
    const { zone, species } = this.zoneAt(t.x, t.y);
    if (hash01(t.x, t.y, 4) >= zone.density) return null;
    const pick = choose(resolveSpecies(species, models), r);
    if (!pick) return { ...t, scale: Math.min(zone.maxScale, t.scale * zone.scale) };
    return { ...t, variant: pick.variant, scale: Math.min(zone.maxScale, t.scale * zone.scale * pick.scale) };
  }

  /**
   * Leans a ksMultilayer ground mask (R grass, G dirt, B plain; textures.ts groundMask, north up)
   * covering `chunk` toward each place's zone mix, by `strength` (0 leaves the photo's own reading).
   * Zones are sampled on a coarse grid; the patches are metres across anyway.
   */
  biasMask(mask: { rgba: Uint8Array; width: number; height: number }, chunk: TerrainChunk, strength = 0.35): void {
    const { rgba, width, height } = mask;
    const G = 16;
    const mixes: GroundMix[] = [];
    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        const x = chunk.minX + ((gx + 0.5) / G) * (chunk.maxX - chunk.minX), y = chunk.maxY - ((gy + 0.5) / G) * (chunk.maxY - chunk.minY);
        mixes.push(this.zoneAt(x, y).zone.ground);
      }
    }
    for (let py = 0; py < height; py++) {
      const gy = Math.min(G - 1, Math.floor((py / height) * G));
      for (let px = 0; px < width; px++) {
        const m = mixes[gy * G + Math.min(G - 1, Math.floor((px / width) * G))];
        const i = (py * width + px) * 4;
        const t = m.grass + m.dirt + m.plain || 1;
        const g = (1 - strength) * rgba[i] + strength * 255 * (m.grass / t);
        const d = (1 - strength) * rgba[i + 1] + strength * 255 * (m.dirt / t);
        const gi = Math.round(g), di = Math.min(255 - gi, Math.round(d));
        rgba[i] = gi;
        rgba[i + 1] = di;
        rgba[i + 2] = 255 - gi - di;
      }
    }
  }

  /** The verge colour along the road: the zones' colours averaged over the points given (the road's samples). */
  vergeColour(points: Vec2[]): [number, number, number] {
    const step = Math.max(1, Math.floor(points.length / 400));
    const sum = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < points.length; i += step) {
      const v = this.zoneAt(points[i][0], points[i][1]).zone.verge;
      sum[0] += v[0]; sum[1] += v[1]; sum[2] += v[2];
      n++;
    }
    return n ? [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)] : ZONES.farm.verge;
  }

  /** The gravel verge texture (textures.ts vergeTexture) recoloured to the road's zones. */
  vergeTexture(points: Vec2[]): Uint8Array {
    return tintedVerge(this.vergeColour(points));
  }

  /** How much of the road (by its sample points) lies in each zone, 0..1. */
  shares(points: Vec2[]): Partial<Record<ZoneName, number>> {
    const out: Partial<Record<ZoneName, number>> = {};
    for (const [x, y] of points) {
      const z = this.zoneAt(x, y).zone.name;
      out[z] = (out[z] ?? 0) + 1 / points.length;
    }
    return out;
  }
}

/** The verge texture with its average colour moved to `rgb`, keeping its gravel and grass detail. */
export function tintedVerge(rgb: [number, number, number]): Uint8Array {
  const { rgba, width, height } = decodeOwnPng(vergeTexture());
  const mean = [0, 0, 0];
  for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) mean[c] += rgba[i * 4 + c];
  for (let c = 0; c < 3; c++) mean[c] /= width * height;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.max(0, Math.min(255, Math.round((rgba[i * 4 + c] * rgb[c]) / mean[c])));
    out[i * 4 + 3] = 255;
  }
  return encodePng(out, width, height, { alpha: false });
}
