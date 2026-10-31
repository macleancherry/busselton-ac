// The track build's public face: buildTrack (route, options and data in; files, model and plan
// out) and trackObjects (spawn points and timing gates). The build itself is the stage modules
// under stages/ (docs/specs/track.md); this file keeps every import path working.

export type { DataSources, OsmFeatures, Progress, TrackResult } from "./stages/types";
export { buildTrack } from "./stages/build";
export { trackObjects } from "./stages/routePlan";
