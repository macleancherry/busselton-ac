// A generic SUV, medium (the RAV4 / CX-5 / Tucson / X-Trail kind) or small (CX-3 / Kona / ASX), one
// spec sized two ways, our own geometry from published overall dimensions only
// (docs/plans/local-cars.md): a higher nose and belt than a car, black arch cladding, a raked
// tailgate, roof rails.

import { carNose, carTail, noseFaceMid, sideGlass } from "./body";
import { mirrors, roofRails } from "./extras";
import {
  archFlares, dimensionsOf, glasshouse, numberPlate, Sil, towBar, VehicleBuilder, wheelCentre, wheels,
  type BaseSpec, type Dimensions, type GlassLine, type VehicleMesh,
} from "./vehicle";

export interface SuvSpec extends BaseSpec {
  sill: number;
  bumperTop: number;
  bonnetFront: number;
  belt: number;
  beltRear: number;
  /** Distances back from the front: windscreen base, roof front and rear ends, B pillar, the tailgate glass's base. */
  windscreenBase: number;
  roofFront: number;
  roofRear: number;
  bPillar: number;
  /** The stations behind the rear doors (base, top): C pillar front and back, D pillar front. */
  rear: [GlassLine, GlassLine, GlassLine];
  glassEnd: number;
  flares: boolean;
  roofRails: boolean;
  plates: boolean;
  towBar: boolean;
}

/** About a current RAV4 or CX-5: 4.6 x 1.85 x 1.68 m, 2.69 m wheelbase. */
export const SUV_DEFAULTS: SuvSpec = {
  length: 4.6, width: 1.855, height: 1.68, wheelbase: 2.69, frontOverhang: 0.93,
  wheelRadius: 0.355, track: 1.6, tyreWidth: 0.235, sill: 0.32,
  bumperTop: 0.7, bonnetFront: 0.9, belt: 1.04, beltRear: 1.1,
  windscreenBase: 1.33, roofFront: 2.05, roofRear: 4.0, bPillar: 2.6,
  rear: [{ base: 3.4, top: 3.3 }, { base: 3.52, top: 3.42 }, { base: 4.12, top: 3.86 }], glassEnd: 4.42,
  flares: true, roofRails: true, plates: true, towBar: false,
};

/** About a CX-3 or Kona: 4.3 x 1.8 x 1.56 m, 2.6 m wheelbase. */
export const SUV_SMALL_DEFAULTS: SuvSpec = {
  ...SUV_DEFAULTS,
  length: 4.3, width: 1.8, height: 1.56, wheelbase: 2.6, frontOverhang: 0.86,
  wheelRadius: 0.34, track: 1.56, tyreWidth: 0.215, sill: 0.3,
  bumperTop: 0.67, bonnetFront: 0.86, belt: 1.0, beltRear: 1.07,
  windscreenBase: 1.24, roofFront: 1.96, roofRear: 3.68, bPillar: 2.45,
  rear: [{ base: 3.2, top: 3.08 }, { base: 3.32, top: 3.2 }, { base: 3.86, top: 3.56 }], glassEnd: 4.12,
  roofRails: false,
};

export const SUV_VARIANTS: Record<string, Partial<SuvSpec>> = {
  plain: { roofRails: false },
  rails: {},
  full: { towBar: true },
};

export const SUV_SMALL_VARIANTS: Record<string, Partial<SuvSpec>> = {
  plain: {},
  full: { roofRails: true, towBar: true },
};

export function suvDimensions(spec: Partial<SuvSpec> = {}): Dimensions {
  return dimensionsOf({ ...SUV_DEFAULTS, ...spec });
}

export function suvSmallDimensions(spec: Partial<SuvSpec> = {}): Dimensions {
  return dimensionsOf({ ...SUV_SMALL_DEFAULTS, ...spec });
}

export function buildSuv(spec: Partial<SuvSpec> = {}, lod: 0 | 1 = 0, base: SuvSpec = SUV_DEFAULTS): VehicleMesh {
  const s = { ...base, ...spec };
  const vb = new VehicleBuilder();
  const L = s.length, hw = s.width / 2, near = lod === 0;
  const fa = s.frontOverhang, ra = fa + s.wheelbase;
  const archR = s.wheelRadius + 0.08, archH = wheelCentre(s.wheelRadius) + 0.04, segs = near ? 4 : 2;

  const sil = new Sil();
  carNose(sil, { sill: s.sill, bumperTop: s.bumperTop, lampTop: s.bonnetFront, hw: hw - 0.02, rake: 0.28, round: 0.22 });
  sil.add({ d: 0.8, h: (s.bonnetFront + s.belt) / 2 + 0.02, hw, inset: 0.09, drop: 0.05 }, { kind: "body" }, true); // bonnet's crown
  sil.add({ d: s.windscreenBase, h: s.belt, hw, inset: 0.07, drop: 0.04 }, { kind: "body" }); // under the glasshouse
  carTail(sil, { length: L, d: s.glassEnd, h: s.beltRear, bumperTop: s.bumperTop + 0.03, sill: s.sill, hw, round: 0.18 });
  sil.arches(ra, fa, archH, archR, s.sill, segs, hw);
  sil.build(vb, L, near, s);
  if (s.flares && near) {
    archFlares(vb, L, fa, archH, archR, s.sill, segs, hw, 0.06);
    archFlares(vb, L, ra, archH, archR, s.sill, segs, hw, 0.06);
  }

  const g = sideGlass(near, s.windscreenBase, s.roofFront, s.bPillar, s.rear, { base: s.glassEnd, top: s.roofRear });
  const roofHw = hw - 0.24;
  glasshouse(vb, L, { belt: [s.belt, s.beltRear], roof: [s.height - 0.02, s.height], baseHw: hw - 0.06, roofHw, ...g });

  if (s.roofRails) roofRails(vb, L, s.roofFront + 0.25, s.roofRear - 0.1, roofHw - 0.03, s.height);
  if (near) {
    mirrors(vb, L, s.windscreenBase + 0.08, s.windscreenBase + 0.27, hw - 0.04, s.belt + 0.02, 0.15);
    if (s.plates) {
      numberPlate(vb, L, sil, noseFaceMid(s), "front", near);
      numberPlate(vb, L, sil, (s.beltRear + s.bumperTop + 0.03) / 2, "rear", near);
    }
    if (s.towBar) towBar(vb, L, -L / 2 + 0.15, 0.4);
  }
  wheels(vb, s, near);
  return vb.mesh;
}

export function buildSuvSmall(spec: Partial<SuvSpec> = {}, lod: 0 | 1 = 0): VehicleMesh {
  return buildSuv(spec, lod, SUV_SMALL_DEFAULTS);
}
