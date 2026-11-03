// Side streets: the other roads near the route, drawn so the route doesn't
// run through an empty world. They come from the vector tiles, are cut away
// where they overlap the route itself, and are draped on the terrain. Where
// one meets the route it is extended to the route's edge and the route's
// verge (and edge line) opens up for the junction mouth.
//
// Grade-separated roads (motorways, links, bridges, tunnels) are left out:
// drawn on the ground they would make crossings that don't exist. Busselton fork: a bridge that
// crosses no other road (a river, a drain) is built, as a flat deck (bridges.ts, bridgeDecks).

import type { HeightFn } from "./elevation";
import type { LngLat, LocalProjection, Vec2 } from "./geo";
import type { Kn5MeshNode } from "./kn5";
import type { Area } from "./area";
import type { BuildOptions } from "./options";
import { resample } from "./polyline";
import { outerRadius, ringHeight } from "./roundabout";
import { inRoundabout, isLoop, planRoad, surfaceHeight, type RoadPlan, type SegmentIndex } from "./road";
import { applyTrace, traceRoad, type RasterSampler } from "./trace";
import { pad } from "./roadMesh";
import { ChunkedMesh } from "./scenery";
import { SEAL_LENGTH } from "./textures";
import { surfaceKeyFor } from "./unsealed";
import { PIT_CLASS } from "./pitRoad";
import { clipTraceAtPaths } from "./pathTraceClip";
import type { PathLine } from "./paths";
import { deckBridges, deckGround } from "./bridges";

export interface StreetLine {
  pts: LngLat[];
  cls: string;
  brunnel?: string;
  /** One-way: 1 along the line, -1 against it. */
  oneway?: 1 | -1;
  /** OSM service=* on service roads (parking_aisle, driveway, alley, ...). */
  service?: string;
  /** Busselton fork: OSM surface=* (or the vector tiles' paved/unpaved), for unsealed roads (unsealed.ts). */
  surface?: string;
  /** Busselton fork: the width, metres, for a line whose class has none of its own (a pit lane: pitRoad.ts). */
  width?: number;
}

export interface StreetName {
  pts: LngLat[];
  name: string;
}

/** Asphalt width by road class for streets that aren't the route. */
const SIDE_WIDTH: Record<string, number> = {
  primary: 7.5, secondary: 7, tertiary: 6.5, minor: 6, service: 4, track: 3.5,
  // Busselton fork: a layout's raceway where it leaves the main drive (layoutDrives.ts).
  raceway: 10,
};

export interface Junction {
  /** Route sample index where the side street meets it. */
  seg: number;
  /** Distance along the route. */
  s: number;
  /** Which side of the route: 1 left, -1 right. */
  side: 1 | -1;
  /** Side street width, metres. */
  width: number;
  /** Unit direction of the side street, pointing away from the route. */
  dir: Vec2;
  name?: string;
}

export interface SideStreet {
  pts: Vec2[];
  width: number;
  /** Per-point widths once traced from the photo. */
  widths?: number[];
  /** The traced centreline as a road plan, and how far to trust each sample. */
  traced?: { plan: RoadPlan; conf: number[] };
  cls: string;
  name?: string;
  /** Indices into `pts` that sit on the route's edge (junction mouths). */
  joins: number[];
  /** One-way: 1 in the order of `pts`, -1 against it. */
  oneway?: 1 | -1;
  /** OSM service=* (parking_aisle, driveway, ...), for service roads. */
  service?: string;
  /** Busselton fork: OSM surface=* (unsealed.ts). */
  surface?: string;
  /** Busselton fork: a bridge, built as a flat deck between its ends' ground (bridges.ts). */
  deck?: true;
}

/**
 * Grid hash of line segments for "how far to the nearest street" queries. Busselton fork: a line's
 * per-point `widths` (a street traced in the photo: traceSideStreets) are used where it has them,
 * so the index is as wide as the street mesh built from the same widths (buildSideStreets), not
 * the class width (6 m on a minor street, where the traced asphalt is often 9 to 12 m).
 */
export class LineIndex {
  /** Segment ends and the street's width at each end. */
  private cells = new Map<string, [Vec2, Vec2, number, number][]>();
  constructor(lines: { pts: Vec2[]; width: number; widths?: number[] }[], private readonly cell = 20) {
    for (const l of lines) {
      const w = (i: number) => {
        const v = l.widths?.[i];
        return v !== undefined && Number.isFinite(v) ? v : l.width;
      };
      for (let i = 1; i < l.pts.length; i++) {
        const a = l.pts[i - 1], b = l.pts[i];
        const x0 = Math.floor(Math.min(a[0], b[0]) / cell), x1 = Math.floor(Math.max(a[0], b[0]) / cell);
        const y0 = Math.floor(Math.min(a[1], b[1]) / cell), y1 = Math.floor(Math.max(a[1], b[1]) / cell);
        const seg: [Vec2, Vec2, number, number] = [a, b, w(i - 1), w(i)];
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          const k = x + "," + y;
          if (!this.cells.has(k)) this.cells.set(k, []);
          this.cells.get(k)!.push(seg);
        }
      }
    }
  }

  /** Distance from (x, y) to the nearest street's edge (negative inside it). */
  clearance(x: number, y: number): number {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    let best = Infinity;
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const [a, b, wa, wb] of this.cells.get(gx + "," + gy) ?? []) {
          const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
          best = Math.min(best, Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t) - (wa + (wb - wa) * t) / 2);
        }
      }
    }
    return best;
  }

  /**
   * Busselton fork: the room between a closed ring (a building's outline) and the nearest street's
   * edge, metres; negative when a street reaches inside it. Unlike testing the ring's corners, this
   * sees a street crossing between two corners, one whose edge cuts a wall, and one that ends
   * inside the outline (-Infinity when a street's line has a point inside the ring).
   */
  ringClearance(ring: Vec2[]): number {
    if (ring.length < 3) return Infinity;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const seen = new Set<[Vec2, Vec2, number, number]>();
    let best = Infinity;
    // Segments indexed in the cells round the ring's box (one cell of margin, as clearance()).
    for (let gx = Math.floor(x0 / this.cell) - 1; gx <= Math.floor(x1 / this.cell) + 1; gx++) {
      for (let gy = Math.floor(y0 / this.cell) - 1; gy <= Math.floor(y1 / this.cell) + 1; gy++) {
        for (const seg of this.cells.get(gx + "," + gy) ?? []) {
          if (seen.has(seg)) continue;
          seen.add(seg);
          const [a, b, wa, wb] = seg;
          if (inRing(a, ring) || inRing(b, ring)) return -Infinity;
          const half = Math.max(wa, wb) / 2;
          for (let k = 0; k < ring.length; k++) {
            const d = segDist(a, b, ring[k], ring[(k + 1) % ring.length]);
            if (d - half < best) best = d - half;
          }
        }
      }
    }
    return best;
  }
}

function inRing(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function pointSegDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}

/** Shortest distance between segments ab and cd (0 when they cross). */
export function segDist(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const cross = (o: Vec2, p: Vec2, q: Vec2) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}

function nearestName(p: Vec2, names: { pts: Vec2[]; name: string }[], max: number): string | undefined {
  let best: string | undefined, bestD = max;
  for (const n of names) {
    for (let i = 1; i < n.pts.length; i++) {
      const a = n.pts[i - 1], b = n.pts[i];
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
      const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
      if (d < bestD) {
        bestD = d;
        best = n.name;
      }
    }
  }
  return best;
}

export interface StreetPlan {
  streets: SideStreet[];
  junctions: Junction[];
  /** The route's own name at each sample, where the map has one. */
  routeNames: (string | undefined)[];
}

export function planSideStreets(
  lines: StreetLine[],
  names: StreetName[],
  plan: RoadPlan,
  index: SegmentIndex,
  opts: BuildOptions,
  proj: LocalProjection,
  area: Area | null = null,
): StreetPlan {
  const localNames = names.map((n) => ({ name: n.name, pts: n.pts.map((p) => proj.toLocal(p)) }));
  const streets: SideStreet[] = [];
  const junctions: Junction[] = [];

  // Busselton fork: bridges over no other road are built as decks (bridges.ts).
  const decks = opts.bridgeDecks !== false && lines.some((l) => l.brunnel === "bridge")
    ? deckBridges(lines.map((l) => ({ pts: l.pts.map((p) => proj.toLocal(p)), cls: l.cls, brunnel: l.brunnel })))
    : new Set<number>();
  for (const [li, line] of lines.entries()) {
    const width = line.width ?? SIDE_WIDTH[line.cls];
    const deck = decks.has(li);
    if (!width || (line.brunnel === "bridge" && !deck) || line.brunnel === "tunnel" || line.pts.length < 2) continue;
    const dense = resample(line.pts.map((p) => proj.toLocal(p)), 2);
    // Keep points clear of the route and its verges, inside the terrain corridor.
    const state = dense.map(([x, y]) => {
      if (inRoundabout(plan, x, y, opts.vergeWidth + width / 2)) return "ring";
      const n = index.nearest(x, y, opts.corridor);
      // Busselton fork: every street inside an area build's polygon is built.
      const inArea = !!area && area.signed(x, y) < -3;
      if (!n) return inArea ? "keep" : "far";
      if (n.dist < index.at(n).width / 2 + opts.vergeWidth + width / 2 * 0.2 + 0.3) return "route";
      return n.dist < opts.corridor - 3 || inArea ? "keep" : "far";
    });
    for (let i = 0; i < dense.length;) {
      if (state[i] !== "keep") { i++; continue; }
      let j = i;
      while (j < dense.length && state[j] === "keep") j++;
      let pts = dense.slice(i, j);
      const joins: number[] = [];
      // Ends that were cut by the route become junctions: run them to its edge.
      const join = (end: Vec2, outward: Vec2): Vec2 | null => {
        const n = index.nearest(end[0], end[1], 30);
        if (!n) return null;
        const s = plan.samples[n.seg];
        const side: 1 | -1 = n.t >= 0 ? 1 : -1;
        const half = index.at(n).width / 2;
        // Carry on along the street itself until it meets the route's edge.
        const across = Math.abs(outward[0] * s.left[0] + outward[1] * s.left[1]);
        const back = (n.dist - (half - 0.05)) / Math.max(0.35, across);
        const edge: Vec2 = [end[0] - outward[0] * back, end[1] - outward[1] * back];
        junctions.push({ seg: n.seg, s: s.s, side, width, dir: outward, name: undefined });
        return edge;
      };
      if (i > 0 && state[i - 1] === "route" && pts.length > 1) {
        const out = norm([pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]]);
        const e = join(pts[0], out);
        if (e) {
          pts = [e, ...pts];
          joins.push(0);
        }
      }
      if (j < dense.length && state[j] === "route" && pts.length > 1) {
        const k = pts.length - 1;
        const out = norm([pts[k - 1][0] - pts[k][0], pts[k - 1][1] - pts[k][1]]);
        const e = join(pts[k], out);
        if (e) {
          pts = [...pts, e];
          joins.push(pts.length - 1);
        }
      }
      // Busselton fork: ends cut by a roundabout run on to its outer edge, so the street meets the
      // ring instead of stopping a verge's width short of it.
      const toRing = (end: Vec2, cut: Vec2): Vec2 | null => {
        const rb = inRoundabout(plan, cut[0], cut[1], opts.vergeWidth + width);
        if (!rb) return null;
        const d = Math.hypot(end[0] - rb.c[0], end[1] - rb.c[1]) || 1, R = rb.r + rb.w / 2 - 0.4;
        return d > R ? [rb.c[0] + ((end[0] - rb.c[0]) / d) * R, rb.c[1] + ((end[1] - rb.c[1]) / d) * R] : null;
      };
      if (i > 0 && state[i - 1] === "ring" && pts.length > 1) {
        const e = toRing(pts[0], dense[i - 1]);
        if (e) pts = [e, ...pts];
      }
      if (j < dense.length && state[j] === "ring" && pts.length > 1) {
        const e = toRing(pts[pts.length - 1], dense[j]);
        if (e) pts = [...pts, e];
      }
      const length = pts.reduce((a, p, k) => (k ? a + Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) : 0), 0);
      if (length >= 8) {
        const name = nearestName(pts[Math.floor(pts.length / 2)], localNames, 8);
        streets.push({ pts, width, cls: line.cls, name, joins, ...(line.oneway ? { oneway: line.oneway } : {}), ...(line.service ? { service: line.service } : {}), ...(line.surface ? { surface: line.surface } : {}), ...(deck ? { deck: true as const } : {}) });
        for (let k = junctions.length - joins.length; k < junctions.length; k++) junctions[k].name = name;
      } else {
        junctions.splice(junctions.length - joins.length, joins.length);
      }
      i = j;
    }
  }

  // Merge junctions at the same mouth (a street split across tiles).
  const merged: Junction[] = [];
  for (const jn of junctions.sort((a, b) => a.s - b.s)) {
    const prev = merged.find((m) => m.side === jn.side && Math.abs(m.s - jn.s) < Math.max(m.width, jn.width));
    if (prev) prev.name ??= jn.name;
    else merged.push(jn);
  }

  const routeNames = plan.samples.map(() => undefined as string | undefined);
  for (let i = 0; i < plan.samples.length; i += 10) {
    const nm = nearestName(plan.samples[i].pos, localNames, 10);
    for (let k = i; k < Math.min(plan.samples.length, i + 10); k++) routeNames[k] = nm;
  }
  return { streets, junctions: merged, routeNames };
}

function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/**
 * Height of a street's surface at lateral offset `t` (+ left) from its point
 * k: 10 cm above the ground, blending down over the last 10 m to a junction
 * to sit 2 cm under the route's surface.
 */
export function streetSurface(plan: RoadPlan, index: SegmentIndex, opts: BuildOptions, ground: HeightFn) {
  // The surface a join meets: the route's beside it, else a ring's edge (an area build's roundabout
  // away from the route), else null (another street): then the street stays draped. Blending it to
  // 2 cm under the ground there put the ground through the street.
  const routeSurface = (x: number, y: number): number | null => {
    const near = index.nearest(x, y, 40);
    if (!near) {
      const rb = plan.roundabouts.find((r) => Math.hypot(x - r.c[0], y - r.c[1]) < outerRadius(r) + 12);
      return rb ? ringHeight(rb, outerRadius(rb)) : null;
    }
    const s = plan.samples[near.seg];
    return surfaceHeight(s, near.t, opts.crown);
  };
  // Busselton fork: a bridge's deck runs flat from its ends' ground (bridges.ts).
  const decks = new WeakMap<Vec2[], HeightFn>();
  const deckAt = (st: SideStreet): HeightFn => {
    let f = decks.get(st.pts);
    if (!f) decks.set(st.pts, (f = deckGround(ground, [{ pts: st.pts, width: st.width }], Math.max(...(st.widths ?? [st.width])) / 2)));
    return f;
  };
  return (st: SideStreet, k: number, t: number) => {
    const n = st.pts.length;
    const a = st.pts[Math.max(0, k - 1)], b = st.pts[Math.min(n - 1, k + 1)];
    const d = norm([b[0] - a[0], b[1] - a[1]]);
    const x = st.pts[k][0] - d[1] * t, y = st.pts[k][1] + d[0] * t;
    const draped = (st.deck ? deckAt(st)(x, y) : ground(x, y)) + 0.1;
    let along = 0, dJoin = Infinity;
    const at: number[] = [0];
    for (let q = 1; q < n; q++) at.push(at[q - 1] + Math.hypot(st.pts[q][0] - st.pts[q - 1][0], st.pts[q][1] - st.pts[q - 1][1]));
    along = at[k];
    for (const j of st.joins) dJoin = Math.min(dJoin, Math.abs(along - at[j]));
    if (dJoin >= 10) return draped;
    const route = routeSurface(x, y);
    if (route === null) return draped;
    const r = route - 0.02;
    const f = dJoin / 10;
    return r + (draped - r) * f * f * (3 - 2 * f);
  };
}

/**
 * The street with extra points wherever the ground between two of its points strays more than
 * `tol` metres from a straight line across (on the centreline or either edge), halving until it
 * doesn't or the pieces are `min` metres long. Widths and joins follow.
 */
export function densifyStreet(st: SideStreet, ground: HeightFn, tol = 0.03, min = 2): SideStreet {
  const pts: Vec2[] = [], widths: number[] = [], map: number[] = [];
  const wAt = (k: number) => st.widths?.[k] ?? st.width;
  const bulges = (q: Vec2, p: Vec2, w: number): boolean => {
    const d = norm([p[0] - q[0], p[1] - q[1]]), l: Vec2 = [-d[1], d[0]];
    for (const off of [0, w / 2, -w / 2]) {
      const a: Vec2 = [q[0] + l[0] * off, q[1] + l[1] * off], b: Vec2 = [p[0] + l[0] * off, p[1] + l[1] * off];
      const ha = ground(a[0], a[1]), hb = ground(b[0], b[1]);
      for (const f of [0.25, 0.5, 0.75]) {
        if (Math.abs(ground(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f) - (ha + (hb - ha) * f)) > tol) return true;
      }
    }
    return false;
  };
  const split = (q: Vec2, p: Vec2, wq: number, wp: number) => {
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= min || !bulges(q, p, (wq + wp) / 2)) return;
    const m: Vec2 = [(q[0] + p[0]) / 2, (q[1] + p[1]) / 2], wm = (wq + wp) / 2;
    split(q, m, wq, wm);
    pts.push(m);
    widths.push(wm);
    split(m, p, wm, wp);
  };
  st.pts.forEach((p, k) => {
    if (k) split(st.pts[k - 1], p, wAt(k - 1), wAt(k));
    map.push(pts.length);
    pts.push(p);
    widths.push(wAt(k));
  });
  if (pts.length === st.pts.length) return st;
  return { ...st, pts, widths: st.widths ? widths : undefined, joins: st.joins.map((j) => map[j]) };
}

/**
 * Draped ribbons. Each street sits 10 cm above the ground; at a junction it
 * blends down to the route's surface over 10 m and tucks 2 cm under the
 * route's edge so the two never fight.
 */
export function buildSideStreets(
  streets: SideStreet[],
  plan: RoadPlan,
  index: SegmentIndex,
  opts: BuildOptions,
  ground: HeightFn,
  materialFor: (st: SideStreet, i: number) => string | { material: string; perStreet: true },
  /** Busselton fork: networkCore junctions (network/phase1.ts) cover the quad from arc s0 to s1 of a street. */
  skip?: (st: SideStreet, s0: number, s1: number) => boolean,
): Kn5MeshNode[] {
  const out: Kn5MeshNode[] = [];
  const meshes = new Map<string, ChunkedMesh>();
  // Busselton fork: pit lanes (pitRoad.ts) are valid track, meshed apart from the streets, with edge lines.
  const pitMeshes = new Map<string, ChunkedMesh>();
  const pitLines = new ChunkedMesh(0);
  const surface = streetSurface(plan, index, opts, ground);
  streets.forEach((st0, si) => {
    const choice = materialFor(st0, si);
    // Extra points where the ground bulges between the street's own points (on a long straight they
    // can be 20 m or more apart, and the ground came up through the ribbon).
    const st = densifyStreet(st0, ground);
    const mat = typeof choice === "string" ? choice : choice.material;
    const pit = st.cls === PIT_CLASS;
    const pool = pit ? pitMeshes : meshes;
    if (!pool.has(mat)) pool.set(mat, new ChunkedMesh(0));
    const mb = pool.get(mat)!.next(st.pts.length * 2);
    const n = st.pts.length;
    const along = [0];
    for (let k = 1; k < n; k++) along.push(along[k - 1] + Math.hypot(st.pts[k][0] - st.pts[k - 1][0], st.pts[k][1] - st.pts[k - 1][1]));
    const base = mb.vertexCount;
    for (let k = 0; k < n; k++) {
      const a = st.pts[Math.max(0, k - 1)], b = st.pts[Math.min(n - 1, k + 1)];
      const t = norm([b[0] - a[0], b[1] - a[1]]);
      const left: Vec2 = [-t[1], t[0]];
      const w = st.widths?.[k] ?? st.width;
      for (const side of [1, -1]) {
        const x = st.pts[k][0] + left[0] * side * w / 2, y = st.pts[k][1] + left[1] * side * w / 2;
        mb.vertex([x, y, surface(st, k, side * w / 2)], side > 0 ? 0 : 1, typeof choice === "string" ? along[k] / SEAL_LENGTH : along[k] / Math.max(1, along[n - 1]));
      }
    }
    for (let k = 0; k < n - 1; k++) {
      if (skip?.(st0, along[k], along[k + 1])) continue;
      const p = base + k * 2, q = p + 2;
      mb.quad(p, p + 1, q + 1, q);
    }
    if (pit) pitEdgeLines(pitLines, st, (k, t) => surface(st, k, t));
  });
  let j = 0;
  for (const [mat, cm] of pitMeshes) {
    for (const m of cm.all()) {
      m.normals = null; // from the faces
      out.push(m.toKn5(`1ROAD_PIT_${pad(j++)}`, mat));
    }
  }
  pitLines.all().forEach((m, k) => { m.normals = null; if (m.indices.length) out.push(m.toKn5(`MARKINGS_PIT_${pad(k)}`, "paint", { castShadows: false })); });
  let i = 0;
  for (const [mat, cm] of meshes) {
    for (const m of cm.all()) {
      m.normals = null; // from the faces
      // Drivable like the road, but not valid track: cutting through one is a shortcut.
      // Busselton fork: gravel streets have their own surface (unsealed.ts).
      out.push(m.toKn5(`1${surfaceKeyFor(mat, false) ?? "STREET"}_${pad(i++)}`, mat));
    }
  }
  return out;
}

/** A pit lane's paint inset from its edges, its width and its lift over the surface, metres. */
const PIT_LINE_INSET = 0.3, PIT_LINE_WIDTH = 0.12, PIT_LINE_LIFT = 0.012;

/** White lines along both edges of a pit lane, PIT_LINE_INSET in, on the lane's own surface. */
function pitEdgeLines(cm: ChunkedMesh, st: SideStreet, surface: (k: number, t: number) => number): void {
  const n = st.pts.length;
  if (n < 2) return;
  for (const side of [1, -1]) {
    const mb = cm.next(n * 2);
    const base = mb.vertexCount;
    for (let k = 0; k < n; k++) {
      const a = st.pts[Math.max(0, k - 1)], b = st.pts[Math.min(n - 1, k + 1)];
      const t = norm([b[0] - a[0], b[1] - a[1]]);
      const left: Vec2 = [-t[1], t[0]];
      const w = st.widths?.[k] ?? st.width;
      for (const off of [w / 2 - PIT_LINE_INSET, w / 2 - PIT_LINE_INSET - PIT_LINE_WIDTH]) {
        const o = side * off;
        mb.vertex([st.pts[k][0] + left[0] * o, st.pts[k][1] + left[1] * o, surface(k, o) + PIT_LINE_LIFT], 0.5, 0.5);
      }
    }
    for (let k = 0; k < n - 1; k++) {
      const p = base + k * 2, q = p + 2;
      // Counter-clockwise from above: left, right, next right, next left.
      if (side > 0) mb.quad(p, p + 1, q + 1, q); else mb.quad(p + 1, p, q, q + 1);
    }
  }
}

/**
 * Traces each side street in the aerial photo the way the route is traced,
 * moving it onto its real line and width. Junction ends stay pinned to the
 * route's edge.
 */
export function traceSideStreets(streets: SideStreet[], raster: RasterSampler, opts: BuildOptions, route?: SegmentIndex, paths?: PathLine[]): number {
  let traced = 0;
  for (const st of streets) {
    const length = st.pts.reduce((a, p, k) => (k ? a + Math.hypot(p[0] - st.pts[k - 1][0], p[1] - st.pts[k - 1][1]) : 0), 0);
    if (length < 30 || isLoop(st.pts)) continue;
    const sub = planRoad(st.pts, { ...opts, widthOverride: st.width, lineSmoothing: 2, banking: false });
    const tr = traceRoad(sub, raster, undefined, opts.traceGuard);
    if (tr.coverage < 0.2) continue;
    const n = sub.samples.length;
    // Ease the shift to nothing over 12 m at each junction end.
    const ends = st.joins.map((j) => (j === 0 ? 0 : n - 1));
    tr.offset = tr.offset.map((o, i) => {
      const d = Math.min(Infinity, ...ends.map((e) => Math.abs(sub.samples[i].s - sub.samples[e].s)));
      return o * Math.min(1, d / 12);
    });
    // Busselton fork: the traced edges stop short of the mapped paths beside the street (pathTraceClip.ts).
    if (paths?.length) clipTraceAtPaths(sub.samples, tr, paths);
    applyTrace(sub, tr, () => false);
    // A trace that drifts onto the route (a street running beside it, pulled onto its asphalt)
    // would leave the street under the road: keep the mapped line instead.
    if (route && sub.samples.some((smp) => {
      if (Math.min(...ends.map((e) => Math.abs(smp.s - sub.samples[e].s))) < 15) return false;
      const near = route.nearest(smp.pos[0], smp.pos[1], 30);
      return !!near && near.dist < route.at(near).width / 2 + smp.width / 2 + 0.5;
    })) continue;
    st.pts = sub.samples.map((s) => s.pos);
    st.widths = sub.samples.map((s) => s.width);
    st.joins = ends;
    st.traced = { plan: sub, conf: tr.conf };
    traced++;
  }
  return traced;
}
