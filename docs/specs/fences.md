# Spec: fences, garden walls, hedges and wire fences (`src/core/fences.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"; the file is listed in `UPSTREAM-FILES.txt`, with the wire fences and `box` / `ribbon` added by the fork). Write the new module from this page without the old file open. Tests are written fresh from "Tests to write".

## What the module is for

Builds property-line barriers where OpenStreetMap maps them (`barrier=fence|wall|hedge|retaining_wall`). In an Australian suburb that's mostly Colorbond panels and timber palings down the sides and backs of lots, and low brick walls and hedges along the front. They follow the ground, stand slightly sunk into it so no gap shows, and are solid (physics walls). Nothing is ever built within reach of the route's asphalt, verge or nature strip, or across a side street: a mapping error must never put a wall on the racing line.

It also builds post-and-wire farm fences (paddock boundaries and OSM wire fences) when farmland is on, and exports the post and wire primitives the vineyard rows reuse.

All geometry is built in ENU (x east, y north, z up) with `MeshBuilder` (docs/specs/mesh.md) and returned as `Kn5MeshNode`s.

## Public API (keep these names and shapes)

```
interface Barrier {
  pts: Vec2[];                                   // ENU metres
  kind: "fence" | "wall" | "hedge" | "retaining_wall";
  fenceType?: string;                            // OSM fence_type
  material?: string;                             // OSM material
  height?: number;                               // OSM height, metres
}
barrierStyle(b: Barrier): { look: Look; height: number; thick: number }
isWireFence(b: Barrier): boolean
buildBarriers(barriers, index: SegmentIndex, opts: BuildOptions, ground: HeightFn,
              clear: (x, y) => boolean, cover?: (x, y) => number): Kn5MeshNode[]
WIRE_FENCE = { postGap: 4, postHeight: 1.25, post: 0.1, wires: [0.4, 0.75, 1.1], wire: 0.025 }
buildWireFences(lines: Vec2[][], index, opts, ground, clear, cover?, reach = 40, maxTriangles = 80000): Kn5MeshNode[]
box(mb: MeshBuilder, at: Vec2, size: number, z0: number, z1: number, ground: HeightFn): void
ribbon(mb: MeshBuilder, p: Vec2, q: Vec2, zp: number, zq: number, h: number): void
```

`Look` is the element type of `BARRIERS` from the textures module: `"colorbond" | "paling" | "brickwall" | "hedge"` (docs/specs/textures.md, "Barriers").

Dependencies: `SegmentIndex` from `road.ts` (`nearest(x, y, maxDist)` returns the nearest route point within `maxDist` or `null`, with `.dist`; `at(nearest)` gives `.width`, the full asphalt width there); `BuildOptions` fields `vergeWidth`, `corridor`, `farmland`; `HeightFn` `(x, y) => z`; `pad` (3-digit zero pad) from `roadMesh.ts`; `SINK` (0.02 m) from `sceneGround.ts`.

### Call sites (from `grep`, 31 Oct 2026)

- `buildBarriers`: `src/core/track.ts`, with the OSM barriers projected to ENU; `clear` = more than 1.5 m from any side street (`streetIndex.clearance`) and not inside a roundabout grown by `vergeWidth + 3`; `cover` = the area build's distance-to-nearest-drivable-street function when `build.area` is set, else omitted. The result goes in the `FENCES` group (after `keepOffRoute`).
- `buildWireFences`, `isWireFence`, `box`, `ribbon`, `Barrier`: `src/core/farm.ts` (`buildFarmland` passes OSM wire fences plus paddock boundaries; vine rows use `box` for posts and `ribbon` for the trellis wire).
- Tests: `test/fences.test.ts` (`barrierStyle`, `buildBarriers`), `test/farm.test.ts` (`buildBarriers`, `buildWireFences`, `isWireFence`, `WIRE_FENCE`).
- Data: `src/services/osm.ts` fills `barrier`, `fence_type`, `material` and a numeric `height` (only when it parses as a finite number); the Overpass query asks for the four barrier values within 45 m of the route (and inside build areas).
- Materials and CSP: `track.ts` makes a material `barrier_<look>` for every look (`nmMaterial` with a normal map when `detailShaders` is on, else `material`), plus `timber` and `wire`. `cspConfig.ts` treats `barrier_colorbond` and `barrier_paling` as thin two-sided, `barrier_hedge` as rough and tree-baked, and `barrier_?` as occluding. So the material names below must not change.

## Rules

### Style (`barrierStyle`)

1. A tagged height is used only when it's more than 0.3 and less than 4 (both exclusive; 0 or missing means untagged).
2. `hedge`: look `hedge`, height tagged or 1.5, thickness 0.8.
3. `wall` and `retaining_wall`: look `brickwall`, height tagged or 1.2 (retaining wall 0.8), thickness 0.23.
4. `fence`: if `"<fenceType> <material>"` contains `wood`, `paling`, `timber` or `picket`: look `paling`; otherwise `colorbond`. Height tagged or 1.8, thickness 0.05.

### Wire or solid (`isWireFence`)

5. True only for `kind === "fence"` whose `"<fenceType> <material>"` contains `wire`, `barbed`, `electric`, `ranch`, `split_rail` or `post_and_rail`.

### Solid barriers (`buildBarriers`)

6. Skip a barrier when `opts.farmland` is on and it's a wire fence (the farm fences build it).
7. Walk each barrier's polyline segment by segment. Skip segments shorter than 0.2 m. Split each into `max(1, ceil(len / 2))` equal steps (follow the ground every 2 m or less).
8. A step from `p` to `q` (midpoint `m`) is built only if all three points pass all three tests:
   - `clear(x, y)`;
   - **off route**: `index.nearest(x, y, 30)` is null, or its distance is more than `width / 2 + opts.vergeWidth + 2.5` (asphalt, verge or nature strip, and a margin);
   - **near**: with `cover`, `cover(x, y) <= opts.corridor - 2`; without, `index.nearest(x, y, opts.corridor - 2)` is not null.
9. Each built step is one **slab** (rule 11) in the mesh list for its look.
10. Meshes per look: start a new `MeshBuilder` when the current one plus the next slab would pass 60000 vertices (well under the kn5 limit of 65535). Output, looks in the order they were first built, then builders in order, skipping empty ones: name `1WALL_FENCE_<LOOK in upper case>_<index, 3 digits>` (index counts per look from 000), material `barrier_<look>`. No extras: they cast shadows, are visible and renderable, and the `1WALL_` prefix makes them solid walls in AC.

### Slab geometry

11. For a step `p -> q` with thickness `t` and height `h`: offset `o` = the unit right-hand normal of `p -> q` (`(dy, -dx) / len`) times `t / 2`. Ground heights `zp = ground(p)`, `zq = ground(q)`. Bottom at ground minus `SINK`, top at ground plus `h`, at each end separately (the slab follows the slope).
12. Texture: one tile is 2 m by 2 m with the bottom at the ground. u runs in metres along the *OSM segment* divided by 2 (so it restarts at each OSM vertex): `u0 = f0 * segLen / 2`, `u1 = f1 * segLen / 2` for the step's fractions `f0, f1` of the segment. v is 1.1 at the sunk bottom and `1 - h / 2` at the top.
13. Faces, each its own four vertices, each a quad wound counter-clockwise seen from outside:
    - right face (outward to the right of `p -> q`): corners `p+o` bottom, `q+o` bottom, `q+o` top, `p+o` top; UVs `(u0, 1.1)`, `(u1, 1.1)`, `(u1, vTop)`, `(u0, vTop)`;
    - left face: `q-o` bottom, `p-o` bottom, `p-o` top, `q-o` top; UVs `(u1, 1.1)`, `(u0, 1.1)`, `(u0, vTop)`, `(u1, vTop)`;
    - top, only when `t > 0.1` (walls and hedges, not panel fences): `p+o` top, `q+o` top, `q-o` top, `p-o` top; UVs `(u0, 0)`, `(u1, 0)`, `(u1, 0.05)`, `(u0, 0.05)`.
    No end caps, no bottom. Normals computed from the faces (flat per face, since faces don't share vertices).

### Wire fences (`buildWireFences`)

14. Distance to the road `dist(x, y)`: `cover(x, y)` when given, else the nearest route distance within `opts.corridor + 10` (infinite if none). Off route as rule 8. Limit `min(reach, opts.corridor - 2)`.
15. Walk each line segment by segment; skip segments shorter than 0.5 m; split into `max(1, round(len / 4))` equal spans (round, not ceil: spans come out 4 m, give or take).
16. A span `p -> q` (midpoint `m`) is a candidate if `p`, `q` and `m` are all clear, off route, and within the limit.
17. **Duplicates** (two paddocks sharing a boundary, or the same line mapped both ways): keep a hash of accepted span midpoints on a 2 m grid; a candidate whose midpoint is within 1.2 m of an accepted midpoint in its own or the eight neighbouring cells is dropped. Candidates are tested in input order (lines, then segments, then spans), so the first one wins.
18. Each kept candidate records its road distance `d = dist(m)`. Sort by `d` ascending (stable), keep the first `floor(maxTriangles / perSpan)` with `perSpan = 8 + 4 * wires.length` (20): nearest the road first.
19. Posts: a post at every kept span's `p`; also one at `q` when no kept span starts at `q` (positions compared rounded to 0.1 m, `toFixed(1)` on x and y). A post is `box(mb, at, 0.1, -SINK, 1.25, ground)`.
20. Wires: for each kept span and each wire height `w` in `[0.4, 0.75, 1.1]`, `ribbon(mb, p, q, ground(p) + w, ground(q) + w, 0.025)`: straight from post to post, no sag.
21. Separate builder lists for posts (16 vertices per post) and wires (8 per strand), each splitting at 60000 vertices like rule 10. Output posts first, then wires, skipping empty builders: `1WALL_FENCE_WIREPOST_<3 digits>` with material `timber`, then `1WALL_FENCE_WIRE_<3 digits>` with material `wire`. Note `1WALL_FENCE_WIRE_` (with the underscore) must not prefix-match the post names; tests rely on it.

### Primitives

22. `box(mb, at, size, z0, z1, ground)`: a square post `size` wide, centred on `at`, from `ground(at) + z0` to `ground(at) + z1` (one ground height for the whole post). Corners in counter-clockwise order from above, starting south-west: `(-s, -s)`, `(+s, -s)`, `(+s, +s)`, `(-s, +s)` with `s = size / 2`. Four sides, no top or bottom: for each corner `a` and the next `b`, four new vertices `a` low `(0, 1)`, `b` low `(1, 1)`, `b` high `(1, 0)`, `a` high `(0, 0)` and `quad` in that order (faces outward). 16 vertices, 8 triangles.
23. `ribbon(mb, p, q, zp, zq, h)`: a vertical strip `h` tall centred on `zp` at `p` and `zq` at `q`, seen from both sides. Two faces, each its own four vertices (so computed normals don't cancel): `p` at `zp - h/2` `(0, 1)`, `q` at `zq - h/2` `(1, 1)`, `q` at `zq + h/2` `(1, 0)`, `p` at `zp + h/2` `(0, 0)`; the front face as `quad(0, 1, 2, 3)`, the back face (second set) as `quad(3, 2, 1, 0)`. 8 vertices, 4 triangles.

## Bugs and rough edges (fix, don't copy)

- **Duplicate end posts.** Rule 19 can put two posts at the same `q` when two kept spans end there and none starts there (two runs meeting head on). Dedupe all posts by their 0.1 m key instead. No test changes (the existing tests have no such meeting).
- **Triangle budget ignores end posts.** `perSpan` counts one post per span; the extra `q` posts can push the total over `maxTriangles`. Either count them or document that the budget is approximate. (Changing the kept count changes output; prefer documenting.)
- **Splitting asks for 24 vertices per slab** though a slab adds 8 or 12. Harmless (splits a little early). Use the true count, or keep 24 if goldens must match byte for byte; note the choice.
- **Case-sensitive tag matching** in rules 4 and 5. OSM values are lowercase by convention, so making both matches case-insensitive changes nothing for current data and catches `Wood` or `Timber`.
- **Wire-fence margin** is 2.5 m here but 3 m for vine rows in `farm.ts`. Not a bug; keep, and say so.
- **`lerp` duplicated** in `farm.ts`; a shared 2D helper (geo) would do.

## Possible improvements (not for the parity rewrite; Mac decides)

- End caps on walls and hedges (0.23 m and 0.8 m thick): the open ends show when you look along a hedge. Adds two quads per run end; changes goldens.
- Join slabs at the OSM vertices instead of leaving thin wedges where a fence turns.

## Edge cases

- Barrier with fewer than two points, or all segments under 0.2 m: nothing.
- A fence entirely failing the tests: no builder for that look, so no node (no empty meshes).
- Tagged heights of exactly 0.3 or 4: untagged (defaults).
- Wire fence lines that run exactly over each other in opposite directions: built once (rule 17).
- Very long runs: split into several meshes at 60000 vertices with consecutive indices.

## Tests to write

1. `barrierStyle` table: plain fence colorbond 1.8 / 0.05; `fenceType: "wood"` (and `material: "timber"`, `"picket"`) paling; wall brickwall 1.2 / 0.23; retaining wall 0.8; hedge 1.5 / 0.8; a tagged 2.2 m hedge 2.2; tagged 0.3 and 4 ignored.
2. `isWireFence`: barbed_wire, electric, post_and_rail true; untagged fence false; a wall tagged `wire` false.
3. A fence along a back boundary on sloping ground: one node named `1WALL_FENCE_COLORBOND_000`, material `barrier_colorbond`; the top is 1.8 m above the ground at each end; the bottom is `SINK` below it.
4. Never near the road: a wall mapped on the road edge and a fence crossing a side street (`clear` false there): no vertex closer to the centreline than `width/2 + vergeWidth + 2.5` (minus a small tolerance for the slab thickness), none inside the side street, and something is built.
5. Corridor: a fence beyond `corridor - 2` builds nothing, with and without `cover`.
6. Top face only for thick barriers: a hedge slab has 12 vertices and 6 triangles, a Colorbond slab 8 and 4.
7. Winding: computed normals of the right face point to the right of `p -> q`, the left face's to the left, the top's up.
8. UVs: u restarts at each OSM vertex and covers `segLen / 2` along a segment; v is 1.1 at the bottom and `1 - h/2` at the top.
9. Farmland on: an OSM wire fence is skipped by `buildBarriers`; off: built as a solid fence.
10. Wire fences along a 180 m boundary beside the road: one post node, one wire node; 45 spans give 46 posts (46 x 8 triangles); post top `ground + 1.25`; six distinct wire heights at a post (three strands, two edges each).
11. Wire fences never on the road, never beyond reach, and a boundary mapped both ways built once (an 80 m shared boundary gives 21 posts).
12. Budget: with a small `maxTriangles`, the kept spans are the ones nearest the road.
13. `box`: 16 vertices, 8 triangles, outward normals, height from `ground(at) + z0` to `+ z1`.
14. `ribbon`: 8 vertices, 4 triangles; the two faces' normals are opposite.
15. Splitting: enough slabs to pass 60000 vertices give `_000` and `_001` meshes of the same look, each under the limit.

### Golden fixtures

Before deleting the old module, capture JSON (names, materials, float32 positions, uvs, indices, and the computed normals from `toKn5`) for: `buildBarriers` on the `test/fences.test.ts` street with one barrier of each look on sloping ground, `buildWireFences` on the `test/farm.test.ts` inputs, and one `box` and one `ribbon`, in `test/fixtures/fences/`. The new module must match byte for byte, except where a fix above deliberately changes output (list those in the test). The lead's full-build comparison of the accepted Busselton base is the final check: the `FENCES` group should be unchanged.

## Rewrite notes (31 Oct 2026)

Rewritten from this page. Matches the goldens (`test/fixtures/golden-mesh/fences.json`, checked by `test/golden.test.ts`) byte for byte, with these choices:

- **Splitting on the true vertex count** (8 or 12 per slab, 16 per post, 8 per strand): applied. A safety fix; it only changes output where a look's run passes about 60000 vertices (the split comes later, so the first mesh holds more slabs). No golden is that big.
- **Case-insensitive tag matching:** applied. OSM values are lowercase, so current data builds the same.
- **Triangle budget:** documented as approximate (end posts not counted); unchanged.
- **Later, with a base upgrade** (change output, not applied): dedupe end posts by their 0.1 m key (two runs meeting head on get two posts at the same spot today).
