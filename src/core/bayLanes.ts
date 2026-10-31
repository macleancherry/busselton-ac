// Busselton fork: traffic lanes and the keep-left AI line clear of painted kerbside bays.
//
// kerbside.ts paints parking bays along a street's kerb (parallel 2.1 m deep, angle bays deeper) and
// parkedPlacement.ts puts cars in them. The traffic lanes (traffic.ts) used to run a fixed distance
// from the centreline, through the bays on narrow two-way streets, so parkedClear.ts dropped most of
// those cars (a car can't sit in a traffic lane). Here each bay is a box (the space its car takes,
// or the painted bay, whichever reaches further into the street); a road's lanes keep LANE_HALF
// (half a lane, the same figure parkedClear.ts uses) from the boxes on each side:
//
//  - the lanes on a bay's side move in, as a set, until they clear it;
//  - if that crowds them into the lanes the other way (two-way lanes closer than 2.8 m), those move
//    over too, as far as half a lane from their own side's bays or kerb; one-way lanes that can't
//    all clear are spread evenly between the bays, 3 m a lane or more;
//  - where even that doesn't fit, the lanes stay where they were: kerbside.ts drops bays that
//    leave no room for the lanes, and a car in a bay too close to a lane is still dropped.
//
// Shifts ease in and out along the road (RAMP) so a lane is already clear where the bays start.
// The keep-left AI line (keepLeft.ts) uses the same bands for the route's own bays.

import type { Vec2 } from "./geo";
import { CAR_LENGTH, LANE_HALF } from "./parkedClear";

/** The space one painted bay (and the car in it) takes, local metres. */
export interface BayBox {
  /** Middle of the box. */
  c: Vec2;
  /** Unit vector along the street (the box's long side runs this way). */
  along: Vec2;
  /** Half its length along the street, metres. */
  halfLen: number;
  /** Half its depth across the street, metres. */
  halfDepth: number;
  /** Which carriageway kerbside.ts painted it on (0: the route). */
  street: number;
}

/** A lane centreline keeps this far from a bay box: half a lane. */
export const LANE_CLEAR = LANE_HALF;
/** The narrowest lanes once moved: two-way, one-way, metres. */
export const MIN_LANE_TWO_WAY = 2.8;
export const MIN_LANE_ONE_WAY = 3;
/** Sideways shift per metre along the road as a lane eases round bays (1 m over about 7 m). */
export const RAMP = 0.15;
/** Bays this much off the road's own direction (|cos| below) are another street's. */
const PARALLEL = 0.8;

/** Per point of a road: the furthest a lane may reach left (hi) and right (lo) of the centreline before a bay, metres; null where no bay. */
export interface BayBand {
  lo: (number | null)[];
  hi: (number | null)[];
}

/** A grid of boxes by their middles, for nearby lookups. */
class BoxGrid {
  private cells = new Map<string, number[]>();
  constructor(readonly boxes: BayBox[], private readonly cell = 20) {
    boxes.forEach((b, i) => {
      const k = `${Math.floor(b.c[0] / cell)},${Math.floor(b.c[1] / cell)}`;
      (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(i);
    });
  }
  near(x: number, y: number, r: number): BayBox[] {
    const out: BayBox[] = [], c = this.cell;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((y - r) / c); j <= Math.floor((y + r) / c); j++)
        for (const k of this.cells.get(`${i},${j}`) ?? []) out.push(this.boxes[k]);
    return out;
  }
}

/**
 * The bay band along a road (centreline `pts`, asphalt `width` per point or for all, `closed` for a
 * circuit), sides relative to the points' order (+ left). Null when no bay lies along it.
 */
export function bayBand(pts: Vec2[], width: number | number[], boxes: BayBox[], closed = false, grid?: BoxGrid): BayBand | null {
  const n = pts.length;
  if (n < 2 || !boxes.length) return null;
  const g = grid ?? new BoxGrid(boxes);
  const w = (i: number) => (typeof width === "number" ? width : width[i]);
  const lo = new Array<number>(n).fill(-Infinity), hi = new Array<number>(n).fill(Infinity);
  let any = false;
  for (let i = 0; i < n; i++) {
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-9) continue;
    const d: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], nrm: Vec2 = [-d[1], d[0]];
    const p = pts[i], half = w(i) / 2;
    for (const box of g.near(p[0], p[1], half + 12)) {
      if (Math.abs(box.along[0] * d[0] + box.along[1] * d[1]) < PARALLEL) continue;
      const rx = box.c[0] - p[0], ry = box.c[1] - p[1];
      const s = rx * d[0] + ry * d[1], t = rx * nrm[0] + ry * nrm[1];
      // A car on the lane reaches half its length either way: clear of the bay from there.
      if (Math.abs(s) > box.halfLen + CAR_LENGTH / 2 || Math.abs(t) > half + 1) continue;
      if (t >= 0) hi[i] = Math.min(hi[i], t - box.halfDepth);
      else lo[i] = Math.max(lo[i], t + box.halfDepth);
      any = true;
    }
  }
  if (!any) return null;
  // Ease: no edge moves in faster than RAMP per metre along (both ways, twice round a circuit).
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const gap = (i: number, j: number) => (closed && Math.abs(i - j) === n - 1 ? Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) : Math.abs(cum[i] - cum[j]));
  const passes = closed ? 2 : 1;
  for (let p = 0; p < passes; p++) {
    for (let k = 1; k < n + (closed ? 1 : 0); k++) {
      const i = k % n, j = k - 1;
      hi[i] = Math.min(hi[i], hi[j] + RAMP * gap(i, j));
      lo[i] = Math.max(lo[i], lo[j] - RAMP * gap(i, j));
    }
    for (let k = n - 2 + (closed ? 1 : 0); k >= 0; k--) {
      const i = k, j = (k + 1) % n;
      hi[i] = Math.min(hi[i], hi[j] + RAMP * gap(i, j));
      lo[i] = Math.max(lo[i], lo[j] - RAMP * gap(i, j));
    }
  }
  return { lo: lo.map((v) => (Number.isFinite(v) ? +v.toFixed(3) : null)), hi: hi.map((v) => (Number.isFinite(v) ? +v.toFixed(3) : null)) };
}

/**
 * Lane offsets at one point (metres left of the road's direction; two-way lanes: positive the
 * forward ones, negative the ones back) moved clear of the bays: `lo`/`hi` the bay edges (null:
 * none), `half` half the road's width. See the header for the rule.
 */
export function clearOffsets(offs: number[], lo: number | null, hi: number | null, half: number, oneway: boolean): number[] {
  if (!offs.length) return offs;
  const top = hi === null ? Infinity : hi - LANE_CLEAR, bottom = lo === null ? -Infinity : lo + LANE_CLEAR;
  if (offs.every((o) => o <= top + 1e-9 && o >= bottom - 1e-9)) return offs;
  const minLane = oneway ? MIN_LANE_ONE_WAY : MIN_LANE_TWO_WAY;
  // Between the bays (or the kerbs).
  const a = lo === null ? -half : Math.max(-half, lo), b = hi === null ? half : Math.min(half, hi);
  const inside = (m: number[]) => m.every((o) => o <= top + 1e-9 && o >= bottom - 1e-9);
  if (oneway) {
    const down = Math.max(0, Math.max(...offs) - top), up = Math.max(0, bottom - Math.min(...offs));
    const moved = offs.map((o) => o - down + up);
    if (inside(moved)) return moved;
  } else {
    // Each way's lanes move in off its own side's bays, as a set.
    const fwd = offs.filter((o) => o > 0), back = offs.filter((o) => o <= 0);
    const down = fwd.length ? Math.max(0, Math.max(...fwd) - top) : 0;
    const up = back.length ? Math.max(0, bottom - Math.min(...back)) : 0;
    let moveF = -down, moveB = up;
    if (fwd.length && back.length) {
      // Crowding the lanes the other way: those move over too, as far as their own side allows
      // (half a lane from the bays or kerb there), so the shift grows smoothly as the bays deepen.
      const gapWas = Math.min(...fwd) - Math.max(...back);
      let short = Math.min(minLane, gapWas) - (Math.min(...fwd) + moveF - (Math.max(...back) + moveB));
      if (short > 1e-9) {
        const roomB = Math.min(...back) + moveB - Math.max(bottom, a + minLane / 2);
        const take = Math.min(short, Math.max(0, roomB));
        moveB -= take;
        short -= take;
      }
      if (short > 1e-9) {
        const roomF = Math.min(top, b - minLane / 2) - (Math.max(...fwd) + moveF);
        const take = Math.min(short, Math.max(0, roomF));
        moveF += take;
        short -= take;
      }
      if (short > 1e-9) return offs;
    }
    const moved = offs.map((o) => (o > 0 ? o + moveF : o + moveB));
    return inside(moved) ? moved : offs;
  }
  // One-way lanes that can't all clear by moving: evenly over the room between the bays.
  const lw = (b - a) / offs.length;
  if (lw < minLane - 1e-9) return offs;
  const order = offs.map((o, i) => [o, i] as const).sort((p, q) => p[0] - q[0]);
  const out = offs.slice();
  order.forEach(([, i], j) => { out[i] = a + lw * (j + 0.5); });
  return out;
}

/** Each road with its bay band (`bayLo`/`bayHi`) where bays lie along it. */
export function withBayBands<R extends { pts: Vec2[]; width: number; closed?: boolean }>(roads: R[], boxes: BayBox[]): (R & { bayLo?: (number | null)[]; bayHi?: (number | null)[] })[] {
  if (!boxes.length) return roads;
  const grid = new BoxGrid(boxes);
  return roads.map((r) => {
    const band = bayBand(r.pts, r.width, boxes, !!r.closed, grid);
    return band ? { ...r, bayLo: band.lo, bayHi: band.hi } : r;
  });
}

/* ---------------- the check ---------------- */

/** A car on a lane reaches this far either side of its centreline (half a car and 10 cm). */
export const LANE_BODY = 1.0;

/** Distance from p to triangle abc in the plane (0 inside). */
function distTri(p: Vec2, a: Vec2, b: Vec2, c: Vec2): number {
  const cross = (u: Vec2, v: Vec2, w: Vec2) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
  if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) return 0;
  const seg = (u: Vec2, v: Vec2) => {
    const dx = v[0] - u[0], dy = v[1] - u[1], L2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / L2));
    return Math.hypot(p[0] - u[0] - dx * t, p[1] - u[1] - dy * t);
  };
  return Math.min(seg(a, b), seg(b, c), seg(c, a));
}

/**
 * Lane points (every half metre along each lane) whose car (LANE_BODY either side) would run over
 * painted bay lines: `paint` is the bay paint's triangles and `lanes` the lanes' centrelines, all
 * in one plane (local metres). Bay lines run across each bay to its inner edge, so a car on a lane
 * through bays always crosses them.
 */
export function lanesOverBays(lanes: Vec2[][], paint: [Vec2, Vec2, Vec2][], reach = LANE_BODY): { at: Vec2; lane: number }[] {
  const cell = 4, grid = new Map<string, number[]>();
  paint.forEach((t, i) => {
    const xs = t.map((p) => p[0]), ys = t.map((p) => p[1]);
    for (let x = Math.floor(Math.min(...xs) / cell); x <= Math.floor(Math.max(...xs) / cell); x++)
      for (let y = Math.floor(Math.min(...ys) / cell); y <= Math.floor(Math.max(...ys) / cell); y++) {
        const k = `${x},${y}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
      }
  });
  const out: { at: Vec2; lane: number }[] = [];
  lanes.forEach((pts, li) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(L / 0.5));
      for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
        const p: Vec2 = [a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps];
        let hit = false;
        for (let x = Math.floor((p[0] - reach) / cell); x <= Math.floor((p[0] + reach) / cell) && !hit; x++)
          for (let y = Math.floor((p[1] - reach) / cell); y <= Math.floor((p[1] + reach) / cell) && !hit; y++)
            for (const k of grid.get(`${x},${y}`) ?? []) if (distTri(p, ...paint[k]) < reach) { hit = true; break; }
        if (hit) out.push({ at: p, lane: li });
      }
    }
  });
  return out;
}
