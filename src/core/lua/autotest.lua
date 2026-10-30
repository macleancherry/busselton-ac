-- Busselton AC automatic test run (CSP track script).
--
-- Does nothing unless the driver is named "Busselton Test" (scripts/windows/run-test.ps1 sets
-- that), so it's harmless in normal driving. In a test run it leaves the setup screen (presses
-- Drive), hands the player's car to the AI,
-- writes the car's state four times a second to the CSP log (lines starting "BTEST,"), takes a
-- screenshot every 5% of the lap and whenever the car leaves the road or gets stuck, and quits AC
-- after a lap, at the end of a point-to-point road, when stuck, or after MAX_TIME seconds.
--
-- With AI opponents (run-test.ps1 -Cars N) it also logs every other car twice a second ("cpos",
-- note "car=<i>"), each car leaving the road ("coffroad"), getting stuck ("cstuck") and touching
-- another car ("contact", note "car=<i>;with=<j>"), and waits for the others to finish their lap
-- (or GRACE seconds) after the player's car is done. The "env" line at the start says the time of
-- day, the number of cars and CSP's rain, so a night run (-Night) or a rain run (-Rain) can be checked.

local MAX_TIME = 480
local GRACE = 90
local CLOSED = __CLOSED__ -- filled in by the build: a circuit (true) or point to point
-- The speed limit at each 1% of the lap, km/h (filled in by the build). The AI hints only slow it for
-- corners, so on a straight it floors it (128 km/h on estate streets); this holds it to the limit.
local LIMITS = { __LIMITS__ }
local capWarned = false
local SHOTS = {}
-- On a map with several layouts the track script is shared, so each layout's own data/autotest.ini
-- (CLOSED=, LIMITS=comma list) wins over the values above, which are the main layout's.
pcall(function ()
  local path = ac.getTrackDataFilename('autotest.ini')
  local text = path and io.load(path)
  if type(text) ~= 'string' then return end
  local closed = string.match(text, 'CLOSED%s*=%s*(%a+)')
  if closed then CLOSED = closed == 'true' or closed == '1' end
  -- SHOTS=fraction:name,...: an extra screenshot as the car passes each landmark.
  local shots = string.match(text, 'SHOTS%s*=%s*([^\r\n]+)')
  if shots then
    for f, n in string.gmatch(shots, '([%d%.]+):([%w_]+)') do SHOTS[#SHOTS + 1] = { at = tonumber(f), name = n, done = false } end
  end
  local list = string.match(text, 'LIMITS%s*=%s*([%d%.,%s]+)')
  if list then
    local lim = {}
    for v in string.gmatch(list, '[%d%.]+') do lim[#lim + 1] = tonumber(v) end
    if #lim > 0 then LIMITS = lim end
  end
end)
local active = ac.getDriverName(0) == 'Busselton Test'
ac.log('BTEST,loaded,0,0,0,0,0,0,0,0,driver=' .. tostring(ac.getDriverName(0)) .. (active and ' (test run)' or ' (idle)'))
local t, lastLog, lastShot, offFor, stuckFor = 0, -1, -1, 0, 0
local started, offNow, finishing, quitAt = false, false, false, nil
local laps0 = 0
local menuWait = 0
local pastHalf = false -- a lap only counts once the car has been halfway round
-- Frame rate: frames and the slowest frame over each 5 s, and over the whole drive.
local fpsFrames, fpsTime, fpsWorst, allFrames, allTime, allWorst = 0, 0, 0, 0, 0, 0
-- AI opponents (index 1 and up): their state, and when the player's car was done.
local nCars = 1
local others = {}
local lastOthers = -1
local playerDoneAt, playerWhy = nil, nil

local function wheelsOn(c)
  local n = 0
  for i = 0, 3 do
    local ok, valid = pcall(function () return c.wheels[i].surfaceValidTrack end)
    if ok and valid then n = n + 1 end
  end
  return n
end

local function onRoad() return wheelsOn(car) end

local function clean(s) return (tostring(s):gsub(',', ';')) end

local function log(kind, extra)
  local p = car.position
  ac.log(string.format('BTEST,%s,%.2f,%.5f,%.2f,%.2f,%.2f,%.1f,%d,%d,%s', kind, t, car.splinePosition,
    p.x, p.y, p.z, car.speedKmh, onRoad(), car.isAIControlled and 1 or 0, extra or ''))
end

-- The same line for any car, with "car=<i>" first in the note.
local function logCar(kind, i, c, extra)
  local p = c.position
  ac.log(string.format('BTEST,%s,%.2f,%.5f,%.2f,%.2f,%.2f,%.1f,%d,%d,car=%d%s', kind, t, c.splinePosition,
    p.x, p.y, p.z, c.speedKmh, wheelsOn(c), c.isAIControlled and 1 or 0, i, extra and (';' .. extra) or ''))
end

-- The other car this one is touching (an index), or nil. CSP's collidedWith is -1 for none.
local function touching(c, self)
  local ok, w = pcall(function () return c.collidedWith end)
  if ok and type(w) == 'number' and w >= 0 and w ~= self and w < nCars then return w end
  return nil
end

local function shot(tag)
  local ok, err = pcall(ac.makeScreenshot, nil, { accumulation = false }, nil)
  -- Screenshots have never come out on the workstation: say why (or that the call itself was fine).
  log('shot', tag .. (ok and '' or (' error: ' .. clean(err))))
end

-- Time of day, sun and cars, for the report (a night run checks it really was night).
local function logEnv(kind)
  local ok, hh = pcall(function () return sim.timeHours end)
  local ok2, mm = pcall(function () return sim.timeMinutes end)
  local ok3, sun = pcall(function () return ac.getSunAngle() end)
  local ok4, lights = pcall(function () return car.headlightsActive end)
  -- CSP's rain (0..1): how hard it's raining, how wet the track is, how much water stands on it.
  local function num(f)
    local okR, v = pcall(f)
    return (okR and type(v) == 'number') and string.format('%.2f', v) or '?'
  end
  log(kind, string.format('time=%s;sun=%s;cars=%d;headlights=%s;rain=%s;wet=%s;water=%s',
    (ok and ok2 and type(hh) == 'number' and type(mm) == 'number') and string.format('%02d:%02d', math.floor(hh), math.floor(mm)) or '?',
    (ok3 and type(sun) == 'number') and string.format('%.1f', sun) or '?', nCars,
    ok4 and tostring(lights) or '?',
    num(function () return sim.rainIntensity end), num(function () return sim.rainWetness end),
    num(function () return sim.rainWater end)))
end

local function finish(why)
  if finishing then return end
  finishing = true
  if allTime > 0 then
    log('fpsall', string.format('avg %.1f; slowest frame %.0f ms', allFrames / allTime, allWorst * 1000))
  end
  for i, o in pairs(others) do
    local c = ac.getCar(i)
    if c then logCar('cdone', i, c, o.done and ('done=' .. o.done) or 'done=no') end
  end
  logEnv('envend')
  log('finish', why)
  shot('finish')
  quitAt = t + 3
  -- run-test.ps1 watches the log for this line and closes AC (ac.shutdownAssettoCorsa does
  -- nothing on some CSP versions); keep logging until then.
end

-- The player's car is done: alone, that ends the run; with opponents, wait for them.
local function done(why)
  if nCars <= 1 then finish(why) return end
  if playerDoneAt then return end
  playerDoneAt, playerWhy = t, why
  log('playerdone', why)
end

-- Opponents: positions twice a second, and off-road, stuck, contact and lap events as they happen.
local function updateOthers(dt)
  local logNow = t - lastOthers >= 0.5
  if logNow then lastOthers = t end
  local allDone = true
  for i = 1, nCars - 1 do
    local c = ac.getCar(i)
    local o = others[i]
    if c and o then
      if logNow then logCar('cpos', i, c) end
      local lim = LIMITS[math.min(#LIMITS, math.floor(c.splinePosition * 100) + 1)]
      if lim then pcall(physics.setAITopSpeed, i, lim + 5) end
      o.off = wheelsOn(c) <= 1 and o.off + dt or 0
      if o.off > 0.5 and not o.offNow then
        o.offNow = true
        logCar('coffroad', i, c)
      elseif o.off == 0 then
        o.offNow = false
      end
      o.stuck = (c.speedKmh < 3 and t > 20) and o.stuck + dt or 0
      if o.stuck > 10 and not o.stuckNow then
        o.stuckNow = true
        logCar('cstuck', i, c)
      elseif c.speedKmh > 10 then
        o.stuckNow = false
      end
      local w = touching(c, i)
      if w and (w ~= o.with or t - o.withAt > 2) then logCar('contact', i, c, 'with=' .. w) end
      if w then o.with, o.withAt = w, t end
      local sp = c.splinePosition
      if not o.half and sp > 0.4 and sp < 0.6 then o.half, o.laps0 = true, c.lapCount end
      if not o.done then
        if CLOSED and o.half and c.lapCount > o.laps0 then o.done = 'lap'
        elseif not CLOSED and sp > 0.98 then o.done = 'end of road' end
        if o.done then logCar('clap', i, c, o.done) end
      end
      if not o.done and not o.stuckNow then allDone = false end
    end
  end
  return allDone
end

-- The player's own contacts and stops, logged like the others' when there are opponents.
local pWith, pWithAt, pStuck, pStuckNow = nil, -10, 0, false
local function playerEvents(dt)
  local w = touching(car, 0)
  if w and (w ~= pWith or t - pWithAt > 2) then logCar('contact', 0, car, 'with=' .. w) end
  if w then pWith, pWithAt = w, t end
  pStuck = (car.speedKmh < 3 and t > 20) and pStuck + dt or 0
  if pStuck > 10 and not pStuckNow then
    pStuckNow = true
    logCar('cstuck', 0, car)
  elseif car.speedKmh > 10 then
    pStuckNow = false
  end
end

function script.update(dt)
  if not active then return end
  -- AC opens on the setup screen and waits for "Drive": press it (every few seconds until it takes).
  if sim.isInMainMenu then
    menuWait = menuWait + dt
    if menuWait > 3 then
      menuWait = 0
      local ok, err = pcall(ac.tryToStart)
      ac.log('BTEST,menu,' .. string.format('%.2f', t) .. ',0,0,0,0,0,0,0,' .. (ok and 'pressed drive' or ('tryToStart failed: ' .. clean(err))))
    end
    return
  end
  if sim.isReplayActive or sim.isPaused then return end
  t = t + dt
  if quitAt and t > quitAt then
    quitAt = nil
    pcall(ac.shutdownAssettoCorsa)
  end
  if not started then
    if t < 4 then return end
    local okN, n = pcall(function () return sim.carsCount end)
    nCars = (okN and type(n) == 'number' and n > 1) and n or 1
    for i = 1, nCars - 1 do
      others[i] = { off = 0, offNow = false, stuck = 0, stuckNow = false, with = nil, withAt = -10, half = false, laps0 = 0, done = nil }
    end
    if nCars > 1 then MAX_TIME = MAX_TIME + GRACE end
    local ok, err = pcall(physics.setCarAutopilot, true, false)
    -- At night the AI may not switch the lights on by itself.
    pcall(function () ac.setHeadlights(true) end)
    log('start', ok and 'autopilot' or ('autopilot failed: ' .. clean(err)))
    logEnv('env')
    laps0 = car.lapCount
    started = true
  end
  if t - lastLog >= 0.25 then
    lastLog = t
    log(finishing and 'after' or 'pos')
  end
  if finishing then return end
  local othersDone = nCars > 1 and updateOthers(dt)
  if nCars > 1 then playerEvents(dt) end
  if playerDoneAt then
    if othersDone then finish(playerWhy)
    elseif t - playerDoneAt > GRACE then finish(playerWhy .. '; others still driving')
    elseif t > MAX_TIME then finish('timeout') end
    return
  end
  -- Hold the AI to the speed limit (plus a little, as people drive).
  local lim = LIMITS[math.min(#LIMITS, math.floor(car.splinePosition * 100) + 1)]
  if lim then
    local ok, err = pcall(physics.setAITopSpeed, 0, lim + 5)
    if not ok and not capWarned then
      capWarned = true
      log('note', 'speed cap failed: ' .. clean(err))
    end
  end
  fpsFrames, fpsTime, fpsWorst = fpsFrames + 1, fpsTime + dt, math.max(fpsWorst, dt)
  allFrames, allTime, allWorst = allFrames + 1, allTime + dt, math.max(allWorst, dt)
  if fpsTime >= 5 then
    log('fps', string.format('avg %.1f; slowest frame %.0f ms', fpsFrames / fpsTime, fpsWorst * 1000))
    fpsFrames, fpsTime, fpsWorst = 0, 0, 0
  end
  local sp = car.splinePosition
  -- Count laps from halfway round: the car starts behind the line, so its first crossing
  -- (a few seconds in) isn't a lap.
  if not pastHalf and sp > 0.4 and sp < 0.6 then
    pastHalf = true
    laps0 = car.lapCount
  end
  -- Landmarks: once, as the car goes past each one's point (within a short window, so a lap's
  -- start doesn't trigger every shot at once).
  for _, s in ipairs(SHOTS) do
    if not s.done and sp >= s.at and sp < s.at + 0.02 then
      s.done = true
      shot('landmark_' .. s.name)
    end
  end
  local bucket = math.floor(car.splinePosition * 20)
  if bucket ~= lastShot then
    lastShot = bucket
    shot('lap' .. bucket * 5)
  end
  -- Off the road: at most one wheel on a valid track surface for half a second.
  offFor = onRoad() <= 1 and offFor + dt or 0
  if offFor > 0.5 and not offNow then
    offNow = true
    log('offroad')
    shot('offroad')
  elseif offFor == 0 then
    offNow = false
  end
  stuckFor = (car.speedKmh < 3 and t > 15) and stuckFor + dt or 0
  if stuckFor > 10 then done('stuck') end
  -- A lap only on a circuit: on a point-to-point road the finish line comes before the end of the
  -- road (the run-off), and crossing it bumps the lap count too.
  if CLOSED and pastHalf and car.lapCount > laps0 then done('lap') end
  if not CLOSED and car.splinePosition > 0.98 and car.speedKmh < 5 then done('end of road') end
  if not CLOSED and car.splinePosition > 0.995 then done('end of road') end
  if t > MAX_TIME then finish('timeout') end
end
