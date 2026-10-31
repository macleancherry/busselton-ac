# Spec: AI line writer and reader (`src/core/aiSpline.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). Write the new module from this page and the public format notes below, without the old file open. Tests are written fresh from the "Tests" list.

## What the module is for

Each layout ships `ai/fast_lane.ai` (or `<layout>/ai/fast_lane.ai`): the line the AI drives and the game uses for track progress, the minimap position and pit logic. `src/core/aiLine.ts` (fork code) works out the points and their values; this module only turns a list of points into the version 7 binary file, adds the spatial lookup grid AC needs, and reads files back for the checks and tests.

The lookup grid is required, not optional: it's how AC finds the nearest stretch of line to a car. (AC's "TRACK :: NO POSITION DATA FOUND" warning is not about the grid: Kunos's own Mugello and ks_barcelona log it too, and it stayed with the grid in place; see src/core/pitLane.ts.)

## Public API (keep these names and shapes)

### `AiPoint` (type)

One point on the line. All fields are required when writing.

| Field | Meaning |
| --- | --- |
| `position: [x, y, z]` | AC world space, metres (X east, Y up, Z south) |
| `distance` | Metres from the first point, along the line |
| `speed` | Target speed, m/s |
| `gas`, `brake` | Pedal hints, 0 to 1 |
| `radius` | Turn radius, metres (large on straights) |
| `sideLeft`, `sideRight` | Distance from the line to the left and right road edges, metres |
| `camber` | Bank angle, radians, magnitude; the sign is carried by `direction` |
| `direction: 1 \| -1` | Which way the camber leans |
| `normal: [x, y, z]` | Surface normal at the point |
| `length` | Length of the segment to the next point, metres |
| `forward: [x, y, z]` | Unit direction of travel |
| `grade` | Slope along the line, rise over run |

### Functions

- **`writeFastLaneAi(points: AiPoint[]): Uint8Array`**: the version 7 file with the lookup grid.
- **`readFastLaneAi(data: Uint8Array): AiPoint[]`**: the points back. Throws on anything but version 7.
- **`aiGrid(points: { position: [x, y, z] }[]): { max: [x, 0, z]; min: [x, 0, z]; cells: number[][][] }`**: the lookup grid on its own, so tests can check its layout. `cells[a][b]` is the list of point indices for the cell `a` steps along X and `b` steps along Z. Only tests call it today; keep it exported for them.

### Constants

- `AI_SPLINE_VERSION` (7) is exported but nothing outside the module uses it. It can be private.

### Call sites (from `grep`, 31 Oct 2026)

- `writeFastLaneAi`: `src/core/track.ts`, `src/core/layouts.ts`; tests `aiGrid`, `formats`.
- `readFastLaneAi`: `src/core/layouts.ts` (re-reads a written line to cut or re-anchor it for a layout), `scripts/check/layout_check.ts`, `scripts/check/dump_surface.ts`; tests `aiGrid`, `formats`, `layouts`, `roundabout`, `track`.
- `aiGrid`: tests `aiGrid`, `formats`.
- `AiPoint` (type): `src/core/aiLine.ts`, `cruise.ts`, `landmarkShots.ts`, `layouts.ts`, `scripts/check/dump_surface.ts`; tests `aiGrid`, `cruise`, `landmarkShots`, `layouts`, `formats`.
- Independent reader of the same format (fork code, Python): `scripts/check/ai_grid.py`. Good for cross-checking.

## The file format (version 7)

All numbers little-endian; i32 = signed 32-bit integer, f32 = IEEE single float.

### Header

| Field | Type | We write |
| --- | --- | --- |
| version | i32 | 7 |
| point count | i32 | number of points |
| lap time | i32 | 0 (Kunos's recorder fills it; nothing reads it) |
| sample count | i32 | 0 |

### Points (point count records, 20 bytes each)

| Field | Type | We write |
| --- | --- | --- |
| position | f32 x3 | `position` |
| distance along | f32 | `distance` |
| id | i32 | the point's index, 0-based |

### Extra data

i32 extra count (equal to the point count), then that many records of 18 f32 (72 bytes) each, in this order:

| # | Field | We write |
| --- | --- | --- |
| 1 | speed | `speed` |
| 2 | gas | `gas` |
| 3 | brake | `brake` |
| 4 | obsolete lateral g | 0 |
| 5 | radius | `radius` |
| 6 | side left | `sideLeft` |
| 7 | side right | `sideRight` |
| 8 | camber | `camber` |
| 9 | direction | `direction` as a float, 1 or -1 |
| 10 to 12 | normal | `normal` |
| 13 | length | `length` |
| 14 to 16 | forward vector | `forward` |
| 17 | tag | 0 |
| 18 | grade | `grade` |

AssettoServer reads camber times direction as the signed bank, which is why both are stored.

### Lookup grid

i32 has-grid flag. 0 means no grid follows (we write that only for an empty point list). When 1:

| Field | Type | Notes |
| --- | --- | --- |
| max extreme | f32 x3 | largest x and z of the points; y written as 0 |
| min extreme | f32 x3 | smallest x and z; y written as 0 |
| neighbours considered | i32 | 10 |
| sampling density | f32 | cell size in metres: 10 |
| outer count | i32 | cells along X |
| then for each outer item: inner count | i32 | cells along Z |
| then for each cell: index count | i32 | then that many i32 point indices |

Note the order: max before min.

### How the grid is laid out (what Kunos's own files do)

Observed in Kunos's lines (ks_black_cat_county, magione) with `scripts/check/ai_grid.py` on the workstation:

- Cells are 10 m square in the X-Z plane, starting at the min extreme.
- Cells along X: the whole number of 10 m steps in the X extent, rounded down, at least 1. Same for Z. (So a strip under 10 m at the far edges isn't covered by its own cell; AC copes.)
- Every cell lists the 10 points nearest to the cell's centre (centre = min + (index + 0.5) x 10 m on each axis), by horizontal distance (x and z only), nearest first. Ties go to the lower point index. With fewer than 10 points, every point is listed.
- Every cell is filled, including cells far from the line.

**Measure distances from the stored (f32) positions.** The old writer measured from the caller's double-precision positions, so near-ties between two points could come out in a different order once the file was read back and rewritten. On the accepted Busselton build (31 Oct 2026), three of the four lines don't round-trip byte for byte: 10 cells or fewer per line differ, and in every one the swapped points are less than 0.03 mm apart in distance to the cell centre. Rounding each position to f32 first (what the file and AC actually hold) makes read-then-write stable. Do that in the rewrite.

Speed matters: a free-roam line can have several thousand points and a 5 x 5 km area has 250,000 cells. Checking every point for every cell is too slow; use a spatial index (a k-d tree, or a bucket grid searched outward ring by ring) that returns the exact 10 nearest. The result must match a brute-force search exactly, ties included.

## Behaviour

### Writing

- Header, points (id = index), extra records with the fixed zeros above, then the grid.
- An empty list writes a valid file: header with count 0, extra count 0, has-grid 0.
- One point: nx = nz = 1, one cell listing point 0.
- Values are written as given; the writer doesn't check them. (NaN in a position would break the grid and AC: throwing on a non-finite position is a reasonable addition. Decide and test.)

### Reading

- Version must be 7, else throw "unsupported version".
- Read the header (lap time and sample count are dropped), the points (the id is dropped; the point's place in the list is its index), and the extra records.
- Throw if the extra count doesn't equal the point count.
- `direction` comes back as -1 if the stored float is negative, otherwise 1.
- The obsolete lateral g and tag values are dropped.
- If the grid flag is non-zero, read past the whole grid (it isn't returned; the writer rebuilds it).
- Throw if bytes are left over, or if the data runs out early.

`readFastLaneAi(writeFastLaneAi(p))` gives back `p` to f32 precision.

## Edge cases and limits

- All points on one line along X or Z: the extent in the other axis is 0, so there is 1 cell that way.
- Duplicate positions (a closed loop's last point on the first): ties broken by index, as above.
- Negative coordinates: fine; the grid starts at the min extreme.
- Points are stored as f32: positions round to about 1 mm at 10 km from the origin.
- Kunos files carry real lap time, sample count, obsolete lateral g and tag values. The reader must accept them (it ignores them).
- A Kunos file with has-grid 0 must still read.

## Possibly unused (for Mac to decide)

- `AI_SPLINE_VERSION` as an export.
- Nothing else: the reader is used by the layout code at build time, not only by tests.

## Tests (write fresh)

Format:
1. Header bytes: 7, count, 0, 0.
2. Point record at offset 16 is 20 bytes: position, distance, id (= index).
3. Extra count equals the point count; each extra record is 72 bytes in the order above, with obsolete lateral g and tag 0 and direction stored as 1.0 or -1.0.
4. Total size equals 16 + 20n + 4 + 72n + grid size, computed independently of the reader.

Round trip:
5. A 50-point synthetic line with every field set to distinct values comes back equal to f32 precision, including direction -1.
6. An empty list writes and reads back as an empty list.

Grid:
7. Extremes: max and min hold the points' largest and smallest x and z, y is 0; max comes first.
8. Cell counts: for a line spanning 95 m by 31 m, 9 cells along X and 3 along Z. For a line under 10 m each way, 1 by 1.
9. Neighbours 10 and density 10 are written.
10. Every cell lists min(10, n) indices, nearest first by horizontal distance to the cell centre, ties to the lower index: compare against a brute-force search on a random 2,000-point line, every cell.
11. A 3-point line: every cell lists all 3.
12. Large input stays fast: 8,000 points over 3 x 3 km writes in under a few seconds.

Reading foreign files:
13. A hand-built file with non-zero lap time, sample count, lateral g and tag reads, and those values are ignored.
14. A hand-built file with has-grid 0 reads.
15. Version 6 or 8 throws. Mismatched extra count throws. Trailing bytes throw. Truncated data throws.

Files our builds make (skip when absent; path from an env var, defaulting to `out/accepted/busselton.zip`):
16. Read every `*/ai/fast_lane.ai` in the accepted Busselton zip: no throw, distances increase along the line, forward vectors are unit length.
17. Write the points back: everything before the grid is byte-identical to the original file. The grid has the same extremes, counts and cell sizes, and each cell holds the same indices except where two points are within 1 mm of the same distance (the old writer's near-tie order; see "Measure distances from the stored positions"). A second read-then-write of the new output is byte-identical to the first.
18. `python3 -I scripts/check/ai_grid.py` on a written file reports 10 m cells, neighbours 10 and full cells.
19. Before the old module is deleted, save one or two small golden `.ai` files it writes from fixed points in `test/fixtures/`, using positions that are already exact f32 values (e.g. multiples of 0.25 m) so the f32 rounding change can't matter; the new writer must reproduce them byte for byte.

In-game check (workstation): `scripts\windows\run-test.ps1 <slug>` with a build from the new writer: the AC log loads the line ("Loading AI Spline", "LOADING GRID DATA", the right "TRACK LENGTH"), and the AI completes a lap.

## Sources

- Content Manager / AcTools (gro-ove), `AcTools/AiFile/AiSpline.cs`, `AiPoint.cs`, `AiPointExtra.cs`, `AiSplineGrid.cs`: version 7 header, point and extra record layouts (field names: Speed, Gas, Brake, ObsoleteLatG, Radius, SideLeft, SideRight, Camber, Direction, Normal, Length, ForwardVector, Tag, Grade), and the grid's fields (MaxExtreme, MinExtreme, NeighborsConsideredNumber, SamplingDensity, nested item lists). https://github.com/gro-ove/actools (raw: https://raw.githubusercontent.com/gro-ove/actools/master/AcTools/AiFile/AiSpline.cs)
- AssettoServer, `AssettoServer/Server/Ai/Splines/FastLaneParser.cs` (`FromFileV7`): the same layout from a second, independent reader, and camber x direction as the signed bank. https://github.com/compujuckel/AssettoServer
- Kunos grid layout as observed: `scripts/check/ai_grid.py` (fork code) run on ks_black_cat_county and magione; see that script's docstring and the workstation report that introduced the grid.
