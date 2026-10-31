// Busselton fork: keep left. The AI line is the road's centreline, so AI cars (AI Flood on free
// roam, several-car tests, two-way traffic) drive down the middle of town streets. Australia drives
// on the left: with `aiKeepLeft` the line sits in the left lane, a quarter of the road's own width
// left of centre, and stays centred on narrow (single-lane) streets and through roundabouts.

import type { RoadPlan } from "./road";
import { outerRadius } from "./roundabout";
import { bayBand, LANE_CLEAR, type BayBox } from "./bayLanes";

type Vec2 = [number, number];

/** Streets narrower than this (metres of asphalt) are one lane: the line stays centred. */
export const NARROW = 5;
/** Width over which the offset fades in above NARROW, metres. */
const NARROW_FADE = 1;
/** The line's room from the kerb: half a car (0.9 m) and half a metre. */
const KERB_ROOM = 1.4;
/** Centred within this far outside a roundabout's outer edge, metres... */
const RING_GAP = 4;
/** ...and back to the full offset over the next this many metres. */
const RING_FADE = 18;
/** Half-width of the smoothing along the line, metres (widths jump at junctions). */
const SMOOTH = 10;

/** The offset (metres to the left of the driving direction) for a road this wide. */
export function laneOffset(width: number): number {
  if (!(width > NARROW)) return 0;
  const full = Math.max(0, Math.min(width / 4, width / 2 - KERB_ROOM));
  return full * Math.min(1, (width - NARROW) / NARROW_FADE);
}

/**
 * Each sample's keep-left offset, metres to the left of the centreline: a quarter of the road's
 * width (laneOffset), faded to nothing at roundabouts (the line keeps its smoothed, centred way
 * round the ring and its arms) and smoothed along the line. With `bays` (kerbside.ts boxes on the
 * route), moved in to keep half a lane off them (negative where bays on the left push it right of centre).
 */
export function keepLeftOffsets(plan: RoadPlan, bays: BayBox[] = []): number[] {
  const s = plan.samples, n = s.length;
  if (!n) return [];
  const smoothed = smoothOffsets(plan);
  // Busselton fork: clear of the route's painted kerbside bays (bayLanes.ts), as a traffic lane is:
  // half a lane from a bay each side. Where both can't be cleared the line stays as it was.
  const band = bays.length ? bayBand(s.map((p) => p.pos), s.map((p) => p.width), bays, plan.closed) : null;
  if (!band) return smoothed;
  return smoothed.map((o, i) => {
    const hi = band.hi[i] === null ? Infinity : band.hi[i]! - LANE_CLEAR;
    const lo = band.lo[i] === null ? -Infinity : band.lo[i]! + LANE_CLEAR;
    if (hi < lo) return o;
    return Math.max(lo, Math.min(hi, o));
  });
}

function smoothOffsets(plan: RoadPlan): number[] {
  const s = plan.samples, n = s.length;
  const raw = s.map((p) => {
    let f = 1;
    for (const rb of plan.roundabouts) {
      const d = Math.hypot(p.pos[0] - rb.c[0], p.pos[1] - rb.c[1]) - outerRadius(rb) - RING_GAP;
      f = Math.min(f, Math.max(0, Math.min(1, d / RING_FADE)));
    }
    return laneOffset(p.width) * f;
  });
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.hypot(s[i].pos[0] - s[i - 1].pos[0], s[i].pos[1] - s[i - 1].pos[1]);
  const step = n > 1 ? total / (n - 1) : 1;
  const W = Math.max(1, Math.round(SMOOTH / Math.max(0.1, step)));
  const at = (j: number) => (plan.closed ? raw[((j % n) + n) % n] : raw[Math.max(0, Math.min(n - 1, j))]);
  // A triangle window (widths jump at junctions; offsets fade rather than step), capped so a car on
  // the line stays clear of the left kerb on its own stretch of road.
  return raw.map((_, i) => {
    let sum = 0, wsum = 0;
    for (let k = -W; k <= W; k++) {
      const w = W + 1 - Math.abs(k);
      sum += at(i + k) * w;
      wsum += w;
    }
    return Math.max(0, Math.min(sum / wsum, s[i].width / 2 - 1.1));
  });
}

/**
 * Which way the route goes round each roundabout: the angle swept round its centre while on it,
 * radians, positive anticlockwise (seen from above). Australia's rings go clockwise (negative).
 */
export function ringSweeps(plan: RoadPlan): number[] {
  return plan.roundabouts.map((rb) => {
    let sweep = 0, prev: number | null = null;
    for (const p of plan.samples) {
      const dx = p.pos[0] - rb.c[0], dy = p.pos[1] - rb.c[1];
      if (Math.hypot(dx, dy) > outerRadius(rb) + 1) { prev = null; continue; }
      const a = Math.atan2(dy, dx);
      if (prev !== null) {
        let d = a - prev;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        sweep += d;
      }
      prev = a;
    }
    return sweep;
  });
}

/**
 * Where an AI line point sits across the drivable surface under it: how far it is from the
 * surface's edge on its left and on its right, metres, along the ground perpendicular to its
 * direction (AC coordinates: X east, Y up, Z south; `height(x, y)` takes local x east, y north and
 * is null off the surface). Null where either edge is further than `reach` (a junction, a car park,
 * the open area of a roundabout), since the road's middle can't be told there.
 */
export function lateralPlace(
  position: [number, number, number], forward: [number, number, number],
  height: (x: number, y: number) => number | null, reach = 9, step = 0.25,
): { left: number; right: number } | null {
  const L = Math.hypot(forward[0], forward[2]);
  if (L < 1e-6) return null;
  // Left of the direction, in AC x/z: (fz, -fx) normalised.
  const lx = forward[2] / L, lz = -forward[0] / L;
  const x0 = position[0], z0 = position[2];
  const on = (x: number, z: number) => height(x, -z) !== null;
  if (!on(x0, z0)) return null;
  const edge = (sign: number): number | null => {
    for (let r = step; r <= reach; r += step) if (!on(x0 + sign * lx * r, z0 + sign * lz * r)) return r - step / 2;
    return null;
  };
  const left = edge(1), right = edge(-1);
  return left === null || right === null ? null : { left, right };
}

/**
 * The keep-left check over an AI line: of the points where the road's two edges can be found
 * (lateralPlace) on a road wide enough for two lanes, the share whose point sits left of the
 * road's middle by at least `margin` metres. Points the line itself marks as centred (equal room
 * each side: roundabouts, narrow streets) are left out.
 */
export function keepLeftShare(
  pts: { position: [number, number, number]; forward: [number, number, number]; sideLeft: number; sideRight: number }[],
  height: (x: number, y: number) => number | null, margin = 0.3,
): { measured: number; left: number; share: number; worst: Vec2 | null } {
  let measured = 0, left = 0, worst: Vec2 | null = null, worstBy = Infinity;
  for (const p of pts) {
    if (p.sideRight - p.sideLeft < 0.5) continue;
    const lp = lateralPlace(p.position, p.forward, height);
    if (!lp || lp.left + lp.right < NARROW + 0.5) continue;
    measured++;
    const by = (lp.right - lp.left) / 2; // metres left of the middle
    if (by >= margin) left++;
    else if (by < worstBy) { worstBy = by; worst = [p.position[0], p.position[2]]; }
  }
  return { measured, left, share: measured ? left / measured : 1, worst };
}
