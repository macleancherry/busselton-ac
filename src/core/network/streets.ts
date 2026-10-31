// networkCore phase 2: the streets between junctions planned from the graph (docs/specs/road-network.md,
// "Phase 2"). One street per graph edge, in the edge's own direction, cut away where the route's ribbon
// covers it (the route is built by the old core and is the road there) and where a roundabout that the
// old core still builds sits; ends cut by the route run on to its edge (a mouth, as the old side
// streets do, for junctions the network doesn't take). Divided roads are one street with a median.
// The result has the old side streets' shape, so the build's consumers (houses, traffic, signs, the
// street map) take it as it is; `edge` ties each street to its graph edge.

import { classRank, type Graph, type NetEdge } from "./graph";
import { add, along, dist, dot, lengths, mul, resampleLine, sub, unit, type P2 } from "./geom";
import type { RingIn, RouteRibbon } from "./ribbons";

export interface GraphStreet {
  pts: P2[];
  width: number;
  widths?: number[];
  joins: number[];
  cls: string;
  name?: string;
  oneway?: 1 | -1;
  service?: string;
  surface?: string;
  /** The graph edge it's built from, and where on it (arc length of pts[0] along the edge). */
  edge: number;
  edgeS0: number;
  /** A divided road: the median's width (the asphalt is either side of it). */
  median?: number;
  /** One carriageway of a divided road (the route is the other): 1 the edge's left one, -1 its right. */
  half?: 1 | -1;
}

/** A street meeting the route's edge (sideStreets.ts's Junction). */
export interface Mouth {
  seg: number;
  s: number;
  side: 1 | -1;
  width: number;
  dir: P2;
  name?: string;
}

export interface GraphStreetOptions {
  route: RouteRibbon | null;
  /** Roundabouts the build makes (the old core's, until the network takes them). */
  rings: RingIn[];
  /** Inside the area polygon (every street there is built). */
  inArea: (p: P2) => boolean;
  /** Outside the area, streets within this of the route are built (sideStreets' corridor). */
  corridor: number;
  vergeWidth: number;
  nameAt?: (p: P2) => string | undefined;
}

/** Asphalt width by class for an undivided two-way street (the old side streets' widths). */
const CLASS_WIDTH: Record<string, number> = { primary: 7.5, secondary: 7, tertiary: 6.5, minor: 6, service: 4, track: 3.5 };
const BUILT = /^(primary|secondary|tertiary|minor|residential|unclassified|living_street|road|service|track)(_link)?$/;

export function streetWidth(e: NetEdge): number {
  if (e.median !== undefined || e.oneway) return e.width;
  return CLASS_WIDTH[e.cls.replace(/_link$/, "")] ?? e.width;
}

export function planGraphStreets(g: Graph, o: GraphStreetOptions): { streets: GraphStreet[]; mouths: Mouth[] } {
  const streets: GraphStreet[] = [];
  const mouths: Mouth[] = [];
  const S = o.route?.samples ?? [];
  const n = S.length;
  const routeAt = (p: P2, max: number) => {
    if (!o.route) return null;
    const nr = o.route.nearest(p[0], p[1], max);
    if (!nr) return null;
    const a = S[nr.seg], b = S[(nr.seg + 1) % n];
    const width = a.width + (b.width - a.width) * nr.frac;
    const side: 1 | -1 = dot(sub(p, a.pos), a.left) >= 0 ? 1 : -1;
    return { ...nr, width, side };
  };
  // A divided road the route runs along one carriageway of: the other carriageway is a street of its
  // own (one-way, offset to its side) there; the rest of it is one street with its median.
  interface Piece { e: NetEdge; dense: P2[]; s0: number; width: number; oneway?: 1 | -1; median?: number; half?: 1 | -1 }
  const pieces: Piece[] = [];
  for (const e of g.edges) {
    if (e.internal || e.layer !== 0 || !BUILT.test(e.cls) || e.pts.length < 2) continue;
    const width = streetWidth(e);
    const cum = lengths(e.pts);
    if (cum[cum.length - 1] < 1) continue;
    const dense = resampleLine(e.pts, 2);
    const dcum = lengths(dense);
    if (e.median === undefined || !o.route) { pieces.push({ e, dense, s0: 0, width, oneway: e.oneway, median: e.median }); continue; }
    const cw = (width - e.median) / 2, off = e.median / 2 + cw / 2;
    const flag = dense.map((p, k) => {
      const d = unit(sub(dense[Math.min(dense.length - 1, k + 1)], dense[Math.max(0, k - 1)]));
      const left: P2 = [-d[1], d[0]];
      for (const side of [1, -1] as const) {
        const c = add(p, mul(left, side * off));
        const nr = o.route!.nearest(c[0], c[1], Math.max(1.5, cw / 2));
        if (nr && Math.abs(dot(S[nr.seg].tan, d)) > 0.8) return side;
      }
      return 0;
    });
    // Short flickers don't count (a few samples where the route turns off).
    for (let k = 0; k < flag.length;) {
      let m = k;
      while (m < flag.length && flag[m] === flag[k]) m++;
      if (flag[k] !== 0 && m - k < 4) for (let q = k; q < m; q++) flag[q] = 0;
      k = m;
    }
    for (let k = 0; k < dense.length;) {
      let m = k;
      while (m < dense.length && flag[m] === flag[k]) m++;
      const part = dense.slice(k, Math.min(dense.length, m + 1));
      const f = flag[k] as 0 | 1 | -1;
      if (part.length >= 2) {
        if (f === 0) pieces.push({ e, dense: part, s0: dcum[k], width, median: e.median });
        else {
          // The route is on carriageway f: the street is the other one (keep left: the left carriageway runs with the edge).
          const half = (-f) as 1 | -1;
          const pts = part.map((p, q) => {
            const d = unit(sub(part[Math.min(part.length - 1, q + 1)], part[Math.max(0, q - 1)]));
            return add(p, mul([-d[1], d[0]], half * off));
          });
          pieces.push({ e, dense: pts, s0: dcum[k], width: cw, oneway: half, half });
        }
      }
      k = m;
    }
  }
  for (const pc of pieces) {
    const { e, dense, width } = pc;
    const dcum = lengths(dense).map((v) => v + pc.s0);
    type State = "keep" | "route" | "ring" | "far";
    const state: State[] = dense.map((p) => {
      if (o.rings.some((r) => dist(p, r.c) < r.r + r.w / 2 + o.vergeWidth + width / 2)) return "ring";
      const near = routeAt(p, o.corridor);
      // A divided road's other carriageway runs right beside the route: only where it really overlaps.
      if (near && near.dist < (pc.half ? near.width / 2 + width / 2 - 0.5 : near.width / 2 + o.vergeWidth + (width / 2) * 0.2 + 0.3)) return "route";
      if (o.inArea(p)) return "keep";
      return near && near.dist < o.corridor - 3 ? "keep" : "far";
    });
    for (let i = 0; i < dense.length;) {
      if (state[i] !== "keep") { i++; continue; }
      let j = i;
      while (j < dense.length && state[j] === "keep") j++;
      let pts = dense.slice(i, j);
      let s0 = dcum[i];
      const joins: number[] = [];
      const newMouths: Mouth[] = [];
      // Ends cut by the route run on along the street to the route's edge.
      const toRoute = (end: P2, out: P2): P2 | null => {
        const near = routeAt(end, 30);
        if (!near) return null;
        const smp = S[near.seg];
        const across = Math.abs(dot(out, smp.left));
        const back = (near.dist - (near.width / 2 - 0.05)) / Math.max(0.35, across);
        newMouths.push({ seg: near.seg, s: smp.s, side: near.side, width, dir: out });
        return sub(end, mul(out, back));
      };
      // Ends cut by a roundabout the old core builds run on to its outer edge.
      const toRing = (end: P2, cut: P2): P2 | null => {
        const rb = o.rings.find((r) => dist(cut, r.c) < r.r + r.w / 2 + o.vergeWidth + width);
        if (!rb) return null;
        const d = dist(end, rb.c) || 1, R = rb.r + rb.w / 2 - 0.4;
        return d > R ? add(rb.c, mul(sub(end, rb.c), R / d)) : null;
      };
      if (pts.length > 1 && i > 0) {
        const out = unit(sub(pts[1], pts[0]));
        const e2 = state[i - 1] === "route" ? toRoute(pts[0], out) : state[i - 1] === "ring" ? toRing(pts[0], dense[i - 1]) : null;
        if (e2) {
          s0 -= dist(e2, pts[0]);
          pts = [e2, ...pts];
          if (state[i - 1] === "route") joins.push(0);
        }
      }
      if (pts.length > 1 && j < dense.length) {
        const k = pts.length - 1;
        const out = unit(sub(pts[k - 1], pts[k]));
        const e2 = state[j] === "route" ? toRoute(pts[k], out) : state[j] === "ring" ? toRing(pts[k], dense[j]) : null;
        if (e2) {
          pts = [...pts, e2];
          if (state[j] === "route") joins.push(pts.length - 1);
        }
      }
      const L = lengths(pts);
      if (L[L.length - 1] >= 8 || (L[L.length - 1] >= 2 && i === 0 && j === dense.length && !pc.half)) {
        const name = e.name ?? o.nameAt?.(pts[Math.floor(pts.length / 2)]);
        for (const m of newMouths) { if (name) m.name = name; mouths.push(m); }
        streets.push({
          pts, width, joins, cls: e.cls, edge: e.id, edgeS0: s0,
          ...(name ? { name } : {}), ...(pc.oneway ? { oneway: pc.oneway } : {}),
          ...(e.service ? { service: e.service } : {}), ...(e.surface ? { surface: e.surface } : {}),
          ...(pc.median !== undefined && pc.median > 0.3 ? { median: pc.median } : {}),
          ...(pc.half ? { half: pc.half } : {}),
        });
      }
      i = j;
    }
  }
  // One mouth per place on each side (two edges meeting the route at the same spot).
  const merged: Mouth[] = [];
  for (const m of mouths.sort((a, b) => a.s - b.s)) {
    const prev = merged.find((x) => x.side === m.side && Math.abs(x.s - m.s) < Math.max(x.width, m.width));
    if (prev) prev.name ??= m.name;
    else merged.push(m);
  }
  return { streets, mouths: merged };
}

/** Rank of a street's class (for kerbs and markings). */
export const streetRank = (st: { cls: string }) => classRank(st.cls);

/** Point and direction at arc length s along a street. */
export const streetAt = (st: { pts: P2[] }, s: number, cum = lengths(st.pts)) => along(st.pts, s, cum);
