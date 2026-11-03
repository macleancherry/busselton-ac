// Checks every layout's pit boxes (AC_PIT_n) and pit lane (ai/pit_lane.ai) against the AI lines.
//   npx tsx scripts/check/pit_check.ts out/<slug>.zip
//
// AC sends a stuck AI car back to its pit box, and a car in its box waits there for the pit lane.
// With the boxes on the grid's spots (on the racing line) and the pit lane the racing line itself,
// a car sent back sat on the line for good and the cars behind piled into it, were sent back in
// turn, and so on (workstation retest 6, 3 Nov 2026). So, for each layout:
//   - every AC_PIT_n is at least PIT_CHECK metres from every layout's AI line, and from every
//     AC_START_n of its own layout;
//   - every box stands on the world's ground (a physics surface under it, the box 0.1 to 1.5 m above);
//   - with a pit lane: it leaves the AI line (its furthest point at least LANE_OFF off it), it runs
//     past every box (within 3 m), and no more than PIT_ON_LINE_MAX metres of it lie on the AI line
//     (the run-in and run-out it shares with the line, not a stretch of racing line as "pit lane"),
//     and nothing of the layout's own (course markings) stands on it or on a box.
// Exits non-zero if any layout fails.
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { readKn5, type Kn5Node } from "../../src/core/kn5";
import { readFastLaneAi, type AiPoint } from "../../src/core/aiSpline";
import { groundProbe, PIT_CLEAR, standingCells } from "../../src/core/pitRow";

/** A box closer than this to an AI line (metres) fails. */
const PIT_CHECK = PIT_CLEAR - 1;
/** A pit lane reaching no further than this from the AI line never left it, metres. */
const LANE_OFF = 3;
/** Pit lane points within this of the AI line count as on it, metres. */
const ON_LINE = 2;
/** At most this many metres of a pit lane on the AI line. */
const PIT_ON_LINE_MAX = 150;

type Xyz = [number, number, number];
const files = unzipSync(new Uint8Array(readFileSync(process.argv[2])));
const slug = Object.keys(files)[0].split("/")[0];
const world = readKn5(files[`${slug}/${slug}.kn5`]);
const ground = groundProbe(world);

const dummiesOf = (root: Kn5Node): { name: string; at: Xyz }[] => {
  const out: { name: string; at: Xyz }[] = [];
  const walk = (n: Kn5Node) => {
    if (n.kind !== "node") return;
    if (/^AC_(PIT|START)_\d+$/.test(n.name)) out.push({ name: n.name, at: [n.transform[12], n.transform[13], n.transform[14]] });
    n.children.forEach(walk);
  };
  walk(root);
  return out;
};

/** Distance (x, z) from a point to a line's segments. */
function distTo(line: AiPoint[], p: Xyz, closed: boolean): number {
  let best = Infinity;
  const n = line.length;
  for (let i = 0; i < n - (closed ? 0 : 1); i++) {
    const a = line[i].position, b = line[(i + 1) % n].position;
    const dx = b[0] - a[0], dz = b[2] - a[2], L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / L2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[2] - a[2] - dz * t));
  }
  return best;
}
const isClosed = (l: AiPoint[]) => l.length > 2 && Math.hypot(l[l.length - 1].position[0] - l[0].position[0], l[l.length - 1].position[2] - l[0].position[2]) < 50;

// The layouts: models_<id>.ini, or the one track.
const ids = Object.keys(files).map((f) => f.match(/^[^/]+\/models_([^/]+)\.ini$/)?.[1]).filter((x): x is string => !!x);
const layouts = (ids.length ? ids : [""]).map((id) => {
  const base = id ? `${slug}/${id}` : slug;
  const kn5 = id ? files[`${slug}/layout_${id}.kn5`] : files[`${slug}/${slug}.kn5`];
  const ai = files[`${base}/ai/fast_lane.ai`] ? readFastLaneAi(files[`${base}/ai/fast_lane.ai`]) : [];
  const pit = files[`${base}/ai/pit_lane.ai`] ? readFastLaneAi(files[`${base}/ai/pit_lane.ai`]) : null;
  const model = id ? readKn5(kn5) : world;
  return { id: id || slug, model: id ? model : null, dummies: dummiesOf(model.root), ai, closed: isClosed(ai), pit };
});

let bad = 0;
for (const L of layouts) {
  const pits = L.dummies.filter((d) => d.name.startsWith("AC_PIT_"));
  const starts = L.dummies.filter((d) => d.name.startsWith("AC_START_"));
  const problems: string[] = [];
  let nearest = Infinity;
  for (const b of pits) {
    for (const M of layouts) {
      if (M.ai.length < 2) continue;
      const d = distTo(M.ai, b.at, M.closed);
      nearest = Math.min(nearest, d);
      if (d < PIT_CHECK) problems.push(`${b.name} ${d.toFixed(1)} m from ${M.id}'s AI line at (${b.at[0].toFixed(0)}, ${b.at[2].toFixed(0)})`);
    }
    const s = starts.reduce((m, st) => Math.min(m, Math.hypot(st.at[0] - b.at[0], st.at[2] - b.at[2])), Infinity);
    if (s < PIT_CHECK) problems.push(`${b.name} ${s.toFixed(1)} m from a grid or spawn spot`);
    const g = ground(b.at[0], b.at[2]);
    if (!g) problems.push(`${b.name} has no ground under it at (${b.at[0].toFixed(0)}, ${b.at[2].toFixed(0)})`);
    else if (b.at[1] - g.h < 0.1 || b.at[1] - g.h > 1.5) problems.push(`${b.name} ${(b.at[1] - g.h).toFixed(2)} m above the ground`);
  }
  let line = `${L.id}: ${pits.length} pit boxes, nearest ${Number.isFinite(nearest) ? nearest.toFixed(1) : "-"} m from an AI line`;
  if (L.pit && L.ai.length > 1) {
    let on = 0, far = 0;
    L.pit.forEach((p, i) => {
      const d = distTo(L.ai, p.position as Xyz, L.closed);
      far = Math.max(far, d);
      if (d < ON_LINE && i < L.pit!.length - 1) on += p.length;
    });
    const total = L.pit[L.pit.length - 1].distance;
    line += `; pit lane ${total.toFixed(0)} m, ${on.toFixed(0)} m of it on the AI line, ${far.toFixed(1)} m off it at most`;
    if (far < LANE_OFF) problems.push(`the pit lane never leaves the AI line (${far.toFixed(1)} m at most)`);
    if (on > PIT_ON_LINE_MAX) problems.push(`${on.toFixed(0)} m of the pit lane is on the AI line`);
    for (const b of pits) {
      const d = Math.min(...L.pit.map((p) => Math.hypot(p.position[0] - b.at[0], p.position[2] - b.at[2])));
      if (d > 3) problems.push(`${b.name} ${d.toFixed(1)} m from the pit lane`);
    }
    // The layout's own meshes (course markings: barrier blocks, boards) across the lane's off-line
    // stretch or on a box.
    if (L.model) {
      const offLine = L.pit.filter((p) => distTo(L.ai, p.position as Xyz, L.closed) > ON_LINE).map((p) => p.position as Xyz);
      const spots = [...offLine, ...pits.map((b) => b.at)];
      const near = (x: number, z: number) => spots.some((q) => Math.abs(q[0] - x) < 4 && Math.abs(q[2] - z) < 4);
      const cells = standingCells(L.model, ground, near);
      const hit = (x: number, z: number) => cells.has((Math.floor(x) + 32768) * 65536 + (Math.floor(z) + 32768));
      const lane = offLine.filter((q) => [-1, 0, 1].some((dx) => [-1, 0, 1].some((dz) => hit(q[0] + dx, q[2] + dz)))).length;
      const boxes = pits.filter((b) => [-1, 0, 1].some((dx) => [-1, 0, 1].some((dz) => hit(b.at[0] + dx, b.at[2] + dz)))).length;
      line += `; layout meshes on the lane: ${lane}, on a box: ${boxes}`;
      if (lane) problems.push(`${lane} pit lane points have the layout's own meshes (course markings) on them`);
      if (boxes) problems.push(`${boxes} pit boxes have the layout's own meshes (course markings) on them`);
    }
  } else {
    line += "; no pit lane";
  }
  console.log(line);
  for (const p of problems.slice(0, 12)) console.log(`   ${p}`);
  if (problems.length > 12) console.log(`   ... and ${problems.length - 12} more`);
  if (problems.length) bad++;
}
console.log(bad ? `pit check: ${bad} layout(s) fail` : "pit check: pass");
process.exit(bad ? 1 : 0);
