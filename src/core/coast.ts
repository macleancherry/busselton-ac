// The sea and the jetty.
//
// The aerial photo already shows the bay, but as flat ground. Here the sea
// (OSM coastline, as OpenMapTiles' ocean polygons) gets a water surface a
// little above mean sea level, the ground under it is dropped to a seabed so
// the two never fight, and piers and jetties (OSM man_made=pier areas, such
// as the 1.8 km Busselton Jetty) are built as timber decks on piles with a
// handrail along each side.

import earcut from "earcut";
import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import type { Kn5MeshNode } from "./kn5";
import { MeshBuilder } from "./mesh";
import { box, ChunkedMesh } from "./scenery";
import { pad } from "./roadMesh";
import { encodePng } from "./png";
import { fill, rng } from "./textures";

/** Water surface height, metres (AHD; Busselton's mean sea level is about 0). */
export const SEA_LEVEL = 0.25;
/** How far the ground under the sea is dropped. */
const SEABED = 1.5;
/** Jetty deck height above the water. */
const DECK = 3.6;

export interface CoastPolygon {
  /** Local metres: exterior ring first, then holes. */
  rings: Vec2[][];
  /** False on an edge that is only a tile seam. */
  edge: boolean[][];
}

/** Rasterised sea, for quick "is this point in the sea?" tests. */
export class SeaMask {
  private readonly cells: Uint8Array;
  private readonly w: number;
  private readonly h: number;
  constructor(polys: CoastPolygon[], private readonly x0: number, private readonly y0: number, x1: number, y1: number, private readonly cell = 4) {
    this.w = Math.max(1, Math.ceil((x1 - x0) / cell));
    this.h = Math.max(1, Math.ceil((y1 - y0) / cell));
    this.cells = new Uint8Array(this.w * this.h);
    // Even-odd scanline fill of every ring of every polygon (holes cancel out).
    for (const p of polys) {
      const xs: number[][] = Array.from({ length: this.h }, () => []);
      for (const ring of p.rings) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const ya = (a[1] - y0) / cell - 0.5, yb = (b[1] - y0) / cell - 0.5;
          const lo = Math.max(0, Math.ceil(Math.min(ya, yb))), hi = Math.min(this.h - 1, Math.floor(Math.max(ya, yb) - 1e-9));
          for (let r = lo; r <= hi; r++) {
            if ((r >= ya) === (r >= yb)) continue;
            const t = (r - ya) / (yb - ya);
            xs[r].push((a[0] + (b[0] - a[0]) * t - x0) / cell - 0.5);
          }
        }
      }
      for (let r = 0; r < this.h; r++) {
        const row = xs[r].sort((u, v) => u - v);
        for (let k = 0; k + 1 < row.length; k += 2) {
          for (let c = Math.max(0, Math.ceil(row[k])); c <= Math.min(this.w - 1, Math.floor(row[k + 1])); c++) this.cells[r * this.w + c] = 1;
        }
      }
    }
  }
  has(x: number, y: number): boolean {
    const c = Math.floor((x - this.x0) / this.cell), r = Math.floor((y - this.y0) / this.cell);
    return c >= 0 && r >= 0 && c < this.w && r < this.h && this.cells[r * this.w + c] === 1;
  }
}

/** Ground heights with the seabed dropped under the sea. */
export function withSeabed(dem: HeightFn, sea: SeaMask): HeightFn {
  return (x, y) => {
    const h = dem(x, y);
    return sea.has(x, y) ? Math.min(h, 0) - SEABED : h;
  };
}

/** The water surface: the sea polygons, flat at SEA_LEVEL. */
export function buildSea(polys: CoastPolygon[]): Kn5MeshNode[] {
  const out: Kn5MeshNode[] = [];
  let mb = new MeshBuilder();
  mb.normals = [];
  const flush = () => {
    if (mb.indices.length) out.push(mb.toKn5(`SEA_${String(out.length).padStart(2, "0")}`, "sea", { castShadows: false }));
    mb = new MeshBuilder();
    mb.normals = [];
  };
  for (const p of polys) {
    const flat = p.rings.flatMap((r) => r.flatMap((v) => v));
    const holes: number[] = [];
    let n = 0;
    p.rings.forEach((r, i) => {
      if (i > 0) holes.push(n);
      n += r.length;
    });
    if (n > 60000) continue;
    if (mb.vertexCount + n > 60000) flush();
    const tris = earcut(flat, holes);
    const i0 = mb.vertexCount;
    for (let k = 0; k < n; k++) {
      const x = flat[k * 2], y = flat[k * 2 + 1];
      mb.vertex([x, y, SEA_LEVEL], x / 24, -y / 24);
      mb.normals!.push(0, 0, 1);
    }
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const cross = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]);
      if (cross >= 0) mb.tri(i0 + a, i0 + b, i0 + c);
      else mb.tri(i0 + a, i0 + c, i0 + b);
    }
  }
  flush();
  return out;
}

/** Principal direction of a ring (unit vector along its length). */
function axis(ring: Vec2[]): Vec2 {
  let mx = 0, my = 0;
  for (const [x, y] of ring) { mx += x; my += y; }
  mx /= ring.length; my /= ring.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of ring) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return [Math.cos(a), Math.sin(a)];
}

function inside(x: number, y: number, ring: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * Piers and jetties: a plank deck DECK metres above the water (or just above
 * the ground where it starts on land), a fascia under its edge, timber piles
 * every 7 m along by 3 m across where it stands over the sea, and a handrail.
 * Visual only (no physics).
 */
export function buildPiers(polys: CoastPolygon[], ground: HeightFn, sea: SeaMask): Kn5MeshNode[] {
  const deck = new MeshBuilder();
  deck.normals = [];
  const timbers = new ChunkedMesh(0);
  for (const p of polys) {
    const ring = p.rings[0];
    if (ring.length < 3) continue;
    const ax = axis(ring), ac: Vec2 = [-ax[1], ax[0]];
    const deckZ = (x: number, y: number) => Math.max(SEA_LEVEL + DECK, sea.has(x, y) ? 0 : ground(x, y) + 0.25);
    // Deck: planks run across the jetty (texture u along it).
    const flat = p.rings.flatMap((r) => r.flatMap((v) => v));
    const holes: number[] = [];
    let n = 0;
    p.rings.forEach((r, i) => { if (i > 0) holes.push(n); n += r.length; });
    if (deck.vertexCount + n > 60000) continue;
    const tris = earcut(flat, holes);
    const i0 = deck.vertexCount;
    for (let k = 0; k < n; k++) {
      const x = flat[k * 2], y = flat[k * 2 + 1];
      deck.vertex([x, y, deckZ(x, y)], (x * ax[0] + y * ax[1]) / 2, (x * ac[0] + y * ac[1]) / 2);
      deck.normals!.push(0, 0, 1);
    }
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const cross = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]);
      if (cross >= 0) deck.tri(i0 + a, i0 + b, i0 + c);
      else deck.tri(i0 + a, i0 + c, i0 + b);
    }
    // Fascia and handrail along each real edge, split into ~2.4 m bays.
    p.rings.forEach((r, ri) => {
      for (let k = 0; k < r.length; k++) {
        if (!p.edge[ri][k]) continue;
        const a = r[k], b = r[(k + 1) % r.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const bays = Math.max(1, Math.round(len / 3));
        const t: Vec2 = [(b[0] - a[0]) / (len || 1), (b[1] - a[1]) / (len || 1)];
        for (let j = 0; j < bays; j++) {
          const pa: Vec2 = [a[0] + (b[0] - a[0]) * (j / bays), a[1] + (b[1] - a[1]) * (j / bays)];
          const pb: Vec2 = [a[0] + (b[0] - a[0]) * ((j + 1) / bays), a[1] + (b[1] - a[1]) * ((j + 1) / bays)];
          const za = deckZ(...pa), zb = deckZ(...pb);
          const mid: Vec2 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
          const z = Math.min(za, zb);
          const bl = len / bays;
          const timber = timbers.next(80);
          box(timber, mid, t, bl, 0.12, z - 0.45, z); // fascia
          box(timber, pa, t, 0.12, 0.12, z, z + 1.1); // post
          box(timber, mid, t, bl, 0.1, z + 1.0, z + 1.1); // top rail
          box(timber, mid, t, bl, 0.06, z + 0.5, z + 0.58); // mid rail
        }
      }
    });
    // Piles: a grid along the jetty, only over the sea.
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, y] of ring) {
      const u = x * ax[0] + y * ax[1], v = x * ac[0] + y * ac[1];
      a0 = Math.min(a0, u); a1 = Math.max(a1, u); b0 = Math.min(b0, v); b1 = Math.max(b1, v);
    }
    for (let u = a0 + 3; u < a1; u += 7) {
      for (let v = b0 + 0.6; v < b1 - 0.3; v += 3) {
        const x = ax[0] * u + ac[0] * v, y = ax[1] * u + ac[1] * v;
        if (!inside(x, y, ring) || !sea.has(x, y)) continue;
        box(timbers.next(20), [x, y], ax, 0.35, 0.35, ground(x, y) - 0.5, deckZ(x, y) - 0.3);
      }
    }
  }
  const out: Kn5MeshNode[] = [];
  if (deck.indices.length) out.push(deck.toKn5("JETTY_DECK", "jetty_deck"));
  timbers.all().forEach((m, i) => out.push(m.toKn5(`JETTY_TIMBER_${pad(i)}`, "jetty_timber")));
  return out;
}

/** Sea surface, 24 m repeat: teal with soft ripples. */
export function seaTexture(): Uint8Array {
  const w = 256, h = 256;
  const r = rng(41);
  return encodePng(fill(w, h, (x, y) => {
    const k = 0.92 + 0.05 * Math.sin((x / w) * Math.PI * 2 * 9 + Math.sin((y / h) * Math.PI * 2 * 3) * 2)
      + 0.04 * Math.sin((y / h) * Math.PI * 2 * 13 + Math.sin((x / w) * Math.PI * 2 * 2) * 1.5) + (r() - 0.5) * 0.03;
    return [52 * k, 128 * k, 132 * k];
  }), w, h, { alpha: false });
}

/** Jetty deck, 2 m along by 2 m across: weathered grey planks across the jetty with gaps. */
export function deckTexture(): Uint8Array {
  const w = 128, h = 128;
  const r = rng(42);
  const tone = Array.from({ length: 14 }, () => 0.85 + r() * 0.25);
  return encodePng(fill(w, h, (x) => {
    const plank = Math.floor(x / (w / 13.3));
    const gap = x % (w / 13.3) < 1.2;
    const k = gap ? 0.45 : tone[plank % 14] * (0.95 + r() * 0.1);
    return [150 * k, 140 * k, 126 * k];
  }), w, h, { alpha: false });
}
