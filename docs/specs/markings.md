# Spec: line markings, pavement marks and raised pavement markers

Replaces `src/core/markings.ts` (listed in `UPSTREAM-FILES.txt`). The photo-read lines it draws come from [paintLines.md](paintLines.md). It is one of the modules the network core ([road-network.md](road-network.md)) will eventually replace; until then it paints the route only.

## What it does

Paints the route's markings as their own thin geometry, laid 15 mm above the crowned road surface, after Australian practice (AS 1742.2, which Japan and the UK broadly share):

1. **Edge lines**: continuous white, 0.1 m wide, on roads 5.5 m and wider, except where a side street's mouth or a kerb is on that side.
2. **Dividing line** on two-lane roads: broken (3 m line, 9 m gap) where there's overtaking sight distance; a continuous barrier line on the side of any direction that hasn't, so double barrier lines on blind corners and crests.
3. **Raised reflective pavement markers** (RRPMs) on the dividing line every 24 m.
4. **Lines read off the aerial photo** at their measured offsets, solid or dashed in phase with the real ones, white or yellow. Where the photo has spoken, it decides, including "no lines here".
5. **Transverse marks and symbols** street-level imagery saw: stop lines, give-way lines, zebra crossings, arrows, painted words and numbers, bicycle symbols; plus the start and finish lines of a timed point-to-point route.

**Circuits** (`opts.raceway`, set when every OSM way a route follows is `highway=raceway`, or by the route's `build.raceway`): edge lines and the start and finish only. No dividing line, no RRPMs, no photo lines (generated edge lines everywhere instead) and no street-level marks.

Traffic keeps left: vehicles travelling forward along the route (increasing distance s) are on its left, positive lateral offset t.

Coordinates are local metres, x east, y north, z up; `MeshBuilder.toKn5` converts to AC axes (x, z, -y). Tests read AC positions: x, height, minus north.

## Exported API and callers

- `buildMarkings(plan, opts, skip?, edgeGap?, image?, discrete?): Kn5MeshNode[]`
  - `plan: RoadPlan` (samples with `pos`, `tan`, `left`, `s`, `h`, `bank`, `width`, optional per-sample `crown`; `closed`; `length`; `roundabouts`).
  - `opts: BuildOptions`: only `crown` is read (default 0.02 m per m).
  - `skip(s) => boolean`, default never: distances along to leave unpainted.
  - `edgeGap(side: 1 | -1, s) => boolean`, default never: where the edge line on that side (1 = left) breaks.
  - `image?: { lines: ImageLine[]; covered(i) => boolean }`: photo lines and the sample indices they speak for.
  - `discrete: DiscreteMark[] = []`.
  - Caller: `src/core/track.ts`, when `opts.markings`. It passes:
    - `skip`: inside a roundabout (margin 1 m) at the nearest sample, on an unsealed sample, or inside a networkCore junction (`net.routeSInside(s)`).
    - `edgeGap`: a side street's mouth on that side (within its half width + 1.5 m, or inside a network junction) or a kerb on that side at sample `round(s / spacing)`.
    - `image`: `findLines(...)` output, and `covered(i)` = the sample is trusted (trace confidence over 0.7) and within 40 m (in samples) of any photo line's range. Empty and never-covered when there's no photo or trace.
    - `discrete`: Mapillary `marking--discrete--*` detections snapped to the route (see Discrete marks), then `start` and `finish` at `plan.timed` sample distances, t = 0.
  - The result is concatenated with ring markings (`roundabout.ts` `buildRingMarkings`, `MARKINGS_RB<k>`), networkCore markings (`MARKINGS_J…`) and kerbside paint (`KERBSIDE_*`), and grouped as `MARKINGS` in the kn5.
- `planCentreLine(plan): { barrierFwd: boolean[]; barrierBack: boolean[] }`: per sample, whether forward / backward traffic may not overtake. Tests only.
- `sightDistances(plan, cap = OVERTAKING_SIGHT + 50): { fwd: number[]; back: number[] }`: exported, used only inside.
- `OVERTAKING_SIGHT = 250` (exported constant).
- `arrowGlyph(shape = "straight")`, `textGlyph(text = "")`, `symbolGlyph(shape = "")`: each `Glyph | null`. `symbolGlyph("bicycle")` is used by `src/core/kerbside.ts` (bike lane symbols, which it drapes itself, squeezing across to fit the lane by the glyph's widest |c|).
- Types `DiscreteMark` and `Glyph` (exported; `Glyph` is imported by `kerbside.ts`).
  - `DiscreteMark`: `{ s, t, kind: "stop" | "giveway" | "zebra" | "arrow" | "text" | "symbol" | "start" | "finish", shape?: string }`; s along, t across (+ left).
  - `Glyph`: `{ lines: [a, c][][]; heads: { at: [a, c]; dir: [a, c] }[]; width; length }`, in the mark's own frame: a along its traffic's direction of travel from its tail, c across, + to that traffic's left. `dir` is a unit vector.
- Tests: `test/markings.test.ts`, `test/unsealed.test.ts` (no paint on gravel, through a full build), `test/track.test.ts` (mesh name prefixes).

Dependencies: `surfaceHeight(sample, t, crown)` from `road.ts` (height at lateral offset t, with t clamped to the asphalt half width, using the sample's own `crown` if set); `ChunkedMesh` (`meshKit.ts`, splits before 65,535 vertices); `pad` (3-digit zero padding); `ImageLine` type from paintLines.

## Constants

| Name | Value | Meaning |
| --- | --- | --- |
| LIFT | 0.015 m | paint above the road surface |
| LINE | 0.1 m | line width; also the offset of each line of a double line from the centre |
| EYE | 1.15 m | driver's eye and target height for sight distance |
| OVERTAKING_SIGHT | 250 m | clear road needed ahead to allow overtaking |
| MIN_TWO_LANE | 5.5 m | narrower roads get no generated lines or RRPMs |
| edge line inset | 0.2 m | line centre this far in from the seal edge |
| dash cycle | 12 m | 3 m line, 9 m gap |
| RRPM spacing | 24 m | starting at s = 24 |
| HEAD_LEN, HEAD_HALF | 1.2 m, 0.36 m | arrowhead length and half width |

## Rules

### Sampling helpers

1. Sample spacing is `samples[1].s - samples[0].s` (2 m if there's one sample).
2. *Index at s*: the last sample with `s_i <= s` (binary search; clamps to 0 and n - 1).
3. *Sample at s*: interpolate linearly between the sample at s and the next one (none past the last): position, tangent (renormalised; `left` is the tangent turned 90 degrees anticlockwise), h, bank and width; other fields (crown) from the lower sample. `s` is set to the requested s.
4. *Point on the road* at (s, t): the sample at s, plus t along its left vector; height `surfaceHeight(sample, t, opts.crown) + LIFT`.
5. `end` = `plan.length` for a closed loop, else the last sample's s.

### Sight distance and the centre line plan

6. `sightDistances`: for each sample i and each direction (forward +1, back -1), walk out in steps of `step = max(1, round(4 / spacing))` samples, up to `ceil(cap / spacing)` samples. For the target sample b at k samples away:
   - Open road: if b's index runs off either end, return `cap` (the road ends in clear view). Closed: indices wrap.
   - The view to b is blocked if any intermediate sample c (at m = step, 2 step, ... < k) is either
     - *horizontally*: its distance from the straight line a to b (2D) exceeds `c.width / 2 + 1.5`, or
     - *vertically*: `c.h > a.h + EYE + (b.h - a.h) * (m / k)` (the road rises above the line from a 1.15 m eye at a to a 1.15 m target at b).
   - At the first blocked b return the last unblocked distance (`k * spacing` of the previous step; the first step has no intermediate samples, so it's never blocked). Never blocked within the cap: return `cap` (default 300 m).
7. `planCentreLine`: `barrierFwd[i] = fwd[i] < 250`, `barrierBack[i] = back[i] < 250`, each tidied:
   - *Fill gaps*: between two true samples whose indices differ by 2 to `round(40 / spacing)`, set every sample between true.
   - *Then drop runs*: any run of true shorter than `round(30 / spacing)` samples becomes false.

### Runs and stripes

8. *Runs of a per-sample condition*: maximal runs of samples where the condition holds and `skip(s_i)` is false. Each run is `[s of its first sample, s of the first sample after it]`, or `end` if it reaches the last sample. Adjacent runs of different conditions therefore abut without a gap.
9. *Stripe* from s0 to s1 at lateral offset `t(sample)` and width w (default LINE):
   - Skip if `s1 - s0 < 0.2`.
   - Cross-sections at s0, at every sample strictly between, and at s1. At each, two vertices at `t + w/2` (left, u = 0) and `t - w/2` (right, u = 1), v = the cross-section's s in metres, normal straight up.
   - One quad per pair of cross-sections, wound counter-clockwise seen from above (back-left, back-right, front-right, front-left).
10. *Patch* from s0..s1 along and t0..t1 across (transverse paint):
    - 4 rows along (3 steps, evenly spaced from s0 to s1).
    - Columns across: `cols = max(1, ceil(|t1 - t0| / 0.5))`, evenly from the higher t to the lower, so the paint follows the crown instead of sinking into it.
    - Quads between neighbouring rows and columns, wound counter-clockwise seen from above, normals up. UVs: see bug 7.

### Which samples are generated

11. A sample is *generated* where `image.covered(i)` is false (all samples without `image`).
12. A sample is *two-lane* where `width >= 5.5` and it's generated.

### Photo lines

13. For each `ImageLine` (`i0..i1`, per-sample offsets `t[i - i0]`, `kind`, `phase`, `colour`):
    - Offset at a cross-section: the line's offset at that cross-section's index (clamped to i0..i1). See bug 4.
    - Runs of samples in i0..i1 (rule 8, so `skip` applies; `edgeGap` and `covered` do not).
    - `solid`: one stripe per run.
    - `dash`: 3 m dashes every 12 m, starting at `phase + 12k`; for a run a..b, dashes start at `d = floor((a - phase) / 12) * 12 + phase` and step 12 while `d < b`, each a stripe from `max(a, d)` to `min(b, d + 3)`.
    - `yellow` lines go in the yellow mesh, others in the white.

### Edge lines

14. For each side (1 left, -1 right): runs where the sample is two-lane and `edgeGap(side, s_i)` is false; a stripe at `t = side * (width / 2 - 0.2)` (per cross-section width).

### Dividing line

15. Classify each two-lane sample by `(barrierFwd, barrierBack)`; runs of each class:
    - (no, no): broken line at t = 0.
    - (yes, yes): two continuous lines at t = +0.1 and t = -0.1 (double barrier).
    - (yes, no): continuous at t = +0.1 (forward traffic's side, the left), broken at t = -0.1.
    - (no, yes): continuous at t = -0.1, broken at t = +0.1.
16. Broken line from a to b: dashes start at multiples of 12 m of absolute s (`d` from `ceil(a / 12) * 12 - 12`, stepping 12 while `d < b`), each a stripe from `max(a, d)` to `min(b, d + 3)`. Phase is tied to absolute s, so the pattern runs on unbroken across class changes.
17. No lane lines are generated on multi-lane roads; only the photo adds them (see Edge cases).

### Discrete marks

18. Skip a mark if `skip(d.s)`, `d.s < 1` or `d.s > end - 1`. `half` = (width at d.s) / 2 - 0.2. `side` = 1 if `d.t >= 0`, else -1.
    - `start`: a patch from s - 0.2 to s + 0.2 right across (-half to half).
    - `finish`: chequered, two rows of 0.5 m squares right across. Row 0 runs s - 0.5 to s, row 1 s to s + 0.5. Across, squares start at t = -half and step 0.5 (counter k = 0, 1, ...) while `t < half - 0.05`; a square is painted when `(k + row)` is even; its far side is clamped to half.
    - `stop`: a patch s ± 0.15 from t = 0 to `side * half`.
    - `giveway`: on the mark's side, 0.6 m dashes across with 0.6 m gaps, s ± 0.15: from t = 0.1, stepping 1.2 while below half, each from `side * t` to `side * min(half, t + 0.6)`.
    - `zebra`: bars 0.5 m across, 3 m deep (s ± 1.5), right across the road: t from -half stepping 1 m while `t < half - 0.4`, each t to t + 0.5. See bug 2.
    - `arrow`, `text`, `symbol`: the glyph from `arrowGlyph(shape)`, `textGlyph(shape)` or `symbolGlyph(shape)`; skip if null. Its start along is `s0 = clamp(d.s - length/2, 1, end - 1 - length)` (centred where seen, kept on the road). Draped (rule 21) with its tail at `s0` for left-side traffic or `s0 + length` for right-side traffic, centred across on `laneCentre(d.s, d.t)`.
19. *Lane centre* at (s, t):
    - i = index at s, `half = width_i / 2`, side as above.
    - Bounds: 0 and `side * half`, plus the offset at i of every photo line covering i whose offset is on this side and more than 0.5 m from both the centre and the edge (`0.5 < lt * side < half - 0.5`). Sort.
    - If t lies between two consecutive bounds less than 4.6 m apart, return their midpoint (first such pair in sorted order).
    - Otherwise: `lanes = max(1, round(half / 3.4))`, `w = half / lanes`, `k = clamp(floor(|t| / w), 0, lanes - 1)`, return `side * (k + 0.5) * w`.
20. The caller (track.ts) builds the list: Mapillary values matching `marking--discrete--(stop-line | give-way | crosswalk-zebra | arrow--<shape> | text--<text> | symbol--bicycle)`, snapped to the nearest route segment within 15 m and dropped if more than half the width + 1 m off the centreline; s = segment start s + frac × spacing, t = signed offset. Duplicates dropped: same kind within 8 m along (and, for arrows, text and symbols, only when on the same side and within 1.6 m across: one per lane). Keep that filtering in the caller.

### Draping a glyph

21. The mark's direction `dir` = 1 if its lane centre `tc >= 0`, else -1. A glyph point (a, c) maps to the road point at `s = tail + dir * a`, `t = tc + dir * c` (rule 4), so marks for right-side traffic are turned round.
    - *Strokes*: each segment p to q of each polyline becomes one quad, extended by half the glyph width past both ends (so corners close up) and half the width either side: corners `p - n`, `q - n`, `q + n`, `p + n` (along-extended), where n is the segment's unit left normal in (a, c) times width/2. In that order it's counter-clockwise seen from above (and stays so after the half turn).
    - *Heads*: a triangle: `at + right * HEAD_HALF`, `at + dir * HEAD_LEN`, `at - right * HEAD_HALF`, with right = (dir.c, -dir.a). Counter-clockwise from above.
    - Normals up, in the white mesh.

### Glyphs

22. `arrowGlyph(shape)`, all `width = 0.2`, `length = 5`; null for any other shape (e.g. `u-turn`). A *turn branch from a0 to side*: a line from (a0, 0) to (a0 + 1.0, side * 0.55) with a head at its end pointing along that line.
    - `straight`: stem (0, 0) to (3.8, 0), head at (3.8, 0) pointing (1, 0) (tip at 5.0).
    - `left` / `right`: stem (0, 0) to (2.4, 0), no head; a turn branch from 2.4 to +1 / -1.
    - `split-left-or-straight` / `split-right-or-straight`: the straight arrow plus a turn branch from 1.6 to +1 / -1.
    - `split-left-or-right`: stem to 2.4 and turn branches from 2.4 both ways.
23. `textGlyph(text)`: painted words and numbers (speed limits, SLOW, BUS, SCHOOL, KEEP CLEAR), elongated.
    - Upper-case, split into words on runs of `-` or whitespace, empties dropped. Null if 0 or more than 2 words, any word over 8 characters, or any character the font lacks.
    - Font: single-stroke polylines in a unit box per character, x across (0 = left as read), y along (0 = nearest the driver). Digits 0 to 9 and letters A to Z. Draw your own simple block font (the old one was square, 7-segment-like, and lacked Q; include Q).
    - Character height H = 3 m; words stack along the road with a 1.5 m gap between rows, the first word nearest the driver (row r starts at `a = r * 4.5`).
    - Per word of n characters: gap g = 0.35 m between characters if the word is all digits, else 0.2 m; character width `W = min(0.75, (2.8 - g (n - 1)) / n)`; total width `n W + (n - 1) g` (at most 2.8 m, a lane).
    - Point (x, y) of character k maps to `a = rowStart + y H`, `c = total/2 - (k (W + g) + x W)` (centred, reading left to right for the driver).
    - `width` = 0.12 if the narrowest W of any word is under 0.5, else 0.18. `length = 3 × words + 1.5 × (words - 1)`. No heads.
24. `symbolGlyph("bicycle")`, null for anything else: a bicycle drawn side-on, standing up the lane (its height along the road).
    - Bike space: x along the bike (rear negative, front positive), y up. Maps to `a = 1.6 y`, `c = -0.62 x` (so the rear wheel is on the driver's left).
    - Parts, in bike space: two wheels, 17-point closed circles (16 segments) of radius 0.38 centred (±0.62, 0.38); frame triangle rear hub (-0.62, 0.38), crank (0, 0.38), seat (-0.18, 0.95), back to the rear hub; seat to head (0.48, 1.0) to crank; head to front hub (0.62, 0.38); saddle (-0.32, 1.0) to (-0.04, 1.0); handlebar head to (0.36, 1.14).
    - `width = 0.08`, `length` = the largest a of any point (1.824 m). About 1.24 m across. No heads.

### Raised pavement markers

25. At d = 24, 48, ... while `d < end - 12`: skip unless the sample at d is two-lane and `skip(d)` is false. One marker on the centreline (t = 0) at the sample at d, sitting on the road surface (no LIFT): 100 x 100 mm, 20 mm tall, square to the road. Four side faces (normals outward and tilted up, see bug 3) and a top face up; UVs on the sides u 0 to 1 along the edge, v 1 at the bottom and 0 at the top; top (0, 0). 20 vertices per marker.

### Output

26. Three chunked meshes, each `castShadows: false`, numbered from 000 per kind:
    - `MARKINGS_NNN`, material `paint` (white lines, patches, glyphs);
    - `MARKINGS_Y_NNN`, material `paint_yellow` (yellow photo lines);
    - `RRPM_NNN`, material `rrpm`.
    Empty kinds produce nothing; a road with nothing to paint returns `[]`.
27. Names matter elsewhere: `cull.ts` gives `MARKINGS` and `RRPM` a 450 m draw distance by prefix; `groundCheck.ts` `SKIP_MESHES` skips `MARKINGS*`; `cspConfig.ts` lists `paint`, `paint_yellow` as line materials and `paint?`, `rrpm` as occluding; no digit prefix, so no physics. Materials are defined by `track.ts` (`paint.png` worn white, `paint_yellow.png` solid (226, 182, 32), `rrpm.png`).

## Determinism

No randomness: the same plan, options and inputs give the same meshes, vertex for vertex.

## Interplay

- **networkCore** ([road-network.md](road-network.md), phase 1): the caller's `skip` and `edgeGap` leave the route unpainted inside network junctions, which paint their own give-way lines (`MARKINGS_J…`, 15 mm above their field). Samples near junctions may carry their own eased `crown`; markings must use it (`surfaceHeight` does). Phase 2 moves all markings to the network ("from the lanes, not the edge outlines"); this module's glyphs, patches and sight-distance rules are the parts worth carrying over.
- **Kerbs**: no edge line on a kerbed side (the caller's `edgeGap`). The dividing line and RRPMs are still generated on kerbed town streets.
- **Kerbside bays and bike lanes** (`kerbside.ts`): painted separately on the route and streets, from the asphalt edge in. Nothing coordinates them with this module: a bike lane line read off the photo here can double up with the one kerbside paints from OSM, and the generated dividing line stays at t = 0 however much parking narrows the lanes. Note, don't fix here.
- **Roundabouts**: skipped by the caller; `roundabout.ts` paints its own.
- **Heights**: paint follows the analytic surface (`surfaceHeight`), which matches the road mesh because the road is built from the same formula at sample rows and is linear between them. Anything that moves the built road surface away from that formula must move the paint too.

## Known bugs to fix, not copy

1. **Loop seam.** On a closed loop, *sample at s* doesn't wrap, so the last section (last sample to `plan.length`) collapses onto the last sample: a ~2 m unpainted gap at the start line. Runs, gap filling (`tidy`) and dash phase don't wrap either. Interpolate across the seam to sample 0, and treat runs and tidying circularly on loops.
2. **Zebra bars** can run up to 0.1 m past `half`. Clamp each bar's far side to half (as the chequers are).
3. **RRPM side normals** are (outward unit, 0.3) unnormalised. Normalise them.
4. **Photo line offsets** step at every sample (the value at the index at or before s). Interpolate the offset between samples.
5. **Short loops**: sight distance walks can wrap past their own start on loops shorter than the cap. Cap the walk at half the loop length.
6. **No RRPMs on photo-covered stretches** (two-lane requires generated). Probably unintended: studs belong on a photo dividing line too. Ask Mac; if so, place them on the photo's nearest-to-centre line where it's within 0.5 m of t = 0.
7. **Patch and glyph UVs** are all (0, 0), so they sample one texel of the worn paint texture. Use u across, v along in metres, like stripes.

## Edge cases

- Road under 5.5 m everywhere, no photo lines, no discrete marks: no meshes.
- Width crossing 5.5 m mid-road: lines start and stop at that sample.
- Photo covers everything and finds no lines: nothing generated there (except discrete marks).
- A discrete mark within 1 m of either end, or in a skipped stretch: dropped.
- Glyph longer than the road: `s0` clamps (may go below 1; acceptable).
- Mark at t = 0: treated as left (side 1).
- Multi-lane roads: only a single dividing line unless the photo shows lane lines. One-way carriageways (a divided road's half) still get a generated dividing line; the plan has no one-way flag. Flag for Mac rather than guess.

## Tests to write

1. Flat 1.5 km straight: no barrier either way.
2. An 8 m hump mid-straight: barrier for forward traffic 100 m before the crest and for backward traffic 100 m after; none far away.
3. A 90 degree, 60 m radius bend between long straights: a barrier on at least one side through the bend.
4. Tidy: a 30 m gap between barrier runs fills; a 20 m isolated barrier run is dropped.
5. Meshes on a flat 600 m, 7 m road at h = 100: names `MARKINGS_…`; every vertex 99.9 to 100.03 m up (AC y); normals up.
6. A 4 m road: no meshes.
7. Edge lines at ±(width/2 - 0.2); absent on a side where `edgeGap` is true.
8. Broken line dashes at [12k, 12k + 3) of absolute s; across a change of barrier class the dashes stay in phase.
9. Double barrier: two lines centred at ±0.1; one-sided barrier: continuous on the restricted traffic's side.
10. Photo dash line with phase 4: dashes at [4 + 12k, 7 + 12k); a yellow photo line lands in `MARKINGS_Y_…` with material `paint_yellow`.
11. RRPMs every 24 m on a 7 m road (count = number of multiples of 24 below end - 12), none in a skipped stretch, none under 5.5 m.
12. 14 m road, everything covered, no edge lines: a left arrow at t = 2.1 stays within s 296 to 304, its tail on the lane centre (1.75 m), its tip further left than 2.25 m; a straight arrow at t = -1.5 is turned round (head at the low-s end, all within 0.45 m of -1.75).
13. Unknown arrow and symbol shapes give null and no mesh; a text mark and an unknown arrow give one mesh.
14. `textGlyph`: three words or an unknown character give null; "school" is at most 2.8 m across; "keep-clear" has length 7.5 and its farthest point at a = 7.5; digit gap 0.35 vs letter gap 0.2.
15. `symbolGlyph("bicycle")`: across span under 1.5 m, max a equals `length` (1.824).
16. Finish line: two rows of alternating 0.5 m squares; start line a 0.4 m band right across.
17. Stop and give-way lines only on the mark's side; zebra bars stay within ±half.
18. Loop: paint continues across the seam with no gap (bug 1).
19. All vertex positions deterministic across two calls.

## Could be deleted instead of rewritten (for Mac)

- **`start` / `finish` marks** only appear on timed point-to-point routes; keep if those drives matter.
- **`sightDistances` export**: internal only; don't export it.
