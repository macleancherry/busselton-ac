<#
  The Busselton share: the one place files move between the laptop session, the workstation and the
  rig. Dot-source it (. "$PSScriptRoot\share.ps1") and call Get-BusseltonShare.

  Layout (made on first use):
    builds\    track zips from the laptop session: <slug>.zip is the track's build, named exactly after
               the track folder it holds, and <slug>_polish*.zip its polish. Other zips holding the
               same folder are variants (busselton_roadcore.zip, a renamed busselton_1.zip): the
               scripts install them only when named (-Zip busselton_roadcore, or a path), never for
               a slug or -All (retest 6: picking the newest put road core on as busselton).
    tests\     one folder and zip per automatic run: <date>_<time>-<slug>-<layout>
    bakes\     one log per AO bake, with its time: <date>_<time>-<track>.log; and bakes\vao\<slug>\<key>\,
               each bake's .vao-patch files kept per build (Save-BusseltonVao), so reinstalling a
               build brings its bake back, on any machine
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

# What a zip is, from its name and the track folder it holds: "base" for <slug>.zip, "polish" for
# <slug>_polish*.zip, "variant" for anything else (busselton_roadcore.zip, busselton_1.zip), which
# is only installed when asked for by its own name or path.
function Get-BuildZipKind($file, [string]$slug) {
  if (-not $slug) { return "variant" }
  if ($file.BaseName -eq $slug) { return "base" }
  if ($file.BaseName -match ('^' + [regex]::Escape($slug) + '_polish')) { return "polish" }
  return "variant"
}

# From objects with Slug, File (a FileInfo) and Polish: the newest file per track folder, base builds
# and polish zips apart, each with Older = the other objects holding the same folder (oldest first).
# Callers pass only base and polish zips (Get-BuildZipKind), so a base has one candidate; there can
# be several polish zips.
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

# Each track's build in a builds folder, <slug>.zip (-Polish: the newest <slug>_polish*.zip of each
# track): one object per track with Slug, File, Polish and Older. Variants (Get-BuildZipKind) are
# left out; -Variants lists them instead (Slug, File), for a "skipped" line. Zips that can't be
# opened are left out.
function Get-BusseltonBuilds([string]$builds, [switch]$Polish, [switch]$Variants) {
  $want = if ($Variants) { "variant" } elseif ($Polish) { "polish" } else { "base" }
  $items = foreach ($z in @(Get-ChildItem -LiteralPath $builds -Filter *.zip -File -ErrorAction SilentlyContinue)) {
    $slug = $null
    try { $slug = Get-ZipTrackFolder $z.FullName } catch { continue }
    if (-not $slug -or (Get-BuildZipKind $z $slug) -ne $want) { continue }
    New-Object PSObject -Property @{ Slug = $slug; File = $z; Polish = ($want -eq "polish") }
  }
  if ($Variants) { return $items }
  Select-NewestPerTrack $items
}

# A track's zip in the share's builds folder (or a path, returned as is): exactly <name>.zip. So
# "busselton" is busselton.zip and never busselton_roadcore.zip, which holds the same folder;
# "busselton_roadcore" is that variant, "busselton_polish" the polish.
function Resolve-BusseltonZip([string]$track) {
  if (-not $track) { return $null }
  if (Test-Path $track) { return (Resolve-Path $track).Path }
  $share = Get-BusseltonShare
  if (-not $share) { throw "No share (set BUSSELTON_SHARE), and $track isn't a file." }
  $builds = Join-Path $share "builds"
  $zip = Join-Path $builds "$track.zip"
  if (-not (Test-Path -LiteralPath $zip)) {
    $have = (Get-ChildItem $builds -Filter *.zip | ForEach-Object BaseName) -join ", "
    throw "No $track.zip in $builds. There: $have"
  }
  $folder = $null
  try { $folder = Get-ZipTrackFolder $zip } catch { }
  if ($folder -and $folder -ne $track) {
    Write-Host "${track}.zip holds the track folder ${folder}, so it installs as ${folder} (a variant of ${folder}.zip)." -ForegroundColor Yellow
  }
  return $zip
}

# AO bakes (*.vao-patch, bake-vao.ps1) fit the geometry they were baked on, so they're kept per build:
# <store>\<slug>\<key>\, the key a hash of every kn5 in the track folder (names and contents).
# Installing a build brings back the bake made on that same geometry (install-track.ps1), so
# installing road core and then base again doesn't lose base's bake (retest 6). Two stores: this PC's
# (%LOCALAPPDATA%\BusseltonAC\vao) and the share's bakes\vao, so a bake made on the workstation also
# reaches the rig. A store that can't be written (the rig may only read the share) is skipped.
function Get-BusseltonVaoStores {
  $s = @()
  if ($env:LOCALAPPDATA) { $s += (Join-Path $env:LOCALAPPDATA "BusseltonAC\vao") }
  $share = Get-BusseltonShare
  if ($share) { $s += (Join-Path $share "bakes\vao") }
  return $s
}

# The geometry key of an installed track folder: 16 hex digits, or $null with no kn5.
function Get-BusseltonGeometryKey([string]$dir) {
  $list = (Get-ChildItem -LiteralPath $dir -Filter *.kn5 -File -ErrorAction SilentlyContinue | Sort-Object Name |
      ForEach-Object { "$($_.Name)=$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA1).Hash)" }) -join ";"
  if (-not $list) { return $null }
  $sha = [Security.Cryptography.SHA1]::Create()
  try { $bytes = $sha.ComputeHash([Text.Encoding]::ASCII.GetBytes($list)) } finally { $sha.Dispose() }
  return ((($bytes | ForEach-Object { $_.ToString("x2") }) -join "").Substring(0, 16))
}

# Keeps the track folder's bake under its geometry key in every store. Returns the key, or $null
# when there's no bake. $key saves computing it again when the caller has it.
function Save-BusseltonVao([string]$dir, [string]$slug, [string]$key = "") {
  $patches = @(Get-ChildItem -LiteralPath $dir -Filter *.vao-patch -File -ErrorAction SilentlyContinue)
  if (-not $patches.Count) { return $null }
  if (-not $key) { $key = Get-BusseltonGeometryKey $dir }
  if (-not $key) { return $null }
  $from = Read-BusseltonInstallMark $dir
  foreach ($store in @(Get-BusseltonVaoStores)) {
    try {
      $d = Join-Path $store "$slug\$key"
      New-Item -ItemType Directory -Force -Path $d -ErrorAction Stop | Out-Null
      $patches | Copy-Item -Destination $d -Force -ErrorAction Stop
      $info = @("; An AO bake kept per build (share.ps1 Save-BusseltonVao).", "track=$slug", "key=$key",
        "saved=$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))", "build_zip=$($from['zip'])", "polish_zip=$($from['polish_zip'])")
      Set-Content -LiteralPath (Join-Path $d "bake.txt") -Value $info -Encoding ASCII -ErrorAction Stop
    } catch {
      Write-Host "  (couldn't keep the AO bake in ${store}: $($_.Exception.Message))" -ForegroundColor DarkGray
    }
  }
  return $key
}

# Copies the bake kept for the track folder's geometry into it. Returns where it came from, or $null
# when no store has one.
function Restore-BusseltonVao([string]$dir, [string]$slug) {
  $stores = @(Get-BusseltonVaoStores | Where-Object { Test-Path -LiteralPath (Join-Path $_ $slug) })
  if (-not $stores.Count) { return $null }
  $key = Get-BusseltonGeometryKey $dir
  if (-not $key) { return $null }
  foreach ($store in $stores) {
    $d = Join-Path $store "$slug\$key"
    $p = @(Get-ChildItem -LiteralPath $d -Filter *.vao-patch -File -ErrorAction SilentlyContinue)
    if ($p.Count) {
      $p | Copy-Item -Destination $dir -Force
      return $d
    }
  }
  return $null
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
