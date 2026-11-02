import { describe, expect, it } from "vitest";
import { SEA_LEVEL, SeaMask, type CoastPolygon } from "../src/core/coast";
import { extConfig, bakedShadowParams } from "../src/core/cspConfig";
import { BlendMode, DepthMode, type Kn5MeshNode } from "../src/core/kn5";
import { decodeOwnPng } from "../src/core/png";
import { BEACH_DETAIL, buildWetSand, sandTest, wetSandMaterial, wetSandTexture } from "../src/core/beachDetail";
import { buildShoreFoam, drySand, SAND_PEAK, shoreRuns, type SeaPhoto } from "../src/core/photoSea";
import { beachDetailOn } from "../src/core/stages/kit";
import { OPTIONAL_OPTION_KEYS } from "../src/core/options";

// Sea north of y = 100; an OSM beach only west of x = 0 (east of it, a grassy shore); a jetty at x = -500.
const ocean: CoastPolygon = { rings: [[[-1000, 100], [1000, 100], [1000, 3000], [-1000, 3000]]], edge: [[true, false, false, false]] };
const beach: CoastPolygon = { rings: [[[-1000, 60], [0, 60], [0, 100], [-1000, 100]]], edge: [[true, true, true, true]] };
const jetty: CoastPolygon = { rings: [[[-503, 80], [-497, 80], [-497, 400], [-503, 400]]], edge: [[true, true, true, true]] };
const sea = new SeaMask([ocean], -1100, -200, 1100, 3100);
/** The beach rising 1 m in 20 m up from the water. */
const ground = (_x: number, y: number) => SEA_LEVEL + (100 - y) * 0.05;

/** A photo, top row first: `shade(x, y)` per pixel. */
function photoOf(minX: number, minY: number, span: number, size: number, shade: (x: number, y: number) => [number, number, number]): SeaPhoto {
  const rgba = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const x = minX + ((px + 0.5) / size) * span, y = minY + span - ((py + 0.5) / size) * span;
    rgba.set([...shade(x, y), 255], (py * size + px) * 4);
  }
  return { chunk: { minX, minY, maxX: minX + span, maxY: minY + span }, rgba, size };
}

const xyz = (m: Kn5MeshNode, k: number) => [m.positions[k * 3], -m.positions[k * 3 + 2], m.positions[k * 3 + 1]];

describe("beach detail: wet sand", () => {
  const wet = buildWetSand([ocean], sea, [jetty], ground, sandTest([beach], []));

  it("lies on the sand from the water up the beach, just above the ground, facing up", () => {
    expect(wet.length).toBeGreaterThan(0);
    for (const m of wet) {
      expect(m.name).toMatch(/^SHORE_WET_\d\d$/); // visual only: no digit prefix, no physics
      expect(m.transparent).toBe(true);
      expect(m.castShadows).toBe(false);
      for (let k = 0; k < m.positions.length / 3; k++) {
        const [x, y, z] = xyz(m, k);
        expect(y).toBeGreaterThan(100 - BEACH_DETAIL.wetTo - 0.01);
        expect(y).toBeLessThan(100 - BEACH_DETAIL.wetFrom + 0.01);
        const want = (y > 100 ? SEA_LEVEL : ground(x, y)) + BEACH_DETAIL.lift;
        expect(z).toBeCloseTo(want, 5);
        expect(x).toBeLessThanOrEqual(0.01 + 2); // only along the OSM beach (one step of slack)
        if (Math.abs(x + 500) < 9) throw new Error(`wet sand at the jetty: x ${x}`);
      }
      for (let t = 0; t < m.indices.length; t += 3) {
        const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]].map((k) => xyz(m, k));
        expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeGreaterThan(0);
      }
    }
    const xs = wet.flatMap((m) => Array.from(m.positions).filter((_, i) => i % 3 === 0));
    expect(Math.min(...xs)).toBeLessThan(-990);
    expect(Math.max(...xs)).toBeGreaterThan(-10);
  });

  it("has v 0 at the water and 1 at the top of the beach", () => {
    const m = wet[0];
    for (let k = 0; k < m.positions.length / 3; k++) {
      const y = xyz(m, k)[1], v = m.uvs[k * 2 + 1];
      expect(v).toBeCloseTo((100 - BEACH_DETAIL.wetFrom - y) / (BEACH_DETAIL.wetTo - BEACH_DETAIL.wetFrom), 4);
    }
  });

  it("follows the same shore line as the foam", () => {
    const runs = shoreRuns([ocean], sea, [jetty]);
    expect(runs.length).toBe(2); // split by the jetty
    for (const r of runs) for (const q of r) expect(q.out[1]).toBeCloseTo(1); // out onto the water: north
    const foam = buildShoreFoam([ocean], sea, [jetty]);
    const foamXs = new Set(foam.flatMap((m) => Array.from(m.positions).filter((_, i) => i % 3 === 0).map((x) => x.toFixed(2))));
    for (const m of wet) for (let i = 0; i < m.positions.length; i += 3) expect(foamXs.has(m.positions[i].toFixed(2))).toBe(true);
  });

  it("finds sand from the photo where OSM has no beach", () => {
    const sandy = photoOf(0, 0, 200, 200, (_x, y) => (y < 100 ? [215, 205, 180] : [40, 150, 160]));
    const grassy = photoOf(0, 0, 200, 200, (_x, y) => (y < 100 ? [90, 130, 60] : [40, 150, 160]));
    expect(sandTest([], [sandy])([50, 100], [0, 1])).toBe(true);
    expect(sandTest([], [grassy])([50, 100], [0, 1])).toBe(false);
    expect(sandTest([beach], [])([-50, 100], [0, 1])).toBe(true);
    expect(sandTest([beach], [])([50, 100], [0, 1])).toBe(false);
    const fromPhoto = buildWetSand([ocean], sea, [], ground, sandTest([], [sandy]));
    const xs = fromPhoto.flatMap((m) => Array.from(m.positions).filter((_, i) => i % 3 === 0));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-2);
    expect(Math.max(...xs)).toBeLessThanOrEqual(202);
  });

  it("is a soft dark band fading up the beach, with no hard line on the water", () => {
    const tex = decodeOwnPng(wetSandTexture());
    const alpha = (v: number) => {
      const row = Math.min(tex.height - 1, Math.floor(v * tex.height));
      let s = 0;
      for (let x = 0; x < tex.width; x++) s += tex.rgba[(row * tex.width + x) * 4 + 3];
      return s / tex.width / 255;
    };
    const water = -BEACH_DETAIL.wetFrom / (BEACH_DETAIL.wetTo - BEACH_DETAIL.wetFrom);
    expect(alpha(0)).toBeLessThan(0.08); // out on the water
    expect(alpha(water + 0.1)).toBeGreaterThan(0.18); // just up from the waterline
    expect(alpha(water + 0.1)).toBeLessThanOrEqual(BEACH_DETAIL.alpha + 0.01);
    expect(alpha(0.99)).toBeLessThan(0.02); // the top: none
    // Darker than the dry sand, so it reads as wet.
    const i = (Math.floor((water + 0.1) * tex.height) * tex.width) * 4;
    expect(tex.rgba[i]).toBeLessThan(150);
  });

  it("is glossy, alpha-blended and writes no depth", () => {
    const m = wetSandMaterial();
    expect(m.name).toBe("shore_wet");
    expect(m.blendMode).toBe(BlendMode.AlphaBlend);
    expect(m.depthMode).toBe(DepthMode.NoWrite);
    expect(m.properties.find((p) => p.name === "ksSpecular")!.a).toBeGreaterThan(1);
    expect(m.properties.find((p) => p.name === "ksSpecularEXP")!.a).toBeGreaterThanOrEqual(100);
  });
});

describe("beach detail: dry sand", () => {
  it("brightens toward white without blowing out, keeping the photo's variation", () => {
    let prev = -1;
    for (let v = 120; v <= 255; v += 5) {
      const d = drySand([v, v, v]);
      for (const c of d) expect(c).toBeLessThanOrEqual(SAND_PEAK);
      expect(d[0]).toBeGreaterThan(prev); // brighter photo, brighter sand: no flat white
      prev = d[0];
    }
    expect(drySand([255, 255, 255])[0] - drySand([225, 225, 225])[0]).toBeGreaterThan(2);
    expect(drySand([180, 170, 150])[0]).toBeGreaterThan(215);
  });
});

describe("beach detail: the option and CSP", () => {
  const g = { ocean: [ocean] } as never;
  const ctx = (opts: Record<string, unknown>) => ({ opts }) as never;

  it("is on with photoSea unless false", () => {
    expect(OPTIONAL_OPTION_KEYS).toContain("beachDetail");
    expect(beachDetailOn(ctx({}), g)).toBe(true);
    expect(beachDetailOn(ctx({ beachDetail: false }), g)).toBe(false);
    expect(beachDetailOn(ctx({ photoSea: false }), g)).toBe(false);
    expect(beachDetailOn(ctx({}), { ocean: [] } as never)).toBe(false);
  });

  it("keeps grass out of the wet band and the strips out of the AO bake", () => {
    const ini = extConfig([], { sea: true, photoSea: true });
    const occ = ini.split("\r\n").find((l) => l.startsWith("OCCLUDING_MATERIALS = "))!;
    expect(occ).toContain("shore_wet");
    expect(occ).toContain("shore_foam");
    expect(bakedShadowParams()).toContain("material:shore_wet");
  });
});
