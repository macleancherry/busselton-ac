import { describe, expect, it } from "vitest";
import { BAY_ASPHALT, BAY_FALL, bayHeight, nearestAsphalt, PAD_LIFT } from "../src/core/bayGround";
import { buildBayPads } from "../src/core/parkedPlacement";
import { buildParkedCars, carSeat, MAX_TILT } from "../src/core/parkedCars";
import { offAsphaltAt } from "../src/core/parkedCheck";
import { PATH_BLOCK } from "../src/core/paths";
import { groundOver, topSurface } from "../src/core/sceneGround";
import { MeshBuilder } from "../src/core/mesh";

/** A flat-sided square mesh, x0..x1 by y0..y1 (local metres, y north), heights from z. */
const square = (name: string, x0: number, y0: number, x1: number, y1: number, z: number | ((x: number, y: number) => number)) => {
  const h = typeof z === "number" ? () => z : z;
  const mb = new MeshBuilder();
  const a = mb.vertex([x0, y0, h(x0, y0)], 0, 0), b = mb.vertex([x1, y0, h(x1, y0)], 1, 0), c = mb.vertex([x1, y1, h(x1, y1)], 1, 1), d = mb.vertex([x0, y1, h(x0, y1)], 0, 1);
  mb.quad(a, b, c, d);
  return mb.toKn5(name, "grass");
};

describe("car park bay pads", () => {
  // An aisle (x < 0) 20 cm over the terrain, and terrain that dips 25 cm beside it and comes back up by x = 6.
  const aisle = topSurface([square("1STREET_007", -20, -20, 0, 20, 10.2)], BAY_ASPHALT);
  const ground = (x: number, y: number) => aisle(x, y) ?? (x < 6 ? 9.95 + (0.2 * x) / 6 : 10.15);
  const height = bayHeight(ground, aisle);

  it("is the aisle itself over the aisle, and falls gently away from its edge", () => {
    expect(height(-3, 0)).toBeCloseTo(10.2, 5);
    expect(nearestAsphalt(aisle, 2, 0)?.d).toBeCloseTo(2, 5);
    // Just off the edge: the aisle carried on at BAY_FALL, over the dip.
    expect(height(1, 0)).toBeCloseTo(10.2 - BAY_FALL * 1, 2);
    // Out of reach of the aisle: the ground plus the lift.
    expect(height(15, 0)).toBeCloseTo(ground(15, 0) + PAD_LIFT, 6);
  });

  it("never steps more than 3 cm between points 25 cm apart, and never sits under the ground", () => {
    for (let x = -2; x < 14; x += 0.25) {
      expect(Math.abs(height(x + 0.25, 0) - height(x, 0))).toBeLessThan(0.03);
      expect(height(x, 0)).toBeGreaterThanOrEqual(ground(x, 0) - 1e-9);
    }
  });

  it("builds pads flush with the aisle where they overlap it, and no ground comes up through them", () => {
    // Bumpy ground off the aisle: the pad's flat cells are raised where it bulges between their corners.
    const bumpy = (x: number, y: number) => aisle(x, y) ?? 10 + 0.06 * Math.sin(x * 2.3) * Math.cos(y * 1.7);
    const pads = buildBayPads([[[-2, 0], [6, 0], [6, 5.4], [-2, 5.4]]], bumpy, bayHeight(bumpy, aisle));
    const p = pads[0].positions;
    for (let i = 0; i < p.length; i += 3) if (p[i] < -1e-6) expect(p[i + 1]).toBeCloseTo(10.2, 6);
    const pad = topSurface(pads);
    for (let x = -1.9; x < 6; x += 0.13) for (let y = 0.05; y < 5.4; y += 0.17) {
      const h = pad(x, y);
      if (h !== null) expect(h).toBeGreaterThanOrEqual(bumpy(x, y) - 0.002);
    }
  });
});

describe("parked cars on uneven ground", () => {
  it("tilt with the ground, every tyre touching", () => {
    const ground = (x: number, y: number) => 5 + 0.04 * x + 0.02 * y;
    const car = { at: [10, 10] as [number, number], dir: [1, 0] as [number, number], paint: 0 };
    const seat = carSeat(car, ground);
    expect(seat.pitch).toBeCloseTo(0.04, 6);
    expect(seat.roll).toBeCloseTo(0.02, 6);
    // The tyre bottoms (2 cm over the base) at the four contacts are on the ground.
    for (const [f, s] of [[1.4, 0.74], [1.4, -0.74], [-1.4, 0.74], [-1.4, -0.74]])
      expect(seat.z + seat.pitch * f + seat.roll * s + 0.02).toBeCloseTo(ground(10 + f, 10 + s), 6);
    // The mesh's lowest points follow the slope: the front tyres lower than the back ones by the slope's fall.
    const m = buildParkedCars([car], ground)[0];
    let front = Infinity, back = Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      const x = m.positions[i], h = m.positions[i + 1];
      if (x > 11) front = Math.min(front, h);
      if (x < 9) back = Math.min(back, h);
    }
    expect(front - back).toBeCloseTo(0.04 * 2.8, 2);
  });

  it("past MAX_TILT, no tyre is off the ground", () => {
    const ground = (x: number) => (x > 10 ? 7 : 5);
    const car = { at: [10, 0] as [number, number], dir: [1, 0] as [number, number], paint: 0 };
    const seat = carSeat(car, ground);
    expect(seat.pitch).toBe(MAX_TILT);
    const tyre = (f: number) => seat.z + seat.pitch * f + 0.02;
    expect(tyre(-1.4)).toBeCloseTo(5, 6);
    expect(tyre(1.4)).toBeLessThanOrEqual(7);
  });

  it("finds a wheel off the asphalt", () => {
    const meshes = [square("1GRASS_t000", -20, -20, 20, 20, 1), square("1STREET_CARPARK_000", -20, -20, 1, 20, 1.01)];
    const top = topSurface(meshes), asphalt = topSurface(meshes, /^\dSTREET/);
    expect(offAsphaltAt({ at: [-5, 0], dir: [1, 0] }, top, asphalt)).toBeNull();
    expect(offAsphaltAt({ at: [0, 0], dir: [1, 0] }, top, asphalt)).toEqual([1.4, 0.74]);
  });
});

describe("buildings at the terrain mesh's edge", () => {
  // The mesh covers x < 0 at 10 m; past it the fallback (the analytic terrain) is far lower.
  const g = groundOver(topSurface([square("1GRASS_t000", -50, -50, 0, 50, 10)]), () => 9.5);
  const ring: [number, number][] = [[-6, 0], [4, 0], [4, 8], [-6, 8]];

  it("takes the mesh's lowest along a ring that straddles its edge", () => {
    expect(g.underRing(ring)).toBeCloseTo(10, 6);
    // Wholly off the mesh: the fallback.
    expect(g.underRing([[10, 0], [14, 0], [14, 4], [10, 4]])).toBeCloseTo(9.5, 6);
  });

  it("gives such a footprint a ground that never drops under the mesh's", () => {
    const f = g.forRing(ring);
    expect(f(-3, 4)).toBeCloseTo(10, 6);
    expect(f(3, 4)).toBeCloseTo(10, 6);
    expect(Math.min(...ring.map(([x, y]) => f(x, y)))).toBeCloseTo(10, 6);
  });
});

describe("paths kept off built roads", () => {
  it("blocks roads, streets, their fills and kerbs, not footpaths or crossovers", () => {
    for (const n of ["1ROAD_010", "1STREET_005_T8", "1STREET_RETFILL", "1KERB_RET_T14", "1ROAD_GUTTER_RET", "1STREET_CARPARK_000"]) expect(PATH_BLOCK.test(n)).toBe(true);
    for (const n of ["1ROAD_PATH_FOOT_T69", "1STREET_PATH_000", "1STREET_DRIVE_003", "1GRASS_t040", "1GRASS_STRIP_RET"]) expect(PATH_BLOCK.test(n)).toBe(false);
  });
});
