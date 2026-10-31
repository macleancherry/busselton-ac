// Busselton fork: buildings from footprints (docs/specs/buildings.md). OSM footprints and roofs
// found in the aerial photo become building records; the records are filtered against the road and
// each other, then built as meshes: walls in facade bands, glass, pitched or flat roofs with eaves,
// and the street front (doors, driveway, verandah, shop awning). What a building wears is chosen in
// buildingStyles.ts; this module only reads the dress.

import triangulate from "earcut";
import { type HeightFn } from "./elevation";
import { type Vec2 } from "./geo";
import { type Kn5MeshNode } from "./kn5";
import { type MeshBuilder, type Vec3 } from "./mesh";
import { box, ChunkedMesh } from "./meshKit";
import { frontEdgeIndex, frontSpans } from "./frontDoor";
import { type BuildOptions } from "./options";
import { placeSeed, rng } from "./random";
import { type SegmentIndex } from "./road";
import { type TerrainChunk } from "./terrain";
import { ccwRing, centroid, isRectangle, pointInRing, ringArea } from "./ringGeometry";
import { SINK } from "./sceneGround";
import { slopeSteps } from "./slopeSteps";
import { FACADES, FACADE_INDEX, LAYOUTS, PITCHED, ROOF_COLOURS, type Dress, type Facade, type Layout, type LayoutName, type RGB, type RoofShape } from "./buildingStyles";

export { centroid, isRectangle, pointInRing, ringArea };

export type BuildingSource = "osm" | "detected" | "frontage";
export type FrontKind = "none" | "limestone" | "brick" | "hedge";

/** A footprint (local metres, first point not repeated) and what it wears. */
export type Building = Dress & {
  ring: Vec2[]; // the footprint
  source: BuildingSource;
  tags?: Record<string, string>; // OSM tags, when mapped
  front?: [Vec2, Vec2]; // the two corners of the wall facing the street
  setback?: number; // road edge to the front wall, metres
  /** What runs along the front boundary (house looks; lots.ts). */
  frontKind?: FrontKind;
  hedgeHeight?: number;
};

// Salts for the position-seeded draws (random.ts placeSeed).
const SALT_OSM = 0xb1d0;
const SALT_DETECT = 0xb1d1;

// ---------------------------------------------------------------------------------------------
// Placeholders

/** A house with the given roof, before dressBuilding runs. */
export function plainHouse(roof: RoofShape, roofColour: number, height: number): Dress {
  return { type: "house", facade: FACADE_INDEX.get("brick_red") ?? 0, roof, roofColour, pitch: 22, height };
}

/** Hip about two thirds of the time, gable otherwise. */
export function houseRoof(rand: () => number): RoofShape {
  return rand() >= 0.68 ? "gable" : "hip";
}

// ---------------------------------------------------------------------------------------------
// OSM footprints

const LOW_KINDS = /^(garage|garages|shed|carport|hut|cabin|roof)$/;
const HOUSE_KINDS = /^(house|detached|residential|semidetached_house|bungalow|farm)$/;

/** Wall height from OSM tags (metres). */
export function heightFromTags(tags: Record<string, string>): number {
  for (const key of ["height", "render_height"]) {
    const h = parseFloat(tags[key] ?? "");
    if (Number.isFinite(h) && h > 2) return Math.min(80, h);
  }
  const levels = Number(tags["building:levels"] ?? NaN);
  if (Number.isFinite(levels) && levels > 0) return Math.min(80, levels * 3 + 1);
  const kind = tags.building ?? "";
  if (LOW_KINDS.test(kind)) return 3.5;
  if (HOUSE_KINDS.test(kind)) return 3;
  return 6;
}

const COLOUR_NAMES: Record<string, RGB> = {
  red: [170, 50, 40], darkred: [110, 30, 30], maroon: [110, 30, 30], brown: [120, 80, 55],
  orange: [200, 110, 50], yellow: [220, 200, 90], green: [70, 110, 70], darkgreen: [45, 70, 50],
  blue: [60, 80, 130], darkblue: [40, 50, 80], white: [235, 235, 230], black: [40, 40, 40],
  grey: [128, 128, 128], gray: [128, 128, 128], lightgrey: [190, 190, 188], lightgray: [190, 190, 188],
  darkgrey: [80, 80, 80], darkgray: [80, 80, 80], silver: [192, 192, 192], beige: [215, 200, 165], cream: [233, 220, 184],
};

/** An OSM colour (hex or a basic name) as 0..255 RGB; unknown names are mid grey. */
export function parseColour(value: string): RGB {
  const v = value.trim().toLowerCase();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return COLOUR_NAMES[v.replace(/[\s_-]/g, "")] ?? [128, 128, 128];
}

/** The nearest pitched roof finish to a photo colour (0..255), after lifting the photo's haze. */
export function nearestRoofColour(rgb: RGB | number[]): number {
  const lift = (c: number) => Math.min(255, c * 1.12 + 8);
  const r = lift(rgb[0]), g = lift(rgb[1]), b = lift(rgb[2]);
  let best = PITCHED[0], bestD = Infinity;
  for (const i of PITCHED) {
    const c = ROOF_COLOURS[i].rgb;
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (bestD > d) [bestD, best] = [d, i];
  }
  return best;
}

/**
 * A building from an OSM footprint. The third argument (the list index) is ignored: the draws are
 * seeded from where the building is, so new buildings elsewhere in the data change nothing here.
 */
export function fromOsm(ring: Vec2[], tags: Record<string, string> = {}, _index?: number): Building {
  const pts = ccwRing(ring);
  const [cx, cy] = centroid(pts);
  const rand = rng(placeSeed(cx, cy, SALT_OSM));
  const height = heightFromTags(tags);
  let roof: RoofShape = "flat";
  if (Math.abs(ringArea(pts)) < 400 && height <= 7 && isRectangle(pts)) {
    const shape = tags["roof:shape"];
    roof = shape === "gabled" ? "gable" : shape === "hipped" ? "hip" : houseRoof(rand);
  }
  const roofColour = tags["roof:colour"] ? nearestRoofColour(parseColour(tags["roof:colour"])) : PITCHED[Math.floor(rand() * PITCHED.length) % PITCHED.length];
  return { ...plainHouse(roof, roofColour, height), ring: pts, source: "osm", tags };
}

// ---------------------------------------------------------------------------------------------
// Roofs in the aerial photo

/** Local bounds of a photo chunk. */
export type ChunkBounds = Pick<TerrainChunk, "minX" | "minY" | "maxX" | "maxY">;

/** Is a mean cell colour roof-like: pale metal or concrete, or terracotta? */
export function roofLike(r: number, g: number, b: number): boolean {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
  const light = (mx + mn) / 2;
  const sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * light - 1));
  const sum = r + g + b || 1;
  const exg = (2 * g - r - b) / sum;
  if (sat < 0.16 && light > 0.5 && exg < 0.03) return true;
  return r > 1.3 * g && r > 1.5 * b && sat > 0.35 && light >= 0.25 && light <= 0.65;
}

/**
 * Houses from roofs in a chunk's aerial photo (`size` px square, north up: pixel row 0 is the
 * chunk's maxY edge). Each roof-like patch of 40 to 700 m^2 that fills most of its oriented box
 * becomes a placeholder house the shape of that box.
 */
export function detectBuildings(rgba: ArrayLike<number>, size: number, chunk: ChunkBounds): Building[] {
  const mpp = (chunk.maxX - chunk.minX) / size;
  if (!(mpp > 0)) return [];
  const cpx = Math.max(1, Math.round(0.8 / mpp));
  const cell = cpx * mpp;
  const n = Math.floor(size / cpx);
  if (n < 2) return [];
  const mask = new Uint8Array(n * n);
  const mean = new Float32Array(n * n * 3);
  const cnt = cpx * cpx;
  for (let k = 0; k < n * n; k++) {
    const col0 = (k % n) * cpx, row0 = Math.floor(k / n) * cpx;
    const sum = [0, 0, 0];
    for (let dy = 0; dy < cpx; dy++) {
      for (let dx = 0; dx < cpx; dx++) {
        const o = ((row0 + dy) * size + col0 + dx) * 4;
        for (let ch = 0; ch < 3; ch++) sum[ch] += rgba[o + ch];
      }
    }
    for (let ch = 0; ch < 3; ch++) mean[k * 3 + ch] = sum[ch] / cnt;
    mask[k] = roofLike(sum[0] / cnt, sum[1] / cnt, sum[2] / cnt) ? 1 : 0;
  }
  const at = (m: Uint8Array, x: number, y: number) => (x >= 0 && y >= 0 && x < n && y < n ? m[y * n + x] : 0);
  // Opening: erode with the 4-neighbour cross, then grow back within the original mask.
  const eroded = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      eroded[y * n + x] = at(mask, x, y) && at(mask, x - 1, y) && at(mask, x + 1, y) && at(mask, x, y - 1) && at(mask, x, y + 1) ? 1 : 0;
    }
  }
  const open = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!mask[y * n + x]) continue;
      open[y * n + x] = at(eroded, x, y) || at(eroded, x - 1, y) || at(eroded, x + 1, y) || at(eroded, x, y - 1) || at(eroded, x, y + 1) ? 1 : 0;
    }
  }
  // Connected patches.
  const label = new Int32Array(n * n).fill(-1); // patch id per cell, -1 unvisited
  const found: Building[] = [];
  const cellArea = cell * cell;
  let patches = 0;
  for (let first = 0; first < n * n; first++) {
    if (!open[first] || label[first] >= 0) continue;
    const id = patches++;
    const patch: number[] = [first];
    label[first] = id;
    // Breadth first: the patch list doubles as the queue.
    for (let q = 0; q < patch.length; q++) {
      const k = patch[q], x = k % n, y = Math.floor(k / n);
      const next = [x > 0 ? k - 1 : -1, x < n - 1 ? k + 1 : -1, y > 0 ? k - n : -1, y < n - 1 ? k + n : -1];
      for (const j of next) {
        if (j >= 0 && open[j] && label[j] < 0) {
          label[j] = id;
          patch.push(j);
        }
      }
    }
    const area = patch.length * cellArea;
    if (!(area >= 40 && area <= 700)) continue;
    const house = patchBuilding(patch, n, cell, chunk, mean, area);
    if (house) found.push(house);
  }
  return found;
}

/** The middle of some points and the direction of their long axis (radians). */
function principalAxis(pts: Vec2[]): { mid: Vec2; angle: number } {
  const count = pts.length || 1;
  const mid: Vec2 = [pts.reduce((a, p) => a + p[0], 0) / count, pts.reduce((a, p) => a + p[1], 0) / count];
  let cxx = 0, cyy = 0, cxy = 0;
  for (const p of pts) {
    const dx = p[0] - mid[0], dy = p[1] - mid[1];
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  return { mid, angle: Math.atan2(2 * cxy, cxx - cyy) / 2 };
}

function patchBuilding(cells: number[], n: number, cell: number, chunk: ChunkBounds, mean: Float32Array, area: number): Building | null {
  const pts = cells.map((k): Vec2 => [chunk.minX + ((k % n) + 0.5) * cell, chunk.maxY - (((k / n) | 0) + 0.5) * cell]);
  const { mid, angle } = principalAxis(pts);
  const [mx, my] = mid;
  const ux = Math.cos(angle), uy = Math.sin(angle); // the long axis
  const along = pts.map(([x, y]) => (x - mx) * ux + (y - my) * uy);
  const across = pts.map(([x, y]) => (y - my) * ux - (x - mx) * uy);
  const a0 = Math.min(...along), a1 = Math.max(...along), b0 = Math.min(...across), b1 = Math.max(...across);
  const len = a1 - a0 + cell, wid = b1 - b0 + cell;
  const long = Math.max(len, wid), short = Math.min(len, wid);
  if (short < 4 || long > 4 * short || area / (len * wid) < 0.55) return null;
  const ac = (a0 + a1) / 2, bc = (b0 + b1) / 2;
  const ox = mx + ac * ux - bc * uy, oy = my + ac * uy + bc * ux;
  const corner = (sa: number, sb: number): Vec2 => [ox + sa * (len / 2) * ux - sb * (wid / 2) * uy, oy + sa * (len / 2) * uy + sb * (wid / 2) * ux];
  const ring = ccwRing([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]);
  const avg = [0, 1, 2].map((ch) => cells.reduce((acc, k) => acc + mean[k * 3 + ch], 0) / cells.length);
  const rand = rng(placeSeed(ox, oy, SALT_DETECT));
  const finish = nearestRoofColour(avg);
  return { ...plainHouse(houseRoof(rand), finish, area > 250 ? 3.6 : 2.8), ring, source: "detected" };
}

// ---------------------------------------------------------------------------------------------
// Filtering

/**
 * Buildings worth keeping: real rings, photo roofs not inside mapped buildings, clear of the road
 * and its verge, and near enough the route. Keeps the input order.
 */
export function filterBuildings(buildings: Building[], index: SegmentIndex, opts: Pick<BuildOptions, "vergeWidth">, maxDist: number): Building[] {
  const mapped = buildings
    .filter((b) => b.source === "osm" && b.ring.length >= 3)
    .map((b) => {
      const xs = b.ring.map((p) => p[0]), ys = b.ring.map((p) => p[1]);
      return { ring: b.ring, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
  const inMapped = (x: number, y: number) => mapped.some((m) => x >= m.x0 && x <= m.x1 && y >= m.y0 && y <= m.y1 && pointInRing(x, y, m.ring));
  const reach = Math.max(maxDist, 60);
  return buildings.filter(({ ring, source }) => {
    if (ring.length < 3 || Math.abs(ringArea(ring)) < 6) return false;
    if (source !== "osm" && [centroid(ring), ...ring].some(([x, y]) => inMapped(x, y))) return false;
    let near = false;
    for (const [x, y] of ring) {
      const hit = index.nearest(x, y, reach);
      if (!hit) continue;
      if (hit.dist < index.at(hit).width / 2 + opts.vergeWidth + 2) return false;
      if (hit.dist <= maxDist) near = true;
    }
    return near;
  });
}

/** The facades (main and ground floor) and roof finishes the buildings wear. */
export function usedFinishes(list: Building[]): { facades: Set<number>; roofs: Set<number> } {
  const used = { facades: new Set<number>(), roofs: new Set<number>() };
  for (const bld of list) {
    used.facades.add(bld.facade);
    if (bld.groundFacade !== undefined) used.facades.add(bld.groundFacade);
    used.roofs.add(bld.roofColour);
  }
  return used;
}

// ---------------------------------------------------------------------------------------------
// Meshes

/** AC reads a surface key anywhere in a mesh name: keep them out of the facade part. */
export function safeName(name: string): string {
  return name
    .replace(/sand/gi, "snd")
    .replace(/grass/gi, "grs")
    .replace(/gravel/gi, "grvl")
    .replace(/kerb/gi, "krb")
    .replace(/road/gi, "rd")
    .replace(/dirt/gi, "drt");
}

type V3 = [number, number, number];

/** Mesh accumulators by mesh-name stem, each with its material and shadow flag. */
class Sink {
  private readonly groups = new Map<string, { mesh: ChunkedMesh; material: string; shadows: boolean }>();

  get(stem: string, material: string, shadows: boolean, verts: number): MeshBuilder {
    let g = this.groups.get(stem);
    if (!g) this.groups.set(stem, (g = { mesh: new ChunkedMesh(), material, shadows }));
    return g.mesh.next(verts);
  }

  nodes(): Kn5MeshNode[] {
    const nodes: Kn5MeshNode[] = []; // in stem order
    for (const [stem, g] of this.groups) {
      g.mesh.all().forEach((mb, i) => {
        nodes.push(mb.toKn5(`${stem}_${String(i).padStart(3, "0")}`, g.material, g.shadows ? {} : { castShadows: false }));
      });
    }
    return nodes;
  }
}

function normalOf(p: V3[]): V3 {
  // Newell's method: works for any planar polygon.
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const size = Math.hypot(nx, ny, nz) || 1;
  return [nx / size, ny / size, nz / size];
}

/**
 * A flat convex polygon (fan) with one normal. `face` says which way it must face: "up" or "down"
 * flips the winding to suit; "as-is" keeps it (counter-clockwise from the front).
 */
function polygon(mb: MeshBuilder, pts: V3[], uv: (p: V3, k: number) => [number, number], face: "up" | "down" | "as-is" = "as-is"): void {
  let p = pts;
  let n = normalOf(p);
  if ((face === "up" && n[2] < 0) || (face === "down" && n[2] > 0)) {
    p = p.slice().reverse();
    n = [-n[0], -n[1], -n[2]];
  }
  const order = p === pts ? pts.map((_, k) => k) : pts.map((_, k) => pts.length - 1 - k);
  const first = mb.vertexCount;
  p.forEach((q, k) => {
    const [u, v] = uv(q, order[k]);
    mb.vertex(q as Vec3, u, v);
    mb.normals!.push(n[0], n[1], n[2]);
  });
  for (let k = 1; k + 1 < p.length; k++) mb.tri(first, first + k, first + k + 1);
}

const add = (a: Vec2, b: Vec2, s = 1): Vec2 => [a[0] + b[0] * s, a[1] + b[1] * s];
const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const at3 = (p: Vec2, z: number): V3 => [p[0], p[1], z];

interface Wall {
  a: Vec2;
  b: Vec2;
  len: number;
  /** Unit along a -> b, and outward (right of a -> b on a counter-clockwise ring). */
  dir: Vec2;
  out: Vec2;
  /** Perimeter distance at a. */
  p0: number;
}

function wallsOf(ring: Vec2[]): Wall[] {
  let p0 = 0;
  return ring.map((a, k) => {
    const b = ring[(k + 1) % ring.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    const dir: Vec2 = len > 0 ? [dx / len, dy / len] : [1, 0];
    const wall: Wall = { a, b, len, dir, out: [dir[1], -dir[0]], p0 };
    p0 += len;
    return wall;
  });
}

/** A door or garage span on the front wall: metres along it, and its top. */
interface Span {
  s0: number;
  s1: number;
  top: number;
}

/** Everything one building's meshes need to know. */
interface Ctx {
  b: Building;
  g: HeightFn;
  sink: number;
  ring: Vec2[]; // counter-clockwise
  walls: Wall[];
  floor: number; // the lowest corner
  base: number;
  top: number;
  out: Sink;
}

const layoutOf = (fc: Facade): Layout => LAYOUTS[fc.layout as LayoutName] ?? LAYOUTS.blank;
const facadeAt = (i: number | undefined): Facade | undefined => (i === undefined ? undefined : FACADES[i]);

/**
 * Meshes for dressed buildings. One ground per building: `groundFor(b)` (default `ground`) gives
 * every height of that building, and `sinkFor(b)` (default SINK) how far its walls go under the
 * lowest ground along them.
 */
export function buildBuildings(list: Building[], ground: HeightFn, sinkFor?: (b: Building) => number, groundFor?: (b: Building) => HeightFn): Kn5MeshNode[] {
  const out = new Sink();
  for (const b of list) {
    const ring = ccwRing(b.ring);
    if (ring.length < 3 || Math.abs(ringArea(ring)) < 1e-6) continue;
    const g = groundFor?.(b) ?? ground;
    const sink = sinkFor?.(b) ?? SINK;
    const walls = wallsOf(ring);
    const cornerZ = ring.map(([x, y]) => g(x, y));
    // The walls' base: the lowest ground along them, every half metre (the ground check's own step).
    // Not the middle: a hollow inside the footprint (rain hollows) sank every wall under the ground round it.
    let lowest = Math.min(...cornerZ);
    for (const w of walls) {
      const steps = Math.max(2, Math.ceil(w.len / 0.5));
      for (let s = 1; s < steps; s++) {
        const p = lerp2(w.a, w.b, s / steps);
        lowest = Math.min(lowest, g(p[0], p[1]));
      }
    }
    const floor = Math.min(...cornerZ);
    const top = Math.max(...cornerZ) + Math.max(0.5, b.height);
    const ctx: Ctx = { b, g, sink, ring, walls, floor, base: lowest - sink, top, out };
    const front = frontWall(ctx);
    const spans = front ? doors(ctx, front) : [];
    wallBands(ctx, front, spans);
    roof(ctx);
    if (front) {
      verandah(ctx, front);
      awning(ctx, front);
    }
  }
  return out.nodes();
}

/** The ring edge that is the building's front wall, if it has one (frontDoor.ts, shared with lots.ts). */
function frontWall(ctx: Ctx): Wall | null {
  const k = frontEdgeIndex(ctx.ring, ctx.b.front);
  return k < 0 ? null : ctx.walls[k];
}

/** A point on a wall: `s` along it, `t` out from it. */
const onWall = (w: Wall, s: number, t = 0): Vec2 => add(add(w.a, w.dir, s), w.out, t);

/** An upright quad on a wall plane, `proud` out from it, UVs 0..1 (v 1 at the bottom). */
function uprightPanel(mb: MeshBuilder, w: Wall, s0: number, s1: number, z0: number, z1: number, proud: number): void {
  const a = onWall(w, s0, proud), b = onWall(w, s1, proud);
  const pts: V3[] = [at3(a, z0), at3(b, z0), at3(b, z1), at3(a, z1)];
  const uvs: [number, number][] = [[0, 1], [1, 1], [1, 0], [0, 0]];
  const first = mb.vertexCount;
  pts.forEach((p, k) => {
    mb.vertex(p as Vec3, uvs[k][0], uvs[k][1]);
    mb.normals!.push(w.out[0], w.out[1], 0);
  });
  mb.quad(first, first + 1, first + 2, first + 3);
}

/** Garage, roller and front doors on the front wall; returns their spans (windows keep clear). */
function doors(ctx: Ctx, w: Wall): Span[] {
  const { b, g, out } = ctx;
  if (w.len < 5) return [];
  const spans: Span[] = [];
  const bottom = (s0: number, s1: number) => {
    const p = onWall(w, s0), q = onWall(w, s1);
    return Math.min(g(p[0], p[1]), g(q[0], q[1]));
  };
  const put = (stem: "GARAGE" | "DOOR", s0: number, s1: number, h: number) => {
    const z0 = bottom(s0, s1);
    const z1 = Math.min(z0 + h, ctx.top - 0.1);
    if (z1 - z0 < 1) return;
    uprightPanel(out.get(stem, stem === "GARAGE" ? "garage" : "door", false, 4), w, s0, s1, z0, z1, 0.02);
    spans.push({ s0, s1, top: z1 });
  };
  if (b.type === "warehouse") {
    if (w.len >= 8) {
      const mid = w.len / 3;
      put("GARAGE", mid - 2.25, mid + 2.25, 4.2);
    }
    return spans;
  }
  if (b.type !== "house" && b.type !== "townhouse") return spans;
  const at = frontSpans(w.len, b.garage);
  if (at.garage) {
    put("GARAGE", at.garage[0], at.garage[1], 2.1);
    if (at.door) put("DOOR", at.door[0], at.door[1], 2.05);
    if (spans[0]?.s0 === at.garage[0]) driveway(ctx, w);
  } else if (at.door) {
    put("DOOR", at.door[0], at.door[1], 2.05);
  }
  return spans;
}

/** From the garage door out to where the nature strip starts. */
function driveway(ctx: Ctx, w: Wall): void {
  const reach = (ctx.b.setback ?? 6) - 3.5;
  if (reach <= 1) return;
  const pts: Vec2[] = [onWall(w, 0.4, 0), onWall(w, 3.4, 0), onWall(w, 3.4, reach), onWall(w, 0.4, reach)];
  const mb = ctx.out.get("DRIVEWAY", "concrete", false, 4);
  polygon(mb, pts.map((p) => at3(p, ctx.g(p[0], p[1]) + 0.03)), (p) => [p[0] / 2, p[1] / 2], "up");
}

/** The walls, one quad per edge per band, and the glass over their windows. */
function wallBands(ctx: Ctx, front: Wall | null, spans: Span[]): void {
  const { b, walls, floor, base, top } = ctx;
  const main = facadeAt(b.facade) ?? FACADES[0];
  const lower = facadeAt(b.groundFacade);
  const bands: { fc: Facade; z0: number; z1: number; floor: number }[] = [];
  if (lower) {
    const split = Math.min(top - 0.5, floor + layoutOf(lower).storey);
    bands.push({ fc: lower, z0: base, z1: split, floor });
    bands.push({ fc: main, z0: split, z1: top, floor: split });
  } else {
    bands.push({ fc: main, z0: base, z1: top, floor });
  }
  bands.forEach((band) => {
    const lay = layoutOf(band.fc);
    const mb = ctx.out.get(`1WALL_BLD_${safeName(band.fc.name)}`, `facade_${band.fc.name}`, true, walls.length * 4);
    const v = (z: number) => 1 - (z - band.floor) / lay.storey;
    for (const w of walls) {
      if (w.len < 1e-6) continue;
      const u0 = w.p0 / lay.period, u1 = (w.p0 + w.len) / lay.period;
      const pts: V3[] = [at3(w.a, band.z0), at3(w.b, band.z0), at3(w.b, band.z1), at3(w.a, band.z1)];
      const uvs: [number, number][] = [[u0, v(band.z0)], [u1, v(band.z0)], [u1, v(band.z1)], [u0, v(band.z1)]];
      const first = mb.vertexCount;
      pts.forEach((p, k) => {
        mb.vertex(p as Vec3, uvs[k][0], uvs[k][1]);
        mb.normals!.push(w.out[0], w.out[1], 0);
      });
      mb.quad(first, first + 1, first + 2, first + 3);
    }
    if (lay.panes) panes(ctx, band, lay, front, spans);
  });
}

/** Glass over each window opening of a band, kept clear of doors, wall ends and the ground. */
function panes(ctx: Ctx, band: { z1: number; floor: number }, lay: Layout, front: Wall | null, spans: Span[]): void {
  const { g, walls, out } = ctx;
  for (const w of walls) {
    if (w.len < 1) continue;
    const kFirst = Math.floor(w.p0 / lay.period) - 1;
    const kLast = Math.ceil((w.p0 + w.len) / lay.period);
    for (let k = kFirst; k <= kLast; k++) {
      for (const o of lay.openings) {
        if (o.kind === "door") continue;
        const s0 = k * lay.period + o.x0 - w.p0, s1 = k * lay.period + o.x1 - w.p0;
        if (s0 < 0.15 || s1 > w.len - 0.15) continue;
        if (w === front && spans.some((sp) => s1 > sp.s0 - 0.1 && s0 < sp.s1 + 0.1)) continue;
        // The ground just outside, at both ends of the pane: the sill stays 8 cm over the higher.
        const pa = onWall(w, s0, 0.3), pb = onWall(w, s1, 0.3);
        const outside = Math.max(g(pa[0], pa[1]), g(pb[0], pb[1])) + 0.08;
        for (let storey = 0; ; storey++) {
          const sf = band.floor + storey * lay.storey;
          if (sf + o.z0 >= band.z1) break;
          let z0 = sf + o.z0;
          const z1 = sf + o.z1;
          if (z1 > band.z1 + 1e-6) break;
          z0 = Math.max(z0, outside);
          if (z1 - z0 < 0.3) continue;
          uprightPanel(out.get("WINDOWS", "window", false, 4), w, s0, s1, z0, z1, 0.015);
        }
      }
    }
  }
}

/** A wall triangle or piece above the wall top, textured with the facade's plain band squeezed in. */
function plainWall(ctx: Ctx, w: Wall, pts: V3[]): void {
  const fc = facadeAt(ctx.b.facade) ?? FACADES[0];
  const lay = layoutOf(fc);
  const zs = pts.map((p) => p[2]);
  const lo = Math.min(...zs), hi = Math.max(...zs);
  const [p0, p1] = lay.plain;
  const vOf = (z: number) => 1 - (p0 + ((z - lo) / Math.max(1e-6, hi - lo)) * (p1 - p0)) / lay.storey;
  const mb = ctx.out.get(`1WALL_BLD_${safeName(fc.name)}`, `facade_${fc.name}`, true, pts.length);
  const first = mb.vertexCount;
  pts.forEach((p) => {
    const s = (p[0] - w.a[0]) * w.dir[0] + (p[1] - w.a[1]) * w.dir[1];
    mb.vertex(p as Vec3, (w.p0 + s) / lay.period, vOf(p[2]));
    mb.normals!.push(w.out[0], w.out[1], 0);
  });
  for (let k = 1; k + 1 < pts.length; k++) mb.tri(first, first + k, first + k + 1);
}

function roofStem(ctx: Ctx): { stem: string; material: string } {
  const finish = ROOF_COLOURS[ctx.b.roofColour] ?? ROOF_COLOURS[0];
  return { stem: `ROOF_${finish.name}`, material: `roof_${finish.name}` };
}

/** Roof UVs: metres / 2, v running down the slope. */
function slopeUv(pts: V3[]): (p: V3) => [number, number] {
  const n = normalOf(pts);
  const h = Math.hypot(n[0], n[1]);
  if (h < 1e-6) return (p) => [p[0] / 2, p[1] / 2];
  const dx = n[0] / h, dy = n[1] / h; // downhill, horizontal
  const stretch = 1 / Math.max(0.2, Math.abs(n[2]));
  return (p) => [(-p[0] * dy + p[1] * dx) / 2, ((p[0] * dx + p[1] * dy) * stretch) / 2];
}

function roofFace(ctx: Ctx, pts: V3[]): void {
  const { stem, material } = roofStem(ctx);
  polygon(ctx.out.get(stem, material, true, pts.length), pts, slopeUv(pts), "up");
}

function soffit(ctx: Ctx, pts: V3[]): void {
  polygon(ctx.out.get("SOFFIT", "canopy", false, pts.length), pts, (p) => [p[0] / 2, p[1] / 2], "down");
}

function roof(ctx: Ctx): void {
  const { b, ring } = ctx;
  if (b.roof === "flat" || ring.length !== 4) flatRoof(ctx);
  else pitchedRoof(ctx);
}

function flatRoof(ctx: Ctx): void {
  const { b, ring, top, walls } = ctx;
  const tris = triangulate(ring.flat());
  const { stem, material } = roofStem(ctx);
  const mb = ctx.out.get(stem, material, true, ring.length);
  const first = mb.vertexCount;
  ring.forEach(([x, y]) => {
    mb.vertex([x, y, top], x / 2, y / 2);
    mb.normals?.push(0, 0, 1);
  });
  for (let i = 0; i < tris.length; i += 3) {
    const [a, c, d] = [tris[i], tris[i + 1], tris[i + 2]];
    const pa = ring[a], pc = ring[c], pd = ring[d];
    const up = (pc[0] - pa[0]) * (pd[1] - pa[1]) - (pc[1] - pa[1]) * (pd[0] - pa[0]) > 0;
    if (up) mb.tri(first + a, first + c, first + d);
    else mb.tri(first + a, first + d, first + c);
  }
  const parapet = b.parapet ?? 0;
  if (parapet > 0) {
    for (const w of walls) {
      if (w.len < 1e-6) continue;
      // Outside, then the same face turned inward.
      plainWall(ctx, w, [at3(w.a, top), at3(w.b, top), at3(w.b, top + parapet), at3(w.a, top + parapet)]);
      const inner: Wall = { ...w, out: [-w.out[0], -w.out[1]] };
      plainWall(ctx, inner, [at3(w.b, top), at3(w.a, top), at3(w.a, top + parapet), at3(w.b, top + parapet)]);
    }
  }
}

function pitchedRoof(ctx: Ctx): void {
  const { b, top } = ctx;
  // First edge a long side.
  const l0 = Math.hypot(ctx.ring[1][0] - ctx.ring[0][0], ctx.ring[1][1] - ctx.ring[0][1]);
  const l1 = Math.hypot(ctx.ring[2][0] - ctx.ring[1][0], ctx.ring[2][1] - ctx.ring[1][1]);
  const shift = l1 > l0 ? 1 : 0;
  const p = [0, 1, 2, 3].map((k) => ctx.ring[(k + shift) % 4]);
  const W = [0, 1, 2, 3].map((k) => ctx.walls[(k + shift) % 4]);
  const len = (W[0].len + W[2].len) / 2;
  const span = (W[1].len + W[3].len) / 2;
  const ov = b.type === "warehouse" || b.type === "shed" ? 0.2 : 0.45;
  const tan = Math.tan((Math.max(1, Math.min(60, b.pitch)) * Math.PI) / 180);
  // Unit vectors along the long axis and across it (into the building, from the first long side).
  const ul = Math.hypot(p[1][0] - p[0][0] + p[2][0] - p[3][0], p[1][1] - p[0][1] + p[2][1] - p[3][1]) || 1;
  const u: Vec2 = [(p[1][0] - p[0][0] + p[2][0] - p[3][0]) / ul, (p[1][1] - p[0][1] + p[2][1] - p[3][1]) / ul];
  const nIn: Vec2 = [-u[1], u[0]];
  const grow = (k: number): Vec2 => add(add(p[k], u, k === 1 || k === 2 ? ov : -ov), nIn, k >= 2 ? ov : -ov);
  const e = [0, 1, 2, 3].map(grow);
  const eave = top - ov * tan;

  if (b.roof === "skillion") {
    const hi = top + span * tan; // wall line of the high (first) side
    const roofHi = top + (span + ov) * tan;
    const E: V3[] = [at3(e[0], roofHi), at3(e[1], roofHi), at3(e[2], eave), at3(e[3], eave)];
    roofFace(ctx, E);
    // The high wall goes on up to the roof; the ends are wall triangles.
    plainWall(ctx, W[0], [at3(p[0], top), at3(p[1], top), at3(p[1], hi), at3(p[0], hi)]);
    plainWall(ctx, W[1], [at3(p[1], top), at3(p[2], top), at3(p[1], hi)]);
    plainWall(ctx, W[3], [at3(p[3], top), at3(p[0], top), at3(p[0], hi)]);
    soffit(ctx, [at3(p[0], hi), at3(p[1], hi), E[1], E[0]]);
    soffit(ctx, [at3(p[1], hi), at3(p[2], top), E[2], E[1]]);
    soffit(ctx, [at3(p[2], top), at3(p[3], top), E[3], E[2]]);
    soffit(ctx, [at3(p[3], top), at3(p[0], hi), E[0], E[3]]);
    return;
  }

  const ridge = top + (span / 2) * tan;
  const m03 = lerp2(e[0], e[3], 0.5), m12 = lerp2(e[1], e[2], 0.5);
  const grownLen = len + 2 * ov;
  const hip = b.roof === "hip";
  let r0 = m03, r1 = m12;
  if (hip) {
    const inset = Math.min(span / 2 + ov, grownLen / 2);
    r0 = add(m03, u, inset);
    r1 = add(m12, u, -inset);
  }
  const E = e.map((q) => at3(q, eave));
  const R0 = at3(r0, ridge), R1 = at3(r1, ridge);
  roofFace(ctx, [E[0], E[1], R1, R0]);
  roofFace(ctx, [E[2], E[3], R0, R1]);
  const T = p.map((q) => at3(q, top));
  // Long-side soffits.
  soffit(ctx, [T[0], T[1], E[1], E[0]]);
  soffit(ctx, [T[2], T[3], E[3], E[2]]);
  if (hip) {
    roofFace(ctx, [E[3], E[0], R0]);
    roofFace(ctx, [E[1], E[2], R1]);
    soffit(ctx, [T[1], T[2], E[2], E[1]]);
    soffit(ctx, [T[3], T[0], E[0], E[3]]);
    return;
  }
  // Gable ends: a wall triangle up to the ridge in each end wall's plane, and the rake's underside.
  const apex0 = at3(lerp2(p[3], p[0], 0.5), ridge), apex1 = at3(lerp2(p[1], p[2], 0.5), ridge);
  plainWall(ctx, W[3], [T[3], T[0], apex0]);
  plainWall(ctx, W[1], [T[1], T[2], apex1]);
  soffit(ctx, [T[3], apex0, R0, E[3]]);
  soffit(ctx, [apex0, T[0], E[0], R0]);
  soffit(ctx, [T[1], apex1, R1, E[1]]);
  soffit(ctx, [apex1, T[2], E[2], R1]);
}

/** A skillion verandah along the front wall, on timber posts. */
function verandah(ctx: Ctx, w: Wall): void {
  const { b, g, top } = ctx;
  if (!b.verandah || w.len < 5) return;
  const room = (b.setback ?? 6) - 1.2; // setback unknown: assume 6 m
  const depth = Math.min(2.6, room);
  if (depth < 1.5) return;
  const pitched = b.roof !== "flat" && ctx.ring.length === 4;
  const ov = b.type === "warehouse" || b.type === "shed" ? 0.2 : 0.45;
  const eave = pitched ? top - ov * Math.tan((b.pitch * Math.PI) / 180) : top;
  const z0 = eave - 0.15;
  const fall = Math.tan((10 * Math.PI) / 180);
  const reach = depth + 0.3;
  const z1 = z0 - reach * fall;
  const a0 = onWall(w, -0.2, 0), a1 = onWall(w, w.len + 0.2, 0), o1 = onWall(w, w.len + 0.2, reach), o0 = onWall(w, -0.2, reach);
  const topFace: V3[] = [at3(a0, z0), at3(a1, z0), at3(o1, z1), at3(o0, z1)];
  roofFace(ctx, topFace);
  soffit(ctx, topFace.map((q) => [q[0], q[1], q[2] - 0.02] as V3));
  // Posts along the depth line, from under the ground to the verandah's underside.
  const under = z0 - depth * fall - 0.02;
  const count = Math.max(2, Math.round(w.len / 2.6) + 1);
  for (let post = 0; post < count; post++) {
    const s = 0.1 + ((w.len - 0.2) * post) / (count - 1);
    const at = onWall(w, s, depth);
    const zg = g(at[0], at[1]) - ctx.sink;
    if (under - zg < 0.5) continue;
    box(ctx.out.get("POSTS", "canopy", true, 16), at, w.dir, 0.1, 0.1, zg, under);
  }
}

/** A cantilevered shop awning over the footpath. */
function awning(ctx: Ctx, w: Wall): void {
  const { b, floor, g } = ctx;
  if (!b.awning || w.len < 4) return;
  const room = (b.setback ?? 3.4) - 0.4; // setback unknown: a 3 m awning
  const reach = Math.min(3, room);
  if (reach < 1.2) return;
  // Busselton fork: on a slope it steps along the front (slopeSteps.ts), each step 3 m over its own
  // wall's lowest ground and never under 2.4 m over the footpath. Laid at the footprint's lowest
  // corner + 3 m, an awning on a hillside street ran under the footpath (Augusta).
  const wallAt = (s: number) => { const p = onWall(w, s, 0); return g(p[0], p[1]); };
  const steps = slopeSteps(w.len, (s) => { const o = onWall(w, s, reach); return [wallAt(s), g(o[0], o[1])]; });
  const level = steps.length === 1 && floor + 3 >= steps[0].hi + 2.4;
  for (const st of steps) {
    const mb = ctx.out.get("AWNING", "canopy", true, 20);
    let z0 = floor + 3;
    if (!level) {
      let lo = Infinity;
      const n = Math.max(1, Math.ceil((st.t1 - st.t0) / 0.5));
      for (let i = 0; i <= n; i++) lo = Math.min(lo, wallAt(st.t0 + ((st.t1 - st.t0) * i) / n));
      z0 = Math.max(lo + 3, st.hi + 2.4);
    }
    const z1 = z0 + 0.35;
    const a0 = onWall(w, st.t0, 0), a1 = onWall(w, st.t1, 0), o1 = onWall(w, st.t1, reach), o0 = onWall(w, st.t0, reach);
    const uv = (p: V3): [number, number] => [p[0] / 2, p[1] / 2];
    polygon(mb, [at3(a0, z1), at3(a1, z1), at3(o1, z1), at3(o0, z1)], uv, "up");
    polygon(mb, [at3(a0, z0), at3(a1, z0), at3(o1, z0), at3(o0, z0)], uv, "down");
    // Fascia on the three open sides, each facing out (to the right of p -> q).
    const side = (p: Vec2, q: Vec2) => {
      const pts: V3[] = [at3(p, z0), at3(q, z0), at3(q, z1), at3(p, z1)];
      polygon(mb, pts, (r) => [(r[0] + r[1]) / 2, (z1 - r[2]) / 0.35]);
    };
    side(o0, o1); // the front edge, facing the street
    side(o1, a1); // the far end
    side(a0, o0); // the near end
  }
}
