// S13, the terrain and the one ground (track.md S13): the terrain chunks under the streets, the
// horizon, the invisible walls, the kerbs and rings kept off the route, and the scene's ground:
// the topmost physics mesh at a point, else the analytic terrain. Everything placed later
// stands on it.

import { backdropSurface, buildBackdropChunk } from "../backdrop";
import { keepOffRoute, onRoute, type OnRoad } from "../clearance";
import type { Kn5MeshNode } from "../kn5";
import { onRoadFrom } from "../poleSpot";
import { buildWalls } from "../roadMesh";
import { ROAD_SURFACE, sceneGround, topSurface, type SceneGround } from "../sceneGround";
import { buildTerrainChunk, isStreetNode, streetCeiling, underStreets } from "../terrain";
import type { BuildContext } from "./context";
import type { Ground } from "./ground";
import type { Imagery } from "./imagery";
import type { RoadSurfaces } from "./roadMeshes";
import type { Rings } from "./rings";
import type { RoutePlan } from "./routePlan";
import type { Streets } from "./streets";
import type { Progress } from "./types";

export interface GroundMeshes {
  terrainNodes: Kn5MeshNode[];
  backdropNodes: Kn5MeshNode[];
  /** The horizon's surface (backdrop.ts). */
  farGround: (x: number, y: number) => number;
  walls: Kn5MeshNode[];
  onRoad: OnRoad;
  kerbsClear: { nodes: Kn5MeshNode[]; dropped: number };
  ringsClear: { nodes: Kn5MeshNode[]; dropped: number };
  ground: SceneGround;
  /** On the built road (poles and posts keep off), unless poleClear is false. */
  poleOnRoad: ((x: number, y: number) => boolean) | undefined;
}

export async function buildGroundMeshes(
  ctx: BuildContext, rp: RoutePlan, g: Ground, st: Streets, rm: RoadSurfaces, rn: Rings, img: Imagery, progress: Progress,
): Promise<GroundMeshes> {
  const { opts, area } = ctx;
  const plan = rp.plan, index = g.index;
  const groundAt = underStreets(g.terrainAt, streetCeiling([...rm.sideStreets, ...rm.kerbReturns.filter(isStreetNode), ...rn.netNodes], opts.terrainStep));
  const terrainNodes: Kn5MeshNode[] = [];
  for (let i = 0; i < g.chunks.length; i++) {
    await progress("Building road and terrain meshes", i / g.chunks.length);
    const chunk = g.chunks[i];
    const node = buildTerrainChunk(chunk, groundAt, opts, img.textured.has(chunk.key), area, (x, y) => st.streetIndex.clearance(x, y) < 4);
    if (node) terrainNodes.push(node);
  }
  const cover = area ? g.cover : undefined;
  const farGround = backdropSurface(g.farDem, index, opts, cover, g.terrainH);
  const backdropNodes: Kn5MeshNode[] = [];
  for (const chunk of g.backdrop) {
    const node = buildBackdropChunk(chunk, g.farDem, index, opts, img.textured.has(chunk.key), cover, g.terrainH);
    if (node) backdropNodes.push(node);
  }
  const walls = buildWalls(plan, opts, g.terrainH, index);
  const onRoad = onRoute(plan, index);
  const km = rm.kerbMeshes;
  const kerbsClear = keepOffRoute([...km.gutter, ...km.kerb, ...km.strip, ...rm.kerbReturns, ...rm.vergeConcrete], onRoad);
  const ringsClear = keepOffRoute(rn.ringNodes, onRoad);
  const ground = sceneGround([...rm.roadMeshes.road, ...rm.roadMeshes.verge, ...rm.sideStreets, ...kerbsClear.nodes, ...ringsClear.nodes, ...rn.netNodes, ...terrainNodes], g.terrainH);
  const poleOnRoad = opts.poleClear !== false
    ? onRoadFrom(topSurface([...rm.roadMeshes.road, ...rm.sideStreets, ...kerbsClear.nodes, ...ringsClear.nodes, ...rn.netNodes], ROAD_SURFACE))
    : undefined;
  return { terrainNodes, backdropNodes, farGround, walls, onRoad, kerbsClear, ringsClear, ground, poleOnRoad };
}
