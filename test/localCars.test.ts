import { describe, expect, it } from "vitest";
import type { Vec2 } from "../src/core/geo";
import { checkGround } from "../src/core/groundCheck";
import { MAX_MESH_VERTICES, type Kn5MeshNode, type Kn5Node } from "../src/core/kn5";
import {
  assignModels, bodyClear, boxOf, buildLocalCars, footprintsOverlap, carModel, CLUSTER, COLOURS, countByBody, FALLBACK, LOD0_OUT, LOD1_OUT, MIX, modelBoxes, pickCar,
  reachOf, ROOM, VARIANT_MIX, wheelContacts, withModel,
} from "../src/core/localCars";
import { MeshBuilder } from "../src/core/mesh";
import { carSeat } from "../src/core/parkedCars";
import { carsFromWalls, checkParked, wheelPoints } from "../src/core/parkedCheck";
import { carFootprint, parkedConflict } from "../src/core/parkedClear";
import { carsOverlap } from "../src/core/parkedPlacement";
import { BODIES } from "../src/core/vehicles/index";

const group = (name: string, children: Kn5Node[]): Kn5Node => ({ kind: "node", name, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children });
/** A flat square physics mesh at height z. */
const square = (name: string, x0: number, y0: number, x1: number, y1: number, z: number) => {
  const mb = new MeshBuilder();
  const a = mb.vertex([x0, y0, z], 0, 0), b = mb.vertex([x1, y0, z], 1, 0), c = mb.vertex([x1, y1, z], 1, 1), d = mb.vertex([x0, y1, z], 0, 1);
  mb.quad(a, b, c, d);
  return mb.toKn5(name, "grass");
};
/** Bays spread over a square, a few hundred metres across, with headings all round. */
const bays = (n: number): { at: Vec2; dir: Vec2 }[] => Array.from({ length: n }, (_, i) => {
  const a = i * 2.399963;
  return { at: [((i * 37.1) % 400) - 200 + 0.13 * i, ((i * 53.7) % 400) - 200], dir: [Math.cos(a), Math.sin(a)] };
});

describe("local cars: picking", () => {
  it("picks the same car for a bay every time, from the bay rounded to 0.5 m and the slug", () => {
    const a = pickCar([10.1, 20.1], 2, "busselton", 5.4);
    expect(pickCar([10.1, 20.1], 2, "busselton", 5.4)).toEqual(a);
    expect(pickCar([10.2, 19.9], 2, "busselton", 5.4)).toEqual(a);
    // Another slug draws again: over many bays some picks differ.
    const differ = bays(200).filter((b) => JSON.stringify(pickCar(b.at, 2, "busselton", 6)) !== JSON.stringify(pickCar(b.at, 2, "other", 6)));
    expect(differ.length).toBeGreaterThan(100);
  });

  it("follows the base mix where everything fits", () => {
    const n = 6000, count: Record<string, number> = {};
    for (const b of bays(n)) {
      const p = pickCar(b.at, 2, "busselton", 6);
      count[p.body] = (count[p.body] ?? 0) + 1;
    }
    const total = Object.values(MIX).reduce((a, b) => a + b, 0);
    for (const [b, w] of Object.entries(MIX)) expect(Math.abs(count[b] / n - w / total), b).toBeLessThan(0.02);
  });

  it("only puts a body and variant in a bay it fits", () => {
    let utes = 0;
    for (const b of bays(3000)) {
      const p = pickCar(b.at, 2, "busselton", ROOM.noseIn);
      expect(reachOf(carModel(p.body, p.variant))).toBeLessThanOrEqual(ROOM.noseIn + 1e-9);
      if (p.body === "ute") utes++;
    }
    // The dual cab is 5.35 m: it still fits a 5.4 m bay (plain or with a sports bar).
    expect(utes).toBeGreaterThan(300);
    // A bay nothing fits gets the fallback.
    expect(pickCar([0, 0], 2, "busselton", 4)).toMatchObject(FALLBACK);
    // Variants: every one turns up somewhere in long bays.
    const seen = new Set<string>();
    for (const b of bays(6000)) { const p = pickCar(b.at, 2, "busselton", 6); seen.add(`${p.body}/${p.variant}`); }
    for (const [b, vs] of Object.entries(VARIANT_MIX)) for (const v of Object.keys(vs)) expect(seen.has(`${b}/${v}`), `${b}/${v}`).toBe(true);
  });

  it("keeps a clearly coloured photo's paint, and draws neutrals from the body's colour table", () => {
    for (const b of bays(300)) expect(pickCar(b.at, 8, "busselton", 6).paint).toBe(8);
    const white = { ute: [0, 0], car: [0, 0] };
    for (const b of bays(6000)) {
      const p = pickCar(b.at, 3, "busselton", 6);
      const k = p.body === "ute" ? "ute" : ["hatch", "sedan", "suv", "suvsmall"].includes(p.body) ? "car" : null;
      if (!k) continue;
      white[k][1]++;
      if (p.paint <= 1) white[k][0]++;
    }
    expect(white.ute[0] / white.ute[1]).toBeCloseTo(0.55, 1);
    expect(white.car[0] / white.car[1]).toBeCloseTo(0.26, 1);
    for (const t of Object.values(COLOURS)) expect(t.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });
});

describe("local cars: sizes", () => {
  it("knows every model's box, and the wheels go with it", () => {
    const boxes = modelBoxes();
    // Every body (and the long sedan) has its own box size.
    expect(boxes.length).toBe(BODIES.length + 1);
    const ute = boxes.find((b) => Math.abs(b.length - (5.35 - 0.1)) < 1e-6)!;
    expect(ute.dims.wheelbase).toBe(3.2);
  });

  it("seats a car on its own wheels, tilted with the ground", () => {
    const car = withModel({ at: [3, 4] as Vec2, dir: [0.6, 0.8] as Vec2, paint: 0 }, "ute", "plain");
    const slope = (x: number, y: number) => 2 + 0.03 * x - 0.02 * y;
    const seat = carSeat(car, slope);
    for (const [f, s] of wheelContacts(car.model.dims)) {
      const x = car.at[0] + car.dir[0] * f - car.dir[1] * s, y = car.at[1] + car.dir[1] * f + car.dir[0] * s;
      expect(seat.z + seat.pitch * f + seat.roll * s).toBeCloseTo(slope(x, y), 6);
    }
    expect(seat.sink).toBeLessThan(1e-9);
  });

  it("needs the ground clear under the body, not just under the wheels", () => {
    const car = withModel({ at: [0, 0] as Vec2, dir: [1, 0] as Vec2, paint: 0 }, "ute", "plain");
    const flat = () => 0;
    expect(bodyClear(car, carSeat(car, flat), flat)).toBe(true);
    // A kerb 15 cm high 1.2 m to the car's left: under the body (half width 0.95) but clear of the tyres (0.8).
    const kerb = (_x: number, y: number) => (y > 0.85 ? 0.2 : 0);
    const seat = carSeat(car, kerb);
    expect(seat.sink).toBe(0);
    expect(bodyClear(car, seat, kerb)).toBe(false);
  });

  it("clears and overlaps by the model's own footprint", () => {
    const ute = withModel({ at: [0, 0] as Vec2, dir: [1, 0] as Vec2, paint: 0 }, "ute", "full");
    expect(carFootprint(ute.at, ute.dir, 0.5, ute.len, ute.wid).some(([x]) => x > 2.8)).toBe(true);
    // A road 2.6 m ahead: clear of the old 4.5 m car, not of a ute with a bull bar.
    const road = (x: number) => (x > 2.6 ? 0 : null);
    expect(parkedConflict({ at: [0, 0], dir: [1, 0] }, { road })).toBeNull();
    expect(parkedConflict(ute, { road })).toBe("road");
    const behind = { ...ute, at: [5.5, 0] as Vec2 };
    expect(carsOverlap({ at: [0, 0], dir: [1, 0] }, { at: [5.5, 0], dir: [1, 0] })).toBe(false);
    expect(carsOverlap(ute, behind)).toBe(true);
  });
});

describe("local cars: in bays", () => {
  it("gives a car the fallback where its pick would reach a neighbour or somewhere blocked", () => {
    // Parallel bays only 4.55 m apart (the old cars with 5 cm to spare): anything but the shortest
    // cars would overlap, and a car given a big body first falls back when the next one can't fit.
    for (const slug of ["busselton", "a", "b", "c"]) {
      const row = Array.from({ length: 30 }, (_, i) => ({ at: [i * 4.55, 0] as Vec2, dir: [1, 0] as Vec2, paint: 2, room: 6 }));
      const { cars, fallback } = assignModels(row, slug);
      expect(fallback).toBeGreaterThan(5);
      for (let i = 1; i < cars.length; i++) expect(footprintsOverlap(cars[i - 1], cars[i], 0), `${slug} ${i}`).toBe(false);
    }
    // A wall 2.5 m in front of every nose: only cars shorter than 5 m stay as picked.
    const lone = Array.from({ length: 40 }, (_, i) => ({ at: [i * 10, 0] as Vec2, dir: [0, 1] as Vec2, paint: 2 }));
    const walled = assignModels(lone, "busselton", (_x, y) => y > 2.5);
    for (const c of walled.cars) expect(c.model.body === FALLBACK.body || reachOf(c.model) <= 5 + 1e-9).toBe(true);
  });
});

describe("local cars: meshes", () => {
  const ground = () => 5;
  const row = (n: number, x0 = 0, y0 = 0): ReturnType<typeof withModel<{ at: Vec2; dir: Vec2; paint: number }>>[] =>
    assignModels(Array.from({ length: n }, (_, i) => ({ at: [x0 + i * 2.6, y0] as Vec2, dir: [0, i % 2 ? 1 : -1] as Vec2, paint: i % 12 })), "busselton").cars;

  it("writes two LODs per 40 m cluster with their draw distances", () => {
    const cars = [...row(10, 2, 2), ...row(10, 202, 2)];
    const { visual, walls } = buildLocalCars(cars, ground);
    const near = visual.filter((m) => m.name.startsWith("PARKED_CARS_NEAR_")), far = visual.filter((m) => m.name.startsWith("PARKED_CARS_FAR_"));
    expect(near).toHaveLength(2);
    expect(far).toHaveLength(2);
    for (const m of near) expect([m.lodIn, m.lodOut]).toEqual([0, LOD0_OUT]);
    for (const m of far) expect([m.lodIn, m.lodOut]).toEqual([LOD0_OUT, LOD1_OUT]);
    // Far is a lot lighter.
    const tris = (ms: Kn5MeshNode[]) => ms.reduce((a, m) => a + m.indices.length / 3, 0);
    expect(tris(far)).toBeLessThan(tris(near) / 2.5);
    expect(walls.every((w) => w.renderable === false && w.name.startsWith("1WALL_CAR_"))).toBe(true);
    expect(CLUSTER).toBe(40);
  });

  it("splits a big cluster under the vertex limit", () => {
    // 200 cars in two rows within one 40 m cell (more than fit one mesh).
    const cars = [...row(15, 0.5, 1), ...row(15, 0.5, 8), ...row(15, 0.5, 15), ...row(15, 0.5, 22), ...row(15, 0.5, 29), ...row(15, 0.5, 36)];
    const { visual } = buildLocalCars([...cars, ...cars.map((c) => ({ ...c, at: [c.at[0], c.at[1] + 0.001] as Vec2 }))], ground);
    expect(visual.filter((m) => m.name.startsWith("PARKED_CARS_NEAR_")).length).toBeGreaterThan(1);
    for (const m of visual) expect(m.positions.length / 3).toBeLessThanOrEqual(MAX_MESH_VERTICES);
  });

  it("stands every car on its wheels, and the checks read the models back", () => {
    const cars = row(12, 2, 2);
    const { visual, walls } = buildLocalCars(cars, ground);
    // The lowest point of the visual cars is the ground (AC y is up).
    let lo = Infinity;
    for (const m of visual) for (let i = 1; i < m.positions.length; i += 3) lo = Math.min(lo, m.positions[i]);
    expect(lo).toBeCloseTo(5, 4);
    const world = group("track", [
      group("TERRAIN", [square("1GRASS_000", -20, -20, 80, 30, 5)]),
      group("CARPARKS", [square("1STREET_CARPARK_000", -10, -10, 60, 15, 5.01)]),
      group("PARKED_CARS", visual),
      group("PARKED_CAR_WALLS", walls),
    ]);
    const back = carsFromWalls(world);
    expect(back).toHaveLength(cars.length);
    for (const c of back) {
      const orig = cars.find((o) => Math.hypot(o.at[0] - c.at[0], o.at[1] - c.at[1]) < 0.01)!;
      const bx = boxOf(orig.model.dims);
      expect(c.len).toBeCloseTo(bx.length, 3);
      expect(c.wid).toBeCloseTo(bx.width, 3);
      expect(c.wheels).toHaveLength(orig.model.dims.frontAxle * 2 === orig.model.dims.wheelbase ? 4 : 8);
      expect(wheelPoints(c)).toHaveLength(c.wheels!.length + 1);
    }
    const parked = checkParked(world);
    expect(parked.overlapping).toEqual([]);
    expect(parked.offAsphalt).toEqual([]);
    expect(parked.outsideBays).toEqual([]);
    const g = checkGround(world);
    expect(g.off).toEqual([]);
    expect(g.checked.PARKED_CARS).toBeGreaterThan(cars.length);
  });

  it("stands every body and variant at any heading, as the ground check sees it", () => {
    const cars = BODIES.flatMap((b, i) => Object.keys(b.variants).map((v, j) => {
      const a = 0.37 * (i * 7 + j);
      return withModel({ at: [i * 8, j * 8] as Vec2, dir: [Math.cos(a), Math.sin(a)] as Vec2, paint: j }, b.id, v);
    }));
    const { visual, walls } = buildLocalCars(cars, ground);
    const world = group("track", [group("TERRAIN", [square("1GRASS_000", -20, -20, 100, 80, 5)]), group("PARKED_CARS", visual), group("PARKED_CAR_WALLS", walls)]);
    expect(checkGround(world).off).toEqual([]);
    expect(countByBody(cars)).toMatchObject({ ute: 6, hatch: 2 });
  });
});
