// Busselton fork: no pole or post on the carriageway.
//
// Poles come from sightings (Mapillary) and OSM, and lights and signs are placed relative to the
// route; neither knows about side streets, roundabout aprons or the far side of a junction, so a
// pole could end up standing on a street's asphalt. The built drivable meshes know (sceneGround.ts
// ROAD_SURFACE: route, gutters, rings, side streets, gravel), so a pole's foot is checked against
// them and, when it's on one, moved to the nearest clear spot: first straight out from the road it
// belongs to, then anywhere nearby. Where nothing is clear within reach it's dropped. Traffic
// islands and medians aren't road meshes, so a pole on a real island stays.
import type { Vec2 } from "./geo";
import type { SurfaceFn } from "./sceneGround";

/** True where a pole's foot would stand on a drivable surface. */
export type OnRoad = (x: number, y: number) => boolean;

/** A drivable-surface lookup (topSurface over ROAD_SURFACE) as an on-road test. */
export function onRoadFrom(drivable: SurfaceFn): OnRoad {
  return (x, y) => drivable(x, y) !== null;
}

/** Does a pole of radius `r` at `at` touch the road (its middle, or any of eight points round it)? */
export function footOnRoad(at: Vec2, r: number, onRoad: OnRoad): boolean {
  if (onRoad(at[0], at[1])) return true;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    if (onRoad(at[0] + Math.cos(a) * r, at[1] + Math.sin(a) * r)) return true;
  }
  return false;
}

export interface ClearOptions {
  /** The pole's radius plus the gap it keeps from the road edge, metres. */
  radius?: number;
  /** The way off the road it belongs to (unit vector), tried first. */
  away?: Vec2;
  /** The furthest it may move, metres. */
  reach?: number;
}

/**
 * Where a pole meant for `at` can stand off the road: `at` itself when clear, else the nearest
 * clear spot (straight `away` first), or null when there's none within `reach`.
 */
export function clearSpot(at: Vec2, onRoad: OnRoad | undefined, o: ClearOptions = {}): Vec2 | null {
  if (!onRoad) return at;
  const r = o.radius ?? 0.4, reach = o.reach ?? 6;
  if (!footOnRoad(at, r, onRoad)) return at;
  if (o.away) {
    const l = Math.hypot(o.away[0], o.away[1]) || 1;
    const u: Vec2 = [o.away[0] / l, o.away[1] / l];
    for (let d = 0.25; d <= reach + 1e-9; d += 0.25) {
      const p: Vec2 = [at[0] + u[0] * d, at[1] + u[1] * d];
      if (!footOnRoad(p, r, onRoad)) return p;
    }
  }
  for (let d = 0.5; d <= reach + 1e-9; d += 0.5) {
    const n = Math.max(8, Math.round((2 * Math.PI * d) / 0.5));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const p: Vec2 = [at[0] + Math.cos(a) * d, at[1] + Math.sin(a) * d];
      if (!footOnRoad(p, r, onRoad)) return p;
    }
  }
  return null;
}
