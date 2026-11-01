import { describe, expect, it } from "vitest";
import type { AiPoint } from "../src/core/aiSpline";
import { writeFastLaneAi } from "../src/core/aiSpline";
import {
  BARRIER_BACK, courseMarkLayout, courseMarks, courseMarksSettings, findMouths, MARK_MESH, surfaceKind, surfaceProbe, withMarkSurfaces,
} from "../src/core/courseMarks";
import { IDENTITY, readKn5, writeKn5, type Kn5MeshNode, type Kn5Model, type Kn5Node } from "../src/core/kn5";
import { checkLayoutMarks } from "../scripts/check/course_marks_lib";

type Vec2 = [number, number];

/** A flat mesh from triangles in plan (ENU x, y), at height 0. */
function mesh(name: string, tris: Vec2[][]): Kn5MeshNode {
  const pos: number[] = [];
  for (const t of tris) for (const [x, y] of t) pos.push(x, 0, -y);
  const n = pos.length / 3;
  return {
    kind: "mesh", name, material: "m", positions: new Float32Array(pos), normals: new Float32Array(n * 3).map((_, k) => (k % 3 === 1 ? 1 : 0)),
    uvs: new Float32Array(n * 2), indices: Uint16Array.from({ length: n }, (_, k) => k),
  };
}
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[][] => [[[x0, y0], [x1, y0], [x1, y1]], [[x0, y0], [x1, y1], [x0, y1]]];
/** An annulus (or disc, r0 = 0) round c. */
function ring(c: Vec2, r0: number, r1: number, n = 48): Vec2[][] {
  const out: Vec2[][] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * Math.PI, b = ((k + 1) / n) * 2 * Math.PI;
    const p = (r: number, t: number): Vec2 => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
    out.push([p(r0, a), p(r1, a), p(r1, b)], [p(r0, a), p(r1, b), p(r0, b)]);
  }
  return out;
}
const model = (meshes: Kn5Node[]): Kn5Model => ({ textures: [], materials: [], root: { kind: "node", name: "w", transform: IDENTITY, children: meshes } });

/** An AI line through points (ENU), a metre apart or so. */
function ai(pts: Vec2[]): AiPoint[] {
  let d = 0;
  return pts.map((p, i) => {
    const q = pts[Math.min(i + 1, pts.length - 1)], r = pts[Math.max(i - 1, 0)];
    const fx = q[0] - r[0], fy = q[1] - r[1], l = Math.hypot(fx, fy) || 1;
    const len = i < pts.length - 1 ? Math.hypot(q[0] - p[0], q[1] - p[1]) : 0;
    const pt: AiPoint = {
      position: [p[0], 0, -p[1]], distance: d, speed: 10, gas: 1, brake: 0, radius: 100, sideLeft: 2, sideRight: 4, camber: 0, direction: 1,
      normal: [0, 1, 0], length: len, forward: [fx / l, 0, -fy / l], grade: 0,
    };
    d += len;
    return pt;
  });
}
const line = (a: Vec2, b: Vec2, step = 1): Vec2[] => {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
  return Array.from({ length: n + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n] as Vec2);
};

// A straight course east along a 10 m road, with a side street to the north (the course's left) at x = 100.
const tee = () => {
  const world = model([mesh("1ROAD_main", rect(-100, -5, 200, 5)), mesh("1STREET_side", rect(95, 5, 105, 60)), mesh("1ROAD_PATH_FOOT", rect(-100, 6, 94, 8))]);
  return { probe: surfaceProbe(world), lines: [[[-100, 0], [200, 0]], [[100, 0], [100, 60]]] as Vec2[][], ai: ai(line([-90, -1.5], [190, -1.5])) };
};

describe("course marks: surfaces", () => {
  it("knows road, kerb, path and grass by mesh name, and leaves walls and terrain out", () => {
    expect(surfaceKind("1ROAD_RB3")).toBe("road");
    expect(surfaceKind("1STREET_CARPARK_2")).toBe("road");
    expect(surfaceKind("1ROAD_PATH_FOOT_T0")).toBe("path");
    expect(surfaceKind("1KERB_RB")).toBe("kerb");
    expect(surfaceKind("1GRASS_STRIP")).toBe("grass");
    expect(surfaceKind("1GRASS_t12")).toBeNull();
    expect(surfaceKind("1WALL_L_001")).toBeNull();
    expect(surfaceKind("shop_sign")).toBeNull();
  });

  it("adds RIPPLE (valid) and CLOSED (not valid) before the extra sections, once", () => {
    const ini = "[SURFACE_0]\nKEY=ROAD\nIS_VALID_TRACK=1\n\n[SURFACE_1]\nKEY=STREET\nIS_VALID_TRACK=1\n\n[_SCRIPTING_PHYSICS]\nALLOW_TRACK_SCRIPTS=1\n";
    const out = withMarkSurfaces(ini);
    expect(out).toMatch(/\[SURFACE_2\]\nKEY=RIPPLE\n[^[]*IS_VALID_TRACK=1/);
    expect(out).toMatch(/\[SURFACE_3\]\nKEY=CLOSED\n[^[]*IS_VALID_TRACK=0/);
    expect(out.indexOf("KEY=CLOSED")).toBeLessThan(out.indexOf("[_SCRIPTING_PHYSICS]"));
    expect(withMarkSurfaces(out)).toBe(out);
  });

  it("reads the option: off, on, or settings", () => {
    expect(courseMarksSettings(undefined)).toBeNull();
    expect(courseMarksSettings(false)).toBeNull();
    expect(courseMarksSettings(true)).toEqual({ barriers: true, chevrons: true, arrows: true, start: true, solid: false });
    expect(courseMarksSettings({ barriers: false, solid: true })).toMatchObject({ barriers: false, solid: true, chevrons: true });
  });
});

describe("course marks: closed mouths", () => {
  it("closes a side street the course passes: a strip on the kerb line across it, barriers 3.5 m back", () => {
    const { probe, lines, ai: line0 } = tee();
    const f = findMouths({ ai: line0, lines, rings: [], probe });
    const side = f.mouths.filter((m) => m.kind === "side");
    expect(side).toHaveLength(1);
    const m = side[0];
    expect(m.side).toBe(1);
    expect(m.dir[1]).toBeGreaterThan(0.95);
    // On the course's kerb line (y = 5), from one side of the street to the other.
    for (const p of m.strip) expect(p[1]).toBeCloseTo(5, 0);
    const xs = m.strip.map((p) => p[0]);
    expect(Math.min(...xs)).toBeLessThan(96);
    expect(Math.max(...xs)).toBeGreaterThan(104);
    expect(m.barrier).toBeDefined();
    for (const p of m.barrier!) expect(p[1]).toBeCloseTo(5 + BARRIER_BACK + 0.3, 0);
    expect(Math.abs(m.barrier![1][0] - m.barrier![0][0])).toBeGreaterThan(8);
  });

  it("lays a ripple strip, an invisible CLOSED patch and barriers with no collision, all off the AI line", () => {
    const { probe, lines, ai: line0 } = tee();
    const cm = courseMarks({ ai: line0, lines, rings: [], probe }, courseMarksSettings(true)!);
    const names = cm.nodes.map((n) => n.name);
    expect(names.some((n) => n.startsWith("1RIPPLE_RED"))).toBe(true);
    expect(names.some((n) => n.startsWith("1RIPPLE_WHITE"))).toBe(true);
    const closed = cm.nodes.filter((n) => n.name.startsWith("1CLOSED"));
    expect(closed.length).toBeGreaterThan(0);
    for (const n of closed) expect(n.renderable).toBe(false);
    expect(names.some((n) => n.startsWith("CM_BARRIER"))).toBe(true);
    expect(names.some((n) => /^1WALL/.test(n))).toBe(false);
    for (const n of names) expect(n).toMatch(MARK_MESH);
    // Every vertex of the strip and patch north of the kerb line, every barrier past 8 m.
    for (const n of cm.nodes) {
      for (let k = 0; k < n.positions.length; k += 3) {
        const y = -n.positions[k + 2];
        expect(y).toBeGreaterThan(n.name.startsWith("CM_BARRIER") ? 8 : 4.9);
      }
    }
    const report = checkLayoutMarks(line0, cm.nodes, probe);
    expect(report.openings).toBe(1);
    expect(report.open).toHaveLength(0);
    expect(report.onLine).toHaveLength(0);
  });

  it("solid barriers are low walls", () => {
    const { probe, lines, ai: line0 } = tee();
    const cm = courseMarks({ ai: line0, lines, rings: [], probe }, courseMarksSettings({ solid: true })!);
    expect(cm.nodes.some((n) => n.name.startsWith("1WALL_CM"))).toBe(true);
    expect(cm.nodes.some((n) => n.name.startsWith("CM_BARRIER"))).toBe(false);
  });

  it("the check finds an opening left open", () => {
    const { probe, ai: line0 } = tee();
    const report = checkLayoutMarks(line0, [], probe);
    expect(report.openings).toBe(1);
    expect(report.open).toHaveLength(1);
  });

  it("marks the straight-on branch at a course turn, with the way it turns", () => {
    // East along y = 0, then left (north) up x = 100; the road carries on east to x = 160.
    const world = model([mesh("1ROAD_ew", rect(-100, -5, 160, 5)), mesh("1STREET_ns", rect(95, 5, 105, 150))]);
    const pts: Vec2[] = [...line([-90, -1.5], [92, -1.5])];
    for (let k = 1; k <= 12; k++) { const a = -Math.PI / 2 + (k / 12) * (Math.PI / 2); pts.push([92 + 9.5 * Math.cos(a), 8 + 9.5 * Math.sin(a)]); }
    pts.push(...line([101.5, 9], [101.5, 140]).slice(1));
    const f = findMouths({ ai: ai(pts), lines: [[[-100, 0], [160, 0]], [[100, 0], [100, 150]]], rings: [], probe: surfaceProbe(world) });
    expect(f.turns.some((t) => t.dir === "left" && t.ring === undefined)).toBe(true);
    const turn = f.mouths.filter((m) => m.kind === "turn");
    expect(turn).toHaveLength(1);
    expect(turn[0].turn).toBe("left");
    expect(turn[0].dir[0]).toBeGreaterThan(0.95);
    // Chevron boards on its barrier line facing the driver coming up to the turn, an arrow board on
    // the left verge 60 to 80 m before, and an apex strip, none on the AI line.
    const probe = surfaceProbe(world);
    const lines: Vec2[][] = [[[-100, 0], [160, 0]], [[100, 0], [100, 150]]];
    const cm = courseMarks({ ai: ai(pts), lines, rings: [], probe }, courseMarksSettings(true)!);
    expect(cm.boards).toBeGreaterThanOrEqual(2);
    expect(cm.arrows).toBe(1);
    expect(cm.apexes).toBe(1);
    const boards = cm.nodes.filter((n) => n.name.startsWith("CM_BOARD_RED"));
    const xs: number[] = [], ys: number[] = [];
    for (const n of boards) for (let k = 0; k < n.positions.length; k += 3) { xs.push(n.positions[k]); ys.push(-n.positions[k + 2]); }
    // The arrow board: about 70 m before the turn, left of the course (north of y = 5).
    expect(xs.some((x, k) => x > 0 && x < 30 && ys[k] > 5)).toBe(true);
    // The chevrons: across the straight-on branch, east of the junction.
    expect(xs.some((x) => x > 108)).toBe(true);
    expect(checkLayoutMarks(ai(pts), cm.nodes, probe).onLine).toHaveLength(0);
    expect(courseMarks({ ai: ai(pts), lines, rings: [], probe }, courseMarksSettings({ chevrons: false, arrows: false })!).boards).toBe(0);
  });

  it("closes the ring exits the course doesn't take, at the ring's edge", () => {
    // A ring at the origin (outer 12 m, island 5 m) with four arms; the course goes west to east over the north side.
    const arms = [rect(-60, -4, -10, 4), rect(10, -4, 60, 4), rect(-4, 10, 4, 60), rect(-4, -60, 4, -10)];
    const world = model([mesh("1ROAD_RB", ring([0, 0], 5, 12)), ...arms.map((a, k) => mesh(`1STREET_arm${k}`, a)), mesh("1GRASS_RBISLAND", ring([0, 0], 0, 5))]);
    const pts: Vec2[] = [...line([-55, 1.5], [-11, 1.5])];
    for (let k = 1; k < 24; k++) { const a = Math.PI - (k / 24) * Math.PI; pts.push([8.5 * Math.cos(a), 8.5 * Math.sin(a)]); }
    pts.push(...line([11, -1.5], [55, -1.5]));
    const lines: Vec2[][] = [[[-60, 0], [-12, 0]], [[12, 0], [60, 0]], [[0, 12], [0, 60]], [[0, -12], [0, -60]]];
    const probe = surfaceProbe(world);
    const f = findMouths({ ai: ai(pts), lines, rings: [{ c: [0, 0], rOut: 12, rIn: 5 }], probe });
    expect(f.rings).toHaveLength(1);
    expect(f.rings[0].legs.map((l) => l.entry).sort()).toEqual([false, true]);
    const exits = f.mouths.filter((m) => m.kind === "ring");
    expect(exits).toHaveLength(2);
    expect(exits.map((m) => Math.round(m.dir[1])).sort()).toEqual([-1, 1]);
    for (const m of exits) for (const p of m.strip) expect(Math.hypot(p[0], p[1])).toBeGreaterThan(11.5);
    const cm = courseMarks({ ai: ai(pts), lines, rings: [{ c: [0, 0], rOut: 12, rIn: 5 }], probe }, courseMarksSettings(true)!);
    const report = checkLayoutMarks(ai(pts), cm.nodes, probe, [{ c: [0, 0], rOut: 12 }]);
    expect(report.ringArms).toBe(2);
    // The island kerb painted round, and one chevron board on the island facing the one entry.
    expect(cm.nodes.some((n) => n.name.startsWith("CM_ISLAND_RED"))).toBe(true);
    expect(cm.boards).toBe(1);
    const island = cm.nodes.filter((n) => n.name.startsWith("CM_ISLAND"));
    for (const n of island) for (let k = 0; k < n.positions.length; k += 3) expect(Math.hypot(n.positions[k], n.positions[k + 2])).toBeLessThan(5.2);
    expect(report.ringOpen).toHaveLength(0);
    expect(report.onLine).toHaveLength(0);
  });
});

describe("course marks: a layout's files", () => {
  it("puts the marks in the layout's kn5 beside its dummies, adds the surfaces, drops traffic", () => {
    const { probe, lines, ai: line0 } = tee();
    const dummy = { kind: "node" as const, name: "AC_START_0", transform: IDENTITY, children: [] };
    const enc = new TextEncoder();
    const files: Record<string, Uint8Array> = {
      "t/layout_race.kn5": writeKn5({ textures: [], materials: [], root: { kind: "node", name: "race", transform: IDENTITY, children: [dummy] } }),
      "t/race/ai/fast_lane.ai": writeFastLaneAi(line0),
      "t/race/data/surfaces.ini": enc.encode("[SURFACE_0]\nKEY=ROAD\nIS_VALID_TRACK=1\n"),
      "t/race/data/traffic.json": enc.encode("{}"),
      "t/ui/race/ui_track.json": enc.encode(JSON.stringify({ name: "Race", tags: ["street", "traffic-planner-ready"] })),
    };
    const res = courseMarkLayout(files, { slug: "t", probe, lines, rings: [] }, "race", true)!;
    expect(res.drop).toEqual(["t/race/data/traffic.json"]);
    expect(files["t/race/data/traffic.json"]).toBeUndefined();
    const kn5 = readKn5(files["t/layout_race.kn5"]);
    expect(kn5.root.children.some((n) => n.name === "AC_START_0")).toBe(true);
    expect(kn5.root.children.some((n) => n.name.startsWith("1RIPPLE"))).toBe(true);
    expect(kn5.materials.map((m) => m.name)).toContain("cm_red");
    const dec = new TextDecoder();
    expect(dec.decode(files["t/race/data/surfaces.ini"])).toContain("KEY=CLOSED");
    expect(JSON.parse(dec.decode(files["t/ui/race/ui_track.json"])).tags).toEqual(["street"]);
    expect(JSON.parse(dec.decode(files["t/race/data/course_marks.json"])).mouths.side).toBe(1);
    expect(courseMarkLayout(files, { slug: "t", probe, lines, rings: [] }, "race", false)).toBeNull();
  });
});
