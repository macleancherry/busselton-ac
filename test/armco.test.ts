import { describe, expect, it } from "vitest";
import {
  APPROACH, bendNeeds, buildArmco, crossingNeeds, curveSpeed, embankmentNeeds, tidyRuns, type Needs,
} from "../src/core/armco";
import type { Vec2 } from "../src/core/geo";
import { withDefaults } from "../src/core/options";
import { planRoad, SegmentIndex } from "../src/core/road";
import { buildTrack, type DataSources } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import { readKn5, type Kn5MeshNode, type Kn5Node } from "../src/core/kn5";
import type { LngLat } from "../src/core/geo";

const opts = withDefaults({ widthOverride: 7, banking: false });

/** 300 m east, a left-hand arc of `radius` through 90 degrees, then 300 m north. */
function bend(radius: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let x = -300; x < 0; x += 5) pts.push([x, 0]);
  for (let a = 0; a <= 90; a += 2) {
    const r = (a * Math.PI) / 180;
    pts.push([radius * Math.sin(r), radius - radius * Math.cos(r)]);
  }
  for (let y = radius + 5; y <= radius + 300; y += 5) pts.push([radius, y]);
  return pts;
}
const straight = (len = 600): Vec2[] => Array.from({ length: len / 5 + 1 }, (_, i) => [i * 5 - len / 2, 0] as Vec2);
const count = (a: boolean[]) => a.filter(Boolean).length;

describe("curve speed", () => {
  it("follows V^2 = 127 R (e + f), slower for tighter bends", () => {
    expect(curveSpeed(100)).toBeGreaterThan(55);
    expect(curveSpeed(100)).toBeLessThan(62);
    expect(curveSpeed(50)).toBeLessThan(curveSpeed(100));
    expect(curveSpeed(400)).toBeGreaterThan(85);
    expect(curveSpeed(400, 0.06)).toBeGreaterThan(95);
    expect(curveSpeed(100, 0.06)).toBeGreaterThan(curveSpeed(100));
    expect(curveSpeed(Infinity)).toBe(Infinity);
  });
});

describe("bend rail", () => {
  it("goes on the outside of a tight bend on an 80 road, and runs on past it", () => {
    const plan = planRoad(bend(60), opts);
    const [left, right] = bendNeeds(plan, opts, () => 80);
    expect(count(left)).toBe(0);
    // The arc is ~94 m; with approach and departure the rail is longer than the arc.
    expect(count(right) * opts.spacing).toBeGreaterThan(94 + APPROACH);
    // Nowhere near the far ends of the straights.
    expect(right[5]).toBe(false);
    expect(right[plan.samples.length - 5]).toBe(false);
    // On the arc itself.
    const mid = plan.samples.findIndex((s) => Math.hypot(s.pos[0] - 60 * Math.sin(Math.PI / 4), s.pos[1] - 60 * (1 - Math.cos(Math.PI / 4))) < 3);
    expect(right[mid]).toBe(true);
  });

  it("puts a right-hander's rail on the left", () => {
    const plan = planRoad(bend(60).map(([x, y]) => [x, -y] as Vec2), opts);
    const [left, right] = bendNeeds(plan, opts, () => 80);
    expect(count(left)).toBeGreaterThan(0);
    expect(count(right)).toBe(0);
  });

  it("leaves town streets and gentle bends alone", () => {
    const tight = planRoad(bend(60), opts);
    expect(bendNeeds(tight, opts, () => 50).flat().some(Boolean)).toBe(false);
    const gentle = planRoad(bend(500), opts);
    expect(bendNeeds(gentle, opts, () => 80).flat().some(Boolean)).toBe(false);
  });

  it("needs a flatter bend on a faster road", () => {
    const plan = planRoad(bend(180), opts);
    expect(bendNeeds(plan, opts, () => 80).flat().some(Boolean)).toBe(false);
    expect(bendNeeds(plan, opts, () => 110)[1].some(Boolean)).toBe(true);
  });
});

describe("embankment rail", () => {
  const plan = planRoad(straight(), opts);
  it("goes where a steep batter drops away, on that side only", () => {
    // Right of travel (south, y < 0) falls at 1:2 from the road edge; left is level.
    const ground = (_x: number, y: number) => (y < -3.5 ? (y + 3.5) * 0.5 : 0);
    const [left, right] = embankmentNeeds(plan, opts, ground);
    expect(count(left)).toBe(0);
    expect(count(right)).toBe(plan.samples.length);
  });

  it("leaves a gentle 1:6 batter and a shallow drop alone", () => {
    const gentle = (_x: number, y: number) => (y < -3.5 ? Math.max(-1.6, (y + 3.5) / 6) : 0);
    expect(embankmentNeeds(plan, opts, gentle).flat().some(Boolean)).toBe(false);
    const shallow = (_x: number, y: number) => (y < -3.5 ? -0.6 : 0);
    expect(embankmentNeeds(plan, opts, shallow).flat().some(Boolean)).toBe(false);
  });
});

describe("crossing rail", () => {
  const plan = planRoad(straight(), opts);
  const index = new SegmentIndex(plan);
  const at = (x: number) => plan.samples.findIndex((s) => s.pos[0] >= x);

  it("runs both sides along a bridge the road is on, with approach rail", () => {
    const [left, right] = crossingNeeds(plan, opts, index, { bridges: [[[-20, 0], [20, 0]]], waterways: [] });
    expect(left).toEqual(right);
    expect(left[at(0)]).toBe(true);
    expect(left[at(-20 - APPROACH + 3)]).toBe(true);
    expect(left[at(20 + APPROACH + 6)]).toBe(false);
    expect(left[at(-150)]).toBe(false);
  });

  it("ignores a bridge carrying another road over this one", () => {
    expect(crossingNeeds(plan, opts, index, { bridges: [[[0, -30], [0, 30]]], waterways: [] }).flat().some(Boolean)).toBe(false);
  });

  it("guards a stream or a culverted drain under the road, not an open ditch", () => {
    const under: Vec2[] = [[50, -40], [50, 40]];
    const stream = crossingNeeds(plan, opts, index, { bridges: [], waterways: [{ pts: under, cls: "stream" }] });
    expect(stream[0][at(50)] && stream[1][at(50)]).toBe(true);
    expect(stream[0][at(50 + APPROACH)]).toBe(true);
    expect(stream[0][at(0)]).toBe(false);
    const culvert = crossingNeeds(plan, opts, index, { bridges: [], waterways: [{ pts: under, cls: "drain", brunnel: "tunnel" }] });
    expect(culvert[0][at(50)]).toBe(true);
    const ditch = crossingNeeds(plan, opts, index, { bridges: [], waterways: [{ pts: under, cls: "ditch" }, { pts: under, cls: "drain" }] });
    expect(ditch.flat().some(Boolean)).toBe(false);
    // A stream beside the road, not under it.
    const beside = crossingNeeds(plan, opts, index, { bridges: [], waterways: [{ pts: [[-100, 15], [100, 15]], cls: "river" }] });
    expect(beside.flat().some(Boolean)).toBe(false);
  });
});

describe("tidy runs", () => {
  it("joins short gaps and drops short runs", () => {
    const a = new Array(100).fill(false);
    for (let i = 10; i < 25; i++) a[i] = true; // 30 m
    for (let i = 28; i < 40; i++) a[i] = true; // after a 6 m gap
    for (let i = 70; i < 75; i++) a[i] = true; // 10 m: too short
    const [out] = tidyRuns([a, []] as unknown as Needs, 2);
    expect(out.slice(10, 40).every(Boolean)).toBe(true);
    expect(out.slice(70, 75).some(Boolean)).toBe(false);
  });
});

describe("W-beam mesh", () => {
  const plan = planRoad(straight(200), opts);
  const n = plan.samples.length;
  const needs: Needs = [new Array(n).fill(false), new Array(n).fill(false)];
  for (let i = 20; i < 60; i++) needs[1][i] = true; // 80 m on the right
  const { rails, posts } = buildArmco(plan, opts, needs);
  const beam = rails.find((m) => m.name === "ARMCO_R_000")!;
  const wall = rails.find((m) => m.name === "1WALL_ARMCO_R_000")!;

  it("has a visual beam, an invisible collision wall and posts", () => {
    expect(beam).toBeDefined();
    expect(wall).toBeDefined();
    expect(wall.renderable).toBe(false);
    expect(beam.renderable ?? true).toBe(true);
    expect(rails.some((m) => m.name.includes("_L_"))).toBe(false);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0].name).toMatch(/^ARMCOPOSTS_/);
    // Posts every 2 m: 40 posts of two boxes (blockout and post), 20 vertices each.
    expect(posts.reduce((v, m) => v + m.positions.length / 3, 0)).toBe(40 * 2 * 20);
  });

  it("stands beside the road at rail height, with its face toward the road", () => {
    // AC space: x east, y up, z south. The right of an eastbound road is south (+z).
    let minZ = Infinity, maxY = -Infinity;
    for (let i = 0; i < beam.positions.length; i += 3) {
      minZ = Math.min(minZ, beam.positions[i + 2]);
      maxY = Math.max(maxY, beam.positions[i + 1]);
    }
    expect(minZ).toBeGreaterThan(3.5);
    expect(maxY).toBeGreaterThan(0.55);
    expect(maxY).toBeLessThan(0.8);
    // Some vertex normals point back north to the road (AC -z), and the back face's south.
    let north = 0, south = 0;
    for (let i = 0; i < beam.normals.length; i += 3) {
      if (beam.normals[i + 2] < -0.5) north++;
      if (beam.normals[i + 2] > 0.5) south++;
    }
    expect(north).toBeGreaterThan(0);
    expect(south).toBeGreaterThan(0);
  });

  it("buries its ends in the ground", () => {
    let minY = Infinity;
    for (let i = 1; i < beam.positions.length; i += 3) minY = Math.min(minY, beam.positions[i]);
    expect(minY).toBeLessThan(0);
  });
});

function meshes(nd: Kn5Node): Kn5MeshNode[] {
  return nd.kind === "mesh" ? [nd] : nd.children.flatMap(meshes);
}

describe("buildTrack with armco", async () => {
  const lat0 = -33.8, lng0 = 115.1;
  const mLat = 111_320, mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ll = ([x, y]: Vec2): LngLat => [lng0 + x / mLng, lat0 + y / mLat];
  const route = bend(70).filter((_, i) => i % 3 === 0).map(ll);
  const sources: DataSources = {
    dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, () => 50).sample,
    osm: { buildings: [], guardRails: [], crossings: { bridges: [], waterways: [{ pts: [ll([-150, -40]), ll([-150, 40])], cls: "stream" }] } },
  };
  const build = (armco: boolean) => buildTrack(route, { name: "Armco", corridor: 40, horizon: 0, textureSize: 64, imageryZoom: 0, trees: 0, buildings: false, armco }, sources);
  const on = meshes(readKn5((await build(true)).files["armco/armco.kn5"]).root);
  const off = meshes(readKn5((await build(false)).files["armco/armco.kn5"]).root);

  it("puts Armco on the bend and at the stream when on", () => {
    expect(on.some((m) => m.name.startsWith("ARMCO_R_"))).toBe(true);
    expect(on.some((m) => m.name.startsWith("ARMCO_L_"))).toBe(true); // the stream crossing guards both sides
    expect(on.some((m) => m.name.startsWith("1WALL_ARMCO_"))).toBe(true);
    expect(on.some((m) => m.name.startsWith("ARMCOPOSTS_"))).toBe(true);
    expect(on.some((m) => m.name.startsWith("1WALL_RAIL_"))).toBe(false);
  });

  it("builds nothing of it when off (flat ground, no mapped rail)", () => {
    expect(off.some((m) => /ARMCO|RAIL/.test(m.name))).toBe(false);
  });
});
