# CSP / Pure track setup research (Busselton AC)

Date: 2026-10-30. Sources read directly (cloned):
- `ac-custom-shaders-patch/acc-bakeryoptix` source (last commit 2026-03-03), esp. `bakeryoptix/main.cpp`, `utils/load_util.cpp`, `bake_api.cpp`, `baked_data.cpp`.
- `ac-custom-shaders-patch/acc-extension-config` (CSP's shipped configs: `config/tracks/*.ini`, `config/tracks/common/*.ini`, `config/track_adjustments.ini`, `config/data_track_params.ini`).
- `acc-extension-config.wiki` (last edit 2026-06-11): Tracks – Vertex AO, RainFX, Grass FX, Conditions, General options, Misc options, Trees, Water shader, Bounced light, General extended physics options; General – Shader replacements.

Could NOT reach: bakery GitHub release page/assets (so the shipped default `baked_shadow_params.ini` was not read; keys below come from the source code and its built-in defaults), the CSP shader list on GitLab (which shaders take puddles), Pure's docs (paywalled Patreon download). Items marked **[unconfirmed]** are inference.

Our current `src/core/cspConfig.ts` already has: NIGHT_SMOOTH condition, GRASS_FX (mask widened for straw), RAIN_FX, DOUBLE_FACE_SHADOW_BIASED, Material_RoomWindows, Material_DistantEmissive, LIGHT_SERIES, LIGHT_POLLUTION, emissive MATERIAL_ADJUSTMENTs. Gaps found below: VAO patch, seasons, surfaces.ini WEATHER_FX coords/timezone, BOUNCED_LIGHT, Material_Water for the sea, tiling fix, WIND/BASIC, [PURE].

---

## 1. Vertex AO bakery (acc-bakeryoptix)

### What it is now
- README: "Initially made possible with NVIDIA OptiX ... now instead uses Embree for CPU-only baking and Vulkan for GPU-accelerated baking, functional on any hardware." **OptiX is no longer needed.**
- GPU baking needs "NVIDIA RTX 20…, AMD RX 6000, Intel Arc A-Series or newer" → **RTX 4060 is fine** (Vulkan RT). Falls back to Embree (CPU) automatically: `[GENERAL] USE_VULKAN` (default 1); console prints "Using Vulkan RT (GPU)" or "Using Embree (CPU)".
- "Nowadays, CSP expects VAO to be present, especially for tracks, as it uses this information to estimate all sorts of things."
- **Windows-only**: Win32 APIs throughout (GetModuleFileNameW, GetOpenFileNameW, SHGetFolderPathW, CreateProcessW for acs.exe), D3D11/D3DX11 for texture decoding (so DDS and PNG both decode; a failed texture is just treated as opaque). Wine untested **[unconfirmed]**.

### How it's run (from `main()`)
- No args → file-open dialog ("Choose a KN5 or INI file").
- With args → **every argv is processed in turn**: `bakeryoptix.exe <file1> <file2> ...`. Each arg can be a track `.kn5` or a `models*.ini`. There are no other CLI flags; everything is in the config ini.
- Mode is auto: path containing `/cars/` → CAR, otherwise TRACK (`[GENERAL] MODE = AUTO|TRACK|CAR`).
- On an exception it prints the error then calls `std::getchar()` → **will hang waiting for a key in an unattended run**. Feed stdin from an empty file/NUL. On a crash it writes a minidump.
- It finds the AC root by walking up from the input file looking for `acs.exe`, and derives the track id from the path after `content/tracks/`. So **bake the installed copy inside AC's `content\tracks\<id>`**, not a loose folder: needed for CSP config lookups (`TRACK_CONFIGS_DIR`, model replacements) and for procedural-tree baking (it launches `acs.exe` headless with `AC_TOOL_RUN=1` and a generated `Documents\Assetto Corsa\cfg\race_vao.ini`).

### Config file
- Name and lookup order (`load_config`): `baked_shadow_params.ini` (or `baked shadow params.ini`) **next to the input file**, else next to the exe; then `baked_shadow_params__local.ini` next to the exe is merged on top. (The old wiki page talks about a `.txt` and a C# tool; that's outdated.)
- Sections: `[GENERAL]`, `[MODE_TRACK]` / `[MODE_CAR]`, `[SPECIFIC_...]` (per-track overrides: `TRACK = <id glob>`, keys `SECTION__KEY = value`), and any other section is copied verbatim into the patch's `Config.ini` (that's how CSP-side extras ride along).
- Mesh filters accept names with `?` wildcards plus `shader:<glob>`, `material:<glob>`, `texture:<glob>`, `visible:y|n`, `renderable:y|n`, `transparent:y|n`, `materialProperty:<name>`, `materialResource:<slot>`.

Track-relevant keys (section `[MODE_TRACK]`; default from source in brackets):

| Key | Default | Meaning |
|---|---|---|
| `SAMPLES` | AUTO | total samples |
| `MIN_SAMPLES_PER_FACE` | 4 | |
| `RAYS_PER_SAMPLE` | 64 | quality vs time |
| `RAYS_OFFSET` | 0.1 | ray start offset (m), raise if self-shadow speckles |
| `BOUNCES` / `BASE_ALBEDO` | 5 / 0.9 | light bounce brightening |
| `USE_GROUND`, `GROUND_SCALE`, `GROUND_ALBEDO`, `GROUND_OFFSET` | 0, 10, -1, 0 | infinite ground plane blocker |
| `FILTER_MODE` | LEAST_SQUARES | |
| `BRIGHTNESS` / `GAMMA` / `OPACITY` | 1.02 / 0.92 / 0.97 | output curve |
| `AVERAGING_THRESHOLD`, `AVERAGING_COS_THRESHOLD`, `AVERAGING_OVERALL` | 0, 0.95, 1 | smooths seams between split vertices |
| `EXCLUDE_FROM_BAKING` | – | meshes that get no AO |
| `FORCE_PASSING_LIGHT` | – | meshes that don't block |
| `FORCE_ALPHA_TEST_PASSING_LIGHT` / `FORCE_ALPHA_BLEND_PASSING_LIGHT` | 0 / 0 | make all alpha-tested / blended meshes non-blocking |
| `BAKE_AS_TREES` | – | tree meshes: no self-occlusion, normals treated as up, horizontal offset 2 m |
| `BAKE_AS_GRASS` | – | grass meshes: no shadows from grass, normals up |
| `TREES_LIGHT_PASS_CHANCE` | 0.9 | how see-through tree blockers are |
| `TREES_SHADOW_FACTOR` | 1.0 | how much trees darken things under them |
| `EXT_EXCLUDE_POBJECTS` | 0 | skip `AC_POBJECT?` (dynamic objects get dynamic shadows) |
| `EXT_REBAKE_DARK_OBJECTS` + `DARK_AO_THRESHOLD`, `DARK_VERTICES_SHARE_THRESHOLD`, `DARK_RAYS_PER_SAMPLE`, `DARK_MIN_SAMPLES_PER_FACE` | 0, 0.01, 0.2 | rebake meshes that came out black |
| `AO_SAMPLES_PHYSICS_SURFACES` | 0 | new-style extra AO grid over physics surfaces (CSP uses it to darken cars under trees/awnings) |
| `AO_SAMPLES_AI_LANES`, `AO_SAMPLES_PIT_POINTS` (+ `AO_SAMPLES_AI_LANES_Y_OFFSET`, `_SIDES`, `_PITLINE_WIDTH`, `_MIN_DISTANCE`) | 0 | old-style extra samples along `ai/*.ai` (for `models_<id>.ini` it reads `<id>/ai/`) |
| `EXT_PROCEDURAL_TREES_OCCLUDE` / `_BAKE` / `_FINALIZE` | 0 | CSP [TREES] support; runs acs.exe; FINALIZE writes `compiled_trees.bin` |
| `EXTRA_ADJUSTMENT_n_NAMES/_MULT/_OFFSET/_GAMMA` | | per-mesh AO tweaks |
| `EXTRA_OFFSET_n_NAMES/_VALUE`, `TUNNEL_FIX_n_NAMES/_OFFSET`, `REDUCED_GROUND_n_NAMES/_FACTOR`, `EXTRA_BLOCKERS_n_FILE`, `EMISSIVE_n` (+ `_P0.._P3`) | | special cases |
| `DUMP_INSTEAD_OF_BAKING` | – | debug |
`[GENERAL]`: `MODE`, `USE_VULKAN` (1), `BATCH_SIZE` (2000000), `STACK_SIZE` (1024), `CAR_CONFIGS_DIR`, `TRACK_CONFIGS_DIR`.

Things that already don't block AO (from the loader): meshes with `castShadows = false` in the kn5, non-renderable meshes, meshes with `lodIn > 0`. So our kn5 writer's per-node `castShadows` flag directly controls what occludes. Alpha-tested/blended materials use their `txDiffuse` alpha (or `txNormal` alpha for shaders that take alpha from the normal map) as a cut-out by default, so tree sprites and fences cast holey shadows without special settings.

### Suggested `baked_shadow_params.ini` for our town tracks [values are a starting point, unconfirmed against the shipped default]
```ini
[GENERAL]
MODE = TRACK
USE_VULKAN = 1

[MODE_TRACK]
RAYS_PER_SAMPLE = 64          ; 128 for a final build
MIN_SAMPLES_PER_FACE = 4
RAYS_OFFSET = 0.1
BOUNCES = 5
BASE_ALBEDO = 0.9
USE_GROUND = 0                ; our terrain is real geometry
BRIGHTNESS = 1.02
GAMMA = 0.92
OPACITY = 0.97
; our tree sprites / hedges / shrubs (material names from track.ts)
BAKE_AS_TREES = material:trees, material:shrubs, shader:ksTree?
BAKE_AS_GRASS = shader:ksGrass?
TREES_LIGHT_PASS_CHANCE = 0.9
TREES_SHADOW_FACTOR = 0.8
; physics-only or invisible helpers, sky/backdrop, sea
EXCLUDE_FROM_BAKING = renderable:n, material:sea, material:backdrop_?
FORCE_PASSING_LIGHT = material:sea, material:window, material:glass
EXT_EXCLUDE_POBJECTS = 1
EXT_REBAKE_DARK_OBJECTS = 1
AO_SAMPLES_PHYSICS_SURFACES = 1
; no CSP [TREES] yet, so leave procedural-trees off (avoids launching acs.exe)
EXT_PROCEDURAL_TREES_OCCLUDE = 0
EXT_PROCEDURAL_TREES_BAKE = 0
EXT_PROCEDURAL_TREES_FINALIZE = 0
```
Put this file in the track folder (it's looked up next to the input first), so it can ship in our zip / be written by install-track.ps1.

### Output and how CSP loads it
- Output: `<input name without extension>.vao-patch` **in the same folder as the input**: `models_<layout>.ini` → `models_<layout>.vao-patch`; `foo.kn5` → `foo.vao-patch`. It's a zip containing `Config.ini` + `Patch_v5.data` (+ `ExtraSamples.data`, `TreeSamples.data`).
- CSP picks it up automatically from the track folder; no ext_config line needed (wiki: drag the `models_….ini`, "wait for it to close and it's ready to go"). Per-track overrides in ext_config:
  ```ini
  [VAO]
  OPACITY = 0.9     ; override opacity of VAO patch if set
  MULTIPLIER = 1.0  ; override brightness multiplier of VAO patch if set
  ```
- Wiki on robustness: a patch survives texture/material edits and small object moves, but our builds regenerate geometry, so **rebake on every build** (whole-world vertex data changes).

### Multiple kn5s / layouts
- An `.ini` input loads every `[MODEL_n] FILE=` in it as one scene; AO is computed with all of them as blockers and receivers. So for our structure (shared world kn5 + `layout_<id>.kn5` + layer kn5s, listed in `models_<id>.ini`), **bake each `models_<id>.ini`**; you get one `models_<id>.vao-patch` per layout (wiki: "this way you can have different occlusion for the same model depending on its surroundings set via different models_….ini files").
- If a track has only `models.ini`, pass that (→ `models.vao-patch`) **[unconfirmed that CSP reads `models.vao-patch`; it does handle the name for AI paths]**; with no ini at all, pass the kn5.
- Layer kn5 changes (hand-made detail) require a rebake of each layout that lists them.

### Bake time
Not documented. Vertex-count driven; Kunos-size tracks take minutes on CPU, much less on Vulkan RT **[unconfirmed]**. Use `RAYS_PER_SAMPLE = 32` for quick test bakes, 64–128 for the build Mac drives.

### PowerShell (workstation, after install-track.ps1)
```powershell
param(
  [string]$Track = "busselton",
  [string]$Bakery = "C:\Tools\bakeryoptix\bakeryoptix.exe",
  [string]$AC = "C:\Program Files (x86)\Steam\steamapps\common\assettocorsa"
)
$dir = Join-Path $AC "content\tracks\$Track"
$inputs = @(Get-ChildItem $dir -Filter "models_*.ini" | ForEach-Object FullName)
if (-not $inputs) { $inputs = @(Get-ChildItem $dir -Filter "models.ini" | ForEach-Object FullName) }
if (-not $inputs) { $inputs = @(Get-ChildItem $dir -Filter "*.kn5" | Select-Object -First 1 | ForEach-Object FullName) }
$empty = New-TemporaryFile                       # bakery calls getchar() on errors; give it EOF
$log = Join-Path $dir "vao-bake.log"
$p = Start-Process -FilePath $Bakery -ArgumentList ($inputs | ForEach-Object { "`"$_`"" }) `
       -WorkingDirectory $dir -NoNewWindow -Wait -PassThru `
       -RedirectStandardInput $empty -RedirectStandardOutput $log -RedirectStandardError "$log.err"
Remove-Item $empty
if ($p.ExitCode -ne 0) { throw "VAO bake failed ($($p.ExitCode)); see $log" }
Get-ChildItem $dir -Filter *.vao-patch | Format-Table Name, Length, LastWriteTime
```
(AC must not be running if procedural trees are enabled, since the bakery launches acs.exe itself.) Per the CLAUDE.md rules this script belongs in `scripts/windows/` written from the laptop session; the workstation only runs it.

---

## 2. RainFX

Exact keys (wiki "Tracks – RainFX"):
```ini
[RAIN_FX]
PUDDLES_MATERIALS = ...       ; roads only; drives puddles (and physics water)
SOAKING_MATERIALS = ...       ; default wet darkening is 35%; these get 70%
SMOOTH_MATERIALS = ...        ; no darkening, get rain drops (glass, metal, cars)
ROUGH_MATERIALS = ...         ; darker only, no reflections; required for grass with Grass FX
LINES_MATERIALS = ...         ; paint lines: no visual change, slippier physics
LINES_FILTER_MATERIALS = ...  ; lines baked into the road texture: uses brighter areas only
; every *_MATERIALS has a *_MESHES twin
; RELIEF_MATERIALS = '{ dynamic:no & !Bx? }'   ; broken at the moment
STREAM_EDGE_... = x1,y1,z1, x2,y2,z2   ; drip edges
STREAM_POINT_... = x,y,z

[TRACK_OCCLUDER_BOX_0]        ; no rain under (bridges, carports, shop awnings)
POINT_0 = ...  ; 4 points, upper plane
[TRACK_OCCLUDER_WALL_0]
POINT_0 = ...  ; 2 points
```
Guidance from the wiki:
- Main asphalt in both PUDDLES and SOAKING. Kerbs in PUDDLES but not SOAKING.
- Keep PUDDLES for roads only (it reads racing-line offset and large-scale relief). Footpaths: SOAKING, not PUDDLES.
- Puddle placement uses a track height map (local minima get more water); no puddle texture needed. Drainage = relief + STREAM_*; drains use `[Material_WaterDrain]` (materials_track.ini) with `CoverMeshes`/`CoverMaterials`.
- Grass must be ROUGH with Grass FX. Sand: ROUGH or SOAKING (smooth beach sand can be SOAKING). Bystanders ROUGH.
- Puddles only work on shaders in CSP's puddle list (GitLab `acc-shaders/.build/lists.txt`, not reachable). Kunos roads use `ksMultilayer_fresnel_nm`/MultiMap; **[unconfirmed]** whether plain `ksPerPixel` (our non-detail road) takes puddles. Our `detailShaders` road path (`ksPerPixelMultiMap…`) is the safer bet. Check in game with the Objects Inspector app.
- Conditions available for anything else: `RAIN`, `RAIN_WETNESS`, `RAIN_WATER`.

Our current section is right in shape. Suggested additions: `concrete, path_?` stay SOAKING only (done); add kerb material to PUDDLES; add `TRACK_OCCLUDER_BOX` for jetty/awnings later; consider `jetty_?` as SOAKING (wet timber darkens) rather than ROUGH.

### Puddles in the real hollows (`rainHollows: true`, src/core/rainHollows.ts)

CSP has no key that puts a puddle at a spot. It places puddles itself, more of them in the local minima of a height map of the track, and builds that map from every mesh unless `RELIEF_MATERIALS` says otherwise (wiki "Tracks – RainFX"). The wiki says that key is "broken at the moment", but CSP's own shipped configs still set it to ground materials: `ks_brands_hatch.ini` (`asph?, grass?, sand?, concrete_green`), `nevadadrift.ini` (`road?, sand_usa_drag`), and the `{ dynamic:no & !Bx? }` form in `estoril.ini` and `luccaring.ini`. So with the option on:
- `RELIEF_MATERIALS` lists the roads, paths, kerbs and ground only (`RELIEF_MATERIALS` in cspConfig.ts), so houses and trees don't make false hollows beside them.
- The build finds the hollows itself from the drivable physics meshes (road, street, gutter, kerb in a 1 m height grid, highest surface per cell so kerbs hold water). A priority flood fills each cell to the level water could leave at (an open road edge or a driveway gap drains, a kerb doesn't), each basin is capped at 15 cm over its lowest point (side-entry pits), and pools of at least 2 cm and 4 m² on road or street (not footpaths) count. They're written in `[RAIN_FX]` as comments, lowest point in AC x, y, z with depth and area, so the workstation can fly there (F7, Objects Inspector) in the rain and check that water stands there. On the accepted Busselton base: 49 hollows, the biggest 614 m² and 8 cm deep, in about 0.4 s.
- Conditions `RAIN_WETNESS` and `RAIN_WATER` (wiki "Tracks – Conditions") exist for anything else that should follow the water; nothing uses them yet.

### Track sounds (`trackSounds: true`, src/core/trackSounds.ts)

**Default (`true` or `"lua"`): a Lua track script, no FMOD.** CSP's Lua SDK (acc-lua-sdk `common/ac_audio.d.lua`, `lib_audio.lua`) has `ac.AudioEvent.fromFile({ filename, use3D, loop, minDistance, maxDistance, dopplerEffect, ... }, reverbResponse)`: a 3D emitter straight from an audio file (FMOD core decodes .ogg, .wav, .mp3), with `setPosition`, `volume`, `pitch`, `cameraInteriorMultiplier`, `start`/`stop`/`resumeIf`, `seek` and `getDuration`. Track scripts (`ac_track_script.lua`) get it through `inc_scene.lua`, which requires `common/ac_audio`; CSP's own ambience (acc-lua-internal `lua-module/src/ambience_audio.lua`) plays looping 3D mp3s this way. Audio isn't in the `physics` namespace, so it shouldn't need `[_SCRIPTING_PHYSICS]` (only `physics.*` is gated, per `common/ac_physics_unrestricted.lua`). The build ships `extension/sounds.lua` with the emitters baked in (AC space), loaded by `[SCRIPT_1]` (or `[SCRIPT_0]` without the autotest script). It looks for `extension/sfx/surf`, `magpie` and `kookaburra` as `.ogg`, `.wav` then `.mp3` (track folder via `ac.getFolder(ac.FolderID.ContentTracks)/ac.getTrackID()`, then `__dirname`), loads each emitter only when the camera comes within its max distance (surf 250 m, magpie 150 m, kookaburra 250 m), starts each at a random point in the loop with birds' pitch varied a few percent so they don't sing in step, and follows the same day/rain curves as the FMOD conditions below from `ac.getSunAngle()` and `sim.rainIntensity`. A missing file is logged once ("Busselton sounds: ...") and stays quiet. `extension/sfx/README.txt` lists the files and CC0 Freesound searches for each (links only). **Not yet tried in game**: the first test should check the CSP log for the "Busselton sounds:" lines and listen at the foreshore.

**Alternative (`"fmod"`): an FMOD bank.** Wiki "Tracks – Audio": an FMOD bank in `extension/sfx/` (`sfx.bank` and the `GUIDs.txt` FMOD Studio exports), `[SOUNDBANK_0] BANK = … GUIDS = …`, then an `[EVENT_n]` per emitter with `ID` (the event path as GUIDs.txt lists it, e.g. `event:/busselton/surf`; CSP's own fireworks bank lists `event:/extra_fireworks/hiss`), `POSITION` in AC space, `REVERB_RESPONSE`, `VOLUME` and `CAMERA_INTERIOR/EXTERIOR/TRACK_MULT`. Any number can be a condition. CSP ships no ambient sounds a track can use (its only bank is `lua/fireworks/holidays/extra_fireworks.bank`), so the bank is a placeholder with fixed names: `extension/sfx/busselton.bank` with `event:/busselton/surf`, `/magpie` and `/kookaburra`, described in the build's `extension/sfx/README.txt`, CC0 or own recordings only. Emitters: waves every ~110 m along the real shoreline within 350 m of a road (24 at most), and a bird in each 60 m cell holding 6+ trees within 250 m of a road, at least 140 m apart (24 at most), kookaburras where most of them are tuarts and magpies elsewhere. Birds follow the sun (kookaburras loudest at dawn and dusk) and go quiet in the rain, through `CONDITION_20`..`24` with expressions such as `'BUSS_DAYLIGHT * (1 - RAIN)'`. Use `"fmod"` only once the bank exists: what CSP does with a missing bank isn't confirmed.

---

## 3. Seasonal grass/verge colour

There is no `[SEASON_*]` section. The mechanism is a **`[CONDITION]` on `YEAR_DAY` or `YEAR_PROGRESS`** driving a **`[MATERIAL_ADJUSTMENT]` of CSP's per-material `seasonAutumn` / `seasonWinter` parameters** (wiki, Shader replacements → New parameters):

> "seasonAutumn, seasonWinter: Available for almost all shaders, allows to tweak diffuse color. Autumn variable shifts it to yellow, and winter desaturates and boosts brightness. Both use greeness as a mask. ... set it in [MATERIAL_ADJUSTMENT_...] bound to some season-based condition."

`seasonAutumn` = green → yellow/straw, masked by greenness, so grey road and white sand are untouched. That's exactly our WA dry-season verge. (CSP configs also use an undocumented `seasonSummer` key, e.g. ks_monza66 `VALUE_0=0.35` **[unconfirmed meaning]**.)

`YEAR_DAY` is 1..365 (29 Feb skipped). Jan 1=1, May 1=121, Jun 1=152, Sep 30=273, Nov 1=305, Dec 1=335.

```ini
; Straw from December to April, green June to September, blends in May and Oct–Nov.
[CONDITION_...]
NAME = WA_DRY
INPUT = YEAR_DAY
LUT = (|1=1|120=1|152=0|273=0|335=1|365=1|)
LAG = 0

[MATERIAL_ADJUSTMENT_...]
ACTIVE = 1
DESCRIPTION = Verges and lawns go straw in the WA dry season
MATERIALS = terrain_?, strip_photo_?, sidestrips_photo, returns_photo, rbphoto_?, grass, verge
CONDITION = WA_DRY
KEY_0 = seasonAutumn
VALUE_0 = 0.8           ; full straw at condition = 1 (tune 0.5–1.0)
OFF_VALUE_0 = 0         ; green
```
Notes:
- MATERIAL_ADJUSTMENT blends VALUE↔OFF_VALUE by the condition (0..1); `OFF_VALUE_n` and `VALUE_n_OFF` both appear in CSP configs; `OFF_VALUE_0 = ORIGINAL` keeps the kn5 value.
- Keep trees/hedges out of the list (WA natives stay green) or give them a small value.
- Optional brighter/flatter dry ground: add `KEY_1 = ksDiffuse`, `VALUE_1 = <higher>`, `OFF_VALUE_1 = ORIGINAL`.
- Player side: seasons are a CSP Track Adjustments option, `[SEASONS] ALLOW_ADJUSTMENTS` (0 never, 1 "with date set" (default), 2 always/current date). Content Manager sets a date, so it works by default.
- Our aerial photo is whatever season Landgate flew; if it's already straw, run it the other way (seasonWinter isn't "green", so better to bake the photo greener at build time and let seasonAutumn yellow it). **[design choice, untested]**
- Grass FX takes blade colour from the surface (blades with R=B=0 in the atlas use surface colour). **[unconfirmed]** whether its surface capture includes the seasonAutumn shift; if blades stay green in summer, bind grass shape/mask to the same condition (each `SHAPE_…` value can be a condition name) or lower density in summer.
- Trees from CSP [TREES] have their own `SEASON_AUTUMN_n` / `SEASON_WINTER_n` keys.

---

## 4. Cheap CSP features with good payoff (sunny, flat, coastal town)

### Coordinates and timezone (WeatherFX / Pure sun path): **do this**
In each layout's `data/surfaces.ini` (overrides everything else, doesn't need extended physics):
```ini
[WEATHER_FX]
LATITUDE = -33.65
LONGITUDE = 115.35
TIMEZONE_ID = Australia/Perth
```
Also keep `ui_track.json` `geotags` (we write `"33.65xxx S"`, `"115.3xxx E"`). CSP's shipped database form (for reference) is `LATITUDE/LONGITUDE/TIMEZONE/HEADING_ANGLE` in `data_track_params.ini`.
Optional: `[_EXTENSION] PIT_ALTITUDE = 5` (real altitude, metres).

### Bounced light (Extra FX, ~0.3 ms): sunlit road/footpath bouncing onto house walls and verandas
```ini
[BOUNCED_LIGHT]
SUPPORTED = 1
SURFACE_MATERIALS = road_?, side_photo_?, concrete, path_?, terrain_?, paint?
OBJECT_MATERIALS = signart, shop_sign, fence_?, barrier_?, lamp, steel, trees, shrubs, hedge
CAUSTICS = 1          ; light bouncing off the sea (with Material_Water)
```
(Flat single-level town is the ideal case per the wiki. No CLIP_POINTs needed unless an underpass.)

### Sea / estuary water
```ini
[Material_Water]
Materials = sea
Type = SEA            ; LAKE, POND, POOL, SEA, OCEAN
UseRecommendedTextures = 1
```
(Geographe Bay is calm: SEA rather than OCEAN. Needs the `[INCLUDE] common/materials_track.ini` we already have.)

### Tiling fix on terrain detail (free, ksMultilayer and MultiMap)
```ini
[SHADER_REPLACEMENT_...]
MATERIALS = shader:ksMultilayer?, shader:ksPerPixelMultiMap_NMDetail
PROP_... = ksAlphaRef, -193
```
For plain `ksPerPixel` grounds: `SHADER = ksPerPixel_tilingfix`. Big low-poly backdrop: `SHADER = ksPerPixel_ppfog` (per-pixel fog).

### Wind and basics
```ini
[BASIC]
SUPPORTS_WIND = 1

[WIND]
TREES_NORMALIZATION = 0.8, 1
GRASS_NORMALIZATION = 0.8, 1
```
CSP wind sways `ksTree`-shader meshes; our tree sprites are `ksPerPixelAT`, so they probably don't sway **[unconfirmed]**. Switching tree sprites to `ksTree` (or `SHADER_OVERRIDE`) would give wind + CSP tree lighting; then add the triangle fix:
```ini
[SHADER_REPLACEMENT_...]
MATERIALS = shader:ksTree?
MATERIAL_FLAG_0 = 1
```

### Flags in the wind (have it: `src/core/flags.ts`)
CSP has no cloth simulation for tracks, but it turns AC's own flag shader (`ksFlags`) into "dynamic flags" that follow its wind. From the [General options wiki page](https://github.com/ac-custom-shaders-patch/acc-extension-config/wiki/Tracks-%E2%80%93-General-options), `[WIND] DYNAMIC_FLAGS = AUTO ; Valid values: NONE, AUTO, or regular mesh filter`; CSP's own configs add `DYNAMIC_FLAGS_TESSELLATION = 1` (ks_nurburgring, monaco_1966) and use filters like `'{ shader:ksFlags & !FLAG9 }'` (ks_silverstone, ks_monza66). What we write:
```ini
[WIND]
DYNAMIC_FLAGS = '{ shader:ksFlags & !FLAGBACK_? }'
DYNAMIC_FLAGS_TESSELLATION = 1

[SHADER_REPLACEMENT_...]
MATERIALS = shader:ksFlags
CULL_MODE = DOUBLESIDED
DOUBLE_FACE_SHADOW_BIASED = 1

[SHADER_REPLACEMENT_...]
MESHES = FLAGBACK_?
IS_VISIBLE = 0
CAST_SHADOWS = 0
```
The mesh rules, from track makers ([assettocorsamods.net, "Dynamic Flags issue"](https://assettocorsamods.net/goto/post?id=20936)): UVs inside 0..1 with the texture's left edge (u = 0) on the pole, which CSP holds still; one single-sided cloth drawn from both sides (two coincident sides cut through each other as they wave); a grid of vertices, not one quad. Without CSP, `ksFlags` waves the whole cloth gently by its `frequency` and `distortion` (0.3 and 0.05, the values in CSP's pfc_chayka config), and a back-face copy (`FLAGBACK_...`) shows the other side; CSP hides it. **[to check in game]**: the flags move with the wind, the pole edge stays put, nothing flickers.

Which flags: the landmark specs' feather flags.

### Animated objects and track scripts (the jetty train)
Two ways CSP moves things on a track ([Animated objects wiki page](https://github.com/ac-custom-shaders-patch/acc-extension-config/wiki/Tracks-%E2%80%93-Animated-objects)): `[ANIMATED_...]` sections (windmills, weather vanes, clocks, keyframes, and a "train" that follows a hidden strip mesh, `MOVE_ALONG`, with `TICK_TOCK_MODE` for out and back), or a Lua track script (`[SCRIPT_...] SCRIPT = file.lua`, API in `ac_track_script.lua` of [acc-lua-sdk](https://github.com/ac-custom-shaders-patch/acc-lua-sdk)). Either way only nodes move: "meshes can't be moved unless they are within their own nodes" (wiki), so each car is a node of its own in our kn5.

The jetty train is a script (`src/core/lua/jetty_train.lua`, filled in by `src/core/jettyTrain.ts`), so it can keep the real timetable: on the hour by the session's clock (`ac.getSim().timeHours/timeMinutes`), about 5 km/h each way, 5 minutes at the end, back pushed. It only calls `ac.findNodes(name):setPosition()/setOrientation(look, up)` (look is the node's Z row, as in `mat4x4.look`), so it needs no physics permission (`[_SCRIPTING_PHYSICS] ALLOW_TRACK_SCRIPTS` is only for the physics API, per the extended physics wiki page). Settings in its ext_config section: `speedKmh`, `firstDeparture`, `lastDeparture`, `everyMinutes`, `waitAtEnd`, `nonStop = 1` to watch it without waiting. Auto-numbered `[SCRIPT_...]` and `[SHADER_REPLACEMENT_...]` sections can sit beside numbered ones (CSP's chang.ini, imola.ini do). **[to check in game]**: the train runs at 9:00 with `nonStop = 0`, the cars follow the bend, and it stands at the shore platform at night.

### Lighting knobs
```ini
[LIGHTING]
ENABLE_TREES_LIGHTING = 1      ; trees are close to the road in town; 0 saves a lot if not
SPECULAR_MULT = 1
LIT_MULT = 1
CAR_LIGHTS_LIT_MULT = 1
BOUNCED_LIGHT_MULT = 1, 1, 1, 1

[WEATHER_FX]
SKY_BELOW_HORIZON = 0.2115     ; default; 1 for a 360° sky (not needed, flat)
```
Light pollution (have it; Busselton is small, density 0.1–0.15 is plausible):
```ini
[LIGHT_POLLUTION]
RELATIVE_POSITION = 0, 0, 0   ; km
RADIUS_KM = 1.5
DENSITY = 0.12
COLOR = 1.0, 0.72, 0.45
```

### Grass FX tuning (in addition to what we have)
- Per-area looks with up to four configs (`[GRASS_FX_CONFIGURATION_A..D]`) mapped by `[GRASS_FX_ADJUSTMENT_...] MATERIALS=… MAP=A, 1`. E.g. A = mown lawn, B = rough verge, C = dune grass:
  ```ini
  [GRASS_FX_CONFIGURATION_A]   ; mown front lawns, cut weekly
  TRIM_PERIOD = SATURDAY
  SHAPE_SIZE = 0.5, 0.9
  SHAPE_CUT = 1, 0.5
  SHAPE_TIDY = 1, 0.6

  [GRASS_FX_CONFIGURATION_B]   ; council verges / rough
  MASK_MAIN_THRESHOLD = 0.3
  SHAPE_SIZE = 1.6
  SHAPE_TIDY = 0

  [GRASS_FX_ADJUSTMENT_...]
  MATERIALS = verge, strip_photo_?
  MAP = B, 1
  ```
- Multilayer mask channels can map to configs: `USE_MULTILAYER_MASK = 1`, `MASK_R = A, 3`, `MASK_G = -10`, `MASK_B = B, 3`, `MASK_A = C` (our ksMultilayer mask is R grass, G dirt, B plain → `MASK_R = A`, `MASK_G = -10` (no grass on dirt), `MASK_B = -10`).
- `ORIGINAL_GRASS_MATERIALS =` empty keeps ksGrass meshes.
- `[EXTRA_FX] FORCE_GRASSFX_GBUFFER_PASS = 1` only if grass looks see-through against the sea.

### Emissive windows (have it)
`Material_RoomWindows` + MATERIAL_ADJUSTMENT on NIGHT_SMOOTH is the documented way; `ShapeChance`, `InteriorMult`, `RoomDepth` are the useful knobs.

### Asphalt specularity / reflections
- No track key for "asphalt sheen" beyond material values; static changes go in SHADER_REPLACEMENT (`PROP_... = ksSpecular, 0.1`, `PROP_... = ksSpecularEXP, 30`, `fresnelMaxLevel`, `fresnelEXP`), dynamic ones in MATERIAL_ADJUSTMENT (Monza 66 raises specular in winter this way). RainFX handles wet reflections itself.
- `extColoredReflection` is for metals; skip.
- Player-side option `USE_MULTILAYER_REFLECTIONS` exists in track_adjustments (commented out), no track key.

### Cloud shadows
No track-config key found; cloud shadows come from the weather script (WeatherFX/Pure) **[unconfirmed]**.

### Bigger-ticket (not cheap, noted)
- CSP procedural trees `[TREES] LIST_0 = trees/trees.txt` (lines `tree: my_tree.bin; x, y, z`), tree `.bin` from CM's tree converter, `SEASON_AUTUMN_n`, `SURFACE_MATERIALS`; then bake with `EXT_PROCEDURAL_TREES_*` and `[TREES] COMPILED_LIST = compiled_trees.bin`. Real 3D trees with LODs and wind. Requires tree models.
- Local cubemaps (`[LOCAL_CUBEMAP_...]`), area map, audio.

---

## 5. Pure

- Pure's documentation isn't public (Patreon download), so track-side guidance is thin.
- CSP's own shipped track configs carry a **`[PURE]` section** (ks_red_bull_ring, kazan_ring, monaco_1966 and 4 others), mirroring the older `[SOL]`/`[SOL2]` keys:
  ```ini
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
  Exact semantics **[unconfirmed]**; the values used everywhere are those above (clear, low haze), which suit a clean coastal town. Safe to add to our ext_config.
- What Pure depends on from the track (all via CSP): correct lat/long/timezone (section 4: `surfaces.ini [WEATHER_FX]` + ui_track.json geotags), a VAO patch (CSP "expects VAO to be present"), sane material ambient/diffuse (not overbright), and proper emissives with night conditions. **[unconfirmed beyond CSP docs]**

### Per-track Pure tuning (`src/core/pureConfig.ts`, option `pureTuning`, on unless false)

What a track can ship to adjust Pure, as far as public sources show:
- **`[PURE]` in the track's `extension/ext_config.ini`: the only known hook.** Checked by cloning [acc-extension-config](https://github.com/ac-custom-shaders-patch/acc-extension-config) (Oct 2026): 7 of its ~520 track configs have `[PURE]` (e.g. [ks_red_bull_ring.ini](https://raw.githubusercontent.com/ac-custom-shaders-patch/acc-extension-config/master/config/tracks/ks_red_bull_ring.ini), whose header credits Peter Boese), every one with the identical nine keys above. No other key appears anywhere.
- **Not a Pure hook:** `[SOL]`/`[SOL2]` (48 configs) have `HORIZON_OFFSET`, `DOME_SIZE`, `EXPOSURE_FIX` and a commented `HUMIDITY_OFFSET` ("0.85 for tracks near the sea or 0.0 for deserts"). Those are Sol's; nothing shows Pure reads them, so we don't write them.
- **No track key for exposure, sun brightness, ground albedo or tonemapping.** Those are Pure's own player settings (Pure Config app, Pure's PP filter). Pure's script and docs are paid downloads ([Gumroad](https://peterboese.gumroad.com/l/pure), Patreon), so this can't be confirmed from source.

What the build writes (pureConfig.ts), all inside the range CSP's own configs use:
| Input | From | Effect |
| --- | --- | --- |
| Clear air | track centre in south-west WA (lng 112 to 124, lat -27 to -36) | `SMOG_NOON` 0.10 → 0.07, `SMOG_EVENING` 0.15 → 0.10 |
| Coast | sea in the build | `SMOG_MORNING` 0.05 → 0.08 (sea mist before the breeze) |
| Ground albedo | mean Rec. 709 brightness of the terrain photos (`groundAlbedo`) | above 0.30 (a typical suburb), the photo ground's `ksAmbient`/`ksDiffuse` scaled by √(0.30/albedo), never below 0.85, through `[SHADER_REPLACEMENT_...] MATERIALS = terrain_?` |
| Latitude | already in `surfaces.ini [WEATHER_FX]` (the sun path, which Pure uses through CSP) | nothing extra |

Fog and `SUN_DAWN`/`SUN_DUSK` stay at CSP's values. Outside south-west WA and off the coast the output is exactly CSP's generic block. `pureTuning: false` writes the generic block and no ground change.

The ground damping is a CSP material change, so it applies under Sol too, and not in the three.js preview. Why: the aerial photo already holds the sun, and it's lit again (ambient 0.6 + diffuse 0.2); on pale sand and limestone that washes out under a strong sun and pulls auto exposure down, darkening cars and houses. The accepted Busselton base measures **0.48** (Landgate imagery is bright), so it gets the full 0.85: ground ambient 0.51, diffuse 0.17. **[untested in game]** The 0.30 reference and the 0.85 floor are judgement: check the beach and foreshore at noon with Pure, with and without (`pureTuning: false`).

What Pure overrides in our existing ext_config, as far as can be told:
- Unaffected (CSP engine, any weather script): `[LIGHT_SERIES]`, `[MATERIAL_ADJUSTMENT_*]` on `NIGHT_SMOOTH` (driven by the sun angle), Grass FX, Rain FX (Pure drives the wetness, the materials lists stay ours), `[BOUNCED_LIGHT]`, `[LIGHTING]`, `[Material_Water]`, seasons.
- Pure's: overall exposure, sky and sun brightness, fog colour and distance (our `[PURE]` keys nudge it), and how bright emissives look at night (Pure's night exposure differs from Sol's, so lit windows and shop signs may need a different strength under Pure: judge in game). `[LIGHT_POLLUTION]` is read by CSP; whether Pure draws it in the sky is **[unconfirmed]**.

### Player side: recommended settings for the WA sun (Content Manager, Pure)

The track can't set these, so Mac sets them once on the rig and the workstation:
- **CSP → Weather FX:** implementation (style) Pure. Weather from Pure's Weather Planner or Content Manager's weather selection.
- **Content Manager weather:** "Clear" or "Few clouds" for summer; ambient 24 to 32 °C December to March, 12 to 18 °C June to August. Date set (CM does by default) so the seasons work (`[SEASONS] ALLOW_ADJUSTMENTS = 1`).
- **Time:** the real time; the sun path is Busselton's (UTC+8, `Australia/Perth`).
- **Post-processing:** Pure's own neutral PP filter, chosen with Pure's PP app. Third-party filters tuned for Sol make it too dark or too bright under Pure.
- **Pure Config:** start from its defaults. If sand and white walls blow out at noon, lower Pure's exposure/brightness there before changing the track, and tell the laptop session what worked so the track side can match.
- **Bake AO** (`bake-vao.ps1`): Pure's ambient looks flat without it.

---

## To-do list for the build (suggested order)
1. `surfaces.ini` `[WEATHER_FX]` LATITUDE/LONGITUDE/TIMEZONE_ID=Australia/Perth per layout.
2. Ship `baked_shadow_params.ini` in the track folder; add `scripts/windows/bake-vao.ps1` (above); bake every `models_<id>.ini` after install; check `.vao-patch` files appear.
3. ext_config: WA_DRY condition + `seasonAutumn` MATERIAL_ADJUSTMENT; `[BOUNCED_LIGHT]`; `[Material_Water] Type = SEA`; tiling fix; `[BASIC] SUPPORTS_WIND`; `[PURE]`.
4. Verify puddles on our road shader in game (Objects Inspector); move roads to the MultiMap/detail path if plain ksPerPixel doesn't puddle.
