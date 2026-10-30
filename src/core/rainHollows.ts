// Busselton fork: where rain would pool on the drivable surface, for CSP's RainFX.
//
// CSP has no key for placing a puddle. It finds puddles itself from a height map of the track
// ("more puddles in lower areas, for that, CSP uses track height map": acc-extension-config wiki,
// Tracks - RainFX, RELIEF_MATERIALS), and that map is built from every mesh by default, so the
// ground beside a house reads as a hollow. What a track can do (cspConfig.ts writes it):
//
// - RELIEF_MATERIALS: what goes into that height map. We give it the ground and the roads only,
//   as Brands Hatch's and Nevada Drift's shipped configs do, so the hollows CSP finds are the real
//   ones in the road.
// - the hollows this module finds, written as comments in AC coordinates, so the workstation can
//   fly to each one (F7 camera, Objects Inspector) in the rain and check that water stands there.
//
// How: the physics meshes the car drives on (road, streets, gutters, kerbs) are drawn into a 1 m
// height grid, keeping the highest surface in each cell, so a kerb is a wall. Water runs off the
// grid wherever its edge is open: at a road edge with no kerb (onto the verge) or a driveway's laid
// back kerb. Priority flood (Barnes et al. 2014) fills every cell to the lowest level water could
// leave it at; where that's above the surface, water stands. Real streets have side-entry pits at
// their sags, so a basin is only filled up to `maxDepth` above its lowest point.

import type { Kn5Node } from "./kn5";

/** A drivable surface's heights in a grid over AC's x (east) and z (south). NaN off the surface. */
export interface SurfaceGrid {
  minX: number;
  minZ: number;
  cell: number;
  w: number;
  h: number;
  /** Highest surface in each cell, metres (AC y). */
  y: Float32Array;
  /** 1 where a puddle can show (road and street, not kerbs, footpaths or driveways). */
  wet: Uint8Array;
}

export interface Hollow {
  /** Lowest point, AC coordinates (x east, y up, z south). */
  low: [number, number, number];
  /** Middle of the standing water, AC coordinates (y = water level). */
  centre: [number, number, number];
  /** Water depth at the lowest point, metres. */
  depth: number;
  /** Area under water, square metres. */
  area: number;
  /** Water volume, cubic metres. */
  volume: number;
  /** Furthest standing water from the centre, metres. */
  radius: number;
}

export interface HollowOptions {
  /** Shallower than this doesn't count as standing water, metres. */
  minDepth?: number;
  /** Smaller than this isn't a puddle, square metres. */
  minArea?: number;
  /** Drains: water rises at most this far above a basin's lowest point, metres. */
  maxDepth?: number;
  /** Keep the biggest this many (by volume). */
  maxCount?: number;
}

export interface SurfaceMesh {
  name: string;
  /** xyz per vertex, AC world space. */
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

/** Physics meshes water runs on or is held by: road, streets, gutters, kerbs (surfaces.ini keys). */
export const SURFACE_MESH = /^\d+(ROAD|STREET|KERB)_/;
/** Of those, where a puddle can show: not kerbs, footpaths or driveways. */
const WET_MESH = /^\d+(ROAD|STREET)_(?!PATH|DRIVE)/;

/** The drivable meshes in a kn5 tree (no transforms: the generator writes world positions). */
export function surfaceMeshes(root: Kn5Node): SurfaceMesh[] {
  const out: SurfaceMesh[] = [];
  const walk = (n: Kn5Node) => {
    if (n.kind === "mesh") {
      if (SURFACE_MESH.test(n.name)) out.push({ name: n.name, positions: n.positions, indices: n.indices });
    } else n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/**
 * Draws the meshes into a height grid, keeping the highest surface per cell. Each triangle sets the
 * cells whose centres it covers, and its edges are walked at half a cell so thin strips (a kerb's
 * top, 15 cm wide) still land in the grid and hold water back.
 */
export function rasterSurface(meshes: SurfaceMesh[], cell = 1, maxCells = 12e6): SurfaceGrid | null {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const m of meshes) {
    for (let i = 0; i < m.positions.length; i += 3) {
      const x = m.positions[i], z = m.positions[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (!isFinite(minX)) return null;
  // A big area build: coarser cells rather than run out of memory.
  while (((maxX - minX) / cell + 3) * ((maxZ - minZ) / cell + 3) > maxCells) cell *= 1.5;
  minX -= cell;
  minZ -= cell;
  const w = Math.ceil((maxX - minX) / cell) + 2, h = Math.ceil((maxZ - minZ) / cell) + 2;
  const y = new Float32Array(w * h).fill(NaN);
  const wet = new Uint8Array(w * h);
  const put = (i: number, j: number, v: number, isWet: boolean) => {
    if (i < 0 || j < 0 || i >= w || j >= h) return;
    const k = j * w + i;
    if (!(y[k] >= v)) y[k] = v;
    if (isWet) wet[k] = 1;
  };
  for (const m of meshes) {
    const isWet = WET_MESH.test(m.name);
    const P = m.positions, I = m.indices;
    for (let t = 0; t + 2 < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ax = (P[a] - minX) / cell, az = (P[a + 2] - minZ) / cell, ay = P[a + 1];
      const bx = (P[b] - minX) / cell, bz = (P[b + 2] - minZ) / cell, by = P[b + 1];
      const cx = (P[c] - minX) / cell, cz = (P[c + 2] - minZ) / cell, cy = P[c + 1];
      // Cell centres inside the triangle.
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) > 1e-9) {
        const i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), i1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
        const j0 = Math.max(0, Math.floor(Math.min(az, bz, cz))), j1 = Math.min(h - 1, Math.ceil(Math.max(az, bz, cz)));
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const px = i + 0.5, pz = j + 0.5;
            const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den;
            const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den;
            const l3 = 1 - l1 - l2;
            if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
            put(i, j, l1 * ay + l2 * by + l3 * cy, isWet);
          }
        }
      }
      // Edges, so slivers count.
      for (const [x0, z0, y0, x1, z1, y1] of [[ax, az, ay, bx, bz, by], [bx, bz, by, cx, cz, cy], [cx, cz, cy, ax, az, ay]]) {
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 2));
        for (let s = 0; s <= n; s++) {
          const f = s / n;
          // Edges only hold water back: they never mark a cell as somewhere a puddle shows.
          put(Math.floor(x0 + (x1 - x0) * f), Math.floor(z0 + (z1 - z0) * f), y0 + (y1 - y0) * f, false);
        }
      }
    }
  }
  return { minX, minZ, cell, w, h, y, wet };
}

/** A binary min-heap of grid cells keyed by water level. */
class LevelHeap {
  private keys = new Float64Array(1024);
  private vals = new Int32Array(1024);
  size = 0;
  push(key: number, val: number) {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2); k.set(this.keys); this.keys = k;
      const v = new Int32Array(this.size * 2); v.set(this.vals); this.vals = v;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p]; this.vals[i] = this.vals[p]; i = p;
    }
    this.keys[i] = key; this.vals[i] = val;
  }
  /** Pops the lowest; returns its cell (its level is `lastKey`). */
  lastKey = 0;
  pop(): number {
    const top = this.vals[0];
    this.lastKey = this.keys[0];
    const key = this.keys[--this.size], val = this.vals[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c]; this.vals[i] = this.vals[c]; i = c;
    }
    this.keys[i] = key; this.vals[i] = val;
    return top;
  }
}

/**
 * The water level each cell fills to before water runs off the surface (priority flood).
 * Cells at the surface's edge (next to a cell off it, or the grid's edge) drain.
 */
export function fillLevels(g: SurfaceGrid): Float32Array {
  const { w, h, y } = g;
  const level = new Float32Array(w * h).fill(NaN);
  const done = new Uint8Array(w * h);
  const heap = new LevelHeap();
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < h && !isNaN(y[j * w + i]);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (isNaN(y[k])) continue;
      if (!on(i - 1, j) || !on(i + 1, j) || !on(i, j - 1) || !on(i, j + 1)) {
        level[k] = y[k]; done[k] = 1; heap.push(y[k], k);
      }
    }
  }
  while (heap.size) {
    const k = heap.pop(), lv = heap.lastKey;
    const i = k % w, j = (k - i) / w;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (!on(ni, nj)) continue;
      const n = nj * w + ni;
      if (done[n]) continue;
      done[n] = 1;
      level[n] = Math.max(y[n], lv);
      heap.push(level[n], n);
    }
  }
  return level;
}

/** Where water stands on the surface after rain, biggest first. */
export function findHollows(g: SurfaceGrid, opts: HollowOptions = {}): Hollow[] {
  const minDepth = opts.minDepth ?? 0.02, minArea = opts.minArea ?? 4, maxDepth = opts.maxDepth ?? 0.15, maxCount = opts.maxCount ?? 48;
  const { w, h, y, cell, wet } = g;
  const level = fillLevels(g);
  const seen = new Uint8Array(w * h);
  const out: Hollow[] = [];
  const stack: number[] = [];
  for (let k0 = 0; k0 < w * h; k0++) {
    if (seen[k0] || !(level[k0] - y[k0] >= minDepth)) continue;
    // One basin: the cells under at least minDepth of water, joined on any side or corner.
    const cells: number[] = [];
    stack.push(k0); seen[k0] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      cells.push(k);
      const i = k % w, j = (k - i) / w;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
          const n = nj * w + ni;
          if (!seen[n] && level[n] - y[n] >= minDepth) { seen[n] = 1; stack.push(n); }
        }
      }
    }
    let low = cells[0], spill = -Infinity;
    for (const k of cells) {
      if (y[k] < y[low]) low = k;
      if (level[k] > spill) spill = level[k];
    }
    // Drains: no deeper than maxDepth over the lowest point.
    const water = Math.min(spill, y[low] + maxDepth);
    let n = 0, sx = 0, sz = 0, vol = 0;
    const under: number[] = [];
    for (const k of cells) {
      const d = water - y[k];
      if (d < minDepth || !wet[k]) continue;
      under.push(k);
      n++;
      sx += k % w; sz += Math.floor(k / w);
      vol += d;
    }
    const area = n * cell * cell;
    if (area < minArea) continue;
    const ci = sx / n, cj = sz / n;
    let r = 0;
    for (const k of under) r = Math.max(r, Math.hypot((k % w) - ci, Math.floor(k / w) - cj));
    const at = (fi: number, fj: number): [number, number] => [g.minX + (fi + 0.5) * cell, g.minZ + (fj + 0.5) * cell];
    const [lx, lz] = at(low % w, Math.floor(low / w));
    const [cx, cz] = at(ci, cj);
    out.push({
      low: [lx, y[low], lz],
      centre: [cx, water, cz],
      depth: water - y[low],
      area,
      volume: vol * cell * cell,
      radius: (r + 0.5) * cell,
    });
  }
  out.sort((a, b) => b.volume - a.volume);
  return out.slice(0, maxCount);
}

/** The hollows in a built track's drivable meshes. */
export function trackHollows(root: Kn5Node, opts: HollowOptions = {}): Hollow[] {
  const g = rasterSurface(surfaceMeshes(root));
  return g ? findHollows(g, opts) : [];
}
