# Busselton AC: notes for Claude

Mac's project: Busselton, Vasse and Broadwater as Assetto Corsa (AC1) tracks, built from real data. This repo is a fork of honestjams/ac-track-builder (a browser app that turns real roads into AC tracks) plus WA data and headless tooling. Read README.md for the user-facing overview.

## How Mac works

- Plain, direct language. Short updates. Lead with the result.
- He drives the tracks and reports what feels wrong; you do the building, checking and fixing.
- He often instructs from his phone while you run on the workstation, so put anything he must read in your reply, not buried in tool output.

## Machines (all Windows, gigabit LAN)

- **Workstation** (Ryzen 5 5600, RTX 4060, 16 GB): runs Claude, all tools, and AC + CSP + Pure for smoke tests. Builds happen here.
- **Gaming rig** (Ryzen 7 9800X3D, RTX 5080): AC, Content Manager and CSP only. Builds reach it through a network share of its `content\tracks` folder.
- Both machines can run AC at the same time. LAN racing uses Content Manager's built-in LAN mode, with no server software.
- 16 GB RAM on the workstation: close AC and Blender before photogrammetry; keep scans under about 200 photos.

## Build loop

1. Route file in `routes/` (pins as `[lng, lat]`; `loop: true` for a circuit).
2. `node scripts/headless/build-track.mjs routes/<name>.json` writes `out/<slug>.zip`, `.stats.json` and `.centreline.json`.
3. `python3 -I scripts/check/check_build.py out/<slug>.centreline.json` checks the build. It must pass before Mac sees a build:
   - no hairpin spikes (exits non-zero and circles them in magenta on `out/<slug>.overlay.png`)
   - road height minus DEM: 95% within 0.3 m
   - road edges on the real road in the overlay: look at it, at least the corners and start/finish
4. Install: `scripts\windows\install-track.ps1` (build, check, unzip into AC, optionally copy to the rig).
5. Smoke test in the workstation's AC: it loads, the car spawns on the grid, timing and pits work, and AI completes a lap.

Pins snap to the nearest road. A pin near a car park, side street or the far carriageway of a divided road makes a detour or a U-turn spike. Put pins mid-block on the road you want, or leave them out and let the route follow the road.

## Code map

- `src/core/`: the pipeline (no DOM, runs in Node tests). `track.ts` is `buildTrack(route, options, sources)`.
- `src/services/tiles.ts`: imagery sources (`IMAGERY`, WA = Landgate Locate ImageServer by bbox) and elevation (`STATE_DEMS`, WA = static Terrarium tiles in `public/dem/wa/15`).
- `src/services/osm.ts`: OSRM routing (reports `uturns`), Overpass, geocoding.
- `src/ui/main.ts`: the browser UI. In dev mode it exposes `window.__app` (addPin, result), which the headless script uses.
- `scripts/dem/make_wa_tiles.py`: regenerates the DEM tiles from GA's 5 m mosaic. The box must match `STATE_DEMS.wa.box`.
- Tests: `npx vitest run`. Type-check: `npx tsc --noEmit`. Run both before committing.

## AC conventions (for Blender / ksEditor work)

- Physics meshes are named with a digit then a surface key from the track's `data/surfaces.ini`, then anything: `1ROAD_...`, `1KERB_...`, `1GRASS_...`, `1STREET_...`. Check that file for the keys a build uses. Visual-only meshes have no digit prefix.
- Dummies (empties): `AC_START_0..n` (grid), `AC_PIT_0..n`, `AC_TIME_0_L` / `AC_TIME_0_R` (start/finish on a circuit), `AC_HOTLAP_START_0`. Point-to-point tracks use `AC_AB_START_L/R` and `AC_AB_FINISH_L/R`.
- Hand-made detail goes in its own .kn5, layered over the generated one (models.ini), so rebuilding the base never wipes it.
- Blender: script every step (`blender --background --python ...`) so it can be rerun. Export FBX, then ksEditor makes the .kn5.

## Data rules

- Landgate Locate and Esri imagery: personal, non-commercial use only. Mapillary: CC BY-SA, don't publish tracks containing it. OSM: ODbL, credit it.
- Never publish or upload builds publicly. A public version needs imagery Off, no Mapillary, CC0 textures and Mac's own scans only.
- Don't commit `out/` (it's in .gitignore) or big binaries other than the DEM tiles.

## Commits

Small commits with a plain summary line. Run tests and type-check first. Push to `origin main` (Mac's fork).
