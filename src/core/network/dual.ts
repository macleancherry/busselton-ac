// Divided roads as one road with a median (docs/specs/road-network.md, "Building the graph", step 6;
// phase 2). Two one-way carriageways running opposite ways side by side become one two-way way along
// their midline, with the median's width, before the graph is built. Every other way that met either
// carriageway inside the divided stretch is moved onto the midline at that point (one coordinate,
// shared exactly, so the graph connects them), crossings of the median collapse to one point and go,
// and the carriageways' pieces beyond the stretch carry on from its ends.

import { classRank, defaultWidth, type NetWay } from "./graph";
import { along, dist, dot, lengths, sub, unit, type P2 } from "./geom";

export interface DualOptions {
  /** Carriageway centrelines this far apart at most, metres (spec: 30). */
  maxGap?: number;
  /** ... and at least this far (closer is a mapping overlap, not a divided road). */
  minGap?: number;
  /** A divided stretch at least this long, metres (spec: 50 m; 40 m keeps the town's short medians). */
  minLength?: number;
  /** The route runs along this point in this direction: such stretches stay two carriageways. */
  alongRoute?: (p: P2, d: P2) => boolean;
}

export interface DualInfo {
  /** Indices into the input ways of the two carriageways' ways. */
  a: number[];
  b: number[];
  /** The midline as built. */
  mid: P2[];
  length: number;
  median: number;
  width: number;
}

const key = (p: P2) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
const STEP = 2;

interface Chain {
  /** Ways (input indices) in travel order, each oriented in travel direction. */
  ways: number[];
  pts: P2[];
  cum: number[];
  /** Cumulative length at the start of each way. */
  starts: number[];
  rank: number;
  width: number;
  lanes: number;
}

interface Run {
  a: number;
  b: number;
  /** Interval on chain a (travel order), and the matching one on b (b's own travel order: b0 < b1). */
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/** Nearest point on a chain to p, with its arc length and travel direction. */
function nearestOn(c: Chain, p: P2): { s: number; q: P2; d: number; dir: P2 } {
  let best = { s: 0, q: c.pts[0], d: Infinity, dir: [1, 0] as P2 };
  for (let i = 1; i < c.pts.length; i++) {
    const a = c.pts[i - 1], b = c.pts[i];
    const ab = sub(b, a), L2 = dot(ab, ab);
    if (L2 < 1e-10) continue;
    const f = Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2));
    const q: P2 = [a[0] + ab[0] * f, a[1] + ab[1] * f];
    const d = dist(p, q);
    if (d < best.d) best = { s: c.cum[i - 1] + f * Math.sqrt(L2), q, d, dir: unit(ab) };
  }
  return best;
}

export function collapseDuals(ways: NetWay[], o: DualOptions = {}): { ways: NetWay[]; duals: DualInfo[] } {
  const maxGap = o.maxGap ?? 30, minGap = o.minGap ?? 0.3, minLength = o.minLength ?? 40;
  // Vertex use by every way: a carriageway vertex someone else uses is a junction on the dual.
  const users = new Map<string, Set<number>>();
  ways.forEach((w, wi) => w.pts.forEach((p) => {
    const k = key(p);
    if (!users.has(k)) users.set(k, new Set());
    users.get(k)!.add(wi);
  }));
  // 1. Carriageway chains: one-way ways (residential and up) joined end to end in travel order where
  // the road runs on (the straightest continuation under 35 degrees).
  const cand = ways.map((_, i) => i).filter((i) => {
    const w = ways[i];
    return !!w.oneway && !w.roundabout && classRank(w.cls) >= 2 && !/_link$/.test(w.cls) && (w.layer ?? 0) === 0 && w.pts.length >= 2;
  });
  const oriented = new Map<number, P2[]>(cand.map((i) => [i, ways[i].oneway === 1 ? ways[i].pts : ways[i].pts.slice().reverse()]));
  const startsAt = new Map<string, number[]>();
  for (const i of cand) {
    const k = key(oriented.get(i)![0]);
    if (!startsAt.has(k)) startsAt.set(k, []);
    startsAt.get(k)!.push(i);
  }
  const dirAt = (pts: P2[], end: boolean): P2 => (end ? unit(sub(pts[pts.length - 1], pts[pts.length - 2])) : unit(sub(pts[1], pts[0])));
  const next = new Map<number, number>(), prev = new Map<number, number>();
  for (const i of cand) {
    const pts = oriented.get(i)!;
    const d = dirAt(pts, true);
    let best = -1, bc = Math.cos((35 * Math.PI) / 180);
    for (const j of startsAt.get(key(pts[pts.length - 1])) ?? []) {
      if (j === i) continue;
      const c = dot(d, dirAt(oriented.get(j)!, false));
      if (c > bc) { bc = c; best = j; }
    }
    if (best < 0) continue;
    const had = prev.get(best);
    if (had !== undefined) {
      const ph = oriented.get(had)!;
      if (dot(dirAt(ph, true), dirAt(oriented.get(best)!, false)) >= bc) continue;
      next.delete(had);
    }
    next.set(i, best);
    prev.set(best, i);
  }
  const chains: Chain[] = [];
  const chainOf = new Map<number, number>();
  const makeChain = (first: number) => {
    const list: number[] = [];
    let i: number | undefined = first;
    while (i !== undefined && !chainOf.has(i)) { chainOf.set(i, chains.length); list.push(i); i = next.get(i); }
    let pts: P2[] = [];
    const starts: number[] = [];
    for (const w of list) {
      const seg = oriented.get(w)!;
      starts.push(pts.length ? lengths(pts)[pts.length - 1] : 0);
      pts = pts.length ? pts.concat(seg.slice(1)) : seg.slice();
    }
    const ws = list.map((w) => ways[w]);
    chains.push({
      ways: list, pts, cum: lengths(pts), starts,
      rank: Math.max(...ws.map((w) => classRank(w.cls))),
      width: ws.reduce((s, w) => s + defaultWidth(w), 0) / ws.length,
      lanes: Math.max(1, ...ws.map((w) => w.lanes ?? 1)),
    });
  };
  for (const i of cand) if (!prev.has(i)) makeChain(i);
  for (const i of cand) if (!chainOf.has(i)) makeChain(i); // loops
  // 2. Pairing: each 2 m sample of a chain finds the nearest chain running the other way beside it.
  const CELL = 20;
  const grid = new Map<string, number[]>();
  chains.forEach((c, ci) => {
    const seen = new Set<string>();
    for (const p of c.pts) {
      for (let x = Math.floor((p[0] - maxGap) / CELL); x <= Math.floor((p[0] + maxGap) / CELL); x++)
        for (let y = Math.floor((p[1] - maxGap) / CELL); y <= Math.floor((p[1] + maxGap) / CELL); y++) {
          const k = `${x},${y}`;
          if (seen.has(k)) continue;
          seen.add(k);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k)!.push(ci);
        }
    }
  });
  const runs: Run[] = [];
  chains.forEach((A, ai) => {
    const total = A.cum[A.cum.length - 1];
    const marks: { s: number; b: number; sb: number }[] = [];
    for (let s = 0; s <= total + 1e-6; s += STEP) {
      const at = along(A.pts, s, A.cum);
      if (o.alongRoute?.(at.p, at.d)) continue;
      let best: { b: number; sb: number; d: number } | null = null;
      for (const bi of grid.get(`${Math.floor(at.p[0] / CELL)},${Math.floor(at.p[1] / CELL)}`) ?? []) {
        if (bi === ai) continue;
        const nb = nearestOn(chains[bi], at.p);
        if (nb.d < minGap || nb.d > maxGap || dot(nb.dir, at.d) > -0.85) continue;
        // Beside, not beyond an end: the foot is inside the other chain.
        const tb = chains[bi].cum[chains[bi].cum.length - 1];
        if (nb.s < 0.5 || nb.s > tb - 0.5) continue;
        if (!best || nb.d < best.d) best = { b: bi, sb: nb.s, d: nb.d };
      }
      if (best) marks.push({ s, b: best.b, sb: best.sb });
    }
    // Runs per partner (each pair once: the lower chain index leads), gaps up to 6 m bridged.
    const byB = new Map<number, typeof marks>();
    for (const m of marks) { if (m.b < ai) continue; if (!byB.has(m.b)) byB.set(m.b, []); byB.get(m.b)!.push(m); }
    for (const [bi, ms] of byB) {
      let r0 = 0;
      for (let k = 1; k <= ms.length; k++) {
        if (k < ms.length && ms[k].s - ms[k - 1].s <= 6 + 1e-6) continue;
        const first = ms[r0], last = ms[k - 1];
        if (last.s - first.s >= minLength) runs.push({ a: ai, b: bi, a0: first.s, a1: last.s, b0: Math.min(first.sb, last.sb), b1: Math.max(first.sb, last.sb) });
        r0 = k;
      }
    }
  });
  if (!runs.length) return { ways, duals: [] };
  // Runs may not overlap on a chain (one carriageway paired twice over the same stretch): keep the longer.
  runs.sort((p, q) => q.a1 - q.a0 - (p.a1 - p.a0));
  const taken = new Map<number, [number, number][]>();
  const overlaps = (c: number, lo: number, hi: number) => (taken.get(c) ?? []).some(([x, y]) => lo < y && hi > x);
  const kept: Run[] = [];
  for (const r of runs) {
    if (overlaps(r.a, r.a0, r.a1) || overlaps(r.b, r.b0, r.b1)) continue;
    kept.push(r);
    for (const [c, lo, hi] of [[r.a, r.a0, r.a1], [r.b, r.b0, r.b1]] as const) { if (!taken.has(c)) taken.set(c, []); taken.get(c)!.push([lo, hi]); }
  }
  // 3. Midlines. Anchors: carriageway vertices someone else uses, moved onto the midline; anchors from
  // both sides within 5 m along become one (a crossing of the median).
  const moved = new Map<string, P2>();
  const cuts = new Map<number, { s: number; p: P2; cut: "start" | "end" }[]>();
  const addCut = (c: number, s: number, p: P2, cut: "start" | "end") => { if (!cuts.has(c)) cuts.set(c, []); cuts.get(c)!.push({ s, p, cut }); };
  const out: NetWay[] = [];
  const duals: DualInfo[] = [];
  for (const r of kept) {
    const A = chains[r.a], B = chains[r.b];
    const memberSet = new Set([...A.ways, ...B.ways]);
    const foreign = (p: P2) => [...(users.get(key(p)) ?? [])].some((w) => !memberSet.has(w));
    const gapAt = (s: number) => {
      const p = along(A.pts, s, A.cum).p;
      const q = nearestOn(B, p).q;
      return { p, q, m: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as P2, g: dist(p, q) };
    };
    // Anchor candidates in A's arc length.
    const anchors: { s: number; keys: P2[] }[] = [];
    A.pts.forEach((p, i) => { const s = A.cum[i]; if (s >= r.a0 - 6 && s <= r.a1 + 6 && foreign(p)) anchors.push({ s, keys: [p] }); });
    B.pts.forEach((p, i) => {
      const s = B.cum[i];
      if (s < r.b0 - 6 || s > r.b1 + 6 || !foreign(p)) return;
      const na = nearestOn(A, p);
      if (na.d <= maxGap + 1) anchors.push({ s: na.s, keys: [p] });
    });
    anchors.sort((p, q) => p.s - q.s);
    const merged: { s: number; keys: P2[] }[] = [];
    for (const an of anchors) {
      const last = merged[merged.length - 1];
      if (last && an.s - last.s < 5) { last.s = (last.s * last.keys.length + an.s) / (last.keys.length + 1); last.keys.push(...an.keys); }
      else merged.push({ ...an, keys: an.keys.slice() });
    }
    // The stretch ends at an anchor within 8 m of its end (the junction it really ends at).
    let a0 = r.a0, a1 = r.a1;
    const near0 = merged.filter((m) => Math.abs(m.s - a0) <= 8).sort((p, q) => Math.abs(p.s - a0) - Math.abs(q.s - a0))[0];
    const near1 = merged.filter((m) => Math.abs(m.s - a1) <= 8).sort((p, q) => Math.abs(p.s - a1) - Math.abs(q.s - a1))[0];
    if (near0) a0 = near0.s;
    if (near1 && near1 !== near0) a1 = near1.s;
    a0 = Math.max(0, a0);
    a1 = Math.min(A.cum[A.cum.length - 1], a1);
    if (a1 - a0 < minLength * 0.8) continue;
    const inner = merged.filter((m) => m.s >= a0 - 1e-6 && m.s <= a1 + 1e-6);
    const pts: { s: number; p: P2 }[] = [];
    let gSum = 0, gN = 0;
    for (let s = a0; s <= a1 + 1e-6; s += 3) {
      const g = gapAt(Math.min(s, a1));
      gSum += g.g; gN++;
      if (inner.some((m) => Math.abs(m.s - s) < 1.5)) continue;
      pts.push({ s, p: g.m });
    }
    for (const m of inner) {
      const g = gapAt(m.s);
      pts.push({ s: m.s, p: g.m });
      for (const k of m.keys) moved.set(key(k), g.m);
    }
    // Exact ends.
    const e0 = gapAt(a0), e1 = gapAt(a1);
    const end0 = inner.find((m) => Math.abs(m.s - a0) < 1e-6) ? pts.find((q) => Math.abs(q.s - a0) < 1e-6)!.p : e0.m;
    const end1 = inner.find((m) => Math.abs(m.s - a1) < 1e-6) ? pts.find((q) => Math.abs(q.s - a1) < 1e-6)!.p : e1.m;
    const mid = pts.filter((q) => q.s > a0 + 1e-6 && q.s < a1 - 1e-6).sort((p, q) => p.s - q.s).map((q) => q.p);
    const line = [end0, ...mid, end1].filter((p, i, arr) => i === 0 || dist(p, arr[i - 1]) > 0.05);
    if (line.length < 2) continue;
    const gap = gSum / Math.max(1, gN);
    const median = Math.max(0, Math.min(20, gap - (A.width + B.width) / 2));
    const width = A.width + B.width + median;
    const wa = ways[A.ways[0]];
    const top = [...A.ways, ...B.ways].map((w) => ways[w]).sort((p, q) => classRank(q.cls) - classRank(p.cls))[0];
    out.push({
      pts: line, cls: top.cls, width, median, lanes: A.lanes + B.lanes,
      ...(wa.name ? { name: wa.name } : {}),
    });
    // Carriageway pieces beyond the stretch carry on from its ends: A ends at end0 / starts at end1;
    // B (running the other way) is cut at the points beside them.
    addCut(r.a, a0, end0, "end");
    addCut(r.a, a1, end1, "start");
    const b0 = nearestOn(B, e1.p).s, b1 = nearestOn(B, e0.p).s;
    addCut(r.b, Math.min(b0, b1), end1, "end");
    addCut(r.b, Math.max(b0, b1), end0, "start");
    duals.push({ a: A.ways, b: B.ways, mid: line, length: lengths(line)[line.length - 1], median, width });
  }
  if (!duals.length) return { ways, duals: [] };
  // 4. Chains with cuts: emit the uncovered pieces, each in travel order (one-way 1).
  const cutChains = new Set(cuts.keys());
  const replaced = new Set<number>();
  for (const ci of cutChains) {
    const c = chains[ci];
    for (const w of c.ways) replaced.add(w);
    const list = cuts.get(ci)!.sort((p, q) => p.s - q.s);
    const total = c.cum[c.cum.length - 1];
    // Pieces: [0, first end], [start, next end], ..., [last start, total].
    let from: { s: number; p: P2 } | null = { s: 0, p: c.pts[0] };
    const pieces: { s0: number; p0: P2; s1: number; p1: P2 }[] = [];
    for (const cut of list) {
      if (cut.cut === "end") { if (from) pieces.push({ s0: from.s, p0: from.p, s1: cut.s, p1: cut.p }); from = null; }
      else from = { s: cut.s, p: cut.p };
    }
    if (from) pieces.push({ s0: from.s, p0: from.p, s1: total, p1: c.pts[c.pts.length - 1] });
    for (const pc of pieces) {
      if (pc.s1 - pc.s0 < 0.5 && dist(pc.p0, pc.p1) < 0.5) continue;
      // Split at the chain's way boundaries so each piece keeps its own way's tags.
      for (let k = 0; k < c.ways.length; k++) {
        const ws = c.starts[k], we = k + 1 < c.ways.length ? c.starts[k + 1] : total;
        const lo = Math.max(ws, pc.s0), hi = Math.min(we, pc.s1);
        if (hi - lo < 1e-6 && !(ws <= pc.s0 && pc.s0 === pc.s1)) continue;
        const pts: P2[] = [lo === pc.s0 ? pc.p0 : along(c.pts, lo, c.cum).p];
        for (let i = 0; i < c.pts.length; i++) if (c.cum[i] > lo + 1e-6 && c.cum[i] < hi - 1e-6) pts.push(c.pts[i]);
        pts.push(hi === pc.s1 ? pc.p1 : along(c.pts, hi, c.cum).p);
        const clean = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 0.02);
        if (clean.length < 2) continue;
        const w = ways[c.ways[k]];
        out.push({ ...w, pts: clean, oneway: 1 });
      }
    }
  }
  // 5. Everything else, with vertices on the carriageways moved onto the midlines; ways that collapse
  // to a point (crossings of the median, U-turn links) go.
  ways.forEach((w, wi) => {
    if (replaced.has(wi)) return;
    const pts = w.pts.map((p) => moved.get(key(p)) ?? p).filter((p, i, arr) => i === 0 || dist(p, arr[i - 1]) > 0.02);
    if (pts.length < 2) return;
    out.push({ ...w, pts });
  });
  return { ways: fuseForks(out), duals };
}

/**
 * Where a divided stretch ends and its two carriageways meet again within 45 m at one vertex (the road
 * goes back to one carriageway), the midline runs on to that vertex instead of forking.
 */
function fuseForks(ways: NetWay[]): NetWay[] {
  const ends = new Map<string, number[]>();
  ways.forEach((w, i) => {
    for (const p of [w.pts[0], w.pts[w.pts.length - 1]]) {
      const k = key(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k)!.push(i);
    }
  });
  const uses = new Map<string, number>();
  ways.forEach((w) => w.pts.forEach((p) => uses.set(key(p), (uses.get(key(p)) ?? 0) + 1)));
  const gone = new Set<number>();
  ways.forEach((m, mi) => {
    if (m.median === undefined) return;
    for (const atStart of [true, false]) {
      const E = atStart ? m.pts[0] : m.pts[m.pts.length - 1];
      const others = (ends.get(key(E)) ?? []).filter((i) => i !== mi && !gone.has(i));
      if (others.length !== 2 || (uses.get(key(E)) ?? 0) !== 3) continue;
      const [p, q] = others.map((i) => ways[i]);
      if (!p.oneway || !q.oneway || p.roundabout || q.roundabout) continue;
      const far = (w: NetWay) => (key(w.pts[0]) === key(E) ? w.pts[w.pts.length - 1] : w.pts[0]);
      const V = far(p);
      if (key(V) !== key(far(q))) continue;
      const lp = lengths(p.pts), lq = lengths(q.pts);
      if (lp[lp.length - 1] > 45 || lq[lq.length - 1] > 45) continue;
      // V must not be a roundabout's vertex (the splitter rule takes those).
      if (ways.some((w) => w.roundabout && w.pts.some((x) => key(x) === key(V)))) continue;
      gone.add(others[0]);
      gone.add(others[1]);
      if (atStart) m.pts = [V, ...m.pts]; else m.pts = [...m.pts, V];
    }
  });
  return ways.filter((_, i) => !gone.has(i));
}
