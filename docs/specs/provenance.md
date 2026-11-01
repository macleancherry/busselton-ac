# Provenance: which files are still upstream's

The fork's own code is under PolyForm Noncommercial 1.0.0 (`LICENSE`). honestjams/ac-track-builder has no licence, so files derived from it are listed in `UPSTREAM-FILES.txt` and excluded. The goal ("Owning the code" in ROADMAP.md) is an empty list.

## The measure

`scripts/provenance/upstream_overlap.py . <upstream checkout>` counts, for each code file, the meaningful lines (over 12 characters, trimmed) that also appear anywhere in upstream. A file counts as upstream-derived when 20% or more of its meaningful lines match, or when it shares a path with an upstream file and has 10 or more matching lines. `--show=<file>,<file>` prints a file's matching lines. Export upstream into a scratch folder (`git archive upstream/main | tar -x -C <dir>`) and delete it afterwards.

The measure only finds identical lines, so it can't tell copied code from lines any implementation would have. A file that was written fresh (from a spec in `docs/specs/`, without the old file open) still matches upstream wherever the line is dictated by something outside our choice. Those are forced lines.

## Forced lines

A line is forced when writing it differently would break a caller, change the output, or not be valid code:

1. **Interfaces other code uses.** Import and export lines naming existing modules and symbols; signatures and parameter lists of exported functions; fields of exported types and interfaces (`DataSources`, `TrackResult`, `BuildOptions`, `CameraSpot` ...) that callers, scripts, golden fixtures or saved files read by name.
2. **Text a reader needs.** Keys, section names and values in the ini, json and lua files AC, CSP and Content Manager read (`[CAMERA_0]`, `NEAR_PLANE=1`, `[LIGHT_SERIES_0]`, `ui_track.json` keys); and output text that must stay byte for byte the same as the accepted base, including credit and trademark lines.
3. **Numbers and formulas for byte or pixel match.** Constants, colours, option defaults, drawing calls and shader code that a spec carries over so builds, sign art and preview renders match the accepted base exactly (golden fixtures, `render_diff.py`): the preview's sky shader, the canvas calls that draw sign art, marking glyphs and widths, `withDefaults` values.
4. **Language and library boilerplate.** Closers and openers (`} catch (e) {`, `].join("\n");`), loop heads, stock idioms (a binary search's `const mid = (lo + hi) >> 1;`), library calls in their documented form (three.js, Canvas 2D, Vite, `new Worker(new URL(...), { type: "module" })`), and config keys, package names and versions in `package.json` and `tsconfig.json`.

**Rule:** a file whose logic was written fresh and whose only matching lines are forced lines comes off `UPSTREAM-FILES.txt`. Check it by hand with `--show`; any match that isn't forced keeps the file on the list until that part is rewritten. When in doubt, rename or restructure the line (it costs little) rather than argue it's forced. Edit `UPSTREAM-FILES.txt` by hand after applying the rule; `--write` would put these files back.

## Files off the list under the rule (1 Nov 2026)

Checked with `--show` against upstream/main of 29 Oct 2026.

| File | Matches | Why they're forced |
| --- | --- | --- |
| `src/core/stages/types.ts` | 64/172 | 1: the public build types (`DataSources`, `OsmFeatures`, `TrackResult`, the stats) keep upstream's field names, which every caller, script and golden fixture uses. Written fresh with the stage modules (docs/specs/track.md). |
| `src/ui/preview.ts` | 69/192 | 3 and 4: the sky shader and lights, colours and materials the spec (docs/specs/headless-page.md, "The preview") fixes so SHOTS renders match the accepted base pixel for pixel; three.js calls. Written fresh from that spec on 31 Oct. |
| `src/ui/main.ts` | 23/135 | 1 and 4: imports, the `BuildJob` and route types, Worker and OffscreenCanvas calls, `placeMeta` exactly as the spec gives it (cached Nominatim answers replay from it). Written fresh from docs/specs/headless-page.md; the one free name that matched (`lastResult`) was renamed. |
| `package.json` | 16/26 | 4: package names and versions, `"private": true`, `"type": "module"`, `"dev": "vite"`. Rewritten 1 Nov. |
| `tsconfig.json` | 10/14 | 4: compiler option names and values. Rewritten 1 Nov. |
| `vite.config.ts` | 2/10 | 4: `import { defineConfig } from "vite";` and `export default defineConfig({`. Rewritten 1 Nov. |

Taken off the same day without the rule: `index.html` (rewritten, no matches) and the old `test/track.test.ts`, `roundabout`, `streets`, `gates`, `kangaroo` and `origin` tests (deleted; what only they checked is in fresh tests from docs/specs/old-build-tests.md).

## Files the measure flags that were already off

These were rewritten from specs before 1 Nov and taken off by hand at the time; the measure still flags them, and their matches fall under the rule (mostly 3 for byte-identical output, plus 1 and 4):

`src/services/art.ts` (113/374: canvas drawing calls and colours for sign art), `src/core/markings.ts` (101/455: glyph strokes, line widths and lane formulas), `src/core/kerbs.ts` (96/476), `src/services/tiles.ts` (89/406: tile maths, URL templates, and the compositing and retry steps the services golden fixtures pin), `src/core/options.ts` (73/233: option names and defaults), `src/core/paintLines.ts` (51/217), `src/core/frontage.ts` (48/230), `src/core/cspConfig.ts` (45/217: CSP ini text), `src/services/osm.ts` (44/413), `src/core/trace.ts` (41/297), `src/core/cameras.ts` (40/94: camera ini text), `src/core/terrain.ts` (38/361), `src/core/acFiles.ts` (35/174: ui_track.json keys, README credits, outline colours), `test/options.test.ts` (32/97: the defaults), `src/core/backdrop.ts` (30/128), `src/services/pipeline.ts` (28/164), `src/services/raster.ts` (27/136), `src/services/vectorTiles.ts` (26/252), `src/core/spurs.ts` (25/186), `src/ui/headlessOptions.ts` (24/73: the fixed build options), `src/core/extend.ts` (23/97), `src/core/elevation.ts` (18/120), `test/trace.test.ts` (17/160), `src/core/clearance.ts` (15/53), `src/services/mapillary.ts` (15/96), `test/clearance.test.ts` (13/114), `src/core/footpaths.ts` (12/304), `test/terrain.test.ts` (12/389), `test/frontage.test.ts` (11/131), `test/markings.test.ts` (11/263), `src/core/art.ts` (10/28), `test/kerbs.test.ts` (10/227), `src/ui/buildWorker.ts` (8/19: worker messages the spec fixes).

This pass skimmed their matching lines rather than auditing each one. Some short logic lines match too, most in `tiles.ts` (the imagery compositing loop, the DEM zoom choice), `markings.ts` (lane centres, give-way dashes), `kerbs.ts`, `frontage.ts` and `extend.ts`. They implement steps the specs carried over so builds stay byte-identical, which puts them under 3, but they're the weakest cases: the next time one of these files is touched, restructure those lines.

## What's left on the list

The road group the network core replaces (docs/specs/road-network.md): `src/core/road.ts`, `roundabout.ts`, `sideStreets.ts`, `roadMesh.ts`, `network/geom.ts`, `aiLine.ts`. They come off when the core takes over, not by rewriting them.
