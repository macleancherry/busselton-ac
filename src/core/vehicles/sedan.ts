// A generic sedan (the Camry / Commodore / Falcon kind), our own geometry from published overall
// dimensions only (docs/plans/local-cars.md): a long bonnet, the glasshouse in the middle, a sloped
// rear window onto a flat boot lid. "long" is the older, longer Commodore or Falcon.

import { carNose, carTail, noseFaceMid, sideGlass } from "./body";
import { mirrors } from "./extras";
import {
  dimensionsOf, glasshouse, numberPlate, Sil, towBar, VehicleBuilder, wheelCentre, wheels,
  type BaseSpec, type Dimensions, type VehicleMesh,
} from "./vehicle";

export interface SedanSpec extends BaseSpec {
  sill: number;
  bumperTop: number;
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

/** About a current Camry: 4.89 x 1.84 x 1.45 m, 2.83 m wheelbase. */
export const SEDAN_DEFAULTS: SedanSpec = {
  length: 4.89, width: 1.84, height: 1.45, wheelbase: 2.83, frontOverhang: 0.97,
  wheelRadius: 0.33, track: 1.58, tyreWidth: 0.23, sill: 0.2,
  bumperTop: 0.56, bonnetFront: 0.73, belt: 0.9, beltRear: 0.99,
  windscreenBase: 1.5, roofFront: 2.3, roofRear: 3.5, bPillar: 2.86, cPillar: [3.62, 3.3], glassEnd: 4.0, deck: 1.0,
  plates: true, towBar: false,
};

export const SEDAN_VARIANTS: Record<string, Partial<SedanSpec>> = {
  plain: {},
  /** The older long sedans still common out here (VE/VF Commodore, FG Falcon): 4.95 x 1.88 x 1.47 m, 2.92 m wheelbase. */
  long: { length: 4.95, width: 1.88, height: 1.47, wheelbase: 2.92, frontOverhang: 0.94, track: 1.6, roofRear: 3.6, bPillar: 2.9, cPillar: [3.7, 3.4], glassEnd: 4.08 },
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
  const archR = s.wheelRadius + 0.07, archH = wheelCentre(s.wheelRadius) + 0.03, segs = near ? 4 : 2;

  const sil = new Sil();
  carNose(sil, { sill: s.sill, bumperTop: s.bumperTop, lampTop: s.bonnetFront, hw: hw - 0.02, rake: 0.32, round: 0.25 });
  sil.add({ d: 0.85, h: (s.bonnetFront + s.belt) / 2 + 0.02, hw, inset: 0.09, drop: 0.05 }, { kind: "body" }, true); // bonnet's crown
  sil.add({ d: s.windscreenBase, h: s.belt, hw, inset: 0.07, drop: 0.04 }, { kind: "body" }); // under the glasshouse
  sil.add({ d: s.glassEnd, h: s.beltRear, hw, inset: 0.08, drop: 0.04 }, { kind: "body" }); // the boot lid
  carTail(sil, { length: L, d: L - 0.1, h: s.deck, bumperTop: s.bumperTop + 0.05, sill: s.sill, hw, round: 0.2 });
  sil.arches(ra, fa, archH, archR, s.sill, segs, hw);
  sil.build(vb, L, near, s);

  const g = sideGlass(near, s.windscreenBase, s.roofFront, s.bPillar, [{ base: s.cPillar[0], top: s.cPillar[1] }], { base: s.glassEnd, top: s.roofRear });
  glasshouse(vb, L, { belt: [s.belt, s.beltRear], roof: [s.height - 0.02, s.height], baseHw: hw - 0.07, roofHw: hw - 0.28, ...g });

  if (near) {
    mirrors(vb, L, s.windscreenBase + 0.08, s.windscreenBase + 0.26, hw - 0.04, s.belt + 0.02, 0.14);
    if (s.plates) {
      numberPlate(vb, L, sil, noseFaceMid(s), "front", near);
      numberPlate(vb, L, sil, (s.deck + s.bumperTop + 0.05) / 2, "rear", near);
    }
    if (s.towBar) towBar(vb, L, -L / 2 + 0.15);
  }
  wheels(vb, s, near);
  return vb.mesh;
}
