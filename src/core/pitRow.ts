// Busselton fork: pit boxes in a pit row beside the road, with a pit lane out to them and back.
//
// What AC does with pit boxes (workstation retests 4 and 6, Oct to Nov 2026): every car has a box,
// AC_PIT_<car>. Practice and Track Day start cars there; a race starts them on the grid (AC_START_n)
// but AC still sends a stuck AI car back to its box, and a car in its box only leaves along the pit
// lane (ai/pit_lane.ai). The boxes used to be the grid's own spots on the racing line, and the pit
// lane the racing line under them. So a car sent back sat on the racing line for good, the cars
// behind queued into it, got stuck, were sent back to their own boxes on the line, and so on: on
// free roam every car ended parked at the next car's spawn spot, in town at the grid slots after a
// lap, and on the foreshore at the start (retest 6). AC also stands a pit crew at every box, on the
// road. None of that happened without a pit lane (retest 3), but then nothing could leave a box.
//
// So the boxes go where a parked car blocks nobody: in a row off the carriageway (the verge or a
// shoulder), on flat open ground with nothing standing on it, PIT_CLEAR or more from the AI line,
// on a straight clear of roundabouts and junctions, as near the grid as that can be had. The pit
// lane runs off the AI line, out to the row, past every box and back onto the line (pitLane.ts
// pitLaneAlong turns it into pit_lane.ai). The grid and the spawns (AC_START_n) stay on the line.

import type { AiPoint } from "./aiSpline";
import { frameTransform, type Kn5GroupNode, type Kn5Model, type Kn5Node } from "./kn5";
import type { PitPath } from "./pitLane";

type Xyz = [number, number, number];
type Xz = [number, number];

/** A box's middle is at least this far from the AI line, metres. */
export const PIT_CLEAR = 6;
/** Offsets of the row from the AI line tried, nearest first, metres. */
export const PIT_OFFSETS = [7, 7.5, 8, 8.5, 9, 9.5, 10, 11, 12, 13, 14];
/** Box spacing along the row, metres: roomy first, then nose to tail for a long row. */
export const BOX_GAPS = [8, 6.5];
/** The lane's swing between the AI line and the row, metres along. */
export const PIT_RAMP = 20;
/** The row's ground: at most this much height difference under a box, metres. */
const BOX_FLAT = 0.15;
/** The lane may step this much between samples a metre apart (a kerb), metres. */
const LANE_STEP = 0.22;
/** Something standing this high or more above the ground blocks a box or the lane, metres... */
const STAND_MIN = 0.3;
/** ...up to this (a tree's crown or an awning above is no matter). */
const STAND_MAX = 3;
/** A box stays this far from a junction or a roundabout's edge, metres. */
const JUNCTION_CLEAR = 12;
const RING_CLEAR = 15;
/** The AI line under the row is at least this straight, radius metres. */
const ROW_RADIUS = 80;
/** A box's footprint: half its length and half its width, metres (a car and a little room). */
const HALF_LEN = 2.6, HALF_WID = 1.2;
/** Where a footprint is sampled: every half metre or so (the standing cells are a metre). */
const FOOT_U = Array.from({ length: 11 }, (_, k) => -HALF_LEN + (k * 2 * HALF_LEN) / 10);
const FOOT_V = Array.from({ length: 5 }, (_, k) => -HALF_WID + (k * 2 * HALF_WID) / 4);
/** The lane runs this much nearer the road than the boxes' middles, past their noses, metres. */
export const LANE_SHIFT = 2.5;
/** The lane's width along the row, metres. */
const LANE_WIDTH = 4;

/**
 * Height and kind of the highest physics surface at an AC point (x, z): drivable or not, and
 * carriageway (a road or street, not its kerb, verge or footpath) or not.
 */
export type GroundProbe = (x: number, z: number) => { h: number; drivable: boolean; road: boolean } | null;

const DRIVABLE = /^\d(ROAD|STREET|KERB|GRASS|UNSEALED|UNPAVED)/;
const CARRIAGEWAY = /^\d(ROAD|STREET|UNSEALED|UNPAVED)/;
const isPhysics = (name: string) => /^\d/.test(name);

/** Triangles of a model's meshes chosen by `take`, in a grid of `cell` metre squares over (x, z). */
function triGrid(model: Kn5Model, take: (name: string) => boolean, cell: number) {
  const tri: number[] = []; // ax az ay bx bz by cx cz cy flag
  const flags: number[] = [];
  const grid = new Map<number, number[]>();
  const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
  const walk = (n: Kn5Node) => {
    if (n.kind === "node") return n.children.forEach(walk);
    if (!take(n.name)) return;
    const f = (DRIVABLE.test(n.name) && !/WATER|SAND/.test(n.name) ? 1 : 0) | (CARRIAGEWAY.test(n.name) && !/PATH|GUTTER/.test(n.name) ? 2 : 0);
    const p = n.positions, ix = n.indices;
    for (let i = 0; i < ix.length; i += 3) {
      const t = flags.length;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let c = 0; c < 3; c++) {
        const v = ix[i + c] * 3;
        tri.push(p[v], p[v + 2], p[v + 1]);
        x0 = Math.min(x0, p[v]); x1 = Math.max(x1, p[v]);
        z0 = Math.min(z0, p[v + 2]); z1 = Math.max(z1, p[v + 2]);
      }
      flags.push(f);
      for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) {
        for (let cz = Math.floor(z0 / cell); cz <= Math.floor(z1 / cell); cz++) {
          const list = grid.get(key(cx, cz));
          if (list) list.push(t); else grid.set(key(cx, cz), [t]);
        }
      }
    }
  };
  walk(model.root);
  return { tris: Float32Array.from(tri), flags, grid, key };
}

/** A probe over a model's physics surfaces (walls aside): roads, streets, kerbs, verges and terrain. */
export function groundProbe(model: Kn5Model): GroundProbe {
  const CELL = 4;
  const { tris, flags, grid, key } = triGrid(model, (n) => isPhysics(n) && !/^\dWALL/.test(n), CELL);
  return (x, z) => {
    let best = -Infinity, f = 0;
    for (const t of grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      const o = t * 9;
      const ax = tris[o], az = tris[o + 1], bx = tris[o + 3], bz = tris[o + 4], cx = tris[o + 6], cz = tris[o + 7];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const h = u * tris[o + 2] + v * tris[o + 5] + w * tris[o + 8];
      if (h > best) { best = h; f = flags[t]; }
    }
    return best === -Infinity ? null : { h: best, drivable: (f & 1) === 1, road: (f & 2) === 2 };
  };
}

/**
 * Metre squares (x, z) with something standing on them within `reach` of the line: any mesh but the
 * drivable surfaces (walls, buildings, trees, poles, signs, parked cars) reaching STAND_MIN to
 * STAND_MAX above the ground, found along its triangles' edges every half metre.
 */
export function standingCells(model: Kn5Model, ground: GroundProbe, near: (x: number, z: number) => boolean): Set<number> {
  const cells = new Set<number>();
  const key = (x: number, z: number) => (Math.floor(x) + 32768) * 65536 + (Math.floor(z) + 32768);
  const walk = (n: Kn5Node) => {
    if (n.kind === "node") return n.children.forEach(walk);
    if (DRIVABLE.test(n.name)) return;
    const p = n.positions, ix = n.indices;
    for (let i = 0; i < ix.length; i += 3) {
      const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
      if (!near(p[a], p[a + 2]) && !near(p[b], p[b + 2]) && !near(p[c], p[c + 2])) continue;
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const len = Math.hypot(p[v] - p[u], p[v + 1] - p[u + 1], p[v + 2] - p[u + 2]);
        const steps = Math.max(1, Math.ceil(len / 0.5));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const x = p[u] + (p[v] - p[u]) * t, y = p[u + 1] + (p[v + 1] - p[u + 1]) * t, z = p[u + 2] + (p[v + 2] - p[u + 2]) * t;
          const k = key(x, z);
          if (cells.has(k)) continue;
          const g = ground(x, z);
          if (!g) continue;
          const up = y - g.h;
          if (up >= STAND_MIN && up <= STAND_MAX) cells.add(k);
        }
      }
    }
  };
  walk(model.root);
  return cells;
}

/** The world a pit row is fitted into. */
export interface PitWorld {
  ground: GroundProbe;
  /** Something standing at this AC point (x, z). */
  blocked: (x: number, z: number) => boolean;
}

/** A pit world over a model: its ground, and what stands within 30 m of the given lines. */
export function pitWorld(model: Kn5Model, lines: AiPoint[][]): PitWorld {
  const ground = groundProbe(model);
  const C = 30;
  const zone = new Set<number>();
  const zk = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
  for (const line of lines) for (const p of line) {
    const cx = Math.floor(p.position[0] / C), cz = Math.floor(p.position[2] / C);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) zone.add(zk(cx + i, cz + j));
  }
  const near = (x: number, z: number) => zone.has(zk(Math.floor(x / C), Math.floor(z / C)));
  const cells = standingCells(model, ground, near);
  const key = (x: number, z: number) => (Math.floor(x) + 32768) * 65536 + (Math.floor(z) + 32768);
  return { ground, blocked: (x, z) => cells.has(key(x, z)) };
}

/** Nearest distance (x, z) from a point to a set of lines, by a grid of their segments. */
export function lineDistance(lines: AiPoint[][], reach = 40): (x: number, z: number) => number {
  const CELL = 10;
  const segs: [number, number, number, number][] = [];
  const grid = new Map<number, number[]>();
  const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
  for (const line of lines) {
    const n = line.length;
    const closed = n > 2 && Math.hypot(line[n - 1].position[0] - line[0].position[0], line[n - 1].position[2] - line[0].position[2]) < 50;
    for (let i = 0; i < n - (closed ? 0 : 1); i++) {
      const a = line[i].position, b = line[(i + 1) % n].position;
      const s = segs.length;
      segs.push([a[0], a[2], b[0], b[2]]);
      for (let cx = Math.floor((Math.min(a[0], b[0]) - reach) / CELL); cx <= Math.floor((Math.max(a[0], b[0]) + reach) / CELL); cx++) {
        for (let cz = Math.floor((Math.min(a[2], b[2]) - reach) / CELL); cz <= Math.floor((Math.max(a[2], b[2]) + reach) / CELL); cz++) {
          const l = grid.get(key(cx, cz));
          if (l) l.push(s); else grid.set(key(cx, cz), [s]);
        }
      }
    }
  }
  return (x, z) => {
    let best = reach;
    for (const s of grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      const [ax, az, bx, bz] = segs[s];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return best;
  };
}

/** Where the row goes and what it keeps clear of. */
export interface PitRowOptions {
  /** Metres along the AI line to look first (the grid's front); the search works out from there. */
  near?: number;
  /** Lines the boxes keep PIT_CLEAR from (the layout's own AI line is always one). */
  clearOf?: AiPoint[][];
  /** Roundabouts (AC x, z, outer radius) and junctions (AC x, z) the row keeps clear of. */
  rings?: { c: Xz; rOut: number }[];
  junctions?: Xz[];
}

export interface PitRow {
  /** The boxes, front (nearest the exit) first: position (0.5 m above the ground) and direction. */
  boxes: { pos: Xyz; fwd: Xyz }[];
  /** The pit lane from the AI line out past the boxes and back, in the AI line's direction. */
  lane: PitPath;
  side: 1 | -1;
  offset: number;
}

/** A point along the AI line by distance, with its direction and left (AC x, z). */
function lineFrame(ai: AiPoint[], closed: boolean) {
  const n = ai.length;
  const total = ai[n - 1].distance + (closed ? ai[n - 1].length : 0);
  return {
    total,
    at(d: number): { p: Xyz; f: Xz; left: Xz; i: number } | null {
      if (closed) d = ((d % total) + total) % total;
      else if (d < 0 || d > total) return null;
      let lo = 0, hi = n - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ai[m].distance <= d) lo = m; else hi = m - 1; }
      const a = ai[lo], b = ai[(lo + 1) % n];
      const t = a.length > 1e-6 ? Math.min(1, (d - a.distance) / a.length) : 0;
      const p: Xyz = [a.position[0] + (b.position[0] - a.position[0]) * t, a.position[1] + (b.position[1] - a.position[1]) * t, a.position[2] + (b.position[2] - a.position[2]) * t];
      const L = Math.hypot(a.forward[0], a.forward[2]) || 1;
      const f: Xz = [a.forward[0] / L, a.forward[2] / L];
      // Left of the direction of travel, in AC's x, z (z is south).
      return { p, f, left: [f[1], -f[0]], i: lo };
    },
  };
}

const smooth = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

/**
 * The nearest pit row of `n` boxes to `near` along the AI line: every box on flat, drivable, open
 * ground PIT_CLEAR or more from the lines, and a lane from the line out to the row and back with no
 * step bigger than a kerb and nothing standing on it. Null when there's nowhere it fits.
 */
export function pitRow(ai: AiPoint[], closed: boolean, n: number, world: PitWorld, opts: PitRowOptions = {}): PitRow | null {
  if (ai.length < 2 || n <= 0) return null;
  const line = lineFrame(ai, closed);
  const clear = lineDistance([ai, ...(opts.clearOf ?? [])]);
  const rings = opts.rings ?? [], junctions = opts.junctions ?? [];
  const memo = new Map<number, ReturnType<GroundProbe>>();
  const ground = (x: number, z: number) => {
    const k = (Math.round(x * 4) + 4194304) * 8388608 + (Math.round(z * 4) + 4194304);
    let g = memo.get(k);
    if (g === undefined) { g = world.ground(x, z); memo.set(k, g); }
    return g;
  };
  const near = opts.near ?? 0;
  const tryRow = (front: number, gap: number, side: 1 | -1, off: number, offRoad: boolean): PitRow | null => {
    const back = front - (n - 1) * gap;
    const a = back - HALF_LEN - PIT_RAMP, b = front + HALF_LEN + PIT_RAMP;
    if (!closed && (a < 0 || b > line.total)) return null;
    if (b - a > line.total * 0.8) return null;
    // Straight, and clear of roundabouts, all along.
    for (let d = a; d <= b; d += 4) {
      const fr = line.at(d)!;
      if (ai[fr.i].radius < ROW_RADIUS) return null;
      if (rings.some((r) => Math.hypot(fr.p[0] - r.c[0], fr.p[2] - r.c[1]) < r.rOut + RING_CLEAR)) return null;
    }
    const boxes: { pos: Xyz; fwd: Xyz }[] = [];
    for (let k = 0; k < n; k++) {
      const fr = line.at(front - k * gap)!;
      const cx = fr.p[0] + fr.left[0] * side * off, cz = fr.p[2] + fr.left[1] * side * off;
      if (clear(cx, cz) < PIT_CLEAR) return null;
      if (junctions.some((j) => Math.hypot(cx - j[0], cz - j[1]) < JUNCTION_CLEAR)) return null;
      let lo = Infinity, hi = -Infinity, mid = 0;
      for (const u of FOOT_U) for (const v of FOOT_V) {
        const x = cx + fr.f[0] * u + fr.left[0] * side * v, z = cz + fr.f[1] * u + fr.left[1] * side * v;
        const g = ground(x, z);
        if (!g || !g.drivable || (offRoad && g.road) || world.blocked(x, z)) return null;
        lo = Math.min(lo, g.h); hi = Math.max(hi, g.h);
        if (Math.abs(u) < 1e-9 && Math.abs(v) < 1e-9) mid = g.h;
      }
      if (hi - lo > BOX_FLAT) return null;
      boxes.push({ pos: [cx, mid + 0.5, cz], fwd: [fr.f[0], 0, fr.f[1]] });
    }
    // The lane: off the line over PIT_RAMP metres, along the row on the road's side of the boxes
    // (LANE_SHIFT nearer the line, so a car leaves its box past the ones parked ahead), back over
    // PIT_RAMP metres.
    const pts: Xyz[] = [], widths: number[] = [];
    let last: number | null = null;
    const rowA = back - HALF_LEN, rowB = front + HALF_LEN;
    for (let d = a; d <= b + 1e-6; d += 1) {
      const fr = line.at(d)!;
      const o = (off - LANE_SHIFT) * (d < rowA ? smooth((d - a) / PIT_RAMP) : d > rowB ? smooth((b - d) / PIT_RAMP) : 1);
      const x = fr.p[0] + fr.left[0] * side * o, z = fr.p[2] + fr.left[1] * side * o;
      const g = ground(x, z);
      if (!g || !g.drivable) return null;
      if (o > 2 && [-1, 0, 1].some((v) => world.blocked(x + fr.left[0] * v, z + fr.left[1] * v))) return null;
      if (last !== null && Math.abs(g.h - last) > LANE_STEP) return null;
      last = g.h;
      pts.push([x, g.h, z]);
      widths.push(d < rowA || d > rowB ? 3.5 : LANE_WIDTH);
    }
    return { boxes, lane: { pts, widths }, side, offset: off };
  };
  // Off the carriageway (on a verge, not in the other lane, where traffic drives) if it can be had
  // anywhere, then anywhere drivable. Roomy boxes first. Out from `near` both ways, 5 m at a time,
  // round the whole line.
  for (const offRoad of [true, false]) for (const gap of BOX_GAPS) {
    for (let k = 0; k * 5 <= line.total; k++) {
      for (const front of k ? [near - k * 5, near + k * 5] : [near]) {
        for (const off of PIT_OFFSETS) {
          for (const side of [1, -1] as const) {
            const r = tryRow(front, gap, side, off, offRoad);
            if (r) return r;
          }
        }
      }
    }
  }
  return null;
}

/** How far along the AI line a point (AC x, z) is: the nearest point's distance. */
export function distanceAlong(ai: AiPoint[], x: number, z: number): number {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < ai.length; i++) {
    const d = Math.hypot(ai[i].position[0] - x, ai[i].position[2] - z);
    if (d < bd) { bd = d; bi = i; }
  }
  return ai[bi].distance;
}

/**
 * Adds AC_PIT_0..count-1 to a layout's dummies (those not already there: hand-placed bays) in a pit
 * row (pitRow), near the grid's front (AC_START_0), and returns its pit lane. With no row anywhere,
 * the boxes go beside the grid's front PIT_CLEAR + 2 m off the line on its left, with no pit lane
 * (AC logs NO PIT LANE FOUND; a car in a box then makes its own way onto the line), and `warn` says so.
 */
export function addPitRow(dummies: Kn5GroupNode[], ai: AiPoint[], closed: boolean, count: number, world: PitWorld | null, opts: PitRowOptions = {}, warn: (m: string) => void = () => {}): PitPath | null {
  const has = new Set(dummies.map((d) => d.name));
  const missing = Array.from({ length: count }, (_, k) => k).filter((k) => !has.has(`AC_PIT_${k}`));
  if (!missing.length || ai.length < 2) return null;
  const s0 = dummies.find((d) => d.name === "AC_START_0");
  const near = opts.near ?? (s0 ? distanceAlong(ai, s0.transform[12], s0.transform[14]) : 0);
  const row = world ? pitRow(ai, closed, missing.length, world, { ...opts, near }) : null;
  const node = (name: string, pos: Xyz, fwd: Xyz): Kn5GroupNode => ({ kind: "node", name, transform: frameTransform(pos, fwd), children: [] });
  if (row) {
    missing.forEach((k, j) => dummies.push(node(`AC_PIT_${k}`, row.boxes[j].pos, row.boxes[j].fwd)));
    return row.lane;
  }
  warn(`no room for a pit row of ${missing.length} boxes beside the road: boxes beside the grid, no pit lane`);
  const line = lineFrame(ai, closed);
  missing.forEach((k, j) => {
    const fr = line.at(closed ? near - j * BOX_GAPS[0] : Math.max(0, near - j * BOX_GAPS[0]))!;
    const off = PIT_CLEAR + 2;
    const x = fr.p[0] + fr.left[0] * off, z = fr.p[2] + fr.left[1] * off;
    const h = world?.ground(x, z)?.h ?? fr.p[1];
    dummies.push(node(`AC_PIT_${k}`, [x, h + 0.5, z], [fr.f[0], 0, fr.f[1]]));
  });
  return null;
}
