// The drivable corridor's ground: which square chunks to build, the finished ground height
// anywhere (the DEM pulled to the road, sunk just under it, blended back out), the ceiling the
// built side streets put on it, the chunk meshes (with flat-ground simplification), and the
// highest drawn grid height at a point. Written fresh from docs/specs/terrain.md.

import type { Area } from "./area";
import type { HeightFn } from "./elevation";
import { KERB_H, STRIP_EXTRA } from "./kerbs";
import { MAX_MESH_VERTICES, type Kn5MeshNode, type Kn5Node } from "./kn5";
import { MeshBuilder } from "./mesh";
import type { BuildOptions } from "./options";
import type { Nearest, RoadPlan, SegmentIndex } from "./road";
import { outerRadius, ringHeight, toOpening, vergeOuterRadius } from "./roundabout";

/** A square of ground, local metres. Keys start with `t` (backdrop keys with `b`). */
export interface TerrainChunk { key: string; minX: number; minY: number; maxX: number; maxY: number }
/** Ground height and distance to the route's centreline (Infinity when far; 0 on a ring's disc). */
export interface TerrainSample { h: number; dist: number }
export type TerrainFn = (x: number, y: number) => TerrainSample;

/** Ground beside a gravel verge sits this far under the road edge. */
export const BELOW_VERGE = 0.25;
/** Added (times the kerb fraction) behind a kerb: the ground ends 3 cm under the nature strip. */
export const KERB_LIFT = BELOW_VERGE + KERB_H - 0.03;
const LOD_TOL = 0.02;
const LOD_TOL_FAR = 0.05;
const LOD_FAR = 40;
/** First level block, cells a side. */
const K = 4;
/** Second level group, blocks a side. */
const S = 4;
/** The ground stays this far under a built street. */
export const STREET_GAP = 0.04;
/** Street raster cell, metres. */
const STREET_CELL = 1;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------
// 1. Chunks

export function planTerrainChunks(plan: RoadPlan, index: SegmentIndex, opts: BuildOptions, area: Area | null = null): TerrainChunk[] {
  const size = opts.chunkSize, pad = opts.corridor;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of plan.samples) {
    minX = Math.min(minX, s.pos[0]); maxX = Math.max(maxX, s.pos[0]);
    minY = Math.min(minY, s.pos[1]); maxY = Math.max(maxY, s.pos[1]);
  }
  if (area) {
    minX = Math.min(minX, area.minX); maxX = Math.max(maxX, area.maxX);
    minY = Math.min(minY, area.minY); maxY = Math.max(maxY, area.maxY);
  }
  if (!Number.isFinite(minX)) return [];
  const reach = opts.corridor + 0.75 * size;
  const out: TerrainChunk[] = [];
  for (let j = Math.floor((minY - pad) / size); j <= Math.floor((maxY + pad) / size); j++) {
    for (let i = Math.floor((minX - pad) / size); i <= Math.floor((maxX + pad) / size); i++) {
      const cx = (i + 0.5) * size, cy = (j + 0.5) * size;
      const keep = index.nearest(cx, cy, reach) !== null || (area !== null && area.signed(cx, cy) < 0.75 * size);
      if (!keep) continue;
      out.push({ key: "t" + String(out.length).padStart(3, "0"), minX: i * size, minY: j * size, maxX: (i + 1) * size, maxY: (j + 1) * size });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 2. The ground function

/**
 * Ground from `beyond` (at the made surface's inner edge) down to `under` under the surface two
 * grid steps in, a straight ramp over exactly two cells, then level.
 */
function underRoad(surface: number, beyond: number, fromEdge: number, opts: BuildOptions): number {
  const k = clamp01(fromEdge / (2 * opts.terrainStep));
  return beyond + (surface - opts.terrainUnderRoad - beyond) * k;
}

interface RouteSample extends TerrainSample {
  /** Under the route's made surface (road, verge, kerb, strip). */
  under: boolean;
}

export function makeTerrainFn(plan: RoadPlan, index: SegmentIndex, dem: HeightFn, opts: BuildOptions): TerrainFn {
  const reach = opts.corridor + opts.terrainBlend + 10;
  const samples = plan.samples;
  const lastSeg = index.segmentCount - 1;
  const crownAt = (n: Nearest): number => {
    const a = samples[n.seg].crown ?? opts.crown;
    const b = samples[(n.seg + 1) % samples.length].crown ?? opts.crown;
    return a + (b - a) * n.frac;
  };

  const route = (x: number, y: number, ground: number): RouteSample => {
    const n = index.nearest(x, y, reach);
    if (!n) return { h: ground, dist: Infinity, under: false };
    const at = index.at(n);
    const half = at.width / 2;
    const inner = half + opts.vergeWidth + (at.kerb > 0 ? STRIP_EXTRA : 0);
    const tc = Math.max(-half, Math.min(half, n.t));
    const edge = at.h + at.bank * tc - crownAt(n) * Math.abs(tc);
    const base = edge - BELOW_VERGE + KERB_LIFT * at.kerb;
    const pastEnd = !plan.closed && ((n.seg === 0 && n.frac === 0) || (n.seg === lastSeg && n.frac === 1));
    if (!pastEnd && n.dist <= inner) return { h: underRoad(edge, base, inner - n.dist, opts), dist: n.dist, under: true };
    const f = smoothstep((n.dist - inner) / opts.terrainBlend);
    return { h: base + (ground - base) * f, dist: n.dist, under: false };
  };

  const rings = plan.roundabouts;
  return (x, y) => {
    const ground = dem(x, y);
    const r = route(x, y, ground);
    if (!rings.length) return { h: r.h, dist: r.dist };
    let disc: number | null = null; // lowest disc height among rings the point is on
    let best = r.h, bestOff = Math.abs(r.h - ground);
    let dist = r.dist;
    for (const rb of rings) {
      const dx = x - rb.c[0], dy = y - rb.c[1];
      const d = Math.hypot(dx, dy);
      const Ro = outerRadius(rb), E = vergeOuterRadius(rb, opts);
      if (d > E + opts.terrainBlend) continue;
      // How closed the ring's edge is here: 0 in a mouth (no kerb or verge), 1 from 2.5 m away.
      const closed = clamp01((toOpening(rb, Ro, Math.atan2(dy, dx)) - 0.5) / 2);
      const rim = ringHeight(rb, Ro);
      const sunk = rim - opts.terrainUnderRoad;
      const kerbBase = rim - BELOW_VERGE + (rb.kerbed ? KERB_LIFT : 0);
      const base = sunk + (kerbBase - sunk) * closed;
      if (d <= E) {
        let h = underRoad(ringHeight(rb, Math.min(d, Ro)), base, E - d, opts);
        if (closed < 1 && r.under) h = Math.min(h, r.h);
        disc = disc === null ? h : Math.min(disc, h);
        continue;
      }
      // Blend ring: the route's made surface wins outright.
      dist = Math.min(dist, Math.max(0, d - Ro));
      if (r.under) continue;
      const h = base + (ground - base) * smoothstep((d - E) / opts.terrainBlend);
      const off = Math.abs(h - ground);
      if (off > bestOff) { best = h; bestOff = off; }
    }
    if (disc !== null) return { h: disc, dist: 0 };
    return { h: best, dist };
  };
}

// ---------------------------------------------------------------------------------------------
// 3. Ground under side streets

/** A node that is, or holds, a street surface mesh (`1STREET...`, `1UNPAVED...`). */
export const isStreetNode = (n: Kn5Node): boolean =>
  n.kind === "mesh" ? /^1(STREET|UNPAVED)/.test(n.name) : n.children.some(isStreetNode);

/**
 * The lowest built street surface within `reach` metres of a point (local x, y), or null away from
 * streets, from the meshes given (AC coordinates; every mesh in them counts, so filter first, e.g.
 * with `isStreetNode`). Rasterised on a 1 m grid keeping the lowest height per cell.
 */
export function streetCeiling(meshes: Kn5Node[], reach: number): (x: number, y: number) => number | null {
  const cells = new Map<number, number>();
  const key = (i: number, j: number) => (i + 2_000_000) * 4_000_000 + (j + 2_000_000);
  const C = STREET_CELL;
  const add = (m: Kn5MeshNode) => {
    const p = m.positions, idx = m.indices;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const x1 = p[a], y1 = -p[a + 2], h1 = p[a + 1];
      const x2 = p[b], y2 = -p[b + 2], h2 = p[b + 1];
      const x3 = p[c], y3 = -p[c + 2], h3 = p[c + 1];
      const den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
      if (Math.abs(den) < 1e-9) continue;
      const i0 = Math.floor(Math.min(x1, x2, x3) / C), i1 = Math.floor(Math.max(x1, x2, x3) / C);
      const j0 = Math.floor(Math.min(y1, y2, y3) / C), j1 = Math.floor(Math.max(y1, y2, y3) / C);
      for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * C;
        for (let j = j0; j <= j1; j++) {
          const py = (j + 0.5) * C;
          let w1 = ((y2 - y3) * (px - x3) + (x3 - x2) * (py - y3)) / den;
          let w2 = ((y3 - y1) * (px - x3) + (x1 - x3) * (py - y3)) / den;
          let w3 = 1 - w1 - w2;
          if (w1 < -0.5 || w2 < -0.5 || w3 < -0.5) continue;
          w1 = Math.max(0, w1); w2 = Math.max(0, w2); w3 = Math.max(0, w3);
          const h = (w1 * h1 + w2 * h2 + w3 * h3) / (w1 + w2 + w3);
          const k = key(i, j), old = cells.get(k);
          if (old === undefined || h < old) cells.set(k, h);
        }
      }
    }
  };
  const walk = (n: Kn5Node): void => (n.kind === "mesh" ? add(n) : n.children.forEach(walk));
  meshes.forEach(walk);
  const r = Math.ceil(reach / C);
  return (x, y) => {
    if (!cells.size) return null;
    const ci = Math.floor(x / C), cj = Math.floor(y / C);
    let low: number | null = null;
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        const h = cells.get(key(i, j));
        if (h === undefined || (low !== null && h >= low)) continue;
        if (Math.hypot((i + 0.5) * C - x, (j + 0.5) * C - y) <= reach + C) low = h;
      }
    }
    return low;
  };
}

/** The ground held `gap` under the street ceiling wherever it would come up closer; only ever lowers. */
export function underStreets(terrain: TerrainFn, ceiling: (x: number, y: number) => number | null, gap = STREET_GAP): TerrainFn {
  return (x, y) => {
    const t = terrain(x, y);
    const top = ceiling(x, y);
    return top !== null && t.h > top - gap ? { h: top - gap, dist: t.dist } : t;
  };
}

// ---------------------------------------------------------------------------------------------
// 4. Chunk meshes

/** Grid cells a side and the real step for a chunk side (the step isn't exactly `terrainStep`). */
function gridOf(size: number, terrainStep: number): { cells: number; step: number } {
  const cells = Math.max(1, Math.round(size / terrainStep));
  return { cells, step: size / cells };
}

export function buildTerrainChunk(
  chunk: TerrainChunk,
  terrain: TerrainFn,
  opts: BuildOptions,
  textured: boolean,
  area: Area | null = null,
  nearStreet?: (x: number, y: number) => boolean,
): Kn5MeshNode | null {
  const size = chunk.maxX - chunk.minX;
  const { cells, step } = gridOf(size, opts.terrainStep);
  const verts = (cells + 1) * (cells + 1);
  if (verts > MAX_MESH_VERTICES) {
    throw new Error(
      `terrain chunk ${chunk.key}: a ${step.toFixed(2)} m grid over ${size} m needs ${verts} vertices, over the kn5 limit of ${MAX_MESH_VERTICES}. `
      + `Raise terrainStep (at least ${(size / (Math.floor(Math.sqrt(MAX_MESH_VERTICES)) - 1)).toFixed(2)} m) or lower chunkSize.`,
    );
  }
  const N = cells + 1; // nodes a side
  const P = cells + 3; // padded nodes a side (one extra all round, for normals)
  const ph = new Float64Array(P * P);
  const dist = new Float64Array(N * N);
  const inside = new Uint8Array(N * N);
  const tight = new Uint8Array(N * N);
  for (let pj = 0; pj < P; pj++) {
    for (let pi = 0; pi < P; pi++) {
      const i = pi - 1, j = pj - 1;
      const x = chunk.minX + i * step, y = chunk.minY + j * step;
      const s = terrain(x, y);
      ph[pj * P + pi] = s.h;
      if (i < 0 || j < 0 || i > cells || j > cells) continue;
      const n = j * N + i;
      dist[n] = s.dist;
      inside[n] = s.dist <= opts.corridor || (area?.inside(x, y) ?? false) ? 1 : 0;
      tight[n] = nearStreet?.(x, y) ? 1 : 0;
    }
  }
  const H = (i: number, j: number) => ph[(j + 1) * P + (i + 1)];
  const cellIn = (i: number, j: number) =>
    inside[j * N + i] && inside[j * N + i + 1] && inside[(j + 1) * N + i] && inside[(j + 1) * N + i + 1];

  let any = false;
  for (let j = 0; j < cells && !any; j++) for (let i = 0; i < cells; i++) if (cellIn(i, j)) { any = true; break; }
  if (!any) return null;

  // Level of detail: 0 fine, 1 first-level coarse block, 2 in a second-level super block.
  const B = Math.floor(cells / K);
  const state = new Uint8Array(B * B);
  const stateAt = (bi: number, bj: number) => (bi < 0 || bj < 0 || bi >= B || bj >= B ? 0 : state[bj * B + bi]);
  if (opts.terrainLod && B > 0) {
    const farTol = opts.terrainLodFarTol ?? LOD_TOL_FAR;
    const tolAt = (i: number, j: number) => (dist[j * N + i] < LOD_FAR || tight[j * N + i] ? LOD_TOL : farTol);
    const fits = (i0: number, j0: number, n: number) => fanFits(H, tolAt, i0, j0, n);
    for (let bj = 0; bj < B; bj++) {
      for (let bi = 0; bi < B; bi++) {
        const i0 = bi * K, j0 = bj * K;
        let ok = true;
        for (let j = j0; j < j0 + K && ok; j++) for (let i = i0; i < i0 + K && ok; i++) if (!cellIn(i, j)) ok = false;
        for (let j = j0; j <= j0 + K && ok; j++) for (let i = i0; i <= i0 + K && ok; i++) if (dist[j * N + i] < opts.terrainLodNear) ok = false;
        if (ok && fits(i0, j0, K)) state[bj * B + bi] = 1;
      }
    }
    const B2 = Math.floor(B / S);
    for (let gj = 0; gj < B2; gj++) {
      for (let gi = 0; gi < B2; gi++) {
        let ok = true;
        for (let bj = gj * S; bj < gj * S + S && ok; bj++) for (let bi = gi * S; bi < gi * S + S && ok; bi++) if (state[bj * B + bi] !== 1) ok = false;
        const i0 = gi * S * K, j0 = gj * S * K, n = S * K;
        for (let j = j0; j <= j0 + n && ok; j++) for (let i = i0; i <= i0 + n && ok; i++) if (dist[j * N + i] < LOD_FAR) ok = false;
        if (ok && fits(i0, j0, n)) {
          for (let bj = gj * S; bj < gj * S + S; bj++) for (let bi = gi * S; bi < gi * S + S; bi++) state[bj * B + bi] = 2;
        }
      }
    }
  }

  // Vertices: only nodes a triangle uses.
  const mb = new MeshBuilder();
  const normals: number[] = [];
  const vid = new Int32Array(N * N).fill(-1);
  const v = (i: number, j: number): number => {
    const n = j * N + i;
    if (vid[n] >= 0) return vid[n];
    const x = chunk.minX + i * step, y = chunk.minY + j * step;
    const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * step);
    const dy = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
    const l = Math.hypot(dx, dy, 1);
    normals.push(-dx / l, -dy / l, 1 / l);
    vid[n] = textured ? mb.vertex([x, y, H(i, j)], i / cells, 1 - j / cells) : mb.vertex([x, y, H(i, j)], x / 10, -y / 10);
    return vid[n];
  };

  const blockOf = (i: number, j: number) => {
    const bi = Math.floor(i / K), bj = Math.floor(j / K);
    return bi < B && bj < B ? stateAt(bi, bj) : 0;
  };
  // Fine cells.
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      if (!cellIn(i, j) || blockOf(i, j) !== 0) continue;
      const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1);
      if ((i + j) % 2 === 0) { mb.tri(a, b, c); mb.tri(a, c, d); }
      else { mb.tri(a, b, d); mb.tri(b, c, d); }
    }
  }
  // A fan from the centre round a block's boundary loop (counter-clockwise from above).
  // keep(edge, k) says whether edge node k (1..n-1) stays; corners always do.
  const fan = (i0: number, j0: number, n: number, keep: (edge: number, k: number) => boolean) => {
    const loop: number[] = [];
    for (let e = 0; e < 4; e++) {
      for (let k = 0; k < n; k++) {
        if (k > 0 && !keep(e, k)) continue;
        const [i, j] = edgeNode(i0, j0, n, e, k);
        loop.push(v(i, j));
      }
    }
    const c = v(i0 + n / 2, j0 + n / 2);
    for (let m = 0; m < loop.length; m++) mb.tri(c, loop[m], loop[(m + 1) % loop.length]);
  };
  // Block across each edge: south, east, north, west.
  const across = (bi: number, bj: number, e: number, off: number): [number, number] =>
    e === 0 ? [bi + off, bj - 1] : e === 1 ? [bi + 1, bj + off] : e === 2 ? [bi - off, bj + 1] : [bi - 1, bj - off];
  for (let bj = 0; bj < B; bj++) {
    for (let bi = 0; bi < B; bi++) {
      if (state[bj * B + bi] !== 1) continue;
      fan(bi * K, bj * K, K, (e) => stateAt(...across(bi, bj, e, 0)) === 0);
    }
  }
  const B2 = Math.floor(B / S);
  for (let gj = 0; gj < B2; gj++) {
    for (let gi = 0; gi < B2; gi++) {
      const bi0 = gi * S, bj0 = gj * S;
      if (state[bj0 * B + bi0] !== 2) continue;
      // Along edge e, the block beside segment k..k+1 is the (floor(k / K))-th along that edge.
      // Walking an edge in loop order: south W->E, east S->N, north E->W, west N->S.
      const besideState = (e: number, seg: number) => {
        const m = Math.floor(seg / K);
        const off = e === 0 || e === 1 ? m : S - 1 - m;
        const [bi, bj] = e === 0 ? [bi0 + off, bj0 - 1] : e === 1 ? [bi0 + S, bj0 + off] : e === 2 ? [bi0 + off, bj0 + S] : [bi0 - 1, bj0 + off];
        return stateAt(bi, bj);
      };
      fan(gi * S * K, gj * S * K, S * K, (e, k) => {
        for (const seg of [k - 1, k]) {
          const st = besideState(e, seg);
          if (st === 0) return true;
          if (st === 1 && k % K === 0) return true;
        }
        return false;
      });
    }
  }

  mb.normals = normals;
  return mb.toKn5(`1GRASS_${chunk.key}`, textured ? `terrain_${chunk.key}` : "grass");
}

/** Node k (0..n-1) along a block's edge e (0 south W->E, 1 east S->N, 2 north E->W, 3 west N->S). */
function edgeNode(i0: number, j0: number, n: number, e: number, k: number): [number, number] {
  return e === 0 ? [i0 + k, j0] : e === 1 ? [i0 + n, j0 + k] : e === 2 ? [i0 + n - k, j0 + n] : [i0, j0 + n - k];
}

/**
 * Whether an n x n block drawn as a fan from its centre fits the true node heights: every node within
 * its tolerance of the drawn surface, whichever of its edge nodes end up kept (corners always are).
 * The fan's quarter towards each edge is fixed; a node in it reads the line from the centre to where
 * that ray meets the edge, and the edge's drawn height there is a straight line between some kept
 * node at or before it and some at or after it. Every such pair is tried, so the answer holds for
 * any choice the neighbours force.
 */
function fanFits(
  H: (i: number, j: number) => number,
  tolAt: (i: number, j: number) => number,
  i0: number, j0: number, n: number,
): boolean {
  const c = n / 2;
  const hc = H(i0 + c, j0 + c);
  for (let b = 0; b <= n; b++) {
    for (let a = 0; a <= n; a++) {
      if (a === c && b === c) continue;
      const dx = a - c, dy = b - c;
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      const s = m / c; // fraction from centre to edge
      // The edge the ray meets, and the position along it (0..n in that edge's own index order).
      let edge: (k: number) => number;
      let q: number;
      if (Math.abs(dx) >= Math.abs(dy)) {
        const ei = dx > 0 ? n : 0;
        q = c + (dy * c) / m;
        edge = (k) => H(i0 + ei, j0 + k);
      } else {
        const ej = dy > 0 ? n : 0;
        q = c + (dx * c) / m;
        edge = (k) => H(i0 + k, j0 + ej);
      }
      const truth = H(i0 + a, j0 + b), tol = tolAt(i0 + a, j0 + b);
      const lo = Math.floor(q + 1e-9), hi = Math.ceil(q - 1e-9);
      for (let l = lo; l >= 0; l--) {
        const hl = edge(l);
        for (let r = Math.max(hi, l); r <= n; r++) {
          const qh = r === l ? hl : hl + ((edge(r) - hl) * (q - l)) / (r - l);
          const drawn = hc + (qh - hc) * s;
          if (Math.abs(drawn - truth) > tol) return false;
        }
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// 5. Highest drawn ground

/**
 * The highest the full-resolution terrain grid can be at a point: the higher of the two triangle
 * readings in its cell, so never under the mesh whichever diagonal a chunk drew. Reads the terrain
 * function given (track.ts passes the analytic one) on the grid every chunk uses.
 */
export function meshTop(terrain: TerrainFn, opts: BuildOptions): (x: number, y: number) => number {
  const { step } = gridOf(opts.chunkSize, opts.terrainStep);
  const cache = new Map<number, number>();
  const node = (i: number, j: number) => {
    const k = (i + 2_000_000) * 4_000_000 + (j + 2_000_000);
    let h = cache.get(k);
    if (h === undefined) {
      if (cache.size > 200_000) cache.clear();
      h = terrain(i * step, j * step).h;
      cache.set(k, h);
    }
    return h;
  };
  return (x, y) => {
    const fx = x / step, fy = y / step;
    const i = Math.floor(fx), j = Math.floor(fy);
    const u = fx - i, w = fy - j;
    const h00 = node(i, j), h10 = node(i + 1, j), h01 = node(i, j + 1), h11 = node(i + 1, j + 1);
    // Split (0,0)-(1,1).
    const a = u >= w ? h00 + u * (h10 - h00) + w * (h11 - h10) : h00 + u * (h11 - h01) + w * (h01 - h00);
    // Split (1,0)-(0,1).
    const b = u + w <= 1 ? h00 + u * (h10 - h00) + w * (h01 - h00) : h11 + (1 - u) * (h01 - h11) + (1 - w) * (h10 - h11);
    return Math.max(a, b);
  };
}
