// Busselton fork: per-track tuning for Pure (Peter Boese's CSP weather and lighting script) and the
// bright, clear south-west WA sun on pale limestone and sand. See docs/csp.md, "Pure".
//
// What a track can give Pure: the `[PURE]` section of its extension/ext_config.ini. CSP ships one in
// seven of its own track configs (ks_red_bull_ring, kazan_ring, monaco_1966 ...), all with the same
// values; Pure's documentation and script aren't public, so these nine keys are the whole known
// interface and their exact meaning is unconfirmed (the names follow Sol's `[SOL]` keys: haze by time
// of day, fog, dawn and dusk). Pure's exposure, sun brightness and tonemapping are player settings
// (Pure Config and its PP filter), with no track key: docs/csp.md "Pure" has the player side.
//
// So this module only moves the haze, within the range CSP's own configs use, from where the track is:
// - Clear air (south-west WA: dry, far from big cities, westerly sea breeze): less haze at noon and in
//   the evening than CSP's generic values.
// - Coast: a little more haze in the morning (sea mist off the water before the breeze).
// And, outside Pure (CSP material values, so it applies under Sol too), it calms the aerial photo on
// ground that's mostly white sand or limestone: the photo already carries the sun, so lit again by a
// strong sun it washes out and drags auto exposure down.

/** Rec. 709 luminance of an sRGB pixel, 0..1 (no linearising: a relative brightness is enough). */
const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * Average brightness of the ground photos (0..1), sampled on a coarse grid so it's cheap on big
 * builds. Undefined without photos. Transparent pixels (no imagery) are skipped.
 */
export function groundAlbedo(photos: { rgba: Uint8Array | Uint8ClampedArray; size: number }[], step = 8): number | undefined {
  let sum = 0, n = 0;
  for (const { rgba, size } of photos) {
    for (let y = step >> 1; y < size; y += step) {
      for (let x = step >> 1; x < size; x += step) {
        const i = (y * size + x) * 4;
        if (rgba[i + 3] < 128) continue;
        sum += luma(rgba[i], rgba[i + 1], rgba[i + 2]);
        n++;
      }
    }
  }
  return n ? sum / n : undefined;
}

export interface AtmosphereInput {
  /** The track's centre, [lng, lat]. */
  at: [number, number];
  /** Average ground photo brightness (groundAlbedo), 0..1. */
  albedo?: number;
  /** There's sea in the track. */
  coast?: boolean;
  /** The photo ground's material light (ksAmbient, ksDiffuse), as built: scaled down on bright ground. */
  photoLight?: { ambient: number; diffuse: number };
}

export interface PureValues {
  SUN_DAWN: number;
  SUN_DUSK: number;
  FOG_LEVEL: number;
  FOG_BLEND: number;
  FOG_DISTANCE: number;
  SMOG_MORNING: number;
  SMOG_NOON: number;
  SMOG_EVENING: number;
}

/** CSP's values (every shipped track config with a [PURE] section uses exactly these). */
export const PURE_DEFAULTS: PureValues = {
  SUN_DAWN: 1, SUN_DUSK: 1, FOG_LEVEL: 0.05, FOG_BLEND: 1.15, FOG_DISTANCE: 0.9,
  SMOG_MORNING: 0.05, SMOG_NOON: 0.1, SMOG_EVENING: 0.15,
};

/** Typical average brightness of a suburban aerial photo (lawn, roofs, bitumen, trees). */
export const TYPICAL_ALBEDO = 0.3;

/** South-west WA (Geraldton to Esperance, coast to the wheatbelt): dry, clean air. */
export function clearAirRegion([lng, lat]: [number, number]): boolean {
  return lng > 112 && lng < 124 && lat < -27 && lat > -36;
}

export function pureValues(inp: AtmosphereInput): PureValues {
  const v = { ...PURE_DEFAULTS };
  if (clearAirRegion(inp.at)) {
    v.SMOG_NOON = 0.07;
    v.SMOG_EVENING = 0.1;
  }
  if (inp.coast) v.SMOG_MORNING = 0.08;
  return v;
}

/**
 * How much to calm the photo ground's light: 1 on ordinary ground, down to 0.85 where the photo
 * averages well above a suburb's brightness (white sand, limestone, salt).
 */
export function groundDamping(albedo: number | undefined): number {
  if (albedo === undefined || albedo <= TYPICAL_ALBEDO) return 1;
  return Math.max(0.85, Math.sqrt(TYPICAL_ALBEDO / albedo));
}

const f2 = (v: number) => v.toFixed(2);
const f3 = (v: number) => v.toFixed(3);

/** ext_config.ini sections: [PURE], and on bright ground a SHADER_REPLACEMENT for the photo ground. */
export function pureSections(inp: AtmosphereInput): string[] {
  const v = pureValues(inp);
  const lines = [
    `; Pure: haze for ${clearAirRegion(inp.at) ? "clear south-west WA air" : "generic air"}${inp.coast ? " on the coast" : ""}` +
      `${inp.albedo !== undefined ? `; ground photo brightness ${f2(inp.albedo)}` : ""}.`,
    "[PURE]",
    "ACTIVE = 1",
    ...Object.entries(v).map(([k, x]) => `${k} = ${Number.isInteger(x) ? x : f2(x)}`),
    "",
  ];
  const k = groundDamping(inp.albedo);
  if (k < 1 && inp.photoLight) {
    lines.push(
      "; Bright sand and limestone: the photo already holds the sun, so light it a little less.",
      "[SHADER_REPLACEMENT_...]",
      "MATERIALS = terrain_?",
      `PROP_0 = ksAmbient, ${f3(inp.photoLight.ambient * k)}`,
      `PROP_1 = ksDiffuse, ${f3(inp.photoLight.diffuse * k)}`,
      "",
    );
  }
  return lines;
}
