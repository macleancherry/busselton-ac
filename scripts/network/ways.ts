// Network ways from an Overpass "out tags geom" response (the build's cache holds them), for the
// network-core scripts.
import type { LngLat, LocalProjection } from "../../src/core/geo";
import type { NetWay } from "../../src/core/network";
import type { P2 } from "../../src/core/network/geom";

const DRIVE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road)(_link)?$/;

export function overpassWays(osm: { elements?: { type: string; tags?: Record<string, string>; geometry?: { lon: number; lat: number }[] }[] }, proj: LocalProjection): { ways: NetWay[]; lngLats: LngLat[] } {
  const ways: NetWay[] = [];
  const lngLats: LngLat[] = [];
  for (const e of osm.elements ?? []) {
    const t = e.tags ?? {};
    if (e.type !== "way" || !e.geometry || !DRIVE.test(t.highway ?? "") || t.area === "yes") continue;
    // Driveways and car park aisles aren't part of the street network.
    if (t.highway === "service" && /^(driveway|parking_aisle)$/.test(t.service ?? "")) continue;
    const ll = e.geometry.map((g) => [g.lon, g.lat] as LngLat);
    lngLats.push(...ll);
    const roundabout = /^(roundabout|circular)$/.test(t.junction ?? "");
    const ow = t.oneway === "yes" || t.oneway === "1" ? 1 : t.oneway === "-1" ? -1 : roundabout ? 1 : undefined;
    const width = parseFloat(t.width ?? "");
    const lanes = parseInt(t.lanes ?? "", 10);
    ways.push({
      pts: ll.map((p) => proj.toLocal(p) as P2), cls: t.highway, roundabout,
      ...(ow ? { oneway: ow as 1 | -1 } : {}), ...(Number.isFinite(width) ? { width } : {}), ...(lanes > 0 ? { lanes } : {}),
      ...(t.layer ? { layer: Number(t.layer) || 0 } : {}), ...(t.name ? { name: t.name } : {}),
    });
  }
  return { ways, lngLats };
}
