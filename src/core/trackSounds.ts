// Busselton fork: track sounds placed from the map: waves along the shore, magpies in the parks and
// kookaburras in the bush. Two ways to play them in CSP:
//
// "lua" (the default): a track script, extension/sounds.lua, plays plain audio files from
// extension/sfx/ (surf.ogg, magpie.ogg, kookaburra.ogg) through ac.AudioEvent.fromFile (CSP Lua SDK
// lib_audio.lua and common/ac_audio.d.lua: a looping 3D emitter from a file with min/max distance;
// track scripts get it through inc_scene.lua). No FMOD Studio: drop three CC0 recordings in.
//
// "fmod": CSP's track audio in ext_config.ini (acc-extension-config wiki, Tracks - Audio): an FMOD
// soundbank in the track's extension folder, [SOUNDBANK_n] BANK / GUIDS pointing at it, then one
// [EVENT_n] per emitter with the event's path as GUIDs.txt lists it (FMOD Studio writes lines like
// "{guid} event:/busselton/surf"), POSITION in AC space, VOLUME and per-camera multipliers. Any
// number can be a condition instead of a constant (Tracks - Conditions: SUN, RAIN, and expressions
// over earlier conditions), which is how the birds go quiet at night and in the rain.
//
// Either way CSP ships no ambient sounds a track can use and we don't ship anyone's recordings, so
// the build carries extension/sfx/README.txt saying what to add and where to get CC0 recordings.
// A missing file plays nothing (the script logs it once).

import type { CoastPolygon } from "./coast";
import { SEA_LEVEL } from "./coast";
import type { Vec2 } from "./geo";
import soundsLuaTemplate from "./lua/sounds.lua?raw";

export type SoundKind = "surf" | "magpie" | "kookaburra";
export type SoundMode = "lua" | "fmod";

/** The build option to a mode: true (or "lua") is the Lua script, "fmod" the soundbank, off is undefined. */
export function soundMode(option: boolean | SoundMode | undefined): SoundMode | undefined {
  if (option === "fmod") return "fmod";
  return option ? "lua" : undefined;
}

/** The track script (under extension/) and the files it plays (under extension/; .ogg, .wav or .mp3). */
export const SOUND_SCRIPT = "sounds.lua";
export const SOUND_FILES: Record<SoundKind, string> = {
  surf: "sfx/surf.ogg",
  magpie: "sfx/magpie.ogg",
  kookaburra: "sfx/kookaburra.ogg",
};

/** A Freesound search filtered to CC0 (Creative Commons 0). Links only: nothing is downloaded. */
export function freesoundCc0(query: string): string {
  return `https://freesound.org/search/?q=${encodeURIComponent(query).replace(/%20/g, "+")}&f=license:%22Creative+Commons+0%22`;
}

/** What each file should be, and where to look for CC0 recordings of it. */
export const SOUND_SOURCES: Record<SoundKind, { what: string; links: string[] }> = {
  surf: {
    what: "gentle waves lapping on sand (Geographe Bay is sheltered: no big surf), seamless loop 30-60 s",
    links: [freesoundCc0("waves lapping beach"), freesoundCc0("gentle surf"), freesoundCc0("surf")],
  },
  magpie: {
    what: "Australian magpie calls and warbling with gaps between, loop 20-60 s",
    links: [freesoundCc0("australian magpie"), freesoundCc0("magpie")],
  },
  kookaburra: {
    what: "laughing kookaburra, sparse (mostly quiet, a laugh or two), loop 30-90 s",
    links: [freesoundCc0("kookaburra"), freesoundCc0("laughing kookaburra")],
  },
};

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

/** extension/sounds.lua: the track script with the emitters filled in (AC space: x east, y up, z south). */
export function soundLua(emitters: SoundEmitter[]): string {
  const rows = emitters.map((e) => `{ '${e.kind}', ${f(e.at[0])}, ${f(e.at[2])}, ${f(-e.at[1])} }`);
  return soundsLuaTemplate.replace("__EMITTERS__", rows.length ? `\n  ${rows.join(",\n  ")},\n` : "");
}

/** The ext_config section that loads the track script. */
export function soundScriptConfig(index: number): string[] {
  return [
    "; Track sounds (trackSounds.ts): plays extension/sfx/*.ogg, see extension/sfx/README.txt.",
    `[SCRIPT_${index}]`,
    `SCRIPT = ${SOUND_SCRIPT}`,
    "",
  ];
}

/** extension/sfx/README.txt: what to put in extension/sfx (the audio files, or the FMOD bank). */
export function soundReadme(emitters: SoundEmitter[], mode: SoundMode = "lua"): string {
  return mode === "fmod" ? fmodReadme(emitters) : luaReadme(emitters);
}

function luaReadme(emitters: SoundEmitter[]): string {
  const count = (k: SoundKind) => emitters.filter((e) => e.kind === k).length;
  const kinds: SoundKind[] = ["surf", "magpie", "kookaburra"];
  return [
    "Track sounds for Custom Shaders Patch",
    "",
    `extension/${SOUND_SCRIPT} (a CSP track script) plays these files as looping 3D sounds at places`,
    "taken from the map. Put them in this folder (extension/sfx). Each can be .ogg (best), .wav or",
    ".mp3 with the same name; a file that isn't here just stays quiet. No FMOD Studio needed.",
    "",
    ...kinds.flatMap((k) => [
      `  ${SOUND_FILES[k].replace("sfx/", "")}: ${SOUND_SOURCES[k].what} (${count(k)} emitters)`,
      ...SOUND_SOURCES[k].links.map((l) => `      ${l}`),
    ]),
    "",
    "The links are Freesound searches filtered to CC0 (Creative Commons 0, public domain). Check that",
    "each sound's own page says CC0 before using it. Only CC0 recordings or your own: no copyrighted",
    "audio, nothing ripped from games or videos.",
    "",
    "Prepare them in Audacity: mono, 44.1 or 48 kHz, trimmed to a clean loop (crossfade the ends), no",
    "traffic or voices in the background, normalised to about -3 dB, exported as Ogg Vorbis.",
    "",
    "In game the birds sing in daylight (kookaburras loudest at dawn and dusk) and go quiet in the",
    "rain; the waves get louder with the weather. The CSP log says which file each kind loaded",
    "(lines starting \"Busselton sounds:\").",
    "",
    "Alternative: \"trackSounds\": \"fmod\" in the route's options plays the same emitters from an FMOD",
    "bank (extension/sfx/busselton.bank) instead; that build's README explains it.",
  ].join("\r\n");
}

/** The FMOD path's README: what the workstation must put in the placeholder bank. */
function fmodReadme(emitters: SoundEmitter[]): string {
  const count = (k: SoundKind) => emitters.filter((e) => e.kind === k).length;
  return [
    "Track sounds for Custom Shaders Patch (FMOD bank, placeholder)",
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
    "",
    "Simpler: \"trackSounds\": true plays plain .ogg files from this folder through a Lua track script",
    "instead, no bank needed.",
  ].join("\r\n");
}
