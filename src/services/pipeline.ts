// The whole build, from fetching map data to the finished track files. No DOM: it runs in the
// build worker (src/ui/buildWorker.ts), or on the page where workers can't draw. Everything the
// page knows arrives in the BuildJob; data sources the fork adds are wired in here.
//
// Written from docs/specs/pipeline.md. What it asks the services for must depend only on the
// route, the options and the answers (never on timing), so frozen snapshots replay offline.

import { areaRings } from "../core/area";
import type { LngLat } from "../core/geo";
import { withDefaults, type BuildOptions } from "../core/options";
import { pathKind } from "../core/paths";
import type { RoundaboutHint } from "../core/roundabout";
import { buildTrack, type DataSources, type TrackResult } from "../core/track";
import { isUnsealed } from "../core/unsealed";
import { renderArt } from "./art";
import { clearDataWarnings, dataWarnings, warnMissing } from "./dataWarnings";
import { fetchFarmland } from "./landcover";
import { fetchSeen } from "./mapillary";
import { fetchOsm, fetchPierFeatures, widthLookup } from "./osm";
import { loadRouteRaster } from "./raster";
import { drawSigns } from "./signs";
import { DEM_CREDIT, IMAGERY, imageryChain, loadChunkImagery, loadDem, type DemSource, type ImagerySource } from "./tiles";
import { classWidths, fetchCoast, fetchTileFeatures, roadClassLookup, type TileFeatures } from "./vectorTiles";

export interface BuildJob {
  coords: LngLat[]; // the routed centreline
  roundabouts: RoundaboutHint[]; // as the router reported them
  opts: Partial<BuildOptions>; // passed to buildTrack as given
  token: string; // Mapillary client token, or "" for none (never logged or stored here)
  imagerySource: ImagerySource | "auto"; // the UI's imagery choice
  placeMeta: { country?: string; city?: string }; // for the track's description
  houseLooks?: NonNullable<DataSources["houseLooks"]>; // particular houses' looks (headless build)
  landmarks?: { name: string; at: [number, number] }[]; // landmark names (headless build)
}

export interface BuildOutcome {
  result: TrackResult; // the track's files and model
  chunkImages: Map<string, OffscreenCanvas>; // terrain photos as drawn, for the 3D preview
  usedImagery: ImagerySource[]; // in IMAGERY's key order
  usedDem: DemSource[]; // in DEM_CREDIT's key order
  widthFallback: boolean; // no width data: the road is the default width
  seen: number; // Mapillary objects found
  seenError: string; // Mapillary's error message, or ""
  missing: string[]; // data that never arrived after retries (a rebuild may fix it)
  warnings: string[]; // data left out for a reason a rebuild can't fix (an area too large for the tiles)
}

/** Progress: a stage name and how far through it. */
export type Report = (stage: string, done?: number) => Promise<void>;

const M_PER_DEG = 111320;

/** [west, south, east, north] of the points grown by `metres` (longitude scale at the first point). */
export function paddedBounds(points: LngLat[], metres: number): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of points) {
    w = Math.min(w, lng); e = Math.max(e, lng);
    s = Math.min(s, lat); n = Math.max(n, lat);
  }
  const dLat = metres / M_PER_DEG;
  const dLng = metres / (M_PER_DEG * Math.cos((points[0][1] * Math.PI) / 180));
  return [w - dLng, s - dLat, e + dLng, n + dLat];
}

/** Even-odd ray casting on lng/lat. */
function insideRing(p: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const middle = <T>(list: T[]): T => list[Math.floor(list.length / 2)];

/** Classes of road that cross water on a bridge Armco is built for. */
const BRIDGE_CLASS = /^(motorway|trunk|primary|secondary|tertiary|minor|service|track)/;

/** The tiles' "too large" refusals: not transient, so not missing data a rebuild could fix. */
const tooLarge = (e: unknown) => /^Area too large/.test((e as Error)?.message ?? "");

/** Options with their defaults, for reading here; a key set to undefined or null counts as unset. */
function readOptions(partial: Partial<BuildOptions>): BuildOptions {
  const given = Object.fromEntries(Object.entries(partial).filter(([, v]) => v !== undefined && v !== null)) as Partial<BuildOptions>;
  return withDefaults(given);
}

export async function runBuild(
  job: BuildJob,
  report: Report,
  traceProgress: (text: string) => void,
): Promise<BuildOutcome> {
  const { coords } = job;
  if (coords.length < 2) throw new Error("Pick a start and a finish on the map first");
  const opts = readOptions(job.opts);
  const chain = imageryChain(middle(coords), job.imagerySource);
  const rings = areaRings(opts.area) as LngLat[][];
  const box: LngLat[] = rings.length ? [...coords, ...rings.flat()] : coords;
  const warnings: string[] = [];

  await report("Fetching OpenStreetMap data");
  clearDataWarnings();

  /* ---- fetch: four independent downloads (and farmland when asked) ---- */
  const farmland = opts.farmland
    ? fetchFarmland(box, opts.corridor + 20).catch(() => {
        warnMissing("farmland tiles (vineyards, paddock fences)");
        return undefined;
      })
    : undefined;
  let seenError = "";
  const [osm, tiles, seen, coast] = await Promise.all([
    fetchOsm(coords, rings, { cattleGrids: !!opts.farmRoadsides, trafficSignals: opts.trafficLights !== false }),
    fetchTileFeatures(paddedBounds(box, opts.buildingRadius + 50)).catch((e): TileFeatures | null => {
      if (tooLarge(e)) warnings.push(`${(e as Error).message}: built without buildings, streets or shops`);
      else warnMissing("all map tiles (buildings, streets, shops)");
      return null;
    }),
    job.token
      ? fetchSeen(paddedBounds(box, opts.corridor + 20), job.token).catch((e): { at: LngLat; value: string }[] => {
          seenError = (e as Error).message;
          return [];
        })
      : Promise.resolve([] as { at: LngLat; value: string }[]),
    opts.sea !== false
      ? fetchCoast(paddedBounds(box, opts.horizon + 1200)).catch((e) => {
          if (tooLarge(e)) warnings.push(`${(e as Error).message}: built without the sea, piers and beaches`);
          else warnMissing("all coast tiles (sea, piers, beaches)");
          return undefined;
        })
      : Promise.resolve(undefined),
  ]);
  for (const w of warnings) console.warn("left out:", w);

  /* ---- combine ---- */
  const features = osm.features;
  if (tiles) features.buildings = tiles.buildings;
  if (opts.armco) {
    const bridges = [...(osm.roads ?? []), ...(tiles?.roads ?? [])]
      .filter((r) => r.brunnel === "bridge" && BRIDGE_CLASS.test(r.cls))
      .map((r) => r.pts);
    features.crossings = { bridges, waterways: tiles?.waterways ?? [] };
  }
  if (tiles) {
    const unsealed = tiles.roads.filter((r) => r.cls !== "path" && isUnsealed(r.surface, r.cls)).map((r) => r.pts);
    (features.unsealed ??= []).push(...unsealed);
  }
  const pierPts = (coast?.piers ?? []).flatMap((p) => p.rings[0] ?? []);
  const jetty = pierPts.length && opts.sea !== false ? await fetchPierFeatures(paddedBounds(pierPts, 40)) : undefined;

  let widthAt: DataSources["widthAt"];
  if (!opts.widthOverride) {
    widthAt = osm.widthAt;
    if (!widthAt && tiles) {
      const widths = classWidths(tiles.roads);
      if (widths.length) widthAt = widthLookup(widths, coords[0][1]);
    }
  }

  let streets: DataSources["streets"];
  let paths: DataSources["paths"];
  if (tiles) {
    let lines = tiles.roads as NonNullable<DataSources["streets"]>["lines"];
    if (rings.length && osm.roads) {
      // Inside an area the streets come from OSM itself (exact geometry); paths and everything outside stay from the tiles.
      const osmClasses = new Set(osm.roads.map((r) => r.cls));
      const inArea = (pts: LngLat[]) => rings.some((ring) => insideRing(middle(pts), ring));
      lines = [
        ...tiles.roads.filter((r) => !osmClasses.has(r.cls) || !inArea(r.pts)),
        ...osm.roads.filter((r) => inArea(r.pts)),
      ];
    }
    streets = { lines, names: tiles.names };
    paths = [];
    for (const r of tiles.roads) {
      if (r.cls !== "path" || r.brunnel === "bridge" || r.brunnel === "tunnel") continue;
      const kind = pathKind(r.subclass, r.bicycle);
      if (kind) paths.push({ pts: r.pts, kind });
    }
  }

  /* ---- build ---- */
  const chunkImages = new Map<string, OffscreenCanvas>();
  const usedImagery = new Set<ImagerySource>();
  const usedDem = new Set<DemSource>();
  // Credits and the used lists in the sources' key order, not arrival order, so identical builds agree.
  const inKeyOrder = <K extends string>(keys: K[], used: Set<K>): K[] => keys.filter((k) => used.has(k));
  const IMAGERY_ORDER = Object.keys(IMAGERY) as ImagerySource[];
  const DEM_ORDER = Object.keys(DEM_CREDIT) as DemSource[];

  const sources: DataSources = {
    dem: (proj, bounds, z) => loadDem(proj, bounds, z, undefined, usedDem),
    imagery: opts.imageryZoom ? (proj, chunk, z, size) => loadChunkImagery(proj, chunk, z, size, chunkImages, chain, usedImagery) : undefined,
    widthAt,
    osm: features,
    roundabouts: job.roundabouts,
    streets,
    pois: tiles?.pois,
    landuse: tiles?.landuse,
    seen,
    renderArt,
    raster: (proj, path, reach, maxZoom) =>
      loadRouteRaster(proj, path, reach, chain, maxZoom ?? 20, (d, t) => traceProgress(`Tracing the road in the aerial photos (${Math.round((d / t) * 100)}%)`)),
    roadClassAt: tiles ? roadClassLookup(tiles.roads, coords[0][1]) : undefined,
    coast,
    jetty,
    farmland: await farmland,
    paths,
    houseLooks: job.houseLooks,
    landmarks: job.landmarks,
    drawSigns,
    imageryCredit: () => inKeyOrder(IMAGERY_ORDER, usedImagery).map((k) => IMAGERY[k].credit).join("; "),
    elevationCredit: () => inKeyOrder(DEM_ORDER, usedDem).map((k) => DEM_CREDIT[k]).join("; "),
  };
  const result = await buildTrack(coords, job.opts, sources, job.placeMeta, report);

  return {
    result,
    chunkImages,
    usedImagery: inKeyOrder(IMAGERY_ORDER, usedImagery),
    usedDem: inKeyOrder(DEM_ORDER, usedDem),
    widthFallback: !widthAt && !opts.widthOverride,
    seen: seen.length,
    seenError,
    missing: [...dataWarnings],
    warnings,
  };
}
