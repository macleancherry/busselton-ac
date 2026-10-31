# Workstation retest 2: the features merged on 30 October

For Claude Code on the workstation (CLAUDE.md, "If you are Claude Code on the workstation"). It covers
everything merged since the last retest that nobody has seen in game: Armco, vineyards and paddock
fences, farm roadsides, gravel roads, kerbside markings, rain hollows, track sounds, the night and
AI-car test runs, traffic zones and the kids' setting, time trials, drift spots, the LAN leaderboard,
AI Flood on Free Roam, Pure tuning, karri and marri 3D trees, landscape zones and the rig installer.

Nothing here changes code, routes or docs, and nothing is fixed on this machine: when something is
wrong, write it down and move on. Everything goes in the share (`\\media\busselton-share`, or
`D:\busselton-share` where it's hosted). About 3 hours, most of it unattended runs.

Go in order. Each step says what to run, what to look at, which screenshots to keep and what counts as
a pass. The automatic runs take their own screenshots (one every 5% of the lap, plus one at every
off-road moment and at the finish) into the run's `screens\` folder; "keep" means copy that file into
the report's folder with a name saying what it shows, e.g. `07-armco-bend.jpg`.

## Changed after retest 3 (31 October)

Tooling fixes from `reports\2026-10-31-retest-3.md` (branch `fix/retest3-tooling`). `git pull`, then
`.\scripts\windows\rig-install.ps1 -PublishKit` so the share's kit has the new `share.ps1`.

- **Every build ships the test script** (`extension\autotest.lua`), traffic or not, so Collie can be
  run-tested once it's rebuilt. An older build without it gets "older than the test script: rebuild it".
- **Time limit:** the track script ends the run at `-Minutes` (passed in race.ini), not at 480 s.
  Without `-Minutes` it's scaled from the AI line (Cape Naturaliste Road gets 24 minutes). A
  point-to-point run ends at the finish line ("finish line" in the console).
- **`autotest_report.py`** gives a point-to-point road its real length (Cape: about 12,196 m, not 23,077).
- **Night:** race.ini gets the sun angle unclamped, as Content Manager writes it, and if CSP's weather
  FX still starts at the PC's clock, the track script moves the clock to 22:00 and logs
  `clock moved from 13:45 to 22:00` (or `clock move ... failed: ...` and `clock still at ...`).
- **Newest zip per track:** `run-test.ps1 busselton`, `install-track.ps1 -Zip busselton` and `-All`, and the
  rig installer take the newest zip holding the `busselton` folder (`busselton_1.zip` over an older
  `busselton.zip`) and list the older one as skipped. Each install writes `installed_from.txt` in the
  track folder; the rig's dry run then leaves out tracks installed from that same zip. Tracks installed
  before this have no record, so reinstall them once with `install-track.ps1` to stop the dry run listing them.
- **App icons:** Busselton Map and Busselton Challenges have taskbar icons; the `TaskBarIcon :: COULD
  NOT FIND TEXTURES` warnings should be gone once the apps are reinstalled (any install copies them).

## Builds this needs

The laptop session puts these in the share's `builds\` folder before this test. Feature flags that are
off by default are noted; a build without them can't test that feature.

| Zip | Route | What it's for | Flags on top of the route |
| --- | --- | --- | --- |
| `busselton.zip` (+ `busselton_polish.zip`) | `routes/busselton.json`, from main at or after `00883be` | Pure tuning, traffic zones, drift spots, Free Roam pit boxes, night and AI-car runs | none (all on by default) |
| `busselton_wet.zip` | a copy of `routes/busselton.json` named "Busselton Wet" | rain hollows, kerbside markings | `build.rainHollows: true`, `build.kerbside: true` |
| `busselton_foreshore.zip` | `routes/foreshore.json` | track sounds (shore and trees) | `build.trackSounds: true` |
| `caves_road_yallingup.zip` | `routes/caves-road.json` (country preset) | Armco, vineyards, fences, farm roadsides, landscape zones, time trial | none |
| `busselton_to_dunsborough.zip` | `routes/busselton-dunsborough.json` (country preset) | paddocks, cattle grids, Armco over drains, wetland zone, gravel side tracks | none |
| `caves_road_boranup.zip` | `routes/caves-road-boranup.json` (country preset) | karri and marri 3D trees, karri zone | `build.cspTrees: true` |
| a kids' build or layout, if there is one | any town route with `build.trafficSetting: "kids"` or a layout with `"traffic": "kids"` | the kids' traffic setting | as named |

If a zip is missing or older than the merge, mark its steps **not in builds** in the report and carry
on. Don't build anything here.

## 0. Ready (10 minutes)

1. `git pull`. It brings `run-test.ps1 -Rain`.
2. List `builds\` with dates and sizes: `Get-ChildItem \\media\busselton-share\builds | Format-Table Name, LastWriteTime, Length`. Paste it into the report.
3. Close AC, Content Manager and Blender.
4. In Content Manager > Settings > Custom Shaders Patch, check and note:
   - the CSP version
   - **Weather FX: on**, with Pure as the style (note Pure's version). The night and rain runs need it.
   - **New AI behavior: on** (for the AI-car runs).
5. Start the report as `reports\<date>-workstation-retest-2.md`, with its files in `reports\<date>-workstation-retest-2\`. Use the table at the end.

## 1. Install and look inside (15 minutes)

```powershell
.\scripts\windows\install-track.ps1 -All
. .\scripts\windows\ac.ps1; $ac = Find-AssettoCorsa
```

`-All` installs every zip in `builds\` (polish zips over their base) and the Busselton apps. Note any
errors. Then check each feature is really in its build before driving it. For each line, `$t` is the
installed track folder, e.g. `$t = "$ac\content\tracks\caves_road_yallingup"`.

| Feature | Track | Command | Pass |
| --- | --- | --- | --- |
| Armco | caves_road_yallingup | `findstr /m /c:"1WALL_ARMCO_" "$t\*.kn5"` | a kn5 named |
| Vineyards | caves_road_yallingup | `findstr /m /c:"VINES_" "$t\*.kn5"` | a kn5 named (none if the road passes no OSM vineyard: note it) |
| Paddock fences | busselton_to_dunsborough | `findstr /m /c:"1WALL_FENCE_WIRE" "$t\*.kn5"` | a kn5 named |
| Farm driveways | both country roads | `findstr /m /c:"1GRASS_FARMDRIVE_" "$t\*.kn5"` | a kn5 named |
| Cattle grids | both country roads | `findstr /m /c:"1KERB_CATTLEGRID_" "$t\*.kn5"` | named where OSM maps one; none is not a fail |
| Gravel | every track | `Select-String "KEY=UNSEALED","KEY=UNPAVED" "$t\data\surfaces.ini"` | note which tracks have it; step 8 drives one |
| Kerbside | busselton_wet | `findstr /m /c:"KERBSIDE_" "$t\*.kn5"` | a kn5 named |
| Rain hollows | busselton_wet | `Select-String "RELIEF_MATERIALS", "; hollow " "$t\extension\ext_config.ini" \| Measure-Object` | RELIEF_MATERIALS once and some hollows (the base had 49) |
| Track sounds | busselton_foreshore | `Select-String "SOUNDBANK_0", "EVENT_" "$t\extension\ext_config.ini" \| Measure-Object`; `Test-Path "$t\extension\sfx\README.txt"` | sections there, README there |
| Pure tuning | busselton | `Select-String -Context 0,10 "^\[PURE\]" "$t\extension\ext_config.ini"` | a `[PURE]` section; quote it |
| 3D trees | caves_road_boranup | `Get-ChildItem "$t\extension\trees"` | `trees.txt` and `.bin` models, including `karri.bin`; note whether `marri.bin` is there |
| Time trial | caves_road_yallingup | `Select-String -Context 0,6 "TIME_TRIAL" "$t\data\challenges.ini"` | `[TIME_TRIAL]` with TT_START, splits and TT_FINISH |
| Drift spots | busselton | `Get-Content "$t\extension\drift_zones.ini" -TotalCount 12` | a `[DRIFT]` count and `[ZONE_n]` entries with names |
| Traffic zones | busselton | `Select-String -SimpleMatch '"Busy street', '"Quiet street', '"Town centre' "$t\data\traffic.json" \| Measure-Object` | all three role kinds there |
| Free Roam pits | busselton | `(Get-Content "$t\ui\free_roam\ui_track.json" -Raw \| ConvertFrom-Json).pitboxes` | 24 |

A missing feature is **not in build** (the laptop session's problem), not a failure of the feature.

## 2. Busselton by day: Pure tuning and the base (35 minutes)

```powershell
foreach ($l in "foreshore", "town", "sights") { .\scripts\windows\run-test.ps1 busselton -Layout $l -SkipInstall }
```

For each run, note the console summary: finish line, off-road events, and the `fpsall` line in the
run's `btest.csv`.

- **Pass:** each run finishes (`finish: lap` or the end of the road), off-road events no more than in
  the last retest's runs of the same layout in `tests\`, frame rate within 10% of them.
- **Pure tuning:** compare the foreshore run's lap0, lap25 and lap50 shots with the same shots from the
  last retest's foreshore run in `tests\` (before the tuning). Keep both sets side by side.
  - Pass: sand, limestone and the photo ground no longer glare white at noon; cars and houses not
    darker than before; the far end of the bay slightly hazy, not milky and not crystal sharp.
  - Fail: ground grey or muddy, or heavy fog.
- **Drift spots:** the sights loop passes car parks; nothing to see without the app (Mac's part). Only
  check no shot shows anything odd in a car park.

## 3. Night and AI cars (25 minutes)

```powershell
.\scripts\windows\run-test.ps1 busselton -Layout foreshore -Night -SkipInstall
.\scripts\windows\run-test.ps1 busselton -Layout town -Cars 5 -SkipInstall
```

- **Night pass:** the console's `time of day` line says `time=22:00` and `headlights=true`. Street
  lights, shop signs and jetty lamps lit in the shots. Keep the jetty shot and the darkest shot.
  - Fail: the time says 13:00 or 18:00 (weather FX off: quote the CSP version), or the road ahead is
    black between lights. Quote the `clock` note from `btest.csv` and the CSP log's
    `Weather FX: start time=` line either way.
- **AI cars pass:** the console says `AI cars: 5`, all six cars appear in the replay at the start, no
  more than a couple of contacts, no stops of 10 s or more. Keep a shot with cars in it.
  - Fail: cars stacked on the grid, a pile-up at a roundabout (three or more cars), or a car parked
    for the rest of the run. Say where (the `cstuck` and `contact` lines in `btest.csv` have x and z).

## 4. Free Roam with a full grid: the AI Flood pit boxes (15 minutes)

AI Flood itself only runs in Track Day mode, which the script can't start (Mac's part). This checks the
24 boxes it relies on: the same spots are the race grid.

```powershell
.\scripts\windows\run-test.ps1 busselton -Layout free_roam -Cars 15 -SkipInstall
```

- **Pass:** 15 AI cars start (the console says so; with fewer boxes it says how many), nobody starts
  inside another car or a wall, every car moves off along the loop at town speeds, and no pile-up in
  the first minute. Keep the first shot.
- **Fail:** cars spawning on top of each other, on a kerb, or facing the wrong way; cars sitting in their
  box. Quote the `contact` lines from the first 20 seconds of `btest.csv`.

## 5. Rain: wet roads and the hollows (20 minutes)

```powershell
.\scripts\windows\run-test.ps1 busselton_wet -Layout town -Rain
```

`-Rain` picks a rain weather from `content\weather` (it prints which one and the others it found). The
run keeps the track's `ext_config.ini`, so the laptop session's report can list the hollows the drive
passed and the shot nearest each.

- **Pass:** the console's `rain:` line shows an intensity of 0.05 or more. In the shots the road is wet
  and reflective, with standing water on the road and in the gutters, not on lawns, roofs or
  footpaths beside houses. Keep three shots with water on the road.
  - Fail: `it didn't rain` (quote the weather it picked and CSP's version), `rain: not logged` (old
    build), or puddles floating above the road or on the grass.
- **Kerbside markings** (same run, it's the same build): parking T-marks and bay lines along the kerb on
  town streets, bike lanes with a white line and bicycle symbols where they exist. Lines lie flat on the
  road, not floating, not flickering, broken at junctions. Keep one of each.

## 6. Track sounds: does a placeholder bank break anything? (12 minutes)

The sound bank doesn't exist yet (the build's `extension\sfx\README.txt` says what goes in it). This
only checks that a build with the sounds switched on still works.

```powershell
.\scripts\windows\run-test.ps1 busselton_foreshore
```

- **Pass:** the run loads and finishes like a normal one. Quote every line in `custom_shaders_patch.log`
  mentioning `sfx`, `bank`, `sound` or `FMOD`.
- **Fail:** AC fails to load or crashes; put the last 30 lines of both logs in the report.

## 7. Country roads: Armco, farms and landscape zones (40 minutes)

```powershell
.\scripts\windows\run-test.ps1 caves_road_yallingup -SkipInstall
.\scripts\windows\run-test.ps1 busselton_to_dunsborough -SkipInstall
```

Both are point to point, so a run ends at the far end of the road. Go through every shot.

- **Runs pass:** both finish at the end of the road; note off-road events and where (lap %).
- **Armco:** W-beam rail on posts on the outside of tighter bends, on embankments, along bridges and over
  creeks and drains, with buried ends. Keep a bend and a bridge or culvert.
  - Fail: rail across the road or a driveway, floating or sunk, or the AI stopping against an invisible
    wall (an off-road or stuck event next to a rail).
- **Vineyards and fences:** vine rows in straight lines on trellis posts, nearest the road; post-and-wire
  fences along paddocks. Keep one of each. Fail: vines on the road or in the bush, fences across the road.
- **Farm roadsides:** gravel aprons where farm tracks leave the road, a gate on posts at the fence line,
  a mailbox at the mouth; ridged steel cattle grids with white rails where the road crosses one. Keep
  one. Fail: a gate across the road itself, or the AI braking hard or jumping at a cattle grid (a speed
  dip in `btest.csv` at that spot).
- **Landscape zones:** the trees, ground and verge colour change along the way: coastal heath and
  peppermints near the sea, tall tuart and jarrah-marri inland, green paddocks, wetland near the Vasse.
  Keep one shot per zone you can tell apart. Fail: the same trees and verge the whole way.
- **Time trial file:** step 1 checked it; driving it is Mac's part.

## 8. Gravel (15 minutes)

Take a track that step 1 found with `KEY=UNSEALED` (gravel on the drive itself). If only `UNPAVED` is
there (gravel side tracks the AI doesn't drive), skip the run and only look for gravel side tracks in
step 7's shots.

```powershell
.\scripts\windows\run-test.ps1 <that track> -SkipInstall
```

- **Pass:** pale limestone gravel, no line markings or kerbs on it, dust behind the car (CSP), the AI
  slower on it than on bitumen but not stuck, and no off-road events on the gravel (it counts as track).
  Keep a gravel shot.
- **Fail:** gravel drawn on a sealed road, white lines on gravel, or every gravel sample logged
  off-road.

## 9. Karri and marri 3D trees (20 minutes)

```powershell
.\scripts\windows\run-test.ps1 caves_road_boranup -SkipInstall
```

- In `custom_shaders_patch.log`, quote the tree lines (`Loading trees`, any tree errors).
- Trees per model: `Select-String "^tree: (\w+)\.bin" "$t\extension\trees\trees.txt" | Group-Object { $_.Matches[0].Groups[1].Value } | Select-Object Name, Count`.
  Say how many are karri and marri.
- **Pass:** through the Boranup forest, karri stand very tall (about 40 m or more) with straight pale trunks
  and crowns high up; marri shorter with rough dark bark and dense crowns; upright, on the ground, leaves
  not black or inside-out; frame rate (`fpsall`) above 60. Keep two forest shots.
- **Fail:** no trees, trees lying down or floating, or under 45 fps.

## 10. AO bakes (45 minutes, mostly waiting)

The Busselton geometry changed, so bake it again; bake one country road quickly to see the new roadside
meshes take AO.

```powershell
.\scripts\windows\bake-vao.ps1 -Track busselton
.\scripts\windows\bake-vao.ps1 -Track caves_road_yallingup -Quality test
.\scripts\windows\run-test.ps1 busselton -Layout sights -SkipInstall
.\scripts\windows\run-test.ps1 caves_road_yallingup -SkipInstall
```

- Each bake writes its log, time and settings to `bakes\`. Note the minutes and the `.vao-patch` sizes.
- **Pass:** soft shading under Armco rails, at fence and vine posts, under eaves and in the landmarks'
  verandahs; nothing black. Keep before (step 2 or 7) and after shots of the same spot.
- **Fail:** a bake error (last 30 lines of `vao-bake.log` and `.err`), black patches or stripes.

## 11. The rig installer, dry run (5 minutes)

From the share's own copy, as the rig would run it:

```powershell
& "\\media\busselton-share\rig\scripts\windows\rig-install.ps1" -DryRun
```

If `\\media\busselton-share\Install Busselton.cmd` or the `rig\` folder isn't there, run
`.\scripts\windows\rig-install.ps1 -PublishKit` from the repo first (it only copies the installer into
the share) and say so.

- **Pass:** it finds AC and the share by itself, lists the newest zip of each track not yet installed
  from that zip (bases before their polish), lists older zips of the same track as skipped, shows any
  `builds\<zip>.txt` notes, ends with `dry run: nothing was touched`, and no errors. Paste its output.
- **Fail:** it can't find AC or the share, errors, or lists something it would install twice.

## 12. Logs and report

Copy `log.txt` and `custom_shaders_patch.log` from the last run into the report's folder. Quote lines
with `error`, `failed`, `tree`, `rain`, `sfx`, `traffic` or `busselton`. Then fill in this table and
tell Mac the report is in the share.

| # | Feature | Result (pass / fail / unsure / not in build) | Run folder or shot | Notes |
| --- | --- | --- | --- | --- |
| 1 | Files in each build | | | |
| 2 | Busselton day runs, Pure tuning | | | |
| 3 | Night run; AI cars | | | |
| 4 | Free Roam full grid | | | |
| 5 | Rain and hollows; kerbside | | | |
| 6 | Track sounds (loads) | | | |
| 7 | Armco, farms, farm roadsides, zones | | | |
| 8 | Gravel | | | |
| 9 | Karri and marri | | | |
| 10 | AO bakes | | | |
| 11 | Rig installer dry run | | | |

List the run folders in `tests\` the laptop session should read with `autotest_report.py`.

## Mac's part (on the rig, about 20 minutes)

Things that need someone driving:

1. **AI Flood:** Track Day on Busselton Free Roam, 12 road cars (setup in `docs/traffic-test.md`, "AI
   Flood"). Do cars vanish behind you and turn up ahead?
2. **Traffic zones:** the traffic planner on Busselton. Main roads and the town centre busier than the
   back streets? With a kids' build or layout: slower and sparser?
3. **Busselton Challenges app:** a time trial on Caves Road (splits show, time saved) and a drift spot in
   a Busselton car park (score counts).
4. **LAN leaderboard:** a Content Manager LAN session, rig and workstation. Does a best time set on one
   show on the other's board?
5. **Rain by feel:** a lap of Busselton Wet in the rain. Water where you'd expect after a storm?
