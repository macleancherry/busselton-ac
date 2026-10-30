// Busselton fork: traffic density zones and the kids' setting, for data/traffic.json (traffic.ts).
//
// What CSP's traffic planner reads (acc-lua-internal, included-tools/traffic, by x4fab, CC0;
// checked against main as of 17 Aug 2026):
//  - It has no density per lane or per area. The number of cars is one global figure: the
//    planner's "Cars" slider, or TRAFFIC_DENSITY ("Cars limit") in the Traffic mode's settings.
//    New cars drop onto a lane picked at random, weighted by lane length
//    (TrafficPath.tryCreateWandering), then wander, choosing at random at each intersection
//    among the exits it allows (TrafficGraph.findRandomEdgeFrom).
//  - A lane's speed limit and priority come from its role (rules.laneRoles); the `speedLimit` and
//    `priority` written on the lane itself are replaced by the role's when the file is loaded
//    (EditorLane.finalize).
//  - Areas (polygons, `areas[].shapes`) override, for every lane point inside them, the role
//    (priority), the speed limit (`customSpeedLimit` + `speedLimit`), lane changes, U-turns and
//    `spreadMult` (sideways spread, not density) (TrafficArea, SerializedTypes.lua).
//  - Intersections can forbid a turn: `disallowedTrajectories`, pairs of [from lane id, to lane id]
//    (TrafficIntersection).
//
// So the zones are written in those terms:
//  - Speed and priority: a role per zone and speed ("Busy street 60", "Quiet street 50", ...); a lane
//    takes the role of most of its length, and where part of a lane (the route, mostly) is in another
//    zone an area gives that stretch its own role and limit.
//  - Density: cars spawn evenly per metre of lane everywhere, so quiet streets are made quiet by
//    letting only some of the turns from busy roads into them (QUIET_ENTRY of them, picked by a fixed
//    hash): through traffic stays on the main roads, residential streets carry mostly their own.
//  - The overall number of cars can't be set from the track: the file carries a suggested figure
//    (`busselton.cars`) for the planner's slider or the Traffic mode, lower in the kids' setting.

import type { LngLat, Vec2 } from "./geo";

/** Highway (motorway, trunk), busy (primary to tertiary), the town centre, quiet (residential and the rest); roundabout rings. */
export type TrafficZone = "highway" | "busy" | "centre" | "quiet" | "roundabout";
/** "kids": calmer traffic, lower speed limits and fewer cars. */
export type TrafficSetting = "normal" | "kids";

interface ZoneRule {
  label: string;
  priority: number;
  /** Speed limit in this zone from the road's own, km/h. */
  speed: (roadSpeed: number) => number;
  /** The kids' setting's cap, km/h. */
  kids: number;
}

/** Town centre limit: the City of Busselton's CBD 40 km/h zone (proposed April 2023: West St, Albert St, Brown St, the foreshore). */
export const CENTRE_SPEED = 40;

export const ZONES: Record<TrafficZone, ZoneRule> = {
  quiet: { label: "Quiet street", priority: -4, speed: (s) => Math.min(s, 50), kids: 30 },
  centre: { label: "Town centre", priority: 0, speed: (s) => Math.min(s, CENTRE_SPEED), kids: 30 },
  busy: { label: "Busy street", priority: 2, speed: (s) => s, kids: 40 },
  highway: { label: "Highway", priority: 4, speed: (s) => s, kids: 60 },
  roundabout: { label: "Roundabout", priority: 6, speed: () => 30, kids: 20 },
};

/** Share of the turns from a busy road into a quiet street that stay allowed. */
export const QUIET_ENTRY = 0.4;

/** Suggested car count, from the lane length: normal and kids. */
export function suggestedCars(laneKm: number, setting: TrafficSetting): number {
  return setting === "kids"
    ? Math.max(20, Math.min(150, Math.round(laneKm)))
    : Math.max(50, Math.min(800, Math.round((laneKm * 4) / 10) * 10));
}

/** The zone of a road point from its OpenMapTiles class, its speed limit and whether it's in the town centre. */
export function zoneOf(cls: string | undefined, speed: number, inCentre: boolean): TrafficZone {
  if (cls && /^(motorway|trunk)/.test(cls)) return "highway";
  if (inCentre) return "centre";
  if (cls && /^(primary|secondary|tertiary)/.test(cls)) return "busy";
  if (cls) return "quiet";
  // Class unknown (no tile road within reach): go by the limit.
  return speed >= 60 ? "busy" : "quiet";
}

/** Point-of-interest classes (OpenMapTiles poi layer) that make a shopping street. */
const SHOPPY = /^(shop|grocery|clothing_store|alcohol_shop|bakery|butcher|books|gift|jewelry|mobile_phone|optician|hairdresser|beauty|florist|cafe|restaurant|fast_food|bar|pub|beer|ice_cream|bank|atm|pharmacy|post|library|cinema|theatre|town_hall|marketplace|department_store|hardware|furniture|music|art_gallery)$/;

/**
 * The town centre: within 25 m of a retail or commercial landuse polygon (OSM landuse, via the
 * tiles), or with at least 8 shops, cafes and the like within 100 m.
 */
export function townCentreTest(landuse: { ring: Vec2[]; cls: string }[], pois: { at: Vec2; cls: string }[]): (p: Vec2) => boolean {
  const polys = landuse.filter((l) => /^(retail|commercial)$/.test(l.cls) && l.ring.length >= 3).map((l) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of l.ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { ring: l.ring, box: [x0 - 25, y0 - 25, x1 + 25, y1 + 25] };
  });
  const shops = pois.filter((p) => SHOPPY.test(p.cls)).map((p) => p.at);
  // Shops in 50 m cells, for the count.
  const cells = new Map<string, Vec2[]>();
  for (const s of shops) {
    const k = `${Math.floor(s[0] / 50)},${Math.floor(s[1] / 50)}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k)!.push(s);
  }
  return (p) => {
    for (const { ring, box } of polys) {
      if (p[0] < box[0] || p[0] > box[2] || p[1] < box[1] || p[1] > box[3]) continue;
      if (inPolygon(ring, p) || distToRing(ring, p) < 25) return true;
    }
    let n = 0;
    const cx = Math.floor(p[0] / 50), cy = Math.floor(p[1] / 50);
    for (let a = -2; a <= 2; a++) {
      for (let b = -2; b <= 2; b++) {
        for (const s of cells.get(`${cx + a},${cy + b}`) ?? []) if (Math.hypot(s[0] - p[0], s[1] - p[1]) < 100) n++;
      }
    }
    return n >= 8;
  };
}

/** The same test from map data in [lng, lat], with a projection to local metres. */
export function townCentreFromMap(
  toLocal: (p: LngLat) => Vec2,
  landuse: { ring: LngLat[]; cls: string }[] | undefined,
  pois: { at: LngLat; cls: string }[] | undefined,
): (p: Vec2) => boolean {
  return townCentreTest(
    (landuse ?? []).map((l) => ({ ring: l.ring.map(toLocal), cls: l.cls })),
    (pois ?? []).map((p) => ({ at: toLocal(p.at), cls: p.cls })),
  );
}

export function inPolygon(poly: Vec2[], p: Vec2): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function distToRing(ring: Vec2[], p: Vec2): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t));
  }
  return best;
}

/**
 * Each road's zone per point: `cls` is its OpenMapTiles class (one for the road, or one per point),
 * `speeds` its limit per point when it changes along it.
 */
export function zoneRoads<R extends { pts: Vec2[]; speed: number; speeds?: number[]; cls?: string | (string | undefined)[] }>(
  roads: R[], centre: (p: Vec2) => boolean,
): (Omit<R, "cls"> & { zone: TrafficZone[] })[] {
  return roads.map(({ cls, ...r }) => ({
    ...r,
    zone: smoothZones(r.pts, r.pts.map((p, i) => zoneOf(Array.isArray(cls) ? cls[i] : cls, r.speeds?.[i] ?? r.speed, centre(p)))),
  }));
}

/**
 * Runs of a zone shorter than `min` metres take the zone before them (or after, at the start): a
 * point's class comes from the nearest tile road, which flickers to a side street's at junctions.
 */
export function smoothZones(pts: Vec2[], zone: TrafficZone[], min = 40): TrafficZone[] {
  const out = zone.slice();
  const runs: { a: number; b: number; len: number }[] = [];
  for (let i = 0; i < out.length;) {
    let j = i;
    while (j + 1 < out.length && out[j + 1] === out[i]) j++;
    let len = 0;
    for (let k = Math.max(1, i); k <= Math.min(out.length - 1, j + 1); k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    runs.push({ a: i, b: j, len });
    i = j + 1;
  }
  if (runs.length < 2) return out;
  runs.forEach((r, k) => {
    if (r.len >= min) return;
    const z = k > 0 ? out[runs[k - 1].b] : out[runs[k + 1].a];
    for (let i = r.a; i <= r.b; i++) out[i] = z;
  });
  return out;
}

// ---- Writing the zones into the planner's terms ----

interface Role { name: string; priority: number; speedLimit: number; zone: TrafficZone }
interface LaneOut { id: number; loop: boolean; role: number; priority: number; speedLimit: number; points: [number, number, number][] }
interface InterOut { id: number; points: [number, number, number][]; disallowedTrajectories?: [number, number][] }
interface AreaOut { name: string; id: number; shapes: [number, number, number][][]; params: Record<string, unknown> }
export interface ZoneMeta {
  setting: TrafficSetting;
  /** Suggested car count for the planner's "Cars" slider or the Traffic mode's "Cars limit". */
  cars: number;
  /** Lane length per zone, km. */
  zones: Partial<Record<TrafficZone, number>>;
  /** Share of busy-to-quiet turns left allowed. */
  quietEntry: number;
}

const speedStep = (s: number) => Math.max(10, Math.round(s / 10) * 10);

/** A small fixed hash in [0, 1), so the same graph always forbids the same turns. */
function hash01(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) {
    h ^= v & 0xffff;
    h = Math.imul(h, 16777619);
    h ^= v >>> 16;
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** The strip polygon (AC x, z) round a run of lane points, `half` metres each side, at their heights. */
function strip(pts: [number, number, number][], half: number): [number, number, number][] {
  const n = pts.length;
  const side = (k: 1 | -1) => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1;
    return [+(p[0] - (dz / L) * half * k).toFixed(2), +p[1].toFixed(2), +(p[2] + (dx / L) * half * k).toFixed(2)] as [number, number, number];
  });
  return [...side(1), ...side(-1).reverse()];
}

/**
 * Roles, areas and forbidden turns from each lane's zone and speed per point. Rewrites the lanes'
 * role, priority and speed limit in place; returns the roles, the areas, and sets
 * `disallowedTrajectories` on intersections.
 */
export function zoneGraph(
  lanes: LaneOut[], laneInfo: { zone: TrafficZone[]; speed: number[] }[], intersections: InterOut[],
): { roles: Role[]; areas: AreaOut[]; meta: ZoneMeta } {
  // 1. A role per zone and (rounded) speed.
  const key = (z: TrafficZone, s: number) => `${z}:${s}`;
  const found = new Map<string, Role>();
  const pointRole: string[][] = laneInfo.map((info) => info.zone.map((z, i) => {
    const s = speedStep(ZONES[z].speed(info.speed[i]));
    const k = key(z, s);
    if (!found.has(k)) found.set(k, { name: `${ZONES[z].label} ${s}`, priority: ZONES[z].priority, speedLimit: s, zone: z });
    return k;
  }));
  const roles = [...found.values()].sort((a, b) => a.priority - b.priority || a.speedLimit - b.speedLimit);
  const roleIndex = new Map(roles.map((r, i) => [key(r.zone, r.speedLimit), i + 1]));

  // 2. Each lane takes the role of most of its points; other stretches get an area.
  const shapes = new Map<number, [number, number, number][][]>();
  const km: Partial<Record<TrafficZone, number>> = {};
  lanes.forEach((lane, li) => {
    const keys = pointRole[li];
    const count = new Map<string, number>();
    for (const k of keys) count.set(k, (count.get(k) ?? 0) + 1);
    const main = [...count.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    const r = roleIndex.get(main)!;
    lane.role = r;
    lane.priority = roles[r - 1].priority;
    lane.speedLimit = roles[r - 1].speedLimit;
    for (let i = 1; i < lane.points.length; i++) {
      const z = laneInfo[li].zone[i];
      km[z] = (km[z] ?? 0) + Math.hypot(lane.points[i][0] - lane.points[i - 1][0], lane.points[i][2] - lane.points[i - 1][2]) / 1000;
    }
    for (let i = 0; i < keys.length;) {
      let j = i;
      while (j + 1 < keys.length && keys[j + 1] === keys[i]) j++;
      if (keys[i] !== main) {
        // The run, a point further each way so the area covers its ends.
        const run = lane.points.slice(Math.max(0, i - 1), Math.min(keys.length, j + 2));
        if (run.length >= 2) {
          const ri = roleIndex.get(keys[i])!;
          if (!shapes.has(ri)) shapes.set(ri, []);
          shapes.get(ri)!.push(strip(run, 1.2));
        }
      }
      i = j + 1;
    }
  });
  let areaId = 1;
  const areas: AreaOut[] = [...shapes.entries()].sort((a, b) => a[0] - b[0]).map(([ri, sh]) => ({
    name: roles[ri - 1].name,
    id: areaId++,
    shapes: sh,
    params: { role: ri, customSpeedLimit: true, speedLimit: roles[ri - 1].speedLimit },
  }));

  // 3. Density: only some turns from busy roads into quiet streets.
  const local = (p: [number, number, number]): Vec2 => [p[0], p[2]];
  const polys = intersections.map((it) => {
    const ring = it.points.map(local);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    return { ring, box: [x0, z0, x1, z1] };
  });
  // Lanes touching each intersection: how (enters, leaves, passes) and their zone there.
  type Touch = { lane: number; enters: boolean; leaves: boolean; zone: TrafficZone };
  const touches: Touch[][] = intersections.map(() => []);
  lanes.forEach((lane, li) => {
    const n = lane.points.length;
    const inside = new Map<number, number[]>();
    lane.points.forEach((p, i) => {
      polys.forEach((poly, k) => {
        const [x0, z0, x1, z1] = poly.box;
        if (p[0] < x0 || p[0] > x1 || p[2] < z0 || p[2] > z1 || !inPolygon(poly.ring, local(p))) return;
        if (!inside.has(k)) inside.set(k, []);
        inside.get(k)!.push(i);
      });
    });
    for (const [k, idx] of inside) {
      const first = idx[0] === 0 && !lane.loop, last = idx[idx.length - 1] === n - 1 && !lane.loop;
      const mid = idx[idx.length >> 1];
      // A busy road's zone where it arrives, a quiet street's where it leaves.
      touches[k].push({ lane: li, enters: !first, leaves: !last, zone: laneInfo[li].zone[mid] });
    }
  });
  const quietish = (z: TrafficZone) => z === "quiet";
  intersections.forEach((it, k) => {
    const t = touches[k];
    const dis: [number, number][] = [];
    for (const from of t) {
      if (!from.enters || quietish(from.zone)) continue;
      const exits = t.filter((o) => o.leaves && o.lane !== from.lane);
      const blocked = exits.filter((to) => quietish(to.zone) && hash01(it.id, lanes[from.lane].id, lanes[to.lane].id) >= QUIET_ENTRY);
      // A lane that ends here must keep a way on.
      const keepsOn = from.leaves || exits.length > blocked.length;
      const block = keepsOn ? blocked : blocked.slice(1);
      for (const to of block) dis.push([lanes[from.lane].id, lanes[to.lane].id]);
    }
    if (dis.length) it.disallowedTrajectories = dis;
    else delete it.disallowedTrajectories;
  });

  const laneKm = Object.values(km).reduce((a, b) => a + (b ?? 0), 0);
  for (const z of Object.keys(km) as TrafficZone[]) km[z] = +km[z]!.toFixed(2);
  return { roles, areas, meta: { setting: "normal", cars: suggestedCars(laneKm, "normal"), zones: km, quietEntry: QUIET_ENTRY } };
}

/** Role zones for the planner's roles a graph without zones uses (traffic.ts ROLES), by name. */
const LEGACY: Record<string, TrafficZone> = { "Local street": "quiet", "Town road": "busy", "Main road": "busy", Highway: "highway", Roundabout: "roundabout" };

/**
 * data/traffic.json in a setting. "kids": every role's and area's limit capped at the zone's kids'
 * figure (30 on quiet streets and in the centre, 40 on busy roads, 20 round roundabouts), and a
 * lower suggested car count. "normal" returns it unchanged. Works on a file with or without zones.
 */
export function trafficForSetting(json: string, setting: TrafficSetting): string {
  const data = JSON.parse(json);
  if (setting !== "kids") return json;
  const roles: (Role & { zone?: TrafficZone })[] = data.rules?.laneRoles ?? [];
  for (const r of roles) {
    const z = r.zone ?? LEGACY[r.name] ?? "busy";
    r.speedLimit = Math.min(r.speedLimit, ZONES[z].kids);
    if (r.zone) r.name = `${ZONES[z].label} ${r.speedLimit}`;
  }
  // Roles that now match (busy 50 and busy 60 both capped at 40) become one.
  const keep: typeof roles = [];
  const remap = roles.map((r) => {
    const k = keep.findIndex((o) => o.name === r.name && o.priority === r.priority && o.speedLimit === r.speedLimit);
    if (k >= 0) return k + 1;
    keep.push(r);
    return keep.length;
  });
  if (data.rules) data.rules.laneRoles = keep;
  const roleAt = (i: number) => (i >= 1 && i <= remap.length ? remap[i - 1] : i);
  for (const l of data.lanes ?? []) {
    l.role = roleAt(l.role);
    const r = keep[l.role - 1];
    if (r) {
      l.speedLimit = r.speedLimit;
      l.priority = r.priority + (l.priorityOffset ?? 0);
    }
  }
  for (const a of data.areas ?? []) {
    if (a.params?.role) a.params.role = roleAt(a.params.role);
    const r = keep[(a.params?.role ?? 0) - 1];
    if (r && a.params.customSpeedLimit) {
      a.params.speedLimit = r.speedLimit;
      a.name = r.name;
    }
  }
  let laneKm = 0;
  for (const l of data.lanes ?? []) {
    for (let i = 1; i < l.points.length; i++) laneKm += Math.hypot(l.points[i][0] - l.points[i - 1][0], l.points[i][2] - l.points[i - 1][2]) / 1000;
  }
  data.busselton = { ...(data.busselton ?? { zones: {}, quietEntry: 1 }), setting: "kids", cars: suggestedCars(laneKm, "kids") };
  return JSON.stringify(data);
}
