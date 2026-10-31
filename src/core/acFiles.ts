// The small files beside the kn5 in an AC track folder: the folder name, data/surfaces.ini,
// ui/ui_track.json, the minimap (map.png, data/map.ini), the Busselton Map app's street map,
// Content Manager's outline and preview, and README.txt. Written from docs/specs/acFiles.md.
//
// Points are AC world X/Z pairs (X east, Z south); callers pass local [x, -y].

import type { LngLat } from "./geo";
import { Raster } from "./textures";
import { unsealedSurfaces } from "./unsealed";

export interface TrackMeta {
  name: string;
  description?: string;
  country?: string;
  city?: string;
  author?: string;
}

/** The ui_track.json tag CSP's Traffic mode lists tracks by (`ALLOWED_TRACKS=#traffic-planner-ready`). */
export const TRAFFIC_READY_TAG = "traffic-planner-ready";

type XZ = [number, number];

// ---------------------------------------------------------------------------------------------
// Folder name

const SLUG_MAX = 40;

/**
 * The track's folder name: accents dropped, lower case, runs of anything else as one `_`, at most
 * 40 characters, never starting or ending with `_`; `real_road` when nothing is left.
 * scripts/upgrade/base.mjs repeats this rule; keep the two the same.
 */
export function slugify(name: string): string {
  const trim = (s: string) => s.replace(/^_+|_+$/g, "");
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return trim(trim(base).slice(0, SLUG_MAX)) || "real_road";
}

// ---------------------------------------------------------------------------------------------
// data/surfaces.ini

type Surface = Record<string, string | number>;

function surface(key: string, friction: number, damping: number, wav: string, dirt: number, valid: number,
  sinHeight: number, sinLength: number, vibGain: number, vibLength: number): Surface {
  return {
    KEY: key, FRICTION: friction, DAMPING: damping, WAV: wav, WAV_PITCH: 0, FF_EFFECT: "NULL", DIRT_ADDITIVE: dirt,
    IS_VALID_TRACK: valid, BLACK_FLAG_TIME: 0, SIN_HEIGHT: sinHeight, SIN_LENGTH: sinLength, IS_PITLANE: 0,
    VIBRATION_GAIN: vibGain, VIBRATION_LENGTH: vibLength,
  };
}

/**
 * The physics surfaces, keyed by mesh name (`1ROAD_...`, `1STREET_...`). Traffic turns on CSP's
 * extended physics and track scripting; `streetsValid` makes leaving the route onto a street keep
 * the lap; `at` gives CSP's WeatherFX the track's position; `unsealed` adds the gravel surfaces.
 */
export function surfacesIni(traffic = false, streetsValid = false, at?: LngLat, unsealed = false): string {
  const list: Surface[] = [
    surface("ROAD", 0.99, 0, "", 0, 1, 0, 0, 0, 0),
    surface("STREET", 0.99, 0, "", 0, streetsValid ? 1 : 0, 0, 0, 0, 0),
    surface("GRASS", 0.6, 0.1, "grass.wav", 1, 0, 0.03, 0.5, 0.2, 0.4),
    surface("KERB", 0.92, 0, "", 0, 1, 0, 0, 0.3, 0.2),
    surface("WALL", 0.3, 0, "", 0, 0, 0, 0, 0, 0),
  ];
  if (traffic) list[0].WAV_PITCH = "extended-0";
  if (unsealed) list.push(...unsealedSurfaces(streetsValid));
  let text = list.map((s, i) => [`[SURFACE_${i}]`, ...Object.entries(s).map(([k, v]) => `${k}=${v}`)].join("\n")).join("\n\n") + "\n";
  const section = (lines: string[]) => { text += "\n" + lines.map((l) => l + "\n").join(""); };
  if (traffic) section(["[_SCRIPTING_PHYSICS]", "ALLOW_TOOLS=1", "ALLOW_TRACK_SCRIPTS=1", "ALLOW_NEW_MODE_SCRIPTS=1"]);
  if (at) {
    const zone = timezoneOf(at);
    section(["[WEATHER_FX]", `LATITUDE=${at[1].toFixed(5)}`, `LONGITUDE=${at[0].toFixed(5)}`, ...(zone ? [`TIMEZONE_ID=${zone}`] : [])]);
  }
  return text;
}

/** IANA zones for Australia by rough state borders, first match wins (lng, lat strict comparisons). */
const ZONES: { zone: string; test: (lng: number, lat: number) => boolean }[] = [
  { zone: "Australia/Perth", test: (lng) => lng < 129 },
  { zone: "Australia/Darwin", test: (lng, lat) => lat > -26 && lng < 138 },
  { zone: "Australia/Adelaide", test: (lng) => lng < 141 },
  { zone: "Australia/Brisbane", test: (_, lat) => lat > -29 },
  { zone: "Australia/Hobart", test: (_, lat) => lat < -39.2 },
  { zone: "Australia/Melbourne", test: (lng, lat) => lat < -34 && lng < 150 },
  { zone: "Australia/Sydney", test: () => true },
];

/** The timezone for a point in Australia; undefined outside it. Rough at state borders (spec, known issue 5). */
function timezoneOf([lng, lat]: LngLat): string | undefined {
  if (lat > -10 || lat < -44 || lng < 112 || lng > 154) return undefined;
  return ZONES.find((z) => z.test(lng, lat))?.zone;
}

// ---------------------------------------------------------------------------------------------
// ui/ui_track.json

function geotag(v: number, pos: string, neg: string): string {
  return `${Math.abs(v).toFixed(5)} ${v >= 0 ? pos : neg}`;
}

/** The track list entry for AC and Content Manager. Numbers are strings, as in Kunos's own files. */
export function uiTrackJson(meta: TrackMeta, opts: { length: number; width: number; pitboxes: number; closed: boolean; centre: LngLat; traffic?: boolean }): string {
  const [lng, lat] = opts.centre;
  const json = {
    name: meta.name,
    description: meta.description ?? `${meta.name}, built from the real road with OpenStreetMap and open elevation data.`,
    tags: ["real road", opts.closed ? "circuit" : "point to point", "street", "osm", ...(opts.traffic ? [TRAFFIC_READY_TAG] : [])],
    geotags: [geotag(lat, "N", "S"), geotag(lng, "E", "W")],
    country: meta.country ?? "",
    city: meta.city ?? "",
    length: String(Math.round(opts.length)),
    width: String(Math.round(opts.width)),
    pitboxes: String(opts.pitboxes),
    run: opts.closed ? "clockwise" : "A to B",
    author: meta.author ?? "AC Track Builder",
    version: "1.0",
  };
  return JSON.stringify(json, null, 2) + "\n";
}

// ---------------------------------------------------------------------------------------------
// Map images

function bounds(points: readonly XZ[], what: string) {
  if (!points.length) throw new Error(`${what}: no points to draw`);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ };
}

/** AC's map transform: pixel = (world + offset) / scale, with `margin` pixels round the box. */
function mapFrame(points: readonly XZ[], margin: number, scaleOf: (extent: number) => number, what: string) {
  const b = bounds(points, what);
  const scale = scaleOf(Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 1));
  const width = Math.ceil((b.maxX - b.minX) / scale) + 2 * margin;
  const height = Math.ceil((b.maxZ - b.minZ) / scale) + 2 * margin;
  const xOff = -b.minX + margin * scale, zOff = -b.minZ + margin * scale;
  const px = ([x, z]: XZ): XZ => [(x + xOff) / scale, (z + zOff) / scale];
  const ini = [
    "[PARAMETERS]", `WIDTH=${width}`, `HEIGHT=${height}`, `MARGIN=${margin}`,
    `SCALE_FACTOR=${scale.toFixed(6)}`, `X_OFFSET=${xOff.toFixed(4)}`, `Z_OFFSET=${zOff.toFixed(4)}`,
  ];
  return { scale, width, height, px, ini };
}

const WHITE = [255, 255, 255, 255] as const;

/** map.png and data/map.ini for AC's minimap: the route in white, at least 1 m a pixel, at most 2048 px. */
export function trackMap(points: XZ[]): { png: Uint8Array; ini: string } {
  const MARGIN = 20, MAX = 2048;
  const f = mapFrame(points, MARGIN, (extent) => Math.max(1, extent / (MAX - 2 * MARGIN)), "trackMap");
  const r = new Raster(f.width, f.height);
  r.line(points.map(f.px), 8, WHITE);
  return { png: r.png(), ini: [...f.ini, "DRAWING_SIZE=10"].join("\n") + "\n" };
}

const CASING = [40, 44, 52, 255] as const;
const STREET = [205, 208, 214, 255] as const;
const ROUTE = [245, 196, 66, 255] as const;

/**
 * extension/street_map.png and .ini for the Busselton Map app: every street in grey, the route in
 * yellow, each with a dark casing (all casings first, so crossings join cleanly). Same transform as map.ini.
 */
export function streetMap(streets: { pts: XZ[]; width: number }[], route: XZ[]): { png: Uint8Array; ini: string } {
  const MARGIN = 40, MAX = 3072;
  const all = [...route, ...streets.flatMap((s) => s.pts)];
  const f = mapFrame(all, MARGIN, (extent) => Math.max(0.75, extent / (MAX - 2 * MARGIN)), "streetMap");
  const r = new Raster(f.width, f.height);
  const streetPx = (s: { width: number }) => Math.max(3, s.width / f.scale);
  const routePx = Math.max(4, 8 / f.scale);
  const routeLine = route.map(f.px), streetLines = streets.map((s) => s.pts.map(f.px));
  streets.forEach((s, i) => r.line(streetLines[i], streetPx(s) + 3, CASING));
  r.line(routeLine, routePx + 3, CASING);
  streets.forEach((s, i) => r.line(streetLines[i], streetPx(s), STREET));
  r.line(routeLine, routePx, ROUTE);
  return { png: r.png(), ini: f.ini.join("\n") + "\n" };
}

/** Points fitted into a w x h image with `m` pixels margin, centred, north up. */
function fit(points: readonly XZ[], w: number, h: number, m: number, what: string): XZ[] {
  const b = bounds(points, what);
  const dx = b.maxX - b.minX, dz = b.maxZ - b.minZ;
  const s = Math.min((w - 2 * m) / Math.max(1, dx), (h - 2 * m) / Math.max(1, dz));
  const ox = (w - dx * s) / 2, oz = (h - dz * s) / 2;
  return points.map(([x, z]) => [ox + (x - b.minX) * s, oz + (z - b.minZ) * s]);
}

/** ui/outline.png: the route in white on transparent, 512 x 512. */
export function outlinePng(points: XZ[]): Uint8Array {
  const r = new Raster(512, 512);
  r.line(fit(points, 512, 512, 24, "outlinePng"), 10, WHITE);
  return r.png();
}

/** ui/preview.png: the route on a dark background, a green dot at the start and (point to point) a red one at the finish. */
export function previewPng(points: XZ[], closed: boolean): Uint8Array {
  const r = new Raster(1024, 576, [24, 26, 32, 255]);
  const p = fit(points, 1024, 576, 48, "previewPng");
  r.line(p, 14, [70, 74, 84, 255]);
  r.line(p, 6, ROUTE);
  r.dot(p[0][0], p[0][1], 12, [80, 220, 120, 255]);
  if (!closed) r.dot(p[p.length - 1][0], p[p.length - 1][1], 12, [235, 80, 80, 255]);
  return r.png();
}

// ---------------------------------------------------------------------------------------------
// README.txt

/** The elevation credit when no state model was used. */
export const DEFAULT_ELEVATION_CREDIT = "Elevation: Terrain Tiles on AWS Open Data (Mapzen/Tilezen), from SRTM, USGS 3DEP, GMTED and national datasets.";
export const MAPILLARY_CREDIT = "Street-level photos: Mapillary contributors, CC BY-SA 4.0 (house looks and objects seen from the street). https://www.mapillary.com";

/**
 * README.txt: install notes and data credits. `imagery` is the aerial imagery credit (null: procedural
 * terrain). `credits.elevation` replaces the default elevation line (e.g. Geoscience Australia's 5 m
 * DEM for WA builds); `credits.mapillary` adds the Mapillary line when its data went into the build.
 */
export function readme(meta: TrackMeta, imagery: string | null, credits: { elevation?: string; mapillary?: boolean } = {}): string {
  return [
    meta.name,
    "",
    "Install: copy this folder into assettocorsa/content/tracks/ (or drag the zip onto Content Manager).",
    "",
    "Data sources:",
    "- Road network (c) OpenStreetMap contributors, ODbL. https://www.openstreetmap.org/copyright",
    "- Routing by OSRM (project-osrm.org) on OpenStreetMap data.",
    `- ${credits.elevation || DEFAULT_ELEVATION_CREDIT}`,
    imagery !== null ? `- Aerial imagery: ${imagery}. For personal use only; do not redistribute this track.` : "- Terrain textures are procedural.",
    ...(credits.mapillary ? [`- ${MAPILLARY_CREDIT}`] : []),
    "",
    "Assetto Corsa is a trademark of Kunos Simulazioni. This track is not affiliated with or endorsed by Kunos.",
    "",
  ].join("\n");
}
