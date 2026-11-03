# Workstation retest 7 (3 Nov 2026, evening)

Checks the fixes for retest 6's problems. The workstation tests and reports; it never fixes. Report to the share as `reports\<date>-retest-7.md`, with screenshots and logs in `reports\<date>-retest-7\`.

## Builds

In the share's `builds\` (Mac copies them in; installs now take the zip by exact name):
- `busselton.zip`: the accepted base of 3 Nov evening. Road core on by default, pit boxes in a row off the road with their own pit lane, invisible walls clear of every layout's AI line, nothing standing on the road. Replaces both `busselton.zip` and `busselton_roadcore.zip` (delete the road-core one).
- `caves_road_yallingup.zip` and `collie_motorplex.zip`: rebuilt on the same code.

Before testing: `git pull`, `scripts\windows\rig-install.ps1 -PublishKit`, then `scripts\windows\install-track.ps1 -All`. Check that `busselton.zip` goes on and any `busselton_roadcore.zip` is listed as skipped.

## Workstation runs (`run-test.ps1`)

1. **AI races (the pit-box fix, most important):**
   - `busselton -Layout foreshore -Cars 5`: a clean start, no pit crew standing on the grid, every car leaves its slot.
   - `busselton -Layout free_roam -Cars 15`: no car stops for good at another car's spawn spot. If a car gets sent back to the pits, it should wait in the pit row (on the grass beside the road) and drive out along the pit lane.
   - `busselton -Layout town -Cars 5`: no cars parked on the grid after a lap. Roundabouts may still bunch the cars; say how bad.
   - `busselton -Layout sights -Cars 5`.
   - `NO PIT LANE FOUND` should stay gone on every layout.
2. **Queen St bump:** in town solo, the car shouldn't be thrown near the statue plinths south of the Queen St / Marine Tce roundabout.
3. **AO bake kept per build:** `bake-vao.ps1 -Track busselton` should say the bake was kept for this build. Install `busselton` again: it should say the bake was put back. Run `busselton -Layout sights -SkipInstall`.
4. **Clock:** `busselton -Layout foreshore -Time 10:00`, then `-Night`, with Pure Planner left on Live. Report the `clock (app):` notes (the first line, any "jumped to", "put back", "now 10:00") and the game time at the finish. If it still won't hold, try once with Pure Planner on a plan other than Live.
5. **Black screenshots:** the sights run's summary now counts black shots, and `clicks.txt` notes the window in front at each F8. Report both.
6. **Caves Road Yallingup:** one run; it should reach the finish. Screenshot the sharp left at Yallingup (about 7,000 m).
7. **Collie:** short and long, one run each; no off-road at the short layout's southern link (about 484 m).
8. **Frame rate:** the `frame rate:` line for free roam `-Cars 15`. Retest 6 was 35 to 40 fps on every track at 4K with 4x MSAA, so it's the settings, not the track; just confirm the new build isn't slower.

Expected and harmless: `NO POSITION DATA FOUND` and the app-icon warnings.

## Mac's drive

- The road core is now the base: roundabouts and junctions should feel smooth, with no steps or lips.
- The red shared path along the foreshore should be there almost all the way (a few short gaps of 5 to 10 m are known).
- The Tav sits 1.5 m further from Queen St than the aerial fit, so its corner keeps off the road. Say if it looks wrong.
