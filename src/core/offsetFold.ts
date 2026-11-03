// Busselton fork: sideways offsets that fold a line. Moving a line sideways by more than its radius
// on the inside of a bend folds it: the moved line runs back on itself in a little loop (an offset
// curve's swallowtail). It happened on Caves Road at Yallingup (retest 6, 3 Nov 2026): the aerial
// trace moved the centreline 3 m into a 12 m junction bend, leaving a corner of 0.3 m radius; the
// keep-left AI line, 1.7 m further in, then turned back on itself, and the AI braked to 20 km/h,
// steered for the loop and left the road. easeFolds takes the offset back, smoothly and only where
// the moved line bends tighter than allowed and tighter than the line it came from.

import type { Vec2 } from "./geo";
import { frames } from "./polyline";

/** Half-width of the taper each pass applies round a too-tight sample, samples. */
const TAPER = 6;
/** Each pass keeps this share of the offset at the too-tight sample (more further out). */
const KEEP = 0.7;
/** Passes before the offsets round what's still too tight are dropped. */
const PASSES = 40;
/** Offsets under this, metres, fold nothing worth easing. */
const MIN_OFFSET = 0.05;

/**
 * The offsets (metres along `left`, per point of `base`) with the folds taken out: wherever the
 * moved line's radius is under `minRadius(i)` and its curvature is more than 5% above the base
 * line's, with an offset of MIN_OFFSET or more at that point or either side of it, the offsets
 * nearby shrink (a triangle taper, 30% at that point), and again until none is.
 * Offsets that fold nothing come back unchanged. `fixed(i)` points keep theirs (roundabouts).
 */
export function easeFolds(
  base: Vec2[], left: Vec2[], offset: number[], minRadius: (i: number) => number, closed: boolean,
  fixed: (i: number) => boolean = () => false,
): number[] {
  const n = base.length;
  if (n < 3) return offset.slice();
  const k0 = frames(base, closed).map((f) => Math.abs(f.curvature));
  const off = offset.slice();
  const moved = () => base.map((p, i): Vec2 => [p[0] + left[i][0] * off[i], p[1] + left[i][1] * off[i]]);
  const at = (j: number) => (closed ? ((j % n) + n) % n : j);
  for (let pass = 0; pass <= PASSES; pass++) {
    const k = frames(moved(), closed).map((f) => Math.abs(f.curvature));
    // Too tight, and made so by an offset here or either side of it (a sharp corner the base line
    // already had, nudged by a few millimetres of fading offset, isn't the offset's doing).
    const bad: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!(k[i] * minRadius(i) > 1 && k[i] > k0[i] * 1.05)) continue;
      for (const d of [-1, 0, 1]) {
        const j = at(i + d);
        if (j >= 0 && j < n && Math.abs(off[j]) >= MIN_OFFSET) { bad.push(i); break; }
      }
    }
    if (!bad.length) break;
    const scale = new Array(n).fill(1);
    for (const i of bad) {
      for (let d = -TAPER; d <= TAPER; d++) {
        const j = at(i + d);
        if (j < 0 || j >= n) continue;
        const f = pass === PASSES ? 0 : 1 - (1 - KEEP) * (1 - Math.abs(d) / (TAPER + 1));
        scale[j] = Math.min(scale[j], f);
      }
    }
    for (let i = 0; i < n; i++) if (!fixed(i)) off[i] *= scale[i];
  }
  return off;
}
