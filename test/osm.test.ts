// src/services/osm.ts, from docs/specs/osm.md "Tests to write".
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeFetch, type Recorded } from "./helpers/browserFakes";
import type { LngLat } from "../src/core/geo";
import { JETTY_SNAPSHOT, JETTY_SNAPSHOT_BOX } from "../src/services/jettySnapshot";

// A fresh module graph per test (session caches, the Nominatim clock); dataWarnings from the same graph.
let dataWarnings: string[] = [];
async function load() {
  vi.resetModules();
  dataWarnings = (await import("../src/services/dataWarnings")).dataWarnings;
  return import("../src/services/osm");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ROUTE: LngLat[] = [[115.1, -33.6], [115.2, -33.61]];
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const query = (r: Recorded) => new URLSearchParams(r.body).get("data")!;
const EMPTY = { elements: [] };

const GOLDEN_MAIN =
  "[out:json][timeout:40];(\n    way(around:12,-33.600000,115.100000,-33.610000,115.200000)[highway];\n    way(around:15,-33.600000,115.100000,-33.610000,115.200000)[barrier=guard_rail];\n    way(around:30,-33.600000,115.100000,-33.610000,115.200000)[junction~\"^(roundabout|circular)$\"];\n    node(around:40,-33.600000,115.100000,-33.610000,115.200000)[power=pole];\n    node(around:40,-33.600000,115.100000,-33.610000,115.200000)[highway=street_lamp];\n    way(around:40,-33.600000,115.100000,-33.610000,115.200000)[power~\"^(line|minor_line)$\"];\n    way(around:45,-33.600000,115.100000,-33.610000,115.200000)[barrier~\"^(fence|wall|hedge|retaining_wall)$\"];\n    way(around:300,-33.600000,115.100000,-33.610000,115.200000)[man_made~\"^(groyne|breakwater)$\"];\n  );out tags geom;";
const GOLDEN_SIGNALS =
  "[out:json][timeout:30];(\n    node(around:40,-33.600000,115.100000,-33.610000,115.200000)[highway=traffic_signals];\n    node(around:40,-33.600000,115.100000,-33.610000,115.200000)[highway=crossing][crossing=traffic_signals];\n    node(around:40,-33.600000,115.100000,-33.610000,115.200000)[highway=crossing][\"crossing:signals\"=yes];\n  );out;";

describe("Overpass queries", () => {
  it("main query: the golden text, the cattle line, polygons, the form body", async () => {
    const osm = await load();
    const log = fakeFetch(() => json(EMPTY));
    await osm.fetchOsm(ROUTE);
    expect(log).toHaveLength(3);
    expect(log.map((r) => r.url)).toEqual([
      "https://overpass-api.de/api/interpreter",
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
    ]);
    expect(log.every((r) => r.method === "POST")).toBe(true);
    expect(query(log[0])).toBe(GOLDEN_MAIN);
    expect(log[0].body.startsWith("data=%5Bout%3Ajson%5D%5Btimeout%3A40%5D%3B%28%0A++++way%28around%3A12%2C-33.600000%2C115.100000")).toBe(true);

    log.length = 0;
    await osm.fetchOsm(ROUTE, [[[115.1, -33.6], [115.2, -33.6], [115.2, -33.7]], [[1, 2], [3, 4]]], { cattleGrids: true });
    const q = query(log[0]);
    const lines = q.split("\n");
    expect(lines[0]).toBe("[out:json][timeout:90];(");
    const fence = lines.findIndex((l) => l.includes("retaining_wall") && l.includes("around:45"));
    expect(lines[fence + 1]).toBe("    node(around:30,-33.600000,115.100000,-33.610000,115.200000)[barrier=cattle_grid];");
    expect(lines[fence + 2]).toContain("man_made");
    const P = 'poly:"-33.600000 115.100000 -33.600000 115.200000 -33.700000 115.200000"';
    expect(lines.slice(fence + 3)).toEqual([
      `    way(${P})[highway];`,
      `    way(${P})[junction~"^(roundabout|circular)$"];`,
      `    node(${P})[power=pole];`,
      `    node(${P})[highway=street_lamp];`,
      `    way(${P})[power~"^(line|minor_line)$"];`,
      `    way(${P})[barrier~"^(fence|wall|hedge|retaining_wall)$"];`,
      `    node(${P})[barrier=cattle_grid];`,
      "  );out tags geom;",
    ]);
    log.length = 0;
    await osm.fetchOsm(ROUTE, [[[115.1, -33.6], [115.2, -33.6], [115.2, -33.7]]]);
    expect(query(log[0])).not.toContain("cattle_grid");
    expect(query(log[0])).toContain(`way(${P})[barrier~"^(fence|wall|hedge|retaining_wall)$"];\n  );out tags geom;`);
  });

  it("sampling keeps at most about 180 points, the last always, never twice", async () => {
    const osm = await load();
    const line = (n: number) => Array.from({ length: n }, (_, i) => [115 + i * 1e-4, -33] as LngLat);
    const count = (q: string) => q.split("\n")[1].replace(/^.*around:12,/, "").replace(/\)\[.*$/, "").split(",").length / 2;
    const last = (q: string) => q.split("\n")[1].replace(/\)\[.*$/, "").split(",").slice(-1)[0];
    const q = (n: number) => osm.signalQuery(line(n)).replace("around:40,", "around:12,");
    expect(count(q(181))).toBe(91);
    expect(q(181).split("\n")[1]).toContain(",115.018000)"); // index 180 kept once
    expect(count(q(360))).toBe(181); // step 2: 180 even indices, plus the last
    expect(last(q(360))).toBe((115 + 359e-4).toFixed(6));
    expect(count(q(361))).toBe(121); // step 3: 0, 3, ... 360
    expect(count(q(100))).toBe(100);
  });

  it("signalQuery golden; areas add a block and timeout 60", async () => {
    const osm = await load();
    expect(osm.signalQuery(ROUTE)).toBe(GOLDEN_SIGNALS);
    const q = osm.signalQuery(ROUTE, [[[115.1, -33.6], [115.2, -33.6], [115.2, -33.7]]]);
    expect(q.startsWith("[out:json][timeout:60];(")).toBe(true);
    expect(q.split("\n")).toHaveLength(8);
    expect(q).toContain('\n    node(poly:"-33.600000 115.100000 -33.600000 115.200000 -33.700000 115.200000")[highway=crossing]["crossing:signals"=yes];\n  );out;');
  });

  it("signalsFromElements", async () => {
    const osm = await load();
    const n = (id: number, tags: Record<string, string>, lat = -33.6 - id * 1e-4) => ({ type: "node", id, lat, lon: 115.1, tags });
    expect(osm.signalsFromElements([
      n(1, { highway: "traffic_signals" }),
      n(2, { highway: "crossing", crossing: "traffic_signals" }),
      n(3, { highway: "traffic_signals", traffic_signals: "emergency" }),
      n(4, { highway: "traffic_signals", traffic_signals: "blinker" }),
      n(5, { highway: "traffic_signals", traffic_signals: "level_crossing" }),
      n(6, { highway: "traffic_signals", traffic_signals: "ramp_meter" }),
      n(7, { highway: "traffic_signals" }, -33.6 - 1e-4 + 1e-9),
      { type: "way", tags: { highway: "traffic_signals" } },
      n(9, { railway: "crossing" }),
    ])).toEqual([
      { at: [115.1, -33.6 - 1e-4], crossing: false },
      { at: [115.1, -33.6 - 2e-4], crossing: true },
    ]);
  });

  it("reads the elements: nodes, power lines, rings, barriers, widths, streets", async () => {
    const osm = await load();
    const g = (pts: number[][]) => pts.map(([lon, lat]) => ({ lat, lon }));
    const w = (id: number, tags: Record<string, string>) => ({ type: "way", id, tags, geometry: g([[115.1 + id * 1e-3, -33.6], [115.1 + id * 1e-3, -33.601]]) });
    fakeFetch(() => json({ elements: [
      { type: "node", id: 1, lat: -33.6, lon: 115.1, tags: { power: "pole", highway: "street_lamp" } },
      { type: "node", id: 2, lat: -33.6, lon: 115.2, tags: { highway: "street_lamp" } },
      { type: "node", id: 3, lat: -33.6, lon: 115.3, tags: { barrier: "cattle_grid" } },
      w(4, { power: "line", voltage: "22000" }),
      w(5, { power: "line", voltage: "132000" }),
      w(6, { power: "line" }),
      w(7, { power: "minor_line" }),
      w(8, { man_made: "groyne" }),
      w(9, { junction: "roundabout", highway: "primary", lanes: "2" }),
      w(10, { junction: "roundabout", lanes: "9" }),
      w(11, { barrier: "fence", height: "1.8", fence_type: "wire" }),
      w(12, { barrier: "guard_rail" }),
      w(13, { highway: "residential" }),
      w(14, { highway: "primary", width: "9.5" }),
      w(15, { highway: "secondary", lanes: "2" }),
      w(16, { highway: "tertiary", lanes: "1" }),
      w(17, { highway: "service", access: "private" }),
      w(18, { highway: "track" }),
      w(19, { highway: "residential", bridge: "yes", oneway: "yes", service: "x" }),
      w(20, { highway: "residential", tunnel: "yes", oneway: "-1" }),
    ] }));
    const d = await osm.fetchOsm(ROUTE);
    const f = d.features;
    expect(f.poles).toEqual([[115.1, -33.6]]);
    expect(f.lamps).toEqual([[115.2, -33.6]]);
    expect(f.cattleGrids).toEqual([[115.3, -33.6]]);
    expect(f.powerLines!.map((l) => Math.round(l[0][0] * 1e3))).toEqual([115104, 115107]);
    expect(f.groynes).toHaveLength(1);
    expect(f.roundaboutRings!.map((r) => r.lanes)).toEqual([2, undefined]);
    expect(f.barriers).toEqual([{ pts: expect.any(Array), kind: "fence", fenceType: "wire", material: undefined, height: 1.8 }]);
    expect(f.guardRails).toHaveLength(1);
    const width = (id: number) => d.widthAt!([115.1 + id * 1e-3, -33.6005]);
    expect([13, 14, 15, 16, 17].map(width)).toEqual([6, 9.5, 6.4, 3.5, 4]);
    expect(width(9)).toBeUndefined(); // rings give no width
    expect(f.unsealed!.map((l) => Math.round(l[0][0] * 1e3))).toEqual([115118]);
    const road = (id: number) => d.roads!.find((r) => Math.abs(r.pts[0][0] - (115.1 + id * 1e-3)) < 1e-9);
    expect(road(17)).toBeUndefined(); // private: width but no street
    expect(road(18)).toMatchObject({ cls: "track", surface: "unpaved" });
    expect(road(19)).toMatchObject({ cls: "minor", brunnel: "bridge", oneway: 1, service: "x" });
    expect(road(20)).toMatchObject({ brunnel: "tunnel", oneway: -1 });
    expect(f.buildings).toEqual([]);
  });

  it("widthLookup: nearest within 12 m; zero-length segments are fine", async () => {
    const osm = await load();
    const lat = -33.6;
    const m = 1 / 111320;
    const look = osm.widthLookup([
      { width: 6, pts: [[115.1, lat], [115.2, lat]] },
      { width: 9, pts: [[115.15, lat + 5 * m], [115.15, lat + 5 * m]] },
    ], lat);
    expect(look([115.15, lat + 2 * m])).toBe(6);
    expect(look([115.15, lat + 4 * m])).toBe(9);
    expect(look([115.12, lat + 11.9 * m])).toBe(6);
    expect(look([115.12, lat - 13 * m])).toBeUndefined();
  });
});

describe("joinWays", () => {
  type W = { pts: LngLat[]; cls: string; oneway?: 1 | -1; brunnel?: string; service?: string; surface?: string };
  const P = (i: number, j = 0): LngLat => [115 + i * 1e-3, -33 - j * 1e-3];

  it("joins two halves end to start, and start to start with the first reversed", async () => {
    const { joinWays } = await load();
    expect(joinWays([{ pts: [P(0), P(1)], cls: "minor" }, { pts: [P(1), P(2)], cls: "minor" }])).toEqual([{ pts: [P(0), P(1), P(2)], cls: "minor" }]);
    expect(joinWays([{ pts: [P(1), P(0)], cls: "minor" }, { pts: [P(1), P(2)], cls: "minor" }])).toEqual([{ pts: [P(0), P(1), P(2)], cls: "minor" }]);
  });

  it("three at a point don't join; different kinds don't join", async () => {
    const { joinWays } = await load();
    const three: W[] = [{ pts: [P(0), P(1)], cls: "minor" }, { pts: [P(1), P(2)], cls: "minor" }, { pts: [P(1), P(1, 1)], cls: "minor" }];
    expect(joinWays(three)).toEqual(three);
    for (const diff of [{ cls: "service" }, { service: "alley" }, { surface: "unpaved" }, { brunnel: "bridge" }]) {
      const ways: W[] = [{ pts: [P(0), P(1)], cls: "minor" }, { pts: [P(1), P(2)], cls: "minor", ...diff }];
      expect(joinWays(ways)).toHaveLength(2);
    }
  });

  it("one-ways join in the same direction (sign right when the first is reversed), not head to head", async () => {
    const { joinWays } = await load();
    expect(joinWays([{ pts: [P(0), P(1)], cls: "primary", oneway: 1 }, { pts: [P(1), P(2)], cls: "primary", oneway: 1 }]))
      .toEqual([{ pts: [P(0), P(1), P(2)], cls: "primary", oneway: 1 }]);
    // First drawn backwards (P1 to P0, traffic P0 to P1 via -1): reversed, its one-way flips to +1.
    expect(joinWays([{ pts: [P(1), P(0)], cls: "primary", oneway: -1 }, { pts: [P(1), P(2)], cls: "primary", oneway: 1 }]))
      .toEqual([{ pts: [P(0), P(1), P(2)], cls: "primary", oneway: 1 }]);
    expect(joinWays([{ pts: [P(0), P(1)], cls: "primary", oneway: 1 }, { pts: [P(2), P(1)], cls: "primary", oneway: 1 }])).toHaveLength(2);
    expect(joinWays([{ pts: [P(0), P(1)], cls: "primary", oneway: 1 }, { pts: [P(1), P(2)], cls: "primary" }])).toHaveLength(2);
  });

  it("closed ways never join; the input isn't changed; slots keep their order", async () => {
    const { joinWays } = await load();
    const ringFirst: W[] = [{ pts: [P(0), P(1), P(1, 1), P(0)], cls: "minor" }, { pts: [P(0), P(0, 1)], cls: "minor" }];
    expect(joinWays(ringFirst)).toEqual(ringFirst);
    const ringSecond: W[] = [{ pts: [P(5), P(1)], cls: "minor" }, { pts: [P(1), P(1, 1), P(2, 1), P(1)], cls: "minor" }];
    expect(joinWays(ringSecond)).toEqual(ringSecond);
    const ways: W[] = [{ pts: [P(2), P(3)], cls: "minor" }, { pts: [P(9), P(9, 1)], cls: "track" }, { pts: [P(1), P(2)], cls: "minor" }];
    const copy = structuredClone(ways);
    expect(joinWays(ways)).toEqual([{ pts: [P(3), P(2), P(1)], cls: "minor" }, ways[1]]);
    expect(ways).toEqual(copy);
  });
});

describe("Overpass protocol", () => {
  it("the first mirror to answer wins and the rest are aborted", async () => {
    const osm = await load();
    const signals: AbortSignal[] = [];
    fakeFetch((url, init) => {
      signals.push(init!.signal!);
      if (url.includes("mail.ru")) return json({ elements: [{ type: "node", id: 1, lat: -33.6, lon: 115.1, tags: { power: "pole" } }] });
      return new Promise<Response>((_, no) => init!.signal!.addEventListener("abort", () => no(new Error("aborted"))));
    });
    const d = await osm.fetchOsm(ROUTE);
    expect(d.features.poles).toEqual([[115.1, -33.6]]);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it("a timed-out remark fails; three failed rounds wait 5 s then 10 s, then warn", async () => {
    const osm = await load();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const log = fakeFetch(() => json({ remark: "runtime error: Query timed out in \"query\" at line 1 after 41 seconds.", elements: [] }));
    const p = osm.fetchOsm(ROUTE);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(4999);
    expect(log).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(log).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(9999);
    expect(log).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(1);
    const d = await p;
    expect(log).toHaveLength(9);
    expect(dataWarnings).toEqual(["OpenStreetMap (Overpass): roundabouts, road widths, poles, lights, fences"]);
    expect(d.widthAt).toBeUndefined();
    expect(d.roads).toBeUndefined();
    expect(d.features).toEqual({ buildings: [], guardRails: [], roundaboutRings: [], poles: [], lamps: [], powerLines: [], barriers: [], groynes: [], cattleGrids: [], unsealed: [] });
  });

  it("traffic signals are a POST of their own; the main body is unchanged", async () => {
    const osm = await load();
    const log = fakeFetch((_, init) => {
      const q = new URLSearchParams(String(init!.body)).get("data")!;
      return json(q.includes("traffic_signals") ? { elements: [{ type: "node", id: 1, lat: -33.6, lon: 115.1, tags: { highway: "traffic_signals" } }] } : EMPTY);
    });
    const d = await osm.fetchOsm(ROUTE, [], { trafficSignals: true });
    expect(log).toHaveLength(6);
    expect(log.filter((r) => query(r) === GOLDEN_MAIN)).toHaveLength(3);
    expect(log.filter((r) => query(r) === GOLDEN_SIGNALS)).toHaveLength(3);
    expect(d.features.trafficSignals).toEqual([{ at: [115.1, -33.6], crossing: false }]);
    const off = await osm.fetchOsm(ROUTE);
    expect(off.features.trafficSignals).toBeUndefined();
  });

  it("an empty route is a clear error", async () => {
    const osm = await load();
    await expect(osm.fetchOsm([])).rejects.toThrow(/at least one route point/);
  });
});

describe("ways, jetty, routing, places", () => {
  const g = (pts: number[][]) => pts.map(([lon, lat]) => ({ lat, lon }));

  it("fetchWayGeoms: bad ids before any fetch; missing ids; ids' order; routeWays caches and retries after a failure", async () => {
    const osm = await load();
    const log = fakeFetch(() => json({ elements: [
      { type: "way", id: 2, geometry: g([[115.101, -33.6], [115.102, -33.6]]) },
      { type: "way", id: 1, geometry: g([[115.1, -33.6], [115.101, -33.6]]) },
    ] }));
    await expect(osm.fetchWayGeoms([1, 2.5])).rejects.toThrow('"ways" must be OSM way ids (whole numbers), not 2.5');
    expect(log).toHaveLength(0);
    await expect(osm.fetchWayGeoms([1, 2, 3, 4])).rejects.toThrow("OSM ways 3, 4 not found (deleted, or a wrong id)");
    expect(query(log[0])).toBe("[out:json][timeout:40];way(id:1,2,3,4);out tags geom;");
    expect((await osm.fetchWayGeoms([1, 2])).map((w) => w.id)).toEqual([1, 2]);

    log.length = 0;
    const through: LngLat[] = [[115.1002, -33.6], [115.1018, -33.6]];
    await osm.routeWays([1, 2], through);
    await osm.routeWays([1, 2], through);
    expect(log).toHaveLength(3); // one Overpass round, three mirrors

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const down = fakeFetch(() => new Response("", { status: 504 }));
    const failing = osm.routeWays([7], through).catch((e: Error) => e.message);
    await vi.runAllTimersAsync();
    expect(await failing).toMatch(/^couldn't fetch OSM ways 7 from Overpass \(every mirror failed 3 times: .*\); build again$/);
    expect(down).toHaveLength(9);
    fakeFetch(() => json({ elements: [{ type: "way", id: 7, geometry: g([[115.1, -33.6], [115.102, -33.6]]) }] }));
    vi.useRealTimers();
    expect((await osm.routeWays([7], through)).coords.length).toBeGreaterThan(1);
  });

  it("fetchPierFeatures: platforms, railways, named buildings; the jetty snapshot when every mirror is down", async () => {
    const osm = await load();
    const log = fakeFetch(() => json({ elements: [
      { type: "way", id: 1, tags: { railway: "platform", shelter: "yes" }, geometry: g([[1, 2], [3, 4]]) },
      { type: "way", id: 2, tags: { railway: "narrow_gauge" }, geometry: g([[1, 2], [3, 4]]) },
      { type: "way", id: 3, tags: { building: "yes", name: "Shed" }, geometry: g([[1, 2], [3, 4], [5, 6]]) },
      { type: "way", id: 4, tags: { building: "yes" }, geometry: g([[1, 2], [3, 4]]) },
    ] }));
    const r = await osm.fetchPierFeatures([115.86, -31.96, 115.87, -31.95]);
    expect(r.platforms).toEqual([{ pts: [[1, 2], [3, 4]], shelter: true }]);
    expect(r.railways).toEqual([[[1, 2], [3, 4]]]);
    expect(r.buildings).toEqual([{ pts: [[1, 2], [3, 4], [5, 6]], name: "Shed" }]);
    expect(query(log[0])).toBe('[out:json][timeout:40];(\n    way(-31.960000,115.860000,-31.950000,115.870000)[railway~"^(narrow_gauge|miniature|light_rail|tram|rail)$"];\n    way(-31.960000,115.860000,-31.950000,115.870000)[railway=platform];\n    way(-31.960000,115.860000,-31.950000,115.870000)[public_transport=platform];\n    way(-31.960000,115.860000,-31.950000,115.870000)[building];\n  );out tags geom;');

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fakeFetch(() => json({ remark: "runtime error: out of memory", elements: [] }));
    const [w, s, e, n] = JETTY_SNAPSHOT_BOX;
    const jetty = osm.fetchPierFeatures([w + 0.001, s + 0.001, e - 0.001, n - 0.001]);
    await vi.runAllTimersAsync();
    expect(await jetty).toEqual(JETTY_SNAPSHOT);
    expect(dataWarnings).toEqual([]);
    const elsewhere = osm.fetchPierFeatures([115.86, -31.96, 115.87, -31.95]);
    await vi.runAllTimersAsync();
    expect(await elsewhere).toEqual({ railways: [], platforms: [], buildings: [] });
    expect(dataWarnings).toEqual(["jetty features (OSM: its railway, platforms, buildings)"]);
  });

  it("route: the URL, roundabouts and U-turns, error messages", async () => {
    const osm = await load();
    const coords: LngLat[] = [[115.84, -31.96], [115.85, -31.96]];
    const log = fakeFetch(() => json({ code: "Ok", routes: [{ distance: 950, geometry: { coordinates: coords }, legs: [{ steps: [
      { maneuver: { type: "roundabout", location: [115.845, -31.96] }, geometry: { coordinates: [[115.845, -31.96]] } },
      { maneuver: { type: "exit roundabout", location: [115.846, -31.96] } },
      { maneuver: { type: "turn", modifier: "uturn", location: [116, -31] } },
    ] }] }] }));
    const r = await osm.route([[115.8400004, -31.96], [115.85, -31.9600006]]);
    expect(log[0].url).toBe("https://router.project-osrm.org/route/v1/driving/115.840000,-31.960000;115.850000,-31.960001?overview=full&geometries=geojson&steps=true&continue_straight=true");
    expect(r).toEqual({ coords, distance: 950, roundabouts: [{ location: [115.845, -31.96], arc: [[115.845, -31.96]] }], uturns: [[116, -31]], trimmed: [] });
    fakeFetch(() => json({ code: "NoRoute", message: "Impossible route" }, 400));
    await expect(osm.route(coords)).rejects.toThrow("Impossible route");
  });

  it("route: a U-turn spur is cut, the distance recomputed and a roundabout on the spur dropped", async () => {
    const osm = await load();
    const line: LngLat[] = Array.from({ length: 41 }, (_, i) => [115.84 + i * 1e-4, -31.96]);
    const spur: LngLat[] = Array.from({ length: 15 }, (_, i) => [115.842, -31.96 + (i + 1) * 1e-4]);
    const coords = [...line.slice(0, 21), ...spur, ...spur.slice(0, -1).reverse(), [115.842, -31.96] as LngLat, ...line.slice(21)];
    fakeFetch(() => json({ code: "Ok", routes: [{ distance: 9999, geometry: { coordinates: coords }, legs: [{ steps: [
      { maneuver: { type: "roundabout", location: [115.843, -31.96] } },
      { maneuver: { type: "rotary", location: [115.842, -31.9588] } },
      { maneuver: { type: "continue", modifier: "uturn", location: [115.842, -31.9585] } },
    ] }] }] }));
    const r = await osm.route([[115.84, -31.96], [115.844, -31.96]]);
    expect(r.trimmed).toEqual([[115.842, -31.9585]]);
    expect(r.uturns).toEqual([]);
    expect(r.distance).toBeLessThan(9999);
    expect(r.distance).toBeGreaterThan(300);
    expect(r.roundabouts.map((x) => x.location)).toEqual([[115.843, -31.96]]);
  });

  it("route retries a busy server and passes the caller's abort through", async () => {
    const osm = await load();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    let n = 0;
    const log = fakeFetch(() => (n++ < 2 ? new Response("busy", { status: 429 }) : json({ code: "Ok", routes: [{ distance: 1, geometry: { coordinates: [[1, 2], [3, 4]] }, legs: [] }] })));
    const p = osm.route([[1, 2], [3, 4]]);
    await vi.runAllTimersAsync();
    expect((await p).distance).toBe(1);
    expect(log).toHaveLength(3);
    expect(new Set(log.map((r) => r.url)).size).toBe(1);
    const ctl = new AbortController();
    ctl.abort();
    await expect(osm.route([[1, 2], [3, 4]], ctl.signal)).rejects.toBeTruthy();
  });

  it("searchPlaces and reverseGeocode", async () => {
    const osm = await load();
    const log = fakeFetch(() => json({ features: [
      { geometry: { coordinates: [1, 2] }, properties: { name: "Kings Park", street: "Fraser Ave", city: "Perth", country: "Australia", extent: [1, 3, 2, 1] } },
      { geometry: { coordinates: [3, 4] }, properties: { street: "Hay St", city: "Perth" } },
    ] }));
    expect(await osm.searchPlaces("kings park", [115.8512345, -31.95])).toEqual([
      { label: "Kings Park", detail: "Fraser Ave, Perth, Australia", lngLat: [1, 2], extent: [1, 3, 2, 1] },
      { label: "Hay St", detail: "Perth", lngLat: [3, 4] },
    ]);
    expect(log[0].url).toBe("https://photon.komoot.io/api/?q=kings+park&limit=6&lon=115.8512&lat=-31.9500");

    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const starts: number[] = [];
    const rlog = fakeFetch(() => {
      starts.push(Date.now());
      return json({ address: { road: "Hay St", suburb: "Perth", country: "Australia" } });
    });
    const calls = [osm.reverseGeocode([115.85, -31.95]), osm.reverseGeocode([115.86, -31.95]), osm.reverseGeocode([115.87, -31.95])];
    await vi.runAllTimersAsync();
    const got = await Promise.all(calls);
    expect(got[0]).toEqual({ road: "Hay St", town: "Perth", country: "Australia" });
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1100);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1100);
    expect(rlog[0].url).toBe("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=-31.95&lon=115.85");
  });
});
