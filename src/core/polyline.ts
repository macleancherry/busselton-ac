// Centreline polyline processing: dedupe, resample, Gaussian smoothing, frames, simplification.
// Written from docs/specs/polyline.md.
//
// Points are local metres, x east, y north. "Left" is the tangent turned 90° anticlockwise and
// positive curvature is a left turn; both assume that right-handed frame.
// Closed series never repeat the first point at the end: the wrap joins the last to the first.
// Nothing here mutates its inputs.

import type { Vec2 } from "./geo";

const gap = (p: Vec2, q: Vec2): number => Math.hypot(q[0] - p[0], q[1] - p[1]);
const lerp = (p: Vec2, q: Vec2, t: number): Vec2 => [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
/** Positive modulo, for wrapping indices on closed series. */
const wrap = (i: number, n: number): number => ((i % n) + n) % n;

/** Running arc length along the points (no closing segment). Empty in, empty out. */
export function cumulative(points: Vec2[]): number[] {
  let run = 0;
  return points.map((p, i) => (run += i > 0 ? gap(points[i - 1], p) : 0));
}

/** Keeps a point only if it is more than `minDist` from the last kept point. The first is always kept. */
export function dedupe(points: Vec2[], minDist = 0.05): Vec2[] {
  const kept: Vec2[] = [];
  for (const p of points) {
    if (kept.length === 0 || gap(kept[kept.length - 1], p) > minDist) kept.push(p);
  }
  return kept;
}

/**
 * Evenly spaced points along the path: n = max(1, round(L / spacing)) intervals of L / n.
 * First and last points are kept; interior corners are cut. Throws on a spacing that isn't a
 * positive finite number.
 */
export function resample(points: Vec2[], spacing: number): Vec2[] {
  if (!(spacing > 0) || !Number.isFinite(spacing)) {
    throw new Error(`resample: spacing must be a positive finite number, got ${spacing}`);
  }
  if (points.length < 2) return points.map((p) => [p[0], p[1]] as Vec2);
  const along = cumulative(points);
  const length = along[along.length - 1];
  const intervals = Math.max(1, Math.round(length / spacing));
  const step = length / intervals;
  const lastSegment = points.length - 2;
  const result: Vec2[] = [];
  let k = 0; // current segment: points[k] to points[k + 1]
  for (let i = 0; i <= intervals; i++) {
    const s = step * i;
    while (k < lastSegment && along[k + 1] < s) k++;
    const segLength = along[k + 1] - along[k];
    result.push(lerp(points[k], points[k + 1], (s - along[k]) / (segLength === 0 ? 1 : segLength)));
  }
  return result;
}

/**
 * Gaussian smoothing of a uniformly spaced series, σ in samples (σ < 0.5 returns a copy).
 * Closed series wrap; open ones renormalise over the samples that exist near the ends.
 */
export function gaussianSmooth(series: number[], sigmaSamples: number, closed: boolean): number[] {
  if (!(sigmaSamples >= 0.5)) return [...series];
  const count = series.length;
  const reach = Math.ceil(3 * sigmaSamples);
  const kernel = Array.from({ length: 2 * reach + 1 }, (_, m) => Math.exp(-((m - reach) ** 2) / (2 * sigmaSamples ** 2)));
  return series.map((_, i) => {
    let weighted = 0, total = 0;
    for (let m = 0; m < kernel.length; m++) {
      const at = i + m - reach;
      const idx = closed ? wrap(at, count) : at;
      if (idx < 0 || idx >= count) continue;
      weighted += kernel[m] * series[idx];
      total += kernel[m];
    }
    return weighted / total;
  });
}

/**
 * Smooths a uniformly spaced path (σ in metres). Open paths keep their end points exactly and
 * fade the smoothing in linearly over 2σ samples, so pins land where they were placed.
 */
export function smoothPath(points: Vec2[], sigmaMetres: number, spacing: number, closed: boolean): Vec2[] {
  const sigmaSamples = sigmaMetres / spacing;
  const sx = gaussianSmooth(points.map((p) => p[0]), sigmaSamples, closed);
  const sy = gaussianSmooth(points.map((p) => p[1]), sigmaSamples, closed);
  if (closed) return sx.map((x, i) => [x, sy[i]] as Vec2);
  const last = points.length - 1;
  const fadeLength = Math.max(1, 2 * sigmaSamples);
  return points.map((p, i) => lerp(p, [sx[i], sy[i]], Math.min(1, Math.min(i, last - i) / fadeLength)));
}

/** Per-sample frame: position, unit tangent, left normal, curvature (1/m, + = left) and arc length. */
export interface PathFrame { pos: Vec2; tan: Vec2; left: Vec2; curvature: number; s: number }

export function frames(points: Vec2[], closed: boolean): PathFrame[] {
  const count = points.length;
  const along = cumulative(points);
  const neighbour = (i: number): Vec2 => points[closed ? wrap(i, count) : Math.max(0, Math.min(count - 1, i))];
  return points.map((p, i) => {
    const prev = neighbour(i - 1), next = neighbour(i + 1);
    const chordX = next[0] - prev[0], chordY = next[1] - prev[1];
    const chord = Math.hypot(chordX, chordY);
    const norm = chord === 0 ? 1 : chord;
    const tan: Vec2 = [chordX / norm, chordY / norm];
    let curvature = 0;
    const interior = i > 0 && i < count - 1;
    if (closed || interior) {
      // Menger curvature of the circle through prev, p, next.
      const inX = p[0] - prev[0], inY = p[1] - prev[1];
      const outX = next[0] - p[0], outY = next[1] - p[1];
      const sides = Math.hypot(inX, inY) * Math.hypot(outX, outY) * chord;
      if (sides > 1e-9) curvature = (2 * (inX * outY - inY * outX)) / sides;
    }
    return { pos: p, tan, left: [-tan[1], tan[0]] as Vec2, curvature, s: along[i] };
  });
}

/** Distance from p to the segment from a to b (to a when a and b coincide). */
function toSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const lenSq = ex * ex + ey * ey;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / lenSq));
  return gap(p, [a[0] + t * ex, a[1] + t * ey]);
}

/** Ramer-Douglas-Peucker on distance to the segment; keeps points further than `tolerance`, in order. */
export function simplify(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length < 3) return [...points];
  const keep = points.map((_, i) => i === 0 || i === points.length - 1);
  const spans: Array<[number, number]> = [[0, points.length - 1]];
  for (let span = spans.pop(); span; span = spans.pop()) {
    const [from, to] = span;
    let far = -1, farDist = tolerance;
    for (let i = from + 1; i < to; i++) {
      const d = toSegment(points[i], points[from], points[to]);
      if (d > farDist) { far = i; farDist = d; }
    }
    if (far < 0) continue;
    keep[far] = true;
    spans.push([from, far], [far, to]);
  }
  return points.filter((_, i) => keep[i]);
}
