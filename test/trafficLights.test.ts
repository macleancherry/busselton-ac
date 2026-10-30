import { afterEach, describe, expect, it, vi } from "vitest";
import { addTrafficLights, buildTrafficLights, findSignalSites, fitSides, lensName, MAST_WIDTH, trafficLightMaterials, type SignalLine } from "../src/core/trafficLights";
import { fetchOsm, signalQuery, signalsFromElements } from "../src/services/osm";
import { buildTrack, type DataSources } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import { readKn5, type Kn5MeshNode, type Kn5Node } from "../src/core/kn5";
import type { LngLat, Vec2 } from "../src/core/geo";

const deg = (a: number): Vec2 => [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)];
/** ENU vertices of a kn5 mesh (kn5 is X east, Y up, Z south). */
const verts = (n: { positions: Float32Array }) => Array.from({ length: n.positions.length / 3 }, (_, i) => [n.positions[i * 3], -n.positions[i * 3 + 2], n.positions[i * 3 + 1]]);
const normals = (n: { normals: Float32Array }) => Array.from({ length: n.normals.length / 3 }, (_, i) => [n.normals[i * 3], -n.normals[i * 3 + 2], n.normals[i * 3 + 1]]);

// A 14 m road running east along y = 0 (wide enough for mast arms), an 8 m street leaving it
// north at x = 100 from the road's edge, and the road carrying on.
const road: SignalLine = { pts: Array.from({ length: 41 }, (_, i) => [i * 10 - 100, 0] as Vec2), width: 14, main: true };
const street: SignalLine = { pts: [[100, 7], [100, 40], [100, 90]], width: 8 };
const crossStreet: SignalLine = { pts: [[200, -80], [200, -7]], width: 8 };
const crossStreet2: SignalLine = { pts: [[200, 7], [200, 80]], width: 8 };

describe("fitting the planner's four sides", () => {
  it("puts a crossroads' approaches on four sides, opposite ones opposite", () => {
    const f = fitSides([deg(5), deg(95), deg(185), deg(275)]);
    expect(f.ok).toBe(true);
    expect(new Set(f.sides).size).toBe(4);
    expect((f.sides[0] - f.sides[2] + 4) % 4).toBe(2);
    expect((f.sides[1] - f.sides[3] + 4) % 4).toBe(2);
  });
  it("gives up on a five-way junction", () => {
    expect(fitSides([deg(0), deg(72), deg(144), deg(216), deg(288)]).ok).toBe(false);
  });
});

describe("finding signalled sites", () => {
  it("makes one junction of a T's signals, centred where the street meets the road", () => {
    const sites = findSignalSites([{ at: [101, 3], crossing: false }, { at: [92, -4], crossing: false }, { at: [104, 12], crossing: true }], [road, street]);
    expect(sites).toHaveLength(1);
    const s = sites[0];
    expect(s.kind).toBe("junction");
    expect(Math.hypot(s.c[0] - 100, s.c[1])).toBeLessThan(0.5);
    expect(s.arms).toHaveLength(3);
    expect(s.sidesOk).toBe(true);
    const east = s.arms.find((a) => a.dir[0] > 0.9)!, north = s.arms.find((a) => a.dir[1] > 0.9)!;
    expect(east.width).toBe(14);
    expect(north.width).toBe(8);
    // Clear of the road across, with room for a pedestrian crossing.
    expect(east.stop).toBeGreaterThan(4 + 3);
    expect(north.stop).toBeGreaterThan(7 + 3);
    // East and west face each other across the polygon.
    const west = s.arms.find((a) => a.dir[0] < -0.9)!;
    expect((east.side - west.side + 4) % 4).toBe(2);
  });

  it("makes a pedestrian crossing on one road a two-armed site", () => {
    const sites = findSignalSites([{ at: [-40, 2], crossing: true }], [road, street]);
    expect(sites).toHaveLength(1);
    expect(sites[0].kind).toBe("crossing");
    expect(sites[0].arms).toHaveLength(2);
    expect(Math.abs(sites[0].c[1])).toBeLessThan(0.01);
  });

  it("finds a crossroads made of two streets meeting the road from each side", () => {
    const sites = findSignalSites([{ at: [200, 0], crossing: false }], [road, crossStreet, crossStreet2]);
    expect(sites).toHaveLength(1);
    expect(sites[0].arms).toHaveLength(4);
    expect(sites[0].sidesOk).toBe(true);
  });

  it("leaves out blocked sites and signals far from any road", () => {
    expect(findSignalSites([{ at: [101, 3], crossing: false }], [road, street], () => true)).toHaveLength(0);
    expect(findSignalSites([{ at: [0, 200], crossing: false }], [road, street])).toHaveLength(0);
  });
});

describe("building posts and heads", () => {
  const sites = findSignalSites([{ at: [100, 0], crossing: false }], [road, street]);
  const onRoad = (x: number, y: number) => Math.abs(y) < 7.3 || (Math.abs(x - 100) < 4.3 && y > 0);
  const r = buildTrafficLights({ sites, roadZ: () => 10, groundZ: () => 10.15, onRoad });
  const byName = (re: RegExp) => r.nodes.filter((n) => re.test(n.name));

  it("names each side's lenses for the traffic planner", () => {
    for (const arm of sites[0].arms) {
      for (const col of ["RED", "AMBER", "GREEN"] as const) expect(byName(new RegExp(`^${lensName(0, arm.side, col)}$`))).toHaveLength(1);
    }
    expect(byName(/^TRAFFICLIGHT_0_POLES$/)).toHaveLength(1);
    expect(byName(/^TRAFFICLIGHT_0_HEADS$/)).toHaveLength(1);
    expect(byName(/^MARKINGS_TL_0$/)).toHaveLength(1);
  });

  it("faces each approach's lenses out along its road, at the drivers coming in", () => {
    const east = sites[0].arms.find((a) => a.dir[0] > 0.9)!;
    const red = byName(new RegExp(`^${lensName(0, east.side, "RED")}$`))[0];
    for (const n of normals(red)) expect(n[0]).toBeGreaterThan(0.99);
    // Red on top of amber on top of green.
    const z = (col: "RED" | "AMBER" | "GREEN") => Math.min(...verts(byName(new RegExp(`^${lensName(0, east.side, col)}$`))[0]).map((v) => v[2]));
    expect(z("RED")).toBeGreaterThan(z("AMBER"));
    expect(z("AMBER")).toBeGreaterThan(z("GREEN"));
  });

  it("stands no post on the road, and puts a mast arm over a wide road", () => {
    expect(14).toBeGreaterThanOrEqual(MAST_WIDTH);
    const poles = byName(/_POLES$/)[0];
    // Every post's foot (vertices at the bottom) off the asphalt.
    for (const [x, y, zv] of verts(poles)) if (zv < 10) expect(onRoad(x, y)).toBe(false);
    // Something (the arm and its head) reaches out over the road at mast height.
    const heads = byName(/_HEADS$/)[0];
    expect(verts(heads).some(([x, y, zv]) => onRoad(x, y) && zv > 15)).toBe(true);
    expect(r.heads).toBeGreaterThanOrEqual(6);
    expect(r.poles).toBeGreaterThanOrEqual(3);
  });

  it("paints stop lines on the road surface, on the left of traffic coming in", () => {
    const paint = byName(/^MARKINGS_TL_0$/)[0];
    for (const [, , zv] of verts(paint)) expect(zv).toBeCloseTo(10.02, 3);
    for (const n of normals(paint)) expect(n[2]).toBeGreaterThan(0.99);
    // The east arm's stop line (traffic heading west keeps left, the south half: y < 0).
    const east = sites[0].arms.find((a) => a.dir[0] > 0.9)!;
    const bar = verts(paint).filter(([x]) => Math.abs(x - (100 + east.stop)) < 0.2);
    expect(bar.length).toBeGreaterThan(0);
    for (const [, y] of bar) expect(y).toBeLessThan(0);
  });

  it("has a material for each mesh, lenses unlit", () => {
    const mats = trafficLightMaterials();
    for (const name of ["tl_pole", "tl_head", "tl_red", "tl_amber", "tl_green"]) expect(mats.some((m) => m.material.name === name)).toBe(true);
    const red = mats.find((m) => m.material.name === "tl_red")!.material;
    expect(red.properties.find((p) => p.name === "ksEmissive")!.c).toEqual([0, 0, 0]);
  });
});

describe("lights for the traffic planner", () => {
  const sites = findSignalSites([{ at: [100, 0], crossing: false }, { at: [-40, 0], crossing: true }], [road, street]);
  const oct = (cx: number, cy: number, r: number, h: number) => Array.from({ length: 8 }, (_, k) => [cx + r * Math.cos((k * Math.PI) / 4), h, -(cy + r * Math.sin((k * Math.PI) / 4))]);
  const traffic = JSON.stringify({
    lanes: [{ points: [[-100, 10, 2], [300, 10, 2]] }, { points: [[300, 10, -2], [-100, 10, -2]] }],
    intersections: [{ name: "Junction 1", id: 1, points: oct(100, 0, 9, 10) }, { name: "Junction 2", id: 2, points: oct(250, 0, 9, 10) }],
    areas: [],
    rules: { laneRoles: [] },
  });
  const out = JSON.parse(addTrafficLights(traffic, sites));

  it("turns the junction's polygon into four sides with a Basic light naming the lens meshes", () => {
    const j = out.intersections.find((i: { id: number }) => i.id === 1);
    expect(j.points).toHaveLength(4);
    expect(j.trafficLight.program).toBe("Basic");
    expect(j.trafficLight.emissive).toHaveLength(4);
    const site = sites.find((st) => st.kind === "junction")!;
    for (const arm of site.arms) {
      expect(j.trafficLight.emissive[arm.side].mode).toBe(1);
      expect(j.trafficLight.emissive[arm.side].roles.map((x: { mesh: string }) => x.mesh)).toEqual(["RED", "AMBER", "GREEN"].map((c) => lensName(site.id, arm.side, c as "RED")));
    }
    // The empty side (south of the T) has no lights.
    expect(j.trafficLight.emissive.filter((e: object) => Object.keys(e).length === 0)).toHaveLength(1);
    // Edge k is at the arm on side k's stop line.
    for (const arm of site.arms) {
      const a = j.points[arm.side], b = j.points[(arm.side + 1) % 4];
      const mid: Vec2 = [(a[0] + b[0]) / 2, -(a[2] + b[2]) / 2];
      const along = (mid[0] - site.c[0]) * arm.dir[0] + (mid[1] - site.c[1]) * arm.dir[1];
      expect(along).toBeCloseTo(arm.stop, 1);
    }
    // Same height as before; the other junction untouched.
    expect(j.points.every((p: number[]) => p[1] === 10)).toBe(true);
    expect(out.intersections.find((i: { id: number }) => i.id === 2).trafficLight).toBeUndefined();
  });

  it("adds a crossing of its own where there was no junction", () => {
    const c = out.intersections.find((i: { name: string; id: number }) => /^Signals/.test(i.name) && i.id > 2);
    expect(c).toBeTruthy();
    expect(c.points).toHaveLength(4);
    expect(c.points[0][1]).toBe(10);
    expect(c.trafficLight.emissive.filter((e: { mode?: number }) => e.mode === 1)).toHaveLength(2);
  });

  it("leaves traffic alone with no sites", () => {
    expect(addTrafficLights(traffic, [])).toBe(traffic);
    expect(addTrafficLights("", sites)).toBe("");
  });
});

describe("OSM traffic signals", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads junction and crossing signals, not flashing or emergency ones", () => {
    const s = signalsFromElements([
      { type: "node", lat: -33.65, lon: 115.34, tags: { highway: "traffic_signals" } },
      { type: "node", lat: -33.651, lon: 115.341, tags: { highway: "crossing", crossing: "traffic_signals" } },
      { type: "node", lat: -33.652, lon: 115.342, tags: { highway: "traffic_signals", traffic_signals: "emergency" } },
      { type: "node", lat: -33.65, lon: 115.34, tags: { highway: "traffic_signals" } },
      { type: "way", tags: { highway: "traffic_signals" } },
    ]);
    expect(s).toEqual([{ at: [115.34, -33.65], crossing: false }, { at: [115.341, -33.651], crossing: true }]);
  });

  it("asks for them in a query of their own, leaving the main query (the snapshot key) as it was", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
      bodies.push(init.body.get("data")!);
      const signal = /traffic_signals/.test(init.body.get("data")!);
      return new Response(JSON.stringify({ elements: signal ? [{ type: "node", lat: -33.65, lon: 115.34, tags: { highway: "traffic_signals" } }] : [] }));
    }));
    const route: LngLat[] = [[115.33, -33.65], [115.35, -33.65]];
    const off = await fetchOsm(route, [], {});
    const offBodies = [...new Set(bodies)];
    bodies.length = 0;
    const on = await fetchOsm(route, [], { trafficSignals: true });
    const onBodies = [...new Set(bodies)];
    expect(offBodies).toHaveLength(1);
    expect(offBodies[0]).not.toMatch(/traffic_signals/);
    expect(onBodies).toHaveLength(2);
    expect(onBodies).toContain(offBodies[0]);
    expect(onBodies).toContain(signalQuery(route));
    expect(off.features.trafficSignals).toBeUndefined();
    expect(on.features.trafficSignals).toEqual([{ at: [115.34, -33.65], crossing: false }]);
  });
});

function meshes(n: Kn5Node): Kn5MeshNode[] {
  return n.kind === "mesh" ? [n] : n.children.flatMap(meshes);
}

describe("buildTrack with traffic lights", async () => {
  const lat0 = -33.65, lng0 = 115.34;
  const mLat = 111_320, mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const at = (x: number, y: number): LngLat => [lng0 + x / mLng, lat0 + y / mLat];
  const route = Array.from({ length: 21 }, (_, i) => at(i * 20 - 200, 0));
  const sources: DataSources = {
    dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, () => 5).sample,
    osm: { buildings: [], guardRails: [], trafficSignals: [{ at: at(0, 1), crossing: false }] },
    streets: { lines: [{ cls: "minor", pts: [at(0, 0), at(0, 80)] }], names: [] },
  };
  const build = (trafficLights?: boolean) => buildTrack(route, { name: "Lights", corridor: 50, horizon: 0, imageryZoom: 0, trees: 0, traffic: true, ...(trafficLights === undefined ? {} : { trafficLights }) }, sources);
  const on = await build();
  const off = await build(false);

  it("builds posts, heads and lenses, and lights the junction in traffic.json", () => {
    const all = meshes(readKn5(on.files["lights/lights.kn5"]).root);
    expect(all.some((m) => /^TRAFFICLIGHT_0_POLES/.test(m.name))).toBe(true);
    expect(all.some((m) => /^TRAFFICLIGHT_0_S\d_RED/.test(m.name))).toBe(true);
    const t = JSON.parse(new TextDecoder().decode(on.files["lights/data/traffic.json"]));
    const lit = t.intersections.filter((i: { trafficLight?: unknown }) => i.trafficLight);
    expect(lit).toHaveLength(1);
    // Every lens mesh the light names is in the model.
    for (const e of lit[0].trafficLight.emissive) for (const r of e.roles ?? []) expect(all.some((m) => m.name === r.mesh)).toBe(true);
    expect(on.stats.trafficLights?.sites).toBe(1);
  });

  it("builds none of it when off", () => {
    const all = meshes(readKn5(off.files["lights/lights.kn5"]).root);
    expect(all.some((m) => /TRAFFICLIGHT/.test(m.name))).toBe(false);
    const t = JSON.parse(new TextDecoder().decode(off.files["lights/data/traffic.json"]));
    expect(t.intersections.some((i: { trafficLight?: unknown }) => i.trafficLight)).toBe(false);
  });
});
