// Checks the course markings (src/core/courseMarks.ts) in a build with layouts.
//   npx tsx scripts/check/course_marks_check.ts out/<slug>.zip
// For each layout with markings (<id>/data/course_marks.json):
//   - every opening in the course's kerb line (found from the world's surface alone) is the course
//     or has a ripple strip across it, and every roundabout arm the course passes and doesn't use
//     has one (course_marks_lib.ts);
//   - nothing but paint (grid boxes, the start line) and the arch's beam lies on the AI line, half a
//     car's width either side included; the arch posts stand off the road;
//   - the layout has no traffic.json (CSP traffic would drive through the barriers).
// And no layout without markings (free roam) has any. Exits non-zero on any failure.
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { readFastLaneAi } from "../../src/core/aiSpline";
import { MARK_MESH, surfaceProbe } from "../../src/core/courseMarks";
import { readKn5, type Kn5MeshNode, type Kn5Node } from "../../src/core/kn5";
import { checkLayoutMarks } from "./course_marks_lib";

const files = unzipSync(new Uint8Array(readFileSync(process.argv[2])));
const slug = Object.keys(files)[0].split("/")[0];
const layouts = Object.keys(files).map((f) => f.match(/\/models_([^/]+)\.ini$/)?.[1]).filter((x): x is string => !!x);
if (!layouts.length) {
  console.log("one layout only: nothing to check");
  process.exit(0);
}
const meshes = (n: Kn5Node): Kn5MeshNode[] => (n.kind === "mesh" ? [n] : n.children.flatMap(meshes));
let probe: ReturnType<typeof surfaceProbe> | null = null;
let bad = 0;
const fmt = (q: [number, number][]) => q.slice(0, 6).map((p) => `x ${p[0].toFixed(0)} z ${(-p[1]).toFixed(0)}`).join("; ");
for (const id of layouts) {
  const kn5 = files[`${slug}/layout_${id}.kn5`];
  if (!kn5) continue;
  const list = meshes(readKn5(kn5).root);
  const marks = list.filter((m) => MARK_MESH.test(m.name));
  const json = files[`${slug}/${id}/data/course_marks.json`];
  if (!json) {
    console.log(`${id}: no course markings${marks.length ? `, but ${marks.length} marking meshes` : ""}`);
    if (marks.length) bad++;
    continue;
  }
  const summary = JSON.parse(new TextDecoder().decode(json));
  const ai = files[`${slug}/${id}/ai/fast_lane.ai`];
  if (!ai) { console.log(`${id}: course markings but no AI line`); bad++; continue; }
  probe ??= surfaceProbe(readKn5(files[`${slug}/${slug}.kn5`]));
  const r = checkLayoutMarks(readFastLaneAi(ai), list, probe, summary.rings ?? []);
  const traffic = !!files[`${slug}/${id}/data/traffic.json`];
  const tris = marks.reduce((s, m) => s + m.indices.length / 3, 0);
  console.log(`${id}: ${marks.length} marking meshes, ${tris} triangles; openings ${r.openings}, without a strip: ${r.open.length}; ring arms closed ${r.ringArms}, without a strip: ${r.ringOpen.length}; roads alongside ${r.alongside}; marks on the AI line: ${r.onLine.length}; arch posts on the road: ${r.postsOnRoad.length}; traffic: ${traffic ? "yes" : "no"}`);
  if (r.open.length) console.log(`   open: ${fmt(r.open)}`);
  if (r.ringOpen.length) console.log(`   ring arms open: ${fmt(r.ringOpen)}`);
  if (r.onLine.length) console.log(`   on the line: ${fmt(r.onLine)}`);
  if (r.postsOnRoad.length) console.log(`   posts on the road: ${fmt(r.postsOnRoad)}`);
  if (r.open.length || r.ringOpen.length || r.onLine.length || r.postsOnRoad.length || traffic) bad++;
}
process.exit(bad ? 1 : 0);
