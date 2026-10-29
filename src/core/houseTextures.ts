// Textures for house lots, drawn procedurally (no third-party art): Colorbond
// side fences, limestone and brick front walls, hedges, garden-bed mulch and
// two garden shrubs. (House walls and roofs are upstream's, buildingStyles.ts.)

import { encodePng } from "./png";
import { fill, rng } from "./textures";

type RGB = [number, number, number];

/** Fence panel and front wall repeats, metres across. */
export const FENCE_PANEL = 2.4;
export const FENCE_HEIGHT = 1.8;
export const FRONT_WALL_REPEAT = 2;

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
    if (kind === "brick") {
      // Red brick, 230 x 76 mm with 10 mm joints, stretcher bond.
      const course = Math.floor(y / 0.086), xo = x + (course % 2) * 0.12;
      if (y % 0.086 < 0.012 || xo % 0.24 < 0.012) return [190 + n, 180 + n, 164 + n];
      const tone = ((course * 31 + Math.floor(xo / 0.24) * 17) * 2654435761 >>> 0) % 7 - 3;
      return [168 + tone * 7 + n, 86 + tone * 4 + n, 58 + tone * 2 + n];
    }
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
