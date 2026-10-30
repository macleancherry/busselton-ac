// fast_lane.ai (AI line, version 7) writer and reader, with the spatial lookup grid AC needs.
// Written from docs/specs/aiSpline.md and the public format notes it cites (AcTools AiSpline,
// AssettoServer FastLaneParser).

import { ByteSink, ByteSource } from "./binary";

type Xyz = [number, number, number];

/**
 * One point on the AI line (all fields required when writing).
 * - position: AC world metres (X east, Y up, Z south); distance: metres along the line from the first point
 * - speed: target m/s; gas, brake: pedal hints 0 to 1; radius: turn radius in metres
 * - sideLeft, sideRight: metres from the line to each road edge
 * - camber: bank angle magnitude in radians, with direction (1 or -1) giving its sign
 * - normal: surface normal; length: metres to the next point; forward: unit travel direction; grade: rise over run
 */
export type AiPoint = {
  position: Xyz; distance: number;
  speed: number; gas: number; brake: number; radius: number;
  sideLeft: number; sideRight: number;
  camber: number; direction: 1 | -1;
  normal: Xyz; length: number; forward: Xyz; grade: number;
};

const VERSION = 7;
const CELL = 10;
const NEIGHBOURS = 10;

const f32 = Math.fround;

/** A 2-D k-d tree over point x/z positions, answering exact k-nearest queries (ties to the lower index). */
class KdTree {
  private readonly order: Int32Array;
  private readonly axis: Uint8Array;
  private readonly bestD = new Float64Array(NEIGHBOURS);
  private readonly bestI = new Int32Array(NEIGHBOURS);
  private found = 0;
  private k = NEIGHBOURS;
  private qx = 0;
  private qz = 0;

  constructor(private readonly xs: Float64Array, private readonly zs: Float64Array) {
    const n = xs.length;
    this.order = new Int32Array(n);
    this.order.forEach((_, k, o) => (o[k] = k));
    this.axis = new Uint8Array(n);
    this.build(0, n);
  }

  private build(lo: number, hi: number): void {
    if (hi - lo <= 1) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = lo; i < hi; i++) {
      const p = this.order[i];
      const x = this.xs[p], z = this.zs[p];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const ax = maxX - minX >= maxZ - minZ ? 0 : 1;
    const key = ax === 0 ? this.xs : this.zs;
    const slice = Array.from(this.order.subarray(lo, hi)).sort((a, b) => key[a] - key[b] || a - b);
    this.order.set(slice, lo);
    const split = lo + ((hi - lo) >> 1);
    this.axis[split] = ax;
    this.build(lo, split);
    this.build(split + 1, hi);
  }

  private offer(p: number, d: number): void {
    const { bestD, bestI } = this;
    let n = this.found;
    if (n === this.k) {
      const lastD = bestD[n - 1];
      if (d > lastD || (d === lastD && p > bestI[n - 1])) return;
      n--;
    }
    let i = n;
    while (i > 0 && (bestD[i - 1] > d || (bestD[i - 1] === d && bestI[i - 1] > p))) {
      bestD[i] = bestD[i - 1];
      bestI[i] = bestI[i - 1];
      i--;
    }
    bestD[i] = d;
    bestI[i] = p;
    this.found = n + 1;
  }

  private search(lo: number, hi: number): void {
    if (hi <= lo) return;
    const split = lo + ((hi - lo) >> 1);
    const p = this.order[split];
    const dx = this.xs[p] - this.qx;
    const dz = this.zs[p] - this.qz;
    this.offer(p, dx * dx + dz * dz);
    if (hi - lo === 1) return;
    const diff = this.axis[split] === 0 ? this.qx - this.xs[p] : this.qz - this.zs[p];
    const [nearLo, nearHi, farLo, farHi] = diff < 0 ? [lo, split, split + 1, hi] : [split + 1, hi, lo, split];
    this.search(nearLo, nearHi);
    // Equal distances still need visiting, for the lower-index tie rule.
    if (this.found < this.k || diff * diff <= this.bestD[this.found - 1]) this.search(farLo, farHi);
  }

  nearest(x: number, z: number): number[] {
    this.qx = x;
    this.qz = z;
    this.found = 0;
    this.k = Math.min(NEIGHBOURS, this.xs.length);
    this.search(0, this.xs.length);
    return Array.from(this.bestI.subarray(0, this.found));
  }
}

/** The lookup grid: 10 m cells from the min extreme, each listing the 10 points nearest its centre. */
export function aiGrid(points: { position: Xyz }[]): { max: Xyz; min: Xyz; cells: number[][][] } {
  const n = points.length;
  if (n === 0) throw new Error("AI grid: no points");
  // Measure from the stored (f32) positions, so that read-then-write gives the same grid.
  const xs = new Float64Array(n);
  const zs = new Float64Array(n);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const [x, , z] = points[i].position;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(points[i].position[1])) {
      throw new Error(`AI line: point ${i} has a non-finite position`);
    }
    xs[i] = f32(x);
    zs[i] = f32(z);
    if (xs[i] < minX) minX = xs[i];
    if (xs[i] > maxX) maxX = xs[i];
    if (zs[i] < minZ) minZ = zs[i];
    if (zs[i] > maxZ) maxZ = zs[i];
  }
  const nx = Math.max(1, Math.floor((maxX - minX) / CELL));
  const nz = Math.max(1, Math.floor((maxZ - minZ) / CELL));
  const tree = new KdTree(xs, zs);
  const cells: number[][][] = [];
  for (let a = 0; a < nx; a++) {
    const row: number[][] = [];
    const cx = minX + (a + 0.5) * CELL;
    for (let b = 0; b < nz; b++) row.push(tree.nearest(cx, minZ + (b + 0.5) * CELL));
    cells.push(row);
  }
  return { max: [maxX, 0, maxZ], min: [minX, 0, minZ], cells };
}

/** The 18 floats of a point's extra record, in file order (obsolete lateral g and tag written as 0). */
const extraRecord = (p: AiPoint): number[] => [
  p.speed, p.gas, p.brake, 0, p.radius, p.sideLeft, p.sideRight, p.camber, p.direction < 0 ? -1 : 1,
  ...p.normal, p.length, ...p.forward, 0, p.grade,
];

/** The version 7 fast_lane.ai file for these points, with the lookup grid. */
export function writeFastLaneAi(line: AiPoint[]): Uint8Array {
  const count = line.length;
  const grid = count ? aiGrid(line) : null;
  const cellCount = grid ? grid.cells.length * grid.cells[0].length : 0;
  const sink = new ByteSink(16 + 92 * count + 64 + 48 * cellCount);
  sink.int32(VERSION).int32(count).int32(0).int32(0);
  line.forEach((p, id) => sink.floats(p.position).float(p.distance).int32(id));
  sink.int32(count);
  line.forEach((p) => sink.floats(extraRecord(p)));
  sink.int32(grid ? 1 : 0);
  if (grid) {
    sink.floats([grid.max[0], 0, grid.max[2], grid.min[0], 0, grid.min[2]]);
    sink.int32(NEIGHBOURS).float(CELL).int32(grid.cells.length);
    grid.cells.forEach((column) => {
      sink.int32(column.length);
      column.forEach((list) => {
        sink.int32(list.length);
        list.forEach((ix) => sink.int32(ix));
      });
    });
  }
  return sink.bytes();
}

/** Reads a version 7 fast_lane.ai back into points (the grid is checked for length and skipped). */
export function readFastLaneAi(file: Uint8Array): AiPoint[] {
  const src = new ByteSource(file);
  const ver = src.int32();
  if (ver !== VERSION) throw new Error(`fast_lane.ai: unsupported version ${ver}`);
  const count = src.int32();
  if (count < 0) throw new Error(`fast_lane.ai: bad point count ${count}`);
  src.skip(8); // lap time, sample count
  const heads = Array.from({ length: count }, () => {
    const at = src.floats(4);
    src.skip(4); // id
    return at;
  });
  const extras = src.int32();
  if (extras !== count) throw new Error(`fast_lane.ai: extra count ${extras} doesn't match point count ${count}`);
  const line = heads.map((h): AiPoint => {
    const e = src.floats(18);
    return {
      position: [h[0], h[1], h[2]], distance: h[3],
      speed: e[0], gas: e[1], brake: e[2], radius: e[4], sideLeft: e[5], sideRight: e[6],
      camber: e[7], direction: e[8] < 0 ? -1 : 1,
      normal: [e[9], e[10], e[11]], length: e[12], forward: [e[13], e[14], e[15]], grade: e[17],
    };
  });
  if (src.int32() !== 0) {
    src.skip(32); // extremes, neighbours, density
    for (let columns = src.int32(); columns > 0; columns--) {
      for (let cellsLeft = src.int32(); cellsLeft > 0; cellsLeft--) src.skip(4 * src.int32());
    }
  }
  if (src.left) throw new Error(`fast_lane.ai: ${src.left} bytes left over`);
  return line;
}
