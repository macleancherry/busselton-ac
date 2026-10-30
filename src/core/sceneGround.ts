// Busselton fork: one surface for every height (docs/external-review-2026-10-31.md, F2 and
// recommendation 2).
//
// Scenery used to take its height from several rules: the analytic terrain, the terrain grid's
// triangles, the route's own surface formula, a verge slope model, the horizon mesh. None of them
// saw the road, kerb, side street or roundabout meshes, so wherever a road was flattened, cut in or
// raised, things floated or sank by the difference. Now the base's physics meshes are built first
// (road, verge, kerbs and strips, returns, side streets, roundabouts, terrain), and everything placed
// after them stands on the topmost of those meshes, read from the triangles themselves.
//
// The lookup is a grid of triangle lists over the meshes (typed arrays, about 40 bytes a triangle),
// so a height is a handful of point-in-triangle tests. scripts/check/ground_check.ts reads the
// same meshes back out of the zip and fails a build where anything placed is more than 5 cm off.
import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import type { Kn5Node } from "./kn5";

/** Physics ground: any mesh you can stand on (a digit then a surface key), not walls. */
export const PHYSICS_GROUND = /^\d(?!WALL)/;
/**
 * The driving surface: the route, its gutters and roundabouts, side streets (with their gutters and
 * the fills at their mouths), gravel roads. Not footpaths, driveway crossovers or kerbs.
 */
export const ROAD_SURFACE = /^\d(ROAD(?!_PATH)|STREET(?!_PATH|_DRIVE)|UNSEALED|UNPAVED)/;
/**
 * How far a placed object's base goes into the surface it stands on, metres: enough that no hairline
 * gap shows at its foot, well inside the 5 cm the ground check allows.
 */
export const SINK = 0.02;

/** The topmost surface at a point (local x east, y north), or null where no mesh covers it. */
export type SurfaceFn = (x: number, y: number) => number | null;

/**
 * The topmost of the meshes whose names match `names`, as a height lookup. Meshes are in AC space
 * (x east, y up, z south), as the build makes them.
 */
export function topSurface(nodes: Kn5Node[], names: RegExp = PHYSICS_GROUND): SurfaceFn {
  const meshes: { positions: Float32Array; indices: Uint16Array }[] = [];
  let count = 0;
  const walk = (n: Kn5Node) => {
    if (n.kind === "node") return n.children.forEach(walk);
    if (!names.test(n.name) || !n.indices.length) return;
    meshes.push(n);
    count += n.indices.length / 3;
  };
  nodes.forEach(walk);
  if (!count) return () => null;
  // Triangles as local (x, y, h) corners, nine floats each.
  const tri = new Float32Array(count * 9);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let t = 0;
  for (const m of meshes) {
    const p = m.positions, ix = m.indices;
    for (let i = 0; i < ix.length; i++) {
      const v = ix[i] * 3, x = p[v], y = -p[v + 2];
      tri[t++] = x; tri[t++] = y; tri[t++] = p[v + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  // Cells of 2 m, or coarser to keep the grid under about 4 million cells.
  const C = Math.max(2, Math.sqrt(((maxX - minX) * (maxY - minY)) / 4e6));
  const nx = Math.max(1, Math.floor((maxX - minX) / C) + 1), ny = Math.max(1, Math.floor((maxY - minY) / C) + 1);
  const cellsOf = (k: number, f: (cell: number) => void) => {
    const o = k * 9;
    const x0 = Math.min(tri[o], tri[o + 3], tri[o + 6]), x1 = Math.max(tri[o], tri[o + 3], tri[o + 6]);
    const y0 = Math.min(tri[o + 1], tri[o + 4], tri[o + 7]), y1 = Math.max(tri[o + 1], tri[o + 4], tri[o + 7]);
    const i0 = Math.floor((x0 - minX) / C), i1 = Math.floor((x1 - minX) / C);
    const j0 = Math.floor((y0 - minY) / C), j1 = Math.floor((y1 - minY) / C);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * nx + i);
  };
  const start = new Int32Array(nx * ny + 1);
  for (let k = 0; k < count; k++) cellsOf(k, (c) => start[c + 1]++);
  for (let c = 0; c < nx * ny; c++) start[c + 1] += start[c];
  const list = new Int32Array(start[nx * ny]);
  const fillAt = start.slice(0, nx * ny);
  for (let k = 0; k < count; k++) cellsOf(k, (c) => { list[fillAt[c]++] = k; });
  // Barycentric slack: a point on an edge shared by two triangles must land in at least one of them.
  const EPS = 1e-5;
  return (x, y) => {
    const i = Math.floor((x - minX) / C), j = Math.floor((y - minY) / C);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return null;
    const c = j * nx + i;
    let best: number | null = null;
    for (let q = start[c]; q < start[c + 1]; q++) {
      const o = list[q] * 9;
      const ax = tri[o], ay = tri[o + 1], bx = tri[o + 3], by = tri[o + 4], cx = tri[o + 6], cy = tri[o + 7];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
      const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
      const w = 1 - u - v;
      if (u < -EPS || v < -EPS || w < -EPS) continue;
      const h = u * tri[o + 2] + v * tri[o + 5] + w * tri[o + 8];
      if (best === null || h > best) best = h;
    }
    return best;
  };
}

export interface SceneGround {
  /** The surface at a point: the topmost physics mesh, or the fallback where none covers it. */
  (x: number, y: number): number;
  /** The mesh alone: null where no physics mesh covers the point. */
  mesh: SurfaceFn;
  /** The lowest surface under a set of points (a footprint's corners): where a base goes so none of it floats. */
  under(pts: Vec2[]): number;
  /** The lowest surface along a closed ring's edges, every `step` metres and at its corners. */
  underRing(ring: Vec2[], step?: number): number;
}

/**
 * The ground every placed object stands on: the topmost of the base's physics meshes (walls left
 * out), or `fallback` (the analytic terrain) where no mesh covers a point.
 */
export function sceneGround(nodes: Kn5Node[], fallback: HeightFn): SceneGround {
  return groundOver(topSurface(nodes, PHYSICS_GROUND), fallback);
}

/** The same over any surface lookup (for tests, and to wrap other surfaces). */
export function groundOver(mesh: SurfaceFn, fallback: HeightFn): SceneGround {
  const fn = ((x: number, y: number) => mesh(x, y) ?? fallback(x, y)) as SceneGround;
  fn.mesh = mesh;
  fn.under = (pts) => {
    let lo = Infinity;
    for (const [x, y] of pts) lo = Math.min(lo, fn(x, y));
    return lo;
  };
  fn.underRing = (ring, step = 0.5) => fn.under(alongRing(ring, step));
  return fn;
}

/** Points round a closed ring: its corners and every `step` metres along each edge. */
export function alongRing(ring: Vec2[], step = 0.5): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let i = 0; i < n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  }
  return out;
}

/** The corners and middle of a rectangle centred on `at`, `length` along `along` and `depth` across. */
export function footprint(at: Vec2, along: Vec2, length: number, depth: number): Vec2[] {
  const l = Math.hypot(along[0], along[1]) || 1;
  const fx = along[0] / l, fy = along[1] / l, sx = -fy, sy = fx;
  const out: Vec2[] = [at];
  for (const f of [-length / 2, length / 2]) for (const s of [-depth / 2, depth / 2]) out.push([at[0] + fx * f + sx * s, at[1] + fy * f + sy * s]);
  return out;
}
