// Stubbed services and a recorder for runBuild: what the pipeline asks each service for, what it
// hands buildTrack, and what it returns. The test file wires these in with vi.mock.
import { vi } from "vitest";
import type { LngLat } from "../../src/core/geo";

export const events: string[] = [];
export const calls: Record<string, unknown[][]> = {};
const rec = (name: string, args: unknown[]) => { (calls[name] ??= []).push(args); events.push(name); };

/** What each stub answers; a case sets these before it runs. */
export const answers: {
  osm: unknown; tiles: unknown; coast: unknown; seen: unknown; farmland: unknown; pier: unknown;
  delays: Record<string, number>;
  imageryUsed: string[]; demUsed: string[];
} = { osm: null, tiles: null, coast: null, seen: [], farmland: [], pier: null, delays: {}, imageryUsed: [], demUsed: [] };

const settle = async <T>(name: string, v: unknown): Promise<T> => {
  const d = answers.delays[name] ?? 0;
  for (let i = 0; i < d; i++) await Promise.resolve();
  if (v instanceof Error) throw v;
  return v as T;
};

let captured: { route: LngLat[]; partial: unknown; sources: Record<string, unknown>; meta: unknown; probe: Record<string, unknown> } | null = null;

/** The last buildTrack call (a function, so TypeScript doesn't narrow it away). */
export const capturedCall = () => captured;

/** What buildTrack would do with the sources: sample the width and class lookups, load DEM and imagery, trace, read the credits. */
async function probe(s: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const probes: LngLat[] = [[115.85, -31.96], [115.85, 31.96], [-1, 1]];
  if (typeof s.widthAt === "function") out.widthAt = probes.map((p) => (s.widthAt as (p: LngLat) => number | undefined)(p) ?? null);
  if (typeof s.roadClassAt === "function") out.roadClassAt = probes.map((p) => (s.roadClassAt as (p: LngLat) => string | undefined)(p) ?? null);
  const credit = (k: string) => (typeof s[k] === "function" ? (s[k] as () => string)() : s[k] ?? null);
  out.creditsBefore = { imagery: credit("imageryCredit"), elevation: credit("elevationCredit") };
  const proj = { origin: [115.84, -31.96] };
  if (typeof s.dem === "function") await (s.dem as (...a: unknown[]) => Promise<unknown>)(proj, { minX: 0, minY: 0, maxX: 1, maxY: 1 }, 14);
  if (typeof s.imagery === "function") await (s.imagery as (...a: unknown[]) => Promise<unknown>)(proj, { key: "c1" }, 18, 1024);
  if (typeof s.raster === "function") {
    await (s.raster as (...a: unknown[]) => Promise<unknown>)(proj, [[0, 0], [1, 1]], 30, 19);
    await (s.raster as (...a: unknown[]) => Promise<unknown>)(proj, [[0, 0], [1, 1]], 30);
  }
  out.creditsAfter = { imagery: credit("imageryCredit"), elevation: credit("elevationCredit") };
  return out;
}

export const pipeMocks = {
  osm: {
    fetchOsm: vi.fn((...a: unknown[]) => { rec("fetchOsm", a); return settle("osm", structuredClone(answers.osm)).then((o) => withWidth(o)); }),
    fetchPierFeatures: vi.fn((...a: unknown[]) => { rec("fetchPierFeatures", a); return settle("pier", answers.pier); }),
    widthLookup: vi.fn((ways: { width: number; pts: LngLat[] }[], lat: number) => { rec("widthLookup", [ways, lat]); return (p: LngLat) => (p[0] > 0 ? 4.25 : undefined); }),
  },
  vectorTiles: {
    fetchTileFeatures: vi.fn((...a: unknown[]) => { rec("fetchTileFeatures", a); return settle("tiles", structuredClone(answers.tiles)); }),
    fetchCoast: vi.fn((...a: unknown[]) => { rec("fetchCoast", a); return settle("coast", structuredClone(answers.coast)); }),
    classWidths: vi.fn((roads: { cls: string; pts: LngLat[] }[]) => { rec("classWidths", [roads.length]); return roads.filter((r) => r.cls !== "path").map((r) => ({ width: 5, pts: r.pts })); }),
    roadClassLookup: vi.fn((roads: unknown[], lat: number) => { rec("roadClassLookup", [roads.length, lat]); return () => "minor"; }),
  },
  tiles: {
    imageryChain: vi.fn((...a: unknown[]) => { rec("imageryChain", a); return ["wa", "esri"]; }),
    loadDem: vi.fn(async (...a: unknown[]) => {
      rec("loadDem", a.slice(0, 4).map((x) => (x && typeof x === "object" && "origin" in x ? "proj" : x)));
      const used = a[4] as Set<string>;
      for (const k of answers.demUsed) used.add(k);
      return () => 0;
    }),
    loadChunkImagery: vi.fn(async (...a: unknown[]) => {
      rec("loadChunkImagery", [a[1], a[2], a[3], a[5], (a[4] as Map<string, unknown>).size]);
      const used = a[6] as Set<string>;
      for (const k of answers.imageryUsed) used.add(k);
      (a[4] as Map<string, unknown>).set("chunkA", { fake: true });
      return null;
    }),
    IMAGERY: { esri: { credit: "C-esri" }, qld: { credit: "C-qld" }, nsw: { credit: "C-nsw" }, wa: { credit: "C-wa" } },
    DEM_CREDIT: { qld: "E-qld", nsw: "E-nsw", vic: "E-vic", wa: "E-wa" },
  },
  mapillary: { fetchSeen: vi.fn((...a: unknown[]) => { rec("fetchSeen", a); return settle("seen", answers.seen); }) },
  landcover: { fetchFarmland: vi.fn((...a: unknown[]) => { rec("fetchFarmland", a); return settle("farmland", answers.farmland); }) },
  raster: { loadRouteRaster: vi.fn(async (...a: unknown[]) => { rec("loadRouteRaster", [a[1], a[2], a[3], a[4]]); (a[5] as (d: number, t: number) => void)(1, 3); return null; }) },
  art: { renderArt: vi.fn() },
  signs: { drawSigns: vi.fn() },
  buildTrack: vi.fn(async (route: LngLat[], partial: unknown, sources: Record<string, unknown>, meta: unknown, progress: unknown) => {
    events.push("buildTrack");
    captured = { route, partial, sources, meta, probe: await probe(sources) };
    void progress;
    return { slug: "fake", files: {} };
  }),
};

function withWidth(o: unknown): unknown {
  const v = o as { widthAt?: unknown } | null;
  if (v && v.widthAt === "fn") v.widthAt = (p: LngLat) => (p[1] < 0 ? 7.5 : undefined);
  return v;
}

export interface PipeCase {
  name: string;
  job: Record<string, unknown>;
  osm: unknown; tiles: unknown; coast: unknown; seen?: unknown; farmland?: unknown; pier?: unknown;
  delays?: Record<string, number>;
  imageryUsed?: string[]; demUsed?: string[];
}

const L = (i: number, j = 0): LngLat => [115.84 + i * 0.001, -31.96 + j * 0.001];
const ROUTE: LngLat[] = [L(0), L(1), L(2), L(3), L(4, 1)];
const RING: LngLat[] = [L(-1, -1), L(5, -1), L(5, 3), L(-1, 3)];
const RING2: LngLat[] = [L(20, 20), L(22, 20), L(21, 22)];

const osmAnswer = () => ({
  widthAt: "fn",
  features: { buildings: [], guardRails: [], roundaboutRings: [], poles: [], lamps: [], powerLines: [], barriers: [], groynes: [], cattleGrids: [], unsealed: [[L(9), L(10)]] },
  roads: [
    { pts: [L(0, 1), L(1, 1), L(2, 1)], cls: "minor" },
    { pts: [L(10, 10), L(11, 10)], cls: "minor" },
    { pts: [L(0, 2), L(1, 2)], cls: "secondary", brunnel: "bridge" },
    { pts: [L(0, 2), L(1, 2)], cls: "minorx", brunnel: "bridge" },
    { pts: [L(0, 2), L(1, 2)], cls: "path", brunnel: "bridge" },
    { pts: [L(1, 2), L(2, 2)], cls: "service", brunnel: "tunnel" },
  ],
});
const tilesAnswer = () => ({
  buildings: [{ ring: [L(0), L(1), L(1, 1)], tags: { building: "yes" } }],
  roads: [
    { pts: [L(0, 1), L(1, 1.0001), L(2, 1)], cls: "minor" },
    { pts: [L(30, 1), L(31, 1), L(32, 1)], cls: "minor" },
    { pts: [L(0, 1), L(1, 1)], cls: "tertiary" },
    { pts: [L(0, 1), L(1, 1)], cls: "path", subclass: "footway" },
    { pts: [L(0, 1), L(1, 1)], cls: "path", subclass: "cycleway", brunnel: "bridge" },
    { pts: [L(0, 1), L(1, 1)], cls: "path", subclass: "steps" },
    { pts: [L(0, 1), L(1, 1)], cls: "path", bicycle: "yes" },
    { pts: [L(0, 3), L(1, 3)], cls: "track", surface: "unpaved" },
    { pts: [L(0, 3), L(1, 3)], cls: "path", surface: "unpaved", subclass: "path" },
    { pts: [L(0, 3), L(1, 3)], cls: "trunk_construction", brunnel: "bridge" },
    { pts: [L(0, 3), L(1, 3)], cls: "motorway", brunnel: "bridge" },
    { pts: [L(0, 3), L(1, 3)], cls: "minor", brunnel: "bridge", surface: "gravel" },
  ],
  names: [{ pts: [L(0), L(1)], name: "Hay St", cls: "minor" }],
  pois: [{ at: L(1), cls: "cafe", subclass: "cafe", name: "Brew" }],
  waterways: [{ pts: [L(0), L(0, 1)], cls: "stream" }],
  landuse: [{ ring: [L(0), L(1), L(1, 1)], cls: "retail" }],
});
const coastAnswer = () => ({
  ocean: [{ rings: [[L(-10), L(-9), L(-9, 1)]], edge: [[true, true, false]] }],
  piers: [{ rings: [[L(-8), L(-7, 0.1), L(-7, 0.3)], [L(-8, 0.1)]], edge: [] }, { rings: [[L(-6), L(-6, 0.2)]], edge: [] }],
  beaches: [],
  landcover: [{ cls: "wood", rings: [[L(0), L(1), L(1, 1)]] }],
});
const pierAnswer = { railways: [[L(-8), L(-7)]], platforms: [], buildings: [] };

const baseJob = (opts: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  coords: ROUTE, roundabouts: [{ location: L(2), arc: [L(2), L(2, 0.1)] }], opts, token: "", imagerySource: "auto",
  placeMeta: { country: "Australia", city: "Perth" }, ...extra,
});

export const PIPE_CASES: PipeCase[] = [
  { name: "defaults", job: baseJob({ imageryZoom: 18 }), osm: osmAnswer(), tiles: tilesAnswer(), coast: coastAnswer(), pier: pierAnswer, imageryUsed: ["wa"], demUsed: ["wa"] },
  {
    name: "area_everything",
    job: baseJob({ imageryZoom: 19, area: [RING, RING2, [L(0), L(1)]], armco: true, farmland: true, farmRoadsides: true, trafficLights: false, corridor: 120, buildingRadius: 400, horizon: 3000 }, { token: "tok", imagerySource: "nsw", houseLooks: [{ at: L(1), facade: "wb_blue" }], landmarks: [{ name: "Shed", at: L(2) }] }),
    osm: osmAnswer(), tiles: tilesAnswer(), coast: coastAnswer(), pier: pierAnswer, seen: [{ at: L(1), value: "sign" }], farmland: [{ kind: "vineyard", ring: [L(0), L(1), L(1, 1)] }],
    imageryUsed: ["esri", "wa"], demUsed: ["wa", "nsw"],
  },
  { name: "single_area_ring", job: baseJob({ imageryZoom: 18, area: RING, trafficLights: true }), osm: osmAnswer(), tiles: tilesAnswer(), coast: coastAnswer(), pier: pierAnswer },
  { name: "width_override_sea_off", job: baseJob({ imageryZoom: 0, widthOverride: 3, sea: false, armco: true }), osm: osmAnswer(), tiles: tilesAnswer(), coast: coastAnswer(), pier: pierAnswer },
  {
    name: "everything_fails",
    job: baseJob({ imageryZoom: 18, farmland: true }, { token: "tok" }),
    osm: { features: { buildings: [], guardRails: [], roundaboutRings: [], poles: [], lamps: [], powerLines: [], barriers: [], groynes: [], cattleGrids: [], unsealed: [] } },
    tiles: new Error("boom tiles"), coast: new Error("boom coast"), seen: new Error("Mapillary says no"), farmland: new Error("boom farm"),
  },
  { name: "overpass_down_tiles_up", job: baseJob({ imageryZoom: 18 }), osm: { features: { buildings: [], guardRails: [], unsealed: [] } }, tiles: tilesAnswer(), coast: { ocean: [], piers: [], beaches: [], landcover: [] } },
  { name: "overpass_down_tiles_no_roads", job: baseJob({ imageryZoom: 18 }), osm: { features: { buildings: [], guardRails: [], unsealed: [] } }, tiles: { ...tilesAnswer(), roads: [{ pts: [L(0), L(1)], cls: "path" }] }, coast: { ocean: [], piers: [], beaches: [], landcover: [] } },
  { name: "no_imagery_zoom_key", job: baseJob({}), osm: osmAnswer(), tiles: tilesAnswer(), coast: coastAnswer(), pier: pierAnswer },
  { name: "too_large", job: baseJob({ imageryZoom: 18 }), osm: osmAnswer(), tiles: new Error("Area too large for building tiles"), coast: new Error("Area too large for coast tiles") },
];

const ser = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null, (_k, x) => (typeof x === "function" ? "[fn]" : x instanceof Map ? { map: [...x.keys()] } : x instanceof Set ? [...x] : x)));

export async function runCase(
  runBuild: (job: never, report: (s: string, f?: number) => Promise<void>, trace: (t: string) => void) => Promise<Record<string, unknown>>,
  c: PipeCase,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  events.length = 0;
  for (const k of Object.keys(calls)) delete calls[k];
  captured = null;
  Object.assign(answers, { osm: c.osm, tiles: c.tiles, coast: c.coast, seen: c.seen ?? [], farmland: c.farmland ?? [], pier: c.pier ?? null, delays: c.delays ?? {}, imageryUsed: c.imageryUsed ?? [], demUsed: c.demUsed ?? [] });
  const traces: string[] = [];
  const reports: string[] = [];
  let outcome: Record<string, unknown> | null = null;
  let error: string | null = null;
  try {
    outcome = await runBuild(structuredClone(c.job) as never, async (s) => { reports.push(s); events.push("report:" + s); }, (t) => traces.push(t));
  } catch (e) {
    error = (e as Error).message;
  }
  const cap = capturedCall();
  const s = cap?.sources ?? {};
  const sourceSummary: Record<string, unknown> = { keys: Object.keys(s).sort() };
  for (const [k, v] of Object.entries(s)) {
    if (typeof v !== "function") sourceSummary[k] = ser(v);
  }
  return {
    error,
    events: [...events],
    reports,
    traces,
    calls: ser(calls),
    buildTrack: cap ? { route: cap.route, partial: ser(cap.partial), meta: cap.meta, sources: sourceSummary, probe: cap.probe } : null,
    outcome: outcome ? ser({ ...outcome, result: "[result]" }) : null,
  };
}
