// Splitting wide meshes into area tiles and giving small detail a draw distance, so AC can skip
// what's off screen or far away. Written from docs/specs/cull.md.
//
// Positions are AC world coordinates (x east, y up, z south); tiles are in x and z. Group
// transforms in generated trees are identity and are ignored here: with a non-identity
// transform, tiling would be in the mesh's local frame.

import type { Kn5GroupNode, Kn5MeshNode, Kn5Node } from "./kn5";

/** Default tile size in metres. */
export const CELL = 120;
/** Below this many triangles a mesh isn't worth extra draw calls. */
const MIN_TRIANGLES = 1500;
/** Tiles with fewer triangles merge into the nearest big tile (CSP can't size tiny meshes). */
const SMALL = 8;

/** Name prefix -> draw distance in metres; first match wins. */
const DRAW_DISTANCES: Array<[string, number]> = [
  ["MARKINGS", 450],
  ["RRPM", 450],
  ["FURNITURE", 600],
  ["GUIDEPOSTS", 500],
  ["RAILPOSTS", 500],
  ["ARMCOPOSTS", 400],
  ["ARMCO_", 1200],
  ["WIRES", 350],
];

/** Half the diagonal of the mesh's 3-D bounding box (all vertices); 0 when empty. */
export function spread(mesh: Kn5MeshNode): number {
  const p = mesh.positions;
  if (p.length < 3) return 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < p.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const v = p[i + c];
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }
  return 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

type Tile = { ix: number; iz: number; tris: number[] };

/** Splits a wide mesh into square tiles by triangle centroid (x, z); returns [mesh] when not worth it. */
export function splitByArea(mesh: Kn5MeshNode, cell = CELL): Kn5MeshNode[] {
  const idx = mesh.indices;
  const triCount = Math.floor(idx.length / 3);
  if (triCount < MIN_TRIANGLES || spread(mesh) <= 2 * cell) return [mesh];
  const pos = mesh.positions;

  const tiles: Tile[] = [];
  const byKey = new Map<string, Tile>();
  for (let t = 0; t < triCount; t++) {
    let cx = 0, cz = 0;
    for (let c = 0; c < 3; c++) {
      const v = idx[t * 3 + c];
      cx += pos[v * 3];
      cz += pos[v * 3 + 2];
    }
    const ix = Math.floor(cx / 3 / cell), iz = Math.floor(cz / 3 / cell);
    const key = `${ix},${iz}`;
    let tile = byKey.get(key);
    if (!tile) {
      tile = { ix, iz, tris: [] };
      byKey.set(key, tile);
      tiles.push(tile);
    }
    tile.tris.push(t);
  }

  const big = tiles.filter((t) => t.tris.length >= SMALL);
  // Merging never promotes a small tile, so the big tiles are the tiles left after merging.
  if (big.length < 2) return [mesh];
  for (const small of tiles) {
    if (small.tris.length >= SMALL) continue;
    let best = big[0], bestDist = Infinity;
    for (const b of big) {
      const d = Math.hypot(b.ix - small.ix, b.iz - small.iz);
      if (d < bestDist) { bestDist = d; best = b; }
    }
    best.tris.push(...small.tris);
  }

  return big.map((tile, k) => buildTile(mesh, tile.tris, k));
}

function buildTile(mesh: Kn5MeshNode, tris: number[], k: number): Kn5MeshNode {
  const idx = mesh.indices;
  const newIndex = new Map<number, number>();
  const used: number[] = [];
  const indices = new Uint16Array(3 * tris.length);
  tris.forEach((t, i) => {
    for (let c = 0; c < 3; c++) {
      const v = idx[t * 3 + c];
      let nv = newIndex.get(v);
      if (nv === undefined) {
        nv = used.length;
        newIndex.set(v, nv);
        used.push(v);
      }
      indices[i * 3 + c] = nv;
    }
  });
  const pick = (src: Float32Array, size: number): Float32Array => {
    const out = new Float32Array(used.length * size);
    used.forEach((v, i) => out.set(src.subarray(v * size, v * size + size), i * size));
    return out;
  };
  const tile: Kn5MeshNode = {
    ...mesh,
    name: `${mesh.name}_T${k}`,
    positions: pick(mesh.positions, 3),
    normals: pick(mesh.normals, 3),
    uvs: pick(mesh.uvs, 2),
    indices,
  };
  if (mesh.tangents) tile.tangents = pick(mesh.tangents, 3);
  else delete tile.tangents;
  return tile;
}

/** Draw distance in metres for a mesh name (by prefix, case-sensitive), or undefined (always drawn). */
export function drawDistance(meshName: string): number | undefined {
  return DRAW_DISTANCES.find(([prefix]) => meshName.startsWith(prefix))?.[1];
}

/** Splits wide meshes and sets draw distances through a node list, keeping order. */
export function cullable(list: Kn5Node[], cell = CELL): Kn5Node[] {
  const out: Kn5Node[] = [];
  for (const item of list) {
    if (item.kind === "node") {
      const group: Kn5GroupNode = { ...item, children: cullable(item.children, cell) };
      out.push(group);
      continue;
    }
    if (item.renderable === false) {
      out.push(item);
      continue;
    }
    for (const piece of splitByArea(item, cell)) {
      const d = drawDistance(piece.name);
      if (d && !piece.lodOut && spread(piece) < d / 4) out.push({ ...piece, lodOut: d });
      else out.push(piece);
    }
  }
  return out;
}
