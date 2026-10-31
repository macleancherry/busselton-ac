// Busselton fork: where nothing grows or stands: the sea, rivers and lakes, wetlands, beaches and
// sand, groynes and jetties, and the shore strip between the dune line (the seawall at the back of
// the beach) and the water. Retest 3 found trees standing in the bay and on the sand along the
// foreshore: trees came from canopy-coloured photo pixels (seagrass, wet sand) with only the far
// horizon trees checked against the sea.
//
// One raster mask (2 m cells by default) over the build, with a class per cell, used by every tree
// placement in track.ts and shipped in the zip (extension/shore_mask.png + .ini) so
// scripts/check/shore_check.ts can fail a build with scenery on any of it.

import type { Vec2 } from "./geo";
import { SeaMask, type CoastPolygon } from "./coast";
import { distanceField } from "./photoSea";
import { encodePng } from "./png";

/**
 * Cell classes, in priority order (a cell keeps the first that applies). "mapped" is stamped over
 * the rest afterwards (mark): an OSM-mapped building standing over water (a boatshed, a kiosk on a
 * pier), real, so the shore check lets it stand; nothing grows there either.
 */
export const SHORE_CLASSES = ["", "sea", "water", "wetland", "jetty", "groyne", "beach", "sand", "strip", "mapped"] as const;
export type ShoreClass = Exclude<(typeof SHORE_CLASSES)[number], "">;
const CODE = Object.fromEntries(SHORE_CLASSES.map((c, i) => [c, i])) as Record<(typeof SHORE_CLASSES)[number], number>;

export interface ShoreInput {
  /** The sea (OSM coastline / OpenMapTiles ocean). */
  ocean: CoastPolygon[];
  /** Lakes, rivers, estuaries, ponds (OpenMapTiles water, not ocean or pools). */
  water?: CoastPolygon[];
  /** Wetlands (OpenMapTiles landcover wetland). */
  wetlands?: CoastPolygon[];
  /** Beaches and sand (OpenMapTiles landcover sand: natural=beach and natural=sand). */
  beaches?: CoastPolygon[];
  /** Jetties and piers. */
  piers?: CoastPolygon[];
  /** Groynes and breakwaters (man_made=groyne|breakwater), centrelines. */
  groynes?: Vec2[][];
}

export interface ShoreOptions {
  cell?: number;
  /** Half the width kept clear along a groyne, metres. */
  groyneHalf?: number;
  /** Sand-coloured photo right at the water counts as beach (photoSea's shoreSand): this far from the sea, metres. */
  shoreSand?: number;
  /** The dune line's rocks: kept clear this far round a beach, metres. */
  beachPad?: number;
  /** The strip from the beach to the water: cells within this far of a beach and of the sea. */
  stripReach?: number;
}

export class ShoreMask {
  readonly w: number;
  readonly h: number;
  readonly cells: Uint8Array;

  constructor(input: ShoreInput, readonly x0: number, readonly y0: number, x1: number, y1: number, opts: ShoreOptions = {}, readonly cell = opts.cell ?? 2) {
    this.w = Math.max(1, Math.ceil((x1 - x0) / cell));
    this.h = Math.max(1, Math.ceil((y1 - y0) / cell));
    const n = this.w * this.h;
    this.cells = new Uint8Array(n);
    const raster = (polys: CoastPolygon[] | undefined) => {
      if (!polys?.length) return null;
      const m = new SeaMask(polys, x0, y0, x0 + this.w * cell, y0 + this.h * cell, cell);
      const out = new Uint8Array(n);
      for (let r = 0; r < this.h; r++) for (let c = 0; c < this.w; c++) out[r * this.w + c] = m.has(x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell) ? 1 : 0;
      return out;
    };
    const set = (src: Uint8Array | null, cls: ShoreClass) => {
      if (!src) return;
      for (let i = 0; i < n; i++) if (src[i] && !this.cells[i]) this.cells[i] = CODE[cls];
    };
    const sea = raster(input.ocean);
    set(sea, "sea");
    set(raster(input.water), "water");
    set(raster(input.wetlands), "wetland");
    set(raster(input.piers), "jetty");
    // Groynes: a band round each centreline.
    if (input.groynes?.length) {
      const g = new Uint8Array(n), half = opts.groyneHalf ?? 4;
      for (const line of input.groynes) {
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1], b = line[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (let s = 0; s <= len; s += cell / 2) this.stamp(g, a[0] + ((b[0] - a[0]) * s) / (len || 1), a[1] + ((b[1] - a[1]) * s) / (len || 1), half);
        }
      }
      set(g, "groyne");
    }
    const beach = raster(input.beaches);
    if (beach) {
      // The beach and the seawall rocks along its back.
      const pad = (opts.beachPad ?? 2.5) / cell;
      const d = distanceField(beach, this.w, this.h);
      const padded = new Uint8Array(n);
      for (let i = 0; i < n; i++) padded[i] = d[i] <= pad ? 1 : 0;
      set(padded, "beach");
    }
    if (sea) {
      const dSea = distanceField(sea, this.w, this.h);
      const near = (opts.shoreSand ?? 25) / cell;
      const sand = new Uint8Array(n);
      for (let i = 0; i < n; i++) sand[i] = dSea[i] > 0 && dSea[i] <= near ? 1 : 0;
      set(sand, "sand");
      if (beach) {
        // The strip: from every edge cell of a beach, straight down to the water (always to the
        // neighbour nearest the sea), marking what it crosses, so whatever lies between the sand
        // and the water is caught, and nothing behind the dune line is.
        const reach = (opts.stripReach ?? 60) / cell;
        const strip = new Uint8Array(n);
        const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        for (let i = 0; i < n; i++) {
          if (!beach[i]) continue;
          const r0 = Math.floor(i / this.w), c0 = i % this.w;
          if (!NB.slice(0, 4).some(([dr, dc]) => {
            const rr = r0 + dr, cc = c0 + dc;
            return rr >= 0 && cc >= 0 && rr < this.h && cc < this.w && !beach[rr * this.w + cc];
          })) continue;
          if (dSea[i] > reach) continue;
          let at = i;
          for (let step = 0; step < 2 * reach && !sea[at]; step++) {
            const r = Math.floor(at / this.w), c = at % this.w;
            let best = at;
            for (const [dr, dc] of NB) {
              const rr = r + dr, cc = c + dc;
              if (rr < 0 || cc < 0 || rr >= this.h || cc >= this.w) continue;
              const j = rr * this.w + cc;
              if (dSea[j] < dSea[best]) best = j;
            }
            if (best === at) break;
            at = best;
            if (!beach[at] && !sea[at]) strip[at] = 1;
          }
        }
        set(strip, "strip");
      }
    }
  }

  private stamp(into: Uint8Array, x: number, y: number, radius: number): void {
    const c0 = Math.floor((x - this.x0) / this.cell), r0 = Math.floor((y - this.y0) / this.cell), k = Math.ceil(radius / this.cell);
    for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (r < 0 || c < 0 || r >= this.h || c >= this.w) continue;
      if (Math.hypot(this.x0 + (c + 0.5) * this.cell - x, this.y0 + (r + 0.5) * this.cell - y) <= radius) into[r * this.w + c] = 1;
    }
  }

  /**
   * Stamps a footprint as `cls` over whatever is there: every cell whose middle is inside the ring,
   * and the cells under its corners and its middle (a footprint smaller than a cell still gets one).
   */
  mark(ring: Vec2[], cls: ShoreClass): void {
    if (ring.length < 3) return;
    const code = CODE[cls];
    const setAt = (x: number, y: number) => {
      const c = Math.floor((x - this.x0) / this.cell), r = Math.floor((y - this.y0) / this.cell);
      if (c >= 0 && r >= 0 && c < this.w && r < this.h) this.cells[r * this.w + c] = code;
    };
    let mx = 0, my = 0;
    for (const [x, y] of ring) { setAt(x, y); mx += x; my += y; }
    setAt(mx / ring.length, my / ring.length);
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const c0 = Math.max(0, Math.floor((Math.min(...xs) - this.x0) / this.cell)), c1 = Math.min(this.w - 1, Math.floor((Math.max(...xs) - this.x0) / this.cell));
    const r0 = Math.max(0, Math.floor((Math.min(...ys) - this.y0) / this.cell)), r1 = Math.min(this.h - 1, Math.floor((Math.max(...ys) - this.y0) / this.cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const x = this.x0 + (c + 0.5) * this.cell, y = this.y0 + (r + 0.5) * this.cell;
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) this.cells[r * this.w + c] = code;
    }
  }

  /** The class at a point, or null on clear land (and outside the mask). */
  at(x: number, y: number): ShoreClass | null {
    const c = Math.floor((x - this.x0) / this.cell), r = Math.floor((y - this.y0) / this.cell);
    if (c < 0 || r < 0 || c >= this.w || r >= this.h) return null;
    const v = this.cells[r * this.w + c];
    return v ? (SHORE_CLASSES[v] as ShoreClass) : null;
  }

  /** Nothing stands here. */
  has(x: number, y: number): boolean {
    return this.at(x, y) !== null;
  }

  /** Anything within `radius` (a tree's trunk, a house's corners): checks the centre and a ring of points. */
  hitsAround(x: number, y: number, radius: number): boolean {
    if (this.has(x, y)) return true;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * 2 * Math.PI;
      if (this.has(x + Math.cos(a) * radius, y + Math.sin(a) * radius)) return true;
    }
    return false;
  }

  /**
   * The mask as a greyscale PNG (class code per pixel, row 0 at the top, maxY) and the .ini that
   * places it, for extension/shore_mask.png: pixel (c, r) covers x0 + c*cell, y1 - (r+1)*cell.
   */
  files(): { png: Uint8Array; ini: string } {
    const rgba = new Uint8Array(this.w * this.h * 4);
    for (let r = 0; r < this.h; r++) for (let c = 0; c < this.w; c++) {
      const v = this.cells[r * this.w + c], o = ((this.h - 1 - r) * this.w + c) * 4;
      rgba[o] = rgba[o + 1] = rgba[o + 2] = v;
      rgba[o + 3] = 255;
    }
    const ini = [
      "; Busselton AC: where no tree, house or furniture may stand (src/core/shoreClear.ts), for scripts/check/shore_check.ts.",
      "; Pixel value = class code; local metres, x east, y north (AC z = -y).",
      "[MASK]",
      `X0 = ${this.x0}`,
      `Y0 = ${this.y0}`,
      `CELL = ${this.cell}`,
      `WIDTH = ${this.w}`,
      `HEIGHT = ${this.h}`,
      `CLASSES = ${SHORE_CLASSES.slice(1).join(",")}`,
      "",
    ].join("\n");
    return { png: encodePng(rgba, this.w, this.h), ini };
  }
}
