// Is everything placed standing on the ground? (src/core/groundCheck.ts)
//   npx tsx scripts/check/ground_check.ts out/<slug>.zip [--tolerance 0.05] [--json out/<slug>.ground.json]
//
// Reads the track's main kn5 from the zip. Fails when any placed piece (furniture, traffic lights,
// trees, buildings, shops, fences, farm, paths, lots, posts, parked cars) has its whole base more than
// the tolerance (5 cm) over or under the base's ground meshes, or a parked car is over the route's road.
import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { readKn5 } from "../../src/core/kn5";
import { checkGround } from "../../src/core/groundCheck";

const args = process.argv.slice(2);
const zipPath = args.find((a) => !a.startsWith("--") && a.endsWith(".zip"));
if (!zipPath) throw new Error("usage: ground_check.ts <zip> [--tolerance m] [--json file]");
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const tolerance = Number(opt("--tolerance") ?? 0.05);

const isMain = (f: string) => { const [d, b] = f.split("/"); return b === `${d}.kn5`; };
const files = unzipSync(new Uint8Array(readFileSync(zipPath)), { filter: (f) => isMain(f.name) });
const name = Object.keys(files).find(isMain);
if (!name) throw new Error(`no <slug>/<slug>.kn5 in ${zipPath}`);
const model = readKn5(files[name]);
const r = checkGround(model.root, { tolerance });

const total = Object.values(r.checked).reduce((a, b) => a + b, 0);
console.log(`pieces over the ground: ${total} (${Object.entries(r.checked).map(([g, n]) => `${g} ${n}`).join(", ")})`);
const by = new Map<string, { floating: number; sunk: number; worst: number }>();
for (const o of r.off) {
  const e = by.get(o.group) ?? { floating: 0, sunk: 0, worst: 0 };
  e[o.kind]++;
  if (Math.abs(o.off) > Math.abs(e.worst)) e.worst = o.off;
  by.set(o.group, e);
}
for (const [g, e] of by) console.log(`  ${g.padEnd(14)} floating ${e.floating}, sunk ${e.sunk}, worst ${(e.worst * 100).toFixed(0)} cm`);
const worst = r.off.slice().sort((a, b) => Math.abs(b.off) - Math.abs(a.off)).slice(0, 20);
for (const o of worst) console.log(`  ${o.kind.padEnd(8)} ${(o.off * 100).toFixed(0).padStart(5)} cm  ${o.mesh.padEnd(28)} at x ${o.x.toFixed(1)}, z ${o.z.toFixed(1)}`);
for (const c of r.parkedOnRoad.slice(0, 20)) console.log(`  parked car on a road at x ${c.x.toFixed(1)}, z ${c.z.toFixed(1)}`);
console.log(`off the ground (over ${(tolerance * 100).toFixed(0)} cm): ${r.off.length}`);
console.log(`parked cars on a road: ${r.parkedOnRoad.length}`);
const json = opt("--json");
if (json) writeFileSync(json, JSON.stringify({ tolerance, checked: r.checked, off: r.off, parkedOnRoad: r.parkedOnRoad }, null, 1));
process.exit(r.off.length || r.parkedOnRoad.length ? 1 : 0);
