// Property-line barriers from OSM (fences, garden walls, hedges, retaining walls) as solid slabs
// that follow the ground, and post-and-wire farm fences. Nothing is built within reach of the
// route's asphalt, verge or nature strip, or where `clear` says no (side streets, roundabouts).
// Spec: docs/specs/fences.md. Geometry in ENU, via MeshBuilder.

import { type Vec2 } from "./geo";
import { type HeightFn } from "./elevation";
import { type Kn5MeshNode } from "./kn5";
import { type BuildOptions } from "./options";
import { type SegmentIndex } from "./road";
import { type BARRIERS } from "./textures";
import { MeshBuilder } from "./mesh";
import { pad as threeDigits } from "./roadMesh";
import { SINK } from "./sceneGround";

export interface Barrier {
  pts: Vec2[]; // ENU metres
  kind: "fence" | "wall" | "hedge" | "retaining_wall"; // OSM barrier=*
  fenceType?: string; // OSM fence_type
  material?: string; // OSM material
  height?: number; // OSM height, metres
}

type Look = (typeof BARRIERS)[number];
type Style = { look: Look; height: number; thick: number };
type Where = (x: number, y: number) => boolean;
type Measure = (x: number, y: number) => number;

/** A new builder before one would pass this many vertices (kn5 allows 65535). */
const MESH_VERTICES = 60000;
/** Off-route margin beyond asphalt and verge, metres. Vine rows in farm.ts use 3 m: not a bug. */
const MARGIN = 2.5;
const PALING = /wood|paling|timber|picket/;
const WIRE = /wire|barbed|electric|ranch|split_rail|post_and_rail/;

const tagText = ({ fenceType = "", material = "" }: Barrier) => `${fenceType} ${material}`.toLowerCase();
const at = (p: Vec2, q: Vec2, t: number): Vec2 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
const length = (p: Vec2, q: Vec2) => Math.hypot(q[0] - p[0], q[1] - p[1]);

export function barrierStyle(b: Barrier): Style {
  const h = b.height;
  const tagged = h !== undefined && h > 0.3 && h < 4 ? h : undefined;
  if (b.kind === "hedge") return { look: "hedge", height: tagged ?? 1.5, thick: 0.8 };
  if (b.kind === "wall" || b.kind === "retaining_wall") return { look: "brickwall", height: tagged ?? (b.kind === "wall" ? 1.2 : 0.8), thick: 0.23 };
  return { look: PALING.test(tagText(b)) ? "paling" : "colorbond", height: tagged ?? 1.8, thick: 0.05 };
}

export const isWireFence = (b: Barrier): boolean => b.kind === "fence" && WIRE.test(tagText(b));

/** True when (x, y) is clear of the route's asphalt, verge and nature strip. */
const offRoute = (index: SegmentIndex, opts: BuildOptions): Where => (x, y) => {
  const hit = index.nearest(x, y, 30);
  return hit === null || hit.dist > index.at(hit).width / 2 + opts.vergeWidth + MARGIN;
};

/** Builders that split before the kn5 vertex limit, on the true vertex count of what comes next. */
class Split {
  private readonly builders = [new MeshBuilder()];
  next(vertices: number): MeshBuilder {
    const last = this.builders[this.builders.length - 1];
    if (last.vertexCount + vertices <= MESH_VERTICES) return last;
    const fresh = new MeshBuilder();
    this.builders.push(fresh);
    return fresh;
  }
  nodes(prefix: string, material: string): Kn5MeshNode[] {
    return this.builders.filter((mb) => mb.indices.length).map((mb, i) => mb.toKn5(`${prefix}_${threeDigits(i)}`, material));
  }
}

export function buildBarriers(list: Barrier[], index: SegmentIndex, opts: BuildOptions, ground: HeightFn, clear: Where, cover?: Measure): Kn5MeshNode[] {
  const away = offRoute(index, opts);
  const reach = opts.corridor - 2;
  const inside: Where = cover ? (x, y) => cover(x, y) <= reach : (x, y) => index.nearest(x, y, reach) !== null;
  const allowed = ([x, y]: Vec2) => clear(x, y) && away(x, y) && inside(x, y);
  const looks = new Map<Look, Split>(); // in the order first built

  for (const barrier of list) {
    if (opts.farmland && isWireFence(barrier)) continue; // the farm fences build it
    const style = barrierStyle(barrier);
    barrier.pts.forEach((p, s) => {
      const q = barrier.pts[s + 1];
      if (!q) return;
      const segLen = length(p, q);
      if (segLen < 0.2) return;
      const steps = Math.max(1, Math.ceil(segLen / 2)); // follow the ground every 2 m or less
      for (let step = 0; step < steps; step++) {
        const t0 = step / steps, t1 = (step + 1) / steps;
        const from = at(p, q, t0), to = at(p, q, t1);
        if (![from, to, at(p, q, (t0 + t1) / 2)].every(allowed)) continue;
        if (!looks.has(style.look)) looks.set(style.look, new Split());
        const mb = looks.get(style.look)!.next(style.thick > 0.1 ? 12 : 8);
        slab(mb, from, to, [(t0 * segLen) / 2, (t1 * segLen) / 2], style, ground);
      }
    });
  }
  return [...looks].flatMap(([look, split]) => split.nodes(`1WALL_FENCE_${look.toUpperCase()}`, `barrier_${look}`));
}

/**
 * One step of wall from p to q: right and left faces, plus a top on thick barriers; no ends or
 * bottom. Sunk SINK into the ground, `height` above it at each end. One 2 m tile, bottom at ground.
 */
function slab(mb: MeshBuilder, p: Vec2, q: Vec2, [uP, uQ]: [number, number], { height, thick }: Style, ground: HeightFn) {
  const run = length(p, q);
  const side: Vec2 = [((q[1] - p[1]) / run) * (thick / 2), (-(q[0] - p[0]) / run) * (thick / 2)]; // to the right of p -> q
  const gp = ground(p[0], p[1]), gq = ground(q[0], q[1]);
  const vUp = 1 - height / 2;
  const corner = (end: Vec2, sign: number, z: number, u: number, v: number) => mb.vertex([end[0] + side[0] * sign, end[1] + side[1] * sign, z], u, v);
  const face = (k: number[]) => mb.quad(k[0], k[1], k[2], k[3]);
  face([corner(p, 1, gp - SINK, uP, 1.1), corner(q, 1, gq - SINK, uQ, 1.1), corner(q, 1, gq + height, uQ, vUp), corner(p, 1, gp + height, uP, vUp)]);
  face([corner(q, -1, gq - SINK, uQ, 1.1), corner(p, -1, gp - SINK, uP, 1.1), corner(p, -1, gp + height, uP, vUp), corner(q, -1, gq + height, uQ, vUp)]);
  if (thick > 0.1) face([corner(p, 1, gp + height, uP, 0), corner(q, 1, gq + height, uQ, 0), corner(q, -1, gq + height, uQ, 0.05), corner(p, -1, gp + height, uP, 0.05)]);
}

export const WIRE_FENCE = { postGap: 4, postHeight: 1.25, post: 0.1, wires: [0.4, 0.75, 1.1], wire: 0.025 };

export function buildWireFences(
  lines: Vec2[][], index: SegmentIndex, opts: BuildOptions, ground: HeightFn, clear: Where, cover?: Measure, reach = 40, maxTriangles = 80000,
): Kn5MeshNode[] {
  const roadDist: Measure = cover ?? ((x, y) => index.nearest(x, y, opts.corridor + 10)?.dist ?? Infinity);
  const away = offRoute(index, opts);
  const limit = Math.min(reach, opts.corridor - 2);
  const allowed = ([x, y]: Vec2) => clear(x, y) && away(x, y) && roadDist(x, y) <= limit;

  // Accepted span midpoints on a 2 m grid: a span within 1.2 m of one is a repeat (shared boundaries).
  const grid = new Map<string, Vec2[]>();
  const cell = (cx: number, cy: number) => `${cx},${cy}`;
  const repeats = (m: Vec2) => {
    const cx = Math.floor(m[0] / 2), cy = Math.floor(m[1] / 2);
    return [-1, 0, 1].some((ox) => [-1, 0, 1].some((oy) => (grid.get(cell(cx + ox, cy + oy)) ?? []).some((o) => length(o, m) < 1.2)));
  };
  const spans: { p: Vec2; q: Vec2; d: number }[] = [];
  for (const pts of lines) {
    pts.forEach((a, s) => {
      const c = pts[s + 1];
      if (!c || length(a, c) < 0.5) return;
      const parts = Math.max(1, Math.round(length(a, c) / WIRE_FENCE.postGap));
      for (let j = 0; j < parts; j++) {
        const p = at(a, c, j / parts), q = at(a, c, (j + 1) / parts), mid = at(a, c, (j + 0.5) / parts);
        if (!allowed(p) || !allowed(q) || !allowed(mid) || repeats(mid)) continue;
        const key = cell(Math.floor(mid[0] / 2), Math.floor(mid[1] / 2));
        grid.set(key, [...(grid.get(key) ?? []), mid]);
        spans.push({ p, q, d: roadDist(mid[0], mid[1]) });
      }
    });
  }
  // Nearest the road first, within the triangle budget. The budget counts one post per span, so
  // the extra end posts can take it slightly over: it is approximate.
  const trianglesPerSpan = 8 + 4 * WIRE_FENCE.wires.length;
  const kept = spans.sort((x, y) => x.d - y.d).slice(0, Math.floor(maxTriangles / trianglesPerSpan));

  const posts = new Split(), wires = new Split();
  const spot = ([x, y]: Vec2) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const spanStarts = new Set(kept.map((span) => spot(span.p)));
  const post = (where: Vec2) => box(posts.next(16), where, WIRE_FENCE.post, -SINK, WIRE_FENCE.postHeight, ground);
  for (const { p, q } of kept) {
    post(p);
    if (!spanStarts.has(spot(q))) post(q);
    const zp = ground(p[0], p[1]), zq = ground(q[0], q[1]);
    WIRE_FENCE.wires.forEach((w) => ribbon(wires.next(8), p, q, zp + w, zq + w, WIRE_FENCE.wire));
  }
  return posts.nodes("1WALL_FENCE_WIREPOST", "timber").concat(wires.nodes("1WALL_FENCE_WIRE", "wire"));
}

/** A square post `size` wide centred on `centre`, from ground + z0 to ground + z1; four outward sides. */
export function box(mb: MeshBuilder, centre: Vec2, size: number, z0: number, z1: number, ground: HeightFn): void {
  const r = size / 2, g = ground(centre[0], centre[1]);
  const ring: Vec2[] = [[-r, -r], [r, -r], [r, r], [-r, r]].map(([dx, dy]) => [centre[0] + dx, centre[1] + dy]);
  ring.forEach((c0, i) => {
    const c1 = ring[(i + 1) % ring.length];
    const k = [mb.vertex([c0[0], c0[1], g + z0], 0, 1), mb.vertex([c1[0], c1[1], g + z0], 1, 1), mb.vertex([c1[0], c1[1], g + z1], 1, 0), mb.vertex([c0[0], c0[1], g + z1], 0, 0)];
    mb.quad(k[0], k[1], k[2], k[3]);
  });
}

/** A vertical strip `h` tall centred on zp at p and zq at q, with a face to each side. */
export function ribbon(mb: MeshBuilder, p: Vec2, q: Vec2, zp: number, zq: number, h: number): void {
  const strip = () => [mb.vertex([p[0], p[1], zp - h / 2], 0, 1), mb.vertex([q[0], q[1], zq - h / 2], 1, 1), mb.vertex([q[0], q[1], zq + h / 2], 1, 0), mb.vertex([p[0], p[1], zp + h / 2], 0, 0)];
  const front = strip();
  mb.quad(front[0], front[1], front[2], front[3]);
  const back = strip();
  mb.quad(back[3], back[2], back[1], back[0]);
}
