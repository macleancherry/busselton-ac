// Busselton fork: cruise mode in the Busselton Challenges app (apps/lua/BusseltonChallenges): no
// clock, just the street you're on, the next sight ahead, a speed-limit reminder and a tick list of
// the sights you've seen. Two files:
//
//   extension/cruise.ini   the whole world, shared by every layout:
//                          [CRUISE] LANDMARKS, STREETS
//                          [LANDMARK_n] NAME, POSITION = x, z (AC world coordinates)
//                          [STREET_n] NAME, LIMIT (km/h, when known), POINTS = x,z,x,z,...
//   data/cruise.ini        the layout's own (asLayout moves data/ per layout):
//                          [CRUISE] NAME, CLOSED, LENGTH (m), SIGHTS, LIMITS (km/h at each 1% of the
//                          AI line, when it has one)
//                          [SIGHT_n] NAME, POSITION = x, z, AT (fraction of the lap where the AI line
//                          passes closest, -1 in free roam), RADIUS (m: pass this close to tick it)
//
// Sights are the landmarks a layout passes, in the order it passes them. A landmark counts when the
// AI line comes within `reach` of it; you tick it by driving within RADIUS of it: 40 m, or a little
// more than the line's closest approach for a big building set back from the road.

import type { AiPoint } from "./aiSpline";
import type { Vec2 } from "./geo";
import type { Landmark } from "./landmarkShots";
import { simplify } from "./polyline";

export const SIGHT_RADIUS = 40;
const SIGHT_REACH = 70;

export interface CruiseStreet {
  name: string;
  /** Local metres (x east, y north). */
  pts: Vec2[];
  limit?: number;
}

export interface CruiseSight {
  name: string;
  at: Vec2;
  /** Fraction of the lap where the AI line passes closest; -1 when there's no line (free roam). */
  frac: number;
  radius: number;
}

/** Ini values are one line; keep names to plain text. */
function clean(name: string): string {
  return name.replace(/[\r\n=\[\]]+/g, " ").replace(/\s+/g, " ").trim();
}

const ac = ([x, y]: Vec2): string => `${x.toFixed(1)}, ${(-y).toFixed(1)}`;

const AISLE = /^(parking_aisle|driveway|drive-through)$/;
const FAST = /^(motorway|trunk)/;

/**
 * The named streets for the "you're on" line: the route split into runs of one name and one limit,
 * plus the side streets (not car park aisles or driveways), simplified to `tolerance` metres.
 */
export function cruiseStreets(
  route: { pts: Vec2[]; names: (string | undefined)[]; limits?: number[]; closed?: boolean },
  streets: { pts: Vec2[]; name?: string; service?: string; cls?: string }[],
  sideLimit?: number,
  tolerance = 2,
): CruiseStreet[] {
  const out: CruiseStreet[] = [];
  let run: number[] = [];
  const flush = () => {
    const i0 = run[0];
    const name = i0 !== undefined ? route.names[i0] : undefined;
    if (name && run.length >= 2) {
      out.push({ name: clean(name), pts: simplify(run.map((i) => route.pts[i]), tolerance), ...(route.limits ? { limit: route.limits[run[1]] } : {}) });
    }
  };
  const n = route.pts.length;
  for (let i = 0; i < n; i++) {
    const prev = run[run.length - 1];
    if (prev !== undefined && (route.names[i] !== route.names[prev] || route.limits?.[i] !== route.limits?.[prev])) {
      flush();
      // Where only the limit changes the two runs share a point, so the street has no gap.
      run = route.names[i] === route.names[prev] ? [prev] : [];
    }
    run.push(i);
  }
  // A loop closes where it started, when the name carries on.
  if (route.closed && n > 1 && route.names[0] === route.names[n - 1]) run.push(0);
  flush();
  for (const st of streets) {
    if (!st.name || (st.service && AISLE.test(st.service)) || st.pts.length < 2) continue;
    const limit = st.cls && FAST.test(st.cls) ? undefined : sideLimit;
    out.push({ name: clean(st.name), pts: simplify(st.pts, tolerance), ...(limit ? { limit } : {}) });
  }
  return out;
}

/**
 * The layout's sights: the landmarks its AI line passes within `reach`, in the order it passes
 * them. With no line (free roam) every landmark is a sight, nearest the middle first.
 */
export function cruiseSights(ai: AiPoint[], landmarks: Landmark[], reach = SIGHT_REACH): CruiseSight[] {
  const named = landmarks.filter((l) => clean(l.name));
  if (ai.length < 2) {
    return named.map((l) => ({ name: clean(l.name), at: l.at, frac: -1, radius: SIGHT_RADIUS }))
      .sort((a, b) => Math.hypot(...a.at) - Math.hypot(...b.at));
  }
  const total = ai[ai.length - 1].distance + ai[ai.length - 1].length || 1;
  const out: CruiseSight[] = [];
  const seen = new Set<string>();
  for (const lm of named) {
    // AI positions are AC space: x east, z south.
    let best = -1, bd = Infinity;
    ai.forEach((p, i) => {
      const d = Math.hypot(p.position[0] - lm.at[0], -p.position[2] - lm.at[1]);
      if (d < bd) [bd, best] = [d, i];
    });
    const name = clean(lm.name);
    // A landmark listed twice (a source landmark and its spec look) is one sight.
    if (best < 0 || bd > reach || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, at: lm.at, frac: ai[best].distance / total, radius: Math.max(SIGHT_RADIUS, Math.ceil(bd + 10)) });
  }
  return out.sort((a, b) => a.frac - b.frac);
}

/** extension/cruise.ini, or null when the build has no landmarks and no street names. */
export function cruiseWorldIni(landmarks: Landmark[], streets: CruiseStreet[]): string | null {
  const names = new Set<string>();
  const lms = landmarks.filter((l) => {
    const n = clean(l.name);
    if (!n || names.has(n)) return false;
    names.add(n);
    return true;
  });
  const sts = streets.filter((s) => s.name && s.pts.length >= 2);
  if (!lms.length && !sts.length) return null;
  const lines = ["[CRUISE]", `LANDMARKS=${lms.length}`, `STREETS=${sts.length}`, ""];
  lms.forEach((l, k) => lines.push(`[LANDMARK_${k}]`, `NAME=${clean(l.name)}`, `POSITION=${ac(l.at)}`, ""));
  sts.forEach((s, k) => {
    lines.push(`[STREET_${k}]`, `NAME=${s.name}`);
    if (s.limit) lines.push(`LIMIT=${Math.round(s.limit)}`);
    lines.push(`POINTS=${s.pts.map((p) => `${Math.round(p[0])},${Math.round(-p[1])}`).join(",")}`, "");
  });
  return lines.join("\n");
}

/** data/cruise.ini for a layout. */
export function cruiseLayoutIni(name: string, o: { closed: boolean; length: number; sights: CruiseSight[]; limits?: number[] }): string {
  const lines = ["[CRUISE]", `NAME=${clean(name)}`, `CLOSED=${o.closed ? 1 : 0}`, `LENGTH=${Math.round(o.length)}`, `SIGHTS=${o.sights.length}`];
  if (o.limits?.length) lines.push(`LIMITS=${o.limits.map((v) => Math.round(v)).join(",")}`);
  lines.push("");
  o.sights.forEach((s, k) => lines.push(`[SIGHT_${k}]`, `NAME=${s.name}`, `POSITION=${ac(s.at)}`, `AT=${s.frac < 0 ? -1 : s.frac.toFixed(4)}`, `RADIUS=${s.radius}`, ""));
  return lines.join("\n");
}

/** The limit at each 1% of the AI line, from a limit-by-distance function (the AI hints' limits). */
export function limitsByPercent(ai: AiPoint[], limitAt: (distance: number) => number | undefined, fallback = 50): number[] {
  if (ai.length < 2) return [];
  const total = ai[ai.length - 1].distance + ai[ai.length - 1].length;
  return Array.from({ length: 100 }, (_, k) => Math.round(limitAt(((k + 0.5) / 100) * total) ?? fallback));
}

const enc = new TextEncoder();

/**
 * Both cruise files for a build (data/ before asLayout moves it), or none when the build has no
 * landmarks and no street names.
 */
export function cruiseFiles(slug: string, name: string, o: {
  ai: AiPoint[];
  closed: boolean;
  landmarks: Landmark[];
  route: { pts: Vec2[]; names: (string | undefined)[]; limits?: number[] };
  streets: { pts: Vec2[]; name?: string; service?: string; cls?: string }[];
  /** The side streets' limit (km/h) where it's known: 50 in a built-up area. */
  sideLimit?: number;
  /** The AI hints' limit by distance along the AI line, km/h. */
  limitAt?: (distance: number) => number | undefined;
}): Record<string, Uint8Array> {
  const world = cruiseWorldIni(o.landmarks, cruiseStreets({ ...o.route, closed: o.closed }, o.streets, o.sideLimit));
  if (!world) return {};
  const last = o.ai[o.ai.length - 1];
  const layout = cruiseLayoutIni(name, {
    closed: o.closed, length: last ? last.distance + last.length : 0,
    sights: cruiseSights(o.ai, o.landmarks), limits: o.limitAt ? limitsByPercent(o.ai, o.limitAt) : undefined,
  });
  return { [`${slug}/extension/cruise.ini`]: enc.encode(world), [`${slug}/data/cruise.ini`]: enc.encode(layout) };
}
