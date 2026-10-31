// Everything a build can be tuned by (BuildOptions), the defaults, and withDefaults to fill a
// partial record. No logic beyond that: the list of fields and their defaults is the behaviour
// (docs/specs/options.md).
//
// The defaults are the original ones, aimed at a hilly two-lane country road (6% banking, a 3 m
// terrain grid, ground 0.6 m under the road). Busselton is flat, so the town preset
// (scripts/headless/presets.mjs) and the Busselton routes override the terrain and banking
// settings; the defaults stay as they are because changing them would change every build.
//
// Optional fields (`?`) deliberately have no default: whoever reads them decides what "absent"
// means (several are "on unless false").

import type { ChallengesOption } from "./challenges";
import type { LngLat } from "./geo";

export interface BuildOptions {
  // Road shape and size
  /** Track name (slug, ui_track.json). */
  name: string;
  /** Road width in metres when OSM has none. */
  defaultWidth: number;
  /** Fixed road width in metres; 0 = from OSM. */
  widthOverride: number;
  /** Centreline sample spacing, m. */
  spacing: number;
  /** Gaussian sigma for the centreline, m. */
  lineSmoothing: number;
  /** Gaussian sigma for the road's heights, m. */
  elevationSmoothing: number;
  /** Verge width either side of the road, m. */
  vergeWidth: number;
  banking: boolean;
  /** Most banking on bends (0.06 = 6%). */
  maxBank: number;
  /** Road crown (0.02 = 2%). */
  crown: number;
  pitCount: number;
  /** Road before the start, m. */
  runUp: number;
  /** Road after the finish, m. */
  runOff: number;
  /** Trace the road edges from the aerial photos. */
  traceRoads: boolean;
  /** Places where the trace isn't used (faded out over 30 m). */
  noTrace: { at: LngLat; radius: number }[];
  traceGuard: boolean;
  /** Fixed local origin; absent = centre of the route's bounding box. */
  origin?: LngLat;
  /** Area build polygon(s); absent = no area build. */
  area?: LngLat[] | LngLat[][];
  /** Layout id when the route has layouts; absent = a single-layout track. */
  layout?: string;
  /** The whole route is gravel; absent = OSM decides. */
  unsealed?: boolean;
  /** Gravel on unsealed roads; on unless false. */
  gravelRoads?: boolean;
  /** The new road core; off unless true. */
  networkCore?: boolean;

  // Terrain and imagery
  /** Terrain either side of the road, m. */
  corridor: number;
  /** Terrain grid step, m. */
  terrainStep: number;
  /** Ground sunk under the road, m. */
  terrainUnderRoad: number;
  /** Blend distance from road to terrain, m. */
  terrainBlend: number;
  /** Terrain chunk size, m. */
  chunkSize: number;
  terrainLod: boolean;
  /** Full-detail distance from the road, m. */
  terrainLodNear: number;
  /** Far terrain LOD tolerance, m; absent = 0.05. */
  terrainLodFarTol?: number;
  /** Wall offset from the road edge, m; 0 = no walls. */
  wallOffset: number;
  /** Imagery zoom; 0 = no imagery. */
  imageryZoom: number;
  /** Terrain texture size, px. 1024 here, though the UI's default imagery gives 512 (spec, Bugs 1). */
  textureSize: number;
  demZoom: number;
  /** Photo horizon distance, m; 0 = none. */
  horizon: number;
  horizonZoom: number;
  sea: boolean;
  /** Sea from the photo; on unless false (only with sea in view). */
  photoSea?: boolean;
  detailShaders: boolean;
  /** Landscape zones; off when absent. */
  zones?: boolean;
  /** Pure config; on unless false. */
  pureTuning?: boolean;
  /** Rain puddles in hollows; off when absent. */
  rainHollows?: boolean;

  // Trees, buildings, scenery
  /** 0 off, 1 normal, 2 dense. */
  trees: number;
  maxTrees: number;
  /** CSP trees; off when absent. */
  cspTrees?: boolean;
  buildings: boolean;
  detectBuildings: boolean;
  /** Buildings within this distance of the road, m. */
  buildingRadius: number;
  /** An area's own facade mix; absent = the usual mix. */
  houseStyle?: { facades: Record<string, number> };
  /** Places cleared of generated houses (and trees unless trees: false). */
  clears?: { at: LngLat; radius: number; trees?: boolean }[];
  paths: boolean;
  landmarks: boolean;
  streetSigns: boolean;
  sideStreets: boolean;
  guardRails: boolean;
  guidePosts: boolean;
  /** W-beam Armco; off when absent (needs guardRails). */
  armco?: boolean;
  /** Vineyards and paddocks; off when absent. */
  farmland?: boolean;
  /** Farm driveways, gates, cattle grids; off when absent. */
  farmRoadsides?: boolean;
  /** On unless false. */
  wavingFlags?: boolean;
  /** On unless false. */
  jettyTrain?: boolean;
  /** Off when absent; "fmod" = FMOD, anything else truthy = Lua. */
  trackSounds?: boolean | "lua" | "fmod";
  /** On unless false. */
  poleClear?: boolean;
  /** Tree cards use trees.dds with its own mip chain and bled colour (treeAtlasMips.ts), not trees.png. On unless false. */
  treeMips?: boolean;

  // Road surface, markings, kerbs, parking
  roadSurface: "auto" | "asphalt" | "chipseal" | "photo";
  markings: boolean;
  /** A circuit (OSM highway=raceway): edge lines and start/finish only, no dividing line, RRPMs or photo-read lines. Off when absent; set from the route's raceway ways. */
  raceway?: boolean;
  kerbs: boolean;
  /** Kerbside bays and bike lanes; off when absent (needs markings). */
  kerbside?: boolean;
  /** On unless false (only with kerbside bays). */
  laneBayClear?: boolean;
  carParks: boolean;
  parkedCars: boolean;
  /** On unless false. */
  parkedBays?: boolean;
  /** On unless false. */
  padClear?: boolean;
  /** On unless false. */
  trafficLights?: boolean;

  // AI, traffic, game files
  traffic: boolean;
  trafficZones: boolean;
  trafficSetting: "normal" | "kids";
  /** AI line in the left lane; off when absent. */
  aiKeepLeft?: boolean;
  /** Absent = true with an area, else false. */
  streetsValid?: boolean;
  /** Hand-picked challenge checkpoints; absent = generated. */
  challenges?: ChallengesOption;
  /** Absent = 3. */
  timeTrialSectors?: number;
  /** On unless false. */
  driftZones?: boolean;
}

/** Fields with no default (their readers decide what absent means). */
export const OPTIONAL_OPTION_KEYS: readonly (keyof BuildOptions)[] = Object.freeze([
  "origin", "area", "layout", "unsealed", "gravelRoads", "networkCore",
  "terrainLodFarTol", "photoSea", "zones", "pureTuning", "rainHollows",
  "cspTrees", "houseStyle", "clears", "armco", "farmland", "farmRoadsides", "wavingFlags",
  "jettyTrain", "trackSounds", "poleClear",
  "kerbside", "laneBayClear", "parkedBays", "padClear", "trafficLights",
  "aiKeepLeft", "streetsValid", "challenges", "timeTrialSectors", "driftZones",
] as const);

type RequiredFields<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] };

const defaults: RequiredFields<BuildOptions> = {
  name: "My road",
  defaultWidth: 6.5,
  widthOverride: 0,
  spacing: 2,
  lineSmoothing: 4,
  elevationSmoothing: 15,
  vergeWidth: 1.5,
  banking: true,
  maxBank: 0.06,
  crown: 0.02,
  pitCount: 8,
  runUp: 60,
  runOff: 150,
  traceRoads: true,
  noTrace: Object.freeze([]) as unknown as BuildOptions["noTrace"],
  traceGuard: true,

  corridor: 90,
  terrainStep: 3,
  terrainUnderRoad: 0.6,
  terrainBlend: 20,
  chunkSize: 200,
  terrainLod: true,
  terrainLodNear: 25,
  wallOffset: 10,
  imageryZoom: 18,
  textureSize: 1024,
  demZoom: 14,
  horizon: 1500,
  horizonZoom: 16,
  sea: true,
  detailShaders: true,

  trees: 1,
  maxTrees: 12000,
  buildings: true,
  detectBuildings: true,
  buildingRadius: 250,
  paths: true,
  landmarks: true,
  streetSigns: true,
  sideStreets: true,
  guardRails: true,
  guidePosts: true,

  roadSurface: "auto",
  markings: true,
  kerbs: true,
  carParks: true,
  parkedCars: true,

  traffic: false,
  trafficZones: true,
  trafficSetting: "normal",
};

/** The defaults (frozen: copy through withDefaults, never change in place). */
export const DEFAULT_OPTIONS: BuildOptions = Object.freeze(defaults) as BuildOptions;

/**
 * DEFAULT_OPTIONS overlaid with `partial` (shallow: a nested value replaces the default whole).
 * Keys whose value is undefined don't erase a default. A new object; neither input is changed.
 */
export function withDefaults(partial: Partial<BuildOptions>): BuildOptions {
  const out = { ...DEFAULT_OPTIONS, noTrace: [...DEFAULT_OPTIONS.noTrace] } as Record<string, unknown>;
  for (const [k, v] of Object.entries(partial ?? {})) {
    if (v !== undefined) out[k] = v;
  }
  return out as unknown as BuildOptions;
}

/** Keys of `obj` that aren't BuildOptions fields (typos in a route's build); keys starting with "_" are notes. */
export function unknownOptionKeys(obj: Record<string, unknown>): string[] {
  const known = new Set<string>([...Object.keys(DEFAULT_OPTIONS), ...OPTIONAL_OPTION_KEYS]);
  return Object.keys(obj ?? {}).filter((k) => !k.startsWith("_") && !known.has(k));
}
