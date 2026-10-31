// S18, the model tree (track.md section 7): every group in its fixed order, empty ones included,
// so the group names live in one place. groundCheck, poleCheck, padClear, parkedCheck, cull and
// the autotest report find things by these names.

import { buildGroynes, buildPiers, buildSea, buildSeawall } from "../coast";
import { keepOffRoute } from "../clearance";
import { cullable } from "../cull";
import { IDENTITY, type Kn5GroupNode, type Kn5Model, type Kn5Node } from "../kn5";
import { softenKerbFaces } from "../kerbAo";
import { buildShoreFoam } from "../photoSea";
import { buildTrees, treeTrunks } from "../scenery";
import { buildSwimJetties } from "../swimJetty";
import type { BuildContext } from "./context";
import type { Ground } from "./ground";
import type { GroundMeshes } from "./groundMeshes";
import type { Houses } from "./houses";
import type { Imagery } from "./imagery";
import { photoSeaOn } from "./kit";
import type { Marks } from "./marks";
import type { Scenery } from "./placeScenery";
import type { Registry } from "./registry";
import type { RoadSurfaces } from "./roadMeshes";
import type { Rings } from "./rings";
import { trackObjects } from "./routePlan";
import type { RoutePlan } from "./routePlan";
import type { Streets } from "./streets";

export interface AssembleInput {
  rp: RoutePlan; g: Ground; st: Streets; img: Imagery; rm: RoadSurfaces; mk: Marks; rn: Rings; gm: GroundMeshes; sc: Scenery; hs: Houses;
  houses: Kn5Node[]; lots: Kn5Node[];
}

export function assemble(ctx: BuildContext, reg: Registry, a: AssembleInput): Kn5Model {
  const { opts, sources } = ctx;
  const { rp, g, st, img, rm, mk, rn, gm, sc, hs } = a;
  const index = g.index, onRoad = gm.onRoad, ground = gm.ground;
  const group = (name: string, children: Kn5Node[]): Kn5GroupNode => ({ kind: "node", name, transform: IDENTITY, children });
  const railsClear = keepOffRoute(sc.rails.rails, onRoad);
  const piers = g.piers;
  return {
    textures: reg.textures,
    materials: reg.materials,
    root: group(ctx.slug, [
      ...cullable([
        group("ROAD", rm.roadMeshes.road),
        group("SIDESTREETS", rm.sideStreets),
        group("JUNCTIONS", rn.netNodes),
        group("FURNITURE", sc.furniture),
        group("WIRES", sc.utilities.wires),
        group("ROUNDABOUTS", [...softenKerbFaces(gm.ringsClear.nodes), ...sc.islandTrees, ...sc.ringWalls]),
        group("MARKINGS", mk.markings),
        group("VERGE", rm.roadMeshes.verge),
        // Kerb faces lean their normals up so the AO bake doesn't blacken them (kerbAo.ts).
        group("KERBS", softenKerbFaces(gm.kerbsClear.nodes)),
        group("TREES", [...sc.trees, ...(hs.houseTrees.length && !opts.cspTrees ? buildTrees(hs.houseTrees, ground, "HOUSETREES") : [])]),
        group("RAILS", [...railsClear.nodes, ...sc.rails.posts]),
        group("GUIDEPOSTS", sc.posts),
        group("FARMROAD", sc.farmRoad?.nodes ?? []),
        group("TRAFFICLIGHTS", sc.signals?.nodes ?? []),
        group("BUILDINGS", [...a.houses, ...hs.specNodes]),
        group("SHOPS", hs.shopMeshes),
        group("FENCES", keepOffRoute(sc.barriers, onRoad).nodes),
        group("FARM", sc.farm ? keepOffRoute(sc.farm.nodes, onRoad).nodes : []),
        group("PATHS", sc.pathMeshes),
        group("LOTS", keepOffRoute(a.lots as Parameters<typeof keepOffRoute>[0], onRoad).nodes),
        group("JETTY", piers.length ? [...buildPiers(g.majorPiers, sc.shoreGround, g.sea), ...buildSwimJetties(piers, g.pierKinds, sc.shoreGround, g.sea), ...sc.jettyLamps.nodes, ...sc.jettyPrecinct.nodes] : []),
        group("SEAWALL", g.ocean.length ? [
          ...buildSeawall(g.beaches, sc.shoreGround, g.sea, (x, y) => !!index.nearest(x, y, 250), piers),
          ...buildGroynes((sources.osm?.groynes ?? []).map((l) => ctx.line(l)), sc.shoreGround),
        ] : []),
      ]),
      group("TERRAIN", gm.terrainNodes),
      group("HORIZON", [...gm.backdropNodes, ...sc.horizonTrees]),
      group("SEA", g.ocean.length ? [
        ...buildSea(g.ocean, photoSeaOn(ctx, g) ? { transparent: true } : {}),
        ...(img.seaLayer?.nodes ?? []),
        ...(photoSeaOn(ctx, g) ? buildShoreFoam(g.ocean, g.sea, piers) : []),
      ] : []),
      group("WALLS", [...gm.walls, ...sc.trunks, ...(hs.houseTrees.length ? treeTrunks(hs.houseTrees, ground) : [])]),
      // A layout's dummies go in their own kn5 (layouts.ts).
      ...(opts.layout ? [] : trackObjects(rp.plan, opts, st.gridAvoid)),
    ]),
  };
}
