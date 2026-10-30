// Custom Shaders Patch config: extension/ext_config.ini in the track folder,
// where CSP looks for a track's own config. Without CSP the file is ignored.
//
// - Night lighting: every street light becomes a real light pointing down
//   from its lantern; the lanterns glow (Material_DistantEmissive, CSP's
//   shader for the bright bits of lamp posts, which stops them flickering at
//   a distance); house windows show lit rooms behind them
//   (Material_RoomWindows). All switched on by a smooth night condition (the
//   sun more than 88 degrees from overhead, as CSP's own configs define it).
// - Light pollution: the glow of a built-up area over the skyline at night.
// - Grass FX: real 3D grass blades close to the camera on the grassy parts
//   of the aerial photo; its colour mask widened for dry Australian grass,
//   and kept short and tidy like suburban lawns. Road, concrete and paint
//   occlude it so nothing grows through the asphalt.
// - Rain FX: puddles and soaked asphalt on the roads, darker concrete,
//   grass that darkens without turning glossy (needed with Grass FX), glass
//   that takes drops, and line paint marked for the physics (slippery wet).
// - Shadows: thin two-sided things (fences, signs, tree sprites) cast them
//   without acne.
// - Busselton fork: flags wave in the wind (flags.ts) and the jetty train
//   runs on its timetable (a track script, jettyTrain.ts).
//
// Syntax follows CSP's documentation (acc-extension-config wiki: Tracks -
// Lights, Conditions, Grass FX, RainFX) and its shipped configs for Kunos
// tracks, and the templates in common/materials_track.ini.

import type { Vec3 } from "./mesh";
import type { Hollow } from "./rainHollows";
import { soundConfig, soundScriptConfig, type SoundEmitter, type SoundMode } from "./trackSounds";
import { pureSections, type AtmosphereInput } from "./pureConfig";
import { flagCspLines } from "./flags";
import { jettyTrainConfig } from "./jettyTrain";

const f = (v: number) => v.toFixed(2);

export interface CspOptions {
  /** Built up enough for a glow over the skyline at night. */
  builtUp?: boolean;
  /** Half the track's extent, km: how far the glow reaches. */
  radiusKm?: number;
  /** Load extension/autotest.lua as a track script. */
  autotest?: boolean;
  /**
   * Busselton fork: a Mediterranean climate with a dry summer (south-west WA): grass and verges go
   * straw from December to April and green from June to September (CSP's seasonAutumn, by date).
   */
  drySummer?: boolean;
  /** Busselton fork: there's sea in the track (Material_Water and light bounced off it). */
  sea?: boolean;
  /** Busselton fork: the bay's photo lies under the water (photoSea.ts): the water surface is partly clear. */
  photoSea?: boolean;
  /** Busselton fork: CSP instanced trees: the tree list's path under extension/ (e.g. trees/trees.txt). */
  trees?: string;
  /** Busselton fork: there are vine rows (farm.ts, material vine_leaf): gold from autumn through winter. */
  vines?: boolean;
  /**
   * Busselton fork: where rain pools on the road (rainHollows.ts). Set (even empty) to build CSP's
   * puddle height map from the ground and roads only, and list the hollows for checking in game.
   */
  hollows?: Hollow[];
  /** Busselton fork: track sound emitters (trackSounds.ts). */
  sounds?: SoundEmitter[];
  /** How they play: "fmod" from a soundbank ([SOUNDBANK]/[EVENT]), otherwise the sounds.lua track script. */
  soundMode?: SoundMode;
  /** Busselton fork: Pure tuning from the build (pureConfig.ts); without it, CSP's generic [PURE] values. */
  pure?: AtmosphereInput;
  /** Busselton fork: flags (ksFlags meshes) wave in CSP's wind (flags.ts). */
  flags?: boolean;
  /** Busselton fork: load extension/jetty_train.lua, which runs the jetty train (jettyTrain.ts). */
  jettyTrain?: boolean;
}

/**
 * Busselton fork: keys added to [Material_Water] when the bay's photo lies under the water (photoSea.ts).
 * The surface's alpha (txDiffuse's) lets the photo layer through, and DepthAware refracts it and lays
 * caustics on it, which needs that alpha and a transparent mesh: CSP's [TEMPLATE: Material_Water] in
 * common/materials_track.ini, and its shipped ks_laguna_seca.ini, which sets exactly these four.
 */
export function photoSeaWaterLines(): string[] {
  return ["UseAlphaFromDiffuse = 1", "DepthAware = 1", "CausticsMultiplier = 1.0", "IS_TRANSPARENT = 1"];
}

/** Busselton fork: what CSP's RainFX height map is built from: the ground and roads, not buildings or trees. */
export const RELIEF_MATERIALS = "road_?, side_photo_?, concrete, paint?, path_?, terrain_?, strip_photo_?, sidestrips_photo, returns_photo, rbphoto_?, grass, verge";

/**
 * Busselton fork: lines added to [RAIN_FX] for the hollows. CSP places puddles itself, more of them
 * in the local minima of a height map of the track (wiki, Tracks - RainFX); RELIEF_MATERIALS says
 * what goes into that map, so houses and trees don't make false hollows beside them. The wiki calls
 * the key broken, but CSP's own configs for ks_brands_hatch and nevadadrift set it to ground
 * materials the same way. The hollows themselves are comments: x, y, z in AC space for the F7
 * camera and the Objects Inspector.
 */
export function hollowLines(hollows: Hollow[]): string[] {
  return [
    `RELIEF_MATERIALS = ${RELIEF_MATERIALS}`,
    `; Hollows where water should stand in the rain (rainHollows.ts): ${hollows.length}. Lowest point x, y, z; depth; area.`,
    ...hollows.map((h, i) => `; hollow ${i + 1}: ${f(h.low[0])}, ${f(h.low[1])}, ${f(h.low[2])}  ${Math.round(h.depth * 100)} cm, ${Math.round(h.area)} m2, ${Math.round(h.radius * 2)} m across`),
  ];
}

/** `lights` are lamp heads in local metres (x east, y north, z up). */
export function extConfig(lights: Vec3[], opts: CspOptions = {}): string {
  const lines = [
    "; Generated by AC Track Builder. Read by Custom Shaders Patch; ignored without it.",
    "",
    "[INCLUDE]",
    "INCLUDE = common/materials_track.ini",
    "",
    "[CONDITION_0]",
    "NAME = NIGHT_SMOOTH",
    "INPUT = SUN",
    "LUT = (|0=0|88=0|88=1|180=1)",
    "LAG = 0.97",
    "",
    "[GRASS_FX]",
    "GRASS_MATERIALS = terrain_?, strip_photo_?, sidestrips_photo, returns_photo, rbphoto_?, grass, verge",
    "OCCLUDING_MATERIALS = road_?, side_photo_?, concrete, paint?, rrpm, barrier_?, path_?, mulch, fence_?, frontwall_?, hedge, sea, jetty_?",
    "ORIGINAL_GRASS_MATERIALS =",
    // Busselton fork: WA verges are straw for half the year, so spawn on
    // yellow-green as well as green (MASK_RED_THRESHOLD shifts the target
    // toward yellow), on mid-bright pixels only: not white sand or roofs, not
    // dark shade or bitumen; rougher and less mown than a lawn.
    "MASK_MAIN_THRESHOLD = 0.12",
    "MASK_RED_THRESHOLD = 0.3",
    "MASK_MIN_LUMINANCE = 0.06",
    "MASK_MAX_LUMINANCE = 0.55",
    "MASK_BLUR = 2",
    "SHAPE_SIZE = 1.0",
    "SHAPE_TIDY = 0.35",
    "SHAPE_CUT = 0.35",
    "SHAPE_WIDTH = 1.0",
    "",
    "[RAIN_FX]",
    "PUDDLES_MATERIALS = road_?, side_photo_?",
    "SOAKING_MATERIALS = road_?, side_photo_?, concrete, path_?",
    "ROUGH_MATERIALS = terrain_?, backdrop_?, strip_photo_?, sidestrips_photo, returns_photo, rbphoto_?, grass, verge, trees, barrier_hedge, hedge, mulch, shrubs, frontwall_?, jetty_?",
    "SMOOTH_MATERIALS = window, glass, signart, steel, lamp",
    "LINES_MATERIALS = paint, paint_yellow",
    ...(opts.hollows ? hollowLines(opts.hollows) : []),
    "",
    // Thin two-sided geometry: fences, sign faces, tree sprites.
    "[SHADER_REPLACEMENT_0]",
    "MATERIALS = barrier_colorbond, barrier_paling, signart, trees, fence_?, shrubs, race_fence, race_crowd, race_spectators",
    "DOUBLE_FACE_SHADOW_BIASED = 1",
    "",
    "[Material_RoomWindows]",
    "Materials = window",
    "EmissiveMode = ONE",
    "SnapToTexCoords = 1",
    "TexCoordsSnapScale = 1.0",
    "RoomDepth = 4.0",
    "ShapeChance = 0.6",
    "NormalsFactor = 0.8",
    "",
    "[MATERIAL_ADJUSTMENT_1]",
    "ACTIVE = 1",
    "DESCRIPTION = Lit rooms behind house windows at night",
    "MATERIALS = window",
    "CONDITION = NIGHT_SMOOTH",
    "KEY_0 = ksEmissive",
    "VALUE_0 = 255, 190, 120, 0.008",
    "OFF_VALUE_0 = 0, 0, 0",
    "",
    // Busselton fork: shop fascia signs (with the real shop names) lit at night, and a warm glow
    // in the shop windows below them. Emissive is tinted by each texture, so signs keep their colours.
    "[MATERIAL_ADJUSTMENT_2]",
    "ACTIVE = 1",
    "DESCRIPTION = Shop signs lit at night",
    "MATERIALS = shop_sign",
    "CONDITION = NIGHT_SMOOTH",
    "KEY_0 = ksEmissive",
    "VALUE_0 = 255, 250, 240, 0.35",
    "OFF_VALUE_0 = 0, 0, 0",
    "",
    "[MATERIAL_ADJUSTMENT_3]",
    "ACTIVE = 1",
    "DESCRIPTION = Shop windows glow at night",
    "MATERIALS = shop_window",
    "CONDITION = NIGHT_SMOOTH",
    "KEY_0 = ksEmissive",
    "VALUE_0 = 255, 215, 165, 0.12",
    "OFF_VALUE_0 = 0, 0, 0",
    "",
  ];
  if (opts.builtUp) {
    lines.push(
      "[LIGHT_POLLUTION]",
      "RELATIVE_POSITION = 0.5, 0, 0.5",
      "DENSITY = 0.15",
      `RADIUS_KM = ${f(Math.max(0.8, opts.radiusKm ?? 1))}`,
      "COLOR = 1.0, 0.72, 0.45",
      "ACTIVE = 1",
      "",
    );
  }
  if (lights.length) {
    lines.push(
      "[LIGHT_SERIES_0]",
      "DESCRIPTION = Street lights",
      "CONDITION = NIGHT_SMOOTH",
      // Neutral white LED street lighting, pointing down, lighting the road and footpath.
      "COLOR = 255, 236, 210, 0.06",
      "SPOT = 140",
      "SPOT_SHARPNESS = 0.3",
      "RANGE = 30",
      "RANGE_GRADIENT_OFFSET = 0.1",
      "DIFFUSE_CONCENTRATION = 0.7",
      "FADE_AT = 450",
      "FADE_SMOOTH = 60",
      // AC space: x east, y up, z south.
      ...lights.map(([x, y, z], i) => `POSITION_${i} = ${f(x)}, ${f(z)}, ${f(-y)}`),
      "",
      "[Material_DistantEmissive]",
      "Materials = lamp",
      "",
      "[MATERIAL_ADJUSTMENT_0]",
      "ACTIVE = 1",
      "DESCRIPTION = Street light lanterns glow at night",
      "MATERIALS = lamp",
      "CONDITION = NIGHT_SMOOTH",
      "KEY_0 = ksEmissive",
      "VALUE_0 = 255, 236, 210, 0.4",
      "OFF_VALUE_0 = 0, 0, 0",
      "",
    );
  }
  // Busselton fork: from the CSP research (docs/csp.md). Cheap and visible on a sunny flat town.
  lines.push(
    // Wind: CSP sways trees and grass with it.
    "[BASIC]",
    "SUPPORTS_WIND = 1",
    "",
    // Sunlit road and footpaths bouncing light onto walls and verandahs (Extra FX, about 0.3 ms).
    "[BOUNCED_LIGHT]",
    "SUPPORTED = 1",
    "SURFACE_MATERIALS = road_?, concrete, path_?, terrain_?, paint?",
    `CAUSTICS = ${opts.sea ? 1 : 0}`,
    "",
    // CSP's tiling fix on the detail-mapped ground and roads (no visible repeat in the detail).
    "[SHADER_REPLACEMENT_1]",
    "MATERIALS = shader:ksMultilayer?, shader:ksPerPixelMultiMap?",
    "PROP_0 = ksAlphaRef, -193",
    "",
    // Pure: tuned to where the track is (pureConfig.ts), else the values CSP's own track configs use.
    ...(opts.pure ? pureSections(opts.pure) : [
      "[PURE]",
      "ACTIVE = 1",
      "SUN_DAWN = 1",
      "SUN_DUSK = 1",
      "FOG_LEVEL = 0.05",
      "FOG_BLEND = 1.15",
      "FOG_DISTANCE = 0.9",
      "SMOG_MORNING = 0.05",
      "SMOG_NOON = 0.1",
      "SMOG_EVENING = 0.15",
      "",
    ]),
  );
  if (opts.trees) {
    // CSP's instanced 3D trees (docs/trees.md). Every species here is evergreen: no seasonal tint.
    lines.push("[TREES]", `LIST_0 = ${opts.trees}`, "", "[LIGHTING]", "ENABLE_TREES_LIGHTING = 1", "");
  }
  if (opts.sea) lines.push("[Material_Water]", "Materials = sea", "Type = SEA", "UseRecommendedTextures = 1", ...(opts.photoSea ? photoSeaWaterLines() : []), "");
  if (opts.drySummer) {
    lines.push(
      // 1 (straw) from December to April, 0 (green) June to September, blending in May and October-November.
      "[CONDITION_1]",
      "NAME = DRY_SEASON",
      "INPUT = YEAR_DAY",
      "LUT = (|1=1|120=1|152=0|273=0|335=1|365=1|)",
      "LAG = 0",
      "",
      // seasonAutumn turns green toward straw, masked by greenness, so roads, sand and roofs stay put.
      // Trees and hedges stay green (WA natives don't brown off).
      "[MATERIAL_ADJUSTMENT_4]",
      "ACTIVE = 1",
      "DESCRIPTION = Grass and verges go straw in the dry season",
      "MATERIALS = terrain_?, strip_photo_?, sidestrips_photo, returns_photo, rbphoto_?, grass, verge, backdrop_?",
      "CONDITION = DRY_SEASON",
      "KEY_0 = seasonAutumn",
      "VALUE_0 = 0.8",
      "OFF_VALUE_0 = 0",
      "",
    );
  }
  if (opts.vines) {
    lines.push(
      // South West vines: green from budburst (October) to March, gold in April and May, and left
      // gold through the bare winter (a tint can't take the leaves off) until the new growth.
      "[CONDITION_2]",
      "NAME = VINE_AUTUMN",
      "INPUT = YEAR_DAY",
      "LUT = (|1=0|80=0|110=1|230=1|280=0|365=0|)",
      "LAG = 0",
      "",
      "[MATERIAL_ADJUSTMENT_5]",
      "ACTIVE = 1",
      "DESCRIPTION = Vine leaves turn gold in autumn",
      "MATERIALS = vine_leaf",
      "CONDITION = VINE_AUTUMN",
      "KEY_0 = seasonAutumn",
      "VALUE_0 = 1",
      "OFF_VALUE_0 = 0",
      "",
    );
  }
  if (opts.sounds?.length && opts.soundMode === "fmod") lines.push(...soundConfig(opts.sounds));
  if (opts.flags) lines.push(...flagCspLines());
  if (opts.autotest) lines.push("[SCRIPT_0]", "SCRIPT = autotest.lua", "");
  if (opts.sounds?.length && opts.soundMode !== "fmod") lines.push(...soundScriptConfig(opts.autotest ? 1 : 0));
  if (opts.jettyTrain) lines.push(...jettyTrainConfig());
  return lines.join("\r\n");
}

/**
 * Busselton fork: settings for CSP's vertex AO bakery (acc-bakeryoptix), read from the track folder
 * when it bakes a models_<layout>.ini (scripts/windows/bake-vao.ps1). Keys from the bakery's source;
 * see docs/csp.md.
 */
export function bakedShadowParams(quality: "test" | "final" = "final"): string {
  return [
    "; Generated by Busselton AC. Read by CSP's AO bakery (bakeryoptix.exe) when it bakes this track.",
    "[GENERAL]",
    "MODE = TRACK",
    "USE_VULKAN = 1",
    "",
    "[MODE_TRACK]",
    `RAYS_PER_SAMPLE = ${quality === "test" ? 32 : 96}`,
    "MIN_SAMPLES_PER_FACE = 4",
    "RAYS_OFFSET = 0.1",
    "BOUNCES = 5",
    "BASE_ALBEDO = 0.9",
    "USE_GROUND = 0",
    "BRIGHTNESS = 1.02",
    "GAMMA = 0.92",
    "OPACITY = 0.97",
    "BAKE_AS_TREES = material:trees, material:shrubs, material:hedge, material:barrier_hedge, shader:ksTree?",
    "BAKE_AS_GRASS = shader:ksGrass?",
    "TREES_LIGHT_PASS_CHANCE = 0.9",
    "TREES_SHADOW_FACTOR = 0.8",
    "EXCLUDE_FROM_BAKING = renderable:n, material:sea, material:sea_photo?, material:shore_foam, material:backdrop_?",
    "FORCE_PASSING_LIGHT = material:sea, material:glass, material:window, material:shop_window",
    "EXT_EXCLUDE_POBJECTS = 1",
    "EXT_REBAKE_DARK_OBJECTS = 1",
    "AO_SAMPLES_PHYSICS_SURFACES = 1",
    "EXT_PROCEDURAL_TREES_OCCLUDE = 0",
    "EXT_PROCEDURAL_TREES_BAKE = 0",
    "EXT_PROCEDURAL_TREES_FINALIZE = 0",
    "",
  ].join("\r\n");
}
