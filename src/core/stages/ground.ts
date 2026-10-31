// S3, the ground (track.md S3): the DEMs (near and far), the coast and its sea mask, the shore
// mask that keeps trees off water and sand, landscape zones, the area's own roundabouts, the
// road's heights and the terrain function, cover and the chunk plans.

import { makeCover, type Cover } from "../area";
import { BACKDROP_CHUNK, planBackdrop } from "../backdrop";
import { SeaMask, withSeabed, type CoastPolygon } from "../coast";
import type { HeightFn } from "../elevation";
import { boundsOf, type Bounds, type LngLat, type Vec2 } from "../geo";
import type { JettyFeatures } from "../jetty";
import { pointInRing } from "../buildings";
import { applyElevation, SegmentIndex } from "../road";
import { fitCircle } from "../roundabout";
import { ShoreMask } from "../shoreClear";
import { classifyPiers, type PierKind } from "../swimJetty";
import { makeTerrainFn, planTerrainChunks, type TerrainChunk, type TerrainFn } from "../terrain";
import { MODEL_NAMES } from "../treeModels";
import { TREE_SPECIES } from "../treeSprites";
import { ZoneMap } from "../zones";
import type { BuildContext } from "./context";
import type { RoutePlan } from "./routePlan";
import type { CoastSource } from "./types";

export interface Ground {
  dem: HeightFn;
  farDem: HeightFn;
  bounds: Bounds;
  farBounds: Bounds;
  ocean: CoastPolygon[];
  piers: CoastPolygon[];
  pierKinds: PierKind[];
  majorPiers: CoastPolygon[];
  beaches: CoastPolygon[];
  onJetty: (x: number, y: number) => boolean;
  jettyFeatures: JettyFeatures | null;
  sea: SeaMask;
  /** Where no tree may stand (null inland or with shoreClear off). */
  shore: ShoreMask | null;
  /** Spots off the shore mask. */
  offShore: <T extends { x: number; y: number }>(spots: T[]) => T[];
  zones: ZoneMap | null;
  /** Tree model names: CSP's or the sprite atlas'. */
  treeModels: readonly string[];
  index: SegmentIndex;
  /** The analytic terrain. Reads the plan's kerbs and roundabouts live (B1). */
  terrainAt: TerrainFn;
  terrainH: HeightFn;
  cover: Cover;
  /** Within the corridor (less `k`) of the route or the area. */
  inCover: (x: number, y: number, k?: number) => boolean;
  chunks: TerrainChunk[];
  backdrop: TerrainChunk[];
}

/** The area's roundabouts that aren't on the route: rings on the map inside the area, kerbed. Appended to plan.roundabouts. */
function addAreaRoundabouts(ctx: BuildContext, rp: RoutePlan): void {
  const area = ctx.area;
  if (!area) return;
  const plan = rp.plan;
  const ways = [
    ...(ctx.sources.osm?.roundaboutRings ?? []).map((r) => ({ pts: ctx.line(r.pts), lanes: r.lanes })),
    ...rp.tileRings.map((pts) => ({ pts, lanes: undefined as number | undefined })),
  ].flatMap((w) => {
    const fit = fitCircle(w.pts);
    return fit && fit.r >= 4 && fit.r <= 40 && fit.rms < 2.5 ? [{ ...w, fit }] : [];
  });
  const groups: (typeof ways)[] = [];
  for (const w of ways) {
    const g = groups.find((list) => list.some((o) => Math.hypot(o.fit.c[0] - w.fit.c[0], o.fit.c[1] - w.fit.c[1]) < 8));
    if (g) g.push(w);
    else groups.push([w]);
  }
  for (const g of groups) {
    const rb = fitCircle(g.flatMap((w) => w.pts)) ?? g[0].fit;
    if (!area.inside(rb.c[0], rb.c[1])) continue;
    if (plan.roundabouts.some((o) => Math.hypot(o.c[0] - rb.c[0], o.c[1] - rb.c[1]) < o.r + 10)) continue;
    const lanes = Math.max(1, ...g.map((w) => w.lanes ?? 0));
    plan.roundabouts.push({ c: rb.c, r: rb.r, w: Math.max(7, lanes >= 2 ? lanes * 4.6 : 0), lanes, hc: 0, sIn: NaN, sOut: NaN, crossings: [], kerbed: true });
  }
}

/** Mutates the plan: appends the area's roundabouts, then sets the road's heights (applyElevation). */
export async function prepareGround(ctx: BuildContext, rp: RoutePlan): Promise<Ground> {
  const { opts, sources, proj } = ctx;
  const plan = rp.plan;
  const pts = [...plan.samples.map((s) => s.pos), ...ctx.areaPts];
  const bounds = boundsOf(pts, opts.corridor + opts.terrainBlend + 60);
  const landDem = await sources.dem(proj, bounds, opts.demZoom);
  const farBounds = boundsOf(pts, opts.horizon + BACKDROP_CHUNK);
  const landFarDem = opts.horizon > 0 ? await sources.dem(proj, farBounds, Math.min(opts.demZoom, 12)) : landDem;

  const toCoast = (p: CoastSource): CoastPolygon => ({ rings: p.rings.map((r) => r.map((q) => proj.toLocal(q))), edge: p.edge });
  const coast = sources.coast;
  const ocean = opts.sea ? (coast?.ocean ?? []).map(toCoast) : [];
  const piers = opts.sea ? (coast?.piers ?? []).map(toCoast) : [];
  // Major jetties, swimming jetties and pontoons (swimJetty.ts); every pier major when swimJetties is false.
  const pierKinds: PierKind[] = opts.swimJetties === false ? piers.map(() => "major") : classifyPiers(piers, (coast?.piers ?? []).map((p) => ({ id: p.id })), opts.jettyKinds);
  const majorPiers = piers.filter((_, i) => pierKinds[i] === "major");
  const onJetty = (x: number, y: number) => piers.some((p) => pointInRing(x, y, p.rings[0]));
  const jettyFeatures: JettyFeatures | null = piers.length && sources.jetty ? {
    railways: sources.jetty.railways.map((l) => ctx.line(l)),
    platforms: sources.jetty.platforms.map((p) => ({ pts: ctx.line(p.pts), shelter: p.shelter })),
    buildings: sources.jetty.buildings.map((b) => ({ pts: ctx.line(b.pts), name: b.name })),
  } : null;
  const beaches = opts.sea ? (coast?.beaches ?? []).map(toCoast) : [];
  const sea = new SeaMask(ocean, farBounds.minX, farBounds.minY, farBounds.maxX, farBounds.maxY);

  // Water, wetland, sand, groynes, jetties and the shore strip keep trees off (shoreClear.ts).
  const landcoverOf = (cls: string) => (coast?.landcover ?? []).filter((l) => l.cls === cls)
    .map((l) => toCoast({ rings: l.rings as LngLat[][], edge: l.rings.map((r) => r.map(() => true)) }));
  const shoreInput = {
    ocean,
    water: (coast?.water ?? []).map(toCoast),
    wetlands: landcoverOf("wetland"),
    beaches: [...beaches, ...landcoverOf("sand")],
    piers,
    groynes: (sources.osm?.groynes ?? []).map((l) => ctx.line(l)),
  };
  const anyShore = Object.values(shoreInput).some((l) => l.length > 0);
  // Over the horizon too, at 2 m or coarser so it stays near 4 million cells.
  const area2 = (farBounds.maxX - farBounds.minX) * (farBounds.maxY - farBounds.minY);
  const shore = opts.shoreClear === false || !anyShore ? null
    : new ShoreMask(shoreInput, farBounds.minX, farBounds.minY, farBounds.maxX, farBounds.maxY, { cell: Math.max(2, Math.ceil(Math.sqrt(area2 / 4e6))) });
  const offShore = <T extends { x: number; y: number }>(spots: T[]): T[] => (shore ? spots.filter((t) => !shore.hitsAround(t.x, t.y, 1)) : spots);

  const dem = ocean.length ? withSeabed(landDem, sea) : landDem;
  const farDem = ocean.length ? withSeabed(landFarDem, sea) : landFarDem;
  const zones = opts.zones ? new ZoneMap({
    toLngLat: (v: Vec2) => proj.toLngLat(v),
    toLocal: (p: LngLat) => proj.toLocal(p),
    landcover: coast?.landcover,
    sea: ocean.length ? (x: number, y: number) => sea.has(x, y) : undefined,
    bounds: farBounds,
  }) : null;
  const treeModels = opts.cspTrees ? MODEL_NAMES : TREE_SPECIES.map((t) => t.name);

  addAreaRoundabouts(ctx, rp);
  applyElevation(plan, dem, opts);
  const index = new SegmentIndex(plan);
  const terrainAt = makeTerrainFn(plan, index, dem, opts);
  const cover = makeCover(index, opts, ctx.area);
  return {
    dem, farDem, bounds, farBounds, ocean, piers, pierKinds, majorPiers, beaches, onJetty, jettyFeatures, sea, shore, offShore, zones, treeModels,
    index, terrainAt, terrainH: (x, y) => terrainAt(x, y).h, cover,
    inCover: (x, y, k = 0) => cover(x, y) <= opts.corridor - k,
    chunks: planTerrainChunks(plan, index, opts, ctx.area),
    backdrop: planBackdrop(plan, index, opts, ctx.area),
  };
}

