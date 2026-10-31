# Spec: kerb and gutter, nature strips, kerb returns

Replaces `src/core/kerbs.ts` (listed in `UPSTREAM-FILES.txt`). It is one of the modules the network core ([road-network.md](road-network.md)) will eventually replace; until then it builds the route's kerbs, and returns into side streets. The footpaths and crossovers in the strip are [footpaths.md](footpaths.md) (which supplies the driveway laybacks).

## What it does

Kerb and gutter, the edge of nearly every Australian town street: a concrete gutter beside the asphalt, a 150 mm kerb, then the nature strip.

1. **Evidence** (`kerbEvidence`): looks across each edge of the road in the aerial photo for a pale concrete band right at the traced asphalt edge, asphalt inside and grass or gravel beyond.
2. **Plan** (`planKerbs`): in town kerbs are the rule (at 10 to 15 cm per pixel a kerb is a faint 0.2 m highlight, so the photo can't overrule that); on the edge of town it takes some sign of them, in the country a clear one, over 40 m. Short gaps close and short stubs go.
3. **Meshes** (`buildKerbs`): where a kerb is built it replaces the gravel verge on that side. The gutter is drivable road, the kerb has its own physics surface (cars can mount it, as in reality, but feel it), and the nature strip is textured from the aerial photo (`stripPhotoTexture`) so footpaths and driveways show. A kerb starts and ends as a one-section slope; at a driveway it's laid back.
4. **Returns** (`buildKerbReturns`): where a kerbed road meets a side street at about right angles, the kerb curves round each corner on the measured radius (about 4 m), with asphalt filling the corner, and carries on along the side street's edge where it has one.

Coordinates are local metres, x east, y north, z up; `MeshBuilder.toKn5` converts to AC axes (x, z, -y). Tests read AC positions: x, height, minus north. Lateral offset t is + left of the route; "side" 1 = left, -1 = right; per-side arrays are `[left, right]`.

## Exported API and callers

Constants (all used outside; keep the names and values):

| Export | Value | Used by |
| --- | --- | --- |
| `GUTTER` | 0.3 m, gutter (channel) width | only inside today |
| `KERB_H` | 0.15 m, kerb height above the gutter lip | `track.ts` (verge ground), `terrain.ts` (`KERB_LIFT`), `footpaths.ts` (crossover height), tests |
| `STRIP_EXTRA` | 1.5 m, how much wider than the gravel verge the nature strip runs | `track.ts`, `terrain.ts`, `roundabout.ts` |
| `LAYBACK` | 0.65, share of the kerb height a driveway layback takes away | `footpaths.ts`, tests |
| `KERB_BACK` | 0.5 m = GUTTER + face run 0.05 + kerb top 0.15: the kerb's back edge from the road edge | `track.ts`, `footpaths.ts`, `raceDress.ts` |
| `RETURN_R` | 4 m, nominal kerb return radius | tests; also the search limit (3 × RETURN_R) |

Functions and types:

- `kerbEvidence(plan, raster: RasterSampler, trusted: (i) => boolean): [number[], number[]]`: per sample and side, 1 = a kerb band seen, 0 = looked and none, NaN = not trusted.
- `planKerbs(plan, evidence: [number[], number[]] | null, town: (i) => number, blocked: (i, side) => boolean): [number[], number[]]`: 0 or 1 per sample and side. `town`: 2 = town, 1 = edge of town, 0 = country.
- `buildKerbs(plan, opts, kerb, stripMaterial: StripMaterialFn, noRamp = new Set<string>(), drops?: [number[], number[]]): KerbMeshes`
  - `KerbMeshes = { gutter: Kn5MeshNode[]; kerb: Kn5MeshNode[]; strip: Kn5MeshNode[] }`.
  - `StripMaterialFn = (ci, a, b) => { material: string; photo: boolean }`: the nature strip material for chunk ci (sample rows a..b), and whether it's a photo with the strip UV layout below.
  - `noRamp`: section keys `` `${i}:${side}` `` (section from sample i to i + 1) not to build.
  - `drops`: 1 where a driveway crosses the kerb.
- `stripRise(k, drop, d, vergeWidth): number`: the strip's top `d` metres out from the road edge over the road edge's height, as the profile below builds it: the kerb top (laid back by `drop`) at the kerb's back, straight up to `zOut` at the strip's outer edge. `footpaths.ts` stands the verge concrete on it where the strip mesh doesn't reach.
- `stripPhotoTexture(plan, raster, opts, a, b, H = 2048): { rgba: Uint8Array; width: 64; height: H }`.
- `buildKerbReturns(plan, opts, junctions, kerb, fillMaterial, photo?, streetEdge?, streetPhoto?, streetClearance?): { nodes; noRamp: Set<string>; atlas?; sideAtlas? }`
  - `junctions: { seg; side: 1 | -1; width; dir: [x, y] }[]`: the route sample index at the mouth, the side, the street's width, and its unit direction away from the route.
  - `streetEdge?(j, c, R)`: where the side street is kerbed too, its edge on corner c's side (c = -1 before the mouth, 1 after), from R metres in from the road's edge, as points `{ pos, out (unit, away from the street), z (street surface) }`, or null.
  - `streetClearance?(x, y)`: how far a point is outside the nearest side street's edge (negative on it).
  - `atlas` / `sideAtlas`: `{ rgba, width, height }` images for `returns_photo` and `sidestrips_photo`.

Callers (all in `src/core/track.ts`, when `opts.kerbs`):

- `kerbEvidence(plan, raster, i => trace.conf[i] > 0.7)` when there's a raster and trace, else null evidence.
- `planKerbs(plan, evidence, i => town[i], kerbBlocked)`. `town[i]` is computed every 10 m: motorway/trunk 0; 20+ house centres within 150 m or 5+ real streets within 120 m = 2; 8+ houses or 3+ streets = 1; else 0. `kerbBlocked(i, side)` is true inside a networkCore junction row, within a side street mouth's half width + 4 m on that side, on the inside of a turn tighter than (half + verge + STRIP_EXTRA + 3) radius, or where any of the offsets half + 0.3, half + KERB_BACK, half + 1.5 and half + verge + STRIP_EXTRA lands within 1.5 m of a roundabout, within 0.5 m of a side street, or on another stretch of the route's asphalt. After planning, track.ts zeroes kerbs on unsealed samples, marks roundabouts `kerbed` when a kerbed sample is within outer radius + 30 m, and writes `sample.kerb = [left, right]` where either is set (terrain reads it).
- `buildKerbReturns(plan, opts, mouthList, kerbs, <road material>, photo-display raster or undefined, streetEdge, street photo, streetIndex.clearance)` before `buildKerbs`; it registers `returns_photo.dds` and `sidestrips_photo.dds` from the atlases.
- `buildKerbs(plan, opts, kerbs, stripMaterial, returns.noRamp ∪ net.noRamp, laybacks(...))`. `stripMaterial` returns grass when there's no photo, else calls `stripPhotoTexture` for the chunk and registers `strip_photo_NNN` (NNN = chunk index, 3 digits) as a photo ground material.
- All kerb meshes go through `keepOffRoute` (`clearance.ts` `KEEP_OFF`) and into the kn5 group `KERBS`.
- Tests: `test/kerbs.test.ts`; constants in `test/footpaths.test.ts`, `test/terrain.test.ts`.

Dependencies: `surfaceHeight(sample, t, crown)` and `inRoundabout(plan, x, y, margin)` from `road.ts`; `chunkRanges(plan)` (chunks of 120 sections; a closed plan's last chunk ends at row n, which is sample 0 again at distance `plan.length`) and `pad` from `roadMesh.ts`; `MeshBuilder`.

## Constants (internal)

| Name | Value | Meaning |
| --- | --- | --- |
| FACE_RUN | 0.05 m | horizontal batter of the kerb face |
| KERB_TOP | 0.15 m | kerb top width |
| GUTTER_DIP | 0.03 m | the gutter falls this much toward the kerb |
| STRIP_RISE | 0.02 m | the strip rises this much from the kerb back to its outer edge |
| SKIRT | 0.8 m | the strip's outer edge drops this far as a vertical skirt |
| VERGE_DROP | 0.2 m | the gravel verge's fall from the road edge, which the strip meets where a kerb ends |
| POUR | 3 m | concrete texture repeat (one pour between joints) |
| DU | 0.05 m | photo pixel step for evidence |
| SIDE_STRIP | 2 m | strip width along side streets |

These must equal `network/dress.ts`'s `KERB` object (gutter 0.3, faceRun 0.05, top 0.15, height 0.15, dip 0.03, stripRise 0.02, skirt 0.8, vergeDrop 0.2): the network's junction kerbs meet the route kerb at the caps with the same profile. Better: export one `KERB_PROFILE` object from the new module and have dress.ts import it (a one-line change there, by whoever owns network code).

## Rules: evidence (`kerbEvidence`)

1. For each side (left k = 0, side +1; right k = 1, side -1) and each sample: NaN if not trusted, else 1 if a kerb band is seen (rule 2), else 0.
2. **Seeing a kerb band** at a sample, on one side:
   - `half = width / 2`. Pixels at u from `half - 1.6` to `half + 1.4` in steps of 0.05 (61 pixels), at lateral offset `t = u × side`. If any pixel is null, the answer is no (see bug 4).
   - Per pixel: lightness `L = (r + g + b) / 3`, saturation `S = (max - min) / max` (0 if max is 0), excess green `G = (2g - r - b) / (r + g + b + 1e-4)`.
   - Reference: the median (sorted, element `floor(count / 2)`) of L over the pixels with `u < half - 0.7` (the outer lane, clear of the edge). If not over 0.02: no.
   - `bright(j)`: `L > 1.25 ref + 0.03` and `S < 0.2` and `G < 0.03`. `asphalt(j)`: `|L / ref - 1| < 0.3` and `S < 0.22` and `G < 0.04`.
   - Scan j from 1. At a bright pixel, extend the band to e (exclusive) while e is bright or the next pixel is (one dull pixel inside the band, the gutter's dirty invert, doesn't end it). `start = u_j`, width `w = (e - j) × 0.05`.
     - If `start > half + 0.6`: stop, no.
     - If `start >= half - 0.8` and `0.1 <= w <= 1.2`: count asphalt among pixels j - 6 to j - 2 (those that exist) and among e + 3 to e + 12 (those that exist). Yes if there was at least one inside pixel and at least 60% of them are asphalt, at least 4 outside pixels, and under 50% of them asphalt (asphalt inside, something else beyond: the edge of the street, not a painted line with seal beyond).
     - Continue at e.

## Rules: plan (`planKerbs`)

3. For each side and sample i:
   - Over samples within ±20 m (±10 samples at 2 m spacing; see bug 1), wrapping on a closed plan and clipped on an open one, skipping NaN: `seen` = count, `hits` = sum. `frac = hits / seen` (0 if none seen or no evidence).
   - `yes = town(i) >= 2`, or `seen >= 6` and `frac >= 0.1` (edge of town, town = 1) or `frac >= 0.4` (country).
   - On if `yes`, not `blocked(i, side)`, and the sample position isn't within 3 m of a roundabout's outer edge (`inRoundabout(..., 3)`).
4. Tidy, per side, in this order:
   - *Close gaps*: every run of off samples bounded on both sides by on samples (not touching either end) and shorter than 16 m (8 samples) is set on.
   - Clear every blocked sample again (and every roundabout sample: bug 2).
   - *Drop stubs*: every run of on samples shorter than 16 m (8 samples) is set off.
5. Output 1 for on, 0 for off.

## Rules: the cross-section

6. **Profile** of one side at one sample, with kerb amount k (0 or 1 per sample), layback `drop` (0 or 1) and the strip's UV mode (photo or not). Heights relative to nothing: absolute.
   - `half = width / 2`; `e = surfaceHeight(sample, side × half, crown)` (the asphalt edge).
   - Kerb top `top = e + KERB_H × k × (1 - LAYBACK × drop)`; gutter invert `inv = e - GUTTER_DIP × k`; full kerb top `full = e + KERB_H × k`.
   - Strip outer edge `tOut = half + vergeWidth + STRIP_EXTRA`, at `zOut = full + STRIP_RISE × k - VERGE_DROP × (1 - k)`: where the kerb is gone (k = 0) the strip keeps its width and slopes down to verge level instead.
   - Distances from the centreline (on the side's own side): kerb back `tIn = half + KERB_BACK × k`; top of the face `tFace = half + (GUTTER + FACE_RUN + (KERB_TOP - 0.02) × drop) × k` (at a layback the face is long and gentle, running almost to the kerb back); gutter lip `tLip = half + GUTTER × k`.
   - Five pieces, from the outside in, as (t, z) pairs (for the right side, t is negated):
     1. strip skirt: (tOut, zOut - SKIRT) to (tOut, zOut), mesh strip;
     2. strip: (tOut, zOut) to (tIn, top), mesh strip;
     3. kerb top: (tIn, top) to (tFace, top), mesh kerb;
     4. kerb face: (tFace, top) to (tLip, inv), mesh kerb;
     5. gutter: (tLip, inv) to (half, e), mesh gutter.
   - Each piece has a *first* and *second* end such that, walking from first to second, you move from left to right across the road (decreasing t): on the left side that's the order above; on the right side the pieces are reversed and each piece's ends swapped (gutter first, from the road edge outward, skirt last).
7. **UVs across** (u at each end):
   - Kerb top 0 (back) to 0.25 (face top); face 0.25 to 0.5 (lip); gutter 0.5 (lip) to 1 (road edge).
   - Strip, photo: u = 0 at the left strip's outer edge, 0.5 at either kerb back, 1 at the right strip's outer edge; the skirt has its outer u at both ends.
   - Strip, not photo: 0 at the outer edge, `(vergeWidth + STRIP_EXTRA - KERB_BACK) / 4` at the kerb back (a 4 m texture tile); skirt 0.
   - On the right side the u values travel with their points.
8. **UVs along**: kerb and gutter `v = s / POUR`; strip `v = (s - s_a) / (s_b - s_a)` across the chunk when photo, else `s / 4`. For row n of a closed plan, s = `plan.length`.

## Rules: meshes along the route (`buildKerbs`)

9. Chunks: `chunkRanges(plan)`, chunk ci = rows a..b inclusive (row i is sample `i mod n`). Skip a chunk with no kerb on either side in rows a..b. Otherwise call `stripMaterial(ci, a, b)` once (it may create a texture, so only for chunks that build).
10. Per side with any kerb in rows a..b: each of the five pieces is its own ribbon (so creases stay sharp): two vertices per row (first end then second end, at sample position + t along left, z from the profile), and between rows r and r + 1 one quad (first_r, second_r, second_r+1, first_r+1) when either row has a kerb on that side and the section key `` `${i mod n}:${side}` `` isn't in `noRamp`. That quad order is counter-clockwise seen from above for the flat pieces; the skirt then faces outward and the face toward the road, which is what's wanted. Don't emit vertices for rows no quad uses (bug 6).
11. So a kerb starts and ends as a slope over one section (one row k = 1, the next k = 0); `noRamp` removes that slope where a return or a network junction takes over (the kerb ends square there).
12. Per chunk, non-empty: `1ROAD_GUTTER_NNN` material `concrete`; `1KERB_NNN` material `concrete`; `1GRASS_STRIP_NNN` material from `stripMaterial`; NNN = `pad(ci)`. Normals: smooth per ribbon from face normals (the mesh builder's default).

## Rules: the strip photo (`stripPhotoTexture`)

13. Image 64 wide, H high (2048), RGBA. Row y is at `s = s_a + (y + 0.5) / H × (s_b - s_a)` (s_b = `plan.length` for row n); sample index i advanced from a while `i < b - 1` and the next row's s is at most s; position and width interpolated between rows i and i + 1, left vector from row i.
14. Columns: x < 32 is the left strip, `t = hw + KERB_BACK + span × (1 - (x + 0.5) / 32)` (x = 0 at the outer edge); x >= 32 the right, `t = -(hw + KERB_BACK + span × (x - 32 + 0.5) / 32)`; `span = vergeWidth + STRIP_EXTRA - KERB_BACK`, `hw` = interpolated half width. Colour from the raster at that point, or (0.33, 0.4, 0.24) where null; bytes = colour × 255, clamped and rounded (bug 5); alpha 255. Row 0 is the chunk's start (v = 0).

## Rules: kerb returns (`buildKerbReturns`)

15. For each junction (index ji), with s = `samples[seg]`, `v = left × side` (out from the road on that side), `u = s.tan`:
    - Skip if `dir · v < 0.8` (oblique: leave it square), or the sample is within 15 m of a roundabout (`inRoundabout(..., 15)`).
    - `half`, `e = surfaceHeight(s, side × half)` (see bug 3), `O = pos + v × half` (road edge at the mouth). Spacing as in markings (samples 1 minus 0).
16. For each corner c in (-1, 1):
    - *Where the road kerb is full height*: start at `first = seg + c × ceil(width / 2 / spacing)` and step by c while `first` is in range, has no kerb on that side, and `|first - seg| × spacing < width / 2 + 3 × RETURN_R`. No corner if it ran out of range or found no kerb. (No wrapping on loops: bug 7.)
    - `R = |s_first - s_seg| - width / 2`. No corner unless `2 <= R <= 3 × RETURN_R`.
    - Centre `C = O + u × c × (width / 2 + R) + v × R`. Direction at angle θ: `d(θ) = -v cos θ - u c sin θ`; `at(θ, r) = C + d(θ) × r`. θ = 0 is on the road's edge (at `first`), θ = 90 degrees on the side street's edge, r = R the gutter's outer line.
    - *A street really runs through the corner*: with `streetClearance`, test θ = 0, 15, ..., 90 degrees at r = 1.2, `(1.2 + R - KERB_BACK) / 2` and `R - KERB_BACK` (only r over 1); if any is under -0.3, no corner.
    - Add `` `${c > 0 ? first - 1 : first}:${side}` `` to `noRamp` (the road kerb's slope down toward the mouth).
    - `A = O + u × c × width / 2` (the mouth's corner on the road edge).
    - Photo cell: when `photo` is given and fewer than 256 cells are used, take the next cell (16 x 16 grid of 64 px cells in a 1024 px atlas) and paint the square C ± R, north up: pixel (px, py) at `x = C.x - R + (px + 0.5) / 64 × 2R`, `y = C.y + R - (py + 0.5) / 64 × 2R`; fallback colour as rule 14. Strip UV of a point p in that cell: `((cx + (p.x - (C.x - R)) / 2R) / 16, (cy + ((C.y + R) - p.y) / 2R) / 16)`.
    - `edge = streetEdge?.(ji, c, R)`. Kerb amount along the curve at fraction q (θ = q × 90 degrees): 1 if the edge has more than one point (the kerb carries on), else `min(1, (1 - q) / 0.25)` (it slopes away over the last quarter, where the side street begins).
    - Profile at q (kk = amount, `top = e + KERB_H × kk`), as (r, z) from the outside of the curve in:
      1. gutter: (R, e) to (R - GUTTER kk, e - GUTTER_DIP kk);
      2. kerb face: (R - GUTTER kk, e - GUTTER_DIP kk) to (R - (GUTTER + FACE_RUN) kk, top);
      3. kerb top: to (R - KERB_BACK kk, top);
      4. strip: (R - KERB_BACK kk, top) to (1, top + 0.02).
    - 8 steps of the curve. Per step and piece, one quad: (θa, first end), (θa, second end), (θb, second end), (θb, first end). UVs: u 0 at the first end, 1 at the second; v = θ × R / POUR (arc length over 3 m); the strip uses its photo cell UVs when it has a cell. Winding: the face (piece 2) faces out of the curve toward the road (wanted normal = (mid-arc point at R minus C, plus 0.3 up)); all others face up. Choose the winding whose geometric normal has a non-negative dot with the wanted one.
    - *Fill*: per step, a triangle A, at(θa, R), at(θb, R), all at `e - 0.01`, UVs (0, 0), (1, 0), (1, 1), wound to face up.
    - *Along the side street*: if the edge has more than one point, take the next column of the side atlas (64 columns of 32 x 512 px) when `streetPhoto` is given and columns remain, paint the run into it (rule 18), and build the run (rule 17) into the side gutter mesh, the return kerb mesh, and the side photo strip (with a column) or side grass strip (without).
17. **Run along a side street** (points p_i with `pos`, `out`, z = e_i): cumulative distance `dist_i`, `total`. Kerb amount `k_i = clamp((total - dist_i) / 4, 0, 1)` (slopes away over the last 4 m); `top = e_i + KERB_H k_i`; `P(o) = pos + out × o`. Pieces:
    1. gutter: P(0) at e to P(GUTTER k) at e - GUTTER_DIP k;
    2. face: to P((GUTTER + FACE_RUN) k) at top;
    3. top: to P(KERB_BACK k) at top;
    4. strip: to P(KERB_BACK + SIDE_STRIP) at top + 0.02.
    Quads between consecutive points: (a_i, b_i, b_i+1, a_i+1). UVs: the photo strip u = its column's bounds (col / 64 to (col + 1) / 64), v = dist / total; everything else u 0 to 1, v = dist / POUR. The face faces back at the street (wanted normal = (-out, 0.3)); others up.
18. **Side atlas column** for a run: row y (0..511) at distance `(y + 0.5) / 512 × total`, position interpolated along the run, `out` from the earlier point; column x (0..31) at offset `KERB_BACK + (x + 0.5) / 32 × SIDE_STRIP`. Fallback colour as rule 14. Pixel (y, col × 32 + x) of a 2048 x 512 image.
19. **Output**, in this order, each only if non-empty:
    - `1ROAD_GUTTER_RET` `concrete`;
    - `1KERB_RET` `concrete` (corner kerbs and the side-street kerbs);
    - `1GRASS_STRIP_RET`: `returns_photo` if a photo was given and any cell used, else `grass`;
    - `1STREET_RETFILL`: `fillMaterial`;
    - `1STREET_GUTTER_SIDE` `concrete`;
    - `1GRASS_STRIP_SIDE` `sidestrips_photo`;
    - `1GRASS_STRIP_SIDEG` `grass`.
    Plus `noRamp`, `atlas` (1024 x 1024) if a photo was given and cells were used, `sideAtlas` (2048 x 512) if any column was used.

## Names and surfaces other code relies on

- Physics keys from `surfaces.ini` (`acFiles.ts`): the route's gutters are `ROAD` (drivable, lap valid); kerbs `KERB` (friction 0.92, valid, some vibration); strips `GRASS`; the return fill and side-street gutters `STREET`.
- `clearance.ts` `KEEP_OFF` (`1KERB`, `1GRASS_STRIP`, `1ROAD_GUTTER`, `1STREET_GUTTER`…) strips triangles off the route's asphalt by these names.
- `paths.ts` `PATH_BLOCK` blocks footpaths on `1ROAD_GUTTER_RET`, `1KERB_RET`, `1STREET_RETFILL`, not on `1GRASS_STRIP_*`.
- `parkedCheck.ts` fails a parked car with a wheel on `\dKERB` or `\dGRASS`: gutters must stay `ROAD`/`STREET`, not `KERB`.
- `rainHollows.ts` treats `\d+(ROAD|STREET|KERB)_` as the surface water stands on (kerbs hold it in).
- `scripts/check/surface_check.py` counts `1KERB*` as drivable and expects road edge steps of kerb height (median 15 to 20 cm: KERB_H plus the gutter dip is 18 cm).
- `scripts/blender/render_track.ts` leaves `GUTTER`, `RETFILL` out of road heights.
- `cspConfig.ts` lists `strip_photo_?`, `sidestrips_photo`, `returns_photo` as ground photo materials and `concrete` as occluding/soaking.
- `groundCheck.ts` treats the `KERBS` group as a surface.

## Determinism

No randomness: same inputs, same meshes and images.

## Interplay

- **networkCore** ([road-network.md](road-network.md), phase 1): `kerbBlocked` is true on route rows inside a network junction; the network's `noRamp` keys are merged into `buildKerbs`' so the route kerb ends square at each cap; the junction's own kerbs (`1KERB_J…`, `1ROAD_GUTTER_J…`, `1GRASS_STRIP_J…`, from `dress.ts`) continue it with the same profile, and the old returns and fills are left out at junctions the network takes (it skips those mouths). In phase 2, kerbs become one continuous band per road boundary from the network, and returns come with the junction fillets, so `buildKerbReturns` and its photo atlases go. The cross-section (rule 6) is what carries over: keep it a small pure function others can call.
- **Kerbside bays** (`kerbside.ts`): bays start 0.1 m in from the asphalt edge, so their paint is on the asphalt, never on the gutter (which starts at the asphalt edge and runs outward). Parked cars in bays must not reach the kerb (`parkedCheck`). Kerbed sides get no edge line (markings), so bay marks never cross one.
- **Footpaths** (footpaths.md): read the strip from `KERB_BACK + 0.2` out to `vergeWidth + STRIP_EXTRA`; their crossovers sit on the laid-back kerb top (`e + KERB_H × (1 - LAYBACK)` at the kerb back), matching rule 6, and `laybacks` gives `drops`.
- **Terrain** (`terrain.ts`): reads `sample.kerb` and lifts the ground behind a kerb by `KERB_LIFT = BELOW_VERGE + KERB_H - 0.03` so it ends 3 cm under the strip, out to `half + vergeWidth + STRIP_EXTRA`.
- **Road mesh**: the gravel verge isn't built on a kerbed side (track.ts passes kerbs to `buildRoadMeshes` as verge gaps); the strip covers the one-section slopes too.

## Known bugs to fix, not copy

1. **Sample counts as distances.** The evidence window (±10 samples), gap and stub lengths (8 samples) assume 2 m spacing. Use ±20 m and 16 m, converted with the plan's spacing (identical at the default 2 m).
2. **Gap filling re-enables roundabout samples.** Only blocked samples are cleared after closing gaps; a short gap made by the roundabout exclusion gets filled. Clear roundabout samples again too.
3. **Return heights on slopes.** Every height in a return (gutter, kerb, fill) is offset from `e`, the road edge at the junction sample, though the corner reaches up to 3 × RETURN_R + width / 2 along the road. On a 5% grade that's a step of tens of centimetres where the return meets the road kerb at `first` (track.ts notes the ground coming through the fills by a metre at Cape Leeuwin). Take the base height per point from the road surface: the road edge height at the point's distance along (interpolated between `seg` and `first`), and for the fill the same at each vertex.
4. **Missing photo reads as "no kerb".** A null pixel anywhere in the evidence profile returns 0; it should be NaN (couldn't read), as untrusted samples are.
5. **Byte conversion** in the strip and atlas images: colour × 255 is assigned unclamped and truncated (a component over 1.0 wraps). Clamp to 0..255 and round.
6. **Unused vertices**: rows are emitted for every row of a chunk on a side even where no quad uses them. Emit only what's used (budget check counts vertices).
7. **Loops**: the smoothing window wraps, but gap closing, stub dropping and the return's search for `first` don't. Treat runs circularly on a closed plan and wrap the search.
8. **Return strip material** is `returns_photo` for every corner once any cell is used, so corners past the 256-cell limit get UV (0, 0) of the atlas. Put those in a grass strip mesh instead.
9. **Gap at the side-street run's start**: the run starts at the first street point at least R in, not at the return's end. Start it exactly at distance R (insert that point).

## Edge cases

- No evidence (null) and town everywhere: kerbs both sides except blocked samples and near roundabouts.
- Edge of town with no evidence: none.
- A kerb run under 16 m: dropped; a gap under 16 m between runs: filled (unless blocked).
- Kerb on one row only within a chunk: still built (two slope sections).
- Junction at an angle (`dir · v < 0.8`), near a roundabout, or with no kerb within reach: square end, no return.
- Return radius under 2 m or over 12 m: none on that corner.
- A side street passing through the corner area: none on that corner.
- No photo: strips are `grass` with tiling UVs; no atlases.
- Layback on one sample: the kerb dips over the two sections either side.

## Tests to write

1. Evidence on a synthetic 8 m street (asphalt 0.3 grey; north: a 0.45 m pale band at the edge then green grass; south: an edge line just inside the edge, asphalt beyond): north over 80% seen, south under 5%.
2. Plan from that evidence in the country: north over 90% on, south none.
3. All-NaN evidence: town gives kerbs everywhere except blocked samples (a side street mouth on the right: off there, on 20 m away); edge of town gives none.
4. A 10 m gap between kerb runs fills; a 10 m isolated run drops; a blocked sample inside a filled gap stays off; a roundabout sample inside a filled gap stays off (bug 2).
5. Meshes on a flat road at h = 10 with a kerb on the left only: names `1ROAD_GUTTER_…`, `1KERB_…`, `1GRASS_STRIP_…`; kerb top at road edge + KERB_H (edge = 10 - crown × half); gutter below the edge; every kerb vertex north of 3.9 m; kerb normals up or toward the road.
6. Layback across three samples: kerb top there at edge + KERB_H × (1 - LAYBACK), full height 20 m either side.
7. `noRamp` removes exactly the keyed section on that side.
8. Strip photo UVs: u 0 / 0.5 / 1 at the left outer edge / kerb backs / right outer edge; v 0 to 1 over the chunk. `stripPhotoTexture` reads the photo at the matching offsets (a striped synthetic photo).
9. Returns: a 7 m street north off the left side mid-road, kerb on the left except the mouth: `noRamp` has 2 keys; nodes exactly `1ROAD_GUTTER_RET`, `1KERB_RET`, `1GRASS_STRIP_RET`, `1STREET_RETFILL`; kerb points on both sides of the street, north of the road edge, outside the street and within 3 × RETURN_R of it; fill faces up; none on the unkerbed side.
10. Carrying on along a kerbed street: `1STREET_GUTTER_SIDE` and `1GRASS_STRIP_SIDEG` appear without a street photo; the kerb is full height 20 to 24 m up the street and reaches past 30 m.
11. An oblique street (dir at 45 degrees) and a street running through the corner (`streetClearance` negative there): no return.
12. On a 5% grade, the return's gutter meets the road gutter at `first` within 1 cm (bug 3).
13. Profile constants equal `network/dress.ts` `KERB` (or dress imports them).
14. Two runs give identical output.

## Could be deleted instead of rewritten (for Mac)

- **`buildKerbReturns` and the two atlases**, once networkCore phase 2 builds kerbs along every boundary (returns come free with the fillets). Until then, keep: without returns every side street mouth is a square kerb end.
