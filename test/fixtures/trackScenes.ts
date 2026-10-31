// Synthetic builds for the track golden and the stage tests (docs/specs/track.md section 15).
// Everything is made from formulas in local metres around a fixed origin: no network, no files,
// and the same bytes every run.
//
// a: a point-to-point road winding over hills, imagery off.
// b: a loop with an area polygon, streets (a cross street, a dead end, a car park aisle), a hinted
//    roundabout on the route and a tile ring inside the area, OSM buildings, kerbside tags,
//    traffic on, a layout id.
// c: b with synthetic aerial imagery and a route raster (asphalt, paint, footpaths, lawns, roofs,
//    trees, parked cars), detail shaders, the sea to the north with a jetty and a swimming jetty.
// d: c dressed like Busselton: the town settings, a noTrace zone, POIs, Mapillary sightings, paths,
//    barriers, traffic signals, poles and lamps, groynes, a clear circle, house looks, landmarks.

import type { DataSources } from "../../src/core/track";
import type { BuildOptions } from "../../src/core/options";
import { DemGrid } from "../../src/core/elevation";
import type { LngLat, Vec2 } from "../../src/core/geo";
import { encodePng } from "../../src/core/png";

const lat0 = -33.65, lng0 = 115.34;
const mx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
/** Local metres (x east, y north, about the origin) to lng/lat. */
export const ll = (x: number, y: number): LngLat => [lng0 + x / mx, lat0 + y / 111_320];
const llAll = (pts: Vec2[]): LngLat[] => pts.map(([x, y]) => ll(x, y));
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

export interface Scene {
  name: string;
  route: LngLat[];
  opts: Partial<BuildOptions>;
  sources: () => DataSources;
}

/** A colour a little warmer (the display variant of a raster). */
const warm = (c: [number, number, number]): [number, number, number] => [Math.min(1, c[0] * 1.06 + 0.01), c[1], c[2] * 0.95];

/** Position hash in 0..1. */
const hash = (x: number, y: number, salt = 0) => {
  let h = Math.imul(Math.floor(x) | 0, 73856093) ^ Math.imul(Math.floor(y) | 0, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---- the loop (b, c, d): a rounded rectangle 360 x 200 m, corners of 40 m ----

const A = 180, B = 100, R = 40;
/** Signed distance to the loop's centreline (negative inside). */
const loopSdf = (x: number, y: number) => {
  const qx = Math.abs(x) - (A - R), qy = Math.abs(y) - (B - R);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - R;
};
function loopPoints(step: number): Vec2[] {
  // Counterclockwise from the middle of the bottom edge.
  const pts: Vec2[] = [];
  const straightX = 2 * (A - R), straightY = 2 * (B - R), arc = (Math.PI / 2) * R;
  const perim = 2 * straightX + 2 * straightY + 4 * arc;
  const at = (d: number): Vec2 => {
    d = ((d % perim) + perim) % perim;
    const segs: [number, (u: number) => Vec2][] = [
      [straightX / 2, (u) => [u, -B]],
      [arc, (u) => { const a = -Math.PI / 2 + u / R; return [A - R + R * Math.cos(a), -(B - R) + R * Math.sin(a)]; }],
      [straightY, (u) => [A, -(B - R) + u]],
      [arc, (u) => { const a = u / R; return [A - R + R * Math.cos(a), B - R + R * Math.sin(a)]; }],
      [straightX, (u) => [A - R - u, B]],
      [arc, (u) => { const a = Math.PI / 2 + u / R; return [-(A - R) + R * Math.cos(a), B - R + R * Math.sin(a)]; }],
      [straightY, (u) => [-A, B - R - u]],
      [arc, (u) => { const a = Math.PI + u / R; return [-(A - R) + R * Math.cos(a), -(B - R) + R * Math.sin(a)]; }],
      [straightX / 2, (u) => [-(A - R) + u, -B]],
    ];
    for (const [len, f] of segs) {
      if (d <= len) return f(d);
      d -= len;
    }
    return [0, -B];
  };
  for (let d = 0; d < perim; d += step) pts.push(at(d));
  pts.push(at(0));
  return pts;
}

/** Streets inside the area (local), with their classes. */
const ringC: Vec2 = [-80, 0], ringR = 12;
const ringPts: Vec2[] = Array.from({ length: 17 }, (_, k) => {
  const a = (k % 16) / 16 * 2 * Math.PI;
  return [ringC[0] + ringR * Math.cos(a), ringC[1] + ringR * Math.sin(a)];
});
const streetLines = (): { pts: Vec2[]; cls: string; service?: string; oneway?: 1 | -1; surface?: string }[] => [
  // The cross street, through the tile ring.
  { pts: [[-180, 0], [-140, 0], [-92, 0]], cls: "minor" },
  { pts: [[-68, 0], [0, 0], [90, 0], [180, 0]], cls: "minor" },
  // The tile ring itself (a closed line of more than 5 points).
  { pts: ringPts, cls: "minor" },
  // A dead end off the bottom of the loop, out of it.
  { pts: [[30, -100], [30, -130], [32, -150]], cls: "minor" },
  // A car park aisle.
  { pts: [[60, 40], [140, 40]], cls: "service", service: "parking_aisle" },
  // A gravel track in the area's corner.
  { pts: [[-240, -140], [-200, -140], [-180, -100]], cls: "track", surface: "gravel" },
  // A footway (not a street for parking).
  { pts: [[-150, -60], [-60, -60]], cls: "path" },
];
const houses = (): Vec2[][] => {
  const out: Vec2[][] = [];
  for (let x = -150; x <= 160; x += 26) {
    if (Math.abs(x - ringC[0]) < 24) continue;
    out.push(rect(x - 6, 9, x + 6, 19));
    out.push(rect(x - 6, -19, x + 6, -9));
  }
  // A row outside the loop along its bottom edge (town level 2 there, so kerbs).
  for (let x = -150; x <= 70; x += 18) out.push(rect(x - 6, -132, x + 6, -120));
  return out;
};
const shopRing: Vec2[] = rect(100, -92, 130, -76);
/** Roofs in the photo that OSM doesn't have (detected buildings). */
const photoRoofs: Vec2[][] = [rect(-40, -62, -26, -50), rect(-130, 40, -118, 52), rect(150, -60, 162, -48)];
/** The car park round the aisle, with cars parked nose in each side of it. */
const carPark = { x0: 55, x1: 145, y0: 26, y1: 54 };

function loopSources(withImagery: boolean, withSea: boolean, extra: boolean): DataSources {
  const lines = streetLines();
  const hRing = 14, hC: Vec2 = [0, 100];
  const ocean = withSea ? [{ rings: [llAll(rect(-700, 175, 700, 900))], edge: [[true, true, true, true]] }] : [];
  const piers = withSea ? [
    { rings: [llAll(rect(30, 160, 37, 420))], edge: [[true, true, true, true]], id: 101 },
    { rings: [llAll(rect(-100, 165, -97, 200))], edge: [[true, true, true, true]], id: 102 },
  ] : [];
  const beaches = withSea ? [{ rings: [llAll(rect(-700, 150, 700, 178))], edge: [[true, true, true, true]] }] : [];
  const scene = sceneColour(lines);
  const src: DataSources = {
    dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, (x, y) => 4 + 0.004 * x + 1.5 * Math.sin(x / 140) * Math.cos(y / 170)).sample,
    widthAt: (p) => {
      // 12.5 m along the middle of the bottom edge (a divided bit for the traffic runs), else 7.
      const x = (p[0] - lng0) * mx, y = (p[1] - lat0) * 111_320;
      return Math.abs(y + B) < 6 && Math.abs(x) < 60 ? 12.5 : 7;
    },
    roundabouts: [{ location: ll(hC[0], hC[1]), arc: llAll(Array.from({ length: 6 }, (_, k) => { const a = -0.3 - k * 0.5; return [hC[0] + hRing * Math.cos(a), hC[1] + hRing * Math.sin(a)] as Vec2; })) }],
    streets: {
      lines: lines.map((l) => ({ ...l, pts: llAll(l.pts) })),
      names: [
        { pts: llAll([[-180, 0], [180, 0]]), name: "Cross Street" },
        { pts: llAll([[-180, -100], [180, -100]]), name: "Bottom Road" },
        { pts: llAll([[30, -100], [32, -150]]), name: "Dead End" },
      ],
    },
    osm: {
      buildings: [
        ...houses().map((r) => ({ ring: llAll(r), tags: { building: "house" } as Record<string, string> })),
        { ring: llAll(shopRing), tags: { building: "retail", "building:levels": "1" } },
      ],
      guardRails: [],
      roundaboutRings: [{ pts: llAll(Array.from({ length: 13 }, (_, k) => { const a = (k % 12) / 12 * 2 * Math.PI; return [hC[0] + hRing * Math.cos(a), hC[1] + hRing * Math.sin(a)] as Vec2; })), lanes: 1 }],
      kerbside: [{ pts: llAll([[-100, -100], [-62, -100]]), left: { parking: "parallel" }, right: { parking: "parallel", cycle: "lane" } },
        { pts: llAll([[-150, 0], [-100, 0]]), left: { parking: "parallel" }, right: { parking: "parallel" } }],
      ...(extra ? {
        barriers: [{ pts: llAll([[-140, 22], [-60, 22]]), kind: "fence" as const }, { pts: llAll([[100, -22], [160, -22]]), kind: "hedge" as const }],
        poles: llAll([[-120, -106], [-60, -106], [0, -107], [60, -106]]),
        lamps: llAll([[-30, 106], [30, 106]]),
        powerLines: [llAll([[-120, -106], [-60, -106], [0, -107], [60, -106]])],
        groynes: [llAll([[150, 168], [150, 200]])],
        trafficSignals: [{ at: ll(180, 0), crossing: false }],
        unsealed: [llAll([[-240, -140], [-200, -140], [-180, -100]])],
      } : {}),
    },
    ...(withSea ? { coast: { ocean, piers, beaches, landcover: [{ cls: "sand", rings: [llAll(rect(-300, 150, -200, 175))] }], water: extra ? [{ rings: [llAll(rect(200, 20, 230, 50))], edge: [[true, true, true, true]] }] : [] } } : {}),
    ...(withSea ? { jetty: { railways: [llAll([[33.5, 170], [33.5, 410]])], platforms: [], buildings: [] } } : {}),
  };
  if (withImagery) {
    src.imagery = async (_proj, chunk, _zoom, size) => {
      const rgba = new Uint8Array(size * size * 4);
      const m = (chunk.maxX - chunk.minX) / size;
      for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
          const c = scene(chunk.minX + (px + 0.5) * m, chunk.maxY - (py + 0.5) * m);
          const o = (py * size + px) * 4;
          rgba[o] = Math.round(c[0] * 255); rgba[o + 1] = Math.round(c[1] * 255); rgba[o + 2] = Math.round(c[2] * 255); rgba[o + 3] = 255;
        }
      }
      return { data: encodePng(rgba, size, size), ext: "png", rgba };
    };
    // The display variant is warmer, so a texture taken from the wrong one shows up in the hashes.
    src.raster = async () => Object.assign((x: number, y: number) => scene(x, y), { display: (x: number, y: number) => warm(scene(x, y)) });
    src.imageryCredit = () => "Synthetic imagery";
  }
  if (extra) {
    src.pois = [
      { at: ll(115, -84), cls: "cafe", subclass: "cafe", name: "Corner Cafe" },
      { at: ll(-20, 120), cls: "attraction", subclass: "attraction", name: "The Lookout" },
    ];
    src.landuse = [{ ring: llAll(rect(80, -90, 170, -50)), cls: "retail" }];
    src.seen = [
      { at: ll(-150, -107), value: "regulatory--maximum-speed-limit-50--g1" },
      { at: ll(90, -107), value: "warning--kangaroos--g1" },
      { at: ll(-40, -100.5), value: "marking--discrete--give-way-line" },
      { at: ll(10, -101.5), value: "marking--discrete--arrow--straight" },
      { at: ll(-120, -106), value: "object--support--utility-pole" },
      { at: ll(185, 4), value: "object--traffic-light--general-upright" },
    ];
    src.paths = [{ pts: llAll([[-150, -60], [-60, -60]]), kind: "foot" }, { pts: llAll([[-170, 140], [170, 140]]), kind: "shared" }];
    src.houseLooks = [
      { at: ll(-124, 9), facade: "wb_blue", front: "hedge", hedgeHeight: 1.1, trees: 2 },
      { at: ll(-20, -40), place: true, facade: "weatherboard" },
    ];
    src.landmarks = [{ name: "The Lookout", at: ll(-20, 120) }];
    src.roadClassAt = (p) => ((p[1] - lat0) * 111_320 < -90 ? "secondary" : "minor");
    src.elevationCredit = () => "Synthetic DEM";
    // The browser draws these; here a plain atlas, one cell per piece in request order.
    src.renderArt = async (items) => {
      const rgba = new Uint8Array(64 * 64 * 4).fill(200);
      const n = Math.max(1, items.length);
      return { data: encodePng(rgba, 64, 64, { alpha: true }), cells: Object.fromEntries(items.map((it, k) => [it.key, { u0: 0, v0: k / n, u1: 1, v1: (k + 1) / n, aspect: 2 }])) };
    };
    src.drawSigns = (names, w, h) => new Uint8Array(w * h * 4).fill(names.length ? 180 : 0);
  }
  return src;
}

/** The aerial photo of the loop scenes, RGB 0..1 at a local point. */
function sceneColour(lines: { pts: Vec2[]; cls: string }[]) {
  const segs: [Vec2, Vec2, number][] = [];
  for (const l of lines) {
    if (l.cls === "path") continue;
    for (let i = 1; i < l.pts.length; i++) segs.push([l.pts[i - 1], l.pts[i], l.cls === "service" ? 3 : 3.2]);
  }
  const hs = houses().concat([shopRing], photoRoofs);
  return (x: number, y: number): [number, number, number] => {
    if (y > 178) return [0.18, 0.36, 0.48];
    if (y > 150) return [0.86, 0.82, 0.7];
    const d = Math.abs(loopSdf(x, y));
    let street = Infinity;
    for (const [a, b, half] of segs) {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
      street = Math.min(street, Math.hypot(x - a[0] - u * dx, y - a[1] - u * dy) - half);
    }
    if (x > carPark.x0 && x < carPark.x1 && y > carPark.y0 && y < carPark.y1) {
      const row = y < 40 ? y > 29 && y < 34 : y > 46 && y < 51;
      if (row && x > 62 && x < 138 && ((x - 62) % 3) < 1.9) return hash(Math.floor((x - 62) / 3), y < 40 ? 1 : 2, 5) < 0.5 ? [0.9, 0.9, 0.88] : [0.62, 0.1, 0.1];
      const n = hash(x * 4, y * 4) * 0.03;
      return [0.33 + n, 0.33 + n, 0.35 + n];
    }
    if (d < 3.5 || street < 0) {
      if (d < 0.08 && (Math.floor((x + y + 400) / 3) % 3 === 0)) return [0.95, 0.95, 0.92];
      if (Math.abs(d - 3.3) < 0.06) return [0.93, 0.93, 0.9];
      const n = hash(x * 4, y * 4) * 0.04;
      return [0.3 + n, 0.31 + n, 0.33 + n];
    }
    if (d < 5.2 || street < 1.6) return [0.74, 0.73, 0.69];
    for (const h of hs) {
      const xs = h.map((p) => p[0]), ys = h.map((p) => p[1]);
      if (x > Math.min(...xs) && x < Math.max(...xs) && y > Math.min(...ys) && y < Math.max(...ys)) return [0.5, 0.22, 0.18];
    }
    const cell = 9, cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    if (hash(cx, cy, 7) < 0.18) {
      const tx = (cx + 0.5) * cell, ty = (cy + 0.5) * cell;
      if (Math.hypot(x - tx, y - ty) < 3 + hash(cx, cy, 8) * 1.5) return [0.12, 0.24, 0.1];
    }
    const n = hash(x * 2, y * 2, 3) * 0.06;
    return [0.32 + n, 0.46 + n, 0.22 + n / 2];
  };
}

const area: LngLat[] = llAll(rect(-260, -160, 260, 160));

// ---- the country road (a, e): y = 60 sin(x / 150) over hills ----

const wind = (x: number) => 60 * Math.sin(x / 150);
const hills = (x: number, y: number) => 20 + 8 * Math.sin(x / 90) * Math.cos(y / 120) + 0.01 * x;
/** The country photo: a chip-seal road, gravel shoulders, paddocks with trees in lines, a farm shed. */
const countryColour = (x: number, y: number): [number, number, number] => {
  const d = Math.abs(y - wind(x)) / Math.sqrt(1 + (0.4 * Math.cos(x / 150)) ** 2);
  if (d < 3.1) {
    const n = hash(x * 4, y * 4) * 0.04;
    return [0.36 + n, 0.35 + n, 0.34 + n];
  }
  if (d < 4.2) return [0.62, 0.55, 0.45];
  if (x > 300 && x < 324 && y > 110 && y < 126) return [0.7, 0.7, 0.72];
  const cell = 11, cx = Math.floor(x / cell), cy = Math.floor(y / cell);
  if ((cy % 4 === 0 || hash(cx, cy, 2) < 0.08) && Math.hypot(x - (cx + 0.5) * cell, y - (cy + 0.5) * cell) < 3.5) return [0.1, 0.22, 0.09];
  const n = hash(x, y, 9) * 0.05;
  return x < 450 ? [0.55 + n, 0.5 + n, 0.3] : [0.3 + n, 0.42 + n, 0.2];
};
function countrySources(): DataSources {
  return {
    dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, hills).sample,
    widthAt: () => 6.5,
    osm: {
      buildings: [{ ring: llAll(rect(300, 110, 324, 126)), tags: { building: "farm_auxiliary" } }],
      guardRails: [llAll(Array.from({ length: 8 }, (_, k) => [600 + k * 10, wind(600 + k * 10) - 5] as Vec2))],
      crossings: { bridges: [llAll([[200, wind(200)], [215, wind(215)]])], waterways: [{ pts: llAll([[207, -100], [207, 100]]), cls: "stream" }] },
      cattleGrids: [ll(750, wind(750))],
      barriers: [{ pts: llAll([[100, 20], [400, 20]]), kind: "fence", fenceType: "wire" }],
    },
    farmland: [
      { kind: "vineyard", rings: [llAll(rect(480, -150, 640, -40))], edge: [[true, true, true, true]] },
      { kind: "paddock", rings: [llAll(rect(60, 80, 300, 200))], edge: [[true, true, true, true]] },
    ],
    imagery: async (_proj, chunk, _zoom, size) => {
      const rgba = new Uint8Array(size * size * 4);
      const m = (chunk.maxX - chunk.minX) / size;
      for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
          const c = countryColour(chunk.minX + (px + 0.5) * m, chunk.maxY - (py + 0.5) * m);
          const o = (py * size + px) * 4;
          rgba[o] = Math.round(c[0] * 255); rgba[o + 1] = Math.round(c[1] * 255); rgba[o + 2] = Math.round(c[2] * 255); rgba[o + 3] = 255;
        }
      }
      return { data: encodePng(rgba, size, size), ext: "png", rgba };
    },
    raster: async () => Object.assign((x: number, y: number) => countryColour(x, y), { display: (x: number, y: number) => warm(countryColour(x, y)) }),
    streets: {
      lines: [
        { pts: llAll([[400, wind(400)], [410, 140], [420, 260]]), cls: "track", surface: "gravel" },
        { pts: llAll([[700, wind(700)], [700, -150]]), cls: "minor" },
      ],
      names: [{ pts: llAll([[0, 0], [900, 0]]), name: "Country Road" }],
    },
    roadClassAt: () => "secondary",
  };
}

const common: Partial<BuildOptions> = { origin: ll(0, 0), textureSize: 256, imageryZoom: 0, horizon: 0, horizonZoom: 15, maxTrees: 3000 };

const country = Array.from({ length: 61 }, (_, i) => ll(i * 15, wind(i * 15)));

export const SCENES: Record<"a" | "b" | "c" | "d" | "e" | "f", Scene> = {
  a: {
    name: "a",
    route: country,
    opts: { ...common, name: "Golden Hills", origin: ll(450, 0), horizon: 300, corridor: 50 },
    sources: () => ({
      dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, hills).sample,
      widthAt: () => 6.5,
      osm: { buildings: [], guardRails: [] },
    }),
  },
  e: {
    name: "e",
    route: country,
    opts: {
      ...common, name: "Golden Country", origin: ll(450, 0), horizon: 300, corridor: 50, imageryZoom: 18,
      traceGuard: false, traffic: true, maxBank: 0.04, armco: true, farmland: true, farmRoadsides: true, zones: true, aiKeepLeft: true,
      cspTrees: true, trackSounds: "lua", rainHollows: true, sea: false, pitCount: 4,
    },
    sources: countrySources,
  },
  b: {
    name: "b",
    route: llAll(loopPoints(10)),
    opts: { ...common, name: "Golden Loop", area, traffic: true, layout: "main", kerbside: true, corridor: 40 },
    sources: () => loopSources(false, false, false),
  },
  c: {
    name: "c",
    route: llAll(loopPoints(10)),
    opts: { ...common, name: "Golden Coast", area, traffic: true, layout: "main", kerbside: true, corridor: 40, imageryZoom: 18, textureSize: 512, horizon: 250 },
    sources: () => loopSources(true, true, false),
  },
  d: {
    name: "d",
    route: llAll(loopPoints(10)),
    opts: {
      ...common, name: "Golden Town", area, traffic: true, layout: "main", kerbside: true, corridor: 40, imageryZoom: 18, textureSize: 512, horizon: 250,
      banking: false, terrainStep: 1.5, terrainUnderRoad: 0.12, traceGuard: false, aiKeepLeft: true,
      noTrace: [{ at: ll(180, 60), radius: 30 }],
      clears: [{ at: ll(98, 14), radius: 10 }, { at: ll(-46, -14), radius: 8, trees: false }],
      houseStyle: { facades: { wb_white: 3, brick_red: 1 } },
    },
    sources: () => loopSources(true, true, true),
  },
  f: {
    name: "f",
    route: llAll(loopPoints(10)),
    opts: { ...common, name: "Golden Network", area, traffic: true, kerbside: true, corridor: 40, networkCore: true, trees: 0 },
    sources: () => loopSources(false, false, false),
  },
};
