# Testing a map with layouts

For the workstation (test bench) and the rig (driving). Nothing here changes code. Report back as `reports/<date>-<topic>.md`.

## 1. Automatic runs, one per layout (workstation)

`git pull` first, so the test runner knows about layouts. Then, with the zip in Downloads:

```powershell
cd <repo>
foreach ($l in "estate", "town", "foreshore", "home_run") {
  .\scripts\windows\run-test.ps1 -Zip $HOME\Downloads\busselton_and_broadwater.zip -Layout $l
}
```

The public map is the same with `busselton.zip` and the layouts `foreshore`, `town` (no estate or Home Run). Free roam has no lap to finish, so drive it by hand (section 2).

Each run lands in `$env:BUSSELTON_TEST_SHARE\<date>-<slug>` with a zip. Attach the zips in the laptop session; they're read with `scripts/check/autotest_report.py`.

## 2. By hand (rig or workstation)

In Content Manager, pick the track, then the layout under it. For each layout, note:

- **Loads?** How long, and any error.
- **Start:** the car sits on the road, facing the way the road goes.
- **Timing:** on a circuit, a lap time appears after one lap. On the Home Run, the timer starts and stops.
- **AI:** add two or three AI cars in a practice or track day. Do they drive at about 50 in town and keep to their side, and do they get round the roundabouts?
- **Free roam:** you should start in a car park (the biggest one, at the shopping centre); with more cars, each starts in another car park (the foreshore, near the jetty, and so on). Drive anywhere: every street should be drivable, with no invisible walls and no holes.
- **Busselton Map app:** open it from the apps bar. You should be an arrow on the right street, and it should follow you. `install-track.ps1 -RigTracks <share>` puts it on the rig too (or copy `apps\lua\BusseltonMap` there by hand).
- **Frame rate:** the CSP FPS counter in town, on the estate and on the foreshore.
- **Anything that looks wrong:** screenshot it (F8) and say roughly where.

## 3. The AI line grid (workstation, two minutes)

Our AI lines have no lookup grid yet; to match Kunos's we need theirs:

```powershell
python -I scripts\check\ai_grid.py "<AC>\content\tracks\ks_black_cat_county\ai\fast_lane.ai" "<AC>\content\tracks\magione\ai\fast_lane.ai"
```

Paste the output into the report.
