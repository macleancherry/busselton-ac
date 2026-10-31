# Spec: photo road surface (`src/core/photoSurface.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"; the review lists this file as 100% upstream). Write the new module from this page without the old file open. Tests are written fresh from "Tests to write".

## What the module is for

With `roadSurface: "photo"`, each road chunk where the road was traced is textured with the aerial photo of that stretch, so patches, repairs, stains, wheel-path wear and changes of surface sit where they are in reality. This module makes that texture: it resamples the photo into a strip (across the road from the left edge to the right, along it from the chunk's first section to its last) and cleans it up for driving on:

- paint is replaced by the surrounding asphalt (markings are separate geometry);
- cars and other non-asphalt blobs are painted out the same way;
- tree shadows and broad brightness changes are mostly flattened (the game lights the road itself);
- the whole strip is toned to typical asphalt brightness;
- fine grain is added, finer than the photo resolves.

Rows the trace didn't trust (canopy, deep shade, no photo) get filled from nearby trusted asphalt, or the stretch's typical asphalt colour.

## Public API (keep these names and shapes)

```
const PHOTO_W = 256
const PHOTO_H = 4096
photoRoadTexture(
  plan: RoadPlan,
  raster: RasterSampler,
  a: number,
  b: number,
  trusted: (i: number) => boolean,
  W = PHOTO_W,
  H = PHOTO_H,
): { rgba: Uint8Array; width: number; height: number }
```

- `plan`: `RoadPlan` from `road.ts`. Uses `samples[i].s` (distance along, metres), `.pos` (ENU centre), `.left` (unit vector to the left), `.width` (full asphalt width, metres), and `plan.length`.
- `raster`: `RasterSampler` from `trace.ts`: `(x, y) => [r, g, b] | null`, colours in 0..1, ENU metres; `null` where there's no photo.
- `a`, `b`: the chunk's section range, sample indices with `a < b`. On a closed loop the last chunk's `b` equals `samples.length`, meaning "sample 0 again, at distance `plan.length`" (see `chunkRanges` in `roadMesh.ts`; chunks are 120 sections).
- `trusted(i)`: whether sample `i` (always passed as an index in `0..n-1`) can be trusted.
- Returns opaque RGBA, `W` columns by `H` rows. Column 0 is the road's left edge, column W-1 the right; row 0 is section `a` (v = 0), row H-1 is section `b`.

### Call sites (from `grep`, 31 Oct 2026)

- `src/core/track.ts` (`chunkMaterial`): only when `opts.roadSurface === "photo"`, a raster and a trace exist, and at least 30% of the chunk's samples `a..b` are trusted, where trusted means `trace.conf[i] > 0.7`. It passes `displayOf(raster)` (the colour-balanced display variant), encodes the result as DXT1 DDS named `road_photo_<chunk, 3 digits>.dds`, also hands the RGBA to the browser preview, and makes a plain `material()` with light `{0.42, 0.45, 0.06, 20}`. The road mesh maps u 0..1 across the full road width and v 0..1 from section `a` to `b` for this per-chunk material.
- `PHOTO_W`: `test/trace.test.ts`. `PHOTO_H`: nobody outside (keep exported).
- Test: `test/trace.test.ts` "photo road surface" (paints out red cars and white paint; evens out a tree shadow to within 85% of the sunlit brightness).

## Rules

All intermediate colour buffers are float32 (`Float32Array`); scalar maths in double. Luminance `L` here is always the plain mean `(r + g + b) / 3`.

### 1. Resample

1. `n = samples.length`. Section `i`'s sample is `samples[i % n]`; its distance is `samples[i].s`, except an index `>= n` has distance `plan.length`.
2. `sA` = distance of `a`, `sB` = distance of `b` (`plan.length` when `b >= n`).
3. For each row `r`: `s = sA + ((r + 0.5) / H) * (sB - sA)`. Find section `k` (starting at `a`, advancing while `k < b` and the distance of `k + 1` is `<= s`). Interpolate between section `k` and `k + 1` with `f = clamp((s - s_k) / (s_{k+1} - s_k), 0, 1)` (`f = 0` when the two distances are equal): centre `pos`, `left` vector, and `width` all linearly.
4. The row is trusted if `trusted(k % n)` (the lower section; no interpolation of trust).
5. Column `c` samples the photo at `pos + left * t`, with `t = (width / 2 - 0.25) * (1 - 2 (c + 0.5) / W)`: the strip stays 0.25 m inside each edge (kerbs and verges aren't road), so u = 0 is 0.25 m in from the left edge. (The mesh maps the strip to the full width, so the photo is stretched by 0.5 m across; intentional.)
6. Untrusted rows are not sampled. If `raster` returns `null` for any column of a trusted row, the whole row becomes untrusted (columns after it are not sampled; whatever was sampled is discarded by the mask later).

### 2. Asphalt reference per row

7. For each trusted row: take every other column (`c = 0, 2, 4, ...`), sort them by `L`, keep the middle half (sorted positions from `floor(0.25 m)` to `floor(0.75 m)` exclusive, `m` = number taken). For each channel, the reference is the median (element at `length >> 1` after sorting ascending) of that channel over the kept columns. Paint and cars are bright or coloured, so the middle half is asphalt.
8. **Typical** colour of the stretch, per channel: the median (element `length >> 1`) of the references of trusted rows among rows `0, 4, 8, ...`; if none, `[0.27, 0.27, 0.28]`.
9. Untrusted rows get the typical colour as their reference (not the nearest trusted row's, which is often in a tree's shade).
10. Smooth the references along the road with a box of radius `span = max(1, round((6 / max(1, sB - sA)) * H))` rows (so plus or minus 6 m), averaging only rows inside the strip (the window shrinks at the ends). Call this `ref(r)`.
11. `globalL` = `L` of the typical colour.

### 3. Paint-out mask

12. Metres per pixel: along `mA = max(1, sB - sA) / H`; across `mC = max(0.5, width of sample a) / W`.
13. A pixel is **bad** if its row is untrusted, or `L > refL * 1.3 + 0.05` (brighter than asphalt: paint, white cars), or its chromaticity is off: `hypot(r/S - R/T, g/S - G/T, b/S - B/T) > 0.06` with `S = r + g + b + 1e-4`, `(R, G, B) = ref(r)`, `refL = (R + G + B) / 3`, `T = refL * 3 + 1e-4`.
14. Grow the mask by about 0.4 m so outlines go too: first along rows with radius `max(1, round(0.4 / mA))`, then across with radius `max(1, round(0.4 / mC))` (a pixel is set if a bad pixel lies within the radius in that direction; a separable square dilation).

### 4. Fill

15. `valid` = 1 outside the mask, 0 inside.
16. Two passes, reach 1 m then 3 m. In each pass, with radii across `rc = max(1, round(reach / mC))` and along `rr = max(1, round(reach / mA))`: box-blur `valid` and each channel times `valid` (normalised convolution). Every pixel still invalid whose blurred `valid` is at least 0.08 takes `blurred channel / blurred valid` and becomes valid. The second pass sees the first pass's filled pixels as valid sources.
17. Pixels still invalid take `ref(row)`.

### 5. Flatten, tone and grain

18. Blur `L` of the filled image with a box of radius `max(1, round(0.75 / mC))` across and `max(1, round(0.75 / mA))` along (about 1.5 m).
19. `tone = 0.3 / max(0.05, globalL)` (0.3 is typical real asphalt brightness).
20. Per pixel: `flat = clamp(globalL / max(0.02, blurL), 0.6, 2.4)`, `gain = flat ^ 0.85 * tone` (keeps about 15% of the broad brightness variation).
21. Grain: `n = (rand() - 0.5) * 0.07 + (rand() - 0.5) * 0.03`, two draws per pixel, pixels visited row by row from row 0, column 0. Output channels `(R * gain + n)`, `(G * gain + n)`, `(B * gain + n * 1.02)` (R, G, B the filled pixel), times 255, clamped to 0..255 and **truncated** to an integer (stored into a `Uint8Array`, not rounded). Alpha 255.
22. Random stream seeded from the chunk start: seed `a * 977 + 13`. See "Randomness" for which generator.

### Box blur (shared helper)

23. Separable: first across each row with radius `rc`, then along each column with radius `rr`. Each output is the mean of the inputs within the radius that lie inside the image (the window shrinks at the edges, no padding). The old code uses running sums in double precision and stores each pass in float32; use the same order to reproduce goldens exactly.

### Randomness

The old module carries a private copy of the public-domain *mulberry32* generator (state = seed as u32; each call adds `0x6d2b79f5` and mixes), which differs from the fork's shared `rng` in `src/core/random.ts`. Choose one:

- **Shared `rng` (recommended):** one source of randomness across the code (docs/specs/scenery.md). The grain then differs pixel by pixel from the old output, so photo-texture goldens compare with a tolerance (below).
- **Mulberry32:** byte-identical output, at the cost of a second generator. If chosen, put it in `random.ts` under its own name rather than privately here.

## Bugs and rough edges (fix, don't copy)

- The old sample lookup clamps `i % n` to `n - 1`, which does nothing; on an **open** road a `b >= n` would wrap to sample 0 at the start of the road. Callers never pass that today; assert `b < n` when `!plan.closed`.
- `metresAcross` uses the width of sample `a` only; a chunk that narrows or widens a lot gets the wrong grow and blur radii. Using the chunk's mean width is better but changes output slightly; decide with the goldens (fine either way, note the choice).
- The old comment calls the reference smoothing "~6 m" though the window is plus or minus 6 m (12 m wide). Keep the behaviour, describe it correctly.
- The 0.08 fill threshold and the two reaches are tuning, not bugs. Keep them.
- `W` and `H` are parameters but nothing passes them; keep them for tests (small strips run fast).

## Edge cases

- All rows untrusted: everything is the typical fallback `[0.27, 0.27, 0.28]` toned to 0.3, plus grain; no NaN.
- `sB - sA` tiny or zero: the `max(1, ...)` guards keep radii and spans finite.
- Raster returning `null` everywhere: same as all untrusted.
- Very dark photo: `globalL` floored at 0.05 for the tone and `blurL` at 0.02 for the flatten; gains clamp, so no blow-up.
- Closed loop's last chunk (`b == n`): interpolates from the last sample back to sample 0 at `plan.length`.

## Tests to write

Use small strips (`W = 32`, `H = 256`) for speed, with synthetic samplers like `test/trace.test.ts`'s (grey asphalt with noise, white lane lines, a red car, a dark shadow band).

1. Size: returns `W x H`, `rgba.length = W * H * 4`, alpha all 255; same inputs give identical bytes.
2. Orientation: a sampler darker on the left half of the road gives darker left columns (column 0 is the left edge); a feature at the start of the chunk shows in the first rows.
3. Paint out: no pixel near white where the sampler has a white line; no red pixels where it has a car (as the existing trace test).
4. Shadow: a 10 m band at half brightness ends within 15% of the surrounding asphalt (the existing test's 0.85 ratio).
5. Tone: a uniform grey sampler at any brightness from 0.15 to 0.6 gives a mean output near 0.3 x 255 (within the grain).
6. Untrusted rows: `trusted` false for the middle third gives rows there close to the typical colour of the rest, not black.
7. All untrusted / all `null`: no NaN, mean near 0.3 x 255 in a grey-ish colour.
8. Closed loop wrap: a chunk with `b == n` samples positions between the last sample and sample 0.
9. Box blur helper (if exported for tests): a single bright pixel spreads to a `(2rc+1) x (2rr+1)` box, edges average fewer pixels, separable result equals a direct 2D box mean.
10. Grain: output differs between chunks with different `a`; the grain's mean over a uniform input is near zero.

### Golden fixtures

Before deleting the old module, capture its output for two fixed inputs (the `test/trace.test.ts` synthetic plan and sampler at full `PHOTO_W x PHOTO_H`, plus a small `32 x 256` strip with untrusted rows) as PNGs in `test/fixtures/photoSurface/`. If the new module keeps mulberry32, compare byte for byte. With the shared `rng`, the masking, fill and toning are still deterministic, so compare 16 x 16 block means (the grain averages out): every block within 3 levels per channel, and no single pixel more than 27 levels apart (each grain is within plus or minus 0.05 x 255, about 13 levels, and is not scaled by the gain, so two independent grains differ by at most about 26, plus truncation).
