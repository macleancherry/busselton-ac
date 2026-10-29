# Busselton AC roadmap

**Goal:** Busselton and then the wider South West, from the Busselton Jetty to Cape Leeuwin, as Assetto Corsa tracks you can just drive around in. Real roads, real heights, the trees and buildings locals would recognise, traffic, day and night, summer and winter. Built from free data and free tools, for personal use.

This is the plan for this fork. (`docs/roadmap.md` is upstream's own roadmap for the general track builder, kept as-is so merges stay clean.) The generator itself is [honestjams/ac-track-builder](https://github.com/honestjams/ac-track-builder); anything that's useful beyond the South West goes back upstream (see [Working with upstream](#working-with-upstream)).

Status key: ✅ done · 🔨 in progress · ⬜ planned · ❓ needs checking first

---

## Where we are (v0.7, 29 October 2026)

Five tracks build from route files with one command, then pass automatic checks:

- **Busselton Foreshore**: a 4.3 km circuit along Geographe Bay Rd, Queen St and Marine Tce.
- **Busselton town centre**: a 2.2 km loop down Queen St, along Albert St and back by Marine Tce, with shopfronts and traffic.
- **Tuart Drive, Ludlow**: 16.6 km point to point through Tuart Forest, from Wonnerup to Ludlow.
- **A 3.6 km point-to-point sprint** through the western suburbs, and **a whole-estate build** where every street inside the estate is drivable (both route files private).

What a build has today:

- ✅ Landgate aerial imagery and Geoscience Australia's 5 m LiDAR heights for Busselton, Vasse and Broadwater
- ✅ Smooth town roads: no banking, kerbs at the right height, flat roundabouts
- ✅ Close-up ground detail (`ksMultilayer`, upstream's grass, dirt and paving), with Grass FX tuned for straw-coloured verges
- ✅ Local trees: she-oak, Norfolk pine, peppermint and tuart
- ✅ The red shared path and footpaths
- ✅ Upstream's building types (about 60 wall finishes, 20 roofs, shops, flats, sheds), plus Colorbond fences, front walls, hedges and garden beds
- ✅ Street lights with CSP night lighting
- ✅ The bay as water, and the 1.8 km jetty
- ✅ Horizon tree lines
- ✅ Headless builds, checks (photo overlay, DEM heights, bumps, edge steps) and driver's-eye renders
- ✅ Upstream's houses (doors, garages, driveways), power poles, wires, photo footpaths, culling and replay cameras, merged in
- ✅ Real power poles, street lights and signs from Mapillary detections
- ✅ A rock seawall and groynes, Norfolk pines and palms along the foreshore
- ✅ CSP traffic lanes (`data/traffic.json`), checked automatically; not yet driven with in game
- ✅ An unattended AI test run on the workstation, with a drive log, replay and report
- ✅ Shopfronts: verandahs on posts, fascia signs and shop windows where the photo and map show shops
- ✅ Forest: grey-olive tuart and eucalypt canopy read from the photo as trees (Tuart Drive went from 1,700 to about 8,000)
- ✅ A performance budget check on every build, and checks that work on long tracks
- ✅ Parked cars back where the photo had them, real shop names on the verandah signs
- ✅ Builds that retry map data and stop if any is still missing, so they come out the same every time
- ✅ House looks: wall kind and colour from street photos or set by hand, front hedges and trees, and an area's own mix of facades
- ✅ The AI slowed to the speed limit (50 in town) and for tight corners, tested in an everyday car
- ✅ Roundabout islands painted with their own aerial photo (mulch, plantings, paving or lawn), with a tree and shrubs on the bigger ones

---

## What the best AC maps get right

What makes the most-loved community maps feel alive, and what we take from each:

| Map | What it does well | What we take |
| --- | --- | --- |
| **Shutoko Revival Project** | Huge, accurate road network, dense traffic (through AssettoServer), superb night lighting, a living community | Open-world layout, traffic as a first-class feature, night as good as day |
| **Arrabassada** (Barcelona) | Urban highway into mountain road, working traffic lights, viewpoints and parking areas, night mode | Traffic lights, places to stop, a mix of town and country in one drive |
| **Slea Head Drive** (Ireland) | 48 trackside cameras, AI, rain effects, detailed buildings | Replay cameras, RainFX, care on buildings |
| **Wicklow Mountains** | ~47 km open world, two layouts with AI | Several layouts from one map, open world plus routes |
| **Mulholland Drive** | Racing version and free-roam version with two-way traffic | One race layout and one cruise layout per area |
| **Santa Monica Mountains** | Photogrammetry scenery | Our own photo scans for landmarks |
| **Street2Sim** | Pins to track, camber from DEM, automatic checks, optional `.blend` export, area builds for car parks and intersections, a library of built roads | `.blend`/FBX export for hand detail, area builds, a track index |

Sources: [OverTake: six real-road maps for free roaming](https://racedepartment.com/news/comments/76810/), [Street2Sim](https://www.street2sim.com/) and [our notes on how it works](docs/how-street2sim-works.md).

---

## Who builds what: us and upstream

Upstream ([honestjams/ac-track-builder](https://github.com/honestjams/ac-track-builder)) is a general tool: any real road, anywhere, as a time-trial track, built in the browser. It moves fast (about 50 commits in four days in late October), almost all on looks and scenery: houses and building types, ground and road detail shaders, CSP lighting, race-day dressing. Its research is deep where it works ([docs/realism.md](docs/realism.md) reads the CSP shaders from source) and its in-game checklist is thorough ([docs/verification.md](docs/verification.md)). Its own plan ([docs/roadmap.md](docs/roadmap.md)): time trials tested in game, CSP 3D trees, a pit lane, front fences, balconies, shareable builds with open imagery.

So we split the work:

- **Upstream's:** general looks and scenery (buildings, materials, shaders, ground and road detail, lighting quality, race dressing, general road furniture). We take these in by merging and don't build our own. If we need one before they get to it, we build it as a PR for them.
- **Ours:** what a general road tool won't do. One Busselton map with layouts, open world and spawn points; traffic; the AI driving like a local; headless builds, automatic checks and the workstation test; our own data (WA heights, Mapillary footage, house looks, local trees, the coast); the South West tracks; fun modes for the kids.
- **Before starting anything general,** check upstream's roadmap and recent commits (`git log main..upstream/main`). If it's on their list, wait for it or send it to them.

## Phase 1: Foundations 🔨

Get the base right before adding more.

- ✅ **Merge upstream.** honestjams' houses, poles and wires, photo-read footpaths and driveways, culling and draw distances, road-edge ramp, U-turn spur removal, replay cameras, CSP realism and detail shaders. Checked again after every tranche of work.
- 🔨 **The AI driving off the road.** The main cause was found and fixed on 28 Oct: spawn points faced backwards, so the AI's first move was a U-turn. Since then:
  - corner hints (`ai_hints.ini`) for tight corners, and the AI kept a metre off the kerbs
  - a smoothed line through roundabouts
  - (29 Oct) hints slowing it to the speed limit (50 in town), roundabouts found where the route goes straight over them, and the workstation test now driving an everyday hatch instead of a GT3 (which hit 174 km/h on a suburban street)

  The AI now gets 2.4 km round the Foreshore (past the 2.1 km corner and the first roundabout), then beaches on the nature strip at the exit of the second roundabout. A GT3 car on kerbed town streets will keep finding kerbs, so this is about good enough: traffic is what fills the streets.
  - ❓ The AI line is written without its lookup grid (`hasGrid = 0`, a "known unknown" in upstream's checklist), and every test log warns `IDEAL LINE FROM AI LINE` / `NO POSITION DATA FOUND`. Check whether they're linked, and write the grid if so. The grid's layout is known (from Content Manager's reader: extremes, neighbours considered, sampling density, then cells of point indices); its values aren't. Next: the workstation runs `scripts/check/ai_grid.py` on a few Kunos tracks' `fast_lane.ai` and checks whether their logs show the same warning.
- 🔨 **In-game check.** Done: roundabout lip (fixed), power poles, night lighting. Still to check: ground detail scale, Grass FX on dry verges, the water edge, frame rate on the RTX 4060.
  - ⬜ A full pass of upstream's 36-item checklist ([docs/verification.md](docs/verification.md)) on one town build, by the workstation: map position, signs and markings the right way round, kerbs, Grass FX, rain, night windows, replay cameras. Our automatic test only covers the driving.
- ✅ **Terrain level of detail.** Fine grid near the road, flat blocks drawn as fans further out: the Foreshore went from 1.0M to 0.75M triangles.
- ✅ **Performance budget per track.** `scripts/check/budget.ts`: triangles, draw calls, texture memory and kn5 size per build, checked against limits, with the biggest groups listed.
- ✅ **Layouts** (29 Oct). One track folder with several layouts (circuit, town loop, free roam) on one shared world, the way Kunos and the big mods do it. First use: the single Busselton map. [docs/one-map.md](docs/one-map.md)
- 🔨 **Blender trial** (29 Oct): `scripts/blender/house.py` builds and renders a house from a spec (sizes, cladding, roof, garage, windows, hedge, trees, street) with Cycles on the workstation's GPU, and can export it as glTF for AC later.
- 🔨 **Spec houses** (29 Oct): a house we know is built from its spec (the Blender script's parts mode: blocks with hip or gable roofs, gable ends, verandahs, doors, windows, fences, hedges, trees) with the game's own wall and roof textures, in place of the generated one (`specFile` in a house look). First one in: a private house in the estate build. Photo walk pipeline ready (`scripts/houses/photo_walk.py`: match photos to houses, draft specs from each house's outline and roof, renders, a review page, the looks file). Next: Mac's first street of photos.
- ✅ **Kept layers** (29 Oct): hand-made `.kn5` models in a layers folder load over the generated track (models.ini) and clear the generated houses and trees they stand on; every route has a fixed map origin so they stay lined up when a route changes.
- ✅ **Blender both ways** (29 Oct): the generated track around a spot exported as glTF with its textures (`scripts/blender/export_base.ts`), opened in Blender as a locked reference (`new_layer.py`), and what's modelled against it exported (`export_layer.py`) and turned into a layer kn5 with our own converter (`make_layer.ts`), no ksEditor. All in the track's own coordinates.

## Phase 2: Busselton, properly 🔨

Make town feel like town before going regional.

- 🔨 **Foreshore showcase:**
  - car park islands with kerbs, line marking and arrows as real 3D
  - ✅ cars painted out of the ground photo, including dark cars and cars between bay lines (only near streets and car-park aisles, so forest shadows are left alone)
  - ✅ the rock seawall (limestone revetment along the back of the beach) and rock groynes
  - ✅ Norfolk pines along the foreshore, with palms mixed in (the photo can't tell a palm from other trees)
  - garden beds along the path
  - jetty precinct buildings: waiting on Mac's Mapillary footage for their fronts
- ⬜ **Jetty precinct:** the Interpretive Centre, the jetty train line, the Underwater Observatory at the far end, and jetty lights at night.
- 🔨 **Queen St and the town centre:** ✅ its own route, ✅ shopfronts with verandahs, posts, signs and windows, ✅ real shop names on the signs, ✅ parked cars where the photo had them. Still to do: kerbside parking bays marked out.
- 🔨 **WA road details:**
  - ✅ give-way lines at roundabouts; stop and give-way lines where street photos saw them (side streets show their own lines in the aerial photo)
  - bike lanes and bicycle symbols
  - ✅ bus stops: a post and plate, and a shelter where there's room (from the map's bus stops)
  - ✅ Australian guideposts: white, a red reflector facing traffic on your side and a white one facing the other way
  - ✅ street name blades, white on blue
  - ✅ kangaroo signs on country stretches: one each way about 300 m in, then every 4 km
- 🔨 **Parked cars:** ✅ low-poly cars put back where the photo had parked cars (same spot, angle and roughly the colour), with collision boxes and none in a traffic lane. Still to do: better car models (CSP or our own, with LODs), and car parks beyond the detailed ground.
- 🔨 **Roundabout landscaping:** ✅ each island shows its real aerial photo (when it sits inside one photo tile), plus a tree and a ring of shrubs. Still to do: 3D garden beds and limestone edging from the photo.
- ⬜ **Landmarks list:** the buildings and spots locals would point at, each modelled by hand or from photos.

## Phase 3: Open world ⬜

Go from "a route" to "a town you can drive anywhere in".

- 🔨 **One Busselton map.** `routes/busselton.json`: the Foreshore and the town centre as one area with every street and roundabout drivable, and three layouts (the Foreshore circuit, the town loop, free roam from the car parks), about 1.28M triangles. A private whole map adds the estate, joined by the Home Run: five layouts, 1.31M triangles after a thinning pass. Every check passes on both. Next: test them in game. Tuart Drive stays its own track; it goes in a South West map later. [docs/one-map.md](docs/one-map.md)

- ✅ **Area builds** (29 Oct): `build.area`, a polygon whose every street is built and drivable, streets from OSM's own geometry. Still to do: tracing those streets from the photo.
- ✅ **Spawn points around town** (30 Oct): free roam starts in the ten biggest car parks.
- ⬜ **Traffic lights** where OSM maps them, with working phases (CSP).
- ⬜ **Points of interest:** viewpoints and places to stop, as in Arrabassada.
- ✅ **A town map app** (30 Oct): Busselton Map (`apps/lua/BusseltonMap`), every street with you and the other cars on it. To check in game.

## Phase 4: Traffic ⬜

The big one for making it feel real, and a gap in almost every generated track.

There are two ways AC does traffic. We should generate both from the same road graph:

1. **Offline, single player: the CSP traffic planner.** CSP ships a traffic tool (by x4fab, CC0) that reads `data/traffic.json`: lanes as point lists, intersections with allowed turns, and areas. It runs thousands of cars cheaply. The track needs custom physics enabled in `surfaces.ini` (`[_SCRIPTING_PHYSICS] ALLOW_TOOLS=1`). [Source](https://github.com/ac-custom-shaders-patch/acc-lua-internal/tree/main/included-tools/traffic).
2. **AI splines** (`fast_lane.ai` per lane) for CSP's AI Flood in Track Day mode, and for AssettoServer if we ever host. [AssettoServer AI traffic](https://space-node.net/blog/assettoserver-ai-traffic-freeroam-setup-2026).

Plan:

- 🔨 **Generate `traffic.json`.** Done: lanes on the left (two each way on wide roads), intersections at every junction, roundabouts as a clockwise ring with priority, speeds from road class and town, and a check that fails on overlapping junctions or loose lane ends. Still to do:
  - ✅ speeds from OSM `maxspeed` (shared with the AI hints)
  - ✅ (29 Oct) no overlaps or loose lane ends on the whole-estate build: junction zones near a roundabout no longer spread down side streets
  - an in-game test with the planner (steps in [docs/traffic-test.md](docs/traffic-test.md))
  - ✅ one-way streets (from the map tiles): lanes all one way, across the whole road
  - lanes from OSM `lanes`
- ⬜ **Generate per-lane AI splines**, both directions, for AI Flood.
- ⬜ **Traffic density zones:** busy Bussell Hwy and Queen St, quiet estates, school-zone speeds.
- ⬜ **An Aussie traffic car pack:**
  - Hilux, Ranger, Corolla, i30, Camry, Commodore, Falcon, Prado, RAV4
  - utes with trailers, cars towing caravans and boats (very South West)
  - LOD models, set up for the traffic tool
- ⬜ **Kid-friendly settings:** slower, calmer traffic.
- ❓ **LAN with traffic:** check whether CSP offline traffic works in Content Manager LAN sessions, or whether that needs AssettoServer.

## Phase 5: Atmosphere (CSP and Pure) ⬜

What makes a map look great at any time of day and in any weather.

- ⬜ **Seasons:** WA verges and paddocks are green in winter and straw from December to April. Use CSP's seasonal adjustments and our ground mask to switch between them. This is a real South West signature.
- ⬜ **RainFX:**
  - wet roads, with puddles in low spots found from the DEM
  - wet kerbs and gutters
- ✅ **Night:**
  - ✅ house windows lit at random
  - ✅ light pollution over town
  - ✅ distant emissives on the street lights
  - ✅ shop signs lit and shop windows glowing (the fork's named fascias)
  - ✅ car park lights: a tall double-headed pole every 35 m along each car park aisle, lit at night
  - ✅ the jetty lights: lamp posts every 45 m down both sides of the jetty, following its bend
- ⬜ **Water:** CSP's water shader for the bay, waves at the beach, boats at moorings.
- ⬜ **Audio:** surf at the beach, magpies and kookaburras in the morning, wind in the she-oaks, the jetty train (CSP track audio).
- ⬜ **Baked ambient occlusion.** CSP's AO bakery ([acc-bakeryoptix](https://github.com/ac-custom-shaders-patch/acc-bakeryoptix)) bakes it on the player's PC; upstream's research says CSP expects tracks to have it and nothing does more for how solid a scene looks. A workstation job, run from a script in the repo after each install.
- Lighting quality otherwise (local cubemaps, fog, detail normal maps): upstream's area, taken in by merging.
- ⬜ **Pure:** tune Pure's lighting per track so the bright WA sun and glare off the bay look right.
- ⬜ **Animated objects:** flags, swaying trees, the jetty train.

CSP track config reference: [acc-extension-config wiki](https://github.com/ac-custom-shaders-patch/acc-extension-config/wiki/Tracks-%E2%80%93-Miscellaneous-options).

## Phase 6: The South West ⬜

From the bay to the capes. AC can't stream a whole region, so this is a set of tracks plus one long drive, each a few tens of km at most.

### Drives and tracks

| Track | Why | Character |
| --- | --- | --- |
| **Caves Road: Busselton to Yallingup** | The start of [Tourist Drive 250](https://en.wikipedia.org/wiki/Caves_Road_(Western_Australia)), through Dunsborough | Coastal peppermint woodland, then climbing onto the Leeuwin-Naturaliste ridge |
| **Caves Road: Yallingup to Margaret River** | Wine country, surf breaks | Narrow and winding, vineyards, cellar doors |
| **Caves Road and Boranup Drive** | The [only karri forest between the capes](https://australiassouthwest.com/listings/boranup-forest/). Boranup Drive is limestone gravel | Tall karri regrowth, dappled light, a gravel loop |
| **Margaret River town** | The main street and surrounds | Town centre, roundabouts |
| **Cape Naturaliste Rd** | To the lighthouse, near Sugarloaf Rock and Meelup | Coastal heath, granite, ocean views |
| **Cape Leeuwin, Augusta** | The far end of Caves Road (111 km), the lighthouse | Exposed coastal heath |
| 🔨 **Tuart Drive, Ludlow** (built, waiting on a drive) | ~15 km through the [largest pure tuart forest in the world](https://en.wikipedia.org/wiki/Tuart_Forest_National_Park), the old Bussell Hwy | Huge pale tuarts, quiet two-lane road |
| **Bussell Highway** | The fast way between towns | Dual carriageway, 110 km/h, overtaking lanes |
| **Collie Motorplex** | A real [1.6 km circuit](https://www.westernaustralia.com/au/attraction/collie-motorplex/5bdbda6151e41a8860149e69) in the South West | A proper race track, from LiDAR |
| ❓ **Forest Rally Busselton stage** | The gravel stage the [Forest Rally](https://bdtimes.com.au/news/busselton-dunsborough-times/entries-sought-for-west-cape-classic-ng-b88750922z) runs, also used by the West Cape Classic | Gravel, forest |
| ❓ **Backroads** | Wildwood Rd, Tom Cullity Dr, Rosa Brook Rd and others: drive them, then pick the best | Rolling farmland and forest |

### Landscape zones

Each needs its own trees, ground and roadside:

- **Coast:** white sand, dunes, peppermint and she-oak, limestone, granite at Canal Rocks and Sugarloaf.
- **Capes heath:** low windswept scrub on limestone, ocean views.
- **Tuart woodland:** Ludlow, around Busselton.
- **Jarrah-marri forest:** the ridge and inland.
- **Karri forest:** Boranup and the south. Very tall straight trunks; needs proper 3D trees, not sprites.
- **Vineyards and paddocks:**
  - vine rows laid out along `landuse=vineyard` and the row direction in the photo
  - post-and-wire fences, farm gates, cattle grids
  - green in winter, gold in summer
- **Wetlands:** Vasse-Wonnerup, with black swans.

### What the generator needs for this

- 🔨 More DEM: ✅ the 5 m tiles now reach Ludlow and Tuart Forest; still to go: the capes and Collie. ❓ Check whether Landgate or GA have 1 m LiDAR here.
- ⬜ Unsealed roads: gravel surface physics, dust, a limestone gravel texture.
- ⬜ Country roadsides:
  - gravel shoulders and white guideposts
  - Armco on bends and drop-offs
  - farm driveways and mailboxes on posts
- 🔨 Long roads: ✅ 16 km builds within budget (coarser terrain grid and horizon per route); still to check: 30+ km, draw distances.
- ⬜ Proper trees: CSP's 3D trees (instanced, with LODs; next on upstream's list). Ours to add: tuart, karri, peppermint and she-oak models and where each grows.
- ⬜ Vineyard generator.
- ⬜ Landmarks: lighthouses, wineries and cellar doors, surf car parks (Yallingup, Surfers Point), the caves' entrances.

## Phase 7: Our own capture ⬜

Real photos beat procedural textures. Everything we capture ourselves can also go into a public version.

- 🔨 **Mapillary walks and drives** through key areas, for real signs, poles and street detail ([capture kit](scripts/capture/README.md)). Mac's first uploads (28 Oct) are processing. Ready for them:
  - ✅ a coverage check (`scripts/mapillary/coverage.py`)
  - ✅ house matching, which sets each house's walls from the photos (`scripts/mapillary/house_looks.py`)
- ⬜ **Texture photos:** brick, render, limestone, peppermint and karri bark, local roof colours, made into seamless CC0 textures.
- ⬜ **Photogrammetry** of landmarks: the jetty buildings, the foreshore, lighthouses. ❓ Check the CASA drone rules near Busselton airport first.
- ⬜ **Reference sets:** Street View and real estate photos as reference only, never copied into the track.

## Phase 8: Tooling and quality ⬜

- ✅ Build checks: photo overlay, DEM heights, hairpin spikes, surface bumps and edge steps.
- ✅ Driver's-eye renders from the headless build.
- 🔨 **Before/after render sets,** to catch visual regressions: ✅ `scripts/check/render_diff.py` compares a build's shots with the last saved set and makes a before/after/changed sheet. ✅ `SHOTS=auto` renders the same views on every build (five along the drive, each roundabout from above). ✅ Builds come out the same each time near the road: map tiles and Mapillary detections were joined in arrival order, which changed houses' facades and trees' species between rebuilds.
- ✅ **CI on GitHub:** tests, type-check and build on every push.
- 🔨 **Automated in-game test** (`scripts/windows/run-test.ps1`, run on the workstation):
  - ✅ it loads, presses Drive, hands the car to the AI, logs the drive, saves the replay and closes AC
  - ✅ a report here of where the AI left the road (`scripts/check/autotest_report.py`)
  - 🔨 screenshots: CSP's screenshot call doesn't work from a track script, so the test runner now presses F8 for each one (first run pending)
  - ✅ frame rate logged every 5 s and for the whole drive, with the slowest spot in the report
  - ⬜ a night run (needs a time-of-day setting that works with CSP)
  - ⬜ several AI cars at once (what LAN racing will look like)
  - ⬜ a traffic planner run (the manual steps in docs/traffic-test.md first)
- ⬜ **One-click install:** a Content Manager install link for the LAN rig.

## Phase 9: Fun stuff 🔨

- 🔨 **Checkpoint challenges** (CSP Lua): find the jetty, the lighthouse, the big tuart. Good for the kids. ✅ First version: every build ships up to six checkpoints (named places by the road, or streets), and the Busselton Challenges app (`apps/lua/BusseltonChallenges`, installed with each track) shows the next one, warmer or colder, a beacon over it, the clock and your best time. Still to check in game, then: hand-picked checkpoints per track.
- ⬜ **Point-to-point time trials** between towns, with leaderboards on the LAN.
- ⬜ **Cruise mode:** traffic on, no timing, start anywhere.
- ⬜ **Drift spots:** empty car parks and industrial areas as area builds (Street2Sim's drift lots idea).

---

## Working with upstream

[honestjams/ac-track-builder](https://github.com/honestjams/ac-track-builder) is the generator. We send back anything that isn't South West specific, and take its improvements in. Sent so far: kerb and roundabout fixes, the U-turn warning, `terrainUnderRoad` and no-trace zones, and Landgate imagery (all merged). Open (28 Oct): #6 spawn direction, roundabout mouths and AI corner hints; #7 terrain level of detail; #8 CSP traffic lanes; #9 the coast (sea, jetties, seawall, groynes).

Open (29 Oct): #10 retrying map data, and saying when it's missing.

Candidates to send next:

- dry-grass Grass FX tuning
- house lots
- the AI line through roundabouts
- headless builds, the check scripts and the automatic AI test (his repo has no headless tooling yet)
- Australian guideposts and kangaroo signs, one-way streets in the traffic lanes, roundabout islands from the photo

## Data and sharing

- **Landgate and Esri imagery:** personal, non-commercial use only. **Mapillary:** CC BY-SA. **OpenStreetMap:** ODbL. **GA DEM:** CC BY 4.0. **ambientCG textures:** CC0.
- Builds stay private. A public South West release would need imagery off, our own CC0 textures and scans, and no Mapillary data. That's a later decision.
