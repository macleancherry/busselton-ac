# One-click install on the rig

The gaming rig only drives. New builds land in the share (`\\media\busselton-share\builds\<slug>.zip`, polish zips as `<slug>_polish.zip`), and one double-click puts everything new into the rig's Assetto Corsa.

## On the rig

1. Open `\\media\busselton-share` in Explorer.
2. Double-click **Install Busselton.cmd**.

A window opens, installs whatever is new, prints what changed, and waits for a key. Then refresh the track list in Content Manager (or restart it).

It does:

- **Finds AC by itself:** Steam's registry entry, then every library in `libraryfolders.vdf` (using `appmanifest_244210.acf`), then Content Manager's settings (`%LOCALAPPDATA%\AcTools Content Manager\Values.data`). If it still can't, run it once with `-AcPath "D:\SteamLibrary\steamapps\common\assettocorsa"`, or `setx BUSSELTON_AC_PATH <that folder>`.
- **Installs only what's new:** a zip whose time or size changed since this PC last installed it, or a track that isn't installed yet. The first run installs everything. It remembers in `%LOCALAPPDATA%\BusseltonAC\installed.json`.
- **Bases first, then polish.** A polish zip is laid over its installed track (`install-track.ps1 -Overlay`), and only when it's newer than the base build. A base build already has the landmarks it was built with, so an older polish is skipped.
- **Keeps AO bakes** when the new build has the same geometry (the same rule `install-track.ps1` uses on the workstation). When the geometry is new, the bake is dropped and the summary says so.
- **Installs the apps:** Busselton Challenges and Busselton Map, into `<AC>\apps\lua`, whenever they've changed.
- **Shows what changed:** for each track, new build or first install, the build's time and size, its layouts (with new and removed ones), and what happened to the AO bake. If the laptop session left a note next to the zip (`builds\<zip name>.txt`), the note is shown too.
- **Stays out of the way:** it won't touch anything while AC (`acs.exe`) is running, and it leaves zips written in the last minute alone (they may still be copying in).

Options (add them after the file name in a Command Prompt, or to the task):

| Option | What it does |
| --- | --- |
| `-DryRun` | Only says what it would install. |
| `-Force` | Reinstalls everything. AO bakes are still kept when the geometry is the same. |
| `-InstallTask` | Also checks the share each time you log in (below). |
| `-RemoveTask` | Stops that. |
| `-AcPath <folder>` | Where AC is, if it can't find it. |
| `-Share <folder>` | Where the share is, if not `\\media\busselton-share` (or set `BUSSELTON_SHARE`). |

## Check on log-in (optional)

In a Command Prompt on the rig:

```
"\\media\busselton-share\Install Busselton.cmd" -InstallTask
```

That makes a scheduled task, **Busselton tracks**. A minute after log-in it runs hidden, waits up to 3 minutes for the share, installs anything new and shows a notification saying what it installed (or what failed). If AC is already running it does nothing and says so. Its log is `%LOCALAPPDATA%\BusseltonAC\rig-install.log`.

If Windows won't make a log-in task without admin rights, it puts `Busselton tracks.cmd` in the Startup folder instead, which does the same. `-RemoveTask` removes either.

The task runs the script from where you ran `-InstallTask` (the share, normally), so the share has to be up at log-in for it to do anything. Nothing breaks if it isn't.

## Where the installer lives

The rig doesn't need the repo, Node or Python. The share holds a copy of the installer:

```
\\media\busselton-share\
  Install Busselton.cmd                    the double-click (a copy of rig-install.cmd)
  rig\scripts\windows\rig-install.ps1      the installer
  rig\scripts\windows\install-track.ps1    does each install, the same script the workstation uses
  rig\scripts\windows\share.ps1, ac.ps1    finds the share and AC, installs the apps
  rig\scripts\windows\rig-install.cmd
  rig\apps\lua\BusseltonChallenges, BusseltonMap
```

Update it whenever these scripts or the apps change, from any machine with the repo and the share:

```
.\scripts\windows\rig-install.ps1 -PublishKit
```

(The laptop session can copy the same files into the share itself when it's linked.) In a repo checkout, `scripts\windows\rig-install.cmd` works too.

## For the laptop session

- Write each build to `builds\<slug>.zip` and each polish to `builds\<slug>_polish.zip`. Write to a temporary name (`<slug>.zip.part`) and rename when done if you can; the installer skips anything written in the last minute anyway.
- To tell Mac what changed in a build, put a few plain lines in `builds\<slug>.txt` (or `<slug>_polish.txt`). The rig shows the first 15 lines next to that track.
- After changing `rig-install.ps1`, `install-track.ps1`, `share.ps1`, `ac.ps1` or the apps, republish the kit (`-PublishKit`).

## Why not a Content Manager link

Content Manager has its own `acmanager://` scheme, and its source shows it can install from a local path: `acmanager://install?url=<path>` hands each `url` straight to the content installer ([ArgumentsHandler.Commands.cs, `case "install"`](https://github.com/gro-ove/actools/blob/e5e5c94b8dee7511def0b670bfd5dbb233831c11/AcManager/Tools/ArgumentsHandler.Commands.cs#L214), with no web-URL check on that parameter). The installer downloads only `http:`, `https:` and `ftp:` sources ([ContentInstallationManager.IsRemoteSource](https://github.com/gro-ove/actools/blob/e5e5c94b8dee7511def0b670bfd5dbb233831c11/AcManager.Tools/ContentInstallation/ContentInstallationManager.cs#L241)) and uses anything else as a local file as it is ([ContentInstallationEntry.cs](https://github.com/gro-ove/actools/blob/e5e5c94b8dee7511def0b670bfd5dbb233831c11/AcManager.Tools/ContentInstallation/ContentInstallationEntry.cs#L646)). Starting `Content Manager.exe` with a zip's full path, or dragging the zip onto it, takes the same route ([ArgumentsHandler.cs](https://github.com/gro-ove/actools/blob/e5e5c94b8dee7511def0b670bfd5dbb233831c11/AcManager/Tools/ArgumentsHandler.cs#L140)). So a link like this should open CM's install dialog for one build (the path URL-encoded; not tried yet):

```
acmanager://install?url=%5C%5Cmedia%5Cbusselton-share%5Cbuilds%5Cbusselton.zip
```

It isn't the main way in because CM's dialog asks about each zip, installs one at a time, and doesn't know our rules: it doesn't keep an AO bake when the geometry is the same, doesn't put the polish on after its base or skip a stale one, and doesn't install the Busselton apps. It's fine for a single build in a pinch.

## Checking it (first time on the rig)

This was written without a Windows machine to run it on, so the first run is the test:

1. `"\\media\busselton-share\Install Busselton.cmd" -DryRun`: it finds AC and lists every build as "would install".
2. Double-click it: everything installs, the summary lists each track, and the apps are in `<AC>\apps\lua`.
3. Double-click it again: "Nothing new in the share".
4. `-InstallTask`, log out and in: a notification after about a minute (or nothing, if nothing's new; the log says what it did).

If something goes wrong, the window (or the log) says which zip and why. Report it as usual in the share's `reports\`.
