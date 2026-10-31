// Cuts U-turn spurs out of a routed line. A pin on the far carriageway of a
// divided road, or up a side street, makes the router drive past, turn round
// and come back. For each U-turn the router reports, this finds the
// out-and-back around it (from where the route first runs alongside itself to
// where it last does), cuts it out and joins the ends with a gentle diagonal.
// Bends the router doesn't call U-turns (mountain hairpins) are left alone.
//
// Written from docs/specs/spurs.md.

import type { LngLat, Vec2 } from "./geo";

export interface Trimmed {
  /** The route without the spurs. */
  coords: LngLat[];
  /** U-turns whose spur was cut out. */
  cut: LngLat[];
  /** U-turns left in (no spur found, too long to cut, or not on the route). */
  kept: LngLat[];
  /** Arc-length ranges removed, metres along the original route, sorted by start. */
  ranges: [number, number][];
}

/** Resample spacing, m. */
const STEP = 2;
/** Arms closer than this run alongside (a divided road's carriageways, light rail between included), m. */
const SEP = 36;
/** Shortest out-and-back that counts, m. */
const MIN_SPAN = 30;
/** Longest spur ever cut, m. */
const MAX_CUT = 1500;
/** Never cut more than this share of the route. */
const MAX_SHARE = 0.5;
/** A U-turn further than this from the route is ignored, m. */
const TURN_MATCH = 30;
/** Half-window for sample directions, m. */
const DIR_WINDOW = 6;
/** Arms must be at least this parallel (|cos|). */
const ALIGN = 0.8;
/** Search window for the end adjustments, m. */
const END_WINDOW = 2 * SEP;
/** A spur this close to an end is the route's start or finish, m. */
const END_TOL = 2 * STEP + SEP;
/** How far past the limit the pair search looks, m. */
const REACH_PAST = 60;
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG = 111320;

interface Frame {
  toLocal(p: LngLat): Vec2;
}

function frameAt(origin: LngLat): Frame {
  const k = Math.cos((origin[1] * Math.PI) / 180) * M_PER_DEG_LNG;
  return { toLocal: (p) => [(p[0] - origin[0]) * k, (p[1] - origin[1]) * M_PER_DEG_LAT] };
}

function cumulative(pts: Vec2[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

/** Index of the segment containing arc length s (cum[i] <= s <= cum[i+1]), clamped. */
function segmentAt(cum: number[], s: number): number {
  let lo = 0, hi = cum.length - 1;
  if (hi < 1) return 0;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

function lerpAt<T extends [number, number]>(pts: T[], cum: number[], s: number): T {
  const i = segmentAt(cum, s);
  if (pts.length === 1) return [pts[0][0], pts[0][1]] as T;
  const a = pts[i], b = pts[i + 1];
  const L = cum[i + 1] - cum[i];
  const f = L > 0 ? Math.max(0, Math.min(1, (s - cum[i]) / L)) : 0;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] as T;
}

interface Samples {
  pos: Vec2[];
  s: number[];
  dir: Vec2[];
}

function resampleRoute(local: Vec2[], cum: number[], total: number): Samples {
  const pos: Vec2[] = [];
  const s: number[] = [];
  for (let i = 0; i * STEP <= total; i++) {
    s.push(i * STEP);
    pos.push(lerpAt(local, cum, i * STEP));
  }
  const w = Math.round(DIR_WINDOW / STEP);
  const n = pos.length;
  const dir = pos.map((_, i) => {
    const a = pos[Math.max(0, i - w)], b = pos[Math.min(n - 1, i + w)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    return (l > 0 ? [dx / l, dy / l] : [0, 0]) as Vec2;
  });
  return { pos, s, dir };
}

function nearestSample(sm: Samples, p: Vec2, from = 0, to = sm.pos.length - 1): { k: number; d: number } {
  let k = -1, d = Infinity;
  for (let i = from; i <= to; i++) {
    const di = Math.hypot(sm.pos[i][0] - p[0], sm.pos[i][1] - p[1]);
    if (di < d) {
      d = di;
      k = i;
    }
  }
  return { k, d };
}

/** Nearest sample to p among those with s in [lo, hi]; `fallback` when none lie there. */
function nearestInWindow(sm: Samples, p: Vec2, lo: number, hi: number, fallback: number): number {
  let best = fallback, bd = Infinity;
  for (let i = 0; i < sm.s.length; i++) {
    if (sm.s[i] < lo || sm.s[i] > hi) continue;
    const d = Math.hypot(sm.pos[i][0] - p[0], sm.pos[i][1] - p[1]);
    if (d < bd) {
      bd = d;
      best = sm.s[i];
    }
  }
  return best;
}

/** Last sample index with s <= limit (binary search; samples are i * STEP). */
function lastAtOrBefore(sm: Samples, limit: number): number {
  return Math.max(0, Math.min(sm.s.length - 1, Math.floor(limit / STEP + 1e-9)));
}

function findSpur(sm: Samples, k: number, total: number, turnsAt: number[]): [number, number] | null {
  const limit = Math.min(MAX_CUT, MAX_SHARE * total);
  const reach = limit + REACH_PAST;
  const n = sm.pos.length;
  let bestA = -1, bestB = -1, bestSpan = -Infinity;
  for (let a = k; a >= 0 && sm.s[k] - sm.s[a] <= reach; a--) {
    const sa = sm.s[a];
    for (let b = Math.min(n - 1, lastAtOrBefore(sm, sa + reach)); b > k; b--) {
      const span = sm.s[b] - sa;
      if (span < MIN_SPAN || span <= bestSpan) break;
      const pa = sm.pos[a], pb = sm.pos[b];
      if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) > SEP) continue;
      const dot = sm.dir[a][0] * sm.dir[b][0] + sm.dir[a][1] * sm.dir[b][1];
      const sb = sm.s[b];
      const twoTurns = turnsAt.filter((t) => t > sa && t < sb).length >= 2;
      const par = twoTurns ? Math.abs(dot) : -dot;
      if (par > ALIGN) {
        bestA = a;
        bestB = b;
        bestSpan = span;
        break;
      }
    }
  }
  if (bestA < 0 || bestSpan > limit) return null;
  let sa = sm.s[bestA], sb = sm.s[bestB];
  const atStart = sa <= END_TOL;
  const atEnd = sb >= total - END_TOL;
  if (atStart && atEnd) return null;
  if (atStart) {
    const unadjusted = sb;
    sa = 0;
    sb = nearestInWindow(sm, sm.pos[0], sb - END_WINDOW, sb, unadjusted);
  } else if (atEnd) {
    const unadjusted = sa;
    sb = total;
    sa = nearestInWindow(sm, sm.pos[n - 1], sa, sa + END_WINDOW, unadjusted);
  }
  if (sb - sa > limit) return null;
  return [sa, sb];
}

/**
 * Rebuilds the route without the given ranges (metres along `coords`, any
 * order). Middle ranges are widened by J = max(10, 3 x the gap between the
 * arms) each side and bridged with a straight diagonal; ranges touching an
 * end just drop that end. Exported for tests.
 */
export function rebuildWithout(coords: LngLat[], ranges: [number, number][]): LngLat[] {
  const local = coords.map(frameAt(coords[0]).toLocal);
  const cum = cumulative(local);
  const total = cum[cum.length - 1];
  const at = (s: number) => lerpAt(coords, cum, s);
  const frame = frameAt(coords[0]);
  const dist = (p: LngLat, q: LngLat) => {
    const a = frame.toLocal(p), b = frame.toLocal(q);
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  };
  // Widen every range first, then merge (so a widened cut never steps backwards).
  const wide = ranges
    .map(([a0, b0]) => {
      const middle = a0 > 0 && b0 < total;
      const J = middle ? Math.max(10, 3 * dist(at(a0), at(b0))) : 0;
      return [Math.max(0, a0 - J), Math.min(total, b0 + J)] as [number, number];
    })
    .sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const r of wide) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: LngLat[] = [];
  let prevEnd = -Infinity;
  let ci = 0;
  for (const [a, b] of merged) {
    for (; ci < coords.length && cum[ci] < a; ci++) if (cum[ci] >= prevEnd) out.push(coords[ci]);
    if (a > 0) out.push(at(a));
    if (b < total) out.push(at(b));
    prevEnd = b;
  }
  for (let i = 0; i < coords.length; i++) if (cum[i] > prevEnd) out.push(coords[i]);
  return out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]);
}

export function trimSpurs(coords: LngLat[], uturns: LngLat[]): Trimmed {
  if (coords.length < 3 || uturns.length === 0) return { coords, cut: [], kept: uturns, ranges: [] };
  const frame = frameAt(coords[0]);
  const local = coords.map(frame.toLocal);
  const cum = cumulative(local);
  const total = cum[cum.length - 1];
  const sm = resampleRoute(local, cum, total);
  const turnsAt = uturns.map((u) => {
    const { k, d } = nearestSample(sm, frame.toLocal(u));
    return k >= 0 && d <= TURN_MATCH ? sm.s[k] : -1;
  });

  const cut: LngLat[] = [];
  const kept: LngLat[] = [];
  const ranges: [number, number][] = [];
  for (const u of uturns) {
    const { k, d } = nearestSample(sm, frame.toLocal(u));
    if (k < 0 || d > TURN_MATCH) {
      kept.push(u);
      continue;
    }
    const s = sm.s[k];
    if (ranges.some(([a, b]) => s >= a && s <= b)) {
      cut.push(u); // removed with a spur already cut
      continue;
    }
    const r = findSpur(sm, k, total, turnsAt);
    if (!r) {
      kept.push(u);
      continue;
    }
    ranges.push(r);
    cut.push(u);
  }
  if (ranges.length === 0) return { coords, cut, kept, ranges: [] };
  ranges.sort((p, q) => p[0] - q[0]);
  return { coords: rebuildWithout(coords, ranges), cut, kept, ranges };
}
