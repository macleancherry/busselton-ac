# Spec: build options (`src/core/options.ts`)

Status: spec for a clean rewrite ("Owning the code", ROADMAP.md). Write the new module from this page, without the old file open. Tests are written fresh from "Tests to write". The file is on `UPSTREAM-FILES.txt`.

## What the module is for

One typed record, `BuildOptions`, of everything a build can be tuned by; one table of defaults; one function that fills a partial record with them. It has no logic beyond that. The list of options and their defaults **is** the behaviour: get every name, type and default exactly as below, or builds change.

## Public API (keep names and shapes)

```ts
interface BuildOptions { /* every field in the table below */ }
const DEFAULT_OPTIONS: BuildOptions;
function withDefaults(partial: Partial<BuildOptions>): BuildOptions;
```

- `withDefaults(partial)` = `DEFAULT_OPTIONS` overlaid with `partial` (shallow: a nested value such as `noTrace` or `houseStyle` replaces the default wholesale). Returns a new object; never mutates either input.
- Required fields (no `?`) must all have a value in `DEFAULT_OPTIONS`. Optional fields (`?`) have **no** entry in `DEFAULT_OPTIONS`: their "absent" behaviour is decided where they're read (column "Absent means" below). Keep it that way: adding a default for an optional field changes nothing today but hides the "on unless false" contract the readers rely on.

### Callers of the module (grep, 31 Oct 2026)

- `withDefaults`: `src/core/track.ts:446` (`buildTrack(route, partial, sources)`), `src/core/layouts.ts:319` (`withDefaults({ ...world.options, name: layout.name })`), `scripts/network/phase1.ts:39`; tests `kerbs`, `armco`, `farm`, `bayLanes`, `trace`, `unsealed`, `fixtures/golden-mesh/inputs.ts`.
- `DEFAULT_OPTIONS`: only this module (through `withDefaults`).
- `BuildOptions` type: `src/core/` area, armco, backdrop, buildings (`Pick<BuildOptions, "vergeWidth">`), cameras, challengeFiles, farm, farmRoadsides, fences, furniture, kerbs, kerbside, layouts, markings, road, roadMesh, roundabout, scenery, sideStreets, terrain, track, unsealed, utilities; `src/services/pipeline.ts` (`BuildJob.opts: Partial<BuildOptions>`); `src/ui/main.ts` (`readOptions(): Partial<BuildOptions>`); `scripts/headless/build-track.mjs` (comment only).

## How options reach a build (context, not part of this module)

Precedence, lowest first:

1. `DEFAULT_OPTIONS` (this module).
2. **UI controls**: `src/ui/main.ts` `readOptions()` always supplies the UI-backed fields listed in the "UI" column, so in a real build their effective default is the control's default in `index.html`, not `DEFAULT_OPTIONS` (they agree except `name` and `textureSize`, see Bugs). A browser session may restore earlier control values from the address; headless builds start fresh.
3. **Route `"options"`** (headless): ids of UI controls, set on the page before building (`build-track.mjs`). Only `imagery` and `banking` are used by routes. These are *control ids*, not BuildOptions names.
4. **Route `"build"`** (headless): raw `BuildOptions` fields, passed as `window.__buildOptions` and spread over `readOptions()` (main.ts:491). `build-track.mjs` adds `clears` (from layer sidecars and landmark layers) and `layout` (when the route has `layouts`).
5. **Presets** (`scripts/headless/presets.mjs`, `"preset": "country" | "town"`): fill route `options` and `build` under the route's own values (`applyPreset`). Preset `options` go through the UI (rule 3), preset `build` through rule 4.

Layouts: `layouts.ts` builds each extra layout with `withDefaults({ ...route.build (after preset), name })`, i.e. **without** the UI values (only `pitCount`, `aiKeepLeft`, `timeTrialSectors` and `traffic` are read there; `pitCount` then always comes from the default 8).

`src/services/pipeline.ts` reads a few fields from the *partial* options before `buildTrack` applies defaults, with its own fallbacks (`corridor ?? 90`, `buildingRadius ?? 250`, `horizon ?? 1500`, `sea !== false`, `trafficLights !== false`, truthy `farmland`, `farmRoadsides`, `armco`, `widthOverride`, `imageryZoom`, `area`). See Bugs 3.

## The options (exact)

85 fields. "Default" is `DEFAULT_OPTIONS`; "—" means optional with no default. UI = control in `index.html` read by `readOptions()` (default in brackets). Presets: C = country, T = town (`presets.mjs`; `opt` = via the preset's UI `options`). Readers are `file:line` (src/core unless a path is given), from grep on 31 Oct 2026; lines will drift, the files won't.

### Road shape and size

| Field | Type | Default | UI / preset | Absent means | Read in |
| --- | --- | --- | --- | --- | --- |
| `name` | string | `"My road"` | `#name` (empty → `"Real road"`); layouts set their own | | track.ts:1795 (slug), 2010, 2038; challengeFiles.ts:112, 114 |
| `defaultWidth` | number, m | `6.5` | | | road.ts:76; track.ts:1431 |
| `widthOverride` | number, m (0 = OSM) | `0` | `#width` select 0/4/6/7/9/12 [0] | | road.ts:74; services/pipeline.ts:112, 169 |
| `spacing` | number, m | `2` | | | road.ts:66, 79, 82, 84, 157; roadMesh.ts:244; armco.ts:66, 67, 143, 156, 203, 230; scenery.ts:345, 356, 385, 451; track.ts:1143, 1153, 1167, 1179, 1180, 1283, 1851, 2144, 2157, 2164 |
| `lineSmoothing` | number, m (Gaussian sigma) | `4` | `#lineSmoothing` [4] | | road.ts:56, 58 |
| `elevationSmoothing` | number, m (Gaussian sigma) | `15` | `#elevationSmoothing` [15] | | road.ts:157 |
| `vergeWidth` | number, m | `1.5` | `#vergeWidth` [1.5] | | sideStreets.ts:157, 162, 205; armco.ts:99, 101, 246; roadMesh.ts:129, 138, 236, 285; kerbs.ts:191, 195, 280; fences.ts:53; farmRoadsides.ts:113, 151, 464, 474; terrain.ts:103; farm.ts:246; furniture.ts:77, 137, 292, 341, 394; buildings.ts:272; scenery.ts:221, 340, 386, 464; track.ts:811, 990, 1102, 1107, 1229, 1277, 1324, 1332; roundabout.ts:87, 423, 425; cameras.ts:63; scripts/network/phase1.ts:138 |
| `banking` | boolean | `true` | `#banking` [checked]; C opt `true`, T opt `false` | | road.ts:83 |
| `maxBank` | number (0.06 = 6%) | `0.06` | C `0.04` | | road.ts:84 |
| `crown` | number (0.02 = 2%) | `0.02` | | | sideStreets.ts:267; kerbside.ts:592; markings.ts:174, 263, 307, 371; armco.ts:97; roadMesh.ts:90, 137, 175, 194; kerbs.ts:186, 362; farmRoadsides.ts:98; terrain.ts:93, 94; raceDress.ts:238; track.ts:342, 966, 1112; scripts/network/phase1.ts:125, 262 |
| `pitCount` | number | `8` | `#pitCount` [8], clamped to 1..24 and rounded by the UI | | track.ts:332, 350, 363, 470, 2086; layouts.ts:326 |
| `runUp` | number, m | `60` | | | track.ts:471, 472 |
| `runOff` | number, m | `150` | | | track.ts:471, 472 |
| `traceRoads` | boolean | `true` | `#traceRoads` [checked] | | track.ts:485, 758, 767 |
| `noTrace` | `{ at: [lng, lat]; radius: m }[]` | `[]` | map zones in the UI, radius 60 (`ZONE_RADIUS`); route `build.noTrace` replaces them | | track.ts:491, 492 (fade over 30 m) |
| `traceGuard` | boolean | `true` | C `false` | | track.ts:490; sideStreets.ts:395 |
| `origin` | `[lng, lat]` | — | route `build.origin` (every route) | centre of the route's bounding box | track.ts:451 |
| `area` | `[lng, lat][]` or `[lng, lat][][]` | — | route `build.area` | no area build | track.ts:458; services/pipeline.ts:61 |
| `layout` | string | — | set by build-track.mjs from route `layout.id` (default `"main"`) when `layouts` exist | single-layout track | track.ts:1840, 2101 |
| `unsealed` | boolean | — | route `build.unsealed` | off (OSM decides) | track.ts:892, 893 |
| `gravelRoads` | boolean | — | | **on** unless `false` | track.ts:891 |
| `networkCore` | boolean | — | | off unless `true` | track.ts:962, 2097; forced `true` by scripts/network/phase1.ts:39 |

### Terrain and imagery

| Field | Type | Default | UI / preset | Absent means | Read in |
| --- | --- | --- | --- | --- | --- |
| `corridor` | number, m | `90` | `#corridor` 50/90/150/250 [90]; C `70` | | sideStreets.ts:158, 163; backdrop.ts:64, 68, 69, 70, 97; fences.ts:73, 121, 123; area.ts:149, 153–156; terrain.ts:47, 58, 89, 261; farm.ts:248; furniture.ts:296; utilities.ts:121; scenery.ts:214, 217; track.ts:505, 555, 1294, 1475, 1735; services/pipeline.ts:68, 82 |
| `terrainStep` | number, m | `3` | C `2.5`, T `1.5` | | terrain.ts:79, 238, 446; track.ts:1245; roundabout.ts:87 |
| `terrainUnderRoad` | number, m | `0.6` | C `0.2`, T `0.12` | | terrain.ts:80, 129 |
| `terrainBlend` | number, m | `20` | | | terrain.ts:89, 109, 125, 141; track.ts:505 |
| `chunkSize` | number, m | `200` | | | terrain.ts:47, 446 |
| `terrainLod` | boolean | `true` | | | terrain.ts:277 |
| `terrainLodNear` | number, m | `25` | | | terrain.ts:286 |
| `terrainLodFarTol` | number, m | — | | `0.05` (terrain.ts `LOD_TOL_FAR`) | terrain.ts:278 |
| `wallOffset` | number, m (0 = none) | `10` | `#walls` 5/10/25/0 [10] | | roadMesh.ts:232, 236, 285; roundabout.ts:422, 423, 425 |
| `imageryZoom` | number (0 = no imagery) | `18` | `#imagery`: off 0, standard 18 [default], high 19, ultra 20; C and T opt `"high"` | | track.ts:678, 680, 1039, 1088; services/pipeline.ts:136 |
| `textureSize` | number, px | `1024` | `#imagery`: ultra 2048, high 1024, standard/off 512 | | track.ts:680 |
| `demZoom` | number | `14` | | | track.ts:506, 509 |
| `horizon` | number, m (0 = none) | `1500` | `#horizon` 0/1500/3000 [1500]; C `1000` | | backdrop.ts:37, 48; track.ts:508, 509, 1540; services/pipeline.ts:88 |
| `horizonZoom` | number | `16` | | | track.ts:681 |
| `sea` | boolean | `true` | | | track.ts:512, 513, 521; services/pipeline.ts:88, 107 (`!== false`) |
| `photoSea` | boolean | — | | **on** unless `false` (and only with sea in view) | track.ts:634 |
| `groundDetail` | boolean | `true` | | | **never read** (see "Could be deleted") |
| `detailShaders` | boolean | `true` | `#detailShaders` [checked] | | track.ts:585, 604, 615, 723, 749, 833, 873, 906 |
| `zones` | boolean | — | C `true` | off | track.ts:526 |
| `pureTuning` | boolean | — | | **on** unless `false` | track.ts:2076 |
| `rainHollows` | boolean | — | | off | track.ts:2012 |

### Trees, buildings, scenery

| Field | Type | Default | UI / preset | Absent means | Read in |
| --- | --- | --- | --- | --- | --- |
| `trees` | number: 0 off, 1 normal, 2 dense | `1` | `#trees` 0/1/2 [1]; forced 0 when `#imagery` is off | | track.ts:735, 739, 1339 |
| `maxTrees` | number | `12000` | | | track.ts:1299, 1303 |
| `cspTrees` | boolean | — | route `build.cspTrees` | off | track.ts:527, 1292, 1306, 1812, 1985, 2067 |
| `buildings` | boolean | `true` | `#buildings` ≠ "off" [all] | | track.ts:692, 736, 781, 786, 1695, 1791 |
| `detectBuildings` | boolean | `true` | `#buildings` = "all" [all] | | track.ts:692, 736, 786 |
| `buildingRadius` | number, m | `250` | | | track.ts:810; services/pipeline.ts:77 |
| `houseStyle` | `{ facades: Record<string, number> }` | — | route `build.houseStyle` | the usual mix | track.ts:1542, 1546 |
| `clears` | `{ at: [lng, lat]; radius: m; trees?: boolean }[]` | — | set by build-track.mjs (layer sidecars, landmark layers) | none | track.ts:454, 455 (`trees` absent = clear trees too) |
| `paths` | boolean | `true` | | | track.ts:1362 |
| `landmarks` | boolean | `true` | `#landmarks` [checked] | | track.ts:1511 |
| `streetSigns` | boolean | `true` | `#streetSigns` [checked] | | track.ts:1510, 1521 |
| `sideStreets` | boolean | `true` | `#sideStreets` [checked] | | track.ts:753, 1236, 1432 |
| `guardRails` | boolean | `true` | `#guardRails` [checked] | | track.ts:1395, 1399, 1406 |
| `guidePosts` | boolean | `true` | `#guidePosts` [checked] | | track.ts:1416 |
| `armco` | boolean | — | C `true`, T `false` | off | track.ts:1399 (needs `guardRails`), 1414; services/pipeline.ts:95 |
| `farmland` | boolean | — | C `true` | off | track.ts:1328; fences.ts:79; services/pipeline.ts:67 |
| `farmRoadsides` | boolean | — | C `true`, T `false` | off | track.ts:1418; services/pipeline.ts:76 (cattle-grid query) |
| `wavingFlags` | boolean | — | | **on** unless `false` | track.ts:1507, 1597, 2061 |
| `jettyTrain` | boolean | — | | **on** unless `false` | track.ts:2055, 2062 |
| `trackSounds` | `boolean \| "lua" \| "fmod"` | — | | off; `"fmod"` → FMOD, any other truthy → Lua (`trackSounds.ts` `soundMode`) | track.ts:2013 |
| `poleClear` | boolean | — | | **on** unless `false` | track.ts:1274 |
| `raceDress`, `sponsors` | boolean, string | — | `#raceDress`, `#sponsors` (old UI) | ignored: race dressing was deleted (31 Oct); the fields stay only while the old UI sends them | none |

### Road surface, markings, kerbs, parking

| Field | Type | Default | UI / preset | Absent means | Read in |
| --- | --- | --- | --- | --- | --- |
| `roadSurface` | `"auto" \| "asphalt" \| "chipseal" \| "photo"` | `"auto"` | `#surface` [auto] | | track.ts:859, 923, 1117 |
| `markings` | boolean | `true` | `#markings` [checked] | | track.ts:1147, 1175, 1223, 1229, 1235 |
| `kerbs` | boolean | `true` | `#kerbs` [checked] | | track.ts:978, 1087, 1103 |
| `kerbside` | boolean | — | T `true` | off (and needs `markings`) | track.ts:1235 |
| `laneBayClear` | boolean | — | | **on** unless `false` (only with kerbside bays) | track.ts:1240 |
| `carParks` | boolean | `true` | | | track.ts:661, 664, 667, 690 |
| `parkedCars` | boolean | `true` | | | track.ts:703 |
| `parkedBays` | boolean | — | | **on** unless `false` | track.ts:1714 |
| `padClear` | boolean | — | | **on** unless `false` | track.ts:1941 |
| `trafficLights` | boolean | — | | **on** unless `false` | track.ts:1427; services/pipeline.ts:76 (signals query) |

### AI, traffic, game files

| Field | Type | Default | UI / preset | Absent means | Read in |
| --- | --- | --- | --- | --- | --- |
| `traffic` | boolean | `false` | C `true` | | track.ts:1910, 2028, 2029, 2048, 2049, 2059, 2086; layouts.ts:419 |
| `trafficZones` | boolean | `true` | | | track.ts:1870, 1898 |
| `trafficSetting` | `"normal" \| "kids"` | `"normal"` | (a layout's `"traffic": "kids"` is applied after the build by build-track.mjs, not through this field) | | track.ts:1906 |
| `aiKeepLeft` | boolean | — | C `true`, T `true` | off | track.ts:1996; layouts.ts:273 |
| `streetsValid` | boolean | — | route `build.streetsValid` | `true` when there's an `area`, else `false` | track.ts:2028 |
| `challenges` | `ChallengesOption` (from `./challenges`) | — | route `build.challenges` | generated checkpoints | challengeFiles.ts:110 |
| `timeTrialSectors` | number | — | | 3 (clamped 1..8 in timeTrial.ts) | challengeFiles.ts:112; layouts.ts:402 |
| `driftZones` | boolean | — | | **on** unless `false` | challengeFiles.ts:116 |

Not BuildOptions readers despite matching names (don't be misled when grepping): `cspConfig.ts` (`CspOptions.sea/trees/photoSea/jettyTrain`), `timeTrial.ts` (`{ name, sectors }`), `acFiles.ts` `uiTrackJson` (`{ traffic, ... }`, fed from `opts.traffic`), `landmarkLayer.ts` (`{ detailShaders, drawSigns }`), `network/dress.ts` and `network/phase1.ts` (their own `vergeWidth`/`markings` fields), `network/heights.ts` (`crown`), `cruise.ts` (`landmarks`).

### Presets, complete (`scripts/headless/presets.mjs`, for checking the table)

- **country**: options `{ imagery: "high", banking: true }`; build `{ terrainStep: 2.5, terrainUnderRoad: 0.2, traceGuard: false, traffic: true, corridor: 70, horizon: 1000, maxBank: 0.04, armco: true, farmland: true, farmRoadsides: true, zones: true, aiKeepLeft: true }`.
- **town**: options `{ imagery: "high", banking: false }`; build `{ terrainStep: 1.5, terrainUnderRoad: 0.12, armco: false, farmRoadsides: false, kerbside: true, aiKeepLeft: true }`.

Routes on 31 Oct 2026 (routes/ and routes/private/) set these `build` fields: origin, traffic, corridor, traceGuard, area, streetsValid, noTrace, terrainStep, terrainUnderRoad, houseStyle, farmRoadsides, armco, aiKeepLeft, unsealed, terrainLodFarTol, horizon, cspTrees; plus a non-option `_areaNote` comment key (ignored, harmless).

## Bugs and weak spots (fix, don't copy)

1. **`textureSize` default disagrees with the UI.** `DEFAULT_OPTIONS.textureSize` is 1024, but the UI's default imagery ("standard") gives 512. Real builds always pass the UI value; only tests and `layouts.ts` see 1024 (layouts don't use it). Keep 1024 (the tests' fixtures expect it) and note it; don't silently change it.
2. **`name` fallback differs:** `"My road"` here, `"Real road"` in the UI when the field is empty. Harmless; keep `"My road"`.
3. **Defaults duplicated in pipeline.ts.** It reads the partial options with its own fallbacks (90, 250, 1500, `!== false`). They match today. Better: pipeline calls `withDefaults(job.opts)` once and reads the result (a pipeline change for its own rewrite, Nov 21; note it there).
4. **`undefined` overrides defaults.** `withDefaults({ corridor: undefined })` yields `corridor: undefined` (spread copies undefined). Fix: skip keys whose value is `undefined` when overlaying, so a partial never erases a default. No caller relies on the old behaviour.
5. **`scripts/network/phase1.ts` mixes namespaces.** It does `withDefaults({ ...route.options, ...route.build })`: route `options` are UI control ids (`imagery` leaks in as an unknown key; `banking` happens to match) and presets aren't applied. Fix in that script (call `applyPreset`, map `imagery` like main.ts, or ignore route.options); not this module's job, flag to the lead.
6. **No validation.** Unknown keys (typos in a route's `build`) are silently ignored. Add an exported `unknownOptionKeys(obj): string[]` (keys not in `DEFAULT_OPTIONS` or the optional-field list; ignore keys starting with `_`, used for notes) so build-track.mjs can warn. Optional; small and testable.
7. Header comment says defaults aim at "a two-lane mountain road" (upstream's goal). The fork's town preset overrides the hilly-road defaults (CLAUDE.md, "Busselton is flat"). Don't change the defaults (that changes every build); do say so in the new file's comment.

## Could be deleted (lead checks with Mac)

- **`groundDetail`**: never read; ksMultilayer ground is controlled by `detailShaders`. Delete the field (and its default). `textures.ts` has an unrelated function `groundDetail` that stays.
- **`carParkIslands`**: deleted with `findIslands`/`buildIslands` (31 Oct).
- **`raceDress` and `sponsors`**: deleted with race dressing (31 Oct); left as ignored optional fields until the old UI goes.
- Pure tuning numbers no UI, preset or route sets (`chunkSize`, `demZoom`, `horizonZoom`, `terrainBlend`, `terrainLodNear`, `maxTrees`, `runUp`, `runOff`, `buildingRadius`, `spacing`, `defaultWidth`, `crown`): could become module constants, but several are used by tests to shape fixtures. Recommend keeping them as options.
- The "on unless false" switches (`gravelRoads`, `photoSea`, `pureTuning`, `wavingFlags`, `jettyTrain`, `poleClear`, `padClear`, `parkedBays`, `laneBayClear`, `trafficLights`, `driftZones`) are escape hatches for regressions; keep.

## Tests to write

1. **Exact field list.** `Object.keys(DEFAULT_OPTIONS).sort()` equals the 54 required fields of this page, sorted: banking, buildingRadius, buildings, carParkIslands, carParks, chunkSize, corridor, crown, defaultWidth, demZoom, detailShaders, detectBuildings, elevationSmoothing, groundDetail (until deleted), guardRails, guidePosts, horizon, horizonZoom, imageryZoom, kerbs, landmarks, lineSmoothing, markings, maxBank, maxTrees, name, noTrace, parkedCars, paths, pitCount, raceDress, roadSurface, runOff, runUp, sea, sideStreets, spacing, sponsors, streetSigns, terrainBlend, terrainLod, terrainLodNear, terrainStep, terrainUnderRoad, textureSize, traceGuard, traceRoads, traffic, trafficSetting, trafficZones, trees, vergeWidth, wallOffset, widthOverride. (Count them in the test; if `groundDetail` is deleted, 53.)
2. **Exact defaults.** A literal table in the test of every required field and its value from this page (e.g. `corridor: 90`, `terrainUnderRoad: 0.6`, `textureSize: 1024`, `raceDress: false`, `sponsors: DEFAULT_SPONSORS`, `noTrace: []`, `trafficSetting: "normal"`), compared with `toEqual`.
3. **No defaults for optional fields.** None of the 31 optional fields (armco, parkedBays, kerbside, laneBayClear, houseStyle, origin, area, aiKeepLeft, streetsValid, layout, clears, challenges, timeTrialSectors, driftZones, terrainLodFarTol, cspTrees, rainHollows, trackSounds, gravelRoads, unsealed, zones, pureTuning, photoSea, farmland, farmRoadsides, wavingFlags, jettyTrain, trafficLights, poleClear, padClear, networkCore) is a key of `DEFAULT_OPTIONS`.
4. **withDefaults.** `withDefaults({})` deep-equals `DEFAULT_OPTIONS` but isn't the same object; a partial value wins; an optional field passes through; `undefined` values don't erase defaults (after Bugs 4); neither input is mutated; `noTrace` from the partial replaces the default array, and mutating the result's `noTrace` doesn't change `DEFAULT_OPTIONS.noTrace` (freeze `DEFAULT_OPTIONS`, or copy arrays, so tests can't leak state between builds).
5. **Presets agree.** Import `PRESETS` from `scripts/headless/presets.mjs`: every key of each preset's `build` is a BuildOptions field (known to the test's list), and every preset `options` key is a UI control id (`imagery`, `banking`).
6. **Routes are clean.** Every `routes/*.json` `build` key is a BuildOptions field or starts with `_` (skip routes/private when absent).
7. **Golden builds unchanged.** The existing suites that call `withDefaults` (kerbs, armco, farm, bayLanes, trace, unsealed, golden-mesh) pass unchanged.

## Rewrite notes (31 Oct 2026)

- `groundDetail` deleted (never read); 53 required fields, 31 optional.
- Kept with Mac's approval pending: `carParkIslands`, `raceDress`, `sponsors`. `textureSize` stays 1024 (Bugs 1).
- Later on 31 Oct (delete what we don't use): race dressing deleted; `raceDress` and `sponsors` are ignored optional fields (51 required, 33 optional) until the old UI that sends them goes. `carParkIslands` deleted too (50 required).
- `DEFAULT_OPTIONS` is frozen; `withDefaults` copies `noTrace` and skips `undefined` values (Bugs 4).
- Added `OPTIONAL_OPTION_KEYS` and `unknownOptionKeys(obj)` (Bugs 6); build-track.mjs doesn't call it yet.
- Still open: pipeline's duplicated fallbacks (Bugs 3), phase1.ts namespaces (Bugs 5).
