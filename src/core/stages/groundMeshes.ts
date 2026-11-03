// S13, the terrain and the one ground (track.md S13): the terrain chunks under the streets, the
// horizon, the invisible walls, the kerbs and rings kept off the route, and the scene's ground:
// the topmost physics mesh at a point, else the analytic terrain. Everything placed later
// stands on it.

import { backdropSurface, buildBackdropChunk } from "../backdrop";
import { keepOffRoute, onRoute, type OnRoad } from "../clearance";
import type { Kn5MeshNode } from "../kn5";
import { onRoadFrom } from "../poleSpot";
import { buildWalls } from "../roadMesh";
import { buildAiLine } from "../aiLine";

/** Busselton fork: corridor walls keep at least this far off the AI line, metres. */
const AI_WALL_GAP = 1.2;
import { LineIndex } from "../sideStreets";
import { ROAD_SURFACE, sceneGround, topSurface, type SceneGround } from "../sceneGround";
import { buildTerrainChunk, isNetSurfaceNode, isStreetNode, streetCeiling, underStreets } from "../terrain";
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
  /**
   * The built road surfaces, kerbs and rings: the route's road, side streets, kerbs and returns kept
   * off the route, rings, and networkCore's junctions and street dress. Scenery that keeps off roads
   * (paths, poles, parked cars) reads these, so none misses the network's meshes.
   */
  built: Kn5MeshNode[];
  /** On the built road (poles and posts keep off), unless poleClear is false. */
  poleOnRoad: ((x: number, y: number) => boolean) | undefined;
}

export async function buildGroundMeshes(
  ctx: BuildContext, rp: RoutePlan, g: Ground, st: Streets, rm: RoadSurfaces, rn: Rings, img: Imagery, progress: Progress,
): Promise<GroundMeshes> {
  const { opts, area } = ctx;
  const plan = rp.plan, index = g.index;
  const groundAt = underStreets(g.terrainAt, streetCeiling([...rm.sideStreets, ...rm.kerbReturns.filter(isStreetNode), ...rn.netNodes.filter(isNetSurfaceNode)], opts.terrainStep));
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
  // Busselton fork: the walls open where another layout's drive crosses them (Collie's short layout
  // took its southern link through the long layout's wall in retest 6). 16 m: a raceway's width, plus
  // room for a drive cutting a junction corner inside the drive's own coordinates (the town layout's
  // AI line passed 0.9 m from the main drive's wall at Queen and Albert, sights 0.4 m, at 10 m).
  const drives = (opts.layoutDrives ?? []).filter((d) => d.coords.length > 1);
  const driveIndex = drives.length ? new LineIndex(drives.map((d) => ({ pts: d.coords.map(ctx.toLocal), width: 16 }))) : null;
  // Busselton fork: and where they come within AI_WALL_GAP of the AI line (the inside of a junction
  // turn: retest 6's town and sights layouts had walls 0.4 to 0.9 m off it). The line as files.ts
  // builds it, without the bays (they move it by centimetres).
  const aiIndex = new LineIndex([{ pts: buildAiLine(plan, { keepLeft: opts.aiKeepLeft }).map((p): [number, number] => [p.position[0], -p.position[2]]), width: AI_WALL_GAP * 2 }]);
  const walls = buildWalls(plan, opts, g.terrainH, index, (x, y) => aiIndex.clearance(x, y) < 0 || (!!driveIndex && driveIndex.clearance(x, y) < 0));
  const onRoad = onRoute(plan, index);
  const km = rm.kerbMeshes;
  const kerbsClear = keepOffRoute([...km.gutter, ...km.kerb, ...km.strip, ...rm.kerbReturns, ...rm.vergeConcrete], onRoad);
  const ringsClear = keepOffRoute(rn.ringNodes, onRoad);
  const built = [...rm.roadMeshes.road, ...rm.sideStreets, ...kerbsClear.nodes, ...ringsClear.nodes, ...rn.netNodes];
  const ground = sceneGround([...built, ...rm.roadMeshes.verge, ...terrainNodes], g.terrainH);
  const poleOnRoad = opts.poleClear !== false ? onRoadFrom(topSurface(built, ROAD_SURFACE)) : undefined;
  return { terrainNodes, backdropNodes, farGround, walls, onRoad, kerbsClear, ringsClear, ground, built, poleOnRoad };
}
