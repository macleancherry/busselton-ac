// Heights from the WA DEM tiles served with the app (public/dem/wa/<z>/<x>/<y>.png, Terrarium PNG,
// scripts/dem/make_wa_tiles.py), read from disk for scripts that run without the browser build.
// The tiles cover Busselton, Vasse and west to just past Dunsborough; outside them there are none.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { LngLat } from "../../src/core/geo";
import { decodeTerrarium } from "../../src/services/tiles";

const tileXY = ([lng, lat]: LngLat, z: number): [number, number] => {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return [((lng + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
};

/**
 * A height lookup over the tiles around `points` (loaded up front, so the lookup is synchronous):
 * metres at [lng, lat], bilinear between pixel centres, or null where there's no tile or no data.
 */
export async function demTiles(dir: string, points: LngLat[], z = 15): Promise<(p: LngLat) => number | null> {
  const tiles = new Map<string, Float32Array | null>();
  for (const p of points) {
    const [tx, ty] = tileXY(p, z).map(Math.floor);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const key = `${tx + dx},${ty + dy}`;
        if (tiles.has(key)) continue;
        const file = join(dir, String(z), String(tx + dx), `${ty + dy}.png`);
        if (!existsSync(file)) { tiles.set(key, null); continue; }
        const img = await loadImage(readFileSync(file));
        const c = createCanvas(256, 256), ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        tiles.set(key, decodeTerrarium(ctx.getImageData(0, 0, 256, 256).data));
      }
    }
  }
  const px = (gx: number, gy: number): number => {
    const t = tiles.get(`${Math.floor(gx / 256)},${Math.floor(gy / 256)}`);
    return t ? t[(((gy % 256) + 256) % 256) * 256 + (((gx % 256) + 256) % 256)] : NaN;
  };
  return (p) => {
    const [fx, fy] = tileXY(p, z);
    const gx = fx * 256 - 0.5, gy = fy * 256 - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), u = gx - x0, v = gy - y0;
    const h = (1 - u) * (1 - v) * px(x0, y0) + u * (1 - v) * px(x0 + 1, y0) + (1 - u) * v * px(x0, y0 + 1) + u * v * px(x0 + 1, y0 + 1);
    return Number.isFinite(h) ? h : null;
  };
}
