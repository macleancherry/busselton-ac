// The headless page's fixed build options and its route checks (docs/specs/headless-page.md).
// Pure: no DOM, tested in Node.

import type { LngLat } from "../core/geo";
import type { BuildOptions } from "../core/options";
import { DEFAULT_SPONSORS } from "../core/sponsors";

/** Imagery choice (route option "imagery") to zoom and terrain texture size. */
const IMAGERY_LEVELS: Record<string, { imageryZoom: number; textureSize: number }> = {
  ultra: { imageryZoom: 20, textureSize: 2048 },
  high: { imageryZoom: 19, textureSize: 1024 },
  standard: { imageryZoom: 18, textureSize: 512 },
  off: { imageryZoom: 0, textureSize: 512 },
};

/**
 * The options every headless build gets (the old UI's control defaults), then the route's
 * `options` (old control ids: only `imagery` and `banking` exist). Any other key throws.
 */
export function headlessOptions(name: string, options: Record<string, unknown> = {}): Partial<BuildOptions> {
  const opts: Partial<BuildOptions> = {
    name: name.trim() || "Real road",
    widthOverride: 0,
    corridor: 90,
    wallOffset: 10,
    horizon: 1500,
    lineSmoothing: 4,
    elevationSmoothing: 15,
    pitCount: 8,
    vergeWidth: 1.5,
    banking: true,
    imageryZoom: 18,
    textureSize: 512,
    trees: 1,
    guardRails: true,
    guidePosts: true,
    buildings: true,
    detectBuildings: true,
    markings: true,
    sideStreets: true,
    streetSigns: true,
    landmarks: true,
    traceRoads: true,
    kerbs: true,
    detailShaders: true,
    roadSurface: "auto",
    raceDress: false,
    sponsors: DEFAULT_SPONSORS,
    noTrace: [],
  };
  for (const [key, value] of Object.entries(options)) {
    if (key === "imagery") {
      const level = IMAGERY_LEVELS[String(value)];
      if (!level) throw new Error(`no imagery level "${String(value)}" (ultra, high, standard or off)`);
      Object.assign(opts, level);
      if (value === "off") opts.trees = 0;
    } else if (key === "banking") {
      opts.banking = !!value;
    } else {
      throw new Error(`no control #${key} in the UI`);
    }
  }
  return opts;
}

export interface RouteSummary {
  /** Metres. */
  distance: number;
  kind: "Circuit" | "A to B";
  /** "x.xx km" from 1 km, else "n m". */
  lengthText: string;
  /** "" when the route can be built. */
  error: string;
  /** Trimmed U-turns, "" when none. */
  note: string;
}

export const MAX_ROUTE_M = 30_000;
export const MIN_ROUTE_M = 300;

export function lengthText(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;
}

/** What a routed road says about itself: its length, and why it can't be built, if it can't. */
export function routeSummary(r: { distance: number; uturns: LngLat[]; trimmed: LngLat[] }, loop: boolean): RouteSummary {
  let error = "";
  if (r.distance > MAX_ROUTE_M) {
    error = `That's ${(r.distance / 1000).toFixed(1)} km. Browser builds are limited to ${MAX_ROUTE_M / 1000} km: move the pins closer.`;
  } else if (r.distance < MIN_ROUTE_M) {
    error = `Make the road at least ${MIN_ROUTE_M} m long.`;
  } else if (r.uturns.length) {
    const [lng, lat] = r.uturns[0];
    error = `The route turns back on itself near ${lat.toFixed(5)}, ${lng.toFixed(5)}, which builds a hairpin spike. Move or remove the pin there.`;
  }
  const n = r.trimmed.length;
  const note = !n ? ""
    : `Cut ${n === 1 ? "a U-turn" : `${n} U-turns`} out of the route (a pin on the far side of the road). Drag the pin onto the near side to keep it exact.`;
  return { distance: r.distance, kind: loop ? "Circuit" : "A to B", lengthText: lengthText(r.distance), error, note };
}
