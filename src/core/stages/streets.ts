// S6, the side streets (track.md S6): the street plan (from networkCore phase 2's graph in an area
// build with it on), the area's far streets' own photo, street tracing, the street index and the
// junction mouths on the route.

import type { Vec2 } from "../geo";
import type { GridAvoid } from "../gridSlots";
import type { JunctionCore } from "../network/phase1";
import { layoutDriveLines } from "../layoutDrives";
import { planNetworkStreets, type NetworkStreets } from "../network/phase2";
import { LineIndex, planSideStreets, traceSideStreets, type Junction, type SideStreet, type StreetPlan } from "../sideStreets";
import { displayOf, type RasterSampler } from "../trace";
import type { BuildContext } from "./context";
import type { Ground } from "./ground";
import type { RoutePlan } from "./routePlan";
import type { Traced } from "./traceRoute";
import type { Progress } from "./types";

export type RouteRibbon = { samples: RoutePlan["plan"]["samples"]; closed: boolean; length: number; crown: number; nearest: (x: number, y: number, max: number) => ReturnType<Ground["index"]["nearest"]> };

export interface Streets {
  streetPlan: StreetPlan;
  /** networkCore phase 2's streets and graph (area builds with networkCore and side streets). */
  net2: NetworkStreets | null;
  /** All street lines and OSM rings, local, for networkCore (empty without it). */
  netLines: { pts: Vec2[]; cls: string; oneway?: 1 | -1; brunnel?: string; service?: string; surface?: string }[];
  netRings: { pts: Vec2[]; lanes?: number }[];
  routeRibbon: RouteRibbon;
  gridAvoid: GridAvoid;
  /** The route photo, joined by the far streets' own photo in an area build. */
  streetRaster: RasterSampler | null;
  sideTraced: number;
  streetIndex: LineIndex;
  /** The junctions that are mouths on the route (networkCore takes some over: setNet). */
  mouths: Junction[];
  net: JunctionCore | null;
  /** A side street's mouth on this side of the route at distance `sd`, or inside a networkCore junction. */
  mouth: (side: 1 | -1, sd: number) => boolean;
  /** networkCore's junctions take over their mouths (S9). */
  setNet: (net: JunctionCore) => void;
}

export async function planStreets(ctx: BuildContext, rp: RoutePlan, tr: Traced, g: Ground, progress: Progress): Promise<Streets> {
  const { opts, sources, proj, area } = ctx;
  const plan = rp.plan, index = g.index;
  // Every layout's drive along OSM ways is a street too (layoutDrives.ts); raceways only as a layout's drive.
  const lines = [...(opts.sideStreets ? (sources.streets?.lines ?? []).filter((l) => l.cls !== "raceway") : []), ...layoutDriveLines(opts.layoutDrives)];
  const streetPlan = planSideStreets(lines, sources.streets?.names ?? [], plan, index, opts, proj, area);
  // networkCore phase 2: in an area build the streets and their mouths come from the network's graph.
  const withNet = !!(opts.networkCore && area);
  const netLines = withNet ? (sources.streets?.lines ?? []).map((l) => ({ ...l, pts: ctx.line(l.pts) })) : [];
  const netRings = withNet ? (sources.osm?.roundaboutRings ?? []).map((r) => ({ pts: ctx.line(r.pts), lanes: r.lanes })) : [];
  const routeRibbon: RouteRibbon = { samples: plan.samples, closed: plan.closed, length: plan.length, crown: opts.crown, nearest: (x, y, max) => index.nearest(x, y, max) };
  const net2 = withNet && area && opts.sideStreets ? planNetworkStreets({
    lines: netLines, rings: netRings, names: (sources.streets?.names ?? []).map((n) => ({ name: n.name, pts: ctx.line(n.pts) })),
    route: routeRibbon, builtRings: plan.roundabouts, inArea: ([x, y]) => area.signed(x, y) < -3, corridor: opts.corridor, vergeWidth: opts.vergeWidth,
  }) : null;
  if (net2) {
    streetPlan.streets = net2.streets as SideStreet[];
    streetPlan.junctions = net2.mouths;
  }
  // The grid keeps clear of where side streets meet the route (gridSlots.ts).
  const gridAvoid: GridAvoid = { junctions: streetPlan.junctions.map((j) => plan.samples[j.seg]?.pos).filter((p): p is Vec2 => !!p) };

  // An area build's streets away from the route get their own photo (one zoom coarser) so they're traced too.
  let streetRaster = tr.raster;
  if (area && tr.raster && opts.traceRoads && sources.raster) {
    await progress("Tracing the area's streets in the aerial photos");
    const far = streetPlan.streets.filter((st) => st.pts.some(([x, y]) => !index.nearest(x, y, 60)));
    const extra = far.length ? await sources.raster(proj, far.map((st) => st.pts), 14, 19) : null;
    if (extra) {
      const raster = tr.raster;
      const both = (a: RasterSampler, b: RasterSampler): RasterSampler => (x, y) => a(x, y) ?? b(x, y);
      streetRaster = Object.assign(both(raster, extra), { display: both(displayOf(raster), displayOf(extra)) });
    }
  }
  // (Phase 2's streets keep the graph's lines: tracing that knows the junction caps is still to come.)
  const sideTraced = streetRaster && opts.traceRoads && !net2 ? traceSideStreets(streetPlan.streets, streetRaster, opts, index) : 0;
  const streetIndex = new LineIndex(streetPlan.streets);

  const out: Streets = {
    streetPlan, net2, netLines, netRings, routeRibbon, gridAvoid, streetRaster, sideTraced, streetIndex,
    mouths: streetPlan.junctions,
    net: null,
    mouth: (side, sd) => out.mouths.some((j) => j.side === side && Math.abs(j.s - sd) < j.width / 2 + 1.5) || !!out.net?.routeSInside(sd),
    setNet: (net) => {
      out.net = net;
      out.mouths = streetPlan.junctions.filter((j) => !net.coversRouteRow(j.seg));
    },
  };
  return out;
}
