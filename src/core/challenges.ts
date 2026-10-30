// Checkpoint challenges (Busselton fork): a short run of named places along the route for the
// Busselton Challenges Lua app (apps/lua/BusseltonChallenges) to send you round, against the clock.
// Written into each build as data/challenges.ini, so the app works on any track that has one.
//
// Checkpoints are named landmarks the route passes (attractions, parks, shops, the jetty), spread
// out along the drive; where there aren't enough, the street at an evenly spaced spot fills in
// ("Get to Queen St"). They run in the order you meet them driving the route.
//
// A route can hand-pick its own instead (build.challenges, handPickedSets): one set or several,
// driven in the order given. The file also carries a point-to-point road's time trial (timeTrial.ts).

import type { LngLat, Vec2 } from "./geo";
import type { RoadPlan } from "./road";
import { timeTrialIni, type TimeTrial } from "./timeTrial";

export interface ChallengePoi {
  at: Vec2;
  cls: string;
  subclass?: string;
  name?: string;
}

export interface Checkpoint {
  name: string;
  /** Distance along the route, metres. */
  s: number;
  /** AC world position: x east, y up, z south. */
  pos: [number, number, number];
}

/** Places worth driving to, best first. */
const WORTH: Record<string, number> = {
  attraction: 5, museum: 5, park: 4, beach: 4, playground: 4, ice_cream: 4, swimming_pool: 3,
  zoo: 5, library: 3, cinema: 3, sports_centre: 3, fast_food: 2, cafe: 2, bakery: 2, school: 2,
  grocery: 1, shop: 1, fuel: 1, restaurant: 1,
};

export function challengeCheckpoints(
  plan: RoadPlan,
  nearest: (x: number, y: number, r: number) => { seg: number; dist: number } | null,
  pois: ChallengePoi[],
  routeNames: (string | undefined)[],
  want = 6,
  /** Named side streets meeting the route, by distance along it: a fill-in near one is "Corner of <name>". */
  corners: { s: number; name?: string }[] = [],
): Checkpoint[] {
  const S = plan.samples;
  const length = S[S.length - 1].s;
  if (length < 600) return [];
  const gap = Math.max(250, length / (want + 2));
  const at = (seg: number): [number, number, number] => [+S[seg].pos[0].toFixed(1), +S[seg].h.toFixed(2), +(-S[seg].pos[1]).toFixed(1)];
  // Named places within 40 m of the road, by how much fun they are to find.
  const found = pois
    .filter((p) => p.name && WORTH[p.cls] !== undefined)
    .map((p) => ({ p, n: nearest(p.at[0], p.at[1], 40) }))
    .filter((x): x is { p: ChallengePoi; n: { seg: number; dist: number } } => !!x.n)
    .sort((a, b) => WORTH[b.p.cls] - WORTH[a.p.cls] || a.n.dist - b.n.dist);
  const picked: Checkpoint[] = [];
  const clear = (s: number) => s > 150 && s < length - 100 && picked.every((c) => Math.abs(c.s - s) >= gap);
  for (const { p, n } of found) {
    if (picked.length >= want) break;
    if (picked.some((c) => c.name === p.name) || !clear(S[n.seg].s)) continue;
    picked.push({ name: p.name!, s: S[n.seg].s, pos: at(n.seg) });
  }
  // Fill with streets: each time, the spot furthest from every checkpoint so far (at least 250 m away).
  const step = Math.max(1, Math.round(25 / Math.max(0.1, S[1].s - S[0].s)));
  while (picked.length < want) {
    let bestSeg = -1, bestGap = 250;
    for (let seg = 0; seg < S.length; seg += step) {
      const s = S[seg].s;
      if (s <= 150 || s >= length - 100) continue;
      const g = Math.min(Infinity, ...picked.map((c) => Math.abs(c.s - s)), s, length - s);
      if (g > bestGap) { bestGap = g; bestSeg = seg; }
    }
    if (bestSeg < 0) break;
    // The nearest named corner not used yet (within 80 m), moving the checkpoint onto it; else the street.
    const sHere = S[bestSeg].s;
    const corner = corners
      .filter((c) => c.name && Math.abs(c.s - sHere) < 80 && !picked.some((p) => p.name === `Corner of ${c.name}`))
      .sort((a, b) => Math.abs(a.s - sHere) - Math.abs(b.s - sHere))[0];
    if (corner) {
      const seg = Math.max(0, S.findIndex((x) => x.s >= corner.s));
      picked.push({ name: `Corner of ${corner.name}`, s: S[seg].s, pos: at(seg) });
      continue;
    }
    const name = routeNames[bestSeg];
    const label = name && !picked.some((p) => p.name === `Get to ${name}`) ? `Get to ${name}` : `Checkpoint ${picked.length + 1}`;
    picked.push({ name: label, s: sHere, pos: at(bestSeg) });
  }
  return picked.sort((a, b) => a.s - b.s);
}

/** A hand-picked checkpoint in a route file: [lng, lat], or { at: [lng, lat], name }. */
export type ChallengePointOption = LngLat | { at: LngLat; name?: string };
/**
 * Route option `challenges`: one set of hand-picked checkpoints (a list of points), or several
 * named sets ([{ name, points: [...] }]). Driven in the order given.
 */
export type ChallengesOption = ChallengePointOption[] | { name?: string; points: ChallengePointOption[] }[];

export interface ChallengeSet {
  name: string;
  points: Checkpoint[];
}

const isLngLat = (v: unknown): v is LngLat =>
  Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]);

/**
 * The hand-picked checkpoint sets of a route option, in AC world coordinates. A point without a
 * name is named after the street it's on ("Get to Queen St"), else numbered. Bad points are skipped,
 * and a set left with none is dropped.
 */
export function handPickedSets(
  raw: ChallengesOption | undefined,
  toLocal: (p: LngLat) => Vec2,
  ground: (x: number, y: number) => number,
  streetAt: (x: number, y: number) => string | undefined = () => undefined,
): ChallengeSet[] {
  if (!Array.isArray(raw) || !raw.length) return [];
  const many = raw.every((e) => !!e && typeof e === "object" && !Array.isArray(e) && Array.isArray((e as { points?: unknown }).points));
  const sets = many
    ? (raw as { name?: string; points: ChallengePointOption[] }[])
    : [{ name: undefined, points: raw as ChallengePointOption[] }];
  const out: ChallengeSet[] = [];
  sets.forEach((set, n) => {
    const points: Checkpoint[] = [];
    for (const p of set.points) {
      const at = isLngLat(p) ? p : p && typeof p === "object" && isLngLat((p as { at?: unknown }).at) ? (p as { at: LngLat }).at : null;
      if (!at) continue;
      const [x, y] = toLocal(at);
      const given = !isLngLat(p) && typeof p.name === "string" && p.name.trim() ? p.name.trim() : undefined;
      const street = streetAt(x, y);
      const name = given ?? (street && !points.some((c) => c.name === `Get to ${street}`) ? `Get to ${street}` : `Checkpoint ${points.length + 1}`);
      points.push({ name, s: points.length, pos: [+x.toFixed(1), +ground(x, y).toFixed(2), +(-y).toFixed(1)] });
    }
    if (points.length) out.push({ name: set.name?.trim() || (sets.length > 1 ? `Challenge ${n + 1}` : "Hand-picked"), points });
  });
  return out;
}

/** Hand-picked sets when the route has them, else the generated checkpoints, as challengesIni's arguments. */
export function pickSets(handPicked: ChallengeSet[], generated: () => Checkpoint[]): { points: Checkpoint[]; setName: string; sets: ChallengeSet[] } {
  if (handPicked.length) return { points: handPicked[0].points, setName: handPicked[0].name, sets: handPicked.slice(1) };
  return { points: generated(), setName: "Checkpoints", sets: [] };
}

const iniText = (s: string) => s.replace(/[\r\n=;\[\]]/g, " ");

/**
 * data/challenges.ini: [CHALLENGE] NAME, COUNT, RADIUS, SET_NAME, SETS, then the first set's
 * [CHECKPOINT_n] NAME and POSITION (AC world x, y, z); further sets as [SET_k] NAME, COUNT and
 * [SET_k_CHECKPOINT_n]; and a point-to-point road's time trial ([TIME_TRIAL], timeTrial.ts).
 * The first set keeps the original layout, so an older copy of the app still reads it.
 */
export function challengesIni(
  trackName: string,
  points: Checkpoint[],
  more: { setName?: string; sets?: ChallengeSet[]; timeTrial?: TimeTrial | null } = {},
): string {
  const extra = more.sets ?? [];
  const lines = ["[CHALLENGE]", `NAME = ${iniText(trackName)}`, `COUNT = ${points.length}`, "RADIUS = 14",
    `SET_NAME = ${iniText(more.setName ?? "Checkpoints")}`, `SETS = ${1 + extra.length}`, ""];
  points.forEach((c, k) => {
    lines.push(`[CHECKPOINT_${k}]`, `NAME = ${iniText(c.name)}`, `POSITION = ${c.pos.join(", ")}`, "");
  });
  extra.forEach((set, n) => {
    const k = n + 1;
    lines.push(`[SET_${k}]`, `NAME = ${iniText(set.name)}`, `COUNT = ${set.points.length}`, "");
    set.points.forEach((c, i) => {
      lines.push(`[SET_${k}_CHECKPOINT_${i}]`, `NAME = ${iniText(c.name)}`, `POSITION = ${c.pos.join(", ")}`, "");
    });
  });
  if (more.timeTrial) lines.push(timeTrialIni(more.timeTrial));
  return lines.join("\n");
}
