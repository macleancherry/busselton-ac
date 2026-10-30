# Traffic test (CSP traffic planner)

Every build made with `"traffic": true` ships `data/traffic.json` (lanes, junctions, roundabouts)
and the `surfaces.ini` changes CSP's traffic tool needs (`WAV_PITCH=extended-0` on SURFACE_0, and
`[_SCRIPTING_PHYSICS] ALLOW_TOOLS=1 ALLOW_TRACK_SCRIPTS=1`). The tool is CSP's own
(x4fab's csp-traffic-tool, bundled with CSP); this test checks that our generated lanes work in it.

Note: with those surfaces.ini changes the track won't pass an online server's integrity check. Ours
is for offline and LAN anyway.

## Zones and the kids' setting

The traffic is zoned (`src/core/trafficZones.ts`, on by default, `build.trafficZones: false` turns it
off): busy streets (OSM primary, secondary, tertiary), the town centre (retail and commercial landuse,
or 8+ shops and cafes within 100 m), quiet streets (residential and the rest) and highways. How it
reaches the planner, which has no density setting of its own (source: acc-lua-internal,
`included-tools/traffic`):

- **Speed and who gives way:** each zone and limit is a role in the planner's **Rules** tab (`Busy
  street 60`, `Town centre 40`, `Quiet street 50`, ...). The planner takes a lane's limit from its role,
  not the lane. Where part of a road is in another zone (the drive through the centre), an **Area**
  gives that stretch its role and limit; they show in the **Areas** tab.
- **Density:** cars appear evenly along every lane, then wander. Only 40% of the turns from a busy road
  into a quiet street are allowed (the rest are forbidden turns in the junction, the same ones every
  build), so through traffic stays on the main roads and quiet streets carry mostly their own cars.
- **How many cars:** the track can't set this. It's the planner's **Cars** slider (or "Cars limit" in
  the Traffic mode). Each `traffic.json` has a suggested figure: `"busselton": { "cars": ... }` at the
  end of the file, and `traffic_check.py` prints it.

**Kids' setting:** `build.trafficSetting: "kids"` for a whole route, or `"traffic": "kids"` on one
layout (in `layouts`, or `layout` for the route's own). It caps limits at 30 on quiet streets and in
the centre, 40 on busy roads, 60 on highways and 20 round roundabouts, and suggests about a third as
many cars. Set the Cars slider to the suggestion when testing it.

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
| T9 | With Cars at the suggested figure: main roads and the town centre clearly busier than the residential streets; quiet streets not empty | |
| T10 | Rules tab lists the zone roles (`Busy street 60`, `Quiet street 50`, ...); Areas tab lists the zone areas without an error | |
| T11 | Cars keep to about the zone limits: slower in the town centre than on the busy roads | |
| T12 | No car stuck at a junction where its turn is forbidden (cars stopping dead at a junction mouth) | |
| T13 | A kids' layout (if the build has one): noticeably slower traffic, and with Cars at its suggestion, sparse | |

## Reporting

Write `reports/<date>-traffic.md`: which checks passed, screenshots of anything wrong (with
roughly where on the lap), and these log lines if present:
- `Documents\Assetto Corsa\logs\custom_shaders_patch.log`: anything mentioning `traffic`, `Lua`
  or `script`
- the planner's own error text, if it shows one

Don't fix anything on the workstation: report, and the laptop session fixes it.
