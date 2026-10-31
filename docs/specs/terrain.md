# Spec: terrain (the drivable corridor's ground)

Replaces `src/core/terrain.ts` (upstream-derived, on `UPSTREAM-FILES.txt`) and takes in `streetCeiling` from `src/core/track.ts` (fork code, part of the same ground rule). Written from the old code so a separate session can write a fresh module without it open. No code here on purpose: describe, don't copy.

Units: local metres, x east, y north, heights up. Meshes come out through `MeshBuilder.toKn5` (which turns local into AC coordinates: AC x = x, AC y = height, AC z = -y).

## What it does

1. Picks the square terrain chunks to build (`planTerrainChunks`).
2. Gives the finished ground height anywhere: the DEM, pulled to the road near it, sunk just under the road, verges, kerbs and roundabouts, blended back to the DEM further out (`makeTerrainFn`).
3. Keeps the ground a few centimetres under every built side street (`streetCeiling` plus the clamp; now in track.ts, moves here).
4. Builds one physics mesh per chunk, on a regular grid with two levels of flat-ground simplification (`buildTerrainChunk`), photo-textured or plain grass.
5. Gives the highest height the drawn grid can have at a point (`meshTop`), for things laid on it.

## Settings that matter

Defaults (`src/core/options.ts`) are for hilly roads. Busselton town routes (and the `town` preset) override them, and the tests must cover both:

| Option | Default | Busselton town | Used for |
| --- | --- | --- | --- |
| `chunkSize` | 200 | 200 | chunk side, m |
| `corridor` | 90 | 60 (busselton.json), 70 country preset | ground kept each side of the route |
| `terrainStep` | 3 | **1.5** (2.5 country) | grid spacing, m |
| `terrainUnderRoad` | 0.6 | **0.12** (0.2 country) | how far under the road surface the ground goes |
| `terrainBlend` | 20 | 20 | blend distance from road level to the DEM |
| `vergeWidth` | 1.5 | 1.5 | gravel verge / gutter-to-strip width |
| `crown` | 0.02 | 0.02 | crossfall centre to edge |
| `banking` | true | **false** | (via the samples' `bank`, which is then 0) |
| `terrainLod` | true | true | simplification on/off |
| `terrainLodNear` | 25 | 25 | no simplification this close to the route |
| `terrainLodFarTol` | unset (0.05) | 0.15 in one private area build | far tolerance |

Why the town values (CLAUDE.md): with 6% banking, a 3 m grid and ground sunk 0.6 m, Busselton's flat streets got tilted corners and 40 to 60 cm drops at the road edges.

Constants from other modules this one reads (import them, don't copy): `KERB_H` = 0.15 and `STRIP_EXTRA` = 1.5 (kerbs.ts); `outerRadius`, `vergeOuterRadius`, `ringHeight`, `toOpening` (roundabout.ts); `MAX_MESH_VERTICES` (kn5 writer).

Module constants:

- `BELOW_VERGE` = 0.25: how far under the road edge the ground beside a gravel verge sits.
- `KERB_LIFT` = `BELOW_VERGE + KERB_H - 0.03` = 0.37: added (times the kerb fraction) behind a kerb, so the ground sits 3 cm under the nature strip (which is `KERB_H` over the road edge).
- `LOD_TOL` = 0.02, `LOD_TOL_FAR` = 0.05, `LOD_FAR` = 40, block size `K` = 4 cells, second level `S` = 4 blocks.
- `STREET_GAP` = 0.04 (ground under a street), `STREET_CELL` = 1 (street raster cell).

## API

```
interface TerrainChunk { key: string; minX: number; minY: number; maxX: number; maxY: number }
interface TerrainSample { h: number; dist: number }

planTerrainChunks(plan, index, opts, area = null): TerrainChunk[]
makeTerrainFn(plan, index, dem, opts): (x, y) => TerrainSample
streetCeiling(meshes: Kn5Node[], reach: number): (x, y) => number | null      // moved from track.ts
underStreets(terrain, ceiling, gap = STREET_GAP): (x, y) => TerrainSample     // the clamp track.ts does inline today
buildTerrainChunk(chunk, terrain, opts, textured, area = null, nearStreet?): Kn5MeshNode | null
meshTop(terrain, opts): (x, y) => number
```

`TerrainChunk` is a shared type: `backdrop.ts`, `tiles.ts` (imagery for a chunk), `zones.ts`, `frontage.ts`, `buildings.ts` (`detectBuildings`), `carpark.ts` (islands, painting out cars) all take it. Keep its shape.

`plan` is the `RoadPlan` (samples with `pos`, `h`, `bank`, `width`, optional `kerb: [left, right]` 0..1, optional `crown`; `closed`; `roundabouts`). `index` is the `SegmentIndex`: `nearest(x, y, maxDist)` returns `{ dist, seg, frac, t }` or null (t signed, positive left), `at(n)` returns interpolated `{ h, bank, width, kerb }` where `kerb` is the kerb fraction on the side the point is on, `segmentCount`. `area` is an `Area` (`minX..maxY`, `inside(x, y)`, `signed(x, y)`: distance to the outline, negative inside). `dem` is a `HeightFn` (elevation spec).

## 1. Choosing chunks (`planTerrainChunks`)

1. Bounding box of every route sample position, plus the area's box when there is one.
2. Grid of `chunkSize` squares aligned to multiples of `chunkSize` from the local origin, covering the box grown by `corridor` on every side (cell indices `floor((min - corridor) / size)` to `floor((max + corridor) / size)`).
3. Keep a square if its centre is within `corridor + 0.75 * chunkSize` of the route (`index.nearest` with that reach finds something), or, with an area, its centre is less than `0.75 * chunkSize` outside the area (`area.signed(centre) < 0.75 * chunkSize`).
4. Scan rows south to north, west to east within a row. Keys are `t` + the running count of kept chunks, zero-padded to three digits (`t000`, `t001`, ... `t1000` past 999).

The key format is a contract: physics mesh `1GRASS_<key>`, photo material `terrain_<key>`, texture `terrain_<key>.dds|jpg|png`, `<name>_mask.dds`; `street_ground.py` matches `1GRASS_t`; CSP and Pure config match `terrain_?`. Track.ts keeps one `textured` set holding terrain and backdrop keys together, so terrain keys must start with `t` and never collide with backdrop keys (`b...`).

Known weakness, fix if cheap: keys are a running count, so a route change renumbers every chunk (and every texture name). Keys from the grid cell (still starting `t`) would be steadier, but check `cspConfig.ts`, `pureConfig.ts` and the check scripts still match.

## 2. The ground function (`makeTerrainFn`)

Returns `(x, y) -> { h, dist }`. `dist` is the distance to the route centreline, `Infinity` when nothing is within `corridor + terrainBlend + 10`, and 0 on a roundabout's disc. Callers use `dist` for "inside the corridor" (chunk meshes) and for level of detail.

### 2a. Along the route

For a point (x, y):

1. `ground = dem(x, y)`. Nearest route point within `corridor + terrainBlend + 10`; none: return `{ h: ground, dist: Infinity }`.
2. From `index.at(n)`: `h`, `bank`, `width`, `kerb` (fraction 0..1 on the point's side). `half = width / 2`.
3. **Inner edge** (where made surface ends and natural ground starts): `inner = half + vergeWidth + (kerb > 0 ? STRIP_EXTRA : 0)`.
4. **Edge height**: `tc = clamp(t, -half, half)`; `edge = h + bank * tc - crown * |tc|`. That's the road surface at the point when over the asphalt, else at the asphalt's edge on that side. **Use the sample's own crown** (interpolated from `samples[seg].crown` and `samples[seg + 1].crown`, falling back to `opts.crown`), the same as `surfaceHeight` in road.ts. The old code always used `opts.crown`; networkCore eases the crown out before junction caps, so there the ground was computed against the wrong edge height (too low: safe, but not what the road is).
5. **Base** (ground level just past the made surface): `base = edge - BELOW_VERGE + KERB_LIFT * kerb`. So beside a gravel verge 0.25 m under the road edge (the verge falls 0.2 m over its width; the ground is 5 cm under its outer edge), behind a full kerb 0.12 m over the road edge (3 cm under the 0.15 m nature strip).
6. **Past the ends of an open route** (`!plan.closed` and the nearest point is the very start, seg 0 frac 0, or the very end, last seg frac 1): skip rule 7; use rule 8 with `n.dist`, the distance to the end point.
7. **Under the made surface** (`dist <= inner`): `h = underRoad(edge, base, inner - dist)` where
   `underRoad(surface, beyond, fromEdge) = beyond + (surface - terrainUnderRoad - beyond) * k`, `k = clamp(fromEdge / (2 * terrainStep), 0, 1)`.
   At the inner edge the ground is at `base`; two grid steps in it is `terrainUnderRoad` under the surface, and stays there across the road. A straight ramp over exactly two grid cells is what the grid draws, so the cell beyond the edge isn't dragged down (the old full drop to the edge made a ditch 22 cm deep beside gravel and 43 cm behind kerbs on a 3 m grid, commit 07b6283).
8. **Blend out** (`dist > inner`): `f = smoothstep((dist - inner) / terrainBlend)` with `smoothstep(x) = t²(3 - 2t)`, `t = clamp(x, 0, 1)`; `h = base + (ground - base) * f`.

Return `{ h, dist: n.dist }`; internally also keep `inner` for 2b.

### 2b. Roundabouts

A ring is a level disc (its surface `ringHeight(rb, rho) = rb.hc + 0.02 * (rb.r - rho)`, falling outward; `rb.hc` is set by `applyElevation` before this is called). For each roundabout, in plan order, with `d` = distance to its centre, `Ro = outerRadius(rb)` (r + w/2), `E = vergeOuterRadius(rb, opts)` (Ro plus, kerbed, `max(vergeWidth + STRIP_EXTRA, 0.35 + 2 * terrainStep)`, else `vergeWidth`):

1. Skip if `d > E + terrainBlend`.
2. **Mouth factor**: `closed = clamp((toOpening(rb, Ro, angle) - 0.5) / 2, 0, 1)`, where `toOpening` is the arc distance at radius Ro to the nearest road opening (0 inside one). So 0 within 0.5 m of a mouth, 1 from 2.5 m away, the same 2 m taper the kerb mesh uses. (Old name `open`; it's really "how closed".)
3. `sunk = ringHeight(Ro) - terrainUnderRoad`; `kerbBase = ringHeight(Ro) - BELOW_VERGE + (rb.kerbed ? KERB_LIFT : 0)`; `base = sunk + (kerbBase - sunk) * closed`. In a mouth there's no kerb or verge, so the ground stays under the road instead of ramping up to kerb height (it poked 6 to 20 cm up through every entry and exit before commit 54fc61a).
4. **On the disc** (`d <= E`): `h = underRoad(ringHeight(min(d, Ro)), base, E - d)`. If `closed < 1` and the point is under the route's made surface (2a `dist <= inner`), `h = min(h, route h)`: on an arm, under whichever surface is lower. Return `{ h, dist: 0 }`.
5. **In the blend ring** (`E < d <= E + terrainBlend`): if the point is under the route's made surface, return the route's sample. Else `ringH = kerbBase + (dem - kerbBase) * smoothstep((d - E) / terrainBlend)`, and return whichever of the ring's and the route's result is further from `dem(x, y)` (ties go to the route). The ring's result carries `dist = min(route dist, d)`.
6. Return as soon as one roundabout applies; if none does, the route's sample.

**Known bugs to fix, not copy:**
- Only the first roundabout in range counts. Two rings whose blend zones overlap (close pairs in area builds) see only the earlier one. Take every ring in range and combine with the same rule as rule 5 (on any disc wins; otherwise the result furthest from the DEM).
- The blend ring blends from `kerbBase` even in a mouth (rule 3's `base` isn't used there). Use `base` so the mouth stays low out past E.
- `dist` in the blend ring is the distance to the ring's centre, not its edge, and for area rings away from the route the route's `dist` is `Infinity`, so level of detail can coarsen the ground right beside an area ring. Return the distance to the ring's outer edge `max(0, d - Ro)` there instead.

### 2c. Properties the checks and tests rely on

- Nothing pokes through: on the grid as drawn (bilinear between nodes, either diagonal), the ground is at least 1 cm under the road, gutter, verge, kerb and nature strip, for gravel and kerbed edges, flat and on a 10% grade, with the road at any angle to the grid (test/terrain.test.ts does this at 40 grid offsets).
- No ditch: from 0.2 m to 6 m past the made surface the drawn ground is no more than 8 cm under where it's meant to be (`edge - 0.25` gravel, `edge + KERB_H - 0.03` kerbed).
- At a kerbed ring mouth (1.5 m and 3 m grids) the ground stays under the arm's road, under the ring gutter away from the mouths (0.3 m wide, falling 0.1 per metre), and no ditch over 10 cm behind the grass strip.

## 3. Ground under side streets (`streetCeiling`, `underStreets`)

Side streets, kerb-return fills and networkCore junctions are built as meshes, not from this function, so the grid could come up through them: at a street mouth across the route's raised verge it came 11 cm through the street, and on a hillside a metre through a return fill (Cape Leeuwin; commits 1c785da, e9d9b88). The fix is a ceiling read from the built meshes.

**Which meshes:** every mesh node (walking groups) whose name starts with `1STREET` or `1UNPAVED`, from the side streets, the kerb returns (this includes `1STREET_RETFILL`, the fills at street mouths) and networkCore's junction meshes. Track.ts filters the kerb returns by that name test; the side streets and networkCore nodes go in whole (the walk itself doesn't filter, so keep the filtering explicit at the call or move it inside).

**Raster:** for every triangle (AC positions; local x = AC x, local y = -AC z, height = AC y), skip degenerate ones (|denominator| < 1e-9). For each 1 m cell (`STREET_CELL`) overlapping the triangle's box, take the cell middle, its barycentric weights; skip the cell if any weight is under -0.5 (well outside); otherwise clamp negative weights to 0, renormalise, interpolate the height. Keep the **lowest** height per cell.

**Query** `ceiling(x, y)`: the lowest stored height among cells whose middle is within `reach + STREET_CELL` of the point (scan `ceil(reach)` cells each way); null if none. Track.ts passes `reach = terrainStep`, which covers every grid node of every cell a street touches (a node is at most `step * sqrt 2` from any point in its cells, under `step + 1`).

**Clamp** `underStreets`: where the ceiling is not null and `terrain.h > ceiling - STREET_GAP`, the height becomes `ceiling - 0.04`; `dist` is unchanged. Only ever lowers.

This clamped function is what `buildTerrainChunk` gets. `street_ground.py` then rasterises `1STREET*`/`1UNPAVED*` and `1GRASS_t*` at 0.5 m and fails above 3 cm (counts over 1 cm).

Notes:
- The analytic `terrainAt` (unclamped) is still what track.ts uses for walls, rail needs, cameras, sounds, kerbside heights, the backdrop's limit and the scene ground's fallback; `meshTop` is also built on the unclamped function (see 5). Keep both functions available.
- It's a patch on the real cause (the ground doesn't know where streets are); road-network.md's core cuts the ground to the verge's outer edge instead. Until that lands, keep it.

## 4. Chunk meshes (`buildTerrainChunk`)

### 4a. Grid

1. `size = maxX - minX`; `cells = max(1, round(size / terrainStep))`; `step = size / cells`. The real step isn't exactly `terrainStep` (200 m at 1.5 gives 133 cells of 1.5038 m); `meshTop` must use the same.
2. Nodes `(i, j)`, i, j in 0..cells, at `(minX + i * step, minY + j * step)`. Sample the terrain function on a grid padded by one node all round (for normals): height, `dist`, and `inside = dist <= corridor || area?.inside(x, y)`, and `tight = nearStreet?.(x, y)`. Track.ts passes `nearStreet = streetIndex.clearance(x, y) < 4` (within 4 m of a side street's edge).
3. A cell is drawn only if all four corners are inside. No inside cells: return null.
4. Vertex budget: `(cells + 1)²` must stay under `MAX_MESH_VERTICES` (65535). 200 m at 1.5 m is 17,956. A step under about 0.79 m at 200 m chunks would overflow and the old code throws; the rewrite should throw a clear error naming the option (or split), not write a broken mesh.

### 4b. Level of detail (when `terrainLod`)

**First level.** Blocks of `K` x `K` = 4 x 4 cells from the chunk's south-west corner; `B = floor(cells / K)` blocks each way (the last `cells mod K` rows and columns are never blocks). A block is coarse when, over all its (K+1)² nodes:
- every one of its 16 cells is inside;
- every node has `dist >= terrainLodNear`;
- every node is within tolerance of the bilinear surface through the block's four corner heights. Tolerance: `LOD_TOL` (2 cm) where `dist < LOD_FAR` (40 m) or the node is tight, else `terrainLodFarTol ?? LOD_TOL_FAR` (5 cm).

**Second level.** Groups of `S` x `S` = 4 x 4 blocks (16 x 16 cells); `B2 = floor(B / S)`. A group is a super block when all 16 blocks are coarse, every node has `dist >= LOD_FAR`, and every node is within tolerance of the bilinear surface through the group's corners (tight nodes `LOD_TOL`, others the far tolerance).

**Drawing.**
- Fine cells (not in a coarse block, inside): two triangles. Diagonal alternates in a checkerboard: when `(i + j)` is even the split runs from (i, j) to (i+1, j+1), when odd from (i+1, j) to (i, j+1). Counter-clockwise seen from above (y north).
- A coarse block not in a super block: a triangle fan from its centre node `(i0 + 2, j0 + 2)` round its boundary loop, counter-clockwise from above (south edge west to east, east edge south to north, north edge east to west, west edge north to south). Along each edge keep only the corners if the block across that edge is coarse; otherwise every node. Outside the chunk and in the leftover strip count as not coarse, so chunk borders always keep every node and neighbouring chunks meet without cracks.
- A super block: a fan from its centre `(i0 + 8, j0 + 8)` round its loop. Along each edge, node k is kept if k is the edge's start corner, or the block beside the segment before or after it (k-1..k or k..k+1) is fine (keep every node), or is a first-level coarse block and `k mod K == 0` (keep its corners). Beside another super block only corners.
- Only nodes that some triangle uses get a vertex.

Result: no T-junctions anywhere (the only open edges are on the chunk border), every triangle faces up.

**Known looseness to fix:** the flatness test compares nodes with the bilinear surface through the corners, but what's drawn is a fan through the centre node and the kept boundary nodes, which isn't that surface. The drawn ground can be off the true heights by up to about twice the tolerance plus the bilinear twist. The "tight within 4 m of a street" rule (commit b2c4f82) partly works around this. Test against the surface actually drawn (each dropped node against the fan triangle it falls in), and keep the same tolerances.

### 4c. Vertices and the mesh

- Position `(x, y, h)` from the clamped terrain.
- Normal from central differences on the padded grid (full resolution, also for fan vertices): `dx = (h[i+1] - h[i-1]) / 2step`, `dy` likewise, normal `(-dx, -dy, 1)` normalised. The pad makes normals continuous across chunk borders.
- UVs: textured, `u = i / cells`, `v = 1 - j / cells` (the chunk's photo is north up: row 0 at maxY, so v = 0 at the north edge). Untextured, world-tiled `u = x / 10`, `v = -y / 10` (the grass texture every 10 m).
- Mesh name `1GRASS_<key>` (the `1GRASS` prefix makes it physics ground with the GRASS surface; `acFiles.ts`, `groundCheck.ts`, `sceneGround.ts` `PHYSICS_GROUND`, `path_ground.py` and `street_ground.py` all rely on it). Material `terrain_<key>` when textured, else `grass`. Default node flags (renders, casts shadows).
- Track.ts puts the chunks in group `TERRAIN` (`groundCheck.ts` `SURFACE_GROUPS` lists it). `carpark.ts` builds car-park islands in `terrain_<key>` material with the same UV mapping (pixel from chunk bounds, north up), so keep that mapping.

## 5. Highest drawn ground (`meshTop`)

`meshTop(terrain, opts)` returns `(x, y) -> metres`: the higher of the two possible triangle readings in the grid cell containing the point, so whatever diagonal the chunk drew, the result is never under the mesh.

- Grid: `step = chunkSize / max(1, round(chunkSize / terrainStep))`, nodes at `(i * step, j * step)` globally. That matches every chunk's nodes because chunks start on multiples of `chunkSize`, which is a whole number of steps.
- `u, v` = fractional position in the cell. Reading along the (0,0)-(1,1) diagonal and along the (1,0)-(0,1) diagonal (plane through the three nodes of the triangle containing the point); return the maximum.
- Node heights cached by `(i, j)`; the cache is emptied when it passes 200,000 entries.

Track.ts uses it for the roundabout grass (`buildRingMeshes` gets `meshTop(terrainAt)`), so ring verges meet the mesh. It reads the full grid, not the LOD fans and not the street clamp. Leave callers as they are; optional improvements: read the real diagonal (parity of the chunk-local `i + j`, with chunk-local index = global minus `cx * cells`), and take the street clamp into account if a caller needs it.

## Call sites

- `src/core/track.ts`: `makeTerrainFn` (the analytic ground `terrainAt`), `planTerrainChunks`, `buildTerrainChunk` (with the street-clamped function, `textured.has(key)`, `area`, `clearance < 4`), `meshTop` (roundabouts), `TerrainChunk` (imagery jobs, islands, photo masks). `streetCeiling` is local there now; move it here and leave track.ts calling it.
- `scripts/network/phase1.ts`: `makeTerrainFn(plan, index, dem, opts)` after setting `rb.hc`.
- Type users: `backdrop.ts`, `services/tiles.ts`, `zones.ts`, `frontage.ts`, `buildings.ts`, `carpark.ts`.
- Tests now: `test/terrain.test.ts`, `test/terrainLod.test.ts`; many build tests go through `buildTrack`.

## Tests to write

1. Chunks: a straight 1 km route gives chunks only within `corridor + 150 m` (chunk centres), aligned to `chunkSize`; keys `t000` up in south-to-north, west-to-east order; an area adds every chunk whose centre is under 150 m outside it.
2. Ground on flat land beside a flat road at an angle to the grid (default and Busselton settings, gravel and kerbed, flat and 10% grade): the bilinear mesh is at least 1 cm under every made surface and no more than 8 cm under the intended level 0.2 to 6 m beyond (the old test's cross-section approach, 40 grid offsets).
3. Ground `terrainUnderRoad` under the road surface two steps inside the inner edge; `base` exactly at the inner edge; the DEM from `inner + terrainBlend` out; `dist` Infinity beyond `corridor + terrainBlend + 10`.
4. Per-sample crown: a sample with `crown: 0` gives the ground under its flat edge, not under the default crown's edge.
5. Open route ends: past the last sample the ground isn't sunk (no `terrainUnderRoad` drop) and blends to the DEM with distance from the end point.
6. Roundabout mouth (1.5 m and 3 m grids, kerbed ring): the arm's ground under the road, the ring gutter clear away from mouths, no ditch over 10 cm behind the strip.
7. Two roundabouts with overlapping blend zones: neither ring's disc has ground above its surface.
8. Street clamp: a street mesh 10 cm under the terrain: every node within `terrainStep` of it is 4 cm under the street's lowest nearby height; nodes further out unchanged; `1STREET_RETFILL` counts; a `1ROAD_` mesh doesn't.
9. LOD: flat ground away from the road uses under 60% of the fine triangles (one level) and under 26% on a 192 m chunk with a bump (two levels); bumpy ground keeps every cell; within `terrainLodNear` every cell fine; open edges only on the chunk border; every triangle faces up; every dropped node within its tolerance of the surface actually drawn.
10. Tight nodes: a flat-ish slab with 3 cm undulation far from the route coarsens, but not within 4 m of a street (`nearStreet`).
11. Mesh: name `1GRASS_<key>`, material `terrain_<key>` when textured else `grass`; textured UVs 0..1 with v = 0 on the north edge; normals of two neighbouring chunks equal at shared border vertices.
12. Vertex limit: a chunk whose grid would pass `MAX_MESH_VERTICES` raises a clear error.
13. `meshTop` is never under either triangulation of the cell, equals the node heights at nodes, and matches the mesh of a built chunk within 1 mm wherever that chunk drew fine cells.

## Could be deleted instead of rewritten (for Mac)

Nothing here is unused. When the networkCore lands (road-network.md, "the ground mesh is cut to the outer edge"), `terrainUnderRoad`, the two-cell ramp and the street clamp could all go; until then they're what keeps the ground under the roads.
