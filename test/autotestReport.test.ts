// The automatic AI test: the track script (src/core/lua/autotest.lua), the workstation script
// (scripts/windows/run-test.ps1) and the report (scripts/check/autotest_report.py) agree on the
// drive log, and the report's own tests pass (when Python has numpy and Pillow).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lua = readFileSync("src/core/lua/autotest.lua", "utf8");
const ps = readFileSync("scripts/windows/run-test.ps1", "utf8");
const py = readFileSync("scripts/check/autotest_report.py", "utf8");

const hasPython = (() => {
  const p = spawnSync("python3", ["-I", "-c", "import numpy, PIL"], { encoding: "utf8" });
  return p.status === 0;
})();

describe("automatic AI test", () => {
  it("keeps the build's placeholders", () => {
    expect(lua).toContain("__CLOSED__");
    expect(lua).toContain("__LIMITS__");
  });

  it("writes the columns run-test.ps1 puts in btest.csv's header", () => {
    const header = ps.match(/"(kind,time,spline,[^"]+)"/)![1].split(",");
    for (const fmt of lua.matchAll(/'BTEST,(%s,[^']+)'/g)) {
      expect(fmt[1].split(",").length).toBe(header.length);
    }
  });

  it("logs every kind the report reads", () => {
    const read = new Set([...py.matchAll(/"kind"\] == "(\w+)"/g)].map((m) => m[1]));
    const inTuples = [...py.matchAll(/"kind"\] in \(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/"(\w+)"/g)].map((k) => k[1]));
    inTuples.forEach((k) => read.add(k));
    const logged = new Set([...lua.matchAll(/(?:log|logCar|logEnv)\('(\w+)'|log\(finishing and '\w+' or '(\w+)'\)/g)].map((m) => m[1] ?? m[2]));
    for (const k of read) expect(logged, k).toContain(k);
  });

  it("has night and AI-car switches, single car by default", () => {
    expect(ps).toMatch(/\[switch\]\$Night/);
    expect(ps).toMatch(/\[int\]\$Cars = 0/);
    expect(ps).toContain("__CM_UNCLAMPED_SUN_ANGLE");
  });

  it.skipIf(!hasPython)("report tests pass on the fixtures", () => {
    const p = spawnSync("python3", ["-I", "scripts/check/test_autotest_report.py"], { encoding: "utf8" });
    expect(p.status, p.stdout + p.stderr).toBe(0);
  }, 60_000);
});
