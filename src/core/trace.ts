// Road tracing from aerial imagery. OSM centrelines are often a metre or two
// off the photo and their widths are guesses; this finds where the asphalt
// really is, and how wide, wherever the road can be seen:
//
// 1. The photo is straightened along the centreline: one row per sample, one
//    pixel every 0.1 m across.
// 2. Each row's middle band teaches what this road's asphalt looks like, as a
//    running median over neighbouring rows (patches, shade, surface changes).
// 3. A pixel is road when its chromaticity matches and its brightness is
//    between shadow and faded; bright, unsaturated paint also counts.
// 4. Walking out from the centre, bridging cars and paint gaps, gives each
//    row's two edges.
// 5. Only stretches that read clearly for 20 m are trusted; elsewhere
//    confidence fades and the build eases back to the OSM line and width.
//
// `applyTrace` then moves a RoadPlan's centreline and widths onto the trace.
//
// Written from docs/specs/trace.md.

import type { Vec2 } from "./geo";
import { frames, gaussianSmooth } from "./polyline";
import type { RoadPlan } from "./road";

/** Aerial colour at a local point, RGB 0..1, or null where there is no imagery. */
export type RasterSampler = ((x: number, y: number) => [number, number, number] | null) & {
  /** A colour-balanced variant for showing (texturing) rather than detecting. */
  display?: RasterSampler;
};

/** The sampler to texture with: its display variant if it has one. */
export function displayOf(r: RasterSampler): RasterSampler {
  return r.display ?? r;
}

export interface TraceResult {
  /** Lateral shift of the centreline onto the traced road, m, + left. */
  offset: number[];
  /** Traced asphalt width, m; NaN where confidence is 0. */
  width: number[];
  /** Trust, 0..1. */
  conf: number[];
  /** Fraction of samples traced directly, 0..1. */
  coverage: number;
}

/** The centreline shape tracing needs (a RoadPlan satisfies it). */
export interface TraceSample {
  pos: Vec2;
  left: Vec2;
  width: number;
  s: number;
}

/** Pixel size across the road, m. */
const DT = 0.1;
/** A traced row may be at most this much wider than the mapped width (guarded), m. */
const WIDER = 6;
/** Furthest the running centre may drift from the mapped line (guarded), m. */
const MAX_DRIFT = 5;
/** Reference band half-width, pixels (±1.2 m). */
const BAND = 12;
/** Band pixels that must look like asphalt for a valid row. */
const BAND_MIN = 18;
/** Valid rows a running reference needs. */
const REF_MIN_ROWS = 5;
/** Longest non-road run bridged, pixels, and solid road needed after it. */
const GAP = 16;
const GAP_SOLID = 6;
/** Start pixel search, ± pixels from the running centre. */
const START_SEARCH = 15;
/** Window lengths in metres, divided by the sample spacing. */
const RUN_M = 20;
const ROBUST_M = 24;
const REF_M = 50;
const FADE_M = 20;
const SIGMA_CONF_M = 6;
const SIGMA_EDGE_M = 8;
const SIGMA_OFFSET_M = 16;
/** Lateral rate limit, m of offset per m along. */
const RATE = 0.06;
/** Offset clamp, m (the drift limit is 5; the network core will cap at 3). */
const MAX_OFFSET = 6;

function median(v: number[]): number {
  if (v.length === 0) return NaN;
  const s = v.slice().sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Indices within i ± w: clamped to the ends, or wrapped (each once) on a loop. */
function windowOf(i: number, w: number, n: number, closed: boolean): number[] {
  const out: number[] = [];
  if (closed) {
    if (2 * w + 1 >= n) for (let j = 0; j < n; j++) out.push(j);
    else for (let k = -w; k <= w; k++) out.push((((i + k) % n) + n) % n);
  } else {
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) out.push(j);
  }
  return out;
}

interface Pixel {
  ok: boolean;
  l: number;
  c: [number, number, number];
  exg: number;
  sat: number;
}

function pixel(rgb: [number, number, number] | null): Pixel {
  if (!rgb) return { ok: false, l: 0, c: [0, 0, 0], exg: 0, sat: 0 };
  const [r, g, b] = rgb;
  const sum = r + g + b + 1e-4;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return { ok: true, l: sum / 3, c: [r / sum, g / sum, b / sum], exg: (2 * g - r - b) / sum, sat: mx > 0 ? (mx - mn) / mx : 0 };
}

/** One straightened row: pixel j at lateral offset (j − half) × DT. Exported for tests. */
export function rectify(sample: TraceSample, raster: RasterSampler, half: number, from = 0, to = 2 * half): Pixel[] {
  const out: Pixel[] = [];
  for (let j = from; j <= to; j++) {
    const t = (j - half) * DT;
    out.push(pixel(raster(sample.pos[0] + sample.left[0] * t, sample.pos[1] + sample.left[1] * t)));
  }
  return out;
}

/** Clears runs of traced samples shorter than `min` (wrapping on a loop). */
function keepLongRuns(traced: boolean[], min: number, closed: boolean): boolean[] {
  const n = traced.length;
  const out = traced.slice();
  if (n === 0) return out;
  const gapAt = traced.indexOf(false);
  if (gapAt < 0) {
    if (closed || n >= min) return out;
    return out.fill(false);
  }
  // Walk from a gap so a run crossing a loop's seam is seen whole.
  const start = closed ? gapAt : 0;
  const count = n;
  let runStart = -1;
  const flush = (end: number) => {
    if (runStart >= 0 && end - runStart < min) for (let k = runStart; k < end; k++) out[k % n] = false;
    runStart = -1;
  };
  for (let k = start; k < start + count; k++) {
    if (traced[k % n]) {
      if (runStart < 0) runStart = k;
    } else flush(k);
  }
  flush(start + count);
  return out;
}

/** Robust edge series: windowed median of the traced values, gaps held, smoothed. */
function robustEdge(edge: number[], traced: boolean[], w: number, sigma: number, closed: boolean): number[] {
  const n = edge.length;
  const v = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const vals: number[] = [];
    for (const j of windowOf(i, w, n, closed)) if (traced[j]) vals.push(edge[j]);
    v[i] = vals.length >= 4 ? median(vals) : NaN;
  }
  // Hold the last value forward (round a loop twice so the seam fills too)…
  let last = NaN;
  const laps = closed ? 2 : 1;
  for (let k = 0; k < n * laps; k++) {
    const i = k % n;
    if (Number.isNaN(v[i])) {
      if (!Number.isNaN(last)) v[i] = last;
    } else last = v[i];
  }
  // …and fill any leading gap with the first value found.
  let next = NaN;
  for (let i = n - 1; i >= 0; i--) {
    if (Number.isNaN(v[i])) {
      if (!Number.isNaN(next)) v[i] = next;
    } else next = v[i];
  }
  for (let i = 0; i < n; i++) if (Number.isNaN(v[i])) v[i] = 0;
  return gaussianSmooth(v, sigma, closed);
}

/** Samples to the nearest traced sample (Infinity if none), wrapping on a loop. */
function distanceToTraced(traced: boolean[], closed: boolean): number[] {
  const n = traced.length;
  const d = new Array<number>(n).fill(Infinity);
  const laps = closed ? 2 : 1;
  let lastAt = -Infinity;
  for (let k = 0; k < n * laps; k++) {
    const i = k % n;
    if (traced[i]) lastAt = k;
    d[i] = Math.min(d[i], k - lastAt);
  }
  let nextAt = Infinity;
  for (let k = n * laps - 1; k >= 0; k--) {
    const i = k % n;
    if (traced[i]) nextAt = k;
    d[i] = Math.min(d[i], nextAt - k);
  }
  return d;
}

/** Limits how fast the offset changes from sample to sample (wrapping on a loop). */
function rateLimit(v: number[], maxStep: number, closed: boolean): number[] {
  const n = v.length;
  const o = v.slice();
  if (n < 2) return o;
  const pass = () => {
    let moved = 0;
    const lim = (i: number, p: number) => {
      const c = clamp(o[i], o[p] - maxStep, o[p] + maxStep);
      moved = Math.max(moved, Math.abs(c - o[i]));
      o[i] = c;
    };
    for (let i = 1; i < n; i++) lim(i, i - 1);
    if (closed) lim(0, n - 1);
    for (let i = n - 2; i >= 0; i--) lim(i, i + 1);
    if (closed) lim(n - 1, 0);
    return moved;
  };
  pass();
  // On a loop the seam can need a few more passes to settle.
  if (closed) for (let k = 0; k < 4 * n && pass() > 1e-12; k++);
  return o;
}

/** Finds the traced road's offset, width and confidence at each centreline sample. Pure. */
export function traceRoad(plan: { samples: TraceSample[]; closed: boolean }, raster: RasterSampler, osmWidths?: number[], guard = true): TraceResult {
  const samples = plan.samples;
  const closed = plan.closed;
  const n = samples.length;
  if (n === 0) return { offset: [], width: [], conf: [], coverage: 0 };
  const widths = osmWidths ?? samples.map((s) => s.width);
  let widest = 0;
  for (const w of widths) if (w > widest) widest = w;
  const reach = Math.max(14, 1.4 * widest);
  const half = Math.round(reach / DT);
  const m = 2 * half + 1;

  const spacing = n > 1 ? samples[1].s - samples[0].s : 2;
  const inSamples = (metres: number) => Math.max(1, Math.round(metres / spacing));
  const runMin = inSamples(RUN_M);
  const robustW = inSamples(ROBUST_M);
  const refW = inSamples(REF_M);
  const fade = inSamples(FADE_M);

  // Asphalt reference per row, from the middle band.
  const refL: number[] = new Array(n).fill(NaN);
  const refC: [number, number, number][] = new Array(n);
  const valid: boolean[] = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const band = rectify(samples[i], raster, half, half - BAND, half + BAND);
    const lMed = median(band.filter((p) => p.ok).map((p) => p.l));
    if (Number.isNaN(lMed)) continue;
    const asphalt = band.filter((p) => p.ok && p.exg < 0.04 && p.sat < 0.25 && p.l < lMed + 0.12);
    if (asphalt.length < BAND_MIN) continue;
    valid[i] = true;
    refL[i] = median(asphalt.map((p) => p.l));
    refC[i] = [0, 1, 2].map((k) => median(asphalt.map((p) => p.c[k]))) as [number, number, number];
  }

  const L: number[] = new Array(n).fill(NaN);
  const R: number[] = new Array(n).fill(NaN);
  const rawTraced: boolean[] = new Array(n).fill(false);
  const driftPx = guard ? Math.round(MAX_DRIFT / DT) : Infinity;
  let centre = half;
  for (let i = 0; i < n; i++) {
    const near = windowOf(i, refW, n, closed).filter((j) => valid[j]);
    if (near.length < REF_MIN_ROWS) continue;
    const rL = median(near.map((j) => refL[j]));
    const rC = [0, 1, 2].map((k) => median(near.map((j) => refC[j][k])));
    const row = rectify(samples[i], raster, half);
    const road = row.map((p) => {
      if (!p.ok) return false;
      const ratio = p.l / Math.max(1e-3, rL);
      if (ratio > 1.55 && p.sat < 0.22) return true; // paint
      const dc = Math.hypot(p.c[0] - rC[0], p.c[1] - rC[1], p.c[2] - rC[2]);
      return dc < 0.03 && ratio > 0.4 && ratio < 1.45 && p.exg < 0.04;
    });

    let start = -1;
    for (let d = 0; d <= START_SEARCH && start < 0; d++) {
      if (centre - d >= 0 && centre - d < m && road[centre - d]) start = centre - d;
      else if (centre + d >= 0 && centre + d < m && road[centre + d]) start = centre + d;
    }
    if (start < 0) continue;

    const walk = (dir: -1 | 1): number => {
      let edge = start;
      let j = start;
      const end = dir < 0 ? 0 : m - 1;
      const inRow = (k: number) => (dir < 0 ? k >= 0 : k < m);
      for (;;) {
        const next = j + dir;
        if (!inRow(next)) return edge;
        if (road[next]) {
          edge = j = next;
          continue;
        }
        let k = next;
        while (inRow(k) && !road[k]) k += dir;
        if (!inRow(k)) return edge;
        const run = Math.abs(k - next);
        if (run > GAP) return edge;
        let solid = true;
        for (let q = 0; q < GAP_SOLID && solid; q++) {
          const idx = dir < 0 ? Math.max(end, k - q) : Math.min(end, k + q);
          if (!road[idx]) solid = false;
        }
        if (!solid) return edge;
        edge = j = k;
      }
    };
    const lo = walk(-1);
    const hi = walk(1);
    const w = (hi - lo) * DT;
    let inRun = 0;
    for (let j = lo; j <= hi; j++) if (road[j]) inRun++;
    const open = guard && (lo <= 1 || hi >= m - 2);
    const tooWide = guard && w > widths[i] + WIDER;
    if (open || tooWide || w < 3 || w > 22 || inRun / (hi - lo + 1) <= 0.75) continue;

    L[i] = (hi - half) * DT;
    R[i] = (lo - half) * DT;
    rawTraced[i] = true;
    centre = clamp(Math.round(0.3 * ((lo + hi) / 2) + 0.7 * centre), half - driftPx, half + driftPx);
  }

  const traced = keepLongRuns(rawTraced, runMin, closed);
  const coverage = traced.filter(Boolean).length / Math.max(1, n);
  const Ls = robustEdge(L, traced, robustW, SIGMA_EDGE_M / spacing, closed);
  const Rs = robustEdge(R, traced, robustW, SIGMA_EDGE_M / spacing, closed);

  const d = distanceToTraced(traced, closed);
  const raw = d.map((x) => Math.max(0, 1 - x / fade));
  const conf = gaussianSmooth(raw, SIGMA_CONF_M / spacing, closed).map((c) => clamp(c, 0, 1));

  let offset = Ls.map((l, i) => clamp((l + Rs[i]) / 2, -MAX_OFFSET, MAX_OFFSET) * conf[i]);
  const width = Ls.map((l, i) => (conf[i] > 0 ? clamp(l - Rs[i], 3, 20) : NaN));
  offset = gaussianSmooth(offset, SIGMA_OFFSET_M / spacing, closed);
  offset = rateLimit(offset, RATE * spacing, closed);
  return { offset, width, conf, coverage };
}

/** Moves a plan's centreline and widths onto a trace, blended by confidence. Ring samples stay put. */
export function applyTrace(plan: RoadPlan, tr: TraceResult, onRing: (i: number) => boolean): void {
  const smp = plan.samples;
  const n = smp.length;
  if (n === 0) return;
  const oldS = smp.map((s) => s.s);
  const ringIdx = plan.roundabouts.map((rb) => ({ rb, inAt: nearestIndex(oldS, rb.sIn), outAt: nearestIndex(oldS, rb.sOut) }));
  const ring = smp.map((_, i) => onRing(i));
  const pts: Vec2[] = smp.map((s, i) => (ring[i] ? s.pos : [s.pos[0] + s.left[0] * tr.offset[i], s.pos[1] + s.left[1] * tr.offset[i]]));
  const f = frames(pts, plan.closed);
  const curv = gaussianSmooth(f.map((x) => x.curvature), 4, plan.closed);
  for (let i = 0; i < n; i++) {
    const s = smp[i];
    s.pos = f[i].pos;
    s.tan = f[i].tan;
    s.left = f[i].left;
    s.s = f[i].s;
    s.curvature = curv[i];
    const w = tr.width[i];
    if (!ring[i] && !Number.isNaN(w)) s.width += (w - s.width) * tr.conf[i];
  }
  const last = smp[n - 1];
  plan.length = last.s + (plan.closed ? Math.hypot(smp[0].pos[0] - last.pos[0], smp[0].pos[1] - last.pos[1]) : 0);
  for (const { rb, inAt, outAt } of ringIdx) {
    rb.sIn = smp[inAt].s;
    rb.sOut = smp[outAt].s;
  }
}

function nearestIndex(values: number[], v: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < values.length; i++) {
    const d = Math.abs(values[i] - v);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}
