# Spec: elevation (the DEM height grid)

Replaces `src/core/elevation.ts` (upstream-derived, on `UPSTREAM-FILES.txt`). Written from the old code so a separate session can write a fresh module without it open. No code here on purpose: describe, don't copy.

Units: local metres (x east, y north) from the build's `LocalProjection`; heights in metres. The tile maths is the standard web-map (spherical Mercator, 256 px tiles) grid.

## What it does

A small, pure module:

1. The `HeightFn` type used everywhere: `(x, y) => metres`.
2. Terrarium decoding (RGB to metres).
3. `DemGrid`: one mosaic of 256 x 256 height tiles on the web-map tile grid, sampled bilinearly at any local point. Built from decoded RGBA tiles, from height tiles, or from a function (tests).
4. `demTilesFor`: which tiles cover a box.

Fetching tiles, choosing zooms and state models, and filling gaps live in `src/services/tiles.ts` (`loadDem`), not here. Smoothing the road's profile lives in `road.ts` (`applyElevation`). Both are described below under "Neighbours" because callers rely on how they use this module.

## API

```
type HeightFn = (x: number, y: number) => number

decodeTerrarium(r, g, b): number
interface DecodedTile { x: number; y: number; rgba: Uint8Array | Uint8ClampedArray }   // 256 x 256 RGBA

class DemGrid {
  readonly z, px0, py0, width, height: number; readonly data: Float32Array
  static fromTiles(proj, z, tiles: DecodedTile[]): DemGrid
  static fromHeights(proj, z, tiles: { x, y, heights: Float32Array }[]): DemGrid
  static fromFunction(proj, z, bounds: Bounds, fn: HeightFn): DemGrid
  sample: HeightFn          // a bound property: callers pass `grid.sample` around detached
}

demTilesFor(proj, bounds, z): { x: number; y: number }[]
```

`sample` must work when detached from the object (`const dem = grid.sample; dem(x, y)`): tiles.ts returns `DemGrid.fromHeights(...).sample` and `fromTiles(...).sample`, and many tests do the same with `fromFunction`. Make it an arrow-function property or bind it.

## Rules

### Terrarium

1. `height = R * 256 + G + B / 256 - 32768`.
2. **Alpha 0 is no data**: return NaN. tiles.ts already has its own `decodeTerrarium(rgba)` that does this (array in, Float32Array out) and `scripts/polish/demTiles.ts` imports that one. Have one decoder: export the per-pixel function here and an array version (`decodeTerrariumTile(rgba): Float32Array`, NaN at alpha 0), and make tiles.ts re-export or import it so both callers keep working.

### Pixel coordinates

3. `proj.localToPixel([x, y], z)` gives the global pixel coordinate at zoom z (continuous; pixel k covers [k, k+1), y down). It's linear in local metres. `proj.pixelToLocal` is its inverse.
4. A grid stores `data[row * width + col]` and `px0, py0`: the global pixel coordinate that `data[0]` stands for. Sampling at a local point: `fx = gx - px0`, `fy = gy - py0`; index space has the stored values at integers.

### `fromHeights` (and `fromTiles`)

5. Input tiles: 256 x 256 heights, rows from the north, at tile coordinates `(x, y)` on zoom z.
6. The grid spans the tiles' bounding rectangle: `tx0 = min x`, `ty0 = min y`, `width = (max x - tx0 + 1) * 256`, `height` likewise. Each tile is copied in at `((x - tx0) * 256, (y - ty0) * 256)`. Tiles missing from the rectangle are left 0 (see bugs).
7. Pixel centres sit at +0.5: `px0 = tx0 * 256 + 0.5`, `py0 = ty0 * 256 + 0.5`.
8. `fromTiles` decodes each RGBA tile with rule 1 and calls `fromHeights`.

### `fromFunction` (tests and offline runs)

9. Pixel box from the bounds' north-west corner `(minX, maxY)` and south-east corner `(maxX, minY)` at zoom z: `px0 = floor(nw.x) - 2`, `py0 = floor(nw.y) - 2`, `width = ceil(se.x) - px0 + 4`, `height = ceil(se.y) - py0 + 4` (a 2-pixel margin each side).
10. `data[row * width + col] = fn(pixelToLocal([px0 + col, py0 + row], z))`. No +0.5 here: the value stored at index (col, row) is the function at exactly that pixel coordinate, which is what rule 4 samples. So `fromFunction(f).sample` reproduces f exactly at those points and bilinearly between them.

### `sample`

11. Local to global pixel (rule 3), minus `px0, py0`.
12. Clamp `fx` to `[0, width - 1.001]` and `fy` to `[0, height - 1.001]`. Outside the grid the height carries on as the edge value; never index out of range; always finite when the data is.
13. Bilinear between the four surrounding values: across x on the upper row and the lower row, then across y.

### `demTilesFor`

14. `tilesCovering(proj, bounds, z)` (geo.ts): tile x range from the north-west corner's pixel x / 256 to the south-east's, y likewise, each floored and clamped to `[0, 2^z - 1]`.
15. Return every tile in that range, rows (y) outer, columns (x) inner. tiles.ts counts these to pick a zoom (it steps the zoom down while there are more than 300 Terrarium or 200 state tiles), so the count must be exactly the covering rectangle.

## Neighbours (not in this module; for context)

### Where the DEM comes from (tiles.ts `loadDem`)

- `track.ts` asks for two DEMs: `landDem` over the route and area grown by `corridor + terrainBlend + 60` at `demZoom` (default 14), and `landFarDem` over them grown by `horizon + 1000` (`BACKDROP_CHUNK`) at `min(demZoom, 12)` when there's a horizon (else the same DEM).
- Terrarium (AWS terrain tiles) at `min(15, zoom)`, stepped down to no lower than 10 while over 300 tiles.
- Where a state bare-earth model's box takes in the bounds' centre (WA: Geoscience Australia 5 m LiDAR, served from `public/dem/wa/15` as Terrarium PNGs; also Qld, NSW, Vic): state tiles at zoom 16 when `zoom >= 14`, else 13, stepped down to no lower than `min(15, zoom)` while over 200 tiles. WA tiles finer than 15 are upsampled from their zoom-15 parent. Each model fills what the ones before left; anything still unusable (non-finite, or outside -100..9000 m) comes from Terrarium at that pixel's centre. Then `DemGrid.fromHeights(...).sample`.
- Over the sea, `coast.ts` `withSeabed` wraps the DEM. Not this module's business.

### Smoothing (road.ts `applyElevation`)

- The route's centre heights: the DEM at every sample, then a Gaussian along the road, sigma `elevationSmoothing / spacing` samples (15 m / 2 m by default), kernel radius 3 sigma, wrapping on closed routes and renormalised at open ends (`polyline.ts` `gaussianSmooth`; sigma under 0.5 samples does nothing).
- Each roundabout's `hc` is the DEM at its centre (unsmoothed); every sample is eased to the ring's height (`ringHeight` at its clamped radius) with weight `1 - smoothstep((d - outer) / 30)`, so approaches meet the level ring over 30 m.
- The terrain spec's ground function then blends from these road heights back to the raw DEM.

## Known bugs to fix, not copy

1. **Missing Terrarium tiles become a 128.5 m plateau.** tiles.ts fills a missing tile (404, or a host given up on after repeated failures) with RGBA all 128 "as sea level", but rule 1 on (128, 128, 128) gives 128.5 m. Sea level in Terrarium is (128, 0, 0). With rule 2 (alpha 0 is no data) the fix is for the caller to fill with transparent pixels and for `fromHeights` / `fromTiles` to fill NaN cells (bug 2 below); or to fill with (128, 0, 0, 255). Raise it with the lead: it's in tiles.ts, but the rewrite of this module is the moment to settle the contract.
2. **NaN handling.** `fromHeights` copies whatever it's given; a NaN anywhere makes every sample touching it NaN, and NaN heights go straight into mesh positions. The new `fromHeights` should replace non-finite values: from the nearest finite value in the same row, then column, else 0 (sea level), and report how many it filled (so the pipeline's missing-data warning can say so). Tiles missing from the rectangle should be treated the same way rather than silently left 0.
3. **`profileAlong` lies.** Its comment says "sampled then smoothed"; it only samples, and nothing calls it. Delete it (smoothing is `applyElevation`'s job).
4. **Two decoders** (rule 2).

## Call sites

- `src/services/tiles.ts`: `DemGrid.fromTiles`, `DemGrid.fromHeights`, `demTilesFor`, `HeightFn`.
- `HeightFn` type: track.ts, terrain, backdrop, road, roadMesh, sideStreets, sceneGround, buildings, furniture, utilities, armco, coast, carpark, bayGround, parkedCars, parkedPlacement, padClear, fences, shops, lots, kerbside, farm, farmRoadsides, raceDress, landmarkLayer.
- `DemGrid.fromFunction`: about 20 test files (track, area, layouts, armco, farm, kerbside, zones, roundabout, streets, origin, gates, kangaroo, unsealed, trafficLights, sceneGround, networkCoreBuild, pathGround, farmRoadsides). Keep the signature `(proj, z, bounds, fn)`.
- `scripts/polish/demTiles.ts`: imports tiles.ts's array decoder.

## Tests to write

1. Terrarium: (128, 0, 0) is 0 m; (0, 0, 0) is -32768; (128, 1, 128) is 1.5 m; alpha 0 gives NaN; the array decoder agrees with the per-pixel one.
2. `fromFunction` with a tilted plane `a + bx + cy`: `sample` reproduces it within 1 mm anywhere inside the bounds (bilinear is exact on a plane).
3. `fromFunction` with a bump: exact at pixel points, bilinear between.
4. `fromHeights` with two tiles side by side (x and x+1): continuous across the seam; a value placed at a known pixel of the second tile is returned at that pixel's centre (`pixelToLocal(tile * 256 + col + 0.5, ...)`).
5. `fromHeights` with tiles at (x, y) and (x+1, y+1) only: the gaps are filled (not 0) and the fill count reported.
6. Sampling beyond the grid returns the edge value, never NaN or undefined.
7. A NaN in the input heights doesn't reach `sample`'s output.
8. `sample` works detached from its grid.
9. `demTilesFor`: count equals the covering rectangle; rows outer, columns inner; clamped at the world's edge at a low zoom.
