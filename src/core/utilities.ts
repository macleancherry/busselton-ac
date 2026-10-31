// Busselton fork: what lines a street above head height (docs/specs/utilities.md).
//
// Power poles where they're known (Mapillary, OSM poles, the vertices of OSM power lines), never
// invented; overhead wires between them; street lights where known and, in town, at a typical
// spacing where none are; lights along car park aisles. Every foot stands on the one ground passed
// in (sceneGround.ts), SINK into it, and with an on-road test (poleSpot.ts) no foot stands on a
// drivable mesh. Lanterns hang under the end of an arm that starts inside their post, so the
// ground check (poleCheck.ts) sees each one joined to a pole standing on the ground.
import { type Vec2 } from "./geo";
import { type HeightFn } from "./elevation";
import { type Kn5MeshNode } from "./kn5";
import { type Vec3, MeshBuilder } from "./mesh";
import { type BuildOptions } from "./options";
import { type RoadPlan, type SegmentIndex, inRoundabout } from "./road";
import { type Piece } from "./furniture";
import { SINK } from "./sceneGround";
import { clearSpot, type OnRoad } from "./poleSpot";

// ---- sizes (metres) ----

const SETBACK = 1.0; // a post's distance behind the road edge
const SNAP_BAND = 1.5; // closer than setback + this to the edge counts as "on the road"
const MAX_BEYOND = 25; // known positions further than this past the edge are dropped
const MERGE = 4; // known positions this close are one

const POLE_W = 0.28, POLE_TOP = 11;
const XARM_LEN = 2.2, XARM_W = 0.1, XARM_LO = 10.3, XARM_HI = 10.42;

const POST_W = 0.16, POST_TOP = 8.5;
const ARM_W = 0.08, ARM_LO = 8.35, ARM_HI = 8.44, ARM_MIN = 2.2, ARM_MAX = 6;
const LANTERN_L = 0.7, LANTERN_W = 0.32, LANTERN_LO = 8.23, LANTERN_HI = 8.39;
const LIGHT_UNDER = 0.05;
const PAST_EDGE = 0.8; // how far inside the road edge a lantern's middle hangs

const DEFAULT_STEP = 50, DEFAULT_FIRST = 25, DEFAULT_GAP = 30, ON_POLE = 18, MOUNT = 3, WIDE = 10;

const HV_OFFSETS = [-0.9, 0, 0.9], HV_UP = 0.18, HV_W = 0.025;
const LV_HEIGHT = 8.4, LV_OUT = 0.25, LV_W = 0.05;
const SAG_K = 0.0005, SAG_MAX = 1.2, WIRE_SEGS = 10;

const CP_STEP = 35, CP_FIRST = 17, CP_OFF = 9, CP_GAP = 20;
const CP_POLE_W = 0.18, CP_POLE_TOP = 8.2;
const CP_ARM = 1.5, CP_ARM_LO = 8.02, CP_ARM_HI = 8.11;
const CP_LANTERN_OUT = 1.1, CP_LANTERN_L = 0.8, CP_LANTERN_W = 0.35, CP_LANTERN_LO = 7.9, CP_LANTERN_HI = 8.06;

// ---- small vector helpers ----

const add = (a: Vec2, b: Vec2, k = 1): Vec2 => [a[0] + b[0] * k, a[1] + b[1] * k];
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (v: Vec2): Vec2 => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const perp = (v: Vec2): Vec2 => [-v[1], v[0]];
const scale = (v: Vec2, k: number): Vec2 => [v[0] * k, v[1] * k];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const byPosition = (a: Vec2, b: Vec2) => a[0] - b[0] || a[1] - b[1];
const pad3 = (i: number) => String(i).padStart(3, "0");

// ---- public types ----

/** What's known, local metres: power poles and street lamps seen or mapped, and power lines (each vertex a pole). */
export type KnownUtilities = { poles: Vec2[]; lamps: Vec2[]; lines: Vec2[][] };

/** The pieces and wire meshes, one light per lantern (x, y and a height just under it), and the power poles placed. */
export type Utilities = { pieces: Piece[]; wires: Kn5MeshNode[]; lights: Vec3[]; poles: number };

/** An arm: unit direction from the post, and the distance from the post's centre to its end. */
export type Arm = { dir: Vec2; length: number };

type Side = 1 | -1;
/** A post by the route: where it stands, `out` (unit, across the road away from it), distance `s` along the route, side, ground height. */
type Spot = { at: Vec2; out: Vec2; s: number; side: Side; h: number };

// ---- arms and lanterns ----

/**
 * A street light's arm from a post at `at` (ground `ground` at its foot) along `dir`, and the lantern
 * under its end. The arm starts at the post's centre; the lantern's outer end is flush with the arm's.
 */
export function outreach(at: Vec2, ground: number, dir: Vec2, length: number): { pieces: Piece[]; light: Vec3 } {
  const d = unit(dir);
  const arm: Piece = { kind: "box", at: add(at, d, length / 2), along: d, length, depth: ARM_W, z0: ground + ARM_LO, z1: ground + ARM_HI, material: "steel" };
  const mid = add(at, d, length - LANTERN_L / 2);
  const lantern: Piece = { kind: "box", at: mid, along: d, length: LANTERN_L, depth: LANTERN_W, z0: ground + LANTERN_LO, z1: ground + LANTERN_HI, material: "lamp" };
  return { pieces: [arm, lantern], light: [mid[0], mid[1], ground + LANTERN_LO - LIGHT_UNDER] };
}

/** An arm long enough to put the lantern's middle PAST_EDGE inside an edge `edge` metres away. */
const armFor = (edge: number) => Math.min(ARM_MAX, Math.max(ARM_MIN, edge + PAST_EDGE + LANTERN_L / 2));

/**
 * The arms a light's post carries: one toward the road (or out to where its lantern was seen), and
 * with `onRoad` a second over a carriageway that runs along the street straight behind it (a median).
 */
export function lampArms(base: { at: Vec2; out: Vec2 }, seen: Vec2 | undefined, plan: RoadPlan, index: SegmentIndex, onRoad?: OnRoad): Arm[] {
  void plan;
  const out = unit(base.out);
  const arms: Arm[] = [];
  const toSeen = seen ? dist(seen, base.at) : 0;
  if (seen && toSeen >= 0.5 && toSeen <= ARM_MAX) {
    arms.push({ dir: unit([seen[0] - base.at[0], seen[1] - base.at[1]]), length: toSeen + LANTERN_L / 2 });
  } else {
    const n = index.nearest(base.at[0], base.at[1], 60);
    const edge = n ? n.dist - index.at(n).width / 2 : Infinity;
    arms.push({ dir: [-out[0], -out[1]], length: edge > 3 ? ARM_MIN : armFor(Math.max(0, edge)) });
  }
  if (onRoad) {
    const along = perp(out);
    for (let d = 0.25; d <= 4 + 1e-9; d += 0.25) {
      const p = add(base.at, out, d);
      if (!onRoad(p[0], p[1])) continue;
      const q = add(base.at, out, d + 0.5);
      if (onRoad(...add(q, along, 8)) && onRoad(...add(q, along, -8))) arms.push({ dir: out, length: armFor(d) });
      break;
    }
  }
  return arms;
}

// ---- snapping known positions ----

function snap(p: Vec2, plan: RoadPlan, index: SegmentIndex, opts: BuildOptions, ground: HeightFn, onRoad?: OnRoad): (Spot & { moved: boolean; overRoad: boolean }) | null {
  const n = index.nearest(p[0], p[1], opts.corridor - 2);
  if (n === null) return null;
  if (inRoundabout(plan, p[0], p[1], 2)) return null;
  const half = 0.5 * index.at(n).width;
  const beyond = Math.abs(n.t) - half;
  if (beyond > MAX_BEYOND) return null;
  const [a, b] = index.ends(n.seg);
  const tan = unit([b[0] - a[0], b[1] - a[1]]);
  const left = perp(tan);
  const side: Side = n.t < 0 ? -1 : 1;
  const out = scale(left, side);
  const foot: Vec2 = [a[0] + (b[0] - a[0]) * n.frac, a[1] + (b[1] - a[1]) * n.frac];
  let at: Vec2 = p;
  if (Math.abs(n.t) < half + SETBACK + SNAP_BAND) at = add(foot, out, half + SETBACK);
  const overRoad = Math.abs(n.t) < half || !!onRoad?.(p[0], p[1]);
  const clear = clearSpot(at, onRoad, { away: out });
  if (!clear) return null;
  at = clear;
  const sa = plan.samples[n.seg], sb = plan.samples[(n.seg + 1) % plan.samples.length];
  const s = sa.s + ((n.seg + 1 === plan.samples.length ? plan.length : sb.s) - sa.s) * n.frac;
  return { at, out, s, side, h: ground(at[0], at[1]), moved: dist(at, p) > 0.01, overRoad };
}

// ---- placement ----

/** The last sample at or before distance `s` along the route. */
function sampleAtDistance(plan: RoadPlan, s: number): number {
  const list = plan.samples;
  let below = 0, above = list.length;
  // Every sample from `above` on is past s; list[below] isn't (or below is 0).
  while (above - below > 1) {
    const m = Math.floor((below + above) / 2);
    if (list[m].s > s) above = m;
    else below = m;
  }
  return below;
}

interface Pole extends Spot { lit: boolean }
interface Lamp { post: Spot; seen?: Vec2; pole?: Pole }

type XY = (x: number, y: number) => boolean;

/** Poles, wires and street lights along the route (docs/specs/utilities.md has every rule). */
export function placeUtilities(known: KnownUtilities, plan: RoadPlan, index: SegmentIndex, opts: BuildOptions, ground: HeightFn, town: (i: number) => number, blocked: XY = () => false, onRoad?: OnRoad): Utilities {
  // Poles: known poles and every line vertex, in a fixed order, snapped, then merged.
  type Cand = { p: Vec2; vertex?: [number, number] };
  const cands: Cand[] = [
    ...known.poles.map((p) => ({ p })),
    ...known.lines.flatMap((line, li) => line.map((p, vi) => ({ p, vertex: [li, vi] as [number, number] }))),
  ].sort((a, b) => byPosition(a.p, b.p));
  const poles: Pole[] = [];
  const vertexPole = new Map<string, Pole>();
  for (const c of cands) {
    const sp = snap(c.p, plan, index, opts, ground, onRoad);
    if (!sp) continue;
    let pole = poles.find((q) => dist(q.at, sp.at) < MERGE);
    if (!pole) poles.push((pole = { at: sp.at, out: sp.out, s: sp.s, side: sp.side, h: sp.h, lit: false }));
    if (c.vertex) vertexPole.set(c.vertex.join(","), pole);
  }
  const nearestPole = (p: Vec2, within: number, free = false) => {
    let best: Pole | undefined, bd = within;
    for (const q of poles) {
      if (free && q.lit) continue;
      const d = dist(q.at, p);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  };

  // Known lamps: snapped, merged, mounted on a pole within 3 m.
  const lamps: Lamp[] = [];
  for (const p of [...known.lamps].sort(byPosition)) {
    const sp = snap(p, plan, index, opts, ground, onRoad);
    if (!sp || lamps.some((l) => dist(l.post.at, sp.at) < MERGE)) continue;
    const pole = nearestPole(sp.at, MOUNT);
    const post: Spot = pole ?? sp;
    if (pole) pole.lit = true;
    // Seen over the asphalt: the lantern stays where it was seen, the arm reaches out to it.
    const seen = sp.overRoad && dist(post.at, p) >= 0.5 ? p : undefined;
    lamps.push({ post, seen, pole });
  }

  // Default lights in town, where none are known.
  let step = 0;
  for (let s = DEFAULT_FIRST; s < plan.length; s += DEFAULT_STEP, step++) {
    const i = sampleAtDistance(plan, s);
    if (!(town(i) >= 1)) continue;
    const smp = plan.samples[i];
    const side: Side = smp.width >= WIDE && step % 2 === 1 ? -1 : 1;
    const out = scale(smp.left, side);
    const along = s - smp.s;
    const centre = add(smp.pos, smp.tan, along);
    const want = add(centre, out, smp.width / 2 + SETBACK);
    if (lamps.some((l) => dist(l.post.at, want) < DEFAULT_GAP)) continue;
    if (blocked(want[0], want[1]) || inRoundabout(plan, want[0], want[1], 3)) continue;
    const pole = nearestPole(want, ON_POLE, true);
    if (pole) {
      pole.lit = true;
      lamps.push({ post: pole, pole });
      continue;
    }
    const at = clearSpot(want, onRoad, { away: out });
    if (!at) continue;
    lamps.push({ post: { at, out, s, side, h: ground(at[0], at[1]) } });
  }

  // Geometry.
  const parts: Piece[] = [];
  for (const q of poles) {
    parts.push({ kind: "box", at: q.at, along: q.out, length: POLE_W, depth: POLE_W, z0: q.h - SINK, z1: q.h + POLE_TOP, material: "timber" });
    parts.push({ kind: "box", at: q.at, along: q.out, length: XARM_LEN, depth: XARM_W, z0: q.h + XARM_LO, z1: q.h + XARM_HI, material: "timber" });
  }
  const glow: Vec3[] = [];
  for (const lamp of lamps) {
    const { at, out, h } = lamp.post;
    if (!lamp.pole) parts.push({ kind: "box", at, along: out, length: POST_W, depth: POST_W, z0: h - SINK, z1: h + POST_TOP, material: "steel" });
    for (const arm of lampArms({ at, out }, lamp.seen, plan, index, onRoad)) {
      const o = outreach(at, h, arm.dir, arm.length);
      parts.push(...o.pieces);
      glow.push(o.light);
    }
  }

  return { pieces: parts, wires: wireMeshes(spans(poles, known.lines, vertexPole)), lights: glow, poles: poles.length };
}

// ---- wires ----

type Span = [Pole, Pole];

function spans(poles: Pole[], lines: Vec2[][], vertexPole: Map<string, Pole>): Span[] {
  const result: Span[] = [];
  const seen = new Set<string>();
  const id = new Map(poles.map((p, i) => [p, i]));
  const addSpan = (a: Pole, b: Pole) => {
    if (a === b) return;
    const ia = id.get(a)!, ib = id.get(b)!;
    const key = ia < ib ? `${ia},${ib}` : `${ib},${ia}`;
    if (seen.has(key)) return;
    const L = dist(a.at, b.at);
    if (L < 8 || L > 90) return;
    seen.add(key);
    result.push([a, b]);
  };
  lines.forEach((line, li) => {
    for (let vi = 1; vi < line.length; vi++) {
      const a = vertexPole.get(`${li},${vi - 1}`), b = vertexPole.get(`${li},${vi}`);
      if (a && b) addSpan(a, b);
    }
  });
  for (const sd of [1, -1]) {
    const row = poles.filter((p) => p.side === sd).sort((a, b) => a.s - b.s);
    for (let j = 1; j < row.length; j++) {
      const [a, b] = [row[j - 1], row[j]];
      const ds = b.s - a.s;
      if (ds >= 15 && ds <= 75 && dist(a.at, b.at) >= 0.85 * ds) addSpan(a, b);
    }
  }
  return result;
}

/** Sag at the middle of a span `L` metres long. */
export const sagOf = (L: number) => Math.min(SAG_MAX, SAG_K * L * L);

/** Where a conductor hangs from a pole: [offset along the crossarm, height above the foot, width]. */
const CONDUCTORS: [number, number, number][] = [
  ...HV_OFFSETS.map((o): [number, number, number] => [o, XARM_HI + HV_UP, HV_W]),
  [LV_OUT, LV_HEIGHT, LV_W],
];

function wireMeshes(list: Span[]): Kn5MeshNode[] {
  const done: MeshBuilder[] = [];
  let mb = new MeshBuilder();
  const PER_SPAN = CONDUCTORS.length * WIRE_SEGS * 16;
  for (const [a, b] of list.values()) {
    if (mb.vertexCount + PER_SPAN > 60000) { done.push(mb); mb = new MeshBuilder(); }
    // The far arm facing the other way: mirror its offsets so the conductors don't cross.
    const flip = dot(a.out, b.out) < 0 ? -1 : 1;
    const L = dist(a.at, b.at), sag = sagOf(L);
    for (const [o, up, w] of CONDUCTORS) {
      const p0: Vec3 = [a.at[0] + a.out[0] * o, a.at[1] + a.out[1] * o, a.h + up];
      const p1: Vec3 = [b.at[0] + b.out[0] * o * flip, b.at[1] + b.out[1] * o * flip, b.h + up];
      let prev = p0;
      for (let k = 1; k <= WIRE_SEGS; k++) {
        const f = k / WIRE_SEGS;
        const p: Vec3 = [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f, p0[2] + (p1[2] - p0[2]) * f - 4 * sag * f * (1 - f)];
        ribbons(mb, prev, p, w);
        prev = p;
      }
    }
  }
  done.push(mb);
  return done.filter((m) => m.indices.length).map((m, i) => m.toKn5(`WIRES_${pad3(i)}`, "wire", { castShadows: false }));
}

/** Two crossed ribbons (flat and upright) from p to q, each with both faces. */
function ribbons(mb: MeshBuilder, p: Vec3, q: Vec3, w: number): void {
  const across = unit(perp([q[0] - p[0], q[1] - p[1]]));
  const h = w / 2;
  const flat: Vec3 = [across[0] * h, across[1] * h, 0];
  const upright: Vec3 = [0, 0, h];
  for (const e of [flat, upright]) {
    const v = (c: Vec3, k: number, u: number, t: number) => mb.vertex([c[0] + e[0] * k, c[1] + e[1] * k, c[2] + e[2] * k], u, t);
    for (const face of [0, 1]) {
      const a = v(p, -1, 0, 0), b = v(q, -1, 1, 0), c = v(q, 1, 1, 1), d = v(p, 1, 0, 1);
      if (face === 1) mb.quad(a, d, c, b);
      else mb.quad(a, b, c, d);
    }
  }
}

// ---- car park lights ----

/**
 * Lights along car park aisles: a pole every 35 m (the first 17 m in), 9 m off the aisle,
 * alternating sides, each with two arms across the aisle and a lantern under each arm's end.
 * With `onRoad` (poleSpot.ts) a pole whose foot lands on a built drivable mesh (another aisle's or a
 * side street's asphalt) moves to the nearest clear spot, further from its aisle first, or is left out.
 */
export function carParkLights(aisles: Vec2[][], ground: HeightFn, blocked: XY, existing: Vec3[] = [], onRoad?: OnRoad): { pieces: Piece[]; lights: Vec3[] } {
  const parts: Piece[] = [];
  const glow: Vec3[] = [];
  const taken: Vec2[] = existing.map((l) => [l[0], l[1]]);
  const order = aisles.filter((a) => a.length >= 2).sort((a, b) => byPosition(a[0], b[0]));
  let side = 1;
  for (const aisle of order) {
    let next = CP_FIRST;
    for (let k = 1; k < aisle.length; k++) {
      const a = aisle[k - 1], b = aisle[k];
      const len = dist(a, b);
      if (!(len > 1e-6)) continue;
      const tan = unit([b[0] - a[0], b[1] - a[1]]), n = perp(tan);
      while (next <= len) {
        const want = add(add(a, tan, next), n, CP_OFF * side);
        const at = clearSpot(want, onRoad, { away: scale(n, side), reach: 3 });
        side = -side;
        next += CP_STEP;
        if (!at || blocked(at[0], at[1]) || taken.some((t) => dist(t, at) < CP_GAP)) continue;
        taken.push(at);
        const h = ground(at[0], at[1]);
        parts.push({ kind: "box", at, along: tan, length: CP_POLE_W, depth: CP_POLE_W, z0: h - SINK, z1: h + CP_POLE_TOP, material: "steel" });
        for (const s of [1, -1]) {
          const d: Vec2 = [n[0] * s, n[1] * s];
          parts.push({ kind: "box", at: add(at, d, CP_ARM / 2), along: d, length: CP_ARM, depth: ARM_W, z0: h + CP_ARM_LO, z1: h + CP_ARM_HI, material: "steel" });
          const mid = add(at, d, CP_LANTERN_OUT);
          parts.push({ kind: "box", at: mid, along: d, length: CP_LANTERN_L, depth: CP_LANTERN_W, z0: h + CP_LANTERN_LO, z1: h + CP_LANTERN_HI, material: "lamp" });
          glow.push([mid[0], mid[1], h + CP_LANTERN_LO - LIGHT_UNDER]);
        }
      }
      next -= len;
    }
  }
  return { pieces: parts, lights: glow };
}
