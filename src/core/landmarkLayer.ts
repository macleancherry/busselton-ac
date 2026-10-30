// Busselton fork: a landmark (a building spec, specHouse.ts) as a model of its own, with every
// material and texture it uses, so it can go into a track as a layer (models.ini) without
// regenerating the track. The base build clears the landmark's spot (landmarkClear); this builds
// what stands there. See ROADMAP.md, "generate, freeze, polish".

import type { HeightFn } from "./elevation";
import type { LngLat } from "./geo";
import type { Kn5Material, Kn5MeshNode, Kn5Model, Kn5Texture } from "./kn5";
import { IDENTITY } from "./kn5";
import { encodeDdsDxt1 } from "./dds";
import { decodeOwnPng, encodePng } from "./png";
import { buildSpecHouse, type HouseSpec, type SpecPlacement } from "./specHouse";
import { ROOF_COLOURS, facadeTexture, roofTexture } from "./buildingStyles";
import { normalFromHeight, solidTexture, windowTexture } from "./textures";
import { hedgeTexture } from "./houseTextures";
import { treeSpeciesAtlas } from "./treeSprites";
import { buildTrees } from "./scenery";
import { surfaceTexture } from "./surfaceTextures";
import type { SignDrawer } from "./shops";
import { material, nmMaterial } from "./materials";
import { flagMaterial } from "./flags";

type Light = { ambient: number; diffuse: number; specular: number; exp: number };

export interface LandmarkModel {
  model: Kn5Model;
  /** The blocks' footprints on the map (local metres), and the yard's reach from the centre, metres. */
  footprints: [number, number][][];
  triangles: number;
}

/** How far the landmark's spec reaches from its centre (blocks, yard, fences), metres: the spot the base clears. */
export function landmarkReach(spec: HouseSpec): number {
  const main = spec.blocks.filter((b) => !b.outbuilding);
  const cx = (Math.min(...main.map((b) => b.x0)) + Math.max(...main.map((b) => b.x1))) / 2;
  const cy = (Math.min(...main.map((b) => b.y0)) + Math.max(...main.map((b) => b.y1))) / 2;
  const pts: [number, number][] = [];
  const rect = (r: { x0: number; x1: number; y0: number; y1: number }) => pts.push([r.x0, r.y0], [r.x1, r.y1], [r.x0, r.y1], [r.x1, r.y0]);
  spec.blocks.forEach(rect);
  (spec.paving ?? []).forEach(rect);
  (spec.verandahs ?? []).forEach(rect);
  (spec.awnings ?? []).forEach(rect);
  for (const f of spec.fences ?? []) pts.push([f.x0, f.y0], [f.x1, f.y1]);
  for (const s of spec.signs ?? []) pts.push([s.x0, s.y], [s.x1, s.y]);
  return Math.max(...pts.map(([x, y]) => Math.hypot(x - cx, y - cy))) + 1.5;
}

/** The base build's clear for a landmark: its spot, generated buildings and trees removed. */
export function landmarkClear(at: LngLat, spec: HouseSpec): { at: LngLat; radius: number } {
  return { at, radius: landmarkReach(spec) };
}

/**
 * The landmark as a model: its meshes (and invisible walls), its trees, and the materials and
 * textures for all of them, named after `tag` so several landmarks can share a track.
 */
export function landmarkModel(
  spec: HouseSpec,
  place: SpecPlacement,
  tag: string,
  ground: HeightFn,
  opts: { detailShaders?: boolean; drawSigns?: SignDrawer } = {},
): LandmarkModel {
  const sh = buildSpecHouse(spec, place, tag);
  const textures: Kn5Texture[] = [];
  const materials: Kn5Material[] = [];
  const have = new Set<string>();
  const plain = (name: string, png: Uint8Array, light: Light) => {
    if (have.has(name)) return;
    have.add(name);
    textures.push({ name: `${name}.png`, data: png });
    materials.push(material(name, `${name}.png`, light));
  };
  const relief = (name: string, png: Uint8Array, light: Light, strength: number) => {
    if (have.has(name)) return;
    have.add(name);
    const { rgba, width, height } = decodeOwnPng(png);
    textures.push({ name: `${name}.dds`, data: encodeDdsDxt1(rgba, width, height) });
    if (opts.detailShaders === false) {
      materials.push(material(name, `${name}.dds`, light));
      return;
    }
    textures.push({ name: `${name}_nm.dds`, data: encodeDdsDxt1(normalFromHeight(rgba, width, height, strength), width, height) });
    materials.push(nmMaterial(name, `${name}.dds`, `${name}_nm.dds`, light));
  };
  for (const fc of sh.facades) relief(`facade_${fc.name}`, facadeTexture(fc), { ambient: 0.45, diffuse: 0.45, specular: 0.05, exp: 10 }, 3);
  for (const r of sh.roofs) relief(`roof_${ROOF_COLOURS[r].name}`, roofTexture(ROOF_COLOURS[r]), { ambient: 0.45, diffuse: 0.45, specular: 0.25, exp: 25 }, 4);
  for (const so of sh.solids) {
    // Flag cloth: the flag shader, so it waves (flags.ts).
    if (so.flag) {
      if (!have.has(so.name)) {
        have.add(so.name);
        textures.push({ name: `${so.name}.png`, data: solidTexture(so.rgb) });
        materials.push(flagMaterial(so.name, `${so.name}.png`));
      }
      continue;
    }
    if (so.surface) relief(so.name, surfaceTexture(so.surface, so.rgb), { ambient: 0.45, diffuse: 0.45, specular: so.surface === "steel" || so.surface === "colorbond" ? 0.25 : 0.06, exp: 15 }, so.surface === "brick" ? 4 : 2);
    else plain(so.name, solidTexture(so.rgb), { ambient: 0.45, diffuse: 0.45, specular: 0.1, exp: 10 });
  }
  for (const sg of sh.signs) {
    const w = 1024, h = Math.max(64, Math.min(512, Math.round((w * sg.height) / Math.max(0.1, sg.width) / 32) * 32));
    const drawn = opts.drawSigns?.([{ text: sg.text, bg: sg.bg, ink: sg.ink, squeeze: 1 }], w, h);
    plain(sg.name, drawn ? encodePng(new Uint8Array(drawn.buffer, drawn.byteOffset, drawn.byteLength), w, h) : solidTexture(sg.bg), { ambient: 0.5, diffuse: 0.45, specular: 0.1, exp: 15 });
  }
  // Shared materials the spec meshes use, carried in the layer under the same names as the base's.
  const used = new Set(sh.nodes.map((n) => n.material));
  if (used.has("window")) plain("window", windowTexture(), { ambient: 0.35, diffuse: 0.3, specular: 0.6, exp: 80 });
  if (used.has("hedge")) plain("hedge", hedgeTexture(), { ambient: 0.5, diffuse: 0.4, specular: 0, exp: 1 });
  const nodes: Kn5MeshNode[] = [...sh.nodes];
  if (sh.trees.length) {
    nodes.push(...buildTrees(sh.trees, ground, `TREES_${tag}`));
    if (!have.has("trees")) {
      have.add("trees");
      textures.push({ name: "trees.png", data: treeSpeciesAtlas() });
      materials.push({ ...material("trees", "trees.png", { ambient: 0.55, diffuse: 0.35, specular: 0, exp: 1 }), shader: "ksPerPixelAT", alphaTested: true });
    }
  }
  const triangles = nodes.reduce((a, n) => a + n.indices.length / 3, 0);
  return {
    model: { textures, materials, root: { kind: "node", name: `LANDMARK_${tag}`, transform: IDENTITY, children: nodes } },
    footprints: sh.footprints as [number, number][][],
    triangles,
  };
}
