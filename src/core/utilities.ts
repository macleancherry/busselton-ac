// Power poles, overhead wires and street lights: the things that line an
// Australian street above head height, and most of what makes it read as a
// street rather than a road through a field.
//
// Where they are comes from, best first: street-level imagery (Mapillary)
// and OpenStreetMap (power poles, power lines and street lamps, where
// they're mapped). Poles are pulled onto the nature strip if a sighting
// puts them on the road. Wires run along each mapped power line and between
// neighbouring poles on the same side of the street. A lamp beside a pole
// is mounted on it, on an outreach arm over the road.
//
// Busselton fork: every lantern hangs under the end of its arm, and the arm starts inside its pole,
// so the three are one piece (poleCheck.ts checks it). A seen lantern keeps its place: the pole goes
// on the verge and the arm reaches to it. A pole in a median gets two arms. No pole stands on a built
// drivable mesh (poleSpot.ts).
//
// Built-up streets with no lights known get them anyway, at a typical
// spacing, on poles of their own (or on a known power pole nearby). Power
// poles are never invented: newer estates have their power underground.

import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import type { Kn5MeshNode } from "./kn5";
import { MeshBuilder, type Vec3 } from "./mesh";
import type { BuildOptions } from "./options";
import { inRoundabout, type RoadPlan, type SegmentIndex } from "./road";
import { pad } from "./roadMesh";
import { ChunkedMesh } from "./scenery";
import { off, type Piece } from "./furniture";
import { SINK } from "./sceneGround";
import { clearSpot, type OnRoad } from "./poleSpot";

/** Behind the kerb, on the nature strip or verge, metres from the road edge. */
const SET_BACK = 1.0;
const POLE_H = 11;
const ARM_H = 10.3; // crossarm, carrying the high-voltage conductors
const LV_H = 8.4; // the low-voltage bundle, below
const LAMP_H = 8.2;
/** An outreach arm: at least this far, and at most this far, from its pole, metres. */
const REACH_MIN = 1.5;
const REACH_MAX = 4.5;
/** How far past the road edge the lantern hangs, metres. */
const OVER_ROAD = 1.2;
/** Default street light spacing in town, metres. */
const LIGHT_SPACING = 50;

export interface UtilityInput {
  /** Power poles: sightings and mapped poles, local metres. */
  poles: Vec2[];
  /** Street lights. */
  lamps: Vec2[];
  /** Mapped power lines (their vertices are the poles). */
  lines: Vec2[][];
}

interface Spot {
  at: Vec2;
  /** Sample index and side of the road it stands by. */
  i: number;
  side: 1 | -1;
  /** Ground height at its foot. */
  z: number;
  /** Unit vector across the road, away from it. */
  out: Vec2;
  /** Where a sighting put the lantern itself (over the road): the arm reaches to it. */
  head?: Vec2;
}

export interface Utilities {
  pieces: Piece[];
  wires: Kn5MeshNode[];
  /** Lamp heads (local x, y, height), for night lighting. */
  lights: Vec3[];
  poles: number;
}

export function placeUtilities(
  input: UtilityInput,
  plan: RoadPlan,
  index: SegmentIndex,
  opts: BuildOptions,
  /** The ground everything stands on (sceneGround.ts). */
  ground: HeightFn,
  /** How built-up it is at each sample: 0 country, 1 edge of town, 2 town. */
  town: (i: number) => number,
  /** No pole here (a side street, a driveway, a building). */
  blocked: (x: number, y: number) => boolean = () => false,
  /**
   * Busselton fork: true on a built drivable surface (poleSpot.ts). A pole whose foot lands on one
   * (a side street, a junction's mouth) moves to the nearest clear spot, or is dropped.
   */
  onRoad?: OnRoad,
): Utilities {
  // Off the asphalt, straight out first; null when there's nowhere clear close by.
  const clear = (sp: Spot | null): Spot | null => {
    if (!sp || !onRoad) return sp;
    const at = clearSpot(sp.at, onRoad, { radius: 0.35, away: sp.out });
    if (!at) return null;
    return at === sp.at ? sp : { ...sp, at, z: ground(at[0], at[1]) };
  };
  const snap = (p: Vec2): Spot | null => clear(snapRaw(p));
  // A street light sighting: Mapillary sees the lantern, which hangs over the road; the pole goes
  // on the verge beside it and the arm reaches out to where it was seen.
  const snapLamp = (p: Vec2): Spot | null => {
    const sp = snap(p);
    if (!sp) return null;
    const n = index.nearest(p[0], p[1], opts.corridor - 2);
    const d = Math.hypot(sp.at[0] - p[0], sp.at[1] - p[1]);
    if (n && n.dist < plan.samples[n.seg].width / 2 && d >= REACH_MIN && d <= REACH_MAX) sp.head = p;
    return sp;
  };
  const snapRaw = (p: Vec2): Spot | null => {
    const n = index.nearest(p[0], p[1], opts.corridor - 2);
    if (!n || inRoundabout(plan, p[0], p[1], 2)) return null;
    const s = plan.samples[n.seg];
    const side: 1 | -1 = n.t >= 0 ? 1 : -1;
    const half = s.width / 2;
    // A sighting is a few metres out; on the road or its edge means the verge.
    const t = n.dist < half + SET_BACK + 1.5 ? side * (half + SET_BACK) : n.t;
    if (Math.abs(t) > half + 25) return null;
    // Straight across onto the verge, keeping its place along the street.
    const at: Vec2 = [p[0] + s.left[0] * (t - n.t), p[1] + s.left[1] * (t - n.t)];
    return { at, i: n.seg, side, z: ground(at[0], at[1]), out: [s.left[0] * side, s.left[1] * side] };
  };
  const dedupe = (spots: Spot[], r: number) => {
    const out: Spot[] = [];
    for (const p of spots) if (!out.some((q) => Math.hypot(q.at[0] - p.at[0], q.at[1] - p.at[1]) < r)) out.push(p);
    return out;
  };

  // Poles: sightings and mapped poles, then any line vertex not already one.
  const lineVerts = input.lines.flat();
  const poles = dedupe([...input.poles, ...lineVerts].map(snap).filter((p): p is Spot => !!p), 4);
  const lamps = dedupe(input.lamps.map(snapLamp).filter((p): p is Spot => !!p), 4);

  // Default lights along the route in town, where nothing is known nearby.
  const known = [...lamps];
  const near = (list: Spot[], p: Vec2, r: number) => list.find((q) => Math.hypot(q.at[0] - p[0], q.at[1] - p[1]) < r);
  let k = 0;
  for (let sd = LIGHT_SPACING / 2; sd < plan.length; sd += LIGHT_SPACING, k++) {
    const i = sampleAt(plan, sd);
    if (town(i) < 1) continue;
    const s = plan.samples[i];
    // One side on a narrow street; staggered on a wide one.
    const side: 1 | -1 = s.width >= 10 && k % 2 ? -1 : 1;
    const t = side * (s.width / 2 + SET_BACK);
    const at = off(s, t);
    if (near(known, at, LIGHT_SPACING * 0.6) || blocked(at[0], at[1]) || inRoundabout(plan, at[0], at[1], 3)) continue;
    // On a power pole if there's one close by.
    const pole = near(poles, at, 18);
    const spot = pole ?? clear({ at, i, side, z: ground(at[0], at[1]), out: [s.left[0] * side, s.left[1] * side] });
    if (!spot) continue;
    known.push(spot);
    lamps.push(spot);
  }

  const pieces: Piece[] = [];
  const lights: Vec3[] = [];
  for (const p of poles) {
    const s = plan.samples[p.i];
    pieces.push({ kind: "box", at: p.at, along: s.tan, length: 0.28, depth: 0.28, z0: p.z - SINK, z1: p.z + POLE_H, material: "timber" });
    // Crossarm across the line (the line runs along the street).
    pieces.push({ kind: "box", at: p.at, along: p.out, length: 2.2, depth: 0.1, z0: p.z + ARM_H, z1: p.z + ARM_H + 0.12, material: "timber" });
  }
  for (const l of lamps) {
    const s = plan.samples[l.i];
    const onPole = poles.find((p) => Math.hypot(p.at[0] - l.at[0], p.at[1] - l.at[1]) < 3);
    const base = onPole ?? l;
    // A steel pole of its own, unless it's on a power pole.
    if (!onPole) pieces.push({ kind: "box", at: base.at, along: s.tan, length: 0.16, depth: 0.16, z0: base.z - SINK, z1: base.z + LAMP_H + 0.3, material: "steel" });
    // Outreach arms over the road, a lantern under each one's end.
    for (const arm of lampArms(base, l.head, plan, index, onRoad)) {
      const built = outreach(base.at, base.z, arm.dir, arm.reach);
      pieces.push(...built.pieces);
      lights.push(built.light);
    }
  }

  return { pieces, wires: buildWires(spans(poles, input.lines, plan)), lights, poles: poles.length };
}

/**
 * The arms a street light has: one toward the lantern a sighting saw, else one over the road it
 * stands beside, reaching past the road edge; two, back to back, on a pole in a median or on an
 * island with road on both sides (the WA double outreach).
 */
export function lampArms(
  base: { at: Vec2; out: Vec2 },
  head: Vec2 | undefined,
  plan: RoadPlan,
  index: SegmentIndex,
  onRoad?: OnRoad,
): { dir: Vec2; reach: number }[] {
  const clamp = (r: number) => Math.min(REACH_MAX, Math.max(REACH_MIN, r));
  if (head) {
    const d = Math.hypot(head[0] - base.at[0], head[1] - base.at[1]);
    // The lantern's middle is 0.3 m back from the arm's end (outreach), so that's where it was seen.
    if (d > 0.5) return [{ dir: [(head[0] - base.at[0]) / d, (head[1] - base.at[1]) / d], reach: clamp(d + 0.3) }];
  }
  let dir: Vec2 = [-base.out[0], -base.out[1]];
  // Past the edge of the road it's beside (a pole moved further back gets a longer arm).
  const n = index.nearest(base.at[0], base.at[1], 40);
  let gap = n ? Math.max(0, n.dist - plan.samples[n.seg].width / 2) : 1;
  // Over whichever built road is nearest, when that's clearly nearer than the route (a pole moved
  // beside a side street reaches over the side street).
  const hit = onRoad ? nearestRoad(base.at, onRoad, Math.min(gap, 3.5)) : null;
  if (hit && hit.d < gap - 0.5) ({ dir, d: gap } = hit);
  const arms = [{ dir, reach: clamp(gap + OVER_ROAD) }];
  if (onRoad) {
    // Road again a few metres behind it, running the same way (road 8 m either side along it, so not
    // a side street's mouth): a median, so a second arm back over the other carriageway.
    const back: Vec2 = [-dir[0], -dir[1]], tan: Vec2 = [-dir[1], dir[0]];
    for (let d = 0.5; d <= 6; d += 0.5) {
      const p: Vec2 = [base.at[0] + back[0] * d, base.at[1] + back[1] * d];
      if (!onRoad(p[0], p[1])) continue;
      const q = [p[0] + back[0] * 1.5, p[1] + back[1] * 1.5];
      if ([8, -8].every((e) => onRoad(q[0] + tan[0] * e, q[1] + tan[1] * e))) arms.push({ dir: back, reach: clamp(d + OVER_ROAD) });
      break;
    }
  }
  return arms;
}

/** The nearest drivable point within `max` metres, by 16 directions: its direction and distance. */
function nearestRoad(at: Vec2, onRoad: OnRoad, max: number): { dir: Vec2; d: number } | null {
  for (let d = 0.25; d <= max + 1e-9; d += 0.25) {
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8, dir: Vec2 = [Math.cos(a), Math.sin(a)];
      if (onRoad(at[0] + dir[0] * d, at[1] + dir[1] * d)) return { dir, d };
    }
  }
  return null;
}

/**
 * One outreach arm from the pole at `at` (ground `z`), `reach` metres along `dir`, with the lantern
 * hung under its end. The arm starts inside the pole and the lantern overlaps the arm, so pole, arm
 * and lantern are one piece. The boxes, and the light's position.
 */
export function outreach(at: Vec2, z: number, dir: Vec2, reach: number): { pieces: Piece[]; light: Vec3 } {
  const mid: Vec2 = [at[0] + dir[0] * reach / 2, at[1] + dir[1] * reach / 2];
  // The lantern's middle a little back from the arm's end, so all of it is under the arm.
  const lantern: Vec2 = [at[0] + dir[0] * (reach - 0.3), at[1] + dir[1] * (reach - 0.3)];
  return {
    pieces: [
      { kind: "box", at: mid, along: dir, length: reach, depth: 0.08, z0: z + LAMP_H + 0.12, z1: z + LAMP_H + 0.22, material: "steel" },
      { kind: "box", at: lantern, along: dir, length: 0.6, depth: 0.3, z0: z + LAMP_H, z1: z + LAMP_H + 0.16, material: "lamp" },
    ],
    light: [lantern[0], lantern[1], z + LAMP_H - 0.02],
  };
}

function sampleAt(plan: RoadPlan, s: number): number {
  let lo = 0, hi = plan.samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (plan.samples[mid].s < s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

type Span = [Spot, Spot];

/**
 * Pairs of poles a wire runs between: consecutive vertices of each mapped
 * line, and neighbouring poles along the same side of the street.
 */
function spans(poles: Spot[], lines: Vec2[][], plan: RoadPlan): Span[] {
  const out: Span[] = [];
  const has = (a: Spot, b: Spot) => out.some(([p, q]) => (p === a && q === b) || (p === b && q === a));
  const poleAt = (v: Vec2) => poles.find((p) => Math.hypot(p.at[0] - v[0], p.at[1] - v[1]) < 6);
  for (const line of lines) {
    for (let k = 1; k < line.length; k++) {
      const a = poleAt(line[k - 1]), b = poleAt(line[k]);
      if (a && b && a !== b && !has(a, b)) out.push([a, b]);
    }
  }
  for (const side of [1, -1] as const) {
    const row = poles.filter((p) => p.side === side).sort((a, b) => plan.samples[a.i].s - plan.samples[b.i].s);
    for (let k = 1; k < row.length; k++) {
      const a = row[k - 1], b = row[k];
      const ds = plan.samples[b.i].s - plan.samples[a.i].s;
      const d = Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1]);
      // Neighbours a span apart, roughly along the street (not across a bend's chord).
      if (ds >= 15 && ds <= 75 && d > ds * 0.85 && !has(a, b)) out.push([a, b]);
    }
  }
  return out.filter(([a, b]) => {
    const d = Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1]);
    return d >= 8 && d <= 90;
  });
}

/** Conductors: three on the crossarm, the low-voltage bundle below. */
const CONDUCTORS: { across: number; h: number; w: number }[] = [
  { across: -0.9, h: ARM_H + 0.18, w: 0.025 },
  { across: 0, h: ARM_H + 0.18, w: 0.025 },
  { across: 0.9, h: ARM_H + 0.18, w: 0.025 },
  { across: 0.25, h: LV_H, w: 0.05 },
];

/** Sagging wires between each pair of poles: crossed thin ribbons, both faces. */
function buildWires(list: Span[]): Kn5MeshNode[] {
  const cm = new ChunkedMesh(0);
  const SEG = 10;
  for (const [a, b] of list) {
    const L = Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1]);
    const sag = Math.min(1.2, 0.0005 * L * L);
    for (const c of CONDUCTORS) {
      const pa: Vec3 = [a.at[0] + a.out[0] * c.across, a.at[1] + a.out[1] * c.across, a.z + c.h];
      // The far pole's arm faces the same way as this one's, whichever side it's on.
      const flip = a.out[0] * b.out[0] + a.out[1] * b.out[1] < 0 ? -1 : 1;
      const pb: Vec3 = [b.at[0] + b.out[0] * c.across * flip, b.at[1] + b.out[1] * c.across * flip, b.z + c.h];
      const pts: Vec3[] = [];
      for (let k = 0; k <= SEG; k++) {
        const f = k / SEG;
        pts.push([pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f, pa[2] + (pb[2] - pa[2]) * f - 4 * sag * f * (1 - f)]);
      }
      ribbon(cm.next(SEG * 16), pts, c.w);
    }
  }
  return cm.all().map((mb, i) => mb.toKn5(`WIRES_${pad(i)}`, "wire", { castShadows: false }));
}

function ribbon(mb: MeshBuilder, pts: Vec3[], w: number): void {
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k - 1], q = pts[k];
    const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
    const side: Vec3 = [(-dy / l) * w / 2, (dx / l) * w / 2, 0];
    // A flat ribbon seen from above and below, and an upright one seen from either side.
    const flat: [Vec3, Vec3, Vec3, Vec3] = [
      [p[0] - side[0], p[1] - side[1], p[2]], [q[0] - side[0], q[1] - side[1], q[2]],
      [q[0] + side[0], q[1] + side[1], q[2]], [p[0] + side[0], p[1] + side[1], p[2]],
    ];
    const upright: [Vec3, Vec3, Vec3, Vec3] = [
      [p[0], p[1], p[2] - w / 2], [q[0], q[1], q[2] - w / 2], [q[0], q[1], q[2] + w / 2], [p[0], p[1], p[2] + w / 2],
    ];
    twoSided(mb, flat, [0, 0, 1]);
    twoSided(mb, upright, [dy / l, -dx / l, 0]); // counter-clockwise seen from the right of the wire
  }
}

function twoSided(mb: MeshBuilder, c: [Vec3, Vec3, Vec3, Vec3], n: Vec3): void {
  for (const sign of [1, -1]) {
    const i = mb.vertexCount;
    c.forEach((p, j) => {
      mb.vertex(p, j === 1 || j === 2 ? 1 : 0, j >= 2 ? 0 : 1);
      mb.normals!.push(n[0] * sign, n[1] * sign, n[2] * sign);
    });
    if (sign > 0) mb.quad(i, i + 1, i + 2, i + 3);
    else mb.quad(i, i + 3, i + 2, i + 1);
  }
}

/**
 * Busselton fork: car park lights. A tall pole every 35 m along each car park aisle (OSM
 * service=parking_aisle), set beside the bays (9 m off the aisle's centre, alternating sides), with a
 * lantern each way across; none where `blocked` (a road, an aisle, a parked car, a building) or within
 * 20 m of another light.
 */
export function carParkLights(
  aisles: Vec2[][],
  /** The ground the poles stand on (sceneGround.ts). */
  ground: (x: number, y: number) => number,
  blocked: (x: number, y: number) => boolean,
  existing: Vec3[] = [],
): { pieces: Piece[]; lights: Vec3[] } {
  const pieces: Piece[] = [];
  const lights: Vec3[] = [];
  const placed: Vec2[] = existing.map(([x, y]) => [x, y]);
  const H = 8;
  let k = 0;
  for (const line of aisles) {
    // Metres to the next pole, carried from one segment of the aisle to the next.
    let next = 17;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      const tan: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const left: Vec2 = [-tan[1], tan[0]];
      let d = next;
      for (; d < len; d += 35) {
        const side = k++ % 2 ? -1 : 1;
        const at: Vec2 = [a[0] + tan[0] * d + left[0] * 9 * side, a[1] + tan[1] * d + left[1] * 9 * side];
        if (blocked(at[0], at[1]) || placed.some((p) => Math.hypot(p[0] - at[0], p[1] - at[1]) < 20)) continue;
        placed.push(at);
        const z = ground(at[0], at[1]);
        pieces.push({ kind: "box", at, along: tan, length: 0.18, depth: 0.18, z0: z - SINK, z1: z + H + 0.2, material: "steel" });
        // A lantern each way across the aisle, each on a short arm from the pole (they used to hang in the air).
        // The lanterns lie wholly under the arm's ends, so pole, arm and lanterns are one piece.
        pieces.push({ kind: "box", at, along: left, length: 3.0, depth: 0.08, z0: z + H - 0.02, z1: z + H + 0.06, material: "steel" });
        for (const s of [1, -1]) {
          const tip: Vec2 = [at[0] + left[0] * s * 1.15, at[1] + left[1] * s * 1.15];
          pieces.push({ kind: "box", at: tip, along: left, length: 0.6, depth: 0.32, z0: z + H - 0.1, z1: z + H + 0.02, material: "lamp" });
          lights.push([tip[0], tip[1], z + H - 0.12]);
        }
      }
      next = d - len;
    }
  }
  return { pieces, lights };
}
