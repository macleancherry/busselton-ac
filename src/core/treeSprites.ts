// Tree sprites for the alpha-tested crossed-quad trees, drawn procedurally so
// the track ships no third-party art: four South West WA species side by side
// in one 2048 x 1024 atlas (each 512 x 1024).
//
//   0 WA peppermint (Agonis flexuosa): Busselton's street tree. Short leaning
//     trunk, dense dark crown, weeping foliage.
//   1 she-oak (Casuarina): the foreshore. Wispy grey-green drooping needles,
//     see-through.
//   2 Norfolk Island pine: tall, straight trunk, flat horizontal tiers.
//   3 tuart (Eucalyptus gomphocephala): big pale-trunked gum, open clumpy
//     olive crown.

import { encodePng } from "./png";

/** Small seeded PRNG (mulberry32); kept local so this module doesn't import scenery.ts (which imports it). */
function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TreeSpecies {
  name: string;
  u0: number;
  u1: number;
  /** Sprite height at scale 1, metres. */
  height: number;
  /** Crown radius at scale 1, metres (half the quad width). */
  crown: number;
}

const W = 2048, H = 1024, CELL = 512;

export const TREE_SPECIES: TreeSpecies[] = [
  { name: "peppermint", u0: 0, u1: 0.25, height: 9, crown: 4.5 },
  { name: "sheoak", u0: 0.25, u1: 0.5, height: 11, crown: 4 },
  { name: "norfolk", u0: 0.5, u1: 0.75, height: 22, crown: 5.5 },
  { name: "tuart", u0: 0.75, u1: 1, height: 17, crown: 7.5 },
];

type RGB = [number, number, number];

class Canvas {
  readonly px = new Uint8Array(W * H * 4);
  constructor(private readonly x0: number) {}
  put(x: number, y: number, c: RGB, a = 255): void {
    const xi = Math.floor(x) + this.x0, yi = Math.floor(y);
    if (xi < this.x0 || xi >= this.x0 + CELL || yi < 0 || yi >= H) return;
    const i = (yi * W + xi) * 4;
    if (a < 255 && this.px[i + 3]) {
      const k = a / 255;
      for (let ch = 0; ch < 3; ch++) this.px[i + ch] = Math.round(this.px[i + ch] * (1 - k) + c[ch] * k);
      return;
    }
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
    this.px[i + 3] = 255;
  }
  line(x1: number, y1: number, x2: number, y2: number, w1: number, w2: number, c: (t: number) => RGB): void {
    const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 1.5) + 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t, w = w1 + (w2 - w1) * t;
      for (let dx = -w; dx <= w; dx++) this.put(x + dx, y, c(t));
    }
  }
}

const shade = (c: RGB, k: number): RGB => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
const jitter = (c: RGB, r: () => number, amt: number): RGB => shade(c, 1 + (r() - 0.5) * amt);

/** A short leaf stroke at (x, y) hanging at `angle` (radians from straight down). */
function leaf(cv: Canvas, x: number, y: number, len: number, angle: number, c: RGB): void {
  for (let i = 0; i < len; i++) cv.put(x + Math.sin(angle) * i, y + Math.cos(angle) * i, c);
}

/** Light from above and slightly left: brighter at the top of the crown and of each clump. */
function lit(base: RGB, y: number, top: number, bottom: number, local: number, r: () => number): RGB {
  const v = 1 - (y - top) / Math.max(1, bottom - top);
  return jitter(shade(base, 0.62 + 0.45 * v + 0.25 * local), r, 0.25);
}

function peppermint(cv: Canvas, r: () => number): void {
  const bark: RGB = [86, 70, 58];
  // Leaning, slightly twisted trunk with spreading limbs.
  const tx = 256, base = 1024, fork = 800;
  cv.line(tx, base, tx - 14, fork, 15, 11, () => jitter(bark, r, 0.3));
  const limbs: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const ex = tx - 14 + (r() - 0.5) * 260, ey = fork - 140 - r() * 380;
    cv.line(tx - 18, fork + 20, ex, ey, 8, 3, () => jitter(bark, r, 0.3));
    limbs.push([ex, ey]);
  }
  // Dense rounded crown of weeping leaf clumps.
  const leafC: RGB = [52, 78, 40];
  for (let k = 0; k < 760; k++) {
    const [lx, ly] = limbs[Math.floor(r() * limbs.length)];
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 110;
    const cx = Math.max(60, Math.min(452, lx + Math.cos(a) * d)), cy = ly + Math.sin(a) * d * 0.8 + 40;
    for (let j = 0; j < 26; j++) {
      const x = cx + (r() - 0.5) * 34, y = cy + (r() - 0.3) * 30;
      const local = (cy - y) / 30 + (cx - x) / 60;
      // Weeping: long hanging leaves on the outside of the crown.
      const len = 6 + r() * 8 + (Math.abs(x - tx) > 130 ? 10 * r() : 0);
      leaf(cv, x, y, len, (r() - 0.5) * 0.4, lit(leafC, y, 150, 900, local, r));
    }
  }
}

function sheoak(cv: Canvas, r: () => number): void {
  const bark: RGB = [74, 64, 58];
  const tx = 256;
  cv.line(tx, 1024, tx + 10, 470, 10, 5, () => jitter(bark, r, 0.35));
  const tips: [number, number][] = [];
  for (let i = 0; i < 14; i++) {
    const sy = 860 - i * 30 - r() * 20, side = i % 2 ? 1 : -1;
    const ex = tx + side * (40 + r() * 150) * (1 - i / 22), ey = sy - 60 - r() * 90;
    cv.line(tx + 5, sy, ex, ey, 4, 1.5, () => jitter(bark, r, 0.3));
    tips.push([ex, ey]);
  }
  tips.push([tx + 10, 470]);
  // Fine drooping needle strands, grey-green and see-through.
  const needle: RGB = [78, 92, 68];
  for (let k = 0; k < 1400; k++) {
    const [lx, ly] = tips[Math.floor(r() * tips.length)];
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 75;
    const x = lx + Math.cos(a) * d, y = ly + Math.sin(a) * d * 0.7 - 20;
    const c = lit(needle, y, 380, 900, (ly - y) / 60, r);
    for (let s = 0; s < 3; s++) leaf(cv, x + (r() - 0.5) * 8, y, 18 + r() * 34, (r() - 0.5) * 0.25, c);
  }
}

function norfolk(cv: Canvas, r: () => number): void {
  const bark: RGB = [96, 82, 68];
  const tx = 256, top = 30;
  cv.line(tx, 1024, tx, top, 9, 1.5, () => jitter(bark, r, 0.25));
  // Flat tiers of horizontal branches, widest low down, tips turning up.
  const needle: RGB = [38, 70, 40];
  const tiers = 16;
  for (let t = 0; t < tiers; t++) {
    const y = top + 20 + t * ((940 - top) / tiers) * (0.85 + 0.15 * (t / tiers));
    const span = 30 + (t / tiers) * 200 * (0.9 + r() * 0.2);
    for (const side of [-1, 1]) {
      const ex = tx + side * span, ey = y + 10 - r() * 18;
      cv.line(tx, y + 6, ex, ey, 2.5, 1, () => jitter(bark, r, 0.3));
      // Foliage pads along the branch, denser and lifted toward the tip.
      for (let k = 0; k < 420; k++) {
        const f = Math.pow(r(), 0.7), x = tx + side * span * f, yy = y + 6 + (ey - y - 6) * f - f * f * 18;
        const c = lit(needle, yy - 10 * r(), top, 980, (r() - 0.6), r);
        // Pads of upturned needles above the branch, a few hanging below.
        const up = r() < 0.8;
        leaf(cv, x + (r() - 0.5) * 14, yy + (up ? -2 : 4), 5 + r() * 12 * (1 - f * 0.4), up ? Math.PI + (r() - 0.5) * 1.4 : (r() - 0.5) * 0.6, c);
      }
    }
  }
}

function tuart(cv: Canvas, r: () => number): void {
  const bark: RGB = [178, 172, 160];
  const tx = 256, fork = 640;
  cv.line(tx, 1024, tx + 6, fork, 26, 18, (t) => shade(jitter(bark, r, 0.18), 0.8 + 0.2 * t));
  const ends: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const ex = Math.max(110, Math.min(402, tx + (i - 1.5) * 110 + (r() - 0.5) * 50)), ey = 420 - r() * 160;
    cv.line(tx + 6, fork, ex, ey, 14, 5, () => shade(jitter(bark, r, 0.2), 0.95));
    for (let j = 0; j < 3; j++) {
      const bx = ex + (r() - 0.5) * 170, by = ey - 30 - r() * 110;
      cv.line(ex, ey, bx, by, 5, 2, () => jitter(bark, r, 0.2));
      ends.push([bx, by]);
    }
  }
  // Open crown of separate olive clumps with sky between them.
  const leafC: RGB = [84, 98, 60];
  for (const [ex, ey] of ends) {
    const clumps = 5 + Math.floor(r() * 3);
    for (let k = 0; k < clumps; k++) {
      const cx = Math.max(70, Math.min(442, ex + (r() - 0.5) * 120)), cy = ey + (r() - 0.3) * 110, rad = 34 + r() * 34;
      for (let j = 0; j < 320; j++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.7;
        leaf(cv, x, y, 4 + r() * 6, (r() - 0.5) * 0.8, lit(leafC, y, 40, 640, (cy - y) / rad, r));
      }
    }
  }
}

/** The 2048 x 1024 RGBA atlas of all four species. */
export function treeSpeciesPixels(): Uint8Array {
  const px = new Uint8Array(W * H * 4);
  const painters = [peppermint, sheoak, norfolk, tuart];
  painters.forEach((paint, i) => {
    const cv = new Canvas(i * CELL);
    paint(cv, rng(1000 + i * 77));
    // Copy this cell's pixels over (each canvas owns a full-size buffer).
    for (let y = 0; y < H; y++) {
      const off = (y * W + i * CELL) * 4;
      px.set(cv.px.subarray(off, off + CELL * 4), off);
    }
  });
  return px;
}

export function treeSpeciesAtlas(): Uint8Array {
  return encodePng(treeSpeciesPixels(), W, H);
}

/**
 * Which species grows here: the coast (near water in the aerial photo) is
 * she-oaks with some Norfolk pines and peppermints; kerbed town streets are
 * mostly peppermints; the foreshore (sea within 120 m by the coastline) mostly Norfolk
 * pines; elsewhere tuarts and peppermints, as around the Ludlow
 * and Vasse bush.
 */
export function pickSpecies(r: number, coastal: boolean, town: boolean, foreshore = false): number {
  // The foreshore itself (between the beach and the first street) is lined with Norfolk pines.
  if (foreshore) return r < 0.7 ? 2 : r < 0.9 ? 0 : 1;
  if (coastal) return r < 0.6 ? 1 : r < 0.8 ? 2 : 0;
  if (town) return r < 0.75 ? 0 : r < 0.9 ? 1 : 3;
  return r < 0.55 ? 3 : 0;
}
