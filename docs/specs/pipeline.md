# Spec: the build pipeline (`src/services/pipeline.ts`)

Status: spec for a clean rewrite ("Owning the code" in ROADMAP.md). `pipeline.ts` is on `UPSTREAM-FILES.txt`. Written from the old code on 31 Oct 2026 so a separate session can write a fresh module without the old file open.

The whole build from fetching map data to the finished track files. No DOM: it runs in the build worker (`src/ui/buildWorker.ts`) so the page stays responsive, or on the page itself where workers can't draw (no `OffscreenCanvas`). Everything the page knows reaches it through the `BuildJob`; new data sources the fork adds go here, not in `main.ts` (CLAUDE.md, code map).

## Public API (keep these names and shapes)

```
interface BuildJob {
  coords: LngLat[];                     // the routed centreline
  roundabouts: RoundaboutHint[];        // from the router
  opts: Partial<BuildOptions>;
  token: string;                        // Mapillary client token, or "" for none (never logged or stored here)
  imagerySource: ImagerySource | "auto";
  placeMeta: { country?: string; city?: string };
  houseLooks?: DataSources["houseLooks"];          // non-null element type of buildTrack's houseLooks
  landmarks?: { name: string; at: [number, number] }[];
}
interface BuildOutcome {
  result: TrackResult;
  chunkImages: Map<string, OffscreenCanvas>;   // terrain photos as drawn, for the 3D preview
  usedImagery: ImagerySource[];
  usedDem: DemSource[];
  widthFallback: boolean;                      // no width data: the road is the default width
  seen: number;                                // Mapillary objects found
  seenError: string;                           // Mapillary's error message, or ""
  missing: string[];                           // data that never arrived after retries
}
type Report = (stage: string, fraction?: number) => Promise<void>;
runBuild(job: BuildJob, report: Report, traceProgress: (text: string) => void): Promise<BuildOutcome>
```

The job and outcome cross a worker boundary (structured clone): keep them plain data. The worker strips `chunkImages` (sends ImageBitmaps instead) and transfers the result's big buffers.

## Callers (from `grep`, 31 Oct 2026)

- `src/ui/buildWorker.ts`: `runBuild(e.data, progress => post, text => post trace)`; posts `{ type: "done", outcome (without chunkImages), images }`, or `{ type: "error", message }`.
- `src/ui/main.ts`: builds the `BuildJob` (opts from the UI controls and `window.__buildOptions`; `houseLooks`/`landmarks` from `window.__houseLooks`/`__landmarks`, set by the headless build), runs it in the worker or on the page, shows `usedImagery`, `usedDem`, `widthFallback`, Mapillary `seen`/`seenError` and `missing`; exposes `window.__app.dataWarnings()` = the last outcome's `missing`.
- `scripts/headless/build-track.mjs` (through the page): stops with "MISSING DATA: ..." and no zip when `dataWarnings()` is non-empty, unless `ALLOW_MISSING_DATA=1`. Watches `#progress-text` and stops a build with no progress for 10 minutes (so every long stage must report).

## Inputs it wires together

Services (keep using them; their own specs cover them): `osm.ts` (`fetchOsm`, `fetchPierFeatures`, `widthLookup`), `vectorTiles.ts` (`fetchTileFeatures`, `fetchCoast`, `classWidths`, `roadClassLookup`), `tiles.ts` (`imageryChain`, `loadDem`, `loadChunkImagery`, `IMAGERY`, `DEM_CREDIT`), `mapillary.ts` (`fetchSeen(bbox, token)`), `landcover.ts` (`fetchFarmland(pts, reach)`), `raster.ts` (`loadRouteRaster(proj, path, reach, chain, maxZoom, onProgress)`), `art.ts` (`renderArt`), `signs.ts` (`drawSigns`), `dataWarnings.ts` (`clearDataWarnings`, `dataWarnings`, `warnMissing`). Core: `buildTrack` (track.ts), `areaRings` (area.ts), `pathKind` (paths.ts), `isUnsealed` (unsealed.ts).

## Rules

### 1. Setup

- `chain = imageryChain(coords[floor(n/2)], job.imagerySource)` (the route's middle point).
- `rings = areaRings(opts.area)` (polygons with 3+ points; `area` may be one polygon or several).
- `box` points = the route plus every ring's points when there are rings, else the route. Everything fetched by area uses `box`; Overpass gets the route and the rings separately.
- `await report("Fetching OpenStreetMap data")`, **then** `clearDataWarnings()` (warnings are per build; the list is module state in whichever context runs the build).

### 2. Fetch (in parallel)

Start, without awaiting:
- **Farmland** only when `opts.farmland`: `fetchFarmland(box, (opts.corridor ?? 90) + 20)`; a rejection becomes `warnMissing("farmland tiles (vineyards, paddock fences)")` and `undefined`.

Then await all four together:
- **OSM**: `fetchOsm(coords, rings, { cattleGrids: !!opts.farmRoadsides, trafficSignals: opts.trafficLights !== false })`. Cattle grids only when asked and signals in their own query: the main Overpass query is a cache and snapshot key, so a build with those off must send the same bytes as before (osm.md, "Snapshot rules"). Never pass other options into the main query.
- **Vector tiles**: `fetchTileFeatures(paddedBounds(box, (opts.buildingRadius ?? 250) + 50))`; a rejection becomes `warnMissing("all map tiles (buildings, streets, shops)")` and `null`.
- **Mapillary** only with a token: `fetchSeen(paddedBounds(box, (opts.corridor ?? 90) + 20), token)`; a rejection sets `seenError` to its message and gives `[]` (not a data warning: Mapillary is optional). No token: `[]`.
- **Coast** unless `opts.sea === false`: `fetchCoast(paddedBounds(box, (opts.horizon ?? 1500) + 1200))`; a rejection becomes `warnMissing("all coast tiles (sea, piers, beaches)")` and `undefined`.

`paddedBounds(points, metres)` = `[west, south, east, north]` of the points grown by `metres`: `dLat = m / 111320`, `dLng = m / (111320 * cos(lat of the first point))`.

### 3. Combine

- Buildings: when tiles came, `osm.features.buildings = tiles.buildings` (OSM's own query asks for none).
- Crossings, only when `opts.armco`: `bridges` = the `pts` of every road in `osm.roads` then `tiles.roads` whose `brunnel` is `bridge` and whose `cls` starts with motorway, trunk, primary, secondary, tertiary, minor, service or track; `waterways` = `tiles.waterways` or `[]`.
- Unsealed: when tiles came, append the tiles' roads with `cls !== "path"` and `isUnsealed(surface, cls)` to `osm.features.unsealed`.
- Jetty: `pierPts` = the first ring of every coast pier, flattened. When there are any (and `sea !== false`): `await fetchPierFeatures(paddedBounds(pierPts, 40))` (one box over all piers in the coast box); else undefined.
- Widths: `opts.widthOverride` set: no `widthAt`. Else Overpass's `osm.widthAt`; else, when the tiles have drivable roads, `widthLookup(classWidths(tiles.roads), coords[0].lat)`; else none.
- Area streets (`streets.lines`): with no rings or no `osm.roads`, the tiles' roads as they are. Otherwise: keep every tile road whose class isn't one of the classes present in `osm.roads`, or whose middle point (`pts[floor(n/2)]`) is outside every ring; then add every `osm.roads` road whose middle point is inside a ring. (Inside an area, streets come from OSM itself, exact geometry; the tiles' lines can sit metres off and leave a street out. Paths and everything outside the area stay from the tiles.) Point-in-polygon: even-odd ray casting on lng/lat.
- Paths: the tiles' roads with `cls === "path"`, not `brunnel` bridge or tunnel, mapped through `pathKind(subclass, bicycle)`; non-null kinds become `{ pts, kind }`.

### 4. Build

Call `buildTrack(coords, opts, sources, job.placeMeta, report)` with sources:

| source | value |
| --- | --- |
| `dem` | `(proj, bounds, z) => loadDem(proj, bounds, z, undefined, usedDem)` |
| `imagery` | only when `opts.imageryZoom` is truthy: `(proj, chunk, z, size) => loadChunkImagery(proj, chunk, z, size, chunkImages, chain, usedImagery)` |
| `widthAt` | from step 3 |
| `osm` | `osm.features` |
| `roundabouts` | `job.roundabouts` |
| `streets` | tiles: `{ lines: area streets, names: tiles.names }`; else undefined |
| `pois`, `landuse` | from tiles |
| `seen` | Mapillary list |
| `renderArt` | `renderArt` |
| `raster` | `(proj, path, reach, maxZoom) => loadRouteRaster(proj, path, reach, chain, maxZoom ?? 20, (d, t) => traceProgress("Tracing the road in the aerial photos (<round(d/t*100)>%)"))` |
| `roadClassAt` | tiles: `roadClassLookup(tiles.roads, coords[0].lat)` |
| `coast`, `jetty` | from steps 2 and 3 |
| `farmland` | the awaited farmland promise (undefined if not asked) |
| `paths` | from step 3 (undefined without tiles) |
| `houseLooks`, `landmarks` | from the job |
| `drawSigns` | `drawSigns` |
| `imageryCredit` | a function (read after imagery is fetched): `IMAGERY[k].credit` for each used source, joined `"; "` |
| `elevationCredit` | a function: `DEM_CREDIT[k]` for each used model, joined `"; "` |

### 5. Outcome

`{ result, chunkImages, usedImagery: [...], usedDem: [...], widthFallback: !widthAt && !opts.widthOverride, seen: seen.length, seenError, missing: [...dataWarnings] }` (copies, so a later build clearing the list doesn't empty an old outcome).

Errors: anything not caught above (OSM never throws; tiles, coast and farmland are caught; `buildTrack` errors; a DEM error) rejects `runBuild`, and the worker posts it as `{ type: "error" }`.

## Snapshot and determinism rules

- **Same inputs, same requests**: the set of URLs and bodies a build asks for must depend only on the route, the options and the answers, never on timing, so a frozen snapshot (`SNAPSHOT=<dir>`) replays offline. Optional data stays behind its option (cattle grids, signals, farmland, sea, Mapillary, imagery).
- A snapshot replay that lacks a download aborts it; the service sees a failure, retries, then warns, and the headless build stops with MISSING DATA. That's the intended signal: "refresh the snapshot with `SNAPSHOT_FILL=1`" or "the code asked for something new". Don't swallow such failures quietly.
- Order: everything passed to `buildTrack` must be in a deterministic order (the services join tiles in row-major order; keep it that way when combining: OSM roads before tile roads for bridges, tile lines then OSM roads for area streets).
- The three Promise.all fetches are independent; nothing reads another's partial result.

## Edge cases

- `coords` with fewer than 2 points: `buildTrack` throws "Pick a start and a finish on the map first"; don't fetch anything first (see bugs).
- No rings: `box` is the route; area streets are just the tile roads.
- Tiles down: no buildings, no streets, no paths, no POIs, no class widths; Overpass widths still used; a data warning.
- Overpass down: tile class widths; empty features; a data warning.
- Both down: `widthFallback` true; the road gets the default width.
- `sea: false`: no coast, no jetty.
- `imageryZoom` 0 (imagery Off, the public-build setting): no imagery source; `buildTrack` uses grass. The raster source is still passed; `buildTrack` decides whether to trace (`opts.traceRoads`), so tracing can still download aerial photos with imagery Off. Keep it that way here; a public build that must avoid imagery should turn tracing off too (flag to the lead, not this module's job).

## Bugs to fix (rather than copy)

1. **Raw options**: it reads `opts.corridor ?? 90`, `opts.buildingRadius ?? 250`, `opts.horizon ?? 1500` and `opts.imageryZoom` from the partial options, duplicating `BuildOptions` defaults (src/core/options.ts) by hand; a caller that omits `imageryZoom` gets no imagery although the default is 18. Apply the defaults once (`withDefaults` from src/core/options.ts) and read from that, but **pass the partial options to `buildTrack` unchanged** and keep every value that reaches a request the same, so snapshots replay. (The UI always sets `imageryZoom`, so builds today aren't affected.)
2. **Credit order**: `usedImagery`/`usedDem` are filled in arrival order across chunks, so the README's credit line can differ between identical builds. Join credits in a fixed order (the `IMAGERY` / `DEM_CREDIT` key order), and return `usedImagery`/`usedDem` in that order too.
3. **"Area too large" becomes "missing data"**: when `fetchTileFeatures` or `fetchCoast` throws because the box is too big, the build is marked MISSING DATA and a rebuild can never fix it. Tell the two apart: a too-large error should fail the build with its own message (or be reported as such), not a retryable warning.
4. **Validate before fetching**: with fewer than 2 coords, throw the same message `buildTrack` would, before any download.
5. `paddedBounds` and the area point-in-polygon test are local copies of geometry that core already has (`src/core/area.ts`, `geo.ts`). Use core's where the results are identical; keep `paddedBounds`' exact numbers (they make tile ranges, so they reach request URLs).

## Tests to write

With every service stubbed (vitest module mocks for `./osm`, `./vectorTiles`, `./tiles`, `./mapillary`, `./landcover`, `./raster`, `./art`, `./signs`, and `buildTrack` captured instead of run):
1. Calls: `fetchOsm` gets `cattleGrids` = `!!farmRoadsides` and `trafficSignals` = `trafficLights !== false`; `fetchTileFeatures` box = route padded by `buildingRadius + 50`; coast box padded by `horizon + 1200`; Mapillary not called without a token; coast not called with `sea: false`; farmland only with `farmland`.
2. `paddedBounds`: 100 m at latitude -33.65 gives `dLat = 100/111320` and `dLng = 100/(111320 * cos(33.65 deg))` (exact).
3. Warnings: `clearDataWarnings` runs after the first report; a tiles rejection adds "all map tiles (buildings, streets, shops)"; coast "all coast tiles (sea, piers, beaches)"; farmland "farmland tiles (vineyards, paddock fences)"; a Mapillary rejection sets `seenError` and adds no warning; `missing` is a copy.
4. Widths: Overpass `widthAt` preferred; tile class widths when Overpass gave none; none with `widthOverride` (and `widthFallback` false); `widthFallback` true when neither exists.
5. Area streets: with a ring, an OSM road inside replaces a tile road of the same class inside; a tile path inside stays; a tile road outside stays; with no rings the tile roads pass unchanged.
6. Crossings only with `armco`; bridges from both lists filtered by class prefix.
7. Unsealed: tile roads that are unpaved (not paths) appended after Overpass's.
8. Jetty: one `fetchPierFeatures` call over all piers padded 40 m; none without piers.
9. Sources: `imagery` absent when `imageryZoom` is 0; `raster`'s progress text is "Tracing the road in the aerial photos (NN%)"; credit functions read the used sets at call time and join with "; " in key order (bug 2).
10. Outcome shape: every field present; `chunkImages` is the map passed to `loadChunkImagery`.
11. Determinism: two runs with the same stubbed answers (resolving in different orders) give identical `buildTrack` arguments.
