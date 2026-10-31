// Busselton fork: buildings on water.
//
// The shore check found houses standing in the sea and in lakes (Dunsborough's coast and its
// stormwater lakes, Augusta's Flinders Bay shore, a lake in Margaret River): photo-detected "roofs"
// (white water, rocks, a dry lake bed) and generated frontage houses, 1 to 70 m inside the OSM water
// polygons, none of them mapped. Generated and detected buildings don't go on water; OSM-mapped
// ones stand (a boatshed, a kiosk on a pier: someone mapped it there) and are marked in the shore
// mask as "mapped", so the check lets them stand and no tree grows there.
import type { Vec2 } from "./geo";
import type { Building } from "./buildings";

/** Classes nothing is built on (shoreClear.ts). */
export const WET = new Set(["sea", "water", "wetland", "groyne"]);

/** What lies at a point: a shore class (shoreClear.ts) or null on land. */
export type ShoreAt = (x: number, y: number) => string | null;

/** Does a footprint stand on water: its middle, or any corner? */
export function onWater(ring: Vec2[], at: ShoreAt): boolean {
  if (!ring.length) return false;
  let mx = 0, my = 0;
  for (const [x, y] of ring) {
    if (WET.has(at(x, y) ?? "")) return true;
    mx += x; my += y;
  }
  return WET.has(at(mx / ring.length, my / ring.length) ?? "");
}

/** Splits buildings: those to keep (all mapped ones, generated ones on land), and the mapped ones over water. */
export function sortWaterBuildings<T extends Pick<Building, "ring" | "source">>(list: T[], at: ShoreAt): { keep: T[]; mappedOnWater: T[] } {
  const keep: T[] = [], mappedOnWater: T[] = [];
  for (const b of list) {
    const wet = onWater(b.ring, at);
    if (!wet) keep.push(b);
    else if (b.source === "osm") { keep.push(b); mappedOnWater.push(b); }
  }
  return { keep, mappedOnWater };
}
