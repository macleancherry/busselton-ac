# Spec: PNG encoder and decoder (`src/core/png.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). Write the new module from this page and the PNG specification, without the old file open. Tests are written fresh from the "Tests" list.

## What the module is for

Most generated textures (materials, signs, sprites, normal and map textures, the street map for the in-game app, UI previews) are made as RGBA pixel arrays and need to become PNG files, the same way in the browser worker and in Node. A small decoder reads back PNGs that this encoder made, so other code can derive textures from them (normal maps from a material's shading, DXT1 copies of a PNG texture, tinted variants).

Compression is done by the `fflate` package (MIT licence, a normal dependency, not upstream code). Keep using it, or any other zlib implementation; this module only does the PNG framing and filtering.

## Public API (keep these names and shapes)

- **`encodePng(rgba, width, height, opts?): Uint8Array`**
  - `rgba`: `Uint8Array` or `Uint8ClampedArray`, width x height x 4 bytes, top row first, R G B A per pixel. Always four bytes per pixel in, even when writing RGB.
  - `opts.alpha` (default true): true writes RGBA (colour type 6); false writes RGB (colour type 2) and drops the input alpha.
  - `opts.level` (0 to 9, default 6): zlib compression level. **No caller passes it** (see "Possibly unused").
  - Returns a complete PNG file.
- **`decodeOwnPng(png: Uint8Array): { rgba: Uint8Array; width: number; height: number }`**: decodes an 8-bit RGB or RGBA, non-interlaced PNG to RGBA (alpha 255 for RGB). It has to read everything `encodePng` writes. It need not read every PNG in the world, but see "Decoding" for what it should reject.

### Call sites (from `grep`, 31 Oct 2026)

- `encodePng` (about 20 modules): `src/core/track.ts`, `textures.ts`, `buildingStyles.ts`, `houseTextures.ts`, `surfaceTextures.ts`, `treeSprites.ts`, `landmarkLayer.ts`, `photoSea.ts`, `gltf.ts` (DDS to PNG for glTF), `coast.ts`, `parkedCars.ts`, `trafficLights.ts`, `flags.ts`, `shops.ts`, `zones.ts`, `farm.ts`, `farmRoadsides.ts`, `paths.ts`, `raceDress.ts`; tests `formats`, `gates`, `kangaroo`, `track`. Callers passing `{ alpha: false }`: `textures.ts`, `zones.ts`, `track.ts`, `trafficLights.ts`; `gltf.ts` passes `{ alpha: true }`.
- `decodeOwnPng`: `src/core/track.ts` (normal maps and DXT1 copies of generated textures), `landmarkLayer.ts`, `zones.ts` (tinted verge); tests `formats`, `buildingStyles`, `flags`, `photoSea`, `zones`.

Every PNG passed to `decodeOwnPng` today comes from `encodePng`.

## The file format (what we write)

PNG, per the W3C PNG specification (third edition) / RFC 2083:

1. The 8-byte signature: 137 80 78 71 13 10 26 10.
2. Chunks, each: u32 data length (big-endian), 4-byte ASCII type, the data, u32 CRC (big-endian) of the type and data bytes. The CRC is the standard CRC-32 (polynomial 0xEDB88320 reflected, initial value all ones, final value inverted), as in the PNG spec's sample code description.
3. `IHDR` (13 bytes of data): width u32, height u32 (big-endian), bit depth 8, colour type 6 (RGBA) or 2 (RGB), compression method 0, filter method 0, interlace method 0.
4. One or more `IDAT` chunks: together, one zlib stream (RFC 1950 wrapper around RFC 1951 deflate) of the filtered image data.
5. `IEND` with no data.

No other chunks (no gamma, colour profile or text). AC, CSP, browsers, three.js and Blender all read this.

### Filtered image data

Each row is one filter-type byte followed by the row's bytes (width x 3 or x 4). The PNG spec defines five filters per row: 0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth, each predicting a byte from the bytes to the left, above and above-left and storing the difference modulo 256.

The encoder may choose any filter per row. A good default for photo-like textures is Up for every row (cheap and compresses aerial and noise textures well), which is what builds use today; the first row's "above" is all zeros. A per-row choice by the usual "smallest sum of absolute differences" heuristic is allowed if it's not much slower; build time matters more than a few percent of file size.

## Behaviour

### Encoding

- Write the signature, IHDR, the IDAT(s) and IEND as above.
- Pixels are taken in order: row 0 is the top of the image.
- With `alpha: false`, write only R, G, B for each pixel.
- Output is deterministic: the same input and options always give the same bytes.

### Decoding

- Check the signature; throw if it's wrong.
- Walk the chunks by their lengths. Read IHDR; collect every IDAT in order and inflate them as one stream; stop at IEND.
- Supported: bit depth 8, colour type 2 or 6, no interlace. Throw a clear error for anything else (palette, greyscale, 16-bit, interlaced). (The old decoder assumed RGB for any colour type that wasn't 6, and accepted only the None and Up filters. Do better: check the colour type, and handle all five filters, which is short and lets it read PNGs from other tools of the supported kinds.)
- Undo the filters row by row.
- Output RGBA, alpha 255 for RGB input.
- CRC checking is optional; if done, throw on a mismatch.
- Throw if the inflated data is shorter than height x (1 + row bytes).

## Edge cases and limits

- 1 x 1 images: valid (the build makes many tiny flat-colour textures, e.g. 4 x 4).
- Width or height 0: throw (PNG doesn't allow it).
- `rgba` shorter than width x height x 4: throw.
- Large images (the 4096 px street map, aerial-sized textures): memory is roughly the filtered data plus the compressed output; don't build per-pixel arrays.
- Uint8ClampedArray input (from canvas in the browser) must work the same as Uint8Array.

## Possibly unused (for Mac to decide)

- `opts.level`: no caller sets it. Drop it, or keep it as a cheap option.
- The decoder exists only to read our own textures back. If the derived textures were made from the pixels before encoding (the callers have them at that point, or could), the decoder could go entirely. Not worth the churn now; noted.

## Tests (write fresh)

Format:
1. Output starts with the signature, then an IHDR chunk of length 13 with the right width, height, depth 8, colour type 6 (or 2 with `alpha: false`), and zeros for compression, filter and interlace.
2. Every chunk's CRC matches a CRC-32 computed independently in the test (compute it with a simple bitwise loop in the test, or with zlib's crc32 from Node).
3. The chunk order is IHDR, IDAT..., IEND, and IEND is last with length 0.
4. Inflating the IDAT data with Node's own `zlib.inflateSync` gives height x (1 + row bytes) bytes, every filter byte between 0 and 4.

Round trip:
5. Random RGBA 37 x 23 image: decode(encode) equals the input exactly.
6. `alpha: false`: decode gives the input's RGB and alpha 255.
7. 1 x 1 and 4 x 4 flat images round-trip.
8. Uint8ClampedArray input gives the same bytes as Uint8Array input.
9. Same input twice gives identical output.

Decoder on other PNGs:
10. Hand-built PNGs (made in the test with Node's zlib) using each of the five filters decode correctly.
11. IDAT split over several chunks decodes.
12. Palette, greyscale, 16-bit and interlaced PNGs throw a clear error.
13. Bad signature throws; truncated image data throws.

Interop:
14. A PNG we write opens in an independent decoder: Python's `zlib` plus a few lines in a test helper, or the `pngjs` package if it's already in `node_modules`; or simply read it back with `sharp`/canvas if present. Skip when none is available.
15. Files our builds make (skip when absent; path from an env var, defaulting to `out/accepted/busselton.zip`): every `.png` in the zip and every PNG texture inside its kn5 files decodes, at the size in its IHDR.

Golden files: before the old module is deleted, save two small PNGs it writes (RGBA and RGB, 16 x 16, seeded input) in `test/fixtures/`. If the new encoder keeps Up filtering and the same zlib level, they should match byte for byte; either way the new decoder must decode them exactly.

## Sources

- W3C, Portable Network Graphics (PNG) Specification (Third Edition): https://www.w3.org/TR/png-3/ (signature, chunk layout, CRC, IHDR fields, colour types, filter types and their predictors, Paeth predictor).
- RFC 2083, PNG (Portable Network Graphics) Specification Version 1.0: https://www.rfc-editor.org/rfc/rfc2083
- RFC 1950, ZLIB Compressed Data Format: https://www.rfc-editor.org/rfc/rfc1950
- fflate (zlib in JS, MIT): https://www.npmjs.com/package/fflate
