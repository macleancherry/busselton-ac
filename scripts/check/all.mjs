// Every build check on one build, with a short summary (and JSON for comparing builds).
//
//   node scripts/check/all.mjs <slug> [--json out/<slug>.checks.json]
//
// Runs: check_build (spikes, heights), budget, layout_check (when it has layouts), dump_surface then
// surface_check and street_ground, path_ground, ground_check (placed things on the ground, parked cars
// off the roads), parked_check (parked cars in bays, on asphalt, not overlapping), traffic_check (when it has traffic). Exits non-zero if any fails.
// The headline numbers (triangles, AI off the road per layout, tilt, edge steps, ground through
// streets, traffic loose ends) go in the JSON, so scripts/upgrade/base.mjs can compare two builds.

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { readFileSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const slug = process.argv[2];
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
const zip = join(root, "out", `${slug}.zip`);
if (!existsSync(zip)) throw new Error(`no out/${slug}.zip`);
const names = Object.keys(unzipSync(new Uint8Array(readFileSync(zip)), { filter: (f) => !f.name.endsWith(".kn5") || /layout_/.test(f.name) }));

const run = (label, cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { label, ok: r.status === 0, text };
};
const results = [];
const num = (text, re) => { const m = text.match(re); return m ? Number(m[1].replace(/,/g, "")) : null; };
const summary = { slug, when: new Date().toISOString() };

let r = run("build", "python3", ["-I", "scripts/check/check_build.py", `out/${slug}.centreline.json`]);
results.push(r);
summary.demWithin95 = num(r.text, /95% within ([\d.]+) m/);
summary.spikes = /no hairpin spikes/.test(r.text) ? 0 : 1;

r = run("budget", "npx", ["tsx", "scripts/check/budget.ts", `out/${slug}.zip`]);
results.push(r);
summary.triangles = num(r.text, /triangles ([\d,]+)/);
summary.drawCalls = num(r.text, /draw calls\) ([\d,]+)/);

if (names.some((n) => /layout_[^/]+\.kn5$/.test(n))) {
  r = run("layouts", "npx", ["tsx", "scripts/check/layout_check.ts", `out/${slug}.zip`]);
  results.push(r);
  summary.aiOffRoad = Object.fromEntries([...r.text.matchAll(/^(\w+): .*AI line \d+ points, ([\d.]+)% off the road/gm)].map((m) => [m[1], Number(m[2])]));
}

r = run("surface dump", "npx", ["tsx", "scripts/check/dump_surface.ts", `out/${slug}.zip`, `out/${slug}.surface.json`]);
results.push(r);
r = run("surface", "python3", ["-I", "scripts/check/surface_check.py", `out/${slug}.surface.json`]);
results.push(r);
summary.maxTilt = num(r.text, /cross-slope 95% [\d.]+%, max ([\d.]+)%/);
summary.edgeMedianCm = num(r.text, /biggest step within 12 m of the line: median ([\d.]+) cm/);
summary.kinks10 = num(r.text, />10 cm (\d+)/);
r = run("streets", "python3", ["-I", "scripts/check/street_ground.py", `out/${slug}.surface.json`]);
results.push(r);
summary.groundThroughStreetsCm = num(r.text, /worst ([\d.]+) cm/);
r = run("paths", "python3", ["-I", "scripts/check/path_ground.py", `out/${slug}.surface.json`]);
results.push(r);
r = run("ground", "npx", ["tsx", "scripts/check/ground_check.ts", `out/${slug}.zip`]);
results.push(r);
summary.offGround = num(r.text, /off the ground \(over \d+ cm\): (\d+)/);
summary.parkedOnRoad = num(r.text, /parked cars on a road: (\d+)/);
r = run("parked", "npx", ["tsx", "scripts/check/parked_check.ts", `out/${slug}.zip`]);
results.push(r);
summary.parkedOverlapping = num(r.text, /overlapping cars: (\d+)/);
summary.parkedOffAsphalt = num(r.text, /cars off asphalt: (\d+)/);
summary.parkedOutsideBays = num(r.text, /cars outside bays: (\d+)/);

if (names.some((n) => n.endsWith("traffic.json"))) {
  r = run("traffic", "python3", ["-I", "scripts/check/traffic_check.py", `out/${slug}.zip`, `out/${slug}.surface.json`]);
  results.push(r);
  summary.trafficOverlaps = num(r.text, /overlapping intersections: (\d+)/);
  summary.trafficLooseEnds = num(r.text, /lane ends outside any intersection: (\d+)/);
}

summary.passed = results.every((x) => x.ok);
summary.failed = results.filter((x) => !x.ok).map((x) => x.label);
for (const x of results) console.log(`${x.ok ? "ok  " : "FAIL"} ${x.label}`);
console.log(JSON.stringify(summary, null, 1));
if (jsonOut) writeFileSync(resolve(root, jsonOut), JSON.stringify({ ...summary, output: Object.fromEntries(results.map((x) => [x.label, x.text.slice(-4000)])) }, null, 1));
process.exit(summary.passed ? 0 : 1);
