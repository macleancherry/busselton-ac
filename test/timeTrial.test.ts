import { describe, expect, it } from "vitest";
import { timeTrial, timeTrialIni } from "../src/core/timeTrial";
import { challengesIni } from "../src/core/challenges";
import { frameTransform, type Kn5GroupNode } from "../src/core/kn5";
import type { RoadPlan } from "../src/core/road";

// A straight 3 km road east, a sample every 2 m, 7 m wide, 3 m up.
const samples = Array.from({ length: 1501 }, (_, i) => ({ s: i * 2, pos: [i * 2, 0] as [number, number], h: 3, width: 7 }));
const open = { closed: false, samples, length: 3000 } as unknown as RoadPlan;

const dummy = (name: string, x: number, z: number): Kn5GroupNode =>
  ({ kind: "node", name, transform: frameTransform([x, 4, z], [1, 0, 0]), children: [] });
// AB lines at 100 m and 2900 m, 9 m across (AC z is south: the road's left is -z).
const ab = [
  dummy("AC_AB_START_L", 100, -4.5), dummy("AC_AB_START_R", 100, 4.5),
  dummy("AC_AB_FINISH_L", 2900, -4.5), dummy("AC_AB_FINISH_R", 2900, 4.5),
];

describe("point-to-point time trial", () => {
  it("starts and finishes on AC's AB lines, with splits evenly between", () => {
    const names = samples.map((_, i) => (i < 750 ? "Queen St" : "Kent St"));
    const tt = timeTrial(open, ab, names, { name: "Town to Beach", sectors: 3 })!;
    expect(tt).not.toBeNull();
    expect(tt.length).toBe(2800);
    expect(tt.start.pos).toEqual([100, 4, 0]);
    expect(tt.start.dir).toEqual([1, 0]);
    expect(tt.start.width).toBe(9);
    expect(tt.finish.pos[0]).toBe(2900);
    expect(tt.splits.length).toBe(2);
    expect(tt.splits[0].pos[0]).toBeCloseTo(100 + 2800 / 3, -1);
    expect(tt.splits[1].pos[0]).toBeCloseTo(100 + (2 * 2800) / 3, -1);
    expect(tt.splits[0].name).toBe("Split 1 (Queen St)");
    expect(tt.splits[1].name).toBe("Split 2 (Kent St)");
    expect(tt.splits[0].dir).toEqual([1, 0]);
    expect(tt.splits[0].width).toBe(9);
    const ini = timeTrialIni(tt);
    expect(ini).toContain("[TIME_TRIAL]\nNAME = Town to Beach");
    expect(ini).toContain("SPLITS = 2");
    expect(ini).toContain("[TT_START]\nNAME = Start\nPOSITION = 100, 4, 0\nDIRECTION = 1, 0\nWIDTH = 9");
    expect(ini).toContain("[TT_SPLIT_1]");
    expect(ini).toContain("[TT_FINISH]");
    // It rides along in challenges.ini.
    expect(challengesIni("T", [], { timeTrial: tt })).toContain("[TT_FINISH]");
  });

  it("follows the road's direction: north is -z in AC", () => {
    const north = Array.from({ length: 1001 }, (_, i) => ({ s: i * 2, pos: [0, i * 2] as [number, number], h: 0, width: 6 }));
    const plan = { closed: false, samples: north, length: 2000 } as unknown as RoadPlan;
    const d = (name: string, x: number, z: number): Kn5GroupNode => ({ kind: "node", name, transform: frameTransform([x, 1, z], [0, 0, -1]), children: [] });
    const tt = timeTrial(plan, [d("AC_AB_START_L", -4, -50), d("AC_AB_START_R", 4, -50), d("AC_AB_FINISH_L", -4, -1950), d("AC_AB_FINISH_R", 4, -1950)], [], { sectors: 2 })!;
    expect(tt.start.dir).toEqual([0, -1]);
    expect(tt.splits.length).toBe(1);
    expect(tt.splits[0].dir[1]).toBe(-1);
    expect(tt.splits[0].pos[2]).toBeCloseTo(-1000, -1);
  });

  it("has no splits on a short road, and no time trial on a loop or without AB lines", () => {
    const short = timeTrial(open, [
      dummy("AC_AB_START_L", 100, -4), dummy("AC_AB_START_R", 100, 4), dummy("AC_AB_FINISH_L", 500, -4), dummy("AC_AB_FINISH_R", 500, 4),
    ], [])!;
    expect(short.splits).toEqual([]);
    expect(timeTrial({ ...open, closed: true } as RoadPlan, ab)).toBeNull();
    expect(timeTrial(open, ab.slice(0, 2))).toBeNull();
  });
});
