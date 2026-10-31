// The texture and material registry (track.md sections 6 and 13). The kn5 writes textures and
// materials in list order and meshes refer to materials by place, so the order things are
// registered in is part of the output: every stage registers through here, in build order.

import type { Kn5Material, Kn5Texture } from "../kn5";
import type { TerrainChunk } from "../terrain";
import type { ZoneMap } from "../zones";
import { decodeOwnPng, encodePng } from "../png";
import { encodeDdsDxt1 } from "../dds";
import { groundMask, normalFromHeight } from "../textures";
import { groundMaterial, material, nmMaterial, type Light } from "../materials";

export type Preview = { rgba: Uint8Array; width: number; height: number };
type Pixels = Uint8Array | Uint8ClampedArray;

/** Lighting of every photo surface (terrain, strips, rings, returns). */
export const PHOTO_LIGHT: Light = { ambient: 0.6, diffuse: 0.2, specular: 0, exp: 1 };

export class Registry {
  readonly textures: Kn5Texture[] = [];
  readonly materials: Kn5Material[] = [];
  readonly previews: Record<string, Preview> = {};
  /** Landscape zones, when on: they bias a terrain photo's ground mask. */
  zones: ZoneMap | null = null;

  constructor(readonly detailShaders: boolean) {}

  texture(name: string, data: Uint8Array): void {
    this.textures.push({ name, data });
  }

  material(m: Kn5Material): void {
    this.materials.push(m);
  }

  /** Swaps a registered material for another of the same name, keeping its place. */
  replaceMaterial(m: Kn5Material): void {
    const i = this.materials.findIndex((x) => x.name === m.name);
    if (i >= 0) this.materials[i] = m;
    else this.materials.push(m);
  }

  preview(name: string, p: Preview): void {
    this.previews[name] = p;
  }

  hasTexture(name: string): boolean {
    return this.textures.some((t) => t.name === name);
  }

  hasMaterial(name: string): boolean {
    return this.materials.some((m) => m.name === name);
  }

  /** A texture and its material. */
  scenery(textureName: string, data: Uint8Array, m: Kn5Material): void {
    this.texture(textureName, data);
    this.material(m);
  }

  /**
   * A PNG texture with relief: with detail shaders a normal map from its brightness (`strength`)
   * and an NM material, else a plain one. Registered as `<name>.png` (+ `<name>_nm.png`).
   */
  relief(name: string, png: Uint8Array, light: Light, strength: number): void {
    const tex = `${name}.png`;
    this.texture(tex, png);
    if (!this.detailShaders) {
      this.material(material(name, tex, light));
      return;
    }
    const d = decodeOwnPng(png);
    this.texture(`${name}_nm.png`, encodePng(normalFromHeight(d.rgba, d.width, d.height, strength), d.width, d.height, { alpha: false }));
    this.material(nmMaterial(name, tex, `${name}_nm.png`, light));
  }

  /**
   * A building finish (facade, roof, spec-house surface) from a PNG: DXT1 `<name>.dds` with its
   * pixels kept for the preview, and with detail shaders a DXT1 normal map and an NM material.
   */
  building(name: string, png: Uint8Array, light: Light, strength: number): void {
    const d = decodeOwnPng(png);
    const tex = `${name}.dds`;
    this.texture(tex, encodeDdsDxt1(d.rgba, d.width, d.height));
    this.preview(tex, d);
    if (this.detailShaders) {
      this.texture(`${name}_nm.dds`, encodeDdsDxt1(normalFromHeight(d.rgba, d.width, d.height, strength), d.width, d.height));
      this.material(nmMaterial(name, tex, `${name}_nm.dds`, light));
    } else {
      this.material(material(name, tex, light));
    }
  }

  /** The ground mask of a photo (`<name>_mask.dds`), zone-biased for a terrain chunk; returns its name. */
  photoMask(name: string, rgba: Pixels, width: number, height: number, chunk?: TerrainChunk): string {
    const mask = groundMask(rgba, width, height);
    if (chunk && this.zones) this.zones.biasMask(mask, chunk);
    const tex = `${name}_mask.dds`;
    this.texture(tex, encodeDdsDxt1(mask.rgba, mask.width, mask.height));
    return tex;
  }

  /** The material of a photo surface: the ground shader over its mask with detail shaders, else plain. */
  photoGround(name: string, tex: string, img: Preview): Kn5Material {
    return this.detailShaders ? groundMaterial(name, tex, this.photoMask(name, img.rgba, img.width, img.height), PHOTO_LIGHT) : material(name, tex, PHOTO_LIGHT);
  }
}
