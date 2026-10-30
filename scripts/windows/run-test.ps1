<#
.SYNOPSIS
  Automatic test run on the workstation: install a build, start a practice session with the AI
  driving the player's car, let the track's test script log the drive and take screenshots, then
  collect logs, screenshots, the replay and the results into a shared folder.

.EXAMPLE
  .\scripts\windows\run-test.ps1 busselton -Layout town
  .\scripts\windows\run-test.ps1 busselton -Layout foreshore -Car ks_mazda_mx5_nd -AiLevel 90 -Minutes 10
  .\scripts\windows\run-test.ps1 C:\somewhere\busselton.zip
  .\scripts\windows\run-test.ps1 busselton -Layout foreshore -Night
  .\scripts\windows\run-test.ps1 busselton -Layout town -Cars 5
  .\scripts\windows\run-test.ps1 busselton -Layout town -Rain

.NOTES
  Runs code from the repo, never edits it (see CLAUDE.md). Needs the build to have traffic on (the
  test script ships with it) and CSP installed.
  The track is a slug (its zip is <share>\builds\<slug>.zip) or a zip's path. Results go to
  <share>\tests\<date>_<time>-<slug>-<layout> and a zip of it (share.ps1 has the share's layout).
  The car is an everyday hatch (the Abarth 500 that comes with AC) driven at AI level 75, so the
  test drives a town street the way a person would, not flat out in a race car. -Car and -AiLevel
  change them (-Car "" keeps the car from the last session Content Manager started).
  -Night drives at 22:00 (-Time sets another time, e.g. -Time 19:30 for dusk): race.ini's sun angle
  as Content Manager writes it, with the unclamped angle CSP reads (AC alone stops at 18:00, so CSP's
  weather FX must be on). -Weather sets race.ini's weather by name.
  -Rain drives in the rain: race.ini's weather becomes a rain weather from content\weather (the first
  of heavy rain, rain, then anything with "rain" in its name; -Weather names one instead). The track
  script logs CSP's rain intensity, wetness and standing water in its env line, so the report can
  tell whether it really rained (needs CSP's weather FX).
  Every run also keeps the installed track's extension\ext_config.ini, for the report's checks
  (the rain hollows it lists).
  -Cars N puts N AI opponents on the grid in a race session (-Laps long, at most the layout's pit
  boxes less one); the track script logs every car's contacts, off-road moments and stops.
  Close AC before running. The script restores race.ini afterwards.
#>
param(
  [Parameter(Mandatory = $true, Position = 0)][Alias("Track")][string]$Zip,
  [string]$Car = "abarth500",
  [int]$AiLevel = 75,
  [int]$Minutes = 9,
  [string]$Share = "",
  [string]$AcPath = $env:BUSSELTON_AC_PATH,
  # Which layout, on a map with several (models_<layout>.ini); the first one when not given.
  [string]$Layout = "",
  # Drive what's installed now (e.g. after an AO bake) instead of installing the zip again.
  # The zip is still read for the track's name.
  [switch]$SkipInstall,
  # Where the Drive button is in AC's window, as a fraction of its width and height: the top icon
  # of the left-hand bar (AC scales its menus with the resolution; measured on the workstation's 4K screen).
  [double]$DriveX = 0.013,
  [double]$DriveY = 0.080,
  # Night run: 22:00 unless -Time gives another time (HH:mm, 24-hour).
  [switch]$Night,
  [string]$Time = "",
  # race.ini's [WEATHER] NAME (a folder in content\weather), when given.
  [string]$Weather = "",
  # Rain run: a rain weather from content\weather (or -Weather's).
  [switch]$Rain,
  # AI opponents: N other cars, a race session of -Laps laps instead of a solo practice.
  [int]$Cars = 0,
  [int]$Laps = 3
)
$ErrorActionPreference = "Stop"
$inv = [Globalization.CultureInfo]::InvariantCulture
if ($Night -and -not $Time) { $Time = "22:00" }
$sunAngle = $null
if ($Time) {
  $tm = [regex]::Match($Time, '^(\d{1,2}):(\d{2})$')
  if (-not $tm.Success -or [int]$tm.Groups[1].Value -gt 23 -or [int]$tm.Groups[2].Value -gt 59) { throw "-Time must be HH:mm (24-hour), e.g. 22:00." }
  # Content Manager's sun angle: 16 degrees an hour from 13:00 (-80 is 08:00, 80 is 18:00).
  $sunAngle = 16.0 * ([int]$tm.Groups[1].Value + [int]$tm.Groups[2].Value / 60.0 - 13.0)
}
if ($Cars -lt 0) { throw "-Cars must be 0 or more." }
if ($Cars -gt 0 -and -not $PSBoundParameters.ContainsKey('Minutes')) { $Minutes += 2 }
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
. (Join-Path $PSScriptRoot "share.ps1")
$Zip = Resolve-BusseltonZip $Zip
if (-not $Share) { $Share = Get-BusseltonShare }
$docs = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Assetto Corsa"
$raceIni = Join-Path $docs "cfg\race.ini"
if (-not (Test-Path $raceIni)) { throw "No $raceIni yet: start any session once from Content Manager first." }
if (Get-Process acs -ErrorAction SilentlyContinue) { throw "Assetto Corsa is running: close it first." }

# 1. Install (same script as a normal install).
if (-not $SkipInstall) { & (Join-Path $PSScriptRoot "install-track.ps1") -Zip $Zip -AcPath $AcPath }
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
$layouts = @(Get-ChildItem (Join-Path $AcPath "content\tracks\$slug") -Filter "models_*.ini" -ErrorAction SilentlyContinue | ForEach-Object { $_.BaseName.Substring(7) })
if (-not $Layout -and $layouts.Count) { $Layout = $layouts[0] }
if ($Layout -and $layouts -notcontains $Layout) { throw "No layout '$Layout' in $slug (it has: $($layouts -join ', '))." }

$tracks = Join-Path $AcPath "content\tracks\$slug"
if ($Rain -and -not $Weather) {
  # A rain weather by its folder name: Kunos ships none, CSP / Sol / Pure add their own.
  $wet = @(Get-ChildItem (Join-Path $AcPath "content\weather") -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'rain' } | ForEach-Object { $_.Name })
  if (-not $wet.Count) { throw "No rain weather in $AcPath\content\weather (no folder with 'rain' in its name): pass -Weather <folder>." }
  $pick = @($wet | Where-Object { $_ -match 'heavy_?rain' }) + @($wet | Where-Object { $_ -notmatch 'light|drizzle' }) + $wet
  $Weather = $pick[0]
  Write-Host "Rain weather: $Weather (rain weathers here: $($wet -join ', '))"
}
if ($Cars -gt 0) {
  # Room on the grid: the layout's pit boxes (ui_track.json), the test car included.
  $ui = if ($Layout) { Join-Path $tracks "ui\$Layout\ui_track.json" } else { Join-Path $tracks "ui\ui_track.json" }
  $boxes = 0
  if (Test-Path $ui) { try { $boxes = [int]((Get-Content $ui -Raw | ConvertFrom-Json).pitboxes) } catch { $boxes = 0 } }
  if ($boxes -gt 0 -and $Cars + 1 -gt $boxes) {
    Write-Host "Only $boxes pit boxes on this layout: $($boxes - 1) AI cars instead of $Cars." -ForegroundColor Yellow
    $Cars = $boxes - 1
  }
  if ($Cars -lt 1) { throw "No room for AI cars on this layout ($boxes pit boxes)." }
}

# 2. A practice session for one car (or a race with AI opponents), the test driver at the wheel.
function Get-Ini([string[]]$lines, [string]$section, [string]$key) {
  $in = $false
  foreach ($l in $lines) {
    if ($l -match '^\s*\[(.+)\]\s*$') { $in = ($Matches[1] -eq $section) }
    elseif ($in -and $l -match "^\s*$([regex]::Escape($key))\s*=(.*)$") { return $Matches[1].Trim() }
  }
  return ""
}
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
# Only the first session, and only the first car (opponents are added below).
$ini = @($ini | ForEach-Object -Begin { $skip = $false } -Process {
  if ($_ -match '^\s*\[(SESSION|CAR)_[1-9]\d*\]') { $skip = $true } elseif ($_ -match '^\s*\[') { $skip = $false }
  if (-not $skip) { $_ }
})
foreach ($kv in @(
  @("RACE", "TRACK", $slug), @("RACE", "CONFIG_TRACK", $Layout), @("RACE", "CARS", "$($Cars + 1)"), @("RACE", "AI_LEVEL", "$AiLevel"),
  @("CAR_0", "DRIVER_NAME", "Busselton Test"),
  @("REMOTE", "ACTIVE", "0"), @("REPLAY", "ACTIVE", "0"), @("AUTOSPAWN", "ACTIVE", "1")
)) { $ini = Set-Ini $ini $kv[0] $kv[1] $kv[2] }
if ($Cars -gt 0) {
  # A race: AC's offline practice is for one car only.
  foreach ($kv in @(
    @("SESSION_0", "NAME", "Race"), @("SESSION_0", "TYPE", "3"), @("SESSION_0", "LAPS", "$Laps"), @("SESSION_0", "DURATION_MINUTES", "0"), @("SESSION_0", "SPAWN_SET", "START"),
    @("RACE", "RACE_LAPS", "$Laps"), @("RACE", "PENALTIES", "0"), @("RACE", "JUMP_START_PENALTY", "0")
  )) { $ini = Set-Ini $ini $kv[0] $kv[1] $kv[2] }
} else {
  foreach ($kv in @(
    @("SESSION_0", "NAME", "Practice"), @("SESSION_0", "TYPE", "1"), @("SESSION_0", "DURATION_MINUTES", "30"), @("SESSION_0", "SPAWN_SET", "START")
  )) { $ini = Set-Ini $ini $kv[0] $kv[1] $kv[2] }
}
if ($Car) { $ini = Set-Ini $ini "RACE" "MODEL" $Car; $ini = Set-Ini $ini "CAR_0" "MODEL" "-" }
if ($Cars -gt 0) {
  # The opponents drive the same car as the test car, each in another skin where there are several.
  $model = if ($Car) { $Car } else { Get-Ini $ini "RACE" "MODEL" }
  if (-not $model) { throw "No car to give the AI opponents: pass -Car." }
  $skins = @(Get-ChildItem (Join-Path $AcPath "content\cars\$model\skins") -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
  for ($i = 1; $i -le $Cars; $i++) {
    $skin = if ($skins.Count) { $skins[$i % $skins.Count] } else { "" }
    foreach ($kv in @(
      @("MODEL", $model), @("SKIN", $skin), @("DRIVER_NAME", "Busselton AI $i"), @("NATIONALITY", ""), @("SETUP", ""),
      @("MODEL_CONFIG", ""), @("AI_LEVEL", "$AiLevel"), @("AI_AGGRESSION", "0"), @("BALLAST", "0"), @("RESTRICTOR", "0")
    )) { $ini = Set-Ini $ini "CAR_$i" $kv[0] $kv[1] }
  }
}
if ($null -ne $sunAngle) {
  # AC clamps SUN_ANGLE to 08:00..18:00; CSP reads the unclamped angle, as Content Manager writes it.
  $clamped = [Math]::Max(-80.0, [Math]::Min(80.0, $sunAngle))
  foreach ($kv in @(
    @("LIGHTING", "SUN_ANGLE", $clamped.ToString("0.00", $inv)), @("LIGHTING", "__CM_UNCLAMPED_SUN_ANGLE", $sunAngle.ToString("0.00", $inv)),
    @("LIGHTING", "TIME_MULT", "1")
  )) { $ini = Set-Ini $ini $kv[0] $kv[1] $kv[2] }
}
if ($Weather) { $ini = Set-Ini $ini "WEATHER" "NAME" $Weather }
Set-Content -Path $raceIni -Value $ini -Encoding ASCII
# Run windowed: in exclusive full screen the simulated Drive click never reaches AC.
$videoIni = Join-Path $docs "cfg\video.ini"
$videoBackup = "$videoIni.before-test"
if (Test-Path $videoIni) {
  Copy-Item $videoIni $videoBackup -Force
  $video = Set-Ini (Get-Content $videoIni) "VIDEO" "FULLSCREEN" "0"
  Set-Content -Path $videoIni -Value $video -Encoding ASCII
}
$used = Join-Path $env:TEMP "race.ini.used"
Copy-Item $raceIni $used -Force

# 3. Drive: AC quits itself when the run ends; this waits a little longer, then closes it.
$started = Get-Date
$what = @()
if ($Time) { $what += "at $Time" }
if ($Cars -gt 0) { $what += "with $Cars AI cars" }
if ($Weather) { $what += "in $Weather" }
Write-Host "Starting $slug $($what -join ' ') with the AI driving (up to $Minutes min) ..." -ForegroundColor Cyan
try {
  $proc = Start-Process -FilePath (Join-Path $AcPath "acs.exe") -WorkingDirectory $AcPath -PassThru
  # AC opens on its setup screen and waits for the Drive button (top of the left-hand bar). The
  # track's test script presses it too; as a fallback, click it here a few times while AC loads.
  # Its position is a fraction of the window, and the click is DPI-aware so Windows' display
  # scaling (150-200% on a 4K screen) doesn't move it.
  Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class BtClick {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static string Title(IntPtr h) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); return sb.ToString(); }
  // Windows only lets the process that has the focus hand it on: join the front window's input
  // thread and tap Alt (which lifts the lock), then bring AC up.
  public static void Front(IntPtr h) {
    IntPtr fg = GetForegroundWindow();
    uint a = GetWindowThreadProcessId(fg, IntPtr.Zero), me = GetCurrentThreadId();
    AttachThreadInput(me, a, true);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    ShowWindow(h, 9); BringWindowToTop(h); SetForegroundWindow(h);
    AttachThreadInput(me, a, false);
  }
  public static string Click(IntPtr h, double fx, double fy) {
    SetProcessDPIAware();
    string before = Title(GetForegroundWindow());
    Front(h); System.Threading.Thread.Sleep(400);
    string after = Title(GetForegroundWindow());
    RECT r; GetClientRect(h, out r);
    int cx = (int)Math.Round(fx * (r.R - r.L)), cy = (int)Math.Round(fy * (r.B - r.T));
    // Straight to AC's window (works whatever is in front, if AC reads window messages)...
    IntPtr lp = (IntPtr)((cy << 16) | (cx & 0xFFFF));
    PostMessage(h, 0x0200, IntPtr.Zero, lp); PostMessage(h, 0x0201, (IntPtr)1, lp); PostMessage(h, 0x0202, IntPtr.Zero, lp);
    System.Threading.Thread.Sleep(300);
    // ...and a real click at the same spot.
    POINT p; p.X = cx; p.Y = cy; ClientToScreen(h, ref p); SetCursorPos(p.X, p.Y);
    System.Threading.Thread.Sleep(150); mouse_event(2, 0, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(80); mouse_event(4, 0, 0, 0, UIntPtr.Zero);
    return "front before: '" + before + "', after: '" + after + "', at " + p.X + "," + p.Y;
  }
  // AC's own screenshot key (F8), pressed with AC in front: track scripts can't take screenshots.
  public static void Key(IntPtr h, byte vk) {
    Front(h); System.Threading.Thread.Sleep(200);
    keybd_event(vk, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(60); keybd_event(vk, 0, 2, UIntPtr.Zero);
  }
}
"@ -ErrorAction SilentlyContinue
  # The track script's lines in CSP's log tell us when the drive has started and finished.
  $cspLog = Join-Path $docs "logs\custom_shaders_patch.log"
  function Test-Logged([string]$what) {
    if (-not (Test-Path $cspLog)) { return $false }
    # CSP starts a fresh log each launch, so anything in it is from this run.
    if ((Get-Item $cspLog).LastWriteTime -lt $started) { return $false }
    return [bool](Select-String -Path $cspLog -Pattern $what -SimpleMatch -Quiet -ErrorAction SilentlyContinue)
  }
  # Every 10 s for up to 3 minutes, until the script logs that the drive has started.
  $clickLog = Join-Path $env:TEMP "busselton-clicks.txt"
  "" | Set-Content $clickLog
  $clickUntil = (Get-Date).AddMinutes(3)
  if (-not $proc.WaitForExit(25000)) {
    while ((Get-Date) -lt $clickUntil -and -not $proc.HasExited) {
      if (Test-Logged "BTEST,start") { break }
      $proc.Refresh()
      if ($proc.MainWindowHandle -ne [IntPtr]::Zero) {
        $how = [BtClick]::Click($proc.MainWindowHandle, $DriveX, $DriveY)
        $line = "$(Get-Date -Format HH:mm:ss) clicked Drive: $how"
        Write-Host "  $line"
        Add-Content $clickLog $line
      }
      if ($proc.WaitForExit(10000)) { break }
    }
  }
  # Wait for the script's finish line (AC can't always quit itself), then a little more logging,
  # then close AC the normal way so it saves the replay; force it only if that doesn't work.
  $deadline = (Get-Date).AddMinutes($Minutes + 2)
  $shotsTaken = 0
  while (-not $proc.HasExited -and (Get-Date) -lt $deadline) {
    # Each "shot" line the script logs: press F8 for it.
    if ((Test-Path $cspLog) -and (Get-Item $cspLog).LastWriteTime -ge $started) {
      $shots = @(Select-String -Path $cspLog -Pattern "BTEST,shot" -SimpleMatch -ErrorAction SilentlyContinue).Count
      $proc.Refresh()
      while ($shotsTaken -lt $shots -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
        [BtClick]::Key($proc.MainWindowHandle, 0x77)
        $shotsTaken++
        Add-Content $clickLog "$(Get-Date -Format HH:mm:ss) pressed F8 (shot $shotsTaken)"
        Start-Sleep -Milliseconds 700
      }
    }
    if (Test-Logged "BTEST,finish") {
      Write-Host "  run finished: closing AC" -ForegroundColor Cyan
      Start-Sleep -Seconds 8
      $proc.CloseMainWindow() | Out-Null
      if (-not $proc.WaitForExit(30000)) { Stop-Process -Id $proc.Id -Force }
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $proc.HasExited) {
    Write-Host "Still running after $Minutes min: closing AC." -ForegroundColor Yellow
    $proc.CloseMainWindow() | Out-Null
    if (-not $proc.WaitForExit(30000)) { Stop-Process -Id $proc.Id -Force }
  }
} finally {
  Copy-Item $backup $raceIni -Force
  if (Test-Path $videoBackup) { Copy-Item $videoBackup $videoIni -Force }
}
Start-Sleep -Seconds 3

# 4. Collect.
$stamp = $started.ToString("yyyy-MM-dd_HHmm")
$base = if ($Share -and (Test-Path $Share)) { Join-Path $Share "tests" } else { Join-Path $repo "reports" }
$suffix = $(if ($Layout) { "-$Layout" } else { "" }) + $(if ($Night) { "-night" } elseif ($Time) { "-" + ($Time -replace ':', '') } else { "" }) + $(if ($Cars -gt 0) { "-cars$Cars" } else { "" }) + $(if ($Rain) { "-rain" } else { "" })
$dest = Join-Path $base ("$stamp-$slug" + $suffix)
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# What this run was asked to do, for autotest_report.py.
[ordered]@{
  slug = $slug; layout = $Layout; car = $Car; aiLevel = $AiLevel; night = [bool]$Night; time = $Time
  sunAngle = $sunAngle; cars = $Cars; laps = $(if ($Cars -gt 0) { $Laps } else { 0 }); weather = $Weather; rain = [bool]$Rain
} | ConvertTo-Json | Set-Content (Join-Path $dest "run.json") -Encoding ASCII
# The track's CSP config as installed (the rain hollows it lists, for autotest_report.py).
Copy-Item (Join-Path $tracks "extension\ext_config.ini") (Join-Path $dest "ext_config.ini") -ErrorAction SilentlyContinue
Copy-Item (Join-Path $docs "logs") (Join-Path $dest "logs") -Recurse -Force -ErrorAction SilentlyContinue
$screens = Get-ChildItem (Join-Path $docs "screens") -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $started }
if ($screens) {
  New-Item -ItemType Directory -Force -Path (Join-Path $dest "screens") | Out-Null
  $screens | Copy-Item -Destination (Join-Path $dest "screens")
  # The order they were taken in (their names don't sort by time), to match them to the shot lines.
  $screens | Sort-Object LastWriteTime | ForEach-Object { "$($_.Name),$($_.LastWriteTime.ToString('HH:mm:ss.fff'))" } | Set-Content (Join-Path $dest "screens.txt") -Encoding ASCII
}
$replay = Get-ChildItem (Join-Path $docs "replay\temp") -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $started } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($replay) { Copy-Item $replay.FullName $dest }
Copy-Item (Join-Path $docs "out\race_out.json") $dest -ErrorAction SilentlyContinue
Copy-Item $used (Join-Path $dest "race.ini.used") -ErrorAction SilentlyContinue
Copy-Item (Join-Path $env:TEMP "busselton-clicks.txt") (Join-Path $dest "clicks.txt") -ErrorAction SilentlyContinue

# The drive log: every "BTEST," line the test script wrote, wherever CSP put it.
$lines = Get-ChildItem (Join-Path $dest "logs") -Recurse -File | Select-String -Pattern 'BTEST,' | ForEach-Object { $_.Line -replace '^.*?BTEST,', 'BTEST,' }
"kind,time,spline,x,y,z,kmh,wheels_on_road,ai,note" | Set-Content (Join-Path $dest "btest.csv")
$lines | ForEach-Object { $_ -replace '^BTEST,', '' } | Add-Content (Join-Path $dest "btest.csv")
$finish = $lines | Where-Object { $_ -match '^BTEST,finish' } | Select-Object -Last 1
$off = ($lines | Where-Object { $_ -match '^BTEST,offroad' }).Count
$start = $lines | Where-Object { $_ -match '^BTEST,start' } | Select-Object -First 1
$env0 = $lines | Where-Object { $_ -match '^BTEST,env,' } | Select-Object -First 1
$contacts = ($lines | Where-Object { $_ -match '^BTEST,contact' }).Count
$offOthers = ($lines | Where-Object { $_ -match '^BTEST,coffroad' }).Count
$stuckAll = ($lines | Where-Object { $_ -match '^BTEST,cstuck' }).Count

# One zip of the lot, for the laptop session.
$zipOut = "$dest.zip"
if (Test-Path $zipOut) { Remove-Item $zipOut }
[IO.Compression.ZipFile]::CreateFromDirectory($dest, $zipOut)

Write-Host ""
Write-Host "Test run: $slug" -ForegroundColor Green
Write-Host ("  started:   " + ($(if ($start) { $start } else { "no BTEST lines: the test script didn't run (check logs\custom_shaders_patch.log for autotest.lua)" })))
Write-Host ("  finished:  " + ($(if ($finish) { $finish } else { "no finish line (timed out or crashed)" })))
Write-Host "  off-road events: $off"
if ($env0) { Write-Host ("  time of day: " + (($env0 -split ',', 11)[10])) }
if ($Rain) {
  $rainNow = if ($env0) { [regex]::Match((($env0 -split ',', 11)[10]), 'rain=([\d.?]+)').Groups[1].Value } else { "" }
  if (-not $rainNow -or $rainNow -eq "?") { Write-Host "  rain: not logged (CSP too old, or the env line is missing)" -ForegroundColor Yellow }
  elseif ([double]::Parse($rainNow, $inv) -lt 0.05) { Write-Host "  rain: $rainNow, it didn't rain: is CSP's weather FX on, and is $Weather a rain weather?" -ForegroundColor Yellow }
  else { Write-Host "  rain: $rainNow ($Weather)" }
}
if ($Cars -gt 0) { Write-Host "  AI cars: $Cars; contacts logged: $contacts; their off-road events: $offOthers; stops of 10 s or more: $stuckAll" }
Write-Host "  results:   $dest"
Write-Host "  zip:       $zipOut"
