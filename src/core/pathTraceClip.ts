// Busselton fork: a traced road edge stops short of a mapped path beside it.
//
// The aerial trace (trace.ts) finds the asphalt either side of a road. With the guard off (the
// Busselton routes set traceGuard: false) it may run up to 20 m wide, and beside the foreshore the
// red asphalt shared path reads as more road: the trace took it in (Marine Tce: the road traced
// 13.5 m wide for 300 m with the shared path's line 7 m off its centre), so the path was cut for
// lying under the road and Mac saw it come and go. A path mapped in OSM beside a road, roughly
// parallel to it and further out than the road's mapped half width, isn't road: where a traced
// edge reaches over one, the edge is pulled back to clear it (never inside the mapped width), and
// eased back out along the road so the edge doesn't jump.

import type { Vec2 } from "./geo";
import { PATH_WIDTH, type PathLine } from "./paths";
import type { TraceResult, TraceSample } from "./trace";

/** Room kept between a traced edge and a path's own edge, metres. */
export const CLIP_ROOM = 0.3;
/** A path counts only this far past the road's mapped half width, metres (nearer, it may be the road's own line). */
const BEYOND_MAPPED = 1;
/** A path counts only when it runs within this angle of the road (cos): a crossing doesn't. */
const PARALLEL = Math.cos((30 * Math.PI) / 180);
/** How fast a pulled-back edge may ease back out along the road, metres across per metre along. */
const EASE = 0.2;
/** The trace keeps at least this much width, metres. */
const MIN_WIDTH = 3;
const CELL = 20;

/**
 * Pulls the trace's edges in off the paths, in place: `offset` and `width` change where an edge
 * reached over a path. `samples` are the plan the trace was made on (its widths the mapped ones).
 * Returns how many samples changed.
 */
export function clipTraceAtPaths(samples: TraceSample[], tr: TraceResult, paths: PathLine[]): number {
  const n = samples.length;
  if (!n || !paths.length) return 0;
  // Path segments by cell.
  const cells = new Map<string, [Vec2, Vec2, number][]>();
  for (const p of paths) {
    const half = PATH_WIDTH[p.kind] / 2;
    for (let i = 1; i < p.pts.length; i++) {
      const a = p.pts[i - 1], b = p.pts[i];
      for (let x = Math.floor(Math.min(a[0], b[0]) / CELL); x <= Math.floor(Math.max(a[0], b[0]) / CELL); x++) {
        for (let y = Math.floor(Math.min(a[1], b[1]) / CELL); y <= Math.floor(Math.max(a[1], b[1]) / CELL); y++) {
          const k = x + "," + y;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k)!.push([a, b, half]);
        }
      }
    }
  }
  // The edges as applyTrace will lay them: the centre moved by the offset, the width blended from
  // the mapped one by the trust.
  const built = (i: number) => samples[i].width + (tr.width[i] - samples[i].width) * tr.conf[i];
  const L = tr.offset.map((o, i) => o + built(i) / 2), R = tr.offset.map((o, i) => o - built(i) / 2);
  // Where each edge must stop (Infinity: anywhere), from the paths crossing each sample's row.
  const capL = new Array<number>(n).fill(Infinity), capR = new Array<number>(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(tr.width[i])) continue;
    const { pos, left } = samples[i];
    const tan: Vec2 = [left[1], -left[0]];
    const mapped = samples[i].width / 2;
    const cx = Math.floor(pos[0] / CELL), cy = Math.floor(pos[1] / CELL);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (const [a, b, half] of cells.get(gx + "," + gy) ?? []) {
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
        if (len < 1e-6 || Math.abs((dx * tan[0] + dy * tan[1]) / len) < PARALLEL) continue;
        // The row pos + left * u meets the segment a + (b - a) * v.
        const den = left[0] * dy - left[1] * dx;
        if (Math.abs(den) < 1e-9) continue;
        const ax = a[0] - pos[0], ay = a[1] - pos[1];
        const u = (ax * dy - ay * dx) / den;
        const v = (ax * left[1] - ay * left[0]) / den;
        if (v < 0 || v > 1 || Math.abs(u) <= mapped + BEYOND_MAPPED) continue;
        const stop = Math.max(mapped, Math.abs(u) - half - CLIP_ROOM);
        if (u > 0 && u - half < L[i]) capL[i] = Math.min(capL[i], stop);
        if (u < 0 && -u - half < -R[i]) capR[i] = Math.min(capR[i], stop);
      }
    }
  }
  // Eased out along the road either way.
  const ease = (cap: number[]) => {
    for (let i = 1; i < n; i++) cap[i] = Math.min(cap[i], cap[i - 1] + EASE * Math.abs(samples[i].s - samples[i - 1].s));
    for (let i = n - 2; i >= 0; i--) cap[i] = Math.min(cap[i], cap[i + 1] + EASE * Math.abs(samples[i + 1].s - samples[i].s));
  };
  ease(capL);
  ease(capR);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(tr.width[i]) || !(tr.conf[i] > 0.05)) continue;
    let l = Math.min(L[i], capL[i]), r = Math.max(R[i], -capR[i]);
    if (l === L[i] && r === R[i]) continue;
    if (l - r < MIN_WIDTH) {
      // Both sides pulled in past the minimum: keep the minimum about the middle of what's left.
      const m = (l + r) / 2;
      l = m + MIN_WIDTH / 2;
      r = m - MIN_WIDTH / 2;
    }
    tr.offset[i] = (l + r) / 2;
    // The traced width that applyTrace blends to l - r at this trust.
    tr.width[i] = Math.max(MIN_WIDTH, samples[i].width + (l - r - samples[i].width) / tr.conf[i]);
    changed++;
  }
  return changed;
}
