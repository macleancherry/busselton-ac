import { describe, expect, it } from "vitest";
import {
  buildBuildings,
  centroid,
  detectBuildings,
  filterBuildings,
  fromOsm,
  heightFromTags,
  houseRoof,
  isRectangle,
  nearestRoofColour,
  plainHouse,
  pointInRing,
  ringArea,
  safeName,
  usedFinishes,
  type Building,
} from "../src/core/buildings";
import { FACADE_INDEX, FACADES, LAYOUTS, ROOF_COLOURS } from "../src/core/buildingStyles";
import type { Vec2 } from "../src/core/geo";
import type { Kn5MeshNode } from "../src/core/kn5";
import type { SegmentIndex } from "../src/core/road";
import { SINK } from "../src/core/sceneGround";

const roofIndex = (name: string) => ROOF_COLOURS.findIndex((r) => r.name === name);
const facadeIndex = (name: string) => FACADE_INDEX.get(name)!;
const rect = (w: number, d: number, x = 0, y = 0): Vec2[] => [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
const house = (over: Partial<Building> = {}): Building => ({ ...plainHouse("hip", roofIndex("surfmist"), 3), ring: rect(12, 10), source: "osm", ...over });

/** AC positions (x, up, -y) back to local ENU. */
function enu(m: Kn5MeshNode): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < m.positions.length; i += 3) out.push([m.positions[i], -m.positions[i + 2], m.positions[i + 1]]);
  return out;
}
const named = (nodes: Kn5MeshNode[], prefix: string) => nodes.filter((m) => m.name.startsWith(prefix));
const tris = (nodes: Kn5MeshNode[]) => nodes.reduce((s, m) => s + m.indices.length / 3, 0);
/** Face normals (ENU) of every triangle in the meshes. */
function faceNormals(nodes: Kn5MeshNode[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const m of nodes) {
    const p = enu(m);
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = p[m.indices[i]], b = p[m.indices[i + 1]], c = p[m.indices[i + 2]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n: [number, number, number] = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...n);
      if (l > 1e-9) out.push([n[0] / l, n[1] / l, n[2] / l]);
    }
  }
  return out;
}

describe("ring helpers", () => {
  it("area is positive counter-clockwise, negative clockwise", () => {
    expect(ringArea(rect(4, 3))).toBeCloseTo(12);
    expect(ringArea(rect(4, 3).reverse())).toBeCloseTo(-12);
  });

  it("point in ring handles a concave notch", () => {
    const u: Vec2[] = [[0, 0], [9, 0], [9, 9], [6, 9], [6, 3], [3, 3], [3, 9], [0, 9]];
    expect(pointInRing(1, 1, u)).toBe(true);
    expect(pointInRing(4.5, 6, u)).toBe(false);
    expect(pointInRing(-1, 1, u)).toBe(false);
  });

  it("rectangles: a rotated one yes, a 20 degree parallelogram and a pentagon no", () => {
    const a = 0.6, c = Math.cos(a), s = Math.sin(a);
    expect(isRectangle(rect(8, 5).map(([x, y]): Vec2 => [x * c - y * s, x * s + y * c]))).toBe(true);
    const k = Math.tan((20 * Math.PI) / 180) * 5;
    expect(isRectangle([[0, 0], [8, 0], [8 + k, 5], [k, 5]])).toBe(false);
    expect(isRectangle([[0, 0], [8, 0], [8, 5], [4, 7], [0, 5]])).toBe(false);
  });

  it("centroid is the vertex mean", () => {
    expect(centroid([[0, 0], [4, 0], [4, 2], [0, 2]])).toEqual([2, 1]);
  });

  it("plain house and the roof guess", () => {
    const d = plainHouse("gable", 3, 2.8);
    expect(FACADES[d.facade].name).toBe("brick_red");
    expect(d).toMatchObject({ type: "house", roof: "gable", roofColour: 3, pitch: 22, height: 2.8 });
    expect(houseRoof(() => 0.5)).toBe("hip");
    expect(houseRoof(() => 0.9)).toBe("gable");
  });
});

describe("OSM footprints", () => {
  it("height from tags", () => {
    expect(heightFromTags({ height: "12" })).toBe(12);
    expect(heightFromTags({ render_height: "9" })).toBe(9);
    expect(heightFromTags({ height: "1", building: "house" })).toBe(3);
    expect(heightFromTags({ "building:levels": "2" })).toBe(7);
    expect(heightFromTags({ height: "300" })).toBe(80);
    expect(heightFromTags({ "building:levels": "40" })).toBe(80);
    expect(heightFromTags({ building: "garage" })).toBe(3.5);
    expect(heightFromTags({ building: "bungalow" })).toBe(3);
    expect(heightFromTags({ building: "yes" })).toBe(6);
  });

  it("small rectangles get pitched roofs; big ones and L shapes flat", () => {
    expect(fromOsm(rect(12, 10), { building: "house" }).roof).not.toBe("flat");
    expect(fromOsm(rect(30, 20), { building: "house" }).roof).toBe("flat");
    expect(fromOsm([[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]], { building: "house" }).roof).toBe("flat");
    expect(fromOsm(rect(12, 10), { building: "house", "roof:shape": "gabled" }).roof).toBe("gable");
    expect(fromOsm(rect(12, 10), { building: "house", "roof:shape": "hipped" }).roof).toBe("hip");
  });

  it("matches roof:colour, and seeds from the position, not the list index", () => {
    const red = fromOsm(rect(12, 10), { building: "house", "roof:colour": "#b0583a" });
    expect(["tile", "ctile"]).toContain(ROOF_COLOURS[red.roofColour].kind);
    const a = fromOsm(rect(12, 10, 100, 50), { building: "house" }, 3);
    const b = fromOsm(rect(12, 10, 100, 50), { building: "house" }, 999);
    expect(a).toEqual(b);
  });

  it("makes the ring counter-clockwise and drops a repeated closing point", () => {
    const b = fromOsm([[0, 0], [0, 10], [12, 10], [12, 0], [0, 0]], {});
    expect(b.ring).toHaveLength(4);
    expect(ringArea(b.ring)).toBeGreaterThan(0);
  });
});

describe("roof colour matching", () => {
  it("terracotta to a tile, pale grey to a pale metal, never membrane or gravel", () => {
    expect(["tile", "ctile"]).toContain(ROOF_COLOURS[nearestRoofColour([160, 78, 50])].kind);
    const pale = ROOF_COLOURS[nearestRoofColour([200, 200, 192])];
    expect(pale.kind).toBe("metal");
    expect(pale.rgb[0]).toBeGreaterThan(170);
    for (let v = 0; v < 256; v += 15) {
      const k = ROOF_COLOURS[nearestRoofColour([v, v, v])].kind;
      expect(k).not.toBe("membrane");
      expect(k).not.toBe("gravel");
    }
  });
});

describe("roofs in the photo", () => {
  // 0.25 m a pixel: a 400 px chunk is 100 m square, cells are 3 px.
  const SIZE = 400, MPP = 0.25;
  const chunk = { minX: 0, minY: 0, maxX: SIZE * MPP, maxY: SIZE * MPP };
  function canvas(paint: (x: number, y: number) => [number, number, number] | null): Uint8Array {
    const px = new Uint8Array(SIZE * SIZE * 4);
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        const x = (col + 0.5) * MPP, y = chunk.maxY - (row + 0.5) * MPP;
        const c = paint(x, y) ?? [70, 110, 50]; // grass
        px.set([...c, 255], (row * SIZE + col) * 4);
      }
    }
    return px;
  }

  it("finds a pale 12 x 9 m rotated roof on grass, about that size and turned the same way", () => {
    const a = 0.4, c = Math.cos(a), s = Math.sin(a);
    const img = canvas((x, y) => {
      const dx = x - 50, dy = y - 60;
      const u = dx * c + dy * s, v = -dx * s + dy * c;
      return Math.abs(u) < 6 && Math.abs(v) < 4.5 ? [215, 215, 210] : null;
    });
    const found = detectBuildings(img, SIZE, chunk);
    expect(found).toHaveLength(1);
    const b = found[0];
    expect(b.source).toBe("detected");
    expect(Math.abs(ringArea(b.ring))).toBeGreaterThan(108 * 0.8);
    expect(Math.abs(ringArea(b.ring))).toBeLessThan(108 * 1.25);
    const [cx, cy] = centroid(b.ring);
    expect(Math.hypot(cx - 50, cy - 60)).toBeLessThan(1);
    // The long side runs at about 0.4 rad (mod pi).
    const sides = [0, 1].map((k) => [b.ring[k + 1][0] - b.ring[k][0], b.ring[k + 1][1] - b.ring[k][1]]);
    const long = Math.hypot(sides[0][0], sides[0][1]) > Math.hypot(sides[1][0], sides[1][1]) ? sides[0] : sides[1];
    let ang = Math.atan2(long[1], long[0]);
    ang = ((ang % Math.PI) + Math.PI) % Math.PI;
    expect(Math.abs(ang - 0.4)).toBeLessThan(0.1);
    expect(ROOF_COLOURS[b.roofColour].kind).toBe("metal");
    expect(b.height).toBe(2.8);
  });

  it("ignores a 1 m wide pale path and a patch over 700 m^2", () => {
    expect(detectBuildings(canvas((x, y) => (Math.abs(y - 50) < 0.5 ? [220, 220, 216] : null)), SIZE, chunk)).toHaveLength(0);
    expect(detectBuildings(canvas((x, y) => (Math.abs(x - 50) < 15 && Math.abs(y - 50) < 15 ? [220, 220, 216] : null)), SIZE, chunk)).toHaveLength(0);
  });

  it("gives a terracotta roof a tile finish", () => {
    const found = detectBuildings(canvas((x, y) => (Math.abs(x - 30) < 7 && Math.abs(y - 30) < 5 ? [170, 80, 55] : null)), SIZE, chunk);
    expect(found).toHaveLength(1);
    expect(["tile", "ctile"]).toContain(ROOF_COLOURS[found[0].roofColour].kind);
  });
});

describe("filtering", () => {
  // A straight road along y = 0, 7 m wide.
  const index = {
    nearest: (x: number, y: number, max: number) => (Math.abs(y) <= max ? { dist: Math.abs(y), seg: 0, frac: 0, t: y } : null),
    at: () => ({ h: 0, bank: 0, width: 7, kerb: 0 }),
  } as unknown as SegmentIndex;
  const opts = { vergeWidth: 1.5 };

  it("drops a photo roof inside a mapped building, one on the verge and one too far away; keeps order", () => {
    const mapped = house({ ring: rect(20, 15, 0, 20) });
    const inside: Building = { ...house({ ring: rect(6, 5, 5, 25) }), source: "detected" };
    const verge = house({ ring: rect(10, 8, 40, 5) });
    const far = house({ ring: rect(10, 8, 40, 300) });
    const ok1 = house({ ring: rect(10, 8, 60, 12) });
    const ok2: Building = { ...house({ ring: rect(10, 8, 80, 12) }), source: "detected" };
    const tiny = house({ ring: rect(2, 2, 100, 20) });
    const kept = filterBuildings([ok2, mapped, inside, verge, far, tiny, ok1], index, opts, 100);
    expect(kept).toEqual([ok2, mapped, ok1]);
  });
});

describe("meshes", () => {
  it("walls on tilted ground: base under the lowest sample, tops at the highest corner plus height", () => {
    const g = (x: number, y: number) => 0.1 * x + 0.05 * y;
    const nodes = buildBuildings([house({ ring: rect(12, 10, 0, 0), roof: "flat" })], g);
    const walls = named(nodes, "1WALL_BLD_");
    const zs = walls.flatMap(enu).map((p) => p[2]);
    expect(Math.min(...zs)).toBeLessThanOrEqual(0 - SINK + 1e-4);
    expect(Math.max(...zs)).toBeCloseTo(g(12, 10) + 3, 4);
  });

  it("uses the building's own ground and sink when given", () => {
    const nodes = buildBuildings([house({ roof: "flat" })], () => 0, () => 0.4, () => () => 5);
    const zs = named(nodes, "1WALL_BLD_").flatMap(enu).map((p) => p[2]);
    expect(Math.min(...zs)).toBeCloseTo(4.6, 4);
    expect(Math.max(...zs)).toBeCloseTo(8, 4);
  });

  it("each roof shape: faces up, gables have two wall triangles, hips four roof faces", () => {
    const roofs = (roof: Building["roof"]) => {
      const nodes = buildBuildings([house({ roof })], () => 0);
      return { roof: named(nodes, "ROOF_"), walls: named(nodes, "1WALL_BLD_"), soffit: named(nodes, "SOFFIT_") };
    };
    for (const shape of ["hip", "gable", "skillion", "flat"] as const) {
      const r = roofs(shape);
      for (const n of faceNormals(r.roof)) expect(n[2]).toBeGreaterThan(0);
      if (shape !== "flat") for (const n of faceNormals(r.soffit)) expect(n[2]).toBeLessThan(0);
    }
    expect(tris(roofs("flat").roof)).toBe(2);
    const hip = roofs("hip");
    // Two trapezoids (two triangles each) and two hip ends.
    expect(tris(hip.roof)).toBe(6);
    const gable = roofs("gable");
    expect(tris(gable.roof)).toBe(4);
    // Four wall quads plus two gable triangles.
    expect(tris(gable.walls)).toBe(4 * 2 + 2);
    expect(tris(hip.walls)).toBe(4 * 2);
    // Ridge height: half the span times tan(pitch) over the wall top.
    const top = Math.max(...gable.roof.flatMap(enu).map((p) => p[2]));
    expect(top).toBeCloseTo(3 + 5 * Math.tan((22 * Math.PI) / 180), 4);
  });

  it("a long thin hip never has a negative ridge", () => {
    const nodes = buildBuildings([house({ ring: rect(4, 3.6), roof: "hip" })], () => 0);
    for (const n of faceNormals(named(nodes, "ROOF_"))) expect(n[2]).toBeGreaterThan(0);
  });

  it("windows: none past the wall ends or on layouts without panes, none behind the garage", () => {
    const lay = LAYOUTS.house;
    const ring = rect(16, 10);
    const nodes = buildBuildings([house({ ring, roof: "flat" })], () => 0);
    const panes = named(nodes, "WINDOWS_");
    expect(panes.length).toBeGreaterThan(0);
    for (const m of panes) {
      expect(m.material).toBe("window");
      expect(m.castShadows).toBe(false);
      for (const [x, y] of enu(m)) {
        expect(x).toBeGreaterThan(-0.1);
        expect(x).toBeLessThan(16.1);
        expect(y).toBeGreaterThan(-0.1);
        expect(y).toBeLessThan(10.1);
      }
    }
    // Pane count: per wall, openings whose whole span is 15 cm inside the wall.
    const shed = buildBuildings([house({ ring, roof: "flat", facade: facadeIndex("shed_surfmist") })], () => 0);
    expect(named(shed, "WINDOWS_")).toHaveLength(0);
    expect(lay.panes).toBe(true);

    // The front wall runs along y = 0 (first edge); a garage at 0.6 to 3.2 m.
    const withGarage = buildBuildings([house({ ring, roof: "flat", front: [ring[0], ring[1]], setback: 8, garage: true })], () => 0);
    const garage = named(withGarage, "GARAGE_");
    expect(garage).toHaveLength(1);
    const frontPanes = named(withGarage, "WINDOWS_").flatMap(enu).filter((p) => p[1] < 0.1);
    for (const [x] of frontPanes) expect(x < 0.5 || x > 3.3).toBe(true);
  });

  it("window sills stay over the ground outside the wall", () => {
    const g = (x: number) => 0.2 * x; // steep: the floor is the low end
    const nodes = buildBuildings([house({ ring: rect(16, 10), roof: "flat", height: 6 })], g);
    const panes = named(nodes, "WINDOWS_");
    for (const m of panes) {
      const p = enu(m);
      for (let q = 0; q < p.length; q += 4) {
        const quad = p.slice(q, q + 4);
        const zLow = Math.min(...quad.map((v) => v[2]));
        const xs = quad.map((v) => v[0]);
        const outside = Math.max(g(Math.min(...xs)), g(Math.max(...xs)));
        expect(zLow).toBeGreaterThanOrEqual(outside + 0.08 - 1e-4);
      }
    }
  });

  it("front: garage door, front door and driveway; none without a front; a warehouse one big door", () => {
    const ring = rect(14, 10);
    const front: [Vec2, Vec2] = [ring[0], ring[1]];
    const full = buildBuildings([house({ ring, front, setback: 8, garage: true })], () => 0);
    expect(named(full, "GARAGE_")).toHaveLength(1);
    expect(named(full, "DOOR_")).toHaveLength(1);
    expect(named(full, "DRIVEWAY_")).toHaveLength(1);
    expect(named(full, "DRIVEWAY_")[0].material).toBe("concrete");
    const dz = enu(named(full, "DRIVEWAY_")[0]).map((p) => p[2]);
    for (const z of dz) expect(z).toBeCloseTo(0.03, 5);

    const none = buildBuildings([house({ ring, garage: true })], () => 0);
    expect(named(none, "GARAGE_")).toHaveLength(0);
    expect(named(none, "DOOR_")).toHaveLength(0);
    expect(named(none, "DRIVEWAY_")).toHaveLength(0);

    const wh = buildBuildings([house({ ring: rect(30, 20), type: "warehouse", roof: "gable", pitch: 6, height: 7, front: [[0, 0], [30, 0]], facade: facadeIndex("tiltup") })], () => 0);
    const doors = named(wh, "GARAGE_");
    expect(tris(doors)).toBe(2);
    const xs = doors.flatMap(enu).map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4.5, 3);
  });

  it("verandah and awning on the front", () => {
    const ring = rect(14, 10);
    const front: [Vec2, Vec2] = [ring[0], ring[1]];
    const v = buildBuildings([house({ ring, front, setback: 6, verandah: true })], () => 0);
    expect(named(v, "POSTS_").length).toBeGreaterThan(0);
    const postYs = named(v, "POSTS_").flatMap(enu).map((p) => p[1]);
    // The verandah's posts stand out in front of the wall (y < 0).
    expect(Math.max(...postYs)).toBeLessThan(0);
    const a = buildBuildings([house({ ring, front, setback: 4, awning: true, type: "shop", roof: "flat" })], () => 0);
    const aw = named(a, "AWNING_");
    expect(aw).toHaveLength(1);
    const zs = enu(aw[0]).map((p) => p[2]);
    expect(Math.min(...zs)).toBeCloseTo(3, 4);
    expect(Math.max(...zs)).toBeCloseTo(3.35, 4);
    // Too shallow a setback: no awning.
    expect(named(buildBuildings([house({ ring, front, setback: 1, awning: true })], () => 0), "AWNING_")).toHaveLength(0);
  });

  it("a ground-floor facade is its own band", () => {
    const b = house({ ring: rect(20, 12), roof: "flat", type: "shop", facade: facadeIndex("upper_brick"), groundFacade: facadeIndex("shop_red"), height: 7.2 });
    const nodes = buildBuildings([b], () => 0);
    const mats = new Set(named(nodes, "1WALL_BLD_").map((m) => m.material));
    expect(mats).toEqual(new Set(["facade_upper_brick", "facade_shop_red"]));
    const shopZ = named(nodes, "1WALL_BLD_shop_red").flatMap(enu).map((p) => p[2]);
    expect(Math.max(...shopZ)).toBeCloseTo(LAYOUTS.shopfront.storey, 4);
  });

  it("names: surface keys kept out of wall names, walls 1WALL_BLD_, roofs ROOF_", () => {
    expect(safeName("render_sand")).toBe("render_snd");
    expect(safeName("Grass_Road_dirt_kerb_gravel")).toBe("grs_rd_drt_krb_grvl");
    const nodes = buildBuildings([house({ facade: facadeIndex("render_sand") })], () => 0);
    const walls = named(nodes, "1WALL_BLD_");
    expect(walls.length).toBeGreaterThan(0);
    for (const m of walls) {
      expect(m.name).not.toMatch(/sand/i);
      expect(m.material).toBe("facade_render_sand");
    }
    const roofs = named(nodes, "ROOF_");
    expect(roofs[0].name).toMatch(/^ROOF_surfmist_\d{3}$/);
    expect(roofs[0].material).toBe("roof_surfmist");
    expect(named(nodes, "SOFFIT_")[0].castShadows).toBe(false);
  });

  it("no buildings, no meshes", () => {
    expect(buildBuildings([], () => 0)).toEqual([]);
  });

  it("is the same twice and doesn't care about ring winding", () => {
    const b = house({ roof: "gable" });
    const cw = { ...b, ring: b.ring.slice().reverse() };
    const zsA = buildBuildings([b], () => 0).flatMap(enu).map((p) => p[2]).sort();
    const zsB = buildBuildings([cw], () => 0).flatMap(enu).map((p) => p[2]).sort();
    expect(zsA).toEqual(zsB);
  });
});

describe("usedFinishes", () => {
  it("lists every facade, ground-floor facade and roof finish", () => {
    const a = house({ facade: 3, roofColour: 5 });
    const b = house({ facade: 7, groundFacade: 9, roofColour: 2 });
    const used = usedFinishes([a, b]);
    expect([...used.facades].sort((x, y) => x - y)).toEqual([3, 7, 9]);
    expect([...used.roofs].sort((x, y) => x - y)).toEqual([2, 5]);
  });
});
