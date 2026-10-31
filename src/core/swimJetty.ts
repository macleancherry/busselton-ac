// Busselton fork: two kinds of jetty (docs/landmarks/swim_jetties.md).
//
// coast.ts builds every OSM pier like the Busselton Jetty: a deck 3.6 m over the water on tall
// piles with handrails. That's right for a long jetty but far too high for the short swimming
// jetties along a beach, so each pier is sorted first:
//   - major:   the Busselton Jetty and any long or wide pier; built by coast.ts buildPiers, unchanged.
//   - swim:    a short swimming jetty or platform: a low timber deck about half a metre over the
//              water on short piles, no handrails, with swim ladders down into the water.
//   - pontoon: a floating pontoon (OSM floating=yes): a deck just above the water on floats.
// Visual only, like the main jetty (no physics), in the JETTY group.

import earcut from "earcut";
import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import type { Kn5MeshNode } from "./kn5";
import { MeshBuilder } from "./mesh";
import { box, ChunkedMesh } from "./scenery";
import { pad } from "./roadMesh";
import { SEA_LEVEL, type CoastPolygon, type SeaMask } from "./coast";

export type PierKind = "major" | "swim" | "pontoon";

/** Deck height above the water surface, by kind, metres (major = coast.ts DECK). */
export const DECK_ABOVE_WATER: Record<PierKind, number> = { major: 3.6, swim: 0.5, pontoon: 0.2 };
/** A pier at least this long (its greatest extent, all its pieces together) is a major jetty, metres. */
export const MAJOR_LENGTH = 150;
/** Or at least this wide (twice its area over its perimeter: a strip's width), metres. */
export const MAJOR_WIDTH = 8;

/** What's known about a pier besides its shape (OSM tags where the data has them). */
export interface PierInfo {
  /** OSM way id. Pieces of one pier split by tile seams share it. */
  id?: number;
  name?: string;
  /** OSM floating=yes. */
  floating?: boolean;
}

/** Greatest extent (length) and strip width of a set of rings (one pier, maybe in pieces), metres. */
export function pierShape(polys: CoastPolygon[]): { length: number; width: number } {
  const pts = polys.flatMap((p) => p.rings[0] ?? []);
  let length = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) length = Math.max(length, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
  }
  let area = 0, perim = 0;
  for (const p of polys) {
    p.rings.forEach((r, ri) => {
      let a = 0;
      for (let k = 0; k < r.length; k++) {
        const u = r[k], v = r[(k + 1) % r.length];
        a += u[0] * v[1] - v[0] * u[1];
        // Tile seams aren't the pier's edge.
        if (p.edge[ri]?.[k] !== false) perim += Math.hypot(v[0] - u[0], v[1] - u[1]);
      }
      area += ri === 0 ? Math.abs(a) / 2 : -Math.abs(a) / 2;
    });
  }
  return { length, width: perim > 0 ? (2 * area) / perim : 0 };
}

/**
 * Sort piers into kinds. In order: the route's override by OSM id (`overrides`, from the route's
 * build.jettyKinds); floating=yes is a pontoon; a name with "swim" is a swimming jetty (with
 * "pontoon", a pontoon); at least MAJOR_LENGTH long or MAJOR_WIDTH wide is a major jetty; anything
 * smaller is a swimming jetty. Pieces with the same id are measured together.
 */
export function classifyPiers(polys: CoastPolygon[], info: PierInfo[] = [], overrides: Record<string, PierKind> = {}): PierKind[] {
  const groups = new Map<number, CoastPolygon[]>();
  polys.forEach((p, i) => {
    const id = info[i]?.id;
    if (id !== undefined) groups.set(id, [...(groups.get(id) ?? []), p]);
  });
  return polys.map((p, i) => {
    const it = info[i] ?? {};
    const forced = it.id !== undefined ? overrides[String(it.id)] : undefined;
    if (forced === "major" || forced === "swim" || forced === "pontoon") return forced;
    if (it.floating) return "pontoon";
    if (it.name && /pontoon/i.test(it.name)) return "pontoon";
    if (it.name && /swim/i.test(it.name)) return "swim";
    const { length, width } = pierShape(it.id !== undefined ? groups.get(it.id)! : [p]);
    return length >= MAJOR_LENGTH || width >= MAJOR_WIDTH ? "major" : "swim";
  });
}

function inside(x: number, y: number, ring: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** A low jetty's deck height at a point: `above` over the water, or just over the ground where it comes ashore. */
export function lowDeckZ(kind: Exclude<PierKind, "major">, ground: HeightFn, sea: SeaMask): (x: number, y: number) => number {
  const above = DECK_ABOVE_WATER[kind];
  return (x, y) => Math.max(SEA_LEVEL + above, sea.has(x, y) ? -Infinity : ground(x, y) + 0.2);
}

/**
 * A deck height for anything standing on any jetty (jetty.ts): a low jetty's own height inside a
 * swimming jetty or pontoon, else the major jetties' (`major`, coast.ts pierDeckZ).
 */
export function deckZByKind(polys: CoastPolygon[], kinds: PierKind[], major: (x: number, y: number) => number, ground: HeightFn, sea: SeaMask): (x: number, y: number) => number {
  const low = polys.map((p, i) => (kinds[i] === "major" ? null : { ring: p.rings[0], z: lowDeckZ(kinds[i] as "swim" | "pontoon", ground, sea) }));
  return (x, y) => {
    for (const l of low) if (l && l.ring.length >= 3 && inside(x, y, l.ring)) return l.z(x, y);
    return major(x, y);
  };
}

/** Points along a ring's edges, no more than `step` apart (so a long deck edge follows the ground ashore). */
function densify(ring: Vec2[], step: number): { pts: Vec2[]; from: number[] } {
  const pts: Vec2[] = [], from: number[] = [];
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < n; j++) {
      pts.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
      from.push(k);
    }
  }
  return { pts, from };
}

/** Swim ladder spacing along a jetty's edges, metres, and the first one's distance from a corner. */
const LADDER_EVERY = 40;
const LADDER_FIRST = 12;

/**
 * Swimming jetties and pontoons (every `kinds[i]` that isn't "major"): a plank deck at the kind's
 * height, a fascia round its edge; a swimming jetty stands on pairs of short piles every 3.5 m
 * and has stainless swim ladders down into the water every 40 m along its edges (over the sea);
 * a pontoon sits on a float with a guide pile at each end. No handrails.
 */
export function buildSwimJetties(polys: CoastPolygon[], kinds: PierKind[], ground: HeightFn, sea: SeaMask): Kn5MeshNode[] {
  const deck = new MeshBuilder();
  deck.normals = [];
  const timbers = new ChunkedMesh(0), floats = new ChunkedMesh(0), steel = new ChunkedMesh(0);
  polys.forEach((p, pi) => {
    const kind = kinds[pi];
    if (kind === "major" || !kind) return;
    const ring = p.rings[0];
    if (!ring || ring.length < 3) return;
    const deckZ = lowDeckZ(kind, ground, sea);
    const onDeck = (x: number, y: number) => inside(x, y, ring) && !p.rings.slice(1).some((h) => inside(x, y, h));
    // Planks across the deck: texture u along the pier's longest side.
    let ax: Vec2 = [1, 0], best = 0;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l > best) { best = l; ax = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; }
    }
    const ac: Vec2 = [-ax[1], ax[0]];
    const rings = p.rings.map((r) => densify(r, 3).pts);
    const flat = rings.flatMap((r) => r.flatMap((v) => v));
    const holes: number[] = [];
    let n = 0;
    rings.forEach((r, i) => { if (i > 0) holes.push(n); n += r.length; });
    if (deck.vertexCount + n > 60000) return;
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
    // Round every real edge, in short bays: a fascia (or the pontoon's float), piles and ladders.
    let run = 0, nextLadder = LADDER_FIRST;
    p.rings.forEach((r, ri) => {
      for (let k = 0; k < r.length; k++) {
        const a = r[k], b = r[(k + 1) % r.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (p.edge[ri]?.[k] === false || len < 1e-6) continue;
        const t: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        // Inward: whichever side of the edge the deck is on.
        const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const left: Vec2 = [-t[1], t[0]];
        const inSign = onDeck(mid[0] + left[0] * 0.3, mid[1] + left[1] * 0.3) ? 1 : -1;
        const nIn: Vec2 = [left[0] * inSign, left[1] * inSign];
        const bays = Math.max(1, Math.round(len / 3));
        const bl = len / bays;
        for (let j = 0; j < bays; j++) {
          const pm: Vec2 = [a[0] + t[0] * bl * (j + 0.5), a[1] + t[1] * bl * (j + 0.5)];
          const z = Math.min(deckZ(a[0] + t[0] * bl * j, a[1] + t[1] * bl * j), deckZ(a[0] + t[0] * bl * (j + 1), a[1] + t[1] * bl * (j + 1)));
          const at: Vec2 = [pm[0] + nIn[0] * 0.06, pm[1] + nIn[1] * 0.06];
          if (kind === "pontoon") {
            // The float: from under the water up to the deck, set 0.15 m in from the edge.
            const f: Vec2 = [pm[0] + nIn[0] * 0.25, pm[1] + nIn[1] * 0.25];
            box(floats.next(20), f, t, bl, 0.2, SEA_LEVEL - 0.35, z - 0.04);
            box(timbers.next(20), at, t, bl, 0.12, z - 0.18, z);
          } else {
            box(timbers.next(20), at, t, bl, 0.12, z - 0.3, z); // fascia
          }
        }
        if (kind === "swim") {
          // Piles every 3.5 m, 0.25 m in from the edge, only over the sea.
          for (let d = 1; d < len - 0.5; d += 3.5) {
            const q: Vec2 = [a[0] + t[0] * d + nIn[0] * 0.25, a[1] + t[1] * d + nIn[1] * 0.25];
            if (!sea.has(q[0], q[1])) continue;
            box(timbers.next(20), q, t, 0.25, 0.25, ground(q[0], q[1]) - 0.5, deckZ(q[0], q[1]) - 0.12);
          }
          // Ladders every LADDER_EVERY along the edges, on the outside of the deck, over the water.
          for (; nextLadder < run + len; nextLadder += LADDER_EVERY) {
            const d = nextLadder - run;
            if (d < 1.5 || d > len - 1.5) continue;
            const e: Vec2 = [a[0] + t[0] * d, a[1] + t[1] * d];
            const out: Vec2 = [e[0] - nIn[0] * 0.18, e[1] - nIn[1] * 0.18];
            if (!sea.has(out[0], out[1])) continue;
            ladder(steel.next(200), out, t, nIn, deckZ(e[0], e[1]));
          }
          run += len;
        }
      }
    });
    if (kind === "pontoon") {
      // A guide pile at each end of the pontoon, standing 1.2 m above the deck.
      let a0 = Infinity, a1 = -Infinity, m0: Vec2 = ring[0], m1: Vec2 = ring[0];
      for (const q of ring) {
        const u = q[0] * ax[0] + q[1] * ax[1];
        if (u < a0) { a0 = u; m0 = q; }
        if (u > a1) { a1 = u; m1 = q; }
      }
      for (const m of [m0, m1]) {
        const g: Vec2 = [m[0] - ac[0] * 0.3, m[1] - ac[1] * 0.3];
        if (!sea.has(g[0], g[1])) continue;
        box(timbers.next(20), g, ax, 0.3, 0.3, ground(g[0], g[1]) - 0.5, deckZ(g[0], g[1]) + 1.2);
      }
    }
  });
  const out: Kn5MeshNode[] = [];
  if (deck.indices.length) out.push(deck.toKn5("JETTY_SWIM_DECK", "jetty_deck"));
  timbers.all().forEach((m, i) => out.push(m.toKn5(`JETTY_SWIM_TIMBER_${pad(i)}`, "jetty_timber")));
  floats.all().forEach((m, i) => out.push(m.toKn5(`JETTY_PONTOON_FLOAT_${pad(i)}`, "jetty_timber")));
  steel.all().forEach((m, i) => out.push(m.toKn5(`JETTY_SWIM_LADDER_${pad(i)}`, "steel")));
  return out;
}

/**
 * A stainless swim ladder against a jetty's edge: two stiles from a metre under the water up to
 * grab rails 0.9 m over the deck, rungs every 0.3 m. `at` is just outside the edge; `nIn` points
 * back onto the deck.
 */
function ladder(mb: MeshBuilder, at: Vec2, along: Vec2, nIn: Vec2, deck: number): void {
  const bottom = SEA_LEVEL - 1.0;
  for (const s of [-0.25, 0.25]) {
    const p: Vec2 = [at[0] + along[0] * s, at[1] + along[1] * s];
    box(mb, p, along, 0.05, 0.05, bottom, deck + 0.9);
    // The grab rail bends back over the deck edge.
    const top: Vec2 = [p[0] + nIn[0] * 0.2, p[1] + nIn[1] * 0.2];
    box(mb, top, nIn, 0.4, 0.05, deck + 0.85, deck + 0.9);
  }
  for (let z = bottom + 0.2; z < deck - 0.1; z += 0.3) box(mb, at, along, 0.5, 0.04, z, z + 0.04);
}
