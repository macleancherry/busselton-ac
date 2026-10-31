# Spec: aerial colour matching (`src/core/colour.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). `colour.ts` and `test/colour.test.ts` are on `UPSTREAM-FILES.txt`. Write the new module from this page without the old file open; tests are written fresh from the "Tests to write" list.

## What the module is for

Some state aerial mosaics carry a strong colour cast (NSW's can make bushland look navy blue), which looks wrong and also fools the vegetation tests that find trees. Matching each colour channel's mean and spread to Esri's imagery of the same area keeps the sharper source's detail with a natural colour balance.

Two functions: fit a per-channel linear transform from a source tile to a reference tile, and apply it.

**In practice this only runs for NSW imagery** (`BALANCED = {"nsw"}` in `src/services/tiles.ts`). WA (Landgate) imagery, and so every Busselton track, never uses it. See "Could be deleted instead".

## Public API (keep these names and shapes)

- `interface ColourTransform { gain: [number, number, number]; offset: [number, number, number] }`: per channel (R, G, B), out = in · gain + offset, on 0..255 values.
- `matchColours(src: Uint8Array | Uint8ClampedArray, ref: Uint8Array | Uint8ClampedArray): ColourTransform | null`: the transform that gives `src` the colour statistics of `ref`. Both are RGBA pixel arrays (4 bytes per pixel, any dimensions; the two need not be the same size: they show the same area at different resolutions).
- `applyColours(px: Uint8Array | Uint8ClampedArray, t: ColourTransform): void`: applies the transform in place.

## Rules

### Statistics (per image)

1. Visit every pixel (4 bytes: R, G, B, A). Skip pixels whose alpha is below 128 (transparent edges of a mosaic).
2. If fewer than **64** pixels were counted, the image has no usable statistics.
3. Per channel: mean μ = Σv / n; standard deviation σ = √(max(1, Σv²/n − μ²)). The variance floor of 1 (σ ≥ 1) stops a flat channel dividing by zero. Use the population formula (divide by n), in floating point.

### matchColours

4. If either image has no usable statistics, return `null`.
5. Per channel k: gain = clamp(σ_ref / σ_src, 0.5, 2); offset = μ_ref − μ_src · gain. (The offset uses the clamped gain, so the means always match after the transform, before rounding and clamping.)
6. Alpha is not part of the transform.

### applyColours

7. For every pixel (alpha ignored, so transparent pixels are transformed too), each of R, G, B becomes clamp(round(v · gain + offset), 0, 255), where round is round-half-up (towards +∞ at .5). Alpha is left unchanged.
8. In place; returns nothing.

### Edge cases

9. Array length not a multiple of 4: process only whole pixels; ignore trailing bytes (see bug 1).
10. Empty arrays: `matchColours` returns `null`; `applyColours` does nothing.
11. Identical src and ref: gain (1, 1, 1), offset (0, 0, 0) to within floating error.

## Callers (from `grep`, 31 Oct 2026)

- `src/services/tiles.ts`: `matchColours` in `colourBalance(source, z, x, y)` (src = the state tile's pixels, ref = Esri's tile, or Esri's z18 parent cropped and scaled for deeper zooms; cached per tile; any failure becomes `null`), and `applyColours` on the RGBA of each aerial chunk before it is written; type `ColourTransform`.
- `src/services/raster.ts`: type `ColourTransform` only (a per-tile map of transforms for display; tree detection reads the raw photo because a transform fitted to bushland tints asphalt green).
- `test/colour.test.ts`.

## Known bugs (fix, don't copy)

1. With a length that isn't a multiple of 4, the old code reads past the end (undefined values turn the sums into NaN, and an undefined alpha counts as opaque). Ignore the trailing partial pixel (rule 9).

## Could be deleted instead (for Mac)

Only NSW imagery uses it, and the fork's tracks are in WA. If Mac doesn't want NSW builds any more, delete `colour.ts`, `test/colour.test.ts`, `colourBalance` and the `BALANCED` set in `tiles.ts`, and the transform map in `raster.ts`, instead of rewriting. Check with Mac first.

## Tests to write

1. A synthetic bushland tile (64 x 64, green-dominant with variation) and the same tile hazy and blue-cast (each channel scaled by 0.7 and shifted, blue raised): after `matchColours` then `applyColours`, every channel of sample pixels is within 3 of the reference.
2. Identical images: identity transform.
3. Fewer than 64 opaque pixels in either image: `null`. Exactly 64: a transform.
4. Pixels with alpha < 128 are ignored when fitting (put wild colours in transparent pixels: the transform doesn't change).
5. Gain clamps: a reference with 4× the spread gives gain 2; with a quarter of the spread, 0.5; the offset still matches the means.
6. A flat source channel (σ floored to 1) doesn't produce Infinity or NaN.
7. `applyColours` clamps to 0 and 255, rounds 127.5 to 128, and leaves alpha (including on transparent pixels) unchanged while still transforming their RGB.
8. Works the same on `Uint8Array` and `Uint8ClampedArray`.
