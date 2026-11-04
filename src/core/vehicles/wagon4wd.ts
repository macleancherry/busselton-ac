// A generic large 4WD wagon (the LandCruiser / Prado / Everest / Pajero Sport kind), our own geometry
// from published overall dimensions only (docs/plans/local-cars.md): tall and square, a big upright
// grille, a near-vertical back, flares; often a bull bar, snorkel, roof rack and a spare on the back
// door.

import { carNose, carTail, noseFaceMid, sideGlass } from "./body";
import { bullBar, mirrors, roofRack, roofRails, snorkel } from "./extras";
import {
  archFlares, dimensionsOf, glasshouse, numberPlate, Sil, spareWheel, SW, towBar, VehicleBuilder, wheelCentre, wheels,
  type BaseSpec, type Dimensions, type GlassLine, type VehicleMesh,
} from "./vehicle";

export interface Wagon4wdSpec extends BaseSpec {
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
  flares: boolean;
  bullBar: boolean;
  snorkel: boolean;
  roofRails: boolean;
  roofRack: boolean;
  /** The spare on the back door (Prado-type side-hinged door). */
  spare: boolean;
  towBar: boolean;
  plates: boolean;
  barSwatch: number;
}

/** About a LandCruiser 300 or Prado: 4.95 x 1.98 x 1.9 m, 2.85 m wheelbase. */
export const WAGON4WD_DEFAULTS: Wagon4wdSpec = {
  length: 4.95, width: 1.98, height: 1.9, wheelbase: 2.85, frontOverhang: 0.92,
  wheelRadius: 0.385, track: 1.66, tyreWidth: 0.265, sill: 0.46,
  bumperTop: 0.7, bonnetFront: 1.1, belt: 1.2, beltRear: 1.23,
  windscreenBase: 1.62, roofFront: 2.2, roofRear: 4.78, bPillar: 2.82,
  rear: [{ base: 3.62, top: 3.58 }, { base: 3.74, top: 3.7 }, { base: 4.6, top: 4.58 }], glassEnd: 4.88,
  flares: true, bullBar: false, snorkel: false, roofRails: true, roofRack: false, spare: false, towBar: false, plates: true,
  barSwatch: SW.TRIM,
};

export const WAGON4WD_VARIANTS: Record<string, Partial<Wagon4wdSpec>> = {
  plain: { roofRails: false },
  touring: { towBar: true },
  /** The Prado kind: spare on the back door, a black bar. */
  spare: { spare: true, towBar: true, roofRails: false },
  /** The outback fit-out. */
  full: { bullBar: true, snorkel: true, roofRails: false, roofRack: true, spare: true, towBar: true, barSwatch: SW.CHROME },
};

export function wagon4wdDimensions(spec: Partial<Wagon4wdSpec> = {}): Dimensions {
  return dimensionsOf({ ...WAGON4WD_DEFAULTS, ...spec });
}

export function buildWagon4wd(spec: Partial<Wagon4wdSpec> = {}, lod: 0 | 1 = 0): VehicleMesh {
  const s = { ...WAGON4WD_DEFAULTS, ...spec };
  const vb = new VehicleBuilder();
  const L = s.length, hw = s.width / 2, near = lod === 0;
  const fa = s.frontOverhang, ra = fa + s.wheelbase;
  const archR = s.wheelRadius + 0.085, archH = wheelCentre(s.wheelRadius) + 0.03, segs = near ? 4 : 2;
  const nose = hw - 0.03;

  const sil = new Sil();
  carNose(sil, { sill: s.sill, bumperTop: s.bumperTop, lampTop: s.bonnetFront, hw: nose, rake: 0.14, round: 0.13, face: 0.5 });
  sil.add({ d: 0.95, h: (s.bonnetFront + s.belt) / 2 + 0.01, hw, inset: 0.06, drop: 0.04 }, { kind: "body" }, true); // bonnet's crown
  sil.add({ d: s.windscreenBase, h: s.belt, hw, inset: 0.05, drop: 0.03 }, { kind: "body" }); // under the glasshouse
  carTail(sil, { length: L, d: s.glassEnd, h: s.beltRear, bumperTop: s.bumperTop + 0.08, sill: s.sill, hw, round: 0.1 });
  sil.arches(ra, fa, archH, archR, s.sill, segs, hw);
  sil.build(vb, L, near, s);
  if (s.flares && near) {
    archFlares(vb, L, fa, archH, archR, s.sill, segs, hw, 0.07);
    archFlares(vb, L, ra, archH, archR, s.sill, segs, hw, 0.07);
  }

  const g = sideGlass(near, s.windscreenBase, s.roofFront, s.bPillar, s.rear, { base: s.glassEnd, top: s.roofRear });
  const roofHw = hw - 0.14;
  glasshouse(vb, L, { belt: [s.belt, s.beltRear], roof: [s.height - 0.02, s.height], baseHw: hw - 0.05, roofHw, ...g, rearPaint: near ? 0.04 : 0 });

  if (s.roofRack) roofRack(vb, L, s.roofFront + 0.15, s.roofRear - 0.05, roofHw - 0.04, s.height, near);
  else if (s.roofRails) roofRails(vb, L, s.roofFront + 0.2, s.roofRear - 0.08, roofHw - 0.03, s.height);
  if (s.bullBar) bullBar(vb, L, nose, s.sill - 0.04, s.bonnetFront + 0.04, s.barSwatch, near);
  if (s.snorkel) snorkel(vb, L, s.windscreenBase - 0.05, hw, s.belt - 0.3, s.height - 0.06, near);
  if (s.spare) {
    // On the door below the glass, its inner face against the tail panel at the wheel's middle.
    const h = s.beltRear - s.wheelRadius + 0.06, d = sil.surfaceAt(h, "rear", L, near);
    spareWheel(vb, L / 2 - d, 0, h, s.wheelRadius, s.tyreWidth * 0.9, near);
  }
  if (near) {
    mirrors(vb, L, s.windscreenBase + 0.06, s.windscreenBase + 0.26, hw - 0.04, s.belt + 0.03, 0.17);
    if (s.plates) {
      numberPlate(vb, L, sil, noseFaceMid({ ...s, face: 0.5 }), "front", near);
      // On the tail panel, or with a spare in the way, down on the bumper to one side of it.
      if (s.spare) numberPlate(vb, L, sil, s.bumperTop - 0.02, "rear", near, -0.6);
      else numberPlate(vb, L, sil, s.bumperTop + 0.18, "rear", near);
    }
    if (s.towBar) towBar(vb, L, -L / 2 + 0.15, s.sill - 0.08);
  }
  wheels(vb, s, near);
  return vb.mesh;
}
