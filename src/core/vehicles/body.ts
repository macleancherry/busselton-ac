// Pieces the closed bodies share (hatch, sedan, SUVs, wagons, van, passenger ute): the nose and tail
// of the silhouette and the glasshouse's pillar stations. Each body's own file sets the numbers.

import { PAINT_SLOT, SW, type GlassLine, type Sil } from "./vehicle";

export interface Nose {
  /** Bottom of the bumper, top of the bumper (the lamp line's bottom), top of the lamps (bonnet's leading edge), heights. */
  sill: number;
  bumperTop: number;
  lampTop: number;
  /** Half width at the nose. */
  hw: number;
  /** How far back the bonnet's leading edge is from the bumper's face. */
  rake: number;
  /** Plan rounding of the nose's corners, metres (cars about 0.2, a 4WD 0.1). */
  round: number;
  /** Where the bumper's face is furthest forward, as a fraction of sill to bumper top (default 0.45). */
  face?: number;
}

/** Height of the middle of the bumper's paint face (where the front plate goes). */
export function noseFaceMid(n: Pick<Nose, "sill" | "bumperTop" | "face">): number {
  const faceH = n.sill + (n.bumperTop - n.sill) * (n.face ?? 0.45);
  return (faceH + n.bumperTop) / 2;
}

/**
 * The front: the lower lip (black, an intake), the bumper face (paint, the plate), the lamp line (the
 * grille with headlights at its corners) and the bonnet's leading edge. Four points; the lamp line
 * is near only (far, the bumper's paint runs up to the bonnet), so the nose keeps its length.
 */
export function carNose(sil: Sil, n: Nose): void {
  const r = n.round, faceH = n.sill + (n.bumperTop - n.sill) * (n.face ?? 0.45);
  sil.add({ d: Math.min(0.1, n.rake * 0.4), h: n.sill, hw: n.hw, inset: r * 0.6, ds: r * 0.6 }, { kind: "body", mid: SW.TRIM, corner: SW.TRIM });
  sil.add({ d: 0, h: faceH, hw: n.hw, inset: r, ds: r }, { kind: "body" });
  sil.add({ d: n.rake * 0.3, h: n.bumperTop, hw: n.hw, inset: r, ds: r * 0.9 }, { kind: "body", mid: "grille", corner: SW.HEAD }, true);
  sil.add({ d: n.rake, h: n.lampTop, hw: n.hw, inset: r, drop: 0.03, ds: r * 0.7 }, { kind: "body" });
}

export interface Tail {
  length: number;
  /** Where the tail panel starts (the boot lid's or hatch's rear edge): distance back, height. */
  d: number;
  h: number;
  /** Bottom of the tail panel (the bumper's top), at the very back. */
  bumperTop: number;
  sill: number;
  hw: number;
  round: number;
  /** The lamps: at the tail panel's corners (cars) or none (they're on the glasshouse, vans). */
  lamps?: boolean;
  /** How far the side's top edge is rounded down at the tail (default 0.03; 0 under a tray's rail). */
  drop?: number;
}

/**
 * The back: the tail panel from the deck or hatch edge down to the bumper (tail lamps at its
 * corners, the plate in its middle), the bumper (paint) and a black lip under it, then along the
 * bottom to `rearEnd` where the arches start.
 */
export function carTail(sil: Sil, t: Tail): void {
  const L = t.length, r = t.round;
  sil.add({ d: t.d, h: t.h, hw: t.hw, inset: r * 0.7, drop: t.drop ?? 0.03, ds: -r * 0.5 }, { kind: "body", corner: t.lamps === false ? PAINT_SLOT : SW.TAIL });
  sil.add({ d: L, h: t.bumperTop, hw: t.hw, inset: r, ds: -r }, { kind: "body" });
  sil.add({ d: L - 0.04, h: t.sill + 0.1, hw: t.hw, inset: r * 0.8, ds: -r * 0.8 }, { kind: "body", mid: SW.TRIM, corner: SW.TRIM }, true);
  sil.add({ d: L - 0.14, h: t.sill, hw: t.hw }, { kind: "skip" });
}

/**
 * Glass stations for a car's side: A pillar, front door glass, B pillar, then the rear door glass
 * and the pillars and windows behind it (`rear` lists the base and top of each station after the B
 * pillar, alternately window and pillar). Far: only the windscreen's and the glass end's stations,
 * all glass. Returns the lines and their panels.
 */
export function sideGlass(near: boolean, ws: number, rf: number, b: number, rear: GlassLine[], end: GlassLine, aPillar = 0.12): { lines: GlassLine[]; panels: number[] } {
  if (!near) return { lines: [{ base: ws, top: rf }, end], panels: [SW.GLASS] };
  const lines: GlassLine[] = [
    { base: ws, top: rf }, { base: ws + aPillar, top: rf + aPillar * 0.6 },
    { base: b - 0.05, top: b - 0.04 }, { base: b + 0.06, top: b + 0.05 },
    ...rear, end,
  ];
  const panels = lines.slice(1).map((_, i) => (i % 2 === 0 ? PAINT_SLOT : SW.GLASS));
  return { lines, panels };
}
