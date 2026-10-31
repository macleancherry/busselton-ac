// Busselton fork: every texture a build paints for itself, plus a small anti-aliased raster for the
// map and outline images (docs/specs/textures.md). Written fresh from that spec.
//
// All procedural, all deterministic: the same call gives the same bytes, so a build never needs a
// download and two builds of the same route match.

import { encodeDdsDxt1 as toDxt1 } from "./dds";
import { encodePng as toPng } from "./png";
import { rng } from "./random";

export { rng };

type Rgb = readonly [number, number, number];
type Rgba = readonly [number, number, number, number];
type Pixels = Uint8Array | Uint8ClampedArray;
/** The bytes of a PNG file. */
type PngFile = Uint8Array;
/** Raw RGBA bytes, four per pixel. */
type RgbaBytes = Uint8Array;

/* ---------------- shared building blocks ---------------- */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => t * t * (3 - 2 * t);
const smoothstep = (e0: number, e1: number, v: number) => smooth(clamp01((v - e0) / (e1 - e0)));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** A float to a byte: clamped to 0..255, fraction dropped (NaN gives 0). */
const toByte = (v: number) => (v >= 255 ? 255 : v > 0 ? v | 0 : 0);
const wrapIndex = (v: number, n: number) => ((v % n) + n) % n;

/**
 * Tileable value noise in 0..1: a lattice `cells` across (and proportionally many down) of random
 * values, smoothstep-interpolated, wrapping at the edges so the result tiles both ways.
 */
export function valueNoise(width: number, height: number, cells: number, seed: number): Float32Array {
  const cx = Math.max(1, Math.round(cells));
  const cy = Math.max(1, Math.round((cells * height) / width));
  const rand = rng(seed);
  const lattice = Float32Array.from({ length: cx * cy }, () => rand());
  // Lattice cells either side of each column and the eased weight between them, reused every row.
  const left = new Int32Array(width), right = new Int32Array(width), wx = new Float32Array(width);
  for (let col = 0; col < width; col++) {
    const f = (col * cx) / width, c = Math.floor(f);
    left[col] = c % cx;
    right[col] = (c + 1) % cx;
    wx[col] = smooth(f - c);
  }
  const out = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    const f = (row * cy) / height, c = Math.floor(f), wy = smooth(f - c);
    const above = (c % cy) * cx, below = ((c + 1) % cy) * cx;
    const base = row * width;
    for (let col = 0; col < width; col++) {
      const a = lerp(lattice[above + left[col]], lattice[above + right[col]], wx[col]);
      const b = lerp(lattice[below + left[col]], lattice[below + right[col]], wx[col]);
      out[base + col] = lerp(a, b, wy);
    }
  }
  return out;
}

/** Opaque RGBA pixels from a shading function of (x, y, pixel index) giving RGB; values clamped to 0..255. */
export function fill(width: number, height: number, shade: (x: number, y: number, i: number) => ArrayLike<number>): RgbaBytes {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const c = shade(x, y, i), o = i * 4;
      out[o] = toByte(c[0]);
      out[o + 1] = toByte(c[1]);
      out[o + 2] = toByte(c[2]);
      out[o + 3] = 255;
    }
  }
  return out;
}

/** A 4 x 4 opaque PNG of one colour. */
export function solidTexture(rgb: readonly [number, number, number]): PngFile {
  return toPng(fill(4, 4, () => rgb), 4, 4);
}

/** RGB float planes, for textures painted in several passes. */
class Planes {
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  constructor(readonly width: number, readonly height: number) {
    this.r = new Float32Array(width * height);
    this.g = new Float32Array(width * height);
    this.b = new Float32Array(width * height);
  }
  set(i: number, c: ArrayLike<number>): void {
    this.r[i] = c[0];
    this.g[i] = c[1];
    this.b[i] = c[2];
  }
  /** Moves pixel i towards colour c by t. */
  mix(i: number, c: ArrayLike<number>, t: number): void {
    this.r[i] += (c[0] - this.r[i]) * t;
    this.g[i] += (c[1] - this.g[i]) * t;
    this.b[i] += (c[2] - this.b[i]) * t;
  }
  add(i: number, d: number): void {
    this.r[i] += d;
    this.g[i] += d;
    this.b[i] += d;
  }
  rgba(): RgbaBytes {
    return fill(this.width, this.height, (_x, _y, i) => [this.r[i], this.g[i], this.b[i]]);
  }
  png(): PngFile {
    return toPng(this.rgba(), this.width, this.height);
  }
}

/* ---------------- road surface ---------------- */

/** Metres of road one seal texture covers along v; the road meshes' v coordinates use it. */
export const SEAL_LENGTH = 24; // metres

export type SealKind = "asphalt" | "chipseal"; // asphalt in town, chip seal on country roads

const SEAL_W = 512, SEAL_H = 1024;
const CRACK: Rgb = [24, 24, 25];
const STONES: Rgb[] = [
  [122, 120, 114], // grey
  [132, 116, 96], // brown
  [106, 112, 120], // blue-grey
  [142, 138, 130], // pale grey
];

/**
 * The road surface, 512 x 1024: u across the whole road (left to right), v along it for
 * SEAL_LENGTH metres, tiling along v. Wheel paths, patches and sealed cracks; no markings.
 */
/** A painted road surface: DXT1 for the kn5, raw RGBA for the preview and normal maps. */
export type SealTexture = { dds: Uint8Array; rgba: RgbaBytes; width: number; height: number };

export function sealTexture(kind: SealKind, twoLane: boolean, variant: number): SealTexture {
  const W = SEAL_W, H = SEAL_H;
  const lanes = twoLane ? 2 : 1;
  const laneW = W / lanes;
  const r = rng((kind === "asphalt" ? 7100 : 7300) + variant * 17 + lanes * 5);
  const n1 = valueNoise(W, H, 4, Math.floor(r() * 1e9));
  const n2 = valueNoise(W, H, 16, Math.floor(r() * 1e9));
  const n3 = valueNoise(W, H, 64, Math.floor(r() * 1e9));

  // Across the road: how much of a wheel path, and of a lane's centre (oil drips), each column is.
  const wheel = new Float32Array(W), centre = new Float32Array(W);
  for (let col = 0; col < W; col++) {
    let w = 0, c = 0;
    for (let l = 0; l < lanes; l++) {
      const mid = (l + 0.5) * laneW;
      for (const side of [-1, 1]) w += Math.exp(-(((col - (mid + side * 0.26 * laneW)) / (0.06 * laneW)) ** 2));
      c += Math.exp(-(((col - mid) / (0.025 * laneW)) ** 2));
    }
    wheel[col] = Math.min(1, w);
    centre[col] = Math.min(1, c);
  }

  const px = new Planes(W, H);
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = (i - x) / W;
    {
      if (kind === "asphalt") {
        let v = 60 + 12 * (n1[i] - 0.5) + 12 * (n2[i] - 0.5) + 10 * (n3[i] - 0.5) + (r() - 0.5) * 20;
        v -= 4 * wheel[x];
        v -= 3.5 * centre[x] * (0.4 + n2[i]);
        px.set(i, [v - 1, v, v + 1]);
      } else {
        // Stones about 2 px (a centimetre or so), each row of stones shifted so no grid shows, binder
        // showing between some of them; colours muted towards grey, as weathered chip is.
        const shift = Math.floor(y / 2) * 5;
        const cx = Math.floor((x + shift) / 2), cy = Math.floor(y / 2);
        const h = hash2(cx & 1023, cy, variant);
        const tone = 0.83 + 0.2 * (n1[i] - 0.5) + 0.2 * (n2[i] - 0.5);
        let c: number[];
        if (h < 0.1 || r() < 0.07) c = [64 * tone, 62 * tone, 57 * tone];
        else {
          const s = STONES[Math.floor(h * 97) % STONES.length];
          const b = (0.86 + 0.24 * ((h * 7.31) % 1) + (r() - 0.5) * 0.2) * tone;
          const grey = (s[0] + s[1] + s[2]) / 3;
          c = [lerp(grey, s[0], 0.55) * b * 1.02, lerp(grey, s[1], 0.55) * b, lerp(grey, s[2], 0.55) * b * 0.96];
        }
        px.set(i, c);
        // Wheel paths: traffic has pushed binder up between the stones, dark and smooth.
        px.mix(i, [56 * tone, 54 * tone, 51 * tone], 0.55 * wheel[x]);
      }
    }
  }

  // Patches: newer seal in a lane, a different tone with a dark sealed edge, wrapping along v.
  for (let p = 0, patches = 1 + Math.floor(r() * 3); p < patches; p++) {
    const lane = Math.floor(r() * lanes);
    const pw = Math.round(laneW * (0.15 + r() * 0.3));
    const x0 = Math.round(lane * laneW + r() * (laneW - pw));
    const len = Math.round(((1.5 + r() * 5) / SEAL_LENGTH) * H);
    const y0 = Math.floor(r() * H);
    const delta = (r() < 0.35 ? -1 : 1) * (5 + r() * 6);
    for (let dy = 0; dy < len; dy++) {
      const y = (y0 + dy) % H;
      for (let x = x0; x < x0 + pw && x < W; x++) {
        const i = y * W + x;
        const rim = dy < 2 || dy >= len - 2 || x < x0 + 2 || x >= x0 + pw - 2;
        if (kind === "asphalt") px.add(i, rim ? -16 : delta);
        else if (rim) px.mix(i, [30, 30, 29], 0.8);
        else {
          px.r[i] = px.r[i] * 0.45 + 13;
          px.g[i] = px.g[i] * 0.45 + 13;
          px.b[i] = px.b[i] * 0.45 + 12;
        }
      }
    }
  }

  // Sealed cracks: dark meandering lines 3 px wide, mostly along the road, wrapping along v.
  const stamp = (cx: number, cy: number) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = Math.round(cx) + dx;
        if (x < 0 || x >= W) continue;
        const d = Math.hypot(Math.round(cx) + dx - cx, Math.round(cy) + dy - cy);
        const t = clamp01(2 - d) * 0.85;
        if (t > 0) px.mix(wrapIndex(Math.round(cy) + dy, H) * W + x, CRACK, t);
      }
    }
  };
  const crack = (x: number, y: number, base: number, spread: number, length: number) => {
    let heading = base + (r() - 0.5) * 2 * spread;
    for (let s = 0; s < length; s += 1.5) {
      stamp(x, y);
      heading += (r() - 0.5) * 0.4;
      heading = Math.max(base - spread, Math.min(base + spread, heading));
      x += Math.cos(heading) * 1.5;
      y += Math.sin(heading) * 1.5;
      if (x < 2 || x > W - 3) break;
    }
  };
  const cracks = kind === "asphalt" ? 4 + Math.floor(r() * 4) : 1 + (r() < 0.5 ? 1 : 0);
  const along = Math.PI / 2, thirty = Math.PI / 6;
  for (let n = 0; n < cracks; n++) {
    const x = 8 + r() * (W - 16), y = r() * H;
    const dir = r() < 0.5 ? 1 : -1;
    if (r() < 0.75) crack(x, y, dir * along, thirty, 150 + r() * 350);
    else crack(x, y, dir > 0 ? 0 : Math.PI, Math.PI / 7, 40 + r() * 110);
  }
  if (twoLane) crack(W / 2 + (r() - 0.5) * 10, r() * H, along, Math.PI / 18, 300 + r() * 300);

  const rgba = px.rgba();
  return { dds: toDxt1(rgba, W, H), rgba, width: W, height: H };
}

/** A repeatable 0..1 number for an integer cell. */
function hash2(x: number, y: number, salt: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b9);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/* ---------------- small plain textures ---------------- */

/** Line paint, 64 px for a metre: near white with worn patches. */
export function paintTexture(): PngFile {
  const s = 64, r = rng(211);
  const wear = valueNoise(s, s, 8, 212), fine = valueNoise(s, s, 32, 213);
  return toPng(fill(s, s, (_x, _y, i) => {
    const worn = smoothstep(0.36, 0.14, wear[i]) * (0.7 + 0.6 * fine[i]);
    const v = 228 - 60 * worn + (r() - 0.5) * 10;
    return [v, v, v - 3];
  }), s, s);
}

/** The roadside verge, 256 px: gravel brown fading into dry grass. */
export function vergeTexture(): PngFile {
  const s = 256, r = rng(221);
  const blend = valueNoise(s, s, 4, 222), mid = valueNoise(s, s, 16, 223), fine = valueNoise(s, s, 64, 224);
  const gravel: Rgb = [140, 124, 96], dry: Rgb = [118, 114, 80];
  return toPng(fill(s, s, (_x, _y, i) => {
    const t = smoothstep(0.3, 0.7, blend[i]);
    const k = 1 + 0.16 * (mid[i] - 0.5) + 0.16 * (fine[i] - 0.5) + (r() - 0.5) * 0.14;
    return [lerp(gravel[0], dry[0], t) * k, lerp(gravel[1], dry[1], t) * k, lerp(gravel[2], dry[2], t) * k];
  }), s, s);
}

/** Grass, 512 px: green with two scales of noise and grain. */
export function grassTexture(): PngFile {
  const s = 512, r = rng(231);
  const big = valueNoise(s, s, 8, 232), small = valueNoise(s, s, 48, 233);
  return toPng(fill(s, s, (_x, _y, i) => {
    const k = 1 + 0.24 * (big[i] - 0.5) + 0.2 * (small[i] - 0.5) + (r() - 0.5) * 0.2;
    const dry = 6 * (big[i] - 0.5);
    return [(82 + dry) * k, 113 * k, 53 * k];
  }), s, s);
}

/** Concrete, 64 x 256: pale weathered grey, a contraction joint across the top two rows (one pour per tile). */
export function concreteTexture(): PngFile {
  const w = 64, h = 256, r = rng(241);
  const stain = valueNoise(w, h, 4, 242), grit = valueNoise(w, h, 16, 243);
  return toPng(fill(w, h, (_, y, i) => {
    if (y < 2) return [93, 93, 90];
    const v = 168 + 14 * (stain[i] - 0.5) + 8 * (grit[i] - 0.5) + (r() - 0.5) * 10;
    return [v, v, v - 4];
  }), w, h);
}

/** W-beam guard rail, 64 px: two ridges and a groove across v, galvanised grey. */
export function railTexture(): PngFile {
  const s = 64, r = rng(251);
  return toPng(fill(s, s, (_x, y) => {
    const ridge = 0.5 + 0.5 * Math.cos((2 * Math.PI * 2 * y) / s);
    const v = (ridge - 0.5) * 92 + (r() - 0.5) * 8;
    return [148 + v, 150 + v, 154 + v];
  }), s, s);
}

const POST_W = 48, POST_H = 64;
const POST_WHITE: Rgb = [236, 236, 230];

/**
 * A guide post, 48 x 64, in thirds across: red reflector, white reflector, plain. Reflectors on
 * rows 3 to 11 with a darker outline row above and below (the scenery spec's u ranges match).
 */
export function postTexture(): PngFile {
  const third = POST_W / 3;
  return toPng(fill(POST_W, POST_H, (x, y) => {
    const t = Math.floor(x / third), lx = x - t * third;
    if (t < 2) {
      if (y === 2 || y === 12) return [212, 212, 207];
      if (y >= 3 && y <= 11 && lx >= 3 && lx <= 12) return t === 0 ? [215, 25, 25] : [250, 250, 250];
    }
    return POST_WHITE;
  }), POST_W, POST_H);
}

/** A Colorbond roller door, 64 px: fine horizontal ribs, a darker bottom rail. */
export function garageTexture(): PngFile {
  const s = 64, r = rng(261);
  return toPng(fill(s, s, (_x, y) => {
    if (y >= s - 3) return [117, 117, 113];
    const k = 0.94 + 0.07 * Math.cos((2 * Math.PI * 14 * y) / s) + (r() - 0.5) * 0.02;
    return [209 * k, 207 * k, 196 * k];
  }), s, s);
}

/** One window, 64 px: sky reflected at the top darkening downward, a hint of curtain each side. */
export function windowTexture(): PngFile {
  const s = 64, r = rng(271);
  return toPng(fill(s, s, (x, y) => {
    const t = y / (s - 1);
    const n = (r() - 0.5) * 5;
    const glass = [152 - 92 * t + n, 167 - 96 * t + n, 182 - 96 * t + n];
    const curtain = y < s - 9 && (x < 10 || x >= s - 9);
    return curtain ? [glass[0] * 0.5 + 92, glass[1] * 0.5 + 88, glass[2] * 0.5 + 82] : glass;
  }), s, s);
}

/** The garden barriers fences.ts can build; each has a 128 px texture covering 2 m x 2 m. */
export const BARRIERS = ["colorbond", "paling", "brickwall", "hedge"] as const; // fences.ts
export type Barrier = (typeof BARRIERS)[number];

/** A barrier's texture (PNG). */
export function barrierTexture(kind: Barrier): PngFile {
  switch (kind) {
    case "colorbond": return colorbondTexture();
    case "paling": return palingTexture();
    case "brickwall": return brickTexture();
    case "hedge": return hedgeTexture();
  }
}

const B = 128;

function colorbondTexture(): PngFile {
  const r = rng(301), stain = valueNoise(B, B, 4, 302);
  return toPng(fill(B, B, (x, y, i) => {
    const k = 1 + 0.03 * (stain[i] - 0.5) + (r() - 0.5) * 0.04;
    if (x < 3 || x >= B - 3) return [60 * k, 63 * k, 57 * k]; // post
    if (y === 0) return [96 * k, 99 * k, 90 * k]; // lit top edge of the rail
    if (y < 6) return [70 * k, 73 * k, 66 * k]; // top rail
    const c = k * (1 + 0.13 * Math.sin((2 * Math.PI * x) / 4));
    return [86 * c, 89 * c, 80 * c];
  }), B, B);
}

function palingTexture(): PngFile {
  const r = rng(311);
  const grain = valueNoise(B, B * 4, 64, 312);
  // Paling widths that add up to the tile, so it tiles across.
  const edges: number[] = [0];
  while (edges[edges.length - 1] < B - 14) edges.push(edges[edges.length - 1] + 9 + Math.floor(r() * 5));
  edges.push(B);
  const tones = edges.map(() => 0.86 + r() * 0.24);
  return toPng(fill(B, B, (x, y) => {
    let p = 0;
    while (edges[p + 1] <= x) p++;
    if (x === edges[p]) return [52, 40, 28]; // shadow gap
    if (x === edges[p] + 1) return [104, 84, 60];
    if (y >= 29 && y <= 34) return y === 29 ? [84, 66, 44] : [102, 81, 56]; // rail
    // Grain runs up the paling: noise stretched vertically.
    const g = grain[((y * 4) % (B * 4)) * B + x] ?? 0.5;
    const k = tones[p] * (1 + 0.14 * (g - 0.5) + (r() - 0.5) * 0.06);
    return [158 * k, 132 * k, 93 * k];
  }), B, B);
}

function brickTexture(): PngFile {
  const r = rng(321);
  const cap = 7, course = 6, brick = 16;
  const tone = new Float32Array(64 * 32);
  for (let i = 0; i < tone.length; i++) tone[i] = 0.84 + r() * 0.28;
  return toPng(fill(B, B, (x, y) => {
    const n = (r() - 0.5) * 0.08;
    if (y < cap - 1) return [178 * (1 + n), 172 * (1 + n), 162 * (1 + n)]; // capping course
    const yy = y - (cap - 1);
    const row = Math.floor(yy / course);
    if (yy % course === 0) return [196, 190, 178]; // bed joint
    const xx = x + (row % 2) * (brick / 2);
    if (xx % brick === 0) return [196, 190, 178]; // perpend
    const k = tone[(row % 32) * 64 + Math.floor(xx / brick) % 64] * (1 + n);
    return [168 * k, 92 * k, 68 * k];
  }), B, B);
}

function hedgeTexture(): PngFile {
  const r = rng(331);
  const a = valueNoise(B, B, 8, 332), b = valueNoise(B, B, 16, 333), c = valueNoise(B, B, 32, 334);
  return toPng(fill(B, B, (_x, _y, i) => {
    const v = 0.5 * a[i] + 0.3 * b[i] + 0.2 * c[i];
    const hollow = smoothstep(0.42, 0.3, v) * 0.2;
    const k = (0.55 + 0.9 * v) * (1 - hollow) + (r() - 0.5) * 0.12;
    return [36 * k, 78 * k, 32 * k];
  }), B, B);
}

/* ---------------- detail and ground layers ---------------- */

/**
 * A road detail texture for CSP's detail shaders, 256 px, near white: small stones a little darker
 * or lighter than the binder (chipseal fewer and bigger), drawn 3:1 wide so they come out round on
 * the road. Wraps.
 */
export function detailTexture(kind: SealKind): PngFile {
  const s = 256, chip = kind === "chipseal";
  const r = rng(chip ? 402 : 401);
  const base = valueNoise(s, s, 8, chip ? 404 : 403);
  const lum = new Float32Array(s * s);
  for (let i = 0; i < lum.length; i++) lum[i] = 245 + 8 * (base[i] - 0.5);
  const count = chip ? 1500 : 2900;
  for (let stone = 0; stone < count; stone++) {
    const cx = r() * s, cy = r() * s;
    const rx = chip ? 3 + r() * 5 : 1.5 + r() * 2.5, ry = Math.max(0.6, rx / 3);
    const v = r() < 0.8 ? -(30 + r() * 35) : 7;
    for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
      for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
        const fx = Math.round(cx) + dx - cx, fy = Math.round(cy) + dy - cy;
        if ((fx / rx) ** 2 + (fy / ry) ** 2 > 1) continue;
        const i = wrapIndex(Math.round(cy) + dy, s) * s + wrapIndex(Math.round(cx) + dx, s);
        lum[i] = 245 + 8 * (base[i] - 0.5) + v;
      }
    }
  }
  return toPng(fill(s, s, (_x, _y, i) => [lum[i], lum[i], lum[i]]), s, s);
}

/** A flat tangent-space normal map, 4 x 4. */
export function flatNormalTexture(): PngFile {
  return toPng(fill(4, 4, () => [128, 128, 255]), 4, 4);
}

/** A txMaps texture, 4 x 4: specular (R), glossiness (G) and sun specular (B), each 0..1. */
export function mapsTexture(specular: number, gloss: number, sun: number): PngFile {
  return toPng(fill(4, 4, () => [specular * 255, gloss * 255, sun * 255]), 4, 4);
}

export type GroundKind = "grass" | "dirt" | "plain"; // the ground mask's R, G and B

/** Metres one ground detail tile covers. */
export const GROUND_TILE: Record<GroundKind, number> = { grass: 1.6, dirt: 2.4, plain: 2.0 };

/**
 * How much of each aerial photo pixel is grass (green lawn, or dry summer grass: warm, not earthy)
 * and dirt (warm and earthy: redder than dry grass); the rest is plain. Per pixel the two add to at
 * most 1. Each is softened with a 3 x 3 box blur.
 */
export function groundClasses(rgba: Pixels, width: number, height: number): { grass: Float32Array; dirt: Float32Array } {
  const n = width * height;
  const grass = new Float32Array(n), dirt = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (rgba[o + 3] === 0) continue;
    const r = rgba[o] / 255, g = rgba[o + 1] / 255, b = rgba[o + 2] / 255;
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    // Grey (roads, paving, grey roofs), deep shade, glare and blue things (water, shade on
    // bitumen) carry no class.
    const coloured = smoothstep(0.015, 0.05, hi - lo) * smoothstep(0.08, 0.16, lum) * smoothstep(0.85, 0.68, lum);
    if (coloured === 0) continue;
    // Vegetation, green or summer-dry: green at least level with blue. Tan and straw count; only
    // clearly red-brown is earth.
    const vegetal = smoothstep(-0.02, 0.02, g - b);
    const earthy = smoothstep(0.07, 0.14, r - g) * smoothstep(0.1, 0.2, r - b);
    let dw = earthy * coloured;
    let gw = vegetal * (1 - earthy) * coloured;
    const sum = gw + dw;
    if (sum > 1) { gw /= sum; dw /= sum; }
    grass[i] = gw;
    dirt[i] = dw;
  }
  return { grass: boxBlur3(grass, width, height), dirt: boxBlur3(dirt, width, height) };
}

/** A 3 x 3 box blur, done as two 3-tap passes; at the edges it averages only what's inside. */
function boxBlur3(src: Float32Array, w: number, h: number): Float32Array {
  const across = new Float32Array(src.length);
  for (let row = 0; row < h; row++) {
    const base = row * w;
    for (let col = 0; col < w; col++) {
      const lo = Math.max(0, col - 1), hi = Math.min(w - 1, col + 1);
      let acc = 0;
      for (let k = lo; k <= hi; k++) acc += src[base + k];
      across[base + col] = acc / (hi - lo + 1);
    }
  }
  const out = new Float32Array(src.length);
  for (let row = 0; row < h; row++) {
    const lo = Math.max(0, row - 1), hi = Math.min(h - 1, row + 1);
    for (let col = 0; col < w; col++) {
      let acc = 0;
      for (let k = lo; k <= hi; k++) acc += across[k * w + col];
      out[row * w + col] = acc / (hi - lo + 1);
    }
  }
  return out;
}

/**
 * The ground mask for a photo: its classes box-filtered down to at most 256 texels a side.
 * R grass, G dirt, B plain (the three add to 255), A 255.
 */
export function groundMask(rgba: Pixels, width: number, height: number): { rgba: Uint8Array; width: number; height: number } {
  const { grass, dirt } = groundClasses(rgba, width, height);
  // Each axis on its own, so a long narrow strip keeps its detail across.
  const fx = Math.max(1, Math.ceil(width / 256)), fy = Math.max(1, Math.ceil(height / 256));
  const mw = Math.ceil(width / fx), mh = Math.ceil(height / fy);
  const out = new Uint8Array(4 * mw * mh);
  for (let my = 0; my < mh; my++) {
    for (let mx = 0; mx < mw; mx++) {
      let gs = 0, ds = 0, cnt = 0;
      for (let y = my * fy; y < Math.min(height, (my + 1) * fy); y++) {
        for (let x = mx * fx; x < Math.min(width, (mx + 1) * fx); x++) {
          gs += grass[y * width + x];
          ds += dirt[y * width + x];
          cnt++;
        }
      }
      const R = Math.min(255, Math.round((gs / cnt) * 255));
      const G = Math.min(255 - R, Math.round((ds / cnt) * 255));
      const o = (my * mw + mx) * 4;
      out[o] = R;
      out[o + 1] = G;
      out[o + 2] = 255 - R - G;
      out[o + 3] = 255;
    }
  }
  return { width: mw, height: mh, rgba: out };
}

const GD = 512;

/**
 * A ground detail texture, 512 px, tiling, mid grey on average (the shader doubles it, so the
 * photo keeps its brightness from a distance). Returns RGBA pixels.
 */
export function groundDetail(kind: GroundKind): RgbaBytes {
  const px = kind === "grass" ? grassDetail() : kind === "dirt" ? dirtDetail() : plainDetail();
  // Shift to a mean luminance of 127.5, keeping any tint.
  let sum = 0;
  const n = GD * GD;
  for (let i = 0; i < n; i++) sum += 0.3 * px.r[i] + 0.59 * px.g[i] + 0.11 * px.b[i];
  const shift = 127.5 - sum / n;
  for (let i = 0; i < n; i++) px.add(i, shift);
  return px.rgba();
}

function grassDetail(): Planes {
  const r = rng(501);
  const a = valueNoise(GD, GD, 16, 502), b = valueNoise(GD, GD, 64, 503);
  const px = new Planes(GD, GD);
  // A mottled dark base: soil and shadow between the blades.
  for (let i = 0; i < GD * GD; i++) {
    const v = 58 + 34 * (a[i] - 0.5) + 22 * (b[i] - 0.5);
    px.set(i, [v * 0.96, v, v * 0.92]);
  }
  // Many short tapering blades, some dry.
  for (let k = 0; k < 30000; k++) {
    const dry = r() < 0.22;
    const bright = 0.72 + r() * 0.5;
    const c = dry ? [178 * bright, 170 * bright, 140 * bright] : [150 * bright, 164 * bright, 154 * bright];
    const len = 6 + r() * 14, ang = r() * Math.PI * 2;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const x0 = r() * GD, y0 = r() * GD;
    for (let s = 0; s < len; s += 0.7) {
      const t = s / len, w = 1.6 * (1 - t) + 0.3;
      const x = x0 + dx * s, y = y0 + dy * s;
      const alpha = Math.min(1, w) * 0.9;
      const i = wrapIndex(Math.round(y), GD) * GD + wrapIndex(Math.round(x), GD);
      px.mix(i, c, alpha);
      if (w > 1) px.mix(wrapIndex(Math.round(y - dx), GD) * GD + wrapIndex(Math.round(x + dy), GD), c, (w - 1) * 0.8);
    }
  }
  return px;
}

function dirtDetail(): Planes {
  const r = rng(510 + 1);
  const a = valueNoise(GD, GD, 5, 512), b = valueNoise(GD, GD, 18, 513), c = valueNoise(GD, GD, 64, 514);
  const lum = new Float32Array(GD * GD);
  for (let i = 0; i < lum.length; i++) lum[i] = 0.5 + 0.4 * (a[i] - 0.5) + 0.48 * (b[i] - 0.5) + 0.22 * (c[i] - 0.5) + (r() - 0.5) * 0.2;
  const at = (x: number, y: number) => wrapIndex(Math.round(y), GD) * GD + wrapIndex(Math.round(x), GD);
  // A few cracks: thin dark meandering lines.
  for (let k = 0; k < 7; k++) {
    let x = r() * GD, y = r() * GD, h = r() * Math.PI * 2;
    const len = 60 + r() * 160;
    for (let s = 0; s < len; s++) {
      lum[at(x, y)] *= 0.62;
      h += (r() - 0.5) * 0.7;
      x += Math.cos(h);
      y += Math.sin(h);
    }
  }
  // Pebbles lit from the upper left, each with a shadow to the lower right.
  for (let pebble = 0; pebble < 700; pebble++) {
    const cx = r() * GD, cy = r() * GD, rad = 1.2 + r() * 2.2, tone = 0.46 + r() * 0.16;
    const R = Math.ceil(rad) + 2;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (Math.hypot(dx - 1.2, dy - 1.2) <= rad) lum[at(cx + dx, cy + dy)] *= 0.8;
    }
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > rad) continue;
      lum[at(cx + dx, cy + dy)] = tone + 0.1 * (-(dx + dy) / (rad * Math.SQRT2));
    }
  }
  const px = new Planes(GD, GD);
  for (let i = 0; i < lum.length; i++) { const v = lum[i] * 255; px.set(i, [v, v, v]); }
  return px;
}

function plainDetail(): Planes {
  const r = rng(521);
  const a = valueNoise(GD, GD, 32, 522);
  const px = new Planes(GD, GD);
  for (let i = 0; i < GD * GD; i++) {
    const v = 127.5 + 7 * (a[i] - 0.5) + (r() - 0.5) * 11;
    px.set(i, [v, v, v]);
  }
  return px;
}

/**
 * A tangent-space normal map from a texture's brightness taken as height (DirectX convention:
 * green points down the image), wrapping at the edges. Dark cracks and edges come out as grooves.
 */
export function normalFromHeight(rgba: Pixels, width: number, height: number, strength: number): RgbaBytes {
  const h = new Float32Array(width * height);
  for (let i = 0; i < h.length; i++) h[i] = (0.3 * rgba[i * 4] + 0.59 * rgba[i * 4 + 1] + 0.11 * rgba[i * 4 + 2]) / 255;
  const out = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const up = wrapIndex(row - 1, height) * width, down = wrapIndex(row + 1, height) * width, here = row * width;
    for (let col = 0; col < width; col++) {
      const dx = (h[here + wrapIndex(col + 1, width)] - h[here + wrapIndex(col - 1, width)]) * 0.5 * strength;
      const dy = (h[down + col] - h[up + col]) * 0.5 * strength;
      // Normal = (-dh/dx, -dh/dy(down), 1), normalised; y stored as "down" for DirectX.
      const len = Math.hypot(dx, dy, 1);
      const o = (here + col) * 4;
      out[o] = toByte(128 + (-dx / len) * 127 + 0.5);
      out[o + 1] = toByte(128 + (-dy / len) * 127 + 0.5);
      out[o + 2] = toByte(128 + (1 / len) * 127 + 0.5);
      out[o + 3] = 255;
    }
  }
  return out;
}

/* ---------------- raster ---------------- */

/** A small RGBA canvas with anti-aliased thick polylines and dots, for map.png and the UI images. */
export class Raster { // map.png, outline.png and preview.png
  readonly rgba: Uint8Array;
  constructor(readonly width: number, readonly height: number, background: Rgba | readonly number[] = [0, 0, 0, 0]) {
    this.rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) for (let c = 0; c < 4; c++) this.rgba[i * 4 + c] = background[c] ?? 0;
  }

  /** A polyline `thickness` px wide; each pixel's coverage is the most any segment gives it, so joints don't double up. */
  line(points: readonly (readonly [number, number] | readonly number[])[], thickness: number, colour: Rgba | readonly number[]): void {
    if (points.length < 2) return;
    const half = thickness / 2;
    const cover = new Map<number, number>();
    for (let k = 0; k + 1 < points.length; k++) {
      const [ax, ay] = points[k], [bx, by] = points[k + 1];
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - half - 1)), x1 = Math.min(this.width - 1, Math.ceil(Math.max(ax, bx) + half + 1));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - half - 1)), y1 = Math.min(this.height - 1, Math.ceil(Math.max(ay, by) + half + 1));
      const ex = bx - ax, ey = by - ay, len2 = ex * ex + ey * ey;
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          const px = gx + 0.5, py = gy + 0.5;
          const t = len2 > 0 ? clamp01(((px - ax) * ex + (py - ay) * ey) / len2) : 0;
          const d = Math.hypot(px - (ax + ex * t), py - (ay + ey * t));
          const c = clamp01(half + 0.5 - d);
          if (c <= 0) continue;
          const i = gy * this.width + gx;
          if (c > (cover.get(i) ?? 0)) cover.set(i, c);
        }
      }
    }
    for (const [i, c] of cover) this.blend(i, colour, c);
  }

  /** A filled circle. */
  dot(x: number, y: number, radius: number, colour: Rgba | readonly number[]): void {
    const x0 = Math.max(0, Math.floor(x - radius - 1)), x1 = Math.min(this.width - 1, Math.ceil(x + radius + 1));
    const y0 = Math.max(0, Math.floor(y - radius - 1)), y1 = Math.min(this.height - 1, Math.ceil(y + radius + 1));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const c = clamp01(radius + 0.5 - Math.hypot(px + 0.5 - x, py + 0.5 - y));
        if (c > 0) this.blend(py * this.width + px, colour, c);
      }
    }
  }

  png(): PngFile {
    return toPng(this.rgba, this.width, this.height);
  }

  /** Source-over compositing of `colour` at `coverage` onto pixel i. */
  private blend(i: number, colour: Rgba | readonly number[], coverage: number): void {
    const o = i * 4, d = this.rgba;
    const sa = ((colour[3] ?? 255) / 255) * coverage, da = d[o + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (!(oa > 0)) return;
    for (let c = 0; c < 3; c++) d[o + c] = toByte((colour[c] * sa + d[o + c] * da * (1 - sa)) / oa + 0.5);
    d[o + 3] = toByte(oa * 255 + 0.5);
  }
}
