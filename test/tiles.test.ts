// src/services/tiles.ts, from docs/specs/tiles.md "Tests to write".
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeCanvas, fakeFetch, pngResponse, solidTile, taggedImage, terrariumRgb } from "./helpers/browserFakes";
import { decodeTerrariumTile, demTilesFor } from "../src/core/elevation";
import { LocalProjection, lngLatToPixel, type LngLat } from "../src/core/geo";
import { clearDataWarnings, dataWarnings } from "../src/services/dataWarnings";
import {
  DEM_CREDIT, DEM_LABEL, IMAGERY, STATE_DEMS, decodeTerrarium, imageryChain, loadBitmap, loadChunkImagery, loadDem, tileBbox, tileUrl, upsample, type DemSource, type ImagerySource,
} from "../src/services/tiles";

const W = 40075016.68557849;
const CAPES: LngLat = [115.1, -33.6];
const PERTH: LngLat = [115.86, -31.95];

beforeEach(() => clearDataWarnings());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("tile boxes and URLs", () => {
  it("tileBbox: Web Mercator metres with three decimals", () => {
    expect(tileBbox(0, 0, 0)).toBe("-20037508.343,-20037508.343,20037508.343,20037508.343");
    expect(tileBbox(1, 1, 0)).toBe("0.000,0.000,20037508.343,20037508.343");
    const [x0, , x1] = tileBbox(20, 864246, 620913).split(",").map(Number);
    expect(Math.abs(x1 - x0 - W / 2 ** 20)).toBeLessThan(0.0015);
    expect(tileBbox(20, 864246, 620913)).toMatch(/^-?\d+\.\d{3},-?\d+\.\d{3},-?\d+\.\d{3},-?\d+\.\d{3}$/);
  });

  it("tileUrl: {z}/{y}/{x} on the tile caches, the Mercator box on Landgate", () => {
    expect(tileUrl("esri", 19, 432123, 310456)).toBe("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/19/310456/432123");
    expect(tileUrl("qld", 12, 3, 4)).toBe("https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestStateProgram_AllUsers/ImageServer/tile/12/4/3");
    expect(tileUrl("nsw", 21, 5, 6)).toBe("https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/21/6/5");
    const wa = tileUrl("wa", 20, 864246, 620913);
    expect(wa).toBe(
      `https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Locate/ImageServer/exportImage?bbox=${tileBbox(20, 864246, 620913)}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&interpolation=RSP_BilinearInterpolation&f=image`,
    );
    for (const k of Object.keys(IMAGERY) as ImagerySource[]) expect(tileUrl(k, 3, 1, 2)).not.toMatch(/[{}]/);
  });

  it("imageryChain: state sources first where they cover, Esri last", () => {
    expect(imageryChain(CAPES)).toEqual(["wa", "esri"]);
    expect(imageryChain(PERTH)).toEqual(["wa", "esri"]);
    expect(imageryChain([151.2, -33.87])).toEqual(["nsw", "esri"]);
    expect(imageryChain([153.03, -27.47])).toEqual(["qld", "esri"]);
    expect(imageryChain([153.3, -28.5])).toEqual(["qld", "nsw", "esri"]);
    expect(imageryChain([174.78, -41.29])).toEqual(["esri"]);
    expect(imageryChain(CAPES, "esri")).toEqual(["esri"]);
    expect(imageryChain([174.78, -41.29], "nsw")).toEqual(["nsw", "esri"]);
  });
});

describe("elevation helpers", () => {
  it("decodeTerrarium is core's decoder", () => {
    const px = new Uint8Array([128, 0, 0, 255, 10, 20, 30, 0, 129, 2, 128, 255]);
    const a = decodeTerrarium(px), b = decodeTerrariumTile(px);
    expect(a[0]).toBe(0);
    expect(a[1]).toBeNaN();
    expect([...a]).toEqual([...b]);
  });

  it("upsample: a plane stays a plane; up 0 is the identity; the edge holds", () => {
    const plane = new Float32Array(256 * 256);
    for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) plane[r * 256 + c] = 5 + 0.5 * c - 0.25 * r;
    // Identity, but for the last row and column: positions clamp at 254.999 (as the WA bases were built).
    const same = upsample(plane, 0, 0, 0);
    let worst = 0;
    for (let i = 0; i < same.length; i++) worst = Math.max(worst, Math.abs(same[i] - plane[i]));
    expect(worst).toBeLessThan(1e-3);
    for (let r = 0; r < 255; r++) for (let c = 0; c < 255; c++) expect(same[r * 256 + c]).toBe(plane[r * 256 + c]);
    const up = 2, ox = 1, oy = 2, k = 4, span = 64;
    const child = upsample(plane, ox, oy, up);
    for (const [c, r] of [[10, 10], [100, 37], [200, 250]]) {
      const fx = ox * span + (c + 0.5) / k - 0.5, fy = oy * span + (r + 0.5) / k - 0.5;
      expect(child[r * 256 + c]).toBeCloseTo(5 + 0.5 * fx - 0.25 * fy, 4);
    }
    // Sub-tile (0, 0): the first child pixels sit left of parent pixel 0's centre, clamped to it.
    const edge = upsample(plane, 0, 0, 2);
    expect(edge[0]).toBeCloseTo(5, 4);
    expect(edge[1]).toBeCloseTo(5, 4);
  });

  it("DEM credits and labels", () => {
    for (const k of ["qld", "nsw", "vic", "wa"] as DemSource[]) {
      expect(DEM_CREDIT[k].startsWith("Elevation: ")).toBe(true);
      expect(DEM_LABEL[k]).toBeTruthy();
    }
    expect(DEM_LABEL.wa).toBe("WA 5 m");
  });

  it("STATE_DEMS.wa.box takes in every box make_wa_tiles.py has cut", () => {
    const doc = readFileSync("scripts/dem/make_wa_tiles.py", "utf8").split('"""')[1];
    const boxes = [...doc.matchAll(/--box (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/g)].map((m) => m.slice(1, 5).map(Number));
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    const [w, s, e, n] = STATE_DEMS.wa.box;
    for (const [bw, bs, be, bn] of boxes) {
      expect(bw).toBeGreaterThanOrEqual(w);
      expect(bs).toBeGreaterThanOrEqual(s);
      expect(be).toBeLessThanOrEqual(e);
      expect(bn).toBeLessThanOrEqual(n);
    }
  });
});

describe("loadBitmap", () => {
  it("404 is null and resets the host's count; three 500s throw after 0.5 s and 1 s", async () => {
    fakeCanvas();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    let status = 500;
    const log = fakeFetch(() => (status === 404 ? new Response("", { status: 404 }) : new Response("", { status })));
    const p = loadBitmap("https://a.example/1.png").then(() => "ok", (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(499);
    expect(log).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(log).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(log).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe("Could not load https://a.example/1.png: HTTP 500");
    expect(log).toHaveLength(3);
    status = 404;
    expect(await loadBitmap("https://a.example/2.png")).toBeNull();
    // The 404 reset the count: three more failures don't give the host up.
    status = 500;
    const q = loadBitmap("https://a.example/3.png").catch(() => null);
    await vi.runAllTimersAsync();
    await q;
    status = 200;
    log.length = 0;
    await loadBitmap("https://a.example/4.png").catch(() => null);
    expect(log).toHaveLength(1);
  });

  it("after six failures a host is given up without fetching", async () => {
    fakeCanvas();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const log = fakeFetch(() => new Response("", { status: 503 }));
    const p = Promise.all([loadBitmap("https://b.example/1").catch(() => "x"), loadBitmap("https://b.example/2").catch(() => "x")]);
    await vi.runAllTimersAsync();
    await p;
    expect(log).toHaveLength(6);
    expect(await loadBitmap("https://b.example/3")).toBeNull();
    expect(log).toHaveLength(6);
  });

  it("no more than six loads in flight at once", async () => {
    fakeCanvas();
    let now = 0, peak = 0;
    const release: (() => void)[] = [];
    fakeFetch(() => {
      now++;
      peak = Math.max(peak, now);
      return new Promise<Response>((ok) => release.push(() => { now--; ok(taggedImage("t")); }));
    });
    const all = Promise.all(Array.from({ length: 15 }, (_, i) => loadBitmap(`https://c.example/${i}`)));
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 0));
      release.splice(0).forEach((f) => f());
    }
    const got = await all;
    expect(got.every((b) => b)).toBe(true);
    expect(peak).toBe(6);
  });
});

/** Local bounds of a box of tiles (inset a little) at zoom z. */
function tileBounds(proj: LocalProjection, z: number, x0: number, y0: number, nx: number, ny: number) {
  const [minX, maxY] = proj.pixelToLocal([x0 * 256 + 2, y0 * 256 + 2], z);
  const [maxX, minY] = proj.pixelToLocal([(x0 + nx) * 256 - 2, (y0 + ny) * 256 - 2], z);
  return { minX, minY, maxX, maxY };
}

describe("loadDem", () => {
  it("outside every state model: Terrarium only, at min(15, zoom), stepping down while over 300 tiles", async () => {
    fakeCanvas();
    const log = fakeFetch(() => pngResponse(solidTile(...terrariumRgb(12))));
    const proj = new LocalProjection([174.78, -41.29]);
    const used = new Set<DemSource>();
    const h = await loadDem(proj, { minX: -500, minY: -300, maxX: 500, maxY: 300 }, 17, undefined, used);
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((r) => r.url.startsWith("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/15/"))).toBe(true);
    expect(h(0, 0)).toBeCloseTo(12, 3);
    expect(used.size).toBe(0);
    const big = { minX: -40000, minY: -40000, maxX: 40000, maxY: 40000 };
    log.length = 0;
    await loadDem(proj, big, 15);
    let z = 15;
    while (z > 10 && demTilesFor(proj, big, z).length > 300) z--;
    expect(z).toBeLessThan(15);
    expect(new Set(log.map((r) => r.url.split("/")[5]))).toEqual(new Set([String(z)]));
    expect(log).toHaveLength(demTilesFor(proj, big, z).length);
  });

  it("in WA at zoom 14: zoom-15 parents fetched once each, transparent WA pixels from Terrarium, non-PNG is no data", async () => {
    fakeCanvas();
    const wa = solidTile(...terrariumRgb(3));
    for (let i = 0; i < 256 * 4 * 4; i += 4) wa[i + 3] = 0; // top four rows: no data
    const proj = new LocalProjection(CAPES);
    const [px, py] = lngLatToPixel(CAPES, 15).map((v) => Math.floor(v / 256));
    const bounds = tileBounds(proj, 15, px, py, 2, 1);
    const log = fakeFetch((url) => {
      if (url.includes("terrarium")) return pngResponse(solidTile(...terrariumRgb(10)));
      if (url.endsWith(`/${px + 1}/${py}.png`)) return new Response("<!doctype html>", { headers: { "content-type": "text/html" } });
      return pngResponse(wa);
    });
    const used = new Set<DemSource>();
    const h = await loadDem(proj, bounds, 14, undefined, used);
    const waUrls = log.map((r) => r.url).filter((u) => u.includes("/dem/wa/"));
    expect(waUrls.sort()).toEqual([`/dem/wa/15/${px}/${py}.png`, `/dem/wa/15/${px + 1}/${py}.png`]);
    expect(used).toEqual(new Set(["wa"]));
    // Middle of the WA tile: 3 m. Its top rows and the non-PNG tile come from Terrarium's 10 m,
    // shifted down to meet the WA heights at the seam (demSeam.ts): near 3 m by the seam, rising away from it.
    const at = (gx: number, gy: number) => proj.pixelToLocal([gx, gy], 15);
    expect(h(...at(px * 256 + 128, py * 256 + 128))).toBeCloseTo(3, 3);
    const top = h(...at(px * 256 + 128, py * 256 + 0.6));
    expect(top).toBeGreaterThan(2.5);
    expect(top).toBeLessThan(5);
    const beside = h(...at((px + 1) * 256 + 4, py * 256 + 128)), further = h(...at((px + 1) * 256 + 128, py * 256 + 128));
    expect(beside).toBeLessThan(5);
    expect(further).toBeGreaterThan(beside);
    expect(further).toBeLessThanOrEqual(10);
    expect(dataWarnings).toEqual([]);
  });

  it("a Terrarium tile that 404s or keeps failing is no data, filled from its neighbours, with a data warning", async () => {
    fakeCanvas();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const proj = new LocalProjection([174.78, -41.29]);
    const [tx, ty] = lngLatToPixel([174.78, -41.29], 14).map((v) => Math.floor(v / 256));
    const bounds = tileBounds(proj, 14, tx, ty, 3, 1);
    fakeFetch((url) => {
      if (url.endsWith(`/${tx + 1}/${ty}.png`)) return new Response("", { status: 404 });
      if (url.endsWith(`/${tx + 2}/${ty}.png`)) return new Response("", { status: 500 });
      return pngResponse(solidTile(...terrariumRgb(42)));
    });
    const p = loadDem(proj, bounds, 14);
    await vi.runAllTimersAsync();
    const h = await p;
    expect(h(...proj.pixelToLocal([(tx + 1) * 256 + 128, ty * 256 + 128], 14))).toBeCloseTo(42, 3);
    expect(h(...proj.pixelToLocal([(tx + 2) * 256 + 128, ty * 256 + 128], 14))).toBeCloseTo(42, 3);
    expect(dataWarnings).toEqual(["2 elevation tiles (Terrarium)"]);
  });

  it("exportImage models: 8 x 8 blocks, one request each; a short body is no data", async () => {
    fakeCanvas();
    const proj = new LocalProjection([151.2, -33.87]);
    const [cx, cy] = lngLatToPixel([151.2, -33.87], 16).map((v) => Math.floor(v / 256));
    const x0 = cx - (cx % 8), y0 = cy - (cy % 8);
    const bounds = tileBounds(proj, 16, x0, y0, 10, 3);
    expect(demTilesFor(proj, bounds, 16)).toHaveLength(30);
    const log = fakeFetch((url) => (url.includes("terrarium") ? pngResponse(solidTile(...terrariumRgb(7))) : new Response(new Uint8Array(16), { status: 200 })));
    const used = new Set<DemSource>();
    const h = await loadDem(proj, bounds, 16, undefined, used);
    const sizes = log.filter((r) => r.url.includes("NSW_5M_Elevation")).map((r) => /size=(\d+,\d+)/.exec(r.url)![1]).sort();
    expect(sizes).toEqual(["2048,768", "512,768"]);
    expect(used.size).toBe(0);
    expect(h(0, 0)).toBeCloseTo(7, 3);
  });

  it("exportImage heights fill the tiles they cover", async () => {
    fakeCanvas();
    const proj = new LocalProjection([153.03, -27.47]);
    const [cx, cy] = lngLatToPixel([153.03, -27.47], 16).map((v) => Math.floor(v / 256));
    const bounds = tileBounds(proj, 16, cx, cy, 2, 1);
    fakeFetch((url) => {
      if (url.includes("terrarium")) return pngResponse(solidTile(...terrariumRgb(7)));
      const [w, hgt] = /size=(\d+),(\d+)/.exec(url)!.slice(1).map(Number);
      const f = new Float32Array(w * hgt).fill(21.5);
      return new Response(f.buffer, { status: 200 });
    });
    const used = new Set<DemSource>();
    const h = await loadDem(proj, bounds, 16, undefined, used);
    expect(used).toEqual(new Set(["qld"]));
    expect(h(...proj.pixelToLocal([cx * 256 + 100, cy * 256 + 100], 16))).toBeCloseTo(21.5, 3);
  });
});

describe("loadChunkImagery", () => {
  const chunk = { key: "k", minX: -60, minY: -60, maxX: 60, maxY: 60 };

  it("draws tiles in row-major order whatever order they arrive in, and returns a DDS", async () => {
    const { draws } = fakeCanvas();
    let n = 0;
    fakeFetch(async (url) => {
      const wait = 30 - n++ * 3; // later requests answer first
      await new Promise((r) => setTimeout(r, Math.max(0, wait)));
      return taggedImage(url);
    });
    const previews = new Map<string, OffscreenCanvas>();
    const used = new Set<ImagerySource>();
    const r = await loadChunkImagery(new LocalProjection([174.7, -41.2]), chunk, 19, 256, previews, ["esri"], used);
    const order = draws.map((d) => d.tag!.split("/").slice(-2).map(Number));
    const sorted = [...order].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(order.length).toBeGreaterThan(1);
    expect(order).toEqual(sorted);
    expect(r!.ext).toBe("dds");
    expect(String.fromCharCode(...r!.data.slice(0, 4))).toBe("DDS ");
    expect(r!.rgba.length).toBe(256 * 256 * 4);
    expect(previews.has("k")).toBe(true);
    expect(used).toEqual(new Set(["esri"]));
  });

  it("fills a gap in the first source from the next, drawn behind; counts chunks with gaps left", async () => {
    const { draws } = fakeCanvas();
    let firstWa = true;
    fakeFetch((url) => {
      if (url.includes("slip.wa.gov.au")) {
        const ok = !firstWa;
        firstWa = false;
        return ok ? taggedImage(url) : new Response("", { status: 404 });
      }
      return taggedImage(url);
    });
    const used = new Set<ImagerySource>();
    const r = await loadChunkImagery(new LocalProjection(PERTH), chunk, 19, 256, new Map(), ["wa", "esri"], used);
    expect(r).not.toBeNull();
    expect(used).toEqual(new Set(["wa", "esri"]));
    const esri = draws.filter((d) => d.tag!.includes("arcgisonline"));
    expect(esri.length).toBeGreaterThan(0);
    expect(esri.every((d) => d.op === "destination-over")).toBe(true);
    expect(draws.filter((d) => d.tag!.includes("slip")).every((d) => d.op === "source-over")).toBe(true);
    expect(dataWarnings).toEqual([]);

    // Every source with holes: grass-free olive patches, and one warning counting the chunks.
    fakeFetch((url) => (Number(url.split("/").pop()) % 2 === 0 ? new Response("", { status: 404 }) : taggedImage(url)));
    await loadChunkImagery(new LocalProjection(PERTH), chunk, 19, 256, new Map(), ["esri"]);
    await loadChunkImagery(new LocalProjection(PERTH), { ...chunk, key: "k2", minX: 60, maxX: 180 }, 19, 256, new Map(), ["esri"]);
    expect(dataWarnings).toEqual(["2 aerial photo chunks with gaps"]);
  });

  it("nothing drawn from any source: null", async () => {
    fakeCanvas();
    fakeFetch(() => new Response("", { status: 404 }));
    const previews = new Map<string, OffscreenCanvas>();
    expect(await loadChunkImagery(new LocalProjection(PERTH), chunk, 18, 256, previews, ["wa", "esri"])).toBeNull();
    expect(previews.size).toBe(0);
  });
});
