# Spec: buildings (footprints, roof detection, filtering, meshes)

Replaces `src/core/buildings.ts` (upstream-derived, about 95% match). The kinds of building and what they wear are in [buildingStyles.md](buildingStyles.md); this module turns footprints into dressed meshes. Heights follow the height contract in [scenery.md](scenery.md#the-height-contract-applies-to-every-placement-spec-in-this-group).

## What it does

1. Turns OSM footprints into buildings (height from tags, a roof guess for small houses).
2. Detects roofs in aerial photo chunks and makes placeholder houses from them.
3. Filters buildings against the road and against each other.
4. Builds the meshes: walls (collidable), roofs, soffits, window glass, garage and front doors, driveways, verandahs, decks, shop awnings.
5. Small geometry helpers others use: signed ring area, point in ring, centroid, rectangle test.

## The building record

A footprint ring (local metres, first point not repeated), where it came from (`osm`, `detected` from the photo, or `frontage`: a house found along a street frontage by `frontage.ts`), OSM tags if mapped, plus the dress fields from buildingStyles (type, facade, optional ground-floor facade, roof shape, roof finish, pitch, wall height, stumps and the facade between them, verandah, awning, parapet, garage). Optional, when known: the front wall (its two corners), the setback from the road edge to the front wall, what's along the front boundary (none, limestone, brick, hedge) and hedge height (used by `lots.ts`).

Other modules (`frontage.ts`, `lots.ts`, `shops.ts`, `houseLooks.ts`, `specHouse` users, the pipeline) read and write this record, so keep the field names or update them together.

## Helpers

- **Ring area:** signed (shoelace), positive counter-clockwise.
- **Point in ring:** even-odd crossing test.
- **Centroid:** the plain average of the vertices (not the area centroid; callers use it as a stable "where is it" point and as the seed position, so keep it the vertex average or every house's look changes).
- **Rectangle:** exactly four corners, each within 15 degrees of square (absolute cosine of the corner angle at most 0.26).
- **Plain house:** a dress of type house, facade 0, given roof shape, finish and height, pitch 22. A placeholder until `dressBuilding` runs.
- **House roof guess:** hip about two thirds of the time (0.68), gable otherwise.

## OSM footprints (`fromOsm`)

- **Height from tags:** `height` or `render_height` if over 2 m (capped at 80). Else `building:levels` times 3 m plus 1 (capped at 80). Else by `building`: garage, garages, shed, carport, hut, cabin, roof: 3.5 m; house, detached, residential, semidetached_house, bungalow, farm: 3 m; anything else 6 m.
- **Roof:** flat unless the building is small (under 400 m^2 and at most 7 m tall) and a rectangle. Then `roof:shape` gabled gives gable, hipped gives hip, otherwise the house roof guess.
- **Roof finish:** from `roof:colour` (hex, or a basic colour name mapped to a plain RGB; unknown names to mid grey) matched to the nearest pitched finish; otherwise a random pitched finish.
- **Seed:** the old code seeded by the building's index in the OSM list, so a new building anywhere in the data changed the roofs after it. Seed from the centroid instead (position hash, scenery spec).

## Roof colour matching (`nearestRoofColour`)

Nearest pitched roof finish (buildingStyles `PITCHED`) by squared RGB distance, after lifting the photo colour a little (aerial photos read dark and hazy: scale by 1.12, add 8, cap at 255).

## Roof detection in the photo (`detectBuildings`)

**Input:** a chunk's RGBA aerial texture (north up) and its local bounds. **Output:** detected houses.

- Cells of about 0.8 m (an integer number of pixels, at least 1).
- A cell is roof-like if it is *metal or concrete* (saturation under 0.16, lightness over 0.5, excess-green under 0.03) or *terracotta* (red over 1.3 times green and 1.5 times blue, saturation over 0.35, lightness 0.25 to 0.65). Keep each cell's mean colour.
- Morphological opening (erode with the 4-neighbour cross, then dilate within the original mask) removes fences, paths and road lines.
- Connected patches (4-neighbour) of 40 to 700 m^2.
- Principal axes of the patch; its extent along and across them (plus a cell). Reject if the short side is under 4 m, it's more than 4 times longer than wide, or the patch fills under 55% of that box.
- The building is the oriented box (centred on the box middle, not the cell mean). Plain house, roof guess, roof finish from the patch's mean colour, wall height 3.6 m if over 250 m^2 else 2.8 m. Source `detected`.
- **Determinism:** seed from the chunk position (or per patch from its centre). The pipeline sorts detected buildings by position afterwards, so the order of chunks doesn't matter.

## Filtering (`filterBuildings`)

**Inputs:** buildings, segment index, options (verge width), max distance from the route.

- Drop rings with fewer than 3 points or under 6 m^2.
- Drop non-OSM buildings whose centroid or any corner falls inside a mapped (OSM) building.
- Drop a building if any corner is within half road + verge + 2 m of the route centreline.
- Keep only buildings with at least one corner within the max distance of the route.

The pipeline adds more filters (rings near roundabouts, detected roofs on streets, jetty buildings, cleared layer circles).

## Meshes (`buildBuildings`)

**Inputs:** dressed buildings and `ground(x, y)`. (The pipeline passes the detailed ground in the built corridor and the horizon mesh minus 0.6 m beyond it; with the one surface, the corridor part is the surface sampler. Which function to pass is the caller's choice.)

### Heights

- Make the ring counter-clockwise.
- Sample `ground` at every corner, every edge midpoint and the centroid. Floor = the lowest corner; base of the walls = the lowest of all samples minus SINK. (The old version used corners only and a fixed 0.4 m skirt; sampling the edges as well covers a dip under a long wall without a deep skirt.)
- Wall top = highest corner + stumps + wall height. Parapets add on top for flat roofs.
- Pitched roofs only on four-cornered footprints; anything else gets flat.

### Walls in bands

Walls go up in bands, each with its own facade and window layout:
1. Between stumps (if raised and there's an under-facade, e.g. lattice): from the base to the raised floor, blank layout.
2. A ground-floor facade (shopfront under offices or flats), if given: one storey of that layout from the floor.
3. The main facade up to the wall top.

Each band is one quad per wall, outside on the right of each edge, flat normals. UVs: u runs continuously round the building (metres / layout period), v counts storeys from that band's floor (v = 1 at the floor, decreasing upward), so the facade texture lines up storey by storey.

**Window glass:** for bands whose layout has panes, a thin quad 1.5 cm proud of the wall over each window opening (not doors) of each period and storey, skipping openings that would hang past the wall's ends (15 cm) or above the top, and those on the front wall behind the garage or front door. UVs 0..1 across each pane (so CSP lights a room behind each window). Mesh `WINDOWS_NNN`, material `window` (CSP's night lighting matches the material name).

### Roofs

- **Flat:** the ring triangulated (earcut) at the wall top, normal up, faces wound upward; UVs = metres / 2. A parapet above it: plain wall outside and in.
- **Pitched (hip, gable, skillion):** rotate the ring so its first edge is a long side. Eave overhang: 0.6 m on a Queenslander, 0.2 m on warehouses and sheds, 0.45 m otherwise. The roof edge is the footprint grown by the overhang along both axes and lowered by overhang times the pitch.
  - *Gable:* ridge along the long axis at wall top + half the span times tan(pitch), running the full length out to the overhang. Two roof planes; each gable end is a wall triangle up to the ridge, in the wall's plane, textured with the facade's plain band (no windows) squeezed to fit.
  - *Hip:* ridge shortened by half the span at each end (never past the middle); two trapezoid planes and two hip triangles.
  - *Skillion:* one plane rising from the second long side to the first; the high wall continues up to the roof and the ends are wall triangles.
  - Roof UVs: metres / 2 (a 2 m texture repeat).
  - Soffits: from the top of each wall out to the roof edge, facing down. Mesh `SOFFIT_NNN`, material `canopy`, no shadows.

### Street front (only when the front wall is known)

- **Doors:** for houses, townhouses and warehouses, not raised houses. Warehouse: one roller door a third of the way along if the wall is at least 8 m (4.5 m wide, 4.2 m high). House with a garage and a front wall of at least 6 m: a 2.6 x 2.1 m roller door 0.6 m from the wall's start, and a 0.85 x 2.05 m front door near the far end (at most 4.2 m along, at least 1.4 m from the end); with no garage, the front door a third of the way along. Doors stand 2 cm proud, their bottom at the lower of `ground` at their two ends. Walls of under 5 m get none. Meshes `GARAGE_NNN` (material `garage`) and `DOOR_NNN` (`door`).
- **Driveway:** from the garage door out toward the road to where the nature strip starts (setback minus 3.5 m), if that's over 1 m: a quad 0.2 m wider than the door each side, 3 cm above `ground` at each corner. Mesh `DRIVEWAY_NNN`, material `concrete`.
- **Verandah:** if the building has one, the front wall is at least 5 m and the depth fits (depth = min(2.6, setback minus 1.2), at least 1.5): a skillion of the roof's finish from just under the eaves out to depth + 0.3 m at a 10 degree fall, 0.2 m past each end; its underside as soffit; timber posts (mesh `POSTS_NNN`, material `canopy`) about every 2.6 m along at the depth line, from SINK below `ground` at each post to the verandah's underside. On a raised house (stumps over 0.3 m), a deck at floor height (mesh `DECK_NNN`, `timber`) with a lattice skirt round its three open sides.
- **Shop awning:** if the building has one, the front wall is at least 4 m and reach = min(3, setback minus 0.4) is at least 1.2: a cantilevered slab 3 m above the floor, 0.35 m thick, top, underside and fascia on the three open sides. Mesh `AWNING_NNN`, material `canopy`.

### Mesh names and materials

- Walls per facade: `1WALL_BLD_<facade name>_NNN`, material `facade_<facade name>`. AC picks a mesh's surface by matching surface keys anywhere in its name, so first make the facade name safe: replace `sand` with `snd`, `grass` with `grs`, `gravel` with `grvl`, `kerb` with `krb`, `road` with `rd`, `dirt` with `drt` (case-insensitive). Without this `render_sand` walls were also sand.
- Roofs per finish: `ROOF_<finish name>_NNN`, material `roof_<finish name>`.
- Soffits, windows, garage, doors, driveways: no shadows. Posts, decks, awnings, walls and roofs cast shadows.
- All via the chunked mesh accumulator.

### Which textures ship (`usedFinishes`)

The set of facades (main, ground-floor, and the under-facade on raised houses) and roof finishes the buildings use, so the pipeline only writes those textures.

## Call sites

- `src/core/track.ts`: `detectBuildings` (photo chunks, also for roof rings), `fromOsm`, `filterBuildings`, dress via `dressBuilding` (buildingStyles), `usedFinishes`, `buildBuildings` with `buildingGround`; helpers `centroid`, `pointInRing`, `ringArea`, `isRectangle`, `plainHouse`, `houseRoof`.
- `frontage.ts` (centroid, houseRoof, nearestRoofColour, plainHouse, pointInRing, Building), `lots.ts` (pointInRing, ringArea), `shops.ts` (centroid, ringArea), `challengeFiles.ts` (pointInRing).
- Tests now: `test/buildings.test.ts`, `test/buildingStyles.test.ts` (buildBuildings), `test/houseLooks.test.ts`, `test/houses.test.ts`, `test/shops.test.ts`, `test/frontage.test.ts` (helpers and the type).

Helpers (ring area, point in ring, centroid, rectangle) are general geometry: put them in a small geometry module rather than here.

## Edge cases

- Clockwise rings (reverse first); rings with repeated last points (callers shouldn't pass them; tolerate).
- Non-rectangular four-cornered footprints asked for a pitched roof: still pitched (the old code only checks the corner count here; the rectangle check happens when dressing).
- Very long thin footprints: hip ridge length never negative.
- Missing front wall: no doors, verandah or awning.
- Setback unknown: verandah depth assumes 6 m setback, awning reach 3.4 m.
- Steep ground under a footprint: base well below the low side; floor at the lowest corner.
- Zero buildings: no meshes.

## Test list (write fresh)

1. Helpers: area sign for both windings; point in ring inside, outside, on a concave notch; rectangle true for a rotated rectangle, false for a 20 degree parallelogram and a five-sided ring.
2. Height from tags: height, render_height, levels, each building kind, the 80 m cap, a bogus 1 m height ignored.
3. fromOsm: a small rectangular house gets a pitched roof, a big one or an L-shape flat; `roof:shape` respected; `roof:colour` matched; same output for the same building at a different list index.
4. Roof colour: a terracotta RGB maps to a tile finish, pale grey to a pale metal; membrane and gravel never chosen.
5. Detection: a synthetic 12 x 9 m pale rectangle on grass gives one building close to that size and orientation; a 1 m wide pale line (a path) gives none; a 30 x 30 m patch (over 700 m^2) none; a terracotta patch gets a tile finish.
6. Filtering: a detected roof inside a mapped building dropped; a building on the verge dropped; one beyond the max distance dropped.
7. Meshes on a tilted ground: wall bases at least SINK under the lowest sample, wall tops at highest corner + height; a raised house's floor at stumps height.
8. Each roof shape: triangle counts and that every roof normal points up; a gable has two wall triangles, a hip four roof faces.
9. Windows: none over doors or past the wall ends; none on layouts without panes; none behind the garage on the front wall.
10. Front: a house with a garage gets a garage door, a front door and a driveway; no front wall known, none; a warehouse gets one big door.
11. Names: a `render_sand` facade's wall mesh doesn't contain "sand"; walls start `1WALL_BLD_`; roofs `ROOF_`; window material `window`.
12. usedFinishes lists every facade (including lattice under a raised house) and roof finish used.

## Could be deleted instead of rewritten (for Mac)

- **Stumps, lattice skirts and raised decks** only come from the Queenslander type, which is only chosen in Queensland. No WA build will ever make one. Delete with the Queenslander type (buildingStyles spec).
- **Warehouse roller door** is cheap; keep.
- **Photo roof detection** stays: it's most of the houses (564 of 715 buildings in the Busselton base).
