// Busselton fork: every per-tree random choice (species, zone size, CSP angle) from a hash of the
// tree's own position (random.ts placeRandom), never from a shared stream consumed in list order,
// so adding or removing one tree leaves every other tree as it was.

import { placeRandom } from "./random";
import { pickSpecies } from "./treeSprites";
import { CARD_FOR, MODEL_FOR, pickWeighted, speciesWeightsAt } from "./treeZones";
import { MODEL_NAMES } from "./treeModels";

/** One salt per kind of draw, so a tree's draws are independent of each other. */
export const TREE_SALT = {
  species: 0x5e11,
  zone: 0x2011,
  bush: 0xb057,
  horizonSpecies: 0x5e12,
  horizonZone: 0x2012,
  cspAngle: 0xa9e1,
} as const;

interface Spot { x: number; y: number; scale: number; variant: number; coastal?: boolean; model?: number }

interface Zones {
  tree<T extends { x: number; y: number; scale: number; variant: number }>(t: T, models: readonly string[], r: number): T | null;
}

export interface PlantCtx {
  zones: Zones | null;
  /** The build's tree model names (zones pick by name). */
  models: readonly string[];
  cspTrees: boolean;
  /** Whether a spot is on a kerbed town street and on the foreshore. */
  where(t: Spot): { town: boolean; foreshore: boolean };
  toLngLat(x: number, y: number): [number, number];
}

/** A tree found in the photo, given its species (or null where its zone thins it out). */
export function plantTree<T extends Spot>(t: T, ctx: PlantCtx): T | null {
  const { town, foreshore } = ctx.where(t);
  // Out of town and off the foreshore, the landscape zone picks the tree (or thins it out).
  if (ctx.zones && !town && !foreshore) return ctx.zones.tree(t, ctx.models, placeRandom(t.x, t.y, TREE_SALT.zone));
  // With CSP trees and no zones, bush trees (not planted streets or foreshore) by place (treeZones.ts).
  if (ctx.cspTrees && !town && !foreshore) {
    const sp = pickWeighted(speciesWeightsAt(...ctx.toLngLat(t.x, t.y), { coastal: !!t.coastal }), placeRandom(t.x, t.y, TREE_SALT.bush));
    return { ...t, variant: CARD_FOR[sp], model: MODEL_NAMES.indexOf(MODEL_FOR[sp]) };
  }
  return { ...t, variant: pickSpecies(placeRandom(t.x, t.y, TREE_SALT.species), !!t.coastal, town, foreshore) };
}

/** A tree line on the horizon: a little bigger, its species, then its zone (null when thinned out). */
export function horizonTree<T extends Spot>(t: T, zones: Zones | null, models: readonly string[]): T | null {
  const s = { ...t, scale: t.scale * 1.15, variant: pickSpecies(placeRandom(t.x, t.y, TREE_SALT.horizonSpecies), !!t.coastal, false) };
  return zones ? zones.tree(s, models, placeRandom(t.x, t.y, TREE_SALT.horizonZone)) : s;
}

/** A CSP tree's turn in degrees. */
export function cspTreeAngle(x: number, y: number): number {
  return placeRandom(x, y, TREE_SALT.cspAngle) * 360;
}
