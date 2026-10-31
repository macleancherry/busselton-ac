# Spec: road tracing from aerial imagery (`src/core/trace.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). `trace.ts` and `test/trace.test.ts` are on `UPSTREAM-FILES.txt`. Write the new module from this page without the old file open; tests are written fresh from the "Tests to write" list.

## What the module is for

OSM centrelines are often a metre or two off the aerial photo, and their widths are guesses. Tracing finds where the asphalt really is and how wide, wherever the road can be seen:

1. The photo is **straightened** along the centreline: one row per centreline sample, one pixel every 0.1 m across.
2. Each row's middle band teaches what this road's asphalt looks like, as a running median over neighbouring rows, so patches, shade and surface changes are followed.
3. A pixel is road when its chromaticity matches and its brightness is between shadow and faded; bright, unsaturated paint also counts as road.
4. Walking out from the centre, bridging cars and paint gaps, gives each row's two edges.
5. Only stretches that read clearly for 10 samples (20 m at the 2 m spacing) are trusted. Elsewhere (tree canopy, deep shadow) confidence fades and the build eases back to the OSM line and width.

`applyTrace` then moves the centreline and widths onto the trace, blended by confidence.

## Does the network core replace it?

**`traceRoad`: no, it is rewritten from this spec.** `docs/specs/road-network.md` ("Tracing") keeps the trace's job and applies it per graph edge (offset limited to 3 m and eased to 0 within 10 m of each cap; never inside a junction). Note that `docs/external-review-2026-10-31.md` lists `trace` among the modules the core "replaces"; road-network.md is the later word: the detector stays, the plumbing changes. So write `traceRoad` against a minimal centreline shape (below), not the whole `RoadPlan`, so the network core can call it on an edge.

**`applyTrace`: yes, later.** It rewrites a `RoadPlan` in place; the network core applies offsets and widths to edges itself. Rewrite it now (the old core needs it) as a thin function, and delete it with `road.ts`.

**`RasterSampler` and `displayOf`** are imagery plumbing used by many modules; keep them (see "Public API").

## Conventions

- Local metres, x east, y north. `left` is the unit normal to the left of travel; **positive lateral offsets are to the left**.
- A centreline sample has `pos: Vec2`, `left: Vec2`, `width: number` (asphalt width, m) and `s: number` (arc length, m). Samples are evenly spaced (the build's `spacing`, default 2 m).
- `closed` marks a loop (no repeated first sample at the end); smoothing wraps for closed lines (`gaussianSmooth` from `polyline.ts`, see `docs/specs/polyline.md`).
- `median` of an empty list is NaN; of an even count, the mean of the middle two.

## Public API (keep these names and shapes)

- `type RasterSampler = (x: number, y: number) => [number, number, number] | null`: aerial colour at a local point, RGB 0..1, or null where there is no imagery. A sampler may carry a property `display?: RasterSampler`, a colour-balanced variant for showing (texturing) rather than detecting.
- `displayOf(r: RasterSampler): RasterSampler`: `r.display` if present, else `r` itself.
- `interface TraceResult { offset: number[]; width: number[]; conf: number[]; coverage: number }`, one entry per sample:
  - `offset`: lateral shift of the centreline onto the traced road, m, + left.
  - `width`: traced asphalt width, m; NaN where confidence is 0.
  - `conf`: 0..1 trust.
  - `coverage`: fraction of samples traced directly (0..1).
  The arrays are plain mutable arrays: callers scale `offset` and `conf` in place before `applyTrace`.
- `traceRoad(plan: { samples: TraceSample[]; closed: boolean }, raster: RasterSampler, osmWidths?: number[], guard = true): TraceResult`, where `TraceSample = { pos: Vec2; left: Vec2; width: number; s: number }`. A `RoadPlan` satisfies this structurally. Pure: never mutates the plan.
- `applyTrace(plan: RoadPlan, tr: TraceResult, onRing: (i: number) => boolean): void`: mutates the plan.
- `rectify` is exported by the old file but has no importer; make it private (or keep exported for tests).

## traceRoad rules

Constants: `DT = 0.1` m (pixel across), `WIDER = 6` m, `MAX_DRIFT = 5` m, reference band ±12 px, running window ±25 rows, gap bridge 16 px with 6 solid px after it, start search ±15 px, trusted run ≥ 10 samples, robust median window ±12 samples, confidence fade 10 samples.

### Straightening

1. n = number of samples. `widths` = `osmWidths` if given, else each sample's `width`.
2. Reach = max(14, 1.4 × the largest width) m. `half` = round(reach / DT). Each row has m = 2·half + 1 pixels; pixel j (0..m−1) is at lateral offset t = (j − half) × DT, i.e. sampled at `pos + left × t`. Pixel `half` is on the centreline.
3. Per pixel, from its RGB (null → "not ok", with all values 0):
   - sum = r + g + b + 1e-4; brightness l = sum / 3;
   - chromaticity c = (r, g, b) / sum;
   - excess green exg = (2g − r − b) / sum;
   - saturation sat = (max − min) / max, or 0 when max is 0.

### Asphalt reference

4. Per row, the middle band is pixels half−12 .. half+12 (25 pixels, ±1.2 m). lMed = median brightness of the band (see bug 1). The band's asphalt pixels are those that are ok, exg < 0.04, sat < 0.25 and l < lMed + 0.12 (not green, not saturated, not paint-bright). The row is **valid** when at least 18 of the 25 qualify. Its reference brightness is the median l of the qualifying pixels, and its reference chromaticity the per-channel median of their c.
5. Running reference for row i: among valid rows within i ± 25 (clamped to the ends; no wrap), if fewer than 5: no reference (row i is not traced). Otherwise rL = median of their reference brightnesses, rC = per-channel median of their chromaticities.

### Road mask and edges

6. For a row with a reference, pixel p is road when it is ok and either:
   - **paint**: ratio = l / max(1e-3, rL) > 1.55 and sat < 0.22; or
   - **asphalt**: |c − rC| (Euclidean over the three channels) < 0.03, 0.4 < ratio < 1.45 and exg < 0.04.
7. A running centre pixel `centre` starts at `half` (before row 0) and is carried from row to row. Start pixel: for d = 0..15, check centre − d, then centre + d; the first road pixel found. None: row not traced.
8. Walk outward from the start, once each way. Step to the next pixel; if it's road, it becomes the edge so far. If not, look ahead across the non-road run: the run is bridged when it is at most 16 pixels long and the 6 pixels starting at the first road pixel after it are all road (indices past the row's end clamp to the last pixel). A bridged run's far road pixel becomes the edge so far and the walk carries on from there; otherwise the walk stops. The walk also stops at the row's end. lo and hi are the edges found to the right (−) and left (+).
9. Width w = (hi − lo) × DT. inRun = number of road pixels in lo..hi. The row is accepted when all of:
   - not **open**: with `guard`, neither lo ≤ 1 nor hi ≥ m − 2 (the run carries on out of view: grey roofs, a car park);
   - not **too wide**: with `guard`, w ≤ widths[i] + 6 (parking bays alongside);
   - 3 ≤ w ≤ 22;
   - inRun / (hi − lo + 1) > 0.75.
10. Accepted row: left edge L[i] = (hi − half) × DT, right edge R[i] = (lo − half) × DT (so R < L, metres, + left). Then centre = round(0.3 × (lo + hi)/2 + 0.7 × centre), clamped to half ± round(drift / DT) with drift = `MAX_DRIFT` (5 m) when guarded and unlimited when not. Rejected or untraced rows leave `centre` unchanged.
11. `guard = false` is for wide main streets with kerbside parking and car parks alongside, where every row runs out of view; callers then use no-trace zones where the unguarded trace goes wrong.

### Trust, smoothing, confidence

12. **Runs**: any run of consecutive traced samples shorter than 10 is cleared (see bug 3 for loops). `traced[i]` = still traced. coverage = count(traced) / max(1, n).
13. **Robust edges** (separately for L and R): for each i, the traced values within i ± 12 (clamped); median if there are at least 4, else NaN. Fill NaNs by holding the last value going forward; fill any leading NaNs with the first value found going backward. Any NaN left (nothing traced) becomes 0. Then `gaussianSmooth(σ = 4 samples, closed)`.
14. **Confidence**: d[i] = samples to the nearest traced sample (two passes, forward then backward; Infinity if none). raw = max(0, 1 − d/10). conf = `gaussianSmooth(raw, σ = 3, closed)`, clamped to 0..1.
15. offset[i] = clamp((L[i] + R[i]) / 2, −6, 6) × conf[i].
16. width[i] = conf[i] > 0 ? clamp(L[i] − R[i], 3, 20) : NaN.
17. **Line smoothness**: offset = `gaussianSmooth(offset, σ = 8, closed)`, then a lateral rate limit: maxStep = 0.06 × spacing, where spacing = s[1] − s[0] (2 if n ≤ 1). Forward pass: offset[i] = clamp(offset[i], offset[i−1] − maxStep, offset[i−1] + maxStep). Then a backward pass the same way from offset[i+1].
18. Return `{ offset, width, conf, coverage }` (conf as in 14, not further smoothed).

## applyTrace rules

19. New points: for each sample i, `pos` unchanged if `onRing(i)`, else `pos + left × offset[i]`.
20. `frames(points, closed)` (polyline.ts) gives new pos, tan, left, s and curvature per sample; curvature is then `gaussianSmooth(curvature, σ = 4, closed)`. Write these five into each sample. Sample count, `h`, `bank`, `kerb` and anything else are untouched.
21. Width: for samples not on a ring and with a non-NaN traced width: width += (traced − width) × conf[i].
22. plan.length = last sample's s, plus the closing segment for a closed plan.
23. Each roundabout's `sIn` and `sOut` move to the new arc length (see bug 4 for how).

## Callers (from `grep`, 31 Oct 2026)

- `src/core/track.ts`: when `traceRoads` (default on) and imagery exist: `traceRoad(plan, raster, undefined, opts.traceGuard)`; then for `noTrace` zones it multiplies `offset[i]` and `conf[i]` by a factor (0 inside a zone, fading to 1 over 30 m outside); then `applyTrace(plan, trace, i => sample i is within a roundabout (0.5 m margin))`. Later it reads `trace.conf[i] > 0.7` as "trusted" for the photo road texture, kerb evidence and paint markings (same indices: `applyTrace` doesn't resample), and `trace.coverage` for build stats. `displayOf(raster)` for every textured use of the photo (photo road, strip and kerb-return textures), and it builds a combined street sampler with a `display` property.
- `src/core/sideStreets.ts` (`traceSideStreets`): each street of 30 m or more that isn't a loop is planned on its own (`lineSmoothing: 2`, no banking, its width as override), traced with `traceGuard`; skipped if coverage < 0.2; offset eased to 0 within 12 m of each junction end; `applyTrace(sub, tr, () => false)`; keeps `tr.conf`.
- `RasterSampler` type only: `services/raster.ts` (builds samplers, adds `display`), `kerbs.ts`, `footpaths.ts`, `paintLines.ts`, `photoSurface.ts`.
- Tests: `test/trace.test.ts` (also covers `photoSurface` and `traceSideStreets` through these functions).

## Edge cases

- No samples: empty arrays, coverage 0. One sample: works (spacing 2).
- No imagery at all (sampler returns null everywhere): no valid rows, nothing traced, offset all 0, conf all 0, width all NaN, coverage 0.
- Tree canopy (green): band pixels fail exg, rows invalid, confidence fades to 0 within about 10 samples plus the σ = 3 blur, and the line returns to OSM.
- A car in the lane or a dashed centre line: bridged (≤ 1.6 m gaps) or counted as paint.
- A shadow across the road: brightness ratio down to 0.4 still counts, and the running reference follows it.
- Uniform grey beside the road (roofs, parking): with `guard`, the open and too-wide tests reject those rows, so the trace stays on the OSM line there.
- Constant-width roads: the robust median ignores single bad rows.

## Known bugs (fix, don't copy)

1. lMed (rule 4) includes not-ok pixels as brightness 0, which drags the threshold down where the imagery runs out. Take the median over ok pixels only (NaN if none, and then the row is invalid).
2. `Math.max(...widths)` spreads the whole array onto the stack; very long routes can overflow it. Use a loop.
3. Sample-count constants assume 2 m spacing (10-sample runs = 20 m, ±12 = 24 m, ±25 rows = 50 m, fade 10 = 20 m, σ 3/4/8). Express them in metres (20, 24, 50, 20 m; σ 6, 8, 16 m) and divide by the actual spacing, rounding to whole samples, so results are identical at 2 m and sensible at other spacings.
4. On closed plans, the run filter (rule 12), the running windows (5, 13) and the distance passes (14) don't wrap, so a run crossing the seam can be cleared and confidence drops at the seam; the rate limit (17) doesn't wrap either, so the seam can step. Wrap all of them when `closed`.
5. `applyTrace` moves `sIn`/`sOut` to the sample whose *new* s is nearest the *old* value, which mixes two arc-length scales. Instead find the sample index whose old s is nearest the old value (before writing the frames), and take that sample's new s.
6. `applyTrace` with an empty plan throws (reducing an empty list). Return without change.
7. The trace never moves the line more than 5 m (`MAX_DRIFT`) but the offset is clamped at 6 m (rule 15). Keep 6 for now (the network core will cap at 3 m), but note it.
8. Width is measured between pixel centres ((hi − lo) × DT), one pixel narrower than the run. Keep it (tests and tuning depend on it).

## Tests to write

Synthetic photo: OSM line along y = 0, samples from x = −300 to 300 (route points every 20 m, `widthOverride: 6`); the real 9 m road is centred at y = 1.5 (grey ≈ (0.38, 0.38, 0.40) with ±0.02 noise); grass elsewhere (0.33, 0.45, 0.2); tree canopy (0.12, 0.3, 0.1) over the road for 50 < x < 150; a red car (0.75, 0.1, 0.1) at −102 < x < −98, 0.5 < t < 2.3 m; a dashed white centre line (0.85, 0.85, 0.83), |t| < 0.06, 3 m of every 12 m; a tree shadow (×0.6) for −200 < x < −170.

1. coverage > 0.6; at x = −250, −185 (shadow), −100 (car), 0, 250: offset ≈ 1.5 (to 0 decimals), width between 8.3 and 9.7.
2. Under the canopy (x = 100): conf < 0.2, |offset| < 0.4.
3. `applyTrace` on a fresh plan: at x = −250 the sample's y ≈ 1.5 and width ≈ 9; at x = 100 width < 6.6. Sample count unchanged; `s` increasing; plan.length = last s.
4. Main street beside roofs: an 8 m road on y = 0 whose grey continues to y = 9.5 (parking bays), then slightly lighter grey awnings to y = 40, grass beyond: |offset| < 1 everywhere (guarded).
5. Same main street with `guard = false`: rows run to the edge of the 14 m reach and are accepted (w ≈ 18 m ≤ 22), so the line is pulled north: offset > 1 m in the middle of the stretch. Documents what the guard does.
6. Side street (via `traceSideStreets`): a street north from (0, 4), the real 7 m road centred at x = 1.2: one street traced; its junction end stays at x ≈ 0; 30 samples from the far end x ≈ 1.2 and width ≈ 7.
7. No imagery (null sampler): coverage 0, all offsets 0, all widths NaN, all conf 0.
8. Short visible stretch: road visible for only 8 samples, canopy elsewhere: nothing traced (run filter).
9. Rate limit: no two neighbouring offsets differ by more than 0.06 × spacing (+1e-9).
10. Paint: a row whose middle is white paint (ratio > 1.55, sat < 0.22) still counts as road.
11. `displayOf`: a sampler with `display` returns it; one without returns itself.
12. Loop (bug 4): a closed circular road traced all round has coverage 1 and no confidence dip at sample 0.
13. Roundabout remap (bug 5): after `applyTrace`, a roundabout's sIn equals the new s of the sample that was nearest its old sIn.
14. Spacing (bug 3): the same photo planned at 1 m spacing gives the same offsets (± 0.1 m) at matching positions as at 2 m.
