// A generic passenger ute (the Commodore and Falcon ute kind), our own geometry from published
// overall dimensions only (docs/plans/local-cars.md): a sedan's front half, a short two-door cab and
// a tray at the belt line. Often a soft tonneau cover over the tray.

import { carNose, carTail, noseFaceMid } from "./body";
import { mirrors } from "./extras";
import {
  dimensionsOf, glasshouse, numberPlate, openTray, PAINT_SLOT, Sil, SW, towBar, VehicleBuilder, wheelCentre, wheels,
  type BaseSpec, type Dimensions, type VehicleMesh,
} from "./vehicle";

export interface PassengerUteSpec extends BaseSpec {
  sill: number;
  bumperTop: number;
  bonnetFront: number;
  belt: number;
  windscreenBase: number;
  roofFront: number;
  roofRear: number;
  /** The cab's back at the belt (the tray starts just behind). */
  cabBack: number;
  trayRail: number;
  /** Tray floor (above the rear arches' tops). */
  trayFloor: number;
  /** A flat soft cover over the tray. */
  tonneau: boolean;
  plates: boolean;
  towBar: boolean;
}

/** About a VF Commodore or FG Falcon ute: 5.05 x 1.9 x 1.48 m, 3.0 m wheelbase. */
export const PASSENGER_UTE_DEFAULTS: PassengerUteSpec = {
  length: 5.05, width: 1.89, height: 1.48, wheelbase: 3.0, frontOverhang: 0.97,
  wheelRadius: 0.335, track: 1.6, tyreWidth: 0.235, sill: 0.21,
  bumperTop: 0.57, bonnetFront: 0.76, belt: 0.92,
  windscreenBase: 1.5, roofFront: 2.3, roofRear: 2.98, cabBack: 3.08, trayRail: 0.98, trayFloor: 0.76,
  tonneau: false, plates: true, towBar: false,
};

export const PASSENGER_UTE_VARIANTS: Record<string, Partial<PassengerUteSpec>> = {
  plain: {},
  tonneau: { tonneau: true },
  full: { towBar: true },
};

export function passengerUteDimensions(spec: Partial<PassengerUteSpec> = {}): Dimensions {
  return dimensionsOf({ ...PASSENGER_UTE_DEFAULTS, ...spec });
}

export function buildPassengerUte(spec: Partial<PassengerUteSpec> = {}, lod: 0 | 1 = 0): VehicleMesh {
  const s = { ...PASSENGER_UTE_DEFAULTS, ...spec };
  const vb = new VehicleBuilder();
  const L = s.length, hw = s.width / 2, near = lod === 0;
  const fa = s.frontOverhang, ra = fa + s.wheelbase;
  const archR = s.wheelRadius + 0.07, archH = wheelCentre(s.wheelRadius) + 0.03, segs = near ? 4 : 2;
  const f = (d: number) => L / 2 - d;

  const sil = new Sil();
  carNose(sil, { sill: s.sill, bumperTop: s.bumperTop, lampTop: s.bonnetFront, hw: hw - 0.02, rake: 0.32, round: 0.25 });
  sil.add({ d: 0.85, h: (s.bonnetFront + s.belt) / 2 + 0.02, hw, inset: 0.09, drop: 0.05 }, { kind: "body" }, true); // bonnet's crown
  sil.add({ d: s.windscreenBase, h: s.belt, hw, inset: 0.07, drop: 0.04 }, { kind: "body" }); // under the cab
  sil.add({ d: s.cabBack, h: s.trayRail, hw }, { kind: s.tonneau ? "body" : "skip", mid: SW.TRIM }); // the tray (openTray), or the black cover
  carTail(sil, { length: L, d: L - 0.06, h: s.trayRail, bumperTop: s.bumperTop + 0.05, sill: s.sill, hw, round: 0.18, drop: 0 });
  sil.arches(ra, fa, archH, archR, s.sill, segs, hw);
  sil.build(vb, L, near, s);

  // Cab: A pillar, the long door's glass, a slim pillar to the back window.
  const ws = s.windscreenBase, rf = s.roofFront, rr = s.roofRear, cb = s.cabBack;
  glasshouse(vb, L, {
    belt: [s.belt, s.trayRail], roof: [s.height - 0.02, s.height], baseHw: hw - 0.07, roofHw: hw - 0.27,
    lines: near
      ? [{ base: ws, top: rf }, { base: ws + 0.12, top: rf + 0.07 }, { base: cb - 0.22, top: rr - 0.12 }, { base: cb, top: rr }]
      : [{ base: ws, top: rf }, { base: cb, top: rr }],
    panels: near ? [PAINT_SLOT, SW.GLASS, PAINT_SLOT] : [SW.GLASS],
    rearPaint: near ? 0.05 : 0,
  });

  // With a tonneau the silhouette's lid at rail height is the cover; otherwise an open tray.
  if (!s.tonneau && near) {
    openTray(vb, L, cb, L - 0.06, s.trayRail, s.trayFloor, hw);
    for (const sgn of [1, -1]) {
      // The gap between cab and tray.
      const fc = f(cb) - 0.005;
      vb.face([[fc + 0.02, sgn * (hw + 0.004), s.sill + 0.1], [fc - 0.02, sgn * (hw + 0.004), s.sill + 0.1],
        [fc - 0.02, sgn * (hw + 0.004), s.trayRail], [fc + 0.02, sgn * (hw + 0.004), s.trayRail]], SW.TRIM, [0, sgn, 0]);
    }
  } else if (!s.tonneau) {
    const lid = s.trayRail - 0.005;
    vb.face([[f(cb), hw, lid], [f(L - 0.06), hw, lid], [f(L - 0.06), -hw, lid], [f(cb), -hw, lid]], SW.LINER, [0, 0, 1]);
  }
  if (near) {
    mirrors(vb, L, ws + 0.08, ws + 0.26, hw - 0.04, s.belt + 0.02, 0.14);
    if (s.plates) {
      numberPlate(vb, L, sil, noseFaceMid(s), "front", near);
      numberPlate(vb, L, sil, (s.trayRail + s.bumperTop + 0.05) / 2, "rear", near);
    }
    if (s.towBar) towBar(vb, L, -L / 2 + 0.15);
  }
  wheels(vb, s, near);
  return vb.mesh;
}
