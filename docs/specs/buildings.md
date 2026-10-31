# Spec: buildings (footprints, roof detection, filtering, meshes)

Replaces `src/core/buildings.ts` (upstream-derived, about 95% match). The kinds of building and what they wear are in [buildingStyles.md](buildingStyles.md); this module turns footprints into dressed meshes. Heights follow the height contract in [scenery.md](scenery.md#the-height-contract-applies-to-every-placement-spec-in-this-group).

## What it does

1. Turns OSM footprints into buildings (height from tags, a roof guess for small houses).
2. Detects roofs in aerial photo chunks and makes placeholder houses from them.
3. Filters buildings against the road and against each other.
4. Builds the meshes: walls (collidable), roofs, soffits, window glass, garage and front doors, driveways, verandahs, shop awnings.
5. Small geometry helpers others use: signed ring area, point in ring, centroid, rectangle test.

## The building record

A footprint ring (local metres, first point not repeated), where it came from (`osm`, `detected` from the photo, or `frontage`: a house found along a street frontage by `frontage.ts`), OSM tags if mapped, plus the dress fields from buildingStyles (type, facade, optional ground-floor facade, roof shape, roof finish, pitch, wall height, verandah, awning, parapet, garage). Optional, when known: the front wall (its two corners), the setback from the road edge to the front wall, what's along the front boundary (none, limestone, brick, hedge) and hedge height (used by `lots.ts`).

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
- Sample `ground` at every corner and every 0.5 m along each wall (not the centroid: a hollow inside the footprint sank the walls under the ground round them). Floor = the lowest corner; base of the walls = the lowest of all samples minus SINK. (The old version used corners only and a fixed 0.4 m skirt; sampling the edges as well covers a dip under a long wall without a deep skirt.)
- Wall top = highest corner + wall height. Parapets add on top for flat roofs.
- Pitched roofs only on four-cornered footprints; anything else gets flat.

### Walls in bands

Walls go up in bands, each with its own facade and window layout:
1. A ground-floor facade (shopfront under offices or flats), if given: from the base to one storey of that layout above the floor.
2. The main facade up to the wall top.

Each band is one quad per wall, outside on the right of each edge, flat normals. UVs: u runs continuously round the building (metres / layout period), v counts storeys from that band's floor (v = 1 at the floor, decreasing upward), so the facade texture lines up storey by storey.

**Window glass:** for bands whose layout has panes, a thin quad 1.5 cm proud of the wall over each window opening (not doors) of each period and storey, skipping openings that would hang past the wall's ends (15 cm) or above the top, and those on the front wall behind the garage or front door. UVs 0..1 across each pane (so CSP lights a room behind each window). Mesh `WINDOWS_NNN`, material `window` (CSP's night lighting matches the material name).

### Roofs

- **Flat:** the ring triangulated (earcut) at the wall top, normal up, faces wound upward; UVs = metres / 2. A parapet above it: plain wall outside and in.
- **Pitched (hip, gable, skillion):** rotate the ring so its first edge is a long side. Eave overhang: 0.2 m on warehouses and sheds, 0.45 m otherwise. The roof edge is the footprint grown by the overhang along both axes and lowered by overhang times the pitch.
  - *Gable:* ridge along the long axis at wall top + half the span times tan(pitch), running the full length out to the overhang. Two roof planes; each gable end is a wall triangle up to the ridge, in the wall's plane, textured with the facade's plain band (no windows) squeezed to fit.
  - *Hip:* ridge shortened by half the span at each end (never past the middle); two trapezoid planes and two hip triangles.
  - *Skillion:* one plane rising from the second long side to the first; the high wall continues up to the roof and the ends are wall triangles.
  - Roof UVs: metres / 2 (a 2 m texture repeat).
  - Soffits: from the top of each wall out to the roof edge, facing down. Mesh `SOFFIT_NNN`, material `canopy`, no shadows.

### Street front (only when the front wall is known)

- **Doors:** for houses, townhouses and warehouses. Warehouse: one roller door a third of the way along if the wall is at least 8 m (4.5 m wide, 4.2 m high). House with a garage and a front wall of at least 6 m: a 2.6 x 2.1 m roller door 0.6 m from the wall's start, and a 0.85 x 2.05 m front door near the far end (at most 4.2 m along, at least 1.4 m from the end); with no garage, the front door a third of the way along. Doors stand 2 cm proud, their bottom at the lower of `ground` at their two ends. Walls of under 5 m get none. Meshes `GARAGE_NNN` (material `garage`) and `DOOR_NNN` (`door`).
- **Driveway:** from the garage door out toward the road to where the nature strip starts (setback minus 3.5 m), if that's over 1 m: a quad 0.2 m wider than the door each side, 3 cm above `ground` at each corner. Mesh `DRIVEWAY_NNN`, material `concrete`.
- **Verandah:** if the building has one, the front wall is at least 5 m and the depth fits (depth = min(2.6, setback minus 1.2), at least 1.5): a skillion of the roof's finish from just under the eaves out to depth + 0.3 m at a 10 degree fall, 0.2 m past each end; its underside as soffit; timber posts (mesh `POSTS_NNN`, material `canopy`) about every 2.6 m along at the depth line, from SINK below `ground` at each post to the verandah's underside.
- **Shop awning:** if the building has one, the front wall is at least 4 m and reach = min(3, setback minus 0.4) is at least 1.2: a cantilevered slab 3 m above the floor, 0.35 m thick, top, underside and fascia on the three open sides. Mesh `AWNING_NNN`, material `canopy`.

### Mesh names and materials

- Walls per facade: `1WALL_BLD_<facade name>_NNN`, material `facade_<facade name>`. AC picks a mesh's surface by matching surface keys anywhere in its name, so first make the facade name safe: replace `sand` with `snd`, `grass` with `grs`, `gravel` with `grvl`, `kerb` with `krb`, `road` with `rd`, `dirt` with `drt` (case-insensitive). Without this `render_sand` walls were also sand.
- Roofs per finish: `ROOF_<finish name>_NNN`, material `roof_<finish name>`.
- Soffits, windows, garage, doors, driveways: no shadows. Posts, awnings, walls and roofs cast shadows.
- All via the chunked mesh accumulator.

### Which textures ship (`usedFinishes`)

The set of facades (main and ground-floor) and roof finishes the buildings use, so the pipeline only writes those textures.

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
7. Meshes on a tilted ground: wall bases at least SINK under the lowest sample, wall tops at highest corner + height.
8. Each roof shape: triangle counts and that every roof normal points up; a gable has two wall triangles, a hip four roof faces.
9. Windows: none over doors or past the wall ends; none on layouts without panes; none behind the garage on the front wall.
10. Front: a house with a garage gets a garage door, a front door and a driveway; no front wall known, none; a warehouse gets one big door.
11. Names: a `render_sand` facade's wall mesh doesn't contain "sand"; walls start `1WALL_BLD_`; roofs `ROOF_`; window material `window`.
12. usedFinishes lists every facade (main and ground-floor) and roof finish used.

## Could be deleted instead of rewritten (for Mac)

- **Warehouse roller door** is cheap; keep.
- **Photo roof detection** stays: it's most of the houses (564 of 715 buildings in the Busselton base).

## Additions from the call sites (rewrite session, 31 Oct 2026)

Found while writing the new module from the call sites and the commit messages (the old file stayed closed). They override anything above that disagrees.

### Signatures the callers rely on

- `Building`: `ring`, `source` (`osm` | `detected` | `frontage`), and the dress fields `type`, `facade` (index into `FACADES`), `roof` (`flat` | `hip` | `gable` | `skillion`), `roofColour` (index into `ROOF_COLOURS`), `pitch` (degrees), `height` (wall height above the floor) are required; `groundFacade`, `verandah`, `awning`, `parapet`, `garage`, `tags`, `front` (`[Vec2, Vec2]`), `setback`, `frontKind` (`none` | `limestone` | `brick` | `hedge`, set by house looks, read by `lots.ts`) and `hedgeHeight` are optional. Tests and `shops.ts` build records by hand with only the required fields. The ground-floor facade field is `groundFacade` (nothing outside this module and buildingStyles reads it).
- `fromOsm(ring, tags, index?)`: track.ts still passes the list index third; it's ignored (seed from the centroid). A repeated closing point is dropped and the ring made counter-clockwise.
- `detectBuildings(rgba, size, chunk)`: `chunk` is the terrain chunk's local bounds (`minX..maxX`, `minY..maxY`), the image `size` pixels square, pixel row 0 the chunk's north edge (`maxY`). track.ts also calls it on the car-paint pass just for the rings.
- `filterBuildings(buildings, index, opts, maxDist)`: `index` is the route's `SegmentIndex` (`nearest(x, y, r)`, road width from `index.at(nearest).width`); uses `opts.vergeWidth`. Keeps the input order.
- `buildBuildings(buildings, ground, sinkFor?, groundFor?)` returns `Kn5MeshNode[]`. **One ground per building:** `groundFor(b)` is the height function for every sample of that building (track.ts passes the base's scene ground when any corner or the centroid is on the base, the horizon mesh otherwise), defaulting to `ground`; `sinkFor(b)` is how far the wall base goes under the lowest sample (track.ts: `SINK` on the base, 0.4 m on the horizon), defaulting to `SINK`. A house straddling the detailed terrain's edge once took the horizon mesh (held 3 m under the terrain there) for one corner and sank 4 to 5 m; never mix two grounds in one building. Doors, driveways and verandah posts use the same building's ground and sink.
- `usedFinishes(buildings)` returns `{ facades: Set<number>, roofs: Set<number> }` (indices); track.ts adds to both sets later (spec houses, house looks).
- `plainHouse(roof, roofColour, height)`: the facade is `brick_red` looked up by name (it's first in the list, index 0, so the old "facade 0" still holds).
- `houseRoof(rand)` takes a random function (`() => number`), so callers decide the seed.
- `nearestRoofColour(rgb)` takes 0..255 RGB (frontage.ts scales its 0..1 photo colours up).
- Helpers `centroid`, `pointInRing`, `ringArea`, `isRectangle` stay importable from `buildings.ts` (re-exported from the geometry module).

### Behaviour the commits added

- **Window sills above the ground** (d14ecb8): a big building's floor is its lowest ground, so on a slope its shop windows ran 40 cm into the ground on the high side. Each pane's bottom is kept at least 8 cm over the ground just outside the wall (sampled 0.3 m out at both ends of the pane, the higher of the two); a pane left under 0.3 m tall goes.
- **Wall names** (eb2839b): the surface-key substitution in the facade part of `1WALL_BLD_` names. The material keeps the real facade name (`facade_render_sand`). Nothing in the CSP config matches `1WALL_BLD_` today (lit windows match the material `window`; `docs/verification.md` refers to `1WALL_BLD_*`), but keep the prefix: it's how checks and people find building walls.
- **Houses at the terrain mesh's edge** (704513a): on the base, track.ts's `groundFor(b)` is `ground.forRing(b.ring)` (sceneGround.ts): the built mesh where it covers a point, and where it doesn't (past the terrain mesh's edge), the analytic terrain but never under the mesh's lowest point along the ring. So a straddling house stands on the mesh's lowest, not the terrain past it. This module only has to use `groundFor(b)` for every height of the building; the rule lives in sceneGround.
- **Buildings start at the lowest ground along their edges** (6781975): sample every corner, along each edge at most 2 m apart (the midpoint of a short edge), and the centroid.
- **Shopfronts on replaced buildings** (6781975): track.ts skips `findShopfronts` on buildings inside a hand-made layer's cleared circles. Not this module's job; noted so nobody moves it here.

### Choices the rewrite made where the spec was open (31 Oct 2026, second session)

- **Excess green** in roof detection is `(2G - R - B) / (R + G + B)` on the cell's mean colour; saturation and lightness are HSL. Cells are classified on their mean colour.
- **Front door with a garage:** starts at `min(4.2, wall - 1.4 - 0.85)` along the wall, but never before 3.6 m (clear of the 0.6 to 3.2 m garage door); dropped if it would end within 0.3 m of the wall's end.
- **Front wall:** the ring edge whose ends match `front` (either order) within 1 m in total, else the edge whose middle is nearest the front's middle.
- **Setback unknown:** driveway assumes 6 m (2.5 m of driveway), verandah 6 m, awning 3.4 m (a 3 m reach).
- **Verandah top** starts 15 cm under the eave (the wall top on a flat roof); posts 0.1 m square, `max(2, round(wall / 2.6) + 1)` of them evenly from 0.1 m in at each end; a post under 0.5 m tall is left out.
- **Gable rakes** get soffits too (two quads per gable end, from the wall triangle's sloping edges out to the rake), and a skillion's high wall and end triangles wear the plain band like gable ends.
- **Parapets** are the plain band on both faces (outside, and the same quad turned inward); no cap.
- **Doors** are dropped if under 1 m tall after capping at 10 cm below the wall top.
- **Pitch** is clamped to 1..60 degrees for the roof maths.
- `Building` is a type (`Dress & { ... }`) rather than an interface; callers only spread and read it.
- Extra exports for tests: `heightFromTags`, `parseColour`, `roofLike`, `safeName`, `ChunkBounds`.

### Determinism

- Every random choice is seeded from a position (`placeSeed` in `random.ts`): `fromOsm` and `detectBuildings` from the building's centroid or patch centre, with a salt per draw. No list index anywhere.
- Facades and finishes are looked up by name, never by list position.
- The new generator and seeds mean the first build after this rewrite differs from the accepted base (roof shapes and finishes of OSM and detected houses, facade picks); accept a new base deliberately.
