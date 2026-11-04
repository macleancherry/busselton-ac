// Low-poly vehicle building blocks for local cars (docs/plans/local-cars.md): a body from a side
// silhouette, a glasshouse, an open tray, wheels, boxes for accessories, all into one template mesh in
// the vehicle's own frame. A template is made once per model and LOD and copied into the parked cars'
// merged mesh (or a traffic car's kn5) with each car's paint.
//
// Frame: f forward from the middle of the body, s to the left, h up from the ground, metres. Faces get
// their own vertices (flat shaded, like the rest of the scenery). Colour comes from one small atlas:
// a row of flat swatches (the paints, then glass, tyre and so on) and two drawn tiles (wheel face,
// grille). Paint vertices are marked so each car can take its own paint without a new template.

import earcut from "earcut";
import { encodePng } from "../png";
import { PAINT } from "../parkedCars";
import { fill } from "../textures";

export type V3 = [number, number, number];

/** Swatch numbers after the paints. PAINT_SLOT is "this car's paint". */
export const PAINT_SLOT = -1;
const N = PAINT.length;
export const SW = {
  GLASS: N, TYRE: N + 1, TRIM: N + 2, RIM: N + 3, HEAD: N + 4, TAIL: N + 5, LINER: N + 6, CHROME: N + 7, CANVAS: N + 8,
  PLATE: N + 9, ALLOY: N + 10,
} as const;
const EXTRA: [number, number, number][] = [
  [22, 28, 34], // glass
  [22, 22, 22], // tyre
  [38, 39, 41], // black plastic trim
  [150, 152, 156], // alloy rim
  [132, 146, 160], // headlight (clear lens over a dark housing, as it reads by day)
  [168, 24, 22], // tail light
  [30, 30, 32], // tray liner
  [196, 198, 200], // chrome / alloy bar
  [92, 90, 82], // canvas, rubber mat
  [236, 236, 230], // number plate: plain white, never text
  [172, 175, 178], // alloy tray and toolboxes (duller than chrome)
];

export const ATLAS_W = 512, ATLAS_H = 128;
/** A drawn tile in the atlas, pixels: x, y, width, height. */
export type Tile = [number, number, number, number];
export const WHEEL_TILE: Tile = [0, 32, 64, 64];
export const GRILLE_TILE: Tile = [64, 32, 64, 32];

/** The atlas as RGBA: swatches 16 px across the top row, then the wheel face and grille tiles. */
export function atlasPixels(): Uint8Array {
  const sw = [...PAINT, ...EXTRA];
  return fill(ATLAS_W, ATLAS_H, (x, y) => {
    if (y < 16) return sw[Math.floor(x / 16)] ?? [128, 128, 128];
    const [wx, wy, ww, wh] = WHEEL_TILE;
    if (x >= wx && x < wx + ww && y >= wy && y < wy + wh) {
      // Tyre ring, a grey alloy with five dark gaps between spokes, a centre cap.
      const dx = x + 0.5 - (wx + ww / 2), dy = y + 0.5 - (wy + wh / 2), r = Math.hypot(dx, dy) / (ww / 2);
      if (r > 0.98) return [18, 18, 18];
      if (r > 0.66) return [24, 24, 24];
      if (r < 0.14) return [120, 122, 126];
      const a = Math.atan2(dy, dx), spoke = Math.cos(a * 5) > 0.35;
      return spoke || r > 0.6 ? [158, 160, 164] : [40, 40, 42];
    }
    const [gx, gy, gw, gh] = GRILLE_TILE;
    if (x >= gx && x < gx + gw && y >= gy && y < gy + gh) {
      // Dark grille: a frame and horizontal slats.
      const fx = x - gx, fy = y - gy;
      if (fx < 2 || fx >= gw - 2 || fy < 2 || fy >= gh - 2) return [70, 72, 76];
      return fy % 6 < 2 ? [58, 60, 64] : [14, 14, 16];
    }
    return [128, 128, 128];
  });
}

export function atlasPng(): Uint8Array {
  return encodePng(atlasPixels(), ATLAS_W, ATLAS_H);
}

/** Atlas uv (v down, as kn5) of a swatch's middle. */
export function swatchUv(swatch: number): [number, number] {
  return [(swatch * 16 + 8) / ATLAS_W, 8 / ATLAS_H];
}

/** A template: positions (f, s, h), uvs, which vertices are paint, triangles. */
export interface VehicleMesh {
  pos: number[];
  uv: number[];
  paint: boolean[];
  idx: number[];
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Newell normal of a polygon (not unit). */
function normalOf(pts: V3[]): V3 {
  const n: V3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

export class VehicleBuilder {
  readonly mesh: VehicleMesh = { pos: [], uv: [], paint: [], idx: [] };

  get triangles() {
    return this.mesh.idx.length / 3;
  }

  private vert(p: V3, uv: [number, number], paint: boolean) {
    const m = this.mesh, i = m.pos.length / 3;
    m.pos.push(p[0], p[1], p[2]);
    m.uv.push(uv[0], uv[1]);
    m.paint.push(paint);
    return i;
  }

  /**
   * A convex face (fan), turned so its front faces `out`. `swatch` is a swatch number (PAINT_SLOT for
   * paint), or per-point atlas uvs for a drawn tile. Degenerate faces are skipped.
   */
  face(pts: V3[], swatch: number | [number, number][], out: V3): void {
    const n = normalOf(pts);
    if (Math.hypot(...n) < 1e-6) return;
    const flip = dot(n, out) < 0;
    // Corners that repeat the one before (a chamfer with no inset at one end) would make a
    // zero-area triangle: drop them.
    const same = (a: V3, b: V3) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-9;
    const keys = [...pts.keys()].filter((k, i, all) => i === 0 || !same(pts[k], pts[all[i - 1]]));
    while (keys.length > 3 && same(pts[keys[keys.length - 1]], pts[keys[0]])) keys.pop();
    if (keys.length < 3) return;
    const order = flip ? keys.reverse() : keys;
    const paint = swatch === PAINT_SLOT;
    const ids = order.map((k) => this.vert(pts[k], typeof swatch === "number" ? swatchUv(paint ? 0 : swatch) : swatch[k], paint));
    for (let k = 1; k + 1 < ids.length; k++) this.mesh.idx.push(ids[0], ids[k], ids[k + 1]);
  }

  /** A box with the given corner ranges; `skip` leaves faces out ("bottom" by default). */
  box(f: [number, number], s: [number, number], h: [number, number], swatch: number, skip: string[] = ["bottom"]): void {
    const [f0, f1] = f, [s0, s1] = s, [h0, h1] = h;
    const P = (a: number, b: number, c: number): V3 => [a, b, c];
    const faces: [string, V3[], V3][] = [
      ["top", [P(f0, s0, h1), P(f1, s0, h1), P(f1, s1, h1), P(f0, s1, h1)], [0, 0, 1]],
      ["bottom", [P(f0, s0, h0), P(f1, s0, h0), P(f1, s1, h0), P(f0, s1, h0)], [0, 0, -1]],
      ["front", [P(f1, s0, h0), P(f1, s1, h0), P(f1, s1, h1), P(f1, s0, h1)], [1, 0, 0]],
      ["back", [P(f0, s0, h0), P(f0, s1, h0), P(f0, s1, h1), P(f0, s0, h1)], [-1, 0, 0]],
      ["left", [P(f0, s1, h0), P(f1, s1, h0), P(f1, s1, h1), P(f0, s1, h1)], [0, 1, 0]],
      ["right", [P(f0, s0, h0), P(f1, s0, h0), P(f1, s0, h1), P(f0, s0, h1)], [0, -1, 0]],
    ];
    for (const [name, pts, out] of faces) if (!skip.includes(name)) this.face(pts, swatch, out);
  }

  /**
   * A box both sides of the middle (s and -s), e.g. a pair of mirrors. `skip` may also name "inner"
   * (the face towards the middle) and "outer", mirrored for the second box.
   */
  boxPair(f: [number, number], s: [number, number], h: [number, number], swatch: number, skip: string[] = ["bottom"]): void {
    const side = (inner: string, outer: string) => skip.map((k) => (k === "inner" ? inner : k === "outer" ? outer : k));
    this.box(f, s, h, swatch, side("right", "left"));
    this.box(f, [-s[1], -s[0]], h, swatch, side("left", "right"));
  }
}

/** A point of the body's side silhouette: distance back from the front, height, half width there. */
export interface SilPt {
  d: number;
  h: number;
  hw: number;
  /** How far the top or end of the body is drawn in from the side here (a rounded shoulder or nose), metres. */
  inset?: number;
  /** How far the side's edge sits below `h` here (the shoulder's rounding), metres. */
  drop?: number;
  /** How far the side's edge sits back from `d` here (a rounded corner in plan at the nose or tail), metres; + is rearward. */
  ds?: number;
}

/**
 * What the edge from one silhouette point to the next is: "body" a surface across the car (chamfered
 * where the points have an inset, the chamfers optionally another swatch, e.g. lamps at the corners),
 * "across" a plain strip side to side (wheel arch liners), "skip" nothing (the underside, or a part
 * another builder fills, like the tray).
 */
export interface SilEdge {
  kind: "body" | "across" | "skip";
  mid?: number | "grille";
  corner?: number;
}

/**
 * The lower body from its silhouette: both sides (the silhouette, triangulated, at each point's half
 * width) and the edges across. `len` is the body's length (d = 0 at the front, f = len/2 - d).
 */
export function lowerBody(vb: VehicleBuilder, len: number, pts: SilPt[], edges: SilEdge[]): void {
  const n = pts.length;
  const f = (p: SilPt) => len / 2 - p.d;
  const side = (p: SilPt, sgn: 1 | -1): V3 => [f(p) - (p.ds ?? 0), sgn * p.hw, p.h - (p.drop ?? 0)];
  const inner = (p: SilPt, sgn: 1 | -1): V3 => [f(p), sgn * (p.hw - (p.inset ?? 0)), p.h];
  // Sides: earcut in (f, h).
  const flat = pts.flatMap((p) => [f(p) - (p.ds ?? 0), p.h - (p.drop ?? 0)]);
  const tris = earcut(flat);
  for (const sgn of [1, -1] as const) {
    for (let t = 0; t < tris.length; t += 3) {
      vb.face([side(pts[tris[t]], sgn), side(pts[tris[t + 1]], sgn), side(pts[tris[t + 2]], sgn)], PAINT_SLOT, [0, sgn, 0]);
    }
  }
  // Winding of the silhouette in (f, h): outward normal of an edge is its direction turned away from the inside.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    area += f(a) * b.h - f(b) * a.h;
  }
  const ccw = area > 0;
  for (let i = 0; i < n; i++) {
    const e = edges[i];
    if (!e || e.kind === "skip") continue;
    const a = pts[i], b = pts[(i + 1) % n];
    const df = f(b) - f(a), dh = b.h - a.h;
    const out: V3 = ccw ? [dh, 0, -df] : [-dh, 0, df];
    const mid = e.mid ?? PAINT_SLOT;
    if (e.kind === "across") {
      vb.face([side(a, 1), side(b, 1), side(b, -1), side(a, -1)], mid === "grille" ? SW.TRIM : mid, out);
      continue;
    }
    const chamfer = (a.inset ?? 0) > 0 || (b.inset ?? 0) > 0 || (a.drop ?? 0) > 0 || (b.drop ?? 0) > 0;
    const cornerSw = e.corner ?? PAINT_SLOT;
    if (chamfer) {
      for (const sgn of [1, -1] as const) {
        vb.face([side(a, sgn), side(b, sgn), inner(b, sgn), inner(a, sgn)], cornerSw, [out[0], sgn, out[2]]);
      }
    }
    const q = chamfer ? [inner(a, 1), inner(b, 1), inner(b, -1), inner(a, -1)] : [side(a, 1), side(b, 1), side(b, -1), side(a, -1)];
    if (mid === "grille") {
      const [gx, gy, gw, gh] = GRILLE_TILE, U = (x: number, y: number): [number, number] => [x / ATLAS_W, y / ATLAS_H];
      // q runs a(left), b(left), b(right), a(right); a is the grille's bottom.
      vb.face(q, [U(gx, gy + gh), U(gx, gy), U(gx + gw, gy), U(gx + gw, gy + gh)], out);
    } else {
      vb.face(q, mid, out);
    }
  }
}

/** Points of an arch (a circle about (d, h) of radius r, cut at height `cut`), from the rear end to the front, `segs` segments. */
export function archPoints(d: number, h: number, r: number, cut: number, segs: number, hw: number): SilPt[] {
  const a0 = Math.asin(Math.max(-1, Math.min(1, (cut - h) / r)));
  const out: SilPt[] = [];
  for (let k = 0; k <= segs; k++) {
    const a = a0 + ((Math.PI - 2 * a0) * k) / segs;
    out.push({ d: d + r * Math.cos(a), h: h + r * Math.sin(a), hw });
  }
  return out;
}

/**
 * The wheel wells' inner walls: a dark panel behind each arch, both sides, at `s` from the middle
 * (just inside the tyres), so the gap over a tyre shows a dark well rather than through the body.
 */
export function wheelWells(vb: VehicleBuilder, len: number, axles: number[], h: number, r: number, cut: number, s: number): void {
  for (const d of axles) {
    const f0 = len / 2 - d - r, f1 = len / 2 - d + r, top = h + r;
    for (const sgn of [1, -1]) vb.face([[f0, sgn * s, cut], [f1, sgn * s, cut], [f1, sgn * s, top], [f0, sgn * s, top]], SW.TRIM, [0, sgn, 0]);
  }
}

/** Black flares round an arch, on both sides, a little proud of the body. */
export function archFlares(vb: VehicleBuilder, len: number, d: number, h: number, r: number, cut: number, segs: number, hw: number, width = 0.07): void {
  const a0 = Math.asin(Math.max(-1, Math.min(1, (cut - h) / r)));
  for (const sgn of [1, -1] as const) {
    const s = sgn * (hw + 0.012);
    for (let k = 0; k < segs; k++) {
      const a = a0 + ((Math.PI - 2 * a0) * k) / segs, b = a0 + ((Math.PI - 2 * a0) * (k + 1)) / segs;
      const P = (ang: number, rr: number): V3 => [len / 2 - (d + rr * Math.cos(ang)), s, h + rr * Math.sin(ang)];
      vb.face([P(a, r), P(b, r), P(b, r + width), P(a, r + width)], SW.TRIM, [0, sgn, 0]);
    }
  }
}

/** One glasshouse station: where a pillar or window edge meets the belt (base) and the roof (top). */
export interface GlassLine {
  base: number;
  top: number;
}

export interface Glasshouse {
  /** Belt heights at the first and last base points; roof heights at the first and last top points. */
  belt: [number, number];
  roof: [number, number];
  /** Half widths at the belt and at the roof. */
  baseHw: number;
  roofHw: number;
  /** The stations front to back; the side panel between two stations takes `panels[i]`. */
  lines: GlassLine[];
  panels: number[];
  /** Height of the paint below the rear window, on the back face (0: all glass). */
  rearPaint?: number;
}

/** The cab: windscreen, roof, back, and the sides split into pillars and windows. */
export function glasshouse(vb: VehicleBuilder, len: number, g: Glasshouse): void {
  const first = g.lines[0], last = g.lines[g.lines.length - 1];
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const beltAt = (d: number) => lerp(g.belt[0], g.belt[1], (d - first.base) / (last.base - first.base || 1));
  const roofAt = (d: number) => lerp(g.roof[0], g.roof[1], (d - first.top) / (last.top - first.top || 1));
  const B = (d: number, sgn: number): V3 => [len / 2 - d, sgn * g.baseHw, beltAt(d)];
  const T = (d: number, sgn: number): V3 => [len / 2 - d, sgn * g.roofHw, roofAt(d)];
  // Windscreen, roof.
  vb.face([B(first.base, 1), B(first.base, -1), T(first.top, -1), T(first.top, 1)], SW.GLASS, [1, 0, 0.6]);
  vb.face([T(first.top, 1), T(first.top, -1), T(last.top, -1), T(last.top, 1)], PAINT_SLOT, [0, 0, 1]);
  // Back: paint up to rearPaint above the belt, then glass.
  const rp = g.rearPaint ?? 0;
  if (rp > 0) {
    const t = rp / (roofAt(last.top) - beltAt(last.base));
    const M = (sgn: number): V3 => {
      const b = B(last.base, sgn), tp = T(last.top, sgn);
      return [lerp(b[0], tp[0], t), lerp(b[1], tp[1], t), lerp(b[2], tp[2], t)];
    };
    vb.face([B(last.base, 1), B(last.base, -1), M(-1), M(1)], PAINT_SLOT, [-1, 0, 0]);
    vb.face([M(1), M(-1), T(last.top, -1), T(last.top, 1)], SW.GLASS, [-1, 0, 0.2]);
  } else {
    vb.face([B(last.base, 1), B(last.base, -1), T(last.top, -1), T(last.top, 1)], SW.GLASS, [-1, 0, 0.2]);
  }
  // Sides.
  for (const sgn of [1, -1]) {
    for (let i = 0; i + 1 < g.lines.length; i++) {
      const a = g.lines[i], b = g.lines[i + 1];
      vb.face([B(a.base, sgn), B(b.base, sgn), T(b.top, sgn), T(a.top, sgn)], g.panels[i] ?? SW.GLASS, [0, sgn, 0.3]);
    }
  }
}

/**
 * An open tray: rail tops, inner walls and floor, between d0 (behind the cab) and d1 (the tailgate's
 * outside). Paint rails and a dark liner unless told otherwise (an alloy tray is alloy all over).
 */
export function openTray(vb: VehicleBuilder, len: number, d0: number, d1: number, rail: number, floor: number, hw: number, wall = 0.05,
  railSw: number = PAINT_SLOT, linerSw: number = SW.LINER): void {
  const f0 = len / 2 - d0, f1 = len / 2 - d1, wi = hw - wall;
  // Rails: left, right, tailgate top.
  vb.face([[f0, hw, rail], [f1, hw, rail], [f1, wi, rail], [f0, wi, rail]], railSw, [0, 0, 1]);
  vb.face([[f0, -hw, rail], [f1, -hw, rail], [f1, -wi, rail], [f0, -wi, rail]], railSw, [0, 0, 1]);
  vb.face([[f1 + wall, wi, rail], [f1, wi, rail], [f1, -wi, rail], [f1 + wall, -wi, rail]], railSw, [0, 0, 1]);
  // Inner walls facing in, and the floor.
  const g0 = f0, g1 = f1 + wall;
  vb.face([[g0, wi, floor], [g1, wi, floor], [g1, wi, rail], [g0, wi, rail]], linerSw, [0, -1, 0]);
  vb.face([[g0, -wi, floor], [g1, -wi, floor], [g1, -wi, rail], [g0, -wi, rail]], linerSw, [0, 1, 0]);
  vb.face([[g1, wi, floor], [g1, -wi, floor], [g1, -wi, rail], [g1, wi, rail]], linerSw, [1, 0, 0]);
  vb.face([[g0, wi, floor], [g0, -wi, floor], [g0, -wi, rail], [g0, wi, rail]], linerSw, [-1, 0, 0]);
  vb.face([[g0, wi, floor], [g1, wi, floor], [g1, -wi, floor], [g0, -wi, floor]], linerSw, [0, 0, 1]);
}

/**
 * A wheel at (f, s) of radius r and width w: `sides` tread faces and, with `face`, the outer face
 * drawn from the wheel tile. Four sides give a plain block, for far LODs. The polygon's flat bottom
 * sits on the ground (h = 0), so the tyre stands on it rather than 3 cm above.
 */
export function wheel(vb: VehicleBuilder, f: number, s: number, r: number, w: number, sides: number, withFace: boolean): void {
  const sgn = Math.sign(s) || 1, so = s + (sgn * w) / 2, si = s - (sgn * w) / 2;
  if (sides === 4) {
    // A block like today's boxy car: outer face, front and back (top and bottom are never seen).
    const a = r * 0.85, lo = 0, hi = r * 1.62;
    vb.face([[f - a, so, lo], [f + a, so, lo], [f + a, so, hi], [f - a, so, hi]], SW.TYRE, [0, sgn, 0]);
    vb.face([[f + a, so, lo], [f + a, si, lo], [f + a, si, hi], [f + a, so, hi]], SW.TYRE, [1, 0, 0]);
    vb.face([[f - a, so, lo], [f - a, si, lo], [f - a, si, hi], [f - a, so, hi]], SW.TYRE, [-1, 0, 0]);
    return;
  }
  const c = wheelCentre(r, sides); // the bottom flat on the ground
  const ring = (sv: number) => [...Array(sides).keys()].map((k): V3 => {
    const a = (Math.PI * 2 * (k + 0.5)) / sides;
    return [f + r * Math.cos(a), sv, c + r * Math.sin(a)];
  });
  const o = ring(so), i = ring(si);
  for (let k = 0; k < sides; k++) {
    const k2 = (k + 1) % sides, a = (Math.PI * 2 * (k + 1)) / sides;
    if (o[k][2] < 0.005 && o[k2][2] < 0.005) continue; // flat on the ground: never seen
    if (o[k][2] > c + r * 0.9 && o[k2][2] > c + r * 0.9) continue; // the top, up in the arch: never seen
    vb.face([o[k], o[k2], i[k2], i[k]], SW.TYRE, [Math.cos(a), 0, Math.sin(a)]);
  }
  if (withFace) {
    const [tx, ty, tw, th] = WHEEL_TILE;
    const uvs = [...Array(sides).keys()].map((k): [number, number] => {
      const a = (Math.PI * 2 * (k + 0.5)) / sides;
      return [(tx + tw / 2 + (tw / 2) * Math.cos(a)) / ATLAS_W, (ty + th / 2 - (th / 2) * Math.sin(a)) / ATLAS_H];
    });
    vb.face(o, uvs, [0, sgn, 0]);
  } else {
    vb.face(o, SW.TYRE, [0, sgn, 0]);
  }
}

/** Height of a wheel's centre above the ground (the polygon's flat bottom on the ground). */
export function wheelCentre(r: number, sides = 8): number {
  return r * Math.cos(Math.PI / sides);
}

/**
 * A body's overall size, what phase 2 seats and collides it by: body length, width (not mirrors),
 * roof height, wheelbase and track (tyre centre to tyre centre), metres. `frontAxle` is the front
 * axle's f (forward of the middle; the rear axle is at frontAxle - wheelbase), `wheelRadius` the tyre's.
 */
export interface Dimensions {
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  track: number;
  frontAxle: number;
  wheelRadius: number;
}

/** The fields every body spec has, from published overall dimensions. */
export interface BaseSpec {
  /** Body length, width (body, not mirrors) and roof height, metres. */
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  frontOverhang: number;
  wheelRadius: number;
  /** Centre of tyre to centre of tyre across an axle. */
  track: number;
  tyreWidth: number;
}

export function dimensionsOf(s: BaseSpec): Dimensions {
  return {
    length: s.length, width: s.width, height: s.height, wheelbase: s.wheelbase, track: s.track,
    frontAxle: s.length / 2 - s.frontOverhang, wheelRadius: s.wheelRadius,
  };
}

/** The furthest the mesh reaches each way (extras included), for collision boxes and bay fits. */
export function meshExtent(m: VehicleMesh): { front: number; rear: number; halfWidth: number; top: number } {
  let front = -Infinity, rear = Infinity, hw = 0, top = 0;
  for (let i = 0; i < m.pos.length; i += 3) {
    front = Math.max(front, m.pos[i]);
    rear = Math.min(rear, m.pos[i]);
    hw = Math.max(hw, Math.abs(m.pos[i + 1]));
    top = Math.max(top, m.pos[i + 2]);
  }
  return { front, rear, halfWidth: hw, top };
}

/**
 * A silhouette being drawn: points and the edges after them, some only at LOD 0. At LOD 1 those are
 * dropped, all rounding is flattened (one strip per edge) and the grille becomes plain trim.
 */
export class Sil {
  readonly pts: SilPt[] = [];
  readonly edges: SilEdge[] = [];
  private readonly nearOnly: boolean[] = [];

  add(p: SilPt, e: SilEdge, nearOnly = false): void {
    this.pts.push(p);
    this.edges.push(e);
    this.nearOnly.push(nearOnly);
  }

  /** The arches, rear then front (null: no rear arch), each from its rear end, liners across the top. */
  arches(rearAxle: number | null, frontAxle: number, h: number, r: number, cut: number, segs: number, hw: number): void {
    for (const d of rearAxle === null ? [frontAxle] : [rearAxle, frontAxle]) {
      for (const [i, p] of archPoints(d, h, r, cut, segs, hw).entries()) this.add(p, { kind: i < segs ? "across" : "skip", mid: SW.TRIM });
    }
    this.wells = { axles: rearAxle === null ? [frontAxle] : [rearAxle, frontAxle], h, r, cut };
  }

  private wells?: { axles: number[]; h: number; r: number; cut: number };

  /** Draw it as the lower body, and near, the wheel wells behind its arches (just inside the spec's tyres). */
  build(vb: VehicleBuilder, len: number, near: boolean, spec?: BaseSpec): void {
    const { pts, edges } = this.forLod(near);
    lowerBody(vb, len, pts, edges);
    if (near && this.wells && spec) {
      const w = this.wells;
      wheelWells(vb, len, w.axles, w.h, w.r, w.cut, spec.track / 2 - spec.tyreWidth / 2 - 0.02);
    }
  }

  forLod(near: boolean): { pts: SilPt[]; edges: SilEdge[] } {
    if (near) return { pts: this.pts, edges: this.edges };
    const pts: SilPt[] = [], edges: SilEdge[] = [];
    this.pts.forEach((p, i) => {
      if (this.nearOnly[i]) return;
      pts.push({ d: p.d, h: p.h, hw: p.hw });
      const e = this.edges[i];
      edges.push(e.mid === "grille" ? { ...e, mid: SW.TRIM } : e);
    });
    return { pts, edges };
  }

  /**
   * Where the body's middle (s = 0) is at height h, as distance back from the front: the front-most
   * crossing of the silhouette's front half, or the rear-most of its rear half.
   */
  surfaceAt(h: number, end: "front" | "rear", len: number, near: boolean): number {
    const { pts, edges } = this.forLod(near);
    let best = end === "front" ? Infinity : -Infinity;
    for (let i = 0; i < pts.length; i++) {
      if (edges[i].kind !== "body") continue;
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a.d + b.d) / 2 < len / 2 !== (end === "front")) continue;
      if (h < Math.min(a.h, b.h) || h > Math.max(a.h, b.h) || a.h === b.h) continue;
      const d = a.d + ((b.d - a.d) * (h - a.h)) / (b.h - a.h);
      best = end === "front" ? Math.min(best, d) : Math.max(best, d);
    }
    return best;
  }
}

/** The four wheels: 8 sides with a drawn face near, plain blocks far. */
export function wheels(vb: VehicleBuilder, s: BaseSpec, near: boolean): void {
  const tr = s.track / 2, fa = s.frontOverhang;
  for (const d of [fa, fa + s.wheelbase]) for (const side of [tr, -tr]) wheel(vb, s.length / 2 - d, side, s.wheelRadius, s.tyreWidth, near ? 8 : 4, near);
}

/** Australian plate size, metres. */
export const PLATE_W = 0.372, PLATE_H = 0.134;

/**
 * A number plate: a plain white rectangle (never text), centred at height h on the front or rear of
 * the silhouette's middle (or `s` to one side), following the face's slope, just proud of it.
 */
export function numberPlate(vb: VehicleBuilder, len: number, sil: Sil, h: number, end: "front" | "rear", near: boolean, s = 0): void {
  const h0 = h - PLATE_H / 2, h1 = h + PLATE_H / 2, sgn = end === "front" ? 1 : -1;
  const f = (hh: number) => len / 2 - sil.surfaceAt(hh, end, len, near) + sgn * 0.012;
  const fa = f(h0), fb = f(h1), w = PLATE_W / 2;
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return;
  vb.face([[fa, s + w, h0], [fa, s - w, h0], [fb, s - w, h1], [fb, s + w, h1]], SW.PLATE, [sgn, 0, 0]);
}

/** A plate on a flat upright face at f (a tray's back, a bar), facing forward (+1) or back (-1). */
export function plateAt(vb: VehicleBuilder, f: number, h: number, dir: 1 | -1): void {
  const w = PLATE_W / 2, h0 = h - PLATE_H / 2, h1 = h + PLATE_H / 2, ff = f + dir * 0.01;
  vb.face([[ff, w, h0], [ff, -w, h0], [ff, -w, h1], [ff, w, h1]], SW.PLATE, [dir, 0, 0]);
}

/**
 * A tow bar: the receiver tube out from under the rear bumper (its front end inside the body at fIn)
 * and the ball mount's upright at its end, about 0.2 m behind the body. Near only (it's small).
 */
export function towBar(vb: VehicleBuilder, len: number, fIn: number, h = 0.38): void {
  const back = -len / 2 - 0.2;
  vb.box([back + 0.06, fIn], [-0.035, 0.035], [h, h + 0.07], SW.TRIM, ["bottom", "front", "back"]);
  vb.box([back, back + 0.06], [-0.03, 0.03], [h, h + 0.15], SW.CHROME, ["bottom", "front", "top"]);
}

/**
 * A spare wheel on a back door: axis along f, its inner face against the door at f, centred at
 * (s, h). Near: 8 tread faces, the tyre's back face and a black cover; far: a block.
 */
export function spareWheel(vb: VehicleBuilder, f: number, s: number, h: number, r: number, w: number, near: boolean): void {
  const fo = f - w;
  if (!near) {
    const a = r * 0.85;
    vb.box([fo, f], [s - a, s + a], [h - a, h + a], SW.TYRE, ["front", "bottom"]);
    return;
  }
  const sides = 8;
  const ring = (fv: number, rr: number) => [...Array(sides).keys()].map((k): V3 => {
    const a = (Math.PI * 2 * (k + 0.5)) / sides;
    return [fv, s + rr * Math.cos(a), h + rr * Math.sin(a)];
  });
  const o = ring(fo, r), i = ring(f, r);
  for (let k = 0; k < sides; k++) {
    const k2 = (k + 1) % sides, a = (Math.PI * 2 * (k + 1)) / sides;
    vb.face([o[k], o[k2], i[k2], i[k]], SW.TYRE, [0, Math.cos(a), Math.sin(a)]);
  }
  // A black cover a little proud, smaller than the tyre so a ring of tyre shows round it.
  vb.face(ring(fo - 0.006, r * 0.8), SW.TRIM, [-1, 0, 0]);
  vb.face(o, SW.TYRE, [-1, 0, 0]);
}
