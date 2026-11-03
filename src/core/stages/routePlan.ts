// S1, the route plan (track.md S1 and 7a): roundabouts on the route, the run-up and run-off of a
// point-to-point road, the planned road and its timed stretch; and the spawn points and timing
// gates (trackObjects), which only need the plan.

import type { LngLat, Vec2 } from "../geo";
import { frameTransform, type Kn5GroupNode } from "../kn5";
import { toAc } from "../mesh";
import type { BuildOptions } from "../options";
import { isLoop, planRoad, surfaceHeight, type RoadPlan, type RoadSample } from "../road";
import { resolveRoundabouts, ringsOnRoute } from "../roundabout";
import { extendRoute, pathLength } from "../extend";
import { gridFront, gridSlot, GRID_GAP, type GridAvoid } from "../gridSlots";
import { keepLeftOffsets } from "../keepLeft";
import type { BuildContext } from "./context";

/** Road kept behind the start line for the grid's first row, m. */
export const GRID_DEPTH = 14;
/** The shortest road worth building, m. */
export const MIN_LENGTH = 300;

export interface RoutePlan {
  plan: RoadPlan;
  /** Closed street lines from the map tiles (roundabouts drawn as rings), local. */
  tileRings: Vec2[][];
  /** The timed length: start to finish line on a point to point, else the whole lap. Read late: tracing moves `s`. */
  timedLength: () => number;
}

/**
 * The sample nearest a pin, looking first round where it should be (`frac` of the way along),
 * so a road that passes the pin twice picks the right pass.
 */
export function sampleNearPin(plan: RoadPlan, pin: Vec2, frac: number): number {
  const s = plan.samples;
  const lastS = s[s.length - 1].s;
  const est = frac * lastS, window = Math.max(60, lastS * 0.05);
  const nearest = (ok: (smp: RoadSample) => boolean) => {
    let best = -1, bestD = Infinity;
    s.forEach((smp, i) => {
      if (!ok(smp)) return;
      const d = Math.hypot(smp.pos[0] - pin[0], smp.pos[1] - pin[1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };
  let best = nearest((smp) => Math.abs(smp.s - est) <= window);
  if (best < 0) best = nearest(() => true);
  return Math.max(0, best);
}

/** Closed lines (more than 5 points, ends within 2e-5 degrees) among the map's streets: drawn roundabouts. */
function closedRings(ctx: BuildContext): Vec2[][] {
  return (ctx.sources.streets?.lines ?? [])
    .filter((l) => l.pts.length > 5 && Math.hypot(l.pts[0][0] - l.pts[l.pts.length - 1][0], l.pts[0][1] - l.pts[l.pts.length - 1][1]) < 2e-5)
    .map((l) => ctx.line(l.pts));
}

export function planRoute(ctx: BuildContext): RoutePlan {
  const { opts, sources, proj, local } = ctx;
  const widthAt = sources.widthAt;
  const widthFn = widthAt ? (x: number, y: number) => widthAt(proj.toLngLat([x, y])) : undefined;
  const hinted = resolveRoundabouts(sources.roundabouts ?? [], sources.osm?.roundaboutRings ?? [], proj);
  const tileRings = closedRings(ctx);
  const osmRings = (sources.osm?.roundaboutRings ?? []).map((r) => ctx.line(r.pts));
  const circles = [...hinted, ...ringsOnRoute([...osmRings, ...tileRings], local, hinted)];

  let ext: ReturnType<typeof extendRoute> | null = null;
  if (!isLoop(local) && (opts.runUp > 0 || opts.runOff > 0)) {
    const rows = Math.ceil(opts.pitCount / 2);
    const lines = (sources.streets?.lines ?? []).map((l) => ctx.line(l.pts));
    ext = extendRoute(local, lines, GRID_DEPTH + rows * 8 + opts.runUp, opts.runOff);
  }
  const plan = planRoad(ext?.path ?? local, opts, widthFn, circles);
  if (ext) {
    const total = pathLength(ext.path);
    plan.timed = {
      start: sampleNearPin(plan, local[0], ext.startAt / total),
      finish: sampleNearPin(plan, local[local.length - 1], ext.finishAt / total),
    };
  }
  const timedLength = () => (plan.timed ? plan.samples[plan.timed.finish].s - plan.samples[plan.timed.start].s : plan.length);
  if (timedLength() < MIN_LENGTH) throw new Error(`Road is ${Math.round(timedLength())} m; make it at least ${MIN_LENGTH} m`);
  return { plan, tileRings, timedLength };
}

/**
 * The sample a distance `s` along the road falls in (s_i <= s < s_i+1; wrapped on a loop, clamped
 * otherwise), and the AC position `t` to its left and `lift` over its surface. No interpolation:
 * the sample's own frame.
 */
export function along(plan: RoadPlan, s: number, t: number, lift: number, crown: number): { sample: RoadSample; pos: number[]; fwd: number[] } {
  const smp = plan.samples, n = smp.length;
  if (plan.closed) s = ((s % plan.length) + plan.length) % plan.length;
  else s = Math.max(0, Math.min(smp[n - 1].s, s));
  const step = n > 1 ? smp[n - 1].s / (n - 1) : 1;
  let i = Math.max(0, Math.min(n - 1, Math.floor(s / (step || 1))));
  while (i > 0 && smp[i].s > s) i--;
  while (i < n - 1 && smp[i + 1].s <= s) i++;
  const sample = smp[i];
  const x = sample.pos[0] + sample.left[0] * t, y = sample.pos[1] + sample.left[1] * t;
  return { sample, pos: toAc(x, y, surfaceHeight(sample, t, crown) + lift), fwd: [sample.tan[0], 0, -sample.tan[1]] };
}

const dummy = (name: string, transform: number[]): Kn5GroupNode => ({ kind: "node", name, transform, children: [] });

/**
 * Busselton fork: what the hand-placed spots (options gridAt and pits) need: the projection, and
 * for a pit box off the road, the ground under it.
 */
export interface FixedSpots {
  toLocal: (p: LngLat) => Vec2;
  /** Ground height at a local point; null where unknown (the nearest road sample's is used). */
  groundAt?: (x: number, y: number) => number | null;
}

/** How far a gridAt point may be from the road's centreline, m. */
export const GRID_AT_REACH = 30;

/** The sample nearest `p` (local metres) within `reach`; -1 when none is. */
export function nearestSample(plan: RoadPlan, p: Vec2, reach = Infinity): number {
  let best = -1, bestD = reach;
  plan.samples.forEach((smp, i) => {
    const d = Math.hypot(smp.pos[0] - p[0], smp.pos[1] - p[1]);
    if (d <= bestD) { bestD = d; best = i; }
  });
  return best;
}

/**
 * Spawn points and timing gates. The grid on the nearest straight before the start line clear of
 * roundabouts and `avoid`'s junctions (gridSlots.ts), single file in the AI line's lane on town
 * streets or when keeping left; two columns on a wide road, staggered on a circuit (raceway).
 * Busselton fork: with `fixed`, the option gridAt puts the front of the grid at a real grid box,
 * and pits puts AC_PIT_n in real pit bays. The other pit boxes aren't placed here: they go in a pit
 * row off the road once the world's ground is built (pitRow.ts addPitRow), never on the grid's
 * spots, where AC parked stuck AI cars on the racing line for good (retest 6).
 */
export function trackObjects(plan: RoadPlan, opts: BuildOptions, avoid: GridAvoid = {}, fixed?: FixedSpots): Kn5GroupNode[] {
  const out: Kn5GroupNode[] = [];
  const width = plan.samples[0].width;
  const rows = Math.ceil(opts.pitCount / 2);
  const offsets = opts.aiKeepLeft ? keepLeftOffsets(plan) : null;
  const stagger = !!opts.raceway;
  const gridAtI = opts.gridAt && fixed ? nearestSample(plan, fixed.toLocal(opts.gridAt), GRID_AT_REACH) : -1;
  const fronts = new Map<number, number>();
  const frontFor = (lineS: number, n: number) => {
    if (gridAtI >= 0) {
      const s = plan.samples[gridAtI].s;
      // On a loop the grid is before the line: a lap back when the box is past it.
      return plan.closed && s > lineS ? s - plan.length : s;
    }
    return gridFront(plan, n, lineS, avoid) ?? lineS - GRID_GAP;
  };
  const slot = (k: number, lineS: number) => {
    const single = !!offsets || along(plan, lineS - 8, 0, 0, 0).sample.width < 8;
    if (!fronts.has(lineS)) fronts.set(lineS, frontFor(lineS, single ? opts.pitCount : rows));
    const front = fronts.get(lineS)!;
    const at = along(plan, front - (single ? k : Math.floor(k / 2)) * GRID_GAP, 0, 0, 0).sample;
    const off = offsets ? offsets[plan.samples.indexOf(at)] ?? 0 : 0;
    return gridSlot(k, front, single ? at.width : width, off, single, stagger);
  };
  const place = (name: string, s: number, t: number, lift: number) => {
    const p = along(plan, s, t, lift, opts.crown);
    out.push(dummy(name, frameTransform(p.pos, p.fwd)));
  };
  const pitBay = (k: number): boolean => {
    const bay = fixed && opts.pits?.[k];
    if (!bay) return false;
    const [x, y] = fixed.toLocal([bay[0], bay[1]]);
    const near = plan.samples[Math.max(0, nearestSample(plan, [x, y]))];
    const h = fixed.groundAt?.(x, y) ?? near.h;
    const r = (bay[2] * Math.PI) / 180;
    out.push(dummy(`AC_PIT_${k}`, frameTransform(toAc(x, y, h + 0.5), [Math.sin(r), 0, -Math.cos(r)])));
    return true;
  };
  const grid = (lineS: number) => {
    for (let k = 0; k < opts.pitCount; k++) {
      const g = slot(k, lineS);
      place(`AC_START_${k}`, g.s, g.t, 0.5);
      pitBay(k);
    }
  };
  const samples = plan.samples;
  if (plan.closed) {
    grid(0);
    place("AC_HOTLAP_START_0", plan.length - 150, 0, 0.5);
    const half = width / 2 + 1;
    place("AC_TIME_0_L", 0, half, 1);
    place("AC_TIME_0_R", 0, -half, 1);
  } else {
    const end = samples[samples.length - 1].s;
    const startLine = plan.timed ? Math.max(GRID_DEPTH + 8 * rows, samples[plan.timed.start].s) : GRID_DEPTH + 8 * rows;
    grid(startLine);
    place("AC_HOTLAP_START_0", 4, 0, 0.5);
    const gate = (name: string, s: number) => {
      const half = along(plan, s, 0, 0, 0).sample.width / 2 + 1;
      place(`${name}_L`, s, half, 1);
      place(`${name}_R`, s, -half, 1);
    };
    gate("AC_AB_START", startLine);
    const finish = plan.timed ? Math.min(end - 25, samples[plan.timed.finish].s) : end - 25;
    gate("AC_AB_FINISH", finish);
  }
  return out;
}
