import { describe, expect, it } from "vitest";
import { densifyStreet, type SideStreet } from "../src/core/sideStreets";
import { splitByArea } from "../src/core/cull";
import type { Kn5MeshNode } from "../src/core/kn5";

describe("street draping and small tiles", () => {
  const st = { pts: [[0, 0], [40, 0], [60, 0]], width: 6, joins: [0, 2], cls: "residential" } as unknown as SideStreet;

  it("adds points only where the ground bulges between the street's points", () => {
    const flat = densifyStreet(st, () => 2);
    expect(flat).toBe(st);
    // A 20 cm bump at x = 20.
    const bump = densifyStreet(st, (x) => 2 + 0.2 * Math.max(0, 1 - Math.abs(x - 20) / 10));
    expect(bump.pts.length).toBeGreaterThan(3);
    expect(bump.pts.some(([x]) => Math.abs(x - 20) < 1.5)).toBe(true);
    // The joins still point at the same places.
    expect(bump.joins.map((j) => bump.pts[j])).toEqual([[0, 0], [60, 0]]);
    // Nothing past the bump's end gets extra points.
    expect(bump.pts.filter(([x]) => x > 40 && x < 60)).toHaveLength(0);
  });

  it("folds a tile with a handful of triangles into its neighbour", () => {
    // 2000 triangles in a strip 600 m long, plus one lone triangle in a tile of its own.
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const x = (i / 2000) * 600, v = pos.length / 3;
      pos.push(x, 0, 0, x + 0.2, 0, 0, x, 0, 1);
      idx.push(v, v + 1, v + 2);
    }
    const v = pos.length / 3;
    pos.push(300, 0, 130, 301, 0, 130, 300, 0, 131);
    idx.push(v, v + 1, v + 2);
    const n = pos.length / 3;
    const node = {
      kind: "mesh", name: "TEST", material: "m", positions: new Float32Array(pos), normals: new Float32Array(n * 3),
      uvs: new Float32Array(n * 2), indices: new Uint16Array(idx),
    } as unknown as Kn5MeshNode;
    const tiles = splitByArea(node);
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.every((t) => t.indices.length / 3 >= 8)).toBe(true);
    expect(tiles.reduce((a, t) => a + t.indices.length / 3, 0)).toBe(2001);
  });
});
