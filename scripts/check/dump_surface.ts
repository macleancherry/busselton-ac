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
// The world kn5 (<slug>/<slug>.kn5), not a layout's dummies or a layer.
const kn5Name = Object.keys(files).find((f) => { const [d, b] = f.split("/"); return b === `${d}.kn5`; }) ?? Object.keys(files).find((f) => f.endsWith(".kn5"))!;
// The main AI line (<slug>/ai/fast_lane.ai) when there is one.
const aiName = Object.keys(files).find((f) => /^[^/]+\/ai\/fast_lane\.ai$/.test(f)) ?? Object.keys(files).find((f) => f.endsWith("ai/fast_lane.ai"))!;
const model = readKn5(files[kn5Name]);
const meshes: { name: string; p: number[]; i: number[] }[] = [];
const walk = (n: Kn5Node) => {
  if (n.kind === "mesh") {
    if (/^[0-9]/.test(n.name)) meshes.push({ name: n.name, p: Array.from(n.positions), i: Array.from(n.indices) });
  } else n.children.forEach(walk);
};
walk(model.root);
type AiPoint = { position: number[]; forward: number[]; distance: number; radius: number };
const line = (name: string) => (readFastLaneAi(files[name]) as unknown as AiPoint[]).map((p) => ({ position: p.position, forward: p.forward, distance: p.distance, radius: p.radius }));
const ai = line(aiName);
// Each layout's own AI line (<slug>/<layout>/ai/fast_lane.ai), for a map with several layouts.
const layouts: Record<string, ReturnType<typeof line>> = {};
for (const f of Object.keys(files)) {
  const m = f.match(/^[^/]+\/([^/]+)\/ai\/fast_lane\.ai$/);
  if (m) layouts[m[1]] = line(f);
}
// networkCore builds: roundabouts are junction surfaces (1ROAD_J / 1STREET_J, grouped), not 1ROAD_RB<k>
// rings, so their circles come from network/junctions.json, in AC coordinates (x, z = -local y).
const netName = Object.keys(files).find((f) => /^[^/]+\/network\/junctions\.json$/.test(f));
const roundabouts: { x: number; z: number; r: number }[] = [];
if (netName) {
  const info = JSON.parse(new TextDecoder().decode(files[netName])) as { junctions?: { kind: string; ring?: { c: [number, number]; rOut: number } }[] };
  for (const j of info.junctions ?? []) if (j.kind === "roundabout" && j.ring) roundabouts.push({ x: j.ring.c[0], z: -j.ring.c[1], r: j.ring.rOut });
}
writeFileSync(outPath, JSON.stringify({ meshes, ai, layouts, ...(netName ? { roundabouts } : {}) }));
console.log(`${meshes.length} drivable meshes, ${ai.length} AI points${Object.keys(layouts).length ? `, layouts ${Object.keys(layouts).join(", ")}` : ""} -> ${outPath}`);
