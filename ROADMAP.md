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
| **Busselton** (Foreshore and town centre; layouts Foreshore, Town, Sights, Free Roam) | Showcase | 🔨 base accepted (jetty precinct in); 22 landmarks in as layers; all the new features merged but not yet in an accepted base or tried in game |
| **The whole map** (private: adds the estate and the Home Run) | Showcase | 🔨 base built; private landmarks described |
| **Tuart Drive, Ludlow** (16 km) | Drive-anywhere | ✅ built, waiting on a drive |
| **Caves Road, Dunsborough to Yallingup** (11 km) | Drive-anywhere, Yallingup a showcase later | 🔨 built once on the fallback heights (before the country roadsides); Caves House and the Yallingup store specced |
| **Busselton to Dunsborough** (Caves Rd, 14 km) | Drive-anywhere | 🔨 route ready (`routes/busselton-dunsborough.json`), on 5 m LiDAR |
| **Margaret River town** | Showcase | 🔨 route ready (`routes/margaret-river.json`); 4 landmarks specced (`margaret_river_looks.json`) |
| **Caves Road, Yallingup to Margaret River** | Drive-anywhere | ⬜ |
| **Boranup Drive and the karri** | Showcase | 🔨 routes ready: Caves Rd through Boranup and gravel Boranup Drive (`routes/boranup-drive.json`); gravel and 3D karri built |
| **Cape Naturaliste Road and the lighthouse** | Showcase | 🔨 route ready; lighthouse and cottages specced (the route stops about 900 m short of them) |
| **Cape Leeuwin, Augusta** | Showcase | 🔨 route ready; lighthouse, cottages and waterwheel specced |
| **Collie Motorplex** (a real circuit: 1.6 km short, 2.57 km long) | Showcase | 🔨 route ready, taken from the OSM raceway (anticlockwise); start/finish line to place |
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
  - ✅ built as layers (22): the jetty precinct, Rocky Ridge, the Esplanade Hotel, The Goose, the Old Courthouse group, the Hilton Garden Inn, the Visitor Centre, the Busselton Museum, Kyst and Sandbox, Sea Play on the Bay, Transition, the yacht club, Orana Cinemas, The Tav, the Ship Inn, the Banksia Tavern, St Mary's, the Pioneer Cemetery, the fire station, the bowling club, Victoria Square, Mitchell Park, the Japanese garden gate
  - specced but outside the built area: Churchill Park, Barnard Park
  - ⬜ to do: the Kookaburra Caravan Park; the Barrel sculpture (not found on the ground)
  - private landmarks: listed in `routes/private/landmarks/` (photos of their street faces still needed)
- 🔨 **Houses from the photo walk:** spec houses from Mac's street photos (`scripts/houses/photo_walk.py`), street by street. Waiting on the first street of photos.
- 🔨 **Detail layers in Blender** for what a spec can't say. ✅ Transition (`routes/layers/transition.kn5`, scripted in `scripts/blender/landmarks/`). 🔨 Sea Play's ship: modelled and scripted, kn5 not exported yet. Next: wire `routes/layers` into the route and drop the two spec looks; Rocky Ridge's pergola and festoon lights; lighthouses.
- 🔨 **In game:** the workstation retest (`docs/workstation-retest.md`) covers the AI on every layout, the AO bake, the 3D trees and the landmark screenshots. Mac's own checks: time of day and seasons, water, rain, night, the jetty, the map app, free roam.
- 🔨 **Town details:** ✅ kerbside parking bays and bike lanes (`kerbside`, on in the town preset; not yet on for Busselton), ✅ the AI line in the left lane (`aiKeepLeft`). ⬜ Traffic lights (Busselton has few), car parks beyond the detailed ground.
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
- 🔨 **Caves Road, Dunsborough to Yallingup:** built once on the fallback heights; rebuild with the country roadsides, then again when the LiDAR arrives. Five more South West routes are ready (see The tracks).
- ✅ **A drive-anywhere preset:** `"preset": "country"` (`scripts/headless/presets.mjs`): terrain, corridor, horizon, banking, traffic, Armco, farmland, farm roadsides, zones, keep-left. Routes can also follow OSM ways (`"ways"`) where OSRM won't drive (raceways, tracks). Still to check: 30+ km roads and draw distances.
- ✅ **Country roadsides:** guideposts, Armco on bends, embankments, bridges and culverts (`armco.ts`), farm driveways with gates, mailboxes and cattle grids (`farmRoadsides.ts`), vine rows and post-and-wire fences (`farm.ts`). All on in the country preset; none tried in game yet.
- ✅ **Unsealed roads:** OSM gravel roads get gravel physics, CSP dust and a limestone gravel texture, with no markings or kerbs; `"unsealed": true` makes a whole route gravel (Boranup Drive). Grip and dust are first guesses until driven.
- 🔨 **Landscape zones:** each with its own trees, ground and roadside. ✅ The zone system (`src/core/zones.ts`, on in the country preset): tree species and density, ground detail mix and verge colour per zone, from landcover, distance to the sea and a coarse region map. Still to do: granite boulders on the coast, sedge, jarrah/paperbark/banksia models (they borrow the nearest model until then).
  - coast: white sand, peppermint, granite
  - capes heath
  - tuart woodland
  - jarrah-marri forest
  - karri
  - vineyards and paddocks: vine rows from `landuse=vineyard`, post-and-wire fences, green in winter and gold in summer
  - Vasse-Wonnerup wetlands
- 🔨 **3D trees:** CSP instanced trees, five local species, three levels of detail. The file format is confirmed against Content Manager; in-game look being tested (`busselton_trees`). Karri and marri models ready, and bush trees picked by place (karri at Boranup, jarrah-marri inland, tuart on the plain, peppermint on the coast; `src/core/treeZones.ts`) when 3D trees are on. Next: on by default once Mac has seen them (docs/trees.md, "Making 3D trees the default"), then photo textures of real foliage.

## Phase D: More showcase areas 🔨

Each starts as a drive-anywhere base, then gets the Phase B treatment: Yallingup, Margaret River's main street, Cape Naturaliste, Boranup, Cape Leeuwin, Collie Motorplex. Landmarks for each are listed in [docs/landmarks.md](docs/landmarks.md).

## Phase E: A living world 🔨

- 🔨 **Traffic.**
  - ✅ CSP traffic-planner lanes (`data/traffic.json`) with one-way streets and limits, checked automatically.
  - ✅ Density zones (busy main roads and the town centre, quiet streets and estates) and a kids' setting per route or layout (`src/core/trafficZones.ts`, `docs/traffic-test.md`). Not yet tried in game.
  - ✅ AI Flood on Free Roam: 24 pit boxes on the AI line and town speed hints (`docs/traffic-test.md`). CSP's Traffic mode tag (`traffic-planner-ready`) on traffic builds.
  - ✅ Researched: no ready-made Aussie traffic car pack exists; single mods listed with their licence notes in `docs/traffic-cars.md`.
  - ✅ Answered: offline traffic doesn't work in CM LAN (it's an online session); AssettoServer's AI traffic would, but needs server software.
  - ⬜ Next: an in-game test with the planner, the flood and the kids' setting (`docs/workstation-retest-2.md`).
- ⬜ **The beach and the water** (Mac, 31 Oct: what makes the South West special). The bay goes from turquoise over the sand to deep blue further out, with dark patches of seagrass and reef, and the beaches are some of the whitest sand anywhere. When the sea was the aerial photo it looked real; as CSP water it's a flat, odd blue.
  - The sea's colour from the aerial: the photo's own shallows, sand bars and weed patches as the water's base colour under CSP's reflections and waves, fading to deep blue past the photo's edge.
  - White sand: the beaches from the photo, brightened, with a fine sand detail texture; wet sand and a foam line at the water's edge.
  - The same look in the Blender renders, so previews match the game.
- 🔨 **Atmosphere (CSP and Pure).**
  - ✅ The sun's real position, dry-season grass, bounced light, the bay as CSP water, wind, the tiling fix, Pure settings.
  - ✅ Night lighting.
  - ✅ AO baking (first bakes take under a minute on the 4060).
  - ✅ Built, not yet tried in game:
    - RainFX puddles: the road's real hollows, and the puddle map from ground and roads only (`rainHollows`)
    - track sounds: surf, magpies and kookaburras from a track script playing .ogg files (`trackSounds`; the files themselves still to source, CC0)
    - waving flags and the jetty train on its timetable (`wavingFlags`, `jettyTrain`)
    - per-track Pure haze for clear WA air, and calmer photo ground on bright sand (`pureTuning`, on by default: compare before keeping)

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
- ✅ Night, several-AI-car and rain runs in the automatic test (`run-test.ps1 -Night`, `-Cars N`, `-Rain`). Next: the workstation runs `docs/workstation-retest-2.md`.
- 🔨 One-click install on the rig: "Install Busselton.cmd" in the share installs every new build and polish, keeps AO bakes, installs the apps and shows what changed; optional check on log-in ([docs/rig-install.md](docs/rig-install.md)). To try on the rig.

## Phase G: Fun 🔨

- 🔨 **Checkpoint challenges:** Busselton Challenges app, checkpoints against the clock, hand-picked sets per track or layout (`challenges` in the route). To check in game.
- ✅ The Sights layout: a cruise past the town landmarks.
- 🔨 **Time trials and drift spots** in the Challenges app: A to B with splits on any point-to-point route or layout, drift spots in empty car parks with an angle-and-speed score, best times per driver, shared over LAN through CSP online events (AC's own server, which CM's LAN races use). To check in game, then routes between towns.
- ✅ Cruise mode in the Challenges app: the street you're on, the limit, the next sight and a sights-seen list (`extension/cruise.ini`, `data/cruise.ini`). To check in game.

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

## Owning the code (31 Oct 2026)

Goal: every line generated by us. Pace: the share of upstream-derived code drops at least 5 points a week, without rushing the rest of the roadmap. Measured as lines in files on `UPSTREAM-FILES.txt` over all code lines (src, test, scripts, index.html): about 21% on 31 Oct (12,900 of 61,900), after the first 13 modules were rewritten; 15.1% (9,600 of 63,800) the same day once the week-1 rewrites merged.

How: a behaviour spec in `docs/specs/` first, then a fresh module from the spec by a separate session without the old file open, with fresh tests and golden fixtures where output must stay byte for byte. Fix the bugs the spec finds. Delete anything we don't actually use instead of rewriting it (Mac, 31 Oct): the browser UI goes, leaving the smallest headless page the builds need; unused options, features and exports go too. Rerun `scripts/provenance/upstream_overlap.py --write` after each merge. Also worth doing: ask honestjams for a licence (one message; a yes takes everything off the list at once).

| Week ending | Target | What comes off the list |
| --- | --- | --- |
| Sat 7 Nov | 16% | In flight now: markings, paint lines, kerbs; clearance, extend, trace, spurs; mesh, materials, photo surface, fences (about 3,100 lines) |
| Sat 14 Nov | 11% | The road core takes over: road, roundabout, side streets, road mesh, network/geom, AI line, options; imagery art, raster, Mapillary |
| Sat 21 Nov | 6% | Services: tiles, OSM, vector tiles, pipeline; the UI deleted (main, session, style), leaving a minimal headless page and the preview renderer |
| Sat 28 Nov | 1% | track.ts (split into stages as it's rewritten) and its tests (race dressing already deleted, 31 Oct) |
| Sat 5 Dec | 0% | Leftovers: config files, small tests; settle the provenance rule for lines a spec forces (API signatures, ini text AC needs) |

Each week: lead merges the week's rewrites only after a full Busselton build passes every check (and a country route for anything touching ground or roads), then reruns provenance and updates this table.

## Upstream

[honestjams/ac-track-builder](https://github.com/honestjams/ac-track-builder) is a source of ideas, not a partner: its owner has moved on (docs/external-review-2026-10-31.md). We look at its commits now and then and write anything we take fresh. Mac's merged PRs there are his own work; small general fixes can still go up when he wants.

## Data and sharing

- **Landgate and Esri imagery:** personal, non-commercial use only. **Mapillary:** CC BY-SA. **OpenStreetMap:** ODbL. **GA DEM:** CC BY 4.0. **ambientCG textures:** CC0.
- Builds and snapshots stay private (snapshots live in the share). A public South West release would need imagery off, our own CC0 textures and scans, and no Mapillary data. That's a later decision.
