// Buildings on water (waterBuildings.ts): generated and detected ones never go there; mapped ones
// stand, marked in the shore mask so the shore check lets them stand.
import { describe, expect, it } from "vitest";
import type { CoastPolygon } from "../src/core/coast";
import type { Vec2 } from "../src/core/geo";
import type { Kn5GroupNode, Kn5MeshNode, Kn5Node } from "../src/core/kn5";
import { checkShore, type ShoreMaskData } from "../src/core/shoreCheck";
import { SHORE_CLASSES, ShoreMask } from "../src/core/shoreClear";
import { onWater, sortWaterBuildings } from "../src/core/waterBuildings";

const box = (x0: number, y0: number, x1: number, y1: number): CoastPolygon => ({ rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]], edge: [[true, true, true, true]] });
const sq = (x: number, y: number, h = 5): Vec2[] => [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]];
// The sea south of y = 0, a lake at 150..180 x 100..130.
const shoreMask = () => new ShoreMask({ ocean: [box(0, -200, 300, 0)], water: [box(150, 100, 180, 130)] }, -20, -220, 320, 220, {}, 5);

describe("onWater", () => {
  const m = shoreMask();
  const at = (x: number, y: number) => m.at(x, y);
  it("is a footprint with its middle or a corner in the sea, a lake, a wetland or on a groyne", () => {
    expect(onWater(sq(50, -40), at)).toBe(true);
    expect(onWater(sq(160, 115), at)).toBe(true);
    expect(onWater(sq(50, 2), at)).toBe(true); // a corner over the water's edge
    expect(onWater(sq(50, 80), at)).toBe(false);
    expect(onWater(sq(50, 12), at)).toBe(false); // on the sand by the sea: not water
  });
});

describe("sortWaterBuildings", () => {
  const m = shoreMask();
  const at = (x: number, y: number) => m.at(x, y);
  it("drops detected and generated buildings on water, keeps mapped ones and lists them", () => {
    const list = [
      { ring: sq(50, -40), source: "detected" as const, id: "roof in the sea" },
      { ring: sq(160, 115), source: "frontage" as const, id: "house in the lake" },
      { ring: sq(60, -10, 4), source: "osm" as const, id: "boatshed" },
      { ring: sq(50, 80), source: "detected" as const, id: "house on land" },
      { ring: sq(90, 80), source: "osm" as const, id: "mapped on land" },
    ];
    const r = sortWaterBuildings(list, at);
    expect(r.keep.map((b) => b.id)).toEqual(["boatshed", "house on land", "mapped on land"]);
    expect(r.mappedOnWater.map((b) => b.id)).toEqual(["boatshed"]);
  });
});

const group = (name: string, children: Kn5Node[]): Kn5GroupNode => ({ kind: "node", name, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children });
function block(name: string, x: number, y: number): Kn5MeshNode {
  const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const positions = new Float32Array([...pts.flatMap(([a, b]) => [x + a, 0, -(y + b)]), ...pts.flatMap(([a, b]) => [x + a, 3, -(y + b)])]);
  return { kind: "mesh", name, material: "wall", positions, normals: new Float32Array(24), uvs: new Float32Array(16), indices: new Uint16Array([0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]) } as Kn5MeshNode;
}
const dataOf = (mask: ShoreMask): ShoreMaskData => ({ x0: mask.x0, y0: mask.y0, cell: mask.cell, w: mask.w, h: mask.h, classes: [...SHORE_CLASSES.slice(1)], value: (c, r) => mask.cells[r * mask.w + c] });
// A flat 40 m square of sea surface round (60, -10).
const seaMesh = { kind: "mesh", name: "SEA_000", material: "sea", positions: new Float32Array([40, 0, 30, 80, 0, 30, 80, 0, -10, 40, 0, -10]), normals: new Float32Array(12), uvs: new Float32Array(8), indices: new Uint16Array([0, 1, 2, 0, 2, 3]) } as Kn5MeshNode;

describe("the shore check and mapped buildings", () => {
  it("lets a mapped building over the water stand, even over the sea mesh, and fails a tree there", () => {
    const m = shoreMask();
    const model = () => group("root", [group("SEA", [seaMesh]), group("BUILDINGS", [block("1WALL_BLD_shed_000", 60, -10)])]);
    // Unmarked: a building on the sea fails.
    expect(checkShore([model()], dataOf(m)).failed).toBe(1);
    // Marked as a mapped building: it stands.
    m.mark(sq(60, -10, 1.5), "mapped");
    expect(m.at(60, -10)).toBe("mapped");
    expect(m.at(60, -30)).toBe("sea");
    const r = checkShore([model()], dataOf(m));
    expect(r.hits.map((h) => [h.where, h.fails])).toEqual([["mapped", false]]);
    expect(r.failed).toBe(0);
  });

  it("marks even a footprint smaller than a cell", () => {
    const m = shoreMask();
    m.mark(sq(61, -11, 0.5), "mapped");
    expect(m.at(61, -11)).toBe("mapped");
  });
});
