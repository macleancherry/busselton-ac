// Busselton fork: networkCore's streets keep clear of the landmarks beside them.
//
// networkCore lays a street on its OSM line at its class's width (a one-way 4.5 m), untraced. On
// Queen St's cultural precinct the two one-way living streets became one divided street 11.5 m
// across, and its east carriageway ran under Saltwater's canopy up to the glass, with the
// Settlement Art bronzes on its frontage standing in the lane (road_clear.ts). A landmark's
// outline (blocks, verandahs, awnings and low walls as placed: landmarkOutline) is checked against
// the aerial; where a street's edge reaches past one, less ROOM, that edge is drawn in (the street
// narrows on that side, its line moving over by half as much), down to MIN_LANE a carriageway.
// The change eases in along the street from nothing at its ends, where the junctions take their
// widths from the graph, so a junction's mouth still meets the street it was planned for.

import type { Vec2 } from "./geo";
import { pointInRing } from "./ringGeometry";

/** Room kept between a street's edge and a landmark's outline, metres. */
export const STREET_ROOM = 0.5;
/** The narrowest a carriageway gets, metres. */
const MIN_LANE = 3;
/** How fast the change eases along the street, metres across per metre along. */
const EASE = 0.2;
/** No change at a street's ends (junction caps): the change starts this far in, metres. */
const END_KEEP = 4;

export interface ClipStreet {
  pts: Vec2[];
  width: number;
  widths?: number[];
  median?: number;
  oneway?: 1 | -1;
}

/**
 * Draws in the streets' edges off the outlines (closed rings, local metres), in place: `pts` move
 * sideways and `widths` narrow where an edge reached past one. Returns how many streets changed.
 */
export function clipStreetsAtOutlines(streets: ClipStreet[], outlines: Vec2[][], room = STREET_ROOM): number {
  if (!outlines.length) return 0;
  const boxes = outlines.map((r) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0, y0, x1, y1];
  });
  let changed = 0;
  for (const st of streets) {
    const n = st.pts.length;
    if (n < 2) continue;
    const w = (i: number) => st.widths?.[i] ?? st.width;
    const maxHalf = Math.max(...st.pts.map((_, i) => w(i))) / 2 + room + 1;
    // Only the outlines near this street.
    let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
    for (const [x, y] of st.pts) { sx0 = Math.min(sx0, x); sy0 = Math.min(sy0, y); sx1 = Math.max(sx1, x); sy1 = Math.max(sy1, y); }
    const near = outlines.filter((_, k) => boxes[k][0] < sx1 + maxHalf && boxes[k][2] > sx0 - maxHalf && boxes[k][1] < sy1 + maxHalf && boxes[k][3] > sy0 - maxHalf);
    if (!near.length) continue;
    const s = [0];
    for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(st.pts[i][0] - st.pts[i - 1][0], st.pts[i][1] - st.pts[i - 1][1]));
    const left = st.pts.map((_, i) => {
      const a = st.pts[Math.max(0, i - 1)], b = st.pts[Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [-dy / l, dx / l] as Vec2;
    });
    // How far each edge must come in at each point.
    const needL = new Array<number>(n).fill(0), needR = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const p = st.pts[i], lf = left[i], half = w(i) / 2;
      if (near.some((r) => pointInRing(p[0], p[1], r))) continue;
      let nl = Infinity, nr = Infinity;
      for (const r of near) {
        for (let k = 0; k < r.length; k++) {
          const a = r[k], b = r[(k + 1) % r.length];
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const den = lf[0] * dy - lf[1] * dx;
          if (Math.abs(den) < 1e-9) continue;
          const ax = a[0] - p[0], ay = a[1] - p[1];
          const u = (ax * dy - ay * dx) / den, v = (ax * lf[1] - ay * lf[0]) / den;
          if (v < 0 || v > 1) continue;
          if (u > 0) nl = Math.min(nl, u);
          else nr = Math.min(nr, -u);
        }
      }
      needL[i] = Math.max(0, half - (nl - room));
      needR[i] = Math.max(0, half - (nr - room));
    }
    if (!needL.some((v) => v > 0) && !needR.some((v) => v > 0)) continue;
    // Eased: an edge comes in ahead of the outline and goes back out after it.
    const easeOut = (need: number[]) => {
      for (let i = 1; i < n; i++) need[i] = Math.max(need[i], need[i - 1] - EASE * (s[i] - s[i - 1]));
      for (let i = n - 2; i >= 0; i--) need[i] = Math.max(need[i], need[i + 1] - EASE * (s[i + 1] - s[i]));
    };
    easeOut(needL);
    easeOut(needR);
    // Never at the ends: the most change allowed grows from nothing END_KEEP in.
    const allow = s.map((v) => Math.max(0, Math.min(v, s[n - 1] - v) - END_KEEP) * EASE);
    const minW = (st.median ?? 0) + (st.median !== undefined ? 2 : 1) * MIN_LANE;
    const pts = st.pts.map((p) => [p[0], p[1]] as Vec2), widths = st.pts.map((_, i) => w(i));
    let any = false;
    for (let i = 0; i < n; i++) {
      let inL = Math.min(needL[i], allow[i]), inR = Math.min(needR[i], allow[i]);
      if (!(inL > 0 || inR > 0)) continue;
      const room0 = w(i) - minW;
      if (room0 <= 0) continue;
      if (inL + inR > room0) { const f = room0 / (inL + inR); inL *= f; inR *= f; }
      const shift = (inR - inL) / 2;
      pts[i] = [st.pts[i][0] + left[i][0] * shift, st.pts[i][1] + left[i][1] * shift];
      widths[i] = w(i) - inL - inR;
      any = true;
    }
    if (!any) continue;
    st.pts.splice(0, n, ...pts);
    st.widths = widths;
    changed++;
  }
  return changed;
}
