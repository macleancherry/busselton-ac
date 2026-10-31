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
  const none: Traced = { raster: null, trace: null };
  if (!opts.traceRoads || !sources.raster) return none;
  await progress("Tracing the road in the aerial photos");
  const samples = plan.samples;
  const widest = samples.reduce((w, s) => Math.max(w, s.width), -Infinity);
  const photo = await sources.raster(proj, samples.map((s) => s.pos), Math.max(16, 1.5 * widest));
  if (!photo) return none;
  const result = traceRoad(plan, photo, undefined, opts.traceGuard);
  // Fade the trace out near each noTrace place: nothing inside it, all of it 30 m past its edge.
  const zones = opts.noTrace.map((z) => ({ c: ctx.toLocal(z.at), r: z.radius }));
  if (zones.length) {
    for (let i = 0; i < samples.length; i++) {
      const [x, y] = samples[i].pos;
      const keep = Math.min(1, ...zones.map((z) => clamp01((Math.hypot(x - z.c[0], y - z.c[1]) - z.r) / 30)));
      result.offset[i] *= keep;
      result.conf[i] *= keep;
    }
  }
  // (applyTrace may move the samples while it asks: read them live.)
  const onRing = (i: number) => inRoundabout(plan, plan.samples[i].pos[0], plan.samples[i].pos[1], 0.5) !== undefined;
  applyTrace(plan, result, onRing);
  return { raster: photo, trace: result };
}
