// The paved pit lane (pitRoad.ts) and its pit_lane.ai (pitLane.ts pitLaneAlong).
import { beforeAll, describe, expect, it } from "vitest";
import { applyPitWidths, pitLaneLine, pitLanePath, pitLanePoints, pitLaneRings, pitWidthAt, PIT_CLASS, PIT_WIDTH } from "../src/core/pitRoad";
import { pitLaneAlong, pitLaneFiles, PIT_LANE_SPEED, type PitPath } from "../src/core/pitLane";
import { readFastLaneAi, writeFastLaneAi, type AiPoint } from "../src/core/aiSpline";
import { buildTrack, type DataSources, type TrackResult } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import { readKn5, type Kn5MeshNode, type Kn5Node } from "../src/core/kn5";
import type { SideStreet } from "../src/core/sideStreets";
import type { LngLat, Vec2 } from "../src/core/geo";
import { surfaceHeight } from "../src/core/layouts";

const LNG = 116.2, LAT = -31.6;
const M_LNG = 111_320 * Math.cos((LAT * Math.PI) / 180), M_LAT = 111_320;
const p = (x: number, y: number): LngLat => [LNG + x / M_LNG, LAT + y / M_LAT];
const local = (q: LngLat): Vec2 => [(q[0] - LNG) * M_LNG, (q[1] - LAT) * M_LAT];

describe("pit lane option", () => {
  it("reads points with and without widths, and needs two", () => {
    expect(pitLanePoints(undefined)).toBeNull();
    expect(pitLanePoints({ points: [[1, 2]] })).toBeNull();
    const lane = pitLanePoints({ points: [[1, 2], [3, 4, 12], [5, 6]] })!;
    expect(lane.pts).toEqual([[1, 2], [3, 4], [5, 6]]);
    expect(lane.widths).toEqual([PIT_WIDTH, 12, PIT_WIDTH]);
    expect(pitLanePoints({ width: 6, points: [[1, 2], [3, 4]] })!.widths).toEqual([6, 6]);
  });

  it("is a pit-lane street at its narrowest width, with ground round it", () => {
    const opt = { points: [p(0, 0), p(50, 0), [...p(100, 0), 14] as [number, number, number]] as ([number, number] | [number, number, number])[] };
    const line = pitLaneLine(opt)!;
    expect(line.cls).toBe(PIT_CLASS);
    expect(line.width).toBe(PIT_WIDTH);
    const rings = pitLaneRings(opt, local);
    expect(rings.length).toBeGreaterThan(0);
    // The ground reaches past the lane's widest half.
    const ys = rings.flat().map((q) => q[1]);
    expect(Math.max(...ys)).toBeGreaterThan(7 + 10);
  });

  it("interpolates the widths along the line and puts them on the planned street", () => {
    const line: Vec2[] = [[0, 0], [100, 0]];
    expect(pitWidthAt(line, [8, 16], [50, 3])).toBeCloseTo(12, 6);
    const st: SideStreet = { pts: [[0, 0], [25, 0], [100, 0]], width: 8, cls: PIT_CLASS, joins: [] };
    const other: SideStreet = { pts: [[0, 0], [10, 0]], width: 6, cls: "minor", joins: [] };
    applyPitWidths([st, other], { points: [[...p(0, 0), 8], [...p(100, 0), 16]] as [number, number, number][] }, local);
    expect(st.widths![1]).toBeCloseTo(10, 3);
    expect(st.width).toBeCloseTo(16, 3);
    expect(other.widths).toBeUndefined();
  });
});

/** A 1 km loop as a circle (radius about 159 m), 2 m apart, anticlockwise seen from above. */
function circle(): AiPoint[] {
  const n = 500, R = 1000 / (2 * Math.PI);
  return Array.from({ length: n }, (_, i): AiPoint => {
    const a = (i / n) * 2 * Math.PI;
    return {
      position: [R * Math.cos(a), 1, -R * Math.sin(a)], distance: i * 2, speed: 30, gas: 1, brake: 0, radius: R,
      sideLeft: 5, sideRight: 5, camber: 0, direction: 1, normal: [0, 1, 0], length: 2,
      forward: [-Math.sin(a), 0, -Math.cos(a)], grade: 0,
    };
  });
}

/** A chord inside the circle from angle a0 to a1 (radians, in the circle's direction), every 2 m. */
function chord(a0: number, a1: number): PitPath {
  const R = 1000 / (2 * Math.PI);
  const A: Vec2 = [R * Math.cos(a0), R * Math.sin(a0)], B: Vec2 = [R * Math.cos(a1), R * Math.sin(a1)];
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.ceil(L / 2);
  const pts = Array.from({ length: n + 1 }, (_, k): [number, number, number] => {
    const x = A[0] + ((B[0] - A[0]) * k) / n, y = A[1] + ((B[1] - A[1]) * k) / n;
    return [x, 1, -y];
  });
  return { pts, widths: pts.map(() => 10) };
}

describe("pit_lane.ai along a paved lane", () => {
  it("leaves the AI line where the lane does, runs down the lane and rejoins it", () => {
    const ai = circle(), lane = chord(0.3, 1.2);
    const pit = pitLaneAlong(ai, lane, true)!;
    expect(pit).not.toBeNull();
    // Every lane point is on it, at the pit speed, with the lane's width either side.
    for (const q of lane.pts) {
      const hit = pit.find((a) => Math.hypot(a.position[0] - q[0], a.position[2] - q[2]) < 1e-6)!;
      expect(hit).toBeDefined();
      expect(hit.speed).toBeCloseTo(PIT_LANE_SPEED, 6);
      expect(hit.sideLeft).toBe(5);
    }
    // It starts on the racing line before the entry and ends on it after the exit.
    const onCircle = (a: AiPoint) => Math.abs(Math.hypot(a.position[0], a.position[2]) - 1000 / (2 * Math.PI)) < 1e-6;
    expect(onCircle(pit[0])).toBe(true);
    expect(onCircle(pit[pit.length - 1])).toBe(true);
    // Distances run on from 0 by each point's length; the last has none.
    expect(pit[0].distance).toBe(0);
    for (let i = 1; i < pit.length; i++) expect(pit[i].distance).toBeCloseTo(pit[i - 1].distance + pit[i - 1].length, 5);
    expect(pit[pit.length - 1].length).toBe(0);
    // Every step is short (no jump across the infield) and goes forward.
    for (let i = 1; i < pit.length; i++) {
      const a = pit[i - 1], b = pit[i];
      const dx = b.position[0] - a.position[0], dz = b.position[2] - a.position[2];
      expect(Math.hypot(dx, dz)).toBeLessThan(3);
      expect(dx * a.forward[0] + dz * a.forward[2]).toBeGreaterThan(0);
    }
  });

  it("turns a lane given backwards round", () => {
    const ai = circle(), lane = chord(0.3, 1.2);
    const back: PitPath = { pts: [...lane.pts].reverse(), widths: [...lane.widths].reverse() };
    const a = pitLaneAlong(ai, lane, true)!, b = pitLaneAlong(ai, back, true)!;
    expect(b.length).toBe(a.length);
    expect(b[0].position).toEqual(a[0].position);
  });

  it("isn't used when the lane is nowhere near the AI line, and the files fall back", () => {
    const ai = circle();
    const far: PitPath = { pts: [[1000, 0, 1000], [1010, 0, 1000]], widths: [8, 8] };
    expect(pitLaneAlong(ai, far, true)).toBeNull();
    const files = pitLaneFiles("t/lay", ai, writeFastLaneAi(ai), [], true, far);
    expect(files["t/lay/ai/pit_lane.ai"]).toBeUndefined();
    const ok = pitLaneFiles("t/lay", ai, writeFastLaneAi(ai), [], true, chord(0.3, 1.2));
    expect(readFastLaneAi(ok["t/lay/ai/pit_lane.ai"]).length).toBeGreaterThan(50);
  });

  it("takes the lane's heights from the built surface", () => {
    const path = pitLanePath({ points: [p(0, 0), p(20, 0)] }, local, (x) => (x > 10 ? 3 : null))!;
    expect(path.pts[0][1]).toBe(3); // before any height: the first one found
    expect(path.pts[path.pts.length - 1][1]).toBe(3);
    expect(path.pts.length).toBe(11);
    expect(path.widths.every((w) => w === PIT_WIDTH)).toBe(true);
  });
});

const meshesOf = (n: Kn5Node): Kn5MeshNode[] => (n.kind === "mesh" ? [n] : n.children.flatMap(meshesOf));

describe("a straight road with a pit lane beside it", () => {
  let r: TrackResult;
  let meshes: Kn5MeshNode[];
  // The route runs east along y = 0, 8 m wide; the pit lane leaves it at x = -60, runs 30 m north of
  // it (16 m wide in the middle: the paddock) and rejoins at x = 60.
  const lanePts: ([number, number] | [number, number, number])[] = [p(-70, 0), p(-50, 15), p(-30, 30), [...p(0, 30), 16], p(30, 30), p(50, 15), p(70, 0)];

  beforeAll(async () => {
    const sources: DataSources = {
      dem: async (proj, bounds, zoom) => DemGrid.fromFunction(proj, zoom, bounds, () => 25).sample,
      streets: { lines: [{ pts: [p(-300, 0), p(300, 0)], cls: "secondary" }], names: [] },
    };
    const route = Array.from({ length: 31 }, (_, i) => p(i * 20 - 300, 0));
    r = await buildTrack(route, {
      name: "Pit Road", corridor: 50, horizon: 0, imageryZoom: 0, widthOverride: 8, streetsValid: false,
      pitLane: { points: lanePts },
    }, sources);
    meshes = meshesOf(readKn5(r.files[`${r.slug}/${r.slug}.kn5`]).root);
  }, 300_000);

  it("builds the lane as valid road with edge lines, not as a street", () => {
    const pit = meshes.filter((m) => m.name.startsWith("1ROAD_PIT_"));
    expect(pit.length).toBeGreaterThan(0);
    expect(meshes.some((m) => m.name.startsWith("MARKINGS_PIT_"))).toBe(true);
    // The lane's middle (the paddock, 30 m north) is on it, 16 m wide.
    const h = surfaceHeight({ root: { kind: "node", name: "r", transform: [], children: pit } } as never, /^1ROAD_PIT/);
    expect(h(0, 30)).not.toBeNull();
    expect(h(0, 37)).not.toBeNull();
    expect(h(0, 40)).toBeNull();
    // ROAD is valid track; streets here aren't.
    const surfaces = new TextDecoder().decode(r.files[`${r.slug}/data/surfaces.ini`]);
    expect(surfaces).toMatch(/KEY=ROAD\nFRICTION=[\d.]+\nDAMPING=[\d.]+\nWAV=\nWAV_PITCH=[^\n]*\nFF_EFFECT=NULL\nDIRT_ADDITIVE=0\nIS_VALID_TRACK=1/);
  });

  it("holds the ground under the lane", () => {
    const ground = meshes.filter((m) => /^1GRASS/.test(m.name) && !/VERGE/.test(m.name));
    const g = surfaceHeight({ root: { kind: "node", name: "r", transform: [], children: ground } } as never, /^1GRASS/);
    const pit = surfaceHeight({ root: { kind: "node", name: "r", transform: [], children: meshes.filter((m) => m.name.startsWith("1ROAD_PIT_")) } } as never, /^1ROAD_PIT/);
    let found = 0;
    for (const x of [-20, -10, 0, 10, 20]) {
      for (const y of [26, 30, 34]) {
        const a = g(x, y), b = pit(x, y);
        expect(b).not.toBeNull();
        if (a !== null) { found++; expect(a).toBeLessThan(b!); }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("runs pit_lane.ai down the lane", () => {
    const pit = readFastLaneAi(r.files[`${r.slug}/ai/pit_lane.ai`]);
    expect(pit.some((a) => Math.abs(a.position[0]) < 2 && Math.abs(-a.position[2] - 30) < 1)).toBe(true);
  });
});
