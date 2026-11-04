// A generic station wagon (the Outback / Commodore Sportwagon kind), our own geometry from published
// overall dimensions only (docs/plans/local-cars.md): a sedan's nose and height with the roof run
// out to a near-upright tailgate, three side windows each side, roof rails.

import { carNose, headLamps, carTail, noseGrille, sideGlass, tailLamps, type Nose, type Tail } from "./body";
import { mirrors, roofRails } from "./extras";
import {
  archEnds, archFlares, archOf, dimensionsOf, glasshouse, numberPlate, Sil, sillCladding, towBar, VehicleBuilder, wheels,
  type BaseSpec, type Dimensions, type GlassLine, type VehicleMesh,
} from "./vehicle";

export interface StationWagonSpec extends BaseSpec {
  sill: number;
  bonnetFront: number;
  belt: number;
  beltRear: number;
  windscreenBase: number;
  roofFront: number;
  roofRear: number;
  bPillar: number;
  /** The stations behind the rear doors (base, top): C pillar front and back, D pillar front. */
  rear: [GlassLine, GlassLine, GlassLine];
  glassEnd: number;
  /** Black arch flares and sill cladding (the Outback kind). */
  flares: boolean;
  roofRails: boolean;
  plates: boolean;
  towBar: boolean;
}

/** Between a Commodore Sportwagon and an Outback: 4.9 x 1.86 x 1.55 m, 2.87 m wheelbase. */
export const STATION_WAGON_DEFAULTS: StationWagonSpec = {
  length: 4.9, width: 1.86, height: 1.55, wheelbase: 2.87, frontOverhang: 0.95,
  wheelRadius: 0.345, track: 1.6, tyreWidth: 0.225, sill: 0.24,
  bonnetFront: 0.82, belt: 1.02, beltRear: 1.1,
  windscreenBase: 1.42, roofFront: 2.3, roofRear: 4.6, bPillar: 2.8,
  rear: [{ base: 3.58, top: 3.5 }, { base: 3.7, top: 3.62 }, { base: 4.46, top: 4.4 }], glassEnd: 4.76,
  flares: true, roofRails: true, plates: true, towBar: false,
};

export const STATION_WAGON_VARIANTS: Record<string, Partial<StationWagonSpec>> = {
  plain: { roofRails: false },
  rails: {},
  full: { towBar: true },
};

export function stationWagonDimensions(spec: Partial<StationWagonSpec> = {}): Dimensions {
  return dimensionsOf({ ...STATION_WAGON_DEFAULTS, ...spec });
}

export function buildStationWagon(spec: Partial<StationWagonSpec> = {}, lod: 0 | 1 = 0): VehicleMesh {
  const s = { ...STATION_WAGON_DEFAULTS, ...spec };
  const vb = new VehicleBuilder();
  const L = s.length, hw = s.width / 2, near = lod === 0;
  const fa = s.frontOverhang, ra = fa + s.wheelbase;
  const { archR, archH } = archOf(s, 0.035), segs = near ? 4 : 2;

  const sil = new Sil();
  const nose: Nose = { sill: s.sill, lampTop: s.bonnetFront, hw: hw - 0.02, rake: 0.26, round: 0.27, lamp: 0.09, lip: 0.1 };
  carNose(sil, nose);
  sil.add({ d: 0.85, h: (s.bonnetFront + s.belt) / 2 + 0.02, hw, inset: 0.07, drop: 0.09 }, { kind: "body" }, true); // bonnet's crown
  sil.add({ d: s.windscreenBase, h: s.belt, hw, inset: 0.06, drop: 0.12 }, { kind: "body" }); // under the glasshouse: the shoulder
  const tail: Tail = { length: L, d: s.glassEnd, h: s.beltRear, bumperTop: 0.64, sill: s.sill, hw, round: 0.24, drop: 0.12, lamp: 0.12, diffuser: 0.12 };
  carTail(sil, tail);
  sil.arches(ra, fa, archH, archR, s.sill, segs, hw);
  sil.build(vb, L, near, s);
  if (s.flares && near) {
    const fw = 0.05;
    archFlares(vb, L, fa, archH, archR, s.sill, segs, hw, fw);
    archFlares(vb, L, ra, archH, archR, s.sill, segs, hw, fw);
    sillCladding(vb, L, archEnds(fa, archH, archR, s.sill)[1] + fw, archEnds(ra, archH, archR, s.sill)[0] - fw, s.sill, 0.1, hw);
  }

  const g = sideGlass(near, s.windscreenBase, s.roofFront, s.bPillar, s.rear, { base: s.glassEnd, top: s.roofRear });
  const roofHw = hw - 0.23;
  glasshouse(vb, L, { belt: [s.belt, s.beltRear], roof: [s.height, s.height - 0.04], baseHw: hw - 0.06, roofHw, ...g });

  if (s.roofRails) roofRails(vb, L, s.roofFront + 0.3, s.roofRear - 0.1, roofHw - 0.03, s.height);
  if (near) {
    tailLamps(vb, L, sil, tail);
    headLamps(vb, L, sil, nose);
    noseGrille(vb, L, nose, 0.34, 0.56, 0.44);
    mirrors(vb, L, s.windscreenBase + 0.2, hw, s.belt + 0.02, 0.19);
    if (s.plates) {
      numberPlate(vb, L, sil, 0.45, "front", near);
      numberPlate(vb, L, sil, 0.83, "rear", near);
    }
    if (s.towBar) towBar(vb, L, -L / 2 + 0.15);
  }
  wheels(vb, s, near);
  return vb.mesh;
}
