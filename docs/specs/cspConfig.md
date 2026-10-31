# Spec: CSP track config and AO bake settings (`src/core/cspConfig.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). Write the new module from this page and the public format notes below, without the old file open. Tests are written fresh from the "Tests to write" list.

Provenance: upstream (honestjams: 0ec2745 Grass FX, 56aff2f rain/windows/light pollution/shadows, bd0c844 race-day materials) with large fork additions; listed in `UPSTREAM-FILES.txt`. Upstream here means what `upstream/main` has today. Each section below is marked **Upstream**, **Upstream, fork-changed** or **Fork**.

## What the module is for

Two text files in the track folder:

- `extension/ext_config.ini`: the track's own Custom Shaders Patch config (night lights, Grass FX, Rain FX, seasons, water, Pure haze, wind, track scripts). Plain AC ignores it. **Upstream, much extended by the fork.**
- `baked_shadow_params.ini`: settings for CSP's vertex AO bakery (`bakeryoptix.exe`), read when it bakes a `models_<layout>.ini` (`scripts/windows/bake-vao.ps1`). **Fork.**

The module only assembles text. Several fork modules contribute their own ext_config lines, which this module splices in at fixed places: `pureConfig.ts`, `flags.ts`, `jettyTrain.ts`, `trackSounds.ts`. Those producers are not part of this rewrite; keep calling them.

## Public API (keep these names and shapes)

### `CspOptions` (type)

All optional. Upstream had only `builtUp` and `radiusKm`.

| Field | Type | Meaning | Origin |
| --- | --- | --- | --- |
| `builtUp` | boolean | A town glow over the skyline at night | Upstream |
| `radiusKm` | number | How far the glow reaches, km | Upstream |
| `autotest` | boolean | Load `extension/autotest.lua` as a track script | Fork |
| `drySummer` | boolean | South-west WA seasons: grass goes straw December to April | Fork |
| `sea` | boolean | There's sea in the track (`sea` material) | Fork |
| `photoSea` | boolean | The bay's photo lies under the water; the surface is partly clear (`photoSea.ts`) | Fork |
| `trees` | string | CSP instanced trees: the list's path under `extension/` (e.g. `trees/trees.txt`) | Fork |
| `vines` | boolean | Vine rows (`vine_leaf` material) turn gold in autumn | Fork |
| `hollows` | `Hollow[]` | Rain hollows (`rainHollows.ts`). Present, even empty, switches on the relief map | Fork |
| `sounds` | `SoundEmitter[]` | Track sound emitters (`trackSounds.ts`) | Fork |
| `soundMode` | `"lua" \| "fmod"` | How they play; anything but `"fmod"` means the Lua script | Fork |
| `pure` | `AtmosphereInput` | Pure tuning from the build (`pureConfig.ts`); absent means the generic block | Fork |
| `flags` | boolean | Flags wave in CSP's wind (`flags.ts`) | Fork |
| `jettyTrain` | boolean | Load `extension/jetty_train.lua` (`jettyTrain.ts`) | Fork |

`Hollow` is `{ low: [x, y, z]; centre; depth; area; volume; radius }` in AC coordinates (from `rainHollows.ts`). `SoundEmitter` and `AtmosphereInput` come from `trackSounds.ts` and `pureConfig.ts`.

### Functions and constants

- **`extConfig(lights: Vec3[], opts: CspOptions = {}): string`**. `lights` are lantern positions in local metres (x east, y north, z up). Upstream, extended.
- **`bakedShadowParams(quality: "test" | "final" = "final"): string`**. Fork.
- **`RELIEF_MATERIALS`** (string constant). Fork.
- **`hollowLines(hollows: Hollow[]): string[]`**. Fork.
- **`photoSeaWaterLines(): string[]`**. Fork.

### Call sites (from `grep`, 31 Oct 2026)

- `src/core/track.ts`: `extConfig([...street lights, ...car park lights, ...jetty lamps], {...})` into `<slug>/extension/ext_config.ini`, and `bakedShadowParams()` (default quality) into `<slug>/baked_shadow_params.ini`. The options it passes: `autotest: opts.traffic`; `flags: opts.wavingFlags !== false`; `jettyTrain` when the jetty precinct has a train and the option isn't off; `drySummer` when the centre is inside lng 112 to 119.5, lat -36 to -30; `sea` when there is ocean; `photoSea`; `trees: "trees/trees.txt"` when CSP trees are on and written; `vines` when the farm has vine rows; `hollows` (when `rainHollows`); `sounds` and `soundMode`; `builtUp` when more than half the route is town; `radiusKm` = the outline's furthest point from its first point / 2000; `pure` unless `pureTuning` is false.
- `scripts/headless/build-track.mjs` appends layer sidecar lines (`"extConfig": [...]` in a layer's JSON) to the finished file, each group after a blank line and a `; Layer <file>` comment, using auto-numbered `[SECTION_...]` names. So the file must stay valid when more text is appended after it.
- `scripts/windows/bake-vao.ps1` rewrites `RAYS_PER_SAMPLE = <n>` to 32 for `-Quality test` with the regex `^RAYS_PER_SAMPLE = \d+` (multiline). Keep `KEY = value` spacing in that file. It never calls `bakedShadowParams("test")`.
- `scripts/check/autotest_report.py` parses the hollow comment lines (format below) from a run's copy of ext_config.ini; `scripts/windows/run-test.ps1` saves that copy.
- `RELIEF_MATERIALS`: `test/rainHollows.test.ts`. `hollowLines` and `photoSeaWaterLines` are only used inside the module.
- Tests calling `extConfig`: `cspConfig`, `rainHollows`, `photoSea`, `farm`, `trackSounds`, `pureConfig`, `flags`, `jettyTrain`; `track.test.ts` reads the built file (Grass FX lists, `RELIEF_MATERIALS = road_?` in `[RAIN_FX]`, the file list including `baked_shadow_params.ini`).

## Output: `extension/ext_config.ini`

### Format

- Lines joined with CRLF (`\r\n`). Every section is followed by one empty line, so the file ends with one CRLF after the last key line.
- Keys are `KEY = value` with one space each side of `=` (unlike `surfaces.ini`).
- Numbers written with 2 decimals use JavaScript `toFixed(2)` (so -0.001 prints `-0.00`).
- Comments start with `;`. Comments are not behaviour except where marked (the first line, the hollow lines); a rewrite may drop or reword other comments, but golden-file tests compare the whole text, so keep them unless Mac agrees.
- Section numbering must not collide. Numbered sections are fixed (registry below); sections from other modules or layers that may repeat use CSP's auto-numbered form `[NAME_...]`, which CSP allows beside numbered ones.

### Section registry (who owns which number)

| Section | Owner |
| --- | --- |
| `CONDITION_0` NIGHT_SMOOTH | this module (Upstream) |
| `CONDITION_1` DRY_SEASON, `CONDITION_2` VINE_AUTUMN | this module (Fork) |
| `CONDITION_20` to `CONDITION_24` | `trackSounds.ts` (FMOD mode) |
| `MATERIAL_ADJUSTMENT_0` lanterns, `_1` house windows | this module (Upstream) |
| `MATERIAL_ADJUSTMENT_2` shop signs, `_3` shop windows, `_4` dry season, `_5` vines | this module (Fork) |
| `SHADER_REPLACEMENT_0` thin two-sided, `_1` tiling fix | this module (0 Upstream, 1 Fork) |
| `SHADER_REPLACEMENT_...` | `pureConfig.ts` (bright ground), `flags.ts` (two) |
| `LIGHT_SERIES_0` | this module (Upstream); layers use `LIGHT_SERIES_...` |
| `SCRIPT_0` autotest | this module (Fork) |
| `SCRIPT_1` (or `SCRIPT_0` without autotest) | `trackSounds.ts` (Lua mode) |
| `SCRIPT_...` | `jettyTrain.ts` |
| `SOUNDBANK_0`, `EVENT_<n>` | `trackSounds.ts` (FMOD mode) |
| `WIND` | `flags.ts` |
| `PURE` | this module's generic block, or `pureConfig.ts` |

### Contents, in this exact order

**1. Header (Upstream).** First line: `; Generated by AC Track Builder. Read by Custom Shaders Patch; ignored without it.`, then an empty line.

**2. Include (Upstream).**
```
[INCLUDE]
INCLUDE = common/materials_track.ini
```

**3. Night condition (Upstream).** Night is the sun more than 88 degrees from overhead, as CSP's own configs define it.
```
[CONDITION_0]
NAME = NIGHT_SMOOTH
INPUT = SUN
LUT = (|0=0|88=0|88=1|180=1)
LAG = 0.97
```

**4. Grass FX (Upstream, fork-changed).** Upstream had a shorter material list and different mask/shape values; the fork widened the mask for straw-coloured WA verges and mid-bright pixels only.
```
[GRASS_FX]
GRASS_MATERIALS = terrain_?, strip_photo_?, sidestrips_photo, returns_photo, rbphoto_?, grass, verge
OCCLUDING_MATERIALS = road_?, side_photo_?, concrete, paint?, rrpm, barrier_?, path_?, mulch, fence_?, frontwall_?, hedge, sea, jetty_?
ORIGINAL_GRASS_MATERIALS =
MASK_MAIN_THRESHOLD = 0.12
MASK_RED_THRESHOLD = 0.3
MASK_MIN_LUMINANCE = 0.06
MASK_MAX_LUMINANCE = 0.55
MASK_BLUR = 2
SHAPE_SIZE = 1.0
SHAPE_TIDY = 0.35
SHAPE_CUT = 0.35
SHAPE_WIDTH = 1.0
```
`ORIGINAL_GRASS_MATERIALS =` has nothing after the `= ` (the line is exactly `ORIGINAL_GRASS_MATERIALS =`). The grass list must never contain a `road` material.

**5. Rain FX (Upstream, fork-changed lists; hollows Fork).**
```
[RAIN_FX]
PUDDLES_MATERIALS = road_?, side_photo_?
SOAKING_MATERIALS = road_?, side_photo_?, concrete, path_?
ROUGH_MATERIALS = terrain_?, backdrop_?, strip_photo_?, sidestrips_photo, returns_photo, rbphoto_?, grass, verge, trees, barrier_hedge, hedge, mulch, shrubs, frontwall_?, jetty_?
SMOOTH_MATERIALS = window, glass, signart, steel, lamp
LINES_MATERIALS = paint, paint_yellow
```
then, only when `opts.hollows` is present (even an empty list), the lines of `hollowLines(hollows)` (below), still inside `[RAIN_FX]`.

**6. Thin two-sided shadows (Upstream, fork added `fence_?` and `shrubs`).**
```
[SHADER_REPLACEMENT_0]
MATERIALS = barrier_colorbond, barrier_paling, signart, trees, fence_?, shrubs, race_fence, race_crowd, race_spectators
DOUBLE_FACE_SHADOW_BIASED = 1
```

**7. Lit rooms behind windows (Upstream).**
```
[Material_RoomWindows]
Materials = window
EmissiveMode = ONE
SnapToTexCoords = 1
TexCoordsSnapScale = 1.0
RoomDepth = 4.0
ShapeChance = 0.6
NormalsFactor = 0.8

[MATERIAL_ADJUSTMENT_1]
ACTIVE = 1
DESCRIPTION = Lit rooms behind house windows at night
MATERIALS = window
CONDITION = NIGHT_SMOOTH
KEY_0 = ksEmissive
VALUE_0 = 255, 190, 120, 0.008
OFF_VALUE_0 = 0, 0, 0
```
Note the mixed case of `[Material_RoomWindows]` and its `Materials` key: that is CSP's own spelling for material templates; keep it.

**8. Shop signs and windows at night (Fork).** Two blocks with the same shape as `MATERIAL_ADJUSTMENT_1` (ACTIVE = 1, DESCRIPTION, MATERIALS, CONDITION = NIGHT_SMOOTH, KEY_0 = ksEmissive, VALUE_0, OFF_VALUE_0 = 0, 0, 0, in that key order):

| Section | DESCRIPTION | MATERIALS | VALUE_0 |
| --- | --- | --- | --- |
| `[MATERIAL_ADJUSTMENT_2]` | Shop signs lit at night | shop_sign | 255, 250, 240, 0.35 |
| `[MATERIAL_ADJUSTMENT_3]` | Shop windows glow at night | shop_window | 255, 215, 165, 0.12 |

**9. Light pollution (Upstream), only when `builtUp`.**
```
[LIGHT_POLLUTION]
RELATIVE_POSITION = 0.5, 0, 0.5
DENSITY = 0.15
RADIUS_KM = <max(0.8, radiusKm ?? 1) to 2 decimals>
COLOR = 1.0, 0.72, 0.45
ACTIVE = 1
```

**10. Street lights (Upstream), only when `lights` is non-empty.**
```
[LIGHT_SERIES_0]
DESCRIPTION = Street lights
CONDITION = NIGHT_SMOOTH
COLOR = 255, 236, 210, 0.06
SPOT = 140
SPOT_SHARPNESS = 0.3
RANGE = 30
RANGE_GRADIENT_OFFSET = 0.1
DIFFUSE_CONCENTRATION = 0.7
FADE_AT = 450
FADE_SMOOTH = 60
POSITION_0 = ...
POSITION_1 = ...
```
One `POSITION_<i>` per light, i from 0 in input order, converting local (x, y, z) to AC space: `POSITION_i = <x>, <z>, <-y>`, each to 2 decimals, separated by `, `. Then:
```
[Material_DistantEmissive]
Materials = lamp

[MATERIAL_ADJUSTMENT_0]
ACTIVE = 1
DESCRIPTION = Street light lanterns glow at night
MATERIALS = lamp
CONDITION = NIGHT_SMOOTH
KEY_0 = ksEmissive
VALUE_0 = 255, 236, 210, 0.4
OFF_VALUE_0 = 0, 0, 0
```
With no lights, none of these three sections is written (so `MATERIAL_ADJUSTMENT_0` is missing; that's fine for CSP).

**11. Always (Fork).**
```
[BASIC]
SUPPORTS_WIND = 1

[BOUNCED_LIGHT]
SUPPORTED = 1
SURFACE_MATERIALS = road_?, concrete, path_?, terrain_?, paint?
CAUSTICS = <1 when sea, else 0>

[SHADER_REPLACEMENT_1]
MATERIALS = shader:ksMultilayer?, shader:ksPerPixelMultiMap?
PROP_0 = ksAlphaRef, -193
```
(`ksAlphaRef = -193` on those shaders is CSP's tiling fix for detail maps.) Then Pure: with `opts.pure`, the lines of `pureSections(opts.pure)` from `pureConfig.ts` (a comment, `[PURE]` with its values, and on bright ground a `[SHADER_REPLACEMENT_...]`); without, the generic block CSP's own track configs use:
```
[PURE]
ACTIVE = 1
SUN_DAWN = 1
SUN_DUSK = 1
FOG_LEVEL = 0.05
FOG_BLEND = 1.15
FOG_DISTANCE = 0.9
SMOG_MORNING = 0.05
SMOG_NOON = 0.1
SMOG_EVENING = 0.15
```

**12. Instanced trees (Fork), only when `trees` is set.**
```
[TREES]
LIST_0 = <trees>

[LIGHTING]
ENABLE_TREES_LIGHTING = 1
```

**13. Sea (Fork), only when `sea`.**
```
[Material_Water]
Materials = sea
Type = SEA
UseRecommendedTextures = 1
```
plus, when `photoSea` is also true, the four lines of `photoSeaWaterLines()` appended inside the same section, in order: `UseAlphaFromDiffuse = 1`, `DepthAware = 1`, `CausticsMultiplier = 1.0`, `IS_TRANSPARENT = 1`. (`photoSea` without `sea` writes nothing.)

**14. Dry season (Fork), only when `drySummer`.** Straw from December to April, green June to September, blending in May and October-November (CSP's `seasonAutumn`, masked by greenness so roads, sand and roofs don't change; trees and hedges stay green).
```
[CONDITION_1]
NAME = DRY_SEASON
INPUT = YEAR_DAY
LUT = (|1=1|120=1|152=0|273=0|335=1|365=1|)
LAG = 0

[MATERIAL_ADJUSTMENT_4]
ACTIVE = 1
DESCRIPTION = Grass and verges go straw in the dry season
MATERIALS = terrain_?, strip_photo_?, sidestrips_photo, returns_photo, rbphoto_?, grass, verge, backdrop_?
CONDITION = DRY_SEASON
KEY_0 = seasonAutumn
VALUE_0 = 0.8
OFF_VALUE_0 = 0
```
Note the LUT here ends with `|)`, unlike NIGHT_SMOOTH's `)`. Both are valid CSP; keep each as is.

**15. Vines (Fork), only when `vines`.** Green from budburst to March, gold April and May, left gold through winter.
```
[CONDITION_2]
NAME = VINE_AUTUMN
INPUT = YEAR_DAY
LUT = (|1=0|80=0|110=1|230=1|280=0|365=0|)
LAG = 0

[MATERIAL_ADJUSTMENT_5]
ACTIVE = 1
DESCRIPTION = Vine leaves turn gold in autumn
MATERIALS = vine_leaf
CONDITION = VINE_AUTUMN
KEY_0 = seasonAutumn
VALUE_0 = 1
OFF_VALUE_0 = 0
```

**16. FMOD sounds (Fork):** when `sounds` is non-empty and `soundMode` is `"fmod"`, the lines of `soundConfig(sounds)`.

**17. Flags (Fork):** when `flags`, the lines of `flagCspLines()` (`[WIND]` and two `[SHADER_REPLACEMENT_...]`).

**18. Autotest script (Fork):** when `autotest`:
```
[SCRIPT_0]
SCRIPT = autotest.lua
```

**19. Lua sounds (Fork):** when `sounds` is non-empty and `soundMode` is not `"fmod"`, the lines of `soundScriptConfig(autotest ? 1 : 0)`.

**20. Jetty train (Fork):** when `jettyTrain`, the lines of `jettyTrainConfig()` (`[SCRIPT_...]`, `SCRIPT = jetty_train.lua`, its settings).

Each spliced-in list already ends with an empty element; add nothing between them.

### `RELIEF_MATERIALS` and `hollowLines` (Fork)

`RELIEF_MATERIALS` = `road_?, side_photo_?, concrete, paint?, path_?, terrain_?, strip_photo_?, sidestrips_photo, returns_photo, rbphoto_?, grass, verge` (ground and roads only, never walls, roofs, trees, windows or fences, so buildings don't make false hollows in CSP's puddle height map).

`hollowLines(hollows)` returns:
1. `RELIEF_MATERIALS = <RELIEF_MATERIALS>`
2. `; Hollows where water should stand in the rain (rainHollows.ts): <count>. Lowest point x, y, z; depth; area.`
3. For each hollow, numbered from 1: `; hollow <n>: <low.x>, <low.y>, <low.z>  <round(depth * 100)> cm, <round(area)> m2, <round(radius * 2)> m across`. Coordinates to 2 decimals, as given (already AC space; no conversion). Two spaces before the depth.

The hollow line format is parsed by `scripts/check/autotest_report.py` with: optional spaces, `; hollow N:`, three signed decimals separated by commas, whitespace, an integer then `cm,`, an integer then `m2`. Don't change it without changing the parser.

### `photoSeaWaterLines` (Fork)

Returns the four lines listed in section 13, in that order.

## Output: `baked_shadow_params.ini` (Fork)

CRLF line endings, ending with one CRLF. Exactly:
```
; Generated by Busselton AC. Read by CSP's AO bakery (bakeryoptix.exe) when it bakes this track.
[GENERAL]
MODE = TRACK
USE_VULKAN = 1

[MODE_TRACK]
RAYS_PER_SAMPLE = <96 for "final", 32 for "test">
MIN_SAMPLES_PER_FACE = 4
RAYS_OFFSET = 0.1
BOUNCES = 5
BASE_ALBEDO = 0.9
USE_GROUND = 0
BRIGHTNESS = 1.02
GAMMA = 0.92
OPACITY = 0.97
BAKE_AS_TREES = material:trees, material:shrubs, material:hedge, material:barrier_hedge, shader:ksTree?
BAKE_AS_GRASS = shader:ksGrass?
TREES_LIGHT_PASS_CHANCE = 0.9
TREES_SHADOW_FACTOR = 0.8
EXCLUDE_FROM_BAKING = renderable:n, material:sea, material:sea_photo?, material:shore_foam, material:backdrop_?
FORCE_PASSING_LIGHT = material:sea, material:glass, material:window, material:shop_window
EXT_EXCLUDE_POBJECTS = 1
EXT_REBAKE_DARK_OBJECTS = 1
AO_SAMPLES_PHYSICS_SURFACES = 1
EXT_PROCEDURAL_TREES_OCCLUDE = 0
EXT_PROCEDURAL_TREES_BAKE = 0
EXT_PROCEDURAL_TREES_FINALIZE = 0
```
(no blank line between the comment and `[GENERAL]`). Keys come from the bakery's source; see docs/csp.md.

## Material names this file depends on

The ext_config lists name materials other modules create. Renaming a material elsewhere silently breaks an effect here, so the rewrite should keep these names in one place (named lists) and tests should check the lists, not just the text:

- Ground photo (grass, dry season, rough in rain, relief, bounced light): `terrain_?`, `strip_photo_?`, `sidestrips_photo`, `returns_photo`, `rbphoto_?`, `grass`, `verge`, `backdrop_?` (dry season and rough only).
- Roads and hard surfaces: `road_?`, `side_photo_?`, `concrete`, `paint?` / `paint`, `paint_yellow`, `path_?`, `rrpm`.
- Others: `window`, `glass`, `signart`, `steel`, `lamp`, `shop_sign`, `shop_window`, `trees`, `shrubs`, `hedge`, `barrier_hedge`, `barrier_?`, `barrier_colorbond`, `barrier_paling`, `fence_?`, `frontwall_?`, `mulch`, `sea`, `jetty_?`, `vine_leaf`, `race_fence`, `race_crowd`, `race_spectators`; bakery adds `sea_photo?`, `shore_foam`.

`?` is CSP's wildcard. A list item matching no material is harmless.

## Edge cases

- `extConfig([])` with no options: header through section 8, then section 11 (with the generic `[PURE]` and `CAUSTICS = 0`). No light pollution, light series, relief, trees, water, seasons, scripts or sounds.
- `hollows: []`: the relief line and the "...: 0." comment, no hollow lines.
- `sounds: []`: no sound sections in either mode.
- `soundMode` given without `sounds`: nothing.
- `radiusKm` under 0.8 or missing: 0.80 or 1.00.
- Many lights (thousands in a large area build): one POSITION line each, no limit applied. See "Questions".

## Known issues (fix rather than copy, each with a test)

1. **Duplicate material lists.** The ground-photo list appears in four places with small differences (`backdrop_?` in two of them). Keep the output identical but build the lists from shared named constants so they can't drift apart by accident.
2. **The "every header unique" check ignores auto-numbered sections.** Tests that check unique headers only pass because they don't turn on flags or Pure's bright-ground block, both of which add `[SHADER_REPLACEMENT_...]`. Write the uniqueness test to exclude `_...` headers explicitly, and run it with every option on.
3. **Header comment names the upstream tool** ("Generated by AC Track Builder"), while the bakery file says "Busselton AC". Cosmetic; change only with Mac's agreement (golden files change).
4. **`bakedShadowParams("test")` is never used**: `bake-vao.ps1` patches the number itself. Keep the parameter (cheap) or drop it; see below.

## Possibly unused (for Mac to decide)

- `bakedShadowParams`'s `quality` parameter (the script rewrites RAYS_PER_SAMPLE instead).
- `hollowLines` and `photoSeaWaterLines` as exports: only used inside the module. They can be private, but exported they are easy to test.

## Questions (ambiguous; check before or during the rewrite)

- CSP's limit on `POSITION_<n>` entries in one `LIGHT_SERIES`: not known. Busselton's builds work today, so keep one series; if a bigger area build loses lights, split into `LIGHT_SERIES_...` blocks.
- Whether the sound script index (`SCRIPT_1` after the autotest's `SCRIPT_0`) and the jetty's `SCRIPT_...` together behave in game was marked "to check in game" in docs/csp.md. The rewrite must keep the same numbering either way.

## Tests to write

Base file:
1. `extConfig([[10, 20, 8.2], [-5, 3, 9]])`: contains `NAME = NIGHT_SMOOTH`, `[LIGHT_SERIES_0]`, `POSITION_0 = 10.00, 8.20, -20.00` and `POSITION_1 = -5.00, 9.00, -3.00`; `MATERIALS = lamp\r\nCONDITION = NIGHT_SMOOTH\r\nKEY_0 = ksEmissive`; the same pattern for `shop_sign` and `shop_window`.
2. Sections appear in the order of "Contents" (check the list of headers for the no-option case and for the all-options case).
3. CRLF only (no bare `\n`), `KEY = value` spacing on every key line, file ends with exactly one CRLF.
4. Grass FX: `GRASS_MATERIALS` starts `terrain_?, strip_photo_?`; no grass material starts with `road`; `OCCLUDING_MATERIALS` starts `road_?, side_photo_?, concrete`; every mask and shape value as listed.
5. Rain FX: `[RAIN_FX]\r\nPUDDLES_MATERIALS = road_?`; `ROUGH_MATERIALS = terrain_?` prefix; `LINES_MATERIALS = paint, paint_yellow`.
6. `INCLUDE = common/materials_track.ini`; `[Material_RoomWindows]\r\nMaterials = window`; `[Material_DistantEmissive]\r\nMaterials = lamp` when there are lights.
7. No lights: no `LIGHT_SERIES`, no `Material_DistantEmissive`, no `MATERIAL_ADJUSTMENT_0`.
8. Light pollution: `RADIUS_KM = 1.20` for radiusKm 1.2; `0.80` for 0.3; `1.00` when missing; absent unless `builtUp`.
9. Always-on: `[BASIC]`, `[BOUNCED_LIGHT]` with `CAUSTICS = 0` (1 with `sea`), `[SHADER_REPLACEMENT_1]` with `PROP_0 = ksAlphaRef, -193`; generic Pure has `SMOG_NOON = 0.1\r\n`; with `pure` the generic block is replaced by `pureSections` output (compare to calling it directly).
10. Trees: `[TREES]\r\nLIST_0 = trees/trees.txt` and `ENABLE_TREES_LIGHTING = 1` only when set.
11. Sea: `[Material_Water]\r\nMaterials = sea\r\nType = SEA\r\nUseRecommendedTextures = 1\r\n`; with photoSea the four extra lines follow in order, including `IS_TRANSPARENT = 1`; without, no `UseAlphaFromDiffuse`; photoSea without sea writes no water section.
12. Dry season and vines: their condition and adjustment sections with the exact LUTs, only when on.
13. Hollows: `extConfig([], { hollows: [h] })` with low (50, 1.9, 4), depth 0.1, area 120, radius 12 has, inside `[RAIN_FX]` (before the next section), `RELIEF_MATERIALS = <constant>` and `; hollow 1: 50.00, 1.90, 4.00  10 cm, 120 m2, 24 m across`. `RELIEF_MATERIALS` doesn't match wall, roof, trees, window or fence. Without the option, no `RELIEF_MATERIALS`. With `[]`, the relief line and `: 0.` in the comment.
14. The hollow line parses with the regex from `scripts/check/autotest_report.py` (copy the regex into the test).
15. Scripts: autotest alone gives `[SCRIPT_0]\r\nSCRIPT = autotest.lua`; autotest plus Lua sounds gives `[SCRIPT_1]\r\nSCRIPT = sounds.lua`; Lua sounds alone gives `[SCRIPT_0]\r\nSCRIPT = sounds.lua`; FMOD sounds give `[SOUNDBANK_0]` and `[EVENT_1]` and no `sounds.lua`; `sounds: []` gives neither.
16. Jetty: `[SCRIPT_...]\r\nSCRIPT = jetty_train.lua\r\nspeedKmh = 5` when on, alongside `[SCRIPT_0]` autotest.
17. Flags: `MATERIALS = shader:ksFlags\r\nCULL_MODE = DOUBLESIDED` and `MESHES = FLAGBACK_?\r\nIS_VISIBLE = 0` when on; no `DYNAMIC_FLAGS` when off.
18. Numbered headers are unique with every option on at once (auto-numbered `_...` headers excluded), and every numbered section matches the registry.
19. Appending: the file plus `\r\n; Layer x\r\n[LIGHT_SERIES_...]\r\n...` still has unique numbered headers (simulates build-track.mjs).

Bakery file:
20. Exact text for `"final"` (RAYS_PER_SAMPLE = 96) and `"test"` (32); CRLF; applying bake-vao.ps1's regex `^RAYS_PER_SAMPLE = \d+` (multiline) to the final text matches exactly once.

Golden files: before deleting the old module, save `extConfig` output for (a) no lights, no options; (b) two lights, `builtUp`; (c) every option on, with fixed hollows, sounds in each mode and a fixed `pure` input; and both bakery files, into `test/fixtures/`. The new module must reproduce them byte for byte.

In-game check (workstation): `scripts\windows\run-test.ps1 <slug>` on a rebuilt track: no CSP config errors in the CSP log, street lights and lit windows at night, grass on verges and not on roads, puddles in rain, flags moving, the jetty train script loads (its log line), autotest runs; then a test AO bake with `bake-vao.ps1 -Quality test` completes.

## Sources

- CSP (acc-extension-config wiki): "Tracks - Lights", "Conditions", "Grass FX", "RainFX" (including `RELIEF_MATERIALS`), material templates in `common/materials_track.ini` (`Material_RoomWindows`, `Material_DistantEmissive`, `Material_Water`), and CSP's shipped configs for Kunos tracks (e.g. ks_laguna_seca.ini for the photo-sea water keys, ks_brands_hatch and nevadadrift for RELIEF_MATERIALS, chang.ini and imola.ini for auto-numbered sections).
- CSP's AO bakery (acc-bakeryoptix) source for `baked_shadow_params.ini` keys.
- Fork research notes: docs/csp.md, docs/trees.md.
