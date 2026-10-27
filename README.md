# Busselton AC

Busselton and Vasse in Assetto Corsa, built from real data. Real road lines, real heights from LiDAR, Landgate aerial photos, Australian road surfaces and markings.

This is a fork of [honestjams/ac-track-builder](https://github.com/honestjams/ac-track-builder), which turns any real road into an AC track in the browser. This fork adds WA data and the bits needed to build Busselton tracks without clicking through the UI.

## Tracks

| Track | Layout | Length | Route |
| --- | --- | --- | --- |
| Busselton Foreshore | Circuit | 4.3 km | King St, Geographe Bay Rd, West St, Adelaide St, Queen St, Albert St, Bussell Hwy |
| Broadwater Home Run | A to B | 3.6 km | Fairway Dr, Bussell Hwy to King St |

Both are v0.1: built and checked against the map data, not yet driven in game.

To install, drag the zip onto Content Manager, or unzip it into `assettocorsa/content/tracks/`.

## What this fork adds

- **Landgate imagery for WA.** The free Locate mosaic, sharper than Esri around town. Used first anywhere in WA.
- **5 m LiDAR heights.** Geoscience Australia's 5 m DEM, cut to Busselton, Vasse and Broadwater and shipped with the app in `public/dem/wa`. Replaces the 30 m satellite heights the builder would otherwise use.
- **Headless builds.** `scripts/headless/build-track.mjs` builds a track from a route file in headless Chromium. It's the same code as the UI, with no clicking.
- **Build checks.** `scripts/check/check_build.py` draws the built road over the aerial photo and compares its heights with the DEM.
- **Route files.** `routes/` holds the pins for each track, so a rebuild is one command.
- **CSP config.** Each build includes `extension/ext_config.ini`: Grass FX on grassed ground (kept off roads and footpaths) and warm street lights at night along built-up stretches. Needs Custom Shaders Patch.
- **U-turn guard.** The builder warns when a pin makes the route double back, and the check fails the build.

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

Fine for racing with your mates. Don't publish or sell tracks built with the aerial photos or Mapillary data. For a version you could share publicly, set imagery to Off and leave Mapillary out.

## Plan

The full plan, from capture to Blender to LAN racing, is in the project PRD. Next up:

1. First in-game test of both tracks.
2. Drive the loop with a camera and GPS, then upload to Mapillary for real signs.
3. Local detail in Blender: peppermint trees, landmarks, proper houses.

## Credit

The track builder is [honestjams/ac-track-builder](https://github.com/honestjams/ac-track-builder). Its [README](https://github.com/honestjams/ac-track-builder#readme) covers everything the builder does and how it works. The upstream repo has no licence file yet, so this fork is for personal use.

Assetto Corsa is a trademark of Kunos Simulazioni. This project is not affiliated with or endorsed by Kunos.
