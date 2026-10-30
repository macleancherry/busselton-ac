// Busselton fork: parked cars against the built roads (docs/external-review-2026-10-31.md, F3 and
// recommendation 3).
//
// Parked cars come from the aerial photo (carpark.ts), with pixel-ratio filters and centre-point
// checks against the route and streets. Those are the first pass. This is the last one, after the
// build: a car any part of whose footprint (4.5 x 1.8 m, sampled every half metre) is on the route's
// road surface as built (its asphalt, gutters and roundabout carriageways), on a through street (not a
// car park aisle or driveway: a car parked in a bay often reaches over the aisle's edge), on a
// roundabout's disc, or within half a lane of a traffic lane, goes.
import type { Vec2 } from "./geo";
import type { SurfaceFn } from "./sceneGround";

/** The route's driving surface: its asphalt (or gravel), gutters and roundabout carriageways. */
export const ROUTE_ROAD = /^\d(ROAD(?!_PATH)|UNSEALED)/;

/** A parked car's body, metres (parkedCars.ts). */
export const CAR_LENGTH = 4.5, CAR_WIDTH = 1.8;
/** Half a traffic lane: a car's footprint keeps at least this far off a lane's centreline. */
export const LANE_HALF = 1.4;

/** Points over a car's footprint, every `step` metres along and across, edges included. */
export function carFootprint(at: Vec2, dir: Vec2, step = 0.5): Vec2[] {
  const l = Math.hypot(dir[0], dir[1]) || 1;
  const fx = dir[0] / l, fy = dir[1] / l, sx = -fy, sy = fx;
  const na = Math.ceil(CAR_LENGTH / step), nc = Math.ceil(CAR_WIDTH / step);
  const out: Vec2[] = [];
  for (let i = 0; i <= na; i++) {
    const f = -CAR_LENGTH / 2 + (CAR_LENGTH * i) / na;
    for (let j = 0; j <= nc; j++) {
      const s = -CAR_WIDTH / 2 + (CAR_WIDTH * j) / nc;
      out.push([at[0] + fx * f + sx * s, at[1] + fy * f + sy * s]);
    }
  }
  return out;
}

export interface RoadClearance {
  /** The route's road surface meshes as built (topSurface with ROUTE_ROAD): non-null over the road. */
  road: SurfaceFn;
  /** Distance to the nearest through street's edge, negative inside it. */
  street?: (x: number, y: number) => number;
  /** Roundabouts: centre and outer radius (the whole disc, island and all). */
  rings?: { c: Vec2; r: number }[];
  /** Distance to the nearest traffic lane's centreline, when the build has traffic. */
  lane?: (x: number, y: number) => number;
}

/**
 * Why a car can't stay, or null when it's clear. A car in a kerbside bay (`kerb`, parkedPlacement.ts)
 * stands on its street by design: for it the through-street test is left out (the lane test still holds).
 */
export function parkedConflict(car: { at: Vec2; dir: Vec2; kerb?: boolean }, by: RoadClearance): "road" | "roundabout" | "lane" | null {
  const pts = carFootprint(car.at, car.dir);
  if (by.rings?.some((rb) => pts.some(([x, y]) => Math.hypot(x - rb.c[0], y - rb.c[1]) < rb.r))) return "roundabout";
  const street = car.kerb ? undefined : by.street;
  if (pts.some(([x, y]) => by.road(x, y) !== null || (street !== undefined && street(x, y) < 0))) return "road";
  if (by.lane && pts.some(([x, y]) => by.lane!(x, y) < LANE_HALF)) return "lane";
  return null;
}

/** The cars whose footprint is clear of every road, roundabout and lane, and a count of each kind dropped. */
export function clearParked<T extends { at: Vec2; dir: Vec2; kerb?: boolean }>(cars: T[], by: RoadClearance): { kept: T[]; dropped: Record<"road" | "roundabout" | "lane", number> } {
  const dropped = { road: 0, roundabout: 0, lane: 0 };
  const kept = cars.filter((c) => {
    const why = parkedConflict(c, by);
    if (why) dropped[why]++;
    return !why;
  });
  return { kept, dropped };
}
