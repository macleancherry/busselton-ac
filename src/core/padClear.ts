// Busselton fork: car park bays keep off whatever already stands there.
//
// The bays' pads (parkedPlacement.ts buildBayPads) are laid after the scenery: car park lights,
// street lights and sign posts, front walls, fences, sheds and houses were all placed on the ground
// under where a pad then went, so the pad's physics surface came up round their feet and the ground
// check found them 5 to 12 cm sunk, and the poles standing on a drivable mesh (1STREET_CARPARK).
// So a bay whose quad (plus a small gap) holds the foot of anything placed is left out, with any
// car parked in it: the feet are the placed meshes' vertices near the ground, gathered only round
// the bays.
import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import type { Kn5Node } from "./kn5";

/** Groups whose meshes stand on the ground and must not end up under a pad. Paths and trees (crowns overhang) aren't. */
export const STANDING_GROUPS = new Set(["FURNITURE", "TRAFFICLIGHTS", "GUIDEPOSTS", "BUILDINGS", "SHOPS", "FENCES", "FARM", "LOTS", "RAILS"]);
/** A vertex this close over the ground (or under it) is a foot, metres. */
export const FOOT_REACH = 0.3;
/** How far a foot keeps from a bay's edge, metres. */
export const BAY_GAP = 0.25;

type Quad = [Vec2, Vec2, Vec2, Vec2];

/** A grid cell as one number (cells within ±500 km of the origin). */
const cellKey = (i: number, j: number) => (i + 250000) * 500000 + (j + 250000);

/** Feet as points in a 1 m grid, for nearby lookups. */
export class Feet {
  private cells = new Map<string, Vec2[]>();
  count = 0;
  add(p: Vec2): void {
    const k = `${Math.floor(p[0])},${Math.floor(p[1])}`;
    const l = this.cells.get(k);
    if (l) l.push(p); else this.cells.set(k, [p]);
    this.count++;
  }
  /** Every foot inside the box. */
  within(x0: number, y0: number, x1: number, y1: number): Vec2[] {
    const out: Vec2[] = [];
    for (let i = Math.floor(x0); i <= Math.floor(x1); i++)
      for (let j = Math.floor(y0); j <= Math.floor(y1); j++)
        for (const p of this.cells.get(`${i},${j}`) ?? []) if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) out.push(p);
    return out;
  }
}

/** How far a point is outside a convex quad (negative inside), metres. */
export function outsideQuad(q: Quad, x: number, y: number): number {
  let area = 0;
  for (let k = 0; k < 4; k++) { const a = q[k], b = q[(k + 1) % 4]; area += a[0] * b[1] - b[0] * a[1]; }
  const s = area >= 0 ? 1 : -1;
  let worst = -Infinity;
  for (let k = 0; k < 4; k++) {
    const a = q[k], b = q[(k + 1) % 4];
    const ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1;
    // Outward normal: right of the edge for a counter-clockwise quad.
    const d = (s * (ex * (y - a[1]) - ey * (x - a[0]))) / -l;
    if (d > worst) worst = d;
  }
  return worst;
}

const boxOf = (q: Quad, m: number) => [
  Math.min(...q.map((p) => p[0])) - m, Math.min(...q.map((p) => p[1])) - m,
  Math.max(...q.map((p) => p[0])) + m, Math.max(...q.map((p) => p[1])) + m,
] as const;

/**
 * The feet of the placed meshes round the bays: every vertex of a STANDING_GROUPS group (the model
 * root's children, by name) within FOOT_REACH of `ground`, inside a bay's box plus the gap.
 */
export function feetNear(nodes: Kn5Node[], quads: Quad[], ground: HeightFn, groups = STANDING_GROUPS): Feet {
  const feet = new Feet();
  if (!quads.length) return feet;
  // The bays' 2 m cells, so most vertices are passed over without a height lookup.
  const near = new Set<number>();
  for (const q of quads) {
    const [x0, y0, x1, y1] = boxOf(q, BAY_GAP + 0.1);
    for (let i = Math.floor(x0 / 2); i <= Math.floor(x1 / 2); i++) for (let j = Math.floor(y0 / 2); j <= Math.floor(y1 / 2); j++) near.add(cellKey(i, j));
  }
  const walk = (n: Kn5Node) => {
    if (n.kind === "node") return n.children.forEach(walk);
    const p = n.positions;
    for (let v = 0; v < p.length; v += 3) {
      const x = p[v], y = -p[v + 2];
      if (!near.has(cellKey(Math.floor(x / 2), Math.floor(y / 2)))) continue;
      if (p[v + 1] <= ground(x, y) + FOOT_REACH) feet.add([x, y]);
    }
  };
  for (const n of nodes) if (n.kind === "node" && groups.has(n.name)) walk(n);
  return feet;
}

/**
 * The bays clear of every foot (none inside a quad or within `gap` of it), and the cars kept: a car
 * whose middle is in a bay that was left out goes with it.
 */
export function clearBays<C extends { at: Vec2 }>(quads: Quad[], cars: C[], feet: Feet, gap = BAY_GAP): { quads: Quad[]; cars: C[]; dropped: number } {
  const kept: Quad[] = [], out: Quad[] = [];
  for (const q of quads) {
    const [x0, y0, x1, y1] = boxOf(q, gap);
    (feet.within(x0, y0, x1, y1).some(([x, y]) => outsideQuad(q, x, y) <= gap) ? out : kept).push(q);
  }
  const carsKept = out.length ? cars.filter((c) => !out.some((q) => outsideQuad(q, c.at[0], c.at[1]) <= 0)) : cars;
  return { quads: kept, cars: carsKept, dropped: out.length };
}
