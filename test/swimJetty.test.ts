import { describe, expect, it } from "vitest";
import { buildPiers, jettyLights, pierDeckZ, SEA_LEVEL, SeaMask, withSeabed, type CoastPolygon } from "../src/core/coast";
import { buildSwimJetties, classifyPiers, deckZByKind, DECK_ABOVE_WATER, lowDeckZ, MAJOR_LENGTH, pierShape, type PierKind } from "../src/core/swimJetty";
import type { Kn5MeshNode } from "../src/core/kn5";
import fixture from "./fixtures/busselton_piers.json";

// The real Busselton Jetty and the U-shaped swimming jetty beside it (OSM), in local metres.
const [lng0, lat0] = fixture.origin;
const K = 111_195;
const local = ([lng, lat]: number[]): [number, number] => [(lng - lng0) * K * Math.cos((lat0 * Math.PI) / 180), (lat - lat0) * K];
const poly = (ring: number[][]): CoastPolygon => ({ rings: [ring.map(local)], edge: [ring.map(() => true)] });
const jetty = poly(fixture.jetty.ring);
const swim = poly(fixture.swim.ring);
// The beach runs east-west just south of where the swimming jetty's legs come ashore; sea to the north.
const shoreY = local([lng0, -33.6444])[1];
const ocean: CoastPolygon = { rings: [[[-3000, shoreY], [3000, shoreY], [3000, 3000], [-3000, 3000]]], edge: [[true, true, true, true]] };
const sea = new SeaMask([ocean], -3200, -400, 3200, 3200);
const ground = withSeabed((_x, y) => (y < shoreY ? 0.8 + (shoreY - y) * 0.02 : 0), sea);

/** Mesh stats, with a checksum of every position to the millimetre. */
function stats(meshes: Kn5MeshNode[]) {
  return meshes.map((m) => {
    let h = 2166136261, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < m.positions.length; i++) {
      h = Math.imul(h ^ Math.round(m.positions[i] * 1000), 16777619) >>> 0;
      if (i % 3 === 1) { lo = Math.min(lo, m.positions[i]); hi = Math.max(hi, m.positions[i]); }
    }
    return { name: m.name, material: m.material, verts: m.positions.length / 3, tris: m.indices.length / 3, lo: +lo.toFixed(2), hi: +hi.toFixed(2), hash: h };
  });
}

const heights = (m: Kn5MeshNode) => Array.from(m.positions).filter((_, i) => i % 3 === 1);

describe("pier kinds", () => {
  it("measures a pier's length and strip width", () => {
    const j = pierShape([jetty]), s = pierShape([swim]);
    expect(j.length).toBeGreaterThan(1700);
    expect(s.length).toBeGreaterThan(90);
    expect(s.length).toBeLessThan(MAJOR_LENGTH);
    // The swimming jetty's walkway is about 3 m wide (its bounding box is 55 m).
    expect(s.width).toBeGreaterThan(2);
    expect(s.width).toBeLessThan(4);
  });

  it("calls the Busselton Jetty major and the swimming jetty beside it swim", () => {
    expect(classifyPiers([jetty, swim])).toEqual(["major", "swim"]);
    expect(classifyPiers([jetty, swim], [{ id: fixture.jetty.id }, { id: fixture.swim.id }])).toEqual(["major", "swim"]);
  });

  it("sorts by tags first, then size", () => {
    const sq = (w: number, l: number): CoastPolygon => ({ rings: [[[0, 0], [w, 0], [w, l], [0, l]]], edge: [[true, true, true, true]] });
    expect(classifyPiers([sq(3, 40)])).toEqual(["swim"]);
    expect(classifyPiers([sq(3, 160)])).toEqual(["major"]);
    expect(classifyPiers([sq(12, 40)])).toEqual(["major"]); // a wide wharf
    expect(classifyPiers([sq(3, 40)], [{ floating: true }])).toEqual(["pontoon"]);
    expect(classifyPiers([sq(3, 160)], [{ floating: true }])).toEqual(["pontoon"]);
    expect(classifyPiers([sq(12, 40)], [{ name: "Old Swimming Jetty" }])).toEqual(["swim"]);
    expect(classifyPiers([sq(3, 20)], [{ name: "Marina Pontoon" }])).toEqual(["pontoon"]);
  });

  it("lets a route override any pier by OSM id", () => {
    const over: Record<string, PierKind> = { [fixture.swim.id]: "pontoon", [fixture.jetty.id]: "swim" };
    expect(classifyPiers([jetty, swim], [{ id: fixture.jetty.id }, { id: fixture.swim.id }], over)).toEqual(["swim", "pontoon"]);
    // Unknown values are ignored.
    expect(classifyPiers([swim], [{ id: fixture.swim.id }], { [fixture.swim.id]: "tall" as PierKind })).toEqual(["swim"]);
  });

  it("measures the pieces of a pier split by a tile seam together", () => {
    // A 280 m pier cut in two 140 m halves at a seam: each half alone is under the limit.
    const a: CoastPolygon = { rings: [[[0, 0], [3, 0], [3, 140], [0, 140]]], edge: [[true, false, true, true]] };
    const b: CoastPolygon = { rings: [[[0, 140], [3, 140], [3, 280], [0, 280]]], edge: [[true, true, true, false]] };
    expect(classifyPiers([a, b])).toEqual(["swim", "swim"]);
    expect(classifyPiers([a, b], [{ id: 7 }, { id: 7 }])).toEqual(["major", "major"]);
  });
});

describe("swimming jetty", () => {
  const meshes = buildSwimJetties([jetty, swim], ["major", "swim"], ground, sea);
  const deck = meshes.find((m) => m.name === "JETTY_SWIM_DECK")!;

  it("builds only the low piers, in their own meshes", () => {
    expect(meshes.map((m) => m.name).sort()).toEqual(["JETTY_SWIM_DECK", "JETTY_SWIM_LADDER_000", "JETTY_SWIM_TIMBER_000"]);
    expect(deck.material).toBe("jetty_deck");
    // Nothing of the major jetty (it reaches 1.7 km out; AC z = -north).
    for (const m of meshes) for (let i = 2; i < m.positions.length; i += 3) expect(-m.positions[i]).toBeLessThan(200);
  });

  it("lays the deck about half a metre over the water, never in it", () => {
    expect(DECK_ABOVE_WATER.swim).toBeGreaterThanOrEqual(0.4);
    expect(DECK_ABOVE_WATER.swim).toBeLessThanOrEqual(0.6);
    const over = [] as number[];
    for (let i = 0; i < deck.positions.length; i += 3) {
      const x = deck.positions[i], y = -deck.positions[i + 2], z = deck.positions[i + 1];
      expect(z).toBeGreaterThan(SEA_LEVEL + 0.3);
      if (sea.has(x, y)) over.push(z);
      else expect(z).toBeGreaterThanOrEqual(ground(x, y) + 0.15); // on the sand where it comes ashore
    }
    expect(over.length).toBeGreaterThan(20);
    for (const z of over) expect(z).toBeCloseTo(SEA_LEVEL + DECK_ABOVE_WATER.swim, 5);
  });

  it("stands on piles down to the seabed, with ladders into the water and no handrails", () => {
    const timber = meshes.find((m) => m.name.startsWith("JETTY_SWIM_TIMBER"))!;
    expect(Math.min(...heights(timber))).toBeLessThan(-1.5);
    // Nothing timber higher than the deck: no rails or posts.
    expect(Math.max(...heights(timber))).toBeLessThanOrEqual(Math.max(...heights(deck)) + 1e-4);
    const ladders = meshes.find((m) => m.name.startsWith("JETTY_SWIM_LADDER"))!;
    expect(ladders.material).toBe("steel");
    const hs = heights(ladders);
    expect(Math.min(...hs)).toBeLessThan(SEA_LEVEL - 0.5);
    expect(Math.max(...hs)).toBeCloseTo(SEA_LEVEL + DECK_ABOVE_WATER.swim + 0.9, 3);
    // About one ladder per 40 m of edge (the U has ~480 m of edge): 4 stiles + 2 grabs + rungs each.
    expect(ladders.positions.length / 3 / 20).toBeGreaterThan(40);
  });

  it("floats a pontoon just above the water", () => {
    const [p] = buildSwimJetties([swim], ["pontoon"], ground, sea).filter((m) => m.name === "JETTY_SWIM_DECK");
    for (let i = 0; i < p.positions.length; i += 3) {
      const x = p.positions[i], y = -p.positions[i + 2];
      if (sea.has(x, y)) expect(p.positions[i + 1]).toBeCloseTo(SEA_LEVEL + DECK_ABOVE_WATER.pontoon, 5);
    }
    const names = buildSwimJetties([swim], ["pontoon"], ground, sea).map((m) => m.name);
    expect(names).toContain("JETTY_PONTOON_FLOAT_000");
    expect(names).not.toContain("JETTY_SWIM_LADDER_000");
  });

  it("gives things standing on a jetty the right deck height", () => {
    const z = deckZByKind([jetty, swim], ["major", "swim"], pierDeckZ(ground, sea), ground, sea);
    const onSwim = local([115.34313, -33.64369]); // the far side of the U
    const onJetty = local([115.341, -33.638]);
    expect(z(...onSwim)).toBeCloseTo(lowDeckZ("swim", ground, sea)(...onSwim));
    expect(z(...onSwim)).toBeCloseTo(SEA_LEVEL + 0.5);
    expect(z(...onJetty)).toBeCloseTo(SEA_LEVEL + 3.6);
  });
});

describe("the Busselton Jetty is unchanged", () => {
  it("builds exactly the same deck, timbers and lamps (golden)", () => {
    const got = { piers: stats(buildPiers([jetty], ground, sea)), lamps: stats(jettyLights([jetty], ground, sea).nodes), lights: jettyLights([jetty], ground, sea).lights.length };
    expect(got).toEqual(GOLDEN);
  });
});

// From coast.ts as accepted on 31 Oct 2026, before the swimming jetties: buildPiers and jettyLights untouched.
const GOLDEN = {
  piers: [
    { name: "JETTY_DECK", material: "jetty_deck", verts: 62, tris: 60, lo: 3.85, hi: 3.85, hash: 4194733440 },
    { name: "JETTY_TIMBER_000", material: "jetty_timber", verts: 65440, tris: 32720, lo: 3.4, hi: 4.95, hash: 1698491426 },
    { name: "JETTY_TIMBER_001", material: "jetty_timber", verts: 45580, tris: 22790, lo: -2, hi: 4.95, hash: 1941433931 },
  ],
  lamps: [
    { name: "JETTY_LAMPPOST_000", material: "steel", verts: 1680, tris: 840, lo: 3.85, hi: 7.45, hash: 2887444018 },
    { name: "JETTY_LAMP_000", material: "lamp", verts: 1680, tris: 840, lo: 7.45, hi: 7.85, hash: 2538307338 },
  ],
  lights: 84,
};
