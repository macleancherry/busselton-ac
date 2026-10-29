import { describe, expect, it } from "vitest";
import type { Building } from "../src/core/buildings";
import { buildLots, frontWall } from "../src/core/lots";

const flat = () => 10;
// 14 m x 10 m house, front wall along y = 0, street to the south; garage at the start (west) end.
const house = (x = 0): Building => ({
  ring: [[x, 0], [x + 14, 0], [x + 14, 10], [x, 10]],
  height: 2.8, type: "house", pitch: 22, roof: "hip", roofColour: 1, facade: 0, source: "frontage",
  front: [[x, 0], [x + 14, 0]], garage: true, setback: 9,
});
// The road's edge runs along y = -9.
const roadGap = (_x: number, y: number) => y + 9;

describe("house lots", () => {
  it("finds the front wall in the counter-clockwise ring, either way round", () => {
    expect(frontWall(house()).k).toBe(0);
    const b = house();
    b.ring = b.ring.slice().reverse();
    const { ring, k } = frontWall(b);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(ring[k][1]).toBe(0);
    expect(ring[(k + 1) % 4][1]).toBe(0);
  });

  it("fences the lot, keeps out of the neighbour's house and leaves the driveway open", () => {
    const a = house(0), b = house(16.4);
    const meshes = buildLots([a, b], flat, { roadGap, seed: 5 });
    const fences = meshes.filter((m) => m.name.startsWith("1WALL_FENCE_"));
    expect(fences.length).toBeGreaterThan(0);
    for (const f of fences) {
      for (let i = 0; i < f.positions.length; i += 3) {
        const x = f.positions[i], y = -f.positions[i + 2];
        const inside = (x0: number) => x > x0 + 0.01 && x < x0 + 13.99 && y > 0.01 && y < 9.99;
        expect(inside(0) || inside(16.4)).toBe(false);
        expect(y).toBeGreaterThan(-2);
      }
    }
    for (const w of meshes.filter((m) => m.name.startsWith("1WALL_FRONT_"))) {
      for (let i = 0; i < w.positions.length; i += 3) {
        const x = w.positions[i];
        // the driveway in front of each garage (the west 3.8 m) stays open
        expect(x > 0.1 && x < 3.7).toBe(false);
        expect(x > 16.5 && x < 20.1).toBe(false);
      }
    }
  });
});
