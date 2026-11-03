// The workstation and rig scripts (scripts/windows/*.ps1) can't run here: these check what can be
// checked without PowerShell. They stay ASCII with balanced braces (Windows PowerShell 5.1 reads a
// BOM-less file as ANSI), every zip lookup goes through share.ps1's newest-per-track helpers, and each
// install records the zip it came from for rig-install's "what's new".
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "scripts/windows";
const read = (f: string) => readFileSync(`${DIR}/${f}`, "utf8");

describe("Windows scripts", () => {
  it("are ASCII with balanced braces and parentheses", () => {
    for (const f of readdirSync(DIR).filter((n) => n.endsWith(".ps1"))) {
      const s = read(f);
      expect([...s].filter((c) => c.charCodeAt(0) > 127), f).toEqual([]);
      expect(s.split("{").length, `${f} braces`).toBe(s.split("}").length);
      expect(s.split("(").length, `${f} parentheses`).toBe(s.split(")").length);
    }
  });

  // Retest 6: busselton_roadcore.zip holds the busselton folder and was newer, so "busselton" and -All
  // installed road core. A slug is now exactly <slug>.zip, and -All and the rig take only <slug>.zip
  // and <slug>_polish*.zip.
  it("take <slug>.zip for a track, never a variant holding the same folder", () => {
    const share = read("share.ps1");
    for (const fn of ["Get-ZipTrackFolder", "Get-BuildZipKind", "Select-NewestPerTrack", "Get-BusseltonBuilds", "Resolve-BusseltonZip"]) {
      expect(share).toContain(`function ${fn}(`);
    }
    const kind = share.slice(share.indexOf("function Get-BuildZipKind"), share.indexOf("function Select-NewestPerTrack"));
    expect(kind).toContain('if ($file.BaseName -eq $slug) { return "base" }');
    expect(kind).toContain("'^' + [regex]::Escape($slug) + '_polish'");
    // Resolve-BusseltonZip: the zip's own name only, no lookup by the folder inside.
    const resolve = share.slice(share.indexOf("function Resolve-BusseltonZip"), share.indexOf("function Get-BusseltonVaoStores"));
    expect(resolve).toContain('$zip = Join-Path $builds "$track.zip"');
    expect(resolve).not.toContain("Get-BusseltonBuilds");
    const builds = share.slice(share.indexOf("function Get-BusseltonBuilds"), share.indexOf("function Resolve-BusseltonZip"));
    expect(builds).toContain("(Get-BuildZipKind $z $slug) -ne $want");
    const rig = read("rig-install.ps1");
    expect(rig).toContain("Select-NewestPerTrack $infos");
    expect(rig).toContain('if ((Get-BuildZipKind $z $zi.Slug) -eq "variant")');
    const install = read("install-track.ps1");
    expect(install).toContain("Get-BusseltonBuilds $builds -Polish");
    expect(install).toContain("Get-BusseltonBuilds $builds -Variants");
    expect(install).not.toMatch(/foreach \(\$z in Get-ChildItem \(Join-Path \$share "builds"\)/);
    expect(read("run-test.ps1")).toContain("Resolve-BusseltonZip $Zip");
  });

  // Retest 6: installing road core dropped base's bake, and reinstalling base didn't bring it back.
  it("keep AO bakes per build and bring them back on reinstall", () => {
    const share = read("share.ps1");
    for (const fn of ["Get-BusseltonVaoStores", "Get-BusseltonGeometryKey", "Save-BusseltonVao", "Restore-BusseltonVao"]) {
      expect(share).toContain(`function ${fn}`);
    }
    const install = read("install-track.ps1");
    // Kept before the folder is replaced or overlaid, restored after.
    expect(install.indexOf("Save-BusseltonVao $dest $slug")).toBeLessThan(install.indexOf("Remove-Item $dest -Recurse -Force"));
    expect(install.indexOf("Remove-Item $dest -Recurse -Force")).toBeLessThan(install.lastIndexOf("Restore-BusseltonVao $dest $slug"));
    expect(install).not.toContain("no longer fits and was removed");
    expect(read("bake-vao.ps1")).toContain("$key = Save-BusseltonVao $dir $Track");
  });

  it("record the installed zip and compare it in the rig's dry run", () => {
    const share = read("share.ps1");
    expect(share).toContain('$BusseltonInstallMark = "installed_from.txt"');
    const install = read("install-track.ps1");
    expect(install).toContain("Write-BusseltonInstallMark $dest $zip -Polish");
    expect(install).toContain("Write-BusseltonInstallMark $dest $zip\n");
    const rig = read("rig-install.ps1");
    expect(rig).toContain("Test-BusseltonInstallMark $dest $info.File -Polish:$info.Polish");
    expect(rig).toContain("if (-not $Force -and (Test-UpToDate $b $dest)) { continue }");
    // The rig's kit carries share.ps1, where the helpers live.
    expect(rig).toMatch(/foreach \(\$f in "rig-install.ps1", "rig-install.cmd", "install-track.ps1", "share.ps1", "ac.ps1"\)/);
  });
});

// CSP's taskbar shows each window's ICON (manifest [WINDOW_...]), declared as CSP's own apps do.
// AC's own taskbar logs "TaskBarIcon :: COULD NOT FIND TEXTURES FOR <window>_ICON" for every app
// window it lists, whatever its icon: in the workstation's log (28 Oct 2026) for AC's own AUDIO_ICON and
// CHAT_ICON, CSP's IMGUI_CSP_* tools, CSP's own Lua apps (IMGUI_CSP_LUA_App Shelf_main_ICON,
// IMGUI_CSP_LUA_CSP Debug_main_ICON, ..._settings_ICON), Pure's Lua apps (IMGUI_LUA_Pure Config
// App_main_pure_config_ICON) and Python apps (G Meter_ICON). CSP's apps declare their icon exactly as
// ours do (ICON = icon.png, 64 x 64 RGBA PNG; acc-lua-internal included-apps/*/manifest.ini) and log the
// same line, so it isn't ours to fix: the icon CSP's taskbar shows comes from ICON.
describe("Busselton Lua apps", () => {
  for (const app of ["BusseltonChallenges", "BusseltonMap"]) {
    it(`${app} has a 64 x 64 PNG icon for its window`, () => {
      const manifest = readFileSync(`apps/lua/${app}/manifest.ini`, "utf8");
      const icon = /\[WINDOW_\.\.\.\][^[]*?\nICON = (\S+)/.exec(manifest)?.[1];
      expect(icon).toBe("icon.png");
      const png = readFileSync(`apps/lua/${app}/${icon}`);
      expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([64, 64]);
    });
  }

  // Retest 4: the Challenges beam, a flat-coloured render.quad, came out as a solid bar.
  it("draws the Challenges markers as soft, see-through glow (shaderedQuad, alpha blend, no depth writes)", () => {
    const lua = readFileSync("apps/lua/BusseltonChallenges/BusseltonChallenges.lua", "utf8");
    expect(lua).toContain("blendMode = render.BlendMode.AlphaBlend");
    expect(lua).toContain("render.setDepthMode(render.DepthMode.ReadOnlyLessEqual)");
    expect(lua).toContain("pcall(render.shaderedQuad, glow)");
    // Alpha from the shader: soft sides, fading in off the ground and out towards the top.
    expect(lua).toMatch(/return pin\.ApplyFog\(float4\(gColor \* gWhiteRefPoint \* gBright, gAlpha \* side \* ends\)\);/);
    // Every strip passes its alpha.
    for (const call of lua.match(/\bstrip\([^\n]*\)/g)!.filter((c) => !c.startsWith("strip(foot"))) {
      expect(call.split(",").length, call).toBeGreaterThanOrEqual(5);
    }
  });
});
