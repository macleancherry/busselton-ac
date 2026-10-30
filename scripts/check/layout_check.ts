// Checks a map with several layouts: every layout's spawn and timing dummies and its AI line sit on
// the shared world's road surface.
//   npx tsx scripts/check/layout_check.ts out/<slug>.zip [--where] [--keep-left]
// Exits non-zero if a spawn is off the road, or more than 2% of an AI line is, or a keep-left line
// (aiKeepLeft: one with more room on its right than its left; every line with --keep-left) has under
// 90% of the points where the road's middle can be told on its left half (keepLeft.ts).
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { readKn5, type Kn5GroupNode } from "../../src/core/kn5";
import { surfaceHeight } from "../../src/core/layouts";
import { readFastLaneAi } from "../../src/core/aiSpline";
import { keepLeftShare } from "../../src/core/keepLeft";

const forceKeepLeft = process.argv.includes("--keep-left");

const files = unzipSync(new Uint8Array(readFileSync(process.argv[2])));
const slug = Object.keys(files)[0].split("/")[0];
const layouts = Object.keys(files).map((f) => f.match(/\/models_([^/]+)\.ini$/)?.[1]).filter((x): x is string => !!x);
if (!layouts.length) {
  console.log("one layout only: nothing to check");
  process.exit(0);
}
const height = surfaceHeight(readKn5(files[`${slug}/${slug}.kn5`]));
let bad = 0;
for (const id of layouts) {
  const dummies = readKn5(files[`${slug}/layout_${id}.kn5`]).root.children as Kn5GroupNode[];
  const spawns = dummies.filter((d) => /^AC_(START|PIT)_/.test(d.name));
  const lifts = spawns.map((d) => {
    const t = d.transform, g = height(t[12], -t[14]);
    return g === null ? null : t[13] - g;
  });
  const off = lifts.filter((l) => l === null).length;
  const range = lifts.filter((l): l is number => l !== null);
  let line = `${id}: ${spawns.length} spawn and pit spots, ${off} off the road`;
  if (range.length) line += `, ${Math.min(...range).toFixed(2)} to ${Math.max(...range).toFixed(2)} m above it`;
  if (off) bad++;
  const ai = files[`${slug}/${id}/ai/fast_lane.ai`];
  if (ai) {
    const pts = readFastLaneAi(ai);
    let miss = 0, worst = 0;
    const runs: [number, number][] = [];
    pts.forEach((p, i) => {
      const g = height(p.position[0], -p.position[2]);
      if (g === null) {
        miss++;
        const last = runs[runs.length - 1];
        if (last && last[1] === i - 1) last[1] = i; else runs.push([i, i]);
      } else worst = Math.max(worst, Math.abs(p.position[1] - g));
    });
    // Where it leaves the road (AC x, z of the middle of each stretch), longest first.
    if (process.argv.includes("--where")) {
      for (const [a, b] of runs.sort((u, v) => v[1] - v[0] - (u[1] - u[0])).slice(0, 8)) {
        const m = pts[(a + b) >> 1].position;
        console.log(`   ${id}: points ${a}-${b} off the road around x ${m[0].toFixed(0)} z ${m[2].toFixed(0)}`);
      }
    }
    line += `; AI line ${pts.length} points, ${(100 * miss / pts.length).toFixed(1)}% off the road, worst height gap ${worst.toFixed(2)} m`;
    if (miss / pts.length > 0.02) bad++;
    // Keep left: built that way (more room right than left on a good share of the line) or asked for.
    const asym = pts.filter((p) => p.sideRight - p.sideLeft >= 0.5).length / pts.length;
    if (forceKeepLeft || asym > 0.2) {
      const k = keepLeftShare(pts, height);
      line += `; keep left: ${(100 * k.share).toFixed(0)}% of ${k.measured} measured points on the left half`;
      if (k.worst && k.share < 1) line += ` (furthest right around x ${k.worst[0].toFixed(0)} z ${k.worst[1].toFixed(0)})`;
      if (forceKeepLeft && asym <= 0.2) { line += ", but the line is centred (built without aiKeepLeft)"; bad++; }
      else if (k.measured >= 20 && k.share < 0.9) bad++;
    }
  } else {
    line += "; no AI line";
  }
  console.log(line);
}
process.exit(bad ? 1 : 0);
