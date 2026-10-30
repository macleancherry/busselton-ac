# Spec: DDS texture encoder and decoder (`src/core/dds.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). Write the new module from this page and the public format notes below, without the old file open. Tests are written fresh from the "Tests" list.

## What the module is for

AC loads DDS textures natively, and block-compressed ones are much smaller on disk and in VRAM than PNG: a 1024 px aerial chunk is about 680 KB as DXT1 instead of several MB as PNG. The build uses this module for the aerial photo chunks, building and landmark textures, gravel, the sea, and (with alpha) tree sprites. It also decodes DDS back to pixels so the Blender exporter can turn a track's textures into PNG for glTF.

Only two formats are needed: DXT1 (BC1, colour, no alpha) and DXT5 (BC3, colour plus smooth alpha). Both are written with a full mip chain.

## Public API (keep these names and shapes)

- **`encodeDdsDxt1(rgba, width, height): Uint8Array`**: `rgba` is a `Uint8Array` or `Uint8ClampedArray` of width x height x 4 bytes, top row first, left to right, R G B A per pixel. Alpha is ignored. Returns a complete `.dds` file with every mip level down to 1 x 1.
- **`encodeDdsDxt5(rgba, width, height): Uint8Array`**: as above, keeping alpha.
- **`decodeDds(data: Uint8Array): { rgba: Uint8Array; width: number; height: number }`**: the top mip level of a DXT1 or DXT5 file as RGBA, top row first. Throws "not a DDS file" on a bad magic, and "not supported" (naming the four-character code) for any other format.

### Call sites (from `grep`, 31 Oct 2026)

- `encodeDdsDxt1`: `src/services/tiles.ts` (aerial chunks), `src/core/track.ts`, `textures.ts`, `landmarkLayer.ts`, `photoSea.ts`, `unsealed.ts`; tests `dds`, `formats`, `gltf`.
- `encodeDdsDxt5`: `src/core/track.ts`, `treeModels.ts`; test `dds`.
- `decodeDds`: `src/core/gltf.ts` (kn5 textures to PNG for glTF; it catches the error and skips the texture when a format isn't supported); tests `dds`, `photoSea`.

## The file format

All header numbers are little-endian u32.

### Layout

1. Magic: the four bytes `DDS ` (0x20534444 read as a little-endian u32).
2. `DDS_HEADER`, 124 bytes.
3. The pixel data: mip level 0 (full size), then level 1, and so on to 1 x 1, each level's blocks back to back with no padding.

Total header size with the magic: 128 bytes. Pixel data starts at byte 128.

### DDS_HEADER as we write it

| Offset (from file start) | Field | Value |
| --- | --- | --- |
| 4 | size | 124 |
| 8 | flags | CAPS (0x1) + HEIGHT (0x2) + WIDTH (0x4) + PIXELFORMAT (0x1000) + MIPMAPCOUNT (0x20000) + LINEARSIZE (0x80000) |
| 12 | height | image height in pixels |
| 16 | width | image width in pixels |
| 20 | pitch or linear size | byte size of mip level 0: blocks across x blocks down x block size |
| 24 | depth | 0 |
| 28 | mip map count | number of levels (see below) |
| 32 | reserved | 11 x u32, all 0 |
| 76 | pixel format: size | 32 |
| 80 | pixel format: flags | FOURCC (0x4) |
| 84 | pixel format: four CC | ASCII `DXT1` or `DXT5` |
| 88 | RGB bit count, R, G, B, A masks | 5 x u32, all 0 |
| 108 | caps | COMPLEX (0x8) + TEXTURE (0x1000) + MIPMAP (0x400000) |
| 112 | caps2, caps3, caps4, reserved2 | all 0 |

No DX10 extension header.

### Mip levels

- Level count: one more than the number of times the larger side can be halved (rounding down) before reaching 1. 1024 x 1024 has 11 levels; 1024 x 256 also has 11; 1 x 1 has 1.
- Each level is half the previous, rounded down, never below 1 on either side. So 1024 x 256 goes 512 x 128, ..., 4 x 1, 2 x 1, 1 x 1.
- Each level is made from the previous one with a 2 x 2 box filter: every output pixel is the rounded mean of the four source pixels under it, per channel, alpha included. When the source has an odd size, or is 1 pixel on one side, reuse the edge pixel (clamp) for the missing ones.

### Blocks

Each level is cut into 4 x 4 pixel blocks, left to right, then top to bottom. Blocks across = width / 4 rounded up; blocks down likewise. Where a block hangs over the right or bottom edge, fill the missing pixels by repeating the nearest edge pixel.

**BC1 colour block (8 bytes)**, used by DXT1 and as the second half of every DXT5 block:

| Bytes | Content |
| --- | --- |
| 0 to 1 | colour 0, RGB 5:6:5 (red in the top 5 bits, green in the middle 6, blue in the low 5), u16 |
| 2 to 3 | colour 1, RGB 5:6:5, u16 |
| 4 to 7 | 16 two-bit indices, u32; pixel 0 (top left) in the lowest two bits, then left to right and top to bottom |

Expanding 5:6:5 to 8 bits: shift each value up and copy its top bits into the low bits (5 bits: v x 8 + v / 4 rounded down; 6 bits: v x 4 + v / 16 rounded down), so 0 maps to 0 and full scale to 255.

The palette:
- If colour 0 > colour 1 (as u16 numbers): four colours: c0, c1, (2 c0 + c1) / 3, (c0 + 2 c1) / 3.
- If colour 0 <= colour 1: three colours and transparent: c0, c1, (c0 + c1) / 2, and index 3 = transparent black. This is DXT1's 1-bit alpha ("punch-through") mode.
- In a DXT5 file the colour block always uses the four-colour palette, whatever the order of the endpoints.

The encoder must never produce the punch-through mode by accident in DXT1: always store the endpoints with colour 0 > colour 1. When both endpoints round to the same 5:6:5 value, write all indices as 0 (index 0 is the same colour in either mode).

**BC3 alpha block (8 bytes)**, before the colour block in each DXT5 block:

| Bytes | Content |
| --- | --- |
| 0 | alpha 0 (u8) |
| 1 | alpha 1 (u8) |
| 2 to 7 | 16 three-bit indices, 48 bits little-endian; pixel 0 in the lowest three bits |

Palette:
- If alpha 0 > alpha 1: eight values: a0, a1, then six evenly spaced between them ((6 a0 + a1) / 7, (5 a0 + 2 a1) / 7, ... (a0 + 6 a1) / 7).
- Otherwise: six values: a0, a1, four evenly spaced between ((4 a0 + a1) / 5 ... (a0 + 4 a1) / 5), then 0, then 255.

A DXT5 block is 16 bytes: alpha block, then colour block.

### Choosing endpoints (encoder)

Any encoder that meets the quality targets in "Tests" is fine. The reference is the published inset bounding box method (van Waveren, "Real-Time DXT Compression", 2006): take each channel's min and max over the block, pull both in by a sixteenth of the range, use the max as colour 0 and the min as colour 1 (swap so colour 0 > colour 1), then give each pixel the palette entry nearest to it (squared RGB distance). For alpha, use the block's highest alpha as alpha 0 and lowest as alpha 1 (eight-value mode) and pick each pixel's nearest palette value; a flat-alpha block can write all indices 0. It is fast and good enough for aerial photos; the aerial chunks are the bulk of a build's texture time, so don't pick anything much slower.

## Decoding

- Check the magic. Read height at offset 12, width at 16, four CC at 84. Only `DXT1` and `DXT5`; anything else (including `DX10`) throws "not supported" with the code.
- Decode level 0 only, starting at byte 128. Ignore the rest of the file.
- DXT1 blocks: palette rules above, including punch-through mode (index 3 transparent black when colour 0 <= colour 1). Alpha is 255 otherwise.
- DXT5 blocks: alpha from the alpha block, colour always four-colour.
- Pixels of edge blocks that fall outside the image are skipped.
- Round interpolated palette values to the nearest integer.
- Truncated data: throw rather than read past the end.

The decoder must read files from other tools too (Kunos and CSP textures are DXT1 or DXT5 often enough that the Blender export benefits), not just ours.

## Edge cases and limits

- Width or height 0: throw.
- `rgba` shorter than width x height x 4: throw.
- Sizes that aren't powers of two or multiples of 4 (e.g. 1000 x 750, 3 x 5): valid; block counts round up and edge pixels repeat. AC needs no particular size, but the build mostly uses powers of two.
- 1 x 1: one level, one block.
- Very large images (8192 x 8192 aerials if ever used): the output is about 43 MB for DXT1 with mips; allocate the output once at its exact size (it can be computed from the dimensions up front) rather than growing it.
- DXT1 discards alpha completely: a texture with transparency must use DXT5 (or PNG).

## Possibly unused (for Mac to decide)

Nothing. All three functions have build-time callers. The decoder's DXT1 punch-through branch is only reached for files we didn't write; keep it, it's a few lines and makes the decoder correct.

## Tests (write fresh)

Header:
1. First 4 bytes `DDS `; size 124; flags, pixel-format size 32, FOURCC flag, `DXT1`/`DXT5` at 84, caps as in the table; height at 12 and width at 16 (in that order).
2. Linear size = level-0 byte size; mip count right for 256 x 256 (9), 1024 x 256 (11), 1000 x 750 (10), 1 x 1 (1).
3. File length = 128 + the sum over levels of blocks x 8 (DXT1) or x 16 (DXT5), computed independently.

Encoding:
4. A flat colour image decodes back exactly to that colour's nearest 5:6:5 value in every pixel, at every level.
5. Every DXT1 block written has colour 0 > colour 1, or colour 0 = colour 1 with all indices 0 (never punch-through by accident): scan every block of a noisy 256 x 256 image.
6. Quality, noisy aerial-like image (seeded random smooth noise plus a few sharp edges, 256 x 256): mean absolute error per channel after decode under 6, and no pixel more than 64 off. Use a real aerial chunk from a build when present (skip otherwise) with the same limits.
7. DXT5 alpha: a horizontal 0 to 255 gradient decodes within 1 palette step of the source (no pixel more than 20 off); a flat alpha of 128 comes back exactly 128.
8. DXT5 colour is as good as DXT1 on the same image.
9. Non-multiple-of-4 sizes (5 x 3, 1000 x 750): encode, decode, compare with edge pixels repeated; no out-of-range reads.
10. Mip level 1 of a 2 x 2 checkerboard is the mean grey; of a 3 x 3 image uses edge clamping.

Decoding:
11. Hand-built DXT1 block with colour 0 <= colour 1 decodes index 2 as the midpoint and index 3 as transparent black.
12. Hand-built DXT5 alpha block in six-value mode decodes indices 6 and 7 as 0 and 255.
13. Hand-built DXT5 block whose colour endpoints are in the "wrong" order still decodes with four colours.
14. Bad magic throws; `DX10` and `ATI2` four CCs throw "not supported"; truncated data throws.

Files our builds make (skip when absent; path from an env var, defaulting to `out/accepted/busselton.zip`):
15. Every `.dds` texture inside the base kn5 and the `lm_*.kn5` layers decodes without error, at the size in its header, and the four CC is DXT1 or DXT5.
16. Re-encode a decoded aerial chunk and decode again: within the quality limits of test 6 of the first decode.
17. Before the old module is deleted, save one small (64 x 64) DXT1 and one DXT5 output for fixed seeded inputs in `test/fixtures/`. The new encoder needn't match them byte for byte (endpoint choice may differ), but its decoder must decode them exactly as the old one did, and its own output must meet the quality limits.

In-game check (workstation): textures look right in AC and CSP at a distance (mips) and close up; no black or see-through patches on DXT1 textures (accidental punch-through).

## Sources

- Microsoft, DDS programming guide: https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dx-graphics-dds-pguide
- Microsoft, `DDS_HEADER` structure (fields, flag values, caps): https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-header
- Microsoft, `DDS_PIXELFORMAT` structure: https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-pixelformat
- Microsoft, Block Compression (Direct3D 10): BC1 and BC3 block layout, 5:6:5 endpoints, palette rules, alpha modes: https://learn.microsoft.com/en-us/windows/win32/direct3d10/d3d10-graphics-programming-guide-resources-block-compression
- Khronos, `EXT_texture_compression_s3tc` extension spec (bit-exact DXT1/DXT5 decoding rules): https://registry.khronos.org/OpenGL/extensions/EXT/EXT_texture_compression_s3tc.txt
- J.M.P. van Waveren, "Real-Time DXT Compression", Id Software / Intel, 2006 (inset bounding box endpoint selection).
