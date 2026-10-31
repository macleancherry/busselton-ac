import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Busselton Challenges app (apps/lua/BusseltonChallenges). No Lua runtime here, so these read the source.
const src = readFileSync(new URL("../apps/lua/BusseltonChallenges/BusseltonChallenges.lua", import.meta.url), "utf8");
const code = src.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("Busselton Challenges markers", () => {
  it("never draws CSP debug gizmos (the column of wireframe spheres over the road)", () => {
    expect(code).not.toMatch(/render\.debug(Sphere|Cross|Point|Arrow|Line|Text)/);
  });

  it("draws markers only while the window is open or a run is on", () => {
    const draw = code.slice(code.indexOf("function script.draw3D()"));
    expect(draw.split("\n")[1]).toMatch(/if not \(running or ttRunning or now - windowSeen < 2\) then return end/);
    expect(code).toMatch(/function script\.windowMain\(dt\)\n\s+windowSeen = now/);
  });
});
