// S11.10, the route's line markings (track.md S11.10): lines read off the photo where the road was
// traced, generated elsewhere; discrete marks Mapillary saw (stop and give-way lines, zebras,
// arrows, words, bicycles) snapped onto the road; the start and finish lines.

import type { Vec2 } from "../geo";
import type { Kn5MeshNode } from "../kn5";
import { buildMarkings, type DiscreteMark } from "../markings";
import type { JunctionCore } from "../network/phase1";
import { findLines, paintCandidates, type ImageLine } from "../paintLines";
import { inRoundabout } from "../road";
import type { BuildContext } from "./context";
import type { Ground } from "./ground";
import type { Kerbing } from "./kerbing";
import type { RoutePlan } from "./routePlan";
import type { Streets } from "./streets";
import type { Surfaces } from "./surfaces";
import type { Traced } from "./traceRoute";
import type { Progress } from "./types";

export interface Marks {
  /** Every marking mesh; rings, junctions and kerbside add theirs later (S12). */
  markings: Kn5MeshNode[];
  imageLines: ImageLine[];
}

const DISCRETE = /^marking--discrete--(stop-line|give-way|crosswalk-zebra|arrow--([a-z-]+)|text--([a-z0-9-]+)|symbol--(bicycle))/;

export async function buildMarks(
  ctx: BuildContext, rp: RoutePlan, tr: Traced, g: Ground, st: Streets, sf: Surfaces, kb: Kerbing, net: JunctionCore | null, progress: Progress,
): Promise<Marks> {
  const { opts, sources } = ctx;
  const plan = rp.plan, index = g.index, nS = plan.samples.length;
  const sampleIndex = (sd: number) => Math.max(0, Math.min(nS - 1, Math.round(sd / opts.spacing)));
  const sampleNear = (sd: number) => plan.samples[sampleIndex(sd)];

  let imageLines: ImageLine[] = [];
  let covered = (_i: number) => false;
  const raster = tr.raster, trace = tr.trace;
  if (opts.markings && raster && trace) {
    await progress("Reading line markings from the aerial photos");
    const trusted = (i: number) => trace.conf[i] > 0.7;
    imageLines = findLines(plan, paintCandidates(plan, raster, trusted), trusted);
    const reach = Math.round(40 / opts.spacing);
    covered = (i) => trusted(i) && imageLines.some((l) => i >= l.i0 - reach && i <= l.i1 + reach);
  }

  // Discrete marks seen from the street, on the road, one per spot.
  const marks: DiscreteMark[] = [];
  for (const f of sources.seen ?? []) {
    const m = DISCRETE.exec(f.value);
    if (!m) continue;
    const at: Vec2 = ctx.toLocal(f.at);
    const n = index.nearest(at[0], at[1], 15);
    if (!n || Math.abs(n.t) > index.at(n).width / 2 + 1) continue;
    const a = plan.samples[n.seg], b = plan.samples[(n.seg + 1) % nS];
    const sb = n.seg + 1 >= nS ? plan.length : b.s;
    const s = a.s + (sb - a.s) * n.frac, t = n.t;
    const kind: DiscreteMark["kind"] = m[1] === "stop-line" ? "stop" : m[1] === "give-way" ? "giveway" : m[1] === "crosswalk-zebra" ? "zebra" : m[2] ? "arrow" : m[3] ? "text" : "symbol";
    const shape = m[2] ?? m[3] ?? m[4];
    const glyph = kind === "arrow" || kind === "text" || kind === "symbol";
    if (marks.some((o) => o.kind === kind && Math.abs(o.s - s) < 8 && (!glyph || (Math.sign(o.t) === Math.sign(t) && Math.abs(o.t - t) < 1.6)))) continue;
    marks.push({ s, t, kind, ...(shape ? { shape } : {}) });
  }
  if (plan.timed) {
    marks.push({ s: plan.samples[plan.timed.start].s, t: 0, kind: "start" });
    marks.push({ s: plan.samples[plan.timed.finish].s, t: 0, kind: "finish" });
  }

  const skip = (sd: number) => {
    const p = sampleNear(sd).pos;
    return !!inRoundabout(plan, p[0], p[1], 1) || sf.unsealedAt[sampleIndex(sd)] === 1 || !!net?.routeSInside(sd);
  };
  const noEdge = (side: 1 | -1, sd: number) => st.mouth(side, sd) || kb.kerbAt(Math.round(sd / opts.spacing), side);
  const markings = opts.markings ? buildMarkings(plan, opts, skip, noEdge, { lines: imageLines, covered }, marks) : [];
  return { markings, imageLines };
}
