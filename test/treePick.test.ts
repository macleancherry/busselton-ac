import { describe, expect, it } from "vitest";
import { cspTreeAngle, horizonTree, plantTree, type PlantCtx } from "../src/core/treePick";
import { treeList, type PlacedTree } from "../src/core/cspTrees";
import { ZoneMap } from "../src/core/zones";
import { MODEL_NAMES } from "../src/core/treeModels";
import { rng } from "../src/core/random";
import type { TreeSpot } from "../src/core/scenery";

// Local metres around a point near Busselton (about 115.34 E, 33.65 S).
const toLngLat = (x: number, y: number): [number, number] => [115.34 + x / 92700, -33.65 + y / 111000];
const toLocal = ([lng, lat]: [number, number]): [number, number] => [(lng - 115.34) * 92700, (lat + 33.65) * 111000];

function spots(n: number): TreeSpot[] {
  const r = rng(99);
  return Array.from({ length: n }, () => ({ x: (r() - 0.5) * 3000, y: (r() - 0.5) * 3000, scale: 0.8 + r() * 0.4, variant: 0, coastal: r() < 0.2 }));
}

function shuffled<T>(list: T[], seed: number): T[] {
  const r = rng(seed), out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const byPlace = (a: TreeSpot, b: TreeSpot) => a.y - b.y || a.x - b.x;

/** Everything the build does to the tree list, from planting to CSP's trees.txt. */
function plantAll(input: TreeSpot[], ctx: PlantCtx) {
  const planted = input.map((t) => plantTree(t, ctx)).filter((t): t is TreeSpot => t !== null).sort(byPlace);
  const horizon = input.map((t) => horizonTree(t, ctx.zones, ctx.models)).filter((t): t is TreeSpot => t !== null).sort(byPlace);
  const list = treeList(planted.map((t): PlacedTree => ({
    model: `${MODEL_NAMES[t.model ?? t.variant] ?? "x"}.bin`, pos: [t.x, 0, -t.y], angle: cspTreeAngle(t.x, t.y), size: t.scale,
  })));
  return { planted, horizon, list };
}

const where = (t: { x: number; y: number }) => ({ town: t.x > 500, foreshore: t.y > 1200 });

describe("per-tree random choices", () => {
  const trees = spots(400);
  const ctxs: Record<string, PlantCtx> = {
    plain: { zones: null, models: [], cspTrees: false, where, toLngLat },
    csp: { zones: null, models: MODEL_NAMES, cspTrees: true, where, toLngLat },
    zones: { zones: new ZoneMap({ toLngLat: (v) => toLngLat(v[0], v[1]), toLocal }), models: MODEL_NAMES, cspTrees: true, where, toLngLat },
  };

  for (const [name, ctx] of Object.entries(ctxs)) {
    it(`gives the same trees whatever order they come in (${name})`, () => {
      const a = plantAll(trees, ctx);
      for (const seed of [1, 2, 3]) expect(plantAll(shuffled(trees, seed), ctx)).toEqual(a);
    });

    it(`leaves the other trees alone when one is removed (${name})`, () => {
      const a = plantAll(trees, ctx);
      const gone = trees[7];
      const b = plantAll(trees.filter((t) => t !== gone), ctx);
      expect(b.planted).toEqual(a.planted.filter((t) => t.x !== gone.x || t.y !== gone.y));
    });
  }

  it("still varies species and angle from tree to tree", () => {
    const { planted } = plantAll(trees, ctxs.plain);
    expect(new Set(planted.map((t) => t.variant)).size).toBeGreaterThan(2);
    expect(new Set(trees.map((t) => Math.round(cspTreeAngle(t.x, t.y) / 30))).size).toBeGreaterThan(8);
  });
});
