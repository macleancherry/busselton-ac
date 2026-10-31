import { describe, expect, it } from "vitest";
import { applyColours, matchColours } from "../src/core/colour";

/** RGBA pixels from a per-pixel colour function. */
function image(n: number, f: (i: number) => [number, number, number, number?]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b, a = 255] = f(i);
    px.set([r, g, b, a], i * 4);
  }
  return px;
}

/** Deterministic pseudo-random 0..1. */
const noise = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const bush = image(64 * 64, (i) => [40 + 50 * noise(i, 1), 80 + 70 * noise(i, 2), 30 + 40 * noise(i, 3)]);

describe("matchColours / applyColours", () => {
  it("removes a hazy blue cast", () => {
    const cast = bush.map((v, j) => {
      const c = j % 4;
      if (c === 3) return v;
      return v * 0.7 + (c === 2 ? 60 : 25);
    }) as Uint8ClampedArray;
    const t = matchColours(cast, bush);
    expect(t).not.toBeNull();
    const fixed = cast.slice();
    applyColours(fixed, t!);
    for (const i of [0, 17, 500, 2048, 4095]) {
      for (let c = 0; c < 3; c++) expect(Math.abs(fixed[i * 4 + c] - bush[i * 4 + c])).toBeLessThanOrEqual(3);
    }
  });

  it("gives the identity for identical images", () => {
    const t = matchColours(bush, bush.slice())!;
    t.gain.forEach((g) => expect(g).toBeCloseTo(1, 12));
    t.offset.forEach((o) => expect(o).toBeCloseTo(0, 9));
  });

  it("needs at least 64 opaque pixels", () => {
    const few = image(63, (i) => [i, i, i]);
    const enough = image(64, (i) => [i, i, i]);
    const mostlyClear = image(200, (i) => [i, i, i, i < 63 ? 255 : 0]);
    expect(matchColours(few, bush)).toBeNull();
    expect(matchColours(bush, few)).toBeNull();
    expect(matchColours(mostlyClear, bush)).toBeNull();
    expect(matchColours(enough, bush)).not.toBeNull();
    expect(matchColours(new Uint8Array(0), bush)).toBeNull();
  });

  it("ignores transparent pixels when fitting", () => {
    const base = matchColours(bush, bush)!;
    const wild = new Uint8ClampedArray(bush.length + 400);
    wild.set(bush);
    for (let i = bush.length; i < wild.length; i += 4) wild.set([255, 0, 255, 127], i);
    expect(matchColours(wild, bush)).toEqual(base);
  });

  it("clamps the gain to 0.5..2 and still matches the means", () => {
    const src = image(256, (i) => [100 + (i % 2 ? 10 : -10), 100, 100]);
    const wide = image(256, (i) => [120 + (i % 2 ? 40 : -40), 100, 100]);
    const narrow = image(256, (i) => [80 + (i % 2 ? 2.5 : -2.5), 100, 100]);
    const tw = matchColours(src, wide)!;
    expect(tw.gain[0]).toBe(2);
    expect(100 * tw.gain[0] + tw.offset[0]).toBeCloseTo(120, 9);
    const tn = matchColours(src, narrow)!;
    expect(tn.gain[0]).toBe(0.5);
    expect(100 * tn.gain[0] + tn.offset[0]).toBeCloseTo(80, 9);
  });

  it("copes with a flat source channel", () => {
    const flat = image(100, () => [50, 50, 50]);
    const t = matchColours(flat, bush)!;
    for (const v of [...t.gain, ...t.offset]) expect(Number.isFinite(v)).toBe(true);
  });

  it("clamps, rounds half up and leaves alpha alone", () => {
    const px = new Uint8Array([200, 10, 51, 0, 100, 20, 30, 255]);
    applyColours(px, { gain: [2, 1, 2.5], offset: [0, -20, 0] });
    expect([...px]).toEqual([255, 0, 128, 0, 200, 0, 75, 255]);
  });

  it("ignores a trailing partial pixel", () => {
    const px = new Uint8Array([10, 10, 10, 255, 10, 10]);
    applyColours(px, { gain: [2, 2, 2], offset: [0, 0, 0] });
    expect([...px]).toEqual([20, 20, 20, 255, 10, 10]);
    const ragged = new Uint8ClampedArray(bush.length + 3);
    ragged.set(bush);
    ragged.set([0, 0, 0], bush.length);
    expect(matchColours(ragged, bush)).toEqual(matchColours(bush, bush));
  });

  it("works the same on Uint8Array and Uint8ClampedArray", () => {
    const cast = bush.map((v, j) => (j % 4 === 3 ? v : v * 0.8 + 10)) as Uint8ClampedArray;
    const t1 = matchColours(cast, bush)!;
    const t2 = matchColours(new Uint8Array(cast), new Uint8Array(bush))!;
    expect(t2).toEqual(t1);
    const a = cast.slice();
    const b = new Uint8Array(cast);
    applyColours(a, t1);
    applyColours(b, t1);
    expect([...b]).toEqual([...a]);
  });
});
