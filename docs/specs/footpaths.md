# Spec: footpaths, driveway crossovers and letterboxes from the photo

Replaces `src/core/footpaths.ts` (upstream-derived, 100% match). Heights follow the height contract in [scenery.md](scenery.md#the-height-contract-applies-to-every-placement-spec-in-this-group), with one twist explained below: these slabs are themselves part of the ground.

## What it does

Along kerbed edges of the route, reads the aerial photo across the nature strip to find:

- **footpaths:** a steady band of concrete 0.9 to 2.4 m wide running along the street;
- **crossovers:** concrete right across the strip from the kerb to the property line, for the width of a driveway;

then builds them as slightly raised concrete slabs (collidable as street, not track), tells the kerb builder where to lay the kerb back for each crossover, and puts a letterbox beside each driveway.

## Inputs

- The road plan (samples: position, unit left and tangent vectors, width, distance along). Sample spacing is taken from the first two samples (2 m if there's only one).
- A photo sampler: local (x, y) to an RGB triple in 0..1, or null where there's no photo.
- Kerb flags per sample per side ([left, right], non-zero where a kerb was built).
- `stripOuter`: the nature strip's outer edge, metres from the road edge (the pipeline passes verge width plus a strip extra).
- `blocked(x, y)`: true on another street (the pipeline passes "within 0.5 m of a side street").
- Constants from the kerb module: depth of the kerb's back from the road edge (`KERB_BACK`), kerb height (`KERB_H`), and the share of the kerb's height taken off where it's laid back for a driveway (`LAYBACK`).

## Reading the photo (`readVerge`)

- **Concrete test** for one pixel: lightness over 0.5, saturation under 0.16, and not green (excess-green index under 0.02). Null is not concrete.
- **Profile** at a sample and side: steps of 10 cm from the road edge out to 7 m. At each step, test three points 0.5 m back, at, and 0.5 m ahead along the road; concrete if at least two of three are.
- Only at samples with a kerb on that side, and only where the far end of the profile (road edge + 7 m) isn't blocked.
- **Crossover candidate:** the part of the profile from just behind the kerb (kerb back + 0.2 m) to the strip's outer edge is at least 75% concrete (and longer than 4 steps).
- **Footpath candidate:** walking out from just behind the kerb, the first run of concrete (single-step gaps bridged) whose width is 0.9 to 2.4 m and which ends before the profile does. Recorded as a band: start and end offsets from the road edge.
- **Crossovers:** runs of consecutive crossover samples between 2.5 m and 9 m long (run length = count times spacing) become a crossover: first and last sample, side, and reach = the strip's outer edge.
- **Footpaths:**
  - A candidate is *steady* if, within 10 m either way, at least that many samples' worth of candidates exist (window = 10 m / spacing), and its band centre is within 0.5 m of their median centre.
  - Runs of steady samples, bridging gaps up to 8 m where the kerb continues, become a footpath if at least 20 m long. The whole run gets one band: the median start and median end.
- **Output:** per side, a band or nothing for each sample; and the list of crossovers.

## Kerb laybacks (`laybacks`)

Per sample per side, 1 across each crossover's samples, 0 elsewhere. Passed to the kerb builder.

## Building slabs (`buildVergeConcrete`)

### Height: the twist

Footpaths and crossovers are physics ground themselves (`1STREET_...`), so they can't stand on a surface that includes them. They take `under(x, y)`: the ground *before* verge concrete is added (nature strip and kerb meshes, then terrain). With the one-surface work that's the surface sampler built from everything except these slabs; until then the pipeline passes the strip-top rule it uses now. Either way the module only calls the function: no road-sample or kerb-height arithmetic inside it.

The old signature passed extra arguments to the height function (distance from edge, the road sample, the side). Drop them: a plain `(x, y)` function.

- **Proud:** slabs stand 4 cm above `under`.
- **Footpaths:** for each side, for each pair of neighbouring samples that both have a band, a slab between the two cross-sections (band start to band end at each sample, offsets measured from that sample's road edge). Built in the same along-the-road chunks as the road (`chunkRanges` from the road mesh module), one mesh per chunk with any slabs: `1STREET_PATH_NNN`, material `concrete`. `scripts/check/path_ground.py`, `pathGround.ts` and `clearance.ts` match on `STREET_PATH`, so keep that name.
- **Crossovers:** for each crossover, a slab between each pair of its samples, from the top of the laid-back kerb (at the kerb's back) out to the reach, or further out to the footpath's start if a footpath starts beyond the reach there. The inner edge sits on the laid-back kerb top: `under` at the kerb's back, less the kerb height times `LAYBACK`, plus 5 mm so it doesn't z-fight with the kerb. The outer edge is proud like the footpaths. One mesh: `1STREET_DRIVE_000`, material `concrete`.
- **Slab shape:** a top quad plus a small edge down each long side, reaching 3 cm below `under` (so 7 cm of face below the top), the inner edge facing the road and the outer facing away. Winding so the top faces up on both sides of the road. UVs: across 0 (inner) to 1 (outer); along = distance along / 3 (a joint every 3 m).

## Letterboxes (`letterboxes`)

- One per crossover, just before the driveway as you drive along that side: the sample before the first (left side) or after the last (right side).
- Offset from the road edge: the larger of the crossover's reach and the footpath band's end there, plus 0.4 m.
- A 9 cm timber post from SINK below the ground to 0.95 m, and a 0.3 x 0.42 m `letterbox` box from 0.95 to 1.22 m. Ground here is the full `ground` (it stands on the strip or the footpath), not `under`.
- Returned as pieces (see furniture spec).

## Call sites

- `src/core/track.ts`: `readVerge` (when kerbs are on and there's a photo), `laybacks` into `buildKerbs`, `buildVergeConcrete`, `letterboxes` into the pieces list. Also `nearVergeConcrete` in track.ts reads `paths` bands to keep OSM footpaths off photo footpaths.
- Tests now: `test/footpaths.test.ts`.

## Edge cases

- No kerb anywhere: empty result.
- A one-sample plan.
- Photo missing over part of the strip (null pixels): not concrete.
- Crossover at the very first or last sample: letterbox index clamps to the ends.
- A crossover next to a footpath: the crossover runs out to the footpath; the footpath carries on across.
- Blocked far end (another street): that sample has no candidates at all.

## Test list (write fresh)

1. Concrete test: pale grey yes; white roof-bright yes; green lawn no; saturated red no; dark asphalt no; null no.
2. A synthetic photo with a 1.5 m pale band 2 m behind a kerbed edge for 60 m gives one footpath band about 2.0 to 3.5 m, the same on every sample of the run.
3. A 10 m band gives no footpath (too short); two 30 m bands with a 5 m gap join; with a 12 m gap don't.
4. A 3.5 m wide strip of concrete across the whole strip gives one crossover; a 15 m one gives none (too long to be a driveway).
5. No kerb on a side: nothing read there.
6. Laybacks mark exactly the crossover samples on the right side array.
7. Slabs: footpath meshes named `1STREET_PATH_`, crossover `1STREET_DRIVE_000`; slab tops 4 cm above `under` (use a tilted plane); crossover inner edge at the laid-back kerb height; top normals face up on both sides.
8. Letterboxes: one per crossover, on the approach side, post base SINK under `ground`.
9. `under` is called with plain (x, y) only.

## Could be deleted instead of rewritten (for Mac)

- **Photo footpaths** find very little in practice: the Busselton build reports 86 m of footpath (13 driveways), the town build 0 m, and OSM footpaths (`paths.ts`, the fork's own) now cover footpaths with proper heights. Option: delete the footpath half and keep only crossovers (they drive kerb laybacks and letterboxes, which do show).
- If footpaths go, `nearVergeConcrete` in track.ts goes with them.
