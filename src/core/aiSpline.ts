// Writer (and reader, for tests) for ai/fast_lane.ai, the AI racing line.
//
// Version 7 layout, as read by Content Manager (AcTools.AiFile.AiSpline) and
// AssettoServer (FastLaneParser.FromFileV7):
//
//   i32 version = 7
//   i32 pointCount, i32 lapTime, i32 sampleCount
//   pointCount x { f32[3] position, f32 length (distance along), i32 id }
//   i32 extraCount (= pointCount)
//   extraCount x { f32 speed, f32 gas, f32 brake, f32 obsoleteLatG,
//                  f32 radius, f32 sideLeft, f32 sideRight,
//                  f32 camber, f32 direction, f32[3] normal, f32 length,
//                  f32[3] forward, f32 tag, f32 grade }
//   i32 hasGrid = 1, then the spatial lookup grid:
//     f32[3] max, f32[3] min (the points' extremes, y zeroed), i32 neighbours (10),
//     f32 cell size (10 m), i32 outer count (cells along x), and for each outer
//     an i32 inner count (cells along z) and for each cell an i32 count and that
//     many point indices: the nearest points to the cell's centre, nearest first.
//   Laid out as in Kunos's own lines (ks_black_cat_county, magione, read on the
//   workstation with scripts/check/ai_grid.py): 10 m cells, floor(extent / 10)
//   of them each way, every cell filled with its 10 nearest points. Without it
//   AC logs "NO POSITION DATA FOUND".
//
// Positions are AC world space (X east, Y up, Z south).

import { BinaryReader, BinaryWriter } from "./binary";

export interface AiPoint {
  position: [number, number, number];
  /** Distance from the first point along the line, metres. */
  distance: number;
  /** Target speed, m/s. */
  speed: number;
  gas: number;
  brake: number;
  /** Turn radius, metres (large on straights). */
  radius: number;
  /** Distance from the line to the left / right edge of the road, metres. */
  sideLeft: number;
  sideRight: number;
  /** Bank angle, radians, with its sign carried by `direction`. */
  camber: number;
  direction: 1 | -1;
  normal: [number, number, number];
  /** Length of the segment to the next point, metres. */
  length: number;
  forward: [number, number, number];
  /** Slope along the line (rise / run). */
  grade: number;
}

export const AI_SPLINE_VERSION = 7;

export function writeFastLaneAi(points: AiPoint[]): Uint8Array {
  const w = new BinaryWriter(points.length * 120 + 64);
  w.i32(AI_SPLINE_VERSION).i32(points.length).i32(0).i32(0);
  points.forEach((p, i) => {
    w.f32s(p.position).f32(p.distance).i32(i);
  });
  w.i32(points.length);
  for (const p of points) {
    w.f32(p.speed).f32(p.gas).f32(p.brake).f32(0);
    w.f32(p.radius).f32(p.sideLeft).f32(p.sideRight);
    w.f32(p.camber).f32(p.direction);
    w.f32s(p.normal).f32(p.length).f32s(p.forward);
    w.f32(0).f32(p.grade);
  }
  writeGrid(w, points);
  return w.finish();
}

const GRID_CELL = 10;
const GRID_NEIGHBOURS = 10;

/** The lookup grid (see the layout above): for each 10 m cell, the indices of the nearest points. */
export function aiGrid(points: { position: [number, number, number] }[]): { max: [number, number, number]; min: [number, number, number]; cells: number[][][] } {
  const xs = points.map((p) => p.position[0]), zs = points.map((p) => p.position[2]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const nx = Math.max(1, Math.floor((maxX - minX) / GRID_CELL)), nz = Math.max(1, Math.floor((maxZ - minZ) / GRID_CELL));
  // A 2D k-d tree over the points (x, z), for the nearest points to each cell's centre.
  const P = points.map((p) => [p.position[0], p.position[2]] as [number, number]);
  type Node = { i: number; axis: 0 | 1; lo: Node | null; hi: Node | null };
  const build = (idx: number[], depth: number): Node | null => {
    if (!idx.length) return null;
    const axis = (depth % 2) as 0 | 1;
    idx.sort((u, v) => P[u][axis] - P[v][axis] || u - v);
    const m = idx.length >> 1;
    return { i: idx[m], axis, lo: build(idx.slice(0, m), depth + 1), hi: build(idx.slice(m + 1), depth + 1) };
  };
  const root = build(points.map((_, i) => i), 0);
  const k = Math.min(GRID_NEIGHBOURS, points.length);
  // Best k so far as [distance, index], kept sorted (nearest first, ties by index).
  const nearest = (cx: number, cz: number): number[] => {
    const best: [number, number][] = [];
    const add = (d: number, i: number) => {
      if (best.length === k && (d > best[k - 1][0] || (d === best[k - 1][0] && i > best[k - 1][1]))) return;
      let j = best.length;
      while (j > 0 && (best[j - 1][0] > d || (best[j - 1][0] === d && best[j - 1][1] > i))) j--;
      best.splice(j, 0, [d, i]);
      if (best.length > k) best.pop();
    };
    const q: [number, number] = [cx, cz];
    const visit = (n: Node | null) => {
      if (!n) return;
      add(Math.hypot(P[n.i][0] - cx, P[n.i][1] - cz), n.i);
      const diff = q[n.axis] - P[n.i][n.axis];
      const [near, far] = diff < 0 ? [n.lo, n.hi] : [n.hi, n.lo];
      visit(near);
      if (best.length < k || Math.abs(diff) <= best[best.length - 1][0]) visit(far);
    };
    visit(root);
    return best.map((b) => b[1]);
  };
  const cells: number[][][] = [];
  for (let a = 0; a < nx; a++) {
    const row: number[][] = [];
    for (let b = 0; b < nz; b++) row.push(nearest(minX + (a + 0.5) * GRID_CELL, minZ + (b + 0.5) * GRID_CELL));
    cells.push(row);
  }
  return { max: [maxX, 0, maxZ], min: [minX, 0, minZ], cells };
}

function writeGrid(w: BinaryWriter, points: AiPoint[]): void {
  if (!points.length) {
    w.i32(0);
    return;
  }
  const g = aiGrid(points);
  w.i32(1).f32s(g.max).f32s(g.min).i32(GRID_NEIGHBOURS).f32(GRID_CELL).i32(g.cells.length);
  for (const row of g.cells) {
    w.i32(row.length);
    for (const cell of row) {
      w.i32(cell.length);
      for (const i of cell) w.i32(i);
    }
  }
}

export function readFastLaneAi(data: Uint8Array): AiPoint[] {
  const r = new BinaryReader(data);
  const version = r.i32();
  if (version !== AI_SPLINE_VERSION) throw new Error(`Unsupported AI spline version ${version}`);
  const count = r.i32();
  r.i32();
  r.i32();
  const base = [];
  for (let i = 0; i < count; i++) {
    base.push({ position: r.f32s(3) as [number, number, number], distance: r.f32(), id: r.i32() });
  }
  const extraCount = r.i32();
  if (extraCount !== count) throw new Error("AI spline extra count does not match point count");
  const out: AiPoint[] = [];
  for (let i = 0; i < count; i++) {
    const speed = r.f32(), gas = r.f32(), brake = r.f32();
    r.f32();
    const radius = r.f32(), sideLeft = r.f32(), sideRight = r.f32();
    const camber = r.f32(), direction = (r.f32() < 0 ? -1 : 1) as 1 | -1;
    const normal = r.f32s(3) as [number, number, number];
    const length = r.f32();
    const forward = r.f32s(3) as [number, number, number];
    r.f32();
    const grade = r.f32();
    out.push({
      position: base[i].position, distance: base[i].distance, speed, gas, brake, radius,
      sideLeft, sideRight, camber, direction, normal, length, forward, grade,
    });
  }
  if (r.i32() !== 0) {
    // The lookup grid: skipped (it's rebuilt from the points when written).
    r.f32s(3);
    r.f32s(3);
    r.i32();
    r.f32();
    const outer = r.i32();
    for (let a = 0; a < outer; a++) {
      const inner = r.i32();
      for (let b = 0; b < inner; b++) {
        const n = r.i32();
        for (let k = 0; k < n; k++) r.i32();
      }
    }
  }
  if (r.remaining !== 0) throw new Error(`${r.remaining} trailing bytes`);
  return out;
}
