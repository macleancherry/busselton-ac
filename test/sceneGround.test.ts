import { describe, expect, it } from "vitest";
import { alongRing, footprint, groundOver, sceneGround, topSurface } from "../src/core/sceneGround";
import { clearParked, carFootprint, parkedConflict } from "../src/core/parkedClear";
import { checkGround } from "../src/core/groundCheck";
import { MeshBuilder } from "../src/core/mesh";
import type { Kn5Node } from "../src/core/kn5";
import { buildTrack, type DataSources } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import { encodePng } from "../src/core/png";
import type { LngLat } from "../src/core/geo";

/** A flat square mesh, x0..x1 by y0..y1 (local metres, y north) at height z (or a height function). */
const square = (name: string, x0: number, y0: number, x1: number, y1: number, z: number | ((x: number, y: number) => number)) => {
  const h = typeof z === "number" ? () => z : z;
  const mb = new MeshBuilder();
  const a = mb.vertex([x0, y0, h(x0, y0)], 0, 0), b = mb.vertex([x1, y0, h(x1, y0)], 1, 0), c = mb.vertex([x1, y1, h(x1, y1)], 1, 1), d = mb.vertex([x0, y1, h(x0, y1)], 0, 1);
  mb.quad(a, b, c, d);
  return mb.toKn5(name, "grass");
};
/** A box from z0 to z1 over a square `size` wide at (x, y): four sides and a top. */
const post = (mb: MeshBuilder, x: number, y: number, size: number, z0: number, z1: number) => {
  const h = size / 2, c: [number, number][] = [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]];
  for (let k = 0; k < 4; k++) {
    const p = c[k], q = c[(k + 1) % 4], i = mb.vertexCount;
    mb.vertex([p[0], p[1], z0], 0, 0); mb.vertex([q[0], q[1], z0], 1, 0); mb.vertex([q[0], q[1], z1], 1, 1); mb.vertex([p[0], p[1], z1], 0, 1);
    mb.quad(i, i + 1, i + 2, i + 3);
  }
  const i = mb.vertexCount;
  for (const p of c) mb.vertex([p[0], p[1], z1], 0, 0);
  mb.quad(i, i + 1, i + 2, i + 3);
};
const group = (name: string, children: Kn5Node[]): Kn5Node => ({ kind: "node", name, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children });

describe("scene ground", () => {
  // Terrain sloping up east at 5%, a road raised 12 cm over it from y -4 to 4, a kerb strip on top
  // north of it, and a wall (which isn't ground) standing much higher.
  const terrain = square("1GRASS_t000", -50, -50, 50, 50, (x) => 10 + 0.05 * x);
  const road = square("1ROAD_000", -50, -4, 50, 4, (x) => 10.12 + 0.05 * x);
  const strip = square("1GRASS_STRIP_000", -50, 4, 50, 7, (x) => 10.27 + 0.05 * x);
  const wall = square("1WALL_000", -5, -5, 5, 5, 40);
  const g = sceneGround([terrain, road, strip, wall], () => -99);

  it("reads the topmost physics mesh, never a wall", () => {
    expect(g(0, 0)).toBeCloseTo(10.12, 4);
    expect(g(20, 5)).toBeCloseTo(11.27, 4);
    expect(g(-20, -20)).toBeCloseTo(9, 4);
    expect(g.mesh(0, 0)).toBeCloseTo(10.12, 4);
  });

  it("falls back where no mesh covers the point", () => {
    expect(g(80, 0)).toBe(-99);
    expect(g.mesh(80, 0)).toBeNull();
  });

  it("finds a point on a shared triangle edge", () => {
    // The quad's diagonal runs corner to corner: points on it are in both triangles (or one).
    for (let t = 0.05; t < 1; t += 0.1) expect(g.mesh(-50 + 100 * t, -50 + 100 * t)).not.toBeNull();
  });

  it("gives the lowest ground under a footprint or along a ring", () => {
    expect(g.under([[0, -20], [10, -20]])).toBeCloseTo(10, 4);
    const ring: [number, number][] = [[0, -30], [10, -30], [10, -20], [0, -20]];
    expect(g.underRing(ring)).toBeCloseTo(10, 4);
    expect(alongRing(ring, 1)).toHaveLength(40);
    expect(footprint([0, 0], [1, 0], 4, 2)).toEqual([[0, 0], [-2, -1], [-2, 1], [2, -1], [2, 1]]);
  });

  it("is quick: a 300 x 300 m terrain at 1.5 m, 100k lookups in well under a second", () => {
    const mb = new MeshBuilder();
    const n = 200, step = 1.5;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) mb.vertex([i * step, j * step, Math.sin(i / 7) + Math.cos(j / 9)], 0, 0);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; mb.quad(a, a + 1, a + n + 2, a + n + 1); }
    const s = topSurface([mb.toKn5("1GRASS_t001", "grass")]);
    const t0 = performance.now();
    let misses = 0;
    for (let k = 0; k < 100_000; k++) if (s((k * 7.31) % 299, (k * 3.17) % 299) === null) misses++;
    expect(misses).toBe(0);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("wraps any surface", () => {
    const w = groundOver((x) => (x > 0 ? 1 : null), () => 5);
    expect(w(1, 0)).toBe(1);
    expect(w(-1, 0)).toBe(5);
  });
});

describe("ground check", () => {
  const terrain = square("1GRASS_t000", -50, -50, 50, 50, 10);
  const road = square("1ROAD_000", -50, -4, 50, 4, 10.12);
  const furniture = (z0: number) => {
    const mb = new MeshBuilder();
    post(mb, 0, 10, 0.1, z0, z0 + 3); // a post
    post(mb, 0.3, 10, 0.5, z0 + 2.5, z0 + 2.8); // a sign on it, overlapping it
    post(mb, 20, 10, 0.2, 10 - 0.02, 12); // another post, right
    return mb.toKn5("FURNITURE_STEEL_000", "steel");
  };
  const world = (z0: number, extra: Kn5Node[] = []) => group("track", [group("TERRAIN", [terrain]), group("ROAD", [road]), group("FURNITURE", [furniture(z0)]), ...extra]);

  it("passes things standing on the ground, and the sign held up by its post", () => {
    const r = checkGround(world(10 - 0.02));
    expect(r.off).toEqual([]);
    expect(r.checked.FURNITURE).toBe(3);
  });

  it("flags a post floating over the ground (and its sign with it) and one sunk into it", () => {
    const up = checkGround(world(10.3));
    expect(up.off.filter((o) => o.kind === "floating")).toHaveLength(2);
    expect(up.off[0].off).toBeCloseTo(0.3, 3);
    const down = checkGround(world(9.8));
    expect(down.off).toHaveLength(1);
    expect(down.off[0].kind).toBe("sunk");
    expect(down.off[0].off).toBeCloseTo(-0.2, 3);
  });

  it("allows 5 cm either way, and judges the base along its edges on a slope", () => {
    expect(checkGround(world(10.04)).off).toEqual([]);
    expect(checkGround(world(9.96)).off).toEqual([]);
    // A long fence panel on a slope, its foot at the lowest end: it touches there.
    const slope = square("1GRASS_t000", -50, -50, 50, 50, (x) => 10 + 0.1 * x);
    const mb = new MeshBuilder();
    const i = mb.vertexCount;
    mb.vertex([0, 20, 10], 0, 0); mb.vertex([3, 20, 10], 1, 0); mb.vertex([3, 20, 11.8], 1, 1); mb.vertex([0, 20, 11.8], 0, 1);
    mb.quad(i, i + 1, i + 2, i + 3);
    const r = checkGround(group("track", [group("TERRAIN", [slope]), group("LOTS", [mb.toKn5("1WALL_FENCE_000", "fence")])]));
    expect(r.off).toEqual([]);
  });

  it("finds parked cars over the route's road", () => {
    const car = (y: number) => {
      const mb = new MeshBuilder();
      post(mb, 0, y, 1.8, 10.12, 11.5);
      return mb.toKn5("PARKED_CARS_000", "parked_car");
    };
    expect(checkGround(world(9.98, [group("PARKED_CARS", [car(3)])])).parkedOnRoad).toHaveLength(1);
    expect(checkGround(world(9.98, [group("PARKED_CARS", [car(8)])])).parkedOnRoad).toHaveLength(0);
  });
});

describe("parked cars against the built roads", () => {
  const road = topSurface([square("1ROAD_000", -50, -4, 50, 4, 10)]);
  const by = { road, rings: [{ c: [100, 0] as [number, number], r: 15 }], street: (x: number) => Math.abs(x - 30) - 3.5 };
  it("samples the whole footprint", () => {
    const pts = carFootprint([0, 0], [1, 0]);
    expect(pts).toHaveLength(10 * 5);
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(2.25, 6);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(0.9, 6);
  });
  it("drops a car with any part on the road, a through street or a roundabout, or near a lane", () => {
    // Its middle off the road but its side over the edge (the old centre test kept it).
    expect(parkedConflict({ at: [0, 4.7], dir: [1, 0] }, by)).toBe("road");
    expect(parkedConflict({ at: [0, 5.2], dir: [1, 0] }, by)).toBeNull();
    // Nose-in, square to the road, its front over the edge.
    expect(parkedConflict({ at: [10, 6], dir: [0, 1] }, by)).toBe("road");
    expect(parkedConflict({ at: [27, 20], dir: [0, 1] }, by)).toBe("road");
    expect(parkedConflict({ at: [84, 6], dir: [1, 0] }, by)).toBe("roundabout");
    expect(parkedConflict({ at: [0, 20], dir: [1, 0] }, { ...by, lane: (_x, y) => Math.abs(y - 22) })).toBe("lane");
    const r = clearParked([{ at: [0, 4.7], dir: [1, 0] }, { at: [0, 20], dir: [1, 0] }] as { at: [number, number]; dir: [number, number] }[], by);
    expect(r.kept).toHaveLength(1);
    expect(r.dropped).toEqual({ road: 1, roundabout: 0, lane: 0 });
  });
});

describe("in a build", () => {
  it("stands everything on the built ground: no piece off it by more than 5 cm", { timeout: 120_000 }, async () => {
    const lat0 = -33.6, lng0 = 115.4;
    const mx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
    const ll = (x: number, y: number): LngLat => [lng0 + x / mx, lat0 + y / 111_320];
    const route: LngLat[] = [];
    for (let x = 0; x <= 600; x += 20) route.push(ll(x, 0));
    // A hillside with swells: the road is cut in and banked against it, so terrain and road disagree.
    const h = (x: number, y: number) => 10 + 0.02 * x + 0.04 * y + Math.sin(x / 37) * 1.2 + Math.cos(y / 23) * 0.8;
    const ring: LngLat[] = Array.from({ length: 25 }, (_, i) => ll(300 + 14 * Math.cos((i / 24) * 2 * Math.PI), 150 + 14 * Math.sin((i / 24) * 2 * Math.PI)));
    const house = (x: number, y: number): LngLat[] => [ll(x, y), ll(x + 12, y), ll(x + 12, y + 10), ll(x, y + 10)];
    const sources: DataSources = {
      dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, h).sample,
      widthAt: () => 7,
      streets: { lines: [{ cls: "minor", pts: [ll(200, 0), ll(200, 200)] }, { cls: "minor", pts: [ll(150, 150), ll(550, 150)] }], names: [{ name: "Test St", pts: [ll(200, 0), ll(200, 200)] } as never] },
      osm: {
        buildings: [{ ring: house(60, 14), tags: { building: "house" } }, { ring: house(240, -30), tags: { building: "house" } }, { ring: house(400, 20), tags: { building: "retail" } }],
        guardRails: [],
        roundaboutRings: [{ pts: ring }],
        trafficSignals: [{ at: ll(200, 1), crossing: false }],
        poles: [ll(100, 6), ll(140, 6.5), ll(180, -6)],
        lamps: [ll(120, -6)],
        powerLines: [],
        barriers: [{ pts: [ll(80, 30), ll(160, 32)], kind: "fence" }],
        groynes: [],
      },
      paths: [{ kind: "shared", pts: [ll(20, 12), ll(180, 14)] }, { kind: "foot", pts: [ll(220, -12), ll(580, -16)] }],
      seen: [{ at: ll(260, 5), value: "regulatory--stop--g1" }, { at: ll(330, -5), value: "regulatory--maximum-speed-limit-50--g1" }],
      pois: [{ at: ll(410, 22), cls: "cafe", subclass: "cafe", name: "Cafe" }, { at: ll(500, 8), cls: "bus", subclass: "bus_stop" }],
      renderArt: async (items) => ({
        data: encodePng(new Uint8Array(4 * 4 * 4), 4, 4, { alpha: true }),
        cells: Object.fromEntries(items.map((r) => [r.key, { u0: 0, v0: 0, u1: 1, v1: 1, aspect: r.kind === "gate" ? 3.2 : r.kind === "poi" || r.kind === "tourist" ? 2.4 : 1 }])),
      }),
    };
    const area: [number, number][] = [ll(-20, -60), ll(620, -60), ll(620, 200), ll(-20, 200)];
    const built = await buildTrack(route, {
      name: "Ground", imageryZoom: 0, corridor: 50, horizon: 300, trees: 0, origin: ll(300, 0) as [number, number],
      area, traffic: true, streetSigns: true, landmarks: true, guidePosts: true, banking: false,
    }, sources);
    const r = checkGround(built.model.root);
    const total = Object.values(r.checked).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(50);
    expect(r.checked.FURNITURE ?? 0).toBeGreaterThan(5);
    expect(r.checked.BUILDINGS ?? 0).toBeGreaterThan(0);
    expect(r.checked.PATHS ?? 0).toBeGreaterThan(0);
    expect(r.off.map((o) => `${o.group} ${o.mesh} ${o.kind} ${(o.off * 100).toFixed(0)} cm at ${o.x.toFixed(0)}, ${o.z.toFixed(0)}`)).toEqual([]);
    expect(r.parkedOnRoad).toEqual([]);
  });
});
