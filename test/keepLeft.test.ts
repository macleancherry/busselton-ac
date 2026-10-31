import { describe, expect, it } from "vitest";
import { buildAiLine } from "../src/core/aiLine";
import { keepLeftOffsets, keepLeftShare, laneOffset, lateralPlace } from "../src/core/keepLeft";
import { withDefaults } from "../src/core/options";
import { planRoad, type RoadPlan } from "../src/core/road";
import type { Roundabout } from "../src/core/roundabout";

type Vec2 = [number, number];
const straight = (len: number, width: number): RoadPlan => {
  const pts: Vec2[] = [];
  for (let x = 0; x <= len; x += 10) pts.push([x, 0]);
  return planRoad(pts, withDefaults({ defaultWidth: width, banking: false }));
};
const mid = (plan: RoadPlan) => Math.floor(plan.samples.length / 2);

describe("keep left", () => {
  it("offsets a quarter of the road's width, and nothing on a one-lane street", () => {
    expect(laneOffset(7)).toBeCloseTo(1.75);
    expect(laneOffset(10)).toBeCloseTo(2.5);
    expect(laneOffset(4)).toBe(0);
    expect(laneOffset(5)).toBe(0);
    expect(laneOffset(5.5)).toBeGreaterThan(0);
    expect(laneOffset(5.5)).toBeLessThan(5.5 / 4);
    // Room for half a car and half a metre from the kerb.
    expect(laneOffset(6)).toBeLessThanOrEqual(6 / 2 - 1.4 + 1e-9);
  });

  it("puts the AI line in the left lane of a two-way street, off by default", () => {
    const plan = straight(400, 7);
    const i = mid(plan);
    // Driving east: left is north (local +y), AC z = -y.
    const centred = buildAiLine(plan);
    expect(Math.abs(centred[i].position[2])).toBeLessThan(0.01);
    expect(centred[i].sideLeft).toBeCloseTo(centred[i].sideRight);
    const left = buildAiLine(plan, { keepLeft: true });
    expect(-left[i].position[2]).toBeCloseTo(1.75, 1);
    // Room to the kerb on its left (the AI's usual floor of a metre), the whole road to its right.
    expect(left[i].sideLeft).toBeCloseTo(1, 1);
    expect(left[i].sideRight).toBeCloseTo(7 / 2 + 1.75 - 1, 1);
    // Driving west on the same road: the other side.
    const back = planRoad(plan.samples.map((s) => s.pos).reverse(), withDefaults({ defaultWidth: 7, banking: false }));
    expect(buildAiLine(back, { keepLeft: true })[mid(back)].position[2]).toBeCloseTo(1.75, 1);
  });

  it("stays centred on a narrow street", () => {
    const plan = straight(300, 4.5);
    const ai = buildAiLine(plan, { keepLeft: true });
    expect(Math.max(...ai.map((p) => Math.abs(p.position[2])))).toBeLessThan(0.01);
  });

  it("fades to the middle at a roundabout and back, with no step", () => {
    const plan = straight(600, 7);
    const rb = { c: [300, 0], r: 12, w: 7, lanes: 1, hc: 0, sIn: 288, sOut: 312, crossings: [] } as unknown as Roundabout;
    plan.roundabouts = [rb];
    const off = keepLeftOffsets(plan);
    const at = (x: number) => off[plan.samples.findIndex((s) => s.pos[0] >= x)];
    expect(at(300)).toBe(0);
    expect(at(290)).toBeLessThan(0.01);
    expect(at(100)).toBeCloseTo(1.75);
    expect(at(500)).toBeCloseTo(1.75);
    for (let k = 1; k < off.length; k++) expect(Math.abs(off[k] - off[k - 1])).toBeLessThan(0.35);
  });

  it("measures where a point sits across the road surface", () => {
    // A road 7 m wide along local x (y from -3.5 to 3.5), and a cross street at x 100.
    const height = (x: number, y: number) => (Math.abs(y) <= 3.5 || Math.abs(x - 100) <= 3.5 ? 0 : null);
    const east: [number, number, number] = [1, 0, 0];
    const p = lateralPlace([50, 0, -1.75], east, height)!;
    expect(p.left).toBeCloseTo(1.75, 0);
    expect(p.right).toBeCloseTo(5.25, 0);
    // At the junction the side street runs off past reach: can't tell.
    expect(lateralPlace([100, 0, -1.75], east, height)).toBeNull();
    expect(lateralPlace([50, 0, -10], east, height)).toBeNull();

    const line = (z: number) => Array.from({ length: 60 }, (_, k) => ({
      position: [k * 3, 0, z] as [number, number, number], forward: east, sideLeft: 0.75, sideRight: 4.25,
    }));
    const good = keepLeftShare(line(-1.75), height);
    expect(good.measured).toBeGreaterThan(50);
    expect(good.share).toBe(1);
    // The same line on the right half (wrong side of the road) fails.
    const bad = keepLeftShare(line(1.75), height);
    expect(bad.share).toBe(0);
    expect(bad.worst).not.toBeNull();
    // Centred points (equal room each side: roundabouts, narrow streets) aren't counted.
    expect(keepLeftShare(line(0).map((p) => ({ ...p, sideLeft: 2.5, sideRight: 2.5 })), height).measured).toBe(0);
  });

  it("an AI line built to keep left passes the check on its own road", () => {
    const plan = straight(400, 7);
    const ai = buildAiLine(plan, { keepLeft: true });
    const height = (x: number, y: number) => (Math.abs(y) <= 3.5 && x >= -5 && x <= 405 ? 0 : null);
    const k = keepLeftShare(ai, height);
    expect(k.measured).toBeGreaterThan(100);
    expect(k.share).toBeGreaterThan(0.95);
  });
});
