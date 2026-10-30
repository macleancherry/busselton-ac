<#
.SYNOPSIS
  Install a track into this PC's Assetto Corsa, and optionally copy it to the gaming rig.
  Usually from a zip built in the laptop's Claude session (-Zip). It can also build from
  a route file here, but code and route changes are never made on this machine (see CLAUDE.md).

.EXAMPLE
  .\scripts\windows\install-track.ps1 -Zip busselton            # <share>\builds\busselton.zip
  .\scripts\windows\install-track.ps1 -Zip busselton -RigTracks \\GAMINGRIG\tracks
  .\scripts\windows\install-track.ps1 -All                       # every zip in <share>\builds
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
  # Install every track zip in the share's builds folder.
  [switch]$All,
  # Unzip over the installed track without removing it first: for a polish zip (landmarks as layers,
  # scripts/polish/landmarks.ts) on top of an installed base. The AO bake stays.
  [switch]$Overlay
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repo

function Find-AssettoCorsa {
  $steam = (Get-ItemProperty -Path "HKCU:\Software\Valve\Steam" -Name SteamPath -ErrorAction SilentlyContinue).SteamPath
  $libs = @()
  if ($steam) {
    $libs += $steam
    $vdf = Join-Path $steam "steamapps\libraryfolders.vdf"
    if (Test-Path $vdf) {
      $libs += (Select-String -Path $vdf -Pattern '"path"\s+"([^"]+)"' -AllMatches).Matches |
        ForEach-Object { $_.Groups[1].Value -replace '\\\\', '\' }
    }
  }
  foreach ($lib in ($libs | Select-Object -Unique)) {
    $p = Join-Path $lib "steamapps\common\assettocorsa"
    if (Test-Path (Join-Path $p "content\tracks")) { return $p }
  }
  return $null
}

if (-not $AcPath) { $AcPath = Find-AssettoCorsa }
if (-not $AcPath -or -not (Test-Path (Join-Path $AcPath "content\tracks"))) {
  throw "Couldn't find Assetto Corsa. Pass -AcPath 'D:\SteamLibrary\steamapps\common\assettocorsa' or set BUSSELTON_AC_PATH."
}
if (Get-Command py -ErrorAction SilentlyContinue) { $pyExe = "py"; $pyArgs = @("-3") } else { $pyExe = "python"; $pyArgs = @() }
. (Join-Path $PSScriptRoot "share.ps1")
if ($All) {
  $share = Get-BusseltonShare
  if (-not $share) { throw "No share: set BUSSELTON_SHARE." }
  foreach ($z in Get-ChildItem (Join-Path $share "builds") -Filter *.zip) {
    & $PSCommandPath -Zip $z.FullName -AcPath $AcPath -RigTracks $RigTracks
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
  if ($Overlay) {
    if (-not (Test-Path $dest)) { Remove-Item $tmp -Recurse -Force; throw "No $slug installed in $tracks to lay the polish over: install its base first." }
    Copy-Item (Join-Path (Join-Path $tmp $slug) "*") $dest -Recurse -Force
    Remove-Item $tmp -Recurse -Force
    Write-Host "Polish laid over $dest (rebake AO to shade what's new)." -ForegroundColor Green
    return
  }
  # An AO bake (*.vao-patch, scripts/windows/bake-vao.ps1) matches the geometry it was baked on:
  # keep it when every kn5 is the same as before, so reinstalling the same build doesn't need a rebake.
  $keep = Join-Path $env:TEMP "busselton-vao-$slug"
  if (Test-Path $keep) { Remove-Item $keep -Recurse -Force }
  $sameGeometry = $false
  if (Test-Path $dest) {
    $patches = @(Get-ChildItem $dest -Filter *.vao-patch -ErrorAction SilentlyContinue)
    if ($patches) {
      $hashes = { param($dir) (Get-ChildItem $dir -Filter *.kn5 | Sort-Object Name | ForEach-Object { "$($_.Name)=$((Get-FileHash $_.FullName -Algorithm SHA1).Hash)" }) -join ";" }
      $sameGeometry = (& $hashes $dest) -eq (& $hashes (Join-Path $tmp $slug))
      if ($sameGeometry) {
        New-Item -ItemType Directory -Path $keep | Out-Null
        $patches | Copy-Item -Destination $keep
      } else {
        Write-Warning "New geometry: the AO bake for $slug no longer fits and was removed. Bake again with scripts\windows\bake-vao.ps1 -Track $slug."
      }
    }
    Remove-Item $dest -Recurse -Force
  }
  Copy-Item (Join-Path $tmp $slug) $dest -Recurse
  Remove-Item $tmp -Recurse -Force
  if ($sameGeometry) {
    Copy-Item (Join-Path $keep "*") $dest
    Remove-Item $keep -Recurse -Force
    Write-Host "Same geometry as before: kept the AO bake." -ForegroundColor Green
  }
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
  foreach ($name in @("BusseltonChallenges", "BusseltonMap")) {
    $app = Join-Path $repo "apps\lua\$name"
    if (-not (Test-Path $app)) { continue }
    $appDest = Join-Path $root "apps\lua\$name"
    try {
      New-Item -ItemType Directory -Force -Path $appDest -ErrorAction Stop | Out-Null
      Copy-Item (Join-Path $app "*") $appDest -Recurse -Force -ErrorAction Stop
      Write-Host "Installed the $name app -> $appDest" -ForegroundColor Green
    } catch {
      Write-Warning "Couldn't install the $name app to $appDest ($($_.Exception.Message)). Copy apps\lua\$name there by hand."
    }
  }
}
Write-Host "Done. In Content Manager, refresh the track list (or restart it) to see $slug."
Write-Host "In game, open Busselton Challenges (checkpoints, time trials, drift spots) or Busselton Map from the apps bar on the right."
