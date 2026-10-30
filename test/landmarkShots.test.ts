import { describe, expect, it } from "vitest";
import { landmarkShots } from "../src/core/landmarkShots";
import type { AiPoint } from "../src/core/aiSpline";

const pt = (x: number, i: number): AiPoint => ({
  position: [x, 0, 0], distance: i * 2, speed: 10, gas: 1, brake: 0, radius: 1000, sideLeft: 3, sideRight: 3,
  camber: 0, direction: 1, normal: [0, 1, 0], length: 2, forward: [1, 0, 0], grade: 0,
});

describe("landmark screenshots", () => {
  // A 400 m straight east along y = 0 (AC z = 0).
  const ai = Array.from({ length: 200 }, (_, i) => pt(i * 2, i));
  it("shoots 30 m before the closest point, and skips what's far off", () => {
    const s = landmarkShots(ai, [{ name: "Rocky Ridge Brewing Co", at: [200, 20] }, { name: "far", at: [200, 300] }]);
    expect(s).toEqual([`${(170 / 400).toFixed(4)}:rocky_ridge_brewing_co`]);
  });
});
