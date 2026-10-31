# Spec: imagery and elevation tiles (`src/services/tiles.ts`)

Status: spec for a clean rewrite ("Owning the code" in ROADMAP.md). `tiles.ts` is on `UPSTREAM-FILES.txt`. Written from the old code on 31 Oct 2026 so a separate session can write a fresh module without the old file open. Describe, don't copy: the only literal text here is what outside systems force (URLs, whose bytes are cache and snapshot keys).

Runs in the browser: in the build worker (`src/ui/buildWorker.ts`) or on the page. Needs `fetch`, `createImageBitmap`, `OffscreenCanvas`, `ImageData`. No DOM. Not run in Node tests except the pure helpers (see "Tests to write").

## What the module is for

1. **Aerial imagery**: the source list (Esri, Queensland, NSW, Landgate WA), tile URLs, a chain of sources best-first for a place, loading tiles politely (parallel limit, retries, giving up on dead hosts), and compositing one DDS texture per terrain chunk.
2. **Colour balance**: matching NSW imagery's colour cast to Esri's.
3. **Elevation**: a height sampler (`HeightFn`) for a box, from global Terrarium tiles plus state bare-earth models where they cover it (WA: Geoscience Australia 5 m LiDAR, served from the repo as Terrarium PNGs).

The DEM grid itself (`DemGrid`, Terrarium decoding, `fillGaps`, `demTilesFor`) lives in `src/core/elevation.ts` (already rewritten, docs/specs/elevation.md). Use it; don't re-implement it here.

## Public API (keep these names and shapes)

```
IMAGERY: { esri, qld, nsw, wa }: each { label: string; template: string; credit: string; maxZoom: number }   (readonly)
type ImagerySource = "esri" | "qld" | "nsw" | "wa"
tileBbox(z, x, y): string
tileUrl(src: ImagerySource, z, x, y): string
imageryChain(at: LngLat, pick: "auto" | ImagerySource = "auto"): ImagerySource[]
colourBalance(source, z, x, y): Promise<ColourTransform | null>
loadBitmap(url: string, attempts = 3): Promise<ImageBitmap | null>
type DemSource = "qld" | "nsw" | "vic" | "wa"
DEM_CREDIT: Record<DemSource, string>
DEM_LABEL: Record<DemSource, string>
decodeTerrarium(rgba): Float32Array        // re-export of core/elevation.ts decodeTerrariumTile
upsample(parent: Float32Array, ox, oy, up): Float32Array
loadDem(proj, bounds, zoom, onTile?, used?: Set<DemSource>): Promise<HeightFn>
loadChunkImagery(proj, chunk, zoom, size, previews: Map<string, OffscreenCanvas>, chain = ["esri"], used?: Set<ImagerySource>)
  : Promise<{ data: Uint8Array; ext: "dds"; rgba: Uint8ClampedArray } | null>
```

`hostDown(url)` is exported today but nothing calls it: drop it. `TERRARIUM_URL` is exported but only used inside; it may stay private.

## Callers (from `grep`, 31 Oct 2026)

- `src/services/pipeline.ts`: `imageryChain`, `loadDem` (as the build's `dem` source, with a `used` set and no `onTile`), `loadChunkImagery` (as the `imagery` source, with the chain and a `used` set), `IMAGERY[k].credit`, `DEM_CREDIT`, types.
- `src/services/raster.ts`: `loadBitmap(tileUrl(...)).catch(() => null)`, `colourBalance`, `IMAGERY`, `tileUrl`.
- `src/ui/main.ts`: `IMAGERY.esri.template` for the Leaflet base layer, `tileUrl` for a Leaflet layer per source (so `{bbox}` sources work), `IMAGERY[src].maxZoom` and `.label`, `DEM_LABEL`.
- `scripts/polish/demTiles.ts`: `decodeTerrarium` (array in, Float32Array out, NaN at alpha 0).
- Tests: `test/wa.test.ts`, `test/wa-imagery.test.ts` (`imageryChain`, `tileBbox`, `tileUrl`, `decodeTerrarium`), `test/demtiles.test.ts` (`upsample`), `test/elevation.test.ts` (`decodeTerrarium` from here equals core's).

## Imagery sources

| key | label | URL shape | credit (meaning) | maxZoom |
| --- | --- | --- | --- | --- |
| esri | Esri World Imagery | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | Esri World Imagery (Esri, Maxar, Earthstar Geographics, and the GIS User Community) | 19 |
| qld | Queensland Government | `https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestStateProgram_AllUsers/ImageServer/tile/{z}/{y}/{x}` | State of Queensland aerial imagery (latest public State Program; includes material (c) Planet Labs) | 20 |
| nsw | NSW Government | `https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/{z}/{y}/{x}` | NSW Spatial Services imagery ((c) Department of Customer Service NSW) | 21 |
| wa | Landgate WA (Locate) | `https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Locate/ImageServer/exportImage?bbox={bbox}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&interpolation=RSP_BilinearInterpolation&f=image` | Locate mosaic (c) Western Australian Land Information Authority (Landgate), personal use | 20 |

Note `{z}/{y}/{x}` (row before column) on the ArcGIS tile caches. Landgate's Locate is an ImageServer with no tile cache: each web-map tile is asked for by its Web Mercator box. Keep the URL strings byte for byte: the headless build keys its cache and the frozen snapshots on `method + URL + body` (sha256), and the Busselton snapshot holds about 1,300 Landgate tiles under these exact URLs. The labels are shown in the UI (`main.ts` strips " Government" for the stats table); the credits go in the track's README.

### `tileBbox(z, x, y)`

The tile's box in Web Mercator metres as `"xmin,ymin,xmax,ymax"`, each with exactly three decimals (`toFixed(3)`). World width `W = 40075016.68557849`; tile size `W / 2^z`; `xmin = x * size - W/2`; `ymax = W/2 - y * size`; `ymin = ymax - size`; `xmax = xmin + size`. Example: z0 gives `-20037508.343,-20037508.343,20037508.343,20037508.343`.

### `tileUrl(src, z, x, y)`

The source's template with `{z}`, `{y}`, `{x}` replaced (first occurrence each, decimal integers) and `{bbox}` replaced with `tileBbox(z, x, y)` (compute it only when the template has `{bbox}`; a replacer function is fine).

### `imageryChain(at, pick)`

Sources to try, best first, ending with Esri.
- `pick` not "auto": `["esri"]` if pick is esri, else `[pick, "esri"]`.
- "auto": test `at = [lng, lat]` against rough boxes (strict inequalities), in this order, and add each that matches: qld if `-29.3 < lat < -9` and `137.9 < lng < 154`; nsw if `-37.6 < lat < -28.1` and `140.9 < lng < 154`; wa if `-35.4 < lat < -13.5` and `112.8 < lng < 129.1`. Then "esri".
- Examples: Busselton (115.35, -33.65) gives `["wa","esri"]`; Perth `["wa","esri"]`; Sydney `["nsw","esri"]`; Wellington NZ `["esri"]`; the Qld/NSW border strip can give `["qld","nsw","esri"]`.

## Loading tiles: `loadBitmap(url, attempts = 3)`

- **Parallel limit**: at most 6 loads in flight across the whole module (a FIFO queue). The slot is held for the whole load, including backoff waits.
- **Dead hosts**: a per-host failure counter (host = `new URL(url).host`, or the whole string if it doesn't parse). At 6 or more the host is given up for the session: return `null` straight away, before queueing and before each attempt.
- Each attempt: `fetch(url, { mode: "cors", signal: timeout 20 s })`.
  - 404: reset the host's counter to 0, return `null` (an answer: no tile here).
  - other non-2xx: a failure.
  - 2xx: `createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" })` (no colour management: Terrarium heights are raw RGB), reset the counter to 0, return the bitmap.
  - A failure (thrown, timeout, bad status, decode error) adds 1 to the host's counter. Not the last attempt: wait `500 * 2^a` ms (0.5 s, 1 s) and try again. Last attempt: throw `Error("Could not load <url>: <message>")`.
- So callers see: a bitmap, `null` (404 or host given up), or a thrown error after the retries. Imagery callers catch and treat a throw as missing.

## Colour balance: `colourBalance(source, z, x, y)`

- Only sources in the balanced set (just `nsw`: its mosaic can carry a strong blue cast) get a transform; any other resolves `null`.
- Cached per `source/z/x,y` for the session (the promise, so concurrent callers share one fetch).
- Reference: Esri at `zr = min(z, 18)`, `up = z - zr`; the Esri tile `(x >> up, y >> up)` at zr; the part of it covering our tile is the `span = 256 >> up` square at offset `((x - ((x >> up) << up)) * span, (y - ((y >> up) << up)) * span)`, taken unscaled.
- Load both tiles (`loadBitmap`); if either is null, or anything throws, resolve `null`. Otherwise `matchColours(our 256 x 256 RGBA, the reference span x span RGBA)` from `src/core/colour.ts` (already rewritten; it compares statistics, so the sizes may differ).

## Chunk imagery: `loadChunkImagery(...)`

One aerial texture for a terrain chunk (`TerrainChunk`: `key`, `minX, minY, maxX, maxY` in local metres, square), `size x size` pixels, north up.

1. A `size x size` OffscreenCanvas, 2D context with `willReadFrequently`, `imageSmoothingQuality = "high"`.
2. For each source in `chain`, in order (index k):
   - `z = min(IMAGERY[source].maxZoom, zoom)`.
   - Pixel corners at z: `p0 = localToPixel([minX, maxY])` (north-west), `p1 = localToPixel([maxX, minY])`; `scale = size / (p1.x - p0.x)`.
   - Tiles: `tilesCovering(proj, chunk box, z)` (core/geo.ts).
   - Composite mode: the first source draws normally (`source-over`); later sources draw **behind** what's there (`destination-over`), so they only show where earlier ones left the canvas transparent.
   - Start every tile load at once (through `loadBitmap`'s limit), **rows outer (ty), columns inner (tx)**; a thrown load counts as `null`.
   - After all have settled, draw them **in that tile order, not arrival order**. Each tile is drawn at `((tx*256 - p0.x) * scale, (ty*256 - p0.y) * scale)` with width and height `256*scale + 0.5` (the half-pixel overlap hides hairline seams; because tiles overlap, draw order decides the seams, and the same inputs must give the same photo, which frozen snapshots rely on).
   - A drawn tile marks the source used (`used` set and a per-chunk set). A null tile marks the source as having gaps.
   - If the source had no gaps, stop; otherwise go on to the next source (which loads and draws its **whole** tile range behind).
3. If no tile was drawn from any source, return `null` (the build falls back to grass).
4. Fill what's still transparent with olive `#56603f` (drawn behind, `destination-over`).
5. Read the RGBA back. For the sources used in this chunk, in first-use order: ask `colourBalance` for the tile under the chunk's centre at that source's z; at the first that gives a transform, apply it to the whole RGBA (`applyColours`, core/colour.ts), put the pixels back on the canvas, and stop.
6. Keep the canvas in `previews` under `chunk.key` (the 3D preview shows it).
7. Return `{ data: encodeDdsDxt1(rgba, size, size), ext: "dds", rgba }` (core/dds.ts).

## Elevation

### State bare-earth models

Used before Terrarium where they cover: Terrarium (SRTM-derived) measures tree tops.

| key | label | where | box (west, south, east, north) | how |
| --- | --- | --- | --- | --- |
| qld | Qld | `https://spatial-img.information.qld.gov.au/arcgis/rest/services/Elevation/QldDem/ImageServer/exportImage` | 137.9, -29.3, 153.7, -9 | exportImage, float32 blocks |
| nsw | NSW | `https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer/exportImage` | 140.9, -37.6, 153.7, -28.1 | exportImage, float32 blocks |
| vic | Vic | `https://tiles-ap1.arcgis.com/P744lA0wf4LlBZ84/arcgis/rest/services/Vicmap_10m_DEM/ImageServer/tile` | 140.9, -39.3, 150.1, -33.9 | LERC tile cache |
| wa | WA 5 m | the app's own `<BASE_URL>dem/wa` (Vite `import.meta.env.BASE_URL`, default `/`) | 114.98, -33.74, 115.54, -33.52 | static Terrarium PNGs, zooms 10 to 15 (`WA_ZOOMS`) |

Credits (README text; meaning to keep):
- qld: Queensland Digital Elevation Model (c) State of Queensland; (c) Commonwealth of Australia (Geoscience Australia)
- nsw: NSW 5 m elevation (c) Department of Customer Service NSW (Spatial Services)
- vic: Vicmap Elevation 10 m DEM (c) State of Victoria (Department of Transport and Planning)
- wa: Digital Elevation Model of Australia derived from LiDAR 5 m grid (c) Commonwealth of Australia (Geoscience Australia), CC BY 4.0

Each credit is prefixed "Elevation: ". `DEM_CREDIT` and `DEM_LABEL` map key to credit and label.

**WA tiles**: `public/dem/wa/15/{x}/{y}.png`, Web Mercator zoom 15 (about 4 m a pixel here), Terrarium-encoded (`h = R*256 + G + B/256 - 32768`), transparent where there's no data. **Zooms 10 to 14** (`public/dem/wa/<z>/...`) are averaged from the zoom-15 tiles by `scripts/dem/make_wa_overviews.py`: a zoom-z tile is the `2^(15-z)` square of zoom-15 tiles under it, each child decoded to heights and every pixel block averaged (NaN left out; all NaN stays NaN), then re-encoded; rerun it after every cut. Made by `scripts/dem/make_wa_tiles.py` from GA's 5 m mosaic (WA zone 50); its cut boxes are 115.2,-33.74,115.54,-33.56 and 114.98,-33.72,115.2,-33.52 (the capes; the LiDAR stops just west of Dunsborough, so Yallingup and the capes have missing tiles and Terrarium fills in). **`STATE_DEMS.wa.box` must take in every cut box** (the script's docstring says so). The tiles are committed (the one big binary allowed) and are part of a track's frozen inputs even though they aren't in its snapshot (they're fetched over http from Vite, which the headless cache doesn't intercept). Regenerating them changes every WA base.

### `loadDem(proj, bounds, zoom, onTile?, used?)`

1. **Terrarium first, always** (it's the fallback for every gap): see below. Call it T.
2. **Which state models**: those whose box strictly contains the bounds' **centre** (converted to lng/lat), in the table order qld, nsw, vic, wa. None: return T.
3. **State zoom**: start at 16 when `zoom >= 14`, else 13; step down while the covering tile count (`demTilesFor`) is over 200 and z is above `min(15, zoom)`.
4. One NaN-filled 256 x 256 height array per covering tile at that zoom.
5. For each model in order: the pending tiles are those not yet fully usable; none pending, stop. Fetch the model's heights for the pending tiles (below). For each tile it returned with data: mark the model found, and copy its usable values into cells not yet usable (a model fills only what earlier ones left).
   - "Usable" = finite and strictly between -100 and 9000 m.
6. No model found anything: return T.
7. Every cell still not usable gets `T` sampled at that pixel's centre: local point `pixelToLocal([x*256 + col + 0.5, y*256 + row + 0.5], z)`.
8. Add the found models to `used`. Return `DemGrid.fromHeights(proj, z, tiles).sample`.

`onTile(done, total)` reports Terrarium progress; the pipeline doesn't pass one today.

### Terrarium (global)

- URL: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (keep byte for byte; snapshot key).
- z = `min(15, zoom)`, stepped down (not below 10) while `demTilesFor` gives more than 300 tiles.
- Load every covering tile with `loadBitmap` (all at once, under its limit), calling `onTile(++done, total)` as each finishes.
- **No data is no data, never a number**: a tile that comes back `null` (404, or the host given up) becomes a fully transparent RGBA tile, which decodes to NaN, and `DemGrid` fills NaN cells from the nearest data (core/elevation.ts `fillGaps`; `grid.filled` counts them). Never fill a missing tile with a constant: the old code filled with RGB 128 and that read as a 128.5 m plateau. Pixels the server marks transparent are NaN too (core's decoder).
- When `grid.filled > 0`, log a warning with the count (and see "Bugs to fix": also a data warning).
- Return `DemGrid.fromTiles(proj, z, tiles).sample`.

### Fetching one state model's tiles (internal)

Returns a map `"x,y"` to a 256 x 256 Float32Array (rows from the north) or `null` (no data there). A tile whose values are all unusable is `null`.

Failure policy (per model, for the session): a request that throws (network error, timeout, HTTP 5xx) adds 1 to the model's failure count, a success resets it to 0; at 4 the model is skipped for the rest of the session. A thrown request leaves its tiles `null`. Jobs run four at a time (batches of 4 awaited in turn).

- **wa**: tiles at `zw = min(z, 15)`, `up = z - zw`; `zw` below 10 (`WA_ZOOMS[0]`) has no WA tiles: every tile is `null`, nothing fetched. For each requested tile fetch its zoom-zw parent `(x >> up, y >> up)` once (shared promise per parent) from `<base>/dem/wa/<zw>/<px>/<py>.png`; when `up > 0` cut the child out with `upsample(parent, x - (px << up), y - (py << up), up)`.
  - Reading a Terrarium PNG: `fetch` with a 20 s timeout; status 500+ throws; any other non-2xx, **or a content type that isn't PNG**, is `null` (Vite's dev server answers a missing file with `index.html` and status 200); else decode with `createImageBitmap` (no colour conversion, no premultiply), read pixels, `decodeTerrarium` (NaN at alpha 0).
- **vic**: tiles at `zv = min(z, 15)` (the cache is only reliable to 15; the data is 10 m anyway), parents shared and cut with `upsample` as for wa. URL `<vic url>/<zv>/<py>/<px>` (row before column). Response: status 500+ throws; other non-2xx is `null`; else a LERC blob decoded with the `lerc` package (WebAssembly; load it lazily on first use, `load({ locateFile })` pointing at the bundled `lerc-wasm.wasm` URL). The block is 257 x 257 corner samples (smaller: `null`); a pixel's height is the mean of its four corners; a corner the mask marks invalid is NaN (so the pixel is NaN).
- **qld, nsw** (exportImage): group the requested tiles into 8 x 8-tile blocks by `floor(x/8), floor(y/8)`; one request per block covering the bounding rectangle of its tiles (nx x ny tiles from tx0, ty0):
  - URL: `<model url>?bbox=<xmin>,<ymin>,<xmax>,<ymax>&bboxSR=3857&imageSR=3857&size=<nx*256>,<ny*256>&format=bip&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`, the box in Web Mercator metres from the tile grid (as `tileBbox` but over the block), numbers written with JavaScript's default number-to-string (not fixed decimals; keep it if you want old cache entries to hit).
  - 45 s timeout; status 500+ throws; other non-2xx is `null`; the body is raw little-endian float32, rows from the north, possibly padded at the end: shorter than `w*h*4` bytes is `null`, else take the first `w*h` floats.
  - Each tile is copied out of the block at `((x - tx0) * 256, (y - ty0) * 256)`.

### `upsample(parent, ox, oy, up)`

The `(ox, oy)` sub-tile, `2^up` to a side, of a 256 x 256 tile, resampled bilinearly to 256 x 256. With `span = 256 >> up` and `k = 2^up`: child pixel (c, r) has its centre at parent index-space position `fx = ox*span + (c + 0.5)/k - 0.5`, `fy` likewise (parent pixel centres at integers), each clamped to `[0, 254.999]`; bilinear between the four surrounding parent values. (At a tile's outer edge the clamp holds the edge value: there's no neighbour tile to blend with. Keep it: the WA bases are built with it.)

`test/demtiles.test.ts` checks: a parent that's a plane gives the same plane on the child at the matching positions.

## Edge cases

- Bounds whose centre is outside every state box but which reach into one get no state model (centre rule). A route from Busselton to Margaret River, centred south of -33.74, gets Terrarium only. See "Bugs to fix".
- A state tile partly covered: kept, its gaps filled by the next model then Terrarium.
- Overlapping boxes (Qld and NSW around the border): the first in table order fills first.
- Very long roads: Terrarium steps down to z10; state models step down to their floor; beyond that the counts can exceed 300/200 (no hard stop).
- A chunk whose sources all 404 (outside every source's coverage, which for Esri is nowhere in practice): `null`, grass.
- A source that's down mid-build: after 6 failures its host is skipped; chunks fall through to the next source (Esri), silently today (see bugs).

## Bugs to fix (rather than copy)

1. **Fixed (2026-10-31): WA tiles below zoom 15 were never found.** When the state zoom is 13 (the far/horizon DEM, which `track.ts` asks for at `min(demZoom, 12)`, or any `demZoom < 14`) the WA branch asks for `dem/wa/13/...`, which doesn't exist; Vite answers `index.html`, the tile is `null`, and the whole horizon comes from Terrarium. Build coarser WA tiles from their zoom-15 children: a zoom-z tile is the `2^(15-z)` square of zoom-15 tiles under it, each child pixel block averaged down (ignore NaN in the average; all NaN stays NaN). This changes the far terrain of every WA track: land it as a deliberate base upgrade (`scripts/upgrade/base.mjs build|accept`), not silently.
2. **Missing elevation is silent.** Terrarium tiles that came back `null`, and state-model requests that threw (as opposed to answering "no data"), only reach the console. Call `warnMissing` (src/services/dataWarnings.ts) so the headless build stops with MISSING DATA and is built again: e.g. `"<n> elevation tiles (Terrarium)"`, `"elevation: <label> model unreachable"`. Not for WA tiles that are simply absent (outside the cut area, a 404 or non-PNG answer): that's expected.
3. **A Terrarium tile that throws aborts the whole build** (`loadBitmap` throws after 3 attempts and nothing catches it), while a `null` one is filled. Treat both the same: no data, filled, and a data warning (bug 2). The headless retry loop then rebuilds.
4. **Missing imagery is silent.** When the last source in the chain still had gaps, the chunk gets olive patches with no warning. Count such chunks and `warnMissing("<n> aerial photo chunks with gaps")`. Don't add requests to do it (the replay must ask for the same URLs or fewer).
5. **Colour balance repaints the whole chunk**, including pixels from other sources and the olive fill. Only matters in NSW; acceptable to keep, but if fixed, apply the transform only to pixels drawn from the balanced source (needs a per-source mask). Not needed for WA.
6. State-model requests have a single attempt each (no retry before counting a failure). Give them the same retry as other downloads (`fetchRetry` in dataWarnings.ts: 4 attempts, backing off 1, 3, 7 s on network errors, 429 and 5xx; 404 is an answer).
7. `hostDown` is dead code: drop it.

Consider, but check with the lead first (changes which DEM a track gets): choose state models by **overlap** of the bounds with the box rather than by the centre (then a model that covers part of the bounds fills that part, and Terrarium the rest, which the gap filling already handles).

## Determinism

- Imagery tiles drawn in tile order (rows, then columns), never arrival order.
- Sources tried in chain order; models in table order; nothing depends on timing except which requests fail.
- `used` sets are filled as data arrives; the pipeline joins credits from them. Don't rely on their order for anything written to the track (see pipeline.md).

## Tests to write

Pure (Node, no network):
1. `tileBbox`: z0 gives the world box with three decimals; z1 tile (1,0) is `0.000,0.000,20037508.343,20037508.343`; a z20 Busselton tile has width `W/2^20` to the millimetre.
2. `tileUrl`: Esri/Qld/NSW put `{z}/{y}/{x}` in that order; WA has `bbox=<tileBbox>` and no braces left; every template's host and path are exactly the table's.
3. `imageryChain`: Busselton and Perth `["wa","esri"]`, Sydney `["nsw","esri"]`, Brisbane `["qld","esri"]`, a Qld/NSW border point `["qld","nsw","esri"]`, Wellington `["esri"]`; `pick = "esri"` gives `["esri"]`, `pick = "nsw"` gives `["nsw","esri"]` anywhere.
4. `decodeTerrarium` (re-export) equals core's `decodeTerrariumTile`: alpha 0 is NaN, `(128,0,0,255)` is 0 m.
5. `upsample`: a plane `h = a + b*col + c*row` comes back as the plane at the child centres (within 1e-4) away from the clamped edges; `up = 0` is the identity; the edge clamp holds the edge value.
6. `DEM_CREDIT` and `DEM_LABEL` have all four keys; every credit starts "Elevation: ".
7. `STATE_DEMS.wa.box` contains both of `make_wa_tiles.py`'s cut boxes (read them from the script's docstring or keep a list in the test).

With stubbed `fetch` / `createImageBitmap` / `OffscreenCanvas` (vitest; small fakes):
8. `loadBitmap`: 404 gives null and resets the host count; three 500s throw after waits of 0.5 s and 1 s (fake timers); after 6 failures on a host, further calls return null without fetching; no more than 6 fetches in flight at once.
9. `loadDem` with no state model (a point in NZ): only Terrarium URLs requested, at `min(15, zoom)`, stepping down while over 300 tiles.
10. `loadDem` in WA at zoom 14: Terrarium plus `dem/wa/15/...` parents (each parent fetched once for its four z16 children); a WA tile with transparent pixels is filled from Terrarium at those pixels only; `used` gets `"wa"`; a non-PNG answer counts as no data.
11. A Terrarium tile that 404s gives a grid filled from its neighbours (not 128.5 m, not 0 when neighbours exist) and a data warning.
12. Bug 1: in WA at zoom 12 (the far DEM), z13 WA tiles are built from their zoom-15 children (mean of each block) and `used` gets `"wa"`.
13. `loadChunkImagery`: tiles drawn in row-major order whatever order the fetches resolve in (record the `drawImage` calls); a WA gap is filled from Esri drawn behind; all-null gives `null`; the result is DDS (`DDS ` magic) of `size x size`; `previews` has the canvas under the chunk key.
14. exportImage block grouping: 10 x 3 tiles starting at an x and y divisible by 8 make two requests with `size=2048,768` and `size=512,768`; a short body gives null tiles.
