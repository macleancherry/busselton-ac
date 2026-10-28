-- Busselton AC automatic test run (CSP track script).
--
-- Does nothing unless the driver is named "Busselton Test" (scripts/windows/run-test.ps1 sets
-- that), so it's harmless in normal driving. In a test run it leaves the setup screen (presses
-- Drive), hands the player's car to the AI,
-- writes the car's state four times a second to the CSP log (lines starting "BTEST,"), takes a
-- screenshot every 5% of the lap and whenever the car leaves the road or gets stuck, and quits AC
-- after a lap, at the end of a point-to-point road, when stuck, or after MAX_TIME seconds.

local MAX_TIME = 480
local CLOSED = __CLOSED__ -- filled in by the build: a circuit (true) or point to point
local active = ac.getDriverName(0) == 'Busselton Test'
ac.log('BTEST,loaded,0,0,0,0,0,0,0,0,driver=' .. tostring(ac.getDriverName(0)) .. (active and ' (test run)' or ' (idle)'))
local t, lastLog, lastShot, offFor, stuckFor = 0, -1, -1, 0, 0
local started, offNow, finishing, quitAt = false, false, false, nil
local laps0 = 0
local menuWait = 0
local pastHalf = false -- a lap only counts once the car has been halfway round

local function onRoad()
  local n = 0
  for i = 0, 3 do
    local ok, valid = pcall(function () return car.wheels[i].surfaceValidTrack end)
    if ok and valid then n = n + 1 end
  end
  return n
end

local function log(kind, extra)
  local p = car.position
  ac.log(string.format('BTEST,%s,%.2f,%.5f,%.2f,%.2f,%.2f,%.1f,%d,%d,%s', kind, t, car.splinePosition,
    p.x, p.y, p.z, car.speedKmh, onRoad(), car.isAIControlled and 1 or 0, extra or ''))
end

local function shot(tag)
  pcall(ac.makeScreenshot, nil, { accumulation = false }, nil)
  log('shot', tag)
end

local function finish(why)
  if finishing then return end
  finishing = true
  log('finish', why)
  shot('finish')
  quitAt = t + 3
  -- run-test.ps1 watches the log for this line and closes AC (ac.shutdownAssettoCorsa does
  -- nothing on some CSP versions); keep logging until then.
end

function script.update(dt)
  if not active then return end
  -- AC opens on the setup screen and waits for "Drive": press it (every few seconds until it takes).
  if sim.isInMainMenu then
    menuWait = menuWait + dt
    if menuWait > 3 then
      menuWait = 0
      local ok, err = pcall(ac.tryToStart)
      ac.log('BTEST,menu,' .. string.format('%.2f', t) .. ',0,0,0,0,0,0,0,' .. (ok and 'pressed drive' or ('tryToStart failed: ' .. tostring(err):gsub(',', ';'))))
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
    local ok, err = pcall(physics.setCarAutopilot, true, false)
    log('start', ok and 'autopilot' or ('autopilot failed: ' .. tostring(err)))
    laps0 = car.lapCount
    started = true
  end
  if t - lastLog >= 0.25 then
    lastLog = t
    log(finishing and 'after' or 'pos')
  end
  if finishing then return end
  local sp = car.splinePosition
  -- Count laps from halfway round: the car starts behind the line, so its first crossing
  -- (a few seconds in) isn't a lap.
  if not pastHalf and sp > 0.4 and sp < 0.6 then
    pastHalf = true
    laps0 = car.lapCount
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
  if stuckFor > 10 then finish('stuck') end
  if pastHalf and car.lapCount > laps0 then finish('lap') end
  if not CLOSED and car.splinePosition > 0.995 then finish('end of road') end
  if t > MAX_TIME then finish('timeout') end
end
