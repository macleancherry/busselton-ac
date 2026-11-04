// Pieces the bodies share: the nose and tail of the silhouette, the lower grille, and the glasshouse's
// pillar stations. Each body's own file sets the numbers. The look is a current (2015 to 2025) car's:
// slim lamps wrapping round the corners, a black lip and lower grille, black B pillars.

import { ATLAS_H, ATLAS_W, endPanel, GRILLE_TILE, PAINT_SLOT, SW, type GlassLine, type Sil, type VehicleBuilder } from "./vehicle";

export interface Nose {
  /** Bottom of the bumper; top of the lamps (the bonnet's leading edge), heights. */
  sill: number;
  lampTop: number;
  /** Half width at the nose. */
  hw: number;
  /** How far back the bonnet's leading edge is from the bumper's face. */
  rake: number;
  /** Plan rounding of the nose's corners, metres (cars about 0.24, a 4WD 0.14). */
  round: number;
  /** Height of the lamp band under the bonnet's edge (default 0.1: slim). */
  lamp?: number;
  /** Height of the black lip at the bottom (default 0.1). */
  lip?: number;
  /** A bold upright grille this tall under the lamp band (utes, 4WDs, vans); 0 or none for cars. */
  grille?: number;
  /** Between the lamps: black trim (default, cars) or the grille. */
  upper?: number | "grille";
}

/** The lamp band's bottom: the top of the bumper (cars) or of the bold grille. */
export const lampBottom = (n: Pick<Nose, "lampTop" | "lamp">) => n.lampTop - (n.lamp ?? 0.1);
/** The bumper face's paint: from the lip's top to the lamp band (cars) or the bold grille's bottom. */
export function bumperFace(n: Pick<Nose, "sill" | "lampTop" | "lamp" | "lip" | "grille">): [number, number] {
  return [n.sill + (n.lip ?? 0.1), lampBottom(n) - (n.grille ?? 0)];
}

/** Height of the middle of the bumper's paint face (where the front plate goes). */
export function noseFaceMid(n: Pick<Nose, "sill" | "lampTop" | "lamp" | "lip" | "grille">): number {
  const [a, b] = bumperFace(n);
  return (a + b) / 2;
}

/**
 * The front: the black lip, the bumper face (paint; the plate and, cars, a lower grille on it), a
 * bold grille (utes, 4WDs, vans), the slim lamp band (headlights at its corners, wrapping into the
 * guards; trim or grille between them) and the bonnet's leading edge. Far, the lamp band goes and
 * the bumper or grille runs up to the bonnet.
 */
export function carNose(sil: Sil, n: Nose): void {
  const r = n.round, [faceLo, faceHi] = bumperFace(n), lb = lampBottom(n), g = n.grille ?? 0;
  sil.add({ d: Math.min(0.12, n.rake * 0.4), h: n.sill, hw: n.hw, inset: r * 0.6, ds: r * 0.6 }, { kind: "body", mid: SW.TRIM, corner: SW.TRIM });
  sil.add({ d: 0, h: faceLo, hw: n.hw, inset: r, ds: r }, { kind: "body" });
  // The bold grille's surround is black too, so the whole face reads as one dark grille between the lamps.
  if (g > 0) sil.add({ d: n.rake * 0.15, h: faceHi, hw: n.hw, inset: r, ds: r }, { kind: "body", mid: "grille", corner: SW.TRIM });
  sil.add({ d: n.rake * (g > 0 ? 0.35 : 0.15), h: lb, hw: n.hw, inset: r, ds: r * 0.9 }, { kind: "body", mid: n.upper ?? SW.TRIM, corner: SW.HEAD }, true);
  sil.add({ d: n.rake, h: n.lampTop, hw: n.hw, inset: r, drop: 0.03, ds: r * 0.7 }, { kind: "body" });
}

/**
 * A car's lower grille: a dark trapezoid on the bumper face (near only), wider at the bottom, `hw`
 * its half width at the top, from `lo` to `hi` (inside the bumper face). The plate sits on it.
 */
export function noseGrille(vb: VehicleBuilder, len: number, n: Nose, lo: number, hi: number, hw: number, flare = 0.08): void {
  const [faceLo] = bumperFace(n), lb = lampBottom(n), d2 = n.rake * 0.15;
  const top = (n.grille ?? 0) > 0 ? lb - (n.grille ?? 0) : lb;
  const f = (h: number) => len / 2 - (d2 * (h - faceLo)) / (top - faceLo) + 0.004;
  const [gx, gy, gw, gh] = GRILLE_TILE, U = (x: number, y: number): [number, number] => [x / ATLAS_W, y / ATLAS_H];
  vb.face([[f(lo), hw + flare, lo], [f(lo), -(hw + flare), lo], [f(hi), -hw, hi], [f(hi), hw, hi]],
    [U(gx, gy + gh), U(gx + gw, gy + gh), U(gx + gw, gy), U(gx, gy)], [1, 0, 0]);
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
  /** The lamps: a slim band at the top of the tail panel, wrapping round its corners (default), or none. */
  lamps?: boolean;
  /** The lamp band's height (default 0.11). */
  lamp?: number;
  /** How far the side's top edge is rounded down at the tail (default 0.03; 0 under a tray's rail). */
  drop?: number;
  /** Height of the black diffuser under the bumper (default 0.1). */
  diffuser?: number;
}

/**
 * The back: the tail panel from the deck or hatch edge down to the bumper (a slim lamp band across
 * its top corners, the plate in its middle), the bumper (paint) and a black diffuser under it, then
 * along the bottom to `rearEnd` where the arches start.
 */
export function carTail(sil: Sil, t: Tail): void {
  const L = t.length, r = t.round, lamp = t.lamp ?? 0.11;
  const lamps = t.lamps !== false, drop = t.drop ?? 0.03;
  sil.add({ d: t.d, h: t.h, hw: t.hw, inset: r * 0.8, drop, ds: -r * 0.5 }, { kind: "body", corner: lamps ? SW.TAIL : PAINT_SLOT });
  if (lamps) {
    // The band's bottom: the side's edge as far down as the top's, so the lamp wraps round at its full height.
    const k = lamp / Math.max(lamp, t.h - t.bumperTop);
    sil.add({ d: t.d + (L - t.d) * k, h: t.h - lamp, hw: t.hw, inset: r * 0.9, drop, ds: -r * 0.75 }, { kind: "body" }, true);
  }
  sil.add({ d: L, h: t.bumperTop, hw: t.hw, inset: r, ds: -r }, { kind: "body" });
  sil.add({ d: L - 0.04, h: t.sill + (t.diffuser ?? 0.1), hw: t.hw, inset: r * 0.8, ds: -r * 0.8 }, { kind: "body", mid: SW.TRIM, corner: SW.TRIM }, true);
  sil.add({ d: L - 0.14, h: t.sill, hw: t.hw }, { kind: "skip" });
}

/**
 * Glass stations for a car's side: A pillar, front door glass, B pillar, then the rear door glass
 * and the pillars and windows behind it (`rear` lists the base and top of each station after the B
 * pillar, alternately window and pillar). The A pillar and the last pillar are paint; the B pillar
 * and any between are black, so the glass reads as one band. Far: only the windscreen's and the
 * glass end's stations, all glass. Returns the lines and their panels.
 */
export function sideGlass(near: boolean, ws: number, rf: number, b: number, rear: GlassLine[], end: GlassLine, aPillar = 0.12): { lines: GlassLine[]; panels: number[] } {
  if (!near) return { lines: [{ base: ws, top: rf }, end], panels: [SW.GLASS] };
  const lines: GlassLine[] = [
    { base: ws, top: rf }, { base: ws + aPillar, top: rf + aPillar * 0.6 },
    { base: b - 0.05, top: b - 0.04 }, { base: b + 0.06, top: b + 0.05 },
    ...rear, end,
  ];
  const n = lines.length - 1;
  const panels = lines.slice(1).map((_, i) => (i % 2 === 1 ? SW.GLASS : i === 0 || i === n - 1 ? PAINT_SLOT : SW.TRIM));
  return { lines, panels };
}

/**
 * The tail lamps' inner parts (near only): from each corner's wrap a strip `width` across the top of
 * the tail panel, on the lamp band, so the lamps read from straight behind as well.
 */
export function tailLamps(vb: VehicleBuilder, len: number, sil: Sil, t: Tail, width = 0.24): void {
  const lamp = t.lamp ?? 0.11, r = t.round, h0 = t.h - lamp + 0.012, h1 = t.h - 0.012;
  for (const sgn of [1, -1]) {
    const a = sgn * (t.hw - r * 0.9 - 0.005), b = sgn * (t.hw - r * 0.9 - width);
    endPanel(vb, len, sil, h0, h1, Math.min(a, b), Math.max(a, b), "rear", true, SW.TAIL, 0.004);
  }
}

/**
 * The headlamps' inner parts (near only): from each corner's wrap a strip `width` along the lamp
 * band, so they read as long slim lamps from the front as well.
 */
export function headLamps(vb: VehicleBuilder, len: number, sil: Sil, n: Nose, width = 0.2): void {
  const lb = lampBottom(n), r = n.round, h0 = lb + 0.012, h1 = n.lampTop - 0.012;
  for (const sgn of [1, -1]) {
    const a = sgn * (n.hw - r - 0.005), b = sgn * (n.hw - r - width);
    endPanel(vb, len, sil, h0, h1, Math.min(a, b), Math.max(a, b), "front", true, SW.HEAD, 0.004);
  }
}
