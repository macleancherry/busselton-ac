// Street furniture, from docs/specs/furniture.md (written fresh with the rewrite).
import { describe, expect, it } from "vitest";
import { ArtList, type ArtAtlas } from "../src/core/art";
import { buildPieces, gateSigns, kangarooSigns, landmarks, mergeSightings, off, seenFeatures, signArt, streetSigns, type Piece } from "../src/core/furniture";
import type { BoxPiece, FacePiece, BladePiece } from "../src/core/pieces";
import type { Vec2 } from "../src/core/geo";
import { withDefaults } from "../src/core/options";
import { planRoad, SegmentIndex, type RoadPlan } from "../src/core/road";
import type { Roundabout } from "../src/core/roundabout";
import { SINK } from "../src/core/sceneGround";
import type { StreetPlan } from "../src/core/sideStreets";

// An 8 m road heading east along y = 0 for 6 km, 1.5 m verges.
const opts = withDefaults({ widthOverride: 8 });
const makePlan = (len = 6000): RoadPlan => {
  const p = planRoad(Array.from({ length: len / 20 + 1 }, (_, i) => [i * 20, 0] as Vec2), opts);
  p.samples.forEach((s) => (s.h = 10));
  return p;
};
const plan = makePlan();
const index = new SegmentIndex(plan);
const flat = () => 10;
const tilted = (x: number, y: number) => 10 + 0.05 * x + 0.1 * y;
const ring = (c: Vec2): Roundabout => ({ c, r: 12, w: 8, lanes: 1, hc: 10 } as unknown as Roundabout);
const withRing = (c: Vec2): RoadPlan => ({ ...plan, roundabouts: [ring(c)] });

const boxes = (ps: Piece[]) => ps.filter((p): p is BoxPiece => p.kind === "box");
const faces = (ps: Piece[]) => ps.filter((p): p is FacePiece => p.kind === "face");
const blades = (ps: Piece[]) => ps.filter((p): p is BladePiece => p.kind === "blade");

const streets = (names: (string | undefined)[], junctions: StreetPlan["junctions"]): StreetPlan => ({ streets: [], junctions, routeNames: names });
const routeNamed = (name?: string) => plan.samples.map(() => name);

describe("street name signs", () => {
  const j = { seg: 50, s: 1000, side: 1 as const, width: 6, dir: [0, 1] as Vec2, name: "Kent St" };

  it("puts one post and a blade at a named junction, before the mouth, on its side", () => {
    const art = new ArtList();
    const ps = streetSigns(streets(routeNamed(), [j]), plan, opts, art, flat);
    expect(boxes(ps)).toHaveLength(1);
    expect(blades(ps)).toHaveLength(1);
    const p = boxes(ps)[0];
    expect(p.at[0]).toBeCloseTo(1000 - 5.5, -1);
    expect(p.at[1]).toBeCloseTo(4 + 0.9, 6);
    expect(p.z1 - p.z0).toBeCloseTo(3.0 + SINK, 6);
    expect(blades(ps)[0].along).toEqual([0, 1]);
    expect(art.list.map((a) => a.key)).toEqual(["street:Kent St"]);
  });

  it("adds the route's name above when it differs, along the route", () => {
    const ps = streetSigns(streets(routeNamed("Queen St"), [j]), plan, opts, new ArtList(), flat);
    const bl = blades(ps).sort((a, b) => a.z - b.z);
    expect(bl).toHaveLength(2);
    expect(bl[0].z).toBeCloseTo(12.62, 6);
    expect(bl[1].z).toBeCloseTo(12.86, 6);
    expect(bl[1].along[0]).toBeCloseTo(1, 6);
    expect(blades(streetSigns(streets(routeNamed("Kent St"), [j]), plan, opts, new ArtList(), flat))).toHaveLength(1);
  });

  it("skips unnamed junctions and those by a roundabout; right-side signs go past the mouth", () => {
    expect(streetSigns(streets(routeNamed(), [{ ...j, name: undefined }]), plan, opts, new ArtList(), flat)).toEqual([]);
    expect(streetSigns(streets(routeNamed(), [j]), withRing([995, 18]), opts, new ArtList(), flat)).toEqual([]);
    const r = boxes(streetSigns(streets(routeNamed(), [{ ...j, side: -1, dir: [0, -1] }]), plan, opts, new ArtList(), flat))[0];
    expect(r.at[0]).toBeGreaterThan(1000);
    expect(r.at[1]).toBeCloseTo(-4.9, 6);
  });

  it("stands the post SINK into tilted ground, blades measured from the same ground", () => {
    const ps = streetSigns(streets(routeNamed("Queen St"), [j]), plan, opts, new ArtList(), tilted);
    const p = boxes(ps)[0];
    const g = tilted(p.at[0], p.at[1]);
    expect(p.z0).toBeCloseTo(g - SINK, 6);
    for (const b of blades(ps)) expect(b.z - g).toBeGreaterThan(2.6);
  });

  it("moves a post off a drivable surface, or drops it", () => {
    const onRoad = (x: number, y: number) => Math.abs(y) <= 4 || (y > 0 && y < 6 && x > 990 && x < 1000);
    const p = boxes(streetSigns(streets(routeNamed(), [j]), plan, opts, new ArtList(), flat, onRoad))[0];
    expect(onRoad(p.at[0], p.at[1])).toBe(false);
    expect(streetSigns(streets(routeNamed(), [j]), plan, opts, new ArtList(), flat, () => true)).toEqual([]);
  });
});

describe("landmarks", () => {
  const cafe = (x: number, y: number, name = "Bean There") => ({ at: [x, y] as Vec2, cls: "cafe", subclass: "cafe", name });

  it("gives a cafe a two-legged pylon facing traffic, printed both sides", () => {
    const ps = landmarks([cafe(500, 20)], plan, index, opts, new ArtList(), () => 10, flat);
    const legs = boxes(ps);
    expect(legs).toHaveLength(2);
    const f = faces(ps)[0];
    expect(f.twoSided).toBe(true);
    expect(f.normal[0]).toBeCloseTo(-1, 6); // left side: faces traffic coming forward
    expect(f.at[1]).toBeCloseTo(4 + 1.5 + 2.5, 6);
    expect(f.z0 + f.height).toBeCloseTo(13.2, 6);
  });

  it("keeps signs 12 m apart on a side, not across sides, the same in any order", () => {
    const list = [cafe(500, 20, "A"), cafe(508, 20, "B"), cafe(504, -20, "C")];
    const a = landmarks(list, plan, index, opts, new ArtList(), () => 10, flat);
    expect(faces(a)).toHaveLength(2);
    const b = landmarks([list[2], list[1], list[0]], plan, index, opts, new ArtList(), () => 10, flat);
    expect(b).toEqual(a);
  });

  it("caps named signs at 80, names unnamed fuel FUEL, and needs room for the panel", () => {
    const many = Array.from({ length: 100 }, (_, i) => cafe(100 + i * 20, 20, `C${i}`));
    expect(faces(landmarks(many, plan, index, opts, new ArtList(), () => 10, flat))).toHaveLength(80);
    const art = new ArtList();
    landmarks([{ at: [700, 20], cls: "fuel", subclass: "fuel" }], plan, index, opts, art, () => 10, flat);
    expect(art.list.some((r) => r.kind === "poi" && r.text === "FUEL")).toBe(true);
    expect(art.list.some((r) => r.key === "back")).toBe(true);
    const tight = (_x: number, y: number) => (y > 8.5 ? 0.5 : 10);
    expect(landmarks([cafe(500, 20)], plan, index, opts, new ArtList(), tight, flat)).toEqual([]);
  });

  it("puts a pylon for a POI on the road at the property line", () => {
    const f = faces(landmarks([cafe(500, 1)], plan, index, opts, new ArtList(), () => 10, flat))[0];
    expect(f.at[1]).toBeCloseTo(8, 6);
  });

  it("builds a bus stop post and sign, and a shelter only with room, on the shelter's ground", () => {
    const bus = { at: [900, -10] as Vec2, cls: "bus", subclass: "bus_stop" };
    const none = landmarks([bus], plan, index, opts, new ArtList(), () => 1, tilted);
    expect(boxes(none)).toHaveLength(1);
    expect(faces(none)[0].normal[0]).toBeCloseTo(1, 6); // right side faces traffic coming back
    const ps = landmarks([bus], plan, index, opts, new ArtList(), () => 5, tilted);
    expect(boxes(ps).length).toBeGreaterThan(5);
    const glass = boxes(ps).find((b) => b.material === "glass")!;
    expect(glass.z0).toBeCloseTo(tilted(glass.at[0], glass.at[1]) - SINK, 6);
    expect(glass.at[1]).toBeCloseTo(-(4 + 1.5 + 2.3 + 0.75), 6);
  });

  it("builds a servo canopy only when the servo is off the road", () => {
    const far = landmarks([{ at: [1200, 30], cls: "fuel", subclass: "fuel", name: "Servo" }], plan, index, opts, new ArtList(), () => 10, tilted);
    expect(boxes(far).filter((b) => b.material === "canopy")).toHaveLength(1);
    const cols = boxes(far).filter((b) => b.material === "steel" && b.length === 0.35);
    expect(cols).toHaveLength(4);
    for (const c of cols) expect(c.z0).toBeCloseTo(tilted(c.at[0], c.at[1]) - SINK, 6);
    const near = landmarks([{ at: [1200, 8], cls: "fuel", subclass: "fuel", name: "Servo" }], plan, index, opts, new ArtList(), () => 10, flat);
    expect(boxes(near).filter((b) => b.material === "canopy")).toHaveLength(0);
  });
});

describe("Mapillary objects", () => {
  it("merges repeat sightings within their category's radius", () => {
    const out = mergeSightings([
      { at: [0, 0], value: "object--traffic-light--general-upright" },
      { at: [2, 0], value: "object--traffic-light--general-upright" },
      { at: [1, 1.5], value: "object--traffic-light--general-upright" },
      { at: [10, 0], value: "object--traffic-light--general-upright" },
      { at: [50, 0], value: "regulatory--stop--g1" },
      { at: [53, 0], value: "regulatory--stop--g2" },
    ]);
    expect(out).toHaveLength(3);
    expect(out[0].at[0]).toBeCloseTo(1, 6);
    expect(out[0].at[1]).toBeCloseTo(0.5, 6);
    expect(out[2].value).toBe("regulatory--stop--g1");
  });

  it("names each sign value's art", () => {
    const art = new ArtList();
    expect(signArt("regulatory--maximum-speed-limit-60--g1", art)).toBe("speed:60");
    expect(signArt("regulatory--stop--g1", art)).toBe("stop");
    expect(signArt("regulatory--yield--g1", art)).toBe("giveway");
    expect(signArt("regulatory--no-entry--g1", art)).toBe("noentry");
    expect(signArt("regulatory--keep-left--g1", art)).toBe("keepleft");
    expect(signArt("complementary--chevron-right--g3", art)).toBe("chevron:right");
    expect(signArt("warning--roundabout--g1", art)).toBe("warning:roundabout");
    expect(signArt("warning--kangaroos", art)).toBe("warning:kangaroos");
    expect(signArt("information--parking--g1", art)).toBeNull();
  });

  it("moves a sign seen on the asphalt to the verge, skips far signs, poles and lights", () => {
    const ps = seenFeatures([
      { at: [300, 2], value: "regulatory--stop--g1" },
      { at: [400, 60], value: "regulatory--stop--g1" },
      { at: [500, 6], value: "object--support--utility-pole" },
      { at: [600, 6], value: "object--street-light" },
      { at: [700, 1], value: "marking--discrete--stop-line" },
    ], plan, index, opts, new ArtList(), flat);
    expect(boxes(ps)).toHaveLength(1);
    expect(boxes(ps)[0].at[0]).toBeCloseTo(300, 6);
    expect(boxes(ps)[0].at[1]).toBeCloseTo(4 + 1.05, 6);
    expect(faces(ps)[0].height).toBeCloseTo(0.75, 6);
  });

  it("builds a traffic light as a pole and a head facing traffic", () => {
    const ps = seenFeatures([{ at: [300, -7], value: "object--traffic-light--general-upright" }], plan, index, opts, new ArtList(), flat);
    const head = boxes(ps).find((b) => b.material === "signal")!;
    const pole = boxes(ps).find((b) => b.material === "steel")!;
    expect(pole.z1).toBeCloseTo(13.5, 6);
    expect(head.at[0] - pole.at[0]).toBeCloseTo(0.2, 6);
  });
});

describe("gate signs", () => {
  it("are only on timed routes, two each side for START and FINISH", () => {
    expect(gateSigns(plan, opts, new ArtList(), flat)).toEqual([]);
    const art = new ArtList();
    const ps = gateSigns({ ...plan, timed: { start: 10, finish: 200 } }, opts, art, flat);
    expect(faces(ps)).toHaveLength(4);
    expect(boxes(ps)).toHaveLength(8);
    expect(art.list.map((a) => a.key).sort()).toEqual(["gate-FINISH", "gate-START"]);
  });
});

describe("kangaroo signs", () => {
  const signs = (ps: Piece[]) => faces(ps).filter((f) => f.art === "warning:kangaroo");

  it("puts one each way about 300 m in from each end of a 3 km run, none on a short run", () => {
    const rural = (i: number) => plan.samples[i].s >= 1000 && plan.samples[i].s <= 4000;
    const fs = signs(kangarooSigns(plan, opts, new ArtList(), rural, () => false, flat));
    expect(fs).toHaveLength(2);
    const left = fs.find((f) => f.at[1] > 0)!, right = fs.find((f) => f.at[1] < 0)!;
    expect(Math.abs(left.at[0] - 1300)).toBeLessThan(15);
    expect(Math.abs(right.at[0] - 3700)).toBeLessThan(15);
    const short = (i: number) => plan.samples[i].s >= 1000 && plan.samples[i].s <= 1900;
    expect(kangarooSigns(plan, opts, new ArtList(), short, () => false, flat)).toEqual([]);
  });

  it("nudges a blocked spot along, and gives up when every nudge is blocked", () => {
    const rural = (i: number) => plan.samples[i].s >= 1000 && plan.samples[i].s <= 4000;
    const near = (i: number, c: number, r: number) => Math.abs(plan.samples[i].s - c) <= r;
    const nudged = signs(kangarooSigns(plan, opts, new ArtList(), rural, (i, side) => side === 1 && near(i, 1300, 2), flat));
    const left = nudged.find((f) => f.at[1] > 0)!;
    expect(Math.abs(left.at[0] - 1300)).toBeGreaterThan(2);
    expect(Math.abs(left.at[0] - 1300)).toBeLessThan(25);
    const none = signs(kangarooSigns(plan, opts, new ArtList(), rural, (i, side) => side === 1 && near(i, 1300, 30), flat));
    expect(none.filter((f) => f.at[1] > 0)).toHaveLength(0);
  });
});

describe("buildPieces", () => {
  const atlas: ArtAtlas = { data: new Uint8Array(), cells: { a: { u0: 0.1, v0: 0.2, u1: 0.3, v1: 0.4, aspect: 2 }, back: { u0: 0.5, v0: 0, u1: 0.6, v1: 0.1, aspect: 1 } } };
  const pos = (m: { positions: Float32Array }, v: number): [number, number, number] => [m.positions[v * 3], -m.positions[v * 3 + 2], m.positions[v * 3 + 1]];

  it("groups boxes by material under FURNITURE_ names and skips faces without art", () => {
    const ps: Piece[] = [
      { kind: "box", at: [0, 0], along: [1, 0], length: 0.1, depth: 0.1, z0: 0, z1: 2, material: "steel" },
      { kind: "box", at: [5, 0], along: [1, 0], length: 0.1, depth: 0.1, z0: 0, z1: 2, material: "steel" },
      { kind: "box", at: [9, 0], along: [1, 0], length: 1, depth: 1, z0: 0, z1: 1, material: "lamp" },
      { kind: "face", at: [0, 0], normal: [0, -1], z0: 1, height: 1, art: "missing" },
    ];
    const names = buildPieces(ps, atlas).map((m) => m.name).sort();
    expect(names).toEqual(["FURNITURE_LAMP_000", "FURNITURE_STEEL_000"]);
    expect(buildPieces([ps[3]], null)).toEqual([]);
  });

  it("gives a one-sided face a mirrored grey back, width from the aspect", () => {
    const [m] = buildPieces([{ kind: "face", at: [0, 0], normal: [0, -1], z0: 1, height: 1, art: "a" }], atlas);
    expect(m.name).toBe("FURNITURE_SIGNART_000");
    expect(m.positions.length / 3).toBe(8);
    const xs = [0, 1, 2, 3].map((v) => pos(m, v)[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2, 5);
    const us = Array.from(m.uvs.slice(8, 16)).filter((_, k) => k % 2 === 0);
    expect(Math.min(...us)).toBeCloseTo(0.5, 6);
  });

  it("prints a blade so each side reads left to right", () => {
    const [m] = buildPieces([{ kind: "blade", at: [0, 0], along: [1, 0], z: 3, height: 0.2, art: "a" }], atlas);
    for (const face of [0, 4]) {
      const ny = m.normals[face * 3 + 2] * -1; // ENU y from AC z
      // Seen from the side the face points to, the viewer's right is (-n.y, n.x) = (-ny, 0) along x.
      const rightX = -ny;
      const a = pos(m, face), b = pos(m, face + 1);
      const du = m.uvs[(face + 1) * 2] - m.uvs[face * 2];
      expect(Math.sign((b[0] - a[0]) * rightX)).toBe(Math.sign(du));
      expect(du).toBeGreaterThan(0);
    }
  });

  it("off() moves to the left of a sample", () => {
    expect(off({ pos: [1, 1], left: [0, 1] }, 2)).toEqual([1, 3]);
  });
});
