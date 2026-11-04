// A generic station wagon (the Outback / Commodore Sportwagon kind), our own geometry from published
// overall dimensions only (docs/plans/local-cars.md): a sedan's nose and height with the roof run
// out to a near-upright tailgate, three side windows each side, roof rails.

import { carNose, carTail, noseFaceMid, sideGlass } from "./body";
import { mirrors, roofRails } from "./extras";
import {
  dimensionsOf, glasshouse, numberPlate, Sil, towBar, VehicleBuilder, wheelCentre, wheels,
  type BaseSpec, type Dimensions, type GlassLine, type VehicleMesh,
} from "./vehicle";

export interface StationWagonSpec extends BaseSpec {
  sill: number;
  bumperTop: number;
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
  roofRails: boolean;
  plates: boolean;
  towBar: boolean;
}

/** Between a Commodore Sportwagon and an Outback: 4.9 x 1.86 x 1.55 m, 2.87 m wheelbase. */
export const STATION_WAGON_DEFAULTS: StationWagonSpec = {
  length: 4.9, width: 1.86, height: 1.55, wheelbase: 2.87, frontOverhang: 0.95,
  wheelRadius: 0.335, track: 1.6, tyreWidth: 0.225, sill: 0.22,
  bumperTop: 0.58, bonnetFront: 0.76, belt: 0.93, beltRear: 1.0,
  windscreenBase: 1.48, roofFront: 2.28, roofRear: 4.58, bPillar: 2.84,
  rear: [{ base: 3.62, top: 3.52 }, { base: 3.74, top: 3.64 }, { base: 4.46, top: 4.36 }], glassEnd: 4.76,
  roofRails: true, plates: true, towBar: false,
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
  const archR = s.wheelRadius + 0.07, archH = wheelCentre(s.wheelRadius) + 0.03, segs = near ? 4 : 2;

  const sil = new Sil();
  carNose(sil, { sill: s.sill, bumperTop: s.bumperTop, lampTop: s.bonnetFront, hw: hw - 0.02, rake: 0.32, round: 0.25 });
  sil.add({ d: 0.85, h: (s.bonnetFront + s.belt) / 2 + 0.02, hw, inset: 0.09, drop: 0.05 }, { kind: "body" }, true); // bonnet's crown
  sil.add({ d: s.windscreenBase, h: s.belt, hw, inset: 0.07, drop: 0.04 }, { kind: "body" }); // under the glasshouse
  carTail(sil, { length: L, d: s.glassEnd, h: s.beltRear, bumperTop: s.bumperTop + 0.04, sill: s.sill, hw, round: 0.16 });
  sil.arches(ra, fa, archH, archR, s.sill, segs, hw);
  sil.build(vb, L, near, s);

  const g = sideGlass(near, s.windscreenBase, s.roofFront, s.bPillar, s.rear, { base: s.glassEnd, top: s.roofRear });
  const roofHw = hw - 0.25;
  glasshouse(vb, L, { belt: [s.belt, s.beltRear], roof: [s.height - 0.02, s.height], baseHw: hw - 0.07, roofHw, ...g });

  if (s.roofRails) roofRails(vb, L, s.roofFront + 0.3, s.roofRear - 0.1, roofHw - 0.03, s.height);
  if (near) {
    mirrors(vb, L, s.windscreenBase + 0.08, s.windscreenBase + 0.26, hw - 0.04, s.belt + 0.02, 0.14);
    if (s.plates) {
      numberPlate(vb, L, sil, noseFaceMid(s), "front", near);
      numberPlate(vb, L, sil, (s.beltRear + s.bumperTop + 0.04) / 2, "rear", near);
    }
    if (s.towBar) towBar(vb, L, -L / 2 + 0.15);
  }
  wheels(vb, s, near);
  return vb.mesh;
}
