-- The time of day for Busselton AC: run-test.ps1's -Time / -Night, and the map window's clock buttons.
--
-- Why a Lua app does this and not the track script: CSP's weather clock is moved with
-- ac.setWeatherTimeOffset(seconds, true) (relative), the call CSP's own CSP Debug app makes for its
-- time buttons (acc-lua-internal included-apps/CspDebug/CspDebug.lua). CSP gives that call to Lua
-- apps and tools only: it's in the ac_apps and ac_tools definitions and not in ac_track_script's
-- (CSP's generated SDK, dabinn/ac-lua-sdk-api ac_apps/lib.lua "Sets current time offset for
-- WeatherFX"). On CSP 0.2.12-preview1 b3467 the track script's call was nil (retest 4, 31 Oct), and
-- weather FX started at the PC's clock ("Weather FX: start time=..." in the CSP log) whatever
-- race.ini's SUN_ANGLE said. This app is installed with every track and loads with AC (LAZY = NONE),
-- so it can move the clock in a test run, whether or not its window is open.
--
-- In a test run (driver "Busselton Test", race.ini [BUSSELTON_TEST] TIME = seconds after midnight,
-- both written by run-test.ps1) it moves the clock there once the game's clock reads and is more
-- than 5 minutes off, checks it 3 s later, and logs "BTEST,note" lines that run-test.ps1 collects
-- from the CSP log into btest.csv. ac.store('busselton.clock', ...) tells the track script
-- (autotest.lua) it's done, so the clock is only moved once whichever script gets there first.

local M = {}

M.MIN_OFF = 300 -- seconds: closer than this is close enough
M.CHECK_AFTER = 3 -- seconds after a move before checking it took
M.SETTLE = 1 -- seconds after the app starts before the first try, to let weather FX start
M.KEY = 'busselton.clock'

local target, active = nil, false
local t, movedAt, checked, tried = 0, nil, false, false

local function clean(s) return (tostring(s):gsub(',', ';')) end

local function note(text)
  pcall(ac.log, 'BTEST,note,' .. string.format('%.2f', t) .. ',0,0,0,0,0,0,0,clock (app): ' .. clean(text))
end

--- Seconds after midnight as hh:mm.
function M.hhmm(s) return string.format('%02d:%02d', math.floor(s / 3600) % 24, math.floor(s / 60) % 60) end

--- How far `now` is from `want`, seconds, the short way round the clock (-12 h to +12 h).
function M.offBy(want, now) return (want - now + 43200) % 86400 - 43200 end

--- The game's time of day, seconds after midnight, or nil when it can't be read.
function M.now()
  local ok, v = pcall(function ()
    local sim = ac.getSim()
    return sim.timeHours * 3600 + sim.timeMinutes * 60 + (sim.timeSeconds or 0)
  end)
  return (ok and type(v) == 'number') and v or nil
end

--- Moves the clock by `delta` seconds. Returns true, or false and why not.
function M.shift(delta)
  if type(ac.setWeatherTimeOffset) ~= 'function' then
    return false, 'ac.setWeatherTimeOffset is missing for Lua apps on this CSP'
  end
  local ok, err = pcall(ac.setWeatherTimeOffset, delta, true)
  if not ok then return false, clean(err) end
  return true
end

--- Reads run-test's settings; call once when the app loads.
function M.init()
  t, movedAt, checked, tried = 0, nil, false, false
  target, active = nil, false
  local okD, driver = pcall(ac.getDriverName, 0)
  if not okD or driver ~= 'Busselton Test' then return end
  local ok, tod = pcall(function () return tonumber(ac.INIConfig.raceConfig():get('BUSSELTON_TEST', 'TIME', -1)) end)
  if ok and tod and tod >= 0 then target, active = tod % 86400, true end
end

--- Call every frame (script.update).
function M.update(dt)
  if not active then return end
  t = t + (dt or 0)
  if movedAt then
    if not checked and t - movedAt >= M.CHECK_AFTER then
      checked = true
      local now = M.now()
      if now and math.abs(M.offBy(target, now)) < M.MIN_OFF then note('now ' .. M.hhmm(now))
      else note('still at ' .. (now and M.hhmm(now) or '?') .. ', not ' .. M.hhmm(target) .. ' (the move did nothing)') end
      active = false
    end
    return
  end
  if tried or t < M.SETTLE then return end
  local okL, by = pcall(ac.load, M.KEY)
  if okL and by == 'moved' then active = false return end -- the track script did it
  local now = M.now()
  if not now then return end
  tried = true
  local delta = M.offBy(target, now)
  if math.abs(delta) < M.MIN_OFF then
    note('already at ' .. M.hhmm(now) .. ' (race.ini worked)')
    pcall(ac.store, M.KEY, 'moved')
    active = false
    return
  end
  local ok, why = M.shift(delta)
  if ok then
    pcall(ac.store, M.KEY, 'moved')
    note('moved from ' .. M.hhmm(now) .. ' to ' .. M.hhmm(target))
    movedAt = t
  else
    note('move from ' .. M.hhmm(now) .. ' to ' .. M.hhmm(target) .. ' failed: ' .. why)
    active = false
  end
end

return M
