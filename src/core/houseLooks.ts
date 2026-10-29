// Busselton fork: what a house looks like when we know better than the guess. A street-photo or
// hand-set look says the wall kind ("weatherboard") and maybe its colour; an area's houseStyle
// weights the facades its houses wear. Both pick from upstream's facades (buildingStyles.ts),
// which are a wall kind in a set colour.

import { FACADE_INDEX, FACADES } from "./buildingStyles";
import type { Vec2 } from "./geo";

type RGB = [number, number, number];

/** The facades a look's wall kind can be: houses only (not flats, shops or Queenslanders). */
const KINDS: Record<string, (name: string) => boolean> = {
  brick: (n) => n.startsWith("brick_") && n !== "brick_cream",
  creambrick: (n) => n === "brick_cream",
  weatherboard: (n) => n.startsWith("wb_"),
  render: (n) => n.startsWith("render_"),
  fibro: (n) => n.startsWith("fibro_"),
  cladding: (n) => n.startsWith("clad_"),
};

/**
 * The facade for a look: one named outright ("wb_blue"), or of its wall kind nearest its colour
 * when it has one (hue first), otherwise the house's current facade if that's already the right
 * kind, otherwise the kind's first.
 * Undefined for a kind we don't know.
 */
export function facadeForLook(kind: string | undefined, colour: RGB | undefined, current: number): number | undefined {
  // A facade named outright ("wb_blue").
  if (kind && FACADE_INDEX.has(kind)) return FACADE_INDEX.get(kind)!;
  const fits = kind ? KINDS[kind] : (n: string) => Object.values(KINDS).some((k) => k(n));
  if (!fits) return undefined;
  const options = FACADES.map((f, i) => [f, i] as const).filter(([f]) => fits(f.name));
  if (!options.length) return undefined;
  if (colour) {
    let best = options[0][1], bestD = Infinity;
    for (const [f, i] of options) {
      // Hue before brightness: a photo's exposure moves brightness far more than hue.
      const lf = (f.colour[0] + f.colour[1] + f.colour[2]) / 3, lc = (colour[0] + colour[1] + colour[2]) / 3 || 1;
      const hue = [0, 1, 2].reduce((a, k) => a + (f.colour[k] / lf - colour[k] / lc) ** 2, 0);
      const d = hue * 4 + ((lf - lc) / 255) ** 2;
      if (d < bestD) [best, bestD] = [i, d];
    }
    return best;
  }
  if (options.some(([, i]) => i === current)) return current;
  return kind ? options[0][1] : undefined;
}

/** An area's own mix of facades (by name, weighted), the same pick for a house every build. */
export function facadeForStyle(weights: Record<string, number>, at: Vec2): number | undefined {
  const kinds = Object.entries(weights).filter(([k, w]) => FACADE_INDEX.has(k) && w > 0);
  const total = kinds.reduce((a, [, w]) => a + w, 0);
  if (!total) return undefined;
  const h = ((Math.round(at[0] * 10) * 73856093) ^ (Math.round(at[1] * 10) * 19349663)) >>> 0;
  let pick = ((h % 10000) / 10000) * total;
  for (const [k, w] of kinds) if ((pick -= w) < 0) return FACADE_INDEX.get(k)!;
  return FACADE_INDEX.get(kinds[kinds.length - 1][0])!;
}
