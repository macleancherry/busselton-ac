import { describe, expect, it } from "vitest";
import { carryOn, extendRoute, pathLength } from "../src/core/extend";
import type { Vec2 } from "../src/core/geo";

const route: Vec2[] = [[0, 0], [100, 0], [200, 0], [300, 0]];
const street: Vec2[] = [[-40, 0], [0, 0], [300, 0], [400, 0], [480, 60]];
const last = (p: Vec2[]) => p[p.length - 1];
const lengthFrom = (start: Vec2, pts: Vec2[]) => pathLength([start, ...pts]);

describe("carryOn", () => {
  it("follows the street round its bend", () => {
    const out = carryOn(route, [street], 150);
    expect(Math.abs(lengthFrom([300, 0], out) - 150)).toBeLessThan(0.5);
    expect(last(out)[1]).toBeGreaterThan(20);
    expect(last(out)[0]).toBeGreaterThan(400);
  });

  it("goes straight on where the street runs out", () => {
    const out = carryOn(route.slice().reverse(), [street], 100);
    expect(last(out)[0]).toBeCloseTo(-100, 0);
    expect(Math.abs(last(out)[1])).toBeLessThan(0.5);
  });

  it("ignores a crossing street", () => {
    const out = carryOn(route, [[[300, -50], [300, 50]]], 50);
    expect(last(out)[0]).toBeCloseTo(350, 6);
    expect(last(out)[1]).toBeCloseTo(0, 6);
  });

  it("chains on to a street within 4 m, not 6 m", () => {
    const first: Vec2[] = [[0, 0], [300, 0], [400, 0]];
    const next = (gap: number): Vec2[] => [[400 + gap, 0], [500, 0], [500, 100]];
    const chained = carryOn(route, [first, next(3)], 250);
    expect(last(chained)[0]).toBeCloseTo(500, 6);
    expect(last(chained)[1]).toBeCloseTo(50, 6);
    const notChained = carryOn(route, [first, next(6)], 250);
    expect(last(notChained)[0]).toBeCloseTo(550, 6);
    expect(last(notChained)[1]).toBeCloseTo(0, 6);
  });

  it("snaps up to 10 m on the first search, and the hop counts", () => {
    const at8 = carryOn(route, [[[0, 8], [600, 8]]], 100);
    expect(last(at8)[1]).toBeCloseTo(8, 6);
    expect(last(at8)[0]).toBeCloseTo(392, 6);
    const at12 = carryOn(route, [[[0, 12], [600, 12]]], 100);
    expect(last(at12)[1]).toBeCloseTo(0, 6);
    expect(last(at12)[0]).toBeCloseTo(400, 6);
  });

  it("follows a street at 30 degrees, not one at 45", () => {
    const at = (deg: number): Vec2[] => {
      const a = (deg * Math.PI) / 180;
      return [[300, 0], [300 + 200 * Math.cos(a), 200 * Math.sin(a)]];
    };
    expect(last(carryOn(route, [at(30)], 100))[1]).toBeCloseTo(50, 6);
    expect(last(carryOn(route, [at(45)], 100))[1]).toBeCloseTo(0, 6);
  });

  it("steps 2 m straight on, the last step the remainder", () => {
    expect(carryOn(route, [], 7)).toEqual([[302, 0], [304, 0], [306, 0], [307, 0]]);
    expect(carryOn(route, [], 0)).toEqual([]);
  });

  it("throws on a path with no length (bug 1)", () => {
    expect(() => carryOn([[5, 5]], [], 10)).toThrow("Route has no length to extend");
    expect(() => carryOn([[5, 5], [5, 5]], [], 10)).toThrow("Route has no length to extend");
  });

  it("never takes the heading from the hop onto the street (bug 2)", () => {
    const out = carryOn(route, [[[200, 5], [300, 5]]], 50);
    expect(out[0]).toEqual([300, 5]);
    for (const p of out) expect(p[1]).toBeCloseTo(5, 9);
    expect(last(out)[0]).toBeCloseTo(345, 6);
  });
});

describe("extendRoute", () => {
  it("adds the run-up and run-off and reports the original ends", () => {
    const ext = extendRoute(route, [street], 100, 150);
    expect(ext.startAt).toBeCloseTo(100, 6);
    expect(ext.finishAt - ext.startAt).toBeCloseTo(300, 6);
    expect(pathLength(ext.path)).toBeCloseTo(550, 6);
    expect(ext.path[0][0]).toBeCloseTo(-100, 6);
  });

  it("leaves the path alone with no run-up or run-off", () => {
    const ext = extendRoute(route, [street], 0, 0);
    expect(ext.path).toEqual(route);
    expect(ext.startAt).toBe(0);
    expect(ext.finishAt).toBe(300);
  });

  it("doesn't mutate its inputs", () => {
    const r = route.map((p) => [p[0], p[1]] as Vec2);
    const s = street.map((p) => [p[0], p[1]] as Vec2);
    extendRoute(r, [s], 50, 50);
    expect(r).toEqual(route);
    expect(s).toEqual(street);
  });
});

describe("pathLength", () => {
  it("is 0 for fewer than two points", () => {
    expect(pathLength([])).toBe(0);
    expect(pathLength([[1, 1]])).toBe(0);
    expect(pathLength([[0, 0], [3, 4]])).toBe(5);
  });
});
