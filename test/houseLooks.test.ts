import { describe, expect, it } from "vitest";
import { FACADES } from "../src/core/buildingStyles";
import { facadeForLook, facadeForStyle } from "../src/core/houseLooks";

const name = (i: number | undefined) => (i === undefined ? undefined : FACADES[i].name);

describe("house looks on upstream's facades", () => {
  it("picks the facade of the look's wall kind nearest its colour", () => {
    // Mac's house: blue weatherboard.
    expect(name(facadeForLook("weatherboard", [112, 138, 162], 0))).toBe("wb_blue");
    expect(name(facadeForLook("weatherboard", [240, 238, 230], 0))).toBe("wb_white");
    expect(name(facadeForLook("creambrick", undefined, 0))).toBe("brick_cream");
    // ...or one named outright.
    expect(name(facadeForLook("wb_blue", undefined, 0))).toBe("wb_blue");
  });

  it("keeps the current facade when it's already the right kind, and ignores kinds it doesn't know", () => {
    const sage = FACADES.findIndex((f) => f.name === "wb_sage");
    expect(facadeForLook("weatherboard", undefined, sage)).toBe(sage);
    expect(facadeForLook("thatch", undefined, sage)).toBeUndefined();
  });

  it("gives an area its own mix, the same pick for a house every time", () => {
    const style = { wb_white: 3, wb_grey: 1, nonsense: 5 };
    const a = facadeForStyle(style, [10, 20]), b = facadeForStyle(style, [10, 20]);
    expect(a).toBe(b);
    const picks = new Set(Array.from({ length: 200 }, (_, i) => name(facadeForStyle(style, [i * 13.7, i * 7.1]))));
    expect([...picks].sort()).toEqual(["wb_grey", "wb_white"]);
  });
});

describe("wall mesh names", () => {
  it("keep AC's surface names out (render_sand isn't a sand wall)", async () => {
    const { buildBuildings, plainHouse } = await import("../src/core/buildings");
    const { FACADE_INDEX } = await import("../src/core/buildingStyles");
    const b = { ...plainHouse("hip", 0, 3), ring: [[0, 0], [12, 0], [12, 10], [0, 10]] as [number, number][], source: "osm" as const, facade: FACADE_INDEX.get("render_sand")! };
    const walls = buildBuildings([b], () => 0).filter((m) => m.name.startsWith("1WALL_BLD_"));
    expect(walls.length).toBeGreaterThan(0);
    for (const m of walls) {
      expect(m.name).not.toMatch(/sand|grass|kerb|road/i);
      expect(m.material).toBe("facade_render_sand");
    }
  });
});
