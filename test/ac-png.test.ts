import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeOwnPng, encodePng } from "../src/core/png";
import { readKn5 } from "../src/core/kn5";
import { buildFiles, HAVE_BUILD } from "./ac-buildfiles";

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
function randomImage(w: number, h: number, seed = 1): Uint8Array {
  const r = seeded(seed);
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < px.length; i++) px[i] = Math.floor(r() * 256);
  return px;
}

// Independent CRC-32, bit by bit.
function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface Chunk { type: string; data: Uint8Array; crc: number; crcOk: boolean }
function chunks(png: Uint8Array): Chunk[] {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: Chunk[] = [];
  let at = 8;
  while (at < png.length) {
    const len = v.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + len);
    const stored = v.getUint32(at + 8 + len);
    out.push({ type, data, crc: stored, crcOk: crc(png.subarray(at + 4, at + 8 + len)) === stored });
    at += 12 + len;
  }
  return out;
}

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function chunk(type: string, data: Uint8Array | number[]): number[] {
  const body = new Uint8Array([...Array.from(type, (c) => c.charCodeAt(0)), ...data]);
  return [...be32(body.length - 4), ...body, ...be32(crc(body))];
}
/** A PNG built by hand: IHDR fields as given, `raw` (already filtered) deflated by Node's zlib, split into `parts` IDATs. */
function handPng(w: number, h: number, depth: number, colour: number, raw: Uint8Array, interlace = 0, parts = 1): Uint8Array {
  const z = deflateSync(raw);
  const out = [137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", [...be32(w), ...be32(h), depth, colour, 0, 0, interlace])];
  const step = Math.ceil(z.length / parts);
  for (let i = 0; i < z.length; i += step) out.push(...chunk("IDAT", z.subarray(i, i + step)));
  out.push(...chunk("IEND", []));
  return new Uint8Array(out);
}

/** Filters RGBA rows with one filter type, as a PNG encoder would (independent of the module). */
function filterRows(px: Uint8Array, w: number, h: number, filter: number): Uint8Array {
  const bpp = 4, rb = w * 4;
  const out = new Uint8Array(h * (rb + 1));
  for (let y = 0; y < h; y++) {
    out[y * (rb + 1)] = filter;
    for (let i = 0; i < rb; i++) {
      const x = px[y * rb + i];
      const a = i >= bpp ? px[y * rb + i - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * rb + i] : 0;
      const c = i >= bpp && y > 0 ? px[(y - 1) * rb + i - bpp] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * (rb + 1) + 1 + i] = (x - pred) & 255;
    }
  }
  return out;
}

describe("PNG format", () => {
  const px = randomImage(37, 23);

  it("starts with the signature and a correct IHDR (RGBA and RGB)", () => {
    for (const alpha of [true, false]) {
      const png = encodePng(px, 37, 23, { alpha });
      expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const ihdr = chunks(png)[0];
      expect(ihdr.type).toBe("IHDR");
      expect(ihdr.data.length).toBe(13);
      const v = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, 13);
      expect(v.getUint32(0)).toBe(37);
      expect(v.getUint32(4)).toBe(23);
      expect(Array.from(ihdr.data.subarray(8))).toEqual([8, alpha ? 6 : 2, 0, 0, 0]);
    }
  });

  it("has valid CRCs and the order IHDR, IDAT..., IEND", () => {
    const cs = chunks(encodePng(px, 37, 23));
    expect(cs.every((c) => c.crcOk)).toBe(true);
    expect(cs[0].type).toBe("IHDR");
    expect(cs.at(-1)!.type).toBe("IEND");
    expect(cs.at(-1)!.data.length).toBe(0);
    expect(cs.slice(1, -1).every((c) => c.type === "IDAT")).toBe(true);
    expect(cs.length).toBeGreaterThanOrEqual(3);
  });

  it("IDAT inflates (Node's zlib) to height x (1 + row bytes), filter bytes 0 to 4", () => {
    for (const alpha of [true, false]) {
      const cs = chunks(encodePng(px, 37, 23, { alpha }));
      const raw = inflateSync(Buffer.concat(cs.filter((c) => c.type === "IDAT").map((c) => c.data)));
      const stride = 1 + 37 * (alpha ? 4 : 3);
      expect(raw.length).toBe(23 * stride);
      for (let y = 0; y < 23; y++) expect(raw[y * stride]).toBeLessThanOrEqual(4);
    }
  });
});

describe("PNG round trip", () => {
  it("random 37 x 23 RGBA comes back exactly", () => {
    const px = randomImage(37, 23, 7);
    const d = decodeOwnPng(encodePng(px, 37, 23));
    expect(d.width).toBe(37);
    expect(d.height).toBe(23);
    expect(Buffer.from(d.rgba).equals(Buffer.from(px))).toBe(true);
  });

  it("alpha: false gives the RGB back with alpha 255", () => {
    const px = randomImage(19, 11, 3);
    const d = decodeOwnPng(encodePng(px, 19, 11, { alpha: false }));
    for (let i = 0; i < 19 * 11; i++) {
      expect([d.rgba[i * 4], d.rgba[i * 4 + 1], d.rgba[i * 4 + 2], d.rgba[i * 4 + 3]]).toEqual([px[i * 4], px[i * 4 + 1], px[i * 4 + 2], 255]);
    }
  });

  it("1 x 1 and 4 x 4 flat images round-trip", () => {
    for (const n of [1, 4]) {
      const px = new Uint8Array(n * n * 4);
      for (let i = 0; i < px.length; i += 4) px.set([12, 200, 99, 180], i);
      expect(Array.from(decodeOwnPng(encodePng(px, n, n)).rgba)).toEqual(Array.from(px));
    }
  });

  it("Uint8ClampedArray gives the same bytes as Uint8Array, and output is deterministic", () => {
    const px = randomImage(16, 9, 5);
    const a = encodePng(px, 16, 9);
    expect(Array.from(encodePng(new Uint8ClampedArray(px), 16, 9))).toEqual(Array.from(a));
    expect(Array.from(encodePng(px, 16, 9))).toEqual(Array.from(a));
    expect(Array.from(encodePng(new Uint8ClampedArray(px), 16, 9, { alpha: false }))).toEqual(Array.from(encodePng(px, 16, 9, { alpha: false })));
  });

  it("rejects zero sizes and short pixel data", () => {
    expect(() => encodePng(new Uint8Array(0), 0, 4)).toThrow();
    expect(() => encodePng(new Uint8Array(0), 4, 0)).toThrow();
    expect(() => encodePng(new Uint8Array(15), 2, 2)).toThrow();
  });
});

describe("PNG decoder on other PNGs", () => {
  const px = randomImage(9, 7, 11);

  it("decodes each of the five filters", () => {
    for (let f = 0; f <= 4; f++) {
      const d = decodeOwnPng(handPng(9, 7, 8, 6, filterRows(px, 9, 7, f)));
      expect(Buffer.from(d.rgba).equals(Buffer.from(px))).toBe(true);
    }
  });

  it("decodes IDAT split over several chunks", () => {
    const d = decodeOwnPng(handPng(9, 7, 8, 6, filterRows(px, 9, 7, 4), 0, 5));
    expect(Buffer.from(d.rgba).equals(Buffer.from(px))).toBe(true);
  });

  it("throws a clear error on palette, greyscale, 16-bit and interlaced images", () => {
    const raw = new Uint8Array(7 * 10);
    expect(() => decodeOwnPng(handPng(9, 7, 8, 3, raw))).toThrow(/colour type 3/);
    expect(() => decodeOwnPng(handPng(9, 7, 8, 0, raw))).toThrow(/colour type 0/);
    expect(() => decodeOwnPng(handPng(9, 7, 8, 4, raw))).toThrow(/colour type 4/);
    expect(() => decodeOwnPng(handPng(9, 7, 16, 6, raw))).toThrow(/bit depth 16/);
    expect(() => decodeOwnPng(handPng(9, 7, 8, 6, filterRows(px, 9, 7, 0), 1))).toThrow(/interlaced/);
  });

  it("throws on a bad signature and on truncated image data", () => {
    const good = encodePng(px, 9, 7);
    const bad = good.slice();
    bad[1] = 0;
    expect(() => decodeOwnPng(bad)).toThrow(/signature/);
    expect(() => decodeOwnPng(good.subarray(0, good.length - 20))).toThrow();
    expect(() => decodeOwnPng(handPng(9, 7, 8, 6, filterRows(px, 9, 7, 0).subarray(0, 40)))).toThrow(/too short/);
  });
});

describe("PNG interop", () => {
  it("opens in an independent decoder (@napi-rs/canvas)", async () => {
    let canvas: typeof import("@napi-rs/canvas") | undefined;
    try {
      canvas = createRequire(import.meta.url)("@napi-rs/canvas");
    } catch {
      return; // not installed here
    }
    const src = randomImage(21, 13, 9);
    for (let i = 3; i < src.length; i += 4) src[i] = 255; // canvas premultiplies, so keep it opaque
    const img = await canvas!.loadImage(Buffer.from(encodePng(src, 21, 13)));
    const c = canvas!.createCanvas(21, 13);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    expect(Buffer.from(ctx.getImageData(0, 0, 21, 13).data).equals(Buffer.from(src))).toBe(true);
  });

  it("decodes the old encoder's golden file, and re-encodes it byte for byte", () => {
    const png = new Uint8Array(readFileSync("test/fixtures/ac/small.png"));
    const d = decodeOwnPng(png);
    const ihdr = chunks(png)[0].data;
    expect(d.width).toBe(new DataView(ihdr.buffer, ihdr.byteOffset).getUint32(0));
    expect(Array.from(encodePng(d.rgba, d.width, d.height, { alpha: ihdr[9] === 6 }))).toEqual(Array.from(png));
  });

  it.skipIf(!HAVE_BUILD)("decodes every PNG in a real build and in its kn5 files", () => {
    const check = (name: string, png: Uint8Array) => {
      const ihdr = chunks(png)[0].data;
      const v = new DataView(ihdr.buffer, ihdr.byteOffset, 13);
      const d = decodeOwnPng(png);
      expect([d.width, d.height], name).toEqual([v.getUint32(0), v.getUint32(4)]);
    };
    for (const [name, data] of Object.entries(buildFiles((n) => n.endsWith(".png")))) check(name, data);
    for (const [name, data] of Object.entries(buildFiles((n) => n.endsWith(".kn5")))) {
      for (const t of readKn5(data).textures) if (t.data[0] === 137 && t.data[1] === 80) check(`${name}:${t.name}`, t.data);
    }
  }, 300_000);
});
