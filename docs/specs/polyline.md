# Spec: centreline polyline processing (`src/core/polyline.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). `polyline.ts` is on `UPSTREAM-FILES.txt`. Write the new module from this page without the old file open; tests are written fresh from the "Tests to write" list.

## What the module is for

OSRM and OSM geometry is a coarse polyline with a kink at every node. The road planner (`road.ts`) turns it into a smooth, evenly spaced centreline: drop duplicate points, resample densely (1 m), smooth with a Gaussian, resample at the mesh spacing, then compute a frame (tangent, left normal, curvature, distance) at every sample. The same helpers resample side streets and farm roads, smooth 1-D series (widths, curvature, banking, elevation, trace offsets), and simplify outlines for maps and the cruise/street lists.

## Conventions

- Points are `Vec2` from `geo.ts`: local metres, **x east, y north**. Everything here is 2-D and frame-agnostic except "left" and the curvature sign, which assume that right-handed frame: left is the tangent rotated 90° anticlockwise, and positive curvature is a left (anticlockwise) turn. Passing AC x/z (z south) would flip both; don't.
- **Closed series never repeat the first point at the end.** Callers strip the duplicate before calling anything with `closed = true` (`road.ts` slices it off after resampling, and pushes it back on before a resample). The wrap-around in `gaussianSmooth` and `frames` joins the last element to the first.
- "Uniformly spaced" inputs to the smoothers are assumed, not checked.
- Functions return new arrays and never mutate their inputs. Points in an output may be the same array objects as in the input (`dedupe`, `simplify`, `frames.pos`); callers don't mutate them. The rewrite may copy instead.

## Public API (keep these names and shapes)

- `cumulative(pts: Vec2[]): number[]`
- `dedupe(pts: Vec2[], minDist = 0.05): Vec2[]`
- `resample(pts: Vec2[], spacing: number): Vec2[]`
- `gaussianSmooth(values: number[], sigmaSamples: number, closed: boolean): number[]`
- `smoothPath(pts: Vec2[], sigmaMetres: number, spacing: number, closed: boolean): Vec2[]`
- `interface PathFrame { pos: Vec2; tan: Vec2; left: Vec2; curvature: number; s: number }`
- `frames(pts: Vec2[], closed: boolean): PathFrame[]`
- `simplify(pts: Vec2[], tolerance: number): Vec2[]`

## Rules

### cumulative

1. Running arc length: out[0] = 0, out[i] = out[i−1] + |pts[i] − pts[i−1]| (Euclidean). Same length as the input, except see bug 1 for empty input. Never includes a closing segment.

### dedupe

2. Walk the points in order, keeping a point only if it is **strictly more than** `minDist` (default 0.05 m) from the last kept point. The first point is always kept. It compares with the last *kept* point, not the previous input point, so a run of tiny steps is thinned until the gap exceeds minDist. It does not remove a closing duplicate of the first point (a loop's last point equal to its first stays). Empty in, empty out.

### resample

3. Total length L = last of `cumulative(pts)`. Number of intervals n = max(1, round(L / spacing)) (round half up). Step h = L / n, so the actual spacing is close to but not exactly `spacing`.
4. Output n + 1 points at arc lengths s = i·h for i = 0..n, each linearly interpolated on the segment containing s. Segment search walks forward monotonically: for each s, advance to the first segment whose end arc length is ≥ s (stopping at the last segment). The interpolation parameter is (s − start)/(segment length), with a zero-length segment treated as length 1 (giving parameter 0, the segment's start point), so zero-length segments never produce NaN.
5. The first output equals the first input point; the last equals the last input point up to floating rounding (s = n·h may differ from L by an ulp; parameter ≈ 1). Interior input vertices are not kept (corners are cut at the chord between samples).
6. All points identical (L = 0, two or more points): n = 1, output is two copies of the first point.
7. Fewer than two points and non-positive spacing: see bugs 2 and 3. The rewrite must handle them as specified there.

### gaussianSmooth

8. If σ (`sigmaSamples`) < 0.5: return a copy, unchanged.
9. Otherwise radius r = ceil(3σ); weights w(k) = exp(−k² / (2σ²)) for k = −r..r (unnormalised).
10. out[i] = Σ w(k)·values[j] / Σ w(k) over k = −r..r with j = i + k:
    - closed: j wraps modulo n (proper positive modulo). If n < 2r + 1 the window wraps more than once and samples are counted more than once; that is accepted.
    - open: terms with j outside 0..n−1 are skipped and the division is by the sum of the included weights (renormalised truncation; ends are not pinned, they are just averaged one-sidedly).
11. Empty input gives an empty output.

### smoothPath

12. σ in samples = sigmaMetres / spacing. Smooth the x series and the y series separately with `gaussianSmooth(…, σ, closed)`.
13. Closed: return the smoothed points.
14. Open: blend each point from its original towards its smoothed position with weight w = min(1, e / max(1, 2σ)), where e = min(i, n − 1 − i) is the index distance to the nearer end. So the first and last points stay exactly where they were (w = 0) and the smoothing fades in linearly over 2σ samples (the old comment says "over sigma"; the code, and this spec, use 2σ). Pins land exactly where placed.
15. When σ < 0.5 the result equals the input (rule 8, then blending a point with itself).

### frames

16. For each index i, neighbours a = pts[i−1], b = pts[i+1]; closed: indices wrap; open: indices clamp to 0..n−1 (so the ends use a one-sided difference with themselves).
17. Tangent `tan` = (b − a) / |b − a|. If |b − a| is 0 (coincident neighbours, or n = 1) divide by 1 instead, giving a zero tangent (0, 0) and a zero `left`. No NaN.
18. `left` = (−tan.y, tan.x).
19. Curvature (Menger, from the circle through a, p, b): on closed paths at every index, on open paths only at interior indices (0 at both ends). With u = p − a, v = b − p, cross = u.x·v.y − u.y·v.x, and side lengths |u|, |v|, |b − a|: curvature = 2·cross / (|u|·|v|·|b − a|) if that product is > 1e-9, else 0. Units 1/m, positive turning left. (2·cross is 4 × the triangle's area, so this is 1/R.)
20. `s` = `cumulative(pts)[i]` (on a closed path the closing segment is not included; `road.ts` adds it to get the lap length).
21. `pos` = the input point.

### simplify (Ramer-Douglas-Peucker)

22. Fewer than three points: return a copy of the input.
23. Always keep the first and last points. Recursively (an explicit stack is fine; output order must be the input order) for the span (a, b): find the interior point with the greatest distance to the chord; if that distance is **strictly greater than** `tolerance`, keep it and process (a, best) and (best, b); otherwise drop the whole span's interior.
24. Distance measure: see bug 4 (the rewrite uses distance to the segment, falling back to distance to a when a and b coincide).
25. Returns the kept points in their original order.

## Callers (from `grep`, 31 Oct 2026)

- `src/core/road.ts`: `dedupe`, `resample` (1 m dense, then `opts.spacing`), `smoothPath` (σ = `opts.lineSmoothing` m, spacing 1), `frames`, `gaussianSmooth` (widths σ = 20/spacing, curvature 8/spacing, banking 10/spacing, elevation `elevationSmoothing`/spacing), type `PathFrame`. This is the critical caller: its output is every track's centreline.
- `src/core/trace.ts`: `frames`, `gaussianSmooth` (σ 3, 4, 8 samples).
- `src/core/sideStreets.ts`: `resample` (2 m). `src/core/farmRoadsides.ts`: `resample` (1 m).
- `src/core/track.ts`, `src/core/layouts.ts`: `simplify(samples, 0.5)` for the map outline (then `[x, −y]`). `src/core/cruise.ts`: `simplify` for street lists (`test/cruise.test.ts` covers it indirectly).
- `src/core/furniture.ts`: type `PathFrame`.
- `cumulative`: no external importer (internal helper; may become private).
- Look-alikes that are *not* callers: private `simplify` functions in `carpark.ts`, `network/outline.ts`, `jettyTrain.ts` (exported there, 3-D), private `resample` in `frontage.ts` and `spurs.ts`. Leave them alone.

## Known bugs (fix, don't copy)

1. `cumulative([])` returns `[0]` (one entry for no points). Return `[]` for empty input.
2. `resample` with zero or one point reads past the end of the array and throws a TypeError. Return `[]` for no points and a one-point copy for one point. (`road.ts` already rejects fewer than two distinct points before calling.)
3. `resample` with spacing ≤ 0 or NaN: ≤ 0 makes n infinite (hangs or runs out of memory); NaN silently returns an empty list. Throw a clear error for spacing that isn't a positive finite number.
4. `simplify` measures the perpendicular distance to the infinite line through a and b. When a and b coincide (a closed ring passed with its first point repeated) every distance is 0 and the ring collapses to its two end points; and a point beyond the chord's ends but near its extension is dropped wrongly. Use the distance to the segment (clamped projection), which is the distance to a when a = b. For open centrelines (all current callers) results are unchanged or keep slightly more points.
5. Doc fix only: `smoothPath` fades in over 2σ samples, not σ (rule 14).

## Tests to write

1. `cumulative` of a 3-4-5 path is [0, 5, …]; empty gives [].
2. `dedupe`: points 0.03 m apart collapse; 0.06 m apart survive; points at x = 0, 0.02, 0.04, … keep every third one (0.06 m from the last kept is the first gap over 0.05); the closing duplicate of a loop stays.
3. `resample` a 10 m straight at 1 m: 11 points, evenly 1 m, first and last exact. A 10.4 m line at 1 m: n = 10, step 1.04. An L-shaped path: all outputs lie on the path, spacing measured along it is equal. A path with a zero-length segment in the middle: no NaN. All-identical points: two copies. Zero/one point and bad spacing as in bugs 2 and 3.
4. `gaussianSmooth`: σ 0.4 returns an equal copy; a constant series stays constant (open and closed); a unit spike spreads to a Gaussian summing to 1 (closed, long series); open ends are renormalised (the end of a linear ramp moves inwards); closed wraps (a spike at index 0 raises the last index).
5. `smoothPath` open: first and last points unchanged exactly; a zig-zag gets straighter in the middle; weight at index e is min(1, e/2σ). Closed square loop: corners rounded, no point fixed.
6. `frames` on a circle of radius 50 sampled every 1 m (closed): curvature 0.02 ± 1% everywhere anticlockwise, −0.02 clockwise; `left` points to the centre for anticlockwise; tangents unit length; `s` increasing from 0. Open straight line: curvature 0, `left` = (−ty, tx). Open path: curvature 0 at both ends. Coincident neighbours: zero tangent, no NaN.
7. `simplify`: a straight line with noise below tolerance keeps only its ends; a right angle keeps the corner; points exactly at tolerance are dropped; order preserved; fewer than three points copied; a closed ring with a repeated first point keeps its corners (bug 4).
