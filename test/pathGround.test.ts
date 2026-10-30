import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeshBuilder } from "../src/core/mesh";
import type { Kn5MeshNode } from "../src/core/kn5";
import { buildPaths, LIFT } from "../src/core/paths";
import { groundMeshHeight } from "../src/core/pathGround";
import { Area } from "../src/core/area";
import { backdropHeight, buildBackdropChunk } from "../src/core/backdrop";
import type { BuildOptions } from "../src/core/options";
import type { SegmentIndex } from "../src/core/road";
import { buildTrack, type DataSources } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import type { Kn5Node } from "../src/core/kn5";
import type { LngLat } from "../src/core/geo";

/** A terrain mesh on a 1.5 m grid from (0, 0) to (size, size), heights from `h`. */
function terrain(size: number, h: (x: number, y: number) => number, name = "1GRASS_t000"): Kn5MeshNode {
  const mb = new MeshBuilder();
  const step = 1.5, n = Math.round(size / step);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) mb.vertex([i * step, j * step, h(i * step, j * step)], 0, 0);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i;
    mb.quad(a, a + 1, a + n + 2, a + n + 1);
  }
  return mb.toKn5(name, "grass");
}

/** Height of a kn5 mesh's highest surface at local (x, y). */
const heightOf = (nodes: Kn5MeshNode[], x: number, y: number) => groundMeshHeight(nodes, [[[x, y], [x, y]]], 4, /./)(x, y);

describe("paths lie on the ground meshes", () => {
  // The terrain function says 2 m everywhere, but the mesh was cut 40 cm lower in a band
  // (as under a street's edge), and a nature strip stands 15 cm proud of it further along.
  const fn = () => 2;
  const meshH = (_x: number, y: number) => (y > 20 && y < 26 ? 1.6 : 2);
  const ground = terrain(60, meshH);
  const strip = (() => {
    const mb = new MeshBuilder();
    const a = mb.vertex([30, 0, 2.15], 0, 0), b = mb.vertex([36, 0, 2.15], 0, 0), c = mb.vertex([36, 60, 2.15], 0, 0), d = mb.vertex([30, 60, 2.15], 0, 0);
    mb.quad(a, b, c, d);
    return mb.toKn5("1GRASS_STRIP_000", "grass");
  })();
  // A shared path running north through the cut band and over the strip.
  const line = { kind: "shared" as const, pts: [[10, 2], [10, 50], [33, 50], [33, 5]] as [number, number][] };
  const laid = groundMeshHeight([ground, strip], [line.pts]);

  it("reads the highest mesh at a point", () => {
    expect(laid(10, 10)).toBeCloseTo(2, 5);
    expect(laid(10, 23)).toBeCloseTo(1.6, 5);
    expect(laid(33, 30)).toBeCloseTo(2.15, 5);
    // Off every mesh, and away from the paths it was built for.
    expect(laid(-5, 10)).toBeNull();
    expect(laid(55, 55)).toBeNull();
  });

  const nodes = buildPaths([line], (x, y) => laid(x, y) ?? fn(), () => true, () => true);
  const path = nodes.filter((n) => n.name.startsWith("1ROAD_PATH"));
  const edges = nodes.filter((n) => n.name.startsWith("PATH_EDGE"));

  it("sits a couple of centimetres proud of what is drawn, never floating or sunk", () => {
    expect(path).toHaveLength(1);
    let worstUp = -Infinity, worstDown = Infinity;
    // Sample the ribbon's triangles densely against the ground meshes.
    for (const n of path) {
      const p = n.positions, ix = n.indices;
      for (let t = 0; t < ix.length; t += 3) {
        for (const [u, v] of [[1 / 3, 1 / 3], [0.8, 0.1], [0.1, 0.8], [0.1, 0.1], [0.5, 0.45]]) {
          const w = 1 - u - v, a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
          const x = u * p[a] + v * p[b] + w * p[c], z = u * p[a + 2] + v * p[b + 2] + w * p[c + 2], h = u * p[a + 1] + v * p[b + 1] + w * p[c + 1];
          const g = heightOf([ground, strip], x, -z);
          if (g === null) continue;
          worstUp = Math.max(worstUp, h - g);
          worstDown = Math.min(worstDown, h - g);
        }
      }
    }
    // Over the steps (the cut band's edges, the strip's sides) the ribbon bridges at most a
    // half-step's rise; everywhere else it's LIFT up.
    expect(worstDown).toBeGreaterThanOrEqual(-0.005);
    expect(worstUp).toBeLessThan(0.45);
    // Mid-band and mid-strip it's on the drawn ground, not the terrain function.
    expect(heightOf(path, 10, 23)! - 1.6).toBeCloseTo(LIFT, 2);
    expect(heightOf(path, 33, 30)! - 2.15).toBeCloseTo(LIFT, 2);
    expect(heightOf(path, 10, 10)! - 2).toBeCloseTo(LIFT, 2);
  });

  it("has visual-only edges reaching down into the ground", () => {
    expect(edges.length).toBe(1);
    expect(/^\d/.test(edges[0].name)).toBe(false);
    const ys = Array.from(edges[0].positions.filter((_, i) => i % 3 === 1));
    expect(Math.min(...ys)).toBeLessThan(1.6 - 0.05);
  });

  it("splits a long network over several meshes under the vertex limit", () => {
    const many = Array.from({ length: 30 }, (_, k) => ({ kind: "foot" as const, pts: [[0, k * 4], [1200, k * 4]] as [number, number][] }));
    const out = buildPaths(many, () => 0, () => true, () => true);
    const top = out.filter((n) => n.name.startsWith("1ROAD_PATH_FOOT"));
    expect(top.length).toBeGreaterThan(1);
    for (const n of out) expect(n.positions.length / 3).toBeLessThanOrEqual(65535);
  });
});

describe("an area of several polygons is one area", () => {
  // Two boxes overlapping by 10 m: 0..200 x 0..105, and 50..150 x 95..300.
  const a = new Area([[[0, 0], [200, 0], [200, 105], [0, 105]], [[50, 95], [150, 95], [150, 300], [50, 300]]]);

  it("is as deep at the seam as the union is", () => {
    // Just past the first box's top edge, inside the second: 50 m from the second box's sides.
    expect(a.signed(100, 110)).toBeCloseTo(-50);
    // On the first box's top edge where the second box carries on: still deep.
    expect(a.signed(100, 105)).toBeCloseTo(-50);
    // Where the first box's top edge is open ground above it: the edge.
    expect(a.signed(20, 104)).toBeCloseTo(-1);
    expect(a.signed(20, 110)).toBeCloseTo(5);
    // Outside, the distance to the nearest box.
    expect(a.signed(170, 200)).toBeCloseTo(20);
  });

  it("treats a shared edge as inside", () => {
    const b = new Area([[[0, 0], [100, 0], [100, 100], [0, 100]], [[100, 0], [200, 0], [200, 100], [100, 100]]]);
    expect(b.signed(100, 50)).toBeCloseTo(-50);
    expect(b.signed(95, 50)).toBeCloseTo(-50);
    expect(b.signed(100, 5)).toBeCloseTo(-5);
  });
});

describe("the horizon stays under the detailed terrain", () => {
  const opts = { corridor: 60 } as BuildOptions;
  const index = {} as SegmentIndex;
  // The far DEM reads 4 m high over ground that is really at 2 m.
  const farDem = () => 6;
  const detail = () => 2;

  it("keeps SINK under the detailed ground inside the corridor, and meets the far DEM further out", () => {
    const cover = (x: number) => x; // metres from the middle of what's built
    expect(backdropHeight(farDem, index, opts, 10, 0, cover, detail)).toBeCloseTo(-1);
    expect(backdropHeight(farDem, index, opts, 60, 0, cover, detail)).toBeCloseTo(-1);
    // 1 in 10 past the corridor.
    expect(backdropHeight(farDem, index, opts, 80, 0, cover, detail)).toBeCloseTo(1);
    // Far out, the far DEM as before.
    expect(backdropHeight(farDem, index, opts, 500, 0, cover, detail)).toBeCloseTo(6);
    // Without the detailed ground: the old fixed sink.
    expect(backdropHeight(farDem, index, opts, 10, 0, cover)).toBeCloseTo(3);
  });

  it("builds no backdrop vertex above the detailed terrain where the two overlap", () => {
    const cover = (x: number) => x - 500;
    const mesh = buildBackdropChunk({ key: "b000", minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, farDem, index, opts, false, cover, detail)!;
    const p = mesh.positions;
    for (let k = 0; k < p.length; k += 3) {
      if (cover(p[k]) <= opts.corridor) expect(p[k + 1]).toBeLessThanOrEqual(detail() - 1);
    }
  });
});

describe("path_ground.py", () => {
  it("flags a floating and a sunk path, and passes one on the ground", () => {
    const quad = (name: string, x0: number, x1: number, h0: number, h1 = h0) => ({
      name,
      p: [x0, h0, 0, x1, h1, 0, x1, h1, 10, x0, h0, 10],
      i: [0, 1, 2, 0, 2, 3],
    });
    const dir = mkdtempSync(join(tmpdir(), "pathground-"));
    const run = (meshes: unknown[]) => {
      const f = join(dir, "s.json");
      writeFileSync(f, JSON.stringify({ meshes, ai: [], layouts: {} }));
      return spawnSync("python3", ["-I", "scripts/check/path_ground.py", f], { encoding: "utf8" });
    };
    const ground = quad("1GRASS_t000", 0, 30, 2);
    const ok = run([ground, quad("1ROAD_PATH_SHARED", 5, 8, 2.03)]);
    expect(ok.status).toBe(0);
    const high = run([ground, quad("1ROAD_PATH_SHARED", 5, 8, 2.3)]);
    expect(high.status).toBe(1);
    expect(high.stdout).toMatch(/above x \d+ z \d+: \+30\.0 cm/);
    const low = run([ground, quad("1STREET_PATH_000", 5, 8, 1.8)]);
    expect(low.status).toBe(1);
    expect(low.stdout).toMatch(/below/);
  });
});

describe("in a build", () => {
  it("lays the paths on the built ground and keeps the horizon under it", { timeout: 60_000 }, async () => {
    const lat0 = -33.6, lng0 = 115.4;
    const mx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
    const ll = (x: number, y: number): LngLat => [lng0 + x / mx, lat0 + y / 111_320];
    const route: LngLat[] = [];
    for (let x = 0; x <= 600; x += 20) route.push(ll(x, 0));
    // Gentle swell the far (coarse) DEM over-reads by 4 m.
    const h = (x: number, y: number) => 10 + Math.sin(x / 37) * 0.5 + Math.cos(y / 29) * 0.4;
    const sources: DataSources = {
      dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, (x, y) => h(x, y) + (z <= 12 ? 4 : 0)).sample,
      widthAt: () => 7,
      paths: [{ kind: "shared", pts: [ll(50, 15), ll(550, 18)] }, { kind: "foot", pts: [ll(100, -14), ll(500, -20)] }],
    };
    const built = await buildTrack(route, { name: "Paths", imageryZoom: 0, corridor: 40, horizon: 400, trees: 0, buildings: false, raceDress: false, origin: ll(300, 0) as [number, number] }, sources);
    const all: Kn5MeshNode[] = [];
    const walk = (n: Kn5Node) => (n.kind === "mesh" ? all.push(n) : n.children.forEach(walk));
    walk(built.model.root);
    const paths = all.filter((n) => n.name.startsWith("1ROAD_PATH"));
    expect(paths.length).toBeGreaterThan(0);
    expect(all.some((n) => n.name.startsWith("PATH_EDGE"))).toBe(true);
    const grounds = all.filter((n) => /^1GRASS/.test(n.name));
    const lines = paths.map((n) => { const out: [number, number][] = []; for (let k = 0; k < n.positions.length; k += 3) out.push([n.positions[k], -n.positions[k + 2]]); return out; });
    const g = groundMeshHeight(grounds, lines);
    let n = 0;
    for (const m of paths) {
      for (let k = 0; k < m.positions.length; k += 3) {
        const at = g(m.positions[k], -m.positions[k + 2]);
        if (at === null) continue;
        n++;
        const d = m.positions[k + 1] - at;
        expect(d).toBeGreaterThan(0);
        expect(d).toBeLessThan(0.1);
      }
    }
    expect(n).toBeGreaterThan(100);
    // Nowhere does the horizon come up through the detailed terrain.
    const terrainH = groundMeshHeight(all.filter((m) => m.name.startsWith("1GRASS_t")), [[[-100, 0], [700, 0]]], 60, /./);
    for (const b of all.filter((m) => m.name.startsWith("BACKDROP"))) {
      for (let k = 0; k < b.positions.length; k += 3) {
        const t = terrainH(b.positions[k], -b.positions[k + 2]);
        if (t !== null) expect(b.positions[k + 1]).toBeLessThan(t);
      }
    }
  });
});
