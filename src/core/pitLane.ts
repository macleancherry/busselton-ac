// Busselton fork: pit_lane.ai and data/ideal_line.ai for each layout.
//
// AC looks for <layout>/ai/pit_lane.ai beside fast_lane.ai, and logs "NO PIT LANE FOUND" without
// it. On a Kunos track it's an AI line in the same format (version 7, with the lookup grid),
// recorded from the racing line before the pit entry, down the pit lane past the boxes and back
// onto the racing line after the exit; the AI follows it out of its box and when it pits. These
// tracks have no pit lane: the boxes are spots on the AI line itself (gridSlots.ts, floodPits), so
// the pit lane is the stretch of AI line under the boxes, from a little before the first to a
// little after the last: the AI leaves its box straight onto the line it's already on.
//
// AC loads the ideal line (the driving line aid and the race engineer's line) from
// <layout>/data/ideal_line.ai, or, without that file, from the AI line ("IDEAL LINE FROM AI LINE"),
// and then the race engineer says "NO IDEAL LINE FOUND" for every car. So each layout ships its AI
// line as data/ideal_line.ai too.
//
// "WARNING: TRACK :: NO POSITION DATA FOUND", logged straight after the ideal line, isn't about
// any of this, and no file of ours removes it: it stayed with the ideal line from its own file, with
// the lookup grid (retest 4, 31 Oct 2026), and Kunos's own tracks log it at the same point after
// loading their own data/ideal_line.ai (Mugello, with and without CSP: GTPlanet "Assetto Corsa PC
// Mods General Discussion" p. 1820; ks_barcelona: docs/verification.md). It's harmless; don't chase it.

import { writeFastLaneAi, type AiPoint } from "./aiSpline";
import type { Kn5GroupNode } from "./kn5";

type Xyz = [number, number, number];

/** A box further than this from the AI line (metres) isn't on it. */
export const PIT_ON_LINE = 5;
/** The pit lane starts this far before the first box, metres... */
export const PIT_BEFORE = 40;
/** ...and ends this far after the last. */
export const PIT_AFTER = 60;
/** Boxes closer than this along the line (metres) are one group; the pit lane runs past one group. */
const GROUP_GAP = 100;

/** AC_PIT_n positions (AC space), in box order. */
export function pitBoxes(dummies: Kn5GroupNode[]): Xyz[] {
  return dummies
    .map((d) => ({ d, m: /^AC_PIT_(\d+)$/.exec(d.name) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(a.m![1]) - Number(b.m![1]))
    .map(({ d }) => [d.transform[12], d.transform[13], d.transform[14]] as Xyz);
}

/**
 * The pit lane: the AI line's points from PIT_BEFORE before the first box of a group to PIT_AFTER
 * after its last (across the start line on a loop), distances from 0, as an open line. The group
 * is the boxes on the line (within PIT_ON_LINE) that run on from the first such box with less
 * than GROUP_GAP between neighbours: on a race layout every box (the grid); on free roam, where
 * the boxes are spread round the lap, the first AI box's. Null with no box on the line.
 */
export function pitLaneAi(ai: AiPoint[], boxes: Xyz[], closed: boolean): AiPoint[] | null {
  const n = ai.length;
  if (n < 2 || !boxes.length) return null;
  const total = ai[n - 1].distance + (closed ? ai[n - 1].length : 0);
  const along = boxes.map((b) => {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(ai[i].position[0] - b[0], ai[i].position[2] - b[2]);
      if (d < bd) { bd = d; bi = i; }
    }
    return bd <= PIT_ON_LINE ? ai[bi].distance : null;
  });
  const first = along.findIndex((d) => d !== null);
  if (first < 0) return null;
  const ref = along[first]!;
  // Each box's place relative to the first one on the line (shortest way round on a loop). The
  // first box itself is exactly 0: wrapping 0 round a lap whose length isn't a round number in
  // binary gives a few 1e-13 instead, and an indexOf(0) on that found nothing, so half of all
  // closed layouts (Busselton foreshore and sights, both Collie layouts) shipped no pit lane.
  const rel = along.filter((d): d is number => d !== null).map((d) => {
    let o = d - ref;
    if (o !== 0 && closed && total > 0) o = ((o + total / 2) % total + total) % total - total / 2;
    return o;
  }).sort((a, b) => a - b);
  const zero = rel.findIndex((o) => Math.abs(o) < 1e-6);
  let lo = zero, hi = zero;
  while (lo > 0 && rel[lo] - rel[lo - 1] < GROUP_GAP) lo--;
  while (hi < rel.length - 1 && rel[hi + 1] - rel[hi] < GROUP_GAP) hi++;
  let start = ref + rel[lo] - PIT_BEFORE;
  let span = rel[hi] - rel[lo] + PIT_BEFORE + PIT_AFTER;
  if (closed) start = ((start % total) + total) % total;
  else if (start < 0) { span += start; start = 0; }
  // The first point at or after `start`, then on round (or to the end) for `span` metres.
  let i = ai.findIndex((p) => p.distance >= start);
  if (i < 0) i = closed ? 0 : n - 1;
  const out: AiPoint[] = [];
  let d = 0;
  for (let k = 0; k < n && d <= span; k++) {
    const p = ai[(i + k) % n];
    out.push({ ...p, distance: d, position: [...p.position], normal: [...p.normal], forward: [...p.forward] });
    if (!closed && i + k >= n - 1) break;
    d += p.length;
  }
  if (out.length < 2) return null;
  out[out.length - 1] = { ...out[out.length - 1], length: 0 };
  return out;
}

/**
 * A layout's pit_lane.ai (when a box is on the AI line) and data/ideal_line.ai (the AI line's own
 * file, `aiFile`), under `prefix` (the track folder, or the layout's).
 */
export function pitLaneFiles(prefix: string, ai: AiPoint[], aiFile: Uint8Array, dummies: Kn5GroupNode[], closed: boolean): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = { [`${prefix}/data/ideal_line.ai`]: aiFile };
  const pit = pitLaneAi(ai, pitBoxes(dummies), closed);
  if (pit) files[`${prefix}/ai/pit_lane.ai`] = writeFastLaneAi(pit);
  return files;
}
