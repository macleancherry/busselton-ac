# Spec: route raster sampler (`src/services/raster.ts`)

Status: spec for a clean rewrite ("Owning the code", ROADMAP.md). Write the new module from this page, without the old file open. Tests are written fresh from "Tests to write". The file is on `UPSTREAM-FILES.txt`.

## What the module is for

Road tracing (`src/core/trace.ts`), kerb and footpath detection, paint-line reading and the photo road surface all need the aerial photo's colour at any point near the road, at the sharpest zoom the imagery has. This module downloads only the imagery tiles within reach of a set of lines (the route, or an area build's streets) and returns a **sampler**: a function from local metres to RGB in [0, 1], bilinear between pixel centres, `null` where there's no photo.

It runs in the build Web Worker (uses `OffscreenCanvas`, `ImageBitmap`). Network, retries, parallel limits and the session's give-up-on-a-host rule live in `src/services/tiles.ts` (`loadBitmap`), not here.

## Public API (keep the name and shape)

```ts
async function loadRouteRaster(
  proj: LocalProjection,          // src/core/geo.ts
  path: Vec2[] | Vec2[][],        // one line, or several, in local metres
  reach: number,                  // metres either side of the lines to cover
  chain: ImagerySource[],         // imagery sources, best first (tiles.ts imageryChain); never empty
  maxZoom = 20,
  onProgress?: (done: number, total: number) => void,
): Promise<RasterSampler | null>
```

`RasterSampler` (defined in `src/core/trace.ts`, not here): `((x, y) => [r, g, b] | null) & { display?: RasterSampler }`, x east and y north in local metres, channels in [0, 1]. `display` is a colour-balanced variant for texturing; detection uses the raw sampler (a transform fitted to bushland tints asphalt green). `displayOf(r)` in trace.ts returns `r.display ?? r`.

### Callers (grep, 31 Oct 2026)

Only `src/services/pipeline.ts`, which wraps it as `DataSources.raster(proj, path, reach, maxZoom?)`:
`loadRouteRaster(proj, path, reach, chain, maxZoom ?? 20, (d, t) => traceProgress("Tracing the road in the aerial photos (<pct>%)"))`, with `chain = imageryChain(route midpoint, job.imagerySource)`.

`src/core/track.ts` calls `sources.raster`:
- line ~488, when `opts.traceRoads`: `raster(proj, plan.samples.map(s => s.pos), reach)` with `reach = max(16, 1.5 x widest sample width)`, default max zoom 20.
- line ~761, area builds: `raster(proj, farStreets /* Vec2[][] */, 14, 19)` for streets more than 60 m from the route; the two samplers are then combined (`a(x, y) ?? b(x, y)`, and the same for `display`).

The sampler then goes to `traceRoad`, `traceSideStreets`, `kerbEvidence`, `stripPhotoTexture`, `readVerge`, `paintCandidates`, `photoSurface` (all core).

## Dependencies it uses (keep using, don't reimplement here)

- `src/services/tiles.ts`: `IMAGERY[src].maxZoom` (esri 19, qld 20, nsw 21, wa 20), `tileUrl(src, z, x, y)`, `loadBitmap(url): Promise<ImageBitmap | null>` (null on 404 or a host given up on; may throw after retries), `colourBalance(src, z, x, y): Promise<ColourTransform | null>` (memoised per tile; non-null only for sources matched to Esri, today only `nsw`).
- `src/core/geo.ts`: `proj.metresPerPixel(z)`, `proj.localToPixel(p, z)` (global Web Mercator pixel coordinates at zoom z, 256 px tiles, y down), `proj.origin`, `lngLatToPixel(lngLat, z)`.
- `ColourTransform` (`src/core/colour.ts`): `{ gain: [3], offset: [3] }`, applied per channel to 0..255 values as `clamp(v * gain + offset, 0, 255)`.

## Behaviour

1. **Zoom.** `z = min(maxZoom, IMAGERY[chain[0]].maxZoom)`. `mpp = proj.metresPerPixel(z)`. Reach in pixels `r = reach / mpp`.
2. **Lines.** If `path[0]` is itself an array of points (i.e. `path[0][0]` is an array), `path` is a list of lines; otherwise it's one line. An empty path or empty lines contribute nothing.
3. **Tiles needed.** Walk each line's segments, sampling points every ≤ 5 m: for segment a→b, `steps = max(1, ceil(|b - a| / 5))`, points `a + (b - a) k / steps` for k = 0..steps-1; the last point of each line is included too (the old code did it as a zero-length final segment). For each sample point, convert to global pixels `(gx, gy)` at z and add every tile `(tx, ty)` with `floor((gx - r) / 256) ≤ tx ≤ floor((gx + r) / 256)` and the same for y (a square of reach, not a circle).
4. **Cap.** If more than **4000** tiles are needed, return `null` (tracing is skipped rather than exhaust memory: 4000 tiles x 256 KB RGBA is about 1 GB). Fix: also report it (see Bugs 1).
5. **Fetch each tile, falling back through the chain.** For each needed tile, try sources in chain order:
   - `sz = min(z, IMAGERY[src].maxZoom)`, `up = z - sz`. Load the source's tile `(sz, tx >> up, ty >> up)` (the coarser parent when the source can't reach z). A load that returns null or throws counts as missing: try the next source.
   - From the loaded bitmap, take the sub-square for this tile: `span = 256 >> up`, offset `sx = (tx - ((tx >> up) << up)) * span`, `sy` likewise, scaled to 256 x 256 (browser bilinear smoothing on upscaling, the canvas default). Read its RGBA.
   - Colour look for this tile: `zb = min(sz, 18)`; `colourBalance(src, zb, tx >> (z - zb), ty >> (z - zb))` (one transform per z18 tile, about 150 m, the same the terrain textures use, so neighbours agree). Store it if non-null.
   - Stop at the first source that gave a bitmap. If none did, the tile stays missing.
   - Report progress after each tile (found or not): `onProgress(done, total)` with `total` = tiles needed.
   - Fetch all tiles concurrently (loadBitmap limits parallelism itself). Results are keyed by tile, so arrival order mustn't matter.
6. If no tile at all was loaded, return `null`.
7. **Pixel lookup.** At global pixel `(px, py)` (integers): tile `(floor(px / 256), floor(py / 256))`, offset inside it; missing tile → null. Raw: the stored R, G, B. Display: with the tile's transform applied (clamped to 0..255); tiles without a transform give raw values.
8. **Sampling.** For local `(x, y)`: `gx = originPx.x + x / mpp - 0.5`, `gy = originPx.y - y / mpp - 0.5`, where `originPx = lngLatToPixel(proj.origin, z)` (so pixel centres sit at integer + 0.5). Bilinear between the four pixels `(x0, y0)`, `(x0+1, y0)`, `(x0, y0+1)`, `(x0+1, y0+1)` with `x0 = floor(gx)`, `fx = gx - x0` (same for y). If any of the four is missing, return null. Return each channel / 255.
9. **Result.** The raw sampler. If at least one tile has a colour transform, attach `display` = the same sampler using display pixels. Otherwise no `display` property (callers fall back to raw). In WA (Landgate then Esri) there's never a transform today, so Busselton builds get raw only.

## Caching

None in this module beyond memory for one call. Downloads are cached outside it: `colourBalance` memoises per tile for the session; headless builds answer every https request from `out/cache` (14 days, keyed by a hash of method, URL and body) or a frozen snapshot (`scripts/headless/build-track.mjs`). The tile URLs must therefore stay **byte-identical** for the same tile (they come from `tileUrl`; don't add query parameters or reorder), or snapshots stop replaying.

## Bugs and weak spots (fix, don't copy)

1. **Silent give-up.** Over 4000 tiles returns null with no message, so a long route quietly loses its trace. Fix: keep the cap but tell the caller (e.g. a `warn` callback or a thrown, caught error that pipeline turns into a `warnMissing` "aerial trace skipped: N tiles") so the headless build's missing-data report shows it.
2. **Bitmaps never closed.** Call `bmp.close()` after reading it (ImageBitmaps hold GPU/CPU memory until collected; the machine is small).
3. **Each tile keeps a full RGBA copy** (4 bytes/pixel) even though only RGB is read. Store RGB (3 bytes) or pack into one `Uint8Array` per tile to cut memory by a quarter. Optional.
4. **One shared canvas across concurrent async tiles.** Safe today only because the draw and read happen with no `await` between them; keep that true (draw then read synchronously), or give each tile its own canvas.
5. **Edge nulls.** A missing neighbour tile makes the last half pixel of a tile null. Acceptable (tiles beyond reach are irrelevant), but don't "fix" it by inventing colour.
6. A tile found only as a coarse parent (e.g. Esri z19 under a z20 request) is upscaled; the tracer then sees a blurrier road there. Fine; note it in progress text if ever needed.

## Could be deleted?

No. Every build with `traceRoads` (on by default and in every Busselton route) needs it.

## Tests to write

Make the module testable in Node by injecting the two browser pieces: a tile loader `(src, z, x, y) => Promise<{ rgba: Uint8ClampedArray } | null>` and the colour lookup, defaulting to the real `loadBitmap`/canvas/`colourBalance` path in the browser. Then, with a fake loader and a `LocalProjection` at Busselton (-33.65, 115.35):

1. **Tile set.** A straight 100 m line with reach 10 at z20 asks exactly for the tiles whose pixel squares come within r of a sample point (compute the expected set independently in the test); duplicates fetched once.
2. **Multi-line input.** `Vec2[][]` with two separate lines asks for the union of both lines' tiles; a single `Vec2[]` and the same line wrapped in an array ask for the same tiles.
3. **Cap.** A line needing > 4000 tiles returns null without calling the loader.
4. **Zoom.** `maxZoom` 19 with chain `["wa", "esri"]` uses z19; chain `["esri"]` with maxZoom 20 uses z19 (Esri's limit).
5. **Fallback.** First source returns null for some tiles: those come from the next source; a source whose max zoom is below z gets asked for the parent tile `(z-1, x>>1, y>>1)` and the right quadrant is used (paint each parent quadrant a different colour and check).
6. **Sampling.** With tiles of a known gradient, the sampler at a pixel centre returns that pixel / 255; halfway between two pixel centres returns the mean; y increases northwards (local +y reads a smaller global pixel row).
7. **Nulls.** A point over a missing tile returns null; all tiles missing returns null from `loadRouteRaster`.
8. **Display.** No transforms: result has no `display`. With a transform `{gain: [2,1,1], offset: [0,0,0]}` on one tile: `display` doubles red there (clamped at 255), raw is unchanged, other tiles' display equals raw.
9. **Progress.** `onProgress` called once per needed tile, last call `(total, total)`.
10. **Order independence.** A loader that resolves tiles in random order gives identical samples.

Browser check (optional, Playwright): one real Landgate tile near the Busselton foreshore loads and the sampler returns non-null colours inside it.

## Rewrite notes (31 Oct 2026)

- `loadRouteRaster` takes a 7th argument `deps: { loadTile?, colourBalance?, warn? }`. The default loader draws the bitmap to a canvas, reads it and closes it; the parent-tile crop and upscale are done in JS (bilinear between pixel centres, clamped at the tile edge) for both the browser and tests. Tiles are stored as RGB.
- Over 4000 tiles calls `warn` ("aerial trace skipped: N tiles"); pipeline passes `warnMissing`, so a headless build stops with MISSING DATA unless `ALLOW_MISSING_DATA=1`.
