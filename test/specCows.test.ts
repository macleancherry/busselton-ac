import { describe, expect, it } from "vitest";
import { buildSpecHouse, cowParts, specCentre, type HouseSpec } from "../src/core/specHouse";
import { landmarkOutline, landmarkReach } from "../src/core/landmarkLayer";

// A herd on its own (no blocks), placed with the look's facing 180: spec x east, y north.
const herd: HouseSpec = {
  blocks: [],
  cows: [
    { x: 0, y: 0, heading: 90 },
    { x: 4, y: 2, heading: 0, pose: "grazing" },
    { x: -3, y: 1, heading: 200, pose: "lying", calf: true },
  ],
};
const south: [number, number] = [0, -1];
const build = (spec: HouseSpec, clear?: (x: number, y: number) => boolean) =>
  buildSpecHouse(spec, { centre: [100, 50], toRoad: south, z: 2 }, "c", clear ? { blocked: clear } : undefined);
/** A mesh's vertices as map points (AC x, y up, z south: map y = -z). */
const pts = (n: { positions: ArrayLike<number> }) => {
  const out: [number, number, number][] = [];
  for (let i = 0; i < n.positions.length; i += 3) out.push([n.positions[i], -n.positions[i + 2], n.positions[i + 1]]);
  return out;
};

describe("cow statues in a spec", () => {
  const h = build(herd);
  const coat = h.nodes.filter((n) => /cow_(white|black|pink)$/.test(n.material));

  it("centres a herd with no blocks on its cows", () => {
    expect(specCentre(herd)).toEqual([0.5, 1]);
    const all = coat.flatMap(pts);
    const xs = all.map((p) => p[0]);
    // The herd spans x -3..4 round its centre (0.5), placed at x = 100.
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(100, 0);
  });

  it("builds white, black and pink coats and a box to hit for each cow", () => {
    expect(new Set(coat.map((n) => n.material.replace(/^spec_c_/, "")))).toEqual(new Set(["cow_white", "cow_black", "cow_pink"]));
    const solid = h.nodes.find((n) => n.name.startsWith("1WALL_SPECHOUSE"))!;
    expect(solid.renderable).toBe(false);
    // Four sides a cow, two triangles each.
    expect(solid.indices.length / 3).toBe(3 * 8);
    expect(h.footprints).toHaveLength(0);
  });

  it("winds every face the way its normals point (outward)", () => {
    for (const n of coat) {
      const p = n.positions, nm = n.normals;
      for (let t = 0; t < n.indices.length; t += 3) {
        const [a, b, c] = [n.indices[t], n.indices[t + 1], n.indices[t + 2]].map((i) => [p[3 * i], p[3 * i + 1], p[3 * i + 2]]);
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const i0 = n.indices[t];
        expect(g[0] * nm[3 * i0] + g[1] * nm[3 * i0 + 1] + g[2] * nm[3 * i0 + 2]).toBeGreaterThan(-1e-9);
      }
    }
  });

  it("is life size, stands on the ground and faces its heading", () => {
    // Only the standing cow (heading 90: head east) at spec (0, 0), map (99.5, 49).
    const one = build({ blocks: [], cows: [{ x: 0, y: 0, heading: 90 }] });
    const all = one.nodes.filter((n) => n.material.includes("cow_")).flatMap(pts);
    const zs = all.map((p) => p[2]), xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    expect(Math.min(...zs)).toBeGreaterThan(2 - 0.05);
    expect(Math.min(...zs)).toBeLessThan(2 + 0.05);
    expect(Math.max(...zs) - 2).toBeGreaterThan(1.35);
    expect(Math.max(...zs) - 2).toBeLessThan(1.6);
    // Nose (east) further from its spot than the tail (west), about 2.5 m nose to tail, 0.7 m wide.
    expect(Math.max(...xs) - 100).toBeGreaterThan(1.3);
    expect(100 - Math.min(...xs)).toBeLessThan(1.0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(2.2);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.8);
  });

  it("lies low, grazes with its head down, and a calf is smaller with no udder", () => {
    const top = (spec: HouseSpec) => Math.max(...build(spec).nodes.filter((n) => n.material.includes("cow_")).flatMap(pts).map((p) => p[2])) - 2;
    expect(top({ blocks: [], cows: [{ x: 0, y: 0, pose: "lying" }] })).toBeLessThan(1.0);
    expect(top({ blocks: [], cows: [{ x: 0, y: 0, calf: true }] })).toBeLessThan(1.0);
    const graze = cowParts("grazing").find((p) => p.kind === "head")!;
    expect(graze.at[2]).toBeLessThan(0.5);
    expect(cowParts("standing", true).some((p) => p.kind === "pink")).toBe(false);
    expect(cowParts("standing").some((p) => p.kind === "pink")).toBe(true);
  });

  it("leaves a cow off the road, and clears a spot round the herd", () => {
    // The road is everything east of map x = 102 (the cow at spec x 4 is at map 103.5).
    const kept = build(herd, (x) => x > 102);
    expect(kept.clipped).toContain("1 of 3 cows left off the road");
    expect(kept.nodes.find((n) => n.name.startsWith("1WALL_SPECHOUSE"))!.indices.length / 3).toBe(2 * 8);
    // From the centre (0.5, 1) to the far side of the cow at (4, 2), its reach, and a margin.
    expect(landmarkReach(herd)).toBeGreaterThan(Math.hypot(3.5, 1) + 1.35);
    expect(landmarkOutline(herd, { centre: [0, 0], toRoad: south })).toEqual([]);
  });

  it("still needs a block or a cow", () => {
    expect(() => specCentre({ blocks: [] })).toThrow();
  });
});
