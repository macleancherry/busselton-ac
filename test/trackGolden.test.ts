// The small track golden (docs/specs/track.md section 15, item 2): four synthetic builds
// (test/fixtures/trackScenes.ts), the SHA-256 of every file they write, their stats and progress.
// Captured from the code before the stage rewrite; any change to a build's bytes fails here.
// Regenerate (UPDATE_GOLDEN=1 npx vitest run test/trackGolden.test.ts) only in a commit that also
// accepts a base.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTrack } from "../src/core/track";
import { SCENES } from "./fixtures/trackScenes";

const FIXTURE = new URL("./fixtures/track-golden.json", import.meta.url);
const update = !!process.env.UPDATE_GOLDEN;
const golden: Record<string, unknown> = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : {};

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export async function goldenOf(name: keyof typeof SCENES) {
  const sc = SCENES[name];
  const progress: string[] = [];
  const r = await buildTrack(sc.route, sc.opts, sc.sources(), {}, (stage, f) => {
    if (stage !== "Fetching aerial imagery" && !(stage === "Building road and terrain meshes" && f !== undefined)) progress.push(f === undefined ? stage : `${stage} ${f}`);
  });
  return {
    // networkCore's files carry timings (B9), and CSP tree models are zips stamped with the time
    // they were made (cspTrees.ts writeTreeBin): only that they're there.
    files: Object.fromEntries(Object.entries(r.files).map(([k, v]) => [k, /\/network\/|\/extension\/trees\/.*\.bin$/.test(k) ? "present" : sha(v)])),
    stats: JSON.parse(JSON.stringify(r.stats)),
    progress,
    houses: r.houses.length,
    parked: r.parked.length,
  };
}

describe("track golden", () => {
  for (const name of Object.keys(SCENES) as (keyof typeof SCENES)[]) {
    it(`scene ${name} builds the same bytes`, { timeout: 600_000 }, async () => {
      const got = await goldenOf(name);
      if (update) {
        golden[name] = got;
        writeFileSync(FIXTURE, JSON.stringify(golden, null, 1) + "\n");
        return;
      }
      expect(golden[name], `no golden for scene ${name}: run with UPDATE_GOLDEN=1`).toBeDefined();
      const want = golden[name] as typeof got;
      expect(Object.keys(got.files)).toEqual(Object.keys(want.files));
      expect(got.files).toEqual(want.files);
      expect(got.stats).toEqual(want.stats);
      expect(got.progress).toEqual(want.progress);
      expect([got.houses, got.parked]).toEqual([want.houses, want.parked]);
    });
  }
});
