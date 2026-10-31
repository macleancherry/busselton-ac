// Busselton fork: are the street lights whole, and are the poles off the road? (scripts/check/ground_check.ts
// runs it on a build's zip, beside checkGround.)
//
// The benchmark (docs/benchmarks.md) found lamp heads hanging in the air with no arm to their pole,
// and signal posts and power poles standing on side streets. Both are checked here on the built meshes:
//   - a lamp head (a mesh named ..LAMP..) is loose when nothing joins it to a pole that stands on the
//     ground: the pieces of the pole families (furniture, traffic lights, guide posts) are joined when
//     their boxes touch in 3D (within 3 cm), and a lamp's set must reach down to the ground;
//   - a pole is on the road when the foot of a tall, slender set (over 1.5 m tall, its foot under 1 m
//     across) stands on a drivable mesh (sceneGround.ts ROAD_SURFACE) that is the top surface there.
//     Traffic islands and medians aren't road meshes, so a post on a real island passes.
import type { Kn5Node } from "./kn5";
import { groupsOf, SURFACE_GROUPS } from "./groundCheck";
import { PHYSICS_GROUND, ROAD_SURFACE, topSurface, type SurfaceFn } from "./sceneGround";

/** Groups whose meshes are poles and what hangs on them. */
export const POLE_GROUPS = new Set(["FURNITURE", "TRAFFICLIGHTS", "GUIDEPOSTS"]);
/** A lamp head's mesh. */
export const LAMP_MESH = /LAMP/;

export interface PoleReport {
  /** Lamp heads joined to nothing standing: AC x, z and the head's height over the ground. */
  looseLamps: { mesh: string; x: number; z: number; up: number }[];
  /** Poles and posts whose foot is on a drivable mesh: AC x, z. */
  polesOnRoad: { mesh: string; x: number; z: number; road: string; height: number }[];
  /** Light sets (a lamp with its pole) and pole sets judged. */
  lights: number;
  poles: number;
}

interface Bit { mesh: string; x0: number; x1: number; y0: number; y1: number; lo: number; hi: number }

const meshesIn = (nodes: Kn5Node[]): Extract<Kn5Node, { kind: "mesh" }>[] =>
  nodes.flatMap((n) => (n.kind === "mesh" ? [n] : meshesIn(n.children)));

/** Connected pieces (vertices welded to the millimetre) of a mesh, as boxes in local metres. */
function bitsOf(m: Extract<Kn5Node, { kind: "mesh" }>): Bit[] {
  const p = m.positions, n = p.length / 3;
  const key = new Map<string, number>(), id = new Int32Array(n);
  const parent: number[] = [];
  for (let v = 0; v < n; v++) {
    const k = `${Math.round(p[v * 3] * 1000)},${Math.round(p[v * 3 + 1] * 1000)},${Math.round(p[v * 3 + 2] * 1000)}`;
    let w = key.get(k);
    if (w === undefined) { w = parent.length; key.set(k, w); parent.push(w); }
    id[v] = w;
  }
  const find = (a: number): number => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  const ix = m.indices;
  for (let t = 0; t < ix.length; t += 3) {
    const a = find(id[ix[t]]), b = find(id[ix[t + 1]]), c = find(id[ix[t + 2]]);
    parent[a] = b;
    parent[find(c)] = find(b);
  }
  const box = new Map<number, Bit>();
  for (let v = 0; v < n; v++) {
    const r = find(id[v]), x = p[v * 3], y = -p[v * 3 + 2], h = p[v * 3 + 1];
    const b = box.get(r);
    if (!b) box.set(r, { mesh: m.name, x0: x, x1: x, y0: y, y1: y, lo: h, hi: h });
    else {
      b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
      b.lo = Math.min(b.lo, h); b.hi = Math.max(b.hi, h);
    }
  }
  return [...box.values()];
}

export function checkPoles(root: Kn5Node, opts: { ground?: SurfaceFn; road?: SurfaceFn; tolerance?: number } = {}): PoleReport {
  const tol = opts.tolerance ?? 0.05;
  const groups = groupsOf(root);
  // The network core's junctions (JUNCTIONS) are drivable streets too.
  const surfaceNodes = [...groups].filter(([k]) => SURFACE_GROUPS.has(k) || k === "JUNCTIONS").flatMap(([, v]) => v);
  const ground = opts.ground ?? topSurface(surfaceNodes, PHYSICS_GROUND);
  const road = opts.road ?? topSurface(surfaceNodes, ROAD_SURFACE);
  // Which mesh a road hit came from, for the report: the names of the drivable meshes, tried in turn.
  const roadNames = surfaceNodes.length ? meshesIn(surfaceNodes).filter((m) => ROAD_SURFACE.test(m.name)) : [];
  const each = new Map<object, SurfaceFn>();
  const roadName = (x: number, y: number) => {
    for (const m of roadNames) {
      let s = each.get(m);
      if (!s) each.set(m, (s = topSurface([m], /./)));
      if (s(x, y) !== null) return m.name;
    }
    return "road";
  };

  const bits: Bit[] = [];
  for (const [g, nodes] of groups) if (POLE_GROUPS.has(g)) for (const m of meshesIn(nodes)) if (m.indices.length && !/^\dWALL/.test(m.name)) bits.push(...bitsOf(m));
  // Join bits whose boxes touch in 3D (a grid keeps it near linear).
  const J = 0.03, CELL = 4;
  const parent = bits.map((_, k) => k);
  const find = (a: number): number => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  const grid = new Map<string, number[]>();
  bits.forEach((b, k) => {
    for (let i = Math.floor((b.x0 - J) / CELL); i <= Math.floor((b.x1 + J) / CELL); i++)
      for (let j = Math.floor((b.y0 - J) / CELL); j <= Math.floor((b.y1 + J) / CELL); j++) {
        const key = `${i},${j}`;
        const list = grid.get(key);
        for (const o of list ?? []) {
          const c = bits[o];
          if (b.x0 - J <= c.x1 && c.x0 - J <= b.x1 && b.y0 - J <= c.y1 && c.y0 - J <= b.y1 && b.lo - J <= c.hi && c.lo - J <= b.hi) {
            const ra = find(k), rb = find(o);
            if (ra !== rb) parent[ra] = rb;
          }
        }
        if (list) list.push(k); else grid.set(key, [k]);
      }
  });
  const sets = new Map<number, Bit[]>();
  bits.forEach((b, k) => { const r = find(k); const l = sets.get(r); if (l) l.push(b); else sets.set(r, [b]); });

  const report: PoleReport = { looseLamps: [], polesOnRoad: [], lights: 0, poles: 0 };
  for (const set of sets.values()) {
    const lo = Math.min(...set.map((b) => b.lo)), hi = Math.max(...set.map((b) => b.hi));
    const foot = set.filter((b) => b.lo <= lo + tol);
    const fx0 = Math.min(...foot.map((b) => b.x0)), fx1 = Math.max(...foot.map((b) => b.x1));
    const fy0 = Math.min(...foot.map((b) => b.y0)), fy1 = Math.max(...foot.map((b) => b.y1));
    const fx = (fx0 + fx1) / 2, fy = (fy0 + fy1) / 2;
    const g = ground(fx, fy);
    const lamps = set.filter((b) => LAMP_MESH.test(b.mesh));
    if (lamps.length) {
      report.lights++;
      // Standing: the set's foot reaches the ground (or into it).
      if (g !== null && lo > g + tol) {
        for (const l of lamps) {
          const x = (l.x0 + l.x1) / 2, y = (l.y0 + l.y1) / 2, gl = ground(x, y);
          report.looseLamps.push({ mesh: l.mesh, x, z: -y, up: gl === null ? NaN : l.lo - gl });
        }
      }
    }
    const slender = hi - lo > 1.5 && Math.max(fx1 - fx0, fy1 - fy0) < 1;
    if (!slender || g === null) continue;
    report.poles++;
    const r = road(fx, fy);
    if (r !== null && Math.abs(r - g) < tol) report.polesOnRoad.push({ mesh: foot[0].mesh, x: fx, z: -fy, road: roadName(fx, fy), height: hi - lo });
  }
  return report;
}
