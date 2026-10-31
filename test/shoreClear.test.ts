import { describe, expect, it } from "vitest";
import type { CoastPolygon } from "../src/core/coast";
import type { Kn5GroupNode, Kn5MeshNode, Kn5Node } from "../src/core/kn5";
import { decodeOwnPng } from "../src/core/png";
import { buildTrees } from "../src/core/scenery";
import { checkShore, type ShoreMaskData } from "../src/core/shoreCheck";
import { SHORE_CLASSES, ShoreMask } from "../src/core/shoreClear";

const box = (x0: number, y0: number, x1: number, y1: number): CoastPolygon => ({ rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]], edge: [[true, true, true, true]] });

// The sea south of y = 0; a beach from y = 30 to 40 (a 30 m gap of shore between it and the water);
// a lake; a wetland; a jetty; a groyne on land; clear land behind the beach.
const input = {
  ocean: [box(0, -200, 300, 0)],
  water: [box(150, 100, 180, 130)],
  wetlands: [box(220, 100, 260, 140)],
  beaches: [box(20, 30, 120, 40)],
  piers: [box(200, -60, 206, 0)],
  groynes: [[[60, 160], [60, 180]] as [number, number][]],
};
const mask = new ShoreMask(input, -20, -220, 320, 220);

describe("ShoreMask", () => {
  it("knows the sea, inland water, wetland, jetty, groyne, beach, the sand at the water and the strip", () => {
    expect(mask.at(50, -50)).toBe("sea");
    expect(mask.at(160, 110)).toBe("water");
    expect(mask.at(240, 120)).toBe("wetland");
    expect(mask.at(203, -10)).toBe("sea"); // the jetty over the sea is still the sea first
    expect(mask.at(60, 170)).toBe("groyne");
    expect(mask.at(62.5, 170)).toBe("groyne");
    expect(mask.at(66, 170)).toBeNull();
    expect(mask.at(50, 35)).toBe("beach");
    expect(mask.at(50, 41.5)).toBe("beach"); // the seawall rocks just behind the sand
    expect(mask.at(50, 10)).toBe("sand"); // within 25 m of the water
    expect(mask.at(50, 26)).toBe("strip"); // between the beach and the water, past the sand band
    expect(mask.at(50, 60)).toBeNull(); // behind the dune line
    expect(mask.at(250, 28)).toBeNull(); // along the shore with no beach, past the sand band
    expect(mask.at(1000, 1000)).toBeNull(); // outside the mask
  });

  it("hitsAround catches a trunk at the edge", () => {
    expect(mask.has(50, 44)).toBe(false);
    expect(mask.hitsAround(50, 44, 1)).toBe(false);
    expect(mask.hitsAround(50, 43, 1.2)).toBe(true);
  });

  it("writes a PNG of class codes with its placement", () => {
    const f = mask.files();
    expect(f.ini).toContain(`CELL = 2`);
    expect(f.ini).toContain(`CLASSES = ${SHORE_CLASSES.slice(1).join(",")}`);
    const img = decodeOwnPng(f.png);
    expect([img.width, img.height]).toEqual([mask.w, mask.h]);
    // Pixel at (x 50, y -50), row 0 at the top.
    const c = Math.floor((50 - mask.x0) / 2), r = Math.floor((-50 - mask.y0) / 2);
    expect(img.rgba[((mask.h - 1 - r) * mask.w + c) * 4]).toBe(SHORE_CLASSES.indexOf("sea"));
  });
});

const group = (name: string, children: Kn5Node[]): Kn5GroupNode => ({ kind: "node", name, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children });
const data: ShoreMaskData = { x0: mask.x0, y0: mask.y0, cell: mask.cell, w: mask.w, h: mask.h, classes: [...SHORE_CLASSES.slice(1)], value: (c, r) => mask.cells[r * mask.w + c] };

/** A 2 m square block standing at (x, y) (AC axes: x, height, -y). */
function block(name: string, x: number, y: number): Kn5MeshNode {
  const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const positions = new Float32Array([...pts.flatMap(([a, b]) => [x + a, 0, -(y + b)]), ...pts.flatMap(([a, b]) => [x + a, 3, -(y + b)])]);
  return { kind: "mesh", name, material: "wall", positions, normals: new Float32Array(24), uvs: new Float32Array(16), indices: new Uint16Array([0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]) } as Kn5MeshNode;
}

describe("checkShore", () => {
  const flat = () => 0;
  const trees = buildTrees([
    { x: 50, y: -50, scale: 1, variant: 0 }, // in the sea
    { x: 50, y: 35, scale: 1, variant: 3 }, // on the beach
    { x: 50, y: 80, scale: 1, variant: 3 }, // on land
    { x: 160, y: 110, scale: 1, variant: 1 }, // in the lake
  ], flat, "TREES") as Kn5MeshNode[];

  it("counts each tree once and fails trees on the water and the sand", () => {
    const r = checkShore([group("root", [group("TREES", trees)])], data);
    expect(r.trees).toBe(4);
    expect(r.byWhere).toEqual({ sea: { trees: 1, others: 0 }, beach: { trees: 1, others: 0 }, water: { trees: 1, others: 0 } });
    expect(r.failed).toBe(3);
  });

  it("finds the sea from the SEA mesh without a mask", () => {
    // A flat 20 m square of sea surface round (50, -50).
    const sea = { kind: "mesh", name: "SEA_000", material: "sea", positions: new Float32Array([40, 0, 60, 60, 0, 60, 60, 0, 40, 40, 0, 40]), normals: new Float32Array(12), uvs: new Float32Array(8), indices: new Uint16Array([0, 1, 2, 0, 2, 3]) } as Kn5MeshNode;
    const r = checkShore([group("root", [group("SEA", [sea]), group("TREES", trees)])]);
    expect(r.byWhere).toEqual({ sea: { trees: 1, others: 0 } });
  });

  it("fails a house in the lake, lists one on the beach, and ignores windows and invisible walls", () => {
    const r = checkShore([group("root", [group("BUILDINGS", [
      block("1WALL_BLD_brick_000", 160, 110), block("1WALL_BLD_wb_000", 60, 35), block("WINDOWS_000", 160, 110), block("1WALL_L_000", 160, 110),
    ])])], data);
    expect(r.others).toBe(2);
    expect(r.hits.map((h) => [h.where, h.fails])).toEqual([["water", true], ["beach", false]]);
    expect(r.failed).toBe(1);
  });
});
