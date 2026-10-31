// The track build: the stages in order (docs/specs/track.md section 5), with the progress calls
// between them. Each stage is a module of its own under stages/; the plan's four mutations are in
// traceRoute, prepareGround, planKerbing and buildRoadSurfaces, and every texture and material
// goes through one registry in build order.

import type { TrackMeta } from "../acFiles";
import type { LngLat } from "../geo";
import { withDefaults, type BuildOptions } from "../options";
import { assemble } from "./assemble";
import { planBuildings } from "./buildingPlan";
import { makeContext } from "./context";
import { writeFiles } from "./files";
import { prepareGround } from "./ground";
import { buildGroundMeshes } from "./groundMeshes";
import { buildHouses, finishHouses } from "./houses";
import { fetchImagery } from "./imagery";
import { planKerbing, planNetwork } from "./kerbing";
import { addKit } from "./kit";
import { buildMarks } from "./marks";
import { finishParked, placeParkedFirst } from "./parked";
import { placeScenery } from "./placeScenery";
import { Registry } from "./registry";
import { buildRings } from "./rings";
import { buildRoadSurfaces } from "./roadMeshes";
import { planRoute } from "./routePlan";
import { buildStats, housesOut } from "./stats";
import { planStreets } from "./streets";
import { makeSurfaces } from "./surfaces";
import { traceRoute } from "./traceRoute";
import { trafficFor } from "./traffic";
import type { DataSources, Progress, TrackResult } from "./types";

export async function buildTrack(
  route: LngLat[],
  partial: Partial<BuildOptions>,
  sources: DataSources,
  meta: Partial<TrackMeta> = {},
  progress: Progress = () => {},
): Promise<TrackResult> {
  const opts = withDefaults(partial);
  if (route.length < 2) throw new Error("Pick a start and a finish on the map first");
  await progress("Laying out the road");
  const ctx = makeContext(route, opts, sources);
  const rp = planRoute(ctx);
  const tr = await traceRoute(ctx, rp, progress);
  await progress("Fetching elevation");
  const g = await prepareGround(ctx, rp);
  const reg = new Registry(opts.detailShaders);
  reg.zones = g.zones;
  addKit(reg, ctx, g, rp.plan);
  const img = await fetchImagery(ctx, rp.plan, g, reg, progress);
  const st = await planStreets(ctx, rp, tr, g, progress);
  const bp = planBuildings(ctx, rp, g, st, img, reg);
  await progress("Building road and terrain meshes");
  const sf = makeSurfaces(ctx, rp, tr, st, bp, reg);
  const net = planNetwork(ctx, rp, g, st, sf);
  const kb = planKerbing(ctx, rp, tr, g, st, sf, net);
  const rm = buildRoadSurfaces(ctx, rp, tr, g, st, bp, sf, kb, net, reg);
  const mk = await buildMarks(ctx, rp, tr, g, st, sf, kb, net, progress);
  const rn = buildRings(ctx, rp, g, st, img, bp, sf, kb, rm, net, mk, reg);
  const gm = await buildGroundMeshes(ctx, rp, g, st, rm, rn, img, progress);
  await progress("Placing scenery");
  const sc = await placeScenery(ctx, rp, g, st, bp, sf, kb, rm, gm, img, reg);
  const hs = buildHouses(ctx, g, bp, gm, sc, reg);
  const p1 = placeParkedFirst(ctx, rp, g, st, img, rn, hs);
  const { houses, lots } = finishHouses(ctx, g, hs, bp);
  const model = assemble(ctx, reg, { rp, g, st, img, rm, mk, rn, gm, sc, hs, houses, lots });
  const tf = opts.traffic ? trafficFor(ctx, rp, g, st, sf, rn, sc, net) : null;
  const pf = finishParked(ctx, rp, model, reg, p1, tf, rm, rn, gm);
  await progress("Writing track files");
  const out = writeFiles(ctx, model, { rp, g, st, img, bp, sf, rn, gm, sc, hs, tf, net, parked: pf.parked }, meta);
  const stats = buildStats(ctx, model, { rp, tr, st, img, bp, kb, rm, mk, rn, gm, sc, hs, p1, pf, kn5: out.kn5, meanWidth: out.meanWidth }, reg);
  await progress("Done", 1);
  return {
    slug: ctx.slug,
    files: out.files,
    model,
    plan: rp.plan,
    proj: ctx.proj,
    junctions: st.streetPlan.junctions.map((j) => ({ s: j.s, side: j.side })),
    houses: housesOut(ctx, hs),
    parked: pf.parked.map((c) => ({ at: [c.at[0], c.at[1]] as [number, number], dir: [c.dir[0], c.dir[1]] as [number, number] })),
    ...(tf ? { trafficInput: tf.trafficInput } : {}),
    bayBoxes: rn.bayBoxes,
    previewTextures: reg.previews,
    stats,
  };
}
