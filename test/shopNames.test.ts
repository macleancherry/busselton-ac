// Busselton fork: real names on shop signs (src/core/shops.ts): named places matched to the building
// they're in, wall signs on fronts without a verandah (pads set back in car parks), the merge of the
// tiles' POIs with Overpass and the hand list, and the hand list file itself.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building } from "../src/core/buildings";
import { atBuilding, buildShopfronts, findShopfronts, frontCuts, mergeShopPois, NEAR, SEG_MIN, SET_BACK_MAX, SIGN_COUNT, SIGN_H, shopSignTexture, wallSign } from "../src/core/shops";

// A street along y = 0 (its edge at y = 5); buildings to the north, fronts facing south.
const gap = (_x: number, y: number) => Math.max(0, y - 5);
const flat = () => 2;
const box = (x0: number, y0: number, w: number, d: number, roof: Building["roof"] = "flat", height = 4): Building => ({
  ring: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + d], [x0, y0 + d]], type: "house", pitch: 22, height, roof, roofColour: 0, facade: 2, source: "osm",
});
type P = [number, number];

describe("matching names to buildings", () => {
  it("a place inside a footprint names that building, even when a neighbour's middle is nearer", () => {
    // A big shop and a small one beside it; the place is just inside the big one's east wall,
    // nearer the small one's centroid than its own.
    const big = box(0, 8, 30, 30);
    const small = box(31, 8, 8, 8);
    const fronts = findShopfronts([big, small], [{ at: [29.5, 12] as P, cls: "shop", name: "Everyday Gourmet" }], gap, flat);
    expect(fronts).toHaveLength(2);
    expect(fronts[0].name).toBe("Everyday Gourmet");
    expect(fronts[1].name).toBeUndefined();
  });

  it("within NEAR metres of a footprint counts; further out falls back to reach", () => {
    const b = box(0, 8, 12, 12);
    expect(atBuilding([6, 8 + 12 + NEAR - 0.1], b.ring)).toBe(true);
    expect(atBuilding([6, 8 + 12 + NEAR + 0.5], b.ring)).toBe(false);
    expect(atBuilding([6, 14], b.ring)).toBe(true);
  });

  it("two places in one building: the one nearer the street front wins; a hand-listed one beats both", () => {
    const shop = box(0, 8, 12, 20);
    const pois = [
      { at: [6, 25] as P, cls: "cafe", name: "Back Cafe" },
      { at: [6, 10] as P, cls: "cafe", name: "Front Cafe" },
    ];
    expect(findShopfronts([shop], pois, gap, flat)[0].name).toBe("Front Cafe");
    const hand = [...pois, { at: [6, 20] as P, cls: "shop", name: "Alberta's", hand: true }];
    expect(findShopfronts([shop], hand, gap, flat)[0].name).toBe("Alberta's");
  });

  it("a hand-listed place counts whatever its class", () => {
    const pitched = box(0, 8, 12, 12, "hip", 4); // not flat-roofed, no tile POI: not a shop by itself
    expect(findShopfronts([pitched], [], gap, flat)).toHaveLength(0);
    const fronts = findShopfronts([pitched], [{ at: [6, 14] as P, cls: "shop", subclass: "hand", name: "Burger Bones", hand: true }], gap, flat);
    expect(fronts.map((f) => f.name)).toEqual(["Burger Bones"]);
  });
});

describe("strips: one name per shop along a long front", () => {
  it("frontCuts: halfway between places, one per name, none closer than SEG_MIN, none shorter than SEG_MIN", () => {
    const p = (t: number, name: string, hand = false, d = 5) => ({ t, name, hand, d });
    expect(frontCuts(10, [p(2, "A"), p(8, "B")])).toEqual([0, 10]); // too short for two
    expect(frontCuts(40, [p(5, "A")])).toEqual([0, 40]);
    expect(frontCuts(40, [p(5, "A"), p(25, "B")])).toEqual([0, 15, 40]);
    expect(frontCuts(40, [p(5, "A"), p(7, "B"), p(25, "C")])).toEqual([0, 15, 40]); // B shares A's stretch
    expect(frontCuts(40, [p(5, "A"), p(25, "A")])).toEqual([0, 40]); // one name, one stretch
    expect(frontCuts(40, [p(1, "A"), p(7.5, "B"), p(39, "C")])).toEqual([0, 6, 23.25, 40]);
    // Crowded at one end: every stretch still SEG_MIN long.
    const c = frontCuts(20, [p(17, "A"), p(18.5 - 6, "B"), p(5, "C", true)]);
    for (let i = 1; i < c.length; i++) expect(c[i] - c[i - 1]).toBeGreaterThanOrEqual(SEG_MIN - 1e-9);
  });

  it("a 60 m strip with three shops in one footprint gets three named stretches, each on its own shop", () => {
    const strip = box(0, 8, 60, 20);
    const fronts = findShopfronts([strip], [
      { at: [10, 12] as P, cls: "restaurant", name: "Great Wall" },
      { at: [30, 12] as P, cls: "restaurant", name: "Coco's Thai" },
      { at: [50, 25] as P, cls: "shop", name: "Burger Bones", hand: true },
    ], gap, flat);
    expect(fronts).toHaveLength(3);
    expect(fronts.map((f) => f.name)).toEqual(["Great Wall", "Coco's Thai", "Burger Bones"]);
    expect(fronts[0].a).toEqual([0, 8]);
    expect(fronts[2].b).toEqual([60, 8]);
    expect(fronts[0].b[0]).toBeCloseTo(20);
    expect(fronts[1].b[0]).toBeCloseTo(40);
    // Each stretch has its own sign row, squeezed for its own 20 m.
    let asked: { text: string; squeeze: number }[] = [];
    shopSignTexture(fronts, (names, w, h) => { asked = names; return new Uint8Array(w * h * names.length * 4); });
    expect(asked.map((n) => n.text)).toEqual(["Burger Bones", "Great Wall", "Coco's Thai"]);
    expect(asked[0].squeeze).toBeCloseTo((0.55 / SIGN_H) / (20 / 1024), 3);
  });
});

describe("wall signs", () => {
  it("a pad set back in a car park gets a front on its street wall with a wall sign, no verandah", () => {
    // 25 m back from the kerb (past the 9 m verandah rule), flat roof, 5 m tall.
    const pad = box(0, 30, 20, 16, "flat", 5);
    expect(findShopfronts([pad], [], gap, flat)).toHaveLength(0);
    expect(findShopfronts([pad], [{ at: [40, 38] as P, cls: "fast_food", name: "Too Far" }], gap, flat)).toHaveLength(0);
    const fronts = findShopfronts([pad], [{ at: [10, 38] as P, cls: "fast_food", name: "Hungry Jack's" }], gap, flat);
    expect(fronts).toHaveLength(1);
    const [f] = fronts;
    expect(f.name).toBe("Hungry Jack's");
    expect(f.depth).toBe(0);
    expect(f.posts).toBe(false);
    // The street-facing wall (y = 30), facing the street.
    expect(f.a[1]).toBeCloseTo(30);
    expect(f.out[1]).toBeCloseTo(-1);
    // Centred, 12 m long at most, above the windows and under the eaves.
    expect(f.wall).toBeDefined();
    const w = f.wall!;
    expect(w.t1 - w.t0).toBeCloseTo(12);
    expect((w.t0 + w.t1) / 2).toBeCloseTo(10);
    expect(w.z0).toBeGreaterThanOrEqual(2 + 2.2);
    expect(w.z1).toBeLessThanOrEqual(2 + 5);
  });

  it("not past SET_BACK_MAX, and never on a house", () => {
    const far = box(0, 5 + SET_BACK_MAX + 2, 20, 16);
    expect(findShopfronts([far], [{ at: [10, 5 + SET_BACK_MAX + 8] as P, cls: "cafe", name: "X" }], gap, flat)).toHaveLength(0);
    const house = box(0, 30, 12, 10, "hip", 2.8);
    expect(findShopfronts([house], [{ at: [6, 35] as P, cls: "cafe", name: "X" }], gap, flat, () => true)).toHaveLength(0);
  });

  it("a named front right at the kerb (no room for a verandah) also gets a wall sign", () => {
    const tight = box(0, 5.5, 12, 12); // 0.5 m from the kerb
    const [f] = findShopfronts([tight], [{ at: [6, 10] as P, cls: "bank", name: "Westpac" }], gap, flat);
    expect(f.depth).toBe(0);
    expect(f.name).toBe("Westpac");
    expect(f.wall).toBeDefined();
  });

  it("fronts with a verandah keep their fascia sign (no wall sign)", () => {
    const [f] = findShopfronts([box(0, 8, 12, 15)], [{ at: [6, 12] as P, cls: "cafe", name: "Fluid" }], gap, flat);
    expect(f.depth).toBeGreaterThan(0);
    expect(f.wall).toBeUndefined();
  });

  it("the wall sign mesh faces the street, on the named row, flush with the wall", () => {
    const pad = box(0, 30, 20, 16, "flat", 5);
    const fronts = findShopfronts([pad], [{ at: [10, 38] as P, cls: "fast_food", name: "McDonald's" }], gap, flat);
    const meshes = buildShopfronts(fronts, flat);
    expect(meshes.some((m) => m.name.startsWith("SHOP_VERANDAH"))).toBe(false);
    const sign = meshes.find((m) => m.name.startsWith("SHOP_SIGN"))!;
    expect(sign).toBeTruthy();
    // AC space: z is south (-y local); the street is south, so facing it is +z.
    expect(sign.normals[2]).toBeGreaterThan(0.9);
    const vs = Array.from({ length: sign.uvs.length / 2 }, (_, i) => sign.uvs[i * 2 + 1]);
    expect(vs.some((v) => Math.abs(v - SIGN_COUNT / (SIGN_COUNT + 1)) < 1e-6)).toBe(true);
    // 8 cm proud of the wall at y = 30: AC z = -y.
    for (let i = 0; i < sign.positions.length / 3; i++) expect(sign.positions[i * 3 + 2]).toBeCloseTo(-(30 - 0.08), 5);
  });

  it("the sign texture squeezes a wall sign's lettering for its own size", () => {
    const pad = box(0, 30, 20, 16, "flat", 5);
    const fronts = findShopfronts([pad], [{ at: [10, 38] as P, cls: "fast_food", name: "McDonald's" }], gap, flat);
    let asked: { squeeze: number }[] = [];
    shopSignTexture(fronts, (names, w, h) => {
      asked = names;
      return new Uint8Array(w * h * names.length * 4);
    });
    expect(asked[0].squeeze).toBeCloseTo((0.7 / SIGN_H) / (12 / 1024), 3);
  });

  it("wallSign keeps a short wall's sign off its ends and a low building's under its eaves", () => {
    const f = findShopfronts([box(0, 30, 5, 10, "flat", 3)], [{ at: [2.5, 35] as P, cls: "cafe", name: "Tiny" }], gap, flat)[0];
    const w = wallSign(f, 3);
    expect(w.t0).toBeGreaterThanOrEqual(0.5);
    expect(w.t1).toBeLessThanOrEqual(4.5);
    expect(w.z1).toBeLessThanOrEqual(2 + 3);
  });
});

describe("mergeShopPois", () => {
  const tile = [{ at: [0, 0] as P, cls: "cafe", subclass: "cafe", name: "The Good Egg" }];
  it("drops an Overpass place the tiles already have (same name nearby), keeps the rest and every hand-listed one", () => {
    const merged = mergeShopPois(tile, [
      { at: [10, 5] as P, cls: "shop", subclass: "cafe", name: "Good Egg" },
      { at: [300, 0] as P, cls: "shop", subclass: "cafe", name: "The Good Egg" },
      { at: [20, 0] as P, cls: "shop", subclass: "cafe", name: "Hummingbird" },
      { at: [1, 1] as P, cls: "shop", subclass: "hand", name: "The Good Egg", hand: true },
      { at: [2, 2] as P, cls: "shop", subclass: "cafe", name: " " },
    ]);
    expect(merged.map((p) => `${p.name}@${p.at[0]}`)).toEqual(["The Good Egg@0", "The Good Egg@300", "Hummingbird@20", "The Good Egg@1"]);
  });
});

describe("routes/landmarks/shop_names.json", () => {
  it("is a list of { name, at: [lng, lat] } inside the Busselton build area's box, with a source", () => {
    const list = JSON.parse(readFileSync("routes/landmarks/shop_names.json", "utf8"));
    const shops = list.shops ?? list;
    expect(shops.length).toBeGreaterThanOrEqual(3);
    for (const s of shops) {
      expect(typeof s.name).toBe("string");
      expect(s.at).toHaveLength(2);
      expect(s.at[0]).toBeGreaterThan(115.32);
      expect(s.at[0]).toBeLessThan(115.36);
      expect(s.at[1]).toBeGreaterThan(-33.67);
      expect(s.at[1]).toBeLessThan(-33.63);
      expect(typeof s.source).toBe("string");
    }
    expect(shops.map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(["Alberta's", "Burger Bones", "Busselton Pavilion"]));
  });
});
