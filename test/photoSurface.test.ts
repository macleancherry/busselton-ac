// Photo road surface (docs/specs/photoSurface.md, "Tests to write"). Small strips for speed.
import { describe, expect, it } from "vitest";
import { boxBlur, photoRoadTexture, PHOTO_H, PHOTO_W } from "../src/core/photoSurface";
import { planRoad } from "../src/core/road";
import { withDefaults } from "../src/core/options";
import type { RasterSampler } from "../src/core/trace";
import type { Vec2 } from "../src/core/geo";
import { photo } from "./fixtures/golden-mesh/inputs";

const W = 32, H = 256;
// A 9 m road along y = 0, x -300..300 (left is +y).
const path: Vec2[] = Array.from({ length: 31 }, (_, i) => [i * 20 - 300, 0]);
const plan = planRoad(path, withDefaults({ widthOverride: 9 }));
const n = plan.samples.length;
/** First sample at or past x. */
const at = (x: number) => plan.samples.findIndex((s) => s.pos[0] >= x);
const a0 = at(-250), b0 = at(-190); // a 60 m chunk

function noisy(base: (x: number, y: number) => [number, number, number]): RasterSampler {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return (x, y) => {
    const e = (rnd() - 0.5) * 0.03;
    const [r, g, b] = base(x, y);
    return [r + e, g + e, b + e];
  };
}
const grey = (v: number) => noisy(() => [v, v, v * 1.04]);
const mean = (rgba: Uint8Array, ch = -1, rows: [number, number] = [0, H], cols: [number, number] = [0, W], w = W) => {
  let s = 0, k = 0;
  for (let r = rows[0]; r < rows[1]; r++) {
    for (let c = cols[0]; c < cols[1]; c++) {
      const o = (r * w + c) * 4;
      s += ch < 0 ? (rgba[o] + rgba[o + 1] + rgba[o + 2]) / 3 : rgba[o + ch];
      k++;
    }
  }
  return s / k;
};

describe("photoRoadTexture", () => {
  it("returns W x H opaque pixels, the same every time", () => {
    const t = photoRoadTexture(plan, grey(0.3), a0, b0, () => true, W, H);
    expect([t.width, t.height, t.rgba.length]).toEqual([W, H, W * H * 4]);
    for (let i = 3; i < t.rgba.length; i += 4) expect(t.rgba[i]).toBe(255);
    expect(photoRoadTexture(plan, grey(0.3), a0, b0, () => true, W, H).rgba).toEqual(t.rgba);
    expect([PHOTO_W, PHOTO_H]).toEqual([256, 4096]);
  });

  it("puts the left edge in column 0 and the chunk start in row 0", () => {
    const leftDark = photoRoadTexture(plan, noisy((_x, y) => (y > 0 ? [0.25, 0.25, 0.26] : [0.35, 0.35, 0.36])), a0, b0, () => true, W, H);
    expect(mean(leftDark.rgba, -1, [0, H], [0, 12])).toBeLessThan(mean(leftDark.rgba, -1, [0, H], [20, W]) - 1);
    const sA = plan.samples[a0].s;
    const startDark = photoRoadTexture(plan, noisy((x) => (x - plan.samples[a0].pos[0] < 5 ? [0.15, 0.15, 0.16] : [0.35, 0.35, 0.36])), a0, b0, () => true, W, H);
    expect(sA).toBeGreaterThan(0);
    expect(mean(startDark.rgba, -1, [0, 12])).toBeLessThan(mean(startDark.rgba, -1, [100, 160]) - 3);
  });

  it("paints out line paint and cars", () => {
    const t = photoRoadTexture(plan, photo(), 0, 120, () => true, 64, 1024);
    let red = 0, white = 0;
    for (let i = 0; i < t.rgba.length; i += 4) {
      const [r, g, b] = [t.rgba[i], t.rgba[i + 1], t.rgba[i + 2]];
      if (r > 150 && g < 80) red++;
      if (r > 170 && g > 170 && b > 170) white++;
    }
    expect(red).toBe(0);
    expect(white).toBe(0);
  });

  it("evens out a 10 m shadow band", () => {
    const x0 = plan.samples[a0].pos[0];
    const t = photoRoadTexture(plan, noisy((x) => (x > x0 + 25 && x < x0 + 35 ? [0.19, 0.19, 0.2] : [0.38, 0.38, 0.4])), a0, b0, () => true, W, H);
    const len = plan.samples[b0].s - plan.samples[a0].s;
    const row = (d: number) => Math.floor((d / len) * H); // d metres into the chunk
    expect(mean(t.rgba, -1, [row(29), row(31)]) / mean(t.rgba, -1, [row(5), row(15)])).toBeGreaterThan(0.85);
  });

  it("tones any uniform grey to typical asphalt brightness", () => {
    for (const v of [0.15, 0.3, 0.6]) {
      const m = mean(photoRoadTexture(plan, grey(v), a0, b0, () => true, W, H).rgba);
      expect(Math.abs(m - 0.3 * 255 * (1 + 0.04 / 3))).toBeLessThan(3);
    }
  });

  it("fills untrusted rows with the stretch's typical colour", () => {
    const lo = Math.round(a0 + (b0 - a0) / 3), hi = Math.round(a0 + (2 * (b0 - a0)) / 3);
    const t = photoRoadTexture(plan, noisy(() => [0.28, 0.3, 0.36]), a0, b0, (i) => i < lo || i >= hi, W, H);
    for (const ch of [0, 1, 2]) {
      const mid = mean(t.rgba, ch, [Math.round(H * 0.4), Math.round(H * 0.6)]);
      const rest = mean(t.rgba, ch, [0, Math.round(H * 0.25)]);
      expect(Math.abs(mid - rest)).toBeLessThan(4);
      expect(mid).toBeGreaterThan(40);
    }
  });

  it("falls back to toned grey when nothing is trusted or there is no photo", () => {
    for (const t of [photoRoadTexture(plan, grey(0.3), a0, b0, () => false, W, H), photoRoadTexture(plan, () => null, a0, b0, () => true, W, H)]) {
      const [r, g, b] = [0, 1, 2].map((ch) => mean(t.rgba, ch));
      expect(Math.abs((r + g + b) / 3 - 76.5)).toBeLessThan(3);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(5);
    }
  });

  it("wraps the last chunk of a closed loop back to sample 0", () => {
    const ring: Vec2[] = Array.from({ length: 41 }, (_, i) => [Math.cos((i / 40) * Math.PI * 2) * 150, Math.sin((i / 40) * Math.PI * 2) * 100]);
    const loop = planRoad(ring, withDefaults({ widthOverride: 8 }));
    expect(loop.closed).toBe(true);
    const ln = loop.samples.length;
    const seen: Vec2[] = [];
    photoRoadTexture(loop, (x, y) => (seen.push([x, y]), [0.3, 0.3, 0.3]), ln - 40, ln, () => true, W, H);
    const p = loop.samples[ln - 1].pos, q = loop.samples[0].pos;
    const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const gap = Math.hypot(q[0] - p[0], q[1] - p[1]);
    expect(seen.some((s) => Math.hypot(s[0] - mid[0], s[1] - mid[1]) < gap / 2 + 4)).toBe(true);
    const last = seen.slice(-W);
    const centre: Vec2 = [(last[0][0] + last[W - 1][0]) / 2, (last[0][1] + last[W - 1][1]) / 2];
    expect(Math.hypot(centre[0] - q[0], centre[1] - q[1])).toBeLessThan(gap);
  });

  it("refuses a chunk past the end of an open road", () => {
    expect(() => photoRoadTexture(plan, grey(0.3), n - 10, n, () => true, W, H)).toThrow();
  });

  it("seeds the grain from the chunk start, averaging out to nothing", () => {
    const flat: RasterSampler = () => [0.3, 0.3, 0.3];
    const t1 = photoRoadTexture(plan, flat, a0, b0, () => true, W, H);
    const t2 = photoRoadTexture(plan, flat, a0 + 1, b0 + 1, () => true, W, H);
    expect(t1.rgba).not.toEqual(t2.rgba);
    // Uniform input: gain = tone, so R and G are 0.3 * 255 plus grain (truncated: about -0.5).
    expect(Math.abs(mean(t1.rgba, 0) - (76.5 - 0.5))).toBeLessThan(0.5);
  });
});

describe("boxBlur", () => {
  const w = 9, h = 7;
  const spot = () => {
    const a = new Float32Array(w * h);
    a[3 * w + 4] = 1;
    return a;
  };
  it("spreads one pixel over a (2rc+1) x (2rr+1) box", () => {
    const out = boxBlur(spot(), w, h, 2, 1);
    let nonzero = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (out[y * w + x] > 0) {
      nonzero++;
      expect(Math.abs(x - 4)).toBeLessThanOrEqual(2);
      expect(Math.abs(y - 3)).toBeLessThanOrEqual(1);
      expect(out[y * w + x]).toBeCloseTo(1 / 15, 6);
    }
    expect(nonzero).toBe(15);
  });

  it("averages fewer pixels at the edges and equals a direct 2D box mean", () => {
    const src = new Float32Array(w * h).map((_, i) => ((i * 37) % 11) / 10);
    const [rc, rr] = [2, 3];
    const out = boxBlur(src, w, h, rc, rr);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, k = 0;
        for (let yy = Math.max(0, y - rr); yy <= Math.min(h - 1, y + rr); yy++) for (let xx = Math.max(0, x - rc); xx <= Math.min(w - 1, x + rc); xx++) {
          s += src[yy * w + xx];
          k++;
        }
        expect(out[y * w + x]).toBeCloseTo(s / k, 5);
      }
    }
    const corner = boxBlur(spot().fill(0).fill(1, 0, 1), w, h, 1, 1);
    expect(corner[0]).toBeCloseTo(1 / 4, 6);
  });
});
