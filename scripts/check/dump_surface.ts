// Dump a build's physics meshes (names starting with a digit: road, street, kerb, grass, walls) and its AI line
// for scripts/check/surface_check.py.
//
//   npx tsx scripts/check/dump_surface.ts out/<slug>.zip out/<slug>.surface.json

import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { readKn5, type Kn5Node } from "../../src/core/kn5";
import { readFastLaneAi } from "../../src/core/aiSpline";

const [zipPath, outPath] = process.argv.slice(2);
const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
const kn5Name = Object.keys(files).find((f) => f.endsWith(".kn5"))!;
const aiName = Object.keys(files).find((f) => f.endsWith("ai/fast_lane.ai"))!;
const model = readKn5(files[kn5Name]);
const meshes: { name: string; p: number[]; i: number[] }[] = [];
const walk = (n: Kn5Node) => {
  if (n.kind === "mesh") {
    if (/^[0-9]/.test(n.name)) meshes.push({ name: n.name, p: Array.from(n.positions), i: Array.from(n.indices) });
  } else n.children.forEach(walk);
};
walk(model.root);
const ai = readFastLaneAi(files[aiName]) as unknown as { position: number[]; forward: number[]; distance: number; radius: number }[];
writeFileSync(outPath, JSON.stringify({ meshes, ai: ai.map((p) => ({ position: p.position, forward: p.forward, distance: p.distance, radius: p.radius })) }));
console.log(`${meshes.length} drivable meshes, ${ai.length} AI points -> ${outPath}`);
