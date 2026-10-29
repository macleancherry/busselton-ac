import { describe, expect, it } from "vitest";
import { buildBuildings, facadeMaterial, type Building } from "../src/core/buildings";
import { facadeTexture } from "../src/core/houseTextures";
import { decodeOwnPng } from "../src/core/png";

const house = (extra: Partial<Building> = {}): Building => ({
  ring: [[0, 0], [12, 0], [12, 10], [0, 10]], height: 2.8, roof: "hip", roofColour: 0, facade: 1, source: "osm", ...extra,
});

describe("hand-set house looks", () => {
  it("gives a coloured house its own wall material", () => {
    expect(facadeMaterial(house())).toBe("facade_weatherboard");
    const blue = house({ wallColour: [110, 140, 170] });
    expect(facadeMaterial(blue)).toBe("facade_weatherboard_6e8caa");
    const mats = buildBuildings([house(), blue], () => 0).filter((m) => m.name.startsWith("1WALL_BLD")).map((m) => m.material);
    expect(new Set(mats)).toEqual(new Set(["facade_weatherboard", "facade_weatherboard_6e8caa"]));
  });

  it("paints the facade pattern in the colour", () => {
    const { rgba, width } = decodeOwnPng(facadeTexture("weatherboard", [110, 140, 170]));
    // A plain wall pixel near the top left (above the windows): blue, not white.
    const i = (10 * width + 10) * 4;
    expect(rgba[i + 2]).toBeGreaterThan(rgba[i] + 30);
    expect(rgba[i]).toBeLessThan(150);
  });
});
