import { describe, expect, it } from "vitest";
import type { Vec2 } from "../src/core/geo";
import { buildAiLine, AI_MIN_RADIUS } from "../src/core/aiLine";
import { easeFolds } from "../src/core/offsetFold";
import { withDefaults } from "../src/core/options";
import { frames } from "../src/core/polyline";
import { planRoad } from "../src/core/road";
import { applyTrace, TRACE_MIN_RADIUS } from "../src/core/trace";

/** West 100 m, a left turn onto south round a `r` m arc, then south 100 m; points every 2 m. */
function corner(r: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let x = 100; x > 0; x -= 2) pts.push([x, r]);
  const steps = Math.max(2, Math.round((Math.PI / 2) * r / 2));
  for (let k = 0; k <= steps; k++) {
    const a = Math.PI / 2 + (k / steps) * (Math.PI / 2);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  for (let y = -2; y > -100; y -= 2) pts.push([-r, y]);
  return pts;
}

const minRadius = (pts: Vec2[]) => Math.min(...frames(pts, false).map((f) => (Math.abs(f.curvature) > 1e-9 ? 1 / Math.abs(f.curvature) : Infinity)));
const leftOf = (pts: Vec2[]) => frames(pts, false).map((f) => f.left);
const move = (pts: Vec2[], off: number[]) => { const l = leftOf(pts); return pts.map((p, i): Vec2 => [p[0] + l[i][0] * off[i], p[1] + l[i][1] * off[i]]); };

describe("easeFolds", () => {
  it("takes back an offset into a tight bend that would fold the line", () => {
    const base = corner(5);
    const off = base.map(() => 4); // left: the inside of this left turn, nearly the radius
    expect(minRadius(move(base, off))).toBeLessThan(2);
    const eased = easeFolds(base, leftOf(base), off, () => 2, false);
    expect(minRadius(move(base, eased))).toBeGreaterThanOrEqual(2 * 0.999);
    // Only round the bend: the straights keep the whole offset.
    expect(eased[0]).toBe(4);
    expect(eased[eased.length - 1]).toBe(4);
  });

  it("leaves offsets that fold nothing exactly as they were", () => {
    const base = corner(30);
    const inward = base.map(() => 2), outward = base.map(() => -3);
    expect(easeFolds(base, leftOf(base), inward, () => 2, false)).toEqual(inward);
    expect(easeFolds(base, leftOf(base), outward, () => 2, false)).toEqual(outward);
  });

  it("keeps fixed points' offsets", () => {
    const base = corner(5);
    const off = base.map(() => 4);
    const eased = easeFolds(base, leftOf(base), off, () => 2, false, (i) => i === 52);
    expect(eased[52]).toBe(4);
  });
});

describe("folds in the build", () => {
  it("applyTrace doesn't fold the centreline into a tight junction bend (Caves Road at Yallingup)", () => {
    const opts = withDefaults({ spacing: 2, lineSmoothing: 4 });
    const plan = planRoad(corner(6), opts);
    const n = plan.samples.length;
    // A trace that pulls the line 5.5 m into the bend all along (without the easing: a 1.4 m corner).
    applyTrace(plan, { offset: new Array(n).fill(5.5), width: new Array(n).fill(NaN), conf: new Array(n).fill(1), coverage: 1 }, () => false);
    expect(minRadius(plan.samples.map((s) => s.pos))).toBeGreaterThanOrEqual(TRACE_MIN_RADIUS * 0.999);
  });

  it("the keep-left AI line doesn't turn back on itself in a tight left turn", () => {
    const opts = withDefaults({ spacing: 2, lineSmoothing: 0.5 });
    const plan = planRoad(corner(1.5), opts);
    for (const s of plan.samples) s.width = 8;
    const ai = buildAiLine(plan, { keepLeft: true });
    const pts = ai.map((p): Vec2 => [p.position[0], -p.position[2]]);
    expect(minRadius(pts)).toBeGreaterThanOrEqual(AI_MIN_RADIUS * 0.999);
    for (let i = 1; i + 1 < pts.length; i++) {
      const u = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]], v = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
      expect(u[0] * v[0] + u[1] * v[1]).toBeGreaterThan(0);
    }
  });
});
