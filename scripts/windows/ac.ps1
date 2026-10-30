<#
  Assetto Corsa helpers shared by install-track.ps1 and rig-install.ps1. Dot-source it:
    . (Join-Path $PSScriptRoot "ac.ps1")

  Find-AssettoCorsa       the AC folder (the one holding content\tracks), or $null
  Install-BusseltonApps   copies apps\lua\BusseltonChallenges and BusseltonMap into an AC folder

  Windows PowerShell 5.1 compatible. Keep this file ASCII (5.1 reads BOM-less files as ANSI).
#>

# Where AC is: Steam's libraries first (registry -> libraryfolders.vdf -> appmanifest_244210.acf),
# then Content Manager's own settings (it knows where AC is even when Steam's records are stale).
function Find-AssettoCorsa {
  $isAc = { param($p) $p -and (Test-Path -LiteralPath (Join-Path $p "content\tracks")) }

  # 1. Steam. SteamPath (HKCU) is the usual one; the HKLM keys cover a Steam installed for all users.
  $steams = @()
  foreach ($k in @(
      @{ Path = "HKCU:\Software\Valve\Steam"; Name = "SteamPath" },
      @{ Path = "HKLM:\SOFTWARE\WOW6432Node\Valve\Steam"; Name = "InstallPath" },
      @{ Path = "HKLM:\SOFTWARE\Valve\Steam"; Name = "InstallPath" })) {
    $v = (Get-ItemProperty -Path $k.Path -Name $k.Name -ErrorAction SilentlyContinue).($k.Name)
    if ($v) { $steams += ($v -replace '/', '\') }
  }
  $libs = @()
  foreach ($steam in $steams) {
    $libs += $steam
    $vdf = Join-Path $steam "steamapps\libraryfolders.vdf"
    if (Test-Path -LiteralPath $vdf) {
      # New format: "path"  "D:\\SteamLibrary". Old format: "1"  "D:\\SteamLibrary". Keep only values
      # that look like folders (the new format's "apps" block also has "244210" "<size>" pairs).
      foreach ($m in (Select-String -LiteralPath $vdf -Pattern '"(?:path|\d+)"\s+"([^"]+)"' -AllMatches).Matches) {
        $v = $m.Groups[1].Value -replace '\\\\', '\'
        if ($v -match '[:\\]') { $libs += $v }
      }
    }
  }
  foreach ($lib in ($libs | Select-Object -Unique)) {
    $dir = "assettocorsa"
    $acf = Join-Path $lib "steamapps\appmanifest_244210.acf"
    if (Test-Path -LiteralPath $acf) {
      $m = Select-String -LiteralPath $acf -Pattern '"installdir"\s+"([^"]+)"' | Select-Object -First 1
      if ($m) { $dir = $m.Matches[0].Groups[1].Value }
    }
    $p = Join-Path $lib "steamapps\common\$dir"
    if (& $isAc $p) { return $p }
  }

  # 2. Content Manager: %LOCALAPPDATA%\AcTools Content Manager\Values.data holds its settings,
  # AC's folder among them. Its layout isn't documented and may be deflate-compressed, so read it as
  # text (or inflate it first), pick out every Windows path in it, and take the first that is (or sits
  # inside) a folder with content\tracks.
  $values = Join-Path $env:LOCALAPPDATA "AcTools Content Manager\Values.data"
  if (Test-Path -LiteralPath $values) {
    $texts = @()
    try {
      $bytes = [IO.File]::ReadAllBytes($values)
      $texts += [Text.Encoding]::UTF8.GetString($bytes)
      foreach ($skip in 0, 2) {
        try {
          $in = New-Object IO.MemoryStream(, $bytes)
          $in.Position = $skip
          $z = New-Object IO.Compression.DeflateStream($in, [IO.Compression.CompressionMode]::Decompress)
          $out = New-Object IO.MemoryStream
          $z.CopyTo($out)
          $z.Dispose()
          if ($out.Length -gt 0) { $texts += [Text.Encoding]::UTF8.GetString($out.ToArray()) }
        } catch { }
      }
    } catch { }
    $seen = @{}
    foreach ($t in $texts) {
      foreach ($m in [regex]::Matches($t, '[A-Za-z]:(?:\\\\|\\|/)[^\t\r\n"<>|*?]+')) {
        $p = ($m.Value -replace '\\\\', '\' -replace '/', '\').Trim().TrimEnd('\')
        if ($seen.ContainsKey($p) -or $p -notmatch 'assettocorsa') { continue }
        $seen[$p] = $true
        if ($seen.Count -gt 300) { break }
        # Walk up from e.g. ...\assettocorsa\content\cars\x to ...\assettocorsa.
        $q = $p
        for ($i = 0; $i -lt 6 -and $q; $i++) {
          try { if (& $isAc $q) { return $q } } catch { }
          $q = Split-Path $q -Parent
        }
      }
    }
  }
  return $null
}

# Copy the Busselton Lua apps (Challenges and Map) from <source>\apps\lua into <acRoot>\apps\lua.
# Only copies when something differs. Returns one object per app: Name, Dest, Changed, Error.
function Install-BusseltonApps([string]$source, [string]$acRoot) {
  $results = @()
  foreach ($name in @("BusseltonChallenges", "BusseltonMap")) {
    $app = Join-Path $source "apps\lua\$name"
    if (-not (Test-Path -LiteralPath $app)) { continue }
    $app = (Get-Item -LiteralPath $app).FullName   # a plain path, also for UNC, so Substring below lines up
    $dest = Join-Path $acRoot "apps\lua\$name"
    $r = New-Object PSObject -Property @{ Name = $name; Dest = $dest; Changed = $false; Error = $null }
    try {
      $changed = $false
      foreach ($f in Get-ChildItem -LiteralPath $app -Recurse -File) {
        $rel = $f.FullName.Substring($app.Length).TrimStart('\', '/')
        $there = Join-Path $dest $rel
        if (-not (Test-Path -LiteralPath $there) -or
            (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA1).Hash -ne (Get-FileHash -LiteralPath $there -Algorithm SHA1).Hash) {
          $changed = $true
          break
        }
      }
      if ($changed) {
        New-Item -ItemType Directory -Force -Path $dest -ErrorAction Stop | Out-Null
        Copy-Item (Join-Path $app "*") $dest -Recurse -Force -ErrorAction Stop
        $r.Changed = $true
      }
    } catch {
      $r.Error = $_.Exception.Message
    }
    $results += $r
  }
  return $results
}
