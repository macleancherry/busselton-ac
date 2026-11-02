// Augusta (Cape Leeuwin) on the hill: a building the terrain mesh only just reaches, a door across the
// mesh's edge, and a footpath past the nature strip on the drawn terrain grid.
import { describe, expect, it } from "vitest";
import { buildBuildings, plainHouse, type Building } from "../src/core/buildings";
import { ROOF_COLOURS } from "../src/core/buildingStyles";
import { checkGround } from "../src/core/groundCheck";
import { alongRing, groundOver, ringOverMesh, ringTouches, topSurface } from "../src/core/sceneGround";
import { MeshBuilder } from "../src/core/mesh";
import type { Kn5MeshNode, Kn5Node } from "../src/core/kn5";
import type { Vec2 } from "../src/core/geo";
import { withDefaults } from "../src/core/options";
import { buildTerrainChunk, meshDrawn, meshTop } from "../src/core/terrain";

const group = (name: string, children: Kn5Node[]): Kn5Node => ({ kind: "node", name, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children });
const tri = (name: string, pts: Vec2[], h: (x: number, y: number) => number): Kn5MeshNode => {
  const mb = new MeshBuilder();
  const [a, b, c] = pts.map((p) => mb.vertex([p[0], p[1], h(p[0], p[1])], 0, 0));
  mb.tri(a, b, c);
  return mb.toKn5(name, "grass");
};
/** A ground mesh over x0..x1, y0..y1 in 1 m squares, height h(x, y). */
function ground(name: string, x0: number, y0: number, x1: number, y1: number, h: (x: number, y: number) => number): Kn5MeshNode {
  const mb = new MeshBuilder();
  for (let x = x0; x < x1; x += 1) {
    for (let y = y0; y < y1; y += 1) {
      const xa = Math.min(x + 1, x1), ya = Math.min(y + 1, y1);
      const a = mb.vertex([x, y, h(x, y)], 0, 0), b = mb.vertex([xa, y, h(xa, y)], 1, 0), c = mb.vertex([xa, ya, h(xa, ya)], 1, 1), d = mb.vertex([x, ya, h(x, ya)], 0, 1);
      mb.quad(a, b, c, d);
    }
  }
  return mb.toKn5(name, "grass");
}
const house = (ring: Vec2[]): Building => ({
  ...plainHouse("hip", ROOF_COLOURS.findIndex((r) => r.name === "surfmist"), 3), ring, source: "osm", front: [ring[0], ring[1]],
});

describe("a footprint the terrain mesh only just reaches", () => {
  // A terrain triangle's tip pokes 40 cm into the house's east wall (x = 10) between y 5.06 and 5.44:
  // between the wall's half-metre samples at 5.0 and 5.5.
  const level = () => 100;
  const tip = tri("1GRASS_t000", [[9.6, 5.25], [20, 0.25], [20, 10.25]], level);
  const mesh = topSurface([tip]);
  const scene = groundOver(mesh, () => 99.5);
  const horizon = () => 99.6;
  const ring: Vec2[] = [[0, 0], [10, 0], [10, 10], [0, 10]];

  it("finds the tip, which half-metre samples missed", () => {
    expect(alongRing(ring, 0.5).some(([x, y]) => mesh(x, y) !== null)).toBe(false);
    expect(ringTouches(mesh, ring)).toBe(true);
    const on = ringOverMesh(mesh, ring);
    expect(on.length).toBeGreaterThan(0);
    for (const [x, y, h] of on) {
      expect(x).toBeCloseTo(10, 6);
      expect(y).toBeGreaterThan(5);
      expect(y).toBeLessThan(5.5);
      expect(h).toBe(100);
    }
    expect(scene.underRing(ring)).toBe(100);
    expect(scene.forRing(ring).lo).toBe(100);
  });

  it("stands the house on the mesh, not sunk on the horizon", () => {
    const b = house(ring);
    // Before: on the horizon, its walls 40 cm under the horizon and 80 cm under the tip.
    const lowest = (nodes: Kn5MeshNode[]) => {
      let lo = Infinity;
      for (const n of nodes.filter((m) => m.name.startsWith("1WALL_BLD"))) for (let i = 1; i < n.positions.length; i += 3) lo = Math.min(lo, n.positions[i]);
      return lo;
    };
    expect(lowest(buildBuildings([b], horizon, () => 0.4))).toBeCloseTo(99.2, 4);
    const nodes = buildBuildings([b], scene, undefined, (x) => scene.forRing(x.ring));
    expect(lowest(nodes)).toBeCloseTo(100 - 0.02, 4);
    const after = checkGround(group("track", [group("TERRAIN", [tip]), group("BUILDINGS", nodes)]));
    expect(after.off).toEqual([]);
  });

  it("still leaves a footprint well clear of the mesh off it", () => {
    expect(ringTouches(mesh, [[0, 0], [8, 0], [8, 10], [0, 10]])).toBe(false);
    expect(ringOverMesh(mesh, [[0, 0], [8, 0], [8, 10], [0, 10]])).toEqual([]);
  });
});

describe("a front door across the terrain mesh's edge", () => {
  // The mesh covers x >= 4 and falls east, 5 cm a metre; past its edge the fallback is 3 m lower. The
  // door (a third of the way along the 12 m front, x 3.575 to 4.425) straddles the edge.
  const h = (x: number) => 100 - 0.05 * (x - 4);
  const terrain = ground("1GRASS_t000", 4, -10, 30, 20, h);
  const mesh = topSurface([terrain]);
  const scene = groundOver(mesh, () => 97);
  const b = house([[0, 0], [12, 0], [12, 8], [0, 8]]);

  it("sets the door on the mesh it stands on, not the ring's lowest past the edge", () => {
    const nodes = buildBuildings([b], scene, undefined, (x) => scene.forRing(x.ring));
    const door = nodes.find((n) => n.name.startsWith("DOOR"))!;
    expect(door).toBeDefined();
    let lo = Infinity;
    for (let i = 1; i < door.positions.length; i += 3) lo = Math.min(lo, door.positions[i]);
    // The lowest mesh under the door (at x 4.425), not the 99.6 at the ring's east end.
    expect(lo).toBeCloseTo(h(4.425), 2);
    const r = checkGround(group("track", [group("TERRAIN", [terrain]), group("BUILDINGS", nodes)]));
    expect(r.off).toEqual([]);
  });
});

describe("the terrain grid as drawn", () => {
  // A bumpy terrain, the same function a chunk builds from.
  const opts = withDefaults({ chunkSize: 30, terrainStep: 2.5, terrainLod: false });
  const terrain = (x: number, y: number) => ({ h: 10 + Math.sin(x * 0.7) * 1.3 + Math.cos(y * 0.9) * 0.8 + 0.02 * x * y, dist: 0 });

  it("matches each chunk's own triangles, either side of the origin", () => {
    const drawn = meshDrawn(terrain, opts), top = meshTop(terrain, opts);
    for (const [cx, cy] of [[0, 0], [-1, 0], [0, -1], [-1, -1], [1, 2]]) {
      const chunk = { key: "t000", minX: cx * 30, minY: cy * 30, maxX: cx * 30 + 30, maxY: cy * 30 + 30 };
      const node = buildTerrainChunk(chunk, terrain, opts, false)!;
      const surf = topSurface([node]);
      let differ = 0;
      for (let k = 0; k < 400; k++) {
        const x = chunk.minX + 0.01 + ((k * 7.31) % 29.98), y = chunk.minY + 0.01 + ((k * 3.17) % 29.98);
        const m = surf(x, y)!;
        expect(drawn(x, y)).toBeCloseTo(m, 4);
        expect(top(x, y)).toBeGreaterThanOrEqual(m - 1e-4);
        if (Math.abs(top(x, y) - m) > 1e-3) differ++;
      }
      // The highest of the two diagonals isn't the drawn one in many cells.
      expect(differ).toBeGreaterThan(20);
    }
  });
});
