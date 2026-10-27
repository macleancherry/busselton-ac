// Custom Shaders Patch track config (extension/ext_config.ini): Grass FX on the
// grassed ground, and street lighting at night along built-up stretches.
// Docs: https://cup.acstuff.club/docs/csp/tracks/grass-fx and .../tracks/lights

import type { RoadPlan } from "./road";

export interface CspOptions {
  /** Every material name in the track's kn5. */
  materials: string[];
  /** Point on the road at distance s, lateral offset t (left positive), lifted by `lift`; AC world coordinates. */
  along: (s: number, t: number, lift: number) => { pos: [number, number, number] };
  /** Metres between street lights on one side (they alternate sides). */
  lightSpacing?: number;
  /** Whether sample i has kerb and gutter on the left (1) or right (-1); falls back to the samples' own kerb flags. */
  kerbAt?: (i: number, side: 1 | -1) => boolean;
}

/** Ground that can grow grass: the photo-textured terrain and the grass meshes. */
const GRASSY = /^(terrain_t\d+|grass|verge)$/;
/** Surfaces that must stay clear: roads, photo road strips, kerbs, paint, footpaths. */
const OCCLUDING = /^(road_.*|strip_photo_.*|sidestrips_photo|returns_photo|concrete|paint.*|rrpm)$/;

const fmt = (v: number) => (Math.abs(v) < 1e-4 ? "0" : v.toFixed(2));

/**
 * Street light positions: at kerbed (built-up) stretches of the road, every
 * `spacing` metres, alternating sides, set back from the kerb and up a pole's height.
 */
export function streetLightPositions(
  plan: RoadPlan,
  along: CspOptions["along"],
  spacing = 40,
  kerbAt?: CspOptions["kerbAt"],
): [number, number, number][] {
  const out: [number, number, number][] = [];
  let side = 1;
  for (let s = spacing / 2; s < plan.length - 1; s += spacing / 2) {
    // Nearest sample's kerb flags say whether this stretch is in town.
    let i = Math.round((s / plan.length) * (plan.samples.length - 1));
    i = Math.max(0, Math.min(plan.samples.length - 1, i));
    const sample = plan.samples[i];
    const kerbed = kerbAt
      ? kerbAt(i, 1) || kerbAt(i, -1)
      : !!sample.kerb && (sample.kerb[0] > 0.5 || sample.kerb[1] > 0.5);
    side = -side;
    if (!kerbed) continue;
    const t = side * (sample.width / 2 + 1.2);
    out.push(along(s, t, 7.5).pos);
  }
  return out;
}

export function extConfigIni(plan: RoadPlan, opts: CspOptions): string {
  const grass = opts.materials.filter((m) => GRASSY.test(m));
  const occluding = opts.materials.filter((m) => OCCLUDING.test(m));
  const lines: string[] = [
    "; Custom Shaders Patch config, written by the track builder.",
    "; Grass FX on grassed ground; warm street lights at night on built-up stretches.",
    "",
  ];
  if (grass.length) {
    lines.push(
      "[GRASS_FX]",
      `GRASS_MATERIALS = ${grass.join(", ")}`,
      `OCCLUDING_MATERIALS = ${occluding.join(", ")}`,
      "ORIGINAL_GRASS_MATERIALS =",
      // The ground's colour is an aerial photo. Western Australian verges are
      // straw for half the year, so spawn on yellow-green as well as green
      // (MASK_RED_THRESHOLD shifts the target toward yellow), on mid-bright
      // pixels only: not white sand or roofs, not dark shade or bitumen.
      "MASK_MAIN_THRESHOLD = 0.12",
      "MASK_RED_THRESHOLD = 0.3",
      "MASK_MIN_LUMINANCE = 0.06",
      "MASK_MAX_LUMINANCE = 0.55",
      "MASK_BLUR = 2",
      // Rougher and less mown than a race track's grass.
      "SHAPE_SIZE = 1.0",
      "SHAPE_TIDY = 0.35",
      "SHAPE_CUT = 0.35",
      "SHAPE_WIDTH = 1.0",
      "",
    );
  }
  const lights = streetLightPositions(plan, opts.along, opts.lightSpacing ?? 40, opts.kerbAt);
  if (lights.length) {
    lines.push("[LIGHT_SERIES_STREETLIGHTS]");
    lights.forEach((p, k) => lines.push(`POSITION_${k} = ${p.map(fmt).join(", ")}`));
    lines.push(
      "DIRECTION = 0, -1, 0",
      "SPOT = 140",
      "RANGE = 28",
      "COLOR = 1, 0.82, 0.6, 12",
      "CONDITION = NightLights",
      "",
    );
  }
  return lines.join("\n");
}
