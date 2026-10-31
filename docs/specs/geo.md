# Spec: geographic helpers and the local frame (`src/core/geo.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). `geo.ts` is on `UPSTREAM-FILES.txt`. Write the new module from this page without the old file open; tests are written fresh from the "Tests to write" list.

## What the module is for

Every build places real-world things (OSM ways, Mapillary sightings, DEM and aerial tiles) into one flat frame in metres. This module defines that frame and the web-map tile maths around it:

- the coordinate types used everywhere (`LngLat`, `Vec2`, `Bounds`);
- the local projection (degrees to local metres and back, and local metres to global tile pixels and back);
- global Web Mercator pixel maths for tile fetchers;
- a great-circle distance;
- bounding boxes and the tile range covering one.

The frame's key property: it is Web Mercator scaled by the cosine of the origin's latitude. So it is in true metres at the origin, conformal (angles right) everywhere, and **a linear (scale plus offset) map of web-map tile pixels**. Elevation and aerial tiles therefore line up with the geometry with no reprojection, and sampling a tile at a local point is a scale and a shift. The scale error grows away from the origin's latitude: about 0.1% at 10 km north or south (relative scale at latitude φ is cos φ0 / cos φ, roughly 1 + tan φ0 · Δφ). The rewrite must keep exactly this projection: built tracks, frozen snapshots, landmark layers (`build.origin`) and two Python copies (below) all assume it.

## Axis conventions (shared by the whole code base)

- `LngLat` is `[longitude, latitude]` in degrees, WGS84, **longitude first** (GeoJSON / OSM order).
- `Vec2` is local metres `[x, y]`: **x east, y north**, origin at the projection's origin.
- Global pixels `[px, py]` at zoom z: px east, **py south** (down the screen), 256 px tiles, so the world is 256·2^z pixels square; pixel (0, 0) is the north-west corner of the world (lng −180, lat ≈ +85.0511).
- Assetto Corsa (kn5, ai, ini) is x east, y up, **z south**. Conversion from local is AC x = local x, AC z = −local y, AC y = height. That conversion is done by callers (for example the outline in `track.ts` and `layouts.ts` maps `[x, y]` to `[x, −y]`), not by this module. Keep it out of `geo.ts`.

## Public API (keep these names and shapes)

Types:
- `LngLat = [number, number]`.
- `Vec2 = [number, number]` (local metres, x east, y north).
- `Bounds = { minX, minY, maxX, maxY }` (all numbers, local metres).

Constants:
- `EARTH_RADIUS = 6378137` (metres; the WGS84 semi-major axis, the Web Mercator sphere). Exported, though no TypeScript file imports it today (two Python scripts copy the value).

Functions:
- `haversine(a: LngLat, b: LngLat): number` (metres).
- `lngLatToPixel(p: LngLat, z: number): Vec2` (global pixels at zoom z; despite the type name the result is pixels, not metres).
- `pixelToLngLat(px: Vec2, z: number): LngLat`.
- `boundsOf(points: Vec2[], pad = 0): Bounds`.
- `tilesCovering(proj: LocalProjection, b: Bounds, z: number): { x0, y0, x1, y1 }`.

Class `LocalProjection`:
- `constructor(origin: LngLat)`.
- `readonly origin: LngLat` (the value passed in; callers read it, e.g. `raster.ts`, Blender and network scripts).
- `toLocal(p: LngLat): Vec2`.
- `toLngLat(v: Vec2): LngLat`.
- `metresPerPixel(z: number): number`.
- `localToPixel(v: Vec2, z: number): Vec2`.
- `pixelToLocal(px: Vec2, z: number): Vec2`.

`z` need not be an integer in the maths, but every caller passes an integer zoom.

## Rules

### Local projection

Let R = 6378137, λ, φ in radians, λ0, φ0 the origin's.

1. Scale k = cos φ0, fixed at construction.
2. Mercator metres: mx = R·λ, my = R·ln(tan(π/4 + φ/2)). The origin's (mx0, my0) are computed once.
3. `toLocal`: x = (mx − mx0)·k, y = (my − my0)·k. The origin maps to exactly (0, 0).
4. `toLngLat` is the exact inverse: mx = x/k + mx0, my = y/k + my0, λ = mx/R, φ = 2·atan(exp(my/R)) − π/2, returned in degrees. Round trip error must be below 1e-9 degrees across ±50 km.
5. No latitude clamp in the projection (±90° gives infinities; callers never go near). No longitude wrapping: a point 1° east of the origin is +k·R·π/180 metres whatever the origin's longitude.
6. `metresPerPixel(z)` = (2π·R / (256·2^z))·k. The same everywhere in the frame (that is the point of the frame).
7. `localToPixel(v, z)`: with o = `lngLatToPixel(origin, z)` and m = `metresPerPixel(z)`: px = o.x + v.x/m, py = o.y − v.y/m (pixel y grows south). Purely linear.
8. `pixelToLocal(px, z)`: the exact inverse: x = (px − o.x)·m, y = (o.y − py)·m.
9. Consistency that must hold: `localToPixel(toLocal(p), z)` equals `lngLatToPixel(p, z)` to within 1e-6 px at z 19 for any p within 50 km of the origin (both are the same Mercator maths; only the latitude clamp in rule 11 could differ, and it never applies in Australia).
10. Caching o per zoom is allowed (callers call `localToPixel` per DEM sample, millions of times); results must not change.

### Global pixels

11. `lngLatToPixel(p, z)`: size = 256·2^z. px = ((lng + 180)/360)·size. Clamp latitude to [−85.0511, 85.0511] degrees, s = sin φ, py = (0.5 − ln((1 + s)/(1 − s)) / (4π))·size. (Equivalent to the usual Mercator formula; the clamp keeps the poles finite.) No longitude wrapping or clamping.
12. `pixelToLngLat(px, z)`: lng = (px/size)·360 − 180; n = π − 2π·py/size; lat = atan(sinh n) in degrees. No clamping of either input.

### Distance

13. `haversine(a, b)`: great-circle distance on a sphere of radius **6371008.8 m** (the mean Earth radius, not R): with Δφ, Δλ in radians, h = sin²(Δφ/2) + cos φa · cos φb · sin²(Δλ/2), distance = 2·r·asin(min(1, √h)). The `min(1, …)` guards rounding for near-antipodal points.
14. Note the two radii: haversine distances and local-frame distances differ by about 0.1% (6371008.8 vs 6378137·cos φ0 / cos φ ≈ true distance on the larger sphere). This is long-standing behaviour; callers (`osm.ts` route length and "within 30 m" test, `wayRoute.ts` Dijkstra edge lengths and total distance, `spurs.ts` step lengths) only use haversine against other haversine values or loose thresholds. Keep 6371008.8 unless Mac decides otherwise; don't mix the two silently in new code.

### Bounds and tiles

15. `boundsOf(points, pad)`: the axis-aligned box of the points, each side pushed out by `pad` (min − pad, max + pad). Empty input gives minX = minY = +Infinity and maxX = maxY = −Infinity (pad doesn't change infinities); keep that (it makes downstream ranges empty) or throw, but document which. `track.ts` is the only caller, always with points.
16. `tilesCovering(proj, b, z)`: the inclusive tile index ranges at zoom z that cover the box. Take the box's north-west corner (minX, maxY) and south-east corner (maxX, minY) through `localToPixel`, divide by 256 and floor, then clamp each index to [0, 2^z − 1]. x0/y0 come from the north-west corner, x1/y1 from the south-east, so x0 ≤ x1 and y0 ≤ y1 for any non-empty box. A box edge lying exactly on a tile boundary on the south or east side includes the next tile (floor of an exact integer); harmless, keep it.

## Callers (from `grep`, 31 Oct 2026)

Types (`LngLat`, `Vec2`, `Bounds`) are imported by about 60 modules in `src/core`, `src/services`, `src/ui`, many tests and scripts; they must stay structurally `[number, number]` tuples.

Values:
- `LocalProjection`: `src/core/track.ts` (one per build, origin = route centre or `build.origin`), `src/ui/main.ts`, `test/roundabout.test.ts`, `test/zones.test.ts`; scripts `blender/export_base.ts`, `blender/render_track.ts`, `check/benchmark.ts`, `check/make_test_layer.ts`, `network/{compare,debug_node,phase1,whole}.ts`, `polish/landmarks.ts`. Type-only in `elevation.ts`, `layouts.ts`, `roundabout.ts`, `sideStreets.ts`, `raster.ts`, `tiles.ts`, `network/ways.ts`.
- `toLocal` / `toLngLat`: through the instance everywhere above.
- `localToPixel` / `pixelToLocal`: `src/core/elevation.ts` (DEM grid sampling; it also repeats the `tilesCovering` corner logic inline), `src/services/tiles.ts` (aerial chunks, per-pixel sampling at pixel centres +0.5), `src/services/raster.ts`.
- `metresPerPixel`: `src/services/raster.ts`.
- `lngLatToPixel`: `src/services/{mapillary,landcover,raster,vectorTiles}.ts`. `pixelToLngLat`: `src/services/{mapillary,landcover,vectorTiles}.ts`.
- `tilesCovering`: `src/core/elevation.ts`, `src/services/tiles.ts`.
- `boundsOf`: `src/core/track.ts` (build bounds and far bounds).
- `haversine`: `src/services/osm.ts`, `src/core/wayRoute.ts`, `src/core/spurs.ts`.
- `EARTH_RADIUS`: no TypeScript importer.

Copies outside TypeScript that must keep agreeing: `scripts/blender/landmarks/common.py` (same projection, same R and k), `scripts/check/check_build.py` (Mercator with R = 6378137 and DEM tile pixel maths). If the rewrite changes any constant or formula, those break silently. Don't.

## Known bugs and oddities (decide, don't copy blindly)

- `lngLatToPixel` returns pixels typed as `Vec2` (local metres). Harmless at runtime; a separate `Pixel` alias would be clearer but must stay a `[number, number]` tuple.
- `localToPixel`/`pixelToLocal` recompute the origin's pixel position on every call. Cache per zoom (rule 10).
- `boundsOf([])` returns an inverted infinite box (rule 15).
- No antimeridian or polar handling anywhere. Fine for Australia; say so in a comment.

## Tests to write

1. `toLocal(origin)` is exactly (0, 0); `toLngLat([0, 0])` is the origin.
2. At origin (115.35, −33.65): a point 0.01° east is k·R·π/180·0.01 m east (about 926.6 m) and exactly 0 m north; a point 0.01° north is k·R·(ln tan(π/4 + φ1/2) − ln tan(π/4 + φ0/2)) m north (about 1113 m, within 0.01% of R·π/180·0.01) and 0 m east.
3. Round trip `toLngLat(toLocal(p))` within 1e-9° for points up to 50 km away in each direction.
4. Local distance between two points 1 km apart near the origin agrees with `haversine` within 0.2%.
5. `lngLatToPixel([−180, 85.0511], z)` ≈ (0, 0); `([0, 0], 0)` = (128, 128); `([180, −85.0511], z)` ≈ (size, size). `pixelToLngLat` inverts `lngLatToPixel` within 1e-9° away from the clamp.
6. Latitudes beyond ±85.0511 give the same py as ±85.0511.
7. `localToPixel(toLocal(p), z)` matches `lngLatToPixel(p, z)` within 1e-6 px at z 15 and 19; `pixelToLocal` inverts `localToPixel`; moving 1 px east is +`metresPerPixel` metres in x, 1 px south is −`metresPerPixel` in y.
8. `metresPerPixel(z)` halves with each zoom step and equals 156543.03·cos φ0 at z 0.
9. `haversine`: zero for equal points; 111.195 km per degree of latitude (r·π/180); symmetric.
10. `boundsOf` with pad; with one point; with an empty list (the documented result).
11. `tilesCovering`: a small box inside one tile gives x0 = x1, y0 = y1 (the tile `lngLatToPixel` puts the centre in); a box straddling a tile corner gives a 2 x 2 range; north is the lower y index; indices clamp at 0 and 2^z − 1.
