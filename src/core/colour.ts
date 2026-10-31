// Aerial colour matching: fit each channel's mean and spread to a reference image of the same
// area, keeping the source's detail with a natural colour balance. Only NSW imagery uses it
// (`BALANCED` in src/services/tiles.ts). Written from docs/specs/colour.md.

type Pixels = Uint8Array | Uint8ClampedArray;

/** Per channel (R, G, B): out = in · gain + offset, on 0..255 values. */
export interface ColourTransform { gain: [number, number, number]; offset: [number, number, number] }

const MIN_PIXELS = 64;
const MIN_ALPHA = 128;

type Stats = { mean: [number, number, number]; sd: [number, number, number] };

/** Per-channel mean and population standard deviation (floored at 1) of opaque pixels, or null. */
function stats(px: Pixels): Stats | null {
  const sum = [0, 0, 0], sq = [0, 0, 0];
  let n = 0;
  const end = px.length - (px.length % 4);
  for (let i = 0; i < end; i += 4) {
    if (px[i + 3] < MIN_ALPHA) continue;
    for (let c = 0; c < 3; c++) {
      const v = px[i + c];
      sum[c] += v;
      sq[c] += v * v;
    }
    n++;
  }
  if (n < MIN_PIXELS) return null;
  const mean = sum.map((s) => s / n) as [number, number, number];
  const sd = sq.map((s, c) => Math.sqrt(Math.max(1, s / n - mean[c] * mean[c]))) as [number, number, number];
  return { mean, sd };
}

/** The transform that gives `src` the colour statistics of `ref` (RGBA, any sizes), or null. */
export function matchColours(src: Pixels, ref: Pixels): ColourTransform | null {
  const s = stats(src), r = stats(ref);
  if (!s || !r) return null;
  const gain = [0, 1, 2].map((c) => Math.min(2, Math.max(0.5, r.sd[c] / s.sd[c]))) as [number, number, number];
  const offset = [0, 1, 2].map((c) => r.mean[c] - s.mean[c] * gain[c]) as [number, number, number];
  return { gain, offset };
}

/** Applies the transform to R, G and B of every whole pixel in place (alpha untouched). */
export function applyColours(px: Pixels, t: ColourTransform): void {
  const end = px.length - (px.length % 4);
  for (let i = 0; i < end; i += 4) {
    for (let c = 0; c < 3; c++) {
      px[i + c] = Math.min(255, Math.max(0, Math.floor(px[i + c] * t.gain[c] + t.offset[c] + 0.5)));
    }
  }
}
