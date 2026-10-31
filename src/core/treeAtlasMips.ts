// Busselton fork: the tree card atlas as a .dds with its own mip chain (trees.dds).
//
// Retest 3 saw dark green "pyramids" on gum crowns in AC and dark vertical streaks on the cards in
// Blender. Both come from the texture, not the geometry (every tree triangle is an upright card
// with its cell's UVs):
//   - Transparent texels were black. Any filtering (bilinear, mips, Blender's interpolation) mixes
//     that black into the leaf edges: dark fringes down every hanging leaf stroke, the streaks.
//   - The PNG left mips to the game: a plain box filter that averages alpha away. A card seen
//     nearly edge-on samples a tiny mip, where a whole cell is a few texels of part-alpha dark green
//     that passes the alpha test, so a slice of the card turns solid: the dark wedges.
// So: colour bleeds out into the transparent texels (alpha unchanged), each cell is shrunk on its
// own (nothing crosses into the next species), alpha is rescaled per level so the share of texels
// that pass the alpha test stays what it was at full size, and the chain stops while a cell is
// still MIN_CELL texels wide, so no level is ever a smear of the whole tree.

import { encodeDdsDxt5Levels } from "./dds";
import { ATLAS_H, ATLAS_W, TREE_SPECIES, treeSpeciesPixels } from "./treeSprites";

/** Narrowest cell the chain goes down to, texels. */
export const MIN_CELL = 8;
/** AC's alpha test passes at half alpha. */
const PASS = 128;

export interface AtlasLevel { w: number; h: number; px: Uint8Array }

/**
 * Gives transparent texels the colour of the nearest opaque ones (pull-push: average down to 1 x 1,
 * then fill each empty texel from the level below). Alpha and opaque texels are unchanged.
 */
export function bleedColour(px: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(px);
  type L = { w: number; h: number; c: Float32Array; k: Float32Array };
  const base: L = { w, h, c: new Float32Array(w * h * 3), k: new Float32Array(w * h) };
  let any = false;
  for (let i = 0; i < w * h; i++) {
    if (px[i * 4 + 3] === 0) continue;
    any = true;
    base.k[i] = 1;
    for (let ch = 0; ch < 3; ch++) base.c[i * 3 + ch] = px[i * 4 + ch];
  }
  if (!any) return out;
  const pyr: L[] = [base];
  while (pyr[pyr.length - 1].w > 1 || pyr[pyr.length - 1].h > 1) {
    const s = pyr[pyr.length - 1];
    const nw = Math.max(1, (s.w + 1) >> 1), nh = Math.max(1, (s.h + 1) >> 1);
    const d: L = { w: nw, h: nh, c: new Float32Array(nw * nh * 3), k: new Float32Array(nw * nh) };
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const i = y * s.w + x, j = (y >> 1) * nw + (x >> 1);
        d.k[j] += s.k[i];
        for (let ch = 0; ch < 3; ch++) d.c[j * 3 + ch] += s.c[i * 3 + ch];
      }
    }
    pyr.push(d);
  }
  // Push: normalise, and fill empty texels from the coarser level.
  for (let l = pyr.length - 1; l >= 0; l--) {
    const s = pyr[l], up = pyr[l + 1];
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const i = y * s.w + x;
        if (s.k[i] > 0) {
          for (let ch = 0; ch < 3; ch++) s.c[i * 3 + ch] /= s.k[i];
          s.k[i] = 1;
        } else if (up) {
          const j = (y >> 1) * up.w + (x >> 1);
          for (let ch = 0; ch < 3; ch++) s.c[i * 3 + ch] = up.c[j * 3 + ch];
        }
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (px[i * 4 + 3] !== 0) continue;
    for (let ch = 0; ch < 3; ch++) out[i * 4 + ch] = Math.round(base.c[i * 3 + ch]);
  }
  return out;
}

/** Share of texels in a cell's rectangle whose alpha passes the test. */
function coverage(px: Uint8Array, w: number, x0: number, cw: number, h: number, scale = 1): number {
  let pass = 0;
  for (let y = 0; y < h; y++) for (let x = x0; x < x0 + cw; x++) if (Math.min(255, px[(y * w + x) * 4 + 3] * scale) >= PASS) pass++;
  return pass / (cw * h);
}

/** Half size, each cell on its own: alpha-weighted colour, plain average alpha. */
function halveCells(src: AtlasLevel): AtlasLevel {
  const w = src.w >> 1, h = Math.max(1, src.h >> 1);
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, rs = 0, gs = 0, bs = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = (Math.min(src.h - 1, 2 * y + dy) * src.w + 2 * x + dx) * 4;
        const al = src.px[i + 3];
        r += src.px[i] * al; g += src.px[i + 1] * al; b += src.px[i + 2] * al; a += al;
        rs += src.px[i]; gs += src.px[i + 1]; bs += src.px[i + 2];
      }
      const o = (y * w + x) * 4;
      px[o] = Math.round(a ? r / a : rs / 4); px[o + 1] = Math.round(a ? g / a : gs / 4); px[o + 2] = Math.round(a ? b / a : bs / 4);
      px[o + 3] = Math.round(a / 4);
    }
  }

  return { w, h, px };
}

/**
 * The mip chain for an atlas of `cells` equal cells side by side: bled colour, cells shrunk on their
 * own, alpha rescaled per cell so its test coverage matches level 0, down to MIN_CELL-wide cells.
 */
export function treeAtlasLevels(rgba: Uint8Array, w: number, h: number, cells: number): AtlasLevel[] {
  if (w % cells) throw new Error(`atlas width ${w} isn't ${cells} whole cells`);
  const top: AtlasLevel = { w, h, px: bleedColour(rgba, w, h) };
  const cw0 = w / cells;
  const want = Array.from({ length: cells }, (_, c) => coverage(top.px, w, c * cw0, cw0, h));
  const levels = [top];
  let lv = top;
  while (lv.w / cells / 2 >= MIN_CELL && (lv.w / cells) % 2 === 0) {
    const half = halveCells(lv);
    const cw = half.w / cells;
    for (let c = 0; c < cells; c++) {
      // The alpha scale that brings this cell's coverage back to level 0's (coverage grows with it).
      let lo = 0.5, hi = 8;
      for (let it = 0; it < 18; it++) {
        const mid = (lo + hi) / 2;
        if (coverage(half.px, half.w, c * cw, cw, half.h, mid) < want[c]) lo = mid;
        else hi = mid;
      }
      const k = (lo + hi) / 2;
      for (let y = 0; y < half.h; y++) {
        for (let x = c * cw; x < (c + 1) * cw; x++) {
          const i = (y * half.w + x) * 4 + 3;
          half.px[i] = Math.min(255, Math.round(half.px[i] * k));
        }
      }
    }
    half.px = bleedColour(half.px, half.w, half.h);
    levels.push(half);
    lv = half;
  }
  return levels;
}

/** The atlas as DXT5 .dds bytes with treeAtlasLevels' mip chain. */
export function treeAtlasDds(rgba: Uint8Array, w: number, h: number, cells: number): Uint8Array {
  return encodeDdsDxt5Levels(treeAtlasLevels(rgba, w, h, cells));
}

type Raw = { rgba: Uint8Array; width: number; height: number };
let cached: { name: string; data: Uint8Array; preview: Raw } | undefined;

/** trees.dds for the species atlas (treeSprites.ts), with level 0 for the three.js preview. Built once. */
export function treeAtlasTexture(): { name: string; data: Uint8Array; preview?: Raw } {
  if (!cached) {
    const levels = treeAtlasLevels(treeSpeciesPixels(), ATLAS_W, ATLAS_H, TREE_SPECIES.length);
    cached = { name: "trees.dds", data: encodeDdsDxt5Levels(levels), preview: { rgba: levels[0].px, width: ATLAS_W, height: ATLAS_H } };
  }
  return cached;
}
