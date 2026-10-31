# Spec: OSM services (`src/services/osm.ts`)

Status: spec for a clean rewrite ("Owning the code" in ROADMAP.md). `osm.ts` is on `UPSTREAM-FILES.txt`. Written from the old code on 31 Oct 2026 so a separate session can write a fresh module without the old file open. The only literal text copied here is what outside systems force: URLs and Overpass query text, whose exact bytes are cache and snapshot keys (see "Snapshot rules").

Runs in the browser (page and build worker); also imported by `scripts/headless/build-track.mjs` inside the page (`import("/src/services/osm.ts")`) and by Node scripts/tests for the pure helpers. Uses only `fetch`, `AbortController`, `URLSearchParams`, timers.

## What the module is for

1. **Routing**: OSRM driving route through pins, with roundabouts, U-turns and cut spurs; or a route along given OSM way ids (Overpass).
2. **Place search and naming**: Photon (search-as-you-type) and Nominatim (reverse geocode).
3. **Overpass data near the route** (and over area polygons): road widths, roundabout rings, guard rails, poles, lamps, power lines, fences/walls/hedges, groynes, cattle grids, kerbside tags, unsealed roads, and the drivable streets as lines; traffic signals in a query of their own; what stands on a jetty.
4. **Pure helpers**: width lookup, joining split ways, the signal query and parser.

## Public API (keep these names and shapes)

```
interface Route { coords: LngLat[]; distance: number; roundabouts: RoundaboutHint[]; uturns: LngLat[]; trimmed: LngLat[] }
route(pins: LngLat[], signal?: AbortSignal): Promise<Route>
routeWays(ids: number[], through: LngLat[], opts?: WayRouteOptions): Promise<Route>
fetchWayGeoms(ids: number[]): Promise<OsmWayGeom[]>

interface Place { label: string; detail: string; lngLat: LngLat; extent?: [minLng, maxLat, maxLng, minLat] }
searchPlaces(q: string, near?: LngLat, signal?: AbortSignal): Promise<Place[]>
interface PlaceName { road?: string; town?: string; country?: string }
reverseGeocode(p: LngLat): Promise<PlaceName>

interface Way { width: number; pts: LngLat[] }
interface OsmData {
  widthAt?: (p: LngLat) => number | undefined;        // undefined when Overpass failed or no way had a width
  features: OsmFeatures;                               // src/core/track.ts
  roads?: { pts; cls; brunnel?: string; oneway?: 1 | -1; service?: string; surface?: string }[];
}
fetchOsm(routeCoords: LngLat[], areas: LngLat[][] = [], want: { cattleGrids?: boolean; trafficSignals?: boolean } = {}): Promise<OsmData>
signalQuery(routeCoords: LngLat[], areas: LngLat[][] = []): string
signalsFromElements(elements: { type; lat?; lon?; tags? }[]): { at: LngLat; crossing: boolean }[]
widthLookup(ways: Way[], lat: number): (p: LngLat) => number | undefined
joinWays<T extends { pts; cls; oneway?; brunnel?; service?; surface? }>(ways: T[]): T[]
fetchPierFeatures(box: [w, s, e, n]): Promise<{ railways: LngLat[][]; platforms: { pts; shelter: boolean }[]; buildings: { pts; name: string }[] }>
```

## Callers (from `grep`, 31 Oct 2026)

- `src/ui/main.ts`: `route`, `routeWays` (when `window.__routeWays` is set by the headless build), `reverseGeocode` (the route's middle point, for its name), `searchPlaces` (search box, with an AbortSignal per keystroke), types `Place`, `Route`.
- `scripts/headless/build-track.mjs`: in the page, `route(through).coords` and `routeWays(ids, through, { reverse, loop }).coords` for extra layouts.
- `src/services/pipeline.ts`: `fetchOsm(coords, rings, { cattleGrids: !!opts.farmRoadsides, trafficSignals: opts.trafficLights !== false })`, `fetchPierFeatures`, `widthLookup` (for the tiles' class widths when Overpass failed).
- `scripts/network/phase1.ts`: `joinWays`.
- Tests: `test/joinWays.test.ts`, `test/trafficLights.test.ts` (`fetchOsm`, `signalQuery`, `signalsFromElements`; it stubs `fetch` and reads `init.body.get("data")`, so the POST body is a `URLSearchParams`).

Depends on: `dataWarnings.ts` (`warnMissing`), `jettySnapshot.ts` (`JETTY_SNAPSHOT`, `JETTY_SNAPSHOT_BOX`), core `geo` (`haversine`), `spurs` (`trimSpurs`), `kerbside` (`kerbsideFromTags`), `unsealed` (`isUnsealed`), `wayRoute` (`routeAlongWays`, `OsmWayGeom`, `WayRouteOptions`), types `OsmFeatures`, `RoundaboutHint`. All fork-owned or already rewritten; keep using them.

## Endpoints

- OSRM: `https://router.project-osrm.org`
- Photon: `https://photon.komoot.io/api/`
- Nominatim: `https://nominatim.openstreetmap.org`
- Overpass mirrors, in this order: `https://overpass-api.de/api/interpreter`, `https://maps.mail.ru/osm/tools/overpass/api/interpreter`, `https://overpass.private.coffee/api/interpreter`

All keyless public services. No custom headers (the browser's Referer identifies the app, as their policies ask).

## Snapshot rules (read first)

The headless build answers every https request from its cache or a frozen snapshot, keyed on `sha256("<METHOD> <URL> <POST body>")` (`scripts/headless/build-track.mjs`). The Busselton snapshot holds OSRM, Nominatim and Overpass answers under today's exact bytes. So:

1. **Keep URLs and query text byte for byte**, including whitespace, newlines, decimal places and clause order. The golden strings below are the contract; a change means every frozen snapshot stops replaying (MISSING DATA, or a different track).
2. **Overpass POST body**: `new URLSearchParams({ data: query })` (form encoding: spaces become `+`, newlines `%0A`). Method POST.
3. **Optional data stays optional**: a clause only enters a query when an option asks for it (cattle grids), or it goes in a query of its own (traffic signals), so a build with the option off sends exactly the old bytes. Any new Overpass data must follow this rule.
4. In snapshot mode the build aborts requests the snapshot doesn't have. All three mirrors are asked at once and the first good answer wins, so a snapshot that holds any one mirror's answer replays. Keep asking every mirror for every query.
5. The headless cache refuses to store Overpass answers smaller than 400 kB that contain `"remark"` (timeouts); the module must also reject them (below), so a bad answer is retried, not used.

## Routing

### `route(pins, signal?)`

- GET `<OSRM>/route/v1/driving/<path>?overview=full&geometries=geojson&steps=true&continue_straight=true`, `path` = each pin as `lng,lat` with 6 decimals, joined by `;`.
- The body is parsed as JSON (a parse failure counts as `{}`). Not OK, `code !== "Ok"`, or no routes: throw `Error(body.message || "Routing failed (HTTP <status>)")`.
- Steps: all legs' steps of route 0, in order.
- Roundabouts: steps whose maneuver type is exactly `roundabout`, `rotary` or `roundabout turn`: `{ location: maneuver.location, arc: step geometry coordinates }`.
- U-turns: maneuver locations of steps with modifier `uturn`.
- `coords` = route 0 geometry coordinates; `distance` = OSRM's distance (m).
- `trimSpurs(coords, uturns)` (core/spurs.ts) gives `{ coords, cut, kept }`. Nothing cut: return the OSRM route with `trimmed: []` and `uturns` as found.
- Something cut: `coords` = trimmed coords; `distance` = sum of haversine segment lengths of the trimmed coords; keep only roundabouts whose location is within 30 m (haversine) of some trimmed coordinate (a roundabout only gone round to turn back is gone with the spur); `uturns` = `kept`; `trimmed` = `cut`.
- No retry, no timeout today (see bugs).

### `fetchWayGeoms(ids)`

- Any id not a positive integer, or an empty list: throw `Error('"ways" must be OSM way ids (whole numbers)[, not <bad ids joined ", ">]')`.
- Query (golden): `[out:json][timeout:40];way(id:<ids joined ",">);out tags geom;`
- Overpass protocol (below) with: 45 s abort, retry waits 5 s then 10 s, `remark` check, `elements` must be an array. All rounds failed: throw `Error("couldn't fetch OSM ways <ids> from Overpass (every mirror failed 3 times: <messages>); build again")`, messages from the AggregateError's errors joined `"; "` (or the single error's message).
- Ways (type way with geometry) by id, geometry as `[lon, lat]`. Any requested id absent: throw `Error("OSM way[s] <ids> not found (deleted, or a wrong id)")` ("way" for one, "ways" for several).
- Returns `{ id, pts }` in the order of `ids`.

### `routeWays(ids, through, opts)`

- Geometry fetched once per id list (key = ids joined `,`) and kept for the session (the page re-routes on every pin added); a failed fetch is removed from the cache so the next call tries again.
- `routeAlongWays(geoms, through, opts)` (core/wayRoute.ts); return its `coords` and `distance` with `roundabouts: []`, `uturns: []`, `trimmed: []`.

## Place search and naming

### `searchPlaces(q, near?, signal?)`

- GET `<PHOTON>?<params>`: `q`, `limit=6`, and with `near`: `lon`, `lat` with 4 decimals (URLSearchParams order: q, limit, lon, lat).
- Non-OK: `[]`. Each feature: `label = name ?? street ?? city ?? "Unnamed"`; `detail` = street (only if different from label), city, state, country, the present ones joined `", "`; `lngLat` = geometry coordinates; `extent` = properties.extent as given (`[minLng, maxLat, maxLng, minLat]`).
- Search-as-you-type is fine on Photon; Nominatim's policy forbids it.

### `reverseGeocode(p)`

- At most one request a second across the module: wait until 1.1 s after the previous request started.
- GET `<NOMINATIM>/reverse?format=jsonv2&zoom=16&lat=<lat>&lon=<lng>` with the numbers in JavaScript's default formatting (a snapshot key: keep it).
- Non-OK: `{}`. Else from `address`: `road`; `town` = town ?? village ?? city ?? suburb ?? county; `country`.

## Overpass protocol (shared)

For one query string:
1. Up to 3 rounds. Before round 2 wait `base` s, before round 3 wait `2 * base` s (base 5 s; 4 s for the jetty query).
2. Each round: one AbortController; POST the body to **every mirror at once**; the first mirror to give a good answer wins (`Promise.any`); when the round ends (won or all failed), clear the timer and abort the rest.
3. A mirror's answer fails if: HTTP not OK; JSON parse fails; `remark` present and matching `/timed out|runtime error/i`; and, where noted, `elements` not an array.
4. A round-wide abort timer (per query, below) aborts every mirror still waiting.

Write it once as a helper and use it for all four queries (today it's copied four times with small differences; see bugs).

## `fetchOsm(routeCoords, areas, want)`

1. If `want.trafficSignals`, start the signal query (below) **in parallel**.
2. Run the main query.
3. If the signal query found something (not undefined), set `features.trafficSignals` to it. When `trafficSignals` is off, `features.trafficSignals` stays undefined.

### Shared inputs

- **Sampled route**: `step = max(1, ceil(n / 180))`; keep coordinates whose index is a multiple of `step`, plus the last one. `around` = the kept points as `lat,lng` with 6 decimals each, all joined by `,`.
- **Area polygons**: only rings with 3 or more points; each written as `poly:"<lat lng lat lng ...>"` (6 decimals, space-separated, no closing repeat added).

### Main query (golden)

Text, with `A` = around list and `P` = one `poly:"..."` selector. Newlines and the four-space indents are exact:

```
[out:json][timeout:<40, or 90 with any polygon>];(
    way(around:12,A)[highway];
    way(around:15,A)[barrier=guard_rail];
    way(around:30,A)[junction~"^(roundabout|circular)$"];
    node(around:40,A)[power=pole];
    node(around:40,A)[highway=street_lamp];
    way(around:40,A)[power~"^(line|minor_line)$"];
    way(around:45,A)[barrier~"^(fence|wall|hedge|retaining_wall)$"];
    node(around:30,A)[barrier=cattle_grid];                     <- only with want.cattleGrids
    way(around:300,A)[man_made~"^(groyne|breakwater)$"];<per polygon block>
  );out tags geom;
```

Per polygon (appended right after the groyne line's `;`, no newline before the block's first `\n`): `\n    way(P)[highway];` `\n    way(P)[junction~"^(roundabout|circular)$"];` `\n    node(P)[power=pole];` `\n    node(P)[highway=street_lamp];` `\n    way(P)[power~"^(line|minor_line)$"];` `\n    way(P)[barrier~"^(fence|wall|hedge|retaining_wall)$"];` and, only with cattle grids, `\n    node(P)[barrier=cattle_grid];`. Then `\n  );out tags geom;`.

Golden check (from the old code, route `[[115.1,-33.6],[115.2,-33.61]]`, no areas, no options), the decoded query is exactly:

```
"[out:json][timeout:40];(\n    way(around:12,-33.600000,115.100000,-33.610000,115.200000)[highway];\n    way(around:15,-33.600000,115.100000,-33.610000,115.200000)[barrier=guard_rail];\n    way(around:30,-33.600000,115.100000,-33.610000,115.200000)[junction~\"^(roundabout|circular)$\"];\n    node(around:40,-33.600000,115.100000,-33.610000,115.200000)[power=pole];\n    node(around:40,-33.600000,115.100000,-33.610000,115.200000)[highway=street_lamp];\n    way(around:40,-33.600000,115.100000,-33.610000,115.200000)[power~\"^(line|minor_line)$\"];\n    way(around:45,-33.600000,115.100000,-33.610000,115.200000)[barrier~\"^(fence|wall|hedge|retaining_wall)$\"];\n    way(around:300,-33.600000,115.100000,-33.610000,115.200000)[man_made~\"^(groyne|breakwater)$\"];\n  );out tags geom;"
```

and its form-encoded body starts `data=%5Bout%3Ajson%5D%5Btimeout%3A40%5D%3B%28%0A++++way%28around%3A12%2C-33.600000%2C115.100000`. With the area `[[115.1,-33.6],[115.2,-33.6],[115.2,-33.7]]` and cattle grids, the timeout is 90, the cattle line sits between the fence and groyne lines, and the polygon block uses `poly:"-33.600000 115.100000 -33.600000 115.200000 -33.700000 115.200000"` with a cattle-grid line last.

Protocol: abort after 45 s (95 s with a polygon); retry waits 5 s, 10 s; `remark` check; a missing `elements` counts as an empty list (not a failure). Keep only ways with geometry and nodes with a `lat`.

All rounds failed: `warnMissing("OpenStreetMap (Overpass): roundabouts, road widths, poles, lights, fences")` and return `{ features }` with every list empty (`buildings, guardRails, roundaboutRings, poles, lamps, powerLines, barriers, groynes, cattleGrids, unsealed` all `[]`), no `widthAt`, no `roads`.

### Reading the elements (in answer order)

Nodes (first match wins): `power=pole` to `poles`; else `highway=street_lamp` to `lamps`; else `barrier=cattle_grid` to `cattleGrids`. Position `[lon, lat]`.

Ways, `pts` = geometry as `[lon, lat]`; first match wins, in this order:
1. `power` = `line` or `minor_line`: to `powerLines` only if **on poles**: `minor_line`, or `line` whose `voltage` (split on `;`, numbers > 0) has a maximum of at most 33000 (no voltage: not on poles; towers carry higher voltages).
2. `man_made` = `groyne` or `breakwater`: `groynes`.
3. `junction` = `roundabout` or `circular`: `roundaboutRings` as `{ pts }`, plus `lanes` when it parses to 1 to 4. (Such a way is **not** also used for widths or streets; keep that.)
4. `barrier` = `fence`, `wall`, `hedge` or `retaining_wall`: `barriers` as `{ pts, kind, fenceType: fence_type, material, height }` (height = `parseFloat(height)` when finite, else undefined).
5. `barrier=guard_rail`: `guardRails`.
6. any `highway`:
   - **Width** (when defined) to the width list: `width` (or `est_width`) parsed as a float if strictly between 2 and 30 m; else `lanes` (integer 1 to 7) as `max(3.5, lanes * 3.2)`; else by class: motorway, trunk, primary 7.5; secondary 7; tertiary 6.5; any `*_link` of those five 5; unclassified 5.5; residential 6; living_street 5; service 4; track 3.5; raceway 10; road 6; others none.
   - **Unsealed**: `isUnsealed(surface, highway, tracktype)` and `area` not `yes`: `pts` to `unsealed`.
   - **Street class** (the vector tiles' OpenMapTiles classes): motorway; trunk; primary and primary_link to primary; secondary and secondary_link to secondary; tertiary and tertiary_link to tertiary; residential, unclassified, living_street, road to minor; service; track. Others (paths, links of motorway/trunk, construction...) have none.
   - **Kerbside**: when it has a class, `kerbsideFromTags(tags)`; non-null goes to `features.kerbside` (created on first use) as `{ pts, ...kerb }`. (Even for private/no-access ways.)
   - **Streets**: with a class, `area` not `yes`, `access` not `no` or `private`: a road `{ pts, cls }` plus, only when set: `brunnel` (`bridge` when bridge is set and not `no`, else `tunnel` likewise), `oneway` (`yes`/`1` to 1, `-1` to -1), `service` (the tag), `surface: "unpaved"` when unsealed.

Return `{ features, widthAt: widthLookup(widths, routeCoords[0].lat) when any widths else undefined, roads: joinWays(roads) }`. `features.buildings` stays `[]` (the pipeline fills it from the vector tiles).

### Traffic signals: `signalQuery` (golden) and the fetch

- Same sampling and polygons. Selector block for a place `W` (`around:40,A` or `P`), three lines each starting `\n    `: `node(W)[highway=traffic_signals];`, `node(W)[highway=crossing][crossing=traffic_signals];`, `node(W)[highway=crossing]["crossing:signals"=yes];`.
- Query: `[out:json][timeout:<30, or 60 with any polygon>];(` + block for `around:40,A` + a block per polygon + `\n  );out;`.
- Golden: route `[[115.1,-33.6],[115.2,-33.61]]`, no areas, is exactly
  `"[out:json][timeout:30];(\n    node(around:40,-33.600000,115.100000,-33.610000,115.200000)[highway=traffic_signals];\n    node(around:40,-33.600000,115.100000,-33.610000,115.200000)[highway=crossing][crossing=traffic_signals];\n    node(around:40,-33.600000,115.100000,-33.610000,115.200000)[highway=crossing][\"crossing:signals\"=yes];\n  );out;"`
- Fetch: protocol with a 65 s abort, waits 5 s, 10 s, `remark` check, `elements` must be an array; parse with `signalsFromElements`. All rounds failed: `warnMissing("OpenStreetMap (Overpass): traffic signals")`, result undefined.

### `signalsFromElements(elements)`

Nodes with `lat` and `lon` only. Skip `traffic_signals` = `emergency`, `blinker`, `level_crossing` or `ramp_meter`. `crossing` = (`highway=crossing`); keep only `highway=crossing` or `highway=traffic_signals`. De-duplicate by position (7 decimals), first wins. Output `{ at: [lon, lat], crossing }` in input order.

## `widthLookup(ways, lat)`

Returns `p => width`: the width of the way with the nearest segment within **12 m** of `p` (ties: the first found), else undefined. Distances on a flat frame: x metres = `dLng * cos(lat) * 111320`, y = `dLat * 111320`, `lat` fixed by the caller (the route's first point). Point-to-segment distance with the projection clamped to the segment (a zero-length segment treated as length 1e-9). Linear scan; fine for current sizes.

## `joinWays(ways)`

OSM splits a street wherever a tag changes; this joins ways end to end where exactly two ways of the same kind meet, so a street is one line and traffic lanes don't stop at a split with no junction.

Precise rules (the output order and orientation feed later stages, so keep them):
1. Work on copies (`pts` copied; input not mutated). Endpoint key: `lng,lat` with 7 decimals.
2. An end index: for each way in order, push its index under its first point's key, then its last point's key (a closed way pushes twice under the same key). Keys keep their first-insertion order.
3. "Same kind": equal `cls`, `brunnel`, `service`, `surface`, and both one-way or both not.
4. Repeat until nothing joins: walk the end index in key order; at key k take the distinct live indices in order of appearance; need exactly two (a, b in that order) of the same kind; skip if a is closed. Orient: a must end at k (else reverse a), b must start at k (else reverse b). If one-way: a's traffic must flow *into* k exactly when b's flows *out of* k (a ends at k and is +1, or starts at k and is -1, versus b starts at k and is +1, or ends at k and is -1); otherwise skip. Merge: a's fields with `pts` = a (oriented) then b (oriented) without b's first point; if a is one-way, its `oneway` flips sign when a was reversed. The merged way takes a's slot; b is dead; delete key k from the index; push the merged way's two end keys (appended to existing keys' lists or as new keys); restart the walk from the first key.
5. Return the live ways in original slot order.

Known flaws to fix (they don't occur in current data but are wrong): b being a closed way isn't checked (a ring could be appended to a street); the restart-after-every-join makes it roughly quadratic on area builds (thousands of ways). A faster version is welcome if its output is identical (same chains, same orientation, same slots).

## `fetchPierFeatures(box)`

What stands on a jetty (docs/jetty.md), over the jetty's box `[west, south, east, north]`.
- Box text `B` = `south,west,north,east` with 6 decimals.
- Query (golden; four-space indents): `[out:json][timeout:40];(` then lines `\n    way(B)[railway~"^(narrow_gauge|miniature|light_rail|tram|rail)$"];`, `\n    way(B)[railway=platform];`, `\n    way(B)[public_transport=platform];`, `\n    way(B)[building];`, then `\n  );out tags geom;`.
- Protocol: 45 s abort, waits 4 s, 8 s, `elements` must be an array (no `remark` check today; add it, see bugs).
- Each way with at least 2 points: `railway=platform` or `public_transport=platform` to platforms `{ pts, shelter: shelter=yes }`; else any `railway` to railways; else `building` with at least 3 points to buildings `{ pts, name: name ?? "" }`.
- All rounds failed: if the box overlaps `JETTY_SNAPSHOT_BOX` (strict overlap on both axes) return `JETTY_SNAPSHOT` (no warning: the Busselton Jetty has a frozen copy); else `warnMissing("jetty features (OSM: its railway, platforms, buildings)")` and return empty lists.

## Edge cases

- Over 180 route points: sampled; the last point always kept. Under 180: all points.
- `routeCoords` must have at least one point (the pipeline guarantees two); an empty list would make an invalid query and crash on `routeCoords[0]`. Throw a clear error instead.
- Polygons with fewer than 3 points are ignored everywhere.
- A node tagged both pole and lamp is a pole only.
- Ways tagged both `highway` and `junction=roundabout` go to rings only.
- `motorway_link` and `trunk_link` have widths (5 m) but no street class, so they never appear in `roads` (OpenMapTiles folds them into motorway/trunk). Keep for now: adding them changes area builds; raise it with the lead if a route needs them.

## Bugs to fix (rather than copy)

1. Four copies of the Overpass protocol with drifting checks (main accepts a missing `elements`; jetty skips the `remark` check). One helper, with per-query abort time, wait base and whether `elements` must be an array. Add the `remark` check to the jetty query.
2. `route` has no retry and no timeout: a busy OSRM fails the route outright. Retry network errors, 429 and 5xx (as `fetchRetry` in dataWarnings.ts) and pass the caller's signal through; keep the URL the same.
3. `reverseGeocode`'s rate limit isn't safe for overlapping calls (both read the old timestamp before either waits). Chain calls on one promise so each starts at least 1.1 s after the previous.
4. `joinWays`: check that neither way is closed (see above).
5. `fetchOsm` with an empty route crashes; throw a clear error.

## Tests to write

Pure:
1. Main query golden: the exact string above for the two-point route; with cattle grids the cattle line sits between the fence and groyne lines; with an area, timeout 90 and the polygon block (with and without cattle grids); the form-encoded body matches the golden prefix.
2. Sampling: 181 points give step 2 (91 kept, last included); 360 points give step 2; 361 give step 3; the last point is never duplicated.
3. `signalQuery` golden (no area; with an area, timeout 60 and a second block).
4. `signalsFromElements`: junction and crossing signals kept; emergency, blinker, level_crossing, ramp_meter dropped; duplicates by position dropped; ways ignored.
5. Element reading (stub fetch with a crafted answer): pole/lamp/cattle nodes; power line at 22 kV kept, 132 kV and no voltage dropped, minor_line kept; groyne; roundabout ring with lanes 2 kept and lanes 9 dropped; fence with `height=1.8`; guard rail; a residential way gives width 6, a `width=9.5` way 9.5, `lanes=2` 6.4, `lanes=1` 3.5; `access=private` way has a width but no street; unsealed track goes to `unsealed` and its street has `surface: "unpaved"`; bridge/tunnel/oneway/service carried.
6. `widthLookup`: nearest within 12 m wins; 13 m away is undefined; a zero-length segment doesn't divide by zero.
7. `joinWays`: two residential halves meeting end to start join into one line; meeting start to start join with the first reversed; three ways meeting at a point don't join; different `cls`/`service`/`surface`/`brunnel` don't join; two one-ways in the same direction join (and the merged `oneway` is right when the first was reversed); opposite one-ways don't; a closed way never joins (either side); the input isn't mutated; output keeps original slot order.
8. Overpass protocol (fake timers): first mirror to answer wins and the others are aborted; a `remark: "runtime error: Query timed out"` answer counts as a failure; three failed rounds wait 5 s then 10 s, then warn with the exact message; the signal query is a separate POST and the main body is unchanged when `trafficSignals` is on (the old test did this).
9. `fetchWayGeoms`: bad ids throw before any fetch; missing ids throw "not found"; output follows the ids' order; `routeWays` fetches once for repeated calls and again after a failure.
10. `fetchPierFeatures`: platforms with `shelter=yes`; railways; buildings named; mirrors down over the Busselton Jetty box gives `JETTY_SNAPSHOT` and no warning; elsewhere, empty lists and a warning.
11. `route` (stub fetch): roundabout and U-turn steps found; URL exact (6-decimal pins, the four query parameters in order); an error body's `message` is thrown; with a U-turn spur, `distance` is recomputed and a roundabout more than 30 m from the trimmed line is dropped.
