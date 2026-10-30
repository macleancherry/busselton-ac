// A route's centreline taken straight from OSM ways instead of OSRM, for roads the
// car profile won't drive (highway=raceway circuits, gravel tracks). The listed ways make a small
// road graph; the drive goes through the pins along it, in order (shortest way between each pair),
// so the pins choose the direction and which way round a junction it goes: on a circuit with an
// extension, a pin on the extension takes the long layout. "reverse" flips the finished drive.

import { haversine, type LngLat } from "./geo";

export interface OsmWayGeom {
  id: number;
  pts: LngLat[];
}

export interface WayRouteOptions {
  /** Drive it the other way round (after routing through the pins). */
  reverse?: boolean;
  /** A circuit: `through` ends back at its first pin (as the page passes it). */
  loop?: boolean;
  /** How far a pin may sit from the ways, metres. */
  maxSnap?: number;
}

/**
 * The drive through `through` (pins in order, the first repeated at the end for a circuit) along
 * the ways. Throws a plain message when a pin is off the ways, the ways don't connect, or the drive
 * would turn back on itself at a pin.
 */
export function routeAlongWays(ways: OsmWayGeom[], through: LngLat[], opts: WayRouteOptions = {}): { coords: LngLat[]; distance: number } {
  if (!ways.length) throw new Error("no OSM ways to route along");
  if (through.length < 2) throw new Error("routing along OSM ways needs at least two pins");
  const maxSnap = opts.maxSnap ?? 80;
  const lat0 = ways[0].pts[0][1];
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320, ky = 111320;

  // The graph: one node per distinct point (ways share their junction nodes), an edge per segment.
  const nodes: LngLat[] = [];
  const index = new Map<string, number>();
  const adj: Set<number>[] = [];
  const key = (p: LngLat) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const node = (p: LngLat) => {
    const k = key(p);
    let i = index.get(k);
    if (i === undefined) {
      i = nodes.push(p) - 1;
      index.set(k, i);
      adj.push(new Set());
    }
    return i;
  };
  const link = (a: number, b: number) => {
    if (a === b) return;
    adj[a].add(b);
    adj[b].add(a);
  };
  for (const w of ways) {
    for (let i = 1; i < w.pts.length; i++) link(node(w.pts[i - 1]), node(w.pts[i]));
  }

  // Each pin onto the nearest point of the ways (splitting that segment there).
  const pinNodes = through.map((pin, k) => {
    let best = Infinity, ba = -1, bb = -1, bt = 0;
    for (let a = 0; a < nodes.length; a++) {
      for (const b of adj[a]) {
        if (b < a) continue;
        const ax = (nodes[a][0] - pin[0]) * kx, ay = (nodes[a][1] - pin[1]) * ky;
        const dx = (nodes[b][0] - nodes[a][0]) * kx, dy = (nodes[b][1] - nodes[a][1]) * ky;
        const L2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
        const d = Math.hypot(ax + dx * t, ay + dy * t);
        if (d < best) [best, ba, bb, bt] = [d, a, b, t];
      }
    }
    const label = loopPinLabel(k, through.length, !!opts.loop);
    if (best > maxSnap) {
      throw new Error(`${label} is ${Math.round(best)} m from the OSM ways (more than ${maxSnap} m): move it onto the road`);
    }
    const segLen = haversine(nodes[ba], nodes[bb]);
    if (bt * segLen < 1) return ba;
    if ((1 - bt) * segLen < 1) return bb;
    const p: LngLat = [nodes[ba][0] + (nodes[bb][0] - nodes[ba][0]) * bt, nodes[ba][1] + (nodes[bb][1] - nodes[ba][1]) * bt];
    const n = node(p);
    adj[ba].delete(bb);
    adj[bb].delete(ba);
    link(ba, n);
    link(n, bb);
    return n;
  });

  // Shortest path between each pair of pins (Dijkstra; the graphs are a few thousand nodes at most).
  const path = (from: number, to: number): number[] | null => {
    const dist = new Float64Array(nodes.length).fill(Infinity);
    const prev = new Int32Array(nodes.length).fill(-1);
    const done = new Uint8Array(nodes.length);
    dist[from] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0) return null;
      if (u === to) break;
      done[u] = 1;
      for (const v of adj[u]) {
        const d = dist[u] + haversine(nodes[u], nodes[v]);
        if (d < dist[v]) {
          dist[v] = d;
          prev[v] = u;
        }
      }
    }
    const out = [to];
    while (out[out.length - 1] !== from) out.push(prev[out[out.length - 1]]);
    return out.reverse();
  };

  const ids: number[] = [pinNodes[0]];
  for (let k = 1; k < pinNodes.length; k++) {
    if (pinNodes[k] === pinNodes[k - 1]) continue;
    const leg = path(pinNodes[k - 1], pinNodes[k]);
    if (!leg) {
      throw new Error(`the OSM ways don't connect ${loopPinLabel(k - 1, through.length, !!opts.loop)} to ${loopPinLabel(k, through.length, !!opts.loop)}: check the way ids (they must share nodes where they meet)`);
    }
    // Turning straight back the way it came, at a pin: a hairpin spike in the track.
    if (ids.length >= 2 && leg[1] === ids[ids.length - 2]) {
      throw new Error(`the route turns back on itself at ${loopPinLabel(k - 1, through.length, !!opts.loop)}: move it, or add a pin further round so the route goes on past it`);
    }
    ids.push(...leg.slice(1));
  }
  if (opts.loop && ids.length > 2 && ids[0] === ids[ids.length - 1] && ids[1] === ids[ids.length - 2]) {
    throw new Error("the circuit turns back on itself at pin 1: add a pin so the lap goes on past it");
  }
  if (ids.length < 2) throw new Error("the pins all snap to the same point on the OSM ways");
  let coords = ids.map((i) => nodes[i]);
  if (opts.reverse) coords = coords.slice().reverse();
  const distance = coords.slice(1).reduce((d, c, i) => d + haversine(coords[i], c), 0);
  return { coords, distance };
}

function loopPinLabel(k: number, n: number, loop: boolean): string {
  return `pin ${loop && k === n - 1 ? 1 : k + 1}`;
}
