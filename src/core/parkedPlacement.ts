// Busselton fork: parked cars only in real bays (benchmarks: the side street and the car park).
//
// The photo (carpark.ts) says roughly where cars stood and what colour they were. It can't say which
// way a car in a clump pointed, and it picks up footpath strips and blobs that aren't cars at all. So
// the photo's cars are only votes, and every car is put into a bay or dropped:
//
//  - Streets: only in the kerbside bays kerbside.ts painted (OSM parking tags, or a lined row of
//    parallel-parked cars on the carriageway in the photo). A car takes the nearest free bay within
//    reach that it lines up with; a nose-in "row" along a street matches no parallel bay and goes.
//    Nose-in or angle cars along a street only where angle bays are mapped.
//  - Car parks: within 30 m of a mapped car park aisle (OSM service=parking_aisle). OSM often maps
//    only a car park's outer loop, so the bays aren't hung off the aisles: the aisles give the car
//    park's grid (the direction they mostly run), and the photo gives the rows. Each car points along
//    the grid axis nearer its photo direction; cars side by side make a nose-in row across that axis,
//    2.6 m a bay (BAY_WIDTH); cars the photo saw end to end make a row of parallel bays, 6.2 m apart.
//    A row's line is its cars' median, its bays' phase their circular mean, one car a bay. A car
//    reaching into a mapped aisle was driving (or is a bad guess) and goes.
//  - Anything else (near neither a painted bay nor a car park aisle) goes.
//  - No two cars overlap (their footprints, with 5 cm to spare), and each keeps the photo's colour.
//
// The car park's bays are physics too: the ground there is the terrain's photo, which is grass
// physics (1GRASS). Each bay with a car, and the empty bays between them, gets an invisible asphalt
// pad 1 cm over the ground (1STREET_CARPARK), so a parked car stands on asphalt and a car driven into
// a bay drives on it.
import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import type { KerbSlot } from "./kerbside";
import { MAX_MESH_VERTICES, type Kn5MeshNode } from "./kn5";
import { MeshBuilder } from "./mesh";
import type { ParkedCar } from "./parkedCars";
import { CAR_LENGTH, CAR_WIDTH, carFootprint } from "./parkedClear";
import { pad } from "./roadMesh";

/** A car found in the photo, with how its blob was split (carpark.ts CarSpot.row). */
export interface PhotoCar extends ParkedCar {
  row?: "end" | "nose";
}

/** A car put in a bay: `kerb` when it's in a kerbside bay on a street (parkedClear.ts lets those stand on the street). */
export interface PlacedCar extends ParkedCar {
  kerb?: boolean;
}

/** A car park aisle: its centreline and asphalt width. */
export interface Aisle {
  pts: Vec2[];
  width: number;
}

/** A car park bay's ground, four corners counter-clockwise from above. */
export type BayQuad = [Vec2, Vec2, Vec2, Vec2];

/** Bay width square to the cars, and length, metres (AS 2890.1, class 2). */
export const BAY_WIDTH = 2.6, BAY_LENGTH = 5.4;
/** Parallel bays end to end, along an aisle's edge. */
export const PARALLEL_PITCH = 6.2;
/** How far a photo car may be from a kerbside bay's middle and still be the car in it. */
export const KERB_REACH = 3.5;
/** How far from a mapped car park aisle a photo car can be and still be in that car park. */
export const CAR_PARK_REACH = 30;
/** A car may reach this far over a mapped aisle's edge (OSM aisles are drawn roughly). */
const AISLE_EDGE = 0.8;
/** Cars' lines more than this far apart are separate rows. */
const ROW_GAP = 1.6;
/** The pads' height over the ground. */
export const PAD_LIFT = 0.01;

export interface PlaceResult {
  cars: PlacedCar[];
  /** The ground of every car park bay with a car in it, and the empty bays between them. */
  bays: BayQuad[];
  dropped: { aisle: number; noBay: number; blocked: number; overlap: number };
}

/* ---------------- geometry ---------------- */

const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];

/** Does a car's footprint (grown by `margin` on every side) overlap another's? Separating axes. */
export function carsOverlap(a: { at: Vec2; dir: Vec2 }, b: { at: Vec2; dir: Vec2 }, margin = 0.05): boolean {
  const hl = CAR_LENGTH / 2 + margin, hw = CAR_WIDTH / 2 + margin;
  if (Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) > 2 * Math.hypot(hl, hw)) return false;
  const corners = (c: { at: Vec2; dir: Vec2 }): Vec2[] => {
    const l = Math.hypot(c.dir[0], c.dir[1]) || 1, f: Vec2 = [c.dir[0] / l, c.dir[1] / l], s: Vec2 = [-f[1], f[0]];
    return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([i, j]) => [c.at[0] + f[0] * i * hl + s[0] * j * hw, c.at[1] + f[1] * i * hl + s[1] * j * hw] as Vec2);
  };
  const p = corners(a), q = corners(b);
  for (const ax of [a.dir, [-a.dir[1], a.dir[0]], b.dir, [-b.dir[1], b.dir[0]]] as Vec2[]) {
    const pa = p.map((v) => dot(v, ax)), qa = q.map((v) => dot(v, ax));
    if (Math.max(...pa) <= Math.min(...qa) || Math.max(...qa) <= Math.min(...pa)) return false;
  }
  return true;
}

/** The nearest point on any of a set of polylines (a grid of segments). */
class Lines {
  private cells = new Map<string, [number, number][]>();
  constructor(readonly lines: Vec2[][], private readonly cell = 20) {
    lines.forEach((pts, id) => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        for (let x = Math.floor(Math.min(a[0], b[0]) / cell); x <= Math.floor(Math.max(a[0], b[0]) / cell); x++)
          for (let y = Math.floor(Math.min(a[1], b[1]) / cell); y <= Math.floor(Math.max(a[1], b[1]) / cell); y++) {
            const k = `${x},${y}`;
            (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push([id, i - 1]);
          }
      }
    });
  }

  /** The nearest line within r: its id and distance. */
  nearest(x: number, y: number, r: number): { id: number; dist: number } | null {
    let best: { id: number; dist: number } | null = null;
    const c = this.cell;
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++)
      for (let cy = Math.floor((y - r) / c); cy <= Math.floor((y + r) / c); cy++)
        for (const [id, i] of this.cells.get(`${cx},${cy}`) ?? []) {
          const a = this.lines[id][i], b = this.lines[id][i + 1];
          const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-18;
          const f = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
          const dist = Math.hypot(x - a[0] - dx * f, y - a[1] - dy * f);
          if (dist <= r && (!best || dist < best.dist)) best = { id, dist };
        }
    return best;
  }
}

/**
 * A car park's grid: the direction (radians, 0 to 90 degrees) its aisles mostly run, from every aisle
 * segment with its middle within `r` of `c`, weighted by length (angles taken four times over, so 0,
 * 90, 180 and 270 degrees all agree). 0 when there are none.
 */
export function gridAngle(aisles: Vec2[][], c: Vec2, r: number): number {
  let sx = 0, sy = 0;
  for (const pts of aisles)
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (Math.hypot((a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]) > r) continue;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), t = Math.atan2(b[1] - a[1], b[0] - a[0]);
      sx += L * Math.cos(4 * t);
      sy += L * Math.sin(4 * t);
    }
  if (!sx && !sy) return 0;
  const th = Math.atan2(sy, sx) / 4;
  return th < 0 ? th + Math.PI / 2 : th;
}

const median = (v: number[]) => {
  const s = v.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Positions along a row snapped to bays `pitch` apart, the phase their circular mean: bay index to the nearest car. */
export function snapToBays<T>(items: { along: number; item: T }[], pitch: number): { phase: number; bays: Map<number, T> } {
  let sx = 0, sy = 0;
  for (const i of items) { const a = (2 * Math.PI * i.along) / pitch; sx += Math.cos(a); sy += Math.sin(a); }
  const phase = (((Math.atan2(sy, sx) / (2 * Math.PI)) * pitch) % pitch + pitch) % pitch;
  const best = new Map<number, { item: T; d: number }>();
  for (const i of items) {
    const k = Math.round((i.along - phase) / pitch), d = Math.abs(i.along - (phase + k * pitch));
    const prev = best.get(k);
    if (!prev || d < prev.d) best.set(k, { item: i.item, d });
  }
  return { phase, bays: new Map([...best].map(([k, v]) => [k, v.item])) };
}

/* ---------------- placing ---------------- */

/**
 * Every photo car into a bay, or dropped (see the top of this file). `blocked(x, y, kerb)` says where
 * no part of a car may be: buildings, islands, roundabouts, the route's road, and (for car park bays,
 * kerb false) through streets.
 */
export function placeParked(
  photo: PhotoCar[],
  ctx: { aisles: Aisle[]; slots: KerbSlot[]; blocked: (x: number, y: number, kerb: boolean) => boolean },
): PlaceResult {
  const dropped = { aisle: 0, noBay: 0, blocked: 0, overlap: 0 };
  const cars: PlacedCar[] = [];
  const bays: BayQuad[] = [];
  const clear = (c: { at: Vec2; dir: Vec2 }, kerb: boolean) => !carFootprint(c.at, c.dir, 0.75).some(([x, y]) => ctx.blocked(x, y, kerb));

  // 1. Kerbside bays: the nearest free bay within reach that the car lines up with.
  const slotGrid = new Map<string, number[]>();
  ctx.slots.forEach((sl, i) => {
    const k = `${Math.floor(sl.at[0] / 10)},${Math.floor(sl.at[1] / 10)}`;
    (slotGrid.get(k) ?? slotGrid.set(k, []).get(k)!).push(i);
  });
  const claims = new Map<number, PhotoCar>();
  const left: PhotoCar[] = [];
  const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  for (const car of photo) {
    let best = -1, bd = KERB_REACH;
    const gx = Math.floor(car.at[0] / 10), gy = Math.floor(car.at[1] / 10);
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gy - 1; j <= gy + 1; j++) for (const k of slotGrid.get(`${i},${j}`) ?? []) {
      const sl = ctx.slots[k], d = dist(car.at, sl.at);
      // Lined up: a parallel bay wants a car along the kerb; an angle bay one roughly along its lines.
      if (d >= bd || Math.abs(dot(car.dir, sl.dir)) < (sl.kind === "parallel" ? 0.8 : 0.5)) continue;
      best = k;
      bd = d;
    }
    if (best < 0) { left.push(car); continue; }
    // One car a bay: the photo car nearest the bay's middle keeps it (the others were a second look at it).
    const prev = claims.get(best), at = ctx.slots[best].at;
    if (!prev || dist(car.at, at) < dist(prev.at, at)) claims.set(best, car);
  }
  for (const [k, car] of [...claims].sort((a, b) => a[0] - b[0])) {
    const sl = ctx.slots[k];
    const placed: PlacedCar = { at: sl.at, dir: sl.dir, paint: car.paint, kerb: true };
    if (!clear(placed, true)) { dropped.blocked++; continue; }
    cars.push(placed);
  }

  // 2. Car park bays: rows in each car park's own grid.
  const aisles = new Lines(ctx.aisles.map((a) => a.pts));
  const inPark: PhotoCar[] = [];
  for (const car of left) {
    if (ctx.aisles.length && aisles.nearest(car.at[0], car.at[1], CAR_PARK_REACH)) inPark.push(car);
    else dropped.noBay++;
  }
  // One car park: photo cars within 12 m of each other.
  const parent = inPark.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const near = new Map<string, number[]>();
  inPark.forEach((c, i) => {
    const gx = Math.floor(c.at[0] / 12), gy = Math.floor(c.at[1] / 12);
    for (let x = gx - 1; x <= gx + 1; x++) for (let y = gy - 1; y <= gy + 1; y++)
      for (const j of near.get(`${x},${y}`) ?? []) if (dist(c.at, inPark[j].at) < 12) parent[find(i)] = find(j);
    const k = `${gx},${gy}`;
    (near.get(k) ?? near.set(k, []).get(k)!).push(i);
  });
  const parks = new Map<number, PhotoCar[]>();
  inPark.forEach((c, i) => { const r = find(i); (parks.get(r) ?? parks.set(r, []).get(r)!).push(c); });
  const inAisle = (c: { at: Vec2; dir: Vec2 }) => carFootprint(c.at, c.dir, 0.75).some(([x, y]) => {
    const h = aisles.nearest(x, y, 6);
    return !!h && h.dist < ctx.aisles[h.id].width / 2 - AISLE_EDGE;
  });

  for (const r of [...parks.keys()].sort((p, q) => p - q)) {
    const group = parks.get(r)!;
    const c: Vec2 = [group.reduce((a, g) => a + g.at[0], 0) / group.length, group.reduce((a, g) => a + g.at[1], 0) / group.length];
    const th = gridAngle(ctx.aisles.map((a) => a.pts), c, CAR_PARK_REACH + Math.max(...group.map((g) => dist(g.at, c))));
    const axes: Vec2[] = [[Math.cos(th), Math.sin(th)], [-Math.sin(th), Math.cos(th)]];
    // Each car points along one grid axis. Cars side by side (another within 3.6 m) say which: their
    // row runs the way their neighbours lie, and they point across it. A car on its own points along
    // the axis nearer the photo's guess. Side by side, its row runs across that axis; end to end, along it.
    const rows = new Map<string, { car: PhotoCar; along: number; across: number }[]>();
    for (const car of group) {
      let o = Math.abs(dot(car.dir, axes[0])) >= Math.abs(dot(car.dir, axes[1])) ? 0 : 1;
      if (car.row !== "end") {
        let wa = 0, wb = 0;
        for (const other of group) {
          const d = dist(car.at, other.at);
          if (other === car || d > 3.6 || d < 0.5) continue;
          const v: Vec2 = [(other.at[0] - car.at[0]) / d, (other.at[1] - car.at[1]) / d];
          wa += Math.abs(dot(v, axes[0]));
          wb += Math.abs(dot(v, axes[1]));
        }
        if (wa > 1.5 * wb) o = 1;
        else if (wb > 1.5 * wa) o = 0;
      }
      const end = car.row === "end";
      const rowDir = end ? axes[o] : axes[1 - o];
      const key = `${o}${end ? "e" : "n"}`;
      (rows.get(key) ?? rows.set(key, []).get(key)!).push({ car, along: dot(car.at, rowDir), across: dot(car.at, [-rowDir[1], rowDir[0]]) });
    }
    for (const key of [...rows.keys()].sort()) {
      const o = Number(key[0]), end = key[1] === "e";
      const pitch = end ? PARALLEL_PITCH : BAY_WIDTH, depth = end ? 2.4 : BAY_LENGTH;
      const carAxis = axes[o], rowDir = end ? axes[o] : axes[1 - o], nrm: Vec2 = [-rowDir[1], rowDir[0]];
      const items = rows.get(key)!.sort((p, q) => p.across - q.across);
      const lines: typeof items[] = [];
      for (const it of items) {
        const last = lines[lines.length - 1];
        if (last && it.across - last[last.length - 1].across < ROW_GAP) last.push(it);
        else lines.push([it]);
      }
      for (const line of lines) {
        const across = median(line.map((i) => i.across));
        const { phase, bays: claim } = snapToBays(line.map((i) => ({ along: i.along, item: i.car })), pitch);
        const bayAt = (k: number) => {
          const s = phase + k * pitch;
          const at: Vec2 = [rowDir[0] * s + nrm[0] * across, rowDir[1] * s + nrm[1] * across];
          const ha = pitch / 2 + 0.1, hd = depth / 2;
          const quad: BayQuad = [
            [at[0] - rowDir[0] * ha - nrm[0] * hd, at[1] - rowDir[1] * ha - nrm[1] * hd],
            [at[0] + rowDir[0] * ha - nrm[0] * hd, at[1] + rowDir[1] * ha - nrm[1] * hd],
            [at[0] + rowDir[0] * ha + nrm[0] * hd, at[1] + rowDir[1] * ha + nrm[1] * hd],
            [at[0] - rowDir[0] * ha + nrm[0] * hd, at[1] - rowDir[1] * ha + nrm[1] * hd],
          ];
          return { at, quad };
        };
        const filled: number[] = [];
        for (const k of [...claim.keys()].sort((p, q) => p - q)) {
          const bay = bayAt(k), car = claim.get(k)!;
          const sg = dot(car.dir, carAxis) >= 0 ? 1 : -1;
          const placed: PlacedCar = { at: bay.at, dir: [carAxis[0] * sg, carAxis[1] * sg], paint: car.paint };
          // Reaching into an aisle: a car the photo caught driving, or a guess that isn't a bay.
          if (inAisle(placed)) { dropped.aisle++; continue; }
          if (!clear(placed, false)) { dropped.blocked++; continue; }
          cars.push(placed);
          filled.push(k);
          bays.push(bay.quad);
        }
        // The empty bays between cars (up to two in a row) are bays too, where they're clear.
        for (let j = 1; j < filled.length; j++) {
          if (filled[j] - filled[j - 1] > 3) continue;
          for (let k = filled[j - 1] + 1; k < filled[j]; k++) {
            const bay = bayAt(k);
            if ([...bay.quad, bay.at].every(([x, y]) => !ctx.blocked(x, y, false))) bays.push(bay.quad);
          }
        }
      }
    }
  }

  // 3. No two cars overlap: the first placed keeps its place (kerbside bays, then car parks in order).
  const kept: PlacedCar[] = [];
  const grid = new Map<string, PlacedCar[]>();
  for (const car of cars) {
    const gx = Math.floor(car.at[0] / 8), gy = Math.floor(car.at[1] / 8);
    let hit = false;
    for (let i = gx - 1; i <= gx + 1 && !hit; i++) for (let j = gy - 1; j <= gy + 1 && !hit; j++)
      hit = (grid.get(`${i},${j}`) ?? []).some((o) => carsOverlap(car, o));
    if (hit) { dropped.overlap++; continue; }
    kept.push(car);
    const k = `${gx},${gy}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(car);
  }
  return { cars: kept, bays, dropped };
}

/* ---------------- the bays' ground ---------------- */

/**
 * Invisible asphalt pads over the car park bays (1STREET_CARPARK_nnn), `PAD_LIFT` over `ground`,
 * in cells of about a metre so they follow it.
 */
export function buildBayPads(quads: BayQuad[], ground: HeightFn): Kn5MeshNode[] {
  const meshes: MeshBuilder[] = [];
  let mb = new MeshBuilder();
  for (const q of quads) {
    const [a, b, c, d] = q;
    const nu = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))), nv = Math.max(1, Math.ceil(Math.hypot(d[0] - a[0], d[1] - a[1])));
    if (mb.vertexCount + (nu + 1) * (nv + 1) > MAX_MESH_VERTICES) {
      meshes.push(mb);
      mb = new MeshBuilder();
    }
    const i0 = mb.vertexCount;
    // Bilinear over the corners, a to b along, a to d across: counter-clockwise, so the faces point up.
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        const x = (1 - u) * (1 - v) * a[0] + u * (1 - v) * b[0] + u * v * c[0] + (1 - u) * v * d[0];
        const y = (1 - u) * (1 - v) * a[1] + u * (1 - v) * b[1] + u * v * c[1] + (1 - u) * v * d[1];
        mb.vertex([x, y, ground(x, y) + PAD_LIFT], u, v);
      }
    }
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const p = i0 + j * (nu + 1) + i;
        mb.quad(p, p + 1, p + nu + 2, p + nu + 1);
      }
  }
  meshes.push(mb);
  return meshes.filter((m) => m.indices.length).map((m, i) => m.toKn5(`1STREET_CARPARK_${pad(i)}`, "wall", { renderable: false, castShadows: false }));
}
