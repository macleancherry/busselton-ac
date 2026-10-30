// Busselton fork: country roadsides (ROADMAP.md phase C). Farm driveways where OSM maps a
// track or driveway leaving the route: a short gravel apron out to the fence line, a gate in
// the fence (galvanised tube on timber strainers, open or shut) with a few metres of wire
// fence each side, and a rural mailbox at the mouth (a 44-gallon drum on its side on a post,
// or a box on a post). Cattle grids where OSM maps barrier=cattle_grid: a steel grid strip
// across the road with white wing rails each side, ridged physics so the car feels it. A grid
// at a driveway's gate replaces the gate.
//
// Self-contained: track.ts hands in the lines and points in local metres and gets meshes back.

import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import type { Kn5MeshNode } from "./kn5";
import { MeshBuilder, type Vec3 } from "./mesh";
import type { BuildOptions } from "./options";
import { encodePng } from "./png";
import { inRoundabout, surfaceHeight, type RoadPlan, type SegmentIndex } from "./road";
import { pad } from "./roadMesh";
import { box, rng } from "./scenery";
import { fill, vergeTexture } from "./textures";
import { resample } from "./polyline";

/** A street line near the route (local metres), as the vector tiles class it. */
export interface FarmLine {
  pts: Vec2[];
  cls: string;
  service?: string;
}

export interface Driveway {
  /** Where it meets the route's asphalt edge. */
  at: Vec2;
  /** Unit direction out from the road along the driveway. */
  dir: Vec2;
  side: 1 | -1;
  seg: number;
  /** Distance along the route, metres. */
  s: number;
  /** Centreline from the road edge to the gate (or the line's end). */
  path: Vec2[];
  /** The gate in the fence line, or null when the line ends too close to the road for one. */
  gate: Vec2 | null;
}

export interface CattleGrid {
  at: Vec2;
  /** Unit direction a car crosses it in. */
  along: Vec2;
  /** Half its width across the road or driveway. */
  half: number;
  /** On the route (else at a driveway's gate). */
  route: boolean;
  /** The driveway whose gate it's at. */
  drive?: number;
}

/** How far back from the asphalt edge the fence line (and the gate) sits, metres past the verge. */
export const FENCE_BACK = 8.5;
/** Gravel at the gate, and splayed at the road edge, metres. */
const APRON_W = 4.4, APRON_SPLAY = 9;
/** A line end this close to the asphalt counts as joining it (OSM driveways often stop short). */
const REACH = 6;
/** Cattle grid: length along the traffic, bar pitch, bar width, metres. */
const GRID_L = 2.4, GRID_P = 0.15, GRID_BAR = 0.055;
const GRID_LOW = 0.004, GRID_HIGH = 0.014;

/** Farm driveways are tracks and plain or driveway service roads (not car park aisles, alleys or drive-throughs). */
export function isFarmDrive(l: { cls: string; service?: string }): boolean {
  return l.cls === "track" || (l.cls === "service" && (!l.service || l.service === "driveway"));
}

const norm = (v: Vec2): Vec2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
const lerp2 = (a: Vec2, b: Vec2, f: number): Vec2 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
const add = (a: Vec2, b: Vec2, k = 1): Vec2 => [a[0] + b[0] * k, a[1] + b[1] * k];

/** The route at a point: sample frame interpolated along the nearest segment. */
function frameAt(plan: RoadPlan, index: SegmentIndex, x: number, y: number, reach: number) {
  const n = index.nearest(x, y, reach);
  if (!n) return null;
  const S = plan.samples, a = S[n.seg], b = S[(n.seg + 1) % S.length];
  const pos = lerp2(a.pos, b.pos, n.frac);
  const tan = norm(lerp2(a.tan, b.tan, n.frac));
  const left: Vec2 = [-tan[1], tan[0]];
  const half = index.at(n).width / 2;
  const len = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]);
  return { n, pos, tan, left, half, s: a.s + n.frac * len, edge: n.dist - half };
}

/** Road surface height at a point on (or just off) the asphalt. */
export function roadZ(plan: RoadPlan, index: SegmentIndex, opts: BuildOptions, x: number, y: number): number | null {
  const n = index.nearest(x, y, 30);
  if (!n) return null;
  const S = plan.samples, a = S[n.seg], b = S[(n.seg + 1) % S.length];
  return surfaceHeight(a, n.t, opts.crown) * (1 - n.frac) + surfaceHeight(b, n.t, opts.crown) * n.frac;
}

/**
 * Where farm driveways leave the route. Each line is walked in 1 m steps; wherever it leaves the
 * asphalt (or ends within REACH of it) and heads away at least 45 degrees off the road's line,
 * that's a mouth, and the fence line is FENCE_BACK past the verge along it.
 */
export function findDriveways(
  lines: FarmLine[],
  plan: RoadPlan,
  index: SegmentIndex,
  opts: BuildOptions,
  skip?: (seg: number, side: 1 | -1, at: Vec2) => boolean,
): Driveway[] {
  const fenceE = opts.vergeWidth + FENCE_BACK;
  const out: Driveway[] = [];
  for (const line of lines) {
    if (!isFarmDrive(line) || line.pts.length < 2) continue;
    const d = resample(line.pts, 1);
    if (d.length < 3) continue;
    const e = d.map(([x, y]) => frameAt(plan, index, x, y, 40)?.edge ?? Infinity);
    const runs: { from: number; step: 1 | -1 }[] = [];
    for (let i = 0; i + 1 < d.length; i++) {
      if (e[i] <= 0.5 && e[i + 1] > 0.5) runs.push({ from: i + 1, step: 1 });
      if (e[i] > 0.5 && e[i + 1] <= 0.5) runs.push({ from: i, step: -1 });
    }
    const last = d.length - 1;
    if (e[0] > 0.5 && e[0] <= REACH && e[1] > e[0]) runs.push({ from: 0, step: 1 });
    if (e[last] > 0.5 && e[last] <= REACH && e[last - 1] > e[last]) runs.push({ from: last, step: -1 });

    for (const run of runs) {
      const f = frameAt(plan, index, d[run.from][0], d[run.from][1], 40);
      if (!f) continue;
      const side: 1 | -1 = f.n.t >= 0 ? 1 : -1;
      const at = add(f.pos, f.left, side * f.half);
      const path: Vec2[] = [at];
      let gate: Vec2 | null = null;
      for (let j = run.from; j >= 0 && j <= last; j += run.step) {
        if (e[j] <= 0.5) break;
        const prev = path[path.length - 1];
        if (e[j] >= fenceE) {
          // The fence line falls between the previous point and this one.
          const pe = path.length > 1 ? e[j - run.step] : 0;
          gate = lerp2(prev, d[j], Math.max(0, Math.min(1, (fenceE - pe) / Math.max(1e-6, e[j] - pe))));
          path.push(gate);
          break;
        }
        if (Math.hypot(d[j][0] - prev[0], d[j][1] - prev[1]) > 0.3) path.push(d[j]);
      }
      const end = path[path.length - 1];
      const reach = Math.hypot(end[0] - at[0], end[1] - at[1]);
      if (reach < 3) continue;
      if (!gate && (frameAt(plan, index, end[0], end[1], 40)?.edge ?? 0) >= opts.vergeWidth + 4) gate = end;
      // Heading away from the road, not running along it (a frontage road or a parallel track).
      const look = path.find((p) => Math.hypot(p[0] - at[0], p[1] - at[1]) >= 6) ?? end;
      const dir = norm([look[0] - at[0], look[1] - at[1]]);
      if (Math.abs(dir[0] * f.left[0] + dir[1] * f.left[1]) < Math.SQRT1_2) continue;
      if (inRoundabout(plan, at[0], at[1], 15)) continue;
      if (skip?.(f.n.seg, side, at)) continue;
      // One driveway per mouth (a track crossing the road gives one each side).
      if (out.some((o) => o.side === side && Math.hypot(o.at[0] - at[0], o.at[1] - at[1]) < 12)) continue;
      out.push({ at, dir, side, seg: f.n.seg, s: f.s, path, gate });
    }
  }
  return out;
}

/** OSM cattle grids on the route (within its asphalt and a little) or at a driveway's gate. */
export function placeCattleGrids(points: Vec2[], plan: RoadPlan, index: SegmentIndex, drives: Driveway[]): { grids: CattleGrid[]; gated: Set<number> } {
  const grids: CattleGrid[] = [];
  const gated = new Set<number>();
  for (const p of points) {
    const f = frameAt(plan, index, p[0], p[1], 30);
    if (f && f.edge < 3) {
      if (inRoundabout(plan, f.pos[0], f.pos[1], 10)) continue;
      if (grids.some((g) => g.route && Math.hypot(g.at[0] - f.pos[0], g.at[1] - f.pos[1]) < 10)) continue;
      grids.push({ at: f.pos, along: f.tan, half: f.half, route: true });
      continue;
    }
    const k = drives.findIndex((dr) => dr.gate && Math.hypot(dr.gate[0] - p[0], dr.gate[1] - p[1]) < 8);
    if (k < 0 || gated.has(k)) continue;
    gated.add(k);
    grids.push({ at: drives[k].gate!, along: drives[k].dir, half: APRON_W / 2 - 0.1, route: false, drive: k });
  }
  return { grids, gated };
}

/** Quad whose front faces up: corners in either order round the edge. */
function upQuad(mb: MeshBuilder, a: number, b: number, c: number, d: number): void {
  const P = mb.positions;
  const area = (P[b * 3] - P[a * 3]) * (P[c * 3 + 1] - P[a * 3 + 1]) - (P[b * 3 + 1] - P[a * 3 + 1]) * (P[c * 3] - P[a * 3]);
  if (area >= 0) mb.quad(a, b, c, d);
  else mb.quad(a, d, c, b);
}

/** The bar profile along a grid: [offset along, height above the surface]. Flush at both ends. */
export function gridProfile(): [number, number][] {
  const out: [number, number][] = [[0, 0.002]];
  const bars = Math.floor((GRID_L - 0.1) / GRID_P);
  const u0 = (GRID_L - bars * GRID_P) / 2;
  for (let k = 0; k < bars; k++) {
    const a = u0 + k * GRID_P + (GRID_P - GRID_BAR) / 2;
    out.push([a - 0.004, GRID_LOW], [a, GRID_HIGH], [a + GRID_BAR, GRID_HIGH], [a + GRID_BAR + 0.004, GRID_LOW]);
  }
  out.push([GRID_L, 0.002]);
  return out;
}

/** A cattle grid's ridged surface: steel bars over a dark pit, as one textured mesh. */
function gridMesh(g: CattleGrid, base: (x: number, y: number) => number): MeshBuilder {
  const mb = new MeshBuilder();
  const left: Vec2 = [-g.along[1], g.along[0]];
  const ts: number[] = [];
  const nT = Math.max(2, Math.ceil((2 * g.half) / 0.5));
  for (let j = 0; j <= nT; j++) ts.push(-g.half + (2 * g.half * j) / nT);
  if (!ts.some((t) => Math.abs(t) < 0.05)) ts.push(0), ts.sort((a, b) => a - b);
  const prof = gridProfile();
  const bars = Math.floor((GRID_L - 0.1) / GRID_P), u0 = (GRID_L - bars * GRID_P) / 2;
  for (const [u, dz] of prof) {
    for (const t of ts) {
      const p = add(add(g.at, g.along, u - GRID_L / 2), left, t);
      // Texture: one bar pitch per repeat, the bar in the middle third.
      mb.vertex([p[0], p[1], base(p[0], p[1]) + dz], (u - u0) / GRID_P, t / 2);
    }
  }
  const W = ts.length;
  for (let i = 0; i + 1 < prof.length; i++) {
    for (let j = 0; j + 1 < W; j++) upQuad(mb, i * W + j, i * W + j + 1, (i + 1) * W + j + 1, (i + 1) * W + j);
  }
  return mb;
}

/** Collects solid pieces by material (explicit normals, for box()). */
class Kit {
  private readonly by = new Map<string, MeshBuilder[]>();
  get(mat: string, verts = 64): MeshBuilder {
    const list = this.by.get(mat) ?? [];
    if (!list.length || list[list.length - 1].vertexCount + verts > 60000) {
      const mb = new MeshBuilder();
      mb.normals = [];
      list.push(mb);
    }
    this.by.set(mat, list);
    return list[list.length - 1];
  }
  nodes(): Kn5MeshNode[] {
    const out: Kn5MeshNode[] = [];
    for (const [mat, list] of this.by) {
      list.forEach((mb, i) => {
        if (mb.indices.length) out.push(mb.toKn5(`FURNITURE_FARM_${mat.toUpperCase().replace(/^FARM_/, "")}_${pad(i)}`, mat));
      });
    }
    return out;
  }
}

/** Horizontal cylinder (a drum on its side) along `axis`, centre `c` at height `zc`. */
function drum(mb: MeshBuilder, c: Vec2, axis: Vec2, len: number, r: number, zc: number, u: number): void {
  const N = 12;
  const side: Vec2 = [-axis[1], axis[0]];
  const ring = (k: number): [Vec2, number, Vec3] => {
    const a = (k / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    return [add(c, side, ca * r), zc + sa * r, [side[0] * ca, side[1] * ca, sa]];
  };
  const base = mb.vertexCount;
  for (let k = 0; k <= N; k++) {
    const [p, z, n] = ring(k);
    for (const e of [-1, 1]) {
      mb.vertex([p[0] + axis[0] * e * len / 2, p[1] + axis[1] * e * len / 2, z], u, k / N);
      mb.normals!.push(...n);
    }
  }
  // Outward faces: walking round the ring the right way, the -axis end then the +axis end.
  for (let k = 0; k < N; k++) {
    const a = base + k * 2, b = a + 2;
    mb.quad(a, b, b + 1, a + 1);
  }
  // Fix the winding if it came out inward (depends on the handedness of axis/side/up).
  const P = mb.positions, i0 = mb.indices.length - 6;
  const [ia, ib, ic] = [mb.indices[i0], mb.indices[i0 + 1], mb.indices[i0 + 2]];
  const v = (i: number): Vec3 => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const A = v(ia), B = v(ib), C = v(ic);
  const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
  const nrm = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const out = [A[0] - c[0], A[1] - c[1], A[2] - zc];
  if (nrm[0] * out[0] + nrm[1] * out[1] + nrm[2] * out[2] < 0) {
    for (let k = mb.indices.length - N * 6; k < mb.indices.length; k += 3) {
      const t = mb.indices[k + 1];
      mb.indices[k + 1] = mb.indices[k + 2];
      mb.indices[k + 2] = t;
    }
  }
  // End caps: a fan each end, facing out along the axis.
  for (const e of [-1, 1]) {
    const cc = add(c, axis, e * len / 2);
    const ci = mb.vertex([cc[0], cc[1], zc], u, 0.5);
    mb.normals!.push(axis[0] * e, axis[1] * e, 0);
    const first = mb.vertexCount;
    for (let k = 0; k < N; k++) {
      const [p, z] = ring(k);
      mb.vertex([p[0] + axis[0] * e * len / 2, p[1] + axis[1] * e * len / 2, z], u, 0.5);
      mb.normals!.push(axis[0] * e, axis[1] * e, 0);
    }
    for (let k = 0; k < N; k++) {
      const a = first + k, b = first + ((k + 1) % N);
      // Counter-clockwise seen from outside this end.
      const P2 = mb.positions;
      const cr = (P2[a * 3] - cc[0]) * (P2[b * 3 + 1] - cc[1]) - (P2[a * 3 + 1] - cc[1]) * (P2[b * 3] - cc[0]);
      const za = P2[a * 3 + 2] - zc, zb = P2[b * 3 + 2] - zc;
      // Outward normal along e*axis: (a-c) x (b-c) . e*axis > 0 means counter-clockwise from outside.
      const ax = [(P2[a * 3] - cc[0]), (P2[a * 3 + 1] - cc[1]), za], bx = [(P2[b * 3] - cc[0]), (P2[b * 3 + 1] - cc[1]), zb];
      const n = [ax[1] * bx[2] - ax[2] * bx[1], ax[2] * bx[0] - ax[0] * bx[2], cr];
      if ((n[0] * axis[0] + n[1] * axis[1]) * e >= 0) mb.tri(ci, a, b);
      else mb.tri(ci, b, a);
    }
  }
}

/** Drum colours on the farm_drum texture: weathered white, green, rust, blue, galvanised. */
const DRUMS: [number, number, number][] = [[222, 220, 208], [64, 100, 60], [132, 66, 36], [46, 74, 124], [150, 154, 156]];

export function farmTextures(): { name: string; png: Uint8Array }[] {
  const drumPng = encodePng(fill(DRUMS.length * 8, 16, (x, y) => {
    const c = DRUMS[Math.floor(x / 8)];
    // Two rolling hoops round the drum.
    const hoop = y === 5 || y === 10 ? 0.82 : 1;
    return [c[0] * hoop, c[1] * hoop, c[2] * hoop];
  }), DRUMS.length * 8, 16, { alpha: false });
  // One bar pitch: dark pit, steel bar in the middle third (a lighter worn top along its centre).
  const gridPng = encodePng(fill(30, 8, (x) => {
    const f = (x + 0.5) / 30;
    if (f < 0.32 || f > 0.68) return [22, 22, 20];
    return Math.abs(f - 0.5) < 0.08 ? [170, 170, 166] : [126, 126, 122];
  }), 30, 8, { alpha: false });
  return [
    { name: "farm_gravel", png: vergeTexture() },
    { name: "farm_drum", png: drumPng },
    { name: "cattle_grid", png: gridPng },
  ];
}

export interface FarmInput {
  lines: FarmLine[];
  cattleGrids: Vec2[];
  plan: RoadPlan;
  index: SegmentIndex;
  opts: BuildOptions;
  ground: HeightFn;
  /** A street is already drawn here (side streets): no gravel apron over it. */
  drawn?: (x: number, y: number) => boolean;
  /** Something stands here (a building, another street): no post, gate or fence. */
  blocked?: (x: number, y: number) => boolean;
  /** No driveway here (a kerbed town street, say). */
  skip?: (seg: number, side: 1 | -1, at: Vec2) => boolean;
}

export interface FarmResult {
  nodes: Kn5MeshNode[];
  drives: Driveway[];
  grids: CattleGrid[];
  mailboxes: number;
}

/** Driveways, gates, mailboxes and cattle grids along a country road. */
export function buildFarmRoadsides(input: FarmInput): FarmResult {
  const { plan, index, opts, ground } = input;
  const blocked = input.blocked ?? (() => false);
  const drives = findDriveways(input.lines, plan, index, opts, input.skip);
  const { grids, gated } = placeCattleGrids(input.cattleGrids, plan, index, drives);
  const kit = new Kit();
  const nodes: Kn5MeshNode[] = [];

  /** Height of the ground beside the road: the verge's slope near the asphalt, then the terrain. */
  const groundAt = (x: number, y: number): number => {
    const f = frameAt(plan, index, x, y, 40);
    if (!f || f.edge > opts.vergeWidth + 2) return ground(x, y);
    const S = plan.samples, smp = S[f.n.seg];
    const side = f.n.t >= 0 ? 1 : -1;
    const edgeZ = surfaceHeight(smp, side * f.half, opts.crown);
    const verge = edgeZ - 0.2 * Math.min(1, Math.max(0, f.edge) / Math.max(0.1, opts.vergeWidth));
    if (f.edge <= opts.vergeWidth) return verge;
    const k = (f.edge - opts.vergeWidth) / 2;
    return verge * (1 - k) + ground(x, y) * k;
  };
  /** The apron's top: just over the road at the edge, a few centimetres over the ground beyond. */
  const apronZ = (x: number, y: number): number => {
    const f = frameAt(plan, index, x, y, 40);
    const e = f ? Math.max(0, f.edge) : 99;
    return groundAt(x, y) + 0.005 + 0.035 * Math.min(1, e / 1.5);
  };

  // Gravel aprons (physics: gravel-grass, a little bumpy), where no side street is drawn already.
  const apron = new MeshBuilder();
  const aproned = new Set<number>();
  drives.forEach((dr, k) => {
    const probe = add(dr.at, dr.dir, 3);
    if (input.drawn?.(probe[0], probe[1])) return;
    // The gravel runs on a couple of metres through the gate (and under a cattle grid there).
    const n = dr.path.length;
    const tail = n > 1 ? norm([dr.path[n - 1][0] - dr.path[n - 2][0], dr.path[n - 1][1] - dr.path[n - 2][1]]) : dr.dir;
    const path = resample(dr.gate ? [...dr.path, add(dr.gate, tail, 2.5)] : dr.path, 1);
    if (path.length < 2) return;
    aproned.add(k);
    const f0 = frameAt(plan, index, dr.at[0], dr.at[1], 20)!;
    let dist = 0;
    const base = apron.vertexCount;
    path.forEach((p, i) => {
      if (i) dist += Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]);
      const w = APRON_W + (APRON_SPLAY - APRON_W) * Math.max(0, 1 - dist / 4);
      let a: Vec2, b: Vec2;
      if (i === 0) {
        // Along the road edge, so the splay meets the asphalt cleanly.
        const s = Math.min(w / 2 / Math.max(0.7, Math.abs(dr.dir[0] * f0.left[0] + dr.dir[1] * f0.left[1])), w);
        const edgeAt = (q: Vec2): Vec2 => {
          const f = frameAt(plan, index, q[0], q[1], 20) ?? f0;
          return add(f.pos, f.left, dr.side * f.half);
        };
        a = edgeAt(add(p, f0.tan, -s));
        b = edgeAt(add(p, f0.tan, s));
      } else {
        const dir = norm([p[0] - path[i - 1][0], p[1] - path[i - 1][1]]);
        const left: Vec2 = [-dir[1], dir[0]];
        // Keep the side the road's tangent points to on the same edge as row 0.
        const sgn = left[0] * f0.tan[0] + left[1] * f0.tan[1] >= 0 ? 1 : -1;
        a = add(p, left, -sgn * w / 2);
        b = add(p, left, sgn * w / 2);
      }
      for (const q of [a, b]) {
        const z = i === 0 ? (roadZ(plan, index, opts, q[0], q[1]) ?? groundAt(q[0], q[1])) + 0.005 : apronZ(q[0], q[1]);
        apron.vertex([q[0], q[1], z], q[0] / 3, q[1] / 3);
      }
    });
    for (let i = 0; i + 1 < path.length; i++) {
      const r = base + i * 2;
      upQuad(apron, r, r + 1, r + 3, r + 2);
    }
  });
  if (apron.indices.length) nodes.push(apron.toKn5("1GRASS_FARMDRIVE_000", "farm_gravel"));

  // Gates, fence wings and mailboxes.
  let mailboxes = 0;
  drives.forEach((dr, k) => {
    const r = rng(Math.round(dr.at[0] * 31.7) ^ Math.round(dr.at[1] * 17.3));
    const f0 = frameAt(plan, index, dr.at[0], dr.at[1], 20)!;
    if (dr.gate) {
      const g = dr.gate;
      const across = Math.max(0.7, Math.abs(dr.dir[0] * f0.left[0] + dr.dir[1] * f0.left[1]));
      const hw = (APRON_W / 2 + 0.2) / across;
      const fdir = f0.tan;
      const zg = groundAt(g[0], g[1]);
      const postA = add(g, fdir, -hw), postB = add(g, fdir, hw);
      for (const p of [postA, postB]) {
        if (!blocked(p[0], p[1])) box(kit.get("timber"), p, fdir, 0.2, 0.2, groundAt(p[0], p[1]) - 0.3, groundAt(p[0], p[1]) + 1.45);
      }
      // The gate leaf, unless a cattle grid takes its place: galvanised tube, 5 rails and two stiles,
      // hinged on post A, shut (across the drive) or swung open into the paddock.
      if (!(gated.has(k) && aproned.has(k)) && !blocked(postA[0], postA[1])) {
        const open = r() < 0.65;
        const th = open ? (1.35 + r() * 0.4) : 0;
        const leaf = norm(add(add([0, 0], fdir, Math.cos(th)), dr.dir, Math.sin(th)));
        const len = Math.min(2 * hw - 0.3, 4.2);
        const mid = add(postA, leaf, 0.15 + len / 2);
        const steel = kit.get("steel", 200);
        for (let rail = 0; rail < 5; rail++) {
          const z = zg + 0.18 + rail * 0.24;
          box(steel, mid, leaf, len, 0.04, z, z + 0.04);
        }
        for (const e of [-1, 1]) box(steel, add(mid, leaf, (e * len) / 2), leaf, 0.05, 0.05, zg + 0.12, zg + 1.2);
      }
      // A few metres of ringlock-style wire fence each side: star pickets and four strands.
      for (const e of [-1, 1] as const) {
        const start = e < 0 ? postA : postB;
        let prev = start;
        for (let j = 1; j <= 3; j++) {
          const p = add(start, fdir, e * j * 3.3);
          if (blocked(p[0], p[1]) || (frameAt(plan, index, p[0], p[1], 40)?.edge ?? 99) < opts.vergeWidth + 2) break;
          const zp = groundAt(p[0], p[1]), zq = groundAt(prev[0], prev[1]);
          box(kit.get("steel"), p, fdir, j === 3 ? 0.12 : 0.03, j === 3 ? 0.12 : 0.03, zp - 0.3, zp + 1.1);
          const midW = lerp2(prev, p, 0.5), zm = (zp + zq) / 2;
          for (const h of [0.3, 0.55, 0.8, 1.05]) box(kit.get("wire"), midW, fdir, 3.3, 0.008, zm + h, zm + h + 0.008);
          prev = p;
        }
      }
    }
    // The mailbox: beside the driveway on the side traffic reaches first, past the verge.
    const back = opts.vergeWidth + 1.1;
    const along: Vec2 = [-f0.tan[0] * dr.side, -f0.tan[1] * dr.side];
    const mb0 = add(add(dr.at, along, APRON_SPLAY / 2 + 1.2), f0.left, dr.side * back);
    if (blocked(mb0[0], mb0[1])) return;
    const z = groundAt(mb0[0], mb0[1]);
    const toRoad: Vec2 = [-f0.left[0] * dr.side, -f0.left[1] * dr.side];
    mailboxes++;
    if (r() < 0.55) {
      // A 44-gallon drum on its side, open end to the road, on a timber post and cradle.
      const u = (Math.floor(r() * DRUMS.length) + 0.5) / DRUMS.length;
      box(kit.get("timber"), mb0, toRoad, 0.1, 0.1, z - 0.4, z + 0.78);
      box(kit.get("timber"), mb0, toRoad, 0.75, 0.42, z + 0.72, z + 0.78);
      drum(kit.get("farm_drum", 80), mb0, toRoad, 0.88, 0.29, z + 0.78 + 0.29, u);
    } else {
      // A box on a post, the door to the road.
      const mat = ["letterbox", "steel", "canopy"][Math.floor(r() * 3)];
      box(kit.get("timber"), mb0, toRoad, 0.09, 0.09, z - 0.4, z + 1.0);
      box(kit.get(mat), mb0, toRoad, 0.45, 0.3, z + 1.0, z + 1.3);
    }
  });

  // Cattle grids: the ridged steel strip (physics, so the car rumbles over it) and white wing rails.
  grids.forEach((g, k) => {
    // A grid at a gate sits on the gravel apron; without one (a side street drawn there) it's left out.
    if (!g.route && !aproned.has(g.drive!)) return;
    const base = g.route
      ? (x: number, y: number) => roadZ(plan, index, opts, x, y) ?? ground(x, y)
      : (x: number, y: number) => apronZ(x, y) + 0.002;
    nodes.push(gridMesh(g, base).toKn5(`1KERB_CATTLEGRID_${pad(k)}`, "cattle_grid"));
    const left: Vec2 = [-g.along[1], g.along[0]];
    for (const e of [-1, 1]) {
      const c = add(g.at, left, e * (g.half + 0.45));
      if (blocked(c[0], c[1])) continue;
      const zc = groundAt(c[0], c[1]);
      for (const u of [-GRID_L / 2, GRID_L / 2]) {
        box(kit.get("canopy"), add(c, g.along, u), g.along, 0.15, 0.15, zc - 0.3, zc + 1.0);
      }
      box(kit.get("canopy"), c, g.along, GRID_L + 0.15, 0.08, zc + 0.82, zc + 0.95);
    }
  });

  nodes.push(...kit.nodes());
  return { nodes, drives, grids, mailboxes };
}
