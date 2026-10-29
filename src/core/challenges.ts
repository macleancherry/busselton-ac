// Checkpoint challenges (Busselton fork): a short run of named places along the route for the
// Busselton Challenges Lua app (apps/lua/BusseltonChallenges) to send you round, against the clock.
// Written into each build as data/challenges.ini, so the app works on any track that has one.
//
// Checkpoints are named landmarks the route passes (attractions, parks, shops, the jetty), spread
// out along the drive; where there aren't enough, the street at an evenly spaced spot fills in
// ("Get to Queen St"). They run in the order you meet them driving the route.

import type { Vec2 } from "./geo";
import type { RoadPlan } from "./road";

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

/** data/challenges.ini: [CHECKPOINT_n] NAME and POSITION (AC world x, y, z). */
export function challengesIni(trackName: string, points: Checkpoint[]): string {
  const lines = ["[CHALLENGE]", `NAME = ${trackName}`, `COUNT = ${points.length}`, "RADIUS = 14", ""];
  points.forEach((c, k) => {
    lines.push(`[CHECKPOINT_${k}]`, `NAME = ${c.name.replace(/[\r\n=;\[\]]/g, " ")}`, `POSITION = ${c.pos.join(", ")}`, "");
  });
  return lines.join("\n");
}
