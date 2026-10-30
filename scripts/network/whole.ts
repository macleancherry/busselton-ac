// The network-core prototype over every junction in an Overpass response: timing, failures,
// crowded legs, planar fields and triangle counts.
//   npx tsx scripts/network/whole.ts <overpass.json> <route.json>
import { readFileSync } from "node:fs";
import { LocalProjection } from "../../src/core/geo";
import { buildNetwork } from "../../src/core/network";
import { demTiles } from "../polish/demTiles";
import { overpassWays } from "./ways";

const [osmPath, routePath] = process.argv.slice(2);
const proj = new LocalProjection(JSON.parse(readFileSync(routePath, "utf8")).build.origin);
const { ways, lngLats } = overpassWays(JSON.parse(readFileSync(osmPath, "utf8")), proj);
const step = Math.max(1, Math.floor(lngLats.length / 400));
const dem = await demTiles("public/dem/wa", lngLats.filter((_, i) => i % step === 0));
const t0 = Date.now();
const net = buildNetwork(ways, (x, y) => dem(proj.toLngLat([x, y])) ?? 0);
const ms = Date.now() - t0;
const js = net.junctions;
const legs = js.flatMap((j) => j.shape.legs);
console.log(JSON.stringify({
  ms, ways: ways.length, nodes: net.graph.nodes.length, edges: net.graph.edges.filter((e) => !e.internal).length,
  junctions: js.length, roundabouts: js.filter((j) => j.shape.kind === "roundabout").length,
  failures: net.failures.length, firstFailures: net.failures.slice(0, 3),
  legs: legs.length, crowdedLegs: legs.filter((l) => l.crowded).length,
  planar: js.filter((j) => j.field.planar).length,
  outlinesNotOne: js.filter((j) => j.mesh.contour.rings.filter((r) => r.length > 2).length === 0).length,
  junctionTriangles: js.reduce((s, j) => s + j.mesh.indices.length / 3, 0),
  edgeTriangles: net.edges.reduce((s, e) => s + e.mesh.indices.length / 3, 0),
}, null, 1));
