import { describe, expect, it } from "vitest";
import { trafficJson, type TrafficRoad } from "../src/core/traffic";
import { inPolygon, QUIET_ENTRY, smoothZones, suggestedCars, townCentreTest, trafficForSetting, zoneOf, zoneRoads, ZONES } from "../src/core/trafficZones";
import type { Vec2 } from "../src/core/geo";

const line = (a: Vec2, b: Vec2, n = 40): Vec2[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
const road = (pts: Vec2[], width = 7, speed = 50): TrafficRoad => ({ pts, h: pts.map(() => 2), width, speed });
const local = (p: number[]): Vec2 => [p[0], -p[2]];

type Lane = { id: number; name: string; role: number; priority: number; speedLimit: number; points: number[][] };
type Inter = { id: number; points: number[][]; disallowedTrajectories?: [number, number][] };
type Json = {
  lanes: Lane[]; intersections: Inter[];
  areas: { name: string; shapes: number[][][]; params: { role: number; customSpeedLimit: boolean; speedLimit: number } }[];
  rules: { laneRoles: { name: string; priority: number; speedLimit: number; zone: string }[] };
  busselton: { setting: string; cars: number; zones: Record<string, number>; quietEntry: number };
};

describe("zone of a road", () => {
  it("goes by road class, the town centre and, without a class, the limit", () => {
    expect(zoneOf("primary", 60, false)).toBe("busy");
    expect(zoneOf("tertiary", 50, false)).toBe("busy");
    expect(zoneOf("minor", 50, false)).toBe("quiet");
    expect(zoneOf("service", 50, false)).toBe("quiet");
    expect(zoneOf("minor", 50, true)).toBe("centre");
    expect(zoneOf("secondary", 50, true)).toBe("centre");
    expect(zoneOf("trunk", 100, true)).toBe("highway");
    expect(zoneOf(undefined, 60, false)).toBe("busy");
    expect(zoneOf(undefined, 50, false)).toBe("quiet");
  });

  it("finds the town centre from shop landuse or a cluster of shops", () => {
    const shopsBlock: Vec2[] = [[0, 0], [100, 0], [100, 60], [0, 60]];
    const cafes = Array.from({ length: 9 }, (_, k) => ({ at: [500 + k * 10, 500] as Vec2, cls: k % 2 ? "cafe" : "shop" }));
    const lone = [{ at: [900, 900] as Vec2, cls: "cafe" }];
    const centre = townCentreTest([{ ring: shopsBlock, cls: "retail" }, { ring: [[2000, 0], [2100, 0], [2100, 100]], cls: "residential" }], [...cafes, ...lone]);
    expect(centre([50, 30])).toBe(true); // inside
    expect(centre([50, -20])).toBe(true); // the street along its edge
    expect(centre([50, -60])).toBe(false);
    expect(centre([540, 510])).toBe(true); // among the cafes
    expect(centre([900, 900])).toBe(false); // one cafe isn't a centre
    expect(centre([2080, 20])).toBe(false); // residential landuse doesn't count
  });

  it("zones each point, with a class per road or per point", () => {
    const [a, b] = zoneRoads([
      { ...road(line([0, 0], [400, 0], 4)), cls: "primary" },
      { ...road(line([0, 0], [400, 0], 4)), cls: ["minor", "minor", "primary", undefined, undefined], speeds: [50, 50, 60, 60, 50] },
    ], (p) => p[0] > 350);
    expect(a.zone).toEqual(["busy", "busy", "busy", "busy", "centre"]);
    expect(b.zone).toEqual(["quiet", "quiet", "busy", "busy", "centre"]);
    expect("cls" in a).toBe(false);
  });

  it("smooths out short flickers of zone (a side street's class picked up at a junction)", () => {
    const pts = line([0, 0], [300, 0], 60); // 5 m apart
    const z = pts.map(([x]) => (x >= 100 && x <= 110 ? "quiet" : x > 200 ? "centre" : "busy") as "busy" | "quiet" | "centre");
    const s = smoothZones(pts, z);
    expect(s.filter((v) => v === "quiet")).toHaveLength(0);
    expect(s.filter((v) => v === "centre").length).toBe(z.filter((v) => v === "centre").length);
    // A short run at the very start takes the zone after it.
    expect(smoothZones(pts, pts.map(([x]) => (x < 10 ? "quiet" : "busy")))[0]).toBe("busy");
  });
});

describe("zoned traffic.json", () => {
  // A busy main road east-west, with quiet side streets running north from it every 60 m.
  const main = { ...road(line([-300, 0], [300, 0], 120), 8, 60), zone: Array(121).fill("busy") } as TrafficRoad;
  const sides = Array.from({ length: 9 }, (_, k) => {
    const x = -240 + k * 60;
    const pts = line([x, 4.5], [x, 120], 30);
    return { ...road(pts, 6, 50), zone: pts.map(() => "quiet") } as TrafficRoad;
  });
  const j: Json = JSON.parse(trafficJson([main, ...sides], []));
  const roleOf = (l: Lane) => j.rules.laneRoles[l.role - 1];

  it("gives busy and quiet streets their own roles: limits and who gives way", () => {
    const mainLanes = j.lanes.filter((l) => l.name.startsWith("Road 1 "));
    const sideLanes = j.lanes.filter((l) => !l.name.startsWith("Road 1 "));
    for (const l of mainLanes) {
      expect(roleOf(l).name).toBe("Busy street 60");
      expect(l.speedLimit).toBe(60);
      expect(l.priority).toBe(ZONES.busy.priority);
    }
    for (const l of sideLanes) {
      expect(roleOf(l).name).toBe("Quiet street 50");
      expect(l.priority).toBeLessThan(mainLanes[0].priority);
    }
    expect(j.busselton.setting).toBe("normal");
    expect(j.busselton.zones.busy).toBeGreaterThan(1);
    expect(j.busselton.zones.quiet).toBeGreaterThan(1.5);
  });

  it("lets only some turns from the main road into quiet streets, and never blocks a way out", () => {
    const zoneOfLane = new Map(j.lanes.map((l) => [l.id, roleOf(l).zone]));
    const pairs = j.intersections.flatMap((it) => it.disallowedTrajectories ?? []);
    expect(pairs.length).toBeGreaterThan(0);
    for (const [from, to] of pairs) {
      expect(zoneOfLane.get(from)).not.toBe("quiet");
      expect(zoneOfLane.get(to)).toBe("quiet");
    }
    // Each junction: 2 main lanes x 1 side lane leaving = 2 turns in; about QUIET_ENTRY of them stay.
    const turnsIn = 9 * 2;
    const allowed = turnsIn - pairs.length;
    expect(allowed).toBeGreaterThan(0);
    expect(allowed / turnsIn).toBeGreaterThan(QUIET_ENTRY - 0.3);
    expect(allowed / turnsIn).toBeLessThan(QUIET_ENTRY + 0.3);
    // The same graph forbids the same turns every build.
    expect(JSON.parse(trafficJson([main, ...sides], [])).intersections).toEqual(j.intersections);
  });

  it("keeps a way on for a main road that ends at a T among quiet streets", () => {
    const stub = { ...road(line([0, -200], [0, -4], 60), 8, 60), zone: Array(61).fill("busy") } as TrafficRoad;
    const cross = { ...road(line([-150, 0], [150, 0], 60), 7, 50), zone: Array(61).fill("quiet") } as TrafficRoad;
    const t: Json = JSON.parse(trafficJson([stub, cross], []));
    const into = t.lanes.find((l) => l.name === "Road 1 forward")!;
    const leaving = t.lanes.filter((l) => l.name.startsWith("Road 2"));
    const junction = t.intersections.find((it) => inPolygon(it.points.map(local), [0, 0]))!;
    const blocked = (junction.disallowedTrajectories ?? []).filter(([f]) => f === into.id).map(([, to]) => to);
    expect(leaving.some((l) => !blocked.includes(l.id))).toBe(true);
  });

  it("gives a stretch in another zone an area with its own role and limit", () => {
    // The route through the town centre for its middle 200 m.
    const pts = line([-400, 0], [400, 0], 160);
    const route = { ...road(pts, 8, 60), zone: pts.map(([x]) => (Math.abs(x) < 100 ? "centre" : "busy")) } as TrafficRoad;
    const r: Json = JSON.parse(trafficJson([route], []));
    for (const l of r.lanes) expect(r.rules.laneRoles[l.role - 1].name).toBe("Busy street 60");
    const area = r.areas.find((a) => a.name === "Town centre 40")!;
    expect(area).toBeDefined();
    expect(area.params.customSpeedLimit).toBe(true);
    expect(area.params.speedLimit).toBe(40);
    expect(r.rules.laneRoles[area.params.role - 1].priority).toBe(ZONES.centre.priority);
    expect(area.shapes).toHaveLength(2); // one strip per lane
    // The strips hold the lanes' points in the centre and none well outside it.
    for (const l of r.lanes) {
      for (const p of l.points) {
        const x = p[0], inside = area.shapes.some((s) => inPolygon(s.map(local), local(p)));
        if (Math.abs(x) < 95) expect(inside).toBe(true);
        if (Math.abs(x) > 115) expect(inside).toBe(false);
      }
    }
  });
});

describe("kids' setting", () => {
  const main = { ...road(line([-300, 0], [300, 0], 120), 8, 60), zone: Array(121).fill("busy") } as TrafficRoad;
  const side = { ...road(line([0, 4.5], [0, 150], 40), 6, 50), zone: Array(41).fill("quiet") } as TrafficRoad;
  const normal = trafficJson([main, side], [{ c: [200, 120], h: 2, rIn: 6, rOut: 12 }]);
  const kids: Json = JSON.parse(trafficJson([main, side], [{ c: [200, 120], h: 2, rIn: 6, rOut: 12 }], "kids"));

  it("caps every limit at the kids' figure for its zone and suggests fewer cars", () => {
    const n: Json = JSON.parse(normal);
    for (const r of kids.rules.laneRoles) expect(r.speedLimit).toBeLessThanOrEqual(ZONES[r.zone as keyof typeof ZONES].kids);
    expect(kids.rules.laneRoles.map((r) => r.name).sort()).toEqual(["Busy street 40", "Quiet street 30", "Roundabout 20"]);
    for (const l of kids.lanes) expect(l.speedLimit).toBe(kids.rules.laneRoles[l.role - 1].speedLimit);
    expect(kids.busselton.setting).toBe("kids");
    expect(kids.busselton.cars).toBeLessThan(n.busselton.cars);
    // Same lanes, junctions and turn limits: only the limits and the suggestion change.
    expect(kids.lanes.map((l) => l.points)).toEqual(n.lanes.map((l) => l.points));
    expect(kids.intersections).toEqual(n.intersections);
  });

  it("is the same applied to a built file, and applying it twice changes nothing", () => {
    expect(JSON.parse(trafficForSetting(normal, "kids"))).toEqual(kids);
    expect(JSON.parse(trafficForSetting(JSON.stringify(kids), "kids"))).toEqual(kids);
    expect(trafficForSetting(normal, "normal")).toBe(normal);
  });

  it("caps areas' limits too, and works on a file without zones", () => {
    const pts = line([-400, 0], [400, 0], 160);
    const route = { ...road(pts, 8, 60), zone: pts.map(([x]) => (Math.abs(x) < 100 ? "centre" : "busy")) } as TrafficRoad;
    const r: Json = JSON.parse(trafficJson([route], [], "kids"));
    expect(r.areas[0].params.speedLimit).toBe(ZONES.centre.kids);
    const plain: Json = JSON.parse(trafficJson([road(line([0, 0], [300, 0]), 7, 60)], [{ c: [150, 60], h: 2, rIn: 6, rOut: 12 }], "kids"));
    expect(plain.rules.laneRoles.find((x) => x.name === "Local street")!.speedLimit).toBe(30);
    expect(plain.rules.laneRoles.find((x) => x.name === "Roundabout")!.speedLimit).toBe(20);
    expect(plain.busselton.setting).toBe("kids");
  });

  it("merges roles the caps make the same", () => {
    const a = { ...road(line([-300, 0], [0, 0], 60), 8, 60), zone: Array(61).fill("busy") } as TrafficRoad;
    const b = { ...road(line([0, 50], [0, 400], 60), 8, 50), zone: Array(61).fill("busy") } as TrafficRoad;
    const n: Json = JSON.parse(trafficJson([a, b], []));
    expect(n.rules.laneRoles.map((r) => r.name)).toEqual(["Busy street 50", "Busy street 60"]);
    const k: Json = JSON.parse(trafficJson([a, b], [], "kids"));
    expect(k.rules.laneRoles.map((r) => r.name)).toEqual(["Busy street 40"]);
    for (const l of k.lanes) expect(l.role).toBe(1);
  });

  it("suggests car counts within sensible bounds", () => {
    expect(suggestedCars(0.5, "normal")).toBe(50);
    expect(suggestedCars(100, "normal")).toBe(400);
    expect(suggestedCars(1000, "normal")).toBe(800);
    expect(suggestedCars(100, "kids")).toBe(100);
    expect(suggestedCars(5, "kids")).toBe(20);
  });
});
