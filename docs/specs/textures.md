# Spec: procedural textures and the small raster

Replaces `src/core/textures.ts` (upstream-derived, about 95% match). No placement or heights here.

## What it does

Paints every texture a build needs so a build never depends on a download, plus a small anti-aliased raster for the map and Content Manager outline images. Everything is deterministic: same call, same bytes.

## Shared building blocks

- **Seeded random:** duplicates the one in scenery.ts. Use the shared one (scenery spec).
- **Tileable value noise:** width, height, cells across, seed; returns floats in 0..1 on a lattice of that many cells across (and proportionally many down), interpolated with smoothstep, wrapping at the edges so the noise tiles.
- **Fill:** width, height and a per-pixel shading function (x, y, index) returning RGB; returns opaque RGBA bytes with values clamped to 0..255.
- **Solid colour:** a 4 x 4 opaque PNG of one colour.

## Road surface (`sealTexture`)

**Inputs:** kind (asphalt or chipseal), two-lane or one, a variant number. **Output:** DXT1 DDS plus the raw RGBA (for the browser preview and for normal maps), 512 x 1024. u runs across the full road width (left to right), v along, covering a fixed 24 m (`SEAL_LENGTH`, exported; the road, side street, roundabout and unsealed modules use it for their UVs) and tiling seamlessly along the road.

- Seeded from kind, variant and lane count.
- **Wheel paths:** two per lane, about 0.26 of a lane either side of the lane's centre, softened.
- **Asphalt:** dark and fine (around 60/255), three scales of noise plus grain; polished wheel paths slightly darker; a faint oil-drip line down each lane's centre.
- **Chipseal:** coarse stones from a small palette of grey, brown and blue-grey; binder flushed darker and smoother in the wheel paths.
- **Patches:** 1 to 3 rectangles inside a lane, 1.5 to 6.5 m long, a different tone, with a dark sealed edge. They wrap along v.
- **Sealed cracks:** dark meandering lines, 3 px wide; asphalt 4 to 7, chipseal 1 or 2. Most run along the road (kept within about 30 degrees of it), some across. On two-lane roads one crack runs near the centre joint. They wrap along v.
- Markings are separate geometry, not in this texture.

## Small plain textures

- **Paint:** 64 px, near-white with worn patches. Tiles every metre.
- **Verge:** 256 px, gravel-brown fading to dry grass (noise based).
- **Grass:** 512 px, green with two scales of noise and grain.
- **Concrete:** 64 x 256, pale grey and weathered, a contraction joint across the top two rows so each tile is one pour (kerbs and footpaths).
- **Guard rail:** 64 px, W-beam: two ridges and a groove across v.
- **Guide post:** 48 x 64, three thirds across: a red reflector, a white reflector, plain white. Reflectors near the top (rows about 3 to 11 of 64), with a slightly darker outline row. The u ranges the guide posts use are in the scenery spec; keep them in step.
- **Garage door:** 64 px, a Colorbond roller door: fine horizontal ribs, darker bottom rail.
- **Window:** 64 px, sky reflected at the top darkening downward, a hint of curtain at the sides. One window per texture (CSP lights rooms behind it).
- **Barriers:** one texture per kind in the exported `BARRIERS` list (`colorbond`, `paling`, `brickwall`, `hedge`; `fences.ts` uses the list), 128 px for 2 m x 2 m: Colorbond panels (corrugations, a post at the tile edge, a top rail, grey-green); timber palings with shadow gaps and a rail; red brick garden wall with a capping course; a clipped hedge (leaf noise, darker hollows).

## Detail and ground layers (for CSP detail shaders)

How the game uses them: a detail texture multiplies the base texture wherever the base's alpha is 0, tiled many times across the base's UVs. A txMaps texture's channels scale specular (R), glossiness (G) and sun specular (B).

- **Detail** (`asphalt`, `chipseal`): 256 px, near white so it adds grain without darkening; thousands of small stones a little darker or lighter than the binder (chipseal fewer, bigger). Stones drawn squashed 3:1 along v, because road UVs run 24 m along for about 8 m across, so they come out round on the road. Wraps.
- **Flat normal map:** 4 x 4 of (128, 128, 255).
- **Maps:** 4 x 4 of (specular, gloss, sun) times 255.
- **Ground classes** of an aerial photo: per pixel, weights that add to at most 1 for *grass* (green lawns; dry yellow grass in summer: warm but not earthy) and *dirt* (warm, earthy: redder than dry grass, green falling behind red), the rest *plain* (roofs, roads, paving, water, shade). Each softened with a 3 x 3 box blur.
- **Ground mask:** the classes box-filtered down to at most 256 texels a side: R grass, G dirt, B plain (summing to 255), A 255.
- **Ground detail** (`grass`, `dirt`, `plain`): 512 px, tiling, normalised to mid grey on average (the shader applies it at double strength, so the photo's brightness is unchanged from a distance). Grass: many short tapering blades over a mottled dark base, some tinted dry. Dirt: multi-scale noise, pebbles lit on one side with a shadow, a few cracks. Plain: faint grain. Tile sizes in metres exported (`GROUND_TILE`: grass 1.6, dirt 2.4, plain 2).
- **Normal from height:** treats brightness as height and returns a tangent-space normal map (DirectX convention, green down), wrapping at the edges, with a strength factor. Cracks and patch edges come out as grooves.

## Raster (`Raster`)

An RGBA canvas (given background) with:
- **line(points, thickness, colour):** an anti-aliased thick polyline; per-pixel coverage is the maximum over its segments, so joints don't double up; blended over what's there with alpha compositing.
- **dot(x, y, radius, colour):** an anti-aliased filled circle.
- **png():** encode.

Used by `acFiles.ts` for map.png and the outline and preview images.

## Call sites

- `src/core/track.ts`: seal, paint, verge, grass, concrete, rail, guide post, garage, window, barriers, detail, ground detail and mask, flat normal, maps, normal-from-height, solid colours.
- `SEAL_LENGTH`: roadMesh, sideStreets, roundabout, unsealed.
- `fill`, `rng`, `valueNoise`: buildingStyles, raceDress, photoSea, coast, parkedCars, trafficLights, flags, houseTextures, shops, unsealed, farmRoadsides, surfaceTextures, farm.
- `vergeTexture`: zones, farmRoadsides. `BARRIERS`: fences. `Raster`: acFiles. `solidTexture`: landmarkLayer, `scripts/blender/make_layer.ts`, `scripts/check/make_test_layer.ts`. `normalFromHeight`, `windowTexture`: landmarkLayer.
- Tests now: `test/detail.test.ts`, `test/unsealed.test.ts`, `test/zones.test.ts`, `test/gltf.test.ts`.

## Edge cases

- Noise with more cells than pixels; non-square noise.
- Ground mask from a photo smaller than 256 px (no downsampling).
- All-transparent or all-black photo (all plain).
- Raster lines partly or wholly off the canvas; a one-point line (nothing); zero-length segments.

## Test list (write fresh)

1. Value noise tiles: the left and right columns (and top and bottom rows) continue each other; values in 0..1; same seed same output.
2. Seal texture: 512 x 1024; identical bytes for the same arguments; different variants differ; the first and last rows are close (seamless along v); asphalt mean darker than chipseal; wheel-path columns darker than the lane centre on chipseal.
3. Guide post texture: left third has red pixels near the top, middle third white, right third none.
4. Detail textures: mean close to white (above about 0.85); stone blobs wider in u than v.
5. Ground classes: pure green grass pixel weights to grass; red-brown earth to dirt; grey to plain; weights never sum above 1.
6. Ground mask: at most 256 a side; R + G + B = 255 everywhere.
7. Ground detail: mean brightness about mid grey for each kind; tiles.
8. Normal from height: a flat image gives (128, 128, 255); a vertical bright stripe tilts normals left and right of it in red; green follows the DirectX convention.
9. Raster: a horizontal line of thickness 3 covers about 3 rows; joints don't come out darker than straight parts; a dot is round; alpha blending over a transparent background.
10. Barrier textures for every name in `BARRIERS`.

## Could be deleted instead of rewritten (for Mac)

- **`treeAtlas` and `TREE_VARIANTS`.** Unused: nothing imports them. Trees use the fork's own sprite atlas in `treeSprites.ts`. Delete, don't rewrite.
- **The duplicate `rng`** here: delete and import the shared one.
- **Guard rail texture** goes if the W-beam rail goes (scenery spec).
- **Grass texture** stays: untextured terrain, backdrop, kerb strips and roundabout islands still use material `grass`.
