import { describe, expect, it } from "vitest";
import { BODIES, body } from "../src/core/vehicles/index";
import { buildUte } from "../src/core/vehicles/ute";
import {
  atlasPixels, ATLAS_H, ATLAS_W, dimensionsOf, meshExtent, PAINT_SLOT, PLATE_H, PLATE_W, SW, swatchUv, type VehicleMesh,
} from "../src/core/vehicles/vehicle";
import { onSwatch, rayCheck, roadWheels, tris, vert, VIEWS } from "./vehicleMesh";

/** The plan's caps per body (docs/plans/local-cars.md): plain, and with extras. */
const CAP = { 0: { plain: 360, extras: 460 }, 1: { plain: 110, extras: 170 } } as const;
const LODS = [0, 1] as const;

describe.each(BODIES.map((b) => [b.id, b] as const))("local cars: %s", (_id, b) => {
  const variants = Object.entries(b.variants);
  const plain = (lod: 0 | 1) => b.build(b.variants.plain, lod);
  const spec = { ...b.defaults, ...b.variants.plain };

  it("has a plain variant first and a full one last", () => {
    expect(variants[0][0]).toBe("plain");
    expect(variants[variants.length - 1][0]).toBe("full");
  });

  it("stays inside the triangle caps at both LODs, every variant", () => {
    for (const lod of LODS) {
      expect(tris(plain(lod))).toBeLessThanOrEqual(CAP[lod].plain);
      for (const [, v] of variants) expect(tris(b.build(v, lod))).toBeLessThanOrEqual(CAP[lod].extras);
      // LOD 1 is the far one: well under LOD 0.
      expect(tris(plain(1))).toBeLessThan(tris(plain(0)) * 0.5);
    }
  });

  it("is a valid mesh: whole triangles, indices in range, uvs inside the atlas, no NaN, no slivers", () => {
    for (const lod of LODS) for (const [, v] of variants) {
      const m = b.build(v, lod);
      const n = m.pos.length / 3;
      expect(m.idx.length % 3).toBe(0);
      expect(m.uv.length).toBe(n * 2);
      expect(m.paint.length).toBe(n);
      expect(m.idx.every((i) => Number.isInteger(i) && i >= 0 && i < n)).toBe(true);
      expect(m.pos.every(Number.isFinite)).toBe(true);
      expect(m.uv.every((x) => x >= 0 && x <= 1)).toBe(true);
      for (let t = 0; t < tris(m); t++) {
        const [a, p, c] = [0, 1, 2].map((k) => vert(m, m.idx[t * 3 + k]));
        const e1 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
        expect(area).toBeGreaterThan(1e-6);
      }
    }
  });

  it("has a dimensions record from its spec", () => {
    const d = b.dimensions(b.variants.plain);
    expect(d).toEqual(dimensionsOf(spec));
    expect(d.length).toBe(spec.length);
    expect(d.frontAxle - d.wheelbase).toBeGreaterThan(-d.length / 2); // the rear axle is on the car
    expect(d.frontAxle).toBeLessThan(d.length / 2);
  });

  it("is built to its dimensions: length, width (not mirrors), height within a few cm", () => {
    for (const lod of LODS) {
      const m = plain(lod), e = meshExtent(m), d = b.dimensions(b.variants.plain);
      expect(Math.abs(e.front - e.rear - d.length)).toBeLessThan(0.04);
      expect(Math.abs(e.front + e.rear)).toBeLessThan(0.04); // centred
      expect(Math.abs(e.top - d.height)).toBeLessThan(0.03);
      // Anything past the body's side is a mirror: trim, up at the belt.
      let side = 0;
      for (let i = 0; i < m.pos.length / 3; i++) {
        const [, s, h] = vert(m, i);
        if (Math.abs(s) > d.width / 2 + 0.04) {
          expect(onSwatch(m, i, SW.TRIM)).toBe(true);
          expect(h).toBeGreaterThan(0.75);
        } else side = Math.max(side, Math.abs(s));
      }
      expect(Math.abs(2 * side - d.width)).toBeLessThan(0.05);
      if (lod === 1) expect(e.halfWidth).toBeLessThan(d.width / 2 + 0.04); // no mirrors far
    }
  });

  it("stands its four wheels on the ground at the wheelbase and track", () => {
    for (const lod of LODS) for (const [, v] of variants) {
      const m = b.build(v, lod), d = b.dimensions(v);
      expect(Math.min(...m.pos.filter((_, i) => i % 3 === 2))).toBeGreaterThanOrEqual(-1e-9); // nothing under the ground
      const w = roadWheels(m);
      expect(w.length).toBe(4);
      for (const x of w) {
        expect(x.low).toBeLessThan(0.005); // touching
        expect(Math.abs(Math.abs(x.s) - d.track / 2)).toBeLessThan(0.02);
        const axle = x.f > 0 ? d.frontAxle : d.frontAxle - d.wheelbase;
        expect(Math.abs(x.f - axle)).toBeLessThan(0.02);
      }
    }
  });

  it("is closed: from every side, what you see first is a face turned towards you", () => {
    for (const lod of LODS) for (const [name, v] of variants) {
      const m = b.build(v, lod);
      for (const [view, dir] of VIEWS) {
        const r = rayCheck(m, dir, 24);
        expect(r.hits, `${name} lod${lod} ${view}`).toBeGreaterThan(50);
        // Far LODs leave out arch liners' detail and thin bars' hidden faces: a pixel or two at 70 m.
        expect(r.front / r.hits, `${name} lod${lod} ${view}`).toBeGreaterThan(lod === 0 ? 0.975 : 0.94);
      }
    }
  });

  it("flags its paint vertices, and only those sit on the paint slot", () => {
    for (const lod of LODS) {
      const m = plain(lod);
      const painted = m.paint.filter(Boolean).length;
      expect(painted).toBeGreaterThan(m.paint.length * 0.2);
      expect(painted).toBeLessThan(m.paint.length * 0.8);
      const [pu, pv] = swatchUv(0);
      m.paint.forEach((p, i) => {
        const onPaint = m.uv[i * 2] === pu && m.uv[i * 2 + 1] === pv;
        expect(onPaint).toBe(p);
      });
    }
  });

  it("wears number plates front and back near, plain white and the right size", () => {
    const m = plain(0), d = b.dimensions(b.variants.plain);
    const plate = [...Array(m.pos.length / 3).keys()].filter((i) => onSwatch(m, i, SW.PLATE)).map((i) => vert(m, i));
    expect(plate.length).toBe(8);
    const front = plate.filter((p) => p[0] > 0), rear = plate.filter((p) => p[0] < 0);
    for (const q of [front, rear]) {
      expect(q.length).toBe(4);
      const s = q.map((p) => p[1]), h = q.map((p) => p[2]);
      expect(Math.max(...s) - Math.min(...s)).toBeCloseTo(PLATE_W, 3);
      expect(Math.max(...h) - Math.min(...h)).toBeCloseTo(PLATE_H, 3);
      expect(Math.min(...h)).toBeGreaterThan(0.15);
    }
    // At the ends of the body, not floating off them.
    expect(Math.max(...front.map((p) => p[0]))).toBeGreaterThan(d.length / 2 - 0.25);
    expect(Math.min(...rear.map((p) => p[0]))).toBeLessThan(-d.length / 2 + 0.25);
    expect(b.build({ ...b.variants.plain, plates: false } as never, 0).idx.length).toBe(m.idx.length - 12);
  });

  it("is the same every time (a bay's car never changes between builds)", () => {
    for (const [, v] of variants) expect(JSON.stringify(b.build(v, 0))).toBe(JSON.stringify(b.build(v, 0)));
  });
});

describe("local cars: shared extras", () => {
  const bodies = BODIES.filter((b) => "towBar" in b.defaults);

  it("puts a tow bar out the back when asked, near only", () => {
    expect(bodies.length).toBe(BODIES.length);
    for (const b of bodies) {
      const L = b.defaults.length;
      const without = meshExtent(b.build({ ...b.variants.plain, towBar: false } as never, 0));
      const withBar = meshExtent(b.build({ ...b.variants.plain, towBar: true } as never, 0));
      expect(without.rear).toBeGreaterThan(-L / 2 - 0.05);
      expect(withBar.rear).toBeLessThan(-L / 2 - 0.15);
      expect(withBar.rear).toBeGreaterThan(-L / 2 - 0.25);
      expect(tris(b.build({ ...b.variants.plain, towBar: true } as never, 1))).toBe(tris(b.build(b.variants.plain, 1)));
    }
  });

  it("hangs the 4WD wagon's spare on the back door, at both LODs", () => {
    const b = body("wagon4wd"), L = b.defaults.length;
    for (const lod of [0, 1] as const) {
      const m = b.build({ spare: true } as never, lod);
      const spare = [...Array(m.pos.length / 3).keys()].map((i) => vert(m, i)).filter((p, i) => onSwatch(m, i, SW.TYRE) && Math.abs(p[1]) < 0.45);
      expect(spare.length).toBeGreaterThan(0);
      const f = spare.map((p) => p[0]), h = spare.map((p) => p[2]);
      expect(Math.min(...f)).toBeLessThan(-L / 2 - 0.15); // sticks out behind the door
      expect(Math.max(...f)).toBeGreaterThan(-L / 2 - 0.05); // against it
      expect(Math.min(...h)).toBeGreaterThan(0.4); // off the ground, on the door
    }
  });

  it("keeps the ute's ladder rack trimmed (two hoops, no long rails)", () => {
    const plainUte = tris(buildUte({}, 0)), rack = tris(buildUte({ tray: "rack" }, 0));
    expect(rack - plainUte).toBeLessThanOrEqual(48);
  });

  it("has every body in the plan's table", () => {
    expect(BODIES.map((b) => b.id)).toEqual(["ute", "trayute", "wagon4wd", "suv", "suvsmall", "hatch", "sedan", "passute", "van", "stationwagon"]);
    expect(() => body("nope")).toThrow();
  });

  it("sizes the small SUV from the same spec, shorter and lower", () => {
    const m = body("suv").dimensions(), s = body("suvsmall").dimensions();
    expect(s.length).toBeLessThan(m.length - 0.2);
    expect(s.height).toBeLessThan(m.height - 0.08);
  });
});

describe("local cars: atlas", () => {
  it("draws an atlas of the right size with the plate swatch white", () => {
    const px = atlasPixels();
    expect(px.length).toBe(ATLAS_W * ATLAS_H * 4);
    const x = SW.PLATE * 16 + 8, i = (8 * ATLAS_W + x) * 4;
    expect(Math.min(px[i], px[i + 1], px[i + 2])).toBeGreaterThan(220);
    expect(SW.ALLOY * 16 + 16).toBeLessThanOrEqual(ATLAS_W);
  });

  it("marks paint with the paint slot, a template's paint vertices only", () => {
    const m: VehicleMesh = buildUte({}, 1);
    expect(m.paint.some(Boolean)).toBe(true);
    expect(PAINT_SLOT).toBe(-1);
  });
});
