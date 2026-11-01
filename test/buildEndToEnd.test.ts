// Whole builds of small synthetic roads, checked from the outside (docs/specs/old-build-tests.md, part A).

import { beforeAll, describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { buildTrack, type DataSources, type TrackResult } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import { readKn5, type Kn5GroupNode, type Kn5MeshNode, type Kn5Node } from "../src/core/kn5";
import { clearOfRoute, KEEP_OFF, onRoute } from "../src/core/clearance";
import { SegmentIndex } from "../src/core/road";
import { readFastLaneAi } from "../src/core/aiSpline";
import { zipTrack } from "../src/core/zip";
import { encodePng } from "../src/core/png";
import type { ArtRequest } from "../src/core/art";
import type { LngLat, Vec2 } from "../src/core/geo";

// Somewhere in the hills east of Perth; local metres east and north of this point.
const LNG = 116.1, LAT = -31.95;
const M_LNG = 111_320 * Math.cos((LAT * Math.PI) / 180), M_LAT = 111_320;
const toLngLat = ([x, y]: Vec2): LngLat => [LNG + x / M_LNG, LAT + y / M_LAT];

/** Hills that rise to the north and roll east to west. */
const height = (x: number, y: number) => 120 + 30 * Math.sin(x / 260) + 15 * Math.cos(y / 180) + 0.04 * y;

const flatDem = (h: number): DataSources["dem"] => async (proj, bounds, zoom) => DemGrid.fromFunction(proj, zoom, bounds, () => h).sample;

/** Every art request gets a full cell, so any sign can be built. */
function artCatcher(asked: ArtRequest[]): DataSources["renderArt"] {
  return async (items) => {
    asked.push(...items);
    return {
      data: encodePng(new Uint8Array(16 * 4), 4, 4, { alpha: true }),
      cells: Object.fromEntries(items.map((r) => [r.key, { u0: 0, v0: 0, u1: 1, v1: 1, aspect: r.kind === "gate" ? 3 : 1 }])),
    };
  };
}

const flatten = (n: Kn5Node): Kn5Node[] => (n.kind === "mesh" ? [n] : [n, ...n.children.flatMap(flatten)]);
const isMesh = (n: Kn5Node): n is Kn5MeshNode => n.kind === "mesh";
const decode = (r: TrackResult, path: string) => new TextDecoder().decode(r.files[`${r.slug}/${path}`]);

/** Index of the plan sample nearest a local point. */
function nearestSample(r: TrackResult, p: Vec2): number {
  let best = 0, bestD = Infinity;
  r.plan.samples.forEach((s, i) => {
    const d = Math.hypot(s.pos[0] - p[0], s.pos[1] - p[1]);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

describe("a point-to-point road over hills, ending in a hairpin", () => {
  // East along gentle bends for 1.4 km, a 28 m hairpin, then back west for 1 km.
  const pts: Vec2[] = [];
  for (let x = 0; x <= 1400; x += 20) pts.push([x, 18 * Math.sin(x / 120)]);
  const y0 = 18 * Math.sin(1400 / 120);
  for (let a = -80; a <= 80; a += 10) pts.push([1400 + 28 * Math.cos((a * Math.PI) / 180), y0 + 28 + 28 * Math.sin((a * Math.PI) / 180)]);
  for (let x = 1390; x >= 400; x -= 20) pts.push([x, y0 + 56 + 8 * Math.sin((1400 - x) / 150)]);
  const route = pts.map(toLngLat);

  const asked: ArtRequest[] = [];
  let r: TrackResult;
  let nodes: Kn5Node[];
  let meshes: Kn5MeshNode[];
  const dummy = (name: string) => {
    const n = nodes.find((m) => m.name === name) as Kn5GroupNode | undefined;
    if (!n) throw new Error(`no ${name}`);
    return n.transform;
  };
  /** A dummy's position as local east, north. */
  const where = (name: string): Vec2 => { const t = dummy(name); return [t[12], -t[14]]; };
  const midway = (a: string, b: string): Vec2 => { const p = where(a), q = where(b); return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; };

  beforeAll(async () => {
    r = await buildTrack(route, { name: "Hill Hairpin", imageryZoom: 0, corridor: 60, horizon: 0, trees: 0, buildings: false, widthOverride: 6.5 }, {
      dem: async (proj, bounds, zoom) => DemGrid.fromFunction(proj, zoom, bounds, height).sample,
      renderArt: artCatcher(asked),
    });
    nodes = flatten(readKn5(r.files[`${r.slug}/${r.slug}.kn5`]).root);
    meshes = nodes.filter(isMesh);
  }, 300_000);

  it("names every mesh as physics or visual, with finite geometry", () => {
    for (const m of meshes) {
      if (/^\d/.test(m.name)) expect(m.name).toMatch(/^1(ROAD|STREET|GRASS|WALL|KERB)_/);
      for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
      for (const v of m.normals) expect(Number.isFinite(v)).toBe(true);
    }
    expect(meshes.some((m) => m.name.startsWith("1ROAD_"))).toBe(true);
    expect(meshes.some((m) => m.name.startsWith("1GRASS_t"))).toBe(true);
  });

  it("has the dummies a point to point needs, and 8 pit boxes", () => {
    const names = new Set(nodes.map((n) => n.name));
    for (const n of ["AC_START_0", "AC_HOTLAP_START_0", "AC_AB_START_L", "AC_AB_START_R", "AC_AB_FINISH_L", "AC_AB_FINISH_R"]) expect(names.has(n), n).toBe(true);
    const pits = [...names].filter((n) => /^AC_PIT_\d+$/.test(n)).sort();
    expect(pits).toEqual(["AC_PIT_0", "AC_PIT_1", "AC_PIT_2", "AC_PIT_3", "AC_PIT_4", "AC_PIT_5", "AC_PIT_6", "AC_PIT_7"]);
  });

  it("puts the start and finish lines on the pins, with room to stop after the finish", () => {
    const { samples, timed } = r.plan;
    expect(timed).toBeDefined();
    const start = samples[timed!.start], finish = samples[timed!.finish];
    const s = midway("AC_AB_START_L", "AC_AB_START_R"), f = midway("AC_AB_FINISH_L", "AC_AB_FINISH_R");
    expect(Math.hypot(s[0] - start.pos[0], s[1] - start.pos[1])).toBeLessThan(1);
    expect(Math.hypot(f[0] - finish.pos[0], f[1] - finish.pos[1])).toBeLessThan(1);
    expect(r.plan.length - finish.s).toBeGreaterThanOrEqual(100);
    expect(r.stats.timedLength).toBeCloseTo(finish.s - start.s, 0);
  });

  it("spawns every car behind the start, on the asphalt, facing up the road", () => {
    const startS = r.plan.samples[r.plan.timed!.start].s;
    const grid = nodes.map((n) => n.name).filter((n) => /^AC_START_\d+$/.test(n)).sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)));
    for (const name of [grid[0], grid[grid.length - 1], "AC_PIT_0", "AC_HOTLAP_START_0"]) {
      const p = where(name), t = dummy(name);
      const smp = r.plan.samples[nearestSample(r, p)];
      expect(smp.s, name).toBeLessThan(startS);
      const across = Math.abs((p[0] - smp.pos[0]) * smp.left[0] + (p[1] - smp.pos[1]) * smp.left[1]);
      expect(across, name).toBeLessThan(smp.width / 2 - 0.5);
      // The car's +Z axis, as local east and north.
      expect(t[8] * smp.tan[0] - t[10] * smp.tan[1], name).toBeGreaterThan(0.95);
    }
  });

  it("leaves nothing from the keep-off list standing on the route", () => {
    const on = onRoute(r.plan, new SegmentIndex(r.plan));
    for (const m of meshes.filter((m) => KEEP_OFF.test(m.name))) expect(clearOfRoute(m, on).dropped, m.name).toBe(0);
  });

  it("keeps the terrain under the asphalt", () => {
    const cell = (x: number, z: number) => `${Math.round(x / 1.5)}:${Math.round(z / 1.5)}`;
    const groundTop = new Map<string, number>();
    for (const m of meshes.filter((m) => m.name.startsWith("1GRASS_t"))) {
      for (let i = 0; i < m.positions.length; i += 3) {
        const k = cell(m.positions[i], m.positions[i + 2]);
        groundTop.set(k, Math.max(groundTop.get(k) ?? -Infinity, m.positions[i + 1]));
      }
    }
    let compared = 0;
    for (const m of meshes.filter((m) => m.name.startsWith("1ROAD_"))) {
      for (let i = 0; i < m.positions.length; i += 3) {
        const g = groundTop.get(cell(m.positions[i], m.positions[i + 2]));
        if (g === undefined) continue;
        compared++;
        expect(g).toBeLessThan(m.positions[i + 1] - 0.1);
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  it("drives an AI line along the whole road, slowing for the hairpin, and hints the country limit", () => {
    const ai = readFastLaneAi(r.files[`${r.slug}/ai/fast_lane.ai`]);
    expect(ai).toHaveLength(r.plan.samples.length);
    const last = ai[ai.length - 1].distance;
    expect(last).toBeGreaterThanOrEqual(r.plan.length * 0.99);
    expect(last).toBeLessThanOrEqual(r.plan.length * 1.02);
    for (const p of ai) {
      expect(p.speed).toBeGreaterThanOrEqual(3);
      expect(p.speed).toBeLessThanOrEqual(70);
    }
    expect(Math.min(...ai.map((p) => p.speed))).toBeLessThan(25);
    const values = [...decode(r, "data/ai_hints.ini").matchAll(/^VALUE=([\d.]+)$/gm)].map((m) => Number(m[1]));
    expect(values).toContain(0.8);
    expect(values.some((v) => v < 0.8 && v > 0.15)).toBe(true);
  });

  it("follows the DEM", () => {
    const smp = r.plan.samples[Math.round(r.plan.samples.length / 3)];
    expect(Math.abs(smp.h - height(smp.pos[0], smp.pos[1]))).toBeLessThan(3);
    expect(r.stats.climb).toBeGreaterThan(10);
  });

  it("gives the road its detail-mapped materials", () => {
    const kn5 = readKn5(r.files[`${r.slug}/${r.slug}.kn5`]);
    const road = kn5.materials.filter((m) => /^road_(asphalt|chipseal)_/.test(m.name));
    expect(road.length).toBeGreaterThan(0);
    for (const m of road) {
      expect(m.shader, m.name).toBe("ksPerPixelMultiMap");
      expect(m.properties.find((q) => q.name === "useDetail")?.a, m.name).toBe(1);
    }
  });

  it("zips the kn5 whole", () => {
    const back = unzipSync(zipTrack(r.files));
    expect(back[`${r.slug}/${r.slug}.kn5`].length).toBe(r.stats.kn5Bytes);
  });

  it("writes the point-to-point extras: time trial lines, the autotest script and track-script physics", () => {
    const ch = decode(r, "data/challenges.ini");
    expect(ch).toContain("[TT_START]");
    expect(ch).toContain("[TT_FINISH]");
    expect(decode(r, "extension/autotest.lua")).toContain("local CLOSED = false");
    expect(decode(r, "data/surfaces.ini")).toMatch(/\[_SCRIPTING_PHYSICS\]\nALLOW_TRACK_SCRIPTS=1/);
  });

  it("puts START and FINISH signs on both sides of each line, off the road and up high", () => {
    const signs: [number, number, number][] = [];
    for (const m of meshes.filter((m) => m.name.startsWith("FURNITURE_SIGNART"))) {
      for (let i = 0; i < m.positions.length; i += 3) signs.push([m.positions[i], -m.positions[i + 2], m.positions[i + 1]]);
    }
    for (const k of [r.plan.timed!.start, r.plan.timed!.finish]) {
      const s = r.plan.samples[k];
      const near = signs.filter(([x, y]) => Math.hypot(x - s.pos[0], y - s.pos[1]) < 12);
      const across = near.map(([x, y]) => (x - s.pos[0]) * s.left[0] + (y - s.pos[1]) * s.left[1]);
      expect(across.some((a) => a > 0)).toBe(true);
      expect(across.some((a) => a < 0)).toBe(true);
      for (const a of across) expect(Math.abs(a)).toBeGreaterThan(s.width / 2 + 1);
      for (const [, , z] of near) expect(z - s.h).toBeGreaterThan(1.8);
    }
    expect(asked.map((a) => a.key)).toEqual(expect.arrayContaining(["gate-START", "gate-FINISH"]));
  });

  it("warns of kangaroos on a long country road with nothing built along it", () => {
    expect(asked.some((a) => a.key === "warning:kangaroo" && a.kind === "warning")).toBe(true);
  });
});

describe("a fixed map origin", () => {
  const route = Array.from({ length: 41 }, (_, i) => toLngLat([i * 20, 0]));
  const opts = { name: "Fixed Origin", imageryZoom: 0, corridor: 30, horizon: 0, trees: 0, buildings: false };
  const sources: DataSources = { dem: flatDem(15), widthAt: () => 7 };

  it("keeps points where they are when the route changes; without it the map follows the route", { timeout: 120_000 }, async () => {
    const origin = toLngLat([150, 0]) as [number, number];
    const whole = await buildTrack(route, { ...opts, origin }, sources);
    const part = await buildTrack(route.slice(0, 25), { ...opts, origin }, sources);
    expect(whole.proj.origin).toEqual(origin);
    const probe = route[8];
    expect(part.proj.toLocal(probe)).toEqual(whole.proj.toLocal(probe));
    const free = await buildTrack(route.slice(0, 25), opts, sources);
    expect(Math.abs(free.proj.toLocal(probe)[0] - whole.proj.toLocal(probe)[0])).toBeGreaterThan(10);
  });
});

describe("pins on a long road drawn with jitter", () => {
  it("still starts and finishes at the pins", { timeout: 300_000 }, async () => {
    const pts: Vec2[] = [];
    for (let x = 0, k = 0; x <= 4000; x += 5, k++) pts.push([x, 35 * Math.sin(x / 170) + (k % 2 ? 1.5 : -1.5)]);
    const route = pts.map(toLngLat);
    const r = await buildTrack(route, { name: "Jitter", imageryZoom: 0, corridor: 40, horizon: 0, trees: 0, buildings: false }, { dem: flatDem(30), widthAt: () => 7 });
    const a = r.proj.toLocal(route[0]), b = r.proj.toLocal(route[route.length - 1]);
    const start = r.plan.samples[r.plan.timed!.start].pos, finish = r.plan.samples[r.plan.timed!.finish].pos;
    expect(Math.hypot(start[0] - a[0], start[1] - a[1])).toBeLessThan(5);
    expect(Math.hypot(finish[0] - b[0], finish[1] - b[1])).toBeLessThan(5);
  });
});

describe("ground over an aerial photo", () => {
  it("gives every ground material the multilayer shader and ships its mask", { timeout: 300_000 }, async () => {
    const route = [0, 300, 600].map((x) => toLngLat([x, 0]));
    // Each chunk's photo: green on the west half, grey on the east.
    const photo = (size: number) => {
      const px = new Uint8Array(size * size * 4);
      for (let i = 0; i < size * size; i++) px.set(i % size < size / 2 ? [72, 108, 52, 255] : [92, 92, 96, 255], i * 4);
      return px;
    };
    const r = await buildTrack(route, { name: "Photo Ground", imageryZoom: 17, corridor: 60 }, {
      dem: flatDem(20),
      widthAt: () => 6,
      imagery: async (_proj, _chunk, _zoom, size) => {
        const rgba = photo(size);
        return { data: encodePng(rgba, size, size), ext: "png", rgba };
      },
    });
    const kn5 = readKn5(r.files[`${r.slug}/${r.slug}.kn5`]);
    const ground = kn5.materials.filter((m) => m.name.startsWith("terrain_") || m.name === "grass" || m.name === "verge");
    expect(ground.length).toBeGreaterThan(2);
    const shipped = new Set(kn5.textures.map((t) => t.name));
    for (const m of ground) {
      expect(m.shader, m.name).toBe("ksMultilayer");
      expect(shipped.has(m.textures.txMask), m.name).toBe(true);
    }
  });
});
