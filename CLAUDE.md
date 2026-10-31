# Busselton AC: notes for Claude

Mac's project: Busselton, Vasse and Broadwater as Assetto Corsa (AC1) tracks, built from real data. This repo is a fork of honestjams/ac-track-builder (a browser app that turns real roads into AC tracks) plus WA data and headless tooling. Read README.md for the user-facing overview.

## How Mac works

- Plain, direct language. Short updates. Lead with the result.
- He drives the tracks and reports what feels wrong; you do the building, checking and fixing.
- He instructs from his laptop or phone, so put anything he must read in your reply, not buried in tool output.

## Machines and who does what

Code is written in one place only. Check which machine you're on before you change anything.

| Where | Role | Writes code? |
| --- | --- | --- |
| **Claude session from Mac's laptop or phone** (cloud workspace) | Everything that changes the repo: code, route files, docs, builds, checks, renders, commits and pushes to `origin main`. Sends Mac the zips. | **Yes. The only place.** |
| **Workstation** (Windows; Ryzen 5 5600, RTX 4060, 16 GB; AC + CSP + Pure) | Test bench. Install a build, smoke test it in AC, read logs, report back. Later: heavy GPU jobs (Blender, photogrammetry) run from scripts already in the repo. | **No.** |
| **Gaming rig** (Windows; Ryzen 7 9800X3D, RTX 5080; AC, Content Manager, CSP) | Driving. Builds reach it through a network share of its `content\tracks` folder. | **No.** |

**If you are Claude Code on the workstation:**
- Never edit source, route files or docs, and never commit or push. The kids use this machine too, so it isn't always logged in or free; nothing in the project may depend on it.
- To test: `git pull`, then take builds from the share's `builds\` folder (see "The share" below). For an unattended AI run use `scripts\windows\run-test.ps1 <slug>` (step 5c) and don't write your own automation. Otherwise install with `scripts\windows\install-track.ps1 -Zip <slug>` (or `-All`), run the smoke test (step 5 below), and collect AC and CSP logs.
- When something is wrong, don't fix it. Write a short report: what you did, what happened, which file or mesh it looks like, and the relevant log lines. Save it in the share as `reports\<date>-<topic>.md`, with any files it points to in `reports\<date>-<topic>\` (screenshots, converted files, logs), and tell Mac it's there. Never ask Mac to copy files around: everything goes in the share.
- If you find local changes in the repo, leave them uncommitted and tell Mac; don't push them.

## The share

`\\media\busselton-share` on the network (`D:\busselton-share` where it's hosted; `BUSSELTON_SHARE` overrides; layout in `scripts/windows/share.ps1`) is the one place files move between machines and sessions. Mac shouldn't have to copy, attach or download anything by hand.

- `builds\<slug>.zip`: the latest build of each track.
- `tests\<date>_<time>-<slug>-<layout>\` (and `.zip`): automatic AI runs (`run-test.ps1`).
- `bakes\`: AO bake logs with their times (`bake-vao.ps1`).
- `reports\<date>-<topic>.md`: workstation reports, with their files in `reports\<date>-<topic>\`.
- `rig\` and `Install Busselton.cmd`: the rig's one-click installer (`scripts/windows/rig-install.ps1 -PublishKit` refreshes it; docs/rig-install.md). Polish zips go in `builds\` as `<slug>_polish.zip`, and an optional `builds\<zip name>.txt` note is shown on the rig.
- `snapshots\<slug>-<date>.zip`: each track's frozen inputs (`scripts/snapshot/snapshot.mjs`), what its base is rebuilt from. The cloud workspace is temporary, so the share holds the lasting copy.

The scripts read and write there by default. **Laptop session:** when this chat is linked to Mac's laptop or the workstation (the remote-devices tools are present and a call succeeds; both reach the share), write each finished build straight into `builds\` and read `tests\`, `bakes\` and `reports\` yourself; when it isn't linked, send the files in chat and say the share is waiting for the link. **Workstation:** put everything for the laptop session in the share, never in Downloads or the repo.

Both Windows machines can run AC at the same time; LAN racing uses Content Manager's built-in LAN mode, with no server software. The workstation has 16 GB RAM: close AC and Blender before photogrammetry, and keep scans under about 200 photos.

## Generate, freeze, polish

How tracks are worked on (ROADMAP.md, strategy; `tracks/README.md` has the commands):
- **Two tiers.** Showcase tracks (Busselton, the estate, later Yallingup, Margaret River and so on) get polished landmark by landmark. Drive-anywhere tracks are generated, rebuilt freely and never hand-polished.
- **Frozen inputs.** A showcase track's base rebuilds from its snapshot (`SNAPSHOT=<dir>`; manifest in its folder, zip in the share), not live data.
- **Polish is layers.** Landmarks (`routes/landmarks/`) compile to `lm_<slug>.kn5` with `scripts/polish/landmarks.ts`, in about 20 s, as a polish zip that `install-track.ps1 -Overlay` lays over the installed track. Never hand-edit a generated mesh: replace it with a layer.
- **Base upgrades are deliberate.** `scripts/upgrade/base.mjs build|accept|rollback`, with `scripts/check/all.mjs` running every check and comparing against the accepted base.
- **One folder per track.** `tracks/<slug>/` holds its status page, `snapshot.json` and `base.json`; private tracks keep theirs under `routes/private/tracks/`.

## Build loop

1. Route file in `routes/` (pins as `[lng, lat]`; `loop: true` for a circuit).
2. `node scripts/headless/build-track.mjs routes/<name>.json` writes `out/<slug>.zip`, `.stats.json` and `.centreline.json`. It stops if Overpass or map tiles still fail after retries ("MISSING DATA"); just build again. Overpass is often busy. Downloads are cached in `out/cache` for 14 days (`CACHE_DAYS`), so rebuilds take about half the time; `NO_CACHE=1` fetches everything fresh, e.g. after OSM edits. A build with no progress for 10 minutes stops so a retry loop can run it again.
3. `python3 -I scripts/check/check_build.py out/<slug>.centreline.json` checks the build. It must pass before Mac sees a build:
   - no hairpin spikes (exits non-zero and circles them in magenta on `out/<slug>.overlay.png`)
   - road height minus DEM: 95% within 0.3 m
   - road edges on the real road in the overlay: look at it, at least the corners and start/finish
4. Install (workstation): `scripts\windows\install-track.ps1` unzips into AC and optionally copies to the rig.
4b. Surface check: `npx tsx scripts/check/dump_surface.ts out/<slug>.zip out/<slug>.surface.json` then `python3 -I scripts/check/surface_check.py out/<slug>.surface.json`. Driving line kinks should be 0, max tilt about 3%, and edge steps around kerb height (15 to 20 cm median). Then `python3 -I scripts/check/street_ground.py out/<slug>.surface.json`: the ground mustn't come up through a street (fails over 3 cm). And `python3 -I scripts/check/path_ground.py out/<slug>.surface.json`: paths within 10 cm of the ground.
4c. Renders: add `SHOTS=0.02,0.25,0.5` (lap fractions, `lng:lat:lookLng:lookLat:height`, or `car0`..`car9` to look at parked cars) to the build command for driver's-eye PNGs in `out/`. They come from the three.js preview: photo ground only, no ksMultilayer detail or CSP. To catch visual regressions, build with the same SHOTS (`SHOTS=auto` gives a standard set: the drive and every roundabout) before and after a change: `python3 -I scripts/check/render_diff.py <slug> --save` on the first set, then `render_diff.py <slug>` writes `out/<slug>.compare.png` (before, after, changed).
4d. Traffic (when the route has `traffic: true`): `python3 -I scripts/check/traffic_check.py out/<slug>.zip out/<slug>.surface.json` must pass (no overlapping intersections, no loose lane ends, lanes on asphalt, no parked car in a lane).
4e. Budget: `npx tsx scripts/check/budget.ts out/<slug>.zip` (triangles, draw calls, texture memory, kn5 size against limits for the RTX 4060) must pass.
5. Smoke test (workstation, reported back, never fixed there): it loads, the car spawns on the grid, timing and pits work, and AI completes a lap.
5b. Traffic test (workstation or rig): `docs/traffic-test.md`.
5c. Automatic AI test (workstation, unattended): `scripts\windows\run-test.ps1 <slug>` installs the build, starts a practice session with the AI driving the player's car (an Abarth 500 at AI level 75 by default: town streets, not a race; `-Car`, `-AiLevel` change it) (the build's `extension/autotest.lua` track script, active only for a driver named "Busselton Test"), logs the drive and takes screenshots, quits, and puts logs, screenshots, replay and `btest.csv` in the share's `tests\<date>_<time>-<slug>-<layout>` plus a zip. Read it with `python3 -I scripts/check/autotest_report.py <zip> out/<slug>.surface.json` (it finds the layout from the run's `race.ini.used`). `-SkipInstall` drives what's installed (e.g. after an AO bake); reinstalling the same build keeps the bake.

Presets: a route with `"preset": "country"` or `"town"` gets those settings from `scripts/headless/presets.mjs` (the route's own settings win). Country turns on Armco, farmland, farm roadsides, landscape zones and the keep-left AI line; town turns on kerbside markings and keep-left. `"ways": [osm ids]` takes the centreline from OSM instead of OSRM (raceways, gravel tracks); `"unsealed": true` makes a route gravel. Other build options (all in `src/core/options.ts`): `rainHollows`, `trackSounds`, `wavingFlags`, `jettyTrain`, `pureTuning`, `trafficZones`, `trafficSetting: "kids"`, `cspTrees`, `photoSea`, `trafficLights`, `poleClear`, `parkedBays`, `laneBayClear`, `networkCore` (off; the new road core in progress). `scripts/check/ground_check.ts` (run by all.mjs) fails a build with anything more than 5 cm off the built ground, lamp heads off their poles or poles on the road; `parked_check.ts` fails overlapping parked cars, cars off asphalt or outside bays; `lane_bay_check.ts` fails a traffic lane over parking bays.

Busselton is flat, so town routes use `"banking": false` in options, plus `terrainStep: 1.5` and `terrainUnderRoad: 0.12` in `build`. The upstream defaults are for hilly roads: up to 6% banking, a 3 m terrain grid and ground sunk 0.6 m under the road, which together made tilted corners and 40 to 60 cm drops at the road edges here.

House looks: `HOUSE_LOOKS=out/<slug>.looks.json,routes/private/<file>.json` (comma-separated, later files win) gives particular houses their facade (a wall kind like `weatherboard`, or an upstream facade name like `wb_blue`), front hedge and height, and front-yard trees; `place: true` builds the house (15 x 13 m, facing the nearest road) when the photo didn't give one. `scripts/mapillary/house_looks.py out/<slug>.houses.json [--sequence <id>] [--min-photos 1]` makes the photo looks from Mapillary. A look with `specFile` (a spec in `scripts/blender/house.py`'s parts mode, `scripts/blender/example_parts.json`) builds that house from the spec instead, facing its street, in place of the generated one; the same spec renders in Blender. An area's own mix goes in the route's `build.houseStyle` (`{ "facades": { "wb_white": 3, ... } }`).

Area builds and layouts (docs/one-map.md): `build.area` (a polygon) builds every street inside it, drivable; `layout` and `layouts` in a route file put several layouts on one world (`layout_<id>.kn5`, `models_<id>.ini`, `<id>/ai`, `<id>/data`, `ui/<id>`). Check them with `npx tsx scripts/check/layout_check.ts out/<slug>.zip`. `build.area` can be several polygons. Every build ships `extension/street_map.png`/`.ini` for the Busselton Map app (`apps/lua/BusseltonMap`, installed by `install-track.ps1` with Busselton Challenges). The house photo walk is `scripts/houses/photo_walk.py` (match, draft, render, review, looks; see scripts/capture/README.md).

Don't edit `src/` while a build is running from this checkout: Vite reloads the build's page and it fails. Build from a copy of the repo (node_modules and out/ linked back) when working on code alongside.

Pins snap to the nearest road. A pin near a car park, side street or the far carriageway of a divided road makes a detour or a U-turn spike. Put pins mid-block on the road you want, or leave them out and let the route follow the road.

## Upstream

honestjams/ac-track-builder is a source of ideas, not a partner: its owner has moved on (docs/external-review-2026-10-31.md). Don't design around clean merges any more.

- Look at upstream's commits and `docs/roadmap.md` now and then, take ideas, and write the code fresh. Don't merge upstream code into files we've rewritten.
- Owning the code is a long-term goal: the fork's own code is under PolyForm Noncommercial 1.0.0 (`LICENSE`); upstream-derived files are excluded and listed in `UPSTREAM-FILES.txt`, made by `scripts/provenance/upstream_overlap.py` (rerun it with `--write` after each rewrite). Rewrite, don't edit: a behaviour spec in `docs/specs/` first, then a fresh module written from the spec by a separate session without the old file open, with fresh tests. Delete what we don't use instead of rewriting it (check with Mac first).
- Small general fixes can still go upstream as PRs when Mac wants (his merged PRs are his own work).

## Code map

- `src/core/`: the pipeline (no DOM, runs in Node tests). `track.ts` is `buildTrack(route, options, sources)`.
- `src/services/tiles.ts`: imagery sources (`IMAGERY`, WA = Landgate Locate ImageServer by bbox) and elevation (`STATE_DEMS`, WA = static Terrarium tiles in `public/dem/wa/15`).
- `src/services/osm.ts`: OSRM routing (reports `uturns`), Overpass, geocoding.
- `src/services/pipeline.ts`: the build from fetching data to files, run in a Web Worker (`src/ui/buildWorker.ts`). Data sources the fork adds (coast, paths, house looks, shop signs, missing-data warnings) go here, not in main.ts; anything from the page reaches it through the `BuildJob`.
- `src/ui/main.ts`: the browser UI. In dev mode it exposes `window.__app` (addPin, result, preview, dataWarnings), which the headless script uses.
- `src/core/buildingStyles.ts` (upstream): facades, roofs and building types. `src/core/houseLooks.ts` (fork) maps house looks and `houseStyle` onto them.
- `scripts/dem/make_wa_tiles.py`: regenerates the DEM tiles from GA's 5 m mosaic. The box must match `STATE_DEMS.wa.box`.
- Tests: `npx vitest run`. Type-check: `npx tsc --noEmit`. Run both before committing.

## AC conventions (for Blender / ksEditor work)

- Physics meshes are named with a digit then a surface key from the track's `data/surfaces.ini`, then anything: `1ROAD_...`, `1KERB_...`, `1GRASS_...`, `1STREET_...`. Check that file for the keys a build uses. Visual-only meshes have no digit prefix.
- Dummies (empties): `AC_START_0..n` (grid), `AC_PIT_0..n`, `AC_TIME_0_L` / `AC_TIME_0_R` (start/finish on a circuit), `AC_HOTLAP_START_0`. Point-to-point tracks use `AC_AB_START_L/R` and `AC_AB_FINISH_L/R`.
- Hand-made detail goes in its own .kn5, layered over the generated one (models.ini), so rebuilding the base never wipes it. Put `<name>.kn5` and a sidecar `<name>.json` (`{ "replaces": [{ "at": [lng, lat], "radius": m, "trees": false? }] }`) in a layers folder, list the folder in the route's `"layers"` (or `LAYERS=dir,dir`): the build clears the generated and spec houses (and trees) in those circles, adds the layer to the zip and writes models.ini. Private layers go in `routes/private/layers/`. The route needs a fixed `build.origin` (every route has one) so layers stay lined up; `scripts/check/make_test_layer.ts` makes a marker box to test with.
- Blender: script every step (`blender --background --python ...`) so it can be rerun. No ksEditor needed: our own glTF converters go both ways, in the track's own coordinates.
  1. `npx tsx scripts/blender/export_base.ts out/<slug>.zip base.glb --route <route.json> --at <lng,lat> [--radius 120]`: the generated track around the spot, with textures.
  2. `blender --background --python scripts/blender/new_layer.py -- --base base.glb --out layer.blend`: the base as a locked reference, and an empty "Layer" collection to model in.
  3. Model in "Layer" (object names `1WALL_...` etc. for physics), then `blender --background layer.blend --python scripts/blender/export_layer.py -- --out layer.glb`.
  4. `npx tsx scripts/blender/make_layer.ts layer.glb <layers dir> <name> --replaces <lng,lat,radius>`: the layer's .kn5 and sidecar, ready for the route's `"layers"`.

## Privacy

The fork is public. Never commit anything that locates Mac's home: street names, pins or notes near it. Personal routes live in `routes/private/` (gitignored), including the Home Run, the estate build and the hand-set look of Mac's house. Builds of those, and their renders, never go anywhere public. Commit as `macleancherry <2775263+macleancherry@users.noreply.github.com>`, never a personal email.

## Data rules

- Landgate Locate and Esri imagery: personal, non-commercial use only. Mapillary: CC BY-SA, don't publish tracks containing it. OSM: ODbL, credit it.
- Never publish or upload builds publicly. A public version needs imagery Off, no Mapillary, CC0 textures and Mac's own scans only.
- Don't commit `out/` (it's in .gitignore) or big binaries other than the DEM tiles.

## Commits

Small commits with a plain summary line. Run tests and type-check first. Push to `origin main` (Mac's fork).
