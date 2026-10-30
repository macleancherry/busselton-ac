import { describe, expect, it } from "vitest";
import { surfacesIni, timezoneOf } from "../src/core/acFiles";
import { bakedShadowParams, extConfig } from "../src/core/cspConfig";

describe("CSP: sun position, wind, bounced light, Pure and AO bake settings", () => {
  it("tells CSP where the track is", () => {
    const ini = surfacesIni([115.345, -33.646]);
    expect(ini).toMatch(/\[WEATHER_FX\]\nLATITUDE=-33\.64600\nLONGITUDE=115\.34500\nTIMEZONE_ID=Australia\/Perth/);
    expect(surfacesIni()).not.toMatch(/WEATHER_FX/);
    expect(surfacesIni([-0.12, 51.5])).not.toMatch(/TIMEZONE_ID/);
  });

  it("time zones across Australia", () => {
    expect(timezoneOf([151.2, -33.87])).toBe("Australia/Sydney");
    expect(timezoneOf([144.96, -37.81])).toBe("Australia/Melbourne");
    expect(timezoneOf([153.03, -27.47])).toBe("Australia/Brisbane");
    expect(timezoneOf([138.6, -34.93])).toBe("Australia/Adelaide");
    expect(timezoneOf([130.84, -12.46])).toBe("Australia/Darwin");
    expect(timezoneOf([147.33, -42.88])).toBe("Australia/Hobart");
    expect(timezoneOf([115.86, -31.95])).toBe("Australia/Perth");
  });

  it("adds the new ext_config sections", () => {
    const cfg = extConfig([]);
    for (const s of ["[BASIC]", "SUPPORTS_WIND = 1", "[BOUNCED_LIGHT]", "[SHADER_REPLACEMENT_1]", "[PURE]"]) expect(cfg).toContain(s);
  });

  it("writes the AO bakery's settings", () => {
    expect(bakedShadowParams()).toMatch(/\[MODE_TRACK\][\s\S]*RAYS_PER_SAMPLE = 96/);
    expect(bakedShadowParams("test")).toMatch(/RAYS_PER_SAMPLE = 32/);
  });
});
