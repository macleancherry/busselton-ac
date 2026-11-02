// Busselton fork: a circuit's kerbs, start line and grid boxes (circuitKerbs.ts), into the world's
// MARKINGS group, for raceway builds. Their materials are registered here, only when used.

import { circuitKerbs, circuitKerbsSettings, circuitMaterials, gridPaint } from "../circuitKerbs";
import type { Kn5MeshNode } from "../kn5";
import { keepLeftOffsets } from "../keepLeft";
import type { BuildContext } from "./context";
import type { Ground } from "./ground";
import type { Registry } from "./registry";
import { trackObjects, type RoutePlan } from "./routePlan";
import type { Streets } from "./streets";

export function circuitNodes(ctx: BuildContext, reg: Registry, rp: RoutePlan, st: Streets, g: Ground): Kn5MeshNode[] {
  const { opts } = ctx;
  const plan = rp.plan;
  const nodes: Kn5MeshNode[] = [];
  const kerbs = circuitKerbsSettings(opts.circuitKerbs, !!opts.raceway);
  if (kerbs) {
    nodes.push(...circuitKerbs(plan, {
      crown: opts.crown,
      maxRadius: kerbs.maxRadius,
      corners: kerbs.corners?.map((p) => ctx.toLocal(p)),
      aiOffset: opts.aiKeepLeft ? keepLeftOffsets(plan) : undefined,
      mouth: st.mouth,
    }).nodes);
  }
  // The grid paint goes where this layout's grid is (every layout on one straight shares it).
  if (opts.raceway && opts.gridPaint !== false && !opts.courseMarks && plan.closed) {
    const dummies = trackObjects(plan, opts, st.gridAvoid, { toLocal: ctx.toLocal, groundAt: g.terrainH });
    nodes.push(...gridPaint(plan, dummies, 0, opts.crown).nodes);
  }
  if (nodes.length && !reg.hasMaterial("circuit_red")) {
    const m = circuitMaterials();
    m.textures.forEach((t) => reg.texture(t.name, t.data));
    m.materials.forEach((x) => reg.material(x));
  }
  return nodes;
}
