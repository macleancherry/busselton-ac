// Busselton fork: a circuit's own dressing (raceway builds): red-white kerbs at the corners, and the
// start line with numbered grid boxes.
//
// Kerbs: corners come from the road's curvature (tighter than KERB_MAX_RADIUS for long enough to
// turn KERB_MIN_TURN), or only the corners nearest a hand-listed set (`circuitKerbs.corners`), since
// a real circuit doesn't kerb every bend. Each corner gets one on the inside round the apex and one on
// the outside at the exit, in KERB_BAND red and white bands, KERB_WIDTH wide on the outer edge of
// the asphalt, a low rounded hump KERB_HEIGHT high. They're physics (`1KERB_CIRCUIT_...`, the KERB
// surface every build declares: valid track, a little rumble). A band is left out where its inner
// edge would come within KERB_AI_CLEAR of the AI line, or across the mouth of a street (another
// layout's road leaving the circuit).
//
// The start: a thick white line across the road at the start (s = 0 on a loop) and at each grid box
// (AC_START_n) a bar across its front, short ticks back from the bar's ends and the slot's number,
// like the course marks' grid boxes (courseMarks.ts, which race layouts on town streets use instead).
//
// Frame: local ENU metres (x east, y north, z up).

import type { LngLat, Vec2 } from "./geo";
import type { Kn5GroupNode, Kn5Material, Kn5MeshNode, Kn5Texture } from "./kn5";
import { letters } from "./courseMarks";
import { material } from "./materials";
import { MeshBuilder } from "./mesh";
import { ChunkedMesh } from "./meshKit";
import { surfaceHeight, type RoadPlan } from "./road";
import { solidTexture } from "./textures";

type Vec3 = [number, number, number];

/** `circuitKerbs` (options.ts): on for raceway builds unless false. */
export type CircuitKerbsOption = boolean | {
  /** Corners tighter than this radius get kerbs, m (default KERB_MAX_RADIUS). */
  maxRadius?: number;
  /** Only the corners nearest these points, [lng, lat] (each within CORNER_REACH of the corner). */
  corners?: LngLat[];
};

export const KERB_WIDTH = 1.0;
export const KERB_HEIGHT = 0.04;
export const KERB_BAND = 1.0;
/** A corner: tighter than this, m... */
export const KERB_MAX_RADIUS = 60;
/** ...turning at least this much, radians (25 degrees). */
export const KERB_MIN_TURN = (25 * Math.PI) / 180;
/** A kerb's inner edge stays this far from the AI line, m. */
export const KERB_AI_CLEAR = 1.2;
/** The outside kerb runs on past the end of the corner by this, m. */
export const EXIT_RUN = 15;
/** A hand-listed corner point is at most this far from the corner's apex, m. */
export const CORNER_REACH = 40;
/** Same-hand bends closer than this are one corner, m. */
const MERGE_GAP = 8;
/** Kerbs and paint sit this much over the road. */
const PAINT_LIFT = 0.012;

/** A corner of the road: sample indices (wrapping on a loop, so `to` may be less than `from`). */
export interface Corner {
  from: number;
  to: number;
  apex: number;
  /** 1: a left-hander (inside on the left); -1 a right-hander. */
  side: 1 | -1;
  /** How far it turns, radians. */
  turn: number;
}

/** A kerb: on `side` (1 left) of the road from s0 to s1 metres along it (s1 > s0; past the lap on a loop). */
export interface KerbRun {
  side: 1 | -1;
  s0: number;
  s1: number;
  /** Inside the corner (round the apex) or outside (at the exit). */
  inside: boolean;
}

/** The kerbs setting from the option and whether the build is a circuit; null when off. */
export function circuitKerbsSettings(opt: CircuitKerbsOption | undefined, raceway: boolean): { maxRadius: number; corners?: LngLat[] } | null {
  if (opt === false || (opt === undefined && !raceway)) return null;
  const o = typeof opt === "object" ? opt : {};
  return { maxRadius: o.maxRadius ?? KERB_MAX_RADIUS, ...(o.corners?.length ? { corners: o.corners } : {}) };
}

/**
 * The corners in a curvature list (1/m, positive = left-hand), samples `spacing` apart: runs where
 * the curvature, averaged over about 12 m, is tighter than 1 / maxRadius, same-hand runs under
 * MERGE_GAP apart joined, kept when they turn at least KERB_MIN_TURN.
 */
export function findCorners(curvature: number[], spacing: number, closed: boolean, maxRadius = KERB_MAX_RADIUS): Corner[] {
  const n = curvature.length;
  if (n < 3) return [];
  const w = Math.max(1, Math.round(6 / spacing));
  const at = (i: number) => (closed ? curvature[((i % n) + n) % n] : curvature[Math.max(0, Math.min(n - 1, i))]);
  const smooth = curvature.map((_, i) => {
    let sum = 0;
    for (let k = -w; k <= w; k++) sum += at(i + k);
    return sum / (2 * w + 1);
  });
  const sign = smooth.map((k) => (Math.abs(k) > 1 / maxRadius ? (Math.sign(k) as 1 | -1) : 0));
  // On a loop, start the scan at the longest stretch with no corner, so a corner over the start
  // (and a short dip in one) isn't split.
  let start = 0;
  if (closed) {
    if (!sign.includes(0)) return [];
    let best = -1, bestLen = 0;
    const first = sign.findIndex((v) => v !== 0);
    if (first < 0) return [];
    for (let k = 0, run = 0, runStart = 0; k <= n; k++) {
      const i = (first + k) % n;
      if (k < n && sign[i] === 0) { if (run === 0) runStart = i; run++; continue; }
      if (run > bestLen) { bestLen = run; best = runStart; }
      run = 0;
    }
    start = best;
  }
  const runs: { from: number; to: number; side: 1 | -1 }[] = []; // unwrapped indices
  for (let k = 0; k < n; k++) {
    const i = start + k, v = sign[i % n];
    if (v === 0) continue;
    const last = runs[runs.length - 1];
    if (last && last.side === v && i - last.to <= Math.round(MERGE_GAP / spacing) + 1) last.to = i;
    else runs.push({ from: i, to: i, side: v as 1 | -1 });
  }
  const out: Corner[] = [];
  for (const r of runs) {
    let turn = 0, apex = r.from;
    for (let i = r.from; i <= r.to; i++) {
      turn += Math.abs(at(i)) * spacing;
      if (Math.abs(smooth[i % n]) > Math.abs(smooth[apex % n])) apex = i;
    }
    if (turn < KERB_MIN_TURN) continue;
    out.push({ from: r.from % n, to: r.to % n, apex: apex % n, side: r.side, turn });
  }
  return out;
}

/** The corners nearest each of `wanted` (local metres; apex within `reach`), each once, in road order. */
export function pickCorners(corners: Corner[], pos: Vec2[], wanted: Vec2[], reach = CORNER_REACH): Corner[] {
  const keep = new Set<number>();
  for (const q of wanted) {
    let best = -1, bestD = reach;
    corners.forEach((c, k) => {
      const d = Math.hypot(pos[c.apex][0] - q[0], pos[c.apex][1] - q[1]);
      if (d <= bestD) { bestD = d; best = k; }
    });
    if (best >= 0) keep.add(best);
  }
  return corners.filter((_, k) => keep.has(k));
}

/**
 * A corner's kerbs, metres along a road of samples `s` (length `L` on a loop): inside, from three
 * quarters of the way from the turn-in to the apex on to as far past it, at least 6 m either side;
 * outside, from halfway between the apex and the corner's end to EXIT_RUN past the end.
 */
export function kerbRuns(c: Corner, s: number[], L: number, closed: boolean): KerbRun[] {
  const unwrap = (i: number, ref: number) => (closed && i < ref ? s[i] + L : s[i]);
  const s0 = s[c.from], sa = unwrap(c.apex, c.from), s1 = unwrap(c.to, c.from);
  const end = closed ? Infinity : s[s.length - 1];
  const clip = (a: number, b: number) => [Math.max(closed ? -Infinity : 0, a), Math.min(end, b)];
  const [i0, i1] = clip(sa - Math.max(6, 0.75 * (sa - s0)), sa + Math.max(6, 0.75 * (s1 - sa)));
  const [o0, o1] = clip(sa + 0.5 * (s1 - sa), s1 + EXIT_RUN);
  const out: KerbRun[] = [];
  if (i1 - i0 >= KERB_BAND) out.push({ side: c.side, s0: i0, s1: i1, inside: true });
  if (o1 - o0 >= KERB_BAND) out.push({ side: (-c.side) as 1 | -1, s0: o0, s1: o1, inside: false });
  return out;
}

/** The road's frame at `s` metres along it, between samples. */
function frameAt(plan: RoadPlan, s: number): { pos: Vec2; left: Vec2; width: number; height: (t: number, crown: number) => number } {
  const smp = plan.samples, n = smp.length;
  if (plan.closed) s = ((s % plan.length) + plan.length) % plan.length;
  else s = Math.max(0, Math.min(smp[n - 1].s, s));
  let i = Math.max(0, Math.min(n - 1, Math.floor((s / (plan.closed ? plan.length : smp[n - 1].s || 1)) * (n - (plan.closed ? 0 : 1)))));
  while (i > 0 && smp[i].s > s) i--;
  while (i < n - 1 && smp[i + 1].s <= s) i++;
  const a = smp[i], b = i + 1 < n ? smp[i + 1] : plan.closed ? smp[0] : a;
  const segEnd = i + 1 < n ? b.s : plan.length;
  const f = b === a || segEnd <= a.s ? 0 : Math.max(0, Math.min(1, (s - a.s) / (segEnd - a.s)));
  const lx = a.left[0] + (b.left[0] - a.left[0]) * f, ly = a.left[1] + (b.left[1] - a.left[1]) * f, ll = Math.hypot(lx, ly) || 1;
  return {
    pos: [a.pos[0] + (b.pos[0] - a.pos[0]) * f, a.pos[1] + (b.pos[1] - a.pos[1]) * f],
    left: [lx / ll, ly / ll],
    width: a.width + (b.width - a.width) * f,
    height: (t, crown) => surfaceHeight(a, t, crown) * (1 - f) + surfaceHeight(b, t, crown) * f,
  };
}

/** The kerb's cross-section, from its inner edge outwards (across, up): a rounded hump with a low outer lip. */
const PROFILE: Vec2[] = [[0, 0], [0.2, 0.75 * KERB_HEIGHT], [0.4, KERB_HEIGHT], [KERB_WIDTH - 0.05, KERB_HEIGHT], [KERB_WIDTH, 0.5 * KERB_HEIGHT]];

/** A quad with its own vertices and a flat normal, wound to face up (or outwards for a near-vertical face). */
function quad(mb: MeshBuilder, p: Vec3[], up: Vec3): void {
  const u: Vec3 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const v: Vec3 = [p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]];
  let nrm: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...nrm);
  if (l < 1e-9) return;
  let list = p;
  if (nrm[0] * up[0] + nrm[1] * up[1] + nrm[2] * up[2] < 0) { list = [p[0], p[3], p[2], p[1]]; nrm = [-nrm[0], -nrm[1], -nrm[2]]; }
  const ids = list.map((q) => mb.vertex(q, 0, 0));
  for (let k = 0; k < 4; k++) mb.normals!.push(nrm[0] / l, nrm[1] / l, nrm[2] / l);
  mb.tri(ids[0], ids[1], ids[2]);
  mb.tri(ids[0], ids[2], ids[3]);
}

export interface KerbInput {
  /** AI line's offset left of the centreline per sample (keep left), m; absent = on the centreline. */
  aiOffset?: number[];
  /** A street's mouth on that side at s: no kerb across it. */
  mouth?: (side: 1 | -1, s: number) => boolean;
  /** Hand-listed corners, local metres. */
  corners?: Vec2[];
  maxRadius?: number;
  crown: number;
}

/** The kerbs' meshes for a plan, and the runs laid (for the checks and tests). */
export function circuitKerbs(plan: RoadPlan, input: KerbInput): { nodes: Kn5MeshNode[]; runs: KerbRun[]; corners: Corner[]; bands: number } {
  const smp = plan.samples, n = smp.length;
  if (n < 3) return { nodes: [], runs: [], corners: [], bands: 0 };
  const spacing = (plan.closed ? plan.length : smp[n - 1].s) / (plan.closed ? n : n - 1);
  let corners = findCorners(smp.map((p) => p.curvature), spacing, plan.closed, input.maxRadius);
  if (input.corners?.length) corners = pickCorners(corners, smp.map((p) => p.pos), input.corners);
  const s = smp.map((p) => p.s);
  const runs = corners.flatMap((c) => kerbRuns(c, s, plan.length, plan.closed));
  const meshes = { red: new ChunkedMesh(), white: new ChunkedMesh() };
  const offAt = (sd: number) => {
    if (!input.aiOffset) return 0;
    const k = Math.round(((plan.closed ? ((sd % plan.length) + plan.length) % plan.length : sd) / spacing));
    return input.aiOffset[Math.max(0, Math.min(n - 1, plan.closed ? k % n : k))] ?? 0;
  };
  let bands = 0;
  for (const r of runs) {
    const count = Math.max(1, Math.round((r.s1 - r.s0) / KERB_BAND));
    const len = (r.s1 - r.s0) / count;
    for (let b = 0; b < count; b++) {
      const a = r.s0 + b * len, e = a + len, mid = (a + e) / 2;
      const f = frameAt(plan, mid);
      const inner = f.width / 2 - KERB_WIDTH;
      // The inner edge's distance from the AI line (offset left of the centreline).
      if (inner - r.side * offAt(mid) < KERB_AI_CLEAR) continue;
      if (input.mouth?.(r.side, ((mid % plan.length) + plan.length) % plan.length)) continue;
      const mb = meshes[b % 2 ? "white" : "red"].next(64);
      // Two stations a band (it follows the bend), each the profile across.
      const stations = [a + 0.005, mid, e - 0.005].map((sd) => {
        const fr = frameAt(plan, sd);
        const t0 = fr.width / 2 - KERB_WIDTH;
        return PROFILE.map(([u, v]): Vec3 => {
          const t = r.side * (t0 + u);
          return [fr.pos[0] + fr.left[0] * t, fr.pos[1] + fr.left[1] * t, fr.height(t, input.crown) + v - 0.005];
        });
      });
      for (let k = 0; k + 1 < stations.length; k++) {
        const p = stations[k], q = stations[k + 1];
        for (let j = 0; j + 1 < PROFILE.length; j++) quad(mb, [p[j], q[j], q[j + 1], p[j + 1]], [0, 0, 1]);
      }
      // The band's ends, as fans of the profile, so a gap left for the AI line has no open hole.
      for (const [st, dir] of [[stations[0], -1], [stations[stations.length - 1], 1]] as const) {
        const fr = frameAt(plan, dir < 0 ? a : e);
        const tan: Vec3 = [-fr.left[1] * dir, fr.left[0] * dir, 0];
        for (let j = 1; j + 1 < st.length; j++) {
          const base: Vec3[] = [st[0], st[j], st[j + 1]];
          const ids = base.map((q) => mb.vertex(q, 0, 0));
          for (let k = 0; k < 3; k++) mb.normals!.push(...tan);
          const u: Vec3 = [base[1][0] - base[0][0], base[1][1] - base[0][1], base[1][2] - base[0][2]];
          const v: Vec3 = [base[2][0] - base[0][0], base[2][1] - base[0][1], base[2][2] - base[0][2]];
          const cr: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
          if (cr[0] * tan[0] + cr[1] * tan[1] + cr[2] * tan[2] >= 0) mb.tri(ids[0], ids[1], ids[2]);
          else mb.tri(ids[0], ids[2], ids[1]);
        }
      }
      bands++;
    }
  }
  const nodes: Kn5MeshNode[] = [];
  for (const paint of ["red", "white"] as const) {
    meshes[paint].all().forEach((b, k) => nodes.push(b.toKn5(`1KERB_CIRCUIT_${paint.toUpperCase()}_${k}`, `circuit_${paint}`)));
  }
  return { nodes, runs, corners, bands };
}

// ---------------------------------------------------------------------------------------------
// The start line and grid boxes

/** Grid box paint: a bar across the front of the slot, ticks back from its ends, the number ahead. */
export const GRID_BOX = { width: 2.4, line: 0.15, ticks: 1.2, ahead: 2.4, number: 0.8 };
/** The start line's depth, m. */
export const START_LINE = 0.6;

/** Road surface height near a point: the nearest sample's surface, at the point's offset across it. */
function roadHeight(plan: RoadPlan, crown: number): (p: Vec2) => number {
  const smp = plan.samples;
  return (p) => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < smp.length; i++) {
      const d = (smp[i].pos[0] - p[0]) ** 2 + (smp[i].pos[1] - p[1]) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    const a = smp[best];
    return surfaceHeight(a, (p[0] - a.pos[0]) * a.left[0] + (p[1] - a.pos[1]) * a.left[1], crown);
  };
}

/** A flat painted rectangle centred at c, `along` deep in direction d and `across` wide, on the road. */
function paintRect(mb: MeshBuilder, h: (p: Vec2) => number, c: Vec2, d: Vec2, along: number, across: number): void {
  const l: Vec2 = [-d[1], d[0]];
  const steps = Math.max(1, Math.ceil(across / 1));
  for (let k = 0; k < steps; k++) {
    const u0 = -across / 2 + (across * k) / steps, u1 = -across / 2 + (across * (k + 1)) / steps;
    const pts = [[-along / 2, u0], [along / 2, u0], [along / 2, u1], [-along / 2, u1]].map(([a, u]): Vec3 => {
      const q: Vec2 = [c[0] + d[0] * a + l[0] * u, c[1] + d[1] * a + l[1] * u];
      return [q[0], q[1], h(q) + PAINT_LIFT];
    });
    quad(mb, pts, [0, 0, 1]);
  }
}

/**
 * The start line across the road at `startS` (null: none) and a numbered box at each AC_START_n
 * in `dummies` (their AC transforms: position in 12..14, forward in 8..10).
 */
export function gridPaint(plan: RoadPlan, dummies: Kn5GroupNode[], startS: number | null, crown: number): { nodes: Kn5MeshNode[]; boxes: number } {
  const h = roadHeight(plan, crown);
  const paint = new ChunkedMesh();
  if (startS !== null && plan.samples.length > 1) {
    const f = frameAt(plan, startS);
    paintRect(paint.next(4 * Math.ceil(f.width) + 8), h, f.pos, [f.left[1], -f.left[0]], START_LINE, f.width - 0.3);
  }
  const starts = dummies
    .map((d) => ({ d, m: /^AC_START_(\d+)$/.exec(d.name) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(a.m![1]) - Number(b.m![1]));
  for (const { d, m } of starts) {
    const pos: Vec2 = [d.transform[12], -d.transform[14]];
    const fl = Math.hypot(d.transform[8], d.transform[10]) || 1;
    const fwd: Vec2 = [d.transform[8] / fl, -d.transform[10] / fl];
    const side: Vec2 = [-fwd[1], fwd[0]];
    const front: Vec2 = [pos[0] + fwd[0] * GRID_BOX.ahead, pos[1] + fwd[1] * GRID_BOX.ahead];
    paintRect(paint.next(24), h, front, fwd, GRID_BOX.line, GRID_BOX.width);
    for (const sgn of [1, -1]) {
      const off = sgn * (GRID_BOX.width / 2 - GRID_BOX.line / 2);
      const c: Vec2 = [front[0] + side[0] * off - fwd[0] * GRID_BOX.ticks / 2, front[1] + side[1] * off - fwd[1] * GRID_BOX.ticks / 2];
      paintRect(paint.next(8), h, c, fwd, GRID_BOX.ticks, GRID_BOX.line);
    }
    // The slot's number just ahead of the bar, reading for the driver in the box.
    const at0: Vec2 = [front[0] + fwd[0] * 0.8, front[1] + fwd[1] * 0.8];
    const right: Vec2 = [fwd[1], -fwd[0]];
    const mb = paint.next(400);
    letters(mb, String(Number(m![1]) + 1), GRID_BOX.number, 0.12, (u, v) => {
      const q: Vec2 = [at0[0] + right[0] * u + fwd[0] * v, at0[1] + right[1] * u + fwd[1] * v];
      return [q[0], q[1], h(q) + PAINT_LIFT];
    }, [0, 0, 1]);
  }
  const nodes = paint.all().map((b, k) => b.toKn5(`CIRCUIT_PAINT_${k}`, "circuit_paint", { castShadows: false }));
  return { nodes, boxes: starts.length };
}

/** Materials and textures the circuit dressing uses (red and white kerbs, white paint). */
export function circuitMaterials(): { materials: Kn5Material[]; textures: Kn5Texture[] } {
  const light = { ambient: 0.45, diffuse: 0.45, specular: 0.1, exp: 20 };
  const list: [string, readonly [number, number, number]][] = [["circuit_red", [200, 20, 20]], ["circuit_white", [236, 236, 230]], ["circuit_paint", [236, 236, 230]]];
  return {
    materials: list.map(([name]) => material(name, `${name}.png`, light)),
    textures: list.map(([name, rgb]) => ({ name: `${name}.png`, data: solidTexture(rgb) })),
  };
}
