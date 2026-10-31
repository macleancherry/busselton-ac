// WA DEM tiles below zoom 15 (docs/specs/tiles.md, bug 1): public/dem/wa/10..14 averaged from the
// zoom-15 tiles by scripts/dem/make_wa_overviews.py, and loadDem using them for the far terrain.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeCanvas, fakeFetch, pngResponse, solidTile, terrariumRgb } from "./helpers/browserFakes";
import { decodeTerrariumTile } from "../src/core/elevation";
import { LocalProjection, lngLatToPixel, type LngLat } from "../src/core/geo";
import { decodeOwnPng } from "../src/core/png";
import { clearDataWarnings, dataWarnings } from "../src/services/dataWarnings";
import { STATE_DEMS, WA_ZOOMS, loadDem, type DemSource } from "../src/services/tiles";

const DEM = "public/dem/wa";
const BUSSELTON: LngLat = [115.35, -33.65];
// The LiDAR stops just west of Dunsborough: Cape Naturaliste itself has no WA tiles at any zoom.
const DUNSBOROUGH: LngLat = [115.08, -33.61];
const PERTH: LngLat = [115.86, -31.95];

const tilePath = (z: number, x: number, y: number) => `${DEM}/${z}/${x}/${y}.png`;
const readTile = (z: number, x: number, y: number) => decodeOwnPng(new Uint8Array(readFileSync(tilePath(z, x, y))));
const heights = (z: number, x: number, y: number) => decodeTerrariumTile(readTile(z, x, y).rgba);
const tileAt = (p: LngLat, z: number) => lngLatToPixel(p, z).map((v) => Math.floor(v / 256)) as [number, number];

const hasPython = spawnSync("python3", ["-I", "-c", "import numpy, PIL"], { encoding: "utf8" }).status === 0;

beforeEach(() => clearDataWarnings());
afterEach(() => vi.unstubAllGlobals());

describe("WA overview tiles", () => {
  it.skipIf(!hasPython)("make_wa_overviews.py's own tests pass (round trip, block means)", () => {
    const p = spawnSync("python3", ["-I", "scripts/dem/test_make_wa_overviews.py"], { encoding: "utf8" });
    expect(p.status, p.stdout + p.stderr).toBe(0);
  }, 60_000);

  it("every zoom from 10 to 15 is there, and every overview tile has zoom-15 children", () => {
    expect(WA_ZOOMS).toEqual([10, 15]);
    for (let z = WA_ZOOMS[0]; z <= WA_ZOOMS[1]; z++) expect(existsSync(`${DEM}/${z}`), `zoom ${z}`).toBe(true);
    const z15 = new Set(readdirSync(`${DEM}/15`).flatMap((x) => readdirSync(`${DEM}/15/${x}`).map((f) => `${x},${parseInt(f)}`)));
    for (let z = 10; z < 15; z++) {
      const k = 2 ** (15 - z);
      for (const xs of readdirSync(`${DEM}/${z}`)) {
        for (const f of readdirSync(`${DEM}/${z}/${xs}`)) {
          const x = Number(xs), y = parseInt(f);
          let any = false;
          for (let dx = 0; dx < k && !any; dx++) for (let dy = 0; dy < k && !any; dy++) any = z15.has(`${x * k + dx},${y * k + dy}`);
          expect(any, `${z}/${x}/${y}`).toBe(true);
        }
      }
    }
  });

  it("the zoom-13 tile at Busselton is the mean of its zoom-15 children, pixel block by block", () => {
    const [x, y] = tileAt(BUSSELTON, 13);
    const coarse = heights(13, x, y);
    const k = 4, n = 256 / k;
    let checked = 0;
    for (let dy = 0; dy < k; dy++) {
      for (let dx = 0; dx < k; dx++) {
        const cx = x * k + dx, cy = y * k + dy;
        const child = existsSync(tilePath(15, cx, cy)) ? heights(15, cx, cy) : null;
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            let sum = 0, count = 0;
            if (child) {
              for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
                const v = child[(r * k + i) * 256 + c * k + j];
                if (Number.isFinite(v)) { sum += v; count++; }
              }
            }
            const got = coarse[(dy * n + r) * 256 + dx * n + c];
            if (!count) {
              expect(Number.isNaN(got)).toBe(true);
              continue;
            }
            // Terrarium precision: re-encoding rounds to the nearest 1/256 m.
            expect(Math.abs(got - sum / count)).toBeLessThanOrEqual(1 / 512 + 1e-6);
            checked++;
          }
        }
      }
    }
    // The bay and the edge of the LiDAR leave much of this tile without data; a good part is land.
    expect(checked).toBeGreaterThan(10_000);
  });

  it("there are WA tiles at every overview zoom at Busselton and Dunsborough", () => {
    for (const p of [BUSSELTON, DUNSBOROUGH]) {
      for (let z = 10; z < 15; z++) expect(existsSync(tilePath(z, ...tileAt(p, z))), `${p} zoom ${z}`).toBe(true);
    }
  });
});

/** fetch answering /dem/wa/ from the repo's files (404 when absent) and Terrarium with a flat 500 m. */
function serveRepoTiles() {
  return fakeFetch((url) => {
    if (url.includes("terrarium")) return pngResponse(solidTile(...terrariumRgb(500)));
    const m = /\/dem\/wa\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url);
    if (m && existsSync(tilePath(+m[1], +m[2], +m[3]))) return pngResponse(readTile(+m[1], +m[2], +m[3]).rgba);
    return new Response("", { status: 404 });
  });
}

describe("loadDem with the WA overviews", () => {
  it("the far DEM (zoom 12) at Busselton takes its heights from WA tiles below zoom 15", async () => {
    fakeCanvas();
    const log = serveRepoTiles();
    const proj = new LocalProjection(BUSSELTON);
    const used = new Set<DemSource>();
    const h = await loadDem(proj, { minX: -8000, minY: -8000, maxX: 8000, maxY: 8000 }, 12, undefined, used);
    const zooms = new Set(log.map((r) => r.url).filter((u) => u.includes("/dem/wa/")).map((u) => Number(u.split("/")[3])));
    expect([...zooms].every((z) => z >= 10 && z < 15)).toBe(true);
    expect(used).toEqual(new Set(["wa"]));
    // Busselton is near sea level: WA heights, not Terrarium's 500 m.
    expect(Math.abs(h(0, 0))).toBeLessThan(30);
    expect(dataWarnings).toEqual([]);
  });

  it("outside STATE_DEMS.wa.box: no WA requests, Terrarium only", async () => {
    fakeCanvas();
    const [w, s, e, n] = STATE_DEMS.wa.box;
    expect(PERTH[0] > w && PERTH[0] < e && PERTH[1] > s && PERTH[1] < n).toBe(false);
    const log = serveRepoTiles();
    const used = new Set<DemSource>();
    const h = await loadDem(new LocalProjection(PERTH), { minX: -8000, minY: -8000, maxX: 8000, maxY: 8000 }, 12, undefined, used);
    expect(log.some((r) => r.url.includes("/dem/wa/"))).toBe(false);
    expect(used.size).toBe(0);
    expect(h(0, 0)).toBeCloseTo(500, 3);
  });

  it("below zoom 10 the WA tiles aren't asked for", async () => {
    fakeCanvas();
    const log = serveRepoTiles();
    const used = new Set<DemSource>();
    const h = await loadDem(new LocalProjection(BUSSELTON), { minX: -250000, minY: -250000, maxX: 250000, maxY: 250000 }, 9, undefined, used);
    expect(log.some((r) => r.url.includes("/dem/wa/"))).toBe(false);
    expect(used.size).toBe(0);
    expect(h(0, 0)).toBeCloseTo(500, 3);
  });
});
