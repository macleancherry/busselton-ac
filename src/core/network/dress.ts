// Kerbs, verges, islands and give-way lines of a ribbon-capped junction (phase 1: simple, no gaps).
// A kerb runs along the outline between two caps, as the route's own kerb profile (gutter, face, top,
// nature strip and skirt) so it meets the route's kerb at a route cap exactly; where it meets an
// unkerbed street it ramps down to nothing over the last 1.5 m. Unkerbed runs beside the route get
// the route's verge profile. Islands (the roundabout's centre, splitters, medians) get a kerb inward
// and a raised top.

import earcut from "earcut";
import { add, dist, dot, leftOf, mul, ringArea, sub, unit, type P2 } from "./geom";
import type { Outline } from "./outline";
import type { RJunction } from "./ribbons";

// The route kerb's profile (kerbs.ts): gutter 0.3 m with a 3 cm dip, a 5 cm face run, 15 cm top,
// 15 cm high, the strip 2 cm above the kerb top, an 80 cm skirt; the verge drops 20 cm.
export const KERB = { gutter: 0.3, faceRun: 0.05, top: 0.15, height: 0.15, dip: 0.03, stripRise: 0.02, skirt: 0.8, vergeDrop: 0.2 };
export const KERB_BACK = KERB.gutter + KERB.faceRun + KERB.top;
const RAMP = 1.5;
export const PAINT_LIFT = 0.015;

export interface Builder {
  vertex(p: [number, number, number], u: number, v: number): number;
  tri(a: number, b: number, c: number): void;
  readonly vertexCount: number;
}

export interface DressSinks {
  gutter: Builder;
  kerb: Builder;
  strip: Builder;
  verge: Builder;
  island: Builder;
  islandTop: Builder;
  paint: Builder;
}

export interface DressOptions {
  /** Route kerb amount at a row and side (1 left, -1 right). */
  routeKerb: (row: number, side: 1 | -1) => number;
  /** Strip width behind the kerb from the road edge (vergeWidth + STRIP_EXTRA), and the verge's width. */
  stripOut: number;
  vergeWidth: number;
  /** The roundabout is kerbed all round. */
  ringKerbed: boolean;
  /** Paint give-way lines. */
  markings: boolean;
  /** Phase 2: room from a point on the outline to the asphalt of a street that isn't one of the legs (a
   * street clipped at the junction): kerbs and verges stop short of it. */
  clear?: (p: P2) => number;
  /** Phase 2: a street leg's corner is kerbed (the street is). */
  streetKerb?: (leg: number) => number;
}

type V3 = [number, number, number];

export function orientedQuad(b: Builder, p: V3[], uv: [number, number][], want: V3) {
  const ids = p.map((q, i) => b.vertex(q, uv[i][0], uv[i][1]));
  const tri = (i: number, j: number, k: number) => {
    const A = p[i], B = p[j], C = p[k];
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-9) return;
    if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] >= 0) b.tri(ids[i], ids[j], ids[k]);
    else b.tri(ids[i], ids[k], ids[j]);
  };
  tri(0, 1, 2);
  tri(0, 2, 3);
}

/** Outward normals (away from the road) along an open run, mitred; the ends given. */
export function runNormals(run: P2[], n0: P2, n1: P2): P2[] {
  return run.map((p, m) => {
    if (m === 0) return n0;
    if (m === run.length - 1) return n1;
    const a = unit(sub(p, run[m - 1])), b = unit(sub(run[m + 1], p));
    const na: P2 = [a[1], -a[0]], nb: P2 = [b[1], -b[0]];
    const s = unit(add(na, nb));
    const c = Math.max(0.5, dot(s, na));
    return mul(s, 1 / c);
  });
}

/** Room behind the road edge before offsets fold, per run vertex (inside a right turn of the outline). */
function room(run: P2[]): number[] {
  const r = run.map((p, m) => {
    if (m === 0 || m === run.length - 1) return Infinity;
    const a = sub(p, run[m - 1]), b = sub(run[m + 1], p);
    const turn = Math.atan2(a[0] * b[1] - a[1] * b[0], dot(a, b));
    if (turn >= -1e-3) return Infinity;
    return ((Math.hypot(...a) + Math.hypot(...b)) / 2) / -turn;
  });
  return r.map((_, m) => Math.min(...r.slice(Math.max(0, m - 3), m + 4)));
}

/** A band along a run: profile points (t from the road edge, z above the road) per vertex, outside to road. */
export function band(sinks: Builder[], run: P2[], normals: P2[], z: number[], prof: (m: number) => [number, number][], arc: number[]) {
  const rows = run.map((p, m) => prof(m).map(([t, dz]) => [p[0] + normals[m][0] * t, p[1] + normals[m][1] * t, z[m] + dz] as V3));
  const nSeg = rows[0].length - 1;
  for (let g = 0; g < nSeg; g++) {
    const sink = sinks[g];
    for (let m = 0; m < run.length - 1; m++) {
      const a0 = rows[m][g], a1 = rows[m][g + 1], b0 = rows[m + 1][g], b1 = rows[m + 1][g + 1];
      const pr = prof(m);
      const dt = pr[g + 1][0] - pr[g][0], dz = pr[g + 1][1] - pr[g][1];
      const nn = normals[m];
      const want: V3 = [nn[0] * dz, nn[1] * dz, -dt];
      if (Math.abs(dt) < 1e-6 && Math.abs(dz) < 1e-6) continue;
      orientedQuad(sink, [a0, a1, b1, b0], [[g / nSeg, arc[m] / 3], [(g + 1) / nSeg, arc[m] / 3], [(g + 1) / nSeg, arc[m + 1] / 3], [g / nSeg, arc[m + 1] / 3]], want);
    }
  }
}

export const kerbProfile = (k: number, tOut: number, drop: number): [number, number][] => {
  const top = KERB.height * k, inv = -KERB.dip * k;
  const zOut = top + KERB.stripRise * k - drop * (1 - k);
  return [
    [tOut, zOut - KERB.skirt], [tOut, zOut], [KERB_BACK * k, top], [(KERB.gutter + KERB.faceRun) * k, top], [KERB.gutter * k, inv], [0, 0],
  ];
};

export interface DressJunction {
  j: RJunction;
  outline: Outline;
  h: (p: P2) => number;
  /** Heights of the outline's cap vertices (exact ribbon heights). */
  capZ: (ci: number, p: P2) => number;
  through?: [number, number];
}

export function dressJunction(dj: DressJunction, sinks: DressSinks, o: DressOptions): { kerbRuns: number; vergeRuns: number } {
  const { j, outline } = dj;
  const legs = j.legs;
  const N = outline.outer.length;
  const zAt = (idx: number) => {
    const p = outline.outer[idx], ci = outline.capOf[idx];
    return ci >= 0 ? dj.capZ(ci, p) : dj.h(p);
  };
  let kerbRuns = 0, vergeRuns = 0;
  // Kerb amount at a leg's corner: its left corner (end of its cap) or right corner (start).
  const cornerKerb = (li: number, leftCorner: boolean): number => {
    const l = legs[li];
    if (l.kind !== "route") return o.streetKerb?.(li) ?? 0;
    const side: 1 | -1 = (leftCorner ? l.dir : -l.dir) as 1 | -1;
    return o.routeKerb(l.at, side);
  };
  // Runs: from the last vertex of one cap to the first of the next.
  const capStarts: number[] = [];
  for (let i = 0; i < N; i++) if (outline.capOf[i] >= 0 && outline.capOf[(i - 1 + N) % N] !== outline.capOf[i]) capStarts.push(i);
  for (const cs of capStarts) {
    const ci = outline.capOf[cs];
    let e = cs;
    while (outline.capOf[(e + 1) % N] === ci) e = (e + 1) % N;
    // e: this cap's left corner. Walk to the next cap's first vertex.
    const idx = [e];
    let m = (e + 1) % N;
    while (outline.capOf[m] < 0) { idx.push(m); m = (m + 1) % N; }
    idx.push(m);
    const cj = outline.capOf[m];
    const run = idx.map((i) => outline.outer[i]);
    const z = idx.map(zAt);
    if (run.length < 2) continue;
    const arc = [0];
    for (let q = 1; q < run.length; q++) arc.push(arc[q - 1] + dist(run[q - 1], run[q]));
    const len = arc[arc.length - 1];
    if (len < 0.05) continue;
    const li = ci, lj = cj;
    const k0 = cornerKerb(li, true), k1 = cornerKerb(lj, false);
    const anyRoute = legs[li].kind === "route" || legs[lj].kind === "route";
    const kerbed = k0 > 0 || k1 > 0 || (!!j.ring && o.ringKerbed);
    const n0 = legs[li].cap.left, n1 = mul(legs[lj].cap.left, -1);
    const normals = runNormals(run, n0, n1);
    if (kerbed) {
      kerbRuns++;
      const rm = room(run);
      const kAt = (q: number) => {
        let k = 1;
        if (k0 < 1) k = Math.min(k, k0 + (1 - k0) * Math.min(1, arc[q] / RAMP));
        if (k1 < 1) k = Math.min(k, k1 + (1 - k1) * Math.min(1, (len - arc[q]) / RAMP));
        return k;
      };
      const drop = anyRoute ? KERB.vergeDrop : KERB.vergeDrop;
      const cl = run.map((p) => o.clear?.(p) ?? Infinity);
      band([sinks.strip, sinks.strip, sinks.kerb, sinks.kerb, sinks.gutter], run, normals, z,
        (q) => {
          const room0 = Math.min(o.stripOut, Math.max(KERB_BACK + 0.2, 0.8 * rm[q]));
          // Short of another street's asphalt: the strip narrows, and the kerb goes where there's no room.
          if (cl[q] >= room0 + 0.1) return kerbProfile(kAt(q), room0, drop);
          const k = cl[q] < KERB_BACK + 0.15 ? 0 : kAt(q);
          return kerbProfile(k, Math.max(0.02, Math.min(room0, cl[q] - 0.1)), drop);
        }, arc);
    } else if (anyRoute && o.vergeWidth > 0) {
      vergeRuns++;
      const rm = room(run);
      const cl = run.map((p) => o.clear?.(p) ?? Infinity);
      band([sinks.verge, sinks.verge], run, normals, z, (q) => {
        const w = Math.max(0.02, Math.min(o.vergeWidth, Math.max(0.3, 0.8 * rm[q]), cl[q] - 0.1));
        return [[w, -KERB.vergeDrop - KERB.skirt], [w, -KERB.vergeDrop], [0, 0]];
      }, arc);
    }
  }
  // Islands: kerb inward from each hole's edge, then the raised top.
  for (const hole of outline.holes) {
    const isRing = !!j.ring && hole.some((p) => Math.abs(dist(p, j.ring!.c) - j.ring!.rIn) < 0.6);
    const ring = hole.concat([hole[0]]);
    const z = ring.map((p) => dj.h(p));
    const area = Math.abs(ringArea(hole));
    let per = 0;
    for (let q = 1; q < ring.length; q++) per += dist(ring[q - 1], ring[q]);
    const inr = (2 * area) / Math.max(per, 1e-6);
    const s = Math.min(1, (0.6 * inr) / KERB_BACK);
    const arc = [0];
    for (let q = 1; q < ring.length; q++) arc.push(arc[q - 1] + dist(ring[q - 1], ring[q]));
    // Closed: the normals at the seam are the mitre of the last and first segments.
    const nrm = runNormals([ring[ring.length - 2], ...ring, ring[1]], [0, 0], [0, 0]).slice(1, -1);
    const prof = (): [number, number][] => [[KERB_BACK * s, KERB.height], [(KERB.gutter + KERB.faceRun) * s, KERB.height], [KERB.gutter * s, -KERB.dip], [0, 0]];
    band([sinks.kerb, sinks.kerb, sinks.gutter], ring, nrm, z, prof, arc);
    // Top: the inner offset ring at kerb-top height.
    const inner = ring.slice(0, -1).map((p, q) => add(p, mul(nrm[q], KERB_BACK * s)));
    const ia = ringArea(inner);
    if (ia < 0 && Math.abs(ia) > 0.2 * area) {
      const sink = isRing ? sinks.island : sinks.islandTop;
      const flat = inner.flatMap((p) => [p[0], p[1]]);
      const t = earcut(flat);
      const ids = inner.map((p, q) => sink.vertex([p[0], p[1], z[q] + KERB.height], p[0] / 8, -p[1] / 8));
      for (let q = 0; q < t.length; q += 3) {
        const A = inner[t[q]], B = inner[t[q + 1]], C = inner[t[q + 2]];
        const cr = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
        if (cr > 0) sink.tri(ids[t[q]], ids[t[q + 1]], ids[t[q + 2]]);
        else if (cr < 0) sink.tri(ids[t[q]], ids[t[q + 2]], ids[t[q + 1]]);
      }
    }
  }
  // Give-way lines: every leg into a roundabout; the side roads of a junction with a priority road.
  if (o.markings) {
    legs.forEach((l, i) => {
      const giveWay = j.ring ? true : !!dj.through && !dj.through.includes(i);
      if (!giveWay || l.inbound === false) return;
      const lo = -(l.hw - 0.25), hi = l.inbound === true ? l.hw - 0.25 : -0.15;
      if (hi - lo < 0.6) return;
      const a0 = -0.55, a1 = -0.25;
      for (let t = lo; t + 0.3 <= hi; t += 1.2) {
        const t1 = Math.min(hi, t + 0.6);
        const corners: P2[] = [[a0, t], [a1, t], [a1, t1], [a0, t1]];
        const p3 = corners.map(([a, b]) => {
          const p = add(add(l.cap.c, mul(l.cap.d, a)), mul(l.cap.left, b));
          return [p[0], p[1], dj.h(p) + PAINT_LIFT] as V3;
        });
        orientedQuad(sinks.paint, p3, [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 0, 1]);
      }
    });
  }
  return { kerbRuns, vergeRuns };
}

export { leftOf };
