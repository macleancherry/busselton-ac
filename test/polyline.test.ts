import { describe, expect, it } from "vitest";
import type { Vec2 } from "../src/core/geo";
import { cumulative, dedupe, frames, gaussianSmooth, resample, simplify, smoothPath } from "../src/core/polyline";

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const circle = (r: number, n: number, ccw: boolean): Vec2[] =>
  Array.from({ length: n }, (_, i) => {
    const a = ((ccw ? 1 : -1) * 2 * Math.PI * i) / n;
    return [r * Math.cos(a), r * Math.sin(a)] as Vec2;
  });

describe("cumulative", () => {
  it("runs the arc length", () => {
    expect(cumulative([[0, 0], [3, 4], [3, 10]])).toEqual([0, 5, 11]);
    expect(cumulative([])).toEqual([]);
  });
});

describe("dedupe", () => {
  it("drops points within minDist of the last kept one", () => {
    expect(dedupe([[0, 0], [0.03, 0]])).toEqual([[0, 0]]);
    expect(dedupe([[0, 0], [0.06, 0]])).toEqual([[0, 0], [0.06, 0]]);
    const run: Vec2[] = Array.from({ length: 10 }, (_, i) => [i * 0.02, 0]);
    const kept = dedupe(run).map((p) => Math.round(p[0] * 100));
    expect(kept).toEqual([0, 6, 12, 18]);
    expect(dedupe([])).toEqual([]);
  });
  it("keeps a loop's closing duplicate", () => {
    const loop: Vec2[] = [[0, 0], [10, 0], [10, 10], [0, 0]];
    expect(dedupe(loop)).toHaveLength(4);
  });
});

describe("resample", () => {
  it("spaces a straight line evenly", () => {
    const out = resample([[0, 0], [10, 0]], 1);
    expect(out).toHaveLength(11);
    out.forEach((p, i) => { expect(p[0]).toBeCloseTo(i, 12); expect(p[1]).toBe(0); });
    expect(out[0]).toEqual([0, 0]);
    expect(out[10][0]).toBeCloseTo(10, 12);
  });
  it("rounds the interval count", () => {
    const out = resample([[0, 0], [10.4, 0]], 1);
    expect(out).toHaveLength(11);
    expect(out[1][0]).toBeCloseTo(1.04, 12);
  });
  it("keeps samples on an L-shaped path, equally spaced along it", () => {
    const out = resample([[0, 0], [5.5, 0], [5.5, 4.5]], 1);
    expect(out).toHaveLength(11);
    for (const [x, y] of out) {
      const onA = Math.abs(y) < 1e-9 && x >= -1e-9 && x <= 5.5 + 1e-9;
      const onB = Math.abs(x - 5.5) < 1e-9 && y >= -1e-9 && y <= 4.5 + 1e-9;
      expect(onA || onB).toBe(true);
    }
    // Arc length along the path at each sample: x for the first leg, 5.5 + y for the second.
    const arc = out.map(([x, y]) => (Math.abs(y) < 1e-9 ? x : 5.5 + y));
    for (let i = 1; i < arc.length; i++) expect(arc[i] - arc[i - 1]).toBeCloseTo(1, 9);
  });
  it("survives a zero-length segment", () => {
    const out = resample([[0, 0], [5, 0], [5, 0], [10, 0]], 1);
    expect(out).toHaveLength(11);
    expect(out.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });
  it("gives two copies for identical points", () => {
    expect(resample([[2, 3], [2, 3], [2, 3]], 1)).toEqual([[2, 3], [2, 3]]);
  });
  it("handles no points, one point and bad spacing", () => {
    expect(resample([], 1)).toEqual([]);
    expect(resample([[1, 2]], 1)).toEqual([[1, 2]]);
    for (const s of [0, -1, NaN, Infinity]) expect(() => resample([[0, 0], [1, 0]], s)).toThrow(/spacing/);
  });
});

describe("gaussianSmooth", () => {
  it("copies when sigma is under 0.5", () => {
    const v = [1, 5, 2];
    const out = gaussianSmooth(v, 0.4, false);
    expect(out).toEqual(v);
    expect(out).not.toBe(v);
  });
  it("keeps a constant series constant", () => {
    for (const closed of [false, true]) {
      gaussianSmooth(new Array(20).fill(3), 2.5, closed).forEach((x) => expect(x).toBeCloseTo(3, 12));
    }
  });
  it("spreads a spike into a Gaussian summing to 1", () => {
    const v = new Array(100).fill(0);
    v[50] = 1;
    const out = gaussianSmooth(v, 3, true);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(out[50]).toBeGreaterThan(out[52]);
    expect(out[48]).toBeCloseTo(out[52], 12);
  });
  it("renormalises open ends", () => {
    const ramp = Array.from({ length: 20 }, (_, i) => i);
    const out = gaussianSmooth(ramp, 2, false);
    expect(out[19]).toBeLessThan(19);
    expect(out[0]).toBeGreaterThan(0);
    expect(out[10]).toBeCloseTo(10, 9);
  });
  it("wraps closed series", () => {
    const v = new Array(30).fill(0);
    v[0] = 1;
    const out = gaussianSmooth(v, 2, true);
    expect(out[29]).toBeGreaterThan(0);
    expect(out[29]).toBeCloseTo(out[1], 12);
    expect(gaussianSmooth(v, 2, false)[29]).toBe(0);
    expect(gaussianSmooth([], 2, true)).toEqual([]);
  });
});

describe("smoothPath", () => {
  const zig: Vec2[] = Array.from({ length: 41 }, (_, i) => [i, i % 2 === 0 ? 0 : 1]);

  it("pins open ends and straightens the middle", () => {
    const out = smoothPath(zig, 3, 1, false);
    expect(out[0]).toEqual(zig[0]);
    expect(out[40]).toEqual(zig[40]);
    expect(Math.abs(out[20][1] - 0.5)).toBeLessThan(0.05);
    expect(Math.abs(out[21][1] - 0.5)).toBeLessThan(0.05);
  });
  it("fades in over 2 sigma samples", () => {
    const sigma = 3;
    const sm = gaussianSmooth(zig.map((p) => p[1]), sigma, false);
    const out = smoothPath(zig, sigma, 1, false);
    for (const e of [1, 2, 3, 5, 6, 7]) {
      const w = Math.min(1, e / (2 * sigma));
      expect(out[e][1]).toBeCloseTo(zig[e][1] + (sm[e] - zig[e][1]) * w, 12);
    }
  });
  it("returns the input when sigma is small", () => {
    expect(smoothPath(zig, 0.4, 1, false)).toEqual(zig);
  });
  it("rounds a closed square's corners", () => {
    const sq: Vec2[] = [];
    for (let i = 0; i < 10; i++) sq.push([i, 0]);
    for (let i = 0; i < 10; i++) sq.push([10, i]);
    for (let i = 0; i < 10; i++) sq.push([10 - i, 10]);
    for (let i = 0; i < 10; i++) sq.push([0, 10 - i]);
    const out = smoothPath(sq, 2, 1, true);
    expect(out).toHaveLength(40);
    expect(dist(out[0], [0, 0])).toBeGreaterThan(0.5);
    expect(dist(out[10], [10, 0])).toBeGreaterThan(0.5);
    // Corners pulled inwards.
    expect(out[0][0]).toBeGreaterThan(0);
    expect(out[0][1]).toBeGreaterThan(0);
  });
});

describe("frames", () => {
  it("gives 1/r curvature on a circle, positive anticlockwise", () => {
    const n = Math.round(2 * Math.PI * 50);
    const ccw = frames(circle(50, n, true), true);
    for (const f of ccw) {
      expect(Math.abs(f.curvature / 0.02 - 1)).toBeLessThan(0.01);
      expect(Math.hypot(f.tan[0], f.tan[1])).toBeCloseTo(1, 12);
      // Left points to the centre.
      const toC = [-f.pos[0] / 50, -f.pos[1] / 50];
      expect(f.left[0] * toC[0] + f.left[1] * toC[1]).toBeGreaterThan(0.999);
    }
    for (let i = 1; i < ccw.length; i++) expect(ccw[i].s).toBeGreaterThan(ccw[i - 1].s);
    expect(ccw[0].s).toBe(0);
    for (const f of frames(circle(50, n, false), true)) expect(Math.abs(f.curvature / -0.02 - 1)).toBeLessThan(0.01);
  });
  it("gives zero curvature on a straight line and left = (-ty, tx)", () => {
    const fs = frames([[0, 0], [1, 1], [2, 2], [3, 3]], false);
    for (const f of fs) {
      expect(f.curvature).toBe(0);
      expect(f.left).toEqual([-f.tan[1], f.tan[0]]);
      expect(f.tan[0]).toBeCloseTo(Math.SQRT1_2, 12);
    }
  });
  it("gives zero curvature at open ends", () => {
    const fs = frames(circle(20, 30, true).slice(0, 10), false);
    expect(fs[0].curvature).toBe(0);
    expect(fs[9].curvature).toBe(0);
    expect(fs[5].curvature).toBeGreaterThan(0);
    expect(fs[3].pos).toEqual(circle(20, 30, true)[3]);
  });
  it("gives a zero tangent for coincident neighbours, no NaN", () => {
    const fs = frames([[1, 1], [2, 2], [1, 1]], false);
    expect(fs[1].tan).toEqual([0, 0]);
    expect(fs[1].curvature).toBe(0);
    const one = frames([[4, 5]], false);
    expect(one[0].tan).toEqual([0, 0]);
    expect(one[0].left[0] === 0 && one[0].left[1] === 0).toBe(true);
    expect(one[0].curvature).toBe(0);
  });
});

describe("simplify", () => {
  it("keeps only the ends of a noisy straight line", () => {
    const pts: Vec2[] = Array.from({ length: 50 }, (_, i) => [i, (i % 3) * 0.1 - 0.1]);
    pts[0] = [0, 0];
    pts[49] = [49, 0];
    expect(simplify(pts, 0.5)).toEqual([[0, 0], [49, 0]]);
  });
  it("keeps a right angle's corner, in order", () => {
    const pts: Vec2[] = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]];
    expect(simplify(pts, 0.5)).toEqual([[0, 0], [10, 0], [10, 10]]);
  });
  it("drops points exactly at tolerance", () => {
    expect(simplify([[0, 0], [5, 0.5], [10, 0]], 0.5)).toEqual([[0, 0], [10, 0]]);
    expect(simplify([[0, 0], [5, 0.51], [10, 0]], 0.5)).toHaveLength(3);
  });
  it("copies fewer than three points", () => {
    const pts: Vec2[] = [[0, 0], [1, 1]];
    const out = simplify(pts, 1);
    expect(out).toEqual(pts);
    expect(out).not.toBe(pts);
  });
  it("keeps a closed ring's corners when its first point repeats", () => {
    const ring: Vec2[] = [[0, 0], [5, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    expect(simplify(ring, 0.5)).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
  });
  it("measures to the segment, not its extension", () => {
    // [20, 0.1] lies near the chord's extension but 10 m beyond its end.
    expect(simplify([[0, 0], [20, 0.1], [10, 0]], 0.5)).toHaveLength(3);
  });
});
