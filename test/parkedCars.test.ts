import { describe, expect, it } from "vitest";
import { carsInBlob } from "../src/core/carpark";
import { buildParkedCars, paintFor, PAINT } from "../src/core/parkedCars";

describe("parked cars", () => {
  const size = 200, mpp = 0.25;
  const rgba = new Uint8Array(size * size * 4).fill(200);
  const rect = (x0: number, y0: number, w: number, h: number) => {
    const out: number[] = [];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push(y * size + x);
    return out;
  };

  it("splits a blob into cars the right way round", () => {
    // One car, 4.5 x 1.8 m, along x.
    const one = carsInBlob(rect(50, 50, 18, 7), size, mpp, rgba);
    expect(one).toHaveLength(1);
    expect(Math.abs(one[0].dir[0])).toBeCloseTo(1, 1);
    // Three cars end to end along a kerb: 16.8 x 1.8 m.
    expect(carsInBlob(rect(20, 100, 67, 7), size, mpp, rgba)).toHaveLength(3);
    // A row of five nose-in bays: 13 m along x, 4.6 m deep, cars pointing across (along y).
    const bays = carsInBlob(rect(20, 140, 52, 18), size, mpp, rgba);
    expect(bays).toHaveLength(5);
    for (const c of bays) expect(Math.abs(c.dir[1])).toBeCloseTo(1, 1);
    // Two rows back to back: 9 m deep.
    expect(carsInBlob(rect(100, 20, 52, 36), size, mpp, rgba)).toHaveLength(10);
  });

  it("picks paint from the photo colour", () => {
    expect(PAINT[paintFor([0.85, 0.85, 0.84])][0]).toBeGreaterThan(220); // white
    expect(PAINT[paintFor([0.12, 0.12, 0.13])][0]).toBeLessThan(40); // black
    // A car in shade: grey with a blue cast is still a neutral, not navy.
    const shaded = PAINT[paintFor([0.3, 0.33, 0.42])];
    expect(Math.max(...shaded) - Math.min(...shaded)).toBeLessThan(10);
    const red = PAINT[paintFor([0.5, 0.2, 0.2])];
    expect(red[0]).toBeGreaterThan(red[1] * 2);
  });

  it("builds a visual car and a box to hit, facing outwards", () => {
    const meshes = buildParkedCars([{ at: [10, 20], dir: [1, 0], paint: 0 }], () => 5);
    const vis = meshes.find((m) => m.name.startsWith("PARKED_CARS"))!;
    expect(meshes.some((m) => m.name.startsWith("1WALL_CAR"))).toBe(true);
    expect(vis.indices.length / 3).toBeLessThan(80);
    // Every triangle of the body and cabin faces away from the car's centre line (AC space: x, y up, -z north).
    const p = vis.positions;
    let bad = 0, checked = 0;
    for (let t = 0; t < vis.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => vis.indices[t + k] * 3);
      const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const cen = [(p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3, (p[a + 2] + p[b + 2] + p[c + 2]) / 3];
      if (cen[1] - 5 < 0.65) continue; // wheels
      checked++;
      const out = [cen[0] - 10, cen[1] - 5.5, cen[2] - -20];
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] <= 0) bad++;
    }
    expect(checked).toBeGreaterThan(10);
    expect(bad).toBe(0);
  });
});
