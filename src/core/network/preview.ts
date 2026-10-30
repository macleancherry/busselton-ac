// The networkCore option's output: the prototype run over the whole build, written into the zip
// as network/network.json for inspection (AC ignores the folder). Nothing else uses it yet.

import type { LngLat } from "../geo";
import { buildNetwork, waysFromStreets, type HeightAt } from "./index";
import type { P2 } from "./geom";

export interface NetworkPreviewInput {
  lines: { pts: LngLat[]; cls: string; oneway?: 1 | -1; brunnel?: string }[];
  rings: { pts: LngLat[]; lanes?: number }[];
  toLocal: (p: LngLat) => [number, number];
  height: HeightAt;
}

export function networkPreview(slug: string, input: NetworkPreviewInput): Record<string, Uint8Array> {
  const t0 = Date.now();
  const loc = (pts: LngLat[]) => pts.map((p) => input.toLocal(p) as P2);
  const ways = waysFromStreets(input.lines.map((l) => ({ ...l, pts: loc(l.pts) })), input.rings.map((r) => ({ ...r, pts: loc(r.pts) })));
  const net = buildNetwork(ways, input.height);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const out = {
    ms: Date.now() - t0,
    nodes: net.graph.nodes.length,
    edges: net.graph.edges.length,
    junctions: net.junctions.map((j) => ({
      node: j.shape.node,
      kind: j.shape.kind,
      at: net.graph.nodes[j.shape.node].p.map(r2),
      legs: j.shape.legs.map((l) => ({ edge: l.edge, trim: r2(l.trim), crowded: !!l.crowded })),
      planar: j.field.planar,
      grade: r2(Math.hypot(...j.field.base.g) * 100) / 100,
      triangles: j.mesh.indices.length / 3,
      areaM2: r2(j.mesh.area),
      polygon: j.mesh.contour.rings.map((ring) => ring.map((p) => p.map(r2))),
    })),
    failures: net.failures,
  };
  return { [`${slug}/network/network.json`]: new TextEncoder().encode(JSON.stringify(out)) };
}
