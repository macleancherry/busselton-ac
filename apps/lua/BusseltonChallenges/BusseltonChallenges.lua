-- Busselton Challenges: four ways to play on a Busselton AC track.
--
--   Checkpoints  drive to each place in turn against the clock. Every build ships
--                data/challenges.ini: [CHALLENGE] COUNT, RADIUS, SET_NAME, SETS; [CHECKPOINT_n] NAME,
--                POSITION = x, y, z (AC world coordinates); more sets as [SET_k] and
--                [SET_k_CHECKPOINT_n]. "Next challenge" picks another set.
--   Time trial   A to B on a point-to-point layout, with splits: [TIME_TRIAL], [TT_START],
--                [TT_SPLIT_n], [TT_FINISH] (POSITION, DIRECTION = x, z along the road, WIDTH). The
--                clock starts when you cross the start line and stops at the finish.
--   Drift        empty car parks are drift spots (extension/drift_zones.ini: [ZONE_n] NAME,
--                POSITION, RADIUS). Inside one, sliding scores points: more angle and more speed,
--                more points, and a bigger multiplier the longer you keep it going.
--   Cruise       no clock: the street you're on, the next sight ahead and how far, the speed limit,
--                and a tick list of the layout's sights that fills as you drive past each one
--                (extension/cruise.ini and data/cruise.ini; see the Cruise section below).
--
-- Best times and scores are kept per driver name (so everyone on the same PC has their own), with a
-- top-ten board for each challenge. In an online session (Content Manager's LAN races run through
-- AC's own server) the app shares each driver's bests with the other cars through CSP's online
-- events, so everyone sees one board. Offline the boards are this PC's only.

local LAN_KEY = 'busseltonAC.challengeBest.1'

local loaded, status = false, ''
local title, radius = '', 14
local sets, setIndex = {}, 1
local tt = nil
local zones = {}
local mode = 'checkpoints'
local driver = 'Driver'
local trackKey, trackHash = '', 0
local lastPos = nil

-- Checkpoint run.
local running, finished, nextIndex, clock, lastTime = false, false, 1, 0, nil
local trend, lastDist = nil, nil

-- Time trial run.
local ttRunning, ttClock, ttNext, ttSplits, ttLast, ttDone = false, 0, 1, {}, nil, false

-- Drift run.
local drift = { zone = nil, score = 0, combo = 0, comboTime = 0, mult = 1, idle = 0, word = '', last = nil, angle = 0 }

-- Messages that flash up in the window ("New best!").
local flash, flashTime = '', 0

---------------------------------------------------------------------------------------------------
-- Files

local function trackFolder()
  local ok, folder = pcall(function () return ac.getFolder(ac.FolderID.ContentTracks) .. '/' .. ac.getTrackID() end)
  return ok and folder or nil
end

local function trackFile(name)
  local ok, path = pcall(function () return ac.getTrackDataFilename(name) end)
  if ok and path and path ~= '' then return path end
  local folder = trackFolder()
  return folder and (folder .. '/data/' .. name) or nil
end

-- A plain INI reader: sections and KEY = VALUE lines. Nil when the file isn't there.
local function readIni(path)
  if not path or (io.fileExists and not io.fileExists(path)) then return nil end
  local lines = {}
  local ok, text = pcall(io.load, path)
  if ok and type(text) == 'string' then
    for line in string.gmatch(text, '[^\r\n]+') do lines[#lines + 1] = line end
  else
    local okLines = pcall(function () for line in io.lines(path) do lines[#lines + 1] = line end end)
    if not okLines then return nil end
  end
  local section, data = nil, {}
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
  return data
end

local function parseVec(text)
  local x, y, z = string.match(text or '', '([%-%d%.]+)%s*,%s*([%-%d%.]+)%s*,%s*([%-%d%.]+)')
  if not x then return nil end
  return vec3(tonumber(x), tonumber(y), tonumber(z))
end

local function parseGate(g)
  if not g then return nil end
  local pos = parseVec(g.POSITION)
  local dx, dz = string.match(g.DIRECTION or '', '([%-%d%.]+)%s*,%s*([%-%d%.]+)')
  if not pos or not dx then return nil end
  return { name = g.NAME or '', pos = pos, dx = tonumber(dx), dz = tonumber(dz), width = tonumber(g.WIDTH) or 10 }
end

local function readPoints(data, prefix, count)
  local points = {}
  for k = 0, count - 1 do
    local c = data[prefix .. k]
    local pos = c and parseVec(c.POSITION)
    if pos then points[#points + 1] = { name = c.NAME or ('Checkpoint ' .. (k + 1)), pos = pos } end
  end
  return points
end

-- A number for the track and layout, so online messages from another track are ignored.
local function hash(s)
  local h = 5381
  for i = 1, #s do h = (h * 33 + string.byte(s, i)) % 4294967296 end
  return h
end

---------------------------------------------------------------------------------------------------
-- Boards: each challenge's results, best first, one row per driver, kept between sessions.

local boards = {}

local function safeKey(s) return (string.gsub(s, '[^%w]', '_')) end

local function board(id, desc)
  local b = boards[id]
  if b then return b end
  local ok, store = pcall(function () return ac.storage({ v = '' }, 'board_' .. safeKey(trackKey .. '_' .. id) .. '_') end)
  b = { id = id, desc = desc, store = ok and store or nil, rows = {} }
  if b.store and type(b.store.v) == 'string' then
    for line in string.gmatch(b.store.v, '[^\n]+') do
      local v, name, extra = string.match(line, '^([%-%d%.]+)|([^|]*)|?(.*)$')
      if v then b.rows[#b.rows + 1] = { value = tonumber(v), name = name, extra = extra or '' } end
    end
  end
  boards[id] = b
  return b
end

local function better(b, x, y)
  if b.desc then return x > y end
  return x < y
end

local function rowOf(b, name)
  for _, r in ipairs(b.rows) do if r.name == name then return r end end
  return nil
end

-- Puts a result on a board; true when it's that driver's best.
local function record(b, name, value, extra, fromLan)
  if not value or value <= 0 then return false end
  local row = rowOf(b, name)
  if row and not better(b, value, row.value) then return false end
  if not row then
    row = { name = name }
    b.rows[#b.rows + 1] = row
  end
  row.value, row.extra, row.lan = value, extra or '', fromLan
  table.sort(b.rows, function (p, q) return better(b, p.value, q.value) end)
  while #b.rows > 10 do table.remove(b.rows) end
  if b.store then
    local out = {}
    for _, r in ipairs(b.rows) do
      out[#out + 1] = string.format('%.3f|%s|%s', r.value, (string.gsub(r.name, '[|\n]', ' ')), r.extra or '')
    end
    b.store.v = table.concat(out, '\n')
  end
  return true
end

local function cpBoard() return board('cp' .. setIndex, false) end
local function ttBoard() return board('tt', false) end
local function driftBoard(k) return board('drift' .. k, true) end

---------------------------------------------------------------------------------------------------
-- Sharing bests online: CSP's ac.OnlineEvent. On AC's own server (which Content Manager's LAN races
-- use) it travels as hidden chat messages: under 175 bytes each, at least 200 ms apart, so they
-- queue and go one every half second.

local lanSend, lanQueue, lanTimer, lanShared = nil, {}, 0, -10
local now = 0
-- When the app's window was last drawn (markers in the world show only while it's open).
local windowSeen = -1e9

local function lanPush(id, value, hello)
  if lanSend then lanQueue[#lanQueue + 1] = { board = id, value = value or 0, hello = hello and 1 or 0 } end
end

local function boardIds()
  local ids = { 'tt' }
  for k = 1, #sets do ids[#ids + 1] = 'cp' .. k end
  for k = 1, #zones do ids[#ids + 1] = 'drift' .. k end
  return ids
end

local function shareMine()
  if not lanSend or now - lanShared < 5 then return end
  lanShared = now
  for _, id in ipairs(boardIds()) do
    local mine = rowOf(board(id, string.sub(id, 1, 5) == 'drift'), driver)
    if mine and not mine.lan then lanPush(id, mine.value) end
  end
end

local function lanInit()
  local sim = ac.getSim()
  if not (sim and sim.isOnlineRace and ac.OnlineEvent and ac.StructItem) then return end
  local ok, send = pcall(ac.OnlineEvent, {
    ac.StructItem.key(LAN_KEY),
    track = ac.StructItem.uint32(),
    board = ac.StructItem.string(12),
    name = ac.StructItem.string(24),
    value = ac.StructItem.float(),
    hello = ac.StructItem.byte(),
  }, function (sender, msg)
    if not sender or sender.index == 0 or msg.track ~= trackHash then return end
    if msg.hello == 1 then
      shareMine() -- someone has just joined: tell them our bests
      return
    end
    local id, name = tostring(msg.board), tostring(msg.name)
    -- Someone else with our name can't be told apart from us: their times stay on their own board.
    if name == string.sub(driver, 1, 23) then return end
    record(board(id, string.sub(id, 1, 5) == 'drift'), name, msg.value, '', true)
  end)
  if ok and send then
    lanSend = send
    lanPush('hello', 0, true)
    shareMine()
  end
end

local function lanPump(dt)
  if not lanSend or #lanQueue == 0 then return end
  lanTimer = lanTimer - dt
  if lanTimer > 0 then return end
  local m = table.remove(lanQueue, 1)
  pcall(lanSend, { track = trackHash, board = m.board, name = string.sub(driver, 1, 23), value = m.value, hello = m.hello })
  lanTimer = 0.5
end

---------------------------------------------------------------------------------------------------
-- Cruise: no clock. The street you're on, the next sight ahead, a speed-limit reminder and a tick
-- list of the sights you've seen. extension/cruise.ini has the whole world's landmarks and named
-- streets (with their limits where known); data/cruise.ini has this layout's sights in the order it
-- passes them (AT = fraction of the lap) and its limit at each 1% of the lap (cruise.ts).

local CRUISE_CELL = 50
local cruise = {
  landmarks = {}, streets = {}, grid = {}, sights = {}, limits = nil, closed = false, length = 0,
  seen = {}, seenCount = 0, street = nil, streetAge = 0, lookTimer = 0, next = nil, nextDist = 0,
  nextWay = '', limit = nil, speed = 0,
}

local function parseXZ(text)
  local x, z = string.match(text or '', '([%-%d%.]+)%s*,%s*([%-%d%.]+)')
  if not x then return nil end
  return { x = tonumber(x), z = tonumber(z) }
end

local function cruiseCellKey(cx, cz) return cx .. ',' .. cz end

-- Every street segment goes in each grid cell its box touches (plus 25 m), so a lookup reads one cell.
local function cruiseAddSegment(street, ax, az, bx, bz)
  local seg = { street = street, ax = ax, az = az, bx = bx, bz = bz }
  local reach = 25
  for cx = math.floor((math.min(ax, bx) - reach) / CRUISE_CELL), math.floor((math.max(ax, bx) + reach) / CRUISE_CELL) do
    for cz = math.floor((math.min(az, bz) - reach) / CRUISE_CELL), math.floor((math.max(az, bz) + reach) / CRUISE_CELL) do
      local key = cruiseCellKey(cx, cz)
      local list = cruise.grid[key]
      if not list then
        list = {}
        cruise.grid[key] = list
      end
      list[#list + 1] = seg
    end
  end
end

local function loadCruise(folder)
  local world = folder and readIni(folder .. '/extension/cruise.ini') or {}
  local head = world.CRUISE or {}
  for k = 0, (tonumber(head.LANDMARKS) or 0) - 1 do
    local l = world['LANDMARK_' .. k]
    local p = l and parseXZ(l.POSITION)
    if p then cruise.landmarks[#cruise.landmarks + 1] = { name = l.NAME or 'Landmark', x = p.x, z = p.z, radius = 40, at = -1 } end
  end
  for k = 0, (tonumber(head.STREETS) or 0) - 1 do
    local s = world['STREET_' .. k]
    if s and s.NAME and s.POINTS then
      local street = { name = s.NAME, limit = tonumber(s.LIMIT) }
      cruise.streets[#cruise.streets + 1] = street
      local nums = {}
      for v in string.gmatch(s.POINTS, '[^,]+') do nums[#nums + 1] = tonumber(v) end
      for i = 1, #nums - 3, 2 do cruiseAddSegment(street, nums[i], nums[i + 1], nums[i + 2], nums[i + 3]) end
    end
  end

  local lay = readIni(trackFile('cruise.ini')) or {}
  local lh = lay.CRUISE or {}
  cruise.closed = lh.CLOSED == '1'
  cruise.length = tonumber(lh.LENGTH) or 0
  for k = 0, (tonumber(lh.SIGHTS) or 0) - 1 do
    local s = lay['SIGHT_' .. k]
    local p = s and parseXZ(s.POSITION)
    if p then
      cruise.sights[#cruise.sights + 1] = { name = s.NAME or 'Sight', x = p.x, z = p.z, radius = tonumber(s.RADIUS) or 40, at = tonumber(s.AT) or -1 }
    end
  end
  if lh.LIMITS then
    cruise.limits = {}
    for v in string.gmatch(lh.LIMITS, '[^,]+') do cruise.limits[#cruise.limits + 1] = tonumber(v) end
    if #cruise.limits == 0 then cruise.limits = nil end
  end
  -- No layout file: every landmark is a sight.
  if #cruise.sights == 0 and not lay.CRUISE then cruise.sights = cruise.landmarks end
end

local function hasCruise()
  return #cruise.sights > 0 or #cruise.streets > 0
end

-- The named street nearest the car, within 20 m.
local function cruiseStreetAt(x, z)
  local best, bd = nil, 20
  for _, seg in ipairs(cruise.grid[cruiseCellKey(math.floor(x / CRUISE_CELL), math.floor(z / CRUISE_CELL))] or {}) do
    local dx, dz = seg.bx - seg.ax, seg.bz - seg.az
    local l2 = dx * dx + dz * dz
    local t = l2 > 0 and math.max(0, math.min(1, ((x - seg.ax) * dx + (z - seg.az) * dz) / l2)) or 0
    local ex, ez = x - seg.ax - dx * t, z - seg.az - dz * t
    local d = math.sqrt(ex * ex + ez * ez)
    if d < bd then best, bd = seg.street, d end
  end
  return best
end

-- Which way something is from the car, in words: ahead, behind, on the left or right.
-- AC's x is east and z is south, so with y up a positive cross product is to the right.
local function cruiseWay(car, x, z)
  local dx, dz = x - car.position.x, z - car.position.z
  local len = math.sqrt(dx * dx + dz * dz)
  if len < 1 then return 'right here' end
  dx, dz = dx / len, dz / len
  local lx, lz = car.look.x, car.look.z
  local ll = math.sqrt(lx * lx + lz * lz)
  if ll < 0.01 then return '' end
  lx, lz = lx / ll, lz / ll
  local dot, cross = lx * dx + lz * dz, lx * dz - lz * dx
  if dot > 0.7 then return 'ahead' end
  if dot < -0.5 then return 'behind you' end
  return cross > 0 and 'on your right' or 'on your left'
end

local function cruiseFlat(car, s)
  local dx, dz = s.x - car.position.x, s.z - car.position.z
  return math.sqrt(dx * dx + dz * dz)
end

-- The next sight you haven't seen: along the layout when it has a lap position and you're on it,
-- otherwise the nearest one in front of you (or just the nearest).
local function cruiseNext(car)
  local best, bestD, bestStraight = nil, math.huge, 0
  local p = car.splinePosition or 0
  if cruise.length > 0 then
    for i, s in ipairs(cruise.sights) do
      if not cruise.seen[i] and s.at >= 0 then
        local ahead = s.at - p
        if ahead < -0.005 and cruise.closed then ahead = ahead + 1 end
        if ahead >= -0.005 then
          local d, straight = math.max(0, ahead) * cruise.length, cruiseFlat(car, s)
          -- Off the layout's road the lap position means little: only trust it when it adds up.
          if d < bestD and d <= straight * 3 + 100 then best, bestD, bestStraight = i, d, straight end
        end
      end
    end
  end
  if best then return best, math.max(bestD, bestStraight) end
  local nearAhead, dAhead, near, dNear = nil, math.huge, nil, math.huge
  for i, s in ipairs(cruise.sights) do
    if not cruise.seen[i] then
      local d = cruiseFlat(car, s)
      if d < dNear then near, dNear = i, d end
      if d < dAhead and cruiseWay(car, s.x, s.z) == 'ahead' then nearAhead, dAhead = i, d end
    end
  end
  if nearAhead then return nearAhead, dAhead end
  return near, dNear
end

local function cruiseReset()
  cruise.seen, cruise.seenCount = {}, 0
end

local function updateCruise(dt, car, say)
  cruise.speed = car.speedKmh or 0
  -- Ticks: drive close enough to a sight and it's seen.
  for i, s in ipairs(cruise.sights) do
    if not cruise.seen[i] and cruiseFlat(car, s) <= s.radius then
      cruise.seen[i] = true
      cruise.seenCount = cruise.seenCount + 1
      if cruise.seenCount == #cruise.sights then
        say(string.format('You saw all %d sights! Well done!', #cruise.sights))
        pcall(ac.setMessage, 'Well done!', string.format('You saw all %d sights', #cruise.sights))
      else
        say('You spotted ' .. s.name .. '!')
        pcall(ac.setMessage, 'Sight seen!', s.name)
      end
    end
  end
  cruise.lookTimer = cruise.lookTimer - dt
  if cruise.lookTimer > 0 then return end
  cruise.lookTimer = 0.25
  local st = cruiseStreetAt(car.position.x, car.position.z)
  if st then
    cruise.street, cruise.streetAge = st, 0
  else
    -- Keep the last name through a junction or a car park for a few seconds.
    cruise.streetAge = cruise.streetAge + 0.25
    if cruise.streetAge > 3 then cruise.street = nil end
  end
  cruise.limit = cruise.street and cruise.street.limit or nil
  if not cruise.limit and cruise.limits then
    cruise.limit = cruise.limits[math.max(1, math.min(#cruise.limits, math.floor((car.splinePosition or 0) * 100) + 1))]
  end
  local n, d = cruiseNext(car)
  cruise.next, cruise.nextDist = n, d or 0
  cruise.nextWay = n and cruiseWay(car, cruise.sights[n].x, cruise.sights[n].z) or ''
end

local function cruiseDistance(d)
  if d >= 1000 then return string.format('%.1f km', d / 1000) end
  return string.format('%d m', math.floor(d / 10 + 0.5) * 10)
end

local function windowCruise(car)
  if not hasCruise() then
    ui.text('Nothing to cruise to on this track.')
    return
  end
  ui.text('Cruise: no clock, just enjoy the drive.')
  ui.pushFont(ui.Font.Title)
  ui.text(cruise.street and cruise.street.name or 'Exploring...')
  ui.popFont()
  if cruise.limit then
    if cruise.speed > cruise.limit + 5 then
      ui.textColored(string.format('Limit %d. Ease off a little: you\'re doing %d.', cruise.limit, math.floor(cruise.speed)), rgbm(1, 0.6, 0.2, 1))
    else
      ui.textColored(string.format('Limit %d. Nice and steady.', cruise.limit), rgbm(0.4, 1, 0.5, 1))
    end
  end
  ui.separator()
  local total = #cruise.sights
  if total == 0 then
    ui.text('No sights on this layout.')
    return
  end
  local s = cruise.next and cruise.sights[cruise.next]
  if s then
    ui.text('Next sight:')
    ui.pushFont(ui.Font.Title)
    ui.text(string.format('%s  %s %s', s.name, cruiseDistance(cruise.nextDist), cruise.nextWay))
    ui.popFont()
  else
    ui.pushFont(ui.Font.Title)
    ui.textColored(string.format('You saw all %d sights!', total), rgbm(1, 0.85, 0.2, 1))
    ui.popFont()
  end
  ui.text(string.format('Sights seen: %d of %d', cruise.seenCount, total))
  for i, sight in ipairs(cruise.sights) do
    if cruise.seen[i] then ui.textColored('[x] ' .. sight.name, rgbm(0.4, 1, 0.5, 1))
    else ui.text('[ ] ' .. sight.name) end
  end
  if cruise.seenCount > 0 and ui.button('Start again') then cruiseReset() end
end

---------------------------------------------------------------------------------------------------
-- Loading

local function load()
  loaded = true
  local okName, name = pcall(ac.getDriverName, 0)
  if okName and type(name) == 'string' and name ~= '' then driver = name end
  local okLayout, layout = pcall(ac.getTrackLayout)
  trackKey = tostring(ac.getTrackID()) .. '/' .. ((okLayout and layout) or '')
  trackHash = hash(trackKey)

  local data = readIni(trackFile('challenges.ini')) or {}
  local head = data.CHALLENGE or {}
  title = head.NAME or (ac.getTrackName and ac.getTrackName()) or ''
  radius = tonumber(head.RADIUS) or 14
  local first = readPoints(data, 'CHECKPOINT_', tonumber(head.COUNT) or 0)
  if #first > 0 then sets[#sets + 1] = { name = head.SET_NAME or 'Checkpoints', points = first } end
  for k = 1, (tonumber(head.SETS) or 1) - 1 do
    local s = data['SET_' .. k]
    local pts = s and readPoints(data, 'SET_' .. k .. '_CHECKPOINT_', tonumber(s.COUNT) or 0) or {}
    if #pts > 0 then sets[#sets + 1] = { name = s.NAME or ('Challenge ' .. (k + 1)), points = pts } end
  end

  if data.TIME_TRIAL then
    local splits = {}
    for k = 0, (tonumber(data.TIME_TRIAL.SPLITS) or 0) - 1 do
      local g = parseGate(data['TT_SPLIT_' .. k])
      if g then splits[#splits + 1] = g end
    end
    local start, finish = parseGate(data.TT_START), parseGate(data.TT_FINISH)
    if start and finish then tt = { name = data.TIME_TRIAL.NAME or 'A to B', start = start, finish = finish, splits = splits } end
  end

  local folder = trackFolder()
  local dz = folder and readIni(folder .. '/extension/drift_zones.ini') or {}
  for k = 0, (tonumber(dz.DRIFT and dz.DRIFT.COUNT) or 0) - 1 do
    local z = dz['ZONE_' .. k]
    local pos = z and parseVec(z.POSITION)
    if pos then zones[#zones + 1] = { name = z.NAME or ('Drift spot ' .. (k + 1)), pos = pos, radius = tonumber(z.RADIUS) or 20 } end
  end

  loadCruise(folder)

  if #sets == 0 and tt then mode = 'trial' end
  if #sets == 0 and not tt and #zones == 0 and hasCruise() then mode = 'cruise' end
  if #sets == 0 and not tt and #zones == 0 and not hasCruise() then status = 'No challenges on this track.' end
  lanInit()
end

---------------------------------------------------------------------------------------------------
-- Playing

local function fmt(t)
  if not t or t <= 0 then return '--:--.-' end
  return string.format('%d:%04.1f', math.floor(t / 60), t % 60)
end

local function say(text)
  flash, flashTime = text, 4
end

local function newBest(id, value, label)
  say('New best! ' .. label)
  pcall(ac.setMessage, 'New best!', label)
  lanPush(id, value)
end

local function start()
  running, finished, nextIndex, clock = true, false, 1, 0
  lastDist, trend = nil, nil
end

local function flat(a, b)
  local dx, dz = a.x - b.x, a.z - b.z
  return math.sqrt(dx * dx + dz * dz)
end

-- Did the car go forward over the gate's line between two frames?
local function crossed(g, from, to)
  local a = (from.x - g.pos.x) * g.dx + (from.z - g.pos.z) * g.dz
  local b = (to.x - g.pos.x) * g.dx + (to.z - g.pos.z) * g.dz
  if not (a < 0 and b >= 0) then return false end
  local side = math.abs(-(to.x - g.pos.x) * g.dz + (to.z - g.pos.z) * g.dx)
  return side <= g.width / 2 + 3 and math.abs(to.y - g.pos.y) < 8
end

local function bestSplits()
  local mine = rowOf(ttBoard(), driver)
  local out = {}
  if mine and not mine.lan then
    for v in string.gmatch(mine.extra or '', '[^,]+') do out[#out + 1] = tonumber(v) end
  end
  return out
end

local function updateCheckpoints(dt, car)
  local points = sets[setIndex] and sets[setIndex].points
  if not points or #points == 0 or (mode ~= 'checkpoints' and not running) then return end
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
      if record(cpBoard(), driver, clock) then newBest('cp' .. setIndex, clock, fmt(clock)) end
      nextIndex = 1
    end
  end
end

local function updateTrial(dt, car, from)
  if not tt then return end
  if ttRunning then
    ttClock = ttClock + dt
    if ttClock > 1800 then ttRunning = false end
  end
  if not from then return end
  local to = car.position
  if crossed(tt.start, from, to) then
    ttRunning, ttDone, ttClock, ttNext, ttSplits = true, false, 0, 1, {}
    if not running then mode = 'trial' end
    return
  end
  if not ttRunning then return end
  local gate = tt.splits[ttNext] or tt.finish
  if crossed(gate, from, to) then
    if ttNext <= #tt.splits then
      ttSplits[ttNext] = ttClock
      local best = bestSplits()[ttNext]
      say(string.format('%s  %s%s', gate.name, fmt(ttClock), best and string.format('  (%+.1f)', ttClock - best) or ''))
      ttNext = ttNext + 1
    else
      ttRunning, ttDone, ttLast = false, true, ttClock
      local extra = {}
      for k = 1, #tt.splits do extra[#extra + 1] = string.format('%.3f', ttSplits[k] or 0) end
      if record(ttBoard(), driver, ttClock, table.concat(extra, ',')) then newBest('tt', ttClock, fmt(ttClock))
      else say('Finished! ' .. fmt(ttClock)) end
    end
  end
end

local function driftWord(angle)
  if angle < 20 then return 'Little slide' end
  if angle < 35 then return 'Nice slide!' end
  if angle < 55 then return 'Super sideways!' end
  return 'Mega drift!'
end

local function finishDrift()
  local k = drift.zone
  local total = math.floor(drift.score + drift.combo)
  if k and total > 0 then
    drift.last = total
    if record(driftBoard(k), driver, total) then newBest('drift' .. k, total, total .. ' points')
    else say(total .. ' points!') end
  end
  drift.score, drift.combo, drift.comboTime, drift.mult, drift.idle, drift.word = 0, 0, 0, 1, 0, ''
end

local function updateDrift(dt, car)
  local inZone = nil
  for k, z in ipairs(zones) do
    if flat(car.position, z.pos) < z.radius then inZone = k break end
  end
  if inZone ~= drift.zone then
    finishDrift()
    drift.zone = inZone
    if inZone and not running and not ttRunning then mode = 'drift' end
  end
  if not inZone then return end
  local v, look = car.velocity, car.look
  local speed = math.sqrt(v.x * v.x + v.z * v.z)
  local lookLen = math.sqrt(look.x * look.x + look.z * look.z)
  local angle = 0
  if speed > 1 and lookLen > 0 then
    local c = (v.x * look.x + v.z * look.z) / (speed * lookLen)
    angle = math.deg(math.acos(math.max(-1, math.min(1, c))))
  end
  drift.angle = angle
  local kmh = speed * 3.6
  if kmh > 15 and angle > 10 and angle < 90 then
    -- Sliding: angle times speed, and the multiplier grows every two seconds you keep it up (to x5).
    drift.idle = 0
    drift.comboTime = drift.comboTime + dt
    drift.mult = math.min(5, 1 + math.floor(drift.comboTime / 2))
    drift.combo = drift.combo + angle * kmh / 20 * dt * drift.mult
    drift.word = driftWord(angle)
  else
    drift.idle = drift.idle + dt
    if angle >= 100 and kmh > 5 and drift.combo > 0 then
      -- Spun round: only the slide you were in is lost.
      drift.combo, drift.comboTime, drift.mult, drift.word = 0, 0, 1, 'Oops! Spun out'
    elseif drift.idle > 1 and drift.combo > 0 then
      drift.score = drift.score + drift.combo
      drift.combo, drift.comboTime, drift.mult, drift.word = 0, 0, 1, 'Banked!'
    end
    if drift.idle > 4 and kmh < 3 and drift.score > 0 then finishDrift() end
  end
end

function script.update(dt)
  if not loaded then load() end
  now = now + dt
  lanPump(dt)
  if flashTime > 0 then flashTime = flashTime - dt end
  local car = ac.getCar(0)
  if not car then return end
  local sim = ac.getSim()
  if sim and (sim.isPaused or sim.isReplayActive) then return end
  local from = lastPos
  lastPos = car.position:clone()
  -- A jump of more than 50 m in a frame is a teleport (back to the pits): it ends a time trial.
  if from and flat(from, car.position) > 50 then
    from, ttRunning = nil, false
  end
  updateCheckpoints(dt, car)
  updateTrial(dt, car, from)
  updateDrift(dt, car)
  updateCruise(dt, car, say)
end

---------------------------------------------------------------------------------------------------
-- The window

local function showBoard(b, asTime)
  if #b.rows == 0 then
    ui.text('No results yet. Be the first!')
    return
  end
  for k = 1, math.min(5, #b.rows) do
    local r = b.rows[k]
    local value = asTime and fmt(r.value) or tostring(math.floor(r.value))
    local text = string.format('%d. %s  %s%s', k, value, r.name, r.lan and '  (LAN)' or '')
    if r.name == driver then ui.textColored(text, rgbm(1, 0.8, 0.2, 1)) else ui.text(text) end
  end
end

local function tabButton(label, id)
  if ui.button((mode == id and '> ' or '') .. label) then mode = id end
end

local function windowCheckpoints(car)
  local set = sets[setIndex]
  if not set then
    ui.text('No checkpoints on this layout.')
    return
  end
  local points, target = set.points, set.points[nextIndex]
  ui.text(set.name .. (#sets > 1 and string.format('  (%d of %d)', setIndex, #sets) or ''))
  ui.pushFont(ui.Font.Title)
  if finished and not running then ui.text('Done! ' .. fmt(lastTime))
  else ui.text(string.format('%d/%d  %s', nextIndex, #points, target.name)) end
  ui.popFont()
  if car and target then
    local way = (trend or 0) > 1 and 'getting warmer' or (trend or 0) < -1 and 'getting colder' or ''
    ui.text(string.format('%.0f m  %s', flat(target.pos, car.position), way))
  end
  ui.pushFont(ui.Font.Huge)
  ui.text(fmt(running and clock or lastTime))
  ui.popFont()
  if ui.button(running and 'Restart' or 'Start') then start() end
  if #sets > 1 then
    ui.sameLine()
    if ui.button('Next challenge') then
      setIndex = setIndex % #sets + 1
      running, finished, nextIndex, lastTime = false, false, 1, nil
    end
  end
  ui.separator()
  showBoard(cpBoard(), true)
end

local function windowTrial(car)
  if not tt then
    ui.text('No time trial here: pick a point-to-point layout.')
    return
  end
  ui.text(tt.name)
  ui.pushFont(ui.Font.Huge)
  ui.text(fmt((ttRunning and ttClock) or ttLast))
  ui.popFont()
  if not ttRunning and not ttDone then
    local d = car and flat(tt.start.pos, car.position) or 0
    ui.text(string.format('Drive through the start line (%.0f m away)', d))
  elseif ttRunning then
    local gate = tt.splits[ttNext] or tt.finish
    ui.text(string.format('Next: %s, %.0f m', gate.name, car and flat(gate.pos, car.position) or 0))
  end
  local best = bestSplits()
  for k = 1, #tt.splits do
    local t = ttSplits[k]
    local delta = (t and best[k]) and string.format('  %+.1f', t - best[k]) or ''
    local text = string.format('%s  %s%s', tt.splits[k].name, t and fmt(t) or '--', delta)
    if t and best[k] then ui.textColored(text, t <= best[k] and rgbm(0.3, 1, 0.3, 1) or rgbm(1, 0.4, 0.3, 1)) else ui.text(text) end
  end
  ui.separator()
  showBoard(ttBoard(), true)
end

local function windowDrift(car)
  if #zones == 0 then
    ui.text('No drift spots on this track.')
    return
  end
  local k = drift.zone
  if k then
    ui.text(zones[k].name)
    ui.pushFont(ui.Font.Huge)
    ui.text(tostring(math.floor(drift.score + drift.combo)))
    ui.popFont()
    ui.pushFont(ui.Font.Title)
    ui.text(drift.combo > 0 and string.format('%s  x%d', drift.word, drift.mult) or (drift.word ~= '' and drift.word or 'Get sideways!'))
    ui.popFont()
    ui.text(string.format('Angle %.0f', drift.angle))
    ui.separator()
    showBoard(driftBoard(k), false)
  else
    -- The nearest drift spot, and how far.
    local best, bd = nil, math.huge
    for i, z in ipairs(zones) do
      local d = car and flat(z.pos, car.position) or 0
      if d < bd then best, bd = i, d end
    end
    ui.text('Drive into a drift spot (orange ring).')
    ui.pushFont(ui.Font.Title)
    ui.text(string.format('%s  %.0f m', zones[best].name, bd))
    ui.popFont()
    if drift.last then ui.text('Last go: ' .. drift.last .. ' points') end
    ui.separator()
    showBoard(driftBoard(best), false)
  end
end

function script.windowMain(dt)
  windowSeen = now
  if not loaded then
    ui.text('Loading...')
    return
  end
  if status ~= '' then
    ui.text(status)
    return
  end
  local car = ac.getCar(0)
  ui.text(title .. '   Driver: ' .. driver .. (lanSend and '   LAN board on' or ''))
  tabButton('Checkpoints', 'checkpoints')
  ui.sameLine()
  tabButton('Time trial', 'trial')
  ui.sameLine()
  tabButton('Drift', 'drift')
  ui.sameLine()
  tabButton('Cruise', 'cruise')
  if flashTime > 0 then ui.textColored(flash, rgbm(1, 0.85, 0.2, 1)) end
  ui.separator()
  if mode == 'trial' then windowTrial(car)
  elseif mode == 'drift' then windowDrift(car)
  elseif mode == 'cruise' then windowCruise(car)
  else windowCheckpoints(car) end
end

---------------------------------------------------------------------------------------------------
-- In the world

-- Markers are soft, see-through upright strips of light that turn to face the camera. They used to
-- be stacks of render.debugSphere, which CSP draws as wireframe gizmos (a column of crosshair circles
-- over the road in every session).
--
-- Retest 4 (31 Oct 2026): drawn with render.quad and rgbm(1, 0.75, 0.1, 0.35), the beam came out as a
-- flat, solid yellow bar. render.quad's flat colour is drawn as is: one even, full-strength colour
-- right to the edges, in an HDR scene where 1.0 is already bright, so the 35% didn't make it soft.
-- Now each strip is a render.shaderedQuad with its own pixel shader, as CSP's rally mode draws its
-- start gates (acc-lua-internal included-new-modes/rally/mode.lua): alpha blending
-- (render.BlendMode.AlphaBlend), the depth test on but no depth writes
-- (render.DepthMode.ReadOnlyLessEqual) so it never hides what's behind it, colour scaled by
-- gWhiteRefPoint so it's as bright by day as at night, pin.ApplyFog, and an alpha that is highest
-- in the middle and fades to nothing at the sides, just off the ground and towards the top. Where
-- shaderedQuad isn't there (an older CSP) it falls back to the plain quad, dimmed.

local function cameraPos()
  local ok, p = pcall(function() return ac.getSim().cameraPosition end)
  return ok and p or nil
end

-- One params table, reused every call (CSP's advice for shaderedQuad: same keys each time, so the
-- shader compiles once).
local glow = {
  p1 = vec3(), p2 = vec3(), p3 = vec3(), p4 = vec3(),
  blendMode = render.BlendMode.AlphaBlend,
  async = true,
  cacheKey = 4401,
  values = { gColor = rgb(1, 1, 1), gAlpha = 0.3, gBaseY = 0, gHeight = 1, gBright = 1.5 },
  shader = [[
    float4 main(PS_IN pin) {
      float3 posW = pin.PosC + gCameraPosition;
      float h = saturate((posW.y - gBaseY) / gHeight);   // 0 at the foot, 1 at the top
      float x = saturate(abs(pin.Tex.x * 2 - 1));        // 0 in the middle, 1 at the sides
      float side = (1 - x) * (1 - x);                     // soft sides
      float ends = saturate(h * 10) * pow(1 - h, 1.6);   // fades in off the ground, out towards the top
      return pin.ApplyFog(float4(gColor * gWhiteRefPoint * gBright, gAlpha * side * ends));
    }
  ]],
}
local glowOk = render.shaderedQuad ~= nil

local function strip(foot, width, height, colour, alpha)
  local cam = cameraPos()
  if not cam then return end
  local dx, dz = cam.x - foot.x, cam.z - foot.z
  local l = math.sqrt(dx * dx + dz * dz)
  if l < 1 then return end
  local side = vec3(-dz / l * width / 2, 0, dx / l * width / 2)
  local top = foot + vec3(0, height, 0)
  if glowOk then
    -- p1..p4 top left, top right, bottom right, bottom left, as rally/mode.lua passes them.
    glow.p1:set(top - side); glow.p2:set(top + side); glow.p3:set(foot + side); glow.p4:set(foot - side)
    glow.values.gColor:set(colour.r, colour.g, colour.b)
    glow.values.gAlpha, glow.values.gBaseY, glow.values.gHeight = alpha, foot.y, height
    if pcall(render.shaderedQuad, glow) then return end
    glowOk = false
  end
  pcall(render.quad, foot - side, foot + side, top + side, top - side, rgbm(colour.r * 0.3, colour.g * 0.3, colour.b * 0.3, alpha))
end

local function setupMarkers()
  pcall(function()
    render.setBlendMode(render.BlendMode.AlphaBlend)
    render.setCullMode(render.CullMode.None)
    render.setDepthMode(render.DepthMode.ReadOnlyLessEqual)
  end)
end

local function beam(pos, colour, height)
  strip(pos, 2.4, 2.5 * height, colour, 0.35)
end

local function posts(g, colour)
  local half = g.width / 2
  local side = vec3(-g.dz * half, 0, g.dx * half)
  for _, p in ipairs({ g.pos + side, g.pos - side }) do strip(p, 0.8, 4, colour, 0.6) end
end

function script.draw3D()
  -- Only while the app is open or a run is on: a session nobody opened the app in shows nothing.
  if not (running or ttRunning or now - windowSeen < 2) then return end
  setupMarkers()
  local car = ac.getCar(0)
  if mode == 'checkpoints' then
    local set = sets[setIndex]
    local target = set and set.points[nextIndex]
    -- A soft beam of light, tall enough to see over houses.
    if target then beam(target.pos, rgbm(1, 0.75, 0.1, 1), 12) end
  elseif mode == 'trial' and tt then
    if ttRunning then
      local gate = tt.splits[ttNext]
      if gate then posts(gate, rgbm(1, 0.85, 0.1, 1)) else posts(tt.finish, rgbm(1, 1, 1, 1)) end
    else
      posts(tt.start, rgbm(0.2, 1, 0.3, 1))
      beam(tt.start.pos, rgbm(0.2, 1, 0.3, 1), 8)
    end
  end
  -- Cruise: a soft blue beam over the next sight.
  if mode == 'cruise' and cruise.next then
    local s = cruise.sights[cruise.next]
    beam(vec3(s.x, car and car.position.y or 0, s.z), rgbm(0.3, 0.7, 1, 1), 6)
  end
  -- Drift spots within 250 m: an orange ring on the ground.
  if car then
    for _, z in ipairs(zones) do
      if flat(z.pos, car.position) < z.radius + 250 then
        local n = math.min(48, math.floor(z.radius * 2 * math.pi / 4))
        for i = 0, n - 1 do
          local t = i / n * 2 * math.pi
          strip(z.pos + vec3(math.cos(t) * z.radius, 0, math.sin(t) * z.radius), 0.6, 1.2, rgbm(1, 0.45, 0.05, 1), 0.6)
        end
      end
    end
  end
end
