// The automatic test's track script (src/core/lua/autotest.lua) run outside AC with a fake CSP
// (test/helpers/autotest_harness.lua), when a Lua interpreter is installed (texlua, lua or luajit).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LUA = ["luajit", "lua5.1", "lua", "texlua"].find((exe) => spawnSync(exe, ["-v"], { encoding: "utf8" }).status === 0);

function run(scenario: string): string[] {
  const p = spawnSync(LUA!, ["test/helpers/autotest_harness.lua", "src/core/lua/autotest.lua", scenario], { encoding: "utf8", maxBuffer: 64 << 20 });
  expect(p.status, p.stderr).toBe(0);
  return p.stdout.split("\n").filter(Boolean);
}
const note = (lines: string[], kind: string) => lines.find((l) => l.startsWith(`BTEST,${kind},`))?.split(",").slice(10).join(",");
const time = (lines: string[], kind: string) => Number(lines.find((l) => l.startsWith(`BTEST,${kind},`))?.split(",")[2]);

describe("autotest.lua's time limit and finish", () => {
  it("takes the limit from run-test's race.ini setting", () => {
    const ps = readFileSync("scripts/windows/run-test.ps1", "utf8");
    expect(ps).toContain('Set-Ini $ini "BUSSELTON_TEST" "MAX_SECONDS"');
    expect(readFileSync("src/core/lua/autotest.lua", "utf8")).toContain("cfg:get('BUSSELTON_TEST', 'MAX_SECONDS', 0)");
  });

  it.skipIf(!LUA)("ends a point-to-point run at the finish line, not at 480 s", () => {
    const lines = run("ab_finish");
    expect(note(lines, "note")).toBe("time limit 2000 s (run-test -Minutes)");
    expect(note(lines, "finish")).toBe("finish line");
    // 97% of 12,196 m at 60 km/h after a 4 s start: about 714 s, past the old 480 s limit.
    expect(time(lines, "finish")).toBeGreaterThan(700);
    expect(time(lines, "finish")).toBeLessThan(720);
  });

  it.skipIf(!LUA)("scales the default limit from the road's length", () => {
    const lines = run("default_limit");
    // 12,196 m at 35 km/h plus 3 minutes.
    expect(note(lines, "note")).toBe("time limit 1434 s (from the track length)");
    expect(note(lines, "finish")).toBe("finish line");
  });
});
