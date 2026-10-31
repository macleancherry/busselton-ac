import { describe, expect, it } from "vitest";
import { trackObjects } from "../src/core/track";
import { clearSamples, gridFront, junctionsOn, GRID_GAP, JUNCTION_CLEAR, RING_CLEAR } from "../src/core/gridSlots";
import { frames, resample } from "../src/core/polyline";
import { withDefaults } from "../src/core/options";
import type { RoadPlan } from "../src/core/road";
import type { Roundabout } from "../src/core/roundabout";
import type { Kn5GroupNode } from "../src/core/kn5";

type Vec2 = [number, number];

/**
 * A 600 x 300 m loop, anticlockwise from (0, 0) heading east, corners of radius 40 m, with a
 * roundabout (outer radius 14 m) on the closing straight 30 m before the start line, as the
 * Busselton town loop had it.
 */
function loopPlan(width = 7): { plan: RoadPlan; ring: { c: Vec2; rOut: number } } {
  const pts: Vec2[] = [];
  const W = 600, H = 300, R = 40;
  const arc = (cx: number, cy: number, a0: number) => {
    for (let k = 0; k <= 12; k++) { const a = a0 + (k / 12) * (Math.PI / 2); pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
  };
  pts.push([-W / 2 + R, 0]);
  pts.push([W / 2 - R, 0]); arc(W / 2 - R, R, -Math.PI / 2);
  pts.push([W / 2, H - R]); arc(W / 2 - R, H - R, 0);
  pts.push([-W / 2 + R, H]); arc(-W / 2 + R, H - R, Math.PI / 2);
  pts.push([-W / 2, R]); arc(-W / 2 + R, R, Math.PI);
  // Start the loop at x = 0 on the bottom straight.
  const dense = resample(pts, 2);
  const i0 = dense.reduce((b, p, i) => (Math.abs(p[0]) + Math.abs(p[1]) < Math.abs(dense[b][0]) + Math.abs(dense[b][1]) ? i : b), 0);
  const loop = [...dense.slice(i0), ...dense.slice(0, i0)].filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.5);
  const fr = frames(loop, true);
  const samples = fr.map((f) => ({ ...f, width, h: 0, bank: 0 }));
  const length = samples[samples.length - 1].s + Math.hypot(loop[0][0] - loop[loop.length - 1][0], loop[0][1] - loop[loop.length - 1][1]);
  const ring = { c: [-30, 0] as Vec2, rOut: 14 };
  const rb = { c: ring.c, r: 10, w: 8, lanes: 1, hc: 0, sIn: length - 44, sOut: length - 16 } as unknown as Roundabout;
  return { plan: { closed: true, samples, length, roundabouts: [rb] }, ring };
}

const pos = (d: Kn5GroupNode): Vec2 => [d.transform[12], -d.transform[14]];
const fwd = (d: Kn5GroupNode): Vec2 => [d.transform[8], -d.transform[10]];

describe("grid slots", () => {
  it("puts the grid on a straight clear of a roundabout and a junction, nose to tail, behind the line", () => {
    const { plan, ring } = loopPlan();
    const junction: Vec2 = [-120, 0];
    const opts = withDefaults({ name: "Grid", aiKeepLeft: true });
    const dummies = trackObjects(plan, opts, { junctions: [junction] });
    const starts = Array.from({ length: opts.pitCount }, (_, k) => dummies.find((d) => d.name === `AC_START_${k}`)!);
    const pits = Array.from({ length: opts.pitCount }, (_, k) => dummies.find((d) => d.name === `AC_PIT_${k}`)!);
    expect(starts.every(Boolean)).toBe(true);
    starts.forEach((d, k) => {
      const p = pos(d);
      // On the bottom straight (y = 0 give or take the lane offset), going east.
      expect(Math.abs(p[1])).toBeLessThan(3);
      expect(fwd(d)[0]).toBeGreaterThan(0.99);
      expect(Math.hypot(p[0] - ring.c[0], p[1] - ring.c[1])).toBeGreaterThan(ring.rOut + RING_CLEAR - 4);
      expect(Math.hypot(p[0] - junction[0], p[1] - junction[1])).toBeGreaterThan(JUNCTION_CLEAR - 4);
      // Behind the line (x = 0).
      expect(p[0]).toBeLessThan(0);
      // Nose to tail: 8 m behind the one in front, half a metre either side of the lane at most.
      if (k) expect(Math.abs(pos(starts[k - 1])[0] - p[0] - GRID_GAP)).toBeLessThan(0.5);
      expect(pos(pits[k])).toEqual(p);
    });
    // Between the junction and the roundabout there's no room for 8 cars: the grid is behind the junction.
    expect(pos(starts[0])[0]).toBeLessThan(junction[0]);
  });

  it("leaves a clear stretch before the line alone", () => {
    const { plan } = loopPlan();
    plan.roundabouts = [];
    expect(gridFront(plan, 8, 0)).toBe(-GRID_GAP);
  });

  it("keeps off corners", () => {
    const { plan } = loopPlan();
    const ok = clearSamples(plan);
    plan.samples.forEach((s, i) => { if (Math.abs(s.curvature) > 1 / 50) expect(ok[i]).toBe(false); });
    // No straight takes 70 cars nose to tail.
    expect(gridFront(plan, 70, 0)).toBeNull();
  });

  it("puts a wide circuit's grid in two columns", () => {
    const { plan } = loopPlan(12);
    plan.roundabouts = [];
    const dummies = trackObjects(plan, withDefaults({ name: "Wide" }));
    const a = pos(dummies.find((d) => d.name === "AC_START_0")!), b = pos(dummies.find((d) => d.name === "AC_START_1")!);
    expect(Math.abs(a[0] - b[0])).toBeLessThan(0.5);
    expect(Math.abs(a[1] - b[1])).toBeCloseTo(6, 0);
  });

  it("finds streets that meet or cross a road, not ones along it", () => {
    const road: Vec2[] = [[0, 0], [200, 0]];
    const js = junctionsOn(road, [
      [[50, 0], [50, 80]], // a side street
      [[120, -60], [120, 60]], // a crossing street
      [[0, 1], [200, 1]], // the road's own line
      [[60, 30], [160, 30]], // a parallel street
    ]);
    expect(js.some((j) => Math.abs(j[0] - 50) <= 5 && Math.abs(j[1]) <= 5)).toBe(true);
    expect(js.some((j) => Math.abs(j[0] - 120) <= 5 && Math.abs(j[1]) <= 5)).toBe(true);
    expect(js.every((j) => Math.abs(j[0] - 50) <= 5 || Math.abs(j[0] - 120) <= 5)).toBe(true);
  });
});
