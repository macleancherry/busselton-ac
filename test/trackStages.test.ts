// Contract tests for the track build (docs/specs/track.md section 15, items 4-17), against the
// synthetic scenes (test/fixtures/trackScenes.ts) and small hand-made inputs.

import { beforeAll, describe, expect, it } from "vitest";
import { buildTrack, trackObjects, type TrackResult } from "../src/core/track";
import { SCENES, ll } from "./fixtures/trackScenes";
import { DemGrid } from "../src/core/elevation";
import { readKn5, type Kn5GroupNode, type Kn5Node } from "../src/core/kn5";
import { checkGround, PLACED_GROUPS, SURFACE_GROUPS } from "../src/core/groundCheck";
import { POLE_GROUPS } from "../src/core/poleCheck";
import { STANDING_GROUPS } from "../src/core/padClear";
import { withDefaults } from "../src/core/options";
import { routeRuns } from "../src/core/stages/traffic";
import { sampleNearPin, along } from "../src/core/stages/routePlan";
import { Registry } from "../src/core/stages/registry";
import { solidTexture } from "../src/core/textures";
import { material } from "../src/core/materials";
import type { LngLat } from "../src/core/geo";
import type { RoadPlan } from "../src/core/road";

const GROUPS = ["ROAD", "SIDESTREETS", "JUNCTIONS", "FURNITURE", "WIRES", "ROUNDABOUTS", "MARKINGS", "VERGE", "KERBS", "TREES", "RAILS", "GUIDEPOSTS",
  "FARMROAD", "TRAFFICLIGHTS", "BUILDINGS", "SHOPS", "FENCES", "FARM", "PATHS", "LOTS", "JETTY", "SEAWALL", "TERRAIN", "HORIZON", "SEA", "WALLS"];

const build = (name: keyof typeof SCENES, extra = {}) => buildTrack(SCENES[name].route, { ...SCENES[name].opts, ...extra }, SCENES[name].sources());
const meshesOf = (n: Kn5Node): Kn5Node[] => (n.kind === "mesh" ? [n] : n.children.flatMap(meshesOf));
const text = (r: TrackResult, end: string) => new TextDecoder().decode(Object.entries(r.files).find(([k]) => k.endsWith(end))![1]);

describe("track build: errors", () => {
  const flat = { dem: async (proj: never, b: never, z: number) => DemGrid.fromFunction(proj, z, b, () => 5).sample };
  it("needs two pins", async () => {
    await expect(buildTrack([ll(0, 0)], {}, flat as never)).rejects.toThrow("Pick a start and a finish on the map first");
  });
  it("refuses a road under 300 m", async () => {
    const route: LngLat[] = Array.from({ length: 11 }, (_, i) => ll(i * 20, 0));
    await expect(buildTrack(route, { runUp: 0, runOff: 0, imageryZoom: 0, horizon: 0 }, flat as never)).rejects.toThrow("Road is 200 m; make it at least 300 m");
  });
});

describe("track build: a town loop with an area, streets and traffic (scene b)", () => {
  let r: TrackResult;
  const progress: [string, number | undefined][] = [];
  beforeAll(async () => {
    r = await buildTrack(SCENES.b.route, SCENES.b.opts, SCENES.b.sources(), {}, (s, f) => { progress.push([s, f]); });
  }, 300_000);

  it("reports progress in order, Done last", () => {
    const stages = progress.map(([s]) => s).filter((s, i, a) => s !== a[i - 1]);
    expect(stages).toEqual(["Laying out the road", "Fetching elevation", "Building road and terrain meshes", "Placing scenery", "Writing track files", "Done"]);
    expect(progress[progress.length - 1]).toEqual(["Done", 1]);
    const terrain = progress.filter(([s, f]) => s === "Building road and terrain meshes" && f !== undefined).map(([, f]) => f!);
    expect(terrain[0]).toBe(0);
    expect(terrain.every((f, i) => i === 0 || f > terrain[i - 1])).toBe(true);
  });

  it("writes every group in order, empty ones too, and no dummies in a layout's world", () => {
    const names = r.model.root.children.map((c) => c.name);
    expect(names).toEqual(GROUPS);
    for (const set of [SURFACE_GROUPS, PLACED_GROUPS, POLE_GROUPS, STANDING_GROUPS]) {
      for (const g of set) if (!["CARPARKS", "PARKED_CARS"].includes(g)) expect(names).toContain(g);
    }
    const layout = readKn5(r.files[`${r.slug}/layout_main.kn5`]).root.children.map((c) => c.name);
    expect(layout).toEqual(expect.arrayContaining(["AC_START_0", "AC_PIT_7", "AC_HOTLAP_START_0", "AC_TIME_0_L", "AC_TIME_0_R"]));
  });

  it("registers every texture and material once, and every material's textures", () => {
    const tex = r.model.textures.map((t) => t.name), mats = r.model.materials.map((m) => m.name);
    expect(new Set(tex).size).toBe(tex.length);
    expect(new Set(mats).size).toBe(mats.length);
    for (const m of r.model.materials) for (const t of Object.values(m.textures)) expect(tex).toContain(t);
    const used = new Set(meshesOf(r.model.root).map((m) => (m as { material: string }).material));
    for (const m of used) expect(mats).toContain(m);
  });

  it("makes the area's tile ring a kerbed roundabout of its own", () => {
    const area = r.plan.roundabouts.filter((rb) => Number.isNaN(rb.sIn));
    expect(area).toHaveLength(1);
    expect(area[0].kerbed).toBe(true);
    expect(Math.hypot(area[0].c[0] + 80, area[0].c[1])).toBeLessThan(1);
    const k = r.plan.roundabouts.indexOf(area[0]);
    expect(meshesOf(r.model.root).map((m) => m.name)).toContain(`1ROAD_RB${k}`);
  });

  it("records kerbs on the samples (kerbMetres agrees)", () => {
    const kerbed = r.plan.samples.reduce((n, s) => n + (s.kerb ? s.kerb[0] + s.kerb[1] : 0), 0);
    expect(kerbed * withDefaults(SCENES.b.opts).spacing).toBe(r.stats.kerbMetres);
    expect(r.stats.kerbMetres).toBeGreaterThan(0);
  });

  it("gives traffic its roads: the route in runs, streets but no car park aisle", () => {
    const roads = r.trafficInput!.roads;
    expect(roads.length).toBeGreaterThan(2);
    const aisle = SCENES.b.sources().streets!.lines.find((l) => l.service === "parking_aisle")!;
    const [ax] = r.proj.toLocal(aisle.pts[0]);
    expect(roads.some((rd) => rd.pts.length === 2 && Math.abs(rd.pts[0][0] - ax) < 0.5)).toBe(false);
    expect(r.trafficInput!.roundabouts).toHaveLength(r.plan.roundabouts.length);
    expect(Object.keys(r.files)).toContain(`${r.slug}/main/data/traffic.json`);
  });

  it("writes the files the game and the tools read", () => {
    expect(text(r, "data/surfaces.ini")).toMatch(/KEY=STREET[\s\S]*?IS_VALID_TRACK=1/);
    const limits = /LIMITS=([^\n]*)/.exec(text(r, "data/autotest.ini"))![1].split(",");
    expect(limits).toHaveLength(100);
    expect(text(r, "README.txt")).toMatch(/Terrain Tiles|Elevation/);
    for (const f of ["extension/autotest.lua", "extension/ext_config.ini", "extension/street_map.png", "baked_shadow_params.ini", "ui/main/ui_track.json", "models_main.ini"]) {
      expect(Object.keys(r.files).some((k) => k.endsWith(f))).toBe(true);
    }
  });

  it("keeps every stat key with its type", () => {
    const s = r.stats as Record<string, unknown>;
    for (const k of ["length", "timedLength", "minElevation", "maxElevation", "climb", "meanWidth", "vertices", "triangles", "terrainChunks", "kn5Bytes", "trees",
      "buildings", "buildingsDetected", "traced", "photoLines", "photoChunks", "sideStreets", "sideTraced", "kerbMetres", "poles", "streetLights", "carParkLights",
      "footpathMetres", "driveways", "streetSigns", "signs", "railMetres"]) expect(typeof s[k], k).toBe("number");
    expect(s.closed).toBe(true);
    expect(s.timedLength).toBe(s.length);
    expect(s.parkedCars).toBe(r.parked.length);
    expect(s.kn5Bytes).toBe(r.files[`${r.slug}/${r.slug}.kn5`].length);
  });
});

describe("track build: a point to point over hills (scene a)", () => {
  let r: TrackResult;
  beforeAll(async () => { r = await build("a", { detailShaders: false }); }, 300_000);

  it("puts the gates on the timed samples, the grid behind the start and the finish short of the end", () => {
    const ds = r.model.root.children.filter((c) => c.name.startsWith("AC_")) as Kn5GroupNode[];
    const at = (name: string) => { const t = ds.find((d) => d.name === name)!.transform; return [t[12], -t[14]]; };
    const plan = r.plan, timed = plan.timed!;
    const nearestS = (p: number[]) => plan.samples.reduce((b, s) => (Math.hypot(s.pos[0] - p[0], s.pos[1] - p[1]) < Math.hypot(b.pos[0] - p[0], b.pos[1] - p[1]) ? s : b)).s;
    const mid = (n: string) => { const a = at(`${n}_L`), b = at(`${n}_R`); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    const spacing = withDefaults(SCENES.a.opts).spacing;
    expect(Math.abs(nearestS(mid("AC_AB_START")) - plan.samples[timed.start].s)).toBeLessThan(spacing * 1.5);
    expect(Math.abs(nearestS(mid("AC_AB_FINISH")) - plan.samples[timed.finish].s)).toBeLessThan(spacing * 1.5);
    expect(plan.samples[plan.samples.length - 1].s - nearestS(mid("AC_AB_FINISH"))).toBeGreaterThanOrEqual(25 - spacing);
    const start = nearestS(mid("AC_AB_START"));
    for (let k = 0; k < 8; k++) expect(start - nearestS(at(`AC_START_${k}`))).toBeGreaterThanOrEqual(8 - spacing);
    // Spawn Z axis along the road.
    const t = ds.find((d) => d.name === "AC_START_0")!.transform;
    const s0 = plan.samples.find((s) => Math.abs(s.s - nearestS(at("AC_START_0"))) < 1e-6)!;
    expect(t[8] * s0.tan[0] - t[10] * s0.tan[1]).toBeGreaterThan(0.99);
  });

  it("has no normal maps or masks without detail shaders", () => {
    expect(r.model.textures.some((t) => /_nm\.|_mask\./.test(t.name))).toBe(false);
  });

  it("splits timedLength from the whole road", () => {
    expect(r.stats.timedLength).toBeCloseTo(r.plan.samples[r.plan.timed!.finish].s - r.plan.samples[r.plan.timed!.start].s, 9);
    expect(r.stats.timedLength).toBeLessThan(r.stats.length);
    expect(r.trafficInput).toBeUndefined();
  });
});

describe("track build: Busselton-like dressing (scene d)", () => {
  let r: TrackResult;
  beforeAll(async () => { r = await build("d"); }, 600_000);

  it("clears the circles of buildings (and of trees where asked), and ignores looks in them", () => {
    const verts = (groups: string[]) => (r.model.root.children.filter((c) => groups.includes(c.name)) as Kn5GroupNode[]).flatMap(meshesOf) as { name: string; positions: Float32Array }[];
    const inside = (x: number, y: number, c: [number, number], rad: number) => Math.hypot(x - c[0], y - c[1]) < rad - 0.5;
    const c1 = r.proj.toLocal(ll(98, 14)), c2 = r.proj.toLocal(ll(-46, -14));
    for (const m of verts(["BUILDINGS"])) {
      for (let i = 0; i < m.positions.length; i += 3) {
        const x = m.positions[i], y = -m.positions[i + 2];
        expect(inside(x, y, c1, 10) && Math.hypot(x - c1[0], y - c1[1]) < 4).toBe(false);
        expect(inside(x, y, c2, 8) && Math.hypot(x - c2[0], y - c2[1]) < 3).toBe(false);
      }
    }
    expect(r.houses.some((h) => { const [x, y] = r.proj.toLocal(h.ring[0]); return Math.hypot(x - c2[0], y - c2[1]) < 8; })).toBe(false);
  });

  it("parks cars in bays, none on the route's road", () => {
    expect(r.stats.parkedCars).toBe(r.parked.length);
    expect(r.parked.length).toBeGreaterThan(0);
    expect(checkGround(r.model.root as Kn5Node).parkedOnRoad).toEqual([]);
    const names = r.model.root.children.map((c) => c.name);
    expect(names.slice(-3)).toEqual(["CARPARKS", "PARKED_CARS", "PARKED_CAR_WALLS"]);
  });

  it("reads footpaths and driveways off the photo, and credits Mapillary and the elevation", () => {
    expect(r.stats.footpathMetres).toBeGreaterThan(0);
    expect(r.stats.driveways).toBeGreaterThan(0);
    const readme = text(r, "README.txt");
    expect(readme).toMatch(/Mapillary/);
    expect(readme).toMatch(/Synthetic DEM/);
    expect(text(r, "data/autotest.ini")).toMatch(/SHOTS=/);
  });

  it("stands placed things on the scene's ground", () => {
    const rep = checkGround(r.model.root as Kn5Node, { tolerance: 0.05 });
    expect(rep.off.filter((o) => o.group !== "PARKED_CARS")).toEqual([]);
  });
});

describe("track stages: small pieces", () => {
  const plan = (n: number, closed = false): RoadPlan => ({
    closed, length: (n - (closed ? 0 : 1)) * 2, roundabouts: [],
    samples: Array.from({ length: n }, (_, i) => ({ pos: [i * 2, 0], tan: [1, 0], left: [0, 1], curvature: 0, s: i * 2, width: 7, h: 0, bank: 0 })),
  });

  it("routeRuns splits where the road turns wide, not at a short blip, and a loop of one width is one closed run", () => {
    const w = Array.from({ length: 200 }, (_, i) => (i >= 100 ? 13 : 7));
    const r1 = routeRuns(w, false, 2);
    expect(r1.runs).toHaveLength(2);
    expect(r1.runs[0][r1.runs[0].length - 1]).toBe(r1.runs[1][0]);
    const blip = Array.from({ length: 200 }, (_, i) => (i >= 100 && i < 110 ? 13 : 7));
    expect(routeRuns(blip, false, 2).runs).toHaveLength(1);
    const loop = routeRuns(new Array(120).fill(7), true, 2);
    expect(loop.runs).toHaveLength(1);
    expect(loop.wrapped).toBe(true);
  });

  it("sampleNearPin looks round where the pin should be first", () => {
    const p = plan(101);
    // Near where the pin should be (frac of the way), the nearest sample within the window there.
    expect(sampleNearPin(p, [20, 0], 0.1)).toBe(10);
    expect(sampleNearPin(p, [20, 3], 0.9)).toBe(60);
  });

  it("along takes the sample a distance falls in, wrapping on a loop", () => {
    const p = plan(50, true);
    expect(along(p, 7, 0, 0, 0).sample.s).toBe(6);
    expect(along(p, p.length + 3, 0, 0, 0).sample.s).toBe(2);
    expect(along(p, 10, 2, 1, 0).pos).toEqual([10, 1, -2]);
  });

  it("the registry keeps order and swaps a material in place", () => {
    const reg = new Registry(true);
    reg.scenery("a.png", solidTexture([1, 2, 3]), material("a", "a.png", { ambient: 1, diffuse: 1, specular: 0, exp: 1 }));
    reg.relief("b", solidTexture([9, 9, 9]), { ambient: 1, diffuse: 1, specular: 0, exp: 1 }, 2);
    reg.replaceMaterial(material("a", "b.png", { ambient: 0.5, diffuse: 1, specular: 0, exp: 1 }));
    expect(reg.textures.map((t) => t.name)).toEqual(["a.png", "b.png", "b_nm.png"]);
    expect(reg.materials.map((m) => [m.name, m.shader])).toEqual([["a", "ksPerPixel"], ["b", "ksPerPixelNM"]]);
    expect(reg.materials[0].textures.txDiffuse).toBe("b.png");
    const plain = new Registry(false);
    plain.relief("b", solidTexture([9, 9, 9]), { ambient: 1, diffuse: 1, specular: 0, exp: 1 }, 2);
    expect(plain.textures.map((t) => t.name)).toEqual(["b.png"]);
  });

  it("trackObjects on a loop: starts and pits, a hot lap start and the timing line", () => {
    const p = plan(300, true);
    const names = trackObjects(p, withDefaults({ pitCount: 4 })).map((d) => d.name);
    expect(names).toEqual(["AC_START_0", "AC_PIT_0", "AC_START_1", "AC_PIT_1", "AC_START_2", "AC_PIT_2", "AC_START_3", "AC_PIT_3", "AC_HOTLAP_START_0", "AC_TIME_0_L", "AC_TIME_0_R"]);
  });

  it("puts a narrow street's grid in single file", () => {
    const p = plan(300, true);
    p.samples.forEach((s) => (s.width = 6));
    const ts = trackObjects(p, withDefaults({ pitCount: 4 })).filter((d) => d.name.startsWith("AC_START_"));
    // One behind another, 8 m apart, within half a metre of the centre line (gridSlots.ts staggers them).
    for (const d of ts) expect(Math.abs(d.transform[14])).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(new Set(ts.map((d) => Math.round(d.transform[12]))).size).toBe(ts.length);
  });
});

