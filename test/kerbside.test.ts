import { describe, expect, it } from "vitest";
import { buildKerbside, fitKerbside, kerbsideFromTags, ribbonZ, type Carriageway, type KerbsideWay } from "../src/core/kerbside";
import type { LngLat, Vec2 } from "../src/core/geo";
import type { Kn5MeshNode, Kn5Node } from "../src/core/kn5";
import { buildTrack, type DataSources, type OsmFeatures } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
// @ts-expect-error plain .mjs module without types
import { PRESETS } from "../scripts/headless/presets.mjs";

/** A straight east-west street from x0 to x1 at y, `w` wide, on flat ground at height 10. */
function street(x0: number, x1: number, w: number, y = 0, extra: Partial<Carriageway> = {}): Carriageway {
  const pts: Vec2[] = [];
  for (let x = x0; x <= x1 + 1e-9; x += 4) pts.push([x, y]);
  return { pts, widths: pts.map(() => w), z: () => 10, photoParking: true, ...extra };
}

/** Every painted vertex in local ENU (kn5 meshes are in AC space: x, y up, z = -north). */
function verts(nodes: Kn5MeshNode[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const n of nodes) {
    const p = n.positions;
    for (let i = 0; i < p.length; i += 3) out.push([p[i], -p[i + 2], p[i + 1]]);
  }
  return out;
}

describe("kerbside tags", () => {
  it("reads the current parking scheme", () => {
    expect(kerbsideFromTags({ "parking:both": "lane", "parking:both:orientation": "diagonal" })).toEqual({
      left: { parking: "diagonal" }, right: { parking: "diagonal" },
    });
    expect(kerbsideFromTags({ "parking:left": "lane", "parking:right": "no" })).toEqual({
      left: { parking: "parallel" }, right: { parking: "no" },
    });
    // Unmarked, or off the carriageway: nothing painted and nothing guessed.
    expect(kerbsideFromTags({ "parking:both": "lane", "parking:both:markings": "no" })?.left.parking).toBe("no");
    expect(kerbsideFromTags({ "parking:both": "half_on_kerb" })?.right.parking).toBe("no");
  });

  it("reads the older parking:lane scheme", () => {
    expect(kerbsideFromTags({ "parking:lane:both": "parallel" })?.left.parking).toBe("parallel");
    expect(kerbsideFromTags({ "parking:lane:right": "perpendicular" })).toEqual({ left: {}, right: { parking: "perpendicular" } });
    expect(kerbsideFromTags({ "parking:lane:left": "marked" })?.left.parking).toBe("parallel");
    expect(kerbsideFromTags({ "parking:lane:both": "no_stopping" })?.left.parking).toBe("no");
    expect(kerbsideFromTags({ "parking:lane:both": "parallel", "parking:lane:both:parallel": "on_kerb" })?.left.parking).toBe("no");
  });

  it("reads bike lanes, side by side or for the whole way", () => {
    expect(kerbsideFromTags({ "cycleway:left": "lane" })).toEqual({ left: { cycle: "lane" }, right: {} });
    expect(kerbsideFromTags({ "cycleway:both": "lane" })?.right.cycle).toBe("lane");
    expect(kerbsideFromTags({ cycleway: "lane" })).toEqual({ left: { cycle: "lane" }, right: { cycle: "lane" } });
    expect(kerbsideFromTags({ cycleway: "shared_lane" })?.left.cycle).toBe("shared");
    // One-way: the lane is on the side its traffic keeps to.
    expect(kerbsideFromTags({ cycleway: "lane", oneway: "yes" })).toEqual({ left: { cycle: "lane" }, right: { cycle: "no" } });
    expect(kerbsideFromTags({ cycleway: "lane", oneway: "-1" })).toEqual({ left: { cycle: "no" }, right: { cycle: "lane" } });
  });

  it("says nothing for a plain street", () => {
    expect(kerbsideFromTags({ highway: "residential", name: "X St" })).toBeNull();
  });
});

describe("fitting to the asphalt", () => {
  it("keeps parking and bike lanes on a wide street", () => {
    const f = fitKerbside(14, { parking: "parallel", cycle: "lane" }, { parking: "parallel", cycle: "lane" });
    expect(f.left).toEqual({ park: "parallel", depth: 2.1, bike: "lane", bikeW: 1.5 });
  });

  it("narrows, then drops, parking before bike lanes", () => {
    const narrower = fitKerbside(9.25, { parking: "parallel" }, { parking: "parallel" });
    expect(narrower.left.depth).toBe(1.8);
    const narrow = fitKerbside(8.5, { parking: "parallel", cycle: "lane" }, { parking: "parallel", cycle: "lane" });
    expect(narrow.left.park).toBeUndefined();
    expect(narrow.left.bikeW).toBe(1.2);
    const tiny = fitKerbside(6, { cycle: "lane" }, { cycle: "lane" });
    expect(tiny.left.bike).toBeUndefined();
  });

  it("needs only one lane's width on a one-way street", () => {
    expect(fitKerbside(7.2, { parking: "parallel" }, { parking: "parallel" }, true).left.depth).toBe(2.1);
    expect(fitKerbside(7.2, { parking: "parallel" }, { parking: "parallel" }, false).left.park).toBeUndefined();
  });
});

describe("ribbon height", () => {
  it("is exact on the street's triangles", () => {
    // Left edge 0 then 1, right edge 0 then 3, 4 m wide.
    const z = ribbonZ([0, 1], [0, 3], [4, 4]);
    expect(z(0, 2)).toBeCloseTo(0);
    expect(z(1, 2)).toBeCloseTo(1);
    expect(z(1, -2)).toBeCloseTo(3);
    // On the diagonal left_0 - right_1, halfway.
    expect(z(0.5, 0)).toBeCloseTo(1.5);
  });
});

describe("painting", () => {
  const tagged = (left: KerbsideWay["left"], right: KerbsideWay["right"], reverse = false): KerbsideWay => {
    const pts: Vec2[] = [[-10, 0.5], [210, 0.5]];
    return { pts: reverse ? pts.reverse() : pts, left, right };
  };

  it("paints parallel bays 6 m apart on both kerbs, on the surface", () => {
    const r = buildKerbside([street(0, 200, 12)], [tagged({ parking: "parallel" }, { parking: "parallel" })]);
    expect(r.bays).toBe(2 * 33);
    expect(r.nodes.length).toBeGreaterThan(0);
    expect(r.nodes.every((n) => n.name.startsWith("KERBSIDE_") && n.material === "paint")).toBe(true);
    const v = verts(r.nodes);
    expect(v.every((p) => Math.abs(p[2] - 10.015) < 1e-4)).toBe(true);
    // From the kerb (6 m out) to the bays' outer end, 2.1 m in.
    const ys = v.map((p) => Math.abs(p[1]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(6);
    expect(Math.min(...ys)).toBeGreaterThan(3.8);
  });

  it("turns the sides round when the OSM way runs the other way", () => {
    const r = buildKerbside([street(0, 200, 12)], [tagged({ parking: "parallel" }, {}, true)]);
    expect(r.bays).toBe(33);
    expect(verts(r.nodes).every((p) => p[1] < 0)).toBe(true);
  });

  it("breaks at a side street", () => {
    const main = street(0, 200, 12);
    const side: Carriageway = { pts: [[100, 6], [100, 80]], widths: [7, 7], z: () => 10 };
    const r = buildKerbside([main, side], [tagged({ parking: "parallel" }, {})]);
    const left = verts(r.nodes).filter((p) => p[1] > 0);
    expect(left.length).toBeGreaterThan(0);
    // Nothing within the side street's half width plus 4 m of its centreline.
    expect(left.some((p) => Math.abs(p[0] - 100) < 7.3)).toBe(false);
    expect(r.bays).toBeLessThan(33);
  });

  it("breaks wherever the caller rules out (roundabouts)", () => {
    const r = buildKerbside([street(0, 200, 12)], [tagged({ parking: "parallel" }, { parking: "parallel" })], [], (x) => x > 100);
    expect(verts(r.nodes).every((p) => p[0] < 101)).toBe(true);
  });

  it("paints bays where the photo shows cars along the kerb, and only there", () => {
    const cars = [40, 52, 63, 76].map((x) => ({ at: [x, 4.8] as Vec2, dir: [1, 0] as Vec2 }));
    // A lone car on the other side, and one parked across the kerb (a driveway), make no bays.
    cars.push({ at: [150, -4.8], dir: [1, 0] }, { at: [120, 4.8], dir: [0, 1] });
    const r = buildKerbside([street(0, 200, 12)], [], cars);
    const v = verts(r.nodes);
    expect(r.bays).toBe(7); // 36 m to 80 m
    expect(v.every((p) => p[1] > 0 && p[0] > 35 && p[0] < 81)).toBe(true);
  });

  it("doesn't guess where OSM says there's no parking", () => {
    const cars = [40, 52, 63].map((x) => ({ at: [x, 4.8] as Vec2, dir: [1, 0] as Vec2 }));
    const r = buildKerbside([street(0, 200, 12)], [tagged({ parking: "no" }, {})], cars);
    expect(r.bays).toBe(0);
  });

  it("paints a bike lane line and bicycles every 60 m", () => {
    const r = buildKerbside([street(0, 300, 10)], [{ pts: [[-10, 0], [310, 0]], left: { cycle: "lane" }, right: {} }]);
    expect(r.bikeLaneMetres).toBeCloseTo(300);
    expect(r.symbols).toBe(5);
    const v = verts(r.nodes);
    // The line 1.5 m in from the 5 m kerb; the bicycles inside the lane.
    expect(v.filter((p) => Math.abs(p[1] - 3.5) < 0.06).length).toBeGreaterThan(300);
    expect(v.every((p) => p[1] > 3.4 && p[1] < 5)).toBe(true);
  });

  it("puts the bike lane outside the parking", () => {
    const r = buildKerbside([street(0, 200, 14)], [tagged({ parking: "parallel", cycle: "lane" }, {})]);
    const v = verts(r.nodes);
    // Kerb at 7, bays to 4.9, bike lane line at 3.4.
    expect(v.some((p) => Math.abs(p[1] - 3.4) < 0.06)).toBe(true);
    expect(Math.min(...v.map((p) => p[1]))).toBeGreaterThan(3.3);
  });

  it("leans angle bays so cars turn in from their own side's traffic", () => {
    const r = buildKerbside([street(0, 100, 16)], [{ pts: [[-10, 0], [110, 0]], left: { parking: "diagonal" }, right: { parking: "diagonal" } }]);
    expect(r.bays).toBeGreaterThan(40);
    const v = verts(r.nodes);
    // Left side (traffic eastbound): the bay lines' kerb ends lie east of their outer ends, so the
    // westernmost paint is out on the bays' outer line, not at the kerb.
    const left = v.filter((p) => p[1] > 0);
    const west = left.reduce((a, p) => (p[0] < a[0] ? p : a));
    expect(west[1]).toBeLessThan(5);
    const right = v.filter((p) => p[1] < 0);
    const east = right.reduce((a, p) => (p[0] > a[0] ? p : a));
    expect(east[1]).toBeGreaterThan(-5);
  });

  it("is on for the town preset", () => {
    expect(PRESETS.town.build.kerbside).toBe(true);
  });
});

describe("in a build", async () => {
  // A flat 600 m town street heading east, 12 m wide, parking tagged on both sides.
  const lat0 = -33.65, lng0 = 115.35, kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const route: LngLat[] = Array.from({ length: 31 }, (_, i) => [lng0 + (i * 20) / kx, lat0]);
  const osm: OsmFeatures = { buildings: [], guardRails: [], kerbside: [{ pts: [route[0], route[30]], left: { parking: "parallel" }, right: { parking: "parallel" } }] };
  const sources: DataSources = { dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, () => 5).sample, widthAt: () => 12, osm };
  const opts = { name: "Kerb Test", imageryZoom: 0, corridor: 40, banking: false, sideStreets: false, buildings: false, trees: 0 };
  const on = await buildTrack(route, { ...opts, kerbside: true }, sources);
  const off = await buildTrack(route, opts, sources);
  const names = (n: Kn5Node): string[] => [n.name, ...(n.kind === "mesh" ? [] : n.children.flatMap(names))];

  it("paints the bays into the track, and only when asked", () => {
    expect(on.stats.kerbside?.bays).toBeGreaterThan(100);
    expect(off.stats.kerbside).toBeUndefined();
    expect(names(on.model.root).some((n) => n.startsWith("KERBSIDE_"))).toBe(true);
    expect(names(off.model.root).some((n) => n.startsWith("KERBSIDE_"))).toBe(false);
  });
});
