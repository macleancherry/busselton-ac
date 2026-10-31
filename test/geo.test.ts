import { describe, expect, it } from "vitest";
import {
  EARTH_RADIUS, LocalProjection, boundsOf, haversine, lngLatToPixel, pixelToLngLat, tilesCovering,
  type LngLat, type Vec2,
} from "../src/core/geo";

const ORIGIN: LngLat = [115.35, -33.65];
const RAD = Math.PI / 180;
const K = Math.cos(ORIGIN[1] * RAD);
const proj = new LocalProjection(ORIGIN);

describe("LocalProjection", () => {
  it("puts the origin at (0, 0) and back", () => {
    expect(proj.toLocal(ORIGIN)).toEqual([0, 0]);
    expect(proj.toLngLat([0, 0])[0]).toBeCloseTo(ORIGIN[0], 12);
    expect(proj.toLngLat([0, 0])[1]).toBeCloseTo(ORIGIN[1], 12);
    expect(proj.origin).toBe(ORIGIN);
  });

  it("scales east and north steps as specified", () => {
    const [ex, ey] = proj.toLocal([ORIGIN[0] + 0.01, ORIGIN[1]]);
    expect(ex).toBeCloseTo(K * EARTH_RADIUS * RAD * 0.01, 6);
    expect(ex).toBeCloseTo(926.6, 0);
    expect(ey).toBe(0);
    const [nx, ny] = proj.toLocal([ORIGIN[0], ORIGIN[1] + 0.01]);
    const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
    expect(ny).toBeCloseTo(K * EARTH_RADIUS * (merc(ORIGIN[1] + 0.01) - merc(ORIGIN[1])), 6);
    expect(Math.abs(ny / (EARTH_RADIUS * RAD * 0.01) - 1)).toBeLessThan(1e-4);
    expect(nx).toBe(0);
  });

  it("round trips within 1e-9 degrees up to 50 km away", () => {
    for (const [dx, dy] of [[50000, 0], [-50000, 0], [0, 50000], [0, -50000], [35000, -35000], [-12345, 6789]]) {
      const p = proj.toLngLat([dx, dy]);
      const back = proj.toLngLat(proj.toLocal(p));
      expect(Math.abs(back[0] - p[0])).toBeLessThan(1e-9);
      expect(Math.abs(back[1] - p[1])).toBeLessThan(1e-9);
      const local = proj.toLocal(p);
      expect(local[0]).toBeCloseTo(dx, 5);
      expect(local[1]).toBeCloseTo(dy, 5);
    }
  });

  it("agrees with haversine within 0.2% over 1 km", () => {
    const a = proj.toLngLat([100, 200]);
    const b = proj.toLngLat([100 + 600, 200 + 800]);
    expect(Math.abs(haversine(a, b) / 1000 - 1)).toBeLessThan(0.002);
  });

  it("matches global pixels, inverts, and steps by metresPerPixel", () => {
    for (const z of [15, 19]) {
      for (const p of [ORIGIN, [115.6, -33.4], [115.1, -33.9], [115.4, -33.62]] as LngLat[]) {
        const a = proj.localToPixel(proj.toLocal(p), z);
        const b = lngLatToPixel(p, z);
        expect(Math.abs(a[0] - b[0])).toBeLessThan(1e-6);
        expect(Math.abs(a[1] - b[1])).toBeLessThan(1e-6);
      }
      const v: Vec2 = [1234.5, -678.9];
      const px = proj.localToPixel(v, z);
      const back = proj.pixelToLocal(px, z);
      expect(back[0]).toBeCloseTo(v[0], 6);
      expect(back[1]).toBeCloseTo(v[1], 6);
      const m = proj.metresPerPixel(z);
      const east = proj.pixelToLocal([px[0] + 1, px[1]], z);
      const south = proj.pixelToLocal([px[0], px[1] + 1], z);
      expect(east[0] - back[0]).toBeCloseTo(m, 6);
      expect(south[1] - back[1]).toBeCloseTo(-m, 6);
    }
  });

  it("halves metresPerPixel each zoom", () => {
    expect(proj.metresPerPixel(0)).toBeCloseTo(156543.03 * K, 1);
    for (let z = 0; z < 20; z++) expect(proj.metresPerPixel(z + 1) * 2).toBeCloseTo(proj.metresPerPixel(z), 9);
  });
});

describe("global pixels", () => {
  it("maps the world's corners and centre", () => {
    for (const z of [0, 3, 10]) {
      const size = 256 * 2 ** z;
      const nw = lngLatToPixel([-180, 85.0511], z);
      expect(nw[0]).toBe(0);
      expect(Math.abs(nw[1])).toBeLessThan(1e-4 * size);
      const se = lngLatToPixel([180, -85.0511], z);
      expect(se[0]).toBe(size);
      expect(Math.abs(se[1] - size)).toBeLessThan(1e-4 * size);
    }
    const c = lngLatToPixel([0, 0], 0);
    expect(c[0]).toBe(128);
    expect(c[1]).toBeCloseTo(128, 12);
  });

  it("inverts away from the clamp", () => {
    for (const p of [ORIGIN, [-73.98, 40.75], [0.5, -60], [179, 80]] as LngLat[]) {
      const back = pixelToLngLat(lngLatToPixel(p, 17), 17);
      expect(Math.abs(back[0] - p[0])).toBeLessThan(1e-9);
      expect(Math.abs(back[1] - p[1])).toBeLessThan(1e-9);
    }
  });

  it("clamps latitude at ±85.0511", () => {
    expect(lngLatToPixel([10, 89], 5)[1]).toBe(lngLatToPixel([10, 85.0511], 5)[1]);
    expect(lngLatToPixel([10, -90], 5)[1]).toBe(lngLatToPixel([10, -85.0511], 5)[1]);
  });
});

describe("haversine", () => {
  it("is zero, symmetric, and 111.195 km per degree of latitude", () => {
    expect(haversine(ORIGIN, ORIGIN)).toBe(0);
    const a: LngLat = [115.3, -33.6], b: LngLat = [115.5, -33.7];
    expect(haversine(a, b)).toBe(haversine(b, a));
    expect(haversine([115, -33], [115, -34])).toBeCloseTo(6371008.8 * RAD, 3);
    expect(haversine([115, -33], [115, -34]) / 1000).toBeCloseTo(111.195, 3);
  });
});

describe("boundsOf", () => {
  it("pads the box", () => {
    expect(boundsOf([[1, 2], [-3, 5], [4, -1]], 2)).toEqual({ minX: -5, minY: -3, maxX: 6, maxY: 7 });
  });
  it("handles one point", () => {
    expect(boundsOf([[3, 4]])).toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 });
  });
  it("gives an inverted infinite box for no points", () => {
    expect(boundsOf([], 10)).toEqual({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  });
});

describe("tilesCovering", () => {
  const z = 15;
  const centre = lngLatToPixel(ORIGIN, z);
  const tile = [Math.floor(centre[0] / 256), Math.floor(centre[1] / 256)];
  const m = proj.metresPerPixel(z);

  it("gives one tile for a small box inside it", () => {
    // Box centred on the tile's centre, much smaller than a tile.
    const c = proj.pixelToLocal([tile[0] * 256 + 128, tile[1] * 256 + 128], z);
    const r = 10 * m;
    const t = tilesCovering(proj, { minX: c[0] - r, minY: c[1] - r, maxX: c[0] + r, maxY: c[1] + r }, z);
    expect(t).toEqual({ x0: tile[0], y0: tile[1], x1: tile[0], y1: tile[1] });
  });

  it("gives 2 x 2 across a tile corner, north the lower y", () => {
    const corner = proj.pixelToLocal([tile[0] * 256 + 256, tile[1] * 256 + 256], z);
    const r = 10 * m;
    const t = tilesCovering(proj, { minX: corner[0] - r, minY: corner[1] - r, maxX: corner[0] + r, maxY: corner[1] + r }, z);
    expect(t).toEqual({ x0: tile[0], y0: tile[1], x1: tile[0] + 1, y1: tile[1] + 1 });
    // The box's north (max y) edge is in the lower y index.
    const north = tilesCovering(proj, { minX: corner[0] - r, minY: corner[1] + r / 2, maxX: corner[0] - r / 2, maxY: corner[1] + r }, z);
    expect(north.y0).toBe(tile[1]);
    expect(north.y1).toBe(tile[1]);
  });

  it("clamps at 0 and 2^z - 1", () => {
    const zl = 2;
    const big = 1e8;
    const t = tilesCovering(proj, { minX: -big, minY: -big, maxX: big, maxY: big }, zl);
    expect(t).toEqual({ x0: 0, y0: 0, x1: 3, y1: 3 });
  });
});
