import { describe, expect, it } from "vitest";
import { challengeCheckpoints, challengesIni } from "../src/core/challenges";
import type { RoadPlan } from "../src/core/road";

// A straight 3 km road east, a sample every 2 m.
const samples = Array.from({ length: 1501 }, (_, i) => ({ s: i * 2, pos: [i * 2, 0] as [number, number], h: 3 }));
const plan = { samples } as unknown as RoadPlan;
const nearest = (x: number, y: number, r: number) => {
  const seg = Math.max(0, Math.min(1500, Math.round(x / 2)));
  const d = Math.hypot(x - seg * 2, y);
  return d <= r ? { seg, dist: d } : null;
};

describe("checkpoint challenges", () => {
  it("picks named places by the road, in driving order, spread out, and fills with streets", () => {
    const pois = [
      { at: [2000, 20] as [number, number], cls: "attraction", name: "The Jetty" },
      { at: [2050, 10] as [number, number], cls: "cafe", name: "Too Close Cafe" },
      { at: [800, 15] as [number, number], cls: "park", name: "Victoria Square" },
      { at: [1200, 300] as [number, number], cls: "attraction", name: "Too Far Away" },
    ];
    const names = samples.map(() => "Queen St");
    const cps = challengeCheckpoints(plan, nearest, pois, names, 5);
    expect(cps.length).toBe(5);
    const named = cps.map((c) => c.name);
    expect(named).toContain("The Jetty");
    expect(named).toContain("Victoria Square");
    expect(named).not.toContain("Too Far Away");
    expect(named).not.toContain("Too Close Cafe");
    expect(named.filter((n) => n === "Get to Queen St").length).toBe(3);
    for (let k = 1; k < cps.length; k++) expect(cps[k].s - cps[k - 1].s).toBeGreaterThanOrEqual(250);
    // AC coordinates: z is south.
    const jetty = cps.find((c) => c.name === "The Jetty")!;
    expect(jetty.pos[0]).toBe(2000);
    expect(jetty.pos[1]).toBe(3);
    expect(Math.abs(jetty.pos[2])).toBe(0);
    const ini = challengesIni("Test", cps);
    expect(ini).toContain("COUNT = 5");
    expect(ini).toContain("NAME = The Jetty");
  });

  it("gives a short track none", () => {
    expect(challengeCheckpoints({ samples: samples.slice(0, 200) } as unknown as RoadPlan, nearest, [], [], 5)).toEqual([]);
  });
});
