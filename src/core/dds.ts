// DDS textures: DXT1 (BC1) and DXT5 (BC3) encoding with a full mip chain, and decoding of level 0.
// Written from docs/specs/dds.md, Microsoft's DDS and block compression documentation and the
// EXT_texture_compression_s3tc rules. Endpoints use the inset bounding box method (van Waveren 2006).

type Pixels = Uint8Array | Uint8ClampedArray;

const HEADER_BYTES = 128;
const DDSD_FLAGS = 0x1 | 0x2 | 0x4 | 0x1000 | 0x20000 | 0x80000;
const DDPF_FOURCC = 0x4;
const CAPS = 0x8 | 0x1000 | 0x400000;

interface Level {
  w: number;
  h: number;
  px: Pixels;
}

function checkInput(rgba: Pixels, width: number, height: number): void {
  if (!(width > 0 && height > 0) || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`DDS: invalid size ${width} x ${height}`);
  }
  if (rgba.length < width * height * 4) {
    throw new Error(`DDS: pixel data too short (${rgba.length} bytes for ${width} x ${height})`);
  }
}

/** Sizes of every mip level, from the full size down to 1 x 1. */
function mipSizes(width: number, height: number): [number, number][] {
  const out: [number, number][] = [[width, height]];
  let w = width;
  let h = height;
  while (w > 1 || h > 1) {
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    out.push([w, h]);
  }
  return out;
}

function levelBytes(w: number, h: number, blockBytes: number): number {
  return Math.ceil(w / 4) * Math.ceil(h / 4) * blockBytes;
}

/** Next mip level by a 2 x 2 box filter, clamping at the edges. */
function halve(src: Level): Level {
  const w = Math.max(1, src.w >> 1);
  const h = Math.max(1, src.h >> 1);
  const half = new Uint8Array(4 * w * h);
  const sw = src.w;
  const s = src.px;
  for (let row = 0, o = 0; row < h; row++) {
    const top = Math.min(2 * row, src.h - 1) * sw;
    const bottom = Math.min(2 * row + 1, src.h - 1) * sw;
    for (let col = 0; col < w; col++, o += 4) {
      const left = Math.min(2 * col, sw - 1);
      const right = Math.min(2 * col + 1, sw - 1);
      const tl = 4 * (top + left), tr = 4 * (top + right), bl = 4 * (bottom + left), br = 4 * (bottom + right);
      for (let ch = 0; ch < 4; ch++) half[o + ch] = (s[tl + ch] + s[tr + ch] + s[bl + ch] + s[br + ch] + 2) >> 2;
    }
  }
  return { w, h, px: half };
}

/** Packs 8-bit RGB into 5:6:5 (red in the top bits), rounding each channel to the nearest step. */
const pack565 = (red: number, green: number, blue: number): number =>
  (Math.round((red * 31) / 255) << 11) | (Math.round((green * 63) / 255) << 5) | Math.round((blue * 31) / 255);

function expand565(c: number, out: Int32Array, at: number): void {
  const r = (c >> 11) & 31;
  const g = (c >> 5) & 63;
  const b = c & 31;
  out[at] = (r << 3) | (r >> 2);
  out[at + 1] = (g << 2) | (g >> 4);
  out[at + 2] = (b << 3) | (b >> 2);
}

/** Four-colour palette (RGB) for two endpoints, into `pal` (12 numbers). */
function palette4(c0: number, c1: number, pal: Int32Array): void {
  expand565(c0, pal, 0);
  expand565(c1, pal, 3);
  for (let ch = 0; ch < 3; ch++) {
    pal[6 + ch] = Math.round((2 * pal[ch] + pal[3 + ch]) / 3);
    pal[9 + ch] = Math.round((pal[ch] + 2 * pal[3 + ch]) / 3);
  }
}

// Scratch space for one 4 x 4 block (edge pixels repeated).
const block = new Uint8Array(64);
const pal = new Int32Array(12);

function gatherBlock(lv: Level, bx: number, by: number): void {
  for (let p = 0; p < 16; p++) {
    const y = Math.min(4 * by + (p >> 2), lv.h - 1);
    const x = Math.min(4 * bx + (p & 3), lv.w - 1);
    const from = 4 * (y * lv.w + x);
    block[4 * p] = lv.px[from];
    block[4 * p + 1] = lv.px[from + 1];
    block[4 * p + 2] = lv.px[from + 2];
    block[4 * p + 3] = lv.px[from + 3];
  }
}

const blockIdx = new Uint8Array(16);
const trialIdx = new Uint8Array(16);

/** Picks each pixel's nearest palette entry for endpoints c0 > c1; returns the squared error. */
function assign(c0: number, c1: number, idx: Uint8Array): number {
  palette4(c0, c1, pal);
  let err = 0;
  for (let p = 0; p < 16; p++) {
    const r = block[p * 4], g = block[p * 4 + 1], b = block[p * 4 + 2];
    let pick = 0;
    let near = Infinity;
    for (let entry = 0; entry < 4; entry++) {
      const er = r - pal[entry * 3], eg = g - pal[entry * 3 + 1], eb = b - pal[entry * 3 + 2];
      const e = er * er + eg * eg + eb * eb;
      if (e < near) {
        near = e;
        pick = entry;
      }
    }
    idx[p] = pick;
    err += near;
  }
  return err;
}

/** Orders two 5:6:5 endpoints so the first is larger (four-colour mode). */
function ordered(a: number, b: number): [number, number] {
  return a >= b ? [a, b] : [b, a];
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Writes the BC1 colour block for the gathered pixels at `at` (8 bytes, always four-colour mode).
 * Endpoints: the inset bounding box, with the box diagonal chosen to follow the colours' spread,
 * then one least-squares refit of the endpoints to the chosen indices, kept if it lowers the error.
 */
function writeColourBlock(out: Uint8Array, at: number): void {
  let loR = 255, loG = 255, loB = 255, hiR = 0, hiG = 0, hiB = 0;
  let sumR = 0, sumG = 0, sumB = 0;
  for (let p = 0; p < 64; p += 4) {
    const r = block[p], g = block[p + 1], b = block[p + 2];
    sumR += r; sumG += g; sumB += b;
    if (r < loR) loR = r;
    if (r > hiR) hiR = r;
    if (g < loG) loG = g;
    if (g > hiG) hiG = g;
    if (b < loB) loB = b;
    if (b > hiB) hiB = b;
  }
  // Which diagonal of the box: flip green and blue ends when they run against red (or green).
  const mR = sumR / 16, mG = sumG / 16, mB = sumB / 16;
  let covRG = 0, covRB = 0, covGB = 0;
  for (let p = 0; p < 64; p += 4) {
    const dr = block[p] - mR, dg = block[p + 1] - mG, db = block[p + 2] - mB;
    covRG += dr * dg; covRB += dr * db; covGB += dg * db;
  }
  const insetR = (hiR - loR) / 16, insetG = (hiG - loG) / 16, insetB = (hiB - loB) / 16;
  let aR = hiR - insetR, bR = loR + insetR;
  let aG = hiG - insetG, bG = loG + insetG;
  let aB = hiB - insetB, bB = loB + insetB;
  const redSpread = hiR - loR >= Math.max(hiG - loG, hiB - loB) / 2;
  if (redSpread ? covRG < 0 : false) [aG, bG] = [bG, aG];
  if (redSpread ? covRB < 0 : covGB < 0) [aB, bB] = [bB, aB];
  let [c0, c1] = ordered(pack565(aR, aG, aB), pack565(bR, bG, bB));
  if (c0 === c1) {
    writeBlockBytes(out, at, c0, c1, null);
    return;
  }
  let err = assign(c0, c1, blockIdx);

  // Least-squares refit: pixel = w * end0 + (1 - w) * end1, w from each pixel's index.
  let ww = 0, wv = 0, vv = 0;
  let x0r = 0, x0g = 0, x0b = 0, x1r = 0, x1g = 0, x1b = 0;
  for (let p = 0; p < 16; p++) {
    const w = WEIGHT[blockIdx[p]];
    const v = 1 - w;
    ww += w * w; wv += w * v; vv += v * v;
    const r = block[p * 4], g = block[p * 4 + 1], b = block[p * 4 + 2];
    x0r += w * r; x0g += w * g; x0b += w * b;
    x1r += v * r; x1g += v * g; x1b += v * b;
  }
  const det = ww * vv - wv * wv;
  if (Math.abs(det) > 1e-9) {
    const e0 = pack565(
      clamp255((vv * x0r - wv * x1r) / det), clamp255((vv * x0g - wv * x1g) / det), clamp255((vv * x0b - wv * x1b) / det));
    const e1 = pack565(
      clamp255((ww * x1r - wv * x0r) / det), clamp255((ww * x1g - wv * x0g) / det), clamp255((ww * x1b - wv * x0b) / det));
    const [r0, r1] = ordered(e0, e1);
    if (r0 !== r1) {
      const err2 = assign(r0, r1, trialIdx);
      if (err2 < err) {
        err = err2;
        c0 = r0;
        c1 = r1;
        blockIdx.set(trialIdx);
      }
    }
  }
  writeBlockBytes(out, at, c0, c1, blockIdx);
}

/** Weight of endpoint 0 for each four-colour palette index. */
const WEIGHT = [1, 0, 2 / 3, 1 / 3];

function writeBlockBytes(out: Uint8Array, at: number, c0: number, c1: number, idx: Uint8Array | null): void {
  let packed = 0;
  if (idx) for (let p = 0; p < 16; p++) packed |= idx[p] << (2 * p);
  out[at] = c0 & 0xff;
  out[at + 1] = c0 >> 8;
  out[at + 2] = c1 & 0xff;
  out[at + 3] = c1 >> 8;
  for (let k = 0; k < 4; k++) out[at + 4 + k] = (packed >>> (8 * k)) & 0xff;
}

const alphaPal = new Int32Array(8);

function alphaPalette(a0: number, a1: number, out: Int32Array): void {
  out[0] = a0;
  out[1] = a1;
  if (a0 > a1) {
    for (let k = 1; k <= 6; k++) out[k + 1] = Math.round(((7 - k) * a0 + k * a1) / 7);
  } else {
    for (let k = 1; k <= 4; k++) out[k + 1] = Math.round(((5 - k) * a0 + k * a1) / 5);
    out[6] = 0;
    out[7] = 255;
  }
}

/** Writes the BC3 alpha block for the gathered pixels at `at` (8 bytes). */
function writeAlphaBlock(out: Uint8Array, at: number): void {
  let aMin = 255, aMax = 0;
  for (let p = 3; p < 64; p += 4) {
    aMin = Math.min(aMin, block[p]);
    aMax = Math.max(aMax, block[p]);
  }
  out[at] = aMax;
  out[at + 1] = aMin;
  let low = 0; // pixels 0 to 7, three bits each
  let high = 0; // pixels 8 to 15
  if (aMax > aMin) {
    alphaPalette(aMax, aMin, alphaPal);
    for (let p = 0; p < 16; p++) {
      const a = block[p * 4 + 3];
      let pick = 0;
      for (let entry = 1; entry < 8; entry++) {
        if (Math.abs(a - alphaPal[entry]) < Math.abs(a - alphaPal[pick])) pick = entry;
      }
      if (p < 8) low |= pick << (3 * p);
      else high |= pick << (3 * (p - 8));
    }
  }
  for (let i = 0; i < 3; i++) {
    out[at + 2 + i] = (low >> (8 * i)) & 0xff;
    out[at + 5 + i] = (high >> (8 * i)) & 0xff;
  }
}

function encode(rgba: Pixels, width: number, height: number, dxt5: boolean, given?: Level[]): Uint8Array {
  checkInput(rgba, width, height);
  const blockBytes = dxt5 ? 16 : 8;
  const sizes: [number, number][] = given ? given.map((l) => [l.w, l.h]) : mipSizes(width, height);
  let total = HEADER_BYTES;
  for (const [w, h] of sizes) total += levelBytes(w, h, blockBytes);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  out.set([0x44, 0x44, 0x53, 0x20], 0); // "DDS "
  v.setUint32(4, 124, true);
  v.setUint32(8, DDSD_FLAGS, true);
  v.setUint32(12, height, true);
  v.setUint32(16, width, true);
  v.setUint32(20, levelBytes(width, height, blockBytes), true);
  v.setUint32(24, 0, true);
  v.setUint32(28, sizes.length, true);
  v.setUint32(76, 32, true);
  v.setUint32(80, DDPF_FOURCC, true);
  const cc = dxt5 ? "DXT5" : "DXT1";
  for (let i = 0; i < 4; i++) out[84 + i] = cc.charCodeAt(i);
  v.setUint32(108, CAPS, true);

  let at = HEADER_BYTES;
  let lv: Level = { w: width, h: height, px: rgba };
  for (let m = 0; m < sizes.length; m++) {
    if (given) lv = given[m];
    else if (m > 0) lv = halve(lv);
    const bw = Math.ceil(lv.w / 4);
    const bh = Math.ceil(lv.h / 4);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        gatherBlock(lv, bx, by);
        if (dxt5) {
          writeAlphaBlock(out, at);
          writeColourBlock(out, at + 8);
        } else writeColourBlock(out, at);
        at += blockBytes;
      }
    }
  }
  return out;
}

/** DXT1 (no alpha) .dds file with every mip level down to 1 x 1. */
export function encodeDdsDxt1(rgba: Pixels, width: number, height: number): Uint8Array {
  return encode(rgba, width, height, false);
}

/** DXT5 (smooth alpha) .dds file with every mip level down to 1 x 1. */
export function encodeDdsDxt5(rgba: Pixels, width: number, height: number): Uint8Array {
  return encode(rgba, width, height, true);
}

/**
 * DXT5 .dds file with the caller's own mip levels (the first at full size, each next one half the
 * last, rounded down, at least 1): for atlases that mustn't be box-filtered across their cells.
 */
export function encodeDdsDxt5Levels(levels: Level[]): Uint8Array {
  if (!levels.length) throw new Error("DDS: no levels");
  levels.forEach((l, m) => {
    checkInput(l.px, l.w, l.h);
    if (m > 0 && (l.w !== Math.max(1, levels[m - 1].w >> 1) || l.h !== Math.max(1, levels[m - 1].h >> 1))) {
      throw new Error(`DDS: level ${m} is ${l.w} x ${l.h}, not half of level ${m - 1}`);
    }
  });
  return encode(levels[0].px, levels[0].w, levels[0].h, true, levels);
}

/** Decodes mip level 0 of a DXT1 or DXT5 .dds file to RGBA, top row first. */
export function decodeDds(data: Uint8Array): { rgba: Uint8Array; width: number; height: number } {
  if (data.length < 4 || data[0] !== 0x44 || data[1] !== 0x44 || data[2] !== 0x53 || data[3] !== 0x20) {
    throw new Error("not a DDS file");
  }
  if (data.length < HEADER_BYTES) throw new Error("DDS: truncated header");
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const height = v.getUint32(12, true);
  const width = v.getUint32(16, true);
  const cc = String.fromCharCode(data[84], data[85], data[86], data[87]);
  if (cc !== "DXT1" && cc !== "DXT5") throw new Error(`DDS format not supported: ${JSON.stringify(cc)}`);
  if (width === 0 || height === 0) throw new Error("DDS: zero size");
  const dxt5 = cc === "DXT5";
  const blockBytes = dxt5 ? 16 : 8;
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  if (data.length < HEADER_BYTES + bw * bh * blockBytes) throw new Error("DDS: truncated pixel data");

  const out = new Uint8Array(4 * width * height);
  const colours = new Int32Array(16); // 4 x RGBA
  const alphas = new Int32Array(8);
  let at = HEADER_BYTES;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let alphaLow = 0;
      let alphaHigh = 0;
      if (dxt5) {
        alphaPalette(data[at], data[at + 1], alphas);
        alphaLow = data[at + 2] | (data[at + 3] << 8) | (data[at + 4] << 16);
        alphaHigh = data[at + 5] | (data[at + 6] << 8) | (data[at + 7] << 16);
      }
      const c = at + (dxt5 ? 8 : 0);
      const c0 = data[c] | (data[c + 1] << 8);
      const c1 = data[c + 2] | (data[c + 3] << 8);
      const idx = v.getUint32(c + 4, true);
      expand565(c0, colours, 0);
      expand565(c1, colours, 4);
      colours[3] = colours[7] = colours[11] = colours[15] = 255;
      const fourColour = dxt5 || c0 > c1;
      for (let ch = 0; ch < 3; ch++) {
        const e0 = colours[ch], e1 = colours[4 + ch];
        colours[8 + ch] = fourColour ? Math.round((2 * e0 + e1) / 3) : Math.round((e0 + e1) / 2);
        colours[12 + ch] = fourColour ? Math.round((e0 + 2 * e1) / 3) : 0;
      }
      if (!fourColour) colours[15] = 0; // punch-through: index 3 is transparent black
      for (let p = 0; p < 16; p++) {
        const x = bx * 4 + (p & 3);
        const y = by * 4 + (p >> 2);
        if (x >= width || y >= height) continue;
        const entry = 4 * ((idx >>> (2 * p)) & 3);
        const o = 4 * (y * width + x);
        out[o] = colours[entry];
        out[o + 1] = colours[entry + 1];
        out[o + 2] = colours[entry + 2];
        out[o + 3] = dxt5 ? alphas[(p < 8 ? alphaLow >> (3 * p) : alphaHigh >> (3 * (p - 8))) & 7] : colours[entry + 3];
      }
      at += blockBytes;
    }
  }
  return { rgba: out, width, height };
}
