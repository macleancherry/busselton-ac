import { describe, expect, it } from "vitest";
import { Area, areaRings } from "../src/core/area";
import { buildTrack, type DataSources } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import type { LngLat } from "../src/core/geo";

const lat0 = -33.6, lng0 = 115.4;
const mx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
const ll = (x: number, y: number): LngLat => [lng0 + x / mx, lat0 + y / 111_320];
const route: LngLat[] = [];
for (let x = 0; x <= 600; x += 20) route.push(ll(x, 0));
// A street 150 m from the route: well outside a 30 m corridor.
const far = { pts: [ll(50, 150), ll(550, 150)], cls: "minor" };
const sources: DataSources = {
  dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, () => 10).sample,
  widthAt: () => 7,
  streets: { lines: [far], names: [] },
};
const opts = { name: "Area", imageryZoom: 0, corridor: 30, horizon: 0, trees: 0, buildings: false, origin: ll(300, 0) as [number, number] };
const surfaces = (r: Awaited<ReturnType<typeof buildTrack>>) =>
  new TextDecoder().decode(Object.entries(r.files).find(([k]) => k.endsWith("data/surfaces.ini"))![1] as Uint8Array);

describe("area builds", () => {
  it("signed distance: negative inside, positive outside", () => {
    const a = new Area([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(a.signed(5, 5)).toBeCloseTo(-5);
    expect(a.signed(12, 5)).toBeCloseTo(2);
    expect(a.inside(1, 1)).toBe(true);
    expect(a.inside(-1, 1)).toBe(false);
  });

  it("an area can be several polygons", () => {
    const a = new Area([[[0, 0], [10, 0], [10, 10], [0, 10]], [[100, 0], [130, 0], [130, 30], [100, 30]]]);
    expect(a.inside(5, 5)).toBe(true);
    expect(a.inside(115, 15)).toBe(true);
    expect(a.inside(50, 5)).toBe(false);
    expect(a.signed(115, 15)).toBeCloseTo(-15);
    expect(a.signed(50, 5)).toBeCloseTo(40);
    expect(areaRings([[1, 2], [3, 4], [5, 6]] as [number, number][])).toHaveLength(1);
    expect(areaRings([[[1, 2], [3, 4], [5, 6]], [[1, 2], [3, 4], [5, 6]]] as [number, number][][])).toHaveLength(2);
  });

  it("builds every street inside the polygon, not just the corridor", { timeout: 60_000 }, async () => {
    const plain = await buildTrack(route, opts, sources);
    expect(plain.stats.sideStreets).toBe(0);
    expect(surfaces(plain)).toMatch(/KEY=STREET[\s\S]*?IS_VALID_TRACK=0/);

    const area: [number, number][] = [ll(-20, -40), ll(620, -40), ll(620, 200), ll(-20, 200)];
    const built = await buildTrack(route, { ...opts, area }, sources);
    expect(built.stats.sideStreets).toBeGreaterThan(0);
    // Ground under the far street: the terrain reaches it.
    const terrainNear = (node: any, x: number, z: number): boolean => {
      if (node.children) return node.children.some((c: any) => terrainNear(c, x, z));
      if (!/GRASS|TERRAIN|GROUND/i.test(node.name ?? "") || !node.positions) return false;
      const v = node.positions as Float32Array;
      for (let i = 0; i < v.length; i += 3) if (Math.abs(v[i] - x) < 5 && Math.abs(v[i + 2] - z) < 5) return true;
      return false;
    };
    const [sx, sy] = built.proj.toLocal(ll(300, 150));
    expect(terrainNear(built.model.root, sx, -sy)).toBe(true);
    expect(terrainNear(plain.model.root, sx, -sy)).toBe(false);
    expect(surfaces(built)).toMatch(/KEY=STREET[\s\S]*?IS_VALID_TRACK=1/);
  });

  it("builds an area's roundabouts away from the route as rings", { timeout: 60_000 }, async () => {
    // A 14 m ring on the far street at x = 300.
    const ring: LngLat[] = Array.from({ length: 25 }, (_, i) => ll(300 + 14 * Math.cos((i / 24) * 2 * Math.PI), 150 + 14 * Math.sin((i / 24) * 2 * Math.PI)));
    const withRing: DataSources = {
      ...sources,
      osm: { buildings: [], guardRails: [], roundaboutRings: [{ pts: ring }], poles: [], lamps: [], powerLines: [], barriers: [], groynes: [] },
    };
    const area: [number, number][] = [ll(-20, -40), ll(620, -40), ll(620, 200), ll(-20, 200)];
    const built = await buildTrack(route, { ...opts, area, traffic: true }, withRing);
    expect(built.plan.roundabouts).toHaveLength(1);
    const rb = built.plan.roundabouts[0];
    const [cx, cy] = built.proj.toLocal(ll(300, 150));
    expect(Math.hypot(rb.c[0] - cx, rb.c[1] - cy)).toBeLessThan(1);
    expect(rb.r).toBeCloseTo(14, 0);
    // The street is cut at the ring, so both halves end beside it, and the ring has openings for them.
    expect(built.stats.sideStreets).toBeGreaterThanOrEqual(2);
    expect(rb.openings?.length ?? 0).toBeGreaterThanOrEqual(2);
    // And the street runs right up to the ring's edge.
    const ends = built.trafficInput!.roads.flatMap((r) => [r.pts[0], r.pts[r.pts.length - 1]]);
    const edge = rb.r + rb.w / 2;
    expect(ends.filter((p) => Math.abs(Math.hypot(p[0] - rb.c[0], p[1] - rb.c[1]) - edge) < 1.5).length).toBeGreaterThanOrEqual(2);
    // Without the area it's not built.
    const plain = await buildTrack(route, opts, withRing);
    expect(plain.plan.roundabouts).toHaveLength(0);
  });
});
