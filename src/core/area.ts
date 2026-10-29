// Busselton fork: area builds. A route builds a strip `corridor` metres either side of its road;
// an area (a polygon in the route file) also builds everything inside it, so every street in a
// town or an estate is there to drive, not only those near one loop.
//
// "Cover" is the one measure the corridor checks use: how far a point is from the middle of what's
// built, in the corridor's terms. Along the route it is the distance to the road's centreline (as
// before); inside the area it is at most `corridor` minus the distance in from the area's edge, so
// a check like "within corridor - 5 m" holds anywhere 5 m or more inside the area.
import type { BuildOptions } from "./options";
import type { SegmentIndex } from "./road";

type Vec2 = [number, number];

export class Area {
  readonly ring: Vec2[];
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;

  constructor(ring: Vec2[]) {
    const r = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
    if (r.length < 3) throw new Error("An area needs at least three corners");
    this.ring = r;
    this.minX = Math.min(...r.map((p) => p[0]));
    this.maxX = Math.max(...r.map((p) => p[0]));
    this.minY = Math.min(...r.map((p) => p[1]));
    this.maxY = Math.max(...r.map((p) => p[1]));
  }

  inside(x: number, y: number): boolean {
    if (x < this.minX || x > this.maxX || y < this.minY || y > this.maxY) return false;
    let c = false;
    const r = this.ring;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  /** Distance to the edge: negative inside, positive outside. */
  signed(x: number, y: number): number {
    let best = Infinity;
    const r = this.ring;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [ax, ay] = r[j], [bx, by] = r[i];
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
    }
    return this.inside(x, y) ? -best : best;
  }
}

/** Cover at a point (see above); Infinity when nowhere near anything built (more than `reach` past the corridor). */
export type Cover = (x: number, y: number) => number;

export function makeCover(index: SegmentIndex, opts: BuildOptions, area: Area | null, reach = 400): Cover {
  return (x, y) => {
    const n = index.nearest(x, y, opts.corridor + reach);
    const d = n ? n.dist : Infinity;
    if (!area) return d;
    // Cheap reject before the edge distance.
    if (x < area.minX - opts.corridor - reach || x > area.maxX + opts.corridor + reach
      || y < area.minY - opts.corridor - reach || y > area.maxY + opts.corridor + reach) return d;
    const a = opts.corridor + area.signed(x, y);
    return Math.min(d, a > opts.corridor + reach ? Infinity : a);
  };
}
