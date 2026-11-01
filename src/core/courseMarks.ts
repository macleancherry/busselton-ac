// Busselton fork: course markings on the race layouts (docs/plans/course-markings.md).
//
// In a race layout it's hard to tell which way the course goes at each junction and roundabout. This
// lays low-key event dressing along the layout's own AI line, into the layout's own kn5 (the one
// that holds its dummies, listed in models_<id>.ini), so free roam and the world never get it:
//   - every side-street mouth and roundabout exit the course passes but doesn't take: a red-white
//     ripple strip across the mouth, in line with the course's kerb, with a rumble surface
//     (`1RIPPLE_...`, key RIPPLE); a line of low red-white water-filled barriers about 3.5 m back
//     (visual only, no collision); and between them, invisible, a patch of `1CLOSED_...` (key
//     CLOSED, IS_VALID_TRACK=0) a little above the street, so driving into the closed street is a
//     cut for that layout only;
//   - car park entries and driveways: the strip and the patch, no barriers.
//
// Valid track per layout: AC decides it per surface, from the `IS_VALID_TRACK` of the surface whose
// KEY the physics mesh's name carries after its digit ("Invalid surfaces will trigger the penalty
// system", https://www.sites.google.com/site/hagn99/assettocorsa/modding/tracks/data/surfaces-ini).
// A layout loads its own models_<id>.ini (the shared kn5 plus the layout's kn5) and its own
// <id>/data folder ("the usual folders & files: data, ai, etc.",
// https://assettocorsamods.net/goto/post?id=21926), so a physics mesh in layout_<id>.kn5 with a key
// only that layout's data/surfaces.ini declares changes that layout alone. The world's STREET stays
// valid (streetsValid in an area build), and the wheel rays meet the CLOSED patch first because it
// lies 1.2 cm above the street.
//
// Frame: local ENU metres (x east, y north, z up); AC is (x, z, -y) (mesh.ts toAc).

import type { AiPoint } from "./aiSpline";
import { readFastLaneAi } from "./aiSpline";
import type { WorldRing } from "./aiRings";
import type { BayBox } from "./bayLanes";
import { TRAFFIC_READY_TAG } from "./acFiles";
import { readKn5, writeKn5, type Kn5GroupNode, type Kn5Material, type Kn5MeshNode, type Kn5Model, type Kn5Node, type Kn5Texture } from "./kn5";
import { material } from "./materials";
import { MeshBuilder } from "./mesh";
import { ChunkedMesh } from "./meshKit";
import { solidTexture } from "./textures";

type Vec2 = [number, number];
type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------------------------
// The option

/** `courseMarks` (options.ts): on for race layouts only, never free roam. */
export type CourseMarksOption = boolean | {
  /** Water-filled barrier lines behind the strips; on unless false. */
  barriers?: boolean;
  /** Chevron boards (roundabout islands, the straight-on branch at turns); on unless false. */
  chevrons?: boolean;
  /** Arrow boards 60 to 80 m before each turn; on unless false. */
  arrows?: boolean;
  /** Grid boxes, start line and the START FINISH arch; on unless false. */
  start?: boolean;
  /** Barriers as low walls (`1WALL_`) instead of visual only; off unless true. */
  solid?: boolean;
};

export interface CourseMarksSettings { barriers: boolean; chevrons: boolean; arrows: boolean; start: boolean; solid: boolean }

/** The option as settings, or null when off. */
export function courseMarksSettings(opt: CourseMarksOption | undefined): CourseMarksSettings | null {
  if (!opt) return null;
  const o = opt === true ? {} : opt;
  return { barriers: o.barriers !== false, chevrons: o.chevrons !== false, arrows: o.arrows !== false, start: o.start !== false, solid: o.solid === true };
}

// ---------------------------------------------------------------------------------------------
// Sizes (the plan's table)

export const STRIP_WIDTH = 0.6;
export const STRIP_HEIGHT = 0.04;
export const STRIP_BAND = 1.0;
/** Barrier line: this far behind the course's kerb line. */
export const BARRIER_BACK = 3.5;
export const BARRIER_LENGTH = 1.6;
export const BARRIER_GAP = 0.08;
/** The CLOSED patch: from the back of the strip to this far behind the kerb line, this far above the street. */
export const CLOSED_DEPTH = 7;
export const CLOSED_LIFT = 0.012;
/** A course turn: the heading changes more than this within TURN_WINDOW either side. */
export const TURN_ANGLE = 45;
const TURN_WINDOW = 20;

/** Strip profile, across the strip (0 = the kerb line, + into the mouth) and up: 60 cm wide, 4 cm high. */
const STRIP_PROFILE: Vec2[] = [[0, 0], [0.6, 0], [0.6, 0.012], [0.45, 0.04], [0.15, 0.04], [0, 0.012]];
/** Water-filled barrier profile: 40 cm base, 55 cm high. */
const BARRIER_PROFILE: Vec2[] = [[-0.2, 0], [0.2, 0], [0.2, 0.08], [0.1, 0.55], [-0.1, 0.55], [-0.2, 0.08]];

export const COLOURS = {
  red: [200, 20, 20] as const,
  white: [236, 236, 230] as const,
  black: [24, 24, 24] as const,
  grey: [90, 90, 92] as const,
};
export type Paint = keyof typeof COLOURS;

// ---------------------------------------------------------------------------------------------
// The world's surface: height and kind of the highest physics surface at a point

export type SurfaceKind = "road" | "kerb" | "path" | "grass" | "other";
export type SurfaceProbe = (x: number, y: number) => { h: number; kind: SurfaceKind } | null;

/** What a world physics mesh is, by name; null for walls, terrain and anything not physics. */
export function surfaceKind(name: string): SurfaceKind | null {
  if (!/^\d/.test(name) || /^\dWALL/.test(name) || /^\dGRASS_t/.test(name)) return null;
  if (/PATH/.test(name)) return "path";
  if (/^\d(ROAD|STREET|UNSEALED|UNPAVED)/.test(name)) return "road";
  if (/^\dKERB/.test(name)) return "kerb";
  if (/^\dGRASS/.test(name)) return "grass";
  return "other";
}

const KINDS: SurfaceKind[] = ["road", "kerb", "path", "grass", "other"];

/** A probe over a model's physics meshes (not walls or terrain), by a 4 m grid of their triangles. */
export function surfaceProbe(model: Kn5Model): SurfaceProbe {
  const CELL = 4;
  const tri: number[] = []; // x0 z0 y0 x1 z1 y1 x2 z2 y2 kind (AC x, AC z, height)
  const grid = new Map<number, number[]>();
  const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
  const walk = (n: Kn5Node) => {
    if (n.kind === "node") return n.children.forEach(walk);
    const kind = surfaceKind(n.name);
    if (kind === null) return;
    const k = KINDS.indexOf(kind);
    const p = n.positions, ix = n.indices;
    for (let i = 0; i < ix.length; i += 3) {
      const t = tri.length / 10;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let c = 0; c < 3; c++) {
        const v = ix[i + c] * 3;
        tri.push(p[v], p[v + 2], p[v + 1]);
        x0 = Math.min(x0, p[v]); x1 = Math.max(x1, p[v]);
        z0 = Math.min(z0, p[v + 2]); z1 = Math.max(z1, p[v + 2]);
      }
      tri.push(k);
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
          const list = grid.get(key(cx, cz));
          if (list) list.push(t); else grid.set(key(cx, cz), [t]);
        }
      }
    }
  };
  walk(model.root);
  const tris = Float32Array.from(tri);
  return (x, y) => {
    const z = -y;
    let best = -Infinity, kind = -1;
    for (const t of grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      const o = t * 10;
      const ax = tris[o], az = tris[o + 1], bx = tris[o + 3], bz = tris[o + 4], cx = tris[o + 6], cz = tris[o + 7];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const h = u * tris[o + 2] + v * tris[o + 5] + w * tris[o + 8];
      if (h > best) { best = h; kind = tris[o + 9]; }
    }
    return kind < 0 ? null : { h: best, kind: KINDS[kind] };
  };
}

const isRoad = (probe: SurfaceProbe, p: Vec2) => probe(p[0], p[1])?.kind === "road";

// ---------------------------------------------------------------------------------------------
// The course: the layout's AI line in local metres

const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const len = (a: Vec2) => Math.hypot(a[0], a[1]);
const unit = (a: Vec2): Vec2 => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Left of a direction (ENU, counter-clockwise). */
const leftOf = (d: Vec2): Vec2 => [-d[1], d[0]];

export interface Course {
  p: Vec2[];
  h: number[];
  /** Unit direction of travel at each point. */
  t: Vec2[];
  /** Distance along at each point. */
  s: number[];
  total: number;
  closed: boolean;
}

export function courseOf(ai: AiPoint[], closed?: boolean): Course {
  const p = ai.map((a): Vec2 => [a.position[0], -a.position[2]]);
  const h = ai.map((a) => a.position[1]);
  const n = p.length;
  const isClosed = closed ?? (n > 2 && dist(p[0], p[n - 1]) < 50);
  const t = p.map((_, i): Vec2 => {
    const a = p[i > 0 ? i - 1 : isClosed ? n - 1 : 0], b = p[i < n - 1 ? i + 1 : isClosed ? 0 : n - 1];
    return unit(sub(b, a));
  });
  const s: number[] = [];
  let d = 0;
  p.forEach((q, i) => { s.push(d); if (i < n - 1) d += dist(q, p[i + 1]); });
  return { p, h, t, s, total: d + (isClosed && n > 1 ? dist(p[n - 1], p[0]) : 0), closed: isClosed };
}

/** Signed distance along the course from i to j (shortest way round on a closed course). */
function along(c: Course, i: number, j: number): number {
  let d = c.s[j] - c.s[i];
  if (c.closed) { if (d > c.total / 2) d -= c.total; if (d < -c.total / 2) d += c.total; }
  return d;
}

/** The point index `ds` metres along from i (clamped on an open course). */
function stepAlong(c: Course, i: number, ds: number): number {
  const n = c.p.length;
  let target = c.s[i] + ds;
  if (c.closed) target = ((target % c.total) + c.total) % c.total;
  else target = Math.max(0, Math.min(c.s[n - 1], target));
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c.s[m] <= target) lo = m; else hi = m - 1; }
  return lo;
}

/** Nearest point of the course to a point, by a grid of its segments. */
class CourseGrid {
  private grid = new Map<number, number[]>();
  constructor(private c: Course, private cell = 10) {
    const n = c.p.length, segs = c.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = c.p[i], b = c.p[(i + 1) % n];
      for (let cx = Math.floor(Math.min(a[0], b[0]) / cell); cx <= Math.floor(Math.max(a[0], b[0]) / cell); cx++) {
        for (let cy = Math.floor(Math.min(a[1], b[1]) / cell); cy <= Math.floor(Math.max(a[1], b[1]) / cell); cy++) {
          const k = (cx + 32768) * 65536 + cy + 32768;
          const l = this.grid.get(k);
          if (l) l.push(i); else this.grid.set(k, [i]);
        }
      }
    }
  }

  /** Every segment within `reach` of q: index, distance, side (+1 left of travel, -1 right). */
  within(q: Vec2, reach: number): { i: number; d: number; side: number; at: Vec2 }[] {
    const out: { i: number; d: number; side: number; at: Vec2 }[] = [];
    const seen = new Set<number>();
    const n = this.c.p.length;
    for (let cx = Math.floor((q[0] - reach) / this.cell); cx <= Math.floor((q[0] + reach) / this.cell); cx++) {
      for (let cy = Math.floor((q[1] - reach) / this.cell); cy <= Math.floor((q[1] + reach) / this.cell); cy++) {
        for (const i of this.grid.get((cx + 32768) * 65536 + cy + 32768) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const a = this.c.p[i], b = this.c.p[(i + 1) % n], ab = sub(b, a);
          const L2 = dot(ab, ab);
          const u = L2 > 0 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / L2)) : 0;
          const at = add(a, mul(ab, u));
          const d = dist(q, at);
          if (d <= reach) out.push({ i: u > 0.5 ? (i + 1) % n : i, d, side: cross(ab, sub(q, a)) >= 0 ? 1 : -1, at });
        }
      }
    }
    return out;
  }

  nearest(q: Vec2, reach: number) {
    let best: { i: number; d: number; side: number; at: Vec2 } | null = null;
    for (const w of this.within(q, reach)) if (!best || w.d < best.d) best = w;
    return best;
  }
}

/**
 * The course's kerb lines: distance from the AI line to the edge of the carriageway on each side,
 * measured on the world's surface (it stops at the first half metre that isn't road), then the median
 * over 25 m, so a mouth or a seam doesn't move the line. `raw` keeps the measured values.
 */
export function courseEdges(c: Course, probe: SurfaceProbe, cap = 16): { left: number[]; right: number[]; rawLeft: number[]; rawRight: number[] } {
  const measure = (i: number, side: number) => {
    const nrm = mul(leftOf(c.t[i]), side);
    let miss = 0, last = 0;
    for (let r = 0.25; r <= cap; r += 0.25) {
      if (isRoad(probe, add(c.p[i], mul(nrm, r)))) { last = r; miss = 0; }
      else if (++miss >= 2) break;
    }
    return Math.max(0.5, last);
  };
  const rawLeft = c.p.map((_, i) => measure(i, 1));
  const rawRight = c.p.map((_, i) => measure(i, -1));
  const n = c.p.length;
  const spacing = n > 1 ? c.total / n : 1;
  const k = Math.max(1, Math.round(12.5 / spacing));
  const median = (raw: number[]) => raw.map((_, i) => {
    const w: number[] = [];
    for (let j = i - k; j <= i + k; j++) {
      if (c.closed) w.push(raw[((j % n) + n) % n]);
      else if (j >= 0 && j < n) w.push(raw[j]);
    }
    w.sort((a, b) => a - b);
    return w[w.length >> 1];
  });
  return { left: median(rawLeft), right: median(rawRight), rawLeft, rawRight };
}

// ---------------------------------------------------------------------------------------------
// Finding the mouths

export type MouthKind = "side" | "turn" | "ring" | "entry";

export interface Mouth {
  kind: MouthKind;
  /** Where the closed branch leaves the course's kerb line (or the ring's edge), local metres. */
  at: Vec2;
  /** Unit direction into the closed branch. */
  dir: Vec2;
  /** The strip: its kerb-side line, from one side of the mouth to the other, local metres. */
  strip: Vec2[];
  /** Distances along the course the mouth spans (street mouths and entries). */
  span?: [number, number];
  /** Barrier line ends (none for car park entries and driveways). */
  barrier?: [Vec2, Vec2];
  /** Course point nearest the mouth. */
  i: number;
  /** +1 left of the course, -1 right (0 on a ring). */
  side: number;
  /** For the straight-on branch at a course turn: the way the course turns. */
  turn?: "left" | "right";
  /** World line index (street mouths) or ring index (ring exits). */
  line?: number;
  ring?: number;
  /** A ring arm no street explains (car park, driveway): strip only, like an entry. */
  minor?: boolean;
}

export interface CourseTurn {
  /** Course point at the middle of the turn. */
  i: number;
  dir: "left" | "right";
  /** Heading change, degrees (+ left). */
  angle: number;
  /** Index of the ring the turn is made on, if any. */
  ring?: number;
  /** Course point where the turn starts (the ring's entry, or the junction's approach). */
  from: number;
}

export interface CourseRing {
  ring: number;
  c: Vec2;
  rOut: number;
  rIn: number;
  /** Course legs: unit direction from the centre, and whether the course comes in or goes out there. */
  legs: { dir: Vec2; entry: boolean; i: number }[];
}

export interface CourseLayoutInput {
  ai: AiPoint[];
  closed?: boolean;
  lines: Vec2[][];
  rings: WorldRing[];
  probe: SurfaceProbe;
  bays?: BayBox[];
  /** The layout's dummies (AC_START_n, AC_TIME_0_L/R), for the grid and the start. */
  dummies?: Kn5GroupNode[];
}

const signedAngle = (a: Vec2, b: Vec2) => Math.atan2(cross(a, b), dot(a, b)) * 180 / Math.PI;

/** The rings the course drives round, with the legs it comes in and goes out by. */
export function courseRings(c: Course, rings: WorldRing[]): CourseRing[] {
  const out: CourseRing[] = [];
  const n = c.p.length;
  rings.forEach((r, k) => {
    const d = c.p.map((p) => dist(p, r.c));
    if (!d.some((x) => x < r.rOut)) return;
    // Runs of points in the leg band, outside the ring.
    const band = d.map((x) => x > r.rOut + 4 && x < r.rOut + 14);
    const runs: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      if (!band[i]) continue;
      const last = runs[runs.length - 1];
      if (last && last[1] === i - 1) last[1] = i; else runs.push([i, i]);
    }
    if (c.closed && runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][1] === n - 1) {
      const last = runs.pop()!;
      runs[0] = [last[0], runs[0][1] + n];
    }
    const legs = runs.map(([a, b]) => {
      let sx = 0, sy = 0;
      for (let j = a; j <= b; j++) { const q = sub(c.p[j % n], r.c); const l = len(q) || 1; sx += q[0] / l; sy += q[1] / l; }
      // Coming in when the points after the run are nearer the centre.
      const after = c.p[(b + 1) % n], before = c.p[(a - 1 + n) % n];
      const entry = (c.closed || b + 1 < n ? dist(after, r.c) : Infinity) < (c.closed || a > 0 ? dist(before, r.c) : Infinity);
      return { dir: unit([sx, sy]), entry, i: entry ? b % n : a % n };
    });
    out.push({ ring: k, c: r.c, rOut: r.rOut, rIn: r.rIn ?? Math.max(0, r.rOut - 7), legs });
  });
  return out;
}

/** The course's turns of more than TURN_ANGLE: at junctions, and through rings (entry leg to exit leg). */
export function courseTurns(c: Course, rings: CourseRing[]): CourseTurn[] {
  const out: CourseTurn[] = [];
  const n = c.p.length;
  const nearRing = (p: Vec2) => rings.findIndex((r) => dist(p, r.c) < r.rOut + 15);
  // Junction turns: the heading TURN_WINDOW before against TURN_WINDOW after.
  const delta = c.p.map((_, i) => {
    if (!c.closed && (c.s[i] < TURN_WINDOW || c.s[i] > c.total - TURN_WINDOW)) return 0;
    return signedAngle(c.t[stepAlong(c, i, -TURN_WINDOW)], c.t[stepAlong(c, i, TURN_WINDOW)]);
  });
  let i = 0;
  while (i < n) {
    if (Math.abs(delta[i]) <= TURN_ANGLE || nearRing(c.p[i]) >= 0) { i++; continue; }
    let j = i, best = i;
    while (j + 1 < n && Math.abs(delta[j + 1]) > TURN_ANGLE && Math.sign(delta[j + 1]) === Math.sign(delta[i])) {
      j++;
      if (Math.abs(delta[j]) > Math.abs(delta[best])) best = j;
    }
    out.push({ i: best, dir: delta[best] > 0 ? "left" : "right", angle: delta[best], from: stepAlong(c, best, -10) });
    i = j + 1;
  }
  // Ring turns: from each entry leg to the next exit leg along the course.
  for (const r of rings) {
    for (const e of r.legs.filter((l) => l.entry)) {
      const exits = r.legs.filter((l) => !l.entry).map((l) => ({ l, ds: ((c.s[l.i] - c.s[e.i]) % c.total + c.total) % c.total }));
      const x = exits.sort((a, b) => a.ds - b.ds)[0];
      if (!x || x.ds > 4 * Math.PI * r.rOut + 40) continue;
      const angle = signedAngle(mul(e.dir, -1), x.l.dir);
      if (Math.abs(angle) > TURN_ANGLE) out.push({ i: e.i, dir: angle > 0 ? "left" : "right", angle, ring: r.ring, from: e.i });
    }
  }
  return out.sort((a, b) => a.i - b.i);
}

/** Densifies a polyline to at most `step` metres between points. */
function densify(pts: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [];
  pts.forEach((p, k) => {
    if (k) {
      const q = pts[k - 1], m = Math.ceil(dist(p, q) / step);
      for (let j = 1; j < m; j++) out.push(add(q, mul(sub(p, q), j / m)));
    }
    out.push(p);
  });
  return out;
}

/** The point `off` metres out from the kerb line on `side`, at distance s along the course (between its points). */
function kerbPoint(c: Course, edges: number[], s: number, side: number, off: number): Vec2 {
  const n = c.p.length;
  let x = s;
  if (c.closed) x = ((x % c.total) + c.total) % c.total;
  else x = Math.max(0, Math.min(c.s[n - 1], x));
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c.s[m] <= x) lo = m; else hi = m - 1; }
  const j = (lo + 1) % n;
  const seg = j === 0 ? c.total - c.s[lo] : c.s[j] - c.s[lo];
  const f = seg > 0 && (c.closed || lo < n - 1) ? (x - c.s[lo]) / seg : 0;
  const p = add(c.p[lo], mul(sub(c.p[j], c.p[lo]), f));
  const t = unit(add(mul(c.t[lo], 1 - f), mul(c.t[j], f)));
  const e = edges[lo] * (1 - f) + edges[j] * f;
  return add(p, mul(leftOf(t), side * (e + off)));
}

/**
 * Along the kerb line from course point i: how far the mouth runs each way (distances along the
 * course, from where the road beyond the kerb line starts to where it stops), up to `cap` each way.
 */
function mouthSpan(c: Course, probe: SurfaceProbe, edges: number[], i: number, side: number, cap: [number, number] = [15, 15]): [number, number] {
  const open = (s: number) => [0.6, 1.2, 2].some((o) => isRoad(probe, kerbPoint(c, edges, s, side, o)));
  const span = (dir: number) => {
    let last = 0, miss = 0;
    for (let ds = 0.25; ds <= cap[dir < 0 ? 0 : 1]; ds += 0.25) {
      if (open(c.s[i] + dir * ds)) { last = ds; miss = 0; }
      else if (++miss >= 3) break;
    }
    return last;
  };
  return [c.s[i] - span(-1), c.s[i] + span(1)];
}

/** Points on the kerb line from s0 to s1 along the course, `off` metres out on `side`, about a metre apart. */
function kerbLine(c: Course, edges: number[], s0: number, s1: number, side: number, off: number): Vec2[] {
  const m = Math.max(1, Math.ceil((s1 - s0) / 1));
  return Array.from({ length: m + 1 }, (_, k) => kerbPoint(c, edges, s0 + ((s1 - s0) * k) / m, side, off));
}

/** A line across a branch: from q, both ways along `across`, as far as the road goes (to `cap`). */
function acrossRoad(probe: SurfaceProbe, q: Vec2, across: Vec2, cap = 12): [Vec2, Vec2] | null {
  const reach = (sgn: number) => {
    let last = -1, miss = 0;
    for (let r = 0; r <= cap; r += 0.25) {
      if (isRoad(probe, add(q, mul(across, sgn * r)))) { last = r; miss = 0; }
      else if (++miss >= 2) break;
    }
    return last;
  };
  const a = reach(-1), b = reach(1);
  if (a < 0 || b < 0 || a + b < 2) return null;
  return [add(q, mul(across, -a)), add(q, mul(across, b))];
}

/**
 * The barrier line for a strip: BARRIER_BACK behind it (along `into`), as far along as there's road
 * under it, so it runs kerb to kerb across the closed street.
 */
function barrierLine(probe: SurfaceProbe, strip: Vec2[], into: Vec2): [Vec2, Vec2] | undefined {
  const a0 = add(strip[0], mul(into, BARRIER_BACK + 0.3)), b0 = add(strip[strip.length - 1], mul(into, BARRIER_BACK + 0.3));
  const d = unit(sub(b0, a0)), L = dist(a0, b0);
  const on: number[] = [];
  for (let u = -3; u <= L + 3; u += 0.25) if (isRoad(probe, add(a0, mul(d, u)))) on.push(u);
  if (on.length < 4) return undefined;
  // The longest run of road.
  let best: [number, number] = [on[0], on[0]], cur: [number, number] = [on[0], on[0]];
  for (const u of on.slice(1)) {
    if (u - cur[1] <= 0.5) cur[1] = u; else cur = [u, u];
    if (cur[1] - cur[0] > best[1] - best[0]) best = [cur[0], cur[1]];
  }
  if (best[1] - best[0] < 1.5) return undefined;
  return [add(a0, mul(d, best[0])), add(a0, mul(d, best[1]))];
}

/** Is q within `r` of the course somewhere more than `ds` metres along from point i? */
function courseElsewhere(c: Course, g: CourseGrid, q: Vec2, i: number, r: number, ds: number): boolean {
  return g.within(q, r).some((w) => Math.abs(along(c, i, w.i)) > ds);
}

const NEAR_PAD = 2.0;
/** Car park entries and driveways longer than this along the kerb aren't entries (a parallel road or parking lane). */
const ENTRY_MAX = 25;

/** Segments of the world's lines by a 10 m grid, for "does a street run alongside here". */
class LineSegments {
  private grid = new Map<number, [Vec2, Vec2][]>();
  constructor(lines: Vec2[][], private cell = 10) {
    for (const l of lines) {
      for (let k = 1; k < l.length; k++) {
        const a = l[k - 1], b = l[k];
        for (let cx = Math.floor(Math.min(a[0], b[0]) / cell); cx <= Math.floor(Math.max(a[0], b[0]) / cell); cx++) {
          for (let cy = Math.floor(Math.min(a[1], b[1]) / cell); cy <= Math.floor(Math.max(a[1], b[1]) / cell); cy++) {
            const key = (cx + 32768) * 65536 + cy + 32768;
            const list = this.grid.get(key);
            if (list) list.push([a, b]); else this.grid.set(key, [[a, b]]);
          }
        }
      }
    }
  }

  /** Is there a street within `r` of q running along `t` (within about 25 degrees)? */
  alongside(q: Vec2, t: Vec2, r: number): boolean {
    for (let cx = Math.floor((q[0] - r) / this.cell); cx <= Math.floor((q[0] + r) / this.cell); cx++) {
      for (let cy = Math.floor((q[1] - r) / this.cell); cy <= Math.floor((q[1] + r) / this.cell); cy++) {
        for (const [a, b] of this.grid.get((cx + 32768) * 65536 + cy + 32768) ?? []) {
          const ab = sub(b, a), L2 = dot(ab, ab);
          if (L2 < 1e-6 || Math.abs(dot(unit(ab), t)) < 0.9) continue;
          const u = Math.max(0, Math.min(1, dot(sub(q, a), ab) / L2));
          if (dist(q, add(a, mul(ab, u))) <= r) return true;
        }
      }
    }
    return false;
  }
}

/**
 * Every mouth the course passes and doesn't take: street junctions and roundabout exits from the
 * world's lines and rings, then car park entries and driveways from the surface (openings in the
 * kerb line that no street explains). Each is classified (side, turn, ring, entry).
 */
export function findMouths(input: CourseLayoutInput): { course: Course; edges: ReturnType<typeof courseEdges>; rings: CourseRing[]; turns: CourseTurn[]; mouths: Mouth[] } {
  const c = courseOf(input.ai, input.closed);
  const { probe } = input;
  const edges = courseEdges(c, probe);
  const g = new CourseGrid(c);
  const rings = courseRings(c, input.rings);
  const turns = courseTurns(c, rings);
  const mouths: Mouth[] = [];
  const edgeAt = (i: number, side: number) => (side > 0 ? edges.left[i] : edges.right[i]);
  const onCourseRing = (q: Vec2, pad: number) => rings.some((r) => dist(q, r.c) < r.rOut + pad);

  // Street mouths: where a world line leaves the course's carriageway for good.
  input.lines.forEach((line0, li) => {
    const line = densify(line0, 2);
    const info = line.map((q) => g.nearest(q, 40));
    const near = info.map((w) => !!w && w.d < edgeAt(w.i, w.side) + NEAR_PAD);
    const branch = (k0: number, step: number) => {
      // k0 is the last near point; walk the far run.
      let k = k0 + step, run = 0, maxD = 0;
      while (k >= 0 && k < line.length && !near[k]) {
        run += dist(line[k], line[k - step]);
        maxD = Math.max(maxD, info[k]?.d ?? 40);
        k += step;
      }
      const w = info[k0];
      if (!w) return;
      const edge = edgeAt(w.i, w.side);
      if (run < 15 && maxD < edge + 12) return;
      // Where the branch crosses the kerb line.
      let x = k0;
      while (x - step >= 0 && x - step < line.length && info[x] && info[x]!.d > edge) x -= step;
      const xi = info[x] ?? w;
      const ahead = line[Math.max(0, Math.min(line.length - 1, k0 + step * 4))];
      const dir = unit(sub(ahead, line[k0]));
      if (Math.abs(dot(dir, c.t[xi.i])) > Math.cos((25 * Math.PI) / 180)) return;
      const at = add(c.p[xi.i], mul(leftOf(c.t[xi.i]), xi.side * edgeAt(xi.i, xi.side)));
      if (onCourseRing(at, 10)) return;
      if (mouths.some((m) => m.side === xi.side && m.kind !== "ring" && Math.abs(along(c, m.i, xi.i)) < 10)) return;
      mouths.push({ kind: "side", at, dir, strip: [], i: xi.i, side: xi.side, line: li });
    };
    for (let k = 0; k + 1 < line.length; k++) {
      if (near[k] && !near[k + 1]) branch(k, 1);
      if (!near[k] && near[k + 1]) branch(k + 1, -1);
    }
  });

  // Ring exits the course doesn't take.
  for (const r of rings) {
    const dirs: { dir: Vec2; line: number }[] = [];
    input.lines.forEach((line0, li) => {
      const line = densify(line0, 2);
      const touch = line.findIndex((q) => dist(q, r.c) < r.rOut + 5);
      if (touch < 0) return;
      for (const step of [1, -1]) {
        let k = touch, far = -1, reach = 0;
        while (k >= 0 && k < line.length) {
          const d = dist(line[k], r.c);
          if (far < 0 && d > r.rOut + 10) far = k;
          reach = Math.max(reach, d);
          k += step;
        }
        if (far < 0 || reach < r.rOut + 15) continue;
        const dir = unit(sub(line[far], r.c));
        if (!dirs.some((x) => dot(x.dir, dir) > Math.cos((20 * Math.PI) / 180))) dirs.push({ dir, line: li });
      }
    });
    // Arms no street explains (a car park or driveway off the ring): every stretch of road just
    // outside the ring's edge.
    const R = r.rOut + 1.5, N = 360;
    const on = Array.from({ length: N }, (_, k) => isRoad(probe, add(r.c, mul([Math.cos((k / N) * 2 * Math.PI), Math.sin((k / N) * 2 * Math.PI)], R))));
    const start = on.indexOf(false);
    for (let k = 0; start >= 0 && k < N;) {
      const a = (start + k) % N;
      if (!on[a]) { k++; continue; }
      let n = 0;
      while (k < N && on[(start + k) % N]) { k++; n++; }
      if ((n * 2 * Math.PI * R) / N < 2) continue;
      const mid = ((a + n / 2) / N) * 2 * Math.PI;
      const dir: Vec2 = [Math.cos(mid), Math.sin(mid)];
      if (dirs.some((x) => dot(x.dir, dir) > Math.cos((20 * Math.PI) / 180))) continue;
      dirs.push({ dir, line: -1 });
    }
    for (const { dir, line } of dirs) {
      if (r.legs.some((l) => dot(l.dir, dir) > Math.cos((30 * Math.PI) / 180))) continue;
      if (g.nearest(add(r.c, mul(dir, r.rOut + 8)), 5)) continue;
      const at = add(r.c, mul(dir, r.rOut));
      const i = g.nearest(at, 60)?.i ?? 0;
      mouths.push({ kind: "ring", at, dir, strip: [], i, side: 0, line: line >= 0 ? line : undefined, ring: r.ring, minor: line < 0 });
    }
  }

  // The straight-on branch at each junction turn.
  for (const t of turns) {
    if (t.ring !== undefined) continue;
    const tin = c.t[stepAlong(c, t.i, -25)];
    let best: Mouth | null = null, bestDot = Math.cos((40 * Math.PI) / 180);
    for (const m of mouths) {
      if (m.kind !== "side" || Math.abs(along(c, t.i, m.i)) > 25) continue;
      const d = dot(m.dir, tin);
      if (d > bestDot) { best = m; bestDot = d; }
    }
    if (best) { best.kind = "turn"; best.turn = t.dir; }
  }

  // Strips and barrier lines for the street and ring mouths.
  for (const m of mouths) {
    if (m.kind === "ring") {
      const r = rings.find((x) => x.ring === m.ring)!;
      const across = leftOf(m.dir);
      const s = acrossRoad(probe, add(r.c, mul(m.dir, r.rOut + 0.5)), across, 10);
      m.strip = s ? [add(s[0], mul(m.dir, -0.5)), add(s[1], mul(m.dir, -0.5))] : [];
      m.barrier = m.strip.length && !m.minor ? barrierLine(probe, m.strip, m.dir) : undefined;
    } else {
      const ed = m.side > 0 ? edges.left : edges.right;
      // The branch's own width a few metres in bounds the mouth (plus its kerb returns), so a wide
      // junction or a divided road's other carriageway doesn't stretch it along the course.
      const t = c.t[m.i];
      const w = acrossRoad(probe, add(m.at, mul(m.dir, 4)), leftOf(m.dir), 15);
      const reach = w ? w.map((q) => dot(sub(q, m.at), t)) : [-6, 6];
      const [s0, s1] = mouthSpan(c, probe, ed, m.i, m.side, [Math.max(2, -Math.min(...reach) + 4), Math.max(2, Math.max(...reach) + 4)]);
      if (s1 - s0 < 2.5) { m.strip = []; continue; }
      m.span = [s0, s1];
      m.strip = kerbLine(c, ed, s0, s1, m.side, 0);
      m.barrier = barrierLine(probe, m.strip, mul(leftOf(t), m.side));
    }
  }

  // Car park entries and driveways: openings in the kerb line no street mouth explains.
  const STEP = 0.5;
  const segs = new LineSegments(input.lines);
  const steps = Math.floor((c.closed ? c.total : c.s[c.s.length - 1]) / STEP);
  for (const side of [1, -1]) {
    const ed = side > 0 ? edges.left : edges.right;
    const taken = mouths.filter((m) => m.side === side && m.span).map((m) => m.span!);
    const open = Array.from({ length: steps }, (_, k) => {
      const s = k * STEP;
      const i = stepAlong(c, 0, s);
      if (onCourseRing(c.p[i], 12)) return false;
      if (taken.some(([a, b]) => (s >= a - 2 && s <= b + 2) || (c.closed && s + c.total >= a - 2 && s + c.total <= b + 2))) return false;
      if (![0.6, 1.2, 2].some((o) => isRoad(probe, kerbPoint(c, ed, s, side, o)))) return false;
      // A divided road's other carriageway, or a service road alongside: not a mouth.
      if (segs.alongside(kerbPoint(c, ed, s, side, 4), c.t[i], 6)) return false;
      return !courseElsewhere(c, g, kerbPoint(c, ed, s, side, 8), i, 5, 15);
    });
    let k = 0;
    while (k < steps) {
      if (!open[k]) { k++; continue; }
      let j = k;
      while (j + 1 < steps && open[j + 1]) j++;
      const s0 = k * STEP - STEP / 2, s1 = j * STEP + STEP / 2;
      if (s1 - s0 >= 2.5 && s1 - s0 <= ENTRY_MAX) {
        const sm = (s0 + s1) / 2, i = stepAlong(c, 0, sm);
        mouths.push({
          kind: "entry", at: kerbPoint(c, ed, sm, side, 0), dir: mul(leftOf(c.t[i]), side),
          strip: kerbLine(c, ed, s0, s1, side, 0), span: [s0, s1], i, side,
        });
      }
      k = j + 1;
    }
  }
  return { course: c, edges, rings, turns, mouths: mouths.filter((m) => m.strip.length >= 2) };
}

// ---------------------------------------------------------------------------------------------
// Geometry

const UP: Vec3 = [0, 0, 1];
const v3 = (p: Vec2, z: number): Vec3 => [p[0], p[1], z];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A flat convex polygon with its own vertices and normal, wound to face `outward`. */
export function polygon(mb: MeshBuilder, pts: Vec3[], outward: Vec3): void {
  let nrm: Vec3 = [0, 0, 0];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    nrm = [nrm[0] + (a[1] - b[1]) * (a[2] + b[2]), nrm[1] + (a[2] - b[2]) * (a[0] + b[0]), nrm[2] + (a[0] - b[0]) * (a[1] + b[1])];
  }
  const l = Math.hypot(...nrm);
  if (l < 1e-9) return;
  let list = pts;
  if (dot3(nrm, outward) < 0) { list = pts.slice().reverse(); nrm = [-nrm[0], -nrm[1], -nrm[2]]; }
  nrm = [nrm[0] / l, nrm[1] / l, nrm[2] / l];
  if (mb.normals === null && mb.vertexCount === 0) mb.normals = [];
  const ids = list.map((p) => mb.vertex(p, 0, 0));
  if (mb.normals) for (let k = 0; k < ids.length; k++) mb.normals.push(...nrm);
  for (let k = 1; k + 1 < ids.length; k++) mb.tri(ids[0], ids[k], ids[k + 1]);
}

/**
 * A profile (across, up) swept straight from a to b (heights za, zb): its sides and both ends, no
 * bottom. `across` is the profile's horizontal axis.
 */
export function sweep(mb: MeshBuilder, a: Vec2, b: Vec2, za: number, zb: number, across: Vec2, profile: Vec2[]): void {
  const n = profile.length;
  const cu = profile.reduce((s, p) => s + p[0], 0) / n, cv = profile.reduce((s, p) => s + p[1], 0) / n;
  const at = (p: Vec2, z: number, q: Vec2): Vec3 => [p[0] + across[0] * q[0], p[1] + across[1] * q[0], z + q[1]];
  const fwd = unit(sub(b, a));
  for (let k = 0; k < n; k++) {
    const q0 = profile[k], q1 = profile[(k + 1) % n];
    if (q0[1] === 0 && q1[1] === 0) continue;
    // Outward in the profile plane: away from its middle.
    const eu = q1[0] - q0[0], ev = q1[1] - q0[1];
    let nu = ev, nv = -eu;
    if (nu * ((q0[0] + q1[0]) / 2 - cu) + nv * ((q0[1] + q1[1]) / 2 - cv) < 0) { nu = -nu; nv = -nv; }
    const out: Vec3 = [across[0] * nu, across[1] * nu, nv];
    polygon(mb, [at(a, za, q0), at(a, za, q1), at(b, zb, q1), at(b, zb, q0)], out);
  }
  polygon(mb, profile.map((q) => at(a, za, q)), v3(mul(fwd, -1), 0));
  polygon(mb, profile.map((q) => at(b, zb, q)), v3(fwd, 0));
}

/** Kn5 meshes of the markings, merged by paint and kind in 200 m tiles so AC can still cull them. */
export class MarkMeshes {
  private groups = new Map<string, { chunks: ChunkedMesh; name: string; paint: Paint; extra: Partial<Kn5MeshNode> }>();
  constructor(private tile = 200) {}

  /** A builder for `verts` more vertices of `paint`, in `prefix`'s group (e.g. `1RIPPLE`, `CM_BARRIER`), at p. */
  mb(prefix: string, paint: Paint, p: Vec2, verts: number, extra: Partial<Kn5MeshNode> = {}): MeshBuilder {
    const tx = Math.floor(p[0] / this.tile) + 100, ty = Math.floor(p[1] / this.tile) + 100;
    const k = `${prefix}|${paint}|${tx}|${ty}`;
    let g = this.groups.get(k);
    if (!g) { g = { chunks: new ChunkedMesh(), name: `${prefix}_${paint.toUpperCase()}_${tx}_${ty}`, paint, extra }; this.groups.set(k, g); }
    return g.chunks.next(verts);
  }

  nodes(): Kn5MeshNode[] {
    const out: Kn5MeshNode[] = [];
    for (const g of this.groups.values()) {
      g.chunks.all().forEach((b, k) => out.push(b.toKn5(`${g.name}_${k}`, `cm_${g.paint}`, g.extra)));
    }
    return out;
  }
}

/** Heights along a line from the probe (the last good one, or `fallback`, where it has none). */
function heightsAt(probe: SurfaceProbe, pts: Vec2[], fallback: number): number[] {
  let last = fallback;
  return pts.map((p) => { const h = probe(p[0], p[1])?.h; if (h !== undefined) last = h; return last; });
}

/** The strip along a kerb line: 1 m bands, red and white, a rumble surface. `into` points into the mouth. */
export function stripMesh(mm: MarkMeshes, probe: SurfaceProbe, line: Vec2[], into: Vec2, fallback: number, prefix = "1RIPPLE", clear: (q: Vec2) => boolean = () => true): void {
  // Resample to whole bands.
  const pts: Vec2[] = [line[0]];
  let total = 0;
  for (let k = 1; k < line.length; k++) total += dist(line[k], line[k - 1]);
  const bands = Math.max(1, Math.round(total / STRIP_BAND));
  const at = (d: number): Vec2 => {
    let acc = 0;
    for (let k = 1; k < line.length; k++) {
      const l = dist(line[k], line[k - 1]);
      if (acc + l >= d) return add(line[k - 1], mul(sub(line[k], line[k - 1]), l > 0 ? (d - acc) / l : 0));
      acc += l;
    }
    return line[line.length - 1];
  };
  for (let b = 1; b <= bands; b++) pts.push(at((total * b) / bands));
  const hs = heightsAt(probe, pts, fallback);
  for (let b = 0; b < bands; b++) {
    const a = pts[b], e = pts[b + 1];
    if (!clear(mul(add(a, e), 0.5))) continue;
    const seg = unit(sub(e, a));
    let across = leftOf(seg);
    if (dot(across, into) < 0) across = mul(across, -1);
    const mb = mm.mb(prefix, b % 2 ? "white" : "red", a, 40);
    // A hair short at each end so neighbouring bands don't fight.
    sweep(mb, add(a, mul(seg, 0.005)), add(e, mul(seg, -0.005)), hs[b] - 0.005, hs[b + 1] - 0.005, across, STRIP_PROFILE);
  }
}

/** The invisible CLOSED patch behind a strip: from its back edge to CLOSED_DEPTH behind the kerb line. */
export function closedPatch(mm: MarkMeshes, probe: SurfaceProbe, line: Vec2[], into: Vec2, fallback: number, clear: (q: Vec2) => boolean = () => true): void {
  if (line.length < 2) return;
  const rows = 4;
  const grid: Vec3[][] = line.map((p) => {
    const row: Vec3[] = [];
    let last = fallback;
    for (let r = 0; r <= rows; r++) {
      const q = add(p, mul(into, STRIP_WIDTH + ((CLOSED_DEPTH - STRIP_WIDTH) * r) / rows));
      const h = probe(q[0], q[1])?.h;
      if (h !== undefined) last = h;
      row.push(v3(q, last + CLOSED_LIFT));
    }
    return row;
  });
  const mb = mm.mb("1CLOSED", "white", line[0], line.length * rows * 6, { renderable: false, castShadows: false });
  for (let k = 0; k + 1 < grid.length; k++) {
    for (let r = 0; r < rows; r++) {
      const quad = [grid[k][r], grid[k + 1][r], grid[k + 1][r + 1], grid[k][r + 1]];
      if (quad.every((q) => clear([q[0], q[1]]))) polygon(mb, quad, UP);
    }
  }
}

/** Barrier modules along a line, red and white, skipping any that would stand in a parking bay. */
export function barrierMesh(mm: MarkMeshes, probe: SurfaceProbe, a: Vec2, b: Vec2, fallback: number, bays: BayBox[] = [], solid = false, clear: (q: Vec2) => boolean = () => true): number {
  const L = dist(a, b);
  const n = Math.max(1, Math.round(L / (BARRIER_LENGTH + BARRIER_GAP)));
  const d = unit(sub(b, a));
  const piece = L / n - BARRIER_GAP;
  let placed = 0;
  for (let k = 0; k < n; k++) {
    const mid = add(a, mul(d, (L * (k + 0.5)) / n));
    if (bays.some((bay) => inBay(bay, mid, 0.3)) || !clear(add(mid, mul(d, -piece / 2))) || !clear(add(mid, mul(d, piece / 2)))) continue;
    const h = probe(mid[0], mid[1])?.h ?? fallback;
    const mb = mm.mb(solid ? "1WALL_CM" : "CM_BARRIER", k % 2 ? "white" : "red", mid, 40, { castShadows: true });
    sweep(mb, add(mid, mul(d, -piece / 2)), add(mid, mul(d, piece / 2)), h, h, leftOf(d), BARRIER_PROFILE);
    placed++;
  }
  return placed;
}

function inBay(bay: BayBox, p: Vec2, pad: number): boolean {
  const q = sub(p, bay.c);
  const u = dot(q, bay.along), v = cross(bay.along, q);
  return Math.abs(u) <= bay.halfLen + pad && Math.abs(v) <= bay.halfDepth + pad;
}

// ---------------------------------------------------------------------------------------------
// A layout's markings

export interface CourseMarks {
  nodes: Kn5MeshNode[];
  materials: Kn5Material[];
  textures: Kn5Texture[];
  mouths: Mouth[];
  rings: CourseRing[];
  turns: CourseTurn[];
  triangles: number;
}

const LIGHT = { ambient: 0.45, diffuse: 0.45, specular: 0.1, exp: 20 };

export function marksMaterials(): { materials: Kn5Material[]; textures: Kn5Texture[] } {
  const materials: Kn5Material[] = [], textures: Kn5Texture[] = [];
  for (const [name, rgb] of Object.entries(COLOURS)) {
    textures.push({ name: `cm_${name}.png`, data: solidTexture(rgb) });
    materials.push(material(`cm_${name}`, `cm_${name}.png`, LIGHT));
  }
  return { materials, textures };
}

/** Everything for one race layout. */
export function courseMarks(input: CourseLayoutInput, settings: CourseMarksSettings): CourseMarks {
  const found = findMouths(input);
  const { course: c, mouths } = found;
  const { probe } = input;
  const mm = new MarkMeshes();
  // Nothing on the course's own carriageway: `margin` metres or more past its kerb line (a curved
  // mouth's barrier line, or the far end of a patch at a corner, could otherwise reach it).
  const g = new CourseGrid(c);
  const offCourse = (margin: number) => (q: Vec2) => {
    const w = g.nearest(q, 30);
    return !w || w.d >= (w.side > 0 ? found.edges.left : found.edges.right)[w.i] + margin;
  };
  for (const m of mouths) {
    const fallback = c.h[m.i];
    stripMesh(mm, probe, m.strip, m.dir, fallback, "1RIPPLE", offCourse(-0.1));
    closedPatch(mm, probe, m.strip, m.dir, fallback, offCourse(0.3));
    if (settings.barriers && m.barrier && m.kind !== "entry") barrierMesh(mm, probe, m.barrier[0], m.barrier[1], fallback, input.bays, settings.solid, offCourse(1.0));
  }
  const nodes = mm.nodes();
  const { materials, textures } = marksMaterials();
  return { nodes, materials, textures, mouths, rings: found.rings, turns: found.turns, triangles: nodes.reduce((s, m) => s + m.indices.length / 3, 0) };
}

// ---------------------------------------------------------------------------------------------
// The layout's files

/** RIPPLE (a rumble strip, valid) and CLOSED (a closed street, not valid track) added to a surfaces.ini. */
export function withMarkSurfaces(ini: string): string {
  if (/^KEY=CLOSED$/m.test(ini)) return ini;
  const used = [...ini.matchAll(/^\[SURFACE_(\d+)\]/gm)].map((m) => Number(m[1]));
  let k = used.length ? Math.max(...used) + 1 : 0;
  const block = (s: Record<string, string | number>) => [`[SURFACE_${k++}]`, ...Object.entries(s).map(([a, b]) => `${a}=${b}`)].join("\n");
  const base = { WAV: "", WAV_PITCH: 0, FF_EFFECT: "NULL", DIRT_ADDITIVE: 0, BLACK_FLAG_TIME: 0, IS_PITLANE: 0 };
  const ripple = block({ KEY: "RIPPLE", FRICTION: 0.92, DAMPING: 0, ...base, IS_VALID_TRACK: 1, SIN_HEIGHT: 0, SIN_LENGTH: 0, VIBRATION_GAIN: 1.0, VIBRATION_LENGTH: 0.5 });
  const closed = block({ KEY: "CLOSED", FRICTION: 0.99, DAMPING: 0, ...base, IS_VALID_TRACK: 0, SIN_HEIGHT: 0, SIN_LENGTH: 0, VIBRATION_GAIN: 0, VIBRATION_LENGTH: 0 });
  // Before any [_SCRIPTING_PHYSICS] or [WEATHER_FX] section, after the last surface.
  const extra = ini.search(/^\[(?!SURFACE_)/m);
  const head = extra < 0 ? ini : ini.slice(0, extra), tail = extra < 0 ? "" : ini.slice(extra);
  return `${head.replace(/\s*$/, "")}\n\n${ripple}\n\n${closed}\n${tail ? `\n${tail}` : ""}`;
}

/** Mesh names the markings use (the checks look for these). */
export const MARK_MESH = /^(1RIPPLE|1CLOSED|1WALL_CM|CM_)/;

export interface MarkWorld {
  slug: string;
  probe: SurfaceProbe;
  lines: Vec2[][];
  rings: WorldRing[];
  bays?: BayBox[];
}

/**
 * Course markings into race layout `id`'s files, in place: its kn5 gets the markings beside its
 * dummies, its surfaces.ini the RIPPLE and CLOSED keys, its traffic.json goes (CSP traffic would
 * drive through the barriers; the layout ships without traffic for now, and its track list entry
 * loses the traffic tag), and data/course_marks.json says what was laid, for the checks. Returns
 * the files to delete from the zip, and a summary.
 */
export function courseMarkLayout(files: Record<string, Uint8Array>, world: MarkWorld, id: string, opt: CourseMarksOption): { drop: string[]; summary: Record<string, unknown> } | null {
  const settings = courseMarksSettings(opt);
  if (!settings) return null;
  const { slug } = world;
  const aiFile = files[`${slug}/${id}/ai/fast_lane.ai`], kn5File = files[`${slug}/layout_${id}.kn5`];
  if (!aiFile || !kn5File) return null;
  const layout = readKn5(kn5File);
  const dummies = layout.root.children.filter((n): n is Kn5GroupNode => n.kind === "node");
  const marks = courseMarks({ ai: readFastLaneAi(aiFile), lines: world.lines, rings: world.rings, probe: world.probe, bays: world.bays, dummies }, settings);
  const model: Kn5Model = {
    textures: [...layout.textures, ...marks.textures],
    materials: [...layout.materials, ...marks.materials],
    root: { ...layout.root, children: [...layout.root.children, ...marks.nodes] },
  };
  files[`${slug}/layout_${id}.kn5`] = writeKn5(model);
  const enc = new TextEncoder(), dec = new TextDecoder();
  const surf = files[`${slug}/${id}/data/surfaces.ini`];
  if (surf) files[`${slug}/${id}/data/surfaces.ini`] = enc.encode(withMarkSurfaces(dec.decode(surf)));
  const drop = [`${slug}/${id}/data/traffic.json`].filter((k) => k in files);
  for (const k of drop) delete files[k];
  const ui = files[`${slug}/ui/${id}/ui_track.json`];
  if (ui) {
    const j = JSON.parse(dec.decode(ui));
    j.tags = (j.tags ?? []).filter((t: string) => t !== TRAFFIC_READY_TAG);
    files[`${slug}/ui/${id}/ui_track.json`] = enc.encode(JSON.stringify(j, null, 2) + "\n");
  }
  const count = (k: MouthKind) => marks.mouths.filter((m) => m.kind === k).length;
  const summary = {
    layout: id, settings, triangles: marks.triangles, meshes: marks.nodes.length,
    mouths: { side: count("side"), turn: count("turn"), ring: count("ring"), entry: count("entry") },
    turns: marks.turns.length,
    rings: marks.rings.map((r) => ({ ring: r.ring, c: r.c.map((v) => +v.toFixed(2)), rOut: +r.rOut.toFixed(2), rIn: +r.rIn.toFixed(2) })),
    list: marks.mouths.map((m) => ({ kind: m.kind, at: m.at.map((v) => +v.toFixed(2)), dir: m.dir.map((v) => +v.toFixed(3)), turn: m.turn, strip: m.strip.length, barrier: !!m.barrier })),
  };
  files[`${slug}/${id}/data/course_marks.json`] = enc.encode(JSON.stringify(summary, null, 1));
  return { drop, summary };
}
