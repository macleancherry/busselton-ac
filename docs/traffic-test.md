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

# AI Flood on Free Roam (Track Day)

The other kind of traffic: AI Flood, part of CSP's **New AI behavior** module. It works in Track
Day mode only. Normal AC cars drive the layout's AI line (`ai/fast_lane.ai`). CSP removes the ones
far behind you and brings them back ahead of you, so a few cars feel like steady traffic. Unlike
the traffic planner, the cars are real AC cars with physics, so any car mod works with no
conversion (see [traffic-cars.md](traffic-cars.md)). The catch: they only drive the one AI loop,
in one direction. Elsewhere in town there are none, so use the planner for every street.

## What the track gives it (generated, nothing to do by hand)

The Free Roam layout (`layouts` entry with `spawns`, src/core/layouts.ts) ships:

- **An AI line with town speeds.** By default this is the main layout's loop (the Foreshore
  circuit, about 4.3 km), now with its `ai_hints.ini` speed limits too, so flood cars drive at 50
  and not flat out. Give the free roam layout `pins` (and `"loop": true`) beside its `spawns` and
  it gets its own loop instead, built like any layout's (pulled onto the built streets, limits from
  each street).
- **24 pit boxes** (`aiPits` in the layout overrides that). Track Day gives every car a pit box, so
  this caps the AI count at 23. The free roam's own spawns come first (the player starts on spawn
  0). The rest are spread evenly round the AI line, on the line and facing along it, off
  roundabouts and tight corners (radius under 80 m), and 25 m clear of the spawns and of each
  other. With no pit lane, each AI car starts on its line and just drives off. `AC_START_n` sits
  on the same spots, so a Race session with that many cars works too.
- **`ui_track.json`** with the real loop length and the pit box count, so Content Manager's
  opponent limit matches.

CSP turns flood off on tracks shorter than its **Minimum track length** setting (default 7000 m,
1000 to 13000). The Foreshore loop is shorter than that, so lower the setting (step 1 below), or
give free roam a loop of 7 km or more.

## Starting it

1. Content Manager → Settings → Custom Shaders Patch → **New AI behavior**:
   - Active: on. **AI flood → Active**: on.
   - **Minimum track length**: 4000 (or less than the free roam loop's length).
   - Push speed: about 50 km/h (default 80; it pushes new cars up to speed, and 80 is fast for town).
   - Behavior variation: **Always**, Speed limit **40, 60**. Variation is the only thing that
     applies its speed limit, and by default it's on only for multi-lane traffic maps.
   - Optional: Allow to drive wrong way → In Track Day mode.
   - Hidden distances (only in `Documents\Assetto Corsa\cfg\extension\new_behaviour.ini`,
     `[AI_FLOOD]`): `SPAWN_DISTANCE=600, 300`, `SPAWN_RANGE=200, 100`, `SPAWN_DESPAWN=1000, 400`,
     `SPAWN_MIN_DISTANCE_TO_PLAYER=400, 200`. The defaults suit the 4.3 km loop. Halve them if the
     cars appear too far away to see.
2. Content Manager → Drive → **Quick Drive** → mode **Track day**. Track Busselton, layout
   **Busselton Free Roam**.
3. Pick your car. Opponents: 8 to 15 road cars to start (up to 23), AI level 75 to 85. Ordinary
   road cars or traffic cars, not race cars: race cars try to race.
4. Start. The AI cars leave their boxes along the loop. Drive the loop and they should keep turning
   up ahead of you.

## What to check

| # | Check | Pass |
| --- | --- | --- |
| F1 | Track Day loads on Free Roam with the AI count you picked, no cars stacked on each other at the start | |
| F2 | AI cars leave their boxes and drive the loop on the left of the road | |
| F3 | They hold about 50 in town and slow for the roundabouts (they don't fly through) | |
| F4 | Drive a lap: cars despawn behind you and appear ahead of you (flood is working) | |
| F5 | No cars stuck on the kerb, on the verge, or turning round | |
| F6 | Frame rate with 15 AI (CSP's or CM's FPS counter) | |

Report as for the planner test (`reports/<date>-ai-flood.md`), with the CSP log lines that mention
`AI` or `flood`.

## Sources

- CSP's own module config, `new_behaviour.ini` in
  [acc-extension-config](https://github.com/ac-custom-shaders-patch/acc-extension-config/blob/master/config/new_behaviour.ini):
  "AI flood (works in Track Day mode)", `MIN_TRACK_LENGTH=7000`, the spawn distances, and "Doesn't
  affect online races".
- Track Day plus AI Flood setup, with "AI cars will de-spawn behind you, and re-spawn ahead of you"
  and the advice to use an ai_hints.ini to keep them from racing:
  [Steam discussion](https://steamcommunity.com/app/244210/discussions/0/3819663388893459328).
- Spline length against `MIN_TRACK_LENGTH`:
  [Daikoku traffic layouts](https://www.overtake.gg/downloads/traffic-and-race-layouts-for-daikoku-with-optional-physics-for-paint-and-road-surfaces.43553/)
  ("any track that has the AI spline longer than 4000m" once the minimum is set to 4000).

## Not done yet

- **Two-way flood traffic.** Mods that do it use an AI loop that goes out one side of the road and
  back the other. Ours runs down the road's centreline, so an out-and-back route would put both
  directions on the same line. That needs a keep-left offset in `aiLine.ts` first.
- **A longer cruise loop** (7 km or more, through more of the town) as the free roam's own `pins`.
  It needs a real build to check for U-turn spikes, so it isn't in the route file yet.

# Does offline traffic work in Content Manager LAN?

**No.** Neither of the offline kinds works there:

- **LAN is a multiplayer session.** CM's server presets run AC's own `acServer.exe`, and the other
  machine joins from Drive → Online → LAN. It's an online session, even on the home network.
- **The traffic planner is offline only.** Its readme says it is "offline and without replay
  support for now"
  ([csp-traffic-tool-extended readme](https://github.com/jakzo/csp-traffic-tool-extended/blob/main/readme.md),
  a fork carrying the original's notes). Each player's planner would run its own unsynced traffic
  anyway.
- **AI Flood is offline only.** CSP's module: "Doesn't affect online races"
  ([new_behaviour.ini](https://github.com/ac-custom-shaders-patch/acc-extension-config/blob/master/config/new_behaviour.ini)).
- **The integrity check fails.** The planner's `surfaces.ini` changes stop the track passing a
  server's integrity check unless the server's track checksums are removed
  ([AssettoServer FAQ](https://github.com/compujuckel/assettoserver-docs/blob/master/versioned_docs/version-0.0.52/faq.md):
  delete the server's `surfaces.ini` copies).

**What would work on LAN: AssettoServer's AI traffic.** AssettoServer is a free replacement for
acServer and runs on Windows. Its traffic runs on the server, so every player sees the same cars.
It drives a track's `fast_lane.ai`, which our layouts already have ("any track that you have a
`fast_lane.ai(p)` for"). Set `EnableAi: true` in `extra_cfg.yml` and add traffic cars to
`entry_list.ini` with `AI=fixed`. It shows up in CM under Drive → Online → LAN
([AssettoServer beginner's guide](https://assettoserver.org/docs/thebeginnersguide/)). Clients
need CSP. The traffic cars are ordinary AC cars, so the car mods in
[traffic-cars.md](traffic-cars.md) work. It's server software on one of the Windows machines, which
the setup avoids now, and it hasn't been tried here. Like flood, it only drives the AI line, one
way.
