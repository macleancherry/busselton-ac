// Network-first road core, prototype (docs/specs/road-network.md). Ways in; the graph, junction
// polygons with one height field each, edge profiles and meshes out. Not used by the build unless
// the networkCore option is on, and then only written out for inspection.

import { buildGraph, type Graph, type NetWay } from "./graph";
import { dist, type P2 } from "./geom";
import { edgeProfile, junctionField, type EdgeProfile, type HeightAt, type HeightOptions, type JunctionField } from "./heights";
import { junctionShape, type JunctionShape } from "./junction";
import { edgeMesh, junctionMesh, type JunctionMesh, type Tris } from "./mesh";

export { buildGraph, junctionShape, junctionField, junctionMesh, edgeProfile, edgeMesh };
export type { Graph, NetWay, JunctionShape, JunctionField, JunctionMesh, EdgeProfile, Tris, HeightAt };

export interface NetworkOptions extends HeightOptions {
  /** Only junctions within this circle (and edges touching them). */
  near?: { at: P2; radius: number };
  /** Grid step of junction meshes, metres. */
  meshStep?: number;
}

export interface JunctionResult {
  shape: JunctionShape;
  field: JunctionField;
  mesh: JunctionMesh;
}

export interface NetworkResult {
  graph: Graph;
  junctions: JunctionResult[];
  edges: { profile: EdgeProfile; mesh: Tris }[];
  failures: { node: number; error: string }[];
}

export function buildNetwork(ways: NetWay[], height: HeightAt, o: NetworkOptions = {}): NetworkResult {
  const graph = buildGraph(ways);
  const junctions: JunctionResult[] = [];
  const failures: NetworkResult["failures"] = [];
  const byNode = new Map<number, JunctionResult>();
  for (const n of graph.nodes) {
    if (n.kind !== "junction" && n.kind !== "roundabout") continue;
    if (o.near && dist(n.p, o.near.at) > o.near.radius) continue;
    try {
      const shape = junctionShape(graph, n);
      const field = junctionField(shape, height, o);
      const mesh = junctionMesh(shape, field.h, o.meshStep ?? 0.5);
      const r = { shape, field, mesh };
      junctions.push(r);
      byNode.set(n.id, r);
    } catch (err) {
      failures.push({ node: n.id, error: String((err as Error)?.message ?? err) });
    }
  }
  const edges: NetworkResult["edges"] = [];
  for (const e of graph.edges) {
    if (e.internal) continue;
    const ja = byNode.get(e.a), jb = byNode.get(e.b);
    if (o.near && !ja && !jb) continue;
    const end = (j: JunctionResult | undefined, start: boolean) => {
      const leg = j?.shape.legs.find((l) => l.edge === e.id && l.start === start);
      return j && leg ? { trim: leg.trim, field: j.field.h } : undefined;
    };
    // A self-loop (both ends at one node) has two legs there.
    const profile = edgeProfile(graph, e.id, { a: end(ja, true), b: end(jb, false) }, height, o);
    edges.push({ profile, mesh: edgeMesh(profile) });
  }
  return { graph, junctions, edges, failures };
}

/** Ways for the network from the build's street lines (exact OSM geometry) and roundabout rings. */
export function waysFromStreets(
  lines: { pts: P2[]; cls: string; oneway?: 1 | -1; brunnel?: string; service?: string; surface?: string }[],
  rings: { pts: P2[]; lanes?: number }[],
): NetWay[] {
  const ringKeys = new Set<string>();
  const key = (p: P2) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  for (const r of rings) for (let i = 1; i < r.pts.length; i++) ringKeys.add(key(r.pts[i - 1]) + "|" + key(r.pts[i]));
  const drivable = /^(motorway|trunk|primary|secondary|tertiary|minor|residential|unclassified|living_street|road|service)(_link)?$/;
  const out: NetWay[] = [];
  for (const l of lines) {
    if (!drivable.test(l.cls) || l.pts.length < 2) continue;
    // A street line that runs along a ring is the ring itself.
    const onRing = l.pts.length > 1 && ringKeys.has(key(l.pts[0]) + "|" + key(l.pts[1]));
    if (onRing) continue;
    out.push({
      pts: l.pts, cls: l.cls, ...(l.oneway ? { oneway: l.oneway } : {}), ...(l.brunnel === "bridge" ? { layer: 1 } : l.brunnel === "tunnel" ? { layer: -1 } : {}),
      ...(l.service ? { service: l.service } : {}), ...(l.surface ? { surface: l.surface } : {}),
    });
  }
  for (const r of rings) out.push({ pts: r.pts, cls: "tertiary", roundabout: true, oneway: 1, ...(r.lanes ? { lanes: r.lanes } : {}) });
  return out;
}
