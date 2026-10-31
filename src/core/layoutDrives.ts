// Busselton fork: every layout's road is part of the world (docs/one-map.md).
//
// A map's world is built round the main layout's drive (its corridor) and any area. Extra layouts
// are laid on the world afterwards (layouts.ts), so a layout that leaves the main drive had no road
// there: Collie Motorplex's short layout takes the circuit's southern link, which the long layout
// skips for the extension, and 20% of its AI line ran over open ground past the corridor.
//
// build-track.mjs routes the layouts that follow OSM ways (raceways, gravel tracks) before the
// build and passes their drives in as `layoutDrives`. Each drive widens what's built (a corridor
// round it, as extra area polygons: ground, photo, trees and buildings kept off it), and a raceway
// drive becomes a street along its own OSM centreline (the side streets have no raceway class, so
// nothing else builds it). Other ways (tracks, roads) are already street classes: inside the
// widened area the map tiles' own lines are built.
import type { LngLat, Vec2 } from "./geo";
import type { StreetLine } from "./sideStreets";

export interface LayoutDrive {
  /** The layout's drive, as routed (lng, lat). */
  coords: LngLat[];
  /** Every way it follows is OSM highway=raceway. */
  raceway?: boolean;
}

/**
 * The ground round a drive as overlapping rectangles (Area treats them as one): one per stretch of
 * about `step` metres, `half` either side of the line and carried on `half` past each end, so the
 * outside of a bend is covered too.
 */
export function driveRings(pts: Vec2[], half: number, step = 15): Vec2[][] {
  const out: Vec2[][] = [];
  if (pts.length < 2 || half <= 0) return out;
  // Stretches of about `step` metres along the line.
  const cuts: Vec2[] = [pts[0]];
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    run += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (run >= step || i === pts.length - 1) {
      cuts.push(pts[i]);
      run = 0;
    }
  }
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1], b = cuts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const d: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n: Vec2 = [-d[1], d[0]];
    const a2: Vec2 = [a[0] - d[0] * half, a[1] - d[1] * half], b2: Vec2 = [b[0] + d[0] * half, b[1] + d[1] * half];
    out.push([
      [a2[0] - n[0] * half, a2[1] - n[1] * half],
      [b2[0] - n[0] * half, b2[1] - n[1] * half],
      [b2[0] + n[0] * half, b2[1] + n[1] * half],
      [a2[0] + n[0] * half, a2[1] + n[1] * half],
    ]);
  }
  return out;
}

/** The area polygons (local metres) round every layout drive, `half` (the corridor) either side. */
export function layoutDriveRings(drives: LayoutDrive[] | undefined, toLocal: (p: LngLat) => Vec2, half: number): Vec2[][] {
  return (drives ?? []).flatMap((d) => driveRings(d.coords.map(toLocal), half));
}

/** Street lines for the raceway drives (the side streets build them where they leave the main drive). */
export function layoutDriveLines(drives: LayoutDrive[] | undefined): StreetLine[] {
  return (drives ?? []).filter((d) => d.raceway && d.coords.length > 1).map((d) => ({ pts: d.coords, cls: "raceway", surface: "asphalt" }));
}
