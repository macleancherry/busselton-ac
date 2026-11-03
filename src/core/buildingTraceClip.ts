// Busselton fork: a traced road edge stops short of the buildings beside it.
//
// The aerial trace (trace.ts) reads the grey footpath and paving in front of a shopfront as more
// road, and in the town centre that carried the route's edge up to the shop walls: the landmarks'
// awnings and verandahs (The Tav on Queen St, the Ship Inn's corner, St Mary's front wall) then
// stood over the drive (road_clear.ts). A building's outline (a landmark's blocks, verandahs,
// awnings and low walls as placed, or a mapped OSM footprint) is never road: where a traced edge
// reaches past one, less ROOM, the edge is pulled back to it, and eased back out along the road
// so it doesn't jump. Like the path clip (pathTraceClip.ts) it works on the trace before
// applyTrace lays it, but a building may take the edge up to INTO_MAPPED inside the mapped half
// width (a footprint checked against the aerial is better evidence than a class's default width),
// never below MIN_SHARE of the mapped width in all.

import type { Vec2 } from "./geo";
import { pointInRing } from "./ringGeometry";
import type { TraceResult, TraceSample } from "./trace";

/** Room kept between a traced edge and a building's outline, metres. */
export const BUILDING_ROOM = 0.5;
/** How far inside the mapped half width an outline may pull an edge, metres. */
export const INTO_MAPPED = 1.5;
/** The road keeps at least this share of its mapped width (and 3 m). */
const MIN_SHARE = 0.6;
/** How fast a pulled-back edge eases back out along the road, metres across per metre along. */
const EASE = 0.2;
/** An outline this close to the centre (or across it) is ignored: bad data, not a kerb line. */
const CENTRE_KEEP = 1;
const CELL = 20;
/** The trust a clipped row the trace found nothing on is given, so applyTrace lays the clipped width. */
const UNTRACED_CONF = 0.5;

/**
 * Pulls the trace's edges in off the outlines (closed rings, local metres), in place: `offset` and
 * `width` change where an edge reached past one. `samples` are the plan the trace was made on
 * (their widths the mapped ones). A row the trace found nothing on is clipped from the mapped edges.
 * Returns how many samples changed.
 */
export function clipTraceAtOutlines(samples: TraceSample[], tr: TraceResult, outlines: Vec2[][], room = BUILDING_ROOM): number {
  const n = samples.length;
  if (!n || !outlines.length) return 0;
  // Outline edges by cell.
  const cells = new Map<string, [Vec2, Vec2, number][]>();
  outlines.forEach((ring, id) => {
    if (ring.length < 3) return;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      for (let x = Math.floor(Math.min(a[0], b[0]) / CELL); x <= Math.floor(Math.max(a[0], b[0]) / CELL); x++) {
        for (let y = Math.floor(Math.min(a[1], b[1]) / CELL); y <= Math.floor(Math.max(a[1], b[1]) / CELL); y++) {
          const k = x + "," + y;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k)!.push([a, b, id]);
        }
      }
    }
  });
  // The edges as applyTrace will lay them (offset already carries the trust; the width is blended).
  // Rows the trace found nothing on (width NaN) lay the mapped width on the mapped line; rows a
  // noTrace zone faded out (conf 0, a width kept) are left as they are.
  const untraced = (i: number) => Number.isNaN(tr.width[i]);
  const usable = (i: number) => untraced(i) || tr.conf[i] > 0.05;
  const built = (i: number) => (untraced(i) ? samples[i].width : samples[i].width + (tr.width[i] - samples[i].width) * tr.conf[i]);
  const L = tr.offset.map((o, i) => o + built(i) / 2), R = tr.offset.map((o, i) => o - built(i) / 2);
  const capL = new Array<number>(n).fill(Infinity), capR = new Array<number>(n).fill(Infinity);
  const reach = (i: number) => Math.max(Math.abs(L[i]), Math.abs(R[i])) + room + 1;
  for (let i = 0; i < n; i++) {
    if (!usable(i)) continue;
    const { pos, left } = samples[i];
    const floor = Math.max(1.5, samples[i].width / 2 - INTO_MAPPED, (samples[i].width * MIN_SHARE) / 2);
    const far = reach(i);
    const g = Math.ceil(far / CELL);
    const cx = Math.floor(pos[0] / CELL), cy = Math.floor(pos[1] / CELL);
    // The row's crossings with every outline edge near it: the nearest each side of the centre.
    let nearL = Infinity, nearR = Infinity;
    const seen = new Set<[Vec2, Vec2, number]>(), rings = new Set<number>();
    for (let gx = cx - g; gx <= cx + g; gx++) for (let gy = cy - g; gy <= cy + g; gy++) {
      for (const seg of cells.get(gx + "," + gy) ?? []) {
        if (seen.has(seg)) continue;
        seen.add(seg);
        const [a, b, id] = seg;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const den = left[0] * dy - left[1] * dx;
        if (Math.abs(den) < 1e-9) continue;
        const ax = a[0] - pos[0], ay = a[1] - pos[1];
        const u = (ax * dy - ay * dx) / den;
        const v = (ax * left[1] - ay * left[0]) / den;
        if (v < 0 || v > 1 || Math.abs(u) > far) continue;
        rings.add(id);
        if (u > 0) nearL = Math.min(nearL, u);
        else nearR = Math.min(nearR, -u);
      }
    }
    // An outline over the centre (or crossing within CENTRE_KEEP of it) isn't a kerb line: bad data.
    if (nearL < CENTRE_KEEP || nearR < CENTRE_KEEP) continue;
    // (A row on an outline's edge counts as in it.)
    const inside = (id: number) => [-0.05, 0, 0.05].some((d) => pointInRing(pos[0] - left[1] * d, pos[1] + left[0] * d, outlines[id]));
    if ([...rings].some(inside)) continue;
    if (nearL - room < L[i]) capL[i] = Math.max(floor, nearL - room);
    if (nearR - room < -R[i]) capR[i] = Math.max(floor, nearR - room);
  }
  const ease = (cap: number[]) => {
    for (let i = 1; i < n; i++) cap[i] = Math.min(cap[i], cap[i - 1] + EASE * Math.abs(samples[i].s - samples[i - 1].s));
    for (let i = n - 2; i >= 0; i--) cap[i] = Math.min(cap[i], cap[i + 1] + EASE * Math.abs(samples[i + 1].s - samples[i].s));
  };
  ease(capL);
  ease(capR);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if (!usable(i)) continue;
    const minW = Math.max(3, samples[i].width * MIN_SHARE);
    let l = Math.min(L[i], capL[i]), r = Math.max(R[i], -capR[i]);
    if (l === L[i] && r === R[i]) continue;
    if (l - r < minW) {
      // Squeezed from both sides: the minimum about the middle of what's left.
      const m = (l + r) / 2;
      l = m + minW / 2;
      r = m - minW / 2;
    }
    tr.offset[i] = (l + r) / 2;
    // An untraced row gets a middling trust (under the 0.7 that kerb evidence and paint read as traced).
    if (untraced(i)) tr.conf[i] = UNTRACED_CONF;
    // The traced width that applyTrace blends to l - r at this trust.
    tr.width[i] = Math.max(0.1, samples[i].width + (l - r - samples[i].width) / tr.conf[i]);
    changed++;
  }
  return changed;
}
