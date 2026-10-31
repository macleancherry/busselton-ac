import { describe, expect, it } from "vitest";
import { centroid, type Building } from "../src/core/buildings";
import { chunkPhotoSampler, frontageHouses, roofLike, type Frontage, type PhotoSampler } from "../src/core/frontage";
import type { Vec2 } from "../src/core/geo";

type RGB = [number, number, number];
const LAWN: RGB = [0.3, 0.42, 0.2];
const GREY: RGB = [0.5, 0.5, 0.52];
const TERRACOTTA: RGB = [0.72, 0.38, 0.25];
const DARK: RGB = [0.2, 0.2, 0.21];
const PALE: RGB = [0.78, 0.78, 0.76];

interface Roof { x0: number; x1: number; y0: number; y1: number; c: RGB }
/** A photo of lawn with the given roofs on it. */
const photoOf = (roofs: Roof[]): PhotoSampler => (x, y) => roofs.find((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1)?.c ?? LAWN;
/** A 7 m street along y = `y` (east), from x = -10 to 70. */
const street = (y = 0, x0 = -10, x1 = 70): Frontage => ({ pts: [[x0, y], [x1, y]], half: [3.5, 3.5] });
const yes = () => true;
const no = () => false;
const offRoad = (_x: number, y: number) => Math.abs(y) < 4.5;

// North of the street: 6 m of lawn behind the kerb line (y = 3.5), then roofs 9.5 to 24 m out.
const scene: Roof[] = [
  { x0: 0, x1: 12, y0: 9.5, y1: 24, c: GREY },
  { x0: 14, x1: 26, y0: 9.5, y1: 24, c: TERRACOTTA },
  { x0: 28, x1: 40, y0: 9.5, y1: 24, c: DARK },
  { x0: 40, x1: 53, y0: 9.5, y1: 24, c: PALE },
];
const mirror = (rs: Roof[]): Roof[] => rs.map((r) => ({ ...r, y0: -r.y1, y1: -r.y0 }));
const area = (ring: Vec2[]) => ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const ys = (b: Building) => b.ring.map((p) => p[1]);

describe("roofLike", () => {
  it("tells roofs from lawn, water, shade and dry grass", () => {
    expect(roofLike([0.3, 0.42, 0.2])).toBe(false);
    expect(roofLike([0.2, 0.55, 0.65])).toBe(false);
    expect(roofLike([0.62, 0.55, 0.42])).toBe(false);
    expect(roofLike([0.72, 0.38, 0.25])).toBe(true);
    expect(roofLike([0.1, 0.1, 0.1])).toBe(false);
    expect(roofLike([0.5, 0.5, 0.5])).toBe(true);
  });
});

describe("chunkPhotoSampler", () => {
  it("is null without images, and reads the right chunk and pixel, row 0 north", () => {
    expect(chunkPhotoSampler([])).toBeNull();
    const size = 4;
    const img = (r: number) => {
      const px = new Uint8Array(size * size * 4);
      for (let i = 0; i < size * size; i++) px.set([r, i * 10, 0, 255], i * 4);
      return px;
    };
    const s = chunkPhotoSampler([
      { chunk: { key: "a", minX: 0, minY: 0, maxX: 100, maxY: 100 }, rgba: img(255), size },
      { chunk: { key: "b", minX: 100, minY: 0, maxX: 200, maxY: 100 }, rgba: img(51), size },
    ])!;
    // (10, 90): column 0, row 0 of chunk a.
    expect(s(10, 90)).toEqual([1, 0, 0]);
    // (130, 10): column 1, row 3 of chunk b (pixel 13).
    expect(s(130, 10)).toEqual([0.2, 130 / 255, 0]);
    expect(s(-5, 50)).toBeNull();
    expect(s(50, 150)).toBeNull();
  });
});

describe("frontage houses", () => {
  it("finds the four roofs along the street and nothing on the lawn side", () => {
    const hs = frontageHouses([street()], photoOf(scene), offRoad, yes, []);
    expect(hs.length).toBe(4);
    const mids = [6, 20, 34, 46.5];
    hs.forEach((b, i) => {
      const [cx, cy] = centroid(b.ring);
      expect(Math.abs(cx - mids[i])).toBeLessThan(1.5);
      expect(Math.abs(cy - 16.75)).toBeLessThan(1.5);
      expect(Math.min(...ys(b))).toBeGreaterThanOrEqual(8.5);
      expect(Math.min(...ys(b))).toBeLessThanOrEqual(11);
      expect(Math.max(...ys(b))).toBeGreaterThanOrEqual(22);
      expect(Math.max(...ys(b))).toBeLessThanOrEqual(26);
      expect(area(b.ring)).toBeGreaterThan(120);
      expect(b.source).toBe("frontage");
      expect(b.type).toBe("house");
    });
  });

  it("makes counter-clockwise rings on both sides, fronts nearest the street, setback from the kerb", () => {
    const hs = frontageHouses([street()], photoOf([...scene, ...mirror(scene)]), offRoad, yes, []);
    expect(hs.filter((b) => centroid(b.ring)[1] > 0).length).toBe(4);
    expect(hs.filter((b) => centroid(b.ring)[1] < 0).length).toBe(4);
    for (const b of hs) {
      expect(area(b.ring)).toBeGreaterThan(0);
      const near = Math.min(...ys(b).map(Math.abs));
      expect(Math.abs(b.front![0][1])).toBeCloseTo(near, 9);
      expect(Math.abs(b.front![1][1])).toBeCloseTo(near, 9);
      expect(b.setback).toBeCloseTo(near - 3.5, 9);
      // the front is one of the ring's edges
      const k = b.ring.findIndex((p) => p[0] === b.front![0][0] && p[1] === b.front![0][1]);
      expect(k).toBeGreaterThanOrEqual(0);
      const nb = [b.ring[(k + 1) % 4], b.ring[(k + 3) % 4]];
      expect(nb.some((p) => p[0] === b.front![1][0] && p[1] === b.front![1][1])).toBe(true);
    }
  });

  it("makes none where it isn't built up, and none over a known building", () => {
    expect(frontageHouses([street()], photoOf(scene), offRoad, no, [])).toEqual([]);
    const hs = frontageHouses([street()], photoOf(scene), offRoad, yes, []);
    const again = frontageHouses([street()], photoOf(scene), offRoad, yes, [hs[1]]);
    expect(again.length).toBe(3);
  });

  it("splits at a depth step of over 3 m, but not at one stray column", () => {
    const step = frontageHouses([street()], photoOf([
      { x0: 0, x1: 14, y0: 9.5, y1: 24, c: GREY },
      { x0: 14, x1: 28, y0: 9.5, y1: 18, c: GREY },
    ]), offRoad, yes, []);
    expect(step.length).toBe(2);
    const stray = frontageHouses([street()], photoOf([
      { x0: 14.7, x1: 15.3, y0: 0, y1: 40, c: LAWN },
      { x0: 0, x1: 20, y0: 9.5, y1: 24, c: GREY },
    ]), offRoad, yes, []);
    expect(stray.length).toBe(1);
  });

  it("cuts a 40 m run into three lots", () => {
    const hs = frontageHouses([street()], photoOf([{ x0: 0, x1: 40, y0: 9.5, y1: 24, c: GREY }]), offRoad, yes, []);
    expect(hs.length).toBe(Math.round(40 / 15));
  });

  it("resamples by arc length: many short segments read the same as one", () => {
    const pts: Vec2[] = [];
    for (let i = 0; i <= 200; i++) pts.push([-10 + i * 0.4, 0]);
    const fine = frontageHouses([{ pts, half: pts.map(() => 3.5) }], photoOf(scene), offRoad, yes, []);
    const one = frontageHouses([street()], photoOf(scene), offRoad, yes, []);
    expect(fine.length).toBe(one.length);
    fine.forEach((b, i) => {
      b.ring.forEach((p, k) => {
        expect(p[0]).toBeCloseTo(one[i].ring[k][0], 6);
        expect(p[1]).toBeCloseTo(one[i].ring[k][1], 6);
      });
      expect(b.roof).toBe(one[i].roof);
      expect(b.garage).toBe(one[i].garage);
    });
  });

  it("gives the same houses whatever the seed and whatever streets come first", () => {
    const far: Roof[] = scene.map((r) => ({ ...r, y0: r.y0 + 500, y1: r.y1 + 500 }));
    const photo = photoOf([...scene, ...far]);
    const road = (_x: number, y: number) => Math.abs(y) < 4.5 || Math.abs(y - 500) < 4.5;
    const a = frontageHouses([street()], photo, road, yes, [], 1);
    const b = frontageHouses([street(500), street()], photo, road, yes, [], 12345);
    expect(b.length).toBe(8);
    expect(b.slice(4)).toEqual(a);
    expect(frontageHouses([street()], photo, road, yes, [], 1)).toEqual(a);
    // and the draws do vary from house to house
    const many = frontageHouses([street(0, -10, 400)], photoOf(Array.from({ length: 25 }, (_, i) => ({ x0: i * 15, x1: i * 15 + 12, y0: 9.5, y1: 24, c: i % 2 ? GREY : TERRACOTTA }))), offRoad, yes, []);
    expect(new Set(many.map((h) => h.roof)).size).toBe(2);
    expect(new Set(many.map((h) => h.garage)).size).toBe(2);
  });

  it("stops at a cross street behind the lot", () => {
    const road = (_x: number, y: number) => Math.abs(y) < 4.5 || y >= 18.5;
    const hs = frontageHouses([street()], photoOf(scene), road, yes, []);
    expect(hs.length).toBeGreaterThan(0);
    for (const b of hs) expect(Math.max(...ys(b))).toBeLessThanOrEqual(18.5);
  });
});
