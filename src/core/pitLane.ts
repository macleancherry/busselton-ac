// Busselton fork: pit_lane.ai and data/ideal_line.ai for each layout.
//
// AC looks for <layout>/ai/pit_lane.ai beside fast_lane.ai, and logs "NO PIT LANE FOUND" without
// it. On a Kunos track it's an AI line in the same format (version 7, with the lookup grid),
// recorded from the racing line before the pit entry, down the pit lane past the boxes and back
// onto the racing line after the exit; the AI follows it out of its box and when it pits.
//
// It must be a lane of its own. The first pit lanes here were the stretch of racing line under the
// grid, with the boxes on the grid's spots: AC sends a stuck AI car back to its box, and those cars
// then sat on the racing line for good while the rest piled into them (retests 4 and 6, pitRow.ts).
// Now every pit lane runs off the line to boxes that stand clear of it: a circuit's paved pit lane
// (build.pitLane, pitRoad.ts) past its real bays, or a pit row beside the road (pitRow.ts). Either
// way pitLaneAlong builds it: the AI line up to where the lane leaves it, the lane, the AI line on
// from where it rejoins. Without one (no room for a pit row anywhere) there's no pit_lane.ai.
//
// AC loads the ideal line (the driving line aid and the race engineer's line) from
// <layout>/data/ideal_line.ai, or, without that file, from the AI line ("IDEAL LINE FROM AI LINE"),
// and then the race engineer says "NO IDEAL LINE FOUND" for every car. So each layout ships its AI
// line as data/ideal_line.ai too.
//
// "WARNING: TRACK :: NO POSITION DATA FOUND", logged straight after the ideal line, isn't about
// any of this, and no file of ours removes it: it stayed with the ideal line from its own file, with
// the lookup grid (retest 4, 31 Oct 2026), and Kunos's own tracks log it at the same point after
// loading their own data/ideal_line.ai (Mugello, with and without CSP: GTPlanet "Assetto Corsa PC
// Mods General Discussion" p. 1820; ks_barcelona: docs/verification.md). It's harmless; don't chase it.

import { writeFastLaneAi, type AiPoint } from "./aiSpline";

type Xyz = [number, number, number];

/** The pit lane starts this far before where it leaves the AI line, metres... */
export const PIT_BEFORE = 40;
/** ...and ends this far after it rejoins. */
export const PIT_AFTER = 60;

/** A built pit lane (pitRoad.ts): its centreline in AC space, entry to exit or reversed, and widths. */
export interface PitPath {
  pts: Xyz[];
  widths: number[];
}

/** AI speed down a paved pit lane, m/s (60 km/h, a common circuit pit limit). */
export const PIT_LANE_SPEED = 60 / 3.6;

/**
 * The pit lane along a paved lane (build.pitLane): the AI line for PIT_BEFORE metres up to where the
 * lane leaves it, the lane's own points, then the AI line for PIT_AFTER metres from where the lane
 * rejoins it. The lane is turned round if it was given against the AI line's direction. Null when
 * either end of the lane is further than `reach` metres from the AI line, or it has under two points.
 */
export function pitLaneAlong(ai: AiPoint[], lane: PitPath, closed: boolean, reach = 30): AiPoint[] | null {
  const n = ai.length;
  if (n < 2 || lane.pts.length < 2) return null;
  const nearest = (p: Xyz) => {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(ai[i].position[0] - p[0], ai[i].position[2] - p[2]);
      if (d < bd) { bd = d; bi = i; }
    }
    return { i: bi, d: bd };
  };
  const dir = (a: Xyz, b: Xyz): [number, number] => {
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    return [(b[0] - a[0]) / L, (b[2] - a[2]) / L];
  };
  let pts = lane.pts, widths = lane.widths;
  let e = nearest(pts[0]), x = nearest(pts[pts.length - 1]);
  if (e.d > reach || x.d > reach) return null;
  // Along the AI line at both ends, or against it (then the lane runs the other way).
  const m = pts.length - 1;
  const d0 = dir(pts[0], pts[1]), d1 = dir(pts[m - 1], pts[m]);
  const f0 = ai[e.i].forward, f1 = ai[x.i].forward;
  if (d0[0] * f0[0] + d0[1] * f0[2] + d1[0] * f1[0] + d1[1] * f1[2] < 0) {
    pts = [...pts].reverse();
    widths = [...widths].reverse();
    [e, x] = [x, e];
  }
  const copy = (p: AiPoint): AiPoint => ({ ...p, position: [...p.position], normal: [...p.normal], forward: [...p.forward] });
  const out: AiPoint[] = [];
  // The AI line up to the entry (not the point beside it).
  const before: AiPoint[] = [];
  for (let k = 1, run = 0; k < n && run < PIT_BEFORE; k++) {
    const i = e.i - k;
    if (i < 0 && !closed) break;
    const p = ai[(i + n) % n];
    run += p.length;
    before.unshift(copy(p));
  }
  out.push(...before);
  // The lane (directions, grades and radii below).
  const first = out.length;
  pts.forEach((q, k) => {
    const half = widths[k] / 2;
    out.push({
      position: [...q], distance: 0, speed: PIT_LANE_SPEED, gas: 0.3, brake: 0, radius: 0,
      sideLeft: half, sideRight: half, camber: 0, direction: 1, normal: [0, 1, 0], length: 0,
      forward: [0, 0, 1], grade: 0,
    });
  });
  const last = out.length - 1;
  // The AI line on from the exit (not the point beside it).
  for (let k = 1, run = 0; k < n && run < PIT_AFTER; k++) {
    const i = x.i + k;
    if (i >= n && !closed) break;
    const p = ai[i % n];
    out.push(copy(p));
    run += p.length;
  }
  if (out.length < 2) return null;
  // Distances and lengths through the whole line.
  let dist = 0;
  for (let k = 0; k < out.length; k++) {
    const p = out[k], q = out[k + 1];
    p.distance = dist;
    p.length = q ? Math.hypot(q.position[0] - p.position[0], q.position[1] - p.position[1], q.position[2] - p.position[2]) : 0;
    dist += p.length;
  }
  for (let k = first; k <= last; k++) {
    const a = out[Math.max(0, k - 1)], p = out[k], b = out[Math.min(out.length - 1, k + 1)];
    const dx = b.position[0] - a.position[0], dz = b.position[2] - a.position[2], H = Math.hypot(dx, dz) || 1;
    p.forward = [dx / H, 0, dz / H];
    p.grade = (b.position[1] - a.position[1]) / H;
    p.radius = turnRadius(a.position, p.position, b.position);
  }
  return out;
}

/** The radius of the circle through three points (x, z), at most 1000 m (straight). */
function turnRadius(a: Xyz, b: Xyz, c: Xyz): number {
  const ab = Math.hypot(b[0] - a[0], b[2] - a[2]), bc = Math.hypot(c[0] - b[0], c[2] - b[2]), ca = Math.hypot(a[0] - c[0], a[2] - c[2]);
  const cross = Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]));
  return cross < 1e-9 ? 1000 : Math.min(1000, (ab * bc * ca) / (2 * cross));
}

/**
 * A layout's pit_lane.ai along its pit lane (`lane`: a paved one or a pit row's, off the AI line)
 * and data/ideal_line.ai (the AI line's own file, `aiFile`), under `prefix` (the track folder, or
 * the layout's). No pit_lane.ai without a lane, or when the lane doesn't reach the line.
 */
export function pitLaneFiles(prefix: string, ai: AiPoint[], aiFile: Uint8Array, closed: boolean, lane?: PitPath | null): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = { [`${prefix}/data/ideal_line.ai`]: aiFile };
  const pit = lane ? pitLaneAlong(ai, lane, closed) : null;
  if (pit) files[`${prefix}/ai/pit_lane.ai`] = writeFastLaneAi(pit);
  return files;
}
