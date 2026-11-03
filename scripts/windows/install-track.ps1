<#
.SYNOPSIS
  Install a track into this PC's Assetto Corsa, and optionally copy it to the gaming rig.
  Usually from a zip built in the laptop's Claude session (-Zip). It can also build from
  a route file here, but code and route changes are never made on this machine (see CLAUDE.md).

.EXAMPLE
  .\scripts\windows\install-track.ps1 -Zip busselton            # <share>\builds\busselton.zip, exactly
  .\scripts\windows\install-track.ps1 -Zip busselton_roadcore   # a variant, by its own name (installs as busselton)
  .\scripts\windows\install-track.ps1 -Zip busselton -RigTracks \\GAMINGRIG\tracks
  .\scripts\windows\install-track.ps1 -All                       # every <slug>.zip in <share>\builds, then polish
  .\scripts\windows\install-track.ps1 -Zip C:\somewhere\busselton_foreshore.zip
  .\scripts\windows\install-track.ps1 routes\foreshore.json
  .\scripts\windows\install-track.ps1 routes\foreshore.json -RigTracks \\GAMINGRIG\tracks
  .\scripts\windows\install-track.ps1 routes\foreshore.json -SkipBuild    # reinstall the last build

.NOTES
  Run from the repo folder. Needs Node.js and Python 3 (numpy, pillow) on PATH, and
  `npx playwright install chromium` done once.
  -RigTracks is the rig's assettocorsa\content\tracks folder, shared on the network.
  Set it once with:  setx BUSSELTON_RIG_TRACKS \\GAMINGRIG\tracks
#>
param(
  [string]$Route,
  [string]$Zip,
  [string]$AcPath = $env:BUSSELTON_AC_PATH,
  [string]$RigTracks = $env:BUSSELTON_RIG_TRACKS,
  [switch]$SkipBuild,
  [switch]$SkipCheck,
  # Install each track's build (<slug>.zip) in the share's builds folder, then newer polish zips over them.
  [switch]$All,
  # Unzip over the installed track without removing it first: for a polish zip (landmarks as layers,
  # scripts/polish/landmarks.ts) on top of an installed base. The AO bake stays (or the one made for
  # base plus this polish comes back).
  [switch]$Overlay
)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).ProviderPath   # plain path, also when run from the share (UNC)
Set-Location $repo

# Find-AssettoCorsa (Steam libraries, then Content Manager settings) and Install-BusseltonApps.
. (Join-Path $PSScriptRoot "ac.ps1")

if (-not $AcPath) { $AcPath = Find-AssettoCorsa }
if (-not $AcPath -or -not (Test-Path (Join-Path $AcPath "content\tracks"))) {
  throw "Couldn't find Assetto Corsa (looked in Steam's libraries and Content Manager's settings). Pass -AcPath 'D:\SteamLibrary\steamapps\common\assettocorsa' or set BUSSELTON_AC_PATH."
}
if (Get-Command py -ErrorAction SilentlyContinue) { $pyExe = "py"; $pyArgs = @("-3") } else { $pyExe = "python"; $pyArgs = @() }
. (Join-Path $PSScriptRoot "share.ps1")
if ($All) {
  $share = Get-BusseltonShare
  if (-not $share) { throw "No share: set BUSSELTON_SHARE." }
  # Each track's build, <slug>.zip, then the newest polish of each (<slug>_polish*.zip), laid over its
  # build when it's newer than the build. Variants holding the same folder (busselton_roadcore.zip)
  # are skipped: they'd replace the track's own build (retest 6). Install one by name if wanted.
  $builds = Join-Path $share "builds"
  foreach ($v in @(Get-BusseltonBuilds $builds -Variants)) {
    Write-Host "Skipping $($v.File.Name): a variant of $($v.Slug), not $($v.Slug).zip (install it with -Zip $($v.File.BaseName))." -ForegroundColor DarkGray
  }
  $bases = @(Get-BusseltonBuilds $builds)
  foreach ($b in $bases) {
    & $PSCommandPath -Zip $b.File.FullName -AcPath $AcPath -RigTracks $RigTracks
  }
  foreach ($p in @(Get-BusseltonBuilds $builds -Polish)) {
    $base = $bases | Where-Object { $_.Slug -eq $p.Slug } | Select-Object -First 1
    if ($base -and $p.File.LastWriteTimeUtc -le $base.File.LastWriteTimeUtc) {
      Write-Host "Skipping $($p.File.Name): older than the $($p.Slug) build, which already has its landmarks." -ForegroundColor DarkGray
      continue
    }
    & $PSCommandPath -Zip $p.File.FullName -AcPath $AcPath -RigTracks $RigTracks -Overlay
  }
  return
}
if (-not $Route -and -not $Zip) { throw "Pass -Zip <slug or track.zip> (usual), -All, or a route file." }
if ($Zip) { $Zip = Resolve-BusseltonZip $Zip }

if ($Zip) {
  # A finished build: the zip's top folder is the track's slug (the file may have been renamed on download).
  $zip = (Resolve-Path $Zip).Path
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($zip)
  try { $slug = ($archive.Entries[0].FullName -split '[/\\]')[0] } finally { $archive.Dispose() }
  $SkipBuild = $true
  $SkipCheck = $true
} else {
$routeName = [IO.Path]::GetFileName($Route)

# 1. Build
if (-not $SkipBuild) {
  Write-Host "Building $routeName ..." -ForegroundColor Cyan
  node scripts\headless\build-track.mjs $Route
  if ($LASTEXITCODE -ne 0) { throw "Build failed." }
}

# The newest stats file written for this route names the slug.
$stats = Get-ChildItem out\*.stats.json | Sort-Object LastWriteTime -Descending |
  Where-Object { (Get-Content $_ -Raw | ConvertFrom-Json).route -eq $routeName } | Select-Object -First 1
if (-not $stats) { throw "No build found in out\ for $routeName." }
$slug = $stats.Name -replace '\.stats\.json$', ''
$zip = Join-Path $repo "out\$slug.zip"

# 2. Check
if (-not $SkipCheck) {
  Write-Host "Checking $slug ..." -ForegroundColor Cyan
  & $pyExe @pyArgs -I scripts\check\check_build.py "out\$slug.centreline.json"
  if ($LASTEXITCODE -ne 0) { throw "Check failed: see out\$slug.overlay.png." }
}
}

# 3. Install here, then on the rig.
function Install-Into([string]$tracks) {
  $dest = Join-Path $tracks $slug
  $tmp = Join-Path $env:TEMP "busselton-$slug"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp
  # AO bakes (*.vao-patch, bake-vao.ps1) are kept per build, keyed by the geometry they were baked
  # on (share.ps1 Save-BusseltonVao): the installed bake is kept before anything is replaced, and
  # the bake for the new geometry, if one was ever made, comes back after.
  $hadBake = (Test-Path $dest) -and (@(Get-ChildItem $dest -Filter *.vao-patch -ErrorAction SilentlyContinue).Count -gt 0)
  if ($hadBake) {
    $oldKey = Save-BusseltonVao $dest $slug
    if ($oldKey) { Write-Host "Kept the installed AO bake for its build (geometry $oldKey)." }
  }
  if ($Overlay) {
    if (-not (Test-Path $dest)) { Remove-Item $tmp -Recurse -Force; throw "No $slug installed in $tracks to lay the polish over: install its base first." }
    Copy-Item (Join-Path (Join-Path $tmp $slug) "*") $dest -Recurse -Force
    Remove-Item $tmp -Recurse -Force
    Write-BusseltonInstallMark $dest $zip -Polish
    $from = Restore-BusseltonVao $dest $slug
    if ($from) { Write-Host "Polish laid over $dest, with the AO bake made for this build ($from)." -ForegroundColor Green }
    else { Write-Host "Polish laid over $dest (rebake AO to shade what's new)." -ForegroundColor Green }
    return
  }
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  Copy-Item (Join-Path $tmp $slug) $dest -Recurse
  Remove-Item $tmp -Recurse -Force
  $from = Restore-BusseltonVao $dest $slug
  if ($from) { Write-Host "AO bake for this build put back ($from)." -ForegroundColor Green }
  elseif ($hadBake) {
    Write-Warning "No AO bake for this build yet: the installed one was for other geometry (it's kept, and comes back when that build is installed again). Bake with scripts\windows\bake-vao.ps1 -Track $slug."
  }
  # Which zip this came from (share.ps1), so rig-install.ps1 knows it's up to date.
  Write-BusseltonInstallMark $dest $zip
  Write-Host "Installed $slug -> $dest" -ForegroundColor Green
}
Install-Into (Join-Path $AcPath "content\tracks")
if ($RigTracks) {
  if (Test-Path $RigTracks) { Install-Into $RigTracks }
  else { Write-Warning "Rig share $RigTracks isn't reachable; skipped. Is the rig on?" }
}
# The Busselton apps: Challenges (checkpoints against the clock) and Map (every street, you on it).
# Each build ships what they read (data/challenges.ini, extension/street_map.*).
# On the rig too, when its share is reachable: its tracks folder is <AC>\content\tracks, so the apps
# go two folders up from it, in <AC>\apps\lua.
$acRoots = @($AcPath)
if ($RigTracks -and (Test-Path $RigTracks)) { $acRoots += (Split-Path (Split-Path $RigTracks -Parent) -Parent) }
foreach ($root in $acRoots) {
  foreach ($r in (Install-BusseltonApps $repo $root)) {
    if ($r.Error) { Write-Warning "Couldn't install the $($r.Name) app to $($r.Dest) ($($r.Error)). Copy apps\lua\$($r.Name) there by hand." }
    elseif ($r.Changed) { Write-Host "Installed the $($r.Name) app -> $($r.Dest)" -ForegroundColor Green }
    else { Write-Host "The $($r.Name) app is up to date in $($r.Dest)" }
  }
}
Write-Host "Done. In Content Manager, refresh the track list (or restart it) to see $slug."
Write-Host "In game, open Busselton Challenges (checkpoints, time trials, drift spots) or Busselton Map from the apps bar on the right."
