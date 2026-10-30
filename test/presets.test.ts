import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs module without types
import { applyPreset, PRESETS } from "../scripts/headless/presets.mjs";

describe("route presets", () => {
  it("leaves a route without a preset alone", () => {
    const r = { name: "x", build: { corridor: 10 } };
    expect(applyPreset(r)).toBe(r);
  });

  it("fills in the country settings under the route's own", () => {
    const r = applyPreset({ name: "x", preset: "country", options: { banking: false }, build: { origin: [1, 2], corridor: 50 } });
    expect(r.options.banking).toBe(false);
    expect(r.options.imagery).toBe("high");
    expect(r.build.corridor).toBe(50);
    expect(r.build.origin).toEqual([1, 2]);
    expect(r.build.terrainStep).toBe(PRESETS.country.build.terrainStep);
    expect(r.build.traffic).toBe(true);
    expect(r.build.zones).toBe(true);
  });

  it("turns Armco on for country roads and off for towns", () => {
    expect(applyPreset({ preset: "country" }).build.armco).toBe(true);
    expect(applyPreset({ preset: "town" }).build.armco).toBe(false);
  });

  it("refuses an unknown preset", () => {
    expect(() => applyPreset({ preset: "moon" })).toThrow(/unknown preset/);
  });
});
