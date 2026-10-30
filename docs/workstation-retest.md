# Workstation retest: the fixes from the 30 October test

For Claude Code on the workstation. Nothing here changes code. Everything goes in the share
(`\\media\busselton-share`, or `D:\busselton-share` where it's hosted). About an hour, unattended.

## 0. Ready

1. `git pull`. It brings the share-aware scripts: tracks by slug, results in `tests\`, bake logs in `bakes\`.
2. Check the new builds are in the share's `builds\` folder: `busselton_and_broadwater.zip`, `busselton.zip` and `busselton_trees.zip`, all dated 30 October, after 12:00.
3. Start the report as `reports\<date>-workstation-retest.md`, with its files in `reports\<date>-workstation-retest\`.

## 1. AI runs on the new builds

```powershell
foreach ($l in "estate", "town", "foreshore", "home_run") { .\scripts\windows\run-test.ps1 busselton_and_broadwater -Layout $l }
foreach ($l in "foreshore", "town") { .\scripts\windows\run-test.ps1 busselton -Layout $l }
```

Check, and report each:

- **Off-road events:** the three spots from last time should be gone:
  - estate (-966, 734)
  - the roundabout exit at (1747, -1135), in town and on the foreshore
  - the foreshore straight at (1708, -761)
- **`WARNING: TRACK :: NO POSITION DATA FOUND`:** should be gone. The AI lines now have Kunos's lookup grid. If it's still there, quote the lines around it.
- **`Failed to calculate BS for vertices: 3`:** should be gone.
- Frame rate, as before.

## 2. Bake again, then drive the baked track

The geometry changed, so the old bakes don't fit. Installing a new build removes them, and says so.

```powershell
.\scripts\windows\bake-vao.ps1 -Track busselton
.\scripts\windows\bake-vao.ps1 -Track busselton_and_broadwater
.\scripts\windows\run-test.ps1 busselton -Layout foreshore -SkipInstall
```

- Each bake writes its log, time and settings into `bakes\`.
- In the bakery's log, find the line that says how many rays per sample it used: it should be 96 for these final bakes. Quote it.
- The `-SkipInstall` run drives the baked track. Its screenshots are the "after" set: compare them with last time's public foreshore run in `tests\` (the same lap points) and say whether the shading looks right.

## 3. 3D trees

`busselton_trees` is the public map with CSP's 3D trees. Content Manager's converter confirmed the file format.

```powershell
.\scripts\windows\install-track.ps1 -Zip busselton_trees
.\scripts\windows\run-test.ps1 busselton_trees -Layout foreshore
```

- In the CSP log: `Loading trees` should now take far longer than the 34–46 μs of a track with no trees, and there should be no tree errors. Quote the tree lines.
- The run's screenshots should show 3D trees along the foreshore (Norfolk pines) and in the streets. Say how they look: upright, the right size, leaves not black or inside-out.
- Frame rate against the `busselton` foreshore run.

## 3b. Landmarks in game

The new **Sights** layout drives a short loop past Rocky Ridge, the Old Courthouse and the Esplanade Hotel. Every automatic run takes an extra screenshot just before each landmark, logged as `BTEST,shot` with `landmark_<name>`.

```powershell
.\scripts\windows\run-test.ps1 busselton -Layout sights -SkipInstall
```

Run it after the bake in step 2, so the shots have CSP lighting and AO. Put the landmark screenshots in the report folder, and say how Rocky Ridge looks: the roof, the beer garden, the umbrellas and the sign.

## 4. What still needs Mac in person

These need someone at the wheel. Leave them for Mac and list them at the end of the report:
- time of day and the sun
- dry and wet seasons
- the bay's water, wind and rain
- the night look and the jetty
- free roam spawns
- the Busselton Map app

## 5. Logs and report

Copy the AC and CSP logs from the last run into the report's folder, then tell Mac the report is in the share.
