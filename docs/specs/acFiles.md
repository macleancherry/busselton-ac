# Spec: track folder text and image files (`src/core/acFiles.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). Write the new module from this page and the public format notes below, without the old file open. Tests are written fresh from the "Tests to write" list.

Provenance: upstream (honestjams, first in e803a0e) with fork additions; listed in `UPSTREAM-FILES.txt`. Each rule below is marked **Upstream** or **Fork**. Upstream here means what `upstream/main` has today (`git show upstream/main:src/core/acFiles.ts`).

## What the module is for

The small files that sit next to the kn5 in an AC track folder, other than the AI line, the CSP config and the cameras:

| File in the zip | Function | Read by |
| --- | --- | --- |
| folder name `<slug>` | `slugify` | everything |
| `data/surfaces.ini` | `surfacesIni` | AC physics, CSP (extended physics, scripting permissions, WeatherFX) |
| `ui/ui_track.json` (or `ui/<layout>/ui_track.json`) | `uiTrackJson` | AC and Content Manager track list; CSP Traffic mode; `run-test.ps1`, `rig-install.ps1` |
| `map.png` + `data/map.ini` | `trackMap` | AC's minimap app |
| `extension/street_map.png` + `.ini` | `streetMap` | **Fork**: the Busselton Map app (`apps/lua/BusseltonMap`) |
| `ui/outline.png` | `outlinePng` | Content Manager track outline |
| `ui/preview.png` | `previewPng` | Content Manager preview (the browser app replaces it with a 3D render) |
| `README.txt` | `readme` | people |

## Public API (keep these names and shapes)

### Types and constants

- **`TrackMeta`**: `{ name: string; description?: string; country?: string; city?: string; author?: string }`. **Upstream.**
- **`TRAFFIC_READY_TAG`** = `"traffic-planner-ready"`. **Fork.**

### Functions

- **`slugify(name: string): string`**. Upstream.
- **`surfacesIni(traffic = false, streetsValid = false, at?: LngLat, unsealed = false): string`**. Upstream took no arguments; all four parameters are fork additions.
- **`timezoneOf(at: LngLat): string | undefined`**. **Fork.** `LngLat` is `[lng, lat]`.
- **`uiTrackJson(meta: TrackMeta, opts: { length: number; width: number; pitboxes: number; closed: boolean; centre: LngLat; traffic?: boolean }): string`**. Upstream; `traffic` is fork.
- **`trackMap(points: [number, number][]): { png: Uint8Array; ini: string }`**. Upstream.
- **`streetMap(streets: { pts: [number, number][]; width: number }[], route: [number, number][], maxPixels = 3072): { png: Uint8Array; ini: string }`**. **Fork.**
- **`outlinePng(points: [number, number][]): Uint8Array`**. Upstream.
- **`previewPng(points: [number, number][], closed: boolean): Uint8Array`**. Upstream.
- **`readme(meta: TrackMeta, imagery: string | null): string`**. Upstream.

All `points` / `pts` / `route` are AC world X/Z pairs (X east, Z south; callers pass local `[x, -y]`). PNGs are drawn with `Raster` from `src/core/textures.ts` (see docs/specs/textures.md: anti-aliased polylines where a pixel's coverage is the most any segment gives it, filled dots, source-over blending, PNG encode). This module doesn't need its own drawing code.

### Call sites (from `grep`, 31 Oct 2026)

- `src/core/track.ts`: all of `slugify`, `surfacesIni`, `uiTrackJson`, `trackMap`, `streetMap`, `outlinePng`, `previewPng`, `readme`, `TrackMeta`.
  - `surfacesIni(opts.traffic, opts.streetsValid ?? !!area, centre, anyUnsealed)`.
  - `uiTrackJson(meta, { length: timedLength(), width: meanRoadWidth, pitboxes: opts.pitCount, closed, centre, traffic: opts.traffic })`.
  - `streetMap(streets, route)` where streets are the side streets with their widths and route is the route samples (closed loops repeat the first point at the end).
  - `readme(meta, imageryCreditOrNull)`; `meta` defaults to `{ name: opts.name, ...routeMeta }` (country and city come from the browser's place lookup).
- `src/core/layouts.ts`: `uiTrackJson` (with `width: 7` and `centre` = the projection origin), `trackMap`, `outlinePng`, `previewPng`, `TrackMeta`.
- `scripts/headless/build-track.mjs` copies the main layout's `data/surfaces.ini` into every layout's `data/`.
- `src/ui/main.ts` replaces `ui/preview.png` with a render.
- Tests: `test/trafficReady.test.ts` (`surfacesIni`, `TRAFFIC_READY_TAG`, `uiTrackJson`), `test/unsealed.test.ts` (`surfacesIni`), `test/streetMap.test.ts`, `test/area.test.ts` and `test/layouts.test.ts` (read the files out of a build), `test/track.test.ts` (file list, ui_track.json fields).
- Other readers of these files: `apps/lua/BusseltonMap/BusseltonMap.lua` (street_map.ini keys), `scripts/windows/run-test.ps1` (ui_track.json `pitboxes`), `scripts/windows/rig-install.ps1` (finds layouts by `ui/<id>/ui_track.json`).
- Duplicate slug logic: `scripts/upgrade/base.mjs` computes the slug itself (same steps, but without the 40-character cut). See "Known issues".

## Rules

### `slugify` (Upstream)

1. Unicode NFKD normalise, then remove combining marks U+0300 to U+036F (so "é" becomes "e").
2. Lower-case.
3. Replace every run of characters outside `a-z0-9` with one `_`.
4. Trim leading and trailing `_`.
5. Cut to the first 40 characters.
6. If the result is empty, `real_road`.

Examples: "Busselton Foreshore" to `busselton_foreshore`; "Café  Strip!" to `cafe_strip`; "!!!" to `real_road`.

### `surfacesIni`

Surfaces in this order, as `[SURFACE_<i>]` with i from 0. Each block lists exactly these keys, in this order: KEY, FRICTION, DAMPING, WAV, WAV_PITCH, FF_EFFECT, DIRT_ADDITIVE, IS_VALID_TRACK, BLACK_FLAG_TIME, SIN_HEIGHT, SIN_LENGTH, IS_PITLANE, VIBRATION_GAIN, VIBRATION_LENGTH (gravel adds five more, below).

| # | KEY | FRICTION | DAMPING | WAV | WAV_PITCH | FF_EFFECT | DIRT_ADDITIVE | IS_VALID_TRACK | BLACK_FLAG_TIME | SIN_HEIGHT | SIN_LENGTH | IS_PITLANE | VIBRATION_GAIN | VIBRATION_LENGTH |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | ROAD | 0.99 | 0 | (empty) | 0 | NULL | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | STREET | 0.99 | 0 | (empty) | 0 | NULL | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | GRASS | 0.6 | 0.1 | grass.wav | 0 | NULL | 1 | 0 | 0 | 0.03 | 0.5 | 0 | 0.2 | 0.4 |
| 3 | KERB | 0.92 | 0 | (empty) | 0 | NULL | 0 | 1 | 0 | 0 | 0 | 0 | 0.3 | 0.2 |
| 4 | WALL | 0.3 | 0 | (empty) | 0 | NULL | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

These five are upstream. STREET is asphalt that isn't the route: leaving the route onto it invalidates the lap. Meshes reach these surfaces by name: a digit then the key (`1ROAD_000`, `1STREET_...`, `1KERB_...`, `1GRASS_...`, `1WALL_...`); other modules depend on the keys (e.g. `bayGround.ts` matches ROAD, STREET, UNSEALED, UNPAVED).

Fork changes, applied in this order:

7. **Traffic** (`traffic` true): SURFACE_0's WAV_PITCH becomes `extended-0` (turns on CSP's extended track physics).
8. **Every street drivable** (`streetsValid` true; area builds and free roam): STREET's IS_VALID_TRACK becomes 1.
9. **Gravel** (`unsealed` true): append the two surfaces from `unsealedSurfaces(streetsValid)` in `src/core/unsealed.ts` (not part of this module; keep calling it). Today they are SURFACE_5 `UNSEALED` (route gravel, always valid) and SURFACE_6 `UNPAVED` (side-street gravel, valid only when `streetsValid`), each FRICTION 0.8, DAMPING 0.02, WAV gravel.wav, WAV_PITCH 0, FF_EFFECT NULL, DIRT_ADDITIVE 0.5, BLACK_FLAG_TIME 0, SIN_HEIGHT 0.012, SIN_LENGTH 0.7, IS_PITLANE 0, VIBRATION_GAIN 0.35, VIBRATION_LENGTH 0.5, then `_EXT_SURFACE_TYPE=GRAVEL`, `_EXT_SURFACE_TYPE_MODIFIER=FIRM`, `_EXT_PERLIN_NOISE=1`, `_EXT_PERLIN_OCTAVES=3`, `_EXT_PERLIN_PERSISTENCE=0.5`. The surface writer must print whatever keys the records carry, in their own order.

**Value format.** `KEY=value`, no spaces. Numbers print as JavaScript's shortest form (`0.99`, `0.1`, `0`, `1`, `0.03`, never `0.990` or `1.0`). An empty string prints as nothing after `=` (`WAV=`).

**Layout of the text** (line endings `\n`, not CRLF):

- Blocks are `[SURFACE_i]` then one line per key, joined with one blank line between blocks; after the last block, a single `\n`.
- **Fork, traffic only:** then a blank line and
  ```
  [_SCRIPTING_PHYSICS]
  ALLOW_TOOLS=1
  ALLOW_TRACK_SCRIPTS=1
  ALLOW_NEW_MODE_SCRIPTS=1
  ```
  each line ending `\n`. (CSP's traffic planner tool needs ALLOW_TOOLS; track scripts such as `autotest.lua` need ALLOW_TRACK_SCRIPTS; CSP's Traffic mode, a new-mode script, needs ALLOW_NEW_MODE_SCRIPTS. A track with these won't pass an online server's checksum against the Kunos-style original, but LAN between machines with the same build is fine.) Tests match this exact four-line block.
- **Fork, `trackScripts` without traffic** (every build passes it, for the automatic test's `autotest.lua`): `WAV_PITCH=extended-0` on ROAD as with traffic, then a blank line and `[_SCRIPTING_PHYSICS]` with only `ALLOW_TRACK_SCRIPTS=1`. With traffic too, only the traffic block above.
- **Fork, when `at` is given:** then a blank line and
  ```
  [WEATHER_FX]
  LATITUDE=<lat to 5 decimals>
  LONGITUDE=<lng to 5 decimals>
  TIMEZONE_ID=<timezoneOf(at)>        (only when timezoneOf gives one)
  ```
  each line ending `\n`. CSP's sun path (and Pure, through CSP) takes the track's position from here; see docs/csp.md, "Coordinates and timezone".

So without options the text ends `VIBRATION_LENGTH=0\n`; nothing follows.

### `timezoneOf` (Fork)

The IANA zone for a point in Australia, by rough state borders. Checks in this order; the first match wins:

1. Outside lat -44 to -10 or lng 112 to 154 (that is, lat > -10, lat < -44, lng < 112 or lng > 154): `undefined`.
2. lng < 129: `Australia/Perth`.
3. lat > -26 and lng < 138: `Australia/Darwin`.
4. lng < 141: `Australia/Adelaide`.
5. lat > -29: `Australia/Brisbane`.
6. lat < -39.2: `Australia/Hobart`.
7. lat < -34 and lng < 150: `Australia/Melbourne`.
8. Otherwise `Australia/Sydney`.

Perth (115.86, -31.95) and all of south-west WA give `Australia/Perth`.

### `uiTrackJson`

A JSON object pretty-printed with 2-space indent, followed by `\n`. Keys in this order:

| Key | Value |
| --- | --- |
| name | `meta.name` |
| description | `meta.description`, else `<name>, built from the real road with OpenStreetMap and open elevation data.` |
| tags | `["real road", "circuit" or "point to point" (by `closed`), "street", "osm"]`, then **Fork:** `"traffic-planner-ready"` appended when `opts.traffic` is true |
| geotags | `[lat, lng]` strings from `centre`: absolute value to 5 decimals, a space, then `N`/`S` (lat >= 0 is N) or `E`/`W` (lng >= 0 is E). E.g. `["31.95000 S", "115.86000 E"]` |
| country | `meta.country` or `""` |
| city | `meta.city` or `""` |
| length | string of `round(length)` (metres) |
| width | string of `round(width)` (metres) |
| pitboxes | string of `pitboxes` |
| run | `"clockwise"` when closed, else `"A to B"` |
| author | `meta.author` or `"AC Track Builder"` |
| version | `"1.0"` |

Numbers are strings, as Kunos's own ui_track.json files have them. The traffic tag is what CSP's Traffic mode lists tracks by (`ALLOWED_TRACKS=#traffic-planner-ready` in its manifest). `run-test.ps1` reads `pitboxes` to size the grid.

### `trackMap` (Upstream): `map.png` and `data/map.ini`

Constants: MARGIN = 20 px, MAX = 2048 px.

1. Bounding box of the points: minX, maxX, minZ, maxZ. extent = max(maxX - minX, maxZ - minZ, 1).
2. scale (metres per pixel) = max(1, extent / (2048 - 2 * 20)). Never finer than 1 m per pixel.
3. width = ceil((maxX - minX) / scale) + 40; height = ceil((maxZ - minZ) / scale) + 40.
4. X_OFFSET = -minX + 20 * scale; Z_OFFSET = -minZ + 20 * scale. AC maps world to pixels with px = (X + X_OFFSET) / SCALE_FACTOR, pz = (Z + Z_OFFSET) / SCALE_FACTOR, so the box starts one margin in from the top-left corner.
5. PNG: width x height, transparent background, the points drawn as one polyline 8 px wide in opaque white (255, 255, 255, 255) through the transform above.
6. ini, `\n` line endings, ending with a newline:
   ```
   [PARAMETERS]
   WIDTH=<width>
   HEIGHT=<height>
   MARGIN=20
   SCALE_FACTOR=<scale to 6 decimals>
   X_OFFSET=<to 4 decimals>
   Z_OFFSET=<to 4 decimals>
   DRAWING_SIZE=10
   ```

Callers close a loop by repeating the first point; the module doesn't.

### `streetMap` (Fork): `extension/street_map.png` and `.ini`

The whole street network for the Busselton Map app. Same transform as map.ini.

1. Bounding box over the route points and every street point together.
2. margin = 40 px; scale = max(0.75, max(maxX - minX, maxZ - minZ, 1) / (maxPixels - 80)), maxPixels default 3072.
3. width, height and offsets as in `trackMap`, with this margin and scale.
4. PNG on transparent, drawn in this order (casing first, then fill, so crossings join cleanly):
   1. every street, width max(3, street.width / scale) + 3 px, colour (40, 44, 52, 255);
   2. the route, width max(4, 8 / scale) + 3 px, same dark colour;
   3. every street, width max(3, street.width / scale), colour (205, 208, 214, 255);
   4. the route, width max(4, 8 / scale), colour (245, 196, 66, 255) (yellow).
5. ini, `\n` line endings, ending with a newline: `[PARAMETERS]`, `WIDTH`, `HEIGHT`, `MARGIN=40`, `SCALE_FACTOR` (6 decimals), `X_OFFSET`, `Z_OFFSET` (4 decimals). No DRAWING_SIZE. The Lua app parses `KEY=value` lines (spaces around `=` tolerated) and needs WIDTH, HEIGHT, SCALE_FACTOR, X_OFFSET and Z_OFFSET.

### `outlinePng` (Upstream)

512 x 512, transparent. Fit the points into the box with a 24 px margin (below), and draw one polyline 10 px wide, opaque white.

**Fit** (shared with `previewPng`): s = min((w - 2m) / max(1, maxX - minX), (h - 2m) / max(1, maxZ - minZ)); the drawing is centred: ox = (w - (maxX - minX) * s) / 2, oz = (h - (maxZ - minZ) * s) / 2; a point maps to (ox + (x - minX) * s, oz + (z - minZ) * s). Z grows downward in the image, so north is up.

### `previewPng` (Upstream)

1024 x 576, background (24, 26, 32, 255). Fit with a 48 px margin. Draw the line 14 px wide in (70, 74, 84, 255), then 6 px wide in (245, 196, 66, 255) on top; a green dot radius 12 (80, 220, 120, 255) at the first point; when not closed, a red dot radius 12 (235, 80, 80, 255) at the last point.

### `readme` (Upstream)

Plain text, `\n` line endings, these lines in order (ending with a trailing newline):

1. `meta.name`
2. blank
3. `Install: copy this folder into assettocorsa/content/tracks/ (or drag the zip onto Content Manager).`
4. blank
5. `Data sources:`
6. `- Road network (c) OpenStreetMap contributors, ODbL. https://www.openstreetmap.org/copyright`
7. `- Routing by OSRM (project-osrm.org) on OpenStreetMap data.`
8. `- Elevation: Terrain Tiles on AWS Open Data (Mapzen/Tilezen), from SRTM, USGS 3DEP, GMTED and national datasets.`
9. with imagery: `- Aerial imagery: <imagery>. For personal use only; do not redistribute this track.`; without (`null`): `- Terrain textures are procedural.`
10. blank
11. `Assetto Corsa is a trademark of Kunos Simulazioni. This track is not affiliated with or endorsed by Kunos.`
12. an empty final line: the lines are joined with `\n`, so the text ends `Kunos.\n` (one trailing newline).

## Edge cases

- `trackMap`, `streetMap`, `outlinePng`, `previewPng` with an empty point list: the old code produces NaN sizes and throws inside the raster. Callers never pass one (a route has at least two samples). The rewrite should throw a clear error instead.
- A single point (or all points equal): extent is treated as 1, so the image is the margin square with a dot-sized or empty line.
- `streetMap` with no streets: just the route.
- `uiTrackJson` with `centre` on the equator or prime meridian: `0.00000 N`, `0.00000 E`.
- `surfacesIni(false, true)` with no gravel: only STREET changes.

## Known issues (fix rather than copy, each with a test)

1. **Slug can end in `_`.** The 40-character cut happens after trimming, so a name whose 40th character falls in a separator run keeps a trailing underscore (e.g. 39 letters, a space, more letters gives `<39 letters>_`). Fix: cut first, then trim. This changes the folder name for long names only; check no existing route name is affected (`routes/*.json` names are all short today; check before merging, since a changed slug orphans installed tracks).
2. **Two slug implementations.** `scripts/upgrade/base.mjs` repeats the steps without the 40-character cut, so a long name gives a different slug there. After the rewrite, make it import or mirror `slugify` exactly (outside this module; note it in the PR).
3. **Wrong elevation credit for WA builds.** The README always credits AWS Terrain Tiles, but WA builds use static tiles from Geoscience Australia's 5 m DEM (`STATE_DEMS.wa`, `scripts/dem/make_wa_tiles.py`). Fix: take the elevation credit as an argument (or from `TrackMeta`), defaulting to today's line; the pipeline passes the GA credit for WA. Also consider a Mapillary line when house looks came from Mapillary (CC BY-SA needs attribution). Both need a caller change in `track.ts`; keep the default output identical so existing tests pass.
4. **`run` is always "clockwise" for a circuit.** It is informational only (AC and CM show it), but it can be wrong. Optional fix: work out the direction from the signed area of the outline (in AC X/Z, remembering Z is south) and write `"clockwise"` or `"anticlockwise"`. Would need the points passed in; leave as is unless Mac wants it.
5. **`timezoneOf` is rough at borders.** Lismore, Byron Bay and Tweed Heads (NSW, lat -28.2 to -29) come out `Australia/Brisbane` (an hour out in summer); Broken Hill (NSW, on SA time) comes out `Australia/Sydney`; Canberra, Wagga Wagga and Albury come out `Australia/Melbourne` (same offset and daylight saving as Sydney, so harmless). Nothing in WA is affected. Optional fix: special-case the far north coast of NSW (lat between -29 and -28.15, lng > 152.5: Sydney) and Broken Hill (`Australia/Broken_Hill` within about 30 km of 141.47, -31.95). Write the rule as a table with tests either way.
6. **`streetMap`'s doc comment mentions the sea edge**, but no sea is drawn. Either drop the claim or add a sea polyline input; drop it unless Mac asks.

## Possibly unused (for Mac to decide)

- `streetMap`'s `maxPixels` parameter: no caller passes it (keep; tests may use it to make small images).
- `timezoneOf` is exported but only used inside the module today. Keep it exported so it can be tested directly.

## Tests to write

slugify:
1. "Busselton Foreshore" to `busselton_foreshore`; "Café  Strip!" to `cafe_strip`; "  --x--  " to `x`; "" and "!!!" to `real_road`.
2. A 60-character name gives at most 40 characters and (after fix 1) never ends in `_`.

surfaces.ini:
3. Default: five blocks keyed ROAD, STREET, GRASS, KERB, WALL, numbered 0 to 4, each with the 14 keys in the table's order and exactly the table's values (compare every line).
4. Line endings are `\n` only; blocks separated by one blank line; default output ends with `VIBRATION_LENGTH=0\n` and has no `_SCRIPTING_PHYSICS` or `WEATHER_FX`.
5. Traffic: SURFACE_0 has `WAV_PITCH=extended-0`, other surfaces keep `WAV_PITCH=0`; the text contains exactly `\n[_SCRIPTING_PHYSICS]\nALLOW_TOOLS=1\nALLOW_TRACK_SCRIPTS=1\nALLOW_NEW_MODE_SCRIPTS=1\n`.
6. streetsValid: STREET has IS_VALID_TRACK=1; without it, 0.
7. Gravel: seven blocks, keys ROAD, STREET, GRASS, KERB, WALL, UNSEALED, UNPAVED; SURFACE_5 starts the sixth block; `_EXT_SURFACE_TYPE=GRAVEL` present; UNPAVED's IS_VALID_TRACK follows streetsValid. Without gravel, no UNSEALED.
8. WeatherFX: `surfacesIni(false, false, [115.86, -31.95])` ends with `\n[WEATHER_FX]\nLATITUDE=-31.95000\nLONGITUDE=115.86000\nTIMEZONE_ID=Australia/Perth\n`. A point outside Australia (e.g. [10, 50]) has LATITUDE and LONGITUDE but no TIMEZONE_ID line.
9. Traffic and WeatherFX together: `_SCRIPTING_PHYSICS` comes before `WEATHER_FX`.

timezoneOf:
10. Perth, Busselton: Perth. Darwin (130.84, -12.46): Darwin. Alice Springs (133.88, -23.70): Darwin. Adelaide (138.60, -34.93): Adelaide. Brisbane (153.03, -27.47): Brisbane. Hobart (147.33, -42.88): Hobart. Melbourne (144.96, -37.81): Melbourne. Sydney (151.21, -33.87): Sydney. London: undefined. Boundary values (lng exactly 129, 138, 141; lat exactly -26, -29, -39.2, -34) follow the strict comparisons above.

ui_track.json:
11. Parses as JSON; keys in the table's order; length, width and pitboxes are strings of rounded numbers; geotags `["31.95000 S", "115.86000 E"]` for (115.86, -31.95); `circuit`/`clockwise` when closed and `point to point`/`A to B` when not; default description and author.
12. Traffic tag only when `traffic` is true (absent for false and undefined); `street` always present. `TRAFFIC_READY_TAG` is `traffic-planner-ready`.
13. Output ends with `}\n` and uses 2-space indentation.

map.ini and map.png:
14. For a 1000 m by 500 m outline: SCALE_FACTOR 1.000000, WIDTH 1040, HEIGHT 540; px(minX) = 20 and pz(minZ) = 20 via the ini's transform; DRAWING_SIZE=10; PNG header gives the same width and height.
15. For a 10 km outline: scale = 10000 / 2008 (6 decimals), width <= 2048.
16. A pixel on the line (mapped through the transform) is opaque white; a corner pixel is transparent.

street map:
17. Two crossing streets and a route: px(minX) = MARGIN and pz(minZ) = MARGIN through the ini; the far corners fit inside WIDTH and HEIGHT; no DRAWING_SIZE; MARGIN=40.
18. Scale never under 0.75 for a tiny network; the route pixel is yellow (245, 196, 66) and a street-only pixel is light grey.

outline and preview:
19. outline is 512 x 512, transparent at the corners, white on the line; a tall thin outline is centred horizontally.
20. preview is 1024 x 576 with the dark background at the corners; first point green; last point red only when not closed.

README:
21. Exact text with imagery "Landgate" and with `null`; trailing newline. (After fix 3, also with a custom elevation credit.)

Golden files: before deleting the old module, save `surfacesIni` for each combination of the four flags, `uiTrackJson` for a closed and an open track, and `trackMap(...).ini` for a fixed outline into `test/fixtures/`; the new module must reproduce them byte for byte (except where a listed fix changes them on purpose).

In-game check: install a rebuilt track; it loads, the minimap shows the route in place, Content Manager shows the outline and the right tags, the Busselton Map app draws the streets, and (traffic builds) CSP's Traffic mode lists the track.

## Sources

- Kunos track folder conventions (`data/surfaces.ini`, `data/map.ini`, `ui/ui_track.json`, `map.png`, `ui/outline.png`, `ui/preview.png`) as shipped with Kunos tracks and described by Content Manager / AcTools (gro-ove): https://github.com/gro-ove/actools
- CSP (acc-extension-config wiki): "Tracks - Surface tweaks" (`_EXT_` surface keys), extended physics (`WAV_PITCH=extended-0`, `[_SCRIPTING_PHYSICS]`), WeatherFX track coordinates. Fork notes: docs/csp.md, docs/traffic-test.md.
- CSP Traffic mode (acc-lua-internal `included-new-modes/traffic/manifest.ini`: `ALLOWED_TRACKS=#traffic-planner-ready`; `included-tools/traffic/tool.lua`: the ALLOW_* hint).
