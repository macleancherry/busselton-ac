// Busselton fork: are the parked cars in real bays? (parkedPlacement.ts; scripts/check/parked_check.ts
// runs it on a build's zip.)
//
// Cars are read back from their collision boxes (1WALL_CAR_*: one box a car, 4.4 x 1.75 m, its
// footprint and base). Three things fail a build:
//   - overlapping: two cars' boxes overlap (by more than 2 cm), cars driven into each other;
//   - off asphalt: a wheel (the four contact points, parkedCars.ts WHEELS) or the middle isn't on an
//     asphalt physics surface at the top: the route or a street (gutters included) or a car park bay's
//     pad. Grass, kerbs, paths, gravel and no surface at all count as off;
//   - outside bays: the car's middle is neither over a car park bay's pad (1STREET_CARPARK) nor within
//     4 m of kerbside bay paint (KERBSIDE_*: parallel bays' T-marks are 6 m apart, angle bays' lines 2.6).
import type { Vec2 } from "./geo";
import type { Kn5Node } from "./kn5";
import { carsOverlap } from "./parkedPlacement";
import { PHYSICS_GROUND, topSurface, type SurfaceFn } from "./sceneGround";
import { SURFACE_GROUPS, groupsOf } from "./groundCheck";

/** Asphalt to park on: the route, its gutters and rings, streets and their fills, car park bay pads. */
export const ASPHALT = /^\d(ROAD(?!_PATH)|STREET(?!_PATH|_DRIVE))/;
/** The car park bays' pads (parkedPlacement.ts buildBayPads). */
export const BAY_PAD = /^\dSTREET_CARPARK/;
/** Surfaces by kind, for saying what a car stands on instead. */
const KINDS: [string, RegExp][] = [["grass", /^\dGRASS/], ["kerb", /^\dKERB/], ["path", /PATH|_DRIVE/], ["gravel", /^\d(UNSEALED|UNPAVED)/]];

/** A parked car as read from its collision box: middle and unit long axis (local x east, y north), base height. */
export interface CheckedCar {
  at: Vec2;
  dir: Vec2;
  base: number;
}

export interface ParkedReport {
  cars: number;
  /** Pairs of overlapping cars: AC x, z of each middle. */
  overlapping: { a: [number, number]; b: [number, number] }[];
  /** Cars with a wheel or the middle off asphalt, and what's there instead. */
  offAsphalt: { x: number; z: number; on: string }[];
  /** Cars neither on a bay pad nor beside kerbside bay paint. */
  outsideBays: { x: number; z: number }[];
}

const meshesIn = (nodes: Kn5Node[]): Extract<Kn5Node, { kind: "mesh" }>[] =>
  nodes.flatMap((n) => (n.kind === "mesh" ? [n] : meshesIn(n.children)));

/** The parked cars in a model, from their collision boxes (welded to the millimetre, one connected box a car). */
export function carsFromWalls(root: Kn5Node): CheckedCar[] {
  const out: CheckedCar[] = [];
  for (const m of meshesIn([root]).filter((n) => /^1WALL_CAR/.test(n.name))) {
    const p = m.positions, key = new Map<string, number>(), X: number[] = [], Y: number[] = [], H: number[] = [];
    const ids: number[] = [];
    for (let v = 0; v < p.length; v += 3) {
      const k = `${Math.round(p[v] * 1000)},${Math.round(p[v + 1] * 1000)},${Math.round(p[v + 2] * 1000)}`;
      let id = key.get(k);
      if (id === undefined) { id = X.length; key.set(k, id); X.push(p[v]); Y.push(-p[v + 2]); H.push(p[v + 1]); }
      ids.push(id);
    }
    const parent = X.map((_, i) => i);
    const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = find(ids[m.indices[t]]);
      parent[find(ids[m.indices[t + 1]])] = a;
      parent[find(ids[m.indices[t + 2]])] = a;
    }
    const boxes = new Map<number, number[]>();
    X.forEach((_, i) => { const r = find(i); (boxes.get(r) ?? boxes.set(r, []).get(r)!).push(i); });
    for (const vs of boxes.values()) {
      const lo = Math.min(...vs.map((i) => H[i]));
      const bottom = vs.filter((i) => H[i] < lo + 0.01);
      if (bottom.length < 4) continue;
      const cx = bottom.reduce((a, i) => a + X[i], 0) / bottom.length, cy = bottom.reduce((a, i) => a + Y[i], 0) / bottom.length;
      // From one corner the other three are the short edge, the long edge and the diagonal: the long axis is the middle one.
      const c0 = bottom[0];
      const edges = bottom.slice(1).map((j) => ({ j, d: Math.hypot(X[j] - X[c0], Y[j] - Y[c0]) })).sort((a, b) => a.d - b.d);
      const e = edges[edges.length - 2];
      out.push({ at: [cx, cy], dir: [(X[e.j] - X[c0]) / e.d, (Y[e.j] - Y[c0]) / e.d], base: lo });
    }
  }
  return out;
}

/** The four wheel contacts and the middle of a car (parkedCars.ts WHEELS). */
export function wheelPoints(c: { at: Vec2; dir: Vec2 }): Vec2[] {
  const [fx, fy] = c.dir, sx = -fy, sy = fx;
  return [[0, 0], [1.4, 0.74], [1.4, -0.74], [-1.4, 0.74], [-1.4, -0.74]].map(([f, s]) => [c.at[0] + fx * f + sx * s, c.at[1] + fy * f + sy * s] as Vec2);
}

/** The first of a car's wheel contacts and middle that isn't on asphalt at the top (`top`: every physics surface), or null. */
export function offAsphaltAt(c: { at: Vec2; dir: Vec2 }, top: SurfaceFn, asphalt: SurfaceFn): Vec2 | null {
  for (const [x, y] of wheelPoints(c)) {
    const h = top(x, y), a = asphalt(x, y);
    if (h !== null && a !== null && a >= h - 0.005) continue;
    return [x, y];
  }
  return null;
}

/** Checks a built model's parked cars: overlaps, off asphalt, outside bays. */
export function checkParked(root: Kn5Node): ParkedReport {
  const cars = carsFromWalls(root);
  const report: ParkedReport = { cars: cars.length, overlapping: [], offAsphalt: [], outsideBays: [] };
  if (!cars.length) return report;
  const groups = groupsOf(root);
  const surfaceNodes = [...groups].filter(([k]) => SURFACE_GROUPS.has(k)).flatMap(([, v]) => v);
  const top = topSurface(surfaceNodes, PHYSICS_GROUND), asphalt = topSurface(surfaceNodes, ASPHALT), pads = topSurface(surfaceNodes, BAY_PAD);
  const kinds = new Map<string, SurfaceFn>();
  const kindAt = (x: number, y: number, h: number) => {
    for (const [name, re] of KINDS) {
      const f = kinds.get(name) ?? kinds.set(name, topSurface(surfaceNodes, re)).get(name)!;
      const v = f(x, y);
      if (v !== null && Math.abs(v - h) < 0.005) return name;
    }
    return "other";
  };
  // Kerbside paint, as points on a 2 m grid.
  const paint = new Set<string>();
  for (const m of meshesIn([root]).filter((n) => /^KERBSIDE_/.test(n.name)))
    for (let v = 0; v < m.positions.length; v += 3) paint.add(`${Math.floor(m.positions[v] / 2)},${Math.floor(-m.positions[v + 2] / 2)}`);
  const nearPaint = (x: number, y: number) => {
    for (let i = Math.floor((x - 4) / 2); i <= Math.floor((x + 4) / 2); i++)
      for (let j = Math.floor((y - 4) / 2); j <= Math.floor((y + 4) / 2); j++) if (paint.has(`${i},${j}`)) return true;
    return false;
  };
  const ac = (c: CheckedCar): [number, number] => [c.at[0], -c.at[1]];
  // The boxes are a little smaller than the cars; overlapping by more than 2 cm counts.
  const grid = new Map<string, number[]>();
  cars.forEach((c, i) => {
    const gx = Math.floor(c.at[0] / 8), gy = Math.floor(c.at[1] / 8);
    for (let a = gx - 1; a <= gx + 1; a++) for (let b = gy - 1; b <= gy + 1; b++)
      for (const j of grid.get(`${a},${b}`) ?? []) if (carsOverlap(c, cars[j], -0.07)) report.overlapping.push({ a: ac(c), b: ac(cars[j]) });
    const k = `${gx},${gy}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  for (const c of cars) {
    const off = offAsphaltAt(c, top, asphalt);
    if (off) {
      const h = top(off[0], off[1]);
      report.offAsphalt.push({ x: c.at[0], z: -c.at[1], on: h === null ? "nothing" : kindAt(off[0], off[1], h) });
    }
    if (pads(c.at[0], c.at[1]) === null && !nearPaint(c.at[0], c.at[1])) report.outsideBays.push({ x: c.at[0], z: -c.at[1] });
  }
  return report;
}
