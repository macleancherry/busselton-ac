// The track build's public shapes (docs/specs/track.md section 2): what a build reads (DataSources,
// OsmFeatures), what it reports (Progress) and what it returns (TrackResult). They cross the worker
// boundary and the headless script reads them, so field names and optionality are the contract.
// track.ts re-exports them.

import type { PathLine } from "../paths";
import type { SignDrawer } from "../shops";
import type { TrafficRoad } from "../traffic";
import type { LandcoverPolygon } from "../zones";
import type { HeightFn } from "../elevation";
import type { Bounds, LngLat, LocalProjection, Vec2 } from "../geo";
import type { Kn5Model } from "../kn5";
import type { RoadPlan } from "../road";
import type { RoundaboutHint } from "../roundabout";
import type { KerbTags } from "../kerbside";
import type { BayBox } from "../bayLanes";
import type { TerrainChunk } from "../terrain";
import type { HouseSpec } from "../specHouse";
import type { FarmPolygon } from "../farm";
import type { ArtRenderer } from "../art";
import type { RasterSampler } from "../trace";
import type { StreetLine, StreetName } from "../sideStreets";

/** Progress callback; a returned promise is awaited (a yield point, so a page can repaint). */
export type Progress = (stage: string, fraction?: number) => void | Promise<void>;

/** A coast polygon as fetched: rings in lng/lat, and which of each ring's edges are real shoreline. */
export interface CoastSource { rings: LngLat[][]; edge: boolean[][] }

/** Everything a build reads from outside. Only `dem` is required. */
export interface DataSources {
  /** Ground heights over `bounds` at a DEM zoom. */
  dem(proj: LocalProjection, bounds: Bounds, zoom: number): Promise<HeightFn>;
  /** The aerial photo of one chunk: the file as fetched, and its pixels when they could be read. */
  imagery?(proj: LocalProjection, chunk: TerrainChunk, zoom: number, size: number): Promise<{
    data: Uint8Array;
    ext: "png" | "jpg" | "dds";
    rgba?: Uint8Array | Uint8ClampedArray;
  } | null>;
  osm?: OsmFeatures;
  /** Street centrelines (map tiles, or OSM inside an area) and street names. */
  streets?: { lines: StreetLine[]; names: StreetName[] };
  /** Points of interest from the map tiles. */
  pois?: { at: LngLat; cls: string; subclass: string; name?: string }[];
  landuse?: { ring: LngLat[]; cls: string }[];
  /** Mapillary detections (object or marking value at a point). */
  seen?: { at: LngLat; value: string }[];
  /** Draws the sign atlas (browser only). */
  renderArt?: ArtRenderer;
  /** A colour sampler over the photo along a path (or paths), out to `reach` metres. */
  raster?(proj: LocalProjection, path: Vec2[] | Vec2[][], reach: number, maxZoom?: number): Promise<RasterSampler | null>;
  /** Roundabouts the router announced. */
  roundabouts?: RoundaboutHint[];
  /** The road class (motorway, primary, ...) at a point. */
  roadClassAt?(p: LngLat): string | undefined;
  /** The road's width at a point from its tags. */
  widthAt?(p: LngLat): number | undefined;
  /** Footpaths and shared paths. */
  paths?: { pts: LngLat[]; kind: PathLine["kind"] }[];
  /** Busselton fork: particular houses' looks (house looks files; `spec` builds a whole house from parts). */
  houseLooks?: {
    at: LngLat;
    facade?: string;
    colour?: [number, number, number];
    front?: "none" | "limestone" | "brick" | "hedge";
    hedgeHeight?: number;
    trees?: number;
    place?: boolean;
    spec?: HouseSpec;
    name?: string;
    facing?: number;
  }[];
  /** Draws shop and spec-house sign boards (browser only). */
  drawSigns?: SignDrawer;
  /** Busselton fork: landmarks laid over later as layers; the automatic test photographs them. */
  landmarks?: { name: string; at: LngLat }[];
  /** Sea, piers (with their OSM way id), beaches, landcover and inland water. */
  coast?: {
    ocean: CoastSource[];
    piers: (CoastSource & { id?: number })[];
    beaches?: CoastSource[];
    landcover?: LandcoverPolygon[];
    water?: CoastSource[];
  };
  /** Busselton fork: vineyards and paddocks beside the road. */
  farmland?: FarmPolygon[];
  /** Busselton fork: what stands on the jetties. */
  jetty?: { railways: LngLat[][]; platforms: { pts: LngLat[]; shelter: boolean }[]; buildings: { pts: LngLat[]; name: string }[] };
  /** README credit for the imagery; a function is read after the imagery is fetched. */
  imageryCredit?: string | (() => string);
  /** README credit for the elevation model(s); empty or absent = the global terrain tiles. */
  elevationCredit?: string | (() => string);
}

/** Map features from OSM (osm.ts), in lng/lat. */
export interface OsmFeatures {
  buildings: { ring: LngLat[]; tags: Record<string, string> }[];
  guardRails: LngLat[][];
  /** Bridges and waterways the road crosses (Armco). */
  crossings?: { bridges: LngLat[][]; waterways: { pts: LngLat[]; cls: string; brunnel?: string }[] };
  roundaboutRings?: { pts: LngLat[]; lanes?: number }[];
  barriers?: { pts: LngLat[]; kind: "fence" | "wall" | "hedge" | "retaining_wall"; fenceType?: string; material?: string; height?: number }[];
  poles?: LngLat[];
  lamps?: LngLat[];
  powerLines?: LngLat[][];
  groynes?: LngLat[][];
  kerbside?: ({ pts: LngLat[] } & KerbTags)[];
  cattleGrids?: LngLat[];
  trafficSignals?: { at: LngLat; crossing: boolean }[];
  /** Unsealed road centrelines. */
  unsealed?: LngLat[][];
}

/** What a build returns. */
export interface TrackResult {
  slug: string;
  /** The track's files, keyed `<slug>/...`, in zip order. */
  files: Record<string, Uint8Array>;
  /** The world model as written to the kn5. */
  model: Kn5Model;
  /** The road plan as it ended up (traced, elevated, kerbs recorded, area rings added). */
  plan: RoadPlan;
  proj: LocalProjection;
  /** Where side streets meet the route. */
  junctions: { s: number; side: 1 | -1 }[];
  /** Houses with a street front, in lng/lat (house looks tooling). */
  houses: {
    front: [LngLat, LngLat];
    height: number;
    facade: string;
    source: string;
    ring: LngLat[];
    roof: string;
    pitch: number;
    roofRgb?: [number, number, number];
  }[];
  /** The parked cars built, local metres. */
  parked: { at: [number, number]; dir: [number, number] }[];
  /** Traffic roads and rings (only with traffic on). */
  trafficInput?: {
    roads: TrafficRoad[];
    roundabouts: { c: Vec2; h: number; rIn: number; rOut: number }[];
  };
  bayBoxes?: BayBox[];
  /** Raw pixels of the DXT textures the 3D preview can't decode, by texture name. */
  previewTextures: Record<string, { rgba: Uint8Array; width: number; height: number }>;
  stats: {
    length: number;
    timedLength: number;
    closed: boolean;
    minElevation: number;
    maxElevation: number;
    climb: number;
    meanWidth: number;
    vertices: number;
    triangles: number;
    terrainChunks: number;
    kn5Bytes: number;
    trees: number;
    buildings: number;
    buildingsDetected: number;
    traced: number;
    photoLines: number;
    photoChunks: number;
    sideStreets: number;
    sideTraced: number;
    kerbMetres: number;
    poles: number;
    streetLights: number;
    /** Car park light poles (two lanterns each). */
    carParkLights: number;
    /** Footpath read off the photo, metres (both sides), and driveway crossovers. */
    footpathMetres: number;
    driveways: number;
    streetSigns: number;
    signs: number;
    railMetres: number;
    /** Parked cars painted out of the ground photo. */
    carsPainted?: number;
    parkedCars?: number;
    /** Parked cars the last pass dropped, by what they touched. */
    parkedDropped?: { road: number; roundabout: number; lane: number; offAsphalt?: number; uneven?: number };
    parkedBays?: { carPark: number; kerb: number; dropped: { aisle: number; noBay: number; blocked: number; overlap: number } };
    kerbside?: { bays: number; bikeLaneMetres: number; symbols: number };
    trafficLights?: { sites: number; poles: number; heads: number; working: number };
    housesLooked?: number;
    shops?: number;
    verandahs?: number;
    shopNames?: number;
  };
}
