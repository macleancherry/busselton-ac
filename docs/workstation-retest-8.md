# Workstation retest 8 (6 Nov 2026, evening)

Checks the fixes for retest 7's problems. Short: about 40 minutes. The workstation tests and reports; it never fixes. Report to the share as `reports\<date>-retest-8.md`, with screenshots and logs in `reports\<date>-retest-8\`.

## What changed

- **AI pace on roundabouts and square corners.** Retest 7's cars weren't driving into the pit row: AC teleported them there. Every car that went had been crawling round a roundabout at 10 to 15 km/h behind the car in front, which AC takes for stuck. The roundabouts' AI hint was 0.35 of AC's own cornering speed; it's now 0.7, so the AI goes round at about 25 km/h and a queue keeps moving.
- **AO bake restore.** The local bake store had Windows file encryption (EFS) on its files, and copying them into the AC folder failed. Bakes are now copied as plain bytes, and a failed restore warns instead of stopping the install.
- **Black screenshots.** When most of a run's shots are still black after the retries, `run-test.ps1` runs it once more by itself (`-SkipInstall -NoRetry`); the first folder gets a `black-shots-rerun.txt` note.

## Builds

`busselton.zip` in the share's `builds\` (Mac copies it in). Same as retest 7's apart from `data\ai_hints.ini` in each layout.

Before testing: `git pull`, then `scripts\windows\install-track.ps1 -Zip busselton`. It should say the AO bake for this build was put back, or that there's none yet, and finish with "Installed busselton". It must not stop with "could not be encrypted".

## Runs (`run-test.ps1`)

1. **AI races, most important:**
   - `busselton -Layout town -Cars 5`
   - `busselton -Layout free_roam -Cars 15`
   - `busselton -Layout foreshore -Cars 5`
   - `busselton -Layout sights -Cars 5`

   For each one, report:
   - how many cars got sent to the pit row, and when
   - whether any of them drove back out along the pit lane
   - laps completed
   - the bunching at roundabouts: contacts, pile-ups and where

   `python3 -I scripts/check/autotest_report.py` lists them. A teleport shows in `btest.csv` as a car's position jumping 40 m or more between samples.
2. **Town solo straight after**, `busselton -Layout town`: if its shots come out black, the run should go again by itself. Report both folders.
3. **AO bake:** `bake-vao.ps1 -Track busselton`, then `install-track.ps1 -Zip busselton` again. It should say the bake was put back. Then `busselton -Layout sights -SkipInstall`.

Expected and harmless: `NO POSITION DATA FOUND`, `CANNOT FIND DigitalLed mesh:WATER_LED_0` and the app-icon warnings.

## Known, not for this retest

Collie short's off at 484 m is a grass wedge where the long layout's road and the short link's street meet. It's left for the junction work.
