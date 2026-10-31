import { describe, expect, it } from "vitest";
import type { Building } from "../src/core/buildings";
import type { Vec2 } from "../src/core/geo";
import { checkGround } from "../src/core/groundCheck";
import { buildLots } from "../src/core/lots";
import type { Kn5Node } from "../src/core/kn5";
import { MeshBuilder } from "../src/core/mesh";
import { clearBays, feetNear, outsideQuad } from "../src/core/padClear";
import { carSeat, MAX_LIFT, TYRE_SINK } from "../src/core/parkedCars";
import { carParkLights } from "../src/core/utilities";

type Quad = [Vec2, Vec2, Vec2, Vec2];
const bay = (x: number, y: number): Quad => [[x, y], [x + 2.6, y], [x + 2.6, y + 5.4], [x, y + 5.4]];
/** A thin upright quad (a pole or a wall's face) from a to b, z0 to z1. */
const upright = (name: string, a: Vec2, b: Vec2, z0: number, z1: number): Kn5Node => {
  const mb = new MeshBuilder();
  const i = mb.vertex([a[0], a[1], z0], 0, 1), j = mb.vertex([b[0], b[1], z0], 1, 1), k = mb.vertex([b[0], b[1], z1], 1, 0), l = mb.vertex([a[0], a[1], z1], 0, 0);
  mb.quad(i, j, k, l);
  return mb.toKn5(name, "steel");
};
const group = (name: string, children: Kn5Node[]): Kn5Node => ({ kind: "node", name, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children } as Kn5Node);
const flat = () => 10;

describe("bays clear of what stands there", () => {
  it("measures a point against a quad either way round", () => {
    const q = bay(0, 0);
    expect(outsideQuad(q, 1.3, 2.7)).toBeCloseTo(-1.3, 6);
    expect(outsideQuad(q, 3.1, 2)).toBeCloseTo(0.5, 6);
    expect(outsideQuad([q[3], q[2], q[1], q[0]], 3.1, 2)).toBeCloseTo(0.5, 6);
  });

  it("leaves out a bay over a pole's foot, and the car in it, but not one beside it", () => {
    const quads = [bay(0, 0), bay(2.6, 0), bay(5.2, 0), bay(20, 0)];
    const cars = quads.map((q) => ({ at: [(q[0][0] + q[2][0]) / 2, 2.7] as Vec2 }));
    const nodes = [
      // A car park light in the second bay, an 8 m pole standing on the ground.
      group("FURNITURE", [upright("FURNITURE_STEEL_000", [3.9, 4.0], [4.08, 4.0], 9.98, 18.2)]),
      // A front wall's face just past the last bay's end (within the gap).
      group("LOTS", [upright("1WALL_FRONT_limestone_000", [20, 5.5], [22, 5.5], 9.98, 10.9)]),
      // A path across the third bay is laid on the ground on purpose: not a foot.
      group("PATHS", [upright("1PATH_000", [5.2, 1], [7.8, 1], 10.0, 10.05)]),
      // Wires overhead aren't feet either.
      group("FURNITURE", [upright("FURNITURE_WIRE_000", [0, 1], [8, 1], 18, 18.05)]),
    ];
    const feet = feetNear(nodes, quads, flat);
    const r = clearBays(quads, cars, feet);
    expect(r.dropped).toBe(2);
    expect(r.quads).toEqual([quads[0], quads[2]]);
    expect(r.cars.map((c) => c.at[0])).toEqual([1.3, 6.5]);
  });

  it("keeps everything when nothing stands in the bays", () => {
    const quads = [bay(0, 0)];
    const nodes = [group("BUILDINGS", [upright("1WALL_BLD_000", [10, 0], [14, 0], 9.98, 13)])];
    const r = clearBays(quads, [{ at: [1.3, 2.7] as Vec2 }], feetNear(nodes, quads, flat));
    expect(r.dropped).toBe(0);
    expect(r.cars).toHaveLength(1);
  });
});

describe("car park lights off the streets", () => {
  const aisle: Vec2[] = [[0, 0], [100, 0]];
  it("move a pole off a street's asphalt, further from its aisle", () => {
    const free = carParkLights([aisle], flat, () => false);
    const p0 = free.pieces[0] as Extract<(typeof free.pieces)[number], { kind: "box" }>;
    // A street over where the first pole stood, out to 1 m past it.
    const street = (x: number, y: number) => Math.abs(y) > Math.abs(p0.at[1]) - 2 && Math.abs(y) < Math.abs(p0.at[1]) + 1 && Math.abs(x - p0.at[0]) < 5;
    const moved = carParkLights([aisle], flat, () => false, [], street);
    const p1 = moved.pieces[0] as typeof p0;
    expect(street(p1.at[0], p1.at[1])).toBe(false);
    expect(Math.abs(p1.at[1])).toBeGreaterThan(Math.abs(p0.at[1]));
    expect(p1.at[0]).toBeCloseTo(p0.at[0], 6);
  });

  it("leave a pole out when nothing near is clear", () => {
    const n = carParkLights([aisle], flat, () => false).pieces.length;
    const everywhere = (x: number) => x < 30;
    expect(carParkLights([aisle], flat, () => false, [], everywhere).pieces.length).toBeLessThan(n);
  });
});

describe("parked cars on twisted ground", () => {
  const car = { at: [0, 0] as Vec2, dir: [1, 0] as Vec2, paint: 0 };
  // Three wheels on a plane, the front left one `t` higher: no plane goes through all four.
  const twisted = (t: number) => (x: number, y: number) => 5 + (x > 0 && y > 0 ? t : 0);

  it("is lifted so no tyre goes more than TYRE_SINK into the ground", () => {
    const seat = carSeat(car, twisted(0.12));
    expect(seat.sink).toBeLessThanOrEqual(TYRE_SINK + 1e-9);
    // Each tyre's bottom against its ground.
    const tyre = (f: number, s: number) => seat.z + seat.pitch * f + seat.roll * s + 0.02;
    for (const [f, s] of [[1.4, 0.74], [1.4, -0.74], [-1.4, 0.74], [-1.4, -0.74]])
      expect(tyre(f, s) - twisted(0.12)(f, s)).toBeGreaterThanOrEqual(-TYRE_SINK - 1e-9);
    // And no tyre more than MAX_LIFT off it.
    for (const [f, s] of [[1.4, 0.74], [1.4, -0.74], [-1.4, 0.74], [-1.4, -0.74]])
      expect(tyre(f, s) - twisted(0.12)(f, s)).toBeLessThanOrEqual(MAX_LIFT + 1e-9);
  });

  it("stays on its lowest wheel and reports the sink when lifting can't save it", () => {
    const seat = carSeat(car, twisted(0.6));
    expect(seat.sink).toBeGreaterThan(TYRE_SINK);
  });

  it("sits flat on flat ground", () => {
    const seat = carSeat(car, () => 5);
    expect(seat.z).toBeCloseTo(4.98, 9);
    expect(seat).toMatchObject({ pitch: 0, roll: 0, sink: 0 });
  });
});

/** A terrain grid mesh over x0..x1 by y0..y1 every `step` metres, heights from h. */
const grid = (name: string, x0: number, y0: number, x1: number, y1: number, step: number, h: (x: number, y: number) => number): Kn5Node => {
  const mb = new MeshBuilder();
  const nx = Math.round((x1 - x0) / step), ny = Math.round((y1 - y0) / step);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const x = x0 + i * step, y = y0 + j * step; mb.vertex([x, y, h(x, y)], 0, 0); }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const p = j * (nx + 1) + i; mb.quad(p, p + 1, p + nx + 2, p + nx + 1); }
  return mb.toKn5(name, "grass");
};

describe("the ground check reads every bottom edge", () => {
  // Ground 30 cm up everywhere but a dip to 10.0 at the middle of the wall's line (x = 0, y = 5).
  const dip = (x: number, y: number) => 10 + 0.3 * Math.min(1, Math.hypot(x, y - 5) / 3);
  it("judges a wall standing in a dip along an edge listed high id to low", () => {
    const mb = new MeshBuilder();
    const v0 = mb.vertex([0, 10, 9.98], 0, 0), v1 = mb.vertex([0, 0, 9.98], 0, 0), v2 = mb.vertex([0, 0, 12], 0, 0), v3 = mb.vertex([0, 10, 12], 0, 0);
    // The bottom edge only as v1 -> v0 (high id to low).
    mb.tri(v1, v0, v3); mb.tri(v1, v3, v2);
    const world = group("track", [group("TERRAIN", [grid("1GRASS_t000", -20, -20, 20, 30, 0.5, dip)]), group("BUILDINGS", [mb.toKn5("1WALL_BLD_000", "brick")])]);
    expect(checkGround(world).off).toEqual([]);
  });
});

describe("lot fences and front walls on uneven ground", () => {
  // A drain 1 m deep and 2 m wide running north-south at x = 7, across the back fence's line.
  const drain = (x: number) => 10 - Math.max(0, 1 - Math.abs(x - 7));
  const house: Building = {
    ring: [[0, 0], [14, 0], [14, 10], [0, 10]], height: 2.8, type: "house", pitch: 22, roof: "hip", roofColour: 1, facade: 0,
    source: "frontage", front: [[0, 0], [14, 0]], garage: true, setback: 9, frontKind: "limestone",
  };
  const roadGap = (_x: number, y: number) => y + 9;

  it("stand on the ground along their whole length: nothing sunk", () => {
    const lots = buildLots([house], drain, { roadGap, seed: 5 });
    expect(lots.some((m) => m.name.startsWith("1WALL_FENCE_"))).toBe(true);
    expect(lots.some((m) => m.name.startsWith("1WALL_FRONT_"))).toBe(true);
    const world = group("track", [group("TERRAIN", [grid("1GRASS_t000", -20, -30, 40, 30, 0.25, drain)]), group("LOTS", lots)]);
    expect(checkGround(world).off).toEqual([]);
    // Every fence and wall vertex is on or over the ground (2 cm in at the foot), in the drain and out of it.
    for (const m of lots.filter((m) => /^1WALL_(FENCE|FRONT)/.test(m.name))) {
      for (let i = 0; i < m.positions.length; i += 3) {
        const x = m.positions[i], h = m.positions[i + 1];
        expect(h).toBeGreaterThanOrEqual(drain(x) - 0.02 - 1e-4);
      }
    }
  });
});
