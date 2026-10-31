// OpenStreetMap services: routing (OSRM, or along given ways), place search (Photon) and naming
// (Nominatim), and the Overpass data a build uses near its route and over its areas.
//
// Written from docs/specs/osm.md. URLs and Overpass query text are cache and snapshot keys
// (sha256 of method, URL and body): keep every byte, whitespace included.

import { haversine, type LngLat } from "../core/geo";
import { kerbsideFromTags } from "../core/kerbside";
import type { RoundaboutHint } from "../core/roundabout";
import { trimSpurs } from "../core/spurs";
import type { OsmFeatures } from "../core/track";
import { isUnsealed } from "../core/unsealed";
import { allRaceway, routeAlongWays, type OsmWayGeom, type WayRouteOptions } from "../core/wayRoute";
import { warnMissing } from "./dataWarnings";
import { JETTY_SNAPSHOT, JETTY_SNAPSHOT_BOX } from "./jettySnapshot";
import { nearestLine } from "./nearestLine";

const OSRM = "https://router.project-osrm.org";
const PHOTON = "https://photon.komoot.io/api/";
const NOMINATIM = "https://nominatim.openstreetmap.org";
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

/* ---------------- Overpass protocol ---------------- */

type Tags = Record<string, string>;
interface Element { type: string; id?: number; lat?: number; lon?: number; tags?: Tags; geometry?: ({ lat: number; lon: number } | null)[] }

interface OverpassOptions {
  /** Round-wide abort, ms. */
  abortMs: number;
  /** Wait before round 2, ms (round 3 waits twice this). */
  waitMs: number;
  /** An answer without an `elements` array is a failure (else it counts as no elements). */
  needElements: boolean;
}

/**
 * One Overpass query: up to three rounds, each asking every mirror at once (first good answer
 * wins, the rest are aborted). Throws the last round's error when every round failed.
 */
async function overpass(query: string, o: OverpassOptions): Promise<Element[]> {
  const body = new URLSearchParams({ data: query });
  let lastError: unknown = new Error("no answer");
  for (let round = 0; round < 3; round++) {
    if (round > 0) await sleep(o.waitMs * round);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.abortMs);
    try {
      return await Promise.any(OVERPASS.map(async (mirror) => {
        const r = await fetch(mirror, { method: "POST", body, signal: ctl.signal });
        if (!r.ok) throw new Error(`${mirror}: HTTP ${r.status}`);
        let j: { remark?: unknown; elements?: unknown };
        try {
          j = JSON.parse(await r.text());
        } catch {
          throw new Error(`${mirror}: not JSON`);
        }
        if (typeof j.remark === "string" && /timed out|runtime error/i.test(j.remark)) throw new Error(`${mirror}: ${j.remark}`);
        if (!Array.isArray(j.elements)) {
          if (o.needElements) throw new Error(`${mirror}: no elements`);
          return [];
        }
        return j.elements as Element[];
      }));
    } catch (e) {
      lastError = e;
    } finally {
      clearTimeout(timer);
      ctl.abort();
    }
  }
  throw lastError;
}

const errorText = (e: unknown): string =>
  e instanceof AggregateError ? e.errors.map((x) => (x as Error).message).join("; ") : (e as Error).message;

const geomOf = (e: Element): LngLat[] => (e.geometry ?? []).filter((g): g is { lat: number; lon: number } => !!g).map((g) => [g.lon, g.lat]);

/* ---------------- routing ---------------- */

export interface Route { coords: LngLat[]; distance: number; roundabouts: RoundaboutHint[]; uturns: LngLat[]; trimmed: LngLat[]; /** Every way it follows is OSM highway=raceway (routeWays). */ raceway?: boolean }

interface OsrmStep { maneuver: { type: string; modifier?: string; location: LngLat }; geometry?: { coordinates: LngLat[] } }
interface OsrmBody { code?: string; message?: string; routes?: { distance: number; geometry: { coordinates: LngLat[] }; legs: { steps: OsrmStep[] }[] }[] }

const ROUNDABOUT_TYPES = new Set(["roundabout", "rotary", "roundabout turn"]);
const OSRM_TIMEOUT = 30_000;

/** GET with retries on network errors, timeouts, 429 and 5xx (1, 3, 7 s), honouring the caller's abort. */
async function getRouting(url: string, signal?: AbortSignal): Promise<Response> {
  let last: unknown;
  for (let a = 0; a < 4; a++) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    const timeout = AbortSignal.timeout(OSRM_TIMEOUT);
    const both = signal && typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : signal ?? timeout;
    try {
      const r = await fetch(url, { signal: both });
      if (a === 3 || (r.status !== 429 && r.status < 500)) return r;
      last = r;
    } catch (e) {
      if (signal?.aborted) throw e;
      last = e;
      if (a === 3) throw new Error(`Routing failed: ${(e as Error).message}`);
    }
    await sleep(1000 * (2 ** (a + 1) - 1));
  }
  if (last instanceof Response) return last;
  throw new Error("Routing failed");
}

/** The OSRM driving route through the pins, with its roundabouts and U-turns; U-turn spurs cut out. */
export async function route(pins: LngLat[], signal?: AbortSignal): Promise<Route> {
  const path = pins.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(";");
  const url = `${OSRM}/route/v1/driving/${path}?overview=full&geometries=geojson&steps=true&continue_straight=true`;
  const r = await getRouting(url, signal);
  let body: OsrmBody;
  try {
    body = JSON.parse(await r.text());
  } catch {
    body = {};
  }
  if (!r.ok || body.code !== "Ok" || !body.routes?.length) throw new Error(body.message || `Routing failed (HTTP ${r.status})`);
  const best = body.routes[0];
  const steps = best.legs.flatMap((l) => l.steps ?? []);
  const roundabouts: RoundaboutHint[] = steps
    .filter((s) => ROUNDABOUT_TYPES.has(s.maneuver.type))
    .map((s) => ({ location: s.maneuver.location, arc: s.geometry?.coordinates ?? [] }));
  const uturns = steps.filter((s) => s.maneuver.modifier === "uturn").map((s) => s.maneuver.location);
  const coords = best.geometry.coordinates;
  const t = trimSpurs(coords, uturns);
  if (!t.cut.length) return { coords, distance: best.distance, roundabouts, uturns, trimmed: [] };
  let distance = 0;
  for (let i = 1; i < t.coords.length; i++) distance += haversine(t.coords[i - 1], t.coords[i]);
  const near = (p: LngLat) => t.coords.some((c) => haversine(p, c) <= 30);
  return { coords: t.coords, distance, roundabouts: roundabouts.filter((rb) => near(rb.location)), uturns: t.kept, trimmed: t.cut };
}

/** The geometry of OSM ways by id, in the order asked. */
export async function fetchWayGeoms(ids: number[]): Promise<OsmWayGeom[]> {
  const bad = ids.filter((id) => !Number.isInteger(id) || id <= 0);
  if (!ids.length || bad.length) throw new Error(`"ways" must be OSM way ids (whole numbers)${bad.length ? `, not ${bad.join(", ")}` : ""}`);
  let elements: Element[];
  try {
    elements = await overpass(`[out:json][timeout:40];way(id:${ids.join(",")});out tags geom;`, { abortMs: 45_000, waitMs: 5_000, needElements: true });
  } catch (e) {
    throw new Error(`couldn't fetch OSM ways ${ids.join(",")} from Overpass (every mirror failed 3 times: ${errorText(e)}); build again`);
  }
  const byId = new Map<number, LngLat[]>();
  const highway = new Map<number, string>();
  for (const e of elements) {
    if (e.type !== "way" || !e.geometry || e.id === undefined) continue;
    byId.set(e.id, geomOf(e));
    if (e.tags?.highway) highway.set(e.id, e.tags.highway);
  }
  const absent = ids.filter((id) => !byId.has(id));
  if (absent.length) throw new Error(`OSM way${absent.length > 1 ? "s" : ""} ${absent.join(", ")} not found (deleted, or a wrong id)`);
  return ids.map((id) => ({ id, pts: byId.get(id)!, ...(highway.has(id) ? { highway: highway.get(id) } : {}) }));
}

const wayGeoms = new Map<string, Promise<OsmWayGeom[]>>();

/** A route along given OSM ways through the pins (raceways, gravel tracks the router won't drive). */
export async function routeWays(ids: number[], through: LngLat[], opts?: WayRouteOptions): Promise<Route> {
  const key = ids.join(",");
  let geoms = wayGeoms.get(key);
  if (!geoms) {
    geoms = fetchWayGeoms(ids);
    wayGeoms.set(key, geoms);
    geoms.catch(() => wayGeoms.delete(key));
  }
  const g = await geoms;
  const r = routeAlongWays(g, through, opts);
  return { coords: r.coords, distance: r.distance, roundabouts: [], uturns: [], trimmed: [], ...(allRaceway(g) ? { raceway: true } : {}) };
}

/* ---------------- place search and naming ---------------- */

export interface Place { label: string; detail: string; lngLat: LngLat; extent?: [number, number, number, number] }

interface PhotonFeature {
  geometry: { coordinates: LngLat };
  properties: { name?: string; street?: string; city?: string; state?: string; country?: string; extent?: [number, number, number, number] };
}

/** Search-as-you-type place search (Photon allows it; Nominatim's policy doesn't). */
export async function searchPlaces(q: string, near?: LngLat, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({ q, limit: "6" });
  if (near) {
    params.set("lon", near[0].toFixed(4));
    params.set("lat", near[1].toFixed(4));
  }
  const r = await fetch(`${PHOTON}?${params}`, { signal });
  if (!r.ok) return [];
  const j = (await r.json()) as { features?: PhotonFeature[] };
  return (j.features ?? []).map((f) => {
    const p = f.properties;
    const label = p.name ?? p.street ?? p.city ?? "Unnamed";
    const detail = [p.street !== label ? p.street : undefined, p.city, p.state, p.country].filter(Boolean).join(", ");
    const place: Place = { label, detail, lngLat: f.geometry.coordinates };
    if (p.extent) place.extent = p.extent;
    return place;
  });
}

export interface PlaceName { road?: string; town?: string; country?: string }

const NOMINATIM_GAP = 1100;
let nominatimTurn: Promise<void> = Promise.resolve();
let nominatimLast = -Infinity;

/** Wait for Nominatim's turn: each request starts at least 1.1 s after the previous one, even when calls overlap. */
function nominatimSlot(): Promise<void> {
  const turn = nominatimTurn.then(async () => {
    const wait = nominatimLast + NOMINATIM_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    nominatimLast = Date.now();
  });
  nominatimTurn = turn.catch(() => {});
  return turn;
}

/** The road, town and country at a point (Nominatim, at most one request a second). */
export async function reverseGeocode(p: LngLat): Promise<PlaceName> {
  await nominatimSlot();
  const r = await fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=16&lat=${p[1]}&lon=${p[0]}`);
  if (!r.ok) return {};
  const j = (await r.json()) as { address?: Record<string, string> };
  const a = j.address ?? {};
  return { road: a.road, town: a.town ?? a.village ?? a.city ?? a.suburb ?? a.county, country: a.country };
}

/* ---------------- Overpass data near the route ---------------- */

export interface Way { width: number; pts: LngLat[] }

export interface OsmData {
  widthAt?: (p: LngLat) => number | undefined;
  features: OsmFeatures;
  roads?: { pts: LngLat[]; cls: string; brunnel?: string; oneway?: 1 | -1; service?: string; surface?: string }[];
}

/** The route thinned to at most about 180 points (the last always kept), as "lat,lng,..." with 6 decimals. */
function aroundList(routeCoords: LngLat[]): string {
  const n = routeCoords.length;
  const step = Math.max(1, Math.ceil(n / 180));
  const kept: LngLat[] = [];
  for (let i = 0; i < n; i += step) kept.push(routeCoords[i]);
  if ((n - 1) % step !== 0) kept.push(routeCoords[n - 1]);
  return kept.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(",");
}

/** Each area ring of 3+ points as an Overpass poly:"lat lng ..." selector. */
function polySelectors(areas: LngLat[][]): string[] {
  return areas.filter((r) => r.length >= 3).map((r) => `poly:"${r.map((p) => `${p[1].toFixed(6)} ${p[0].toFixed(6)}`).join(" ")}"`);
}

function mainQuery(routeCoords: LngLat[], areas: LngLat[][], cattleGrids: boolean): { query: string; polygons: boolean } {
  const A = aroundList(routeCoords);
  const polys = polySelectors(areas);
  const line = (s: string) => `\n    ${s};`;
  let q = `[out:json][timeout:${polys.length ? 90 : 40}];(`;
  q += line(`way(around:12,${A})[highway]`);
  q += line(`way(around:15,${A})[barrier=guard_rail]`);
  q += line(`way(around:30,${A})[junction~"^(roundabout|circular)$"]`);
  q += line(`node(around:40,${A})[power=pole]`);
  q += line(`node(around:40,${A})[highway=street_lamp]`);
  q += line(`way(around:40,${A})[power~"^(line|minor_line)$"]`);
  q += line(`way(around:45,${A})[barrier~"^(fence|wall|hedge|retaining_wall)$"]`);
  if (cattleGrids) q += line(`node(around:30,${A})[barrier=cattle_grid]`);
  q += line(`way(around:300,${A})[man_made~"^(groyne|breakwater)$"]`);
  for (const P of polys) {
    q += line(`way(${P})[highway]`);
    q += line(`way(${P})[junction~"^(roundabout|circular)$"]`);
    q += line(`node(${P})[power=pole]`);
    q += line(`node(${P})[highway=street_lamp]`);
    q += line(`way(${P})[power~"^(line|minor_line)$"]`);
    q += line(`way(${P})[barrier~"^(fence|wall|hedge|retaining_wall)$"]`);
    if (cattleGrids) q += line(`node(${P})[barrier=cattle_grid]`);
  }
  q += `\n  );out tags geom;`;
  return { query: q, polygons: polys.length > 0 };
}

/** The traffic signal query: signals and signalised crossings near the route and in the areas. */
export function signalQuery(routeCoords: LngLat[], areas: LngLat[][] = []): string {
  const polys = polySelectors(areas);
  const block = (W: string) =>
    `\n    node(${W})[highway=traffic_signals];` +
    `\n    node(${W})[highway=crossing][crossing=traffic_signals];` +
    `\n    node(${W})[highway=crossing]["crossing:signals"=yes];`;
  let q = `[out:json][timeout:${polys.length ? 60 : 30}];(`;
  q += block(`around:40,${aroundList(routeCoords)}`);
  for (const P of polys) q += block(P);
  return q + `\n  );out;`;
}

const NOT_JUNCTION_SIGNALS = new Set(["emergency", "blinker", "level_crossing", "ramp_meter"]);

/** Junction signals and signalised crossings, de-duplicated by position, in input order. */
export function signalsFromElements(elements: { type: string; lat?: number; lon?: number; tags?: Record<string, string> }[]): { at: LngLat; crossing: boolean }[] {
  const out: { at: LngLat; crossing: boolean }[] = [];
  const seen = new Set<string>();
  for (const e of elements) {
    if (e.type !== "node" || e.lat === undefined || e.lon === undefined) continue;
    const t = e.tags ?? {};
    if (t.traffic_signals !== undefined && NOT_JUNCTION_SIGNALS.has(t.traffic_signals)) continue;
    if (t.highway !== "crossing" && t.highway !== "traffic_signals") continue;
    const key = `${e.lon.toFixed(7)},${e.lat.toFixed(7)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ at: [e.lon, e.lat], crossing: t.highway === "crossing" });
  }
  return out;
}

async function fetchSignals(routeCoords: LngLat[], areas: LngLat[][]): Promise<{ at: LngLat; crossing: boolean }[] | undefined> {
  try {
    const elements = await overpass(signalQuery(routeCoords, areas), { abortMs: 65_000, waitMs: 5_000, needElements: true });
    return signalsFromElements(elements as never);
  } catch {
    warnMissing("OpenStreetMap (Overpass): traffic signals");
    return undefined;
  }
}

/** Width by highway class when a way has no width or lanes tag. */
const HIGHWAY_WIDTH: Record<string, number> = {
  motorway: 7.5, trunk: 7.5, primary: 7.5, secondary: 7, tertiary: 6.5,
  motorway_link: 5, trunk_link: 5, primary_link: 5, secondary_link: 5, tertiary_link: 5,
  unclassified: 5.5, residential: 6, living_street: 5, service: 4, track: 3.5, raceway: 10, road: 6,
};

/** OSM highway to the vector tiles' (OpenMapTiles) street class. */
const STREET_CLASS: Record<string, string> = {
  motorway: "motorway", trunk: "trunk",
  primary: "primary", primary_link: "primary",
  secondary: "secondary", secondary_link: "secondary",
  tertiary: "tertiary", tertiary_link: "tertiary",
  residential: "minor", unclassified: "minor", living_street: "minor", road: "minor",
  service: "service", track: "track",
};

function wayWidth(t: Tags): number | undefined {
  const w = parseFloat(t.width ?? t.est_width);
  if (w > 2 && w < 30) return w;
  const lanes = parseInt(t.lanes, 10);
  if (lanes >= 1 && lanes <= 7) return Math.max(3.5, lanes * 3.2);
  return Object.hasOwn(HIGHWAY_WIDTH, t.highway) ? HIGHWAY_WIDTH[t.highway] : undefined;
}

/** Power lines on poles: distribution lines (minor_line, or line at 33 kV or less); towers carry more. */
function onPoles(t: Tags): boolean {
  if (t.power === "minor_line") return true;
  const volts = (t.voltage ?? "").split(";").map(Number).filter((v) => v > 0);
  return volts.length > 0 && Math.max(...volts) <= 33000;
}

const emptyFeatures = (): OsmFeatures => ({
  buildings: [], guardRails: [], roundaboutRings: [], poles: [], lamps: [], powerLines: [], barriers: [], groynes: [], cattleGrids: [], unsealed: [],
});

/** Overpass data near the route (and over the areas): widths, rings, rails, poles, lamps, lines, barriers, streets... */
export async function fetchOsm(
  routeCoords: LngLat[],
  areas: LngLat[][] = [],
  want: { cattleGrids?: boolean; trafficSignals?: boolean } = {},
): Promise<OsmData> {
  if (!routeCoords.length) throw new Error("fetchOsm needs at least one route point");
  const signals = want.trafficSignals ? fetchSignals(routeCoords, areas) : Promise.resolve(undefined);
  const { query, polygons } = mainQuery(routeCoords, areas, !!want.cattleGrids);
  let elements: Element[] | null = null;
  try {
    elements = await overpass(query, { abortMs: polygons ? 95_000 : 45_000, waitMs: 5_000, needElements: false });
  } catch {
    warnMissing("OpenStreetMap (Overpass): roundabouts, road widths, poles, lights, fences");
  }
  const found = await signals;
  if (!elements) {
    const features = emptyFeatures();
    if (found !== undefined) features.trafficSignals = found;
    return { features };
  }
  const data = readElements(elements, routeCoords[0][1]);
  if (found !== undefined) data.features.trafficSignals = found;
  return data;
}

function readElements(elements: Element[], lat: number): OsmData {
  const f = emptyFeatures();
  const widths: Way[] = [];
  const roads: NonNullable<OsmData["roads"]> = [];
  for (const e of elements) {
    const t = e.tags ?? {};
    if (e.type === "node") {
      if (e.lat === undefined || e.lon === undefined) continue;
      const at: LngLat = [e.lon, e.lat];
      if (t.power === "pole") f.poles!.push(at);
      else if (t.highway === "street_lamp") f.lamps!.push(at);
      else if (t.barrier === "cattle_grid") f.cattleGrids!.push(at);
      continue;
    }
    if (e.type !== "way" || !e.geometry) continue;
    const pts = geomOf(e);
    if (t.power === "line" || t.power === "minor_line") {
      if (onPoles(t)) f.powerLines!.push(pts);
    } else if (t.man_made === "groyne" || t.man_made === "breakwater") {
      f.groynes!.push(pts);
    } else if (t.junction === "roundabout" || t.junction === "circular") {
      const ring: { pts: LngLat[]; lanes?: number } = { pts };
      const lanes = parseInt(t.lanes, 10);
      if (lanes >= 1 && lanes <= 4) ring.lanes = lanes;
      f.roundaboutRings!.push(ring);
    } else if (t.barrier === "fence" || t.barrier === "wall" || t.barrier === "hedge" || t.barrier === "retaining_wall") {
      const height = parseFloat(t.height);
      f.barriers!.push({ pts, kind: t.barrier, fenceType: t.fence_type, material: t.material, height: Number.isFinite(height) ? height : undefined });
    } else if (t.barrier === "guard_rail") {
      f.guardRails.push(pts);
    } else if (t.highway) {
      const width = wayWidth(t);
      if (width !== undefined) widths.push({ width, pts });
      const unsealed = isUnsealed(t.surface, t.highway, t.tracktype);
      if (unsealed && t.area !== "yes") f.unsealed!.push(pts);
      const cls = STREET_CLASS[t.highway];
      if (!cls || !Object.hasOwn(STREET_CLASS, t.highway)) continue;
      const kerb = kerbsideFromTags(t);
      if (kerb) (f.kerbside ??= []).push({ pts, ...kerb });
      if (t.area === "yes" || t.access === "no" || t.access === "private") continue;
      const road: (typeof roads)[number] = { pts, cls };
      if (t.bridge && t.bridge !== "no") road.brunnel = "bridge";
      else if (t.tunnel && t.tunnel !== "no") road.brunnel = "tunnel";
      if (t.oneway === "yes" || t.oneway === "1") road.oneway = 1;
      else if (t.oneway === "-1") road.oneway = -1;
      if (t.service !== undefined) road.service = t.service;
      if (unsealed) road.surface = "unpaved";
      roads.push(road);
    }
  }
  return { features: f, widthAt: widths.length ? widthLookup(widths, lat) : undefined, roads: joinWays(roads) };
}

/** p => the width of the way with the nearest segment within 12 m of p. */
export function widthLookup(ways: Way[], lat: number): (p: LngLat) => number | undefined {
  return nearestLine(ways.map((w) => ({ pts: w.pts, value: w.width })), lat, 12);
}

/* ---------------- joining split ways ---------------- */

type Joinable = { pts: LngLat[]; cls: string; oneway?: 1 | -1; brunnel?: string; service?: string; surface?: string };

/**
 * Joins ways end to end where exactly two ways of the same kind meet, so a street OSM split
 * where a tag changes is one line again. Closed ways never join. Input isn't changed; the result
 * keeps the original slot order (the merged way takes the first way's slot).
 */
export function joinWays<T extends Joinable>(ways: T[]): T[] {
  const key = (p: LngLat) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const list: T[] = ways.map((w) => ({ ...w, pts: w.pts.slice() }));
  const live = list.map(() => true);
  const index = new Map<string, number[]>();
  const add = (k: string, i: number) => {
    const at = index.get(k);
    if (at) at.push(i);
    else index.set(k, [i]);
  };
  const first = (w: T) => key(w.pts[0]);
  const last = (w: T) => key(w.pts[w.pts.length - 1]);
  list.forEach((w, i) => {
    add(first(w), i);
    add(last(w), i);
  });
  const sameKind = (a: T, b: T) =>
    a.cls === b.cls && a.brunnel === b.brunnel && a.service === b.service && a.surface === b.surface && !!a.oneway === !!b.oneway;
  const closed = (w: T) => first(w) === last(w);

  const tryJoin = (k: string, at: number[]): boolean => {
    const ids: number[] = [];
    for (const i of at) if (live[i] && !ids.includes(i)) ids.push(i);
    if (ids.length !== 2) return false;
    const [ia, ib] = ids;
    const a = list[ia], b = list[ib];
    if (!sameKind(a, b) || closed(a) || closed(b)) return false;
    const aEnds = last(a) === k, bStarts = first(b) === k;
    if (a.oneway) {
      const aIn = aEnds ? a.oneway === 1 : a.oneway === -1;
      const bOut = bStarts ? b.oneway === 1 : b.oneway === -1;
      if (aIn !== bOut) return false;
    }
    const ap = aEnds ? a.pts : a.pts.slice().reverse();
    const bp = bStarts ? b.pts : b.pts.slice().reverse();
    const merged: T = { ...a, pts: [...ap, ...bp.slice(1)] };
    if (a.oneway && !aEnds) merged.oneway = -a.oneway as 1 | -1;
    list[ia] = merged;
    live[ib] = false;
    index.delete(k);
    add(first(merged), ia);
    add(last(merged), ia);
    return true;
  };

  let joined = true;
  while (joined) {
    joined = false;
    for (const [k, at] of index) {
      if (tryJoin(k, at)) {
        joined = true;
        break;
      }
    }
  }
  return list.filter((_, i) => live[i]);
}

/* ---------------- what stands on a jetty ---------------- */

/** Railways, platforms and buildings over a jetty's box [west, south, east, north] (docs/jetty.md). */
export async function fetchPierFeatures(box: [number, number, number, number]): Promise<{
  railways: LngLat[][];
  platforms: { pts: LngLat[]; shelter: boolean }[];
  buildings: { pts: LngLat[]; name: string }[];
}> {
  const [w, s, e, n] = box;
  const B = `${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)}`;
  const query =
    `[out:json][timeout:40];(` +
    `\n    way(${B})[railway~"^(narrow_gauge|miniature|light_rail|tram|rail)$"];` +
    `\n    way(${B})[railway=platform];` +
    `\n    way(${B})[public_transport=platform];` +
    `\n    way(${B})[building];` +
    `\n  );out tags geom;`;
  const out = { railways: [] as LngLat[][], platforms: [] as { pts: LngLat[]; shelter: boolean }[], buildings: [] as { pts: LngLat[]; name: string }[] };
  let elements: Element[];
  try {
    elements = await overpass(query, { abortMs: 45_000, waitMs: 4_000, needElements: true });
  } catch {
    const [bw, bs, be, bn] = JETTY_SNAPSHOT_BOX;
    if (w < be && e > bw && s < bn && n > bs) return JETTY_SNAPSHOT;
    warnMissing("jetty features (OSM: its railway, platforms, buildings)");
    return out;
  }
  for (const el of elements) {
    if (el.type !== "way" || !el.geometry) continue;
    const pts = geomOf(el);
    if (pts.length < 2) continue;
    const t = el.tags ?? {};
    if (t.railway === "platform" || t.public_transport === "platform") out.platforms.push({ pts, shelter: t.shelter === "yes" });
    else if (t.railway) out.railways.push(pts);
    else if (t.building && pts.length >= 3) out.buildings.push({ pts, name: t.name ?? "" });
  }
  return out;
}
