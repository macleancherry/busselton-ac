// Busselton fork: is the road clear, and is it all there? (scripts/check/road_clear.ts runs it on a
// build's zip.)
//
// Mac drove Busselton and saw buildings and trees standing in the road, streets with pieces missing
// and the red shared path coming and going, while every other check passed: those look at heights
// (ground_check, street_ground, path_ground) or at the route alone (surface_check). This one looks
// at the plan view. Every kn5 the track loads (the world, the layouts, the landmark and hand-made
// layers) is rasterised at half a metre:
//   - the drivable surface (ROAD_SURFACE: the route, streets, car parks, rings and gutters) and kerbs,
//     the OSM path ribbons, and every other physics ground (grass, verges, the photo's footpaths,
//     terrain), each as the top height per cell;
//   - the placed things that must never stand in the road: buildings and shops, lots and fences,
//     landmarks and layers, and trees (trunks, crowns lower than TREE_CLEAR, the trees' collision
//     walls). Paint, furniture, traffic lights, wires, parked cars and the layouts' course markings
//     (barriers closing a street on purpose) aren't obstacles here.
// Then:
//   (a) obstacles: road cells at least EDGE_IN in from the drivable edge with part of a building,
//       lot, landmark or layer on them below ROOF_CLEAR over the road;
//   (b) trees on such road cells;
//   (c) missing road: points along the streets the build meant to build (extension/street_map.png,
//       drawn from the street plan) with no drivable surface near, or with the ground over it
//       (buried); and OSM streets inside the area that were never built at all;
//   (d) paths: points along the OSM shared paths (and footpaths) with no path ribbon, or with the
//       ground over the ribbon, where there's built ground to lay it on.
// Pieces are the connected sets of flagged cells (or runs of points along a line).

import type { Vec2 } from "./geo";
import type { Kn5Node } from "./kn5";
import { ROAD_SURFACE } from "./sceneGround";

/** Metres a cell. */
export const CELL = 0.5;
/** Obstacles count only this far (metres) in from the drivable edge (one cell at 0.5 m). */
export const EDGE_IN = 0.5;
/** Parts of a building higher than this over the road don't count (an awning high over it). */
export const ROOF_CLEAR = 4.5;
/** A tree's parts lower than this over the road count (its trunk, a low crown). */
export const TREE_CLEAR = 3;
/** A trunk's radius, metres. */
export const TRUNK = 0.4;
/** The ground is over a surface when it's more than this above it, metres. */
export const BURIED = 0.03;

export type ObstacleKind = "building" | "lot" | "landmark" | "tree";
export const OBSTACLE_KINDS: ObstacleKind[] = ["building", "lot", "landmark", "tree"];
/** Which kind a cell reports when several stand on it, by 1 + OBSTACLE_KINDS index. */
const PRIORITY = [0, 3, 1, 2, 4];

const KERB = /^\dKERB/;
const PATH = /^\dROAD_PATH/;
const PHYSICS = /^\d(?!WALL)/;

/** Groups that are never obstacles: paint, poles and lights, wires, cars, the sea, the horizon. */
const NOT_OBSTACLE_GROUPS = new Set(["HORIZON", "SEA", "SEAWALL", "MARKINGS", "WIRES", "TRAFFICLIGHTS", "FURNITURE", "PARKED_CARS", "PARKED_CAR_WALLS", "WALLS", "JETTY", "GUIDEPOSTS", "RAILS"]);
/** Meshes that are never obstacles: course markings, paint, flat driveways. */
const NOT_OBSTACLE = /^(CM_|1CLOSED|1RIPPLE|MARKINGS|DRIVEWAY|ARMCO_|1WALL_RAIL|1WALL_ARMCO|1WALL_CAR|1WALL_L|1WALL_R$|1WALL_R_)/;

/** What a mesh is to this check, from its name, its top group and the kn5 it's in. */
export function obstacleKind(mesh: string, group: string, file: string): ObstacleKind | null {
  if (NOT_OBSTACLE.test(mesh)) return null;
  if (/^(TREES|ISLANDTREES|1WALL_TREE)/.test(mesh)) return "tree";
  if (/SPECHOUSE|^FLAGBACK/.test(mesh) || /(^|\/)(lm|layer)_[^/]*\.kn5$/.test(file)) return "landmark";
  if (NOT_OBSTACLE_GROUPS.has(group) || PHYSICS.test(mesh)) return null; // ground, not a thing standing on it
  if (group === "BUILDINGS" || group === "SHOPS") return "building";
  if (group === "LOTS" || group === "FENCES" || group === "FARM" || group === "FARMROAD") return "lot";
  return null;
}
/** Walls (1WALL_...) are physics but they stand: classify them before the ground test. */
export function meshRole(mesh: string, group: string, file: string): "road" | "kerb" | "path" | "ground" | ObstacleKind | null {
  const isLayout = /(^|\/)layout_[^/]*\.kn5$/.test(file);
  if (!isLayout && ROAD_SURFACE.test(mesh)) return "road";
  if (!isLayout && KERB.test(mesh)) return "kerb";
  if (!isLayout && PATH.test(mesh)) return "path";
  if (/^\dWALL/.test(mesh) || !PHYSICS.test(mesh)) return obstacleKind(mesh, group, file);
  if (isLayout || /(^|\/)(lm|layer)_[^/]*\.kn5$/.test(file)) return null; // a layer's paving etc.: not the base's ground
  return "ground";
}

/** The drivable surfaces, told apart in reports: the route (and its rings), streets, car parks, other. */
export const ROAD_KINDS = ["route", "street", "car park", "other"] as const;
export function roadKindOf(mesh: string): number {
  if (/^\dROAD/.test(mesh)) return 1;
  if (/^\dSTREET_CARPARK/.test(mesh)) return 3;
  if (/^\dSTREET/.test(mesh)) return 2;
  return 4;
}

/** A plan-view grid over local metres (x east, y north). */
export class PlanGrid {
  readonly nx: number;
  readonly ny: number;
  constructor(readonly x0: number, readonly y0: number, x1: number, y1: number, readonly cell = CELL) {
    this.nx = Math.max(1, Math.ceil((x1 - x0) / cell));
    this.ny = Math.max(1, Math.ceil((y1 - y0) / cell));
  }
  /** The cell at a point, or -1 outside. */
  at(x: number, y: number): number {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((y - this.y0) / this.cell);
    return i < 0 || j < 0 || i >= this.nx || j >= this.ny ? -1 : j * this.nx + i;
  }
  /** A cell's centre. */
  centre(c: number): Vec2 {
    return [this.x0 + ((c % this.nx) + 0.5) * this.cell, this.y0 + (Math.floor(c / this.nx) + 0.5) * this.cell];
  }
}

type Mesh = Extract<Kn5Node, { kind: "mesh" }>;

/**
 * Visits the cells a mesh's triangles cover in plan, with the height there: cell centres inside a
 * triangle (interpolated), and points every quarter cell along its edges (so walls, which have no
 * area in plan, are seen too). AC positions: x east, y up, z south.
 */
export function rasterMesh(grid: PlanGrid, m: { positions: Float32Array; indices: Uint16Array }, visit: (cell: number, h: number) => void, edges = true): void {
  const p = m.positions, ix = m.indices, C = grid.cell;
  const step = C / 4;
  for (let t = 0; t + 2 < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    const ax = p[a], ay = -p[a + 2], ah = p[a + 1];
    const bx = p[b], by = -p[b + 2], bh = p[b + 1];
    const cx = p[c], cy = -p[c + 2], ch = p[c + 1];
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx), minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
    if (maxX < grid.x0 || maxY < grid.y0 || minX > grid.x0 + grid.nx * C || minY > grid.y0 + grid.ny * C) continue;
    const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(d) > 1e-6) {
      const i0 = Math.max(0, Math.ceil((minX - grid.x0) / C - 0.5)), i1 = Math.min(grid.nx - 1, Math.floor((maxX - grid.x0) / C - 0.5));
      const j0 = Math.max(0, Math.ceil((minY - grid.y0) / C - 0.5)), j1 = Math.min(grid.ny - 1, Math.floor((maxY - grid.y0) / C - 0.5));
      for (let j = j0; j <= j1; j++) {
        const y = grid.y0 + (j + 0.5) * C;
        for (let i = i0; i <= i1; i++) {
          const x = grid.x0 + (i + 0.5) * C;
          const w1 = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / d;
          const w2 = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / d;
          const w3 = 1 - w1 - w2;
          if (w1 < -1e-9 || w2 < -1e-9 || w3 < -1e-9) continue;
          visit(j * grid.nx + i, w1 * ah + w2 * bh + w3 * ch);
        }
      }
    }
    if (!edges) continue;
    const edge = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number) => {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let k = 0; k <= n; k++) {
        const f = k / n, cell = grid.at(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
        if (cell >= 0) visit(cell, h0 + (h1 - h0) * f);
      }
    };
    edge(ax, ay, ah, bx, by, bh); edge(bx, by, bh, cx, cy, ch); edge(cx, cy, ch, ax, ay, ah);
  }
}

/**
 * Each connected piece of a mesh (shared vertices, or vertices at the same spot): the middle of its
 * lowest vertices (within 0.3 m of its lowest), local x, y, and that height. Joining by spot as well
 * puts a sprite's two faces (each with its own vertices) and a quad cut in two back together.
 */
export function trunksOf(m: { positions: ArrayLike<number>; indices: ArrayLike<number> }): [number, number, number][] {
  const n = m.positions.length / 3, parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a: number): number => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  const join = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const ix = m.indices;
  for (let t = 0; t + 2 < ix.length; t += 3) {
    join(ix[t], ix[t + 2]);
    join(ix[t + 1], ix[t + 2]);
  }
  const spot = new Map<string, number>();
  for (let v = 0; v < n; v++) {
    const k = `${Math.round(m.positions[v * 3] * 1000)},${Math.round(m.positions[v * 3 + 1] * 1000)},${Math.round(m.positions[v * 3 + 2] * 1000)}`;
    const w = spot.get(k);
    if (w === undefined) spot.set(k, v);
    else join(v, w);
  }
  const lo = new Map<number, number>();
  const used = new Uint8Array(n);
  for (let k = 0; k < ix.length; k++) used[ix[k]] = 1;
  const p = m.positions;
  for (let v = 0; v < n; v++) if (used[v]) { const r = find(v); lo.set(r, Math.min(lo.get(r) ?? Infinity, p[v * 3 + 1])); }
  const acc = new Map<number, [number, number, number]>();
  for (let v = 0; v < n; v++) {
    if (!used[v]) continue;
    const r = find(v), h = p[v * 3 + 1];
    if (h > lo.get(r)! + 0.3) continue;
    const a = acc.get(r) ?? [0, 0, 0];
    a[0] += p[v * 3]; a[1] += -p[v * 3 + 2]; a[2]++;
    acc.set(r, a);
  }
  return [...acc].map(([r, [x, y, k]]) => [x / k, y / k, lo.get(r)!]);
}

/** Two meshes as one (positions and indices only), under the first one's name. */
function joinMeshes(a: Mesh, b: Mesh): Mesh {
  const positions = new Float32Array(a.positions.length + b.positions.length);
  positions.set(a.positions);
  positions.set(b.positions, a.positions.length);
  const off = a.positions.length / 3;
  const indices = new Uint32Array(a.indices.length + b.indices.length);
  indices.set(a.indices);
  for (let i = 0; i < b.indices.length; i++) indices[a.indices.length + i] = b.indices[i] + off;
  return { ...a, positions, indices } as unknown as Mesh;
}

/** A kn5 file's meshes with their top group (the root's child they're under). */
export function meshesOf(root: Kn5Node): { mesh: Mesh; group: string }[] {
  const out: { mesh: Mesh; group: string }[] = [];
  const walk = (n: Kn5Node, group: string) => {
    if (n.kind === "mesh") out.push({ mesh: n, group });
    else n.children.forEach((c) => walk(c, group));
  };
  const top = root.kind === "node" ? root.children : [root];
  for (const n of top) walk(n, n.kind === "node" ? n.name : "");
  return out;
}

/** The surfaces and obstacles of a track, rasterised. */
export interface Planes {
  grid: PlanGrid;
  /** Top height per cell, NaN where none: drivable, kerbs, path ribbons, other physics ground. */
  road: Float32Array;
  /** Which drivable surface is on top: 1 + a ROAD_KINDS index, 0 none. */
  roadKind: Uint8Array;
  kerb: Float32Array;
  path: Float32Array;
  /** 1 where the path ribbon on top is a shared path's (1ROAD_PATH_SHARED...). */
  pathShared: Uint8Array;
  ground: Float32Array;
  /** 1 + an OBSTACLE_KINDS index on inner road cells with an obstacle on them, else 0. */
  obstacle: Uint8Array;
  /** Which mesh (index into `names`) put the obstacle there. */
  obstacleMesh: Uint16Array;
  /** The obstacle's lowest point over the road on each obstacle cell, metres. */
  obstacleLow: Float32Array;
  /** Cells from each drivable cell to the nearest cell that isn't drivable or kerb (chamfer, x10). */
  depth: Uint16Array;
  names: string[];
}

export interface Kn5File { file: string; root: Kn5Node }

/**
 * Rasterises the files' surfaces and obstacles over the box (local metres). `bounds` defaults to the
 * drivable meshes' extent plus 20 m.
 */
export function rasterise(files: Kn5File[], bounds?: [number, number, number, number], cell = CELL): Planes {
  const roles = files.flatMap((f) => meshesOf(f.root).map(({ mesh, group }) => ({ mesh, group, file: f.file, role: meshRole(mesh.name, group, f.file) })));
  if (!bounds) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of roles) {
      if (r.role !== "road") continue;
      const p = r.mesh.positions;
      for (let v = 0; v < p.length; v += 3) {
        const x = p[v], y = -p[v + 2];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (!(x1 > x0)) throw new Error("no drivable meshes");
    bounds = [x0 - 20, y0 - 20, x1 + 20, y1 + 20];
  }
  const grid = new PlanGrid(bounds[0], bounds[1], bounds[2], bounds[3], cell);
  const n = grid.nx * grid.ny;
  const planes: Planes = {
    grid,
    road: new Float32Array(n).fill(NaN), roadKind: new Uint8Array(n), kerb: new Float32Array(n).fill(NaN),
    path: new Float32Array(n).fill(NaN), pathShared: new Uint8Array(n), ground: new Float32Array(n).fill(NaN),
    obstacle: new Uint8Array(n), obstacleMesh: new Uint16Array(n), obstacleLow: new Float32Array(n).fill(NaN), names: [],
    depth: new Uint16Array(n),
  };
  const top = (arr: Float32Array) => (c: number, h: number) => { if (!(arr[c] >= h)) arr[c] = h; };
  for (const r of roles) {
    if (r.role === "road") {
      const k = roadKindOf(r.mesh.name);
      rasterMesh(grid, r.mesh, (c, h) => { if (!(planes.road[c] >= h)) { planes.road[c] = h; planes.roadKind[c] = k; } }, false);
    }
    else if (r.role === "kerb") rasterMesh(grid, r.mesh, top(planes.kerb), false);
    else if (r.role === "path") {
      const shared = /SHARED/.test(r.mesh.name) ? 1 : 0;
      rasterMesh(grid, r.mesh, (c, h) => { if (!(planes.path[c] >= h)) { planes.path[c] = h; planes.pathShared[c] = shared; } }, false);
    }
    else if (r.role === "ground") rasterMesh(grid, r.mesh, top(planes.ground), false);
  }
  // How deep into the road each cell is (3-4 chamfer, 10 a cell straight); inner road cells are
  // drivable and at least EDGE_IN in from anything that's neither drivable nor kerb.
  const D = planes.depth, nx = grid.nx;
  for (let c = 0; c < n; c++) D[c] = !Number.isNaN(planes.road[c]) || !Number.isNaN(planes.kerb[c]) ? 65535 : 0;
  const relax = (c: number, d: number, w: number) => { if (D[d] + w < D[c]) D[c] = D[d] + w; };
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i;
    if (!D[c]) continue;
    if (i === 0 || j === 0 || i === nx - 1 || j === grid.ny - 1) { D[c] = 10; continue; }
    relax(c, c - 1, 10); relax(c, c - nx, 10); relax(c, c - nx - 1, 14); relax(c, c - nx + 1, 14);
  }
  for (let j = grid.ny - 2; j > 0; j--) for (let i = nx - 2; i > 0; i--) {
    const c = j * nx + i;
    if (!D[c]) continue;
    relax(c, c + 1, 10); relax(c, c + nx, 10); relax(c, c + nx + 1, 14); relax(c, c + nx - 1, 14);
  }
  const minDepth = (EDGE_IN / cell) * 10 + 10; // the cell's own half plus EDGE_IN
  const inner = (c: number) => D[c] >= minDepth && !Number.isNaN(planes.road[c]);
  // A tree mesh split into area tiles (cull.ts: <name>_T<k>, by triangle) can have a sprite's two
  // triangles in different tiles: each tile's half then looks like a trunk at the sprite's end.
  // The tiles of one tree mesh are joined back into one before looking for trunks.
  const treeTiles = new Map<string, { file: string; mesh: Mesh; group: string; role: ObstacleKind }>();
  const joined: typeof roles = [];
  for (const r of roles) {
    if (r.role !== "tree") { joined.push(r); continue; }
    const key = `${r.file}:${r.mesh.name.replace(/_T\d+$/, "")}`;
    const had = treeTiles.get(key);
    if (!had) { const e = { ...r, role: "tree" as ObstacleKind }; treeTiles.set(key, e); joined.push(e); continue; }
    had.mesh = joinMeshes(had.mesh, r.mesh);
  }
  for (const r of joined) {
    const kind = r.role && (OBSTACLE_KINDS as string[]).includes(r.role) ? (r.role as ObstacleKind) : null;
    if (!kind) continue;
    const k = OBSTACLE_KINDS.indexOf(kind) + 1;
    let id = -1;
    const mark = (c: number, h: number) => {
      if (!inner(c)) return;
      const road = planes.road[c];
      if (h < road - 0.1 || h > road + ROOF_CLEAR) return;
      if (!(planes.obstacleLow[c] <= h - road)) planes.obstacleLow[c] = h - road;
      // The worst thing on a cell is the one reported: a tree, then a building, a landmark, a lot.
      if (planes.obstacle[c] && PRIORITY[planes.obstacle[c]] >= PRIORITY[k]) return;
      if (id < 0) { id = planes.names.length; planes.names.push(`${r.file.replace(/^.*\//, "")}:${r.mesh.name}`); }
      planes.obstacle[c] = k;
      planes.obstacleMesh[c] = Math.min(id, 65535);
    };
    if (kind !== "tree") { rasterMesh(grid, r.mesh, mark); continue; }
    // A tree is where its trunk is: each connected piece of a tree mesh (a quad of a crossed sprite,
    // a trunk, a collision box) stands at the middle of its lowest vertices. Crowns overhanging the
    // road higher up are fine, and a sprite's lower corners are transparent.
    for (const t of trunksOf(r.mesh)) {
      const c = grid.at(t[0], t[1]);
      if (c < 0 || !inner(c) || t[2] > planes.road[c] + TREE_CLEAR) continue;
      for (let dy = -TRUNK; dy <= TRUNK; dy += cell / 2) for (let dx = -TRUNK; dx <= TRUNK; dx += cell / 2) {
        const d = grid.at(t[0] + dx, t[1] + dy);
        if (d >= 0 && dx * dx + dy * dy <= TRUNK * TRUNK) mark(d, Math.max(t[2], planes.road[d]));
      }
    }
  }
  return planes;
}

/** A connected set of flagged cells. */
export interface Piece {
  kind: string;
  cells: number;
  /** Square metres. */
  area: number;
  /** Middle, local x east, y north. */
  at: Vec2;
  /** The mesh with the most cells in it. */
  mesh?: string;
  /** How far into the road it reaches at most, metres (from the drivable edge). */
  depth?: number;
  /** Its lowest point over the road, metres. */
  low?: number;
  /** The drivable surface under most of it (ROAD_KINDS). */
  on?: string;
}

/** Connected pieces (8-neighbour) of the cells where `label` gives the same non-zero value. */
export function piecesOf(grid: PlanGrid, label: (c: number) => number, meshOf?: (c: number) => string | undefined, kindName: (k: number) => string = String,
  extra?: { depth?: (c: number) => number; low?: (c: number) => number; on?: (c: number) => string }): Piece[] {
  const n = grid.nx * grid.ny, seen = new Uint8Array(n), out: Piece[] = [];
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    const k = label(s);
    if (!k || seen[s]) continue;
    seen[s] = 1;
    stack.push(s);
    let cells = 0, sx = 0, sy = 0, depth = -Infinity, low = Infinity;
    const meshes = new Map<string, number>(), ons = new Map<string, number>();
    while (stack.length) {
      const c = stack.pop()!;
      cells++;
      const [x, y] = grid.centre(c);
      sx += x; sy += y;
      const m = meshOf?.(c);
      if (m) meshes.set(m, (meshes.get(m) ?? 0) + 1);
      if (extra?.depth) depth = Math.max(depth, extra.depth(c));
      if (extra?.low) low = Math.min(low, extra.low(c));
      if (extra?.on) { const o = extra.on(c); ons.set(o, (ons.get(o) ?? 0) + 1); }
      const i = c % grid.nx, j = (c - i) / grid.nx;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= grid.nx || jj >= grid.ny) continue;
        const d = jj * grid.nx + ii;
        if (!seen[d] && label(d) === k) { seen[d] = 1; stack.push(d); }
      }
    }
    const mesh = [...meshes].sort((a, b) => b[1] - a[1])[0]?.[0];
    out.push({
      kind: kindName(k), cells, area: cells * grid.cell * grid.cell, at: [sx / cells, sy / cells], ...(mesh ? { mesh } : {}),
      ...(extra?.depth ? { depth } : {}), ...(extra?.low ? { low } : {}),
      ...(extra?.on ? { on: [...ons].sort((a, b) => b[1] - a[1])[0]?.[0] } : {}),
    });
  }
  return out.sort((a, b) => b.area - a.area);
}

/** The obstacle pieces on the road. */
export function obstaclePieces(p: Planes): Piece[] {
  return piecesOf(p.grid, (c) => p.obstacle[c], (c) => p.names[p.obstacleMesh[c]], (k) => OBSTACLE_KINDS[k - 1],
    { depth: (c) => (p.depth[c] / 10 - 0.5) * p.grid.cell, low: (c) => p.obstacleLow[c], on: (c) => ROAD_KINDS[p.roadKind[c] - 1] ?? "?" });
}

/** What's at a point along a line: the state of the surface the line should have. */
export type LineState = "ok" | "missing" | "buried" | "road" | "outside";

/** Points every `step` metres along a polyline (local), with the polyline's index. */
export function along(pts: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
    const len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(len / step));
    for (let s = k === 1 ? 0 : 1; s <= n; s++) out.push([ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n]);
  }
  return out;
}

/** The cells within `r` metres of a point. */
function near(grid: PlanGrid, [x, y]: Vec2, r: number, f: (c: number) => boolean): boolean {
  const C = grid.cell, k = Math.ceil(r / C);
  const i0 = Math.floor((x - grid.x0) / C), j0 = Math.floor((y - grid.y0) / C);
  for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) {
    const i = i0 + di, j = j0 + dj;
    if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) continue;
    const cx = grid.x0 + (i + 0.5) * C - x, cy = grid.y0 + (j + 0.5) * C - y;
    if (cx * cx + cy * cy > (r + C * 0.71) ** 2) continue;
    if (f(j * grid.nx + i)) return true;
  }
  return false;
}

/**
 * A street point: "ok" with a drivable surface within `r` showing, "buried" when there is one but
 * the ground is over it everywhere near, "missing" with none, "outside" off the grid.
 */
export function streetState(p: Planes, pt: Vec2, r: number, across?: Vec2): LineState {
  const c0 = p.grid.at(pt[0], pt[1]);
  if (c0 < 0) return "outside";
  const shows = (c: number) => !Number.isNaN(p.road[c]) && !(p.ground[c] > p.road[c] + BURIED);
  if (near(p.grid, pt, r, shows)) return "ok";
  // A median: built road both ways across the street, within MEDIAN.
  if (across && medianAt(p, pt, across, shows)) return "ok";
  if (near(p.grid, pt, r, (c) => !Number.isNaN(p.road[c]))) return "buried";
  // Past the built ground altogether (the world's edge): not a hole in a street.
  if (!near(p.grid, pt, r, (c) => !Number.isNaN(p.ground[c]) || !Number.isNaN(p.kerb[c]) || !Number.isNaN(p.path[c]))) return "outside";
  return "missing";
}

/** The widest median between a divided street's carriageways, metres each way from a point in it. */
export const MEDIAN = 12;

/** Whether `f` holds somewhere both ways along `dir` (and 22 degrees either side) from a point, within MEDIAN. */
function medianAt(p: Planes, [x, y]: Vec2, dir: Vec2, f: (c: number) => boolean): boolean {
  const hit = (dx: number, dy: number) => {
    for (let d = p.grid.cell; d <= MEDIAN; d += p.grid.cell / 2) {
      const c = p.grid.at(x + dx * d, y + dy * d);
      if (c >= 0 && f(c)) return true;
    }
    return false;
  };
  for (const a of [0, 0.39, -0.39]) {
    const dx = dir[0] * Math.cos(a) - dir[1] * Math.sin(a), dy = dir[0] * Math.sin(a) + dir[1] * Math.cos(a);
    if (hit(dx, dy) && hit(-dx, -dy)) return true;
  }
  return false;
}

/**
 * A path point: "ok" with a path ribbon within `r` showing over the ground, "road" where a road,
 * street or kerb covers it (paths are cut there on purpose), "buried" with a ribbon under the
 * ground, "missing" with none, "outside" where there's no built ground (past the corridor).
 * `moved` (a shared path's points): a shared path's ribbon showing within this also counts, as the
 * build moves a shared path up to PATH_SHIFT sideways off a kerb or a step (paths.ts shiftPath).
 */
export function pathState(p: Planes, pt: Vec2, r: number, moved = 0): LineState {
  const c0 = p.grid.at(pt[0], pt[1]);
  if (c0 < 0) return "outside";
  const shows = (c: number) => !Number.isNaN(p.path[c]) && !(p.ground[c] > p.path[c] + BURIED) && !(p.road[c] > p.path[c]) && !(p.kerb[c] > p.path[c]);
  if (near(p.grid, pt, r, shows)) return "ok";
  if (moved > r && near(p.grid, pt, moved, (c) => p.pathShared[c] === 1 && shows(c))) return "ok";
  if (!Number.isNaN(p.road[c0]) || !Number.isNaN(p.kerb[c0])) return "road";
  if (near(p.grid, pt, r, (c) => !Number.isNaN(p.path[c]))) return "buried";
  if (Number.isNaN(p.ground[c0])) return "outside";
  return "missing";
}

/** A run of points along a line in the same bad state. */
export interface Run {
  kind: string;
  length: number;
  /** Middle point, local. */
  at: Vec2;
  /** Free text about the line (its class, its name). */
  what?: string;
}

/** Runs of consecutive points (spaced `step`) whose state is in `bad`, `minLength` metres or longer. */
export function runsOf(pts: Vec2[], states: LineState[], step: number, bad: LineState[], minLength: number, what?: string): Run[] {
  const out: Run[] = [];
  for (let i = 0; i < pts.length;) {
    if (!bad.includes(states[i])) { i++; continue; }
    const kind = states[i];
    let j = i;
    while (j + 1 < pts.length && states[j + 1] === kind) j++;
    const length = (j - i + 1) * step;
    if (length >= minLength) out.push({ kind, length, at: pts[Math.floor((i + j) / 2)], ...(what ? { what } : {}) });
    i = j + 1;
  }
  return out;
}

/**
 * The street map's core pixels (exactly a street's or the route's fill, all four neighbours too), as
 * local points, each with the drawn street's half width there (metres to the nearest pixel that
 * isn't full fill, up to 12 m).
 */
export function streetMapCore(png: { rgba: Uint8Array; width: number; height: number }, ini: string): { at: Vec2; half: number; across: Vec2 }[] {
  const num = (k: string) => Number(ini.match(new RegExp(`^${k}=([-\\d.]+)`, "m"))?.[1]);
  const scale = num("SCALE_FACTOR"), xOff = num("X_OFFSET"), zOff = num("Z_OFFSET");
  if (!(scale > 0)) throw new Error("street_map.ini: no SCALE_FACTOR");
  const { rgba, width: w, height: h } = png;
  const fill = (i: number) => {
    const o = i * 4, r = rgba[o], g = rgba[o + 1], b = rgba[o + 2], a = rgba[o + 3];
    return a === 255 && ((r === 205 && g === 208 && b === 214) || (r === 245 && g === 196 && b === 66));
  };
  // Pixels to the nearest non-fill pixel (3-4 chamfer, x10), for the half widths.
  const D = new Uint16Array(w * h);
  for (let i = 0; i < w * h; i++) D[i] = fill(i) ? 65535 : 0;
  const relax = (i: number, j: number, c: number) => { if (D[j] + c < D[i]) D[i] = D[j] + c; };
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (D[i]) { relax(i, i - 1, 10); relax(i, i - w, 10); relax(i, i - w - 1, 14); relax(i, i - w + 1, 14); }
  }
  for (let y = h - 2; y > 0; y--) for (let x = w - 2; x > 0; x--) {
    const i = y * w + x;
    if (D[i]) { relax(i, i + 1, 10); relax(i, i + w, 10); relax(i, i + w + 1, 14); relax(i, i + w - 1, 14); }
  }
  const out: { at: Vec2; half: number; across: Vec2 }[] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (D[i] >= 20) {
      // px = (x + xOff) / scale, AC z south = -local y.
      // Across the street: of eight axes, the one the fill is narrowest along (both ways).
      const max = D[i] / 5 + 4;
      let best = Infinity, across: Vec2 = [1, 0];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI, dx = Math.cos(a), dy = Math.sin(a);
        const reach = (sg: number) => {
          for (let t = 0.25; t <= max; t += 0.25) {
            const X = Math.floor(x + 0.5 + sg * dx * t), Y = Math.floor(y + 0.5 + sg * dy * t);
            if (X < 0 || Y < 0 || X >= w || Y >= h || !D[Y * w + X]) return t;
          }
          return max;
        };
        const v = reach(1) + reach(-1);
        if (v < best) { best = v; across = [dx, -dy]; } // image y is south: local y = -image y
      }
      out.push({ at: [(x + 0.5) * scale - xOff, -((y + 0.5) * scale - zOff)], half: Math.min(12, (D[i] / 10) * scale), across });
    }
  }
  return out;
}

/** Drivable OpenMapTiles classes (the side streets' and the route's). */
export const STREET_CLASSES = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "track", "busway", "raceway"]);

/** A gap along the planned streets: `between` when there's built street on two or more sides of it. */
export interface StreetGap extends Piece {
  /** Metres, roughly: cells times the cell size. */
  length: number;
  /** Street on two or more sides (a hole in a street), not just one (a street's end stopping short). */
  between: boolean;
}

/**
 * Pieces of the planned street cells labelled missing (1) or buried (2), on a coarse grid. A piece
 * is `between` when the planned, built cells around it fall into two or more separate groups: road
 * either side of a hole. A piece with built street on one side only is where a street stops short
 * of its line's end (or the street map's round cap past the end), reported apart.
 */
export function streetGapPieces(grid: PlanGrid, label: Uint8Array, planned: Uint8Array): StreetGap[] {
  const n = grid.nx * grid.ny, seen = new Uint8Array(n), out: StreetGap[] = [];
  const nb = (c: number, f: (d: number) => void) => {
    const i = c % grid.nx, j = (c - i) / grid.nx;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < grid.nx && jj < grid.ny) f(jj * grid.nx + ii);
    }
  };
  for (let s = 0; s < n; s++) {
    if (!label[s] || seen[s]) continue;
    const k = label[s];
    const cells: number[] = [s];
    seen[s] = 1;
    for (let q = 0; q < cells.length; q++) nb(cells[q], (d) => { if (!seen[d] && label[d] === k) { seen[d] = 1; cells.push(d); } });
    const inPiece = new Set(cells);
    const rim = new Set<number>();
    for (const c of cells) nb(c, (d) => { if (!inPiece.has(d) && planned[d] && !label[d]) rim.add(d); });
    let groups = 0;
    const done = new Set<number>();
    for (const r of rim) {
      if (done.has(r)) continue;
      groups++;
      const st = [r];
      done.add(r);
      while (st.length) nb(st.pop()!, (d) => { if (rim.has(d) && !done.has(d)) { done.add(d); st.push(d); } });
    }
    let sx = 0, sy = 0;
    for (const c of cells) { const [x, y] = grid.centre(c); sx += x; sy += y; }
    out.push({
      kind: k === 1 ? "missing" : "buried", cells: cells.length, area: cells.length * grid.cell * grid.cell,
      at: [sx / cells.length, sy / cells.length], length: cells.length * grid.cell, between: groups >= 2,
    });
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Distance from a point to the nearest drivable or kerb cell's centre, up to `max` metres (Infinity past it). */
export function roadDistance(p: Planes, [x, y]: Vec2, max: number): number {
  const g = p.grid, C = g.cell, k = Math.ceil(max / C);
  const i0 = Math.floor((x - g.x0) / C), j0 = Math.floor((y - g.y0) / C);
  let best = Infinity;
  for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) {
    const i = i0 + di, j = j0 + dj;
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
    const c = j * g.nx + i;
    if (Number.isNaN(p.road[c]) && Number.isNaN(p.kerb[c])) continue;
    const d = Math.hypot(g.x0 + (i + 0.5) * C - x, g.y0 + (j + 0.5) * C - y);
    if (d < best) best = d;
  }
  return best <= max ? best : Infinity;
}
