// Golden replay for runBuild: with every service stubbed, the rewritten pipeline must ask the
// services for the same things (boxes, options, chains: these become request URLs) and hand
// buildTrack the same sources as the old one did. Recorded from the old module before it was
// deleted (test/fixtures/golden-services/pipeline.json); deliberate fixes are applied to the golden below.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PIPE_CASES, pipeMocks, runCase } from "./helpers/pipelineHarness";

vi.mock("../src/services/osm", () => pipeMocks.osm);
vi.mock("../src/services/vectorTiles", () => pipeMocks.vectorTiles);
vi.mock("../src/services/tiles", () => pipeMocks.tiles);
vi.mock("../src/services/mapillary", () => pipeMocks.mapillary);
vi.mock("../src/services/landcover", () => pipeMocks.landcover);
vi.mock("../src/services/raster", () => pipeMocks.raster);
vi.mock("../src/services/art", () => pipeMocks.art);
vi.mock("../src/services/signs", () => pipeMocks.signs);
vi.mock("../src/core/track", async (orig) => ({ ...(await orig<object>()), buildTrack: pipeMocks.buildTrack }));

const golden = JSON.parse(readFileSync("test/fixtures/golden-services/pipeline.json", "utf8")) as Record<string, any>;

/** Only what reaches requests or buildTrack: helper calls made just to be thrown away don't count. */
const HELPERS = new Set(["classWidths", "roadClassLookup", "widthLookup"]);
function comparable(r: Record<string, any>) {
  const calls = Object.fromEntries(Object.entries(r.calls).filter(([k]) => !HELPERS.has(k)));
  return { ...r, events: r.events.filter((e: string) => !HELPERS.has(e)), calls };
}

/** Deliberate changes from the old pipeline (pipeline.md "Bugs to fix"). */
const FIXES: Record<string, (g: Record<string, any>) => void> = {
  // Bug 2: credits and the used lists in the sources' key order (qld, nsw, vic, wa), not arrival order.
  area_everything: (g) => {
    g.outcome.usedDem = ["nsw", "wa"];
    g.buildTrack.probe.creditsAfter.elevation = "E-nsw; E-wa";
  },
  // Bug 1: options read with their defaults, so a job without imageryZoom gets imagery (default 18).
  no_imagery_zoom_key: (g) => {
    g.buildTrack.probe.creditsAfter = { imagery: "", elevation: "" };
    g.events.splice(g.events.indexOf("loadDem") + 1, 0, "loadChunkImagery");
    g.calls.loadChunkImagery = [[{ key: "c1" }, 18, 1024, ["wa", "esri"], 0]];
    g.outcome.chunkImages = { map: ["chunkA"] };
    delete g.buildTrack.sources.imagery; // now a function, not undefined
  },
  // Bug 3: an area too large for the tiles is a warning a rebuild can't clear, not missing data.
  too_large: (g) => {
    g.outcome.missing = [];
    g.outcome.warnings = [
      "Area too large for building tiles: built without buildings, streets or shops",
      "Area too large for coast tiles: built without the sea, piers and beaches",
    ];
  },
};

describe("golden pipeline", () => {
  it("asks the services for the same things and hands buildTrack the same sources", async () => {
    const { runBuild } = await import("../src/services/pipeline");
    for (const c of PIPE_CASES) {
      const now = await runCase(runBuild as never, c);
      const g = structuredClone(golden[c.name]);
      if (g.outcome) g.outcome.warnings ??= [];
      FIXES[c.name]?.(g);
      // Mapillary now reports its tile cap through the missing-data warnings (art/options rewrite).
      for (const call of g.calls?.fetchSeen ?? []) call.push({ warn: "[fn]" });
      expect(comparable(now), c.name).toEqual(comparable(g));
    }
  });
});
