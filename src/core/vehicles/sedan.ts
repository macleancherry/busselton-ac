// A generic sedan (the Camry / Commodore / Falcon kind), our own geometry from published overall
// dimensions only (docs/plans/local-cars.md): a long bonnet, the glasshouse in the middle, a sloped
// rear window onto a flat boot lid. "long" is the older, longer Commodore or Falcon.

import { carNose, headLamps, carTail, noseGrille, sideGlass, tailLamps, type Nose, type Tail } from "./body";
import { mirrors } from "./extras";
import {
  archOf, dimensionsOf, glasshouse, numberPlate, Sil, towBar, VehicleBuilder, wheels,
  type BaseSpec, type Dimensions, type VehicleMesh,
} from "./vehicle";

export interface SedanSpec extends BaseSpec {
  sill: number;
  bonnetFront: number;
  belt: number;
  beltRear: number;
  /** Distances back from the front: windscreen base, roof front and rear ends, B pillar, the C pillar's front edge (belt, roof), the rear window's base. */
  windscreenBase: number;
  roofFront: number;
  roofRear: number;
  bPillar: number;
  cPillar: [number, number];
  glassEnd: number;
  /** Boot lid height at its rear edge. */
  deck: number;
  plates: boolean;
  towBar: boolean;
}

/** About a current Camry: 4.89 x 1.84 x 1.45 m, 2.83 m wheelbase, 235/45R18. */
export const SEDAN_DEFAULTS: SedanSpec = {
  length: 4.89, width: 1.84, height: 1.45, wheelbase: 2.83, frontOverhang: 0.94,
  wheelRadius: 0.334, track: 1.59, tyreWidth: 0.235, sill: 0.2,
  bonnetFront: 0.79, belt: 0.99, beltRear: 1.06,
  windscreenBase: 1.42, roofFront: 2.32, roofRear: 3.48, bPillar: 2.8, cPillar: [3.5, 3.28], glassEnd: 4.1, deck: 1.04,
  plates: true, towBar: false,
};

export const SEDAN_VARIANTS: Record<string, Partial<SedanSpec>> = {
  plain: {},
  /** The older long sedans still common out here (VE/VF Commodore, FG Falcon): 4.95 x 1.88 x 1.47 m, 2.92 m wheelbase. */
  long: { length: 4.95, width: 1.88, height: 1.47, wheelbase: 2.92, frontOverhang: 0.94, track: 1.6, roofRear: 3.58, bPillar: 2.88, cPillar: [3.6, 3.38], glassEnd: 4.18 },
  full: { towBar: true },
};

export function sedanDimensions(spec: Partial<SedanSpec> = {}): Dimensions {
  return dimensionsOf({ ...SEDAN_DEFAULTS, ...spec });
}

export function buildSedan(spec: Partial<SedanSpec> = {}, lod: 0 | 1 = 0): VehicleMesh {
  const s = { ...SEDAN_DEFAULTS, ...spec };
  const vb = new VehicleBuilder();
  const L = s.length, hw = s.width / 2, near = lod === 0;
  const fa = s.frontOverhang, ra = fa + s.wheelbase;
  const { archR, archH } = archOf(s, 0.03), segs = near ? 4 : 2;

  const sil = new Sil();
  const nose: Nose = { sill: s.sill, lampTop: s.bonnetFront, hw: hw - 0.02, rake: 0.26, round: 0.28, lamp: 0.09, lip: 0.09 };
  carNose(sil, nose);
  sil.add({ d: 0.85, h: (s.bonnetFront + s.belt) / 2 + 0.02, hw, inset: 0.07, drop: 0.09 }, { kind: "body" }, true); // bonnet's crown
  sil.add({ d: s.windscreenBase, h: s.belt, hw, inset: 0.06, drop: 0.12 }, { kind: "body" }); // under the glasshouse: the shoulder
  sil.add({ d: s.glassEnd, h: s.beltRear, hw, inset: 0.06, drop: 0.12 }, { kind: "body" }); // the boot lid
  const tail: Tail = { length: L, d: L - 0.08, h: s.deck, bumperTop: 0.62, sill: s.sill, hw, round: 0.26, drop: 0.12, lamp: 0.12 };
  carTail(sil, tail);
  sil.arches(ra, fa, archH, archR, s.sill, segs, hw);
  sil.build(vb, L, near, s);

  const g = sideGlass(near, s.windscreenBase, s.roofFront, s.bPillar, [{ base: s.cPillar[0], top: s.cPillar[1] }], { base: s.glassEnd, top: s.roofRear });
  glasshouse(vb, L, { belt: [s.belt, s.beltRear], roof: [s.height, s.height - 0.02], baseHw: hw - 0.06, roofHw: hw - 0.24, ...g });

  if (near) {
    tailLamps(vb, L, sil, tail);
    headLamps(vb, L, sil, nose);
    noseGrille(vb, L, nose, 0.3, 0.52, 0.44);
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
