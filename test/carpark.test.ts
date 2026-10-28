import { describe, expect, it } from "vitest";
import { buildIslands, findIslands, paintOutCars } from "../src/core/carpark";

const size = 200; // 0.2 m a pixel: a 40 m square
const mpp = 0.2;
function image(paint: (x: number, y: number) => [number, number, number]): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) px.set([...paint(x * mpp, y * mpp), 255], (y * size + x) * 4);
  return px;
}
const asphalt: [number, number, number] = [80, 82, 84];
// A white car (4.6 x 1.8 m) at (10, 10), a white bay line 0.1 m wide and 5 m long at x = 20, and a grass island.
const inCar = (x: number, y: number) => x > 10 && x < 14.6 && y > 10 && y < 11.8;
const inLine = (x: number, y: number) => x > 19.9 && x < 20.1 && y > 5 && y < 10; // one pixel wide
const inIsland = (x: number, y: number) => x > 25 && x < 33 && y > 25 && y < 29;
const lot = image((x, y) => (inCar(x, y) ? [235, 235, 238] : inLine(x, y) ? [230, 230, 225] : inIsland(x, y) ? [70, 110, 50] : asphalt));
const at = (px: Uint8Array, x: number, y: number) => Array.from(px.slice(((Math.floor(y / mpp) * size) + Math.floor(x / mpp)) * 4, ((Math.floor(y / mpp) * size) + Math.floor(x / mpp)) * 4 + 3));

describe("car parks", () => {
  it("paints out the car but keeps the bay line and the island", () => {
    const { rgba, cars } = paintOutCars(lot, size, mpp);
    expect(cars).toBe(1);
    const c = at(rgba, 12, 11);
    for (let k = 0; k < 3; k++) expect(Math.abs(c[k] - asphalt[k])).toBeLessThan(12);
    expect(at(rgba, 20.05, 7)[0]).toBeGreaterThan(200);
    expect(at(rgba, 29, 27)[1]).toBe(110);
  });

  it("finds the island and raises it behind a kerb, facing up", () => {
    const chunk = { key: "t0", minX: 0, minY: -40, maxX: 40, maxY: 0 };
    const rings = findIslands(lot, size, chunk);
    expect(rings).toHaveLength(1);
    const xs = rings[0].map((p) => p[0]), ys = rings[0].map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(25, 0);
    expect(Math.max(...xs)).toBeCloseTo(33, 0);
    // Image y runs down from the chunk's top edge (maxY = 0): 25..29 m down is y -25..-29.
    expect(Math.max(...ys)).toBeCloseTo(-25, 0);
    const [top, kerb] = buildIslands(rings, () => 2, chunk, "terrain_t0", "t0");
    expect(top.name).toMatch(/^1GRASS_/);
    expect(kerb.name).toMatch(/^1KERB_/);
    for (let i = 1; i < top.positions.length; i += 3) expect(top.positions[i]).toBeCloseTo(2.15, 3);
    for (let i = 1; i < top.normals.length; i += 3) expect(top.normals[i]).toBeGreaterThan(0.99);
  });
});
