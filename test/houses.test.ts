import { describe, expect, it } from "vitest";
import { buildBuildings, type Building } from "../src/core/buildings";
import { buildLots, planGarages } from "../src/core/lots";

const flat = () => 10;
// 14 m x 10 m house, street wall (ring[0] -> ring[1]) along y = 0, street to the south.
const house = (x = 0, roof: Building["roof"] = "hip"): Building => ({
  ring: [[x, 0], [x + 14, 0], [x + 14, 10], [x, 10]],
  height: 2.8, roof, roofColour: 1, facade: 0, source: "frontage", street: 0,
});
// The road's edge runs along y = -9.
const roadGap = (_x: number, y: number) => y + 9;

describe("houses", () => {
  it("builds a hip roof with eaves, soffits underneath and a garage on the street", () => {
    const b = house();
    planGarages([b], 3);
    b.garage = "end";
    const meshes = buildBuildings([b], flat);
    const roof = meshes.find((m) => m.name.startsWith("ROOF_"))!;
    for (let i = 0; i < roof.normals.length; i += 3) expect(roof.normals[i + 1]).toBeGreaterThan(0.85);
    // Eaves: the roof reaches 0.5 m past the walls (AC x = east).
    const xs = Array.from(roof.positions).filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeLessThan(-0.4);
    expect(Math.max(...xs)).toBeGreaterThan(14.4);
    const soffit = meshes.find((m) => m.name.startsWith("SOFFIT_"))!;
    for (let i = 0; i < soffit.normals.length; i += 3) expect(soffit.normals[i + 1]).toBeLessThan(-0.8);
    expect(meshes.some((m) => m.name.startsWith("1WALL_GARAGE_brick"))).toBe(true);
  });

  it("puts a gable on the short ends", () => {
    const meshes = buildBuildings([house(0, "gable")], flat);
    const roof = meshes.find((m) => m.name.startsWith("ROOF_"))!;
    expect(roof.indices.length / 3).toBe(4);
  });

  it("fences the lot, keeps out of the neighbour's house and leaves the driveway open", () => {
    const a = house(0), b = house(16.4);
    a.garage = "end";
    b.garage = "end";
    const meshes = buildLots([a, b], flat, { roadGap, seed: 5 });
    const fences = meshes.filter((m) => m.name.startsWith("1WALL_FENCE_"));
    expect(fences.length).toBeGreaterThan(0);
    for (const f of fences) {
      for (let i = 0; i < f.positions.length; i += 3) {
        const x = f.positions[i], y = -f.positions[i + 2];
        // never inside either house
        const inside = (x0: number) => x > x0 + 0.01 && x < x0 + 13.99 && y > 0.01 && y < 9.99;
        expect(inside(0) || inside(16.4)).toBe(false);
        // never out on the verge
        expect(y).toBeGreaterThan(-2);
      }
    }
    const front = meshes.filter((m) => m.name.startsWith("1WALL_FRONT_"));
    for (const w of front) {
      for (let i = 0; i < w.positions.length; i += 3) {
        const x = w.positions[i];
        // the driveway in front of each garage (the east 6 m) stays open
        expect(x > 8.4 && x < 13.6).toBe(false);
        expect(x > 24.8 && x < 30).toBe(false);
      }
    }
  });
});
