# Spec: cutting U-turn spurs out of a route (`src/core/spurs.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). `spurs.ts` and `test/spurs.test.ts` are on `UPSTREAM-FILES.txt`. Write the new module from this page without the old file open; tests are written fresh from the "Tests to write" list.

## What the module is for

A pin that snaps to the far carriageway of a divided road, or into a side street or car park, makes the router drive past it, turn round and come back. That out-and-back builds as a hairpin spike, two roads side by side, or the same road twice. OSRM reports where it turned round (steps whose manoeuvre modifier is `uturn`). For each reported U-turn this module finds the out-and-back around it, from where the route first runs alongside itself to where it last does, cuts it out, and joins the two ends with a gentle diagonal.

Only spurs with a reported U-turn are cut: a mountain hairpin's two arms can run just as close, but the router doesn't call a bend a U-turn.

## Does the network core replace it?

**No.** It works on the router's lng/lat geometry in `services/osm.ts`, before any road is planned, and `docs/specs/road-network.md` still takes the route from OSRM and matches it to the graph ("The route"). A spur left in would match as the same edges driven twice. Rewrite it. It would only go if the build stopped using OSRM and routed pins through the graph itself, which no spec plans yet.

## Conventions

- Input and output are `LngLat` (`[lng, lat]`, degrees) from `geo.ts`.
- Internally: a local equirectangular frame centred on the route's first point: x = (lng − lng0) × cos(lat0) × 111320, y = (lat − lat0) × 110574 (metres). Arc lengths and ranges are in this frame. The bridge length rule uses `haversine` (geo.ts); the two agree to well under 1% at route scale, and the rewrite may use the local frame for both.
- Never mutate the inputs.

## Public API (keep these names and shapes)

```
interface Trimmed {
  coords: LngLat[];          // the route without the spurs
  cut: LngLat[];             // U-turns whose spur was cut out
  kept: LngLat[];            // U-turns left in (no spur found, or too long to cut, or not on the route)
  ranges: [number, number][]; // arc-length ranges removed, metres along the original route, sorted by start
}
trimSpurs(coords: LngLat[], uturns: LngLat[]): Trimmed
```

Constants: `STEP = 2` m (resample spacing), `SEP = 36` m (arms closer than this run alongside: a divided road's two carriageways, light rail between them included), `MIN_SPAN = 30` m, `MAX_CUT = 1500` m, `MAX_SHARE = 0.5`, U-turn match distance 30 m, direction window ±6 m, alignment threshold 0.8, end search window 2 × SEP = 72 m, end tolerance 2 × STEP + SEP = 40 m, bridge length max(10, 3 × step).

## Rules

### Setup

1. Fewer than 3 coordinates, or no U-turns: return `{ coords: the same array, cut: [], kept: the same uturns array, ranges: [] }`.
2. Project to the local frame; cumulative arc length `cum` per coordinate; `total` = the last.
3. **Resample** at 2 m: samples at s = 0, 2, 4, … while s ≤ total (the last sample may fall up to 2 m short of the end), each linearly interpolated on the original polyline (a zero-length segment interpolates as its start point).
4. **Direction** of each sample: unit vector from the sample 3 indices back to the one 3 indices ahead (round(6 / STEP) = 3, indices clamped to the ends); zero vector if those two coincide. This smooths over kinks in the line.
5. **Where each U-turn is**: `turnsAt[u]` = s of the sample nearest U-turn u if that distance is ≤ 30 m, else −1 (never counts).

### Per U-turn (in the order given)

6. k = the nearest sample to the U-turn (first one on ties), at distance `best`.
   - best > 30 m: add to `kept`, next.
   - samples[k].s lies within (inclusive) a range already found: the U-turn was removed with that spur; see bug 1 (add it to `cut`), next.
7. Find the spur around k (rules 8–12). None: add to `kept`. Else push the range and add the U-turn to `cut`.

### Finding the spur around sample k

8. limit = min(1500, 0.5 × total). reach = limit + 60 (search a little past the limit: a spur whose arms still run alongside there is longer than the limit, and is left alone rather than cut short).
9. Search pairs (a, b) with a at or before k and b after k: for a going back from k while s_k − s_a ≤ reach, and for each a, b going from the route's last sample back towards k + 1:
   - skip b while s_b − s_a > reach;
   - stop this a's scan once s_b − s_a < 30 (`MIN_SPAN`), or once the span is no longer than the best found so far;
   - the pair matches when |p_a − p_b| ≤ 36 and par > 0.8, where dot = dir_a · dir_b and par = |dot| if at least two reported U-turns lie strictly between s_a and s_b (`turnsAt` values), else −dot. That is: out and back, the arms run opposite ways; out, back and out again (two U-turns between), the same way. Two points heading the same way along one road either side of a single spur up a side street are not its arms (taking them cut a corner across a block).
   - the first match for this a (the widest b) becomes the best if longer; go to the next a.
10. No match, or the best span s_b − s_a > limit: no spur.
11. **Spur at the route's start**: if s_a ≤ 40 m, the spur is the route's beginning: s_a = 0, and s_b = the s of the sample nearest the route's first sample, searched over s in [s_b − 72, s_b] (see bug 4 for an empty window). The route now begins beside the pin.
12. **Spur at the route's end**: if s_b ≥ total − 40 m: s_b = total, and s_a = the s of the sample nearest the last sample, searched over [s_a, s_a + 72]. The route now ends beside the pin.
13. Return [s_a, s_b].

### Rebuilding the route

14. If no ranges were found: return the original `coords` array (same object) with `cut`, `kept` and `ranges: []`.
15. Sort the ranges by start. `at(s)` = the point at arc length s on the original lng/lat polyline (linear in lng/lat between coordinates, by the local `cum`).
16. Merge overlapping ranges (start ≤ previous end). For each merged range [a0, b0]:
    - step = distance between at(a0) and at(b0) (the sideways gap between the arms, metres);
    - J = max(10, 3 × step) for a range in the middle (a0 > 0 and b0 < total), 0 for a range touching either end;
    - widen to a = max(previous end, a0 − J), b = min(total, b0 + J);
    - output the original coordinates with previous end ≤ cum < a, then at(a) if a > 0, then at(b) if b < total; previous end = b.
    So in the middle the cut becomes a straight diagonal from at(a) to at(b) spanning about 2J + spur width, which turns the step between carriageways into a gentle slant.
17. Then the original coordinates with cum > previous end.
18. Drop consecutive exact duplicates. Return with `ranges` = the found ranges sorted by start (not merged, not widened).

## Callers (from `grep`, 31 Oct 2026)

- `src/services/osm.ts` (`route`): collects OSRM steps with `maneuver.modifier === "uturn"` (their `maneuver.location`), calls `trimSpurs(coords, uturns)`. If nothing was cut, it returns OSRM's route as is, with all U-turns reported. Otherwise: the trimmed coords, distance recomputed by haversine, roundabouts kept only if within 30 m of the trimmed route (a roundabout gone round only to turn back goes with the spur), `uturns: t.kept` (shown as a warning), `trimmed: t.cut` (shown as "cut"). `ranges` isn't read today; keep it (tests and reports use it).
- Tests: `test/spurs.test.ts`.
- Not related: a private `resample` exists in other modules; this module's resample stays private.

## Edge cases

- A U-turn more than 30 m from the route: kept, never acted on.
- A divided-road detour to a middle pin (two U-turns, out, back on the far side, and out again): the outer pair of points heading the same way, with two U-turns between them, is the spur; one clean road remains.
- A long out-and-back (arms alongside for more than the limit, e.g. 600 m out and back on a 1.7 km route): left in, reported in `kept`.
- Very short routes: limit = half the route, so nothing more than half is ever cut.
- Several U-turns on one spur: the first cuts it; the rest fall inside its range (rule 6).

## Known bugs (fix, don't copy)

1. A U-turn whose position falls inside a spur already cut is put in neither `cut` nor `kept`, so the caller's counts are short. Add it to `cut` (it was removed). `osm.ts` only checks `cut.length > 0`, which is already true in that case.
2. Ranges are merged before they are widened by J (rule 16), so two middle ranges closer than their J can produce a backward step (at(a) after at(b) of the previous one). Widen every range first (clamped to 0..total), then merge, then emit.
3. When a spur is near both ends (routes under about 160 m), rules 11 and 12 both apply and can remove nearly all of the route. If both would apply, return "no spur" and keep the U-turn.
4. When no sample lies in an end search window (only possible on tiny routes) the old code falls back to the window's start: s_b − 72 at the start (rule 11), s_a at the end (rule 12). Use the unadjusted value in both cases.
5. The limit is checked before the end adjustments, so a start/end spur can end up up to 40 m longer than the limit. Check the limit again after adjusting and return "no spur" if it's exceeded.
6. The search (rule 9) scans b from the route's end for every a, which is O(n²) per U-turn on long routes. Start b at the last sample with s_b ≤ s_a + reach (binary search); results are identical.
7. Resampling accumulates s by repeated addition; use s = i × STEP.

## Tests to write

Helper: local metres around a fixed origin (e.g. lng 153.0, lat −27.5) to lng/lat with the same constants; `line(corners…)` = a polyline through the corners with a point every 5 m. A divided road: northbound carriageway at x = 0, southbound at x = 10.

1. Start pin on the far carriageway: route (10, 100) → (10, 0) → (0, 0) → (0, 1000), U-turn at (5, 0): one cut; no output point has x ≥ 1; the first point has 90 < y < 130; the last is at y ≈ 1000.
2. End pin on the far carriageway: (0, 0) → (0, 600) → (10, 600) → (10, 500), U-turn at (5, 600): no point with x ≥ 1; the last point has 470 < y < 510.
3. Middle pin on the far side: (0, 0) → (0, 400) → (10, 400) → (10, 200) → (0, 200) → (0, 1000), U-turns at (5, 400) and (5, 200): `kept` empty; no x ≥ 1; y strictly increasing; length between 990 and 1010. After bug 1: `cut` has both U-turns.
4. Spur up a side street without cutting the corner: (0, −300) → (0, 0) → (−100, 0) → (−100, 60) → (−100, 0) → (−400, 0), U-turn at (−100, 60): one cut; some output point within 2 m of (0, 0); no point with y ≥ 15.
5. Long out-and-back left alone: (0, 0) → (0, 600) → (10, 600) → (10, 0) → (10, −500), U-turn at (5, 600): nothing cut, U-turn in `kept`.
6. Mountain hairpin, no U-turn reported: (0, 0) → (0, 300) → (6, 312) → (12, 300) → (12, 0) with `[]`: `coords` is the same array object. With a U-turn at (500, 500): it's in `kept`, coords unchanged.
7. `ranges` are sorted and lie within 0..total; a middle cut's output has a straight segment at least 2 × 10 m longer than the range.
8. Fewer than three coordinates: returned unchanged with all U-turns kept.
9. Bug 2: test the rebuilding step on its own (export it for tests): a straight 1 km route along y = 0 with middle ranges [400, 420] and [425, 430] (J = max(10, 3 × 20) = 60 for the first, 15 for the second): the output's x never decreases, and the two cuts become one gap from x = 340 to x = 480.
10. Bug 3: a 120 m route with a U-turn in the middle and arms alongside at both ends: nothing cut.
