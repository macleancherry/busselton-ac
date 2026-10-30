import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeDds, encodeDdsDxt1, encodeDdsDxt5 } from "../src/core/dds";
import { readKn5 } from "../src/core/kn5";
import { buildFiles, HAVE_BUILD } from "./ac-buildfiles";

const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, true);
const fourcc = (b: Uint8Array) => String.fromCharCode(b[84], b[85], b[86], b[87]);

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** Smooth seeded noise plus a few sharp edges: aerial-like. */
function aerialLike(w: number, h: number, seed = 1): Uint8Array {
  const r = seeded(seed);
  const waves = Array.from({ length: 6 }, () => ({ fx: r() * 0.2, fy: r() * 0.2, ph: r() * 6, amp: 20 + r() * 30, ch: Math.floor(r() * 3) }));
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const base = [110, 120, 90];
      for (const wv of waves) base[wv.ch] += wv.amp * Math.sin(x * wv.fx + y * wv.fy + wv.ph);
      if (x > w * 0.6 && y < h * 0.4) { base[0] += 70; base[1] += 70; base[2] += 70; } // a roof
      if (Math.abs(x - y) < 3) { base[0] = 40; base[1] = 40; base[2] = 45; } // a road
      for (let c = 0; c < 3; c++) px[o + c] = Math.max(0, Math.min(255, Math.round(base[c] + (r() - 0.5) * 16)));
      px[o + 3] = 255;
    }
  }
  return px;
}

function errors(a: Uint8Array, b: Uint8Array, channels = 3): { mean: number; max: number } {
  let sum = 0, max = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < channels; c++) {
      const d = Math.abs(a[i + c] - b[i + c]);
      sum += d;
      n++;
      if (d > max) max = d;
    }
  }
  return { mean: sum / n, max };
}

function mipCount(w: number, h: number): number {
  let n = 1;
  while (w > 1 || h > 1) { w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); n++; }
  return n;
}
function expectedLength(w: number, h: number, block: number): number {
  let total = 128;
  for (;;) {
    total += Math.ceil(w / 4) * Math.ceil(h / 4) * block;
    if (w === 1 && h === 1) return total;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
}

/** Every mip level of our file, decoded by splicing a header in front of each level's data. */
function levels(dds: Uint8Array): { w: number; h: number; rgba: Uint8Array }[] {
  const block = fourcc(dds) === "DXT5" ? 16 : 8;
  let w = u32(dds, 16), h = u32(dds, 12), at = 128;
  const out = [];
  for (let m = 0; m < u32(dds, 28); m++) {
    const size = Math.ceil(w / 4) * Math.ceil(h / 4) * block;
    const one = new Uint8Array(128 + size);
    one.set(dds.subarray(0, 128));
    const v = new DataView(one.buffer);
    v.setUint32(12, h, true);
    v.setUint32(16, w, true);
    one.set(dds.subarray(at, at + size), 128);
    out.push({ w, h, rgba: decodeDds(one).rgba });
    at += size;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return out;
}

/** A DDS file around hand-built block data. */
function handDds(w: number, h: number, cc: string, blocks: number[]): Uint8Array {
  const out = new Uint8Array(128 + blocks.length);
  const v = new DataView(out.buffer);
  out.set([0x44, 0x44, 0x53, 0x20]);
  v.setUint32(4, 124, true);
  v.setUint32(12, h, true);
  v.setUint32(16, w, true);
  for (let i = 0; i < 4; i++) out[84 + i] = cc.charCodeAt(i);
  out.set(blocks, 128);
  return out;
}

const expand5 = (v: number) => (v << 3) | (v >> 2);
const expand6 = (v: number) => (v << 2) | (v >> 4);

describe("DDS header", () => {
  it("writes the magic, header fields and caps", () => {
    for (const [enc, cc] of [[encodeDdsDxt1, "DXT1"], [encodeDdsDxt5, "DXT5"]] as const) {
      const d = enc(aerialLike(64, 32), 64, 32);
      expect(String.fromCharCode(...d.subarray(0, 4))).toBe("DDS ");
      expect(u32(d, 4)).toBe(124);
      expect(u32(d, 8)).toBe(0x1 | 0x2 | 0x4 | 0x1000 | 0x20000 | 0x80000);
      expect(u32(d, 12)).toBe(32); // height first
      expect(u32(d, 16)).toBe(64);
      expect(u32(d, 24)).toBe(0);
      for (let o = 32; o < 76; o += 4) expect(u32(d, o)).toBe(0);
      expect(u32(d, 76)).toBe(32);
      expect(u32(d, 80)).toBe(0x4);
      expect(fourcc(d)).toBe(cc);
      for (let o = 88; o < 108; o += 4) expect(u32(d, o)).toBe(0);
      expect(u32(d, 108)).toBe(0x8 | 0x1000 | 0x400000);
      for (let o = 112; o < 128; o += 4) expect(u32(d, o)).toBe(0);
    }
  });

  it("has the right linear size, mip count and file length", () => {
    for (const [w, h, mips] of [[256, 256, 9], [1024, 256, 11], [1000, 750, 10], [1, 1, 1], [3, 5, 3]]) {
      const px = new Uint8Array(w * h * 4).fill(128);
      const d1 = encodeDdsDxt1(px, w, h);
      const d5 = encodeDdsDxt5(px, w, h);
      expect(u32(d1, 28)).toBe(mips);
      expect(mipCount(w, h)).toBe(mips);
      expect(u32(d1, 20)).toBe(Math.ceil(w / 4) * Math.ceil(h / 4) * 8);
      expect(u32(d5, 20)).toBe(Math.ceil(w / 4) * Math.ceil(h / 4) * 16);
      expect(d1.length).toBe(expectedLength(w, h, 8));
      expect(d5.length).toBe(expectedLength(w, h, 16));
    }
  });
});

describe("DDS encoding", () => {
  it("flat colour decodes to its nearest 5:6:5 value at every level", () => {
    const [r, g, b] = [200, 77, 13];
    const px = new Uint8Array(40 * 24 * 4);
    for (let i = 0; i < px.length; i += 4) px.set([r, g, b, 255], i);
    const want = [expand5(Math.round((r * 31) / 255)), expand6(Math.round((g * 63) / 255)), expand5(Math.round((b * 31) / 255))];
    for (const enc of [encodeDdsDxt1, encodeDdsDxt5]) {
      for (const lv of levels(enc(px, 40, 24))) {
        for (let i = 0; i < lv.rgba.length; i += 4) expect(Array.from(lv.rgba.subarray(i, i + 3))).toEqual(want);
      }
    }
  });

  it("never writes DXT1's punch-through mode by accident", () => {
    const px = aerialLike(256, 256, 4);
    const r = seeded(9);
    for (let i = 0; i < px.length; i += 4 * 7) { px[i] = 255 * Math.round(r()); px[i + 1] = px[i]; px[i + 2] = px[i]; }
    // plus flat blocks, where both endpoints round to the same value
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px.set([90, 90, 90, 255], (y * 256 + x) * 4);
    const d = encodeDdsDxt1(px, 256, 256);
    for (let at = 128; at < d.length; at += 8) {
      const c0 = d[at] | (d[at + 1] << 8), c1 = d[at + 2] | (d[at + 3] << 8);
      if (c0 === c1) expect(u32(d, at + 4)).toBe(0);
      else expect(c0).toBeGreaterThan(c1);
    }
  });

  it("is good enough on an aerial-like image (mean error under 6, none over 64)", () => {
    const px = aerialLike(256, 256, 2);
    const e = errors(px, decodeDds(encodeDdsDxt1(px, 256, 256)).rgba);
    expect(e.mean).toBeLessThan(6);
    expect(e.max).toBeLessThanOrEqual(64);
  });

  it("DXT5 alpha: a gradient within one palette step, flat 128 exact", () => {
    const px = aerialLike(256, 16, 3);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 256; x++) px[(y * 256 + x) * 4 + 3] = x;
    const d = decodeDds(encodeDdsDxt5(px, 256, 16)).rgba;
    for (let i = 3; i < d.length; i += 4) expect(Math.abs(d[i] - px[i])).toBeLessThanOrEqual(20);
    for (let i = 3; i < px.length; i += 4) px[i] = 128;
    const flat = decodeDds(encodeDdsDxt5(px, 256, 16)).rgba;
    for (let i = 3; i < flat.length; i += 4) expect(flat[i]).toBe(128);
  });

  it("DXT5 colour is as good as DXT1", () => {
    const px = aerialLike(128, 128, 6);
    const e1 = errors(px, decodeDds(encodeDdsDxt1(px, 128, 128)).rgba);
    const e5 = errors(px, decodeDds(encodeDdsDxt5(px, 128, 128)).rgba);
    expect(e5.mean).toBeLessThanOrEqual(e1.mean + 1e-9);
  });

  it("handles sizes that aren't multiples of 4", () => {
    for (const [w, h] of [[5, 3], [1000, 750]]) {
      const px = aerialLike(w, h, w);
      const d = decodeDds(encodeDdsDxt1(px, w, h));
      expect([d.width, d.height]).toEqual([w, h]);
      expect(d.rgba.length).toBe(w * h * 4);
      expect(errors(px, d.rgba).mean).toBeLessThan(6);
    }
    // A 5 x 3 image whose last column is a different flat colour: the edge blocks repeat it, not garbage.
    const px = new Uint8Array(5 * 3 * 4);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) px.set(x === 4 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 5 + x) * 4);
    const d = decodeDds(encodeDdsDxt1(px, 5, 3)).rgba;
    for (let y = 0; y < 3; y++) expect(Array.from(d.subarray((y * 5 + 4) * 4, (y * 5 + 4) * 4 + 3))).toEqual([255, 0, 0]);
  });

  it("makes mips with a 2 x 2 box filter, clamping at odd edges", () => {
    // 2 x 2 checkerboard of black and white: level 1 is mean grey (128 rounds to 5:6:5 and back).
    const cb = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
    const l1 = levels(encodeDdsDxt5(cb, 2, 2))[1];
    expect([l1.w, l1.h]).toEqual([1, 1]);
    expect(Array.from(l1.rgba)).toEqual([expand5(Math.round((128 * 31) / 255)), expand6(Math.round((128 * 63) / 255)), expand5(Math.round((128 * 31) / 255)), 255]);
    // 3 x 3 alpha ramp: level 1 is 1 x 1 from the top-left 2 x 2 pixels (halving rounds down, so an
    // odd size alone never reaches past the edge); the clamp is reached when a side is 1 pixel.
    const a3 = new Uint8Array(3 * 3 * 4);
    for (let i = 0; i < 9; i++) a3.set([0, 0, 0, i * 20], i * 4);
    const m = levels(encodeDdsDxt5(a3, 3, 3))[1];
    expect(m.rgba[3]).toBe(Math.round((0 + 20 + 60 + 80) / 4));
    // 1 x 3: halving to 1 x 1 clamps the missing column to the edge pixel.
    const tall = new Uint8Array([0, 0, 0, 40, 0, 0, 0, 120, 0, 0, 0, 250]);
    const t1 = levels(encodeDdsDxt5(tall, 1, 3))[1];
    expect([t1.w, t1.h]).toEqual([1, 1]);
    expect(t1.rgba[3]).toBe(Math.round((40 + 40 + 120 + 120) / 4));
  });

  it("rejects zero sizes and short pixel data", () => {
    expect(() => encodeDdsDxt1(new Uint8Array(0), 0, 4)).toThrow();
    expect(() => encodeDdsDxt5(new Uint8Array(0), 4, 0)).toThrow();
    expect(() => encodeDdsDxt1(new Uint8Array(15), 2, 2)).toThrow();
  });
});

describe("DDS decoding", () => {
  it("decodes DXT1 three-colour mode: index 2 the midpoint, index 3 transparent black", () => {
    const c0 = 0x001f; // blue
    const c1 = 0xf800; // red, larger: three-colour mode
    const idx = 0b11_10_01_00; // pixels 0..3 = indices 0, 1, 2, 3
    const d = decodeDds(handDds(4, 4, "DXT1", [c0 & 255, c0 >> 8, c1 & 255, c1 >> 8, idx, 0, 0, 0])).rgba;
    expect(Array.from(d.subarray(0, 4))).toEqual([0, 0, 255, 255]);
    expect(Array.from(d.subarray(4, 8))).toEqual([255, 0, 0, 255]);
    expect(Array.from(d.subarray(8, 12))).toEqual([128, 0, 128, 255]);
    expect(Array.from(d.subarray(12, 16))).toEqual([0, 0, 0, 0]);
  });

  it("decodes DXT5 six-value alpha mode: indices 6 and 7 are 0 and 255", () => {
    // a0 = 50 <= a1 = 200; pixel 0 index 6, pixel 1 index 7, pixel 2 index 2 ((4*50+200)/5 = 80)
    const bits = 6 | (7 << 3) | (2 << 6);
    const alpha = [50, 200, bits & 255, (bits >> 8) & 255, 0, 0, 0, 0];
    const colour = [0xff, 0xff, 0, 0, 0, 0, 0, 0];
    const d = decodeDds(handDds(4, 4, "DXT5", [...alpha, ...colour])).rgba;
    expect([d[3], d[7], d[11], d[15]]).toEqual([0, 255, 80, 50]);
  });

  it("decodes a DXT5 colour block with endpoints in the 'wrong' order using four colours", () => {
    const c0 = 0x0000, c1 = 0xffff; // c0 < c1 would be three-colour in DXT1
    const idx = 0b11_10_01_00;
    const d = decodeDds(handDds(4, 4, "DXT5", [255, 255, 0, 0, 0, 0, 0, 0, c0 & 255, c0 >> 8, c1 & 255, c1 >> 8, idx, 0, 0, 0])).rgba;
    expect(Array.from(d.subarray(8, 12))).toEqual([85, 85, 85, 255]);
    expect(Array.from(d.subarray(12, 16))).toEqual([170, 170, 170, 255]);
  });

  it("throws on bad magic, other formats and truncated data", () => {
    const good = encodeDdsDxt1(aerialLike(16, 16), 16, 16);
    const bad = good.slice();
    bad[0] = 0;
    expect(() => decodeDds(bad)).toThrow(/not a DDS file/);
    for (const cc of ["DX10", "ATI2"]) {
      const other = good.slice();
      for (let i = 0; i < 4; i++) other[84 + i] = cc.charCodeAt(i);
      expect(() => decodeDds(other)).toThrow(new RegExp(`not supported.*${cc}`));
    }
    expect(() => decodeDds(good.subarray(0, 128 + 8 * 15))).toThrow();
    expect(() => decodeDds(good.subarray(0, 100))).toThrow();
  });
});

describe("DDS on real files", () => {
  it("decodes the DDS textures in a landmark layer the old writer made, and re-encodes them well", () => {
    const m = readKn5(new Uint8Array(readFileSync("test/fixtures/ac/lm_busselton_museum.kn5")));
    const dds = m.textures.filter((t) => String.fromCharCode(...t.data.subarray(0, 4)) === "DDS ");
    expect(dds.length).toBeGreaterThan(0);
    for (const t of dds) {
      expect(["DXT1", "DXT5"]).toContain(fourcc(t.data));
      const d = decodeDds(t.data);
      expect([d.width, d.height]).toEqual([u32(t.data, 16), u32(t.data, 12)]);
      const again = decodeDds((fourcc(t.data) === "DXT5" ? encodeDdsDxt5 : encodeDdsDxt1)(d.rgba, d.width, d.height));
      const e = errors(d.rgba, again.rgba);
      expect(e.mean, t.name).toBeLessThan(6);
      expect(e.max, t.name).toBeLessThanOrEqual(64);
    }
  });

  it.skipIf(!HAVE_BUILD)("decodes every DDS texture in a real build's kn5 files", () => {
    for (const [name, data] of Object.entries(buildFiles((n) => n.endsWith(".kn5")))) {
      for (const t of readKn5(data).textures) {
        if (String.fromCharCode(...t.data.subarray(0, 4)) !== "DDS ") continue;
        expect(["DXT1", "DXT5"], `${name}:${t.name}`).toContain(fourcc(t.data));
        const d = decodeDds(t.data);
        expect([d.width, d.height]).toEqual([u32(t.data, 16), u32(t.data, 12)]);
      }
    }
  }, 300_000);
});
