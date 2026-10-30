import { describe, expect, it } from "vitest";
import { bearingDir, clusterViews, lensFor, parseView, streetSpot, type View } from "../scripts/blender/renderPlan";

describe("render_track views", () => {
  it("parses the view forms", () => {
    expect(parseView("landmarks")).toEqual({ kind: "landmarks" });
    expect(parseView("aerial")).toMatchObject({ kind: "aerial", at: undefined });
    expect(parseView("aerial:115.34,-33.64@200")).toMatchObject({ kind: "aerial", at: [115.34, -33.64], height: 200 });
    expect(parseView("jetty=115.34,-33.64->115.35,-33.63")).toEqual({ kind: "custom", name: "jetty", from: [115.34, -33.64], to: [115.35, -33.63], height: 1.6 });
    expect(parseView("115.34,-33.64->115.35,-33.63@40")).toMatchObject({ height: 40 });
    expect(parseView("a=115.34,-33.64->115.35,-33.63@0.8/0.3~50")).toEqual({ kind: "custom", name: "a", from: [115.34, -33.64], to: [115.35, -33.63], height: 0.8, targetHeight: 0.3, lens: 50 });
    expect(parseView("115.34,-33.64->115.35,-33.63@6~35")).toEqual({ kind: "custom", from: [115.34, -33.64], to: [115.35, -33.63], height: 6, lens: 35, name: undefined });
    expect(() => parseView("somewhere")).toThrow();
  });

  it("stands on the road in front, not behind or in the yard", () => {
    // A road running east-west 30 m north of the landmark, and another 20 m south of it.
    const onRoad = (_x: number, y: number) => (Math.abs(y - 30) < 4 || Math.abs(y + 20) < 4 ? 1.2 : null);
    const spot = streetSpot([0, 0], bearingDir(0), 10, onRoad)!;
    expect(spot.at[1]).toBeGreaterThan(26);
    expect(spot.at[1]).toBeLessThan(34);
    expect(Math.abs(spot.at[0])).toBeLessThan(1);
    expect(spot.at[2]).toBe(1.2);
    // Facing south, the south road.
    expect(streetSpot([0, 0], bearingDir(180), 10, onRoad)!.at[1]).toBeLessThan(-16);
    // No road in front: nothing.
    expect(streetSpot([0, 0], bearingDir(90), 10, () => null)).toBeNull();
  });

  it("takes a centreline point straight ahead when it's as close", () => {
    const spot = streetSpot([0, 0], bearingDir(90), 8, () => null, [[25, 1, 2], [40, 0, 2], [-25, 0, 2]])!;
    expect(spot.at).toEqual([25, 1, 2]);
  });

  it("fits the lens to the subject", () => {
    expect(lensFor(20, 20)).toBeGreaterThan(lensFor(40, 20));
    expect(lensFor(1, 100)).toBe(50);
    expect(lensFor(200, 5)).toBe(14);
  });

  it("groups nearby street views and keeps aerials apart", () => {
    const v = (name: string, t: [number, number], kind: View["kind"] = "street", h = 1.6): View => ({ name, kind, eye: [t[0], t[1] + 30, h], target: [t[0], t[1], 0], lens: 24 });
    const groups = clusterViews([v("a", [0, 0]), v("b", [50, 0]), v("c", [500, 0]), v("air", [0, 0], "aerial", 120)]);
    expect(groups.map((g) => g.views.map((x) => x.name))).toEqual([["a", "b"], ["c"], ["air"]]);
    expect(groups[0].radius).toBeGreaterThan(150);
    expect(groups[2].radius).toBeGreaterThan(260);
  });
});
