import { describe, expect, it } from "vitest";
import {
  birdEmitters, distanceTo, freesoundCc0, soundConfig, soundLua, soundMode, soundReadme, SOUND_EVENTS, SOUND_FILES, SOUND_SCRIPT,
  surfEmitters, type SoundEmitter, type SoundTree,
} from "../src/core/trackSounds";
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

  it("FMOD path: adds the sounds to ext_config without clashing sections, and explains the placeholder bank", () => {
    const emitters = [{ kind: "surf" as const, at: [0, 0, 0.75] as [number, number, number] }, { kind: "magpie" as const, at: [5, 5, 10] as [number, number, number] }];
    const ini = extConfig([[0, 0, 8]], { drySummer: true, autotest: true, sounds: emitters, soundMode: "fmod" });
    expect(ini).toContain("[SOUNDBANK_0]");
    expect(ini).toContain("[EVENT_1]");
    expect(ini).not.toContain(SOUND_SCRIPT);
    const heads = ini.match(/^\[[^\]]+\]/gm)!;
    expect(new Set(heads).size).toBe(heads.length);
    expect(extConfig([])).not.toContain("SOUNDBANK");
    const readme = soundReadme(emitters, "fmod");
    expect(readme).toContain("extension/sfx/busselton.bank");
    expect(readme).toContain("event:/busselton/surf");
    expect(readme).toContain("CC0");
  });
});

describe("track sounds through a Lua track script", () => {
  const emitters: SoundEmitter[] = [
    { kind: "surf", at: [10, -20, 0.75] },
    { kind: "magpie", at: [-5, 30, 10] },
    { kind: "kookaburra", at: [1, 2, 3] },
  ];

  it("reads the option: true and 'lua' are the script, 'fmod' the bank, off is nothing", () => {
    expect(soundMode(true)).toBe("lua");
    expect(soundMode("lua")).toBe("lua");
    expect(soundMode("fmod")).toBe("fmod");
    expect(soundMode(false)).toBeUndefined();
    expect(soundMode(undefined)).toBeUndefined();
  });

  it("fills the emitters into the script in AC space, and plays files with ac.AudioEvent.fromFile", () => {
    const lua = soundLua(emitters);
    expect(lua).not.toContain("__EMITTERS__");
    expect(lua).toContain("{ 'surf', 10.00, 0.75, 20.00 }"); // x, up, south
    expect(lua).toContain("{ 'magpie', -5.00, 10.00, -30.00 }");
    expect(lua).toContain("{ 'kookaburra', 1.00, 3.00, -2.00 }");
    expect(lua).toContain("ac.AudioEvent.fromFile");
    expect(lua).toMatch(/loop = true/);
    expect(lua).toContain("/extension/sfx/");
    // Every kind the build places has a file in the script.
    for (const k of Object.keys(SOUND_FILES)) expect(lua).toContain(`file = '${k}'`);
    expect(lua).toContain("script.frameBegin");
    // An empty list is still valid Lua.
    expect(soundLua([])).toContain("local EMITTERS = {  }");
  });

  it("loads the script from ext_config after the autotest one, with no bank, and no clashing sections", () => {
    const withTest = extConfig([], { autotest: true, sounds: emitters });
    expect(withTest).toContain("[SCRIPT_0]\r\nSCRIPT = autotest.lua");
    expect(withTest).toContain(`[SCRIPT_1]\r\nSCRIPT = ${SOUND_SCRIPT}`);
    expect(withTest).not.toContain("SOUNDBANK");
    expect(withTest).not.toContain("[EVENT_");
    const heads = withTest.match(/^\[[^\]]+\]/gm)!;
    expect(new Set(heads).size).toBe(heads.length);
    const alone = extConfig([], { sounds: emitters, soundMode: "lua" });
    expect(alone).toContain(`[SCRIPT_0]\r\nSCRIPT = ${SOUND_SCRIPT}`);
    expect(alone).not.toContain("autotest.lua");
    expect(extConfig([], { sounds: [] })).not.toContain(SOUND_SCRIPT);
  });

  it("README lists the files and CC0 Freesound searches for surf, magpie and kookaburra", () => {
    const readme = soundReadme(emitters);
    for (const f of ["surf.ogg", "magpie.ogg", "kookaburra.ogg"]) expect(readme).toContain(f);
    expect(readme).not.toContain("busselton.bank\r\n  extension"); // no bank to build
    expect(readme).toContain("CC0");
    const links = readme.match(/https:\/\/\S+/g)!;
    expect(links.length).toBeGreaterThanOrEqual(6);
    for (const l of links) {
      expect(l.startsWith("https://freesound.org/search/?q=")).toBe(true);
      expect(l).toContain("f=license:%22Creative+Commons+0%22");
    }
    for (const q of ["surf", "magpie", "kookaburra"]) expect(links.some((l) => l.includes(q))).toBe(true);
    expect(freesoundCc0("waves lapping beach")).toBe("https://freesound.org/search/?q=waves+lapping+beach&f=license:%22Creative+Commons+0%22");
    expect(readme).toContain("(1 emitters)");
  });
});
