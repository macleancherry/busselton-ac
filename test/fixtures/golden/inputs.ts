// Fixed inputs for the golden fixtures in this folder: captured from the pre-rewrite modules by
// a one-off script (scripts/tmp/capture_golden.ts, not kept), compared against the current ones by test/golden.test.ts.
import { planRoad, SegmentIndex } from "../../../src/core/road";
import { withDefaults, type BuildOptions } from "../../../src/core/options";
import type { RasterSampler } from "../../../src/core/trace";
import type { RoadPlan } from "../../../src/core/road";
import type { Vec2 } from "../../../src/core/geo";
import type { Kn5MeshNode } from "../../../src/core/kn5";

type V3 = [number, number, number];
/** The parts of MeshBuilder the cases use. */
interface Builder {
  normals: number[] | null;
  vertex(p: V3, u: number, v: number): number;
  tri(a: number, b: number, c: number): void;
  quad(a: number, b: number, c: number, d: number): void;
}

export const LIGHTS = {
  ground: { ambient: 0.45, diffuse: 0.4, specular: 0, exp: 1 },
  fence: { ambient: 0.45, diffuse: 0.45, specular: 0.1, exp: 15 },
  asphalt: { ambient: 0.4, diffuse: 0.45, specular: 0.08, exp: 20 },
  gravel: { ambient: 0.42, diffuse: 0.45, specular: 0.02, exp: 10 },
};

function boxMesh<B extends Builder>(mb: B, [ox, oy, oz]: V3): B {
  const P = (x: number, y: number, z: number): V3 => [x + ox, y + oy, z + oz];
  const c = [P(0, 0, 0), P(2, 0, 0), P(2, 3, 0), P(0, 3, 0), P(0, 0, 1.5), P(2, 0, 1.5), P(2, 3, 1.5), P(0, 3, 1.5)];
  const v = c.map((p, i) => mb.vertex(p, (i % 4) / 3, i < 4 ? 0 : 1));
  mb.quad(v[0], v[3], v[2], v[1]);
  mb.quad(v[4], v[5], v[6], v[7]);
  mb.quad(v[0], v[1], v[5], v[4]);
  mb.quad(v[1], v[2], v[6], v[5]);
  mb.quad(v[2], v[3], v[7], v[6]);
  mb.quad(v[3], v[0], v[4], v[7]);
  // A fan of 5 triangles round a raised centre (shared vertices, unequal areas).
  const centre = mb.vertex(P(5, 5, 0.7), 0.5, 0.5);
  const ring: number[] = [];
  for (let i = 0; i < 6; i++) {
    const t = (i / 5) * Math.PI * 1.7;
    ring.push(mb.vertex(P(5 + Math.cos(t) * (1 + i * 0.3), 5 + Math.sin(t) * (1 + i * 0.2), i * 0.1), i / 5, 1));
  }
  for (let i = 0; i < 5; i++) mb.tri(centre, ring[i], ring[i + 1]);
  return mb;
}

export function meshCases<B extends Builder>(make: () => B): Record<string, { mb: B; name: string; material: string; extra?: Partial<Kn5MeshNode> }> {
  const q = make();
  q.quad(q.vertex([0, 0, 0], 0, 1), q.vertex([1, 0, 0], 1, 1), q.vertex([1, 1, 0], 1, 0), q.vertex([0, 1, 0], 0, 0));
  const u = make();
  const u0 = u.vertex([0, 0, 0], 0, 0), u1 = u.vertex([3, 0, 0.5], 1, 0), u2 = u.vertex([0, 2, 0.2], 0, 1);
  u.vertex([9, 9, 9], 0.3, 0.3); // unused
  const z = u.vertex([1, 1, 0], 0, 0);
  u.tri(u0, u1, u2);
  u.tri(z, z, u1); // zero area
  const e = make();
  e.normals = [];
  for (const [p, n] of [[[0, 0, 0], [0, 0, 2]], [[1, 0, 0], [0.3, 0.1, 0.7]], [[1, 1, 0], [-1, 0, 0]]] as [V3, number[]][]) {
    e.vertex(p, p[0], p[1]);
    e.normals.push(...n);
  }
  e.tri(0, 1, 2);
  return {
    unitQuad: { mb: q, name: "unit_quad", material: "m_quad" },
    box: { mb: boxMesh(make(), [0, 0, 0]), name: "box", material: "m_box", extra: { castShadows: false } },
    boxFar: { mb: boxMesh(make(), [2000.123, -1999.77, 31.4]), name: "box_far", material: "m_box", extra: { renderable: false } },
    unusedAndDegenerate: { mb: u, name: "unused", material: "m_u" },
    explicitNormals: { mb: e, name: "explicit", material: "m_e" },
  };
}

/** test/trace.test.ts's synthetic photo: a 9 m road 1.5 m north of y = 0, canopy, a red car, paint, a shadow. */
export function photo(): RasterSampler {
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return (x, y) => {
    const n = (rnd() - 0.5) * 0.04;
    if (x > 50 && x < 150) return [0.12 + n, 0.3 + n, 0.1 + n];
    const t = y - 1.5;
    if (Math.abs(t) < 4.5) {
      if (x > -102 && x < -98 && t > 0.5 && t < 2.3) return [0.75, 0.1, 0.1];
      if (Math.abs(t) < 0.06 && ((x % 12) + 12) % 12 < 3) return [0.85, 0.85, 0.83];
      const shade = x > -200 && x < -170 ? 0.6 : 1;
      return [(0.38 + n) * shade, (0.38 + n) * shade, (0.4 + n) * shade];
    }
    return [0.33 + n, 0.45 + n, 0.2 + n];
  };
}

type PhotoCase = { plan: RoadPlan; raster: RasterSampler; a: number; b: number; trusted: (i: number) => boolean; W?: number; H?: number };
export function photoCases(): Record<string, PhotoCase> {
  const path: Vec2[] = Array.from({ length: 31 }, (_, i) => [i * 20 - 300, 0]);
  const plan = planRoad(path, withDefaults({ widthOverride: 9 }));
  plan.samples.forEach((s) => (s.pos = [s.pos[0], s.pos[1] + 1.5]));
  const ring: Vec2[] = Array.from({ length: 41 }, (_, i) => {
    const t = (i / 40) * Math.PI * 2;
    return [Math.cos(t) * 150, Math.sin(t) * 100];
  });
  const loop = planRoad(ring, withDefaults({ widthOverride: 8 }));
  const ln = loop.samples.length;
  const grey: RasterSampler = (x, y) => {
    const v = 0.3 + 0.05 * Math.sin(x * 0.7) + 0.03 * Math.cos(y * 1.3);
    return [v, v, v + 0.02];
  };
  return {
    full: { plan, raster: photo(), a: 0, b: 120, trusted: () => true },
    smallUntrusted: { plan, raster: photo(), a: 40, b: 160, trusted: (i) => i < 70 || i > 100, W: 32, H: 256 },
    smallNull: { plan, raster: ((p) => (x: number, y: number) => (x > -150 && x < -120 ? null : p(x, y)))(photo()), a: 0, b: 120, trusted: () => true, W: 32, H: 256 },
    allUntrusted: { plan, raster: photo(), a: 0, b: 120, trusted: () => false, W: 32, H: 256 },
    loopWrap: { plan: loop, raster: grey, a: ln - 60, b: ln, trusted: () => true, W: 32, H: 256 },
  };
}

type Height = (x: number, y: number) => number;
type WireArgs = [Vec2[][], SegmentIndex, BuildOptions, Height, (x: number, y: number) => boolean, ((x: number, y: number) => number)?, number?, number?];
export function fenceCases() {
  // A 10 m street along y = 0, x -200..200, on ground sloping both ways.
  const path: Vec2[] = Array.from({ length: 21 }, (_, i) => [i * 20 - 200, 0]);
  const opts = withDefaults({ widthOverride: 10 });
  const index = new SegmentIndex(planRoad(path, opts));
  const barriers = [
    { pts: [[-150, 20], [-120, 22], [-100, 22.05], [-80, 30]] as Vec2[], kind: "fence" as const },
    { pts: [[-60, 18], [-30, 18], [-30, 35]] as Vec2[], kind: "fence" as const, fenceType: "wood", height: 1.6 },
    { pts: [[0, 14], [25, 15], [25.1, 15.1], [50, 14]] as Vec2[], kind: "wall" as const },
    { pts: [[60, -14], [100, -16]] as Vec2[], kind: "retaining_wall" as const, material: "stone" },
    { pts: [[110, 16], [150, 16], [160, 25]] as Vec2[], kind: "hedge" as const, height: 2.2 },
    { pts: [[-190, 6], [-170, 6]] as Vec2[], kind: "wall" as const }, // on the road edge: nothing
    { pts: [[0, -60], [40, -60]] as Vec2[], kind: "fence" as const }, // beyond the corridor
  ];
  // farm.test.ts inputs
  const fpath: Vec2[] = Array.from({ length: 16 }, (_, i) => [i * 20, 0]);
  const fopts = withDefaults({ widthOverride: 8, corridor: 70, farmland: true });
  const findex = new SegmentIndex(planRoad(fpath, fopts));
  const wireBoundary: WireArgs = [[[[20, 15], [200, 15]]], findex, fopts, (x) => 2 + x * 0.01, () => true];
  const wireMixed: WireArgs = [[[[0, 4.5], [300, 4.5]], [[20, 60], [200, 60]], [[40, 20], [120, 20]], [[120, 20], [40, 20]], [[130, 12], [130, 30], [160, 30]]],
    findex, fopts, (x, y) => x * 0.01 + y * 0.02, () => true];
  const wireBudget: WireArgs = [[[[20, 15], [200, 15]], [[20, 35], [200, 35]]], findex, fopts, () => 0, () => true, (_x, y) => Math.abs(y), 40, 500];
  return {
    opts, index, barriers,
    ground: ((x, y) => 3 + x * 0.03 + y * 0.05) as Height,
    clear: (x: number) => !(x > 10 && x < 13), // a side street at x 10..13
    cover: (_x: number, y: number) => Math.abs(y) * 1.5,
    wireBoundary, wireMixed, wireBudget,
    box: [[3, 4] as Vec2, 0.1, -0.02, 1.25, ((x, y) => x * 0.1 + y * 0.2) as Height] as const,
    ribbon: [[0, 0] as Vec2, [4, 1] as Vec2, 1.0, 1.3, 0.025] as const,
  };
}
