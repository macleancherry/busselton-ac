// Do the traffic lanes keep clear of the painted kerbside bays? (src/core/bayLanes.ts)
//   npx tsx scripts/check/lane_bay_check.ts out/<slug>.zip
//
// Reads the bay paint (KERBSIDE_BAY_* meshes) from the track's main kn5 and the lanes from
// data/traffic.json (the first one: every layout's has the same lanes). Fails when a car on a lane
// (1 m either side of its centreline) would run over a bay's lines: the lane goes through the bays.
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { readKn5, type Kn5Node } from "../../src/core/kn5";
import { lanesOverBays, LANE_BODY } from "../../src/core/bayLanes";
import type { Vec2 } from "../../src/core/geo";

const zipPath = process.argv.slice(2).find((a) => a.endsWith(".zip"));
if (!zipPath) throw new Error("usage: lane_bay_check.ts <zip>");
const isMain = (f: string) => { const [d, b] = f.split("/"); return b === `${d}.kn5`; };
const files = unzipSync(new Uint8Array(readFileSync(zipPath)), { filter: (f) => isMain(f.name) || f.name.endsWith("data/traffic.json") });
const kn5 = Object.keys(files).find(isMain);
const traffic = Object.keys(files).filter((f) => f.endsWith("data/traffic.json")).sort()[0];
if (!kn5) throw new Error(`no <slug>/<slug>.kn5 in ${zipPath}`);
if (!traffic) {
  console.log("no traffic.json: nothing to check");
  process.exit(0);
}

const meshes = (n: Kn5Node): Extract<Kn5Node, { kind: "mesh" }>[] => (n.kind === "mesh" ? [n] : n.children.flatMap(meshes));
const paint: [Vec2, Vec2, Vec2][] = [];
for (const m of meshes(readKn5(files[kn5]).root).filter((n) => /^KERBSIDE_BAY_/.test(n.name))) {
  const p = m.positions, v = (i: number): Vec2 => [p[i * 3], -p[i * 3 + 2]];
  for (let t = 0; t < m.indices.length; t += 3) paint.push([v(m.indices[t]), v(m.indices[t + 1]), v(m.indices[t + 2])]);
}
const lanes = (JSON.parse(new TextDecoder().decode(files[traffic])).lanes as { name: string; points: [number, number, number][] }[]);
const hits = lanesOverBays(lanes.map((l) => l.points.map((q) => [q[0], -q[2]] as Vec2)), paint);
console.log(`${traffic}: ${lanes.length} lanes; bay paint ${paint.length} triangles`);
const byLane = new Map<number, Vec2[]>();
for (const h of hits) (byLane.get(h.lane) ?? byLane.set(h.lane, []).get(h.lane)!).push(h.at);
for (const [li, pts] of [...byLane].slice(0, 15)) console.log(`   ${lanes[li].name}: ${pts.length} points, first at x ${pts[0][0].toFixed(1)}, z ${(-pts[0][1]).toFixed(1)}`);
console.log(`lane points over painted bays (car ${LANE_BODY} m either side): ${hits.length}`);
process.exit(hits.length ? 1 : 0);
