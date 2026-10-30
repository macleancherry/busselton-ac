import { describe, expect, it } from "vitest";
import { LocalProjection, type LngLat, type Vec2 } from "../src/core/geo";
import { MODEL_NAMES } from "../src/core/treeModels";
import { decodeOwnPng } from "../src/core/png";
import { vergeTexture } from "../src/core/textures";
import { choose, landcoverZone, regionAt, resolveSpecies, seaDistanceField, tintedVerge, ZoneMap, ZONES, DEFAULT_REGION, type LandcoverPolygon } from "../src/core/zones";
import { buildTrack, type DataSources } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import { readKn5 } from "../src/core/kn5";

const mean = (png: Uint8Array) => {
  const { rgba, width, height } = decodeOwnPng(png);
  const m = [0, 0, 0];
  for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) m[c] += rgba[i * 4 + c] / (width * height);
  return m;
};

/** A square landcover polygon round a local point, in lng/lat. */
function square(proj: LocalProjection, c: Vec2, half: number, cls: string, subclass?: string): LandcoverPolygon {
  const ring: LngLat[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dx, dy]) => proj.toLngLat([c[0] + dx * half, c[1] + dy * half]));
  return { cls, subclass, rings: [ring] };
}

describe("region map", () => {
  it("knows the South West's landscapes by place", () => {
    expect(regionAt(115.07, -34.13).wood).toBe("karri"); // Boranup
    expect(regionAt(116.03, -34.44).wood).toBe("karri"); // Pemberton
    expect(regionAt(115.0, -33.8).coast).toBe("heath"); // the capes' west coast
    expect(regionAt(115.05, -33.8).wood).toBe("jarrah"); // the ridge behind it
    expect(regionAt(115.42, -33.62).wood).toBe("wetland"); // Vasse-Wonnerup
    expect(regionAt(115.6, -33.45).wood).toBe("tuart"); // the coastal plain
    expect(regionAt(115.8, -33.9).wood).toBe("jarrah"); // Blackwood Plateau
    expect(regionAt(150, -30)).toBe(DEFAULT_REGION);
  });

  it("reads landcover classes as zones for the region", () => {
    const capes = regionAt(115.05, -33.8);
    expect(landcoverZone("wood", undefined, capes)).toBe("jarrah");
    expect(landcoverZone("wood", undefined, regionAt(115.07, -34.13))).toBe("karri");
    expect(landcoverZone("farmland", "vineyard", capes)).toBe("vineyard");
    expect(landcoverZone("farmland", undefined, capes)).toBe("farm");
    expect(landcoverZone("wetland", "marsh", capes)).toBe("wetland");
    expect(landcoverZone("grass", "heath", capes)).toBe("heath");
    expect(landcoverZone("sand", "beach", capes)).toBe("coast");
    expect(landcoverZone("grass", "park", capes)).toBeNull();
  });
});

describe("species", () => {
  it("resolves species to the models the build has, borrowing a model for the ones it lacks", () => {
    // A build without karri and marri models borrows the tuart's.
    const five = MODEL_NAMES.filter((n) => n !== "karri" && n !== "marri");
    const list = resolveSpecies({ karri: 6, marri: 3, peppermint: 1 }, five);
    const tuart = five.indexOf("tuart"), pep = five.indexOf("peppermint");
    expect(list).toContainEqual({ pick: { variant: tuart, scale: 1.6 }, weight: 6 });
    expect(list).toContainEqual({ pick: { variant: tuart, scale: 1 }, weight: 3 });
    expect(list).toContainEqual({ pick: { variant: pep, scale: 1 }, weight: 1 });
    // With real karri and marri models (the CSP trees have them now), they're used as they are.
    const more = [...five, "karri", "marri"];
    const own = resolveSpecies({ karri: 6, marri: 3 }, more);
    expect(own.map((o) => more[o.pick.variant]).sort()).toEqual(["karri", "marri"]);
    expect(own.every((o) => o.pick.scale === 1)).toBe(true);
    // Jarrah takes marri's model when there is one.
    expect(more[resolveSpecies({ jarrah: 1 }, more)[0].pick.variant]).toBe("marri");
  });

  it("chooses by weight", () => {
    const list = [{ pick: { variant: 0, scale: 1 }, weight: 3 }, { pick: { variant: 1, scale: 1 }, weight: 1 }];
    expect(choose(list, 0.1)?.variant).toBe(0);
    expect(choose(list, 0.74)?.variant).toBe(0);
    expect(choose(list, 0.76)?.variant).toBe(1);
    expect(choose([], 0.5)).toBeNull();
  });
});

describe("distance to the sea", () => {
  it("measures metres to the nearest sea cell", () => {
    const d = seaDistanceField((x) => x < 0, { minX: -500, minY: -500, maxX: 2000, maxY: 500 });
    expect(d(-100, 0)).toBe(0);
    expect(d(500, 0)).toBeGreaterThan(450);
    expect(d(500, 0)).toBeLessThan(550);
    expect(seaDistanceField(() => false, { minX: 0, minY: 0, maxX: 100, maxY: 100 })(50, 50)).toBe(Infinity);
  });
});

describe("zone map", () => {
  // Inland on the capes ridge, near Margaret River: jarrah-marri country, west coast to the west.
  const proj = new LocalProjection([115.06, -33.95]);
  const map = (landcover: LandcoverPolygon[] = [], sea?: (x: number, y: number) => boolean) =>
    new ZoneMap({ toLngLat: (v) => proj.toLngLat(v), toLocal: (p) => proj.toLocal(p), landcover, sea, bounds: { minX: -3000, minY: -3000, maxX: 3000, maxY: 3000 } });

  it("uses landcover first, then the region", () => {
    const z = map([square(proj, [0, 0], 300, "wood"), square(proj, [1000, 0], 300, "farmland", "vineyard"), square(proj, [0, 1000], 300, "wetland")]);
    expect(z.zoneAt(0, 0).zone.name).toBe("jarrah");
    expect(z.zoneAt(1000, 0).zone.name).toBe("vineyard");
    expect(z.zoneAt(0, 1000).zone.name).toBe("wetland");
    expect(z.zoneAt(-1500, -1500).zone.name).toBe("farm"); // open land, no landcover
  });

  it("gives paddock and vineyard trees the region's bush species", () => {
    const z = map();
    expect(z.speciesAt(-1500, -1500)).toEqual(ZONES.jarrah.species);
  });

  it("turns wood and paddocks near the capes' west coast into heath, but not wetland", () => {
    const sea = (x: number) => x < -2000;
    const z = map([square(proj, [-1800, 0], 150, "wood"), square(proj, [-1800, 800], 150, "wetland")], sea);
    expect(z.zoneAt(-1800, 0).zone.name).toBe("heath");
    expect(z.zoneAt(-1800, 800).zone.name).toBe("wetland");
    expect(z.zoneAt(1500, 0).zone.name).toBe("farm");
  });

  it("thins heath to low scrub and keeps forest trees", () => {
    const z = map([square(proj, [0, 0], 400, "grass", "heath"), square(proj, [2000, 0], 400, "wood")]);
    let kept = 0, tall = 0;
    for (let i = 0; i < 400; i++) {
      const t = z.tree({ x: -350 + (i % 20) * 35, y: -350 + Math.floor(i / 20) * 35, scale: 1, variant: 0 }, MODEL_NAMES, (i * 0.618) % 1);
      if (t) {
        kept++;
        if (t.scale > ZONES.heath.maxScale) tall++;
      }
    }
    expect(kept).toBeGreaterThan(40);
    expect(kept).toBeLessThan(180);
    expect(tall).toBe(0);
    let forest = 0;
    for (let i = 0; i < 100; i++) if (z.tree({ x: 1700 + (i % 10) * 50, y: -250 + Math.floor(i / 10) * 50, scale: 1, variant: 0 }, MODEL_NAMES, (i * 0.618) % 1)) forest++;
    expect(forest).toBe(100);
  });

  it("is stable from one build to the next", () => {
    const a = map([square(proj, [0, 0], 300, "wood")]), b = map([square(proj, [0, 0], 300, "wood")]);
    for (let i = 0; i < 50; i++) {
      const t = { x: i * 37 - 900, y: i * 13 - 300, scale: 1, variant: 0 };
      expect(a.tree(t, MODEL_NAMES, 0.3)).toEqual(b.tree(t, MODEL_NAMES, 0.3));
    }
  });

  it("leans the ground mask toward each zone's mix", () => {
    const z = map([square(proj, [100, 100], 200, "wood")]);
    const w = 32, rgba = new Uint8Array(w * w * 4);
    for (let i = 0; i < w * w; i++) rgba.set([255, 0, 0, 255], i * 4); // the photo read all grass
    z.biasMask({ rgba, width: w, height: w }, { key: "c", minX: 0, minY: 0, maxX: 200, maxY: 200 }, 0.5);
    let g = 0, d = 0;
    for (let i = 0; i < w * w; i++) {
      expect(rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]).toBe(255);
      g += rgba[i * 4];
      d += rgba[i * 4 + 1];
    }
    // Jarrah forest: half leaf litter now.
    expect(d / (w * w)).toBeGreaterThan(70);
    expect(g / (w * w)).toBeLessThan(200);
  });

  it("colours the verge by the zones along the road", () => {
    const z = map([square(proj, [0, 0], 2000, "wood")]);
    const road: Vec2[] = Array.from({ length: 50 }, (_, i) => [i * 20 - 500, 0]);
    expect(z.vergeColour(road)).toEqual(ZONES.jarrah.verge);
    expect(z.shares(road).jarrah).toBeCloseTo(1);
    const m = mean(tintedVerge(ZONES.coast.verge));
    for (let c = 0; c < 3; c++) expect(Math.abs(m[c] - ZONES.coast.verge[c])).toBeLessThan(6);
  });
});

describe("buildTrack with zones", async () => {
  // 600 m of road through karri at Boranup.
  const lat0 = -34.13, lng0 = 115.07;
  const k = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const route: LngLat[] = Array.from({ length: 31 }, (_, i) => [lng0 + (i * 20) / k, lat0 + Math.sin(i / 5) * 0.0002]);
  const proj = new LocalProjection([lng0, lat0]);
  const wood = square(proj, [300, 0], 3000, "wood");
  const sources: DataSources = {
    dem: async (p, bounds, z) => DemGrid.fromFunction(p, z, bounds, () => 60).sample,
    widthAt: () => 6,
    coast: { ocean: [], piers: [], landcover: [wood] },
  };
  const opts = { name: "Zone Test", imageryZoom: 0, corridor: 40, horizon: 0, origin: [lng0, lat0] as [number, number] };
  const plain = await buildTrack(route, opts, sources);
  const zoned = await buildTrack(route, { ...opts, zones: true }, sources);

  it("builds, with the verge in the karri zone's colour", () => {
    const a = vergeOf(plain), b = vergeOf(zoned);
    expect(Math.abs(a[0] - mean(vergeTexture())[0])).toBeLessThan(1);
    expect(Math.abs(b[0] - ZONES.karri.verge[0])).toBeLessThan(6);
    expect(Math.abs(b[2] - ZONES.karri.verge[2])).toBeLessThan(6);
  });
});

/** The verge texture's mean colour, read out of the build's kn5. */
function vergeOf(r: { files: Record<string, Uint8Array> }): number[] {
  const kn5 = readKn5(r.files["zone_test/zone_test.kn5"]);
  const tex = kn5.textures.find((t) => t.name === "verge.png")!;
  return mean(tex.data);
}
