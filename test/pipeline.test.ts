// src/services/pipeline.ts, from docs/specs/pipeline.md "Tests to write", with every service stubbed.
import { describe, expect, it, vi } from "vitest";
import { PIPE_CASES, calls, capturedCall, pipeMocks, runCase, type PipeCase } from "./helpers/pipelineHarness";
import { dataWarnings, warnMissing } from "../src/services/dataWarnings";
import type { LngLat } from "../src/core/geo";

vi.mock("../src/services/osm", () => pipeMocks.osm);
vi.mock("../src/services/vectorTiles", () => pipeMocks.vectorTiles);
vi.mock("../src/services/tiles", () => pipeMocks.tiles);
vi.mock("../src/services/mapillary", () => pipeMocks.mapillary);
vi.mock("../src/services/landcover", () => pipeMocks.landcover);
vi.mock("../src/services/raster", () => pipeMocks.raster);
vi.mock("../src/services/art", () => pipeMocks.art);
vi.mock("../src/services/signs", () => pipeMocks.signs);
vi.mock("../src/core/track", async (orig) => ({ ...(await orig<object>()), buildTrack: pipeMocks.buildTrack }));

const pipeline = () => import("../src/services/pipeline");
const base = (name: string) => structuredClone(PIPE_CASES.find((c) => c.name === name)!) as PipeCase;
const run = async (c: PipeCase) => runCase((await pipeline()).runBuild as never, c);
const ROUTE = base("defaults").job.coords as LngLat[];

describe("paddedBounds", () => {
  it("grows the box by metres, longitude scaled at the first point", async () => {
    const { paddedBounds } = await pipeline();
    const p: LngLat = [115.1, -33.65];
    const [w, s, e, n] = paddedBounds([p, [115.2, -33.6]], 100);
    expect(s).toBe(-33.65 - 100 / 111320);
    expect(n).toBe(-33.6 + 100 / 111320);
    expect(w).toBe(115.1 - 100 / (111320 * Math.cos((-33.65 * Math.PI) / 180)));
    expect(e).toBe(115.2 - -100 / (111320 * Math.cos((-33.65 * Math.PI) / 180)));
  });
});

describe("runBuild", () => {
  it("asks each service for the right thing", async () => {
    const { paddedBounds } = await pipeline();
    const c = base("defaults");
    c.job.opts = { imageryZoom: 18, farmRoadsides: true, buildingRadius: 300, horizon: 2000, corridor: 70, farmland: true };
    c.job.token = "t";
    await run(c);
    expect(calls.fetchOsm[0][2]).toEqual({ cattleGrids: true, trafficSignals: true });
    expect(calls.fetchTileFeatures[0][0]).toEqual(paddedBounds(ROUTE, 350));
    expect(calls.fetchCoast[0][0]).toEqual(paddedBounds(ROUTE, 3200));
    expect(calls.fetchSeen[0].slice(0, 2)).toEqual([paddedBounds(ROUTE, 90), "t"]);
    expect(typeof (calls.fetchSeen[0][2] as { warn?: unknown })?.warn).toBe("function");
    expect(calls.fetchFarmland[0]).toEqual([ROUTE, 90]);

    const quiet = base("defaults");
    quiet.job.opts = { imageryZoom: 18, sea: false, trafficLights: false };
    await run(quiet);
    expect(calls.fetchOsm[0][2]).toEqual({ cattleGrids: false, trafficSignals: false });
    expect(calls.fetchSeen).toBeUndefined();
    expect(calls.fetchCoast).toBeUndefined();
    expect(calls.fetchFarmland).toBeUndefined();
    expect(calls.fetchPierFeatures).toBeUndefined();
  });

  it("defaults come from options.ts; buildTrack still gets the job's own options", async () => {
    const { paddedBounds } = await pipeline();
    const c = base("defaults");
    c.job.opts = { corridor: undefined, name: "x" };
    c.job.token = "t";
    const r = await run(c);
    expect(calls.fetchTileFeatures[0][0]).toEqual(paddedBounds(ROUTE, 300));
    expect(calls.fetchSeen[0][0]).toEqual(paddedBounds(ROUTE, 110));
    expect(calls.fetchCoast[0][0]).toEqual(paddedBounds(ROUTE, 2700));
    expect(r.buildTrack!.partial).toEqual({ name: "x" });
    expect(r.buildTrack!.sources.keys).toContain("imagery");
    expect(calls.loadChunkImagery).toHaveLength(1);
  });

  it("warnings: cleared after the first report; one per failed source; Mapillary isn't one; too large isn't missing data", async () => {
    const { runBuild } = await pipeline();
    const c = base("everything_fails");
    let first = true;
    const job = structuredClone(c.job) as never;
    const { answers } = await import("./helpers/pipelineHarness");
    Object.assign(answers, { osm: c.osm, tiles: c.tiles, coast: c.coast, seen: c.seen, farmland: c.farmland, pier: null, delays: {}, imageryUsed: [], demUsed: [] });
    const out = await runBuild(job, async () => {
      if (first) warnMissing("stale from the last build");
      first = false;
    }, () => {});
    expect(out.missing).toEqual(["farmland tiles (vineyards, paddock fences)", "all map tiles (buildings, streets, shops)", "all coast tiles (sea, piers, beaches)"]);
    expect(out.seenError).toBe("Mapillary says no");
    expect(out.warnings).toEqual([]);
    expect(out.missing).not.toBe(dataWarnings);

    const big = await run(base("too_large"));
    expect((big.outcome as { missing: string[] }).missing).toEqual([]);
    expect((big.outcome as { warnings: string[] }).warnings).toHaveLength(2);
  });

  it("widths: Overpass first, then tile class widths; none with an override", async () => {
    const r1 = await run(base("defaults"));
    expect(r1.buildTrack!.probe.widthAt).toEqual([7.5, null, null]);
    expect((r1.outcome as { widthFallback: boolean }).widthFallback).toBe(false);
    const r2 = await run(base("overpass_down_tiles_up"));
    expect(r2.buildTrack!.probe.widthAt).toEqual([4.25, 4.25, null]);
    const r3 = await run(base("width_override_sea_off"));
    expect(r3.buildTrack!.probe.widthAt).toBeUndefined();
    expect((r3.outcome as { widthFallback: boolean }).widthFallback).toBe(false);
    const r4 = await run(base("overpass_down_tiles_no_roads"));
    expect((r4.outcome as { widthFallback: boolean }).widthFallback).toBe(true);
  });

  it("area streets: OSM's inside the area, tiles' paths and everything outside kept", async () => {
    const r = await run(base("single_area_ring"));
    const lines = (r.buildTrack!.sources.streets as { lines: { cls: string; pts: LngLat[] }[] }).lines;
    const tag = (l: { cls: string; pts: LngLat[] }) => `${l.cls}@${l.pts[0][0].toFixed(3)},${l.pts[0][1].toFixed(3)}`;
    expect(lines.map(tag)).toEqual([
      "minor@115.870,-31.959", // tile road outside the area
      "tertiary@115.840,-31.959", // a class OSM didn't give
      "track@115.840,-31.957",
      "path@115.840,-31.957", "trunk_construction@115.840,-31.957", "motorway@115.840,-31.957", "minor@115.840,-31.957",
      // then OSM's roads inside the ring
      "minor@115.840,-31.959", "secondary@115.840,-31.958", "minorx@115.840,-31.958", "path@115.840,-31.958", "service@115.841,-31.958",
    ]);
    const plain = await run(base("defaults"));
    expect((plain.buildTrack!.sources.streets as { lines: unknown[] }).lines).toHaveLength(12);
  });

  it("crossings only with armco; bridges from OSM then the tiles, by class", async () => {
    const r = await run(base("area_everything"));
    const x = (r.buildTrack!.sources.osm as { crossings: { bridges: LngLat[][]; waterways: unknown[] } }).crossings;
    expect(x.bridges).toHaveLength(5);
    expect(x.waterways).toHaveLength(1);
    const off = await run(base("defaults"));
    expect((off.buildTrack!.sources.osm as { crossings?: unknown }).crossings).toBeUndefined();
  });

  it("unsealed tile roads (not paths) are added after Overpass's", async () => {
    const r = await run(base("defaults"));
    const u = (r.buildTrack!.sources.osm as { unsealed: LngLat[][] }).unsealed;
    expect(u.map((l) => l[0][1].toFixed(3))).toEqual(["-31.960", "-31.957", "-31.957"]);
  });

  it("one jetty request over every pier, padded 40 m; none without piers", async () => {
    const { paddedBounds } = await pipeline();
    const c = base("defaults");
    await run(c);
    const coast = c.coast as { piers: { rings: LngLat[][] }[] };
    expect(calls.fetchPierFeatures).toEqual([[paddedBounds(coast.piers.flatMap((p) => p.rings[0]), 40)]]);
    await run(base("overpass_down_tiles_up"));
    expect(calls.fetchPierFeatures).toBeUndefined();
  });

  it("sources: no imagery at zoom 0; the tracing text; credits in key order, read when asked", async () => {
    const r = await run(base("width_override_sea_off"));
    expect(calls.loadChunkImagery).toBeUndefined();
    expect(r.traces).toEqual(["Tracing the road in the aerial photos (33%)", "Tracing the road in the aerial photos (33%)"]);
    const c = base("area_everything");
    c.imageryUsed = ["wa", "esri"];
    c.demUsed = ["wa", "vic", "qld"];
    const a = await run(c);
    expect(a.buildTrack!.probe.creditsBefore).toEqual({ imagery: "", elevation: "" });
    expect(a.buildTrack!.probe.creditsAfter).toEqual({ imagery: "C-esri; C-wa", elevation: "E-qld; E-vic; E-wa" });
    expect((a.outcome as { usedDem: string[] }).usedDem).toEqual(["qld", "vic", "wa"]);
    expect((a.outcome as { usedImagery: string[] }).usedImagery).toEqual(["esri", "wa"]);
  });

  it("outcome: every field; chunkImages is the map the imagery source draws into", async () => {
    const { runBuild } = await pipeline();
    const c = base("defaults");
    const { answers } = await import("./helpers/pipelineHarness");
    Object.assign(answers, { osm: c.osm, tiles: c.tiles, coast: c.coast, seen: [], farmland: [], pier: c.pier, delays: {}, imageryUsed: ["wa"], demUsed: [] });
    const out = await runBuild(structuredClone(c.job) as never, async () => {}, () => {});
    expect(Object.keys(out).sort()).toEqual(["chunkImages", "missing", "result", "seen", "seenError", "usedDem", "usedImagery", "warnings", "widthFallback"]);
    expect(out.chunkImages).toBe(pipeMocks.tiles.loadChunkImagery.mock.lastCall![4]);
    expect(out.chunkImages.has("chunkA")).toBe(true);
  });

  it("fewer than two points: the buildTrack message, before any download", async () => {
    const c = base("defaults");
    c.job.coords = [[115.84, -31.96]];
    const r = await run(c);
    expect(r.error).toBe("Pick a start and a finish on the map first");
    expect(r.events).toEqual([]);
  });

  it("the same answers in a different arrival order give the same buildTrack arguments", async () => {
    const a = base("area_everything");
    a.delays = { osm: 5, tiles: 1, coast: 9, seen: 3, farmland: 7 };
    const b = base("area_everything");
    b.delays = { osm: 1, tiles: 9, coast: 2, seen: 8, farmland: 0 };
    const ra = await run(a);
    const first = capturedCall();
    const rb = await run(b);
    expect(rb.buildTrack).toEqual(ra.buildTrack);
    expect(rb.outcome).toEqual(ra.outcome);
    expect(first).not.toBeNull();
  });
});
