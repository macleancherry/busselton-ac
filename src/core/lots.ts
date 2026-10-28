// What sits around a house on a WA suburban lot: a Colorbond fence down the
// side boundary and across the back, a low limestone or brick wall or a
// hedge along the front boundary (or nothing, which is common), a garden bed
// of mulch and shrubs along the front of the house, and a gap in the front
// wall for the driveway in front of the garage.
//
// Lots are laid out from each house's street wall: the lot runs 1.2 m past
// the house on each side, the front boundary sits about 4.5 m back from the
// road's edge (the verge and footpath), and the yard runs 8 m behind.

import { pointInRing, ringArea, type Building } from "./buildings";
import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import type { Kn5MeshNode } from "./kn5";
import type { MeshBuilder, Vec3 } from "./mesh";
import { pad } from "./roadMesh";
import { ChunkedMesh, rng } from "./scenery";
import { FENCE_COLOURS, FENCE_PANEL, FENCE_HEIGHT, FRONT_WALL_REPEAT, SHRUB_SPECIES } from "./houseTextures";

const SIDE = 1.2;
const VERGE = 4.5;
const YARD = 8;

export interface LotOptions {
  /** Distance from a point to the nearest road or street edge, metres (Infinity if none near). */
  roadGap: (x: number, y: number) => number;
  seed?: number;
}

type FrontKind = "none" | "limestone" | "brick" | "hedge";

/** The driveway runs from the garage door at the start of the front wall (as buildings.ts draws it). */
const DRIVE: [number, number] = [0, 3.8];

/** The ring counter-clockwise, with the index of the front wall in it (-1 if none). */
export function frontWall(b: Building): { ring: Vec2[]; k: number } {
  const ring = ringArea(b.ring) < 0 ? b.ring.slice().reverse() : b.ring;
  if (!b.front) return { ring, k: -1 };
  const [f0, f1] = b.front;
  const same = (a: Vec2, c: Vec2) => Math.hypot(a[0] - c[0], a[1] - c[1]) < 0.05;
  const k = ring.findIndex((p, i) => {
    const q = ring[(i + 1) % ring.length];
    return (same(p, f0) && same(q, f1)) || (same(p, f1) && same(q, f0));
  });
  return { ring, k };
}

export function buildLots(houses: Building[], ground: HeightFn, opts: LotOptions): Kn5MeshNode[] {
  const rand = rng(opts.seed ?? 21);
  const fences = FENCE_COLOURS.map(() => new ChunkedMesh(0));
  const fronts = { limestone: new ChunkedMesh(0), brick: new ChunkedMesh(0), hedge: new ChunkedMesh(0) };
  const beds = new ChunkedMesh(0);
  const shrubs = new ChunkedMesh(0);

  // Grid of house footprints, to keep fences out of the neighbours' houses.
  const grid = new Map<string, Building[]>();
  const key = (x: number, y: number) => `${Math.floor(x / 25)},${Math.floor(y / 25)}`;
  for (const b of houses) {
    const seen = new Set<string>();
    for (const [x, y] of b.ring) {
      const k = key(x, y);
      if (seen.has(k)) continue;
      seen.add(k);
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(b);
    }
  }
  const inHouse = (x: number, y: number, self?: Building) =>
    (grid.get(key(x, y)) ?? []).some((b) => b !== self && pointInRing(x, y, b.ring));
  const free = (x: number, y: number, self: Building) => opts.roadGap(x, y) > 1.5 && !inHouse(x, y, self) && !pointInRing(x, y, self.ring);

  for (const b of houses) {
    const { ring, k: street } = frontWall(b);
    if (street < 0 || ring.length !== 4) continue;
    const P = ring[street], Q = ring[(street + 1) % 4];
    const len = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    if (len < 5) continue;
    const t: Vec2 = [(Q[0] - P[0]) / len, (Q[1] - P[1]) / len];
    const o: Vec2 = [t[1], -t[0]]; // toward the street
    const R = ring[(street + 2) % 4];
    const depth = Math.abs((R[0] - Q[0]) * o[0] + (R[1] - Q[1]) * o[1]);
    const at = (s: number, f: number): Vec2 => [P[0] + t[0] * s + o[0] * f, P[1] + t[1] * s + o[1] * f];
    const mid = at(len / 2, 0);
    const gap = opts.roadGap(mid[0], mid[1]);
    if (!isFinite(gap) || gap > 30) continue;

    const colour = Math.floor(rand() * FENCE_COLOURS.length);
    // Side fence on the start side, from the building line to the back of the yard; across the back.
    const back = -(depth + YARD);
    fence(fences[colour], [at(-SIDE, -1), at(-SIDE, back)], ground, (p) => free(p[0], p[1], b));
    fence(fences[colour], [at(-SIDE, back), at(len + SIDE, back)], ground, (p) => free(p[0], p[1], b));
    // The end side too, when there's no house next door to fence it.
    const neighbour = [2, 4, 6, 8].some((d) => inHouse(...at(len + d, -depth / 2), b));
    if (!neighbour) fence(fences[colour], [at(len + SIDE, back), at(len + SIDE, -1)], ground, (p) => free(p[0], p[1], b));

    // Front boundary, leaving the driveway open.
    const wallAt = gap - VERGE;
    const roll = rand();
    const kind: FrontKind = wallAt < 1.5 ? "none" : roll < 0.35 ? "none" : roll < 0.6 ? "limestone" : roll < 0.75 ? "brick" : "hedge";
    const drive = b.garage ? DRIVE : rand() < 0.5 ? [0, 3.2] : [len - 3.2, len];
    if (kind !== "none") {
      const spec = kind === "hedge" ? { h: 1.0, d: 0.8 } : kind === "limestone" ? { h: 0.9, d: 0.35 } : { h: 0.8, d: 0.25 };
      const runs: [number, number][] = [[-SIDE, drive[0]], [drive[1], len + SIDE]];
      for (const [s0, s1] of runs) {
        for (let s = s0; s < s1 - 0.3; s += FRONT_WALL_REPEAT) {
          const e = Math.min(s1, s + FRONT_WALL_REPEAT);
          const a = at(s, wallAt), c = at(e, wallAt);
          if (!free(a[0], a[1], b) || !free(c[0], c[1], b)) continue;
          wallBox(fronts[kind].next(24), a, c, spec.d, ground, spec.h);
        }
      }
    }

    // Garden beds along the front of the house: not across the driveway, and
    // leaving a path to the front door (where buildings.ts puts it).
    if (rand() < 0.75) {
      const door = b.garage ? Math.min(len - 1.4, 4.2) : len / 3;
      const runs: [number, number][] = [[b.garage ? DRIVE[1] : 0, door - 0.5], [door + 1.35, len]];
      const bedDepth = Math.min(1.4, Math.max(0, gap - 2.5));
      for (const [g0, g1] of runs) {
        if (g1 - g0 < 1.5 || bedDepth <= 0.6) continue;
        bed(beds.next(8), at(g0, 0.05), at(g1, 0.05), at(g1, bedDepth), at(g0, bedDepth), ground);
        const sm = shrubs.next(48);
        for (let s = g0 + 0.7; s < g1 - 0.4; s += 1.6 + rand() * 1.4) {
          shrub(sm, at(s, bedDepth / 2 + 0.05), 0.8 + rand() * 0.7, rand() < 0.5 ? 0 : 1, rand() * Math.PI, ground);
        }
      }
    }
  }

  const out: Kn5MeshNode[] = [];
  fences.forEach((cm, c) => cm.all().forEach((m, i) => out.push(m.toKn5(`1WALL_FENCE_${FENCE_COLOURS[c].name}_${pad(i)}`, `fence_${FENCE_COLOURS[c].name}`))));
  (["limestone", "brick", "hedge"] as const).forEach((k) =>
    fronts[k].all().forEach((m, i) => out.push(m.toKn5(`1WALL_FRONT_${k}_${pad(i)}`, k === "hedge" ? "hedge" : `frontwall_${k}`))));
  beds.all().forEach((m, i) => out.push(m.toKn5(`GARDENBED_${pad(i)}`, "mulch", { castShadows: false })));
  shrubs.all().forEach((m, i) => out.push(m.toKn5(`SHRUBS_${pad(i)}`, "shrubs", { castShadows: true })));
  return out;
}

/** Colorbond fence along a line: one two-sided panel every 2.4 m, stepped to the ground. */
function fence(cm: ChunkedMesh, [a, b]: [Vec2, Vec2], ground: HeightFn, ok: (p: Vec2) => boolean): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.round(len / FENCE_PANEL));
  for (let k = 0; k < n; k++) {
    const p: Vec2 = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
    const q: Vec2 = [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n];
    const m: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (!ok(p) || !ok(q) || !ok(m)) continue;
    const z = Math.min(ground(p[0], p[1]), ground(q[0], q[1])) - 0.05;
    const mb = cm.next(8);
    const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
    for (const side of [1, -1]) {
      const nrm: Vec3 = [(dy / l) * side, (-dx / l) * side, 0];
      const i = mb.vertexCount;
      mb.vertex([p[0], p[1], z], 0, 1);
      mb.vertex([q[0], q[1], z], 1, 1);
      mb.vertex([q[0], q[1], z + FENCE_HEIGHT], 1, 0);
      mb.vertex([p[0], p[1], z + FENCE_HEIGHT], 0, 0);
      for (let j = 0; j < 4; j++) mb.normals!.push(...nrm);
      if (side === 1) mb.quad(i, i + 1, i + 2, i + 3);
      else mb.quad(i, i + 3, i + 2, i + 1);
    }
  }
}

/** A low wall or hedge from a to c, `depth` thick and `h` high: two faces, two ends and a top. */
function wallBox(mb: MeshBuilder, a: Vec2, c: Vec2, depth: number, ground: HeightFn, h: number): void {
  const dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy) || 1;
  const nx = dy / l * depth / 2, ny = -dx / l * depth / 2;
  const z0 = Math.min(ground(a[0], a[1]), ground(c[0], c[1])) - 0.1;
  const z1 = Math.max(ground(a[0], a[1]), ground(c[0], c[1])) + h;
  const corners: Vec2[] = [[a[0] + nx, a[1] + ny], [c[0] + nx, c[1] + ny], [c[0] - nx, c[1] - ny], [a[0] - nx, a[1] - ny]];
  // Corners run counter-clockwise from above, so each edge's outside is to its right.
  for (let k = 0; k < 4; k++) {
    const p = corners[k], q = corners[(k + 1) % 4];
    const ex = q[0] - p[0], ey = q[1] - p[1], el = Math.hypot(ex, ey) || 1;
    const n: Vec3 = [ey / el, -ex / el, 0];
    const u1 = el / FRONT_WALL_REPEAT, v1 = (z1 - z0) / 1;
    const i = mb.vertexCount;
    mb.vertex([p[0], p[1], z0], 0, v1);
    mb.vertex([q[0], q[1], z0], u1, v1);
    mb.vertex([q[0], q[1], z1], u1, 0);
    mb.vertex([p[0], p[1], z1], 0, 0);
    for (let j = 0; j < 4; j++) mb.normals!.push(...n);
    mb.quad(i, i + 1, i + 2, i + 3);
  }
  const i = mb.vertexCount;
  for (const p of corners) {
    mb.vertex([p[0], p[1], z1], 0.5, 0.02);
    mb.normals!.push(0, 0, 1);
  }
  mb.quad(i, i + 1, i + 2, i + 3);
}

/** Flat garden bed a few centimetres above the ground. */
function bed(mb: MeshBuilder, a: Vec2, b: Vec2, c: Vec2, d: Vec2, ground: HeightFn): void {
  const i = mb.vertexCount;
  for (const p of [a, b, c, d]) {
    mb.vertex([p[0], p[1], ground(p[0], p[1]) + 0.07], p[0] / 2, p[1] / 2);
    mb.normals!.push(0, 0, 1);
  }
  // a->b runs along the house, c and d are toward the street: make it face up.
  const cross = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
  if (cross > 0) mb.quad(i, i + 1, i + 2, i + 3);
  else mb.quad(i, i + 3, i + 2, i + 1);
}

/** A shrub: two crossed two-sided sprite quads. */
export function shrub(mb: MeshBuilder, c: Vec2, size: number, species: number, rot: number, ground: HeightFn): void {
  const sp = SHRUB_SPECIES[species];
  const H = size, W = size * 1.4;
  const z = ground(c[0], c[1]) - 0.05;
  for (let p = 0; p < 2; p++) {
    const a = rot + (p * Math.PI) / 2;
    const dx = Math.cos(a) * W / 2, dy = Math.sin(a) * W / 2;
    const fx = Math.sin(a), fy = -Math.cos(a);
    for (const side of [1, -1]) {
      const nx = fx * side * 0.35, ny = fy * side * 0.35, l = Math.hypot(nx, ny, 1);
      const i = mb.vertexCount;
      mb.vertex([c[0] - dx, c[1] - dy, z], sp.u0, 1);
      mb.vertex([c[0] + dx, c[1] + dy, z], sp.u1, 1);
      mb.vertex([c[0] + dx, c[1] + dy, z + H], sp.u1, 0);
      mb.vertex([c[0] - dx, c[1] - dy, z + H], sp.u0, 0);
      for (let j = 0; j < 4; j++) mb.normals!.push(nx / l, ny / l, 1 / l);
      if (side === 1) mb.quad(i, i + 1, i + 2, i + 3);
      else mb.quad(i, i + 3, i + 2, i + 1);
    }
  }
}
