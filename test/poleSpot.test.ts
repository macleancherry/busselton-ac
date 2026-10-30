import { describe, expect, it } from "vitest";
import { clearSpot, footOnRoad, onRoadFrom } from "../src/core/poleSpot";
import { checkPoles } from "../src/core/poleCheck";
import { planRoad, SegmentIndex } from "../src/core/road";
import { withDefaults } from "../src/core/options";
import { carParkLights, lampArms, outreach, placeUtilities } from "../src/core/utilities";
import { buildPieces, seenFeatures, type Piece } from "../src/core/furniture";
import { ArtList } from "../src/core/art";
import { MeshBuilder } from "../src/core/mesh";
import { topSurface } from "../src/core/sceneGround";
import type { Kn5Node } from "../src/core/kn5";
import type { Vec2 } from "../src/core/geo";

const group = (name: string, children: Kn5Node[]): Kn5Node => ({ kind: "node", name, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children });
const square = (name: string, x0: number, y0: number, x1: number, y1: number, z: number) => {
  const mb = new MeshBuilder();
  const a = mb.vertex([x0, y0, z], 0, 0), b = mb.vertex([x1, y0, z], 1, 0), c = mb.vertex([x1, y1, z], 1, 1), d = mb.vertex([x0, y1, z], 0, 1);
  mb.quad(a, b, c, d);
  return mb.toKn5(name, name.startsWith("1ROAD") || name.startsWith("1STREET") ? "asphalt" : "grass");
};

// An 8 m street heading east along y = 0, 600 m long, on flat ground at 10 m.
const path: Vec2[] = Array.from({ length: 31 }, (_, i) => [i * 20, 0]);
const opts = withDefaults({ widthOverride: 8 });
const plan = planRoad(path, opts);
plan.samples.forEach((s) => (s.h = 10));
const index = new SegmentIndex(plan);
const flat = () => 10;

// The built ground: grass everywhere, the route's asphalt, and a side street going north at x = 300.
const terrain = square("1GRASS_t000", -50, -60, 650, 60, 10);
const route = square("1ROAD_000", -50, -4, 650, 4, 10);
const side = square("1STREET_000", 296, 0, 304, 60, 10);
const drivable = topSurface([route, side], /^\d(ROAD|STREET)/);
const onRoad = onRoadFrom(drivable);
/** A world with the pieces as furniture, for checkPoles. */
const world = (pieces: Piece[], extra: Kn5Node[] = []) =>
  group("track", [group("TERRAIN", [terrain]), group("ROAD", [route]), group("SIDESTREETS", [side]), group("FURNITURE", buildPieces(pieces, null)), ...extra]);

describe("pole spots off the road", () => {
  it("leaves a clear spot alone, and moves one on the road to the nearest clear spot", () => {
    expect(clearSpot([100, 6], onRoad)).toEqual([100, 6]);
    const p = clearSpot([100, 3], onRoad, { radius: 0.35, away: [0, 1] })!;
    expect(p[0]).toBeCloseTo(100, 6);
    expect(p[1]).toBeGreaterThanOrEqual(4.35);
    expect(p[1]).toBeLessThan(4.7);
    expect(footOnRoad(p, 0.35, onRoad)).toBe(false);
    // In the middle of the side street, with no direction: out to whichever kerb is nearer.
    const q = clearSpot([301, 30], onRoad)!;
    expect(q[0]).toBeGreaterThan(304);
    expect(q[0]).toBeLessThan(305.5);
    // Nothing clear within reach: dropped.
    expect(clearSpot([200, 0], onRoad, { reach: 2 })).toBeNull();
    // No road test: as given.
    expect(clearSpot([100, 0], undefined)).toEqual([100, 0]);
  });
});

describe("street lights joined to their poles", () => {
  it("hangs every lantern under an arm from a pole, over the road edge, at a street light's height", () => {
    const u = placeUtilities({ poles: [], lamps: [], lines: [] }, plan, index, opts, flat, () => 2, () => false, onRoad);
    expect(u.lights.length).toBeGreaterThan(5);
    for (const l of u.lights) {
      expect(l[2] - 10).toBeGreaterThan(7.5);
      expect(l[2] - 10).toBeLessThan(9);
      expect(Math.abs(l[1])).toBeLessThan(4); // over the road, inside its 4 m half width
    }
    const r = checkPoles(world(u.pieces));
    expect(r.lights).toBe(u.lights.length);
    expect(r.looseLamps).toEqual([]);
    expect(r.polesOnRoad).toEqual([]);
  });

  it("puts a seen lantern's pole on the verge and reaches the arm out to where it was seen", () => {
    // Seen over the road 2 m in from the kerb; the pole goes on the verge (5 m out), the arm reaches 3 m.
    const u = placeUtilities({ poles: [], lamps: [[150, 2]], lines: [] }, plan, index, opts, flat, () => 0, () => false, onRoad);
    expect(u.lights).toHaveLength(1);
    expect(u.lights[0][0]).toBeCloseTo(150, 1);
    expect(u.lights[0][1]).toBeCloseTo(2, 1);
    expect(checkPoles(world(u.pieces)).looseLamps).toEqual([]);
  });

  it("moves a pole seen on a side street off it, and never stands one on the road", () => {
    // Power pole and a light both seen in the side street's carriageway.
    const u = placeUtilities({ poles: [[299, 20]], lamps: [[301, 12]], lines: [] }, plan, index, opts, flat, () => 0, () => false, onRoad);
    const r = checkPoles(world(u.pieces));
    expect(r.poles).toBeGreaterThanOrEqual(2);
    expect(r.polesOnRoad).toEqual([]);
    expect(r.looseLamps).toEqual([]);
    // Without the road test the old behaviour shows: poles on the side street.
    const old = placeUtilities({ poles: [[299, 20]], lamps: [[301, 12]], lines: [] }, plan, index, opts, flat, () => 0);
    expect(checkPoles(world(old.pieces)).polesOnRoad.length).toBeGreaterThan(0);
  });

  it("gives a pole in a median two arms, one over each carriageway", () => {
    const base = { at: [100, 5] as Vec2, out: [0, 1] as Vec2 };
    const far = square("1ROAD_001", -50, 7, 650, 15, 10); // a second carriageway 2 m behind the pole
    const both = onRoadFrom(topSurface([route, far], /^\dROAD/));
    const arms = lampArms(base, undefined, plan, index, both);
    expect(arms).toHaveLength(2);
    expect(arms[0].dir[1]).toBeCloseTo(-1, 6);
    expect(arms[1].dir[1]).toBeCloseTo(1, 6);
    // A street ending 2 m behind it (road behind, but not running along): one arm.
    const stub = (x: number, y: number) => Math.abs(y) <= 4 || (y <= -8 && Math.abs(x - 300) <= 4);
    expect(lampArms({ at: [300, -6], out: [0, -1] }, undefined, plan, index, stub)).toHaveLength(1);
  });

  it("builds the lantern under the arm's end and the arm from inside the pole", () => {
    const { pieces, light } = outreach([0, 0], 10, [1, 0], 2.5);
    const [arm, lamp] = pieces as Extract<Piece, { kind: "box" }>[];
    expect(arm.at[0] - arm.length / 2).toBeCloseTo(0, 6);
    expect(lamp.at[0] + lamp.length / 2).toBeLessThanOrEqual(arm.at[0] + arm.length / 2 + 1e-9);
    expect(lamp.z1).toBeGreaterThan(arm.z0);
    expect(light[0]).toBeCloseTo(lamp.at[0], 6);
  });

  it("joins car park lanterns to their pole", () => {
    const { pieces } = carParkLights([[[0, 30], [120, 30]]], flat, () => false);
    expect(checkPoles(world(pieces)).looseLamps).toEqual([]);
  });
});

describe("the pole check", () => {
  const pole = (at: Vec2, z0 = 10 - 0.02): Piece => ({ kind: "box", at, along: [1, 0], length: 0.16, depth: 0.16, z0, z1: 18.5, material: "steel" });
  const head = (at: Vec2): Piece => ({ kind: "box", at, along: [0, 1], length: 0.7, depth: 0.32, z0: 18.2, z1: 18.36, material: "lamp" });

  it("flags a lamp head with no arm to its pole", () => {
    const r = checkPoles(world([pole([100, 6]), head([100, 4.5])]));
    expect(r.looseLamps).toHaveLength(1);
    expect(r.looseLamps[0].up).toBeCloseTo(8.2, 1);
    expect(r.looseLamps[0].z).toBeCloseTo(-4.5, 1);
  });

  it("passes a lamp head on an arm, and flags it again when the pole floats", () => {
    const arm: Piece = { kind: "box", at: [100, 5.1], along: [0, 1], length: 1.8, depth: 0.08, z0: 18.32, z1: 18.42, material: "steel" };
    expect(checkPoles(world([pole([100, 6]), arm, head([100, 4.5])])).looseLamps).toEqual([]);
    expect(checkPoles(world([pole([100, 6], 11), arm, head([100, 4.5])])).looseLamps).toHaveLength(1);
  });

  it("flags posts on the route or a side street, not on the verge or a real island", () => {
    const r = checkPoles(world([pole([100, 2]), pole([300, 30]), pole([100, 6])]));
    expect(r.poles).toBe(3);
    expect(r.polesOnRoad.map((p) => p.road).sort()).toEqual(["1ROAD_000", "1STREET_000"]);
    // An island: a raised kerbed slab over the road, not a road mesh.
    const island = square("1KERB_ISLAND", 198, -1, 202, 1, 10.15);
    const onIsland = checkPoles(group("track", [group("TERRAIN", [terrain]), group("ROAD", [route]), group("KERBS", [island]), group("FURNITURE", buildPieces([pole([200, 0], 10.13)], null))]));
    expect(onIsland.polesOnRoad).toEqual([]);
  });
});

describe("seen signals and signs", () => {
  it("moves a signal seen in a side street onto the footpath", () => {
    const art = new ArtList();
    const pieces = seenFeatures([{ value: "object--traffic-light--general-upright", at: [301, 12] }], plan, index, opts, art, flat, onRoad);
    const posts = pieces.filter((p): p is Extract<Piece, { kind: "box" }> => p.kind === "box" && p.material === "steel");
    expect(posts).toHaveLength(1);
    expect(footOnRoad(posts[0].at, 0.07, onRoad)).toBe(false);
    expect(checkPoles(world(pieces)).polesOnRoad).toEqual([]);
  });
});
