# Busselton AC roadmap

**Goal:** the South West of WA in Assetto Corsa, from the Busselton Jetty to Cape Leeuwin. A few well-known places built in high detail, landmark by landmark; everywhere else a reasonably accurate area where every road is drivable. Real roads and heights, local trees and buildings, traffic, day and night, summer and winter. Free data and free tools, for personal use, driving with the kids.

This is the plan for this fork. (`docs/roadmap.md` is upstream's own roadmap for the general track builder, kept as-is so merges stay clean.) The generator itself is [honestjams/ac-track-builder](https://github.com/honestjams/ac-track-builder); anything useful beyond the South West goes back upstream (see [Working with upstream](#working-with-upstream)).

Status key: ✅ done · 🔨 in progress · ⬜ planned · ❓ needs checking first

---

## The strategy: generate, freeze, polish (30 Oct 2026)

Until now every change rebuilt a whole track from live data: map servers, imagery, Mapillary, heights. That was right while the generator was being built, but it won't scale to a region: a build takes 20 minutes, fails when Overpass is down, and moving one umbrella means re-testing everything. Exporting a finished track to Blender and hand-polishing it is worse: it cuts the track off from everything the generator does well (AI lines, traffic, terrain fixes, CSP config, checks), so every fix would have to be redone by hand on every frozen track.

So:

1. **Two tiers of track.**
   - **Showcase areas** (Busselton, the estate, Yallingup, Margaret River, Cape Naturaliste, Boranup): polished landmark by landmark.
   - **Drive-anywhere areas** (everything in between): generated, reasonably accurate, rebuilt freely whenever the generator improves, never hand-polished.
2. **Freeze each track's inputs, not its geometry.** Each track keeps a snapshot of its map data, imagery, heights and Mapillary detections (in the share; the imagery licence keeps it out of GitHub). Builds become offline, identical every time, and don't fail when a server is down.
3. **Split base and polish.**
   - The **base** (terrain, roads, generic buildings, AI, traffic, layouts) is rebuilt only on purpose.
   - The **polish** (landmarks, hand-set looks, Blender detail, corrections) is separate files on fixed coordinates: each landmark compiles to its own small model in seconds and drops into the installed track, with no base rebuild.
4. **Base upgrades are a deliberate step.** Rebuild from the frozen inputs, run the checks and the before/after renders, accept or roll back. The polish carries over because it sits on fixed coordinates.
5. **One folder per track** with its route, snapshot manifest, landmarks, layers, notes and status. One repo, because the generator is shared.

Rules that follow: never hand-edit a generated mesh (replace it with a layer instead); every polish item is data or a layer that a rebuild re-applies; a showcase area's base changes only through step 4.

---

## The tracks

AC can't load the whole South West as one map, so it's a set of tracks, each inside the RTX 4060's budget (about 1.5M triangles).

| Track | Tier | Status |
| --- | --- | --- |
| **Busselton** (Foreshore and town centre; layouts Foreshore, Town, Sights, Free Roam) | Showcase | 🔨 base built, 2 of 18 landmarks done, 6 more described |
| **The whole map** (private: adds the estate and the Home Run) | Showcase | 🔨 base built; private landmarks described |
| **Tuart Drive, Ludlow** (16 km) | Drive-anywhere | ✅ built, waiting on a drive |
| **Caves Road, Dunsborough to Yallingup** (11 km) | Drive-anywhere, Yallingup a showcase later | 🔨 route ready; needs sharper heights west of Dunsborough (see below) |
| **Bussell Highway, Busselton to Dunsborough** | Drive-anywhere | ⬜ |
| **Margaret River town** | Showcase | ⬜ |
| **Caves Road, Yallingup to Margaret River** | Drive-anywhere | ⬜ |
| **Boranup Drive and the karri** | Showcase | ⬜ (needs gravel, 3D karri) |
| **Cape Naturaliste Road and the lighthouse** | Showcase | ⬜ |
| **Cape Leeuwin, Augusta** | Showcase | ⬜ |
| **Collie Motorplex** (a real 1.6 km circuit) | Showcase | ⬜ |
| ❓ **Forest Rally stage, backroads** (Wildwood Rd, Tom Cullity Dr, Rosa Brook Rd) | Drive-anywhere | ⬜ drive them first, then pick |

---

## Phase A: Generate, freeze, polish (the tooling) ✅

What makes polishing cheap. First, because every landmark after it is quicker.

- ✅ **A1. Base and polish split.**
  - Landmarks (spec buildings) compile to their own layer `.kn5`s in seconds, outside the base build, clearing the generated buildings they stand on (the layer system already does this).
  - A polish-only build updates an installed track without regenerating it.
  - The automatic test and the checks work on base plus layers.
- ✅ **A2. Per-track input snapshots.** Pin a track's map data, imagery, heights and Mapillary detections into a snapshot (in the share, with a manifest in the repo), and build from it offline. Two builds from the same snapshot are byte-identical.
- ✅ **A3. Base upgrades.** Rebuild from the snapshot, run every check and `render_diff`, and show what changed; then accept or roll back. Refresh a snapshot only on purpose (e.g. new OSM edits).
- ✅ **A4. One folder per track** (`tracks/<name>/`, private ones under `routes/private/`): route, snapshot manifest, landmarks, layers, notes, and a status page.
- ✅ **Already in place:**
  - spec buildings with yards and lettered signs (`specHouse.ts`)
  - surface textures (brick, timber, canvas, steel)
  - hand-made layers over the generated track (`models.ini`, sidecars that clear what they replace)
  - Blender both ways in the track's own coordinates
  - Blender renders of any spec in this workspace (`bpy`)
  - landmark descriptions from the aerial and photos (`docs/landmarks/`)
  - the share for moving files between machines

## Phase B: Busselton, polished (the template for every showcase area) 🔨

- 🔨 **Landmarks** ([docs/landmarks.md](docs/landmarks.md)):
  - ✅ built: the jetty precinct, Rocky Ridge, the Esplanade Hotel, The Goose, the Old Courthouse group, the Hilton Garden Inn, the Visitor Centre, the Busselton Museum (the jetty precinct's streets joined the built area for them)
  - ⬜ to do: the foreshore playground and sculptures, the foreshore cafes, the yacht club, the cinema, the pubs, the cemetery, the fire station, the parks
  - private landmarks: listed in `routes/private/landmarks/` (photos of their street faces still needed)
- 🔨 **Houses from the photo walk:** spec houses from Mac's street photos (`scripts/houses/photo_walk.py`), street by street. Waiting on the first street of photos.
- 🔨 **Detail layers in Blender** for what a spec can't say: Rocky Ridge's vine pergola and festoon lights, the farm cottage's stonework. Judge from in-game screenshots first.
- 🔨 **In game:** the workstation retest (`docs/workstation-retest.md`) covers the AI on every layout, the AO bake, the 3D trees and the landmark screenshots. Mac's own checks: time of day and seasons, water, rain, night, the jetty, the map app, free roam.
- ⬜ **Town details:** kerbside parking bays, bike lanes, traffic lights (Busselton has few), car parks beyond the detailed ground.
- ✅ **Base work done:**
  - one map with layouts: Foreshore, Town, Sights and Free Roam on one world, and the private whole map with the estate and Home Run
  - every street drivable, traced from the aerial
  - roundabouts, kerbs and returns, footpaths, shopfronts with real names, parked cars
  - the seawall and groynes, the jetty precinct
  - Mapillary poles, lights and signs; local trees; CSP night lighting, seasons and water
  - the AI kept to the road and to the limits, with Kunos's lookup grid
  - spawns in the car parks
  - the map app and checkpoint challenges
  - the ground never through a street (`street_ground.py`)

## Phase C: Drive-anywhere South West 🔨

Generated tracks across the region at a lighter detail level, rebuilt whenever the generator improves.

- 🔨 **Heights.**
  - ✅ Geoscience Australia's 5 m LiDAR covers Busselton to Ludlow and west to Dunsborough.
  - It stops just west of Dunsborough: Yallingup, the capes and most of Caves Road fall back to about 30 m global heights, which smooth the hills.
  - ❓ Next: order the capes LiDAR from GA's ELVIS portal (free, links emailed), cut it into tiles.
- 🔨 **Caves Road, Dunsborough to Yallingup:** route ready (`routes/caves-road.json`). Build once the heights are sorted.
- 🔨 **A drive-anywhere preset:** ✅ `"preset": "country"` (`scripts/headless/presets.mjs`). Still to do: country settings (wider terrain grid, corridor and horizon sized to the budget, gentle banking) so a new road is one route file. Check 30+ km roads and draw distances.
- 🔨 **Country roadsides:** gravel shoulders, guideposts (done), Armco on bends, embankments, bridges and culverts (done: `build.armco`, on in the country preset, `src/core/armco.ts`), farm driveways, mailboxes, cattle grids.
- ⬜ **Unsealed roads:** gravel surface physics, dust, a limestone gravel texture (Boranup, farm roads).
- ⬜ **Landscape zones:** each with its own trees, ground and roadside.
  - coast: white sand, peppermint, granite
  - capes heath
  - tuart woodland
  - jarrah-marri forest
  - karri
  - vineyards and paddocks: vine rows from `landuse=vineyard`, post-and-wire fences, green in winter and gold in summer
  - Vasse-Wonnerup wetlands
- 🔨 **3D trees:** CSP instanced trees, five local species, three levels of detail. The file format is confirmed against Content Manager; in-game look being tested (`busselton_trees`). Next: on by default, then karri and marri, then photo textures of real foliage.

## Phase D: More showcase areas ⬜

Each starts as a drive-anywhere base, then gets the Phase B treatment: Yallingup, Margaret River's main street, Cape Naturaliste, Boranup, Cape Leeuwin, Collie Motorplex. Landmarks for each are listed in [docs/landmarks.md](docs/landmarks.md).

## Phase E: A living world 🔨

- 🔨 **Traffic.**
  - ✅ CSP traffic-planner lanes (`data/traffic.json`) with one-way streets and limits, checked automatically.
  - ⬜ Next:
    - an in-game test with the planner (`docs/traffic-test.md`)
    - AI Flood in Track Day on Free Roam
    - density zones (busy Queen St, quiet estates)
    - an Aussie traffic car pack (Hilux, Ranger, Corolla, i30, utes with trailers, caravans)
    - calmer settings for the kids
  - ❓ Does offline traffic work in Content Manager LAN?
- 🔨 **Atmosphere (CSP and Pure).**
  - ✅ The sun's real position, dry-season grass, bounced light, the bay as CSP water, wind, the tiling fix, Pure settings.
  - ✅ Night lighting.
  - ✅ AO baking (first bakes take under a minute on the 4060).
  - ⬜ Next:
    - RainFX puddles in low spots from the heights
    - track sounds: surf, magpies and kookaburras, the jetty train
    - animated flags and the jetty train
    - per-track Pure tuning for the bright WA sun

## Phase F: Testing and tooling 🔨

- ✅ The build checks:
  - photo overlay, heights, spikes, bumps and edge steps
  - budget, layouts, traffic
  - ground through streets
- ✅ Renders and before/after comparison, CI on every push, headless builds from a snapshot of the repo.
- ✅ The workstation:
  - the automatic AI test per layout, with landmark screenshots
  - AO bakes; everything goes to `\\media\busselton-share`
- 🔨 Link this chat to Mac's laptop so builds go straight into the share and reports come straight back.
- ⬜ A night run and a several-AI-cars run in the automatic test; a traffic-planner run.
- ⬜ A one-click install link for the rig.

## Phase G: Fun 🔨

- 🔨 **Checkpoint challenges:** Busselton Challenges app, checkpoints against the clock, hand-picked sets per track or layout (`challenges` in the route). To check in game.
- ✅ The Sights layout: a cruise past the town landmarks.
- 🔨 **Time trials and drift spots** in the Challenges app: A to B with splits on any point-to-point route or layout, drift spots in empty car parks with an angle-and-speed score, best times per driver, shared over LAN through CSP online events (AC's own server, which CM's LAN races use). To check in game, then routes between towns.
- ⬜ Cruise mode.

---

## What the best AC maps get right

| Map | What it does well | What we take |
| --- | --- | --- |
| **Shutoko Revival Project** | Huge, accurate road network, dense traffic, superb night lighting | Open world, traffic as a first-class feature, night as good as day |
| **Arrabassada** (Barcelona) | Urban highway into mountain road, traffic lights, viewpoints, night mode | Places to stop, town and country in one drive |
| **Slea Head Drive** (Ireland) | 48 trackside cameras, AI, rain, detailed buildings | Replay cameras, RainFX, care on buildings |
| **Wicklow Mountains** | ~47 km open world, two layouts with AI | Several layouts from one map |
| **Mulholland Drive** | A race version and a free-roam version with traffic | One race layout and one cruise layout per area |
| **Santa Monica Mountains** | Photogrammetry scenery | Our own photo scans for landmarks |
| **Street2Sim** | Pins to track, automatic checks, `.blend` export, area builds | Area builds, a track index |

Sources: [OverTake: six real-road maps for free roaming](https://racedepartment.com/news/comments/76810/), [Street2Sim](https://www.street2sim.com/) and [our notes on how it works](docs/how-street2sim-works.md).

## Who builds what: us and upstream

Upstream ([honestjams/ac-track-builder](https://github.com/honestjams/ac-track-builder)) is a general tool: any real road, anywhere, as a time-trial track, built in the browser. Its work is mostly looks and scenery: houses and building types, ground and road detail shaders, CSP lighting, race-day dressing. It has slowed since 29 October; where we need its planned work sooner, we build it ourselves after researching it properly, and offer it back.

- **Upstream's:** general looks and scenery (buildings, materials, shaders, ground and road detail, lighting, race dressing, general road furniture). We take these in by merging.
- **Ours:** what a general road tool won't do.
  - the generate-freeze-polish workflow and landmarks
  - one map with layouts, open world and spawns
  - traffic, and AI that drives like a local
  - headless builds, checks and the workstation test
  - our own data: WA heights, Mapillary, house looks, local trees, the coast
  - the South West tracks; fun modes for the kids
- **Before starting anything general,** check upstream's roadmap and recent commits (`git log main..upstream/main`).

## Working with upstream

[honestjams/ac-track-builder](https://github.com/honestjams/ac-track-builder) is the generator. We send back anything that isn't South West specific, and take its improvements in.

- **Merged:** kerb and roundabout fixes, the U-turn warning, `terrainUnderRoad` and no-trace zones, Landgate imagery.
- **Open:**
  - #6 spawn direction, roundabout mouths and AI corner hints
  - #7 terrain level of detail (now with a second level)
  - #8 CSP traffic lanes
  - #9 the coast
  - #10 retrying map data
- **Ready on Mac's fork, not opened yet:**
  - the U-turn spur fix (`pr/spur-side-street`)
  - CSP sun position, wind, bounced light, Pure and the AO bake settings (`pr/csp-pass`, after the in-game test)

Candidates to send next:
- dry-grass Grass FX tuning
- house lots
- the AI line through roundabouts and its lookup grid
- headless builds and the checks
- guideposts and kangaroo signs
- one-way streets in the traffic lanes
- roundabout islands from the photo
- the 3D tree writer (once confirmed in game)

## Data and sharing

- **Landgate and Esri imagery:** personal, non-commercial use only. **Mapillary:** CC BY-SA. **OpenStreetMap:** ODbL. **GA DEM:** CC BY 4.0. **ambientCG textures:** CC0.
- Builds and snapshots stay private (snapshots live in the share). A public South West release would need imagery off, our own CC0 textures and scans, and no Mapillary data. That's a later decision.
