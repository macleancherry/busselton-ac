// Busselton fork: local cars in the parked bays (docs/plans/local-cars.md, phase 2). Each bay gets a
// body, a variant and a paint from the local mix, the same on every rebuild, and the cars are written
// as two LODs in clusters of about 40 m, so AC can swap a car park's near cars for far ones as a whole.
//
//  - Seed: a hash of the bay's centre rounded to 0.5 m and the track's slug. Draws from it in turn:
//    the body (the plan's base mix, only bodies that fit the bay), the variant (only those that fit),
//    the paint (the photo's when it's clearly coloured, otherwise the body's colour table).
//  - Fit: a car's reach is its mesh's longest end either side of its middle, twice over (tow bars and
//    bull bars included), so it sits centred in its bay. Nose-in bays are 5.4 m, parallel ones longer.
//  - Size: `len` (that reach) and `wid` (the body's width) are what the clears use, `span` (mirror to
//    mirror) what overlaps between cars and the route's road test use (the ground check sees every
//    vertex over the route);
//    `wheels` (where the tyres touch, both ways round, as the checks can't tell front from back) what
//    the asphalt test uses. The collision box is the body: its length and width less 10 and 5 cm.
//  - LODs: LOD 0 from 0 to 70 m, LOD 1 from 70 to 600 m, by each cluster mesh's centre.

import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import { MAX_MESH_VERTICES, type Kn5MeshNode } from "./kn5";
import { MeshBuilder } from "./mesh";
import { carSeat, type CarSeat } from "./parkedCars";
import { pad } from "./roadMesh";
import { box, ChunkedMesh } from "./scenery";
import { BODIES, body as bodyDef } from "./vehicles/index";
import { meshExtent, swatchUv, type Dimensions, type VehicleMesh } from "./vehicles/vehicle";

/** Where each LOD shows, metres from the cluster's centre. */
export const LOD0_OUT = 70, LOD1_OUT = 600;
/** Cluster size for the LOD meshes, metres. */
export const CLUSTER = 40;
/** A car park's nose-in bay, a car park's parallel bay and a kerbside parallel bay: the longest car each takes, metres. */
export const ROOM = { noseIn: 5.4, parkParallel: 5.9, kerbParallel: 5.7, kerbAngle: 5.4 } as const;
/** The fallback when a car doesn't fit where it is: plain hatch, the shortest body (inside the old 4.5 x 1.8 car). */
export const FALLBACK = { body: "hatch", variant: "plain" } as const;

/** The base mix (the plan's table, towables left for phase 3), percent. */
export const MIX: Record<string, number> = {
  ute: 22, trayute: 5, wagon4wd: 12, suv: 18, suvsmall: 7, hatch: 14, sedan: 10, passute: 2, van: 4, stationwagon: 3,
};

/** How often each variant turns up, per body. */
export const VARIANT_MIX: Record<string, Record<string, number>> = {
  ute: { plain: 30, sports: 20, canopy: 20, tradie: 15, rack: 8, full: 7 },
  trayute: { plain: 30, extra: 25, tradie: 30, full: 15 },
  wagon4wd: { plain: 35, touring: 30, spare: 20, full: 15 },
  suv: { plain: 60, rails: 30, full: 10 },
  suvsmall: { plain: 85, full: 15 },
  hatch: { plain: 90, full: 10 },
  sedan: { plain: 55, long: 35, full: 10 },
  passute: { plain: 40, tonneau: 45, full: 15 },
  van: { plain: 40, commuter: 25, tradie: 25, full: 10 },
  stationwagon: { plain: 55, rails: 35, full: 10 },
};

/**
 * Paints (PAINT's order: white, pearl white, silver, grey, gunmetal, black, navy, blue, red, maroon,
 * green, beige) per kind of body, from the plan's colour table: white split two to one plain and
 * pearl, grey between grey and gunmetal, blue between navy and blue, red mostly red.
 */
export const COLOURS: Record<"work" | "wagon" | "car", number[]> = {
  work: [37, 18, 9, 9, 6, 8, 3, 3, 3, 1, 1.5, 1.5],
  wagon: [27, 13, 15, 10, 8, 10, 3, 3, 2, 1, 3, 5],
  car: [17, 9, 18, 12, 10, 14, 4, 5, 5, 2, 2, 2],
};
const COLOUR_KIND: Record<string, keyof typeof COLOURS> = {
  ute: "work", trayute: "work", passute: "work", van: "work", wagon4wd: "wagon",
  suv: "car", suvsmall: "car", hatch: "car", sedan: "car", stationwagon: "car",
};
/** paintFor's neutrals are 0 to 5; above that the photo was clearly coloured. */
const LAST_NEUTRAL = 5;

/** A body and variant, with its sizes. */
export interface CarModel {
  body: string;
  variant: string;
  dims: Dimensions;
  /** The mesh's reach (LOD 0, extras included): forward, back (negative), half width with mirrors, top. */
  front: number;
  rear: number;
  halfWidth: number;
  top: number;
}

/** The fields a car with a local model carries (on ParkedCar). */
export interface ModelFit {
  model: CarModel;
  /** Footprint for clears: its reach either way, twice over, and the body's width; `span` is mirror to mirror. */
  len: number;
  wid: number;
  span: number;
  /** Tyre contacts (along, left), both ways round. */
  wheels: [number, number][];
}

/* ---------------- the models ---------------- */

const models = new Map<string, CarModel>();
const templates = new Map<string, VehicleMesh>();

function variantSpec(b: string, v: string) {
  const d = bodyDef(b), spec = d.variants[v];
  if (!spec) throw new Error(`no variant ${v} of ${b}`);
  return { d, spec };
}

/** A body's variant with its sizes (made once). */
export function carModel(b: string, v: string): CarModel {
  const k = `${b}/${v}`;
  let m = models.get(k);
  if (!m) {
    const { d, spec } = variantSpec(b, v);
    const e = meshExtent(template(b, v, 0));
    m = { body: b, variant: v, dims: d.dimensions(spec), front: e.front, rear: e.rear, halfWidth: e.halfWidth, top: e.top };
    models.set(k, m);
  }
  return m;
}

/** A model's mesh template at a LOD (made once). */
export function template(b: string, v: string, lod: 0 | 1): VehicleMesh {
  const k = `${b}/${v}/${lod}`;
  let t = templates.get(k);
  if (!t) {
    const { d, spec } = variantSpec(b, v);
    t = d.build(spec, lod);
    templates.set(k, t);
  }
  return t;
}

/** How long a bay a model needs, centred in it: its longer end, twice. */
export const reachOf = (m: CarModel) => 2 * Math.max(m.front, -m.rear);

/** Where a model's tyres touch the ground: (along, left) for each, front pair first. */
export function wheelContacts(d: Dimensions): [number, number][] {
  const f = d.frontAxle, r = d.frontAxle - d.wheelbase, s = d.track / 2;
  return [[f, s], [f, -s], [r, s], [r, -s]];
}

/** The tyre contacts both ways round (a car read back from its box could face either way). */
export function wheelsBothWays(d: Dimensions): [number, number][] {
  const w = wheelContacts(d);
  const flipped = w.map(([f, s]) => [-f, s] as [number, number]);
  return [...w, ...flipped.filter(([f, s]) => !w.some(([g, t]) => Math.abs(g - f) < 1e-9 && Math.abs(t - s) < 1e-9))];
}

/** The collision box of a model: length and width (the body less 10 and 5 cm), base under the seat and top. */
export function boxOf(d: Dimensions): { length: number; width: number; below: number; above: number } {
  return { length: d.length - 0.1, width: d.width - 0.05, below: 0.3, above: d.height - 0.05 };
}

/** The fit fields for a model. */
export function fitOf(model: CarModel): ModelFit {
  return { model, len: reachOf(model), wid: model.dims.width, span: 2 * model.halfWidth, wheels: wheelsBothWays(model.dims) };
}

/**
 * Every model's collision box size, to read a model back from a build (parkedCheck.ts): box length
 * and width, and its dimensions. Variants with the same body size share an entry.
 */
export function modelBoxes(): { length: number; width: number; dims: Dimensions }[] {
  const out: { length: number; width: number; dims: Dimensions }[] = [];
  for (const b of BODIES) for (const v of Object.keys(b.variants)) {
    const d = b.dimensions(b.variants[v]), bx = boxOf(d);
    const same = out.find((o) => Math.abs(o.length - bx.length) < 1e-6 && Math.abs(o.width - bx.width) < 1e-6);
    if (same) {
      if (same.dims.wheelbase !== d.wheelbase || same.dims.track !== d.track || same.dims.frontAxle !== d.frontAxle)
        throw new Error(`two models with a ${bx.length} x ${bx.width} m box and different wheels`);
      continue;
    }
    out.push({ length: bx.length, width: bx.width, dims: d });
  }
  return out;
}

/* ---------------- picking ---------------- */

/** FNV-1a, 32 bits. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** mulberry32: a small seeded generator, 0 to 1. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed of a bay: its centre rounded to 0.5 m, and the slug. */
export function baySeed(at: Vec2, slug: string): number {
  const r = (v: number) => Math.round(v * 2) || 0;
  return hash(`${slug}|${r(at[0])}|${r(at[1])}`);
}

function weighted<T>(items: [T, number][], u: number): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let x = u * total;
  for (const [it, w] of items) {
    if (x < w) return it;
    x -= w;
  }
  return items[items.length - 1][0];
}

export interface Pick {
  body: string;
  variant: string;
  paint: number;
}

/**
 * The car for a bay: the body (the mix, only bodies whose plain version fits `room`), the variant
 * (only those that fit), the paint (`photoPaint` when it's clearly coloured, else the body's table).
 */
export function pickCar(at: Vec2, photoPaint: number, slug: string, room: number): Pick {
  const rnd = random(baySeed(at, slug));
  const u1 = rnd(), u2 = rnd(), u3 = rnd();
  const fits = (b: string, v: string) => reachOf(carModel(b, v)) <= room + 1e-9;
  const bodies = Object.entries(MIX).filter(([b]) => fits(b, "plain"));
  if (!bodies.length) return { ...FALLBACK, paint: photoPaint };
  const b = weighted(bodies, u1);
  const v = weighted(Object.entries(VARIANT_MIX[b]).filter(([x]) => fits(b, x)), u2);
  const paint = photoPaint > LAST_NEUTRAL ? photoPaint : weighted(COLOURS[COLOUR_KIND[b]].map((w, i) => [i, w] as [number, number]), u3);
  return { body: b, variant: v, paint };
}

/** A car of some kind with its model fields set. */
export function withModel<C extends { at: Vec2; dir: Vec2; paint: number }>(car: C, b: string, v: string, paint = car.paint): C & ModelFit {
  return { ...car, paint, ...fitOf(carModel(b, v)) };
}

/** The same car as the fallback model (plain hatch), same paint. */
export const asFallback = <C extends { at: Vec2; dir: Vec2; paint: number }>(car: C): C & ModelFit => withModel(car, FALLBACK.body, FALLBACK.variant);

export const isFallback = (c: { model?: CarModel }) => c.model?.body === FALLBACK.body && c.model?.variant === FALLBACK.variant;

/** Do two cars' footprints (len by span each, mirrors included, centred) overlap, grown by `margin` all round? */
export function footprintsOverlap(a: { at: Vec2; dir: Vec2; len: number; span: number }, b: { at: Vec2; dir: Vec2; len: number; span: number }, margin = 0.05): boolean {
  const ha = [a.len / 2 + margin, a.span / 2 + margin], hb = [b.len / 2 + margin, b.span / 2 + margin];
  if (Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) > Math.hypot(ha[0], ha[1]) + Math.hypot(hb[0], hb[1])) return false;
  const corners = (c: { at: Vec2; dir: Vec2 }, h: number[]): Vec2[] => {
    const l = Math.hypot(c.dir[0], c.dir[1]) || 1, f: Vec2 = [c.dir[0] / l, c.dir[1] / l], s: Vec2 = [-f[1], f[0]];
    return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([i, j]) => [c.at[0] + f[0] * i * h[0] + s[0] * j * h[1], c.at[1] + f[1] * i * h[0] + s[1] * j * h[1]] as Vec2);
  };
  const p = corners(a, ha), q = corners(b, hb);
  for (const ax of [a.dir, [-a.dir[1], a.dir[0]], b.dir, [-b.dir[1], b.dir[0]]] as Vec2[]) {
    const pa = p.map((v) => v[0] * ax[0] + v[1] * ax[1]), qa = q.map((v) => v[0] * ax[0] + v[1] * ax[1]);
    if (Math.max(...pa) <= Math.min(...qa) || Math.max(...qa) <= Math.min(...pa)) return false;
  }
  return true;
}

/** Points over a footprint, every `step` metres along and across, edges included. */
export function footprintPoints(at: Vec2, dir: Vec2, len: number, wid: number, step = 0.5): Vec2[] {
  const l = Math.hypot(dir[0], dir[1]) || 1;
  const fx = dir[0] / l, fy = dir[1] / l, sx = -fy, sy = fx;
  const na = Math.ceil(len / step), nc = Math.ceil(wid / step);
  const out: Vec2[] = [];
  for (let i = 0; i <= na; i++) {
    const f = -len / 2 + (len * i) / na;
    for (let j = 0; j <= nc; j++) {
      const s = -wid / 2 + (wid * j) / nc;
      out.push([at[0] + fx * f + sx * s, at[1] + fy * f + sy * s]);
    }
  }
  return out;
}

/**
 * A model for every car, in order: its pick, or the fallback where the pick would overlap a car
 * already given one or reach somewhere `blocked` (the fallback is inside the old 4.5 x 1.8 m car
 * the placement cleared, so it always stays). Where the fallback still reaches a bigger car given
 * its model before, that car falls back too: two fallbacks clear each other as the old cars did.
 */
export function assignModels<C extends { at: Vec2; dir: Vec2; paint: number; room?: number; kerb?: boolean }>(
  cars: C[], slug: string, blocked?: (x: number, y: number, kerb: boolean) => boolean,
): { cars: (C & ModelFit)[]; fallback: number } {
  const out: (C & ModelFit)[] = [];
  const grid = new Map<string, number[]>();
  let fallback = 0;
  for (const car of cars) {
    const p = pickCar(car.at, car.paint, slug, car.room ?? ROOM.noseIn);
    let m = withModel(car, p.body, p.variant, p.paint);
    const gx = Math.floor(car.at[0] / 8), gy = Math.floor(car.at[1] / 8);
    const near = (c: C & ModelFit) => {
      const list: number[] = [];
      for (let i = gx - 1; i <= gx + 1; i++) for (let j = gy - 1; j <= gy + 1; j++)
        for (const o of grid.get(`${i},${j}`) ?? []) if (footprintsOverlap(c, out[o])) list.push(o);
      return list;
    };
    const hits = (c: C & ModelFit) => near(c).length > 0 ||
      (blocked ? footprintPoints(c.at, c.dir, c.len, c.wid, 0.75).some(([x, y]) => blocked(x, y, !!car.kerb)) : false);
    if (!isFallback(m) && hits(m)) {
      m = withModel(car, FALLBACK.body, FALLBACK.variant, p.paint);
      fallback++;
      for (const o of near(m)) if (!isFallback(out[o])) { out[o] = asFallback(out[o]); fallback++; }
    }
    const k = `${gx},${gy}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(out.length);
    out.push(m);
  }
  return { cars: out, fallback };
}

/** How high the ground may come up under a car's body, over its seat, metres (sills are 25 to 35 cm up). */
export const UNDER_CLEAR = 0.15;

/**
 * Is the ground clear under a car (its whole reach and mirror span: flares, steps and bars stick out
 * past the body, every 25 cm), at most UNDER_CLEAR over the seat's plane? A body reaching over a kerb,
 * a raised island or a steep pad has its sill in it.
 */
export function bodyClear(car: ModelFit & { at: Vec2; dir: Vec2 }, seat: CarSeat, ground: HeightFn): boolean {
  const [fx, fy] = car.dir, sx = -fy, sy = fx, L = car.len, W = car.span;
  const nf = Math.ceil(L / 0.25), ns = Math.ceil(W / 0.25);
  for (let i = 0; i <= nf; i++) for (let j = 0; j <= ns; j++) {
    const f = -L / 2 + (L * i) / nf, s = -W / 2 + (W * j) / ns;
    const g = ground(car.at[0] + fx * f + sx * s, car.at[1] + fy * f + sy * s);
    if (g - (seat.z + seat.pitch * f + seat.roll * s) > UNDER_CLEAR) return false;
  }
  return true;
}

/* ---------------- meshes ---------------- */

/** A car's template into `mb`, placed and tilted by its seat, with its paint. */
function addModel(mb: MeshBuilder, t: VehicleMesh, car: { at: Vec2; dir: Vec2; paint: number }, seat: CarSeat): void {
  const [fx, fy] = car.dir, sx = -fy, sy = fx;
  const base = mb.vertexCount;
  const [pu, pv] = swatchUv(car.paint);
  for (let i = 0, n = t.pos.length / 3; i < n; i++) {
    const f = t.pos[i * 3], s = t.pos[i * 3 + 1], h = t.pos[i * 3 + 2];
    const paint = t.paint[i];
    mb.vertex([car.at[0] + fx * f + sx * s, car.at[1] + fy * f + sy * s, seat.z + seat.pitch * f + seat.roll * s + h],
      paint ? pu : t.uv[i * 2], paint ? pv : t.uv[i * 2 + 1]);
  }
  for (let k = 0; k < t.idx.length; k += 3) mb.tri(base + t.idx[k], base + t.idx[k + 1], base + t.idx[k + 2]);
}

export interface LocalCarsMeshes {
  /** LOD meshes (visual): PARKED_CARS_NEAR_nnn and PARKED_CARS_FAR_nnn. */
  visual: Kn5MeshNode[];
  /** Collision boxes, 1WALL_CAR_nnn. */
  walls: Kn5MeshNode[];
}

/** The cars' LOD meshes in clusters, and their collision boxes, on `ground`. */
export function buildLocalCars(cars: (ModelFit & { at: Vec2; dir: Vec2; paint: number })[], ground: HeightFn, material = "local_car"): LocalCarsMeshes {
  const clusters = new Map<string, number[]>();
  cars.forEach((c, i) => {
    const k = `${Math.floor(c.at[0] / CLUSTER)},${Math.floor(c.at[1] / CLUSTER)}`;
    (clusters.get(k) ?? clusters.set(k, []).get(k)!).push(i);
  });
  const seats = cars.map((c) => carSeat(c, ground));
  const near: MeshBuilder[] = [], far: MeshBuilder[] = [];
  const keys = [...clusters.keys()].sort((a, b) => {
    const [ax, ay] = a.split(",").map(Number), [bx, by] = b.split(",").map(Number);
    return ay - by || ax - bx;
  });
  for (const k of keys) {
    for (const [lod, list] of [[0, near], [1, far]] as const) {
      let mb = new MeshBuilder();
      for (const i of clusters.get(k)!) {
        const c = cars[i], t = template(c.model.body, c.model.variant, lod);
        if (mb.vertexCount + t.pos.length / 3 > MAX_MESH_VERTICES) {
          list.push(mb);
          mb = new MeshBuilder();
        }
        addModel(mb, t, c, seats[i]);
      }
      list.push(mb);
    }
  }
  const walls = new ChunkedMesh(24);
  cars.forEach((c, i) => {
    const bx = boxOf(c.model.dims), z = seats[i].z;
    box(walls.next(), c.at, c.dir, bx.length, bx.width, z - bx.below, z + bx.above);
  });
  return {
    visual: [
      ...near.filter((m) => m.indices.length).map((m, i) => m.toKn5(`PARKED_CARS_NEAR_${pad(i)}`, material, { lodIn: 0, lodOut: LOD0_OUT })),
      ...far.filter((m) => m.indices.length).map((m, i) => m.toKn5(`PARKED_CARS_FAR_${pad(i)}`, material, { lodIn: LOD0_OUT, lodOut: LOD1_OUT })),
    ],
    walls: walls.all().map((m, i) => m.toKn5(`1WALL_CAR_${pad(i)}`, "wall", { renderable: false, castShadows: false })),
  };
}

/** Cars by body, for the stats. */
export function countByBody(cars: { model?: CarModel }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of BODIES) out[b.id] = 0;
  for (const c of cars) if (c.model) out[c.model.body]++;
  return out;
}
