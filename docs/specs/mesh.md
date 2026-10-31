# Spec: mesh builder and the ENU to AC conversion (`src/core/mesh.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"; the file is listed in `UPSTREAM-FILES.txt`). Write the new module from this page without the old file open. Tests are written fresh from "Tests to write".

Not to be confused with `src/core/network/mesh.ts` (the fork's own junction core: `edgeMesh`, `junctionMesh`, `contourRings`), which is a different module and out of scope.

## What the module is for

Almost every generator builds its geometry in the build's local frame, **ENU**: x east, y north, z up, metres from the route's origin. This module gives them a small accumulator (`MeshBuilder`) to push vertices, UVs and triangles into, and converts the result into a `Kn5MeshNode` in **AC space** (X east, Y up, Z south; see docs/specs/kn5.md "Conventions") at the end, with normals either supplied by the caller or computed from the faces.

The conversion is a proper rotation (determinant +1), so a triangle wound counter-clockwise seen from above in ENU is still counter-clockwise seen from above (from +Y) in AC, and stays front-facing. Every generator relies on this: they wind faces counter-clockwise seen from the front, in ENU.

## Public API (keep these names and shapes)

### `type Vec3 = [number, number, number]`

A point or direction. Used in ENU by callers, and as the return type of `toAc`.

### `toAc(x: number, y: number, z: number): Vec3`

Returns `[x, z, -y]`. Pure, exported constant function.

### `class MeshBuilder`

Constructed with no arguments.

Public fields (callers read and in a few places write them directly, so they must stay plain public arrays, not getters returning copies):

| Field | Type | Notes |
| --- | --- | --- |
| `positions` | `number[]` (readonly reference) | ENU, three numbers per vertex, in push order. Callers read it to decide winding (`kerbs.ts`, `footpaths.ts`, `farmRoadsides.ts`, tests). |
| `uvs` | `number[]` (readonly reference) | Two per vertex. |
| `indices` | `number[]` (readonly reference) | Triangle list, three per triangle. `farmRoadsides.ts` swaps entries in place to flip triangles; `photoSea.ts`, `coast.ts`, `farm.ts`, `fences.ts` read `.length` to skip empty builders. |
| `normals` | `number[] \| null`, assignable | `null` (the default) means "compute from the faces in `toKn5`". Callers switch to explicit normals by assigning `[]` and then pushing three numbers (ENU) per vertex themselves (`carpark.ts`, `flags.ts`, `coast.ts`, `photoSea.ts`, `ChunkedMesh` in `meshKit.ts`), and some switch back by assigning `null` before `toKn5` (`raceDress.ts`, `sideStreets.ts`). |

Methods:

- **`get vertexCount(): number`**: `positions.length / 3`.
- **`vertex(p: Vec3, u: number, v: number): number`**: appends the position and UV, returns the new vertex's index (the vertex count before the call). Does not touch `normals`.
- **`tri(a, b, c): void`**: appends one triangle (indices as given).
- **`quad(a, b, c, d): void`**: appends two triangles `a, b, c` and `a, c, d`. Callers pass the corners counter-clockwise seen from the quad's front.
- **`toKn5(name: string, material: string, extra: Partial<Kn5MeshNode> = {}): Kn5MeshNode`**: see "Conversion" below.

No other members are used outside the module. The face-normal routine is private.

### Call sites (from `grep`, 31 Oct 2026)

- `MeshBuilder`: `src/core/` raceDress, photoSea, coast, roadMesh, carpark, roundabout, parkedCars, jettyTrain, track, terrain, scenery (type only), jetty, trafficLights, flags, meshKit, specHouse, backdrop, fences, shops, kerbs, footpaths, furniture (type), lots (type), utilities, farmRoadsides, markings, parkedPlacement, armco, paths, buildings (type), farm, kerbside (type); `scripts/check/make_test_layer.ts`; tests padClear, groundFixes, lots, parkedPlacement, gltf, poleSpot, flags, terrain, pathGround, landmarkGround, scenery, sceneGround.
- `Vec3`: raceDress, roadMesh, carpark, parkedCars, jettyTrain, jetty, trafficLights, flags, specHouse, fences, footpaths, lots, cspConfig, utilities, farmRoadsides, markings, buildings; test jettyTrain.
- `toAc`: track, jettyTrain, treeModels, aiLine.
- `toKn5` extras passed today: `castShadows` (about 29 call sites), `renderable` (7), plus extras forwarded from variables (`raceDress.ts`). The old module spreads `extra` last, so an extra can override any field.
- Chunking helpers live elsewhere and depend on this class: `ChunkedMesh` in `meshKit.ts` (new builder when the next item would pass `MAX_MESH_VERTICES` minus a headroom, explicit normals on), and hand-rolled 60000-vertex splits in `fences.ts`, `farm.ts` and others. They need only `vertexCount`, `normals` and `new MeshBuilder()`.

## Rules

### Building

1. Arrays only grow through `vertex`, `tri` and `quad` (plus callers' direct pushes and swaps described above). No deduplication, no reordering, no validation at push time (callers push indices before or after the vertices exist).
2. `vertex` returns indices from 0 upward, consecutive.

### Conversion (`toKn5`)

3. If `vertexCount > MAX_MESH_VERTICES` (65535, imported from `kn5.ts`), throw `Error` with the message `"<name>: <count> vertices exceeds kn5 limit"`. Exactly 65535 is allowed. Callers' tests match "exceeds" in the message only loosely, but keep the name and count in it.
4. Normals in ENU:
   - **Explicit** (`normals` is an array): used as given, not normalised.
   - **Computed** (`normals` is `null`): for every triangle `(a, b, c)` in index order, the unnormalised cross product `(pb - pa) x (pc - pa)` (computed in double precision from the ENU positions) is added to the normal of each of its three vertices; so the result is area-weighted. The accumulator is a `Float32Array` (each addition rounds to float32; keep this for byte-identical goldens). Then each vertex normal is divided by its length (`Math.hypot` of the three float32 components); a zero length divides by 1, so a vertex used by no triangle (or only by zero-area triangles) gets `(0, 0, 0)`.
5. Output arrays, one entry per vertex in order:
   - `positions`: `Float32Array`, `toAc` of each ENU position.
   - `normals`: `Float32Array`, `toAc` of each ENU normal (the same rotation; no renormalising).
   - `uvs`: `Float32Array` copy of `uvs`.
   - `indices`: `Uint16Array` copy of `indices`.
6. Returned object: `{ kind: "mesh", name, positions, normals, uvs, indices, material, ...extra }`. No `tangents` (the kn5 writer computes them). No other fields unless `extra` adds them; `extra` wins over every field, including the arrays.
7. `toKn5` does not modify the builder and can be called more than once (test `gltf` converts the same builder three times). Every call returns fresh typed arrays.

## Bugs and rough edges (fix, don't copy)

- **Explicit normals of the wrong length** are not checked: missing entries become `NaN` in the output (`Float32Array.from` of a short array, then reads past its end). Throw instead, naming the mesh, when `normals.length !== positions.length`. Equally `uvs.length !== vertexCount * 2` should throw here rather than reach the kn5 writer.
- **Indices out of range** (>= vertexCount, or negative) silently wrap in the `Uint16Array` or are caught only later by the kn5 writer. Throw in `toKn5`, naming the mesh.
- **Index count not a multiple of 3**: the face-normal loop reads past the end. Throw.
- Unused-vertex normals of `(0, 0, 0)`: keep (goldens depend on it, and the kn5 writer handles them), but document it.

These checks only add errors for input that is already broken, so they don't change the bytes of any valid build.

## Edge cases

- Empty builder: `toKn5` returns empty arrays. Callers usually skip empty builders (`indices.length === 0`), but the conversion must not throw.
- Vertices with no triangles (callers sometimes push spare vertices): allowed.
- Degenerate (zero-area) triangles: contribute nothing to computed normals.
- Large coordinates: positions are stored as float32 (about 1 mm at 10 km); the build keeps a local origin for this reason.

## Tests to write

1. `toAc(1, 2, 3)` is `[1, 3, -2]`; it has determinant +1 (apply to the three unit axes).
2. `vertex` returns 0, 1, 2...; `vertexCount` follows; `quad(0,1,2,3)` appends `0,1,2,0,2,3`; `tri` appends as given.
3. A horizontal ENU quad wound counter-clockwise from above: every computed AC normal is `(0, 1, 0)`; positions are `toAc` of the inputs.
4. A vertical quad facing east: normals `(1, 0, 0)` in AC; facing north: `(0, 0, -1)`.
5. Area weighting: a vertex shared by a large triangle facing up and a small one facing east leans mostly up (compare against the hand-computed weighted sum).
6. An unused vertex gets `(0, 0, 0)`; no `NaN` anywhere.
7. Explicit normals are rotated but not normalised (pass `(0, 0, 2)`, get `(0, 2, 0)`).
8. Switching back to `null` after pushing explicit normals computes from faces.
9. Wrong-length normals, bad index, and a non-multiple-of-3 index list each throw with the mesh name.
10. 65535 vertices convert; 65536 throw with the name and the count in the message.
11. `extra` fields appear on the node (`castShadows: false`, `renderable: false`) and override defaults; calling `toKn5` twice gives equal, independent arrays and leaves the builder unchanged.
12. Output types: `Float32Array` for positions, normals, uvs; `Uint16Array` for indices; `kind` is `"mesh"`; no `tangents` key.

### Golden fixtures (capture from the old module before deleting it)

Write a small one-off script that builds a few fixed meshes with the old `MeshBuilder` and saves each `toKn5` result as JSON (typed arrays as plain number lists, which round-trip float32 exactly when written with full precision) under `test/fixtures/mesh/`:

- a unit quad (computed normals);
- a closed box made of 6 quads and a fan of 5 `tri`s sharing a centre vertex (area weighting, shared vertices);
- a mesh with one unused vertex and one zero-area triangle;
- a mesh with explicit, non-unit normals;
- a 2 km offset copy of the box (float32 rounding of large coordinates).

The new module must reproduce each byte for byte (compare the float32 bit patterns). Then, as the strongest check, run the existing suites that build whole tracks (`test/track.test.ts`, `test/scenery.test.ts`, `test/roundabout.test.ts`) and the kn5 round-trip of the accepted Busselton build (docs/specs/kn5.md test 20): a full build with the new module should give an identical base `.kn5` (lead runs the build; see the brief).

## Possibly unused or duplicated (for Mac to decide)

- `src/core/treeModels.ts` has its own small builder class with the same `positions` / `normals` / `uvs` / `quad` shape but explicit normals always. It could use `MeshBuilder` with `normals = []`; not part of this rewrite.
- Nothing in this module is unused.

## Rewrite notes (31 Oct 2026)

Rewritten from this page. Goldens: `test/fixtures/golden-mesh/mesh.json` (float32 bit patterns, since JSON drops the sign of `-0`; the conversion writes `-0` for a zero north component and the kn5 bytes keep it), checked by `test/golden.test.ts`. The input checks under "Bugs and rough edges" are in (wrong-length normals or uvs, out-of-range indices, a partial triangle all throw, naming the mesh); they don't change the output of any valid mesh.
