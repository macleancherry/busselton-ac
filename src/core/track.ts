// The whole build: route in, track folder out. Network access is injected
// through `DataSources`, so the same pipeline runs in the browser (real
// tiles) and in Node tests (synthetic terrain).

import { buildPaths, footPathTexture, sharedPathTexture, type PathLine } from "./paths";
import { pickSpecies, treeSpeciesAtlas } from "./treeSprites";
import { FENCE_COLOURS, fenceTexture, frontWallTexture, hedgeTexture, mulchTexture, shrubAtlas } from "./houseTextures";
import { buildLots, shrub } from "./lots";
import { buildParkedCars, carTexture, paintFor, type ParkedCar } from "./parkedCars";
import { buildShopfronts, findShopfronts, shopSignTexture, shopStats, shopWindowTexture, type SignDrawer } from "./shops";
import { buildIslands, findIslands, footprintMask, lineMask, paintOutCars } from "./carpark";
import { trafficJson, type TrafficRoad } from "./traffic";
import autotestLua from "./lua/autotest.lua?raw";
import { buildGroynes, buildPiers, buildSea, jettyLights, buildSeawall, deckTexture, rockTexture, SeaMask, seaTexture, withSeabed, type CoastPolygon } from "./coast";
import type { GroundDetail, GroundLayer } from "./ground";
import { aiHintsIni, buildAiLine } from "./aiLine";
import { Area, makeCover } from "./area";
import { asLayout, dummiesKn5 } from "./layouts";
import { BACKDROP_CHUNK, backdropHeight, buildBackdropChunk, planBackdrop } from "./backdrop";
import { writeFastLaneAi } from "./aiSpline";
import { outlinePng, previewPng, readme, slugify, surfacesIni, trackMap, uiTrackJson, type TrackMeta } from "./acFiles";
import type { HeightFn } from "./elevation";
import { boundsOf, LocalProjection, type Bounds, type LngLat, type Vec2 } from "./geo";
import { frameTransform, IDENTITY, writeKn5, type Kn5GroupNode, type Kn5Material, type Kn5MeshNode, type Kn5Model, type Kn5Node, type Kn5Texture } from "./kn5";
import { MeshBuilder, toAc } from "./mesh";
import { withDefaults, type BuildOptions } from "./options";
import { simplify } from "./polyline";
import { applyElevation, inRoundabout, isLoop, planRoad, surfaceHeight, SegmentIndex, type RoadPlan, type RoadSample } from "./road";
import { extendRoute, pathLength } from "./extend";
import { keepOffRoute, onRoute } from "./clearance";
import { buildRingMarkings, buildRingMeshes, buildRingWall, innerRadius, outerRadius, resolveRoundabouts, ringsOnRoute, ringHeight, vergeOuterRadius, type RoundaboutHint } from "./roundabout";
import { buildRoadMeshes, buildWalls, type RoadMaterialFn } from "./roadMesh";
import { buildKerbReturns, buildKerbs, KERB_BACK, KERB_H, kerbEvidence, planKerbs, STRIP_EXTRA, stripPhotoTexture, type StripMaterialFn } from "./kerbs";
import { photoRoadTexture } from "./photoSurface";
import { encodeDdsDxt1, encodeDdsDxt5 } from "./dds";
import { decodeOwnPng, encodePng } from "./png";
import { buildMarkings, type DiscreteMark } from "./markings";
import { buildTerrainChunk, makeTerrainFn, meshTop, planTerrainChunks, type TerrainChunk } from "./terrain";
import { BARRIERS, barrierTexture, detailTexture, normalFromHeight, windowTexture, flatNormalTexture, GROUND_TILE, groundDetail, groundMask, type GroundKind, mapsTexture, paintTexture, sealTexture, type SealKind, garageTexture, grassTexture, concreteTexture, postTexture, railTexture, solidTexture, vergeTexture } from "./textures";
import {
  buildGuardRails, buildGuidePosts, buildTrees, treeTrunks, filterTrees, railNeeds, rng, treeSpotsFromImagery, type TreeSpot,
} from "./scenery";
import { buildBuildings, centroid, detectBuildings, filterBuildings, fromOsm, houseRoof, isRectangle, plainHouse, pointInRing, ringArea, usedFinishes, type Building } from "./buildings";
import { dressBuilding, FACADES, facadeTexture, ROOF_COLOURS, roofTexture } from "./buildingStyles";
import { facadeForLook, facadeForStyle } from "./houseLooks";
import { buildSpecHouse, type HouseSpec } from "./specHouse";
import { camerasIni, placeCameras } from "./cameras";
import { cullable } from "./cull";
import { extConfig } from "./cspConfig";
import { buildBarriers } from "./fences";
import { chunkPhotoSampler, frontageHouses } from "./frontage";
import { ArtList, type ArtRenderer } from "./art";
import { challengeCheckpoints, challengesIni } from "./challenges";
import { buildPieces, gateSigns, kangarooSigns, landmarks, mergeSightings, seenFeatures, streetSigns } from "./furniture";
import { barrierConcreteTexture, catchFenceTexture, crowdTexture, raceDressing, tyreWallTexture } from "./raceDress";
import { carParkLights, placeUtilities } from "./utilities";
import { buildVergeConcrete, laybacks, letterboxes, readVerge } from "./footpaths";
import { findLines, paintCandidates, type ImageLine } from "./paintLines";
import { applyTrace, displayOf, traceRoad, type RasterSampler, type TraceResult } from "./trace";
import { buildSideStreets, LineIndex, traceSideStreets, planSideStreets, streetSurface, type StreetLine, type StreetName } from "./sideStreets";

/** Progress callback; a returned promise is awaited, which lets a UI repaint. */
export type Progress = (stage: string, fraction?: number) => void | Promise<void>;

export interface DataSources {
  /** Height sampler (local metres) covering `bounds`. */
  dem(proj: LocalProjection, bounds: Bounds, zoom: number): Promise<HeightFn>;
  /**
   * Image bytes (PNG, JPEG or DDS) covering the chunk square, north up; null
   * to fall back to grass. `rgba` (size x size) lets the build find trees.
   */
  imagery?(proj: LocalProjection, chunk: TerrainChunk, zoom: number, size: number): Promise<{
    data: Uint8Array;
    ext: "png" | "jpg" | "dds";
    rgba?: Uint8Array | Uint8ClampedArray;
  } | null>;
  /** OSM features near the road, already fetched. */
  osm?: OsmFeatures;
  /** Other streets near the route and their names (vector tiles). */
  streets?: { lines: StreetLine[]; names: StreetName[] };
  /** Points of interest near the route (vector tiles). */
  pois?: { at: LngLat; cls: string; subclass: string; name?: string }[];
  /** Objects located by street-level imagery (Mapillary map features). */
  seen?: { at: LngLat; value: string }[];
  /** Draws the sign artwork atlas; without one, signs are left out. */
  renderArt?: ArtRenderer;
  /** Sharpest aerial imagery within `reach` metres of the path, for tracing the road. */
  raster?(proj: LocalProjection, path: Vec2[], reach: number): Promise<RasterSampler | null>;
  /** Roundabouts the router says the route goes round. */
  roundabouts?: RoundaboutHint[];
  /** Road class at a point (OpenMapTiles: motorway, primary, minor, ...). */
  roadClassAt?(p: LngLat): string | undefined;
  /** Asphalt width at a point from map data, metres. */
  widthAt?(p: LngLat): number | undefined;
  /** Footpaths and shared paths (OSM), already classified. */
  paths?: { pts: LngLat[]; kind: PathLine["kind"] }[];
  /** The sea and piers (OSM via vector tiles): polygons, exterior ring first; `edge` false on tile seams. */
  /**
   * What each house really looks like, from street photos (scripts/mapillary/house_looks.py):
   * matched to the house whose front wall is nearest `at`, within 8 m.
   */
  houseLooks?: {
    at: LngLat;
    facade?: string;
    /** Wall colour, sRGB 0-255. */
    colour?: [number, number, number];
    /** What's along the front boundary, and a hedge's height in metres. */
    front?: "none" | "limestone" | "brick" | "hedge";
    hedgeHeight?: number;
    /** Trees in the front yard. */
    trees?: number;
    /** Build a house here (15 x 13 m, facing the nearest road) when the photo didn't give one. */
    place?: boolean;
    /** Build this house from a spec (scripts/blender/house.py's parts mode), centred on `at` and facing the nearest road, in place of the generated one. */
    spec?: HouseSpec;
  }[];
  /** Draws shop names for their signs (needs a canvas: the browser passes one in). */
  drawSigns?: SignDrawer;
  coast?: { ocean: { rings: LngLat[][]; edge: boolean[][] }[]; piers: { rings: LngLat[][]; edge: boolean[][] }[]; beaches?: { rings: LngLat[][]; edge: boolean[][] }[] };
  /** Tiled ground detail textures for ksMultilayer terrain (lawn, rough, sand, litter); null to keep plain photo terrain. */
  groundDetails?(): Promise<Record<GroundLayer, GroundDetail> | null>;
  /** Credit line for the imagery source(s), written into the README; read after imagery is fetched. */
  imageryCredit?: string | (() => string);
}

export interface OsmFeatures {
  /** Footprints (first point not repeated) with OSM / vector tile tags. */
  buildings: { ring: LngLat[]; tags: Record<string, string> }[];
  guardRails: LngLat[][];
  /** OSM junction=roundabout ways near the route, with their circulating lanes when tagged. */
  roundaboutRings?: { pts: LngLat[]; lanes?: number }[];
  /** Fences, walls and hedges near the route (OSM barrier=*). */
  barriers?: { pts: LngLat[]; kind: "fence" | "wall" | "hedge" | "retaining_wall"; fenceType?: string; material?: string; height?: number }[];
  /** Power poles, street lamps and distribution power lines (on poles) near the route. */
  poles?: LngLat[];
  lamps?: LngLat[];
  powerLines?: LngLat[][];
  /** Rock groynes and breakwaters (OSM man_made=groyne|breakwater) near the route. */
  groynes?: LngLat[][];
}

export interface TrackResult {
  slug: string;
  files: Record<string, Uint8Array>;
  model: Kn5Model;
  plan: RoadPlan;
  proj: LocalProjection;
  /** Where side streets meet the route (distance along it, side 1 = left). */
  junctions: { s: number; side: 1 | -1 }[];
  /** Houses with a known front wall, for matching to street photos. */
  houses: { front: [LngLat, LngLat]; height: number; facade: string; source: string; ring: LngLat[]; roof: string; pitch: number; roofRgb?: [number, number, number] }[];
  /** Parked cars placed (local metres), for checking renders. */
  parked: { at: [number, number]; dir: [number, number] }[];
  /** What the traffic graph was built from, for checking it offline. */
  trafficInput?: { roads: TrafficRoad[]; roundabouts: { c: Vec2; h: number; rIn: number; rOut: number }[] };
  /** Raw pixels for textures the browser can't decode (DDS), keyed by texture name. */
  previewTextures: Record<string, { rgba: Uint8Array; width: number; height: number }>;
  stats: {
    length: number;
    /** Between the start and finish lines (the whole road on a loop). */
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
    /** Fraction of the route traced from the aerial photos. */
    traced: number;
    /** Line markings read off the photo. */
    photoLines: number;
    /** Road chunks textured from the aerial photo. */
    photoChunks: number;
    sideStreets: number;
    /** Side streets traced from the photo. */
    sideTraced: number;
    /** Kerb and gutter built, metres (both sides counted). */
    kerbMetres: number;
    /** Power poles and street lights placed. */
    poles: number;
    streetLights: number;
    /** Car park light poles (two lanterns each). */
    carParkLights: number;
    /** Race-day dressing: metres of barrier, a grandstand or not, people. */
    race: { barrierMetres: number; grandstand: boolean; spectators: number } | null;
    /** Footpath read off the photo, metres (both sides), and driveway crossovers. */
    footpathMetres: number;
    driveways: number;
    streetSigns: number;
    signs: number;
    railMetres: number;
    /** Parked cars painted out of the ground photo, and car park islands raised. */
    carsPainted?: number;
    parkedCars?: number;
    /** Houses whose walls were set from street photos. */
    housesLooked?: number;
    /** Shopfronts built, and how many have a verandah. */
    shops?: number;
    verandahs?: number;
    shopNames?: number;
    carParkIslands?: number;
  };
}

const enc = new TextEncoder();
const MIN_LENGTH = 300;
/** Clear road between the front row of the grid and the start line, and before the back row. */
const GRID_DEPTH = 14;

/**
 * The sample at a pin: nearest to it among those about `frac` of the way
 * along the road (smoothing shortens the road a little, so distances along
 * the original path only say roughly where to look; on a road that passes
 * the same spot twice, this keeps to the right pass).
 */
function sampleNearPin(plan: RoadPlan, pin: Vec2, frac: number): number {
  const last = plan.samples[plan.samples.length - 1].s;
  const est = frac * last, window = Math.max(60, last * 0.05);
  let best = -1, bestD = Infinity;
  for (const pass of [window, Infinity]) {
    plan.samples.forEach((s, i) => {
      if (Math.abs(s.s - est) > pass) return;
      const d = Math.hypot(s.pos[0] - pin[0], s.pos[1] - pin[1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) break;
  }
  return Math.max(0, best);
}

/** Point on the road at distance s (wrapping on loops), lateral offset t, and its heading. */
function along(plan: RoadPlan, s: number, t: number, lift: number, crown: number) {
  const n = plan.samples.length;
  const L = plan.length;
  if (plan.closed) s = ((s % L) + L) % L;
  else s = Math.max(0, Math.min(plan.samples[n - 1].s, s));
  let i = Math.min(n - 1, Math.floor(s / (L / (plan.closed ? n : n - 1))));
  while (i > 0 && plan.samples[i].s > s) i--;
  while (i < n - 1 && plan.samples[i + 1].s <= s) i++;
  const a: RoadSample = plan.samples[i];
  const z = surfaceHeight(a, t, crown) + lift;
  const pos = toAc(a.pos[0] + a.left[0] * t, a.pos[1] + a.left[1] * t, z);
  const fwd = toAc(a.tan[0], a.tan[1], 0);
  return { pos, fwd, sample: a };
}

function dummy(name: string, transform: number[]): Kn5GroupNode {
  return { kind: "node", name, transform, children: [] };
}

/** Spawn points and timing gates. */
export function trackObjects(plan: RoadPlan, opts: BuildOptions): Kn5GroupNode[] {
  const out: Kn5GroupNode[] = [];
  const width = plan.samples[0].width;
  const rows = Math.ceil(opts.pitCount / 2);
  const slot = (k: number, lineS: number) => {
    // Busselton fork: on a road under 8 m wide (a town street), single file on the centre line: a
    // race grid's quarter-width stagger put the car at the edge of a 4 m street, over a drop.
    if (along(plan, lineS - 8, 0, 0, 0).sample.width < 8) return { s: lineS - 8 - k * 8, t: 0 };
    const row = Math.floor(k / 2);
    const t = (k % 2 === 0 ? 1 : -1) * width / 4;
    return { s: lineS - 8 - row * 8, t };
  };
  const place = (name: string, s: number, t: number, lift: number) => {
    const p = along(plan, s, t, lift, opts.crown);
    // A spawn dummy's Z points the way the car faces, along the AI line. (With Z pointing back
    // down the road, as upstream had it, the AI's first move in a test run was a U-turn.)
    out.push(dummy(name, frameTransform(p.pos, p.fwd)));
  };

  if (plan.closed) {
    const line = 0;
    for (let k = 0; k < opts.pitCount; k++) {
      const { s, t } = slot(k, line);
      place(`AC_START_${k}`, s, t, 0.5);
      place(`AC_PIT_${k}`, s, t, 0.5);
    }
    place("AC_HOTLAP_START_0", plan.length - 150, 0, 0.5);
    const half = width / 2 + 1;
    place("AC_TIME_0_L", line, half, 1);
    place("AC_TIME_0_R", line, -half, 1);
  } else {
    // Start and finish lines on the pins when there's a run-up and run-off; otherwise just inside the ends.
    const end = plan.samples[plan.samples.length - 1].s;
    const startLine = plan.timed ? Math.max(GRID_DEPTH + rows * 8, plan.samples[plan.timed.start].s) : GRID_DEPTH + rows * 8;
    for (let k = 0; k < opts.pitCount; k++) {
      const { s, t } = slot(k, startLine);
      place(`AC_START_${k}`, s, t, 0.5);
      place(`AC_PIT_${k}`, s, t, 0.5);
    }
    place("AC_HOTLAP_START_0", 4, 0, 0.5);
    const startHalf = along(plan, startLine, 0, 0, 0).sample.width / 2 + 1;
    place("AC_AB_START_L", startLine, startHalf, 1);
    place("AC_AB_START_R", startLine, -startHalf, 1);
    const finish = plan.timed ? Math.min(end - 25, plan.samples[plan.timed.finish].s) : end - 25;
    const finishHalf = along(plan, finish, 0, 0, 0).sample.width / 2 + 1;
    place("AC_AB_FINISH_L", finish, finishHalf, 1);
    place("AC_AB_FINISH_R", finish, -finishHalf, 1);
  }
  return out;
}

function material(name: string, texture: string, light: { ambient: number; diffuse: number; specular: number; exp: number }): Kn5Material {
  return {
    name,
    shader: "ksPerPixel",
    properties: [
      { name: "ksAmbient", a: light.ambient },
      { name: "ksDiffuse", a: light.diffuse },
      { name: "ksSpecular", a: light.specular },
      { name: "ksSpecularEXP", a: light.exp },
      { name: "ksEmissive", c: [0, 0, 0] },
      { name: "ksAlphaRef", a: 0 },
    ],
    textures: { txDiffuse: texture },
  };
}

/** A normal-mapped material (ksPerPixelNM): relief without reflections. Parameter names as the shader declares them. */
function nmMaterial(name: string, diffuse: string, normal: string, light: { ambient: number; diffuse: number; specular: number; exp: number }): Kn5Material {
  const base = material(name, diffuse, light);
  return {
    ...base,
    shader: "ksPerPixelNM",
    properties: [
      ...base.properties,
      { name: "fresnelC", a: 0 },
      { name: "fresnelEXP", a: 5 },
      { name: "fresnelMaxLevel", a: 0 },
      { name: "nmObjectSpace", a: 0 },
      { name: "isAdditive", a: 0 },
    ],
    textures: { txDiffuse: diffuse, txNormal: normal },
  };
}

/**
 * A detail-mapped material (ksPerPixelMultiMap): the diffuse texture, a
 * normal map, txMaps (specular, gloss, sun specular) and a tiling detail
 * texture multiplied in wherever the diffuse alpha is 0. Parameter names as
 * the game's shader declares them.
 */
function multiMapMaterial(
  name: string,
  diffuse: string,
  light: { ambient: number; diffuse: number; specular: number; exp: number },
  maps: { normal: string; maps: string; detail: string; detailUV: number; sunSpecular?: number },
): Kn5Material {
  return {
    name,
    shader: "ksPerPixelMultiMap",
    properties: [
      { name: "ksAmbient", a: light.ambient },
      { name: "ksDiffuse", a: light.diffuse },
      { name: "ksSpecular", a: light.specular },
      { name: "ksSpecularEXP", a: light.exp },
      { name: "ksEmissive", c: [0, 0, 0] },
      { name: "ksAlphaRef", a: 0 },
      { name: "fresnelC", a: 0 },
      { name: "fresnelEXP", a: 5 },
      { name: "fresnelMaxLevel", a: 0 },
      { name: "isAdditive", a: 0 },
      { name: "useDetail", a: 1 },
      { name: "detailUVMultiplier", a: maps.detailUV },
      { name: "shadowBiasMult", a: 0 },
      { name: "nmObjectSpace", a: 0 },
      { name: "sunSpecular", a: maps.sunSpecular ?? 0 },
      { name: "sunSpecularEXP", a: 40 },
    ],
    textures: { txDiffuse: diffuse, txNormal: maps.normal, txMaps: maps.maps, txDetail: maps.detail },
  };
}

type Layer = { texture: string; metres: number };

/**
 * A ksMultilayer material: the diffuse texture multiplied by four tiling
 * details, weighted by txMask's R, G, B and A, then by `magicMult`. The
 * details are projected from above in world metres (one tile every
 * `metres`), so they keep their scale on every chunk. Parameter names as
 * the game's shader declares them (multA is a float2).
 */
function multilayerMaterial(
  name: string,
  diffuse: string,
  mask: string,
  light: { ambient: number; diffuse: number; specular: number; exp: number },
  [r, g, b, a]: [Layer, Layer, Layer, Layer],
  magicMult: number,
): Kn5Material {
  return {
    name,
    shader: "ksMultilayer",
    properties: [
      { name: "ksAmbient", a: light.ambient },
      { name: "ksDiffuse", a: light.diffuse },
      { name: "ksSpecular", a: light.specular },
      { name: "ksSpecularEXP", a: light.exp },
      { name: "ksEmissive", c: [0, 0, 0] },
      { name: "ksAlphaRef", a: 0 },
      { name: "multR", a: 1 / r.metres },
      { name: "multG", a: 1 / g.metres },
      { name: "multB", a: 1 / b.metres },
      { name: "multA", b: [1 / a.metres, 1 / a.metres] },
      { name: "magicMult", a: magicMult },
    ],
    textures: { txDiffuse: diffuse, txMask: mask, txDetailR: r.texture, txDetailG: g.texture, txDetailB: b.texture, txDetailA: a.texture },
  };
}

const groundLayer = (k: GroundKind): Layer => ({ texture: `ground_${k}.dds`, metres: GROUND_TILE[k] });

/**
 * Ground under a photo (or a plain grass or gravel texture): grass, dirt
 * and plain detail by the mask's R, G and B, each mid grey on average and
 * doubled, so from a distance the photo is unchanged and up close it has
 * blades, clods and grain. A is black: a DXT1 mask reads 1 there.
 */
function groundMaterial(name: string, diffuse: string, mask: string, light: { ambient: number; diffuse: number; specular: number; exp: number }): Kn5Material {
  return multilayerMaterial(name, diffuse, mask, light, [groundLayer("grass"), groundLayer("dirt"), groundLayer("plain"), { texture: "black.png", metres: 1 }], 2);
}

/**
 * Decides what each building is (buildingStyles.ts) from what's known: its
 * OSM type and height, a point of interest inside it, the roof colour in
 * the photo, and which wall faces the street (found here when the footprint
 * didn't come with one) and how far back it sits.
 */
function dressBuildings(buildings: Building[], ctx: {
  /** Distance from a point to the nearest road edge (route or street), metres. */
  roadEdge: (x: number, y: number) => number;
  pois: { at: Vec2; cls: string; subclass: string }[];
  queensland: boolean;
}): void {
  const SHOPLIKE = /^(shop|grocery|clothing_store|cafe|restaurant|fast_food|bar|pub)$/;
  buildings.forEach((b, i) => {
    if (!b.front && b.ring.length >= 3) {
      // The wall nearest a road that faces it.
      let best = -1, bestD = 25;
      const ccw = ringArea(b.ring) >= 0;
      b.ring.forEach((p, k) => {
        const q = b.ring[(k + 1) % b.ring.length];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (len < 3) return;
        const m: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const out: Vec2 = ccw ? [(q[1] - p[1]) / len, -(q[0] - p[0]) / len] : [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
        const d = ctx.roadEdge(m[0], m[1]);
        if (d < bestD && ctx.roadEdge(m[0] + out[0] * 2, m[1] + out[1] * 2) < d - 1) {
          bestD = d;
          best = k;
        }
      });
      if (best >= 0) {
        b.front = [b.ring[best], b.ring[(best + 1) % b.ring.length]];
        b.setback = bestD;
      }
    }
    const inside = ctx.pois.filter((p) => pointInRing(p.at[0], p.at[1], b.ring));
    const poi = inside.find((p) => SHOPLIKE.test(p.cls)) ?? inside[0];
    const tags = b.tags ?? {};
    const knownHeight = !!(tags.height || tags["building:levels"] || (tags.render_height && tags.render_height !== "5"));
    const dress = dressBuilding({
      height: b.source === "osm" && knownHeight ? b.height : undefined,
      kind: tags.building,
      area: Math.abs(ringArea(b.ring)),
      poi: poi?.cls,
      photoRoof: b.source !== "osm" || tags["roof:colour"] ? b.roofColour : undefined,
      queensland: ctx.queensland,
      rectangle: isRectangle(b.ring),
      fronted: b.setback !== undefined && b.setback < 15,
      seed: 7919 + i * 31 + Math.round(Math.abs(b.ring[0][0]) * 13),
    });
    Object.assign(b, dress, { garage: dress.garage ?? b.garage });
  });
}

function countGeometry(node: Kn5Node): { v: number; t: number } {
  if (node.kind === "mesh") return { v: node.positions.length / 3, t: node.indices.length / 3 };
  return node.children.map(countGeometry).reduce((a, b) => ({ v: a.v + b.v, t: a.t + b.t }), { v: 0, t: 0 });
}

export async function buildTrack(
  route: LngLat[],
  partial: Partial<BuildOptions>,
  sources: DataSources,
  meta: Partial<TrackMeta> = {},
  progress: Progress = () => {},
): Promise<TrackResult> {
  const opts = withDefaults(partial);
  if (route.length < 2) throw new Error("Pick a start and a finish on the map first");

  await progress("Laying out the road");
  const lngs = route.map((p) => p[0]), lats = route.map((p) => p[1]);
  const centre: LngLat = opts.origin ?? [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  const proj = new LocalProjection(centre);
  const local = route.map((p) => proj.toLocal(p));
  // Busselton fork: areas hand-made layers cover (see opts.clears).
  const clears = (opts.clears ?? []).map((c) => ({ c: proj.toLocal(c.at), r: c.radius, trees: c.trees !== false }));
  const cleared = (x: number, y: number, trees = false) => clears.some((k) => (!trees || k.trees) && Math.hypot(x - k.c[0], y - k.c[1]) < k.r);
  // Busselton fork: an area build also builds everything inside this polygon (see area.ts).
  const area = opts.area && opts.area.length >= 3 ? new Area(opts.area.map((p) => proj.toLocal(p))) : null;
  const areaPts: Vec2[] = area ? area.ring : [];
  const widthFn = sources.widthAt ? (x: number, y: number) => sources.widthAt!(proj.toLngLat([x, y])) : undefined;
  const hinted = resolveRoundabouts(sources.roundabouts ?? [], sources.osm?.roundaboutRings ?? [], proj);
  // Plus rings the route crosses that routing didn't mention (straight over a small roundabout):
  // OSM's roundabout ways, and closed rings in the map tiles.
  const tileRings = (sources.streets?.lines ?? [])
    .filter((l) => l.pts.length > 5 && Math.hypot(l.pts[0][0] - l.pts[l.pts.length - 1][0], l.pts[0][1] - l.pts[l.pts.length - 1][1]) < 2e-5)
    .map((l) => l.pts.map((p) => proj.toLocal(p)));
  const circles = [...hinted, ...ringsOnRoute([...(sources.osm?.roundaboutRings ?? []).map((r) => r.pts.map((p) => proj.toLocal(p))), ...tileRings], local, hinted)];
  // Point to point: room to line up and get going before the start pin, and to brake after the finish pin.
  const rows = Math.ceil(opts.pitCount / 2);
  const ext = !isLoop(local) && (opts.runUp > 0 || opts.runOff > 0)
    ? extendRoute(local, (sources.streets?.lines ?? []).map((l) => l.pts.map((p) => proj.toLocal(p))), GRID_DEPTH + rows * 8 + opts.runUp, opts.runOff)
    : null;
  const plan = planRoad(ext?.path ?? local, opts, widthFn, circles);
  if (ext) {
    const total = pathLength(ext.path);
    plan.timed = { start: sampleNearPin(plan, local[0], ext.startAt / total), finish: sampleNearPin(plan, local[local.length - 1], ext.finishAt / total) };
  }
  const timedLength = () => (plan.timed ? plan.samples[plan.timed.finish].s - plan.samples[plan.timed.start].s : plan.length);
  if (timedLength() < MIN_LENGTH) throw new Error(`Road is ${Math.round(timedLength())} m; make it at least ${MIN_LENGTH} m`);

  // Put the road where the aerial photos show it, at the width they show.
  let raster: RasterSampler | null = null;
  let trace: TraceResult | null = null;
  if (opts.traceRoads && sources.raster) {
    await progress("Tracing the road in the aerial photos");
    const reach = Math.max(16, Math.max(...plan.samples.map((s) => s.width)) * 1.5);
    raster = await sources.raster(proj, plan.samples.map((s) => s.pos), reach);
    if (raster) {
      trace = traceRoad(plan, raster, undefined, opts.traceGuard);
      if (opts.noTrace.length) {
        const zones = opts.noTrace.map((z) => ({ c: proj.toLocal(z.at), r: z.radius }));
        plan.samples.forEach((smp, i) => {
          // 1 inside a zone, fading to 0 over 30 m outside it.
          const keep = Math.min(1, ...zones.map((z) => Math.max(0, Math.min(1, (Math.hypot(smp.pos[0] - z.c[0], smp.pos[1] - z.c[1]) - z.r) / 30))));
          trace!.offset[i] *= keep;
          trace!.conf[i] *= keep;
        });
      }
      applyTrace(plan, trace, (i) => !!inRoundabout(plan, plan.samples[i].pos[0], plan.samples[i].pos[1], 0.5));
    }
  }

  await progress("Fetching elevation");
  const bounds = boundsOf([...plan.samples.map((s) => s.pos), ...areaPts], opts.corridor + opts.terrainBlend + 60);
  const landDem = await sources.dem(proj, bounds, opts.demZoom);
  // The horizon only needs coarse heights; a separate low-zoom DEM keeps the download small.
  const farBounds = boundsOf([...plan.samples.map((s) => s.pos), ...areaPts], opts.horizon + BACKDROP_CHUNK);
  const landFarDem = opts.horizon > 0 ? await sources.dem(proj, farBounds, Math.min(opts.demZoom, 12)) : landDem;
  // The sea: a seabed under a water surface, so the bay isn't flat ground.
  const toCoast = (p: { rings: LngLat[][]; edge: boolean[][] }): CoastPolygon => ({ rings: p.rings.map((r) => r.map((q) => proj.toLocal(q))), edge: p.edge });
  const ocean = opts.sea ? (sources.coast?.ocean ?? []).map(toCoast) : [];
  const piers = opts.sea ? (sources.coast?.piers ?? []).map(toCoast) : [];
  const beaches = opts.sea ? (sources.coast?.beaches ?? []).map(toCoast) : [];
  const sea = new SeaMask(ocean, farBounds.minX, farBounds.minY, farBounds.maxX, farBounds.maxY);
  const dem = ocean.length ? withSeabed(landDem, sea) : landDem;
  const farDem = ocean.length ? withSeabed(landFarDem, sea) : landFarDem;
  applyElevation(plan, dem, opts);
  const index = new SegmentIndex(plan);
  const terrainAt = makeTerrainFn(plan, index, dem, opts);
  // How far into what's built a point is, in the corridor's terms (area.ts); `inCover(x, y, k)`: k m inside it.
  const cover = makeCover(index, opts, area);
  const inCover = (x: number, y: number, k = 0) => cover(x, y) <= opts.corridor - k;

  const chunks = planTerrainChunks(plan, index, opts, area);
  const backdrop = planBackdrop(plan, index, opts, area);
  const textures: Kn5Texture[] = [
    { name: "verge.png", data: vergeTexture() },
    { name: "grass.png", data: grassTexture() },
    { name: "wall.png", data: solidTexture([128, 128, 128]) },
  ];
  const materials: Kn5Material[] = [
    material("verge", "verge.png", { ambient: 0.45, diffuse: 0.4, specular: 0, exp: 1 }),
    material("grass", "grass.png", { ambient: 0.45, diffuse: 0.4, specular: 0, exp: 1 }),
    material("wall", "wall.png", { ambient: 0.4, diffuse: 0.4, specular: 0, exp: 1 }),
  ];
  // Raw pixels of the DDS textures, for the 3D preview (browsers can't decode DDS).
  const previewTextures: TrackResult["previewTextures"] = {};
  const addScenery = (tex: string, data: Uint8Array, mat: Kn5Material) => {
    textures.push({ name: tex, data });
    materials.push(mat);
  };
  /** A ground mask for a photo texture (see groundMask); returns the mask's texture name. */
  const photoMask = (name: string, rgba: Uint8Array | Uint8ClampedArray, w: number, h: number) => {
    const mask = groundMask(rgba, w, h);
    textures.push({ name: `${name}_mask.dds`, data: encodeDdsDxt1(mask.rgba, mask.width, mask.height) });
    return `${name}_mask.dds`;
  };
  /** A photo of the ground beside the road: ground detail on it with detail shaders, else plain. */
  const photoGroundMaterial = (name: string, tex: string, img: { rgba: Uint8Array; width: number; height: number }) => {
    const light = { ambient: 0.6, diffuse: 0.2, specular: 0, exp: 1 };
    return opts.detailShaders ? groundMaterial(name, tex, photoMask(name, img.rgba, img.width, img.height), light) : material(name, tex, light);
  };
  addScenery("trees.png", treeSpeciesAtlas(), {
    ...material("trees", "trees.png", { ambient: 0.55, diffuse: 0.35, specular: 0, exp: 1 }),
    shader: "ksPerPixelAT",
    alphaTested: true,
  });
  addScenery("paint.png", paintTexture(), material("paint", "paint.png", { ambient: 0.5, diffuse: 0.5, specular: 0.1, exp: 15 }));
  addScenery("paint_yellow.png", solidTexture([226, 182, 32]), material("paint_yellow", "paint_yellow.png", { ambient: 0.5, diffuse: 0.5, specular: 0.1, exp: 15 }));
  addScenery("rrpm.png", solidTexture([238, 238, 232]), material("rrpm", "rrpm.png", { ambient: 0.6, diffuse: 0.5, specular: 0.6, exp: 40 }));
  addScenery("timber.png", solidTexture([92, 74, 58]), material("timber", "timber.png", { ambient: 0.45, diffuse: 0.45, specular: 0, exp: 1 }));
  addScenery("glass.png", solidTexture([120, 140, 150]), material("glass", "glass.png", { ambient: 0.4, diffuse: 0.3, specular: 0.6, exp: 60 }));
  addScenery("canopy.png", solidTexture([236, 236, 232]), material("canopy", "canopy.png", { ambient: 0.5, diffuse: 0.45, specular: 0.1, exp: 10 }));
  addScenery("lamp.png", solidTexture([150, 152, 150]), material("lamp", "lamp.png", { ambient: 0.45, diffuse: 0.45, specular: 0.3, exp: 30 }));
  addScenery("signal.png", solidTexture([28, 30, 26]), material("signal", "signal.png", { ambient: 0.4, diffuse: 0.4, specular: 0.2, exp: 20 }));
  addScenery("rail.png", railTexture(), material("rail", "rail.png", { ambient: 0.4, diffuse: 0.45, specular: 0.3, exp: 30 }));
  // Walls, roofs and fences: with detail shaders, a normal map from each texture's own shading
  // (mortar joints, weatherboard laps, corrugations) gives them relief.
  const reliefScenery = (name: string, png: Uint8Array, light: { ambient: number; diffuse: number; specular: number; exp: number }, strength: number) => {
    if (!opts.detailShaders) return addScenery(`${name}.png`, png, material(name, `${name}.png`, light));
    const { rgba, width, height } = decodeOwnPng(png);
    textures.push({ name: `${name}.png`, data: png }, { name: `${name}_nm.png`, data: encodePng(normalFromHeight(rgba, width, height, strength), width, height, { alpha: false }) });
    materials.push(nmMaterial(name, `${name}.png`, `${name}_nm.png`, light));
  };
  for (const b of BARRIERS) reliefScenery(`barrier_${b}`, barrierTexture(b), { ambient: 0.45, diffuse: 0.45, specular: 0.1, exp: 15 }, b === "hedge" ? 2 : 3);
  addScenery("window.png", windowTexture(), material("window", "window.png", { ambient: 0.35, diffuse: 0.3, specular: 0.6, exp: 80 }));
  addScenery("door.png", solidTexture([92, 62, 44]), material("door", "door.png", { ambient: 0.45, diffuse: 0.45, specular: 0.15, exp: 15 }));
  addScenery("garage.png", garageTexture(), material("garage", "garage.png", { ambient: 0.45, diffuse: 0.45, specular: 0.2, exp: 20 }));
  addScenery("letterbox.png", solidTexture([168, 52, 40]), material("letterbox", "letterbox.png", { ambient: 0.45, diffuse: 0.45, specular: 0.25, exp: 25 }));
  // Shared textures for detail-mapped materials.
  if (opts.detailShaders) {
    for (const k of ["asphalt", "chipseal"] as const) textures.push({ name: `detail_${k}.png`, data: detailTexture(k) });
    for (const k of ["grass", "dirt", "plain"] as const) textures.push({ name: `ground_${k}.dds`, data: encodeDdsDxt1(groundDetail(k), 512, 512) });
    textures.push({ name: "black.png", data: solidTexture([0, 0, 0]) });
    // The plain grass and gravel textures: all grass, all dirt.
    textures.push({ name: "mask_grass.png", data: solidTexture([255, 0, 0]) }, { name: "mask_dirt.png", data: solidTexture([0, 255, 0]) });
    const swap = (m: Kn5Material) => materials.splice(materials.findIndex((x) => x.name === m.name), 1, m);
    swap(groundMaterial("grass", "grass.png", "mask_grass.png", { ambient: 0.45, diffuse: 0.4, specular: 0, exp: 1 }));
    swap(groundMaterial("verge", "verge.png", "mask_dirt.png", { ambient: 0.45, diffuse: 0.4, specular: 0, exp: 1 }));
    textures.push({ name: "flat_nm.png", data: flatNormalTexture() });
    textures.push({ name: "maps_ground.png", data: mapsTexture(0.1, 0.15, 0) });
    textures.push({ name: "maps_asphalt.png", data: mapsTexture(0.7, 0.5, 0.35) });
  }
  addScenery("wire.png", solidTexture([38, 38, 40]), material("wire", "wire.png", { ambient: 0.35, diffuse: 0.35, specular: 0.2, exp: 20 }));
  addScenery("steel.png", solidTexture([120, 122, 126]), material("steel", "steel.png", { ambient: 0.4, diffuse: 0.45, specular: 0.2, exp: 20 }));
  addScenery("concrete.png", concreteTexture(), material("concrete", "concrete.png", { ambient: 0.45, diffuse: 0.45, specular: 0.05, exp: 10 }));
  addScenery("guidepost.png", postTexture(), material("guidepost", "guidepost.png", { ambient: 0.45, diffuse: 0.45, specular: 0.1, exp: 10 }));
  const matte = { ambient: 0.45, diffuse: 0.45, specular: 0.05, exp: 10 };
  addScenery("sea.png", seaTexture(), material("sea", "sea.png", { ambient: 0.4, diffuse: 0.35, specular: 0.7, exp: 90 }));
  reliefScenery("rock", rockTexture(), { ambient: 0.45, diffuse: 0.45, specular: 0.05, exp: 10 }, 4);
  addScenery("jetty_deck.png", deckTexture(), material("jetty_deck", "jetty_deck.png", { ambient: 0.45, diffuse: 0.45, specular: 0.05, exp: 10 }));
  addScenery("jetty_timber.png", solidTexture([118, 108, 96]), material("jetty_timber", "jetty_timber.png", { ambient: 0.45, diffuse: 0.45, specular: 0, exp: 1 }));
  for (const c of FENCE_COLOURS) {
    reliefScenery(`fence_${c.name}`, fenceTexture(c.rgb), { ambient: 0.45, diffuse: 0.45, specular: 0.2, exp: 25 }, 2);
  }
  reliefScenery("frontwall_limestone", frontWallTexture("limestone"), matte, 3);
  reliefScenery("frontwall_brick", frontWallTexture("brick"), matte, 3);
  addScenery("hedge.png", hedgeTexture(), material("hedge", "hedge.png", { ambient: 0.5, diffuse: 0.4, specular: 0, exp: 1 }));
  addScenery("mulch.png", mulchTexture(), material("mulch", "mulch.png", { ambient: 0.45, diffuse: 0.45, specular: 0, exp: 1 }));
  addScenery("shrubs.png", shrubAtlas(), {
    ...material("shrubs", "shrubs.png", { ambient: 0.55, diffuse: 0.35, specular: 0, exp: 1 }),
    shader: "ksPerPixelAT",
    alphaTested: true,
  });

  const detected: Building[] = [];
  const treeSpots: TreeSpot[] = [];
  const farTreeSpots: TreeSpot[] = [];
  let carsPainted = 0;
  const parkedSpots: ParkedCar[] = [];
  const streetLines = opts.carParks
    ? [...(sources.streets?.lines ?? []).filter((l) => !/^(path|footway|cycleway|track|steps|pedestrian|bridleway)/.test(l.cls)).map((l) => l.pts.map((p) => proj.toLocal(p))), plan.samples.map((s) => s.pos)]
    : [];
  const parkingLines = opts.carParks
    ? (sources.streets?.lines ?? []).filter((l) => /^(service|parking_aisle)/.test(l.cls)).map((l) => l.pts.map((p) => proj.toLocal(p)))
    : [];
  const osmRings = opts.carParks ? (sources.osm?.buildings ?? []).map((b) => b.ring.map((p) => proj.toLocal(p))) : [];
  const islandsFound: { chunk: TerrainChunk; rings: Vec2[][] }[] = [];
  const photos: Parameters<typeof chunkPhotoSampler>[0] = [];

  const textured = new Set<string>();
  if (sources.imagery && opts.imageryZoom > 0) {
    const jobs = [
      ...chunks.map((c) => ({ chunk: c, zoom: opts.imageryZoom, size: opts.textureSize, prefix: "terrain" })),
      ...backdrop.map((c) => ({ chunk: c, zoom: opts.horizonZoom, size: 512, prefix: "backdrop" })),
    ];
    for (const [done, job] of jobs.entries()) {
      await progress("Fetching aerial imagery", done / jobs.length);
      const img = await sources.imagery(proj, job.chunk, job.zoom, job.size);
      if (!img) continue;
      // Busselton fork: parked cars painted out of the ground photo, and the car parks' planted islands found in it.
      const span = job.chunk.maxX - job.chunk.minX;
      let clean: ReturnType<typeof paintOutCars> | null = null;
      if (opts.carParks && img.rgba && job.prefix === "terrain") {
        // Buildings (mapped, and roofs found in this photo) are never painted over.
        const roofs = opts.buildings && opts.detectBuildings ? detectBuildings(img.rgba, job.size, job.chunk).map((b) => b.ring) : [];
        // Cars only near mapped streets (in bush, bright gaps in the canopy look like cars), and the
        // second pass (dark cars, cars between bay lines) only near car-park aisles: on open road
        // it finds tree shadows and patched bitumen.
        clean = paintOutCars(img.rgba, job.size, span / job.size, footprintMask([...osmRings, ...roofs], job.chunk, job.size), {
          carParks: lineMask(parkingLines, job.chunk, job.size, 15),
          streets: lineMask(streetLines, job.chunk, job.size, 14),
        });
      }
      if (clean) {
        carsPainted += clean.cars;
        if (opts.parkedCars) {
          const m = span / job.size;
          for (const c of clean.spots) {
            parkedSpots.push({
              at: [job.chunk.minX + (c.px + 0.5) * m, job.chunk.maxY - (c.py + 0.5) * m],
              dir: [c.dir[0], -c.dir[1]],
              paint: paintFor(c.rgb),
            });
          }
        }
        const rings = opts.carParkIslands ? findIslands(clean.rgba, job.size, job.chunk) : [];
        if (rings.length) islandsFound.push({ chunk: job.chunk, rings });
      }
      const photo = clean?.rgba ?? img.rgba;
      const tex = `${job.prefix}_${job.chunk.key}.${clean ? "dds" : img.ext}`;
      const photoData = clean ? encodeDdsDxt1(clean.rgba, job.size, job.size) : img.data;
      // Aerial photos carry their own light and shadow, so lean on ambient.
      const photoLight = { ambient: 0.6, diffuse: 0.2, specular: 0, exp: 1 };
      if (opts.detailShaders && photo && job.prefix === "terrain") {
        // Grass, dirt and plain detail where the photo shows them, placed by a small mask; the photo
        // (with parked cars painted out) stays DXT1.
        textures.push({ name: tex, data: photoData });
        materials.push(groundMaterial(`${job.prefix}_${job.chunk.key}`, tex, photoMask(`${job.prefix}_${job.chunk.key}`, photo, job.size, job.size), photoLight));
      } else {
        textures.push({ name: tex, data: photoData });
        materials.push(material(`${job.prefix}_${job.chunk.key}`, tex, photoLight));
      }
      textured.add(job.chunk.key);
      if (img.rgba && job.prefix === "terrain") {
        treeSpots.push(...treeSpotsFromImagery(img.rgba, job.size, job.chunk, opts.trees));
        if (opts.buildings && opts.detectBuildings) detected.push(...detectBuildings(img.rgba, job.size, job.chunk));
        photos.push({ chunk: job.chunk, rgba: img.rgba, size: job.size });
      }
      if (img.rgba && job.prefix === "backdrop" && opts.trees > 0) farTreeSpots.push(...treeSpotsFromImagery(img.rgba, job.size, job.chunk, 1));
    }
  }

  // Other streets: planned now so buildings, trees and verges can keep clear.
  const streetPlan = planSideStreets(
    opts.sideStreets ? sources.streets?.lines ?? [] : [], sources.streets?.names ?? [], plan, index, opts, proj, area,
  );
  const sideTraced = raster && opts.traceRoads ? traceSideStreets(streetPlan.streets, raster, opts, index) : 0;
  const streetIndex = new LineIndex(streetPlan.streets);
  const mouth = (side: 1 | -1, sd: number) => streetPlan.junctions.some((j) => j.side === side && Math.abs(j.s - sd) < j.width / 2 + 1.5);

  const mapped: Building[] = opts.buildings
    ? (sources.osm?.buildings ?? []).map((b, i) => fromOsm(b.ring.map((p) => proj.toLocal(p)), b.tags, i))
    : [];
  // A house on every lot along the streets, where the photo shows a roof there.
  const photo = chunkPhotoSampler(photos);
  const frontage = photo && opts.buildings && opts.detectBuildings ? (() => {
    const realStreets = streetPlan.streets.filter((st) => /^(primary|secondary|tertiary|minor)/.test(st.cls));
    const known = [...mapped, ...detected].map((b) => centroid(b.ring));
    const cache = new Map<string, boolean>();
    const builtUp = (x: number, y: number) => {
      const key = `${Math.floor(x / 50)},${Math.floor(y / 50)}`;
      let v = cache.get(key);
      if (v === undefined) {
        const cx = (Math.floor(x / 50) + 0.5) * 50, cy = (Math.floor(y / 50) + 0.5) * 50;
        const near = (r: number) => ([px, py]: Vec2) => Math.hypot(px - cx, py - cy) < r;
        v = known.filter(near(150)).length >= 4 || realStreets.filter((st) => st.pts.some(near(120))).length >= 3;
        cache.set(key, v);
      }
      return v;
    };
    const onRoad = (x: number, y: number) => {
      const n = index.nearest(x, y, 30);
      return (!!n && n.dist < index.at(n).width / 2 + 1) || streetIndex.clearance(x, y) < 1;
    };
    return frontageHouses([
      { pts: plan.samples.map((s) => s.pos), half: plan.samples.map((s) => s.width / 2) },
      ...streetPlan.streets.map((st) => ({ pts: st.pts, half: st.pts.map((_, i) => (st.widths?.[i] ?? st.width) / 2) })),
    ], photo, onRoad, builtUp, [...mapped, ...detected], plan.samples.length);
  })() : [];
  const kept = filterBuildings([...mapped, ...detected, ...frontage], index, opts, opts.buildingRadius)
    .filter((b) => !b.ring.some(([x, y]) => inRoundabout(plan, x, y, opts.vergeWidth + 2)))
    // Detected roofs on a street are paving, not houses; mapped ones get a little more benefit of the doubt.
    .filter((b) => !b.ring.some(([x, y]) => streetIndex.clearance(x, y) < (b.source !== "osm" ? 1 : -0.5)));
  dressBuildings(kept, {
    roadEdge: (x, y) => {
      const n = index.nearest(x, y, 40);
      return Math.min(n ? n.dist - index.at(n).width / 2 : Infinity, streetIndex.clearance(x, y));
    },
    pois: (sources.pois ?? []).map((p) => ({ at: proj.toLocal(p.at), cls: p.cls, subclass: p.subclass })),
    queensland: proj.origin[1] > -29.2 && proj.origin[1] < -10 && proj.origin[0] > 138,
  });
  // Only the wall and roof finishes these buildings wear go in the file.
  const finishes = usedFinishes(kept);
  // As DXT1 (a sixth of the PNG's size for these noisy textures), with a normal map from their shading.
  const buildingScenery = (name: string, png: Uint8Array, light: { ambient: number; diffuse: number; specular: number; exp: number }, strength: number) => {
    const { rgba, width, height } = decodeOwnPng(png);
    textures.push({ name: `${name}.dds`, data: encodeDdsDxt1(rgba, width, height) });
    previewTextures[`${name}.dds`] = { rgba, width, height };
    if (!opts.detailShaders) {
      materials.push(material(name, `${name}.dds`, light));
      return;
    }
    textures.push({ name: `${name}_nm.dds`, data: encodeDdsDxt1(normalFromHeight(rgba, width, height, strength), width, height) });
    materials.push(nmMaterial(name, `${name}.dds`, `${name}_nm.dds`, light));
  };
  const facadeScenery = (fi: number) => {
    const fc = FACADES[fi];
    buildingScenery(`facade_${fc.name}`, facadeTexture(fc), fc.wall === "glass"
      ? { ambient: 0.35, diffuse: 0.35, specular: 0.6, exp: 60 }
      : { ambient: 0.45, diffuse: 0.45, specular: 0.05, exp: 10 }, fc.wall === "glass" ? 1 : 3);
  };
  for (const fi of finishes.facades) facadeScenery(fi);
  for (const ri of finishes.roofs) {
    const c = ROOF_COLOURS[ri];
    buildingScenery(`roof_${c.name}`, roofTexture(c), { ambient: 0.45, diffuse: 0.45, specular: c.kind === "metal" ? 0.25 : 0.05, exp: 25 }, 4);
  }

  await progress("Building road and terrain meshes");
  // Road surface per chunk: dense asphalt on major roads and in built-up
  // areas, chip seal on rural roads (the usual Australian split).
  const centres = kept.map((b) => b.ring[0]);
  const surfaceMaterials = new Set<string>();
  const roadMaterial = (ci: number, meanWidth: number, mid: RoadSample): string => {
    let kind: SealKind;
    if (opts.roadSurface === "asphalt" || opts.roadSurface === "chipseal") kind = opts.roadSurface;
    else {
      const cls = sources.roadClassAt?.(proj.toLngLat(mid.pos));
      const nearby = centres.filter(([x, y]) => Math.hypot(x - mid.pos[0], y - mid.pos[1]) < 150).length;
      // Kerbed streets are town streets: asphalt.
      kind = /^(motorway|trunk|primary)/.test(cls ?? "") || nearby >= 8 || !!mid.kerb ? "asphalt" : "chipseal";
    }
    const twoLane = meanWidth >= 5.5;
    const name = `road_${kind}_${twoLane ? 2 : 1}_${ci % 3}`;
    if (!surfaceMaterials.has(name)) {
      surfaceMaterials.add(name);
      const tex = sealTexture(kind, twoLane, ci % 3);
      previewTextures[`${name}.dds`] = { rgba: tex.rgba, width: tex.width, height: tex.height };
      const light = { ambient: 0.4, diffuse: 0.45, specular: kind === "asphalt" ? 0.08 : 0.04, exp: 20 };
      if (opts.detailShaders) {
        // Stones in the surface up close: detail everywhere (alpha 0), about 0.8 m a tile across the road.
        const rgba = new Uint8Array(tex.rgba);
        for (let i = 3; i < rgba.length; i += 4) rgba[i] = 0;
        textures.push({ name: `${name}.dds`, data: encodeDdsDxt5(rgba, tex.width, tex.height) });
        // Cracks and patch edges as relief, from the seal texture's own shading.
        textures.push({ name: `${name}_nm.dds`, data: encodeDdsDxt1(normalFromHeight(tex.rgba, tex.width, tex.height, 3), tex.width, tex.height) });
        materials.push(multiMapMaterial(name, `${name}.dds`, light, {
          normal: `${name}_nm.dds`, maps: "maps_asphalt.png", detail: `detail_${kind}.png`, detailUV: 9, sunSpecular: 0.15,
        }));
      } else {
        textures.push({ name: `${name}.dds`, data: tex.dds });
        materials.push(material(name, `${name}.dds`, light));
      }
    }
    return name;
  };
  // Photo surface: chunks where the road was traced get their own stretch of the aerial photo.
  const chunkMaterial: RoadMaterialFn = (ci, w, mid, a, b) => {
    if (opts.roadSurface === "photo" && raster && trace && a >= 0) {
      const tr = trace;
      const trusted = (i: number) => tr.conf[i] > 0.7;
      let ok = 0;
      for (let i = a; i <= b; i++) if (trusted(i % plan.samples.length)) ok++;
      if (ok / (b - a + 1) >= 0.3) {
        const name = `road_photo_${String(ci).padStart(3, "0")}`;
        const tex = photoRoadTexture(plan, displayOf(raster), a, b, trusted);
        textures.push({ name: `${name}.dds`, data: encodeDdsDxt1(tex.rgba, tex.width, tex.height) });
        previewTextures[`${name}.dds`] = tex;
        materials.push(material(name, `${name}.dds`, { ambient: 0.42, diffuse: 0.45, specular: 0.06, exp: 20 }));
        return { material: name, perChunk: true };
      }
    }
    return roadMaterial(ci, w, mid);
  };
  // Kerb and gutter: read off the photo where the road was traced; in town
  // they are the rule, so there it takes little evidence (or none, under canopy).
  const nS = plan.samples.length;
  // How built-up it is around each sample (checked every 10 m): 2 = town
  // (dense houses or a street grid), 1 = edge of town, 0 = country.
  // Motorways never count. Only real streets count, not driveways and tracks.
  const streets = streetPlan.streets.filter((st) => /^(primary|secondary|tertiary|minor)/.test(st.cls));
  const town: number[] = [];
  plan.samples.forEach((s, i) => {
    if (i % 5) return town.push(town[i - 1]);
    const near = (r: number) => ([x, y]: Vec2) => Math.hypot(x - s.pos[0], y - s.pos[1]) < r;
    const cls = sources.roadClassAt?.(proj.toLngLat(s.pos)) ?? "";
    if (/^(motorway|trunk)/.test(cls)) return town.push(0);
    const houses = centres.filter(near(150)).length, grid = streets.filter((st) => st.pts.some(near(120))).length;
    town.push(houses >= 20 || grid >= 5 ? 2 : houses >= 8 || grid >= 3 ? 1 : 0);
  });
  // Speed limit at a sample, km/h, by road class and how built-up it is (traffic and the AI's hints).
  const speedAt = (i: number) => {
    const cls = sources.roadClassAt?.(proj.toLngLat(plan.samples[i].pos)) ?? "";
    if (/^(motorway|trunk)/.test(cls)) return town[i] ? 70 : 100;
    if (/^primary/.test(cls)) return town[i] ? 60 : 90;
    return town[i] >= 1 ? 50 : 80;
  };
  let kerbs: [number[], number[]] = [new Array(nS).fill(0), new Array(nS).fill(0)];
  if (opts.kerbs) {
    const tr = trace;
    const evidence = raster && tr ? kerbEvidence(plan, raster, (i) => tr.conf[i] > 0.7) : null;
    // A kerb must never stand on anything drivable: none across a side
    // street's mouth, on the inside of a turn too tight for the strip (it
    // would fold over onto the road), or anywhere its gutter, kerb or strip
    // would land on another street, a roundabout or another stretch of the
    // route itself.
    const kerbBlocked = (i: number, side: 1 | -1) => {
      const s = plan.samples[i];
      if (streetPlan.junctions.some((j) => j.side === side && Math.abs(j.s - s.s) < j.width / 2 + 4)) return true;
      const half = s.width / 2, reach = half + opts.vergeWidth + STRIP_EXTRA;
      const inside = s.curvature * side;
      if (inside > 0 && 1 / inside < reach + 3) return true;
      for (const t of [half + 0.3, half + KERB_BACK, half + 1.5, reach]) {
        const x = s.pos[0] + s.left[0] * t * side, y = s.pos[1] + s.left[1] * t * side;
        if (inRoundabout(plan, x, y, 1.5) || streetIndex.clearance(x, y) < 0.5) return true;
        // Clearly on the route's asphalt (another stretch of it).
        const n = index.nearest(x, y, 30);
        if (n && n.dist < index.at(n).width / 2 - 0.2) return true;
      }
      return false;
    };
    kerbs = planKerbs(plan, evidence, (i) => town[i], kerbBlocked);
    // A roundabout is kerbed when the road is kerbed coming up to it.
    for (const rb of plan.roundabouts) {
      const reach = outerRadius(rb) + 30;
      rb.kerbed = plan.samples.some((s, i) => (kerbs[0][i] || kerbs[1][i]) && Math.hypot(s.pos[0] - rb.c[0], s.pos[1] - rb.c[1]) < reach);
    }
  }
  // Record the kerbs on the samples too: the terrain reads them (SegmentIndex.at),
  // so the ground behind a kerb starts at nature strip height. Without this it
  // started BELOW_VERGE under the road edge, leaving a step of about 40 cm
  // between the back of the nature strip and the ground.
  plan.samples.forEach((smp, i) => {
    if (kerbs[0][i] > 0 || kerbs[1][i] > 0) smp.kerb = [kerbs[0][i], kerbs[1][i]];
  });
  const kerbAt = (i: number, side: 1 | -1) => kerbs[side === 1 ? 0 : 1][((i % nS) + nS) % nS] > 0;
  // The gravel verge gives way to the kerb's nature strip, which also covers the slopes where kerbs start and end.
  const roadMeshes = buildRoadMeshes(plan, opts, chunkMaterial, (i, side) => mouth(side, plan.samples[i % nS].s) || kerbAt(i, side));
  plan.roundabouts.forEach((rb, k) => {
    const open = [...roadMeshes.openings[k]];
    // Side streets that run into the ring get an opening in its verge and kerb too.
    const Ro = outerRadius(rb);
    for (const st of streetPlan.streets) {
      for (const p of [st.pts[0], st.pts[st.pts.length - 1]]) {
        if (Math.hypot(p[0] - rb.c[0], p[1] - rb.c[1]) > Ro + 6) continue;
        const a = Math.atan2(p[1] - rb.c[1], p[0] - rb.c[0]), half = (st.width / 2 + 2.5) / Ro;
        open.push([a - half, a + half]);
      }
    }
    if (open.length) rb.openings = open;
  });
  // Nature strips: the aerial photo of the strip itself when there is one, so footpaths and driveways show.
  const stripMaterial: StripMaterialFn = (ci, a, b) => {
    if (!raster || opts.imageryZoom <= 0) return { material: "grass", photo: false };
    const name = `strip_photo_${String(ci).padStart(3, "0")}`;
    const tex = stripPhotoTexture(plan, displayOf(raster), opts, a, b);
    textures.push({ name: `${name}.dds`, data: encodeDdsDxt1(tex.rgba, tex.width, tex.height) });
    previewTextures[`${name}.dds`] = tex;
    materials.push(photoGroundMaterial(name, `${name}.dds`, tex));
    return { material: name, photo: true };
  };
  // Kerbs round the corners into side streets, carrying on along each one's first 40 m; then along the road.
  const surface = streetSurface(plan, index, opts, (x, y) => terrainAt(x, y).h);
  const streetAt = streetPlan.junctions.map((j) => {
    const s = plan.samples[j.seg], half = s.width / 2;
    const o: Vec2 = [s.pos[0] + s.left[0] * j.side * half, s.pos[1] + s.left[1] * j.side * half];
    for (const st of streetPlan.streets) {
      for (const k of st.joins) if (Math.hypot(st.pts[k][0] - o[0], st.pts[k][1] - o[1]) < 4) return { st, k };
    }
    return null;
  });
  const streetEdge = (ji: number, c: -1 | 1, R: number) => {
    const m = streetAt[ji];
    if (!m) return null;
    const { st, k: k0 } = m;
    const n = st.pts.length, step = k0 === 0 ? 1 : -1;
    const tan = plan.samples[streetPlan.junctions[ji].seg].tan;
    const dirAt = (k: number): Vec2 => {
      const a = st.pts[Math.max(0, k - 1)], b = st.pts[Math.min(n - 1, k + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    };
    // Which side of the street this corner is on (the street's own left, in its point order).
    const d0 = dirAt(k0);
    const sideSt = tan[0] * c * -d0[1] + tan[1] * c * d0[0] >= 0 ? 1 : -1;
    const out: { pos: [number, number]; out: [number, number]; z: number }[] = [];
    let dist = 0;
    for (let k = k0; k >= 0 && k < n; k += step) {
      if (k !== k0) dist += Math.hypot(st.pts[k][0] - st.pts[k - step][0], st.pts[k][1] - st.pts[k - step][1]);
      if (dist < R) continue;
      if (dist > R + 40) break;
      const d = dirAt(k), left: [number, number] = [-d[1] * sideSt, d[0] * sideSt];
      const w = (st.widths?.[k] ?? st.width) / 2;
      const pos: [number, number] = [st.pts[k][0] + left[0] * w, st.pts[k][1] + left[1] * w];
      // Stop short of the route (the street's far end) or a roundabout.
      const near = index.nearest(pos[0], pos[1], 30);
      if (dist > R + 4 && near && near.dist < index.at(near).width / 2 + 4) break;
      if (inRoundabout(plan, pos[0], pos[1], 4)) break;
      out.push({ pos, out: left, z: surface(st, k, sideSt * w) });
    }
    return out.length > 4 ? out : null;
  };
  const returns = opts.kerbs
    ? buildKerbReturns(plan, opts, streetPlan.junctions, kerbs, roadMaterial(0, 6, { ...plan.samples[0], kerb: [1, 1] }), raster && opts.imageryZoom > 0 ? displayOf(raster) : undefined, streetEdge, photo ?? undefined)
    : null;
  const kerbReturns = returns?.nodes ?? [];
  if (returns?.sideAtlas) {
    textures.push({ name: "sidestrips_photo.dds", data: encodeDdsDxt1(returns.sideAtlas.rgba, returns.sideAtlas.width, returns.sideAtlas.height) });
    previewTextures["sidestrips_photo.dds"] = returns.sideAtlas;
    materials.push(photoGroundMaterial("sidestrips_photo", "sidestrips_photo.dds", returns.sideAtlas));
  }
  if (returns?.atlas) {
    textures.push({ name: "returns_photo.dds", data: encodeDdsDxt1(returns.atlas.rgba, returns.atlas.width, returns.atlas.height) });
    previewTextures["returns_photo.dds"] = returns.atlas;
    materials.push(photoGroundMaterial("returns_photo", "returns_photo.dds", returns.atlas));
  }
  // Footpaths and driveway crossovers in the nature strip, where the photo shows them; the kerb lays back at each driveway.
  const stripOuter = opts.vergeWidth + STRIP_EXTRA;
  const verge = opts.kerbs && raster ? readVerge(plan, raster, kerbs, stripOuter, (x, y) => streetIndex.clearance(x, y) < 0.5) : null;
  const kerbMeshes = buildKerbs(plan, opts, kerbs, stripMaterial, returns?.noRamp, verge ? laybacks(nS, verge) : undefined);
  const vergeGround = (x: number, y: number, d: number, smp: RoadSample, side: 1 | -1) =>
    d <= stripOuter ? surfaceHeight(smp, (side * smp.width) / 2, opts.crown) + KERB_H : terrainAt(x, y).h;
  const vergeConcrete = verge ? buildVergeConcrete(plan, verge, vergeGround) : [];
  // Photo surface on the traced side streets too (the nearest 40, to keep the file in check).
  const photoStreets = new Set(
    opts.roadSurface === "photo" && raster
      ? streetPlan.streets
        .filter((st) => st.traced && st.traced.conf.filter((c) => c > 0.7).length / st.traced.conf.length > 0.5)
        .map((st) => ({ st, d: Math.min(...st.pts.map((p) => index.nearest(p[0], p[1], 500)?.dist ?? 500)) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 40)
        .map((x) => x.st)
      : [],
  );
  const sideStreets = buildSideStreets(streetPlan.streets, plan, index, opts, (x, y) => terrainAt(x, y).h, (st, i) => {
    if (photoStreets.has(st) && st.traced && raster) {
      const sub = st.traced.plan, conf = st.traced.conf;
      const name = `side_photo_${String(i).padStart(3, "0")}`;
      // 128 px across; about 12 cm per pixel along, in a power of two.
      let h = 64;
      while (h < sub.length / 0.12 && h < 2048) h *= 2;
      const tex = photoRoadTexture(sub, displayOf(raster), 0, sub.samples.length - 1, (k) => conf[k] > 0.7, 128, h);
      textures.push({ name: `${name}.dds`, data: encodeDdsDxt1(tex.rgba, tex.width, tex.height) });
      previewTextures[`${name}.dds`] = tex;
      materials.push(material(name, `${name}.dds`, { ambient: 0.42, diffuse: 0.45, specular: 0.06, exp: 20 }));
      return { material: name, perStreet: true };
    }
    const mid = st.pts[Math.floor(st.pts.length / 2)];
    return roadMaterial(i, st.width, { ...plan.samples[0], pos: mid });
  });
  const sampleNear = (sd: number) => plan.samples[Math.max(0, Math.min(plan.samples.length - 1, Math.round(sd / opts.spacing)))];
  // Markings read off the photo where the road was traced; generated elsewhere.
  let imageLines: ImageLine[] = [];
  let covered = (_i: number) => false;
  if (opts.markings && raster && trace) {
    await progress("Reading line markings from the aerial photos");
    const tr = trace;
    const trusted = (i: number) => tr.conf[i] > 0.7;
    imageLines = findLines(plan, paintCandidates(plan, raster, trusted), trusted);
    const near = new Uint8Array(plan.samples.length);
    const reachSamples = Math.round(40 / opts.spacing);
    for (const ln of imageLines) {
      for (let i = Math.max(0, ln.i0 - reachSamples); i <= Math.min(plan.samples.length - 1, ln.i1 + reachSamples); i++) near[i] = 1;
    }
    covered = (i) => trusted(i) && near[i] === 1;
  }
  // Painted marks street-level imagery located: snapped to the road at their distance along it.
  const discreteMarks = (): DiscreteMark[] => (sources.seen ?? []).flatMap((f): DiscreteMark[] => {
    const m = /^marking--discrete--(stop-line|give-way|crosswalk-zebra|arrow--([a-z-]+)|text--([a-z0-9-]+)|symbol--(bicycle))/.exec(f.value);
    if (!m) return [];
    const p = proj.toLocal(f.at);
    const n = index.nearest(p[0], p[1], 15);
    // Seen on this road, not the other carriageway or a side street.
    if (!n || Math.abs(n.t) > plan.samples[n.seg].width / 2 + 1) return [];
    const at = { s: plan.samples[n.seg].s + n.frac * opts.spacing, t: n.t };
    if (m[2]) return [{ ...at, kind: "arrow", shape: m[2] }];
    if (m[3]) return [{ ...at, kind: "text", shape: m[3] }];
    if (m[4]) return [{ ...at, kind: "symbol", shape: m[4] }];
    return [{ ...at, kind: m[1] === "stop-line" ? "stop" : m[1] === "give-way" ? "giveway" : "zebra" }];
  }).filter((d, i, all) => !all.slice(0, i).some((e) => e.kind === d.kind && Math.abs(e.s - d.s) < 8
    // Arrows and numbers: one per lane.
    && (!/^(arrow|text|symbol)$/.test(d.kind) || Math.sign(e.t) === Math.sign(d.t) && Math.abs(e.t - d.t) < 1.6)));
  const markings = opts.markings
    ? buildMarkings(plan, opts, (sd) => {
      const p = sampleNear(sd).pos;
      return !!inRoundabout(plan, p[0], p[1], 1);
    }, (side, sd) => mouth(side, sd) || kerbAt(Math.round(sd / opts.spacing), side), { lines: imageLines, covered }, [
      ...discreteMarks(),
      // The start and finish lines themselves, painted across the road.
      ...(plan.timed ? [
        { s: plan.samples[plan.timed.start].s, t: 0, kind: "start" as const },
        { s: plan.samples[plan.timed.finish].s, t: 0, kind: "finish" as const },
      ] : []),
    ])
    : [];
  /** A square photo texture centred on a roundabout, out to its verge's outer edge, or undefined with no photo there. */
  const ringPhoto = (rb: (typeof plan.roundabouts)[number], k: number) => {
    if (!photo) return undefined;
    const half = vergeOuterRadius(rb, opts) + 1, size = 256;
    const rgba = new Uint8Array(size * size * 4);
    let seen = 0;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const c = photo(rb.c[0] - half + ((px + 0.5) / size) * 2 * half, rb.c[1] + half - ((py + 0.5) / size) * 2 * half);
        const i = (py * size + px) * 4;
        if (c) seen++;
        rgba[i] = Math.round((c?.[0] ?? 0.45) * 255);
        rgba[i + 1] = Math.round((c?.[1] ?? 0.45) * 255);
        rgba[i + 2] = Math.round((c?.[2] ?? 0.4) * 255);
        rgba[i + 3] = 255;
      }
    }
    if (seen < size * size * 0.9) return undefined;
    const name = `rbphoto_${k}`, tex = `${name}.dds`;
    textures.push({ name: tex, data: encodeDdsDxt1(rgba, size, size) });
    previewTextures[tex] = { rgba, width: size, height: size };
    materials.push(photoGroundMaterial(name, tex, { rgba, width: size, height: size }));
    return { material: name, minX: rb.c[0] - half, maxY: rb.c[1] + half, span: 2 * half };
  };
  const ringGround = meshTop(terrainAt, opts);
  // The full circulating carriageway and island of each roundabout.
  const ringNodes: Kn5Node[] = [];
  plan.roundabouts.forEach((rb, k) => {
    const nearest = plan.samples.reduce((a, s) => (Math.abs(s.s - rb.sIn) < Math.abs(a.s - rb.sIn) ? s : a));
    // Busselton fork: the island and the grass round the ring in their own aerial photo (mulch,
    // plantings, paving, lawn), cut from the photos around the ring, instead of plain bright grass.
    const m = buildRingMeshes(rb, k, opts, roadMaterial(Math.floor(plan.samples.indexOf(nearest) / 120), rb.w, nearest), ringPhoto(rb, k), ringGround);
    ringNodes.push(m.road, m.island, m.verge, ...m.kerb);
    const paint = opts.markings ? buildRingMarkings(rb, k) : null;
    if (paint) markings.push(paint);
  });
  const terrainNodes: Kn5Node[] = [];
  for (const [i, chunk] of chunks.entries()) {
    await progress("Building road and terrain meshes", i / chunks.length);
    const mesh = buildTerrainChunk(chunk, terrainAt, opts, textured.has(chunk.key), area);
    if (mesh) terrainNodes.push(mesh);
  }
  const backdropNodes: Kn5Node[] = [];
  for (const chunk of backdrop) {
    const mesh = buildBackdropChunk(chunk, farDem, index, opts, textured.has(chunk.key), area ? cover : undefined);
    if (mesh) backdropNodes.push(mesh);
  }
  const ground = (x: number, y: number) => terrainAt(x, y).h;
  const onMesh = meshTop(terrainAt, opts);
  const walls = buildWalls(plan, opts, ground, index);

  await progress("Placing scenery");
  const offRings = (spots: TreeSpot[]) => spots.filter((t) => !inRoundabout(plan, t.x, t.y, opts.vergeWidth + 3));
  const offStreets = (spots: TreeSpot[]) => spots.filter((t) => streetIndex.clearance(t.x, t.y) > 1.5);
  // Local species: she-oaks and Norfolk pines on the coast, peppermints on kerbed town streets, tuarts in the bush.
  const speciesRand = rng(4242);
  // Town: kerb and gutter within ~150 m along the road (kerbs are only built where the photo shows them).
  const FORESHORE = 120;
  const kerbedNear = plan.samples.map((_, i) => {
    const reach = Math.round(150 / opts.spacing);
    for (let k = -reach; k <= reach; k++) {
      const smp = plan.samples[plan.closed ? (i + k + nS) % nS : Math.max(0, Math.min(nS - 1, i + k))];
      if (smp.kerb && (smp.kerb[0] > 0 || smp.kerb[1] > 0)) return true;
    }
    return false;
  });
  const planted = filterTrees(treeSpots, index, opts, opts.maxTrees, area ? cover : undefined).map((t) => {
    const n = index.nearest(t.x, t.y, opts.corridor + 10);
    const town = !!n && kerbedNear[n.seg];
    return { ...t, variant: pickSpecies(speciesRand(), !!t.coastal, town, ocean.length > 0 && sea.near(t.x, t.y, FORESHORE)) };
  });
  const treesKept = offStreets(offRings(planted)).filter((t) => !cleared(t.x, t.y, true));
  const trees = buildTrees(treesKept, ground);
  const trunks = treeTrunks(treesKept, ground);
  // Tree lines on the horizon: canopy in the far photo, out to 1 km, as cheap unshadowed sprites.
  const far = farTreeSpots.filter((t) => !inCover(t.x, t.y, -5) && cover(t.x, t.y) < 1000 && !sea.has(t.x, t.y));
  const farStep = Math.max(1, far.length / 3000);
  const horizonTrees = buildTrees(
    Array.from({ length: Math.floor(far.length / farStep) }, (_, i) => far[Math.floor(i * farStep)])
      .map((t) => ({ ...t, scale: t.scale * 1.15, variant: pickSpecies(speciesRand(), !!t.coastal, false) })),
    (x, y) => backdropHeight(farDem, index, opts, x, y, area ? cover : undefined) - 0.6,
    "HORIZONTREES",
  ).map((m) => ({ ...m, castShadows: false }));
  // Fences, walls and hedges where OSM maps them, never near the road or across a street.
  const barriers = buildBarriers(
    (sources.osm?.barriers ?? []).map((b) => ({ ...b, pts: b.pts.map((p) => proj.toLocal(p)) })),
    index, opts, ground,
    (x, y) => streetIndex.clearance(x, y) > 1.5 && !inRoundabout(plan, x, y, opts.vergeWidth + 3),
    area ? cover : undefined,
  );
  // A tree and a ring of shrubs on each island big enough for them.
  const islandTrees = plan.roundabouts.flatMap((rb) => {
    const ri = innerRadius(rb);
    if (opts.trees <= 0 || ri < 4) return [];
    const shrubs: TreeSpot[] = [{ x: rb.c[0], y: rb.c[1], scale: Math.min(0.9, ri / 12), variant: 0 }];
    const count = Math.floor(ri);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * 2 * Math.PI;
      shrubs.push({ x: rb.c[0] + Math.cos(a) * ri * 0.55, y: rb.c[1] + Math.sin(a) * ri * 0.55, scale: 0.22, variant: k % 2 });
    }
    return shrubs;
  });
  const islandGround = (x: number, y: number) => {
    const rb = inRoundabout(plan, x, y)!;
    return ringHeight(rb, innerRadius(rb)) + 0.55;
  };
  const shrubs = islandTrees.length ? buildTrees(islandTrees, islandGround, "ISLANDTREES") : [];

  // Footpaths and the red shared path, clear of the road, the streets, car park aisles and the rings.
  const nearVergeConcrete = (x: number, y: number) => {
    const n = verge ? index.nearest(x, y, 20) : null;
    if (!n) return false;
    const band = verge!.paths[n.t >= 0 ? 0 : 1][n.seg];
    const d = n.dist - index.at(n).width / 2;
    return !!band && d > band.d0 - 1 && d < band.d1 + 1;
  };
  const serviceIndex = new LineIndex((sources.streets?.lines ?? [])
    .filter((l) => /^(service|parking_aisle)/.test(l.cls) && l.brunnel !== "bridge" && l.brunnel !== "tunnel")
    .map((l) => ({ pts: l.pts.map((p) => proj.toLocal(p)), width: 5 })));
  const pathMeshes = opts.paths && sources.paths?.length
    ? buildPaths(
      sources.paths.map((l) => ({ kind: l.kind, pts: l.pts.map((p) => proj.toLocal(p)) })),
      (x, y) => Math.max(ground(x, y), onMesh(x, y)),
      (x, y, half, kind) => {
        // Not under a ring's verge and grass strip.
        if (plan.roundabouts.some((rb) => Math.hypot(x - rb.c[0], y - rb.c[1]) < vergeOuterRadius(rb, opts) + half + 0.3)) return false;
        const n = index.nearest(x, y, 30);
        // Clear of the asphalt plus gutter and kerb (~0.5 m); paths often run right behind the kerb.
        if (n && n.dist < index.at(n).width / 2 + 0.5 + half) return false;
        // Where the photo already gave a footpath here (footpaths.ts), don't lay OSM's on top.
        if (kind === "foot" && nearVergeConcrete(x, y)) return false;
        // Not across car park aisles and driveways (OSM service roads).
        if (serviceIndex.clearance(x, y) < half + 0.3) return false;
        return streetIndex.clearance(x, y) > half + 0.3 && !inRoundabout(plan, x, y, half + 2);
      },
      (x, y) => inCover(x, y, 5),
    )
    : [];
  if (pathMeshes.length) {
    textures.push({ name: "path_shared.png", data: sharedPathTexture() }, { name: "path_foot.png", data: footPathTexture() });
    materials.push(
      material("path_shared", "path_shared.png", { ambient: 0.45, diffuse: 0.45, specular: 0.05, exp: 10 }),
      material("path_foot", "path_foot.png", { ambient: 0.45, diffuse: 0.45, specular: 0.05, exp: 10 }),
    );
  }
  const ringWalls = plan.roundabouts.map((rb, k) => buildRingWall(rb, k, opts, ground)).filter((w): w is Kn5Node & { kind: "mesh" } => !!w);

  const osmRails = opts.guardRails ? (sources.osm?.guardRails ?? []).map((l) => l.map((p) => proj.toLocal(p))) : [];
  const needs = railNeeds(plan, opts, ground, osmRails, index);
  if (!opts.guardRails) needs.forEach((side) => side.fill(false));
  // No rails or posts on or beside a roundabout.
  const nearRing = plan.samples.map((s) => !!inRoundabout(plan, s.pos[0], s.pos[1], 15));
  // Nor across a side street's mouth.
  needs.forEach((side, k) => side.forEach((_, i) => { if (mouth(k === 0 ? 1 : -1, plan.samples[i].s)) side[i] = false; }));
  needs.forEach((side) => side.forEach((_, i) => { if (nearRing[i]) side[i] = false; }));
  // Kerbed streets have neither.
  needs.forEach((side, k) => side.forEach((_, i) => { if (kerbAt(i, k === 0 ? 1 : -1)) side[i] = false; }));
  const rails = buildGuardRails(plan, opts, needs);
  const postMask = needs.map((side, k) => side.map((v, i) => v || nearRing[i] || mouth(k === 0 ? 1 : -1, plan.samples[i].s) || kerbAt(i, k === 0 ? 1 : -1))) as [boolean[], boolean[]];
  const posts = opts.guidePosts ? buildGuidePosts(plan, opts, postMask) : [];
  // Inside the corridor buildings stand on the detailed terrain; further out, on the horizon mesh.
  const buildingGround = (x: number, y: number) => {
    return inCover(x, y, 1) ? ground(x, y) : backdropHeight(farDem, index, opts, x, y, area ? cover : undefined) - 0.6;
  };
  // Power poles, wires and street lights: seen, mapped, or (lights, in town) at a typical spacing.
  const seenLocal = mergeSightings((sources.seen ?? []).map((f) => ({ ...f, at: proj.toLocal(f.at) })));
  const osmLocal = (pts?: LngLat[]) => (pts ?? []).map((p) => proj.toLocal(p));
  const utilities = placeUtilities({
    poles: [...seenLocal.filter((f) => /^object--support--utility-pole/.test(f.value)).map((f) => f.at), ...osmLocal(sources.osm?.poles)],
    lamps: [...seenLocal.filter((f) => /^object--street-light/.test(f.value)).map((f) => f.at), ...osmLocal(sources.osm?.lamps)],
    lines: (sources.osm?.powerLines ?? []).map(osmLocal),
  }, plan, index, opts, (i) => town[i], (x, y) => streetIndex.clearance(x, y) < 1 || kept.some((b) => pointInRing(x, y, b.ring)));
  // Busselton fork: car park lights along each car park aisle, beside the bays, clear of the road,
  // other aisles and streets, parked cars and buildings, inside the built corridor.
  const carPark = carParkLights(
    (sources.streets?.lines ?? []).filter((l) => l.service === "parking_aisle").map((l) => l.pts.map((p) => proj.toLocal(p))),
    (x, y) => Math.max(ground(x, y), onMesh(x, y)),
    (x, y) => {
      const n = index.nearest(x, y, opts.corridor - 5);
      return !inCover(x, y, 5) || (!!n && n.dist < index.at(n).width / 2 + 2) || streetIndex.clearance(x, y) < 1.5 || !!inRoundabout(plan, x, y, 3)
        || kept.some((b) => pointInRing(x, y, b.ring)) || parkedSpots.some((c) => Math.hypot(c.at[0] - x, c.at[1] - y) < 3);
    },
    utilities.lights,
  );
  // Busselton fork: lamp posts along the jetty, lit at night.
  const jettyLamps = piers.length ? jettyLights(piers, buildingGround, sea) : { nodes: [], lights: [] };
  // Signs and street furniture; their artwork is drawn in one atlas.
  const art = new ArtList();
  // Race day: barriers, fences, banners, gantries, a grandstand and crowds where the road is the race.
  const race = opts.raceDress ? raceDressing(plan, opts, art, {
    ground,
    blocked: (x, y) => {
      const n = index.nearest(x, y, 30);
      return (!!n && n.dist < index.at(n).width / 2 + 0.2) || streetIndex.clearance(x, y) < 0.8 || kept.some((b) => pointInRing(x, y, b.ring));
    },
  }, opts.sponsors) : null;
  if (race) {
    const plainLight = { ambient: 0.45, diffuse: 0.45, specular: 0.05, exp: 10 };
    addScenery("race_concrete.png", barrierConcreteTexture(), material("race_concrete", "race_concrete.png", plainLight));
    addScenery("race_tyres.png", tyreWallTexture(), material("race_tyres", "race_tyres.png", { ambient: 0.4, diffuse: 0.4, specular: 0.1, exp: 15 }));
    addScenery("marshal.png", solidTexture([236, 110, 24]), material("marshal", "marshal.png", plainLight));
    const cutout = (name: string, png: Uint8Array, light = { ambient: 0.5, diffuse: 0.4, specular: 0.05, exp: 10 }) =>
      addScenery(`${name}.png`, png, { ...material(name, `${name}.png`, light), shader: "ksPerPixelAT", alphaTested: true });
    cutout("race_fence", catchFenceTexture(), { ambient: 0.45, diffuse: 0.45, specular: 0.3, exp: 30 });
    cutout("race_crowd", crowdTexture(false));
    cutout("race_spectators", crowdTexture(true));
  }
  const pieces = [
    ...(opts.streetSigns ? streetSigns(streetPlan, plan, opts, art) : []),
    ...(opts.landmarks ? landmarks((sources.pois ?? []).map((p) => ({ ...p, at: proj.toLocal(p.at) })), plan, index, opts, art,
      (x, y) => Math.min(streetIndex.clearance(x, y), ...kept.map((b) => (pointInside(x, y, b.ring) ? -1 : Infinity)))) : []),
    ...seenFeatures((sources.seen ?? []).map((f) => ({ ...f, at: proj.toLocal(f.at) })), plan, index, opts, art),
    // The race gantries replace the plain START and FINISH signs.
    ...(race ? race.pieces : gateSigns(plan, opts, art)),
    // Busselton fork: kangaroo signs out of town (not on kerbed streets, limit 80 or more).
    ...(opts.streetSigns ? kangarooSigns(plan, opts, art, (i) => town[i] === 0 && speedAt(i) >= 80 && !kerbedNear[i],
      (i, side) => mouth(side, plan.samples[i].s) || streetPlan.junctions.some((j) => j.side === side && Math.abs(j.s - plan.samples[i].s) < j.width / 2 + 6)) : []),
    ...utilities.pieces,
    ...carPark.pieces,
    ...(verge ? letterboxes(plan, verge, vergeGround) : []),
  ];
  let atlas = null;
  if (sources.renderArt && art.list.length) {
    atlas = await sources.renderArt(art.list);
    textures.push({ name: "signart.png", data: atlas.data });
    materials.push({ ...material("signart", "signart.png", { ambient: 0.55, diffuse: 0.45, specular: 0.15, exp: 20 }), shader: "ksPerPixelAT", alphaTested: true });
  }
  const furniture = buildPieces(pieces, atlas);
  // Houses: the wall facing the street (frontage houses know theirs; for the
  // rest it's the wall nearest a road), then the fences and garden that go with it.
  const roadGap = (x: number, y: number) => {
    const n = index.nearest(x, y, 40);
    return Math.min(n ? n.dist - index.at(n).width / 2 : Infinity, streetIndex.clearance(x, y));
  };
  const shown = opts.horizon > 0 ? kept : kept.filter((b) => b.ring.every(([x, y]) => inCover(x, y, 1)));
  const homes = shown.filter((b) => b.ring.length === 4 && b.roof !== "flat" && b.height <= 7.5);
  if (opts.houseStyle) {
    // The area's own mix of facades (upstream's, by name), the same for a house every build.
    for (const b of homes) {
      if (b.type !== "house") continue;
      const f = facadeForStyle(opts.houseStyle.facades, centroid(b.ring));
      if (f !== undefined) b.facade = f;
    }
  }
  for (const b of homes) {
    if (b.front) continue;
    let best = -1, bestGap = 25;
    for (let k = 0; k < 4; k++) {
      const p = b.ring[k], q = b.ring[(k + 1) % 4];
      const g = roadGap((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      if (g < bestGap) [best, bestGap] = [k, g];
    }
    if (best >= 0) {
      b.front = [b.ring[best], b.ring[(best + 1) % 4]];
      b.setback = bestGap;
    }
  }
  // Street photos say what the wall is made of.
  const frontMid = (b: Building) => b.front ? [(b.front[0][0] + b.front[1][0]) / 2, (b.front[0][1] + b.front[1][1]) / 2] : null;
  let housesLooked = 0;
  const houseTrees: TreeSpot[] = [];
  const specNodes: Kn5MeshNode[] = [];
  for (const [k, look] of (sources.houseLooks ?? []).entries()) {
    const [x, y] = proj.toLocal(look.at);
    // Busselton fork: a house we have a spec for is built from it, facing its street, and the
    // generated house (and anything placed) there goes.
    if (cleared(x, y)) continue; // a hand-made layer stands here
    if (look.spec && Number.isFinite(roadGap(x, y))) {
      const gx = roadGap(x + 1, y) - roadGap(x - 1, y), gy = roadGap(x, y + 1) - roadGap(x, y - 1);
      const gl = Math.hypot(gx, gy) || 1;
      const sh = buildSpecHouse(look.spec, { centre: [x, y], toRoad: [-gx / gl, -gy / gl], z: buildingGround(x, y) + 0.05 }, String(k));
      const inside = (b: Building) => {
        const c = centroid(b.ring);
        return sh.footprints.some((f) => pointInRing(c[0], c[1], f)) || b.ring.some(([px, py]) => sh.footprints.some((f) => pointInRing(px, py, f)));
      };
      for (const list of [shown, homes]) for (let i = list.length - 1; i >= 0; i--) if (inside(list[i])) list.splice(i, 1);
      for (const fc of sh.facades) buildingScenery(`facade_${fc.name}`, facadeTexture(fc), { ambient: 0.45, diffuse: 0.45, specular: 0.05, exp: 10 }, 3);
      if (!finishes.roofs.has(sh.roof)) {
        finishes.roofs.add(sh.roof);
        const c = ROOF_COLOURS[sh.roof];
        buildingScenery(`roof_${c.name}`, roofTexture(c), { ambient: 0.45, diffuse: 0.45, specular: 0.25, exp: 25 }, 4);
      }
      for (const so of sh.solids) addScenery(`${so.name}.png`, solidTexture(so.rgb), material(so.name, `${so.name}.png`, { ambient: 0.45, diffuse: 0.45, specular: 0.1, exp: 10 }));
      specNodes.push(...sh.nodes);
      houseTrees.push(...sh.trees);
      housesLooked++;
      continue;
    }
    let best: Building | null = null, bestD = 8;
    for (const b of homes) {
      const m = frontMid(b);
      const d = m ? Math.hypot(m[0] - x, m[1] - y) : Infinity;
      if (d < bestD) [best, bestD] = [b, d];
    }
    // A house whose street wall wasn't worked out: matched by being inside it (or its middle near).
    if (!best) {
      best = homes.find((b) => pointInRing(x, y, b.ring)) ?? null;
      if (!best) {
        let bd = 6;
        for (const b of homes) {
          const c = centroid(b.ring), d = Math.hypot(c[0] - x, c[1] - y);
          if (d < bd) [best, bd] = [b, d];
        }
      }
      // Its street wall: the long-enough edge nearest a road.
      if (best && !best.front) {
        const ring = best.ring;
        let bi = -1, bg = Infinity;
        for (let k = 0; k < ring.length; k++) {
          const p = ring[k], q = ring[(k + 1) % ring.length];
          if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 4) continue;
          const g = roadGap((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
          if (g < bg) [bi, bg] = [k, g];
        }
        if (bi >= 0) best.front = [ring[bi], ring[(bi + 1) % ring.length]];
      }
    }
    // Still nothing there and the look says a house stands here: build one, 15 m across the front
    // and 13 m deep, its front wall facing the nearest road.
    if (!best && look.place && Number.isFinite(roadGap(x, y))) {
      const gx = roadGap(x + 1, y) - roadGap(x - 1, y), gy = roadGap(x, y + 1) - roadGap(x, y - 1);
      const gl = Math.hypot(gx, gy) || 1;
      const o: Vec2 = [-gx / gl, -gy / gl]; // towards the road
      const t: Vec2 = [-o[1], o[0]];
      const at = (a: number, d: number): Vec2 => [x + t[0] * a + o[0] * d, y + t[1] * a + o[1] * d];
      // Counter-clockwise from above, the front edge (facing the road) first.
      const ring = [at(-7.5, 6.5), at(7.5, 6.5), at(7.5, -6.5), at(-7.5, -6.5)].reverse();
      const front: [Vec2, Vec2] = [at(7.5, 6.5), at(-7.5, 6.5)];
      const surfmist = Math.max(0, ROOF_COLOURS.findIndex((r) => r.name === "surfmist"));
      const placed: Building = { ...plainHouse(houseRoof(() => 0.3), surfmist, 3), ring, source: "detected", front, setback: Math.max(2, roadGap(...front[0]) ) };
      shown.push(placed);
      homes.push(placed);
      best = placed;
      if (!finishes.roofs.has(surfmist)) {
        finishes.roofs.add(surfmist);
        const c = ROOF_COLOURS[surfmist];
        buildingScenery(`roof_${c.name}`, roofTexture(c), { ambient: 0.45, diffuse: 0.45, specular: 0.25, exp: 25 }, 4);
      }
    }
    if (!best) continue;
    // The facade of the look's wall kind nearest its colour (upstream's facades are a kind in a colour).
    const f = look.facade || look.colour ? facadeForLook(look.facade, look.colour, best.facade) : undefined;
    if (f !== undefined) best.facade = f;
    if (look.front) best.frontKind = look.front;
    if (look.hedgeHeight) best.hedgeHeight = look.hedgeHeight;
    if (look.trees && best.front) {
      // Spread across the front yard, halfway between the wall and the road.
      const [a, c] = best.front, m = frontMid(best)!;
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      let o: Vec2 = [(c[1] - a[1]) / L, -(c[0] - a[0]) / L];
      if (roadGap(m[0] + o[0] * 3, m[1] + o[1] * 3) > roadGap(m[0] - o[0] * 3, m[1] - o[1] * 3)) o = [-o[0], -o[1]];
      const out = Math.max(2, (best.setback ?? roadGap(m[0], m[1])) / 2);
      for (let k = 0; k < look.trees; k++) {
        const t = (k + 0.5) / look.trees - 0.5;
        houseTrees.push({ x: m[0] + o[0] * out + (c[0] - a[0]) * t * 0.6, y: m[1] + o[1] * out + (c[1] - a[1]) * t * 0.6, scale: 0.85, variant: 0 });
      }
    }
    if (f !== undefined || look.front || look.trees) housesLooked++;
  }
  // Facades the area style and the looks switched houses to, that nothing else wears.
  for (const b of homes) {
    if (!finishes.facades.has(b.facade)) {
      finishes.facades.add(b.facade);
      facadeScenery(b.facade);
    }
  }
  // Shops: verandahs over the footpath, a fascia sign and shop windows on the street side.
  const homeSet = new Set(homes);
  const shopfronts = opts.buildings ? findShopfronts(
    shown, (sources.pois ?? []).map((p) => ({ ...p, at: proj.toLocal(p.at) })), roadGap, buildingGround, (b) => homeSet.has(b),
  ) : [];
  const shopMeshes = buildShopfronts(shopfronts);
  if (shopMeshes.length) {
    textures.push({ name: "shop_sign.png", data: shopSignTexture(shopfronts, sources.drawSigns) }, { name: "shop_window.png", data: shopWindowTexture() });
    materials.push(
      material("shop_sign", "shop_sign.png", { ambient: 0.5, diffuse: 0.45, specular: 0.1, exp: 15 }),
      material("shop_window", "shop_window.png", { ambient: 0.4, diffuse: 0.3, specular: 0.6, exp: 60 }),
      material("verandah", "verandah.png", { ambient: 0.45, diffuse: 0.45, specular: 0.2, exp: 20 }),
    );
    textures.push({ name: "verandah.png", data: roofTexture(ROOF_COLOURS[1]) });
  }
  // Parked cars back where the photo had them: off the route's road and the side streets it builds,
  // away from street centrelines (cars there were driving), not in a building.
  const streetCentres = new LineIndex(streetLines.map((pts) => ({ pts, width: 0 })));
  let parked = parkedSpots.filter(({ at: [x, y] }) => {
    // On the detailed ground only (the horizon mesh sits at another height).
    const n = index.nearest(x, y, opts.corridor - 5);
    if (!inCover(x, y, 5) || (n && n.dist < index.at(n).width / 2 + 0.5)) return false;
    if (streetCentres.clearance(x, y) < 2.4) return false;
    // Inside a side street the track builds (and runs traffic on).
    if (streetIndex.clearance(x, y) < -0.3) return false;
    // Not on a roundabout or its island (a car the photo caught going round isn't parked).
    if (plan.roundabouts.some((rb) => Math.hypot(x - rb.c[0], y - rb.c[1]) < outerRadius(rb) + 2.5)) return false;
    return !shown.some((b) => pointInRing(x, y, b.ring));
  });
  // Nothing generated where a hand-made layer stands.
  if (clears.length) {
    for (const list of [shown, homes]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const c = centroid(list[i].ring);
        if (cleared(c[0], c[1])) list.splice(i, 1);
      }
    }
    for (let i = houseTrees.length - 1; i >= 0; i--) if (cleared(houseTrees[i].x, houseTrees[i].y, true)) houseTrees.splice(i, 1);
  }
  const houses = buildBuildings(shown, buildingGround);
  // Car park islands, clear of the road, the streets, buildings and the rings, with shrubs.
  const islandNodes: Kn5MeshNode[] = [];
  const islandShrubs = new MeshBuilder();
  islandShrubs.normals = [];
  const shrubRand = rng(515);
  let islandCount = 0;
  for (const { chunk, rings } of islandsFound) {
    const ok = rings.filter((ring) => ring.every(([x, y]) => {
      const n = index.nearest(x, y, 40);
      if (n && n.dist < index.at(n).width / 2 + 2) return false;
      if (streetIndex.clearance(x, y) < 0.5 || inRoundabout(plan, x, y, 3)) return false;
      return !kept.some((b) => pointInRing(x, y, b.ring));
    }));
    if (!ok.length) continue;
    islandCount += ok.length;
    islandNodes.push(...buildIslands(ok, ground, chunk, `terrain_${chunk.key}`, chunk.key));
    for (const ring of ok) {
      // A shrub every 2-3 m^2 or so, inside the island, standing on its raised top.
      const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
      const top = Math.max(...ring.map(([x, y]) => ground(x, y))) + 0.15;
      for (let x = Math.min(...xs) + 0.8; x < Math.max(...xs) - 0.8; x += 1.8) {
        for (let y = Math.min(...ys) + 0.8; y < Math.max(...ys) - 0.8; y += 1.8) {
          const px = x + (shrubRand() - 0.5) * 0.8, py = y + (shrubRand() - 0.5) * 0.8;
          if (!pointInRing(px, py, ring) || shrubRand() < 0.35 || islandShrubs.vertexCount > 60000) continue;
          shrub(islandShrubs, [px, py], 0.6 + shrubRand() * 0.6, shrubRand() < 0.5 ? 0 : 1, shrubRand() * Math.PI, () => top);
        }
      }
    }
  }
  if (islandShrubs.indices.length) islandNodes.push(islandShrubs.toKn5("ISLAND_SHRUBS", "shrubs", { castShadows: true }));
  const lots = opts.buildings ? buildLots(homes.filter((b) => b.ring.every(([x, y]) => inCover(x, y, 1))), buildingGround, { roadGap }) : [];

  const group = (name: string, children: Kn5Node[]): Kn5GroupNode => ({ kind: "node", name, transform: IDENTITY, children });
  // Last check: no kerb, strip, gutter or rail triangle stands on the route's asphalt.
  const onRoad = onRoute(plan, index);
  const meshesOf = (nodes: Kn5Node[]) => nodes.filter((n): n is Kn5MeshNode => n.kind === "mesh");
  const kerbsClear = keepOffRoute([...kerbMeshes.gutter, ...kerbMeshes.kerb, ...kerbMeshes.strip, ...kerbReturns, ...vergeConcrete], onRoad);
  const ringsClear = keepOffRoute(meshesOf(ringNodes), onRoad);
  const railsClear = keepOffRoute(rails.rails, onRoad);
  const slug = slugify(opts.name);
  const model: Kn5Model = {
    textures,
    materials,
    // Wide meshes split into tiles and small detail given a draw distance, so the game can skip what's out of sight.
    root: group(slug, [
      ...cullable([
        group("ROAD", roadMeshes.road),
        group("SIDESTREETS", sideStreets),
        group("FURNITURE", furniture),
        group("RACE", race?.nodes ?? []),
        group("WIRES", utilities.wires),
        group("ROUNDABOUTS", [...ringsClear.nodes, ...shrubs, ...ringWalls]),
        group("MARKINGS", markings),
        group("VERGE", roadMeshes.verge),
        group("KERBS", kerbsClear.nodes),
        group("TREES", [...trees, ...(houseTrees.length ? buildTrees(houseTrees, ground, "HOUSETREES") : [])]),
        group("RAILS", [...railsClear.nodes, ...rails.posts]),
        group("GUIDEPOSTS", posts),
        group("BUILDINGS", [...houses, ...specNodes]),
        group("SHOPS", shopMeshes),
        group("FENCES", keepOffRoute(barriers, onRoad).nodes),
        group("PATHS", pathMeshes),
        group("LOTS", keepOffRoute(lots, onRoad).nodes),
        group("CARPARKS", islandNodes),
        group("JETTY", piers.length ? [...buildPiers(piers, buildingGround, sea), ...jettyLamps.nodes] : []),
        group("SEAWALL", ocean.length ? [
          ...buildSeawall(beaches, buildingGround, sea, (x, y) => !!index.nearest(x, y, 250), piers),
          ...buildGroynes((sources.osm?.groynes ?? []).map((l) => l.map((p) => proj.toLocal(p))), buildingGround),
        ] : []),
      ]),
      // Already in compact chunks (terrain, horizon), or never drawn (walls).
      group("TERRAIN", terrainNodes),
      group("HORIZON", [...backdropNodes, ...horizonTrees]),
      group("SEA", ocean.length ? buildSea(ocean) : []),
      group("WALLS", [...walls, ...trunks, ...(houseTrees.length ? treeTrunks(houseTrees, ground) : [])]),
      // Busselton fork: a layout's dummies go in their own kn5 (layouts.ts).
      ...(opts.layout ? [] : trackObjects(plan, opts)),
    ]),
  };

  // Traffic for CSP's traffic planner, on the roads the track has: the route
  // (split where it changes between two and four lanes) and the side streets.
  let trafficInput: { roads: TrafficRoad[]; roundabouts: { c: Vec2; h: number; rIn: number; rOut: number }[] } | undefined;
  const trafficData = () => {
    const routeRoads: TrafficRoad[] = [];
    const wide = plan.samples.map((smp) => smp.width >= 12);
    // Smooth out short changes, under 60 m.
    const span = Math.round(30 / opts.spacing);
    const wideAt = (i: number) => {
      let n = 0, m = 0;
      for (let k = -span; k <= span; k++) {
        const j = plan.closed ? (i + k + nS) % nS : i + k;
        if (j < 0 || j >= nS) continue;
        m++;
        if (wide[j]) n++;
      }
      return n * 2 > m;
    };
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const ws = run.map((i) => plan.samples[i].width).sort((a, b) => a - b);
        const speeds = run.map(speedAt).sort((a, b) => a - b);
        routeRoads.push({
          pts: run.map((i) => plan.samples[i].pos), h: run.map((i) => plan.samples[i].h),
          width: ws[ws.length >> 1], speed: speeds[speeds.length >> 1],
        });
      }
    };
    for (let i = 0; i < nS; i++) {
      if (run.length && wideAt(i) !== wideAt(run[run.length - 1])) {
        flush();
        run = [run[run.length - 1]];
      }
      run.push(i);
    }
    flush();
    if (plan.closed && routeRoads.length === 1) routeRoads[0].closed = true;
    else if (plan.closed && routeRoads.length > 1) {
      // The last run carries on into the first.
      const last = routeRoads.pop()!, first = routeRoads[0];
      routeRoads[0] = { ...first, pts: [...last.pts, ...first.pts.slice(1)], h: [...last.h, ...first.h.slice(1)] };
    }
    const streetRoads: TrafficRoad[] = streetPlan.streets.map((st) => ({
      pts: st.pts, h: st.pts.map(([x, y]) => terrainAt(x, y).h + 0.1), width: st.width, speed: 50,
      ...(st.oneway ? { oneway: st.oneway } : {}),
    }));
    const rbs = plan.roundabouts.map((rb) => ({ c: rb.c, h: rb.hc, rIn: innerRadius(rb), rOut: outerRadius(rb) }));
    // Kept for checking the traffic graph offline (the headless build writes it out).
    trafficInput = { roads: [...routeRoads, ...streetRoads], roundabouts: rbs };
    return trafficJson([...routeRoads, ...streetRoads], rbs);
  };

  const trafficText = opts.traffic ? trafficData() : "";
  if (trafficText && parked.length) {
    // No parked car within 1.8 m of a traffic lane (AC space: x, z = -north).
    const lanePts = new LineIndex((JSON.parse(trafficText).lanes as { points: [number, number, number][] }[])
      .map((l) => ({ pts: l.points.map((p) => [p[0], -p[2]] as Vec2), width: 0 })));
    parked = parked.filter(({ at: [x, y] }) => lanePts.clearance(x, y) > 1.8);
  }
  // Added to the scene now the traffic lanes are known (none sits in a lane): the cars culled with
  // the other detail, their collision boxes with the walls.
  if (parked.length) {
    // On the terrain as drawn (the higher of its two triangle readings), not the smooth height under it.
    const parkedMeshes = buildParkedCars(parked, (x, y) => Math.max(ground(x, y), onMesh(x, y)));
    model.root.children.push(
      ...cullable([group("PARKED_CARS", parkedMeshes.filter((m) => !m.name.startsWith("1WALL")))]),
      group("PARKED_CAR_WALLS", parkedMeshes.filter((m) => m.name.startsWith("1WALL"))),
    );
    textures.push({ name: "parked_car.png", data: carTexture() });
    materials.push(material("parked_car", "parked_car.png", { ambient: 0.45, diffuse: 0.55, specular: 0.5, exp: 40 }));
  }

  await progress("Writing track files");
  const kn5 = writeKn5(model);
  const aiPoints = buildAiLine(plan);
  const ai = writeFastLaneAi(aiPoints);
  const outline2d = simplify(plan.samples.map((s) => s.pos), 0.5).map(([x, y]) => [x, -y] as [number, number]);
  if (plan.closed) outline2d.push(outline2d[0]);
  const map = trackMap(outline2d);
  const meanWidth = plan.samples.reduce((a, s) => a + s.width, 0) / plan.samples.length;
  const cameras = placeCameras(plan, opts, (x, y) => terrainAt(x, y).h, (x, y) => kept.some((b) => pointInRing(x, y, b.ring)));
  const trackMeta: TrackMeta = { name: opts.name, ...meta };
  const files: Record<string, Uint8Array> = {
    [`${slug}/${slug}.kn5`]: kn5,
    [`${slug}/ai/fast_lane.ai`]: ai,
    [`${slug}/data/ai_hints.ini`]: enc.encode(aiHintsIni(aiPoints, (d) => {
      const last = aiPoints[aiPoints.length - 1], total = last.distance + last.length;
      return speedAt(Math.min(nS - 1, Math.max(0, Math.round((d / total) * (nS - 1)))));
    }, !plan.closed)),
    [`${slug}/data/surfaces.ini`]: enc.encode(surfacesIni(opts.traffic, opts.streetsValid ?? !!opts.area)),
    ...(opts.traffic ? { [`${slug}/data/traffic.json`]: enc.encode(trafficText) } : {}),
    [`${slug}/data/map.ini`]: enc.encode(map.ini),
    // Busselton fork: checkpoints for the Busselton Challenges app (apps/lua/BusseltonChallenges).
    [`${slug}/data/challenges.ini`]: enc.encode(challengesIni(opts.name, challengeCheckpoints(plan,
      (x, y, r) => index.nearest(x, y, r),
      (sources.pois ?? []).map((p) => ({ ...p, at: proj.toLocal(p.at) })), streetPlan.routeNames, 6, streetPlan.junctions))),
    [`${slug}/data/cameras_1.ini`]: enc.encode(camerasIni(cameras)),
    // The automatic test run (scripts/windows/run-test.ps1): a track script that only wakes up for a
    // driver named "Busselton Test". Track scripts need the scripting physics traffic turns on.
    ...(opts.traffic ? { [`${slug}/extension/autotest.lua`]: enc.encode(autotestLua
      .replace("__CLOSED__", plan.closed ? "true" : "false")
      // The speed limit at each 1% of the lap, km/h, so the test drives at the limit.
      .replace("__LIMITS__", Array.from({ length: 100 }, (_, k) => speedAt(Math.min(nS - 1, Math.round(((k + 0.5) / 100) * (nS - 1))))).join(", "))) } : {}),
    [`${slug}/extension/ext_config.ini`]: enc.encode(extConfig([...utilities.lights, ...carPark.lights, ...jettyLamps.lights], {
      autotest: opts.traffic,
      // A town's glow at night where most of the route is built up.
      builtUp: town.filter((t) => t >= 1).length > town.length / 2,
      radiusKm: Math.max(...outline2d.map((p) => Math.hypot(p[0] - outline2d[0][0], p[1] - outline2d[0][1]))) / 2000,
    })),
    [`${slug}/map.png`]: map.png,
    [`${slug}/ui/ui_track.json`]: enc.encode(uiTrackJson(trackMeta, {
      length: timedLength(), width: meanWidth, pitboxes: opts.pitCount, closed: plan.closed, centre,
    })),
    [`${slug}/ui/outline.png`]: outlinePng(outline2d),
    [`${slug}/ui/preview.png`]: previewPng(outline2d, plan.closed),
    [`${slug}/README.txt`]: enc.encode(readme(trackMeta, textured.size ? (typeof sources.imageryCredit === "function" ? sources.imageryCredit() : sources.imageryCredit) ?? "aerial imagery" : null)),
  };

  // Busselton fork: one layout of several on the map (layouts.ts).
  const laid = opts.layout ? asLayout(files, slug, opts.layout, dummiesKn5(opts.layout, trackObjects(plan, opts))) : files;

  const hs = plan.samples.map((s) => s.h);
  let climb = 0;
  for (let i = 1; i < hs.length; i++) climb += Math.max(0, hs[i] - hs[i - 1]);
  const geo = countGeometry(model.root);
  await progress("Done", 1);
  return {
    slug, files: laid, model, plan, proj, previewTextures,
    parked: parked.map((c) => ({ at: c.at, dir: c.dir })),
    trafficInput,
    houses: homes.filter((b) => b.front).map((b) => ({
      front: [proj.toLngLat(b.front![0]), proj.toLngLat(b.front![1])] as [LngLat, LngLat],
      height: b.height,
      facade: FACADES[b.facade].name,
      source: b.source,
      ring: b.ring.map((v) => proj.toLngLat(v)),
      roof: b.roof,
      pitch: b.pitch,
      roofRgb: ROOF_COLOURS[b.roofColour]?.rgb,
    })),
    junctions: streetPlan.junctions.map((j) => ({ s: j.s, side: j.side })),
    stats: {
      length: plan.length,
      timedLength: timedLength(),
      closed: plan.closed,
      minElevation: Math.min(...hs),
      maxElevation: Math.max(...hs),
      climb,
      meanWidth,
      vertices: geo.v,
      triangles: geo.t,
      terrainChunks: terrainNodes.length,
      kn5Bytes: kn5.length,
      trees: trees.reduce((n, m) => n + (m.kind === "mesh" ? m.positions.length / 3 / 24 : 0), 0),
      buildings: kept.length,
      buildingsDetected: kept.filter((b) => b.source !== "osm").length,
      traced: trace?.coverage ?? 0,
      photoLines: imageLines.length,
      photoChunks: materials.filter((m) => m.name.startsWith("road_photo_")).length,
      sideStreets: streetPlan.streets.length,
      sideTraced,
      kerbMetres: (kerbs[0].reduce((a, b) => a + b, 0) + kerbs[1].reduce((a, b) => a + b, 0)) * opts.spacing,
      poles: utilities.poles,
      carsPainted,
      parkedCars: parked.length,
      housesLooked,
      shops: shopStats(shopfronts).shops,
      verandahs: shopStats(shopfronts).verandahs,
      shopNames: shopStats(shopfronts).named,
      carParkIslands: islandCount,
      footpathMetres: verge ? (verge.paths[0].filter(Boolean).length + verge.paths[1].filter(Boolean).length) * opts.spacing : 0,
      driveways: verge?.drives.length ?? 0,
      streetLights: utilities.lights.length,
      carParkLights: carPark.lights.length / 2,
      race: race?.stats ?? null,
      streetSigns: pieces.filter((p) => p.kind === "blade").length,
      signs: pieces.filter((p) => p.kind === "face").length,
      railMetres: needs.reduce((n, side) => n + side.filter(Boolean).length * opts.spacing, 0),
    },
  };
}

function pointInside(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
