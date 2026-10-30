import { describe, expect, it } from "vitest";
import { aiGrid, readFastLaneAi, writeFastLaneAi, type AiPoint } from "../src/core/aiSpline";

const point = (x: number, z: number, i: number): AiPoint => ({
  position: [x, 2, z], distance: i, speed: 10, gas: 1, brake: 0, radius: 1000, sideLeft: 3, sideRight: 3,
  camber: 0, direction: 1, normal: [0, 1, 0], length: 1, forward: [1, 0, 0], grade: 0,
});

describe("AI line lookup grid", () => {
  // An L: 300 m east along z = 0, then 200 m south along x = 300, a point every 2 m.
  const pts: AiPoint[] = [];
  for (let x = 0; x <= 300; x += 2) pts.push(point(x, 0, pts.length));
  for (let z = 2; z <= 200; z += 2) pts.push(point(300, z, pts.length));

  it("lays it out like Kunos's: 10 m cells, floor(extent / 10) each way, 10 nearest points in every cell", () => {
    const g = aiGrid(pts);
    expect(g.min).toEqual([0, 0, 0]);
    expect(g.max).toEqual([300, 0, 200]);
    expect(g.cells).toHaveLength(30);
    expect(g.cells.every((r) => r.length === 20)).toBe(true);
    expect(g.cells.flat().every((c) => c.length === 10)).toBe(true);
  });

  it("lists the nearest points to each cell's centre, nearest first (checked against brute force)", () => {
    const g = aiGrid(pts);
    for (const [a, b] of [[0, 0], [15, 10], [29, 19], [5, 18], [28, 1]]) {
      const cx = (a + 0.5) * 10, cz = (b + 0.5) * 10;
      const d = (i: number) => Math.hypot(pts[i].position[0] - cx, pts[i].position[2] - cz);
      const brute = pts.map((_, i) => i).sort((u, v) => d(u) - d(v) || u - v).slice(0, 10);
      expect(g.cells[a][b]).toEqual(brute);
    }
  });

  it("writes it and still reads back", () => {
    const bytes = writeFastLaneAi(pts);
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    const gridAt = 16 + pts.length * 20 + 4 + pts.length * 18 * 4;
    expect(v.getInt32(gridAt, true)).toBe(1);
    expect(v.getFloat32(gridAt + 4 + 24 + 4, true)).toBe(10);
    expect(readFastLaneAi(bytes)).toHaveLength(pts.length);
  });
});
