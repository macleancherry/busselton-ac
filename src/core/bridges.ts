// Busselton fork: road bridges as street decks (the bridgeDecks option). A bridge (OSM bridge=yes,
// not a tunnel) on a street was left out, so the street had a hole where it crosses a river or a
// drain. Now it is built as part of the street: a flat deck from one end's ground height to the
// other's, never dipping into what it crosses, with a railing along each side. A bridge that crosses
// another road stays out: drawn at street level it would make a crossing that doesn't exist.
//
// Both street builders use it: the old side streets (sideStreets.ts: a bridge is its own street,
// `deck`) and networkCore (network/index.ts: the bridge joins the street either side as one edge,
// and the deck's height comes from deckGround()).

import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import type { Kn5MeshNode } from "./kn5";
import type { Vec3 } from "./mesh";
import { ChunkedMesh } from "./meshKit";

/** A deck: a bridge's centreline (local metres) and its width, metres. */
export interface Deck {
  pts: Vec2[];
  width: number;
}

const DRIVABLE = /^(motorway|trunk|primary|secondary|tertiary|minor|residential|unclassified|living_street|road|service|track|busway)(_link)?$/;

/** A bridge carrying a road (not a footbridge, not a tunnel). */
export const isRoadBridge = (l: { cls: string; brunnel?: string }) => l.brunnel === "bridge" && DRIVABLE.test(l.cls);

/** Where segments ab and cd meet (ends included), or null. */
function meet(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r: Vec2 = [b[0] - a[0], b[1] - a[1]], s: Vec2 = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const qp: Vec2 = [c[0] - a[0], c[1] - a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den, u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  const e = 1e-9;
  return t >= -e && t <= 1 + e && u >= -e && u <= 1 + e ? [a[0] + r[0] * t, a[1] + r[1] * t] : null;
}

const bbox = (pts: Vec2[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
};

/**
 * Which lines are bridges to build as decks (indices): road bridges that cross no other road line
 * (local metres). Lines that only touch a bridge at its ends (the street carrying on, a side street
 * at the abutment) don't count as crossing it.
 */
export function deckBridges(lines: { pts: Vec2[]; cls: string; brunnel?: string }[]): Set<number> {
  const out = new Set<number>();
  const boxes = lines.map((l) => bbox(l.pts));
  lines.forEach((l, i) => {
    if (!isRoadBridge(l) || l.pts.length < 2) return;
    const bi = boxes[i];
    const over = lines.some((m, j) => {
      if (j === i || !DRIVABLE.test(m.cls) || m.brunnel === "tunnel") return false;
      const bj = boxes[j];
      if (bj.x0 > bi.x1 || bj.x1 < bi.x0 || bj.y0 > bi.y1 || bj.y1 < bi.y0) return false;
      // Meeting anywhere but within half a metre of the bridge's own ends (the street carrying on).
      const A = l.pts[0], Z = l.pts[l.pts.length - 1];
      for (let a = 1; a < l.pts.length; a++) for (let b = 1; b < m.pts.length; b++) {
        const p = meet(l.pts[a - 1], l.pts[a], m.pts[b - 1], m.pts[b]);
        if (p && Math.hypot(p[0] - A[0], p[1] - A[1]) > 0.5 && Math.hypot(p[0] - Z[0], p[1] - Z[1]) > 0.5) return true;
      }
      return false;
    });
    if (!over) out.add(i);
  });
  return out;
}

interface DeckIndex {
  d: Deck;
  cum: number[];
  hA: number;
  hB: number;
  box: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Arc length along a polyline of the nearest point to p, and the distance to it. Past either end the
 * arc length carries on along the end segment (negative before the start, over the length past the end).
 */
function project(pts: Vec2[], cum: number[], p: Vec2): { s: number; dist: number } {
  let best = { s: 0, dist: Infinity };
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-12;
    const raw = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
    const f = Math.max(0, Math.min(1, raw));
    const dist = Math.hypot(p[0] - a[0] - dx * f, p[1] - a[1] - dy * f);
    const g = (k === 1 && raw < 0) || (k === pts.length - 1 && raw > 1) ? raw : f;
    if (dist < best.dist) best = { s: cum[k - 1] + g * (cum[k] - cum[k - 1]), dist };
  }
  return best;
}

/**
 * The ground the streets drape on, with each deck flat over its span: within the deck's width (plus
 * `margin` either side, for kerbs and the railing) and between its ends, the height runs straight
 * from the ground at one end to the ground at the other, or the ground itself where that is higher.
 * Everywhere else, the ground.
 */
export function deckGround(ground: HeightFn, decks: Deck[], margin = 1.5): HeightFn {
  if (!decks.length) return ground;
  const idx: DeckIndex[] = decks.filter((d) => d.pts.length >= 2).map((d) => {
    const cum = [0];
    for (let k = 1; k < d.pts.length; k++) cum.push(cum[k - 1] + Math.hypot(d.pts[k][0] - d.pts[k - 1][0], d.pts[k][1] - d.pts[k - 1][1]));
    const b = bbox(d.pts), r = d.width / 2 + margin;
    const a = d.pts[0], z = d.pts[d.pts.length - 1];
    return { d, cum, hA: ground(a[0], a[1]), hB: ground(z[0], z[1]), box: { x0: b.x0 - r, y0: b.y0 - r, x1: b.x1 + r, y1: b.y1 + r } };
  });
  return (x, y) => {
    const g = ground(x, y);
    for (const q of idx) {
      if (x < q.box.x0 || x > q.box.x1 || y < q.box.y0 || y > q.box.y1) continue;
      const { s, dist } = project(q.d.pts, q.cum, [x, y]);
      const L = q.cum[q.cum.length - 1];
      if (dist > q.d.width / 2 + margin || s <= 0 || s >= L) continue;
      return Math.max(g, q.hA + ((q.hB - q.hA) * s) / L);
    }
    return g;
  };
}

/** Bridge railing: a concrete upstand with steel posts and two rails, metres. */
const PLINTH_W = 0.3, PLINTH_H = 0.3, POST = 0.08, POST_EVERY = 2, RAIL_ZS = [0.65, 1.05], RAIL_H = 0.06, WALL_H = 1.1;
/** How far in from the deck's edge the railing's outer face stands, metres (it stands on the deck). */
export const RAIL_INSET = 0.05;

/**
 * A railing along both sides of each deck, standing on it: `surface(x, y)` is the deck's top. The
 * visual parts (BRIDGEPLINTH_ in concrete, BRIDGERAIL_ in steel) and an invisible wall to hit
 * (1WALL_BRIDGE_).
 */
export function bridgeRailings(decks: Deck[], surface: HeightFn): Kn5MeshNode[] {
  const plinth = new ChunkedMesh(20), rail = new ChunkedMesh(20), wall = new ChunkedMesh(20);
  /** A box between two points along a line (p0 to p1, `out` the outward unit vector), w wide from `off` outward offset. */
  const slab = (pool: ChunkedMesh, p0: Vec2, p1: Vec2, out: Vec2, off0: number, off1: number, z0a: number, z0b: number, h0: number, h1: number) => {
    const mb = pool.next(20);
    const c = (p: Vec2, off: number, z: number): Vec3 => [p[0] + out[0] * off, p[1] + out[1] * off, z];
    const v = [c(p0, off0, z0a + h0), c(p1, off0, z0b + h0), c(p1, off1, z0b + h0), c(p0, off1, z0a + h0), c(p0, off0, z0a + h1), c(p1, off0, z0b + h1), c(p1, off1, z0b + h1), c(p0, off1, z0a + h1)];
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    // Corners are listed for `out` on the left of p0 to p1; mirrored, each face winds the other way.
    const flip = (p1[0] - p0[0]) * out[1] - (p1[1] - p0[1]) * out[0] < 0;
    const face = (a: number, b: number, cc: number, d: number, u: number) => {
      const i = mb.vertexCount;
      mb.vertex(v[a], 0, 0); mb.vertex(v[b], u, 0); mb.vertex(v[cc], u, 1); mb.vertex(v[d], 0, 1);
      if (flip) mb.quad(i, i + 3, i + 2, i + 1);
      else mb.quad(i, i + 1, i + 2, i + 3);
    };
    face(4, 5, 6, 7, L); // top
    face(0, 1, 5, 4, L); // inner side
    face(2, 3, 7, 6, L); // outer side
    face(3, 0, 4, 7, 1); // ends
    face(1, 2, 6, 5, 1);
  };
  for (const d of decks) {
    if (d.pts.length < 2) continue;
    for (const side of [1, -1]) {
      // Points along the line every metre or so, with the outward normal.
      const ring: { p: Vec2; out: Vec2; z: number; s: number }[] = [];
      let s = 0;
      for (let k = 1; k < d.pts.length; k++) {
        const a = d.pts[k - 1], b = d.pts[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 1e-6) continue;
        const t: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], out: Vec2 = [-t[1] * side, t[0] * side];
        const n = Math.max(1, Math.ceil(L));
        for (let j = k === 1 ? 0 : 1; j <= n; j++) {
          const c: Vec2 = [a[0] + (b[0] - a[0]) * (j / n), a[1] + (b[1] - a[1]) * (j / n)];
          const off = d.width / 2 - RAIL_INSET - PLINTH_W;
          const p: Vec2 = [c[0] + out[0] * off, c[1] + out[1] * off];
          ring.push({ p, out, z: surface(p[0] + out[0] * PLINTH_W / 2, p[1] + out[1] * PLINTH_W / 2), s: s + (L * j) / n });
        }
        s += L;
      }
      for (let k = 1; k < ring.length; k++) {
        const r0 = ring[k - 1], r1 = ring[k];
        slab(plinth, r0.p, r1.p, r0.out, 0, PLINTH_W, r0.z, r1.z, -0.05, PLINTH_H);
        for (const rz of RAIL_ZS) slab(rail, r0.p, r1.p, r0.out, PLINTH_W / 2 - 0.03, PLINTH_W / 2 + 0.03, r0.z, r1.z, rz - RAIL_H, rz);
        slab(wall, r0.p, r1.p, r0.out, 0, PLINTH_W, r0.z, r1.z, -0.2, WALL_H);
      }
      // Posts every 2 m, centred on the upstand.
      const total = ring[ring.length - 1]?.s ?? 0;
      for (let q = 0; q <= Math.floor(total / POST_EVERY); q++) {
        const at = Math.min(total, q * POST_EVERY);
        const k = Math.max(1, ring.findIndex((r) => r.s >= at - 1e-6));
        const r = ring[Math.min(ring.length - 1, k)], r0 = ring[k - 1];
        const f = r.s - r0.s > 1e-9 ? (at - r0.s) / (r.s - r0.s) : 0;
        const c: Vec2 = [r0.p[0] + (r.p[0] - r0.p[0]) * f, r0.p[1] + (r.p[1] - r0.p[1]) * f];
        const z = r0.z + (r.z - r0.z) * f;
        const tl = Math.hypot(r.p[0] - r0.p[0], r.p[1] - r0.p[1]) || 1;
        const t: Vec2 = [(r.p[0] - r0.p[0]) / tl, (r.p[1] - r0.p[1]) / tl];
        const a: Vec2 = [c[0] - t[0] * POST / 2, c[1] - t[1] * POST / 2], b: Vec2 = [c[0] + t[0] * POST / 2, c[1] + t[1] * POST / 2];
        slab(rail, a, b, r0.out, PLINTH_W / 2 - POST / 2, PLINTH_W / 2 + POST / 2, z, z, PLINTH_H - 0.02, RAIL_ZS[RAIL_ZS.length - 1]);
      }
    }
  }
  const nodes: Kn5MeshNode[] = [];
  const out = (pool: ChunkedMesh, name: string, mat: string, extra: Partial<Kn5MeshNode> = {}) => pool.all().forEach((m, i) => {
    m.normals = null; // from the faces
    nodes.push(m.toKn5(`${name}${String(i).padStart(3, "0")}`, mat, extra));
  });
  out(plinth, "BRIDGEPLINTH_", "concrete");
  out(rail, "BRIDGERAIL_", "steel");
  out(wall, "1WALL_BRIDGE_", "wall", { renderable: false, castShadows: false });
  return nodes;
}

/** A street line's width by class, metres, for a deck's extent (the built streets' own widths give the railings). */
const CLASS_WIDTH: Record<string, number> = { primary: 7.5, secondary: 7, tertiary: 6.5, minor: 6, residential: 6, unclassified: 6, service: 4, track: 3.5 };

/** The decks among street lines (local metres): each bridge to build, with its class's width. */
export function decksOf(lines: { pts: Vec2[]; cls: string; brunnel?: string }[]): Deck[] {
  if (!lines.some((l) => l.brunnel === "bridge")) return [];
  return [...deckBridges(lines)].map((i) => ({ pts: lines[i].pts, width: CLASS_WIDTH[lines[i].cls.replace(/_link$/, "")] ?? 6 }));
}

/**
 * The stretches of built streets that are on a deck (within its width plus a metre, between its
 * ends), at least 4 m long, with the street's widest width there: where the railings go.
 */
export function deckRuns(streets: { pts: Vec2[]; width: number; widths?: number[] }[], decks: Deck[]): Deck[] {
  if (!decks.length) return [];
  const idx = decks.filter((d) => d.pts.length >= 2).map((d) => {
    const cum = [0];
    for (let k = 1; k < d.pts.length; k++) cum.push(cum[k - 1] + Math.hypot(d.pts[k][0] - d.pts[k - 1][0], d.pts[k][1] - d.pts[k - 1][1]));
    return { d, cum };
  });
  const on = (p: Vec2) => idx.some(({ d, cum }) => {
    const { s, dist } = project(d.pts, cum, p);
    return dist <= d.width / 2 + 1 && s >= -0.5 && s <= cum[cum.length - 1] + 0.5;
  });
  const out: Deck[] = [];
  for (const st of streets) {
    const inside = st.pts.map(on);
    for (let i = 0; i < st.pts.length;) {
      if (!inside[i]) { i++; continue; }
      let j = i;
      while (j < st.pts.length && inside[j]) j++;
      const pts = st.pts.slice(i, j);
      let len = 0;
      for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      if (len >= 4) out.push({ pts, width: Math.max(...(st.widths?.slice(i, j) ?? [st.width])) });
      i = j;
    }
  }
  return out;
}
