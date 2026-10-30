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

/** The area option as a list of polygons: one polygon ([lng, lat] corners), or several. */
export function areaRings<T extends [number, number]>(area: T[] | T[][] | undefined): T[][] {
  if (!area || !area.length) return [];
  const rings = (Array.isArray(area[0][0]) ? area : [area]) as T[][];
  return rings.filter((r) => r.length >= 3);
}

class Ring {
  readonly pts: Vec2[];
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;

  constructor(ring: Vec2[]) {
    const r = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
    if (r.length < 3) throw new Error("An area needs at least three corners");
    this.pts = r;
    this.minX = Math.min(...r.map((p) => p[0]));
    this.maxX = Math.max(...r.map((p) => p[0]));
    this.minY = Math.min(...r.map((p) => p[1]));
    this.maxY = Math.max(...r.map((p) => p[1]));
  }

  inside(x: number, y: number): boolean {
    if (x < this.minX || x > this.maxX || y < this.minY || y > this.maxY) return false;
    let c = false;
    const r = this.pts;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
}

/** One or more polygons, local metres; a point is in the area when it's in any of them. */
export class Area {
  readonly rings: Ring[];
  /** Every corner, for bounds. */
  readonly ring: Vec2[];
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  private edges: number[][] | null = null;

  constructor(rings: Vec2[] | Vec2[][]) {
    const list = (Array.isArray(rings[0]?.[0]) ? rings : [rings]) as Vec2[][];
    this.rings = list.map((r) => new Ring(r));
    this.ring = this.rings.flatMap((r) => r.pts);
    this.minX = Math.min(...this.rings.map((r) => r.minX));
    this.maxX = Math.max(...this.rings.map((r) => r.maxX));
    this.minY = Math.min(...this.rings.map((r) => r.minY));
    this.maxY = Math.max(...this.rings.map((r) => r.maxY));
  }

  inside(x: number, y: number): boolean {
    return this.rings.some((r) => r.inside(x, y));
  }

  /**
   * The outline of the whole area: each polygon's edges, less the stretches inside another
   * polygon (where two overlap or share an edge). [ax, ay, bx, by] per piece.
   */
  private outline(): number[][] {
    if (this.edges) return this.edges;
    const out: number[][] = [];
    const E = 0.01;
    for (const [k, r] of this.rings.entries()) {
      const pts = r.pts;
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
        if (L < 1e-9) continue;
        if (this.rings.length === 1) {
          out.push([ax, ay, bx, by]);
          continue;
        }
        // Split where the other polygons' edges cross this one.
        const ts = [0, 1];
        for (const [q, o] of this.rings.entries()) {
          if (q === k) continue;
          for (let j = 0; j < o.pts.length; j++) {
            const [cx, cy] = o.pts[j], [ex, ey] = o.pts[(j + 1) % o.pts.length];
            const fx = ex - cx, fy = ey - cy, den = dx * fy - dy * fx;
            if (Math.abs(den) < 1e-12) {
              // Parallel: on the same line, its ends split this edge.
              if (Math.abs((cx - ax) * dy - (cy - ay) * dx) / L > 1e-6) continue;
              for (const [px, py] of [[cx, cy], [ex, ey]]) {
                const t = ((px - ax) * dx + (py - ay) * dy) / (L * L);
                if (t > 0 && t < 1) ts.push(t);
              }
              continue;
            }
            const t = ((cx - ax) * fy - (cy - ay) * fx) / den, u = ((cx - ax) * dy - (cy - ay) * dx) / den;
            if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
          }
        }
        ts.sort((a, b) => a - b);
        const nx = -dy / L * E, ny = dx / L * E;
        for (let s = 1; s < ts.length; s++) {
          if (ts[s] - ts[s - 1] < 1e-9) continue;
          const tm = (ts[s] + ts[s - 1]) / 2, mx = ax + dx * tm, my = ay + dy * tm;
          // Part of the outline when open ground is on one side of it.
          if (this.inside(mx + nx, my + ny) && this.inside(mx - nx, my - ny)) continue;
          out.push([ax + dx * ts[s - 1], ay + dy * ts[s - 1], ax + dx * ts[s], ay + dy * ts[s]]);
        }
      }
    }
    this.edges = out;
    return out;
  }

  /**
   * Distance to the area's outline: negative inside, positive outside. Several polygons are one
   * area: where two overlap, a point near the seam is as deep as it is in the union, not near an
   * edge (the backdrop and the corridor checks treated the seam as the area's edge).
   */
  signed(x: number, y: number): number {
    let best = Infinity;
    for (const [ax, ay, bx, by] of this.outline()) {
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
