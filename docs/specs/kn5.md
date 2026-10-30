# Spec: kn5 model writer and reader (`src/core/kn5.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). Write the new module from this page and the public format notes below, without the old file open. Tests are written fresh from the "Tests" list.

## What the module is for

Every model the build ships to Assetto Corsa is a `.kn5`: the base track (`<slug>.kn5`, about 160 MB for Busselton with textures inside), the layout dummy files (`layout_<id>.kn5`), and landmark and Blender layers (`lm_<name>.kn5`, `layer_*.kn5`). This module turns an in-memory model (textures, materials, a node tree of group nodes and meshes) into kn5 bytes, and reads kn5 bytes back into the same model shape. The reader is used by the checks, the Blender exporters and the landmark polish script, so it must read the base track at full size, not just test files.

It also holds a few small helpers the rest of the code uses to build node transforms.

## Public API (keep these names and shapes; the rest of the repo calls them)

### Types

- **`Kn5Model`**: `{ textures: Kn5Texture[]; materials: Kn5Material[]; root: Kn5GroupNode }`.
- **`Kn5Texture`**: `{ name: string; data: Uint8Array }`. `data` is a complete image file (PNG or DDS bytes), stored as is.
- **`Kn5Material`**: `{ name; shader; blendMode?; alphaTested?; depthMode?; properties; textures; registers? }`.
  - `shader`: the Kunos shader name, e.g. `ksPerPixel`, `ksPerPixelAT`, `ksPerPixelNM`, `ksMultilayer_fresnel_nm4`.
  - `blendMode`: number, default opaque (see `BlendMode`).
  - `alphaTested`: boolean, default false.
  - `depthMode`: number, default normal (see `DepthMode`).
  - `properties`: list of shader properties. Each has a `name` and optional values `a` (one number), `b` (two), `c` (three), `d` (four). Missing values are written as zeros. The property type is currently exported as `Kn5ShaderProperty`, but nothing outside the module imports it by name.
  - `textures`: a record from shader slot name (`txDiffuse`, `txNormal`, `txMaps`, `txDetail`, `txMask`, `txDetailR` and so on) to a texture name in `Kn5Model.textures`.
  - `registers`: filled in by the reader only: the register number each slot was stored with. Ignored by the writer.
- **`Kn5GroupNode`**: `{ kind: "node"; name; transform: number[16]; children: Kn5Node[] }`.
- **`Kn5MeshNode`**: `{ kind: "mesh"; name; positions: Float32Array; normals: Float32Array; uvs: Float32Array; tangents?: Float32Array; indices: Uint16Array; material: string; castShadows?; visible?; transparent?; renderable?; layer?; lodIn?; lodOut? }`.
  - `positions`, `normals`, `tangents`: three floats per vertex. `uvs`: two per vertex.
  - `material`: a material *name* (resolved to an index on write, back to a name on read).
  - Defaults when writing: `castShadows` true, `visible` true, `transparent` false, `renderable` true, `layer` 0, `lodIn` 0, `lodOut` 0.
  - `renderable: false` is how the build makes invisible physics walls (`1WALL_*`). `lodOut` is set by `cull.ts` (metres; 0 means no limit). `transparent` is set for the sea and shore foam.
- **`Kn5Node`**: `Kn5GroupNode | Kn5MeshNode`.

### Constants

- **`MAX_MESH_VERTICES`** = 65535. Imported by `mesh.ts`, `scenery.ts`, `shops.ts`, `parkedCars.ts` to split meshes before they reach the writer. Indices are 16-bit, so no mesh can have more.
- **`IDENTITY`**: the 16-number identity transform.
- **`BlendMode`**: `{ Opaque: 0, AlphaBlend: 1, AlphaToCoverage: 2 }` (used by `photoSea.ts`).
- **`DepthMode`**: `{ Normal: 0, NoWrite: 1, Off: 2 }` (used by `photoSea.ts`).

These values are Kunos's enumerations as the community tools name them (Content Manager's `Kn5MaterialBlendMode` and `Kn5MaterialDepthMode`).

### Functions

- **`writeKn5(model: Kn5Model): Uint8Array`**: the kn5 file. Throws on invalid input (see "Validation").
- **`readKn5(data: Uint8Array): Kn5Model & { version: number }`**: parses a kn5 into the model shape. The output must be valid input to `writeKn5` (the landmark polish script reads the base and writes layers from it).
- **`frameTransform(position, forward, up = [0, 1, 0]): number[]`**: a transform whose local Z axis points along `forward`, local Y as close to `up` as possible, local X completing a right-handed frame (X = up x Z, normalised; then Y = Z x X), placed at `position`. This is how AC reads spawn, pit and timing dummies: Z is the driving direction, Y is up.
- **`translation(position): number[]`**: identity rotation, placed at `position`. **No callers** (see "Possibly unused").
- **`computeTangents(...)`**: exported but only used inside the module. It doesn't need to stay public.

### Call sites (from `grep`, 31 Oct 2026)

- `writeKn5`: `src/core/track.ts`, `src/core/layouts.ts`, `scripts/blender/make_layer.ts`, `scripts/polish/landmarks.ts`, `scripts/check/make_test_layer.ts`; tests `formats`, `gltf`, `landmarkLayer`.
- `readKn5`: `scripts/blender/render_track.ts`, `scripts/blender/export_base.ts`, `scripts/polish/landmarks.ts`, `scripts/check/layout_check.ts`, `dump_surface.ts`, `meshes_at.ts`, `budget.ts`; tests `armco`, `farmRoadsides`, `formats`, `gltf`, `landmarkLayer`, `layouts`, `roundabout`, `scenery`, `streets`, `track`, `trafficLights`, `unsealed`, `zones`.
- `frameTransform`: `src/core/track.ts`, `layouts.ts`, `jettyTrain.ts`; tests `challengeFiles`, `timeTrial`, `formats`.
- `IDENTITY`: `src/core/track.ts`, `layouts.ts`, `gltf.ts`, `landmarkLayer.ts`, `src/ui/preview.ts`, `scripts/check/make_test_layer.ts`; tests `gltf`, `rainHollows`, `formats`.
- `MAX_MESH_VERTICES`: `mesh.ts`, `scenery.ts`, `shops.ts`, `parkedCars.ts`.
- `BlendMode`, `DepthMode`: `photoSea.ts`; test `photoSea`.
- Types (`Kn5MeshNode`, `Kn5GroupNode`, `Kn5Node`, `Kn5Material`, `Kn5Texture`, `Kn5Model`): about 45 files in `src/core`, `src/ui/preview.ts`, `scripts/check` and `test`. Keep the field names exactly.
- `docs/realism.md` names the texture register table by its old identifier; update that sentence after the rewrite.

## The file format

All numbers little-endian. A *string* is a u32 byte count followed by that many bytes (names are ASCII in practice; write UTF-8). A *bool* is one byte (0 or 1). Floats are IEEE 754 single precision.

### Header

| Field | Type | Notes |
| --- | --- | --- |
| magic | 6 bytes | ASCII `sc6969`, no length prefix |
| version | u32 | We write 5. Kunos files are 5 or 6 |
| extra | u32 | Present only when version > 5. Readers skip it |

### Textures

u32 count, then for each texture:

| Field | Type | Notes |
| --- | --- | --- |
| active | i32 | Write 1. Readers ignore it |
| name | string | Referenced by material texture mappings |
| size | u32 | Byte count of the image |
| image | bytes | A whole PNG or DDS file |

### Materials

u32 count, then for each material:

| Field | Type | Notes |
| --- | --- | --- |
| name | string | |
| shader | string | |
| blend mode | u8 | 0 opaque, 1 alpha blend, 2 alpha to coverage |
| alpha tested | bool | |
| depth mode | i32 | 0 normal, 1 read-only (no write), 2 off |
| property count | u32 | |
| properties | | each: string name, f32 a, f32 x2 b, f32 x3 c, f32 x4 d (always all ten floats) |
| mapping count | u32 | |
| mappings | | each: string slot name, u32 register, string texture name |

Materials are referenced from meshes by their index in this list.

**Texture registers.** Each mapping carries the shader register the slot is bound to. The game binds by this number, so it must match what the shader declares, not the slot's position in the list. The registers our materials need (as the Kunos shaders declare them; CSP's recreated shader sources are the readable reference):

| Register | Slots |
| --- | --- |
| 0 | txDiffuse |
| 1 | txNormal, txMask, txVariation |
| 2 | txMaps, txDetailR |
| 3 | txDetail, txDetailG |
| 4 | txNormalDetail, txDetailB |
| 5 | txDetailA |
| 6 | txDetailNM |

A slot not in the table gets its position in the material's mapping list (0-based). That fallback can collide with a known slot; nothing we build hits it today, but a fresh design might prefer to throw on an unknown slot. Decide in the rewrite and test it.

### Node tree

Written depth first, starting with the root. Every node starts with:

| Field | Type | Notes |
| --- | --- | --- |
| class | u32 | 1 = group node, 2 = mesh, 3 = skinned mesh (cars only) |
| name | string | |
| child count | u32 | Children follow immediately after this node's own data, depth first |
| active | bool | Write true |

**Class 1 (group node)** then has a 4x4 float matrix (16 x f32). Element order: 0 to 2 are the local X axis in parent space, 4 to 6 local Y, 8 to 10 local Z, 12 to 14 the position, 3, 7, 11 are 0 and 15 is 1 (row-vector convention: a point times the matrix). Group nodes are also AC's *dummies*: `AC_START_0`, `AC_PIT_0`, `AC_TIME_0_L` and the rest are group nodes with no children.

**Class 2 (mesh)** then has:

| Field | Type | Notes |
| --- | --- | --- |
| cast shadows | bool | |
| visible | bool | |
| transparent | bool | |
| vertex count | u32 | At most 65535 (indices are u16) |
| vertices | 44 bytes each | f32 x3 position, f32 x3 normal, f32 x2 uv, f32 x3 tangent |
| index count | u32 | A multiple of 3 |
| indices | u16 each | Triangle list |
| material index | u32 | Into the material list |
| layer | u32 | Write 0 unless given |
| lod in | f32 | Metres; 0 = no near limit |
| lod out | f32 | Metres; 0 = no far limit |
| sphere centre | f32 x3 | Bounding sphere of the vertices |
| sphere radius | f32 | |
| renderable | bool | false = physics only, never drawn |

Meshes we write always have child count 0.

**Class 3 (skinned mesh)** carries bones and vertex weights. Track files don't use it. The reader may throw a clear "unsupported node class" error on it.

### Conventions the rest of the build relies on

- Coordinates are AC world space, metres: X east, Y up, Z south (so north is -Z).
- Triangles wind counter-clockwise seen from the side the normal faces.
- UV v = 0 is the top row of the image.
- Physics meshes are named with a digit then a surface key (`1ROAD_...`, `1WALL_...`); the writer doesn't care, but tests should keep such names intact.

## Behaviour

### Writing

1. Magic, version 5, no extra field.
2. Textures in the order given, each marked active.
3. Materials in the order given, defaults filled in, registers from the table.
4. The node tree from `root`, depth first, each node marked active.
5. For each mesh:
   - Tangents: use `tangents` when given. Otherwise compute one per vertex: the direction of increasing u across the triangles that share the vertex (accumulated over those triangles), made perpendicular to the vertex normal and normalised. Where the UVs give no direction (zero-area UV triangles), use any unit vector perpendicular to the normal. Output must never contain NaN.
   - Bounding sphere: must contain every vertex. To keep output byte-for-byte stable across the rewrite (useful for golden-file tests), use the centre of the axis-aligned bounding box and the distance to the farthest vertex from that centre as the radius. A mesh with no vertices: write a zero sphere (and see "Edge cases").
6. Return exactly the bytes written (no padding).

The writer must cope with the base track: about 160 MB of output, most of it texture bytes. Grow the output buffer geometrically, or size it up front, so the write stays linear.

### Validation (throw with a message naming the node, material or texture)

- Two textures with the same name.
- Two materials with the same name.
- A material mapping to a texture name that isn't in the model.
- A mesh naming a material that isn't in the model.
- A mesh with more than 65535 vertices.
- A mesh whose `normals` or `uvs` length doesn't match its vertex count (and `tangents`, when given).
- An index count that isn't a multiple of 3.
- An index that is >= the vertex count.
- A group node transform that doesn't have 16 numbers.

### Reading

1. Check the magic; throw "not a kn5" otherwise.
2. Read the version; skip the extra u32 when version > 5. Return the version in the result.
3. Read textures (ignore active), copying each image's bytes out so the result doesn't pin the input buffer.
4. Read materials, recording each mapping's register in `registers` and the texture name in `textures`.
5. Read the node tree. Group nodes come back with their 16 numbers and children. Meshes come back with typed arrays, the material *name*, and the flags, layer and LOD values. The stored tangents are returned. The bounding sphere and the active flags are read and dropped.
6. Throw if the root isn't a group node, if a node class other than 1 or 2 appears, if the data runs out early, or if bytes are left over after the tree.

Performance: the current reader reads the 160 MB base in under a second (checked 31 Oct 2026). The rewrite should stay within a few seconds and not need more than about twice the file size in memory. Read vertex data straight into typed arrays; don't build a small array per vertex.

### frameTransform

- Normalise `forward`. X = normalise(up x forward). Y = forward x X.
- If `forward` is parallel to `up` (X can't be found), pick X = +X world (or any unit vector perpendicular to forward) and *then* derive Y from it, so the result has no NaN. (The old code derived Y before falling back, so this case gave NaN in Y. Don't carry that over.)
- A zero-length `forward` is a caller error: throw, or return an identity rotation at `position`. Pick one and test it.
- Layout as in "Class 1" above: X axis in 0 to 2, Y in 4 to 6, Z in 8 to 10, position in 12 to 14, 15 = 1.

## Edge cases and limits

- Empty model (no textures, no materials, a root with no children): valid, round-trips.
- Mesh with zero vertices and zero indices: the build normally drops these, but the writer shouldn't crash. Either write it (zero sphere) or reject it; test whichever you choose.
- Material with no texture mappings and no properties: valid.
- Unicode in names: written as UTF-8 and read back the same.
- Texture image bytes are opaque to this module: no checking that they're valid PNG or DDS.
- Sizes are u32: textures, strings and counts above 4 GB are impossible in practice; JS buffers cap well below that anyway.
- Floats are stored as f32, so positions round-trip to f32 precision (about 1 mm at 10 km from the origin; the build keeps a local origin for this reason).

## Possibly unused (for Mac to decide)

- `translation()`: no callers anywhere in `src`, `scripts` or `test`. Delete instead of rewriting.
- The exported magic and version constants: no outside users. Keep them private.
- `computeTangents` and the register table: only used inside the module. Keep them private.
- Class 3 (skinned mesh) support: not needed for tracks.

## Tests (write fresh)

Format:
1. Output starts with ASCII `sc6969` then u32 5; no extra field.
2. Header, texture and material bytes at known offsets for a tiny hand-made model (one 4-byte texture, one material with one property and one mapping): check every field by offset against the table above, independently of the reader.
3. A group node's 16 floats are at the expected offset in the expected order.
4. A mesh's vertex record is 44 bytes in the order position, normal, uv, tangent; the index list is u16; then material index, layer, lod in, lod out, sphere, renderable.

Round trips:
5. Write then read a model with several textures, materials (all optional fields set to non-default values), nested group nodes, meshes with every flag set off its default, and `lodOut` set: everything comes back equal (floats to f32 precision), `version` is 5.
6. `readKn5(writeKn5(readKn5(x)))` equals `readKn5(x)`, and the second write is byte-identical to the first.
7. Tangents given are kept exactly; omitted tangents come back unit length and perpendicular to the normals.
8. Unicode names survive.

Registers:
9. Each slot in the table is written with its register, whatever order the slots are listed in (e.g. txDetail, txMaps, txDiffuse, txNormal gives 3, 2, 0, 1).
10. The unknown-slot rule you chose.

Validation:
11. Each item in "Validation" throws, with the offending name in the message.
12. A mesh of exactly 65535 vertices writes; 65536 throws.

Reading:
13. Bad magic throws. Truncated data throws. Trailing bytes throw. A node class 3 or 7 throws.
14. A hand-built version 6 file (with the extra u32) reads, and `version` is 6.
15. Texture bytes in the result are a copy (changing the input afterwards doesn't change them).

Helpers:
16. `frameTransform` with forward east, north and diagonal: Z row equals forward (normalised), Y row is up, X = Y x Z, all unit length, position in 12 to 14.
17. `frameTransform` with forward straight up: no NaN.
18. Bounding sphere contains every vertex of a random mesh.

Files our builds make (skip when the file isn't there, so CI without `out/` still passes; take the path from an env var, defaulting to `out/accepted/busselton.zip`):
19. Read every `.kn5` in the accepted Busselton zip (the base, every `layout_*.kn5`, every `lm_*.kn5`): no throw, no trailing bytes, root is a group node, every mesh's material exists, every material's textures exist.
20. Write each of those back: byte-identical to the original. This is the strongest check that the rewrite matches what AC already loads. (Checked with the old module on 31 Oct 2026: the base, all four layout files and all seven landmark layers round-trip byte for byte, so this test is achievable.)
21. Layout files contain the dummies AC needs (`AC_START_0`, and for circuits `AC_TIME_0_L` / `AC_TIME_0_R`), each with an orthonormal frame.
22. Before the old module is deleted, save a few small golden kn5 files it writes from fixed models (a few KB each, in `test/fixtures/`); the new writer must reproduce them byte for byte.

In-game check (workstation, not CI): install a build made with the new writer and run `scripts\windows\run-test.ps1 <slug>`. It must load, spawn on the grid and complete an AI lap.

## Sources

- Content Manager / AcTools (gro-ove), `AcTools/Kn5File/Kn5Writer.cs` and the Kn5 types beside it: header, version-6 extra field, texture, material, node and mesh layouts, blend and depth mode enumerations. https://github.com/gro-ove/actools (raw: https://raw.githubusercontent.com/gro-ove/actools/master/AcTools/Kn5File/Kn5Writer.cs)
- Thomas Hagnhofer, Blender Kn5 Exporter (GPL), notes and source: https://www.sites.google.com/site/hagn99/assettocorsa/blender-kn5-exporter
- Custom Shaders Patch shader sources (texture register declarations of the recreated Kunos shaders): https://github.com/ac-custom-shaders-patch (check the shader include that declares the texture slots before relying on the table above).
- AC dummy names and conventions: CLAUDE.md, "AC conventions"; Kunos SDK track docs shipped with AC (`sdk/` folder).
