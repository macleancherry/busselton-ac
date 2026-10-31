// Busselton fork: kerb and gutter, nature strips and kerb returns (docs/specs/kerbs.md).
//
// The edge of nearly every Australian town street: a concrete gutter beside the asphalt, a 150 mm
// kerb, then the nature strip. Evidence comes from the aerial photo, the plan from how built-up the
// road is, and the meshes replace the gravel verge on a kerbed side. Where a kerbed road meets a side
// street square on, the kerb curves round each corner and carries on along the street's edge.
//
// Frame: local ENU (x east, y north, z up). t is + left of the route; side 1 = left, -1 = right;
// per-side arrays are [left, right].

import type { Vec2 } from "./geo";
import type { Kn5MeshNode } from "./kn5";
import { MeshBuilder, type Vec3 } from "./mesh";
import type { BuildOptions } from "./options";
import { inRoundabout, surfaceHeight, type RoadPlan, type RoadSample } from "./road";
import { chunkRanges, pad } from "./roadMesh";
import { closeGaps, dropStubs } from "./runs";
import type { RasterSampler } from "./trace";

/** Gutter (channel) width, metres. */
export const GUTTER = 0.3;
/** Kerb height above the gutter lip, metres. */
export const KERB_H = 0.15;
/** How much wider than the gravel verge the nature strip runs, metres. */
export const STRIP_EXTRA = 1.5;
/** Share of the kerb height a driveway layback takes away. */
export const LAYBACK = 0.65;
/** The kerb's back edge from the road edge: gutter + face run + kerb top, metres. */
export const KERB_BACK = 0.5;
/** Nominal kerb return radius, metres (also the search limit, 3 x RETURN_R). */
export const RETURN_R = 4;

const FACE_RUN = 0.05;
const KERB_TOP = 0.15;
const GUTTER_DIP = 0.03;
const STRIP_RISE = 0.02;
const SKIRT = 0.8;
const VERGE_DROP = 0.2;
const POUR = 3;
const DU = 0.05;
const SIDE_STRIP = 2;
const FALLBACK: [number, number, number] = [0.33, 0.4, 0.24];

/** The kerb's cross-section, shared with the network's junction kerbs (network/dress.ts). */
export const KERB_PROFILE = {
  gutter: GUTTER,
  faceRun: FACE_RUN,
  top: KERB_TOP,
  height: KERB_H,
  dip: GUTTER_DIP,
  stripRise: STRIP_RISE,
  skirt: SKIRT,
  vergeDrop: VERGE_DROP,
};

export type StripMaterialFn = (ci: number, a: number, b: number) => { material: string; photo: boolean };

export interface KerbMeshes {
  gutter: Kn5MeshNode[];
  kerb: Kn5MeshNode[];
  strip: Kn5MeshNode[];
}

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

/** Sample spacing of a plan (2 m with one sample). */
const spacingOf = (plan: RoadPlan) => (plan.samples.length > 1 ? plan.samples[1].s - plan.samples[0].s : 2);

// --- Evidence -------------------------------------------------------------------------------

/** 1 = a pale kerb band at the asphalt edge on that side, 0 = none, NaN = couldn't read (a pixel missing). */
function seeBand(smp: RoadSample, side: 1 | -1, raster: RasterSampler): number {
  const half = smp.width / 2;
  const count = 61;
  const u: number[] = [], L: number[] = [], S: number[] = [], G: number[] = [];
  for (let j = 0; j < count; j++) {
    const uj = half - 1.6 + j * DU;
    const t = uj * side;
    const c = raster(smp.pos[0] + smp.left[0] * t, smp.pos[1] + smp.left[1] * t);
    if (!c) return NaN;
    const [r, g, b] = c;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    u.push(uj);
    L.push((r + g + b) / 3);
    S.push(mx > 0 ? (mx - mn) / mx : 0);
    G.push((2 * g - r - b) / (r + g + b + 1e-4));
  }
  const lane = L.filter((_, j) => u[j] < half - 0.7 - 1e-9).sort((a, b) => a - b);
  if (!lane.length) return 0;
  const ref = lane[Math.floor(lane.length / 2)];
  if (!(ref > 0.02)) return 0;
  const bright = (j: number) => j >= 0 && j < count && L[j] > 1.25 * ref + 0.03 && S[j] < 0.2 && G[j] < 0.03;
  const asphalt = (j: number) => Math.abs(L[j] / ref - 1) < 0.3 && S[j] < 0.22 && G[j] < 0.04;
  for (let j = 1; j < count; ) {
    if (!bright(j)) { j++; continue; }
    let e = j + 1;
    // One dull pixel inside the band (the gutter's dirty invert) doesn't end it.
    while (e < count && (bright(e) || bright(e + 1))) e++;
    const start = u[j], w = (e - j) * DU;
    if (start > half + 0.6) return 0;
    if (start >= half - 0.8 - 1e-9 && w >= 0.1 - 1e-9 && w <= 1.2 + 1e-9) {
      let inN = 0, inA = 0, outN = 0, outA = 0;
      for (let k = j - 6; k <= j - 2; k++) if (k >= 0 && k < count) { inN++; if (asphalt(k)) inA++; }
      for (let k = e + 3; k <= e + 12; k++) if (k >= 0 && k < count) { outN++; if (asphalt(k)) outA++; }
      if (inN >= 1 && inA / inN >= 0.6 && outN >= 4 && outA / outN < 0.5) return 1;
    }
    j = e;
  }
  return 0;
}

export function kerbEvidence(plan: RoadPlan, raster: RasterSampler, trusted: (i: number) => boolean): [number[], number[]] {
  const out: [number[], number[]] = [[], []];
  ([1, -1] as const).forEach((side, k) => {
    plan.samples.forEach((smp, i) => out[k].push(trusted(i) ? seeBand(smp, side, raster) : NaN));
  });
  return out;
}

// --- Plan -----------------------------------------------------------------------------------

export function planKerbs(
  plan: RoadPlan,
  evidence: [number[], number[]] | null,
  town: (i: number) => number,
  blocked: (i: number, side: 1 | -1) => boolean,
): [number[], number[]] {
  const n = plan.samples.length;
  const sp = spacingOf(plan);
  const reach = Math.round(20 / sp), minRun = Math.round(16 / sp);
  const closed = plan.closed && n > 1;
  const nearRb = plan.samples.map((s) => !!inRoundabout(plan, s.pos[0], s.pos[1], 3));
  const out: [number[], number[]] = [[], []];
  ([1, -1] as const).forEach((side, k) => {
    const ev = evidence?.[k];
    const on: boolean[] = [];
    for (let i = 0; i < n; i++) {
      let seen = 0, hits = 0;
      if (ev) {
        for (let d = -reach; d <= reach; d++) {
          let j = i + d;
          if (closed) j = ((j % n) + n) % n;
          else if (j < 0 || j >= n) continue;
          const v = ev[j];
          if (Number.isNaN(v) || v === undefined) continue;
          seen++;
          hits += v;
        }
      }
      const frac = seen > 0 ? hits / seen : 0;
      const tw = town(i);
      const yes = tw >= 2 || (seen >= 6 && (tw === 1 ? frac >= 0.1 : frac >= 0.4));
      on.push(yes && !blocked(i, side) && !nearRb[i]);
    }
    closeGaps(on, closed, minRun);
    // Gap closing mustn't bring back a blocked or roundabout sample.
    for (let i = 0; i < n; i++) if (on[i] && (blocked(i, side) || nearRb[i])) on[i] = false;
    dropStubs(on, closed, minRun);
    out[k] = on.map((x) => (x ? 1 : 0));
  });
  return out;
}

// --- Cross-section --------------------------------------------------------------------------

/** One piece of the kerb's cross-section, its ends in first-to-second order (left to right across the road). */
export interface KerbPiece {
  mesh: "strip" | "kerb" | "gutter";
  /** (t, z) at each end: offset from the centreline (+ left) and absolute height. */
  a: [number, number];
  b: [number, number];
  /** u across at each end. */
  ua: number;
  ub: number;
}

/**
 * The five pieces of one side's cross-section at a sample (skirt, strip, kerb top, kerb face, gutter),
 * ordered so that walking first to second end moves left to right across the road. k: kerb amount
 * (0 or 1), drop: driveway layback (0 or 1), photo: the strip's photo UV layout.
 */
export function kerbProfile(smp: RoadSample, side: 1 | -1, k: number, drop: number, crown: number, vergeWidth: number, photo: boolean): KerbPiece[] {
  const half = smp.width / 2;
  const e = surfaceHeight(smp, side * half, crown);
  const top = e + KERB_H * k * (1 - LAYBACK * drop);
  const inv = e - GUTTER_DIP * k;
  const full = e + KERB_H * k;
  const tOut = half + vergeWidth + STRIP_EXTRA;
  const zOut = full + STRIP_RISE * k - VERGE_DROP * (1 - k);
  const tIn = half + KERB_BACK * k;
  const tFace = half + (GUTTER + FACE_RUN + (KERB_TOP - 0.02) * drop) * k;
  const tLip = half + GUTTER * k;
  // u at the strip's outer edge and kerb back.
  const uOut = photo ? (side === 1 ? 0 : 1) : 0;
  const uBack = photo ? 0.5 : (vergeWidth + STRIP_EXTRA - KERB_BACK) / 4;
  // Left side, outside in.
  const pieces: KerbPiece[] = [
    { mesh: "strip", a: [tOut, zOut - SKIRT], b: [tOut, zOut], ua: uOut, ub: uOut },
    { mesh: "strip", a: [tOut, zOut], b: [tIn, top], ua: uOut, ub: uBack },
    { mesh: "kerb", a: [tIn, top], b: [tFace, top], ua: 0, ub: 0.25 },
    { mesh: "kerb", a: [tFace, top], b: [tLip, inv], ua: 0.25, ub: 0.5 },
    { mesh: "gutter", a: [tLip, inv], b: [half, e], ua: 0.5, ub: 1 },
  ];
  if (side === 1) return pieces;
  return pieces.reverse().map((p) => ({ mesh: p.mesh, a: [-p.b[0], p.b[1]], b: [-p.a[0], p.a[1]], ua: p.ub, ub: p.ua }));
}

// --- Meshes along the route -----------------------------------------------------------------

export function buildKerbs(
  plan: RoadPlan,
  opts: BuildOptions,
  kerb: [number[], number[]],
  stripMaterial: StripMaterialFn,
  noRamp: Set<string> = new Set<string>(),
  drops?: [number[], number[]],
): KerbMeshes {
  const out: KerbMeshes = { gutter: [], kerb: [], strip: [] };
  const ss = plan.samples, n = ss.length;
  if (n < 2) return out;
  const rowS = (r: number) => (r >= n ? plan.length : ss[r].s);
  const chunks = chunkRanges(plan);
  chunks.forEach(([a, b], ci) => {
    const kerbAt = (k: number, r: number) => kerb[k][r % n] ?? 0;
    const sideHas = (k: number) => {
      for (let r = a; r <= b; r++) if (kerbAt(k, r)) return true;
      return false;
    };
    if (!sideHas(0) && !sideHas(1)) return;
    const sm = stripMaterial(ci, a, b);
    const meshes = { gutter: new MeshBuilder(), kerb: new MeshBuilder(), strip: new MeshBuilder() };
    const sA = rowS(a), sB = rowS(b);
    ([1, -1] as const).forEach((side, k) => {
      if (!sideHas(k)) return;
      // Sections built: either end kerbed, and not taken over by a return or a junction.
      const sections: number[] = [];
      for (let r = a; r < b; r++) {
        if ((kerbAt(k, r) || kerbAt(k, r + 1)) && !noRamp.has(`${r % n}:${side}`)) sections.push(r);
      }
      if (!sections.length) return;
      const profiles = new Map<number, KerbPiece[]>();
      const profileAt = (r: number) => {
        let p = profiles.get(r);
        if (!p) {
          p = kerbProfile(ss[r % n], side, kerbAt(k, r), drops?.[k][r % n] ?? 0, opts.crown, opts.vergeWidth, sm.photo);
          profiles.set(r, p);
        }
        return p;
      };
      for (let piece = 0; piece < 5; piece++) {
        const kind = profileAt(sections[0])[piece].mesh;
        const mb = meshes[kind];
        const ids = new Map<number, [number, number]>();
        const vertsAt = (r: number): [number, number] => {
          let v = ids.get(r);
          if (v) return v;
          const smp = ss[r % n], s = rowS(r);
          const pc = profileAt(r)[piece];
          const vAlong = kind === "strip" ? (sm.photo ? (s - sA) / (sB - sA) : s / 4) : s / POUR;
          const put = (tz: [number, number], u: number) =>
            mb.vertex([smp.pos[0] + smp.left[0] * tz[0], smp.pos[1] + smp.left[1] * tz[0], tz[1]], u, vAlong);
          v = [put(pc.a, pc.ua), put(pc.b, pc.ub)];
          ids.set(r, v);
          return v;
        };
        for (const r of sections) {
          const p = vertsAt(r), q = vertsAt(r + 1);
          mb.quad(p[0], p[1], q[1], q[0]);
        }
      }
    });
    const nm = pad(ci);
    if (meshes.gutter.vertexCount) out.gutter.push(meshes.gutter.toKn5(`1ROAD_GUTTER_${nm}`, "concrete"));
    if (meshes.kerb.vertexCount) out.kerb.push(meshes.kerb.toKn5(`1KERB_${nm}`, "concrete"));
    if (meshes.strip.vertexCount) out.strip.push(meshes.strip.toKn5(`1GRASS_STRIP_${nm}`, sm.material));
  });
  return out;
}

// --- Strip photo ----------------------------------------------------------------------------

export function stripPhotoTexture(plan: RoadPlan, raster: RasterSampler, opts: BuildOptions, a: number, b: number, H = 2048): { rgba: Uint8Array; width: 64; height: number } {
  const W = 64 as const;
  const rgba = new Uint8Array(W * H * 4);
  const ss = plan.samples, n = ss.length;
  const rowS = (r: number) => (r >= n ? plan.length : ss[r].s);
  const sA = rowS(a), sB = rowS(b);
  const span = opts.vergeWidth + STRIP_EXTRA - KERB_BACK;
  let i = a;
  for (let y = 0; y < H; y++) {
    const s = sA + ((y + 0.5) / H) * (sB - sA);
    while (i < b - 1 && rowS(i + 1) <= s) i++;
    const A = ss[i % n], B = ss[(i + 1) % n] ?? A;
    const s0 = rowS(i), s1 = rowS(i + 1);
    const f = s1 > s0 ? Math.max(0, Math.min(1, (s - s0) / (s1 - s0))) : 0;
    const px = A.pos[0] + (B.pos[0] - A.pos[0]) * f, py = A.pos[1] + (B.pos[1] - A.pos[1]) * f;
    const hw = (A.width + (B.width - A.width) * f) / 2;
    for (let x = 0; x < W; x++) {
      const t = x < 32 ? hw + KERB_BACK + span * (1 - (x + 0.5) / 32) : -(hw + KERB_BACK + (span * (x - 32 + 0.5)) / 32);
      const c = raster(px + A.left[0] * t, py + A.left[1] * t) ?? FALLBACK;
      const o = (y * W + x) * 4;
      rgba[o] = byte(c[0]);
      rgba[o + 1] = byte(c[1]);
      rgba[o + 2] = byte(c[2]);
      rgba[o + 3] = 255;
    }
  }
  return { rgba, width: W, height: H };
}

// --- Kerb returns ---------------------------------------------------------------------------

export interface KerbJunction {
  /** Route sample index at the mouth. */
  seg: number;
  side: 1 | -1;
  /** The side street's width. */
  width: number;
  /** Unit direction of the street away from the route. */
  dir: Vec2;
}

export interface StreetEdgePoint {
  pos: Vec2;
  /** Unit, away from the street. */
  out: Vec2;
  /** Street surface height. */
  z: number;
}

type Img = { rgba: Uint8Array; width: number; height: number };

/** Adds quad p0..p3, wound so its geometric normal agrees with `want`. */
function facingQuad(mb: MeshBuilder, pts: Vec3[], uvs: [number, number][], want: Vec3): void {
  const [p0, p1, p2] = pts;
  const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
  const ids = pts.map((p, k) => mb.vertex(p, uvs[k][0], uvs[k][1]));
  if (nx * want[0] + ny * want[1] + nz * want[2] >= 0) mb.quad(ids[0], ids[1], ids[2], ids[3]);
  else mb.quad(ids[0], ids[3], ids[2], ids[1]);
}

/** Height of the asphalt edge on `side` at distance s along, interpolated between samples (wrapping on a loop). */
function edgeHeightAt(plan: RoadPlan, s: number, side: 1 | -1, crown: number): number {
  const ss = plan.samples, n = ss.length;
  const closed = plan.closed && plan.length > 0;
  const w = closed ? ((s % plan.length) + plan.length) % plan.length : Math.max(ss[0].s, Math.min(ss[n - 1].s, s));
  let lo = 0, hi = n - 1;
  if (w >= ss[hi].s) lo = hi;
  else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ss[mid].s <= w) lo = mid;
      else hi = mid;
    }
  }
  const A = ss[lo];
  const eA = surfaceHeight(A, (side * A.width) / 2, crown);
  const j = lo + 1 < n ? lo + 1 : closed ? 0 : -1;
  if (j < 0) return eA;
  const B = ss[j], sB = j === 0 ? plan.length : B.s;
  const f = sB > A.s ? Math.max(0, Math.min(1, (w - A.s) / (sB - A.s))) : 0;
  return eA + (surfaceHeight(B, (side * B.width) / 2, crown) - eA) * f;
}

export function buildKerbReturns(
  plan: RoadPlan,
  opts: BuildOptions,
  junctions: KerbJunction[],
  kerb: [number[], number[]],
  fillMaterial: string,
  photo?: RasterSampler,
  streetEdge?: (j: number, c: -1 | 1, R: number) => StreetEdgePoint[] | null,
  streetPhoto?: RasterSampler,
  streetClearance?: (x: number, y: number) => number,
): { nodes: Kn5MeshNode[]; noRamp: Set<string>; atlas?: Img; sideAtlas?: Img } {
  const ss = plan.samples, n = ss.length;
  const noRamp = new Set<string>();
  const nodes: Kn5MeshNode[] = [];
  if (n < 2) return { nodes, noRamp };
  const sp = spacingOf(plan);
  const closed = plan.closed && plan.length > 0;
  const crown = opts.crown;
  const gutter = new MeshBuilder(), kerbM = new MeshBuilder(), stripPhoto = new MeshBuilder(), stripGrass = new MeshBuilder();
  const fill = new MeshBuilder(), sideGutter = new MeshBuilder(), sidePhoto = new MeshBuilder(), sideGrass = new MeshBuilder();
  const ATLAS = 1024, CELL = 64, GRID = 16;
  const SIDE_W = 2048, SIDE_H = 512, COL = 32, COLS = 64;
  let atlas: Uint8Array | null = null, cells = 0;
  let sideAtlas: Uint8Array | null = null, cols = 0;
  const UP: Vec3 = [0, 0, 1];
  const putPixel = (img: Uint8Array, o: number, c: [number, number, number] | null) => {
    const cc = c ?? FALLBACK;
    img[o] = byte(cc[0]);
    img[o + 1] = byte(cc[1]);
    img[o + 2] = byte(cc[2]);
    img[o + 3] = 255;
  };
  const idx = (x: number) => (closed ? ((x % n) + n) % n : x);
  const inRange = (x: number) => closed || (x >= 0 && x < n);

  junctions.forEach((jn, ji) => {
    const smp = ss[jn.seg];
    if (!smp) return;
    const side = jn.side, sk = side === 1 ? 0 : 1;
    const v: Vec2 = [smp.left[0] * side, smp.left[1] * side];
    const u: Vec2 = smp.tan;
    if (jn.dir[0] * v[0] + jn.dir[1] * v[1] < 0.8) return;
    if (inRoundabout(plan, smp.pos[0], smp.pos[1], 15)) return;
    const half = smp.width / 2;
    const O: Vec2 = [smp.pos[0] + v[0] * half, smp.pos[1] + v[1] * half];
    const w2 = jn.width / 2;
    for (const c of [-1, 1] as const) {
      // Where the road kerb is full height again.
      let first = jn.seg + c * Math.ceil(w2 / sp);
      while (inRange(first) && !kerb[sk][idx(first)] && Math.abs(first - jn.seg) * sp < w2 + 3 * RETURN_R) first += c;
      if (!inRange(first) || !kerb[sk][idx(first)]) continue;
      const fi = idx(first);
      let along = c > 0 ? ss[fi].s - smp.s : smp.s - ss[fi].s;
      if (along < 0 && closed) along += plan.length;
      const R = along - w2;
      if (R < 2 || R > 3 * RETURN_R) continue;
      const C: Vec2 = [O[0] + u[0] * c * (w2 + R) + v[0] * R, O[1] + u[1] * c * (w2 + R) + v[1] * R];
      const d = (th: number): Vec2 => [-v[0] * Math.cos(th) - u[0] * c * Math.sin(th), -v[1] * Math.cos(th) - u[1] * c * Math.sin(th)];
      const at = (th: number, r: number): Vec2 => {
        const dd = d(th);
        return [C[0] + dd[0] * r, C[1] + dd[1] * r];
      };
      // A street really running through the corner: leave it square.
      if (streetClearance) {
        let through = false;
        for (let deg = 0; deg <= 90 && !through; deg += 15) {
          for (const r of [1.2, (1.2 + R - KERB_BACK) / 2, R - KERB_BACK]) {
            if (r <= 1) continue;
            const p = at((deg * Math.PI) / 180, r);
            if (streetClearance(p[0], p[1]) < -0.3) { through = true; break; }
          }
        }
        if (through) continue;
      }
      noRamp.add(`${c > 0 ? idx(first - 1) : fi}:${side}`);
      const A: Vec2 = [O[0] + u[0] * c * w2, O[1] + u[1] * c * w2];
      // Base height of a point: the road edge at its distance along from the mouth.
      const base = (p: Vec2) => {
        const al = Math.max(0, (p[0] - O[0]) * u[0] * c + (p[1] - O[1]) * u[1] * c);
        return edgeHeightAt(plan, smp.s + c * al, side, crown);
      };
      // Photo cell for the strip.
      let cell = -1;
      if (photo && cells < GRID * GRID) {
        cell = cells++;
        atlas ??= new Uint8Array(ATLAS * ATLAS * 4);
        const cx = cell % GRID, cy = Math.floor(cell / GRID);
        for (let py = 0; py < CELL; py++) {
          for (let px = 0; px < CELL; px++) {
            const x = C[0] - R + ((px + 0.5) / CELL) * 2 * R, y = C[1] + R - ((py + 0.5) / CELL) * 2 * R;
            putPixel(atlas, ((cy * CELL + py) * ATLAS + cx * CELL + px) * 4, photo(x, y));
          }
        }
      }
      const cellUv = (p: Vec2): [number, number] => {
        const cx = cell % GRID, cy = Math.floor(cell / GRID);
        return [(cx + (p[0] - (C[0] - R)) / (2 * R)) / GRID, (cy + (C[1] + R - p[1]) / (2 * R)) / GRID];
      };
      const edge = streetEdge?.(ji, c, R) ?? null;
      const carry = !!edge && edge.length > 1;
      const kkAt = (q: number) => (carry ? 1 : Math.min(1, (1 - q) / 0.25));
      // (r, height above base) at each end of each piece, outside of the curve in.
      const profile = (q: number): [number, number][][] => {
        const kk = kkAt(q), top = KERB_H * kk;
        const lip: [number, number] = [R - GUTTER * kk, -GUTTER_DIP * kk];
        const face: [number, number] = [R - (GUTTER + FACE_RUN) * kk, top];
        const back: [number, number] = [R - KERB_BACK * kk, top];
        return [[[R, 0], lip], [lip, face], [face, back], [back, [1, top + 0.02]]];
      };
      const STEPS = 8;
      for (let st = 0; st < STEPS; st++) {
        const qa = st / STEPS, qb = (st + 1) / STEPS;
        const ta = (qa * Math.PI) / 2, tb = (qb * Math.PI) / 2;
        const pa = profile(qa), pb = profile(qb);
        const mid = d((ta + tb) / 2);
        for (let piece = 0; piece < 4; piece++) {
          const corners: [number, number, [number, number]][] = [
            [ta, 0, pa[piece][0]], [ta, 1, pa[piece][1]], [tb, 1, pb[piece][1]], [tb, 0, pb[piece][0]],
          ];
          const pts: Vec3[] = [], uvs: [number, number][] = [];
          for (const [th, end, [r, dz]] of corners) {
            const p = at(th, r);
            pts.push([p[0], p[1], base(p) + dz]);
            uvs.push(piece === 3 && cell >= 0 ? cellUv(p) : [end, (th * R) / POUR]);
          }
          const want: Vec3 = piece === 1 ? [mid[0] * R, mid[1] * R, 0.3] : UP;
          const mb = piece === 0 ? gutter : piece === 3 ? (cell >= 0 ? stripPhoto : stripGrass) : kerbM;
          facingQuad(mb, pts, uvs, want);
        }
        // Asphalt filling the corner, 1 cm under the edge.
        const fa = at(ta, R), fb = at(tb, R);
        const tri: Vec3[] = [[A[0], A[1], base(A) - 0.01], [fa[0], fa[1], base(fa) - 0.01], [fb[0], fb[1], base(fb) - 0.01]];
        const nz = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0]);
        const ids = [mb3(fill, tri[0], 0, 0), mb3(fill, tri[1], 1, 0), mb3(fill, tri[2], 1, 1)];
        if (nz >= 0) fill.tri(ids[0], ids[1], ids[2]);
        else fill.tri(ids[0], ids[2], ids[1]);
      }
      if (!carry || !edge) continue;
      // Along the side street: start exactly where the return ends.
      const endP = at(Math.PI / 2, R);
      const pts: StreetEdgePoint[] = [{ pos: endP, out: edge[0].out, z: base(endP) }];
      for (const p of edge) {
        const last = pts[pts.length - 1];
        if (Math.hypot(p.pos[0] - last.pos[0], p.pos[1] - last.pos[1]) > 0.05) pts.push(p);
      }
      if (pts.length < 2) continue;
      let col = -1;
      const dist = [0];
      for (let k = 1; k < pts.length; k++) dist.push(dist[k - 1] + Math.hypot(pts[k].pos[0] - pts[k - 1].pos[0], pts[k].pos[1] - pts[k - 1].pos[1]));
      const total = dist[dist.length - 1];
      if (total <= 0) continue;
      if (streetPhoto && cols < COLS) {
        col = cols++;
        sideAtlas ??= new Uint8Array(SIDE_W * SIDE_H * 4);
        let k = 0;
        for (let y = 0; y < SIDE_H; y++) {
          const dd = ((y + 0.5) / SIDE_H) * total;
          while (k < pts.length - 2 && dist[k + 1] < dd) k++;
          const seg = dist[k + 1] - dist[k];
          const f = seg > 0 ? Math.max(0, Math.min(1, (dd - dist[k]) / seg)) : 0;
          const px = pts[k].pos[0] + (pts[k + 1].pos[0] - pts[k].pos[0]) * f;
          const py = pts[k].pos[1] + (pts[k + 1].pos[1] - pts[k].pos[1]) * f;
          const out = pts[k].out;
          for (let x = 0; x < COL; x++) {
            const o = KERB_BACK + ((x + 0.5) / COL) * SIDE_STRIP;
            putPixel(sideAtlas, (y * SIDE_W + col * COL + x) * 4, streetPhoto(px + out[0] * o, py + out[1] * o));
          }
        }
      }
      sideRun(pts, dist, total, col, sideGutter, kerbM, col >= 0 ? sidePhoto : sideGrass);
    }
  });

  if (gutter.vertexCount) nodes.push(gutter.toKn5("1ROAD_GUTTER_RET", "concrete"));
  if (kerbM.vertexCount) nodes.push(kerbM.toKn5("1KERB_RET", "concrete"));
  if (stripPhoto.vertexCount) {
    nodes.push(stripPhoto.toKn5("1GRASS_STRIP_RET", "returns_photo"));
    // Corners past the atlas's 256 cells.
    if (stripGrass.vertexCount) nodes.push(stripGrass.toKn5("1GRASS_STRIP_RETG", "grass"));
  } else if (stripGrass.vertexCount) nodes.push(stripGrass.toKn5("1GRASS_STRIP_RET", "grass"));
  if (fill.vertexCount) nodes.push(fill.toKn5("1STREET_RETFILL", fillMaterial));
  if (sideGutter.vertexCount) nodes.push(sideGutter.toKn5("1STREET_GUTTER_SIDE", "concrete"));
  if (sidePhoto.vertexCount) nodes.push(sidePhoto.toKn5("1GRASS_STRIP_SIDE", "sidestrips_photo"));
  if (sideGrass.vertexCount) nodes.push(sideGrass.toKn5("1GRASS_STRIP_SIDEG", "grass"));
  const res: { nodes: Kn5MeshNode[]; noRamp: Set<string>; atlas?: Img; sideAtlas?: Img } = { nodes, noRamp };
  if (atlas && cells > 0) res.atlas = { rgba: atlas, width: ATLAS, height: ATLAS };
  if (sideAtlas && cols > 0) res.sideAtlas = { rgba: sideAtlas, width: SIDE_W, height: SIDE_H };
  return res;
}

function mb3(mb: MeshBuilder, p: Vec3, u: number, v: number): number {
  return mb.vertex(p, u, v);
}

/** The kerb carrying on along a kerbed side street, sloping away over its last 4 m. */
function sideRun(pts: StreetEdgePoint[], dist: number[], total: number, col: number, gutter: MeshBuilder, kerbM: MeshBuilder, strip: MeshBuilder): void {
  const ends = pts.map((p, i) => {
    const k = Math.max(0, Math.min(1, (total - dist[i]) / 4));
    const top = p.z + KERB_H * k;
    const P = (o: number, z: number): Vec3 => [p.pos[0] + p.out[0] * o, p.pos[1] + p.out[1] * o, z];
    const lip = P(GUTTER * k, p.z - GUTTER_DIP * k);
    const face = P((GUTTER + FACE_RUN) * k, top);
    const back = P(KERB_BACK * k, top);
    return [[P(0, p.z), lip], [lip, face], [face, back], [back, P(KERB_BACK + SIDE_STRIP, top + 0.02)]];
  });
  for (let piece = 0; piece < 4; piece++) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = ends[i][piece], b = ends[i + 1][piece];
      const quadPts: Vec3[] = [a[0], a[1], b[1], b[0]];
      const vs = [dist[i], dist[i], dist[i + 1], dist[i + 1]];
      const us = [0, 1, 1, 0];
      const uvs: [number, number][] = piece === 3 && col >= 0
        ? us.map((uu, k) => [(col + uu) / 64, vs[k] / total])
        : us.map((uu, k) => [uu, vs[k] / POUR]);
      const out = pts[i].out;
      const want: Vec3 = piece === 1 ? [-out[0], -out[1], 0.3] : [0, 0, 1];
      const mb = piece === 0 ? gutter : piece === 3 ? strip : kerbM;
      facingQuad(mb, quadPts, uvs, want);
    }
  }
}
