// Road routing (OSRM), place search (Photon / Nominatim) and road widths
// (Overpass). All keyless public services; the browser's Referer identifies
// the app, as their usage policies ask.

import { warnMissing } from "./dataWarnings";
import { JETTY_SNAPSHOT, JETTY_SNAPSHOT_BOX } from "./jettySnapshot";
import { haversine, type LngLat } from "../core/geo";
import { trimSpurs } from "../core/spurs";
import { kerbsideFromTags } from "../core/kerbside";
import type { OsmFeatures } from "../core/track";
import type { RoundaboutHint } from "../core/roundabout";

const OSRM = "https://router.project-osrm.org";
const PHOTON = "https://photon.komoot.io/api/";
const NOMINATIM = "https://nominatim.openstreetmap.org";
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export interface Route {
  coords: LngLat[];
  distance: number;
  /** Where the route goes round a roundabout, with the arc it drives. */
  roundabouts: RoundaboutHint[];
  /** Where the route still turns back on itself (usually a pin snapped to the wrong side of the road). */
  uturns: LngLat[];
  /** U-turn spurs cut out of the route. */
  trimmed: LngLat[];
}

interface OsrmStep {
  maneuver: { type: string; modifier?: string; location: LngLat };
  geometry: { coordinates: LngLat[] };
}

/** Driving route through the pins, in order, on the real road network. */
export async function route(pins: LngLat[], signal?: AbortSignal): Promise<Route> {
  const path = pins.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(";");
  const r = await fetch(`${OSRM}/route/v1/driving/${path}?overview=full&geometries=geojson&steps=true&continue_straight=true`, { signal });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.code !== "Ok" || !body.routes?.length) {
    throw new Error(body.message || `Routing failed (HTTP ${r.status})`);
  }
  const steps: OsrmStep[] = body.routes[0].legs.flatMap((l: { steps: OsrmStep[] }) => l.steps);
  const roundabouts = steps
    .filter((st) => /^(roundabout|rotary|roundabout turn)$/.test(st.maneuver.type))
    .map((st) => ({ location: st.maneuver.location, arc: st.geometry.coordinates }));
  const uturns = steps.filter((st) => st.maneuver.modifier === "uturn").map((st) => st.maneuver.location);
  const coords: LngLat[] = body.routes[0].geometry.coordinates;
  const t = trimSpurs(coords, uturns);
  if (!t.cut.length) return { coords, distance: body.routes[0].distance, roundabouts, uturns, trimmed: [] };
  // A roundabout the route only went round to turn back is gone with the spur.
  const near = (p: LngLat) => t.coords.some((c) => haversine(c, p) < 30);
  return {
    coords: t.coords,
    distance: t.coords.slice(1).reduce((d, c, i) => d + haversine(t.coords[i], c), 0),
    roundabouts: roundabouts.filter((rb) => near(rb.location)),
    uturns: t.kept,
    trimmed: t.cut,
  };
}

export interface Place {
  label: string;
  detail: string;
  lngLat: LngLat;
  /** [minLng, maxLat, maxLng, minLat] when the place is an area. */
  extent?: [number, number, number, number];
}

/** Search-as-you-type (Photon is built for it; Nominatim's policy forbids it). */
export async function searchPlaces(q: string, near?: LngLat, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({ q, limit: "6" });
  if (near) {
    params.set("lon", near[0].toFixed(4));
    params.set("lat", near[1].toFixed(4));
  }
  const r = await fetch(`${PHOTON}?${params}`, { signal });
  if (!r.ok) return [];
  const body = await r.json();
  return (body.features ?? []).map((f: { properties: Record<string, string>; geometry: { coordinates: LngLat }; }) => {
    const p = f.properties as Record<string, unknown>;
    const label = String(p.name ?? p.street ?? p.city ?? "Unnamed");
    const detail = [p.street !== label ? p.street : null, p.city, p.state, p.country].filter(Boolean).join(", ");
    return { label, detail, lngLat: f.geometry.coordinates, extent: p.extent as Place["extent"] };
  });
}

export interface PlaceName {
  road?: string;
  town?: string;
  country?: string;
}

let lastNominatim = 0;

/** Road, town and country at a point (Nominatim, at most once a second). */
export async function reverseGeocode(p: LngLat): Promise<PlaceName> {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const r = await fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=16&lat=${p[1]}&lon=${p[0]}`);
  if (!r.ok) return {};
  const a = (await r.json()).address ?? {};
  return { road: a.road, town: a.town ?? a.village ?? a.city ?? a.suburb ?? a.county, country: a.country };
}

/** Typical asphalt width by OSM highway class, metres. */
const CLASS_WIDTH: Record<string, number> = {
  motorway: 7.5, trunk: 7.5, primary: 7.5, secondary: 7, tertiary: 6.5,
  motorway_link: 5, trunk_link: 5, primary_link: 5, secondary_link: 5, tertiary_link: 5,
  unclassified: 5.5, residential: 6, living_street: 5, service: 4, track: 3.5, raceway: 10, road: 6,
};

function wayWidth(tags: Record<string, string>): number | undefined {
  const w = parseFloat(tags.width ?? tags["est_width"] ?? "");
  if (w > 2 && w < 30) return w;
  const lanes = parseInt(tags.lanes ?? "", 10);
  if (lanes > 0 && lanes < 8) return Math.max(3.5, lanes * 3.2);
  return CLASS_WIDTH[tags.highway];
}

export interface Way {
  width: number;
  pts: LngLat[];
}

interface OverpassWay {
  type: string;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  /** Nodes only. */
  lat?: number;
  lon?: number;
}

/** A street's power line, on poles: minor_line, or line at distribution voltage (not towers). */
function onPoles(tags: Record<string, string>): boolean {
  if (tags.power === "minor_line") return true;
  if (tags.power !== "line") return false;
  const volts = (tags.voltage ?? "").split(";").map(Number).filter((v) => v > 0);
  return volts.length > 0 && Math.max(...volts) <= 33000;
}

export interface OsmData {
  /** Asphalt width at a point; undefined when Overpass was unreachable. */
  widthAt?: (p: LngLat) => number | undefined;
  features: OsmFeatures;
  /** Busselton fork: the drivable roads as street lines, in the vector tiles' classes (exact OSM geometry, for area builds). */
  roads?: { pts: LngLat[]; cls: string; brunnel?: string; oneway?: 1 | -1; service?: string }[];
}

/** OSM highway=* to the vector tiles' road classes (OpenMapTiles), for the ways a car can drive. */
const TILE_CLASS: Record<string, string> = {
  motorway: "motorway", trunk: "trunk", primary: "primary", primary_link: "primary", secondary: "secondary", secondary_link: "secondary",
  tertiary: "tertiary", tertiary_link: "tertiary", residential: "minor", unclassified: "minor", living_street: "minor", road: "minor",
  service: "service", track: "track",
};

/**
 * One Overpass query for the road ways under the route (for widths) and
 * guard rails. Every public mirror is asked at once and the first good
 * answer wins; if all fail, the build falls back to widths by road class
 * from the vector tiles. Buildings come from the vector tiles too.
 */
export async function fetchOsm(routeCoords: LngLat[], areas: LngLat[][] = []): Promise<OsmData> {
  const step = Math.max(1, Math.ceil(routeCoords.length / 180));
  const sampled = routeCoords.filter((_, i) => i % step === 0 || i === routeCoords.length - 1);
  const around = sampled.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(",");
  // Busselton fork: an area build wants the same things over its whole polygon.
  const polys = areas.filter((a) => a.length >= 3).map((a) => `poly:"${a.map((p) => `${p[1].toFixed(6)} ${p[0].toFixed(6)}`).join(" ")}"`);
  const poly = polys.length > 0;
  const inArea = polys.map((pl) => `
    way(${pl})[highway];
    way(${pl})[junction~"^(roundabout|circular)$"];
    node(${pl})[power=pole];
    node(${pl})[highway=street_lamp];
    way(${pl})[power~"^(line|minor_line)$"];
    way(${pl})[barrier~"^(fence|wall|hedge|retaining_wall)$"];`).join("");
  const query = `[out:json][timeout:${poly ? 90 : 40}];(
    way(around:12,${around})[highway];
    way(around:15,${around})[barrier=guard_rail];
    way(around:30,${around})[junction~"^(roundabout|circular)$"];
    node(around:40,${around})[power=pole];
    node(around:40,${around})[highway=street_lamp];
    way(around:40,${around})[power~"^(line|minor_line)$"];
    way(around:45,${around})[barrier~"^(fence|wall|hedge|retaining_wall)$"];
    way(around:300,${around})[man_made~"^(groyne|breakwater)$"];${inArea}
  );out tags geom;`;
  let elements: OverpassWay[] | undefined;
  // Every mirror at once; if they all fail (busy, timed out), wait and try again: without this data
  // the build loses roundabout rings and road widths, and quietly comes out different.
  for (let round = 0; round < 3 && !elements; round++) {
    if (round) await new Promise((ok) => setTimeout(ok, 5000 * round));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), poly ? 95000 : 45000);
    try {
      elements = await Promise.any(OVERPASS.map(async (url) => {
        const r = await fetch(url, { method: "POST", body: new URLSearchParams({ data: query }), signal: ctl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = await r.json();
        if (body.remark && /timed out|runtime error/i.test(body.remark)) throw new Error(body.remark);
        return ((body.elements ?? []) as OverpassWay[]).filter((e) => (e.type === "way" && e.geometry) || (e.type === "node" && e.lat !== undefined));
      }));
    } catch {
      // every mirror failed this round
    } finally {
      clearTimeout(timer);
      ctl.abort();
    }
  }
  if (!elements) warnMissing("OpenStreetMap (Overpass): roundabouts, road widths, poles, lights, fences");
  const features: OsmFeatures = { buildings: [], guardRails: [], roundaboutRings: [], poles: [], lamps: [], powerLines: [], barriers: [], groynes: [] };
  if (!elements) return { features };

  const ways: Way[] = [];
  const roads: NonNullable<OsmData["roads"]> = [];
  for (const e of elements) {
    const tags = e.tags ?? {};
    if (e.type === "node") {
      if (tags.power === "pole") features.poles!.push([e.lon!, e.lat!]);
      else if (tags.highway === "street_lamp") features.lamps!.push([e.lon!, e.lat!]);
      continue;
    }
    const pts = e.geometry!.map((g) => [g.lon, g.lat] as LngLat);
    if (tags.power === "line" || tags.power === "minor_line") {
      if (onPoles(tags)) features.powerLines!.push(pts);
    } else if (tags.man_made === "groyne" || tags.man_made === "breakwater") {
      features.groynes!.push(pts);
    } else if (tags.junction === "roundabout" || tags.junction === "circular") {
      const lanes = parseInt(tags.lanes ?? "", 10);
      features.roundaboutRings!.push({ pts, ...(lanes > 0 && lanes < 5 ? { lanes } : {}) });
    } else if (/^(fence|wall|hedge|retaining_wall)$/.test(tags.barrier ?? "")) {
      const height = parseFloat(tags.height ?? "");
      features.barriers!.push({
        pts, kind: tags.barrier as "fence" | "wall" | "hedge" | "retaining_wall",
        fenceType: tags.fence_type, material: tags.material, height: Number.isFinite(height) ? height : undefined,
      });
    } else if (tags.barrier === "guard_rail") {
      features.guardRails.push(pts);
    } else if (tags.highway) {
      const width = wayWidth(tags);
      if (width !== undefined) ways.push({ width, pts });
      const cls = TILE_CLASS[tags.highway];
      // Busselton fork: kerbside parking and bike lanes (kerbside.ts).
      const kerb = cls ? kerbsideFromTags(tags) : null;
      if (kerb) (features.kerbside ??= []).push({ pts, ...kerb });
      if (cls && tags.area !== "yes" && tags.access !== "no" && tags.access !== "private") {
        const oneway = tags.oneway === "yes" || tags.oneway === "1" ? 1 : tags.oneway === "-1" ? -1 : undefined;
        const brunnel = tags.bridge && tags.bridge !== "no" ? "bridge" : tags.tunnel && tags.tunnel !== "no" ? "tunnel" : undefined;
        roads.push({ pts, cls, ...(brunnel ? { brunnel } : {}), ...(oneway ? { oneway } : {}), ...(tags.service ? { service: tags.service } : {}) });
      }
    }
  }
  return { features, widthAt: ways.length ? widthLookup(ways, routeCoords[0][1]) : undefined, roads: joinWays(roads) };
}

export function widthLookup(ways: Way[], lat: number): (p: LngLat) => number | undefined {
  const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 111320;
  return (p) => {
    let best: number | undefined, bestD = 12 * 12;
    for (const w of ways) {
      for (let i = 1; i < w.pts.length; i++) {
        const ax = (w.pts[i - 1][0] - p[0]) * kx, ay = (w.pts[i - 1][1] - p[1]) * ky;
        const bx = (w.pts[i][0] - p[0]) * kx, by = (w.pts[i][1] - p[1]) * ky;
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
        const d = (ax + dx * t) ** 2 + (ay + dy * t) ** 2;
        if (d < bestD) {
          bestD = d;
          best = w.width;
        }
      }
    }
    return best;
  };
}

/**
 * Busselton fork: OSM splits a street into several ways wherever a tag changes; joined end to end
 * where only two ways of the same class meet, so a street is one line (the map tiles' lines are),
 * and the traffic lanes don't stop at a split with no junction there.
 */
export function joinWays<T extends { pts: LngLat[]; cls: string; oneway?: 1 | -1; brunnel?: string; service?: string }>(ways: T[]): T[] {
  const key = (p: LngLat) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const list = ways.map((w) => ({ ...w, pts: w.pts.slice() }));
  const alive = list.map(() => true);
  const ends = new Map<string, number[]>();
  const add = (i: number) => {
    for (const p of [list[i].pts[0], list[i].pts[list[i].pts.length - 1]]) {
      const k = key(p);
      ends.set(k, [...(ends.get(k) ?? []), i]);
    }
  };
  list.forEach((_, i) => add(i));
  const same = (a: T, b: T) => a.cls === b.cls && a.brunnel === b.brunnel && a.service === b.service && !!a.oneway === !!b.oneway;
  let joined = true;
  while (joined) {
    joined = false;
    for (const [k, ids] of ends) {
      const live = [...new Set(ids.filter((i) => alive[i]))];
      if (live.length !== 2) continue;
      const [a, b] = live.map((i) => list[i]);
      if (!same(a, b)) continue;
      // Orient a to end at k and b to start at k.
      const aEnd = key(a.pts[a.pts.length - 1]) === k, bStart = key(b.pts[0]) === k;
      if (a.oneway || b.oneway) {
        // One-way: only when they run on in the same direction through the shared point.
        const aOut = aEnd ? a.oneway === 1 : a.oneway === -1, bIn = bStart ? b.oneway === 1 : b.oneway === -1;
        if (aOut !== bIn) continue;
      }
      if (key(a.pts[0]) === key(a.pts[a.pts.length - 1])) continue; // a closed way
      const ap = aEnd ? a.pts : a.pts.slice().reverse();
      const bp = bStart ? b.pts : b.pts.slice().reverse();
      const flipA = !aEnd;
      const merged = { ...a, pts: [...ap, ...bp.slice(1)] } as T;
      if (a.oneway) merged.oneway = (flipA ? -a.oneway : a.oneway) as 1 | -1;
      const ia = list.indexOf(a), ib = list.indexOf(b);
      alive[ib] = false;
      list[ia] = merged;
      ends.delete(k);
      add(ia);
      joined = true;
      break;
    }
  }
  return list.filter((_, i) => alive[i]);
}

/**
 * Busselton fork: what stands on a jetty (docs/jetty.md): its railway, platforms (and whether they
 * have a shelter), and buildings on it or beside it, over the jetty's bounding box
 * [west, south, east, north]. Empty when Overpass doesn't answer (the jetty is still built, bare).
 */
export async function fetchPierFeatures(box: [number, number, number, number]): Promise<{
  railways: LngLat[][]; platforms: { pts: LngLat[]; shelter: boolean }[]; buildings: { pts: LngLat[]; name: string }[];
}> {
  const b = `${box[1].toFixed(6)},${box[0].toFixed(6)},${box[3].toFixed(6)},${box[2].toFixed(6)}`;
  const query = `[out:json][timeout:40];(
    way(${b})[railway~"^(narrow_gauge|miniature|light_rail|tram|rail)$"];
    way(${b})[railway=platform];
    way(${b})[public_transport=platform];
    way(${b})[building];
  );out tags geom;`;
  const empty = { railways: [], platforms: [], buildings: [] };
  for (let round = 0; round < 3; round++) {
    if (round) await new Promise((ok) => setTimeout(ok, 4000 * round));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45000);
    try {
      const elements: OverpassWay[] = await Promise.any(OVERPASS.map(async (url) => {
        const r = await fetch(url, { method: "POST", body: new URLSearchParams({ data: query }), signal: ctl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = await r.json();
        if (!Array.isArray(body.elements)) throw new Error("no elements");
        return body.elements;
      }));
      const out = { railways: [] as LngLat[][], platforms: [] as { pts: LngLat[]; shelter: boolean }[], buildings: [] as { pts: LngLat[]; name: string }[] };
      for (const e of elements) {
        const t = e.tags ?? {};
        const pts = (e.geometry ?? []).map((g) => [g.lon, g.lat] as LngLat);
        if (pts.length < 2) continue;
        if (t.railway === "platform" || t.public_transport === "platform") out.platforms.push({ pts, shelter: t.shelter === "yes" });
        else if (t.railway) out.railways.push(pts);
        else if (t.building && pts.length >= 3) out.buildings.push({ pts, name: t.name ?? "" });
      }
      return out;
    } catch {
      // every mirror failed this round
    } finally {
      clearTimeout(timer);
      ctl.abort();
    }
  }
  // Every mirror down: the Busselton Jetty has a snapshot (jettySnapshot.ts); anywhere else goes without.
  const [w, so, e, n] = JETTY_SNAPSHOT_BOX;
  if (box[0] < e && box[2] > w && box[1] < n && box[3] > so) return JETTY_SNAPSHOT;
  warnMissing("jetty features (OSM: its railway, platforms, buildings)");
  return empty;
}
