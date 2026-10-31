import { describe, expect, it } from "vitest";
import { DemGrid, decodeTerrarium, decodeTerrariumTile, demTilesFor } from "../src/core/elevation";
import { LocalProjection, tilesCovering } from "../src/core/geo";
import { decodeTerrarium as tilesDecoder } from "../src/services/tiles";

const proj = new LocalProjection([115.35, -33.65]);
const Z = 15;

describe("Terrarium decoding", () => {
  it("decodes the reference colours", () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(0, 0, 0)).toBe(-32768);
    expect(decodeTerrarium(128, 1, 128)).toBe(1.5);
    expect(decodeTerrarium(128, 1, 128, 0)).toBeNaN();
  });

  it("the array decoder agrees with the per-pixel one, and tiles.ts uses the same one", () => {
    const rgba = new Uint8Array([128, 0, 0, 255, 128, 1, 128, 255, 10, 20, 30, 255, 128, 128, 128, 0]);
    const out = decodeTerrariumTile(rgba);
    expect(Array.from(out.subarray(0, 3))).toEqual([0, 1.5, decodeTerrarium(10, 20, 30)].map((v) => Math.fround(v)));
    expect(out[3]).toBeNaN();
    expect(tilesDecoder).toBe(decodeTerrariumTile);
  });
});

describe("DemGrid.fromFunction", () => {
  const bounds = { minX: -300, minY: -200, maxX: 300, maxY: 250 };

  it("reproduces a tilted plane anywhere inside the bounds", () => {
    const plane = (x: number, y: number) => 12 + 0.03 * x - 0.05 * y;
    const dem = DemGrid.fromFunction(proj, Z, bounds, plane).sample;
    for (let k = 0; k < 200; k++) {
      const x = bounds.minX + ((k * 37) % 600), y = bounds.minY + ((k * 53) % 450);
      expect(Math.abs(dem(x, y) - plane(x, y))).toBeLessThan(1e-3);
    }
  });

  it("is exact at pixel points and bilinear between them on a bump", () => {
    const bump = (x: number, y: number) => 5 * Math.exp(-(x * x + y * y) / 2000);
    const grid = DemGrid.fromFunction(proj, Z, bounds, bump);
    const dem = grid.sample;
    const px = Math.floor(proj.localToPixel([0, 0], Z)[0]), py = Math.floor(proj.localToPixel([0, 0], Z)[1]);
    const at = (gx: number, gy: number) => proj.pixelToLocal([gx, gy], Z);
    const p00 = at(px, py), p10 = at(px + 1, py), p01 = at(px, py + 1), p11 = at(px + 1, py + 1);
    for (const p of [p00, p10, p01, p11]) expect(dem(p[0], p[1])).toBeCloseTo(bump(p[0], p[1]), 4);
    const mid = at(px + 0.25, py + 0.5);
    const want = 0.5 * (0.75 * bump(...p00) + 0.25 * bump(...p10)) + 0.5 * (0.75 * bump(...p01) + 0.25 * bump(...p11));
    expect(dem(mid[0], mid[1])).toBeCloseTo(want, 4);
  });

  it("works detached from its grid", () => {
    const { sample } = DemGrid.fromFunction(proj, Z, bounds, () => 7);
    expect(sample(0, 0)).toBe(7);
  });
});

describe("DemGrid.fromHeights", () => {
  const [tx, ty] = proj.localToPixel([0, 0], Z).map((v) => Math.floor(v / 256));
  const tile = (fn: (r: number, c: number) => number) => {
    const h = new Float32Array(256 * 256);
    for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) h[r * 256 + c] = fn(r, c);
    return h;
  };
  const centre = (gx: number, gy: number) => proj.pixelToLocal([gx + 0.5, gy + 0.5], Z);

  it("joins two tiles side by side seamlessly and puts a pixel's value at its centre", () => {
    // A ramp running east across both tiles.
    const a = tile((_r, c) => c * 0.1), b = tile((_r, c) => (256 + c) * 0.1);
    b[100 * 256 + 40] = 99;
    const dem = DemGrid.fromHeights(proj, Z, [{ x: tx, y: ty, heights: a }, { x: tx + 1, y: ty, heights: b }]).sample;
    const p = centre((tx + 1) * 256 + 40, ty * 256 + 100);
    expect(dem(p[0], p[1])).toBeCloseTo(99, 3);
    // Across the seam the ramp carries on.
    for (let c = 250; c < 262; c++) {
      const q = centre(tx * 256 + c + 0.3, ty * 256 + 10);
      expect(dem(q[0], q[1])).toBeCloseTo((c + 0.3) * 0.1, 3);
    }
  });

  it("fills tiles missing from the rectangle, and says how many cells it filled", () => {
    const g = DemGrid.fromHeights(proj, Z, [
      { x: tx, y: ty, heights: tile(() => 20) },
      { x: tx + 1, y: ty + 1, heights: tile(() => 30) },
    ]);
    expect(g.filled).toBe(2 * 256 * 256);
    for (const [gx, gy] of [[(tx + 1) * 256 + 128, ty * 256 + 128], [tx * 256 + 128, (ty + 1) * 256 + 128]]) {
      const p = centre(gx, gy);
      const h = g.sample(p[0], p[1]);
      expect(h === 20 || h === 30).toBe(true);
    }
  });

  it("keeps NaN out of samples, and returns edge values beyond the grid", () => {
    const h = tile(() => 4);
    h[5 * 256 + 5] = NaN;
    h[200 * 256 + 17] = Infinity;
    const g = DemGrid.fromHeights(proj, Z, [{ x: tx, y: ty, heights: h }]);
    expect(g.filled).toBe(2);
    for (const [gx, gy] of [[5, 5], [17, 200], [5.5, 5.5]]) {
      const p = centre(tx * 256 + gx, ty * 256 + gy);
      expect(g.sample(p[0], p[1])).toBe(4);
    }
    for (const [x, y] of [[-1e5, 0], [1e5, 1e5], [0, -1e5]]) {
      const v = g.sample(x, y);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBe(4);
    }
  });

  it("decodes RGBA tiles, filling transparent (missing) ones instead of reading 128.5 m", () => {
    const sea = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < sea.length; i += 4) { sea[i] = 128; sea[i + 3] = 255; }
    const missing = new Uint8Array(256 * 256 * 4);
    const g = DemGrid.fromTiles(proj, Z, [{ x: tx, y: ty, rgba: sea }, { x: tx + 1, y: ty, rgba: missing }]);
    const p = centre((tx + 1) * 256 + 128, ty * 256 + 128);
    expect(g.sample(p[0], p[1])).toBe(0);
    expect(g.filled).toBe(256 * 256);
  });
});

describe("demTilesFor", () => {
  it("lists the covering rectangle, rows outer and columns inner", () => {
    const b = { minX: -2000, minY: -1500, maxX: 2500, maxY: 1000 };
    const r = tilesCovering(proj, b, 14);
    const list = demTilesFor(proj, b, 14);
    expect(list.length).toBe((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1));
    expect(list[0]).toEqual({ x: r.x0, y: r.y0 });
    expect(list[1]).toEqual({ x: r.x0 + 1, y: r.y0 });
    expect(list[list.length - 1]).toEqual({ x: r.x1, y: r.y1 });
  });

  it("clamps at the world's edge at a low zoom", () => {
    const list = demTilesFor(proj, { minX: -3e7, minY: -3e7, maxX: 3e7, maxY: 3e7 }, 2);
    expect(list.length).toBe(16);
    expect(list.every((t) => t.x >= 0 && t.x <= 3 && t.y >= 0 && t.y <= 3)).toBe(true);
  });
});
