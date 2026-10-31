# Spec: replay cameras (`src/core/cameras.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). Write the new module from this page and the public format notes below, without the old file open. Tests are written fresh from the "Tests to write" list.

Provenance: upstream (honestjams, commit 218e434 "Replay cameras along the road"). The fork hasn't changed it; it is listed in `UPSTREAM-FILES.txt`. Everything on this page is upstream behaviour unless marked **Fork**.

## What the module is for

Every layout ships `data/cameras_1.ini`: one set of trackside replay cameras, so a saved replay plays back like TV coverage instead of from the chase cam. The module does two things:

1. Picks camera spots along the road plan: one every so often, beyond the verge, on a pole, on the outside of the bend, each covering a stretch of the lap.
2. Writes them as AC's cameras ini (version 3).

The game itself aims a replay camera at the car and zooms between its min and max field of view; the forward vector we write is only the camera's resting direction.

## Public API (keep these names and shapes)

### `CameraSpot` (type)

| Field | Meaning |
| --- | --- |
| `pos: [x, y, z]` | AC world space, metres (X east, Y up, Z south) |
| `forward: [x, y, z]` | Unit vector, AC world space |
| `in: number` | Start of the stretch it covers, 0 to 1 of the lap |
| `out: number` | End of the stretch, 0 to 1 |

### Functions

- **`placeCameras(plan: RoadPlan, opts: BuildOptions, ground: (x, y) => number, blocked?: (x, y) => boolean): CameraSpot[]`**
  - `plan`: the road plan (`src/core/road.ts`). Uses `plan.length` and `plan.samples[]`, each with `s` (metres along), `pos` (local x east, y north), `left` (unit normal to the left of travel), `width` (full asphalt width), `h` (centreline height) and `curvature` (signed, 1/m, positive turning left).
  - `opts`: only `opts.vergeWidth` is read (default 1.5 m in `options.ts`).
  - `ground(x, y)`: finished ground height at a local point.
  - `blocked(x, y)`: true where a camera can't stand. Default: nothing blocked.
- **`camerasIni(cams: CameraSpot[], setName = "Trackside"): string`**: the file text.

### Call sites (from `grep`, 31 Oct 2026)

- `src/core/track.ts`: `placeCameras(plan, opts, groundAt, insideAKeptBuilding)` then `camerasIni(cameras)` into `<slug>/data/cameras_1.ini`. `blocked` is "inside the ring of any building kept in the build".
- `src/core/layouts.ts`: per layout, `camerasIni(placeCameras(plan, opts, ground, () => false))` into `<slug>/<layout>/data/cameras_1.ini`. Nothing is blocked here (see "Known issues").
- Tests: `test/cameras.test.ts`. `test/track.test.ts` checks the file exists in the zip.
- `setName` is never passed by a caller; only the default is used.

## Rules: placing cameras

Constants: SPACING = 160 m of road per camera, HEIGHT = 4 m above the ground, BACK = 7 m beyond the verge.

1. **Too short for cameras.** If `plan.length` is under 50 m, or there are fewer than 2 samples, return an empty list.
2. **Number of stretches.** n = max(1, round(length / 160)). Stretch k (k = 0..n-1) runs from s0 = k * length / n to s1 = (k + 1) * length / n. Stretches are equal; there is no attempt to align them to corners.
3. **Where along the stretch.** The camera stands level with the sample at s0 + 0.65 * (s1 - s0) (two thirds along, so the car comes toward it then passes it). "The sample at s" means the first sample whose `s` is at least s (binary search over `samples[].s`, which is increasing); if s is past the last sample, the last one.
4. **Which side.** Sum the `curvature` of every sample with s0 <= `s` <= s1 (inclusive at both ends).
   - Sum > 0 (bends left): prefer the right side.
   - Sum < 0 (bends right): prefer the left side.
   - Sum exactly 0: alternate, right for even k, left for odd k.
   Side +1 is the `left` normal, side -1 is the right.
5. **The spot.** Offset from the sample's `pos` along `left` by side * (width / 2 + vergeWidth + 7). Try the preferred side first; if `blocked` there, try the other side; if both are blocked, place no camera for this stretch (the coverage rule below closes the gap).
6. **Height.** y = ground(spot) + 4.
7. **Resting direction.** Aim at a point 1 m above the road centre at the sample at s0 + 0.3 * (s1 - s0) (where the stretch begins). Convert to AC space before normalising: dx = look.x - spot.x, dy = (look.h + 1) - y, dz = -(look.y - spot.y). Normalise; if the length is 0, divide by 1 instead.
8. **Position in AC space.** pos = [spot.x, y, -spot.y] (local north becomes AC -Z).
9. **Coverage before the fix-up.** in = s0 / length, out = s1 / length.
10. **No gaps.** After all stretches: the first camera's `in` is 0; every later camera's `in` equals the previous camera's `out`; the last camera's `out` is 1. A skipped stretch is thereby covered by the camera before it (or, at the start, by the first camera placed).

`in` and `out` are fractions of the road plan's length. AC reads IN_POINT and OUT_POINT as normalised positions along the AI line (`ai/fast_lane.ai`). The two run the same way and nearly the same length, so this is a close approximation; it is not converted.

## Output: `cameras_1.ini`

Line endings CRLF (`\r\n`). Every line below is followed by CRLF, including the blank line after each section, so the file ends in CRLF.

```
[HEADER]
VERSION=3
CAMERA_COUNT=<number of cameras>
SET_NAME=<setName, default Trackside>
<blank>
```

Then for each camera i (0-based), in list order:

| Key | Value |
| --- | --- |
| section | `[CAMERA_<i>]` |
| NAME | `Camera <i + 1>` |
| POSITION | x, y, z, each to 3 decimals, joined by `, ` (comma space) |
| FORWARD | same format |
| UP | `0, 1, 0` |
| MIN_FOV | `8` |
| MAX_FOV | `50` |
| IN_POINT | `in` to 4 decimals |
| OUT_POINT | `out` to 4 decimals |
| SHADOW_SPLIT0 | `50` |
| SHADOW_SPLIT1 | `250` |
| SHADOW_SPLIT2 | `1800` |
| NEAR_PLANE | `1` |
| FAR_PLANE | `2500` |
| MIN_EXPOSURE | `0` |
| MAX_EXPOSURE | `10000` |
| DOF_FACTOR | `10` |
| DOF_RANGE | `10000` |
| DOF_FOCUS | `0` |
| DOF_MANUAL | `0` |
| SPLINE | empty (the line is `SPLINE=`) |
| SPLINE_ROTATION | `0` |
| FOV_GAMMA | `0` |
| SPLINE_ANIMATION_LENGTH | `0` |
| IS_FIXED | `0` |
| then | one blank line |

Keys are written in exactly this order, `KEY=value` with no spaces around `=`. Zero cameras writes just the header with `CAMERA_COUNT=0` (AC accepts a file with no cameras; replays fall back to the other camera modes).

## Edge cases

- Short road (under 50 m): `[]`, and `camerasIni([])` is the header only. `buildTrack` rejects routes that short anyway, but `layouts.ts` can pass short layout plans.
- Road between 50 m and 240 m: one camera covering 0 to 1.
- Every spot blocked: `[]`.
- Closed loop: no wrap-around; the last stretch ends at `plan.length`, the first starts at 0.
- `ground` is called once per placed camera, at the final spot.

## Known issues (fix rather than copy, each with a test)

1. **Layouts don't block buildings.** `layouts.ts` passes `() => false`, so a layout's cameras can stand inside a house while the main layout's can't. The fix is at the call site (pass the same building test), not in this module; mention it in the rewrite's PR and keep `blocked` optional.
2. **Nothing checks for other roads or water.** The spot is a fixed offset from the route centre, so on a divided road, beside a side street or on the foreshore it can stand on asphalt or in the sea. Optional improvement: let `blocked` cover those too (caller's job); the module needs no change.
3. **Equal stretches ignore the corners.** Keep as is for now (behaviour the tests rely on); any smarter split is a separate change.

## Possibly unused (for Mac to decide)

- The `setName` parameter: no caller passes it. Harmless; keep for a second camera set later.

## Tests to write

Use a synthetic plan from `planRoad` (a straight run east of 30 points 20 m apart, then a 20-point left bend of radius 200 m), road width 8 m, all sample heights 20, `ground = () => 20`.

1. Coverage: more than 3 cameras; first `in` is exactly 0; last `out` is exactly 1; each `in` equals the previous `out`.
2. Count: n = max(1, round(length / 160)) when nothing is blocked.
3. Stand-off: each camera is more than width/2 + vergeWidth + 5 m from every road sample (horizontally, comparing local y with -Z); y = 24 exactly (ground + 4).
4. Forward is a unit vector and points down a little (Y component negative).
5. Outside of the bend: the last camera (on the left bend) is further than the bend's radius from the centre of the turn (it stands on the right).
6. Zero curvature alternates: on a hand-built straight plan (samples every 2 m heading east, `curvature` exactly 0, `left` = [0, 1]), camera 0 is on the right (south, AC Z > 0), camera 1 on the left. (Build it by hand: `planRoad`'s smoothing may leave tiny non-zero curvature.)
7. Blocked side: with `blocked = (x, y) => y < -1` on the straight, no camera ends up south of y = -1 (they move to the left).
8. Both sides blocked for one stretch: that stretch has no camera and the previous camera's coverage extends over it (still no gaps, still ends at 1).
9. Too short: a 40 m plan gives `[]`; a 100 m plan gives exactly one camera covering 0 to 1.
10. Ini: contains `CAMERA_COUNT=<n>`; exactly n `[CAMERA_i]` headers, numbered 0..n-1; `NAME=Camera 1` for the first; `IN_POINT=0.0000` on the first; POSITION and FORWARD have 3 decimals and `, ` separators; CRLF line endings throughout, no bare `\n`; keys in the order of the table.
11. Ini for zero cameras: header only, `CAMERA_COUNT=0`, `SET_NAME=Trackside`.
12. Golden: before deleting the old module, save `camerasIni(placeCameras(...))` for the synthetic plan as a fixture in `test/fixtures/`; the new module must reproduce it byte for byte.

In-game check (workstation or rig): load a replay of a lap on a rebuilt track and step through the replay cameras (F3 / replay camera cycle): each camera picks up where the last left off and none stands inside a building or on the road.

## Sources

- Kunos cameras ini (version 3) as shipped with Kunos tracks (`content/tracks/<track>/data/cameras_1.ini`): section and key names, `SET_NAME`, IN_POINT/OUT_POINT as normalised spline positions.
- Content Manager / AcTools (gro-ove), track camera handling in the showroom and replay code: https://github.com/gro-ove/actools
