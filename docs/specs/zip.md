# Spec: zipping a built track (`src/core/zip.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). `zip.ts` is on `UPSTREAM-FILES.txt`. Write the new module from this page without the old file open; tests are written fresh from the "Tests to write" list.

## What the module is for

A build produces a map of file paths to bytes (the track folder: kn5 files, ini files, AI splines, textures, UI images, CSP config). This module packs it into one standard ZIP archive that Content Manager can install by drag and drop, and that `install-track.ps1` unzips.

Compression comes from the `fflate` package (MIT licence, a normal dependency, not upstream code). Keep using it; this module only chooses the per-file compression level.

## Public API (keep this name and shape)

- `zipTrack(files: Record<string, Uint8Array>): Uint8Array`: returns a complete ZIP file.

## Rules

1. One archive entry per key of `files`, in the object's key order, with the key as the entry name exactly as given (forward slashes; the caller already prefixes every path with the track folder, `<slug>/…`). No directory entries are added; no paths are rewritten or sorted.
2. Entries whose name ends in `.png`, `.jpg` or `.kn5` (case-insensitive) are **stored** (compression level 0): PNG and JPEG are already compressed, and a kn5 is mostly embedded PNG texture data, so deflating again costs a lot of time for almost nothing (the Busselton base kn5 is about 160 MB).
3. Every other entry is deflated at level **6** (ini, lua, json, fast_lane.ai, DDS textures, and so on). Note `.jpeg` and `.dds` are deflated under this rule; keep that unless measured otherwise (DXT1 DDS does compress somewhat).
4. Output is a standard ZIP readable by fflate's `unzipSync`, Windows Explorer, 7-Zip and Content Manager: local headers, central directory, end-of-central-directory record; CRC-32 on every entry; UTF-8 names flagged when non-ASCII (fflate does this).
5. Everything is built in memory in one call (synchronous). Peak memory is roughly input plus output; acceptable for current builds.
6. Empty input gives a valid empty archive (just the end record).

## Limits

- No ZIP64: fflate's synchronous zipper doesn't write it. A single entry or the archive over 4 GiB, or more than 65535 entries, would fail or be corrupt. Current builds are a few hundred MB and a few hundred entries. If that ever changes, this module is where to switch.

## Callers (from `grep`, 31 Oct 2026)

- `src/ui/main.ts`: zips `result.files` for the download link (`<slug>.zip`). The headless build (`scripts/headless/build-track.mjs`) gets its zip through that download.
- `test/track.test.ts`: zips a test build and checks the kn5 survives `unzipSync` at the reported size.
- Not callers, but related: `build-track.mjs` (when it patches files after the download), `scripts/polish/landmarks.ts`, `scripts/check/traffic_rebuild.ts` and `src/core/cspTrees.ts` call fflate's `zipSync` directly at level 6 for everything, and `scripts/snapshot/snapshot.mjs` at level 0. After a headless patch the stored/deflated split of rule 2 is lost (everything deflated). Worth pointing those at `zipTrack` (outside this rewrite's scope; tell Mac).

## Known oddities (decide, don't copy blindly)

1. **Not reproducible.** fflate stamps each entry with the current time, so zipping the same files twice gives different bytes. Consider a fixed modification time (e.g. 1 Jan 2020) so identical builds give identical zips (handy for comparing builds and snapshots). This changes no file contents; check with Mac if anything compares zip hashes.
2. Extension matching is on the final extension only (`foo.kn5.bak` is deflated). Fine.

## Tests to write

1. Round trip: zip a map with a kn5, a png, an ini and a nested path (`slug/ui/ui_track.json`); `unzipSync` returns the same keys and identical bytes.
2. Compression method per entry (read the local header's method field, bytes 8–9: 0 = stored, 8 = deflate): `.kn5`, `.png`, `.PNG`, `.jpg` stored; `.ini`, `.ai`, `.dds`, `.lua` deflated.
3. A highly compressible `.ini` gets smaller; a stored `.png` entry's data is byte-identical to the input inside the archive.
4. Entry order in the central directory follows the input key order.
5. Empty input gives a valid archive that unzips to nothing.
6. (If the fixed timestamp is adopted) zipping the same input twice gives identical bytes.
