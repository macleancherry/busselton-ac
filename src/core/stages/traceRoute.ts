// S2, tracing the route in the aerial photos (track.md S2): the photo along the road, the traced
// edges (faded out in noTrace zones), and the plan moved onto them. Silent on failure: the road
// stays on the map's line.

import { inRoundabout } from "../road";
import { applyTrace, traceRoad, type RasterSampler, type TraceResult } from "../trace";
import type { BuildContext } from "./context";
import type { RoutePlan } from "./routePlan";
import type { Progress } from "./types";

export interface Traced {
  raster: RasterSampler | null;
  trace: TraceResult | null;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Mutates the plan (applyTrace): samples, `s`, widths, ring sIn/sOut and length. */
export async function traceRoute(ctx: BuildContext, rp: RoutePlan, progress: Progress): Promise<Traced> {
  const { opts, sources, proj } = ctx;
  const plan = rp.plan;
  let raster: RasterSampler | null = null;
  let trace: TraceResult | null = null;
  if (!(opts.traceRoads && sources.raster)) return { raster, trace };
  await progress("Tracing the road in the aerial photos");
  const reach = Math.max(16, 1.5 * Math.max(...plan.samples.map((s) => s.width)));
  raster = await sources.raster(proj, plan.samples.map((s) => s.pos), reach);
  if (!raster) return { raster, trace };
  trace = traceRoad(plan, raster, undefined, opts.traceGuard);
  const zones = opts.noTrace.map((z) => ({ c: ctx.toLocal(z.at), r: z.radius }));
  if (zones.length) {
    plan.samples.forEach((s, i) => {
      const keep = Math.min(1, ...zones.map((z) => clamp01((Math.hypot(s.pos[0] - z.c[0], s.pos[1] - z.c[1]) - z.r) / 30)));
      trace!.offset[i] *= keep;
      trace!.conf[i] *= keep;
    });
  }
  applyTrace(plan, trace, (i) => !!inRoundabout(plan, plan.samples[i].pos[0], plan.samples[i].pos[1], 0.5));
  return { raster, trace };
}
