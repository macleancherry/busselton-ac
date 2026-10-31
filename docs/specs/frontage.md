# Spec: houses along street frontages, from the aerial photo

Replaces `src/core/frontage.ts` (upstream-derived, 100% match in the external review; listed in `UPSTREAM-FILES.txt`). The houses it makes are ordinary `Building` records ([buildings.md](buildings.md)); `lots.ts` ([lots.md](lots.md)) then fences and gardens them using the front wall, setback and garage flag set here. No heights: this module only makes footprints.

## What it does

In an Australian suburb there is a house on nearly every lot, set back a few metres from the street, and that row of roofs is most of what a driver sees. Mapped footprints are thin and roof patches are hard to pick out of the photo on their own (grey roofs, concrete drives and roads look alike from above), so this reads the photo the way houses are laid out: along each side of each street, from just behind the kerb line back about 25 m.

1. Every metre along each street, on each side, a column of 1 m cells is classed roof or not; the first solid run of roof gives that column's front and back.
2. The columns along a side are smoothed and split into houses where the roof stops (a side setback), the back line jumps (a different depth), or the roof colour changes (the next house); long runs are cut into lots of about 15 m.
3. Each house is a box square to the street, its roof finish nearest the photo's colour.

Coordinates are local metres, x east, y north.

## Exported API and callers

- `type PhotoSampler = (x, y) => [r, g, b] | null`: photo colour at a local point, each channel 0..1, null where there is no photo.
- `interface Frontage { pts: Vec2[]; half: number[] }`: a street centreline and half its width at each point.
- `chunkPhotoSampler(images: { chunk: TerrainChunk; rgba: Uint8Array | Uint8ClampedArray; size: number }[]): PhotoSampler | null`
  - `src/core/track.ts` collects every terrain chunk's aerial RGBA (`size` x `size`, row 0 at the chunk's north edge) while building terrain, then builds the sampler. Null when there are no images.
- `roofLike(rgb: [number, number, number]): boolean` (0..1 channels). Used by `test/frontage.test.ts`.
- `frontageHouses(streets: Frontage[], photo: PhotoSampler, onRoad: (x, y) => boolean, builtUp: (x, y) => boolean, existing: Building[], seed = 1): Building[]`
  - `src/core/track.ts`, when there is a photo sampler and `opts.buildings && opts.detectBuildings`. Streets: the route first (`plan.samples` positions, half its width per sample), then every side street from the street plan (half of `widths[i]`, else `width`). `onRoad` is "within the route's half width + 1 m, or side-street clearance under 1 m". `builtUp` is cached per 50 m cell: at least 4 known (mapped + detected) building centroids within 150 m of the cell's centre, or at least 3 primary/secondary/tertiary/minor streets with a point within 120 m. `existing` is mapped + detected buildings. `seed` is `plan.samples.length` (see bug 2). The result joins mapped and detected buildings in `filterBuildings`, then the road and roundabout filters.
  - Test: `test/frontage.test.ts`.
- Dependencies: `centroid` (vertex average), `pointInRing`, `plainHouse(roof, roofColour, height)`, `houseRoof(rand)`, `nearestRoofColour(rgb 0..255)` from buildings; `rng`.

## Rules

### Photo sampler

1. `span` is the first chunk's width (`maxX - minX`); chunks are square, all the same size, and aligned so `minX`, `minY` are multiples of span (as terrain chunks are). Index chunks by (round(minX / span), round(minY / span)); look a point up at (floor(x / span), floor(y / span)).
2. Pixel: px = floor((x - minX) / span x size), py = floor((maxY - y) / span x size); outside 0..size-1 or no chunk: null. Return the pixel's RGB / 255 (alpha ignored). Nearest pixel, no filtering.

### Roof colour test (`roofLike`)

3. With l = (r + g + b) / 3, sum = r + g + b + 0.0001, saturation = (max - min) / max (0 when max is 0). Not a roof if any of:
   - lawn and trees: (2g - r - b) / sum > 0.025;
   - water and pools: b > 1.1 r and b > g and saturation > 0.25;
   - deep shade: l < 0.13;
   - dry grass and bare earth (yellow-brown, pale): l > 0.33 and r > 1.25 b and g > 1.15 b and r < 1.25 g and saturation > 0.18. (Terracotta is redder: it fails r < 1.25 g and stays a roof.)
   Otherwise a roof. Reference values: [0.3, 0.42, 0.2] no, [0.2, 0.55, 0.65] no, [0.62, 0.55, 0.42] no, [0.72, 0.38, 0.25] yes.

### Columns

4. Resample each street every 1 m of arc length (see bug 1 for the old module's slip): each sample has a position, the unit direction of the segment it lies on, and the half width interpolated linearly along that segment. Zero-length segments (under 1e-6 m) are skipped. The first sample is the street's first point.
5. For each side, side = +1 (left of the street's direction) then -1 (right); out = (-tan.y x side, tan.x x side).
6. A column is empty if `builtUp(pos)` is false. Otherwise scan d from half + 3 to half + 28 inclusive in 1 m steps, at pos + out x d:
   - `onRoad` there: stop (another street behind; the lot ends).
   - The cell's colour is the mean of up to four photo samples at ±0.25 m along the street and ±0.25 m along out; samples that are null are left out; all null means no colour (not a roof).
   - A roof cell: if it is the first, and d > half + 14 (a house's front must be within 14 m of the kerb line), stop with nothing; else it is the front, d0. Every roof cell sets the back d1 = d, resets the gap count and adds its colour to the column's mean.
   - A non-roof cell after the front: count it; a second consecutive one ends the run (one stray cell, a skylight or a gutter, is tolerated). Non-roof cells before the front are skipped.
   - The column is valid if it found a front and d1 - d0 >= 6. Its front and back are stored measured from the kerb line (d0 - half, d1 - half), with the mean roof colour.

### Smoothing and splitting

7. Over the n columns of one side, with "the window of radius r at i" = the valid columns among indices i - r .. i + r (clipped to 0 .. n - 1):
   - okS[i]: the radius-2 window's valid count x 2 > the window's clipped size (min(n, i + 3) - max(0, i - 2)): a strict majority.
   - back[i]: the median back of the radius-3 window (NaN if it's empty).
   - colour[i]: the per-channel median colour of the radius-2 window (none if empty).
   - Median here is the element at index floor(count / 2) of the sorted list (the upper middle for an even count). Keep that: it decides splits at ties.
   - change[i]: a = the mean of colour[] over i - 3 .. i - 1, b = the mean over i .. i + 2 (ignoring nones, clipped); 0 if either is missing. With la, lb their mean luminances (channel average), ratio = max(la, lb) / max(0.001, min(la, lb)); change = max(|a - b| (Euclidean in RGB) / 0.1, (ratio - 1) / 0.35). Houses meet at its peaks; the luminance term splits a dark roof from a pale one of the same hue.
8. Walk i = 0 .. n - 1 with `start` = none:
   - not okS[i]: close the run start .. i - 1; start = none.
   - start is none: start = i (no split test on this column).
   - otherwise split before i (close start .. i - 1, start = i) if it is a colour peak, change[i] >= 1 and change[i] >= change[i - 1] and change[i] > change[i + 1] (0 past the end), or a depth step, |back[i] - back[i - 1]| > 3 m (a NaN comparison is no step).
   - After the loop close start .. n - 1.
9. Closing a run a .. b: nothing if there's no start or it has fewer than 7 columns. Lots = round(count / 15) if count > 24, else 1. Lot k covers columns a + round(k x count / lots) to a + round((k + 1) x count / lots) - 1. Each lot makes a box (rule 10); keep it unless it is taken: its centroid is inside an existing or already-made building's ring, or any of those buildings' centroid is inside its ring.

### The house box

10. From the lot's columns (all of them, valid or not; "valid" = those with a front):
    - Fewer than 5 valid columns: none.
    - front = median valid front; back = min(median valid back, front + 22); back - front < 6: none.
    - The street direction is the chord from the first column's position to the last's; under 5 m long: none. t = that unit chord, o = (-t.y x side, t.x x side).
    - mid = the column at index floor(count / 2). Along positions s0, s1 = the first and last columns' positions projected on t, relative to mid. Out distances f0 = mid.half + front, f1 = mid.half + back (from mid's centreline, using mid's half width).
    - Ring: mid + t s + o f at (s0, f0), (s1, f0), (s1, f1), (s0, f1). The front is the first two of these, in that order. For side -1 the ring is reversed so every ring is counter-clockwise (the front record keeps its original order; consumers match either order).
    - Roof colour: the mean of the valid columns' colours x 255, through `nearestRoofColour`. Roof shape `houseRoof(rand)`. Wall height 3.6 m if (s1 - s0) x (back - front) > 250 m², else 2.8 m. Dress from `plainHouse(shape, colour, height)`.
    - Fields: `source: "frontage"`, `front` as above, `setback` = front (metres from the kerb line, i.e. the road edge, to the front wall: the same meaning track.ts gives `setback` for other houses), `garage` = (s1 - s0 >= 8) and a draw under 0.5 (about half the houses on a street show a garage door).
    - A run of N columns makes a house N - 1 m long (first to last column centre). Keep this (the test tolerances and every build assume it).

### Output order

11. Houses in street order, side +1 before -1, along the street. The taken test depends on this order (an earlier street's house wins an overlap), so keep it.

## Determinism

- Old module: one stream `rng(seed)` across all streets, drawn for every box made (the roof shape, then the garage only for boxes 8 m or wider), including boxes then rejected as taken. track.ts passes `plan.samples.length` as the seed, so lengthening the route by one sample changes every frontage house's roof shape and garage.
- Fix (bug 2): draw from the house's position. For each box, `placeRandom` (`src/core/random.ts`) at the front wall's midpoint, salt `0xf0a0` for the roof shape (pass `houseRoof` a function returning that one value) and `0xf0a1` for the garage. Keep the `seed` parameter (track.ts passes it) and ignore it, as `fromOsm` ignores its index.
- Everything else is already a pure function of the inputs. This changes roof shapes and garages relative to the accepted base: accept a new base deliberately.

## Known bugs to fix, not copy

1. **Resampling slip.** The old resampler is meant to carry the leftover distance from one segment into the next, but with a 1 m step the carry always works out to 1 m: every segment after the first starts its samples 1 m in, so the spacing across a vertex is between 1 and 2 m and segments under 1 m (common in OSM street geometry) get no samples at all. Resample by true arc length (rule 4). This shifts columns slightly on bent streets; it can't change the straight-street test.
2. **Seed from the route's sample count** (above).
3. **Taken test cost.** Each new box is tested against every existing and made building (thousands by thousands in town). Use a spatial grid with the same result; not a behaviour change.

## Edge cases

- Empty `images`: `chunkPhotoSampler` returns null and track.ts skips frontage entirely.
- A street with fewer than 2 points, or all points the same: no columns.
- A photo edge or a gap between chunks: those samples null; a cell with no samples is not a roof.
- `builtUp` false everywhere: no houses. Already-known buildings (`existing`) block boxes over them.
- A street behind the lot (`onRoad`) stops the scan, so a corner lot's roof isn't read across the cross street.
- A roof starting more than 14 m back: no front for that column (a big front yard, a car park, a shop set back).
- A dark roof directly against a pale one: split by the luminance ratio term even when the RGB distance alone wouldn't.
- One tree over the middle of a roof: the radius-2 majority keeps the run; a one-cell gap in depth is tolerated by the scan.
- Runs of 7 to 24 columns: one house. 25 or more: round(count / 15) lots, evenly.
- The route and a side street running together (both in `streets`): the second pass's boxes over the first's are taken and dropped.

## Tests to write

1. `roofLike` on the four reference colours (rule 3), plus deep shade (l < 0.13) and a mid-grey roof.
2. `chunkPhotoSampler`: null for no images; picks the right chunk and pixel (row 0 north), null outside every chunk.
3. The street scene of the old test (a 7 m street along y = 0, roofs 12 to 13 m wide behind 6 m of lawn, a grey, a terracotta, then a dark and a pale one touching): exactly four houses, centroids within 1.5 m of each roof's middle; each with its nearest edge 8.5 to 11 m and farthest 22 to 26 m from the centreline, area over 120 m², source `frontage`; none on the lawn side.
4. Counter-clockwise rings on both sides of a street; `front` is the edge nearest the street; `setback` equals the front distance from the kerb line.
5. `builtUp` false gives none; passing one of the found houses in `existing` gives one fewer.
6. A depth step of more than 3 m between neighbouring roofs of the same colour splits them; a single non-roof column in a roof doesn't.
7. A 40 m continuous run of one colour gives round(40 / 15) = 3 houses.
8. Resampling: a street drawn as many 0.4 m segments gives the same houses as the same street drawn as one segment.
9. Determinism: the same houses (rings, roof shapes, garages) whatever the `seed` argument and whatever streets come before; output identical across runs.
10. A cross street (`onRoad`) 15 m behind the kerb line stops the scan: no house reaches past it.

## Could be deleted instead of rewritten (for Mac)

No. This is where most of Busselton's houses come from (OSM footprints are sparse there).
