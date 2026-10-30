import { describe, expect, it } from "vitest";
import type { Vec2 } from "../src/core/geo";
import { IDENTITY, type Kn5Node } from "../src/core/kn5";
import { buildKerbside, type Carriageway, type KerbSlot } from "../src/core/kerbside";
import { MeshBuilder } from "../src/core/mesh";
import { buildParkedCars } from "../src/core/parkedCars";
import { checkParked, carsFromWalls } from "../src/core/parkedCheck";
import { clearParked } from "../src/core/parkedClear";
import {
  BAY_WIDTH, buildBayPads, carsOverlap, gridAngle, PAD_LIFT, placeParked, snapToBays, type Aisle, type PhotoCar, type PlacedCar,
} from "../src/core/parkedPlacement";
import { blobFrame, isStrip, paintOutCars } from "../src/core/carpark";

const free = () => false;
/** An east-west aisle along y = 0 from x = 0 to 80, 6 m wide. */
const aisle: Aisle = { pts: [[0, 0], [40, 0], [80, 0]], width: 6 };
const car = (x: number, y: number, dir: Vec2, extra: Partial<PhotoCar> = {}): PhotoCar => ({ at: [x, y], dir, paint: 3, ...extra });
const unit = (deg: number): Vec2 => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];

function noOverlaps(cars: PlacedCar[]) {
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) expect(carsOverlap(cars[i], cars[j], 0)).toBe(false);
}

describe("car footprints", () => {
  it("tells cars side by side in bays from cars driven into each other", () => {
    const north: Vec2 = [0, 1];
    expect(carsOverlap({ at: [0, 0], dir: north }, { at: [2.6, 0], dir: north })).toBe(false);
    expect(carsOverlap({ at: [0, 0], dir: north }, { at: [1.5, 0], dir: north })).toBe(true);
    // Crossed: one along x, one along y, middles 2 m apart.
    expect(carsOverlap({ at: [0, 0], dir: [1, 0] }, { at: [2, 1], dir: north })).toBe(true);
    // End to end in parallel bays 6 m apart.
    expect(carsOverlap({ at: [0, 0], dir: [1, 0] }, { at: [6, 0], dir: [1, 0] })).toBe(false);
  });
});

describe("car park grid", () => {
  it("finds the direction the aisles run, whichever way round", () => {
    const th = (10 * Math.PI) / 180;
    const along: Vec2 = [Math.cos(th), Math.sin(th)], across: Vec2 = [-Math.sin(th), Math.cos(th)];
    const loop: Vec2[] = [[0, 0], [along[0] * 50, along[1] * 50], [along[0] * 50 + across[0] * 30, along[1] * 50 + across[1] * 30], [across[0] * 30, across[1] * 30], [0, 0]];
    expect((gridAngle([loop], [20, 10], 100) * 180) / Math.PI).toBeCloseTo(10, 5);
    // Nothing near: 0.
    expect(gridAngle([loop], [1000, 1000], 50)).toBe(0);
  });

  it("snaps positions to bays a pitch apart, one car a bay", () => {
    const { phase, bays } = snapToBays([0.2, 2.7, 5.3, 5.5].map((along, i) => ({ along, item: i })), BAY_WIDTH);
    expect(phase).toBeGreaterThan(0.1);
    expect(phase).toBeLessThan(0.3);
    expect([...bays.keys()].sort()).toEqual([0, 1, 2]);
    expect(bays.get(2)).toBe(2); // 5.3 is nearer bay 2's middle than 5.5
  });
});

describe("parked cars in car park bays", () => {
  it("puts a row of photo cars into nose-in bays 2.6 m apart, square to the aisle, whatever the photo guessed", () => {
    // A row north of the aisle, centres about 6 m out, the photo's directions all over the place.
    const photo = [car(10.1, 6.3, unit(20)), car(12.8, 5.8, unit(75)), car(15.2, 6.1, unit(140)), car(17.9, 6.0, unit(95), { row: "nose" })];
    const r = placeParked(photo, { aisles: [aisle], slots: [], blocked: free });
    expect(r.cars).toHaveLength(4);
    const ys = r.cars.map((c) => c.at[1]);
    for (const y of ys) expect(y).toBeCloseTo(ys[0], 6);
    const xs = r.cars.map((c) => c.at[0]).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(BAY_WIDTH, 6);
    for (const c of r.cars) expect(Math.abs(c.dir[1])).toBeCloseTo(1, 6); // pointing north-south, nose in
    expect(r.bays).toHaveLength(4);
    noOverlaps(r.cars);
  });

  it("keeps one car a bay, and the photo's colours", () => {
    const photo = [car(10, 6, [0, 1], { paint: 8 }), car(10.4, 6.2, [0, 1], { paint: 1 }), car(12.6, 6, [0, 1], { paint: 7 })];
    const r = placeParked(photo, { aisles: [aisle], slots: [], blocked: free });
    expect(r.cars.map((c) => c.paint).sort()).toEqual([7, 8]);
  });

  it("fills the empty bays between cars with pad, not past them", () => {
    const r = placeParked([car(10, 6, [0, 1]), car(15.2, 6, [0, 1])], { aisles: [aisle], slots: [], blocked: free });
    expect(r.cars).toHaveLength(2);
    expect(r.bays).toHaveLength(3); // the two cars' bays and the one between
  });

  it("drops cars in the aisle, far from any aisle, and where something stands", () => {
    const r = placeParked([car(30, 0.4, [1, 0]), car(30, 200, [1, 0]), car(50, 6, [0, 1])], {
      aisles: [aisle], slots: [], blocked: (x, y) => x > 48 && x < 52 && y > 3,
    });
    expect(r.cars).toHaveLength(0);
    expect(r.dropped).toEqual({ aisle: 1, noBay: 1, blocked: 1, overlap: 0 });
  });

  it("follows a turned car park's grid", () => {
    // The same aisle turned 30 degrees, and a row beside it.
    const t = unit(30), n: Vec2 = [-t[1], t[0]];
    const turned: Aisle = { pts: [[0, 0], [t[0] * 80, t[1] * 80]], width: 6 };
    const photo = [10, 12.6, 15.2].map((s) => car(t[0] * s + n[0] * 6, t[1] * s + n[1] * 6, unit(110)));
    const r = placeParked(photo, { aisles: [turned], slots: [], blocked: free });
    expect(r.cars).toHaveLength(3);
    for (const c of r.cars) expect(Math.abs(c.dir[0] * n[0] + c.dir[1] * n[1])).toBeCloseTo(1, 6);
  });

  it("never leaves two cars overlapping", () => {
    // Two lone cars the photo saw crossed over each other.
    const r = placeParked([car(20, 6, [1, 0]), car(21, 7, [0, 1])], { aisles: [aisle], slots: [], blocked: free });
    expect(r.cars).toHaveLength(1);
    expect(r.dropped.overlap).toBe(1);
  });
});

describe("parked cars along streets", () => {
  const slots: KerbSlot[] = [0, 6, 12].map((x) => ({ at: [x + 3, 4.9], dir: [1, 0], kind: "parallel", street: 1, photo: false }));

  it("puts a car in the nearest painted bay it lines up with, parallel to the kerb", () => {
    const r = placeParked([car(8.6, 4.4, [-0.98, 0.2], { paint: 8 })], { aisles: [], slots, blocked: free });
    expect(r.cars).toEqual([{ at: [9, 4.9], dir: [1, 0], paint: 8, kerb: true }]);
  });

  it("drops a nose-in row along a street with parallel bays, and cars where nothing's painted", () => {
    const row = [2, 4.6, 7.2, 9.8].map((x) => car(x, 5.5, [0, 1], { row: "nose" }));
    const r = placeParked([...row, car(100, 5, [1, 0])], { aisles: [], slots, blocked: free });
    expect(r.cars).toHaveLength(0);
    expect(r.dropped.noBay).toBe(5);
  });

  it("lets kerbside cars stand on their street, but not in a lane", () => {
    const placed: PlacedCar[] = [{ at: [9, 4.9], dir: [1, 0], paint: 0, kerb: true }, { at: [15, 4.9], dir: [1, 0], paint: 0 }];
    const street = (_x: number, y: number) => Math.abs(y) - 6; // a 12 m street along y = 0
    expect(clearParked(placed, { road: () => null, street }).kept).toEqual([placed[0]]);
    expect(clearParked(placed, { road: () => null, street, lane: (_x, y) => Math.abs(y - 4) }).kept).toEqual([]);
  });
});

describe("kerbside bays as slots", () => {
  const street = (w: number): Carriageway => {
    const pts: Vec2[] = [];
    for (let x = 0; x <= 60; x += 4) pts.push([x, 0]);
    return { pts, widths: pts.map(() => w), z: () => 10, photoParking: true };
  };
  const way = (left: object, right: object) => ({ pts: [[0, 0], [60, 0]] as Vec2[], left, right });

  it("gives every painted parallel bay a slot, cars facing their side's traffic", () => {
    const r = buildKerbside([street(12)], [way({ parking: "parallel" }, { parking: "parallel" })]);
    expect(r.slots.length).toBe(r.bays);
    const left = r.slots.filter((s) => s.at[1] > 0), right = r.slots.filter((s) => s.at[1] < 0);
    expect(left.length).toBeGreaterThan(5);
    for (const s of left) {
      expect(s.dir[0]).toBeCloseTo(1, 6);
      expect(s.at[1]).toBeCloseTo(6 - 0.1 - 1.05, 6);
      expect(s.photo).toBe(false);
    }
    for (const s of right) expect(s.dir[0]).toBeCloseTo(-1, 6);
    const xs = left.map((s) => s.at[0]).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(6, 6);
  });

  it("points a car in a 90-degree bay at the kerb", () => {
    const r = buildKerbside([street(18)], [way({ parking: "perpendicular" }, {})]);
    expect(r.slots.length).toBeGreaterThan(5);
    for (const s of r.slots) {
      expect(s.kind).toBe("perpendicular");
      expect(s.dir[1]).toBeCloseTo(1, 6);
    }
  });

  it("doesn't read a footpath strip beside the kerb as parking", () => {
    // "Cars" 1.5 m out past the kerb of a 10 m street, end to end along it.
    const strip = [10, 16, 22, 28].map((x) => ({ at: [x, 6.5] as Vec2, dir: [1, 0] as Vec2 }));
    expect(buildKerbside([street(10)], [], strip).slots).toHaveLength(0);
    // The same cars on the carriageway along the kerb make bays.
    const parked = strip.map((c) => ({ ...c, at: [c.at[0], 3.9] as Vec2 }));
    const r = buildKerbside([street(10)], [], parked);
    expect(r.slots.length).toBeGreaterThan(0);
    expect(r.slots.every((s) => s.photo)).toBe(true);
  });
});

describe("photo strips that aren't cars", () => {
  const size = 400, mpp = 0.2;
  /** Pixels of a w x h metre box at (x, y) metres, coloured by `col(u)` along it. */
  function blob(x: number, y: number, w: number, h: number, col: (u: number) => [number, number, number]) {
    const rgba = new Uint8Array(size * size * 4), comp: number[] = [];
    for (let py = Math.round(y / mpp); py < Math.round((y + h) / mpp); py++)
      for (let px = Math.round(x / mpp); px < Math.round((x + w) / mpp); px++) {
        const i = py * size + px;
        comp.push(i);
        rgba.set([...col(px * mpp - x), 255], i * 4);
      }
    return { rgba, comp };
  }

  it("calls a long pale footpath a strip, and a row of different cars not", () => {
    const path = blob(10, 10, 30, 1.6, () => [190, 190, 186]);
    expect(isStrip(path.comp, size, mpp, path.rgba)).toBe(true);
    const colours: [number, number, number][] = [[240, 240, 238], [30, 30, 34], [150, 26, 28], [186, 189, 193]];
    const row = blob(10, 10, 24, 2, (u) => colours[Math.floor(u / 6) % 4]);
    expect(isStrip(row.comp, size, mpp, row.rgba)).toBe(false);
    // One even dark strip, long: a kerb shadow, not cars.
    const shadow = blob(10, 10, 30, 1.4, () => [40, 42, 44]);
    expect(isStrip(shadow.comp, size, mpp, shadow.rgba)).toBe(true);
    // Short: two cars end to end, never a strip.
    const two = blob(10, 10, 10, 1.8, () => [190, 190, 186]);
    expect(blobFrame(two.comp, size, mpp).L).toBeLessThan(12);
    expect(isStrip(two.comp, size, mpp, two.rgba)).toBe(false);
  });

  it("leaves a 30 m blob along a street in the photo, but takes a row that long in a car park", () => {
    // Asphalt with a 30 x 2 m blob of changing colours along it (a footpath with bins, fences and gardens).
    const colours: [number, number, number][] = [[205, 205, 200], [40, 60, 120], [235, 235, 232], [20, 20, 24], [170, 175, 190]];
    const rgba = new Uint8Array(size * size * 4);
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const x = px * mpp, y = py * mpp;
      rgba.set([...(x > 20 && x < 50 && y > 40 && y < 42 ? colours[Math.floor((x - 20) / 3) % 5] : [80, 82, 84]), 255], (py * size + px) * 4);
    }
    const street = paintOutCars(rgba, size, mpp, undefined, { carParks: new Uint8Array(size * size) });
    expect(street.spots).toHaveLength(0);
    const park = paintOutCars(rgba, size, mpp, undefined, { carParks: new Uint8Array(size * size).fill(1) });
    expect(park.spots.length).toBeGreaterThan(0);
  });
});

describe("bay pads and the parked check", () => {
  /** A flat grass square, side `n` metres, its corner at the origin, at height h. */
  function grass(n: number, h: number): Kn5Node {
    const mb = new MeshBuilder();
    mb.vertex([0, 0, h], 0, 0); mb.vertex([n, 0, h], 1, 0); mb.vertex([n, n, h], 1, 1); mb.vertex([0, n, h], 0, 1);
    mb.quad(0, 1, 2, 3);
    return mb.toKn5("1GRASS_t000", "grass");
  }
  const group = (name: string, children: Kn5Node[]): Kn5Node => ({ kind: "node", name, transform: IDENTITY, children });

  it("lays invisible asphalt pads a centimetre over the ground", () => {
    const pads = buildBayPads([[[0, 0], [2.7, 0], [2.7, 5.4], [0, 5.4]]], (x) => 3 + x * 0.01);
    expect(pads).toHaveLength(1);
    expect(pads[0].name).toMatch(/^1STREET_CARPARK_/);
    expect(pads[0].renderable).toBe(false);
    const p = pads[0].positions;
    for (let i = 0; i < p.length; i += 3) expect(p[i + 1]).toBeCloseTo(3 + p[i] * 0.01 + PAD_LIFT, 5);
    for (let i = 1; i < pads[0].normals.length; i += 3) expect(pads[0].normals[i]).toBeGreaterThan(0.99);
  });

  it("finds overlapping cars, cars on grass and cars outside any bay", () => {
    const placed = placeParked([car(10, 6, [0, 1]), car(12.6, 6, [0, 1])], { aisles: [aisle], slots: [], blocked: free });
    const pads = buildBayPads(placed.bays, () => 1);
    const ground = (x: number, y: number) => (placed.bays.length && x > 7 && x < 16 && y > 3 && y < 9 ? 1 + PAD_LIFT : 1);
    const bad: PlacedCar[] = [{ at: [40, 30], dir: [1, 0], paint: 0 }, { at: [41, 31], dir: [0, 1], paint: 0 }];
    const cars = buildParkedCars([...placed.cars, ...bad], ground);
    const root = group("root", [group("TERRAIN", [grass(80, 1)]), group("CARPARKS", pads), group("PARKED_CAR_WALLS", cars.filter((m) => m.name.startsWith("1WALL")))]);
    expect(carsFromWalls(root)).toHaveLength(4);
    const r = checkParked(root);
    expect(r.cars).toBe(4);
    expect(r.overlapping).toHaveLength(1);
    expect(r.offAsphalt.map((c) => c.on)).toEqual(["grass", "grass"]);
    expect(r.outsideBays).toHaveLength(2);
    // The bay cars pass on every count.
    for (const c of [...r.offAsphalt, ...r.outsideBays]) expect(c.x).toBeGreaterThan(35);
  });
});
