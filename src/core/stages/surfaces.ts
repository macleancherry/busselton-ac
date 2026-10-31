// S8, the road surfaces' materials, the town level and the speed limits (track.md S8). The
// material factories register a texture on first use, so the order they're first called in is
// the texture order (section 6, step 13).

import { encodeDdsDxt1, encodeDdsDxt5 } from "../dds";
import { multiMapMaterial, material, type Light } from "../materials";
import { photoRoadTexture } from "../photoSurface";
import type { RoadSample } from "../road";
import { normalFromHeight, sealTexture, type SealKind } from "../textures";
import { displayOf } from "../trace";
import { GRAVEL_MATERIAL, gravelTexture, unsealedSamples } from "../unsealed";
import type { BuildContext } from "./context";
import type { BuildingPlan } from "./buildingPlan";
import type { Registry } from "./registry";
import type { RoutePlan } from "./routePlan";
import type { Streets } from "./streets";
import type { Traced } from "./traceRoute";

export interface Surfaces {
  roadMaterial: (ci: number, meanWidth: number, mid: RoadSample) => string;
  gravelMaterial: (ci: number, meanWidth: number) => string;
  /** The route chunks' material: the photo surface where it can be trusted (roadSurface photo), else roadMaterial. */
  chunkMaterial: (ci: number, w: number, mid: RoadSample, a: number, b: number) => string | { material: string; perChunk: true };
  gravelOn: boolean;
  /** 1 where the route is unsealed. */
  unsealedAt: Uint8Array;
  /** Any unsealed road built (route or street): surfaces.ini gets the gravel surface. */
  anyUnsealed: () => boolean;
  /** 0 country, 1 village, 2 town, per sample. */
  town: number[];
  speedAt: (i: number) => number;
}

const ROAD_CLASS_FAST = /^(motorway|trunk|primary)/;
const MOTORWAY = /^(motorway|trunk)/;
const REAL_STREET = /^(primary|secondary|tertiary|minor)/;

export function makeSurfaces(ctx: BuildContext, rp: RoutePlan, tr: Traced, st: Streets, bp: BuildingPlan, reg: Registry): Surfaces {
  const { opts, sources } = ctx;
  const plan = rp.plan, nS = plan.samples.length;
  const classAt = (p: [number, number]) => sources.roadClassAt?.(ctx.toLngLat(p));
  const firsts = bp.kept.map((b) => b.ring[0]);
  const housesNear = (p: [number, number], r: number) => firsts.filter((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < r).length;
  const made = new Set<string>();

  const roadMaterial = (ci: number, meanWidth: number, mid: RoadSample): string => {
    const kind: SealKind = opts.roadSurface === "asphalt" || opts.roadSurface === "chipseal" ? opts.roadSurface
      : ROAD_CLASS_FAST.test(classAt(mid.pos) ?? "") || housesNear(mid.pos, 150) >= 8 || mid.kerb ? "asphalt" : "chipseal";
    const twoLane = meanWidth >= 5.5, variant = ci % 3;
    const name = `road_${kind}_${twoLane ? 2 : 1}_${variant}`;
    if (made.has(name)) return name;
    made.add(name);
    const seal = sealTexture(kind, twoLane, variant);
    reg.preview(`${name}.dds`, { rgba: seal.rgba, width: seal.width, height: seal.height });
    const light: Light = { ambient: 0.4, diffuse: 0.45, specular: kind === "asphalt" ? 0.08 : 0.04, exp: 20 };
    if (opts.detailShaders) {
      const flat = seal.rgba.slice();
      for (let i = 3; i < flat.length; i += 4) flat[i] = 0;
      reg.texture(`${name}.dds`, encodeDdsDxt5(flat, seal.width, seal.height));
      reg.texture(`${name}_nm.dds`, encodeDdsDxt1(normalFromHeight(seal.rgba, seal.width, seal.height, 3), seal.width, seal.height));
      reg.material(multiMapMaterial(name, `${name}.dds`, light, { normal: `${name}_nm.dds`, maps: "maps_asphalt.png", detail: `detail_${kind}.png`, detailUV: 9, sunSpecular: 0.15 }));
    } else {
      reg.texture(`${name}.dds`, seal.dds);
      reg.material(material(name, `${name}.dds`, light));
    }
    return name;
  };

  let unsealedBuilt = false;
  const gravelMaterial = (ci: number, meanWidth: number): string => {
    unsealedBuilt = true;
    const twoLane = meanWidth >= 5.5, variant = ci % 3;
    const name = `${GRAVEL_MATERIAL}_${twoLane ? 2 : 1}_${variant}`;
    if (made.has(name)) return name;
    made.add(name);
    const tex = gravelTexture(twoLane, variant);
    reg.preview(`${name}.dds`, { rgba: tex.rgba, width: tex.width, height: tex.height });
    const light: Light = { ambient: 0.42, diffuse: 0.45, specular: 0.02, exp: 10 };
    if (opts.detailShaders) {
      const flat = tex.rgba.slice();
      for (let i = 3; i < flat.length; i += 4) flat[i] = 0;
      reg.texture(`${name}.dds`, encodeDdsDxt5(flat, tex.width, tex.height));
      reg.texture(`${name}_nm.dds`, encodeDdsDxt1(normalFromHeight(tex.rgba, tex.width, tex.height, 4), tex.width, tex.height));
      reg.material(multiMapMaterial(name, `${name}.dds`, light, { normal: `${name}_nm.dds`, maps: "maps_ground.png", detail: "detail_chipseal.png", detailUV: 9, sunSpecular: 0.02 }));
    } else {
      reg.texture(`${name}.dds`, tex.dds);
      reg.material(material(name, `${name}.dds`, light));
    }
    return name;
  };

  const raster = tr.raster, trace = tr.trace;
  const chunkMaterial = (ci: number, w: number, mid: RoadSample, a: number, b: number): string | { material: string; perChunk: true } => {
    if (opts.roadSurface === "photo" && raster && trace && a >= 0) {
      const idx: number[] = [];
      for (let i = a; ; i = (i + 1) % nS) {
        idx.push(i);
        if (i === b || idx.length > nS) break;
      }
      const trusted = (i: number) => trace.conf[i] > 0.7;
      if (idx.filter(trusted).length >= 0.3 * idx.length) {
        const name = `road_photo_${String(ci).padStart(3, "0")}`;
        const tex = photoRoadTexture(plan, displayOf(raster), a, b, trusted);
        reg.texture(`${name}.dds`, encodeDdsDxt1(tex.rgba, tex.width, tex.height));
        reg.preview(`${name}.dds`, tex);
        reg.material(material(name, `${name}.dds`, { ambient: 0.42, diffuse: 0.45, specular: 0.06, exp: 20 }));
        return { material: name, perChunk: true };
      }
    }
    return roadMaterial(ci, w, mid);
  };

  const gravelOn = opts.gravelRoads !== false;
  const unsealedAt = gravelOn || opts.unsealed
    ? unsealedSamples(plan, gravelOn ? (sources.osm?.unsealed ?? []).map((l) => ctx.line(l)) : [], !!opts.unsealed)
    : new Uint8Array(nS);
  const routeUnsealed = unsealedAt.includes(1);

  // Town level, every 5th sample, carried forward.
  const realStreets = st.streetPlan.streets.filter((s) => REAL_STREET.test(s.cls));
  const town: number[] = new Array(nS).fill(0);
  let level = 0;
  for (let i = 0; i < nS; i++) {
    if (i % 5 === 0) {
      const p = plan.samples[i].pos;
      if (MOTORWAY.test(classAt(p) ?? "")) level = 0;
      else {
        const houses = housesNear(p, 150);
        const grid = realStreets.filter((s) => s.pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 120)).length;
        level = houses >= 20 || grid >= 5 ? 2 : houses >= 8 || grid >= 3 ? 1 : 0;
      }
    }
    town[i] = level;
  }
  const speedAt = (i: number) => {
    const cls = classAt(plan.samples[i].pos) ?? "";
    const t = town[i];
    if (MOTORWAY.test(cls)) return t ? 70 : 100;
    if (/^primary/.test(cls)) return t ? 60 : 90;
    return t >= 1 ? 50 : 80;
  };

  return { roadMaterial, gravelMaterial, chunkMaterial, gravelOn, unsealedAt, anyUnsealed: () => routeUnsealed || unsealedBuilt, town, speedAt };
}
