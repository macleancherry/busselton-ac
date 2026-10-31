import { describe, expect, it } from "vitest";
import { blendSeam, EDGE, FADE } from "../src/core/demSeam";

const TILE = 256;
const MPP = 4; // metres per pixel, about z15 at Busselton's latitude

/**
 * Four tiles in a row. The model covers the first one and a half, flat at 56 m, its last 6 pixels
 * (24 m) falling away to 39 m like the WA mosaic's edge at Cape Naturaliste; no data beyond.
 */
function seamTiles() {
  const tiles = [0, 1, 2, 3].map((x) => ({ x, y: 0, heights: new Float32Array(TILE * TILE).fill(NaN) }));
  const edgeCol = 384;
  for (let gx = 0; gx < edgeCol; gx++) {
    const v = gx < edgeCol - 6 ? 56 : 56 - (17 * (gx - (edgeCol - 7))) / 6;
    for (let r = 0; r < TILE; r++) tiles[gx >> 8].heights[r * TILE + (gx & 255)] = v;
  }
  return tiles;
}
const row = (tiles: ReturnType<typeof seamTiles>, r = 128) => Array.from({ length: 4 * TILE }, (_, gx) => tiles[gx >> 8].heights[r * TILE + (gx & 255)]);

describe("blendSeam", () => {
  it("drops the model's falling edge and meets it with the global heights without a step", () => {
    const tiles = seamTiles();
    const dropped = blendSeam(tiles, () => 71, MPP);
    expect(dropped).toBeGreaterThan(0);
    const h = row(tiles);
    expect(h.every(Number.isFinite)).toBe(true);
    // The model well inside is untouched.
    expect(h[100]).toBe(56);
    // No dip: nothing near the seam goes below the model's true level by more than a metre.
    for (let gx = 300; gx < 450; gx++) expect(h[gx]).toBeGreaterThan(55);
    // No cliff: under 0.5 m a pixel (about 12%) anywhere.
    for (let gx = 1; gx < h.length; gx++) expect(Math.abs(h[gx] - h[gx - 1])).toBeLessThan(0.5);
    // Back to the global heights past the fade.
    const far = Math.ceil(384 + (EDGE + FADE) / MPP + 20);
    expect(h[far]).toBeCloseTo(71, 1);
  });

  it("leaves a coast alone: no data over the sea, where the global heights are about 0", () => {
    const tiles = seamTiles();
    const dropped = blendSeam(tiles, () => 0, MPP);
    expect(dropped).toBe(0);
    const h = row(tiles);
    expect(h[380]).toBeCloseTo(56 - (17 * 3) / 6, 4); // the model's own values kept
    expect(h[600]).toBe(0);
  });

  it("just fills from the fallback where the model has nothing", () => {
    const tiles = [{ x: 5, y: 7, heights: new Float32Array(TILE * TILE).fill(NaN) }];
    expect(blendSeam(tiles, (gx, gy) => gx - 5 * TILE + (gy - 7 * TILE), MPP)).toBe(0);
    expect(tiles[0].heights[3 * TILE + 2]).toBe(5);
  });
});
