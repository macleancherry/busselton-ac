import { describe, expect, it } from "vitest";
import { buildTrack, trackObjects, type DataSources } from "../src/core/track";
import { layoutFiles, snapToLines, surfaceHeight } from "../src/core/layouts";
import { DemGrid } from "../src/core/elevation";
import { readKn5 } from "../src/core/kn5";
import type { LngLat } from "../src/core/geo";

const lat0 = -33.6, lng0 = 115.4;
const mx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
const ll = (x: number, y: number): LngLat => [lng0 + x / mx, lat0 + y / 111_320];
const route: LngLat[] = [];
for (let x = 0; x <= 800; x += 20) route.push(ll(x, 0));
const sources: DataSources = { dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, () => 10).sample, widthAt: () => 7 };
const opts = { name: "Layouts", imageryZoom: 0, corridor: 30, horizon: 0, trees: 0, buildings: false, raceDress: false, origin: ll(400, 0) as [number, number] };

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
  });

  it("pulls a route onto the built street, but not round a roundabout or far away", () => {
    const street: [number, number][] = [[0, 0], [100, 0]];
    const out = snapToLines([[10, 5], [50, -3], [90, 30]], [street], [{ c: [50, 0], rOut: 1 }]);
    expect(out[0]).toEqual([10, 0]);
    expect(out[1]).toEqual([50, -3]); // beside the ring
    expect(out[2]).toEqual([90, 30]); // too far
  });
});
