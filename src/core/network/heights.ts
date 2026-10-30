// Heights (docs/specs/road-network.md, "Heights"): one field per junction, edges conform to it.

import type { Graph } from "./graph";
import type { JunctionShape, Leg } from "./junction";
import { along, dot, lengths, segDist, smooth1d, smoothstep, sub, type P2 } from "./geom";

export type HeightAt = (x: number, y: number) => number;

export interface HeightOptions {
  /** Smoothing of terrain along an edge (Gaussian sigma), metres. */
  sigma?: number;
  /** Residual at which legs stop conforming to the base plane and the field blends instead, metres. */
  tolerance?: number;
  /** Greatest grade of a base plane fitted to the legs (not a through road's). */
  maxGrade?: number;
  maxGradeRoundabout?: number;
  /** Outward fall of a roundabout's circulating carriageway. */
  ringFall?: number;
}

const D = { sigma: 15, tolerance: 0.1, maxGrade: 0.04, maxGradeRoundabout: 0.025, ringFall: 0.02 };

/** Smoothed terrain profile along a polyline, sampled every `step` metres: heights and positions s. */
export function terrainProfile(line: P2[], height: HeightAt, sigma: number, step = 2): { s: number[]; h: number[] } {
  const cum = lengths(line);
  const total = cum[cum.length - 1];
  const n = Math.max(1, Math.round(total / step));
  const s: number[] = [], raw: number[] = [];
  for (let k = 0; k <= n; k++) {
    const sk = (total * k) / n;
    const p = along(line, sk, cum).p;
    s.push(sk);
    raw.push(height(p[0], p[1]));
  }
  return { s, h: smooth1d(raw, sigma / Math.max(1e-6, total / n)) };
}

/** Linear interpolation of a profile at s. */
export function profileAt(pr: { s: number[]; h: number[] }, s: number): number {
  const { s: xs, h } = pr;
  if (s <= xs[0]) return h[0];
  if (s >= xs[xs.length - 1]) return h[h.length - 1];
  let i = 1;
  while (xs[i] < s) i++;
  const f = (s - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
  return h[i - 1] + (h[i] - h[i - 1]) * f;
}

/** A plane h = h0 + g . (p - o). */
export interface Plane { o: P2; h0: number; g: P2 }
export const planeAt = (pl: Plane, p: P2) => pl.h0 + dot(pl.g, sub(p, pl.o));

export interface JunctionField {
  node: number;
  base: Plane;
  /** Leg planes (equal to the base when the leg conforms). */
  legPlanes: Plane[];
  /** Legs' own (terrain) cap heights before conforming. */
  legTerrain: number[];
  /** True when every leg conforms: the field is the base plane (plus a roundabout's ring fall). */
  planar: boolean;
  /** Index pair of the through road's legs, if there is one. */
  through?: [number, number];
  h: (p: P2) => number;
}

/** Weighted least-squares plane through points. */
function fitPlane(pts: { p: P2; h: number; w: number }[], o: P2): Plane {
  // Solve for [h0, gx, gy] in h = h0 + gx dx + gy dy.
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  for (const { p, h, w } of pts) {
    const r = [1, p[0] - o[0], p[1] - o[1]];
    for (let i = 0; i < 3; i++) {
      b[i] += w * r[i] * h;
      for (let j = 0; j < 3; j++) A[i][j] += w * r[i] * r[j];
    }
  }
  // Tiny ridge so a degenerate set still solves (flat plane through the mean).
  for (let i = 1; i < 3; i++) A[i][i] += 1e-6;
  const x = solve3(A, b);
  return { o, h0: x[0], g: [x[1], x[2]] };
}

function solve3(A: number[][], b: number[]): number[] {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [M[0][3] / (M[0][0] || 1e-12), M[1][3] / (M[1][1] || 1e-12), M[2][3] / (M[2][2] || 1e-12)];
}

function clampGrade(pl: Plane, max: number): Plane {
  const g = Math.hypot(pl.g[0], pl.g[1]);
  return g <= max ? pl : { ...pl, g: [(pl.g[0] / g) * max, (pl.g[1] / g) * max] };
}

/** The leg's terrain height and outward grade at its cap. */
export function legTerrain(leg: Leg, height: HeightAt, sigma: number): { h: number; g: number } {
  const pr = terrainProfile(leg.line, height, sigma);
  const h = profileAt(pr, leg.trim);
  const g = (profileAt(pr, leg.trim + 1) - profileAt(pr, Math.max(0, leg.trim - 1))) / (leg.trim + 1 - Math.max(0, leg.trim - 1));
  return { h, g };
}

export function junctionField(shape: JunctionShape, height: HeightAt, o: HeightOptions = {}): JunctionField {
  const opt = { ...D, ...o };
  const legs = shape.legs;
  const terr = legs.map((l) => legTerrain(l, height, opt.sigma));
  const centre: P2 = shape.ring ? shape.ring.c : legs.length ? [legs.reduce((s, l) => s + l.cap.c[0], 0) / legs.length, legs.reduce((s, l) => s + l.cap.c[1], 0) / legs.length] : [0, 0];
  // Terrain samples over the junction's box, inside the road, for the cross slope.
  const samples: { p: P2; h: number; w: number }[] = [];
  const [x0, y0, x1, y1] = shape.box;
  const stepX = Math.max(1, (x1 - x0) / 12), stepY = Math.max(1, (y1 - y0) / 12);
  for (let x = x0; x <= x1; x += stepX) for (let y = y0; y <= y1; y += stepY) {
    if (shape.sdf([x, y]) < 0) samples.push({ p: [x, y], h: height(x, y), w: 1 });
  }
  const terrainPlane = fitPlane(samples.length >= 3 ? samples : legs.map((l, i) => ({ p: l.cap.c, h: terr[i].h, w: 1 })), centre);
  // Through road: the two highest-ranked legs, same class, more than 135 degrees apart.
  let through: [number, number] | undefined;
  const order = legs.map((_, i) => i).sort((a, b) => legs[b].rank - legs[a].rank);
  if (!shape.ring && legs.length >= 3) {
    const [a, b] = order;
    const third = legs[order[2]];
    if (legs[a].rank === legs[b].rank && third.rank <= legs[a].rank && dot(legs[a].cap.d, legs[b].cap.d) < Math.cos((135 * Math.PI) / 180)) {
      // With four or more legs, only when the top pair outranks the rest (else it's a crossroads of equals).
      if (legs.length === 3 || third.rank < legs[a].rank) through = [a, b];
    }
  }
  let base: Plane;
  if (through) {
    const A = legs[through[0]], B = legs[through[1]];
    const ha = terr[through[0]].h, hb = terr[through[1]].h;
    const axis = sub(B.cap.c, A.cap.c);
    const L = Math.hypot(axis[0], axis[1]) || 1;
    const u: P2 = [axis[0] / L, axis[1] / L], v: P2 = [-u[1], u[0]];
    const gu = (hb - ha) / L, gv = dot(terrainPlane.g, v);
    base = { o: A.cap.c, h0: ha, g: [u[0] * gu + v[0] * gv, u[1] * gu + v[1] * gv] };
  } else {
    const pts = legs.map((l, i) => ({ p: l.cap.c, h: terr[i].h, w: 10 * (l.rank + 1) }));
    const fit = fitPlane([...pts, ...samples], centre);
    base = clampGrade(fit, shape.ring ? opt.maxGradeRoundabout : opt.maxGrade);
  }
  const residual = legs.map((l, i) => terr[i].h - planeAt(base, l.cap.c));
  const planar = residual.every((r) => Math.abs(r) <= opt.tolerance);
  const legPlanes: Plane[] = legs.map((l, i) => {
    if (planar || (through && through.includes(i))) return base;
    return { o: l.cap.c, h0: terr[i].h, g: [l.cap.d[0] * terr[i].g, l.cap.d[1] * terr[i].g] };
  });
  const ring = shape.ring;
  const fall = (p: P2) => {
    if (!ring) return 0;
    const rho = Math.hypot(p[0] - ring.c[0], p[1] - ring.c[1]);
    return -opt.ringFall * (Math.max(ring.rIn, Math.min(ring.rOut, rho)) - ring.rIn);
  };
  const Dsize = Math.max(4, Math.hypot(x1 - x0, y1 - y0) / 4);
  const caps = legs.map((l) => [sub(l.cap.c, [l.cap.left[0] * l.hw, l.cap.left[1] * l.hw]), [l.cap.c[0] + l.cap.left[0] * l.hw, l.cap.c[1] + l.cap.left[1] * l.hw]] as [P2, P2]);
  const h = planar
    ? (p: P2) => planeAt(base, p) + fall(p)
    : (p: P2) => {
      let num = planeAt(base, p) / (Dsize * Dsize), den = 1 / (Dsize * Dsize);
      for (let i = 0; i < legs.length; i++) {
        const d = segDist(p, caps[i][0], caps[i][1]).d;
        if (d < 1e-6) return planeAt(legPlanes[i], p) + fall(p);
        num += planeAt(legPlanes[i], p) / (d * d);
        den += 1 / (d * d);
      }
      return num / den + fall(p);
    };
  return { node: shape.node, base, legPlanes, legTerrain: terr.map((t) => t.h), planar, ...(through ? { through } : {}), h };
}

export interface EdgeProfile {
  edge: number;
  /** Trimmed centreline, from the cap at node a to the cap at node b, every ~2 m. */
  line: P2[];
  /** Centre height and the cross-section's linear slope (rise per metre to the left) and crown, per point. */
  h: number[];
  bank: number[];
  crown: number[];
  halfWidth: number;
}

export interface EdgeEnds {
  /** Trim at each end, and the junction field there (absent = a dead end: the edge keeps its terrain). */
  a?: { trim: number; field: (p: P2) => number };
  b?: { trim: number; field: (p: P2) => number };
}

/**
 * An edge's profile: smoothed terrain, eased to each junction field over `transition` metres; the
 * crown eases out and the cross slope eases to the field's over the last `capEase` metres.
 */
export function edgeProfile(g: Graph, edge: number, ends: EdgeEnds, height: HeightAt, o: HeightOptions & { crown?: number; transition?: number; capEase?: number; step?: number } = {}): EdgeProfile {
  const e = g.edges[edge];
  const sigma = o.sigma ?? D.sigma, crown = o.crown ?? 0.02, step = o.step ?? 2;
  const cum = lengths(e.pts);
  const total = cum[cum.length - 1];
  const s0 = ends.a?.trim ?? 0, s1 = total - (ends.b?.trim ?? 0);
  const L = Math.max(0.5, s1 - s0);
  const transition = Math.min(o.transition ?? 15, L / 2);
  const capEase = Math.min(o.capEase ?? 8, L / 2);
  const terr = terrainProfile(e.pts, height, sigma);
  const n = Math.max(1, Math.round(L / step));
  const line: P2[] = [], h: number[] = [], bank: number[] = [], cr: number[] = [];
  const hw = e.width / 2;
  const capOf = (s: number) => along(e.pts, s, cum);
  // Field values at the caps: centre height and slope across (left of travel a -> b).
  const capInfo = (end: EdgeEnds["a"], s: number) => {
    if (!end) return null;
    const c = capOf(s);
    const left: P2 = [-c.d[1], c.d[0]];
    const hc = end.field(c.p);
    const slope = (end.field([c.p[0] + left[0], c.p[1] + left[1]]) - end.field([c.p[0] - left[0], c.p[1] - left[1]])) / 2;
    return { hc, slope };
  };
  const A = capInfo(ends.a, s0), B = capInfo(ends.b, s1);
  const dA = A ? A.hc - profileAt(terr, s0) : 0, dB = B ? B.hc - profileAt(terr, s1) : 0;
  for (let k = 0; k <= n; k++) {
    const s = s0 + (L * k) / n;
    line.push(capOf(s).p);
    const fa = 1 - smoothstep((s - s0) / transition), fb = 1 - smoothstep((s1 - s) / transition);
    h.push(profileAt(terr, s) + dA * fa + dB * fb);
    const ca = A ? 1 - smoothstep((s - s0) / capEase) : 0, cb = B ? 1 - smoothstep((s1 - s) / capEase) : 0;
    const w = Math.min(1, ca + cb);
    cr.push(crown * (1 - w));
    bank.push((A ? A.slope * ca : 0) + (B ? B.slope * cb : 0));
  }
  return { edge, line, h, bank, crown: cr, halfWidth: hw };
}

/** Surface height on an edge at point k, lateral offset t (positive left). */
export const edgeSurface = (pr: EdgeProfile, k: number, t: number) => pr.h[k] + pr.bank[k] * t - pr.crown[k] * Math.abs(t);
