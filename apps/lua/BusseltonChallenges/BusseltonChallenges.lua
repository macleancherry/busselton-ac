-- Busselton Challenges: drive to each checkpoint in turn against the clock.
--
-- Checkpoints come with the track: data/challenges.ini in the track folder, written by every
-- Busselton AC build ([CHALLENGE] COUNT, RADIUS; [CHECKPOINT_n] NAME, POSITION = x, y, z in AC world
-- coordinates). On a track without one the window just says so.
--
-- The window shows the next place, how far it is and which way, the clock and your best time. In
-- the world, a tall beam of light stands on the next checkpoint. Press Start (or drive through the
-- first checkpoint) to begin; drive within RADIUS metres of each one in order.

local points, radius, title = {}, 14, ''
local loaded, status = false, ''
local running, finished, nextIndex, clock, lastTime = false, false, 1, 0, nil
local best = { time = 0 }
local trend, lastDist = nil, nil

local function trackFile(name)
  local ok, path = pcall(function () return ac.getTrackDataFilename(name) end)
  if ok and path and path ~= '' then return path end
  local ok2, folder = pcall(function () return ac.getFolder(ac.FolderID.ContentTracks) .. '/' .. ac.getTrackID() end)
  if ok2 and folder then return folder .. '/data/' .. name end
  return nil
end

local function parseVec(text)
  local x, y, z = string.match(text or '', '([%-%d%.]+)%s*,%s*([%-%d%.]+)%s*,%s*([%-%d%.]+)')
  if not x then return nil end
  return vec3(tonumber(x), tonumber(y), tonumber(z))
end

local function load()
  loaded = true
  local path = trackFile('challenges.ini')
  if not path or (io.fileExists and not io.fileExists(path)) then
    status = 'No challenges on this track.'
    return
  end
  -- A plain reader: sections and KEY = VALUE lines.
  local section, data = nil, {}
  local ok, text = pcall(io.load, path)
  local lines = {}
  if ok and type(text) == 'string' then
    for line in string.gmatch(text, '[^\r\n]+') do lines[#lines + 1] = line end
  else
    local okLines = pcall(function () for line in io.lines(path) do lines[#lines + 1] = line end end)
    if not okLines then
      status = 'No challenges on this track.'
      return
    end
  end
  for _, line in ipairs(lines) do
    local s = string.match(line, '^%s*%[(.-)%]%s*$')
    if s then
      section = s
      data[s] = data[s] or {}
    else
      local k, v = string.match(line, '^%s*([%w_]+)%s*=%s*(.-)%s*$')
      if section and k then data[section][k] = v end
    end
  end
  local head = data.CHALLENGE or {}
  title = head.NAME or ac.getTrackName and ac.getTrackName() or ''
  radius = tonumber(head.RADIUS) or 14
  local count = tonumber(head.COUNT) or 0
  for k = 0, count - 1 do
    local c = data['CHECKPOINT_' .. k]
    local pos = c and parseVec(c.POSITION)
    if pos then points[#points + 1] = { name = c.NAME or ('Checkpoint ' .. (k + 1)), pos = pos } end
  end
  if #points == 0 then status = 'No challenges on this track.' end
  local ok, store = pcall(function () return ac.storage({ time = 0 }, 'best_' .. tostring(ac.getTrackID())) end)
  if ok and store then best = store end
end

local function fmt(t)
  if not t or t <= 0 then return '--:--.-' end
  return string.format('%d:%04.1f', math.floor(t / 60), t % 60)
end

local function start()
  running, finished, nextIndex, clock = true, false, 1, 0
end

function script.update(dt)
  if not loaded then load() end
  if #points == 0 then return end
  local car = ac.getCar(0)
  if not car then return end
  local sim = ac.getSim()
  if sim and (sim.isPaused or sim.isReplayActive) then return end
  if running then clock = clock + dt end
  local target = points[nextIndex]
  if not target then return end
  local d = car.position:distance(target.pos)
  -- Warmer or colder: metres a second closer (positive when closing in), smoothed over a second or so.
  local rate = (dt > 0 and lastDist) and (lastDist - d) / dt or 0
  trend = trend and trend + (rate - trend) * math.min(1, dt * 1.5) or 0
  lastDist = d
  if d < radius then
    if not running and nextIndex == 1 then start() end
    nextIndex = nextIndex + 1
    lastDist, trend = nil, nil
    if nextIndex > #points then
      running, finished, lastTime = false, true, clock
      if best.time == 0 or clock < best.time then best.time = clock end
      nextIndex = 1
    end
  end
end

function script.windowMain(dt)
  if #points == 0 then
    ui.text(status ~= '' and status or 'Loading...')
    return
  end
  local car = ac.getCar(0)
  local target = points[nextIndex]
  ui.text(title)
  ui.pushFont(ui.Font.Title)
  if finished and not running then
    ui.text('Done! ' .. fmt(lastTime))
  else
    ui.text(string.format('%d/%d  %s', nextIndex, #points, target.name))
  end
  ui.popFont()
  if car and target then
    local to = target.pos - car.position
    local dist = math.sqrt(to.x * to.x + to.z * to.z)
    -- Which way: the angle between where the car points and where the checkpoint is.
    local way = (trend or 0) > 1 and 'getting warmer' or (trend or 0) < -1 and 'getting colder' or ''
    ui.text(string.format('%.0f m  %s', dist, way))
  end
  ui.pushFont(ui.Font.Huge)
  ui.text(fmt(running and clock or lastTime))
  ui.popFont()
  ui.text('Best: ' .. fmt(best.time))
  if ui.button(running and 'Restart' or 'Start') then start() end
end

function script.draw3D()
  local target = points[nextIndex]
  if not target then return end
  -- A beam of light: a stack of glowing spheres, tall enough to see over houses.
  local colour = rgbm(1, 0.75, 0.1, 1)
  for k = 0, 12 do
    pcall(render.debugSphere, target.pos + vec3(0, 1 + k * 2.5, 0), k == 0 and 1.5 or 0.6, colour)
  end
end
