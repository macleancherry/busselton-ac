// Busselton fork: the files the Busselton Challenges app reads (apps/lua/BusseltonChallenges), in one
// place so the hook in track.ts stays a single line:
//
//   data/challenges.ini         the layout's checkpoint sets (hand-picked from the route's
//                               `challenges` option, else generated) and, on a point-to-point
//                               road, its time trial (start, splits, finish)
//   extension/drift_zones.ini   drift spots in empty car parks, shared by every layout
//
// Layouts other than the main one get their challenges.ini from layoutChallengesIni (layouts.ts).

import { pointInRing } from "./buildings";
import { challengeCheckpoints, challengesIni, handPickedSets, pickSets, type ChallengePoi, type ChallengesOption } from "./challenges";
import { carParkName, driftZones, driftZonesIni } from "./driftZones";
import type { LngLat, Vec2 } from "./geo";
import type { Kn5GroupNode } from "./kn5";
import type { BuildOptions } from "./options";
import type { RoadPlan } from "./road";
import { timeTrial } from "./timeTrial";

const enc = new TextEncoder();

export interface ChallengeContext {
  plan: RoadPlan;
  /** The layout's timing dummies (trackObjects): the time trial starts and ends on AC's AB lines. */
  dummies: Kn5GroupNode[];
  /** Nearest route sample within r metres (SegmentIndex.nearest). */
  nearest: (x: number, y: number, r: number) => { seg: number; dist: number } | null;
  toLocal: (p: LngLat) => Vec2;
  ground: (x: number, y: number) => number;
  /** Points of interest, local metres. */
  pois: ChallengePoi[];
  routeNames: (string | undefined)[];
  junctions: { s: number; name?: string }[];
  /** The side streets the track builds, local metres. */
  streets: { pts: Vec2[]; width: number; name?: string; service?: string }[];
  /** Parked cars the track places, local metres. */
  parked: Vec2[];
  /** Building footprints, local metres. */
  buildings: Vec2[][];
}

/** A lookup for "is there a building here", by a grid of footprint boxes. */
function buildingTest(rings: Vec2[][], cell = 25): (x: number, y: number) => boolean {
  const grid = new Map<string, Vec2[][]>();
  for (const r of rings) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) {
      for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
        const k = `${gx},${gy}`;
        const l = grid.get(k);
        if (l) l.push(r); else grid.set(k, [r]);
      }
    }
  }
  return (x, y) => (grid.get(`${Math.floor(x / cell)},${Math.floor(y / cell)}`) ?? []).some((r) => pointInRing(x, y, r));
}

/** Distance from a point to the edge of the nearest of some lines (Infinity past `reach`). */
function lineClearance(lines: { pts: Vec2[]; width: number }[], reach = 60): (x: number, y: number) => number {
  const cell = reach;
  const grid = new Map<string, [Vec2, Vec2, number][]>();
  for (const l of lines) {
    for (let i = 1; i < l.pts.length; i++) {
      const a = l.pts[i - 1], b = l.pts[i];
      for (let gx = Math.floor(Math.min(a[0], b[0]) / cell); gx <= Math.floor(Math.max(a[0], b[0]) / cell); gx++) {
        for (let gy = Math.floor(Math.min(a[1], b[1]) / cell); gy <= Math.floor(Math.max(a[1], b[1]) / cell); gy++) {
          const k = `${gx},${gy}`;
          const list = grid.get(k);
          if (list) list.push([a, b, l.width]); else grid.set(k, [[a, b, l.width]]);
        }
      }
    }
  }
  return (x, y) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let best = Infinity;
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (const [a, b, w] of grid.get(`${gx},${gy}`) ?? []) {
        const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
        best = Math.min(best, Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t) - w / 2);
      }
    }
    return best;
  };
}

const AISLE = /^parking_aisle$/;

/** The name of the street nearest a point (the route's, else a side street's, within 25 m). */
function streetNamer(ctx: Pick<ChallengeContext, "nearest" | "routeNames" | "streets">) {
  return (x: number, y: number): string | undefined => {
    const n = ctx.nearest(x, y, 25);
    if (n && ctx.routeNames[n.seg]) return ctx.routeNames[n.seg];
    let best: string | undefined, bd = 25;
    for (const st of ctx.streets) {
      if (!st.name || (st.service && AISLE.test(st.service))) continue;
      for (const p of st.pts) {
        const d = Math.hypot(p[0] - x, p[1] - y);
        if (d < bd) { bd = d; best = st.name; }
      }
    }
    return best;
  };
}

/** data/challenges.ini and extension/drift_zones.ini for a build (before asLayout moves data/). */
export function challengeFiles(slug: string, opts: BuildOptions, ctx: ChallengeContext): Record<string, Uint8Array> {
  const hand = handPickedSets(opts.challenges as ChallengesOption | undefined, ctx.toLocal, ctx.ground, streetNamer(ctx));
  const sets = pickSets(hand, () => challengeCheckpoints(ctx.plan, ctx.nearest, ctx.pois, ctx.routeNames, 6, ctx.junctions));
  const tt = timeTrial(ctx.plan, ctx.dummies, ctx.routeNames, { name: opts.name, sectors: opts.timeTrialSectors });
  const files: Record<string, Uint8Array> = {
    [`${slug}/data/challenges.ini`]: enc.encode(challengesIni(opts.name, sets.points, { setName: sets.setName, sets: sets.sets, timeTrial: tt })),
  };
  if (opts.driftZones !== false) {
    const aisles = ctx.streets.filter((st) => st.service && AISLE.test(st.service));
    const roads = ctx.streets.filter((st) => !(st.service && AISLE.test(st.service)));
    const sideClear = lineClearance(roads);
    const S = ctx.plan.samples;
    const zones = driftZones({
      aisles: aisles.map((a) => a.pts),
      parked: ctx.parked,
      roadClearance: (x, y) => {
        const n = ctx.nearest(x, y, 60);
        const route = n ? n.dist - S[n.seg].width / 2 : Infinity;
        return Math.min(route, sideClear(x, y));
      },
      blocked: buildingTest(ctx.buildings),
      ground: ctx.ground,
      nameAt: carParkName(ctx.pois.filter((p) => p.name), roads),
    });
    files[`${slug}/extension/drift_zones.ini`] = enc.encode(driftZonesIni(zones));
  }
  return files;
}

/**
 * challenges.ini for a layout built on an existing world (layoutFiles): its hand-picked sets and, if
 * it runs point to point, its time trial. Null when it has neither (the app then says so).
 */
export function layoutChallengesIni(
  name: string,
  /** The layout's road and timing dummies; null for free roam (spawn points only). */
  road: { plan: RoadPlan; dummies: Kn5GroupNode[] } | null,
  toLocal: (p: LngLat) => Vec2,
  ground: (x: number, y: number) => number,
  raw?: ChallengesOption,
  sectors?: number,
): string | null {
  const hand = handPickedSets(raw, toLocal, ground);
  const tt = road ? timeTrial(road.plan, road.dummies, [], { name, sectors }) : null;
  if (!hand.length && !tt) return null;
  const sets = pickSets(hand, () => []);
  return challengesIni(name, sets.points, { setName: hand.length ? sets.setName : "Checkpoints", sets: sets.sets, timeTrial: tt });
}
