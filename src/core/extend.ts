// Run-up and run-off for point-to-point routes: lengthens the route at both
// ends along the streets it starts and ends on (round their bends, and on to
// a street joining end to end), then straight ahead where no street carries
// on. Reports where the original start and finish sit on the longer path.
//
// Written from docs/specs/extend.md.

import type { Vec2 } from "./geo";

/** The extended path, and the arc lengths along it (m) of the original first and last points. */
export interface Extension {
  path: Vec2[];
  startAt: number;
  finishAt: number;
}

/** First search radius from the path's end to a street, m. */
const SNAP = 10;
/** Radius for chaining on to the next street, m. */
const JOIN = 4;
/** Straight-on point spacing, m. */
const STEP = 2;
/** How far back along the path the end heading is measured, m. */
const LOOK_BACK = 15;
/** A street must be within about 37 degrees of the heading (either way along it). */
const ALIGN = 0.8;
/** Score weight of misalignment against distance. */
const ALIGN_WEIGHT = 20;
const EPS = 1e-6;

export function pathLength(path: Vec2[]): number {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return L;
}

function unit(dx: number, dy: number): Vec2 {
  const l = Math.hypot(dx, dy);
  return l > 0 ? [dx / l, dy / l] : [0, 0];
}

/** The point `back` metres before the path's end, measured along it (the first point if shorter). */
function pointBack(path: Vec2[], back: number): Vec2 {
  let left = back;
  for (let i = path.length - 1; i > 0; i--) {
    const a = path[i - 1], b = path[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l >= left && l > 0) {
      const f = left / l;
      return [b[0] + (a[0] - b[0]) * f, b[1] + (a[1] - b[1]) * f];
    }
    left -= l;
  }
  return path[0];
}

/** Points continuing `path` beyond its last point for `want` metres (not including the last point). */
export function carryOn(path: Vec2[], lines: Vec2[][], want: number): Vec2[] {
  if (want <= 0) return [];
  if (path.length === 0 || pathLength(path) === 0) throw new Error("Route has no length to extend");
  const out: Vec2[] = [];
  let at: Vec2 = path[path.length - 1];
  const back = pointBack(path, LOOK_BACK);
  let dir = unit(at[0] - back[0], at[1] - back[1]);
  let got = 0;
  const used = new Set<number>();
  let first = true;

  while (got < want - EPS) {
    const radius = first ? SNAP : JOIN;
    first = false;
    let best: { line: number; seg: number; foot: Vec2; dot: number; score: number } | null = null;
    for (let li = 0; li < lines.length; li++) {
      if (used.has(li)) continue;
      const line = lines[li];
      for (let k = 0; k + 1 < line.length; k++) {
        const a = line[k], b = line[k + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy);
        if (L < EPS) continue;
        const f = Math.max(0, Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / (L * L)));
        const foot: Vec2 = [a[0] + dx * f, a[1] + dy * f];
        const d = Math.hypot(at[0] - foot[0], at[1] - foot[1]);
        const dot = (dx / L) * dir[0] + (dy / L) * dir[1];
        if (d > radius || Math.abs(dot) < ALIGN) continue;
        const score = d + (1 - Math.abs(dot)) * ALIGN_WEIGHT;
        if (!best || score < best.score) best = { line: li, seg: k, foot, dot, score };
      }
    }
    if (!best) break;
    used.add(best.line);
    const line = lines[best.line];
    const walk: Vec2[] = [best.foot];
    if (best.dot > 0) for (let k = best.seg + 1; k < line.length; k++) walk.push(line[k]);
    else for (let k = best.seg; k >= 0; k--) walk.push(line[k]);

    let prev = at;
    for (let w = 0; w < walk.length; w++) {
      const p = walk[w];
      const l = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      if (l <= EPS) continue;
      // The hop onto the street (w = 0) never sets the heading: it can point sideways.
      const step = unit(p[0] - prev[0], p[1] - prev[1]);
      if (got + l >= want) {
        const r = want - got;
        out.push([prev[0] + step[0] * r, prev[1] + step[1] * r]);
        if (w > 0) dir = step;
        got = want;
        prev = out[out.length - 1];
        break;
      }
      out.push(p);
      if (w > 0) dir = step;
      got += l;
      prev = p;
    }
    at = prev;
  }

  while (got < want - EPS) {
    const step = Math.min(STEP, want - got);
    at = [at[0] + dir[0] * step, at[1] + dir[1] * step];
    out.push(at);
    got += step;
  }
  return out;
}

/** Lengthens a point-to-point path by `before` metres at its start and `after` at its end. */
export function extendRoute(path: Vec2[], lines: Vec2[][], before: number, after: number): Extension {
  const head = before > 0 ? carryOn(path.slice().reverse(), lines, before).reverse() : [];
  const tail = after > 0 ? carryOn(path, lines, after) : [];
  const startAt = pathLength([...head, path[0]]);
  return { path: [...head, ...path, ...tail], startAt, finishAt: startAt + pathLength(path) };
}
