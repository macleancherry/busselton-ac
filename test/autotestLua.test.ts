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

describe("autotest.lua's night clock", () => {
  it("run-test passes the time asked for and writes race.ini as Content Manager does", () => {
    const ps = readFileSync("scripts/windows/run-test.ps1", "utf8");
    expect(ps).toContain('@("BUSSELTON_TEST", "TIME", "$timeOfDay")');
    expect(ps).toContain('Remove-Ini $ini "BUSSELTON_TEST" "TIME"');
    expect(readFileSync("src/core/lua/autotest.lua", "utf8")).toContain("cfg:get('BUSSELTON_TEST', 'TIME', -1)");
  });

  it.skipIf(!LUA)("moves CSP's weather clock from the PC's time to 22:00", () => {
    const lines = run("night");
    expect(lines).toContain("CALL,setWeatherTimeOffset,29700,true");
    expect(lines.map((l) => note([l], "note")).filter(Boolean)).toContain("clock moved from 13:45 to 22:00");
    expect(note(lines, "env")).toMatch(/^time=22:00;/);
    expect(lines.some((l) => l.includes("clock still"))).toBe(false);
  });

  it.skipIf(!LUA)("says so when it can't move the clock", () => {
    const lines = run("night_noapi");
    const notes = lines.filter((l) => l.startsWith("BTEST,note,")).map((l) => note([l], "note"));
    expect(notes.some((n) => n?.startsWith("clock move from 13:45 to 22:00 failed"))).toBe(true);
    expect(notes).toContain("clock still at 13:45, not 22:00");
    expect(note(lines, "env")).toMatch(/^time=13:45;/);
  });

  it.skipIf(!LUA)("tells the Busselton Map app it moved the clock, and leaves it when the app did", () => {
    expect(run("night")).toContain("CALL,store,busselton.clock,moved");
    const lines = run("night_app");
    expect(lines.some((l) => l.startsWith("CALL,setWeatherTimeOffset"))).toBe(false);
    expect(lines.map((l) => note([l], "note")).filter(Boolean)).toContain("clock: set by the Busselton Map app");
    expect(note(lines, "env")).toMatch(/^time=22:00;/);
  });
});

// run-test.ps1's forced date and time (Content Manager's NewModeDetails.cs keys), worked the same way
// as Get-BusseltonForcedDate: the track's local date at the time asked for, as a UTC Unix timestamp.
function forcedDate(timeOfDay: number, tz: number, utcNow: Date): number {
  const local = new Date(utcNow.getTime() + tz * 1000);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) / 1000;
  return midnight + timeOfDay - tz;
}

describe("run-test.ps1's forced time of day", () => {
  it("writes __CM_DATE and __CM_DATE_USE_TIME with SUN_ANGLE, as CM does for a new mode's FORCE_DATETIME", () => {
    const ps = readFileSync("scripts/windows/run-test.ps1", "utf8");
    expect(ps).toContain('@("LIGHTING", "__CM_DATE", "$cmDate"), @("LIGHTING", "__CM_DATE_USE_TIME", "1")');
    expect(ps).toContain("$cmDate = Get-BusseltonForcedDate $timeOfDay $tz ([DateTime]::UtcNow)");
    // WA when CM hasn't written the track's time zone.
    expect(ps).toContain('@("__TRACK_TIMEZONE_OFFSET", "28800")');
    // The example in the function's comment.
    expect(ps).toContain("31 Oct 2026 is 1793455200 (14:00 UTC)");
    // The summary prints CSP's start time and the clock notes.
    expect(ps).toContain("'Weather FX: start time='");
  });

  it("is the track's date at that local time, in UTC", () => {
    // 22:00 in WA on 31 Oct 2026, run at 19:46 Perth (11:46 UTC): 14:00 UTC.
    expect(forcedDate(79200, 28800, new Date(Date.UTC(2026, 9, 31, 11, 46)))).toBe(1793455200);
    // Run just after midnight Perth (16:30 UTC the day before): the Perth date, 1 Nov 10:00.
    expect(forcedDate(36000, 28800, new Date(Date.UTC(2026, 9, 31, 16, 30)))).toBe(1793498400);
  });
});

// The Busselton Map app's clock (apps/lua/BusseltonMap/test_clock.lua) with a fake CSP.
function runClock(scenario: string): string[] {
  const p = spawnSync(LUA!, ["test/helpers/test_clock_harness.lua", "apps/lua/BusseltonMap/test_clock.lua", scenario], { encoding: "utf8" });
  expect(p.status, p.stderr).toBe(0);
  return p.stdout.split("\n").filter(Boolean);
}
const clockNotes = (lines: string[]) => lines.filter((l) => l.startsWith("BTEST,note,")).map((l) => l.split(",").slice(10).join(","));

describe("the Busselton Map app's test clock", () => {
  it("is loaded by the app and moves the clock as CSP Debug does", () => {
    const map = readFileSync("apps/lua/BusseltonMap/BusseltonMap.lua", "utf8");
    expect(map).toContain("require('test_clock')");
    expect(map).toContain("testClock.update(dt)");
    expect(readFileSync("apps/lua/BusseltonMap/test_clock.lua", "utf8")).toContain("pcall(ac.setWeatherTimeOffset, delta, true)");
  });

  it.skipIf(!LUA)("moves the clock from the PC's time to 22:00 in a test run and checks it took", () => {
    const lines = runClock("moves");
    expect(lines).toContain("CALL,setWeatherTimeOffset,29700,true");
    expect(lines).toContain("CALL,store,busselton.clock,moved");
    expect(clockNotes(lines)).toEqual(["clock (app): moved from 13:45 to 22:00", "clock (app): now 22:00"]);
  });

  it.skipIf(!LUA)("says exactly why when it can't", () => {
    expect(clockNotes(runClock("noapi"))).toEqual(["clock (app): move from 13:45 to 22:00 failed: ac.setWeatherTimeOffset is missing for Lua apps on this CSP"]);
    expect(clockNotes(runClock("inert"))[1]).toBe("clock (app): still at 13:45; not 22:00 (the move did nothing)");
  });

  it.skipIf(!LUA)("leaves the clock when race.ini worked, the track script moved it, or it isn't a test run", () => {
    expect(clockNotes(runClock("already"))).toEqual(["clock (app): already at 22:02 (race.ini worked)"]);
    expect(runClock("track_did")).toEqual([]);
    expect(runClock("idle")).toEqual([]);
  });
});
