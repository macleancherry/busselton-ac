<#
  The Busselton share: the one place files move between the laptop session, the workstation and the
  rig. Dot-source it (. "$PSScriptRoot\share.ps1") and call Get-BusseltonShare.

  Layout (made on first use):
    builds\    track zips from the laptop session, <slug>.zip (the newest build of each track)
    tests\     one folder and zip per automatic run: <date>_<time>-<slug>-<layout>
    bakes\     one log per AO bake, with its time: <date>_<time>-<track>.log
    reports\   reports for the laptop session (<date>-<topic>.md) and anything they point to,
               e.g. reports\<date>-<topic>\tuart_cm.bin
    snapshots\ each track's frozen inputs, <slug>-<date>.zip (scripts/snapshot/snapshot.mjs): what its
               base is rebuilt from. Keep them; they're the only copy outside the cloud workspace.
    rig\       the rig's installer kit (rig-install.ps1 -PublishKit), run by "Install Busselton.cmd" in
               the top folder; docs/rig-install.md

  Where it is: BUSSELTON_SHARE, else the older BUSSELTON_TEST_SHARE, else D:\busselton-share on the
  machine that hosts it, else \\media\busselton-share (its network address) from any other machine.
#>
function Get-BusseltonShare {
  $root = $env:BUSSELTON_SHARE
  if (-not $root) { $root = $env:BUSSELTON_TEST_SHARE }
  if (-not $root) {
    $root = @("D:\busselton-share", "\\media\busselton-share") | Where-Object { Test-Path $_ } | Select-Object -First 1
  }
  if (-not $root -or -not (Test-Path $root)) { return $null }
  # Made on first use. A machine that can only read the share (the rig, say) just skips this.
  try {
    foreach ($d in "builds", "tests", "bakes", "reports", "snapshots") {
      $p = Join-Path $root $d
      if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -ErrorAction Stop | Out-Null }
    }
  } catch { }
  $readme = Join-Path $root "README.txt"
  if (-not (Test-Path $readme)) {
    try { Set-Content $readme -ErrorAction Stop @"
Busselton share (made by scripts\windows\share.ps1; layout explained there).
builds\   track zips from the laptop session: <slug>.zip
tests\    automatic AI runs: <date>_<time>-<slug>-<layout> (folder and zip)
bakes\    AO bake logs with their times
reports\  reports for the laptop session, and files they point to
snapshots\ each track's frozen inputs (keep them)
rig\      the rig's one-click installer: double-click "Install Busselton.cmd" in the share's top folder
"@ } catch { }
  }
  return (Resolve-Path $root).ProviderPath
}

# A track's zip in the share's builds folder, by slug (or a path, returned as is).
function Resolve-BusseltonZip([string]$track) {
  if (-not $track) { return $null }
  if (Test-Path $track) { return (Resolve-Path $track).Path }
  $share = Get-BusseltonShare
  if (-not $share) { throw "No share (set BUSSELTON_SHARE), and $track isn't a file." }
  $zip = Join-Path $share "builds\$track.zip"
  if (-not (Test-Path $zip)) {
    $have = (Get-ChildItem (Join-Path $share "builds") -Filter *.zip | ForEach-Object BaseName) -join ", "
    throw "No $zip. In the share's builds folder: $have"
  }
  return $zip
}
