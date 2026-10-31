// Busselton fork: house lots (docs/specs/lots.md). Each house gets what a WA suburban block shows
// from the street: Colorbond fences down the sides and across the back, a low limestone or brick
// wall or a hedge along the front boundary (or nothing), and a mulch bed of shrubs in front of the
// house, leaving the driveway and the path to the front door clear.
//
// Frame: local ENU (x east, y north, z up). Heights come only from the `ground` passed in, with
// SINK at every foot (docs/specs/scenery.md, the height contract). Every random choice belongs to
// a place on the map (the front wall's middle, or a shrub's spot), never to list order.

import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import type { Kn5MeshNode } from "./kn5";
import type { MeshBuilder, Vec3 } from "./mesh";
import { ChunkedMesh } from "./meshKit";
import { placeRandom } from "./random";
import { ringArea, pointInRing } from "./ringGeometry";
import { pad } from "./roadMesh";
import { SINK } from "./sceneGround";
import { FENCE_COLOURS, FENCE_HEIGHT, FENCE_PANEL, FRONT_WALL_REPEAT, SHRUB_SPECIES } from "./houseTextures";
import { frontEdgeIndex, frontSpans } from "./frontDoor";
import type { Building } from "./buildings";

export interface LotOptions {
  /** Distance from a point to the nearest road or street edge, metres; Infinity when none is near. */
  roadGap(x: number, y: number): number;
  /** Accepted for old callers and ignored: every draw is seeded from its position. */
  seed?: number;
}

const SIDE = 1.2; // the lot runs this far past the house at each end
const VERGE = 4.5; // front boundary this far back from the road edge
const YARD = 8; // back yard depth
const GROUND_STEP = 0.5;
const DRIVE_END = 3.8; // driveway in front of a garage: 0 to 3.8 m along the front wall
const NO_GARAGE_GAP = 3.2; // the gateway left at one end without a garage
const ROAD_MARGIN = 1.5;
const MAX_FRONT_GAP = 30;
const CELL = 25;

// Salts for the position-seeded draws.
const SALT_COLOUR = 0x1070;
const SALT_FRONT = 0x1071;
const SALT_DRIVE = 0x1072;
const SALT_BEDS = 0x1073;
const SALT_SHRUB = 0x1074; // + 0..3: spacing, size, species, rotation

type WallKind = "limestone" | "brick" | "hedge";
const WALL_KINDS: WallKind[] = ["limestone", "brick", "hedge"];
const WALL_MATERIAL: Record<WallKind, string> = { limestone: "frontwall_limestone", brick: "frontwall_brick", hedge: "hedge" };

// ---------------------------------------------------------------------------------------------
// Geometry helpers

/** The ring counter-clockwise (a reversed copy if it runs clockwise) and the index of its front edge. */
export function frontWall(b: Building): { ring: Vec2[]; k: number } {
  const ring = ringArea(b.ring) < 0 ? b.ring.slice().reverse() : b.ring;
  return { ring, k: frontEdgeIndex(ring, b.front) };
}

/** n + 1 evenly spaced points from a to b (both included), n = max(1, ceil(|ab| / step)). */
export function stepsAlong(a: Vec2, b: Vec2, step = GROUND_STEP): Vec2[] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / step));
  const out: Vec2[] = [];
  for (let k = 0; k <= n; k++) out.push(k === n ? [b[0], b[1]] : [a[0] + (dx * k) / n, a[1] + (dy * k) / n]);
  return out;
}

/**
 * A bottom line that follows the ground from a to b: half-metre samples at ground - SINK, thinned
 * (Douglas-Peucker on height, by sample index) to the points needed to stay within `tol` of every one.
 */
export function footAlong(a: Vec2, b: Vec2, ground: HeightFn, tol = 0.01): { pts: Vec2[]; foot: number[] } {
  const all = stepsAlong(a, b, GROUND_STEP);
  const z = all.map(([x, y]) => ground(x, y) - SINK);
  const keep = new Array<boolean>(all.length).fill(false);
  keep[0] = keep[all.length - 1] = true;
  const split = (i: number, j: number) => {
    if (j - i < 2) return;
    let worst = -1, worstD = -1;
    for (let k = i + 1; k < j; k++) {
      const line = z[i] + ((z[j] - z[i]) * (k - i)) / (j - i);
      const d = Math.abs(z[k] - line);
      if (d > worstD) {
        worstD = d;
        worst = k;
      }
    }
    if (worstD > tol) {
      keep[worst] = true;
      split(i, worst);
      split(worst, j);
    }
  };
  split(0, all.length - 1);
  const pts: Vec2[] = [], foot: number[] = [];
  all.forEach((p, k) => {
    if (keep[k]) {
      pts.push(p);
      foot.push(z[k]);
    }
  });
  return { pts, foot };
}

/**
 * One upright face along `pts` (bottoms at `foot`, a level top), facing the right-hand side of
 * first -> last. `uv(k)` gives the u and bottom v of point k; the top's v is 0.
 */
function face(mb: MeshBuilder, pts: Vec2[], foot: number[], top: number, uv: (k: number) => [number, number]): void {
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  const nx = dy / l, ny = -dx / l;
  const first = mb.vertexCount;
  pts.forEach((p, k) => {
    const [u, v] = uv(k);
    mb.vertex([p[0], p[1], foot[k]], u, v);
    mb.vertex([p[0], p[1], top], u, 0);
    mb.normals!.push(nx, ny, 0, nx, ny, 0);
  });
  for (let k = 0; k + 1 < pts.length; k++) {
    const i = first + 2 * k;
    // bottom k, bottom k + 1, top k + 1, top k: counter-clockwise seen from the right-hand side.
    mb.quad(i, i + 2, i + 3, i + 1);
  }
}

/** A flat quad facing up whatever order its corners come in. */
function quadUp(mb: MeshBuilder, pts: Vec3[], uv: (p: Vec3) => [number, number]): void {
  let area = 0;
  for (let k = 0; k < 4; k++) {
    const p = pts[k], q = pts[(k + 1) % 4];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const ordered = area < 0 ? pts.slice().reverse() : pts;
  const first = mb.vertexCount;
  for (const p of ordered) {
    const [u, v] = uv(p);
    mb.vertex(p, u, v);
    mb.normals!.push(0, 0, 1);
  }
  mb.quad(first, first + 1, first + 2, first + 3);
}

/** One fence panel from p to q: a ground-following bottom, a level top, a face on each side. */
function fencePanel(mb: MeshBuilder, p: Vec2, q: Vec2, ground: HeightFn): void {
  const { pts, foot } = footAlong(p, q, ground);
  const low = Math.min(...foot), high = Math.max(...foot);
  const top = Math.max(low + FENCE_HEIGHT, high + 0.5);
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  const along = pts.map((pt) => Math.hypot(pt[0] - p[0], pt[1] - p[1]) / len);
  const vBottom = (k: number) => (top - foot[k]) / (top - low);
  face(mb, pts, foot, top, (k) => [along[k], vBottom(k)]);
  const back = pts.length - 1;
  face(mb, pts.slice().reverse(), foot.slice().reverse(), top, (k) => [along[back - k], vBottom(back - k)]);
}

/** A wall or hedge piece from a to c: thickness d, height h over its ends' ground. */
function wallBox(mb: MeshBuilder, a: Vec2, c: Vec2, d: number, h: number, ground: HeightFn): void {
  const dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy) || 1;
  const nx = (dy / l) * (d / 2), ny = (-dx / l) * (d / 2);
  const corners: Vec2[] = [[a[0] + nx, a[1] + ny], [c[0] + nx, c[1] + ny], [c[0] - nx, c[1] - ny], [a[0] - nx, a[1] - ny]];
  const edges = corners.map((p, k) => ({ p, q: corners[(k + 1) % 4], ...footAlong(p, corners[(k + 1) % 4], ground) }));
  const highest = Math.max(...edges.flatMap((e) => e.foot)) + SINK;
  const z1 = Math.max(Math.max(ground(a[0], a[1]), ground(c[0], c[1])) + h, highest + 0.2);
  for (const e of edges) {
    face(mb, e.pts, e.foot, z1, (k) => [Math.hypot(e.pts[k][0] - e.p[0], e.pts[k][1] - e.p[1]) / 2, z1 - e.foot[k]]);
  }
  quadUp(mb, corners.map((p) => [p[0], p[1], z1] as Vec3), () => [0.5, 0.02]);
}

/** Vertices `wallBox` will make for a piece (its four edges' bottom points, two each, plus the top). */
function wallBoxVerts(a: Vec2, c: Vec2, d: number, ground: HeightFn): number {
  const dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy) || 1;
  const nx = (dy / l) * (d / 2), ny = (-dx / l) * (d / 2);
  const corners: Vec2[] = [[a[0] + nx, a[1] + ny], [c[0] + nx, c[1] + ny], [c[0] - nx, c[1] - ny], [a[0] - nx, a[1] - ny]];
  let n = 4;
  for (let k = 0; k < 4; k++) n += 2 * footAlong(corners[k], corners[(k + 1) % 4], ground).pts.length;
  return n;
}

/**
 * A garden shrub: two crossed upright quads, each two-sided (16 vertices), `size` high and 1.4 x
 * `size` wide, standing on the ground at its centre. Normals tilt up so it lights like a bush.
 */
export function shrub(mb: MeshBuilder, c: Vec2, size: number, species: 0 | 1, rot: number, ground: HeightFn): void {
  if (mb.normals === null && mb.vertexCount === 0) mb.normals = [];
  const z0 = ground(c[0], c[1]) - SINK, z1 = z0 + size;
  const hw = (1.4 * size) / 2;
  const { u0, u1 } = SHRUB_SPECIES[species];
  for (let p = 0; p < 2; p++) {
    const a = rot + (p * Math.PI) / 2;
    const ax = Math.cos(a), ay = Math.sin(a);
    const fx = Math.sin(a), fy = -Math.cos(a); // right of the axis
    for (const side of [1, -1]) {
      const nx = fx * side * 0.35, ny = fy * side * 0.35, nl = Math.hypot(nx, ny, 1);
      // Going left to right along +axis faces the right-hand side (side +1); the other side runs back.
      const l: Vec2 = [c[0] - ax * hw * side, c[1] - ay * hw * side];
      const r: Vec2 = [c[0] + ax * hw * side, c[1] + ay * hw * side];
      const first = mb.vertexCount;
      mb.vertex([l[0], l[1], z0], u0, 1);
      mb.vertex([r[0], r[1], z0], u1, 1);
      mb.vertex([r[0], r[1], z1], u1, 0);
      mb.vertex([l[0], l[1], z1], u0, 0);
      for (let k = 0; k < 4; k++) mb.normals?.push(nx / nl, ny / nl, 1 / nl);
      mb.quad(first, first + 1, first + 2, first + 3);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Lots

/** Which input houses cover a point (filed under every 25 m cell their bounding box touches). */
class HouseGrid {
  private readonly cells = new Map<string, number[]>();
  constructor(private readonly rings: Vec2[][]) {
    rings.forEach((ring, i) => {
      if (!ring.length) return;
      const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
      const x0 = Math.floor(Math.min(...xs) / CELL), x1 = Math.floor(Math.max(...xs) / CELL);
      const y0 = Math.floor(Math.min(...ys) / CELL), y1 = Math.floor(Math.max(...ys) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = `${cx},${cy}`;
          const list = this.cells.get(key);
          if (list) list.push(i);
          else this.cells.set(key, [i]);
        }
      }
    });
  }

  /** Is (x, y) inside any house but `self`? */
  insideOther(x: number, y: number, self: number): boolean {
    const list = this.cells.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`);
    return !!list && list.some((i) => i !== self && pointInRing(x, y, this.rings[i]));
  }
}

/** Fences, front walls and hedges, garden beds and shrubs for the given houses' lots. */
export function buildLots(houses: Building[], ground: HeightFn, opts: LotOptions): Kn5MeshNode[] {
  const grid = new HouseGrid(houses.map((h) => h.ring));
  const fences = FENCE_COLOURS.map(() => new ChunkedMesh());
  const walls = new Map<WallKind, ChunkedMesh>(WALL_KINDS.map((k) => [k, new ChunkedMesh()]));
  const beds = new ChunkedMesh();
  const shrubs = new ChunkedMesh();

  houses.forEach((b, self) => {
    const { ring, k } = frontWall(b);
    if (k < 0 || ring.length !== 4) return;
    const P = ring[k], Q = ring[(k + 1) % 4], R = ring[(k + 2) % 4];
    const len = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    if (len < 5) return;
    const t: Vec2 = [(Q[0] - P[0]) / len, (Q[1] - P[1]) / len];
    const o: Vec2 = [t[1], -t[0]]; // outward, toward the street
    const depth = Math.abs((R[0] - Q[0]) * o[0] + (R[1] - Q[1]) * o[1]);
    const at = (s: number, f: number): Vec2 => [P[0] + t[0] * s + o[0] * f, P[1] + t[1] * s + o[1] * f];
    const [mx, my] = at(len / 2, 0);
    const gap = opts.roadGap(mx, my);
    if (!Number.isFinite(gap) || gap > MAX_FRONT_GAP) return;

    const free = (p: Vec2) => opts.roadGap(p[0], p[1]) > ROAD_MARGIN && !grid.insideOther(p[0], p[1], self) && !pointInRing(p[0], p[1], b.ring);

    // Fences.
    const colour = Math.min(FENCE_COLOURS.length - 1, Math.floor(placeRandom(mx, my, SALT_COLOUR) * FENCE_COLOURS.length));
    const fence = fences[colour];
    const back = -(depth + YARD);
    const fenceLine = (a: Vec2, c: Vec2) => {
      const n = Math.max(1, Math.round(Math.hypot(c[0] - a[0], c[1] - a[1]) / FENCE_PANEL));
      for (let i = 0; i < n; i++) {
        const p: Vec2 = [a[0] + ((c[0] - a[0]) * i) / n, a[1] + ((c[1] - a[1]) * i) / n];
        const q: Vec2 = [a[0] + ((c[0] - a[0]) * (i + 1)) / n, a[1] + ((c[1] - a[1]) * (i + 1)) / n];
        const m: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        if (!free(p) || !free(q) || !free(m)) continue;
        fencePanel(fence.next(4 * footAlong(p, q, ground).pts.length), p, q, ground);
      }
    };
    fenceLine(at(-SIDE, -1), at(-SIDE, back));
    fenceLine(at(-SIDE, back), at(len + SIDE, back));
    const neighbour = [2, 4, 6, 8].some((d) => {
      const p = at(len + d, -depth / 2);
      return grid.insideOther(p[0], p[1], self);
    });
    if (!neighbour) fenceLine(at(len + SIDE, back), at(len + SIDE, -1));

    // Front boundary.
    const spans = frontSpans(len, b.garage);
    const wallAt = gap - VERGE;
    const pick = placeRandom(mx, my, SALT_FRONT);
    const picked: WallKind | "none" = pick < 0.35 ? "none" : pick < 0.6 ? "limestone" : pick < 0.75 ? "brick" : "hedge";
    const kind: WallKind | "none" = wallAt < ROAD_MARGIN ? "none" : (b.frontKind ?? picked);
    if (kind !== "none") {
      const drive: [number, number] = spans.garage
        ? [0, DRIVE_END]
        : placeRandom(mx, my, SALT_DRIVE) < 0.5 ? [0, NO_GARAGE_GAP] : [len - NO_GARAGE_GAP, len];
      const [h, d] = kind === "limestone" ? [0.9, 0.35]
        : kind === "brick" ? [0.8, 0.25]
        : b.hedgeHeight !== undefined ? [b.hedgeHeight, Math.max(0.8, 0.6 * b.hedgeHeight)] : [1.0, 0.8];
      const mesh = walls.get(kind)!;
      for (const [r0, r1] of [[-SIDE, drive[0]], [drive[1], len + SIDE]]) {
        for (let s = r0; s < r1 - 0.3; s += FRONT_WALL_REPEAT) {
          const e = Math.min(r1, s + FRONT_WALL_REPEAT);
          const a = at(s, wallAt), c = at(e, wallAt);
          if (!free(a) || !free(c)) continue;
          wallBox(mesh.next(wallBoxVerts(a, c, d, ground)), a, c, d, h, ground);
        }
      }
    }

    // Garden beds and shrubs.
    if (placeRandom(mx, my, SALT_BEDS) >= 0.75) return;
    const bedDepth = Math.min(1.4, Math.max(0, gap - 2.5));
    if (bedDepth <= 0.6 + 1e-9) return; // 3.1 - 2.5 is a hair over 0.6 in floats
    const start = spans.garage ? DRIVE_END : 0;
    const runs: [number, number][] = spans.door ? [[start, spans.door[0] - 0.5], [spans.door[1] + 0.5, len]] : [[start, len]];
    for (const [g0, g1] of runs) {
      if (g1 - g0 < 1.5) continue;
      const corners = [at(g0, 0.05), at(g1, 0.05), at(g1, bedDepth), at(g0, bedDepth)];
      quadUp(beds.next(4), corners.map((p) => [p[0], p[1], ground(p[0], p[1]) + 0.04] as Vec3), (p) => [p[0] / 2, p[1] / 2]);
      for (let s = g0 + 0.7; s < g1 - 0.4;) {
        const c = at(s, bedDepth / 2 + 0.05);
        const r = (j: number) => placeRandom(c[0], c[1], SALT_SHRUB + j);
        shrub(shrubs.next(16), c, 0.8 + 0.7 * r(1), r(2) < 0.5 ? 0 : 1, r(3) * Math.PI, ground);
        s += 1.6 + 1.4 * r(0);
      }
    }
  });

  const out: Kn5MeshNode[] = [];
  FENCE_COLOURS.forEach((c, i) => {
    const name = c.name.toLowerCase();
    fences[i].all().forEach((mb, j) => out.push(mb.toKn5(`1WALL_FENCE_${name}_${pad(j)}`, `fence_${name}`)));
  });
  for (const kind of WALL_KINDS) {
    walls.get(kind)!.all().forEach((mb, j) => out.push(mb.toKn5(`1WALL_FRONT_${kind}_${pad(j)}`, WALL_MATERIAL[kind])));
  }
  beds.all().forEach((mb, j) => out.push(mb.toKn5(`GARDENBED_${pad(j)}`, "mulch", { castShadows: false })));
  shrubs.all().forEach((mb, j) => out.push(mb.toKn5(`SHRUBS_${pad(j)}`, "shrubs", { castShadows: true })));
  return out;
}
