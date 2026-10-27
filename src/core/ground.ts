// Ground that holds up at eye height. The aerial photo is fine from the air
// but blurry from a driver's seat, so terrain chunks use AC's ksMultilayer
// shader: the photo stays as the colour (txDiffuse), multiplied by four tiled,
// colour-neutral detail textures (lawn, rough grass, sand, leaf litter) mixed
// by a mask (txMask) read off the same photo.
//
// ksMultilayer: colour = txDiffuse * (detailR * mask.r + detailG * mask.g +
// detailB * mask.b + detailA * mask.a) * magicMult, with each detail's UVs
// scaled by multR..multA. The details average 0.5, so magicMult = 2 keeps the
// photo's brightness.

export const GROUND_LAYERS = ["lawn", "rough", "sand", "litter"] as const;
export type GroundLayer = (typeof GROUND_LAYERS)[number];

/** Metres one repeat of each detail texture covers. */
export const GROUND_TILE_METRES: Record<GroundLayer, number> = { lawn: 1.6, rough: 2.2, sand: 2.5, litter: 3 };

export interface GroundDetail {
  rgba: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Mask (RGBA = lawn, rough, sand, litter weights) for a photo of `size` x `size`
 * pixels, at `out` x `out`. Green → lawn; straw and grey-green → rough grass;
 * bright and pale → sand; dark or brown → leaf litter (garden beds, under trees).
 */
export function groundMask(rgba: Uint8Array | Uint8ClampedArray, size: number, out = 256): Uint8Array {
  const step = size / out;
  const w = new Float32Array(out * out * 4);
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      // Average the photo pixels under this mask pixel.
      let r = 0, g = 0, b = 0, n = 0;
      const x0 = Math.floor(x * step), x1 = Math.max(x0 + 1, Math.floor((x + 1) * step));
      const y0 = Math.floor(y * step), y1 = Math.max(y0 + 1, Math.floor((y + 1) * step));
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * size + xx) * 4;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
          n++;
        }
      }
      r /= n * 255;
      g /= n * 255;
      b /= n * 255;
      const scores = classify(r, g, b);
      w.set(scores, (y * out + x) * 4);
    }
  }
  // Soften the borders between surfaces: a 3 x 3 blur.
  const blurred = new Float32Array(w.length);
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      for (let c = 0; c < 4; c++) {
        let s = 0, k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy, xx = x + dx;
            if (yy < 0 || yy >= out || xx < 0 || xx >= out) continue;
            s += w[(yy * out + xx) * 4 + c];
            k++;
          }
        }
        blurred[(y * out + x) * 4 + c] = s / k;
      }
    }
  }
  const mask = new Uint8Array(out * out * 4);
  for (let p = 0; p < out * out; p++) {
    const sum = blurred[p * 4] + blurred[p * 4 + 1] + blurred[p * 4 + 2] + blurred[p * 4 + 3] || 1;
    for (let c = 0; c < 4; c++) mask[p * 4 + c] = Math.round((blurred[p * 4 + c] / sum) * 255);
  }
  return mask;
}

/** Weights (lawn, rough, sand, litter) for one photo colour, 0..1 each; at least one is positive. */
export function classify(r: number, g: number, b: number): [number, number, number, number] {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max > 0 ? (max - min) / max : 0;
  const green = g - Math.max(r, b);            // lawn and watered verges
  const straw = Math.min(r, g) - b;            // dry grass: red and green together, blue low
  const lawn = clamp01(green * 12) * clamp01((lum - 0.12) * 6);
  // Straw that isn't clearly green: green grass also has red above blue.
  const rough = clamp01(straw * 6) * (1 - clamp01(green * 10)) * clamp01((lum - 0.18) * 5) * (1 - clamp01((lum - 0.62) * 6))
    + 0.15 * clamp01(green * 12) * clamp01((0.3 - lum) * 6);
  const sand = clamp01((lum - 0.55) * 5) * clamp01((0.35 - sat) * 4);
  const litter = clamp01((0.22 - lum) * 6) + clamp01((r - g) * 8) * clamp01((0.5 - lum) * 4);
  const out: [number, number, number, number] = [lawn, rough, sand, litter];
  if (out.every((v) => v <= 0.02)) out[1] = 1; // anything unclear reads as rough grass
  return out;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
