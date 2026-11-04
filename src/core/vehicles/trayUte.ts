// A generic single or extra cab ute with a flat alloy tray (the Hilux and LandCruiser 70 work ute
// kind), our own geometry from published overall dimensions only (docs/plans/local-cars.md): the
// dual-cab ute's nose, a short cab with its back wall down to the sill, the chassis and rear wheels
// open under a wide alloy tray with drop sides, a headboard and (often) toolboxes underneath.

import { bullBar, ladderRack, mirrors } from "./extras";
import {
  archFlares, dimensionsOf, GRILLE_TILE, ATLAS_H, ATLAS_W, glasshouse, numberPlate, openTray, PAINT_SLOT, plateAt, Sil, SW,
  towBar, VehicleBuilder, wheelCentre, wheels, type BaseSpec, type Dimensions, type VehicleMesh,
} from "./vehicle";

export interface TrayUteSpec extends BaseSpec {
  /** Width of the cab (the spec's `width` is the tray's, the widest part). */
  cabWidth: number;
  sill: number;
  bonnetFront: number;
  belt: number;
  windscreenBase: number;
  roofFront: number;
  /** "single" (two seats) or "extra" (a short second row with small rear doors). */
  cab: "single" | "extra";
  /** Bottom and floor of the tray, top of its drop sides. */
  trayBottom: number;
  trayFloor: number;
  trayRail: number;
  flares: boolean;
  toolboxes: boolean;
  rack: boolean;
  bullBar: boolean;
  towBar: boolean;
  plates: boolean;
  barSwatch: number;
}

/** About a Hilux single cab-chassis with a 1.8 m alloy tray: 5.3 x 1.86 x 1.8 m, 3.09 m wheelbase. */
export const TRAY_UTE_DEFAULTS: TrayUteSpec = {
  length: 5.3, width: 1.86, height: 1.8, wheelbase: 3.09, frontOverhang: 0.93,
  wheelRadius: 0.36, track: 1.54, tyreWidth: 0.215, cabWidth: 1.8, sill: 0.48,
  bonnetFront: 0.98, belt: 1.1, windscreenBase: 1.78, roofFront: 2.46, cab: "single",
  trayBottom: 0.9, trayFloor: 1.0, trayRail: 1.28,
  flares: false, toolboxes: false, rack: false, bullBar: false, towBar: false, plates: true, barSwatch: SW.TRIM,
};

export const TRAY_UTE_VARIANTS: Record<string, Partial<TrayUteSpec>> = {
  plain: {},
  extra: { cab: "extra" },
  tradie: { toolboxes: true, rack: true, towBar: true },
  full: { cab: "extra", toolboxes: true, rack: true, bullBar: true, towBar: true },
};

/** The tray's front, just behind the cab. */
const t0Of = (cabBack: number) => cabBack + 0.06;

export function trayUteDimensions(spec: Partial<TrayUteSpec> = {}): Dimensions {
  return dimensionsOf({ ...TRAY_UTE_DEFAULTS, ...spec });
}

export function buildTrayUte(spec: Partial<TrayUteSpec> = {}, lod: 0 | 1 = 0): VehicleMesh {
  const s = { ...TRAY_UTE_DEFAULTS, ...spec };
  const vb = new VehicleBuilder();
  const L = s.length, hw = s.cabWidth / 2, tw = s.width / 2, near = lod === 0;
  const fa = s.frontOverhang, ra = fa + s.wheelbase;
  const archR = s.wheelRadius + 0.085, archH = wheelCentre(s.wheelRadius) + 0.03, segs = near ? 4 : 2;
  const nose = hw - 0.035;
  const cb = s.cab === "extra" ? 3.2 : 2.78, rf = s.roofFront, rr = cb - 0.08, ws = s.windscreenBase;
  const f = (d: number) => L / 2 - d;

  // The cab's silhouette: the ute's nose, the cab's back wall down to the sill, only the front arch.
  const sil = new Sil();
  sil.add({ d: 0.06, h: s.sill, hw: nose, inset: 0.12, ds: 0.1 }, { kind: "body", mid: SW.TRIM, corner: SW.TRIM });
  sil.add({ d: 0.0, h: s.sill + 0.17, hw: nose, inset: 0.16, ds: 0.12 }, { kind: "body" }, true);
  sil.add({ d: 0.02, h: s.bonnetFront - 0.19, hw: nose, inset: 0.2, ds: 0.13 }, { kind: "body", mid: "grille", corner: SW.HEAD });
  sil.add({ d: 0.1, h: s.bonnetFront, hw: nose, inset: 0.2, drop: 0.03, ds: 0.1 }, { kind: "body" });
  sil.add({ d: 0.95, h: (s.bonnetFront + s.belt) / 2 + 0.01, hw, inset: 0.07, drop: 0.04 }, { kind: "body" }, true);
  sil.add({ d: ws, h: s.belt, hw, inset: 0.06, drop: 0.03 }, { kind: "body" }); // under the cab
  sil.add({ d: cb, h: s.belt + 0.03, hw }, { kind: "body" }); // the cab's back wall
  sil.add({ d: cb, h: s.sill, hw }, { kind: "skip" });
  sil.arches(null, fa, archH, archR, s.sill, segs, hw);
  sil.build(vb, L, near, s);
  if (s.flares && near) archFlares(vb, L, fa, archH, archR, s.sill, segs, hw);

  // Cab glass: A pillar, door glass, (extra cab: B pillar, small rear glass), back pillar; a small back window.
  const lines = !near
    ? [{ base: ws, top: rf }, { base: cb, top: rr }]
    : s.cab === "extra"
      ? [{ base: ws, top: rf }, { base: ws + 0.12, top: rf + 0.07 }, { base: cb - 0.48, top: rr - 0.4 }, { base: cb - 0.4, top: rr - 0.32 }, { base: cb - 0.12, top: rr - 0.08 }, { base: cb, top: rr }]
      : [{ base: ws, top: rf }, { base: ws + 0.12, top: rf + 0.07 }, { base: cb - 0.14, top: rr - 0.08 }, { base: cb, top: rr }];
  const panels = !near ? [SW.GLASS] : lines.slice(1).map((_, i) => (i % 2 === 0 ? PAINT_SLOT : SW.GLASS));
  glasshouse(vb, L, { belt: [s.belt, s.belt + 0.03], roof: [s.height - 0.02, s.height], baseHw: hw - 0.05, roofHw: hw - 0.19, lines, panels, rearPaint: near ? 0.16 : 0 });

  // Chassis rails behind the cab, low under the tray (the wheels and daylight show above them), and the
  // tray's cross bearers on them.
  vb.box([f(L - 0.3), f(cb)], [-0.45, 0.45], [s.sill - 0.06, s.sill + 0.14], SW.TRIM, ["bottom", "front"]);
  if (near) {
    for (const d of [t0Of(cb) + 0.3, L - 0.35]) {
      vb.box([f(d) - 0.04, f(d) + 0.04], [-0.45, 0.45], [s.sill + 0.14, s.trayBottom], SW.TRIM, ["bottom", "top", "left", "right"]);
    }
  }

  // The tray: outer walls, then an open tray inside (alloy all over), a headboard with a mesh panel.
  const t0 = t0Of(cb);
  // (The outer front face only below the floor: above it the tray's own front wall faces back.)
  vb.box([f(L), f(t0)], [-tw, tw], [s.trayBottom, s.trayRail], SW.ALLOY, ["bottom", "top", "front"]);
  vb.face([[f(t0), tw, s.trayBottom], [f(t0), -tw, s.trayBottom], [f(t0), -tw, s.trayFloor], [f(t0), tw, s.trayFloor]], SW.ALLOY, [1, 0, 0]);
  if (near) openTray(vb, L, t0, L, s.trayRail, s.trayFloor, tw, 0.04, SW.CHROME, SW.ALLOY);
  else vb.face([[f(t0), tw, s.trayRail - 0.01], [f(L), tw, s.trayRail - 0.01], [f(L), -tw, s.trayRail - 0.01], [f(t0), -tw, s.trayRail - 0.01]], SW.ALLOY, [0, 0, 1]);
  const hb = s.height - 0.04, fh = f(t0) - 0.04;
  vb.box([fh - 0.04, fh], [-(tw - 0.02), tw - 0.02], [s.trayRail, hb], SW.CHROME, ["bottom", "left", "right"]);
  if (near) {
    const [gx, gy, gw, gh] = GRILLE_TILE, U = (x: number, y: number): [number, number] => [x / ATLAS_W, y / ATLAS_H];
    const fb = fh - 0.045, w = tw - 0.1;
    vb.face([[fb, w, s.trayRail + 0.06], [fb, -w, s.trayRail + 0.06], [fb, -w, hb - 0.06], [fb, w, hb - 0.06]],
      [U(gx, gy + gh), U(gx + gw, gy + gh), U(gx + gw, gy), U(gx, gy)], [-1, 0, 0]);
    // Tail lamps on the tray's back face, low at the corners.
    for (const sgn of [1, -1]) {
      vb.face([[f(L) - 0.01, sgn * (tw - 0.06), s.trayBottom + 0.03], [f(L) - 0.01, sgn * (tw - 0.3), s.trayBottom + 0.03],
        [f(L) - 0.01, sgn * (tw - 0.3), s.trayBottom + 0.13], [f(L) - 0.01, sgn * (tw - 0.06), s.trayBottom + 0.13]], SW.TAIL, [-1, 0, 0]);
    }
  }
  if (s.toolboxes) {
    // Under the tray either side, between the cab and the rear wheels.
    const d0 = t0 + 0.05, d1 = ra - archR - 0.05;
    vb.boxPair([f(d1), f(d0)], [tw - 0.55, tw - 0.02], [s.trayBottom - 0.42, s.trayBottom], SW.ALLOY, near ? ["top", "inner"] : ["top", "inner", "bottom", "front"]);
  }
  if (s.rack) ladderRack(vb, L, t0 + 0.25, L - 0.1, tw, s.trayRail, s.height + 0.12, s.barSwatch, near);

  if (s.bullBar) bullBar(vb, L, nose, s.sill - 0.02, s.bonnetFront + 0.06, s.barSwatch, near);
  if (near) {
    mirrors(vb, L, ws + 0.08, ws + 0.22, hw, s.belt + 0.05);
    if (s.plates) {
      numberPlate(vb, L, sil, s.sill + 0.12, "front", near);
      plateAt(vb, f(L), s.trayBottom + 0.09, -1);
    }
    if (s.towBar) towBar(vb, L, f(L - 0.4), s.sill - 0.08);
  }
  wheels(vb, s, near);
  return vb.mesh;
}
