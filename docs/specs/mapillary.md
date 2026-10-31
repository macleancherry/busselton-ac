# Spec: Mapillary map features (`src/services/mapillary.ts`)

Status: spec for a clean rewrite ("Owning the code", ROADMAP.md). Write the new module from this page and Mapillary's public API documentation, without the old file open. Tests are written fresh from "Tests to write". The file is on `UPSTREAM-FILES.txt`.

## What the module is for

Mapillary's street-level photos have been run through object detection, and the located objects ("map features") are published as vector tiles. The build uses them to place **traffic signs, power poles, street lights, traffic lights and painted road marks** where they really are. This module:

1. remembers the user's own Mapillary client token in the browser (`localStorage`), and
2. downloads the map-feature tiles over a bounding box and returns each wanted detection as `{ at: [lng, lat], value }`.

Everything that interprets the detections (merging repeat sightings, choosing sign art, snapping to the road) is in the core (`src/core/furniture.ts`, `utilities.ts`, `track.ts`), not here.

Licence: Mapillary data is CC BY-SA. A build that used it credits Mapillary in its README (track.ts sets `mapillary: !!sources.seen?.length`). Tracks containing it are never published (CLAUDE.md, "Data rules").

Not in scope: `scripts/mapillary/house_looks.py` (Python, house photos, its own API calls).

## Public API (keep names and shapes)

```ts
function savedToken(): string
function saveToken(token: string): void
async function fetchSeen(bbox: [west, south, east, north], token: string): Promise<{ at: LngLat; value: string }[]>
```

### Callers (grep, 31 Oct 2026)

- `src/ui/main.ts`: on load, `#mapillaryToken.value = savedToken()`; on Build, `token = #mapillaryToken.value.trim()`, `saveToken(token)`, and the token goes into `BuildJob.token`. The token input is a password field and is excluded from the session saved in the address (`NOT_SAVED`).
- `src/services/pipeline.ts`: when `job.token` is non-empty, `fetchSeen(paddedBounds(box, (opts.corridor ?? 90) + 20), token)` runs in parallel with the OSM, tile and coast fetches. A throw is caught: the message becomes `BuildOutcome.seenError` (shown in the UI's result stats as "Mapillary: <error>") and the build carries on with no sightings. The result goes to `buildTrack` as `DataSources.seen`; `BuildOutcome.seen` is the count. `box` is the route coordinates plus any area polygon; `paddedBounds` pads by metres (lat 111 320 m/deg, lng scaled by cos of the first point's latitude).
- `scripts/headless/build-track.mjs` sets the UI's `#mapillaryToken` from `MAPILLARY_TOKEN` (environment or the gitignored `.env.local`), never from a route file (routes are public).

Downstream readers of the values (for what must survive the filter): `furniture.ts` `mergeSightings` / `category` (`object--support--utility-pole`, `object--street-light`, `object--traffic-light`, `marking--*`, others by value minus a `--g<n>` suffix), `signArt` (`regulatory--maximum-speed-limit-<n>`, `regulatory--stop`, `regulatory--yield`, `regulatory--no-entry`, `regulatory--keep-left`, `complementary--chevron-left/right`, `warning--<slug>`), `seenFeatures`; `track.ts` `discreteMarks` (`marking--discrete--(stop-line|give-way|crosswalk-zebra|arrow--<shape>|text--<shape>|symbol--bicycle)`); utilities (poles and lights).

## Token storage

1. Storage key: `"mapillary_token"` in `localStorage`.
2. `savedToken()`: the stored string, or `""` when absent or when storage throws (private mode, a worker without `localStorage`, Node).
3. `saveToken(token)`: non-empty → store it; empty → remove the key. Swallow storage errors (the token just isn't remembered).
4. Never log the token, put it in an error message, a file in the build, `inputs.json` or a snapshot manifest.

## Network

Two tile sets (Mapillary API v4 vector tiles, Mapbox Vector Tile format, protobuf), both at **zoom 14 only** (map-feature tiles are published at z14):

| Tile set | URL pattern | Layer name in the tile |
| --- | --- | --- |
| Map feature points | `https://tiles.mapillary.com/maps/vtp/mly_map_feature_point/2/{z}/{x}/{y}?access_token=<token>` | `point` |
| Traffic signs | `https://tiles.mapillary.com/maps/vtp/mly_map_feature_traffic_sign/2/{z}/{x}/{y}?access_token=<token>` | `traffic_sign` |

- Plain `GET`, no headers, no body. The token is URL-encoded (`encodeURIComponent`) into the `access_token` query parameter. Keep the URL byte for byte (same order, same encoding): headless builds cache and snapshot each request under a hash of method + URL + body, so any change breaks frozen snapshots' replay.
- Tiles: standard Web Mercator XYZ, 256 px tile grid at z14 (`lngLatToPixel` / `pixelToLngLat` in `src/core/geo.ts`).
- Decoding: `@mapbox/vector-tile` (`VectorTile`) over `pbf` (`PbfReader`), both BSD-licensed npm dependencies, not upstream code. Keep using them.
- Each feature has a `value` property (the Mapillary class name, e.g. `regulatory--stop--g1`, `object--street-light`, `marking--discrete--stop-line`) and point geometry in tile units `0..extent` (usually 4096).

## Behaviour of `fetchSeen`

1. **Tile range.** `bbox = [w, s, e, n]` in degrees. Pixel corners at z14: NW = `lngLatToPixel([w, n], 14)`, SE = `lngLatToPixel([e, s], 14)`. Tiles `x0..x1 = floor(NW.x / 256)..floor(SE.x / 256)`, `y0..y1` likewise from y.
2. **Cap.** If the range has more than **200** tiles, return `[]` without any request (a z14 tile is about 2 km across at Busselton's latitude, so about 800 km²). Fix: say so (see Bugs 3).
3. **Requests.** For every tile, row by row (y outer, x inner), and for each of the two tile sets in the table order (points, then traffic signs): one GET. All run concurrently (no limiter today; see Bugs 4).
4. A response that isn't OK (non-2xx) or a request that throws contributes nothing. Count the responses that were OK.
5. **Features.** For each feature of the tile's layer (`point` / `traffic_sign`; a missing layer means none):
   - `value = String(properties.value ?? "")`;
   - keep it only if `value` matches **WANTED** (below);
   - take the first point of the first geometry ring; drop it if outside the tile, i.e. `x < 0`, `y < 0`, `x ≥ extent` or `y ≥ extent` (tile buffers repeat neighbours' features);
   - position: global pixel `((tx + x / extent) * 256, (ty + y / extent) * 256)` at z14 → `pixelToLngLat` → `[lng, lat]`.
6. **WANTED** (only the kinds the build can place), a prefix match on `value`:
   `^(object--support--utility-pole|object--street-light|object--traffic-light|regulatory--|warning--|complementary--chevron|marking--discrete--(stop-line|crosswalk-zebra|give-way|arrow--|text--|symbol--bicycle))`
7. **Deterministic order.** The result is every (tile, tile set) slot's features concatenated in **request order** (rule 3), each slot's features in tile order, regardless of which response arrived first. (Repeat sightings are merged order-dependently downstream; arrival order made each build slightly different before this rule.)
8. **Failure.** If there was at least one request and **none** was OK, throw `Error("Mapillary didn't answer: check the token")`. (A bad token gets 401/403 without CORS headers, so in the browser it surfaces as failed requests, not a readable status.) Some OK and some failed: return what arrived, silently.
9. An empty bbox range is impossible (at least one tile); a bbox crossing the antimeridian isn't supported (not needed in Australia).

## Caching

None in the module. Headless builds cache each tile response in `out/cache` (14 days) and snapshots freeze them (`scripts/headless/build-track.mjs`, `scripts/snapshot/snapshot.mjs`); the browser's HTTP cache applies otherwise.

## Bugs and weak spots (fix, don't copy)

1. **Misleading error.** "check the token" is thrown whenever nothing answered: offline, Mapillary down, or a snapshot build where the requests are absent. Fix: distinguish what can be distinguished. A response with status 401/403 (readable in headless builds, which add CORS headers) → "Mapillary rejected the token"; network errors only → "Mapillary didn't answer (offline or down)". Keep the error text free of the token.
2. **Snapshots depend on the token.** The cache/snapshot key hashes the full URL, token included. A frozen showcase snapshot replays Mapillary only when the build runs with the same `MAPILLARY_TOKEN`; with no token there's no request and the signs simply vanish; with another token every request misses the snapshot and the build continues with `seenError` (it isn't counted as missing data). The lead should decide: either make the headless cache key strip `access_token` from tiles.mapillary.com URLs (a change in build-track.mjs, outside this module) or make a missing Mapillary answer in snapshot mode fail the build like other missing data. Flagged, not for this module to solve alone.
3. **Silent cap.** Over 200 tiles returns `[]` without a word. Fix: throw an Error ("area too big for Mapillary: N tiles") so pipeline's catch shows it as `seenError`.
4. **Unbounded concurrency.** Up to 400 simultaneous requests; no timeout, no retry. Fix: limit to about 6 at a time, a 20 s timeout per request (`AbortSignal.timeout`), and up to 2 retries with backoff for network errors and 5xx (not for 4xx). Keep rule 7's ordering.
5. Only the first point of a feature is used. Map features are points, so that's correct; ignore any non-point geometry instead of reading `[0][0]` blindly (guard empty geometry).

## Could be deleted?

Not without a decision: it feeds every Mapillary-placed sign, pole, light and painted mark. If Mapillary were dropped (e.g. for a public release, which can't contain Mapillary data), `fetchSeen` goes, along with the token field in the UI; the core already copes with `seen` empty or absent. `savedToken`/`saveToken` are browser-UI conveniences only.

## Tests to write

Make the fetch injectable (a `fetch`-compatible function parameter or module-level override) so tests run in Node. Build test tiles by hand-encoding a minimal MVT (one layer, `extent` 4096, point features with a `value` key) with `pbf`'s writer; `vt-pbf` isn't installed and isn't needed.

1. **URLs.** A bbox inside one z14 tile makes exactly two requests, in order, to the two URLs above with the right `z/x/y` and `access_token=<encodeURIComponent(token)>`; a token with `|` is encoded as `%7C`.
2. **Range.** A bbox spanning 2 x 3 tiles makes 12 requests, y outer, x inner, points before signs.
3. **Cap.** A bbox over 200 tiles makes no request (and, after the fix, throws the "too big" error).
4. **Filter.** Features `regulatory--stop--g1`, `object--street-light`, `marking--discrete--stop-line`, `marking--discrete--arrow--left`, `complementary--chevron-left--g1` are kept; `object--bench`, `marking--continuous--solid`, `information--parking--g1` are dropped; a feature with no `value` is dropped.
5. **Position.** A feature at tile units (2048, 2048) of tile (tx, ty) comes back at `pixelToLngLat([(tx + 0.5) * 256, (ty + 0.5) * 256], 14)` to 1e-9; features at x = extent or y = -1 are dropped.
6. **Order.** Responses resolved in reverse order give the same output array as in-order responses.
7. **Errors.** All requests failing (throw, or 403) → rejects with an Error whose message doesn't contain the token; one tile OK and the rest failing → resolves with that tile's features.
8. **Token storage.** With a fake `localStorage`: save then `savedToken()` returns it; `saveToken("")` removes the key; a throwing storage makes `savedToken()` return `""` and `saveToken` not throw.

## Rewrite notes (31 Oct 2026)

- `fetchSeen(bbox, token, opts?)`: `opts` = `{ fetch, concurrency (6), timeoutMs (20 000), retries (2), retryDelayMs, warn }`. `savedToken(store?)` / `saveToken(token, store?)` take an optional storage for tests.
- Fixed: errors say "Mapillary rejected the token" (401/403) or "Mapillary didn't answer (offline or down)"; the 200-tile cap throws "area too big for Mapillary: N tiles" and calls `warn` (pipeline passes `warnMissing`); concurrency, timeout and retries as Bugs 4; empty geometry skipped.
- Bugs 2 decided: `scripts/headless/build-track.mjs` keys cache and snapshot entries for `tiles.mapillary.com` without `access_token`. Entries cached or frozen before this change were keyed with the token, so they miss once and are fetched again (a snapshot built with Mapillary needs `SNAPSHOT_FILL=1` once to re-add them).
