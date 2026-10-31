# Spec: splitting wide meshes and draw distances (`src/core/cull.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). `cull.ts` and `test/cull.test.ts` are on `UPSTREAM-FILES.txt`. Write the new module from this page without the old file open; tests are written fresh from the "Tests to write" list.

## What the module is for

Keeping the frame rate steady. AC skips drawing a mesh whose bounding sphere is off screen and, when the mesh has `lodOut` set, one whose centre is further away than that, but only whole meshes. A batch of posts or signs strung along the whole road is drawn in full from anywhere on it. So meshes that spread wide are split into square tiles by area, and small detail is given a draw distance.

## Conventions

- Works on kn5 node trees (`Kn5Node = Kn5MeshNode | Kn5GroupNode` from `src/core/kn5.ts`). Mesh positions are in **AC coordinates: x east, y up, z south** (three floats per vertex), in world space: group transforms in the generated tree are identity, and this module ignores them.
- Tiles are in the horizontal plane: **x (index 0) and z (index 2)**; height (index 1) is ignored for tiling but counts in `spread`.
- Physics meshes are named with a leading digit (`1ROAD_…`, `1KERB_…`, `1WALL_…`); the surface key is matched by prefix, so names must keep their original prefix after splitting.

## Public API (keep these names and shapes)

- `CELL = 120`: default tile size in metres (exported; only this module and its tests use it; the many other `CELL` constants in the repo are unrelated locals).
- `spread(node: Kn5MeshNode): number`.
- `splitByArea(node: Kn5MeshNode, cell = CELL): Kn5MeshNode[]`.
- `drawDistance(name: string): number | undefined`.
- `cullable(nodes: Kn5Node[], cell = CELL): Kn5Node[]`.

Private constants: `MIN_TRIS = 1500`, `SMALL = 8`, and the draw distance table (rule 9).

## Rules

### spread

1. Half the length of the diagonal of the axis-aligned 3-D bounding box of all vertex positions (every vertex in the array, referenced by an index or not): ½·√(Δx² + Δy² + Δz²). An empty positions array gives 0.

### splitByArea

2. Return `[node]` (the same object, unchanged) if the mesh has fewer than **1500** triangles (indices.length / 3), or if `spread(node) ≤ 2·cell`. A few hundred triangles cost less to draw than the extra draw calls.
3. Assign each triangle (in index order) to a tile by its centroid: key (⌊cx / cell⌋, ⌊cz / cell⌋), where cx, cz are the means of its three vertices' x and z. Tiles are kept in order of first appearance.
4. **Small tiles merge.** A tile with fewer than **8** triangles is merged into the nearest "big" tile (8 or more), nearest by Euclidean distance between tile index pairs; ties go to the big tile that appeared first. The set of big tiles is decided before any merging (merging doesn't promote anything). Merged triangles are appended to the big tile's list in the order the small tiles appear. Reason: CSP can't size a one-triangle mesh ("Failed to calculate BS for vertices: 3"), and a handful of triangles isn't worth a draw call.
5. If there are no big tiles, or fewer than 2 tiles remain after merging, return `[node]`.
6. Otherwise one output mesh per tile, in tile order, k = 0, 1, …:
   - every property of the original node copied (material, flags such as `castShadows`, `transparent`, `layer`, `lodIn`, `lodOut`, `renderable`, …),
   - name `<original name>_T<k>`,
   - only the vertices the tile's triangles use, renumbered in order of first use (walking the tile's triangles, then their three corners in order); positions, normals, uvs and (if present) tangents copied for those vertices; if the original has no tangents the tile has none,
   - indices as a `Uint16Array`, triangle order and winding preserved.
   Every input triangle appears in exactly one output tile. Vertices shared by triangles in different tiles are duplicated.
7. Deterministic: the same input always gives the same tiles, names and vertex order.
8. Input is not mutated.

### drawDistance

9. The first entry whose pattern matches the **start** of the name (case-sensitive) gives the distance in metres; no match gives `undefined` (always drawn):

   | Name starts with | Draw distance (m) | Note |
   | --- | --- | --- |
   | `MARKINGS` or `RRPM` | 450 | |
   | `FURNITURE` | 600 | |
   | `GUIDEPOSTS` or `RAILPOSTS` | 500 | |
   | `ARMCOPOSTS` | 400 | Busselton fork: Armco posts and blockouts |
   | `ARMCO_` | 1200 | the beam itself |
   | `WIRES` | 350 | a few cm thick: only shimmers further off |

   Physics meshes start with a digit and never match. Split tiles (`…_T3`) match by the same prefix.

### cullable

10. Walk the list; output order follows input order, with each split mesh's tiles in place of it.
11. Group node: a copy of it (name and transform kept) with `children` replaced by `cullable(children, cell)`.
12. Mesh with `renderable === false` (invisible walls, never drawn): passed through as is, not split and no draw distance.
13. Any other mesh (physics meshes included: a wide `1ROAD_…` mesh is split too, keeping its prefix): `splitByArea(mesh, cell)`, then for each resulting piece, with d = `drawDistance(piece.name)`: if d is defined and non-zero, the piece has no `lodOut` already (undefined or 0), and `spread(piece) < d / 4`, return a copy with `lodOut = d`; otherwise return the piece unchanged. The quarter rule exists because AC measures the draw distance to the mesh's centre: a long mesh would vanish while the car is still on it.
14. Input not mutated; unchanged meshes may be returned as the same objects.

## Callers (from `grep`, 31 Oct 2026)

- `src/core/track.ts`: `cullable` over the main scene groups (ROAD, SIDESTREETS, JUNCTIONS, FURNITURE, RACE, WIRES, ROUNDABOUTS, MARKINGS, VERGE, KERBS, TREES, RAILS and the rest of that list) and over the `PARKED_CARS` group (its `1WALL` meshes are kept out in their own group).
- `test/cull.test.ts`: `cullable`, `splitByArea`, `spread`. `test/streetDrape.test.ts`: `splitByArea` (small tiles merge; every tile has at least 8 triangles; triangle count kept).
- `drawDistance` and `CELL`: no external importer (may become private).
- Related: `src/core/utilities.ts` names wire meshes `WIRES_NNN` relying on the 350 m rule; `docs/specs/utilities.md` says so. The kn5 writer writes `lodOut` (0 = always) and computes each mesh's bounding sphere from its positions.

## Known oddities (decide, don't copy blindly)

1. A small tile merged into a far-away big tile (rule 4, nearest may still be distant) makes that tile's spread larger, which can cost it a draw distance. Rare; acceptable.
2. `spread` counts unreferenced vertices. Generated meshes have none; fine.
3. Group transforms are assumed identity. If a non-identity transform ever appears, tiling is in the mesh's local frame. Add a comment, no code.
4. A mesh with more than 65535 vertices can't exist (Uint16 indices), so tiles can't overflow either.

## Tests to write

1. A row of 1000 small quads 2 m apart along x (2 km, 2000 triangles) named `FURNITURE_STEEL_000`: splits into more than 10 tiles; triangle total unchanged; each tile's spread under 120 m; names `FURNITURE_STEEL_000_T<k>`; each tile's highest index is its vertex count − 1 (own vertices only).
2. A compact mesh (5 quads 20 m apart) and a sparse long one (100 quads 20 m apart: 2 km but 200 triangles) come back as the same object.
3. Tiling uses x and z, not y: a tall thin mesh (spread in y only) isn't split by area; a mesh spread along z is.
4. Small tiles: a long mesh plus a lone triangle far off merges the triangle into its nearest big tile; every tile has at least 8 triangles; triangle count kept.
5. Tangents copied when present, absent when absent; normals and uvs follow their vertices; winding preserved (check one triangle's corner positions).
6. `drawDistance`: each table row, `ARMCOPOSTS_1` gives 400 not 1200, `ARMCO_BEAM` gives 1200, `1KERB_000` and `TREES_0` give undefined, matching is case-sensitive.
7. `cullable`: inside a group, `MARKINGS_000` (compact) gets lodOut 450; `1KERB_000` gets none; a `renderable: false` `1WALL_…` mesh of 4000 triangles over 4 km stays one mesh; a long `MARKINGS` mesh that splits into tiles under 112.5 m spread gets 450 on each tile, while one that can't split (under 1500 triangles, 2 km long) gets none; a mesh that already has `lodOut` keeps its own value.
8. Output order: meshes and groups stay in input order; tiles replace their mesh in place.
9. Same input twice gives deep-equal output.
