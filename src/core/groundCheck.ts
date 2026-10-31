// Busselton fork: is everything placed standing on the ground? (docs/external-review-2026-10-31.md,
// recommendation 2; scripts/check/ground_check.ts runs it on a build's zip.)
//
// The ground is the base's physics meshes, the same ones scenery is placed on (sceneGround.ts):
// road, verge, kerbs and strips, side streets, roundabouts, terrain, car park islands. Placed things
// are every mesh in the scenery groups (furniture, traffic lights, trees, buildings, shops, fences,
// farm, farm roadsides, paths, lots, rails' posts, guide posts, parked cars).
//
// The meshes are merged and tiled, so objects are found again as connected pieces (vertices welded
// to the millimetre). A piece's base is its lowest vertices (within 5 cm of its lowest point) and
// the edges between them, sampled every half metre. A piece is
//   - floating when its whole base is more than `tolerance` over the ground, and nothing that stands
//     reaches up to it (a sign on its post, a lamp on its arm, a roof on its walls are held up);
//   - sunk when its whole base is more than `tolerance` under the ground.
// Pieces over no ground (past the corridor, on the sea) aren't judged.
// Parked cars are also checked against the route's road surface (its asphalt, gutters and rings):
// no part of one may be over it. (Side streets and car park aisles share one mesh name, and a car in
// a bay may reach over an aisle's edge, so streets are left to traffic_check's lanes.)
import type { Kn5Node } from "./kn5";
import { ROUTE_ROAD } from "./parkedClear";
import { PHYSICS_GROUND, topSurface, type SurfaceFn } from "./sceneGround";

/** Groups whose physics meshes are the ground. */
export const SURFACE_GROUPS = new Set(["ROAD", "SIDESTREETS", "VERGE", "KERBS", "ROUNDABOUTS", "TERRAIN", "CARPARKS"]);
/** Groups of placed things, checked whole. */
export const PLACED_GROUPS = new Set(["FURNITURE", "TRAFFICLIGHTS", "TREES", "BUILDINGS", "SHOPS", "FENCES", "FARM", "FARMROAD", "PATHS", "LOTS", "RAILS", "GUIDEPOSTS", "PARKED_CARS"]);
/** Placed things inside ground groups: the island trees and the car park islands' shrubs. */
export const PLACED_MESHES = /^(ISLANDTREES|ISLAND_SHRUBS)/;
/**
 * Never judged: paint, a path's edge skirt and rail beams (they go down into the ground on purpose:
 * buried ends, skirts), and invisible walls.
 */
export const SKIP_MESHES = /^(MARKINGS|PATH_EDGE|ARMCO_|1WALL_RAIL|1WALL_ARMCO|1WALL_CAR|1WALL_TREE)/;

export interface OffPiece {
  group: string;
  mesh: string;
  /** Where its base is, AC coordinates (x east, z south), and how far off: + over the ground, - under. */
  x: number;
  z: number;
  off: number;
  kind: "floating" | "sunk";
}

export interface GroundReport {
  /** Pieces judged (over the ground), per group. */
  checked: Record<string, number>;
  off: OffPiece[];
  /** Parked cars with part of them over a road surface: AC x, z of the car's middle. */
  parkedOnRoad: { x: number; z: number }[];
}

interface Piece {
  group: string;
  mesh: string;
  verts: number[]; // indices into the group's welded vertex arrays
  lo: number;
  hi: number;
  x0: number; x1: number; y0: number; y1: number;
}

/** The ground and placed meshes of a built model, by group (the root's children). */
export function groupsOf(root: Kn5Node): Map<string, Kn5Node[]> {
  const out = new Map<string, Kn5Node[]>();
  const top = root.kind === "node" ? root.children : [root];
  for (const n of top) {
    const k = n.kind === "node" ? n.name : "";
    const list = out.get(k);
    if (list) list.push(n); else out.set(k, [n]);
  }
  return out;
}

const meshesIn = (nodes: Kn5Node[]): Extract<Kn5Node, { kind: "mesh" }>[] =>
  nodes.flatMap((n) => (n.kind === "mesh" ? [n] : meshesIn(n.children)));

/** Checks a built model (its root node) for placed things off the ground. */
export function checkGround(root: Kn5Node, opts: { tolerance?: number; ground?: SurfaceFn; road?: SurfaceFn } = {}): GroundReport {
  const tol = opts.tolerance ?? 0.05;
  const groups = groupsOf(root);
  const surfaceNodes = [...groups].filter(([k]) => SURFACE_GROUPS.has(k)).flatMap(([, v]) => v);
  const ground = opts.ground ?? topSurface(surfaceNodes, PHYSICS_GROUND);
  const road = opts.road ?? topSurface(surfaceNodes, ROUTE_ROAD);
  const report: GroundReport = { checked: {}, off: [], parkedOnRoad: [] };
  // Every piece of every group, in one spatial index (4 m cells), for the held-up test.
  const CELL = 4;
  const cells = new Map<string, Piece[]>();
  const cellKeys = (pc: Piece) => {
    const out: string[] = [];
    for (let i = Math.floor((pc.x0 - tol) / CELL); i <= Math.floor((pc.x1 + tol) / CELL); i++)
      for (let j = Math.floor((pc.y0 - tol) / CELL); j <= Math.floor((pc.y1 + tol) / CELL); j++) out.push(`${i},${j}`);
    return out;
  };
  const all: Piece[] = [];
  const allState = new Map<Piece, { gapLo: number; gapHi: number; at: [number, number] } | null>();

  for (const [group, nodes] of groups) {
    const meshes = meshesIn(nodes).filter((m) => !SKIP_MESHES.test(m.name) && (PLACED_GROUPS.has(group) || (SURFACE_GROUPS.has(group) && PLACED_MESHES.test(m.name))));
    if (!meshes.length) continue;
    // Weld every vertex of the group to the millimetre: local x, y (north) and height.
    const key = new Map<string, number>();
    const X: number[] = [], Y: number[] = [], H: number[] = [], meshOf: number[] = [];
    const parent: number[] = [];
    const find = (a: number): number => {
      while (parent[a] !== a) a = parent[a] = parent[parent[a]];
      return a;
    };
    const union = (a: number, b: number) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    const edges: [number, number][] = [];
    meshes.forEach((m, mi) => {
      const p = m.positions, local: number[] = [];
      for (let v = 0; v < p.length; v += 3) {
        const x = p[v], y = -p[v + 2], h = p[v + 1];
        const k = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(h * 1000)}`;
        let id = key.get(k);
        if (id === undefined) {
          id = X.length;
          key.set(k, id);
          X.push(x); Y.push(y); H.push(h); meshOf.push(mi); parent.push(id);
        }
        local.push(id);
      }
      const ix = m.indices;
      for (let t = 0; t < ix.length; t += 3) {
        const a = local[ix[t]], b = local[ix[t + 1]], c = local[ix[t + 2]];
        union(a, b); union(b, c);
        edges.push([a, b], [b, c], [c, a]);
      }
    });
    // Pieces: the connected sets.
    const pieceOf = new Map<number, Piece>();
    for (let v = 0; v < X.length; v++) {
      const r = find(v);
      let pc = pieceOf.get(r);
      if (!pc) pieceOf.set(r, (pc = { group, mesh: meshes[meshOf[v]].name, verts: [], lo: Infinity, hi: -Infinity, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }));
      pc.verts.push(v);
      pc.lo = Math.min(pc.lo, H[v]); pc.hi = Math.max(pc.hi, H[v]);
      pc.x0 = Math.min(pc.x0, X[v]); pc.x1 = Math.max(pc.x1, X[v]);
      pc.y0 = Math.min(pc.y0, Y[v]); pc.y1 = Math.max(pc.y1, Y[v]);
    }
    // Each piece's base: its lowest vertices and the edges between them, against the ground.
    // Each edge once, whichever way round its triangles list it (an edge only one triangle has, like
    // a wall's bottom, was dropped when listed high id to low, and the base was judged without it).
    const baseEdges = new Map<number, [number, number][]>();
    const seenEdge = new Set<number>();
    for (const [e0, e1] of edges) {
      const a = Math.min(e0, e1), b = Math.max(e0, e1);
      if (a === b) continue;
      const r = find(a), pc = pieceOf.get(r)!;
      if (H[a] <= pc.lo + tol && H[b] <= pc.lo + tol) {
        const k = a * X.length + b;
        if (seenEdge.has(k)) continue;
        seenEdge.add(k);
        const list = baseEdges.get(r);
        if (list) list.push([a, b]); else baseEdges.set(r, [[a, b]]);
      }
    }
    const pieces = [...pieceOf.entries()];
    const state = new Map<Piece, { gapLo: number; gapHi: number; at: [number, number] } | null>();
    let judged = 0;
    for (const [r, pc] of pieces) {
      let gapLo = Infinity, gapHi = -Infinity, at: [number, number] = [0, 0];
      /** Judges one point of the base; false where no ground mesh is under it. */
      const sample = (x: number, y: number, h: number): boolean => {
        const g = ground(x, y);
        if (g === null) return false;
        const d = h - g;
        if (Math.abs(d) < Math.abs(gapLo) || gapLo === Infinity) at = [x, y];
        gapLo = Math.min(gapLo, d);
        gapHi = Math.max(gapHi, d);
        return true;
      };
      for (const v of pc.verts) if (H[v] <= pc.lo + tol) sample(X[v], Y[v], H[v]);
      for (const [a, b] of baseEdges.get(r) ?? []) {
        const n = Math.max(1, Math.floor(Math.hypot(X[b] - X[a], Y[b] - Y[a]) / 0.5));
        const pt = (f: number): [number, number, number] => [X[a] + (X[b] - X[a]) * f, Y[a] + (Y[b] - Y[a]) * f, H[a] + (H[b] - H[a]) * f];
        let was = ground(X[a], Y[a]) !== null;
        for (let k = 1; k <= n; k++) {
          const f = k / n;
          const is = k < n ? sample(...pt(f)) : ground(X[b], Y[b]) !== null;
          // Where the edge runs off the ground meshes (a building past the terrain's edge), also judge
          // it right at the meshes' edge: on a slope the half-metre steps can miss the one stretch it
          // stands on, and its lowest ground is often right there.
          if (is !== was) {
            let lo = (k - 1) / n, hi = f;
            for (let i = 0; i < 8; i++) {
              const mid = (lo + hi) / 2, p = pt(mid);
              if ((ground(p[0], p[1]) !== null) === was) lo = mid; else hi = mid;
            }
            sample(...pt(was ? lo : hi));
          }
          was = is;
        }
      }
      if (gapLo === Infinity) { state.set(pc, null); continue; }
      judged++;
      state.set(pc, { gapLo, gapHi, at });
    }
    report.checked[group] = (report.checked[group] ?? 0) + judged;

    for (const [, pc] of pieces) {
      all.push(pc);
      allState.set(pc, state.get(pc) ?? null);
      for (const k of cellKeys(pc)) { const l = cells.get(k); if (l) l.push(pc); else cells.set(k, [pc]); }
    }

    if (group === "PARKED_CARS") {
      // A car: its pieces (wheels, body, cabin) overlap one another; cars don't overlap.
      const up = new Map<Piece, Piece>();
      const top = (p: Piece): Piece => { while (up.has(p)) p = up.get(p)!; return p; };
      const own = new Map<string, Piece[]>();
      for (const [, pc] of pieces) for (const k of cellKeys(pc)) { const l = own.get(k); if (l) l.push(pc); else own.set(k, [pc]); }
      for (const list of own.values()) {
        for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
          const c = list[a], d = list[b];
          if (c.x0 <= d.x1 && c.x1 >= d.x0 && c.y0 <= d.y1 && c.y1 >= d.y0 && top(c) !== top(d)) up.set(top(c), top(d));
        }
      }
      const cars = new Map<Piece, Piece[]>();
      for (const [, pc] of pieces) { const r = top(pc); const l = cars.get(r); if (l) l.push(pc); else cars.set(r, [pc]); }
      const seen = new Set<string>();
      for (const list of cars.values()) {
        if (!list.some((pc) => pc.verts.some((v) => road(X[v], Y[v]) !== null))) continue;
        const x = list.reduce((a, pc) => a + (pc.x0 + pc.x1) / 2, 0) / list.length, y = list.reduce((a, pc) => a + (pc.y0 + pc.y1) / 2, 0) / list.length;
        const k = `${Math.round(x)},${Math.round(y)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        report.parkedOnRoad.push({ x, z: -y });
      }
    }
  }

  // Held up: a piece over the ground counts as standing when something standing (or held up), in any
  // group, overlaps it and reaches up to its bottom: a sign on its post, a verandah on its shop's
  // wall. Spread out from the pieces on (or in) the ground.
  const standing = new Set<Piece>();
  const queue: Piece[] = [];
  for (const pc of all) {
    const s = allState.get(pc);
    if (!s || s.gapLo <= tol) { standing.add(pc); queue.push(pc); }
  }
  while (queue.length) {
    const d = queue.pop()!;
    for (const k of cellKeys(d)) {
      for (const c of cells.get(k) ?? []) {
        if (standing.has(c)) continue;
        const overlap = c.x0 <= d.x1 + tol && c.x1 >= d.x0 - tol && c.y0 <= d.y1 + tol && c.y1 >= d.y0 - tol;
        if (!overlap || d.hi < c.lo - tol) continue;
        standing.add(c);
        queue.push(c);
      }
    }
  }
  for (const pc of all) {
    const s = allState.get(pc);
    if (!s) continue;
    if (!standing.has(pc)) report.off.push({ group: pc.group, mesh: pc.mesh, x: s.at[0], z: -s.at[1], off: s.gapLo, kind: "floating" });
    else if (s.gapHi < -tol) report.off.push({ group: pc.group, mesh: pc.mesh, x: s.at[0], z: -s.at[1], off: s.gapHi, kind: "sunk" });
  }
  return report;
}
