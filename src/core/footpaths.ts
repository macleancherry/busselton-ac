// Busselton fork: concrete in the nature strip, read off the aerial photo (spec: docs/specs/footpaths.md).
//
// Behind a kerb the photo shows two kinds of concrete worth building: a footpath (a steady pale band
// running with the street, 0.9 to 2.4 m wide) and a driveway crossover (pale right across the strip,
// for a driveway's width). Both become thin raised slabs that the car can drive on as street. Each
// crossover also lays the kerb back (the kerb builder takes `laybacks`) and gets a letterbox.
//
// Heights: the slabs are part of the ground, so they stand on `under`, the ground as it was before
// they were added. Letterboxes stand on the full ground. Neither is worked out here.

import type { Vec2 } from "./geo";
import { MAX_MESH_VERTICES, type Kn5MeshNode } from "./kn5";
import { KERB_H, KERB_BACK, LAYBACK } from "./kerbs";
import { type Vec3, MeshBuilder } from "./mesh";
import type { RoadSample, RoadPlan } from "./road";
import { pad, chunkRanges } from "./roadMesh";
import type { Piece } from "./furniture";
import { SINK } from "./sceneGround";
import type { RasterSampler } from "./trace";

/** A height at a local point, metres. */
type Ground = (x: number, y: number) => number;
const SIDES = [0, 1] as const;

/** A footpath across the strip: offsets from the road edge, metres. */
export interface PathBand {
  d0: number;
  d1: number;
}

/** A driveway crossover: its first and last sample, side (0 left, 1 right) and reach from the road edge. */
export interface Crossover {
  i0: number;
  i1: number;
  side: 0 | 1;
  reach: number;
}

export interface VergeConcrete {
  /** Per side ([left, right]), per sample: the footpath band there, or null. */
  paths: [(PathBand | null)[], (PathBand | null)[]];
  /** Driveway crossovers. */
  drives: Crossover[];
}

/* ---------------- reading the photo ---------------- */

const STEP = 0.1;
const PROFILE_OUT = 7;
const ALONG = 0.5;
const CROSS_SHARE = 0.75;
const DRIVE_SHORTEST = 2.5, DRIVE_LONGEST = 9;
const PATH_MIN_W = 0.9, PATH_MAX_W = 2.4;
const STEADY_WINDOW = 10, STEADY_DRIFT = 0.5;
const PATH_GAP = 8, PATH_MIN_RUN = 20;

/** Pale, unsaturated and not green: how concrete looks from above. */
export function isConcrete(px: [number, number, number] | null): boolean {
  if (!px) return false;
  const r = px[0], g = px[1], b = px[2];
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
  const light = (hi + lo) / 2;
  const sat = hi > 0 ? (hi - lo) / hi : 0;
  const sum = r + g + b;
  const exg = sum > 0 ? (2 * g - r - b) / sum : 0;
  return light > 0.5 && sat < 0.16 && exg < 0.02;
}

const sign = (side: 0 | 1) => (side === 0 ? 1 : -1);

/** The point `d` metres out from the road edge on `side`, shifted `a` metres along the road. */
function edgePoint(s: RoadSample, side: 0 | 1, d: number, a = 0): Vec2 {
  const t = sign(side) * (s.width / 2 + d);
  return [s.pos[0] + s.left[0] * t + s.tan[0] * a, s.pos[1] + s.left[1] * t + s.tan[1] * a];
}

/** Concrete or not at each 10 cm step out from the road edge (two of three points along the road). */
function profile(s: RoadSample, side: 0 | 1, photo: RasterSampler): boolean[] {
  const count = Math.round(PROFILE_OUT / STEP) + 1;
  const out: boolean[] = new Array(count);
  for (let k = 0; k < count; k++) {
    let seen = 0;
    for (const a of [-ALONG, 0, ALONG]) {
      const [x, y] = edgePoint(s, side, k * STEP, a);
      if (isConcrete(photo(x, y))) seen++;
    }
    out[k] = seen >= 2;
  }
  return out;
}

/** First step at or beyond an offset. */
const stepAt = (d: number) => Math.ceil(d / STEP - 1e-9);

function crossoverCandidate(p: boolean[], stripOuter: number): boolean {
  const k0 = stepAt(KERB_BACK + 0.2), k1 = Math.min(p.length - 1, Math.floor(stripOuter / STEP + 1e-9));
  const n = k1 - k0 + 1;
  if (n <= 4) return false;
  let pale = 0;
  for (let k = k0; k <= k1; k++) if (p[k]) pale++;
  return pale / n >= CROSS_SHARE;
}

/** The first run of concrete behind the kerb (single-step gaps bridged) that is a footpath's width and ends inside the profile. */
function footpathCandidate(p: boolean[]): PathBand | null {
  let k = stepAt(KERB_BACK + 0.2);
  while (k < p.length) {
    while (k < p.length && !p[k]) k++;
    if (k >= p.length) return null;
    const start = k;
    let last = k;
    let j = k + 1;
    while (j < p.length) {
      if (p[j]) last = j;
      else if (!(j + 1 < p.length && p[j + 1])) break;
      j++;
    }
    const d0 = start * STEP, d1 = (last + 1) * STEP;
    const w = d1 - d0;
    if (last < p.length - 1 && w >= PATH_MIN_W - 1e-9 && w <= PATH_MAX_W + 1e-9) return { d0, d1 };
    k = last + 1;
  }
  return null;
}

const median = (v: number[]) => {
  const sorted = v.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length & 1 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
};

/**
 * Footpaths and crossovers along the kerbed edges of the route, from the photo. `kerbs` flags each
 * sample's kerb ([left, right]); `stripOuter` is the nature strip's outer edge from the road edge;
 * `blocked` is true on another street.
 */
export function readVerge(plan: RoadPlan, photo: RasterSampler, kerbs: [number[], number[]], stripOuter: number, blocked: (x: number, y: number) => boolean): VergeConcrete {
  const { samples } = plan, n = samples.length;
  const spacing = n > 1 ? Math.hypot(samples[1].pos[0] - samples[0].pos[0], samples[1].pos[1] - samples[0].pos[1]) || 2 : 2;
  const out: VergeConcrete = { paths: [new Array(n).fill(null), new Array(n).fill(null)], drives: [] };

  for (const side of SIDES) {
    const kerbed = (i: number) => (kerbs[side][i] ?? 0) > 0;
    const cross: boolean[] = new Array(n).fill(false);
    const cand: (PathBand | null)[] = new Array(n).fill(null);
    for (let i = 0; i < n; i += 1) {
      if (!kerbed(i)) continue;
      const s: RoadSample = samples[i];
      const [fx, fy] = edgePoint(s, side, PROFILE_OUT);
      if (blocked(fx, fy)) continue;
      const p = profile(s, side, photo);
      cross[i] = crossoverCandidate(p, stripOuter);
      cand[i] = footpathCandidate(p);
    }

    // Crossovers: runs of a driveway's length.
    for (let i = 0; i < n; ) {
      if (!cross[i]) { i++; continue; }
      let j = i;
      while (j + 1 < n && cross[j + 1]) j++;
      const len = (j - i + 1) * spacing;
      if (len >= DRIVE_SHORTEST - 1e-9 && len <= DRIVE_LONGEST + 1e-9) out.drives.push({ i0: i, i1: j, side, reach: stripOuter });
      i = j + 1;
    }

    // Footpaths: steady candidates, joined over short gaps where the kerb carries on.
    const w = Math.max(1, Math.round(STEADY_WINDOW / spacing));
    const centre = (b: PathBand) => (b.d0 + b.d1) / 2;
    const steady: boolean[] = new Array(n).fill(false);
    for (let i = 0; i < n; i += 1) {
      const b = cand[i];
      if (!b) continue;
      const near: number[] = [];
      for (let k = Math.max(0, i - w); k <= Math.min(n - 1, i + w); k++) if (cand[k]) near.push(centre(cand[k]!));
      steady[i] = near.length >= w && Math.abs(centre(b) - median(near)) <= STEADY_DRIFT;
    }
    const gapMax = Math.floor(PATH_GAP / spacing + 1e-9);
    for (let i = 0; i < n; ) {
      if (!steady[i]) {
        i++;
        continue;
      }
      let last = i;
      let j = i + 1;
      while (j < n) {
        if (steady[j]) { last = j; j++; continue; }
        // A gap: bridge it if it's short and the kerb runs right through it.
        let g = j;
        while (g < n && !steady[g] && kerbed(g)) g++;
        if (g < n && steady[g] && g - j <= gapMax) { j = g; continue; }
        break;
      }
      if ((last - i + 1) * spacing >= PATH_MIN_RUN - 1e-9) {
        const starts: number[] = [], ends: number[] = [];
        for (let k = i; k <= last; k++) if (steady[k]) { starts.push(cand[k]!.d0); ends.push(cand[k]!.d1); }
        const band = { d0: median(starts), d1: median(ends) };
        for (let k = i; k <= last; k++) out.paths[side][k] = band;
      }
      i = 1 + last;
    }
  }
  return out;
}

/* ---------------- kerb laybacks ---------------- */

/** 1 across each crossover's samples, per side ([left, right]), for the kerb builder. */
export function laybacks(n: number, verge: VergeConcrete): [number[], number[]] {
  const zeros = () => new Array<number>(n).fill(0);
  const marks: [number[], number[]] = [zeros(), zeros()];
  for (const d of verge.drives) for (let i = d.i0; i <= d.i1 && i < n; i++) marks[d.side][i] = 1;
  return marks;
}

/* ---------------- slabs ---------------- */

const SLAB_RISE = 0.04;
const EDGE_BELOW = 0.03;
const LAY_LIFT = 0.005;
const JOINT = 3;

/** One end of a slab: inner and outer points with the top height at each. */
interface Section {
  inner: Vec2;
  outer: Vec2;
  zIn: number;
  zOut: number;
  s: number;
}

/** Quad in the order that faces `want` (computed from the corners). */
function quadFacing(mb: MeshBuilder, a: number, b: number, c: number, d: number, want: Vec3): void {
  const P = mb.positions;
  const A = a * 3, B = b * 3, C = c * 3;
  const ux = P[B] - P[A], uy = P[B + 1] - P[A + 1], uz = P[B + 2] - P[A + 2];
  const vx = P[C] - P[A], vy = P[C + 1] - P[A + 1], vz = P[C + 2] - P[A + 2];
  const facing = (uy * vz - uz * vy) * want[0] + (uz * vx - ux * vz) * want[1] + (ux * vy - uy * vx) * want[2];
  if (facing >= 0) mb.quad(a, b, c, d);
  else mb.quad(a, d, c, b);
}

/** A slab between two sections: the top, and an edge face down each long side. */
function slab(mb: MeshBuilder, A: Section, B: Section, under: Ground): void {
  const va = A.s / JOINT, vb = B.s / JOINT;
  const t0 = mb.vertex([A.inner[0], A.inner[1], A.zIn], 0, va);
  const t1 = mb.vertex([B.inner[0], B.inner[1], B.zIn], 0, vb);
  const t2 = mb.vertex([B.outer[0], B.outer[1], B.zOut], 1, vb);
  const t3 = mb.vertex([A.outer[0], A.outer[1], A.zOut], 1, va);
  quadFacing(mb, t0, t1, t2, t3, [0, 0, 1]);
  // Outward across the slab (inner to outer), horizontal.
  const ox = (A.outer[0] + B.outer[0] - A.inner[0] - B.inner[0]) / 2, oy = (A.outer[1] + B.outer[1] - A.inner[1] - B.inner[1]) / 2;
  const ol = Math.hypot(ox, oy) || 1;
  const out: Vec3 = [ox / ol, oy / ol, 0];
  const edge = (pa: Vec2, za: number, pb: Vec2, zb: number, u: number, want: Vec3) => {
    const a0 = mb.vertex([pa[0], pa[1], under(pa[0], pa[1]) - EDGE_BELOW], u, va);
    const b0 = mb.vertex([pb[0], pb[1], under(pb[0], pb[1]) - EDGE_BELOW], u, vb);
    const b1 = mb.vertex([pb[0], pb[1], zb], u, vb);
    const a1 = mb.vertex([pa[0], pa[1], za], u, va);
    quadFacing(mb, a0, b0, b1, a1, want);
  };
  edge(A.inner, A.zIn, B.inner, B.zIn, 0, [-out[0], -out[1], 0]);
  edge(A.outer, A.zOut, B.outer, B.zOut, 1, out);
}

const VERTS_PER_SLAB = 12;

/** Builders that move on before the kn5 vertex limit, named `<base>_NNN`. */
class Slabs {
  private list: MeshBuilder[] = [new MeshBuilder()];
  get current(): MeshBuilder {
    let mb = this.list[this.list.length - 1];
    if (mb.vertexCount + VERTS_PER_SLAB > MAX_MESH_VERTICES) this.list.push((mb = new MeshBuilder()));
    return mb;
  }
  nodes(name: (k: number) => string): Kn5MeshNode[] {
    return this.list.filter((mb) => mb.indices.length).map((mb, k) => mb.toKn5(name(k), "concrete"));
  }
}

/**
 * Footpath and crossover slabs. `under(x, y)` is the ground before this concrete is added (nature
 * strip, kerb, terrain); slab tops stand 4 cm above it.
 */
export function buildVergeConcrete(plan: RoadPlan, verge: VergeConcrete, under: Ground): Kn5MeshNode[] {
  const { samples } = plan, n = samples.length;
  if (n < 2) return [];
  const sAt = (i: number) => (i < n ? samples[i].s : plan.length);
  const meshes: Kn5MeshNode[] = [];

  // Footpaths, one mesh per road chunk.
  const section = (i: number, side: 0 | 1, d0: number, d1: number): Section => {
    const s: RoadSample = samples[i % n];
    const inner = edgePoint(s, side, d0), outer = edgePoint(s, side, d1);
    return { inner, outer, zIn: under(inner[0], inner[1]) + SLAB_RISE, zOut: under(outer[0], outer[1]) + SLAB_RISE, s: sAt(i) };
  };
  chunkRanges(plan).forEach((range, ci) => {
    const [a, b] = range;
    const mb: MeshBuilder = new MeshBuilder();
    for (const side of SIDES) {
      const bands = verge.paths[side];
      for (let i = a; i < b; i++) {
        const p = bands[i % n], q = bands[(i + 1) % n];
        if (!p || !q) continue;
        slab(mb, section(i, side, p.d0, p.d1), section(i + 1, side, q.d0, q.d1), under);
      }
    }
    if (mb.indices.length) meshes.push(mb.toKn5(`1STREET_PATH_${pad(ci)}`, "concrete"));
  });

  // Crossovers: from the laid-back kerb top out to the reach (or on to a footpath beyond it).
  const drives = new Slabs();
  const driveSection = (i: number, d: Crossover): Section => {
    const s: RoadSample = samples[i];
    const band = verge.paths[d.side][i];
    const far = band && band.d0 > d.reach ? band.d0 : d.reach;
    const inner = edgePoint(s, d.side, KERB_BACK), outer = edgePoint(s, d.side, far);
    return {
      inner,
      outer,
      zIn: under(inner[0], inner[1]) - KERB_H * LAYBACK + LAY_LIFT,
      zOut: under(outer[0], outer[1]) + SLAB_RISE,
      s: s.s,
    };
  };
  for (const d of verge.drives) {
    for (let i = d.i0; i < d.i1 && i + 1 < n; i++) slab(drives.current, driveSection(i, d), driveSection(i + 1, d), under);
  }
  meshes.push(...drives.nodes((k) => `1STREET_DRIVE_${pad(k)}`));
  return meshes;
}

/* ---------------- letterboxes ---------------- */

const LB_OUT = 0.4;
const POST_W = 0.09, POST_TOP = 0.95;
const BOX_ALONG = 0.3, BOX_ACROSS = 0.42, BOX_TOP = 1.22;

/**
 * A letterbox beside each driveway, on the side you reach first driving along that side of the road:
 * a timber post and a box. `ground` is the full ground (strip or footpath).
 */
export function letterboxes(plan: RoadPlan, verge: VergeConcrete, ground: Ground): Piece[] {
  const { samples } = plan, n = samples.length;
  const pieces: Piece[] = [];
  if (!n) return pieces;
  for (const d of verge.drives) {
    const i = Math.max(0, Math.min(n - 1, d.side === 0 ? d.i0 - 1 : d.i1 + 1));
    const s: RoadSample = samples[i];
    const band = verge.paths[d.side][i];
    const at = edgePoint(s, d.side, Math.max(d.reach, band ? band.d1 : 0) + LB_OUT);
    const z = ground(at[0], at[1]);
    pieces.push({ kind: "box", at, along: s.tan, length: POST_W, depth: POST_W, z0: z - SINK, z1: z + POST_TOP, material: "timber" });
    pieces.push({ kind: "box", at, along: s.tan, length: BOX_ALONG, depth: BOX_ACROSS, z0: z + POST_TOP, z1: z + BOX_TOP, material: "letterbox" });
  }
  return pieces;
}
