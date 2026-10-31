// src/services/vectorTiles.ts, from docs/specs/vectorTiles.md "Tests to write".
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeFetch } from "./helpers/browserFakes";
import { encodeMvt, type MvtLayer } from "./helpers/mvt";
import { lngLatToPixel, pixelToLngLat, type LngLat } from "../src/core/geo";

const TEMPLATE = "https://tiles.example/planet/v1/{z}/{x}/{y}.pbf";
const tileJson = () => new Response(JSON.stringify({ tiles: [TEMPLATE] }), { status: 200 });
const mvt = (layers: MvtLayer[]) => new Response(encodeMvt(layers).slice().buffer as ArrayBuffer, { status: 200 });
const tileOf = (url: string) => /\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url)?.slice(1).map(Number);

// A fresh module per test: the TileJSON is cached for the session.
// dataWarnings is read from the same fresh module graph.
let dataWarnings: string[] = [];
let clearDataWarnings = () => {};
async function load() {
  vi.resetModules();
  const dw = await import("../src/services/dataWarnings");
  dataWarnings = dw.dataWarnings;
  clearDataWarnings = dw.clearDataWarnings;
  return import("../src/services/vectorTiles");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A box inside one z14 tile near Perth, and that tile. */
const P0: LngLat = [115.8512, -31.9551];
const [TX, TY] = lngLatToPixel(P0, 14).map((v) => Math.floor(v / 256));
const oneTileBox: [number, number, number, number] = [115.8511, -31.9552, 115.8513, -31.955];
/** A box over a 2 x 2 block of z14 tiles. */
const quad: [number, number, number, number] = (() => {
  const nw = pixelToLngLat([TX * 256 + 200, TY * 256 + 200], 14), se = pixelToLngLat([(TX + 1) * 256 + 50, (TY + 1) * 256 + 50], 14);
  return [nw[0], se[1], se[0], nw[1]];
})();

describe("pure helpers", () => {
  it("clipToTile", async () => {
    const { clipToTile, signedArea } = await load();
    const sq = [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 100 }, { x: 10, y: 100 }];
    expect(clipToTile(sq, 4096)).toEqual(sq);
    const right = clipToTile([{ x: 4000, y: 10 }, { x: 4200, y: 10 }, { x: 4200, y: 110 }, { x: 4000, y: 110 }], 4096);
    expect(right).toHaveLength(4);
    expect(right.filter((p) => p.x === 4096).map((p) => p.y).sort((a, b) => a - b)).toEqual([10, 110]);
    expect(right.every((p) => p.x <= 4096)).toBe(true);
    expect(clipToTile([{ x: 5000, y: 10 }, { x: 5200, y: 10 }, { x: 5200, y: 110 }], 4096)).toEqual([]);
    const cover = clipToTile([{ x: -10000, y: -10000 }, { x: 20000, y: -10000 }, { x: -10000, y: 20000 }], 4096);
    expect(Math.abs(signedArea(cover))).toBeCloseTo(4096 * 4096, 3);
    expect(cover.every((p) => p.x === 0 || p.x === 4096 || p.y === 0 || p.y === 4096)).toBe(true);
  });

  it("signedArea: positive clockwise on screen (y down)", async () => {
    const { signedArea } = await load();
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }];
    expect(signedArea(sq)).toBe(50);
    expect(signedArea([...sq].reverse())).toBe(-50);
  });

  it("classWidths and roadClassLookup: drivable classes only", async () => {
    const { classWidths, roadClassLookup } = await load();
    const roads = [
      { pts: [[115.84, -31.96], [115.85, -31.96]] as LngLat[], cls: "minor" },
      { pts: [[115.84, -31.95999], [115.85, -31.95999]] as LngLat[], cls: "path" },
      { pts: [[115.84, -31.9601], [115.85, -31.9601]] as LngLat[], cls: "rail" },
      { pts: [[115.84, -31.9602], [115.85, -31.9602]] as LngLat[], cls: "service" },
    ];
    expect(classWidths(roads)).toEqual([{ width: 6, pts: roads[0].pts }, { width: 4, pts: roads[3].pts }]);
    const at = roadClassLookup(roads, -31.96);
    expect(at([115.845, -31.95999])).toBe("minor"); // the path is nearer but isn't drivable
    expect(at([115.845, -31.96025])).toBe("service");
    expect(at([115.845, -31.9615])).toBeUndefined(); // 13 m+ from the service road
  });
});

describe("fetching", () => {
  it("TileJSON fetched once and reused; a failed one is tried again; tile URLs are the template filled in", async () => {
    const vt = await load();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    let up = false;
    const log = fakeFetch((url) => (url.endsWith("/planet") ? (up ? tileJson() : new Response("", { status: 503 })) : mvt([])));
    const first = vt.tileTemplate().catch((e: Error) => e.message);
    await vi.runAllTimersAsync();
    expect(await first).toBe("map tile index unavailable");
    up = true;
    expect(await vt.tileTemplate()).toBe(TEMPLATE);
    await vt.fetchTileFeatures(oneTileBox);
    await vt.fetchTileFeatures(oneTileBox);
    expect(log.filter((r) => r.url.endsWith("/planet"))).toHaveLength(5); // 4 failed attempts, then 1
    expect(log.filter((r) => r.url.endsWith(".pbf")).map((r) => r.url)).toEqual([
      `https://tiles.example/planet/v1/14/${TX}/${TY}.pbf`,
      `https://tiles.example/planet/v1/14/${TX}/${TY}.pbf`,
    ]);
  });

  it("fetchTileFeatures: layers read as the spec says", async () => {
    const vt = await load();
    fakeFetch((url) => (url.endsWith("/planet") ? tileJson() : mvt([
      { name: "building", features: [
        { type: 3, props: { render_height: 6 }, geom: [[{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }], [{ x: 150, y: 150 }, { x: 150, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 150 }]] },
        { type: 3, props: { colour: "#fff" }, geom: [[{ x: 4000, y: 10 }, { x: 4200, y: 10 }, { x: 4200, y: 110 }, { x: 4000, y: 110 }]] },
      ] },
      { name: "transportation", features: [
        { type: 2, props: { class: "minor", oneway: 1, surface: "paved", brunnel: "bridge", service: "alley" }, geom: [[{ x: 0, y: 0 }, { x: 10, y: 10 }], [{ x: 20, y: 0 }, { x: 30, y: 10 }]] },
        { type: 2, props: { class: "path", subclass: "footway", oneway: 0 }, geom: [[{ x: 0, y: 0 }, { x: 4096, y: 4096 }]] },
        { type: 3, props: { class: "pier" }, geom: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]] },
      ] },
      { name: "poi", features: [
        { type: 1, props: { class: "cafe", subclass: "cafe", name: "Brew", rank: 2 }, geom: [[{ x: 1000, y: 1000 }]] },
        { type: 1, props: { class: "shop" }, geom: [[{ x: 4096, y: 10 }]] },
      ] },
      { name: "landuse", features: [
        { type: 3, props: { class: "retail" }, geom: [[{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }]] },
        { type: 3, props: { class: "residential" }, geom: [[{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }]] },
      ] },
      { name: "transportation_name", features: [{ type: 2, props: { class: "minor", name: "Hay St" }, geom: [[{ x: 0, y: 0 }, { x: 5, y: 5 }]] }] },
      { name: "waterway", features: [{ type: 2, props: { class: "stream" }, geom: [[{ x: 0, y: 0 }, { x: 5, y: 5 }]] }] },
    ])));
    const f = await vt.fetchTileFeatures(oneTileBox);
    expect(f.buildings).toHaveLength(2); // the hole is skipped
    expect(f.buildings[0].ring).toHaveLength(4);
    expect(f.buildings[0].tags).toEqual({ render_height: "6" });
    const ll = (x: number, y: number) => pixelToLngLat([(TX + x / 4096) * 256, (TY + y / 4096) * 256], 14);
    expect(Math.max(...f.buildings[1].ring.map((p) => p[0]))).toBeCloseTo(ll(4096, 0)[0], 9); // clipped at the tile edge
    expect(f.roads).toHaveLength(3);
    expect(f.roads[0]).toEqual({ pts: [ll(0, 0), ll(10, 10)], cls: "minor", oneway: 1, surface: "paved", brunnel: "bridge", service: "alley" });
    expect(f.roads[2].oneway).toBeUndefined();
    expect(f.roads[2].subclass).toBe("footway");
    expect(f.pois).toEqual([{ at: ll(1000, 1000), cls: "cafe", subclass: "cafe", name: "Brew", rank: 2 }]);
    expect(f.landuse.map((l) => l.cls)).toEqual(["retail"]);
    expect(f.names).toEqual([{ pts: [ll(0, 0), ll(5, 5)], name: "Hay St", cls: "minor" }]);
    expect(f.waterways).toEqual([{ pts: [ll(0, 0), ll(5, 5)], cls: "stream" }]);
  });

  it("fetchTileFeatures: row-major tile order whatever order tiles arrive in; a 500 is missing, a 404 isn't", async () => {
    const vt = await load();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    fakeFetch(async (url) => {
      if (url.endsWith("/planet")) return tileJson();
      const [, x, y] = tileOf(url)!;
      const order = (y - TY) * 2 + (x - TX);
      await new Promise((r) => setTimeout(r, 100 - order * 10)); // reverse arrival
      return mvt([{ name: "poi", features: [{ type: 1, props: { class: "c", name: `${order}` }, geom: [[{ x: 5, y: 5 }]] }] }]);
    });
    const p = vt.fetchTileFeatures(quad);
    await vi.runAllTimersAsync();
    expect((await p).pois.map((q) => q.name)).toEqual(["0", "1", "2", "3"]);

    fakeFetch((url) => {
      if (url.endsWith("/planet")) return tileJson();
      const [, x, y] = tileOf(url)!;
      if (x === TX && y === TY) return new Response("", { status: 404 });
      if (x === TX + 1 && y === TY) return new Response("", { status: 500 });
      if (x === TX && y === TY + 1) return new Response(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x0f]), { status: 200 });
      return mvt([]);
    });
    const q = vt.fetchTileFeatures(quad);
    await vi.runAllTimersAsync();
    await q;
    expect(dataWarnings).toEqual(["2 map tiles (buildings, streets, shops)"]);
  });

  it("fetchTileFeatures: over 400 tiles throws before any tile is fetched", async () => {
    const vt = await load();
    const log = fakeFetch((url) => (url.endsWith("/planet") ? tileJson() : mvt([])));
    await expect(vt.fetchTileFeatures([115.0, -32.5, 116.5, -31.0])).rejects.toThrow("Area too large for building tiles");
    expect(log.filter((r) => r.url.endsWith(".pbf"))).toHaveLength(0);
  });

  it("fetchCoast: holes, seam flags, beaches, landcover, row-major order, decode failures counted", async () => {
    const vt = await load();
    const [cx, cy] = lngLatToPixel(P0, 13).map((v) => Math.floor(v / 256));
    const one: [number, number, number, number] = oneTileBox;
    fakeFetch((url) => (url.endsWith("/planet") ? tileJson() : mvt([
      { name: "water", features: [
        { type: 3, props: { class: "ocean" }, geom: [[{ x: -64, y: -64 }, { x: 2000, y: -64 }, { x: 1000, y: 4160 }, { x: -64, y: 4160 }], [{ x: 200, y: 200 }, { x: 200, y: 400 }, { x: 400, y: 400 }, { x: 400, y: 200 }]] },
        { type: 3, props: { class: "lake" }, geom: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]] },
      ] },
      { name: "landcover", features: [
        { type: 3, props: { class: "sand", subclass: "beach" }, geom: [[{ x: 2000, y: 0 }, { x: 2200, y: 0 }, { x: 2200, y: 100 }]] },
        { type: 3, props: { class: "sand" }, geom: [[{ x: 2300, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 100 }]] },
        { type: 3, props: { class: "sand", subclass: "dune" }, geom: [[{ x: 2500, y: 0 }, { x: 2600, y: 0 }, { x: 2600, y: 100 }]] },
        { type: 3, props: { class: "ice" }, geom: [[{ x: 3000, y: 0 }, { x: 3600, y: 0 }, { x: 3600, y: 600 }]] },
        { type: 3, props: { class: "wood", subclass: "forest" }, geom: [[{ x: 3000, y: 0 }, { x: 3600, y: 0 }, { x: 3600, y: 600 }]] },
      ] },
      { name: "transportation", features: [{ type: 3, props: { class: "pier" }, geom: [[{ x: 3000, y: 3000 }, { x: 3100, y: 3000 }, { x: 3100, y: 3400 }]] }] },
    ])));
    const c = await vt.fetchCoast(one);
    expect(c.ocean).toHaveLength(1);
    expect(c.ocean[0].rings).toHaveLength(2);
    // Clipped exterior: (0,0) (2000,0)... the edges along x = 0, y = 0 and y = 4096 are seams.
    const ring = c.ocean[0].edge[0];
    expect(ring.filter((e) => !e).length).toBeGreaterThan(0);
    expect(ring.some((e) => e)).toBe(true);
    expect(c.ocean[0].edge[1]).toEqual([true, true, true, true]);
    expect(c.beaches).toHaveLength(2);
    expect(c.landcover.map((l) => `${l.cls}/${l.subclass}`)).toEqual(["sand/beach", "sand/undefined", "sand/dune", "wood/forest"]);
    expect(c.piers).toHaveLength(1);
    void cx; void cy;

    // Order and failures over four tiles.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const nw = pixelToLngLat([cx * 256 + 200, cy * 256 + 200], 13), se = pixelToLngLat([(cx + 1) * 256 + 50, (cy + 1) * 256 + 50], 13);
    const quad13: [number, number, number, number] = [nw[0], se[1], se[0], nw[1]];
    fakeFetch(async (url) => {
      if (url.endsWith("/planet")) return tileJson();
      const [, x, y] = tileOf(url)!;
      const order = (y - cy) * 2 + (x - cx);
      await new Promise((r) => setTimeout(r, 100 - order * 10));
      if (order === 3) return new Response(new Uint8Array([0xff, 0xff, 0xff]), { status: 200 });
      if (order === 2) return new Response("", { status: 403 });
      return mvt([{ name: "water", features: [{ type: 3, props: { class: "ocean", n: order }, geom: [[{ x: 10 + order, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 100 }]] }] }]);
    });
    clearDataWarnings();
    const p = vt.fetchCoast(quad13);
    await vi.runAllTimersAsync();
    const got = await p;
    const xs = got.ocean.map((o) => o.rings[0][0][0]);
    expect(xs).toHaveLength(2);
    expect(xs[0]).toBeLessThan(xs[1]); // tile (0,0) before tile (1,0)
    expect(dataWarnings).toEqual(["2 coast tiles (sea, piers, beaches)"]);
  });
});
