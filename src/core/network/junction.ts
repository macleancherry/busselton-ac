// Junction polygons (docs/specs/road-network.md, "Junction polygons"). Each leg is its centreline
// buffered by its half width with a flat end at the cap; legs join with a smooth union whose radius
// is the kerb return; a roundabout adds the circulating disc and takes away the island and the
// splitter islands. Everything is a signed distance (negative inside), so the outline, the trims
// and the mesh all come from one function.

import { classRank, legLine, type Graph, type NetNode } from "./graph";
import { add, along, dist, dot, leftOf, lengths, lineDist, mul, slice, sub, type P2 } from "./geom";

export interface Leg {
  edge: number;
  start: boolean;
  /** Centreline from the node outward. */
  line: P2[];
  /** Half the asphalt width. */
  hw: number;
  rank: number;
  /** Distance along `line` to the cap. */
  trim: number;
  /** Cap centre, outward direction, and left (anticlockwise) normal. */
  cap: { c: P2; d: P2; left: P2 };
  /** The trim hit its limit before clearing the other legs (junctions this close should merge). */
  crowded?: boolean;
}

export interface JunctionShape {
  node: number;
  kind: "junction" | "roundabout";
  legs: Leg[];
  /** Smooth-union blend distance (about 1.17 x the kerb return radius). */
  k: number;
  /** Signed distance to the junction's road area, metres (negative inside). */
  sdf: (p: P2) => number;
  /** Bounding box [minX, minY, maxX, maxY]. */
  box: [number, number, number, number];
  ring?: { c: P2; rIn: number; rOut: number };
}

/** Kerb return radius for a junction, from its side road's class (the second-highest leg). */
export function filletRadius(ranks: number[]): number {
  const side = ranks.slice().sort((a, b) => b - a)[1] ?? ranks[0] ?? 2;
  return side >= 3 ? 6 : side === 2 ? 5 : 2.5;
}

/** A buffered polyline with a flat end at distance `s1` along it. */
function legSdf(line: P2[], hw: number, s1: number): (p: P2) => number {
  const cum = lengths(line);
  const part = slice(line, 0, s1, cum);
  const end = along(line, s1, cum);
  return (p) => Math.max(lineDist(p, part) - hw, dot(sub(p, end.p), end.d));
}

/** Signed distance to a simple polygon (negative inside). */
function polygonSdf(poly: P2[]): (p: P2) => number {
  return (p) => {
    let d = Infinity, inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      const ab = sub(b, a), ap = sub(p, a);
      const f = Math.max(0, Math.min(1, dot(ap, ab) / (dot(ab, ab) || 1e-12)));
      d = Math.min(d, dist(p, add(a, mul(ab, f))));
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + ((p[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) inside = !inside;
    }
    return inside ? -d : d;
  };
}

const unionAll = (fs: ((p: P2) => number)[], k: number) => (p: P2) => {
  let v = Infinity;
  for (const f of fs) {
    const b = f(p);
    if (v === Infinity) v = b;
    else {
      const h = Math.max(k - Math.abs(v - b), 0) / k;
      v = Math.min(v, b) - h * h * k * 0.25;
    }
  }
  return v;
};

export interface ShapeOptions {
  /** Half widths per edge id (traced), else the edge's own width. */
  halfWidth?: (edge: number) => number;
  /** Trim walk step, metres. */
  step?: number;
}

/** The shape of one junction or roundabout node. */
export function junctionShape(g: Graph, node: NetNode, o: ShapeOptions = {}): JunctionShape {
  const step = o.step ?? 0.25;
  const hwOf = (e: number) => o.halfWidth?.(e) ?? g.edges[e].width / 2;
  const legs: Leg[] = node.legs.map((l) => {
    const line = legLine(g, l);
    return { edge: l.edge, start: l.start, line, hw: hwOf(l.edge), rank: g.edges[l.edge].rank, trim: 0, cap: { c: line[0], d: [1, 0], left: [0, 1] } };
  });
  const k = 1.17 * filletRadius(legs.map((l) => l.rank));
  const rb = node.roundabout;
  const ring = rb ? { c: rb.c, rIn: Math.max(1.5, rb.r - rb.w / 2), rOut: rb.r + rb.w / 2 } : undefined;
  // Fixed parts: the circulating disc and the splitter legs (road), the island and splitter islands (holes).
  const fixed: ((p: P2) => number)[] = [];
  const holes: ((p: P2) => number)[] = [];
  // Inner edges (splitter legs, links between merged nodes) are road all along.
  for (const id of node.inner ?? []) {
    const e = g.edges[id];
    fixed.push(legSdf(e.pts, hwOf(id), lengths(e.pts)[e.pts.length - 1]));
  }
  if (rb && ring) {
    fixed.push((p) => dist(p, ring.c) - ring.rOut);
    holes.push((p) => ring.rIn - dist(p, ring.c));
    for (const sp of rb.splitters) {
      const [e1, e2] = sp.edges.map((id) => g.edges[id]);
      // The island: between the two one-way edges, inset by their half widths, kept outside the ring.
      const toV = (e: typeof e1) => (dist(e.pts[0], sp.at) < dist(e.pts[e.pts.length - 1], sp.at) ? e.pts : e.pts.slice().reverse());
      const poly = [...toV(e1), ...toV(e2).slice().reverse()];
      const inset = Math.max(e1.width, e2.width) / 2 + 0.3;
      const island = polygonSdf(poly);
      holes.push((p) => -Math.max(island(p) + inset, ring.rOut + 0.5 - dist(p, ring.c)));
    }
  }
  // Trims: walk each leg out until its cap is clear of everything else by the blend distance.
  const maxOf = (l: Leg) => {
    const e = g.edges[l.edge];
    const len = lengths(l.line)[l.line.length - 1];
    const otherEnd = l.start ? e.b : e.a;
    const shared = g.nodes[otherEnd].kind === "junction" || g.nodes[otherEnd].kind === "roundabout";
    return Math.max(0.5, shared ? len * 0.45 : len - 1);
  };
  // Paired legs: the two one-way carriageways of one approach (a dual carriageway, or a splitter
  // whose ends are too far out to be a splitter in the graph). They're trimmed together, and the
  // median between them is a hole.
  const sibling = legs.map(() => -1);
  const inbound = (l: Leg) => {
    const ow = g.edges[l.edge].oneway;
    return ow ? (l.start ? ow === -1 : ow === 1) : undefined;
  };
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) {
    const a = legs[i], b = legs[j];
    const ia = inbound(a), ib = inbound(b);
    if (ia === undefined || ib === undefined || ia === ib || sibling[i] >= 0 || sibling[j] >= 0) continue;
    const la = lengths(a.line), lb = lengths(b.line);
    const s = Math.min(15, la[la.length - 1], lb[lb.length - 1]);
    const pa = along(a.line, s, la), pb = along(b.line, s, lb);
    if (dot(pa.d, pb.d) < Math.cos((35 * Math.PI) / 180)) continue;
    if (dist(pa.p, pb.p) > a.hw + b.hw + 12) continue;
    sibling[i] = j;
    sibling[j] = i;
  }
  legs.forEach((l, i) => {
    const others = [
      ...fixed,
      ...legs.filter((_, j) => j !== i && j !== sibling[i]).map((m) => legSdf(m.line, m.hw, Math.min(maxOf(m), 60))),
    ];
    const cum = lengths(l.line);
    const limit = Math.min(maxOf(l), 60);
    let s = 0;
    for (; s < limit; s += step) {
      const a = along(l.line, s, cum);
      const left = leftOf(a.d);
      let clear = true;
      for (const t of [-1, -0.5, 0, 0.5, 1]) {
        const p = add(a.p, mul(left, t * l.hw));
        if (others.some((f) => f(p) < k + 0.5)) { clear = false; break; }
      }
      if (clear) break;
    }
    if (s >= limit) l.crowded = true;
    l.trim = Math.min(s, limit);
  });
  // Paired legs share a cap distance: the larger of the two that cleared, else the smaller.
  const shared = legs.map((l, i) => {
    const sib = legs[sibling[i]];
    if (!sib) return l.trim;
    const ok = [l, sib].filter((m) => !m.crowded);
    return Math.min(maxOf(l), ok.length ? Math.max(...ok.map((m) => m.trim)) : Math.min(l.trim, sib.trim));
  });
  legs.forEach((l, i) => {
    l.trim = shared[i];
    const a = along(l.line, l.trim, lengths(l.line));
    l.cap = { c: a.p, d: a.d, left: leftOf(a.d) };
  });
  // Medians between paired legs, carried a little past the caps so the union can't pave across.
  legs.forEach((l, i) => {
    const j = sibling[i];
    if (j < i) return;
    const m = legs[j];
    const poly = [...slice(l.line, 0, l.trim + 5), ...slice(m.line, 0, m.trim + 5).reverse()];
    const inset = Math.max(l.hw, m.hw) + 0.3;
    const median = polygonSdf(poly);
    holes.push((p) => -Math.max(median(p) + inset, ring ? ring.rOut + 0.5 - dist(p, ring.c) : -Infinity));
  });
  const parts = [...fixed, ...legs.map((l) => legSdf(l.line, l.hw, l.trim))];
  const road = unionAll(parts, k);
  const sdf = (p: P2) => {
    let v = road(p);
    for (const h of holes) v = Math.max(v, h(p));
    return v;
  };
  // Box: every leg's cap corners and the node area.
  const xs: number[] = [], ys: number[] = [];
  const addPt = (p: P2) => { xs.push(p[0]); ys.push(p[1]); };
  for (const l of legs) {
    for (const p of slice(l.line, 0, Math.max(l.trim, 0.01))) {
      addPt(add(p, [l.hw + k, l.hw + k]));
      addPt(sub(p, [l.hw + k, l.hw + k]));
    }
  }
  if (ring) { addPt(add(ring.c, [ring.rOut + k, ring.rOut + k])); addPt(sub(ring.c, [ring.rOut + k, ring.rOut + k])); }
  for (const id of node.inner ?? []) for (const p of g.edges[id].pts) { addPt(add(p, [k + 4, k + 4])); addPt(sub(p, [k + 4, k + 4])); }
  const box: [number, number, number, number] = [Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1];
  return { node: node.id, kind: rb ? "roundabout" : "junction", legs, k, sdf, box, ...(ring ? { ring } : {}) };
}

/** Rank order helper for callers: legs sorted highest class first. */
export const byRank = (legs: Leg[]) => legs.slice().sort((a, b) => b.rank - a.rank);
export { classRank };
