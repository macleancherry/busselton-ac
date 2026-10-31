// S19.5 and S20, the track's files (track.md section 8): the kn5, the AI line and hints, surfaces,
// traffic, the map, challenges and cruise, cameras, the automatic test, CSP trees, the jetty train,
// CSP and Pure config, the street map, the shore mask, the UI files and the README; then the
// layout wrapping. File order is zip order.

import autotestLua from "../lua/autotest.lua?raw";
import jettyTrainScript from "../lua/jetty_train.lua?raw";
import { outlinePng, previewPng, readme, streetMap, surfacesIni, trackMap, uiTrackJson, type TrackMeta } from "../acFiles";
import { aiHintsIni, buildAiLine } from "../aiLine";
import { writeFastLaneAi } from "../aiSpline";
import { pointInRing } from "../buildings";
import { camerasIni, placeCameras } from "../cameras";
import { challengeFiles } from "../challengeFiles";
import { cruiseFiles } from "../cruise";
import { bakedShadowParams, extConfig } from "../cspConfig";
import { treeList, writeTreeBin } from "../cspTrees";
import type { Vec2 } from "../geo";
import { jettyTrainLua } from "../jettyTrain";
import { writeKn5, type Kn5Model } from "../kn5";
import { landmarkShots } from "../landmarkShots";
import { asLayout, dummiesKn5 } from "../layouts";
import { toAc } from "../mesh";
import { networkPreview } from "../network/preview";
import type { JunctionCore } from "../network/phase1";
import { pitLaneFiles } from "../pitLane";
import { retimeAi, ringHintValues } from "../aiRings";
import { innerRadius, outerRadius } from "../roundabout";
import { simplify } from "../polyline";
import { groundAlbedo } from "../pureConfig";
import { trackHollows } from "../rainHollows";
import { birdEmitters, soundLua, soundMode, soundReadme, surfEmitters, SOUND_SCRIPT } from "../trackSounds";
import { MODEL_NAMES, treeModel } from "../treeModels";
import { cspTreeAngle } from "../treePick";
import { TREE_SPECIES } from "../treeSprites";
import type { BuildContext } from "./context";
import type { BuildingPlan } from "./buildingPlan";
import type { Ground } from "./ground";
import type { GroundMeshes } from "./groundMeshes";
import type { Houses } from "./houses";
import type { Imagery } from "./imagery";
import { photoSeaOn } from "./kit";
import type { Scenery } from "./placeScenery";
import { PHOTO_LIGHT } from "./registry";
import type { Rings } from "./rings";
import { trackObjects, type RoutePlan } from "./routePlan";
import type { Streets } from "./streets";
import type { Surfaces } from "./surfaces";
import type { Traffic } from "./traffic";
import type { DataSources } from "./types";

const enc = new TextEncoder();
const credit = (c: DataSources["imageryCredit"]) => (typeof c === "function" ? c() : c);

export interface FilesInput {
  rp: RoutePlan; g: Ground; st: Streets; img: Imagery; bp: BuildingPlan; sf: Surfaces; rn: Rings; gm: GroundMeshes; sc: Scenery; hs: Houses;
  tf: Traffic | null; net: JunctionCore | null; parked: { at: Vec2 }[];
}

export interface FilesOut {
  files: Record<string, Uint8Array>;
  kn5: Uint8Array;
  meanWidth: number;
}

/** The speed limit (km/h) at each 1% of the lap, for the automatic test. */
const testLimits = (sf: Surfaces, nS: number) => Array.from({ length: 100 }, (_, k) => sf.speedAt(Math.min(nS - 1, Math.round(((k + 0.5) / 100) * (nS - 1)))));

/** CSP's instanced trees: one model file per species used, and the list (S19.5). */
function cspTreeFiles(ctx: BuildContext, sc: Scenery, hs: Houses, gm: GroundMeshes): Record<string, Uint8Array> {
  if (!ctx.opts.cspTrees) return {};
  const all = [...sc.treesKept, ...hs.houseTrees];
  const modelOf = (t: { model?: number; variant: number }) => t.model ?? t.variant;
  const used: number[] = [];
  for (const t of all) {
    const m = modelOf(t);
    if (m >= 0 && m < MODEL_NAMES.length && !used.includes(m)) used.push(m);
  }
  if (!used.length) return {};
  const out: Record<string, Uint8Array> = {};
  for (const m of used) out[`${ctx.slug}/extension/trees/${MODEL_NAMES[m]}.bin`] = writeTreeBin(treeModel(m));
  const placed = all.filter((t) => used.includes(modelOf(t))).map((t) => ({
    model: `${MODEL_NAMES[modelOf(t)]}.bin`,
    pos: toAc(t.x, t.y, gm.ground(t.x, t.y) - 0.1) as [number, number, number],
    angle: cspTreeAngle(t.x, t.y),
    size: t.scale,
  }));
  out[`${ctx.slug}/extension/trees/trees.txt`] = enc.encode(treeList(placed));
  return out;
}

export function writeFiles(ctx: BuildContext, model: Kn5Model, a: FilesInput, meta: Partial<TrackMeta>): FilesOut {
  const { opts, sources, slug, proj, centre, area } = ctx;
  const { rp, g, st, img, bp, sf, rn, gm, sc, hs, tf, net } = a;
  const plan = rp.plan, nS = plan.samples.length, index = g.index;
  const kn5 = writeKn5(model);
  const aiPoints = buildAiLine(plan, { keepLeft: opts.aiKeepLeft, bays: rn.bayBoxes.filter((b) => b.street === 0) });
  // networkCore: through a junction the AI line sits on the junction's surface.
  if (net) for (const p of aiPoints) { const z = net.surfaceAt([p.position[0], -p.position[2]]); if (z !== null) p.position = [p.position[0], z, p.position[2]]; }
  // aiRings: radii and speeds from the line itself, slow on the roundabouts, with their own hint.
  const aiRingList = opts.aiRings ? plan.roundabouts.map((rb) => ({ c: rb.c, rOut: outerRadius(rb), rIn: innerRadius(rb) })) : [];
  if (opts.aiRings) retimeAi(aiPoints, plan.closed, aiRingList);
  // The automatic test photographs each landmark it passes.
  const landmarkList = [
    ...(sources.landmarks ?? []).map((l) => ({ name: l.name, at: ctx.toLocal(l.at) as [number, number] })),
    ...hs.specLandmarks.map((l) => ({ name: l.name, at: l.at as [number, number] })),
  ];
  const shots = landmarkShots(aiPoints, landmarkList);
  const landmarkLine = shots.length ? `SHOTS=${shots.join(",")}\n` : "";
  const ai = writeFastLaneAi(aiPoints);
  const last = aiPoints[aiPoints.length - 1], aiTotal = last.distance + last.length;
  const limitAt = (d: number) => sf.speedAt(Math.min(nS - 1, Math.max(0, Math.round((d / aiTotal) * (nS - 1)))));
  const flip = (p: Vec2) => [p[0], -p[1]] as [number, number];
  const outline = simplify(plan.samples.map((s) => s.pos), 0.5).map(flip);
  if (plan.closed && outline.length) outline.push(outline[0]);
  const map = trackMap(outline);
  const meanWidth = plan.samples.reduce((n, s) => n + s.width, 0) / nS;
  const trackMeta: TrackMeta = { name: opts.name, ...meta } as TrackMeta;
  const builtUp = sf.town.filter((t) => t >= 1).length > nS / 2;
  const mode = soundMode(opts.trackSounds);
  const sounds = mode ? [
    ...surfEmitters(g.ocean, { roads: [plan.samples.map((s) => s.pos), ...st.streetPlan.streets.map((s) => s.pts)], ground: g.terrainH }),
    ...birdEmitters(sc.treesKept.map((t) => ({ x: t.x, y: t.y, bush: TREE_SPECIES[t.variant]?.name === "tuart" })), { roads: [plan.samples.map((s) => s.pos), ...st.streetPlan.streets.map((s) => s.pts)], ground: g.terrainH }),
  ] : undefined;
  const treeFiles = cspTreeFiles(ctx, sc, hs, gm);
  const dummies = trackObjects(plan, opts, st.gridAvoid);
  const lights = [...sc.utilities.lights, ...sc.carPark.lights, ...sc.jettyLamps.lights];
  const train = sc.jettyPrecinct.train;
  const radiusKm = outline.length ? Math.max(...outline.map((p) => Math.hypot(p[0] - outline[0][0], p[1] - outline[0][1]))) / 2000 : 0;
  const imageryCredit = credit(sources.imageryCredit), elevationCredit = credit(sources.elevationCredit);
  const kept = bp.kept;

  const files: Record<string, Uint8Array> = {
    ...(sounds?.length ? { [`${slug}/extension/sfx/README.txt`]: enc.encode(soundReadme(sounds, mode)) } : {}),
    ...(sounds?.length && mode === "lua" ? { [`${slug}/extension/${SOUND_SCRIPT}`]: enc.encode(soundLua(sounds)) } : {}),
    [`${slug}/${slug}.kn5`]: kn5,
    [`${slug}/ai/fast_lane.ai`]: ai,
    // A pit lane past the grid's boxes, and the ideal line (pitLane.ts).
    ...pitLaneFiles(slug, aiPoints, ai, dummies, plan.closed),
    [`${slug}/data/ai_hints.ini`]: enc.encode(aiHintsIni(aiPoints, limitAt, !plan.closed, opts.aiRings ? ringHintValues(aiPoints, aiRingList, plan.closed) : undefined)),
    [`${slug}/data/surfaces.ini`]: enc.encode(surfacesIni(opts.traffic, opts.streetsValid ?? !!area, centre, sf.anyUnsealed(), true)),
    ...(tf ? { [`${slug}/data/traffic.json`]: enc.encode(tf.trafficText) } : {}),
    [`${slug}/data/map.ini`]: enc.encode(map.ini),
    // Checkpoints, time trial and drift spots for the Busselton Challenges app (challengeFiles.ts).
    ...challengeFiles(slug, opts, {
      plan, dummies, nearest: (x, y, r) => index.nearest(x, y, r), toLocal: (p) => proj.toLocal(p), ground: g.terrainH,
      pois: bp.pois, routeNames: st.streetPlan.routeNames, junctions: st.streetPlan.junctions,
      streets: st.streetPlan.streets, parked: a.parked.map((c) => c.at), buildings: hs.shown.map((b) => b.ring),
    }),
    ...cruiseFiles(slug, opts.name, {
      ai: aiPoints, closed: plan.closed, landmarks: landmarkList, streets: st.streetPlan.streets,
      route: { pts: plan.samples.map((s) => s.pos), names: st.streetPlan.routeNames, limits: plan.samples.map((_, i) => sf.speedAt(i)) },
      sideLimit: builtUp ? 50 : undefined, limitAt,
    }),
    [`${slug}/data/cameras_1.ini`]: enc.encode(camerasIni(placeCameras(plan, opts, g.terrainH, (x, y) => kept.some((b) => pointInRing(x, y, b.ring))))),
    // The automatic test (scripts/windows/run-test.ps1): a track script that wakes only for a driver
    // named "Busselton Test", in every build; the same values as a data file, per layout.
    [`${slug}/data/autotest.ini`]: enc.encode(`[AUTOTEST]\nCLOSED=${plan.closed}\nLIMITS=${testLimits(sf, nS).join(",")}\n${landmarkLine}`),
    [`${slug}/extension/autotest.lua`]: enc.encode(autotestLua
      .replace("__CLOSED__", plan.closed ? "true" : "false")
      .replace("__LIMITS__", testLimits(sf, nS).join(", "))),
    ...treeFiles,
    // The jetty train's track script (jettyTrain.ts).
    ...(train && opts.jettyTrain !== false ? { [`${slug}/extension/jetty_train.lua`]: enc.encode(jettyTrainLua(jettyTrainScript, train)) } : {}),
    // The AO bakery's settings, next to the models_*.ini it bakes (bake-vao.ps1).
    [`${slug}/baked_shadow_params.ini`]: enc.encode(bakedShadowParams()),
    [`${slug}/extension/ext_config.ini`]: enc.encode(extConfig(lights, {
      autotest: true,
      flags: opts.wavingFlags !== false,
      jettyTrain: !!train && opts.jettyTrain !== false,
      drySummer: centre[0] > 112 && centre[0] < 119.5 && centre[1] > -36 && centre[1] < -30,
      sea: g.ocean.length > 0,
      photoSea: photoSeaOn(ctx, g),
      trees: treeFiles[`${slug}/extension/trees/trees.txt`] ? "trees/trees.txt" : undefined,
      vines: !!sc.farm?.vineMetres,
      hollows: opts.rainHollows ? trackHollows(model.root) : undefined,
      sounds,
      soundMode: mode,
      builtUp,
      radiusKm,
      pure: opts.pureTuning !== false ? { at: centre, albedo: groundAlbedo(img.photos), coast: g.ocean.length > 0, photoLight: { ambient: PHOTO_LIGHT.ambient, diffuse: PHOTO_LIGHT.diffuse } } : undefined,
    })),
    [`${slug}/map.png`]: map.png,
    ...(() => {
      const sm = streetMap(st.streetPlan.streets.map((s) => ({ pts: s.pts.map(flip), width: s.width })),
        plan.samples.map((s) => flip(s.pos)).concat(plan.closed ? [flip(plan.samples[0].pos)] : []));
      return { [`${slug}/extension/street_map.png`]: sm.png, [`${slug}/extension/street_map.ini`]: enc.encode(sm.ini) };
    })(),
    // Where nothing may stand, for scripts/check/shore_check.ts (shoreClear.ts).
    ...(g.shore ? (() => {
      const f = g.shore.files();
      return { [`${slug}/extension/shore_mask.png`]: f.png, [`${slug}/extension/shore_mask.ini`]: enc.encode(f.ini) };
    })() : {}),
    [`${slug}/ui/ui_track.json`]: enc.encode(uiTrackJson(trackMeta, {
      length: rp.timedLength(), width: meanWidth, pitboxes: opts.pitCount, closed: plan.closed, centre, traffic: opts.traffic,
    })),
    [`${slug}/ui/outline.png`]: outlinePng(outline),
    [`${slug}/ui/preview.png`]: previewPng(outline, plan.closed),
    [`${slug}/README.txt`]: enc.encode(readme(trackMeta, img.textured.size ? imageryCredit || "aerial imagery" : null, {
      elevation: elevationCredit,
      mapillary: (sources.seen ?? []).length > 0 || (sources.houseLooks ?? []).some((l) => !l.spec),
    })),
    ...(net ? { [`${slug}/network/junctions.json`]: enc.encode(JSON.stringify(net.json())) }
      : opts.networkCore ? networkPreview(slug, {
        lines: sources.streets?.lines ?? [], rings: sources.osm?.roundaboutRings ?? [], toLocal: (p) => proj.toLocal(p), height: g.terrainH,
      }) : {}),
  };
  // One layout of several on the map (layouts.ts).
  const laid = opts.layout ? asLayout(files, slug, opts.layout, dummiesKn5(opts.layout, dummies)) : files;
  return { files: laid, kn5, meanWidth };
}
