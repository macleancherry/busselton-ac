// Busselton fork: the AI line through roundabouts, slow and smooth enough for AC's AI.
//
// Retest 4 (31 Oct): on the Busselton town layout the test car ran wide at a roundabout exit and
// stuck beside the green shop (the same spot failed on 30 Oct), and all six cars of a 5-AI race
// piled up at the first roundabout 17 s after the start. The town layout's line is built from the
// router's geometry (layouts.ts routeAi), and it was planned without the world's roundabouts, so:
// - the road smoothing pulled each small ring into a wiggle, with a right-then-left flick of about
//   35 degrees in 6 m at the exit, and keepOnSurface's single-point moves left kinks of 20 to 90
//   degrees between neighbouring points at the ring entries;
// - the line's radius came from the plan's smoothed curvature, not the line itself (35 to 60 m in
//   a ring of 7 m radius), so its speeds said 70 to 100 km/h through the rings, and its hints had
//   nothing for the rings: the whole lap was the 50 zone's 0.5.
// The main drive's line (aiLine.ts) is planned with its rings, but its radius and speeds come from
// the same smoothed curvature (57 to 65 km/h stored through Busselton's ring 0).
//
// What AC's AI respects: it follows fast_lane.ai, steering at a point ahead on the line, so the line
// must flow (no kinks, no flicks), and data/ai_hints.ini, sections [HINT_n] with START and END as
// fractions of the AI line (0 at its first point, 1 at the end of the lap) and VALUE scaling how hard
// the AI drives there (1 normal, 0.5 a lot slower). It has no idea of giving way: cars arriving
// together at a ring touch. So the rings get their own, lower hint from RING_HINT_BEFORE metres before
// the ring to its exit, and the stored speeds and radii are the line's own, capped on the ring.

import type { AiPoint } from "./aiSpline";
import type { Circle } from "./roundabout";

type Vec2 = [number, number];

/** A world roundabout: centre (local metres, x east, y north), outer edge and, when known, island edge. */
export interface WorldRing { c: Vec2; rOut: number; rIn?: number }

/** Speed on a ring, m/s (about 25 km/h). */
export const RING_SPEED = 7;
/** Braking into a ring, m/s^2: gentle, so a queue doesn't concertina. */
const RING_BRAKE = 3;
/** The rings' hint VALUE: the AI's pace there. Lower than any street's speed-limit hint. */
export const RING_HINT = 0.35;
/** The ring hint starts this far before the ring's outer edge, metres along the line. */
export const RING_HINT_BEFORE = 40;
/** ...and ends this far past it on the way out. */
const RING_HINT_AFTER = 5;

const G = 9.81, LATERAL_GRIP = 1.0, BRAKE = 7, ACCEL = 3.5, VMAX = 70;

/**
 * The world's rings as circles for planRoad (road.ts): the route's arc round each is snapped onto
 * the ring's middle (between island and outer edge) before smoothing, instead of smoothed away.
 */
export function ringCircles(rings: WorldRing[]): Circle[] {
  return rings.map((r) => ({ c: r.c, r: r.rIn !== undefined && r.rIn > 0 && r.rIn < r.rOut ? (r.rIn + r.rOut) / 2 : Math.max(2, r.rOut - 3.5) }));
}

const xy = (p: AiPoint): Vec2 => [p.position[0], -p.position[2]];

/** Within the ring's outer edge (plus `pad`)? Local metres. */
const onRing = (q: Vec2, rings: WorldRing[], pad = 0) => rings.some((r) => Math.hypot(q[0] - r.c[0], q[1] - r.c[1]) < r.rOut + pad);

/**
 * Takes the kinks out of a line: each point eased towards the middle of its neighbours, a few
 * times over, but only to places that are still on the drivable surface (`height` non-null), so the
 * line keepOnSurface pulled onto the road stays on it. A smooth curve barely moves (a 7 m ring at
 * 2 m spacing shrinks by centimetres); a single-point jog of a metre is mostly gone. Heights from
 * the surface at the new place. In place; returns the line.
 */
export function smoothKinks(ai: AiPoint[], height: (x: number, y: number) => number | null, closed: boolean, passes = 4): AiPoint[] {
  const n = ai.length;
  if (n < 3) return ai;
  for (let pass = 0; pass < passes; pass++) {
    const pts = ai.map(xy);
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], p = pts[i];
      const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      for (const w of [0.5, 0.25]) {
        const q: Vec2 = [p[0] + (mid[0] - p[0]) * w, p[1] + (mid[1] - p[1]) * w];
        const h = height(q[0], q[1]);
        if (h === null) continue;
        ai[i].position = [q[0], h, -q[1]];
        break;
      }
    }
  }
  return ai;
}

/** Radius of the circle through three points (1000 when they're in line). */
function circumradius(a: Vec2, b: Vec2, c: Vec2): number {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  if (cross < 1e-9) return 1000;
  return Math.min(1000, (ab * bc * ca) / (2 * cross));
}

/**
 * Redoes a line's distances, lengths, directions, radii, speeds and pedals from its own points:
 * the radius from the circle through the points about `chord` metres either side, the speed from
 * that radius (1 g, as aiLine.ts), held to RING_SPEED on a ring and braked into it at RING_BRAKE,
 * and the usual braking and acceleration limits either side. On a ring the AI is told it has
 * 1.5 m either side, as aiLine.ts does. In place; returns the line.
 */
export function retimeAi(ai: AiPoint[], closed: boolean, rings: WorldRing[] = [], chord = 6): AiPoint[] {
  const n = ai.length;
  if (n < 2) return ai;
  const pts = ai.map(xy);
  // Lengths, distances and directions.
  let d = 0;
  ai.forEach((p, i) => {
    const last = i === n - 1;
    const q = ai[(i + 1) % n];
    const L = !closed && last ? 0 : Math.hypot(q.position[0] - p.position[0], q.position[1] - p.position[1], q.position[2] - p.position[2]);
    p.distance = d;
    p.length = L;
    const a = ai[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = ai[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const fx = b.position[0] - a.position[0], fz = b.position[2] - a.position[2], fl = Math.hypot(fx, fz);
    if (fl > 1e-6) p.forward = [fx / fl, 0, fz / fl];
    const run = Math.hypot(q.position[0] - p.position[0], q.position[2] - p.position[2]);
    p.grade = L > 0 && run > 1e-6 ? (q.position[1] - p.position[1]) / run : 0;
    d += L;
  });
  // Radius from the points `chord` metres back and ahead.
  const step = d / Math.max(1, closed ? n : n - 1);
  const k = Math.max(1, Math.round(chord / Math.max(0.1, step)));
  const at = (j: number) => pts[closed ? ((j % n) + n) % n : Math.max(0, Math.min(n - 1, j))];
  const radius = pts.map((_, i) => circumradius(at(i - k), pts[i], at(i + k)));
  const ring = pts.map((q) => onRing(q, rings));
  const passes = closed ? 2 : 1;
  // Braking back from each limit: gently down to a ring's speed (so a queue doesn't concertina),
  // harder for other corners. The lower of the two.
  const brakeBack = (lim: number[], decel: number) => {
    const out = lim.slice();
    for (let p = 0; p < passes; p++) {
      for (let i = n - 2 + (closed ? 1 : 0); i >= 0; i--) {
        const next = (i + 1) % n;
        out[i] = Math.min(out[i], Math.sqrt(out[next] ** 2 + 2 * decel * ai[i].length));
      }
    }
    return out;
  };
  const corner = brakeBack(radius.map((r) => Math.min(VMAX, Math.sqrt(LATERAL_GRIP * G * r))), BRAKE);
  const rings_ = brakeBack(ring.map((r) => (r ? RING_SPEED : VMAX)), RING_BRAKE);
  let v = corner.map((c, i) => Math.min(c, rings_[i]));
  if (!closed) v[0] = Math.min(v[0], 5);
  for (let p = 0; p < passes; p++) {
    for (let i = 1; i < n + (closed ? 1 : 0); i++) {
      const cur = i % n, prev = i - 1;
      v[cur] = Math.min(v[cur], Math.sqrt(v[prev] ** 2 + 2 * ACCEL * ai[prev].length));
    }
  }
  v = v.map((x) => Math.max(3, x));
  ai.forEach((p, i) => {
    p.radius = radius[i];
    p.speed = v[i];
    const slowing = (closed || i < n - 1) && v[(i + 1) % n] < v[i] - 0.05;
    p.gas = slowing ? 0 : 1;
    p.brake = slowing ? 1 : 0;
    if (ring[i]) { p.sideLeft = Math.min(p.sideLeft, 1.5); p.sideRight = Math.min(p.sideRight, 1.5); }
  });
  return ai;
}
