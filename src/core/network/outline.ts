// The outline and surface mesh of a ribbon-capped junction. The outline comes from the junction's
// signed distance (marching squares), with each cap replaced by the ribbon's own row vertices, so the
// junction and the ribbon share the cap edge vertex for vertex. The surface is earcut over the
// outline for a plane; with a curved field, interior grid cells (quads) plus earcut in the band
// between them and the outline.

import earcut from "earcut";
import { dist, dot, ringArea, sub, type P2 } from "./geom";
import { contourRings } from "./mesh";
import type { Cap } from "./ribbons";

export interface Outline {
  outer: P2[];
  holes: P2[][];
  /** For each outer vertex: the cap index it belongs to, or -1. Cap vertices are never moved. */
  capOf: number[];
}

function pointInRing(p: P2, r: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[j], b = r[i];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + ((p[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) inside = !inside;
  }
  return inside;
}

/** Douglas-Peucker on an open polyline (ends kept). */
function simplify(pts: P2[], tol: number): P2[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, wd = tol;
    const ab = sub(pts[b], pts[a]), L = Math.hypot(ab[0], ab[1]) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const ap = sub(pts[i], pts[a]);
      const d = Math.abs(ab[0] * ap[1] - ab[1] * ap[0]) / L;
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function simplifyClosed(r: P2[], tol: number): P2[] {
  if (r.length < 8) return r;
  // Split at the vertex farthest from the first, simplify both halves.
  let far = 0, fd = -1;
  r.forEach((p, i) => { const d = dist(p, r[0]); if (d > fd) { fd = d; far = i; } });
  const a = simplify(r.slice(0, far + 1), tol), b = simplify([...r.slice(far), r[0]], tol);
  return [...a, ...b.slice(1, -1)];
}

/**
 * The junction's outline with the caps spliced in. Fails (returns a reason) when the contour isn't
 * one piece or a cap can't be found on it cleanly.
 */
export function junctionOutline(shape: { sdf: (p: P2) => number; box: [number, number, number, number] }, caps: Cap[], step = 0.4, tol = 0.02): Outline | string {
  const rings = contourRings(shape, step).filter((r) => r.length >= 3);
  const withArea = rings.map((r) => ({ r, a: ringArea(r) }));
  const outers = withArea.filter((x) => x.a > 0).sort((p, q) => q.a - p.a);
  if (!outers.length) return "no outline";
  if (outers.length > 1 && outers[1].a > 2) return `outline in ${outers.length} pieces`;
  let outer = outers[0].r;
  const holes = withArea.filter((x) => x.a < -0.3 && pointInRing(x.r[0], outer)).map((x) => x.r);
  let capOf: number[] = outer.map(() => -1);
  const zone = step * 1.3;
  for (const [ci, cap] of caps.entries()) {
    const inZone = outer.map((p) => {
      if (capOf[outer.indexOf(p)] >= 0) return false;
      const q = sub(p, cap.c);
      return dot(q, cap.d) > -zone && Math.abs(dot(q, cap.left)) < cap.hw + zone;
    });
    const nZ = inZone.filter(Boolean).length;
    if (!nZ) return `cap ${ci} not on the outline`;
    // One contiguous run (cyclically).
    const N = outer.length;
    let start = -1;
    for (let i = 0; i < N; i++) if (inZone[i] && !inZone[(i - 1 + N) % N]) { if (start >= 0) return `cap ${ci} cuts the outline twice`; start = i; }
    if (start < 0) return `cap ${ci} covers the outline`;
    // Rotate so the run starts at index 0, drop it, add the cap's own vertices (right to left).
    const rot = (a: P2[]) => [...a.slice(start), ...a.slice(0, start)];
    const rp = rot(outer), rc = rot(capOf as unknown as P2[]) as unknown as number[];
    const before = rp[N - 1], after = rp[nZ % N];
    const side = (p: P2) => dot(sub(p, cap.c), cap.left);
    if (!(side(before) < 0 && side(after) > 0)) return `cap ${ci} runs the wrong way round`;
    outer = [...cap.verts, ...rp.slice(nZ)];
    capOf = [...cap.verts.map(() => ci), ...rc.slice(nZ)];
  }
  // Simplify the runs between caps (cap vertices stay where they are).
  const N = outer.length;
  const firstCap = capOf.findIndex((c) => c >= 0);
  const out: P2[] = [], outCap: number[] = [];
  for (let m = 0; m < N;) {
    const i = (firstCap + m) % N;
    if (capOf[i] >= 0) { out.push(outer[i]); outCap.push(capOf[i]); m++; continue; }
    const run: P2[] = [outer[(i - 1 + N) % N]];
    while (m < N && capOf[(firstCap + m) % N] < 0) { run.push(outer[(firstCap + m) % N]); m++; }
    run.push(outer[(firstCap + m) % N]);
    const simp = simplify(run, tol);
    for (const p of simp.slice(1, -1)) { out.push(p); outCap.push(-1); }
  }
  const area = ringArea(out);
  if (area <= 0) return "outline turned inside out";
  return { outer: out, holes: holes.map((h) => simplifyClosed(h, tol)), capOf: outCap };
}

export interface SurfaceMesh {
  /** x, y per vertex. */
  xy: P2[];
  tris: number[];
  /** Outline midpoints added by refinement: the outline edge they halve (their height is its mean). */
  parents: ([number, number] | null)[];
}

/**
 * earcut over rings, keeping every vertex: earcut drops collinear points, which would leave the cells'
 * corners (and the ribbon's cap vertices) as T-vertices. For earcut only, each run of collinear
 * points is bowed into the polygon along an arch (at most 0.1 mm), which makes every point of the run
 * strictly reflex: never an ear's tip, so earcut joins each one across the band instead of spanning
 * the run with one long edge. The triangles index the exact points.
 */
function earcutRings(rings: P2[][]): number[] {
  const flat: number[] = [], holes: number[] = [];
  rings.forEach((r, ri) => {
    if (ri) holes.push(flat.length / 2);
    const n = r.length;
    const straight = r.map((p, k) => {
      const a = r[(k - 1 + n) % n], b = r[(k + 1) % n];
      const ab = sub(b, a), L2 = dot(ab, ab);
      const cr = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
      return L2 > 1e-12 && Math.abs(cr) < 1e-9 * L2;
    });
    const out = r.map((p) => [p[0], p[1]] as P2);
    const start = straight.findIndex((s) => !s);
    if (start >= 0) {
      for (let m = 0; m < n;) {
        const k = (start + m) % n;
        if (!straight[k]) { m++; continue; }
        // A run of straight points from k; its ends are the corners either side.
        const run: number[] = [];
        while (m < n && straight[(start + m) % n]) { run.push((start + m) % n); m++; }
        const a = r[(run[0] - 1 + n) % n], b = r[(run[run.length - 1] + 1) % n];
        const ab = sub(b, a), L = Math.hypot(ab[0], ab[1]);
        // The polygon's inside is on the left of every ring as given (outer anticlockwise, holes clockwise).
        const inward: P2 = [-ab[1] / L, ab[0] / L];
        for (const q of run) {
          const u = dot(sub(r[q], a), ab) / (L * L);
          const bow = 4e-4 * u * (1 - u);
          out[q] = [r[q][0] + inward[0] * bow, r[q][1] + inward[1] * bow];
        }
      }
    }
    for (const p of out) flat.push(p[0], p[1]);
  });
  return earcut(flat, holes.length ? holes : undefined);
}

/**
 * The junction surface in 2D: earcut over the outline; with a curved field `h`, refined by conforming
 * longest-edge bisection (Rivara) wherever a triangle strays from the field by more than `tol` (at its
 * middle or its longest edge's) or has an edge over `maxEdge`. Points added on the outline are
 * midpoints of an outline edge (`parents`), so their height is the linear one and the kerbs and
 * ribbons meeting that edge still meet it exactly. Triangles anticlockwise.
 */
export function junctionSurface(o: Outline, h?: (p: P2) => number, tol = 0.003, maxEdge = 10): SurfaceMesh {
  const xy: P2[] = [];
  const parents: ([number, number] | null)[] = [];
  const ids = new Map<string, number>();
  const vid = (p: P2) => {
    const k = `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
    let id = ids.get(k);
    if (id === undefined) { id = xy.length; ids.set(k, id); xy.push(p); parents.push(null); }
    return id;
  };
  const T: [number, number, number][] = [];
  const rings = [o.outer, ...o.holes];
  const local = rings.flat().map(vid);
  const t = earcutRings(rings);
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [local[t[i]], local[t[i + 1]], local[t[i + 2]]];
    if (a === b || b === c || a === c) continue;
    const A = xy[a], B = xy[b], C = xy[c];
    const cr = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    if (Math.abs(cr) < 1e-10) continue;
    T.push(cr > 0 ? [a, b, c] : [a, c, b]);
  }
  if (h) refine(xy, parents, T, h, tol, maxEdge);
  return { xy, tris: T.flat(), parents };
}

/** Conforming longest-edge bisection of triangles `T` (indices into `xy`) until every edge is at most `maxEdge`. */
function refine(xy: P2[], parents: ([number, number] | null)[], T: [number, number, number][], h: (p: P2) => number, tol: number, maxEdge: number): void {
  // Heights as the mesh will have them: the field, or the mean of the outline edge a point halves.
  const zs: number[] = [];
  const z = (v: number): number => {
    if (zs[v] === undefined) { const par = parents[v]; zs[v] = par ? (z(par[0]) + z(par[1])) / 2 : h(xy[v]); }
    return zs[v];
  };
  const alive: boolean[] = T.map(() => true);
  const edges = new Map<string, number[]>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const reg = (i: number) => {
    const [a, b, c] = T[i];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = key(p, q);
      const l = edges.get(k);
      if (l) l.push(i); else edges.set(k, [i]);
    }
  };
  const unreg = (i: number) => {
    const [a, b, c] = T[i];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = key(p, q);
      const l = edges.get(k)!.filter((x) => x !== i);
      if (l.length) edges.set(k, l); else edges.delete(k);
    }
  };
  T.forEach((_, i) => reg(i));
  const len2 = (a: number, b: number) => (xy[a][0] - xy[b][0]) ** 2 + (xy[a][1] - xy[b][1]) ** 2;
  const longest = (i: number): [number, number] => {
    const [a, b, c] = T[i];
    const ab = len2(a, b), bc = len2(b, c), ca = len2(c, a);
    return ab >= bc && ab >= ca ? [a, b] : bc >= ca ? [b, c] : [c, a];
  };
  const add = (tri: [number, number, number]) => { T.push(tri); alive.push(true); reg(T.length - 1); };
  const split = (a: number, b: number) => {
    const owners = (edges.get(key(a, b)) ?? []).slice();
    const m = xy.length;
    xy.push([(xy[a][0] + xy[b][0]) / 2, (xy[a][1] + xy[b][1]) / 2]);
    parents.push(owners.length === 1 ? [a, b] : null);
    for (const i of owners) {
      unreg(i);
      alive[i] = false;
      const [p, q, r] = T[i];
      // Rotate so the split edge is the first (u, v), in the triangle's own order.
      const [u, v, w] = (p === a && q === b) || (p === b && q === a) ? [p, q, r] : (q === a && r === b) || (q === b && r === a) ? [q, r, p] : [r, p, q];
      add([u, m, w]);
      add([m, v, w]);
    }
  };
  const max2 = maxEdge * maxEdge;
  const strays = (i: number, a: number, b: number) => {
    const [p, q, r] = T[i];
    const c: P2 = [(xy[p][0] + xy[q][0] + xy[r][0]) / 3, (xy[p][1] + xy[q][1] + xy[r][1]) / 3];
    if (Math.abs(h(c) - (z(p) + z(q) + z(r)) / 3) > tol) return true;
    // The longest edge's middle, unless it's on the outline (that point would take the linear height anyway).
    if ((edges.get(key(a, b)) ?? []).length < 2) return false;
    return Math.abs(h([(xy[a][0] + xy[b][0]) / 2, (xy[a][1] + xy[b][1]) / 2]) - (z(a) + z(b)) / 2) > tol;
  };
  for (let i = 0; i < T.length && T.length < 400000; i++) {
    while (alive[i]) {
      const [a, b] = longest(i);
      if (len2(a, b) <= max2 && (len2(a, b) < 0.04 || !strays(i, a, b))) break;
      // Walk the longest-edge propagation path to a terminal edge, and split that.
      let j = i, e = [a, b];
      for (let guard = 0; guard < 1000; guard++) {
        const nb = (edges.get(key(e[0], e[1])) ?? []).find((x) => x !== j);
        if (nb === undefined) break;
        const f = longest(nb);
        if (key(f[0], f[1]) === key(e[0], e[1])) break;
        j = nb;
        e = f;
      }
      split(e[0], e[1]);
    }
  }
  // Compact.
  const keep = T.filter((_, i) => alive[i]);
  T.length = 0;
  T.push(...keep);
}
