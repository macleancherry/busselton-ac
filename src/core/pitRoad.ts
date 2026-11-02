// Busselton fork: a circuit's pit lane and paddock road as drivable, valid asphalt (build.pitLane).
//
// A circuit's pit boxes stand in its paddock, and nothing paved joined them to the track: Collie
// Motorplex's 12 verandah bays stood on grass (layout_check: "12 off the road"). OSM rarely maps a
// pit lane well enough to build from (Collie's paddock has one service road, the access from the
// tunnel, not the pit lane), so the route traces it by hand: a polyline from the pit entry (on the
// track) through the paddock past the boxes to the pit exit (on the track), each point with an
// optional width, so the paddock apron in front of the boxes is the lane's wide stretch.
//
// It's built as a side street (sideStreets.ts) of class "pitlane": cut where it meets the track and
// joined to the track's edge like any street, draped on the ground with the terrain held under it,
// never retraced from the photo. Its mesh is `1ROAD_PIT_..` (valid track, unlike `1STREET`), with
// white edge lines. Its ground is part of the build's area (a corridor round the lane), so a lane
// that leaves the track's corridor still has detailed ground. pitLane.ts runs pit_lane.ai along it.
import type { LngLat, Vec2 } from "./geo";
import { driveRings } from "./layoutDrives";
import type { PitPath } from "./pitLane";
import type { SideStreet, StreetLine } from "./sideStreets";

/** A pit lane: points [lng, lat] or [lng, lat, width m], in the direction of travel (or reversed). */
export interface PitLaneOption {
  points: ([number, number] | [number, number, number])[];
  /** Width where a point gives none, metres; absent = PIT_WIDTH. */
  width?: number;
}

/** The side-street class a pit lane is built as. */
export const PIT_CLASS = "pitlane";
/** A pit lane's default width, metres (a single-file lane with room to pass a parked car). */
export const PIT_WIDTH = 8;
/** Ground built either side of the lane beyond its own half width, metres. */
export const PIT_GROUND = 20;

/** The option's points (lng, lat) and their widths; null without at least two points. */
export function pitLanePoints(opt: PitLaneOption | undefined): { pts: LngLat[]; widths: number[] } | null {
  const raw = (opt?.points ?? []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (raw.length < 2) return null;
  const base = opt?.width && opt.width > 0 ? opt.width : PIT_WIDTH;
  return {
    pts: raw.map((p) => [p[0], p[1]] as LngLat),
    widths: raw.map((p) => (p.length > 2 && Number(p[2]) > 0 ? Number(p[2]) : base)),
  };
}

/** The lane as a street line for planSideStreets (its narrowest width; the widths go on after). */
export function pitLaneLine(opt: PitLaneOption | undefined): StreetLine | null {
  const lane = pitLanePoints(opt);
  if (!lane) return null;
  return { pts: lane.pts, cls: PIT_CLASS, surface: "asphalt", width: Math.min(...lane.widths) };
}

/** The area polygons (local metres) round the lane, so its ground is built (layoutDrives.ts driveRings). */
export function pitLaneRings(opt: PitLaneOption | undefined, toLocal: (p: LngLat) => Vec2): Vec2[][] {
  const lane = pitLanePoints(opt);
  if (!lane) return [];
  return driveRings(lane.pts.map(toLocal), Math.max(...lane.widths) / 2 + PIT_GROUND);
}

/** The lane's width at a local point: the widths interpolated along the nearest stretch of the option's line. */
export function pitWidthAt(line: Vec2[], widths: number[], p: Vec2): number {
  let best = Infinity, w = widths[0];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
    if (d < best) { best = d; w = widths[i - 1] + (widths[i] - widths[i - 1]) * t; }
  }
  return w;
}

/** Gives the planned pit-lane streets their per-point widths (in place). Other streets are left alone. */
export function applyPitWidths(streets: SideStreet[], opt: PitLaneOption | undefined, toLocal: (p: LngLat) => Vec2): void {
  const lane = pitLanePoints(opt);
  if (!lane) return;
  const line = lane.pts.map(toLocal);
  for (const st of streets) {
    if (st.cls !== PIT_CLASS) continue;
    st.widths = st.pts.map((p) => pitWidthAt(line, lane.widths, p));
    st.width = Math.max(...st.widths);
  }
}

/** The lane's centreline, local, every `step` metres (for pit_lane.ai); empty without a lane. */
export function pitLaneLocal(opt: PitLaneOption | undefined, toLocal: (p: LngLat) => Vec2, step = 2): Vec2[] {
  const lane = pitLanePoints(opt);
  if (!lane) return [];
  const pts = lane.pts.map(toLocal);
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/**
 * The lane for pit_lane.ai (pitLane.ts pitLaneAlong): its centreline every 2 m in AC space, at the
 * built surface (`height`, local x, y; where it has none, the last height found, else 0), with widths.
 */
export function pitLanePath(opt: PitLaneOption | undefined, toLocal: (p: LngLat) => Vec2, height: (x: number, y: number) => number | null): PitPath | null {
  const lane = pitLanePoints(opt);
  if (!lane) return null;
  const line = lane.pts.map(toLocal);
  const pts = pitLaneLocal(opt, toLocal);
  const hs = pts.map(([x, y]) => height(x, y));
  const known = hs.find((h): h is number => h !== null) ?? 0;
  let prev = known;
  return {
    pts: pts.map(([x, y], k) => {
      const h = hs[k] ?? prev;
      prev = h;
      return [x, h, -y] as [number, number, number];
    }),
    widths: pts.map((p) => pitWidthAt(line, lane.widths, p)),
  };
}
