# Spec: house lots (fences, front walls and hedges, garden beds, shrubs)

Replaces `src/core/lots.ts` (listed in `UPSTREAM-FILES.txt`). Heights follow the height contract in [scenery.md](scenery.md#the-height-contract-applies-to-every-placement-spec-in-this-group): one `ground(x, y)` passed in, `SINK` (2 cm, from `src/core/sceneGround.ts`) at every foot. The houses it works from come from [buildings.md](buildings.md) (the `Building` record) and, for most of a suburb, from [frontage.md](frontage.md).

## What it does

Dresses each house's lot the way a WA suburban block looks from the street:

1. A Colorbond fence down the start-side boundary and across the back, and down the end side when there's no house next door.
2. Along the front boundary: nothing (common), a low limestone wall, a low brick wall, or a hedge, with a gap for the driveway.
3. A mulch garden bed with shrubs along the front of the house, leaving the driveway and a path to the front door.

Exports two geometry helpers and a shrub builder, used by tests (the car park island shrubs that also used `shrub` were deleted on 31 Oct).

Coordinates are local metres, x east, y north, z up; mesh builders convert to AC axes when written (`MeshBuilder.toKn5`). Tests read AC positions: x, height, minus north.

## Exported API and callers

- `buildLots(houses: Building[], ground: HeightFn, opts: LotOptions): Kn5MeshNode[]`
  - `LotOptions`: `{ roadGap(x, y): number; seed?: number }`. `roadGap` is the distance from a point to the nearest road or street edge in metres, `Infinity` if none near. `seed` defaults to 21 in the old module; with position seeds (see Determinism) it is accepted and ignored.
  - `src/core/track.ts`: `buildLots(homes in cover, buildingGround, { roadGap })`, only when `opts.buildings`. `homes` are buildings with exactly 4 corners, not a flat roof, wall height at most 7.5 m. Before the call, track.ts gives every home without a `front` the ring edge whose midpoint has the smallest `roadGap` under 25 m, and sets `setback` to that gap. `frontKind` and `hedgeHeight` come from house looks. `roadGap` there is min(distance to the route minus half its width, side-street clearance). The result goes in the kn5 group `LOTS`, which the ground check (`groundCheck.ts`, `PLACED_GROUPS`) judges.
  - Tests: `test/houses.test.ts`, `test/padClear.test.ts` (lot fences and front walls on uneven ground, through `checkGround`).
- `frontWall(b: Building): { ring: Vec2[]; k: number }`: the ring made counter-clockwise (reversed if its signed area is negative, otherwise the same array), and the index k of the front wall edge in it (edge k runs from `ring[k]` to `ring[(k+1) % n]`), or -1 if `b.front` is missing or matches no edge. Used by `test/houses.test.ts` (and internally). `buildings.ts` has its own private front-wall finder; see bug 2.
- `footAlong(a: Vec2, b: Vec2, ground: HeightFn, tol = 0.01): { pts: Vec2[]; foot: number[] }`: see rule 9. Used by `test/lotsFoot.test.ts`.
- `stepsAlong(a: Vec2, b: Vec2, step = 0.5): Vec2[]`: see rule 9. Exported, used only by `footAlong` today.
- `shrub(mb: MeshBuilder, c: Vec2, size: number, species: 0 | 1, rot: number, ground: HeightFn): void`: see rule 12. Used inside the module and by `test/lots.test.ts`.

Dependencies: `pointInRing`, `ringArea` (buildings), `ChunkedMesh` (mesh accumulator, `meshKit.ts`, re-exported from scenery), `pad` (3-digit zero padding), `SINK`, and from `houseTextures.ts`: `FENCE_COLOURS` (woodland, basalt, paperbark, in that order), `FENCE_PANEL` = 2.4 m, `FENCE_HEIGHT` = 1.8 m, `FRONT_WALL_REPEAT` = 2 m, `SHRUB_SPECIES` (two entries, each a u range in the shrub atlas: westringia 0 to 0.5, flowering 0.5 to 1).

## Constants

| Name | Value | Meaning |
| --- | --- | --- |
| SIDE | 1.2 m | the lot runs this far past the house at each end |
| VERGE | 4.5 m | front boundary this far back from the road edge (verge and footpath) |
| YARD | 8 m | back yard depth behind the house |
| GROUND_STEP | 0.5 m | fence and wall bottoms sampled this often |
| DRIVE | 0 to 3.8 m along the front wall | the driveway in front of a garage (buildings.ts puts the 2.6 m garage door at 0.6 to 3.2 m and the driveway 0.2 m wider each side) |
| free-ground margin | 1.5 m | nothing of the lot within this of a road edge |
| max front gap | 30 m | houses whose front-wall midpoint is further than this from a road get no lot |

## Rules

### Which houses get a lot

1. For each house in input order: find the front wall with `frontWall`. Skip the house if there's none, the ring doesn't have exactly 4 corners, or the front wall is shorter than 5 m.
2. Lot frame. P and Q are the front wall's ends in counter-clockwise order, `len` its length, t the unit vector P to Q, o = (t.y, -t.x) the outward normal (toward the street; for a CCW ring that is the right side of P to Q). R is the corner after Q; `depth` is |(R - Q) · o|. A lot point is `at(s, f) = P + t s + o f`: s along the front wall from P, f out toward the street (negative behind the building line).
3. `gap` = `roadGap` at the front wall's midpoint `at(len/2, 0)`. Skip the house if `gap` is not finite or over 30 m.

### Free ground

4. A point is free for this house when `roadGap` there is over 1.5 m, it is not inside any *other* house's ring, and it is not inside this house's own ring.
5. "Inside another house" uses a spatial grid of the input houses (25 m cells). The grid must find every house whose ring covers the point; see bug 5.

### Fences

6. The fence colour is one of `FENCE_COLOURS`, chosen uniformly per house. `back` = -(depth + YARD).
   - Start side: from `at(-SIDE, -1)` to `at(-SIDE, back)` (starts 1 m behind the building line).
   - Back: from `at(-SIDE, back)` to `at(len + SIDE, back)`.
   - End side, only when no other house is found next door: probe `at(len + d, -depth/2)` for d = 2, 4, 6, 8; if none is inside another house, fence from `at(len + SIDE, back)` to `at(len + SIDE, -1)`.
   - The start side is fenced even when a neighbour is there; free-ground tests per panel keep it out of the neighbour's house.
7. A fence line from a to b is split into n = max(1, round(length / 2.4)) equal panels. A panel is built only if its two ends and its midpoint are all free (rule 4); otherwise that panel is left out and the rest still build.
8. Each panel, p to q:
   - Bottom: `footAlong(p, q, ground)` gives the bottom points and their heights (ground minus SINK, simplified).
   - Top: level, at max(lowest foot + 1.8, highest foot + 0.5). On flat ground that is 1.8 m above the foot; over a bank or a drain the panel never goes under 0.5 m above its highest foot.
   - Two faces (one each side), each a strip of quads between the bottom points and the same points at the top height. Normals horizontal, perpendicular to p to q, pointing out of that face's side. Each face's triangles face the way its normal points (see Winding).
   - UVs: u = distance from p over the panel length (0 to 1 across the panel: one texture panel per fence panel); v = 0 at the top, and at the bottom (top - foot) / (top - lowest foot), so v = 1 at the lowest foot and less where the ground is higher (the texture is cropped at the bottom, never stretched).
   - Vertex budget per panel: 4 per bottom point (2 per point per face).

### Front boundary

9. **Ground-following bottoms** (`stepsAlong`, `footAlong`; the newest behaviour):
   - `stepsAlong(a, b, step)`: n = max(1, ceil(|ab| / step)); returns n + 1 evenly spaced points from a to b, both ends included, computed as a + (b - a) k / n (so the last point is exactly b, and a zero-length segment gives [a, a]).
   - `footAlong(a, b, ground, tol)`: sample `stepsAlong(a, b, 0.5)`; each sample's foot is `ground(x, y) - SINK`. Keep the first and last samples; then recursively, between two kept samples, find the sample with the largest vertical distance from the straight line between them (linear in sample index); if that distance is over `tol` (1 cm), keep it and repeat on both halves (a one-dimensional Douglas-Peucker on height). Return the kept points in order and their feet. Flat or evenly sloping ground gives just the two ends (a 2.4 m panel is one quad per face); a bump keeps the points it needs, so the bottom is within 1 cm of every half-metre sample.
   - Why: a level bottom at the panel's lowest ground went 10 to 50 cm into a bank or the side of a drain under the rest of it, which the ground check failed.
10. Front kind and placement:
    - `wallAt` = gap - VERGE: the front boundary line, f = wallAt.
    - The pick per house: none with probability 0.35, limestone 0.25, brick 0.15, hedge 0.25.
    - The kind used: none if wallAt < 1.5 m (no room in front of the house, whatever the look says); otherwise `b.frontKind` if set (including `"none"`), else the pick.
    - Driveway gap along the front wall: with a garage, DRIVE (0 to 3.8 m); without one, 0 to 3.2 m or len - 3.2 to len with equal probability.
    - Dimensions: limestone 0.9 m high, 0.35 m thick; brick 0.8 m high, 0.25 m thick; hedge `hedgeHeight` high (default 1.0 m) and thick max(0.8, 0.6 x hedgeHeight) when a hedge height is set, else 0.8 m.
    - Two runs: s from -SIDE to the driveway's start, and from the driveway's end to len + SIDE. Each run is cut into pieces starting every 2 m (`FRONT_WALL_REPEAT`) from its start while the start is more than 0.3 m before the run's end; each piece ends at min(run end, start + 2). A piece goes from `at(s, wallAt)` to `at(e, wallAt)` and is built only if both its ends are free. A run whose start is after its end builds nothing.
11. A wall or hedge piece from a to c, thickness d, height h (`wallBox`):
    - Footprint: a rectangle d wide centred on a to c; corners a + n, c + n, c - n, a - n with n = the right-hand normal of a to c times d/2 (counter-clockwise seen from above).
    - Four vertical faces, one per footprint edge (two long faces and two ends), each with its bottom from `footAlong` along that edge and a level top. Normals horizontal, outward (each edge's right side).
    - Top height z1 = max(max(ground(a), ground(c)) + h, highest ground under any face + 0.2), where "highest ground" is the highest foot plus SINK. So the wall is h over its ends' ground and never under 20 cm over its highest ground.
    - A flat top quad over the four corners at z1, normal up, UV a single point (0.5, 0.02) on all four corners.
    - Face UVs: u = distance along the edge / 2 m; v = 0 at the top, z1 - foot at the bottom (one texture repeat per metre up).
    - Vertex budget: 2 per bottom point over all four faces, plus 4.

### Garden beds and shrubs

12. With probability 0.75 per house, beds along the front of the house:
    - Front door position (must match where buildings.ts puts the door; see bug 3): with a garage, min(len - 1.4, 4.2) along the front wall in the old module; without, len / 3.
    - Bed runs along s: from (DRIVE end, 3.8 m, with a garage; else 0) to door - 0.5, and from door + 1.35 to len. A run shorter than 1.5 m is skipped.
    - Bed depth = min(1.4, max(0, gap - 2.5)); if it is 0.6 m or less, no beds at all.
    - A bed is a single quad with corners `at(g0, 0.05)`, `at(g1, 0.05)`, `at(g1, depth)`, `at(g0, depth)`, each at that corner's `ground + 0.04` (inside the ground check's 5 cm), facing up, normal (0, 0, 1), UVs world-planar (x / 2, y / 2).
    - Shrubs in each bed: s starts at g0 + 0.7, then steps by 1.6 + 1.4 r, while s < g1 - 0.4; each at `at(s, depth/2 + 0.05)`, size 0.8 + 0.7 r, species 0 or 1 with equal probability, rotation r x pi.
    - Beds and shrubs aren't tested against free ground (they sit between the house and the front boundary, inside the lot); keep that.
13. `shrub(mb, c, size, species, rot, ground)`: two crossed upright quads, each two-sided (4 quads, 16 vertices).
    - Height H = size, width W = 1.4 size; base z = ground(c) - SINK, top z + H (both from the ground at the centre only).
    - Quad p (p = 0, 1) has angle a = rot + p pi/2; its horizontal axis is (cos a, sin a), centred on c, half width W/2; its face direction is (sin a, -cos a).
    - For side +1 and -1: normal = (face direction x side x 0.35, 1) normalised (tilted up so the sprite lights like a bush). Vertices bottom-left, bottom-right, top-right, top-left with u from the species' u0 (left) to u1 (right), v 1 at the bottom and 0 at the top; triangles face the normal's side.

### Output

14. Meshes, in this order, each list chunked by the mesh accumulator under the kn5 vertex limit, numbered with 3-digit indices from 000 per list:
    - Fences, per colour in `FENCE_COLOURS` order: `1WALL_FENCE_<colour name>_NNN` (lower-case name, e.g. `1WALL_FENCE_woodland_000`), material `fence_<colour name>`.
    - Front walls, kinds limestone, brick, hedge in that order: `1WALL_FRONT_<kind>_NNN`, material `frontwall_limestone`, `frontwall_brick`, or `hedge`.
    - Beds: `GARDENBED_NNN`, material `mulch`, `castShadows: false`.
    - Shrubs: `SHRUBS_NNN`, material `shrubs`, `castShadows: true`.
    - Empty lists produce nothing. The `1WALL` prefix makes fences, walls and hedges collidable (surface key `WALL`); beds and shrubs are visual only.
    - Material names are matched elsewhere: track.ts defines `fence_<colour>`, `frontwall_limestone`, `frontwall_brick`, `hedge`, `mulch`, `shrubs`; `cspConfig.ts` lists `fence_?`, `frontwall_?`, `hedge`, `mulch`, `shrubs`. `fences.ts` (OSM barriers) uses upper-case `1WALL_FENCE_COLORBOND_...` names, so the two never collide; keep the lower-case colour names.

### Winding

Every quad's triangles are front-facing toward the vertex normal it is given: with z up, the right-hand-rule normal of each triangle points the same way as that face's normal (for a vertical face, its outward horizontal normal; for beds and wall tops, up). The old module achieves this per face; tests should check it rather than a particular vertex order.

## Determinism

The old module draws every choice from one stream `rng(seed)` (seed 21) in house order: per house, colour; front pick; driveway side (only without a garage); bed yes/no; then per shrub step, size, species, rotation. Adding, removing or reordering one house changes every later house's fence colour, front wall and garden. Fix (bug 1): seed each house from its position.

- House seed: `placeSeed` (`src/core/random.ts`) at the front wall's midpoint `at(len/2, 0)`, then `rng(thatSeed)` for the house's draws in a fixed order, or `placeRandom(midX, midY, salt)` with one salt per draw. Suggested salts: colour `0x1070`, front pick `0x1071`, driveway side `0x1072`, beds `0x1073`; shrubs from their own spot: `placeRandom(x, y, 0x1074 + k)` at each shrub's step position for spacing, size, species and rotation (k = 0..3).
- No list index or input order in any seed. Output order still follows input order (the caller sorts buildings by place, so builds repeat from the same inputs).
- This changes every lot's look relative to the accepted base: accept a new base deliberately.

## Known bugs to fix, not copy

1. **List-order randomness** (above).
2. **Front wall matching.** The old `frontWall` needs both corners within 5 cm of `b.front`; the rewritten `buildings.ts` matches within 1 m in total and otherwise takes the edge whose middle is nearest the front's middle. A house whose `front` drifted (snapped or reversed ring) gets doors from buildings.ts but no lot here. Use the same rule as buildings.ts (ideally one shared helper both import). `frontWall`'s return shape stays the same.
3. **Front door position.** Beds leave a path at door - 0.5 to door + 1.35, with the door at min(len - 1.4, 4.2) with a garage. buildings.ts now puts it at max(3.6, min(4.2, len - 2.25)) and drops it if it would end within 0.3 m of the wall's end. Use buildings.ts's rule (shared helper), and with no door, no path gap. Without a garage both use len / 3.
4. **Shrub vertex budget.** The old module reserves 48 vertices per bed run, but a shrub is 16, and a long run holds more than three. Reserve 16 per shrub (or the run's real count), so a chunk can't pass the kn5 limit.
5. **Neighbour grid.** Houses are filed only under the 25 m cells their corners fall in; a house spanning a cell with no corner in it is missed there. File each house under every cell its bounding box covers.
6. **Two grounds.** track.ts passes `buildingGround` (scene ground on the base, horizon mesh off it), while `buildBuildings` uses `ground.forRing(ring)` per building. Lots only get houses in cover, so in practice both are the scene ground; keep taking one `ground` and leave the choice to the caller, but note it for the lead.

## Edge cases

- Ring not counter-clockwise: `frontWall` reverses a copy; the building's own ring is untouched.
- `front` missing, or matching nothing: no lot.
- Front wall exactly 5 m: gets a lot (the test is "under 5").
- `roadGap` Infinity at the front: no lot. Between 25 and 30 m: a lot (track.ts only sets `front` itself under 25 m, but frontage and looks can set it further).
- `gap` under 6 m: front kind forced to none (wallAt < 1.5); bed depth from gap - 2.5 (none at gap 3.1 m or less).
- `frontKind: "none"` from a look: no front wall even when the pick would give one.
- A fence panel crossing a neighbour's house or within 1.5 m of a road: that panel only is dropped.
- Drive at the end (no garage, second option): runs -SIDE to len - 3.2 and len to len + SIDE; the latter is 1.2 m and makes one piece.
- Flat ground: each fence panel is one quad per face; each wall face one quad.
- Ground with a 1 m deep drain under a fence or wall: every bottom vertex is at most SINK (plus float noise) under the ground, and the ground check reports nothing off.

## Tests to write

1. `frontWall`: index 0 for the test house; for the reversed ring, a k whose edge is the front (both ends at y = 0); ring returned counter-clockwise; -1 with no `front`; a front 0.4 m off still matched (bug 2).
2. `stepsAlong`: count ceil(len / step) + 1, ends exactly a and b, a zero-length segment gives two points.
3. `footAlong`: a flat or evenly sloping 2.4 m line gives exactly the two input points, foot = ground - SINK; a 20 cm bump keeps extra points and the bottom is within 1.1 cm of ground - SINK at every half-metre sample; tolerance argument respected.
4. Lots on flat ground (two 14 x 10 m houses 2.4 m apart, road edge 9 m in front): fences exist; no fence vertex inside either house; none more than 2 m in front of the building line; no front-wall vertex over either driveway (0.1 to 3.7 m along each house).
5. Fence panel count and heights: an 8 m line gives round(8 / 2.4) = 3 panels; on flat ground each is one quad per face, top 1.8 m over the foot; on a slope the top is max(lowest foot + 1.8, highest foot + 0.5).
6. Front kinds: a look's `frontKind` wins; `"none"` wins; wallAt < 1.5 forces none; hedge dimensions follow `hedgeHeight`.
7. Uneven ground (a drain 1 m deep across the back fence and the front wall): every fence and front-wall vertex is at least ground - SINK - 0.1 mm; `checkGround` on terrain plus `LOTS` reports nothing off.
8. Beds: none across the garage driveway or the door path (with buildings.ts's door rule); none when gap - 2.5 is 0.6 m or less; bed corners at ground + 0.04; shrubs inside their bed.
9. `shrub`: 16 vertices, base at ground - SINK, top at base + size, width 1.4 size, u ranges per species, normals tilted up and unit length.
10. Winding: for every fence, wall and shrub triangle, the right-hand normal agrees in direction with the vertex normals; bed and wall-top triangles face up.
11. Names and materials: the lists and their order as in rule 14; `castShadows` false on beds, true on shrubs.
12. Determinism: the same houses in a different order give the same meshes (as sets of named geometry per house position); adding a house far away doesn't change another house's colour or front kind.
13. Chunking: enough houses to pass 65,535 vertices in one fence colour give two meshes, each under the limit.

## Could be deleted instead of rewritten (for Mac)

Nothing here is unused. One open question: without a garage the front wall still leaves a 3.2 m gap at one end, though buildings.ts draws no driveway there. It reads as an open gateway; keep unless Mac thinks it looks wrong.
