import { describe, expect, it } from "vitest";
import type { Building } from "../src/core/buildings";
import { buildShopfronts, findShopfronts } from "../src/core/shops";

// A street along y = 0 (its edge at y = 5); buildings to the north, fronts facing south.
const gap = (_x: number, y: number) => Math.max(0, y - 5);
const flat = () => 2;
const box = (x0: number, y0: number, w: number, d: number, roof: Building["roof"] = "flat", height = 4): Building => ({
  ring: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + d], [x0, y0 + d]], height, roof, roofColour: 0, facade: 2, source: "osm",
});

describe("shopfronts", () => {
  const shop = box(0, 8, 12, 15); // 3 m back from the kerb, flat roof: a town-centre shop
  const house = box(30, 12, 12, 10, "hip", 2.8); // a house 7 m back
  const cafe = box(60, 12, 10, 10, "hip", 3.5);
  const pois = [{ at: [65, 17] as [number, number], cls: "cafe" }];

  it("finds shops built to the footpath and ones with a shop in them, not houses", () => {
    const fronts = findShopfronts([shop, house, cafe], pois, gap, flat, (b) => b === house || b === cafe);
    expect(fronts).toHaveLength(2);
    const [s] = fronts;
    // The front is the street side (y = 8), facing the street (-y).
    expect(s.a[1]).toBeCloseTo(8);
    expect(s.b[1]).toBeCloseTo(8);
    expect(s.out[1]).toBeCloseTo(-1);
    // The verandah stops short of the kerb, and a deep one has posts.
    expect(s.depth).toBeGreaterThan(2);
    expect(s.depth).toBeLessThanOrEqual(3 - 0.6 + 1e-9);
    expect(s.posts).toBe(true);
  });

  it("builds a verandah roof facing up and down, a sign and windows facing the street", () => {
    const fronts = findShopfronts([shop], [], gap, flat);
    const meshes = buildShopfronts(fronts);
    const by = (p: string) => meshes.find((m) => m.name.startsWith(p))!;
    for (const name of ["SHOP_VERANDAH", "SHOP_SIGN", "SHOP_POST", "SHOP_WINDOW"]) expect(by(name)).toBeTruthy();
    // AC space: y up, z south. The street is south of the shop: facing it means +z.
    const sign = by("SHOP_SIGN");
    expect(sign.normals[2]).toBeGreaterThan(0.9);
    const win = by("SHOP_WINDOW");
    expect(win.normals[2]).toBeGreaterThan(0.9);
    const roof = by("SHOP_VERANDAH");
    expect(roof.normals[1]).toBeGreaterThan(0.9); // top
    expect(roof.normals[4 * 3 + 1]).toBeLessThan(-0.9); // underside
    // Nothing here is physics: no digit prefix.
    for (const m of meshes) expect(m.name).not.toMatch(/^\d/);
  });
});
