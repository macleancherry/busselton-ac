// The build context (track.md S1.1-4 and section 13): what is fixed once the route is known.
// The local frame, the slug, the clear circles that landmarks and layers stand in, the area, and
// the lng/lat converters every stage uses. Nothing here changes after makeContext.

import { Area, areaRings } from "../area";
import { layoutDriveRings } from "../layoutDrives";
import { slugify } from "../acFiles";
import { LocalProjection, type LngLat, type Vec2 } from "../geo";
import type { BuildOptions } from "../options";
import type { DataSources } from "./types";

export interface Clear { c: Vec2; r: number; trees: boolean }

export interface BuildContext {
  opts: BuildOptions;
  sources: DataSources;
  slug: string;
  /** The local frame's origin: opts.origin, else the middle of the route pins' box. */
  centre: LngLat;
  proj: LocalProjection;
  /** The route pins, local. */
  local: Vec2[];
  clears: Clear[];
  /**
   * In a clear circle. Buildings and things ask without `trees` (every circle clears them); trees
   * ask with `trees` true and only circles that clear trees count.
   */
  cleared(x: number, y: number, trees?: boolean): boolean;
  /** The area polygons as given (lng/lat). */
  areaRings: LngLat[][];
  area: Area | null;
  /** Every corner of the area, local (empty without one). */
  areaPts: Vec2[];
  toLocal(p: LngLat): Vec2;
  toLngLat(p: Vec2): LngLat;
  line(pts: LngLat[]): Vec2[];
}

export function makeContext(route: LngLat[], opts: BuildOptions, sources: DataSources): BuildContext {
  const lngs = route.map((p) => p[0]), lats = route.map((p) => p[1]);
  const centre: LngLat = opts.origin ?? [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  const proj = new LocalProjection(centre);
  const toLocal = (p: LngLat) => proj.toLocal(p);
  const clears: Clear[] = (opts.clears ?? []).map((c) => ({ c: toLocal(c.at), r: c.radius, trees: c.trees !== false }));
  const rings = areaRings(opts.area);
  // And round every layout's drive, so a layout leaving the main drive has its road (layoutDrives.ts).
  const driveAreas = layoutDriveRings(opts.layoutDrives, toLocal, opts.corridor);
  const area = rings.length || driveAreas.length ? new Area([...rings.map((r) => r.map(toLocal)), ...driveAreas]) : null;
  return {
    opts,
    sources,
    slug: slugify(opts.name),
    centre,
    proj,
    local: route.map(toLocal),
    clears,
    cleared: (x, y, trees = false) => clears.some((c) => (!trees || c.trees) && Math.hypot(x - c.c[0], y - c.c[1]) < c.r),
    areaRings: rings,
    area,
    areaPts: area ? area.ring : [],
    toLocal,
    toLngLat: (p) => proj.toLngLat(p),
    line: (pts) => pts.map(toLocal),
  };
}
