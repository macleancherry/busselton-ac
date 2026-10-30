// Fences, garden walls and hedges along property lines, where OpenStreetMap
// maps them (barrier=fence|wall|hedge|retaining_wall). In an Australian
// suburb that's mostly Colorbond panels and timber palings down the sides
// and backs of lots, low brick walls and hedges along the front.
//
// They follow the ground, stand on it (a little below, so no gap shows),
// and are solid. Nothing is built within reach of the route's asphalt,
// verge or nature strip, or across a side street: a mapping error must never
// put a wall on the racing line.

import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import type { Kn5MeshNode } from "./kn5";
import { MeshBuilder, type Vec3 } from "./mesh";
import type { BuildOptions } from "./options";
import type { SegmentIndex } from "./road";
import { pad } from "./roadMesh";
import { BARRIERS } from "./textures";
import { SINK } from "./sceneGround";

export interface Barrier {
  pts: Vec2[];
  /** OSM barrier value. */
  kind: "fence" | "wall" | "hedge" | "retaining_wall";
  /** OSM fence_type, material, height where tagged. */
  fenceType?: string;
  material?: string;
  height?: number;
}

type Look = (typeof BARRIERS)[number];

/** How a barrier looks, how tall and how thick it is. */
export function barrierStyle(b: Barrier): { look: Look; height: number; thick: number } {
  const tagged = b.height && b.height > 0.3 && b.height < 4 ? b.height : undefined;
  if (b.kind === "hedge") return { look: "hedge", height: tagged ?? 1.5, thick: 0.8 };
  if (b.kind === "wall" || b.kind === "retaining_wall") {
    return { look: "brickwall", height: tagged ?? (b.kind === "retaining_wall" ? 0.8 : 1.2), thick: 0.23 };
  }
  const t = `${b.fenceType ?? ""} ${b.material ?? ""}`;
  if (/wood|paling|timber|picket/.test(t)) return { look: "paling", height: tagged ?? 1.8, thick: 0.05 };
  return { look: "colorbond", height: tagged ?? 1.8, thick: 0.05 };
}

const STEP = 2; // follow the ground every 2 m

/**
 * Busselton fork: a farm fence (OSM fence_type wire, barbed_wire, electric, post_and_wire,
 * ranch...): timber posts and wire strands, not a solid panel. Built as one with the farm fences
 * (buildWireFences) when the build has farmland on.
 */
export function isWireFence(b: Barrier): boolean {
  return b.kind === "fence" && /wire|barbed|electric|ranch|split_rail|post_and_rail/.test(`${b.fenceType ?? ""} ${b.material ?? ""}`);
}

/**
 * Solid barriers, one mesh set per look. `clear` says a point is fine to
 * build on (off the road, its verges and other streets).
 */
export function buildBarriers(
  barriers: Barrier[],
  index: SegmentIndex,
  opts: BuildOptions,
  ground: HeightFn,
  clear: (x: number, y: number) => boolean,
  cover?: (x: number, y: number) => number,
): Kn5MeshNode[] {
  const meshes = new Map<Look, MeshBuilder[]>();
  const mesh = (look: Look, verts: number) => {
    const list = meshes.get(look) ?? [];
    if (!list.length || list[list.length - 1].vertexCount + verts > 60000) list.push(new MeshBuilder());
    meshes.set(look, list);
    return list[list.length - 1];
  };
  // Keep well back from the route: asphalt, verge, nature strip and a margin.
  const offRoute = (x: number, y: number) => {
    const n = index.nearest(x, y, 30);
    return !n || n.dist > index.at(n).width / 2 + opts.vergeWidth + 2.5;
  };
  const near = (x: number, y: number) => (cover ? cover(x, y) <= opts.corridor - 2 : !!index.nearest(x, y, opts.corridor - 2));

  for (const b of barriers) {
    if (opts.farmland && isWireFence(b)) continue; // built by buildWireFences
    const st = barrierStyle(b);
    // Walk the line in short steps, building only the runs that are clear.
    for (let k = 1; k < b.pts.length; k++) {
      const a = b.pts[k - 1], c = b.pts[k];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.2) continue;
      const n = Math.max(1, Math.ceil(len / STEP));
      for (let j = 0; j < n; j++) {
        const p = lerp(a, c, j / n), q = lerp(a, c, (j + 1) / n);
        const mid = lerp(p, q, 0.5);
        if (![p, q, mid].every(([x, y]) => clear(x, y) && offRoute(x, y) && near(x, y))) continue;
        slab(mesh(st.look, 24), p, q, st.thick, st.height, ground, len, j / n, (j + 1) / n);
      }
    }
  }
  const out: Kn5MeshNode[] = [];
  for (const [look, list] of meshes) {
    list.forEach((mb, i) => {
      if (mb.indices.length) out.push(mb.toKn5(`1WALL_FENCE_${look.toUpperCase()}_${pad(i)}`, `barrier_${look}`));
    });
  }
  return out;
}

function lerp(a: Vec2, b: Vec2, f: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** One stretch of barrier: both faces and the top, following the ground at each end. */
function slab(mb: MeshBuilder, p: Vec2, q: Vec2, thick: number, height: number, ground: HeightFn, segLen: number, f0: number, f1: number): void {
  const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
  const nx = (dy / l) * thick / 2, ny = (-dx / l) * thick / 2; // right of p->q
  const zp = ground(p[0], p[1]), zq = ground(q[0], q[1]);
  const u0 = (f0 * segLen) / 2, u1 = (f1 * segLen) / 2, vTop = 1 - height / 2; // texture: 2 m by 2 m, bottom at the ground
  const quad = (c: Vec3[], uv: [number, number][]) => {
    const i = mb.vertexCount;
    c.forEach((v, k) => mb.vertex(v, uv[k][0], uv[k][1]));
    mb.quad(i, i + 1, i + 2, i + 3);
  };
  const R = (v: Vec2, z: number): Vec3 => [v[0] + nx, v[1] + ny, z];
  const L = (v: Vec2, z: number): Vec3 => [v[0] - nx, v[1] - ny, z];
  // Right face (outward to the right of p->q), then the left face, then the top.
  quad([R(p, zp - SINK), R(q, zq - SINK), R(q, zq + height), R(p, zp + height)], [[u0, 1.1], [u1, 1.1], [u1, vTop], [u0, vTop]]);
  quad([L(q, zq - SINK), L(p, zp - SINK), L(p, zp + height), L(q, zq + height)], [[u1, 1.1], [u0, 1.1], [u0, vTop], [u1, vTop]]);
  if (thick > 0.1) quad([R(p, zp + height), R(q, zq + height), L(q, zq + height), L(p, zp + height)], [[u0, 0], [u1, 0], [u1, 0.05], [u0, 0.05]]);
}

/** Busselton fork: a post-and-wire farm fence: posts this far apart, wires at these heights (m). */
export const WIRE_FENCE = { postGap: 4, postHeight: 1.25, post: 0.1, wires: [0.4, 0.75, 1.1], wire: 0.025 };

/**
 * Busselton fork: post-and-wire fences (paddock boundaries, OSM wire fences), timber posts every
 * 4 m and three strands. Same rules as the solid barriers: never within reach of the route's
 * asphalt, verge and a margin, never across a street, only in the corridor; and only within
 * `reach` m of the road (`cover`, or the route when there's none). Spans nearest the road are
 * kept first, up to `maxTriangles`. Lines that run over each other (two paddocks sharing a
 * boundary) are built once. Posts are timber, wires the shared "wire" material; both solid
 * (1WALL_), like the other fences.
 */
export function buildWireFences(
  lines: Vec2[][],
  index: SegmentIndex,
  opts: BuildOptions,
  ground: HeightFn,
  clear: (x: number, y: number) => boolean,
  cover?: (x: number, y: number) => number,
  reach = 40,
  maxTriangles = 80000,
): Kn5MeshNode[] {
  const W = WIRE_FENCE;
  const dist = (x: number, y: number) => cover ? cover(x, y) : (index.nearest(x, y, opts.corridor + 10)?.dist ?? Infinity);
  const offRoute = (x: number, y: number) => {
    const n = index.nearest(x, y, 30);
    return !n || n.dist > index.at(n).width / 2 + opts.vergeWidth + 2.5;
  };
  const limit = Math.min(reach, opts.corridor - 2);
  // Every span: a post at p, wires from p to q.
  const spans: { p: Vec2; q: Vec2; d: number }[] = [];
  const seen = new Map<string, Vec2[]>();
  const dup = (m: Vec2) => {
    const cx = Math.floor(m[0] / 2), cy = Math.floor(m[1] / 2);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      if ((seen.get(`${cx + i},${cy + j}`) ?? []).some((o) => Math.hypot(o[0] - m[0], o[1] - m[1]) < 1.2)) return true;
    }
    const k = `${cx},${cy}`;
    seen.set(k, [...(seen.get(k) ?? []), m]);
    return false;
  };
  for (const pts of lines) {
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], c = pts[k];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.5) continue;
      const n = Math.max(1, Math.round(len / W.postGap));
      for (let j = 0; j < n; j++) {
        const p = lerp(a, c, j / n), q = lerp(a, c, (j + 1) / n), mid = lerp(p, q, 0.5);
        if (![p, q, mid].every(([x, y]) => clear(x, y) && offRoute(x, y) && dist(x, y) <= limit)) continue;
        if (dup(mid)) continue;
        spans.push({ p, q, d: dist(mid[0], mid[1]) });
      }
    }
  }
  // Nearest the road first, within the triangle budget (8 per post, 4 per strand per span).
  const perSpan = 8 + W.wires.length * 4;
  spans.sort((s, t) => s.d - t.d);
  const kept = spans.slice(0, Math.floor(maxTriangles / perSpan));
  const posts: MeshBuilder[] = [], wires: MeshBuilder[] = [];
  const next = (list: MeshBuilder[], verts: number) => {
    if (!list.length || list[list.length - 1].vertexCount + verts > 60000) list.push(new MeshBuilder());
    return list[list.length - 1];
  };
  // Posts at both ends of each run: a post at every span's p, and at q where no span starts there.
  const starts = new Set(kept.map((s) => `${s.p[0].toFixed(1)},${s.p[1].toFixed(1)}`));
  for (const s of kept) {
    box(next(posts, 16), s.p, W.post, -SINK, W.postHeight, ground);
    if (!starts.has(`${s.q[0].toFixed(1)},${s.q[1].toFixed(1)}`)) box(next(posts, 16), s.q, W.post, -SINK, W.postHeight, ground);
    const zp = ground(s.p[0], s.p[1]), zq = ground(s.q[0], s.q[1]);
    for (const h of W.wires) ribbon(next(wires, 8), s.p, s.q, zp + h, zq + h, W.wire);
  }
  return [
    ...posts.filter((m) => m.indices.length).map((m, i) => m.toKn5(`1WALL_FENCE_WIREPOST_${pad(i)}`, "timber")),
    ...wires.filter((m) => m.indices.length).map((m, i) => m.toKn5(`1WALL_FENCE_WIRE_${pad(i)}`, "wire")),
  ];
}

/** A square post `size` wide at `at`, from `z0` to `z1` above the ground: four sides, no top. */
export function box(mb: MeshBuilder, at: Vec2, size: number, z0: number, z1: number, ground: HeightFn): void {
  const g = ground(at[0], at[1]), h = size / 2;
  const c: Vec2[] = [[at[0] - h, at[1] - h], [at[0] + h, at[1] - h], [at[0] + h, at[1] + h], [at[0] - h, at[1] + h]];
  for (let k = 0; k < 4; k++) {
    const a = c[k], b = c[(k + 1) % 4], i = mb.vertexCount;
    mb.vertex([a[0], a[1], g + z0], 0, 1);
    mb.vertex([b[0], b[1], g + z0], 1, 1);
    mb.vertex([b[0], b[1], g + z1], 1, 0);
    mb.vertex([a[0], a[1], g + z1], 0, 0);
    mb.quad(i, i + 1, i + 2, i + 3);
  }
}

/** A thin vertical strip from p (centre height zp) to q (zq), `h` tall, seen from both sides. */
export function ribbon(mb: MeshBuilder, p: Vec2, q: Vec2, zp: number, zq: number, h: number): void {
  // Each face its own vertices, so the computed normals don't cancel out.
  for (const back of [false, true]) {
    const i = mb.vertexCount;
    mb.vertex([p[0], p[1], zp - h / 2], 0, 1);
    mb.vertex([q[0], q[1], zq - h / 2], 1, 1);
    mb.vertex([q[0], q[1], zq + h / 2], 1, 0);
    mb.vertex([p[0], p[1], zp + h / 2], 0, 0);
    if (back) mb.quad(i + 3, i + 2, i + 1, i);
    else mb.quad(i, i + 1, i + 2, i + 3);
  }
}
