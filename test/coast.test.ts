import { describe, expect, it } from "vitest";
import { buildPiers, buildSea, SEA_LEVEL, SeaMask, withSeabed, type CoastPolygon } from "../src/core/coast";

// Sea north of y = 100; a jetty 6 m wide from the beach (y = 80) 400 m out.
const ocean: CoastPolygon = { rings: [[[-500, 100], [500, 100], [500, 1000], [-500, 1000]]], edge: [[true, true, true, true]] };
const jetty: CoastPolygon = { rings: [[[-3, 80], [3, 80], [3, 480], [-3, 480]]], edge: [[true, true, true, true]] };
const land = (_x: number, y: number) => (y < 100 ? 2 - y / 100 : 0);

describe("coast", () => {
  const sea = new SeaMask([ocean], -600, -100, 600, 1100);
  it("knows where the sea is and drops the seabed under it", () => {
    expect(sea.has(0, 200)).toBe(true);
    expect(sea.has(0, 50)).toBe(false);
    const g = withSeabed(land, sea);
    expect(g(0, 200)).toBeLessThan(SEA_LEVEL - 1);
    expect(g(0, 50)).toBe(land(0, 50));
  });

  it("lays a flat water surface facing up", () => {
    const [m] = buildSea([ocean]);
    for (let i = 1; i < m.positions.length; i += 3) expect(m.positions[i]).toBeCloseTo(SEA_LEVEL);
    for (let i = 1; i < m.normals.length; i += 3) expect(m.normals[i]).toBeGreaterThan(0.99);
  });

  it("builds a jetty deck above the water, on piles only over the sea", () => {
    const g = withSeabed(land, sea);
    const meshes = buildPiers([jetty], g, sea);
    const deck = meshes.find((m) => m.name === "JETTY_DECK")!;
    for (let i = 1; i < deck.positions.length; i += 3) expect(deck.positions[i]).toBeGreaterThan(SEA_LEVEL + 3);
    const timber = meshes.find((m) => m.name.startsWith("JETTY_TIMBER"))!;
    // piles reach down to the seabed
    const ys = Array.from(timber.positions).filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeLessThan(-1.5);
    // and no pile stands on the beach (AC z = -y)
    for (let i = 0; i < timber.positions.length; i += 3) {
      if (timber.positions[i + 1] < 0) expect(-timber.positions[i + 2]).toBeGreaterThan(100);
    }
  });
});
