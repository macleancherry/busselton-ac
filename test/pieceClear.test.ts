import { describe, expect, it } from "vitest";
import { clearPieces, fixtures } from "../src/core/pieceClear";
import { footOnRoad, onRoadFrom } from "../src/core/poleSpot";
import { checkPoles } from "../src/core/poleCheck";
import { buildPieces, type Piece } from "../src/core/furniture";
import { MeshBuilder } from "../src/core/mesh";
import { SINK, topSurface } from "../src/core/sceneGround";
import type { Kn5Node } from "../src/core/kn5";
import type { Vec2 } from "../src/core/geo";

const group = (name: string, children: Kn5Node[]): Kn5Node => ({ kind: "node", name, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children });
const square = (name: string, x0: number, y0: number, x1: number, y1: number, z: number) => {
  const mb = new MeshBuilder();
  const a = mb.vertex([x0, y0, z], 0, 0), b = mb.vertex([x1, y0, z], 1, 0), c = mb.vertex([x1, y1, z], 1, 1), d = mb.vertex([x0, y1, z], 0, 1);
  mb.quad(a, b, c, d);
  return mb.toKn5(name, name.startsWith("1ROAD") || name.startsWith("1STREET") ? "asphalt" : "grass");
};

// Flat ground at 10 m, the route along y = 0 (8 m wide) and a side street going north at x = 300,
// widened at its mouth (a fill the street plan's centreline and width don't know about).
const terrain = square("1GRASS_t000", -50, -60, 650, 60, 10);
const route = square("1ROAD_000", -50, -4, 650, 4, 10);
const side = square("1STREET_000", 296, 0, 304, 60, 10);
const mouth = square("1STREET_RETFILL_000", 290, 0, 310, 9, 10);
const onRoad = onRoadFrom(topSurface([route, side, mouth], /^\d(ROAD|STREET)/));
const flat = () => 10;
const world = (pieces: Piece[]) =>
  group("track", [group("TERRAIN", [terrain]), group("ROAD", [route]), group("SIDESTREETS", [side, mouth]), group("FURNITURE", buildPieces(pieces, null))]);

const post = (at: Vec2, size: number, top: number, material = "steel"): Piece =>
  ({ kind: "box", at, along: [1, 0], length: size, depth: size, z0: 10 - SINK, z1: 10 + top, material });

/** A shop pylon as furniture.ts `landmarks` makes it: two 0.12 m legs 1.5 m apart and a panel. */
const pylon = (c: Vec2): Piece[] => [
  post([c[0] - 0.75, c[1]], 0.12, 3.2),
  post([c[0] + 0.75, c[1]], 0.12, 3.2),
  { kind: "face", at: [c[0], c[1] + 0.1], normal: [0, 1], z0: 10 + 2.3, height: 0.9, art: "poi", twoSided: true },
];

describe("pieces off the road", () => {
  it("joins a pylon's legs through its panel, and a letterbox post with its box", () => {
    const pieces: Piece[] = [
      ...pylon([100, 10]),
      post([200, 10], 0.09, 0.95, "timber"),
      { kind: "box", at: [200, 10], along: [1, 0], length: 0.3, depth: 0.42, z0: 10.95, z1: 11.22, material: "letterbox" },
    ];
    const sets = fixtures(pieces).map((s) => s.sort()).sort((a, b) => a[0] - b[0]);
    expect(sets).toEqual([[0, 1, 2], [3, 4]]);
  });

  it("moves a pylon with a leg on a street's mouth fill off it, panel and all", () => {
    // One leg at x 309.3 is on the mouth fill (to x 310), the other on grass: the Margaret River case.
    const pieces = pylon([310.05, 8]);
    expect(checkPoles(world(pieces)).polesOnRoad.length).toBe(1);
    const r = clearPieces(pieces, onRoad, flat);
    expect(r.moved).toBe(1);
    expect(r.dropped).toBe(0);
    expect(r.pieces).toHaveLength(3);
    for (const p of r.pieces) if (p.kind === "box") expect(footOnRoad(p.at, 0.06, onRoad)).toBe(false);
    // Still one fixture: the legs 1.5 m apart, the panel between them.
    const [a, b, f] = r.pieces;
    expect(Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1])).toBeCloseTo(1.5, 6);
    expect(f.at[0]).toBeCloseTo((a.at[0] + b.at[0]) / 2, 6);
    const rep = checkPoles(world(r.pieces));
    expect(rep.poles).toBe(2);
    expect(rep.polesOnRoad).toEqual([]);
  });

  it("follows the ground at the new spot", () => {
    const slope = (x: number) => 10 + (x - 300) * 0.1;
    const pieces = pylon([310.05, 8]).map((p) => (p.kind === "box" ? { ...p, z0: slope(p.at[0]) - SINK } : p));
    const r = clearPieces(pieces, onRoad, (x) => slope(x));
    for (const p of r.pieces) if (p.kind === "box") expect(p.z0).toBeCloseTo(slope(p.at[0]) - SINK, 6);
  });

  it("leaves clear fixtures alone and drops one with nowhere to go", () => {
    const clear = pylon([100, 20]);
    const stuck = [post([300, 40], 0.065, 2.9)]; // mid-street, 4 m from either edge
    const r = clearPieces([...clear, ...stuck], onRoad, flat, 3);
    expect(r.pieces).toEqual(clear);
    expect(r.dropped).toBe(1);
    expect(r.moved).toBe(0);
  });

  it("does nothing without an on-road test (poleClear off)", () => {
    const pieces = pylon([300, 30]);
    expect(clearPieces(pieces, undefined, flat).pieces).toBe(pieces);
  });
});
