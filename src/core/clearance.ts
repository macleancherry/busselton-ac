// Last pass before the model is assembled: solid edge meshes (kerbs, strips,
// gutters, paths, driveways, rails, fences, Armco) lose any triangle whose
// centre lands on the route's asphalt or a roundabout's carriageway, so
// nothing solid ever stands on the driving line.
//
// Written from docs/specs/clearance.md. `clearOfRoute` and `keepOffRoute`
// take any point predicate; only `onRoute` knows about the RoadPlan.

import type { Kn5MeshNode } from "./kn5";
import type { RoadPlan, SegmentIndex } from "./road";
import { innerRadius, outerRadius } from "./roundabout";

/** Mesh names that are cleared off the route (prefix match, case-sensitive). */
export const KEEP_OFF = /^(1(KERB|GRASS_STRIP|ROAD_GUTTER|STREET_GUTTER|STREET_PATH|STREET_DRIVE|WALL_RAIL|WALL_FENCE|WALL_ARMCO)|ARMCO_)/;

/** How far from the centreline to look for route asphalt, metres. */
const ROUTE_REACH = 25;

/** Local-metre point test (x east, y north). */
export type OnRoad = (x: number, y: number) => boolean;

/**
 * Is a point on the route's asphalt (more than `margin` inside its edge) or
 * on a roundabout's carriageway (more than `margin` inside either edge)?
 */
export function onRoute(plan: RoadPlan, index: SegmentIndex, margin = 0.15): OnRoad {
  const rings = plan.roundabouts.map((rb) => ({
    cx: rb.c[0],
    cy: rb.c[1],
    lo: innerRadius(rb) + margin,
    hi: outerRadius(rb) - margin,
  }));
  return (x, y) => {
    const near = index.nearest(x, y, ROUTE_REACH);
    if (near && near.dist < index.at(near).width / 2 - margin) return true;
    for (const r of rings) {
      const d = Math.hypot(x - r.cx, y - r.cy);
      if (d > r.lo && d < r.hi) return true;
    }
    return false;
  };
}

/** Drops the triangles whose centre is on the road. Mesh positions are AC space (x east, y up, z south). */
export function clearOfRoute(node: Kn5MeshNode, on: OnRoad): { node: Kn5MeshNode | null; dropped: number } {
  const pos = node.positions;
  const idx = node.indices;
  const kept: number[] = [];
  let dropped = 0;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const x = (pos[a] + pos[b] + pos[c]) / 3;
    const z = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
    if (on(x, -z)) dropped++;
    else kept.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  if (dropped === 0) return { node, dropped: 0 };
  if (kept.length === 0) return { node: null, dropped };
  return { node: { ...node, indices: Uint16Array.from(kept) }, dropped };
}

/** Clears every KEEP_OFF mesh; others pass through untouched. Order is kept. */
export function keepOffRoute(nodes: Kn5MeshNode[], on: OnRoad): { nodes: Kn5MeshNode[]; dropped: number } {
  const out: Kn5MeshNode[] = [];
  let dropped = 0;
  for (const n of nodes) {
    if (!KEEP_OFF.test(n.name)) {
      out.push(n);
      continue;
    }
    const r = clearOfRoute(n, on);
    dropped += r.dropped;
    if (r.node) out.push(r.node);
  }
  return { nodes: out, dropped };
}
