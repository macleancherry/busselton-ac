import { describe, expect, it } from "vitest";
import { buildJettyPrecinct } from "../src/core/jetty";

// A straight jetty 6 m wide running north 400 m, with a wider deck at each end.
const onJetty = (x: number, y: number) => (y >= 0 && y <= 400 && Math.abs(x) <= 3) || (y >= 20 && y <= 50 && x >= -3 && x <= 20) || (y >= 380 && y <= 400 && Math.abs(x) <= 12);
const deck = () => 3.85;

describe("jetty precinct", () => {
  it("builds the rails, platforms, sheds, observatory and train on the deck", () => {
    const p = buildJettyPrecinct({
      railways: [[[1.5, -50], [1.5, 400]]],
      platforms: [{ pts: [[-2.5, 30], [-2.5, 45]], shelter: true }, { pts: [[-2.5, 385], [-2.5, 398]], shelter: false }],
      buildings: [
        { pts: [[4, 22], [19, 22], [19, 48], [4, 48]], name: "Busselton Jetty" },
        { pts: [[3, 385], [11, 385], [11, 393], [3, 393]], name: "Underwater Observatory" },
        { pts: [[200, 200], [210, 200], [210, 210], [200, 210]], name: "Somewhere on shore" },
      ],
    }, deck, onJetty, 0.25);
    const names = p.nodes.map((n) => n.name);
    expect(names).toEqual(expect.arrayContaining(["JETTY_RAIL_000", "JETTY_SLEEPERS_000", "JETTY_PLATFORMS", "JETTY_SHELTER_ROOF", "JETTY_SHEDS", "JETTY_SHED_ROOFS", "JETTY_OBSERVATORY", "JETTY_OBSERVATORY_DRUM", "JETTY_TRAIN"]));
    // Only the two on the jetty are taken over from the generic buildings.
    expect(p.footprints).toHaveLength(2);
    // Rails only on the deck (not the 50 m on land), at deck height.
    const rail = p.nodes.find((n) => n.name === "JETTY_RAIL_000")!;
    let minZ = Infinity, maxSouth = -Infinity;
    for (let i = 0; i < rail.positions.length; i += 3) {
      minZ = Math.min(minZ, rail.positions[i + 1]);
      maxSouth = Math.max(maxSouth, rail.positions[i + 2]);
    }
    expect(minZ).toBeGreaterThan(3.8);
    expect(maxSouth).toBeLessThan(1); // AC z = -north: nothing south of the jetty's start
    // Four or so sheds across a 26 m long outline.
    const roofs = p.nodes.find((n) => n.name === "JETTY_SHED_ROOFS")!;
    expect(roofs.indices.length / 6).toBeGreaterThanOrEqual(6);
  });
});
