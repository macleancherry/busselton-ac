// Meshes for the prototype: a junction's surface as a grid clipped to its signed distance
// (marching squares), and edge ribbons from cap to cap. Positions are local [x, y, h].

import type { P2 } from "./geom";
import { edgeSurface, type EdgeProfile } from "./heights";
import type { JunctionShape } from "./junction";

export interface Tris {
  positions: number[];
  indices: number[];
}

export interface Contour {
  /** Closed rings (first point not repeated). Outer rings anticlockwise, holes clockwise. */
  rings: P2[][];
}

interface Grid {
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  step: number;
  v: Float64Array;
}

function sampleGrid(shape: JunctionShape, step: number): Grid {
  const [bx0, by0, bx1, by1] = shape.box;
  const nx = Math.ceil((bx1 - bx0) / step) + 1, ny = Math.ceil((by1 - by0) / step) + 1;
  const v = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let d = shape.sdf([bx0 + i * step, by0 + j * step]);
    // Never exactly zero: keeps the cases clean.
    if (Math.abs(d) < 1e-9) d = 1e-9;
    v[j * nx + i] = d;
  }
  return { x0: bx0, y0: by0, nx, ny, step, v };
}

/**
 * The cells of a grid clipped to the inside of the signed distance, as convex pieces, and the
 * boundary segments between inside and outside. Crossing points are computed once per grid edge,
 * so neighbouring cells share them exactly.
 */
function march(g: Grid) {
  const { x0, y0, nx, step, v } = g;
  const val = (i: number, j: number) => v[j * nx + i];
  const pt = (i: number, j: number): P2 => [x0 + i * step, y0 + j * step];
  const cross = (i0: number, j0: number, i1: number, j1: number): P2 => {
    // Always interpolate from the lower corner so both cells get the same point.
    if (i1 < i0 || j1 < j0) [i0, j0, i1, j1] = [i1, j1, i0, j0];
    const a = val(i0, j0), b = val(i1, j1);
    const t = a / (a - b);
    const p = pt(i0, j0), q = pt(i1, j1);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  const pieces: P2[][] = [];
  const segs: [P2, P2][] = [];
  for (let j = 0; j < g.ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    // Corners anticlockwise: (i,j) (i+1,j) (i+1,j+1) (i,j+1).
    const c: [number, number][] = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    const ins = c.map(([a, b]) => val(a, b) < 0);
    const n = ins.filter(Boolean).length;
    if (n === 0) continue;
    if (n === 4) { pieces.push(c.map(([a, b]) => pt(a, b))); continue; }
    // Walk the square: inside corners, and a crossing on each edge that changes sign.
    const poly: P2[] = [];
    const crossings: P2[] = [];
    for (let k = 0; k < 4; k++) {
      const [a, b] = c[k], [a2, b2] = c[(k + 1) % 4];
      if (ins[k]) poly.push(pt(a, b));
      if (ins[k] !== ins[(k + 1) % 4]) {
        const x = cross(a, b, a2, b2);
        poly.push(x);
        crossings.push(x);
      }
    }
    const saddle = n === 2 && ins[0] === ins[2];
    const centreIn = (val(i, j) + val(i + 1, j) + val(i + 1, j + 1) + val(i, j + 1)) / 4 < 0;
    if (saddle && !centreIn) {
      // Two separate corner triangles.
      for (let k = 0; k < 4; k++) {
        if (!ins[k]) continue;
        const [a, b] = c[k];
        const prev = c[(k + 3) % 4], next = c[(k + 1) % 4];
        const p1 = cross(a, b, next[0], next[1]), p0 = cross(prev[0], prev[1], a, b);
        pieces.push([p0, pt(a, b), p1]);
        segs.push([p1, p0]);
      }
      continue;
    }
    pieces.push(poly);
    // Boundary segments, oriented with the inside on the left (anticlockwise outer rings).
    for (let k = 0; k < 4; k++) {
      const kn = (k + 1) % 4;
      if (ins[k] && !ins[kn]) {
        // Leaving the inside along edge k: this crossing is where the boundary goes out; pair with the next entry.
        const exitPt = cross(c[k][0], c[k][1], c[kn][0], c[kn][1]);
        for (let m = 1; m < 4; m++) {
          const q = (kn + m - 1) % 4, qn = (q + 1) % 4;
          if (!ins[q] && ins[qn]) {
            segs.push([exitPt, cross(c[q][0], c[q][1], c[qn][0], c[qn][1])]);
            break;
          }
        }
      }
    }
  }
  return { pieces, segs };
}

/** Chain boundary segments into closed rings. */
function chain(segs: [P2, P2][]): P2[][] {
  const k = (p: P2) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const next = new Map<string, [P2, P2]>();
  for (const s of segs) next.set(k(s[0]), s);
  const rings: P2[][] = [];
  const seen = new Set<string>();
  for (const s of segs) {
    if (seen.has(k(s[0]))) continue;
    const ring: P2[] = [];
    let cur: [P2, P2] | undefined = s;
    while (cur && !seen.has(k(cur[0]))) {
      seen.add(k(cur[0]));
      ring.push(cur[0]);
      cur = next.get(k(cur[1]));
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

export interface JunctionMesh extends Tris {
  contour: Contour;
  /** Area of the road surface, m². */
  area: number;
}

/** The junction's surface: grid cells clipped to the polygon, at the field's heights. */
export function junctionMesh(shape: JunctionShape, field: (p: P2) => number, step = 0.5): JunctionMesh {
  const g = sampleGrid(shape, step);
  const { pieces, segs } = march(g);
  const positions: number[] = [], indices: number[] = [];
  const ids = new Map<string, number>();
  const vid = (p: P2) => {
    const key = `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      ids.set(key, id);
      positions.push(p[0], p[1], field(p));
    }
    return id;
  };
  let area = 0;
  for (const poly of pieces) {
    const vs = poly.map(vid);
    for (let t = 1; t < vs.length - 1; t++) {
      if (vs[0] === vs[t] || vs[t] === vs[t + 1] || vs[0] === vs[t + 1]) continue;
      indices.push(vs[0], vs[t], vs[t + 1]);
      const a = poly[0], b = poly[t], c = poly[t + 1];
      area += ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    }
  }
  return { positions, indices, contour: { rings: chain(segs) }, area };
}

/** An edge ribbon: three vertices across (left edge, centre for the crown, right edge) per point. */
export function edgeMesh(pr: EdgeProfile): Tris {
  const positions: number[] = [], indices: number[] = [];
  const n = pr.line.length;
  for (let k = 0; k < n; k++) {
    const a = pr.line[Math.max(0, k - 1)], b = pr.line[Math.min(n - 1, k + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const left: P2 = [-dy / l, dx / l];
    for (const t of [pr.halfWidth, 0, -pr.halfWidth]) {
      positions.push(pr.line[k][0] + left[0] * t, pr.line[k][1] + left[1] * t, edgeSurface(pr, k, t));
    }
  }
  for (let k = 0; k < n - 1; k++) {
    const r0 = k * 3, r1 = r0 + 3;
    for (let c = 0; c < 2; c++) {
      // Anticlockwise seen from above.
      indices.push(r0 + c, r0 + c + 1, r1 + c + 1, r0 + c, r1 + c + 1, r1 + c);
    }
  }
  return { positions, indices };
}
