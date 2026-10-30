// Busselton fork: the ground paths are laid on, read off the built ground meshes themselves.
//
// Paths used to sit on the terrain function (the higher of a grid cell's two diagonals), but the
// terrain mesh isn't that function: it is cut 4 cm under every street within a grid step of it,
// and nature strips, verges and photo footpaths sit on top of it. Where those differ the red
// shared path floated (30-55 cm beside the foreshore streets) or sank. This reads the highest
// ground mesh at a point, so a path lies on whatever is actually drawn there.

import type { Kn5Node } from "./kn5";
import type { Vec2 } from "./geo";

/** Ground meshes a path can lie on: terrain, verges, strips and islands, and the photo's concrete. */
export const PATH_GROUND = /^1(GRASS|STREET_PATH|STREET_DRIVE)/;

const CELL = 4;

/**
 * Height of the highest of `nodes`' meshes named like `names` at a local point (x east, y
 * north), or null off them. Only triangles within `reach` metres of `lines` are indexed, so it
 * stays small on a big map.
 */
export function groundMeshHeight(
  nodes: Kn5Node[],
  lines: Vec2[][],
  reach = 4,
  names: RegExp = PATH_GROUND,
): (x: number, y: number) => number | null {
  // Cells near the paths (AC x, z = -y).
  const want = new Set<string>();
  const r = Math.ceil(reach / CELL);
  for (const l of lines) {
    for (let i = 0; i < l.length; i++) {
      const a = l[i], b = l[Math.min(l.length - 1, i + 1)];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL / 2)));
      for (let k = 0; k <= n; k++) {
        const cx = Math.floor((a[0] + ((b[0] - a[0]) * k) / n) / CELL), cz = Math.floor(-(a[1] + ((b[1] - a[1]) * k) / n) / CELL);
        for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) want.add(`${cx + di},${cz + dj}`);
      }
    }
  }
  const tris: number[] = []; // per triangle: x, z, height for each corner
  const grid = new Map<string, number[]>();
  const walk = (n: Kn5Node) => {
    if (n.kind === "node") return n.children.forEach(walk);
    if (!names.test(n.name)) return;
    const p = n.positions, ix = n.indices;
    for (let i = 0; i < ix.length; i += 3) {
      const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
      const x0 = Math.floor(Math.min(p[a], p[b], p[c]) / CELL), x1 = Math.floor(Math.max(p[a], p[b], p[c]) / CELL);
      const z0 = Math.floor(Math.min(p[a + 2], p[b + 2], p[c + 2]) / CELL), z1 = Math.floor(Math.max(p[a + 2], p[b + 2], p[c + 2]) / CELL);
      let t = -1;
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const key = `${cx},${cz}`;
          if (!want.has(key)) continue;
          if (t < 0) {
            t = tris.length / 9;
            for (const v of [a, b, c]) tris.push(p[v], p[v + 2], p[v + 1]);
          }
          const list = grid.get(key);
          if (list) list.push(t); else grid.set(key, [t]);
        }
      }
    }
  };
  nodes.forEach(walk);
  return (x, y) => {
    const z = -y;
    let best: number | null = null;
    for (const t of grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
      const o = t * 9;
      const ax = tris[o], az = tris[o + 1], bx = tris[o + 3], bz = tris[o + 4], cx = tris[o + 6], cz = tris[o + 7];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const h = u * tris[o + 2] + v * tris[o + 5] + w * tris[o + 8];
      if (best === null || h > best) best = h;
    }
    return best;
  };
}
