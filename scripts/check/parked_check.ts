// Are the parked cars in real bays? (src/core/parkedCheck.ts)
//   npx tsx scripts/check/parked_check.ts out/<slug>.zip [--json out/<slug>.parked.json]
//
// Reads the track's main kn5 from the zip. Fails when two parked cars overlap, a car has a wheel off
// asphalt (on grass, a kerb, a path or gravel), or a car is neither in a car park bay (over its pad)
// nor in a painted kerbside bay.
import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { readKn5 } from "../../src/core/kn5";
import { checkParked } from "../../src/core/parkedCheck";

const args = process.argv.slice(2);
const zipPath = args.find((a) => !a.startsWith("--") && a.endsWith(".zip"));
if (!zipPath) throw new Error("usage: parked_check.ts <zip> [--json file]");
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const isMain = (f: string) => { const [d, b] = f.split("/"); return b === `${d}.kn5`; };
const files = unzipSync(new Uint8Array(readFileSync(zipPath)), { filter: (f) => isMain(f.name) });
const name = Object.keys(files).find(isMain);
if (!name) throw new Error(`no <slug>/<slug>.kn5 in ${zipPath}`);
const r = checkParked(readKn5(files[name]).root);

const at = (x: number, z: number) => `x ${x.toFixed(1)}, z ${z.toFixed(1)}`;
console.log(`parked cars: ${r.cars}`);
for (const o of r.overlapping.slice(0, 20)) console.log(`  overlapping at ${at(...o.a)} and ${at(...o.b)}`);
const on = new Map<string, number>();
for (const c of r.offAsphalt) on.set(c.on, (on.get(c.on) ?? 0) + 1);
if (on.size) console.log(`  off asphalt by surface: ${[...on].map(([k, n]) => `${k} ${n}`).join(", ")}`);
for (const c of r.offAsphalt.slice(0, 20)) console.log(`  off asphalt (${c.on}) at ${at(c.x, c.z)}`);
for (const c of r.outsideBays.slice(0, 20)) console.log(`  outside any bay at ${at(c.x, c.z)}`);
console.log(`overlapping cars: ${r.overlapping.length}`);
console.log(`cars off asphalt: ${r.offAsphalt.length}`);
console.log(`cars outside bays: ${r.outsideBays.length}`);
const json = opt("--json");
if (json) writeFileSync(json, JSON.stringify(r, null, 1));
process.exit(r.overlapping.length || r.offAsphalt.length || r.outsideBays.length ? 1 : 0);
