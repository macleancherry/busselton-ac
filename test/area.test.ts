import { describe, expect, it } from "vitest";
import { Area } from "../src/core/area";
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
const opts = { name: "Area", imageryZoom: 0, corridor: 30, horizon: 0, trees: 0, buildings: false, raceDress: false, origin: ll(300, 0) as [number, number] };
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
});
