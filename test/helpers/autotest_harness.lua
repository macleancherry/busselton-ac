-- Runs src/core/lua/autotest.lua outside AC with a fake CSP (ac, sim, car, physics), for
-- test/autotestLua.test.ts. Any Lua 5.1+ runs it (texlua does); CSP itself uses LuaJIT.
--
--   texlua test/helpers/autotest_harness.lua <autotest.lua> <scenario>
--
-- Prints every ac.log line, then "CALL,<name>,<args>" for the calls the test checks.
-- Scenarios:
--   ab_finish       point to point, run-test's MAX_SECONDS=2000: the car crosses the finish line
--   default_limit   point to point with no race.ini setting on a 12,196 m road: limit from the length
--   night           a circuit at 13:45 with race.ini TIME=79200 (22:00): the script moves the clock
--   night_noapi     the same where CSP has no ac.setWeatherTimeOffset for track scripts

local path, scenario = arg[1], arg[2]
local f = assert(io.open(path, 'r'))
local src = f:read('*a')
f:close()

local night = scenario == 'night' or scenario == 'night_noapi'
local closed = night
src = src:gsub('__CLOSED__', closed and 'true' or 'false')
local limits = {}
for i = 1, 100 do limits[i] = '60' end
src = src:gsub('__LIMITS__', table.concat(limits, ', '))

local race = {}
if scenario == 'ab_finish' then race = { BUSSELTON_TEST = { MAX_SECONDS = 2000 } } end
if night then race = { BUSSELTON_TEST = { MAX_SECONDS = 600, TIME = 79200 } } end

local clock = 13 * 3600 + 45 * 60 -- the game's time of day, seconds
local finishedAt = nil
local function out(s) io.write(s, '\n') end

local function wheel() return { surfaceValidTrack = true } end
car = {
  position = { x = 0, y = 0, z = 0 }, splinePosition = 0, speedKmh = 0, isAIControlled = true,
  lapCount = 0, headlightsActive = false, wheels = { [0] = wheel(), wheel(), wheel(), wheel() },
}
sim = {
  isInMainMenu = false, isReplayActive = false, isPaused = false, carsCount = 1,
  trackLengthM = 12196, rainIntensity = 0, rainWetness = 0, rainWater = 0,
}
setmetatable(sim, { __index = function (_, k)
  if k == 'timeHours' then return math.floor(clock / 3600) end
  if k == 'timeMinutes' then return math.floor(clock / 60) % 60 end
  if k == 'timeSeconds' then return math.floor(clock) % 60 end
  return nil
end })
physics = {
  setCarAutopilot = function () end,
  setAITopSpeed = function () end,
}
ac = {
  log = function (s)
    out(s)
    if finishedAt == nil and s:find('^BTEST,finish,') then finishedAt = 0 end
  end,
  getDriverName = function () return 'Busselton Test' end,
  getTrackDataFilename = function () return nil end,
  makeScreenshot = function () end,
  getSunAngle = function () return (clock / 3600 - 13) * 16 end,
  setHeadlights = function () end,
  tryToStart = function () end,
  shutdownAssettoCorsa = function () out('CALL,shutdown') end,
  getCar = function () return nil end,
  setWeatherTimeOffset = function (v, relative)
    out(string.format('CALL,setWeatherTimeOffset,%d,%s', v, tostring(relative)))
    if relative then clock = (clock + v) % 86400 else clock = v % 86400 end
  end,
  INIConfig = {
    raceConfig = function ()
      return { get = function (_, s, k, d) local v = race[s] and race[s][k]; if v == nil then return d end return v end }
    end,
  },
}
if scenario == 'night_noapi' then ac.setWeatherTimeOffset = nil end
io.load = function () return nil end
script = {}

assert(load(src, '=autotest.lua'))()

-- Drive: 60 km/h along the road; on a point-to-point road AC counts a lap at the finish line (97%).
local dt, t = 0.05, 0
local length = 12196
local travelled = 0
while t < 4000 do
  t = t + dt
  if t > 4 then
    car.speedKmh = 60
    travelled = travelled + 60 / 3.6 * dt
  end
  local sp = math.min(1, travelled / length)
  if not closed and car.splinePosition < 0.97 and sp >= 0.97 then car.lapCount = car.lapCount + 1 end
  car.splinePosition = sp
  if closed and sp >= 1 then travelled = 0; car.lapCount = car.lapCount + 1 end
  script.update(dt)
  -- Stop a few seconds after the finish is logged (run-test.ps1 closes AC then).
  if finishedAt then
    finishedAt = finishedAt + dt
    if finishedAt > 5 then break end
  end
  if sp >= 1 and not closed and car.speedKmh > 0 then car.speedKmh = 0 end
end
