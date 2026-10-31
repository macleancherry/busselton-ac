// Golden files: the rewritten cameras.ts, acFiles.ts and cspConfig.ts reproduce what the old modules wrote.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { goldenOutputs } from "./goldenAcFiles";

const DIR = "test/fixtures/golden";

describe("golden track folder files", () => {
  const outputs = goldenOutputs();
  it("has an output for every fixture and a fixture for every output", () => {
    expect(Object.keys(outputs).sort()).toEqual(readdirSync(DIR).sort());
  });
  for (const name of Object.keys(outputs)) {
    it(`reproduces ${name} byte for byte`, () => {
      expect(outputs[name]).toBe(readFileSync(`${DIR}/${name}`, "utf8"));
    });
  }
});
