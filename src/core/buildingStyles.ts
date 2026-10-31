// Busselton fork: what buildings are made of (docs/specs/buildingStyles.md). Window layouts, wall
// facades and roof finishes by name, their procedural textures, and the choice of what a building
// is from what's known about it. No geometry here: buildings.ts builds the meshes.

import { encodePng } from "./png";
import { mix32, rng } from "./random";

export type RGB = [number, number, number];

// ---------------------------------------------------------------------------------------------
// Layouts

export type OpeningKind = "window" | "shop" | "door";

/** One opening in a layout: x along the period, z up from the storey floor, metres. */
export interface Opening {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  kind: OpeningKind;
}

export type LayoutName =
  | "house" | "modern" | "flats" | "apartment" | "office" | "curtain"
  | "shopfront" | "shopupper" | "industrial" | "hall" | "blank";

/** How openings repeat along (period) and up (storey) a wall. */
export interface Layout {
  name: LayoutName;
  period: number;
  storey: number;
  openings: Opening[];
  /** Glass panes go over the windows (CSP lights a room behind each). */
  panes: boolean;
  /** A z range of the storey with no openings: gable ends and parapets wear it. */
  plain: [number, number];
  /** A shop sign band across the top of the storey. */
  sign?: boolean;
  /** A balcony in front of the first opening. */
  balcony?: boolean;
}

const win = (x0: number, x1: number, z0: number, z1: number, kind: OpeningKind = "window"): Opening => ({ x0, x1, z0, z1, kind });

export const LAYOUTS: Record<LayoutName, Layout> = {
  house: { name: "house", period: 8, storey: 3, openings: [win(1.0, 3.25, 0.94, 2.25), win(5.3, 6.1, 1.55, 2.15)], panes: true, plain: [0, 0.9] },
  modern: { name: "modern", period: 8, storey: 3, openings: [win(0.8, 3.8, 0.02, 2.4), win(5.6, 6.2, 0.4, 2.4)], panes: true, plain: [2.45, 3] },
  flats: { name: "flats", period: 6, storey: 2.8, openings: [win(0.8, 2.6, 0.9, 2.1), win(4.0, 4.6, 1.5, 2.0)], panes: true, plain: [0, 0.85] },
  apartment: { name: "apartment", period: 7, storey: 3, openings: [win(0.6, 5.2, 0.05, 2.6), win(5.7, 6.6, 0.9, 2.4)], panes: true, plain: [2.65, 3], balcony: true },
  office: { name: "office", period: 3, storey: 3.6, openings: [win(0.1, 2.9, 0.9, 2.7)], panes: true, plain: [0, 0.85] },
  curtain: { name: "curtain", period: 1.5, storey: 3.6, openings: [win(0.05, 1.45, 0.05, 3.55)], panes: false, plain: [0, 0.04] },
  shopfront: {
    name: "shopfront", period: 6, storey: 4,
    openings: [win(0.3, 2.4, 0.5, 2.9, "shop"), win(2.6, 3.4, 0.0, 2.4, "door"), win(3.6, 5.7, 0.5, 2.9, "shop")],
    panes: true, plain: [2.95, 3.05], sign: true,
  },
  shopupper: { name: "shopupper", period: 5, storey: 3.2, openings: [win(0.8, 1.8, 0.9, 2.4), win(3.2, 4.2, 0.9, 2.4)], panes: true, plain: [0, 0.85] },
  industrial: { name: "industrial", period: 12, storey: 6, openings: [win(0.5, 11.5, 3.6, 4.2)], panes: false, plain: [0, 3.5] },
  hall: { name: "hall", period: 4, storey: 4.5, openings: [win(1.4, 2.6, 1.0, 3.8)], panes: true, plain: [0, 0.95] },
  blank: { name: "blank", period: 4, storey: 3, openings: [], panes: false, plain: [0, 3] },
};

// ---------------------------------------------------------------------------------------------
// Facades

export type WallKind = "brick" | "weatherboard" | "fibro" | "render" | "cladding" | "corrugated" | "panel" | "glass";

/** A wall finish: a kind in a colour, with a trim colour for frames, on a layout (by name). */
export interface Facade {
  name: string;
  wall: WallKind;
  colour: RGB;
  trim: RGB;
  layout: string;
  /** Shop sign fascia colour (sign layouts). */
  sign?: RGB;
}

const WHITE_TRIM: RGB = [238, 238, 232];
const DARK_TRIM: RGB = [48, 49, 52];
const ALU: RGB = [176, 180, 182];

const fac = (name: string, wall: WallKind, colour: RGB, trim: RGB, layout: LayoutName, sign?: RGB): Facade =>
  sign ? { name, wall, colour, trim, layout, sign } : { name, wall, colour, trim, layout };

/** Every generated facade. Looked up by name (FACADE_INDEX); the order only matters within a build. */
export const FACADES: Facade[] = [
  // Brick veneer houses (brick_red first: plain houses wear it).
  fac("brick_red", "brick", [150, 72, 52], WHITE_TRIM, "house"),
  fac("brick_cream", "brick", [214, 196, 158], [96, 82, 64], "house"),
  fac("brick_brown", "brick", [118, 76, 56], WHITE_TRIM, "house"),
  fac("brick_tan", "brick", [186, 136, 94], WHITE_TRIM, "house"),
  fac("brick_dark", "brick", [78, 60, 54], [226, 224, 216], "house"),
  fac("brick_painted", "brick", [226, 222, 210], DARK_TRIM, "house"),
  // Weatherboard and fibro.
  fac("wb_white", "weatherboard", [240, 238, 230], [70, 92, 80], "house"),
  fac("wb_cream", "weatherboard", [232, 220, 186], [120, 52, 44], "house"),
  fac("wb_grey", "weatherboard", [168, 170, 166], WHITE_TRIM, "house"),
  fac("wb_sage", "weatherboard", [158, 170, 140], WHITE_TRIM, "house"),
  fac("wb_blue", "weatherboard", [112, 138, 162], WHITE_TRIM, "house"),
  fac("wb_yellow", "weatherboard", [230, 206, 132], WHITE_TRIM, "house"),
  fac("fibro_white", "fibro", [234, 232, 224], [90, 110, 100], "house"),
  fac("fibro_mint", "fibro", [190, 214, 190], WHITE_TRIM, "house"),
  fac("fibro_blue", "fibro", [172, 196, 214], WHITE_TRIM, "house"),
  fac("fibro_pink", "fibro", [222, 190, 184], WHITE_TRIM, "house"),
  // Modern houses and townhouses.
  fac("render_white", "render", [236, 234, 228], DARK_TRIM, "modern"),
  fac("render_grey", "render", [160, 160, 156], DARK_TRIM, "modern"),
  fac("render_charcoal", "render", [70, 72, 74], [30, 30, 32], "modern"),
  fac("render_sand", "render", [210, 192, 160], DARK_TRIM, "modern"),
  fac("render_terracotta", "render", [184, 110, 80], DARK_TRIM, "modern"),
  fac("clad_timber", "cladding", [150, 106, 70], DARK_TRIM, "modern"),
  fac("clad_black", "cladding", [44, 44, 46], [24, 24, 26], "modern"),
  // Walk-up flats.
  fac("flats_red", "brick", [142, 70, 54], WHITE_TRIM, "flats"),
  fac("flats_cream", "brick", [210, 192, 152], [90, 80, 64], "flats"),
  fac("flats_brown", "brick", [110, 74, 56], WHITE_TRIM, "flats"),
  fac("flats_render", "render", [222, 216, 200], DARK_TRIM, "flats"),
  // Apartments.
  fac("apt_white", "render", [238, 236, 232], DARK_TRIM, "apartment"),
  fac("apt_grey", "render", [150, 152, 154], DARK_TRIM, "apartment"),
  fac("apt_sand", "render", [214, 198, 168], DARK_TRIM, "apartment"),
  fac("apt_charcoal", "render", [64, 66, 70], [210, 210, 206], "apartment"),
  // Offices.
  fac("office_grey", "panel", [172, 172, 168], DARK_TRIM, "office"),
  fac("office_brick", "brick", [140, 80, 60], DARK_TRIM, "office"),
  fac("office_white", "render", [232, 232, 226], ALU, "office"),
  // Glass towers: colour is the glass, trim the mullions.
  fac("glass_blue", "glass", [70, 104, 136], [150, 160, 170], "curtain"),
  fac("glass_green", "glass", [74, 116, 108], [150, 162, 158], "curtain"),
  fac("glass_silver", "glass", [150, 160, 168], [196, 200, 204], "curtain"),
  fac("glass_bronze", "glass", [110, 90, 70], [70, 60, 50], "curtain"),
  // Shopfronts, and the storey above a shop.
  fac("shop_red", "render", [226, 222, 212], DARK_TRIM, "shopfront", [170, 36, 34]),
  fac("shop_blue", "render", [222, 222, 218], DARK_TRIM, "shopfront", [30, 70, 140]),
  fac("shop_green", "render", [224, 220, 208], DARK_TRIM, "shopfront", [30, 104, 60]),
  fac("shop_black", "render", [210, 208, 202], ALU, "shopfront", [28, 28, 30]),
  fac("shop_yellow", "render", [218, 214, 204], DARK_TRIM, "shopfront", [222, 178, 30]),
  fac("upper_brick", "brick", [146, 78, 58], WHITE_TRIM, "shopupper"),
  fac("upper_cream", "render", [228, 214, 180], [96, 60, 44], "shopupper"),
  fac("upper_blue", "render", [150, 172, 190], WHITE_TRIM, "shopupper"),
  // Sheds and warehouses (Colorbond colours on corrugated sheet, or tilt-up concrete).
  fac("shed_surfmist", "corrugated", [228, 226, 213], [200, 198, 188], "industrial"),
  fac("shed_shale", "corrugated", [189, 191, 186], [160, 162, 158], "industrial"),
  fac("shed_woodland", "corrugated", [75, 76, 70], [60, 61, 56], "industrial"),
  fac("shed_ocean", "corrugated", [54, 66, 82], [44, 54, 68], "industrial"),
  fac("shed_cream", "corrugated", [233, 220, 184], [204, 192, 160], "industrial"),
  fac("tiltup", "panel", [190, 186, 176], [120, 124, 128], "industrial"),
  // Halls, churches and schools.
  fac("hall_brick", "brick", [152, 82, 60], WHITE_TRIM, "hall"),
  fac("hall_cream", "brick", [212, 194, 156], [90, 70, 52], "hall"),
];

export const FACADE_INDEX: Map<string, number> = new Map(FACADES.map((f, i) => [f.name, i]));

// ---------------------------------------------------------------------------------------------
// Roof finishes

export type RoofKind = "metal" | "tile" | "ctile" | "membrane" | "gravel";

export interface RoofFinish {
  name: string;
  rgb: RGB;
  kind: RoofKind;
}

const finish = (name: string, rgb: RGB, kind: RoofKind = "metal"): RoofFinish => ({ name, rgb, kind });

/** Roof finishes, looked up by name. `shalegrey` stays second (track.ts takes the verandah texture as [1]). */
export const ROOF_COLOURS: RoofFinish[] = [
  finish("surfmist", [228, 226, 213]),
  finish("shalegrey", [189, 191, 186]),
  finish("windspray", [136, 139, 135]),
  finish("woodland", [75, 76, 70]),
  finish("monument", [50, 52, 55]),
  finish("cream", [233, 220, 184]),
  finish("terracotta", [176, 88, 58], "tile"),
  finish("paperbark", [202, 189, 162]),
  finish("jasper", [108, 97, 83]),
  finish("manorred", [94, 29, 29]),
  finish("deepocean", [54, 66, 82]),
  finish("basalt", [109, 108, 110]),
  finish("dune", [177, 173, 163]),
  finish("zinc", [180, 183, 186]),
  finish("terracotta_aged", [150, 82, 62], "tile"),
  finish("tile_charcoal", [62, 62, 64], "ctile"),
  finish("tile_slate", [92, 96, 100], "ctile"),
  finish("tile_brown", [110, 82, 62], "ctile"),
  finish("tile_red", [140, 60, 48], "ctile"),
  finish("tile_sand", [196, 170, 130], "ctile"),
  finish("membrane", [150, 150, 148], "membrane"),
  finish("gravel", [170, 165, 155], "gravel"),
  finish("paleeucalypt", [124, 132, 107]),
  finish("cottagegreen", [48, 74, 58]),
];

const ROOF_INDEX = new Map(ROOF_COLOURS.map((r, i) => [r.name, i]));
const roofByName = (name: string): number => {
  const i = ROOF_INDEX.get(name);
  if (i === undefined) throw new Error(`no roof finish ${name}`);
  return i;
};

/** Finishes a sloped roof can wear (what a roof seen in a photo can be): not membrane or gravel. */
export const PITCHED: number[] = ROOF_COLOURS.flatMap((r, i) => (r.kind === "membrane" || r.kind === "gravel" ? [] : [i]));

export const isTiled = (r: RoofFinish): boolean => r.kind === "tile" || r.kind === "ctile";

// ---------------------------------------------------------------------------------------------
// Textures

/** Texture pixels per metre. */
export const PX_PER_M = 32;

const round4 = (v: number) => Math.max(4, Math.round(v / 4) * 4);
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** A 32-bit seed from a name and a colour (FNV-1a, then mixed). */
function seedOf(name: string, rgb: RGB): number {
  let h = 0x811c9dc5;
  const feed = (c: number) => {
    h ^= c & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  for (let k = 0; k < name.length; k++) feed(name.charCodeAt(k));
  for (const c of rgb) feed(c);
  return mix32(h >>> 0);
}

/** A hash of two cell coordinates and a seed, in [0, 1). */
const cellRand = (a: number, b: number, seed: number) => mix32(mix32((a | 0) ^ seed) ^ Math.imul(b | 0, 0x2c1b3c6d)) / 4294967296;

/** Smooth tiling noise on a w x h canvas with `cx` cells across (and proportionally many down). */
function tilingNoise(w: number, h: number, cx: number, seed: number): (x: number, y: number) => number {
  const cy = Math.max(1, Math.round((cx * h) / w));
  const lat = (i: number, j: number) => cellRand(((i % cx) + cx) % cx, ((j % cy) + cy) % cy, seed);
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = (x / w) * cx, fy = (y / h) * cy;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = s(fx - ix), ty = s(fy - iy);
    const top = lat(ix, iy) + (lat(ix + 1, iy) - lat(ix, iy)) * tx;
    const bot = lat(ix, iy + 1) + (lat(ix + 1, iy + 1) - lat(ix, iy + 1)) * tx;
    return top + (bot - top) * ty;
  };
}

const scaleRgb = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const mixRgb = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function paint(w: number, h: number, shade: (x: number, y: number) => RGB): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = shade(x, y), o = (y * w + x) * 4;
      px[o] = clamp255(Math.round(c[0]));
      px[o + 1] = clamp255(Math.round(c[1]));
      px[o + 2] = clamp255(Math.round(c[2]));
      px[o + 3] = 255;
    }
  }
  return px;
}

const SKY_TOP: RGB = [170, 196, 220];
const SKY_LOW: RGB = [70, 86, 102];
const ROOM_WALL: RGB = [240, 232, 214];
const BALCONY_WASH: RGB = [196, 210, 220];

/** The bare wall of a kind at pixel (x, y) of a w x h facade canvas. */
function wallPixel(fc: Facade, layout: Layout, w: number, h: number, x: number, y: number, seed: number): RGB {
  const base = fc.colour;
  switch (fc.wall) {
    case "brick": {
      // 230 x 76 mm bricks, 10 mm joints (at least a pixel), stretcher bond, whole bricks per tile.
      const courses = Math.max(1, Math.round(h / (0.086 * PX_PER_M)));
      const across = Math.max(1, Math.round(w / (0.24 * PX_PER_M)));
      const ch = h / courses, bw = w / across;
      const row = Math.floor(y / ch);
      const shift = row % 2 ? bw / 2 : 0;
      const xs = (x + shift) % w;
      const col = Math.floor(xs / bw);
      const inRow = y - row * ch, inCol = xs - col * bw;
      if (inRow < 1 || inCol < 1) return mixRgb(base, [214, 208, 196], 0.65);
      const tone = 0.86 + cellRand(row, col % across, seed) * 0.24;
      return scaleRgb(base, tone);
    }
    case "weatherboard": {
      const boards = Math.max(1, Math.round(h / (0.15 * PX_PER_M)));
      const bh = h / boards, inB = y % bh;
      if (inB >= bh - 1) return scaleRgb(base, 0.68);
      return scaleRgb(base, 0.94 + (inB / bh) * 0.08);
    }
    case "fibro": {
      const sheets = Math.max(1, Math.round(layout.period / 1.2));
      const sw = w / sheets, inS = x % sw;
      if (inS < 2) return scaleRgb(base, inS < 1 ? 1.04 : 0.84);
      return base;
    }
    case "render":
      return base;
    case "cladding": {
      const boards = Math.max(1, Math.round(w / (0.14 * PX_PER_M)));
      const bw = w / boards, b = Math.floor(x / bw);
      if (x - b * bw < 1) return scaleRgb(base, 0.6);
      return scaleRgb(base, 0.9 + cellRand(b, 7, seed) * 0.18);
    }
    case "corrugated": {
      const ribs = Math.max(1, Math.round(w / (0.152 * PX_PER_M)));
      const t = ((x + 0.5) / w) * ribs;
      return scaleRgb(base, 0.9 + 0.12 * Math.cos(t * 2 * Math.PI));
    }
    case "panel": {
      const panels = Math.max(1, Math.round(layout.period / 3));
      const pw = w / panels;
      if (x % pw < 1 || y < 1) return scaleRgb(base, 0.72);
      return base;
    }
    case "glass":
      return fc.trim;
  }
}

/** Inside an opening: what you see through it, at metres (u across the opening 0..1, z up the storey). */
function openingPixel(fc: Facade, o: Opening, u: number, mz: number, seed: number): RGB {
  const t = (mz - o.z0) / Math.max(0.01, o.z1 - o.z0); // 0 bottom, 1 top
  if (fc.wall === "glass") {
    if (mz < 0.9) return scaleRgb(fc.colour, 0.6);
    return scaleRgb(fc.colour, 0.85 + t * 0.35);
  }
  if (o.kind === "shop" || o.kind === "door") {
    let c = scaleRgb(ROOM_WALL, 0.62 + t * 0.38);
    if (o.kind === "shop" && t > 0.45) {
      // Shelves and goods in the upper part.
      const shelf = Math.floor(t * 9);
      if (Math.abs(t * 9 - shelf) < 0.12) c = [120, 110, 100];
      else if (cellRand(Math.floor(u * 14), shelf, seed) < 0.55) {
        const pick = cellRand(Math.floor(u * 14), shelf + 31, seed);
        c = pick < 0.33 ? [190, 70, 60] : pick < 0.66 ? [70, 120, 170] : [220, 190, 80];
      }
    }
    return c;
  }
  // A window: sky in the glass, a little curtain at the sides.
  let c = mixRgb(SKY_LOW, SKY_TOP, t);
  if (u < 0.14 || u > 0.86) c = mixRgb(c, [222, 210, 186], 0.55);
  return c;
}

/**
 * A facade's texture: one period wide, one storey tall (floor at the bottom), 32 px a metre,
 * sides rounded to a multiple of 4. Works for any facade, listed or not (spec houses).
 */
export function facadeTexture(fc: Facade): Uint8Array {
  const layout = LAYOUTS[fc.layout as LayoutName] ?? LAYOUTS.blank;
  const w = round4(layout.period * PX_PER_M), h = round4(layout.storey * PX_PER_M);
  const seed = seedOf(fc.name, fc.colour);
  const stain = tilingNoise(w, h, 3, seed ^ 0x51ed);
  const grain = (x: number, y: number) => (cellRand(x, y, seed ^ 0x9a1) - 0.5) * 10;
  const frame = 0.06;
  const big = layout.openings[0];
  const rgba = paint(w, h, (x, y) => {
    const mx = ((x + 0.5) / w) * layout.period;
    const mz = layout.storey - ((y + 0.5) / h) * layout.storey;
    let c: RGB | null = null;
    // 1. The shop sign fascia.
    if (layout.sign && mz >= 3.1 && mz <= 3.85) {
      const sign = fc.sign ?? fc.trim;
      c = sign;
      const bandT = (mz - 3.1) / 0.75;
      if (bandT > 1 / 3 && bandT < 2 / 3 && mx > 0.6 && mx < layout.period - 0.6) {
        const letter = Math.floor(mx / 0.32);
        const inLetter = mx - letter * 0.32;
        if (inLetter > 0.06 && cellRand(letter, 3, seed) > 0.18) c = [244, 242, 236];
      }
    }
    // 2. A balcony in front of the big opening.
    if (!c && layout.balcony) {
      if (mz <= 0.22) c = scaleRgb(fc.colour, 1.08);
      else if (big && mx >= big.x0 && mx <= big.x1 && mz <= 1.15) {
        if (mz >= 1.09 || mx - big.x0 < 0.05 || big.x1 - mx < 0.05) c = fc.trim;
        else {
          const inside = mz >= big.z0 ? openingPixel(fc, big, (mx - big.x0) / (big.x1 - big.x0), mz, seed) : wallPixel(fc, layout, w, h, x, y, seed);
          c = mixRgb(inside, BALCONY_WASH, 0.45);
        }
      }
    }
    // 3. Openings with their frames.
    if (!c) {
      for (const o of layout.openings) {
        if (mx < o.x0 - frame || mx > o.x1 + frame || mz < o.z0 - frame || mz > o.z1 + frame) continue;
        const inside = mx >= o.x0 && mx <= o.x1 && mz >= o.z0 && mz <= o.z1;
        const mid = (o.x0 + o.x1) / 2;
        if (!inside || (o.x1 - o.x0 > 1.6 && Math.abs(mx - mid) < frame / 2)) c = fc.trim;
        else c = openingPixel(fc, o, (mx - o.x0) / (o.x1 - o.x0), mz, seed);
        break;
      }
    }
    // 4. Bare wall.
    if (!c) {
      const wall = wallPixel(fc, layout, w, h, x, y, seed);
      c = scaleRgb(wall, 0.92 + stain(x, y) * 0.12);
    }
    const g = grain(x, y);
    return [c[0] + g, c[1] + g, c[2] + g];
  });
  return encodePng(rgba, w, h, { alpha: false });
}

const ROOF_PX = 128; // 2 m square

/** A roof finish's texture: 2 m square in 128 px, the slope running down the image. */
export function roofTexture(r: RoofFinish): Uint8Array {
  const n = ROOF_PX;
  const seed = seedOf(r.name, r.rgb);
  const mottle = tilingNoise(n, n, 4, seed ^ 0x77);
  const grain = (x: number, y: number) => (cellRand(x, y, seed ^ 0x3c3) - 0.5) * 12;
  const c0 = r.rgb;
  const rgba = paint(n, n, (x, y) => {
    let c: RGB;
    switch (r.kind) {
      case "tile": {
        const rows = 6, across = 8;
        const rh = n / rows, tw = n / across;
        const row = Math.floor(y / rh);
        const xs = (x + (row % 2 ? tw / 2 : 0)) % n;
        const col = Math.floor(xs / tw);
        const u = (xs - col * tw) / tw, v = (y - row * rh) / rh;
        const fire = 0.84 + cellRand(row, col % across, seed) * 0.28;
        const roll = 0.8 + 0.28 * Math.sin(u * Math.PI);
        c = v > 0.88 ? scaleRgb(c0, 0.55) : scaleRgb(c0, fire * roll);
        break;
      }
      case "ctile": {
        const rows = 6, across = 6;
        const rh = n / rows, tw = n / across;
        const row = Math.floor(y / rh);
        const xs = (x + (row % 2 ? tw / 2 : 0)) % n;
        const col = Math.floor(xs / tw);
        const v = (y - row * rh) / rh;
        const tone = 0.92 + cellRand(row, col % across, seed) * 0.12;
        c = v > 0.85 ? scaleRgb(c0, 0.5) : xs - col * tw < 1 ? scaleRgb(c0, 0.8) : scaleRgb(c0, tone);
        break;
      }
      case "membrane": {
        const seam = x % (n / 2) < 2;
        c = seam ? scaleRgb(c0, 1.08) : scaleRgb(c0, 0.9 + mottle(x, y) * 0.18);
        break;
      }
      case "gravel": {
        const s = cellRand(x, y, seed);
        c = scaleRgb(c0, s < 0.15 ? 0.7 : s > 0.88 ? 1.18 : 0.94 + s * 0.1);
        break;
      }
      default: {
        const ribs = 26;
        const t = ((x + 0.5) / n) * ribs;
        c = scaleRgb(c0, (0.9 + 0.1 * Math.cos(t * 2 * Math.PI)) * (0.95 + mottle(x, y) * 0.1));
      }
    }
    const g = grain(x, y);
    return [c[0] + g, c[1] + g, c[2] + g];
  });
  return encodePng(rgba, n, n, { alpha: false });
}

// ---------------------------------------------------------------------------------------------
// Dressing

export type BuildingType = "house" | "townhouse" | "flats" | "apartments" | "office" | "tower" | "shop" | "warehouse" | "shed" | "hall";
export type RoofShape = "flat" | "hip" | "gable" | "skillion";

/** What a building is and wears. */
export interface Dress {
  type: BuildingType;
  /** Index into FACADES. */
  facade: number;
  /** A different facade for the ground floor (a shopfront under offices or flats). */
  groundFacade?: number;
  roof: RoofShape;
  /** Index into ROOF_COLOURS. */
  roofColour: number;
  /** Roof pitch, degrees. */
  pitch: number;
  /** Wall height above the floor, metres. */
  height: number;
  verandah?: boolean;
  awning?: boolean;
  /** Parapet above a flat roof, metres. */
  parapet?: number;
  garage?: boolean;
}

export interface DressInfo {
  /** Height OSM actually gave (a guess must be passed as undefined). */
  height?: number;
  /** OSM `building` value. */
  kind?: string;
  /** Footprint area, m^2. */
  area: number;
  /** Class of a point of interest inside the footprint. */
  poi?: string;
  /** The roof finish seen in the photo (index into ROOF_COLOURS). */
  photoRoof?: number;
  rectangle: boolean;
  /** On the street front (setback under 15 m). */
  fronted: boolean;
  seed: number;
}

const SHOP_POI = /^(shop|grocery|clothing_store|cafe|restaurant|fast_food|bar|pub)$/;
const HALL_KIND = /^(church|chapel|cathedral|school|civic|public|hall)$/;
const HALL_POI = /^(place_of_worship|school|college|kindergarten|community_centre|town_hall)$/;
const SHOP_KIND = /^(retail|commercial|kiosk|supermarket)$/;
const WAREHOUSE_KIND = /^(industrial|warehouse|manufacture|factory|hangar|barn|farm_auxiliary)$/;
const SHED_KIND = /^(garage|garages|shed|carport|hut|cabin|roof)$/;
const MIDRISE_KIND = /^(apartments|residential|dormitory|hotel)$/;

const named = (prefix: string) => FACADES.flatMap((f, i) => (f.name.startsWith(prefix) ? [i] : []));
const F = (name: string): number => {
  const i = FACADE_INDEX.get(name);
  if (i === undefined) throw new Error(`no facade ${name}`);
  return i;
};
const STYLE_FACADES = {
  brick: named("brick_"),
  weatherboard: named("wb_"),
  fibro: named("fibro_"),
  modern: [...named("render_"), ...named("clad_")],
  flats: named("flats_"),
  apartments: named("apt_"),
  office: named("office_"),
  glass: named("glass_"),
  shop: named("shop_"),
  upper: named("upper_"),
  shed: named("shed_"),
  hall: [F("hall_brick"), F("hall_cream")],
};
const METALS = ["surfmist", "shalegrey", "windspray", "woodland", "monument", "cream", "paperbark", "jasper", "manorred", "deepocean", "basalt", "dune", "zinc", "paleeucalypt", "cottagegreen"].map(roofByName);
const FIRST_SIX_METALS = ["surfmist", "shalegrey", "windspray", "woodland", "monument", "cream"].map(roofByName);
const TILES = ["terracotta", "terracotta_aged", "tile_charcoal", "tile_slate", "tile_brown", "tile_red", "tile_sand"].map(roofByName);
const HALL_ROOFS = ["terracotta", "tile_red", "manorred", "zinc"].map(roofByName);
const SHOP_ROOFS = ["zinc", "surfmist", "shalegrey"].map(roofByName);
const MEMBRANE = roofByName("membrane"), GRAVEL = roofByName("gravel");

/** Picks a key by weight. */
function weighted<T extends string>(rand: () => number, weights: [T, number][]): T {
  const total = weights.reduce((a, [, w]) => a + Math.max(0, w), 0);
  let r = rand() * total;
  for (const [k, w] of weights) {
    if (w <= 0) continue;
    if ((r -= w) < 0) return k;
  }
  return weights.filter(([, w]) => w > 0).slice(-1)[0][0];
}

const pick = <T>(rand: () => number, list: T[]): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];

/**
 * What a building is, from what's known about it (first matching rule wins; see the spec).
 * The same info and seed always give the same dress.
 */
export function dressBuilding(info: DressInfo): Dress {
  const rand = rng(info.seed);
  const kind = info.kind ?? "";
  const known = info.height !== undefined && info.height > 0 ? info.height : undefined;
  const photo = info.photoRoof !== undefined && ROOF_COLOURS[info.photoRoof] ? info.photoRoof : undefined;
  /** The photo's finish when known, otherwise one from the list. */
  const photoOr = (list: number[]) => (photo !== undefined ? photo : pick(rand, list));
  const photoMetal = () => (photo !== undefined && ROOF_COLOURS[photo].kind === "metal" ? photo : pick(rand, METALS));
  const flatFinish = () => (rand() < 2 / 3 ? MEMBRANE : GRAVEL);
  const shopPoi = !!info.poi && SHOP_POI.test(info.poi);

  // 1. Halls, churches and schools.
  if (HALL_KIND.test(kind) || (!!info.poi && HALL_POI.test(info.poi))) {
    const facade = pick(rand, STYLE_FACADES.hall);
    const height = Math.min(9, known ?? 5.5);
    if (info.rectangle) return { type: "hall", facade, roof: "gable", roofColour: photoOr(HALL_ROOFS), pitch: 30, height };
    return { type: "hall", facade, roof: "flat", roofColour: flatFinish(), pitch: 30, height };
  }

  // 2. Towers.
  const officeLike = kind === "office" || kind === "commercial";
  if ((known ?? 0) >= 30 || (officeLike && (known ?? 0) >= 18)) {
    const glass = officeLike || rand() < 0.45;
    return {
      type: glass ? "tower" : "apartments",
      facade: pick(rand, glass ? STYLE_FACADES.glass : STYLE_FACADES.apartments),
      roof: "flat", roofColour: flatFinish(), pitch: 0, height: known ?? 40, parapet: 1.2,
    };
  }

  // 3. Mid-rise: offices, flats and apartments.
  if ((known ?? 0) >= 9 || MIDRISE_KIND.test(kind) || (kind === "office" && info.area > 300)) {
    let type: "office" | "apartments" | "flats";
    if (kind === "office") type = "office";
    else if (/^(apartments|residential|dormitory)$/.test(kind)) type = rand() < 0.6 ? "apartments" : "flats";
    else type = weighted(rand, [["apartments", 5], ["office", 3], ["flats", 2]]);
    const facade = pick(rand, type === "office" ? STYLE_FACADES.office : type === "flats" ? STYLE_FACADES.flats : STYLE_FACADES.apartments);
    const shops = shopPoi || (type !== "flats" && info.fronted && rand() < 0.35);
    const layout = LAYOUTS[FACADES[facade].layout as LayoutName];
    const storeys = type === "flats" ? 3 : 5;
    const height = known ?? storeys * layout.storey + (shops ? 1 : 0);
    const dress: Dress = { type, facade, roof: "flat", roofColour: MEMBRANE, pitch: 20, height };
    if (type === "flats" && info.rectangle && rand() < 0.5) {
      dress.roof = "hip";
      dress.roofColour = photo !== undefined && isTiled(ROOF_COLOURS[photo]) ? photo : pick(rand, TILES);
    } else {
      dress.roofColour = flatFinish();
      dress.parapet = 0.9;
    }
    if (shops) {
      dress.groundFacade = pick(rand, STYLE_FACADES.shop);
      if (info.fronted) dress.awning = true;
    }
    return dress;
  }

  // 4. Shops.
  if (shopPoi || SHOP_KIND.test(kind)) {
    const twoStorey = (known ?? 0) > 6.5 || rand() < 0.3;
    const shop = pick(rand, STYLE_FACADES.shop);
    const dress: Dress = twoStorey
      ? { type: "shop", facade: pick(rand, STYLE_FACADES.upper), groundFacade: shop, roof: "flat", roofColour: photoOr(SHOP_ROOFS), pitch: 0, height: 7.2, parapet: 1.1 }
      : { type: "shop", facade: shop, roof: "flat", roofColour: photoOr(SHOP_ROOFS), pitch: 0, height: 4.2, parapet: 1.1 };
    if (info.fronted) dress.awning = true;
    return dress;
  }

  // 5. Warehouses.
  if (WAREHOUSE_KIND.test(kind) || info.area > 700) {
    const facade = weighted(rand, [...STYLE_FACADES.shed.map((i) => [String(i), 1] as [string, number]), [String(F("tiltup")), 2]]);
    const height = known !== undefined ? Math.max(5, Math.min(10, known)) : 7;
    return { type: "warehouse", facade: Number(facade), roof: info.rectangle ? "gable" : "flat", roofColour: photoMetal(), pitch: 6, height, garage: true };
  }

  // 6. Sheds.
  if (SHED_KIND.test(kind) || info.area < 30) {
    const facade = pick(rand, STYLE_FACADES.shed);
    const roof: RoofShape = info.rectangle ? (rand() < 0.5 ? "gable" : "skillion") : "flat";
    return { type: "shed", facade, roof, roofColour: photoMetal(), pitch: 10, height: 2.4 };
  }

  // 7. A mid-size low building on the street: often a shop.
  if (info.area > 350 && info.fronted && rand() < 0.5) {
    return { type: "shop", facade: pick(rand, STYLE_FACADES.shop), roof: "flat", roofColour: photoOr(SHOP_ROOFS), pitch: 0, height: 4.2, parapet: 1.1, awning: true };
  }

  // 8. Houses.
  const style = weighted(rand, [["brick", 34], ["modern", 16], ["weatherboard", 14], ["fibro", 7], ["townhouse", info.area > 140 ? 9 : 0]]);
  const twoStorey = style === "townhouse" || (style !== "fibro" && info.area > 150 && rand() < 0.25);
  const height = twoStorey ? 5.7 : 2.7;
  if (style === "modern" || style === "townhouse") {
    const facade = pick(rand, STYLE_FACADES.modern);
    const roof: RoofShape = info.rectangle ? weighted<RoofShape>(rand, [["skillion", 4], ["flat", 3], ["hip", 2], ["gable", 1]]) : "flat";
    const type: BuildingType = style === "townhouse" ? "townhouse" : "house";
    if (roof === "flat") return { type, facade, roof, roofColour: flatFinish(), pitch: 20, height, parapet: 0.5 };
    return { type, facade, roof, roofColour: photoMetal(), pitch: roof === "skillion" ? 6 : 20, height };
  }
  const facade = pick(rand, STYLE_FACADES[style]);
  if (!info.rectangle) return { type: "house", facade, roof: "flat", roofColour: flatFinish(), pitch: 20, height, parapet: 0.5 };
  const roof: RoofShape = rand() < 0.68 ? "hip" : "gable";
  const roofColour = style === "brick" ? photoOr([...TILES, ...FIRST_SIX_METALS]) : photoMetal();
  const pitch = style === "brick" && isTiled(ROOF_COLOURS[roofColour]) ? 22 : 20;
  const dress: Dress = { type: "house", facade, roof, roofColour, pitch, height };
  if (style === "weatherboard" && info.fronted && rand() < 0.4) dress.verandah = true;
  return dress;
}
