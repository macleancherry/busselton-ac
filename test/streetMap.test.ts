import { describe, expect, it } from "vitest";
import { streetMap } from "../src/core/acFiles";

describe("street map", () => {
  it("maps world X/Z onto the image the way map.ini does", () => {
    const m = streetMap([{ pts: [[0, 0], [400, 0]], width: 6 }, { pts: [[200, -300], [200, 300]], width: 6 }], [[0, 0], [400, 0]]);
    const v = Object.fromEntries(m.ini.split("\n").filter((l) => l.includes("=")).map((l) => l.split("=")).map(([k, x]) => [k, Number(x)]));
    const px = (x: number) => (x + v.X_OFFSET) / v.SCALE_FACTOR, pz = (z: number) => (z + v.Z_OFFSET) / v.SCALE_FACTOR;
    expect(px(0)).toBeCloseTo(v.MARGIN, 3);
    expect(pz(-300)).toBeCloseTo(v.MARGIN, 3);
    expect(px(400)).toBeLessThanOrEqual(v.WIDTH);
    expect(pz(300)).toBeLessThanOrEqual(v.HEIGHT);
    expect(m.png.length).toBeGreaterThan(100);
  });
});
