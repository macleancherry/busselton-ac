# Spec: roadside scenery (trees, trunks, guard rails, guide posts, shared mesh helpers)

Replaces `src/core/scenery.ts` (upstream-derived, on `UPSTREAM-FILES.txt`). Written from the old module so a separate session can write a fresh one without it open. No code here on purpose: describe, don't copy.

## The height contract (applies to every placement spec in this group)

The review (docs/external-review-2026-10-31.md, F2 and recommendation 2) puts one surface in charge of all heights. The work is on the `feat/one-ground` branch (WIP commit "one surface for scenery heights", `src/core/sceneGround.ts`), referred to in the task as the one-surface branch. The new modules follow it:

- **One ground function, passed in.** Every placement function takes `ground(x, y) -> metres`: the top of the built physics ground at a local point (road, gutters, kerbs, nature strips, side streets, roundabouts, footpaths, terrain), with the caller's fallback (terrain, then the horizon mesh) where no mesh covers the point. The module never works a height out for itself: no road-sample formulas (crown, banking), no verge slope model, no kerb-height offsets, no terrain lookups, no "ground minus 0.6 m".
- **SINK.** A placed object's base goes a fixed small depth into the surface (the WIP uses 2 cm, exported from the ground module as `SINK`), so no gap shows at its foot and the ground check (base within 5 cm of the surface) passes. Take SINK from the ground module, not a local constant.
- **Measured where the object stands.** Each post, box or trunk samples `ground` at its own position, not at the road sample it was placed from. Things with a footprint (buildings, shelters, canopies) sample each corner; see their specs.
- **Heights above the ground are fine.** A rail's beam at 0.45 to 0.8 m, a sign at 2.1 m, a lamp at 8.2 m: these are measured up from the ground at the object's own foot.
- **Callers can still pass a different function** for special cases (the horizon trees stand on the far-terrain mesh; roundabout island shrubs on the island). That's the caller's choice, not the module's.

## What it does

Five things, plus two small helpers used across the codebase:

1. Finds tree positions in aerial photo chunks.
2. Filters tree positions against the road (clearance, crown trimming, a total cap).
3. Builds tree meshes (crossed alpha-tested quads) and invisible collidable trunk boxes.
4. Decides where guard rails are needed and builds W-beam rails with posts.
5. Builds white Australian guide posts.
6. Helpers: a seeded random number generator, a box-builder, and a mesh accumulator that splits output into kn5-sized pieces.

## Shared helpers

### Seeded random (`rng(seed)`)

Returns a function giving uniform numbers in [0, 1). Same seed, same sequence, on every platform. Any good 32-bit integer-hash generator is fine (the old one is a well-known public 32-bit mixer; pick your own). Used by many modules (buildings, buildingStyles, lots, frontage, raceDress, farmRoadsides, paths), so it should live in a small shared module (for example `src/core/random.ts`) rather than here. `textures.ts` has a duplicate; both should import the one.

Changing the generator changes every generated look (house styles, tree jitter), so the first build after the rewrite will differ from the accepted base. That's expected: accept a new base through `scripts/upgrade/base.mjs`.

### Position hash

Add a helper that turns a position (rounded to 10 cm) and a salt into a seed or a number in [0, 1). Use it wherever a random choice belongs to a place (tree rotation, species, house dress), so results don't depend on list order. The pipeline already does this for building dress (see buildingStyles spec).

### Chunked mesh accumulator

Collects geometry into mesh builders and starts a new one before a builder would pass the kn5 per-mesh vertex limit (`MAX_MESH_VERTICES` from the kn5 writer; 16-bit indices). The caller says how many vertices the next item needs; the accumulator moves on if they wouldn't fit. Every builder it hands out has per-vertex normals enabled. `all()` returns the non-empty builders in order. Used by furniture, utilities, buildings, lots, markings, kerbside, side streets, coast, jetty, parked cars, armco, raceDress. Also better in a shared module.

### Box

Builds a rectangular box: centre (x, y), unit direction of its length, length, depth (across), bottom height, top height. Four sides plus a top (no bottom), faces wound counter-clockwise seen from outside, flat normals per face. Side UVs: each side runs u from 0 to 1 across its width (or a caller-given [u0, u1] per side, used by guide posts to show a reflector on chosen faces) and v 1 at the bottom to 0 at the top. Top UVs all 0. Side order matters for the per-side UV override: corners go (back-right, front-right, front-left, back-left) relative to the length direction, and side k joins corner k to corner k+1. So side 0 faces right, side 1 forward (along the length), side 2 left, side 3 back. Keep that ordering or update guide posts to match.

## 1. Trees from the photo

**Input:** an RGBA aerial texture of one terrain chunk (north up, square, `size` pixels), the chunk's local bounds, and a density setting (0 off, 1 normal, 2 dense).

**Output:** tree spots: position, scale, species index (0 for now; chosen later by the pipeline), optional CSP model index (set later), and `coastal` (water within about 60 m).

**Rules:**
- Density 0: nothing.
- Cut the photo into square cells: 6.5 m at density 1, 4.5 m at density 2 (at least 2 px a cell).
- Per cell, mean colour, mean lightness, lightness standard deviation (texture), and excess-green index (2G minus R minus B, over R+G+B).
- Water first: clearly bluer than red and nearly as blue as green is sea, not canopy (teal sea reads green otherwise). Mark it and move on.
- Skip cells that are too bright (lightness 0.42 or more) or nearly black (0.04 or less).
- Three canopy kinds:
  - *Lush:* excess-green above 0.05 and textured (std above 0.025). Probability rises with greenness, from 0.35 at the threshold to 1.
  - *Grey-olive* (eucalypt, tuart): barely green (above 0.012), green at least about red, not blue-tinged, and textured in a middle band (std 0.04 to 0.14). Probability from 0.3 rising with texture.
  - *Shaded:* not red, not strongly blue, textured (0.035 to 0.18). No probability of its own.
- Grey-olive and shaded cells only count inside a stretch of canopy: at least 70% of their in-bounds 8 neighbours must be some canopy kind. That rejects rows of parked cars and roof edges, which are equally textured but only a cell or two wide. Inside a stretch, grey-olive gets at least 0.6 and shaded 0.4.
- Keep a cell with its probability; place the tree at the cell centre jittered by up to about half a cell each way; scale 0.75 to 1.35.
- Coastal: within a 60 m radius (in cells, circular), more than a fifth of the cells are water. A blue roof or a pool is too small to count.
- **Determinism:** random draws seeded from the chunk's position. Better than the old version: seed each cell's draws from the cell's world position, so overlapping or reordered chunks agree.

**Edge cases:** chunk smaller than a cell; all-water chunk; photo missing (caller skips); pixels with alpha 0 (treat as no data: skip, the old code didn't).

## 2. Filtering trees

**Inputs:** spots, the route's segment index (nearest point, distance, road width there), build options (corridor, verge width), the cap (`maxTrees`), and an optional area cover function (distance outside an area build's polygons, for area builds).

**Rules:**
- A spot further than the corridor minus 3 m from the route is kept only if the area cover says it's inside an area build (cover distance within corridor minus 3). Otherwise dropped.
- Room = distance from the route centreline minus (half road width + verge width + 1.5 m). No room: dropped.
- The crown counts as 60% of the species' crown radius times scale (crowns overlap a little). If that fits in the room, keep. If not, but a tree scaled down to fit would be at least half its natural size, keep it at that smaller scale. Otherwise drop.
- If more than the cap remain, thin evenly through the list (every k-th), not by cutting off whole areas.

**Note for the rewrite:** the even thinning depends on list order; sort by position first so the same trees survive every build.

Side streets, roundabouts, layers and cleared circles are filtered by the pipeline, not here.

## 3. Tree meshes and trunks

**Trees:** three vertical quads per tree crossed at 60 degrees, each two-sided (separate vertices for each face), alpha-tested `trees` material. Quad width is twice the crown radius times scale, height the species height times scale; UVs pick the species' u range in the tree atlas (`treeSprites.ts`, `TREE_SPECIES`), v 1 at the bottom. Normals tilt strongly upward (horizontal part about 0.35 of the face direction, then normalised) so foliage lights like a canopy. Rotation per tree random in [0, pi). Base at `ground(x, y)` minus SINK (the old fixed 0.3 m sink goes). Mesh name `<prefix>_NNN` (default prefix `TREES`; the pipeline also uses `HORIZONTREES`, `ISLANDTREES`, `HOUSETREES`), material `trees`, casts shadows.

**Rotation must not depend on list order.** Derive it from the tree's position (the old version drew it from one sequence seeded 99, so adding a tree anywhere turned every later tree).

**Trunks:** an invisible box per tree, square, width = species trunk width times scale (at least 0.2 m), from SINK below ground at the trunk to 3 m above. Mesh `1WALL_TREE_NNN`, material `wall`, not renderable, no shadows. Trunk widths per species index (peppermint, she-oak, Norfolk pine, tuart, palm): 0.45, 0.3, 0.5, 0.75, 0.6 m. Move these into `TREE_SPECIES` next to the crown sizes so a new species can't be missing one; a species with no trunk width falls back to 0.4.

**Edge cases:** variant out of range falls back to species 0; zero spots gives no meshes; very many spots split across meshes.

## 4. Guard rails

### Where (`railNeeds`)

**Inputs:** road plan samples (position, unit left vector, width, distance along), options (verge width, spacing), `ground`, OSM guard-rail lines (local), segment index.

**Rules:**
- Per sample and side: the road edge height (`ground` at the edge of the asphalt) against the lowest of `ground` at 3 m and 7 m beyond the verge. A drop of more than 1.8 m needs a rail.
- Each OSM rail point within 12 m of the route marks the nearest segment, on the side it lies, plus 3 samples either way.
- Per side, fill gaps up to 10 m between needed samples, then drop runs shorter than 24 m (both in samples via spacing).
- Output: two boolean arrays [left, right], one entry per sample.

The pipeline then clears needs at roundabouts, side-street mouths and kerbed edges, and may hand them to `armco.ts` instead (country preset).

### Building (`buildGuardRails`)

- Per side, each run of needed samples becomes one rail mesh: a ribbon from 0.45 m to 0.8 m above the ground, at 55% of the verge width out from the asphalt edge. Two faces (toward the road, away from it) with their own normals; winding so each face is front-facing from its side. u = distance along / 4 (texture repeats every 4 m), v 1 at the bottom.
- The rail's height follows `ground` at the rail line (the old code used the road edge formula minus a slope; replaced).
- A post every 4 m (at least every sample): a 0.1 m square box set 8 cm behind the rail, from SINK below the ground at the post to just under the rail top.
- Names: `1WALL_RAIL_L_NNN` / `1WALL_RAIL_R_NNN` (collidable, material `rail`, casts shadows), runs numbered in order; posts `RAILPOSTS_NNN`, material `steel`. Runs of a single sample make no rail.
- **Closed circuits:** the old code treats the sample list as open, so a run across the start/finish of a loop is two runs. Fine to keep; nice to fix (join the wrap-around run).

## 5. Guide posts

- Every 50 m each side (index step = 50 / spacing), starting and ending 30 m in from the ends.
- Skip a side if any of the 5 samples either way needs a rail (the pipeline's mask also covers rings, mouths and kerbs).
- Position: 75% of the verge width out from the asphalt edge. Base SINK below the ground there, top 1.0 m above it.
- A thin box, 5 cm along the road and 10 cm across, flat face to traffic. AS 1742.2: a red reflector faces traffic with the post on its left, a white one faces traffic with it on its right. Traffic keeps left, so on the left side (side index 0) the face looking back down the road (toward oncoming forward traffic) gets red and the face looking forward gets white; mirrored on the right. The two long sides show the plain part of the texture.
- Texture (from `textures.ts`, `postTexture`): three thirds across: red reflector, white reflector, plain. U ranges used: red 0.02 to 0.31, white 0.35 to 0.64, plain 0.70 to 0.98.
- Mesh `GUIDEPOSTS_NNN`, material `guidepost`. `cull.ts` gives `GUIDEPOSTS` and `RAILPOSTS` a 500 m draw distance by name, so keep those prefixes.

## Call sites

- `src/core/track.ts`: `treeSpotsFromImagery` (photo chunks and backdrop chunks), `filterTrees` (twice: before and after landscape zones change species), `buildTrees` (route trees unless `cspTrees`, horizon trees, island shrubs, house trees), `treeTrunks` (route and house trees), `railNeeds`, `buildGuardRails` (when not Armco), `buildGuidePosts`, `rng`.
- `src/core/landmarkLayer.ts`: `buildTrees`. `src/core/specHouse.ts`: `TreeSpot` type.
- `box` / `ChunkedMesh` / `rng`: furniture, utilities, buildings, buildingStyles, lots, frontage, paths, markings, kerbside, sideStreets, coast, jetty, jettyTrain, parkedCars, armco, farmRoadsides, raceDress.
- Tests now: `test/scenery.test.ts`.

## Test list (write fresh)

1. `rng`: same seed gives the same sequence; values in [0, 1); different seeds differ.
2. Chunked mesh: starts a new builder before passing the vertex limit; `all()` drops empty builders; normals enabled on every builder.
3. Box: 20 vertices, 10 triangles; all side normals point away from the centre; top normal up; per-side UV override lands on the right faces (side 1 forward, side 3 back).
4. Photo trees: a synthetic chunk with a green textured patch gives trees inside it and none on flat grey or flat lawn green; a strip of grey-olive one cell wide gives none, the same colour in a 5x5 block gives some; a teal sea block gives no trees; trees beside a large water block are coastal, beside a pool-sized one not.
5. Photo trees are identical when the same chunk is run twice, and when two chunks are processed in either order.
6. Filter: a tree on the road or verge is dropped; one with room for 60% of its crown is kept at full scale; one with room for half is shrunk to fit; one with less is dropped; beyond the corridor dropped unless the area cover says inside; the cap thins evenly and keeps the same trees regardless of input order.
7. Tree mesh: 24 vertices per tree; base at `ground` minus SINK for a sloping ground function; species u range used; tree rotation unchanged when another tree is added to the list.
8. Trunks: one box per tree, named `1WALL_TREE_`, not renderable; base SINK under `ground`.
9. Rail needs: a 2 m drop beside a straight road for 40 m needs a rail; a 1.5 m drop doesn't; a 20 m run is dropped; two runs 8 m apart join; an OSM rail line marks its side.
10. Rails: one mesh per run per side, collidable name; posts every 4 m standing on `ground` minus SINK; rail top 0.8 m above ground at the rail line.
11. Guide posts: every 50 m both sides; none within 5 samples of a rail; reflector faces: on the left side, the face toward oncoming forward traffic uses the red u range.
12. Height contract: run every builder with a ground function that's a tilted plane plus a bump, and check every object base is within SINK + 1 mm under the function at its own (x, y).

## Could be deleted instead of rewritten (for Mac)

- **Generic W-beam rails (`buildGuardRails`).** The country preset uses Armco (`armco.ts`, the fork's own) for everything; W-beam is only reached by routes with `armco: false` (boranup-drive, collie-motorplex) and town routes, where kerbed edges remove the need anyway. Every Busselton town build reports 0 m of rail. Option: make Armco the only rail builder and delete this one. `railNeeds` is still used (Armco starts from it), so keep or rewrite that part.
- **`TRUNK` table as a separate list**: fold into `TREE_SPECIES` (above).

## Additions from the call sites (rewrite session, 31 Oct 2026)

Found while writing the new module from the call sites, the tree modules and the commit messages (the old file stayed closed). They override anything above that disagrees.

### Signatures the callers rely on

- `treeSpotsFromImagery(rgba, size, chunk, density)`: `chunk` is the terrain chunk's local bounds (`minX..maxX`, `minY..maxY`); pixel row 0 is the chunk's north edge (`maxY`).
- `filterTrees(spots, index, opts, maxTrees, cover?)`: `cover(x, y)` is the build's coverage distance (`makeCover`): a spot beyond the corridor is kept when `cover(x, y) <= corridor - 3`. Uses `opts.corridor`, `opts.vergeWidth`; road width from `index.at(nearest).width`.
- `buildTrees(spots, ground, prefix = "TREES", sink = SINK)`: the fourth argument is how far the base goes in. The horizon trees pass 0.3 m with their own ground (the far mesh minus 0.6 m); everyone else takes the default.
- `treeTrunks(spots, ground)`.
- `railNeeds(plan, opts, ground, osmRails, index)`: track.ts passes the analytic terrain here, not the scene ground (the rails' need is about the land falling away, decided before Armco takes over). The module doesn't care which.
- `buildGuardRails(plan, opts, needs, ground)` returns `{ rails, posts }` (the same shape as `armco.ts` `buildArmco`): track.ts clears the collidable rails off the route (`keepOffRoute(rails.rails, ...)`) and adds the posts as they are. `buildGuidePosts(plan, opts, mask, ground)` returns a list. `ground` is the scene ground (a plain `(x, y) => metres` is enough). Zero needs give empty lists.
- The other builders return `Kn5MeshNode[]`; callers map over them (e.g. `castShadows: false` on the horizon trees).
- `rng` stays importable from `scenery.ts` even when it moves to a shared module (re-export), and so do `box` and `ChunkedMesh`, so no caller has to change.

### Species and models (trees from the zones and CSP work)

- `TreeSpot` is `{ x, y, scale, variant, model?, coastal? }`. `variant` is normally a card index into `TREE_SPECIES` (0 peppermint, 1 she-oak, 2 Norfolk pine, 3 tuart, 4 palm). `model` (optional) is a CSP tree model index into `treeModels.ts` `MODEL_NAMES` (`peppermint, sheoak, norfolk, tuart, palm, karri, marri`); the first five are in the same order as the cards.
- **With landscape zones and CSP trees both on, `variant` can be a model index of 5 (karri) or 6 (marri)**: `ZoneMap.tree` picks from `MODEL_NAMES` and writes the pick into `variant`. Those models have no card. For crown size (filtering) and trunk width they use the card that stands in for them, the tuart's (`treeZones.ts` `CARD_FOR`: karri, marri and jarrah use 3). So the size lookup is: a card index uses that card; a model index past the cards uses the tuart card; anything else (negative, past the models) falls back to card 0. Sprite meshes are only built for these trees when CSP trees are off, in which case `variant` is always a card, but the same lookup applies.
- Export the per-variant lookups (crown radius, trunk width, card) so other modules use the same numbers; `CROWN_RADIUS` (per card, from `TREE_SPECIES`) stays exported.

### Mesh helpers

- `new ChunkedMesh(perItem)`: `perItem` is the vertex count `next()` assumes when called with no argument (armco 40, parked cars 24, jetty sleepers 20, jetty rails 16 although each rail piece is a 20-vertex box). `next(verts = perItem)` returns the builder to draw into. Keep a small safety margin under `MAX_MESH_VERTICES` so a caller that underestimates by a few vertices (the jetty rails) can't overflow a mesh.
- `box(mb, ...)` writes explicit normals into `mb.normals`. Callers either hand it a builder from `ChunkedMesh` (normals on) or one they set `normals = []` on; raceDress clears `normals` to `null` before writing so face normals are used. If `box` gets a fresh builder with `normals === null` and no vertices, it turns explicit normals on; with vertices already in it and no normals, it adds none (face normals then apply).
- Side UV override: an optional array of up to four `[u0, u1]` pairs, one per side (side order as above); a missing entry uses 0 to 1.

### Determinism (the rules this rewrite adds, gathered)

- Random choices that belong to a place are seeded by its position (rounded to 10 cm) plus a salt, never by where it falls in a list: photo cells (seed from the cell centre's world position), tree rotation (from the tree's position), the cap's thinning (sorted by position first).
- `rng(seed)` is a new generator, so every caller's sequences change (house styles, frontage, lots, paths, race dress, farm roadsides, species picks in track.ts). The first build after this rewrite differs from the accepted base; accept a new base deliberately.
- Callers that still draw from one sequence in list order (track.ts `speciesRand`, `zoneRand`, the CSP tree angles `rng(7)`) aren't this module's to fix; moving them to the position hash is a follow-up for track.ts.

### Kn5 node flags

- Trees: `castShadows: true`. Trunks: `renderable: false`, `castShadows: false`, material `wall`. Rails: `castShadows: true`, material `rail`. Rail posts: material `steel`. Guide posts: material `guidepost`.
- Names use three-digit numbering (`roadMesh.ts` `pad`): `TREES_000`, `1WALL_TREE_000`, `1WALL_RAIL_L_000`, `RAILPOSTS_000`, `GUIDEPOSTS_000`. `groundCheck.ts` skips `1WALL_RAIL` and `1WALL_TREE`; `cull.ts` matches `GUIDEPOSTS` and `RAILPOSTS`; `poleCheck.ts` reads the `GUIDEPOSTS` group.
