import { describe, expect, it } from "vitest";
import type { Building } from "../src/core/buildings";
import { frontSpans } from "../src/core/frontDoor";
import { checkGround } from "../src/core/groundCheck";
import { MAX_MESH_VERTICES, type Kn5MeshNode, type Kn5Node } from "../src/core/kn5";
import { buildLots, footAlong, frontWall, shrub, stepsAlong } from "../src/core/lots";
import { MeshBuilder } from "../src/core/mesh";
import { SINK } from "../src/core/sceneGround";
import { SHRUB_SPECIES } from "../src/core/houseTextures";

const flat = () => 10;
// A 14 x 10 m house (or `w` wide), front wall along y = 0, street to the south.
const house = (x = 0, extra: Partial<Building> = {}, w = 14): Building => ({
  ring: [[x, 0], [x + w, 0], [x + w, 10], [x, 10]],
  height: 2.8, type: "house", pitch: 22, roof: "hip", roofColour: 1, facade: 0, source: "frontage",
  front: [[x, 0], [x + w, 0]], garage: true, setback: 9, ...extra,
});
// The road's edge runs along y = -gap.
const roadAt = (gap = 9) => (_x: number, y: number) => y + gap;

/** Vertices in local ENU (x east, y north, z up). */
const verts = (m: Kn5MeshNode): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i < m.positions.length; i += 3) out.push([m.positions[i], -m.positions[i + 2], m.positions[i + 1]]);
  return out;
};
const named = (ms: Kn5MeshNode[], re: RegExp) => ms.filter((m) => re.test(m.name));
const group = (name: string, children: Kn5Node[]): Kn5Node => ({ kind: "node", name, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children } as Kn5Node);
const grid = (name: string, x0: number, y0: number, x1: number, y1: number, step: number, h: (x: number, y: number) => number): Kn5Node => {
  const mb = new MeshBuilder();
  const nx = Math.round((x1 - x0) / step), ny = Math.round((y1 - y0) / step);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const x = x0 + i * step, y = y0 + j * step; mb.vertex([x, y, h(x, y)], 0, 0); }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const p = j * (nx + 1) + i; mb.quad(p, p + 1, p + nx + 2, p + nx + 1); }
  return mb.toKn5(name, "grass");
};

/** The first house position (stepping 40 m east) whose lot has garden beds. */
const withBeds = (extra: Partial<Building> = {}, gap = 9): Building => {
  for (let i = 0; i < 100; i++) {
    const b = house(i * 40, extra);
    if (named(buildLots([b], flat, { roadGap: roadAt(gap) }), /^GARDENBED_/).length) return b;
  }
  throw new Error("no house with beds");
};

describe("frontWall", () => {
  it("finds the front edge in a counter-clockwise ring, either way round", () => {
    const b = house();
    const r = frontWall(b);
    expect(r.k).toBe(0);
    expect(r.ring).toBe(b.ring);
    const rev = house();
    rev.ring = rev.ring.slice().reverse();
    const { ring, k } = frontWall(rev);
    expect(ring).not.toBe(rev.ring);
    expect(rev.ring[0]).toEqual([0, 10]); // the building's own ring is untouched
    expect(ring[k][1]).toBe(0);
    expect(ring[(k + 1) % 4][1]).toBe(0);
    let area = 0;
    ring.forEach((p, i) => { const q = ring[(i + 1) % 4]; area += p[0] * q[1] - q[0] * p[1]; });
    expect(area).toBeGreaterThan(0);
  });
  it("is -1 without a front, and still matches a front that drifted 0.4 m", () => {
    expect(frontWall(house(0, { front: undefined })).k).toBe(-1);
    expect(frontWall(house(0, { front: [[0.4, -0.1], [14.3, 0.2]] })).k).toBe(0);
    expect(buildLots([house(0, { front: [[0.4, -0.1], [14.3, 0.2]] })], flat, { roadGap: roadAt() }).length).toBeGreaterThan(0);
  });
});

describe("stepsAlong and footAlong", () => {
  it("steps evenly with exact ends", () => {
    const p = stepsAlong([0, 0], [2.3, 0], 0.5);
    expect(p.length).toBe(Math.ceil(2.3 / 0.5) + 1);
    expect(p[0]).toEqual([0, 0]);
    expect(p[p.length - 1]).toEqual([2.3, 0]);
    expect(stepsAlong([1, 1], [1, 1])).toEqual([[1, 1], [1, 1]]);
  });
  it("keeps only the ends on flat or evenly sloping ground", () => {
    for (const g of [flat, (x: number) => 3 + 0.2 * x]) {
      const r = footAlong([0, 0], [2.4, 0], g);
      expect(r.pts).toEqual([[0, 0], [2.4, 0]]);
      expect(r.foot[0]).toBeCloseTo(g(0) - SINK, 9);
      expect(r.foot[1]).toBeCloseTo(g(2.4) - SINK, 9);
    }
  });
  it("follows a 20 cm bump within 1.1 cm, and respects the tolerance", () => {
    const g = (x: number) => 10 + 0.2 * Math.max(0, 1 - Math.abs(x - 1.5) / 0.6);
    const r = footAlong([0, 0], [3, 0], g);
    expect(r.pts.length).toBeGreaterThan(2);
    for (const [x] of stepsAlong([0, 0], [3, 0], 0.5)) {
      const k = Math.max(1, r.pts.findIndex((p) => p[0] >= x - 1e-9));
      const a = r.pts[k - 1], b = r.pts[k];
      const z = r.foot[k - 1] + ((r.foot[k] - r.foot[k - 1]) * (x - a[0])) / (b[0] - a[0]);
      expect(Math.abs(z - (g(x) - SINK))).toBeLessThan(0.011);
    }
    expect(footAlong([0, 0], [3, 0], g, 1).pts.length).toBe(2);
  });
});

describe("lots on flat ground", () => {
  it("fences two neighbours, keeps out of their houses and off the driveways", () => {
    const a = house(0, { frontKind: "brick" }), b = house(16.4, { frontKind: "limestone" });
    const ms = buildLots([a, b], flat, { roadGap: roadAt() });
    const fences = named(ms, /^1WALL_FENCE_/);
    expect(fences.length).toBeGreaterThan(0);
    const inside = (x: number, y: number, x0: number) => x > x0 + 0.01 && x < x0 + 13.99 && y > 0.01 && y < 9.99;
    for (const f of fences) for (const [x, y] of verts(f)) {
      expect(inside(x, y, 0) || inside(x, y, 16.4)).toBe(false);
      expect(y).toBeGreaterThan(-2);
    }
    const fronts = named(ms, /^1WALL_FRONT_/);
    expect(fronts.length).toBeGreaterThan(0);
    for (const w of fronts) for (const [x] of verts(w)) {
      expect(x > 0.1 && x < 3.7).toBe(false);
      expect(x > 16.5 && x < 20.1).toBe(false);
    }
  });

  it("splits an 8 m fence line into three panels, 1.8 m high on the flat", () => {
    const ms = buildLots([house(0, {}, 5.6)], flat, { roadGap: roadAt() });
    // The back fence runs along y = 10 + 8 from x = -1.2 to 6.8.
    const back = backQuads(ms, 18);
    expect(back.length).toBe(3 * 2); // three panels, one quad per face
    for (const zs of back) {
      expect(zs[0]).toBeCloseTo(10 - SINK, 6);
      expect(zs[3]).toBeCloseTo(10 - SINK + 1.8, 6);
    }
  });

  it("on a slope the top is max(lowest foot + 1.8, highest foot + 0.5)", () => {
    for (const k of [0.1, 1]) {
      const g = (x: number) => 10 + k * x;
      const back = backQuads(buildLots([house(0, {}, 5.6)], g, { roadGap: roadAt() }), 18);
      expect(back.length).toBe(6);
      for (const [low, high, top] of back) expect(top).toBeCloseTo(Math.max(low + 1.8, high + 0.5), 4);
    }
  });
});

/** Quads of the back fence (every vertex at y = `y`), each as its sorted distinct heights [low, high, top, top]. */
function backQuads(ms: Kn5MeshNode[], y: number): number[][] {
  const out: number[][] = [];
  for (const m of named(ms, /^1WALL_FENCE_/)) {
    const v = verts(m);
    for (let t = 0; t < m.indices.length; t += 6) {
      const ids = [...new Set(Array.from(m.indices.slice(t, t + 6)))];
      if (!ids.every((i) => Math.abs(v[i][1] - y) < 1e-6)) continue;
      out.push(ids.map((i) => v[i][2]).sort((a, b) => a - b));
    }
  }
  return out;
}

describe("front boundary", () => {
  it("a look's frontKind wins, including none; no room forces none", () => {
    const one = (extra: Partial<Building>, gap = 9) => named(buildLots([house(0, extra)], flat, { roadGap: roadAt(gap) }), /^1WALL_FRONT_/).map((m) => m.name);
    expect(one({ frontKind: "brick" })).toEqual(["1WALL_FRONT_brick_000"]);
    expect(one({ frontKind: "none" })).toEqual([]);
    expect(one({ frontKind: "limestone" }, 5.9)).toEqual([]);
    expect(one({ frontKind: "limestone" }, 6.1)).toEqual(["1WALL_FRONT_limestone_000"]);
  });
  it("sizes a hedge from hedgeHeight", () => {
    const ms = buildLots([house(0, { frontKind: "hedge", hedgeHeight: 1.6 })], flat, { roadGap: roadAt() });
    const v = named(ms, /^1WALL_FRONT_hedge_/).flatMap(verts);
    expect(Math.max(...v.map((p) => p[2]))).toBeCloseTo(11.6, 6);
    const ys = v.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.96, 6); // max(0.8, 0.6 x 1.6)
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(-4.5, 6); // 9 m gap - 4.5 m verge
    const plain = named(buildLots([house(0, { frontKind: "hedge" })], flat, { roadGap: roadAt() }), /^1WALL_FRONT_hedge_/).flatMap(verts);
    expect(Math.max(...plain.map((p) => p[2]))).toBeCloseTo(11, 6);
  });
  it("walls are their height over the ends' ground and 20 cm over the highest ground", () => {
    const ms = buildLots([house(0, { frontKind: "brick" })], flat, { roadGap: roadAt() });
    expect(Math.max(...named(ms, /^1WALL_FRONT_/).flatMap(verts).map((p) => p[2]))).toBeCloseTo(10.8, 6);
  });
});

describe("uneven ground", () => {
  // A drain 1 m deep and 2 m wide running north-south at x = 7, across the back fence and the front wall.
  const drain = (x: number) => 10 - Math.max(0, 1 - Math.abs(x - 7));
  for (const kind of ["limestone", "brick", "hedge"] as const) {
    it(`fences and a ${kind} front stand on the ground: nothing sunk, nothing off`, () => {
      const lots = buildLots([house(0, { frontKind: kind })], drain, { roadGap: roadAt() });
      expect(named(lots, /^1WALL_FRONT_/).length).toBeGreaterThan(0);
      for (const m of named(lots, /^1WALL_(FENCE|FRONT)/)) for (const [x, , z] of verts(m)) expect(z).toBeGreaterThanOrEqual(drain(x) - SINK - 1e-4);
      const world = group("track", [group("TERRAIN", [grid("1GRASS_t000", -20, -30, 40, 30, 0.25, drain)]), group("LOTS", lots)]);
      expect(checkGround(world).off).toEqual([]);
    });
  }
});

describe("garden beds and shrubs", () => {
  it("keeps clear of the garage driveway and the door path, with the door where buildings.ts puts it", () => {
    for (const garage of [true, false]) {
      const b = withBeds({ garage, frontKind: "none" });
      const x0 = b.ring[0][0];
      const spans = frontSpans(14, garage);
      const ms = buildLots([b], flat, { roadGap: roadAt() });
      const beds = named(ms, /^GARDENBED_/);
      expect(beds[0].castShadows).toBe(false);
      for (const [x, y, z] of beds.flatMap(verts)) {
        const s = x - x0;
        if (garage) expect(s).toBeGreaterThanOrEqual(3.8 - 1e-9);
        expect(s > spans.door![0] - 0.5 + 1e-9 && s < spans.door![1] + 0.5 - 1e-9).toBe(false);
        expect(z).toBeCloseTo(10.04, 6);
        expect(y).toBeLessThanOrEqual(-0.05 + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-1.4 - 1e-9);
      }
      // Each shrub (16 vertices) centred in a bed.
      const sh = named(ms, /^SHRUBS_/);
      expect(sh[0].castShadows).toBe(true);
      const v = sh.flatMap(verts);
      expect(v.length % 16).toBe(0);
      for (let i = 0; i < v.length; i += 16) {
        const cx = v.slice(i, i + 16).reduce((s, p) => s + p[0], 0) / 16 - x0;
        const cy = v.slice(i, i + 16).reduce((s, p) => s + p[1], 0) / 16;
        expect(cy).toBeCloseTo(-0.75, 6);
        const inBed = (garage ? cx > 3.8 : cx > 0) && !(cx > spans.door![0] - 0.5 && cx < spans.door![1] + 0.5) && cx < 14;
        expect(inBed).toBe(true);
      }
    }
  });
  it("makes no beds when the front is 3.1 m or less from the road", () => {
    for (let i = 0; i < 20; i++) {
      expect(named(buildLots([house(i * 40)], flat, { roadGap: roadAt(3.1) }), /^(GARDENBED|SHRUBS)_/)).toEqual([]);
    }
  });
});

describe("shrub", () => {
  it("is two crossed two-sided quads on the ground at its centre", () => {
    for (const species of [0, 1] as const) {
      const mb = new MeshBuilder();
      shrub(mb, [5, 5], 1.2, species, 0.3, () => 2);
      expect(mb.vertexCount).toBe(16);
      const zs = [], us = [];
      for (let i = 0; i < 16; i++) { zs.push(mb.positions[i * 3 + 2]); us.push(mb.uvs[i * 2]); }
      expect(Math.min(...zs)).toBeCloseTo(2 - SINK, 9);
      expect(Math.max(...zs)).toBeCloseTo(2 - SINK + 1.2, 9);
      // width: the two bottom corners of the first quad
      expect(Math.hypot(mb.positions[0] - mb.positions[3], mb.positions[1] - mb.positions[4])).toBeCloseTo(1.68, 9);
      expect(Math.min(...us)).toBe(SHRUB_SPECIES[species].u0);
      expect(Math.max(...us)).toBe(SHRUB_SPECIES[species].u1);
      const n = mb.normals!;
      for (let i = 0; i < 16; i++) {
        expect(Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2])).toBeCloseTo(1, 9);
        expect(n[i * 3 + 2]).toBeGreaterThan(0.9);
      }
    }
  });
});

describe("winding, names and order", () => {
  const slope = (x: number, y: number) => 10 + 0.05 * x + 0.03 * y;
  const houses = [house(0, { frontKind: "limestone" }), house(40, { frontKind: "brick" }), house(80, { frontKind: "hedge" }), ...Array.from({ length: 12 }, (_, i) => house(120 + i * 40))];
  const ms = buildLots(houses, slope, { roadGap: roadAt() });

  it("every triangle faces the way its vertex normals point", () => {
    for (const m of ms) {
      const p = m.positions, n = m.normals;
      for (let t = 0; t < m.indices.length; t += 3) {
        const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3];
        const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
        const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
        const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (Math.hypot(cr[0], cr[1], cr[2]) < 1e-9) continue;
        for (const v of [a, b, c]) expect(cr[0] * n[v] + cr[1] * n[v + 1] + cr[2] * n[v + 2]).toBeGreaterThan(0);
        // Beds and wall tops face up (AC y is up).
        if (/^GARDENBED_/.test(m.name)) expect(cr[1]).toBeGreaterThan(0);
      }
    }
  });

  it("names meshes in the specced order with the specced materials", () => {
    const order = [/^1WALL_FENCE_woodland_\d{3}$/, /^1WALL_FENCE_basalt_\d{3}$/, /^1WALL_FENCE_paperbark_\d{3}$/, /^1WALL_FRONT_limestone_\d{3}$/, /^1WALL_FRONT_brick_\d{3}$/, /^1WALL_FRONT_hedge_\d{3}$/, /^GARDENBED_\d{3}$/, /^SHRUBS_\d{3}$/];
    const material = ["fence_woodland", "fence_basalt", "fence_paperbark", "frontwall_limestone", "frontwall_brick", "hedge", "mulch", "shrubs"];
    let last = -1;
    for (const m of ms) {
      const k = order.findIndex((re) => re.test(m.name));
      expect(k).toBeGreaterThanOrEqual(last);
      expect(m.material).toBe(material[k]);
      last = k;
    }
    for (const k of [3, 4, 5, 6, 7]) expect(ms.some((m) => order[k].test(m.name))).toBe(true);
    expect(ms.filter((m) => /_000$/.test(m.name) && /^1WALL_FENCE/.test(m.name)).length).toBeGreaterThan(1);
  });
});

describe("determinism", () => {
  /** Every vertex, by mesh stem, sorted: the geometry regardless of chunk numbering and house order. */
  const geometry = (ms: Kn5MeshNode[], keep: (x: number) => boolean = () => true) => {
    const by = new Map<string, string[]>();
    for (const m of ms) {
      const stem = m.name.replace(/_\d{3}$/, "");
      const list = by.get(stem) ?? [];
      for (const [x, y, z] of verts(m)) if (keep(x)) list.push(`${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`);
      if (list.length) by.set(stem, list);
    }
    return [...by.entries()].map(([k, v]) => [k, v.sort()] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  };
  it("the same houses in another order give the same lots", () => {
    const hs = Array.from({ length: 8 }, (_, i) => house(i * 16.4, { garage: i % 2 === 0 }));
    const a = buildLots(hs, flat, { roadGap: roadAt() });
    const b = buildLots(hs.slice().reverse(), flat, { roadGap: roadAt(), seed: 99 });
    expect(geometry(b)).toEqual(geometry(a));
  });
  it("adding a house far away changes nothing near another", () => {
    const a = buildLots([house(0)], flat, { roadGap: roadAt() });
    const b = buildLots([house(500), house(0)], flat, { roadGap: roadAt() });
    expect(geometry(b, (x) => x < 100)).toEqual(geometry(a));
  });
});

describe("chunking", () => {
  it("splits one fence colour over two meshes, each under the kn5 limit", () => {
    const hs = Array.from({ length: 1500 }, (_, i) => house(i * 30, { frontKind: "none" }));
    const ms = buildLots(hs, flat, { roadGap: roadAt() });
    for (const m of ms) expect(m.positions.length / 3).toBeLessThanOrEqual(MAX_MESH_VERTICES);
    expect(ms.some((m) => /^1WALL_FENCE_\w+_001$/.test(m.name))).toBe(true);
  });
});
