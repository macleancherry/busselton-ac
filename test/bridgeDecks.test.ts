import { describe, expect, it } from "vitest";
import { bridgeRailings, deckBridges, deckGround, deckRuns, decksOf } from "../src/core/bridges";
import { LocalProjection, type Vec2 } from "../src/core/geo";
import { withDefaults } from "../src/core/options";
import { planRoad, SegmentIndex } from "../src/core/road";
import { planSideStreets, streetSurface, type StreetLine } from "../src/core/sideStreets";
import { buildGraph, type Graph } from "../src/core/network/graph";
import { waysFromStreets } from "../src/core/network/index";
import { carriagewayLines, planGraphStreets } from "../src/core/network/streets";

const line = (a: Vec2, b: Vec2, n = 10): Vec2[] => Array.from({ length: n + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
// A river 2 m down, 20 m wide, running north-south at x 90 to 110; banks at 1 m.
const river = (x: number, _y: number) => (x > 90 && x < 110 ? -1 : 1);

describe("bridge decks", () => {
  // A street east-west across the river: approach, bridge (x 85 to 115), approach. A footbridge, a
  // tunnel, and a bridge over a road (crossed by a north-south street) beside it.
  const lines = [
    { pts: line([0, 0], [85, 0]), cls: "minor" },
    { pts: line([85, 0], [115, 0], 3), cls: "minor", brunnel: "bridge" },
    { pts: line([115, 0], [200, 0]), cls: "minor" },
    { pts: line([85, 40], [115, 40], 3), cls: "path", brunnel: "bridge" },
    { pts: line([0, 80], [60, 80]), cls: "minor", brunnel: "tunnel" },
    { pts: line([85, 120], [115, 120], 3), cls: "secondary", brunnel: "bridge" },
    { pts: line([100, 100], [100, 140]), cls: "minor" },
  ];

  it("builds road bridges over no other road, not footbridges, tunnels or bridges over a road", () => {
    expect([...deckBridges(lines)]).toEqual([1]);
    expect(decksOf(lines)).toEqual([{ pts: lines[1].pts, width: 6 }]);
  });

  it("lays the deck flat from one end's ground to the other's, never down into the river", () => {
    const h = deckGround(river, decksOf(lines));
    for (const x of [86, 95, 100, 105, 114]) expect(h(x, 0)).toBeCloseTo(1, 5);
    expect(h(100, 3.5)).toBeCloseTo(1, 5); // within the width and the margin
    expect(h(100, 8)).toBe(-1); // beside it: the river
    expect(h(50, 0)).toBe(1);
    // A sloping deck: straight from end to end.
    const slope = deckGround((x) => (x > 90 && x < 110 ? -1 : x <= 90 ? 0 : 3), [{ pts: line([85, 0], [115, 0], 3), width: 6 }]);
    expect(slope(100, 0)).toBeCloseTo(1.5, 5);
  });

  it("puts a railing along each side, standing on the deck, with a wall to hit", () => {
    const h = deckGround(river, decksOf(lines));
    const nodes = bridgeRailings(decksOf(lines), (x, y) => h(x, y) + 0.1);
    expect(nodes.map((n) => n.name)).toEqual(["BRIDGEPLINTH_000", "BRIDGERAIL_000", "1WALL_BRIDGE_000"]);
    const wall = nodes[2];
    expect(wall.renderable).toBe(false);
    // Inside the deck's 6 m, both sides; AC y up, z = -north.
    const zs = new Set<number>();
    for (let i = 0; i < wall.positions.length; i += 3) {
      expect(Math.abs(wall.positions[i + 2])).toBeLessThanOrEqual(3);
      expect(wall.positions[i + 1]).toBeGreaterThan(0.85);
      zs.add(Math.sign(wall.positions[i + 2]));
    }
    expect(zs).toEqual(new Set([1, -1]));
    // The plinth's top faces up.
    const pl = nodes[0];
    expect(Math.max(...Array.from(pl.normals).filter((_, i) => i % 3 === 1))).toBeGreaterThan(0.99);
  });

  it("finds the stretches of built streets on a deck", () => {
    const runs = deckRuns([{ pts: line([0, 0], [200, 0], 100), width: 7 }, { pts: line([0, 60], [200, 60], 100), width: 7 }], decksOf(lines));
    expect(runs).toHaveLength(1);
    expect(runs[0].width).toBe(7);
    expect(runs[0].pts[0][0]).toBeCloseTo(86, 5);
    expect(runs[0].pts[runs[0].pts.length - 1][0]).toBeCloseTo(114, 5);
  });

  describe("old side streets", () => {
    const opts = withDefaults({ banking: false, corridor: 300 });
    const plan = planRoad(line([0, -200], [600, -200], 60), opts);
    const index = new SegmentIndex(plan);
    const proj = new LocalProjection([115.35, -33.65]);
    const streetLines: StreetLine[] = lines.map((l) => ({ ...l, pts: l.pts.map((p) => proj.toLngLat(p)) }));

    it("build the bridge as a deck street, flat over the river", () => {
      const sp = planSideStreets(streetLines, [], plan, index, opts, proj, null);
      const decks = sp.streets.filter((s) => s.deck);
      expect(decks).toHaveLength(1);
      expect(decks[0].pts[0][0]).toBeCloseTo(85, 3);
      const surface = streetSurface(plan, index, opts, river);
      const st = decks[0];
      for (let k = 0; k < st.pts.length; k++) expect(surface(st, k, 0)).toBeCloseTo(1.1, 3);
      // The approach either side drapes on the bank as before; the tunnel and the bridge over a road stay out.
      expect(sp.streets.some((s) => s.pts.some(([x, y]) => y > 70 && y < 90 && x < 60))).toBe(false);
      expect(sp.streets.filter((s) => s.cls === "secondary")).toHaveLength(0);
    });

    it("leave every bridge out with bridgeDecks false", () => {
      const sp = planSideStreets(streetLines, [], plan, index, { ...opts, bridgeDecks: false }, proj, null);
      expect(sp.streets.some((s) => s.deck)).toBe(false);
      expect(sp.streets.some((s) => s.pts.some(([x, y]) => x > 90 && x < 110 && Math.abs(y) < 1))).toBe(false);
    });
  });

  describe("networkCore", () => {
    it("joins the bridge to the street either side as one edge, built as a street", () => {
      const g = buildGraph(waysFromStreets(lines, []));
      const through = g.edges.filter((e) => e.pts.some(([x, y]) => x === 0 && y === 0));
      expect(through).toHaveLength(1);
      expect(through[0].layer).toBe(0);
      expect(new Set([through[0].pts[0][0], through[0].pts[through[0].pts.length - 1][0]])).toEqual(new Set([0, 200]));
      const { streets } = planGraphStreets(g, { route: null, rings: [], inArea: () => true, corridor: 30, vergeWidth: 1.5 });
      expect(streets.some((s) => s.pts.some(([x, y]) => x > 95 && x < 105 && y === 0))).toBe(true);
      // The bridge over a road keeps its own layer and stays out.
      expect(g.edges.find((e) => e.cls === "secondary")?.layer).toBe(1);
      expect(buildGraph(waysFromStreets(lines, [], { bridgeDecks: false })).edges.find((e) => e.pts.some(([x, y]) => x === 95 && y === 0))?.layer).toBe(1);
    });
  });
});

describe("divided roads at the area's edge", () => {
  it("carry on while either carriageway is in the area, and draw as two carriageways", () => {
    // A divided road (a 10 m median, 7 m carriageways) running north-east out of an area whose edge is y = 100.
    const d: Vec2 = [Math.SQRT1_2, Math.SQRT1_2];
    const median = { nodes: [], edges: [{ id: 0, a: 0, b: 1, pts: line([0, 0], [d[0] * 300, d[1] * 300], 150), cls: "primary", rank: 3, width: 24, layer: 0, median: 10 }] } as unknown as Graph;
    const inArea = ([, y]: Vec2) => y < 100 - 3;
    const { streets } = planGraphStreets(median, { route: null, rings: [], inArea, corridor: 30, vergeWidth: 1.5 });
    expect(streets).toHaveLength(1);
    const end = streets[0].pts[streets[0].pts.length - 1];
    // The median alone stops at y 97; the carriageway further in (8.5 m off, on the south-east side) runs on to about 103.
    expect(end[1]).toBeGreaterThan(101);
    const cw = carriagewayLines(streets[0]);
    expect(cw).toHaveLength(2);
    expect(cw[0].width).toBeCloseTo(7, 5);
    expect(Math.hypot(cw[0].pts[0][0] - cw[1].pts[0][0], cw[0].pts[0][1] - cw[1].pts[0][1])).toBeCloseTo(17, 3);
    expect(carriagewayLines({ pts: [[0, 0], [1, 0]], width: 6 })).toEqual([{ pts: [[0, 0], [1, 0]], width: 6 }]);
  });
});
