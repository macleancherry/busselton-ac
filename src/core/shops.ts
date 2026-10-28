// Shopfronts: the verandahs and awnings over the footpath that make a country
// town's main street (Queen St, Busselton), with a fascia sign, posts at the
// kerb on the deep ones, and shop windows on the ground floor.
//
// Which buildings are shops: one with a shop, café, restaurant, bank and so on
// (OpenMapTiles POIs) inside it or within a few metres, or a flat-roofed
// building built right up to the footpath, the way town-centre shops are and
// houses aren't. The front is the wall nearest a street.
//
// Signs: a shop's real name (from its OpenStreetMap POI) when the build can draw
// text (the browser passes a drawer in), otherwise made-up coloured panels with
// blocks for lettering. Never logos.

import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import type { Kn5MeshNode } from "./kn5";
import { encodePng } from "./png";
import { pad } from "./roadMesh";
import { MAX_MESH_VERTICES } from "./kn5";
import { MeshBuilder } from "./mesh";
import { fill, rng } from "./textures";
import { centroid, ringArea, type Building } from "./buildings";

/** POI classes that mean a shop front (OpenMapTiles poi layer). */
const SHOP_CLASSES = new Set([
  "shop", "grocery", "clothing_store", "restaurant", "cafe", "fast_food", "bar", "pub", "ice_cream",
  "bank", "pharmacy", "bakery", "butcher", "hairdresser", "beauty", "jewelry", "books", "gift",
  "hardware", "furniture", "electronics", "mobile_phone", "optician", "shoes", "alcohol_shop",
  "convenience", "florist", "sports", "toys", "travel_agency", "post", "library", "art_gallery",
]);

/** Verandah height above the footpath, and the deepest it reaches out, metres. */
const VERANDAH_H = 3.1;
const MAX_DEPTH = 3.2;
/** Fascia (the sign band along the verandah's edge) height, metres. */
const FASCIA = 0.55;
/** How many signs the atlas holds. */
export const SIGN_COUNT = 8;

export interface Shopfront {
  /** The front wall's corners, local metres. */
  a: Vec2;
  b: Vec2;
  /** Unit vector from the wall out to the street. */
  out: Vec2;
  /** How far the verandah reaches out over the footpath (0: no verandah, windows only). */
  depth: number;
  /** Posts along the outer edge (deep verandahs reach the kerb). */
  posts: boolean;
  /** Ground floor height, and the verandah's underside above the ground. */
  ground: number;
  under: number;
  /** Row in the sign atlas (named signs come after the SIGN_COUNT made-up ones). */
  sign: number;
  /** The shop's name, for its sign. */
  name?: string;
}

/** Draws shop names for signs: one RGBA row per name, `w` x `h` pixels, each squeezed by `squeeze[i]` across. */
export type SignDrawer = (names: { text: string; bg: [number, number, number]; ink: [number, number, number]; squeeze: number }[], w: number, h: number) => Uint8Array | Uint8ClampedArray | undefined;

/** Sign atlas size: SIGN_W wide, SIGN_H per row. */
export const SIGN_W = 1024;
export const SIGN_H = 64;
/** At most this many named signs (the rest get made-up ones). */
const MAX_NAMED = 120;

/**
 * The buildings that are shops, and their fronts. `gap(x, y)` is the distance from a point to the
 * nearest drivable edge (road or street), metres.
 */
export function findShopfronts(
  buildings: Building[],
  pois: { at: Vec2; cls: string; subclass?: string; name?: string }[],
  gap: (x: number, y: number) => number,
  ground: HeightFn,
  /** Houses only count with a shop right at them (a café in a house), not just nearby. */
  isHome: (b: Building) => boolean = () => false,
): Shopfront[] {
  const shops = pois.filter((p) => SHOP_CLASSES.has(p.cls) || SHOP_CLASSES.has(p.subclass ?? ""));
  const rand = rng(77);
  const out: Shopfront[] = [];
  const centres: [Vec2, number][] = [];
  for (const b of buildings) {
    if (b.ring.length < 4) continue;
    const ring = ringArea(b.ring) < 0 ? b.ring.slice().reverse() : b.ring;
    const area = Math.abs(ringArea(ring));
    if (area < 40) continue;
    const c = centroid(ring);
    // The street-facing wall: the longest-enough edge closest to a street.
    let best = -1, bestGap = Infinity;
    for (let k = 0; k < ring.length; k++) {
      const p = ring[k], q = ring[(k + 1) % ring.length];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 4) continue;
      const g = gap((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      if (g < bestGap) [best, bestGap] = [k, g];
    }
    if (best < 0 || bestGap > 9) continue;
    const reach = Math.sqrt(area) / 2 + (isHome(b) ? 2 : 8);
    const hasShop = shops.some((s) => Math.hypot(s.at[0] - c[0], s.at[1] - c[1]) < reach);
    // Built to the footpath with a flat roof: a town-centre shop even without a POI.
    const toBoundary = !isHome(b) && b.roof === "flat" && bestGap < 4.5 && area > 60;
    if (!hasShop && !toBoundary) continue;
    const a = ring[best], q = ring[(best + 1) % ring.length];
    const L = Math.hypot(q[0] - a[0], q[1] - a[1]);
    // Counter-clockwise ring: outward is to the right of a->q.
    const o: Vec2 = [(q[1] - a[1]) / L, -(q[0] - a[0]) / L];
    // Stop short of the kerb; under a metre of room, just the windows.
    const room = bestGap - 0.6;
    const depth = room < 1 ? 0 : Math.min(MAX_DEPTH, room);
    const g = Math.min(ground(a[0], a[1]), ground(q[0], q[1]));
    out.push({
      a, b: q, out: o, depth, posts: depth >= 2.4, ground: g,
      under: Math.min(VERANDAH_H, Math.max(2.6, b.height - 0.4)),
      sign: Math.floor(rand() * SIGN_COUNT),
    });
    centres.push([c, reach]);
  }
  // Names: each named shop goes on the sign of the nearest front it's within reach of, one name per
  // front (the closest shop wins), and only fronts with a verandah carry a sign.
  const claims: { f: number; d: number; name: string }[] = [];
  for (const s of shops) {
    const name = s.name?.trim();
    if (!name) continue;
    let best = -1, bestD = Infinity;
    out.forEach((f, i) => {
      const [c, reach] = centres[i];
      const d = Math.hypot(s.at[0] - c[0], s.at[1] - c[1]);
      if (f.depth > 0 && d < reach && d < bestD) [best, bestD] = [i, d];
    });
    if (best >= 0) claims.push({ f: best, d: bestD, name });
  }
  claims.sort((x, y) => x.d - y.d);
  let named = 0;
  for (const c of claims) {
    if (out[c.f].name || named >= MAX_NAMED) continue;
    out[c.f].name = c.name;
    out[c.f].sign = SIGN_COUNT + named++;
  }
  return out;
}

/** Verandahs (roof, fascia sign, posts) and shop windows. All visual: nothing to drive into. */
/** Mesh builders that start a new mesh before the vertex limit; normals worked out from the faces. */
class Chunks {
  readonly done: MeshBuilder[] = [];
  private cur = new MeshBuilder();
  next(n: number): MeshBuilder {
    if (this.cur.vertexCount + n > MAX_MESH_VERTICES) {
      this.done.push(this.cur);
      this.cur = new MeshBuilder();
    }
    return this.cur;
  }
  all(): MeshBuilder[] {
    return [...this.done, this.cur].filter((m) => m.indices.length > 0);
  }
}

export function buildShopfronts(fronts: Shopfront[]): Kn5MeshNode[] {
  const roof = new Chunks(), fascia = new Chunks(), posts = new Chunks(), glass = new Chunks();
  const rows = signRows(fronts);
  for (const f of fronts) {
    const [a, b, o] = [f.a, f.b, f.out];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const e: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const at = (p: Vec2, t: number, d: number): Vec2 => [p[0] + e[0] * t + o[0] * d, p[1] + e[1] * t + o[1] * d];
    // Shop windows: one glazed band across the ground floor, just proud of the wall.
    {
      const mb = glass.next(8);
      const i = mb.vertexCount;
      const z0 = f.ground + 0.35, z1 = f.ground + Math.min(f.under - 0.2, 2.8);
      const t0 = Math.min(0.4, L * 0.05), t1 = L - t0;
      const p0 = at(a, t0, 0.05), p1 = at(a, t1, 0.05);
      const reps = Math.max(1, Math.round((t1 - t0) / 4));
      mb.vertex([p0[0], p0[1], z0], 0, 1);
      mb.vertex([p1[0], p1[1], z0], reps, 1);
      mb.vertex([p1[0], p1[1], z1], reps, 0);
      mb.vertex([p0[0], p0[1], z1], 0, 0);
      mb.quad(i, i + 1, i + 2, i + 3);
    }
    if (f.depth <= 0) continue;
    const zU = f.ground + f.under, zT = zU + 0.18;
    // Verandah roof: a slab from the wall out over the footpath, falling a little to the street.
    {
      const mb = roof.next(16);
      const i = mb.vertexCount;
      const w0 = at(a, 0, 0), w1 = at(a, L, 0), s0 = at(a, 0, f.depth), s1 = at(a, L, f.depth);
      const v = f.depth / 2, uL = L / 2;
      // Top (faces up), then underside (faces down).
      mb.vertex([w0[0], w0[1], zT + 0.12], 0, 0);
      mb.vertex([w1[0], w1[1], zT + 0.12], uL, 0);
      mb.vertex([s1[0], s1[1], zT], uL, v);
      mb.vertex([s0[0], s0[1], zT], 0, v);
      mb.quad(i, i + 3, i + 2, i + 1);
      mb.vertex([w0[0], w0[1], zU + 0.12], 0, 0);
      mb.vertex([w1[0], w1[1], zU + 0.12], uL, 0);
      mb.vertex([s1[0], s1[1], zU], uL, v);
      mb.vertex([s0[0], s0[1], zU], 0, v);
      mb.quad(i + 4, i + 5, i + 6, i + 7);
    }
    // Fascia: the sign band along the outer edge, facing the street, from the roof's top down.
    {
      const mb = fascia.next(16);
      const i = mb.vertexCount;
      const s0 = at(a, 0, f.depth + 0.02), s1 = at(a, L, f.depth + 0.02);
      const v0 = f.sign / rows, v1 = (f.sign + 1) / rows;
      mb.vertex([s0[0], s0[1], zT + 0.08], 0, v0);
      mb.vertex([s1[0], s1[1], zT + 0.08], 1, v0);
      mb.vertex([s1[0], s1[1], zT + 0.08 - FASCIA], 1, v1);
      mb.vertex([s0[0], s0[1], zT + 0.08 - FASCIA], 0, v1);
      // Faces out (to the street): counter-clockwise seen from outside.
      mb.quad(i, i + 3, i + 2, i + 1);
      // The back of the fascia, plain (sign's edge colour row), facing the shop.
      mb.vertex([s0[0], s0[1], zT + 0.08], 0.01, v0 + 0.002);
      mb.vertex([s1[0], s1[1], zT + 0.08], 0.01, v0 + 0.002);
      mb.vertex([s1[0], s1[1], zT + 0.08 - FASCIA], 0.01, v0 + 0.002);
      mb.vertex([s0[0], s0[1], zT + 0.08 - FASCIA], 0.01, v0 + 0.002);
      mb.quad(i + 4, i + 5, i + 6, i + 7);
    }
    // Posts at the outer edge, about every 4 m, square steel.
    if (f.posts) {
      const n = Math.max(2, Math.round(L / 4) + 1);
      for (let k = 0; k < n; k++) {
        const t = 0.3 + ((L - 0.6) * k) / (n - 1);
        const c = at(a, t, f.depth - 0.15);
        const mb = posts.next(16);
        const r = 0.05;
        const i = mb.vertexCount;
        const cs: Vec2[] = [[-r, -r], [r, -r], [r, r], [-r, r]];
        for (const [dx, dy] of cs) {
          mb.vertex([c[0] + dx, c[1] + dy, f.ground - 0.1], 0, 1);
          mb.vertex([c[0] + dx, c[1] + dy, zU], 0, 0);
        }
        for (let s = 0; s < 4; s++) {
          const p = i + s * 2, q = i + ((s + 1) % 4) * 2;
          mb.quad(p, q, q + 1, p + 1);
        }
      }
    }
  }
  const out: Kn5MeshNode[] = [];
  const emit = (cm: Chunks, name: string, mat: string) =>
    cm.all().forEach((mb, i) => out.push(mb.toKn5(`${name}_${pad(i)}`, mat)));
  emit(roof, "SHOP_VERANDAH", "verandah");
  emit(fascia, "SHOP_SIGN", "shop_sign");
  emit(posts, "SHOP_POST", "steel");
  emit(glass, "SHOP_WINDOW", "shop_window");
  return out;
}

/** Rows in the sign atlas: the made-up signs, then one per named front. */
export function signRows(fronts: Shopfront[]): number {
  return Math.max(SIGN_COUNT, ...fronts.map((f) => f.sign + 1));
}

const PALETTE: [number, number, number][] = [
  [176, 38, 42], [24, 64, 120], [30, 110, 70], [236, 236, 228], [32, 32, 36], [210, 150, 40], [120, 40, 110], [20, 120, 140],
];
const inkOn = (bg: [number, number, number]): [number, number, number] => (bg[0] + bg[1] + bg[2] > 450 ? [30, 30, 34] : [245, 243, 236]);
const hash = (t: string) => [...t].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

/**
 * The sign atlas: eight made-up signs (a coloured panel with blocks of "lettering"), then the named
 * shops' signs drawn by `draw` (a made-up sign in their place without one).
 */
export function shopSignTexture(fronts: Shopfront[] = [], draw?: SignDrawer): Uint8Array {
  const w = SIGN_W, h = SIGN_H * signRows(fronts);
  const r = rng(91);
  const signs = Array.from({ length: SIGN_COUNT }, (_, k) => {
    const bg = PALETTE[k % PALETTE.length];
    const ink = inkOn(bg);
    // Words: runs of letter blocks, centred.
    const words: [number, number][] = [];
    let x = 0;
    const nWords = 1 + Math.floor(r() * 3);
    for (let i = 0; i < nWords; i++) {
      const len = 3 + Math.floor(r() * 6);
      words.push([x, len]);
      x += len + 1.5;
    }
    return { bg, ink, words, total: x - 1.5, tall: 0.5 + r() * 0.15 };
  });
  const named = fronts.filter((f) => f.name && f.sign >= SIGN_COUNT).sort((a, b) => a.sign - b.sign);
  const L = (f: Shopfront) => Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
  const jobs = named.map((f) => {
    const bg = PALETTE[hash(f.name!) % PALETTE.length];
    // The row is stretched over the fascia: L metres across, FASCIA up. Square letters need the
    // text squeezed across by the inverse.
    return { text: f.name!, bg, ink: inkOn(bg), squeeze: Math.min(1, (FASCIA / SIGN_H) / (L(f) / SIGN_W)) };
  });
  const drawn = jobs.length && draw ? draw(jobs, w, SIGN_H) : undefined;
  const fallback = named.map((f) => hash(f.name!) % SIGN_COUNT);
  return encodePng(fill(w, h, (x, y) => {
    let k = Math.floor(y / SIGN_H);
    const ly = y % SIGN_H;
    if (k >= SIGN_COUNT) {
      const n = k - SIGN_COUNT;
      if (drawn) {
        const i = ((n * SIGN_H + ly) * w + x) * 4;
        return [drawn[i], drawn[i + 1], drawn[i + 2]];
      }
      k = fallback[n];
    }
    const s = signs[k];
    // Border.
    if (ly < 3 || ly > 60 || x < 3 || x > w - 4) return [s.ink[0] * 0.6 + s.bg[0] * 0.4, s.ink[1] * 0.6 + s.bg[1] * 0.4, s.ink[2] * 0.6 + s.bg[2] * 0.4];
    // Letters: blocks 14 px wide with 4 px gaps, in the middle of the panel.
    const unit = 18;
    const x0 = w / 2 - (s.total * unit) / 2;
    const top = 32 - (64 * s.tall) / 2, bot = 32 + (64 * s.tall) / 2;
    if (ly > top && ly < bot) {
      const ux = (x - x0) / unit;
      for (const [start, len] of s.words) {
        if (ux >= start && ux < start + len && (x - x0) % unit < 14) {
          // A gap through some letters, so blocks read as characters.
          const col = Math.floor(ux), mid = (ly - top) / (bot - top);
          if ((col * 7) % 3 === 0 && mid > 0.4 && mid < 0.6 && (x - x0) % unit > 5 && (x - x0) % unit < 9) break;
          return s.ink;
        }
      }
    }
    return s.bg;
  }), w, h);
}

/** Shop windows, 4 m wide by the ground floor's height: glass with frames, a door, and things on display. */
export function shopWindowTexture(): Uint8Array {
  const w = 256, h = 160;
  const r = rng(13);
  const goods = Array.from({ length: 30 }, () => ({ x: r() * w, y: 90 + r() * 60, rw: 6 + r() * 18, rh: 6 + r() * 24, c: [80 + r() * 150, 80 + r() * 150, 80 + r() * 150] as [number, number, number] }));
  return encodePng(fill(w, h, (x, y) => {
    const frame: [number, number, number] = [52, 54, 58];
    // Frames: border, a mullion, a transom, and a door on the right.
    if (x < 4 || x > w - 5 || y < 4 || y > h - 5) return frame;
    if (Math.abs(x - 96) < 3 || Math.abs(y - 34) < 2) return frame;
    if (x > 180 && x < 236) {
      if (Math.abs(x - 182) < 3 || Math.abs(x - 234) < 3) return frame;
      if (y > 40 && Math.abs(x - 228) < 2 && Math.abs(y - 100) < 10) return [180, 182, 186];
    }
    for (const g of goods) {
      if (x > g.x && x < g.x + g.rw && y > g.y - g.rh && y < g.y && !(x > 180 && x < 236)) return [g.c[0] * 0.55, g.c[1] * 0.55, g.c[2] * 0.55];
    }
    // Glass: dark, with a light reflection band.
    const refl = Math.max(0, 1 - Math.abs((x * 0.6 + y) - 120) / 50) * 40;
    return [38 + refl, 46 + refl, 54 + refl];
  }), w, h);
}

/** Built shopfront counts, for the build's stats. */
export function shopStats(fronts: Shopfront[]): { shops: number; verandahs: number; named: number } {
  return { shops: fronts.length, verandahs: fronts.filter((f) => f.depth > 0).length, named: fronts.filter((f) => f.name).length };
}

