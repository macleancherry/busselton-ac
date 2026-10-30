# Workstation test: everything from the 30 October builds

For Claude Code (or Mac) on the workstation (RTX 4060). It covers installing both maps, the automatic AI runs, the AO bake, the CSP pass, the 3D trees, the jetty and the map app. About 2 to 3 hours, most of it unattended.

The workstation never edits code, route files or docs, and never commits (CLAUDE.md). When something is wrong, don't fix it: note it in the report.

## 0. Get ready

1. `git pull` in the repo.
2. The zips are in the share's `builds\` folder (`D:\busselton-share\builds`):
   - `busselton_and_broadwater.zip`: the whole map
   - `busselton.zip`: the public map
   - `busselton_trees.zip`: the public map with the 3D trees on
3. Close AC, Content Manager and Blender.
4. Write down:
   - the CSP version (Content Manager > Settings > Custom Shaders Patch, at the top)
   - whether Pure is installed, and its version
   - the Nvidia driver version
5. Set the share once if it isn't: `setx BUSSELTON_SHARE D:\busselton-share`. Optional: `BUSSELTON_RIG_TRACKS`, so the installs copy to the rig too.

Start a report in the share as `reports\<date>-workstation-test.md` (files it points to in `reports\<date>-workstation-test\`) and fill it in as you go.

## 1. Install (5 minutes)

```powershell
cd <repo>
.\scripts\windows\install-track.ps1 -Zip busselton_and_broadwater
.\scripts\windows\install-track.ps1 -Zip busselton
.\scripts\windows\install-track.ps1 -Zip busselton_trees
```

This also installs the Busselton Map app and Busselton Challenges into `apps\lua`. Note any errors.

## 2. Screenshots before the AO bake (10 minutes)

The bake changes how everything looks, so take the "before" shots now. In Content Manager:
- track **Busselton**, layout **Foreshore**, any car
- practice, 12:00, clear weather, date 15 January

Take a screenshot (F8) at each of these spots, and note each spot so the "after" shots match:

1. the grid
2. the jetty entrance (the train and the boatsheds)
3. a house street in town, close to the houses
4. a car park with trees

## 3. Automatic AI runs (unattended, about 10 minutes each)

```powershell
foreach ($l in "estate", "town", "foreshore", "home_run") {
  .\scripts\windows\run-test.ps1 busselton_and_broadwater -Layout $l
}
foreach ($l in "foreshore", "town") {
  .\scripts\windows\run-test.ps1 busselton -Layout $l
}
```

Each run leaves a folder and zip in the share's `tests\`. List them in the report.

## 4. AO bake (the main new thing)

### One-time setup

1. Download CSP's AO bakery: the latest release zip from https://github.com/ac-custom-shaders-patch/acc-bakeryoptix/releases. Ask Mac before downloading; note the file name and version.
2. Unzip it to `C:\Tools\bakeryoptix`.
3. Run `setx BUSSELTON_BAKERY C:\Tools\bakeryoptix\bakeryoptix.exe`, then open a new PowerShell window.

### Bakes

AC must be closed. Bake the small map quickly first, then the whole map at full quality:

```powershell
.\scripts\windows\bake-vao.ps1 -Track busselton -Quality test
.\scripts\windows\bake-vao.ps1 -Track busselton
.\scripts\windows\bake-vao.ps1 -Track busselton_and_broadwater
```

For each bake, record:
- the time it prints
- the `.vao-patch` files and their sizes
- whether it used the GPU (the first lines of `vao-bake.log` in the track folder)
- GPU memory, if you can watch it (Task Manager > Performance > GPU)

If a bake fails, put the last 30 lines of `vao-bake.log` and `vao-bake.log.err` in the report and carry on with the rest.

### After the bake

Same settings as step 2. Take the same four screenshots.

What to look for:
- **Good:** soft shading under eaves and verandahs, at wall bases, under trees and car park shade sails, and where kerbs meet the road.
- **Bad:** black blotches, whole walls or roofs gone dark, stripes, or patches that don't match the mesh.

Put the before and after shots side by side in the report.

## 5. CSP pass (20 minutes, track **Busselton**, layout **Foreshore**)

Change one thing at a time in Content Manager and check:

| Setting | What should happen |
| --- | --- |
| 07:00 | Sun low in the **east**, over the land, not the bay. |
| 12:00 | Sun in the **north**, over the bay (southern hemisphere). |
| 18:30, date 15 January | Sun low in the **west**, close to setting. |
| Date 15 January, 12:00 | Grass and verges look **straw**, dry. |
| Date 15 July, 12:00 | Grass and verges look **green**. Screenshot both seasons at the same spot. |
| Any time, look at the bay | CSP water: moving waves and reflections, not a flat photo. |
| Windy weather | Trees and grass sway. |
| Rain (CSP or Pure rain) | Wet road and puddles on the road, not on the grass. Note how it looks. |
| 21:00 | Street lights on. Shop signs lit, shop windows glowing. Jetty lamps lit. Screenshot the jetty. |

Also note:
- **Pure, if installed:** no errors, and the fog and haze look sensible, not milky.
- **Ground textures:** any visible repeating pattern up close.

## 6. 3D trees (20 minutes)

### a. Content Manager tree check (5 minutes)

Follow `README.txt` in `tree-reference.zip`:
1. Content Manager > Content > Tools > Creator tools > Tree model converter.
2. Convert `tuart.fbx`.
3. Save the result as `tuart_cm.bin`.

Put it in the report's folder in the share (`reports\<date>-workstation-test\tuart_cm.bin`).

### b. In game

Load **Busselton Trees** (layout Foreshore), 12:00, clear. The kn5 card trees are gone; CSP draws 3D trees instead: peppermints, she-oaks, Norfolk pines, tuarts and palms.

Check:
- **Trees appear at all.** If there are none, note the CSP version and copy any lines mentioning "tree" from the CSP log (step 9).
- **Upright and the right way up:** not lying on their side, sunk into the ground, or floating.
- **Sizes look real:**
  - Norfolk pines along the foreshore tall, about 20 to 30 m
  - peppermints in streets about 6 to 10 m
- **Leaves:**
  - visible from both sides
  - not black, white, or inside-out
  - the bark has texture
- **Up close vs far away:** walk or drive away from a tree; it should get simpler with no popping you'd notice, and still be there at 150 m.
- **Lighting:** the trees cast shadows, and they sway in wind.
- **Frame rate:** compare against **Busselton** (card trees) at the same two spots, the foreshore and a town street, with the CSP FPS counter.

## 7. Jetty precinct (10 minutes, any time of day)

Drive to the jetty on the Foreshore layout and check each of these, with a screenshot:
- the train line along the jetty, sleepers and rails
- the red train at the shore platform
- the platforms and shelters
- the four blue boatsheds with white roofs
- the Observatory at the far end, if you can see it from shore
- nothing floating or sunk into the deck

## 8. By hand

Do section 2 of `docs/one-map-test.md` on each layout:
- loads, start position, timing
- AI cars
- free roam spawns in car parks
- the Busselton Map app
- FPS in town, on the estate and on the foreshore

Then run its section 3, the AI line grid, and paste the output.

## 9. Logs

After the last session, copy these into the report folder:
- `Documents\Assetto Corsa\logs\log.txt`
- `Documents\Assetto Corsa\logs\custom_shaders_patch.log`

In the report, quote any lines with `error`, `warning`, `tree`, `vao`, `busselton` or `failed`.

## 10. Report

Save `reports/2026-10-30-workstation-test.md` with:
- the versions from step 0
- one line per section: what you did, what happened, pass, fail or unsure
- the bake times and file sizes
- the screenshots, before/after and seasons
- paths to the run zips and `tuart_cm.bin`
- the log lines from step 9

Tell Mac it's done. Everything is in the share; nothing needs copying.
