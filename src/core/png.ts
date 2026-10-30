// PNG encoder, and a decoder for 8-bit RGB/RGBA non-interlaced PNGs.
// Written from docs/specs/png.md and the W3C PNG specification. zlib comes from fflate.

import * as zlib from "fflate";

type Pixels = Uint8Array | Uint8ClampedArray;
type ZLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const COLOUR_RGB = 2;
const COLOUR_RGBA = 6;

/** CRC-32 lookup (reflected polynomial 0xEDB88320), built on first use. */
const crcLookup = (() => {
  let table: Uint32Array | null = null;
  return () => {
    if (table) return table;
    table = new Uint32Array(256);
    for (let byte = 0; byte < 256; byte++) {
      let reg = byte;
      for (let bit = 0; bit < 8; bit++) reg = (reg >>> 1) ^ (reg & 1 ? 0xedb88320 : 0);
      table[byte] = reg >>> 0;
    }
    return table;
  };
})();

/** CRC-32 of bytes[from, to). */
function crcOf(bytes: Uint8Array, from: number, to: number): number {
  const table = crcLookup();
  let reg = ~0;
  for (let at = from; at < to; at++) reg = table[(reg ^ bytes[at]) & 255] ^ (reg >>> 8);
  return ~reg >>> 0;
}

const writeBE = (dst: Uint8Array, at: number, value: number) => {
  for (let k = 0; k < 4; k++) dst[at + k] = (value >>> (24 - 8 * k)) & 255;
};
const readBE = (src: Uint8Array, at: number) => ((src[at] << 24) | (src[at + 1] << 16) | (src[at + 2] << 8) | src[at + 3]) >>> 0;

function checkSize(w: number, h: number, given: number): void {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw new Error(`PNG: invalid size ${w} x ${h}`);
  if (given < 4 * w * h) throw new Error(`PNG: pixel data too short (${given} bytes for ${w} x ${h})`);
}

/**
 * Encodes RGBA pixels (top row first, four bytes per pixel in) as a PNG file.
 * `alpha: false` writes RGB and drops the input alpha; `level` is the zlib level (default 6).
 * Every row uses the Up filter, which suits photo-like textures and is cheap.
 */
export function encodePng(rgba: Pixels, width: number, height: number, opts: { alpha?: boolean; level?: number } = {}): Uint8Array {
  checkSize(width, height, rgba.length);
  const keepAlpha = opts.alpha !== false;
  const bytesPerPixel = keepAlpha ? 4 : 3;
  const lineBytes = 1 + width * bytesPerPixel;
  const scan = new Uint8Array(lineBytes * height);
  const srcLine = width * 4;
  for (let row = 0, out = 0; row < height; row++) {
    scan[out++] = 2; // Up
    const here = row * srcLine;
    const above = here - srcLine;
    for (let px = 0; px < width; px++) {
      for (let ch = 0; ch < bytesPerPixel; ch++) {
        const s = here + 4 * px + ch;
        scan[out++] = rgba[s] - (row ? rgba[above + 4 * px + ch] : 0);
      }
    }
  }
  const header = new Uint8Array(13);
  writeBE(header, 0, width);
  writeBE(header, 4, height);
  header.set([8, keepAlpha ? COLOUR_RGBA : COLOUR_RGB, 0, 0, 0], 8);
  const parts: [string, Uint8Array][] = [
    ["IHDR", header],
    ["IDAT", zlib.zlibSync(scan, { level: (opts.level ?? 6) as ZLevel })],
    ["IEND", new Uint8Array(0)],
  ];
  const file = new Uint8Array(parts.reduce((sum, [, body]) => sum + body.length + 12, PNG_SIGNATURE.length));
  file.set(PNG_SIGNATURE);
  let at = PNG_SIGNATURE.length;
  for (const [tag, body] of parts) {
    writeBE(file, at, body.length);
    for (let k = 0; k < 4; k++) file[at + 4 + k] = tag.charCodeAt(k);
    file.set(body, at + 8);
    writeBE(file, at + 8 + body.length, crcOf(file, at + 4, at + 8 + body.length));
    at += body.length + 12;
  }
  return file;
}

/** The Paeth predictor from the PNG specification. */
function paeth(left: number, up: number, upLeft: number): number {
  const guess = left + up - upLeft;
  const dl = Math.abs(guess - left), du = Math.abs(guess - up), dul = Math.abs(guess - upLeft);
  if (dl <= du && dl <= dul) return left;
  return du <= dul ? up : upLeft;
}

/**
 * Decodes an 8-bit RGB or RGBA, non-interlaced PNG (any of the five row filters) to RGBA
 * (alpha 255 for RGB). Throws a clear error on anything else, on a bad CRC or on short data.
 */
export function decodeOwnPng(png: Uint8Array): { rgba: Uint8Array; width: number; height: number } {
  if (png.length < 8 || !PNG_SIGNATURE.every((b, k) => png[k] === b)) throw new Error("PNG: bad signature");
  let w = 0, h = 0, colour = -1;
  const compressed: Uint8Array[] = [];
  let at = 8;
  let sawEnd = false;
  while (!sawEnd && at + 12 <= png.length) {
    const len = readBE(png, at);
    const tag = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7]);
    const body = at + 8;
    if (body + len + 4 > png.length) throw new Error(`PNG: chunk ${tag} runs past the end of the file`);
    if (crcOf(png, at + 4, body + len) !== readBE(png, body + len)) throw new Error(`PNG: CRC mismatch in ${tag} chunk`);
    if (tag === "IHDR") {
      if (len !== 13) throw new Error("PNG: bad IHDR length");
      w = readBE(png, body);
      h = readBE(png, body + 4);
      const [depth, type, method, filterMethod, interlace] = png.subarray(body + 8, body + 13);
      colour = type;
      if (depth !== 8) throw new Error(`PNG: unsupported bit depth ${depth} (only 8)`);
      if (type !== COLOUR_RGB && type !== COLOUR_RGBA) throw new Error(`PNG: unsupported colour type ${type} (only RGB 2 and RGBA 6)`);
      if (method !== 0 || filterMethod !== 0) throw new Error("PNG: unsupported compression or filter method");
      if (interlace !== 0) throw new Error("PNG: interlaced images are not supported");
      if (!w || !h) throw new Error("PNG: zero size");
    } else if (tag === "IDAT") compressed.push(png.subarray(body, body + len));
    else if (tag === "IEND") sawEnd = true;
    at = body + len + 4;
  }
  if (colour < 0) throw new Error("PNG: no IHDR chunk");
  if (!sawEnd) throw new Error("PNG: truncated (no IEND chunk)");

  const joined = new Uint8Array(compressed.reduce((sum, c) => sum + c.length, 0));
  compressed.reduce((off, c) => (joined.set(c, off), off + c.length), 0);
  let scan: Uint8Array;
  try {
    scan = zlib.unzlibSync(joined);
  } catch (err) {
    throw new Error(`PNG: image data does not inflate (${(err as Error).message})`);
  }

  const bpp = colour === COLOUR_RGBA ? 4 : 3;
  const lineBytes = w * bpp;
  if (scan.length < (lineBytes + 1) * h) throw new Error(`PNG: image data too short (${scan.length} bytes, need ${(lineBytes + 1) * h})`);
  let line = new Uint8Array(lineBytes);
  let prior = new Uint8Array(lineBytes);
  const pixels = new Uint8Array(4 * w * h);
  for (let row = 0; row < h; row++) {
    const start = row * (lineBytes + 1);
    const kind = scan[start];
    if (kind > 4) throw new Error(`PNG: bad filter type ${kind} on row ${row}`);
    for (let k = 0; k < lineBytes; k++) {
      const left = k < bpp ? 0 : line[k - bpp];
      const up = prior[k];
      const upLeft = k < bpp ? 0 : prior[k - bpp];
      const pred = kind === 0 ? 0 : kind === 1 ? left : kind === 2 ? up : kind === 3 ? (left + up) >> 1 : paeth(left, up, upLeft);
      line[k] = scan[start + 1 + k] + pred;
    }
    const dst = row * w * 4;
    if (bpp === 4) pixels.set(line, dst);
    else {
      for (let px = 0, o = dst; px < w; px++, o += 4) {
        pixels[o] = line[3 * px];
        pixels[o + 1] = line[3 * px + 1];
        pixels[o + 2] = line[3 * px + 2];
        pixels[o + 3] = 255;
      }
    }
    [line, prior] = [prior, line];
  }
  return { rgba: pixels, width: w, height: h };
}
