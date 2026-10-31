// Busselton fork: line markings read off the aerial photo (docs/specs/paintLines.md).
//
// A 100 mm line is about one blurred pixel at 10 to 15 cm per pixel, so single detections are only
// evidence: narrow bright runs across the road every 0.25 m (candidates), then lateral positions
// where they keep recurring over 60 m windows (lines), chained along the road.

import type { RoadPlan, RoadSample } from "./road";
import type { RasterSampler } from "./trace";

/** One painted line found on the photo. */
export interface ImageLine {
  /** Sample index range covered, inclusive. */
  i0: number;
  i1: number;
  /** Lateral offset at sample i is `t[i - i0]`, metres, + left. */
  t: number[];
  kind: "solid" | "dash";
  /** For dashes: where the 3 m line starts in the 12 m cycle of absolute s, metres. */
  phase: number;
  colour: "white" | "yellow";
}

/** One paint-like run across the road: distance along, lateral offset (+ left), and whether it's yellow. */
export interface Cand {
  s: number;
  t: number;
  yellow: boolean;
}

const DS = 0.25;
const DT = 0.05;
const WINDOW = 60;
const STEP = 20;
const BIN = 0.1;
const CYCLE = 12;

/** Last sample with s_i <= s (clamped to the plan). */
function indexAt(samples: RoadSample[], s: number): number {
  let lo = 0, hi = samples.length - 1;
  if (s <= samples[0].s) return 0;
  if (s >= samples[hi].s) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].s <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** End of the readable road: the plan's length on a loop (back round to sample 0), else the last sample. */
function roadEnd(plan: RoadPlan): number {
  const n = plan.samples.length;
  return plan.closed ? plan.length : plan.samples[n - 1].s;
}

/** Sample index at s, wrapping round a loop. */
function wrappedIndex(plan: RoadPlan, s: number): number {
  const L = plan.length;
  return indexAt(plan.samples, plan.closed && L > 0 ? ((s % L) + L) % L : s);
}

export function paintCandidates(plan: RoadPlan, raster: RasterSampler, trusted: (i: number) => boolean): Cand[] {
  const samples = plan.samples, n = samples.length;
  const out: Cand[] = [];
  if (n === 0) return out;
  const end = roadEnd(plan);
  for (let r = 0; ; r++) {
    const s = r * DS;
    if (plan.closed ? s >= end : s > end + 1e-9) break;
    const i = indexAt(samples, s);
    if (!trusted(i)) continue;
    const a = samples[i];
    // The next row: sample i + 1, or sample 0 again at the loop's length.
    const bIdx = i + 1 < n ? i + 1 : plan.closed ? 0 : -1;
    const b = bIdx >= 0 ? samples[bIdx] : null;
    const bs = bIdx === 0 ? plan.length : b?.s ?? a.s;
    const f = b && bs > a.s ? Math.max(0, Math.min(1, (s - a.s) / (bs - a.s))) : 0;
    const px = a.pos[0] + ((b?.pos[0] ?? a.pos[0]) - a.pos[0]) * f;
    const py = a.pos[1] + ((b?.pos[1] ?? a.pos[1]) - a.pos[1]) * f;
    const half = a.width / 2, reach = half + 1;
    const count = Math.round((2 * reach) / DT) + 1;
    const L = new Float64Array(count), S = new Float64Array(count), Y = new Uint8Array(count);
    for (let j = 0; j < count; j++) {
      const t = -reach + j * DT;
      const c = raster(px + a.left[0] * t, py + a.left[1] * t);
      if (!c) { L[j] = NaN; continue; }
      const [cr, cg, cb] = c;
      const mx = Math.max(cr, cg, cb), mn = Math.min(cr, cg, cb);
      L[j] = (cr + cg + cb) / 3;
      S[j] = mx > 0 ? (mx - mn) / mx : 0;
      Y[j] = cr > 0.45 && cg > 0.38 && cb < 0.7 * cg ? 1 : 0;
    }
    // Local asphalt brightness: the 40th percentile of every second pixel within 1 m.
    const ref = new Float64Array(count);
    const near: number[] = [];
    for (let j = 0; j < count; j++) {
      near.length = 0;
      for (let k = j - 20; k <= j + 20; k += 2) if (k >= 0 && k < count && !Number.isNaN(L[k])) near.push(L[k]);
      if (!near.length) { ref[j] = NaN; continue; }
      near.sort((x, y) => x - y);
      ref[j] = near[Math.floor(near.length * 0.4)];
    }
    const paint = (j: number) => {
      const l = L[j], rf = ref[j];
      if (Number.isNaN(l)) return false;
      return (l > 1.18 * rf + 0.03 && S[j] < 0.3) || (Y[j] === 1 && l > 1.2 * rf);
    };
    for (let j = 8; j < count - 8; ) {
      if (!paint(j)) { j++; continue; }
      let e = j + 1;
      while (e < count - 8 && paint(e)) e++;
      const w = (e - j) * DT;
      const t = -reach + ((j + e - 1) / 2) * DT;
      let peak = -Infinity, ys = 0;
      for (let k = j; k < e; k++) { peak = Math.max(peak, L[k]); ys += Y[k]; }
      const lo = L[j - 6], hi = L[e + 5];
      if (w >= 0.05 - 1e-9 && w <= 0.45 + 1e-9 && lo < 0.85 * peak && hi < 0.85 * peak && Math.abs(lo - hi) < 0.08 && Math.abs(t) < half - 0.15) {
        out.push({ s, t, yellow: ys > (e - j) / 2 });
      }
      j = e;
    }
  }
  return out;
}

interface Segment {
  s0: number;
  s1: number;
  t: number;
  cover: number;
  yellow: boolean;
  phase: number;
}

/** Start of the 3 m dash in the 12 m cycle that the detections fill best (first maximum). */
function dashPhase(ss: number[]): number {
  const slots = new Array(48).fill(0);
  for (const s of ss) {
    const m = (((s % CYCLE) + CYCLE) % CYCLE);
    slots[Math.min(47, Math.floor(m / DS))]++;
  }
  let best = -1, bestP = 0;
  for (let p = 0; p < 48; p++) {
    let sum = 0;
    for (let k = 0; k < 12; k++) sum += slots[(p + k) % 48];
    if (sum > best) { best = sum; bestP = p; }
  }
  return bestP * DS;
}

interface Found extends ImageLine {
  weight: number;
}

export function findLines(plan: RoadPlan, cands: Cand[], trusted: (i: number) => boolean): ImageLine[] {
  const samples = plan.samples, n = samples.length;
  if (n === 0 || cands.length === 0) return [];
  const closed = plan.closed && plan.length > 0;
  const L = plan.length;
  // A copy: the caller's array stays as it was.
  const sorted = cands.map((c, k) => ({ c, k })).sort((a, b) => a.c.s - b.c.s || a.k - b.k).map((x) => x.c);
  const end = roadEnd(plan);
  const segs: Segment[] = [];
  for (let w0 = 0; w0 < end; w0 += STEP) {
    const w1 = closed ? w0 + Math.min(WINDOW, end) : Math.min(end, w0 + WINDOW);
    if (w1 - w0 < STEP) break;
    // The window's candidates, in s order; on a loop the last windows run on past the seam.
    const inWin: Cand[] = [];
    for (const c of sorted) if (c.s >= w0 && c.s < w1) inWin.push(c);
    if (closed && w1 > L) for (const c of sorted) if (c.s + L >= w0 && c.s + L < w1 && c.s < w0) inWin.push({ ...c, s: c.s + L });
    let rows = 0;
    for (let k = 0; ; k++) {
      const s = w0 + k * DS;
      if (s >= w1 - 1e-9) break;
      if (trusted(wrappedIndex(plan, s))) rows++;
    }
    if (rows === 0 || rows < (0.6 * (w1 - w0)) / DS) continue;
    const counts = new Map<number, number>();
    for (const c of inWin) {
      const b = Math.round(c.t / BIN);
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    // Highest count first; ties in first-seen order (Map keeps insertion order, sort is stable).
    const bins = [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    const taken: number[] = [];
    for (const b of bins) {
      if (taken.some((x) => Math.abs(x - b) <= 8)) continue;
      const near = inWin.filter((c) => Math.abs(c.t - BIN * b) <= 0.15 + 1e-9);
      const cover = new Set(near.map((c) => Math.round(c.s / DS))).size / rows;
      if (cover < 0.12) continue;
      taken.push(b);
      segs.push({
        s0: w0,
        s1: w1,
        t: near.reduce((a, c) => a + c.t, 0) / near.length,
        cover,
        yellow: near.filter((c) => c.yellow).length > near.length / 2,
        phase: dashPhase(near.map((c) => c.s)),
      });
    }
  }
  // Chain overlapping windows' segments at about the same offset (within 0.5 m).
  const chains: Segment[][] = [];
  for (const sg of segs.map((x, k) => ({ x, k })).sort((a, b) => a.x.s0 - b.x.s0 || a.k - b.k).map((e) => e.x)) {
    const ch = chains.find((c) => {
      const last = c[c.length - 1];
      return last.s0 < sg.s0 && sg.s0 <= last.s1 && Math.abs(last.t - sg.t) < 0.5;
    });
    if (ch) ch.push(sg);
    else chains.push([sg]);
  }
  // Virtual indices run on past n on a loop (index n + k is sample k, a lap later).
  const vIndex = (s: number) => (closed ? Math.floor(s / L) * n + indexAt(samples, s - Math.floor(s / L) * L) : indexAt(samples, s));
  const vS = (i: number) => (closed ? samples[i % n].s + Math.floor(i / n) * L : samples[i].s);
  const lines: Found[] = [];
  for (const ch of chains) {
    let s0 = ch[0].s0, s1 = ch[ch.length - 1].s1;
    if (ch.length === 1) { s0 += 10; s1 -= 10; }
    if (s1 - s0 < 20) continue;
    const i0 = vIndex(s0), i1 = vIndex(s1);
    const mids = ch.map((g) => (g.s0 + g.s1) / 2);
    const t: number[] = [];
    for (let i = i0; i <= i1; i++) {
      const s = vS(i);
      let v: number;
      if (s <= mids[0]) v = ch[0].t;
      else if (s >= mids[mids.length - 1]) v = ch[ch.length - 1].t;
      else {
        v = ch[0].t;
        for (let k = 0; k + 1 < ch.length; k++) {
          if (mids[k] <= s && s <= mids[k + 1]) {
            const f = mids[k + 1] > mids[k] ? (s - mids[k]) / (mids[k + 1] - mids[k]) : 0;
            v = ch[k].t + (ch[k + 1].t - ch[k].t) * f;
          }
        }
      }
      t.push(v);
    }
    const cover = ch.reduce((a, g) => a + g.cover, 0) / ch.length;
    const phases = ch.map((g) => g.phase).sort((a, b) => a - b);
    lines.push({
      i0,
      i1,
      t,
      kind: cover > 0.5 ? "solid" : "dash",
      phase: phases[Math.floor(phases.length / 2)],
      colour: ch.filter((g) => g.yellow).length > ch.length / 2 ? "yellow" : "white",
      weight: (s1 - s0) * cover,
    });
  }
  // One line read twice: keep the heavier.
  const clash = (a: Found, b: Found, shift: number) => {
    const lo = Math.max(a.i0, b.i0 + shift), hi = Math.min(a.i1, b.i1 + shift);
    if (hi < lo || hi - lo + 1 < 0.3 * (a.i1 - a.i0 + 1)) return false;
    let d = 0;
    for (let i = lo; i <= hi; i++) d += Math.abs(a.t[i - a.i0] - b.t[i - shift - b.i0]);
    return d / (hi - lo + 1) < 1;
  };
  const kept: Found[] = [];
  for (const ln of lines.map((x, k) => ({ x, k })).sort((a, b) => b.x.weight - a.x.weight || a.k - b.k).map((e) => e.x)) {
    const shifts = closed ? [0, n, -n] : [0];
    if (!kept.some((k) => shifts.some((sh) => clash(ln, k, sh)))) kept.push(ln);
  }
  const out: ImageLine[] = [];
  for (const ln of kept) {
    const { weight: _w, ...line } = ln;
    if (!closed) { out.push(line); continue; }
    out.push(...unwrap(line, n, L));
  }
  return out.sort((a, b) => a.i0 - b.i0);
}

/** A loop's line in virtual indices, as lines in real indices: split at the seam, or one whole-lap line. */
function unwrap(line: ImageLine, n: number, L: number): ImageLine[] {
  const lap = Math.floor(line.i0 / n);
  let { i0, i1 } = line;
  const shiftPhase = (p: number, laps: number) => ((((p - laps * L) % CYCLE) + CYCLE) % CYCLE);
  const phase = shiftPhase(line.phase, lap);
  i0 -= lap * n;
  i1 -= lap * n;
  const tAt = (vi: number) => line.t[vi + lap * n - line.i0];
  if (i1 - i0 >= n - 1) {
    const t: number[] = [];
    for (let i = 0; i < n; i++) t.push(tAt(i >= i0 ? i : i + n));
    return [{ ...line, i0: 0, i1: n - 1, t, phase }];
  }
  if (i1 < n) return [{ ...line, i0, i1, t: line.t.slice(), phase }];
  const head: ImageLine = { ...line, i0, i1: n - 1, t: line.t.slice(0, n - i0), phase };
  const tailEnd = i1 - n;
  const tail: ImageLine = { ...line, i0: 0, i1: tailEnd, t: line.t.slice(n - i0, n - i0 + tailEnd + 1), phase: shiftPhase(line.phase, lap + 1) };
  return [head, tail];
}
