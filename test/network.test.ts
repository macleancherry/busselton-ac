// Network-first road core prototype (docs/specs/road-network.md), from the spec's rules.
import { describe, expect, it } from "vitest";
import { buildGraph, buildNetwork, waysFromStreets, type NetWay } from "../src/core/network";
import { ringArea, type P2 } from "../src/core/network/geom";
import { edgeSurface } from "../src/core/network/heights";

const line = (a: P2, b: P2, n = 10): P2[] => Array.from({ length: n + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
const circle = (c: P2, r: number, n: number, a0 = 0): P2[] => {
  const pts = Array.from({ length: n }, (_, k) => [c[0] + r * Math.cos(a0 + (2 * Math.PI * k) / n), c[1] + r * Math.sin(a0 + (2 * Math.PI * k) / n)] as P2);
  return [...pts, pts[0]];
};
/** A gentle slope with a bump, so heights aren't trivially flat. */
const slope = (x: number, y: number) => 10 + 0.03 * x + 0.01 * y + 0.4 * Math.sin(x / 25);

// A T-junction: a primary road east-west through (0, 0), split into two ways there, and a residential street north.
const tWays = (): NetWay[] => [
  { pts: line([-120, 0], [0, 0]), cls: "primary" },
  { pts: line([0, 0], [120, 0]), cls: "primary" },
  { pts: [...line([0, 0], [0, 60], 6), ...line([0, 60], [5, 120], 6).slice(1)], cls: "residential" },
];

// A roundabout of radius 14 with four legs; the south leg comes in as a splitter-island pair.
const rbWays = (): NetWay[] => {
  const ring = circle([0, 0], 14, 48, -Math.PI / 2);
  const at = (deg: number) => ring[((Math.round(((deg + 90) / 360) * 48) % 48) + 48) % 48];
  const sIn = at(-115), sOut = at(-65);
  return [
    { pts: ring, cls: "tertiary", roundabout: true, oneway: 1 },
    { pts: line(at(0), [120, 0]), cls: "tertiary" },
    { pts: line(at(90), [0, 120]), cls: "residential" },
    { pts: line(at(180), [-120, 0]), cls: "tertiary" },
    // Splitter: one-way in (V -> ring) and out (ring -> V), meeting at V 30 m south.
    { pts: line([0, -44], sIn, 4), cls: "tertiary", oneway: 1 },
    { pts: line(sOut, [0, -44], 4), cls: "tertiary", oneway: 1 },
    { pts: line([0, -44], [0, -140]), cls: "tertiary" },
  ];
};

describe("graph", () => {
  it("connects ways only at shared coordinates, and chains through degree-2 vertices", () => {
    const g = buildGraph(tWays());
    const j = g.nodes.filter((n) => n.kind === "junction");
    expect(j).toHaveLength(1);
    expect(j[0].p).toEqual([0, 0]);
    expect(j[0].legs).toHaveLength(3);
    // The side street's two pieces (split at its bend? no: one way) and each primary half are one edge each.
    expect(g.edges).toHaveLength(3);
  });

  it("joins a way split in two at a vertex nothing else uses", () => {
    const g = buildGraph([{ pts: line([0, 0], [50, 0]), cls: "residential" }, { pts: line([50, 0], [100, 10]), cls: "residential" }]);
    expect(g.edges).toHaveLength(1);
    expect(g.nodes.filter((n) => n.kind === "junction")).toHaveLength(0);
  });

  it("doesn't connect crossing ways that share no node (a bridge over a road)", () => {
    const g = buildGraph([{ pts: line([-50, 0], [50, 0], 3), cls: "primary" }, { pts: line([0, -50], [0, 50], 3), cls: "primary", layer: 1 }]);
    expect(g.nodes.filter((n) => n.kind === "junction")).toHaveLength(0);
    expect(g.edges).toHaveLength(2);
  });

  it("makes a roundabout one node, with the splitter pair internal and the outer road as its leg", () => {
    const g = buildGraph(rbWays());
    const rb = g.nodes.filter((n) => n.kind === "roundabout");
    expect(rb).toHaveLength(1);
    expect(rb[0].roundabout!.r).toBeCloseTo(14, 0);
    expect(rb[0].roundabout!.w).toBeGreaterThanOrEqual(7);
    expect(rb[0].roundabout!.splitters).toHaveLength(1);
    expect(rb[0].legs).toHaveLength(4);
    expect(g.edges.filter((e) => e.internal)).toHaveLength(2);
  });

  it("keeps one-way direction right on every piece of a way split at a junction in its middle", () => {
    // Westbound one-way from x = 100 to x = -100, with a street joining at x = 0.
    const g = buildGraph([{ pts: line([100, 0], [-100, 0]), cls: "primary", oneway: 1 }, { pts: line([0, 0], [0, 50], 2), cls: "residential" }]);
    for (const e of g.edges.filter((x) => x.oneway)) {
      // Travel direction in world terms must be westward whichever way the edge's points run.
      const dx = (e.pts[e.pts.length - 1][0] - e.pts[0][0]) * e.oneway!;
      expect(dx).toBeLessThan(0);
    }
  });

  it("builds network ways from the build's street lines and rings", () => {
    const ways = waysFromStreets([{ pts: line([0, 0], [10, 0], 2), cls: "minor" }, { pts: line([0, 0], [0, 10], 2), cls: "path" }], [{ pts: circle([30, 0], 10, 12) }]);
    expect(ways.map((w) => [w.cls, !!w.roundabout])).toEqual([["minor", false], ["tertiary", true]]);
  });
});

describe("T-junction", () => {
  const net = buildNetwork(tWays(), slope);
  const j = net.junctions[0];

  it("trims each leg clear of the others, with a through road", () => {
    expect(net.failures).toEqual([]);
    expect(net.junctions).toHaveLength(1);
    for (const l of j.shape.legs) {
      expect(l.crowded).toBeFalsy();
      expect(l.trim).toBeGreaterThan(2);
      expect(l.trim).toBeLessThan(25);
    }
    expect(j.field.through).toBeDefined();
  });

  it("has one outline containing the node, with filleted corners (more area than the bare cross)", () => {
    const rings = j.mesh.contour.rings;
    expect(rings).toHaveLength(1);
    expect(ringArea(rings[0])).toBeGreaterThan(0);
    // Bare legs: each leg's rectangle out to its cap, minus overlaps (roughly). The fillets add to it.
    const bare = j.shape.legs.reduce((s, l) => s + 2 * l.hw * l.trim, 0) - 2 * 3.75 * 3;
    expect(j.mesh.area).toBeGreaterThan(bare);
    expect(Math.abs(j.mesh.area - ringArea(rings[0]))).toBeLessThan(0.5);
  });

  it("is one plane: the primary's surface carries through, the side street conforms", () => {
    expect(j.field.planar).toBe(true);
    const p = j.mesh.positions;
    for (let i = 0; i < p.length; i += 3) expect(p[i + 2]).toBeCloseTo(j.field.h([p[i], p[i + 1]]), 9);
    // Grade along the primary follows the terrain between the caps (about 3% here).
    expect(Math.abs(j.field.base.g[0])).toBeGreaterThan(0.01);
  });

  it("meets every edge at its cap without a step", () => {
    for (const e of net.edges) {
      const pr = e.profile;
      const ends = [0, pr.line.length - 1];
      for (const k of ends) {
        const a = pr.line[Math.max(0, k - 1)], b = pr.line[Math.min(pr.line.length - 1, k + 1)];
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const left: P2 = [-(b[1] - a[1]) / d, (b[0] - a[0]) / d];
        const node = k === 0 ? net.graph.edges[pr.edge].a : net.graph.edges[pr.edge].b;
        const jr = net.junctions.find((x) => x.shape.node === node);
        if (!jr) continue;
        for (const t of [-pr.halfWidth, -1, 0, 1, pr.halfWidth]) {
          const q: P2 = [pr.line[k][0] + left[0] * t, pr.line[k][1] + left[1] * t];
          expect(Math.abs(edgeSurface(pr, k, t) - jr.field.h(q))).toBeLessThan(0.001);
        }
      }
    }
  });

  it("eases the edge to the terrain away from the junction, with the crown back", () => {
    const side = net.edges.find((e) => net.graph.edges[e.profile.edge].cls === "residential")!.profile;
    const k = side.line.length - 1;
    expect(side.crown[k]).toBeCloseTo(0.02, 5);
    expect(side.crown[0]).toBeCloseTo(0, 5);
  });
});

const gentle = (x: number, y: number) => 10 + 0.012 * x + 0.004 * y + 0.03 * Math.sin(x / 25);

describe("roundabout", () => {
  const net = buildNetwork(rbWays(), gentle);
  const j = net.junctions.find((x) => x.shape.kind === "roundabout")!;

  it("is one junction: disc, island hole and splitter island hole", () => {
    expect(net.failures).toEqual([]);
    expect(j).toBeDefined();
    const rings = j.mesh.contour.rings;
    const outer = rings.filter((r) => ringArea(r) > 0), holes = rings.filter((r) => ringArea(r) < 0);
    expect(outer).toHaveLength(1);
    expect(holes).toHaveLength(2);
    // Nothing of the surface inside the island.
    const { c, rIn } = j.shape.ring!;
    const p = j.mesh.positions;
    for (let i = 0; i < p.length; i += 3) expect(Math.hypot(p[i] - c[0], p[i + 1] - c[1])).toBeGreaterThan(rIn - 0.01);
  });

  it("has a single limited-grade plane with the ring falling outward", () => {
    expect(j.field.planar).toBe(true);
    expect(Math.hypot(...j.field.base.g)).toBeLessThanOrEqual(0.025 + 1e-9);
    const { c, rIn, rOut } = j.shape.ring!;
    const inner: P2 = [c[0] + rIn + 0.1, c[1]], outerP: P2 = [c[0] + rOut - 0.1, c[1]];
    const planeDiff = j.field.base.g[0] * (outerP[0] - inner[0]);
    expect(j.field.h(outerP) - j.field.h(inner) - planeDiff).toBeCloseTo(-0.02 * (rOut - rIn - 0.2), 3);
  });

  it("caps every leg outside the ring and meets its edges without a step", () => {
    const { c, rOut } = j.shape.ring!;
    for (const l of j.shape.legs) expect(Math.hypot(l.cap.c[0] - c[0], l.cap.c[1] - c[1])).toBeGreaterThan(rOut);
    for (const e of net.edges) {
      const ge = net.graph.edges[e.profile.edge];
      const pr = e.profile;
      for (const [k, node] of [[0, ge.a], [pr.line.length - 1, ge.b]] as const) {
        if (node !== j.shape.node) continue;
        expect(Math.abs(edgeSurface(pr, k, 0) - j.field.h(pr.line[k]))).toBeLessThan(0.001);
      }
    }
  });
});

describe("junction on steeper ground", () => {
  it("blends the leg planes when they can't all conform to one plane, still meeting every cap exactly", () => {
    const net = buildNetwork(rbWays(), slope);
    const j = net.junctions.find((x) => x.shape.kind === "roundabout")!;
    expect(j.field.planar).toBe(false);
    for (const e of net.edges) {
      const ge = net.graph.edges[e.profile.edge];
      const pr = e.profile;
      for (const [k, node] of [[0, ge.a], [pr.line.length - 1, ge.b]] as const) {
        if (node !== j.shape.node) continue;
        expect(Math.abs(edgeSurface(pr, k, 0) - j.field.h(pr.line[k]))).toBeLessThan(0.001);
      }
    }
    // No steps inside: the steepest slope between neighbouring vertices stays near the ground's own
    // (up to about 6.5% here: 3% grade, 1.6% bump, 1% across, 2% ring fall). Shepard blending adds a
    // little where caps disagree; a membrane (Laplace) solve would add none (see the spec).
    const p = j.mesh.positions, idx = j.mesh.indices;
    let worst = 0;
    for (let i = 0; i < idx.length; i += 3) {
      for (const [a, b] of [[idx[i], idx[i + 1]], [idx[i + 1], idx[i + 2]]]) {
        const d = Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1]);
        if (d > 0.01) worst = Math.max(worst, Math.abs(p[a * 3 + 2] - p[b * 3 + 2]) / d);
      }
    }
    expect(worst).toBeLessThan(0.09);
  });
});

describe("merged junctions", () => {
  it("makes a dual carriageway crossing one junction, with the link inside it and a median hole", () => {
    // Eastbound at y = 0, westbound at y = 10, a side street north crossing both (a 10 m link between them).
    const net = buildNetwork([
      { pts: line([-150, 0], [0, 0]), cls: "primary", oneway: 1 },
      { pts: line([0, 0], [150, 0]), cls: "primary", oneway: 1 },
      { pts: line([150, 10], [0, 10]), cls: "primary", oneway: 1 },
      { pts: line([0, 10], [-150, 10]), cls: "primary", oneway: 1 },
      { pts: line([0, 0], [0, 10], 2), cls: "residential" },
      { pts: line([0, 10], [0, 120]), cls: "residential" },
    ], gentle);
    expect(net.junctions).toHaveLength(1);
    const j = net.junctions[0];
    expect(j.shape.legs).toHaveLength(5);
    expect(net.graph.edges.filter((e) => e.internal)).toHaveLength(1);
    // The median west of the link stays open (not paved) a few metres out.
    expect(j.shape.sdf([-12, 5])).toBeGreaterThan(0);
    expect(j.shape.sdf([0, 5])).toBeLessThan(0);
  });
});
