// Busselton fork: a house built from a spec, the same spec scripts/blender/house.py renders (its
// "parts" mode): blocks of walls each with a hip or gable roof, gable ends, verandahs, doors,
// windows, fences, hedges and trees, placed on the map facing its street. For houses we know well
// (step 1 of the per-house plan in docs/one-map.md's sibling ROADMAP section). A real house's spec
// is private (routes/private/), so nothing here knows any place.
//
// Spec coordinates are metres: x across the front, left to right as seen from the street; y back
// from the house's front-most wall; z up from the slab.

import type { Vec2 } from "./geo";
import type { Kn5MeshNode } from "./kn5";
import { MeshBuilder, type Vec3 } from "./mesh";
import { ROOF_COLOURS, type Facade, type WallKind } from "./buildingStyles";
import type { TreeSpot } from "./scenery";

export interface SpecBlock {
  name: string;
  x0: number; x1: number; y0: number; y1: number;
  roof?: "hip" | "gable" | "none";
  walls?: string;
  wallHeight?: number;
  eaves?: number;
  pitch?: number;
  /** Left out when centring the house on its map position (a shed out the back). */
  outbuilding?: boolean;
}

export interface HouseSpec {
  wallHeight?: number;
  walls?: { kind?: string; colour?: string; lap?: number };
  finishes?: Record<string, { kind?: string; colour?: string }>;
  trim?: string;
  roof?: { pitch?: number; colour?: string; eaves?: number };
  blocks: SpecBlock[];
  panels?: { x0: number; x1: number; y0: number; y1: number; z0?: number; z1?: number; walls: string }[];
  verandahs?: { x0: number; x1: number; y0: number; y1: number; height?: number; deckHeight?: number; posts?: number[]; wallHeight?: number }[];
  doors?: { type: "front" | "garage" | "roller"; x0: number; x1: number; y: number; height?: number; z0?: number; colour?: string }[];
  windows?: { facing: "front" | "back" | "left" | "right"; wall: number; at: number; width?: number; height?: number; sill?: number }[];
  fences?: { x0: number; y0: number; x1: number; y1: number; height?: number; colour?: string; open?: boolean }[];
  hedges?: { x0: number; x1: number; y0: number; depth?: number; height?: number }[];
  trees?: { x: number; y: number; height: number; spread?: number }[];
  /** Flat paving (brick, concrete) laid on the ground. */
  paving?: { x0: number; y0: number; x1: number; y1: number; colour?: string }[];
  /** Outdoor tables with bench seats (picnic style), `along` x unless `turned`. */
  tables?: { x: number; y: number; length?: number; turned?: boolean; colour?: string }[];
  /** Market umbrellas: a pole and an eight-sided canopy. */
  umbrellas?: { x: number; y: number; radius?: number; height?: number; colour?: string }[];
  /** Shade sails: three or four corners [x, y, z], with a post up to each corner more than 1 m up. */
  sails?: { pts: [number, number, number][]; colour?: string }[];
  /** Feather flags on a pole, facing the street. */
  flags?: { x: number; y: number; height?: number; colour?: string }[];
  /** A sign board facing the street, lettered with `text`, on two posts when `posts`. */
  signs?: { x0: number; x1: number; y: number; z0: number; z1: number; text?: string; colour?: string; ink?: string; posts?: boolean }[];
}

type RGB = [number, number, number];
const hex = (h: string | undefined, fallback: RGB): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h ?? "");
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const KINDS: WallKind[] = ["brick", "weatherboard", "fibro", "render", "cladding", "corrugated", "panel"];
const wallKind = (k: string | undefined): WallKind => (k === "timber" ? "cladding" : KINDS.includes(k as WallKind) ? (k as WallKind) : "render");

/** Where the house goes: its spec's centre at `centre`, `toRoad` the unit direction to its street, slab at `z`. */
export interface SpecPlacement {
  centre: Vec2;
  toRoad: Vec2;
  z: number;
}

export interface SpecHouse {
  nodes: Kn5MeshNode[];
  /** Wall finishes it needs: facade_<name> materials with upstream's facade textures. */
  facades: Facade[];
  /** Roof finish (index into ROOF_COLOURS) it wears. */
  roof: number;
  /** Plain colours it needs: material name and colour. */
  solids: { name: string; rgb: RGB }[];
  trees: TreeSpot[];
  /** Each block's footprint on the map, counter-clockwise (to clear generated houses away). */
  footprints: Vec2[][];
  /** Lettered sign faces: material name, text and colours, and the board's size in metres (for the texture's shape). */
  signs: { name: string; text: string; bg: RGB; ink: RGB; width: number; height: number }[];
}

export function nearestRoof(rgb: RGB): number {
  let best = 0, bd = Infinity;
  ROOF_COLOURS.forEach((r, i) => {
    if (r.kind === "membrane" || r.kind === "gravel") return;
    const d = (r.rgb[0] - rgb[0]) ** 2 + (r.rgb[1] - rgb[1]) ** 2 + (r.rgb[2] - rgb[2]) ** 2;
    if (d < bd) [best, bd] = [i, d];
  });
  return best;
}

const PERIOD = 4, STOREY = 3; // the "blank" facade layout: 4 m along by 3 m up

export function buildSpecHouse(spec: HouseSpec, place: SpecPlacement, tag: string): SpecHouse {
  const H0 = spec.wallHeight ?? 2.7;
  const pitchDeg = spec.roof?.pitch ?? 24, eaves0 = spec.roof?.eaves ?? 0.45;
  // Centre on the house proper (outbuildings left out).
  const main = spec.blocks.filter((b) => !b.outbuilding);
  const cx = (Math.min(...main.map((b) => b.x0)) + Math.max(...main.map((b) => b.x1))) / 2;
  const cy = (Math.min(...main.map((b) => b.y0)) + Math.max(...main.map((b) => b.y1))) / 2;
  const o = place.toRoad, t: Vec2 = [-o[1], o[0]];
  const W = (x: number, y: number, z: number): Vec3 => [
    place.centre[0] + t[0] * (x - cx) - o[0] * (y - cy),
    place.centre[1] + t[1] * (x - cx) - o[1] * (y - cy),
    place.z + z,
  ];

  // Finishes: the main walls, and any named in `finishes`.
  const facades: Facade[] = [];
  const trimRgb = hex(spec.trim, [242, 242, 239]);
  const facadeFor = new Map<string, string>();
  const finish = (key: string) => {
    if (!facadeFor.has(key)) {
      const f = key === "main" ? spec.walls ?? {} : spec.finishes?.[key] ?? { kind: "render", colour: "#e8e8e5" };
      const name = `spec_${tag}_${key}`;
      facades.push({ name, wall: wallKind(f.kind), colour: hex(f.colour, [200, 200, 196]), trim: trimRgb, layout: "blank" });
      facadeFor.set(key, `facade_${name}`);
    }
    return facadeFor.get(key)!;
  };
  const roof = nearestRoof(hex(spec.roof?.colour, [228, 226, 213]));
  const roofMat = `roof_${ROOF_COLOURS[roof].name}`;
  const solids: { name: string; rgb: RGB }[] = [];
  const solid = (name: string, rgb: RGB) => {
    const n = `spec_${tag}_${name}`;
    if (!solids.some((s) => s.name === n)) solids.push({ name: n, rgb });
    return n;
  };
  const trim = solid("trim", trimRgb);

  // One mesh per material; walls also go in a physics mesh.
  const meshes = new Map<string, MeshBuilder>();
  const mesh = (mat: string) => {
    if (!meshes.has(mat)) {
      const mb = new MeshBuilder();
      mb.normals = [];
      meshes.set(mat, mb);
    }
    return meshes.get(mat)!;
  };
  const solidWalls = new MeshBuilder();
  solidWalls.normals = [];

  /** A flat polygon (counter-clockwise seen from the side it faces), with UVs from `uv`. */
  const poly = (mb: MeshBuilder, pts: Vec3[], uv: (p: Vec3, k: number) => [number, number]) => {
    const [a, b, c] = pts;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    const i0 = mb.vertexCount;
    pts.forEach((p, k) => {
      mb.vertex(p, ...uv(p, k));
      mb.normals!.push(nx / l, ny / l, nz / l);
    });
    for (let k = 1; k < pts.length - 1; k++) mb.tri(i0, i0 + k, i0 + k + 1);
  };
  const planar = (p: Vec3): [number, number] => [p[0] / 2, -p[1] / 2];
  /** An axis-aligned box in spec coordinates; `wallUv` textures its sides as a facade. */
  const box = (mat: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, wallUv = false, physics = false) => {
    const mb = mesh(mat);
    const c: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = c[k], [bx, by] = c[(k + 1) % 4];
      const len = Math.hypot(bx - ax, by - ay);
      const pts = [W(ax, ay, z0), W(bx, by, z0), W(bx, by, z1), W(ax, ay, z1)];
      const uv = wallUv
        ? (_p: Vec3, j: number): [number, number] => [(j === 1 || j === 2 ? len : 0) / PERIOD, 1 - (j < 2 ? z0 : z1) / STOREY]
        : (_p: Vec3, j: number): [number, number] => [(j === 1 || j === 2 ? len : 0) / 2, -(j < 2 ? z0 : z1) / 2];
      poly(mb, pts, uv);
      if (physics) poly(solidWalls, pts, uv);
    }
    poly(mb, [W(x0, y0, z1), W(x1, y0, z1), W(x1, y1, z1), W(x0, y1, z1)], planar);
  };

  const footprints: Vec2[][] = [];
  for (const b of spec.blocks) {
    const H = b.wallHeight ?? H0;
    const wm = finish(b.walls ?? "main");
    box(wm, b.x0, b.y0, -0.3, b.x1, b.y1, H, true, true);
    footprints.push([[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(([x, y]) => W(x, y, 0).slice(0, 2) as Vec2));
    const kind = b.roof ?? "hip";
    if (kind === "none") continue;
    const ev = b.eaves ?? eaves0, pitch = Math.tan(((b.pitch ?? pitchDeg) * Math.PI) / 180);
    const X0 = b.x0 - ev, X1 = b.x1 + ev, Y0 = b.y0 - ev, Y1 = b.y1 + ev;
    const w = X1 - X0, d = Y1 - Y0;
    const rm = mesh(roofMat);
    // Soffit under the eaves, and fascia round them.
    poly(mesh(trim), [W(X0, Y0, H), W(X0, Y1, H), W(X1, Y1, H), W(X1, Y0, H)], planar);
    for (const [ax, ay, bx, by] of [[X0, Y0, X1, Y0], [X1, Y0, X1, Y1], [X1, Y1, X0, Y1], [X0, Y1, X0, Y0]]) {
      poly(mesh(trim), [W(ax, ay, H - 0.2), W(bx, by, H - 0.2), W(bx, by, H), W(ax, ay, H)], planar);
    }
    const up = (pts: Vec3[]) => {
      // Faces upward whichever way the points were listed.
      const [a, bq, c] = pts;
      const nz = (bq[0] - a[0]) * (c[1] - a[1]) - (bq[1] - a[1]) * (c[0] - a[0]);
      poly(rm, nz >= 0 ? pts : [...pts].reverse(), planar);
    };
    if (w >= d) {
      const h = (d / 2) * pitch, inset = kind === "hip" ? d / 2 : 0, ym = (Y0 + Y1) / 2;
      const r0 = W(X0 + inset, ym, H + h), r1 = W(X1 - inset, ym, H + h);
      up([W(X0, Y0, H), W(X1, Y0, H), r1, r0]);
      up([W(X1, Y1, H), W(X0, Y1, H), r0, r1]);
      if (kind === "hip") {
        up([W(X1, Y0, H), W(X1, Y1, H), r1]);
        up([W(X0, Y1, H), W(X0, Y0, H), r0]);
      } else {
        for (const xx of [b.x0, b.x1]) {
          const hh = H + ((b.y1 - b.y0) / 2) * pitch, ymid = (b.y0 + b.y1) / 2;
          const tri = [W(xx, b.y0, H), W(xx, b.y1, H), W(xx, ymid, hh)];
          poly(mesh(wm), xx === b.x0 ? [...tri].reverse() : tri, (_p, j) => [j === 1 ? (b.y1 - b.y0) / PERIOD : j === 2 ? (b.y1 - b.y0) / 2 / PERIOD : 0, 1 - (j === 2 ? hh : H) / STOREY]);
        }
      }
    } else {
      const h = (w / 2) * pitch, inset = kind === "hip" ? w / 2 : 0, xm = (X0 + X1) / 2;
      const r0 = W(xm, Y0 + inset, H + h), r1 = W(xm, Y1 - inset, H + h);
      up([W(X1, Y0, H), W(X1, Y1, H), r1, r0]);
      up([W(X0, Y1, H), W(X0, Y0, H), r0, r1]);
      if (kind === "hip") {
        up([W(X0, Y0, H), W(X1, Y0, H), r0]);
        up([W(X1, Y1, H), W(X0, Y1, H), r1]);
      } else {
        for (const yy of [b.y0, b.y1]) {
          const hh = H + ((b.x1 - b.x0) / 2) * pitch, xmid = (b.x0 + b.x1) / 2;
          // The front gable end faces the street (-y); the back one faces away.
          const tri = [W(b.x0, yy, H), W(b.x1, yy, H), W(xmid, yy, hh)];
          poly(mesh(wm), yy === b.y0 ? tri : [...tri].reverse(), (_p, j) => [j === 1 ? (b.x1 - b.x0) / PERIOD : j === 2 ? (b.x1 - b.x0) / 2 / PERIOD : 0, 1 - (j === 2 ? hh : H) / STOREY]);
          if (yy === b.y0) {
            // White barge boards up the rakes.
            for (const [ax, bx] of [[X0, xmid], [X1, xmid]]) {
              const za = H - 0.05, zb = H + ((X1 - X0) / 2) * pitch;
              poly(mesh(trim), ax < bx
                ? [W(ax, Y0 - 0.03, za - 0.2), W(bx, Y0 - 0.03, zb - 0.2), W(bx, Y0 - 0.03, zb), W(ax, Y0 - 0.03, za)]
                : [W(bx, Y0 - 0.03, zb - 0.2), W(ax, Y0 - 0.03, za - 0.2), W(ax, Y0 - 0.03, za), W(bx, Y0 - 0.03, zb)], planar);
            }
          }
        }
      }
    }
  }
  for (const p of spec.panels ?? []) box(finish(p.walls), p.x0, p.y0, p.z0 ?? 0, p.x1, p.y1, p.z1 ?? H0, true);

  const deck = solid("deck", [138, 106, 79]);
  for (const v of spec.verandahs ?? []) {
    const H = v.wallHeight ?? H0, lo = v.height ?? H - 0.25;
    box(deck, v.x0, v.y0, -0.2, v.x1, v.y1, v.deckHeight ?? 0.25);
    for (const px of v.posts ?? []) box(trim, px - 0.06, v.y0 + 0.1, 0, px + 0.06, v.y0 + 0.22, lo);
    box(trim, v.x0, v.y0 + 0.08, lo - 0.18, v.x1, v.y0 + 0.24, lo);
    const top = [W(v.x0, v.y0 - 0.2, lo), W(v.x1, v.y0 - 0.2, lo), W(v.x1, v.y1, H + 0.15), W(v.x0, v.y1, H + 0.15)];
    poly(mesh(roofMat), top, planar);
    poly(mesh(trim), [...top].reverse(), planar);
  }
  spec.doors?.forEach((dr, k) => {
    const z1 = dr.height ?? (dr.type === "front" ? 2.2 : 2.3), z0 = dr.z0 ?? (dr.type === "front" ? 0.25 : 0);
    const col = hex(dr.colour, dr.type === "garage" ? [236, 235, 230] : [47, 43, 40]);
    box(solid(`door${k}`, col), dr.x0, dr.y - 0.04, z0, dr.x1, dr.y + 0.02, z1);
    if (dr.type === "front") box("window", dr.x0 + 0.1, dr.y - 0.05, z0 + 0.2, dr.x0 + 0.25, dr.y - 0.03, z1 - 0.2);
    box(trim, dr.x0 - 0.06, dr.y - 0.06, z1, dr.x1 + 0.06, dr.y + 0.02, z1 + 0.08);
  });
  for (const w of spec.windows ?? []) {
    const ww = w.width ?? 1.4, wh = w.height ?? 1.4, sill = w.sill ?? 0.9;
    const along = w.facing === "front" || w.facing === "back";
    const r = (hi: number, ho: number) => (along ? [w.at - hi, w.wall - ho, w.at + hi, w.wall + ho] : [w.wall - ho, w.at - hi, w.wall + ho, w.at + hi]);
    const [f0, f1, f2, f3] = r(ww / 2 + 0.07, 0.06);
    box(trim, f0, f1, sill - 0.07, f2, f3, sill + wh + 0.07);
    const [g0, g1, g2, g3] = r(ww / 2, 0.08);
    box("window", g0, g1, sill, g2, g3, sill + wh);
  }
  spec.fences?.forEach((f, k) => {
    const m = solid(`fence${k}`, hex(f.colour, [236, 235, 230])), H = f.height ?? 1.8;
    if (!f.open) return box(m, f.x0, f.y0, -0.2, f.x1, f.y1, H, false, true);
    // An open rail: posts every 1.8 m and a top rail (what the car hits is still the whole run).
    const along = Math.abs(f.x1 - f.x0) >= Math.abs(f.y1 - f.y0), L = along ? f.x1 - f.x0 : f.y1 - f.y0;
    const n = Math.max(1, Math.round(Math.abs(L) / 1.8));
    const mx = (f.x0 + f.x1) / 2, my = (f.y0 + f.y1) / 2;
    for (let i = 0; i <= n; i++) {
      const q = (along ? f.x0 : f.y0) + (L * i) / n;
      if (along) box(m, q - 0.05, my - 0.05, -0.2, q + 0.05, my + 0.05, H - 0.12);
      else box(m, mx - 0.05, q - 0.05, -0.2, mx + 0.05, q + 0.05, H - 0.12);
    }
    box(m, f.x0, f.y0 - (along ? 0.06 : 0), H - 0.15, f.x1, f.y1 + (along ? 0.06 : 0), H);
    const wire = solid("wire", [150, 150, 150]);
    for (const z of [0.35, 0.6, 0.85]) if (z < H - 0.2) box(wire, f.x0, f.y0 + (along ? 0.0 : 0), z, f.x1, f.y1, z + 0.008);
    const c: [number, number][] = [[f.x0, f.y0], [f.x1, f.y0], [f.x1, f.y1], [f.x0, f.y1]];
    for (let j = 0; j < 4; j++) {
      const [ax, ay] = c[j], [bx, by] = c[(j + 1) % 4];
      poly(solidWalls, [W(ax, ay, -0.2), W(bx, by, -0.2), W(bx, by, H), W(ax, ay, H)], planar);
    }
  });
  for (const h of spec.hedges ?? []) box("hedge", h.x0, h.y0, -0.2, h.x1, h.y0 + (h.depth ?? 0.9), h.height ?? 1.2);
  const trees: TreeSpot[] = (spec.trees ?? []).map((tr) => {
    const p = W(tr.x, tr.y, 0);
    return { x: p[0], y: p[1], scale: Math.max(0.5, Math.min(1.2, tr.height / 7)), variant: 0 };
  });

  // The yard: paving, tables, umbrellas, shade sails, flags and signs.
  /** Both faces of a thin surface. */
  const twoSided = (mat: string, pts: Vec3[]) => {
    poly(mesh(mat), pts, planar);
    poly(mesh(mat), [...pts].reverse(), planar);
  };
  for (const [k, pv] of (spec.paving ?? []).entries()) {
    poly(mesh(solid(`paving${k}`, hex(pv.colour, [156, 84, 64]))), [W(pv.x0, pv.y0, 0.03), W(pv.x1, pv.y0, 0.03), W(pv.x1, pv.y1, 0.03), W(pv.x0, pv.y1, 0.03)], planar);
  }
  for (const tb of spec.tables ?? []) {
    const m = solid(`table_${(tb.colour ?? "#5a3d2b").slice(1)}`, hex(tb.colour, [90, 61, 43]));
    const L = (tb.length ?? 1.8) / 2;
    const at = (a: number, c: number): [number, number] => (tb.turned ? [tb.x + c, tb.y + a] : [tb.x + a, tb.y + c]);
    const slab = (a0: number, c0: number, a1: number, c1: number, z0: number, z1: number) => {
      const [x0, y0] = at(a0, c0), [x1, y1] = at(a1, c1);
      box(m, Math.min(x0, x1), Math.min(y0, y1), z0, Math.max(x0, x1), Math.max(y0, y1), z1);
    };
    slab(-L, -0.38, L, 0.38, 0.72, 0.76);
    for (const c of [-0.68, 0.68]) slab(-L, c - 0.13, L, c + 0.13, 0.42, 0.45);
    for (const a of [-L + 0.2, L - 0.2]) slab(a - 0.04, -0.75, a + 0.04, 0.75, 0, 0.72);
  }
  for (const u of spec.umbrellas ?? []) {
    const r = u.radius ?? 1.4, h = u.height ?? 2.6, m = solid(`umbrella_${(u.colour ?? "#f2f0ea").slice(1)}`, hex(u.colour, [242, 240, 234]));
    box(solid("pole", [70, 70, 72]), u.x - 0.025, u.y - 0.025, 0, u.x + 0.025, u.y + 0.025, h + 0.1);
    const apex = W(u.x, u.y, h + 0.1);
    for (let k = 0; k < 8; k++) {
      const a0 = (k / 8) * 2 * Math.PI, a1 = ((k + 1) / 8) * 2 * Math.PI;
      twoSided(m, [W(u.x + r * Math.cos(a0), u.y + r * Math.sin(a0), h - 0.3), W(u.x + r * Math.cos(a1), u.y + r * Math.sin(a1), h - 0.3), apex]);
    }
  }
  for (const sl of spec.sails ?? []) {
    const m = solid(`sail_${(sl.colour ?? "#8c9196").slice(1)}`, hex(sl.colour, [140, 145, 150]));
    twoSided(m, sl.pts.map(([x, y, z]) => W(x, y, z)));
    for (const [x, y, z] of sl.pts) if (z > 1) box(solid("pole", [70, 70, 72]), x - 0.05, y - 0.05, 0, x + 0.05, y + 0.05, z, false, true);
  }
  for (const f of spec.flags ?? []) {
    const h = f.height ?? 4, m = solid(`flag_${(f.colour ?? "#f4f4f2").slice(1)}`, hex(f.colour, [244, 244, 242]));
    box(solid("pole", [70, 70, 72]), f.x - 0.02, f.y - 0.02, 0, f.x + 0.02, f.y + 0.02, h);
    // A feather: straight along the pole, the outer edge bowing out and rounding over the top.
    const w = 0.75, z0 = 0.9;
    const edge: [number, number][] = [];
    for (let k = 0; k <= 8; k++) {
      const q = k / 8, z = z0 + (h - 0.15 - z0) * q;
      edge.push([w * (0.75 + 0.25 * Math.sin(q * Math.PI * 0.8)) * (q > 0.85 ? Math.cos(((q - 0.85) / 0.15) * Math.PI / 2) : 1), z]);
    }
    for (let k = 0; k < 8; k++) {
      const [wa, za] = edge[k], [wb, zb] = edge[k + 1];
      twoSided(m, [W(f.x, f.y, za), W(f.x + wa, f.y, za), W(f.x + wb, f.y, zb), W(f.x, f.y, zb)]);
    }
  }
  const signs: SpecHouse["signs"] = [];
  for (const [k, sg] of (spec.signs ?? []).entries()) {
    const bg = hex(sg.colour, [28, 28, 30]), ink = hex(sg.ink, [245, 245, 242]);
    box(solid(`signboard${k}`, bg), sg.x0, sg.y, sg.z0, sg.x1, sg.y + 0.08, sg.z1);
    if (sg.posts) for (const x of [sg.x0 + 0.05, sg.x1 - 0.05]) box(solid(`signboard${k}`, bg), x - 0.06, sg.y + 0.01, 0, x + 0.06, sg.y + 0.07, sg.z1 + 0.05, false, true);
    if (sg.text) {
      const name = `spec_${tag}_sign${k}`;
      signs.push({ name, text: sg.text, bg, ink, width: sg.x1 - sg.x0, height: sg.z1 - sg.z0 });
      const z0 = sg.z0 + 0.04, z1 = sg.z1 - 0.04, y = sg.y - 0.01;
      poly(mesh(name), [W(sg.x0 + 0.04, y, z0), W(sg.x1 - 0.04, y, z0), W(sg.x1 - 0.04, y, z1), W(sg.x0 + 0.04, y, z1)], (_p, j) => [j === 1 || j === 2 ? 1 : 0, j < 2 ? 1 : 0]);
    }
  }

  const nodes: Kn5MeshNode[] = [];
  let i = 0;
  for (const [mat, mb] of meshes) if (mb.indices.length) nodes.push(mb.toKn5(`SPECHOUSE_${tag}_${i++}`, mat));
  // What the car hits: the walls and fences, invisible.
  if (solidWalls.indices.length) nodes.push({ ...solidWalls.toKn5(`1WALL_SPECHOUSE_${tag}`, trim), renderable: false });
  return { nodes, facades, roof, solids, trees, footprints, signs };
}
