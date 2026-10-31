// CSP track config and AO bake settings, from docs/specs/cspConfig.md "Tests to write".
import { describe, expect, it } from "vitest";
import { bakedShadowParams, extConfig, RELIEF_MATERIALS, type CspOptions } from "../src/core/cspConfig";
import { pureSections, type AtmosphereInput } from "../src/core/pureConfig";
import type { Hollow } from "../src/core/rainHollows";
import type { SoundEmitter } from "../src/core/trackSounds";

const hollow: Hollow = { low: [50, 1.9, 4], centre: [50, 2, 4], depth: 0.1, area: 120, volume: 6, radius: 12 };
const sounds: SoundEmitter[] = [{ kind: "surf", at: [100, -50, 0] }, { kind: "magpie", at: [20, 30, 6] }];
// Bright ground with a photo light, so Pure adds its [SHADER_REPLACEMENT_...] block.
const pure: AtmosphereInput = { at: [115.86, -31.95], albedo: 0.55, coast: true, photoLight: { ambient: 0.6, diffuse: 0.5 } };
const everything = (soundMode: "lua" | "fmod"): CspOptions => ({
  builtUp: true, radiusKm: 1.5, autotest: true, drySummer: true, sea: true, photoSea: true, trees: "trees/trees.txt", vines: true,
  hollows: [hollow], sounds, soundMode, pure, flags: true, jettyTrain: true,
});
const lights: [number, number, number][] = [[10, 20, 8.2], [-5, 3, 9]];

const headers = (t: string) => [...t.matchAll(/^\[([^\]]+)\]\r?$/gm)].map((m) => m[1]);
/** The lines of one section (up to the next empty line). */
const section = (t: string, name: string) => t.split(`[${name}]\r\n`)[1]?.split("\r\n\r\n")[0];

describe("extConfig: base file", () => {
  it("writes lights, the night condition and the night glows", () => {
    const t = extConfig(lights);
    expect(t).toContain("NAME = NIGHT_SMOOTH");
    expect(t).toContain("[LIGHT_SERIES_0]");
    expect(t).toContain("POSITION_0 = 10.00, 8.20, -20.00\r\n");
    expect(t).toContain("POSITION_1 = -5.00, 9.00, -3.00\r\n");
    for (const m of ["lamp", "shop_sign", "shop_window"]) expect(t).toContain(`MATERIALS = ${m}\r\nCONDITION = NIGHT_SMOOTH\r\nKEY_0 = ksEmissive`);
  });

  it("writes the sections in order", () => {
    expect(headers(extConfig([]))).toEqual([
      "INCLUDE", "CONDITION_0", "GRASS_FX", "RAIN_FX", "SHADER_REPLACEMENT_0", "Material_RoomWindows",
      "MATERIAL_ADJUSTMENT_1", "MATERIAL_ADJUSTMENT_2", "MATERIAL_ADJUSTMENT_3",
      "BASIC", "BOUNCED_LIGHT", "SHADER_REPLACEMENT_1", "PURE",
    ]);
    const all = headers(extConfig(lights, everything("fmod")));
    const order = ["INCLUDE", "CONDITION_0", "GRASS_FX", "RAIN_FX", "SHADER_REPLACEMENT_0", "Material_RoomWindows", "MATERIAL_ADJUSTMENT_1",
      "MATERIAL_ADJUSTMENT_2", "MATERIAL_ADJUSTMENT_3", "LIGHT_POLLUTION", "LIGHT_SERIES_0", "Material_DistantEmissive", "MATERIAL_ADJUSTMENT_0",
      "BASIC", "BOUNCED_LIGHT", "SHADER_REPLACEMENT_1", "PURE", "SHADER_REPLACEMENT_...", "TREES", "LIGHTING", "Material_Water",
      "CONDITION_1", "MATERIAL_ADJUSTMENT_4", "CONDITION_2", "MATERIAL_ADJUSTMENT_5", "SOUNDBANK_0", "CONDITION_20", "WIND", "SCRIPT_0", "SCRIPT_..."];
    const at = order.map((h) => all.indexOf(h));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("uses CRLF, KEY = value, and ends with one CRLF", () => {
    for (const t of [extConfig([]), extConfig(lights, everything("lua")), extConfig(lights, everything("fmod"))]) {
      expect(t.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
      expect(t.endsWith("\r\n")).toBe(true);
      expect(t.endsWith("\r\n\r\n")).toBe(false);
      for (const line of t.split("\r\n")) {
        if (!line || line.startsWith(";") || line.startsWith("[")) continue;
        if (line === "ORIGINAL_GRASS_MATERIALS =") continue;
        expect(line).toMatch(/^[A-Za-z_0-9]+ = \S/);
      }
    }
  });

  it("writes Grass FX for the photo ground, never the road", () => {
    const g = section(extConfig([]), "GRASS_FX");
    const grass = /GRASS_MATERIALS = (.*)/.exec(g)![1];
    expect(grass.startsWith("terrain_?, strip_photo_?")).toBe(true);
    expect(grass.split(", ").some((m) => m.startsWith("road"))).toBe(false);
    expect(g).toContain("\r\nOCCLUDING_MATERIALS = road_?, side_photo_?, concrete");
    expect(g).toContain("\r\nORIGINAL_GRASS_MATERIALS =\r\n");
    for (const kv of ["MASK_MAIN_THRESHOLD = 0.12", "MASK_RED_THRESHOLD = 0.3", "MASK_MIN_LUMINANCE = 0.06", "MASK_MAX_LUMINANCE = 0.55",
      "MASK_BLUR = 2", "SHAPE_SIZE = 1.0", "SHAPE_TIDY = 0.35", "SHAPE_CUT = 0.35", "SHAPE_WIDTH = 1.0"]) expect(g.split("\r\n")).toContain(kv);
  });

  it("writes Rain FX", () => {
    const t = extConfig([]);
    expect(t).toContain("[RAIN_FX]\r\nPUDDLES_MATERIALS = road_?");
    expect(t).toContain("\r\nROUGH_MATERIALS = terrain_?, backdrop_?");
    expect(t).toContain("\r\nLINES_MATERIALS = paint, paint_yellow\r\n");
  });

  it("includes the track materials and the window and lamp templates", () => {
    expect(extConfig([])).toContain("INCLUDE = common/materials_track.ini");
    expect(extConfig([])).toContain("[Material_RoomWindows]\r\nMaterials = window");
    expect(extConfig(lights)).toContain("[Material_DistantEmissive]\r\nMaterials = lamp");
  });

  it("writes no light sections without lights", () => {
    const t = extConfig([]);
    expect(t).not.toContain("LIGHT_SERIES");
    expect(t).not.toContain("Material_DistantEmissive");
    expect(t).not.toContain("MATERIAL_ADJUSTMENT_0");
  });

  it("writes light pollution only for built-up tracks", () => {
    expect(extConfig([], { builtUp: true, radiusKm: 1.2 })).toContain("RADIUS_KM = 1.20\r\n");
    expect(extConfig([], { builtUp: true, radiusKm: 0.3 })).toContain("RADIUS_KM = 0.80\r\n");
    expect(extConfig([], { builtUp: true })).toContain("RADIUS_KM = 1.00\r\n");
    expect(extConfig([], { radiusKm: 2 })).not.toContain("LIGHT_POLLUTION");
  });

  it("always writes wind, bounced light, the tiling fix and Pure", () => {
    const t = extConfig([]);
    expect(t).toContain("[BASIC]\r\nSUPPORTS_WIND = 1\r\n");
    expect(section(t, "BOUNCED_LIGHT")).toContain("CAUSTICS = 0");
    expect(section(extConfig([], { sea: true }), "BOUNCED_LIGHT")).toContain("CAUSTICS = 1");
    expect(section(t, "SHADER_REPLACEMENT_1")).toContain("PROP_0 = ksAlphaRef, -193");
    expect(t).toContain("SMOG_NOON = 0.1\r\n");
    const tuned = extConfig([], { pure });
    expect(tuned).toContain(pureSections(pure).join("\r\n"));
    expect(tuned).not.toContain("SMOG_NOON = 0.1\r\n");
  });

  it("lists instanced trees only when set", () => {
    const t = extConfig([], { trees: "trees/trees.txt" });
    expect(t).toContain("[TREES]\r\nLIST_0 = trees/trees.txt");
    expect(t).toContain("ENABLE_TREES_LIGHTING = 1");
    expect(extConfig([])).not.toContain("[TREES]");
    expect(extConfig([])).not.toContain("ENABLE_TREES_LIGHTING");
  });

  it("writes the sea water, clear over the photo sea", () => {
    const water = "[Material_Water]\r\nMaterials = sea\r\nType = SEA\r\nUseRecommendedTextures = 1\r\n";
    expect(extConfig([], { sea: true }).endsWith(water)).toBe(true); // the last section here: one CRLF ends the file
    expect(extConfig([], { sea: true })).not.toContain("UseAlphaFromDiffuse");
    expect(extConfig([], { sea: true, photoSea: true })).toContain(water + "UseAlphaFromDiffuse = 1\r\nDepthAware = 1\r\nCausticsMultiplier = 1.0\r\nIS_TRANSPARENT = 1\r\n");
    expect(extConfig([], { photoSea: true })).not.toContain("Material_Water");
  });

  it("writes the dry season and vine seasons only when on", () => {
    const dry = extConfig([], { drySummer: true }), vines = extConfig([], { vines: true });
    expect(dry).toContain("[CONDITION_1]\r\nNAME = DRY_SEASON\r\nINPUT = YEAR_DAY\r\nLUT = (|1=1|120=1|152=0|273=0|335=1|365=1|)\r\nLAG = 0\r\n");
    expect(section(dry, "MATERIAL_ADJUSTMENT_4")).toContain("CONDITION = DRY_SEASON\r\nKEY_0 = seasonAutumn\r\nVALUE_0 = 0.8\r\nOFF_VALUE_0 = 0");
    expect(section(dry, "MATERIAL_ADJUSTMENT_4")).toContain("MATERIALS = terrain_?, strip_photo_?, sidestrips_photo, returns_photo, rbphoto_?, grass, verge, backdrop_?");
    expect(vines).toContain("[CONDITION_2]\r\nNAME = VINE_AUTUMN\r\nINPUT = YEAR_DAY\r\nLUT = (|1=0|80=0|110=1|230=1|280=0|365=0|)\r\nLAG = 0\r\n");
    expect(section(vines, "MATERIAL_ADJUSTMENT_5")).toContain("MATERIALS = vine_leaf\r\nCONDITION = VINE_AUTUMN\r\nKEY_0 = seasonAutumn\r\nVALUE_0 = 1\r\nOFF_VALUE_0 = 0");
    for (const s of ["DRY_SEASON", "MATERIAL_ADJUSTMENT_4"]) expect(vines).not.toContain(s);
    for (const s of ["VINE_AUTUMN", "MATERIAL_ADJUSTMENT_5"]) expect(dry).not.toContain(s);
  });
});

describe("extConfig: rain hollows", () => {
  const AUTOTEST_REPORT_HOLLOW = /^;\s*hollow\s+(\d+):\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\s+(\d+)\s*cm,\s*(\d+)\s*m2/m; // scripts/check/autotest_report.py

  it("adds the relief map and the hollow comments inside RAIN_FX", () => {
    const rain = section(extConfig([], { hollows: [hollow] }), "RAIN_FX");
    expect(rain).toContain(`\r\nRELIEF_MATERIALS = ${RELIEF_MATERIALS}\r\n`);
    expect(rain).toContain("; hollow 1: 50.00, 1.90, 4.00  10 cm, 120 m2, 24 m across");
    expect(rain).toContain("(rainHollows.ts): 1.");
  });

  it("keeps buildings out of the relief materials", () => {
    for (const m of RELIEF_MATERIALS.split(", ")) expect(m).not.toMatch(/wall|roof|tree|window|fence/);
    expect(RELIEF_MATERIALS.startsWith("road_?")).toBe(true);
  });

  it("writes no relief map without the option, and an empty list with []", () => {
    expect(extConfig([])).not.toContain("RELIEF_MATERIALS");
    const t = extConfig([], { hollows: [] });
    expect(section(t, "RAIN_FX")).toContain("RELIEF_MATERIALS = ");
    expect(t).toContain("(rainHollows.ts): 0.");
    expect(t).not.toContain("; hollow 1:");
  });

  it("writes hollow lines the autotest report can parse", () => {
    const t = extConfig([], { hollows: [hollow, { ...hollow, low: [-12.345, -0.5, -300.001], depth: 0.034, area: 7.6 }] });
    const lines = t.split("\r\n").filter((l) => l.startsWith("; hollow "));
    expect(lines.length).toBe(2);
    const m = lines.map((l) => AUTOTEST_REPORT_HOLLOW.exec(l));
    expect(m[0]?.slice(1)).toEqual(["1", "50.00", "1.90", "4.00", "10", "120"]);
    expect(m[1]?.slice(1)).toEqual(["2", "-12.35", "-0.50", "-300.00", "3", "8"]);
  });
});

describe("extConfig: scripts, sounds, jetty and flags", () => {
  it("numbers the track scripts", () => {
    expect(extConfig([], { autotest: true })).toContain("[SCRIPT_0]\r\nSCRIPT = autotest.lua");
    const both = extConfig([], { autotest: true, sounds });
    expect(both).toContain("[SCRIPT_0]\r\nSCRIPT = autotest.lua");
    expect(both).toContain("[SCRIPT_1]\r\nSCRIPT = sounds.lua");
    expect(extConfig([], { sounds, soundMode: "lua" })).toContain("[SCRIPT_0]\r\nSCRIPT = sounds.lua");
    const fmod = extConfig([], { sounds, soundMode: "fmod" });
    expect(fmod).toContain("[SOUNDBANK_0]");
    expect(fmod).toContain("[EVENT_1]");
    expect(fmod).not.toContain("sounds.lua");
    for (const soundMode of ["lua", "fmod"] as const) {
      const none = extConfig([], { sounds: [], soundMode });
      expect(none).not.toContain("sounds.lua");
      expect(none).not.toContain("SOUNDBANK");
    }
    expect(extConfig([], { soundMode: "fmod" })).not.toContain("SOUNDBANK");
  });

  it("loads the jetty train script beside the autotest", () => {
    const t = extConfig([], { jettyTrain: true, autotest: true });
    expect(t).toContain("[SCRIPT_...]\r\nSCRIPT = jetty_train.lua\r\nspeedKmh = 5");
    expect(t).toContain("[SCRIPT_0]\r\nSCRIPT = autotest.lua");
    expect(extConfig([])).not.toContain("jetty_train");
  });

  it("makes flags wave only when on", () => {
    const t = extConfig([], { flags: true });
    expect(t).toContain("MATERIALS = shader:ksFlags\r\nCULL_MODE = DOUBLESIDED");
    expect(t).toContain("MESHES = FLAGBACK_?\r\nIS_VISIBLE = 0");
    expect(extConfig([])).not.toContain("DYNAMIC_FLAGS");
  });
});

describe("extConfig: section numbers", () => {
  const REGISTRY = /^(INCLUDE|GRASS_FX|RAIN_FX|LIGHT_POLLUTION|BASIC|BOUNCED_LIGHT|PURE|TREES|LIGHTING|WIND|SOUNDBANK_0|Material_\w+|CONDITION_(0|1|2|2[0-4])|MATERIAL_ADJUSTMENT_[0-5]|SHADER_REPLACEMENT_[01]|LIGHT_SERIES_0|SCRIPT_[01]|EVENT_\d+)$/;
  /** Numbered (not auto-numbered `_...`) headers, which must be unique. */
  const numbered = (t: string) => headers(t).filter((h) => !h.endsWith("_..."));

  for (const mode of ["lua", "fmod"] as const) {
    it(`keeps numbered headers unique with every option on (${mode} sounds), including flags and Pure's bright ground`, () => {
      const t = extConfig(lights, everything(mode));
      // The auto-numbered sections really are there: flags' two and Pure's bright ground, and the jetty's script.
      expect(headers(t).filter((h) => h === "SHADER_REPLACEMENT_...").length).toBe(3);
      expect(headers(t)).toContain("SCRIPT_...");
      const n = numbered(t);
      expect(new Set(n).size).toBe(n.length);
      for (const h of n) expect(h).toMatch(REGISTRY);
    });
  }

  it("stays unique with a layer's sections appended (as build-track.mjs does)", () => {
    const t = extConfig(lights, everything("lua")) + "\r\n; Layer x\r\n[LIGHT_SERIES_...]\r\nPOSITION_0 = 1.00, 2.00, 3.00\r\n\r\n[SHADER_REPLACEMENT_...]\r\nMATERIALS = x\r\n";
    const n = numbered(t);
    expect(new Set(n).size).toBe(n.length);
  });
});

describe("bakedShadowParams", () => {
  const expected = [
    "; Generated by Busselton AC. Read by CSP's AO bakery (bakeryoptix.exe) when it bakes this track.",
    "[GENERAL]", "MODE = TRACK", "USE_VULKAN = 1", "",
    "[MODE_TRACK]", "RAYS_PER_SAMPLE = 96", "MIN_SAMPLES_PER_FACE = 4", "RAYS_OFFSET = 0.1", "BOUNCES = 5", "BASE_ALBEDO = 0.9",
    "USE_GROUND = 0", "BRIGHTNESS = 1.02", "GAMMA = 0.92", "OPACITY = 0.97",
    "BAKE_AS_TREES = material:trees, material:shrubs, material:hedge, material:barrier_hedge, shader:ksTree?",
    "BAKE_AS_GRASS = shader:ksGrass?", "TREES_LIGHT_PASS_CHANCE = 0.9", "TREES_SHADOW_FACTOR = 0.8",
    "EXCLUDE_FROM_BAKING = renderable:n, material:sea, material:sea_photo?, material:shore_foam, material:backdrop_?",
    "FORCE_PASSING_LIGHT = material:sea, material:glass, material:window, material:shop_window",
    "EXT_EXCLUDE_POBJECTS = 1", "EXT_REBAKE_DARK_OBJECTS = 1", "AO_SAMPLES_PHYSICS_SURFACES = 1",
    "EXT_PROCEDURAL_TREES_OCCLUDE = 0", "EXT_PROCEDURAL_TREES_BAKE = 0", "EXT_PROCEDURAL_TREES_FINALIZE = 0", "",
  ].join("\r\n");

  it("writes the bakery settings exactly, CRLF", () => {
    expect(bakedShadowParams()).toBe(expected);
  });

  it("keeps the RAYS_PER_SAMPLE line bake-vao.ps1 rewrites for test quality", () => {
    const t = bakedShadowParams();
    expect(t.match(/^RAYS_PER_SAMPLE = \d+/gm)).toEqual(["RAYS_PER_SAMPLE = 96"]);
    expect(t.replace(/^RAYS_PER_SAMPLE = \d+/m, "RAYS_PER_SAMPLE = 32")).toContain("\r\nRAYS_PER_SAMPLE = 32\r\n");
  });
});
