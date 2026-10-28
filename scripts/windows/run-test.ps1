<#
.SYNOPSIS
  Automatic test run on the workstation: install a build, start a practice session with the AI
  driving the player's car, let the track's test script log the drive and take screenshots, then
  collect logs, screenshots, the replay and the results into a shared folder.

.EXAMPLE
  .\scripts\windows\run-test.ps1 -Zip $HOME\Downloads\busselton_foreshore.zip
  .\scripts\windows\run-test.ps1 -Zip $HOME\Downloads\busselton_foreshore.zip -Car ks_mazda_mx5_nd -Minutes 10

.NOTES
  Runs code from the repo, never edits it (see CLAUDE.md). Needs the build to have traffic on (the
  test script ships with it) and CSP installed.
  -Share is where results go; set it once with:  setx BUSSELTON_TEST_SHARE \\NAS\busselton-tests
  The car comes from the last session Content Manager started, unless -Car is given.
  Close AC before running. The script restores race.ini afterwards.
#>
param(
  [Parameter(Mandatory = $true)][string]$Zip,
  [string]$Car,
  [int]$Minutes = 9,
  [string]$Share = $env:BUSSELTON_TEST_SHARE,
  [string]$AcPath = $env:BUSSELTON_AC_PATH
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$docs = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Assetto Corsa"
$raceIni = Join-Path $docs "cfg\race.ini"
if (-not (Test-Path $raceIni)) { throw "No $raceIni yet: start any session once from Content Manager first." }
if (Get-Process acs -ErrorAction SilentlyContinue) { throw "Assetto Corsa is running: close it first." }

# 1. Install (same script as a normal install).
& (Join-Path $PSScriptRoot "install-track.ps1") -Zip $Zip -AcPath $AcPath
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path $Zip).Path)
try { $slug = ($archive.Entries[0].FullName -split '[/\\]')[0] } finally { $archive.Dispose() }
if (-not $AcPath) {
  $steam = (Get-ItemProperty -Path "HKCU:\Software\Valve\Steam" -Name SteamPath -ErrorAction SilentlyContinue).SteamPath
  $AcPath = Join-Path $steam "steamapps\common\assettocorsa"
}
if (-not (Test-Path (Join-Path $AcPath "content\tracks\$slug\extension\autotest.lua"))) {
  throw "This build has no test script (extension\autotest.lua). Builds need traffic on."
}

# 2. A practice session for one car, the test driver at the wheel.
function Set-Ini([string[]]$lines, [string]$section, [string]$key, [string]$value) {
  $out = New-Object System.Collections.Generic.List[string]
  $in = $false; $done = $false; $seen = $false
  foreach ($l in $lines) {
    if ($l -match '^\s*\[(.+)\]\s*$') {
      if ($in -and -not $done) { $out.Add("$key=$value"); $done = $true }
      $in = ($Matches[1] -eq $section); if ($in) { $seen = $true }
    } elseif ($in -and $l -match "^\s*$([regex]::Escape($key))\s*=") { $out.Add("$key=$value"); $done = $true; continue }
    $out.Add($l)
  }
  if ($in -and -not $done) { $out.Add("$key=$value"); $done = $true }
  if (-not $seen) { $out.Add(""); $out.Add("[$section]"); $out.Add("$key=$value") }
  return ,$out.ToArray()
}
$backup = "$raceIni.before-test"
Copy-Item $raceIni $backup -Force
$ini = Get-Content $raceIni
# Only the first session, as practice.
$ini = @($ini | ForEach-Object -Begin { $skip = $false } -Process {
  if ($_ -match '^\s*\[SESSION_[1-9]\d*\]') { $skip = $true } elseif ($_ -match '^\s*\[') { $skip = $false }
  if (-not $skip) { $_ }
})
foreach ($kv in @(
  @("RACE", "TRACK", $slug), @("RACE", "CONFIG_TRACK", ""), @("RACE", "CARS", "1"), @("RACE", "AI_LEVEL", "100"),
  @("CAR_0", "DRIVER_NAME", "Busselton Test"),
  @("SESSION_0", "NAME", "Practice"), @("SESSION_0", "TYPE", "1"), @("SESSION_0", "DURATION_MINUTES", "30"), @("SESSION_0", "SPAWN_SET", "START"),
  @("REMOTE", "ACTIVE", "0"), @("REPLAY", "ACTIVE", "0"), @("AUTOSPAWN", "ACTIVE", "1")
)) { $ini = Set-Ini $ini $kv[0] $kv[1] $kv[2] }
if ($Car) { $ini = Set-Ini $ini "RACE" "MODEL" $Car; $ini = Set-Ini $ini "CAR_0" "MODEL" "-" }
Set-Content -Path $raceIni -Value $ini -Encoding ASCII
$used = Join-Path $env:TEMP "race.ini.used"
Copy-Item $raceIni $used -Force

# 3. Drive: AC quits itself when the run ends; this waits a little longer, then closes it.
$started = Get-Date
Write-Host "Starting $slug with the AI driving (up to $Minutes min) ..." -ForegroundColor Cyan
try {
  $proc = Start-Process -FilePath (Join-Path $AcPath "acs.exe") -WorkingDirectory $AcPath -PassThru
  if (-not $proc.WaitForExit(($Minutes + 2) * 60 * 1000)) {
    Write-Host "Still running after $Minutes min: closing AC." -ForegroundColor Yellow
    Stop-Process -Id $proc.Id -Force
  }
} finally {
  Copy-Item $backup $raceIni -Force
}
Start-Sleep -Seconds 3

# 4. Collect.
$stamp = $started.ToString("yyyy-MM-dd_HHmm")
$base = if ($Share -and (Test-Path $Share)) { $Share } else { Join-Path $repo "reports" }
$dest = Join-Path $base "$stamp-$slug"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $docs "logs") (Join-Path $dest "logs") -Recurse -Force -ErrorAction SilentlyContinue
$screens = Get-ChildItem (Join-Path $docs "screens") -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $started }
if ($screens) { New-Item -ItemType Directory -Force -Path (Join-Path $dest "screens") | Out-Null; $screens | Copy-Item -Destination (Join-Path $dest "screens") }
$replay = Get-ChildItem (Join-Path $docs "replay\temp") -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $started } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($replay) { Copy-Item $replay.FullName $dest }
Copy-Item (Join-Path $docs "out\race_out.json") $dest -ErrorAction SilentlyContinue
Copy-Item $used (Join-Path $dest "race.ini.used") -ErrorAction SilentlyContinue

# The drive log: every "BTEST," line the test script wrote, wherever CSP put it.
$lines = Get-ChildItem (Join-Path $dest "logs") -Recurse -File | Select-String -Pattern 'BTEST,' | ForEach-Object { $_.Line -replace '^.*?BTEST,', 'BTEST,' }
"kind,time,spline,x,y,z,kmh,wheels_on_road,ai,note" | Set-Content (Join-Path $dest "btest.csv")
$lines | ForEach-Object { $_ -replace '^BTEST,', '' } | Add-Content (Join-Path $dest "btest.csv")
$finish = $lines | Where-Object { $_ -match '^BTEST,finish' } | Select-Object -Last 1
$off = ($lines | Where-Object { $_ -match '^BTEST,offroad' }).Count
$start = $lines | Where-Object { $_ -match '^BTEST,start' } | Select-Object -First 1

# One zip of the lot, to attach in the laptop session.
$zipOut = "$dest.zip"
if (Test-Path $zipOut) { Remove-Item $zipOut }
[IO.Compression.ZipFile]::CreateFromDirectory($dest, $zipOut)

Write-Host ""
Write-Host "Test run: $slug" -ForegroundColor Green
Write-Host ("  started:   " + ($(if ($start) { $start } else { "no BTEST lines: the test script didn't run (check logs\custom_shaders_patch.log for autotest.lua)" })))
Write-Host ("  finished:  " + ($(if ($finish) { $finish } else { "no finish line (timed out or crashed)" })))
Write-Host "  off-road events: $off"
Write-Host "  results:   $dest"
Write-Host "  zip:       $zipOut  (attach this in the laptop session)"
