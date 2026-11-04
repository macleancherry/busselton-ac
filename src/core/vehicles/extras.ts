// Accessories shared by the local-cars bodies (docs/plans/local-cars.md): mirrors, bull bar,
// snorkel, roof rack and rails, the ute's sports bar and ladder rack. Boxes, with the faces nobody
// sees (against the body, under a bar, tiny ends) left out to keep within each body's triangle cap.
// Positions are in d (back from the front) or f (forward of the middle) as noted; the body's length
// turns one into the other.

import { SW, type VehicleBuilder } from "./vehicle";

/**
 * Door mirrors either side: a slim housing (black cap) on a short stalk from the door's front corner,
 * its back edge `d` back from the front, reaching `out` past the body's side at `hw` (the widest, not
 * the tucked-in belt, so daylight shows between housing and glass), its bottom at h. `tall` is the
 * housing's height (cars 0.13, utes and vans 0.16).
 */
export function mirrors(vb: VehicleBuilder, len: number, d: number, hw: number, h: number, out = 0.2, tall = 0.13): void {
  const f0 = len / 2 - d;
  // Stalk: from inside the shoulder out to the housing, low and thin; only its top and front show.
  vb.boxPair([f0 + 0.02, f0 + 0.08], [hw - 0.1, hw + 0.022], [h, h + 0.04], SW.TRIM, ["bottom", "inner", "outer", "back"]);
  // Housing: 0.11 m deep.
  vb.boxPair([f0, f0 + 0.11], [hw + 0.02, hw + out], [h + 0.02, h + 0.02 + tall], SW.TRIM, ["bottom", "inner"]);
}

/**
 * A bull bar across the front, from the ground clearance `low` to `top`; `nose` is the half width at
 * the front. Two uprights over the lamps, a hoop, a lower bar and (near) wings to the guards.
 */
export function bullBar(vb: VehicleBuilder, len: number, nose: number, low: number, top: number, swatch: number, near: boolean): void {
  const fr = len / 2 + 0.12;
  vb.boxPair([fr - 0.07, fr], [0.22, 0.3], [low, top - 0.07], swatch, ["bottom", "back", "top"]);
  vb.box([fr - 0.07, fr], [-(nose - 0.08), nose - 0.08], [top - 0.07, top], swatch, near ? ["left", "right", "bottom"] : ["left", "right", "bottom", "back"]);
  vb.box([fr - 0.03, fr + 0.02], [-(nose - 0.02), nose - 0.02], [low + 0.04, low + 0.3], swatch, near ? ["bottom", "back", "left", "right"] : ["bottom", "back", "left", "right", "top"]);
  if (near) vb.boxPair([fr - 0.07, fr], [nose - 0.12, nose - 0.02], [low + 0.3, top - 0.07], swatch, ["bottom", "back", "top", "inner"]);
}

/** A snorkel up the left (passenger) A pillar from the guard to the roof line, its head facing forward. */
export function snorkel(vb: VehicleBuilder, len: number, d: number, hw: number, low: number, top: number, near: boolean): void {
  const fd = len / 2 - d, sd = hw + 0.02;
  vb.box([fd - 0.11, fd], [sd, sd + 0.1], [low, near ? top - 0.12 : top], SW.TRIM, near ? ["bottom", "top"] : ["bottom"]);
  if (near) vb.box([fd - 0.04, fd + 0.08], [sd, sd + 0.1], [top - 0.12, top], SW.TRIM, ["bottom", "back", "right"]);
}

/** A flat roof rack (a platform) on four feet, between d0 and d1, `hw` its half width, on a roof at h. */
export function roofRack(vb: VehicleBuilder, len: number, d0: number, d1: number, hw: number, h: number, near: boolean): void {
  const top = h + 0.1;
  vb.box([len / 2 - d1, len / 2 - d0], [-hw, hw], [top, top + 0.05], SW.TRIM, near ? ["bottom"] : ["bottom", "front", "back"]);
  // The feet as one skirt each side (its tiny ends left out).
  if (near) vb.boxPair([len / 2 - d1 + 0.05, len / 2 - d0 - 0.05], [hw - 0.06, hw], [h - 0.01, top], SW.TRIM, ["bottom", "top", "inner", "front", "back"]);
}

/** Roof rails: two low bars along the roof's edges (SUVs and wagons). */
export function roofRails(vb: VehicleBuilder, len: number, d0: number, d1: number, s: number, h: number, swatch: number = SW.TRIM): void {
  vb.boxPair([len / 2 - d1, len / 2 - d0], [s - 0.05, s], [h - 0.01, h + 0.05], swatch, ["bottom", "front", "back"]);
}

/**
 * Roof bars across a tall roof (vans): two rails along the edges and `bars` cross bars on them. Seen
 * from below only from far off, so no bottoms or ends.
 */
export function roofBars(vb: VehicleBuilder, len: number, d0: number, d1: number, hw: number, h: number, bars: number, near: boolean): void {
  vb.boxPair([len / 2 - d1, len / 2 - d0], [hw - 0.05, hw], [h - 0.01, h + 0.05], SW.TRIM, ["bottom", "front", "back", near ? "" : "inner"]);
  for (let k = 0; k < bars; k++) {
    const d = d0 + 0.1 + ((d1 - d0 - 0.2) * k) / Math.max(1, bars - 1), f = len / 2 - d;
    vb.box([f - 0.03, f + 0.03], [-hw, hw], [h + 0.05, h + 0.1], SW.TRIM, ["bottom", "left", "right"]);
  }
}

/** The ute's sports bar: two uprights from the rails and a top bar, just behind the cab (d from the front). */
export function sportsBar(vb: VehicleBuilder, len: number, d: number, hw: number, rail: number, top: number, swatch: number): void {
  const f0 = len / 2 - d - 0.08, f1 = len / 2 - d;
  vb.boxPair([f0, f1], [hw - 0.12, hw - 0.04], [rail, top], swatch, ["bottom", "top"]);
  vb.box([f0, f1], [-(hw - 0.04), hw - 0.04], [top, top + 0.07], swatch, ["left", "right"]);
}

/**
 * A ladder rack over a tray: two hoops (behind the cab and at the tailgate), each two posts and a
 * cross bar at `top`. No long rails: two hoops read as a rack and cost half as much.
 */
export function ladderRack(vb: VehicleBuilder, len: number, d0: number, d1: number, hw: number, rail: number, top: number, swatch: number, near: boolean): void {
  for (const d of [d0, d1]) {
    const f = len / 2 - d;
    // Far: the posts without their inner faces, the bars without top and bottom (each a pixel or two by then).
    vb.boxPair([f - 0.04, f + 0.04], [hw - 0.08, hw - 0.02], [rail, top], swatch, near ? ["bottom", "top"] : ["bottom", "top", "inner"]);
    vb.box([f - 0.04, f + 0.04], [-(hw - 0.02), hw - 0.02], [top, top + 0.06], swatch, near ? ["left", "right"] : ["left", "right", "bottom", "top"]);
  }
}
