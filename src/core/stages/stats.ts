// S20, the build's stats and the houses list (track.md section 9). build-track.mjs writes the
// stats to out/<slug>.stats.json and base.mjs compares them: every key keeps its meaning.

import { FACADES, ROOF_COLOURS } from "../buildingStyles";
import type { Kn5Model, Kn5Node } from "../kn5";
import { shopStats } from "../shops";
import type { BuildContext } from "./context";
import type { BuildingPlan } from "./buildingPlan";
import type { GroundMeshes } from "./groundMeshes";
import type { Houses } from "./houses";
import type { Imagery } from "./imagery";
import type { Kerbing } from "./kerbing";
import type { Marks } from "./marks";
import type { ParkedFinal, ParkedFirst } from "./parked";
import type { Scenery } from "./placeScenery";
import type { RoadSurfaces } from "./roadMeshes";
import type { Rings } from "./rings";
import type { RoutePlan } from "./routePlan";
import type { Streets } from "./streets";
import type { Traced } from "./traceRoute";
import type { TrackResult } from "./types";

export interface StatsInput {
  rp: RoutePlan; tr: Traced; st: Streets; img: Imagery; bp: BuildingPlan; kb: Kerbing; rm: RoadSurfaces; mk: Marks; rn: Rings; gm: GroundMeshes;
  sc: Scenery; hs: Houses; p1: ParkedFirst; pf: ParkedFinal; kn5: Uint8Array; meanWidth: number;
}

function geometry(n: Kn5Node): { vertices: number; triangles: number } {
  if (n.kind === "mesh") return { vertices: n.positions.length / 3, triangles: n.indices.length / 3 };
  let vertices = 0, triangles = 0;
  for (const c of n.children) {
    const g = geometry(c);
    vertices += g.vertices;
    triangles += g.triangles;
  }
  return { vertices, triangles };
}

export function buildStats(ctx: BuildContext, model: Kn5Model, a: StatsInput, reg: { materials: { name: string }[] }): TrackResult["stats"] {
  const { opts } = ctx;
  const { rp, tr, st, img, bp, kb, rm, mk, rn, gm, sc, hs, p1, pf } = a;
  const plan = rp.plan;
  const hs2 = plan.samples.map((s) => s.h);
  let climb = 0;
  for (let i = 1; i < hs2.length; i++) climb += Math.max(0, hs2[i] - hs2[i - 1]);
  const geo = geometry(model.root);
  const shops = shopStats(hs.shopfronts);
  const verge = rm.verge;
  return {
    length: plan.length,
    timedLength: rp.timedLength(),
    closed: plan.closed,
    minElevation: Math.min(...hs2),
    maxElevation: Math.max(...hs2),
    climb,
    meanWidth: a.meanWidth,
    vertices: geo.vertices,
    triangles: geo.triangles,
    terrainChunks: gm.terrainNodes.length,
    kn5Bytes: a.kn5.length,
    trees: sc.trees.reduce((n, m) => n + m.positions.length / 3, 0) / 24,
    buildings: bp.kept.length,
    buildingsDetected: bp.kept.filter((b) => b.source !== "osm").length,
    traced: tr.trace?.coverage ?? 0,
    photoLines: mk.imageLines.length,
    photoChunks: reg.materials.filter((m) => m.name.startsWith("road_photo_")).length,
    sideStreets: st.streetPlan.streets.length,
    sideTraced: st.sideTraced,
    kerbMetres: (kb.kerbs[0].reduce((n, k) => n + k, 0) + kb.kerbs[1].reduce((n, k) => n + k, 0)) * opts.spacing,
    poles: sc.utilities.poles,
    carsPainted: img.carsPainted,
    parkedCars: pf.parked.length,
    parkedDropped: pf.parkedDropped,
    parkedBays: p1.placed ? {
      carPark: pf.parked.filter((c) => !c.kerb).length,
      kerb: pf.parked.filter((c) => c.kerb).length,
      dropped: p1.placed.dropped,
    } : undefined,
    kerbside: rn.kerbside ? { bays: rn.kerbside.bays, bikeLaneMetres: Math.round(rn.kerbside.bikeLaneMetres), symbols: rn.kerbside.symbols } : undefined,
    trafficLights: sc.signals ? {
      sites: sc.signalSites.length, poles: sc.signals.poles, heads: sc.signals.heads, working: sc.signalSites.filter((s) => s.sidesOk).length,
    } : undefined,
    housesLooked: hs.housesLooked,
    shops: shops.shops,
    verandahs: shops.verandahs,
    shopNames: shops.named,
    footpathMetres: verge ? (verge.paths[0].filter(Boolean).length + verge.paths[1].filter(Boolean).length) * opts.spacing : 0,
    driveways: verge?.drives.length ?? 0,
    streetLights: sc.utilities.lights.length,
    carParkLights: sc.carPark.lights.length / 2,
    streetSigns: sc.pieces.filter((p) => p.kind === "blade").length,
    signs: sc.pieces.filter((p) => p.kind === "face").length,
    railMetres: sc.needs.reduce((n, side) => n + side.filter(Boolean).length * opts.spacing, 0),
  };
}

/** Houses with a street front, in lng/lat (the house looks tooling reads them). */
export function housesOut(ctx: BuildContext, hs: Houses): TrackResult["houses"] {
  return hs.homes.filter((b) => b.front).map((b) => ({
    front: [ctx.toLngLat(b.front![0]), ctx.toLngLat(b.front![1])],
    height: b.height,
    facade: FACADES[b.facade]?.name ?? String(b.facade),
    source: b.source,
    ring: b.ring.map((p) => ctx.toLngLat(p)),
    roof: b.roof,
    pitch: b.pitch,
    roofRgb: ROOF_COLOURS[b.roofColour]?.rgb ? [...ROOF_COLOURS[b.roofColour].rgb] as [number, number, number] : undefined,
  }));
}
