// A roundabout on the route, and the ring helpers (docs/specs/old-build-tests.md, part B).

import { beforeAll, describe, expect, it } from "vitest";
import { buildTrack, type TrackResult } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import { LocalProjection, type LngLat, type Vec2 } from "../src/core/geo";
import { readKn5, type Kn5MeshNode, type Kn5Node } from "../src/core/kn5";
import { buildRingMarkings, buildRingMeshes, fitCircle, innerRadius, outerRadius, resolveRoundabouts, ringHeight, ringsOnRoute, type Roundabout } from "../src/core/roundabout";
import { readFastLaneAi, type AiPoint } from "../src/core/aiSpline";
import { aiHintsIni } from "../src/core/aiLine";
import { withDefaults } from "../src/core/options";

const proj = new LocalProjection([116.05, -31.9]);
const deg = (a: number) => (a * Math.PI) / 180;
const circle = (c: Vec2, r: number, from: number, to: number, n: number): Vec2[] =>
  Array.from({ length: n }, (_, i) => { const a = from + ((to - from) * i) / (n - 1); return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]; });
const meshesOf = (n: Kn5Node): Kn5MeshNode[] => (n.kind === "mesh" ? [n] : n.children.flatMap(meshesOf));
/** Mesh vertices as local [east, north, up]. */
const verts = (m: Kn5MeshNode): [number, number, number][] =>
  Array.from({ length: m.positions.length / 3 }, (_, i) => [m.positions[i * 3], -m.positions[i * 3 + 2], m.positions[i * 3 + 1]]);
/** Smallest angle between two directions, radians. */
const angleApart = (a: number, b: number) => { const d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };

// The ring sits at (400, 0), radius 15. The route comes in from the west, goes clockwise over the
// north side and leaves to the east.
const C: Vec2 = [400, 0], R = 15;
const arc = circle(C, R, Math.PI, 0, 13);
const routePts: Vec2[] = [...Array.from({ length: 26 }, (_, i): Vec2 => [i * 15, 0]), ...arc.slice(1), ...Array.from({ length: 19 }, (_, i): Vec2 => [430 + i * 15, 0])];
const hint = { location: proj.toLngLat(arc[0]), arc: arc.map((p) => proj.toLngLat(p)) };

describe("fitting and choosing the ring", () => {
  it("fits a circle to an arc", () => {
    const fit = fitCircle(circle([-4, 7], 22, deg(10), deg(130), 13))!;
    expect(fit.c[0]).toBeCloseTo(-4, 3);
    expect(fit.c[1]).toBeCloseTo(7, 3);
    expect(fit.r).toBeCloseTo(22, 3);
  });

  it("takes the OSM ring, then the driven arc, then a 12 m guess to the right", () => {
    const osm: LngLat[] = circle(C, 19, 0, deg(330), 12).map((p) => proj.toLngLat(p));
    expect(resolveRoundabouts([hint], [{ pts: osm }], proj)[0].r).toBeCloseTo(19, 1);
    expect(resolveRoundabouts([hint], [{ pts: osm, lanes: 2 }], proj)[0].lanes).toBe(2);
    expect(resolveRoundabouts([hint], [], proj)[0].r).toBeCloseTo(R, 1);
    const east = { location: proj.toLngLat([0, 0]), arc: [proj.toLngLat([0, 0]), proj.toLngLat([4, 0])] };
    const guess = resolveRoundabouts([east], [], proj)[0];
    expect(guess.r).toBe(12);
    expect(guess.c[0]).toBeCloseTo(0, 0);
    expect(guess.c[1]).toBeCloseTo(-12, 1);
  });
});

describe("a route through a hinted roundabout", () => {
  let r: TrackResult;
  let meshes: Kn5MeshNode[];
  let rb: Roundabout;
  const named = (name: string) => meshes.find((m) => m.name === name);

  beforeAll(async () => {
    r = await buildTrack(routePts.map((p) => proj.toLngLat(p)), { name: "Ring Road", corridor: 50, horizon: 0, imageryZoom: 0, trees: 0, buildings: false }, {
      dem: async (p, bounds, zoom) => DemGrid.fromFunction(p, zoom, bounds, (x) => 40 + 0.015 * x).sample,
      roundabouts: [hint],
    });
    meshes = meshesOf(readKn5(r.files[`${r.slug}/${r.slug}.kn5`]).root);
    rb = r.plan.roundabouts[0];
  }, 300_000);

  it("drives round the circle instead of making a hairpin", () => {
    expect(r.plan.roundabouts).toHaveLength(1);
    expect(rb.r).toBeCloseTo(R, 0);
    const round = r.plan.samples.filter((s) => s.s > rb.sIn && s.s < rb.sOut);
    expect(round.length).toBeGreaterThan(15);
    for (const s of round) {
      expect(Math.abs(Math.hypot(s.pos[0] - rb.c[0], s.pos[1] - rb.c[1]) - rb.r)).toBeLessThan(0.3);
      expect(Math.abs(s.curvature)).toBeLessThan(0.1);
    }
  });

  it("builds the whole ring, the island, the verge, the wall and two connectors", () => {
    for (const n of ["1ROAD_RB0", "1GRASS_RBISLAND0", "1GRASS_RBVERGE0", "1WALL_RB0"]) expect(named(n), n).toBeDefined();
    const ring = named("1ROAD_RB0")!;
    expect(verts(ring).some(([, y]) => y < rb.c[1] - 10)).toBe(true);
    for (let i = 1; i < ring.normals.length; i += 3) expect(ring.normals[i]).toBeGreaterThan(0.99);
    expect(meshes.filter((m) => m.name.startsWith("1ROAD_RBC0_"))).toHaveLength(2);
  });

  it("kerbs the ring in town, dropping the kerb where the route crosses and across a wide entry", () => {
    const edge = ringHeight(rb, outerRadius(rb));
    const plain = buildRingMeshes({ ...rb, kerbed: true }, 0, withDefaults({}), "road");
    expect(plain.kerb.map((m) => m.name)).toEqual(["1ROAD_RBGUTTER0", "1KERB_RB0"]);
    const kerb = verts(plain.kerb[1]);
    expect(Math.max(...kerb.map(([, , z]) => z)) - edge).toBeCloseTo(0.15, 3);
    for (const a of rb.crossings) {
      const at: Vec2 = [rb.c[0] + Math.cos(a) * (outerRadius(rb) + 0.4), rb.c[1] + Math.sin(a) * (outerRadius(rb) + 0.4)];
      for (const [x, y, z] of kerb) if (Math.hypot(x - at[0], y - at[1]) < 1) expect(z - edge).toBeLessThan(0.02);
    }
    const a = rb.crossings[0], half = deg(25);
    const wide = buildRingMeshes({ ...rb, kerbed: true, openings: [[a - half, a + half]] }, 0, withDefaults({}), "road");
    for (const [x, y, z] of verts(wide.kerb.find((m) => m.name.startsWith("1KERB_"))!)) {
      if (angleApart(Math.atan2(y - rb.c[1], x - rb.c[0]), a) < half - 0.01) expect(z - edge).toBeLessThan(0.02);
    }
  });

  it("ends the straight road at the ring", () => {
    for (const m of meshes.filter((m) => /^1ROAD_\d/.test(m.name))) {
      const v = verts(m);
      for (let t = 0; t < m.indices.length; t += 3) {
        const [p, q, s] = [v[m.indices[t]], v[m.indices[t + 1]], v[m.indices[t + 2]]];
        const cx = (p[0] + q[0] + s[0]) / 3, cy = (p[1] + q[1] + s[1]) / 3;
        expect(Math.hypot(cx - rb.c[0], cy - rb.c[1])).toBeGreaterThan(outerRadius(rb) - 1);
      }
    }
  });

  it("paints give-way dashes across the entering half of a joining road", () => {
    expect(rb.lanes).toBe(1);
    expect(named("MARKINGS_RB0")).toBeDefined();
    const paint = buildRingMarkings({ ...rb, openings: [[-0.6, 0.6]] }, 0)!;
    const Ro = outerRadius(rb);
    for (const [x, y, z] of verts(paint)) {
      const dx = x - rb.c[0], dy = y - rb.c[1];
      expect(dy).toBeLessThan(0.01);
      expect(Math.hypot(dx, dy)).toBeGreaterThan(Ro - 0.45);
      expect(z - ringHeight(rb, Math.hypot(dx, dy))).toBeCloseTo(0.015, 3);
    }
    for (let i = 1; i < paint.normals.length; i += 3) expect(paint.normals[i]).toBeGreaterThan(0.99);
    // 0.6 m on, 0.6 m off, from 2.5 m in to the middle of the joining road (about 0.6 x Ro here).
    expect(paint.indices.length / 6).toBeGreaterThanOrEqual(Math.floor((0.6 * Ro - 2.5) / 1.2) - 1);
  });

  it("puts a broken lane line round a two-lane ring", () => {
    const two: Roundabout = { ...rb, w: 9.2, lanes: 2, openings: [], crossings: [] };
    const line = buildRingMarkings(two, 0)!;
    const v = verts(line);
    expect(v.length).toBeGreaterThan(0);
    for (const [x, y] of v) expect(Math.abs(Math.hypot(x - rb.c[0], y - rb.c[1]) - rb.r)).toBeLessThan(0.06);
    let area = 0;
    for (let t = 0; t < line.indices.length; t += 3) {
      const [p, q, s] = [v[line.indices[t]], v[line.indices[t + 1]], v[line.indices[t + 2]]];
      area += Math.abs((q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0])) / 2;
    }
    // A 0.1 m line, 3 m on and 6 m off: about a third of the way round.
    const share = area / (2 * Math.PI * rb.r * 0.1);
    expect(share).toBeGreaterThan(0.28);
    expect(share).toBeLessThan(0.36);
  });

  it("gives the AI a smooth line round the ring, clear of the island", () => {
    const ai = readFastLaneAi(r.files[`${r.slug}/ai/fast_lane.ai`]);
    const pts: Vec2[] = ai.map((p: AiPoint) => [p.position[0], -p.position[2]]);
    let sharpest = 0;
    for (let i = 1; i + 1 < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - rb.c[0], pts[i][1] - rb.c[1]);
      if (d < outerRadius(rb)) expect(d).toBeGreaterThan(innerRadius(rb) + 1.4);
      if (d > outerRadius(rb) + 20) continue;
      const h1 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
      const h2 = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
      sharpest = Math.max(sharpest, angleApart(h1, h2));
    }
    expect(sharpest).toBeLessThan(0.35);
  });
});

describe("rings the route crosses with no routing hint", () => {
  const road: Vec2[] = Array.from({ length: 101 }, (_, i) => [i * 2 - 100, -8]);

  it("finds a small ring from its two halves", () => {
    const found = ringsOnRoute([circle([0, 0], 10, 0, Math.PI, 20), circle([0, 0], 10, Math.PI, 2 * Math.PI, 20)], road, []);
    expect(found).toHaveLength(1);
    expect(found[0].r).toBeCloseTo(10, 0);
  });

  it("skips a ring off the route, a curved arm and a ring it already has", () => {
    expect(ringsOnRoute([circle([0, 70], 10, 0, 2 * Math.PI, 24)], road, [])).toHaveLength(0);
    expect(ringsOnRoute([circle([0, 0], 10, 0, Math.PI / 2, 10)], road, [])).toHaveLength(0);
    expect(ringsOnRoute([circle([0, 0], 10, 0, 2 * Math.PI, 24)], road, [{ c: [0.5, 0], r: 10 }])).toHaveLength(0);
  });
});

describe("AI hints", () => {
  // 1 km of straight road with one 15 m corner halfway.
  const line = Array.from({ length: 100 }, (_, i) => ({ distance: i * 10, length: 10, radius: i === 50 ? 15 : 1000 })) as unknown as AiPoint[];
  const values = (ini: string) => [...ini.matchAll(/^VALUE=([\d.]+)$/gm)].map((m) => Number(m[1]));

  it("keeps the lower of a town limit and the corner, and crawls at an open end", () => {
    const town = values(aiHintsIni(line, () => 50));
    expect(town).toContain(0.5);
    expect(town).not.toContain(0.6);
    expect(values(aiHintsIni(line, () => 100))).toContain(0.6);
    expect(values(aiHintsIni(line, () => 100, true))).toContain(0.15);
    expect(values(aiHintsIni(line, () => 100))).not.toContain(0.15);
  });

  it("lets a ring's pace replace the street's (retest 7: 0.35 under a 50 zone made the AI crawl)", () => {
    const extra = line.map((_, i) => (i >= 48 && i <= 52 ? 0.7 : 1));
    const ini = aiHintsIni(line, () => 50, false, extra);
    expect(values(ini)).toContain(0.7);
    expect(values(ini)).toContain(0.5);
    expect(Math.min(...values(ini))).toBe(0.5);
  });
});
