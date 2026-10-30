// Everything a build can be tuned by. Defaults aim at a two-lane mountain
// road; the UI exposes the ones people actually change.

import { DEFAULT_SPONSORS } from "./sponsors";

export interface BuildOptions {
  /** Track name shown in Content Manager. */
  name: string;
  /** Road width when OSM has no width/lanes tag, metres. */
  defaultWidth: number;
  /** Override every road width, metres (0 = use OSM). */
  widthOverride: number;
  /** Centreline sample spacing, metres. */
  spacing: number;
  /** Horizontal smoothing of the OSM line, metres (Gaussian sigma). */
  lineSmoothing: number;
  /** Vertical smoothing of the elevation profile, metres (Gaussian sigma). */
  elevationSmoothing: number;
  /** Gravel/grass strip each side of the asphalt, metres. */
  vergeWidth: number;
  /** Terrain kept each side of the road, metres. */
  corridor: number;
  /** Terrain grid spacing, metres. */
  terrainStep: number;
  /**
   * How far the terrain under the road is dropped below it, metres, so it
   * never pokes through. It rises back over the two grid cells nearest the
   * edge, so the ground beyond the verge or kerb isn't dragged down.
   */
  terrainUnderRoad: number;
  /** Distance over which terrain blends from the road level to the real ground, metres. */
  terrainBlend: number;
  /** Terrain / texture chunk size, metres. */
  chunkSize: number;
  /** Invisible wall distance from the road edge, metres (0 = no walls). */
  wallOffset: number;
  /** Superelevation in corners. */
  banking: boolean;
  /** Maximum cross-slope from banking (0.06 = 6%). */
  maxBank: number;
  /** Crown: fall from the centre to each edge (0.02 = 2%). */
  crown: number;
  /** Number of pit boxes / grid slots. */
  pitCount: number;
  /**
   * Point to point roads: metres of run-up added before the grid (for a
   * flying hotlap) and of run-off after the finish line, along the real
   * streets. The timed section is exactly the road between the pins.
   */
  runUp: number;
  runOff: number;
  /** Aerial imagery zoom level for terrain textures (0 = no imagery). */
  imageryZoom: number;
  /** Texture size per terrain chunk, pixels. */
  textureSize: number;
  /** Elevation tile zoom level. */
  demZoom: number;
  /** Non-drivable horizon terrain out to this distance from the road, metres (0 = none). */
  horizon: number;
  /** Water surface over the sea, and piers and jetties. */
  sea: boolean;
  /** Aerial imagery zoom for the horizon terrain. */
  horizonZoom: number;
  /** Trees from aerial imagery: 0 off, 1 normal, 2 dense. */
  trees: number;
  /**
   * Terrain uses ksMultilayer: the aerial photo for colour, times tiled detail
   * textures (lawn, rough grass, sand, leaf litter) masked from the photo, so the
   * ground stays sharp at eye height. Needs DataSources.groundDetails.
   */
  groundDetail: boolean;
  /** Footpaths and shared paths from OpenStreetMap (red asphalt where bikes share them, concrete otherwise). */
  paths: boolean;
  /** Upper bound on tree count, for frame rate. */
  maxTrees: number;
  /** Guard rails at drop-offs and where OSM maps them. */
  guardRails: boolean;
  /** White guide posts along the verges. */
  guidePosts: boolean;
  /**
   * Busselton fork: W-beam (Armco) guard rail where Australian country roads have it (armco.ts): the
   * outside of bends well under the speed limit, embankments, bridges and culverts, on top of guardRails'
   * drop-offs and OSM rails; with posts, blockouts, buried ends and a separate collision wall. Needs guardRails.
   */
  armco?: boolean;
  /** Buildings from OSM footprints. */
  buildings: boolean;
  /** Placeholder buildings where the aerial imagery shows a roof. */
  detectBuildings: boolean;
  /** Buildings are placed up to this far from the road, metres. */
  buildingRadius: number;
  /**
   * Road surface: by road class and surroundings, one kind everywhere, or
   * the aerial photo of the road itself where it was traced.
   */
  roadSurface: "auto" | "asphalt" | "chipseal" | "photo";
  /** Edge lines, dividing lines and raised markers. */
  markings: boolean;
  /** Draw the other streets near the route. */
  sideStreets: boolean;
  /** Street name signs where named streets meet the route. */
  streetSigns: boolean;
  /** Signs, bus stops and servo canopies from OSM points of interest. */
  landmarks: boolean;
  /** Move the road to where the aerial photos show it, at their width. */
  traceRoads: boolean;
  /**
   * Places where the photo trace is ignored and the road keeps the OSM line
   * (wide main streets with angled parking can pull the trace onto the
   * parking bays): centre [lng, lat] and radius in metres. Fades out over 30 m.
   */
  noTrace: { at: [number, number]; radius: number }[];
  /** Reject photo-trace rows that run out of view or are far wider than the mapped street (see traceRoad). */
  traceGuard: boolean;
  /** Coarser terrain blocks away from the road where the ground is flat enough (see buildTerrainChunk). */
  terrainLod: boolean;
  /** Write data/traffic.json for CSP's traffic planner (turns on extended track physics, see surfacesIni). */
  traffic: boolean;
  /** Paint parked cars out of the ground photo (carpark.ts). */
  carParks: boolean;
  /** Low-poly cars where the photo had parked cars (needs carParks). */
  parkedCars: boolean;
  /**
   * Busselton fork: kerbside parking bays and bike lanes painted on town streets, from OSM parking and
   * cycleway tags, and bays where the photo shows cars parked along the kerb (kerbside.ts; needs markings).
   */
  kerbside?: boolean;
  /**
   * The look of houses in this area, when it isn't the usual mix: weights per facade, by name
   * from buildingStyles.ts (e.g. a weatherboard estate: { wb_white: 3, wb_grey: 2, wb_blue: 1 }).
   * Street-photo and hand-set looks still win house by house.
   */
  houseStyle?: { facades: Record<string, number> };
  /**
   * Busselton fork: the map's fixed centre [lng, lat]. Without it the map is centred on the route, so
   * changing the route moves everything; hand-made models layered over the track need it fixed.
   */
  origin?: [number, number];
  /**
   * Busselton fork: an area build. Everything inside this polygon ([lng, lat] corners), or these polygons, is built, every
   * street in it drivable, not only the corridor round the route (see area.ts).
   */
  area?: [number, number][] | [number, number][][];
  /** Busselton fork: side streets count as track (IS_VALID_TRACK) rather than off it: for area builds and free roam. */
  streetsValid?: boolean;
  /** Busselton fork: this build is layout `layout` of a map with several (layouts.ts): its dummies, AI and data go in that layout's places. */
  layout?: string;
  /**
   * Busselton fork: areas a hand-made layer covers (scripts/headless/build-track.mjs fills these from
   * each layer's sidecar file): no generated or spec house there, and no generated trees unless
   * `trees` is false.
   */
  clears?: { at: [number, number]; radius: number; trees?: boolean }[];
  /** Raise car parks' planted islands behind kerbs, read off the photo (experimental: tree canopy still fools it). */
  carParkIslands: boolean;
  /** No level-of-detail blocks within this distance of the road's centreline, metres. */
  terrainLodNear: number;
  /**
   * Busselton fork: how far (metres) the ground may sit off the true surface where it's drawn in
   * bigger blocks, more than 40 m from the route (default 0.05). Larger thins a big area build.
   */
  terrainLodFarTol?: number;
  /**
   * Busselton fork: real 3D trees with CSP's instanced tree system (cspTrees.ts, treeModels.ts) in
   * place of the alpha-tested card trees in the kn5. Needs CSP; the browser preview shows no trees.
   */
  cspTrees?: boolean;
  /**
   * Busselton fork: CSP RainFX puddles in the road's real hollows (rainHollows.ts): the puddle height
   * map from the ground and roads only, and the hollows listed in ext_config for checking in game.
   */
  rainHollows?: boolean;
  /**
   * Busselton fork: CSP track sounds (trackSounds.ts): waves along the shore, magpies and kookaburras
   * in the trees. Needs the placeholder bank (extension/sfx/README.txt) filled on the workstation.
   */
  trackSounds?: boolean;
  /**
   * Busselton fork: roads OSM tags unsealed (surface=unpaved, gravel, compacted, dirt..., and
   * untagged tracks) are built as limestone gravel with gravel physics, no markings and no kerbs
   * (unsealed.ts). On unless false.
   */
  gravelRoads?: boolean;
  /** Busselton fork: the whole route is unsealed gravel whatever OSM says (Boranup-style forest drives). */
  unsealed?: boolean;
  /** Kerb and gutter where the photos (or a built-up area) show them, instead of a gravel verge. */
  kerbs: boolean;
  /**
   * Detail-mapped materials (ksPerPixelMultiMap): asphalt grain on the road
   * and grass on the aerial photo's lawns, sharp up close.
   */
  detailShaders: boolean;
  /**
   * Race-day dressing: barriers, debris fence and sponsor banners along the
   * start/finish straight and the outside of tight corners, tyre walls,
   * gantries, a grandstand and spectators, marshal posts.
   */
  raceDress: boolean;
  /** Sponsors on the banners and flags, comma-separated. */
  sponsors: string;
  /**
   * Busselton fork: vineyards and paddocks (farm.ts): vine rows on OSM vineyards and post-and-wire
   * fences along paddock boundaries and OSM wire fences beside the road. On in the country preset.
   */
  farmland?: boolean;
  /**
   * Busselton fork: country roadsides (farmRoadsides.ts): gravel farm driveways with a gate and a
   * mailbox where OSM tracks and driveways leave the route, and cattle grids where OSM maps them.
   * On in the country preset, off otherwise.
   */
  farmRoadsides?: boolean;
}

export const DEFAULT_OPTIONS: BuildOptions = {
  name: "My road",
  defaultWidth: 6.5,
  widthOverride: 0,
  spacing: 2,
  lineSmoothing: 4,
  elevationSmoothing: 15,
  vergeWidth: 1.5,
  corridor: 90,
  terrainStep: 3,
  terrainUnderRoad: 0.6,
  terrainBlend: 20,
  chunkSize: 200,
  wallOffset: 10,
  banking: true,
  maxBank: 0.06,
  crown: 0.02,
  pitCount: 8,
  runUp: 60,
  runOff: 150,
  imageryZoom: 18,
  textureSize: 1024,
  demZoom: 14,
  horizon: 1500,
  sea: true,
  horizonZoom: 16,
  trees: 1,
  groundDetail: true,
  paths: true,
  maxTrees: 12000,
  guardRails: true,
  guidePosts: true,
  buildings: true,
  detectBuildings: true,
  buildingRadius: 250,
  roadSurface: "auto",
  markings: true,
  sideStreets: true,
  streetSigns: true,
  landmarks: true,
  traceRoads: true,
  noTrace: [],
  traceGuard: true,
  terrainLod: true,
  traffic: false,
  carParks: true,
  carParkIslands: false,
  parkedCars: true,
  terrainLodNear: 25,
  kerbs: true,
  detailShaders: true,
  raceDress: false, // Busselton fork: off; these are cruising roads, not race days (tick it in the UI for a race)
  sponsors: DEFAULT_SPONSORS,
};

export function withDefaults(partial: Partial<BuildOptions>): BuildOptions {
  return { ...DEFAULT_OPTIONS, ...partial };
}
