import { describe, expect, it } from "vitest";
import { fillLevels, findHollows, rasterSurface, surfaceMeshes, trackHollows, type SurfaceMesh } from "../src/core/rainHollows";
import { extConfig, RELIEF_MATERIALS } from "../src/core/cspConfig";
import type { Kn5GroupNode, Kn5MeshNode } from "../src/core/kn5";
import { IDENTITY } from "../src/core/kn5";

/** A grid mesh over x 0..len, z 0..wid (AC space) at 0.5 m, heights from `y(x, z)`. */
function sheet(name: string, x0: number, x1: number, z0: number, z1: number, y: (x: number, z: number) => number, step = 0.5): SurfaceMesh {
  const nx = Math.round((x1 - x0) / step), nz = Math.round((z1 - z0) / step);
  const positions: number[] = [], indices: number[] = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      positions.push(x, y(x, z), z);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { name, positions, indices };
}

/** A street 100 m long and 8 m wide, with a sag of `sag` metres in the middle (a smooth dip 30 m long). */
const sagRoad = (sag: number) => (x: number) => 2 + 0.002 * x - sag * Math.max(0, Math.cos(((x - 50) / 30) * Math.PI)) * (Math.abs(x - 50) < 15 ? 1 : 0);
/** Kerbs 15 cm high along both edges (z 0..0.3 and 7.7..8). */
const kerbs = (y: (x: number) => number) => [
  sheet("1KERB_A", 0, 100, -0.5, 0, (x) => y(x) + 0.15),
  sheet("1KERB_B", 0, 100, 8, 8.5, (x) => y(x) + 0.15),
];

describe("rain hollows", () => {
  it("finds water standing in a kerbed street's sag, and nowhere else", () => {
    const y = sagRoad(0.1);
    const g = rasterSurface([sheet("1STREET_000", 0, 100, 0, 8, y), ...kerbs(y)])!;
    const hollows = findHollows(g);
    expect(hollows).toHaveLength(1);
    const h = hollows[0];
    // Lowest point mid-sag; 10 cm less the 0.2% grade it spills over on the low side (7 cm).
    expect(h.low[0]).toBeGreaterThan(47);
    expect(h.low[0]).toBeLessThan(53);
    expect(h.depth).toBeCloseTo(0.07, 2);
    expect(h.depth).toBeLessThanOrEqual(0.15 + 1e-6);
    expect(h.area).toBeGreaterThan(50);
    expect(h.centre[1]).toBeCloseTo(h.low[1] + h.depth, 5);
  });

  it("lets water run off a road with no kerb", () => {
    const y = sagRoad(0.1);
    const g = rasterSurface([sheet("1STREET_000", 0, 100, 0, 8, y)])!;
    expect(findHollows(g)).toHaveLength(0);
  });

  it("lets water out through a gap in the kerb (a driveway)", () => {
    const y = sagRoad(0.1);
    const gap = (x0: number, x1: number) => sheet("1KERB_A", x0, x1, -0.5, 0, (x) => y(x) + 0.15);
    const g = rasterSurface([sheet("1STREET_000", 0, 100, 0, 8, y), gap(0, 48), gap(52, 100), kerbs(y)[1]])!;
    expect(findHollows(g)).toHaveLength(0);
  });

  it("caps a deep basin at the drain depth and ignores shallow ones", () => {
    const deep = sagRoad(0.5);
    const hDeep = findHollows(rasterSurface([sheet("1ROAD_000", 0, 100, 0, 8, deep), ...kerbs(deep)])!, { maxDepth: 0.15 });
    expect(hDeep[0].depth).toBeCloseTo(0.15, 2);
    const shallow = sagRoad(0.01);
    expect(findHollows(rasterSurface([sheet("1ROAD_000", 0, 100, 0, 8, shallow), ...kerbs(shallow)])!)).toHaveLength(0);
  });

  it("holds water behind a thin kerb strip narrower than a grid cell", () => {
    const y = sagRoad(0.1);
    const thin = [sheet("1KERB_A", 0, 100, -0.15, 0, (x) => y(x) + 0.15, 0.15), sheet("1KERB_B", 0, 100, 8, 8.15, (x) => y(x) + 0.15, 0.15)];
    expect(findHollows(rasterSurface([sheet("1STREET_000", 0, 100, 0, 8, y), ...thin])!)).toHaveLength(1);
  });

  it("doesn't put a puddle on a footpath", () => {
    const y = sagRoad(0.1);
    const g = rasterSurface([sheet("1STREET_PATH_000", 0, 100, 0, 8, y), ...kerbs(y)])!;
    // The water is there (the flood fill sees it) but no puddle is reported on a path.
    const level = fillLevels(g);
    expect([...level].some((v, k) => v - g.y[k] > 0.05)).toBe(true);
    expect(findHollows(g)).toHaveLength(0);
  });

  it("reads the drivable meshes out of a kn5 tree", () => {
    const mesh = (m: SurfaceMesh): Kn5MeshNode => ({
      kind: "mesh", name: m.name, positions: new Float32Array(m.positions), normals: new Float32Array(m.positions.length),
      uvs: new Float32Array((m.positions.length / 3) * 2), indices: new Uint16Array(m.indices), material: "road_0",
    });
    const y = sagRoad(0.1);
    const root: Kn5GroupNode = { kind: "node", name: "t", transform: IDENTITY, children: [
      { kind: "node", name: "ROAD", transform: IDENTITY, children: [mesh(sheet("1ROAD_000", 0, 100, 0, 8, y, 1)), ...kerbs(y).map((k) => mesh(k))] },
      // A wall and visual meshes don't count.
      mesh(sheet("1WALL_000", 40, 60, 2, 6, () => 9, 1)),
      mesh(sheet("HOUSE_000", 40, 60, 2, 6, () => 9, 1)),
    ] };
    expect(surfaceMeshes(root).map((m) => m.name)).toEqual(["1ROAD_000", "1KERB_A", "1KERB_B"]);
    expect(trackHollows(root)).toHaveLength(1);
  });
});

describe("rain hollows in the CSP config", () => {
  const hollow = { low: [50, 1.9, 4] as [number, number, number], centre: [50, 2, 4] as [number, number, number], depth: 0.1, area: 120, volume: 5, radius: 12 };

  it("builds the puddle height map from the ground only and lists the hollows in [RAIN_FX]", () => {
    const ini = extConfig([], { hollows: [hollow] });
    const rain = ini.split("[RAIN_FX]")[1].split(/\r\n\[/)[0];
    expect(rain).toContain(`RELIEF_MATERIALS = ${RELIEF_MATERIALS}`);
    expect(rain).toContain("; hollow 1: 50.00, 1.90, 4.00  10 cm, 120 m2, 24 m across");
    // No buildings, trees or walls in the relief.
    expect(RELIEF_MATERIALS).not.toMatch(/wall|roof|trees|window|fence/);
    const heads = ini.match(/^\[[^\]]+\]/gm)!;
    expect(new Set(heads).size).toBe(heads.length);
  });

  it("leaves the relief alone when the option is off", () => {
    expect(extConfig([])).not.toContain("RELIEF_MATERIALS");
  });
});
