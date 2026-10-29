# Capture kit

Drive a route with a camera and a GPS track. The footage does two jobs:

1. **Mapillary** finds the real signs, poles, lights and crossings in it. The track builder then places them where they really are.
2. **Claude** reviews a frame every 25 m and writes up what each street looks like: tree species, fences, roof colours, kerb style. That steers the Blender work.

## Before you go

- Install a GPS logger app that exports GPX. Start it before you start filming.
- Mount the phone or GoPro forward-facing, level and centred, clear of the wiper sweep. 1080p or 4K at 30 fps.
- Note the phone clock time when you hit record. If the frames land in the wrong place later, that time fixes it.
- Mid-morning and overcast is best. Drive at the limit, and do the loop both ways: signs only face one way.

## After the drive

Put the video(s) and the GPX in a folder, for example `drives/2026-11-01/`. That folder is in .gitignore, so footage never ends up in the repo.

```
pip install mapillary_tools
mapillary_tools authenticate --user_name YOUR_MAPILLARY_NAME
python3 -I scripts/capture/process_drive.py drives/2026-11-01 --gpx drives/2026-11-01/track.gpx
```

The script reads the recording start time from the video, and lines the frames up with the GPX by time.

Open `frames.geojson` at [geojson.io](https://geojson.io) and check the dots sit on the roads you drove. Then:

- **Dots shifted along the road:** pass `--offset` with seconds, plus or minus.
- **Dots nowhere near:** pass `--start "2026-11-01 09:14:05"` with the time you noted.
- **Looks right:** rerun with `--upload`.

Mapillary blurs faces and number plates, then takes a day or two to detect objects. After that, paste your Mapillary client token into the builder's Mapillary field and rebuild. In headless builds, put `MAPILLARY_TOKEN=MLY|...` in `.env.local` (gitignored) or the environment. Never put the token in a route file: routes are public.

GoPro with GPS turned on: skip `--gpx`, because the GPS is in the video.

## House looks from your photos

After a build, `out/<slug>.houses.json` lists every house front. Then:

```
python3 -I scripts/mapillary/house_looks.py out/<slug>.houses.json --user maccherry
HOUSE_LOOKS=out/<slug>.looks.json node scripts/headless/build-track.mjs routes/<route>.json
```

It finds the photos that see each front from 5 to 22 m, samples the wall between the fence tops
and the eaves, and votes brick / cream brick / render / weatherboard across at least two photos.
Check `out/<slug>.looks.png` (the samples in magenta on each house's best photo) before trusting it.

For this to work well:
- Walk the footpath, or drive slowly in the kerb lane. Dashcam footage from the middle of a wide
  road sees houses too far away (the wall is a sliver at the horizon).
- A second pass with the phone pointing sideways at the houses (landscape, steady) gives the best
  wall photos. A 360 camera covers both in one pass.
- Daylight without harsh shadows; overcast is ideal.

## House fronts: a walk for the per-house specs

The aerial photo gives each house's outline, roofs, driveway and size. What it can't see is the front: whether the front room has a gable or a hip, the walls' finish and colour (cladding, render, brick), where the garage sits and its door, the front door, windows, verandah, fences and gates. One good photo per house fills that in. A trial on one house: from the aerial alone, the gable came out as a hip, the garage's render as cladding, and the windows and door generic.

- **Photos, not video, and not uploaded to Mapillary.** Use the phone's normal camera with location on, so each photo carries where it was taken. These stay private: they come here (attached, or through the workstation share), get read into the specs, and are deleted after.
- **One photo per house, square-on, from across the street,** 10 to 15 m back, landscape, the whole front in frame (roof to driveway). Walk one side of the street photographing the houses on the other, then come back down the other side.
- **Corner lots:** one of each street-facing side.
- **Light:** a bright overcast day is best (no hard shadows under verandahs); otherwise with the sun behind you, so morning on one side of the street and afternoon on the other.
- **Pace:** about 20 houses takes 15 minutes.
- **Skip** any house whose owner asked to be left generic.

Then each house gets a draft spec from its photo and the aerial photo, and a review page shows the photo beside a render of the draft to correct.
