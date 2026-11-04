// A generic van (the HiAce / Trafic kind, long wheelbase), our own geometry from published overall
// dimensions only (docs/plans/local-cars.md): a short sloped nose, a raked windscreen, one tall box
// to a flat back. Panel van (paint behind the front doors) or commuter (windows all along); tradies
// add roof bars.

import { carNose, carTail, noseFaceMid, sideGlass } from "./body";
import { mirrors, roofBars } from "./extras";
import {
  dimensionsOf, glasshouse, numberPlate, PAINT_SLOT, Sil, towBar, VehicleBuilder, wheelCentre, wheels,
  type BaseSpec, type Dimensions, type VehicleMesh,
} from "./vehicle";

export interface VanSpec extends BaseSpec {
  sill: number;
  bumperTop: number;
  bonnetFront: number;
  belt: number;
  windscreenBase: number;
  roofFront: number;
  bPillar: number;
  /** Side windows all the way back (commuter), or paint behind the front doors (panel van). */
  windows: boolean;
  roofBars: boolean;
  plates: boolean;
  towBar: boolean;
}

/** About a HiAce LWB van: 5.27 x 1.95 x 1.99 m, 3.21 m wheelbase. */
export const VAN_DEFAULTS: VanSpec = {
  length: 5.265, width: 1.95, height: 1.99, wheelbase: 3.21, frontOverhang: 0.93,
  wheelRadius: 0.345, track: 1.67, tyreWidth: 0.225, sill: 0.33,
  bumperTop: 0.62, bonnetFront: 0.98, belt: 1.12,
  windscreenBase: 1.0, roofFront: 1.82, bPillar: 2.02,
  windows: false, roofBars: false, plates: true, towBar: false,
};

export const VAN_VARIANTS: Record<string, Partial<VanSpec>> = {
  plain: {},
  commuter: { windows: true },
  tradie: { roofBars: true, towBar: true },
  full: { windows: true, roofBars: true, towBar: true },
};

export function vanDimensions(spec: Partial<VanSpec> = {}): Dimensions {
  return dimensionsOf({ ...VAN_DEFAULTS, ...spec });
}

export function buildVan(spec: Partial<VanSpec> = {}, lod: 0 | 1 = 0): VehicleMesh {
  const s = { ...VAN_DEFAULTS, ...spec };
  const vb = new VehicleBuilder();
  const L = s.length, hw = s.width / 2, near = lod === 0;
  const fa = s.frontOverhang, ra = fa + s.wheelbase;
  const archR = s.wheelRadius + 0.07, archH = wheelCentre(s.wheelRadius) + 0.04, segs = near ? 4 : 2;
  const glassEnd = L - 0.03, roofRear = L - 0.07, beltRear = s.belt + 0.02;

  const sil = new Sil();
  carNose(sil, { sill: s.sill, bumperTop: s.bumperTop, lampTop: s.bonnetFront, hw: hw - 0.02, rake: 0.2, round: 0.18 });
  sil.add({ d: 0.58, h: (s.bonnetFront + s.belt) / 2 + 0.02, hw, inset: 0.08, drop: 0.04 }, { kind: "body" }, true); // the short bonnet's crown
  sil.add({ d: s.windscreenBase, h: s.belt, hw, inset: 0.05, drop: 0.03 }, { kind: "body" }); // under the glasshouse (the whole box)
  carTail(sil, { length: L, d: glassEnd, h: beltRear, bumperTop: s.bumperTop - 0.04, sill: s.sill, hw, round: 0.08 });
  sil.arches(ra, fa, archH, archR, s.sill, segs, hw);
  sil.build(vb, L, near, s);

  // Side: A pillar, front door glass, B pillar, then windows and pillars (commuter) or one panel.
  const rear = s.windows ? [{ base: 3.0, top: 2.98 }, { base: 3.1, top: 3.08 }, { base: 4.05, top: 4.03 }, { base: 4.15, top: 4.13 }, { base: 4.98, top: 4.95 }] : [];
  const g = sideGlass(near, s.windscreenBase, s.roofFront, s.bPillar, rear, { base: glassEnd, top: roofRear }, 0.1);
  if (near && !s.windows) g.panels = g.panels.map((p, i) => (i >= 3 ? PAINT_SLOT : p));
  if (!near && !s.windows) {
    // Far, panel van: glass to the B pillar, paint behind it.
    g.lines = [{ base: s.windscreenBase, top: s.roofFront }, { base: s.bPillar, top: s.bPillar }, { base: glassEnd, top: roofRear }];
    g.panels = [g.panels[0], PAINT_SLOT];
  }
  const roofHw = hw - 0.11;
  glasshouse(vb, L, { belt: [s.belt, beltRear], roof: [s.height - 0.01, s.height], baseHw: hw - 0.04, roofHw, ...g, rearPaint: near ? 0.1 : 0 });

  if (s.roofBars) roofBars(vb, L, s.roofFront + 0.3, roofRear - 0.1, roofHw - 0.02, s.height, 3, near);
  if (near) {
    mirrors(vb, L, s.windscreenBase - 0.05, s.windscreenBase + 0.15, hw - 0.04, s.belt + 0.02, 0.2);
    if (s.plates) {
      numberPlate(vb, L, sil, noseFaceMid(s), "front", near);
      numberPlate(vb, L, sil, (beltRear + s.bumperTop - 0.04) / 2 - 0.05, "rear", near);
    }
    if (s.towBar) towBar(vb, L, -L / 2 + 0.15, s.sill + 0.02);
  }
  wheels(vb, s, near);
  return vb.mesh;
}
