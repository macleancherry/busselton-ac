// The numbers behind scripts/check/benchmark.ts. Pure (no files, no Blender) so it can be tested.
// Local metres throughout: x east, y north, z up (AC's x, -z, y).

export type XY = [number, number];

/** A mesh as dump_surface.ts writes it: AC positions (x, y up, z) and triangle indices. */
export interface RawMesh { name: string; p: ArrayLike<number>; i: ArrayLike<number> }

/** One object picked out of a merged mesh: a parked car, a pole, a tree. */
export interface SceneObject {
  kind: string;
  /** Where it meets the ground: the middle of its lowest vertices. */
  contact: XY;
  /** Its lowest point. */
  base: number;
  min: XY;
  max: XY;
  /** Its footprint as an oriented box: centre, unit long axis, half length and half width. */
  obb: { c: XY; u: XY; half: XY };
}

/**
 * Split merged meshes (many objects in one draw call) into objects: connected pieces, then pieces
 * whose footprints touch (within `join` m) as one, so a lamp's head goes with its pole. Pass every mesh
 * of a family together (a pole and its lamp head live in different meshes); `kindOf` names an object
 * from the meshes its pieces came from. `join: "inside"` joins a piece only when at least half its
 * footprint lies within another's (a car's wheels under its body), so cars that merely touch, or
 * overlap a little, stay apart.
 */
export function splitObjects(meshes: RawMesh[], kindOf: (names: Set<string>) => string, join: number | "inside" = 0.15): SceneObject[] {
  const reach = join === "inside" ? 0 : join;
  const joins = (b: number[], c: number[]) => {
    if (join !== "inside") return b[0] - reach <= c[2] && c[0] - reach <= b[2] && b[1] - reach <= c[3] && c[1] - reach <= b[3];
    const w = Math.min(b[2], c[2]) - Math.max(b[0], c[0]), h = Math.min(b[3], c[3]) - Math.max(b[1], c[1]);
    if (w < 0 || h < 0) return false;
    const area = (q: number[]) => Math.max(q[2] - q[0], 0.05) * Math.max(q[3] - q[1], 0.05);
    return Math.max(w, 0.05) * Math.max(h, 0.05) >= 0.5 * Math.min(area(b), area(c));
  };
  // Every vertex of every mesh, numbered across meshes.
  const offsets: number[] = [];
  let n = 0;
  for (const m of meshes) { offsets.push(n); n += m.p.length / 3; }
  if (!n) return [];
  const P = new Float64Array(n * 3), owner = new Int32Array(n);
  meshes.forEach((m, mi) => {
    for (let v = 0; v < m.p.length / 3; v++) {
      const k = offsets[mi] + v;
      P[k * 3] = m.p[v * 3]; P[k * 3 + 1] = -m.p[v * 3 + 2]; P[k * 3 + 2] = m.p[v * 3 + 1];
      owner[k] = mi;
    }
  });
  const parent = new Int32Array(n).map((_, k) => k);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  meshes.forEach((m, mi) => {
    const o = offsets[mi];
    for (let t = 0; t < m.i.length; t += 3) { union(o + m.i[t], o + m.i[t + 1]); union(o + m.i[t], o + m.i[t + 2]); }
  });
  // Each piece's box: x0 y0 x1 y1 z0.
  const box = new Map<number, number[]>();
  for (let v = 0; v < n; v++) {
    const r = find(v), x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const b = box.get(r);
    if (!b) box.set(r, [x, y, x, y, z]);
    else { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); b[4] = Math.min(b[4], z); }
  }
  // Join pieces whose boxes touch (a grid keeps it linear).
  const roots = [...box.keys()];
  const group = new Map<number, number>(roots.map((r) => [r, r]));
  const gfind = (a: number): number => { let g = group.get(a)!; while (g !== a) { a = g; g = group.get(a)!; } return a; };
  const CELL = 4, grid = new Map<string, number[]>();
  for (const r of roots) {
    const b = box.get(r)!;
    for (let cx = Math.floor((b[0] - reach) / CELL); cx <= Math.floor((b[2] + reach) / CELL); cx++)
      for (let cy = Math.floor((b[1] - reach) / CELL); cy <= Math.floor((b[3] + reach) / CELL); cy++) {
        const key = `${cx},${cy}`;
        for (const o of grid.get(key) ?? []) {
          const c = box.get(o)!;
          if (joins(b, c)) {
            const ga = gfind(r), gb = gfind(o);
            if (ga !== gb) group.set(ga, gb);
          }
        }
        (grid.get(key) ?? grid.set(key, []).get(key)!).push(r);
      }
  }
  // Per object: box, lowest point, the meshes it came from, and the middle of the vertices within 3 cm of its base.
  const objs = new Map<number, { min: XY; max: XY; base: number; names: Set<string> }>();
  for (const r of roots) {
    const g = gfind(r), b = box.get(r)!, o = objs.get(g);
    if (!o) objs.set(g, { min: [b[0], b[1]], max: [b[2], b[3]], base: b[4], names: new Set() });
    else { o.min = [Math.min(o.min[0], b[0]), Math.min(o.min[1], b[1])]; o.max = [Math.max(o.max[0], b[2]), Math.max(o.max[1], b[3])]; o.base = Math.min(o.base, b[4]); }
  }
  const low = new Map<number, number[]>(); // sx sy count
  const mom = new Map<number, number[]>(); // n sx sy sxx syy sxy, for the footprint's long axis
  const groupOf = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const g = gfind(find(v)), o = objs.get(g)!, x = P[v * 3], y = P[v * 3 + 1];
    groupOf[v] = g;
    o.names.add(meshes[owner[v]].name);
    const m = mom.get(g) ?? mom.set(g, [0, 0, 0, 0, 0, 0]).get(g)!;
    m[0]++; m[1] += x; m[2] += y; m[3] += x * x; m[4] += y * y; m[5] += x * y;
    if (P[v * 3 + 2] > o.base + 0.03) continue;
    const l = low.get(g) ?? low.set(g, [0, 0, 0]).get(g)!;
    l[0] += x; l[1] += y; l[2]++;
  }
  // Oriented footprints: the principal axis of the vertices, and their extent along it and across.
  const axis = new Map<number, { c: XY; u: XY; lo: number[]; hi: number[] }>();
  for (const [g, m] of mom) {
    const mx = m[1] / m[0], my = m[2] / m[0];
    const cxx = m[3] / m[0] - mx * mx, cyy = m[4] / m[0] - my * my, cxy = m[5] / m[0] - mx * my;
    const t = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    axis.set(g, { c: [mx, my], u: [Math.cos(t), Math.sin(t)], lo: [Infinity, Infinity], hi: [-Infinity, -Infinity] });
  }
  for (let v = 0; v < n; v++) {
    const a = axis.get(groupOf[v])!, dx = P[v * 3] - a.c[0], dy = P[v * 3 + 1] - a.c[1];
    const s = dx * a.u[0] + dy * a.u[1], q = -dx * a.u[1] + dy * a.u[0];
    a.lo[0] = Math.min(a.lo[0], s); a.hi[0] = Math.max(a.hi[0], s); a.lo[1] = Math.min(a.lo[1], q); a.hi[1] = Math.max(a.hi[1], q);
  }
  return [...objs].map(([g, o]) => {
    const l = low.get(g)!, a = axis.get(g)!;
    const ms = (a.lo[0] + a.hi[0]) / 2, mq = (a.lo[1] + a.hi[1]) / 2;
    let u = a.u, half: XY = [(a.hi[0] - a.lo[0]) / 2, (a.hi[1] - a.lo[1]) / 2];
    if (half[1] > half[0]) { u = [-u[1], u[0]]; half = [half[1], half[0]]; }
    const c: XY = [a.c[0] + ms * a.u[0] - mq * a.u[1], a.c[1] + ms * a.u[1] + mq * a.u[0]];
    return { kind: kindOf(o.names), contact: [l[0] / l[2], l[1] / l[2]] as XY, base: o.base, min: o.min, max: o.max, obb: { c, u, half } };
  });
}

/** Objects whose footprints (oriented boxes, shrunk by `shrink` m) overlap another's: cars driven into each other. */
export function overlapping(objs: SceneObject[], shrink = 0.1): Set<SceneObject> {
  const out = new Set<SceneObject>();
  const corners = (o: SceneObject): XY[] => {
    const { c, u, half } = o.obb, a = Math.max(half[0] - shrink, 0), b = Math.max(half[1] - shrink, 0);
    return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([i, j]) => [c[0] + i * a * u[0] - j * b * u[1], c[1] + i * a * u[1] + j * b * u[0]] as XY);
  };
  const separated = (p: XY[], q: XY[], ax: XY) => {
    const proj = (r: XY[]) => r.map((v) => v[0] * ax[0] + v[1] * ax[1]);
    const a = proj(p), b = proj(q);
    return Math.max(...a) <= Math.min(...b) || Math.max(...b) <= Math.min(...a);
  };
  const CELL = 8, grid = new Map<string, number[]>();
  objs.forEach((o, k) => {
    const key = `${Math.floor(o.obb.c[0] / CELL)},${Math.floor(o.obb.c[1] / CELL)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(k);
  });
  objs.forEach((o, k) => {
    const cx = Math.floor(o.obb.c[0] / CELL), cy = Math.floor(o.obb.c[1] / CELL), p = corners(o);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of grid.get(`${cx + a},${cy + b}`) ?? []) {
      if (j <= k) continue;
      const q = corners(objs[j]), u = o.obb.u, w = objs[j].obb.u;
      if ([u, [-u[1], u[0]] as XY, w, [-w[1], w[0]] as XY].some((ax) => separated(p, q, ax))) continue;
      out.add(o); out.add(objs[j]);
    }
  });
  return out;
}

/** Every surface height at a point, from a set of meshes (highest first), with the mesh names. */
export type Sampler = (x: number, y: number) => { h: number; name: string }[];

export function sampler(meshes: RawMesh[], CELL = 4): Sampler {
  const tris: number[] = []; // x0 y0 z0 ... (local)
  const owner: number[] = [];
  const grid = new Map<string, number[]>();
  meshes.forEach((m, mi) => {
    for (let k = 0; k < m.i.length; k += 3) {
      const t = owner.length;
      owner.push(mi);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let c = 0; c < 3; c++) {
        const v = m.i[k + c] * 3, x = m.p[v], y = -m.p[v + 2];
        tris.push(x, y, m.p[v + 1]);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
        for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
          const key = `${cx},${cy}`;
          (grid.get(key) ?? grid.set(key, []).get(key)!).push(t);
        }
    }
  });
  return (x, y) => {
    const out: { h: number; name: string }[] = [];
    for (const t of grid.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) ?? []) {
      const o = t * 9;
      const ax = tris[o], ay = tris[o + 1], bx = tris[o + 3], by = tris[o + 4], cx = tris[o + 6], cy = tris[o + 7];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
      const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      out.push({ h: u * tris[o + 2] + v * tris[o + 5] + w * tris[o + 8], name: meshes[owner[t]].name });
    }
    return out.sort((a, b) => b.h - a.h);
  };
}

/** Physics meshes a car or an object stands on: everything with a digit, less walls. */
export const isGround = (name: string) => /^\d/.test(name) && !/^\dWALL/.test(name);
/** Physics meshes a car drives on (not kerbs, grass or walls). */
export const isDrivable = (name: string) => /^\d(ROAD|STREET|UNSEALED|UNPAVED)/.test(name) && !/^\dROAD_PATH/.test(name);

export interface ObjectStats {
  kind: string;
  count: number;
  /** Objects whose base is more than `tol` above (floating) or below (sunk) the surface under it. */
  floating: number;
  sunk: number;
  /** The middle offset, metres: where the kind is placed by design. */
  median: number;
  /** Worst cases, metres (positive = above the surface). */
  maxFloat: number;
  maxSink: number;
  /** Objects with no surface under them at all. */
  unsupported: number;
  /** The worst object counted as floating or sunk. */
  worst?: { at: XY; offset: number };
}

/** Families of merged meshes split together, and what to call each object. */
export const FAMILIES: { match: RegExp; kindOf: (names: Set<string>) => string; join?: number | "inside" }[] = [
  // A car's wheels sit under its body; cars beside each other stay apart (see overlapping()).
  { match: /^PARKED_CARS/, kindOf: () => "car", join: "inside" },
  {
    match: /^(FURNITURE_|GUIDEPOSTS|SHOP_POST)/,
    kindOf: (names) => {
      const has = (r: RegExp) => [...names].some((n) => r.test(n));
      // A lamp with nothing else joined to it is a head with no arm or pole under it.
      if ([...names].every((n) => /LAMP/.test(n))) return "lamp head";
      return has(/SIGNAL/) ? "signal" : has(/LAMP/) ? "light" :has(/GUIDEPOST/) ? "guidepost" : has(/SHOP_POST/) ? "verandah post" : "pole/furniture";
    },
  },
  { match: /^(TREES_|ISLANDTREES)/, kindOf: () => "tree" },
];

/**
 * How far below the surface counts as sunk, per kind. Posts, poles and trunks are planted on purpose
 * (about 0.2 to 0.8 m), so only buried ones count; a car's wheels must sit on the road.
 */
export const SINK_TOLERANCE: Record<string, number> = { car: 0.05, tree: 1, guidepost: 1, "verandah post": 1, "pole/furniture": 1, signal: 1, light: 1 };

/** How far each object's base sits from the built physics surface (the highest ground under its contact point). */
export function objectOffsets(objs: SceneObject[], ground: Sampler, tol = 0.05, sinkTol: Record<string, number> = SINK_TOLERANCE): ObjectStats[] {
  const by = new Map<string, ObjectStats>();
  const offs = new Map<string, number[]>();
  for (const o of objs) {
    const s = by.get(o.kind) ?? by.set(o.kind, { kind: o.kind, count: 0, floating: 0, sunk: 0, median: 0, maxFloat: 0, maxSink: 0, unsupported: 0 }).get(o.kind)!;
    s.count++;
    const hits = ground(o.contact[0], o.contact[1]);
    if (!hits.length) { s.unsupported++; continue; }
    // The surface it should stand on: the highest one not far above its base (a tree under a verandah
    // stands on the ground, not the roof); else the lowest.
    const under = hits.find((h) => h.h <= o.base + 0.5) ?? hits[hits.length - 1];
    const d = o.base - under.h;
    const up = d > tol, down = d < -(sinkTol[o.kind] ?? tol);
    if (up) s.floating++;
    if (down) s.sunk++;
    if (d > s.maxFloat) s.maxFloat = d;
    if (d < s.maxSink) s.maxSink = d;
    if ((up || down) && Math.abs(d) > Math.abs(s.worst?.offset ?? 0)) s.worst = { at: o.contact, offset: d };
    (offs.get(o.kind) ?? offs.set(o.kind, []).get(o.kind)!).push(d);
  }
  for (const s of by.values()) {
    const v = (offs.get(s.kind) ?? []).sort((a, b) => a - b);
    s.median = v.length ? v[Math.floor(v.length / 2)] : 0;
  }
  return [...by.values()];
}

export interface StepStats {
  /** Grid points sampled with a drivable surface under them. */
  samples: number;
  /** Neighbouring drivable points (`step` m apart) whose heights differ by more than `tol`. */
  steps: number;
  maxStep: number;
  maxStepAt?: XY;
  /** Points with two drivable surfaces 1 to 25 cm apart: a lip or a z-fight where meshes overlap. */
  stacked: number;
  maxStack: number;
}

/**
 * Steps and lips in the drivable surface within `radius` of a point: the jumps a car feels between
 * neighbouring points, and where two road meshes overlap at different heights. Kerbs aren't drivable
 * here, so their intended step doesn't count.
 */
export function surfaceSteps(drive: Sampler, centre: XY, radius: number, step = 0.25, tol = 0.03): StepStats {
  const n = Math.ceil(radius / step);
  const top = new Map<string, number>();
  const s: StepStats = { samples: 0, steps: 0, maxStep: 0, stacked: 0, maxStack: 0 };
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    if (Math.hypot(i, j) * step > radius) continue;
    const hits = drive(centre[0] + i * step, centre[1] + j * step);
    if (!hits.length) continue;
    s.samples++;
    top.set(`${i},${j}`, hits[0].h);
    for (let k = 1; k < hits.length; k++) {
      const d = hits[0].h - hits[k].h;
      if (d > 0.01 && d < 0.25) { s.stacked++; s.maxStack = Math.max(s.maxStack, d); break; }
    }
  }
  for (const [key, h] of top) {
    const [i, j] = key.split(",").map(Number);
    for (const [a, b] of [[1, 0], [0, 1]]) {
      const o = top.get(`${i + a},${j + b}`);
      if (o === undefined) continue;
      const d = Math.abs(h - o);
      if (d > tol) {
        s.steps++;
        if (d > s.maxStep) { s.maxStep = d; s.maxStepAt = [centre[0] + i * step, centre[1] + j * step]; }
      }
    }
  }
  return s;
}

/** Parked cars within `reach` m of a traffic lane point (lanes as traffic.json: AC [x, y, z] points). */
export function carsInLanes(cars: SceneObject[], lanes: { points: number[][] }[], reach = 1.6): SceneObject[] {
  const CELL = 8, grid = new Map<string, XY[]>();
  for (const l of lanes) for (const p of l.points) {
    const q: XY = [p[0], -p[2]], key = `${Math.floor(q[0] / CELL)},${Math.floor(q[1] / CELL)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(q);
  }
  return cars.filter((c) => {
    const m: XY = [(c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2];
    const cx = Math.floor(m[0] / CELL), cy = Math.floor(m[1] / CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++)
      for (const q of grid.get(`${cx + a},${cy + b}`) ?? []) if (Math.hypot(q[0] - m[0], q[1] - m[1]) < reach) return true;
    return false;
  });
}
