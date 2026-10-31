import { describe, expect, it } from "vitest";
import { planJunctionCore, type JunctionCoreInput } from "../src/core/network/phase1";
import { junctionSurface, type Outline } from "../src/core/network/outline";
import type { RouteRibbon, StreetRibbon } from "../src/core/network/ribbons";
import type { P2 } from "../src/core/network/geom";
import type { Kn5MeshNode } from "../src/core/kn5";

// A straight route east-west along y = 0 (7 m wide, rising 1% east), the way the build samples it.
function straightRoute(): RouteRibbon {
  const samples: RouteRibbon["samples"] = [];
  for (let x = -100; x <= 100; x += 2) samples.push({ pos: [x, 0] as P2, tan: [1, 0] as P2, left: [0, 1] as P2, s: x + 100, width: 7, h: 10 + 0.01 * x, bank: 0 });
  return {
    samples, closed: false, length: 200, crown: 0.02,
    nearest: (x, y, max) => {
      let best: { seg: number; frac: number; dist: number } | null = null;
      for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i].pos, b = samples[i + 1].pos;
        const f = Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)));
        const d = Math.hypot(x - a[0] - (b[0] - a[0]) * f, y - a[1] - (b[1] - a[1]) * f);
        if (d <= max && (!best || d < best.dist)) best = { seg: i, frac: f, dist: d };
      }
      return best;
    },
  };
}

const line = (a: P2, b: P2, step = 2): P2[] => {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  return Array.from({ length: n + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n] as P2);
};
const terrain = (x: number, y: number) => 10 + 0.01 * x + 0.005 * y;
const zAt = (nodes: Kn5MeshNode[], p: P2): number[] => {
  const out: number[] = [];
  for (const m of nodes) for (let i = 0; i < m.positions.length; i += 3) {
    // AC space: x east, y up, z south.
    if (Math.hypot(m.positions[i] - p[0], -m.positions[i + 2] - p[1]) < 1e-3) out.push(m.positions[i + 1]);
  }
  return out;
};
const surfaceHeight = (s: { h: number; bank: number; width: number; crown?: number }, t: number, crown: number) => {
  const tc = Math.max(-s.width / 2, Math.min(s.width / 2, t));
  return s.h + s.bank * tc - (s.crown ?? crown) * Math.abs(tc);
};

describe("networkCore phase 1: a side street meeting the route", () => {
  const route = straightRoute();
  // The side street as the build plans it: from the route's edge northward, joined at its first point.
  const street: StreetRibbon = { pts: line([0, 3.5], [0, 80]), width: 6, joins: [0], cls: "minor" };
  const input: JunctionCoreInput = {
    lines: [{ pts: [[-100, 0], [0, 0], [100, 0]], cls: "primary" }, { pts: [[0, 0], [0, 80]], cls: "minor" }],
    rings: [], route, streets: [street], builtRings: [], terrain, inArea: () => true,
  };
  const net = planJunctionCore(input);
  const pj = net.junctions[0];
  const mesh = net.build({ routeKerb: () => 1, stripOut: 3, vergeWidth: 1.5, markings: true, roadMaterial: () => "road" });

  it("finds one route junction with two route legs and the street", () => {
    expect(net.failures).toEqual([]);
    expect(net.junctions).toHaveLength(1);
    expect(pj.j.onRoute).toBe(true);
    expect(pj.j.legs.map((l) => l.kind).sort()).toEqual(["route", "route", "street"]);
    expect(pj.j.spans).toHaveLength(1);
  });

  it("leaves the route's quads out between its caps and keeps them beyond", () => {
    const [entry, exit] = pj.j.spans[0];
    expect(entry).toBeLessThan(50);
    expect(exit).toBeGreaterThan(50);
    expect(net.routeQuadSkip(entry)).toBe(true);
    expect(net.routeQuadSkip(exit - 1)).toBe(true);
    expect(net.routeQuadSkip(exit)).toBe(false);
    expect(net.routeQuadSkip(entry - 1)).toBe(false);
    expect(net.routeRowInside(entry)).toBe(false);
    expect(net.routeRowInside(entry + 1)).toBe(true);
    expect(net.routeSInside(100)).toBe(true);
    expect(net.routeSInside(route.samples[entry].s - 0.5)).toBe(false);
    // The route kerb ends square at the caps.
    expect(net.noRamp.has(`${entry}:1`) && net.noRamp.has(`${exit - 1}:-1`)).toBe(true);
  });

  it("eases the route's crown out to nothing at each cap", () => {
    const [entry, exit] = pj.j.spans[0];
    expect(route.samples[entry].crown).toBe(0);
    expect(route.samples[exit].crown).toBe(0);
    expect(route.samples[entry - 2].crown).toBeGreaterThan(0);
    expect(route.samples[entry - 10].crown).toBeUndefined();
  });

  it("meets the route ribbon's cap rows vertex for vertex, within a millimetre", () => {
    for (const l of pj.j.legs.filter((m) => m.kind === "route")) {
      const s = route.samples[l.at];
      for (const v of l.cap.verts) {
        const t = (v[0] - s.pos[0]) * s.left[0] + (v[1] - s.pos[1]) * s.left[1];
        const ribbon = surfaceHeight(s, t, route.crown);
        const zs = zAt(mesh.road, v);
        expect(zs.length).toBeGreaterThan(0);
        for (const z of zs) expect(Math.abs(z - ribbon)).toBeLessThan(1e-3);
      }
    }
  });

  it("cuts the street at its cap, inserts the cap as a point and eases the street to the junction", () => {
    const l = pj.j.legs.find((m) => m.kind === "street")!;
    expect(street.pts.some((p) => Math.hypot(p[0] - l.cap.c[0], p[1] - l.cap.c[1]) < 1e-6)).toBe(true);
    expect(street.joins).toEqual([]);
    expect(net.streetSkip(street, l.at - 1, l.at)).toBe(true);
    expect(net.streetSkip(street, l.at, l.at + 1)).toBe(false);
    // buildSideStreets drapes a street 10 cm above the ground it's given: at the cap that's the junction's height.
    const ground = net.streetGround(terrain);
    for (const v of l.cap.verts) {
      const zs = zAt(mesh.road, v);
      expect(zs.length).toBeGreaterThan(0);
      for (const z of zs) expect(Math.abs(ground(v[0], v[1]) + 0.1 - z)).toBeLessThan(1e-3);
    }
    // 15 m on, the street is back on its own drape.
    const far: P2 = [l.cap.c[0], l.cap.c[1] + 16];
    expect(ground(far[0], far[1])).toBeCloseTo(terrain(far[0], far[1]), 6);
  });

  it("names the surfaces so the checks and AI read them as the route's, with kerbs and a give-way line", () => {
    expect(mesh.road.some((m) => /^1ROAD_J\d+$/.test(m.name))).toBe(true);
    expect(mesh.road.some((m) => /^1ROAD_GUTTER_J\d+$/.test(m.name))).toBe(true);
    expect(mesh.dress.some((m) => /^1KERB_J\d+$/.test(m.name))).toBe(true);
    expect(mesh.dress.some((m) => /^1GRASS_STRIP_J\d+$/.test(m.name))).toBe(true);
    expect(mesh.markings.some((m) => /^MARKINGS_J\d+$/.test(m.name))).toBe(true);
  });

  it("has no overlapping triangles in the junction surface", () => {
    const { xy, tris } = pj.surface;
    let area = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, c] = [xy[tris[t]], xy[tris[t + 1]], xy[tris[t + 2]]];
      const cr = ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
      expect(cr).toBeGreaterThan(0);
      area += cr;
    }
    const ring = pj.outline.outer;
    let poly = 0;
    for (let i = 0; i < ring.length; i++) poly += (ring[i][0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * ring[i][1]) / 2;
    expect(area).toBeCloseTo(poly, 1);
  });
});

describe("networkCore phase 1: streets only", () => {
  it("builds a crossroads of two streets as one plane (1STREET_J), with few triangles", () => {
    const a: StreetRibbon = { pts: line([-60, 0], [60, 0]), width: 6, joins: [], cls: "minor" };
    const b: StreetRibbon = { pts: line([0, -60], [0, 60]), width: 6, joins: [], cls: "minor" };
    const net = planJunctionCore({
      lines: [{ pts: [[-60, 0], [0, 0], [60, 0]], cls: "minor" }, { pts: [[0, -60], [0, 0], [0, 60]], cls: "minor" }],
      rings: [], route: null, streets: [a, b], builtRings: [], terrain, inArea: () => true,
    });
    expect(net.failures).toEqual([]);
    expect(net.junctions).toHaveLength(1);
    const pj = net.junctions[0];
    expect(pj.field.planar).toBe(true);
    expect(pj.j.legs).toHaveLength(4);
    expect(pj.surface.tris.length / 3).toBeLessThan(400);
    const mesh = net.build({ routeKerb: () => 0, stripOut: 3, vergeWidth: 1.5, markings: false, roadMaterial: () => "road" });
    expect(mesh.road.map((m) => m.name).filter((n) => /^1STREET_J/.test(n)).length).toBeGreaterThan(0);
    // Both streets pass through: each is cut from cap to cap.
    for (const st of [a, b]) {
      expect(net.streetSkip(st, 59, 61)).toBe(true);
      expect(net.streetSkip(st, 20, 22)).toBe(false);
    }
  });

  it("leaves a junction to the old core when another street runs into it", () => {
    const a: StreetRibbon = { pts: line([-60, 0], [60, 0]), width: 6, joins: [], cls: "minor" };
    const b: StreetRibbon = { pts: line([0, 0], [0, 60]), width: 6, joins: [], cls: "minor" };
    // A service road beside the junction, not connected to it.
    const c: StreetRibbon = { pts: line([-30, 6.5], [-4, 6.5]), width: 4, joins: [], cls: "service" };
    const net = planJunctionCore({
      lines: [{ pts: [[-60, 0], [0, 0], [60, 0]], cls: "minor" }, { pts: [[0, 0], [0, 60]], cls: "minor" }, { pts: [[-30, 6.5], [-4, 6.5]], cls: "service" }],
      rings: [], route: null, streets: [a, b, c], builtRings: [], terrain, inArea: () => true,
    });
    expect(net.junctions).toHaveLength(0);
    expect(net.failures[0].reason).toMatch(/runs into it/);
  });
});

describe("networkCore phase 1: a roundabout", () => {
  const R = 12, W = 7;
  const ring: P2[] = Array.from({ length: 33 }, (_, k) => [Math.cos((k / 32) * 2 * Math.PI) * R, Math.sin((k / 32) * 2 * Math.PI) * R] as P2);
  ring[32] = ring[0];
  const arms: P2[][] = [[[R, 0], [80, 0]], [[0, R], [0, 80]], [[-R, 0], [-80, 0]], [[0, -R], [0, -80]]];
  // Streets as the build makes them: from the ring's edge outward.
  const Ro = R + W / 2 - 0.4;
  const streets: StreetRibbon[] = arms.map(([, b]) => {
    const d: P2 = [Math.sign(b[0]), Math.sign(b[1])];
    return { pts: line([d[0] * Ro, d[1] * Ro], b), width: 6, joins: [], cls: "minor" };
  });
  const net = planJunctionCore({
    lines: arms.map((pts) => ({ pts, cls: "minor" })), rings: [{ pts: ring }], route: null, streets,
    builtRings: [{ c: [0, 0], r: R, w: W, kerbed: true }], terrain, inArea: () => true,
  });
  const mesh = net.build({ routeKerb: () => 0, stripOut: 3, vergeWidth: 1.5, markings: true, roadMaterial: () => "road" });

  it("takes the ring over and builds it with its island as a hole", () => {
    expect(net.failures).toEqual([]);
    expect(net.handlesRing(0)).toBe(true);
    const pj = net.junctions[0];
    expect(pj.j.kind).toBe("roundabout");
    expect(pj.j.legs).toHaveLength(4);
    const rIn = R - W / 2;
    const { xy, tris } = pj.surface;
    for (let t = 0; t < tris.length; t += 3) {
      const c = [0, 1, 2].map((k) => xy[tris[t + k]]).reduce((s, p) => [s[0] + p[0] / 3, s[1] + p[1] / 3], [0, 0]);
      expect(Math.hypot(c[0], c[1])).toBeGreaterThan(rIn - 0.6);
    }
    expect(mesh.dress.some((m) => /^1GRASS_ISLAND_J/.test(m.name))).toBe(true);
    expect(mesh.dress.some((m) => /^1KERB_J/.test(m.name))).toBe(true);
    // A give-way line at every entry.
    expect(mesh.markings.length).toBeGreaterThan(0);
  });

  it("falls outward across the ring by the ring fall", () => {
    const pj = net.junctions[0];
    const rIn = R - W / 2;
    const inner = pj.field.fall([rIn + 0.01, 0.01]), outer = pj.field.fall([R + W / 2, 0.01]);
    expect(inner - outer).toBeCloseTo(0.02 * W, 2);
  });

  it("gives the lanes its surface: heights inside it, none outside, the ring's height on its lane", () => {
    const pj = net.junctions[0];
    expect(net.surfaceAt([R, 0.3])).toBeCloseTo(pj.field.h([R, 0.3]), 6);
    expect(net.surfaceAt([0, 0])).toBeNull(); // the island
    expect(net.surfaceAt([60, 30])).toBeNull();
    const round = ([[R, 0], [0, R], [-R, 0], [0, -R]] as P2[]).reduce((t, p) => t + pj.field.h(p) / 4, 0);
    expect(net.ringHeight(0)).toBeCloseTo(round, 2);
    expect(net.ringHeight(1)).toBeNull();
  });
});

describe("junction surface", () => {
  it("keeps collinear outline points and cell corners, so the band and the cells share every vertex", () => {
    // A 20 x 10 m rectangle with points every metre along its sides.
    const outer: P2[] = [];
    for (let x = 0; x < 20; x++) outer.push([x, 0]);
    for (let y = 0; y < 10; y++) outer.push([20, y]);
    for (let x = 20; x > 0; x--) outer.push([x, 10]);
    for (let y = 10; y > 0; y--) outer.push([0, y]);
    const o: Outline = { outer, holes: [], capOf: outer.map(() => -1) };
    const { xy, tris } = junctionSurface(o, (p) => 0.002 * (p[0] - 10) ** 2 + 0.001 * p[1] ** 2);
    // Every edge is shared by two triangles, except the outline's own edges (one each).
    const count = new Map<string, number>();
    for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = tris[t + e], b = tris[t + ((e + 1) % 3)];
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    let boundary = 0;
    for (const [k, n] of count) {
      expect(n).toBeLessThanOrEqual(2);
      if (n === 1) {
        boundary++;
        const [a, b] = k.split(",").map(Number);
        const onEdge = (p: P2) => p[0] < 1e-6 || p[0] > 20 - 1e-6 || p[1] < 1e-6 || p[1] > 10 - 1e-6;
        if (!(onEdge(xy[a]) && onEdge(xy[b]))) { console.log("open edge", xy[a], xy[b]); for (let t = 0; t < tris.length; t += 3) { const v = [tris[t], tris[t + 1], tris[t + 2]]; if (v.includes(a) || v.includes(b)) console.log("  tri", v.map((i) => xy[i].join(","))); } }
        expect(onEdge(xy[a]) && onEdge(xy[b])).toBe(true);
      }
    }
    expect(boundary).toBeGreaterThanOrEqual(outer.length);
    // The field curves, so it was refined: more points than the outline.
    expect(xy.length).toBeGreaterThan(outer.length);
  });
});
