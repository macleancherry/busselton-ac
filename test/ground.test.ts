import { describe, expect, it } from "vitest";
import { classify, groundMask } from "../src/core/ground";

const top = (w: number[]) => w.indexOf(Math.max(...w));

describe("ground mask", () => {
  it("reads lawn, dry grass, sand and garden beds off photo colours", () => {
    expect(top(classify(0.32, 0.45, 0.22))).toBe(0); // watered lawn
    expect(top(classify(0.62, 0.56, 0.38))).toBe(1); // straw-coloured verge in summer
    expect(top(classify(0.86, 0.82, 0.74))).toBe(2); // beach sand
    expect(top(classify(0.16, 0.14, 0.12))).toBe(3); // dark garden bed / shade
    expect(top(classify(0.42, 0.3, 0.22))).toBe(3); // brown mulch
    expect(top(classify(0.1, 0.45, 0.45))).toBe(2); // shallow teal sea: seabed sand, not lawn
    expect(top(classify(0.12, 0.25, 0.35))).toBe(2); // deeper water
    expect(top(classify(0.16, 0.47, 0.41))).toBe(2); // Geographe Bay teal, measured off the Landgate photo
  });

  it("always gives a pixel some weight and normalises the mask", () => {
    const size = 16;
    const rgba = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) rgba.set(i < 128 ? [80, 120, 50, 255] : [220, 210, 190, 255], i * 4);
    const mask = groundMask(rgba, size, 8);
    for (let p = 0; p < 64; p++) {
      const sum = mask[p * 4] + mask[p * 4 + 1] + mask[p * 4 + 2] + mask[p * 4 + 3];
      expect(sum).toBeGreaterThanOrEqual(253);
      expect(sum).toBeLessThanOrEqual(257);
    }
    expect(mask[0]).toBeGreaterThan(200); // top rows: lawn
    expect(mask[63 * 4 + 2]).toBeGreaterThan(200); // bottom rows: sand
  });
});
