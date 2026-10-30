<#
.SYNOPSIS
  Bake ambient occlusion (CSP's vertex AO patch) for an installed Busselton AC track.

.EXAMPLE
  .\scripts\windows\bake-vao.ps1 -Track busselton_and_broadwater
  .\scripts\windows\bake-vao.ps1 -Track busselton -Quality test

.NOTES
  Runs code from the repo, never edits it (see CLAUDE.md). Needs CSP's AO bakery: download
  bakeryoptix from https://github.com/ac-custom-shaders-patch/acc-bakeryoptix/releases, unzip it, and
  set its path once with:  setx BUSSELTON_BAKERY C:\Tools\bakeryoptix\bakeryoptix.exe
  It bakes on the GPU (Vulkan RT, fine on the RTX 4060) or falls back to the CPU.

  Every build ships baked_shadow_params.ini (the bakery's settings) in the track folder. The bakery
  writes <name>.vao-patch next to each models_<layout>.ini (one per layout), and CSP loads it by
  itself. Builds change the geometry, so bake again after installing each new build.
  Close AC first.
#>
param(
  [Parameter(Mandatory = $true)][string]$Track,
  [string]$Bakery = $env:BUSSELTON_BAKERY,
  [string]$AcPath = $env:BUSSELTON_AC_PATH,
  # test: quick (fewer rays); final: the default in the shipped settings.
  [ValidateSet("final", "test")][string]$Quality = "final"
)
$ErrorActionPreference = "Stop"
if (-not $Bakery -or -not (Test-Path $Bakery)) {
  throw "Set -Bakery or BUSSELTON_BAKERY to bakeryoptix.exe (download: https://github.com/ac-custom-shaders-patch/acc-bakeryoptix/releases)."
}
if (-not $AcPath) {
  $steam = (Get-ItemProperty -Path "HKCU:\Software\Valve\Steam" -Name SteamPath -ErrorAction SilentlyContinue).SteamPath
  $AcPath = Join-Path $steam "steamapps\common\assettocorsa"
}
if (Get-Process acs -ErrorAction SilentlyContinue) { throw "Assetto Corsa is running: close it first." }
$dir = Join-Path $AcPath "content\tracks\$Track"
if (-not (Test-Path $dir)) { throw "No track $Track in $AcPath\content\tracks (install it first)." }

# What to bake: each layout's models_<id>.ini; else models.ini; else the track's kn5.
$inputs = @(Get-ChildItem $dir -Filter "models_*.ini" | ForEach-Object FullName)
if (-not $inputs) { $inputs = @(Get-ChildItem $dir -Filter "models.ini" | ForEach-Object FullName) }
if (-not $inputs) { $inputs = @(Get-ChildItem $dir -Filter "$Track.kn5" | ForEach-Object FullName) }
if (-not $inputs) { throw "Nothing to bake in $dir." }

$params = Join-Path $dir "baked_shadow_params.ini"
$saved = $null
if ($Quality -eq "test" -and (Test-Path $params)) {
  # Only for this bake: the shipped settings are put back afterwards, so a later final bake is final.
  $saved = Get-Content $params -Raw
  ($saved -replace '(?m)^RAYS_PER_SAMPLE = \d+', 'RAYS_PER_SAMPLE = 32') | Set-Content $params -NoNewline
}

# The bakery waits for a key press after an error: give it an empty input so it ends instead.
$empty = New-TemporaryFile
$log = Join-Path $dir "vao-bake.log"
$usedSettings = Get-Content $params -ErrorAction SilentlyContinue
Write-Host "Baking $($inputs.Count) layout(s) of $Track ..."
$started = Get-Date
$p = Start-Process -FilePath $Bakery -ArgumentList ($inputs | ForEach-Object { "`"$_`"" }) `
  -WorkingDirectory $dir -NoNewWindow -Wait -PassThru `
  -RedirectStandardInput $empty -RedirectStandardOutput $log -RedirectStandardError "$log.err"
Remove-Item $empty
if ($null -ne $saved) { Set-Content $params $saved -NoNewline }
$mins = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
# The log and its time in the share's bakes folder, for the laptop session.
. (Join-Path $PSScriptRoot "share.ps1")
$share = Get-BusseltonShare
if ($share) {
  $sum = Join-Path $share ("bakes\" + $started.ToString("yyyy-MM-dd_HHmm") + "-$Track.log")
  $head = @("track: $Track", "quality: $Quality", "exit: $($p.ExitCode)", "minutes: $mins", "inputs: $($inputs -join ', ')",
    "settings used:", $usedSettings, "", "patches:",
    (Get-ChildItem $dir -Filter *.vao-patch | ForEach-Object { "$($_.Name) $($_.Length) bytes" }), "", "--- vao-bake.log ---")
  $head | Set-Content $sum
  Get-Content $log -ErrorAction SilentlyContinue | Add-Content $sum
  if ((Test-Path "$log.err") -and (Get-Item "$log.err").Length) { "--- vao-bake.log.err ---" | Add-Content $sum; Get-Content "$log.err" | Add-Content $sum }
  Write-Host "Bake log: $sum"
}
if ($p.ExitCode -ne 0) { throw "AO bake failed (exit $($p.ExitCode)) after $mins min; see $log" }
Write-Host "Baked in $mins min:" -ForegroundColor Green
Get-ChildItem $dir -Filter *.vao-patch | Format-Table Name, @{ n = "MB"; e = { [math]::Round($_.Length / 1MB, 1) } }, LastWriteTime
Write-Host "The time and log are in the share's bakes folder."
