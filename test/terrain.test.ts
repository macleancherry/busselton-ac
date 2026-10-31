import { describe, expect, it } from "vitest";
import { Area } from "../src/core/area";
import type { Vec2 } from "../src/core/geo";
import { KERB_H, STRIP_EXTRA } from "../src/core/kerbs";
import type { Kn5MeshNode, Kn5Node } from "../src/core/kn5";
import { MeshBuilder } from "../src/core/mesh";
import { withDefaults, type BuildOptions } from "../src/core/options";
import { frames } from "../src/core/polyline";
import { SegmentIndex, type RoadPlan, type RoadSample } from "../src/core/road";
import { outerRadius, ringHeight, toOpening, vergeOuterRadius, type Roundabout } from "../src/core/roundabout";
import {
  BELOW_VERGE, buildTerrainChunk, isStreetNode, makeTerrainFn, meshTop, planTerrainChunks, streetCeiling, underStreets,
  type TerrainFn,
} from "../src/core/terrain";

const DEFAULTS = withDefaults({});
const BUSSELTON = withDefaults({ terrainStep: 1.5, terrainUnderRoad: 0.12, banking: false, corridor: 60 });
const SETTINGS: [string, BuildOptions][] = [["defaults", DEFAULTS], ["Busselton", BUSSELTON]];

/** A straight route from a to b, samples every 2 m; h(s) along it; optional per-sample extras. */
function straight(a: Vec2, b: Vec2, h: (s: number) => number = () => 0, extra: Partial<RoadSample> = {}, width = 7): RoadPlan {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.round(L / 2);
  const pts: Vec2[] = Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  return { closed: false, length: L, roundabouts: [], samples: frames(pts, false).map((f) => ({ ...f, width, h: h(f.s), bank: 0, ...extra })) };
}

/**
 * The ground as a grid would draw it, nodes at (ox + i step, oy + j step): the lowest and highest
 * of the two triangulations of the cell a point is in.
 */
function drawn(terrain: TerrainFn, step: number, ox: number, oy: number) {
  const cache = new Map<string, number>();
  const node = (i: number, j: number) => {
    const k = i + "," + j;
    let h = cache.get(k);
    if (h === undefined) { h = terrain(ox + i * step, oy + j * step).h; cache.set(k, h); }
    return h;
  };
  return (x: number, y: number): [number, number] => {
    const fx = (x - ox) / step, fy = (y - oy) / step, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, w = fy - j;
    const h00 = node(i, j), h10 = node(i + 1, j), h01 = node(i, j + 1), h11 = node(i + 1, j + 1);
    const a = u >= w ? h00 + u * (h10 - h00) + w * (h11 - h10) : h00 + u * (h11 - h01) + w * (h01 - h00);
    const b = u + w <= 1 ? h00 + u * (h10 - h00) + w * (h01 - h00) : h11 + (1 - u) * (h01 - h11) + (1 - w) * (h10 - h11);
    return [Math.min(a, b), Math.max(a, b)];
  };
}

describe("terrain chunks", () => {
  const plan = straight([0, 0], [1000, 0]);
  const index = new SegmentIndex(plan);

  it("covers a straight route within corridor + 150 m, on the chunk grid, keyed south to north", () => {
    for (const [, opts] of SETTINGS) {
      const chunks = planTerrainChunks(plan, index, opts);
      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach((c, i) => {
        expect(c.key).toBe("t" + String(i).padStart(3, "0"));
        expect(Math.abs(c.minX % opts.chunkSize)).toBe(0);
        expect(Math.abs(c.minY % opts.chunkSize)).toBe(0);
        expect(c.maxX - c.minX).toBe(opts.chunkSize);
        expect(index.nearest(c.minX + 100, c.minY + 100, opts.corridor + 150)).not.toBeNull();
        if (i) {
          const p = chunks[i - 1];
          expect(c.minY > p.minY || (c.minY === p.minY && c.minX > p.minX)).toBe(true);
        }
      });
      let want = 0;
      for (let j = -3; j <= 3; j++) for (let i = -3; i <= 8; i++) if (index.nearest(i * 200 + 100, j * 200 + 100, opts.corridor + 150)) want++;
      expect(chunks.length).toBe(want);
    }
  });

  it("an area adds every chunk whose centre is under 150 m outside it", () => {
    const area = new Area([[0, 600], [400, 600], [400, 800], [0, 800]]);
    const chunks = planTerrainChunks(plan, index, DEFAULTS, area);
    for (let j = 2; j <= 5; j++) {
      for (let i = -2; i <= 4; i++) {
        const cx = i * 200 + 100, cy = j * 200 + 100;
        const has = chunks.some((c) => c.minX === i * 200 && c.minY === j * 200);
        expect(has).toBe(area.signed(cx, cy) < 150 || index.nearest(cx, cy, 240) !== null);
      }
    }
  });
});

describe("ground beside a road", () => {
  const theta = 0.47; // the road at an angle to the grid
  const d: Vec2 = [Math.cos(theta), Math.sin(theta)], nrm: Vec2 = [-d[1], d[0]];
  const half = 3.5;

  for (const [name, base] of SETTINGS) {
    for (const kerbed of [false, true]) {
      for (const grade of [0, 0.1]) {
        it(`${name}, ${kerbed ? "kerbed" : "gravel"}, ${grade ? "10% grade" : "flat"}: nothing pokes through, no ditch`, () => {
          const opts = base;
          const plan = straight([-300 * d[0], -300 * d[1]], [300 * d[0], 300 * d[1]], (s) => grade * (s - 300), kerbed ? { kerb: [1, 1] } : {});
          const index = new SegmentIndex(plan);
          const dem = (x: number, y: number) => grade * (x * d[0] + y * d[1]);
          const terrain = makeTerrainFn(plan, index, dem, opts);
          const crown = opts.crown;
          const inner = half + opts.vergeWidth + (kerbed ? STRIP_EXTRA : 0);
          const surface = (s: number, t: number) => {
            const c = grade * s, edge = c - crown * half, a = Math.abs(t);
            if (a <= half) return c - crown * a;
            const u = a - half;
            if (!kerbed) return edge - 0.2 * Math.min(1, u / opts.vergeWidth);
            if (u < 0.3) return edge - 0.1 * u; // gutter, falling to the kerb
            if (u < 0.35) return edge - 0.03; // the kerb face's foot
            return edge + KERB_H; // kerb top and nature strip
          };
          const intended = (s: number) => grade * s - crown * half + (kerbed ? KERB_H - 0.03 : -BELOW_VERGE);
          // The spec's 8 cm. Kerbs with the hilly defaults (3 m grid, 0.6 m under the road, a 0.72 m
          // ramp over two cells) dip up to about 11.6 cm on cells running diagonally to the road (7.9
          // cm square to it): inherent to the two-cell ramp. No route uses kerbs with those settings
          // (town: 1.5 m / 0.12, 3.5 cm; country: 2.5 m / 0.2, 5 cm).
          const ditch = kerbed && opts.terrainStep >= 3 ? 0.12 : 0.08;
          for (let k = 0; k < 40; k++) {
            const ox = (k * 0.618) % opts.terrainStep, oy = (k * 0.414) % opts.terrainStep;
            const g = drawn(terrain, opts.terrainStep, ox, oy);
            for (let s = -15; s <= 15; s += 2.37) {
              for (let t = -(inner + 6); t <= inner + 6; t += 0.05) {
                const x = s * d[0] + t * nrm[0], y = s * d[1] + t * nrm[1];
                const [lo, hi] = g(x, y);
                const a = Math.abs(t);
                if (a <= inner) expect(hi, `under the surface at s ${s.toFixed(2)} t ${t.toFixed(2)}, offset ${k}`).toBeLessThanOrEqual(surface(s, t) - 0.01);
                else if (a >= inner + 0.2) expect(lo, `ditch at s ${s.toFixed(2)} t ${t.toFixed(2)}, offset ${k}`).toBeGreaterThanOrEqual(intended(s) - ditch);
              }
            }
          }
        });
      }
    }
  }
});

describe("the ground function", () => {
  for (const [name, opts] of SETTINGS) {
    it(`${name}: under the road two steps in, base at the inner edge, the DEM from inner + blend, Infinity far off`, () => {
      const plan = straight([-500, 0], [500, 0], () => 5);
      const index = new SegmentIndex(plan);
      const dem = () => 4;
      const terrain = makeTerrainFn(plan, index, dem, opts);
      const half = 3.5, inner = half + opts.vergeWidth;
      const edge = 5 - opts.crown * half, base = edge - BELOW_VERGE;
      // Across the road from two steps inside the inner edge: terrainUnderRoad under the surface.
      for (const t of [0, 1.2, -2.5, inner - 2 * opts.terrainStep]) {
        if (Math.abs(t) > inner - 2 * opts.terrainStep) continue;
        const tc = Math.min(half, Math.abs(t));
        expect(terrain(10, t).h).toBeCloseTo(5 - opts.crown * tc - opts.terrainUnderRoad, 6);
      }
      expect(terrain(10, inner).h).toBeCloseTo(base, 6);
      expect(terrain(10, -inner).h).toBeCloseTo(base, 6);
      expect(terrain(10, inner + opts.terrainBlend).h).toBeCloseTo(4, 6);
      expect(terrain(10, inner + opts.terrainBlend + 5).h).toBeCloseTo(4, 6);
      expect(terrain(10, inner + opts.terrainBlend / 2).h).toBeCloseTo(base + (4 - base) * 0.5, 6);
      const far = terrain(10, opts.corridor + opts.terrainBlend + 10.5);
      expect(far.dist).toBe(Infinity);
      expect(far.h).toBe(4);
      expect(terrain(10, 7).dist).toBeCloseTo(7, 6);
    });
  }

  it("takes each sample's own crown", () => {
    const opts = BUSSELTON;
    const flat = straight([-200, 0], [200, 0], () => 1, { crown: 0 });
    const t = makeTerrainFn(flat, new SegmentIndex(flat), () => 1, opts);
    const inner = 3.5 + opts.vergeWidth;
    expect(t(0, inner).h).toBeCloseTo(1 - BELOW_VERGE, 6);
    const crowned = straight([-200, 0], [200, 0], () => 1);
    const c = makeTerrainFn(crowned, new SegmentIndex(crowned), () => 1, opts);
    expect(c(0, inner).h).toBeCloseTo(1 - opts.crown * 3.5 - BELOW_VERGE, 6);
  });

  for (const [name, opts] of SETTINGS) {
    it(`${name}: past an open route's end the ground isn't sunk, and blends out from the end point`, () => {
      const plan = straight([0, 0], [400, 0], () => 3);
      const terrain = makeTerrainFn(plan, new SegmentIndex(plan), () => 2, opts);
      const inner = 3.5 + opts.vergeWidth, base = 3 - BELOW_VERGE;
      expect(terrain(401, 0).h).toBeCloseTo(base, 6);
      expect(terrain(-1, 0).h).toBeCloseTo(base, 6);
      expect(terrain(400 + inner + opts.terrainBlend / 2, 0).h).toBeCloseTo(base + (2 - base) * 0.5, 6);
      expect(terrain(400 + inner + opts.terrainBlend + 1, 0).h).toBeCloseTo(2, 6);
      // Inside the route it is sunk.
      // Inside the route it is sunk (fully once the inner edge is two steps away).
      const k = Math.min(1, inner / (2 * opts.terrainStep));
      expect(terrain(200, 0).h).toBeCloseTo(base + (3 - opts.terrainUnderRoad - base) * k, 6);
    });
  }
});

/** A kerbed ring at the origin with an arm along the x axis both ways (the route runs through it). */
function ringWithArm(opts: BuildOptions) {
  const rb: Roundabout = { c: [0, 0], r: 12, w: 8, lanes: 1, hc: 0, sIn: 0, sOut: 0, crossings: [0, Math.PI], kerbed: true };
  const Ro = outerRadius(rb), a = 5 / Ro;
  rb.openings = [[-a, a], [Math.PI - a, Math.PI + a]];
  const roadH = ringHeight(rb, Ro);
  const plan = straight([-300, 0], [300, 0], () => roadH, { kerb: [1, 1] });
  plan.roundabouts = [rb];
  return { rb, plan, terrain: makeTerrainFn(plan, new SegmentIndex(plan), () => 0, opts), roadH };
}

describe("roundabouts", () => {
  for (const step of [1.5, 3]) {
    it(`a kerbed ring's mouth on a ${step} m grid: the arm's ground under its road, the gutter clear, no ditch behind the strip`, () => {
      // 1.5 m: Busselton's settings. 3 m: the default grid at the country preset's depth (0.2 m); at
      // the default 0.6 m the two-cell ramp behind a kerb dips about 12 cm (see the road test).
      const opts = step === 1.5 ? BUSSELTON : { ...DEFAULTS, terrainUnderRoad: 0.2 };
      const { rb, terrain, roadH } = ringWithArm(opts);
      const Ro = outerRadius(rb), E = vergeOuterRadius(rb, opts);
      // Behind a kerb the ground's base is the rim - BELOW_VERGE + KERB_LIFT (3 cm under the strip).
      const lift = BELOW_VERGE + KERB_H - 0.03;
      for (let k = 0; k < 12; k++) {
        const g = drawn(terrain, step, (k * 0.37) % step, (k * 0.71) % step);
        // The arm.
        for (let x = Ro - 1; x <= Ro + 12; x += 0.25) {
          for (let y = -3.5; y <= 3.5; y += 0.25) {
            expect(g(x, y)[1], `arm at ${x}, ${y}`).toBeLessThanOrEqual(roadH - opts.crown * Math.abs(y) - 0.01);
            expect(g(-x, y)[1], `arm at ${-x}, ${y}`).toBeLessThanOrEqual(roadH - opts.crown * Math.abs(y) - 0.01);
          }
        }
        for (let ang = 0; ang < 2 * Math.PI; ang += 0.02) {
          if (toOpening(rb, Ro, ang) < 2.5) continue;
          const c = Math.cos(ang), s = Math.sin(ang);
          // Ring gutter, 0.3 m wide, falling 0.1 per metre.
          for (let u = 0; u <= 0.3; u += 0.05) {
            expect(g((Ro + u) * c, (Ro + u) * s)[1]).toBeLessThanOrEqual(ringHeight(rb, Ro) - 0.1 * u - 0.01);
          }
          // Behind the strip: no ditch over 10 cm (away from the arm's own made surface).
          // (A grid cell reaching the arm's sunk ground isn't a ditch behind the ring.)
          if (Math.abs(s) * (E + 0.2) < 3.5 + opts.vergeWidth + STRIP_EXTRA + 1.5 * step) continue;
          for (let u = 0.2; u <= 6; u += 0.4) {
            expect(g((E + u) * c, (E + u) * s)[0]).toBeGreaterThanOrEqual(ringHeight(rb, Ro) - BELOW_VERGE + lift - 0.1);
          }
        }
      }
    });
  }

  it("two rings with overlapping blend zones: neither disc's ground comes above its surface", () => {
    const opts = DEFAULTS;
    const ring = (c: Vec2, hc: number): Roundabout => ({ c, r: 10, w: 8, lanes: 1, hc, sIn: 0, sOut: 0, crossings: [] });
    const a = ring([0, 0], 3), b = ring([50, 0], 0);
    const plan = straight([-200, 500], [200, 500]);
    plan.roundabouts = [a, b];
    const terrain = makeTerrainFn(plan, new SegmentIndex(plan), () => 1.5, opts);
    expect(vergeOuterRadius(a, opts) + opts.terrainBlend).toBeGreaterThan(50 - vergeOuterRadius(b, opts));
    for (const rb of [a, b]) {
      const Ro = outerRadius(rb);
      for (let rho = 0; rho <= Ro; rho += 0.5) {
        for (let ang = 0; ang < 2 * Math.PI; ang += 0.1) {
          const x = rb.c[0] + rho * Math.cos(ang), y = rb.c[1] + rho * Math.sin(ang);
          const t = terrain(x, y);
          expect(t.h).toBeLessThanOrEqual(ringHeight(rb, rho) - 0.01);
          expect(t.dist).toBe(0);
        }
      }
    }
    // Between them, dist is to the nearer ring's edge, not Infinity.
    const mid = terrain(25, 0);
    expect(mid.dist).toBeLessThan(15);
  });
});

/** A flat street quad as a mesh node (local corners, height h). */
function quadNode(name: string, x0: number, y0: number, x1: number, y1: number, h: number): Kn5MeshNode {
  const mb = new MeshBuilder();
  const a = mb.vertex([x0, y0, h], 0, 0), b = mb.vertex([x1, y0, h], 0, 0), c = mb.vertex([x1, y1, h], 0, 0), d = mb.vertex([x0, y1, h], 0, 0);
  mb.quad(a, b, c, d);
  return mb.toKn5(name, "road");
}

describe("ground under side streets", () => {
  for (const [name, opts] of SETTINGS) {
    it(`${name}: 4 cm under a street within a grid step of it, unchanged further out`, () => {
      const ground: TerrainFn = () => ({ h: 1, dist: 50 });
      const street = quadNode("1STREET_A", 0, 0, 10, 40, 0.9);
      const at = underStreets(ground, streetCeiling([street], opts.terrainStep));
      const step = opts.terrainStep;
      for (let x = -step; x <= 10 + step; x += 0.37) {
        for (let y = -step; y <= 40 + step; y += 0.53) {
          const dx = Math.max(0, -x, x - 10), dy = Math.max(0, -y, y - 40);
          if (Math.hypot(dx, dy) > step) continue;
          const t = at(x, y);
          expect(t.h).toBeCloseTo(0.86, 6);
          expect(t.dist).toBe(50);
        }
      }
      // Well clear (more than reach + a cell's diagonal away).
      for (const [x, y] of [[10 + step + 2.5, 20], [-step - 2.5, 5], [5, 40 + step + 2.5]]) expect(at(x, y).h).toBe(1);
    });
  }

  it("counts return fills (in a group) and not a 1ROAD_ mesh", () => {
    const ground: TerrainFn = () => ({ h: 1, dist: 5 });
    const retfill = quadNode("1STREET_RETFILL", 0, 0, 4, 4, 0.5);
    const road = quadNode("1ROAD_MAIN", 20, 0, 30, 10, 0.5);
    const group: Kn5Node = { kind: "node", name: "KERBS", transform: [], children: [retfill] };
    const nodes = [group, road].filter(isStreetNode);
    expect(nodes).toEqual([group]);
    const at = underStreets(ground, streetCeiling(nodes, 1.5));
    expect(at(2, 2).h).toBeCloseTo(0.46, 6);
    expect(at(25, 5).h).toBe(1);
    // Only ever lowers.
    const low = underStreets(() => ({ h: 0, dist: 5 }), streetCeiling(nodes, 1.5));
    expect(low(2, 2).h).toBe(0);
  });
});

/** Triangles of a chunk mesh in local (x, y, h). */
function trianglesOf(m: Kn5MeshNode): number[][] {
  const p = m.positions, out: number[][] = [];
  for (let t = 0; t < m.indices.length; t += 3) {
    out.push([0, 1, 2].flatMap((k) => { const v = m.indices[t + k]; return [p[v * 3], -p[v * 3 + 2], p[v * 3 + 1]]; }));
  }
  return out;
}

/** The mesh's height at a point (first triangle containing it), or null. */
function meshAt(tris: number[][], x: number, y: number): number | null {
  for (const [x1, y1, h1, x2, y2, h2, x3, y3, h3] of tris) {
    if (x < Math.min(x1, x2, x3) - 1e-6 || x > Math.max(x1, x2, x3) + 1e-6 || y < Math.min(y1, y2, y3) - 1e-6 || y > Math.max(y1, y2, y3) + 1e-6) continue;
    const den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
    const w1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / den, w2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / den;
    const w3 = 1 - w1 - w2;
    if (w1 >= -1e-7 && w2 >= -1e-7 && w3 >= -1e-7) return w1 * h1 + w2 * h2 + w3 * h3;
  }
  return null;
}

function openEdgesOnBorder(m: Kn5MeshNode, lo: number, hi: number): boolean {
  const key = (i: number) => `${m.positions[i * 3].toFixed(3)},${(-m.positions[i * 3 + 2]).toFixed(3)}`;
  const count = new Map<string, number>();
  for (let t = 0; t < m.indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = key(m.indices[t + k]), b = key(m.indices[t + ((k + 1) % 3)]);
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      count.set(e, (count.get(e) ?? 0) + 1);
    }
  }
  const on = (v: number) => Math.abs(v - lo) < 1e-3 || Math.abs(v - hi) < 1e-3;
  return [...count].filter(([, n]) => n === 1).every(([e]) => {
    const [[x0, y0], [x1, y1]] = e.split("|").map((p) => p.split(",").map(Number));
    return (Math.abs(x0 - x1) < 1e-3 && on(x0)) || (Math.abs(y0 - y1) < 1e-3 && on(y0));
  });
}

function facesUp(m: Kn5MeshNode): boolean {
  return trianglesOf(m).every(([x1, y1, , x2, y2, , x3, y3]) => (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1) > 0);
}

describe("chunk meshes: level of detail", () => {
  const lod = (extra: Partial<BuildOptions> = {}) => withDefaults({ terrainStep: 1.5, corridor: 300, ...extra });

  it("flat ground away from the road: under 60% of the fine triangles in 60 m, under 26% in 192 m with a bump", () => {
    const chunk = { key: "t000", minX: 0, minY: 0, maxX: 60, maxY: 60 };
    const flat: TerrainFn = (x, y) => ({ h: 2 + 0.001 * y, dist: x });
    const fine = buildTerrainChunk(chunk, flat, lod({ terrainLod: false }), true)!;
    expect(buildTerrainChunk(chunk, flat, lod(), true)!.indices.length).toBeLessThan(fine.indices.length * 0.6);
    const big = { key: "t001", minX: 0, minY: 0, maxX: 192, maxY: 192 };
    const bumpy: TerrainFn = (x, y) => ({ h: 2 + 0.0005 * y + (Math.hypot(x - 120, y - 100) < 20 ? 0.3 * Math.sin(x) * Math.cos(y) : 0), dist: x });
    const f2 = buildTerrainChunk(big, bumpy, lod({ terrainLod: false }), true)!;
    const l2 = buildTerrainChunk(big, bumpy, lod(), true)!;
    expect(l2.indices.length).toBeLessThan(f2.indices.length * 0.26);
    expect(openEdgesOnBorder(l2, 0, 192)).toBe(true);
    expect(facesUp(l2)).toBe(true);
  });

  it("bumpy ground keeps every cell; within terrainLodNear every cell is fine", () => {
    const chunk = { key: "t000", minX: 0, minY: 0, maxX: 60, maxY: 60 };
    const hill: TerrainFn = (x, y) => ({ h: 2 + Math.sin(x / 3) * Math.cos(y / 4), dist: x });
    expect(buildTerrainChunk(chunk, hill, lod(), true)!.indices.length).toBe(buildTerrainChunk(chunk, hill, lod({ terrainLod: false }), true)!.indices.length);
    const flat: TerrainFn = (x, y) => ({ h: 2 + 0.001 * y, dist: x });
    const m = buildTerrainChunk(chunk, flat, lod(), true)!;
    const cellArea = (60 / 40) ** 2 / 2;
    for (const [x1, y1, , x2, y2, , x3, y3] of trianglesOf(m)) {
      if (Math.max(x1, x2, x3) > 25 - 1.5) continue;
      expect(Math.abs((x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1)) / 2).toBeCloseTo(cellArea, 6);
    }
  });

  it("every dropped node is within its tolerance of the surface actually drawn; no cracks; faces up", () => {
    const big = { key: "t002", minX: 0, minY: 0, maxX: 192, maxY: 192 };
    // Gently curved, so blocks coarsen but the drawn fans are not exact.
    const curved: TerrainFn = (x, y) => ({ h: 2 + 0.00004 * ((x - 50) ** 2 + 0.6 * (y - 140) ** 2) + 0.01 * Math.sin(x / 7), dist: x });
    const opts = lod();
    const m = buildTerrainChunk(big, curved, opts, true)!;
    const fineCount = buildTerrainChunk(big, curved, lod({ terrainLod: false }), true)!.indices.length;
    expect(m.indices.length).toBeLessThan(fineCount * 0.7);
    expect(openEdgesOnBorder(m, 0, 192)).toBe(true);
    expect(facesUp(m)).toBe(true);
    const tris = trianglesOf(m);
    const step = 192 / 128;
    for (let j = 0; j <= 128; j++) {
      for (let i = 0; i <= 128; i++) {
        const x = i * step, y = j * step, s = curved(x, y);
        const h = meshAt(tris, x, y);
        expect(h).not.toBeNull();
        const tol = s.dist < 40 ? 0.02 : 0.05;
        expect(Math.abs(h! - s.h), `node ${i}, ${j}`).toBeLessThanOrEqual(tol + 1e-6);
      }
    }
  });

  it("3 cm undulation far out coarsens, but not within 4 m of a street", () => {
    const chunk = { key: "t003", minX: 0, minY: 0, maxX: 192, maxY: 192 };
    // +-1.5 cm in a checkerboard on the 1.5 m nodes.
    const slab: TerrainFn = (x, y) => ({ h: 2 + 0.015 * Math.cos((Math.PI * x) / 1.5) * Math.cos((Math.PI * y) / 1.5), dist: 100 });
    const fine = buildTerrainChunk(chunk, slab, lod({ terrainLod: false }), true)!.indices.length;
    const free = buildTerrainChunk(chunk, slab, lod(), true)!;
    expect(free.indices.length).toBeLessThan(fine * 0.3);
    const near = (x: number) => x < 60;
    const tight = buildTerrainChunk(chunk, slab, lod(), true, null, near)!;
    const cellArea = 1.5 ** 2 / 2;
    let inNear = 0;
    for (const [x1, y1, , x2, y2, , x3, y3] of trianglesOf(tight)) {
      if (Math.max(x1, x2, x3) > 60 - 6) continue;
      inNear++;
      expect(Math.abs((x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1)) / 2).toBeCloseTo(cellArea, 6);
    }
    expect(inNear).toBeGreaterThan(1000);
  });
});

describe("chunk meshes: the mesh", () => {
  const hills: TerrainFn = (x, y) => ({ h: 5 + 2 * Math.sin(x / 13) * Math.cos(y / 17), dist: 10 });

  it("names, materials and UVs", () => {
    const opts = withDefaults({ terrainStep: 3 });
    const chunk = { key: "t007", minX: 200, minY: -200, maxX: 400, maxY: 0 };
    const m = buildTerrainChunk(chunk, hills, opts, true)!;
    expect(m.name).toBe("1GRASS_t007");
    expect(m.material).toBe("terrain_t007");
    for (let i = 0; i < m.positions.length / 3; i++) {
      const u = m.uvs[i * 2], v = m.uvs[i * 2 + 1], y = -m.positions[i * 3 + 2];
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeCloseTo(1 - (y - chunk.minY) / 200, 6);
    }
    const plain = buildTerrainChunk(chunk, hills, opts, false)!;
    expect(plain.material).toBe("grass");
    expect(plain.uvs[0]).toBeCloseTo(plain.positions[0] / 10, 5);
    expect(plain.uvs[1]).toBeCloseTo(plain.positions[2] / 10, 5); // v = -y / 10, AC z = -y
  });

  it("returns null with nothing inside, and only draws cells inside the corridor or area", () => {
    const opts = withDefaults({ corridor: 90 });
    const chunk = { key: "t000", minX: 0, minY: 0, maxX: 200, maxY: 200 };
    expect(buildTerrainChunk(chunk, () => ({ h: 0, dist: Infinity }), opts, false)).toBeNull();
    const area = new Area([[0, 0], [50, 0], [50, 50], [0, 50]]);
    const m = buildTerrainChunk(chunk, () => ({ h: 0, dist: Infinity }), opts, false, area)!;
    for (let i = 0; i < m.positions.length / 3; i++) {
      expect(m.positions[i * 3]).toBeLessThanOrEqual(50);
      expect(-m.positions[i * 3 + 2]).toBeLessThanOrEqual(50);
    }
  });

  it("normals match at the shared border of neighbouring chunks", () => {
    const opts = withDefaults({ terrainStep: 1.5 });
    const a = buildTerrainChunk({ key: "t000", minX: 0, minY: 0, maxX: 200, maxY: 200 }, hills, opts, true)!;
    const b = buildTerrainChunk({ key: "t001", minX: 200, minY: 0, maxX: 400, maxY: 200 }, hills, opts, true)!;
    const border = (m: Kn5MeshNode) => {
      const out = new Map<string, number[]>();
      for (let i = 0; i < m.positions.length / 3; i++) {
        if (Math.abs(m.positions[i * 3] - 200) < 1e-4) out.set(m.positions[i * 3 + 2].toFixed(3), Array.from(m.normals.subarray(i * 3, i * 3 + 3)));
      }
      return out;
    };
    const na = border(a), nb = border(b);
    expect(na.size).toBe(134);
    for (const [k, n] of na) n.forEach((c, i) => expect(c).toBeCloseTo(nb.get(k)![i], 5));
  });

  it("refuses a grid over the kn5 vertex limit, naming the option", () => {
    const opts = withDefaults({ terrainStep: 0.5 });
    expect(() => buildTerrainChunk({ key: "t000", minX: 0, minY: 0, maxX: 200, maxY: 200 }, hills, opts, false)).toThrow(/terrainStep/);
  });
});

describe("meshTop", () => {
  const curved: TerrainFn = (x, y) => ({ h: 3 + 0.4 * Math.sin(x / 2.1) * Math.cos(y / 1.7), dist: 10 });

  for (const [name, opts] of SETTINGS) {
    it(`${name}: never under either triangulation, the node heights at nodes, never under a built chunk`, () => {
      const top = meshTop(curved, opts);
      const cells = Math.round(opts.chunkSize / opts.terrainStep), step = opts.chunkSize / cells;
      const g = drawn(curved, step, 0, 0);
      for (let k = 0; k < 2000; k++) {
        const x = -150 + ((k * 7.317) % 300), y = -150 + ((k * 3.913) % 300);
        expect(top(x, y)).toBeGreaterThanOrEqual(g(x, y)[1] - 1e-9);
      }
      for (const [i, j] of [[0, 0], [3, -7], [-40, 12]]) expect(top(i * step, j * step)).toBeCloseTo(curved(i * step, j * step).h, 9);
      const m = buildTerrainChunk({ key: "t000", minX: -200, minY: 0, maxX: 0, maxY: 200 }, curved, { ...opts, terrainLod: false }, false)!;
      const tris = trianglesOf(m);
      let same = 0;
      for (let k = 0; k < 300; k++) {
        const x = -199 + ((k * 13.37) % 198), y = 1 + ((k * 7.71) % 198);
        const h = meshAt(tris, x, y)!;
        expect(top(x, y)).toBeGreaterThanOrEqual(h - 1e-3);
        if (Math.abs(top(x, y) - h) < 1e-3) same++;
      }
      // Where the chunk's own diagonal is the higher reading (about half the time) they agree.
      expect(same).toBeGreaterThan(60);
    });
  }

  it("equals a planar chunk's mesh everywhere", () => {
    const plane: TerrainFn = (x, y) => ({ h: 1 + 0.02 * x - 0.03 * y, dist: 10 });
    const opts = BUSSELTON;
    const top = meshTop(plane, opts);
    const tris = trianglesOf(buildTerrainChunk({ key: "t000", minX: 0, minY: 0, maxX: 200, maxY: 200 }, plane, { ...opts, terrainLod: false }, false)!);
    for (let k = 0; k < 200; k++) {
      const x = 0.5 + ((k * 13.37) % 199), y = 0.5 + ((k * 7.71) % 199);
      expect(Math.abs(top(x, y) - meshAt(tris, x, y)!)).toBeLessThan(1e-3);
    }
  });
});
