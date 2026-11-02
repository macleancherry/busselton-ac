import { describe, expect, it } from "vitest";
import {
  circuitKerbs, circuitKerbsSettings, findCorners, gridPaint, kerbRuns, pickCorners,
  EXIT_RUN, KERB_AI_CLEAR, KERB_HEIGHT, KERB_WIDTH,
} from "../src/core/circuitKerbs";
import { buildTrack, trackObjects } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import { readKn5, type Kn5Node } from "../src/core/kn5";
import { GRID_GAP } from "../src/core/gridSlots";
import { buildAiLine } from "../src/core/aiLine";
import { pitLaneFiles } from "../src/core/pitLane";
import { frames, resample } from "../src/core/polyline";
import { withDefaults } from "../src/core/options";
import type { RoadPlan } from "../src/core/road";
import type { Kn5GroupNode, Kn5MeshNode } from "../src/core/kn5";

type Vec2 = [number, number];

/** A 600 x 300 m loop, anticlockwise from (0, 0) heading east, four 90-degree corners of radius `R`. */
function loopPlan(width = 10, R = 40): RoadPlan {
  const pts: Vec2[] = [];
  const W = 600, H = 300;
  const arc = (cx: number, cy: number, a0: number) => {
    for (let k = 0; k <= 12; k++) { const a = a0 + (k / 12) * (Math.PI / 2); pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
  };
  pts.push([-W / 2 + R, 0]);
  pts.push([W / 2 - R, 0]); arc(W / 2 - R, R, -Math.PI / 2);
  pts.push([W / 2, H - R]); arc(W / 2 - R, H - R, 0);
  pts.push([-W / 2 + R, H]); arc(-W / 2 + R, H - R, Math.PI / 2);
  pts.push([-W / 2, R]); arc(-W / 2 + R, R, Math.PI);
  const dense = resample(pts, 2);
  const i0 = dense.reduce((b, p, i) => (Math.abs(p[0]) + Math.abs(p[1]) < Math.abs(dense[b][0]) + Math.abs(dense[b][1]) ? i : b), 0);
  const loop = [...dense.slice(i0), ...dense.slice(0, i0)].filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.5);
  const samples = frames(loop, true).map((f) => ({ ...f, width, h: 0, bank: 0 }));
  const length = samples[samples.length - 1].s + Math.hypot(loop[0][0] - loop[loop.length - 1][0], loop[0][1] - loop[loop.length - 1][1]);
  return { closed: true, samples, length, roundabouts: [] };
}

/** Local ENU vertices of a kn5 mesh (AC is x, z, -y). */
const verts = (m: Kn5MeshNode): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i < m.positions.length; i += 3) out.push([m.positions[i], -m.positions[i + 2], m.positions[i + 1]]);
  return out;
};

/** Offset of a point left of the plan's centreline, and its distance along, from the nearest sample. */
function across(plan: RoadPlan, p: [number, number, number]): { t: number; s: number } {
  let best = plan.samples[0], bd = Infinity;
  for (const smp of plan.samples) {
    const d = Math.hypot(smp.pos[0] - p[0], smp.pos[1] - p[1]);
    if (d < bd) { bd = d; best = smp; }
  }
  return { t: (p[0] - best.pos[0]) * best.left[0] + (p[1] - best.pos[1]) * best.left[1], s: best.s };
}

const pos = (d: Kn5GroupNode): Vec2 => [d.transform[12], -d.transform[14]];
const named = (ds: Kn5GroupNode[], name: string) => ds.find((d) => d.name === name)!;

describe("circuit kerbs: settings", () => {
  it("is on for raceway builds unless false, off otherwise unless asked for", () => {
    expect(circuitKerbsSettings(undefined, true)).toEqual({ maxRadius: 60 });
    expect(circuitKerbsSettings(undefined, false)).toBeNull();
    expect(circuitKerbsSettings(false, true)).toBeNull();
    expect(circuitKerbsSettings(true, false)).toEqual({ maxRadius: 60 });
    expect(circuitKerbsSettings({ maxRadius: 30, corners: [[1, 2]] }, true)).toEqual({ maxRadius: 30, corners: [[1, 2]] });
  });
});

describe("circuit kerbs: corners", () => {
  it("finds the four corners of an anticlockwise loop as left-handers, each turning 90 degrees", () => {
    const plan = loopPlan();
    const cs = findCorners(plan.samples.map((s) => s.curvature), 2, true);
    expect(cs).toHaveLength(4);
    for (const c of cs) {
      expect(c.side).toBe(1);
      expect(c.turn).toBeGreaterThan((70 * Math.PI) / 180);
      expect(c.turn).toBeLessThan((110 * Math.PI) / 180);
      // The apex is on the arc (40 m from the arc's centre, i.e. not on a straight).
      const a = plan.samples[c.apex].pos;
      const centres: Vec2[] = [[260, 40], [260, 260], [-260, 260], [-260, 40]];
      expect(Math.min(...centres.map((q) => Math.abs(Math.hypot(a[0] - q[0], a[1] - q[1]) - 40)))).toBeLessThan(2);
    }
  });

  it("finds none where the bends are wider than the radius asked for, and none on a straight", () => {
    const plan = loopPlan();
    expect(findCorners(plan.samples.map((s) => s.curvature), 2, true, 30)).toHaveLength(0);
    expect(findCorners(new Array(200).fill(0), 2, false)).toHaveLength(0);
  });

  it("keeps a corner over the start of a loop whole", () => {
    // Rotate the curvature so the first corner straddles index 0.
    const k = loopPlan().samples.map((s) => s.curvature);
    const first = findCorners(k, 2, true)[0];
    const mid = Math.round((first.from + first.to) / 2);
    const rot = [...k.slice(mid), ...k.slice(0, mid)];
    const cs = findCorners(rot, 2, true);
    expect(cs).toHaveLength(4);
    expect(cs.some((c) => c.to < c.from)).toBe(true);
  });

  it("picks only the corners nearest the listed points", () => {
    const plan = loopPlan();
    const cs = findCorners(plan.samples.map((s) => s.curvature), 2, true);
    const picked = pickCorners(cs, plan.samples.map((s) => s.pos), [[290, 10], [0, 500]]);
    expect(picked).toHaveLength(1);
    expect(plan.samples[picked[0].apex].pos[0]).toBeGreaterThan(250);
    expect(plan.samples[picked[0].apex].pos[1]).toBeLessThan(50);
  });

  it("lays the inside kerb round the apex and the outside one at the exit, past the corner", () => {
    const plan = loopPlan();
    const s = plan.samples.map((x) => x.s);
    const c = findCorners(plan.samples.map((x) => x.curvature), 2, true)[0];
    const runs = kerbRuns(c, s, plan.length, true);
    const inside = runs.find((r) => r.inside)!, outside = runs.find((r) => !r.inside)!;
    expect(inside.side).toBe(1);
    expect(outside.side).toBe(-1);
    const apex = s[c.apex] < s[c.from] ? s[c.apex] + plan.length : s[c.apex];
    expect(inside.s0).toBeLessThan(apex);
    expect(inside.s1).toBeGreaterThan(apex);
    expect(outside.s0).toBeGreaterThan(apex);
    const end = s[c.to] < s[c.from] ? s[c.to] + plan.length : s[c.to];
    expect(outside.s1).toBeCloseTo(end + EXIT_RUN, 5);
  });
});

describe("circuit kerbs: meshes", () => {
  it("builds red and white physics kerbs on the asphalt's outer metre, low, and clear of the AI line", () => {
    const plan = loopPlan(10);
    const r = circuitKerbs(plan, { crown: 0 });
    expect(r.corners).toHaveLength(4);
    expect(r.runs).toHaveLength(8);
    expect(r.bands).toBeGreaterThan(40);
    const names = r.nodes.map((n) => n.name);
    expect(names.some((n) => /^1KERB_CIRCUIT_RED_\d+$/.test(n))).toBe(true);
    expect(names.some((n) => /^1KERB_CIRCUIT_WHITE_\d+$/.test(n))).toBe(true);
    expect(r.nodes.every((n) => n.material === "circuit_red" || n.material === "circuit_white")).toBe(true);
    for (const n of r.nodes) {
      for (const v of verts(n)) {
        const { t } = across(plan, v);
        expect(Math.abs(t)).toBeGreaterThan(5 - KERB_WIDTH - 0.1);
        expect(Math.abs(t)).toBeLessThan(5 + 0.1);
        expect(v[2]).toBeLessThanOrEqual(KERB_HEIGHT);
        expect(v[2]).toBeGreaterThan(-0.01);
        expect(Math.abs(t)).toBeGreaterThanOrEqual(KERB_AI_CLEAR);
      }
    }
  });

  it("leaves the kerbs out where they'd come within reach of the AI line (a narrow road, or a line kept to that side)", () => {
    expect(circuitKerbs(loopPlan(4), { crown: 0 }).bands).toBe(0);
    const plan = loopPlan(7);
    const all = circuitKerbs(plan, { crown: 0 }).bands;
    // The AI line 2 m left of the centreline: the left (inside) kerbs go, the right ones stay.
    const left = circuitKerbs(plan, { crown: 0, aiOffset: plan.samples.map(() => 2) });
    expect(left.bands).toBeGreaterThan(0);
    expect(left.bands).toBeLessThan(all);
    for (const n of left.nodes) for (const v of verts(n)) expect(across(plan, v).t).toBeLessThan(0);
  });

  it("keeps off street mouths and sits on a crowned road", () => {
    const plan = loopPlan(10);
    expect(circuitKerbs(plan, { crown: 0, mouth: () => true }).bands).toBe(0);
    const crowned = circuitKerbs(plan, { crown: 0.02 });
    for (const n of crowned.nodes) for (const v of verts(n)) {
      const { t } = across(plan, v);
      // Below the crowned surface's height there plus the kerb's own.
      expect(v[2]).toBeLessThanOrEqual(-0.02 * Math.abs(t) + KERB_HEIGHT + 0.01);
    }
  });

  it("kerbs only the listed corners", () => {
    const plan = loopPlan(10);
    const r = circuitKerbs(plan, { crown: 0, corners: [[290, 10]] });
    expect(r.corners).toHaveLength(1);
    expect(r.runs).toHaveLength(2);
  });
});

describe("grid at a real box, pits in real bays", () => {
  const fixed = { toLocal: (p: [number, number]): Vec2 => [p[0], p[1]], groundAt: () => 3 };

  it("puts the front of the grid at gridAt, staggered on a circuit, back up the straight", () => {
    const plan = loopPlan(12);
    const opts = withDefaults({ name: "C", pitCount: 6, raceway: true, gridAt: [-50, 0] });
    const ds = trackObjects(plan, opts, {}, fixed);
    const p0 = pos(named(ds, "AC_START_0")), p1 = pos(named(ds, "AC_START_1")), p2 = pos(named(ds, "AC_START_2"));
    expect(p0[0]).toBeCloseTo(-50, 0);
    expect(p0[1]).toBeCloseTo(3, 0);
    expect(p1[1]).toBeCloseTo(-3, 0);
    // The second column half a row back, the next row a whole row back (spots snap to the 2 m
    // samples at or before them).
    expect(p0[0] - p1[0]).toBeGreaterThan(GRID_GAP / 2 - 0.1);
    expect(p0[0] - p1[0]).toBeLessThan(GRID_GAP / 2 + 2.1);
    expect(p0[0] - p2[0]).toBeGreaterThan(GRID_GAP - 0.1);
    expect(p0[0] - p2[0]).toBeLessThan(GRID_GAP + 2.1);
    expect(p0[0] - p2[0]).toBeGreaterThan(p0[0] - p1[0]);
    // Without the projection, gridAt is ignored: the grid's usual place behind the line.
    const plain = trackObjects(plan, opts, {});
    expect(pos(named(plain, "AC_START_0"))[0]).toBeGreaterThan(-GRID_GAP - 2.5);
    expect(pos(named(plain, "AC_START_0"))[0]).toBeLessThan(-GRID_GAP + 0.1);
  });

  it("is not staggered off a circuit", () => {
    const plan = loopPlan(12);
    const ds = trackObjects(plan, withDefaults({ name: "C", pitCount: 4 }), {});
    expect(pos(named(ds, "AC_START_0"))[0]).toBeCloseTo(pos(named(ds, "AC_START_1"))[0], 3);
  });

  it("puts the listed pit boxes in their bays, on the ground, facing their heading; the rest on the grid", () => {
    const plan = loopPlan(12);
    const opts = withDefaults({ name: "C", pitCount: 4, raceway: true, pits: [[10, 50, 270], [10, 45, 270]] });
    const ds = trackObjects(plan, opts, {}, fixed);
    const b0 = named(ds, "AC_PIT_0");
    expect(pos(b0)[0]).toBeCloseTo(10, 5);
    expect(pos(b0)[1]).toBeCloseTo(50, 5);
    expect(b0.transform[13]).toBeCloseTo(3.5, 5);
    // Facing west: forward (AC) is -x.
    expect(b0.transform[8]).toBeCloseTo(-1, 5);
    expect(pos(named(ds, "AC_PIT_1"))[1]).toBeCloseTo(45, 5);
    expect(pos(named(ds, "AC_PIT_2"))).toEqual(pos(named(ds, "AC_START_2")));
    expect(ds.filter((d) => d.name.startsWith("AC_PIT_"))).toHaveLength(4);
    // The pit lane still ships: past the grid, as the bays are off the AI line.
    const ai = buildAiLine(plan);
    const all = trackObjects(plan, withDefaults({ name: "C", pitCount: 2, raceway: true, pits: [[10, 50, 270], [10, 45, 270]] }), {}, fixed);
    const files = pitLaneFiles("t/x", ai, new Uint8Array(4), all, true);
    expect(files["t/x/ai/pit_lane.ai"]).toBeDefined();
  });
});

describe("grid paint", () => {
  it("paints a start line and a numbered box at each grid slot", () => {
    const plan = loopPlan(12);
    const ds = trackObjects(plan, withDefaults({ name: "C", pitCount: 6, raceway: true }), {});
    const r = gridPaint(plan, ds, 0, 0);
    expect(r.boxes).toBe(6);
    expect(r.nodes.length).toBeGreaterThan(0);
    expect(r.nodes.every((n) => /^CIRCUIT_PAINT_\d+$/.test(n.name) && n.material === "circuit_paint")).toBe(true);
    const vs = r.nodes.flatMap(verts);
    // Paint just over the road, and some of it across the line at x = 0.
    expect(vs.every((v) => v[2] > 0 && v[2] < 0.05)).toBe(true);
    expect(vs.some((v) => Math.abs(v[0]) < 0.4 && Math.abs(v[1]) > 4)).toBe(true);
    // Nothing ahead of the line but the line itself.
    expect(vs.every((v) => v[0] < 0.4)).toBe(true);
  });
});

describe("a raceway build end to end", () => {
  // A 400 x 200 m loop, anticlockwise from (0, 0) heading east, on flat ground.
  const LNG = 116.1, LAT = -31.95;
  const M_LNG = 111_320 * Math.cos((LAT * Math.PI) / 180), M_LAT = 111_320;
  const toLngLat = ([x, y]: Vec2): [number, number] => [LNG + x / M_LNG, LAT + y / M_LAT];

  it("lays kerbs and grid paint in the world's markings, with their materials, and the grid at gridAt", async () => {
    const pts: Vec2[] = [];
    const R = 40, W = 400, H = 200;
    const arc = (cx: number, cy: number, a0: number) => { for (let k = 0; k <= 8; k++) { const a = a0 + (k / 8) * (Math.PI / 2); pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); } };
    pts.push([0, 0], [W / 2 - R, 0]); arc(W / 2 - R, R, -Math.PI / 2);
    pts.push([W / 2, H - R]); arc(W / 2 - R, H - R, 0);
    pts.push([-W / 2 + R, H]); arc(-W / 2 + R, H - R, Math.PI / 2);
    pts.push([-W / 2, R]); arc(-W / 2 + R, R, Math.PI);
    pts.push([-20, 0], [0, 0]);
    const r = await buildTrack(pts.map(toLngLat), {
      name: "Kerb Loop", imageryZoom: 0, corridor: 40, horizon: 0, trees: 0, buildings: false, widthOverride: 10, banking: false,
      raceway: true, gridAt: toLngLat([-30, 0]), pits: [[...toLngLat([-40, 30]), 90]],
    }, { dem: async (proj, bounds, zoom) => DemGrid.fromFunction(proj, zoom, bounds, () => 50).sample });
    const model = readKn5(r.files[`${r.slug}/${r.slug}.kn5`]);
    const flat = (n: Kn5Node): Kn5Node[] => (n.kind === "mesh" ? [n] : [n, ...n.children.flatMap(flat)]);
    const all = flat(model.root);
    const markings = all.find((n) => n.name === "MARKINGS")!;
    const inMarks = flat(markings).filter((n) => n.kind === "mesh").map((n) => n.name);
    expect(inMarks.some((n) => n.startsWith("1KERB_CIRCUIT_RED_"))).toBe(true);
    expect(inMarks.some((n) => n.startsWith("CIRCUIT_PAINT_"))).toBe(true);
    for (const m of ["circuit_red", "circuit_white", "circuit_paint"]) expect(model.materials.some((x) => x.name === m)).toBe(true);
    const start0 = all.find((n) => n.name === "AC_START_0") as Kn5GroupNode;
    // The build's origin is the middle of the loop's box.
    const g = r.proj.toLocal(toLngLat([-30, 0])), b = r.proj.toLocal(toLngLat([-40, 30]));
    expect(start0.transform[12] - g[0]).toBeGreaterThan(-4);
    expect(start0.transform[12] - g[0]).toBeLessThan(3);
    const pit0 = all.find((n) => n.name === "AC_PIT_0") as Kn5GroupNode;
    expect(pit0.transform[12]).toBeCloseTo(b[0], 0);
    expect(-pit0.transform[14]).toBeCloseTo(b[1], 0);
    expect(pit0.transform[13]).toBeGreaterThan(49);
    expect(pit0.transform[13]).toBeLessThan(52);
    expect(r.files[`${r.slug}/ai/pit_lane.ai`]).toBeDefined();
  }, 300_000);
});
