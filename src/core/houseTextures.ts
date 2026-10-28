// Textures for houses and their lots, drawn procedurally (no third-party
// art): WA brick and render walls with aluminium windows, panel-lift garage
// doors, Colorbond side fences, limestone and brick front walls, hedges,
// garden-bed mulch and two garden shrubs.
//
// Wall textures are 64 px per metre, one 3 m storey tall and 8 m wide, laid
// on the walls by buildings.ts with their bottom on the floor.

import { encodePng } from "./png";
import { fill, rng } from "./textures";

type RGB = [number, number, number];

/** The same kinds, in the same order, as FACADES in textures.ts. */
export type Facade = "brick" | "weatherboard" | "render" | "creambrick" | "fibro";

/** Metres one facade repeat covers across, and down. */
export const FACADE_SIZE = { w: 8, h: 3 } as const;
/** Fence panel and front wall repeats, metres across. */
export const FENCE_PANEL = 2.4;
export const FENCE_HEIGHT = 1.8;
export const FRONT_WALL_REPEAT = 2;

const PX = 64;

/** Plain wall at (x, y) metres (y down): brick courses, boards or render. */
function wallPixel(kind: Facade, x: number, y: number, n: number): RGB {
  if (kind === "brick" || kind === "creambrick") {
    // 230 x 76 mm bricks with 10 mm joints, stretcher bond.
    const course = Math.floor(y / 0.086);
    const xo = x + (course % 2) * 0.12;
    const mortar = y % 0.086 < 0.012 || xo % 0.24 < 0.012;
    const id = course * 31 + Math.floor(xo / 0.24) * 17;
    const tone = ((id * 2654435761) >>> 0) % 7 - 3;
    if (kind === "brick") {
      if (mortar) return [190 + n, 180 + n, 164 + n];
      return [168 + tone * 7 + n, 86 + tone * 4 + n, 58 + tone * 2 + n];
    }
    if (mortar) return [205 + n, 198 + n, 182 + n];
    return [222 + tone * 4 + n, 200 + tone * 4 + n, 158 + tone * 3 + n];
  }
  if (kind === "weatherboard") {
    // 150 mm boards with a shadow line under each.
    const board = (y % 0.15) / 0.15;
    const k = board > 0.85 ? 0.8 : 0.96 + board * 0.04;
    return [236 * k + n, 234 * k + n, 224 * k + n];
  }
  if (kind === "fibro") {
    // Fibro-cement sheets, 1.2 m wide, with cover strips.
    const strip = x % 1.2 < 0.05;
    return strip ? [205 + n, 205 + n, 198 + n] : [226 + n / 2, 224 + n / 2, 214 + n / 2];
  }
  return [228 + n, 222 + n, 206 + n];
}

function frameColour(kind: Facade): RGB {
  return kind === "creambrick" ? [44, 45, 46] : [236, 236, 230];
}

/** Window glass: sky reflected at the top, dark inside, sometimes a blind. */
function glass(_u: number, v: number, blind: number, n: number): RGB {
  if (v < blind) return [214 + n, 206 + n, 186 + n];
  const g = 70 + (1 - v) * 70 + n;
  return [g * 0.72, g * 0.84, g];
}

/** One storey of wall 8 m wide by 3 m (from the floor up), with a wide sliding window and a narrower one. */
export function facadeTexture(kind: Facade): Uint8Array {
  const w = FACADE_SIZE.w * PX, h = FACADE_SIZE.h * PX;
  const r = rng(61 + kind.length * 13);
  const windows = [
    { x0: 0.8, x1: 2.6, blind: 0.35, split: true },
    { x0: 5.0, x1: 6.2, blind: 0, split: false },
  ];
  // Measured down from 3 m above the floor: heads at 2.25 m, sills at 0.95 m.
  const y0 = 0.75, y1 = 2.05, f = 0.045;
  const frame = frameColour(kind);
  return encodePng(fill(w, h, (px, py) => {
    const x = px / PX, y = py / PX, n = (r() - 0.5) * 12;
    for (const win of windows) {
      if (x > win.x0 - f && x < win.x1 + f && y > y0 - f && y < y1 + f) {
        const inside = x > win.x0 && x < win.x1 && y > y0 && y < y1;
        const mull = win.split && Math.abs(x - (win.x0 + win.x1) / 2) < f / 2;
        if (!inside || mull) return [frame[0] + n / 3, frame[1] + n / 3, frame[2] + n / 3];
        return glass((x - win.x0) / (win.x1 - win.x0), (y - y0) / (y1 - y0), win.blind, n / 2);
      }
      // Sill under the window.
      if (x > win.x0 - 0.1 && x < win.x1 + 0.1 && y >= y1 + f && y < y1 + f + 0.07) {
        const c = kind === "brick" || kind === "creambrick" ? wallPixel(kind, x, y, n).map((v) => v * 0.82) as RGB : [214 + n, 212 + n, 204 + n] as RGB;
        return c;
      }
    }
    let c = wallPixel(kind, x, y, n);
    // Shade under the eaves.
    if (y < 0.4) c = c.map((v) => v * (0.62 + 0.38 * (y / 0.4))) as RGB;
    return c;
  }), w, h, { alpha: false });
}

export const FENCE_COLOURS: { name: string; rgb: RGB }[] = [
  { name: "woodland", rgb: [96, 98, 90] },
  { name: "basalt", rgb: [104, 107, 110] },
  { name: "paperbark", rgb: [196, 186, 160] },
];

/** Colorbond fence panel, 2.4 m by 1.8 m: vertical ribs, top rail, a post at the edge. */
export function fenceTexture(rgb: RGB): Uint8Array {
  const w = 256, h = 192;
  const r = rng(rgb[0]);
  return encodePng(fill(w, h, (px, py) => {
    const x = (px / w) * FENCE_PANEL, y = (py / h) * FENCE_HEIGHT, n = (r() - 0.5) * 6;
    let k = 1;
    if (x < 0.05) k = 0.78; // post
    else if (y < 0.05 || y > FENCE_HEIGHT - 0.04) k = 0.9; // rails
    else {
      const rib = ((x - 0.05) % 0.19) / 0.19;
      k = rib < 0.12 ? 0.86 : rib < 0.2 ? 1.08 : 0.97;
    }
    return [rgb[0] * k + n, rgb[1] * k + n, rgb[2] * k + n];
  }), w, h, { alpha: false });
}

/** Low front wall, 2 m by 1 m (top-down): random-coursed limestone or face brick, with a capping. */
export function frontWallTexture(kind: "limestone" | "brick"): Uint8Array {
  const w = 128, h = 64;
  const r = rng(kind === "limestone" ? 5 : 6);
  // Limestone: courses 0.2 m, blocks 0.3 to 0.5 m long.
  const joints: number[][] = [];
  for (let c = 0; c < 5; c++) {
    const row: number[] = [];
    for (let x = r() * 0.3; x < 2; x += 0.3 + r() * 0.2) row.push(x);
    joints.push(row);
  }
  return encodePng(fill(w, h, (px, py) => {
    const x = (px / w) * 2, y = (py / h), n = (r() - 0.5) * 16;
    if (y < 0.06) return [222 + n / 2, 218 + n / 2, 208 + n / 2]; // capping
    if (kind === "brick") return wallPixel("brick", x, y, n);
    const course = Math.min(4, Math.floor((y - 0.06) / 0.19));
    const joint = (y - 0.06) % 0.19 < 0.015 || joints[course].some((j) => Math.abs(x - j) < 0.012);
    if (joint) return [176 + n / 2, 166 + n / 2, 146 + n / 2];
    const pit = r() < 0.06 ? 0.85 : 1;
    return [218 * pit + n, 202 * pit + n, 164 * pit + n];
  }), w, h, { alpha: false });
}

/** Clipped hedge, 2 m by 1 m. */
export function hedgeTexture(): Uint8Array {
  const w = 128, h = 64;
  const r = rng(12);
  return encodePng(fill(w, h, (_x, py) => {
    const k = 0.7 + r() * 0.5 - (py / h) * 0.15;
    return [44 * k, 72 * k, 36 * k];
  }), w, h, { alpha: false });
}

/** Garden-bed mulch, 2 m square: dark bark chips. */
export function mulchTexture(): Uint8Array {
  const w = 128, h = 128;
  const r = rng(13);
  return encodePng(fill(w, h, () => {
    const k = 0.55 + r() * 0.6;
    return [96 * k, 70 * k, 50 * k];
  }), w, h, { alpha: false });
}

/** Garden shrubs: a 1024 x 512 atlas of two (grey-green rounded bush; green bush with yellow flowers). */
export const SHRUB_SPECIES = [
  { name: "westringia", u0: 0, u1: 0.5 },
  { name: "flowering", u0: 0.5, u1: 1 },
] as const;

export function shrubAtlas(): Uint8Array {
  const W = 1024, H = 512, C = 512;
  const px = new Uint8Array(W * H * 4);
  const put = (x: number, y: number, c: RGB) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (yi < 0 || yi >= H || xi < 0 || xi >= W) return;
    const i = (yi * W + xi) * 4;
    px.set([c[0], c[1], c[2], 255].map((v) => Math.max(0, Math.min(255, Math.round(v)))), i);
  };
  [0, 1].forEach((s) => {
    const r = rng(300 + s);
    const x0 = s * C;
    const base: RGB = s === 0 ? [92, 110, 88] : [56, 92, 44];
    // Dome: wider than tall, sitting on the ground (bottom of the cell).
    for (let k = 0; k < 9000; k++) {
      const a = r() * Math.PI, d = Math.sqrt(r());
      const cx = 256 + Math.cos(a) * d * 230, cy = 500 - Math.sin(a) * d * 330;
      const lit = 0.65 + 0.5 * (1 - cy / 500) + (r() - 0.5) * 0.3;
      const flower = s === 1 && r() < 0.12 && d > 0.5;
      const col: RGB = flower ? [236, 196, 40] : [base[0] * lit, base[1] * lit, base[2] * lit];
      const len = flower ? 3 : 4 + r() * 7, ang = (r() - 0.5) * 2;
      for (let i = 0; i < len; i++) {
        put(x0 + cx + Math.sin(ang) * i, cy - Math.cos(ang) * i, col);
        if (flower) put(x0 + cx + 1 + Math.sin(ang) * i, cy - Math.cos(ang) * i, col);
      }
    }
  });
  return encodePng(px, W, H);
}
