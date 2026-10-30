// Point-to-point time trials (Busselton fork): A to B against the clock, with sector splits, for the
// Busselton Challenges app (apps/lua/BusseltonChallenges). Written into the layout's
// data/challenges.ini as [TIME_TRIAL], [TT_START], [TT_SPLIT_n] and [TT_FINISH].
//
// The start and finish gates are AC's own AB timing lines (the AC_AB_START / AC_AB_FINISH dummies
// trackObjects places), so the app's time and the game's agree on where the run begins and ends.
// The splits share the timed road between them evenly. Each gate is a line across the road: the app
// counts it when the car crosses it going forward.

import type { Kn5GroupNode } from "./kn5";
import type { RoadPlan } from "./road";

/** A timing line across the road, AC world coordinates (x east, y up, z south). */
export interface Gate {
  name: string;
  /** Middle of the line. */
  pos: [number, number, number];
  /** Which way counts as crossing it: unit vector along the road, [x, z]. */
  dir: [number, number];
  /** Length of the line, metres. */
  width: number;
}

export interface TimeTrial {
  name: string;
  start: Gate;
  splits: Gate[];
  finish: Gate;
  /** Timed length, metres. */
  length: number;
}

const r1 = (v: number) => +v.toFixed(1);
const r2 = (v: number) => +v.toFixed(2);
const r3 = (v: number) => +v.toFixed(3);

/** The gate between a pair of dummies named `<base>_L` and `<base>_R`, or null. */
function dummyGate(dummies: Kn5GroupNode[], base: string, name: string): Gate | null {
  const L = dummies.find((d) => d.name === `${base}_L`), R = dummies.find((d) => d.name === `${base}_R`);
  if (!L || !R) return null;
  const a = L.transform, b = R.transform;
  const fx = a[8] + b[8], fz = a[10] + b[10], fl = Math.hypot(fx, fz) || 1;
  return {
    name,
    pos: [r1((a[12] + b[12]) / 2), r2((a[13] + b[13]) / 2), r1((a[14] + b[14]) / 2)],
    dir: [r3(fx / fl), r3(fz / fl)],
    width: r1(Math.hypot(a[12] - b[12], a[14] - b[14])),
  };
}

/** Index of the plan sample nearest an AC world position. */
function nearestSample(plan: RoadPlan, x: number, z: number): number {
  let best = 0, bd = Infinity;
  plan.samples.forEach((s, i) => {
    const d = (s.pos[0] - x) ** 2 + (s.pos[1] + z) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

/**
 * The time trial of a point-to-point road: start and finish from the layout's AB dummies, and
 * `sectors - 1` splits evenly between them (none when the timed road is under 600 m). Null on a loop
 * (AC times laps itself) or without AB dummies.
 */
export function timeTrial(
  plan: RoadPlan,
  dummies: Kn5GroupNode[],
  routeNames: (string | undefined)[] = [],
  opts: { name?: string; sectors?: number } = {},
): TimeTrial | null {
  if (plan.closed) return null;
  const start = dummyGate(dummies, "AC_AB_START", "Start");
  const finish = dummyGate(dummies, "AC_AB_FINISH", "Finish");
  if (!start || !finish) return null;
  const S = plan.samples;
  const i0 = nearestSample(plan, start.pos[0], start.pos[2]);
  const i1 = nearestSample(plan, finish.pos[0], finish.pos[2]);
  const s0 = S[i0].s, s1 = S[i1].s;
  const length = s1 - s0;
  if (length <= 0) return null;
  const sectors = Math.max(1, Math.min(8, Math.round(opts.sectors ?? 3)));
  const splits: Gate[] = [];
  if (length >= 600) {
    for (let k = 1; k < sectors; k++) {
      const target = s0 + (length * k) / sectors;
      let i = i0;
      while (i < i1 && S[i].s < target) i++;
      const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)];
      const dx = b.pos[0] - a.pos[0], dy = b.pos[1] - a.pos[1], dl = Math.hypot(dx, dy) || 1;
      const street = routeNames[i];
      splits.push({
        name: street ? `Split ${k} (${street})` : `Split ${k}`,
        pos: [r1(S[i].pos[0]), r2(S[i].h), r1(-S[i].pos[1])],
        dir: [r3(dx / dl), r3(-dy / dl)],
        width: r1((S[i].width ?? 7) + 2),
      });
    }
  }
  return { name: opts.name ?? "A to B", start, splits, finish, length: Math.round(length) };
}

const clean = (s: string) => s.replace(/[\r\n=;\[\]]/g, " ");

/** The [TIME_TRIAL] part of data/challenges.ini. */
export function timeTrialIni(tt: TimeTrial): string {
  const gate = (section: string, g: Gate) =>
    [`[${section}]`, `NAME = ${clean(g.name)}`, `POSITION = ${g.pos.join(", ")}`, `DIRECTION = ${g.dir.join(", ")}`, `WIDTH = ${g.width}`, ""];
  return [
    "[TIME_TRIAL]", `NAME = ${clean(tt.name)}`, `LENGTH = ${tt.length}`, `SPLITS = ${tt.splits.length}`, "",
    ...gate("TT_START", tt.start),
    ...tt.splits.flatMap((g, k) => gate(`TT_SPLIT_${k}`, g)),
    ...gate("TT_FINISH", tt.finish),
  ].join("\n");
}
