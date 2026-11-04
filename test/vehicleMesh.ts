// Checks on a local-cars template mesh (test/vehicles.test.ts): which vertices are which swatch, where
// the wheels are, and a ray test for holes and inside-out faces.

import { ATLAS_H, ATLAS_W, SW, swatchUv, WHEEL_TILE, type V3, type VehicleMesh } from "../src/core/vehicles/vehicle";

export const tris = (m: VehicleMesh) => m.idx.length / 3;

export function vert(m: VehicleMesh, i: number): V3 {
  return [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]];
}

/** Whether vertex i is on swatch `sw` (by its uv). */
export function onSwatch(m: VehicleMesh, i: number, sw: number): boolean {
  const [u, v] = swatchUv(sw);
  return Math.abs(m.uv[i * 2] - u) < 1e-6 && Math.abs(m.uv[i * 2 + 1] - v) < 1e-6;
}

/** Tyre vertices: the tyre swatch or the drawn wheel face. */
export function isTyre(m: VehicleMesh, i: number): boolean {
  if (onSwatch(m, i, SW.TYRE)) return true;
  const [x, y, w, h] = WHEEL_TILE, u = m.uv[i * 2] * ATLAS_W, v = m.uv[i * 2 + 1] * ATLAS_H;
  // Strictly inside: the grille tile starts where the wheel tile ends.
  return u > x + 0.5 && u < x + w - 0.5 && v > y + 0.5 && v < y + h - 0.5;
}

/**
 * The four road wheels from the tyre vertices (a spare on the back, near s = 0, is left out): each
 * one's middle in f and s and its lowest point.
 */
export function roadWheels(m: VehicleMesh): { f: number; s: number; low: number }[] {
  const groups = new Map<string, { f: [number, number]; s: [number, number]; low: number }>();
  for (let i = 0; i < m.pos.length / 3; i++) {
    if (!isTyre(m, i)) continue;
    const [f, s, h] = vert(m, i);
    if (Math.abs(s) < 0.4) continue; // the spare
    const key = `${Math.sign(f)}${Math.sign(s)}`;
    const g = groups.get(key) ?? { f: [Infinity, -Infinity], s: [Infinity, -Infinity], low: Infinity };
    g.f = [Math.min(g.f[0], f), Math.max(g.f[1], f)];
    g.s = [Math.min(g.s[0], s), Math.max(g.s[1], s)];
    g.low = Math.min(g.low, h);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ f: (g.f[0] + g.f[1]) / 2, s: (g.s[0] + g.s[1]) / 2, low: g.low }));
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Look at the mesh along `dir` through a grid of rays over its outline: how many rays hit it, and
 * how many of those first hit a face turned towards the viewer. A ray that first meets a back face
 * has found a hole (seeing the inside of the far side) or a face turned inside out; with back faces
 * culled, as in AC, that's a see-through spot.
 */
export function rayCheck(m: VehicleMesh, dir: V3, n = 28): { hits: number; front: number; bad: V3[] } {
  const d = norm(dir);
  const up: V3 = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = norm(cross(d, up)), v = cross(u, d);
  const nv = m.pos.length / 3;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < nv; i++) {
    const p = vert(m, i), pu = dot(p, u), pv = dot(p, v);
    u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv);
  }
  const T = [...Array(tris(m)).keys()].map((t) => [vert(m, m.idx[t * 3]), vert(m, m.idx[t * 3 + 1]), vert(m, m.idx[t * 3 + 2])]);
  let hits = 0, front = 0;
  const bad: V3[] = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    const pu = u0 + ((u1 - u0) * (a + 0.5)) / n, pv = v0 + ((v1 - v0) * (b + 0.5)) / n;
    const o: V3 = [u[0] * pu + v[0] * pv - d[0] * 50, u[1] * pu + v[1] * pv - d[1] * 50, u[2] * pu + v[2] * pv - d[2] * 50];
    let best = Infinity, facing = false;
    for (const [p0, p1, p2] of T) {
      // Möller-Trumbore, both sides.
      const e1 = sub(p1, p0), e2 = sub(p2, p0), pv3 = cross(d, e2), det = dot(e1, pv3);
      if (Math.abs(det) < 1e-12) continue;
      const tv = sub(o, p0), uu = dot(tv, pv3) / det;
      if (uu < 0 || uu > 1) continue;
      const q = cross(tv, e1), vv = dot(d, q) / det;
      if (vv < 0 || uu + vv > 1) continue;
      const t = dot(e2, q) / det;
      if (t > 1e-6 && t < best) {
        best = t;
        facing = dot(cross(e1, e2), d) < 0;
      }
    }
    if (best === Infinity) continue;
    hits++;
    if (facing) front++;
    else bad.push([o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best]);
  }
  return { hits, front, bad };
}

/**
 * The views the ray check looks from: both sides, front and back from a little above (about 9
 * degrees down, as from a driver's or walker's eye a few metres off; dead level along the ground
 * would look under the bumpers, which nobody sees), from above, and four high corners.
 */
export const VIEWS: [string, V3][] = [
  ["left", [0, -1, -0.15]], ["right", [0, 1, -0.15]], ["front", [-1, 0, -0.15]], ["back", [1, 0, -0.15]], ["top", [0, 0, -1]],
  ["front-left", [-1, -1, -0.5]], ["front-right", [-1, 1, -0.5]], ["back-left", [1, -1, -0.5]], ["back-right", [1, 1, -0.5]],
];
