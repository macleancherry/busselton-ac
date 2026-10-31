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

  it("pick the newest zip per track folder everywhere", () => {
    const share = read("share.ps1");
    for (const fn of ["Get-ZipTrackFolder", "Select-NewestPerTrack", "Get-BusseltonBuilds", "Resolve-BusseltonZip"]) {
      expect(share).toContain(`function ${fn}(`);
    }
    // Resolve-BusseltonZip looks up the track folder before a zip's own name.
    const resolve = share.slice(share.indexOf("function Resolve-BusseltonZip"));
    expect(resolve.indexOf("Get-BusseltonBuilds")).toBeLessThan(resolve.indexOf('"$track.zip"'));
    expect(read("rig-install.ps1")).toContain("Select-NewestPerTrack $infos");
    const install = read("install-track.ps1");
    expect(install).toContain("Get-BusseltonBuilds $builds -Polish");
    expect(install).not.toMatch(/foreach \(\$z in Get-ChildItem \(Join-Path \$share "builds"\)/);
    expect(read("run-test.ps1")).toContain("Resolve-BusseltonZip $Zip");
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
