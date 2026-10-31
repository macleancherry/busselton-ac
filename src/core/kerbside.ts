// Busselton fork: kerbside paint on town streets (ROADMAP.md phase B, town details).
//
//  - Parking bays where OSM tags kerbside parking (parking:left|right|both=lane with :orientation,
//    or the older parking:lane:left|right|both=parallel|diagonal|perpendicular|marked), else where
//    the aerial photo shows cars parked along the kerb. Parallel bays get the usual Australian
//    T-marks, 6 m apart: a short line out from the kerb with a foot at its outer end. Angle and
//    90-degree bays get their bay lines and a line along the bays' outer end.
//  - Bike lanes where OSM has cycleway=lane (or cycleway:left|right|both=lane): a white line 1.5 m
//    out from the kerb (or from the parking), with a bicycle symbol every 60 m standing up the lane
//    for its traffic. cycleway=shared_lane gets the symbols alone.
//
// Painted like the other markings (markings.ts): white strips 15 mm above the asphalt, draped on
// the street's own surface, material "paint". Breaks at junctions (within a few metres of another
// street) and wherever the caller says (roundabouts). A side is only painted while the street is
// wide enough to leave its traffic lanes: parallel bays narrow to 1.8 m, then the parking goes,
// then bike lanes narrow to 1.2 m, then they go.
//
// Sides are relative to the line's direction: left is + (traffic keeps left, so the left side's
// traffic travels along the line).

import type { HeightFn } from "./elevation";
import type { LngLat, Vec2 } from "./geo";
import type { Kn5MeshNode } from "./kn5";
import type { MeshBuilder } from "./mesh";
import { symbolGlyph, type Glyph } from "./markings";
import type { BuildOptions } from "./options";
import { surfaceHeight, type RoadPlan, type SegmentIndex } from "./road";
import { outerRadius } from "./roundabout";
import { pad } from "./roadMesh";
import { ChunkedMesh } from "./scenery";
import { densifyStreet, streetSurface, type SideStreet } from "./sideStreets";
import type { BayBox } from "./bayLanes";
import { CAR_LENGTH, CAR_WIDTH } from "./parkedClear";

export type ParkingKind = "parallel" | "diagonal" | "perpendicular";

/** What one side of a street has. "no": OSM says none here (or unmarked): nothing painted, nothing guessed. */
export interface KerbSide {
  parking?: ParkingKind | "no";
  cycle?: "lane" | "shared" | "no";
}

export interface KerbTags {
  left: KerbSide;
  right: KerbSide;
}

/** An OSM way with kerbside tags, in local metres. */
export interface KerbsideWay extends KerbTags {
  pts: Vec2[];
}

/** A street to paint: its centreline, asphalt width, and the height of its surface. */
export interface Carriageway {
  pts: Vec2[];
  widths: number[];
  /** Unit left normals per point, if the street mesh uses its own (else from neighbouring points). */
  lefts?: Vec2[];
  /** Height of the drawn surface at fractional point index u, lateral offset t (+ left). */
  z: (u: number, t: number) => number;
  oneway?: boolean;
  /** Parked cars in the photo may give it parking bays (town streets, not car park aisles or tracks). */
  photoParking?: boolean;
}

/**
 * One painted bay, where a parked car goes (parkedPlacement.ts): its middle, the way a car in it
 * points (parallel bays: with its side's traffic; angle bays: nose to the kerb), the kind, which
 * carriageway (0 is the route when kerbsideForTrack built them) and whether the photo or OSM said so.
 */
export interface KerbSlot {
  at: Vec2;
  dir: Vec2;
  kind: ParkingKind;
  street: number;
  photo: boolean;
}

export interface KerbsideResult {
  nodes: Kn5MeshNode[];
  /** Every bay painted, in painting order. */
  slots: KerbSlot[];
  /** The space each bay (and the car in it) takes, one per slot in the same order (bayLanes.ts keeps traffic lanes clear of them). */
  boxes: BayBox[];
  bays: number;
  bikeLaneMetres: number;
  symbols: number;
}

const LIFT = 0.015;
const LINE = 0.1;
/** Bay depth out from the kerb, metres. */
export const BAY_DEPTH: Record<ParkingKind, number> = { parallel: 2.1, diagonal: 3.9, perpendicular: 5.4 };
const PARALLEL_MIN = 1.8;
const PARALLEL_BAY = 6;
/** Along the kerb between angle-bay lines: a 2.6 m bay at 45 degrees. */
const DIAGONAL_BAY = 2.6 / Math.SQRT1_2;
const PERP_BAY = 2.6;
const BIKE = 1.5;
const BIKE_MIN = 1.2;
const SYMBOL_EVERY = 60;
/** No paint within this far of another street's asphalt. */
const JUNCTION_GAP = 4;
/** The paint starts this far in from the seal edge (the gutter's lip). */
const KERB_IN = 0.1;

/* ---------------- tags ---------------- */

const NOT_ON_ROAD = /^(no|none|separate|street_side|lay_by|on_kerb|half_on_kerb|shoulder|no_parking|no_stopping|no_standing|fire_lane|painted_area_only)$/;

function parkingSide(tags: Record<string, string>, side: "left" | "right"): KerbSide["parking"] {
  const get = (k: string) => tags[`parking:${side}${k}`] ?? tags[`parking:both${k}`];
  const now = get("");
  if (now !== undefined) {
    if (now !== "lane") return "no";
    if (get(":markings") === "no") return "no";
    const o = get(":orientation") ?? "parallel";
    return o === "diagonal" || o === "perpendicular" ? o : "parallel";
  }
  const old = tags[`parking:lane:${side}`] ?? tags["parking:lane:both"];
  if (old === undefined) return undefined;
  if (old === "marked") return "parallel";
  if (old === "parallel" || old === "diagonal" || old === "perpendicular") {
    const pos = tags[`parking:lane:${side}:${old}`] ?? tags[`parking:lane:both:${old}`];
    return pos && NOT_ON_ROAD.test(pos) ? "no" : old;
  }
  return NOT_ON_ROAD.test(old) ? "no" : undefined;
}

function cycleValue(v: string | undefined): KerbSide["cycle"] {
  if (v === undefined) return undefined;
  if (v === "lane" || v === "opposite_lane") return "lane";
  if (v === "shared_lane") return "shared";
  if (/^(no|none|separate|track|opposite_track|opposite)$/.test(v)) return "no";
  return undefined;
}

/** Kerbside parking and bike lanes from a highway's OSM tags, sides relative to the way; null when it says nothing. */
export function kerbsideFromTags(tags: Record<string, string>): KerbTags | null {
  const out: KerbTags = { left: {}, right: {} };
  for (const side of ["left", "right"] as const) {
    const p = parkingSide(tags, side);
    if (p) out[side].parking = p;
    const c = cycleValue(tags[`cycleway:${side}`] ?? tags["cycleway:both"]);
    if (c) out[side].cycle = c;
  }
  // Plain cycleway=*: both sides, or on a one-way street the side its traffic keeps to (left).
  const plain = cycleValue(tags.cycleway);
  if (plain && !out.left.cycle && !out.right.cycle) {
    const ow = tags.oneway === "yes" || tags.oneway === "1" ? 1 : tags.oneway === "-1" ? -1 : 0;
    if (ow >= 0) out.left.cycle = plain;
    if (ow <= 0) out.right.cycle = plain;
    if (ow !== 0 && plain === "lane") out[ow > 0 ? "right" : "left"].cycle = "no";
  }
  const said = (s: KerbSide) => s.parking !== undefined || s.cycle !== undefined;
  return said(out.left) || said(out.right) ? out : null;
}

/* ---------------- fitting to the asphalt ---------------- */

export interface SideLayout {
  park?: ParkingKind;
  /** Bay depth out from the kerb (0 without parking). */
  depth: number;
  bike?: "lane" | "shared";
  /** Bike lane width (0 without one). */
  bikeW: number;
}

/**
 * What fits on a street `width` wide: its traffic lanes (one 3 m lane one-way, two 2.8 m lanes
 * otherwise) come first. Parallel bays narrow to 1.8 m, then parking goes, then bike lanes narrow
 * to 1.2 m, then they go. Shared-lane symbols take no width.
 */
export function fitKerbside(width: number, left: KerbSide, right: KerbSide, oneway = false): { left: SideLayout; right: SideLayout } {
  const make = (s: KerbSide): SideLayout => {
    const park = s.parking && s.parking !== "no" ? s.parking : undefined;
    const bike = s.cycle && s.cycle !== "no" ? s.cycle : undefined;
    return { park, depth: park ? BAY_DEPTH[park] : 0, bike, bikeW: bike === "lane" ? BIKE : 0 };
  };
  const l = make(left), r = make(right);
  const avail = width - (oneway ? 3 : 5.6);
  const total = () => l.depth + l.bikeW + r.depth + r.bikeW - 1e-6;
  const each = (f: (s: SideLayout) => void) => { f(l); f(r); };
  if (total() > avail) each((s) => { if (s.park === "parallel") s.depth = PARALLEL_MIN; });
  if (total() > avail) each((s) => { s.park = undefined; s.depth = 0; });
  if (total() > avail) each((s) => { if (s.bikeW) s.bikeW = BIKE_MIN; });
  if (total() > avail) each((s) => { if (s.bike === "lane") { s.bike = undefined; s.bikeW = 0; } });
  return { left: l, right: r };
}

/* ---------------- geometry helpers ---------------- */

/**
 * Height on a draped ribbon (sideStreets.ts buildSideStreets: two vertices per point, left edge
 * first, quads split left_k - right_k+1): exact on its triangles, from each point's edge heights.
 */
export function ribbonZ(zLeft: number[], zRight: number[], widths: number[]): (u: number, t: number) => number {
  const n = zLeft.length;
  return (u, t) => {
    const k = Math.max(0, Math.min(n - 2, Math.floor(u)));
    if (n < 2) return (zLeft[0] + zRight[0]) / 2;
    const f = Math.max(0, Math.min(1, u - k));
    const w = widths[k] + (widths[k + 1] - widths[k]) * f;
    const v = Math.max(0, Math.min(1, (w / 2 - t) / w));
    const zp = zLeft[k], zp1 = zRight[k], zq = zLeft[k + 1], zq1 = zRight[k + 1];
    return f <= v ? zp + v * (zp1 - zp) + f * (zq1 - zp1) : zp + f * (zq - zp) + v * (zq1 - zq);
  };
}

/** Grid hash of polyline segments for nearest-line lookups. */
class SegGrid {
  private cells = new Map<string, [number, number][]>();
  constructor(readonly lines: Vec2[][], private readonly cell = 25) {
    lines.forEach((pts, id) => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        for (let x = Math.floor(Math.min(a[0], b[0]) / cell); x <= Math.floor(Math.max(a[0], b[0]) / cell); x++) {
          for (let y = Math.floor(Math.min(a[1], b[1]) / cell); y <= Math.floor(Math.max(a[1], b[1]) / cell); y++) {
            const key = x + "," + y;
            if (!this.cells.has(key)) this.cells.set(key, []);
            this.cells.get(key)!.push([id, i - 1]);
          }
        }
      }
    });
  }

  /** Segments within r of (x, y): line id, segment index, fraction along it, distance, and the segment's unit direction. */
  near(x: number, y: number, r: number): { id: number; seg: number; f: number; dist: number; dir: Vec2; t: number }[] {
    const out: { id: number; seg: number; f: number; dist: number; dir: Vec2; t: number }[] = [];
    const seen = new Set<string>();
    const c = this.cell;
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++) {
      for (let cy = Math.floor((y - r) / c); cy <= Math.floor((y + r) / c); cy++) {
        for (const [id, seg] of this.cells.get(cx + "," + cy) ?? []) {
          const key = id + ":" + seg;
          if (seen.has(key)) continue;
          seen.add(key);
          const a = this.lines[id][seg], b = this.lines[id][seg + 1];
          const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
          const f = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (L * L)));
          const px = a[0] + dx * f, py = a[1] + dy * f;
          const dist = Math.hypot(x - px, y - py);
          if (dist <= r) out.push({ id, seg, f, dist, dir: [dx / L, dy / L], t: (dx * (y - a[1]) - dy * (x - a[0])) / L });
        }
      }
    }
    return out.sort((p, q) => p.dist - q.dist);
  }
}

/** Distance along, left normals and a frame at any distance for one carriageway. */
function frameOf(cw: Carriageway) {
  const { pts, widths } = cw;
  const n = pts.length;
  const cum = [0];
  for (let k = 1; k < n; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const tangents: Vec2[] = pts.map((_, k) => {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  });
  const lefts: Vec2[] = cw.lefts ?? tangents.map(([x, y]) => [-y, x]);
  const length = cum[n - 1];
  const at = (s: number) => {
    const sc = Math.max(0, Math.min(length, s));
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= sc) lo = mid;
      else hi = mid;
    }
    const k = Math.min(lo, n - 2);
    const seg = cum[k + 1] - cum[k];
    const f = seg > 1e-9 ? Math.max(0, Math.min(1, (sc - cum[k]) / seg)) : 0;
    const mix = (p: Vec2, q: Vec2): Vec2 => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
    return { u: k + f, pos: mix(pts[k], pts[k + 1]), left: mix(lefts[k], lefts[k + 1]), half: (widths[k] + (widths[k + 1] - widths[k]) * f) / 2 };
  };
  return { cum, tangents, lefts, length, at };
}

/* ---------------- painting ---------------- */

/**
 * Kerbside parking bays and bike lanes on these streets. `ways` carry the OSM tags; `cars` are the
 * parked cars found in the photo (local metres), used where OSM says nothing about parking.
 */
export function buildKerbside(
  streets: Carriageway[],
  ways: KerbsideWay[],
  cars: { at: Vec2; dir: Vec2 }[] = [],
  blocked: (x: number, y: number) => boolean = () => false,
): KerbsideResult {
  // Bay lines and bike lane paint apart (KERBSIDE_BAY_* and KERBSIDE_*), so a check can tell bays from bike lanes.
  const bayPaint = new ChunkedMesh(0), bikePaint = new ChunkedMesh(0);
  let paint = bikePaint;
  const result: KerbsideResult = { nodes: [], slots: [], boxes: [], bays: 0, bikeLaneMetres: 0, symbols: 0 };
  const cwGrid = new SegGrid(streets.map((c) => c.pts));
  const wayGrid = new SegGrid(ways.map((w) => w.pts));
  const frames = streets.map(frameOf);

  // Photo parked cars along a kerb, per street and side, by distance along it.
  const carsAt = streets.map(() => ({ left: [] as number[], right: [] as number[] }));
  for (const car of cars) {
    const hit = cwGrid.near(car.at[0], car.at[1], 9).find((h) => streets[h.id].photoParking && streets[h.id].pts.length > 1);
    if (!hit) continue;
    const cw = streets[hit.id], fr = frames[hit.id];
    const half = (cw.widths[hit.seg] + (cw.widths[hit.seg + 1] - cw.widths[hit.seg]) * hit.f) / 2;
    // On the carriageway along the kerb: a parallel-parked car's middle is about a metre in from the
    // kerb. Not out on the verge or footpath (a footpath strip beside the kerb isn't parking).
    const off = Math.abs(hit.t);
    if (off < half - 2.6 || off > half + 0.6) continue;
    if (Math.abs(car.dir[0] * hit.dir[0] + car.dir[1] * hit.dir[1]) < 0.85) continue;
    const s = fr.cum[hit.seg] + (fr.cum[hit.seg + 1] - fr.cum[hit.seg]) * hit.f;
    carsAt[hit.id][hit.t >= 0 ? "left" : "right"].push(s);
  }
  /** Stretches with two or more cars no more than 16 m apart, 4 m beyond the end cars. */
  const carRuns = (ss: number[]): [number, number][] => {
    const sorted = ss.slice().sort((a, b) => a - b);
    const out: [number, number][] = [];
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] - sorted[j] <= 16) j++;
      if (j > i) out.push([sorted[i] - 4, sorted[j] + 4]);
      i = j + 1;
    }
    return out;
  };

  streets.forEach((cw, id) => {
    const n = cw.pts.length;
    if (n < 2) return;
    const fr = frames[id];
    // Tags per point from the nearest roughly parallel OSM way, sides turned to this line's direction.
    const sides: KerbTags[] = cw.pts.map((p, k) => {
      const d = fr.tangents[k];
      const hit = wayGrid.near(p[0], p[1], 8).find((h) => Math.abs(h.dir[0] * d[0] + h.dir[1] * d[1]) > 0.7);
      if (!hit) return { left: {}, right: {} };
      const w = ways[hit.id];
      const same = hit.dir[0] * d[0] + hit.dir[1] * d[1] > 0;
      return same ? { left: { ...w.left }, right: { ...w.right } } : { left: { ...w.right }, right: { ...w.left } };
    });
    const fromPhoto = cw.pts.map(() => ({ left: false, right: false }));
    for (const side of ["left", "right"] as const) {
      for (const [a, b] of carRuns(carsAt[id][side])) {
        cw.pts.forEach((_, k) => {
          if (fr.cum[k] >= a && fr.cum[k] <= b && sides[k][side].parking === undefined) {
            sides[k][side].parking = "parallel";
            fromPhoto[k][side] = true;
          }
        });
      }
    }
    const layout = sides.map((s, k) => fitKerbside(cw.widths[k], s.left, s.right, cw.oneway));
    /** Clear to paint at this point on this side: away from other streets and anything the caller rules out. */
    const clear = cw.pts.map((p, k) => {
      const out = { left: true, right: true };
      for (const side of ["left", "right"] as const) {
        const sg = side === "left" ? 1 : -1;
        const L = layout[k][side];
        const reach = Math.max(L.depth + L.bikeW, 1.2);
        for (const off of [KERB_IN, reach]) {
          const t = sg * (cw.widths[k] / 2 - off);
          const x = p[0] + fr.lefts[k][0] * t, y = p[1] + fr.lefts[k][1] * t;
          if (blocked(x, y)) out[side] = false;
          for (const h of cwGrid.near(x, y, 20)) {
            if (h.id === id) continue;
            const o = streets[h.id];
            const halfO = (o.widths[h.seg] + (o.widths[h.seg + 1] - o.widths[h.seg]) * h.f) / 2;
            if (h.dist < halfO + JUNCTION_GAP) {
              out[side] = false;
              break;
            }
          }
        }
      }
      return out;
    });

    /** Point runs [k0, k1] where `on(k)` holds, as distances along. */
    const runs = (on: (k: number) => boolean, minLen: number): [number, number][] => {
      const out: [number, number][] = [];
      let start = -1;
      for (let k = 0; k <= n; k++) {
        const ok = k < n && on(k);
        if (ok && start < 0) start = k;
        if (!ok && start >= 0) {
          const a = fr.cum[start], b = fr.cum[k - 1];
          if (b - a >= minLen) out.push([a, b]);
          start = -1;
        }
      }
      return out;
    };
    /** A per-point value at distance s, linearly between points. */
    const valueAt = (vals: number[], s: number) => {
      const u = fr.at(s).u, k = Math.min(n - 2, Math.floor(u)), f = u - k;
      return vals[k] + (vals[k + 1] - vals[k]) * f;
    };

    const put = (mb: MeshBuilder, s: number, t: number) => {
      const f = fr.at(s);
      mb.vertex([f.pos[0] + f.left[0] * t, f.pos[1] + f.left[1] * t, cw.z(f.u, t) + LIFT], 0, 0);
      mb.normals!.push(0, 0, 1);
    };
    /** A straight stroke from (s0, t0) to (s1, t1), `w` wide, in steps of a metre or less so it follows the surface. */
    const stroke = (s0: number, t0: number, s1: number, t1: number, w = LINE, runOn = false) => {
      const L = Math.hypot(s1 - s0, t1 - t0);
      if (L < 1e-3) return;
      const ds = (s1 - s0) / L, dt = (t1 - t0) / L;
      const e = runOn ? w / 2 : 0;
      const a0 = s0 - ds * e, c0 = t0 - dt * e, a1 = s1 + ds * e, c1 = t1 + dt * e;
      const steps = Math.max(1, Math.ceil((L + 2 * e) / 1));
      const mb = paint.next((steps + 1) * 2);
      const base = mb.vertexCount;
      const ns = -dt * (w / 2), nt = ds * (w / 2);
      for (let i = 0; i <= steps; i++) {
        const s = a0 + ((a1 - a0) * i) / steps, t = c0 + ((c1 - c0) * i) / steps;
        put(mb, s + ns, t + nt);
        put(mb, s - ns, t - nt);
      }
      for (let i = 0; i < steps; i++) {
        const p = base + i * 2, q = p + 2;
        mb.quad(p, p + 1, q + 1, q);
      }
    };
    /** A line along the street from s0 to s1 at offset t(s). */
    const along = (s0: number, s1: number, t: (s: number) => number, w = LINE) => {
      const stops = [s0];
      for (let k = 0; k < n; k++) if (fr.cum[k] > s0 + 0.05 && fr.cum[k] < s1 - 0.05) stops.push(fr.cum[k]);
      stops.push(s1);
      const fine: number[] = [];
      for (let i = 0; i < stops.length - 1; i++) {
        const m = Math.max(1, Math.ceil((stops[i + 1] - stops[i]) / 1));
        for (let j = 0; j < m; j++) fine.push(stops[i] + ((stops[i + 1] - stops[i]) * j) / m);
      }
      fine.push(s1);
      const mb = paint.next(fine.length * 2);
      const base = mb.vertexCount;
      for (const s of fine) {
        put(mb, s, t(s) + w / 2);
        put(mb, s, t(s) - w / 2);
      }
      for (let i = 0; i < fine.length - 1; i++) {
        const p = base + i * 2, q = p + 2;
        mb.quad(p, p + 1, q + 1, q);
      }
    };
    /** A glyph standing up the lane for traffic on `sg`'s side, its middle at s, centred on tc, squeezed to `across` wide. */
    const glyph = (g: Glyph, s: number, tc: number, sg: 1 | -1, across: number) => {
      const wide = Math.max(...g.lines.flat().map((p) => Math.abs(p[1]))) * 2;
      const k = Math.min(1, across / wide);
      const tail = s - (sg * g.length) / 2;
      for (const line of g.lines) {
        for (let i = 0; i < line.length - 1; i++) {
          const [a0, c0] = line[i], [a1, c1] = line[i + 1];
          stroke(tail + sg * a0, tc + sg * c0 * k, tail + sg * a1, tc + sg * c1 * k, g.width, true);
        }
      }
    };

    for (const side of ["left", "right"] as const) {
      const sg = side === "left" ? 1 : -1;
      const half = (s: number) => fr.at(s).half;
      const depth = layout.map((l) => l[side].depth);
      const bikeW = layout.map((l) => l[side].bikeW);

      // Parking bays, run by run of one kind.
      paint = bayPaint;
      for (const kind of ["parallel", "diagonal", "perpendicular"] as const) {
        for (const [a, b] of runs((k) => layout[k][side].park === kind && clear[k][side], kind === "parallel" ? PARALLEL_BAY : 5)) {
          const D = (s: number) => valueAt(depth, s);
          const photo = fromPhoto[Math.min(n - 1, Math.round(fr.at((a + b) / 2).u))][side];
          /**
           * A bay's slot: its middle at (s, t), a car in it pointing along (ds, dt) in the street's frame;
           * `len` the bay's length along the kerb. Its box runs from the kerb's paint line to the bay's inner
           * line, or to the car's inner side where the car reaches further (narrowed and angle bays).
           */
          const slot = (s: number, t: number, ds: number, dt: number, len: number) => {
            const f = fr.at(s), tg: Vec2 = [f.left[1], -f.left[0]], l = Math.hypot(ds, dt) || 1;
            const at: Vec2 = [f.pos[0] + f.left[0] * t, f.pos[1] + f.left[1] * t];
            result.slots.push({
              at,
              dir: [(tg[0] * ds + f.left[0] * dt) / l, (tg[1] * ds + f.left[1] * dt) / l],
              kind, street: id, photo,
            });
            const ca = Math.abs(dt) / l, cs = Math.abs(ds) / l;
            const outer = f.half - KERB_IN;
            const inner = Math.min(f.half - D(s), Math.abs(t) - (ca * CAR_LENGTH + cs * CAR_WIDTH) / 2);
            const mid = sg * (outer + inner) / 2;
            result.boxes.push({
              c: [f.pos[0] + f.left[0] * mid, f.pos[1] + f.left[1] * mid],
              along: tg,
              halfLen: Math.max(len / 2, (cs * CAR_LENGTH + ca * CAR_WIDTH) / 2),
              halfDepth: Math.max(0, (outer - inner) / 2),
              street: id,
            });
          };
          if (kind === "parallel") {
            const bays = Math.floor((b - a) / PARALLEL_BAY);
            if (bays < 1) continue;
            const s0 = a + (b - a - bays * PARALLEL_BAY) / 2;
            for (let j = 0; j <= bays; j++) {
              const s = s0 + j * PARALLEL_BAY, h = half(s), tOut = sg * (h - D(s));
              stroke(s, sg * (h - KERB_IN), s, tOut);
              stroke(s - 0.5, tOut, s + 0.5, tOut);
              // Traffic keeps left: a car on the left (+) side points along the line, on the right against it.
              if (j < bays) { const sm = s + PARALLEL_BAY / 2, hm = half(sm); slot(sm, sg * (hm - KERB_IN - D(sm) / 2), sg, 0, PARALLEL_BAY); }
            }
            result.bays += bays;
          } else {
            const spacing = kind === "diagonal" ? DIAGONAL_BAY : PERP_BAY;
            // Angle bays lean so a car turns into them from its own side's traffic: kerb end further along.
            const lean = (s: number) => (kind === "diagonal" ? D(s) - KERB_IN : 0);
            const lo = sg > 0 ? a + lean(a) : a, hi = sg > 0 ? b : b - lean(b);
            const lines = Math.floor((hi - lo) / spacing);
            if (lines < 1) continue;
            const s0 = lo + (hi - lo - lines * spacing) / 2;
            for (let j = 0; j <= lines; j++) {
              const s = s0 + j * spacing, h = half(s);
              stroke(s, sg * (h - KERB_IN), s - sg * lean(s), sg * (h - D(s)));
              // The bay between this line and the next: nose in, along its lines towards the kerb.
              if (j < lines) {
                const sm = s + spacing / 2, hm = half(sm), Lm = lean(sm), Dm = D(sm);
                slot(sm - (sg * Lm) / 2, sg * (hm - KERB_IN - (Dm - KERB_IN) / 2), sg * Lm, sg * (Dm - KERB_IN), spacing + Lm);
              }
            }
            const sN = s0 + lines * spacing;
            const outA = s0 - sg * lean(s0), outB = sN - sg * lean(sN);
            along(Math.max(a, Math.min(outA, outB)), Math.min(b, Math.max(outA, outB)), (s) => sg * (half(s) - D(s)));
            result.bays += lines;
          }
        }
      }

      // Bike lanes: the line between the lane and the traffic, and the symbols.
      paint = bikePaint;
      const bicycle = symbolGlyph("bicycle")!;
      for (const [a, b] of runs((k) => layout[k][side].bike === "lane" && clear[k][side], 15)) {
        along(a, b, (s) => sg * (half(s) - valueAt(depth, s) - valueAt(bikeW, s)));
        result.bikeLaneMetres += b - a;
        for (let s = a + 8 + bicycle.length / 2; s < b - bicycle.length / 2; s += SYMBOL_EVERY) {
          const B = valueAt(bikeW, s);
          glyph(bicycle, s, sg * (half(s) - valueAt(depth, s) - B / 2), sg, B - 0.3);
          result.symbols++;
        }
      }
      for (const [a, b] of runs((k) => layout[k][side].bike === "shared" && clear[k][side], 15)) {
        for (let s = a + 8 + bicycle.length / 2; s < b - bicycle.length / 2; s += SYMBOL_EVERY) {
          const t = Math.max(1, half(s) - valueAt(depth, s) - 1.2);
          glyph(bicycle, s, sg * t, sg, 1.24);
          result.symbols++;
        }
      }
    }
  });
  result.nodes = [
    ...bayPaint.all().map((m, i) => m.toKn5(`KERBSIDE_BAY_${pad(i)}`, "paint", { castShadows: false })),
    ...bikePaint.all().map((m, i) => m.toKn5(`KERBSIDE_${pad(i)}`, "paint", { castShadows: false })),
  ];
  return result;
}

/* ---------------- the track's hook ---------------- */

/**
 * The route and the side streets as carriageways on their drawn surfaces (the route's crowned
 * road, the streets' draped ribbons, densified as buildSideStreets does), painted from the OSM
 * ways and the photo's parked cars. Nothing inside a roundabout or within 6 m of its ring.
 */
export function kerbsideForTrack(
  plan: RoadPlan,
  streets: SideStreet[],
  index: SegmentIndex,
  opts: BuildOptions,
  ground: HeightFn,
  ways: ({ pts: LngLat[] } & KerbTags)[],
  toLocal: (p: LngLat) => Vec2,
  cars: { at: Vec2; dir: Vec2 }[],
): KerbsideResult {
  const smp = plan.samples;
  // A loop comes round to its start again so the last stretch is painted too.
  const order = plan.closed && smp.length > 2 ? [...smp, smp[0]] : smp;
  const route: Carriageway = {
    pts: order.map((p) => p.pos),
    widths: order.map((p) => p.width),
    lefts: order.map((p) => p.left),
    z: (u, t) => {
      const k = Math.max(0, Math.min(order.length - 2, Math.floor(u))), f = u - k;
      const a = surfaceHeight(order[k], t, opts.crown), b = surfaceHeight(order[k + 1], t, opts.crown);
      return a + (b - a) * f;
    },
    photoParking: true,
  };
  const surface = streetSurface(plan, index, opts, ground);
  const side: Carriageway[] = streets
    .filter((st) => !/^(service|track|path|footway|cycleway)/.test(st.cls) && st.pts.length > 1)
    .map((st0) => {
      const st = densifyStreet(st0, ground);
      const widths = st.pts.map((_, k) => st.widths?.[k] ?? st.width);
      const zl = st.pts.map((_, k) => surface(st, k, widths[k] / 2));
      const zr = st.pts.map((_, k) => surface(st, k, -widths[k] / 2));
      return { pts: st.pts, widths, z: ribbonZ(zl, zr, widths), oneway: !!st.oneway, photoParking: true };
    });
  const nearRing = (x: number, y: number) => plan.roundabouts.some((rb) => Math.hypot(x - rb.c[0], y - rb.c[1]) < outerRadius(rb) + 6);
  return buildKerbside(
    [route, ...side],
    ways.map((w) => ({ pts: w.pts.map(toLocal), left: w.left, right: w.right })),
    cars,
    nearRing,
  );
}
