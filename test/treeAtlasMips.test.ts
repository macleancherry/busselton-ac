import { describe, expect, it } from "vitest";
import { decodeDds } from "../src/core/dds";
import { bleedColour, MIN_CELL, treeAtlasLevels, treeAtlasTexture } from "../src/core/treeAtlasMips";
import { ATLAS_H, ATLAS_W, TREE_SPECIES, treeSpeciesPixels } from "../src/core/treeSprites";

const alphaAt = (px: Uint8Array, w: number, x: number, y: number) => px[(y * w + x) * 4 + 3];

describe("bleedColour", () => {
  it("colours transparent texels from the nearest opaque ones, leaving alpha and opaque texels alone", () => {
    const w = 8, h = 4, px = new Uint8Array(w * h * 4);
    const set = (x: number, y: number, c: number[]) => px.set(c, (y * w + x) * 4);
    set(1, 1, [200, 100, 50, 255]);
    set(6, 2, [10, 220, 30, 255]);
    const out = bleedColour(px, w, h);
    for (let i = 0; i < w * h; i++) expect(out[i * 4 + 3]).toBe(px[i * 4 + 3]);
    expect([...out.subarray((1 * w + 1) * 4, (1 * w + 1) * 4 + 4)]).toEqual([200, 100, 50, 255]);
    // Next to each opaque texel, its colour; nothing left black.
    expect([...out.subarray((1 * w + 0) * 4, (1 * w + 0) * 4 + 3)]).toEqual([200, 100, 50]);
    expect([...out.subarray((2 * w + 7) * 4, (2 * w + 7) * 4 + 3)]).toEqual([10, 220, 30]);
    for (let i = 0; i < w * h; i++) expect(out[i * 4] + out[i * 4 + 1] + out[i * 4 + 2]).toBeGreaterThan(0);
  });
});

describe("treeAtlasLevels", () => {
  it("halves each level, stops at MIN_CELL-wide cells and never spreads a cell into its neighbours", () => {
    const cells = 3, cw = 64, w = cells * cw, h = 128, px = new Uint8Array(w * h * 4);
    // Something opaque in the middle cell only, right up to its edges.
    for (let y = 40; y < 100; y++) for (let x = cw; x < 2 * cw; x++) px.set([40, 90, 30, 255], (y * w + x) * 4);
    const levels = treeAtlasLevels(px, w, h, cells);
    expect(levels.map((l) => l.w / cells)).toEqual([64, 32, 16, 8]);
    expect(levels[levels.length - 1].w / cells).toBe(MIN_CELL);
    for (const l of levels) {
      const c = l.w / cells;
      for (let y = 0; y < l.h; y++) {
        for (let x = 0; x < l.w; x++) {
          if (x < c || x >= 2 * c) expect(alphaAt(l.px, l.w, x, y)).toBe(0);
        }
      }
    }
  });

  it("keeps each species' alpha-test coverage, and the empty band above a crown empty, at every level", () => {
    const levels = treeAtlasLevels(treeSpeciesPixels(), ATLAS_W, ATLAS_H, TREE_SPECIES.length);
    const cells = TREE_SPECIES.length;
    const cover = (l: { w: number; h: number; px: Uint8Array }, c: number) => {
      const cw = l.w / cells;
      let n = 0;
      for (let y = 0; y < l.h; y++) for (let x = c * cw; x < (c + 1) * cw; x++) if (alphaAt(l.px, l.w, x, y) >= 128) n++;
      return n / (cw * l.h);
    };
    for (let c = 0; c < cells; c++) {
      const want = cover(levels[0], c);
      for (const l of levels.slice(1)) expect(Math.abs(cover(l, c) - want)).toBeLessThan(0.06);
    }
    // The tuart (cell 3) has nothing in its top 25%: still nothing there at the smallest level,
    // so a card seen edge-on can't turn into a solid sheet above the crown.
    const last = levels[levels.length - 1], cw = last.w / cells;
    for (let y = 0; y < Math.floor(last.h * 0.2); y++) for (let x = 3 * cw; x < 4 * cw; x++) expect(alphaAt(last.px, last.w, x, y)).toBe(0);
  });
});

describe("treeAtlasTexture", () => {
  it("is a DXT5 trees.dds the atlas's size, with its own short mip chain and no black under the leaves", () => {
    const t = treeAtlasTexture();
    expect(t.name).toBe("trees.dds");
    const v = new DataView(t.data.buffer, t.data.byteOffset, t.data.byteLength);
    expect(v.getUint32(28, true)).toBe(7); // 512-wide cells down to 8
    const { rgba, width, height } = decodeDds(t.data);
    expect([width, height]).toEqual([ATLAS_W, ATLAS_H]);
    // Transparent texels next to leaves carry leaf colour, not black.
    let dark = 0, edge = 0;
    for (let y = 1; y < height - 1; y += 3) {
      for (let x = 1; x < width - 1; x += 3) {
        const i = (y * width + x) * 4;
        if (rgba[i + 3] !== 0 || rgba[i + 7] === 0) continue;
        edge++;
        if (rgba[i] + rgba[i + 1] + rgba[i + 2] < 30) dark++;
      }
    }
    expect(edge).toBeGreaterThan(100);
    expect(dark / edge).toBeLessThan(0.02);
  });
});
