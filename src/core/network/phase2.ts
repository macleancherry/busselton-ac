// networkCore phase 2, the build's hook (docs/specs/road-network.md, "Phase 2"): in an area build the
// graph (divided roads collapsed to one road with a median) plans the streets between junctions, in
// place of the old side-street plan, so junctions and streets come from one model. track.ts calls
// planNetworkStreets() right after the old plan and swaps its streets and mouths for these; the
// junction core (phase1.ts) then takes the same graph, and the streets are meshed by streetMesh.ts.

import type { Graph } from "./graph";
import type { DualInfo } from "./dual";
import { dot, sub, type P2 } from "./geom";
import { networkGraph, type JunctionCoreInput } from "./phase1";
import { planGraphStreets, type GraphStreet, type Mouth } from "./streets";
import type { RingIn, RouteRibbon } from "./ribbons";

export interface NetworkStreetInput {
  lines: JunctionCoreInput["lines"];
  rings: JunctionCoreInput["rings"];
  /** Street names (local metres): each street takes the name of the nearest named line within 8 m. */
  names: { pts: P2[]; name: string }[];
  route: RouteRibbon | null;
  builtRings: RingIn[];
  inArea: (p: P2) => boolean;
  corridor: number;
  vergeWidth: number;
}

export interface NetworkStreets {
  graph: Graph;
  duals: DualInfo[];
  streets: GraphStreet[];
  mouths: Mouth[];
}

/** The nearest name within `max` metres of a point, from named lines. */
export function nameLookup(names: { pts: P2[]; name: string }[], max = 8): (p: P2) => string | undefined {
  const CELL = 50;
  const grid = new Map<string, { a: P2; b: P2; name: string }[]>();
  for (const n of names) for (let k = 1; k < n.pts.length; k++) {
    const a = n.pts[k - 1], b = n.pts[k];
    for (let x = Math.floor((Math.min(a[0], b[0]) - max) / CELL); x <= Math.floor((Math.max(a[0], b[0]) + max) / CELL); x++)
      for (let y = Math.floor((Math.min(a[1], b[1]) - max) / CELL); y <= Math.floor((Math.max(a[1], b[1]) + max) / CELL); y++) {
        const key = `${x},${y}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push({ a, b, name: n.name });
      }
  }
  return (p) => {
    let best: string | undefined, bd = max;
    for (const { a, b, name } of grid.get(`${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`) ?? []) {
      const ab = sub(b, a), L2 = dot(ab, ab) || 1e-12;
      const f = Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2));
      const d = Math.hypot(p[0] - a[0] - ab[0] * f, p[1] - a[1] - ab[1] * f);
      if (d < bd) { bd = d; best = name; }
    }
    return best;
  };
}

export function planNetworkStreets(input: NetworkStreetInput): NetworkStreets {
  const { graph, duals } = networkGraph(input.lines, input.rings);
  const nameAt = nameLookup(input.names);
  const { streets, mouths } = planGraphStreets(graph, {
    route: input.route, rings: input.builtRings, inArea: input.inArea, corridor: input.corridor, vergeWidth: input.vergeWidth, nameAt,
  });
  return { graph, duals, streets, mouths };
}
