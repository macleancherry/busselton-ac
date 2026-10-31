import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LngLat } from "../src/core/geo";
import { allRaceway, routeAlongWays, type OsmWayGeom } from "../src/core/wayRoute";

// Collie Motorplex from OSM: the 1.63 km loop (way 89374807, drawn anticlockwise) and the 1.31 km
// southern extension (way 733256017) that leaves and rejoins it, for the 2.55 km long layout.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/collie-ways.json", import.meta.url), "utf8")) as { ways: OsmWayGeom[] };
const ways = fixture.ways;
const loopWay = ways.find((w) => w.id === 89374807)!;
const ext = ways.find((w) => w.id === 733256017)!;

const NORTH: LngLat = [116.24458, -33.428801];
const WEST: LngLat = [116.242968, -33.432722];
const SOUTH: LngLat = [116.24487, -33.434899];
const EAST: LngLat = [116.245587, -33.430988];
const EXT_SOUTH: LngLat = [116.246605, -33.437691];

/** Signed area (positive: anticlockwise on the map). */
const area = (c: LngLat[]) => c.slice(1).reduce((s, p, i) => s + c[i][0] * p[1] - p[0] * c[i][1], 0) / 2;
const has = (c: LngLat[], p: LngLat) => c.some((q) => q[0] === p[0] && q[1] === p[1]);

describe("routing along OSM ways", () => {
  it("drives the short circuit anticlockwise through pins in that order, closed", () => {
    const pins = [NORTH, WEST, SOUTH, EAST];
    const r = routeAlongWays(ways, [...pins, pins[0]], { loop: true });
    expect(r.distance).toBeGreaterThan(1600);
    expect(r.distance).toBeLessThan(1660);
    expect(r.coords[0]).toEqual(r.coords[r.coords.length - 1]);
    expect(area(r.coords)).toBeGreaterThan(0);
    // Never onto the extension's far end.
    expect(r.coords.some((p) => p[1] < -33.436)).toBe(false);
  });

  it("reverse drives the same lap clockwise", () => {
    const pins = [NORTH, WEST, SOUTH, EAST];
    const fwd = routeAlongWays(ways, [...pins, pins[0]], { loop: true });
    const rev = routeAlongWays(ways, [...pins, pins[0]], { loop: true, reverse: true });
    expect(area(rev.coords)).toBeLessThan(0);
    expect(rev.coords).toEqual(fwd.coords.slice().reverse());
  });

  it("pins in the other order give the clockwise lap", () => {
    const pins = [NORTH, EAST, SOUTH, WEST];
    const r = routeAlongWays(ways, [...pins, pins[0]], { loop: true });
    expect(area(r.coords)).toBeLessThan(0);
  });

  it("a pin on the extension takes the long layout, joining the two ways at their shared nodes", () => {
    const pins = [NORTH, WEST, EXT_SOUTH, EAST];
    const r = routeAlongWays(ways, [...pins, pins[0]], { loop: true });
    // 1629 - 369 (the short arc it leaves out) + 1311.
    expect(r.distance).toBeGreaterThan(2530);
    expect(r.distance).toBeLessThan(2610);
    expect(area(r.coords)).toBeGreaterThan(0);
    // Every point of the extension, and both of its junctions with the loop, once each.
    for (const p of ext.pts) expect(has(r.coords, p)).toBe(true);
    const inner = r.coords.slice(0, -1).map((p) => p.join());
    expect(new Set(inner).size).toBe(inner.length);
    // The loop's southern arc between the junctions is left out.
    const shortArc = loopWay.pts.slice(32, 44);
    expect(shortArc.some((p) => has(r.coords, p))).toBe(false);
  });

  it("an open track goes end to end between its pins, in the pins' direction", () => {
    const a: LngLat = ext.pts[0], b: LngLat = ext.pts[ext.pts.length - 1];
    const r = routeAlongWays([ext], [a, b]);
    expect(r.coords).toEqual(ext.pts);
    expect(routeAlongWays([ext], [a, b], { reverse: true }).coords).toEqual(ext.pts.slice().reverse());
    expect(routeAlongWays([ext], [b, a]).coords).toEqual(ext.pts.slice().reverse());
  });

  it("joins a chain of ways listed in any order and either direction", () => {
    const w1: OsmWayGeom = { id: 1, pts: [[115, -33], [115.001, -33]] };
    const w2: OsmWayGeom = { id: 2, pts: [[115.002, -33], [115.001, -33]] }; // drawn backwards
    const w3: OsmWayGeom = { id: 3, pts: [[115.002, -33], [115.003, -33.001]] };
    const r = routeAlongWays([w3, w1, w2], [[115, -33], [115.003, -33.001]]);
    expect(r.coords).toEqual([[115, -33], [115.001, -33], [115.002, -33], [115.003, -33.001]]);
  });

  it("starts and ends where the pins are, mid-segment", () => {
    const w: OsmWayGeom = { id: 1, pts: [[115, -33], [115.01, -33]] };
    const r = routeAlongWays([w], [[115.002, -33.0001], [115.008, -33.0001]]);
    expect(r.coords).toHaveLength(2);
    expect(r.coords[0][0]).toBeCloseTo(115.002, 6);
    expect(r.coords[1][0]).toBeCloseTo(115.008, 6);
  });

  it("says which pin is off the ways", () => {
    expect(() => routeAlongWays(ways, [NORTH, [116.25, -33.43]])).toThrow(/pin 2 is \d+ m from the OSM ways/);
  });

  it("says when the ways don't connect", () => {
    const far: OsmWayGeom = { id: 9, pts: [[116.3, -33.43], [116.301, -33.43]] };
    expect(() => routeAlongWays([loopWay, far], [NORTH, [116.3005, -33.43]])).toThrow(/don't connect pin 1 to pin 2/);
  });

  it("refuses a drive that turns back on itself at a pin", () => {
    const w: OsmWayGeom = { id: 1, pts: [[115, -33], [115.005, -33], [115.01, -33]] };
    expect(() => routeAlongWays([w], [[115, -33], [115.008, -33], [115.002, -33]])).toThrow(/turns back on itself at pin 2/);
  });
});

describe("allRaceway", () => {
  it("is true only when every way is highway=raceway", () => {
    const w = (highway?: string): OsmWayGeom => ({ id: 1, pts: [], ...(highway ? { highway } : {}) });
    expect(allRaceway([w("raceway"), w("raceway")])).toBe(true);
    expect(allRaceway([w("raceway"), w("track")])).toBe(false);
    expect(allRaceway([w()])).toBe(false);
    expect(allRaceway([])).toBe(false);
  });
});
