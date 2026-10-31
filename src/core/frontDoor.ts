// Busselton fork: where a house's front wall is and what sits on it (docs/specs/buildings.md,
// docs/specs/lots.md). One rule shared by buildings.ts (which draws the doors) and lots.ts (which
// keeps the driveway and the path to the door clear), so the two can't drift apart.

import type { Vec2 } from "./geo";

const dist = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const middle = (p: Vec2, q: Vec2): Vec2 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];

/**
 * The index k of the ring edge (ring[k] to ring[k + 1]) that is the recorded front wall, or -1 when
 * there's no front or the best edge has no length. An edge whose ends lie within 1 m in total of the
 * front's ends (either way round) matches; otherwise the edge whose middle is nearest the front's
 * middle wins, so a front that drifted (snapped, or a reversed ring) still finds its wall.
 */
export function frontEdgeIndex(ring: Vec2[], front: [Vec2, Vec2] | undefined): number {
  if (!front || ring.length < 2) return -1;
  const fm = middle(front[0], front[1]);
  let best = -1, bestScore = Infinity;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length];
    const ends = Math.min(dist(a, front[0]) + dist(b, front[1]), dist(a, front[1]) + dist(b, front[0]));
    const score = ends < 1 ? ends : 1 + dist(middle(a, b), fm);
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  if (best < 0) return -1;
  return dist(ring[best], ring[(best + 1) % ring.length]) > 0 ? best : -1;
}

/** Metres along the front wall from its start. */
export type Along = [number, number];

/** Garage door width and where it starts along the front wall. */
export const GARAGE_SPAN: Along = [0.6, 3.2];
export const DOOR_WIDTH = 0.85;

/**
 * The garage door and front door on a house's front wall of length `len`. Nothing under 5 m.
 * With a garage (and at least 6 m of wall): the garage at 0.6 to 3.2 m, the door starting at
 * max(3.6, min(4.2, len - 2.25)), left out if it would end within 0.3 m of the wall's end.
 * Otherwise no garage and the door centred a third of the way along.
 */
export function frontSpans(len: number, garage: boolean | undefined): { garage: Along | null; door: Along | null } {
  if (!(len >= 5)) return { garage: null, door: null };
  if (garage && len >= 6) {
    const d0 = Math.max(3.6, Math.min(4.2, len - 1.4 - DOOR_WIDTH));
    return { garage: [GARAGE_SPAN[0], GARAGE_SPAN[1]], door: d0 + DOOR_WIDTH <= len - 0.3 ? [d0, d0 + DOOR_WIDTH] : null };
  }
  const mid = len / 3;
  return { garage: null, door: [mid - DOOR_WIDTH / 2, mid + DOOR_WIDTH / 2] };
}
