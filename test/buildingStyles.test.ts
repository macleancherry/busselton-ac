import { describe, expect, it } from "vitest";
import {
  dressBuilding,
  FACADE_INDEX,
  FACADES,
  facadeTexture,
  LAYOUTS,
  PITCHED,
  PX_PER_M,
  ROOF_COLOURS,
  roofTexture,
  type DressInfo,
} from "../src/core/buildingStyles";
import { decodeOwnPng } from "../src/core/png";

const roofIndex = (name: string) => ROOF_COLOURS.findIndex((r) => r.name === name);
const facade = (name: string) => FACADES[FACADE_INDEX.get(name)!];
const info = (over: Partial<DressInfo>): DressInfo => ({ area: 150, rectangle: true, fronted: false, seed: 1, ...over });

describe("layouts", () => {
  it("keep every opening and plain band inside one period and storey", () => {
    for (const lay of Object.values(LAYOUTS)) {
      for (const o of lay.openings) {
        expect(o.x0).toBeGreaterThanOrEqual(0);
        expect(o.x1).toBeLessThanOrEqual(lay.period);
        expect(o.x1).toBeGreaterThan(o.x0);
        expect(o.z0).toBeGreaterThanOrEqual(0);
        expect(o.z1).toBeLessThanOrEqual(lay.storey);
        expect(o.z1).toBeGreaterThan(o.z0);
      }
      expect(lay.plain[0]).toBeGreaterThanOrEqual(0);
      expect(lay.plain[1]).toBeLessThanOrEqual(lay.storey);
    }
  });
});

describe("facades and finishes", () => {
  it("have unique names, a round-tripping index and layouts that exist", () => {
    expect(new Set(FACADES.map((f) => f.name)).size).toBe(FACADES.length);
    FACADES.forEach((f, i) => {
      expect(FACADE_INDEX.get(f.name)).toBe(i);
      expect(LAYOUTS[f.layout as keyof typeof LAYOUTS]).toBeDefined();
    });
    expect(facade("brick_red")).toBe(FACADES[0]);
    for (const prefix of ["brick_", "wb_", "render_", "fibro_", "clad_"]) expect(FACADES.some((f) => f.name.startsWith(prefix))).toBe(true);
  });

  it("keep the roof names other modules look up, with shalegrey second", () => {
    for (const n of ["surfmist", "terracotta", "zinc", "membrane", "gravel", "paleeucalypt", "cottagegreen", "tile_red"]) expect(roofIndex(n)).toBeGreaterThanOrEqual(0);
    expect(ROOF_COLOURS[1].name).toBe("shalegrey");
    expect(ROOF_COLOURS[roofIndex("terracotta")].kind).toBe("tile");
    expect(ROOF_COLOURS[roofIndex("tile_sand")].kind).toBe("ctile");
  });

  it("PITCHED leaves out membrane and gravel and has the Colorbond greens", () => {
    const names = PITCHED.map((i) => ROOF_COLOURS[i].name);
    expect(names).not.toContain("membrane");
    expect(names).not.toContain("gravel");
    expect(names).toContain("paleeucalypt");
    expect(names).toContain("cottagegreen");
  });
});

describe("textures", () => {
  const pixel = (img: { rgba: Uint8Array; width: number }, x: number, y: number) => {
    const o = (y * img.width + x) * 4;
    return [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]];
  };

  it("facade textures are a period by a storey at 32 px a metre, the same every time", () => {
    for (const name of ["brick_red", "wb_blue", "shop_red", "glass_blue", "tiltup"]) {
      const fc = facade(name);
      const lay = LAYOUTS[fc.layout as keyof typeof LAYOUTS];
      const a = facadeTexture(fc), b = facadeTexture(fc);
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
      const img = decodeOwnPng(a);
      expect(img.width % 4).toBe(0);
      expect(img.height % 4).toBe(0);
      expect(Math.abs(img.width - lay.period * PX_PER_M)).toBeLessThanOrEqual(2);
      expect(Math.abs(img.height - lay.storey * PX_PER_M)).toBeLessThanOrEqual(2);
    }
  });

  it("a window's middle isn't the wall, brick has mortar, a shopfront shows its sign colour", () => {
    const fc = facade("brick_red");
    const img = decodeOwnPng(facadeTexture(fc));
    const o = LAYOUTS.house.openings[0];
    const px = (mx: number, mz: number) => pixel(img, Math.floor((mx / 8) * img.width), Math.floor(((3 - mz) / 3) * img.height));
    const win = px((o.x0 + o.x1) / 2 + 0.3, (o.z0 + o.z1) / 2);
    const wall = px(7.5, 0.4);
    expect(Math.abs(win[2] - wall[2]) + Math.abs(win[0] - wall[0])).toBeGreaterThan(40);
    // Mortar: some pixels in a wall column are much paler than the brick.
    const col = Array.from({ length: 20 }, (_, i) => pixel(img, Math.floor(img.width * 0.95), img.height - 1 - i)[1]);
    expect(Math.max(...col) - Math.min(...col)).toBeGreaterThan(40);

    const shop = facade("shop_red");
    const s = decodeOwnPng(facadeTexture(shop));
    const sign = pixel(s, 4, Math.floor(((4 - 3.2) / 4) * s.height));
    expect(Math.abs(sign[0] - shop.sign![0])).toBeLessThan(30);
    expect(Math.abs(sign[1] - shop.sign![1])).toBeLessThan(30);
  });

  it("works for a facade that isn't in the list (spec houses)", () => {
    const img = decodeOwnPng(facadeTexture({ name: "spec_wall", wall: "render", colour: [200, 100, 50], trim: [0, 0, 0], layout: "blank" }));
    expect(img.width).toBeGreaterThan(0);
  });

  it("roof textures are 128 square and look like their finish", () => {
    const avg = (name: string) => {
      const img = decodeOwnPng(roofTexture(ROOF_COLOURS[roofIndex(name)]));
      expect(img.width).toBe(128);
      expect(img.height).toBe(128);
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < img.rgba.length; i += 4) {
        r += img.rgba[i];
        g += img.rgba[i + 1];
        b += img.rgba[i + 2];
      }
      const n = img.rgba.length / 4;
      return [r / n, g / n, b / n];
    };
    const t = avg("terracotta");
    expect(t[0]).toBeGreaterThan(t[1] * 1.4);
    const m = avg("membrane");
    for (let k = 0; k < 3; k++) expect(Math.abs(m[k] - ROOF_COLOURS[roofIndex("membrane")].rgb[k])).toBeLessThan(20);
    const r = ROOF_COLOURS[roofIndex("surfmist")];
    expect(Buffer.from(roofTexture(r)).equals(Buffer.from(roofTexture(r)))).toBe(true);
  });
});

describe("dressing", () => {
  it("one building per rule", () => {
    expect(dressBuilding(info({ kind: "church" })).type).toBe("hall");
    expect(dressBuilding(info({ poi: "school", rectangle: false })).roof).toBe("flat");
    const tower = dressBuilding(info({ height: 40, area: 900 }));
    expect(["tower", "apartments"]).toContain(tower.type);
    expect(tower.height).toBe(40);
    const office = dressBuilding(info({ kind: "office", height: 20, area: 900 }));
    expect(office.type).toBe("tower");
    expect(FACADES[office.facade].wall).toBe("glass");
    expect(["apartments", "flats", "office"]).toContain(dressBuilding(info({ height: 12, area: 500 })).type);
    const cafe = dressBuilding(info({ poi: "cafe", fronted: true, area: 200 }));
    expect(cafe.type).toBe("shop");
    expect(cafe.awning).toBe(true);
    const wh = dressBuilding(info({ area: 900 }));
    expect(wh.type).toBe("warehouse");
    expect(wh.garage).toBe(true);
    expect(dressBuilding(info({ area: 20 })).type).toBe("shed");
  });

  it("a plain house is pitched on a rectangle unless modern, flat otherwise", () => {
    let pitched = 0;
    for (let seed = 0; seed < 200; seed++) {
      const d = dressBuilding(info({ seed }));
      expect(["house", "townhouse"]).toContain(d.type);
      if (d.roof !== "flat") pitched++;
      expect(dressBuilding(info({ seed, rectangle: false })).roof).toBe("flat");
    }
    expect(pitched).toBeGreaterThan(120);
  });

  it("is the same for the same info and seed, and varies with the seed", () => {
    expect(dressBuilding(info({ seed: 42 }))).toEqual(dressBuilding(info({ seed: 42 })));
    const facades = new Set(Array.from({ length: 60 }, (_, seed) => dressBuilding(info({ seed })).facade));
    expect(facades.size).toBeGreaterThan(5);
  });

  it("uses the photo's roof where the rules say", () => {
    const zinc = roofIndex("zinc"), terracotta = roofIndex("terracotta");
    expect(dressBuilding(info({ poi: "shop", photoRoof: zinc })).roofColour).toBe(zinc);
    expect(dressBuilding(info({ kind: "church", photoRoof: terracotta })).roofColour).toBe(terracotta);
    // Warehouses take only a metal photo roof.
    const wh = dressBuilding(info({ area: 900, photoRoof: terracotta }));
    expect(ROOF_COLOURS[wh.roofColour].kind).toBe("metal");
    // Brick houses keep a tiled photo roof, at 22 degrees.
    for (let seed = 0; seed < 100; seed++) {
      const d = dressBuilding(info({ seed, photoRoof: terracotta }));
      if (d.type === "house" && FACADES[d.facade].name.startsWith("brick_") && d.roof !== "flat") {
        expect(d.roofColour).toBe(terracotta);
        expect(d.pitch).toBe(22);
      }
    }
  });
});
