// Prints the network graph around a spot: nodes, their legs and edge lengths.
//   npx tsx scripts/network/debug_node.ts <overpass.json> <route.json> <lng,lat> [radius=60]
import { readFileSync } from "node:fs";
import { LocalProjection, type LngLat } from "../../src/core/geo";
import { buildGraph } from "../../src/core/network";
import { dist, lengths, type P2 } from "../../src/core/network/geom";
import { overpassWays } from "./ways";

const [osmPath, routePath, at, rs] = process.argv.slice(2);
const proj = new LocalProjection(JSON.parse(readFileSync(routePath, "utf8")).build.origin);
const g = buildGraph(overpassWays(JSON.parse(readFileSync(osmPath, "utf8")), proj).ways);
const c = proj.toLocal(at.split(",").map(Number) as LngLat) as P2;
for (const n of g.nodes) {
  if (dist(n.p, c) > Number(rs ?? 60) || n.legs.length === 0) continue;
  const legs = n.legs.map((l) => {
    const e = g.edges[l.edge];
    const L = lengths(e.pts);
    return `${e.id}${l.start ? ">" : "<"}${e.name ?? e.cls}${e.oneway ? " ow" + e.oneway : ""}${e.internal ? " int" : ""} ${L[L.length - 1].toFixed(0)}m to ${l.start ? e.b : e.a}`;
  });
  console.log(`node ${n.id} ${n.kind} at ${(n.p[0] - c[0]).toFixed(0)},${(n.p[1] - c[1]).toFixed(0)}: ${legs.join(" | ")}${n.roundabout ? ` splitters ${n.roundabout.splitters.length}` : ""}`);
}
