// Busselton fork: small polygon helpers for footprints and other rings (docs/specs/buildings.md).
// A ring is a list of local points with the first not repeated at the end.

import type { Vec2 } from "./geo";

/** Shoelace area: positive when the points run counter-clockwise (seen from above). */
export function ringArea(ring: Vec2[]): number {
  let twice = 0;
  for (let k = 0, n = ring.length; k < n; k++) {
    const [ax, ay] = ring[k];
    const [bx, by] = ring[(k + 1) % n];
    twice += ax * by - bx * ay;
  }
  return twice / 2;
}

/** Even-odd test: does a horizontal ray from (x, y) cross the ring an odd number of times? */
export function pointInRing(x: number, y: number, ring: Vec2[]): boolean {
  let odd = false;
  for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
    const [xk, yk] = ring[k];
    const [xj, yj] = ring[j];
    if (yk > y === yj > y) continue;
    const cross = xk + ((y - yk) / (yj - yk)) * (xj - xk);
    if (x < cross) odd = !odd;
  }
  return odd;
}

/** The plain mean of the vertices (a stable "where is it" point, not the area centroid). */
export function centroid(ring: Vec2[]): Vec2 {
  let sx = 0, sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  const n = ring.length || 1;
  return [sx / n, sy / n];
}

/** Four corners, each within about 15 degrees of square. */
export function isRectangle(ring: Vec2[]): boolean {
  if (ring.length !== 4) return false;
  for (let k = 0; k < 4; k++) {
    const prev = ring[(k + 3) % 4], here = ring[k], next = ring[(k + 1) % 4];
    const ax = prev[0] - here[0], ay = prev[1] - here[1];
    const bx = next[0] - here[0], by = next[1] - here[1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) return false;
    if (Math.abs((ax * bx + ay * by) / (la * lb)) > 0.26) return false;
  }
  return true;
}

/** A copy running counter-clockwise, with a repeated closing point dropped. */
export function ccwRing(ring: Vec2[]): Vec2[] {
  let pts = ring.slice();
  if (pts.length > 1) {
    const a = pts[0], z = pts[pts.length - 1];
    if (Math.abs(a[0] - z[0]) < 1e-9 && Math.abs(a[1] - z[1]) < 1e-9) pts = pts.slice(0, -1);
  }
  return ringArea(pts) < 0 ? pts.reverse() : pts;
}
