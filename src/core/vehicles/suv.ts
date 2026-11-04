// A generic SUV, medium (the RAV4 / CX-5 / Tucson / X-Trail kind) or small (CX-3 / Kona / ASX), one
// spec sized two ways, our own geometry from published overall dimensions only
// (docs/plans/local-cars.md): a higher nose and belt than a car, black arch cladding, a raked
// tailgate, roof rails.

import { carNose, headLamps, carTail, noseGrille, sideGlass, tailLamps, type Nose, type Tail } from "./body";
import { mirrors, roofRails } from "./extras";
import {
  archEnds, archFlares, archOf, dimensionsOf, glasshouse, numberPlate, Sil, sillCladding, towBar, VehicleBuilder, wheels,
  type BaseSpec, type Dimensions, type GlassLine, type VehicleMesh,
} from "./vehicle";

export interface SuvSpec extends BaseSpec {
  sill: number;
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
  /** How far the roof drops from the windscreen to the tailgate. */
  roofDrop: number;
  /** Black arch flares and sill cladding. */
  flares: boolean;
  roofRails: boolean;
  plates: boolean;
  towBar: boolean;
}

/** About a current RAV4 or CX-5: 4.6 x 1.855 x 1.685 m, 2.69 m wheelbase, 225/60R18. */
export const SUV_DEFAULTS: SuvSpec = {
  length: 4.6, width: 1.855, height: 1.685, wheelbase: 2.69, frontOverhang: 0.9,
  wheelRadius: 0.364, track: 1.6, tyreWidth: 0.235, sill: 0.34,
  bonnetFront: 0.98, belt: 1.1, beltRear: 1.17,
  windscreenBase: 1.3, roofFront: 2.1, roofRear: 4.1, bPillar: 2.56,
  rear: [{ base: 3.36, top: 3.3 }, { base: 3.48, top: 3.42 }, { base: 4.06, top: 3.9 }], glassEnd: 4.4, roofDrop: 0.06,
  flares: true, roofRails: true, plates: true, towBar: false,
};

/** About a CX-3 or Kona: 4.3 x 1.8 x 1.56 m, 2.6 m wheelbase, 215/55R17. */
export const SUV_SMALL_DEFAULTS: SuvSpec = {
  ...SUV_DEFAULTS,
  length: 4.3, width: 1.8, height: 1.56, wheelbase: 2.6, frontOverhang: 0.84,
  wheelRadius: 0.338, track: 1.56, tyreWidth: 0.215, sill: 0.3,
  bonnetFront: 0.92, belt: 1.03, beltRear: 1.1,
  windscreenBase: 1.2, roofFront: 1.98, roofRear: 3.8, bPillar: 2.42,
  rear: [{ base: 3.14, top: 3.06 }, { base: 3.26, top: 3.18 }, { base: 3.8, top: 3.62 }], glassEnd: 4.1, roofDrop: 0.05,
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
  const { archR, archH } = archOf(s, 0.04), segs = near ? 4 : 2;
  const k = s.height / SUV_DEFAULTS.height; // the small one's heights scale down

  const sil = new Sil();
  const nose: Nose = { sill: s.sill, lampTop: s.bonnetFront, hw: hw - 0.02, rake: 0.22, round: 0.26, lamp: 0.09, lip: 0.12 };
  carNose(sil, nose);
  sil.add({ d: 0.78, h: (s.bonnetFront + s.belt) / 2 + 0.02, hw, inset: 0.07, drop: 0.09 }, { kind: "body" }, true); // bonnet's crown
  sil.add({ d: s.windscreenBase, h: s.belt, hw, inset: 0.06, drop: 0.13 }, { kind: "body" }); // under the glasshouse: the shoulder
  const tail: Tail = { length: L, d: s.glassEnd, h: s.beltRear, bumperTop: 0.72 * k, sill: s.sill, hw, round: 0.24, drop: 0.13, lamp: 0.1, diffuser: 0.16 };
  carTail(sil, tail);
  sil.arches(ra, fa, archH, archR, s.sill, segs, hw);
  sil.build(vb, L, near, s);
  if (s.flares && near) {
    const fw = 0.06;
    archFlares(vb, L, fa, archH, archR, s.sill, segs, hw, fw);
    archFlares(vb, L, ra, archH, archR, s.sill, segs, hw, fw);
    sillCladding(vb, L, archEnds(fa, archH, archR, s.sill)[1] + fw, archEnds(ra, archH, archR, s.sill)[0] - fw, s.sill, 0.12, hw);
  }

  const g = sideGlass(near, s.windscreenBase, s.roofFront, s.bPillar, s.rear, { base: s.glassEnd, top: s.roofRear });
  const roofHw = hw - 0.23;
  glasshouse(vb, L, { belt: [s.belt, s.beltRear], roof: [s.height, s.height - s.roofDrop], baseHw: hw - 0.06, roofHw, ...g });

  if (s.roofRails) roofRails(vb, L, s.roofFront + 0.25, s.roofRear - 0.1, roofHw - 0.03, s.height - s.roofDrop * 0.5);
  if (near) {
    tailLamps(vb, L, sil, tail);
    headLamps(vb, L, sil, nose);
    noseGrille(vb, L, nose, 0.5 * k, 0.8 * k, 0.48);
    mirrors(vb, L, s.windscreenBase + 0.2, hw, s.belt + 0.02, 0.2, 0.14);
    if (s.plates) {
      numberPlate(vb, L, sil, 0.63 * k, "front", near);
      numberPlate(vb, L, sil, (s.beltRear - 0.1 + 0.72 * k) / 2, "rear", near);
    }
    if (s.towBar) towBar(vb, L, -L / 2 + 0.15, 0.4);
  }
  wheels(vb, s, near);
  return vb.mesh;
}

export function buildSuvSmall(spec: Partial<SuvSpec> = {}, lod: 0 | 1 = 0): VehicleMesh {
  return buildSuv(spec, lod, SUV_SMALL_DEFAULTS);
}
