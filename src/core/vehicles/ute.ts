// A generic dual-cab 4x4 ute (the Hilux / Ranger / Triton / D-Max / BT-50 kind), our own geometry
// from a few proportions, no badges or copied shapes (docs/plans/local-cars.md). Prototype for the
// local-cars set: the other bodies (wagon, SUV, hatch, sedan, van) follow the same silhouette +
// glasshouse + parts pattern.

import {
  archFlares, archPoints, glasshouse, lowerBody, openTray, PAINT_SLOT, SW, VehicleBuilder, wheel,
  type SilEdge, type SilPt, type VehicleMesh,
} from "./vehicle";

export interface UteSpec {
  /** Body length, width (body, not mirrors) and roof height, metres. */
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  frontOverhang: number;
  wheelRadius: number;
  /** Centre of tyre to centre of tyre across an axle. */
  track: number;
  tyreWidth: number;
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
  /** Tray floor height (inside), rail height. */
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
  /** The bull bar's and bars' finish: black or alloy. */
  barSwatch: number;
}

/** About a current Hilux / Ranger dual cab, from published dimensions only. */
export const UTE_DEFAULTS: UteSpec = {
  length: 5.33, width: 1.86, height: 1.82, wheelbase: 3.09, frontOverhang: 0.93,
  wheelRadius: 0.385, track: 1.56, tyreWidth: 0.26, sill: 0.5,
  bonnetFront: 1.0, belt: 1.13,
  windscreenBase: 1.8, cabBack: 3.9, roofFront: 2.5, roofRear: 3.82,
  trayFloor: 0.8, trayRail: 1.17,
  flares: true, bullBar: false, snorkel: false, tray: "none", roofRack: false, barSwatch: SW.TRIM,
};

/** The ute's template at LOD 0 (near, about 300 triangles) or 1 (far, under 100: no chamfers, lamps, mirrors or wheel faces). */
export function buildUte(spec: Partial<UteSpec> = {}, lod: 0 | 1 = 0): VehicleMesh {
  const s = { ...UTE_DEFAULTS, ...spec };
  const vb = new VehicleBuilder();
  const L = s.length, hw = s.width / 2, near = lod === 0;
  const fa = s.frontOverhang, ra = fa + s.wheelbase;
  const archR = s.wheelRadius + 0.085, archH = s.wheelRadius + 0.02, segs = near ? 4 : 2;
  const nose = hw - 0.035;
  const canopy = s.tray === "canopy";

  // Silhouette, front bumper round the top to the rear bumper and back along the bottom.
  const pts: SilPt[] = [], edges: SilEdge[] = [];
  const add = (p: SilPt, e: SilEdge) => {
    pts.push(p);
    edges.push(e);
  };
  add({ d: 0.06, h: s.sill, hw: nose, inset: 0.12, ds: 0.1 }, { kind: "body", mid: SW.TRIM, corner: SW.TRIM }); // lower bumper
  add({ d: 0.0, h: s.sill + 0.17, hw: nose, inset: 0.16, ds: 0.12 }, { kind: "body" }); // bumper face
  add({ d: 0.02, h: s.bonnetFront - 0.19, hw: nose, inset: 0.2, ds: 0.13 }, { kind: "body", mid: "grille", corner: SW.HEAD }); // grille, lamps at the corners
  add({ d: 0.1, h: s.bonnetFront, hw: nose, inset: 0.2, drop: 0.03, ds: 0.1 }, { kind: "body" }); // bonnet front half
  add({ d: 0.95, h: (s.bonnetFront + s.belt) / 2 + 0.01, hw, inset: 0.07, drop: 0.04 }, { kind: "body" }); // bonnet rear half
  add({ d: s.windscreenBase, h: s.belt, hw, inset: 0.06, drop: 0.03 }, { kind: "body" }); // under the cab
  add({ d: s.cabBack, h: s.trayRail - 0.01, hw }, { kind: canopy ? "body" : "skip" }); // the tray (openTray), or a lid under a canopy
  add({ d: L - 0.03, h: s.trayRail, hw, inset: 0.09, ds: -0.03 }, { kind: "body", corner: SW.TAIL }); // tailgate, tail lamps at the corners
  add({ d: L, h: s.sill + 0.28, hw, inset: 0.06, ds: -0.04 }, { kind: "body", mid: SW.TRIM, corner: SW.TRIM }); // rear step bumper
  add({ d: L - 0.04, h: s.sill + 0.05, hw }, { kind: "skip" });
  add({ d: ra + archR + 0.4, h: s.sill, hw }, { kind: "skip" });
  for (const [i, p] of archPoints(ra, archH, archR, s.sill, segs, hw).entries()) add(p, { kind: i < segs ? "across" : "skip", mid: SW.TRIM });
  for (const [i, p] of archPoints(fa, archH, archR, s.sill, segs, hw).entries()) add(p, { kind: i < segs ? "across" : "skip", mid: SW.TRIM });
  if (!near) {
    // Far: no rounding (one strip per edge), no bumper face point.
    pts.splice(1, 1);
    edges.splice(1, 1);
    for (const p of pts) p.inset = p.drop = p.ds = 0;
    for (const e of edges) if (e.mid === "grille") e.mid = SW.TRIM;
  }
  lowerBody(vb, L, pts, edges);
  if (near && s.tray !== "canopy") {
    // The gap between cab and tray: a dark strip on each side.
    for (const sgn of [1, -1]) {
      const fc = L / 2 - s.cabBack - 0.005;
      vb.face([[fc + 0.02, sgn * (hw + 0.004), s.sill + 0.1], [fc - 0.02, sgn * (hw + 0.004), s.sill + 0.1],
        [fc - 0.02, sgn * (hw + 0.004), s.trayRail], [fc + 0.02, sgn * (hw + 0.004), s.trayRail]], SW.TRIM, [0, sgn, 0]);
    }
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
    belt: [s.belt, s.trayRail - 0.01], roof: [s.height - 0.02, s.height], baseHw: hw - 0.05, roofHw: hw - 0.21,
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
    vb.box([f(d1), f(d0)], [-(hw - 0.02), hw - 0.02], [s.trayRail, top], PAINT_SLOT, ["bottom", "front"]);
    if (near) {
      for (const sgn of [1, -1]) {
        vb.face([[f(d1 - 0.12), sgn * (hw - 0.012), s.trayRail + 0.12], [f(d0 + 0.12), sgn * (hw - 0.012), s.trayRail + 0.12],
          [f(d0 + 0.12), sgn * (hw - 0.012), top - 0.08], [f(d1 - 0.12), sgn * (hw - 0.012), top - 0.08]], SW.GLASS, [0, sgn, 0]);
      }
      vb.face([[f(d1) - 0.012, hw - 0.14, s.trayRail + 0.1], [f(d1) - 0.012, -(hw - 0.14), s.trayRail + 0.1],
        [f(d1) - 0.012, -(hw - 0.14), top - 0.06], [f(d1) - 0.012, hw - 0.14, top - 0.06]], SW.GLASS, [-1, 0, 0]);
    }
  } else if (near) {
    openTray(vb, L, cb + 0.01, L - 0.03, s.trayRail, s.trayFloor, hw);
  } else {
    // Far: a dark lid at rail height reads as an open tray.
    vb.face([[f(cb), hw - 0.05, s.trayRail - 0.02], [f(L - 0.08), hw - 0.05, s.trayRail - 0.02], [f(L - 0.08), -(hw - 0.05), s.trayRail - 0.02], [f(cb), -(hw - 0.05), s.trayRail - 0.02]], SW.LINER, [0, 0, 1]);
  }
  if (s.tray === "sportsBar") {
    // Two uprights from the rails and a top bar, just behind the cab.
    const d0 = cb + 0.18, d1 = cb + 0.26, top = s.height - 0.12;
    vb.boxPair([f(d1), f(d0)], [hw - 0.12, hw - 0.04], [s.trayRail, top], s.barSwatch);
    vb.box([f(d1), f(d0)], [-(hw - 0.04), hw - 0.04], [top, top + 0.07], s.barSwatch);
  } else if (s.tray === "rack") {
    // A ladder rack: four posts and two rails to roof height, a cross bar at each end.
    const top = s.height + 0.08;
    for (const d of [cb + 0.2, L - 0.15]) {
      vb.boxPair([f(d) - 0.04, f(d) + 0.04], [hw - 0.08, hw - 0.02], [s.trayRail, top], s.barSwatch, near ? ["bottom"] : ["bottom", "back", "front"]);
      vb.box([f(d) - 0.04, f(d) + 0.04], [-(hw - 0.02), hw - 0.02], [top, top + 0.06], s.barSwatch);
    }
    if (near) vb.boxPair([f(L - 0.15), f(cb + 0.2)], [hw - 0.08, hw - 0.02], [top, top + 0.06], s.barSwatch);
  }

  // Mirrors (near only), bull bar, snorkel, roof rack.
  if (near) vb.boxPair([f(ws + 0.22), f(ws + 0.08)], [hw - 0.07, hw + 0.17], [s.belt + 0.05, s.belt + 0.23], SW.TRIM);
  if (s.bullBar) {
    const fr = f(-0.12), top = s.bonnetFront + 0.06;
    // Two uprights over the lamps, a hoop across the top, a lower bar, wings to the guards.
    vb.boxPair([fr - 0.07, fr], [0.22, 0.3], [s.sill - 0.02, top], s.barSwatch);
    vb.box([fr - 0.07, fr], [-(nose - 0.08), nose - 0.08], [top - 0.07, top], s.barSwatch);
    vb.box([fr - 0.03, fr + 0.02], [-(nose - 0.02), nose - 0.02], [s.sill + 0.02, s.sill + 0.28], s.barSwatch, near ? ["bottom"] : ["bottom", "top", "back"]);
    if (near) vb.boxPair([fr - 0.07, fr], [nose - 0.12, nose - 0.02], [s.sill + 0.28, top - 0.07], s.barSwatch);
  }
  if (s.snorkel) {
    // Up the left (passenger) A pillar, from the guard to the roof line.
    const fd = f(ws - 0.05), sd = hw + 0.02;
    vb.box([fd - 0.11, fd], [sd, sd + 0.1], [s.belt - 0.3, s.height - 0.05], SW.TRIM, ["bottom"]);
    if (near) vb.box([fd - 0.04, fd + 0.08], [sd, sd + 0.1], [s.height - 0.17, s.height - 0.05], SW.TRIM, ["bottom", "back"]);
  }
  if (s.roofRack) {
    const top = s.height + 0.1;
    vb.box([f(rr - 0.05), f(rf + 0.1)], [-(hw - 0.24), hw - 0.24], [top, top + 0.05], SW.TRIM, near ? ["bottom"] : ["bottom", "front", "back"]);
    if (near) vb.boxPair([f(rr - 0.1), f(rf + 0.15)], [hw - 0.3, hw - 0.24], [s.height - 0.01, top], SW.TRIM, ["bottom", "top"]);
  }

  // Wheels: 8 sides and a drawn face near, plain 4-sided blocks far (as today's boxy car).
  const tr = s.track / 2;
  for (const d of [fa, ra]) for (const side of [tr, -tr]) wheel(vb, L / 2 - d, side, s.wheelRadius, s.tyreWidth, near ? 8 : 4, near);
  return vb.mesh;
}
