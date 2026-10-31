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
import { SINK } from "./sceneGround";
import { slopeSteps } from "./slopeSteps";

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
  /**
   * On a slope (slopeSteps.ts): the front in steps along the wall (t0..t1 metres from `a`), each
   * with its own ground floor (the lowest ground along its wall) and verandah underside above it.
   * Absent: one step, `ground` and `under`.
   */
  steps?: { t0: number; t1: number; ground: number; under: number }[];
  /** Each post's foot (postSpots order), on the building's own ground. Absent: the ground passed to buildShopfronts. */
  feet?: number[];
}

/** How far a verandah's underside stays above the highest footpath under it, metres. */
const CLEAR = 2.3;

/** Where the posts go along a front `len` metres long: about every 4 m, 0.3 m in from each end. */
export function postSpots(len: number): number[] {
  const n = Math.max(2, Math.round(len / 4) + 1);
  return Array.from({ length: n }, (_, k) => 0.3 + ((len - 0.6) * k) / (n - 1));
}

/**
 * Steps a front down a slope (slopeSteps.ts) when its ground varies by more than a step's rise, or
 * the footpath under its verandah comes up within CLEAR of it. `g` is the building's ground, `og`
 * the ground out over the footpath (defaults to `g`).
 */
function stepFront(f: Shopfront, g: HeightFn, og: HeightFn = g): void {
  const L = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
  const e: Vec2 = [(f.b[0] - f.a[0]) / L, (f.b[1] - f.a[1]) / L];
  const at = (t: number, d: number): Vec2 => [f.a[0] + e[0] * t + f.out[0] * d, f.a[1] + e[1] * t + f.out[1] * d];
  const wall = (t: number) => g(...at(t, 0));
  const sample = (t: number) => (f.depth > 0 ? [wall(t), og(...at(t, f.depth - 0.15)), og(...at(t, f.depth))] : [wall(t)]);
  const steps = slopeSteps(L, sample);
  if (steps.length === 1 && (f.depth <= 0 || f.ground + f.under >= steps[0].hi + CLEAR)) return;
  f.steps = steps.map((s) => {
    let lo = Infinity;
    const n = Math.max(1, Math.ceil((s.t1 - s.t0) / 0.5));
    for (let i = 0; i <= n; i++) lo = Math.min(lo, wall(s.t0 + ((s.t1 - s.t0) * i) / n));
    // One step (a flat front with a high footpath): keep the front's own ground floor.
    const ground = steps.length === 1 ? Math.min(f.ground, lo) : lo;
    const zU = Math.max(ground + f.under, s.hi + CLEAR);
    return { t0: s.t0, t1: s.t1, ground, under: zU - ground };
  });
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
  /**
   * The ground a building stands on, as buildBuildings gets it (track.ts: the base's mesh, held up
   * to the mesh's lowest round the footprint where a corner is past its edge). A shop front on
   * `ground` point by point took the analytic terrain or the horizon for a corner past the mesh's
   * edge and sank metres under the rest of its building.
   */
  groundFor?: (b: Building) => HeightFn,
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
    const gb = groundFor?.(b) ?? ground;
    // Out over the footpath: never under the scene's own ground there. A building past the terrain
    // mesh stands on the horizon, metres under the mesh its verandah reaches out over (Augusta,
    // Dunsborough: verandahs, signs and posts 1 to 5 m under the footpath).
    const og: HeightFn = groundFor ? (x, y) => Math.max(gb(x, y), ground(x, y)) : ground;
    const f: Shopfront = {
      a, b: q, out: o, depth, posts: depth >= 2.4, ground: Math.min(gb(a[0], a[1]), gb(q[0], q[1])),
      under: Math.min(VERANDAH_H, Math.max(2.6, b.height - 0.4)),
      sign: Math.floor(rand() * SIGN_COUNT),
    };
    stepFront(f, gb, og);
    if (f.posts && groundFor) f.feet = postSpots(L).map((t) => og(a[0] + ((q[0] - a[0]) * t) / L + o[0] * (depth - 0.15), a[1] + ((q[1] - a[1]) * t) / L + o[1] * (depth - 0.15)) - SINK);
    out.push(f);
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

/** `ground` (sceneGround.ts) is what the verandah posts stand on, out over the footpath. */
export function buildShopfronts(fronts: Shopfront[], ground: HeightFn): Kn5MeshNode[] {
  const roof = new Chunks(), fascia = new Chunks(), posts = new Chunks(), glass = new Chunks();
  const rows = signRows(fronts);
  for (const f of fronts) {
    const [a, b, o] = [f.a, f.b, f.out];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const e: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const at = (p: Vec2, t: number, d: number): Vec2 => [p[0] + e[0] * t + o[0] * d, p[1] + e[1] * t + o[1] * d];
    // One step on the level; on a slope each step has its own ground floor and verandah height.
    const steps = f.steps ?? [{ t0: 0, t1: L, ground: f.ground, under: f.under }];
    // Shop windows: one glazed band across each step's ground floor, just proud of the wall.
    const inset = Math.min(0.4, L * 0.05);
    for (const st of steps) {
      const t0 = Math.max(st.t0, inset), t1 = Math.min(st.t1, L - inset);
      if (t1 - t0 < 0.3) continue;
      const mb = glass.next(8);
      const i = mb.vertexCount;
      const z0 = st.ground + 0.35, z1 = st.ground + Math.min(st.under - 0.2, 2.8);
      const p0 = at(a, t0, 0.05), p1 = at(a, t1, 0.05);
      const reps = Math.max(1, Math.round((t1 - t0) / 4));
      mb.vertex([p0[0], p0[1], z0], 0, 1);
      mb.vertex([p1[0], p1[1], z0], reps, 1);
      mb.vertex([p1[0], p1[1], z1], reps, 0);
      mb.vertex([p0[0], p0[1], z1], 0, 0);
      mb.quad(i, i + 1, i + 2, i + 3);
    }
    if (f.depth <= 0) continue;
    const zUs = steps.map((st) => st.ground + st.under);
    steps.forEach((st, k) => {
      const zU = zUs[k], zT = zU + 0.18;
      // Verandah roof: a slab from the wall out over the footpath, falling a little to the street.
      {
        const mb = roof.next(16);
        const i = mb.vertexCount;
        const w0 = at(a, st.t0, 0), w1 = at(a, st.t1, 0), s0 = at(a, st.t0, f.depth), s1 = at(a, st.t1, f.depth);
        const v = f.depth / 2, u0 = st.t0 / 2, u1 = st.t1 / 2;
        // Top (faces up), then underside (faces down).
        mb.vertex([w0[0], w0[1], zT + 0.12], u0, 0);
        mb.vertex([w1[0], w1[1], zT + 0.12], u1, 0);
        mb.vertex([s1[0], s1[1], zT], u1, v);
        mb.vertex([s0[0], s0[1], zT], u0, v);
        mb.quad(i, i + 3, i + 2, i + 1);
        mb.vertex([w0[0], w0[1], zU + 0.12], u0, 0);
        mb.vertex([w1[0], w1[1], zU + 0.12], u1, 0);
        mb.vertex([s1[0], s1[1], zU], u1, v);
        mb.vertex([s0[0], s0[1], zU], u0, v);
        mb.quad(i + 4, i + 5, i + 6, i + 7);
      }
      // Where it steps, an upright closing the gap between this slab and the next, both faces.
      if (k + 1 < steps.length && Math.abs(zUs[k + 1] - zU) > 0.01) {
        const mb = roof.next(8);
        const i = mb.vertexCount;
        const z0 = Math.min(zU, zUs[k + 1]), z1 = Math.max(zU, zUs[k + 1]) + 0.3;
        const w = at(a, st.t1, 0), s = at(a, st.t1, f.depth);
        // Each face its own corners, so their normals don't cancel.
        for (let side = 0; side < 2; side++) {
          mb.vertex([w[0], w[1], z0], 0, z0 / 2);
          mb.vertex([s[0], s[1], z0], f.depth / 2, z0 / 2);
          mb.vertex([s[0], s[1], z1], f.depth / 2, z1 / 2);
          mb.vertex([w[0], w[1], z1], 0, z1 / 2);
        }
        mb.quad(i, i + 1, i + 2, i + 3);
        mb.quad(i + 4, i + 7, i + 6, i + 5);
      }
      // Fascia: the sign band along the outer edge, facing the street, from the roof's top down.
      // The sign runs on across the steps (u is the share of the front's length).
      {
        const mb = fascia.next(16);
        const i = mb.vertexCount;
        const s0 = at(a, st.t0, f.depth + 0.02), s1 = at(a, st.t1, f.depth + 0.02);
        const v0 = f.sign / rows, v1 = (f.sign + 1) / rows;
        const u0 = st.t0 / L, u1 = st.t1 / L;
        mb.vertex([s0[0], s0[1], zT + 0.08], u0, v0);
        mb.vertex([s1[0], s1[1], zT + 0.08], u1, v0);
        mb.vertex([s1[0], s1[1], zT + 0.08 - FASCIA], u1, v1);
        mb.vertex([s0[0], s0[1], zT + 0.08 - FASCIA], u0, v1);
        // Faces out (to the street): counter-clockwise seen from outside.
        mb.quad(i, i + 3, i + 2, i + 1);
        // The back of the fascia, plain (sign's edge colour row), facing the shop.
        mb.vertex([s0[0], s0[1], zT + 0.08], 0.01, v0 + 0.002);
        mb.vertex([s1[0], s1[1], zT + 0.08], 0.01, v0 + 0.002);
        mb.vertex([s1[0], s1[1], zT + 0.08 - FASCIA], 0.01, v0 + 0.002);
        mb.vertex([s0[0], s0[1], zT + 0.08 - FASCIA], 0.01, v0 + 0.002);
        mb.quad(i + 4, i + 5, i + 6, i + 7);
      }
    });
    // Posts at the outer edge, about every 4 m, square steel: each from its own ground up to its
    // step's verandah (the higher one where it stands right at a step).
    if (f.posts) {
      postSpots(L).forEach((t, k) => {
        const c = at(a, t, f.depth - 0.15);
        let zU = -Infinity;
        steps.forEach((st, s) => { if (t >= st.t0 - 1e-6 && t <= st.t1 + 1e-6) zU = Math.max(zU, zUs[s]); });
        const mb = posts.next(16);
        const r = 0.05;
        const i = mb.vertexCount;
        const cs: Vec2[] = [[-r, -r], [r, -r], [r, r], [-r, r]];
        const foot = f.feet?.[k] ?? ground(c[0], c[1]) - SINK;
        for (const [dx, dy] of cs) {
          mb.vertex([c[0] + dx, c[1] + dy, foot], 0, 1);
          mb.vertex([c[0] + dx, c[1] + dy, zU], 0, 0);
        }
        for (let s = 0; s < 4; s++) {
          const p = i + s * 2, q = i + ((s + 1) % 4) * 2;
          mb.quad(p, q, q + 1, p + 1);
        }
      });
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

