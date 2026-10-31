import { describe, expect, it } from "vitest";
import { pitBoxes, pitLaneAi, pitLaneFiles, PIT_AFTER, PIT_BEFORE } from "../src/core/pitLane";
import { readFastLaneAi, writeFastLaneAi, type AiPoint } from "../src/core/aiSpline";
import { frameTransform, type Kn5GroupNode } from "../src/core/kn5";

/** A 1 km loop as a circle (radius about 159 m), 2 m apart, anticlockwise seen from above. */
function circle(): AiPoint[] {
  const n = 500, R = 1000 / (2 * Math.PI);
  return Array.from({ length: n }, (_, i): AiPoint => {
    const a = (i / n) * 2 * Math.PI;
    return {
      position: [R * Math.cos(a), 1, -R * Math.sin(a)], distance: i * 2, speed: 14, gas: 1, brake: 0, radius: R,
      sideLeft: 3, sideRight: 3, camber: 0, direction: 1, normal: [0, 1, 0], length: 2,
      forward: [-Math.sin(a), 0, -Math.cos(a)], grade: 0,
    };
  });
}

const box = (k: number, p: AiPoint): Kn5GroupNode => ({ kind: "node", name: `AC_PIT_${k}`, transform: frameTransform(p.position, p.forward), children: [] });

describe("pit lane", () => {
  it("runs along the AI line past the grid's boxes, across the start line, as a valid AI file", () => {
    const ai = circle();
    // 8 boxes 8 m apart, the front one 8 m before the line (point 0).
    const dummies = Array.from({ length: 8 }, (_, k) => box(k, ai[ai.length - 4 - k * 4]));
    dummies.push({ kind: "node", name: "AC_START_0", transform: frameTransform([999, 0, 999], [1, 0, 0]), children: [] });
    expect(pitBoxes(dummies)).toHaveLength(8);
    const pit = pitLaneAi(ai, pitBoxes(dummies), true)!;
    expect(pit).not.toBeNull();
    // From 40 m before the back box to 60 m after the front one: 56 + 40 + 60 m.
    const span = pit[pit.length - 1].distance;
    expect(span).toBeGreaterThanOrEqual(56 + PIT_BEFORE + PIT_AFTER - 2);
    expect(span).toBeLessThanOrEqual(56 + PIT_BEFORE + PIT_AFTER + 2);
    expect(pit[0].distance).toBe(0);
    for (let i = 1; i < pit.length; i++) expect(pit[i].distance - pit[i - 1].distance).toBeCloseTo(2, 5);
    expect(pit[pit.length - 1].length).toBe(0);
    // Every box is on it.
    for (const b of pitBoxes(dummies)) expect(Math.min(...pit.map((p) => Math.hypot(p.position[0] - b[0], p.position[2] - b[2])))).toBeLessThan(0.01);
    // It reads back as a version 7 AI line with its grid.
    const files = pitLaneFiles("t/lay", ai, writeFastLaneAi(ai), dummies, true);
    const back = readFastLaneAi(files["t/lay/ai/pit_lane.ai"]);
    expect(back).toHaveLength(pit.length);
    expect(back[0].position[0]).toBeCloseTo(pit[0].position[0], 3);
    expect(readFastLaneAi(files["t/lay/data/ideal_line.ai"])).toHaveLength(ai.length);
  });

  it("on free roam runs past the first AI box's group, not round the whole lap", () => {
    const ai = circle();
    // The player's box in a car park, then boxes spread 200 m apart round the line.
    const off: Kn5GroupNode = { kind: "node", name: "AC_PIT_0", transform: frameTransform([500, 1, 500], [1, 0, 0]), children: [] };
    const dummies = [off, ...[50, 150, 250, 350, 450].map((i, k) => box(k + 1, ai[i]))];
    const pit = pitLaneAi(ai, pitBoxes(dummies), true)!;
    expect(pit[pit.length - 1].distance).toBeLessThanOrEqual(PIT_BEFORE + PIT_AFTER + 2);
    const b = pitBoxes(dummies)[1];
    expect(Math.min(...pit.map((p) => Math.hypot(p.position[0] - b[0], p.position[2] - b[2])))).toBeLessThan(0.01);
  });

  it("finds the pit lane on a loop of any length (retest 4: none on foreshore, sights, Collie)", () => {
    // Lap lengths that aren't round in binary: wrapping 0 round them gave -4.5e-13, not 0.
    for (const step of [2, 1.9837, 2.0091, 1.99713, 2.13377]) {
      const ai = circle().map((p, i) => ({ ...p, distance: i * step, length: step }));
      const dummies = Array.from({ length: 7 }, (_, k) => box(k, ai[ai.length - 30 - k * 4]));
      const pit = pitLaneAi(ai, pitBoxes(dummies), true);
      expect(pit, `step ${step}`).not.toBeNull();
      expect(pit!.length).toBeGreaterThan(50);
    }
  });

  it("stays inside a point to point line, and gives none with no box on the line", () => {
    const ai = circle().slice(0, 300);
    ai[ai.length - 1] = { ...ai[ai.length - 1], length: 0 };
    const pit = pitLaneAi(ai, [ai[10].position], false)!;
    expect(pit[0].position).toEqual(ai[0].position);
    expect(pit[pit.length - 1].distance).toBeCloseTo(20 + PIT_AFTER, 0);
    expect(pitLaneAi(ai, [[500, 0, 500]], false)).toBeNull();
    expect(Object.keys(pitLaneFiles("x", ai, new Uint8Array(1), [], false))).toEqual(["x/data/ideal_line.ai"]);
  });
});
