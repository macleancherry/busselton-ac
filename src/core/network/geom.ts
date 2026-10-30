// Small 2D helpers for the network core (docs/specs/road-network.md). Local metres, x east, y north.

export type P2 = [number, number];

export const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
export const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: P2, k: number): P2 => [a[0] * k, a[1] * k];
export const dot = (a: P2, b: P2): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: P2, b: P2): number => a[0] * b[1] - a[1] * b[0];
export const len = (a: P2): number => Math.hypot(a[0], a[1]);
export const dist = (a: P2, b: P2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const unit = (a: P2): P2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
/** Left normal of a direction. */
export const leftOf = (d: P2): P2 => [-d[1], d[0]];

/** Cumulative length at each point. */
export function lengths(pts: P2[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + dist(pts[i - 1], pts[i]));
  return out;
}

/** Point and unit direction at distance s along a polyline (clamped to its ends). */
export function along(pts: P2[], s: number, cum = lengths(pts)): { p: P2; d: P2 } {
  const total = cum[cum.length - 1];
  const t = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < pts.length - 1 && cum[i] < t) i++;
  const a = pts[i - 1], b = pts[i];
  const seg = cum[i] - cum[i - 1] || 1e-9;
  const f = (t - cum[i - 1]) / seg;
  return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], d: unit(sub(b, a)) };
}

/** The polyline from distance s0 to s1 (s0 < s1). */
export function slice(pts: P2[], s0: number, s1: number, cum = lengths(pts)): P2[] {
  const out: P2[] = [along(pts, s0, cum).p];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s0 && cum[i] < s1) out.push(pts[i]);
  out.push(along(pts, s1, cum).p);
  return out;
}

/** Evenly spaced points along a polyline, ends kept. */
export function resampleLine(pts: P2[], step: number): P2[] {
  const cum = lengths(pts);
  const total = cum[cum.length - 1];
  const n = Math.max(1, Math.round(total / step));
  const out: P2[] = [];
  for (let k = 0; k <= n; k++) out.push(along(pts, (total * k) / n, cum).p);
  return out;
}

/** Distance from p to segment ab, and the fraction along it. */
export function segDist(p: P2, a: P2, b: P2): { d: number; f: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab) || 1e-12;
  const f = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return { d: dist(p, [a[0] + ab[0] * f, a[1] + ab[1] * f]), f };
}

/** Distance from p to a polyline. */
export function lineDist(p: P2, pts: P2[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(p, pts[i - 1], pts[i]).d);
  return best;
}

/** Gaussian smoothing of values sampled at even spacing; ends are held (mirror padding). */
export function smooth1d(v: number[], sigma: number): number[] {
  if (sigma <= 0 || v.length < 3) return v.slice();
  const r = Math.ceil(sigma * 3);
  const w: number[] = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const n = v.length;
  return v.map((_, i) => {
    let s = 0, ws = 0;
    for (let k = -r; k <= r; k++) {
      let j = i + k;
      if (j < 0) j = -j;
      if (j >= n) j = 2 * (n - 1) - j;
      j = Math.max(0, Math.min(n - 1, j));
      s += v[j] * w[k + r];
      ws += w[k + r];
    }
    return s / ws;
  });
}

export const smoothstep = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/** Polynomial smooth minimum (smooth union of two signed distances), radius k. */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Signed area of a ring (positive = anticlockwise). */
export function ringArea(r: P2[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Least-squares circle through points (Kasa fit). */
export function fitCircle(pts: P2[]): { c: P2; r: number; rms: number } | null {
  if (pts.length < 3) return null;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= pts.length; my /= pts.length;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p[0] - mx, v = p[1] - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const bu = (suuu + suvv) / 2, bv = (svvv + svuu) / 2;
  const uc = (bu * svv - bv * suv) / det, vc = (bv * suu - bu * suv) / det;
  const c: P2 = [mx + uc, my + vc];
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length);
  const rms = Math.sqrt(pts.reduce((s, p) => s + (dist(p, c) - r) ** 2, 0) / pts.length);
  return { c, r, rms };
}
