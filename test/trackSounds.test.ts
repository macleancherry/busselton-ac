import { describe, expect, it } from "vitest";
import { birdEmitters, distanceTo, soundConfig, soundReadme, SOUND_EVENTS, surfEmitters, type SoundTree } from "../src/core/trackSounds";
import { extConfig } from "../src/core/cspConfig";
import { SEA_LEVEL, type CoastPolygon } from "../src/core/coast";

// The sea south of y = 0 (a box), its north side the shore; the other sides are tile seams.
const sea: CoastPolygon = {
  rings: [[[-2000, 0], [2000, 0], [2000, -1000], [-2000, -1000]]],
  edge: [[true, false, false, false]],
};
// A road along the shore, 50 m inland, from x = -500 to 500.
const roads: [number, number][][] = [[[-500, 50], [500, 50]]];
const ground = () => 3;

describe("track sounds", () => {
  it("measures distance to the roads, out to the reach", () => {
    const d = distanceTo(roads, 300);
    expect(d(0, 50)).toBeCloseTo(0, 5);
    expect(d(0, 150)).toBeCloseTo(100, 5);
    expect(d(0, 600)).toBe(Infinity);
  });

  it("puts wave emitters along the real shore, near the road, at the water", () => {
    const surf = surfEmitters([sea], { roads, ground });
    expect(surf.length).toBeGreaterThan(5);
    expect(surf.length).toBeLessThanOrEqual(24);
    for (const e of surf) {
      expect(e.kind).toBe("surf");
      expect(e.at[1]).toBeCloseTo(0, 5); // on the shoreline, never a tile seam
      expect(Math.abs(e.at[0])).toBeLessThan(500 + 350);
      expect(e.at[2]).toBeCloseTo(SEA_LEVEL + 0.5, 5);
    }
    // Spread out, not stacked.
    const xs = surf.map((e) => e.at[0]).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThan(90);
  });

  it("puts kookaburras in the bush, magpies in the parks, and none out of earshot", () => {
    const stand = (cx: number, cy: number, n: number, bush: boolean): SoundTree[] =>
      Array.from({ length: n }, (_, i) => ({ x: cx + (i % 4) * 5, y: cy + Math.floor(i / 4) * 5, bush }));
    const trees = [
      ...stand(-300, 100, 12, true), // bush beside the road
      ...stand(200, 120, 10, false), // a park
      ...stand(0, 2000, 30, true), // far from any road
      ...stand(0, 90, 3, false), // too few trees
    ];
    const birds = birdEmitters(trees, { roads, ground });
    expect(birds.map((b) => b.kind).sort()).toEqual(["kookaburra", "magpie"]);
    const kook = birds.find((b) => b.kind === "kookaburra")!;
    expect(kook.at[0]).toBeCloseTo(-292.5, 1);
    expect(kook.at[2]).toBe(10); // up in the canopy
  });

  it("writes the soundbank, day and rain conditions and one event per emitter, in AC space", () => {
    const lines = soundConfig([
      { kind: "surf", at: [10, -20, 0.75] },
      { kind: "magpie", at: [-5, 30, 10] },
      { kind: "kookaburra", at: [1, 2, 3] },
    ]).join("\n");
    expect(lines).toContain("[SOUNDBANK_0]\nBANK = sfx/busselton.bank\nGUIDS = sfx/GUIDs.txt");
    expect(lines).toContain(`[EVENT_0]\nID = ${SOUND_EVENTS.surf}`);
    expect(lines).toContain("POSITION = 10.00, 0.75, 20.00"); // x, up, south
    expect(lines).toContain(`[EVENT_1]\nID = ${SOUND_EVENTS.magpie}`);
    expect(lines).toContain("POSITION = -5.00, 10.00, -30.00");
    expect(lines).toMatch(/ID = event:\/busselton\/kookaburra[\s\S]*VOLUME = BUSS_KOOKABURRAS/);
    expect(lines).toContain("INPUT = 'BUSS_DAYLIGHT * (1 - RAIN)'");
    expect(soundConfig([])).toEqual([]);
  });

  it("adds the sounds to ext_config without clashing sections, and explains the placeholder bank", () => {
    const emitters = [{ kind: "surf" as const, at: [0, 0, 0.75] as [number, number, number] }, { kind: "magpie" as const, at: [5, 5, 10] as [number, number, number] }];
    const ini = extConfig([[0, 0, 8]], { drySummer: true, autotest: true, sounds: emitters });
    expect(ini).toContain("[SOUNDBANK_0]");
    expect(ini).toContain("[EVENT_1]");
    const heads = ini.match(/^\[[^\]]+\]/gm)!;
    expect(new Set(heads).size).toBe(heads.length);
    expect(extConfig([])).not.toContain("SOUNDBANK");
    const readme = soundReadme(emitters);
    expect(readme).toContain("extension/sfx/busselton.bank");
    expect(readme).toContain("event:/busselton/surf");
    expect(readme).toContain("CC0");
  });
});
