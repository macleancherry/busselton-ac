// Busselton fork: houses along street frontages, read from the aerial photo (docs/specs/frontage.md).
//
// A suburb has a house on nearly every lot, a few metres back from the street. Rather than pick roof
// patches out of the photo on their own, this walks each side of each street a metre at a time,
// reads a column of 1 m cells back from the kerb line, and takes the first solid run of roof as that
// column's front and back. Columns are smoothed and split into houses where the roof stops, the back
// line jumps or the roof colour changes; each house is a box square to the street.
//
// Frame: local metres, x east, y north. Footprints only, no heights.

import type { Vec2 } from "./geo";
import type { TerrainChunk } from "./terrain";
import { centroid, houseRoof, nearestRoofColour, plainHouse, pointInRing, type Building } from "./buildings";
import { placeRandom } from "./random";

/** Photo colour at a local point, channels 0..1; null where there's no photo. */
export type PhotoSampler = (x: number, y: number) => [number, number, number] | null;

/** A street centreline and half its width at each point. */
export interface Frontage {
  pts: Vec2[];
  half: number[];
}

type RGB = [number, number, number];

const SALT_ROOF = 0xf0a0;
const SALT_GARAGE = 0xf0a1;

// ---------------------------------------------------------------------------------------------
// Photo

/** A nearest-pixel sampler over the terrain chunks' aerial images (row 0 at each chunk's north edge). */
export function chunkPhotoSampler(images: { chunk: TerrainChunk; rgba: Uint8Array | Uint8ClampedArray; size: number }[]): PhotoSampler | null {
  if (!images.length) return null;
  const span = images[0].chunk.maxX - images[0].chunk.minX;
  if (!(span > 0)) return null;
  const byCell = new Map<string, (typeof images)[number]>();
  for (const im of images) byCell.set(`${Math.round(im.chunk.minX / span)},${Math.round(im.chunk.minY / span)}`, im);
  return (x, y) => {
    const im = byCell.get(`${Math.floor(x / span)},${Math.floor(y / span)}`);
    if (!im) return null;
    const { chunk, rgba, size } = im;
    const px = Math.floor(((x - chunk.minX) / span) * size);
    const py = Math.floor(((chunk.maxY - y) / span) * size);
    if (px < 0 || py < 0 || px >= size || py >= size) return null;
    const i = (py * size + px) * 4;
    return [rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255];
  };
}

/** Could this photo colour be a roof? Rules out lawn and trees, water, deep shade, dry grass and earth. */
export function roofLike(rgb: RGB): boolean {
  const [r, g, b] = rgb;
  const l = (r + g + b) / 3;
  const sum = r + g + b + 0.0001;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max > 0 ? (max - min) / max : 0;
  if ((2 * g - r - b) / sum > 0.025) return false;
  if (b > 1.1 * r && b > g && sat > 0.25) return false;
  if (l < 0.13) return false;
  if (l > 0.33 && r > 1.25 * b && g > 1.15 * b && r < 1.25 * g && sat > 0.18) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Columns

interface Sample {
  pos: Vec2;
  tan: Vec2;
  half: number;
}

interface Column extends Sample {
  /** Metres from the kerb line to the roof's front and back, and its mean colour; absent when not valid. */
  front?: number;
  back?: number;
  colour?: RGB;
}

/** Points every 1 m of true arc length along the street (the first is its first point). */
function resample(st: Frontage): Sample[] {
  const out: Sample[] = [];
  if (st.pts.length < 2) return out;
  let cum = 0, k = 0;
  for (let i = 0; i + 1 < st.pts.length; i++) {
    const a = st.pts[i], b = st.pts[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ha = st.half[i] ?? st.half[st.half.length - 1] ?? 0;
    const hb = st.half[i + 1] ?? ha;
    const tan: Vec2 = [dx / len, dy / len];
    while (k <= cum + len + 1e-9) {
      const t = Math.min(1, (k - cum) / len);
      out.push({ pos: [a[0] + dx * t, a[1] + dy * t], tan, half: ha + (hb - ha) * t });
      k++;
    }
    cum += len;
  }
  return out;
}

function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function meanColour(list: (RGB | undefined | null)[]): RGB | null {
  let r = 0, g = 0, b = 0, n = 0;
  for (const c of list) {
    if (!c) continue;
    r += c[0];
    g += c[1];
    b += c[2];
    n++;
  }
  return n ? [r / n, g / n, b / n] : null;
}

/** Read one column: from 3 m to 28 m past the kerb line, the first solid run of roof. */
function readColumn(s: Sample, side: number, photo: PhotoSampler, onRoad: (x: number, y: number) => boolean, builtUp: (x: number, y: number) => boolean): Column {
  const col: Column = { ...s };
  if (!builtUp(s.pos[0], s.pos[1])) return col;
  const ox = -s.tan[1] * side, oy = s.tan[0] * side;
  let k0 = -1, k1 = -1, misses = 0;
  const colours: RGB[] = [];
  for (let k = 3; k <= 28; k++) {
    const d = s.half + k;
    const cx = s.pos[0] + ox * d, cy = s.pos[1] + oy * d;
    if (onRoad(cx, cy)) break;
    const samples: (RGB | null)[] = [];
    for (const a of [-0.25, 0.25]) {
      for (const b of [-0.25, 0.25]) samples.push(photo(cx + s.tan[0] * a + ox * b, cy + s.tan[1] * a + oy * b));
    }
    const c = meanColour(samples);
    if (c && roofLike(c)) {
      if (k0 < 0) {
        if (k > 14) break; // a front must be within 14 m of the kerb line
        k0 = k;
      }
      k1 = k;
      misses = 0;
      colours.push(c);
    } else if (k0 >= 0) {
      if (++misses >= 2) break;
    }
  }
  if (k0 >= 0 && k1 - k0 >= 6) {
    col.front = k0;
    col.back = k1;
    col.colour = meanColour(colours)!;
  }
  return col;
}

// ---------------------------------------------------------------------------------------------
// Taken test, on a grid

const GRID = 32;

class Taken {
  private readonly rings: Vec2[][] = [];
  private readonly mids: Vec2[] = [];
  private readonly byBox = new Map<string, number[]>(); // every cell a ring's bounding box touches
  private readonly byMid = new Map<string, number[]>(); // the cell of a ring's centroid

  add(ring: Vec2[]): void {
    const i = this.rings.length;
    const mid = centroid(ring);
    this.rings.push(ring);
    this.mids.push(mid);
    file(this.byMid, `${Math.floor(mid[0] / GRID)},${Math.floor(mid[1] / GRID)}`, i);
    eachCell(ring, (key) => file(this.byBox, key, i));
  }

  /** Is the box's centroid inside a known ring, or a known centroid inside the box? */
  hit(ring: Vec2[]): boolean {
    const [mx, my] = centroid(ring);
    const near = this.byBox.get(`${Math.floor(mx / GRID)},${Math.floor(my / GRID)}`) ?? [];
    if (near.some((i) => pointInRing(mx, my, this.rings[i]))) return true;
    let found = false;
    eachCell(ring, (key) => {
      if (!found) found = (this.byMid.get(key) ?? []).some((i) => pointInRing(this.mids[i][0], this.mids[i][1], ring));
    });
    return found;
  }
}

function file(map: Map<string, number[]>, key: string, i: number): void {
  const list = map.get(key);
  if (list) list.push(i);
  else map.set(key, [i]);
}

function eachCell(ring: Vec2[], fn: (key: string) => void): void {
  if (!ring.length) return;
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs) / GRID), x1 = Math.floor(Math.max(...xs) / GRID);
  const y0 = Math.floor(Math.min(...ys) / GRID), y1 = Math.floor(Math.max(...ys) / GRID);
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) fn(`${cx},${cy}`);
}

// ---------------------------------------------------------------------------------------------
// Houses

/** The house box for one lot's columns, or null. */
function houseBox(cols: Column[], side: number): Building | null {
  const valid = cols.filter((c) => c.front !== undefined);
  if (valid.length < 5) return null;
  const front = median(valid.map((c) => c.front!));
  const back = Math.min(median(valid.map((c) => c.back!)), front + 22);
  if (back - front < 6) return null;
  const first = cols[0].pos, last = cols[cols.length - 1].pos;
  const cl = Math.hypot(last[0] - first[0], last[1] - first[1]);
  if (cl < 5) return null;
  const t: Vec2 = [(last[0] - first[0]) / cl, (last[1] - first[1]) / cl];
  const o: Vec2 = [-t[1] * side, t[0] * side];
  const mid = cols[Math.floor(cols.length / 2)];
  const proj = (p: Vec2) => (p[0] - mid.pos[0]) * t[0] + (p[1] - mid.pos[1]) * t[1];
  const s0 = proj(first), s1 = proj(last);
  const f0 = mid.half + front, f1 = mid.half + back;
  const at = (s: number, f: number): Vec2 => [mid.pos[0] + t[0] * s + o[0] * f, mid.pos[1] + t[1] * s + o[1] * f];
  const corners: Vec2[] = [at(s0, f0), at(s1, f0), at(s1, f1), at(s0, f1)];
  const frontEdge: [Vec2, Vec2] = [corners[0], corners[1]];
  const ring = side < 0 ? corners.slice().reverse() : corners;
  const c = meanColour(valid.map((v) => v.colour))!;
  const fm: Vec2 = [(frontEdge[0][0] + frontEdge[1][0]) / 2, (frontEdge[0][1] + frontEdge[1][1]) / 2];
  const shape = houseRoof(() => placeRandom(fm[0], fm[1], SALT_ROOF));
  const width = s1 - s0;
  const height = width * (back - front) > 250 ? 3.6 : 2.8;
  return {
    ...plainHouse(shape, nearestRoofColour([c[0] * 255, c[1] * 255, c[2] * 255]), height),
    ring,
    source: "frontage",
    front: frontEdge,
    setback: front,
    garage: width >= 8 && placeRandom(fm[0], fm[1], SALT_GARAGE) < 0.5,
  };
}

/** The houses read off one side of one street, in order along it. */
function sideHouses(cols: Column[], taken: Taken, out: Building[], side: number): void {
  const n = cols.length;
  if (!n) return;
  const window = (i: number, r: number) => {
    const list: Column[] = [];
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) if (cols[j].front !== undefined) list.push(cols[j]);
    return list;
  };
  const okS: boolean[] = [], back: number[] = [], colour: (RGB | null)[] = [];
  for (let i = 0; i < n; i++) {
    const w2 = window(i, 2);
    okS.push(w2.length * 2 > Math.min(n, i + 3) - Math.max(0, i - 2));
    back.push(median(window(i, 3).map((c) => c.back!)));
    colour.push(w2.length ? [0, 1, 2].map((ch) => median(w2.map((c) => c.colour![ch]))) as RGB : null);
  }
  const change: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = meanColour(colour.slice(Math.max(0, i - 3), i));
    const b = meanColour(colour.slice(i, Math.min(n, i + 3)));
    if (!a || !b) {
      change.push(0);
      continue;
    }
    const la = (a[0] + a[1] + a[2]) / 3, lb = (b[0] + b[1] + b[2]) / 3;
    const ratio = Math.max(la, lb) / Math.max(0.001, Math.min(la, lb));
    change.push(Math.max(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 0.1, (ratio - 1) / 0.35));
  }

  const close = (a: number | null, b: number) => {
    if (a === null) return;
    const count = b - a + 1;
    if (count < 7) return;
    const lots = count > 24 ? Math.round(count / 15) : 1;
    for (let k = 0; k < lots; k++) {
      const from = a + Math.round((k * count) / lots), to = a + Math.round(((k + 1) * count) / lots) - 1;
      const house = houseBox(cols.slice(from, to + 1), side);
      if (!house || taken.hit(house.ring)) continue;
      taken.add(house.ring);
      out.push(house);
    }
  };

  let start: number | null = null;
  for (let i = 0; i < n; i++) {
    if (!okS[i]) {
      close(start, i - 1);
      start = null;
      continue;
    }
    if (start === null) {
      start = i;
      continue;
    }
    const peak = change[i] >= 1 && change[i] >= change[i - 1] && change[i] > (i + 1 < n ? change[i + 1] : 0);
    const step = Math.abs(back[i] - back[i - 1]) > 3; // false when either is NaN
    if (peak || step) {
      close(start, i - 1);
      start = i;
    }
  }
  close(start, n - 1);
}

/**
 * Houses along the streets where the photo shows roofs, square to the street. `existing` buildings
 * block boxes over them. `seed` is accepted for callers and ignored: draws come from each house's
 * position.
 */
export function frontageHouses(
  streets: Frontage[],
  photo: PhotoSampler,
  onRoad: (x: number, y: number) => boolean,
  builtUp: (x: number, y: number) => boolean,
  existing: Building[],
  _seed = 1,
): Building[] {
  const taken = new Taken();
  for (const b of existing) taken.add(b.ring);
  const out: Building[] = [];
  for (const st of streets) {
    const samples = resample(st);
    for (const side of [1, -1]) {
      const cols = samples.map((s) => readColumn(s, side, photo, onRoad, builtUp));
      sideHouses(cols, taken, out, side);
    }
  }
  return out;
}
