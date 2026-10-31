// Fresh tests for the rewritten scenery module (docs/specs/scenery.md, test list).
import { describe, expect, it } from "vitest";
import {
  box, buildGuardRails, buildGuidePosts, buildTrees, cardFor, ChunkedMesh, filterTrees, GUIDE_U, railNeeds, rng, treeSpotsFromImagery, treeTrunks, type TreeSpot,
} from "../src/core/scenery";
import { placeRandom } from "../src/core/random";
import { MAX_MESH_VERTICES, type Kn5MeshNode } from "../src/core/kn5";
import { MeshBuilder } from "../src/core/mesh";
import { withDefaults } from "../src/core/options";
import { planRoad, SegmentIndex } from "../src/core/road";
import { SINK } from "../src/core/sceneGround";
import { TREE_SPECIES } from "../src/core/treeSprites";
import type { Vec2 } from "../src/core/geo";

const opts = withDefaults({});
const plan = planRoad([[0, 0], [100, 0], [200, 0], [300, 0], [400, 0]], opts);
const idx = new SegmentIndex(plan);
const W = plan.samples[Math.floor(plan.samples.length / 2)].width;
const flat = () => 0;

/** Local ENU points of a kn5 mesh (AC: x east, y up, z south). */
function enu(m: Kn5MeshNode): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < m.positions.length; i += 3) out.push([m.positions[i], -m.positions[i + 2], m.positions[i + 1]]);
  return out;
}
/** Groups of `size` vertices (one object each), across meshes. */
function objects(ms: Kn5MeshNode[], size: number): [number, number, number][][] {
  const out: [number, number, number][][] = [];
  for (const m of ms) {
    const p = enu(m);
    for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size));
  }
  return out;
}
const centre = (pts: [number, number, number][]): Vec2 => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
const minZ = (pts: [number, number, number][]) => Math.min(...pts.map((p) => p[2]));
const sampleAt = (x: number) => plan.samples.reduce((b, s, i) => (Math.abs(s.pos[0] - x) < Math.abs(plan.samples[b].pos[0] - x) ? i : b), 0);

describe("rng", () => {
  it("repeats for a seed, stays in [0, 1) and differs between seeds", () => {
    const a = rng(42), b = rng(42), c = rng(43);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(Array.from({ length: 1000 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(Array.from({ length: 10 }, () => c())).not.toEqual(xs.slice(0, 10));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
  it("gives a place its own number", () => {
    expect(placeRandom(12.34, 56.78, 3)).toBe(placeRandom(12.34, 56.78, 3));
    expect(placeRandom(12.34, 56.78, 3)).not.toBe(placeRandom(12.34, 56.78, 4));
    expect(placeRandom(12.34, 56.78, 3)).not.toBe(placeRandom(12.54, 56.78, 3));
  });
});

describe("ChunkedMesh", () => {
  it("starts a new builder before the vertex limit, drops empty ones, normals on", () => {
    const cm = new ChunkedMesh(1000);
    for (let k = 0; k < 140; k++) {
      const mb = cm.next();
      expect(mb.normals).not.toBeNull();
      for (let v = 0; v < 1000; v++) mb.vertex([0, 0, 0], 0, 0);
    }
    const all = cm.all();
    expect(all.length).toBeGreaterThan(2);
    expect(all.every((m) => m.vertexCount <= MAX_MESH_VERTICES)).toBe(true);
    expect(all.reduce((s, m) => s + m.vertexCount, 0)).toBe(140000);
    const empty = new ChunkedMesh();
    empty.next(10);
    expect(empty.all()).toEqual([]);
  });
});

describe("box", () => {
  it("has 20 vertices, 10 triangles, outward normals and per-side UVs", () => {
    const kit = new MeshBuilder();
    const along: Vec2 = [Math.SQRT1_2, Math.SQRT1_2];
    box(kit, [5, 7], along, 2, 1, 0, 3, [undefined, [0.2, 0.3], undefined, [0.6, 0.7]]);
    expect(kit.vertexCount).toBe(20);
    expect(kit.indices.length).toBe(30);
    const n = kit.normals!;
    for (let i = 0; i < 20; i++) {
      const p = kit.positions.slice(i * 3, i * 3 + 3), nn = n.slice(i * 3, i * 3 + 3);
      if (i >= 16) {
        expect(nn).toEqual([0, 0, 1]);
        continue;
      }
      expect((p[0] - 5) * nn[0] + (p[1] - 7) * nn[1]).toBeGreaterThan(0);
      const u = kit.uvs[i * 2];
      const fwd = nn[0] * along[0] + nn[1] * along[1];
      if (fwd > 0.99) expect([0.2, 0.3]).toContain(u);
      else if (fwd < -0.99) expect([0.6, 0.7]).toContain(u);
      else expect([0, 1]).toContain(u);
    }
    // Every triangle faces the way its normal says.
    for (let t = 0; t < 30; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => kit.indices[t + k] * 3);
      const P = kit.positions;
      const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      expect(cr[0] * n[a] + cr[1] * n[a + 1] + cr[2] * n[a + 2]).toBeGreaterThan(0);
    }
  });
});

/* ---------------- photo trees ---------------- */

const SIZE = 128; // 1 m a pixel over a 128 m chunk
const CHUNK = { minX: 0, minY: 0, maxX: 128, maxY: 128 };
type Paint = (x: number, y: number, r: () => number) => [number, number, number] | null;
function photo(paint: Paint, seed = 1): Uint8Array {
  const r = rng(seed), px = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const c = paint(x, y, r) ?? [120, 120, 120];
    px.set([...c.map((v) => Math.max(0, Math.min(255, Math.round(v)))), 255], (y * SIZE + x) * 4);
  }
  return px;
}
const lush = (r: () => number): [number, number, number] => { const k = (r() - 0.5) * 60; return [60 + k, 110 + k, 50 + k]; };
const olive = (r: () => number): [number, number, number] => { const k = (r() - 0.5) * 70; return [100 + k, 104 + k, 96 + k]; };
const sea = (r: () => number): [number, number, number] => { const k = (r() - 0.5) * 20; return [30 + k, 110 + k, 112 + k]; };
const inBox = (x: number, y: number, x0: number, x1: number, y0: number, y1: number) => x >= x0 && x < x1 && y >= y0 && y < y1;
// Pixel row y is northing maxY - y.
const spotIn = (t: TreeSpot, x0: number, x1: number, y0: number, y1: number) => t.x >= x0 - 4 && t.x <= x1 + 4 && 128 - t.y >= y0 - 4 && 128 - t.y <= y1 + 4;

describe("treeSpotsFromImagery", () => {
  it("finds trees in green canopy, none on flat grey or flat lawn", () => {
    const img = photo((x, y, r) => (inBox(x, y, 14, 56, 14, 56) ? lush(r) : inBox(x, y, 70, 120, 70, 120) ? [90, 150, 70] : null));
    const spots = treeSpotsFromImagery(img, SIZE, CHUNK, 1);
    expect(spots.length).toBeGreaterThan(10);
    expect(spots.every((t) => spotIn(t, 14, 56, 14, 56))).toBe(true);
    expect(spots.every((t) => t.scale >= 0.75 && t.scale <= 1.35 && t.variant === 0)).toBe(true);
    expect(treeSpotsFromImagery(img, SIZE, CHUNK, 0)).toEqual([]);
    expect(treeSpotsFromImagery(img, SIZE, CHUNK, 2).length).toBeGreaterThan(spots.length);
  });

  it("needs grey-olive canopy to be a stretch, not a strip", () => {
    // Cells are 7 px; a strip exactly one cell wide, and a 5 x 5 cell block.
    const strip = photo((x, y, r) => (inBox(x, y, 35, 42, 0, 128) ? olive(r) : null));
    expect(treeSpotsFromImagery(strip, SIZE, CHUNK, 1)).toEqual([]);
    const block = photo((x, y, r) => (inBox(x, y, 35, 70, 35, 70) ? olive(r) : null));
    const spots = treeSpotsFromImagery(block, SIZE, CHUNK, 1);
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.every((t) => spotIn(t, 35, 70, 35, 70))).toBe(true);
  });

  it("puts no trees on teal sea, and marks trees by a big water body coastal", () => {
    expect(treeSpotsFromImagery(photo((_x, _y, r) => sea(r)), SIZE, CHUNK, 1)).toEqual([]);
    const bay = treeSpotsFromImagery(photo((x, y, r) => (x < 60 ? sea(r) : inBox(x, y, 63, 91, 40, 80) ? lush(r) : null)), SIZE, CHUNK, 1);
    expect(bay.length).toBeGreaterThan(0);
    expect(bay.every((t) => t.coastal)).toBe(true);
    const pool = treeSpotsFromImagery(photo((x, y, r) => (inBox(x, y, 7, 14, 49, 56) ? sea(r) : inBox(x, y, 21, 63, 35, 77) ? lush(r) : null)), SIZE, CHUNK, 1);
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.some((t) => t.coastal)).toBe(false);
  });

  it("skips pixels with no data", () => {
    const img = photo((_x, _y, r) => lush(r));
    for (let i = 3; i < img.length; i += 4) img[i] = 0;
    expect(treeSpotsFromImagery(img, SIZE, CHUNK, 1)).toEqual([]);
  });

  it("is the same run twice and in either chunk order", () => {
    const a = photo((x, y, r) => (inBox(x, y, 10, 100, 10, 100) ? lush(r) : null), 1);
    const b = photo((x, y, r) => (inBox(x, y, 20, 120, 0, 60) ? lush(r) : null), 2);
    const B = { minX: 128, minY: 0, maxX: 256, maxY: 128 };
    const ab = [...treeSpotsFromImagery(a, SIZE, CHUNK, 1), ...treeSpotsFromImagery(b, SIZE, B, 1)];
    const ba = [...treeSpotsFromImagery(b, SIZE, B, 1), ...treeSpotsFromImagery(a, SIZE, CHUNK, 1)];
    const key = (t: TreeSpot) => `${t.x},${t.y},${t.scale}`;
    expect(ab.map(key).sort()).toEqual(ba.map(key).sort());
    expect(treeSpotsFromImagery(a, SIZE, CHUNK, 1)).toEqual(treeSpotsFromImagery(a, SIZE, CHUNK, 1));
  });
});

/* ---------------- filtering ---------------- */

describe("filterTrees", () => {
  const tree = (x: number, y: number, scale = 1, variant = 0): TreeSpot => ({ x, y, scale, variant });
  const clear = W / 2 + opts.vergeWidth + 1.5;
  const crown = 0.6 * TREE_SPECIES[0].crown;

  it("keeps trees that fit, shrinks near fits and drops the rest", () => {
    expect(filterTrees([tree(200, 1)], idx, opts, 100)).toEqual([]);
    expect(filterTrees([tree(200, W / 2 + 1)], idx, opts, 100)).toEqual([]);
    const full = filterTrees([tree(200, clear + crown + 0.1)], idx, opts, 100);
    expect(full).toHaveLength(1);
    expect(full[0].scale).toBe(1);
    const shrunk = filterTrees([tree(200, -(clear + crown * 0.7))], idx, opts, 100);
    expect(shrunk).toHaveLength(1);
    expect(shrunk[0].scale).toBeCloseTo(0.7, 2);
    expect(filterTrees([tree(200, clear + crown * 0.4)], idx, opts, 100)).toEqual([]);
  });

  it("drops trees past the corridor unless an area build covers them", () => {
    const far = tree(200, opts.corridor + 20);
    expect(filterTrees([far], idx, opts, 100)).toEqual([]);
    expect(filterTrees([far], idx, opts, 100, () => 0)).toHaveLength(1);
    expect(filterTrees([far], idx, opts, 100, () => opts.corridor)).toEqual([]);
  });

  it("uses the tuart card's crown for the card-less CSP models", () => {
    expect(cardFor(5)).toBe(TREE_SPECIES[3]);
    expect(cardFor(6)).toBe(TREE_SPECIES[3]);
    expect(cardFor(99)).toBe(TREE_SPECIES[0]);
    expect(cardFor(-1)).toBe(TREE_SPECIES[0]);
    const y = clear + 0.6 * TREE_SPECIES[3].crown + 0.1;
    expect(filterTrees([tree(200, y, 1, 5)], idx, opts, 100)[0].scale).toBe(1);
  });

  it("thins evenly to the cap and keeps the same trees whatever the order", () => {
    const spots = Array.from({ length: 200 }, (_, i) => tree(20 + (i % 100) * 3.6, (i < 100 ? 1 : -1) * 30));
    const kept = filterTrees(spots, idx, opts, 20);
    expect(kept).toHaveLength(20);
    // Spread over the whole road, not cut off at one end.
    expect(Math.min(...kept.map((t) => t.x))).toBeLessThan(80);
    expect(Math.max(...kept.map((t) => t.x))).toBeGreaterThan(300);
    const shuffled = [...spots].sort((a, b) => placeRandom(a.x, a.y) - placeRandom(b.x, b.y));
    expect(filterTrees(shuffled, idx, opts, 20)).toEqual(kept);
  });
});

/* ---------------- tree meshes and trunks ---------------- */

const slope = (x: number, y: number) => 5 + 0.1 * x - 0.05 * y;

describe("buildTrees", () => {
  it("makes 24 vertices a tree, based SINK into the ground, with the species' u range", () => {
    const ms = buildTrees([{ x: 10, y: 20, scale: 1, variant: 2 }, { x: 40, y: -5, scale: 0.8, variant: 0 }], slope);
    expect(ms).toHaveLength(1);
    expect(ms[0].name).toBe("TREES_000");
    expect(ms[0].material).toBe("trees");
    expect(ms[0].castShadows).toBe(true);
    expect(ms[0].positions.length / 3).toBe(48);
    const [a, b] = objects(ms, 24);
    expect(minZ(a)).toBeCloseTo(slope(10, 20) - SINK, 4);
    expect(minZ(b)).toBeCloseTo(slope(40, -5) - SINK, 4);
    expect(Math.max(...a.map((p) => p[2])) - minZ(a)).toBeCloseTo(TREE_SPECIES[2].height, 4);
    const us = new Set(Array.from(ms[0].uvs.slice(0, 48)).filter((_, i) => i % 2 === 0).map((u) => +u.toFixed(4)));
    expect([...us].sort()).toEqual([0.4, 0.6]);
    // Normals lean upward.
    for (let i = 1; i < 48 * 3; i += 3) expect(ms[0].normals[i]).toBeGreaterThan(0.9);
  });

  it("turns a tree by its place, not its place in the list", () => {
    const a: TreeSpot = { x: 10, y: 20, scale: 1, variant: 0 };
    const alone = enu(buildTrees([a], flat)[0]);
    const after = enu(buildTrees([{ x: 90, y: 30, scale: 1, variant: 1 }, a], flat)[0]).slice(24);
    expect(after).toEqual(alone);
  });

  it("takes a custom prefix and sink, and nothing for no spots", () => {
    const ms = buildTrees([{ x: 0, y: 0, scale: 1, variant: 0 }], flat, "HORIZONTREES", 0.3);
    expect(ms[0].name).toBe("HORIZONTREES_000");
    expect(minZ(enu(ms[0]))).toBeCloseTo(-0.3, 5);
    expect(buildTrees([], flat)).toEqual([]);
  });

  it("splits very many trees across meshes", () => {
    const many = Array.from({ length: 3000 }, (_, i) => ({ x: i, y: 0, scale: 1, variant: i % 5 }));
    const ms = buildTrees(many, flat);
    expect(ms.length).toBeGreaterThan(1);
    expect(ms.every((m) => m.positions.length / 3 <= MAX_MESH_VERTICES)).toBe(true);
    expect(ms.map((m) => m.name)).toEqual(ms.map((_, i) => `TREES_${String(i).padStart(3, "0")}`));
  });
});

describe("treeTrunks", () => {
  it("puts an invisible collidable box at each trunk, SINK into the ground", () => {
    const spots: TreeSpot[] = [{ x: 10, y: 20, scale: 1, variant: 3 }, { x: -30, y: 4, scale: 0.2, variant: 1 }, { x: 0, y: 0, scale: 1, variant: 6 }];
    const ms = treeTrunks(spots, slope);
    expect(ms).toHaveLength(1);
    expect(ms[0].name).toBe("1WALL_TREE_000");
    expect(ms[0].material).toBe("wall");
    expect(ms[0].renderable).toBe(false);
    expect(ms[0].castShadows).toBe(false);
    const boxes = objects(ms, 20);
    expect(boxes).toHaveLength(3);
    boxes.forEach((b, i) => {
      expect(minZ(b)).toBeCloseTo(slope(spots[i].x, spots[i].y) - SINK, 4);
      expect(Math.max(...b.map((p) => p[2]))).toBeCloseTo(slope(spots[i].x, spots[i].y) + 3, 4);
    });
    const width = (b: [number, number, number][]) => Math.max(...b.map((p) => p[0])) - Math.min(...b.map((p) => p[0]));
    expect(width(boxes[0])).toBeCloseTo(0.75, 4);
    expect(width(boxes[1])).toBeCloseTo(0.2, 4); // at least 0.2 m
    expect(width(boxes[2])).toBeCloseTo(0.75, 4); // marri: the tuart's trunk
  });
});

/* ---------------- rails ---------------- */

/** Land falling `drop` metres just past the left verge between x0 and x1 (the asphalt edge stays at 0). */
const cliff = (drop: number, ...spans: [number, number][]) => (x: number, y: number) =>
  y > W / 2 + 0.5 && spans.some(([a, b]) => x >= a && x <= b) ? -drop : 0;
const leftRuns = (side: boolean[]) => {
  const out: [number, number][] = [];
  side.forEach((v, i) => {
    if (!v) return;
    const x = plan.samples[i].pos[0];
    if (out.length && i > 0 && side[i - 1]) out[out.length - 1][1] = x;
    else out.push([x, x]);
  });
  return out;
};

describe("railNeeds", () => {
  it("wants a rail by a 2 m drop for 40 m, on that side only", () => {
    const [left, right] = railNeeds(plan, opts, cliff(2, [100, 140]), [], idx);
    expect(right.some(Boolean)).toBe(false);
    const runs = leftRuns(left);
    expect(runs).toHaveLength(1);
    expect(runs[0][0]).toBeGreaterThan(95);
    expect(runs[0][1]).toBeLessThan(145);
    expect(left).toHaveLength(plan.samples.length);
  });
  it("leaves a 1.5 m drop and a 20 m run alone", () => {
    expect(railNeeds(plan, opts, cliff(1.5, [100, 140]), [], idx)[0].some(Boolean)).toBe(false);
    expect(railNeeds(plan, opts, cliff(2, [100, 118]), [], idx)[0].some(Boolean)).toBe(false);
  });
  it("joins two runs 8 m apart", () => {
    const runs = leftRuns(railNeeds(plan, opts, cliff(2, [100, 140], [148, 190]), [], idx)[0]);
    expect(runs).toHaveLength(1);
  });
  it("follows a rail OSM maps beside the route, on its side", () => {
    const osm: Vec2[][] = [[[200, -(W / 2 + 2)], [260, -(W / 2 + 2)]]];
    const [left, right] = railNeeds(plan, opts, flat, osm, idx);
    expect(left.some(Boolean)).toBe(false);
    expect(right[sampleAt(230)]).toBe(true);
    expect(right[sampleAt(100)]).toBe(false);
  });
});

const runMask = (k: number, x0: number, x1: number): [boolean[], boolean[]] => {
  const m: [boolean[], boolean[]] = [plan.samples.map(() => false), plan.samples.map(() => false)];
  plan.samples.forEach((s, i) => { if (s.pos[0] >= x0 && s.pos[0] <= x1) m[k][i] = true; });
  return m;
};

describe("buildGuardRails", () => {
  it("makes one collidable rail per run, 0.45 to 0.8 m over the ground, with posts every 4 m", () => {
    const { rails, posts: postNodes } = buildGuardRails(plan, opts, runMask(0, 100, 200), slope);
    expect(rails.map((m) => m.name)).toEqual(["1WALL_RAIL_L_000"]);
    expect(rails[0].material).toBe("rail");
    for (const [x, y, z] of enu(rails[0])) {
      const above = z - slope(x, y);
      expect(Math.min(Math.abs(above - 0.45), Math.abs(above - 0.8))).toBeLessThan(1e-3);
      expect(y).toBeGreaterThan(W / 2); // on the left
    }
    expect(postNodes.every((m) => m.name.startsWith("RAILPOSTS_") && m.material === "steel")).toBe(true);
    const posts = objects(postNodes, 20);
    expect(posts.length).toBeGreaterThanOrEqual(24);
    expect(posts.length).toBeLessThanOrEqual(27);
    for (const p of posts) {
      const [x, y] = centre(p);
      expect(minZ(p)).toBeCloseTo(slope(x, y) - SINK, 3);
    }
    const xs = posts.map((p) => centre(p)[0]).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeLessThan(4.6);
  });
  it("numbers runs per side and makes nothing for no needs", () => {
    const m = runMask(1, 50, 90);
    runMask(1, 200, 260)[1].forEach((v, i) => { if (v) m[1][i] = true; });
    const names = buildGuardRails(plan, opts, m, flat).rails.map((x) => x.name);
    expect(names).toEqual(["1WALL_RAIL_R_000", "1WALL_RAIL_R_001"]);
    expect(buildGuardRails(plan, opts, runMask(0, -10, -5), flat)).toEqual({ rails: [], posts: [] });
  });
});

/* ---------------- guide posts ---------------- */

describe("buildGuidePosts", () => {
  const none: [boolean[], boolean[]] = [plan.samples.map(() => false), plan.samples.map(() => false)];

  it("stands a post every 50 m each side, 30 m in from the ends", () => {
    const posts = objects(buildGuidePosts(plan, opts, none, flat), 20).map(centre);
    const left = posts.filter((p) => p[1] > 0).map((p) => p[0]).sort((a, b) => a - b);
    const right = posts.filter((p) => p[1] < 0).map((p) => p[0]).sort((a, b) => a - b);
    expect(left.length).toBeGreaterThanOrEqual(6);
    expect(right.length).toBe(left.length);
    expect(left[0]).toBeGreaterThan(25);
    expect(left[left.length - 1]).toBeLessThan(375);
    for (let i = 1; i < left.length; i++) expect(Math.abs(left[i] - left[i - 1] - 50)).toBeLessThan(3);
  });

  it("leaves out posts within 5 samples of a masked sample", () => {
    const all = objects(buildGuidePosts(plan, opts, none, flat), 20).map(centre).filter((p) => p[1] > 0);
    const target = all[2][0];
    const i = sampleAt(target);
    const mask: [boolean[], boolean[]] = [none[0].slice(), none[1].slice()];
    mask[0][i + 4] = true;
    const left = objects(buildGuidePosts(plan, opts, mask, flat), 20).map(centre).filter((p) => p[1] > 0);
    expect(left).toHaveLength(all.length - 1);
    expect(left.some((p) => Math.abs(p[0] - target) < 1)).toBe(false);
  });

  it("shows red to traffic with the post on its left, white to the other way", () => {
    const ms = buildGuidePosts(plan, opts, none, flat);
    const m = ms[0];
    let seen = 0;
    for (let i = 0; i < m.positions.length / 3; i++) {
      const y = -m.positions[i * 3 + 2], nx = m.normals[i * 3], u = m.uvs[i * 2];
      if (Math.abs(nx) < 0.99) continue;
      // Forward traffic (+x) sees faces whose normal points back (-x).
      const seenByForward = nx < 0, leftSide = y > 0;
      const range = seenByForward === leftSide ? GUIDE_U.red : GUIDE_U.white;
      expect(u).toBeGreaterThanOrEqual(range[0] - 1e-6);
      expect(u).toBeLessThanOrEqual(range[1] + 1e-6);
      seen++;
    }
    expect(seen).toBeGreaterThan(20);
    expect(m.name).toBe("GUIDEPOSTS_000");
    expect(m.material).toBe("guidepost");
  });
});

/* ---------------- the height contract ---------------- */

describe("height contract", () => {
  const ground = (x: number, y: number) => 2 + 0.03 * x - 0.08 * y + 1.5 * Math.exp(-((x - 150) ** 2 + (y - 8) ** 2) / 200);
  const near = (base: number, x: number, y: number) => {
    const g = ground(x, y);
    expect(base).toBeLessThanOrEqual(g + 1e-3);
    expect(base).toBeGreaterThanOrEqual(g - SINK - 1e-3);
  };
  it("stands every object's base within SINK under the ground at its own foot", () => {
    const spots: TreeSpot[] = Array.from({ length: 40 }, (_, i) => ({ x: 100 + i * 2.5, y: (i % 2 ? 1 : -1) * (12 + (i % 7)), scale: 0.6 + (i % 5) * 0.15, variant: i % 7 }));
    for (const t of objects(buildTrees(spots, ground), 24)) near(minZ(t), ...centre(t));
    for (const b of objects(treeTrunks(spots, ground), 20)) near(minZ(b), ...centre(b));
    for (const b of objects(buildGuardRails(plan, opts, runMask(0, 120, 180), ground).posts, 20)) near(minZ(b), ...centre(b));
    for (const b of objects(buildGuidePosts(plan, opts, [plan.samples.map(() => false), plan.samples.map(() => false)], ground), 20)) near(minZ(b), ...centre(b));
  });
});
