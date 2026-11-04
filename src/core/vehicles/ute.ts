// A generic dual-cab 4x4 ute (the Hilux / Ranger / Triton / D-Max / BT-50 kind), our own geometry
// from a few proportions, no badges or copied shapes (docs/plans/local-cars.md). The other bodies
// follow the same silhouette + glasshouse + parts pattern.

import { bullBar, ladderRack, mirrors, roofRack, snorkel, sportsBar } from "./extras";
import {
  archFlares, dimensionsOf, glasshouse, numberPlate, openTray, PAINT_SLOT, Sil, SW, towBar, VehicleBuilder, wheelCentre, wheels,
  type BaseSpec, type Dimensions, type VehicleMesh,
} from "./vehicle";

export interface UteSpec extends BaseSpec {
  /** Bottom of the body sides and bumpers above the ground. */
  sill: number;
  /** Top of the bonnet at its front, and the belt (bottom of the side glass) at the windscreen. */
  bonnetFront: number;
  belt: number;
  /** Windscreen base, distance back from the front; cab back; the roof's front and rear ends. */
  windscreenBase: number;
  cabBack: number;
  roofFront: number;
  roofRear: number;
  /** Tray floor height (inside; above the rear arches' tops), rail height. */
  trayFloor: number;
  trayRail: number;
  /** Black wheel-arch flares (SR5 / XLT / Wildtrak look). */
  flares: boolean;
  /** Accessories, the WA staples. */
  bullBar: boolean;
  snorkel: boolean;
  /** "none", "sportsBar" (the hoop behind the cab), "canopy" (a hard lid to roof height, glass sides), "rack" (a ladder rack over the tray). */
  tray: "none" | "sportsBar" | "canopy" | "rack";
  roofRack: boolean;
  towBar: boolean;
  /** Number plates front and back (plain white). */
  plates: boolean;
  /** The bull bar's and bars' finish: black or alloy. */
  barSwatch: number;
}

/** About a current Hilux / Ranger dual cab, from published dimensions only. */
export const UTE_DEFAULTS: UteSpec = {
  length: 5.33, width: 1.86, height: 1.82, wheelbase: 3.09, frontOverhang: 0.93,
  wheelRadius: 0.385, track: 1.56, tyreWidth: 0.26, sill: 0.5,
  bonnetFront: 1.0, belt: 1.13,
  windscreenBase: 1.8, cabBack: 3.9, roofFront: 2.5, roofRear: 3.82,
  trayFloor: 0.87, trayRail: 1.17,
  flares: true, bullBar: false, snorkel: false, tray: "none", roofRack: false, towBar: false, plates: true, barSwatch: SW.TRIM,
};

/** Named variants (the plan's table): plain first, then the common fit-outs. */
export const UTE_VARIANTS: Record<string, Partial<UteSpec>> = {
  plain: {},
  sports: { tray: "sportsBar" },
  canopy: { tray: "canopy", towBar: true },
  tradie: { bullBar: true, snorkel: true, tray: "canopy", flares: false, roofRack: true },
  rack: { tray: "rack", bullBar: true, towBar: true },
  full: { tray: "rack", bullBar: true, snorkel: true, roofRack: true, towBar: true },
};

export function uteDimensions(spec: Partial<UteSpec> = {}): Dimensions {
  return dimensionsOf({ ...UTE_DEFAULTS, ...spec });
}

/** The ute's template at LOD 0 (near, about 300 triangles) or 1 (far, under 100: no chamfers, lamps, mirrors or wheel faces). */
export function buildUte(spec: Partial<UteSpec> = {}, lod: 0 | 1 = 0): VehicleMesh {
  const s = { ...UTE_DEFAULTS, ...spec };
  const vb = new VehicleBuilder();
  const L = s.length, hw = s.width / 2, near = lod === 0;
  const fa = s.frontOverhang, ra = fa + s.wheelbase;
  const archR = s.wheelRadius + 0.085, archH = wheelCentre(s.wheelRadius) + 0.02, segs = near ? 4 : 2;
  const nose = hw - 0.035;
  const canopy = s.tray === "canopy";

  // Silhouette, front bumper round the top to the rear bumper and back along the bottom.
  const sil = new Sil();
  sil.add({ d: 0.06, h: s.sill, hw: nose, inset: 0.12, ds: 0.1 }, { kind: "body", mid: SW.TRIM, corner: SW.TRIM }); // lower bumper
  sil.add({ d: 0.0, h: s.sill + 0.17, hw: nose, inset: 0.16, ds: 0.12 }, { kind: "body" }, true); // bumper face
  sil.add({ d: 0.02, h: s.bonnetFront - 0.19, hw: nose, inset: 0.2, ds: 0.13 }, { kind: "body", mid: "grille", corner: SW.HEAD }); // grille, lamps at the corners
  sil.add({ d: 0.1, h: s.bonnetFront, hw: nose, inset: 0.2, drop: 0.03, ds: 0.1 }, { kind: "body" }); // bonnet front half
  sil.add({ d: 0.95, h: (s.bonnetFront + s.belt) / 2 + 0.01, hw, inset: 0.07, drop: 0.04 }, { kind: "body" }); // bonnet rear half
  sil.add({ d: s.windscreenBase, h: s.belt, hw, inset: 0.06, drop: 0.03 }, { kind: "body" }); // under the cab
  sil.add({ d: s.cabBack, h: s.trayRail, hw }, { kind: canopy ? "body" : "skip" }); // the tray (openTray), or a lid under a canopy
  sil.add({ d: L - 0.03, h: s.trayRail, hw, inset: 0.09, ds: -0.03 }, { kind: "body", corner: SW.TAIL }); // tailgate, tail lamps at the corners
  sil.add({ d: L, h: s.sill + 0.28, hw, inset: 0.06, ds: -0.04 }, { kind: "body", mid: SW.TRIM, corner: SW.TRIM }); // rear step bumper
  sil.add({ d: L - 0.04, h: s.sill + 0.05, hw }, { kind: "skip" });
  sil.add({ d: ra + archR + 0.4, h: s.sill, hw }, { kind: "skip" });
  sil.arches(ra, fa, archH, archR, s.sill, segs, hw);
  sil.build(vb, L, near, s);
  if (near && s.tray !== "canopy") {
    // The gap between cab and tray: a dark strip on each side, down to the rear arch if it's over it.
    const over = s.cabBack - ra, low = Math.abs(over) < archR ? archH + Math.sqrt(archR * archR - over * over) + 0.01 : s.sill + 0.1;
    for (const sgn of [1, -1]) {
      const fc = L / 2 - s.cabBack - 0.005;
      vb.face([[fc + 0.02, sgn * (hw + 0.004), low], [fc - 0.02, sgn * (hw + 0.004), low],
        [fc - 0.02, sgn * (hw + 0.004), s.trayRail], [fc + 0.02, sgn * (hw + 0.004), s.trayRail]], SW.TRIM, [0, sgn, 0]);    }
  }
  if (s.flares && near) {
    archFlares(vb, L, fa, archH, archR, s.sill, segs, hw);
    archFlares(vb, L, ra, archH, archR, s.sill, segs, hw);
  }

  // Cab: A pillar, front door glass, B pillar, rear door glass, C pillar.
  const ws = s.windscreenBase, cb = s.cabBack, rf = s.roofFront, rr = s.roofRear;
  /** B pillar: front and rear doors about the same length. */
  const bp = (rf + rr) / 2 + 0.05;
  glasshouse(vb, L, {
    belt: [s.belt, s.trayRail], roof: [s.height - 0.02, s.height], baseHw: hw - 0.05, roofHw: hw - 0.21,
    lines: near
      ? [{ base: ws, top: rf }, { base: ws + 0.12, top: rf + 0.06 }, { base: bp - 0.05, top: bp - 0.03 }, { base: bp + 0.06, top: bp + 0.06 }, { base: cb - 0.2, top: rr - 0.1 }, { base: cb, top: rr }]
      : [{ base: ws, top: rf }, { base: cb, top: rr }],
    panels: near ? [PAINT_SLOT, SW.GLASS, PAINT_SLOT, SW.GLASS, PAINT_SLOT] : [SW.GLASS],
    rearPaint: near ? 0.22 : 0,
  });

  // Tray.
  const f = (d: number) => L / 2 - d;
  if (canopy) {
    // A canopy: body-colour box from the rails to just under the roof, glass sides, a glass rear door.
    const top = s.height - 0.06, d0 = cb + 0.02, d1 = L - 0.05;
    vb.box([f(d1), f(d0)], [-(hw - 0.02), hw - 0.02], [s.trayRail, top], PAINT_SLOT, ["bottom"]);
    if (near) {
      for (const sgn of [1, -1]) {
        vb.face([[f(d1 - 0.12), sgn * (hw - 0.012), s.trayRail + 0.12], [f(d0 + 0.12), sgn * (hw - 0.012), s.trayRail + 0.12],
          [f(d0 + 0.12), sgn * (hw - 0.012), top - 0.08], [f(d1 - 0.12), sgn * (hw - 0.012), top - 0.08]], SW.GLASS, [0, sgn, 0]);
      }
      vb.face([[f(d1) - 0.012, hw - 0.14, s.trayRail + 0.1], [f(d1) - 0.012, -(hw - 0.14), s.trayRail + 0.1],
        [f(d1) - 0.012, -(hw - 0.14), top - 0.06], [f(d1) - 0.012, hw - 0.14, top - 0.06]], SW.GLASS, [-1, 0, 0]);
    }
  } else if (near) {
    openTray(vb, L, cb, L - 0.03, s.trayRail, s.trayFloor, hw);
  } else {
    // Far: a dark lid just under the rails reads as an open tray.
    const lid = s.trayRail - 0.005;
    vb.face([[f(cb), hw, lid], [f(L - 0.03), hw, lid], [f(L - 0.03), -hw, lid], [f(cb), -hw, lid]], SW.LINER, [0, 0, 1]);
  }
  if (s.tray === "sportsBar") sportsBar(vb, L, cb + 0.18, hw, s.trayRail, s.height - 0.12, s.barSwatch);
  else if (s.tray === "rack") ladderRack(vb, L, cb + 0.2, L - 0.15, hw, s.trayRail, s.height + 0.08, s.barSwatch, near);

  // Mirrors (near only), plates, bull bar, snorkel, roof rack, tow bar.
  if (near) mirrors(vb, L, ws + 0.08, ws + 0.22, hw, s.belt + 0.05);
  if (s.plates && near) {
    numberPlate(vb, L, sil, s.sill + 0.12, "front", near);
    numberPlate(vb, L, sil, s.sill + 0.17, "rear", near);
  }
  if (s.bullBar) bullBar(vb, L, nose, s.sill - 0.02, s.bonnetFront + 0.06, s.barSwatch, near);
  if (s.snorkel) snorkel(vb, L, ws - 0.05, hw, s.belt - 0.3, s.height - 0.05, near);
  if (s.roofRack) roofRack(vb, L, rf + 0.1, rr - 0.05, hw - 0.24, s.height, near);
  if (s.towBar && near) towBar(vb, L, -L / 2 + 0.1, s.sill - 0.08);

  wheels(vb, s, near);
  return vb.mesh;
}
