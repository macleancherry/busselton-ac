// The AI line: the road centreline with a speed profile from corner radii
// (lateral grip), limited by braking into corners and acceleration out.

import type { AiPoint } from "./aiSpline";
import { toAc } from "./mesh";
import type { RoadPlan } from "./road";
import { innerRadius, outerRadius } from "./roundabout";

const G = 9.81;
const LATERAL_GRIP = 1.0; // g
const BRAKE = 7; // m/s^2
const ACCEL = 3.5; // m/s^2
const VMAX = 70; // m/s
const KERB_CLEARANCE = 1.0; // m

/** How far either side of a roundabout the line is smoothed, metres. */
const RING_REACH = 25;
/** Half-width of the smoothing window through a roundabout, metres. */
const RING_SMOOTH = 8;
/** Room the AI is told it has either side of the line near a roundabout, metres. */
const RING_SIDE = 1.5;

/**
 * Through roundabouts the centreline kinks where an arm meets the ring, and AC's AI (steering at a
 * point ahead) cuts the kinks: across the corner between the ring and the exit, over the kerb.
 * Smooth the line there, and keep it clear of the island.
 */
function ringLine(plan: RoadPlan): { pos: [number, number][]; nearRing: boolean[] } {
  const s = plan.samples, n = s.length;
  const nearRing = s.map((p) => plan.roundabouts.some((rb) => Math.hypot(p.pos[0] - rb.c[0], p.pos[1] - rb.c[1]) < outerRadius(rb) + RING_REACH));
  if (!plan.roundabouts.length || n < 3) return { pos: s.map((p) => [p.pos[0], p.pos[1]]), nearRing };
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.hypot(s[i].pos[0] - s[i - 1].pos[0], s[i].pos[1] - s[i - 1].pos[1]);
  const W = Math.max(2, Math.round(RING_SMOOTH / (total / (n - 1))));
  const at = (j: number) => (plan.closed ? s[((j % n) + n) % n] : s[Math.max(0, Math.min(n - 1, j))]);
  const pos = s.map((p, i): [number, number] => {
    if (!nearRing[i]) return [p.pos[0], p.pos[1]];
    let x = 0, y = 0, wsum = 0;
    for (let k = -W; k <= W; k++) {
      const w = W + 1 - Math.abs(k);
      const q = at(i + k);
      x += q.pos[0] * w;
      y += q.pos[1] * w;
      wsum += w;
    }
    x /= wsum;
    y /= wsum;
    for (const rb of plan.roundabouts) {
      const dx = x - rb.c[0], dy = y - rb.c[1], d = Math.hypot(dx, dy);
      // Clear of the island. (Not pulled in from the outer edge: the arms join there.)
      const lo = innerRadius(rb) + 1.5;
      if (d < lo && d > 1e-6) {
        const k = lo / d;
        x = rb.c[0] + dx * k;
        y = rb.c[1] + dy * k;
      }
    }
    return [x, y];
  });
  return { pos, nearRing };
}

export function buildAiLine(plan: RoadPlan): AiPoint[] {
  const s = plan.samples;
  const n = s.length;
  const { pos, nearRing } = ringLine(plan);
  const radius = s.map((p) => Math.min(1000, 1 / Math.max(1e-3, Math.abs(p.curvature))));
  const seg = s.map((p, i) => {
    if (!plan.closed && i === n - 1) return 0;
    const j = (i + 1) % n;
    return Math.hypot(pos[j][0] - pos[i][0], pos[j][1] - pos[i][1], s[j].h - p.h);
  });
  let v = radius.map((r) => Math.min(VMAX, Math.sqrt(LATERAL_GRIP * G * r)));
  // Loops are run twice around so the limits carry across the start line.
  const passes = plan.closed ? 2 : 1;
  for (let p = 0; p < passes; p++) {
    for (let i = n - 2 + (plan.closed ? 1 : 0); i >= 0; i--) {
      const next = (i + 1) % n;
      v[i] = Math.min(v[i], Math.sqrt(v[next] ** 2 + 2 * BRAKE * seg[i]));
    }
  }
  // Open roads start from a standstill on the grid.
  if (!plan.closed) v[0] = Math.min(v[0], 5);
  for (let p = 0; p < passes; p++) {
    for (let i = 1; i < n + (plan.closed ? 1 : 0); i++) {
      const cur = i % n, prev = i - 1;
      v[cur] = Math.min(v[cur], Math.sqrt(v[prev] ** 2 + 2 * ACCEL * seg[prev]));
    }
  }
  v = v.map((x) => Math.max(3, x));

  let distance = 0;
  return s.map((p, i) => {
    const q = s[(i + 1) % n];
    const grade = seg[i] > 0 ? (q.h - p.h) / seg[i] : 0;
    const bankAngle = Math.atan(Math.abs(p.bank));
    const slowing = (plan.closed || i < n - 1) && v[(i + 1) % n] < v[i] - 0.05;
    const point: AiPoint = {
      position: toAc(pos[i][0], pos[i][1], p.h),
      distance,
      speed: v[i],
      gas: slowing ? 0 : 1,
      brake: slowing ? 1 : 0,
      radius: radius[i],
      // The AI keeps within these: a metre short of each edge, so it doesn't clip the kerbs
      // (a 15 cm kerb stops a low race car, and it can't climb back on).
      sideLeft: nearRing[i] ? RING_SIDE : Math.max(1, p.width / 2 - KERB_CLEARANCE),
      sideRight: nearRing[i] ? RING_SIDE : Math.max(1, p.width / 2 - KERB_CLEARANCE),
      camber: bankAngle,
      direction: p.bank >= 0 ? 1 : -1,
      normal: [0, 1, 0],
      length: seg[i],
      forward: (() => {
        // Along the (possibly smoothed) line.
        const a = pos[Math.max(0, i - 1)], b = pos[plan.closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return L > 1e-6 ? toAc((b[0] - a[0]) / L, (b[1] - a[1]) / L, 0) : toAc(p.tan[0], p.tan[1], 0);
      })(),
      grade,
    };
    distance += seg[i];
    return point;
  });
}

/**
 * data/ai_hints.ini: the AI slows to VALUE x its own speed between START and END (fractions of the
 * lap). AC's AI works out its own corner speeds and takes town corners too fast for kerbed
 * streets, so tight corners (radius under 40 m) get a hint from 60 m before to 20 m after.
 */
export function aiHintsIni(points: AiPoint[]): string {
  const total = points.length ? points[points.length - 1].distance + points[points.length - 1].length : 0;
  if (!total) return "";
  const hints: { s0: number; s1: number; value: number }[] = [];
  for (const p of points) {
    if (p.radius >= 40) continue;
    const value = p.radius < 20 ? 0.6 : 0.72;
    const s0 = p.distance - 60, s1 = p.distance + 20;
    const last = hints[hints.length - 1];
    if (last && s0 <= last.s1) {
      last.s1 = s1;
      last.value = Math.min(last.value, value);
    } else hints.push({ s0, s1, value });
  }
  // One across the start line becomes two, each inside 0..1.
  const spans: [number, number, number][] = [];
  for (const h of hints) {
    const a = h.s0 / total, b = h.s1 / total;
    if (a < 0) spans.push([a + 1, 1, h.value], [0, b, h.value]);
    else if (b > 1) spans.push([a, 1, h.value], [0, b - 1, h.value]);
    else spans.push([a, b, h.value]);
  }
  return spans.map(([a, b, v], i) => `[HINT_${i}]\nSTART=${a.toFixed(5)}\nEND=${b.toFixed(5)}\nVALUE=${v}\n`).join("\n");
}
