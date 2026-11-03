import { describe, expect, it } from "vitest";
import { buildUte, UTE_DEFAULTS } from "../src/core/vehicles/ute";
import { atlasPixels, ATLAS_H, ATLAS_W, type VehicleMesh } from "../src/core/vehicles/vehicle";

const tris = (m: VehicleMesh) => m.idx.length / 3;
const bounds = (m: VehicleMesh) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i += 3) for (let c = 0; c < 3; c++) {
    lo[c] = Math.min(lo[c], m.pos[i + c]);
    hi[c] = Math.max(hi[c], m.pos[i + c]);
  }
  return { lo, hi };
};

describe("local cars: dual-cab ute", () => {
  it("stays inside the triangle budget per LOD", () => {
    expect(tris(buildUte({}, 0))).toBeLessThanOrEqual(300);
    expect(tris(buildUte({}, 1))).toBeLessThanOrEqual(100);
    const tradie = { bullBar: true, snorkel: true, tray: "canopy" as const, roofRack: true };
    expect(tris(buildUte(tradie, 0))).toBeLessThanOrEqual(400);
    expect(tris(buildUte(tradie, 1))).toBeLessThanOrEqual(160);
  });

  it("is a valid mesh: whole triangles, indices in range, uvs inside the atlas, no NaN", () => {
    for (const lod of [0, 1] as const) {
      const m = buildUte({ tray: "rack", bullBar: true, snorkel: true, roofRack: true }, lod);
      const n = m.pos.length / 3;
      expect(m.idx.length % 3).toBe(0);
      expect(m.uv.length).toBe(n * 2);
      expect(m.paint.length).toBe(n);
      expect(m.idx.every((i) => Number.isInteger(i) && i >= 0 && i < n)).toBe(true);
      expect(m.pos.every(Number.isFinite)).toBe(true);
      expect(m.uv.every((v) => v >= 0 && v <= 1)).toBe(true);
    }
  });

  it("stands on the ground at its real size", () => {
    const { lo, hi } = bounds(buildUte({}, 0));
    expect(lo[2]).toBeGreaterThanOrEqual(0);
    expect(lo[2]).toBeLessThan(0.03); // tyres touch
    expect(hi[0] - lo[0]).toBeCloseTo(UTE_DEFAULTS.length, 1);
    expect(hi[2]).toBeCloseTo(UTE_DEFAULTS.height, 1);
    // Body width plus mirrors.
    expect(hi[1] - lo[1]).toBeGreaterThan(UTE_DEFAULTS.width);
    expect(hi[1] - lo[1]).toBeLessThan(UTE_DEFAULTS.width + 0.45);
  });

  it("is the same every time (a bay's car never changes between builds)", () => {
    expect(JSON.stringify(buildUte({ tray: "sportsBar" }, 0))).toBe(JSON.stringify(buildUte({ tray: "sportsBar" }, 0)));
  });

  it("has paint on the body and something that isn't paint (glass, tyres)", () => {
    const m = buildUte({}, 0);
    const painted = m.paint.filter(Boolean).length;
    expect(painted).toBeGreaterThan(m.paint.length * 0.3);
    expect(painted).toBeLessThan(m.paint.length * 0.8);
  });

  it("draws an atlas of the right size", () => {
    expect(atlasPixels().length).toBe(ATLAS_W * ATLAS_H * 4);
  });
});
