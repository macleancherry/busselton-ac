// A generic small hatch (the Corolla / i30 / Mazda3 / Yaris kind), our own geometry from published
// overall dimensions only (docs/plans/local-cars.md): a low nose, a long raked windscreen, a short
// roof dropping to a sloped hatch, thick C pillars.

import { carNose, headLamps, carTail, noseGrille, sideGlass, tailLamps, type Nose, type Tail } from "./body";
import { mirrors } from "./extras";
import {
  archOf, dimensionsOf, glasshouse, numberPlate, Sil, towBar, VehicleBuilder, wheels,
  type BaseSpec, type Dimensions, type VehicleMesh,
} from "./vehicle";

export interface HatchSpec extends BaseSpec {
  sill: number;
  /** Top of the lamps (the bonnet's leading edge). */
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

/** About a current Corolla or i30 hatch: 4.35 x 1.79 x 1.45 m, 2.64 m wheelbase, 225/45R17. */
export const HATCH_DEFAULTS: HatchSpec = {
  length: 4.35, width: 1.79, height: 1.45, wheelbase: 2.64, frontOverhang: 0.86,
  wheelRadius: 0.317, track: 1.55, tyreWidth: 0.225, sill: 0.2,
  bonnetFront: 0.8, belt: 0.99, beltRear: 1.07,
  windscreenBase: 1.24, roofFront: 2.12, roofRear: 3.56, bPillar: 2.5, cPillar: [3.3, 3.16], glassEnd: 4.1,
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
  const { archR, archH } = archOf(s, 0.03), segs = near ? 4 : 2;

  const sil = new Sil();
  const nose: Nose = { sill: s.sill, lampTop: s.bonnetFront, hw: hw - 0.02, rake: 0.24, round: 0.27, lamp: 0.09, lip: 0.09 };
  carNose(sil, nose);
  sil.add({ d: 0.75, h: (s.bonnetFront + s.belt) / 2 + 0.02, hw, inset: 0.07, drop: 0.09 }, { kind: "body" }, true); // bonnet's crown
  sil.add({ d: s.windscreenBase, h: s.belt, hw, inset: 0.06, drop: 0.12 }, { kind: "body" }); // under the glasshouse: the shoulder
  const tail: Tail = { length: L, d: s.glassEnd, h: s.beltRear, bumperTop: 0.6, sill: s.sill, hw, round: 0.26, drop: 0.12, lamp: 0.12 };
  carTail(sil, tail);
  sil.arches(ra, fa, archH, archR, s.sill, segs, hw);
  sil.build(vb, L, near, s);

  const g = sideGlass(near, s.windscreenBase, s.roofFront, s.bPillar, [{ base: s.cPillar[0], top: s.cPillar[1] }], { base: s.glassEnd, top: s.roofRear });
  glasshouse(vb, L, { belt: [s.belt, s.beltRear], roof: [s.height, s.height - 0.03], baseHw: hw - 0.06, roofHw: hw - 0.23, ...g });

  if (near) {
    tailLamps(vb, L, sil, tail);
    headLamps(vb, L, sil, nose);
    noseGrille(vb, L, nose, 0.3, 0.52, 0.42);
    mirrors(vb, L, s.windscreenBase + 0.2, hw, s.belt + 0.02, 0.19);
    if (s.plates) {
      numberPlate(vb, L, sil, 0.41, "front", near);
      numberPlate(vb, L, sil, 0.8, "rear", near);
    }
    if (s.towBar) towBar(vb, L, -L / 2 + 0.15);
  }
  wheels(vb, s, near);
  return vb.mesh;
}
