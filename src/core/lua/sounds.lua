-- Busselton AC track sounds (CSP track script, written by trackSounds.ts).
--
-- Plays plain audio files from extension/sfx/ at places taken from the map: waves along the shore,
-- magpies in park and street trees, kookaburras in the bush. No FMOD bank needed: CSP's
-- ac.AudioEvent.fromFile loads the file and plays it as a looping 3D emitter. Each kind looks for
-- <name>.ogg, then .wav, then .mp3; a kind whose file isn't there just stays quiet (logged once).
-- extension/sfx/README.txt lists the files and where to get CC0 recordings.
--
-- Birds sing in daylight (kookaburras loudest at dawn and dusk) and go quiet in the rain; waves get
-- a bit louder when the weather's up. Emitters only play while the camera is in earshot.

-- { kind, x, y, z } in AC space (x east, y up, z south). Filled in by the build.
local EMITTERS = { __EMITTERS__ }

local KINDS = {
  surf = { file = 'surf', min = 12, max = 250, pitch = 0 },
  magpie = { file = 'magpie', min = 6, max = 150, pitch = 0.06 },
  kookaburra = { file = 'kookaburra', min = 8, max = 250, pitch = 0.05 },
}
local EXTENSIONS = { '.ogg', '.wav', '.mp3' }

-- Where extension/sfx is: the track folder (works in any CSP), then the script's own folder.
local DIRS = {}
pcall(function () DIRS[#DIRS + 1] = ac.getFolder(ac.FolderID.ContentTracks) .. '/' .. ac.getTrackID() .. '/extension/sfx/' end)
if type(__dirname) == 'string' and __dirname ~= '' then DIRS[#DIRS + 1] = __dirname .. '/sfx/' end

local found = {} -- kind -> filename that loaded, or false when none did

local function tryLoad(filename, k)
  local ok, ev = pcall(ac.AudioEvent.fromFile, {
    filename = filename, use3D = true, loop = true, dopplerEffect = 0, minDistance = k.min, maxDistance = k.max,
  }, true)
  if not ok or not ev then return nil end
  if ev:isValid() then return ev end
  pcall(function () ev:dispose() end)
  return nil
end

local function load(kind)
  local k = KINDS[kind]
  if found[kind] == false then return nil end
  if found[kind] then return tryLoad(found[kind], k) end
  for _, dir in ipairs(DIRS) do
    for _, ext in ipairs(EXTENSIONS) do
      local name = dir .. k.file .. ext
      local ev = tryLoad(name, k)
      if ev then
        found[kind] = name
        ac.log('Busselton sounds: ' .. kind .. ' from ' .. name)
        return ev
      end
    end
  end
  found[kind] = false
  ac.log('Busselton sounds: no ' .. k.file .. '.ogg/.wav/.mp3 in extension/sfx, ' .. kind .. ' stays quiet')
  return nil
end

-- A piecewise-linear lookup over the sun's angle from straight up (90 = horizon).
local function lut(points, v)
  if v <= points[1][1] then return points[1][2] end
  for i = 2, #points do
    local a, b = points[i - 1], points[i]
    if v <= b[1] then return a[2] + (b[2] - a[2]) * (v - a[1]) / (b[1] - a[1]) end
  end
  return points[#points][2]
end
local DAYLIGHT = { { 0, 1 }, { 84, 1 }, { 96, 0 }, { 180, 0 } }
local KOOKABURRA_TIME = { { 0, 0.3 }, { 78, 0.3 }, { 86, 1 }, { 98, 1 }, { 104, 0 }, { 180, 0 } }

local function targets()
  local sun = ac.getSunAngle()
  local s = ac.getSim()
  local rain = math.min(1, math.max(0, (s and s.rainIntensity or 0) * 2))
  return {
    surf = 0.7 + 0.3 * rain,
    magpie = lut(DAYLIGHT, sun) * (1 - rain),
    kookaburra = lut(KOOKABURRA_TIME, sun) * (1 - rain),
  }
end

local emitters = {}
for i, e in ipairs(EMITTERS) do
  emitters[i] = { kind = e[1], pos = vec3(e[2], e[3], e[4]), ev = nil, tried = false }
end
local level = { surf = 0, magpie = 0, kookaburra = 0 }
local first = true

function script.frameBegin(dt)
  local want = targets()
  -- Ease towards the target (about 2 s), so the dawn chorus and the rain fade rather than switch.
  local ease = first and 1 or math.min(1, (dt or 0) * 0.5)
  first = false
  for kind, v in pairs(want) do level[kind] = level[kind] + (v - level[kind]) * ease end
  local cam = ac.getCameraPosition()
  for _, e in ipairs(emitters) do
    local k = KINDS[e.kind]
    local near = cam:distance(e.pos) < k.max * 1.1
    local vol = level[e.kind]
    if near and vol > 0.01 then
      if not e.ev and not e.tried then
        e.tried = true
        e.ev = load(e.kind)
        if e.ev then
          e.ev:setPosition(e.pos, vec3(0, 0, 1))
          e.ev.cameraInteriorMultiplier = 0.35
          e.ev.cameraExteriorMultiplier = 1
          e.ev.cameraTrackMultiplier = 1
          -- Not every bird the same pitch or in step with the next one.
          if k.pitch > 0 then e.ev.pitch = 1 + (math.random() * 2 - 1) * k.pitch end
          e.ev:start()
          local len = e.ev:getDuration()
          if len and len > 1 then e.ev:seek(math.random() * len) end
        end
      end
      if e.ev then
        e.ev.volume = vol
        e.ev:resumeIf(true)
      end
    elseif e.ev and e.ev:isPlaying() then
      e.ev:stop()
    end
  end
end
