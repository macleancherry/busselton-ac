// Busselton fork: line markings, pavement marks and raised pavement markers (docs/specs/markings.md).
//
// Thin paint geometry 15 mm above the crowned road, after AS 1742.2: edge lines, a dividing line
// broken where there's overtaking sight distance and barrier where there isn't, RRPMs on it, lines
// read off the aerial photo where it has spoken, and transverse marks and glyphs street-level
// imagery saw. Traffic keeps left: forward traffic (increasing s) is at positive t.
//
// Frame: local ENU (x east, y north, z up); MeshBuilder.toKn5 converts to AC axes.

import type { Kn5MeshNode } from "./kn5";
import type { MeshBuilder } from "./mesh";
import { ChunkedMesh } from "./meshKit";
import type { BuildOptions } from "./options";
import type { ImageLine } from "./paintLines";
import { surfaceHeight, type RoadPlan, type RoadSample } from "./road";
import { pad } from "./roadMesh";
import { closeGaps, dropStubs, flagRuns } from "./runs";

const LIFT = 0.015;
const LINE = 0.1;
const EYE = 1.15;
/** Clear road needed ahead to allow overtaking, metres. */
export const OVERTAKING_SIGHT = 250;
const MIN_TWO_LANE = 5.5;
const EDGE_INSET = 0.2;
const DASH = 3;
const CYCLE = 12;
const RRPM_EVERY = 24;
const HEAD_LEN = 1.2;
const HEAD_HALF = 0.36;

/** A transverse mark or symbol at s along, t across (+ left). */
export interface DiscreteMark {
  s: number;
  t: number;
  kind: "stop" | "giveway" | "zebra" | "arrow" | "text" | "symbol" | "start" | "finish";
  shape?: string;
}

/**
 * A painted symbol in its own frame: a along its traffic's direction of travel from its tail, c across,
 * + to that traffic's left. Strokes are polylines `width` wide; heads are arrowheads (dir is a unit vector).
 */
export interface Glyph {
  lines: [number, number][][];
  heads: { at: [number, number]; dir: [number, number] }[];
  width: number;
  length: number;
}

type P3 = [number, number, number];

/** Distance-along helpers over a plan, wrapping round a closed loop. */
class Along {
  readonly n: number;
  readonly spacing: number;
  readonly closed: boolean;
  readonly L: number;
  readonly end: number;

  constructor(readonly plan: RoadPlan) {
    const ss = plan.samples;
    this.n = ss.length;
    this.spacing = this.n > 1 ? ss[1].s - ss[0].s : 2;
    this.closed = plan.closed && plan.length > 0 && this.n > 1;
    this.L = plan.length;
    this.end = this.closed ? plan.length : ss[this.n - 1].s;
  }

  s(i: number): number {
    return this.plan.samples[i].s;
  }

  private wrap(s: number): number {
    return this.closed ? ((s % this.L) + this.L) % this.L : s;
  }

  /** Last sample with s_i <= s (wrapped on a loop, clamped otherwise). */
  index(s: number): number {
    const ss = this.plan.samples;
    const w = this.wrap(s);
    let lo = 0, hi = this.n - 1;
    if (w <= ss[0].s) return 0;
    if (w >= ss[hi].s) return hi;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ss[mid].s <= w) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** The road at s, interpolated between samples (across the seam to sample 0 on a loop). */
  sample(s: number): RoadSample {
    const ss = this.plan.samples;
    const w = this.wrap(s);
    const i = this.index(w);
    const a = ss[i];
    const j = i + 1 < this.n ? i + 1 : this.closed ? 0 : -1;
    if (j < 0) return { ...a, s };
    const b = ss[j];
    const bs = j === 0 ? this.L : b.s;
    const f = bs > a.s ? Math.max(0, Math.min(1, (w - a.s) / (bs - a.s))) : 0;
    const lerp = (x: number, y: number) => x + (y - x) * f;
    let tx = lerp(a.tan[0], b.tan[0]), ty = lerp(a.tan[1], b.tan[1]);
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    return {
      ...a,
      pos: [lerp(a.pos[0], b.pos[0]), lerp(a.pos[1], b.pos[1])],
      tan: [tx, ty],
      left: [-ty, tx],
      h: lerp(a.h, b.h),
      bank: lerp(a.bank, b.bank),
      width: lerp(a.width, b.width),
      s,
    };
  }

  /** Sample distances strictly between s0 and s1 (unwrapped: past the seam they carry on above L). */
  between(s0: number, s1: number): number[] {
    const out: number[] = [];
    const ss = this.plan.samples;
    if (!this.closed) {
      for (let i = this.index(s0); i < this.n && ss[i].s < s1; i++) if (ss[i].s > s0) out.push(ss[i].s);
      return out;
    }
    for (let lap = Math.floor(s0 / this.L); lap * this.L < s1; lap++) {
      for (const smp of ss) {
        const s = smp.s + lap * this.L;
        if (s > s0 && s < s1) out.push(s);
      }
    }
    return out;
  }

  /** s at the end of a run whose first sample after it is index e (e >= n wraps on a loop, or is the road's end). */
  runEnd(e: number): number {
    if (e < this.n) return this.s(e);
    return this.closed ? this.L + this.s(e - this.n) : this.end;
  }
}

/** Distances from each sample to the farthest point the road is in clear view, forward and back. */
function sightDistances(plan: RoadPlan, cap = OVERTAKING_SIGHT + 50): { fwd: number[]; back: number[] } {
  const ss = plan.samples, n = ss.length;
  const al = new Along(plan);
  const sp = al.spacing;
  const step = Math.max(1, Math.round(4 / sp));
  let maxK = Math.ceil(cap / sp);
  // A short loop: don't look past half way round, or the walk comes back on itself.
  if (al.closed) maxK = Math.min(maxK, Math.floor(n / 2));
  const at = (i: number) => (al.closed ? ss[((i % n) + n) % n] : i >= 0 && i < n ? ss[i] : null);
  const walk = (i: number, dir: number): number => {
    const a = ss[i];
    for (let k = step; k <= maxK; k += step) {
      const b = at(i + dir * k);
      if (!b) return cap;
      const dx = b.pos[0] - a.pos[0], dy = b.pos[1] - a.pos[1];
      const len = Math.hypot(dx, dy) || 1;
      for (let m = step; m < k; m += step) {
        const c = at(i + dir * m)!;
        const off = Math.abs(dx * (c.pos[1] - a.pos[1]) - dy * (c.pos[0] - a.pos[0])) / len;
        if (off > c.width / 2 + 1.5 || c.h > a.h + EYE + (b.h - a.h) * (m / k)) return (k - step) * sp;
      }
    }
    return cap;
  };
  const fwd: number[] = [], back: number[] = [];
  for (let i = 0; i < n; i++) {
    fwd.push(walk(i, 1));
    back.push(walk(i, -1));
  }
  return { fwd, back };
}

/** Per sample, whether forward / backward traffic may not overtake (barrier line on its side). */
export function planCentreLine(plan: RoadPlan): { barrierFwd: boolean[]; barrierBack: boolean[] } {
  const { fwd, back } = sightDistances(plan);
  const al = new Along(plan);
  const tidy = (raw: boolean[]) => {
    closeGaps(raw, al.closed, Math.round(40 / al.spacing));
    dropStubs(raw, al.closed, Math.round(30 / al.spacing));
    return raw;
  };
  return {
    barrierFwd: tidy(fwd.map((d) => d < OVERTAKING_SIGHT)),
    barrierBack: tidy(back.map((d) => d < OVERTAKING_SIGHT)),
  };
}

// --- Glyphs ---------------------------------------------------------------------------------

/** A turn branch from a0 to one side, with its head at the end pointing along it. */
function turnBranch(g: Glyph, a0: number, side: number): void {
  const end: [number, number] = [a0 + 1.0, side * 0.55];
  g.lines.push([[a0, 0], end]);
  const l = Math.hypot(1.0, 0.55);
  g.heads.push({ at: end, dir: [1.0 / l, (side * 0.55) / l] });
}

export function arrowGlyph(shape = "straight"): Glyph | null {
  const g: Glyph = { lines: [], heads: [], width: 0.2, length: 5 };
  const straight = () => {
    g.lines.push([[0, 0], [3.8, 0]]);
    g.heads.push({ at: [3.8, 0], dir: [1, 0] });
  };
  switch (shape) {
    case "straight":
      straight();
      break;
    case "left":
    case "right":
      g.lines.push([[0, 0], [2.4, 0]]);
      turnBranch(g, 2.4, shape === "left" ? 1 : -1);
      break;
    case "split-left-or-straight":
    case "split-right-or-straight":
      straight();
      turnBranch(g, 1.6, shape === "split-left-or-straight" ? 1 : -1);
      break;
    case "split-left-or-right":
      g.lines.push([[0, 0], [2.4, 0]]);
      turnBranch(g, 2.4, 1);
      turnBranch(g, 2.4, -1);
      break;
    default:
      return null;
  }
  return g;
}

type Strokes = [number, number][][];
const RECT: Strokes = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]];

/** A simple single-stroke block font in a unit box: x across (0 = left as read), y up the letter (0 = bottom). */
const FONT: Record<string, Strokes> = {
  "0": [...RECT, [[0, 0], [1, 1]]],
  "1": [[[0.5, 0], [0.5, 1], [0.2, 0.75]], [[0.15, 0], [0.85, 0]]],
  "2": [[[0, 1], [1, 1], [1, 0.5], [0, 0.5], [0, 0], [1, 0]]],
  "3": [[[0, 1], [1, 1], [1, 0], [0, 0]], [[0.25, 0.5], [1, 0.5]]],
  "4": [[[0, 1], [0, 0.4], [1, 0.4]], [[0.7, 0.75], [0.7, 0]]],
  "5": [[[1, 1], [0, 1], [0, 0.55], [0.8, 0.55], [1, 0.4], [1, 0.15], [0.8, 0], [0, 0]]],
  "6": [[[1, 1], [0, 1], [0, 0], [1, 0], [1, 0.5], [0, 0.5]]],
  "7": [[[0, 1], [1, 1], [0.35, 0]]],
  "8": [...RECT, [[0, 0.5], [1, 0.5]]],
  "9": [[[1, 0.5], [0, 0.5], [0, 1], [1, 1], [1, 0], [0, 0]]],
  A: [[[0, 0], [0.5, 1], [1, 0]], [[0.25, 0.5], [0.75, 0.5]]],
  B: [[[0, 0], [0, 1], [0.75, 1], [1, 0.85], [1, 0.65], [0.75, 0.5], [0, 0.5]], [[0.75, 0.5], [1, 0.35], [1, 0.15], [0.75, 0], [0, 0]]],
  C: [[[1, 1], [0, 1], [0, 0], [1, 0]]],
  D: [[[0, 0], [0, 1], [0.6, 1], [1, 0.7], [1, 0.3], [0.6, 0], [0, 0]]],
  E: [[[1, 1], [0, 1], [0, 0], [1, 0]], [[0, 0.5], [0.75, 0.5]]],
  F: [[[1, 1], [0, 1], [0, 0]], [[0, 0.5], [0.75, 0.5]]],
  G: [[[1, 1], [0, 1], [0, 0], [1, 0], [1, 0.45], [0.5, 0.45]]],
  H: [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.5], [1, 0.5]]],
  I: [[[0.5, 0], [0.5, 1]], [[0.2, 1], [0.8, 1]], [[0.2, 0], [0.8, 0]]],
  J: [[[0.3, 1], [1, 1], [1, 0], [0, 0], [0, 0.3]]],
  K: [[[0, 0], [0, 1]], [[1, 1], [0, 0.4]], [[0.35, 0.6], [1, 0]]],
  L: [[[0, 1], [0, 0], [1, 0]]],
  M: [[[0, 0], [0, 1], [0.5, 0.5], [1, 1], [1, 0]]],
  N: [[[0, 0], [0, 1], [1, 0], [1, 1]]],
  O: RECT,
  P: [[[0, 0], [0, 1], [1, 1], [1, 0.5], [0, 0.5]]],
  Q: [...RECT, [[0.55, 0.35], [1, 0]]],
  R: [[[0, 0], [0, 1], [1, 1], [1, 0.5], [0, 0.5], [1, 0]]],
  S: [[[1, 1], [0, 1], [0, 0.5], [1, 0.5], [1, 0], [0, 0]]],
  T: [[[0, 1], [1, 1]], [[0.5, 1], [0.5, 0]]],
  U: [[[0, 1], [0, 0], [1, 0], [1, 1]]],
  V: [[[0, 1], [0.5, 0], [1, 1]]],
  W: [[[0, 1], [0.25, 0], [0.5, 0.6], [0.75, 0], [1, 1]]],
  X: [[[0, 0], [1, 1]], [[0, 1], [1, 0]]],
  Y: [[[0, 1], [0.5, 0.5], [1, 1]], [[0.5, 0.5], [0.5, 0]]],
  Z: [[[0, 1], [1, 1], [0, 0], [1, 0]]],
};

const TEXT_H = 3;
const TEXT_GAP = 1.5;
const LANE_TEXT = 2.8;

/** Painted words and numbers (speed limits, SLOW, BUS, SCHOOL, KEEP CLEAR), elongated; null if unpaintable. */
export function textGlyph(text = ""): Glyph | null {
  const words = text.toUpperCase().split(/[-\s]+/).filter((w) => w.length > 0);
  if (words.length === 0 || words.length > 2) return null;
  if (words.some((w) => w.length > 8 || [...w].some((ch) => !FONT[ch]))) return null;
  const g: Glyph = { lines: [], heads: [], width: 0, length: TEXT_H * words.length + TEXT_GAP * (words.length - 1) };
  let narrowest = Infinity;
  words.forEach((word, r) => {
    const n = word.length;
    const gap = /^[0-9]+$/.test(word) ? 0.35 : 0.2;
    const W = Math.min(0.75, (LANE_TEXT - gap * (n - 1)) / n);
    narrowest = Math.min(narrowest, W);
    const total = n * W + (n - 1) * gap;
    const row = r * (TEXT_H + TEXT_GAP);
    [...word].forEach((ch, k) => {
      for (const stroke of FONT[ch]) {
        g.lines.push(stroke.map(([x, y]): [number, number] => [row + y * TEXT_H, total / 2 - (k * (W + gap) + x * W)]));
      }
    });
  });
  g.width = narrowest < 0.5 ? 0.12 : 0.18;
  return g;
}

/** A bicycle drawn side-on, standing up the lane; null for any other symbol. */
export function symbolGlyph(shape = ""): Glyph | null {
  if (shape !== "bicycle") return null;
  const map = ([x, y]: [number, number]): [number, number] => [1.6 * y, -0.62 * x];
  const wheel = (cx: number): [number, number][] => {
    const pts: [number, number][] = [];
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * 2 * Math.PI;
      pts.push([cx + 0.38 * Math.cos(a), 0.38 + 0.38 * Math.sin(a)]);
    }
    return pts;
  };
  const rear: [number, number] = [-0.62, 0.38], front: [number, number] = [0.62, 0.38];
  const crank: [number, number] = [0, 0.38], seat: [number, number] = [-0.18, 0.95], head: [number, number] = [0.48, 1.0];
  const parts: [number, number][][] = [
    wheel(-0.62),
    wheel(0.62),
    [rear, crank, seat, rear],
    [seat, head, crank],
    [head, front],
    [[-0.32, 1.0], [-0.04, 1.0]],
    [head, [0.36, 1.14]],
  ];
  const lines = parts.map((p) => p.map(map));
  const length = Math.max(...lines.flat().map((p) => p[0]));
  return { lines, heads: [], width: 0.08, length };
}

// --- Meshes ---------------------------------------------------------------------------------

export function buildMarkings(
  plan: RoadPlan,
  opts: BuildOptions,
  skip: (s: number) => boolean = () => false,
  edgeGap: (side: 1 | -1, s: number) => boolean = () => false,
  image?: { lines: ImageLine[]; covered: (i: number) => boolean },
  discrete: DiscreteMark[] = [],
): Kn5MeshNode[] {
  const n = plan.samples.length;
  if (n === 0) return [];
  // Busselton fork: a circuit isn't a public road: edge lines and the start/finish only. No dividing
  // line or studs, no lines read off the aerial (they're often kerbs or rubber), no street-level marks.
  const raceway = !!opts.raceway;
  if (raceway) {
    image = undefined;
    discrete = discrete.filter((d) => d.kind === "start" || d.kind === "finish");
  }
  const al = new Along(plan);
  const crown = opts.crown ?? 0.02;
  const white = new ChunkedMesh(), yellow = new ChunkedMesh(), studs = new ChunkedMesh(20);

  const generated = (i: number) => !image || !image.covered(i);
  const twoLane = (i: number) => plan.samples[i].width >= MIN_TWO_LANE && generated(i);
  const point = (smp: RoadSample, t: number, lift = LIFT): P3 => [
    smp.pos[0] + smp.left[0] * t,
    smp.pos[1] + smp.left[1] * t,
    surfaceHeight(smp, t, crown) + lift,
  ];
  const up = (mb: MeshBuilder, count: number) => {
    for (let k = 0; k < count; k++) mb.normals!.push(0, 0, 1);
  };

  /** Runs of samples where cond holds and skip doesn't, as [s0, s1]; wrapping round a loop. */
  const runs = (cond: (i: number) => boolean): [number, number][] => {
    const on: boolean[] = [];
    for (let i = 0; i < n; i++) on.push(cond(i) && !skip(al.s(i)));
    return flagRuns(on, al.closed).map((r) => [al.s(r.start), al.runEnd(r.start + r.len)]);
  };

  const stripe = (mesh: ChunkedMesh, s0: number, s1: number, tOf: (smp: RoadSample) => number, w = LINE) => {
    if (s1 - s0 < 0.2) return;
    const cuts = [s0, ...al.between(s0, s1), s1];
    const mb = mesh.next(cuts.length * 2);
    const base = mb.vertexCount;
    for (const s of cuts) {
      const smp = al.sample(s);
      const t = tOf(smp);
      mb.vertex(point(smp, t + w / 2), 0, s);
      mb.vertex(point(smp, t - w / 2), 1, s);
    }
    up(mb, cuts.length * 2);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = base + 2 * k;
      mb.quad(a, a + 1, a + 3, a + 2);
    }
  };

  const patch = (s0: number, s1: number, t0: number, t1: number) => {
    const hi = Math.max(t0, t1), lo = Math.min(t0, t1);
    const cols = Math.max(1, Math.ceil((hi - lo) / 0.5));
    const mb = white.next(4 * (cols + 1));
    const base = mb.vertexCount;
    for (let r = 0; r < 4; r++) {
      const s = s0 + ((s1 - s0) * r) / 3;
      const smp = al.sample(s);
      for (let c = 0; c <= cols; c++) {
        const t = hi - ((hi - lo) * c) / cols;
        mb.vertex(point(smp, t), hi - t, s);
      }
    }
    up(mb, 4 * (cols + 1));
    const at = (r: number, c: number) => base + r * (cols + 1) + c;
    for (let r = 0; r < 3; r++) for (let c = 0; c < cols; c++) mb.quad(at(r, c), at(r, c + 1), at(r + 1, c + 1), at(r + 1, c));
  };

  /** Dashes on [start + 12k, start + 12k + 3) within a..b. */
  const dashes = (mesh: ChunkedMesh, a: number, b: number, first: number, tOf: (smp: RoadSample) => number) => {
    for (let d = first; d < b; d += CYCLE) stripe(mesh, Math.max(a, d), Math.min(b, d + DASH), tOf);
  };
  const broken = (a: number, b: number, t: number) => dashes(white, a, b, Math.ceil(a / CYCLE) * CYCLE - CYCLE, () => t);

  // Photo lines.
  const lines = image?.lines ?? [];
  for (const ln of lines) {
    const offAt = (s: number) => {
      // Fractional index at s, without wrapping (a line's run may end at the loop's length).
      const i = Math.max(ln.i0, Math.min(ln.i1, al.index(Math.min(s, al.s(n - 1)))));
      let fi = i;
      const nextS = i + 1 < n ? al.s(i + 1) : al.closed ? al.L : al.s(i);
      if (s >= al.s(i) && nextS > al.s(i)) fi = i + Math.min(1, (s - al.s(i)) / (nextS - al.s(i)));
      fi = Math.max(ln.i0, Math.min(ln.i1, fi));
      const k = Math.floor(fi), f = fi - k;
      const ta = ln.t[k - ln.i0], tb = ln.t[Math.min(ln.i1, k + 1) - ln.i0];
      return ta + (tb - ta) * f;
    };
    const mesh = ln.colour === "yellow" ? yellow : white;
    const tOf = (smp: RoadSample) => offAt(smp.s);
    for (let i = ln.i0; i <= ln.i1; ) {
      if (skip(al.s(i))) { i++; continue; }
      let e = i;
      while (e <= ln.i1 && !skip(al.s(e))) e++;
      const a = al.s(i), b = al.runEnd(e);
      if (ln.kind === "solid") stripe(mesh, a, b, tOf);
      else dashes(mesh, a, b, Math.floor((a - ln.phase) / CYCLE) * CYCLE + ln.phase, tOf);
      i = e;
    }
  }

  // Edge lines.
  for (const side of [1, -1] as const) {
    for (const [a, b] of runs((i) => twoLane(i) && !edgeGap(side, al.s(i)))) {
      stripe(white, a, b, (smp) => side * (smp.width / 2 - EDGE_INSET));
    }
  }

  // Dividing line.
  const anyTwoLane = !raceway && plan.samples.some((_, i) => twoLane(i));
  if (anyTwoLane) {
    const { barrierFwd, barrierBack } = planCentreLine(plan);
    const cls = (i: number) => (twoLane(i) ? (barrierFwd[i] ? 2 : 0) + (barrierBack[i] ? 1 : 0) : -1);
    for (let c = 0; c < 4; c++) {
      for (const [a, b] of runs((i) => cls(i) === c)) {
        if (c === 0) broken(a, b, 0);
        else if (c === 3) {
          stripe(white, a, b, () => LINE);
          stripe(white, a, b, () => -LINE);
        } else if (c === 2) {
          stripe(white, a, b, () => LINE);
          broken(a, b, -LINE);
        } else {
          stripe(white, a, b, () => -LINE);
          broken(a, b, LINE);
        }
      }
    }
  }

  // Discrete marks.
  const laneCentre = (s: number, t: number) => {
    const i = al.index(s);
    const half = plan.samples[i].width / 2;
    const side = t >= 0 ? 1 : -1;
    const bounds = [0, side * half];
    for (const ln of lines) {
      if (i < ln.i0 || i > ln.i1) continue;
      const lt = ln.t[i - ln.i0];
      if (lt * side > 0.5 && lt * side < half - 0.5) bounds.push(lt);
    }
    bounds.sort((x, y) => x - y);
    for (let k = 0; k + 1 < bounds.length; k++) {
      if (t >= bounds[k] && t <= bounds[k + 1] && bounds[k + 1] - bounds[k] < 4.6) return (bounds[k] + bounds[k + 1]) / 2;
    }
    const lanes = Math.max(1, Math.round(half / 3.4));
    const w = half / lanes;
    const k = Math.max(0, Math.min(lanes - 1, Math.floor(Math.abs(t) / w)));
    return side * (k + 0.5) * w;
  };

  const drape = (g: Glyph, tail: number, tc: number) => {
    const dir = tc >= 0 ? 1 : -1;
    const at = (a: number, c: number): P3 => point(al.sample(tail + dir * a), tc + dir * c);
    const uvS = (a: number) => tail + dir * a;
    /** Adds a polygon (3 or 4 corners in glyph space), wound counter-clockwise seen from above. */
    const poly = (pts: [number, number][], us: number[]) => {
      const mb = white.next(pts.length);
      const world = pts.map(([a, c]) => at(a, c));
      let area = 0;
      for (let k = 0; k < world.length; k++) {
        const p = world[k], q = world[(k + 1) % world.length];
        area += p[0] * q[1] - q[0] * p[1];
      }
      const order = area >= 0 ? world.map((_, k) => k) : world.map((_, k) => world.length - 1 - k);
      const ids = order.map((k) => mb.vertex(world[k], us[k], uvS(pts[k][0])));
      up(mb, ids.length);
      if (ids.length === 4) mb.quad(ids[0], ids[1], ids[2], ids[3]);
      else mb.tri(ids[0], ids[1], ids[2]);
    };
    const hw = g.width / 2;
    for (const line of g.lines) {
      for (let k = 0; k + 1 < line.length; k++) {
        const p = line[k], q = line[k + 1];
        const da = q[0] - p[0], dc = q[1] - p[1];
        const l = Math.hypot(da, dc);
        if (l < 1e-9) continue;
        const ea = (da / l) * hw, ec = (dc / l) * hw;
        const na = -ec, nc = ea; // left normal, width / 2 long
        const p0: [number, number] = [p[0] - ea, p[1] - ec], q0: [number, number] = [q[0] + ea, q[1] + ec];
        poly([[p0[0] - na, p0[1] - nc], [q0[0] - na, q0[1] - nc], [q0[0] + na, q0[1] + nc], [p0[0] + na, p0[1] + nc]], [1, 1, 0, 0]);
      }
    }
    for (const h of g.heads) {
      const ra = h.dir[1], rc = -h.dir[0];
      poly([
        [h.at[0] + ra * HEAD_HALF, h.at[1] + rc * HEAD_HALF],
        [h.at[0] + h.dir[0] * HEAD_LEN, h.at[1] + h.dir[1] * HEAD_LEN],
        [h.at[0] - ra * HEAD_HALF, h.at[1] - rc * HEAD_HALF],
      ], [1, 0.5, 0]);
    }
  };

  for (const d of discrete) {
    if (skip(d.s) || d.s < 1 || d.s > al.end - 1) continue;
    const half = al.sample(d.s).width / 2 - EDGE_INSET;
    const side = d.t >= 0 ? 1 : -1;
    switch (d.kind) {
      case "start":
        patch(d.s - 0.2, d.s + 0.2, -half, half);
        break;
      case "finish":
        for (let row = 0; row < 2; row++) {
          const s0 = d.s - 0.5 + row * 0.5;
          for (let k = 0, t = -half; t < half - 0.05; k++, t += 0.5) {
            if ((k + row) % 2 === 0) patch(s0, s0 + 0.5, t, Math.min(half, t + 0.5));
          }
        }
        break;
      case "stop":
        patch(d.s - 0.15, d.s + 0.15, 0, side * half);
        break;
      case "giveway":
        for (let t = 0.1; t < half; t += 1.2) patch(d.s - 0.15, d.s + 0.15, side * t, side * Math.min(half, t + 0.6));
        break;
      case "zebra":
        for (let t = -half; t < half - 0.4; t += 1) patch(d.s - 1.5, d.s + 1.5, t, Math.min(half, t + 0.5));
        break;
      case "arrow":
      case "text":
      case "symbol": {
        const g = d.kind === "arrow" ? arrowGlyph(d.shape) : d.kind === "text" ? textGlyph(d.shape) : symbolGlyph(d.shape);
        if (!g) break;
        const s0 = Math.max(1, Math.min(al.end - 1 - g.length, d.s - g.length / 2));
        const tc = laneCentre(d.s, d.t);
        drape(g, tc >= 0 ? s0 : s0 + g.length, tc);
        break;
      }
    }
  }

  // Raised reflective pavement markers on the dividing line.
  for (let d = RRPM_EVERY; !raceway && d < al.end - CYCLE; d += RRPM_EVERY) {
    const smp = al.sample(d);
    if (smp.width < MIN_TWO_LANE || !generated(al.index(d)) || skip(d)) continue;
    stud(studs.next(20), smp, crown);
  }

  const out: Kn5MeshNode[] = [];
  white.all().forEach((mb, k) => out.push(mb.toKn5(`MARKINGS_${pad(k)}`, "paint", { castShadows: false })));
  yellow.all().forEach((mb, k) => out.push(mb.toKn5(`MARKINGS_Y_${pad(k)}`, "paint_yellow", { castShadows: false })));
  studs.all().forEach((mb, k) => out.push(mb.toKn5(`RRPM_${pad(k)}`, "rrpm", { castShadows: false })));
  return out;
}

/** One 100 x 100 x 20 mm marker on the centreline, square to the road: four sides and a top, 20 vertices. */
function stud(mb: MeshBuilder, smp: RoadSample, crown: number): void {
  const hs = 0.05, tall = 0.02;
  const f = smp.tan, l = smp.left;
  // Corners counter-clockwise from above: back-right, front-right, front-left, back-left.
  const corners = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([a, c]) => {
    const t = c * hs;
    return {
      x: smp.pos[0] + f[0] * a * hs + l[0] * t,
      y: smp.pos[1] + f[1] * a * hs + l[1] * t,
      z: surfaceHeight(smp, t, crown),
    };
  });
  const nrm = mb.normals!;
  for (let k = 0; k < 4; k++) {
    const p = corners[k], q = corners[(k + 1) % 4];
    const rx = q.x - p.x, ry = q.y - p.y, run = Math.hypot(rx, ry) || 1;
    // Outward (right of p -> q), tilted up, normalised.
    const ox = ry / run, oy = -rx / run, oz = 0.3, ol = Math.hypot(ox, oy, oz);
    const a = mb.vertex([p.x, p.y, p.z], 0, 1);
    const b = mb.vertex([q.x, q.y, q.z], 1, 1);
    const c = mb.vertex([q.x, q.y, q.z + tall], 1, 0);
    const d = mb.vertex([p.x, p.y, p.z + tall], 0, 0);
    mb.quad(a, b, c, d);
    for (let v = 0; v < 4; v++) nrm.push(ox / ol, oy / ol, oz / ol);
  }
  const top = corners.map((p) => mb.vertex([p.x, p.y, p.z + tall], 0, 0));
  mb.quad(top[0], top[1], top[2], top[3]);
  for (let v = 0; v < 4; v++) nrm.push(0, 0, 1);
}
