// S14, the scenery (track.md S14.1-10, 12-17): trees and the horizon's tree lines, fences and
// walls, farms, the rings' island planting, paths, rails and guide posts, farm roadsides, traffic
// lights, power poles and street lights, car park lights, the jetty's lamps and precinct, and the
// signs and street furniture (with their art drawn in one atlas). All stand on the scene's ground.

import { armcoNeeds, buildArmco } from "../armco";
import { ArtList } from "../art";
import { pointInRing, type Building } from "../buildings";
import { buildJettyPrecinct, type JettyPrecinct } from "../jetty";
import { jettyLights, pierDeckZ, SEA_LEVEL } from "../coast";
import { buildFarmland, vineLeafTexture } from "../farm";
import { buildFarmRoadsides, farmTextures, type FarmResult } from "../farmRoadsides";
import { buildBarriers } from "../fences";
import { letterboxes } from "../footpaths";
import { buildPieces, gateSigns, kangarooSigns, landmarks, mergeSightings, seenFeatures, streetSigns } from "../furniture";
import type { Kn5MeshNode } from "../kn5";
import { material, type Light } from "../materials";
import { buildPaths, footPathTexture, PATH_BLOCK, sharedPathTexture, type PathLine } from "../paths";
import { footOnRoad, onRoadFrom } from "../poleSpot";
import { inRoundabout } from "../road";
import { buildRingWall, innerRadius, vergeOuterRadius } from "../roundabout";
import { buildGuardRails, buildGuidePosts, buildTrees, filterTrees, railNeeds, treeTrunks, type TreeSpot } from "../scenery";
import { topSurface } from "../sceneGround";
import { LineIndex } from "../sideStreets";
import { deckZByKind } from "../swimJetty";
import { buildTrafficLights, findSignalSites, trafficLightMaterials, type SignalSite, type TrafficLightResult } from "../trafficLights";
import { horizonTree, plantTree } from "../treePick";
import { carParkLights, placeUtilities, type Utilities } from "../utilities";
import type { BuildContext } from "./context";
import type { BuildingPlan } from "./buildingPlan";
import type { Ground } from "./ground";
import type { GroundMeshes } from "./groundMeshes";
import type { Imagery } from "./imagery";
import type { Kerbing } from "./kerbing";
import type { Registry } from "./registry";
import type { RoadSurfaces } from "./roadMeshes";
import type { RoutePlan } from "./routePlan";
import type { Streets } from "./streets";
import type { Surfaces } from "./surfaces";

export interface Scenery {
  treesKept: TreeSpot[];
  trees: Kn5MeshNode[];
  trunks: Kn5MeshNode[];
  horizonTrees: Kn5MeshNode[];
  barriers: Kn5MeshNode[];
  farm: { nodes: Kn5MeshNode[]; vineMetres: number } | null;
  islandTrees: Kn5MeshNode[];
  pathMeshes: Kn5MeshNode[];
  ringWalls: Kn5MeshNode[];
  rails: { rails: Kn5MeshNode[]; posts: Kn5MeshNode[] };
  needs: [boolean[], boolean[]];
  posts: Kn5MeshNode[];
  farmRoad: FarmResult | null;
  signalSites: SignalSite[];
  signals: TrafficLightResult | null;
  utilities: Utilities;
  carPark: { pieces: unknown[]; lights: [number, number, number][] };
  jettyLamps: { nodes: Kn5MeshNode[]; lights: [number, number, number][] };
  jettyPrecinct: JettyPrecinct;
  pieces: { kind: string }[];
  furniture: Kn5MeshNode[];
  /** Kerbed samples within 150 m (wrapping on a loop). */
  kerbedNear: boolean[];
  /** The ground for buildings and shore things (S14.11). */
  horizonGround: (x: number, y: number) => number;
  shoreGround: (x: number, y: number) => number;
}

const L = (ambient: number, diffuse: number, specular: number, exp: number): Light => ({ ambient, diffuse, specular, exp });
const NO_TRAFFIC_SERVICE = /^(parking_aisle|driveway|drive-through)$/;

export async function placeScenery(
  ctx: BuildContext, rp: RoutePlan, g: Ground, st: Streets, bp: BuildingPlan, sf: Surfaces, kb: Kerbing, rm: RoadSurfaces, gm: GroundMeshes, img: Imagery, reg: Registry,
): Promise<Scenery> {
  const { opts, sources, proj, area } = ctx;
  const plan = rp.plan, index = g.index, nS = plan.samples.length;
  const ground = gm.ground;
  const streetClear = (x: number, y: number) => st.streetIndex.clearance(x, y);
  const inKept = (x: number, y: number, list: Building[] = bp.kept) => list.some((b) => pointInRing(x, y, b.ring));
  const routeNear = (x: number, y: number, r: number) => {
    const n = index.nearest(x, y, 30);
    return !!n && n.dist < index.at(n).width / 2 + r;
  };
  const cover = area ? g.cover : undefined;

  // 1. Trees from the photo, planted (species by zone, town and foreshore), off the rings, streets, clears and shore.
  const reach = Math.round(150 / opts.spacing);
  const kerbedNear = plan.samples.map((_, i) => {
    for (let d = -reach; d <= reach; d++) {
      let j = i + d;
      if (plan.closed) j = ((j % nS) + nS) % nS;
      else if (j < 0 || j >= nS) continue;
      if (plan.samples[j].kerb) return true;
    }
    return false;
  });
  const plantCtx = {
    zones: g.zones, models: g.treeModels, cspTrees: !!opts.cspTrees,
    where: (t: { x: number; y: number }) => {
      const n = index.nearest(t.x, t.y, opts.corridor + 10);
      return { town: !!n && kerbedNear[n.seg], foreshore: g.ocean.length > 0 && g.sea.near(t.x, t.y, 120) };
    },
    toLngLat: (x: number, y: number) => proj.toLngLat([x, y]) as [number, number],
  };
  const planted0 = filterTrees(img.treeSpots, index, opts, opts.maxTrees, cover).map((t) => plantTree(t, plantCtx)).filter((t): t is TreeSpot => t !== null);
  const planted = g.zones ? filterTrees(planted0, index, opts, opts.maxTrees, cover) : planted0;
  const offRings = (list: TreeSpot[]) => list.filter((t) => !inRoundabout(plan, t.x, t.y, opts.vergeWidth + 3));
  const offStreets = (list: TreeSpot[]) => list.filter((t) => streetClear(t.x, t.y) > 1.5);
  const treesKept = g.offShore(offStreets(offRings(planted)).filter((t) => !ctx.cleared(t.x, t.y, true)));
  const trees = opts.cspTrees ? [] : buildTrees(treesKept, ground, "TREES");
  const trunks = treeTrunks(treesKept, ground);

  // 2. Tree lines on the horizon: canopy in the far photo, out to 1 km, as cheap unshadowed sprites.
  const far = g.offShore(img.farTreeSpots.filter((t) => !g.inCover(t.x, t.y, -5) && g.cover(t.x, t.y) < 1000 && !g.sea.has(t.x, t.y)));
  const farStep = Math.max(1, far.length / 3000);
  const horizonTrees = buildTrees(
    Array.from({ length: Math.floor(far.length / farStep) }, (_, i) => far[Math.floor(i * farStep)])
      .map((t) => horizonTree(t, g.zones, g.treeModels)).filter((t): t is TreeSpot => t !== null),
    (x, y) => gm.farGround(x, y) - 0.6, "HORIZONTREES", 0.3,
  ).map((m) => ({ ...m, castShadows: false }));

  // 3. Fences and walls from the map.
  const ok = (x: number, y: number) => streetClear(x, y) > 1.5 && !inRoundabout(plan, x, y, opts.vergeWidth + 3);
  const barrierList = (sources.osm?.barriers ?? []).map((b) => ({ ...b, pts: ctx.line(b.pts) }));
  const barriers = buildBarriers(barrierList, index, opts, ground, ok, cover);

  // 4. Vineyards and paddocks.
  const farm = opts.farmland
    ? buildFarmland((sources.farmland ?? []).map((f) => ({ ...f, rings: f.rings.map((r) => r.map((p) => ctx.toLocal(p as [number, number]))) })), barrierList, index, opts, ground, (x, y) => ok(x, y) && !ctx.cleared(x, y), g.cover)
    : null;
  if (farm?.vineMetres) reg.scenery("vine_leaf.png", vineLeafTexture(), material("vine_leaf", "vine_leaf.png", L(0.5, 0.4, 0, 1)));

  // 5. The rings' islands: a tree in the middle and shrubs round it.
  const islandSpots: TreeSpot[] = [];
  if (opts.trees > 0) {
    for (const rb of plan.roundabouts) {
      const ri = innerRadius(rb);
      if (ri < 4) continue;
      islandSpots.push({ x: rb.c[0], y: rb.c[1], scale: Math.min(0.9, ri / 12), variant: 0 });
      const n = Math.floor(ri);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 2 * Math.PI;
        islandSpots.push({ x: rb.c[0] + Math.cos(a) * 0.55 * ri, y: rb.c[1] + Math.sin(a) * 0.55 * ri, scale: 0.22, variant: k % 2 });
      }
    }
  }
  const islandTrees = buildTrees(islandSpots, ground, "ISLANDTREES");

  // 6. Footpaths and shared paths, off every road surface.
  let pathMeshes: Kn5MeshNode[] = [];
  if (opts.paths && sources.paths) {
    const pathOnRoad = onRoadFrom(topSurface([...rm.roadMeshes.road, ...rm.sideStreets, ...gm.kerbsClear.nodes, ...gm.ringsClear.nodes], PATH_BLOCK));
    const serviceIndex = new LineIndex((sources.streets?.lines ?? [])
      .filter((l) => /^(service|parking_aisle)/.test(l.cls) && l.brunnel !== "bridge" && l.brunnel !== "tunnel")
      .map((l) => ({ pts: ctx.line(l.pts), width: 5 })));
    const verge = rm.verge;
    const onVergeBand = (x: number, y: number) => {
      if (!verge) return false;
      const n = index.nearest(x, y, 30);
      if (!n) return false;
      const band = verge.paths[n.t >= 0 ? 0 : 1][n.seg];
      if (!band) return false;
      const d = n.dist - index.at(n).width / 2;
      return d >= band.d0 - 1 && d <= band.d1 + 1;
    };
    const clear = (x: number, y: number, half: number, kind: PathLine["kind"]) => {
      if (plan.roundabouts.some((rb) => Math.hypot(x - rb.c[0], y - rb.c[1]) < vergeOuterRadius(rb, opts) + half + 0.3)) return false;
      if (routeNear(x, y, 0.5 + half)) return false;
      if (kind === "foot" && onVergeBand(x, y)) return false;
      if (serviceIndex.clearance(x, y) < half + 0.3) return false;
      if (!(streetClear(x, y) > half + 0.3)) return false;
      if (inRoundabout(plan, x, y, half + 2)) return false;
      return !footOnRoad([x, y], half, pathOnRoad);
    };
    pathMeshes = buildPaths(sources.paths.map((p) => ({ pts: ctx.line(p.pts), kind: p.kind })), ground, clear, (x, y) => g.inCover(x, y, 5));
    if (pathMeshes.length) {
      reg.texture("path_shared.png", sharedPathTexture());
      reg.texture("path_foot.png", footPathTexture());
      reg.material(material("path_shared", "path_shared.png", L(0.45, 0.45, 0.05, 10)));
      reg.material(material("path_foot", "path_foot.png", L(0.45, 0.45, 0.05, 10)));
    }
  }

  // 7. Invisible walls round the rings' islands.
  const ringWalls = plan.roundabouts.map((rb, k) => buildRingWall(rb, k, opts, g.terrainH)).filter((m): m is Kn5MeshNode => m !== null);

  // 8. Guard rails (Armco where it's needed), and guide posts where there are none.
  const osmRails = (sources.osm?.guardRails ?? []).map((l) => ctx.line(l));
  let needs = railNeeds(plan, opts, g.terrainH, osmRails, index);
  if (opts.armco && opts.guardRails) {
    const cr = sources.osm?.crossings;
    needs = armcoNeeds(plan, opts, needs, {
      ground: g.terrainH, index, speedAt: sf.speedAt,
      crossings: cr ? { bridges: cr.bridges.map((l) => ctx.line(l)), waterways: cr.waterways.map((w) => ({ ...w, pts: ctx.line(w.pts) })) } : undefined,
    });
  }
  const sideOf = (k: number): 1 | -1 => (k === 0 ? 1 : -1);
  const nearRing = (i: number) => !!inRoundabout(plan, plan.samples[i].pos[0], plan.samples[i].pos[1], 15);
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < nS; i++) {
      if (!opts.guardRails || st.mouth(sideOf(k), plan.samples[i].s) || nearRing(i) || kb.kerbAt(i, sideOf(k))) needs[k][i] = false;
    }
  }
  const rails = opts.armco ? buildArmco(plan, opts, needs, ground) : buildGuardRails(plan, opts, needs, ground);
  const postMask: [boolean[], boolean[]] = [0, 1].map((k) => plan.samples.map((s, i) => needs[k][i] || nearRing(i) || st.mouth(sideOf(k), s.s) || kb.kerbAt(i, sideOf(k)))) as [boolean[], boolean[]];
  const posts = opts.guidePosts ? buildGuidePosts(plan, opts, postMask, ground) : [];

  // 9. Farm driveways, gates, mailboxes and cattle grids.
  const farmRoad = opts.farmRoadsides ? buildFarmRoadsides({
    lines: (sources.streets?.lines ?? []).map((l) => ({ pts: ctx.line(l.pts), cls: l.cls, service: l.service })),
    cattleGrids: (sources.osm?.cattleGrids ?? []).map((p) => ctx.toLocal(p)),
    plan, index, opts, ground,
    drawn: (x, y) => streetClear(x, y) < 0.5,
    blocked: (x, y) => !g.inCover(x, y, 3) || streetClear(x, y) < 0.2 || inKept(x, y) || !!inRoundabout(plan, x, y, 3),
    skip: (seg, side) => sf.town[seg] >= 2 || kb.kerbAt(seg, side),
  }) : null;

  // 10. Traffic lights at OSM's signals.
  let signalSites: SignalSite[] = [];
  let signals: TrafficLightResult | null = null;
  const osmSignals = sources.osm?.trafficSignals ?? [];
  if (opts.trafficLights !== false && osmSignals.length) {
    const routePts = plan.samples.map((s) => s.pos), routeW = plan.samples.map((s) => s.width);
    if (plan.closed) {
      routePts.push(routePts[0]);
      routeW.push(routeW[0]);
    }
    const streetLines = opts.sideStreets ? st.streetPlan.streets.filter((s) => !NO_TRAFFIC_SERVICE.test(s.service ?? "")).map((s) => ({ pts: s.pts, width: s.width, ...(s.widths ? { widths: s.widths } : {}) })) : [];
    signalSites = findSignalSites(osmSignals.map((s) => ({ at: ctx.toLocal(s.at), crossing: s.crossing })),
      [{ pts: routePts, width: plan.samples[0].width, widths: routeW, main: true }, ...streetLines],
      (x, y) => !!inRoundabout(plan, x, y, 6));
    signals = buildTrafficLights({
      sites: signalSites, roadZ: ground, groundZ: ground,
      onRoad: (x, y) => routeNear(x, y, 0.3) || streetClear(x, y) < 0.3 || !!gm.poleOnRoad?.(x, y),
    });
    for (const t of trafficLightMaterials()) reg.scenery(t.texture, t.png, t.material);
  }
  if (farmRoad) for (const t of farmTextures()) reg.scenery(`${t.name}.png`, t.png, material(t.name, `${t.name}.png`, L(0.45, 0.45, t.name === "farm_gravel" ? 0 : 0.2, 15)));

  // 11. The ground buildings and shore things stand on.
  const horizonGround = (x: number, y: number) => gm.farGround(x, y) - 0.6;
  const shoreGround = (x: number, y: number) => (g.inCover(x, y, 1) ? g.terrainH(x, y) : horizonGround(x, y));

  // 12. Power poles, wires and street lights: seen, mapped, or (lights, in town) at a typical spacing.
  const seenLocal = mergeSightings((sources.seen ?? []).map((f) => ({ ...f, at: ctx.toLocal(f.at) })));
  const osmLocal = (pts?: [number, number][]) => (pts ?? []).map((p) => ctx.toLocal(p));
  const utilities = placeUtilities({
    poles: [...seenLocal.filter((f) => /^object--support--utility-pole/.test(f.value)).map((f) => f.at), ...osmLocal(sources.osm?.poles)],
    lamps: [...seenLocal.filter((f) => /^object--street-light/.test(f.value)).map((f) => f.at), ...osmLocal(sources.osm?.lamps)],
    lines: (sources.osm?.powerLines ?? []).map((l) => ctx.line(l)),
  }, plan, index, opts, ground, (i) => sf.town[i], (x, y) => streetClear(x, y) < 1 || inKept(x, y), gm.poleOnRoad);

  // 13. Lights in the car parks.
  const carPark = carParkLights(
    (sources.streets?.lines ?? []).filter((l) => l.service === "parking_aisle").map((l) => ctx.line(l.pts)),
    ground,
    (x, y) => !g.inCover(x, y, 5) || routeNear(x, y, 2) || streetClear(x, y) < 1.5 || !!inRoundabout(plan, x, y, 3) || inKept(x, y)
      || img.parkedSpots.some((c) => Math.hypot(c.at[0] - x, c.at[1] - y) < 3),
    utilities.lights, gm.poleOnRoad,
  );

  // 14. The jetty's lamps and what stands on it.
  const jettyLamps = g.majorPiers.length ? jettyLights(g.majorPiers, shoreGround, g.sea) : { nodes: [], lights: [] };
  const jettyPrecinct: JettyPrecinct = g.jettyFeatures
    ? buildJettyPrecinct(g.jettyFeatures, deckZByKind(g.piers, g.pierKinds, pierDeckZ(shoreGround, g.sea), shoreGround, g.sea), g.onJetty, SEA_LEVEL)
    : { nodes: [], footprints: [] };

  // 16. Signs and street furniture; their artwork is drawn in one atlas.
  const art = new ArtList();
  const pieces = [
    ...(opts.streetSigns ? streetSigns(st.streetPlan, plan, opts, art, ground, gm.poleOnRoad) : []),
    ...(opts.landmarks ? landmarks(bp.pois, plan, index, opts, art, (x, y) => Math.min(streetClear(x, y), inKept(x, y) ? -1 : Infinity), ground) : []),
    ...seenFeatures((sources.seen ?? []).map((f) => ({ ...f, at: ctx.toLocal(f.at) }))
      .filter((f) => !(signals && /^object--traffic-light/.test(f.value) && signalSites.some((s) => Math.hypot(s.c[0] - f.at[0], s.c[1] - f.at[1]) < 35))),
    plan, index, opts, art, ground, gm.poleOnRoad),
    ...gateSigns(plan, opts, art, ground),
    ...(opts.streetSigns ? kangarooSigns(plan, opts, art, (i) => sf.town[i] === 0 && sf.speedAt(i) >= 80 && !kerbedNear[i],
      (i, side) => st.mouth(side, plan.samples[i].s) || st.mouths.some((j) => j.side === side && Math.abs(j.s - plan.samples[i].s) < j.width / 2 + 6), ground) : []),
    ...utilities.pieces,
    ...carPark.pieces,
    ...(rm.verge ? letterboxes(plan, rm.verge, ground) : []),
  ];
  // 17. The sign atlas, then the pieces' meshes.
  const atlas = sources.renderArt && art.list.length ? await sources.renderArt(art.list) : null;
  if (atlas) reg.scenery("signart.png", atlas.data, { ...material("signart", "signart.png", L(0.55, 0.45, 0.15, 20)), shader: "ksPerPixelAT", alphaTested: true });
  const furniture = buildPieces(pieces, atlas);

  return {
    treesKept, trees, trunks, horizonTrees, barriers, farm, islandTrees, pathMeshes, ringWalls, rails, needs, posts, farmRoad,
    signalSites, signals, utilities, carPark, jettyLamps, jettyPrecinct, pieces, furniture, kerbedNear, horizonGround, shoreGround,
  };
}

