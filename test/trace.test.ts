import { describe, expect, it } from "vitest";
import type { Vec2 } from "../src/core/geo";
import { withDefaults } from "../src/core/options";
import { planRoad, type RoadPlan } from "../src/core/road";
import type { Roundabout } from "../src/core/roundabout";
import { traceSideStreets, type SideStreet } from "../src/core/sideStreets";
import { applyTrace, displayOf, traceRoad, type RasterSampler } from "../src/core/trace";

type RGB = [number, number, number];
const GREY: RGB = [0.38, 0.38, 0.4];
const GRASS: RGB = [0.33, 0.45, 0.2];
const CANOPY: RGB = [0.12, 0.3, 0.1];
const CAR: RGB = [0.75, 0.1, 0.1];
const PAINT: RGB = [0.85, 0.85, 0.83];

/** Deterministic brightness noise, ±0.02, added to all three channels. */
function noise(x: number, y: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (v - Math.floor(v) - 0.5) * 0.04;
}
const grey = (x: number, y: number, k = 1): RGB => GREY.map((c) => (c + noise(x, y)) * k) as RGB;

/** OSM line on y = 0; the real 9 m road centred at y = 1.5, with canopy, a car, a dashed line and a shadow. */
const photo: RasterSampler = (x, y) => {
  const t = y - 1.5;
  if (x > 50 && x < 150 && Math.abs(y) < 30) return CANOPY;
  if (Math.abs(t) >= 4.5) return GRASS;
  if (x > -102 && x < -98 && y > 0.5 && y < 2.3) return CAR;
  if (Math.abs(t) < 0.06 && ((x % 12) + 12) % 12 < 3) return PAINT;
  return grey(x, y, x > -200 && x < -170 ? 0.6 : 1);
};

const line = (x0: number, x1: number, step = 20): Vec2[] => {
  const out: Vec2[] = [];
  for (let x = x0; x <= x1; x += step) out.push([x, 0]);
  return out;
};
const plan6 = (spacing = 2) => planRoad(line(-300, 300), withDefaults({ widthOverride: 6, banking: false, spacing }));
const at = (plan: RoadPlan, x: number) => {
  let best = 0;
  plan.samples.forEach((s, i) => {
    if (Math.abs(s.pos[0] - x) < Math.abs(plan.samples[best].pos[0] - x)) best = i;
  });
  return best;
};

describe("traceRoad", () => {
  const plan = plan6();
  const tr = traceRoad(plan, photo);

  it("finds the real road's line and width through shadow, a car and a dashed line", () => {
    expect(tr.coverage).toBeGreaterThan(0.6);
    for (const x of [-250, -185, -100, 0, 250]) {
      const i = at(plan, x);
      expect(tr.offset[i], `offset at ${x}`).toBeCloseTo(1.5, 0);
      expect(tr.width[i], `width at ${x}`).toBeGreaterThan(8.3);
      expect(tr.width[i], `width at ${x}`).toBeLessThan(9.7);
    }
  });

  it("fades back to the OSM line under tree canopy", () => {
    const i = at(plan, 100);
    expect(tr.conf[i]).toBeLessThan(0.2);
    expect(Math.abs(tr.offset[i])).toBeLessThan(0.4);
  });

  it("limits how fast the offset changes", () => {
    const spacing = plan.samples[1].s - plan.samples[0].s;
    for (let i = 1; i < tr.offset.length; i++) expect(Math.abs(tr.offset[i] - tr.offset[i - 1])).toBeLessThanOrEqual(0.06 * spacing + 1e-9);
  });

  it("doesn't mutate the plan", () => {
    const fresh = plan6();
    expect(plan.samples.map((s) => s.pos)).toEqual(fresh.samples.map((s) => s.pos));
  });

  it("gives the same offsets at 1 m spacing as at 2 m (bug 3)", () => {
    const fine = plan6(1);
    const tf = traceRoad(fine, photo);
    for (const x of [-250, -185, -100, 0, 250]) expect(Math.abs(tf.offset[at(fine, x)] - tr.offset[at(plan, x)]), `x ${x}`).toBeLessThan(0.1);
  });
});

describe("applyTrace", () => {
  it("moves the line and widths onto the trace", () => {
    const plan = plan6();
    const n = plan.samples.length;
    const tr = traceRoad(plan, photo);
    applyTrace(plan, tr, () => false);
    expect(plan.samples.length).toBe(n);
    const a = plan.samples[at(plan, -250)];
    expect(a.pos[1]).toBeCloseTo(1.5, 0);
    expect(a.width).toBeCloseTo(9, 0);
    expect(plan.samples[at(plan, 100)].width).toBeLessThan(6.6);
    for (let i = 1; i < n; i++) expect(plan.samples[i].s).toBeGreaterThan(plan.samples[i - 1].s);
    expect(plan.length).toBe(plan.samples[n - 1].s);
  });

  it("moves a roundabout's sIn to the new s of the sample nearest its old sIn (bug 5)", () => {
    const plan = plan6();
    const oldS = plan.samples.map((s) => s.s);
    const rb: Roundabout = { c: [0, 0], r: 10, w: 8, lanes: 1, hc: 0, sIn: oldS[40] + 0.3, sOut: oldS[60] - 0.4, crossings: [] };
    plan.roundabouts = [rb];
    applyTrace(plan, traceRoad(plan, photo), () => false);
    expect(rb.sIn).toBe(plan.samples[40].s);
    expect(rb.sOut).toBe(plan.samples[60].s);
  });

  it("leaves ring samples where they were", () => {
    const plan = plan6();
    const before = plan.samples[150].pos;
    applyTrace(plan, traceRoad(plan, photo), (i) => i === 150);
    expect(plan.samples[150].pos).toEqual(before);
  });

  it("does nothing to an empty plan (bug 6)", () => {
    const empty: RoadPlan = { closed: false, samples: [], length: 0, roundabouts: [] };
    expect(() => applyTrace(empty, { offset: [], width: [], conf: [], coverage: 0 }, () => false)).not.toThrow();
  });
});

describe("main street beside roofs", () => {
  // 8 m road on y = 0; its grey carries on to y = 9.5 (parking bays), then slightly lighter grey awnings to y = 40.
  const main: RasterSampler = (x, y) => {
    if (y > -4 && y < 9.5) return grey(x, y);
    if (y >= 9.5 && y < 40) return [0.46, 0.46, 0.48];
    return GRASS;
  };
  const plan = planRoad(line(-200, 200), withDefaults({ widthOverride: 8, banking: false }));

  it("stays on the OSM line when guarded", () => {
    const tr = traceRoad(plan, main);
    for (const o of tr.offset) expect(Math.abs(o)).toBeLessThan(1);
  });

  it("is pulled north unguarded (what the guard is for)", () => {
    const tr = traceRoad(plan, main, undefined, false);
    expect(tr.offset[at(plan, 0)]).toBeGreaterThan(1);
  });
});

describe("edge cases", () => {
  it("traces nothing with no imagery", () => {
    const plan = plan6();
    const tr = traceRoad(plan, () => null);
    expect(tr.coverage).toBe(0);
    expect(tr.offset.every((o) => o === 0)).toBe(true);
    expect(tr.width.every((w) => Number.isNaN(w))).toBe(true);
    expect(tr.conf.every((c) => c === 0)).toBe(true);
  });

  it("handles no samples", () => {
    expect(traceRoad({ samples: [], closed: false }, photo)).toEqual({ offset: [], width: [], conf: [], coverage: 0 });
  });

  it("doesn't trust a stretch visible for only 8 samples", () => {
    const plan = plan6();
    const xs = plan.samples.map((s) => s.pos[0]);
    const lo = xs[100], hi = xs[107];
    const r: RasterSampler = (x, y) => (x >= lo - 0.5 && x <= hi + 0.5 ? (Math.abs(y) < 4.5 ? grey(x, y) : GRASS) : CANOPY);
    const tr = traceRoad(plan, r);
    expect(tr.coverage).toBe(0);
  });

  it("counts bright paint as road", () => {
    // 10 m road centred on the line with a 2 m painted band off-centre: too wide to bridge, so only the paint rule keeps it.
    const r: RasterSampler = (x, y) => {
      if (Math.abs(y) >= 5) return GRASS;
      if (y > 1.5 && y < 3.5) return PAINT;
      return grey(x, y);
    };
    const plan = planRoad(line(-200, 200), withDefaults({ widthOverride: 8, banking: false }));
    const tr = traceRoad(plan, r);
    expect(tr.coverage).toBeGreaterThan(0.9);
    const w = tr.width[at(plan, 0)];
    expect(w).toBeGreaterThan(9.5);
    expect(w).toBeLessThan(10.5);
  });

  it("traces a loop all round with no dip at the seam (bug 4)", () => {
    const pts: Vec2[] = [];
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * 2 * Math.PI;
      pts.push([100 * Math.cos(a), 100 * Math.sin(a)]);
    }
    const plan = planRoad(pts, withDefaults({ widthOverride: 7, banking: false }));
    expect(plan.closed).toBe(true);
    const r: RasterSampler = (x, y) => (Math.abs(Math.hypot(x, y) - 100) < 4 ? grey(x, y) : GRASS);
    const tr = traceRoad(plan, r);
    expect(tr.coverage).toBe(1);
    expect(Math.min(...tr.conf)).toBeGreaterThan(0.99);
    expect(tr.conf[0]).toBeCloseTo(1, 6);
  });
});

describe("displayOf", () => {
  it("prefers the display variant", () => {
    const raw: RasterSampler = () => [0, 0, 0];
    const shown: RasterSampler = () => [1, 1, 1];
    expect(displayOf(Object.assign(raw, { display: shown }))).toBe(shown);
    const plain: RasterSampler = () => null;
    expect(displayOf(plain)).toBe(plain);
  });
});

describe("traceSideStreets", () => {
  it("moves a side street onto its real line, keeping the junction end", () => {
    const pts: Vec2[] = [];
    for (let y = 4; y <= 204; y += 10) pts.push([0, y]);
    const st: SideStreet = { pts, width: 6, cls: "minor", joins: [0] };
    const r: RasterSampler = (x, y) => (y > 0 && Math.abs(x - 1.2) < 3.5 ? grey(x, y) : GRASS);
    const n = traceSideStreets([st], r, withDefaults({}));
    expect(n).toBe(1);
    expect(st.pts[0][0]).toBeCloseTo(0, 1);
    const k = st.pts.length - 1 - 30;
    expect(st.pts[k][0]).toBeCloseTo(1.2, 1);
    expect(st.widths![k]).toBeCloseTo(7, 0);
  });
});
