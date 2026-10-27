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

Mapillary blurs faces and number plates, then takes a day or two to detect objects. After that, paste your Mapillary client token into the builder's Mapillary field and rebuild. In headless builds, add `"mapillaryToken": "..."` to the route's `options`.

GoPro with GPS turned on: skip `--gpx`, because the GPS is in the video.
