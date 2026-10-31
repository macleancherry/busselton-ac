# Spec: line markings read off the aerial photo

Replaces `src/core/paintLines.ts` (listed in `UPSTREAM-FILES.txt`). Its output is drawn by [markings.md](markings.md).

## What it does

At 10 to 15 cm per pixel a 100 mm painted line is about one blurred pixel, so single detections are unreliable. They're used as evidence instead:

1. **Candidates**: every 0.25 m along the route, scan across the road for narrow bright runs that look like paint (white or yellow).
2. **Lines**: over each 60 m window (every 20 m), lateral positions where candidates keep recurring are real lines. How much of the window a line covers says dashed or continuous; the detections give the dash phase. Windows chain into lines along the road.

The result is clean geometry positions (`ImageLine`), not pixels.

## Exported API and callers

- `paintCandidates(plan: RoadPlan, raster: RasterSampler, trusted: (i) => boolean): Cand[]`
- `findLines(plan: RoadPlan, cands: Cand[], trusted: (i) => boolean): ImageLine[]`
- `ImageLine` (type): `{ i0, i1, t: number[], kind: "solid" | "dash", phase, colour: "white" | "yellow" }`
  - `i0..i1`: sample index range covered, inclusive.
  - `t[i - i0]`: lateral offset from the centreline at sample i, metres, + left.
  - `phase`: for dashes, where in the 12 m cycle (of absolute s) the 3 m line starts, metres, 0 to 11.75.
- `Cand` (internal type, but returned): `{ s, t, yellow: boolean }`. Export it in the rewrite so callers and tests can type it.
- `RasterSampler` (from `trace.ts`): local (x, y) to `[r, g, b]` in 0..1, or null where there's no photo.
- Callers:
  - `src/core/track.ts`, when `opts.markings` and there's both a photo raster and a trace: `trusted(i)` = trace confidence over 0.7; `findLines(plan, paintCandidates(plan, raster, trusted), trusted)`. It then marks samples within 40 m of any line's range (and trusted) as `covered` for markings, and reports the count as `stats.photoLines`.
  - `src/core/markings.ts`: the `ImageLine` type.
  - Tests: `test/paintLines.test.ts`.

## Constants

| Name | Value | Meaning |
| --- | --- | --- |
| DS | 0.25 m | row spacing along the road |
| DT | 0.05 m | pixel step across |
| WINDOW | 60 m | window length |
| STEP | 20 m | window start spacing |
| bin | 0.1 m | lateral histogram bin |

## Rules: candidates (`paintCandidates`)

1. Rows at s = 0, 0.25, 0.5, ... up to and including the last sample's s. For each row, i = the last sample with `s_i <= s`. Skip the row if `trusted(i)` is false.
2. Row frame: position interpolated linearly between samples i and i + 1 (by s); left vector and width from sample i. `half = width / 2`, `reach = half + 1`.
3. Pixels: `n = round(2 reach / DT) + 1`, at `t_j = -reach + j DT`. For each, sample the raster at the row position plus `t_j` along left. Null: lightness NaN. Otherwise:
   - lightness `L = (r + g + b) / 3`;
   - saturation `S = (max - min) / max` (0 if max is 0);
   - yellow flag `Y = r > 0.45 and g > 0.38 and b < 0.7 g`.
4. Local asphalt reference `ref_j`: the 40th percentile (sorted ascending, element `floor(count × 0.4)`) of the non-NaN L at every second pixel from `j - 20` to `j + 20` (±1 m), clamped to the row; NaN if none.
5. A pixel is *paint* when L is a number and either `L > 1.18 ref + 0.03 and S < 0.3` (white), or `Y and L > 1.2 ref` (yellow). Comparisons with NaN are false.
6. Scan j from 8 while `j < n - 8`. At a paint pixel, extend the run to e (exclusive) while `e < n - 8` and e is paint. Then:
   - width `w = (e - j) DT`; centre `t = -reach + ((j + e - 1) / 2) DT`;
   - `peak` = max L in the run; `lo = L[j - 6]`, `hi = L[e + 5]` (6 pixels outside each end);
   - accept if `0.05 <= w <= 0.45`, `lo < 0.85 peak`, `hi < 0.85 peak`, `|lo - hi| < 0.08` (darker road both sides at similar brightness: not a shadow edge), and `|t| < half - 0.15` (inside the seal);
   - accepted: candidate `{ s, t, yellow: (count of Y in the run) > (run length) / 2 }`.
   - Continue the scan at e.
7. Output in row order, then across (increasing t).

## Rules: lines (`findLines`)

8. Sort candidates by s (stable). Don't mutate the caller's array (bug 1). `end` = last sample's s. *Index at s* = last sample with `s_i <= s`.
9. **Windows**: `w0 = 0, 20, 40, ...` while `w0 < end`; `w1 = min(end, w0 + 60)`; stop at the first window shorter than 20 m.
   - Its candidates: `w0 <= s < w1`.
   - *Rows*: the number of s in `w0, w0 + 0.25, ... < w1` whose index is trusted. Skip the window if `rows < 0.6 × (w1 - w0) / 0.25`.
10. **Peaks in a window**: count candidates per bin `b = round(t / 0.1)`. Visit bins by count, highest first; ties in the order the bins were first seen (in s-sorted candidate order).
    - Skip a bin within 8 bins (0.8 m) of one already taken (real lines are at least a metre apart: lane lines 2.8 m and more, bike lanes 1.2 m and more).
    - `near` = the window's candidates with `|t - 0.1 b| <= 0.15`.
    - `cover` = (distinct `round(s / 0.25)` among near) / rows. Skip the bin (not taken) if `cover < 0.12`.
    - Take it. Its segment: `{ s0: w0, s1: w1, t: mean t of near, cover, yellow: more than half of near yellow, phase }`.
    - *Phase*: 48 slots of 0.25 m over the 12 m cycle; each near candidate counts in slot `floor(((s mod 12) + 12) mod 12 / 0.25)`. Pick the start slot p (0..47) maximising the sum of the 12 slots p..p + 11 (wrapping): the 3 m dash. First maximum wins. `phase = 0.25 p`.
11. **Chains**: segments sorted by s0 (stable). Each joins the first chain whose last segment `L` has `L.s0 < sg.s0 <= L.s1` and `|L.t - sg.t| < 0.5`; otherwise it starts a new chain. (The old comment says 0.3 m; the code, and this spec, use 0.5.)
12. **Chain to line**:
    - Extent: `s0` = first segment's s0, `s1` = last segment's s1; a single-segment chain is trimmed 10 m at each end. Skip if `s1 - s0 < 20`.
    - `i0`, `i1` = index at s0, s1.
    - Offsets: for each sample i in i0..i1 at s_i, interpolate t linearly between the centres (`(s0 + s1) / 2`) of the two consecutive segments that bracket s_i (inclusive; the last matching pair wins); before the first centre, the first segment's t; after the last, the last segment's t. A one-segment chain is constant.
    - `cover` = mean segment cover; `kind` = solid if cover > 0.5, else dash.
    - `phase` = the upper median of the segments' phases (sorted, element `floor(count / 2)`).
    - `colour` = yellow if more than half the segments are yellow.
    - `weight = (s1 - s0) × cover`.
13. **One line read twice**: sort lines by weight, heaviest first. Keep each unless it clashes with one already kept: their index overlap `[max i0, min i1]` is at least 30% of this line's own index span, and their mean |t difference| over the overlap is under 1 m.
14. Return the kept lines sorted by i0.

## Determinism

Pure function of the plan, the raster and `trusted`. The tie rules in rules 10 and 11 (first seen, first maximum, first matching chain) make it exact; keep them.

## Interplay

- **Markings** draw these lines where they are (`covered` stretches suppress generated lines and RRPMs within 40 m of any line).
- **Kerbs**: a kerbed edge's gutter is a pale band just outside the traced asphalt; rule 6's `|t| < half - 0.15` and width limit keep most of it out, but a trace that runs wide can admit the gutter as a "solid edge line". Watch for it in renders; don't add kerb logic here.
- **Kerbside bike lanes**: a painted bike lane line 1.2 to 1.5 m from the kerb is found here as a line and drawn by markings, while `kerbside.ts` may paint the OSM bike lane too. Known overlap, owned by the caller.
- **networkCore**: the trace and photo reading stay on edges (between junction caps), per road-network.md; the caller's `skip` removes paint inside junctions. Nothing in this module needs to know.

## Known bugs to fix, not copy

1. `findLines` sorts the caller's candidate array in place. Sort a copy.
2. **Loops**: rows stop at the last sample (the section back to sample 0 is never read) and windows don't wrap across the seam. On a closed plan, read up to `plan.length` and let the last windows wrap.
3. The chain tolerance comment (0.3 m) disagrees with the code (0.5 m). Use 0.5 and say so.

## Edge cases

- Nothing trusted: no candidates, no lines.
- A window with too few trusted rows is skipped and breaks any chain through it (windows must overlap to chain).
- A line found in one window only: trimmed to the middle 40 m of it, kept if that's at least 20 m (always, for a full 60 m window).
- Two bins under 0.8 m apart: only the stronger is taken in that window.
- Null pixels next to a run (`lo` or `hi` NaN): the run is rejected.

## Tests to write

1. Synthetic photo of a 7.5 m road along x (asphalt ~0.36 grey with small noise, grass beyond ±3.75 m): solid white edge lines at ±3.3 m and a 3-on-9-off centre line starting at x = 4. Three lines: −3.3 solid, 0 dash, +3.3 solid (to 0.5 m).
2. The centre line's phase is 4 ± 0.6.
3. Nothing trusted: no lines.
4. A yellow line (r 0.8, g 0.65, b 0.2) is found with colour yellow.
5. A shadow edge (bright on one side, dark on the other) gives no candidates.
6. A 0.6 m wide bright band (too wide) gives no candidates.
7. One painted line whose detections sit 0.6 m apart in overlapping stretches (so they chain separately) ends up as one line (rule 13).
8. The input candidate array is unchanged after `findLines`.
9. A line covering 30% of rows is a dash; 80% is solid.
