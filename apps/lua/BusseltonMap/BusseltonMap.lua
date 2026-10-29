-- Busselton Map: the town's streets with you (and everyone else) on them.
--
-- Every Busselton AC build ships extension/street_map.png (every street the track has, the route
-- over them in yellow) and extension/street_map.ini (the same transform as AC's map.ini:
-- pixel = (X + X_OFFSET) / SCALE_FACTOR, Z likewise). On a track without them the window says so.
--
-- The map follows your car, north up. Scroll in the window (or the + and - buttons) to zoom.

local mapPath, iniOk, status = nil, false, ''
local W, H, scale, xOff, zOff = 0, 0, 1, 0, 0
local zoom = 1.0 -- metres per window pixel, at 1: one map pixel per window pixel
local loaded = false

local function trackFolder()
  local ok, folder = pcall(function () return ac.getFolder(ac.FolderID.ContentTracks) .. '/' .. ac.getTrackID() end)
  if ok then return folder end
  return nil
end

local function load()
  loaded = true
  local folder = trackFolder()
  if not folder then
    status = 'Track folder not found.'
    return
  end
  local ini = folder .. '/extension/street_map.ini'
  local okText, text = pcall(io.load, ini)
  if not okText or type(text) ~= 'string' then
    status = 'No street map on this track.'
    return
  end
  local v = {}
  for line in string.gmatch(text, '[^\r\n]+') do
    local k, val = string.match(line, '^%s*([%w_]+)%s*=%s*(.-)%s*$')
    if k then v[k] = tonumber(val) end
  end
  if not (v.WIDTH and v.HEIGHT and v.SCALE_FACTOR and v.X_OFFSET and v.Z_OFFSET) then
    status = 'The street map is incomplete.'
    return
  end
  W, H, scale, xOff, zOff = v.WIDTH, v.HEIGHT, v.SCALE_FACTOR, v.X_OFFSET, v.Z_OFFSET
  mapPath = folder .. '/extension/street_map.png'
  iniOk = true
end

-- World X/Z to map pixels.
local function toMap(x, z)
  return (x + xOff) / scale, (z + zOff) / scale
end

function windowMain(dt)
  if not loaded then load() end
  if not iniOk then
    ui.text(status)
    return
  end
  local size = ui.windowSize()
  local origin = ui.getCursor()
  local w, h = size.x - 16, size.y - origin.y - 36
  if w < 40 or h < 40 then return end
  local me = ac.getCar(0)
  if not me then return end
  local cx, cz = toMap(me.position.x, me.position.z)
  -- Window pixels per map pixel.
  local k = 1 / zoom
  local halfU, halfV = w / 2 / k, h / 2 / k
  local uv1 = vec2((cx - halfU) / W, (cz - halfV) / H)
  local uv2 = vec2((cx + halfU) / W, (cz + halfV) / H)
  local p1 = vec2(origin.x, origin.y)
  local p2 = vec2(origin.x + w, origin.y + h)
  ui.drawRectFilled(p1, p2, rgbm(0.1, 0.11, 0.13, 0.85))
  ui.pushClipRect(p1, p2)
  ui.drawImage(mapPath, p1, p2, rgbm(1, 1, 1, 1), uv1, uv2)
  local centre = vec2(origin.x + w / 2, origin.y + h / 2)
  local function toWindow(x, z)
    local mx, mz = toMap(x, z)
    return vec2(centre.x + (mx - cx) * k, centre.y + (mz - cz) * k)
  end
  -- Other cars: small dots.
  local sim = ac.getSim()
  for i = 1, (sim.carsCount or 1) - 1 do
    local c = ac.getCar(i)
    if c and c.isConnected ~= false then
      ui.drawCircleFilled(toWindow(c.position.x, c.position.z), 4, rgbm(0.35, 0.75, 1, 1), 12)
    end
  end
  -- You: an arrow the way you're facing.
  local f = vec2(me.look.x, me.look.z)
  if f:length() < 1e-3 then f = vec2(0, -1) end
  f = f:normalize()
  local side = vec2(-f.y, f.x)
  local tip = centre + f * 11
  local a = centre - f * 7 + side * 7
  local b = centre - f * 7 - side * 7
  ui.drawTriangleFilled(tip, a, b, rgbm(0.95, 0.3, 0.25, 1))
  ui.popClipRect()

  ui.setCursor(vec2(origin.x, origin.y + h + 6))
  if ui.button('-') then zoom = math.min(8, zoom * 1.5) end
  ui.sameLine()
  if ui.button('+') then zoom = math.max(0.25, zoom / 1.5) end
  ui.sameLine()
  ui.text(string.format('  %.0f m across', w * zoom * scale))
  if ui.windowHovered() then
    local wheel = ui.mouseWheel()
    if wheel > 0 then zoom = math.max(0.25, zoom / 1.2) elseif wheel < 0 then zoom = math.min(8, zoom * 1.2) end
  end
end
