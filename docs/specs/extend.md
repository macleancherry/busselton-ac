# Spec: run-up and run-off for point-to-point roads (`src/core/extend.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). `extend.ts` and `test/extend.test.ts` are on `UPSTREAM-FILES.txt`. Write the new module from this page without the old file open; tests are written fresh from the "Tests to write" list.

## What the module is for

On a point-to-point route the timed section is the road between the first and last pins. The car needs room before the start line to line up a grid and get rolling, and room after the finish to brake. This module lengthens the route at both ends along the real streets it starts and ends on: it follows a street that carries on in the same direction (round its bends, and on to the next street where one joins end to end), and goes straight ahead once no street carries on. It also reports where the original start and finish sit on the longer path.

## Does the network core replace it?

**Later, mostly.** In `docs/specs/road-network.md` the route becomes a path through the graph. The run-up and run-off then become "continue the path along the edge that carries on most nearly straight through each junction", which is a graph walk, not a polyline search, and this module's street matching is no longer needed. The straight-on tail past the end of the network still is. Until the network core builds the route (phase 2 route matching), the build needs this module; it's small, so rewrite it now from this spec, and delete it when route matching lands.

## Conventions

- Points are `Vec2`, local metres, x east, y north. Everything is 2-D.
- "Lines" are other street centrelines as polylines (from the vector-tile streets), in the same frame, in no particular direction. The route's own street is usually one of them.
- Functions never mutate their inputs.

## Public API (keep these names and shapes)

- `interface Extension { path: Vec2[]; startAt: number; finishAt: number }`: the extended path, and the arc lengths along it (metres) of the original first and last points.
- `pathLength(path: Vec2[]): number`: sum of segment lengths (0 for fewer than two points).
- `carryOn(path: Vec2[], lines: Vec2[][], want: number): Vec2[]`: the points that continue `path` beyond its last point for `want` metres. Does not include the path's last point.
- `extendRoute(path: Vec2[], lines: Vec2[][], before: number, after: number): Extension`

Constants: `SNAP = 10` m, `JOIN = 4` m, `STEP = 2` m, the heading look-back 15 m, the alignment threshold 0.8, the score weight 20. Keep them as named constants.

## Rules

### carryOn

1. **Start.** `at` = the path's last point. Heading `dir` = unit vector from the point 15 m back along the path (measured along it; the first point if the path is shorter than 15 m) to `at`. See bug 1 for paths with no length.
2. **Follow streets.** Repeat while the distance gathered `got` < `want − 1e-6`:
   1. Search radius: `SNAP` (10 m) on the first search, `JOIN` (4 m) on every later one.
   2. For every line not used yet, for every segment a→b of it with length ≥ 1e-6: the foot of `at` on the segment (projection clamped to 0..1), its distance d, and `dot` = unit(a→b) · `dir`. A candidate needs d ≤ radius and |dot| ≥ 0.8 (within about 37° of the heading, either way along the line). Its score is `d + (1 − |dot|) × 20`.
   3. Take the lowest score (the first found wins a tie, in line order then segment order). None: stop following streets.
   4. Mark that line used (each line is followed at most once).
   5. Walk it in the heading's direction: the foot point first; then, if dot > 0, the line's vertices from b to its last vertex; if dot < 0, from a back to its first vertex.
   6. For each walked point p, from `prev` (initially `at`): skip p if it is within 1e-6 of `prev`. If `got + |p − prev| ≥ want`, push the point on prev→p at exactly the remaining distance, set `dir` to unit(prev→p), set got = want and stop. Otherwise push p, set `dir` = unit(prev→p), add the length, `prev` = p.
   7. `at` = the last point reached.
   So the hop from the end of the path to the street's foot (up to 10 m, or 4 m when chaining) is part of the extension and counts towards its length.
3. **Straight on.** While got < want − 1e-6: step = min(2, want − got); `at` += dir × step; push `at`; got += step.
4. The returned points measured from the path's last point add up to `want` (within 1e-6), so `pathLength([last, ...carryOn(...)]) ≈ want`.
5. `want ≤ 0`: empty list.

### extendRoute

6. Head: if `before > 0`, `carryOn(reversed path, lines, before)`, reversed back (so it runs towards the path's first point); else empty.
7. Tail: if `after > 0`, `carryOn(path, lines, after)`; else empty.
8. `path` of the result = head, then the original path, then tail.
9. `startAt` = `pathLength([...head, path[0]])` (equal to `before` within rounding); `finishAt` = `startAt + pathLength(path)`.

## Callers (from `grep`, 31 Oct 2026)

- `src/core/track.ts`: for routes that aren't loops and have `runUp > 0` or `runOff > 0` (options; defaults 60 and 150 m): `extendRoute(local route, every street line in local metres, GRID_DEPTH + ceil(pitCount / 2) × 8 + runUp, runOff)`. It plans the road on `ext.path`, then finds the timed start and finish samples near the original pins using `ext.startAt / pathLength(ext.path)` and `ext.finishAt / pathLength(ext.path)` as fractions of the planned length. `pathLength` is imported from here for that.
- `carryOn`: only the test imports it; keep it exported.
- Not a caller: `jettyTrain.ts` has its own `pathLength` for its own path type.

## Edge cases

- No lines, or none within reach and aligned: the extension is a straight line on the end heading, points every 2 m (the last step shorter).
- A street that bends: followed round the bend; the heading at the end is the last segment walked, so the straight-on part continues from the bend's last direction.
- A crossing street (perpendicular) is never followed (|dot| < 0.8).
- A street that ends where the path ends (the foot is the street's end vertex): nothing walked, the line is used up, and the search goes on with the 4 m radius.
- The route's own street is a valid candidate and is normally the one taken; walking it from the foot of the end point never runs back over the route because the walk goes in the heading's direction.

## Known bugs (fix, don't copy)

1. A path with no length (one point, or all points equal) gives a zero heading (the extension piles up on one point) or NaN points (a zero-length last segment with look-back 0). The rewrite throws `Error("Route has no length to extend")` when `want > 0` and the path's length is 0. `track.ts` already rejects routes with fewer than two distinct points before this.
2. When a walk reaches only the foot (the foot is the street's end vertex, nothing past it), the heading becomes the hop's direction, which can point sideways, so the straight-on tail heads off at an angle. Never take `dir` from the hop to the foot; take it only from steps along the street (points after the foot). Results are unchanged whenever at least one street vertex past the foot is walked.
3. Doc only: the old `Extension` comment says "how far the route is extended"; it is the extended path plus the two arc lengths (see the API).

## Tests to write

The route runs east along y = 0 from (0, 0) to (300, 0) with points every 100 m. The street it's on: (−40, 0), (0, 0), (300, 0), (400, 0), (480, 60).

1. Follows the street round its bend: `carryOn(route, [street], 150)`: total length from (300, 0) is 150 ± 0.5; the last point has y > 20 and x > 400.
2. Straight on where the street runs out: `carryOn(reversed route, [street], 100)`: last point x ≈ −100 (±0.5), |y| < 0.5.
3. Ignores a crossing street: with only (300, −50)–(300, 50), `carryOn(route, [cross], 50)` ends at x ≈ 350.
4. `extendRoute(route, [street], 100, 150)`: startAt ≈ 100, finishAt − startAt ≈ 300, total path length ≈ 550.
5. Chaining: a second street starting 3 m past the first one's far end, in line, is followed on; one starting 6 m away isn't (the chain radius is 4 m).
6. The first snap reaches 10 m: a street parallel to the route offset 8 m sideways is taken (the hop counts in the length); one offset 12 m isn't.
7. A street at 30° to the heading is followed; one at 45° isn't.
8. `before = 0` and `after = 0`: path unchanged, startAt 0, finishAt = path length.
9. Straight-on steps are 2 m apart and the last step is the remainder (want 7 with no lines: points at 2, 4, 6, 7).
10. Bug 1: a one-point path throws. Bug 2: route ends at (300, 0) heading east; the only line is (200, 5)–(300, 5) (parallel, ending level with the route's end). The hop goes to (300, 5) and the straight-on tail then runs east (y stays 5), not north.
