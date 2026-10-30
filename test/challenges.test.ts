import { describe, expect, it } from "vitest";
import { challengeCheckpoints, challengesIni, handPickedSets, pickSets } from "../src/core/challenges";
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
    // The street once, then numbered: every checkpoint has its own name.
    expect(named.filter((n) => n === "Get to Queen St").length).toBe(1);
    expect(new Set(named).size).toBe(named.length);
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

  it("names fill-ins after the side street at the corner", () => {
    const cps = challengeCheckpoints(plan, nearest, [], samples.map(() => "Queen St"), 3, [{ s: 1500, name: "Kent St" }]);
    expect(cps.map((c) => c.name)).toContain("Corner of Kent St");
  });

  it("reads hand-picked checkpoints from the route option, in the order given", () => {
    const toLocal = ([lng, lat]: [number, number]): [number, number] => [lng * 1000, lat * 1000];
    const street = (x: number) => (x < 1000 ? "Queen St" : undefined);
    const one = handPickedSets([[0.5, 0], { at: [2, 0.01], name: "The Jetty" }, [0.1, 0], [3, 0], ["bad", 1] as never], toLocal, () => 4, street);
    expect(one.length).toBe(1);
    expect(one[0].name).toBe("Hand-picked");
    expect(one[0].points.map((p) => p.name)).toEqual(["Get to Queen St", "The Jetty", "Checkpoint 3", "Checkpoint 4"]);
    expect(one[0].points[1].pos).toEqual([2000, 4, -10]);
    const many = handPickedSets([
      { name: "Jetty run", points: [[1, 0], [2, 0]] },
      { points: [{ at: [3, 0], name: "Beach" }] },
      { name: "Empty", points: [] },
    ], toLocal, () => 0);
    expect(many.map((s) => s.name)).toEqual(["Jetty run", "Challenge 2"]);
    expect(handPickedSets(undefined, toLocal, () => 0)).toEqual([]);
    expect(handPickedSets([], toLocal, () => 0)).toEqual([]);
  });

  it("uses the hand-picked sets in place of the generated ones, and writes every set", () => {
    const gen = () => [{ name: "Generated", s: 0, pos: [0, 0, 0] as [number, number, number] }];
    expect(pickSets([], gen)).toEqual({ points: gen(), setName: "Checkpoints", sets: [] });
    const sets = [
      { name: "A", points: [{ name: "One", s: 0, pos: [1, 2, 3] as [number, number, number] }] },
      { name: "B", points: [{ name: "Two", s: 0, pos: [4, 5, 6] as [number, number, number] }, { name: "Three", s: 1, pos: [7, 8, 9] as [number, number, number] }] },
    ];
    const picked = pickSets(sets, gen);
    expect(picked.points[0].name).toBe("One");
    const ini = challengesIni("Town", picked.points, picked);
    expect(ini).toContain("COUNT = 1\nRADIUS = 14\nSET_NAME = A\nSETS = 2");
    expect(ini).toContain("[CHECKPOINT_0]\nNAME = One\nPOSITION = 1, 2, 3");
    expect(ini).toContain("[SET_1]\nNAME = B\nCOUNT = 2");
    expect(ini).toContain("[SET_1_CHECKPOINT_1]\nNAME = Three\nPOSITION = 7, 8, 9");
    expect(ini).not.toContain("TIME_TRIAL");
  });

  it("gives a short track none", () => {
    expect(challengeCheckpoints({ samples: samples.slice(0, 200) } as unknown as RoadPlan, nearest, [], [], 5)).toEqual([]);
  });
});
