// The track's Custom Shaders Patch config (extension/ext_config.ini) and the settings for CSP's
// vertex AO bakery (baked_shadow_params.ini). Written from docs/specs/cspConfig.md.
//
// ext_config.ini is CRLF text, `KEY = value`, one empty line after each section. Numbered sections
// are owned as in the spec's registry; sections from other modules or layers that may repeat use
// CSP's auto-numbered `[NAME_...]` form. Layers append more sections after the file
// (scripts/headless/build-track.mjs), so it must stay valid with text added at the end.

import type { Vec3 } from "./mesh";
import type { Hollow } from "./rainHollows";
import { soundConfig, soundScriptConfig, type SoundEmitter } from "./trackSounds";
import { pureSections, type AtmosphereInput } from "./pureConfig";
import { flagCspLines } from "./flags";
import { jettyTrainConfig } from "./jettyTrain";

export interface CspOptions {
  /** A town glow over the skyline at night. */
  builtUp?: boolean;
  /** How far the glow reaches, km. */
  radiusKm?: number;
  /** Load extension/autotest.lua as a track script. */
  autotest?: boolean;
  /** South-west WA seasons: grass goes straw December to April. */
  drySummer?: boolean;
  /** There's sea in the track (`sea` material). */
  sea?: boolean;
  /** The bay's photo lies under the water; the surface is partly clear (photoSea.ts). */
  photoSea?: boolean;
  /** CSP instanced trees: the list's path under extension/ (e.g. trees/trees.txt). */
  trees?: string;
  /** Vine rows (`vine_leaf`) turn gold in autumn. */
  vines?: boolean;
  /** Rain hollows (rainHollows.ts). Present, even empty, switches on the relief map. */
  hollows?: Hollow[];
  /** Track sound emitters (trackSounds.ts). */
  sounds?: SoundEmitter[];
  /** How they play; anything but "fmod" means the Lua script. */
  soundMode?: "lua" | "fmod";
  /** Pure tuning from the build (pureConfig.ts); absent means the generic block. */
  pure?: AtmosphereInput;
  /** Flags wave in CSP's wind (flags.ts). */
  flags?: boolean;
  /** Load extension/jetty_train.lua (jettyTrain.ts). */
  jettyTrain?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Material lists. Other modules create these materials; renaming one there silently breaks an
// effect here, so every list is built from these few named groups. `?` is CSP's wildcard.

/** The photo ground: terrain and the photo strips beside the road. */
const GROUND_PHOTO = ["terrain_?", "strip_photo_?", "sidestrips_photo", "returns_photo", "rbphoto_?", "grass", "verge"];
/** The distant backdrop ring (rough in the rain, and straw in the dry season, but no grass). */
const BACKDROP = "backdrop_?";
/** The road and its photo sides, where puddles form. */
const ROAD_PHOTO = ["road_?", "side_photo_?"];

const GRASS_MATERIALS = GROUND_PHOTO;
const OCCLUDING_MATERIALS = [...ROAD_PHOTO, "concrete", "paint?", "rrpm", "barrier_?", "path_?", "mulch", "fence_?", "frontwall_?", "hedge", "sea", "jetty_?"];
const PUDDLES_MATERIALS = ROAD_PHOTO;
const SOAKING_MATERIALS = [...ROAD_PHOTO, "concrete", "path_?"];
const ROUGH_MATERIALS = [GROUND_PHOTO[0], BACKDROP, ...GROUND_PHOTO.slice(1), "trees", "barrier_hedge", "hedge", "mulch", "shrubs", "frontwall_?", "jetty_?"];
const SMOOTH_MATERIALS = ["window", "glass", "signart", "steel", "lamp"];
const LINES_MATERIALS = ["paint", "paint_yellow"];
const THIN_TWO_SIDED = ["barrier_colorbond", "barrier_paling", "signart", "trees", "fence_?", "shrubs", "race_fence", "race_crowd", "race_spectators"];
const BOUNCE_MATERIALS = ["road_?", "concrete", "path_?", "terrain_?", "paint?"];
const DRY_SEASON_MATERIALS = [...GROUND_PHOTO, BACKDROP];

const list = (items: readonly string[]) => items.join(", ");

/** Ground and roads only (never walls, roofs, trees, windows or fences), for CSP's puddle height map. */
export const RELIEF_MATERIALS = list([...ROAD_PHOTO, "concrete", "paint?", "path_?", ...GROUND_PHOTO]);

const f2 = (v: number) => v.toFixed(2);

/** The relief line and one comment per hollow (scripts/check/autotest_report.py parses the hollow lines). */
function hollowLines(hollows: Hollow[]): string[] {
  return [
    `RELIEF_MATERIALS = ${RELIEF_MATERIALS}`,
    `; Hollows where water should stand in the rain (rainHollows.ts): ${hollows.length}. Lowest point x, y, z; depth; area.`,
    ...hollows.map((h, i) =>
      `; hollow ${i + 1}: ${h.low.map(f2).join(", ")}  ${Math.round(h.depth * 100)} cm, ${Math.round(h.area)} m2, ${Math.round(h.radius * 2)} m across`),
  ];
}

/** Extra water keys when the bay's photo shows through the sea surface (photoSea.ts). */
function photoSeaWaterLines(): string[] {
  return ["UseAlphaFromDiffuse = 1", "DepthAware = 1", "CausticsMultiplier = 1.0", "IS_TRANSPARENT = 1"];
}

/** A material that lights up at night (CSP material adjustment on ksEmissive). */
function nightGlow(n: number, description: string, materials: string, value: string): string[] {
  return [
    `[MATERIAL_ADJUSTMENT_${n}]`, "ACTIVE = 1", `DESCRIPTION = ${description}`, `MATERIALS = ${materials}`,
    "CONDITION = NIGHT_SMOOTH", "KEY_0 = ksEmissive", `VALUE_0 = ${value}`, "OFF_VALUE_0 = 0, 0, 0", "",
  ];
}

/** A material that changes with the time of year (CSP's seasonAutumn). */
function season(n: number, name: string, lut: string, adjustment: number, description: string, materials: string, value: string): string[] {
  return [
    `[CONDITION_${n}]`, `NAME = ${name}`, "INPUT = YEAR_DAY", `LUT = ${lut}`, "LAG = 0", "",
    `[MATERIAL_ADJUSTMENT_${adjustment}]`, "ACTIVE = 1", `DESCRIPTION = ${description}`, `MATERIALS = ${materials}`,
    `CONDITION = ${name}`, "KEY_0 = seasonAutumn", `VALUE_0 = ${value}`, "OFF_VALUE_0 = 0", "",
  ];
}

/**
 * extension/ext_config.ini. `lights` are street light lantern positions in local metres
 * (x east, y north, z up).
 */
export function extConfig(lights: Vec3[], opts: CspOptions = {}): string {
  const sounds = opts.sounds ?? [];
  const fmod = opts.soundMode === "fmod";
  const out: string[] = [
    "; Generated by AC Track Builder. Read by Custom Shaders Patch; ignored without it.",
    "",
    "[INCLUDE]",
    "INCLUDE = common/materials_track.ini",
    "",
    // Night: the sun more than 88 degrees from overhead.
    "[CONDITION_0]",
    "NAME = NIGHT_SMOOTH",
    "INPUT = SUN",
    "LUT = (|0=0|88=0|88=1|180=1)",
    "LAG = 0.97",
    "",
    "[GRASS_FX]",
    `GRASS_MATERIALS = ${list(GRASS_MATERIALS)}`,
    `OCCLUDING_MATERIALS = ${list(OCCLUDING_MATERIALS)}`,
    "ORIGINAL_GRASS_MATERIALS =",
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
    `PUDDLES_MATERIALS = ${list(PUDDLES_MATERIALS)}`,
    `SOAKING_MATERIALS = ${list(SOAKING_MATERIALS)}`,
    `ROUGH_MATERIALS = ${list(ROUGH_MATERIALS)}`,
    `SMOOTH_MATERIALS = ${list(SMOOTH_MATERIALS)}`,
    `LINES_MATERIALS = ${list(LINES_MATERIALS)}`,
    ...(opts.hollows ? hollowLines(opts.hollows) : []),
    "",
    "[SHADER_REPLACEMENT_0]",
    `MATERIALS = ${list(THIN_TWO_SIDED)}`,
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
    ...nightGlow(1, "Lit rooms behind house windows at night", "window", "255, 190, 120, 0.008"),
    ...nightGlow(2, "Shop signs lit at night", "shop_sign", "255, 250, 240, 0.35"),
    ...nightGlow(3, "Shop windows glow at night", "shop_window", "255, 215, 165, 0.12"),
  ];
  if (opts.builtUp) {
    out.push(
      "[LIGHT_POLLUTION]",
      "RELATIVE_POSITION = 0.5, 0, 0.5",
      "DENSITY = 0.15",
      `RADIUS_KM = ${f2(Math.max(0.8, opts.radiusKm ?? 1))}`,
      "COLOR = 1.0, 0.72, 0.45",
      "ACTIVE = 1",
      "",
    );
  }
  if (lights.length) {
    out.push(
      "[LIGHT_SERIES_0]",
      "DESCRIPTION = Street lights",
      "CONDITION = NIGHT_SMOOTH",
      "COLOR = 255, 236, 210, 0.06",
      "SPOT = 140",
      "SPOT_SHARPNESS = 0.3",
      "RANGE = 30",
      "RANGE_GRADIENT_OFFSET = 0.1",
      "DIFFUSE_CONCENTRATION = 0.7",
      "FADE_AT = 450",
      "FADE_SMOOTH = 60",
      ...lights.map(([x, y, z], i) => `POSITION_${i} = ${f2(x)}, ${f2(z)}, ${f2(-y)}`),
      "",
      "[Material_DistantEmissive]",
      "Materials = lamp",
      "",
      ...nightGlow(0, "Street light lanterns glow at night", "lamp", "255, 236, 210, 0.4"),
    );
  }
  out.push(
    "[BASIC]",
    "SUPPORTS_WIND = 1",
    "",
    "[BOUNCED_LIGHT]",
    "SUPPORTED = 1",
    `SURFACE_MATERIALS = ${list(BOUNCE_MATERIALS)}`,
    `CAUSTICS = ${opts.sea ? 1 : 0}`,
    "",
    // ksAlphaRef -193 is CSP's tiling fix for detail maps on these shaders.
    "[SHADER_REPLACEMENT_1]",
    "MATERIALS = shader:ksMultilayer?, shader:ksPerPixelMultiMap?",
    "PROP_0 = ksAlphaRef, -193",
    "",
  );
  if (opts.pure) out.push(...pureSections(opts.pure));
  else {
    out.push(
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
    );
  }
  if (opts.trees) out.push("[TREES]", `LIST_0 = ${opts.trees}`, "", "[LIGHTING]", "ENABLE_TREES_LIGHTING = 1", "");
  if (opts.sea) {
    out.push("[Material_Water]", "Materials = sea", "Type = SEA", "UseRecommendedTextures = 1", ...(opts.photoSea ? photoSeaWaterLines() : []), "");
  }
  // Straw from December to April, green June to September (masked by greenness, so roads and roofs keep their colour).
  if (opts.drySummer) {
    out.push(...season(1, "DRY_SEASON", "(|1=1|120=1|152=0|273=0|335=1|365=1|)", 4,
      "Grass and verges go straw in the dry season", list(DRY_SEASON_MATERIALS), "0.8"));
  }
  // Green from budburst to March, gold in April and May, left gold through winter.
  if (opts.vines) {
    out.push(...season(2, "VINE_AUTUMN", "(|1=0|80=0|110=1|230=1|280=0|365=0|)", 5,
      "Vine leaves turn gold in autumn", "vine_leaf", "1"));
  }
  if (sounds.length && fmod) out.push(...soundConfig(sounds));
  if (opts.flags) out.push(...flagCspLines());
  if (opts.autotest) out.push("[SCRIPT_0]", "SCRIPT = autotest.lua", "");
  if (sounds.length && !fmod) out.push(...soundScriptConfig(opts.autotest ? 1 : 0));
  if (opts.jettyTrain) out.push(...jettyTrainConfig());
  return out.join("\r\n");
}

/**
 * baked_shadow_params.ini for CSP's AO bakery (bakeryoptix.exe). Keep the `KEY = value` spacing:
 * scripts/windows/bake-vao.ps1 rewrites `^RAYS_PER_SAMPLE = \d+` for its test quality.
 */
export function bakedShadowParams(): string {
  return [
    "; Generated by Busselton AC. Read by CSP's AO bakery (bakeryoptix.exe) when it bakes this track.",
    "[GENERAL]",
    "MODE = TRACK",
    "USE_VULKAN = 1",
    "",
    "[MODE_TRACK]",
    "RAYS_PER_SAMPLE = 96",
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
