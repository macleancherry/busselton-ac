# Traffic test (CSP traffic planner)

Every build made with `"traffic": true` ships `data/traffic.json` (lanes, junctions, roundabouts)
and the `surfaces.ini` changes CSP's traffic tool needs (`WAV_PITCH=extended-0` on SURFACE_0, and
`[_SCRIPTING_PHYSICS] ALLOW_TOOLS=1 ALLOW_TRACK_SCRIPTS=1`). The tool is CSP's own
(x4fab's csp-traffic-tool, bundled with CSP); this test checks that our generated lanes work in it.

Note: with those surfaces.ini changes the track won't pass an online server's integrity check. Ours
is for offline and LAN anyway.

## Once per machine

1. CSP traffic tool car models aren't bundled with CSP. Download
   https://files.acstuff.club/TCKo/data.zip and extract its `data` folder into the traffic tool's
   folder in the AC install (search `assettocorsa\extension` for a folder named `traffic` or
   `csp-traffic-tool` containing `tool.lua`; the `data` folder goes next to `tool.lua`).

## Each build

1. Install the build as usual (`scripts\windows\install-track.ps1 -Zip <zip>`).
2. Content Manager → Drive → Practice, track Busselton Foreshore, any road car, start.
3. In game: open the **Objects Inspector** app (CSP apps in the right-hand app bar), click
   **Tools**, choose **Traffic planner**. It loads `traffic.json` and draws the lanes.
4. Look first, then run it: the planner has a test / simulation toggle that spawns traffic live.

## What to check

| # | Check | Pass |
| --- | --- | --- |
| T1 | The planner opens without an error and draws lanes on every road: the lap, the side streets, round each roundabout | |
| T2 | Lanes sit on the left of each road (Australia), two each way on the wide stretches | |
| T3 | Traffic spawns and moves on the lap and on side streets | |
| T4 | At roundabouts cars go round clockwise and give way to cars already on the ring | |
| T5 | At T-junctions side-street cars wait for the main road | |
| T6 | No cars driving through each other, floating, sinking, or stopping dead mid-road | |
| T7 | Your own car interacts: traffic slows behind you, you can hit it | |
| T8 | Frame rate with traffic on vs off (CSP's FPS counter or CM's) | |

## Reporting

Write `reports/<date>-traffic.md`: which checks passed, screenshots of anything wrong (with
roughly where on the lap), and these log lines if present:
- `Documents\Assetto Corsa\logs\custom_shaders_patch.log`: anything mentioning `traffic`, `Lua`
  or `script`
- the planner's own error text, if it shows one

Don't fix anything on the workstation: report, and the laptop session fixes it.
