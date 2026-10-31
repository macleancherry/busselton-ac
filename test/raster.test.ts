import { describe, expect, it } from "vitest";
import type { ColourTransform } from "../src/core/colour";
import { LocalProjection, lngLatToPixel, type Vec2 } from "../src/core/geo";
import { loadRouteRaster, type TileLoader } from "../src/services/raster";
import type { ImagerySource } from "../src/services/tiles";

const proj = new LocalProjection([115.35, -33.65]);

/** A 256 x 256 RGBA tile coloured by global pixel. */
function paint(x: number, y: number, colour: (gx: number, gy: number) => [number, number, number]): { rgba: Uint8ClampedArray } {
  const rgba = new Uint8ClampedArray(256 * 256 * 4);
  for (let py = 0; py < 256; py++) {
    for (let px = 0; px < 256; px++) {
      const [r, g, b] = colour(x * 256 + px, y * 256 + py);
      const o = (py * 256 + px) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
    }
  }
  return { rgba };
}

const gradient = (gx: number, gy: number): [number, number, number] => [gx % 256, gy % 256, 77];

type Call = { src: ImagerySource; z: number; x: number; y: number };

function recorder(answer: (c: Call) => { rgba: Uint8ClampedArray } | null = (c) => paint(c.x, c.y, gradient)) {
  const calls: Call[] = [];
  const loadTile: TileLoader = async (src, z, x, y) => {
    calls.push({ src, z, x, y });
    return answer({ src, z, x, y });
  };
  return { calls, loadTile };
}

const noLook = async () => null;

/** Expected tiles, worked out separately: points every 5 m via lng/lat, a square of reach around each. */
function expectedTiles(lines: Vec2[][], reach: number, z: number): Set<string> {
  const r = reach / proj.metresPerPixel(z);
  const out = new Set<string>();
  const add = (p: Vec2) => {
    const [gx, gy] = lngLatToPixel(proj.toLngLat(p), z);
    for (let ty = Math.floor((gy - r) / 256); ty <= Math.floor((gy + r) / 256); ty++) {
      for (let tx = Math.floor((gx - r) / 256); tx <= Math.floor((gx + r) / 256); tx++) out.add(`${tx},${ty}`);
    }
  };
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [a, b] = [line[i], line[i + 1]];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 5));
      for (let k = 0; k < n; k++) add([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    add(line[line.length - 1]);
  }
  return out;
}

/** Local point at the centre of global pixel (px, py). */
const centre = (px: number, py: number, z = 20) => proj.pixelToLocal([px + 0.5, py + 0.5], z);

describe("route raster", () => {
  it("asks for exactly the tiles within reach, once each", async () => {
    const { calls, loadTile } = recorder();
    const line: Vec2[] = [[0, 0], [100, 0]];
    await loadRouteRaster(proj, line, 10, ["wa"], 20, undefined, { loadTile, colourBalance: noLook });
    const asked = calls.map((c) => `${c.x},${c.y}`);
    expect(new Set(asked).size).toBe(asked.length);
    expect(new Set(asked)).toEqual(expectedTiles([line], 10, 20));
    expect(calls.every((c) => c.z === 20 && c.src === "wa")).toBe(true);
  });

  it("takes several lines, and one line wrapped or not", async () => {
    const a: Vec2[] = [[0, 0], [60, 0]], b: Vec2[] = [[0, 300], [0, 360]];
    const both = recorder(), single = recorder(), wrapped = recorder();
    await loadRouteRaster(proj, [a, b], 10, ["wa"], 20, undefined, { loadTile: both.loadTile, colourBalance: noLook });
    await loadRouteRaster(proj, a, 10, ["wa"], 20, undefined, { loadTile: single.loadTile, colourBalance: noLook });
    await loadRouteRaster(proj, [a], 10, ["wa"], 20, undefined, { loadTile: wrapped.loadTile, colourBalance: noLook });
    const keys = (r: { calls: Call[] }) => new Set(r.calls.map((c) => `${c.x},${c.y}`));
    expect(keys(both)).toEqual(expectedTiles([a, b], 10, 20));
    expect(keys(single)).toEqual(keys(wrapped));
    expect(keys(single)).toEqual(expectedTiles([a], 10, 20));
  });

  it("skips (and warns) when more than 4000 tiles are needed", async () => {
    const { calls, loadTile } = recorder();
    const warnings: string[] = [];
    const r = await loadRouteRaster(proj, [[0, 0], [10000, 0]], 500, ["wa"], 20, undefined, {
      loadTile, colourBalance: noLook, warn: (m) => warnings.push(m),
    });
    expect(r).toBeNull();
    expect(calls).toHaveLength(0);
    expect(warnings[0]).toMatch(/aerial trace skipped: \d+ tiles/);
  });

  it("uses the lower of maxZoom and the first source's limit", async () => {
    const a = recorder();
    await loadRouteRaster(proj, [[0, 0], [20, 0]], 5, ["wa", "esri"], 19, undefined, { loadTile: a.loadTile, colourBalance: noLook });
    expect(a.calls.every((c) => c.z === 19 && c.src === "wa")).toBe(true);
    const b = recorder();
    await loadRouteRaster(proj, [[0, 0], [20, 0]], 5, ["esri"], 20, undefined, { loadTile: b.loadTile, colourBalance: noLook });
    expect(b.calls.every((c) => c.z === 19 && c.src === "esri")).toBe(true);
  });

  it("falls back to the next source, using the right quadrant of a coarser parent", async () => {
    // wa has only tiles with odd x + y; esri (max z19) paints each quadrant of its tiles differently.
    const { calls, loadTile } = recorder((c) => {
      if (c.src === "wa") return (c.x + c.y) % 2 ? paint(c.x, c.y, () => [10, 20, 30]) : null;
      return paint(c.x, c.y, (gx, gy) => {
        const qx = gx % 256 < 128 ? 0 : 1, qy = gy % 256 < 128 ? 0 : 1;
        return [100 + qx * 100, 50 + qy * 100, 5];
      });
    });
    const line: Vec2[] = [[0, 0], [80, 40]];
    const r = (await loadRouteRaster(proj, line, 10, ["wa", "esri"], 20, undefined, { loadTile, colourBalance: noLook }))!;
    expect(r).not.toBeNull();
    const need = expectedTiles([line], 10, 20);
    for (const key of need) {
      const [tx, ty] = key.split(",").map(Number);
      const s = r(...centre(tx * 256 + 128, ty * 256 + 128))!;
      if ((tx + ty) % 2) {
        expect(s.map((v) => Math.round(v * 255))).toEqual([10, 20, 30]);
      } else {
        expect(calls).toContainEqual({ src: "esri", z: 19, x: tx >> 1, y: ty >> 1 });
        expect(s.map((v) => Math.round(v * 255))).toEqual([100 + (tx & 1) * 100, 50 + (ty & 1) * 100, 5]);
      }
    }
  });

  it("samples bilinearly between pixel centres, y north", async () => {
    const { loadTile } = recorder();
    const r = (await loadRouteRaster(proj, [[0, 0], [30, 0]], 10, ["wa"], 20, undefined, { loadTile, colourBalance: noLook }))!;
    const [ox, oy] = lngLatToPixel(proj.origin, 20);
    const px = Math.floor(ox) + 3, py = Math.floor(oy) + 2;
    const at = r(...centre(px, py))!;
    expect(at[0] * 255).toBeCloseTo(px % 256, 6);
    expect(at[1] * 255).toBeCloseTo(py % 256, 6);
    expect(at[2] * 255).toBeCloseTo(77, 6);
    // halfway between this pixel and the one to its right
    const [hx, hy] = proj.pixelToLocal([px + 1, py + 0.5], 20);
    const half = r(hx, hy)!;
    if ((px + 1) % 256) expect(half[0] * 255).toBeCloseTo((px % 256) + 0.5, 6);
    // one pixel north is the row above
    const mpp = proj.metresPerPixel(20);
    const [cx, cy] = centre(px, py);
    const north = r(cx, cy + mpp)!;
    expect(north[1] * 255).toBeCloseTo((((py - 1) % 256) + 256) % 256, 6);
  });

  it("returns null over missing tiles, and no sampler when nothing loaded", async () => {
    const { loadTile } = recorder();
    const r = (await loadRouteRaster(proj, [[0, 0], [30, 0]], 10, ["wa"], 20, undefined, { loadTile, colourBalance: noLook }))!;
    expect(r(0, 0)).not.toBeNull();
    expect(r(0, 2000)).toBeNull();
    const none = recorder(() => null);
    expect(await loadRouteRaster(proj, [[0, 0], [30, 0]], 10, ["wa", "esri"], 20, undefined, { loadTile: none.loadTile, colourBalance: noLook })).toBeNull();
    const throwing: TileLoader = async () => {
      throw new Error("gone");
    };
    expect(await loadRouteRaster(proj, [[0, 0], [30, 0]], 10, ["wa"], 20, undefined, { loadTile: throwing, colourBalance: noLook })).toBeNull();
  });

  it("adds a display sampler only when a tile has a colour transform", async () => {
    const line: Vec2[] = [[0, 0], [400, 0]];
    const plain = recorder();
    const r0 = (await loadRouteRaster(proj, line, 10, ["wa"], 20, undefined, { loadTile: plain.loadTile, colourBalance: noLook }))!;
    expect(r0.display).toBeUndefined();

    const [ox, oy] = lngLatToPixel(proj.origin, 20);
    const z18 = [Math.floor(ox / 1024), Math.floor(oy / 1024)];
    const looks: string[] = [];
    const look = async (_src: ImagerySource, z: number, x: number, y: number): Promise<ColourTransform | null> => {
      looks.push(`${z}/${x},${y}`);
      return x === z18[0] && y === z18[1] ? { gain: [2, 1, 1], offset: [0, 0, 0] } : null;
    };
    const tinted = recorder();
    const r = (await loadRouteRaster(proj, line, 10, ["wa"], 20, undefined, { loadTile: tinted.loadTile, colourBalance: look }))!;
    expect(looks.every((k) => k.startsWith("18/"))).toBe(true);
    expect(r.display).toBeDefined();
    const px = Math.floor(ox), py = Math.floor(oy);
    const here = centre(px, py);
    expect(r(...here)![0] * 255).toBeCloseTo(px % 256, 6);
    expect(r.display!(...here)![0] * 255).toBeCloseTo(Math.min(255, 2 * (px % 256)), 6);
    // a tile in another z18 tile: display equals raw
    const far = centre((z18[0] + 1) * 1024 + 100, py);
    expect(r(...far)).not.toBeNull();
    expect(r.display!(...far)).toEqual(r(...far));
  });

  it("reports progress once per tile, ending at (total, total)", async () => {
    const { calls, loadTile } = recorder((c) => (c.x % 3 ? paint(c.x, c.y, gradient) : null));
    const seen: [number, number][] = [];
    await loadRouteRaster(proj, [[0, 0], [100, 30]], 10, ["wa"], 20, (d, t) => seen.push([d, t]), { loadTile, colourBalance: noLook });
    expect(seen).toHaveLength(calls.length);
    expect(seen[seen.length - 1]).toEqual([calls.length, calls.length]);
  });

  it("gives the same samples whatever order the tiles arrive in", async () => {
    const line: Vec2[] = [[0, 0], [90, 60]];
    const inOrder = recorder();
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const shuffled: TileLoader = (_src, _z, x, y) =>
      new Promise((ok) => setTimeout(() => ok(paint(x, y, gradient)), Math.floor(rand() * 15)));
    const a = (await loadRouteRaster(proj, line, 10, ["wa"], 20, undefined, { loadTile: inOrder.loadTile, colourBalance: noLook }))!;
    const b = (await loadRouteRaster(proj, line, 10, ["wa"], 20, undefined, { loadTile: shuffled, colourBalance: noLook }))!;
    for (let i = 0; i <= 20; i++) {
      const p: Vec2 = [i * 4.5, i * 3 + 0.37];
      expect(b(...p)).toEqual(a(...p));
    }
  });
});
