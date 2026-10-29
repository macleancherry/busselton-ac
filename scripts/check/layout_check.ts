// Checks a map with several layouts: every layout's spawn and timing dummies and its AI line sit on
// the shared world's road surface.
//   npx tsx scripts/check/layout_check.ts out/<slug>.zip
// Exits non-zero if a spawn is off the road, or more than 2% of an AI line is.
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { readKn5, type Kn5GroupNode } from "../../src/core/kn5";
import { surfaceHeight } from "../../src/core/layouts";
import { readFastLaneAi } from "../../src/core/aiSpline";

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
    for (const p of pts) {
      const g = height(p.position[0], -p.position[2]);
      if (g === null) miss++;
      else worst = Math.max(worst, Math.abs(p.position[1] - g));
    }
    line += `; AI line ${pts.length} points, ${(100 * miss / pts.length).toFixed(1)}% off the road, worst height gap ${worst.toFixed(2)} m`;
    if (miss / pts.length > 0.02) bad++;
  } else {
    line += "; no AI line";
  }
  console.log(line);
}
process.exit(bad ? 1 : 0);
