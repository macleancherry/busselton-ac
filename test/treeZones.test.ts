import { describe, expect, it } from "vitest";
import { CARD_FOR, MODEL_FOR, pickWeighted, speciesWeightsAt, type NativeSpecies, type SpeciesWeights } from "../src/core/treeZones";
import { MODEL_NAMES } from "../src/core/treeModels";
import { TREE_SPECIES } from "../src/core/treeSprites";

const top = (w: SpeciesWeights) => (Object.entries(w) as [NativeSpecies, number][]).sort((a, b) => b[1] - a[1])[0][0];

describe("tree zones", () => {
  it("weights always sum to 1 and are never negative", () => {
    for (let lat = -35; lat <= -33; lat += 0.13) for (let lng = 114.9; lng <= 117; lng += 0.17) {
      const w = speciesWeightsAt(lng, lat);
      const sum = Object.values(w).reduce((a, v) => a + (v ?? 0), 0);
      expect(sum).toBeCloseTo(1, 6);
      for (const v of Object.values(w)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("puts karri around Boranup and the southern forest", () => {
    expect(top(speciesWeightsAt(115.07, -34.13))).toBe("karri"); // Boranup forest, on Caves Road
    expect(top(speciesWeightsAt(116.03, -34.45))).toBe("karri"); // Pemberton
    expect(speciesWeightsAt(115.07, -34.13).karri).toBeGreaterThan(0.6);
  });

  it("no karri north of Margaret River or on the coastal plain", () => {
    expect(speciesWeightsAt(115.1, -33.8).karri ?? 0).toBeLessThan(0.02); // Leeuwin ridge, north of Margaret River
    expect(speciesWeightsAt(115.4, -33.68).karri ?? 0).toBeLessThan(0.01); // behind Busselton
  });

  it("marri and jarrah inland, tuart on the coastal plain, peppermint on the coast", () => {
    const inland = speciesWeightsAt(115.6, -33.95); // Blackwood Plateau
    expect((inland.marri ?? 0) + (inland.jarrah ?? 0)).toBeGreaterThan(0.85);
    expect(top(speciesWeightsAt(115.42, -33.69))).toBe("tuart"); // Vasse / Ludlow side of the plain
    expect(top(speciesWeightsAt(115.35, -33.648))).toBe("peppermint"); // Busselton beachfront
    expect(top(speciesWeightsAt(115.02, -33.7))).toBe("peppermint"); // capes west coast
    expect(top(speciesWeightsAt(115.6, -33.95, { coastal: true }))).toBe("peppermint"); // water seen in the photo
  });

  it("blends across a zone edge instead of switching", () => {
    // Walking south from the plain over the Whicher Scarp, tuart fades out over a few km.
    const lats = [-33.7, -33.72, -33.74, -33.76, -33.78];
    const tuart = lats.map((lat) => speciesWeightsAt(115.4, lat).tuart ?? 0);
    for (let i = 1; i < tuart.length; i++) expect(tuart[i]).toBeLessThan(tuart[i - 1]);
    expect(tuart[0] - tuart[4]).toBeGreaterThan(0.3);
    for (let i = 1; i < tuart.length; i++) expect(tuart[i - 1] - tuart[i]).toBeLessThan(0.3);
  });

  it("picks by weight", () => {
    const w: SpeciesWeights = { karri: 0.7, marri: 0.2, peppermint: 0.1 };
    const n: Record<string, number> = { karri: 0, marri: 0, peppermint: 0 };
    for (let i = 0; i < 1000; i++) n[pickWeighted(w, (i + 0.5) / 1000)]++;
    expect(n.karri).toBe(700);
    expect(n.marri).toBe(200);
    expect(n.peppermint).toBe(100);
    expect(pickWeighted({}, 0.5)).toBe("peppermint");
    expect(pickWeighted({ tuart: 1 }, 0.9999)).toBe("tuart");
  });

  it("every species has a model and a card", () => {
    for (const s of Object.keys(MODEL_FOR) as NativeSpecies[]) {
      expect(MODEL_NAMES).toContain(MODEL_FOR[s]);
      expect(TREE_SPECIES[CARD_FOR[s]]).toBeTruthy();
    }
    expect(MODEL_FOR.karri).toBe("karri");
    expect(MODEL_FOR.marri).toBe("marri");
  });
});
