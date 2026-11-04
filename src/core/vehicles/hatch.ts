// A generic small hatch (the Corolla / i30 / Mazda3 / Yaris kind), our own geometry from published
// overall dimensions only (docs/plans/local-cars.md): a low nose, a long raked windscreen, a short
// roof dropping to a sloped hatch, thick C pillars.

import { carNose, carTail, noseFaceMid, sideGlass } from "./body";
import { mirrors } from "./extras";
import {
  dimensionsOf, glasshouse, numberPlate, Sil, towBar, VehicleBuilder, wheelCentre, wheels,
  type BaseSpec, type Dimensions, type VehicleMesh,
} from "./vehicle";

export interface HatchSpec extends BaseSpec {
  sill: number;
  /** Top of the front bumper, top of the lamps (the bonnet's leading edge). */
  bumperTop: number;
  bonnetFront: number;
  /** Belt at the windscreen and at the hatch. */
  belt: number;
  beltRear: number;
  /** Windscreen base, roof front and rear ends, the B pillar, the C pillar's front edge at the belt and roof, the hatch glass's base: distances back from the front. */
  windscreenBase: number;
  roofFront: number;
  roofRear: number;
  bPillar: number;
  cPillar: [number, number];
  glassEnd: number;
  plates: boolean;
  towBar: boolean;
}

/** About a current Corolla or i30 hatch: 4.35 x 1.79 x 1.45 m, 2.64 m wheelbase. */
export const HATCH_DEFAULTS: HatchSpec = {
  length: 4.35, width: 1.79, height: 1.45, wheelbase: 2.64, frontOverhang: 0.88,
  wheelRadius: 0.315, track: 1.55, tyreWidth: 0.215, sill: 0.2,
  bumperTop: 0.56, bonnetFront: 0.74, belt: 0.9, beltRear: 0.99,
  windscreenBase: 1.3, roofFront: 2.05, roofRear: 3.6, bPillar: 2.55, cPillar: [3.4, 3.2], glassEnd: 4.12,
  plates: true, towBar: false,
};

export const HATCH_VARIANTS: Record<string, Partial<HatchSpec>> = {
  plain: {},
  full: { towBar: true },
};

export function hatchDimensions(spec: Partial<HatchSpec> = {}): Dimensions {
  return dimensionsOf({ ...HATCH_DEFAULTS, ...spec });
}

export function buildHatch(spec: Partial<HatchSpec> = {}, lod: 0 | 1 = 0): VehicleMesh {
  const s = { ...HATCH_DEFAULTS, ...spec };
  const vb = new VehicleBuilder();
  const L = s.length, hw = s.width / 2, near = lod === 0;
  const fa = s.frontOverhang, ra = fa + s.wheelbase;
  const archR = s.wheelRadius + 0.07, archH = wheelCentre(s.wheelRadius) + 0.03, segs = near ? 4 : 2;

  const sil = new Sil();
  carNose(sil, { sill: s.sill, bumperTop: s.bumperTop, lampTop: s.bonnetFront, hw: hw - 0.02, rake: 0.3, round: 0.24 });
  sil.add({ d: 0.8, h: (s.bonnetFront + s.belt) / 2 + 0.02, hw, inset: 0.09, drop: 0.05 }, { kind: "body" }, true); // bonnet's crown
  sil.add({ d: s.windscreenBase, h: s.belt, hw, inset: 0.07, drop: 0.04 }, { kind: "body" }); // under the glasshouse
  carTail(sil, { length: L, d: s.glassEnd, h: s.beltRear, bumperTop: s.bumperTop + 0.04, sill: s.sill, hw, round: 0.18 });
  sil.arches(ra, fa, archH, archR, s.sill, segs, hw);
  sil.build(vb, L, near, s);

  const g = sideGlass(near, s.windscreenBase, s.roofFront, s.bPillar, [{ base: s.cPillar[0], top: s.cPillar[1] }], { base: s.glassEnd, top: s.roofRear });
  glasshouse(vb, L, { belt: [s.belt, s.beltRear], roof: [s.height - 0.02, s.height], baseHw: hw - 0.06, roofHw: hw - 0.27, ...g });

  if (near) {
    mirrors(vb, L, s.windscreenBase + 0.08, s.windscreenBase + 0.26, hw - 0.04, s.belt + 0.02, 0.14);
    if (s.plates) {
      numberPlate(vb, L, sil, noseFaceMid(s), "front", near);
      numberPlate(vb, L, sil, (s.beltRear + s.bumperTop) / 2, "rear", near);
    }
    if (s.towBar) towBar(vb, L, -L / 2 + 0.15);
  }
  wheels(vb, s, near);
  return vb.mesh;
}
