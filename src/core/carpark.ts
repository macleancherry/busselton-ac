// Car parks, from the aerial photo: parked cars painted out of the ground. The photo is the
// terrain's texture, so every car parked when it was flown sits flat on the ground like a sticker.
// A car is a compact blob, a few square metres, of anything that isn't asphalt (paint, glass,
// shadow) with asphalt all round it; it's replaced with the asphalt around it. Line marking
// survives: it's thinner than any car.

import type { Vec2 } from "./geo";
import type { TerrainChunk } from "./terrain";

/** Grey, mid-dark: asphalt in the photo (0..1 channels). */
export function isAsphalt(r: number, g: number, b: number): boolean {
  const l = (r + g + b) / 3, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  // Not green: dark tree canopy is greyish too, but leans further green than
  // the aerial survey's slight cyan cast does on asphalt.
  return l > 0.16 && l < 0.55 && (mx - mn) / (mx || 1) < 0.14 && g - Math.max(r, b) < 0.035;
}

/** Local standard deviation of brightness: asphalt is smooth, tree canopy is busy. */
function roughness(rgba: Uint8Array | Uint8ClampedArray, size: number, r: number): Float32Array {
  const n = size * size, l = new Float32Array(n), l2 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 765;
    l[i] = v;
    l2[i] = v * v;
  }
  const m = boxMean(l, size, r), m2 = boxMean(l2, size, r);
  return m.map((v, i) => Math.sqrt(Math.max(0, m2[i] - v * v)));
}

/** Mean of `v` over a (2r+1) square around each pixel, by summed-area table. */
function boxMean(v: Float32Array, size: number, r: number): Float32Array {
  const S = new Float64Array((size + 1) * (size + 1));
  for (let y = 0; y < size; y++) {
    let row = 0;
    for (let x = 0; x < size; x++) {
      row += v[y * size + x];
      S[(y + 1) * (size + 1) + x + 1] = S[y * (size + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(size, y + r + 1);
    for (let x = 0; x < size; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(size, x + r + 1);
      const sum = S[y1 * (size + 1) + x1] - S[y0 * (size + 1) + x1] - S[y1 * (size + 1) + x0] + S[y0 * (size + 1) + x0];
      out[y * size + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/** Connected components (4-neighbour) of `mask`, each as a list of pixel indices. */
function components(mask: Uint8Array, size: number, maxPixels: number): number[][] {
  const seen = new Uint8Array(size * size);
  const out: number[][] = [];
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const comp: number[] = [];
    seen[s] = 1;
    stack.push(s);
    let big = false;
    while (stack.length) {
      const i = stack.pop()!;
      if (comp.length < maxPixels) comp.push(i);
      else big = true;
      const x = i % size, y = (i / size) | 0;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < size - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && mask[i - size] && !seen[i - size]) { seen[i - size] = 1; stack.push(i - size); }
      if (y < size - 1 && mask[i + size] && !seen[i + size]) { seen[i + size] = 1; stack.push(i + size); }
    }
    if (!big) out.push(comp);
  }
  return out;
}

/**
 * A parked car found in the photo: centre in pixels, which way it points (unit, image axes: y down),
 * and its colour (0-1). `row` says how its blob was split: "end" (one of several end to end along a
 * kerb), "nose" (one of a row side by side), or left out for a blob of one car. The direction of a
 * car split out of a row is a guess from the blob's shape; placement (parkedPlacement.ts) trusts the
 * mapped aisle or street over it.
 */
export interface CarSpot {
  px: number;
  py: number;
  dir: [number, number];
  rgb: [number, number, number];
  row?: "end" | "nose";
}

/** A blob's principal frame: centre, long axis `ax`, cross axis `bx`, extents (pixels) and size (metres). */
export interface BlobFrame {
  mx: number;
  my: number;
  ax: [number, number];
  bx: [number, number];
  u0: number; u1: number; v0: number; v1: number;
  L: number;
  W: number;
}

export function blobFrame(comp: number[], size: number, mpp: number): BlobFrame {
  let mx = 0, my = 0;
  for (const i of comp) { mx += i % size; my += (i / size) | 0; }
  mx /= comp.length; my /= comp.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const i of comp) {
    const dx = (i % size) - mx, dy = ((i / size) | 0) - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ax: [number, number] = [Math.cos(th), Math.sin(th)], bx: [number, number] = [-ax[1], ax[0]];
  const us: number[] = [], vs: number[] = [];
  for (const i of comp) {
    const dx = (i % size) - mx, dy = ((i / size) | 0) - my;
    us.push(dx * ax[0] + dy * ax[1]);
    vs.push(dx * bx[0] + dy * bx[1]);
  }
  const span = (a: number[]) => {
    a.sort((p, q) => p - q);
    return [a[Math.floor(a.length * 0.02)], a[Math.floor(a.length * 0.98)]];
  };
  const [u0, u1] = span(us), [v0, v1] = span(vs);
  return { mx, my, ax, bx, u0, u1, v0, v1, L: (u1 - u0 + 1) * mpp, W: (v1 - v0 + 1) * mpp };
}

/** What tells a strip from a row of cars: length (m), pale fraction, narrow gaps along it, and how much its brightness varies along it. */
export function stripStats(comp: number[], size: number, mpp: number, rgba: Uint8Array | Uint8ClampedArray, f: BlobFrame = blobFrame(comp, size, mpp)) {
  let pale = 0;
  // Brightness along the long axis, in 1 m bins: how much it changes from one car-length to the next.
  const bin = Math.max(1, Math.round(1 / mpp));
  const nb = Math.ceil((f.u1 - f.u0 + 1) / bin) + 1;
  const sum = new Float64Array(nb), cnt = new Float64Array(nb);
  for (const i of comp) {
    const r = rgba[i * 4] / 255, g = rgba[i * 4 + 1] / 255, b = rgba[i * 4 + 2] / 255;
    const l = (r + g + b) / 3, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (l > 0.55 && (mx - mn) / (mx || 1) < 0.15) pale++;
    const u = ((i % size) - f.mx) * f.ax[0] + (((i / size) | 0) - f.my) * f.ax[1];
    const k = Math.max(0, Math.min(nb - 1, Math.floor((u - f.u0) / bin)));
    sum[k] += l;
    cnt[k]++;
  }
  const full: number[] = [], means: number[] = [];
  for (let k = 0; k < nb; k++) if (cnt[k]) { full.push(cnt[k]); means.push(sum[k] / cnt[k]); }
  const sorted = full.slice().sort((x, y) => x - y), med = sorted[sorted.length >> 1] ?? 0;
  // (The end bins are part-filled by the blob's ragged ends: not gaps.)
  const gaps = full.slice(1, -1).filter((c) => c < 0.45 * med).length;
  const m = means.reduce((x, v) => x + v, 0) / (means.length || 1);
  const sd = Math.sqrt(means.reduce((x, v) => x + (v - m) ** 2, 0) / (means.length || 1));
  return { L: f.L, W: f.W, pale: pale / comp.length, gaps, sd };
}

/**
 * A long strip that isn't cars: a footpath, kerb or fence line beside a street. Longer than two cars
 * end to end (12 m), narrow (cars side by side make a row 4 m or more across), and even along its
 * length: a row of parked cars changes brightness from car to car (white, silver, dark) and narrows
 * at the gaps between them, where a footpath or a kerb shadow stays the same all along.
 */
export function isStrip(comp: number[], size: number, mpp: number, rgba: Uint8Array | Uint8ClampedArray, f: BlobFrame = blobFrame(comp, size, mpp)): boolean {
  if (f.L < 12) return false;
  const st = stripStats(comp, size, mpp, rgba, f);
  return st.gaps === 0 && st.sd < (st.pale > 0.6 ? 0.08 : 0.05);
}

/**
 * The cars in one painted-out blob: a single car, a row parked end to end along a kerb, or a row
 * (or two back to back) parked nose-in across a car park. The blob's long axis says which: a blob
 * under 3 m wide is cars end to end, 3 to 6.5 m one row of bays, wider two.
 */
export function carsInBlob(comp: number[], size: number, mpp: number, rgba: Uint8Array | Uint8ClampedArray): CarSpot[] {
  if (comp.length < 4) return [];
  const { mx, my, ax, bx, u0, u1, v0, v1, L, W } = blobFrame(comp, size, mpp);
  if (W < 1.2) return [];
  const inBlob = new Set(comp);
  const out: CarSpot[] = [];
  const place = (u: number, v: number, dir: [number, number], row?: "end" | "nose") => {
    const px = mx + ax[0] * u + bx[0] * v, py = my + ax[1] * u + bx[1] * v;
    const c = Math.round(py) * size + Math.round(px);
    if (!inBlob.has(c)) return;
    // Colour: the blob's pixels within a metre.
    const r = Math.max(1, Math.round(1 / mpp));
    let sr = 0, sg = 0, sb = 0, k = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const j = (Math.round(py) + dy) * size + Math.round(px) + dx;
        if (!inBlob.has(j)) continue;
        sr += rgba[j * 4]; sg += rgba[j * 4 + 1]; sb += rgba[j * 4 + 2]; k++;
      }
    }
    out.push({ px, py, dir, rgb: [sr / k / 255, sg / k / 255, sb / k / 255], ...(row ? { row } : {}) });
  };
  const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  if (W <= 3) {
    // End to end along the long axis (or one car).
    const n = Math.max(1, Math.round(L / 5.6));
    for (let k = 0; k < n; k++) place(um + ((k + 0.5) / n - 0.5) * (u1 - u0), vm, ax, n > 1 ? "end" : undefined);
  } else {
    // Nose-in bays across the long axis, one row or two back to back.
    const n = Math.max(1, Math.round(L / 2.6));
    const rows = W > 6.5 ? [vm - (v1 - v0) / 4, vm + (v1 - v0) / 4] : [vm];
    for (const v of rows) for (let k = 0; k < n; k++) place(um + ((k + 0.5) / n - 0.5) * (u1 - u0), v, bx, n > 1 || rows.length > 1 ? "nose" : undefined);
  }
  return out;
}

/**
 * The photo with parked cars replaced by the asphalt around them. `mpp` is
 * metres per pixel. Returns the cleaned RGBA and how many cars went.
 */
export function paintOutCars(
  rgba: Uint8Array | Uint8ClampedArray, size: number, mpp: number, keepOut?: Uint8Array,
  extra: {
    /** For tuning: told why each candidate blob was left alone (blob centre in pixels). */
    why?: (x: number, y: number, reason: string) => void;
    /** Where the second pass may look (near mapped car-park aisles). Everywhere when left out. */
    carParks?: Uint8Array;
    /** Where any car may be (near mapped streets): bright gaps in forest canopy are not cars. Everywhere when left out. */
    streets?: Uint8Array;
  } = {},
): { rgba: Uint8Array; cars: number; spots: CarSpot[] } {
  const { why, carParks, streets } = extra;
  const n = size * size;
  const asph = new Float32Array(n);
  const cr = new Float32Array(n), cg = new Float32Array(n), cb = new Float32Array(n);
  const rough = roughness(rgba, size, Math.max(1, Math.round(0.6 / mpp)));
  const smoothAsph = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4] / 255, g = rgba[i * 4 + 1] / 255, b = rgba[i * 4 + 2] / 255;
    if (isAsphalt(r, g, b)) asph[i] = 1;
    // The neighbourhood count and colour come from smooth asphalt only, so a
    // sunlit gap in grey-green tree canopy doesn't read as a car on a road.
    if (asph[i] && rough[i] < 0.06) {
      smoothAsph[i] = 1;
      cr[i] = r;
      cg[i] = g;
      cb[i] = b;
    }
  }
  // How much of the neighbourhood is asphalt (about 6 m round: a car in a
  // full row still has the aisle in reach), and the asphalt's colour.
  const R = Math.max(2, Math.round(6 / mpp));
  const frac = boxMean(smoothAsph, size, R);
  const mr = boxMean(cr, size, R), mg = boxMean(cg, size, R), mb = boxMean(cb, size, R);
  // Line marking: bright, grey-white and thin (in a metre's window, mostly not bright), where a
  // white car is bright right across. Bay lines aren't cars: they stay out of the blobs (so a car
  // doesn't join up with the lines either side of it), count as asphalt round a car, and are kept
  // when a car is painted out.
  const bright = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4] / 255, g = rgba[i * 4 + 1] / 255, b = rgba[i * 4 + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if ((r + g + b) / 3 > 0.6 && (mx - mn) / (mx || 1) < 0.2) bright[i] = 1;
  }
  const brightNear = boxMean(bright, size, Math.max(2, Math.round(0.5 / mpp)));
  const paint = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (bright[i] && brightNear[i] < 0.38 && frac[i] > 0.15) paint[i] = 1;
  const road = (i: number) => asph[i] === 1 || paint[i] === 1;
  const cand = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (asph[i] || paint[i] || frac[i] <= 0.15) continue;
    // Cars aren't grass, gardens, red brick paving or buildings: leave those alone.
    const r = rgba[i * 4] / 255, g = rgba[i * 4 + 1] / 255, b = rgba[i * 4 + 2] / 255;
    if (isPlanted(r, g, b) || (r > g * 1.15 && r > b * 1.3) || keepOut?.[i] || (streets && !streets[i])) continue;
    cand[i] = 1;
  }
  // Rows of parked cars touch (shadows join them), so a blob can be a whole
  // row, or two rows nose to nose. What sets them apart: a car is wider than
  // paint (a 1.2 m square fits inside it), a double row is narrower than a
  // building (an 11 m square doesn't fit), and a row of cars is many colours
  // where a roof is one.
  const minPx = 2.5 / (mpp * mpp), maxPx = 3000 / (mpp * mpp);
  const candF = Float32Array.from(cand);
  const thick = boxMean(candF, size, Math.round(5.5 / mpp));
  const solid = boxMean(candF, size, Math.max(1, Math.round(0.6 / mpp)));
  // A roof or awning: a pale, even patch wider than any car (a 3 m square of it).
  const pale = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if ((r + g + b) / 765 > 0.6 && (mx - mn) / (mx || 1) < 0.12) pale[i] = 1;
  }
  const roofy = boxMean(pale, size, Math.round(1.5 / mpp));
  const out = new Uint8Array(rgba);
  let cars = 0;
  const spots: CarSpot[] = [];
  for (const comp of components(cand, size, Math.ceil(maxPx) + 1)) {
    if (comp.length < minPx || comp.length > maxPx) continue;
    let x0 = size, x1 = 0, y0 = size, y1 = 0;
    for (const i of comp) {
      const x = i % size, y = (i / size) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const w = (x1 - x0 + 1) * mpp, h = (y1 - y0 + 1) * mpp;
    // Not a thin line (paint), and nowhere thicker than a car is long.
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const no = (r: string) => why?.(cx, cy, r);
    if (Math.min(w, h) < 1.2 || !comp.some((i) => solid[i] > 0.9)) { no("thin"); continue; }
    if (comp.some((i) => thick[i] > 0.97)) { no("thick"); continue; }
    if (comp.some((i) => roofy[i] > 0.95)) { no("roofy"); continue; }
    if (comp.length * mpp * mpp > 15) {
      let m = 0, m2 = 0;
      for (const i of comp) {
        const v = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 765;
        m += v;
        m2 += v * v;
      }
      m /= comp.length;
      if (Math.sqrt(Math.max(0, m2 / comp.length - m * m)) < 0.09) { no("even"); continue; }
    }
    // Asphalt all round: a blob that runs into something else (a garden, a kerb, a building) isn't a parked car.
    let edge = 0, foreign = 0;
    for (const i of comp) {
      const x = i % size, y = (i / size) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, y > 0 ? i - size : -1, y < size - 1 ? i + size : -1]) {
        if (j < 0 || cand[j]) continue;
        edge++;
        if (!road(j)) foreign++;
      }
    }
    if (foreign > 0.45 * edge) { no(`foreign ${(foreign / edge).toFixed(2)}`); continue; }
    // ...and smooth asphalt at that: a sunlit gap in tree canopy has busy, grey-green canopy round it.
    const pad0 = Math.round(0.8 / mpp), pad1 = Math.round(2 / mpp);
    let ringN = 0, smooth = 0;
    for (let yy = Math.max(0, y0 - pad1); yy <= Math.min(size - 1, y1 + pad1); yy += 2) {
      for (let xx = Math.max(0, x0 - pad1); xx <= Math.min(size - 1, x1 + pad1); xx += 2) {
        if (xx > x0 - pad0 && xx < x1 + pad0 && yy > y0 - pad0 && yy < y1 + pad0) continue;
        const j = yy * size + xx;
        ringN++;
        if ((asph[j] && rough[j] < 0.05) || paint[j]) smooth++;
      }
    }
    if (smooth < 0.4 * ringN) { no(`ring ${(smooth / ringN).toFixed(2)}`); continue; }
    // A footpath or kerb line beside a street, not a row of cars (and not painted out of the photo):
    // even all along, or longer than 25 m away from any car park (a row of ten cars side by side
    // happens in a car park; along a street the gaps between parked cars break a row up).
    const f0 = blobFrame(comp, size, mpp);
    const middle = Math.round(f0.my) * size + Math.round(f0.mx);
    if (isStrip(comp, size, mpp, rgba, f0) || (f0.L > 25 && carParks && !carParks[middle])) { no("strip"); continue; }
    cars++;
    spots.push(...carsInBlob(comp, size, mpp, rgba));
    // Paint out the blob and a pixel round it (shadow edges, antialiasing).
    const grow = Math.max(1, Math.round(0.45 / mpp));
    const done = new Set<number>();
    for (const i of comp) {
      const x = i % size, y = (i / size) | 0;
      for (let dy = -grow; dy <= grow; dy++) {
        for (let dx = -grow; dx <= grow; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          const j = yy * size + xx;
          if (done.has(j) || paint[j]) continue;
          done.add(j);
          const f = frac[j] || 1;
          const noise = ((j * 2654435761) >>> 0) % 13 - 6;
          out[j * 4] = Math.min(255, Math.max(0, (mr[j] / f) * 255 + noise));
          out[j * 4 + 1] = Math.min(255, Math.max(0, (mg[j] / f) * 255 + noise));
          out[j * 4 + 2] = Math.min(255, Math.max(0, (mb[j] / f) * 255 + noise));
        }
      }
    }
  }
  cars += secondPass();
  return { rgba: out, cars, spots };

  /**
   * Inside car parks proper (mostly smooth asphalt within 6 m), anything car-sized that differs
   * from the local asphalt colour: dark cars (which read as asphalt above, so they fall apart
   * into thin pieces) and cars caught between bay lines. Not tree shadows (planting next to
   * them), and only blobs the size and shape of one or two cars.
   */
  function secondPass(): number {
    const c2 = new Uint8Array(n);
    const planted = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = out[i * 4] / 255, g = out[i * 4 + 1] / 255, b = out[i * 4 + 2] / 255;
      if (isPlanted(r, g, b)) planted[i] = 1;
    }
    const plantedNear = boxMean(planted, size, Math.max(2, Math.round(2.5 / mpp)));
    for (let i = 0; i < n; i++) {
      if (frac[i] < 0.35 || paint[i] || planted[i] || keepOut?.[i] || (carParks && !carParks[i]) || (streets && !streets[i])) continue;
      const f = frac[i];
      const ar = mr[i] / f, ag = mg[i] / f, ab = mb[i] / f;
      const r = out[i * 4] / 255, g = out[i * 4 + 1] / 255, b = out[i * 4 + 2] / 255;
      if (Math.hypot(r - ar, g - ag, b - ab) > 0.11) c2[i] = 1;
    }
    // Close small gaps (a windscreen or roof stripe the colour of asphalt splits a car in pieces).
    const near2 = boxMean(Float32Array.from(c2), size, Math.max(1, Math.round(0.4 / mpp)));
    const closed = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (near2[i] > 0.12 && frac[i] >= 0.3 && !paint[i]) closed[i] = 1;
    let found = 0;
    const max2 = 18 / (mpp * mpp);
    for (const comp of components(closed, size, Math.ceil(max2) + 1)) {
      const area = comp.length * mpp * mpp;
      const why2 = (r: string) => why?.(comp[0] % size, (comp[0] / size) | 0, "2:" + r);
      if (area < 3 || area > 18) { if (area >= 1) why2(area < 3 ? "small" : "big"); continue; }
      let x0 = size, x1 = 0, y0 = size, y1 = 0, plantedSum = 0;
      for (const i of comp) {
        const x = i % size, y = (i / size) | 0;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        plantedSum += plantedNear[i];
      }
      const w = (x1 - x0 + 1) * mpp, h = (y1 - y0 + 1) * mpp;
      // One or two cars, any angle: no side over 7 m, and filling a fair part of its box.
      if (Math.max(w, h) > 7 || Math.min(w, h) < 1.3 || comp.length / ((x1 - x0 + 1) * (y1 - y0 + 1)) < 0.3) { why2("shape"); continue; }
      // Tree shadows: planting right beside them.
      if (plantedSum / comp.length > 0.08) { why2("planted"); continue; }
      found++;
      spots.push(...carsInBlob(comp, size, mpp, rgba));
      const grow = Math.max(1, Math.round(0.35 / mpp));
      const done = new Set<number>();
      for (const i of comp) {
        const x = i % size, y = (i / size) | 0;
        for (let dy = -grow; dy <= grow; dy++) {
          for (let dx = -grow; dx <= grow; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
            const j = yy * size + xx;
            if (done.has(j) || paint[j]) continue;
            done.add(j);
            const f = frac[j] || 1;
            const noise = ((j * 2654435761) >>> 0) % 13 - 6;
            out[j * 4] = Math.min(255, Math.max(0, (mr[j] / f) * 255 + noise));
            out[j * 4 + 1] = Math.min(255, Math.max(0, (mg[j] / f) * 255 + noise));
            out[j * 4 + 2] = Math.min(255, Math.max(0, (mb[j] / f) * 255 + noise));
          }
        }
      }
    }
    return found;
  }
}

/** Building footprints (local rings), grown by `pad` metres, as a pixel mask over a chunk's photo. */
/** Pixels within `radius` metres of any of the lines (local metres). */
export function lineMask(lines: Vec2[][], chunk: TerrainChunk, size: number, radius: number): Uint8Array {
  const mask = new Uint8Array(size * size);
  const mpp = (chunk.maxX - chunk.minX) / size, rp = radius / mpp;
  for (const pts of lines) {
    for (let k = 0; k + 1 < pts.length; k++) {
      const ax = (pts[k][0] - chunk.minX) / mpp, ay = (chunk.maxY - pts[k][1]) / mpp;
      const bx = (pts[k + 1][0] - chunk.minX) / mpp, by = (chunk.maxY - pts[k + 1][1]) / mpp;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rp)), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx) + rp));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rp)), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by) + rp));
      if (x0 > x1 || y0 > y1) continue;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      for (let py = y0; py <= y1; py++)
        for (let px = x0; px <= x1; px++) {
          const t = Math.max(0, Math.min(1, ((px + 0.5 - ax) * dx + (py + 0.5 - ay) * dy) / l2));
          if (Math.hypot(px + 0.5 - ax - t * dx, py + 0.5 - ay - t * dy) <= rp) mask[py * size + px] = 1;
        }
    }
  }
  return mask;
}

export function footprintMask(rings: Vec2[][], chunk: TerrainChunk, size: number, pad = 1): Uint8Array {
  const mask = new Uint8Array(size * size);
  const span = chunk.maxX - chunk.minX, mpp = span / size;
  for (const ring of rings) {
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    if (Math.max(...xs) < chunk.minX || Math.min(...xs) > chunk.maxX || Math.max(...ys) < chunk.minY || Math.min(...ys) > chunk.maxY) continue;
    const c: Vec2 = [xs.reduce((a, v) => a + v, 0) / xs.length, ys.reduce((a, v) => a + v, 0) / ys.length];
    // Grow the ring outward from its centroid.
    const grown = ring.map(([x, y]): Vec2 => {
      const d = Math.hypot(x - c[0], y - c[1]) || 1;
      return [x + ((x - c[0]) / d) * pad, y + ((y - c[1]) / d) * pad];
    });
    const py0 = Math.max(0, Math.floor((chunk.maxY - Math.max(...grown.map((p) => p[1]))) / mpp));
    const py1 = Math.min(size - 1, Math.ceil((chunk.maxY - Math.min(...grown.map((p) => p[1]))) / mpp));
    for (let py = py0; py <= py1; py++) {
      const y = chunk.maxY - (py + 0.5) * mpp;
      const xsCross: number[] = [];
      for (let i = 0, j = grown.length - 1; i < grown.length; j = i++) {
        const [xi, yi] = grown[i], [xj, yj] = grown[j];
        if ((yi > y) !== (yj > y)) xsCross.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
      }
      xsCross.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xsCross.length; k += 2) {
        const a = Math.max(0, Math.floor((xsCross[k] - chunk.minX) / mpp)), b = Math.min(size - 1, Math.ceil((xsCross[k + 1] - chunk.minX) / mpp));
        for (let px = a; px <= b; px++) mask[py * size + px] = 1;
      }
    }
  }
  return mask;
}

/** Grass or mulch: green, or brown and not too bright. */
function isPlanted(r: number, g: number, b: number): boolean {
  const l = (r + g + b) / 3;
  return (g > r * 1.02 && g > b * 1.08 && l > 0.08) || (r > b * 1.15 && r - b > 0.05 && l < 0.45 && l > 0.08);
}
