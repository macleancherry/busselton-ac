import { describe, expect, it } from "vitest";
import { carsInLanes, objectOffsets, overlapping, sampler, splitObjects, surfaceSteps, type RawMesh } from "../scripts/check/benchmarkLib";

/** An axis-aligned box as an AC mesh (x, y up, z = -north), local x0..x1, y0..y1 (north), z0..z1 (up). */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const p: number[] = [];
  for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) p.push(x, z, -y);
  const i = [0, 1, 3, 0, 3, 2, 4, 5, 7, 4, 7, 6, 0, 1, 5, 0, 5, 4];
  return { p, i };
}
function merge(name: string, parts: { p: number[]; i: number[] }[]): RawMesh {
  const p: number[] = [], i: number[] = [];
  for (const part of parts) { const o = p.length / 3; p.push(...part.p); i.push(...part.i.map((k) => k + o)); }
  return { name, p, i };
}
/** A flat square of ground at height h, x and y from -s to s. */
const flat = (name: string, h: number, s = 50): RawMesh => ({ name, p: [-s, h, s, s, h, s, s, h, -s, -s, h, -s], i: [0, 1, 2, 0, 2, 3] });

describe("benchmark numbers", () => {
  it("splits a merged mesh into objects, joining touching pieces", () => {
    // A car body and a wheel touching it, and a second car 10 m away.
    const mesh = merge("PARKED_CARS_0", [box(0, 4, 0, 2, 0.3, 1.5), box(0.5, 1, -0.1, 0.1, 0, 0.6), box(10, 14, 0, 2, 0, 1.5)]);
    const objs = splitObjects([mesh], () => "car");
    expect(objs).toHaveLength(2);
    const first = objs.find((o) => o.min[0] < 5)!;
    expect(first.base).toBe(0);
    expect(first.contact[0]).toBeCloseTo(0.75);
    // A pole in one mesh and its head in another join up when passed together.
    const pole = merge("FURNITURE_STEEL_0", [box(0, 0.2, 0, 0.2, -0.5, 8)]);
    const head = merge("FURNITURE_LAMP_0", [box(0.25, 1, 0, 0.2, 7.8, 8)]);
    const lamps = splitObjects([pole, head], (names) => (names.has("FURNITURE_LAMP_0") ? "light" : "pole"));
    expect(lamps).toHaveLength(1);
    expect(lamps[0]).toMatchObject({ kind: "light", base: -0.5 });
    // "inside": wheels under a body join it; cars touching nose to tail, or overlapping a little, stay apart.
    const row = merge("PARKED_CARS_0", [box(0, 4, 0, 2, 0.3, 1.5), box(0.5, 1, 0, 0.3, 0, 0.6), box(3, 3.5, 1.7, 2, 0, 0.6), box(4, 8, 0, 2, 0, 1.5), box(7.5, 11.5, 0, 2, 0, 1.5)]);
    const cars = splitObjects([row], () => "car", "inside");
    expect(cars).toHaveLength(3);
    expect(cars.find((c) => c.max[0] === 4)!.base).toBe(0);
    // Footprints as oriented boxes: the long axis along x.
    const plain = cars.find((c) => c.min[0] === 4)!;
    expect(plain.obb.half[0]).toBeCloseTo(2);
    expect(plain.obb.half[1]).toBeCloseTo(1);
    expect(Math.abs(plain.obb.u[0])).toBeCloseTo(1);
    expect(plain.obb.c[0]).toBeCloseTo(6);
  });

  it("measures objects against the surface under them", () => {
    const ground = sampler([flat("1GRASS_t0", 1)]);
    const objs = splitObjects([merge("PARKED_CARS_0", [box(0, 4, 0, 2, 1.2, 2), box(10, 14, 0, 2, 0.9, 2), box(20, 24, 0, 2, 1.01, 2)])], () => "car");
    const [cars] = objectOffsets(objs, ground);
    expect(cars).toMatchObject({ kind: "car", count: 3, floating: 1, sunk: 1 });
    expect(cars.maxFloat).toBeCloseTo(0.2);
    expect(cars.maxSink).toBeCloseTo(-0.1);
    expect(Math.abs(cars.worst!.offset)).toBeCloseTo(0.2);
    // Planted posts only count when buried deep.
    const [posts] = objectOffsets(splitObjects([merge("GUIDEPOSTS_0", [box(0, 0.1, 0, 0.1, 0.7, 2)])], () => "guidepost"), ground);
    expect(posts).toMatchObject({ floating: 0, sunk: 0 });
    // Nothing under it.
    const [lost] = objectOffsets(splitObjects([merge("PARKED_CARS_0", [box(100, 104, 0, 2, 0, 1)])], () => "car"), ground);
    expect(lost.unsupported).toBe(1);
  });

  it("finds steps and lips in the drivable surface", () => {
    // Two road meshes meeting at x = 0 with a 6 cm step, and a third overlapping the first 4 cm lower.
    const a: RawMesh = { name: "1ROAD_0", p: [-10, 1, 10, 0, 1, 10, 0, 1, -10, -10, 1, -10], i: [0, 1, 2, 0, 2, 3] };
    const b: RawMesh = { name: "1STREET_0", p: [0, 1.06, 10, 10, 1.06, 10, 10, 1.06, -10, 0, 1.06, -10], i: [0, 1, 2, 0, 2, 3] };
    const c: RawMesh = { name: "1STREET_1", p: [-10, 0.96, 2, -6, 0.96, 2, -6, 0.96, -2, -10, 0.96, -2], i: [0, 1, 2, 0, 2, 3] };
    // (Off the mesh edges, so no sample lands exactly on the seam and hits both meshes.)
    const s = surfaceSteps(sampler([a, b, c]), [0.13, 0.13], 8, 0.5);
    expect(s.steps).toBeGreaterThan(20);
    expect(s.maxStep).toBeCloseTo(0.06);
    expect(s.maxStepAt![0]).toBeCloseTo(-0.37);
    expect(s.stacked).toBeGreaterThan(0);
    expect(s.maxStack).toBeCloseTo(0.04);
    // A flat road has neither.
    expect(surfaceSteps(sampler([a]), [-5, 0], 4, 0.5)).toMatchObject({ steps: 0, stacked: 0 });
  });

  it("finds cars driven into each other", () => {
    const cars = splitObjects([merge("PARKED_CARS_0", [box(0, 4, 0, 2, 0, 1.5), box(4, 8, 0, 2, 0, 1.5), box(7.5, 11.5, 0, 2, 0, 1.5), box(20, 24, 0, 2, 0, 1.5)])], () => "car", "inside");
    const hit = overlapping(cars);
    // Nose to tail (touching) is fine; the third car is 50 cm into the second.
    expect([...hit].map((c) => c.min[0]).sort((a, b) => a - b)).toEqual([4, 7.5]);
  });

  it("finds parked cars in a traffic lane", () => {
    const cars = splitObjects([merge("PARKED_CARS_0", [box(0, 4, 0, 2, 0, 1.5), box(0, 4, 10, 12, 0, 1.5)])], () => "car");
    // A lane running east along y = 1 (AC z = -1).
    const lanes = [{ points: [[-10, 0, -1], [0, 0, -1], [2, 0, -1], [10, 0, -1]] }];
    const hit = carsInLanes(cars, lanes);
    expect(hit).toHaveLength(1);
    expect(hit[0].min[1]).toBe(0);
  });
});
