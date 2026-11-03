-- The time of day for Busselton AC: run-test.ps1's -Time / -Night, and the map window's clock buttons.
--
-- Why a Lua app does this and not the track script: CSP gives the weather clock calls to Lua apps and
-- tools only (ac_apps / ac_tools in CSP's SDK, not ac_track_script; nil for the track script on CSP
-- 0.2.12-preview1 b3467, retest 4).
--
-- What retest 6 (3 Nov) showed: run-test's race.ini __CM_DATE works. CSP's weather FX starts at the
-- time asked for ("Weather FX: start time=7200" = 02:00 UTC = 10:00 in WA). Then the game ends up at
-- the PC's clock anyway. Two things went wrong:
--   1. This app read the clock while AC was still loading (the setup screen), when CSP's clock gave
--      the start time without the track's time zone (02:00, not 10:00), so it "moved" a clock that
--      was already right by 8 hours.
--   2. Something then set the clock to the PC's time. Pure Planner (apps/lua/PurePlanner, Pure 2.57,
--      LAZY = NONE, so it runs whether or not its window is open) does exactly that when its Live
--      plan is active with "use location time" on (its default): plan/plan_manager.lua
--      PLAN_MGR_update_Live calls ac.setWeatherExactUTC0Timestamp(<the PC's UTC time>) once its live
--      weather data arrives, which can be any time after the session starts, and again as a
--      "failsafe" if the clock is more than 5 s from that. It follows the game's clock after that.
--
-- So in a test run (driver "Busselton Test", race.ini [BUSSELTON_TEST] TIME = seconds after local
-- midnight, both written by run-test.ps1) this app:
--   - waits until the session is running (not the setup screen, not paused, not a replay),
--   - logs what it sees once (game clock, timestamp, time zone, which calls CSP gives it),
--   - then checks the clock every second for the whole run. Whenever it's more than 5 minutes off
--     the time asked for, it sets it there: ac.setWeatherExactUTC0Timestamp (the call Pure Planner
--     uses, absolute, CSP 0.2.1p51 and later) first, ac.setWeatherTimeOffset(delta, true) (CSP
--     Debug's time buttons, relative) if that didn't take. At most MAX_SETS times.
--   - logs every move, every jump it didn't make (something else set the clock), and the clock at
--     the end of the watch, as "BTEST,note" lines that run-test.ps1 collects into btest.csv.
-- ac.store('busselton.clock', 'app') tells the track script (autotest.lua) the app has the clock.

local M = {}

M.MIN_OFF = 300 -- seconds: closer than this is close enough
M.SETTLE = 2 -- seconds of running session before the first look, to let weather FX settle
M.CHECK_EVERY = 1 -- seconds between looks
M.RETRY_AFTER = 3 -- seconds after a move before moving again
M.MAX_SETS = 6 -- moves at most, so a fight with another script can't go on for ever
M.WATCH = 900 -- seconds to keep watching when race.ini has no MAX_SECONDS
M.KEY = 'busselton.clock'

local target, active, watch, tz = nil, false, M.WATCH, nil
local t, lastLook, lastSet, sets, state, greeted, ended, gaveUp, useOffset = 0, -1, -1e9, 0, nil, false, false, false, false

local function clean(s) return (tostring(s):gsub(',', ';')) end

local function note(text)
  pcall(ac.log, 'BTEST,note,' .. string.format('%.2f', t) .. ',0,0,0,0,0,0,0,clock (app): ' .. clean(text))
end

--- Seconds after midnight as hh:mm.
function M.hhmm(s) return string.format('%02d:%02d', math.floor(s / 3600) % 24, math.floor(s / 60) % 60) end

--- How far `now` is from `want`, seconds, the short way round the clock (-12 h to +12 h).
function M.offBy(want, now) return (want - now + 43200) % 86400 - 43200 end

--- The game's time of day, seconds after local midnight, or nil when it can't be read.
function M.now()
  local ok, v = pcall(function ()
    local sim = ac.getSim()
    return sim.timeHours * 3600 + sim.timeMinutes * 60 + (sim.timeSeconds or 0)
  end)
  return (ok and type(v) == 'number') and v or nil
end

local function simField(k)
  local ok, v = pcall(function () return ac.getSim()[k] end)
  if ok then return v end
  return nil
end

--- The track's time zone, seconds east of UTC (base plus summer time): CSP's, else race.ini's.
local function trackTimezone()
  local ok, v = pcall(function ()
    local z = ac.getTrackTimezoneBaseDst()
    return z.x + z.y
  end)
  if ok and type(v) == 'number' then return v, 'CSP' end
  local ok2, r = pcall(function () return tonumber(ac.INIConfig.raceConfig():get('LIGHTING', '__TRACK_TIMEZONE_OFFSET', '')) end)
  if ok2 and r then return r, 'race.ini' end
  return nil, 'unknown'
end

--- Moves the clock by `delta` seconds (CSP Debug's relative call). Returns true, or false and why not.
function M.shift(delta)
  if type(ac.setWeatherTimeOffset) ~= 'function' then
    return false, 'ac.setWeatherTimeOffset is missing for Lua apps on this CSP'
  end
  local ok, err = pcall(ac.setWeatherTimeOffset, delta, true)
  if not ok then return false, clean(err) end
  return true
end

--- Sets the clock `delta` seconds on, as an exact UTC time (the call Pure Planner makes). The game's
--- timestamp is the track's local time written as if it were UTC (Pure Planner's time_handling.lua
--- subtracts the time zone the same way), so UTC = timestamp + delta - time zone.
function M.setExact(delta)
  if type(ac.setWeatherExactUTC0Timestamp) ~= 'function' then return false, 'no ac.setWeatherExactUTC0Timestamp' end
  local ts = simField('timestamp')
  if type(ts) ~= 'number' then return false, 'the game timestamp is unreadable' end
  if not tz then return false, 'the track time zone is unknown' end
  local ok, err = pcall(ac.setWeatherExactUTC0Timestamp, ts + delta - tz, true)
  if not ok then return false, clean(err) end
  return true
end

--- Reads run-test's settings; call once when the app loads.
function M.init()
  t, lastLook, lastSet, sets, state, greeted, ended, gaveUp, useOffset = 0, -1, -1e9, 0, nil, false, false, false, false
  target, active, watch = nil, false, M.WATCH
  local okD, driver = pcall(ac.getDriverName, 0)
  if not okD or driver ~= 'Busselton Test' then return end
  local ok, tod = pcall(function () return tonumber(ac.INIConfig.raceConfig():get('BUSSELTON_TEST', 'TIME', -1)) end)
  if ok and tod and tod >= 0 then target, active = tod % 86400, true end
  if not active then return end
  local okM, m = pcall(function () return tonumber(ac.INIConfig.raceConfig():get('BUSSELTON_TEST', 'MAX_SECONDS', 0)) end)
  if okM and m and m > 0 then watch = m end
  -- The track script leaves the clock to the app from now on.
  pcall(ac.store, M.KEY, 'app')
end

local function move(now, off, why)
  sets = sets + 1
  lastSet = t
  local ok, err, how
  if not useOffset then
    ok, err = M.setExact(off)
    how = 'exact UTC time'
    if not ok then
      local ok2, err2 = M.shift(off)
      if ok2 then ok, how = true, 'offset (exact call failed: ' .. err .. ')' else err = err .. '; offset: ' .. err2 end
    end
  else
    ok, err = M.shift(off)
    how = 'offset'
  end
  if ok then
    note(string.format('%s: set from %s to %s (%s; move %d of %d)', why, M.hhmm(now), M.hhmm(target), how, sets, M.MAX_SETS))
  else
    note(string.format('%s: setting from %s to %s failed: %s', why, M.hhmm(now), M.hhmm(target), err))
    gaveUp = true
  end
end

--- Call every frame (script.update).
function M.update(dt)
  if not active or ended then return end
  -- Only while the session runs: on the setup screen CSP's clock isn't settled yet (retest 6 read
  -- 02:00, the start time without the time zone, there).
  if simField('isInMainMenu') or simField('isReplayActive') or simField('isPaused') then return end
  t = t + (dt or 0)
  if t < M.SETTLE or t - lastLook < M.CHECK_EVERY then return end
  lastLook = t
  local now = M.now()
  if not now then return end
  if not greeted then
    greeted = true
    local zone, from = trackTimezone()
    tz = zone
    local ts = simField('timestamp')
    note(string.format('asked for %s; game clock %s; timestamp %s; time zone %s (%s); exact-time call %s; offset call %s; watching %d s',
      M.hhmm(target), M.hhmm(now), type(ts) == 'number' and string.format('%d', ts) or '?',
      zone and string.format('%+.1f h', zone / 3600) or '?', from,
      type(ac.setWeatherExactUTC0Timestamp) == 'function' and 'yes' or 'no',
      type(ac.setWeatherTimeOffset) == 'function' and 'yes' or 'no', watch))
  end
  local off = M.offBy(target, now)
  if t >= watch then
    ended = true
    note(string.format('at %s after %d s; moves: %d', M.hhmm(now), math.floor(t), sets))
    return
  end
  if math.abs(off) < M.MIN_OFF then
    if state == nil then note('already at ' .. M.hhmm(now) .. ' (race.ini worked)')
    elseif state ~= 'on' then note('now ' .. M.hhmm(now)) end
    state = 'on'
    return
  end
  -- Off by more than 5 minutes.
  if state == 'on' then
    note(string.format('jumped to %s at %.0f s: another script set the clock (Pure Planner does this with its Live plan and "use location time" on)', M.hhmm(now), t))
    state = 'jumped'
  end
  if gaveUp or t - lastSet < M.RETRY_AFTER then return end
  if sets >= M.MAX_SETS then
    gaveUp = true
    note(string.format('gave up after %d moves: still at %s, not %s', sets, M.hhmm(now), M.hhmm(target)))
    return
  end
  local why = 'off at the start'
  if state == 'jumped' then why = 'put back'
  elseif state == 'moved' then
    why = 'the last move did nothing'
    -- Try the other call this time.
    useOffset = not useOffset
  end
  move(now, off, why)
  if not gaveUp then state = 'moved' end
end

return M
