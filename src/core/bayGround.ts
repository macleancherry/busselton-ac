// Busselton fork: the height of a car park bay's pad (parkedPlacement.ts buildBayPads), so it meets
// the car park's aisles and the street without a step.
//
// The ground under a car park is the terrain's photo, and the terrain is held under the road and the
// streets (terrainUnderRoad), so beside an aisle it dips 10 to 30 cm below the asphalt. Pads laid a
// centimetre over that ground had a lip where they ran over an aisle and a step where they met it,
// and a car with one wheel in the dip sat 30 cm low on the other three. So a pad is:
//   - over the asphalt (an aisle, a street, the route): exactly the asphalt, no lift, so there's no
//     lip where the two overlap;
//   - off it: the ground plus PAD_LIFT, but never below the nearest asphalt carried on outwards at a
//     gentle fall (BAY_FALL), so it leaves the aisle's edge flush and runs down onto the ground.
import type { HeightFn } from "./elevation";
import type { SurfaceFn } from "./sceneGround";

/** Every surface a pad meets flush: the route, streets and aisles, their gutters, fills and crossovers. */
export const BAY_ASPHALT = /^\d(ROAD(?!_PATH)|STREET(?!_PATH|_CARPARK)|UNSEALED|UNPAVED)/;
/** How fast a pad falls away from the asphalt's edge, rise over run (AS 2890.1 allows 1 in 20 in a bay). */
export const BAY_FALL = 0.03;
/** How far from a pad point the nearest asphalt is looked for, metres. */
export const BAY_REACH = 10;
/** How far a pad stands over the ground away from the asphalt, metres. */
export const PAD_LIFT = 0.01;

/** The nearest asphalt within `reach` of a point: its height and distance, or null. 16 directions, finer close in. */
export function nearestAsphalt(asphalt: SurfaceFn, x: number, y: number, reach = BAY_REACH): { h: number; d: number } | null {
  const h0 = asphalt(x, y);
  if (h0 !== null) return { h: h0, d: 0 };
  for (let d = 0.25; d <= reach + 1e-9; d += d < 2 ? 0.25 : 0.5) {
    let best: number | null = null;
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      const h = asphalt(x + Math.cos(a) * d, y + Math.sin(a) * d);
      if (h !== null && (best === null || h > best)) best = h;
    }
    if (best !== null) return { h: best, d };
  }
  return null;
}

/**
 * The pad's height at a point: the asphalt where there is some, else the higher of the ground plus
 * PAD_LIFT and the nearest asphalt falling away at BAY_FALL.
 */
export function bayHeight(ground: HeightFn, asphalt: SurfaceFn): HeightFn {
  return (x, y) => {
    const n = nearestAsphalt(asphalt, x, y);
    if (n && n.d === 0) return n.h;
    const g = ground(x, y) + PAD_LIFT;
    return n ? Math.max(g, n.h - BAY_FALL * n.d) : g;
  };
}
