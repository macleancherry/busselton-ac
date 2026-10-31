// The road graph (docs/specs/road-network.md, "Building the graph"): ways in, edges between nodes
// out. Ways connect only where they share a coordinate exactly (an OSM node), never by distance.

import { dist, fitCircle, lengths, type P2 } from "./geom";

export interface NetWay {
  /** Centreline in local metres, as in OSM (shared nodes have identical coordinates). */
  pts: P2[];
  /** OSM highway=* (or a vector-tile class: minor, service, ...). */
  cls: string;
  /** 1 one-way along pts, -1 against. */
  oneway?: 1 | -1;
  /** junction=roundabout|circular. */
  roundabout?: boolean;
  /** Asphalt width, metres (tag or trace). */
  width?: number;
  lanes?: number;
  layer?: number;
  name?: string;
  /** A divided road (dual.ts): the median's width; `width` is kerb to kerb across both carriageways. */
  median?: number;
  /** OSM service=* and surface=*, carried to the edge (streets.ts). */
  service?: string;
  surface?: string;
}

export interface NetEdge {
  id: number;
  /** Node ids at the start and end of pts. */
  a: number;
  b: number;
  pts: P2[];
  cls: string;
  rank: number;
  width: number;
  oneway?: 1 | -1;
  lanes?: number;
  layer: number;
  name?: string;
  /** Internal to a roundabout (a splitter-island one-way leg): no ribbon of its own. */
  internal?: boolean;
  /** A divided road: the median's width (dual.ts). */
  median?: number;
  service?: string;
  surface?: string;
}

export interface Roundabout {
  c: P2;
  /** Centre-line radius of the circulating carriageway. */
  r: number;
  /** Carriageway width. */
  w: number;
  /** Splitter islands: the two one-way edges of an approach and the outer vertex they share. */
  splitters: { edges: [number, number]; at: P2 }[];
}

export interface NetNode {
  id: number;
  p: P2;
  kind: "junction" | "roundabout" | "end" | "mid";
  /** Edge ends here: the edge id and whether the edge starts (true) or ends here. */
  legs: { edge: number; start: boolean }[];
  roundabout?: Roundabout;
  /** Edges inside this junction (splitter legs, short links between merged junction nodes). */
  inner?: number[];
  /** Set on a node merged into another junction. */
  mergedInto?: number;
}

export interface Graph {
  nodes: NetNode[];
  edges: NetEdge[];
}

const RANK: Record<string, number> = {
  motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3,
  residential: 2, unclassified: 2, minor: 2, living_street: 2, road: 2, service: 1, track: 0,
};
export const classRank = (cls: string): number => RANK[cls.replace(/_link$/, "")] ?? 1;

const WIDTH: Record<number, number> = { 7: 11, 6: 9, 5: 7.5, 4: 7, 3: 6.5, 2: 6, 1: 4, 0: 3.5 };
export function defaultWidth(w: NetWay): number {
  if (w.width && w.width > 2 && w.width < (w.median !== undefined ? 60 : 30)) return w.width;
  if (w.lanes && w.lanes > 0) return Math.max(3.5, w.lanes * 3.4);
  if (w.oneway && !w.roundabout) return 4.5;
  return WIDTH[classRank(w.cls)] ?? 6;
}

const key = (p: P2) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;

interface RawEdge { way: number; pts: P2[]; ka: string; kb: string }

export interface GraphOptions {
  /** One-way legs this short or shorter that pair up at a roundabout become a splitter island. */
  splitterMax?: number;
  /** Junction nodes joined by an edge shorter than this merge into one junction, metres. */
  mergeMax?: number;
}

export function buildGraph(ways: NetWay[], o: GraphOptions = {}): Graph {
  const splitterMax = o.splitterMax ?? 45;
  // 1. Vertices: coordinates used twice or more, and way ends.
  const uses = new Map<string, number>();
  ways.forEach((w) => w.pts.forEach((p, i) => {
    const k = key(p);
    uses.set(k, (uses.get(k) ?? 0) + (i === 0 || i === w.pts.length - 1 ? 2 : 1));
  }));
  const isVertex = (k: string) => (uses.get(k) ?? 0) >= 2;
  // 2. Split ways at vertices.
  const raw: RawEdge[] = [];
  ways.forEach((w, wi) => {
    let cur: P2[] = [w.pts[0]];
    for (let i = 1; i < w.pts.length; i++) {
      const p = w.pts[i];
      if (dist(p, cur[cur.length - 1]) < 1e-4) continue;
      cur.push(p);
      if (i === w.pts.length - 1 || isVertex(key(p))) {
        if (cur.length >= 2) raw.push({ way: wi, pts: cur, ka: key(cur[0]), kb: key(p) });
        cur = [p];
      }
    }
  });
  // 3. Roundabout clusters: ring edges unioned through shared vertices.
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  const ringPts = new Map<string, P2[]>();
  for (const e of raw) {
    if (!ways[e.way].roundabout) continue;
    for (const k of [e.ka, e.kb]) if (!parent.has(k)) parent.set(k, k);
    const ra = find(e.ka), rb = find(e.kb);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (const e of raw) {
    if (!ways[e.way].roundabout) continue;
    const r = find(e.ka);
    if (!ringPts.has(r)) ringPts.set(r, []);
    ringPts.get(r)!.push(...e.pts);
  }
  const ringOf = (k: string): string | undefined => (parent.has(k) ? find(k) : undefined);
  // Rings that are circles become roundabout junctions; the rest stay ordinary roads.
  const circles = new Map<string, { c: P2; r: number; w: number }>();
  for (const [r, pts] of ringPts) {
    const fit = fitCircle(pts);
    const rw = raw.filter((e) => ways[e.way].roundabout && find(e.ka) === r).map((e) => ways[e.way]);
    if (!fit || fit.rms > 0.15 * fit.r || fit.r > 60) continue;
    const lanes = Math.max(0, ...rw.map((w) => w.lanes ?? 0));
    const tagged = Math.max(0, ...rw.map((w) => (w.width && w.width > 3 ? w.width : 0)));
    circles.set(r, { c: fit.c, r: fit.r, w: tagged || Math.max(7, lanes >= 2 ? lanes * 4.6 : 0) });
  }
  // 4. Degree of each vertex in the non-ring edges (a ring vertex counts as its roundabout).
  const nodeKey = (k: string): string => {
    const r = ringOf(k);
    return r !== undefined && circles.has(r) ? "R" + r : k;
  };
  const kept = raw.filter((e) => !(ways[e.way].roundabout && circles.has(ringOf(e.ka) ?? "")));
  const degree = new Map<string, number>();
  for (const e of kept) for (const k of [e.ka, e.kb]) degree.set(nodeKey(k), (degree.get(nodeKey(k)) ?? 0) + 1);
  // 5. Chain through degree-2 vertices (same layer and one-way state): one edge per road between junctions.
  const at = new Map<string, number[]>();
  kept.forEach((e, i) => {
    for (const k of [e.ka, e.kb]) {
      const nk = nodeKey(k);
      if (!at.has(nk)) at.set(nk, []);
      at.get(nk)!.push(i);
    }
  });
  const joinable = (nk: string): boolean => {
    if (nk.startsWith("R") || degree.get(nk) !== 2) return false;
    const [i, j] = at.get(nk)!;
    if (i === j) return false;
    const a = ways[kept[i].way], b = ways[kept[j].way];
    return (a.layer ?? 0) === (b.layer ?? 0) && !!a.oneway === !!b.oneway && (a.median === undefined) === (b.median === undefined) && a.service === b.service && a.surface === b.surface;
  };
  const used = new Set<number>();
  const graph: Graph = { nodes: [], edges: [] };
  const nodeIds = new Map<string, number>();
  const nodeFor = (nk: string, p: P2): number => {
    let id = nodeIds.get(nk);
    if (id === undefined) {
      id = graph.nodes.length;
      nodeIds.set(nk, id);
      const rk = nk.startsWith("R") ? nk.slice(1) : undefined;
      const circ = rk !== undefined ? circles.get(rk) : undefined;
      graph.nodes.push({
        id, p: circ ? circ.c : p, kind: circ ? "roundabout" : "end", legs: [],
        ...(circ ? { roundabout: { c: circ.c, r: circ.r, w: circ.w, splitters: [] } } : {}),
      });
    }
    return id;
  };
  const walk = (start: number, fromKey: string) => {
    // Follow edges from a real vertex through joinable ones.
    let pts: P2[] = [];
    let k = fromKey;
    let i = start;
    const parts: NetWay[] = [];
    let firstFwd: boolean | undefined;
    const startNk = nodeKey(fromKey);
    for (;;) {
      used.add(i);
      const e = kept[i];
      const fwd = e.ka === k;
      const seg = fwd ? e.pts : e.pts.slice().reverse();
      pts = pts.length ? pts.concat(seg.slice(1)) : seg.slice();
      parts.push(ways[e.way]);
      firstFwd ??= fwd;
      k = fwd ? e.kb : e.ka;
      const nk = nodeKey(k);
      if (!joinable(nk)) break;
      const next = at.get(nk)!.find((j) => j !== i && !used.has(j));
      if (next === undefined) break;
      i = next;
    }
    const w0 = parts[0];
    const rank = Math.max(...parts.map((w) => classRank(w.cls)));
    const top = parts.find((w) => classRank(w.cls) === rank)!;
    const a = nodeFor(startNk, pts[0]);
    const b = nodeFor(nodeKey(k), pts[pts.length - 1]);
    // One-way direction relative to the chained polyline.
    const oneway = w0.oneway ? ((firstFwd ? w0.oneway : -w0.oneway) as 1 | -1) : undefined;
    const widths = parts.map(defaultWidth);
    const edge: NetEdge = {
      id: graph.edges.length, a, b, pts, cls: top.cls, rank,
      width: widths.reduce((s, x) => s + x, 0) / widths.length,
      ...(oneway ? { oneway } : {}), ...(top.lanes ? { lanes: top.lanes } : {}),
      layer: w0.layer ?? 0, ...(top.name ? { name: top.name } : {}),
      ...(top.service ? { service: top.service } : {}), ...(top.surface ? { surface: top.surface } : {}),
      ...(w0.median !== undefined ? { median: parts.reduce((s, w) => s + (w.median ?? 0), 0) / parts.length } : {}),
    };
    graph.edges.push(edge);
    graph.nodes[a].legs.push({ edge: edge.id, start: true });
    graph.nodes[b].legs.push({ edge: edge.id, start: false });
  };
  for (const [nk, list] of at) {
    if (joinable(nk)) continue;
    for (const i of list) {
      if (used.has(i)) continue;
      const e = kept[i];
      walk(i, nodeKey(e.ka) === nk ? e.ka : e.kb);
    }
  }
  // Closed loops of joinable vertices only (an isolated ring road): start anywhere.
  kept.forEach((e, i) => { if (!used.has(i)) walk(i, e.ka); });
  for (const n of graph.nodes) {
    if (n.kind === "roundabout") continue;
    n.kind = n.legs.length >= 3 ? "junction" : n.legs.length === 2 ? "mid" : "end";
  }
  // 6. Splitter islands: two short one-way edges between a roundabout and the same outer node, one in, one out.
  for (const n of graph.nodes) {
    if (n.kind !== "roundabout") continue;
    const byOuter = new Map<number, number[]>();
    for (const l of n.legs) {
      const e = graph.edges[l.edge];
      if (!e.oneway || e.a === e.b) continue;
      const other = l.start ? e.b : e.a;
      const len = lengths(e.pts);
      if (len[len.length - 1] > splitterMax || graph.nodes[other].kind === "roundabout") continue;
      if (!byOuter.has(other)) byOuter.set(other, []);
      byOuter.get(other)!.push(e.id);
    }
    for (const [outer, list] of byOuter) {
      const on = graph.nodes[outer];
      if (list.length !== 2 || on.legs.length !== 3) continue;
      const [e1, e2] = list.map((id) => graph.edges[id]);
      // One must run into the ring and one out of it.
      const into = (e: NetEdge) => (e.b === n.id ? e.oneway === 1 : e.oneway === -1);
      if (into(e1) === into(e2)) continue;
      e1.internal = e2.internal = true;
      n.roundabout!.splitters.push({ edges: [e1.id, e2.id], at: on.p });
      // The outer node joins the roundabout: its third edge becomes the roundabout's leg.
      const third = on.legs.find((l) => l.edge !== e1.id && l.edge !== e2.id)!;
      const te = graph.edges[third.edge];
      if (third.start) te.a = n.id; else te.b = n.id;
      n.legs.push(third);
      on.legs = [];
      on.kind = "mid";
    }
    n.legs = n.legs.filter((l) => !graph.edges[l.edge].internal);
    n.inner = n.roundabout!.splitters.flatMap((s) => s.edges);
  }
  // 7. Junctions joined by a very short edge (dual carriageway crossings, dog-legs) become one.
  const mergeMax = o.mergeMax ?? 15;
  const up = graph.nodes.map((n) => n.id);
  const root = (i: number): number => (up[i] === i ? i : (up[i] = root(up[i])));
  const isJ = (id: number) => graph.nodes[id].kind === "junction" || graph.nodes[id].kind === "roundabout";
  for (const e of graph.edges) {
    if (e.internal || e.a === e.b || !isJ(e.a) || !isJ(e.b)) continue;
    const L = lengths(e.pts);
    if (L[L.length - 1] >= mergeMax) continue;
    const ra = root(e.a), rb = root(e.b);
    // Never two roundabouts into one.
    if (ra !== rb && !(graph.nodes[ra].kind === "roundabout" && graph.nodes[rb].kind === "roundabout")) {
      if (graph.nodes[rb].kind === "roundabout") up[ra] = rb; else up[rb] = ra;
    }
  }
  const members = new Map<number, number[]>();
  graph.nodes.forEach((n) => {
    const r = root(n.id);
    if (!members.has(r)) members.set(r, []);
    members.get(r)!.push(n.id);
  });
  for (const [r, ids] of members) {
    if (ids.length < 2) continue;
    const keep = graph.nodes[r];
    const inCluster = new Set(ids);
    const inner = new Set(keep.inner ?? []);
    const legs: NetNode["legs"] = [];
    for (const id of ids) {
      const n = graph.nodes[id];
      for (const id2 of n.inner ?? []) inner.add(id2);
      for (const l of n.legs) {
        const e = graph.edges[l.edge];
        const L = lengths(e.pts);
        if (inCluster.has(e.a) && inCluster.has(e.b) && L[L.length - 1] < mergeMax) {
          e.internal = true;
          inner.add(e.id);
          continue;
        }
        legs.push(l);
      }
    }
    for (const id of ids) {
      if (id === r) continue;
      const n = graph.nodes[id];
      n.legs = [];
      n.kind = "mid";
      n.mergedInto = r;
    }
    for (const e of graph.edges) {
      if (inCluster.has(e.a)) e.a = r;
      if (inCluster.has(e.b)) e.b = r;
    }
    keep.legs = legs;
    keep.inner = [...inner];
    if (keep.kind !== "roundabout") {
      keep.p = [ids.reduce((s, id) => s + graph.nodes[id].p[0], 0) / ids.length, ids.reduce((s, id) => s + graph.nodes[id].p[1], 0) / ids.length];
    }
  }
  return graph;
}

/** A leg's centreline pointing away from its node. */
export function legLine(g: Graph, leg: { edge: number; start: boolean }): P2[] {
  const pts = g.edges[leg.edge].pts;
  return leg.start ? pts : pts.slice().reverse();
}
