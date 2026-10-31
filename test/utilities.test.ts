import { expect, describe, it } from "vitest";
import { SegmentIndex, planRoad } from "../src/core/road";
import { withDefaults as defaults } from "../src/core/options";
import { carParkLights, lampArms, outreach, placeUtilities, sagOf } from "../src/core/utilities";
import { SINK } from "../src/core/sceneGround";
import { type Piece } from "../src/core/furniture";
import { type Vec2 } from "../src/core/geo";

type Box = Extract<Piece, { kind: "box" }>;
const boxes = (ps: Piece[]) => ps.filter((p): p is Box => p.kind === "box");
const timberPosts = (ps: Piece[]) => boxes(ps).filter((b) => b.material === "timber" && b.length < 0.5);
const steelPosts = (ps: Piece[]) => boxes(ps).filter((b) => b.material === "steel" && b.z1 - b.z0 > 5);
const lanterns = (ps: Piece[]) => boxes(ps).filter((b) => b.material === "lamp");

/** A straight street heading east along y = 0, `width` wide, at 10 m. */
function street(width: number, length = 600) {
  const path: Vec2[] = Array.from({ length: length / 20 + 1 }, (_, i) => [i * 20, 0]);
  const opts = defaults({ widthOverride: width });
  const road = planRoad(path, opts);
  for (const smp of road.samples) smp.h = 10;
  return { plan: road, index: new SegmentIndex(road), opts };
}
const flat = () => 10;
const country = () => 0;
const townish = () => 2;
const none = { poles: [], lamps: [], lines: [] };

describe("known poles", () => {
  const { plan, index, opts } = street(8);

  it("moves a pole seen on the asphalt to 1 m behind the road edge on its side, same distance along", () => {
    const u = placeUtilities({ ...none, poles: [[123, 1.5]] }, plan, index, opts, flat, country);
    expect(u.poles).toBe(1);
    const [p] = timberPosts(u.pieces);
    expect(p.at[0]).toBeCloseTo(123, 3);
    expect(p.at[1]).toBeCloseTo(5, 3);
    const right = placeUtilities({ ...none, poles: [[123, -0.5]] }, plan, index, opts, flat, country);
    expect(timberPosts(right.pieces)[0].at[1]).toBeCloseTo(-5, 3);
  });

  it("leaves a pole well behind the kerb where it is, and drops one far beyond the road", () => {
    const u = placeUtilities({ ...none, poles: [[50, 12], [80, 40]] }, plan, index, opts, flat, country);
    expect(u.poles).toBe(1);
    expect(timberPosts(u.pieces)[0].at).toEqual([50, 12]);
  });

  it("merges two sightings 3 m apart into one pole, the same one whatever the input order", () => {
    const a = placeUtilities({ ...none, poles: [[100, 6], [103, 6]] }, plan, index, opts, flat, country);
    const b = placeUtilities({ ...none, poles: [[103, 6], [100, 6]] }, plan, index, opts, flat, country);
    expect(a.poles).toBe(1);
    expect(timberPosts(a.pieces)[0].at).toEqual(timberPosts(b.pieces)[0].at);
  });

  it("invents no poles on a town street with no data", () => {
    const u = placeUtilities(none, plan, index, opts, flat, townish);
    expect(u.poles).toBe(0);
    expect(timberPosts(u.pieces)).toHaveLength(0);
  });
});

describe("wires", () => {
  const { plan, index, opts } = street(8);

  it("makes poles of a power line's vertices and wires between consecutive ones", () => {
    const line: Vec2[] = [[100, 7], [140, 7], [180, 7]];
    const u = placeUtilities({ ...none, lines: [line] }, plan, index, opts, flat, country);
    expect(u.poles).toEqual(3);
    expect(u.wires.length).toBe(1);
    expect(u.wires[0].name).toBe("WIRES_000");
    expect(u.wires[0].material).toBe("wire");
    expect(u.wires[0].castShadows).toBe(false);
    // Two spans, four conductors, ten segments, two ribbons of two faces of four vertices.
    expect(u.wires[0].positions.length / 3).toBe(2 * 4 * 10 * 16);
  });

  it("spans poles on the same side 40 m apart, not 100 m apart", () => {
    const near = placeUtilities({ ...none, poles: [[100, 7], [140, 7]] }, plan, index, opts, flat, country);
    expect(near.wires.length).toBe(1);
    const far = placeUtilities({ ...none, poles: [[100, 7], [200, 7]] }, plan, index, opts, flat, country);
    expect(far.wires).toHaveLength(0);
    const across = placeUtilities({ ...none, poles: [[100, 7], [140, -7]] }, plan, index, opts, flat, country);
    expect(across.wires).toHaveLength(0);
  });

  it("doesn't span across a bend where the chord is short", () => {
    // East 100 m, then a hairpin-ish turn back west: two poles 50 m apart along the road, 20 m apart straight.
    const path: Vec2[] = [[0, 0], [60, 0], [80, 0], [90, 5], [95, 15], [90, 25], [80, 30], [60, 30], [0, 30]];
    const o = defaults({ widthOverride: 8 });
    const plan2 = planRoad(path, o);
    plan2.samples.forEach((s) => (s.h = 10));
    const idx = new SegmentIndex(plan2);
    const u = placeUtilities({ ...none, poles: [[75, 6], [75, 24]] }, plan2, idx, o, flat, country);
    expect(u.poles).toBe(2);
    expect(u.wires).toHaveLength(0);
  });

  it("sags 0.0005 L squared, capped at 1.2 m", () => {
    expect(sagOf(40)).toBeCloseTo(0.8, 6);
    expect(sagOf(80)).toBeCloseTo(1.2, 6);
    // The lowest point of a 40 m span's low-voltage bundle: 8.4 m up less 0.8 m (minus half its width).
    const u = placeUtilities({ ...none, poles: [[100, 7], [140, 7]] }, plan, index, opts, flat, country);
    const pos = u.wires[0].positions;
    let lo = Infinity;
    for (let i = 1; i < pos.length; i += 3) lo = Math.min(lo, pos[i]);
    expect(lo).toBeCloseTo(10 + 8.4 - 0.8 - 0.025, 3);
  });
});

describe("street lights", () => {
  it("puts default lights about every 50 m on the left of a narrow town street", () => {
    const { plan, index, opts } = street(8);
    const u = placeUtilities(none, plan, index, opts, flat, townish);
    const posts = steelPosts(u.pieces);
    expect(posts.length).toBe(12);
    for (const p of posts) expect(p.at[1]).toBeCloseTo(5, 3);
    const xs = posts.map((p) => p.at[0]).sort((a, b) => a - b);
    for (let k = 1; k < xs.length; k++) expect(xs[k] - xs[k - 1]).toBeCloseTo(50, 3);
    expect(xs[0]).toBeCloseTo(25, 3);
  });

  it("staggers them on a wide street, and places none in the country", () => {
    const { plan, index, opts } = street(12);
    const u = placeUtilities(none, plan, index, opts, flat, townish);
    const ys = steelPosts(u.pieces).sort((a, b) => a.at[0] - b.at[0]).map((p) => Math.sign(p.at[1]));
    for (let k = 1; k < ys.length; k++) expect(ys[k]).toBe(-ys[k - 1]);
    expect(placeUtilities(none, plan, index, opts, flat, country).lights).toHaveLength(0);
  });

  it("skips blocked spots, and keeps 30 m from a known lamp", () => {
    const { plan, index, opts } = street(8);
    const u = placeUtilities(none, plan, index, opts, flat, townish, (x) => x > 100 && x < 200);
    expect(steelPosts(u.pieces).some((p) => p.at[0] > 100 && p.at[0] < 200)).toBe(false);
    const k = placeUtilities({ ...none, lamps: [[130, 6]] }, plan, index, opts, flat, townish);
    const others = steelPosts(k.pieces).filter((p) => Math.abs(p.at[0] - 130) > 0.01);
    expect(others.every((p) => Math.abs(p.at[0] - 130) >= 30)).toBe(true);
  });

  it("mounts a default light within 18 m of a pole on that pole", () => {
    const { plan, index, opts } = street(8);
    const u = placeUtilities({ ...none, poles: [[85, 6]] }, plan, index, opts, flat, townish);
    expect(steelPosts(u.pieces).some((p) => Math.abs(p.at[0] - 75) < 1)).toBe(false);
    // Its arm starts at the pole.
    const arm = boxes(u.pieces).find((b) => b.material === "steel" && b.z1 - b.z0 < 0.2 && Math.abs(b.at[0] - 85) < 0.01)!;
    expect(arm).toBeDefined();
  });

  it("gives one light position per lantern, just under it", () => {
    const { plan, index, opts } = street(8);
    const u = placeUtilities({ ...none, lamps: [[300, 6]] }, plan, index, opts, flat, townish);
    const ls = lanterns(u.pieces);
    expect(u.lights).toHaveLength(ls.length);
    u.lights.forEach((l, k) => {
      expect(l[0]).toBeCloseTo(ls[k].at[0], 6);
      expect(l[1]).toBeCloseTo(ls[k].at[1], 6);
      expect(l[2]).toBeCloseTo(ls[k].z0 - 0.05, 6);
    });
  });

  it("reaches the arm past the road edge", () => {
    const { plan, index, opts } = street(8);
    const u = placeUtilities({ ...none, lamps: [[300, 5]] }, plan, index, opts, flat, country);
    expect(u.lights.length).toBe(1);
    expect(u.lights[0][1]).toBeLessThan(4);
  });
});

describe("heights from the ground at each foot", () => {
  it("stands every pole and post SINK into a tilted ground, and measures the tops from there", () => {
    const { plan, index, opts } = street(8);
    const tilted = (x: number, y: number) => 10 + 0.02 * x + 0.05 * y;
    const u = placeUtilities({ ...none, poles: [[200, 7]], lamps: [[400, 6]] }, plan, index, opts, tilted, townish);
    for (const p of [...timberPosts(u.pieces), ...steelPosts(u.pieces)]) {
      const g = tilted(p.at[0], p.at[1]);
      expect(p.z0).toBeCloseTo(g - SINK, 6);
    }
    const [pole] = timberPosts(u.pieces);
    const g = tilted(pole.at[0], pole.at[1]);
    expect(pole.z1).toBeCloseTo(g + 11, 6);
    const arm = boxes(u.pieces).find((b) => b.material === "timber" && b.length > 2)!;
    expect(arm.z0).toBeCloseTo(g + 10.3, 6);
    const post = steelPosts(u.pieces).find((p) => Math.abs(p.at[0] - 400) < 0.01)!;
    const lantern = lanterns(u.pieces).find((l) => Math.abs(l.at[0] - 400) < 0.01)!;
    expect(lantern.z0).toBeCloseTo(tilted(post.at[0], post.at[1]) + 8.23, 6);
  });
});

describe("off the road", () => {
  const { plan, index, opts } = street(8);
  // The route, and a side street north at x = 300, 8 m wide.
  const onRoad = (x: number, y: number) => Math.abs(y) <= 4 || (y >= 0 && Math.abs(x - 300) <= 4);

  it("moves a pole seen on a side street off it, and drops one with nowhere clear", () => {
    const u = placeUtilities({ ...none, poles: [[300, 20]] }, plan, index, opts, flat, country, undefined, onRoad);
    const [p] = timberPosts(u.pieces);
    expect(Math.abs(p.at[0] - 300)).toBeGreaterThan(4.3);
    const sea = () => true;
    expect(placeUtilities({ ...none, poles: [[100, 20]] }, plan, index, opts, flat, country, undefined, sea).poles).toBe(0);
  });

  it("keeps a seen lantern over the road where it was seen, its post on the verge", () => {
    const u = placeUtilities({ ...none, lamps: [[150, 2]] }, plan, index, opts, flat, country, undefined, onRoad);
    expect(u.lights.length).toBe(1);
    expect(u.lights[0][0]).toBeCloseTo(150, 6);
    expect(u.lights[0][1]).toBeCloseTo(2, 6);
    const [post] = steelPosts(u.pieces);
    expect(post.at[1]).toBeCloseTo(5, 3);
  });
});

describe("arms", () => {
  const { plan, index } = street(8);

  it("gives a post in a median two arms, and one with a street ending behind it one", () => {
    const median = (_x: number, y: number) => Math.abs(y) <= 4 || (y >= 7 && y <= 15);
    const arms = lampArms({ at: [100, 5], out: [0, 1] }, undefined, plan, index, median);
    expect(arms).toHaveLength(2);
    expect(arms[0].dir[1]).toBeCloseTo(-1, 6);
    expect(arms[1].dir[1]).toBeCloseTo(1, 6);
    expect(arms[1].length).toBeGreaterThanOrEqual(2 + 0.8);
    const tee = (x: number, y: number) => Math.abs(y) <= 4 || (y >= 7 && Math.abs(x - 100) <= 4);
    expect(lampArms({ at: [100, 5], out: [0, 1] }, undefined, plan, index, tee)).toHaveLength(1);
    expect(lampArms({ at: [100, 5], out: [0, 1] }, undefined, plan, index)).toHaveLength(1);
  });

  it("builds the arm from the post's centre and hangs the lantern flush under its end", () => {
    const { pieces, light } = outreach([2, 3], 10, [0, -1], 3);
    const [arm, lamp] = pieces as Box[];
    expect(arm.at[1] + arm.length / 2).toBeCloseTo(3, 9);
    expect(lamp.at[1] - lamp.length / 2).toBeCloseTo(arm.at[1] - arm.length / 2, 9);
    expect(lamp.z1).toBeGreaterThan(arm.z0);
    expect(lamp.z0).toBeLessThan(arm.z0);
    expect(light).toEqual([lamp.at[0], lamp.at[1], lamp.z0 - 0.05]);
  });
});

describe("car park lights", () => {
  const aisles: Vec2[][] = [[[0, 0], [60, 0], [120, 0]], [[0, 100], [80, 100]], [[500, 0], [510, 0]]];

  it("puts a pole every 35 m along an aisle, first 17 m in, 9 m off, alternating sides", () => {
    const { pieces, lights } = carParkLights([aisles[0]], flat, () => false);
    const poles = steelPosts(pieces);
    expect(poles.map((p) => p.at[0])).toEqual([17, 52, 87].map((x) => expect.closeTo(x, 6)));
    expect(poles.map((p) => p.at[1])).toEqual([9, -9, 9].map((y) => expect.closeTo(y, 6)));
    expect(lights).toHaveLength(6);
    for (const p of poles) expect(p.z0).toBeCloseTo(10 - SINK, 6);
  });

  it("skips blocked spots, keeps 20 m from lights already placed, and ignores short aisles", () => {
    const { pieces } = carParkLights([aisles[0]], flat, (x) => x > 50 && x < 60, [[85, 9, 18]]);
    expect(steelPosts(pieces).map((p) => p.at[0])).toEqual([expect.closeTo(17, 6)]);
    expect(carParkLights([aisles[2]], flat, () => false).pieces).toHaveLength(0);
    expect(carParkLights([[[0, 0], [0, 0], [30, 0]]], flat, () => false).pieces.length).toBeGreaterThan(0);
  });

  it("gives the same lights whatever the order of the aisles", () => {
    const a = carParkLights(aisles, flat, () => false);
    const b = carParkLights([aisles[2], aisles[1], aisles[0]], flat, () => false);
    expect(b.lights).toEqual(a.lights);
  });

  it("hangs each lantern wholly under its arm", () => {
    const { pieces } = carParkLights([aisles[0]], flat, () => false);
    const arms = boxes(pieces).filter((b) => b.material === "steel" && b.z1 - b.z0 < 0.2);
    const ls = lanterns(pieces);
    expect(arms).toHaveLength(ls.length);
    arms.forEach((arm, k) => {
      const l = ls[k];
      const reach = (b: Box) => Math.hypot(b.at[0] - 17, b.at[1] - 9);
      if (reach(arm) > 3) return; // only the first pole's pair
      expect(reach(l) + l.length / 2).toBeCloseTo(reach(arm) + arm.length / 2, 6);
      expect(l.z1).toBeGreaterThan(arm.z0);
    });
  });
});
