// S19.1, the traffic data (track.md S19.1): the route in runs split where it turns wide (a divided
// road), the through streets, the rings; density zones, lanes kept clear of the kerbside bays, and
// the traffic lights. Only with traffic on.

import { withBayBands } from "../bayLanes";
import type { Vec2 } from "../geo";
import type { JunctionCore } from "../network/phase1";
import { innerRadius, outerRadius } from "../roundabout";
import { trafficJson, type TrafficRoad } from "../traffic";
import { addTrafficLights } from "../trafficLights";
import { townCentreFromMap, zoneRoads } from "../trafficZones";
import type { BuildContext } from "./context";
import type { Ground } from "./ground";
import type { Rings } from "./rings";
import type { RoutePlan } from "./routePlan";
import type { Scenery } from "./placeScenery";
import type { Streets } from "./streets";
import type { Surfaces } from "./surfaces";
import type { TrackResult } from "./types";

export interface Traffic {
  trafficInput: NonNullable<TrackResult["trafficInput"]>;
  trafficText: string;
}

const NO_TRAFFIC_SERVICE = /^(parking_aisle|driveway|drive-through)$/;
/** A route stretch at least this wide (most of the way over ±30 m) is a divided road. */
const WIDE = 12;

/** Runs of route samples split where "wide" changes; neighbouring runs share their boundary sample. */
export function routeRuns(widths: number[], closed: boolean, spacing: number): { runs: number[][]; wrapped: boolean } {
  const n = widths.length, k = Math.round(30 / spacing);
  const wide = widths.map((_, i) => {
    let yes = 0, all = 0;
    for (let d = -k; d <= k; d++) {
      let j = i + d;
      if (closed) j = ((j % n) + n) % n;
      else if (j < 0 || j >= n) continue;
      all++;
      if (widths[j] >= WIDE) yes++;
    }
    return yes * 2 > all;
  });
  const runs: number[][] = [[0]];
  for (let i = 1; i < n; i++) {
    const run = runs[runs.length - 1];
    run.push(i);
    if (wide[i] !== wide[i - 1]) runs.push([i]);
  }
  const single = runs.length === 1;
  if (closed && !single) {
    const last = runs.pop()!;
    runs[0] = [...last, ...runs[0]];
  }
  return { runs: runs.filter((r) => r.length >= 2), wrapped: closed && single };
}

export function trafficFor(ctx: BuildContext, rp: RoutePlan, g: Ground, st: Streets, sf: Surfaces, rn: Rings, sc: Scenery, net: JunctionCore | null): Traffic {
  const { opts, sources, proj } = ctx;
  const plan = rp.plan;
  const { runs, wrapped } = routeRuns(plan.samples.map((s) => s.width), plan.closed, opts.spacing);
  const routeRoads: TrafficRoad[] = runs.map((run) => {
    const ws = run.map((i) => plan.samples[i].width).sort((a, b) => a - b);
    const speeds = run.map(sf.speedAt).sort((a, b) => a - b);
    return {
      pts: run.map((i) => plan.samples[i].pos), h: run.map((i) => net?.surfaceAt(plan.samples[i].pos) ?? plan.samples[i].h),
      width: ws[ws.length >> 1], speed: speeds[speeds.length >> 1],
      ...(opts.trafficZones ? { speeds: run.map(sf.speedAt) } : {}),
      ...(wrapped ? { closed: true } : {}),
    };
  });
  // No traffic up car park aisles and driveways. networkCore's lanes on its surfaces.
  const netGround = net?.streetGround((x, y) => g.terrainAt(x, y).h);
  const laneZ = (p: Vec2, fallback: number) => net?.surfaceAt(p) ?? fallback;
  const streetRoads: (TrafficRoad & { cls?: string })[] = st.streetPlan.streets.filter((s) => !NO_TRAFFIC_SERVICE.test(s.service ?? "")).map((s) => ({
    pts: s.pts, h: s.pts.map(([x, y]) => laneZ([x, y], (netGround ? netGround(x, y) : g.terrainAt(x, y).h) + 0.1)), width: s.width, speed: 50,
    ...(s.oneway ? { oneway: s.oneway } : {}),
    // A traced street's own widths, the ones its bays were painted for (traffic.ts).
    ...(s.widths && s.widths.length === s.pts.length ? { widths: s.widths } : {}),
    cls: s.cls,
  }));
  const rbs = plan.roundabouts.map((rb, k) => ({ c: rb.c, h: net?.ringHeight(k) ?? rb.hc, rIn: innerRadius(rb), rOut: outerRadius(rb) }));
  // Density zones from the road class (the route's per point) and the town centre (trafficZones.ts).
  const zoned: TrafficRoad[] = opts.trafficZones
    ? zoneRoads([...routeRoads.map((r) => ({ ...r, cls: r.pts.map((p) => sources.roadClassAt?.(proj.toLngLat(p))) })), ...streetRoads],
      townCentreFromMap((p) => proj.toLocal(p), sources.landuse, sources.pois))
    : [...routeRoads, ...streetRoads.map(({ cls: _cls, ...r }) => r)];
  const roads: TrafficRoad[] = rn.bayBoxes.length ? withBayBands(zoned, rn.bayBoxes) : zoned;
  const trafficText = addTrafficLights(trafficJson(roads, rbs, opts.trafficSetting), sc.signals ? sc.signalSites : []);
  return { trafficInput: { roads, roundabouts: rbs }, trafficText };
}
