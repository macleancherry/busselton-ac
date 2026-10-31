// S4, the fixed material kit (track.md section 6, steps 1-9): the textures and materials every
// build has, in their fixed order, before any photo or road surface.

import { deckTexture, rockTexture, seaTexture } from "../coast";
import { encodeDdsDxt1 } from "../dds";
import { FENCE_COLOURS, fenceTexture, frontWallTexture, hedgeTexture, mulchTexture, shrubAtlas } from "../houseTextures";
import { JETTY_MATERIALS } from "../jetty";
import { groundMaterial, material, type Light } from "../materials";
import { seaSurfaceMaterial, seaSurfaceTexture } from "../photoSea";
import {
  BARRIERS, barrierTexture, concreteTexture, detailTexture, flatNormalTexture, garageTexture, grassTexture, groundDetail,
  mapsTexture, paintTexture, postTexture, railTexture, solidTexture, vergeTexture, windowTexture,
} from "../textures";
import { treeAtlasTexture } from "../treeAtlasMips";
import { treeSpeciesAtlas } from "../treeSprites";
import type { RoadPlan } from "../road";
import type { BuildContext } from "./context";
import type { Ground } from "./ground";
import type { Registry } from "./registry";

const L = (ambient: number, diffuse: number, specular: number, exp: number): Light => ({ ambient, diffuse, specular, exp });
const GROUND_LIGHT = L(0.45, 0.4, 0, 1);

/** Whether this build's sea is drawn from the photo (photoSea on and sea in view). */
export const photoSeaOn = (ctx: BuildContext, g: Ground) => ctx.opts.photoSea !== false && g.ocean.length > 0;

export function addKit(reg: Registry, ctx: BuildContext, g: Ground, plan: RoadPlan): void {
  const { opts } = ctx;
  const solid = (name: string, rgb: [number, number, number], light: Light) => reg.scenery(`${name}.png`, solidTexture(rgb), material(name, `${name}.png`, light));
  const plain = (name: string, png: Uint8Array, light: Light) => reg.scenery(`${name}.png`, png, material(name, `${name}.png`, light));

  // 1. The verge (the zones' colour along the road), grass and walls.
  reg.texture("verge.png", g.zones ? g.zones.vergeTexture(plan.samples.map((s) => s.pos)) : vergeTexture());
  reg.texture("grass.png", grassTexture());
  reg.texture("wall.png", solidTexture([128, 128, 128]));
  reg.material(material("verge", "verge.png", GROUND_LIGHT));
  reg.material(material("grass", "grass.png", GROUND_LIGHT));
  reg.material(material("wall", "wall.png", L(0.4, 0.4, 0, 1)));

  // 2. Trees (the atlas with its own mips unless treeMips is false), paint and the small things.
  const trees = opts.treeMips === false ? { name: "trees.png", data: treeSpeciesAtlas(), preview: undefined } : treeAtlasTexture();
  if (trees.preview) reg.preview(trees.name, trees.preview);
  reg.scenery(trees.name, trees.data, { ...material("trees", trees.name, L(0.55, 0.35, 0, 1)), shader: "ksPerPixelAT", alphaTested: true });
  plain("paint", paintTexture(), L(0.5, 0.5, 0.1, 15));
  solid("paint_yellow", [226, 182, 32], L(0.5, 0.5, 0.1, 15));
  solid("rrpm", [238, 238, 232], L(0.6, 0.5, 0.6, 40));
  solid("timber", [92, 74, 58], L(0.45, 0.45, 0, 1));
  solid("glass", [120, 140, 150], L(0.4, 0.3, 0.6, 60));
  solid("canopy", [236, 236, 232], L(0.5, 0.45, 0.1, 10));
  solid("lamp", [150, 152, 150], L(0.45, 0.45, 0.3, 30));
  solid("signal", [28, 30, 26], L(0.4, 0.4, 0.2, 20));
  plain("rail", railTexture(), L(0.4, 0.45, 0.3, 30));

  // 3. Fences and walls from the map.
  for (const b of BARRIERS) reg.relief(`barrier_${b}`, barrierTexture(b), L(0.45, 0.45, 0.1, 15), b === "hedge" ? 2 : 3);

  // 4. House parts.
  plain("window", windowTexture(), L(0.35, 0.3, 0.6, 80));
  solid("door", [92, 62, 44], L(0.45, 0.45, 0.15, 15));
  plain("garage", garageTexture(), L(0.45, 0.45, 0.2, 20));
  solid("letterbox", [168, 52, 40], L(0.45, 0.45, 0.25, 25));

  // 5. Detail shaders: road details, ground layers and masks; grass and verge onto the ground shader.
  if (opts.detailShaders) {
    reg.texture("detail_asphalt.png", detailTexture("asphalt"));
    reg.texture("detail_chipseal.png", detailTexture("chipseal"));
    for (const k of ["grass", "dirt", "plain"] as const) reg.texture(`ground_${k}.dds`, encodeDdsDxt1(groundDetail(k), 512, 512));
    reg.texture("black.png", solidTexture([0, 0, 0]));
    reg.texture("mask_grass.png", solidTexture([255, 0, 0]));
    reg.texture("mask_dirt.png", solidTexture([0, 255, 0]));
    reg.replaceMaterial(groundMaterial("grass", "grass.png", "mask_grass.png", GROUND_LIGHT));
    reg.replaceMaterial(groundMaterial("verge", "verge.png", "mask_dirt.png", GROUND_LIGHT));
    reg.texture("flat_nm.png", flatNormalTexture());
    reg.texture("maps_ground.png", mapsTexture(0.1, 0.15, 0));
    reg.texture("maps_asphalt.png", mapsTexture(0.7, 0.5, 0.35));
  }

  // 6. Wires, steel, concrete, guide posts.
  solid("wire", [38, 38, 40], L(0.35, 0.35, 0.2, 20));
  solid("steel", [120, 122, 126], L(0.4, 0.45, 0.2, 20));
  plain("concrete", concreteTexture(), L(0.45, 0.45, 0.05, 10));
  plain("guidepost", postTexture(), L(0.45, 0.45, 0.1, 10));

  // 7. The sea, sea or not: the photo sea's surface, else the plain sea.
  if (photoSeaOn(ctx, g)) reg.scenery("sea.png", seaSurfaceTexture(), seaSurfaceMaterial());
  else plain("sea", seaTexture(), L(0.4, 0.35, 0.7, 90));

  // 8. Sea walls and jetties.
  reg.relief("rock", rockTexture(), L(0.45, 0.45, 0.05, 10), 4);
  plain("jetty_deck", deckTexture(), L(0.45, 0.45, 0.05, 10));
  if (g.jettyFeatures) for (const j of JETTY_MATERIALS) solid(j.name, j.rgb, L(0.45, 0.5, j.name === "jetty_rail" ? 0.4 : 0.05, 20));
  solid("jetty_timber", [118, 108, 96], L(0.45, 0.45, 0, 1));

  // 9. Front yards: colorbond fences, low front walls, hedges, mulch, shrubs.
  for (const c of FENCE_COLOURS) reg.relief(`fence_${c.name}`, fenceTexture(c.rgb), L(0.45, 0.45, 0.2, 25), 2);
  for (const w of ["limestone", "brick"] as const) reg.relief(`frontwall_${w}`, frontWallTexture(w), L(0.45, 0.45, 0.05, 10), 3);
  plain("hedge", hedgeTexture(), L(0.5, 0.4, 0, 1));
  plain("mulch", mulchTexture(), L(0.45, 0.45, 0, 1));
  reg.scenery("shrubs.png", shrubAtlas(), { ...material("shrubs", "shrubs.png", L(0.55, 0.35, 0, 1)), shader: "ksPerPixelAT", alphaTested: true });
}
