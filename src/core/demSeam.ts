// Busselton fork: where a state bare-earth model (WA's 5 m LiDAR) ends and the global heights take
// over. Retest 3 drove into a "deep cutting" on Cape Naturaliste Road at 15%: exactly where the WA
// tiles stop (about 115.089, -33.5955). Two things made it:
//   - The model's last 25 m or so falls away (39, 42, 52, then the true 56 m), a band all along the
//     edge of the mosaic: the road dipped 8 m into it.
//   - The global heights beyond (about 30 m cells, partly a surface model over the heath and
//     peppermint) sit some 15 m above the LiDAR there, so the road then climbed 19 m in 30 m and the
//     ground beside it stood up as smeared walls.
// So: the model's edge band is dropped, and the global heights are shifted to meet the model at the
// seam, the shift fading out over FADE metres, so the two join without a step.
//
// Works on the model's tiles (256 x 256, NaN where it has no data) in a coarse grid of about CELL
// metres, so the offsets stay cheap for 200 tiles at z16.

import { distanceField } from "./photoSea";

const TILE = 256;
/** The model's edge band dropped, metres. */
export const EDGE = 30;
/** The global heights' shift fades to nothing this far from the seam, metres. */
export const FADE = 400;
/** Coarse grid cell, about this many metres. */
const CELL = 8;
/** Global heights above this (metres) beyond the model's edge mean land, not the sea. */
const INLAND = 2;

export interface SeamTile { x: number; y: number; heights: Float32Array }

const usable = (h: number) => Number.isFinite(h);

/**
 * Fills every NaN in the tiles (in place) from `fallback(gx, gy)` (global pixel position of the
 * pixel's centre at this zoom), after dropping the model's last EDGE metres and shifting the
 * fallback to meet the model at the seam. `mpp`: metres per pixel. Returns how many model pixels
 * were dropped.
 */
export function blendSeam(tiles: SeamTile[], fallback: (gx: number, gy: number) => number, mpp: number, opts: { edge?: number; fade?: number } = {}): number {
  if (!tiles.length) return 0;
  const edge = opts.edge ?? EDGE, fade = opts.fade ?? FADE;
  const x0 = Math.min(...tiles.map((t) => t.x)), y0 = Math.min(...tiles.map((t) => t.y));
  const nx = Math.max(...tiles.map((t) => t.x)) - x0 + 1, ny = Math.max(...tiles.map((t) => t.y)) - y0 + 1;
  const f = Math.max(1, Math.round(CELL / mpp)); // pixels per coarse cell
  const cm = f * mpp; // metres per coarse cell
  const cw = Math.ceil((nx * TILE) / f), ch = Math.ceil((ny * TILE) / f);
  const grid: (SeamTile | undefined)[] = new Array(nx * ny);
  for (const t of tiles) grid[(t.y - y0) * nx + (t.x - x0)] = t;
  const tileAt = (px: number, py: number) => grid[Math.floor(py / TILE) * nx + Math.floor(px / TILE)];
  const at = (px: number, py: number) => {
    const t = tileAt(px, py);
    return t ? t.heights[(py % TILE) * TILE + (px % TILE)] : NaN;
  };
  const set = (px: number, py: number, v: number) => {
    const t = tileAt(px, py);
    if (t) t.heights[(py % TILE) * TILE + (px % TILE)] = v;
  };
  const W = nx * TILE, H = ny * TILE;
  // Coarse cells wholly covered by the model.
  const covered = new Uint8Array(cw * ch), any = new Uint8Array(cw * ch);
  const sumModel = new Float32Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    let n = 0, total = 0, s = 0;
    for (let py = cy * f; py < Math.min(H, (cy + 1) * f); py++) for (let px = cx * f; px < Math.min(W, (cx + 1) * f); px++) {
      total++;
      const h = at(px, py);
      if (usable(h)) { n++; s += h; }
    }
    const i = cy * cw + cx;
    if (n) any[i] = 1;
    if (n === total) { covered[i] = 1; sumModel[i] = s / n; }
  }
  if (!any.some((v) => v)) {
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) if (!usable(at(px, py))) set(px, py, fallback(x0 * TILE + px, y0 * TILE + py));
    return 0;
  }
  // Only seams inland count: where the model stops at the sea (no data over the water, the global
  // heights about 0 there) nothing changes, so the coast keeps its LiDAR beach.
  const gap = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const i = cy * cw + cx;
    if (!covered[i]) gap[i] = fallback(x0 * TILE + (cx + 0.5) * f, y0 * TILE + (cy + 0.5) * f) > INLAND ? 1 : 0;
  }
  // The core: covered cells more than `edge` in from an inland gap (the grid's own edge doesn't count).
  const dGap = gap.some((v) => v) ? distanceField(gap, cw, ch) : new Float32Array(cw * ch).fill(1e9);
  const core = new Uint8Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) core[i] = covered[i] && dGap[i] * cm > edge ? 1 : 0;
  /** Model cells by an inland gap (within one cell past the band). */
  const inlandRim = (i: number) => dGap[i] * cm <= edge + 2 * cm;
  // Drop the model's pixels outside the core.
  let dropped = 0;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const i = Math.floor(py / f) * cw + Math.floor(px / f);
    if (!core[i] && dGap[i] * cm <= edge && usable(at(px, py))) { set(px, py, NaN); dropped++; }
  }
  // The offset at the seam: model minus fallback in the core's outermost cells, then carried out to
  // every other cell from the nearest seam cell (8-neighbour chamfer that drags the value along).
  const BIG = 1e9;
  const dist = new Float32Array(cw * ch).fill(BIG), off = new Float32Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const i = cy * cw + cx;
    if (!core[i]) continue;
    let rim = false;
    for (let dy = -1; dy <= 1 && !rim; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = cx + dx, yy = cy + dy;
      if (xx >= 0 && yy >= 0 && xx < cw && yy < ch && !core[yy * cw + xx]) { rim = true; break; }
    }
    if (!rim || !inlandRim(i)) continue;
    const gx = x0 * TILE + (cx + 0.5) * f, gy = y0 * TILE + (cy + 0.5) * f;
    dist[i] = 0;
    off[i] = sumModel[i] - fallback(gx, gy);
  }
  const D = Math.SQRT2;
  const relax = (i: number, j: number, step: number) => {
    if (dist[j] + step < dist[i]) { dist[i] = dist[j] + step; off[i] = off[j]; }
  };
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const i = cy * cw + cx;
    if (core[i]) continue;
    if (cx > 0) relax(i, i - 1, 1);
    if (cy > 0) { relax(i, i - cw, 1); if (cx > 0) relax(i, i - cw - 1, D); if (cx < cw - 1) relax(i, i - cw + 1, D); }
  }
  for (let cy = ch - 1; cy >= 0; cy--) for (let cx = cw - 1; cx >= 0; cx--) {
    const i = cy * cw + cx;
    if (core[i]) continue;
    if (cx < cw - 1) relax(i, i + 1, 1);
    if (cy < ch - 1) { relax(i, i + cw, 1); if (cx < cw - 1) relax(i, i + cw + 1, D); if (cx > 0) relax(i, i + cw - 1, D); }
  }
  // The shift per cell, faded with distance, then softened (3 x 3 box, twice) so neighbouring seam
  // cells' offsets don't leave creases.
  let shift = new Float32Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) shift[i] = dist[i] >= BIG ? 0 : off[i] * Math.max(0, 1 - (dist[i] * cm) / fade);
  // Inside the model near an inland seam, its own offset (only the softening below reads it), so the
  // softening doesn't pull the shift toward 0 at the seam.
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const i = cy * cw + cx;
    if (core[i] && dist[i] > 0 && dGap[i] * cm <= edge + 4 * cm) shift[i] = sumModel[i] - fallback(x0 * TILE + (cx + 0.5) * f, y0 * TILE + (cy + 0.5) * f);
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(cw * ch);
    for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx, yy = cy + dy;
        if (xx < 0 || yy < 0 || xx >= cw || yy >= ch) continue;
        s += shift[yy * cw + xx]; n++;
      }
      next[cy * cw + cx] = s / n;
    }
    shift = next;
  }
  // Fill: the fallback plus the shift, bilinear between coarse cell centres.
  const shiftAt = (px: number, py: number) => {
    const fx = Math.max(0, Math.min(cw - 1, (px + 0.5) / f - 0.5)), fy = Math.max(0, Math.min(ch - 1, (py + 0.5) / f - 0.5));
    const ix = Math.min(cw - 2, Math.floor(fx)), iy = Math.min(ch - 2, Math.floor(fy));
    if (cw < 2 || ch < 2) return shift[0];
    const tx = fx - ix, ty = fy - iy;
    const a = shift[iy * cw + ix], b = shift[iy * cw + ix + 1], c = shift[(iy + 1) * cw + ix], d = shift[(iy + 1) * cw + ix + 1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    if (usable(at(px, py)) || !tileAt(px, py)) continue;
    set(px, py, fallback(x0 * TILE + px, y0 * TILE + py) + shiftAt(px, py));
  }
  return dropped;
}
