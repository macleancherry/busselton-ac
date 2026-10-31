// S9 and S10 (track.md): networkCore's junctions (planned before the kerbs, on the kerb-less
// terrain, B1), then where the route gets kerbs, which roundabouts are kerbed, and the kerbs
// recorded on the plan's samples (the terrain and road materials read them from then on).

import { kerbEvidence, KERB_BACK, planKerbs, STRIP_EXTRA } from "../kerbs";
import { planJunctionCore, type JunctionCore } from "../network/phase1";
import { inRoundabout } from "../road";
import { outerRadius } from "../roundabout";
import { isUnsealed } from "../unsealed";
import type { BuildContext } from "./context";
import type { Ground } from "./ground";
import type { RoutePlan } from "./routePlan";
import type { Streets } from "./streets";
import type { Surfaces } from "./surfaces";
import type { Traced } from "./traceRoute";

/** networkCore (area builds with it on): junctions built as one surface each take over their mouths. */
export function planNetwork(ctx: BuildContext, rp: RoutePlan, g: Ground, st: Streets, sf: Surfaces): JunctionCore | null {
  const area = ctx.area;
  if (!(ctx.opts.networkCore && area)) return null;
  const streets = st.streetPlan.streets;
  const net = planJunctionCore({
    lines: st.netLines,
    rings: st.netRings,
    route: st.routeRibbon,
    ...(st.net2 ? { graph: st.net2.graph } : {}),
    streets,
    builtRings: rp.plan.roundabouts,
    terrain: (x, y) => g.terrainAt(x, y).h,
    inArea: ([x, y]) => area.signed(x, y) < -5,
    routeRowOk: (i) => sf.unsealedAt[i] !== 1,
    streetOk: (si) => !(sf.gravelOn && isUnsealed(streets[si].surface, streets[si].cls)),
  });
  st.setNet(net);
  return net;
}

export interface Kerbing {
  /** Kerb on the [left, right] per sample, 0 or 1. */
  kerbs: [number[], number[]];
  /** A kerb at sample i (wrapped) on that side (1 left). */
  kerbAt: (i: number, side: 1 | -1) => boolean;
}

/** Mutates the plan: route rings' `kerbed`, and `kerb` on every kerbed sample. */
export function planKerbing(ctx: BuildContext, rp: RoutePlan, tr: Traced, g: Ground, st: Streets, sf: Surfaces, net: JunctionCore | null): Kerbing {
  const { opts } = ctx;
  const plan = rp.plan, nS = plan.samples.length, index = g.index;
  let kerbs: [number[], number[]] = [new Array(nS).fill(0), new Array(nS).fill(0)];
  if (opts.kerbs) {
    const trace = tr.trace;
    const evidence = tr.raster && trace ? kerbEvidence(plan, tr.raster, (i) => trace.conf[i] > 0.7) : null;
    const blocked = (i: number, side: 1 | -1): boolean => {
      if (net?.routeRowInside(i)) return true;
      const smp = plan.samples[i];
      if (st.mouths.some((j) => j.side === side && Math.abs(j.s - smp.s) < j.width / 2 + 4)) return true;
      const half = smp.width / 2;
      const reach = half + opts.vergeWidth + STRIP_EXTRA;
      const inside = smp.curvature * side;
      if (inside > 0 && 1 / inside < reach + 3) return true;
      for (const t of [half + 0.3, half + KERB_BACK, half + 1.5, reach]) {
        const x = smp.pos[0] + smp.left[0] * side * t, y = smp.pos[1] + smp.left[1] * side * t;
        if (inRoundabout(plan, x, y, 1.5) || st.streetIndex.clearance(x, y) < 0.5) return true;
        const n = index.nearest(x, y, 30);
        if (n && n.dist < index.at(n).width / 2 - 0.2) return true;
      }
      return false;
    };
    kerbs = planKerbs(plan, evidence, (i) => sf.town[i], blocked);
    for (let i = 0; i < nS; i++) {
      if (sf.unsealedAt[i] === 1) {
        kerbs[0][i] = 0;
        kerbs[1][i] = 0;
      }
    }
  }
  for (const rb of plan.roundabouts) {
    if (Number.isNaN(rb.sIn)) continue;
    const reach = outerRadius(rb) + 30;
    rb.kerbed = plan.samples.some((s, i) => (kerbs[0][i] > 0 || kerbs[1][i] > 0) && Math.hypot(s.pos[0] - rb.c[0], s.pos[1] - rb.c[1]) < reach);
  }
  plan.samples.forEach((s, i) => {
    if (kerbs[0][i] > 0 || kerbs[1][i] > 0) s.kerb = [kerbs[0][i], kerbs[1][i]];
  });
  return { kerbs, kerbAt: (i, side) => kerbs[side === 1 ? 0 : 1][((i % nS) + nS) % nS] > 0 };
}
