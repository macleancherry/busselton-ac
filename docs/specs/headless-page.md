# Spec: the headless build page (replaces the browser app)

Status: spec for a clean rewrite ("Owning the code" in ROADMAP.md). Mac decided on 31 Oct 2026 that he doesn't need the browser app (CLAUDE.md, Upstream: delete what we don't use), so `src/ui/main.ts`, `src/ui/preview.ts`, `src/ui/session.ts`, `src/ui/buildWorker.ts`, `src/ui/style.css` and `index.html` (all on `UPSTREAM-FILES.txt`) are replaced by the smallest page the headless build needs. Written from the old code on 31 Oct 2026; a separate session writes the new files from this page alone, with fresh tests from "Tests to write".

## What the page is for

`scripts/headless/build-track.mjs` starts the Vite dev server, opens the page in Playwright Chromium (1400 x 900, time zone `Australia/Perth`, device pixel ratio 1, fresh profile, a desktop user agent) and drives it. Every outside request the page makes goes through the script's `page.route` handler: the download cache (`out/cache`) and the frozen snapshots (`SNAPSHOT=`). That's why routing and the build run **in the page** and not in Node: the cache and snapshot keys are the requests the page makes.

The page has to:
1. route the pins (OSRM, or OSM ways),
2. run `runBuild` (`src/services/pipeline.ts`, spec in pipeline.md) with the options the old UI gave every headless build,
3. render the three.js preview: the Content Manager image `ui/preview.png` and the `SHOTS` renders,
4. zip the files and hand everything back to the script.

No map, no controls, no styling, no session, no search. Nothing else in the repo drives the page: `scripts/check/*`, `render_diff.py`, `base.mjs` and the rest only read files build-track.mjs writes. `scripts/check/benchmark.ts` renders with Blender (`scripts/blender/render_track.ts`), not with this page.

## Files

Suggested (the implementer may rename; keep the worker URL form so Vite bundles it):

- `index.html`: `<!doctype html>`, a title, one `<canvas id="preview-canvas" width="1024" height="576">`, one module script `/src/ui/main.ts`. Nothing else. (CI runs `npm run build`, which type-checks and `vite build`s this page; keep it buildable.)
- `src/ui/main.ts`: sets up `window.__app` (below).
- `src/ui/headlessOptions.ts`: pure, no DOM: the fixed options and the route `options` mapping. Tested in Node.
- `src/ui/buildWorker.ts`: the worker (kept, see "Worker").
- `src/ui/preview.ts`: the renderer for `snapshot` and `shot`, nothing interactive.

## `window.__app`

Set once at start-up; `waitForFunction(() => window.__app)` means ready. Expose it unconditionally (the page has no other use; the old `import.meta.env.DEV` guard can go).

```
window.__app = {
  route(input: RouteInput): Promise<RouteSummary>,
  build(input: BuildInput): Promise<void>,      // rejects with the build's error
  progress(): string,                           // current stage text, "" before a build
  result(): TrackResult | null,                 // last successful build (ui/preview.png already replaced)
  preview(): PreviewScene | null,               // last build's renderer
  dataWarnings(): string[],                     // copy of the last outcome's `missing`
  zip(): Uint8Array | null,                     // the last build's zip bytes
  shot(eye: Vec3, target: Vec3): string,        // render one SHOTS frame; base64 PNG without the data: prefix
}

interface RouteInput {
  pins: LngLat[];                               // [lng, lat], in order
  loop: boolean;
  ways?: { ids: number[]; reverse: boolean };   // route "ways"
}
interface RouteSummary {
  distance: number;                             // metres
  kind: "Circuit" | "A to B";
  lengthText: string;                           // "x.xx km" when >= 1 km, else "n m" (for the log)
  error: string;                                // "" when the route can be built
  note: string;                                 // trimmed U-turns, "" when none (log only)
}
interface BuildInput {
  name: string;                                 // the route's name
  options: Record<string, unknown>;             // the route's (and preset's) "options": old UI control ids
  build?: Partial<BuildOptions>;                // the route's (and preset's) "build", plus clears / layout from the script
  token: string;                                // MAPILLARY_TOKEN or ""
  houseLooks?: BuildJob["houseLooks"];          // HOUSE_LOOKS etc., without specFile entries
  landmarks?: { name: string; at: [number, number] }[];
}
```

`window.__landmarks` is still read by build-track.mjs's layout step (`(window.__landmarks ?? [])` inside a `page.evaluate`): either keep the script setting it, or have the script pass `landmarks` there from its own variable (preferred; see "Script changes").

### `route(input)`

1. With fewer than 2 pins: reject ("a route needs at least two pins").
2. `through = loop ? [...pins, pins[0]] : pins`.
3. `r = ways ? await routeWays(ways.ids, through, { reverse: ways.reverse, loop }) : await route(through)` (`src/services/osm.ts`). A throw becomes `error = "Couldn't route between those pins: <message>"` (resolve, don't reject, so the script reports it the same way as the other errors).
4. Checks, first match wins (keep the texts, they show up in build logs):
   - distance > 30 km: `That's N.N km. Browser builds are limited to 30 km: move the pins closer.` (30 km cap kept so no route builds differently; lifting it is Mac's call)
   - distance < 300 m: `Make the road at least 300 m long.`
   - `r.uturns` non-empty: `The route turns back on itself near LAT, LNG, which builds a hairpin spike. Move or remove the pin there.` (first U-turn, 5 decimals, lat first). This fails the build by design.
   - `note`: when `r.trimmed` is non-empty, `Cut a U-turn out of the route (a pin on the far side of the road). Drag the pin onto the near side to keep it exact.` or `Cut N U-turns out of …`.
5. **Place name**: `await reverseGeocode(r.coords[floor(r.coords.length / 2)])` and keep `placeMeta = { country: place.country, city: place.town }` for the next build; any failure gives `{}`. Same point as before so cached and snapshotted Nominatim answers keep replaying. Awaited before `route` resolves (Bug 1).
6. Keep `r` as the current route (`coords`, `roundabouts`) and return the summary.

Each call replaces the current route; `build` uses the latest one.

### `build(input)`

1. No current route, or its summary had an error: reject.
2. Reset: dispose the old preview; `result`, `zip`, `dataWarnings` become null/empty; `progress` "".
3. `opts = { ...headlessOptions(input.name, input.options), ...(input.build ?? {}) }` (route `build` wins, as `window.__buildOptions` did).
4. Job (`BuildJob`, pipeline.md): `{ coords, roundabouts, opts, token: input.token.trim(), imagerySource: "auto", placeMeta, houseLooks: input.houseLooks, landmarks: input.landmarks }`.
5. Run it in the worker (below). Progress: `progress()` returns the stage text, `"Fetching aerial imagery (NN%)"` for that stage with its fraction, and trace text (e.g. `Tracing the road in the aerial photos (NN%)`) as it arrives. Must change through every long stage: the script stops a build whose text hasn't changed for 10 minutes (`BUILD_STALL_MIN`).
6. On success: `dataWarnings` = `outcome.missing`; progress "Rendering preview"; `createPreview(canvas, result.model, result.plan, chunkImages, result.previewTextures)`; `result.files["<slug>/ui/preview.png"] = await preview.snapshot(1024, 576)`, keeping the build's drawn fallback if that throws; `zip = zipTrack(result.files)` (`src/core/zip.ts`); progress "Done".
7. On failure: reject with `Build failed: <message>`.

No progress bar: the old stage-to-bar-slice table is deleted with the UI.

### `headlessOptions(name, options)` (pure)

Every headless build so far got the old UI's default control values (options.md, rule 2), and they differ from `DEFAULT_OPTIONS` in `textureSize` and `name`. To keep builds identical, always supply exactly these, then apply the route's `options`:

| Field | Value |
| --- | --- |
| `name` | `name.trim()`, or `"Real road"` when empty |
| `widthOverride` | 0 |
| `corridor` | 90 |
| `wallOffset` | 10 |
| `horizon` | 1500 |
| `lineSmoothing` | 4 |
| `elevationSmoothing` | 15 |
| `pitCount` | 8 |
| `vergeWidth` | 1.5 |
| `banking` | true |
| `imageryZoom` / `textureSize` | 18 / **512** ("standard") |
| `trees` | 1 |
| `guardRails`, `guidePosts`, `buildings`, `detectBuildings`, `markings`, `sideStreets`, `streetSigns`, `landmarks`, `traceRoads`, `kerbs`, `detailShaders` | true |
| `roadSurface` | `"auto"` |
| `raceDress` | false |
| `sponsors` | `DEFAULT_SPONSORS` (`src/core/sponsors.ts`; the same string the UI had) |
| `noTrace` | `[]` (routes set it in `build`) |

Route `options` (old control ids). Only two are used by routes and presets (`presets.mjs`: `imagery`, `banking`):
- `imagery`: `"ultra"` → zoom 20, size 2048; `"high"` → 19, 1024; `"standard"` → 18, 512; `"off"` → zoom 0, size 512 **and** `trees: 0`.
- `banking`: `!!value`.
- Any other key: throw `no control #<key> in the UI` (as before, so a typo in a route fails loudly). `mapillaryToken` is no longer an option: the script passes `token`.

Simplification for later (not in this rewrite, it changes options): fold these values into `DEFAULT_OPTIONS` and have routes say `imageryZoom`/`textureSize` directly. options.md Bug 1 explains why `textureSize` stays 1024 in the defaults for now.

## Worker

Keep the build in a module worker: the page's main thread stays free so the script's progress polls answer during long synchronous stages (on the page a hung loop would also hang the stall check), and the big buffers are transferred, not copied. If the worker can't start, build on the page.

Page posts **one** message, the `BuildJob`. Worker replies (export as `WorkerMessage`):

```
| { type: "unsupported" }
| { type: "progress"; stage: string; fraction: number }
| { type: "trace"; text: string }
| { type: "error"; message: string }
| { type: "done"; outcome: Omit<BuildOutcome, "chunkImages">; images: [string, ImageBitmap][] }
```

Worker: if `OffscreenCanvas` is missing or can't give a 2D context, post `unsupported`. Else `runBuild(job, (stage, f = 0) => post progress, text => post trace)`. On success turn each chunk canvas into an `ImageBitmap` (`transferToImageBitmap`), collect the distinct `ArrayBuffer`s behind `result.files` values, `result.model.textures[].data` and `result.previewTextures[].rgba` (skip non-`ArrayBuffer` backings), and post `done` transferring bitmaps and buffers. On a throw post `error`.

Page: `new Worker(new URL("./buildWorker.ts", import.meta.url), { type: "module" })`. `progress`/`trace` update `progress()`. `done`: rebuild `result.proj = new LocalProjection(result.proj.origin)` (the script calls `proj.toLngLat` and `proj.toLocal`; class instances don't survive the clone), draw each bitmap into an `OffscreenCanvas` of its size and `close()` it, giving `chunkImages`; terminate. `error`: reject. `unsupported`, a constructor throw, or `onerror` before any message: fall back to `runBuild` on the page. `onerror` after a message: reject (`e.message` or "The build stopped unexpectedly"). Everything else on `TrackResult` must be plain data.

## The preview (`snapshot` and `shot`)

`ui/preview.png` and the SHOTS renders. `render_diff.py` compares each build's `out/<slug>.shot*.png` pixel by pixel with the set saved at the last `base.mjs accept`, so **framing and look must match the old preview exactly**, or the first upgrade after the merge shows every view as changed. Before merging, the lead builds Busselton with `SHOTS=auto` on the old code, `render_diff.py busselton --save`, rebuilds on the new code, and `render_diff.py busselton` should show next to no change.

```
interface PreviewScene {
  snapshot(width: number, height: number): Promise<Uint8Array>;   // PNG of the start view, markers hidden
  view(eye: Vec3, target: Vec3): void;                            // place the camera and render one frame
  dispose(): void;
}
createPreview(canvas, model: Kn5Model, plan: RoadPlan, chunkImages: Map<string, OffscreenCanvas>,
              rawTextures: Record<string, { rgba: Uint8Array; width: number; height: number }> = {}): Promise<PreviewScene>
```

`__app.shot(eye, target)` = `preview.view(eye, target)` then `canvas.toDataURL("image/png")` without the prefix.

### Coordinates
AC space: X east, Y up, Z south, right-handed like three.js, so kn5 positions, normals, UVs and winding go in unchanged. Plan samples are local metres (x east, y north) with height `h`: `toAc(x, y, h) = [x, h, -y]` (`src/core/mesh.ts`).

### Renderer
- `WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })` (the canvas is read after the frame).
- Pixel ratio **1**; size **1024 x 576** from creation (`setSize(w, h, false)`), camera aspect 16:9. (The old code took the size from `snapshot(1024, 576)` and the pixel ratio from the screen, which is 1 in Playwright: same pixels.)
- `snapshot(w, h)` sets size and aspect to `w x h`, renders, and leaves them there; `view` never resizes.

### Scene
- Background `#c2d3e3`; linear fog, same colour, 700 to 4500 m.
- Hemisphere light sky `#dfe9ff`, ground `#4a4632`, intensity 1.6. Directional light `#fff4e0`, 1.8, at (300, 600, 200) aimed at the origin. No shadows.
- Camera: perspective, vertical FOV 55°, near 0.5, far 8000.
- Sky dome: sphere radius 7000 (48 x 24 segments), back faces, no depth test or write, no fog, render order -1, never culled, moved to the camera position before every render. Colour by view direction `d` (normalised) and `sun` (the light position, normalised):
  - base `mix(horizon, zenith, max(d.y, 0)^0.5)`, zenith (0.23, 0.45, 0.78), horizon (0.76, 0.83, 0.89); below the horizon `mix(horizon, (0.6, 0.64, 0.64), min(1, -d.y * 4))`;
  - sun: `sd = max(dot(d, sun), 0)`, add `(1.0, 0.92, 0.75) * (sd^800 * 3 + sd^10 * 0.16)`;
  - above the horizon: `uv = d.xz / (d.y + 0.06) * 0.9`, `fade = smoothstep(0, 0.18, d.y)`; value noise (hash `fract(sin(dot(p, (127.1, 311.7))) * 43758.5453)`, smoothstep-weighted corners) and 6-octave fbm (amplitude from 0.5 halving, `p = p * 2.03 + (1.7, 9.2)` each octave);
  - cirrus `ci = fbm((uv.x * 0.35 + 20, uv.y * 2.5))`, mix toward (0.97, 0.98, 1.0) by `smoothstep(0.58, 0.85, ci) * 0.3 * fade`;
  - cumulus `n = fbm(uv + (3.1, 7.4))`, `cover = smoothstep(0.47, 0.66, n)`, `toward = fbm(uv + (3.1, 7.4) + sun.xz * 0.12)`, `lit = clamp(0.82 + (n - toward) * 3.5, 0.55, 1.08)`; cloud `(1.0, 0.99, 0.97) * lit`, toward (0.6, 0.64, 0.7) by `smoothstep(0.7, 0.9, n) * 0.45`, toward `horizon` by `1 - fade`; mixed in by `cover * smoothstep(0, 0.06, d.y)`.

### Materials, one per kn5 material
- Diffuse = the material's `txDiffuse`, first match: (1) name starts `terrain_` or `backdrop_`: `chunkImages.get(name after the first "_")` as a canvas texture; (2) `rawTextures[texName]` as an RGBA data texture with mipmaps, trilinear min, linear mag; (3) the kn5 texture of that name when it ends `.png` (any case), decoded with `createImageBitmap`; (4) none.
- Every texture: `flipY = false`, repeat wrap, sRGB, anisotropy 8.
- `MeshLambertMaterial`, white with a texture, `#6b7a4a` without; `alphaTest: 0.5` when the kn5 material is `alphaTested`.

### Geometry
- Walk `model.root`: a node whose `transform` differs from `IDENTITY` (kn5.ts) becomes a `Group` with `matrixAutoUpdate = false` and the 16 numbers as its matrix, as they stand. Skip meshes with `renderable === false`. Positions, normals, UVs, indices.

### Markers
Sphere radius 1.2 (16 x 12, unlit), 2 m above sample 0, `#4fd486`; on a point-to-point plan also above the last sample, `#ef5b5b`. Hidden for `snapshot`, **visible in `view`** (the old shots have them; see Later changes).

### Camera placement (both methods), matching OrbitControls
The old code placed the camera through three.js `OrbitControls` (damping on, `maxPolarAngle = 0.495 π`). Drop OrbitControls and do what its `update()` did to a fresh placement:
1. `offset = eye - target`; polar angle `phi = acos(offset.y / |offset|)`; clamp `phi` to `[1e-6, min(0.495 π, π - 1e-6)]`; keep the azimuth and the distance; `eye = target + offset` rebuilt from the clamped angle.
2. Camera at `eye`, `lookAt(target)` (up = +Y).

So an eye below its target (a SHOTS lap fraction where the road climbs more than 0.2 m over the next 15 samples) is swung up onto the 0.495 π cone around the target. This changes framing and must be kept for the comparison.

### Start view (`snapshot`)
`s = samples[0]`, `ahead = samples[min(n - 1, 100)]`. Eye `toAc(s.x - s.tan.x * 40, s.y - s.tan.y * 40, s.h + 35)`. Cast a ray straight down from 500 m above the eye's height at its x, z against the meshes; on a hit, `eyeY = max(eyeY, hitY + 10)`. Target `toAc(ahead.x, ahead.y, ahead.h)`. Then the placement above.

### SHOTS (computed by build-track.mjs, kept there)
Lap fraction `f`: sample `i = floor(f * n) mod n`, eye `[x, h + 1.2, -y]`, target sample `(i + 15) mod n` at `h + 1.0`. `L:x:y:lookX:lookY:height[:lookHeight]` (local metres; look height defaults to `0.6 * height`). `lng:lat:lookLng:lookLat:height` (through `proj.toLocal`, looking at `0.6 * height`). `carN`: 10 m beside and 4 m above parked car `floor(N / 10 * count)`, looking at it, at sample 0's height. `SHOTS=auto`: 0.02, 0.2, 0.4, 0.6, 0.8 and up to six roundabouts from 30 m south, 16 m above `hc`. The script keeps this code; it only swaps `pv.view(...)` + `toDataURL` for `__app.shot(...)`.

### `dispose`
Dispose every geometry, material, texture and the renderer (Bug 3).

## Script changes (the lead makes these in `scripts/headless/build-track.mjs`)

| Now | Becomes |
| --- | --- |
| `page.fill("#name")`, `page.check("#loop")`, setting control ids with events | `name`, `loop` and `options` passed to `route`/`build` |
| `window.__buildOptions = buildOpts` | `build: buildOpts` |
| `window.__houseLooks`, `window.__landmarks` | `houseLooks`, `landmarks` in `build` (and the layout step uses the script's own `landmarks` instead of `window.__landmarks`) |
| `window.__routeWays` + `__app.addPin` per pin + waiting for `#build`/`#route-error` | `const r = await page.evaluate(i => window.__app.route(i), { pins, loop, ways })`; throw if `r.error`; log `r.lengthText`, `r.kind` (keep the 240 s / 60 s timeouts) |
| `MAPILLARY_TOKEN` as the `mapillaryToken` control | `token` in `build` |
| click `#build`, poll `#progress-text`, wait for `#result` / `#build-error` | `__app.build(input)` raced with the stall check, which polls `__app.progress()` every 2 s |
| `fetch(#download.href)` into `window.__zipBuf` | `window.__zipBuf = window.__app.zip()`; the 16 MB base64 chunking stays |
| `#result-stats` rows into stats.json `table` and the log | drop `table` (nothing reads it; `stats` stays) and log a few `stats` fields, or build the table in Node from `stats` if Mac wants it |
| `pv.view(...)` + `getElementById("preview-canvas").toDataURL(...)` | `window.__app.shot(eye, target)` |
| `__app.result()`, `__app.preview()`, `__app.dataWarnings()` | unchanged |

Unchanged: the dev server, the request cache and snapshot handler, the dynamic imports of `/src/services/osm.ts`, `/src/core/layouts.ts`, `/src/core/track.ts`, `/src/core/trafficZones.ts` from the page, and everything after the zip comes out.

Requests: the page no longer loads OSM map tiles for a Leaflet map (the old page fetched them at the Perth view through the cache), so `out/<slug>.inputs.json` lists fewer keys and new snapshots get smaller. Old snapshots still work (extra entries are ignored).

## Delete list

Files:
- `src/ui/session.ts` and `test/session.test.ts` (headless never had a saved session: fresh profile, no hash).
- `src/ui/style.css`.
- Most of `index.html` (to the stub above) and of `src/ui/main.ts` (map, Leaflet layers and time-zone views, pins and markers, the pin list, reverse and clear, loop checkbox, no-trace zones UI, search, track-name suggestion into a field, every settings control, race-day and Mapillary panels, Advanced panel, progress bar and stage slices, result stats HTML, download link, Copy link, preview overlay and its buttons and Escape key, session save and restore, `localStorage` use).
- From `src/ui/preview.ts`: OrbitControls, `open`, `close`, `toggleDrive`, the drive loop, the window resize listener, client-size sizing.

Exports and dependencies left unused (delete, after a grep confirms):
- `searchPlaces` and `Place` in `src/services/osm.ts` (search box only).
- `savedToken`, `saveToken`, `TOKEN_KEY`, the `KeyStore`/storage helper in `src/services/mapillary.ts`, and their test in `test/mapillary.test.ts` (the "saveToken" case near line 155).
- `DEM_LABEL` in `src/services/tiles.ts` (stats row only).
- `leaflet` and `@types/leaflet` in `package.json` (main.ts was the only user).
- The `"preview": "vite preview"` npm script (served the built app). Keep `dev` (the headless build) and `build` (CI).

Docs the lead updates: README.md (no browser app; how to build), CLAUDE.md code map (`window.__app` shape, `src/ui/main.ts` is the headless page, "Don't edit src/ while a build is running" still holds), docs/specs/options.md (the "UI" column becomes "headless default", rule 2 and rule 3 point here), ROADMAP.md (the 21 Nov row: preview, session, main UI, style, index.html are deleted or replaced, not rewritten), `UPSTREAM-FILES.txt` via `upstream_overlap.py --write`.

## Bugs to fix (rather than copy)

1. **Place name raced the build.** The old page reverse-geocoded after routing without waiting, and the script clicked Build as soon as the route was ready, so `placeMeta` (country and city in `ui/ui_track.json`) was sometimes empty and sometimes from an earlier route. `route()` now awaits it.
2. **A stale route could be built.** Pins were added one by one with a 250 ms debounced re-route, and the script waited for an enabled Build button, which could be left over from a route through only the first pins. `route()` takes all the pins at once, so this goes away.
3. **`dispose` leaked** the marker and sky geometries and materials. Dispose everything.
4. **SHOTS size depended on the snapshot succeeding** (a failed snapshot left the canvas at 300 x 150). Fixed by setting 1024 x 576 at creation.
5. **Raycast before the first render** used stale world matrices for meshes under transformed groups (the jetty train). Call `scene.updateMatrixWorld(true)` before the start-view raycast. This only moves the snapshot eye if a train car is right behind the start, so the shots don't change.

## Later changes (each in its own commit, then re-save the render baseline with `base.mjs accept`)

- Hide the start/finish markers in `shot` (a green ball can sit in the 0.02 view).
- Drop the 0.495 π polar clamp so climbing lap-fraction shots look where they were aimed.
- Lift the 30 km route cap if Mac wants longer drives.
- Fold the headless defaults into `DEFAULT_OPTIONS` (options change: compare builds before and after).

## Tests to write

1. `headlessOptions("", {})` gives exactly the table (name "Real road", `textureSize` 512, `imageryZoom` 18, trees 1 and the rest); name trimmed.
2. `imagery`: `ultra`/`high`/`standard`/`off` give zoom 20/19/18/0 and size 2048/1024/512/512; `off` sets trees 0. `banking: false` gives false.
3. An unknown option key throws `no control #width in the UI` (for `width`), and `mapillaryToken` throws too.
4. `{ ...headlessOptions(...), ...build }`: route `build` wins (e.g. `banking`, `trees`, `noTrace`).
5. The busselton preset's options (`imagery: "high"`, `banking: false`) through `headlessOptions`, compared field by field with what the old `readOptions()` gave for those control values (fixture written from this spec).
6. Route checks (pure helper: distance, uturns, trimmed → error, note, lengthText): 30.1 km error with "30.1 km"; 299 m error; U-turn text with 5 decimals, lat first, only when no other error; note singular and plural; 999 m → "999 m", 1000 m → "1.00 km"; exactly 300 m and 30 km pass.
7. Camera placement (pure helper): eye above the target unchanged; eye level with the target or below it is moved onto the 0.495 π cone at the same distance and azimuth; matches a recorded OrbitControls result for three cases (compute the fixture once with three.js's OrbitControls in a test, then keep the numbers).
8. Start view (pure helper): 40 m behind sample 0 along `-tan`, 35 m up, target sample `min(n - 1, 100)`, lifted to `hit + 10`; `toAc` is `[x, h, -y]`.
9. Texture choice (pure helper): `terrain_c3` uses chunk `c3`; `backdrop_a_b` uses `a_b`; raw beats PNG; `.PNG` decodes; DDS without raw gives none.
10. Worker transfer list (pure): distinct buffers from files, model textures and preview textures; non-`ArrayBuffer` skipped.
11. Worker reply handling (pure state function): `done` rebuilds a `LocalProjection` whose `toLocal`/`toLngLat` work; `unsupported` and a load error before any message mean "build on the page"; an error after a message rejects.
12. Before merging (the lead, heavy, under the lock): a full Busselton build passes every check, and the render_diff comparison above shows no change; and one `ways` route (collie-motorplex or boranup-drive) still routes and builds.

## Sources

Old files read 31 Oct 2026: `src/ui/main.ts`, `src/ui/preview.ts`, `src/ui/session.ts`, `src/ui/buildWorker.ts`, `src/ui/style.css`, `index.html`. Consumers: `scripts/headless/build-track.mjs` (the only script that drives the page), `scripts/headless/presets.mjs`, route files' `options` (only `imagery`, `banking`), `scripts/check/render_diff.py`, `scripts/upgrade/base.mjs`, `scripts/check/benchmark.ts` (Blender, not the page), `scripts/snapshot/snapshot.mjs`, `src/services/pipeline.ts`, `src/core/options.ts`, `docs/specs/options.md`, `.github/workflows/ci.yml` (`npm run build`).
