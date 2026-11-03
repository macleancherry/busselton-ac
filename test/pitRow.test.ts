import { describe, expect, it } from "vitest";
import type { AiPoint } from "../src/core/aiSpline";
import { IDENTITY, frameTransform, type Kn5GroupNode, type Kn5MeshNode, type Kn5Model } from "../src/core/kn5";
import { addPitRow, groundProbe, LANE_SHIFT, lineDistance, pitRow, pitWorld, PIT_CLEAR } from "../src/core/pitRow";
import { pitLaneAlong } from "../src/core/pitLane";

/** A flat quad over x0..x1, z0..z1 at height y. */
function quad(name: string, x0: number, x1: number, z0: number, z1: number, y: number): Kn5MeshNode {
  return {
    kind: "mesh", name, material: "m",
    positions: new Float32Array([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1]),
    normals: new Float32Array(12), uvs: new Float32Array(8), indices: new Uint16Array([0, 2, 1, 0, 3, 2]),
  };
}

/** A post 0.3 m square and 2 m tall at (x, z) on ground at height 0. */
function post(name: string, x: number, z: number): Kn5MeshNode {
  const s = 0.15;
  return {
    kind: "mesh", name, material: "m",
    positions: new Float32Array([x - s, 0, z, x + s, 0, z, x + s, 2, z, x - s, 2, z]),
    normals: new Float32Array(12), uvs: new Float32Array(8), indices: new Uint16Array([0, 2, 1, 0, 3, 2]),
  };
}

/**
 * A straight 8 m road along +x (AC z -4..4), kerbside verges (raised 15 cm, 3 m wide) and flat
 * terrain either side; `extra` meshes on top.
 */
function world(extra: Kn5MeshNode[] = []): Kn5Model {
  return {
    textures: [], materials: [],
    root: { kind: "node", name: "w", transform: IDENTITY, children: [
      quad("1GRASS_t000", -400, 400, -40, 40, -0.02),
      quad("1ROAD_000", -400, 400, -4, 4, 0),
      quad("1GRASS_STRIP_0", -400, 400, -7, -4, 0.15),
      quad("1GRASS_STRIP_1", -400, 400, 4, 7, 0.15),
      ...extra,
    ] },
  };
}

/** A straight AI line along +x at AC z (the left of travel is -z), 2 m apart, open. */
function line(z: number, from = -300, to = 300): AiPoint[] {
  const out: AiPoint[] = [];
  for (let x = from, i = 0; x <= to; x += 2, i++) {
    out.push({
      position: [x, 0, z], distance: i * 2, speed: 14, gas: 1, brake: 0, radius: 1000,
      sideLeft: 2, sideRight: 6, camber: 0, direction: 1, normal: [0, 1, 0], length: x + 2 <= to ? 2 : 0,
      forward: [1, 0, 0], grade: 0,
    });
  }
  return out;
}

describe("pit row", () => {
  it("puts every box off the carriageway, PIT_CLEAR or more from the AI line, near where it's asked", () => {
    const ai = line(-2);
    const w = pitWorld(world(), [ai]);
    const row = pitRow(ai, false, 8, w, { near: 300 })!;
    expect(row).not.toBeNull();
    expect(row.boxes).toHaveLength(8);
    const probe = groundProbe(world());
    const dist = lineDistance([ai]);
    for (const b of row.boxes) {
      expect(dist(b.pos[0], b.pos[2])).toBeGreaterThanOrEqual(PIT_CLEAR);
      expect(probe(b.pos[0], b.pos[2])!.road).toBe(false);
      // Facing along the line, half a metre over the ground.
      expect(b.fwd[0]).toBeCloseTo(1, 5);
      expect(b.pos[1] - probe(b.pos[0], b.pos[2])!.h).toBeCloseTo(0.5, 5);
    }
    // Box 0 at the front, the rest behind it.
    expect(row.boxes[0].pos[0]).toBeGreaterThan(row.boxes[7].pos[0]);
    // Near the asked place (300 m along is x = 0).
    expect(Math.abs(row.boxes[0].pos[0])).toBeLessThan(10);
  });

  it("runs its lane off the line, past every box on the road's side of it, and back on", () => {
    const ai = line(-2);
    const row = pitRow(ai, false, 6, pitWorld(world(), [ai]), { near: 300 })!;
    const dist = lineDistance([ai]);
    const lane = row.lane.pts;
    expect(dist(lane[0][0], lane[0][2])).toBeLessThan(0.1);
    expect(dist(lane[lane.length - 1][0], lane[lane.length - 1][2])).toBeLessThan(0.1);
    expect(Math.max(...lane.map((p) => dist(p[0], p[2])))).toBeCloseTo(row.offset - LANE_SHIFT, 1);
    for (const b of row.boxes) {
      const d = Math.min(...lane.map((p) => Math.hypot(p[0] - b.pos[0], p[2] - b.pos[2])));
      expect(d).toBeLessThan(3);
    }
    // As pit_lane.ai: the line before, the lane, the line after.
    const pit = pitLaneAlong(ai, row.lane, false)!;
    expect(pit).not.toBeNull();
    expect(Math.max(...pit.map((p) => dist(p.position[0], p.position[2])))).toBeGreaterThan(PIT_CLEAR - LANE_SHIFT);
  });

  it("keeps the boxes and the lane clear of anything standing there", () => {
    const ai = line(-2);
    // A row of posts 5 m apart along each verge, 4 m out from the kerb strips (AC z -11 and 11).
    const posts = Array.from({ length: 160 }, (_, k) => [post(`POLE_L${k}`, -400 + k * 5, -11), post(`POLE_R${k}`, -400 + k * 5, 11)]).flat();
    const w = pitWorld(world(posts), [ai]);
    const row = pitRow(ai, false, 8, w, { near: 300 })!;
    expect(row).not.toBeNull();
    for (const b of row.boxes) {
      for (const z of [-11, 11]) {
        // No post inside a box's footprint.
        const xs = Array.from({ length: 160 }, (_, k) => -400 + k * 5);
        expect(xs.some((x) => Math.abs(x - b.pos[0]) < 2.6 && Math.abs(z - b.pos[2]) < 1.2)).toBe(false);
      }
    }
    for (const p of row.lane.pts) expect(w.blocked(p[0], p[2])).toBe(false);
    // With posts every metre along the left verge's outer edge, the row is on the right.
    const fence = Array.from({ length: 800 }, (_, k) => post(`FENCE_${k}`, -400 + k, -9));
    const right = pitRow(ai, false, 8, pitWorld(world(fence), [ai]), { near: 300 })!;
    expect(right.side).toBe(-1);
    for (const b of right.boxes) expect(b.pos[2]).toBeGreaterThan(4);
  });

  it("keeps off the other lines it's given and off roundabouts", () => {
    const ai = line(-2);
    const other = line(-12);
    const row = pitRow(ai, false, 4, pitWorld(world(), [ai, other]), { near: 300, clearOf: [other], rings: [{ c: [0, 0], rOut: 20 }] })!;
    const dist = lineDistance([other]);
    for (const b of row.boxes) {
      expect(dist(b.pos[0], b.pos[2])).toBeGreaterThanOrEqual(PIT_CLEAR);
      expect(Math.abs(b.pos[0])).toBeGreaterThan(20);
    }
  });

  it("finds none where there's no ground beside the road", () => {
    const bare: Kn5Model = { textures: [], materials: [], root: { kind: "node", name: "w", transform: IDENTITY, children: [quad("1ROAD_000", -400, 400, -4, 4, 0)] } };
    const ai = line(-2);
    expect(pitRow(ai, false, 4, pitWorld(bare, [ai]))).toBeNull();
  });
});

describe("addPitRow", () => {
  const node = (name: string, x: number, z: number): Kn5GroupNode => ({ kind: "node", name, transform: frameTransform([x, 0.5, z], [1, 0, 0]), children: [] });

  it("adds the boxes the bays didn't give, near the grid's front, and returns the lane", () => {
    const ai = line(-2);
    const dummies = [node("AC_START_0", 100, -2), node("AC_START_1", 92, -2), node("AC_PIT_1", 50, 30)];
    const lane = addPitRow(dummies, ai, false, 3, pitWorld(world(), [ai]));
    expect(lane).not.toBeNull();
    const pits = dummies.filter((d) => d.name.startsWith("AC_PIT_")).map((d) => d.name).sort();
    expect(pits).toEqual(["AC_PIT_0", "AC_PIT_1", "AC_PIT_2"]);
    // The bay stays where it was.
    expect(dummies.find((d) => d.name === "AC_PIT_1")!.transform[12]).toBe(50);
    const b0 = dummies.find((d) => d.name === "AC_PIT_0")!;
    expect(Math.abs(b0.transform[12] - 100)).toBeLessThan(40);
  });

  it("with no room anywhere, still gives every box, off the line, and no lane", () => {
    const bare: Kn5Model = { textures: [], materials: [], root: { kind: "node", name: "w", transform: IDENTITY, children: [quad("1ROAD_000", -400, 400, -4, 4, 0)] } };
    const ai = line(-2);
    const dummies = [node("AC_START_0", 100, -2)];
    const warned: string[] = [];
    expect(addPitRow(dummies, ai, false, 4, pitWorld(bare, [ai]), {}, (m) => warned.push(m))).toBeNull();
    const pits = dummies.filter((d) => d.name.startsWith("AC_PIT_"));
    expect(pits).toHaveLength(4);
    const dist = lineDistance([ai]);
    for (const p of pits) expect(dist(p.transform[12], p.transform[14])).toBeGreaterThanOrEqual(PIT_CLEAR);
    expect(warned).toHaveLength(1);
  });
});
