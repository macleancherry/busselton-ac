-- Busselton AC: the Busselton Jetty train (CSP track script, extension/jetty_train.lua).
--
-- Runs the red train out along the jetty and back, on the real timetable: it leaves the shore
-- platform on the hour (by the session's time of day), runs at walking pace (about 5 km/h, 20
-- minutes each way), waits five minutes at the far end and comes back pushed, carriages first.
-- Outside the timetable, at night, or without CSP, it stands at the shore platform, where the
-- build puts it (jetty.ts).
--
-- How: each car is its own node in the track's kn5 (JETTY_TRAIN_0 is the loco, then the
-- carriages), so the script can move it (CSP: only nodes move, meshes don't). Each frame it works
-- out how far along the line the loco's nose is from the time of day alone, so a time jump, a
-- replay or a restart always puts the train in the right place, then sets each car's position and
-- heading from two points on the line under its bogies. Visual only: nothing here touches physics.
--
-- Settings (in the [SCRIPT_...] section of extension/ext_config.ini that loads this file):
--   speedKmh, firstDeparture, lastDeparture (hours, 24 h), everyMinutes, waitAtEnd (seconds),
--   nonStop (1 = back and forth all day and night, for a look at it without waiting).

-- Filled in by the build (jettyTrain.ts): the line as x, y, z triples in the track's coordinates
-- (rail top), the cars (node, distance from the loco's nose to the car's middle, half the
-- distance between its bogies), and where the nose stands parked and at the far end, metres.
local PATH = { __PATH__ }
local CARS = { __CARS__ }
local S_PARK = __S_PARK__
local S_END = __S_END__

local cfg = { speedKmh = 5, firstDeparture = 9, lastDeparture = 17, everyMinutes = 60, waitAtEnd = 300, nonStop = 0 }
pcall(function ()
  local v = ac.configValues(cfg)
  if type(v) == 'table' then cfg = v end
end)

local ACCEL = 0.15 -- m/s², gentle
local SPEED = math.max(0.5, cfg.speedKmh / 3.6)
local RUN = S_END - S_PARK

-- Cumulative distance at each path point.
local n = math.floor(#PATH / 3)
local dist = { 0 }
for i = 2, n do
  local a, b = (i - 2) * 3, (i - 1) * 3
  local dx, dy, dz = PATH[b + 1] - PATH[a + 1], PATH[b + 2] - PATH[a + 2], PATH[b + 3] - PATH[a + 3]
  dist[i] = dist[i - 1] + math.sqrt(dx * dx + dy * dy + dz * dz)
end

-- The point s metres along the line (clamped to its ends).
local function pointAt(s)
  if s <= 0 then return vec3(PATH[1], PATH[2], PATH[3]) end
  if s >= dist[n] then local o = (n - 1) * 3 return vec3(PATH[o + 1], PATH[o + 2], PATH[o + 3]) end
  local lo, hi = 1, n
  while hi - lo > 1 do
    local mid = math.floor((lo + hi) / 2)
    if dist[mid] <= s then lo = mid else hi = mid end
  end
  local t = (s - dist[lo]) / math.max(1e-6, dist[hi] - dist[lo])
  local a, b = (lo - 1) * 3, (hi - 1) * 3
  return vec3(PATH[a + 1] + (PATH[b + 1] - PATH[a + 1]) * t, PATH[a + 2] + (PATH[b + 2] - PATH[a + 2]) * t, PATH[a + 3] + (PATH[b + 3] - PATH[a + 3]) * t)
end

-- Distance covered t seconds into a run of length `len`: speed up, cruise, slow down.
local function covered(t, len)
  local tAcc = SPEED / ACCEL
  local dAcc = 0.5 * ACCEL * tAcc * tAcc
  if 2 * dAcc > len then
    -- Too short to reach full speed: a triangle profile.
    tAcc = math.sqrt(len / ACCEL)
    dAcc = len / 2
  end
  local vTop = ACCEL * tAcc
  local tCruise = (len - 2 * dAcc) / math.max(1e-6, vTop)
  local total = 2 * tAcc + tCruise
  if t <= 0 then return 0, total end
  if t >= total then return len, total end
  if t < tAcc then return 0.5 * ACCEL * t * t, total end
  if t < tAcc + tCruise then return dAcc + vTop * (t - tAcc), total end
  local r = total - t
  return len - 0.5 * ACCEL * r * r, total
end
local _, RUN_TIME = covered(0, RUN)

-- Where the nose is, `phase` seconds after a departure (nil once it's back).
local function noseAt(phase)
  if phase < 0 then return nil end
  if phase < RUN_TIME then return S_PARK + covered(phase, RUN) end
  phase = phase - RUN_TIME
  if phase < cfg.waitAtEnd then return S_END end
  phase = phase - cfg.waitAtEnd
  if phase < RUN_TIME then return S_END - covered(phase, RUN) end
  return nil
end

-- Where the nose is at a time of day (seconds since midnight).
local function noseAtTime(clock)
  if RUN <= 1 then return S_PARK end
  if cfg.nonStop == 1 then
    local cycle = 2 * RUN_TIME + 2 * cfg.waitAtEnd
    return noseAt(clock % cycle) or S_PARK
  end
  local every = math.max(1, cfg.everyMinutes) * 60
  local first, last = cfg.firstDeparture * 3600, cfg.lastDeparture * 3600
  if clock < first then return S_PARK end
  -- The latest departure at or before now (trips are shorter than the gap between them).
  local k = math.floor((clock - first) / every)
  local dep = first + k * every
  if dep > last then return S_PARK end
  return noseAt(clock - dep) or S_PARK
end

local nodes = {}
for i, c in ipairs(CARS) do nodes[i] = ac.findNodes(c[1]) end
local up = vec3(0, 1, 0)

local function place(nose)
  for i, c in ipairs(CARS) do
    local mid = nose - c[2]
    local front, back = pointAt(mid + c[3]), pointAt(mid - c[3])
    local look = front - back
    if look:length() > 1e-3 then
      nodes[i]:setPosition(pointAt(mid))
      nodes[i]:setOrientation(look:normalize(), up)
    end
  end
end

-- The session's clock, smoothed: CSP's time of day steps in whole seconds, and the train would
-- judder 1.4 m at a time. A local clock runs at the rate the session's clock is seen to run (time
-- acceleration included) and is pulled back to it, never more than a second ahead (so a paused
-- session holds it still).
local clock, rate, lastSim, sinceTick = nil, 1, nil, 0
local function simClock()
  local sim = ac.getSim()
  return sim.timeHours * 3600 + sim.timeMinutes * 60 + (sim.timeSeconds or 0)
end

local lastNose = nil
function script.update(dt)
  local ok, now = pcall(simClock)
  if not ok or type(now) ~= 'number' then return end
  sinceTick = sinceTick + dt
  if lastSim == nil or math.abs(now - lastSim) > 120 then
    clock, lastSim, sinceTick = now, now, 0
  elseif now ~= lastSim then
    if sinceTick > 1e-3 then rate = math.max(0, math.min(1000, rate * 0.7 + 0.3 * (now - lastSim) / sinceTick)) end
    lastSim, sinceTick = now, 0
  end
  clock = clock + dt * rate
  clock = clock + (now - clock) * math.min(1, dt * 0.05)
  if clock > now + 1 then clock = now + 1 end
  if clock < now - 5 then clock = now end
  local nose = noseAtTime(clock % 86400)
  if lastNose == nil or math.abs(nose - lastNose) > 1e-4 then
    place(nose)
    lastNose = nose
  end
end
