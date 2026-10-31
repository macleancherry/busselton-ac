// Phase 1 of the network core (docs/specs/road-network.md): the graph's junctions laid onto the
// ribbons the build already makes (the route's and the side streets'). Each junction leg is matched
// to the ribbon that carries it, trimmed by the spec's walk, and capped on a cross-section of that
// ribbon (a route sample row, or a point inserted into the street), so the junction surface and the
// ribbon share one straight edge with the same vertices.

import { classRank, legLine, type Graph, type NetNode } from "./graph";
import { filletRadius } from "./junction";
import { add, along, dist, dot, leftOf, lengths, lineDist, mul, slice, sub, unit, type P2 } from "./geom";

export interface RouteSampleIn {
  pos: P2;
  tan: P2;
  left: P2;
  s: number;
  width: number;
  h: number;
  bank: number;
  /** Set where the crown eases out towards a junction's cap (road.ts surfaceHeight reads it). */
  crown?: number;
}

export interface RouteRibbon {
  samples: RouteSampleIn[];
  closed: boolean;
  length: number;
  crown: number;
  /** Nearest point on the route: segment start index and fraction (as road.ts SegmentIndex). */
  nearest: (x: number, y: number, max: number) => { seg: number; frac: number; dist: number } | null;
}

export interface StreetRibbon {
  pts: P2[];
  width: number;
  widths?: number[];
  joins: number[];
  cls: string;
  oneway?: 1 | -1;
  /** Phase 2: the graph edge the street is built from (streets.ts); legs then match by edge. */
  edge?: number;
  /** A divided road's median width. */
  median?: number;
}

export interface RingIn {
  c: P2;
  r: number;
  w: number;
}

export interface Cap {
  /** Centre, outward direction, and the left of the outward direction. */
  c: P2;
  d: P2;
  left: P2;
  hw: number;
  /** The ribbon's vertices on the cap, right to left (seen looking outward). */
  verts: P2[];
}

export interface RLeg {
  edge: number;
  rank: number;
  kind: "route" | "street";
  /** Street index, or -1 on the route. */
  street: number;
  /** Outward along the ribbon: +1 = increasing sample index / arc length. */
  dir: 1 | -1;
  /** Ribbon position nearest the node: route arc length, or street arc length. */
  nodeAt: number;
  /** Centreline from the junction outward (ribbon geometry). */
  line: P2[];
  hw: number;
  trim: number;
  crowded?: boolean;
  /** Cap position on the ribbon: route row index, or street arc length. */
  at: number;
  cap: Cap;
  /** One-way into the junction (true), out of it (false), or two-way. */
  inbound?: boolean;
  /** One carriageway of a divided road: the edge both carriageways' legs come from. */
  pair?: number;
}

export interface RJunction {
  /** Graph node id. */
  node: number;
  kind: "junction" | "roundabout";
  legs: RLeg[];
  /** Index into the build's roundabouts. */
  ring?: { k: number; c: P2; rIn: number; rOut: number };
  /** Blend distance of the smooth union. */
  k: number;
  sdf: (p: P2) => number;
  box: [number, number, number, number];
  /** Junction centre (on the route for a route junction). */
  centre: P2;
  onRoute: boolean;
  /** Route row spans covered, [entry cap row, exit cap row] in route order (may wrap on a loop). */
  spans: [number, number][];
}

export interface Failure {
  node: number;
  at: P2;
  reason: string;
}

const STEP = 0.25;

/** Distance-based leg shape with a flat end through `cap.c` facing `cap.d`. */
function cappedLeg(line: P2[], hw: number, trim: number, cap?: { c: P2; d: P2 }): (p: P2) => number {
  const cum = lengths(line);
  const part = slice(line, 0, Math.max(0.01, trim), cum);
  const a = along(line, trim, cum);
  const c = cap?.c ?? a.p, d = cap?.d ?? a.d;
  // Far from the part, its box distance is a lower bound that's already well clear of any blend.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of part) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
  return (p) => {
    const bx = Math.max(x0 - p[0], 0, p[0] - x1), by = Math.max(y0 - p[1], 0, p[1] - y1);
    const far = Math.hypot(bx, by) - hw;
    if (far > 20) return far;
    return Math.max(lineDist(p, part) - hw, dot(sub(p, c), d));
  };
}

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

/** Grid of street segments for nearest-street queries. */
class StreetGrid {
  private cells = new Map<string, [number, number][]>();
  constructor(private streets: StreetRibbon[], private cell = 20) {
    streets.forEach((st, si) => {
      for (let k = 1; k < st.pts.length; k++) {
        const a = st.pts[k - 1], b = st.pts[k];
        for (let x = Math.floor(Math.min(a[0], b[0]) / cell); x <= Math.floor(Math.max(a[0], b[0]) / cell); x++)
          for (let y = Math.floor(Math.min(a[1], b[1]) / cell); y <= Math.floor(Math.max(a[1], b[1]) / cell); y++) {
            const key = `${x},${y}`;
            if (!this.cells.has(key)) this.cells.set(key, []);
            this.cells.get(key)!.push([si, k - 1]);
          }
      }
    });
  }
  /** Nearest street segment to p within `max`, aligned with `dir` (|cos| >= minCos). */
  nearest(p: P2, max: number, dir: P2, minCos: number): { street: number; seg: number; f: number; d: number; sd: P2 } | null {
    const cx = Math.floor(p[0] / this.cell), cy = Math.floor(p[1] / this.cell);
    let best: { street: number; seg: number; f: number; d: number; sd: P2 } | null = null;
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      for (const [si, k] of this.cells.get(`${x},${y}`) ?? []) {
        const a = this.streets[si].pts[k], b = this.streets[si].pts[k + 1];
        const ab = sub(b, a), L2 = dot(ab, ab);
        if (L2 < 1e-8) continue;
        const f = Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2));
        const d = dist(p, add(a, mul(ab, f)));
        const sd = unit(ab);
        if (d > max || Math.abs(dot(sd, dir)) < minCos) continue;
        if (!best || d < best.d) best = { street: si, seg: k, f, d, sd };
      }
    }
    return best;
  }
}

export const streetLengths = (st: StreetRibbon) => lengths(st.pts);
export const streetWidthAt = (st: StreetRibbon, cum: number[], s: number): number => {
  if (!st.widths) return st.width;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const f = Math.max(0, Math.min(1, (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)));
  return st.widths[i - 1] + (st.widths[i] - st.widths[i - 1]) * f;
};

export interface MatchOptions {
  /** Only junctions where this holds at the node. */
  inArea?: (p: P2) => boolean;
  /** Ribbons that may not take part (gravel, say): the junction is left to the old core. */
  routeRowOk?: (i: number) => boolean;
  streetOk?: (si: number) => boolean;
}

/**
 * The graph's junctions and roundabouts laid onto the ribbons. Junctions that can't be (a leg with no
 * ribbon, a crowded leg) are reported as failures and left to the old core.
 */
export function matchJunctions(g: Graph, route: RouteRibbon | null, streets: StreetRibbon[], rings: RingIn[], o: MatchOptions = {}): { junctions: RJunction[]; failures: Failure[] } {
  const grid = new StreetGrid(streets);
  // Phase 2 streets know their graph edge: a leg's street is one built from that edge, the piece nearest.
  const byEdge = new Map<number, number[]>();
  streets.forEach((st, si) => { if (st.edge !== undefined) { if (!byEdge.has(st.edge)) byEdge.set(st.edge, []); byEdge.get(st.edge)!.push(si); } });
  const graphStreets = byEdge.size > 0;
  const medOff = (e: { median?: number; width: number }) => (e.median !== undefined ? e.median / 2 + (e.width - e.median) / 4 : 0);
  const streetOfEdge = (edge: number, p: P2, max: number, halfOnly = false): { street: number; seg: number; f: number; d: number; sd: P2; p: P2 } | null => {
    let best: { street: number; seg: number; f: number; d: number; sd: P2; p: P2 } | null = null;
    for (const si of byEdge.get(edge) ?? []) {
      if (halfOnly && !(streets[si] as StreetRibbon & { half?: number }).half) continue;
      const pts = streets[si].pts;
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k];
        const ab = sub(b, a), L2 = dot(ab, ab);
        if (L2 < 1e-8) continue;
        const f = Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2));
        const foot = add(a, mul(ab, f));
        const d = dist(p, foot);
        if (d <= max && (!best || d < best.d)) best = { street: si, seg: k - 1, f, d, sd: unit(ab), p: foot };
      }
    }
    return best;
  };
  const S = route?.samples ?? [];
  const n = S.length;
  const total = route ? (route.closed ? route.length : S[n - 1].s) : 0;
  const routeArc = (seg: number, frac: number) => S[seg].s + frac * ((seg + 1 < n ? S[seg + 1].s : total) - S[seg].s);
  const routePoint = (seg: number, frac: number): P2 => {
    const a = S[seg].pos, b = S[(seg + 1) % n].pos;
    return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
  };
  const junctions: RJunction[] = [];
  const failures: Failure[] = [];
  const usedRing = new Set<number>();
  for (const node of g.nodes) {
    if (node.kind !== "junction" && node.kind !== "roundabout") continue;
    if (o.inArea && !o.inArea(node.p)) continue;
    const fail = (reason: string) => failures.push({ node: node.id, at: node.p, reason });
    try {
      const j = matchOne(node);
      if (typeof j === "string") fail(j);
      else junctions.push(j);
    } catch (err) {
      fail(String((err as Error)?.message ?? err));
    }
  }
  return { junctions, failures };

  function matchOne(node: NetNode): RJunction | string {
    let ring: RJunction["ring"];
    if (node.kind === "roundabout") {
      const rb = node.roundabout!;
      let k = -1, bd = Infinity;
      rings.forEach((r, i) => { const d = dist(r.c, rb.c); if (d < bd) { bd = d; k = i; } });
      if (k < 0 || bd > Math.max(4, 0.3 * rings[k].r) || usedRing.has(k)) return "roundabout not in the build";
      const r = rings[k];
      ring = { k, c: r.c, rIn: Math.max(1.5, r.r - r.w / 2), rOut: r.r + r.w / 2 };
    }
    // On the route? A junction: the route passes within its half width of the node; a roundabout: through the ring.
    let onRoute = false;
    // How far from the centre a street leg's ribbon may stop (the old side streets stop at the route's edge).
    let leg0Reach = 8;
    let centre: P2 = ring ? ring.c : node.p;
    if (route) {
      if (ring) onRoute = S.some((s) => dist(s.pos, ring!.c) < ring!.rOut + 0.5);
      else {
        const extra = Math.max(0, ...node.legs.map((l) => medOff(g.edges[l.edge])));
        const nr = route.nearest(node.p[0], node.p[1], 12 + extra);
        if (nr && nr.dist < S[nr.seg].width / 2 + 2 + extra) {
          onRoute = true;
          // A node on a median stays in the middle of the road (the junction spans both carriageways).
          centre = extra > 0 ? node.p : routePoint(nr.seg, nr.frac);
          leg0Reach = S[nr.seg].width / 2 + 3 + 2 * extra;
        }
      }
    }
    const legs: RLeg[] = [];
    for (const l of node.legs) {
      const e = g.edges[l.edge];
      const osm = legLine(g, l);
      const cum = lengths(osm);
      const len = cum[cum.length - 1];
      // Sample the leg a little way out (past the ring on a roundabout).
      let s0 = 0;
      if (ring) while (s0 < len && dist(along(osm, s0, cum).p, ring.c) < ring.rOut + 2) s0 += 0.5;
      const sq = Math.min(len * (ring ? 0.8 : 0.45), s0 + (ring ? 4 : Math.min(10, Math.max(3, len * 0.45))));
      const q = along(osm, sq, cum);
      const otherEnd = l.start ? e.b : e.a;
      const otherJ = g.nodes[otherEnd].kind === "junction" || g.nodes[otherEnd].kind === "roundabout";
      const edgeLimit = Math.max(0.5, otherJ ? len * 0.45 : len - 1);
      // A divided road (one edge with a median, phase 2): each carriageway is a leg of its own, on the
      // route where the route runs along it, else on the carriageway's street.
      if (e.median !== undefined && graphStreets) {
        const cw = (e.width - e.median) / 2, off = e.median / 2 + cw / 2;
        const lf = leftOf(q.d);
        const onSide = ([1, -1] as const).map((side) => {
          const qs = add(q.p, mul(lf, side * off));
          if (!route) return null;
          const nr = route.nearest(qs[0], qs[1], cw / 2 + 2);
          if (!nr || Math.abs(dot(q.d, S[nr.seg].tan)) <= 0.8) return null;
          const leg = routeLeg(l.edge, e.rank, dot(q.d, S[nr.seg].tan) > 0 ? 1 : -1, routeArc(nr.seg, nr.frac), edgeLimit, add(osm[0], mul(lf, side * off)));
          if (typeof leg !== "string") leg.inbound = side !== 1;
          return leg;
        });
        // No route on either carriageway: one street with its median, an ordinary leg (below).
        if (onSide.some((x) => x)) {
          for (const [k, side] of ([1, -1] as const).entries()) {
            let leg: RLeg | string | null = onSide[k];
            if (!leg) {
              // The other carriageway: its own one-way street (streets.ts makes it where the route takes one side).
              const qs = add(q.p, mul(lf, side * off));
              const ns = streetOfEdge(l.edge, qs, cw / 2 + 2, true);
              if (ns) {
                leg = streetLeg(l.edge, e.rank, ns.street, dot(q.d, ns.sd) > 0 ? 1 : -1, ns.seg, ns.f, edgeLimit, osm[0]);
                if (typeof leg !== "string" && leg) {
                  const st = streets[ns.street];
                  if (st.oneway) leg.inbound = st.oneway === -leg.dir;
                }
              }
            }
            if (!leg || leg === "unreached") continue;
            if (typeof leg === "string") return leg;
            leg.pair = l.edge;
            legs.push(leg);
          }
          onRoute = true;
          continue;
        }
      }
      let leg: RLeg | string | null = null;
      if (onRoute && route) {
        const nr = route.nearest(q.p[0], q.p[1], 8);
        if (nr && nr.dist < S[nr.seg].width / 2 + 1.5 && Math.abs(dot(q.d, S[nr.seg].tan)) > 0.8) {
          leg = routeLeg(l.edge, e.rank, dot(q.d, S[nr.seg].tan) > 0 ? 1 : -1, routeArc(nr.seg, nr.frac), edgeLimit);
        }
      }
      if (!leg) {
        const ns = graphStreets ? streetOfEdge(l.edge, q.p, 6) : grid.nearest(q.p, 4, q.d, 0.75);
        if (ns) leg = streetLeg(l.edge, e.rank, ns.street, dot(q.d, ns.sd) > 0 ? 1 : -1, ns.seg, ns.f, edgeLimit, osm[0]);
      }
      // No ribbon reaches the junction along this leg (a bridge, a stub the build left out, a road
      // whose ribbon stops short): it isn't connected here in the built track either, so it's left
      // out. If a ribbon does run into the junction after all, the overlap check refuses the junction.
      if (!leg || leg === "unreached") continue;
      if (typeof leg === "string") return leg;
      const ow = e.oneway;
      if (ow) leg.inbound = l.start ? ow === -1 : ow === 1;
      legs.push(leg);
    }
    if (legs.length < (ring ? 1 : 3)) return "too few legs";
    for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i], b = legs[j];
      if (a.kind === b.kind && a.street === b.street && a.dir === b.dir && Math.abs(a.nodeAt - b.nodeAt) < 30) return `two legs on one ribbon end (street ${a.street}, edges ${a.edge} and ${b.edge})`;
    }
    const routeLegs = legs.filter((l) => l.kind === "route");
    if (onRoute && routeLegs.length < 2) return "route passes but has fewer than two legs";
    if (!onRoute && routeLegs.length) return "route leg off the route";
    // Fixed parts: the ring and the edges inside the junction.
    const k = 1.17 * filletRadius(legs.map((l) => l.rank));
    const fixed: ((p: P2) => number)[] = [];
    const holes: ((p: P2) => number)[] = [];
    // Edges inside the junction (links between merged nodes, splitter legs) are road all along, if the
    // build has a ribbon on them (one it left out isn't paved by the junction either).
    const splitterEdges = new Set((node.roundabout?.splitters ?? []).flatMap((sp) => sp.edges));
    const inner = (node.inner ?? []).filter((id) => {
      if (splitterEdges.has(id)) return true;
      const e = g.edges[id];
      const ec = lengths(e.pts);
      const mid = along(e.pts, ec[ec.length - 1] / 2, ec);
      if (route && onRoute) {
        const nr = route.nearest(mid.p[0], mid.p[1], 6);
        if (nr && nr.dist < S[nr.seg].width / 2 + 1) return true;
      }
      return graphStreets ? !!streetOfEdge(id, mid.p, 6) : !!grid.nearest(mid.p, 4, mid.d, 0.7);
    });
    for (const id of inner) {
      const e = g.edges[id];
      fixed.push(cappedLeg(e.pts, e.width / 2, lengths(e.pts)[e.pts.length - 1]));
    }
    if (ring) {
      fixed.push((p) => dist(p, ring!.c) - ring!.rOut);
      holes.push((p) => ring!.rIn - dist(p, ring!.c));
      for (const sp of node.roundabout!.splitters) {
        const [e1, e2] = sp.edges.map((id) => g.edges[id]);
        const toV = (e: typeof e1) => (dist(e.pts[0], sp.at) < dist(e.pts[e.pts.length - 1], sp.at) ? e.pts : e.pts.slice().reverse());
        const poly = [...toV(e1), ...toV(e2).slice().reverse()];
        const inset = Math.max(e1.width, e2.width) / 2 + 0.3;
        const island = polygonSdf(poly);
        holes.push((p) => -Math.max(island(p) + inset, ring!.rOut + 0.5 - dist(p, ring!.c)));
      }
    }
    // Trims: the spec's walk, then onto the ribbon (the next route row out; a street point).
    const limits = legs.map((l) => l.trim);
    const reach = legs.map((m, j) => cappedLeg(m.line, m.hw, Math.max(0.5, limits[j])));
    for (const [i, l] of legs.entries()) {
      // The other carriageway of a divided road runs beside this one all the way: not a neighbour.
      const others = [...fixed, ...reach.filter((_, j) => j !== i && (l.pair === undefined || legs[j].pair !== l.pair))];
      const cum = lengths(l.line);
      let s = 0;
      for (; s < l.trim; s += STEP) {
        const a = along(l.line, s, cum);
        const left = leftOf(a.d);
        let clear = true;
        for (const t of [-1, -0.5, 0, 0.5, 1]) {
          const p = add(a.p, mul(left, t * l.hw));
          if (others.some((f) => f(p) < k + 0.5)) { clear = false; break; }
        }
        if (clear) break;
      }
      // Crowded (the next junction is close): the cap goes at the limit, and the outline and the
      // neighbour checks decide whether the junction holds together.
      if (s >= l.trim) { l.crowded = true; s = l.trim; }
      l.trim = s;
    }
    for (const l of legs) {
      const ok = l.kind === "route" ? capRoute(l) : capStreet(l);
      if (!ok) return `leg ${l.edge} has no room for its cap`;
    }
    if (o.routeRowOk && legs.some((l) => l.kind === "route" && !o.routeRowOk!(l.at))) return "route leg not sealed";
    if (o.streetOk && legs.some((l) => l.kind === "street" && !o.streetOk!(l.street))) return "street leg not sealed";
    // Route spans: entry caps (outward against the route) to the next exit cap.
    const spans: [number, number][] = [];
    if (onRoute) {
      const caps = routeLegs.map((l) => ({ row: l.at, dir: l.dir, s: S[l.at].s })).sort((a, b) => a.s - b.s);
      const entries = caps.filter((c) => c.dir === -1), exits = caps.filter((c) => c.dir === 1);
      if (entries.length !== exits.length) return "route enters and leaves a different number of times";
      for (const en of entries) {
        // The next exit after this entry along the route (wrapping on a loop).
        let best: (typeof exits)[number] | undefined, bd = Infinity;
        for (const ex of exits) {
          let ds = ex.s - en.s;
          if (ds < 0 && route!.closed) ds += total;
          if (ds > 0 && ds < bd) { bd = ds; best = ex; }
        }
        if (!best || bd > 200) return "route span not closed";
        spans.push([en.row, best.row]);
      }
    }
    const parts = [...fixed, ...legs.map((l) => cappedLeg(l.line, l.hw, l.trim, l.cap))];
    const road = unionAll(parts, k);
    const sdf = (p: P2) => {
      let v = road(p);
      for (const h of holes) v = Math.max(v, h(p));
      return v;
    };
    const xs: number[] = [], ys: number[] = [];
    const addPt = (p: P2, r: number) => { xs.push(p[0] - r, p[0] + r); ys.push(p[1] - r, p[1] + r); };
    for (const l of legs) for (const p of slice(l.line, 0, Math.max(l.trim, 0.01))) addPt(p, l.hw + k);
    if (ring) addPt(ring.c, ring.rOut + k);
    for (const id of inner) for (const p of g.edges[id].pts) addPt(p, k + 4);
    const box: [number, number, number, number] = [Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1];
    if (ring) usedRing.add(ring.k);
    return { node: node.id, kind: ring ? "roundabout" : "junction", legs, ...(ring ? { ring } : {}), k, sdf, box, centre, onRoute, spans };

    // A route leg: rows outward from the node (or from where the route leaves the ring).
    function routeLeg(edge: number, rank: number, dir: 1 | -1, arcQ: number, edgeLimit: number, target?: P2): RLeg | string {
      // Walk back from q towards the junction to find where the leg starts.
      const rowAt = (arc: number) => {
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s <= arc) lo = m; else hi = m; }
        return lo;
      };
      const wrap = (arc: number) => (route!.closed ? ((arc % total) + total) % total : Math.max(0, Math.min(total, arc)));
      const pointAt = (arc: number): P2 => {
        const a = wrap(arc), i = rowAt(a);
        const sNext = i + 1 < n ? S[i + 1].s : total;
        return routePoint(i, Math.max(0, Math.min(1, (a - S[i].s) / (sNext - S[i].s || 1))));
      };
      let nodeArc: number;
      if (ring) {
        nodeArc = arcQ;
        for (let t = 0; t < 60; t += 0.25) {
          const p = pointAt(arcQ - dir * t);
          nodeArc = arcQ - dir * t;
          if (dist(p, ring.c) <= ring.rOut) break;
        }
      } else if (target) {
        // One carriageway of a divided road: back along it from q to where it's nearest the node's point on it.
        nodeArc = arcQ;
        let bd = Infinity;
        for (let t = 0; t < 60; t += 0.25) {
          const d = dist(pointAt(arcQ - dir * t), target);
          if (d < bd) { bd = d; nodeArc = arcQ - dir * t; } else if (d > bd + 3) break;
        }
      } else {
        const nr = route!.nearest(node.p[0], node.p[1], 30)!;
        nodeArc = routeArc(nr.seg, nr.frac);
      }
      const start = pointAt(nodeArc);
      const line: P2[] = [ring ? start : centre];
      if (!ring && dist(start, centre) > 0.05) line.push(start);
      // Rows outward, up to 70 m.
      const rows: number[] = [];
      let i0 = rowAt(wrap(nodeArc));
      if (dir === 1) i0 = (i0 + 1) % n;
      for (let m = 0, i = i0; m < 40; m++) {
        if (!route!.closed && (i < 0 || i >= n)) break;
        const d = Math.abs(S[i].s - nodeArc);
        const dd = route!.closed ? Math.min(d, total - d) : d;
        if (dd > 70) break;
        rows.push(i);
        line.push(S[i].pos);
        i = route!.closed ? (i + dir + n) % n : i + dir;
      }
      if (rows.length < 3) return `route leg ${edge} runs off the route`;
      const cum = lengths(line);
      const avail = cum[cum.length - 1];
      const leg: RLeg = {
        edge, rank, kind: "route", street: -1, dir, nodeAt: nodeArc, line, hw: S[rows[0]].width / 2,
        trim: Math.min(60, edgeLimit, avail - 6), at: -1, cap: undefined as unknown as Cap,
      };
      (leg as RLeg & { rows: number[] }).rows = rows;
      return leg;
    }

    function streetLeg(edge: number, rank: number, si: number, dir: 1 | -1, seg: number, f: number, edgeLimit: number, from: P2): RLeg | string {
      const st = streets[si];
      const cum = lengths(st.pts);
      const sl = cum[cum.length - 1];
      const sq = cum[seg] + f * (cum[seg + 1] - cum[seg]);
      // Towards the junction: the street's nearest approach to where the leg starts in the graph (the
      // node; a ring vertex; a merged member node), or the street's end, or the ring's edge.
      const onMain = dist(from, node.p) < 1 && !ring;
      const target = onMain ? centre : from;
      let nodeAt = sq, best = Infinity;
      for (let t = 0; t <= 45; t += 0.5) {
        const s = sq - dir * t;
        if (s < 0 || s > sl) { if (dist(along(st.pts, Math.max(0, Math.min(sl, s)), cum).p, target) < best) nodeAt = Math.max(0, Math.min(sl, s)); break; }
        const p = along(st.pts, s, cum).p;
        if (ring && dist(p, ring.c) <= ring.rOut) { nodeAt = s; best = 0; break; }
        const d = dist(p, target);
        if (d < best) { best = d; nodeAt = s; } else if (d > best + 3) break;
      }
      const start = along(st.pts, nodeAt, cum).p;
      const reach = ring && dist(target, ring.c) < ring.rOut + 1 ? dist(start, ring.c) - ring.rOut : dist(start, target) - (onMain ? Math.max(8, leg0Reach) : 8);
      if (reach > (ring ? 3 : 0)) return "unreached";
      const out = dir === 1 ? slice(st.pts, nodeAt, Math.min(sl, nodeAt + 70), cum) : slice(st.pts, Math.max(0, nodeAt - 70), nodeAt, cum).reverse();
      // From the junction's own point (the route under the node, a member node) unless the ring covers it.
      const inRing = ring && dist(start, ring.c) <= ring.rOut + 0.5;
      const line: P2[] = inRing || dist(start, target) <= 0.05 ? out : [target, ...out];
      const lc = lengths(line);
      const avail = lc[lc.length - 1];
      const leg: RLeg = {
        edge, rank, kind: "street", street: si, dir, nodeAt, line, hw: streetWidthAt(st, cum, sq) / 2,
        trim: Math.min(60, edgeLimit, avail - 3), at: -1, cap: undefined as unknown as Cap,
      };
      if (leg.trim <= 0.5) return `street leg ${edge} too short`;
      return leg;
    }
  }

  function capRoute(l: RLeg): boolean {
    const rows = (l as RLeg & { rows: number[] }).rows;
    const cum = lengths(l.line);
    // Rows start at line index 1 or 2 (after the centre and the route point under it).
    const off = l.line.length - rows.length;
    let k = rows.findIndex((_, m) => cum[m + off] >= l.trim - 1e-6);
    if (k < 0 || k > rows.length - 3) return false;
    const i = rows[k];
    const s = S[i];
    const d: P2 = mul(s.tan, l.dir);
    const left: P2 = mul(s.left, l.dir);
    const hw = s.width / 2;
    // The ribbon's row: lanes at 0.5, 0.25, 0, -0.25, -0.5 of the width along the sample's left.
    const verts = [-0.5, -0.25, 0, 0.25, 0.5].map((f) => add(s.pos, mul(left, f * s.width)));
    l.at = i;
    l.trim = cum[k + off];
    l.hw = hw;
    l.cap = { c: s.pos, d, left, hw, verts };
    return true;
  }

  function capStreet(l: RLeg): boolean {
    const st = streets[l.street];
    const cum = lengths(st.pts);
    const sl = cum[cum.length - 1];
    const d0 = dist(l.line[0], along(st.pts, l.nodeAt, cum).p);
    const sc = l.nodeAt + l.dir * Math.max(0.5, l.trim - d0);
    if (sc <= 0.05 || sc >= sl - 0.05) return false;
    // The row direction buildSideStreets will use there: the segment's (an inserted point), or the
    // central difference at an existing point.
    let i = 1;
    while (i < st.pts.length - 1 && cum[i] < sc) i++;
    let dirv: P2;
    if (Math.abs(cum[i] - sc) < 1e-3 && i < st.pts.length - 1) dirv = unit(sub(st.pts[i + 1], st.pts[i - 1]));
    else if (Math.abs(cum[i - 1] - sc) < 1e-3 && i - 1 > 0) dirv = unit(sub(st.pts[i], st.pts[i - 2]));
    else dirv = unit(sub(st.pts[i], st.pts[i - 1]));
    const c = along(st.pts, sc, cum).p;
    const d = mul(dirv, l.dir);
    const left = leftOf(d);
    const hw = streetWidthAt(st, cum, sc) / 2;
    l.at = sc;
    l.hw = hw;
    l.cap = { c, d, left, hw, verts: [add(c, mul(left, -hw)), add(c, mul(left, hw))] };
    // Re-measure the trim along the leg line to the cap.
    const lc = lengths(l.line);
    let best = 0, bd = Infinity;
    for (let s = Math.max(0, l.trim - 3); s <= Math.min(lc[lc.length - 1], l.trim + 3); s += 0.01) {
      const dd = dist(along(l.line, s, lc).p, c);
      if (dd < bd) { bd = dd; best = s; }
    }
    l.trim = best;
    return true;
  }
}

/**
 * Inserts the street caps as points of their streets (so buildSideStreets makes a row exactly
 * there) and shifts the streets' join indices to match. Returns per street the cap arc lengths.
 */
export function insertStreetCaps(streets: StreetRibbon[], junctions: RJunction[]): void {
  const byStreet = new Map<number, number[]>();
  for (const j of junctions) for (const l of j.legs) if (l.kind === "street") {
    if (!byStreet.has(l.street)) byStreet.set(l.street, []);
    byStreet.get(l.street)!.push(l.at);
  }
  for (const [si, arcs] of byStreet) {
    const st = streets[si];
    const cum = lengths(st.pts);
    const ins: { after: number; p: P2; w: number; s: number }[] = [];
    for (const sc of arcs) {
      let i = 1;
      while (i < st.pts.length - 1 && cum[i] < sc) i++;
      if (Math.abs(cum[i] - sc) < 1e-3 || Math.abs(cum[i - 1] - sc) < 1e-3) continue;
      ins.push({ after: i - 1, p: along(st.pts, sc, cum).p, w: streetWidthAt(st, cum, sc), s: sc });
    }
    if (!ins.length) continue;
    ins.sort((a, b) => a.s - b.s);
    const pts: P2[] = [], widths: number[] = [], map: number[] = [];
    let q = 0;
    st.pts.forEach((p, k) => {
      map.push(pts.length);
      pts.push(p);
      widths.push(st.widths?.[k] ?? st.width);
      while (q < ins.length && ins[q].after === k) {
        pts.push(ins[q].p);
        widths.push(ins[q].w);
        q++;
      }
    });
    st.pts = pts;
    if (st.widths) st.widths = widths;
    st.joins = st.joins.map((jn) => map[jn]);
  }
}

export { classRank };
