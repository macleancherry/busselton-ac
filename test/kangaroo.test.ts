import { describe, expect, it } from "vitest";
import { buildTrack, type DataSources } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import type { LngLat } from "../src/core/geo";
import { encodePng } from "../src/core/png";
import type { ArtRequest } from "../src/core/art";

// A 2.5 km country road with nothing built along it.
const lat0 = -33.6, lng0 = 115.4;
const mx = 111_320 * Math.cos((lat0 * Math.PI) / 180), my = 111_320;
const route: LngLat[] = [];
for (let x = 0; x <= 2500; x += 20) route.push([lng0 + x / mx, lat0 + (Math.sin(x / 300) * 40) / my]);

describe("kangaroo signs", async () => {
  const asked: ArtRequest[] = [];
  const sources: DataSources = {
    dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, () => 20).sample,
    widthAt: () => 7,
    renderArt: async (items) => {
      asked.push(...items);
      return {
        data: encodePng(new Uint8Array(4 * 4 * 4), 4, 4, { alpha: true }),
        cells: Object.fromEntries(items.map((r) => [r.key, { u0: 0, v0: 0, u1: 1, v1: 1, aspect: 1 }])),
      };
    },
  };
  await buildTrack(route, { name: "Roos", imageryZoom: 0, corridor: 40, horizon: 0, trees: 0, buildings: false, raceDress: false }, sources);

  it("puts kangaroo warning signs on a country road", () => {
    expect(asked.some((r) => r.key === "warning:kangaroo" && r.kind === "warning")).toBe(true);
  });
});
