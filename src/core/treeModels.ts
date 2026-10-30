// Busselton fork: 3D models of the South West's trees for CSP's instanced trees (cspTrees.ts), drawn
// procedurally so the track ships no third-party art: a branch skeleton of tapered cylinders with
// bark, and leaf-cluster cards textured from a drawn atlas, at three levels of detail that use the
// same cards (fewer and bigger further out) so the look doesn't pop. docs/trees.md has the research.
//
//   peppermint (Agonis flexuosa): short leaning trunk splitting into leaders, weeping strands.
//   she-oak (Allocasuarina): wispy grey-green needle clusters, see-through.
//   Norfolk Island pine: straight trunk, flat tiers of horizontal branches.
//   tuart (Eucalyptus gomphocephala): massive pale trunk, crooked spreading limbs, open clumps.
//   palm (Canary Island date palm): thick trunk, a ball of long arching fronds.
//
// The same order as TREE_SPECIES (treeSprites.ts), so a tree's variant picks its model.

import { encodeDdsDxt5 } from "./dds";
import type { TreeModel, TreeSubMesh } from "./cspTrees";
import { toAc } from "./mesh";

type V3 = [number, number, number];
type RGB = [number, number, number];

function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** A direction from an angle round the vertical and an angle up from horizontal (radians). */
const dir = (az: number, el: number): V3 => [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];

interface Limb { a: V3; b: V3; ra: number; rb: number }
/** A foliage card: centre, how it hangs, size; `variant` picks one of the atlas's four cells. */
interface Card { c: V3; kind: "cluster" | "hang" | "flat" | "frond"; w: number; h: number; az: number; variant: number; tilt?: number }

interface Skeleton { limbs: Limb[]; cards: Card[]; crown: V3 }

/* ---------------- species skeletons (ENU metres: x east, y north, z up; base at 0) ---------------- */

/** A crooked limb from `a` heading `d`, in `n` segments that wander; returns the segments and the tip. */
function crooked(r: () => number, a: V3, d: V3, length: number, ra: number, rb: number, n: number, wander: number): { limbs: Limb[]; tip: V3; dir: V3 } {
  const limbs: Limb[] = [];
  let p = a, q = norm(d);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    q = norm(add(q, [(r() - 0.5) * wander, (r() - 0.5) * wander, (r() - 0.4) * wander * 0.6]));
    const b = add(p, mul(q, length / n));
    limbs.push({ a: p, b, ra: ra + (rb - ra) * t0, rb: ra + (rb - ra) * t1 });
    p = b;
  }
  return { limbs, tip: p, dir: q };
}

function tuart(seed: number): Skeleton {
  const r = rng(seed);
  const limbs: Limb[] = [], cards: Card[] = [];
  const trunk = crooked(r, [0, 0, 0], [0.05, 0.03, 1], 6, 0.55, 0.38, 3, 0.15);
  limbs.push(...trunk.limbs);
  const nMain = 4;
  for (let m = 0; m < nMain; m++) {
    const az = (m / nMain) * Math.PI * 2 + r() * 0.8;
    const start = add(trunk.tip, [0, 0, -r() * 1.2]);
    const main = crooked(r, start, dir(az, 0.75 + r() * 0.35), 6 + r() * 2.5, 0.3, 0.14, 3, 0.35);
    limbs.push(...main.limbs);
    for (let s = 0; s < 3; s++) {
      const from = main.limbs[Math.min(main.limbs.length - 1, 1 + s % 2)].b;
      const sub_ = crooked(r, from, add(main.dir, dir(az + (r() - 0.5) * 2.2, 0.4 + r() * 0.6)), 3 + r() * 2, 0.12, 0.05, 2, 0.5);
      limbs.push(...sub_.limbs);
      // An open clump at each tip: eucalypt foliage in separate clouds with sky between.
      const k = 12;
      for (let i = 0; i < k; i++) {
        const o: V3 = [(r() - 0.5) * 3.2, (r() - 0.5) * 3.2, (r() - 0.35) * 2.0];
        cards.push({ c: add(sub_.tip, o), kind: "cluster", w: 1.5 + r() * 0.6, h: 1.5 + r() * 0.6, az: r() * Math.PI, variant: Math.floor(r() * 4) });
      }
    }
    for (let i = 0; i < 6; i++) cards.push({ c: add(main.tip, [(r() - 0.5) * 3, (r() - 0.5) * 3, (r() - 0.3) * 2]), kind: "cluster", w: 1.7, h: 1.7, az: r() * Math.PI, variant: Math.floor(r() * 4) });
  }
  return { limbs, cards, crown: [0, 0, 12] };
}

function peppermint(seed: number): Skeleton {
  const r = rng(seed);
  const limbs: Limb[] = [], cards: Card[] = [];
  const lean = r() * Math.PI * 2;
  const trunk = crooked(r, [0, 0, 0], add([0, 0, 1], mul(dir(lean, 0), 0.25)), 2.2, 0.28, 0.2, 2, 0.1);
  limbs.push(...trunk.limbs);
  const leaders = 3;
  const tops: V3[] = [];
  for (let m = 0; m < leaders; m++) {
    const az = lean + (m / leaders) * Math.PI * 2 + r() * 0.6;
    const l = crooked(r, trunk.tip, dir(az, 0.95 + r() * 0.3), 4.5 + r() * 1.5, 0.16, 0.06, 3, 0.3);
    limbs.push(...l.limbs);
    tops.push(l.tip);
    // Short arching twigs off each leader, inside the crown, that the strands hang from.
    for (let s = 0; s < 3; s++) {
      const from = l.limbs[1 + (s % 2)].b;
      const t = crooked(r, from, dir(az + (r() - 0.5) * 1.8, 0.2 + r() * 0.3), 1.0 + r() * 0.6, 0.05, 0.025, 2, 0.4);
      limbs.push(...t.limbs);
    }
  }
  // Weeping strands hanging from a dome over the leaders, longer toward the outside, plus a few clusters on top.
  const centre: V3 = [tops.reduce((a, t) => a + t[0], 0) / leaders, tops.reduce((a, t) => a + t[1], 0) / leaders, 6.2];
  // An uneven dome: radius varies round the tree, so the outline isn't a perfect umbrella.
  const R = (az: number) => 3.6 + 0.6 * Math.sin(az * 2 + seed) + 0.4 * Math.sin(az * 3 + 1);
  for (let i = 0; i < 120; i++) {
    const az = r() * Math.PI * 2, f = Math.sqrt(r()), rad = f * R(az);
    const top = centre[2] + 1.5 * (1 - f * f);
    // Strands from the dome's underside, longest at the edge; some short ones inside.
    const l = (0.8 + f * 1.8) * (0.7 + r() * 0.6);
    cards.push({ c: [centre[0] + Math.cos(az) * rad, centre[1] + Math.sin(az) * rad, top - 0.4 - l / 2], kind: "hang", w: 1.2 + r() * 0.5, h: l, az: r() * Math.PI, variant: Math.floor(r() * 4) });
  }
  for (let i = 0; i < 70; i++) {
    const az = r() * Math.PI * 2, f = Math.sqrt(r()), rad = f * R(az) * 0.95;
    cards.push({ c: [centre[0] + Math.cos(az) * rad, centre[1] + Math.sin(az) * rad, centre[2] + 1.5 * (1 - f * f) - r() * 0.6], kind: "cluster", w: 1.5 + r() * 0.5, h: 1.2 + r() * 0.4, az: r() * Math.PI, variant: Math.floor(r() * 4) });
  }
  return { limbs, cards, crown: centre };
}

function sheoak(seed: number): Skeleton {
  const r = rng(seed);
  const limbs: Limb[] = [], cards: Card[] = [];
  const trunk = crooked(r, [0, 0, 0], [0, 0, 1], 3.2, 0.24, 0.16, 2, 0.12);
  limbs.push(...trunk.limbs);
  const top = crooked(r, trunk.tip, [0.05, 0, 1], 5.5, 0.15, 0.04, 3, 0.2);
  limbs.push(...top.limbs);
  for (let m = 0; m < 7; m++) {
    const from = [...trunk.limbs, ...top.limbs][2 + (m % 3)].b;
    const az = r() * Math.PI * 2;
    const b = crooked(r, from, dir(az, 0.5 + r() * 0.5), 2.5 + r() * 2, 0.08, 0.03, 2, 0.4);
    limbs.push(...b.limbs);
    for (let i = 0; i < 9; i++) cards.push({ c: add(b.tip, [(r() - 0.5) * 2.2, (r() - 0.5) * 2.2, (r() - 0.6) * 2.4]), kind: "hang", w: 1.3, h: 1.9 + r() * 0.6, az: r() * Math.PI, variant: Math.floor(r() * 4) });
  }
  for (let i = 0; i < 14; i++) cards.push({ c: add(top.tip, [(r() - 0.5) * 2.5, (r() - 0.5) * 2.5, -r() * 2.5]), kind: "hang", w: 1.2, h: 1.8, az: r() * Math.PI, variant: Math.floor(r() * 4) });
  return { limbs, cards, crown: [0, 0, 7.5] };
}

function norfolk(seed: number): Skeleton {
  const r = rng(seed);
  const limbs: Limb[] = [], cards: Card[] = [];
  const H = 22;
  limbs.push(...crooked(r, [0, 0, 0], [0, 0, 1], H, 0.42, 0.05, 6, 0.02).limbs);
  // Tiers of five near-horizontal branches every 1.4 m, shorter toward the top: the classic cone.
  for (let z = 4.5; z < H - 0.8; z += 1.4) {
    const t = (z - 4.5) / (H - 4.5);
    const L = 5.2 * (1 - t) + 0.7;
    const off = r() * Math.PI * 2;
    for (let k = 0; k < 5; k++) {
      const az = off + (k / 5) * Math.PI * 2 + (r() - 0.5) * 0.3;
      const d = dir(az, 0.08 + t * 0.25);
      const b = crooked(r, [0, 0, z], d, L, 0.07 * (1 - t) + 0.02, 0.015, 2, 0.08);
      limbs.push(...b.limbs);
      // Flat tufts of branchlets along the branch, upturned at the end.
      for (let s = 0.5; s < L; s += 0.6) {
        const p = add([0, 0, z], mul(d, s));
        cards.push({ c: add(p, [0, 0, 0.05]), kind: "flat", w: 1.6 + (1 - s / L) * 0.6, h: 1.1, az: az + (r() - 0.5) * 0.2, variant: Math.floor(r() * 4), tilt: 0.1 + (s / L) * 0.4 });
      }
    }
  }
  cards.push({ c: [0, 0, H - 0.5], kind: "cluster", w: 1.2, h: 1.6, az: 0, variant: 0 });
  return { limbs, cards, crown: [0, 0, 12] };
}

function palm(seed: number): Skeleton {
  const r = rng(seed);
  const limbs: Limb[] = [], cards: Card[] = [];
  const trunk = crooked(r, [0, 0, 0], [0.03, 0.02, 1], 7.5, 0.42, 0.36, 4, 0.04);
  limbs.push(...trunk.limbs);
  // A ball of long arching fronds: upper ones rise, lower ones droop.
  for (let i = 0; i < 30; i++) {
    const az = (i / 30) * Math.PI * 2 * 3.1 + r() * 0.3;
    const el = 1.1 - (i % 3) * 0.5 + (r() - 0.5) * 0.25;
    cards.push({ c: add(trunk.tip, [0, 0, (r() - 0.5) * 0.4]), kind: "frond", w: 1.7, h: 4.6 + r() * 0.9, az, variant: Math.floor(r() * 4), tilt: el });
  }
  return { limbs, cards, crown: trunk.tip };
}

/* ---------------- meshes ---------------- */

class Part {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];
  v(p: V3, n: V3, u: number, w: number): number {
    const a = toAc(p[0], p[1], p[2]), b = toAc(n[0], n[1], n[2]);
    this.positions.push(...a);
    this.normals.push(...b);
    this.uvs.push(u, w);
    return this.positions.length / 3 - 1;
  }
  /** a-b-c-d counter-clockwise from the front (ENU). */
  quad(a: number, b: number, c: number, d: number) { this.indices.push(a, b, c, a, c, d); }
}

function limbMesh(part: Part, l: Limb, sides: number) {
  const d = norm(sub(l.b, l.a));
  const ref: V3 = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = norm(cross(d, ref)), w = cross(d, u);
  const ring = (c: V3, r: number, v: number) => Array.from({ length: sides + 1 }, (_, k) => {
    const a = (k / sides) * Math.PI * 2;
    const n: V3 = add(mul(u, Math.cos(a)), mul(w, Math.sin(a)));
    return part.v(add(c, mul(n, r)), n, k / sides * Math.max(1, Math.round(r * 6)), v);
  });
  const L = len(sub(l.b, l.a));
  const A = ring(l.a, l.ra, 0), B = ring(l.b, l.rb, L / 2);
  for (let k = 0; k < sides; k++) part.quad(A[k], A[k + 1], B[k + 1], B[k]);
}

/** UVs of atlas cell `v` (2 x 2 cells). */
const cell = (v: number) => ({ u0: (v % 2) * 0.5, v0: Math.floor(v / 2) * 0.5 });

function cardMesh(part: Part, c: Card, crown: V3, grow: number) {
  const { u0, v0 } = cell(c.variant);
  const w = c.w * grow, h = c.h * grow;
  // Foliage normals point out from the crown's middle, blended with up: soft, tree-like lighting.
  const nAt = (p: V3): V3 => norm(add(mul(norm(sub(p, crown)), 0.7), [0, 0, 0.5]));
  const both = (pts: V3[], uv: [number, number][]) => {
    // Front and back (CSP's tree shader may cull back faces; the cards must read from both sides).
    const ids = pts.map((p, i) => part.v(p, nAt(p), u0 + uv[i][0] * 0.5, v0 + uv[i][1] * 0.5));
    part.quad(ids[0], ids[1], ids[2], ids[3]);
    part.quad(ids[0], ids[3], ids[2], ids[1]);
  };
  if (c.kind === "cluster") {
    // Three cards crossing at 60 degrees, each tilted a little.
    for (let k = 0; k < 3; k++) {
      const a = c.az + (k * Math.PI) / 3;
      const x: V3 = [Math.cos(a) * w / 2, Math.sin(a) * w / 2, 0], y: V3 = [0, 0, h / 2];
      const tilt: V3 = mul([-Math.sin(a), Math.cos(a), 0], (k - 1) * 0.25 * h);
      both([sub(sub(c.c, x), y), sub(add(c.c, x), y), add(add(add(c.c, x), y), tilt), add(add(sub(c.c, x), y), tilt)], [[0, 1], [1, 1], [1, 0], [0, 0]]);
    }
  } else if (c.kind === "hang") {
    // Two crossed vertical cards hanging from the top (the texture's top is the twig).
    for (let k = 0; k < 2; k++) {
      const a = c.az + (k * Math.PI) / 2;
      const x: V3 = [Math.cos(a) * w / 2, Math.sin(a) * w / 2, 0];
      const top = add(c.c, [0, 0, h / 2]), bot = add(c.c, [0, 0, -h / 2]);
      both([sub(bot, x), add(bot, x), add(top, x), sub(top, x)], [[0, 1], [1, 1], [1, 0], [0, 0]]);
    }
  } else if (c.kind === "flat") {
    // A near-horizontal tuft along the branch, rising toward its tip.
    const along = dir(c.az, c.tilt ?? 0), across: V3 = [-Math.sin(c.az) * w / 2, Math.cos(c.az) * w / 2, 0];
    const a = sub(c.c, mul(along, h / 2)), b = add(c.c, mul(along, h / 2));
    both([sub(a, across), sub(b, across), add(b, across), add(a, across)], [[0, 1], [0, 0], [1, 0], [1, 1]]);
    // And a narrow upright one through it, so the tier has depth seen side on.
    const up: V3 = [0, 0, w * 0.3];
    both([a, b, add(b, up), add(a, up)], [[0, 1], [0, 0], [1, 0], [1, 1]]);
  } else {
    // A frond: an arching strip in three segments from the crown out and down.
    let p = c.c, el = c.tilt ?? 0.5;
    const n = 4, seg = h / n;
    // The leaflets fold up in a shallow V along the frond.
    const across: V3 = [-Math.sin(c.az) * w / 2, Math.cos(c.az) * w / 2, w * 0.12];
    for (let s = 0; s < n; s++) {
      const q = add(p, mul(dir(c.az, el), seg));
      const a = mul(across, 1 - s / (n + 1.5)), b = mul(across, 1 - (s + 1) / (n + 1.5));
      both([sub(p, [a[0], a[1], -a[2]]), sub(q, [b[0], b[1], -b[2]]), add(q, b), add(p, a)], [[0, 1 - s / n], [0, 1 - (s + 1) / n], [1, 1 - (s + 1) / n], [1, 1 - s / n]]);
      p = q;
      el -= 0.4;
    }
  }
}

/* ---------------- textures ---------------- */

const S = 512; // atlas cell; the atlas is 2 x 2 cells

class Atlas {
  readonly px = new Float32Array(2 * S * 2 * S * 4); // straight RGBA 0..1
  constructor(readonly size = 2 * S) {}
  blend(x: number, y: number, c: RGB, a: number) {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= this.size || yi >= this.size || a <= 0) return;
    const i = (yi * this.size + xi) * 4;
    const ao = this.px[i + 3];
    const na = a + ao * (1 - a);
    for (let k = 0; k < 3; k++) this.px[i + k] = (c[k] / 255 * a + this.px[i + k] * ao * (1 - a)) / (na || 1);
    this.px[i + 3] = na;
  }
  /** A filled ellipse at (x, y), half-axes rx (along angle `a`) and ry. */
  ellipse(x: number, y: number, rx: number, ry: number, a: number, c: RGB, alpha = 1) {
    const R = Math.max(rx, ry) + 1, ca = Math.cos(a), sa = Math.sin(a);
    for (let yy = Math.floor(y - R); yy <= y + R; yy++) for (let xx = Math.floor(x - R); xx <= x + R; xx++) {
      const dx = xx + 0.5 - x, dy = yy + 0.5 - y;
      const u = (dx * ca + dy * sa) / rx, v = (-dx * sa + dy * ca) / ry;
      const d = u * u + v * v;
      if (d < 1) this.blend(xx, yy, c, alpha * Math.min(1, (1 - d) * 3));
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, alpha = 1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(0.5, w * 0.5));
    for (let i = 0; i <= n; i++) this.ellipse(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, w / 2, w / 2, 0, c, alpha);
  }
}

const shade = (c: RGB, k: number, r: () => number, jitter = 18): RGB => c.map((v) => Math.max(0, Math.min(255, v * k + (r() - 0.5) * jitter))) as RGB;

/** Leaves for each species, drawn into cell (cx, cy) of the atlas. */
function drawFoliage(at: Atlas, species: number, v: number) {
  const r = rng(1000 + species * 17 + v);
  const ox = (v % 2) * S, oy = Math.floor(v / 2) * S;
  if (species === 0) {
    // Peppermint: drooping twigs from the top, narrow dark willow-like leaves along them.
    const base: RGB = [62, 88, 44];
    for (let t = 0; t < 7; t++) {
      let x = ox + 60 + r() * (S - 120), y = oy + 10;
      for (let s = 0; s < 26; s++) {
        const nx = x + (r() - 0.5) * 14, ny = y + 18;
        at.line(x, y, nx, ny, 2, [70, 60, 45]);
        for (const side of [1, -1]) at.ellipse(nx + side * 9, ny + 6, 13, 3.2, Math.PI / 2 - side * 0.5 + (r() - 0.5) * 0.4, shade(base, 0.8 + s / 60, r), 0.95);
        x = nx; y = ny;
        if (y > oy + S - 20) break;
      }
    }
  } else if (species === 1) {
    // She-oak: fine drooping needles in loose sprays, grey-green, see-through.
    const base: RGB = [104, 118, 88];
    for (let t = 0; t < 40; t++) {
      const x = ox + 30 + r() * (S - 60), y = oy + 20 + r() * (S * 0.4);
      for (let k = 0; k < 14; k++) {
        const a = Math.PI / 2 + (r() - 0.5) * 0.8, l = 60 + r() * 120;
        at.line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 1.4, shade(base, 0.85 + r() * 0.3, r), 0.8);
      }
    }
  } else if (species === 2) {
    // Norfolk pine: a branchlet along the cell's height: a stem with dense short needles both sides.
    const base: RGB = [44, 74, 40];
    for (let b = 0; b < 5; b++) {
      const x0 = ox + S * (0.1 + b * 0.2) + (r() - 0.5) * 16;
      at.line(x0, oy + 4, x0 + (r() - 0.5) * 20, oy + S - 4, 4, [70, 58, 40]);
      for (let y = oy + 8; y < oy + S - 8; y += 3) {
        const x = x0 + ((y - oy) / S) * (r() - 0.5) * 20;
        for (const side of [1, -1]) at.line(x, y, x + side * (30 + r() * 26), y - 12 - r() * 10, 3.2, shade(base, 0.75 + r() * 0.45, r), 0.95);
      }
    }
  } else if (species === 3) {
    // Tuart: a rounded cloud of hanging lance-shaped eucalypt leaves, olive and grey-green, gaps between.
    const base: RGB = [96, 112, 70];
    const cx = ox + S / 2, cy = oy + S / 2;
    for (let i = 0; i < 520; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * S * 0.46;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.85;
      if (r() < 0.12) continue; // gaps
      at.ellipse(x, y, 16 + r() * 8, 4 + r() * 2, Math.PI / 2 + (r() - 0.5) * 1.2, shade(base, 0.7 + (1 - d / (S * 0.46)) * 0.35, r, 26), 0.95);
    }
  } else {
    // Palm frond: a rachis down the middle with long leaflets angled out both sides.
    const base: RGB = [88, 118, 56];
    const x0 = ox + S / 2;
    at.line(x0, oy + 4, x0, oy + S - 4, 6, [150, 140, 90]);
    for (let y = oy + 8; y < oy + S - 8; y += 6) {
      const l = 200 * Math.sin(((y - oy) / S) * Math.PI * 0.9 + 0.2) + 30;
      for (const side of [1, -1]) at.line(x0, y, x0 + side * l, y + l * 0.35, 6, shade(base, 0.8 + r() * 0.35, r), 0.95);
    }
  }
}

/** Bark for each species, tileable vertically (the cylinders wrap it). */
function drawBark(species: number): Atlas {
  const at = new Atlas(512);
  const r = rng(77 + species);
  const base: RGB = ([[70, 62, 54], [72, 60, 50], [104, 84, 66], [178, 172, 160], [120, 104, 82]] as RGB[])[species];
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) at.blend(x, y, shade(base, 0.92 + r() * 0.1, r, 8), 1);
  if (species === 4) {
    // Palm: horizontal rings of old frond bases.
    for (let y = 0; y < 512; y += 22) for (let x = 0; x < 512; x++) at.blend(x, y + Math.sin(x / 30) * 3, shade(base, 0.6, r), 0.8);
  } else {
    // Vertical fissures and fibrous streaks; tuart's paler and finer.
    const n = species === 3 ? 140 : 90;
    for (let i = 0; i < n; i++) {
      const x = r() * 512, y = r() * 512, l = 30 + r() * 140;
      at.line(x, y, x + (r() - 0.5) * 10, y + l, 2 + r() * (species === 3 ? 2 : 4), shade(base, species === 3 ? 0.78 : 0.6, r), 0.7);
    }
  }
  return at;
}

/** RGBA bytes of an atlas (premultiplied colour bled into empty pixels, so mips don't go dark at edges). */
function bytes(at: Atlas, opaque = false): Uint8Array {
  const n = at.size * at.size, out = new Uint8Array(n * 4);
  // Bleed: fill transparent pixels with the average colour of the opaque ones (cheap dilation).
  let ar = 0, ag = 0, ab = 0, cnt = 0;
  for (let i = 0; i < n; i++) if (at.px[i * 4 + 3] > 0.5) { ar += at.px[i * 4]; ag += at.px[i * 4 + 1]; ab += at.px[i * 4 + 2]; cnt++; }
  const fill = cnt ? [ar / cnt, ag / cnt, ab / cnt] : [0.3, 0.4, 0.2];
  for (let i = 0; i < n; i++) {
    const a = at.px[i * 4 + 3];
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(255 * (a > 0.02 ? at.px[i * 4 + k] : fill[k]));
    out[i * 4 + 3] = opaque ? 255 : Math.round(255 * Math.min(1, a));
  }
  return out;
}

/**
 * Normal map (tangent space, RGB) from a height field, with ambient occlusion in alpha: for leaves
 * the height is a dome over each cluster (from the alpha), so the cards light as rounded clumps.
 */
function normalMap(rgba: Uint8Array, size: number, mode: "leaves" | "bark"): Uint8Array {
  const h = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    h[i] = mode === "leaves" ? rgba[i * 4 + 3] / 255 : (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 765;
  }
  // Blur the leaves' alpha into a dome.
  if (mode === "leaves") {
    for (let pass = 0; pass < 3; pass++) {
      const t = new Float32Array(h);
      const R = 6;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let s = 0, c = 0;
        for (let k = -R; k <= R; k += 2) { const xx = x + k; if (xx >= 0 && xx < size) { s += t[y * size + xx]; c++; } }
        h[y * size + x] = s / c;
      }
      const t2 = new Float32Array(h);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let s = 0, c = 0;
        for (let k = -R; k <= R; k += 2) { const yy = y + k; if (yy >= 0 && yy < size) { s += t2[yy * size + x]; c++; } }
        h[y * size + x] = s / c;
      }
    }
  }
  const out = new Uint8Array(size * size * 4);
  const k = mode === "leaves" ? 3 : 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const dx = (h[y * size + Math.min(size - 1, x + 1)] - h[y * size + Math.max(0, x - 1)]) * k;
    const dy = (h[Math.min(size - 1, y + 1) * size + x] - h[Math.max(0, y - 1) * size + x]) * k;
    const l = Math.hypot(dx, dy, 1);
    out[i * 4] = Math.round((-dx / l) * 127.5 + 127.5);
    out[i * 4 + 1] = Math.round((dy / l) * 127.5 + 127.5);
    out[i * 4 + 2] = Math.round((1 / l) * 127.5 + 127.5);
    // AO: leaves darker in the middle of a clump and toward the bottom of a cell; bark a touch in the fissures.
    const ao = mode === "leaves" ? 1 - 0.45 * h[i] - 0.15 * ((y % S) / S) : 0.85 + 0.15 * h[i];
    out[i * 4 + 3] = Math.round(255 * Math.max(0.35, Math.min(1, ao)));
  }
  return out;
}

export const MODEL_NAMES = ["peppermint", "sheoak", "norfolk", "tuart", "palm"];
const SKELETONS = [peppermint, sheoak, norfolk, tuart, palm];
/** tree.ini shading per species: needle and fine foliage scatter less light and shine less. */
const SHADING: Record<string, string>[] = [
  { SUBSCATTERING: "0.6" }, { SUBSCATTERING: "0.35", SPECULAR: "0.05" }, { SUBSCATTERING: "0.3", SPECULAR: "0.05" }, { SUBSCATTERING: "0.5" }, { SUBSCATTERING: "0.45", SPECULAR: "0.15" },
];

/** A species' model with three LODs, its textures as DDS. */
export function treeModel(species: number): TreeModel {
  const name = MODEL_NAMES[species];
  const sk = SKELETONS[species](4242 + species);
  const leaves = new Atlas();
  for (let v = 0; v < 4; v++) drawFoliage(leaves, species, v);
  const leafRgba = bytes(leaves);
  const bark = drawBark(species);
  const barkRgba = bytes(bark, true);
  const textures: Record<string, Uint8Array> = {
    [`${name}_leaves.dds`]: encodeDdsDxt5(leafRgba, leaves.size, leaves.size),
    [`${name}_leaves_nm.dds`]: encodeDdsDxt5(normalMap(leafRgba, leaves.size, "leaves"), leaves.size, leaves.size),
    [`${name}_bark.dds`]: encodeDdsDxt5(barkRgba, bark.size, bark.size),
    [`${name}_bark_nm.dds`]: encodeDdsDxt5(normalMap(barkRgba, bark.size, "bark"), bark.size, bark.size),
  };
  // LOD 0: everything. LOD 1: two thirds of the cards, a bit bigger; thin limbs dropped. LOD 2: a
  // third of the cards, bigger again, trunk and main limbs only.
  const lods = [
    { keep: 1, grow: 1, sides: 8, minR: 0, distance: 45 },
    { keep: 0.6, grow: 1.25, sides: 6, minR: 0.05, distance: 100 },
    { keep: 0.3, grow: 1.6, sides: 4, minR: 0.12, distance: 180 },
  ];
  return {
    name,
    textures,
    ini: { SHADING: SHADING[species] },
    lods: lods.map((L) => {
      const wood = new Part(), leaf = new Part();
      for (const l of sk.limbs) if (Math.max(l.ra, l.rb) >= L.minR) limbMesh(wood, l, L.sides);
      const step = 1 / L.keep;
      for (let i = 0; i < sk.cards.length; i += step) cardMesh(leaf, sk.cards[Math.floor(i)], sk.crown, L.grow);
      const subs: TreeSubMesh[] = [
        { diffuse: `${name}_bark.dds`, normal: `${name}_bark_nm.dds`, ...wood },
        { diffuse: `${name}_leaves.dds`, normal: `${name}_leaves_nm.dds`, ...leaf },
      ];
      return { subs: subs.filter((s) => s.indices.length), distance: L.distance };
    }),
  };
}
