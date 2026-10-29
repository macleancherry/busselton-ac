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
- To test: `git pull` (or take the zip Mac gives you). For an unattended AI run use `scripts\windows\run-test.ps1 -Zip <zip>` (step 5c) and don't write your own automation. Otherwise install the build (unzip into AC's `content\tracks`, or `scripts\windows\install-track.ps1` on an existing zip), run the smoke test (step 5 below), and collect AC and CSP logs.
- When something is wrong, don't fix it. Write a short report: what you did, what happened, which file or mesh it looks like, and the relevant log lines. Save it as `reports/<date>-<topic>.md` (gitignored) and tell Mac, so he can paste it into the laptop session.
- If you find local changes in the repo, leave them uncommitted and tell Mac; don't push them.

Both Windows machines can run AC at the same time; LAN racing uses Content Manager's built-in LAN mode, with no server software. The workstation has 16 GB RAM: close AC and Blender before photogrammetry, and keep scans under about 200 photos.

## Build loop

1. Route file in `routes/` (pins as `[lng, lat]`; `loop: true` for a circuit).
2. `node scripts/headless/build-track.mjs routes/<name>.json` writes `out/<slug>.zip`, `.stats.json` and `.centreline.json`. It stops if Overpass or map tiles still fail after retries ("MISSING DATA"); just build again. Overpass is often busy. Downloads are cached in `out/cache` for 14 days (`CACHE_DAYS`), so rebuilds take about half the time; `NO_CACHE=1` fetches everything fresh, e.g. after OSM edits. A build with no progress for 10 minutes stops so a retry loop can run it again.
3. `python3 -I scripts/check/check_build.py out/<slug>.centreline.json` checks the build. It must pass before Mac sees a build:
   - no hairpin spikes (exits non-zero and circles them in magenta on `out/<slug>.overlay.png`)
   - road height minus DEM: 95% within 0.3 m
   - road edges on the real road in the overlay: look at it, at least the corners and start/finish
4. Install (workstation): `scripts\windows\install-track.ps1` unzips into AC and optionally copies to the rig.
4b. Surface check: `npx tsx scripts/check/dump_surface.ts out/<slug>.zip out/<slug>.surface.json` then `python3 -I scripts/check/surface_check.py out/<slug>.surface.json`. Driving line kinks should be 0, max tilt about 3%, and edge steps around kerb height (15 to 20 cm median).
4c. Renders: add `SHOTS=0.02,0.25,0.5` (lap fractions, `lng:lat:lookLng:lookLat:height`, or `car0`..`car9` to look at parked cars) to the build command for driver's-eye PNGs in `out/`. They come from the three.js preview: photo ground only, no ksMultilayer detail or CSP. To catch visual regressions, build with the same SHOTS (`SHOTS=auto` gives a standard set: the drive and every roundabout) before and after a change: `python3 -I scripts/check/render_diff.py <slug> --save` on the first set, then `render_diff.py <slug>` writes `out/<slug>.compare.png` (before, after, changed).
4d. Traffic (when the route has `traffic: true`): `python3 -I scripts/check/traffic_check.py out/<slug>.zip out/<slug>.surface.json` must pass (no overlapping intersections, no loose lane ends, lanes on asphalt, no parked car in a lane).
4e. Budget: `npx tsx scripts/check/budget.ts out/<slug>.zip` (triangles, draw calls, texture memory, kn5 size against limits for the RTX 4060) must pass.
5. Smoke test (workstation, reported back, never fixed there): it loads, the car spawns on the grid, timing and pits work, and AI completes a lap.
5b. Traffic test (workstation or rig): `docs/traffic-test.md`.
5c. Automatic AI test (workstation, unattended): `scripts\windows\run-test.ps1 -Zip <zip>` installs the build, starts a practice session with the AI driving the player's car (an Abarth 500 at AI level 75 by default: town streets, not a race; `-Car`, `-AiLevel` change it) (the build's `extension/autotest.lua` track script, active only for a driver named "Busselton Test"), logs the drive and takes screenshots, quits, and puts logs, screenshots, replay and `btest.csv` in `$env:BUSSELTON_TEST_SHARE\<date>-<slug>` plus a zip. Mac attaches the zip here; read it with `python3 -I scripts/check/autotest_report.py <zip> out/<slug>.surface.json`.

Busselton is flat, so town routes use `"banking": false` in options, plus `terrainStep: 1.5` and `terrainUnderRoad: 0.12` in `build`. The upstream defaults are for hilly roads: up to 6% banking, a 3 m terrain grid and ground sunk 0.6 m under the road, which together made tilted corners and 40 to 60 cm drops at the road edges here.

House looks: `HOUSE_LOOKS=out/<slug>.looks.json,routes/private/<file>.json` (comma-separated, later files win) gives particular houses their facade (a wall kind like `weatherboard`, or an upstream facade name like `wb_blue`), front hedge and height, and front-yard trees; `place: true` builds the house (15 x 13 m, facing the nearest road) when the photo didn't give one. `scripts/mapillary/house_looks.py out/<slug>.houses.json [--sequence <id>] [--min-photos 1]` makes the photo looks from Mapillary. An area's own mix goes in the route's `build.houseStyle` (`{ "facades": { "wb_white": 3, ... } }`).

Pins snap to the nearest road. A pin near a car park, side street or the far carriageway of a divided road makes a detour or a U-turn spike. Put pins mid-block on the road you want, or leave them out and let the route follow the road.

## Upstream

honestjams/ac-track-builder moves fast and often builds things we also want. It's a general tool for any road; we're one place. So general looks and scenery (buildings, materials, shaders, ground and road detail, lighting, race dressing) are upstream's: take them by merging, don't build our own. Ours is what a general tool won't do (the single Busselton map, layouts, open world, traffic, AI, testing and checks, our own data, the South West, kids' modes); see "Who builds what" in ROADMAP.md.

Before starting anything general, check upstream's `docs/roadmap.md` and recent commits. If it's on their list, wait for it or build it as a PR for them.

After every tranche of work, before reporting back to Mac:

1. `git fetch upstream` (add it with `git remote add upstream https://github.com/honestjams/ac-track-builder.git` if missing) and `git log main..upstream/main`.
2. If there's anything new, tell Mac what it is, then merge: take upstream's version where both sides built the same thing, keep the fork's South West work on top, rerun the tests and the checks, and rebuild.
3. Note anything worth sending back upstream.

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
- Hand-made detail goes in its own .kn5, layered over the generated one (models.ini), so rebuilding the base never wipes it.
- Blender: script every step (`blender --background --python ...`) so it can be rerun. Export FBX, then ksEditor makes the .kn5.

## Privacy

The fork is public. Never commit anything that locates Mac's home: street names, pins or notes near it. Personal routes live in `routes/private/` (gitignored), including the Home Run, the estate build and the hand-set look of Mac's house. Builds of those, and their renders, never go anywhere public. Commit as `macleancherry <2775263+macleancherry@users.noreply.github.com>`, never a personal email.

## Data rules

- Landgate Locate and Esri imagery: personal, non-commercial use only. Mapillary: CC BY-SA, don't publish tracks containing it. OSM: ODbL, credit it.
- Never publish or upload builds publicly. A public version needs imagery Off, no Mapillary, CC0 textures and Mac's own scans only.
- Don't commit `out/` (it's in .gitignore) or big binaries other than the DEM tiles.

## Commits

Small commits with a plain summary line. Run tests and type-check first. Push to `origin main` (Mac's fork).
