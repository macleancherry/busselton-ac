import { describe, expect, it } from "vitest";
import type { Building } from "../src/core/buildings";
import { buildShopfronts, findShopfronts, SIGN_COUNT, SIGN_H, shopSignTexture, signRows } from "../src/core/shops";

// A street along y = 0 (its edge at y = 5); buildings to the north, fronts facing south.
const gap = (_x: number, y: number) => Math.max(0, y - 5);
const flat = () => 2;
const box = (x0: number, y0: number, w: number, d: number, roof: Building["roof"] = "flat", height = 4): Building => ({
  ring: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + d], [x0, y0 + d]], type: "house", pitch: 22, height, roof, roofColour: 0, facade: 2, source: "osm",
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

  it("puts a shop's name on the nearest front with a verandah, once", () => {
    const next = box(14, 8, 12, 15);
    const named = [
      { at: [6, 12] as [number, number], cls: "cafe", name: "Fluid Espresso" },
      { at: [2, 10] as [number, number], cls: "shop", name: "Second Name" },
    ];
    const fronts = findShopfronts([shop, next], named, gap, flat);
    expect(fronts[0].name).toBe("Fluid Espresso");
    expect(fronts[0].sign).toBe(SIGN_COUNT);
    // The second shop is out of the next building's reach and the first front is taken.
    expect(fronts[1].name).toBeUndefined();
    expect(signRows(fronts)).toBe(SIGN_COUNT + 1);
    // The fascia's UVs land on the named row.
    const sign = buildShopfronts(fronts).find((m) => m.name.startsWith("SHOP_SIGN"))!;
    const vs = Array.from({ length: sign.uvs.length / 2 }, (_, i) => sign.uvs[i * 2 + 1]);
    expect(vs.some((v) => Math.abs(v - SIGN_COUNT / (SIGN_COUNT + 1)) < 1e-6)).toBe(true);
  });

  it("draws named signs with the drawer, one row each", () => {
    const fronts = findShopfronts([shop], [{ at: [6, 12], cls: "cafe", name: "Fluid Espresso" }], gap, flat);
    let asked: { text: string; squeeze: number }[] = [];
    const png = shopSignTexture(fronts, (names, w, h) => {
      asked = names;
      return new Uint8Array(w * h * names.length * 4).fill(200);
    });
    expect(asked.map((n) => n.text)).toEqual(["Fluid Espresso"]);
    // 12 m of fascia, 0.55 m tall: squeezed to keep the letters square.
    expect(asked[0].squeeze).toBeCloseTo((0.55 / SIGN_H) / (12 / 1024), 3);
    // PNG height: nine rows.
    const v = new DataView(png.buffer, png.byteOffset);
    expect(v.getUint32(20)).toBe(SIGN_H * (SIGN_COUNT + 1));
  });
});
