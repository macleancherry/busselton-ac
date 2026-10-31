# Spec: backdrop (the horizon ground)

Replaces `src/core/backdrop.ts` (upstream-derived, on `UPSTREAM-FILES.txt`). Written from the old code so a separate session can write a fresh module without it open. No code here on purpose: describe, don't copy.

Units: local metres, x east, y north, heights up. Meshes go out through `MeshBuilder.toKn5` (AC x = x, AC y = height, AC z = -y).

## What it does

A coarse, non-collidable ground out to `horizon` metres from what's built, so the world doesn't end at the edge of the drivable corridor. Near the corridor it's held a few metres under the detailed terrain so the detailed ground always covers it where the two overlap; further out it rises to the real height. Buildings, tree lines and shore works beyond the base stand on it.

1. Picks the 1 km horizon chunks (`planBackdrop`).
2. Gives the horizon height at a point (`backdropHeight`).
3. Builds one mesh per chunk on a 20 m grid with a hole inside the corridor (`buildBackdropChunk`).
4. New: the height of the mesh as drawn (`backdropSurface`), for things standing on it (see bug 1).

## Settings and constants

- `opts.horizon`: distance out from what's built, metres. Default 1500; country preset 1000; 0 turns the horizon off.
- `opts.corridor` (default 90; Busselton 60, country 70), `opts.horizonZoom` (photo zoom, default 16).
- `BACKDROP_CHUNK` = 1000 (exported: track.ts grows the far DEM's box by `horizon + BACKDROP_CHUNK`).
- `STEP` = 20 (grid spacing; 1000 / 20 = 50 cells, so nodes fall on multiples of 20 m everywhere).
- `SINK` = 3 (how far under the ground the horizon sits near the corridor).
- `RISE` = 300 (distance past the corridor over which the far DEM's sink eases out).
- `UNDER_REACH` = 60 (how far past the corridor the horizon is still held under the detailed terrain).
- `UNDER_SLOPE` = 0.1 (that limit rises 1 in 10 past the corridor).
- `HOLE_IN` = 2 * STEP = 40 (the hole starts this far inside the corridor).

## API

```
BACKDROP_CHUNK = 1000
planBackdrop(plan, index, opts, area = null): TerrainChunk[]
backdropHeight(dem, index, opts, x, y, cover?, terrain?): number
buildBackdropChunk(chunk, dem, index, opts, textured, cover?, terrain?): Kn5MeshNode | null
backdropSurface(dem, index, opts, cover?, terrain?): (x, y) => number        // new
```

`TerrainChunk` comes from the terrain module. `dem` is the far DEM (`landFarDem`, zoom `min(demZoom, 12)`, wrapped with the seabed when there's sea). `cover(x, y)` is the build's coverage distance (`area.ts` `makeCover`: distance from the middle of what's built in the corridor's terms; along the route the distance to the centreline, inside an area at most `corridor` minus the depth inside it). `terrain(x, y)` is the detailed ground's height (track.ts passes the analytic `terrainAt(x, y).h`, not the street-clamped one or the mesh).

## Rules

### 1. Chunks (`planBackdrop`)

1. `horizon <= 0`: no chunks.
2. Bounding box of the route samples (plus the area's box), grown by `horizon`; 1000 m squares aligned to multiples of 1000 from the local origin, cell index range by `floor`.
3. Keep a square when its centre is within `horizon + 0.71 * 1000` of the route (`index.nearest` with that reach finds something), or, with an area, `area.signed(centre) < horizon + 710`.
4. Scan rows south to north, west to east. Keys `b` + running count, three digits (`b000`...). Keys start with `b` so they never collide with terrain keys (`t...`) in track.ts's shared `textured` set.

### 2. Height (`backdropHeight`)

1. `d = cover(x, y)` when `cover` is given, else the route distance (`index.nearest(x, y, corridor + 300)`, Infinity if none). Track.ts passes `cover` only for area builds; without an area the two agree within `corridor + 300`, which is all that matters. Simplest in the rewrite: always take `cover` (track.ts can pass it for every build).
2. `s = smoothstep(clamp((d - corridor) / RISE, 0, 1))`; `h = dem(x, y) - SINK * (1 - s)`. So 3 m under the far DEM up to the corridor, rising to the far DEM 300 m past it.
3. Without `terrain`, or when `d > corridor + UNDER_REACH`, return `h`.
4. Otherwise return `min(h, terrain(x, y) - SINK + UNDER_SLOPE * max(0, d - corridor))`. The coarse far DEM can read metres high (3 to 4 m on Busselton's foreshore), and a fixed sink under it let the blurry horizon photo show through the detailed terrain (commit eb28ede). Held 3 m under the detailed ground wherever they overlap, it never does.

Why `UNDER_REACH` must stay small: the detailed DEM is only fetched out to `corridor + terrainBlend + 60` (track.ts), and past its edge `DemGrid.sample` clamps to edge values, so `terrain` means nothing much beyond that. Keep `UNDER_REACH <= terrainBlend + 60`.

### 3. Chunk mesh (`buildBackdropChunk`)

1. `cells = round((maxX - minX) / STEP)` (50); nodes `(minX + i * STEP, minY + j * STEP)`, i, j in 0..cells.
2. Hole: `hole = max(0, corridor - HOLE_IN)`. A node is kept when its `d` (rule 2.1, same choice of cover or route distance) is greater than `hole`. A cell is drawn only if all four nodes are kept. So the horizon runs 40 m (two of its cells) in under the detailed terrain, which ends at `corridor`; that overlap ring hides the seam. With `corridor <= 40` there's no hole.
3. Node heights from `backdropHeight` (with `cover` and `terrain` as given).
4. Quads `(i, j), (i+1, j), (i+1, j+1), (i, j+1)`, counter-clockwise seen from above, each split along the (i, j)-(i+1, j+1) diagonal (rule 4 and `backdropSurface` depend on that).
5. Vertices only for nodes a drawn cell uses. UVs: textured, `u = i / cells`, `v = 1 - j / cells` (photo north up, v = 0 on the north edge); untextured, world-tiled `u = x / 40`, `v = -y / 40`.
6. No cells drawn: null.
7. Mesh name `BACKDROP_<key>`: no digit prefix, so it's visual only, never physics. Material `backdrop_<key>` when textured, else `grass`. `castShadows: false`.
8. 51 x 51 = 2601 vertices at most per chunk, well under the kn5 limit.

### 4. Drawn height (`backdropSurface`, new)

`(x, y) -> metres`: the height of the backdrop mesh as drawn at a point, whether or not a chunk covers it (outside the chunks it still answers from the same grid). Nodes at `(i * STEP, j * STEP)` (global, because chunks start on multiples of 1000), node heights from `backdropHeight` (cache them, as `meshTop` does), and within a cell the plane of the triangle the point lies in, split along (0,0)-(1,1): `u >= v` takes the triangle (0,0), (1,0), (1,1), else (0,0), (1,1), (0,1).

### Names and groups the rest of the build relies on

- `landmarkGround.ts` finds the horizon by `/^BACKDROP_/` (its third fallback, after the physics ground and nearby ground, before the DEM).
- `cspConfig.ts` matches `backdrop_?` (rough materials, ground materials, excluded from AO baking). The photo texture is `backdrop_<key>.<ext>` at `horizonZoom`, 512 px per chunk; track.ts also finds far tree lines in it.
- Track.ts puts the chunks with the horizon trees in group `HORIZON`.

## Who stands on it (track.ts; describes the callers, so the new module gives them what they need)

- `farGround(x, y)` = `backdropHeight(farDem, index, opts, x, y, area ? cover : undefined, terrainAt.h)`.
- `horizonGround(x, y)` = `farGround(x, y) - 0.6`.
- **Buildings**: a point is on the base when it's at least 1 m inside cover (`cover <= corridor - 1`) or a physics mesh covers it (`sceneGround.mesh`). A building takes one ground for its whole footprint: the base's (`sceneGround.forRing`, sunk `SINK` = 0.02 from sceneGround.ts) if any corner or the centroid is on the base, otherwise `horizonGround`, sunk a further 0.4 m (so its walls start 1.0 m under the horizon height at each point). Before the one-ground rule, a house straddling the terrain's edge took the horizon (3 m under the terrain there) for its lowest corner and sank 4 to 5 m (commit d14ecb8).
- **Spec houses** (house looks with a spec): each footprint's base is `sceneGround.underRing` when on the base, else `horizonGround` at the footprint's centroid; the house takes the lowest.
- **Horizon tree lines**: canopy spots from the backdrop photos (density 1), kept when more than 5 m outside cover, cover under 1000 m and not over the sea, evenly thinned to at most 3000; they stand on `farGround - 0.6` with their own sink of 0.3 m, `castShadows: false`.
- **Shore works** (jetty, lamps, precinct, seawall, groynes): the analytic terrain at least 1 m inside cover, else `horizonGround`.

## Known bugs to fix, not copy

1. **Things beyond the base stand on the point height, not the mesh.** `farGround` is `backdropHeight` at the exact point, but the mesh is straight lines between nodes 20 m apart. Over convex ground (a hilltop, a dune crest) the mesh runs under the point height by up to about `curvature * 20² / 8`; over concave ground it runs above. The fixed 0.6 m (and 0.4 m or 0.3 m sinks) hides most of it on flat Busselton but not on the capes' hills, where houses and tree lines can float or bury. Callers should take `backdropSurface` and keep their offsets as their own choice (track.ts change, flag to the lead; changing the offsets changes the look, so accept a new base deliberately). `landmarkGround.ts` already reads the mesh triangles and is unaffected.
2. **A jump at `corridor + UNDER_REACH`.** Inside, the height is `min(h, limit)`; just outside, `h`. There the limit is the terrain plus 3 m and `h` is the far DEM minus about 2.7 m, so where the far DEM reads more than about 5.7 m over the detailed terrain the horizon steps up. Fade the limit out instead: over the last 20 m (`corridor + 40` to `corridor + 60`) blend from `min(h, limit)` to `h` with a smoothstep.
3. **Lighting seams at chunk borders.** Normals are left to the mesh builder, which averages face normals within one chunk, so the two sides of a 1 km border light differently. Give explicit normals from central differences of the node heights (`backdropHeight` at ±STEP), as the terrain does with its padded grid.
4. **A ledge at the corridor's edge (open question for Mac).** Where the detailed terrain stops (`corridor`), the horizon beyond it is 3 m lower, rising 1 in 10, so the detailed ground ends at a visible step (verification.md item 11 asks for no ledge). It's been this way since the start; the 3 m sink is what keeps the far photo from showing through the detailed terrain. Options: a short skirt down from the terrain mesh's outer edge to the horizon, or a smaller sink in the last cell or two of the overlap. Don't change it in the rewrite without Mac's say.

## Call sites

- `src/core/track.ts`: `BACKDROP_CHUNK` (far DEM box), `planBackdrop`, `buildBackdropChunk` (with `farDem`, `textured.has(key)`, `area ? cover : undefined`, `terrainAt.h`), `backdropHeight` (`farGround`, see above).
- `src/core/landmarkGround.ts`: the `BACKDROP_` name.
- Tests now: `test/pathGround.test.ts` (backdrop part).

## Tests to write

1. Chunks: none with `horizon` 0; aligned to 1000 m; only within `horizon + 710` of the route (or area); keys `b000` up in south-to-north, west-to-east order.
2. Height without `terrain`: `dem - 3` at and inside the corridor, `dem` from 300 m past it, smoothstep between.
3. Height with `terrain` (the old test's numbers: far DEM 6 m, detailed ground 2 m, corridor 60, cover = x): -1 at x = 10 and x = 60; 1 at x = 80 (1 in 10 past the corridor); 6 at x = 500. Without terrain at x = 10: 3.
4. No vertex above `terrain - 1` where `cover <= corridor`, for a far DEM reading 4 m over the detailed ground.
5. Continuity: `backdropHeight` along a line out from the corridor never jumps more than 0.2 m between points 1 m apart, including across `corridor + 60` with a far DEM 7 m over the terrain (the old code jumps there once the far DEM is more than about 5.7 m over it).
6. Hole: no drawn cell with a node `d <= corridor - 40`; cells drawn from there out; with corridor 30 no hole.
7. Mesh: name `BACKDROP_<key>`, `castShadows` false, material `backdrop_<key>` textured else `grass`; UV v = 0 on the north edge; at most 2601 vertices; every triangle faces up; diagonal (i, j)-(i+1, j+1).
8. `backdropSurface` equals the built mesh's triangles within 1 mm at random points in a chunk, and equals `backdropHeight` at nodes.
9. Normals: equal at shared vertices of two neighbouring chunks.
