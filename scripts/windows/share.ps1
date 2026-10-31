<#
  The Busselton share: the one place files move between the laptop session, the workstation and the
  rig. Dot-source it (. "$PSScriptRoot\share.ps1") and call Get-BusseltonShare.

  Layout (made on first use):
    builds\    track zips from the laptop session, <slug>.zip (the newest build of each track). When
               two zips hold the same track folder (a renamed download, busselton_1.zip next to
               busselton.zip), the scripts take the newest (Get-BusseltonBuilds, Resolve-BusseltonZip).
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

# The track folder a zip holds: its first entry's top folder (the zip's own name can differ, e.g.
# busselton_1.zip holds "busselton"). $null for an empty zip; throws if it can't be opened.
function Get-ZipTrackFolder([string]$path) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $a = [IO.Compression.ZipFile]::OpenRead($path)
  try {
    if ($a.Entries.Count -eq 0) { return $null }
    return (($a.Entries[0].FullName -replace '\\', '/') -split '/')[0]
  } finally { $a.Dispose() }
}

# A polish zip (<slug>_polish*.zip): landmarks laid over an installed track, not a whole build.
function Test-PolishZip($file) { return [bool]($file.BaseName -match '_polish') }

# From objects with Slug, File (a FileInfo) and Polish: the newest file per track folder, base builds
# and polish zips apart, each with Older = the other objects holding the same folder (oldest first).
# Two zips can hold the same folder when a download gets renamed (busselton.zip and busselton_1.zip).
function Select-NewestPerTrack($items) {
  $list = @($items | Where-Object { $_ })
  if (-not $list.Count) { return }
  foreach ($g in ($list | Group-Object { "$([bool]$_.Polish)|$($_.Slug)" } | Sort-Object Name)) {
    $all = @($g.Group | Sort-Object { $_.File.LastWriteTimeUtc }, { $_.File.Name })
    $pick = $all[$all.Count - 1]
    $older = @()
    if ($all.Count -gt 1) { $older = @($all[0..($all.Count - 2)]) }
    $pick | Add-Member -NotePropertyName Older -NotePropertyValue $older -Force
    $pick
  }
}

# The newest zip per track folder in a builds folder (base builds; -Polish for the polish zips): one
# object per track with Slug, File, Polish and Older. Zips that can't be opened are left out.
function Get-BusseltonBuilds([string]$builds, [switch]$Polish) {
  $items = foreach ($z in @(Get-ChildItem -LiteralPath $builds -Filter *.zip -File -ErrorAction SilentlyContinue)) {
    if ((Test-PolishZip $z) -ne [bool]$Polish) { continue }
    $slug = $null
    try { $slug = Get-ZipTrackFolder $z.FullName } catch { continue }
    if ($slug) { New-Object PSObject -Property @{ Slug = $slug; File = $z; Polish = [bool]$Polish } }
  }
  Select-NewestPerTrack $items
}

# A track's zip in the share's builds folder (or a path, returned as is). A track folder name gets the
# newest build holding that folder, whatever the zip is called; otherwise a zip's own name
# (busselton_1, busselton_polish).
function Resolve-BusseltonZip([string]$track) {
  if (-not $track) { return $null }
  if (Test-Path $track) { return (Resolve-Path $track).Path }
  $share = Get-BusseltonShare
  if (-not $share) { throw "No share (set BUSSELTON_SHARE), and $track isn't a file." }
  $builds = Join-Path $share "builds"
  $hit = @(Get-BusseltonBuilds $builds | Where-Object { $_.Slug -eq $track })
  if ($hit.Count) {
    $b = $hit[0]
    if ($b.Older.Count) {
      $names = @($b.Older | ForEach-Object { $_.File.Name }) + $b.File.Name
      Write-Host "${track}: using $($b.File.Name), the newest of $($names -join ', ') (all hold the folder $track)." -ForegroundColor Yellow
    }
    return $b.File.FullName
  }
  $zip = Join-Path $builds "$track.zip"
  if (-not (Test-Path $zip)) {
    $have = (Get-ChildItem $builds -Filter *.zip | ForEach-Object BaseName) -join ", "
    throw "No build of $track in $builds. There: $have"
  }
  return $zip
}

# Which zip an installed track came from: <track folder>\installed_from.txt, written by
# install-track.ps1 after each install (zip=, ticks=, size=, time=; polish_zip= etc. for a polish laid
# over it). rig-install.ps1 compares it with the share, so a track already installed from a zip isn't
# reported as new on any machine.
$BusseltonInstallMark = "installed_from.txt"

function Read-BusseltonInstallMark([string]$dest) {
  $m = @{}
  $f = Join-Path $dest $BusseltonInstallMark
  if (Test-Path -LiteralPath $f) {
    foreach ($l in (Get-Content -LiteralPath $f -ErrorAction SilentlyContinue)) {
      if ($l -match '^\s*([a-z_]+)\s*=(.*)$') { $m[$Matches[1]] = $Matches[2].Trim() }
    }
  }
  return $m
}

function Write-BusseltonInstallMark([string]$dest, [string]$zipPath, [switch]$Polish) {
  $z = Get-Item -LiteralPath $zipPath
  # A new build starts a fresh record (its polish goes with the old files); a polish adds to it.
  $m = @{}
  if ($Polish) { $m = Read-BusseltonInstallMark $dest }
  $p = if ($Polish) { "polish_" } else { "" }
  $m["${p}zip"] = $z.Name
  $m["${p}ticks"] = "$($z.LastWriteTimeUtc.Ticks)"
  $m["${p}size"] = "$($z.Length)"
  $m["${p}time"] = $z.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
  $lines = @("; The zip this track was installed from (scripts\windows\install-track.ps1). rig-install.ps1 reads it.")
  foreach ($k in @("zip", "ticks", "size", "time", "polish_zip", "polish_ticks", "polish_size", "polish_time")) {
    if ($m.ContainsKey($k)) { $lines += "$k=$($m[$k])" }
  }
  Set-Content -LiteralPath (Join-Path $dest $BusseltonInstallMark) -Value $lines -Encoding ASCII
}

# $true when the installed track (or its polish, -Polish) came from this very zip: same name, time and size.
# $null when the track has no record of it (installed before installed_from.txt existed).
function Test-BusseltonInstallMark([string]$dest, $file, [switch]$Polish) {
  $m = Read-BusseltonInstallMark $dest
  $p = if ($Polish) { "polish_" } else { "" }
  if (-not $m.ContainsKey("${p}zip")) { return $null }
  return ($m["${p}zip"] -eq $file.Name -and $m["${p}ticks"] -eq "$($file.LastWriteTimeUtc.Ticks)" -and $m["${p}size"] -eq "$($file.Length)")
}
