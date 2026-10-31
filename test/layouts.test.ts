import { describe, expect, it } from "vitest";
import { buildTrack, trackObjects, type DataSources } from "../src/core/track";
import { floodPits, layoutFiles, snapToLines, surfaceHeight } from "../src/core/layouts";
import { readFastLaneAi, type AiPoint } from "../src/core/aiSpline";
import { DemGrid } from "../src/core/elevation";
import { readKn5 } from "../src/core/kn5";
import type { LngLat } from "../src/core/geo";

const lat0 = -33.6, lng0 = 115.4;
const mx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
const ll = (x: number, y: number): LngLat => [lng0 + x / mx, lat0 + y / 111_320];
const route: LngLat[] = [];
for (let x = 0; x <= 800; x += 20) route.push(ll(x, 0));
const sources: DataSources = { dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, () => 10).sample, widthAt: () => 7 };
const opts = { name: "Layouts", imageryZoom: 0, corridor: 30, horizon: 0, trees: 0, buildings: false, origin: ll(400, 0) as [number, number] };

const dummyNames = (kn5: Uint8Array) => readKn5(kn5).root.children.map((c) => c.name);

describe("layouts", () => {
  it("puts the main route's files in its layout and its dummies in their own kn5", { timeout: 60_000 }, async () => {
    const r = await buildTrack(route, { ...opts, layout: "sprint" }, sources);
    const keys = Object.keys(r.files);
    const slug = r.slug;
    expect(keys).toContain(`${slug}/sprint/ai/fast_lane.ai`);
    expect(keys).toContain(`${slug}/sprint/data/surfaces.ini`);
    expect(keys).toContain(`${slug}/sprint/map.png`);
    expect(keys).toContain(`${slug}/ui/sprint/ui_track.json`);
    expect(keys).toContain(`${slug}/models_sprint.ini`);
    expect(keys).not.toContain(`${slug}/ai/fast_lane.ai`);
    // No dummies in the shared world; they're in the layout's kn5.
    const world = JSON.stringify(readKn5(r.files[`${slug}/${slug}.kn5`]).root, (k, v) => (k === "positions" || k === "normals" || k === "uvs" || k === "indices" || k === "tangents" ? undefined : v));
    expect(world).not.toMatch(/AC_START_0/);
    expect(dummyNames(r.files[`${slug}/layout_sprint.kn5`])).toContain("AC_START_0");

    // A second layout over part of the same road, and a free roam with two spawns.
    const world2 = { slug, proj: r.proj, model: r.model, options: opts, meta: {}, mainAi: r.files[`${slug}/sprint/ai/fast_lane.ai`] };
    const height = surfaceHeight(r.model);
    const [x, y] = r.proj.toLocal(ll(300, 0));
    expect(height(x, y)).not.toBeNull();
    expect(height(x, y)!).toBeGreaterThan(9);
    expect(height(x, y)!).toBeLessThan(11);
    const short = layoutFiles(world2, { id: "short", name: "Short", coords: route.slice(5, 30) }, trackObjects);
    expect(Object.keys(short)).toEqual(expect.arrayContaining([`${slug}/short/ai/fast_lane.ai`, `${slug}/layout_short.kn5`, `${slug}/ui/short/ui_track.json`, `${slug}/models_short.ini`]));
    const start = readKn5(short[`${slug}/layout_short.kn5`]).root.children.find((c) => c.name === "AC_START_0")!;
    const t = (start as { transform: number[] }).transform;
    // On the road: the world's road height there, plus the spawn lift.
    const [sx, sy] = [t[12], -t[14]];
    expect(t[13] - height(sx, sy)!).toBeCloseTo(0.5, 1);

    const roam = layoutFiles(world2, { id: "roam", name: "Free Roam", spawns: [{ at: ll(200, 0), heading: 90 }, { at: ll(600, 0), heading: 270 }] }, trackObjects);
    expect(dummyNames(roam[`${slug}/layout_roam.kn5`])).toEqual(expect.arrayContaining(["AC_START_0", "AC_PIT_1", "AC_TIME_0_L"]));
    expect(roam[`${slug}/roam/ai/fast_lane.ai`]).toBe(world2.mainAi);
    // AI Flood: more pit boxes on the AI line, as many as ui_track.json says, each on the road.
    const roamNames = dummyNames(roam[`${slug}/layout_roam.kn5`]);
    const pits = roamNames.filter((n) => n.startsWith("AC_PIT_"));
    expect(pits.length).toBeGreaterThan(10);
    expect(roamNames.filter((n) => n.startsWith("AC_START_")).length).toBe(pits.length);
    const ui = JSON.parse(new TextDecoder().decode(roam[`${slug}/ui/roam/ui_track.json`]));
    expect(Number(ui.pitboxes)).toBe(pits.length);
    expect(Number(ui.length)).toBeGreaterThan(700);
    for (const c of readKn5(roam[`${slug}/layout_roam.kn5`]).root.children.filter((c) => c.name.startsWith("AC_PIT_"))) {
      const m = (c as { transform: number[] }).transform;
      expect(height(m[12], -m[14])).not.toBeNull();
    }

    // Free roam with its own AI loop (pins): its own line and speed hints.
    const own = layoutFiles({ ...world2, mainHints: undefined }, { id: "own", name: "Own", coords: route.slice(2, 38), spawns: [{ at: ll(200, 0), heading: 90 }], aiPits: 6 }, trackObjects);
    expect(own[`${slug}/own/ai/fast_lane.ai`]).not.toBe(world2.mainAi);
    expect(readFastLaneAi(own[`${slug}/own/ai/fast_lane.ai`]).length).toBeGreaterThan(10);
    expect(Object.keys(own)).toContain(`${slug}/own/data/ai_hints.ini`);
    expect(dummyNames(own[`${slug}/layout_own.kn5`]).filter((n) => n.startsWith("AC_PIT_")).length).toBeLessThanOrEqual(6);
  });

  it("spreads AI Flood pit boxes round the line, off tight corners and clear of the spawns", () => {
    // A 1 km straight, with a tight stretch (radius 30 m) from 400 to 500 m.
    const ai = Array.from({ length: 500 }, (_, i): AiPoint => ({
      position: [i * 2, 0, 0], distance: i * 2, speed: 14, gas: 0, brake: 0, radius: i >= 200 && i < 250 ? 30 : 1000,
      sideLeft: 3, sideRight: 3, camber: 0, direction: 1, normal: [0, 1, 0], length: 2, forward: [1, 0, 0], grade: 0,
    }));
    const pits = floodPits(ai, 10, [[150, 0]]);
    expect(pits.length).toBeGreaterThanOrEqual(8);
    for (const p of pits) {
      expect(p.pos[0] < 400 || p.pos[0] >= 500).toBe(true);
      expect(Math.abs(p.pos[0] - 150)).toBeGreaterThanOrEqual(25);
      expect(p.fwd).toEqual([1, 0, 0]);
    }
    for (let i = 1; i < pits.length; i++) expect(pits[i].pos[0] - pits[i - 1].pos[0]).toBeGreaterThanOrEqual(25);
    expect(floodPits(ai, 0)).toEqual([]);
  });

  it("pulls a route onto the built street, but not round a roundabout or far away", () => {
    const street: [number, number][] = [[0, 0], [100, 0]];
    const out = snapToLines([[10, 5], [50, -3], [90, 30]], [street], [{ c: [50, 0], rOut: 1 }]);
    expect(out[0]).toEqual([10, 0]);
    expect(out[1]).toEqual([50, -3]); // beside the ring
    expect(out[2]).toEqual([90, 30]); // too far
  });
});
