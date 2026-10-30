import { describe, expect, it } from "vitest";
import { landmarkGround } from "../src/core/landmarkGround";
import type { Kn5Model } from "../src/core/kn5";
import { MeshBuilder } from "../src/core/mesh";

/** A flat square mesh, x0..x1 by y0..y1 (local metres, y north) at height z. */
const square = (name: string, x0: number, y0: number, x1: number, y1: number, z: number) => {
  const mb = new MeshBuilder();
  const a = mb.vertex([x0, y0, z], 0, 0), b = mb.vertex([x1, y0, z], 1, 0), c = mb.vertex([x1, y1, z], 1, 1), d = mb.vertex([x0, y1, z], 0, 1);
  mb.quad(a, b, c, d);
  return mb.toKn5(name, "grass");
};

// A country build: a 140 m strip of detailed terrain along a road (x -70..70) at 12 m, under a
// horizon mesh out to 1 km at 30 m (the ground rises away from the road).
const world: Kn5Model = {
  textures: [],
  materials: [],
  root: {
    kind: "node", name: "root", transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    children: [
      square("1GRASS_t000", -70, -500, 70, 500, 12),
      square("1WALL_shed", 75, 0, 80, 5, 40),
      square("BACKDROP_b000", -1000, -1000, 1000, 1000, 30),
    ],
  },
};

describe("landmark ground", () => {
  it("stands on the physics terrain where there is some, and on the nearest within 40 m", () => {
    const g = landmarkGround(world);
    expect(g(0, 0)).toBeCloseTo(12, 5);
    expect(g.source(0, 0)).toBe("terrain");
    expect(g(100, 0)).toBeCloseTo(12, 5); // 30 m off the terrain's edge (the wall doesn't count)
    expect(g.source(100, 0)).toBe("near");
  });

  it("falls back to the horizon mesh far from the road, not 0", () => {
    const g = landmarkGround(world);
    expect(g(250, 100)).toBeCloseTo(30, 5);
    expect(g.source(250, 100)).toBe("backdrop");
  });

  it("then to the DEM, then 0", () => {
    const dem = (x: number) => (x > 0 ? 55 : null);
    const g = landmarkGround(world, { dem });
    expect(g(1500, 0)).toBe(55);
    expect(g.source(1500, 0)).toBe("dem");
    expect(g(-1500, 0)).toBe(0);
    expect(g.source(-1500, 0)).toBe("none");
    expect(landmarkGround(world)(1500, 0)).toBe(0);
  });
});
