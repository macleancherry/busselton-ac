import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, OPTIONAL_OPTION_KEYS, unknownOptionKeys, withDefaults, type BuildOptions } from "../src/core/options";
// @ts-expect-error plain .mjs module without types
import { PRESETS } from "../scripts/headless/presets.mjs";

const REQUIRED: Record<string, unknown> = {
  banking: true,
  buildingRadius: 250,
  buildings: true,
  carParks: true,
  chunkSize: 200,
  corridor: 90,
  crown: 0.02,
  defaultWidth: 6.5,
  demZoom: 14,
  detailShaders: true,
  detectBuildings: true,
  elevationSmoothing: 15,
  guardRails: true,
  guidePosts: true,
  horizon: 1500,
  horizonZoom: 16,
  imageryZoom: 18,
  kerbs: true,
  landmarks: true,
  lineSmoothing: 4,
  markings: true,
  maxBank: 0.06,
  maxTrees: 12000,
  name: "My road",
  noTrace: [],
  parkedCars: true,
  paths: true,
  pitCount: 8,
  roadSurface: "auto",
  runOff: 150,
  runUp: 60,
  sea: true,
  sideStreets: true,
  spacing: 2,
  streetSigns: true,
  terrainBlend: 20,
  terrainLod: true,
  terrainLodNear: 25,
  terrainStep: 3,
  terrainUnderRoad: 0.6,
  textureSize: 1024,
  traceGuard: true,
  traceRoads: true,
  traffic: false,
  trafficSetting: "normal",
  trafficZones: true,
  trees: 1,
  vergeWidth: 1.5,
  wallOffset: 10,
  widthOverride: 0,
};

const OPTIONAL = [
  "armco", "parkedBays", "kerbside", "laneBayClear", "houseStyle", "origin", "area", "aiKeepLeft",
  "streetsValid", "layout", "clears", "challenges", "timeTrialSectors", "driftZones", "terrainLodFarTol",
  "cspTrees", "rainHollows", "trackSounds", "gravelRoads", "unsealed", "zones", "pureTuning", "photoSea",
  "farmland", "farmRoadsides", "wavingFlags", "jettyTrain", "swimJetties", "jettyKinds", "trafficLights", "poleClear", "padClear", "networkCore",
];

const KNOWN = new Set([...Object.keys(REQUIRED), ...OPTIONAL]);

describe("build options", () => {
  it("has exactly the required fields (groundDetail, raceDress, sponsors and carParkIslands deleted)", () => {
    expect(Object.keys(REQUIRED)).toHaveLength(50);
    expect(Object.keys(DEFAULT_OPTIONS).sort()).toEqual(Object.keys(REQUIRED).sort());
  });

  it("has exactly the spec's defaults", () => {
    expect({ ...DEFAULT_OPTIONS }).toEqual(REQUIRED);
  });

  it("has no defaults for optional fields", () => {
    expect(OPTIONAL).toHaveLength(33);
    for (const k of OPTIONAL) expect(Object.keys(DEFAULT_OPTIONS)).not.toContain(k);
    expect([...OPTIONAL_OPTION_KEYS].sort()).toEqual([...OPTIONAL].sort());
  });

  it("withDefaults fills a partial without touching either input", () => {
    const empty = withDefaults({});
    expect(empty).toEqual(DEFAULT_OPTIONS);
    expect(empty).not.toBe(DEFAULT_OPTIONS);

    const partial: Partial<BuildOptions> = { corridor: 70, armco: true, terrainStep: undefined };
    const copy = { ...partial };
    const o = withDefaults(partial);
    expect(o.corridor).toBe(70);
    expect(o.armco).toBe(true);
    expect(o.terrainStep).toBe(3);
    expect(partial).toEqual(copy);
    expect(DEFAULT_OPTIONS.corridor).toBe(90);
    expect("armco" in DEFAULT_OPTIONS).toBe(false);
  });

  it("noTrace replaces the default and never leaks into DEFAULT_OPTIONS", () => {
    const zone = { at: [115.35, -33.65] as [number, number], radius: 60 };
    expect(withDefaults({ noTrace: [zone] }).noTrace).toEqual([zone]);
    const o = withDefaults({});
    o.noTrace.push(zone);
    expect(DEFAULT_OPTIONS.noTrace).toEqual([]);
    expect(withDefaults({}).noTrace).toEqual([]);
    expect(Object.isFrozen(DEFAULT_OPTIONS)).toBe(true);
  });

  it("names unknown keys, ignoring _notes", () => {
    expect(unknownOptionKeys({ corridor: 1, armco: true, _areaNote: "x", corridoor: 2 })).toEqual(["corridoor"]);
  });

  it("presets only set known fields", () => {
    for (const preset of Object.values(PRESETS) as { options: object; build: object }[]) {
      for (const k of Object.keys(preset.build)) expect(KNOWN.has(k), k).toBe(true);
      for (const k of Object.keys(preset.options)) expect(["imagery", "banking"]).toContain(k);
    }
  });

  it("routes only set known build fields", () => {
    const dirs = ["routes", "routes/private"].filter((d) => existsSync(d));
    for (const dir of dirs) {
      for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
        const route = JSON.parse(readFileSync(join(dir, f), "utf8"));
        for (const k of Object.keys(route.build ?? {})) {
          if (!k.startsWith("_")) expect(KNOWN.has(k), `${dir}/${f}: ${k}`).toBe(true);
        }
      }
    }
  });
});
