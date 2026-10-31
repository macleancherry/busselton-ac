-- Runs apps/lua/BusseltonMap/test_clock.lua outside AC with a fake CSP, for test/testClock.test.ts.
-- Any Lua 5.1+ runs it (texlua does); CSP itself uses LuaJIT.
--
--   texlua test/helpers/test_clock_harness.lua <test_clock.lua> <scenario>
--
-- Prints every ac.log line, then "CALL,<name>,<args>" for the calls the test checks.
-- Scenarios (the PC's clock at 13:45, run-test asks for 22:00):
--   moves        a test run on a CSP that gives apps ac.setWeatherTimeOffset: the app moves the clock
--   noapi        the same with no ac.setWeatherTimeOffset: says so
--   inert        the call is there but the clock doesn't move: says so after the check
--   already      the clock is at 22:00 already (race.ini worked): leaves it
--   track_did    the track script already moved it (ac.store 'busselton.clock'): leaves it
--   idle         a normal session (driver not "Busselton Test"): does nothing

local path, scenario = arg[1], arg[2]
local clock = 13 * 3600 + 45 * 60
if scenario == 'already' then clock = 22 * 3600 + 2 * 60 end
local stored = {}
if scenario == 'track_did' then stored['busselton.clock'] = 'moved' end
local function out(s) io.write(s, '\n') end

local sim = setmetatable({}, { __index = function (_, k)
  if k == 'timeHours' then return math.floor(clock / 3600) end
  if k == 'timeMinutes' then return math.floor(clock / 60) % 60 end
  if k == 'timeSeconds' then return math.floor(clock) % 60 end
  return nil
end })
ac = {
  log = out,
  getSim = function () return sim end,
  getDriverName = function () return scenario == 'idle' and 'Mac' or 'Busselton Test' end,
  store = function (k, v) out(string.format('CALL,store,%s,%s', k, tostring(v))); stored[k] = v end,
  load = function (k) return stored[k] end,
  setWeatherTimeOffset = function (v, relative)
    out(string.format('CALL,setWeatherTimeOffset,%d,%s', v, tostring(relative)))
    if scenario == 'inert' then return end
    if relative then clock = (clock + v) % 86400 else clock = v % 86400 end
  end,
  INIConfig = {
    raceConfig = function ()
      return { get = function (_, s, k, d) if s == 'BUSSELTON_TEST' and k == 'TIME' then return 79200 end return d end }
    end,
  },
}
if scenario == 'noapi' then ac.setWeatherTimeOffset = nil end

local M = assert(loadfile(path))()
M.init()
for _ = 1, 200 do M.update(0.05) end -- 10 s
