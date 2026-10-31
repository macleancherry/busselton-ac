import { describe, expect, it } from "vitest";
import { buildTrack, type DataSources } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import type { LngLat } from "../src/core/geo";

const lat0 = -33.6, lng0 = 115.4;
const mx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
const route: LngLat[] = [];
for (let x = 0; x <= 800; x += 20) route.push([lng0 + x / mx, lat0]);
const sources: DataSources = { dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, () => 10).sample, widthAt: () => 7 };
const opts = { name: "Origin", imageryZoom: 0, corridor: 30, horizon: 0, trees: 0, buildings: false };

describe("fixed map origin", () => {
  it("keeps the map where it is when the route changes", { timeout: 60_000 }, async () => {
    const origin: [number, number] = [lng0 + 0.002, lat0];
    const a = await buildTrack(route, { ...opts, origin }, sources);
    const b = await buildTrack(route.slice(0, 30), { ...opts, origin }, sources);
    expect(a.proj.origin).toEqual(origin);
    expect(b.proj.toLocal(route[5])).toEqual(a.proj.toLocal(route[5]));
    // Without it the map centres on the route, so a shorter route moves it.
    const c = await buildTrack(route.slice(0, 30), opts, sources);
    expect(Math.abs(c.proj.toLocal(route[5])[0] - a.proj.toLocal(route[5])[0])).toBeGreaterThan(10);
  });
});
