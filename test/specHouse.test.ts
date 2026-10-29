import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildSpecHouse, nearestRoof, type HouseSpec } from "../src/core/specHouse";
import { ROOF_COLOURS } from "../src/core/buildingStyles";

const spec = JSON.parse(readFileSync("scripts/blender/example_parts.json", "utf8")) as HouseSpec;

describe("spec houses", () => {
  // The street is to the south (-y): the house faces it.
  const h = buildSpecHouse(spec, { centre: [100, 50], toRoad: [0, -1], z: 3 }, "t");

  it("builds walls, roofs, doors and windows, and solid walls to hit", () => {
    expect(h.nodes.length).toBeGreaterThan(4);
    const solid = h.nodes.find((n) => n.name.startsWith("1WALL_SPECHOUSE"));
    expect(solid?.renderable).toBe(false);
    expect(h.nodes.some((n) => n.material === "window")).toBe(true);
    expect(h.facades.map((f) => f.layout)).toEqual(h.facades.map(() => "blank"));
  });

  it("faces its street: the spec's front (y = 0) is towards the road, its left on the viewer's left", () => {
    const main = h.footprints[0];
    const ys = main.map((p) => p[1]);
    // Block "main" runs y 5..18 back from the front: further from the road (larger y here) than "front" (y 0..8).
    const front = h.footprints[2];
    expect(Math.max(...ys)).toBeGreaterThan(Math.max(...front.map((p) => p[1])));
    // Seen from the street (looking north), the garage (spec x 0..6.4) is on the left: smaller x.
    const garage = h.footprints[1];
    expect(Math.max(...garage.map((p) => p[0]))).toBeLessThan(Math.max(...front.map((p) => p[0])));
    // Centred on its position.
    const xs = h.footprints.flat().map((p) => p[0]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(100, 0);
  });

  it("puts the roof in the nearest Colorbond colour and every roof face looks up", () => {
    expect(ROOF_COLOURS[h.roof].name).toBe(ROOF_COLOURS[nearestRoof([85, 88, 91])].name);
    const roof = h.nodes.find((n) => n.material === `roof_${ROOF_COLOURS[h.roof].name}`)!;
    for (let i = 1; i < roof.normals.length; i += 3) expect(roof.normals[i]).toBeGreaterThan(0);
  });
});
