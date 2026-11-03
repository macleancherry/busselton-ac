-- Runs apps/lua/BusseltonMap/test_clock.lua outside AC with a fake CSP, for test/autotestLua.test.ts.
-- Any Lua 5.1+ runs it (texlua does); CSP itself uses LuaJIT.
--
--   texlua test/helpers/test_clock_harness.lua <test_clock.lua> <scenario>
--
-- Prints every ac.log line, then "CALL,<name>,<args>" for the calls the test checks.
-- The fake game: track time zone +8 h, the game's timestamp is local time written as UTC (as CSP's
-- is), the PC's clock at 13:45 local, run-test asks for 22:00, MAX_SECONDS = 60. 3 s on the setup
-- screen first (the clock reads 05:45 there, the start time without the time zone, as in retest 6),
-- then 60 s of session at 0.05 s a frame.
-- Scenarios:
--   moves        the exact-time call works: the app sets the clock once and it stays
--   offset_only  no exact-time call (older CSP): CSP Debug's relative offset call instead
--   noapi        neither call: says so
--   inert        both calls are there but do nothing: tries the other call, gives up after MAX_SETS
--   pure_live    the clock is right, then at 20 s another script (Pure Planner's Live plan) sets it
--                back to the PC's clock: the app says so and puts it back
--   already      the clock is at 22:02 already (race.ini worked): leaves it
--   idle         a normal session (driver not "Busselton Test"): does nothing

local path, scenario = arg[1], arg[2]
local TZ = 8 * 3600
local DAY0 = 1793664000 -- 3 Nov 2026 00:00, local time written as UTC
local clock = 13 * 3600 + 45 * 60 -- local seconds after midnight
if scenario == 'already' or scenario == 'pure_live' then clock = 22 * 3600 + 2 * 60 end
local menu = true
local stored = {}
local function out(s) io.write(s, '\n') end

local function shown()
  -- On the setup screen the clock reads without the time zone (retest 6).
  if menu then return (clock - TZ) % 86400 end
  return clock
end
local sim = setmetatable({}, { __index = function (_, k)
  if k == 'timeHours' then return math.floor(shown() / 3600) end
  if k == 'timeMinutes' then return math.floor(shown() / 60) % 60 end
  if k == 'timeSeconds' then return math.floor(shown()) % 60 end
  if k == 'timestamp' then return DAY0 + math.floor(clock) end
  if k == 'isInMainMenu' then return menu end
  if k == 'isReplayActive' or k == 'isPaused' then return false end
  return nil
end })
ac = {
  log = out,
  getSim = function () return sim end,
  getDriverName = function () return scenario == 'idle' and 'Mac' or 'Busselton Test' end,
  store = function (k, v) out(string.format('CALL,store,%s,%s', k, tostring(v))); stored[k] = v end,
  load = function (k) return stored[k] end,
  getTrackTimezoneBaseDst = function () return { x = TZ, y = 0 } end,
  setWeatherExactUTC0Timestamp = function (utc, flag)
    out(string.format('CALL,setWeatherExactUTC0Timestamp,%d,%s', utc, tostring(flag)))
    if scenario == 'inert' then return end
    clock = (utc + TZ - DAY0) % 86400
  end,
  setWeatherTimeOffset = function (v, relative)
    out(string.format('CALL,setWeatherTimeOffset,%d,%s', v, tostring(relative)))
    if scenario == 'inert' then return end
    if relative then clock = (clock + v) % 86400 else clock = v % 86400 end
  end,
  INIConfig = {
    raceConfig = function ()
      return { get = function (_, s, k, d)
        if s == 'BUSSELTON_TEST' and k == 'TIME' then return 79200 end
        if s == 'BUSSELTON_TEST' and k == 'MAX_SECONDS' then return 60 end
        return d
      end }
    end,
  },
}
if scenario == 'noapi' then ac.setWeatherTimeOffset = nil; ac.setWeatherExactUTC0Timestamp = nil end
if scenario == 'offset_only' then ac.setWeatherExactUTC0Timestamp = nil end

local M = assert(loadfile(path))()
M.init()
for _ = 1, 60 do M.update(0.05) end -- 3 s on the setup screen
menu = false
local tSession = 0
for _ = 1, 1300 do -- 65 s
  M.update(0.05)
  tSession = tSession + 0.05
  clock = (clock + 0.05) % 86400
  -- Pure Planner's Live plan: the PC's clock, 20 s in.
  if scenario == 'pure_live' and math.abs(tSession - 20) < 0.025 then clock = 13 * 3600 + 46 * 60 end
end
