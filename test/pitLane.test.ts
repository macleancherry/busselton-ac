import { describe, expect, it } from "vitest";
import { pitLaneFiles } from "../src/core/pitLane";
import { readFastLaneAi, writeFastLaneAi, type AiPoint } from "../src/core/aiSpline";

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

describe("pit lane files", () => {
  it("always ship the ideal line, and no pit lane without a lane of its own (never the racing line as one)", () => {
    const ai = circle();
    // Retest 6: a pit lane that was the racing line under the grid parked AI cars on the line.
    const files = pitLaneFiles("t/lay", ai, writeFastLaneAi(ai), true, null);
    expect(Object.keys(files)).toEqual(["t/lay/data/ideal_line.ai"]);
    expect(readFastLaneAi(files["t/lay/data/ideal_line.ai"])).toHaveLength(ai.length);
  });

  it("run a lane that leaves the line out past the boxes and back, as a valid AI file", () => {
    const ai = circle();
    // A lane 8 m outside the circle over a quarter of it, swinging out and back in.
    const R = 1000 / (2 * Math.PI);
    const pts: [number, number, number][] = [];
    for (let k = 0; k <= 60; k++) {
      const a = 0.2 + (k / 60) * (Math.PI / 2);
      const o = 8 * Math.min(1, k / 10, (60 - k) / 10);
      pts.push([(R + o) * Math.cos(a), 1, -(R + o) * Math.sin(a)]);
    }
    const files = pitLaneFiles("t/lay", ai, writeFastLaneAi(ai), true, { pts, widths: pts.map(() => 4) });
    const pit = readFastLaneAi(files["t/lay/ai/pit_lane.ai"]);
    expect(pit.length).toBeGreaterThan(pts.length);
    const off = Math.max(...pit.map((p) => Math.hypot(p.position[0], p.position[2]) - R));
    expect(off).toBeGreaterThan(7.5);
    for (let i = 1; i < pit.length; i++) expect(pit[i].distance).toBeGreaterThan(pit[i - 1].distance);
  });
});
