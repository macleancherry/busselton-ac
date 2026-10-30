// Busselton fork: track sounds through CSP's track audio (ext_config.ini), placed from the map:
// waves along the shore, magpies in the parks and kookaburras in the bush.
//
// How CSP plays a track's own sounds (acc-extension-config wiki, Tracks - Audio): an FMOD soundbank
// in the track's extension folder, [SOUNDBANK_n] BANK / GUIDS pointing at it, then one [EVENT_n]
// per emitter with the event's path as GUIDs.txt lists it (FMOD Studio writes lines like
// "{guid} event:/busselton/surf"), POSITION in AC space, VOLUME and per-camera multipliers. Any
// number can be a condition instead of a constant (Tracks - Conditions: SUN, RAIN, and expressions
// over earlier conditions), which is how the birds go quiet at night and in the rain.
//
// CSP ships no ambient sounds a track can use (its only bank is the fireworks one), and we don't
// ship anyone's recordings. So the bank is a placeholder with fixed names: extension/sfx/README.txt
// in the build says what it must hold, the workstation builds it from CC0 or its own recordings,
// and until then the build option stays off (a bank that isn't there just plays nothing; to be
// confirmed in game).

import type { CoastPolygon } from "./coast";
import { SEA_LEVEL } from "./coast";
import type { Vec2 } from "./geo";

export type SoundKind = "surf" | "magpie" | "kookaburra";

/** FMOD event paths the placeholder bank must provide. */
export const SOUND_EVENTS: Record<SoundKind, string> = {
  surf: "event:/busselton/surf",
  magpie: "event:/busselton/magpie",
  kookaburra: "event:/busselton/kookaburra",
};
export const SOUND_BANK = "sfx/busselton.bank";
export const SOUND_GUIDS = "sfx/GUIDs.txt";

export interface SoundEmitter {
  kind: SoundKind;
  /** Local metres: x east, y north, z up. */
  at: [number, number, number];
}

export interface SoundTree {
  x: number;
  y: number;
  /** A bush tree (tuart): kookaburra country. Otherwise park and street trees: magpies. */
  bush?: boolean;
}

export interface SoundOptions {
  /** The drivable roads (route and streets), local metres: emitters out of earshot of them are skipped. */
  roads: Vec2[][];
  /** Ground height, metres. */
  ground: (x: number, y: number) => number;
  /** Earshot: emitters further than this from any road are left out, metres. */
  reach?: number;
  /** Shoreline emitter spacing, metres. */
  surfSpacing?: number;
  maxSurf?: number;
  maxBirds?: number;
}

/** Wave emitters along the real shoreline (not tile seams), nearest the roads first. */
export function surfEmitters(ocean: CoastPolygon[], o: SoundOptions): SoundEmitter[] {
  const reach = o.reach ?? 350, spacing = o.surfSpacing ?? 110, max = o.maxSurf ?? 24;
  const roadDistance = distanceTo(o.roads, reach);
  const spots: { at: Vec2; d: number }[] = [];
  for (const p of ocean) {
    p.rings.forEach((r, ri) => {
      let carry = spacing / 2;
      for (let k = 0; k < r.length; k++) {
        const a = r[k], b = r[(k + 1) % r.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (!p.edge[ri]?.[k]) { carry = spacing / 2; continue; }
        let s = carry;
        for (; s < len; s += spacing) {
          const at: Vec2 = [a[0] + ((b[0] - a[0]) * s) / len, a[1] + ((b[1] - a[1]) * s) / len];
          const d = roadDistance(at[0], at[1]);
          if (d <= reach) spots.push({ at, d });
        }
        carry = s - len;
      }
    });
  }
  return thin(spots.sort((a, b) => a.d - b.d), spacing * 0.9, max).map((s) => ({ kind: "surf", at: [s.at[0], s.at[1], SEA_LEVEL + 0.5] }));
}

/**
 * Bird emitters where trees stand thick: each 60 m cell with enough trees is a stand, its middle is
 * the emitter (up in the canopy). Mostly bush trees: kookaburras; otherwise magpies.
 */
export function birdEmitters(trees: SoundTree[], o: SoundOptions): SoundEmitter[] {
  const reach = Math.min(o.reach ?? 350, 250), max = o.maxBirds ?? 24, CELL = 60, MIN_TREES = 6;
  const roadDistance = distanceTo(o.roads, reach);
  const cells = new Map<string, { n: number; bush: number; sx: number; sy: number }>();
  for (const t of trees) {
    const key = `${Math.floor(t.x / CELL)},${Math.floor(t.y / CELL)}`;
    const c = cells.get(key) ?? { n: 0, bush: 0, sx: 0, sy: 0 };
    c.n++; c.sx += t.x; c.sy += t.y;
    if (t.bush) c.bush++;
    cells.set(key, c);
  }
  const stands = [...cells.values()]
    .filter((c) => c.n >= MIN_TREES)
    .map((c) => ({ at: [c.sx / c.n, c.sy / c.n] as Vec2, n: c.n, bush: c.bush / c.n >= 0.5 }))
    .filter((s) => roadDistance(s.at[0], s.at[1]) <= reach)
    .sort((a, b) => b.n - a.n || a.at[0] - b.at[0] || a.at[1] - b.at[1]);
  return thin(stands, 140, max).map((s) => ({
    kind: s.bush ? "kookaburra" : "magpie",
    at: [s.at[0], s.at[1], o.ground(s.at[0], s.at[1]) + 7],
  }));
}

/** Distance to the nearest road point (roads sampled every 10 m), or Infinity beyond `reach`. */
export function distanceTo(roads: Vec2[][], reach: number): (x: number, y: number) => number {
  const cell = Math.max(reach, 1);
  const grid = new Map<string, Vec2[]>();
  const add = (p: Vec2) => {
    const key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
    const list = grid.get(key);
    if (list) list.push(p); else grid.set(key, [p]);
  };
  for (const line of roads) {
    if (line.length === 1) add(line[0]);
    for (let i = 0; i + 1 < line.length; i++) {
      const [a, b] = [line[i], line[i + 1]];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10));
      for (let k = 0; k <= n; k++) add([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
  }
  return (x, y) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let best = Infinity;
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const p of grid.get(`${gx},${gy}`) ?? []) best = Math.min(best, Math.hypot(p[0] - x, p[1] - y));
      }
    }
    return best <= reach ? best : Infinity;
  };
}

/** Greedy: keep each spot (in order) that's at least `gap` from every one kept. */
function thin<T extends { at: Vec2 }>(spots: T[], gap: number, max: number): T[] {
  const kept: T[] = [];
  for (const s of spots) {
    if (kept.length >= max) break;
    if (kept.every((k) => Math.hypot(k.at[0] - s.at[0], k.at[1] - s.at[1]) >= gap)) kept.push(s);
  }
  return kept;
}

const f = (v: number) => v.toFixed(2);

/**
 * The ext_config sections: the soundbank, conditions for the birds, and an event per emitter.
 * Section numbers start high so they don't collide with the config's other conditions.
 */
export function soundConfig(emitters: SoundEmitter[]): string[] {
  if (!emitters.length) return [];
  const lines = [
    "; Track sounds (trackSounds.ts). The bank is a placeholder: see extension/sfx/README.txt.",
    "[SOUNDBANK_0]",
    `BANK = ${SOUND_BANK}`,
    `GUIDS = ${SOUND_GUIDS}`,
    "",
    // Birds sing in daylight, most at dawn and dusk; all of them go quiet in the rain.
    "[CONDITION_20]",
    "NAME = BUSS_DAYLIGHT",
    "INPUT = SUN",
    "LUT = (|0=1|84=1|96=0|180=0|)",
    "LAG = 0.97",
    "",
    "[CONDITION_21]",
    "NAME = BUSS_MAGPIES",
    "INPUT = 'BUSS_DAYLIGHT * (1 - RAIN)'",
    "",
    // Kookaburras: the dawn and dusk chorus (sun near the horizon), a few calls through the day.
    "[CONDITION_22]",
    "NAME = BUSS_KOOKABURRA_TIME",
    "INPUT = SUN",
    "LUT = (|0=0.3|78=0.3|86=1|98=1|104=0|180=0|)",
    "LAG = 0.97",
    "",
    "[CONDITION_23]",
    "NAME = BUSS_KOOKABURRAS",
    "INPUT = 'BUSS_KOOKABURRA_TIME * (1 - RAIN)'",
    "",
    // Waves lap louder when the weather's up.
    "[CONDITION_24]",
    "NAME = BUSS_SURF",
    "INPUT = '0.7 + 0.3 * RAIN'",
    "",
  ];
  const volume: Record<SoundKind, string> = { surf: "BUSS_SURF", magpie: "BUSS_MAGPIES", kookaburra: "BUSS_KOOKABURRAS" };
  emitters.forEach((e, i) => {
    const [x, y, z] = e.at;
    lines.push(
      `[EVENT_${i}]`,
      `ID = ${SOUND_EVENTS[e.kind]}`,
      "REVERB_RESPONSE = 1",
      // AC space: x east, y up, z south.
      `POSITION = ${f(x)}, ${f(z)}, ${f(-y)}`,
      "DIRECTION = 0, 0, 1",
      `VOLUME = ${volume[e.kind]}`,
      "CAMERA_INTERIOR_MULT = 0.35",
      "CAMERA_EXTERIOR_MULT = 1",
      "CAMERA_TRACK_MULT = 1",
      "",
    );
  });
  return lines;
}

/** extension/sfx/README.txt: what the workstation must put in the placeholder bank. */
export function soundReadme(emitters: SoundEmitter[]): string {
  const count = (k: SoundKind) => emitters.filter((e) => e.kind === k).length;
  return [
    "Track sounds for Custom Shaders Patch (placeholder)",
    "",
    "ext_config.ini plays these FMOD events at positions taken from the map. Put the bank here:",
    `  extension/${SOUND_BANK}`,
    `  extension/${SOUND_GUIDS}   (FMOD Studio: File > Export GUIDs)`,
    "",
    "Build it in FMOD Studio 1.08 (the version Assetto Corsa sound mods use), bank name busselton,",
    "with these events, each a looping 3D event with distance attenuation set in the event:",
    `  ${SOUND_EVENTS.surf}        gentle bay waves lapping on sand (Geographe Bay is sheltered), max distance ~250 m (${count("surf")} emitters)`,
    `  ${SOUND_EVENTS.magpie}      Australian magpie calls with gaps between, max distance ~150 m (${count("magpie")} emitters)`,
    `  ${SOUND_EVENTS.kookaburra}  kookaburra laughs, sparse, max distance ~250 m (${count("kookaburra")} emitters)`,
    "",
    "Only CC0 recordings or your own. No copyrighted audio, nothing ripped from games or videos.",
    "Volumes follow the time of day and the rain (conditions in ext_config.ini).",
  ].join("\r\n");
}
