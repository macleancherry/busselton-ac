import { describe, expect, it } from "vitest";
import { footAlong } from "../src/core/lots";
import { SINK } from "../src/core/sceneGround";

describe("footAlong", () => {
  it("flat or evenly sloping ground needs only the ends", () => {
    const r = footAlong([0, 0], [2.4, 0], (x) => 1 + 0.05 * x);
    expect(r.pts).toEqual([[0, 0], [2.4, 0]]);
    expect(r.foot[0]).toBeCloseTo(1 - SINK);
  });
  it("keeps the points a bump needs, within a centimetre at every half-metre sample", () => {
    const g = (x: number) => (Math.abs(x - 1.2) < 0.3 ? 1.2 : 1);
    const r = footAlong([0, 0], [2.4, 0], g);
    expect(r.pts.length).toBeGreaterThan(2);
    for (let i = 0; i <= 5; i++) {
      const x = i * 0.48;
      const k = r.pts.findIndex((p) => p[0] >= x - 1e-9);
      if (r.pts[k][0] - x < 1e-9) continue;
      const [a, b] = [r.pts[k - 1], r.pts[k]];
      const z = r.foot[k - 1] + ((r.foot[k] - r.foot[k - 1]) * (x - a[0])) / (b[0] - a[0]);
      expect(Math.abs(z - (g(x) - SINK))).toBeLessThan(0.011);
    }
  });
});
