// Busselton fork: where the automatic test (autotest.lua) takes an extra screenshot, so every run
// photographs the landmarks it drives past: 30 m before the AI line's closest point to each one
// (the chase camera looks ahead), when that's within 70 m of it.

import type { AiPoint } from "./aiSpline";

export interface Landmark {
  name: string;
  /** Local metres (x east, y north). */
  at: [number, number];
}

/** "fraction:name" entries for autotest.ini's SHOTS (fractions of the lap, 0..1). */
export function landmarkShots(ai: AiPoint[], landmarks: Landmark[], before = 30, reach = 70): string[] {
  if (ai.length < 2) return [];
  const total = ai[ai.length - 1].distance + ai[ai.length - 1].length;
  const out: string[] = [];
  for (const lm of landmarks) {
    // AI positions are AC space: x east, z south.
    let best = -1, bd = Infinity;
    ai.forEach((p, i) => {
      const d = Math.hypot(p.position[0] - lm.at[0], -p.position[2] - lm.at[1]);
      if (d < bd) [bd, best] = [d, i];
    });
    if (best < 0 || bd > reach) continue;
    let d = ai[best].distance - before;
    if (d < 0) d += total;
    const name = lm.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase() || "landmark";
    out.push(`${(d / total).toFixed(4)}:${name}`);
  }
  return out;
}
