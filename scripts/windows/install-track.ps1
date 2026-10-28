<#
.SYNOPSIS
  Install a track into this PC's Assetto Corsa, and optionally copy it to the gaming rig.
  Usually from a zip built in the laptop's Claude session (-Zip). It can also build from
  a route file here, but code and route changes are never made on this machine (see CLAUDE.md).

.EXAMPLE
  .\scripts\windows\install-track.ps1 -Zip $HOME\Downloads\busselton_foreshore.zip
  .\scripts\windows\install-track.ps1 -Zip $HOME\Downloads\busselton_foreshore.zip -RigTracks \\GAMINGRIG\tracks
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
  [switch]$SkipCheck
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
if (-not $Route -and -not $Zip) { throw "Pass -Zip <track.zip> (usual) or a route file." }

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
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  Copy-Item (Join-Path $tmp $slug) $dest -Recurse
  Remove-Item $tmp -Recurse -Force
  Write-Host "Installed $slug -> $dest" -ForegroundColor Green
}
Install-Into (Join-Path $AcPath "content\tracks")
if ($RigTracks) {
  if (Test-Path $RigTracks) { Install-Into $RigTracks }
  else { Write-Warning "Rig share $RigTracks isn't reachable; skipped. Is the rig on?" }
}
Write-Host "Done. In Content Manager, refresh the track list (or restart it) to see $slug."
