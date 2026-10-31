// The line nearest a point, within a reach, on a flat frame fixed at one latitude: what the width
// lookup (osm.ts) and the road class lookup (vectorTiles.ts) both ask. A linear scan; fine for the
// sizes a build has.

import type { LngLat } from "../core/geo";

const M_PER_DEG = 111320;

/**
 * p => the value of the line with the nearest segment within `reach` metres of p (the first found
 * on ties), else undefined. x metres = dLng * cos(lat) * 111320, y = dLat * 111320.
 */
export function nearestLine<T>(candidates: { pts: LngLat[]; value: T }[], lat: number, reach: number): (p: LngLat) => T | undefined {
  const kx = Math.cos((lat * Math.PI) / 180) * M_PER_DEG;
  return (p: LngLat): T | undefined => {
    let best = reach * reach;
    let nearest: T | undefined;
    for (const candidate of candidates) {
      const pts = candidate.pts;
      for (let i = 0; i + 1 < pts.length; i++) {
        const ax = (pts[i][0] - p[0]) * kx, ay = (pts[i][1] - p[1]) * M_PER_DEG;
        const bx = (pts[i + 1][0] - p[0]) * kx, by = (pts[i + 1][1] - p[1]) * M_PER_DEG;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
        const cx = ax + dx * t, cy = ay + dy * t;
        const d2 = cx * cx + cy * cy;
        if (d2 < best) {
          best = d2;
          nearest = candidate.value;
        }
      }
    }
    return nearest;
  };
}
