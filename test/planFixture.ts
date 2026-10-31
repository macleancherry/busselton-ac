// Synthetic road plans for the markings, paint line and kerb tests.
import type { RoadPlan, RoadSample } from "../src/core/road";

/** A plan through `pts` (already spaced about evenly), with a width and height per sample. */
export function planFrom(
  pts: [number, number][],
  opts: { closed?: boolean; width?: (i: number) => number; h?: (i: number, s: number) => number } = {},
): RoadPlan {
  const n = pts.length;
  const closed = !!opts.closed;
  const s: number[] = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const length = closed ? s[n - 1] + Math.hypot(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]) : s[n - 1];
  const samples: RoadSample[] = pts.map((p, i) => {
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tan: [number, number] = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    return { pos: p, tan, left: [-tan[1], tan[0]], curvature: 0, s: s[i], width: opts.width?.(i) ?? 7, h: opts.h?.(i, s[i]) ?? 0, bank: 0 };
  });
  return { closed, samples, length, roundabouts: [] };
}

/** A straight road east along x from 0 to `len`, samples every `spacing` m. */
export function straight(len: number, opts: { spacing?: number; width?: number | ((i: number) => number); h?: (i: number, s: number) => number } = {}): RoadPlan {
  const sp = opts.spacing ?? 2;
  const pts: [number, number][] = [];
  for (let x = 0; x <= len + 1e-9; x += sp) pts.push([x, 0]);
  const w = opts.width;
  return planFrom(pts, { width: typeof w === "function" ? w : () => w ?? 7, h: opts.h });
}

/** A circle of radius r, about `spacing` m between samples. */
export function ring(r: number, spacing = 2, width = 7): RoadPlan {
  const n = Math.round((2 * Math.PI * r) / spacing);
  const pts: [number, number][] = [];
  for (let k = 0; k < n; k++) pts.push([r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n)]);
  return planFrom(pts, { closed: true, width: () => width });
}
