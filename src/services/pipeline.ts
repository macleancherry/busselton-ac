// The whole build, from fetching the map data to the finished track files.
// No DOM: it runs in the build worker (buildWorker.ts) so the page stays
// responsive, or on the page itself where workers can't draw (no
// OffscreenCanvas).

import type { LngLat } from "../core/geo";
import { pathKind } from "../core/paths";
import type { BuildOptions } from "../core/options";
import type { RoundaboutHint } from "../core/roundabout";
import { buildTrack, type TrackResult } from "../core/track";
import { renderArt } from "./art";
import { fetchSeen } from "./mapillary";
import { fetchOsm, fetchPierFeatures, widthLookup } from "./osm";
import { loadRouteRaster } from "./raster";
import { DEM_CREDIT, IMAGERY, imageryChain, loadChunkImagery, loadDem, type DemSource, type ImagerySource } from "./tiles";
import { areaRings } from "../core/area";
import { classWidths, fetchCoast, fetchTileFeatures, roadClassLookup } from "./vectorTiles";
import { clearDataWarnings, dataWarnings, warnMissing } from "./dataWarnings";
import { drawSigns } from "./signs";
import { isUnsealed } from "../core/unsealed";

export interface BuildJob {
  coords: LngLat[];
  roundabouts: RoundaboutHint[];
  opts: Partial<BuildOptions>;
  /** Mapillary client token, or "" for none. */
  token: string;
  imagerySource: ImagerySource | "auto";
  placeMeta: { country?: string; city?: string };
  /** Busselton fork: what particular houses look like (street photos, hand-set), see houseLooks.ts. */
  houseLooks?: NonNullable<Parameters<typeof buildTrack>[2]["houseLooks"]>;
  /** Busselton fork: landmarks (built as layers after the base): the automatic test photographs them. */
  landmarks?: { name: string; at: [number, number] }[];
}

export interface BuildOutcome {
  result: TrackResult;
  /** The terrain photos as drawn, for the 3D preview. */
  chunkImages: Map<string, OffscreenCanvas>;
  usedImagery: ImagerySource[];
  usedDem: DemSource[];
  /** No width data: the road is the default width. */
  widthFallback: boolean;
  seen: number;
  seenError: string;
  /** Data that never arrived after retries (an API down, tiles that failed): the track built without it. */
  missing: string[];
}

export type Report = (stage: string, fraction?: number) => Promise<void>;

export async function runBuild(job: BuildJob, report: Report, traceProgress: (text: string) => void): Promise<BuildOutcome> {
  const { coords, opts, token } = job;
  const chunkImages = new Map<string, OffscreenCanvas>();
  const usedImagery = new Set<ImagerySource>();
  const usedDem = new Set<DemSource>();
  const chain = imageryChain(coords[Math.floor(coords.length / 2)], job.imagerySource);

  // Busselton fork: an area build fetches everything over its polygon as well as along the route.
  const rings = areaRings(opts.area);
  const box: LngLat[] = rings.length ? [...coords, ...rings.flat()] : coords;
  await report("Fetching OpenStreetMap data");
  clearDataWarnings();
  let seenError = "";
  const [osm, tiles, seen, coast] = await Promise.all([
    fetchOsm(coords, rings),
    fetchTileFeatures(paddedBounds(box, (opts.buildingRadius ?? 250) + 50)).catch(() => {
      warnMissing("all map tiles (buildings, streets, shops)");
      return null;
    }),
    token
      ? fetchSeen(paddedBounds(box, (opts.corridor ?? 90) + 20), token).catch((e) => {
        seenError = (e as Error).message;
        return [];
      })
      : Promise.resolve([]),
    // Busselton fork: the sea, piers and beaches.
    opts.sea !== false ? fetchCoast(paddedBounds(box, (opts.horizon ?? 1500) + 1200)).catch(() => {
      warnMissing("all coast tiles (sea, piers, beaches)");
      return undefined;
    }) : Promise.resolve(undefined),
  ]);
  if (tiles) osm.features.buildings = tiles.buildings;
  // Busselton fork: the tiles' unsealed roads too, for gravel on the route (unsealed.ts).
  if (tiles) osm.features.unsealed = [...(osm.features.unsealed ?? []), ...tiles.roads.filter((r) => r.cls !== "path" && isUnsealed(r.surface, r.cls)).map((r) => r.pts)];
  // Busselton fork: what stands on the jetties (railway, platforms, buildings), over their own box.
  const pierPts = (coast?.piers ?? []).flatMap((p) => p.rings[0] ?? []);
  const jetty = pierPts.length && opts.sea !== false
    ? await fetchPierFeatures(paddedBounds(pierPts, 40))
    : undefined;
  // Overpass widths when it answered; otherwise widths by road class from the tiles.
  const tileWidths = tiles ? classWidths(tiles.roads) : [];
  const widthAt = opts.widthOverride
    ? undefined
    : osm.widthAt ?? (tileWidths.length ? widthLookup(tileWidths, coords[0][1]) : undefined);
  // Busselton fork: inside an area, streets from OSM itself (exact geometry; the tiles' lines can sit
  // metres off and leave a street out), keeping the tiles' paths and everything outside the area.
  const areaStreets = (lines: NonNullable<typeof tiles>["roads"]) => {
    if (!rings.length || !osm.roads?.length) return lines;
    const inside = (p: LngLat) => rings.some((area) => {
      let c = false;
      for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
        const [xi, yi] = area[i], [xj, yj] = area[j];
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    });
    const drivable = new Set(osm.roads.map((r) => r.cls));
    const mid = (pts: LngLat[]) => pts[Math.floor(pts.length / 2)];
    return [
      ...lines.filter((l) => !drivable.has(l.cls) || !inside(mid(l.pts))),
      ...osm.roads.filter((r) => inside(mid(r.pts))),
    ];
  };
  const result = await buildTrack(coords, opts, {
    dem: (proj, bounds, z) => loadDem(proj, bounds, z, undefined, usedDem),
    imagery: opts.imageryZoom ? (proj, chunk, z, size) => loadChunkImagery(proj, chunk, z, size, chunkImages, chain, usedImagery) : undefined,
    widthAt,
    osm: osm.features,
    roundabouts: job.roundabouts,
    streets: tiles ? { lines: areaStreets(tiles.roads), names: tiles.names } : undefined,
    pois: tiles?.pois,
    seen,
    renderArt,
    raster: (proj, path, reach, maxZoom) => loadRouteRaster(proj, path, reach, chain, maxZoom ?? 20, (d, t) => traceProgress(`Tracing the road in the aerial photos (${Math.round((d / t) * 100)}%)`)),
    roadClassAt: tiles ? roadClassLookup(tiles.roads, coords[0][1]) : undefined,
    // Busselton fork: coast, paths, house looks and shop signs.
    coast,
    jetty,
    paths: tiles
      ? tiles.roads.filter((r) => r.cls === "path" && r.brunnel !== "bridge" && r.brunnel !== "tunnel")
        .flatMap((r) => {
          const kind = pathKind(r.subclass, r.bicycle);
          return kind ? [{ pts: r.pts, kind }] : [];
        })
      : undefined,
    houseLooks: job.houseLooks,
    landmarks: job.landmarks,
    drawSigns,
    imageryCredit: () => [...[...usedImagery].map((k) => IMAGERY[k].credit), ...[...usedDem].map((k) => DEM_CREDIT[k])].join("; "),
  }, job.placeMeta, report);
  return {
    result,
    chunkImages,
    usedImagery: [...usedImagery],
    usedDem: [...usedDem],
    widthFallback: !widthAt && !opts.widthOverride,
    seen: seen.length,
    seenError,
    missing: [...dataWarnings],
  };
}

/** [west, south, east, north] around the route, padded by `metres`. */
function paddedBounds(coords: LngLat[], metres: number): [number, number, number, number] {
  const lats = coords.map((p) => p[1]), lngs = coords.map((p) => p[0]);
  const dLat = metres / 111320, dLng = metres / (111320 * Math.cos((lats[0] * Math.PI) / 180));
  return [Math.min(...lngs) - dLng, Math.min(...lats) - dLat, Math.max(...lngs) + dLng, Math.max(...lats) + dLat];
}
