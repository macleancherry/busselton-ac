import { describe, expect, it } from "vitest";
import { carParkName, clusterAisles, driftZones, driftZonesIni } from "../src/core/driftZones";
import type { Vec2 } from "../src/core/geo";

// A car park: three parallel aisles 16 m apart, 90 m long, centred on (cx, cy).
const park = (cx: number, cy: number): Vec2[][] =>
  [-16, 0, 16].map((dy) => [[cx - 45, cy + dy], [cx + 45, cy + dy]] as Vec2[]);
const flat = { roadClearance: () => Infinity, ground: () => 2 };

describe("drift zones", () => {
  it("groups aisles into car parks", () => {
    const groups = clusterAisles([...park(0, 0), ...park(500, 0), [[1000, 0], [1010, 0]]]);
    expect(groups.length).toBe(3);
  });

  it("finds a big empty car park and leaves out a full one and a lone aisle", () => {
    // The second car park has a parked car every 8 m along each aisle.
    const full: Vec2[] = park(500, 0).flatMap((a) => Array.from({ length: 12 }, (_, k) => [a[0][0] + k * 8, a[0][1] + 4] as Vec2));
    const zones = driftZones({ ...flat, aisles: [...park(0, 0), ...park(500, 0), [[1000, 0], [1100, 0]]], parked: full });
    expect(zones.length).toBe(1);
    const z = zones[0];
    expect(Math.hypot(z.pos[0], z.pos[2])).toBeLessThan(20);
    expect(z.radius).toBeGreaterThanOrEqual(25);
    expect(z.radius).toBeLessThanOrEqual(40);
    expect(z.pos[1]).toBe(2);
    expect(z.name).toBe("Drift spot 1");
  });

  it("keeps clear of parked cars, buildings and the streets", () => {
    const base = driftZones({ ...flat, aisles: park(0, 0), parked: [] })[0];
    // A parked car near the middle shrinks the zone away from it.
    const withCar = driftZones({ ...flat, aisles: park(0, 0), parked: [[0, 0]] });
    for (const z of withCar) expect(Math.hypot(z.pos[0], -z.pos[2]) - z.radius).toBeGreaterThanOrEqual(3 - 1e-6);
    // A street along the car park's north edge.
    const road = driftZones({ ...flat, aisles: park(0, 0), parked: [], roadClearance: (_x, y) => 30 - y })[0];
    expect(-road.pos[2] + road.radius).toBeLessThanOrEqual(28 + 1e-6);
    // A building over the east half.
    const shed = driftZones({ ...flat, aisles: park(0, 0), parked: [], blocked: (x) => x > 20 })[0];
    expect(shed.pos[0] + shed.radius).toBeLessThanOrEqual(20 + 1e-6);
    expect(base.radius).toBeGreaterThanOrEqual(shed.radius);
  });

  it("names car parks after the nearest place or street", () => {
    const name = carParkName([{ at: [0, 50], name: "The Jetty" }], [{ pts: [[300, 0], [300, 100]], name: "Kent St" }]);
    expect(name(0, 0)).toBe("Car park by The Jetty");
    expect(name(250, 50)).toBe("Car park off Kent St");
    expect(name(1000, 1000)).toBeUndefined();
    const zones = driftZones({ ...flat, aisles: [...park(0, 0), ...park(400, 0)], parked: [], nameAt: () => "Car park by The Jetty" });
    expect(zones.length).toBe(2);
    expect(new Set(zones.map((z) => z.name)).size).toBe(2);
    const ini = driftZonesIni(zones);
    expect(ini).toContain("[DRIFT]\nCOUNT = 2");
    expect(ini).toContain("[ZONE_1]");
    expect(ini).toMatch(/RADIUS = \d+/);
  });
});
