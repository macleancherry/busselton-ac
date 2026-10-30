import { describe, expect, it } from "vitest";
import { challengeFiles, layoutChallengesIni } from "../src/core/challengeFiles";
import { frameTransform, type Kn5GroupNode } from "../src/core/kn5";
import { withDefaults } from "../src/core/options";
import type { RoadPlan } from "../src/core/road";
import type { Vec2 } from "../src/core/geo";

const samples = Array.from({ length: 1501 }, (_, i) => ({ s: i * 2, pos: [i * 2, 0] as [number, number], h: 3, width: 7 }));
const plan = { closed: false, samples, length: 3000 } as unknown as RoadPlan;
const nearest = (x: number, y: number, r: number) => {
  const seg = Math.max(0, Math.min(1500, Math.round(x / 2)));
  const d = Math.hypot(x - seg * 2, y);
  return d <= r ? { seg, dist: d } : null;
};
const dummy = (name: string, x: number, z: number): Kn5GroupNode =>
  ({ kind: "node", name, transform: frameTransform([x, 4, z], [1, 0, 0]), children: [] });
const dummies = [
  dummy("AC_AB_START_L", 100, -4.5), dummy("AC_AB_START_R", 100, 4.5),
  dummy("AC_AB_FINISH_L", 2900, -4.5), dummy("AC_AB_FINISH_R", 2900, 4.5),
];
// A car park 40 to 72 m north of the road: three aisles.
const aisles = [40, 56, 72].map((y) => ({ pts: [[1000, y], [1090, y]] as Vec2[], width: 4, service: "parking_aisle" }));
const ctx = {
  plan, dummies, nearest, toLocal: ([lng, lat]: [number, number]): Vec2 => [lng * 1000, lat * 1000], ground: () => 3,
  pois: [{ at: [1500, 10] as Vec2, cls: "attraction", name: "The Jetty" }], routeNames: samples.map(() => "Queen St"), junctions: [],
  streets: [...aisles, { pts: [[0, 0], [3000, 0]] as Vec2[], width: 7, name: "Queen St" }], parked: [], buildings: [],
};
const text = (f: Record<string, Uint8Array>, k: string) => new TextDecoder().decode(f[k]);

describe("challenge files", () => {
  it("writes generated checkpoints, the time trial and the drift spots", () => {
    const files = challengeFiles("t", withDefaults({ name: "Test" }), ctx);
    const ini = text(files, "t/data/challenges.ini");
    expect(ini).toContain("SET_NAME = Checkpoints");
    expect(ini).toContain("NAME = The Jetty");
    expect(ini).toContain("[TT_SPLIT_1]");
    const drift = text(files, "t/extension/drift_zones.ini");
    expect(drift).toContain("COUNT = 1");
    expect(drift).toContain("NAME = Car park off Queen St");
  });

  it("uses the route's hand-picked checkpoints, and drift spots can be turned off", () => {
    const files = challengeFiles("t", withDefaults({ name: "Test", challenges: [[0.5, 0], [2.2, 0]], driftZones: false, timeTrialSectors: 4 }), ctx);
    const ini = text(files, "t/data/challenges.ini");
    expect(ini).toContain("SET_NAME = Hand-picked");
    expect(ini).toContain("COUNT = 2");
    expect(ini).toContain("NAME = Get to Queen St");
    expect(ini).not.toContain("The Jetty");
    expect(ini).toContain("SPLITS = 3");
    expect(files["t/extension/drift_zones.ini"]).toBeUndefined();
  });

  it("gives a layout its hand-picked sets and time trial, or nothing", () => {
    const toLocal = ctx.toLocal;
    expect(layoutChallengesIni("Loop", { plan: { ...plan, closed: true } as RoadPlan, dummies }, toLocal, () => 0)).toBeNull();
    expect(layoutChallengesIni("Free", null, toLocal, () => 0)).toBeNull();
    const tt = layoutChallengesIni("A to B", { plan, dummies }, toLocal, () => 0)!;
    expect(tt).toContain("COUNT = 0");
    expect(tt).toContain("[TIME_TRIAL]\nNAME = A to B");
    const free = layoutChallengesIni("Free", null, toLocal, () => 1, [{ name: "Car parks", points: [[1, 1], [2, 2]] }])!;
    expect(free).toContain("SET_NAME = Car parks");
    expect(free).toContain("POSITION = 2000, 1, -2000");
  });
});
