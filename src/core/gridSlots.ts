// Busselton fork: where the race grid and the pit boxes go. AC has no pit lane on these tracks, so
// every car starts on the road: the grid (AC_START_n) and the boxes (AC_PIT_n) are spots on the
// AI line. A grid laid back from the start line, whatever the road does there, put cars round a
// roundabout at angles, side-on across an exit, and the back of the grid never got going (retest 3,
// 31 Oct). So the grid goes on the nearest straight stretch before the line that is clear of
// roundabouts and junctions, nose to tail along the line, and AI Flood's boxes on straights too.

import type { RoadPlan } from "./road";
import { outerRadius } from "./roundabout";
import type { AiPoint } from "./aiSpline";

type Vec2 = [number, number];

/** What a grid or a pit box keeps clear of, local metres (x east, y north). */
export interface GridAvoid {
  /** Roundabouts (on top of the plan's own). */
  rings?: { c: Vec2; rOut: number }[];
  /** Points where a side street meets or crosses the road. */
  junctions?: Vec2[];
}

/** Nose to tail spacing, metres (a car is about 4 m). */
export const GRID_GAP = 8;
/** Straight enough for a grid: radius at least this, metres. */
export const GRID_MIN_RADIUS = 150;
/** Clear of a roundabout's outer edge by this, metres. */
export const RING_CLEAR = 15;
/** Clear of a junction by this, metres. */
export const JUNCTION_CLEAR = 15;

const clearOf = (p: Vec2, avoid: Required<GridAvoid>) =>
  !avoid.rings.some((r) => Math.hypot(p[0] - r.c[0], p[1] - r.c[1]) < r.rOut + RING_CLEAR)
  && !avoid.junctions.some((j) => Math.hypot(p[0] - j[0], p[1] - j[1]) < JUNCTION_CLEAR);

/** Each sample: on a straight, clear of roundabouts (the plan's and `avoid`'s) and junctions. */
export function clearSamples(plan: RoadPlan, avoid: GridAvoid = {}): boolean[] {
  const all: Required<GridAvoid> = {
    rings: [...plan.roundabouts.map((rb) => ({ c: rb.c, rOut: outerRadius(rb) })), ...(avoid.rings ?? [])],
    junctions: avoid.junctions ?? [],
  };
  return plan.samples.map((s) => Math.abs(s.curvature) < 1 / GRID_MIN_RADIUS && clearOf(s.pos, all));
}

/**
 * Where the front of the grid goes, metres along the road, for `n` cars GRID_GAP apart: the
 * nearest place behind `line` (the start line) where every slot, and a car length either end, is
 * on clear road (clearSamples). On a loop it may be anywhere in the lap before the line (negative
 * means before s = 0); point to point, between the road's start and the line. Null when nowhere fits.
 */
export function gridFront(plan: RoadPlan, n: number, line: number, avoid: GridAvoid = {}): number | null {
  const ok = clearSamples(plan, avoid);
  const ns = plan.samples.length, L = plan.length;
  if (ns < 2 || n <= 0) return null;
  const step = L / (plan.closed ? ns : ns - 1);
  const at = (s: number) => {
    if (plan.closed) s = ((s % L) + L) % L;
    else if (s < 0 || s > plan.samples[ns - 1].s) return false;
    return ok[Math.max(0, Math.min(ns - 1, Math.round(s / step)))];
  };
  const depth = (n - 1) * GRID_GAP;
  const fits = (front: number) => {
    for (let s = front + 4; s >= front - depth - 4; s -= Math.min(2, step)) if (!at(s)) return false;
    return true;
  };
  const first = line - GRID_GAP;
  const last = plan.closed ? line - L + depth + 2 * GRID_GAP : depth + 4;
  for (let front = first; front >= last; front -= 1) if (fits(front)) return front;
  return null;
}

/**
 * A slot's place: metres along the road and across it (left of the centreline). On a town street
 * (keepLeft, or under 8 m wide) single file in the AI line's lane, staggered half a metre either
 * side of it where the lane has room; on a wide circuit without keep-left, the usual two columns.
 */
export function gridSlot(k: number, front: number, width: number, laneOffset: number, single: boolean): { s: number; t: number } {
  if (!single) {
    const row = Math.floor(k / 2);
    return { s: front - row * GRID_GAP, t: (k % 2 === 0 ? 1 : -1) * width / 4 };
  }
  // Room in the lane either side of a 1.9 m car, kept half a metre from the lane's edges.
  const lane = laneOffset > 0 ? width / 2 : width;
  const room = Math.max(0, (lane - 1.9) / 2 - 0.5);
  const stagger = Math.min(0.5, room) * (k % 2 === 0 ? 1 : -1);
  return { s: front - k * GRID_GAP, t: laneOffset + stagger };
}

/**
 * Points where streets meet or cross a road: points of `lines` within `reach` metres of `road`
 * that run across it (more than 35 degrees off its direction). Rounded to 5 m and deduplicated.
 */
export function junctionsOn(road: Vec2[], lines: Vec2[][], reach = 6): Vec2[] {
  if (road.length < 2) return [];
  const CELL = 10;
  const grid = new Map<string, number[]>();
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1], b = road[i];
    for (let cx = Math.floor((Math.min(a[0], b[0]) - reach) / CELL); cx <= Math.floor((Math.max(a[0], b[0]) + reach) / CELL); cx++) {
      for (let cy = Math.floor((Math.min(a[1], b[1]) - reach) / CELL); cy <= Math.floor((Math.max(a[1], b[1]) + reach) / CELL); cy++) {
        const key = `${cx},${cy}`;
        const l = grid.get(key);
        if (l) l.push(i); else grid.set(key, [i]);
      }
    }
  }
  const cos35 = Math.cos((35 * Math.PI) / 180);
  const out = new Map<string, Vec2>();
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const p = line[i - 1], q = line[i];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-6) continue;
      const d: Vec2 = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
      const steps = Math.max(1, Math.ceil(len / 3));
      for (let k = 0; k <= steps; k++) {
        const x = p[0] + (q[0] - p[0]) * (k / steps), y = p[1] + (q[1] - p[1]) * (k / steps);
        for (const j of grid.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) ?? []) {
          const a = road[j - 1], b = road[j];
          const bx = b[0] - a[0], by = b[1] - a[1], bl = Math.hypot(bx, by);
          if (bl < 1e-6) continue;
          const t = Math.max(0, Math.min(1, ((x - a[0]) * bx + (y - a[1]) * by) / (bl * bl)));
          const cx = a[0] + bx * t, cy = a[1] + by * t;
          if (Math.hypot(x - cx, y - cy) > reach) continue;
          if (Math.abs((d[0] * bx + d[1] * by) / bl) > cos35) continue;
          const key = `${Math.round(cx / 5)},${Math.round(cy / 5)}`;
          if (!out.has(key)) out.set(key, [Math.round(cx / 5) * 5, Math.round(cy / 5) * 5]);
          break;
        }
      }
    }
  }
  return [...out.values()];
}

/** An AI line point is clear for a box or a grid slot: straight, off roundabouts and junctions. */
export function clearAiPoint(p: AiPoint, avoid: GridAvoid = {}): boolean {
  const xy: Vec2 = [p.position[0], -p.position[2]];
  return p.radius >= GRID_MIN_RADIUS && clearOf(xy, { rings: avoid.rings ?? [], junctions: avoid.junctions ?? [] });
}
