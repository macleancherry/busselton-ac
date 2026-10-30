// Busselton fork: the ground a landmark layer stands on (scripts/polish/landmarks.ts).
//
// A landmark is placed on a finished base, so its ground comes from the base's own meshes. In
// order: the physics ground (terrain, roads, paths, car parks; not walls) under the point; else the
// nearest physics ground within `near` metres (a landmark's middle can sit on a spot the base
// cleared or paved); else the horizon mesh (BACKDROP_...) under it, the ground you see out past the
// corridor, which country builds keep only about 70 m either side of the road; else the DEM, when
// the caller has one; else 0.
import type { Kn5Model } from "./kn5";
import { surfaceHeight } from "./layouts";

export type GroundSource = "terrain" | "near" | "backdrop" | "dem" | "none";
type MaybeHeight = (x: number, y: number) => number | null;

export interface LandmarkGround {
  (x: number, y: number): number;
  /** Where the height at a point comes from (for the build log). */
  source(x: number, y: number): GroundSource;
}

export interface LandmarkGroundOptions {
  /** Heights where the base has no mesh, e.g. the DEM tiles: local x east, y north. */
  dem?: MaybeHeight;
  /** How far to look for physics ground around a point with none under it, metres (default 40). */
  near?: number;
}

/** Physics ground: any mesh you can stand on (a digit then a surface key), not walls. */
export const PHYSICS_GROUND = /^\d(?!WALL)/;
/** The horizon terrain's chunks (src/core/backdrop.ts). */
export const BACKDROP = /^BACKDROP_/;

export function landmarkGround(world: Kn5Model, opts: LandmarkGroundOptions = {}): LandmarkGround {
  return groundFrom(surfaceHeight(world, PHYSICS_GROUND), surfaceHeight(world, BACKDROP), opts);
}

/** The same lookup over height functions (what `landmarkGround` builds from a base's meshes). */
export function groundFrom(terrain: MaybeHeight, backdrop: MaybeHeight, opts: LandmarkGroundOptions = {}): LandmarkGround {
  const near = opts.near ?? 40;
  const lookup = (x: number, y: number): [number, GroundSource] => {
    const h = terrain(x, y);
    if (h !== null) return [h, "terrain"];
    for (let r = 1; r <= near; r += 1) {
      for (let a = 0; a < 24; a++) {
        const t = (a / 24) * 2 * Math.PI, g = terrain(x + Math.cos(t) * r, y + Math.sin(t) * r);
        if (g !== null) return [g, "near"];
      }
    }
    const b = backdrop(x, y);
    if (b !== null) return [b, "backdrop"];
    const d = opts.dem?.(x, y) ?? null;
    if (d !== null && Number.isFinite(d)) return [d, "dem"];
    return [0, "none"];
  };
  const fn = ((x: number, y: number) => lookup(x, y)[0]) as LandmarkGround;
  fn.source = (x, y) => lookup(x, y)[1];
  return fn;
}
