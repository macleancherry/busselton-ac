// Photo road surface: one road chunk's stretch of the aerial photo, resampled into a strip and
// cleaned up for driving on (paint and cars painted out, shadows flattened, toned to asphalt,
// fine grain added). Spec: docs/specs/photoSurface.md.
//
// Strip layout: column 0 is the road's left edge, the last column the right; row 0 is section
// `a`, the last row section `b`. Colour buffers are float32 (three channels interleaved);
// scalar maths is double. Brightness ("lum") is always the plain mean of the three channels.

import type { RoadPlan } from "./road";
import type { RasterSampler } from "./trace";
import { mulberry32 } from "./random";

export const PHOTO_W = 256, PHOTO_H = 4096;

/** Used when no row of the chunk can be trusted. */
const FALLBACK_COLOUR = [0.27, 0.27, 0.28];
/** Typical real asphalt brightness the strip is toned to. */
const TARGET_LUM = 0.3;

type Strip = { cols: number; rows: number };
type Image = Strip & { rgb: Float32Array; trustedRow: Uint8Array };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const middleValue = (list: number[]) => list.sort((x, y) => x - y)[list.length >> 1];
const lumAt = (rgb: Float32Array, px: number) => (rgb[px * 3] + rgb[px * 3 + 1] + rgb[px * 3 + 2]) / 3;

/**
 * Box mean of one channel: across each row with radius rc, then along each column with radius
 * rr. The window shrinks at the edges. Running sums in double, each pass stored as float32.
 */
export function boxBlur(src: Float32Array, w: number, h: number, rc: number, rr: number): Float32Array {
  const pass1 = new Float32Array(src.length), pass2 = new Float32Array(src.length);
  for (let row = 0; row < h; row++) runningMean(src, pass1, row * w, 1, w, rc);
  for (let col = 0; col < w; col++) runningMean(pass1, pass2, col, w, h, rr);
  return pass2;
}

/** Mean over plus or minus `radius` along one line of `count` values from `first`, `step` apart. */
function runningMean(src: Float32Array, dst: Float32Array, first: number, step: number, count: number, radius: number) {
  const at = (j: number) => src[first + j * step];
  let total = 0, inWindow = 0;
  for (let j = 0; j < radius && j < count; j++, inWindow++) total += at(j);
  for (let j = 0; j < count; j++) {
    if (j + radius < count) (total += at(j + radius)), inWindow++;
    if (j - radius > 0) (total -= at(j - radius - 1)), inWindow--;
    dst[first + j * step] = total / inWindow;
  }
}

export function photoRoadTexture(
  plan: RoadPlan,
  raster: RasterSampler,
  a: number,
  b: number,
  trusted: (i: number) => boolean,
  W = PHOTO_W,
  H = PHOTO_H,
): { rgba: Uint8Array; width: number; height: number } {
  const count = plan.samples.length;
  if (!plan.closed && b >= count) throw new Error(`photoRoadTexture: chunk end ${b} past the end of an open road (${count} samples)`);
  const along = (i: number) => (i < count ? plan.samples[i].s : plan.length);
  const chunkLength = along(b) - along(a);
  const mAlong = Math.max(1, chunkLength) / H;
  const mAcross = Math.max(0.5, plan.samples[a % count].width) / W;
  const pixels = (metres: number, perPixel: number) => Math.max(1, Math.round(metres / perPixel));

  const image = resample(plan, raster, a, b, trusted, { cols: W, rows: H });
  const { ref, typical } = asphaltReference(image, Math.max(1, Math.round((6 / Math.max(1, chunkLength)) * H)));
  const mask = paintMask(image, ref, pixels(0.4, mAcross), pixels(0.4, mAlong));
  fill(image, mask, ref, (reach) => [pixels(reach, mAcross), pixels(reach, mAlong)]);
  const typicalLum = (typical[0] + typical[1] + typical[2]) / 3;
  return { rgba: finish(image, typicalLum, pixels(0.75, mAcross), pixels(0.75, mAlong), a * 977 + 13), width: W, height: H };
}

/** Stage 1: the photo along the chunk, 0.25 m inside each road edge. Untrusted rows stay empty. */
function resample(plan: RoadPlan, raster: RasterSampler, a: number, b: number, trusted: (i: number) => boolean, { cols, rows }: Strip): Image {
  const count = plan.samples.length;
  const along = (i: number) => (i < count ? plan.samples[i].s : plan.length);
  const start = along(a), end = along(b);
  const rgb = new Float32Array(cols * rows * 3), trustedRow = new Uint8Array(rows);
  let sec = a;
  for (let row = 0; row < rows; row++) {
    const dist = start + ((row + 0.5) / rows) * (end - start);
    while (sec < b && along(sec + 1) <= dist) sec++;
    if (!trusted(sec % count)) continue;
    const lo = plan.samples[sec % count], hi = plan.samples[(sec + 1) % count];
    const d0 = along(sec), d1 = along(sec + 1);
    const t = d1 === d0 ? 0 : clamp((dist - d0) / (d1 - d0), 0, 1);
    const mix = (u: number, v: number) => u + (v - u) * t;
    const centre = [mix(lo.pos[0], hi.pos[0]), mix(lo.pos[1], hi.pos[1])];
    const left = [mix(lo.left[0], hi.left[0]), mix(lo.left[1], hi.left[1])];
    const reach = mix(lo.width, hi.width) / 2 - 0.25;
    trustedRow[row] = 1;
    for (let col = 0; col < cols; col++) {
      const off = reach * (1 - (2 * (col + 0.5)) / cols);
      const colour = raster(centre[0] + left[0] * off, centre[1] + left[1] * off);
      if (colour === null) {
        trustedRow[row] = 0;
        break;
      }
      rgb.set(colour, (row * cols + col) * 3);
    }
  }
  return { cols, rows, rgb, trustedRow };
}

/** Stage 2: each row's asphalt colour, smoothed along the road; untrusted rows get the stretch's typical colour. */
function asphaltReference({ cols, rows, rgb, trustedRow }: Image, span: number) {
  const perRow = new Float32Array(rows * 3);
  for (let row = 0; row < rows; row++) {
    if (!trustedRow[row]) continue;
    // Every other column, darkest first; the middle half is asphalt (paint and cars are bright or coloured).
    const picks: { lum: number; px: number }[] = [];
    for (let col = 0; col < cols; col += 2) picks.push({ lum: lumAt(rgb, row * cols + col), px: row * cols + col });
    picks.sort((x, y) => x.lum - y.lum);
    const middle = picks.slice(Math.floor(picks.length * 0.25), Math.floor(picks.length * 0.75));
    for (let ch = 0; ch < 3; ch++) perRow[row * 3 + ch] = middleValue(middle.map((m) => rgb[m.px * 3 + ch]));
  }
  const typical = [...FALLBACK_COLOUR];
  const every4th = [0, 1, 2].map((ch) => {
    const list: number[] = [];
    for (let row = 0; row < rows; row += 4) if (trustedRow[row]) list.push(perRow[row * 3 + ch]);
    return list;
  });
  if (every4th[0].length > 0) every4th.forEach((list, ch) => (typical[ch] = middleValue(list)));
  for (let row = 0; row < rows; row++) if (!trustedRow[row]) perRow.set(typical, row * 3);
  // Plus or minus 6 m along the road.
  const ref = new Float32Array(rows * 3);
  for (let ch = 0; ch < 3; ch++) {
    const line = Float32Array.from({ length: rows }, (_, row) => perRow[row * 3 + ch]);
    const smooth = new Float32Array(rows);
    runningMean(line, smooth, 0, 1, rows, span);
    smooth.forEach((v, row) => (ref[row * 3 + ch] = v));
  }
  return { ref, typical };
}

/** Stage 3: what to paint out, grown by about 0.4 m so outlines go too. */
function paintMask({ cols, rows, rgb, trustedRow }: Image, ref: Float32Array, growCols: number, growRows: number): Uint8Array {
  const bad = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    const [R, G, B] = ref.subarray(row * 3, row * 3 + 3);
    const refLum = (R + G + B) / 3, refSum = refLum * 3 + 1e-4;
    for (let col = 0; col < cols; col++) {
      const px = row * cols + col;
      if (!trustedRow[row]) {
        bad[px] = 1;
        continue;
      }
      const [pr, pg, pb] = rgb.subarray(px * 3, px * 3 + 3);
      const sum = pr + pg + pb + 1e-4;
      const brighter = (pr + pg + pb) / 3 > refLum * 1.3 + 0.05;
      const offColour = Math.hypot(pr / sum - R / refSum, pg / sum - G / refSum, pb / sum - B / refSum) > 0.06;
      if (brighter || offColour) bad[px] = 1;
    }
  }
  return grow(grow(bad, cols, rows, 0, growRows), cols, rows, growCols, 0);
}

/** Square dilation by dc columns and dr rows. */
function grow(src: Uint8Array, cols: number, rows: number, dc: number, dr: number): Uint8Array {
  const dst = new Uint8Array(src.length);
  src.forEach((on, px) => {
    if (!on) return;
    const row = Math.floor(px / cols), col = px % cols;
    for (let rr = Math.max(0, row - dr); rr <= Math.min(rows - 1, row + dr); rr++) dst.fill(1, rr * cols + Math.max(0, col - dc), rr * cols + Math.min(cols - 1, col + dc) + 1);
  });
  return dst;
}

/** Stage 4: masked pixels from nearby good asphalt (normalised convolution, 1 m then 3 m), else the row's reference. */
function fill({ cols, rows, rgb }: Image, mask: Uint8Array, ref: Float32Array, radii: (reach: number) => number[]) {
  const size = cols * rows;
  const good = Float32Array.from(mask, (m) => (m ? 0 : 1));
  for (const reach of [1, 3]) {
    const [rc, rr] = radii(reach);
    const weight = boxBlur(good, cols, rows, rc, rr);
    const sums = [0, 1, 2].map((ch) => boxBlur(Float32Array.from({ length: size }, (_, px) => rgb[px * 3 + ch] * good[px]), cols, rows, rc, rr));
    for (let px = 0; px < size; px++) {
      if (good[px] || weight[px] < 0.08) continue;
      sums.forEach((s, ch) => (rgb[px * 3 + ch] = s[px] / weight[px]));
      good[px] = 1;
    }
  }
  good.forEach((g, px) => {
    if (!g) rgb.set(ref.subarray(Math.floor(px / cols) * 3, Math.floor(px / cols) * 3 + 3), px * 3);
  });
}

/** Stage 5: flatten broad brightness (about 15% kept), tone to asphalt, add grain; to RGBA bytes. */
function finish({ cols, rows, rgb }: Image, typicalLum: number, rc: number, rr: number, seed: number): Uint8Array {
  const size = cols * rows;
  const broad = boxBlur(Float32Array.from({ length: size }, (_, px) => lumAt(rgb, px)), cols, rows, rc, rr);
  const tone = TARGET_LUM / Math.max(0.05, typicalLum);
  const random = mulberry32(seed);
  const out = new Uint8Array(size * 4);
  const byte = (v: number) => clamp(v * 255, 0, 255); // the Uint8Array store truncates
  for (let px = 0; px < size; px++) {
    const gain = clamp(typicalLum / Math.max(0.02, broad[px]), 0.6, 2.4) ** 0.85 * tone;
    const grain = (random() - 0.5) * 0.07 + (random() - 0.5) * 0.03;
    out[px * 4] = byte(rgb[px * 3] * gain + grain);
    out[px * 4 + 1] = byte(rgb[px * 3 + 1] * gain + grain);
    out[px * 4 + 2] = byte(rgb[px * 3 + 2] * gain + grain * 1.02);
    out[px * 4 + 3] = 255;
  }
  return out;
}
