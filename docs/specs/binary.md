# Spec: little-endian byte writer and reader (`src/core/binary.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). `binary.ts` is on `UPSTREAM-FILES.txt` and is only used by the AC file writers, so it goes with them.

## What it is for

The kn5 and fast_lane.ai writers and readers (and the DDS encoder) need to write and read little-endian numbers, length-prefixed strings and raw byte runs. This helper does that.

## Call sites (from `grep`, 31 Oct 2026)

Only `src/core/kn5.ts`, `src/core/aiSpline.ts` and `src/core/dds.ts`. No other module, script or test imports it.

That means the rewrite is free to:
- write a fresh helper module with whatever names suit it (the old class names needn't be kept, since nothing else uses them), or
- fold the few operations each format needs into the format modules themselves (e.g. a DataView over a buffer sized up front, which suits DDS, whose size is known from the dimensions), and delete `binary.ts`.

Either way, `binary.ts` must come off `UPSTREAM-FILES.txt`.

## What the writer must do

- Append, in little-endian order: u8, bool (one byte, 1 or 0), u16, i32, u32, f32, a list of f32, raw bytes.
- Append a *string*: u32 byte count then the UTF-8 bytes.
- Append a *blob*: u32 byte count then the raw bytes.
- Append raw ASCII with no length (file magic such as `sc6969` or `DDS `).
- Grow as needed, geometrically, so writing the 160 MB base kn5 stays linear in time. Or take a size up front when the caller knows it.
- Return exactly the bytes written, as a fresh Uint8Array.

## What the reader must do

- Read the same kinds of values from a Uint8Array that may be a view into a larger buffer (honour its byte offset).
- Report how many bytes remain, so format readers can reject trailing bytes.
- Throw when a read would run past the end (a DataView does this for numbers; check byte-run and string lengths explicitly, since a subarray past the end silently comes back short).
- Reading many floats into a typed array in one call is worth having: the kn5 reader reads tens of millions of them for the base.

## Edge cases

- Strings with non-ASCII characters: byte count, not character count.
- Empty string and empty blob: a zero count and nothing else.
- f32 rounding: values come back at single precision.
- u32 values above 2^31 must not come back negative.

## Tests (write fresh, or cover through the format modules' tests)

1. Each value type writes the expected bytes (check against hand-written byte lists, little-endian).
2. Strings: "abc" writes 3,0,0,0,'a','b','c'; a two-byte UTF-8 character counts as 2.
3. Growing past the initial size keeps earlier bytes intact.
4. The reader reads back everything the writer wrote, from a view with a non-zero byte offset.
5. Reading past the end throws, for numbers, strings and blobs.
6. A 0xFFFFFFFF u32 reads back as 4294967295.
