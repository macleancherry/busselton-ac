// Prints the ways around a spot before and after divided roads are collapsed (dual.ts), and the graph's
// nodes there. npx tsx scripts/network/debug_dual.ts <overpass.json> <lng,lat> [radius=60]
import { readFileSync } from "node:fs";
import { LocalProjection, type LngLat } from "../../src/core/geo";
import { buildGraph } from "../../src/core/network/graph";
import { collapseDuals } from "../../src/core/network/dual";
import { dist, lengths, type P2 } from "../../src/core/network/geom";
import { overpassWays } from "./ways";

const [osmPath, at, rs] = process.argv.slice(2);
const proj = new LocalProjection(JSON.parse(readFileSync("routes/busselton.json", "utf8")).build.origin);
const { ways } = overpassWays(JSON.parse(readFileSync(osmPath, "utf8")), proj);
const c = proj.toLocal(at.split(",").map(Number) as LngLat) as P2;
const R = Number(rs ?? 60);
const fmt = (p: P2) => `${(p[0] - c[0]).toFixed(1)},${(p[1] - c[1]).toFixed(1)}`;
const show = (ws: typeof ways, title: string) => {
  console.log(`== ${title}`);
  ws.forEach((w, i) => {
    if (!w.pts.some((p) => dist(p, c) < R)) return;
    const L = lengths(w.pts);
    console.log(`  w${i} ${w.name ?? ""} ${w.cls}${w.oneway ? " ow" + w.oneway : ""}${w.median !== undefined ? ` median ${w.median.toFixed(1)} width ${w.width?.toFixed(1)}` : ""} ${L[L.length - 1].toFixed(0)}m: ${w.pts.filter((p) => dist(p, c) < R + 20).map(fmt).join(" ")}`);
  });
};
show(ways, "input");
const { ways: out, duals } = collapseDuals(ways);
show(out, `collapsed (${duals.length} duals)`);
const g = buildGraph(out);
for (const n of g.nodes) {
  if (dist(n.p, c) > R || !n.legs.length) continue;
  console.log(`node ${n.id} ${n.kind} at ${fmt(n.p)}: ${n.legs.map((l) => `e${l.edge}${l.start ? ">" : "<"}${g.edges[l.edge].cls}`).join(" ")} inner ${n.inner ?? []}`);
}
