# Busselton AC

Busselton and Vasse in Assetto Corsa, built from real data. Real road lines, real heights from LiDAR, Landgate aerial photos, Australian road surfaces and markings.

This is a fork of [honestjams/ac-track-builder](https://github.com/honestjams/ac-track-builder), which turns any real road into an AC track in the browser. This fork adds WA data and the bits needed to build Busselton tracks without clicking through the UI.

## Tracks

| Track | Layout | Length | Route |
| --- | --- | --- | --- |
| Busselton Foreshore | Circuit | 4.3 km | King St, Geographe Bay Rd, West St, Adelaide St, Queen St, Albert St, Bussell Hwy |
| Busselton town centre | Circuit | 2.2 km | Queen St, Albert St, Brown St, Marine Tce |
| Tuart Drive | A to B | 16.6 km | Wonnerup to Ludlow through Tuart Forest |
| Two private routes | | | A suburban sprint and a whole-estate build (route files kept private) |

v0.7: driven in game, tested by an AI driver on the workstation. To install, drag the zip onto Content Manager, or unzip it into `assettocorsa/content/tracks/`.

## What this fork adds

On top of upstream's builder (roads, roundabouts, building types, ground detail, signs, race-day dressing):

- **WA data.** Landgate's free Locate mosaic for imagery anywhere in WA, and Geoscience Australia's 5 m bare-earth DEM from Busselton to Ludlow, shipped in `public/dem/wa`.
- **Headless builds.** `scripts/headless/build-track.mjs` builds a track from a route file in headless Chromium: the same code as the UI, no clicking. It retries map data and stops if any is still missing ("MISSING DATA"), so a build never comes out quietly different.
- **Checks on every build.** Road over the aerial photo and heights against the DEM (`check_build.py`), bumps, tilt and edge steps (`surface_check.py`), traffic lanes (`traffic_check.py`, including no parked car in a lane) and a performance budget for the RTX 4060 (`budget.ts`). The checks work on long tracks (16 km and up).
- **Renders.** `SHOTS=0.1,0.5` (lap fractions, `lng:lat:lookLng:lookLat:height`, or `car0`..`car9` to look at parked cars) saves views from the preview.
- **Smooth town roads.** No banking, kerbs at the right height, flat roundabouts, and options for flat ground (`terrainUnderRoad`, a finer `terrainStep`). Roundabouts the route goes straight over are found from the mapped rings, not just the routing.
- **AI that drives like a local.** Spawn points facing the right way, a smoothed line through roundabouts, and `ai_hints.ini` slowing the AI for tight corners and to the speed limit (50 in town).
- **Automatic AI tests.** `scripts/windows/run-test.ps1` drives a build unattended on the workstation in an everyday car and collects logs, replay and a drive log; `autotest_report.py` reads the result.
- **CSP traffic.** `data/traffic.json` for CSP's traffic planner: lanes on the route and side streets, roundabouts with priority, speeds by road type.
- **Local trees.** Peppermint, she-oak, Norfolk pine, tuart and palm, drawn procedurally; grey-olive gum canopy read from the photo as trees, so Tuart Forest is a forest.
- **The coast.** The bay as water, the 1.8 km jetty, the rock seawall and groynes, Norfolk pines and palms along the foreshore.
- **Car parks.** Parked cars painted out of the ground photo, then put back as simple 3D cars in the same spots and roughly the same colour, with something to hit.
- **Shopfronts.** Verandahs on posts, shop windows and fascia signs carrying the real shop names (OSM), on Queen St and other main streets.
- **Lots.** Colorbond fences, limestone or brick front walls or a hedge, driveways and garden beds.
- **House looks.** What particular houses look like, from Mapillary street photos (`scripts/mapillary/house_looks.py`, wall kind and colour) or set by hand (facade, front hedge and its height, front-yard trees), plus an area's own mix of facades (`houseStyle`), on upstream's building styles.
- **Whole-area builds.** A loop round an estate with a wide corridor builds every street inside it as drivable road.
- **Paths, street lights, power poles and signs** from OpenStreetMap and Mapillary detections, with CSP night lighting.
- **Private routes.** Anything in `routes/private/` stays out of git.

## Sent upstream

The generic fixes went back to honestjams/ac-track-builder as [pull requests](https://github.com/honestjams/ac-track-builder/pulls?q=is%3Apr+author%3Amacleancherry):

| Pull request | Branch |
| --- | --- |
| Fix the step behind kerbs and the dip at roundabout entries | `fix-kerb-terrain-and-roundabout-dips` |
| Warn when the route turns back on itself | `route-uturn-warning` |
| Add terrainUnderRoad and noTrace build options | `terrain-under-road-and-no-trace` |
| Add Landgate's Locate mosaic as WA aerial imagery | `wa-landgate-imagery` |
| #6 Spawn direction, roundabout lip, empty verges, AI hints | `upstream-fixes` |
| #7 Terrain level of detail | `terrain-lod` |
| #8 CSP traffic lanes | `csp-traffic` |
| #9 The coast: seawall, groynes, beaches | `coast` |
| #10 Retry map tiles and Overpass; say when data is missing | `upstream-retry` |

Keep these branches until the pull requests are merged or closed. Busselton-only work (DEM tiles, routes, headless scripts, CSP config) stays in this fork.

## Building a track

Run these once:

```
npm install
npx playwright install chromium
pip install numpy pillow
```

Then build and check a track:

```
node scripts/headless/build-track.mjs routes/foreshore.json
python3 -I scripts/check/check_build.py out/busselton_foreshore.centreline.json
```

Builds land in `out/`: the zip, a stats file, and an overlay image of the road on the photo.

If you're on a network that strips CORS headers from the routing and map APIs, run the build with `CORS_SHIM=1`.

You can still use the browser version: `npm run dev`, then open http://localhost:5173.

### Route files

Put routes you don't want public (anything starting at home) in `routes/private/`. That folder is ignored by git.


```json
{
  "name": "Busselton Foreshore",
  "loop": true,
  "pins": [[115.33054, -33.65499], [115.33056, -33.65034]],
  "options": { "imagery": "high" }
}
```

- **pins** are `[lng, lat]`. The route follows the real road network between them.
- **loop** closes the route back to the first pin.
- **options** take any setting from the UI by its element id (`imagery`, `trees`, `buildings`, and so on).
- **build** takes build settings the UI doesn't have, such as `noTrace` zones (`{ "at": [lng, lat], "radius": metres }`) where the road keeps the OSM line instead of the photo trace. Use these on wide main streets where the trace locks onto parking bays.

If a pin snaps onto a car park or side street, nudge it onto the road you want.

## Rebuilding the DEM tiles

Only needed to cover more area:

1. Download `waz50.zip` (2.4 GB) from [data.gov.au](https://data.gov.au/data/dataset/digital-elevation-model-dem-of-australia-derived-from-lidar-5-metre-grid).
2. Run:

    ```
    pip install rasterio numpy pillow
    python3 -I scripts/dem/make_wa_tiles.py waz50.zip --box 115.2 -33.74 115.48 -33.58
    ```

If you change the box, update `STATE_DEMS.wa.box` in `src/services/tiles.ts` to match.

## Data and what you can share

| Data | Source | Terms |
| --- | --- | --- |
| Heights | Geoscience Australia 5 m DEM | CC BY 4.0 |
| Aerial photos | Landgate Locate mosaic | Personal, non-commercial use only |
| Aerial photos (fallback) | Esri World Imagery | Personal use |
| Roads, buildings, names | OpenStreetMap, via OpenFreeMap | ODbL |
| Signs and poles (optional) | Mapillary | CC BY-SA, don't publish tracks with it |
| Ground detail textures | ambientCG | CC0 |

Fine for racing with your mates. Don't publish or sell tracks built with the aerial photos or Mapillary data. For a version you could share publicly, set imagery to Off and leave Mapillary out.

## Plan

The full roadmap is in [ROADMAP.md](ROADMAP.md): Busselton done properly, then open-world town, traffic, CSP and Pure atmosphere (seasons, rain, night), and the wider South West from the capes to Collie. Next up:

1. The rest of the estate from a walk-through: real wall colours for every house.
2. Traffic driven in game, and per-lane AI splines for AI Flood.
3. The jetty precinct, and real shop and car park detail on Queen St.
4. Caves Road: Busselton to Yallingup.

## Credit

The track builder is [honestjams/ac-track-builder](https://github.com/honestjams/ac-track-builder). Its [README](https://github.com/honestjams/ac-track-builder#readme) covers everything the builder does and how it works. The upstream repo has no licence file yet, so this fork is for personal use.

Assetto Corsa is a trademark of Kunos Simulazioni. This project is not affiliated with or endorsed by Kunos.
