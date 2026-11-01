// The checks behind course_marks_check.ts, on one layout (testable without a zip).
//
// Openings are found here on their own, from the world's surface alone (not from the streets and
// rings the markings were laid from): every place along the course where the road carries on past
// the course's kerb line. Each one must be the course itself (the course is there again further
// on: its own turn, a ring leg) or have a ripple strip across it. Runs longer than PARALLEL metres
// are a road alongside (a divided road's other carriageway, a parking lane) and are counted apart.
import type { AiPoint } from "../../src/core/aiSpline";
import { courseEdges, courseOf, MARK_MESH, type SurfaceProbe } from "../../src/core/courseMarks";
import type { Kn5MeshNode } from "../../src/core/kn5";

type Vec2 = [number, number];
const PARALLEL = 25;

export interface MarksReport {
  openings: number;
  /** Roundabout arms the course doesn't use, and those without a strip. */
  ringArms: number;
  ringOpen: Vec2[];
  open: Vec2[];
  alongside: number;
  onLine: Vec2[];
  postsOnRoad: Vec2[];
}

/** Triangles of some meshes in plan (local x, y), by a 4 m grid, for point-in-footprint tests. */
function footprint(meshes: Kn5MeshNode[]) {
  const CELL = 4;
  const tris: number[] = [];
  const grid = new Map<number, number[]>();
  const key = (cx: number, cy: number) => (cx + 32768) * 65536 + cy + 32768;
  for (const m of meshes) {
    const p = m.positions, ix = m.indices;
    for (let i = 0; i < ix.length; i += 3) {
      const t = tris.length / 6;
      const xs: number[] = [], ys: number[] = [];
      for (let k = 0; k < 3; k++) { const v = ix[i + k] * 3; xs.push(p[v]); ys.push(-p[v + 2]); tris.push(p[v], -p[v + 2]); }
      for (let cx = Math.floor(Math.min(...xs) / CELL); cx <= Math.floor(Math.max(...xs) / CELL); cx++) {
        for (let cy = Math.floor(Math.min(...ys) / CELL); cy <= Math.floor(Math.max(...ys) / CELL); cy++) {
          const l = grid.get(key(cx, cy));
          if (l) l.push(t); else grid.set(key(cx, cy), [t]);
        }
      }
    }
  }
  return (x: number, y: number) => (grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []).some((t) => {
    const o = t * 6;
    const [ax, ay, bx, by, cx, cy] = tris.slice(o, o + 6);
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-9) return false;
    const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
    const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
    return u >= 0 && v >= 0 && u + v <= 1;
  });
}

/** Vertices of some meshes in plan, by a 4 m grid: is there one within r of a point? */
function vertexNear(meshes: Kn5MeshNode[]) {
  const CELL = 4;
  const grid = new Map<number, Vec2[]>();
  const key = (cx: number, cy: number) => (cx + 32768) * 65536 + cy + 32768;
  for (const m of meshes) {
    for (let k = 0; k < m.positions.length; k += 3) {
      const q: Vec2 = [m.positions[k], -m.positions[k + 2]];
      const kk = key(Math.floor(q[0] / CELL), Math.floor(q[1] / CELL));
      const l = grid.get(kk);
      if (l) l.push(q); else grid.set(kk, [q]);
    }
  }
  return (x: number, y: number, r: number) => {
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
      for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++) {
        for (const q of grid.get(key(cx, cy)) ?? []) if (Math.hypot(q[0] - x, q[1] - y) <= r) return true;
      }
    }
    return false;
  };
}

/**
 * `rings`: the roundabouts the course drives round (course_marks.json). Openings near them are the
 * ring's arms, checked on their own: walking round the ring just outside its edge, every stretch of
 * road is an arm, and each arm is the course (its AI line goes out or comes in there) or has a strip.
 */
export function checkLayoutMarks(ai: AiPoint[], meshes: Kn5MeshNode[], probe: SurfaceProbe, rings: { c: Vec2; rOut: number }[] = []): MarksReport {
  const c = courseOf(ai);
  const edges = courseEdges(c, probe);
  const marks = meshes.filter((m) => MARK_MESH.test(m.name));
  const strips = vertexNear(marks.filter((m) => m.name.startsWith("1RIPPLE")));
  const n = c.p.length;
  const road = (q: Vec2) => probe(q[0], q[1])?.kind === "road";
  const at = (i: number, f: number, side: number, off: number): Vec2 => {
    const j = (i + 1) % n;
    const p: Vec2 = [c.p[i][0] + (c.p[j][0] - c.p[i][0]) * f, c.p[i][1] + (c.p[j][1] - c.p[i][1]) * f];
    const t = c.t[i];
    const e = (side > 0 ? edges.left : edges.right)[i];
    return [p[0] - t[1] * side * (e + off), p[1] + t[0] * side * (e + off)];
  };
  // Course points within 5 m of q more than 15 m along from point i.
  const elsewhere = (q: Vec2, i: number) => c.p.some((p, j) => {
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 5) return false;
    let d = Math.abs(c.s[j] - c.s[i]);
    if (c.closed) d = Math.min(d, c.total - d);
    return d > 15;
  });
  // A road running alongside (a divided road's other carriageway at a median gap or where a splitter
  // island ends): a few metres past the kerb line, the road carries on 15 m along the course one way
  // or the other (a side street is narrower than that).
  const alongside = (q: Vec2, t: Vec2) => [15, -15].some((d) => road([q[0] + t[0] * d, q[1] + t[1] * d]));
  const report: MarksReport = { openings: 0, ringArms: 0, ringOpen: [], open: [], alongside: 0, onLine: [], postsOnRoad: [] };
  const nearRing = (q: Vec2) => rings.some((r) => Math.hypot(q[0] - r.c[0], q[1] - r.c[1]) < r.rOut + 12);
  for (const r of rings) {
    const R = r.rOut + 1.5, N = 360;
    const on = Array.from({ length: N }, (_, k) => road([r.c[0] + Math.cos((k / N) * 2 * Math.PI) * R, r.c[1] + Math.sin((k / N) * 2 * Math.PI) * R]));
    if (on.every(Boolean)) continue;
    const start = on.indexOf(false);
    let k = 0;
    while (k < N) {
      const a = (start + k) % N;
      if (!on[a]) { k++; continue; }
      let len = 0;
      while (k < N && on[(start + k) % N]) { k++; len++; }
      if (len * (2 * Math.PI * R) / N < 2) continue;
      const mid = ((a + len / 2) / N) * 2 * Math.PI;
      const dir: Vec2 = [Math.cos(mid), Math.sin(mid)];
      // The course's own arm: it goes out or comes in within 25 degrees of it (on a divided arm, by the other carriageway).
      if (c.p.some((p) => {
        const d = Math.hypot(p[0] - r.c[0], p[1] - r.c[1]);
        return d > r.rOut + 4 && d < r.rOut + 14 && ((p[0] - r.c[0]) * dir[0] + (p[1] - r.c[1]) * dir[1]) / d > Math.cos((25 * Math.PI) / 180);
      })) continue;
      report.ringArms++;
      const edge: Vec2 = [r.c[0] + dir[0] * (r.rOut + 0.5), r.c[1] + dir[1] * (r.rOut + 0.5)];
      if (!strips(edge[0], edge[1], 3)) report.ringOpen.push(edge);
    }
  }
  for (const side of [1, -1]) {
    // Samples about every half metre: open where the road carries on 0.6 and 2 m past the kerb line.
    const samples: { q: Vec2; open: boolean; covered: boolean }[] = [];
    for (let i = 0; i < (c.closed ? n : n - 1); i++) {
      const seg = Math.hypot(c.p[(i + 1) % n][0] - c.p[i][0], c.p[(i + 1) % n][1] - c.p[i][1]);
      const k = Math.max(1, Math.round(seg / 0.5));
      for (let m = 0; m < k; m++) {
        const f = m / k;
        const open = !nearRing(c.p[i]) && road(at(i, f, side, 0.6)) && road(at(i, f, side, 2)) && !elsewhere(at(i, f, side, 8), i) && !alongside(at(i, f, side, 2.5), c.t[i]) && !alongside(at(i, f, side, 4), c.t[i]);
        const q = at(i, f, side, 0.3);
        samples.push({ q, open, covered: open && strips(q[0], q[1], 3) });
      }
    }
    let k = 0;
    while (k < samples.length) {
      if (!samples[k].open) { k++; continue; }
      let j = k;
      while (j + 1 < samples.length && samples[j + 1].open) j++;
      const run = samples.slice(k, j + 1);
      const metres = run.length * 0.5;
      if (metres > PARALLEL) report.alongside++;
      else if (metres >= 2.5) {
        report.openings++;
        if (run.filter((s) => s.covered).length < 0.7 * run.length) report.open.push(run[run.length >> 1].q);
      }
      k = j + 1;
    }
  }
  // Nothing a car could touch on the AI line (paint aside: grid boxes and the start line are meant to be there,
  // and the arch's beam is 5 m up).
  const solid = footprint(marks.filter((m) => !m.name.startsWith("CM_PAINT") && !m.name.startsWith("CM_ARCH")));
  c.p.forEach((p, i) => {
    const t = c.t[i];
    for (const off of [0, 0.9, -0.9]) {
      const q: Vec2 = [p[0] - t[1] * off, p[1] + t[0] * off];
      if (solid(q[0], q[1])) { report.onLine.push(q); break; }
    }
  });
  // The arch posts stand off the road.
  for (const m of marks.filter((x) => x.name.startsWith("1WALL_CMARCH"))) {
    let sx = 0, sy = 0;
    const cnt = m.positions.length / 3;
    for (let k = 0; k < m.positions.length; k += 3) { sx += m.positions[k]; sy -= m.positions[k + 2]; }
    const q: Vec2 = [sx / cnt, sy / cnt];
    if (road(q)) report.postsOnRoad.push(q);
  }
  return report;
}
