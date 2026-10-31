<#
.SYNOPSIS
  One-click install for the gaming rig: every new build and polish zip in the share goes into this
  PC's Assetto Corsa, the Busselton apps come along, and it says what changed.
  Double-click rig-install.cmd (or "Install Busselton.cmd" in the share), which runs this.

.EXAMPLE
  .\scripts\windows\rig-install.ps1                 # install what's new in <share>\builds
  .\scripts\windows\rig-install.ps1 -DryRun         # only say what it would install
  .\scripts\windows\rig-install.ps1 -Force          # reinstall everything (AO bakes kept if the geometry is the same)
  .\scripts\windows\rig-install.ps1 -InstallTask    # also check the share each time you log in
  .\scripts\windows\rig-install.ps1 -RemoveTask
  .\scripts\windows\rig-install.ps1 -PublishKit     # from a repo checkout: copy this installer into <share>\rig

.NOTES
  Windows PowerShell 5.1. Each zip goes through install-track.ps1 (-Zip, and -Overlay for a polish
  zip), so AO bakes are kept the same way as on the workstation. Nothing else is needed on the rig:
  no Node, no Python, no repo (the kit in <share>\rig is enough).

  What's "new": the newest zip of each track folder (an older zip holding the same folder, like
  busselton.zip next to busselton_1.zip, is skipped) when the installed track didn't come from it.
  install-track.ps1 records the zip's name, time and size in the track folder (installed_from.txt,
  share.ps1), so a track installed from that zip by any script on this PC counts as up to date.
  Tracks installed before that record existed fall back to %LOCALAPPDATA%\BusseltonAC\installed.json.
  Polish zips are <slug>_polish*.zip: laid over the installed track, after its base, and only when
  they're newer than the base build (a base build already carries the landmarks it was built with).
  A note for Mac about a build goes next to it as builds\<zip name>.txt and is shown here.
  Docs: docs/rig-install.md.
#>
param(
  [string]$AcPath = $env:BUSSELTON_AC_PATH,
  [string]$Share,
  # Scheduled-task mode: no prompts, waits up to 3 minutes for the share, logs to
  # %LOCALAPPDATA%\BusseltonAC\rig-install.log and pops a notification when something changed.
  [switch]$Quiet,
  [switch]$DryRun,
  [switch]$Force,
  [switch]$InstallTask,
  [switch]$RemoveTask,
  [switch]$PublishKit
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $here "..\..")).ProviderPath
if ($Share) { $env:BUSSELTON_SHARE = $Share }
. (Join-Path $here "share.ps1")
. (Join-Path $here "ac.ps1")
$installTrack = Join-Path $here "install-track.ps1"
$stateDir = Join-Path $env:LOCALAPPDATA "BusseltonAC"
$stateFile = Join-Path $stateDir "installed.json"
$taskName = "Busselton tracks"

function Show-Notice([string]$title, [string]$text) {
  if (-not $Quiet) { return }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    if ($text.Length -gt 250) { $text = $text.Substring(0, 247) + "..." }
    $n = New-Object System.Windows.Forms.NotifyIcon
    $n.Icon = [System.Drawing.SystemIcons]::Information
    $n.BalloonTipTitle = $title
    $n.BalloonTipText = $text
    $n.Visible = $true
    $n.ShowBalloonTip(15000)
    Start-Sleep -Seconds 15
    $n.Dispose()
  } catch { }
}

function Close-Run([int]$code) {
  if ($Quiet) { try { Stop-Transcript | Out-Null } catch { } }
  exit $code
}

# ---------------------------------------------------------------------------------------------
# -PublishKit: copy the installer and the apps into <share>\rig, so the rig needs no repo.
if ($PublishKit) {
  $s = Get-BusseltonShare
  if (-not $s) { throw "No share: set BUSSELTON_SHARE or pass -Share." }
  $kit = Join-Path $s "rig"
  if ($repo -eq $kit) { throw "This is the kit in the share already: run -PublishKit from a repo checkout." }
  foreach ($d in "scripts\windows", "apps\lua") { New-Item -ItemType Directory -Force -Path (Join-Path $kit $d) | Out-Null }
  foreach ($f in "rig-install.ps1", "rig-install.cmd", "install-track.ps1", "share.ps1", "ac.ps1") {
    Copy-Item -LiteralPath (Join-Path $here $f) -Destination (Join-Path $kit "scripts\windows\$f") -Force
  }
  foreach ($a in "BusseltonChallenges", "BusseltonMap") {
    $src = Join-Path $repo "apps\lua\$a"
    if (-not (Test-Path -LiteralPath $src)) { continue }
    $dst = Join-Path $kit "apps\lua\$a"
    if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
    Copy-Item -LiteralPath $src -Destination $dst -Recurse
  }
  Copy-Item -LiteralPath (Join-Path $here "rig-install.cmd") -Destination (Join-Path $s "Install Busselton.cmd") -Force
  Write-Host "Kit published to $kit. On the rig, double-click $(Join-Path $s 'Install Busselton.cmd')." -ForegroundColor Green
  return
}

# ---------------------------------------------------------------------------------------------
# -InstallTask / -RemoveTask: check the share on log-in. A scheduled task when Windows allows it
# without admin, else a line in the Startup folder (same effect).
if ($InstallTask -or $RemoveTask) {
  $startup = Join-Path ([Environment]::GetFolderPath("Startup")) "Busselton tracks.cmd"
  if ($RemoveTask) {
    try {
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
      Write-Host "Removed the scheduled task '$taskName'."
    } catch { Write-Host "No scheduled task '$taskName' to remove." }
    if (Test-Path -LiteralPath $startup) {
      Remove-Item -LiteralPath $startup -Force
      Write-Host "Removed $startup."
    }
    return
  }
  $self = (Get-Item -LiteralPath $PSCommandPath).FullName
  $argLine = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$self`" -Quiet"
  if ($AcPath) { $argLine += " -AcPath `"$AcPath`"" }
  if ($Share) { $argLine += " -Share `"$Share`"" }
  try {
    $user = "$env:USERDOMAIN\$env:USERNAME"
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argLine
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $trigger.Delay = "PT1M"   # give the network a minute to come up
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
      -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
      -Description "Installs new Busselton AC builds from the share (scripts\windows\rig-install.ps1)." -Force -ErrorAction Stop | Out-Null
    if (Test-Path -LiteralPath $startup) { Remove-Item -LiteralPath $startup -Force }
    Write-Host "Scheduled task '$taskName' made: a minute after you log in it installs anything new and pops up a note." -ForegroundColor Green
  } catch {
    Write-Warning "Windows wouldn't make the scheduled task ($($_.Exception.Message)). Using the Startup folder instead."
    Set-Content -LiteralPath $startup -Encoding ASCII -Value "@echo off`r`nstart `"`" /min powershell.exe $argLine`r`n"
    Write-Host "Added ${startup}: each log-in it installs anything new and pops up a note." -ForegroundColor Green
  }
  Write-Host "It runs from $self, so keep that file where it is. Remove it with -RemoveTask."
  return
}

# ---------------------------------------------------------------------------------------------
# The install.
if ($Quiet) {
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  try { Start-Transcript -Path (Join-Path $stateDir "rig-install.log") -Force | Out-Null } catch { }
}
try {
  # The share (at log-in the network can take a while).
  $waitUntil = (Get-Date).AddMinutes($(if ($Quiet) { 3 } else { 0 }))
  while ($true) {
    $shareDir = Get-BusseltonShare
    if ($shareDir -or (Get-Date) -ge $waitUntil) { break }
    Start-Sleep -Seconds 10
  }
  if (-not $shareDir) {
    $msg = "Can't reach the share (\\media\busselton-share). Is the PC that hosts it on? Or set BUSSELTON_SHARE."
    Write-Host $msg -ForegroundColor Red
    Show-Notice "Busselton tracks" $msg
    Close-Run 1
  }
  $builds = Join-Path $shareDir "builds"

  if (-not $AcPath) { $AcPath = Find-AssettoCorsa }
  if (-not $AcPath -or -not (Test-Path -LiteralPath (Join-Path $AcPath "content\tracks"))) {
    $msg = "Couldn't find Assetto Corsa. Run again with -AcPath 'D:\SteamLibrary\steamapps\common\assettocorsa', or setx BUSSELTON_AC_PATH <that folder>."
    Write-Host $msg -ForegroundColor Red
    Show-Notice "Busselton tracks" $msg
    Close-Run 1
  }
  $tracks = Join-Path $AcPath "content\tracks"
  Write-Host "Share: $shareDir"
  Write-Host "AC:    $AcPath"

  if (-not $DryRun -and (Get-Process -Name "acs", "acs_x86" -ErrorAction SilentlyContinue)) {
    $msg = "Assetto Corsa is running: close it, then run this again (tracks can't be swapped while it has them open)."
    Write-Host $msg -ForegroundColor Yellow
    Show-Notice "Busselton tracks" $msg
    Close-Run 1
  }

  # What this PC installed last time.
  $state = @{}
  if (Test-Path -LiteralPath $stateFile) {
    try {
      $j = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
      foreach ($p in $j.PSObject.Properties) { $state[$p.Name] = [string]$p.Value }
    } catch { Write-Warning "Couldn't read $stateFile; treating everything as new." }
  }
  function Save-State {
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    $state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  function Read-ZipInfo($file) {
    $a = [IO.Compression.ZipFile]::OpenRead($file.FullName)
    try { $names = @($a.Entries | ForEach-Object { $_.FullName -replace '\\', '/' }) } finally { $a.Dispose() }
    if (-not $names.Count) { throw "it's empty" }
    $slug = ($names[0] -split '/')[0]
    $pat = '^' + [regex]::Escape($slug) + '/ui/([^/]+)/ui_track\.json$'
    $layouts = @($names | Where-Object { $_ -match $pat } | ForEach-Object { ($_ -split '/')[2] } | Sort-Object)
    if (-not $layouts.Count -and ($names -contains "$slug/ui/ui_track.json")) { $layouts = @("(one layout)") }
    New-Object PSObject -Property @{
      File = $file
      Slug = $slug
      Polish = ($file.BaseName -match '_polish')
      Layouts = $layouts
      Landmarks = @($names | Where-Object { $_ -match '/lm_[^/]+\.kn5$' }).Count
      Key = "$($file.LastWriteTimeUtc.Ticks)|$($file.Length)"
    }
  }
  function Get-InstalledLayouts([string]$dest) {
    $ui = Join-Path $dest "ui"
    if (-not (Test-Path -LiteralPath $ui)) { return @() }
    $l = @(Get-ChildItem -LiteralPath $ui -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "ui_track.json") } |
        ForEach-Object { $_.Name } | Sort-Object)
    if (-not $l.Count -and (Test-Path -LiteralPath (Join-Path $ui "ui_track.json"))) { $l = @("(one layout)") }
    return $l
  }
  function Test-Ao([string]$dest) {
    (Test-Path -LiteralPath $dest) -and (@(Get-ChildItem -LiteralPath $dest -Filter *.vao-patch -ErrorAction SilentlyContinue).Count -gt 0)
  }
  function Get-Note($file) {
    $txt = Join-Path $file.DirectoryName ($file.BaseName + ".txt")
    if (Test-Path -LiteralPath $txt) {
      return ((Get-Content -LiteralPath $txt -TotalCount 15 | ForEach-Object { "      $_" }) -join "`r`n")
    }
    return $null
  }
  function Describe-Zip($file) {
    "{0}, {1:N0} MB" -f $file.LastWriteTime.ToString("ddd d MMM HH:mm"), ($file.Length / 1MB)
  }

  $changes = @()    # lines for the summary
  $short = @()      # slugs for the notification
  $skipped = @()
  $errors = @()

  # The apps first, so install-track finds them up to date.
  if ($DryRun) {
    Write-Host "(Dry run: apps not checked.)"
  } else {
    foreach ($r in (Install-BusseltonApps $repo $AcPath)) {
      if ($r.Error) { $errors += "$($r.Name) app: $($r.Error)" }
      elseif ($r.Changed) { $changes += "$($r.Name) app: updated"; $short += $r.Name }
    }
  }

  # The zips: anything still being copied in (written in the last minute) waits for next time.
  $infos = @()
  $now = (Get-Date).ToUniversalTime()
  foreach ($z in @(Get-ChildItem -LiteralPath $builds -Filter *.zip -File | Sort-Object LastWriteTimeUtc)) {
    if (($now - $z.LastWriteTimeUtc).TotalSeconds -lt 60) { $skipped += "$($z.Name): still being copied in; next time"; continue }
    try { $infos += Read-ZipInfo $z }
    catch { $skipped += "$($z.Name): can't open it ($($_.Exception.Message)); still being copied?" }
  }
  # The newest zip per track folder (share.ps1); older ones holding the same folder are skipped.
  $picked = @(Select-NewestPerTrack $infos)
  foreach ($i in $picked) {
    foreach ($o in @($i.Older)) { $skipped += "$($o.File.Name): $($i.File.Name) is a newer $(if ($i.Polish) { 'polish' } else { 'build' }) of $($i.Slug)" }
  }
  $bases = @($picked | Where-Object { -not $_.Polish })
  $polishes = @($picked | Where-Object { $_.Polish })
  # Installed from this very zip already? The track folder's record first, else this PC's state file.
  function Test-UpToDate($info, [string]$dest) {
    if (-not (Test-Path -LiteralPath $dest)) { return $false }
    $mark = Test-BusseltonInstallMark $dest $info.File -Polish:$info.Polish
    if ($null -ne $mark) { return $mark }
    return $state[$info.File.Name] -eq $info.Key
  }
  $reinstalled = @{}
  $verb = $(if ($DryRun) { "would install" } else { "installed" })

  foreach ($b in $bases) {
    $dest = Join-Path $tracks $b.Slug
    if (-not $Force -and (Test-UpToDate $b $dest)) { continue }
    $before = @(Get-InstalledLayouts $dest)
    $hadAo = Test-Ao $dest
    $wasThere = Test-Path -LiteralPath $dest
    if ($DryRun) {
      $changes += "$($b.Slug): $verb the new build ($(Describe-Zip $b.File)); layouts: $($b.Layouts -join ', ')"
      $reinstalled[$b.Slug] = $true
      continue
    }
    Write-Host ""
    Write-Host "== $($b.Slug) ($(Describe-Zip $b.File))" -ForegroundColor Cyan
    try {
      & $installTrack -Zip $b.File.FullName -AcPath $AcPath -RigTracks "" | Out-Host
      $state[$b.File.Name] = $b.Key
      Save-State
      $reinstalled[$b.Slug] = $true
      $after = @(Get-InstalledLayouts $dest)
      $line = "$($b.Slug): $(if ($wasThere) { 'new build' } else { 'first install' }) ($(Describe-Zip $b.File)). Layouts: $($after -join ', ')"
      $added = @($after | Where-Object { $before -notcontains $_ })
      $gone = @($before | Where-Object { $after -notcontains $_ })
      if ($wasThere -and $added.Count) { $line += "; new: $($added -join ', ')" }
      if ($gone.Count) { $line += "; removed: $($gone -join ', ')" }
      if ($hadAo -and (Test-Ao $dest)) { $line += ". Same geometry: AO bake kept." }
      elseif ($hadAo) { $line += ". New geometry: AO bake dropped (rebake when there's time)." }
      $note = Get-Note $b.File
      if ($note) { $line += "`r`n$note" }
      $changes += $line
      $short += $b.Slug
    } catch {
      $errors += "$($b.File.Name): $($_.Exception.Message)"
    }
  }

  foreach ($p in $polishes) {
    $dest = Join-Path $tracks $p.Slug
    if (-not ($Force -or $reinstalled.ContainsKey($p.Slug) -or -not (Test-UpToDate $p $dest))) { continue }
    $base = $bases | Where-Object { $_.Slug -eq $p.Slug } | Select-Object -First 1
    if ($base -and $p.File.LastWriteTimeUtc -le $base.File.LastWriteTimeUtc) {
      # The base was built after this polish and already has the landmarks it was built with.
      $skipped += "$($p.File.Name): older than the $($p.Slug) build, which already has its landmarks"
      if (-not $DryRun) { $state[$p.File.Name] = $p.Key; Save-State }
      continue
    }
    if ($DryRun) {
      $changes += "$($p.Slug): $verb the polish $($p.File.Name) ($(Describe-Zip $p.File)), $($p.Landmarks) landmark(s)"
      continue
    }
    if (-not (Test-Path -LiteralPath $dest)) {
      $errors += "$($p.File.Name): $($p.Slug) isn't installed, so there's nothing to lay the polish over"
      continue
    }
    Write-Host ""
    Write-Host "== $($p.File.Name) over $($p.Slug) ($(Describe-Zip $p.File))" -ForegroundColor Cyan
    try {
      & $installTrack -Zip $p.File.FullName -AcPath $AcPath -RigTracks "" -Overlay | Out-Host
      $state[$p.File.Name] = $p.Key
      Save-State
      $line = "$($p.Slug): polish laid on ($(Describe-Zip $p.File)), $($p.Landmarks) landmark(s)"
      if (Test-Ao $dest) { $line += ". AO bake kept; the new landmarks are unshaded until a rebake." }
      $note = Get-Note $p.File
      if ($note) { $line += "`r`n$note" }
      $changes += $line
      $short += "$($p.Slug) polish"
    } catch {
      $errors += "$($p.File.Name): $($_.Exception.Message)"
    }
  }

  # What changed.
  Write-Host ""
  Write-Host "What changed$(if ($DryRun) { ' (dry run: nothing was touched)' })" -ForegroundColor Cyan
  if (-not $changes.Count) { Write-Host "  Nothing new in the share. Everything's up to date." }
  foreach ($c in $changes) { Write-Host "  $c" -ForegroundColor Green }
  foreach ($s in $skipped) { Write-Host "  Skipped $s" -ForegroundColor DarkGray }
  foreach ($e in $errors) { Write-Host "  FAILED $e" -ForegroundColor Red }
  if ($changes.Count -and -not $DryRun) {
    Write-Host ""
    Write-Host "In Content Manager, refresh the track list (or restart it) to see the new builds."
  }

  if ($errors.Count) {
    Show-Notice "Busselton tracks: something failed" (($errors -join "; ") + ". Log: $stateDir\rig-install.log")
    Close-Run 1
  }
  if ($short.Count) {
    Show-Notice "Busselton tracks updated" ("Installed: " + ($short -join ", ") + ". Refresh tracks in Content Manager.")
  }
  Close-Run 0
} catch {
  Write-Host "Failed: $($_.Exception.Message)" -ForegroundColor Red
  Show-Notice "Busselton tracks: install failed" $_.Exception.Message
  Close-Run 1
}
