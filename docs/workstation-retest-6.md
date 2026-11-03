# Workstation retest 6 (3 Nov 2026)

What changed since retest 4 and what to check. The workstation tests and reports; it never fixes. Report to the share as `reports\2026-11-03-retest-6.md`, with screenshots and logs in `reports\2026-11-03-retest-6\`.

## Builds

Copy into the share's `builds\` (the scripts take the newest zip per track folder):
- `busselton.zip`: the accepted base of 3 Nov, 12:49 (course markings, 37 landmarks, 35 named shops, Shelter Brewing, swimming jetty, and now the beach either side of the jetty precinct built properly). Replaces the one from the morning of 3 Nov.
- `busselton_roadcore.zip`: the trial on the new road core (junctions and roundabouts as single surfaces). Same track folder name as `busselton`, so install it on its own when testing it, then reinstall `busselton`.
- The country tracks, rebuilt 2 to 3 Nov: `boranup_drive`, `caves_road_yallingup`, `caves_road_yallingup_to_wilyabrup`, `caves_road_wilyabrup_to_margaret_river`, `caves_road_boranup`, `tuart_drive`, `busselton_to_dunsborough`, `margaret_river`, `cape_leeuwin`, `cape_naturaliste_road`, `collie_motorplex`.

Before testing: `git pull`, `scripts\windows\rig-install.ps1 -PublishKit`, and one normal install of each track (not `-SkipInstall`) so the apps update.

## Workstation runs (`run-test.ps1`)

1. **Time of day** (from retest 5): `busselton -Layout foreshore -Time 10:00`, then `-Night`. Report the summary's "weather FX" line and the clock notes in `btest.csv`. If the time is wrong, try once with the weather controller set to `base`. In the Busselton Map window, try -1h and +1h.
2. **Town:** solo, through the roundabout by the green shop at about (365, -170); `-Cars 5`: no pile-up at roundabouts 4 and 2. Say if the AI crawls through roundabouts.
3. **Free roam:** solo and `-Cars 15`: every car starts on the road and drives off.
4. **Pit lanes:** `NO PIT LANE FOUND` gone on foreshore, sights and both Collie layouts.
5. **Course markings** (new): on foreshore, town and sights, screenshots at the Queen St / Kent St roundabout and the town start (grid boxes, start line, START FINISH arch). Free roam has none. Note any AI contact with the barriers (they have no collision) and whether a wrong turn gives a cut warning.
6. **Road core trial:** install `busselton_roadcore.zip`, run town and sights solo and `-Cars 5`, then reinstall `busselton`. Compare: stuck spots, off-road, frame rate.
7. **Country:** one run each of the eleven country tracks; each should reach its finish or lap with no off-road.
8. **Daytime looks** (only if the clock works): tree crowns, kerb faces after `bake-vao.ps1`, the Challenges beam (a soft glow), and screenshots of: the swimming jetty, Shelter Brewing, Saltwater and the Weld Theatre on the Queen St / Marine Tce roundabout, the surf club, Busselton Central (Kent St), the Albert St pylons, the bronze statues by the courthouse.
9. **Check:** is there a hole in the road just south of the Queen St / Marine Tce roundabout?
10. **The beach (new):** on free roam, drive Marine Tce and Foreshore Pde by the jetty and look at the beach both sides of the jetty: no dark step or black edge along the sand. Screenshot each side. (About 600 m east of the Hilton the map ends; an edge there is expected.)
11. **Frame rate (new, sets the performance budget):** copy the `frame rate:` line from each run's `autotest_report.py` summary into the report, with CSP's settings as they were. Most wanted: `busselton -Layout free_roam -Cars 15`, `busselton -Layout foreshore -Cars 5`, the road core trial on the same two, and the heaviest country track (`caves_road_wilyabrup_to_margaret_river`). Say if it ever felt stuttery. Busselton is about 1.4M triangles and 2,900 draw calls; if it's smooth with headroom, the limit goes up and more detail can go in.

Expected and harmless: `NO POSITION DATA FOUND` and the app-icon warnings (Kunos tracks and AC's own apps log them too).

## Mac's drive

- **Road core trial vs the base:** roundabouts and junctions should feel smooth, with no steps or lips. Say which feels better; if the trial's good it becomes the default and the old road code goes.
- **Course markings:** do they show the way without getting in the way? Too timid, too much?
- **The new landmarks:** anything that looks wrong next to the real thing (Saltwater, the surf club and the Busselton Central entries are partly guesses).
