// Procedural textures and the raster (docs/specs/textures.md, "Test list"). Written fresh from the spec.
import { describe, expect, it } from "vitest";
import { decodeOwnPng } from "../src/core/png";
import {
  BARRIERS, barrierTexture, detailTexture, fill, GROUND_TILE, groundClasses, groundDetail, groundMask,
  normalFromHeight, postTexture, Raster, sealTexture, SEAL_LENGTH, solidTexture, valueNoise,
} from "../src/core/textures";

const lum = (p: ArrayLike<number>, o: number) => 0.3 * p[o] + 0.59 * p[o + 1] + 0.11 * p[o + 2];
const meanLum = (p: ArrayLike<number>) => {
  let s = 0;
  for (let o = 0; o < p.length; o += 4) s += lum(p, o);
  return s / (p.length / 4);
};
/** RGBA of a w x h image painted by f(x, y). */
const image = (w: number, h: number, f: (x: number, y: number) => number[]) => {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = f(x, y), o = (y * w + x) * 4;
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3] ?? 255;
  }
  return out;
};

describe("value noise", () => {
  it("stays in 0..1, repeats for a seed and tiles both ways", () => {
    const w = 64, h = 32, n = valueNoise(w, h, 8, 5);
    expect(n.length).toBe(w * h);
    for (const v of n) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(valueNoise(w, h, 8, 5)).toEqual(n);
    expect(valueNoise(w, h, 8, 6)).not.toEqual(n);
    // Wrapping: the step from the last column to the first is no bigger than a step inside the image.
    let inside = 0, wrap = 0, insideV = 0, wrapV = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x + 1 < w; x++) inside = Math.max(inside, Math.abs(n[y * w + x + 1] - n[y * w + x]));
      wrap = Math.max(wrap, Math.abs(n[y * w] - n[y * w + w - 1]));
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y + 1 < h; y++) insideV = Math.max(insideV, Math.abs(n[(y + 1) * w + x] - n[y * w + x]));
      wrapV = Math.max(wrapV, Math.abs(n[x] - n[(h - 1) * w + x]));
    }
    expect(wrap).toBeLessThanOrEqual(inside + 1e-6);
    expect(wrapV).toBeLessThanOrEqual(insideV + 1e-6);
  });

  it("copes with more cells than pixels and non-square sizes", () => {
    const n = valueNoise(8, 3, 50, 1);
    expect(n.length).toBe(24);
    for (const v of n) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("fill and solid", () => {
  it("clamps and makes opaque pixels", () => {
    const p = fill(2, 1, (x) => (x === 0 ? [-20, 300, 128.7] : [1, 2, 3]));
    expect(Array.from(p)).toEqual([0, 255, 128, 255, 1, 2, 3, 255]);
  });
  it("solid texture is a 4 x 4 PNG of the colour", () => {
    const { rgba, width, height } = decodeOwnPng(solidTexture([10, 20, 30]));
    expect([width, height]).toEqual([4, 4]);
    for (let o = 0; o < rgba.length; o += 4) expect(Array.from(rgba.subarray(o, o + 4))).toEqual([10, 20, 30, 255]);
  });
});

describe("seal texture", () => {
  const a = sealTexture("asphalt", true, 0);
  const c = sealTexture("chipseal", true, 0);
  it("is 512 x 1024 and repeatable", () => {
    expect([a.width, a.height]).toEqual([512, 1024]);
    expect(a.rgba.length).toBe(512 * 1024 * 4);
    expect(sealTexture("asphalt", true, 0).rgba).toEqual(a.rgba);
    expect(sealTexture("asphalt", true, 1).rgba).not.toEqual(a.rgba);
    expect(sealTexture("asphalt", false, 0).rgba).not.toEqual(a.rgba);
    expect(SEAL_LENGTH).toBe(24);
  });
  it("is seamless along v", () => {
    for (const t of [a, c]) {
      const row = (y: number) => { let s = 0; for (let x = 0; x < t.width; x++) s += lum(t.rgba, (y * t.width + x) * 4); return s / t.width; };
      // Mean brightness of the first and last rows: close, as neighbouring rows are.
      expect(Math.abs(row(0) - row(t.height - 1))).toBeLessThan(Math.abs(row(0) - row(1)) + 4);
    }
  });
  it("asphalt is darker than chipseal, around 60", () => {
    expect(meanLum(a.rgba)).toBeLessThan(meanLum(c.rgba));
    expect(meanLum(a.rgba)).toBeGreaterThan(45);
    expect(meanLum(a.rgba)).toBeLessThan(75);
  });
  it("chipseal wheel paths are darker than the lane centre", () => {
    const col = (x: number) => { let s = 0; for (let y = 0; y < c.height; y++) s += lum(c.rgba, (y * c.width + x) * 4); return s / c.height; };
    const lane = 256, mid = lane / 2, wheel = Math.round(mid - 0.26 * lane);
    expect(col(wheel)).toBeLessThan(col(mid + 20) - 5);
  });
});

describe("guide post", () => {
  it("red reflector left, white middle, plain right", () => {
    const { rgba, width, height } = decodeOwnPng(postTexture());
    expect([width, height]).toEqual([48, 64]);
    const third = (t: number, test: (r: number, g: number, b: number) => boolean) => {
      let n = 0;
      for (let y = 0; y < 16; y++) for (let x = t * 16; x < (t + 1) * 16; x++) {
        const o = (y * width + x) * 4;
        if (test(rgba[o], rgba[o + 1], rgba[o + 2])) n++;
      }
      return n;
    };
    const red = (r: number, g: number, b: number) => r > 150 && g < 80 && b < 80;
    const bright = (r: number, g: number, b: number) => r > 245 && g > 245 && b > 245;
    expect(third(0, red)).toBeGreaterThan(20);
    expect(third(1, red)).toBe(0);
    expect(third(1, bright)).toBeGreaterThan(20);
    expect(third(2, red) + third(2, bright)).toBe(0);
  });
});

describe("detail textures", () => {
  for (const kind of ["asphalt", "chipseal"] as const) {
    it(`${kind}: near white, stones wider in u than in v`, () => {
      const { rgba, width, height } = decodeOwnPng(detailTexture(kind));
      expect(width).toBe(256);
      expect(meanLum(rgba) / 255).toBeGreaterThan(0.85);
      // Brightness stays alike further along u than along v: autocorrelation two pixels across
      // beats two pixels down.
      const m = meanLum(rgba);
      const d = (x: number, y: number) => lum(rgba, ((y % height) * width + (x % width)) * 4) - m;
      let across = 0, down = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        across += d(x, y) * d(x + 2, y);
        down += d(x, y) * d(x, y + 2);
      }
      expect(across).toBeGreaterThan(down * 1.3);
    });
  }
});

describe("ground classes and mask", () => {
  const px = (r: number, g: number, b: number, a = 255) => image(3, 3, () => [r, g, b, a]);
  const at = (c: { grass: Float32Array; dirt: Float32Array }) => [c.grass[4], c.dirt[4]];
  it("green to grass, red-brown earth to dirt, grey to plain", () => {
    const [g1, d1] = at(groundClasses(px(70, 120, 50), 3, 3));
    expect(g1).toBeGreaterThan(0.7);
    expect(d1).toBeLessThan(0.1);
    const [g2, d2] = at(groundClasses(px(150, 105, 70), 3, 3));
    expect(d2).toBeGreaterThan(0.6);
    expect(g2).toBeLessThan(0.3);
    const [g3, d3] = at(groundClasses(px(128, 128, 128), 3, 3));
    expect(g3 + d3).toBeLessThan(0.05);
  });
  it("dry summer grass is grass, not dirt", () => {
    const [g, d] = at(groundClasses(px(170, 160, 105), 3, 3));
    expect(g).toBeGreaterThan(d);
  });
  it("weights never add above 1; transparent and black are plain", () => {
    const w = 32, h = 32;
    const img = image(w, h, (x, y) => [(x * 37 + y * 11) % 256, (x * 13 + y * 29) % 256, (x * 7 + y * 53) % 256]);
    const c = groundClasses(img, w, h);
    for (let i = 0; i < w * h; i++) expect(c.grass[i] + c.dirt[i]).toBeLessThanOrEqual(1 + 1e-6);
    const none = groundClasses(image(4, 4, () => [70, 120, 50, 0]), 4, 4);
    const black = groundClasses(image(4, 4, () => [0, 0, 0]), 4, 4);
    for (const k of [none, black]) for (let i = 0; i < 16; i++) expect(k.grass[i] + k.dirt[i]).toBe(0);
  });
  it("mask: at most 256 a side, channels add to 255", () => {
    const big = groundMask(image(600, 300, (x) => (x < 300 ? [70, 120, 50] : [150, 105, 70])), 600, 300);
    expect(big.width).toBeLessThanOrEqual(256);
    expect(big.height).toBeLessThanOrEqual(256);
    for (let o = 0; o < big.rgba.length; o += 4) {
      expect(big.rgba[o] + big.rgba[o + 1] + big.rgba[o + 2]).toBe(255);
      expect(big.rgba[o + 3]).toBe(255);
    }
    expect(big.rgba[0]).toBeGreaterThan(200); // grass on the left
    const small = groundMask(image(40, 20, () => [128, 128, 128]), 40, 20);
    expect([small.width, small.height]).toEqual([40, 20]);
    expect(small.rgba[2]).toBe(255);
  });
});

describe("ground detail", () => {
  for (const kind of ["grass", "dirt", "plain"] as const) {
    it(`${kind}: mid grey on average and tiles`, () => {
      const p = groundDetail(kind);
      expect(p.length).toBe(512 * 512 * 4);
      expect(Math.abs(meanLum(p) - 127.5)).toBeLessThan(4);
      const col = (x: number) => { let s = 0; for (let y = 0; y < 512; y++) s += lum(p, (y * 512 + x) * 4); return s / 512; };
      const row = (y: number) => { let s = 0; for (let x = 0; x < 512; x++) s += lum(p, (y * 512 + x) * 4); return s / 512; };
      expect(Math.abs(col(0) - col(511))).toBeLessThan(12);
      expect(Math.abs(row(0) - row(511))).toBeLessThan(12);
    });
  }
  it("tile sizes", () => expect(GROUND_TILE).toEqual({ grass: 1.6, dirt: 2.4, plain: 2 }));
});

describe("normal from height", () => {
  it("flat gives straight up", () => {
    const n = normalFromHeight(image(4, 4, () => [100, 100, 100]), 4, 4, 3);
    for (let o = 0; o < n.length; o += 4) expect(Array.from(n.subarray(o, o + 4))).toEqual([128, 128, 255, 255]);
  });
  it("a bright vertical stripe tilts red away either side", () => {
    const w = 16, h = 8;
    const n = normalFromHeight(image(w, h, (x) => (x === 8 ? [255, 255, 255] : [0, 0, 0])), w, h, 2);
    const r = (x: number) => n[(4 * w + x) * 4];
    expect(r(7)).toBeLessThan(128); // left of the ridge faces left
    expect(r(9)).toBeGreaterThan(128); // right faces right
    expect(n[(4 * w + 7) * 4 + 1]).toBe(128); // no slope along v
  });
  it("green follows DirectX: a bright row below makes green go up", () => {
    const w = 8, h = 16;
    const n = normalFromHeight(image(w, h, (_x, y) => (y === 8 ? [255, 255, 255] : [0, 0, 0])), w, h, 2);
    // Just above the bright row the surface rises downward, so the normal leans up the image:
    // with green pointing down, green drops below 128.
    expect(n[(7 * w + 3) * 4 + 1]).toBeLessThan(128);
    expect(n[(9 * w + 3) * 4 + 1]).toBeGreaterThan(128);
  });
});

describe("raster", () => {
  const alphaAt = (r: Raster, x: number, y: number) => r.rgba[(y * r.width + x) * 4 + 3];
  it("a 3 px line covers about 3 rows", () => {
    const r = new Raster(40, 20);
    r.line([[5, 10], [35, 10]], 3, [255, 255, 255, 255]);
    let rows = 0;
    for (let y = 0; y < 20; y++) rows += alphaAt(r, 20, y) / 255;
    expect(rows).toBeGreaterThan(2.5);
    expect(rows).toBeLessThan(3.5);
  });
  it("joints are no stronger than straight parts", () => {
    const r = new Raster(40, 40);
    r.line([[5, 20], [20, 20], [20, 35]], 4, [255, 0, 0, 128]);
    let max = 0;
    for (let i = 3; i < r.rgba.length; i += 4) max = Math.max(max, r.rgba[i]);
    expect(max).toBeLessThanOrEqual(alphaAt(r, 12, 20) + 1);
  });
  it("a dot is round", () => {
    const r = new Raster(41, 41);
    r.dot(20.5, 20.5, 10, [0, 0, 0, 255]);
    expect(alphaAt(r, 20, 10)).toBeGreaterThan(100);
    expect(alphaAt(r, 30, 20)).toBeGreaterThan(100);
    expect(alphaAt(r, 28, 28)).toBe(0); // the square's corner region stays empty
    expect(alphaAt(r, 20, 20)).toBe(255);
  });
  it("blends over a transparent background and what's there", () => {
    const r = new Raster(4, 4);
    r.dot(2, 2, 3, [200, 100, 50, 128]);
    const o = (1 * 4 + 1) * 4;
    expect(Array.from(r.rgba.subarray(o, o + 4))).toEqual([200, 100, 50, 128]);
    r.dot(2, 2, 3, [0, 0, 0, 255]);
    expect(Array.from(r.rgba.subarray(o, o + 4))).toEqual([0, 0, 0, 255]);
    const bg = new Raster(2, 2, [255, 255, 255, 255]);
    bg.dot(1, 1, 3, [0, 0, 0, 128]);
    expect(bg.rgba[0]).toBeGreaterThan(120);
    expect(bg.rgba[0]).toBeLessThan(135);
    expect(bg.rgba[3]).toBe(255);
  });
  it("off-canvas, one-point and zero-length lines", () => {
    const r = new Raster(10, 10);
    r.line([[3, 3]], 4, [255, 255, 255, 255]);
    r.line([[-50, -50], [-20, -40]], 4, [255, 255, 255, 255]);
    expect(r.rgba.every((v) => v === 0)).toBe(true);
    r.line([[5, 5], [5, 5]], 4, [255, 255, 255, 255]);
    expect(alphaAt(r, 5, 5)).toBe(255);
    r.line([[-20, 8], [30, 8]], 2, [255, 255, 255, 255]);
    expect(alphaAt(r, 0, 8)).toBeGreaterThan(0);
    expect(r.png().length).toBeGreaterThan(0);
  });
});

describe("barriers", () => {
  it("a 128 px texture for every barrier, each different", () => {
    const seen = new Set<string>();
    for (const b of BARRIERS) {
      const png = barrierTexture(b);
      const { width, height } = decodeOwnPng(png);
      expect([width, height]).toEqual([128, 128]);
      seen.add(Buffer.from(png).toString("base64"));
    }
    expect(seen.size).toBe(BARRIERS.length);
    expect([...BARRIERS]).toEqual(["colorbond", "paling", "brickwall", "hedge"]);
  });
});
