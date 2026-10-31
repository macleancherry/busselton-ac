// Golden replay: the rewritten services must send exactly the requests the old ones did (method,
// URL and body are the headless cache and snapshot keys) and give the same answers. The goldens in
// test/fixtures/golden-services were recorded from the old modules with the same fake fetch and
// the same calls as here, before they were deleted.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeCanvas, fakeFetch, pngResponse, solidTile, taggedImage, terrariumRgb, type Recorded } from "./helpers/browserFakes";
import { encodeMvt } from "./helpers/mvt";
import { LocalProjection, type LngLat } from "../src/core/geo";
import * as osm from "../src/services/osm";
import * as tiles from "../src/services/tiles";
import * as vt from "../src/services/vectorTiles";

const DIR = "test/fixtures/golden-services";
const golden = (name: string) => JSON.parse(readFileSync(`${DIR}/${name}.json`, "utf8"));
/** Requests as cache keys, sorted: the order they go out in isn't part of the key. */
const keys = (log: Recorded[]) => log.map((r) => `${r.method} ${r.url} ${r.body}`).sort();
function normalise(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = k === "requests" && Array.isArray(x) ? keys(x as Recorded[]) : normalise(x);
    return o;
  }
  return v;
}
/** Compare with the golden of the same name; `fix` edits the golden where a deliberate bug fix changes the answer. */
const save = (name: string, v: unknown, fix?: (g: Record<string, any>) => void) => {
  const now = normalise(JSON.parse(JSON.stringify(v)));
  const g = golden(name);
  fix?.(g);
  expect(now).toEqual(normalise(g));
};
afterEach(() => vi.unstubAllGlobals());
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const strip = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "function" ? "[fn]" : x)));

// Perth (no state DEM box, WA imagery), the capes (inside the WA DEM box), elsewhere.
const PERTH: LngLat[] = [[115.84, -31.96], [115.845, -31.9575], [115.85, -31.955], [115.86, -31.952]];
const SPEC_ROUTE: LngLat[] = [[115.1, -33.6], [115.2, -33.61]];
const LONG: LngLat[] = Array.from({ length: 400 }, (_, i) => [115.8 + i * 0.0002, -31.9 - i * 0.0001] as LngLat);
const AREA1: LngLat[] = [[115.84, -31.96], [115.85, -31.96], [115.85, -31.95], [115.84, -31.95]];
const AREA2: LngLat[] = [[115.86, -31.955], [115.87, -31.955], [115.865, -31.945]];
const TINY: LngLat[] = [[115.8, -31.9], [115.81, -31.9]];

const g = (pts: number[][]) => pts.map(([lon, lat]) => ({ lat, lon }));
const OVERPASS_ANSWER = {
  elements: [
    { type: "node", id: 1, lat: -31.956, lon: 115.846, tags: { power: "pole", highway: "street_lamp" } },
    { type: "node", id: 2, lat: -31.957, lon: 115.847, tags: { highway: "street_lamp" } },
    { type: "node", id: 3, lat: -31.958, lon: 115.848, tags: { barrier: "cattle_grid" } },
    { type: "node", id: 4, tags: { power: "pole" } },
    { type: "way", id: 10, tags: { power: "line", voltage: "22000" }, geometry: g([[115.84, -31.956], [115.85, -31.956]]) },
    { type: "way", id: 11, tags: { power: "line", voltage: "132000;66000" }, geometry: g([[115.84, -31.957], [115.85, -31.957]]) },
    { type: "way", id: 12, tags: { power: "line" }, geometry: g([[115.84, -31.958], [115.85, -31.958]]) },
    { type: "way", id: 13, tags: { power: "minor_line" }, geometry: g([[115.84, -31.959], [115.85, -31.959]]) },
    { type: "way", id: 14, tags: { man_made: "groyne" }, geometry: g([[115.83, -31.95], [115.831, -31.951]]) },
    { type: "way", id: 15, tags: { junction: "roundabout", highway: "secondary", lanes: "2" }, geometry: g([[115.845, -31.957], [115.8452, -31.9572], [115.845, -31.9574], [115.845, -31.957]]) },
    { type: "way", id: 16, tags: { junction: "circular", highway: "tertiary", lanes: "9" }, geometry: g([[115.846, -31.957], [115.8462, -31.9572], [115.846, -31.957]]) },
    { type: "way", id: 17, tags: { barrier: "fence", fence_type: "chain_link", material: "metal", height: "1.8" }, geometry: g([[115.84, -31.95], [115.841, -31.95]]) },
    { type: "way", id: 18, tags: { barrier: "hedge", height: "tall" }, geometry: g([[115.84, -31.951], [115.841, -31.951]]) },
    { type: "way", id: 19, tags: { barrier: "guard_rail" }, geometry: g([[115.842, -31.95], [115.843, -31.95]]) },
    { type: "way", id: 20, tags: { highway: "residential", name: "A" }, geometry: g([[115.84, -31.96], [115.845, -31.9575]]) },
    { type: "way", id: 21, tags: { highway: "residential", name: "A" }, geometry: g([[115.845, -31.9575], [115.85, -31.955]]) },
    { type: "way", id: 22, tags: { highway: "primary", width: "9.5", oneway: "yes" }, geometry: g([[115.85, -31.955], [115.86, -31.952]]) },
    { type: "way", id: 23, tags: { highway: "secondary", lanes: "2", bridge: "yes" }, geometry: g([[115.86, -31.952], [115.861, -31.951]]) },
    { type: "way", id: 24, tags: { highway: "tertiary", lanes: "1", tunnel: "culvert", oneway: "-1" }, geometry: g([[115.862, -31.952], [115.863, -31.951]]) },
    { type: "way", id: 25, tags: { highway: "service", service: "driveway", access: "private" }, geometry: g([[115.846, -31.958], [115.847, -31.959]]) },
    { type: "way", id: 26, tags: { highway: "track", surface: "gravel", tracktype: "grade3" }, geometry: g([[115.847, -31.96], [115.848, -31.961]]) },
    { type: "way", id: 27, tags: { highway: "service", service: "parking_aisle", "parking:both": "parallel" }, geometry: g([[115.848, -31.958], [115.849, -31.958]]) },
    { type: "way", id: 28, tags: { highway: "motorway_link" }, geometry: g([[115.87, -31.95], [115.871, -31.95]]) },
    { type: "way", id: 29, tags: { highway: "footway" }, geometry: g([[115.872, -31.95], [115.873, -31.95]]) },
    { type: "way", id: 30, tags: { highway: "unclassified", "parking:lane:left": "parallel", bridge: "no" }, geometry: g([[115.874, -31.95], [115.875, -31.95]]) },
    { type: "way", id: 31, tags: { highway: "living_street", area: "yes", surface: "unpaved" }, geometry: g([[115.876, -31.95], [115.877, -31.95], [115.877, -31.951]]) },
    { type: "way", id: 32, tags: { highway: "residential", width: "40", est_width: "5" }, geometry: g([[115.878, -31.95], [115.879, -31.95]]) },
    { type: "way", id: 33, tags: { highway: "raceway" }, geometry: g([[115.88, -31.95], [115.881, -31.95]]) },
    { type: "way", id: 34, tags: { highway: "trunk_link", est_width: "6.5" }, geometry: g([[115.882, -31.95], [115.883, -31.95]]) },
    { type: "way", id: 35, tags: { highway: "residential", lanes: "8" }, geometry: g([[115.884, -31.95], [115.885, -31.95]]) },
    { type: "way", id: 36, tags: { highway: "road", access: "no" }, geometry: g([[115.886, -31.95], [115.887, -31.95]]) },
    { type: "way", id: 37, tags: { highway: "residential" } },
    { type: "relation", id: 38, tags: { highway: "residential" } },
  ],
};
const SIGNAL_ANSWER = {
  elements: [
    { type: "node", id: 1, lat: -31.9561, lon: 115.8461, tags: { highway: "traffic_signals" } },
    { type: "node", id: 2, lat: -31.9562, lon: 115.8462, tags: { highway: "crossing", crossing: "traffic_signals" } },
    { type: "node", id: 3, lat: -31.9563, lon: 115.8463, tags: { highway: "traffic_signals", traffic_signals: "emergency" } },
    { type: "node", id: 4, lat: -31.9564, lon: 115.8464, tags: { highway: "traffic_signals", traffic_signals: "blinker" } },
    { type: "node", id: 5, lat: -31.9565, lon: 115.8465, tags: { highway: "traffic_signals", traffic_signals: "level_crossing" } },
    { type: "node", id: 6, lat: -31.9566, lon: 115.8466, tags: { highway: "traffic_signals", traffic_signals: "ramp_meter" } },
    { type: "node", id: 7, lat: -31.9561, lon: 115.8461, tags: { highway: "crossing" } },
    { type: "node", id: 8, lat: -31.9567, lon: 115.8467, tags: { highway: "crossing", "crossing:signals": "yes" } },
    { type: "node", id: 9, lat: -31.9568, lon: 115.8468, tags: { railway: "crossing" } },
    { type: "way", id: 10, tags: { highway: "traffic_signals" } },
    { type: "node", id: 11, lat: -31.95610001, lon: 115.84610004, tags: { highway: "traffic_signals" } },
  ],
};

const overpassHandler = (url: string, init?: RequestInit) => {
  const body = String(init?.body ?? "");
  if (url.includes("overpass") || url.includes("mail.ru")) return json(decodeURIComponent(body).includes("traffic_signals") ? SIGNAL_ANSWER : OVERPASS_ANSWER);
  return new Response("", { status: 404 });
};

describe("golden osm", () => {
  it("fetchOsm variants", async () => {
    const cases: [string, LngLat[], LngLat[][], { cattleGrids?: boolean; trafficSignals?: boolean }][] = [
      ["spec_route", SPEC_ROUTE, [], {}],
      ["spec_area_cattle", SPEC_ROUTE, [[[115.1, -33.6], [115.2, -33.6], [115.2, -33.7]]], { cattleGrids: true }],
      ["perth", PERTH, [], {}],
      ["perth_cattle", PERTH, [], { cattleGrids: true }],
      ["perth_signals", PERTH, [], { trafficSignals: true }],
      ["perth_area", PERTH, [AREA1], {}],
      ["perth_areas_all", PERTH, [AREA1, AREA2, TINY], { cattleGrids: true, trafficSignals: true }],
      ["long_signals", LONG, [], { trafficSignals: true }],
    ];
    const out: Record<string, unknown> = {};
    for (const [name, route, areas, want] of cases) {
      const log = fakeFetch(overpassHandler);
      const r = await osm.fetchOsm(route, areas, want);
      const probes: LngLat[] = [[115.845, -31.9575], [115.855, -31.9535], [115.8605, -31.9515], [115.9, -31.9], [115.8785, -31.95], [115.8845, -31.95]];
      out[name] = { requests: log, features: r.features, roads: r.roads, widthAt: probes.map((p) => r.widthAt?.(p) ?? null) };
    }
    save("osm_fetchOsm", out);
  });

  it("signalQuery, signalsFromElements, widthLookup", () => {
    save("osm_pure", {
      signalQuery: {
        spec: osm.signalQuery(SPEC_ROUTE),
        perthAreas: osm.signalQuery(PERTH, [AREA1, AREA2, TINY]),
        long: osm.signalQuery(LONG),
      },
      signals: osm.signalsFromElements(SIGNAL_ANSWER.elements as never),
      widthLookup: (() => {
        const f = osm.widthLookup([{ width: 6, pts: [[115.84, -31.96], [115.85, -31.96]] }, { width: 9, pts: [[115.845, -31.9601], [115.845, -31.9601]] }, { width: 4, pts: [[115.84, -31.9599], [115.85, -31.9599]] }], -31.96);
        return [[115.845, -31.96], [115.845, -31.9601], [115.8455, -31.96005], [115.845, -31.9599], [115.845, -31.9611], [115.845, -31.95978], [115.8395, -31.96]].map((p) => f(p as LngLat) ?? null);
      })(),
    });
  });

  it("joinWays", () => {
    type W = { pts: LngLat[]; cls: string; oneway?: 1 | -1; brunnel?: string; service?: string; surface?: string; name?: string };
    const P = (i: number): LngLat => [115.8 + i * 0.001, -31.9];
    const Q = (i: number): LngLat => [115.8 + i * 0.001, -31.901];
    const sets: Record<string, W[]> = {
      endToStart: [{ pts: [P(0), P(1)], cls: "minor" }, { pts: [P(1), P(2)], cls: "minor" }],
      startToStart: [{ pts: [P(1), P(0)], cls: "minor" }, { pts: [P(1), P(2)], cls: "minor" }],
      endToEnd: [{ pts: [P(0), P(1)], cls: "minor" }, { pts: [P(2), P(1)], cls: "minor" }],
      three: [{ pts: [P(0), P(1)], cls: "minor" }, { pts: [P(1), P(2)], cls: "minor" }, { pts: [P(1), Q(1)], cls: "minor" }],
      diffKinds: [
        { pts: [P(0), P(1)], cls: "minor" }, { pts: [P(1), P(2)], cls: "service" },
        { pts: [Q(0), Q(1)], cls: "minor", service: "x" }, { pts: [Q(1), Q(2)], cls: "minor" },
        { pts: [P(5), P(6)], cls: "minor", surface: "unpaved" }, { pts: [P(6), P(7)], cls: "minor" },
        { pts: [Q(5), Q(6)], cls: "minor", brunnel: "bridge" }, { pts: [Q(6), Q(7)], cls: "minor" },
      ],
      onewaySame: [{ pts: [P(0), P(1)], cls: "primary", oneway: 1 }, { pts: [P(1), P(2)], cls: "primary", oneway: 1 }],
      onewayFirstReversed: [{ pts: [P(1), P(0)], cls: "primary", oneway: -1 }, { pts: [P(1), P(2)], cls: "primary", oneway: 1 }],
      onewayFirstReversed2: [{ pts: [P(1), P(0)], cls: "primary", oneway: 1 }, { pts: [P(2), P(1)], cls: "primary", oneway: 1 }],
      onewayOpposite: [{ pts: [P(0), P(1)], cls: "primary", oneway: 1 }, { pts: [P(2), P(1)], cls: "primary", oneway: 1 }],
      onewayVsTwo: [{ pts: [P(0), P(1)], cls: "primary", oneway: 1 }, { pts: [P(1), P(2)], cls: "primary" }],
      chain: [{ pts: [P(2), P(3)], cls: "minor", name: "c" }, { pts: [P(0), P(1)], cls: "minor", name: "a" }, { pts: [P(4), P(3)], cls: "minor", name: "d" }, { pts: [P(1), P(2)], cls: "minor", name: "b" }, { pts: [Q(0), Q(1)], cls: "track" }],
      closedFirst: [{ pts: [P(0), P(1), Q(1), P(0)], cls: "minor" }, { pts: [P(0), Q(0)], cls: "minor" }],
      loopOfTwo: [{ pts: [P(0), P(1), Q(1)], cls: "minor" }, { pts: [Q(1), Q(0), P(0)], cls: "minor" }],
      ring: [{ pts: [P(0), P(1)], cls: "minor" }, { pts: [P(1), Q(1), Q(2), P(1)], cls: "minor" }],
      extraFields: [{ pts: [P(0), P(1)], cls: "minor", name: "x", service: undefined }, { pts: [P(1), P(2)], cls: "minor", name: "y" }],
    };
    const out: Record<string, unknown> = {};
    for (const [k, ways] of Object.entries(sets)) {
      const input = JSON.stringify(ways);
      out[k] = { input: ways, output: osm.joinWays(ways), mutated: JSON.stringify(ways) !== input };
    }
    // Fixed (osm.md bug 4): a closed way is never appended to a street; the old code did.
    save("osm_joinWays", out, (g) => {
      g.ring.output = g.ring.input;
    });
  });

  it("route, places, reverse, ways, pier", async () => {
    const out: Record<string, unknown> = {};
    // OSRM: an out-and-back spur with a U-turn at its end, a roundabout on the spur and one on the line.
    const line: LngLat[] = [];
    for (let i = 0; i <= 40; i++) line.push([115.84 + i * 0.0001, -31.96]);
    const spur: LngLat[] = [];
    for (let i = 1; i <= 15; i++) spur.push([115.844, -31.96 + i * 0.0001]);
    const coords = [...line.slice(0, 21), ...spur, ...spur.slice(0, -1).reverse(), [115.844, -31.96] as LngLat, ...line.slice(21)];
    const osrm = {
      code: "Ok",
      routes: [{
        distance: 1234.5,
        geometry: { coordinates: coords },
        legs: [
          { steps: [
            { maneuver: { type: "depart", location: coords[0] }, geometry: { coordinates: [coords[0], coords[1]] } },
            { maneuver: { type: "roundabout", location: [115.8415, -31.96] }, geometry: { coordinates: [[115.8414, -31.96], [115.8416, -31.96]] } },
            { maneuver: { type: "rotary", location: [115.844, -31.9588] }, geometry: { coordinates: [[115.844, -31.9589], [115.844, -31.9587]] } },
          ] },
          { steps: [
            { maneuver: { type: "continue", modifier: "uturn", location: [115.844, -31.9585] }, geometry: { coordinates: [] } },
            { maneuver: { type: "roundabout turn", location: [115.8435, -31.96] }, geometry: { coordinates: [] } },
            { maneuver: { type: "exit roundabout", location: [115.843, -31.96] }, geometry: { coordinates: [] } },
            { maneuver: { type: "turn", modifier: "uturn", location: [115.9, -31.9] }, geometry: { coordinates: [] } },
          ] },
        ],
      }],
    };
    let log = fakeFetch(() => json(osrm));
    out.route = { requests: log, result: await osm.route([[115.84, -31.96], [115.844, -31.9585], [115.8445678912, -31.9612345678]]) };
    log = fakeFetch(() => json({ ...osrm, routes: [{ ...osrm.routes[0], geometry: { coordinates: line }, legs: [{ steps: osrm.routes[0].legs[0].steps }] }] }));
    out.routeNoSpur = { requests: log, result: await osm.route([[115.84, -31.96], [115.844, -31.96]]) };
    log = fakeFetch(() => json({ code: "NoRoute", message: "Impossible route between points" }, 400));
    out.routeError = { requests: log, error: await osm.route([[1.123456789, 2], [3, 4]]).then(() => null, (e: Error) => e.message) };
    // OSRM now retries a 502 (waits 1, 3, 7 s) before giving up with the same message.
    log = fakeFetch(() => new Response("oops", { status: 502 }));
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const failing = osm.route([[1, 2], [3, 4]]).then(() => null, (e: Error) => e.message);
    await vi.runAllTimersAsync();
    out.routeError502 = { error: await failing };
    vi.useRealTimers();
    expect(log).toHaveLength(4);

    const photon = { features: [
      { geometry: { coordinates: [115.83, -31.96] }, properties: { name: "Kings Park", street: "Fraser Ave", city: "Perth", state: "Western Australia", country: "Australia", extent: [115.82, -31.95, 115.84, -31.97] } },
      { geometry: { coordinates: [115.86, -31.95] }, properties: { street: "Hay St", city: "Perth", country: "Australia" } },
      { geometry: { coordinates: [115.87, -31.94] }, properties: { city: "Perth" } },
      { geometry: { coordinates: [115.88, -31.93] }, properties: {} },
    ] };
    log = fakeFetch(() => json(photon));
    out.search = { requests: log, result: await osm.searchPlaces("Kings Park", [115.851234, -31.955678]) };
    log = fakeFetch(() => json(photon));
    out.searchNoNear = { requests: log, result: await osm.searchPlaces("a b&c") };
    log = fakeFetch(() => json({ address: { road: "Hay St", suburb: "Perth", county: "X", country: "Australia" } }));
    out.reverse = { requests: log, result: await osm.reverseGeocode([115.8512345678, -31.95]) };
    log = fakeFetch(() => json({ address: { road: "R", village: "V", city: "C", country: "Au" } }));
    out.reverse2 = { requests: log, result: await osm.reverseGeocode([115.1, -31.123456]) };

    const waysAnswer = { elements: [
      { type: "way", id: 456, tags: {}, geometry: g([[115.85, -31.95], [115.851, -31.95]]) },
      { type: "way", id: 123, tags: { highway: "raceway" }, geometry: g([[115.849, -31.95], [115.85, -31.95]]) },
      { type: "node", id: 1, lat: 1, lon: 2 },
    ] };
    log = fakeFetch(() => json(waysAnswer));
    out.wayGeoms = { requests: log, result: await osm.fetchWayGeoms([123, 456]) };
    log = fakeFetch(() => json(waysAnswer));
    out.wayGeomsMissing = { error: await osm.fetchWayGeoms([123, 456, 789]).then(() => null, (e: Error) => e.message) };
    out.wayGeomsMissing1 = { error: await osm.fetchWayGeoms([123, 789]).then(() => null, (e: Error) => e.message) };
    out.wayGeomsBad = { error: await osm.fetchWayGeoms([123, 1.5, -2]).then(() => null, (e: Error) => e.message), errorEmpty: await osm.fetchWayGeoms([]).then(() => null, (e: Error) => e.message) };
    log = fakeFetch(() => json(waysAnswer));
    out.routeWays = { requests: log, result: await osm.routeWays([123, 456], [[115.8492, -31.95], [115.8508, -31.95]]) };

    const pier = { elements: [
      { type: "way", id: 1, tags: { railway: "platform", shelter: "yes" }, geometry: g([[115.86, -31.95], [115.861, -31.95]]) },
      { type: "way", id: 2, tags: { public_transport: "platform" }, geometry: g([[115.86, -31.951], [115.861, -31.951]]) },
      { type: "way", id: 3, tags: { railway: "narrow_gauge" }, geometry: g([[115.86, -31.952], [115.861, -31.952]]) },
      { type: "way", id: 4, tags: { building: "yes", name: "Shed" }, geometry: g([[115.86, -31.953], [115.861, -31.953], [115.861, -31.954]]) },
      { type: "way", id: 5, tags: { building: "yes" }, geometry: g([[115.86, -31.955], [115.861, -31.955], [115.861, -31.956]]) },
      { type: "way", id: 6, tags: { building: "yes" }, geometry: g([[115.86, -31.957], [115.861, -31.957]]) },
      { type: "way", id: 7, tags: { railway: "rail" }, geometry: g([[115.86, -31.958]]) },
    ] };
    log = fakeFetch(() => json(pier));
    out.pier = { requests: log, result: await osm.fetchPierFeatures([115.8612345, -31.96, 115.87, -31.95]) };
    // Raceway detection (retest-3 visuals): ways now carry their highway tag.
    save("osm_misc", strip(out), (g) => {
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") {
          const o = v as Record<string, unknown>;
          if (o.id === 123 && "pts" in o) o.highway = "raceway";
          Object.values(o).forEach(walk);
        }
      };
      walk(g);
    });
  });
});

describe("golden tiles", () => {
  it("pure", () => {
    const urls: Record<string, string> = {};
    for (const s of ["esri", "qld", "nsw", "wa"] as const) for (const [z, x, y] of [[0, 0, 0], [12, 3412, 2412], [19, 432123, 310456], [20, 864246, 620913]]) urls[`${s}/${z}/${x}/${y}`] = tiles.tileUrl(s, z, x, y);
    save("tiles_pure", {
      IMAGERY: tiles.IMAGERY,
      DEM_CREDIT: tiles.DEM_CREDIT,
      DEM_LABEL: tiles.DEM_LABEL,
      tileBbox: [[0, 0, 0], [1, 1, 0], [5, 3, 17], [20, 864246, 620913]].map(([z, x, y]) => tiles.tileBbox(z, x, y)),
      tileUrl: urls,
      chains: Object.fromEntries(([["perth", [115.86, -31.95]], ["capes", [115.1, -33.6]], ["sydney", [151.2, -33.87]], ["brisbane", [153.03, -27.47]], ["border", [153.3, -28.5]], ["wellington", [174.78, -41.29]], ["darwin", [130.84, -12.46]], ["melbourne", [144.96, -37.81]]] as [string, LngLat][]).map(([k, p]) => [k, { auto: tiles.imageryChain(p), esri: tiles.imageryChain(p, "esri"), nsw: tiles.imageryChain(p, "nsw"), wa: tiles.imageryChain(p, "wa") }])),
    });
  });

  it("loadDem", async () => {
    fakeCanvas();
    const T = solidTile(...terrariumRgb(10));
    const W = solidTile(...terrariumRgb(3));
    for (let i = 0; i < 2000 * 4; i += 4) W[i + 3] = 0; // a transparent band at the top of each WA tile
    const out: Record<string, unknown> = {};
    const cases: [string, LngLat, number, number][] = [
      ["wellington_z14", [174.78, -41.29], 14, 600],
      ["perth_z14", [115.86, -31.95], 14, 600],
      ["perth_z12_big", [115.86, -31.95], 12, 30000],
      ["perth_z15_long", [115.86, -31.95], 15, 6000],
      ["capes_z14", [115.1, -33.6], 14, 400],
      ["capes_z12", [115.1, -33.6], 12, 2000],
      ["capes_z16", [115.1, -33.6], 16, 300],
      ["sydney_z14", [151.2, -33.87], 14, 500],
      ["brisbane_z14", [153.03, -27.47], 14, 500],
      ["melbourne_z14", [144.96, -37.81], 14, 500],
      ["sydney_z13", [151.2, -33.87], 13, 3000],
    ];
    for (const [name, origin, zoom, half] of cases) {
      const log = fakeFetch((url) => {
        if (url.includes("elevation-tiles-prod")) return pngResponse(T);
        if (url.includes("/dem/wa/")) return /\/(\d+)\/(\d+)\/(\d+)\.png/.exec(url)![3].endsWith("1") ? new Response("<html>", { headers: { "content-type": "text/html" } }) : pngResponse(W);
        return new Response("", { status: 404 });
      });
      const proj = new LocalProjection(origin);
      const used = new Set<tiles.DemSource>();
      const progress: number[][] = [];
      const h = await tiles.loadDem(proj, { minX: -half, minY: -half * 0.6, maxX: half, maxY: half * 0.6 }, zoom, (d, t) => progress.push([d, t]), used);
      const samples = [[0, 0], [half * 0.5, half * 0.3], [-half * 0.9, half * 0.55], [half * 0.9, -half * 0.55]].map(([x, y]) => Math.round(h(x, y) * 1e4) / 1e4);
      out[name] = { requests: log, used: [...used], samples, progressCount: progress.length, progressLast: progress[progress.length - 1] };
    }
    save("tiles_loadDem", out);
  });

  it("loadChunkImagery and colourBalance", async () => {
    const { draws, canvases } = fakeCanvas();
    const out: Record<string, unknown> = {};
    const run = async (name: string, origin: LngLat, chain: tiles.ImagerySource[], zoom: number, size: number, missing: (url: string) => boolean) => {
      draws.length = 0;
      const log = fakeFetch((url) => (missing(url) ? new Response("", { status: 404 }) : taggedImage(url)));
      const previews = new Map<string, OffscreenCanvas>();
      const used = new Set<tiles.ImagerySource>();
      const r = await tiles.loadChunkImagery(new LocalProjection(origin), { key: "k1", minX: -60, minY: -60, maxX: 60, maxY: 60 }, zoom, size, previews, chain, used);
      out[name] = {
        requests: log,
        used: [...used],
        draws: draws.map((d) => ({ tag: d.tag ?? null, op: d.op, args: d.args.map((a) => Math.round(a * 1e6) / 1e6) })),
        result: r ? { ext: r.ext, bytes: r.data.length, head: [...r.data.slice(0, 4)], rgbaLen: r.rgba.length } : null,
        preview: previews.has("k1"),
      };
    };
    await run("perth_wa_full", [115.86, -31.95], ["wa", "esri"], 19, 256, () => false);
    await run("perth_wa_gaps", [115.861, -31.951], ["wa", "esri"], 19, 512, (u) => u.includes("slip.wa.gov.au") && /bbox=1289/.test(u));
    await run("perth_wa_gaps2", [115.862, -31.952], ["wa", "esri"], 20, 256, (u) => u.includes("slip.wa.gov.au") && u.length % 2 === 0);
    await run("nowhere", [174.78, -41.29], ["esri"], 18, 256, () => true);
    await run("sydney_nsw", [151.2, -33.87], ["nsw", "esri"], 21, 256, () => false);
    await run("esri_z21", [174.78, -41.29], ["esri"], 21, 256, () => false);
    void canvases;
    save("tiles_chunkImagery", out);
  });
});

describe("golden vectorTiles", () => {
  const TEMPLATE = "https://tiles.openfreemap.org/planet/20261001_001001_pt/{z}/{x}/{y}.pbf";
  const tileFor = (z: number, x: number, y: number): Uint8Array => {
    const s = (x * 7 + y * 3) % 5;
    if (z === 14) return encodeMvt([
      { name: "building", features: [
        { type: 3, props: { render_height: 6 + s, colour: "#aabbcc" }, geom: [[{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }], [{ x: 150, y: 150 }, { x: 150, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 150 }]] },
        { type: 3, props: { render_height: 3 }, geom: [[{ x: 4000, y: 1000 }, { x: 4300, y: 1000 }, { x: 4300, y: 1200 }, { x: 4000, y: 1200 }], [{ x: 500 + s, y: 500 }, { x: 600, y: 500 }, { x: 600, y: 600 }]] },
      ] },
      { name: "transportation", features: [
        { type: 2, props: { class: "minor", surface: "paved", oneway: 1, service: "x", brunnel: "bridge" }, geom: [[{ x: -50, y: 2000 }, { x: 4200, y: 2000 + s }], [{ x: 10, y: 10 }, { x: 20, y: 20 }]] },
        { type: 2, props: { class: "path", subclass: "cycleway", bicycle: "designated", oneway: 0 }, geom: [[{ x: 0, y: 0 }, { x: 4096, y: 4096 }]] },
        { type: 2, props: { oneway: -1 }, geom: [[{ x: 5, y: 5 }, { x: 6, y: 6 }]] },
        { type: 3, props: { class: "pier" }, geom: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]] },
      ] },
      { name: "waterway", features: [{ type: 2, props: { class: "stream", brunnel: "culvert" }, geom: [[{ x: 1, y: 2 }, { x: 3, y: 4 }]] }, { type: 2, props: {}, geom: [[{ x: 5, y: 2 }, { x: 3, y: 4 }]] }] },
      { name: "transportation_name", features: [{ type: 2, props: { name: "Hay St", class: "minor" }, geom: [[{ x: 1, y: 2 }, { x: 300, y: 4 }]] }, { type: 2, props: { class: "minor" }, geom: [[{ x: 1, y: 2 }, { x: 300, y: 4 }]] }] },
      { name: "poi", features: [
        { type: 1, props: { class: "cafe", subclass: "cafe", name: "Brew " + s, rank: 3 }, geom: [[{ x: 1000, y: 1000 }]] },
        { type: 1, props: { class: "shop" }, geom: [[{ x: 4096, y: 100 }]] },
        { type: 1, props: { class: "shop", rank: "x" }, geom: [[{ x: -1, y: 100 }]] },
        { type: 1, props: { class: "park", subclass: "park" }, geom: [[{ x: 0, y: 4095 }]] },
      ] },
      { name: "landuse", features: [
        { type: 3, props: { class: "retail" }, geom: [[{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }, { x: 0, y: 900 }]] },
        { type: 3, props: { class: "residential" }, geom: [[{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }]] },
        { type: 3, props: { class: "commercial" }, geom: [[{ x: -100, y: -100 }, { x: 5000, y: -100 }, { x: 5000, y: 5000 }]] },
      ] },
    ]);
    return encodeMvt([
      { name: "water", features: [
        { type: 3, props: { class: "ocean" }, geom: [[{ x: -64, y: -64 }, { x: 2000 + s * 10, y: -64 }, { x: 1000, y: 4160 }, { x: -64, y: 4160 }], [{ x: 200, y: 200 }, { x: 200, y: 400 }, { x: 400, y: 400 }, { x: 400, y: 200 }]] },
        { type: 3, props: { class: "lake" }, geom: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]] },
      ] },
      { name: "transportation", features: [{ type: 3, props: { class: "pier" }, geom: [[{ x: 3000, y: 3000 }, { x: 3100, y: 3000 }, { x: 3100, y: 3400 }, { x: 3000, y: 3400 }]] }, { type: 2, props: { class: "pier" }, geom: [[{ x: 1, y: 1 }, { x: 9, y: 9 }]] }] },
      { name: "landcover", features: [
        { type: 3, props: { class: "sand", subclass: "beach" }, geom: [[{ x: 2000, y: 0 }, { x: 2200, y: 0 }, { x: 2200, y: 4096 }, { x: 2000, y: 4096 }]] },
        { type: 3, props: { class: "sand" }, geom: [[{ x: 2300, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 100 }]] },
        { type: 3, props: { class: "sand", subclass: "dune" }, geom: [[{ x: 2500, y: 0 }, { x: 2600, y: 0 }, { x: 2600, y: 100 }]] },
        { type: 3, props: { class: "wood", subclass: "forest" }, geom: [[{ x: 3000, y: 0 }, { x: 3600, y: 0 }, { x: 3600, y: 600 }], [{ x: 3100, y: 50 }, { x: 3110, y: 60 }, { x: 3120, y: 50 }]] },
        { type: 3, props: { class: "ice" }, geom: [[{ x: 3000, y: 0 }, { x: 3600, y: 0 }, { x: 3600, y: 600 }]] },
        { type: 3, props: { class: "farmland" }, geom: [[{ x: 4200, y: 4200 }, { x: 4300, y: 4200 }, { x: 4300, y: 4300 }]] },
      ] },
    ]);
  };
  const handler = (url: string) => {
    if (url === "https://tiles.openfreemap.org/planet") return json({ tilejson: "3.0.0", tiles: [TEMPLATE] });
    const m = /\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url);
    if (!m) return new Response("", { status: 404 });
    const [z, x, y] = [+m[1], +m[2], +m[3]];
    if ((x + y) % 4 === 3) return new Response("", { status: 404 });
    return new Response(tileFor(z, x, y).slice().buffer as ArrayBuffer, { status: 200 });
  };

  it("fetchTileFeatures and fetchCoast", async () => {
    const out: Record<string, unknown> = {};
    let log = fakeFetch(handler);
    out.features = { requests: log, result: await vt.fetchTileFeatures([115.83, -31.965, 115.87, -31.945]) };
    log = fakeFetch(handler);
    out.featuresOne = { requests: log, result: await vt.fetchTileFeatures([115.851, -31.9551, 115.852, -31.955]) };
    log = fakeFetch(handler);
    out.tooLarge = { error: await vt.fetchTileFeatures([115.0, -32.5, 116.5, -31.0]).then(() => null, (e: Error) => e.message), requests: log };
    log = fakeFetch(handler);
    out.coast = { requests: log, result: await vt.fetchCoast([115.7, -32.0, 115.86, -31.9]) };
    log = fakeFetch(handler);
    out.coastTooLarge = { error: await vt.fetchCoast([114.0, -33.0, 117.0, -30.0]).then(() => null, (e: Error) => e.message), requests: log };
    // Inland water now comes with the coast (shoreClear.ts); checked here, left out of the golden.
    const coast = (out.coast as { result: { water?: unknown[] } }).result;
    expect(Array.isArray(coast.water)).toBe(true);
    delete coast.water;
    save("vectorTiles_fetch", out);
  });

  it("pure", () => {
    const roads = [
      { pts: [[115.84, -31.96], [115.85, -31.96]] as LngLat[], cls: "minor" },
      { pts: [[115.84, -31.95995], [115.85, -31.95995]] as LngLat[], cls: "path" },
      { pts: [[115.84, -31.9601], [115.85, -31.9601]] as LngLat[], cls: "rail" },
      { pts: [[115.84, -31.9602], [115.85, -31.9602]] as LngLat[], cls: "service" },
      { pts: [[115.84, -31.9603], [115.85, -31.9603]] as LngLat[], cls: "motorway" },
      { pts: [[115.84, -31.9604], [115.84, -31.9604]] as LngLat[], cls: "raceway" },
      { pts: [[115.84, -31.9605], [115.85, -31.9605]] as LngLat[], cls: "track" },
      { pts: [[115.84, -31.9606], [115.85, -31.9606]] as LngLat[], cls: "trunk" },
      { pts: [[115.84, -31.9607], [115.85, -31.9607]] as LngLat[], cls: "primary" },
      { pts: [[115.84, -31.9608], [115.85, -31.9608]] as LngLat[], cls: "secondary" },
      { pts: [[115.84, -31.9609], [115.85, -31.9609]] as LngLat[], cls: "tertiary" },
      { pts: [[115.84, -31.9609], [115.85, -31.9609]] as LngLat[], cls: "ferry" },
    ];
    const look = vt.roadClassLookup(roads, -31.96);
    const sq = [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 100 }, { x: 10, y: 100 }];
    save("vectorTiles_pure", {
      classWidths: vt.classWidths(roads),
      lookup: [[115.845, -31.96], [115.845, -31.95995], [115.845, -31.9611], [115.845, -31.9621], [115.84, -31.9604], [115.8, -31.96], [115.845, -31.95985]].map((p) => look(p as LngLat) ?? null),
      clip: {
        inside: vt.clipToTile(sq, 4096),
        right: vt.clipToTile([{ x: 4000, y: 10 }, { x: 4200, y: 10 }, { x: 4200, y: 110 }, { x: 4000, y: 110 }], 4096),
        outside: vt.clipToTile([{ x: 5000, y: 10 }, { x: 5200, y: 10 }, { x: 5200, y: 110 }], 4096),
        cover: vt.clipToTile([{ x: -10000, y: -10000 }, { x: 20000, y: -10000 }, { x: -10000, y: 20000 }], 4096),
        corner: vt.clipToTile([{ x: -50, y: -50 }, { x: 50, y: -50 }, { x: 50, y: 50 }, { x: -50, y: 50 }], 4096),
        diag: vt.clipToTile([{ x: -100, y: 2000 }, { x: 2000, y: -100 }, { x: 4200, y: 2000 }, { x: 2000, y: 4200 }], 4096),
      },
      area: [vt.signedArea(sq), vt.signedArea([...sq].reverse()), vt.signedArea([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 4 }])],
    });
  });
});
