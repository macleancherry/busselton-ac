import { describe, expect, it } from "vitest";
import { buildTrack, type DataSources } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import type { Kn5Node } from "../src/core/kn5";
import type { LngLat } from "../src/core/geo";

// An area build: the route along y = 0, a street north from it at x = 300 (a T on the route) to a
// roundabout at y = 150 on a cross street. The route's own road is a street line too, as in a real
// build (OSM's ways, sharing the junction's node).
const lat0 = -33.6, lng0 = 115.4;
const mx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
const ll = (x: number, y: number): LngLat => [lng0 + x / mx, lat0 + y / 111_320];
const route: LngLat[] = [];
for (let x = 0; x <= 600; x += 20) route.push(ll(x, 0));
const R = 14;
const ring: LngLat[] = Array.from({ length: 25 }, (_, i) => ll(300 + R * Math.cos((i / 24) * 2 * Math.PI), 150 + R * Math.sin((i / 24) * 2 * Math.PI)));
ring[24] = ring[0];
const sources: DataSources = {
  dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, (x, y) => 10 + 0.004 * x + 0.003 * y).sample,
  widthAt: () => 7,
  streets: {
    lines: [
      { pts: [ll(0, 0), ll(300, 0), ll(600, 0)], cls: "primary" },
      { pts: [ll(300, 0), ll(300, 150 - R)], cls: "minor" },
      { pts: [ll(50, 150), ll(300 - R, 150)], cls: "minor" },
      { pts: [ll(300 + R, 150), ll(550, 150)], cls: "minor" },
    ],
    names: [],
  },
  osm: { buildings: [], guardRails: [], roundaboutRings: [{ pts: ring }], poles: [], lamps: [], powerLines: [], barriers: [], groynes: [] },
};
const opts = { name: "Net Core", imageryZoom: 0, corridor: 30, horizon: 0, trees: 0, buildings: false, raceDress: false, origin: ll(300, 0) as [number, number], area: [ll(-20, -40), ll(620, -40), ll(620, 200), ll(-20, 200)] as [number, number][] };
const names = (n: Kn5Node): string[] => (n.kind === "mesh" ? [n.name] : n.children.flatMap(names));

describe("networkCore in an area build", () => {
  it("builds the T-junction and the roundabout as junction surfaces in place of the old pieces", { timeout: 120_000 }, async () => {
    const old = await buildTrack(route, opts, sources);
    const oldNames = names(old.model.root);
    expect(oldNames).toContain("1ROAD_RB0");

    const built = await buildTrack(route, { ...opts, networkCore: true }, sources);
    const all = names(built.model.root);
    const json = Object.entries(built.files).find(([k]) => k.endsWith("network/junctions.json"));
    expect(json).toBeTruthy();
    const info = JSON.parse(new TextDecoder().decode(json![1] as Uint8Array));
    expect(info.failures).toEqual([]);
    const kinds = info.junctions.map((j: { kind: string; onRoute: boolean }) => `${j.kind}${j.onRoute ? "+route" : ""}`).sort();
    expect(kinds).toEqual(["junction+route", "roundabout"]);
    // The ring and its connectors are gone; the junctions' surfaces are there under the checks' names.
    expect(all).not.toContain("1ROAD_RB0");
    expect(all.some((n) => n.startsWith("1ROAD_RBC"))).toBe(false);
    expect(all.some((n) => /^1ROAD_J\d+$/.test(n))).toBe(true);
    expect(all.some((n) => /^1STREET_J\d+$/.test(n))).toBe(true);
    expect(all.some((n) => /^1GRASS_ISLAND_J\d+$/.test(n))).toBe(true);
    // The route is cut back to the junction's caps: some of its rows are covered.
    expect(built.plan.samples.some((s) => s.crown === 0)).toBe(true);
  });
});
