import { describe, expect, it } from "vitest";
import { extConfig } from "../src/core/cspConfig";
import { PURE_DEFAULTS, clearAirRegion, groundAlbedo, groundDamping, pureSections, pureValues } from "../src/core/pureConfig";

const BUSSELTON: [number, number] = [115.35, -33.65];
const SYDNEY: [number, number] = [151.2, -33.87];

/** A size x size photo of one colour. */
const flat = (size: number, r: number, g: number, b: number, a = 255) => {
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([r, g, b, a], i);
  return { rgba, size };
};

describe("Pure tuning", () => {
  it("measures the ground photo's average brightness, skipping empty pixels", () => {
    expect(groundAlbedo([])).toBeUndefined();
    expect(groundAlbedo([flat(64, 255, 255, 255)])).toBeCloseTo(1, 5);
    expect(groundAlbedo([flat(64, 0, 0, 0), flat(64, 255, 255, 255)])).toBeCloseTo(0.5, 5);
    expect(groundAlbedo([flat(64, 0, 0, 0), flat(64, 255, 255, 255, 0)])).toBeCloseTo(0, 5);
  });

  it("clears the haze in south-west WA and adds morning haze on the coast", () => {
    expect(clearAirRegion(BUSSELTON)).toBe(true);
    expect(clearAirRegion(SYDNEY)).toBe(false);
    expect(pureValues({ at: SYDNEY })).toEqual(PURE_DEFAULTS);
    const wa = pureValues({ at: BUSSELTON, coast: true });
    expect(wa.SMOG_NOON).toBeLessThan(PURE_DEFAULTS.SMOG_NOON);
    expect(wa.SMOG_EVENING).toBeLessThan(PURE_DEFAULTS.SMOG_EVENING);
    expect(wa.SMOG_MORNING).toBeGreaterThan(PURE_DEFAULTS.SMOG_MORNING);
    // Fog and dawn/dusk stay at CSP's values (their meaning in Pure is unconfirmed).
    expect(wa.FOG_LEVEL).toBe(PURE_DEFAULTS.FOG_LEVEL);
    expect(wa.SUN_DAWN).toBe(1);
  });

  it("calms the photo ground only where it's brighter than a suburb, never below 0.85", () => {
    expect(groundDamping(undefined)).toBe(1);
    expect(groundDamping(0.25)).toBe(1);
    expect(groundDamping(0.4)).toBeCloseTo(Math.sqrt(0.3 / 0.4), 5);
    expect(groundDamping(0.9)).toBe(0.85);
    const light = { ambient: 0.6, diffuse: 0.2 };
    expect(pureSections({ at: BUSSELTON, albedo: 0.25, photoLight: light }).join("\n")).not.toContain("SHADER_REPLACEMENT");
    const bright = pureSections({ at: BUSSELTON, albedo: 0.9, photoLight: light }).join("\n");
    expect(bright).toContain("MATERIALS = terrain_?\nPROP_0 = ksAmbient, 0.510\nPROP_1 = ksDiffuse, 0.170");
  });

  it("goes into ext_config in place of the generic [PURE] block, once", () => {
    const generic = extConfig([]);
    expect(generic).toContain("SMOG_NOON = 0.1\r\n");
    const tuned = extConfig([], { sea: true, pure: { at: BUSSELTON, albedo: 0.5, coast: true, photoLight: { ambient: 0.6, diffuse: 0.2 } } });
    expect(tuned.match(/^\[PURE\]/gm)).toHaveLength(1);
    expect(tuned).toContain("SMOG_NOON = 0.07\r\n");
    expect(tuned).toContain("SMOG_MORNING = 0.08\r\n");
    expect(tuned).toContain("[SHADER_REPLACEMENT_...]");
    // Numbered sections stay unique ("..." sections are numbered by CSP).
    const heads = tuned.match(/^\[[^\]]+\]/gm)!.filter((h) => !h.includes("..."));
    expect(new Set(heads).size).toBe(heads.length);
  });
});
