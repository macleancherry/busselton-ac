import { describe, expect, it } from "vitest";
import { retimeAi, ringCircles, ringHintValues, smoothKinks, RING_HINT, RING_HINT_BEFORE, RING_SPEED, TIGHT_HINT } from "../src/core/aiRings";
import { aiHintsIni } from "../src/core/aiLine";
import { readFastLaneAi, type AiPoint } from "../src/core/aiSpline";
import { layoutFiles, type World } from "../src/core/layouts";
import { gridFront, GRID_GAP, RING_CLEAR } from "../src/core/gridSlots";
import { trackObjects } from "../src/core/stages/routePlan";
import { LocalProjection, type LngLat } from "../src/core/geo";
import { IDENTITY, type Kn5Model } from "../src/core/kn5";
import { frames } from "../src/core/polyline";
import type { RoadPlan } from "../src/core/road";
import type { Roundabout } from "../src/core/roundabout";

type Vec2 = [number, number];

const pt = (x: number, y: number): AiPoint => ({
  position: [x, 2, -y], distance: 0, speed: 20, gas: 1, brake: 0, radius: 1000,
  sideLeft: 3, sideRight: 3, camber: 0, direction: 1, normal: [0, 1, 0], length: 2, forward: [1, 0, 0], grade: 0,
});

/** Largest change of heading between neighbouring segments, degrees. */
function maxTurn(ai: AiPoint[]): number {
  let m = 0;
  for (let i = 1; i < ai.length - 1; i++) {
    const a = ai[i - 1].position, b = ai[i].position, c = ai[i + 1].position;
    const h1 = Math.atan2(b[0] - a[0], -(b[2] - a[2])), h2 = Math.atan2(c[0] - b[0], -(c[2] - b[2]));
    m = Math.max(m, Math.abs((((h2 - h1) * 180) / Math.PI + 540) % 360 - 180));
  }
  return m;
}

/** A flat 1ROAD mesh over the whole test area, as the world's drivable surface. */
const flatWorld = (): Kn5Model => ({
  textures: [], materials: [],
  root: { kind: "node", name: "root", transform: IDENTITY, children: [{
    kind: "mesh", name: "1ROAD_flat", material: "x", castShadows: false, visible: true, transparent: false,
    positions: new Float32Array([-2000, 2, -2000, 2000, 2, -2000, 2000, 2, 2000, -2000, 2, 2000]),
    normals: new Float32Array(12), uvs: new Float32Array(8), tangents: new Float32Array(12), indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  }] },
});

describe("AI line through roundabouts (retest 4)", () => {
  it("snaps a layout's route round the world's rings: no flick out of the ring, slow on it, hinted before it", () => {
    // A street running south through a ring (centre (0, 0), island 4 m, outer edge 11 m) at the
    // origin, the router's geometry going round its east side (left-hand traffic: clockwise).
    const origin: LngLat = [115.34, -33.65];
    const proj = new LocalProjection(origin);
    const local: Vec2[] = [];
    for (let y = 400; y >= 12; y -= 10) local.push([0, y]);
    // Round the east side at 7.5 m from the centre (from north to south, clockwise).
    for (let k = 0; k <= 12; k++) { const a = Math.PI / 2 - (k / 12) * Math.PI; local.push([7.5 * Math.cos(a), 7.5 * Math.sin(a)]); }
    for (let y = -12; y >= -400; y -= 10) local.push([0, y]);
    const world: World = {
      slug: "t", proj, model: flatWorld(), options: { name: "T", aiKeepLeft: true }, meta: {},
      rings: [{ c: [0, 0], rOut: 11, rIn: 4 }],
    };
    const f = layoutFiles(world, { id: "run", name: "Run", coords: local.map((p) => proj.toLngLat(p)) }, trackObjects);
    const ai = readFastLaneAi(f["t/run/ai/fast_lane.ai"]);
    const near = ai.filter((p) => Math.hypot(p.position[0], p.position[2]) < 11);
    expect(near.length).toBeGreaterThan(5);
    // Round the ring, clear of the island, on its east side.
    for (const p of near) {
      expect(Math.hypot(p.position[0], p.position[2])).toBeGreaterThan(4.5);
    }
    expect(Math.min(...near.map((p) => p.position[0]))).toBeGreaterThan(-1);
    // A line that flows (the old one turned up to 57 degrees between neighbouring points).
    expect(maxTurn(ai)).toBeLessThan(20);
    // Slow on the ring, slowing gently before it.
    for (const p of near) expect(p.speed).toBeLessThanOrEqual(RING_SPEED + 1e-6);
    const before = ai.find((p) => p.position[2] < 0 && Math.hypot(p.position[0], p.position[2]) > 11 + 25)!;
    expect(before.speed).toBeLessThan(15);
    // The hint: RING_HINT from 40 m before the ring.
    const hints = new TextDecoder().decode(f["t/run/data/ai_hints.ini"]);
    expect(hints).toContain(`VALUE=${RING_HINT}`);
    const total = ai[ai.length - 1].distance + ai[ai.length - 1].length;
    const first = ai.findIndex((p) => Math.hypot(p.position[0], p.position[2]) < 11);
    const start = Number(/START=([\d.]+)\nEND=[\d.]+\nVALUE=0.35/.exec(hints)![1]) * total;
    expect(start).toBeCloseTo(ai[first].distance - RING_HINT_BEFORE, -1);
  });

  it("uses the ring's middle for the circle, or 3.5 m in from its outer edge without an island size", () => {
    expect(ringCircles([{ c: [1, 2], rOut: 11, rIn: 4 }])).toEqual([{ c: [1, 2], r: 7.5 }]);
    expect(ringCircles([{ c: [0, 0], rOut: 11 }])[0].r).toBeCloseTo(7.5, 6);
  });

  it("eases kinks out of a line without leaving the surface", () => {
    // A straight line along y = 0 with a one-point jog of 1.5 m every 20 m.
    const ai = Array.from({ length: 100 }, (_, i) => pt(i * 2, i % 10 === 5 ? 1.5 : 0));
    expect(maxTurn(ai)).toBeGreaterThan(70);
    smoothKinks(ai, () => 2, false);
    expect(maxTurn(ai)).toBeLessThan(25);
    // Surface only at y <= 0.2: a jog out to y = -1 can come back up, but nothing goes past 0.2.
    const ai2 = Array.from({ length: 60 }, (_, i) => pt(i * 2, i === 30 ? -1 : 0));
    smoothKinks(ai2, (_x, y) => (y <= 0.2 ? 2 : null), false);
    for (const p of ai2) expect(-p.position[2]).toBeLessThanOrEqual(0.2 + 1e-9);
    expect(Math.abs(ai2[30].position[2])).toBeLessThan(0.5);
  });

  it("takes radii and speeds from the line itself, held down on a ring", () => {
    // A 20 m radius circle, 2 m apart, closed: a ring at its centre covering the whole lap.
    const n = 63, R = 20;
    const circle = Array.from({ length: n }, (_, i) => { const a = (i / n) * 2 * Math.PI; return pt(R * Math.cos(a), R * Math.sin(a)); });
    retimeAi(circle, true);
    for (const p of circle) expect(p.radius).toBeCloseTo(R, 0);
    // 1 g round 20 m: 14 m/s.
    for (const p of circle) expect(p.speed).toBeCloseTo(Math.sqrt(9.81 * R), 0);
    // A straight 400 m with a ring at 300 m: RING_SPEED on it, and braking at no more than 3 m/s^2 before it.
    const line = Array.from({ length: 201 }, (_, i) => pt(i * 2, 0));
    retimeAi(line, false, [{ c: [300, 0], rOut: 10 }]);
    const on = line.filter((p) => Math.abs(p.position[0] - 300) < 10);
    for (const p of on) expect(p.speed).toBeLessThanOrEqual(RING_SPEED + 1e-6);
    for (const p of line) expect(p.radius).toBe(1000);
    const at = (x: number) => line.find((p) => p.position[0] >= x)!.speed;
    expect(at(290 - 20)).toBeLessThanOrEqual(Math.sqrt(RING_SPEED ** 2 + 2 * 3 * 20) + 0.5);
    expect(line[line.length - 1].length).toBe(0);
    expect(line[100].distance).toBeCloseTo(200, 6);
  });

  it("hints each ring and each square corner, across the start line on a loop", () => {
    // A loop of 400 points 2 m apart (a circle of radius ~127 m), a ring over its first and last few points.
    const n = 400, R = 800 / (2 * Math.PI);
    const loop = Array.from({ length: n }, (_, i) => { const a = (i / n) * 2 * Math.PI; return pt(R * Math.cos(a), R * Math.sin(a)); });
    retimeAi(loop, true);
    const rings = [{ c: [R, 0] as Vec2, rOut: 8 }];
    const v = ringHintValues(loop, rings, true);
    // On the ring (points either side of 0) and 40 m before it (from about point 400 - 4 - 20).
    expect(v[0]).toBe(RING_HINT);
    expect(v[n - 3]).toBe(RING_HINT);
    expect(v[n - 22]).toBe(RING_HINT);
    expect(v[n - 30]).toBe(1);
    expect(v[200]).toBe(1);
    const ini = aiHintsIni(loop, undefined, false, v);
    expect(ini).toContain("START=0.00000");
    expect(ini).toContain("END=1.00000");
    // A square corner (radius ~5 m) on an open line: TIGHT_HINT from 30 m before it.
    const corner: AiPoint[] = [];
    for (let x = -100; x < -5; x += 2) corner.push(pt(x, 0));
    for (let k = 0; k <= 4; k++) { const a = -Math.PI / 2 + (k / 4) * (Math.PI / 2); corner.push(pt(-5 + 5 * Math.cos(a), 5 + 5 * Math.sin(a))); }
    for (let y = 7; y < 100; y += 2) corner.push(pt(0, y));
    retimeAi(corner, false);
    const cv = ringHintValues(corner, [], false);
    const firstTight = corner.findIndex((p) => p.radius < 10);
    expect(firstTight).toBeGreaterThan(0);
    expect(cv[firstTight]).toBe(TIGHT_HINT);
    expect(cv[corner.findIndex((p) => p.position[0] >= corner[firstTight].position[0] - 25)]).toBe(TIGHT_HINT);
    expect(cv[0]).toBe(1);
  });
});

describe("grid clear of rings ahead", () => {
  it("puts a layout's grid with road ahead clear of a ring when there's room, else as before", () => {
    // A straight 1 km closed out and back is awkward; an open 1 km road east, the line at 900 m, a
    // ring at 860 m: the front must sit so 150 m ahead of it has no ring.
    const pts: Vec2[] = Array.from({ length: 501 }, (_, i) => [i * 2, 0]);
    const fr = frames(pts, false);
    const samples = fr.map((f) => ({ ...f, width: 7, h: 0, bank: 0 }));
    const rb = { c: [860, 0] as Vec2, r: 8, w: 6, lanes: 1, hc: 0, sIn: 852, sOut: 868 } as unknown as Roundabout;
    const plan: RoadPlan = { closed: false, samples, length: 1000, roundabouts: [rb] };
    const near = gridFront(plan, 8, 900);
    const far = gridFront(plan, 8, 900, { clearAhead: 150 });
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    // Without: just behind the ring's clearance. With: 150 m of ring-free road ahead of the front.
    expect(near!).toBeGreaterThan(860 - 11 - RING_CLEAR - 10);
    expect(far!).toBeLessThanOrEqual(860 - 11 - RING_CLEAR - 150 + 4);
    expect(far! - 7 * GRID_GAP).toBeGreaterThan(0);
    // No room for it: the grid as without.
    expect(gridFront(plan, 8, 900, { clearAhead: 5000 })).toBe(near);
  });
});
