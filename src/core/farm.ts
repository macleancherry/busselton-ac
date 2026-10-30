// Busselton fork: the vineyards and paddocks landscape zone (ROADMAP.md phase C).
//
// - Vine rows on OSM landuse=vineyard: straight rows about 3 m apart along the block's long
//   axis, each a low leafy canopy on a trellis (a post every 8 m, a cordon wire under the leaves),
//   with a few metres of headland left bare at the ends for the tractor. Cheap: about 18
//   triangles per 8 m of row. Rows nearest the road are kept first, up to a triangle cap.
// - Post-and-wire fences along paddock and vineyard boundaries beside the road, and wherever OSM
//   maps a wire fence (fences.ts buildWireFences).
//
// The canopy has its own material (vine_leaf) so CSP can tint it with the seasons (cspConfig.ts,
// `vines`): gold in autumn. Everything stays in the corridor, off the road and its verges, and
// off other streets.

import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import type { Kn5MeshNode } from "./kn5";
import { MeshBuilder } from "./mesh";
import type { BuildOptions } from "./options";
import type { SegmentIndex } from "./road";
import { pad } from "./roadMesh";
import { buildWireFences, box, isWireFence, ribbon, type Barrier } from "./fences";
import { encodePng } from "./png";
import { fill, rng } from "./textures";

/** A vineyard or paddock: exterior ring first, then holes; `edge[r][i]` false where ring r's edge i is only a tile seam. */
export interface FarmPolygon {
  kind: "vineyard" | "paddock";
  rings: Vec2[][];
  edge: boolean[][];
}

export const VINE = {
  /** Between rows, m. */
  spacing: 3,
  /** Bare ground left at each end of a row, m. */
  headland: 4,
  /** Length of one piece of row (it follows the ground piece by piece), m. */
  piece: 8,
  /** Canopy from this height to the top, m, and its width. */
  canopyBase: 0.85,
  canopyTop: 1.75,
  canopyWidth: 0.55,
  /** The cordon wire just under the leaves. */
  wire: 0.8,
  post: 0.09,
  postTop: 1.85,
};

/**
 * Which way the rows run: along the block's long axis. Blocks are mostly rectangles, so the
 * boundary's main edge direction (length-weighted, folded into 90 degrees, tile seams ignored)
 * gives the rectangle; of its two axes, the one the block is longer along wins. Unit vector.
 */
export function rowDirection(poly: FarmPolygon): Vec2 {
  const ring = poly.rings[0];
  const real = poly.edge[0]?.some((e) => e) ?? false;
  const bins = new Float64Array(90);
  for (let i = 0; i < ring.length; i++) {
    if (real && !poly.edge[0][i]) continue;
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.01) continue;
    let deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    deg = ((deg % 90) + 90) % 90;
    // Spread over neighbouring degrees so slightly wobbly edges still agree.
    for (let k = -3; k <= 3; k++) bins[(Math.round(deg) + k + 90) % 90] += len * (4 - Math.abs(k));
  }
  let best = 0;
  for (let k = 1; k < 90; k++) if (bins[k] > bins[best]) best = k;
  const t = (best * Math.PI) / 180;
  const u: Vec2 = [Math.cos(t), Math.sin(t)], v: Vec2 = [-Math.sin(t), Math.cos(t)];
  const extent = (d: Vec2) => {
    const s = ring.map((p) => p[0] * d[0] + p[1] * d[1]);
    return Math.max(...s) - Math.min(...s);
  };
  return extent(u) >= extent(v) ? u : v;
}

/**
 * The rows of one vineyard: straight runs across the polygon (holes cut out), on lines a
 * multiple of `spacing` from the origin so blocks split across map tiles line up, less the
 * headland at each end.
 */
export function vineRows(poly: FarmPolygon, spacing = VINE.spacing, headland = VINE.headland): [Vec2, Vec2][] {
  const d = rowDirection(poly), n: Vec2 = [-d[1], d[0]];
  const across = poly.rings[0].map((p) => p[0] * n[0] + p[1] * n[1]);
  const lo = Math.min(...across), hi = Math.max(...across);
  const rows: [Vec2, Vec2][] = [];
  for (let k = Math.ceil(lo / spacing + 0.5); (k - 0.5) * spacing < hi; k++) {
    const o = (k - 0.5) * spacing;
    // Where the line n.p = o crosses every ring edge, as distances along d.
    const ts: number[] = [];
    for (const ring of poly.rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const ca = a[0] * n[0] + a[1] * n[1] - o, cb = b[0] * n[0] + b[1] * n[1] - o;
        if ((ca > 0) === (cb > 0)) continue;
        const f = ca / (ca - cb);
        const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
        ts.push(x * d[0] + y * d[1]);
      }
    }
    ts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < ts.length; i += 2) {
      const t0 = ts[i] + headland, t1 = ts[i + 1] - headland;
      if (t1 - t0 < 2) continue;
      const at = (t: number): Vec2 => [n[0] * o + d[0] * t, n[1] * o + d[1] * t];
      rows.push([at(t0), at(t1)]);
    }
  }
  return rows;
}

/**
 * Triangles in one piece of row: canopy sides and top (6), post (8), cordon wire both faces (4),
 * plus an allowance for the end caps and last posts where rows stop.
 */
const PIECE_TRIS = 20;

/**
 * Vine rows over the vineyards, as visual-only meshes: VINES_* (vine_leaf), VINEPOSTS_* (timber),
 * VINEWIRE_* (wire). `place` says a point is fine to build on; `dist` how far it is from the road.
 */
export function buildVines(
  polys: FarmPolygon[],
  ground: HeightFn,
  place: (x: number, y: number) => boolean,
  dist: (x: number, y: number) => number,
  maxTriangles = 150000,
): { nodes: Kn5MeshNode[]; metres: number } {
  type Piece = { p: Vec2; q: Vec2; d: number; row: number; k: number };
  const pieces: Piece[] = [];
  let row = 0;
  for (const poly of polys) {
    if (poly.kind !== "vineyard") continue;
    for (const [a, b] of vineRows(poly)) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.round(len / VINE.piece));
      for (let k = 0; k < n; k++) {
        const p = lerp(a, b, k / n), q = lerp(a, b, (k + 1) / n), m = lerp(p, q, 0.5);
        if (![p, q, m].every(([x, y]) => place(x, y))) continue;
        pieces.push({ p, q, d: dist(m[0], m[1]), row, k });
      }
      row++;
    }
  }
  pieces.sort((s, t) => s.d - t.d || s.row - t.row || s.k - t.k);
  const kept = pieces.slice(0, Math.floor(maxTriangles / PIECE_TRIS));
  const has = new Set(kept.map((s) => `${s.row}:${s.k}`));
  const leaf: MeshBuilder[] = [], posts: MeshBuilder[] = [], wire: MeshBuilder[] = [];
  const next = (list: MeshBuilder[], verts: number) => {
    if (!list.length || list[list.length - 1].vertexCount + verts > 60000) list.push(new MeshBuilder());
    return list[list.length - 1];
  };
  let metres = 0;
  for (const s of kept) {
    const zp = ground(s.p[0], s.p[1]), zq = ground(s.q[0], s.q[1]);
    canopy(next(leaf, 20), s.p, s.q, zp, zq, !has.has(`${s.row}:${s.k - 1}`), !has.has(`${s.row}:${s.k + 1}`));
    box(next(posts, 16), s.p, VINE.post, -0.2, VINE.postTop, ground);
    if (!has.has(`${s.row}:${s.k + 1}`)) box(next(posts, 16), s.q, VINE.post, -0.2, VINE.postTop, ground);
    ribbon(next(wire, 8), s.p, s.q, zp + VINE.wire, zq + VINE.wire, 0.02);
    metres += Math.hypot(s.q[0] - s.p[0], s.q[1] - s.p[1]);
  }
  const nodes = [
    ...leaf.filter((m) => m.indices.length).map((m, i) => m.toKn5(`VINES_${pad(i)}`, "vine_leaf", { castShadows: true })),
    ...posts.filter((m) => m.indices.length).map((m, i) => m.toKn5(`VINEPOSTS_${pad(i)}`, "timber")),
    ...wire.filter((m) => m.indices.length).map((m, i) => m.toKn5(`VINEWIRE_${pad(i)}`, "wire")),
  ];
  return { nodes, metres };
}

/** One piece of leafy canopy: both sides, the top, and a closed end where the row stops. */
function canopy(mb: MeshBuilder, p: Vec2, q: Vec2, zp: number, zq: number, capStart: boolean, capEnd: boolean): void {
  const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
  const w = VINE.canopyWidth / 2, rx = (dy / l) * w, ry = (-dx / l) * w; // right of p->q
  const lo = VINE.canopyBase, hi = VINE.canopyTop, u = l / 2; // texture 2 m along
  const quad = (c: [number, number, number][], uv: [number, number][]) => {
    const i = mb.vertexCount;
    c.forEach((v, k) => mb.vertex(v, uv[k][0], uv[k][1]));
    mb.quad(i, i + 1, i + 2, i + 3);
  };
  const R = (v: Vec2, z: number): [number, number, number] => [v[0] + rx, v[1] + ry, z];
  const L = (v: Vec2, z: number): [number, number, number] => [v[0] - rx, v[1] - ry, z];
  // A little narrower at the top, like a trimmed vertical shoot position canopy.
  const T = (side: (v: Vec2, z: number) => [number, number, number], v: Vec2, z: number): [number, number, number] => {
    const s = side(v, z);
    return [v[0] + (s[0] - v[0]) * 0.7, v[1] + (s[1] - v[1]) * 0.7, z];
  };
  quad([R(p, zp + lo), R(q, zq + lo), T(R, q, zq + hi), T(R, p, zp + hi)], [[0, 1], [u, 1], [u, 0], [0, 0]]);
  quad([L(q, zq + lo), L(p, zp + lo), T(L, p, zp + hi), T(L, q, zq + hi)], [[u, 1], [0, 1], [0, 0], [u, 0]]);
  quad([T(R, p, zp + hi), T(R, q, zq + hi), T(L, q, zq + hi), T(L, p, zp + hi)], [[0, 0.1], [u, 0.1], [u, 0], [0, 0]]);
  if (capStart) quad([L(p, zp + lo), R(p, zp + lo), T(R, p, zp + hi), T(L, p, zp + hi)], [[0, 1], [0.3, 1], [0.3, 0], [0, 0]]);
  if (capEnd) quad([R(q, zq + lo), L(q, zq + lo), T(L, q, zq + hi), T(R, q, zq + hi)], [[0, 1], [0.3, 1], [0.3, 0], [0, 0]]);
}

/** Vine leaves, 2 m along by 1 m tall: mottled green, darker low down, a few lighter tips. */
export function vineLeafTexture(): Uint8Array {
  const w = 128, h = 64;
  const r = rng(731);
  return encodePng(fill(w, h, (_x, y) => {
    const k = 0.65 + r() * 0.55 - (y / h) * 0.2;
    const tip = r() < 0.06 ? 1.25 : 1;
    return [Math.min(255, 58 * k * tip), Math.min(255, 96 * k * tip), Math.min(255, 38 * k)];
  }), w, h, { alpha: false });
}

/** The boundaries worth a fence: every real (not tile seam) edge of the paddocks and vineyards. */
export function farmBoundaries(polys: FarmPolygon[]): Vec2[][] {
  const lines: Vec2[][] = [];
  for (const poly of polys) {
    poly.rings.forEach((ring, r) => {
      let run: Vec2[] = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        if (poly.edge[r]?.[i] === false) {
          if (run.length > 1) lines.push(run);
          run = [];
          continue;
        }
        if (!run.length) run.push(a);
        run.push(b);
      }
      if (run.length > 1) lines.push(run);
    });
  }
  return lines;
}

/**
 * The whole zone: vine rows on the vineyards and post-and-wire fences along farm boundaries and
 * OSM wire fences, within the corridor. `clear` says a point is off other streets; `cover` how
 * far into what's built it is.
 */
export function buildFarmland(
  polys: FarmPolygon[],
  barriers: Barrier[],
  index: SegmentIndex,
  opts: BuildOptions,
  ground: HeightFn,
  clear: (x: number, y: number) => boolean,
  cover: (x: number, y: number) => number,
): { nodes: Kn5MeshNode[]; vineMetres: number } {
  const offRoute = (x: number, y: number) => {
    const n = index.nearest(x, y, 30);
    return !n || n.dist > index.at(n).width / 2 + opts.vergeWidth + 3;
  };
  const vines = buildVines(polys, ground, (x, y) => clear(x, y) && offRoute(x, y) && cover(x, y) <= opts.corridor - 2, cover);
  const fences = buildWireFences(
    [...barriers.filter(isWireFence).map((b) => b.pts), ...farmBoundaries(polys)],
    index, opts, ground, clear, cover,
  );
  return { nodes: [...vines.nodes, ...fences], vineMetres: vines.metres };
}

function lerp(a: Vec2, b: Vec2, f: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
