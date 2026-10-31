# Spec: the track build (`src/core/track.ts`), stage 1 of 2

Status: behaviour spec for the clean rewrite ("Owning the code" in ROADMAP.md, week ending 28 Nov). `track.ts` (2,177 lines) is on `UPSTREAM-FILES.txt`. Written from the old code on 31 Oct 2026 so a separate session can write the new modules without the old file open. **Stage 1** (this page) is the map of the whole flow and the split into stage modules; **stage 2** is writing those modules from it, one or a few at a time, each landing only when the golden build (section 15) is byte-identical.

The rewrite has two goals that pull against each other: (1) split one 1,700-line function into stage modules under `src/core/stages/` with a thin orchestrator; (2) keep the output **byte for byte** the same for the accepted Busselton base. So the order things are registered and emitted in is part of the behaviour (sections 6, 7, 12). Bugs found here (section 14) are fixed **after** the golden passes, each as its own commit and base upgrade (`scripts/upgrade/base.mjs`), never folded into the rewrite.

Related specs (the modules `track.ts` calls; don't respecify them here): pipeline.md (who calls this), options.md, road-network.md, terrain.md, scenery.md, buildings.md, buildingStyles.md, lots.md, frontage.md, footpaths.md, furniture.md, utilities.md, fences.md, kerbs.md, markings.md, paintLines.md, trace.md, extend.md, spurs.md, clearance.md, cull.md, backdrop.md, elevation.md, photoSurface.md, materials.md, textures.md, kn5.md, acFiles.md, aiSpline.md, cameras.md, cspConfig.md, zip.md, mapillary.md, art.md.

---

## 1. Where it sits

```
pipeline.ts runBuild  -> fetches data, builds DataSources
  -> buildTrack(route, opts, sources, meta, progress)   (this module)
       -> TrackResult { files, model, plan, proj, stats, ... }
main.ts  -> zipTrack(result.files) (zip.ts: fixed mtime, so identical files zip identically)
build-track.mjs (headless, after the page build):
  -> extra layouts (layouts.ts layoutFiles, using trackObjects and result.model)
  -> hand-made layers (layer_<name>.kn5, models*.ini) and landmark layers (lm_<slug>.kn5, scripts/polish/landmarks.ts)
```

So `buildTrack` does **not** zip, does **not** add layers or landmark kn5s, and does **not** write the other layouts. It only (a) **clears** the spots layers and landmarks stand on (`opts.clears`), (b) writes the main layout's files (as layout `opts.layout` when set), and (c) returns the model and data the headless script needs for the rest. The brief's "layers, landmark clears, zip" stages are therefore: clears inside this module; layers, landmarks and zip outside it (unchanged by this rewrite).

Headless builds pass `houseLooks` **without** `spec` (build-track.mjs strips looks with `specFile`; those are landmarks built as layers) and pass `landmarks` (names and points, for the automatic test's photos). The spec-house branch (S14.4) is reached only from tests (`test/flags.test.ts`) and a hand-set `window.__houseLooks` in the browser.

---

## 2. Public API (keep these names and shapes)

```
export type Progress = (stage: string, fraction?: number) => void | Promise<void>;
export interface DataSources { ... }   // unchanged, every field optional except dem
export interface OsmFeatures { ... }   // unchanged (osm.ts imports the type)
export interface TrackResult { ... }   // unchanged
export function buildTrack(route: LngLat[], partial: Partial<BuildOptions>, sources: DataSources,
                           meta: Partial<TrackMeta> = {}, progress: Progress = () => {}): Promise<TrackResult>
export function trackObjects(plan: RoadPlan, opts: BuildOptions): Kn5GroupNode[]
```

Keep the types exactly as they are in the old file (field names, optionality, comments are useful): they cross the worker boundary and the headless script reads them. Move them to `src/core/stages/types.ts` and re-export from `track.ts` so every import path (`../core/track`, `/src/core/track.ts`) keeps working.

Callers (grep, 31 Oct): `src/services/pipeline.ts` (buildTrack, TrackResult), `src/ui/main.ts` (TrackResult type), `src/services/osm.ts` (OsmFeatures type), `scripts/headless/build-track.mjs` (trackObjects via `/src/core/track.ts`; reads `result.plan.samples`, `proj`, `stats`, `houses`, `trafficInput`, `bayBoxes`, `model`, `files`, `slug`), `src/core/layouts.ts` (takes `trackObjects` as a parameter), 18 test files (buildTrack, DataSources, OsmFeatures, trackObjects).

Drop: the `export { material, nmMaterial }` re-export (nobody imports them from here) and the private `pointInside` (a duplicate of `buildings.pointInRing`; see B5).

`TrackResult` fields and where they come from: `slug`, `files` (section 8), `model` (section 7, after parked cars are appended), `plan` (the RoadPlan as finally mutated: traced, elevated, kerbs recorded, area rings appended, ring openings and `kerbed` set), `proj`, `junctions` (`streetPlan.junctions` → `{s, side}`), `houses` (S20), `parked` (`{at, dir}` of the final cars), `trafficInput` (only when `opts.traffic`), `bayBoxes`, `previewTextures`, `stats` (section 9).

---

## 3. Conventions

- Input `route` is lng/lat pins (`[lng, lat]`), already routed (the OSRM/ways centreline). Fewer than 2 points: throw `Error("Pick a start and a finish on the map first")`.
- `opts = withDefaults(partial)` (options.ts). Everything below reads `opts`, never `partial`.
- Local metres: x east, y north, from `new LocalProjection(centre)`. `toAc(x, y, z)` maps to AC (x east, y up, z south). Every `sources.*` lng/lat input is converted with `proj.toLocal` once, at the stage that uses it.
- `centre = opts.origin ?? [mid of min/max lng, mid of min/max lat]` of the route pins (not the area). Layers need a fixed origin (CLAUDE.md).
- `slug = slugify(opts.name)`. Files are keyed `${slug}/...`.
- `nS = plan.samples.length`. Samples are spaced `opts.spacing` at planning, but tracing (applyTrace) recomputes `s` from the traced positions, so after S2 `s ≠ i·spacing` exactly (see B11).

---

## 4. Progress and errors

Progress strings, in this order (the headless build stops a build with no progress for 10 minutes, so long loops must keep reporting; the UI shows them):

| # | String | Fraction | When |
|---|---|---|---|
| 1 | `Laying out the road` | — | always, first |
| 2 | `Tracing the road in the aerial photos` | — | `opts.traceRoads && sources.raster` |
| 3 | `Fetching elevation` | — | always |
| 4 | `Fetching aerial imagery` | done/jobs, per job | `sources.imagery && opts.imageryZoom > 0` |
| 5 | `Tracing the area's streets in the aerial photos` | — | area && raster && traceRoads && sources.raster |
| 6 | `Building road and terrain meshes` | — then i/chunks per terrain chunk | always |
| 7 | `Reading line markings from the aerial photos` | — | markings && raster && trace |
| 8 | `Placing scenery` | — | always |
| 9 | `Writing track files` | — | always |
| 10 | `Done` | 1 | always, last |

Note #6 is first sent without a fraction (before road materials), and #7 comes *during* #6's work (markings are built before the terrain chunks). Keep the order exactly; each `await progress(...)` is a yield point.

Errors thrown (messages are shown to the user, keep them):
- `Pick a start and a finish on the map first` (route.length < 2).
- `` `Road is ${Math.round(timedLength)} m; make it at least 300 m` `` (MIN_LENGTH = 300), checked after planning and before tracing.

`buildTrack` returns no warnings list: missing-data warnings live in pipeline.ts (`dataWarnings`). Silent fallbacks inside this module are listed per stage below.

---

## 5. The flow, stage by stage

Each stage: **reads**, **does**, **produces**. "Ctx" means the shared build context (section 13). Line references are to the old file for the lead's cross-checking only; the rewriting session doesn't need them.

### S1. Route plan (old 449–480)

Reads: `route`, `opts.origin, area, clears, pitCount, runUp, runOff` (+ everything planRoad reads), `sources.widthAt, roundabouts, osm.roundaboutRings, streets.lines`.

1. `centre`, `proj`, `local = route.map(toLocal)`.
2. **Clears** (landmark and layer spots): `clears = opts.clears.map(c => ({c: toLocal(c.at), r: c.radius, trees: c.trees !== false}))`. `cleared(x, y, trees = false)` = some clear with distance < r, and when asking about trees only clears with `trees` true count. (So `cleared(x, y)` clears buildings/things in every circle; `cleared(x, y, true)` clears trees only where the circle clears trees.)
3. **Area**: `rings = areaRings(opts.area)`; `area = rings.length ? new Area(rings in local) : null`; `areaPts = area ? area.ring : []` (all rings' points flattened).
4. `widthFn(x, y) = sources.widthAt(toLngLat([x, y]))` when the source exists.
5. **Roundabouts on the route**: `hinted = resolveRoundabouts(sources.roundabouts ?? [], osm.roundaboutRings ?? [], proj)`. `tileRings` = street lines with more than 5 points whose first and last points are within 2e-5° (closed rings), in local. `circles = [...hinted, ...ringsOnRoute([...osmRingPts, ...tileRings], local, hinted)]`.
6. **Run-up/run-off** (point to point only): if `!isLoop(local) && (runUp > 0 || runOff > 0)`: `ext = extendRoute(local, streetLinesLocal, GRID_DEPTH + rows·8 + runUp, runOff)` with `GRID_DEPTH = 14`, `rows = ceil(pitCount / 2)`. Else null.
7. `plan = planRoad(ext?.path ?? local, opts, widthFn, circles)`.
8. If ext: `total = pathLength(ext.path)`; `plan.timed = { start: sampleNearPin(plan, local[0], ext.startAt/total), finish: sampleNearPin(plan, local[last], ext.finishAt/total) }`.
9. `timedLength() = plan.timed ? s[finish] − s[start] : plan.length` (a function: tracing changes `s` later, and the stats/ui read it at the end). Throw if under 300.

`sampleNearPin(plan, pin, frac)`: estimate `est = frac · lastS`, window `max(60, lastS · 0.05)`; nearest sample to the pin among those with `|s − est| ≤ window`; if none, among all; return max(0, best).

Produces: `proj, centre, local, clears, cleared, area, areaPts, rings, tileRings, plan, timedLength`.

### S2. Trace the route (old 482–502)

Only when `opts.traceRoads && sources.raster`. Reads `opts.noTrace, traceGuard`.

1. `reach = max(16, 1.5 · max sample width)`; `raster = await sources.raster(proj, samplePositions, reach)` (2-argument path form, no maxZoom).
2. If a raster came back: `trace = traceRoad(plan, raster, undefined, opts.traceGuard)`.
3. noTrace zones: for every sample, `keep = min(1, ...zones.map(z => clamp01((dist − z.r) / 30)))` (0 inside a zone, ramping to 1 over 30 m outside); `trace.offset[i] *= keep; trace.conf[i] *= keep`.
4. `applyTrace(plan, trace, i => !!inRoundabout(plan, pos_i, 0.5))` (moves samples, recomputes s, widths, ring sIn/sOut, plan.length).

Produces `raster: RasterSampler | null`, `trace: TraceResult | null`. Both stay null on failure (silent: the route stays on the OSM line).

### S3. Elevation, sea, zones (old 504–556)

Reads `opts.corridor, terrainBlend, demZoom, horizon, sea, photoSea, zones, cspTrees`, `sources.dem, coast, jetty`.

1. `bounds = boundsOf([...samplePos, ...areaPts], corridor + terrainBlend + 60)`; `landDem = await sources.dem(proj, bounds, demZoom)`.
2. `farBounds = boundsOf(same points, horizon + BACKDROP_CHUNK)`; `landFarDem = horizon > 0 ? await sources.dem(proj, farBounds, min(demZoom, 12)) : landDem`. (Two calls, in that order.)
3. Coast, only with `opts.sea` (else all empty): `ocean`, `piers`, `beaches` = `sources.coast.{ocean,piers,beaches}` to local `CoastPolygon {rings, edge}`.
4. `onJetty(x, y)` = inside some pier's first ring. `jettyFeatures` = local copy of `sources.jetty` only when there are piers and a jetty source, else null.
5. `sea = new SeaMask(ocean, farBounds)`; `dem = ocean.length ? withSeabed(landDem, sea) : landDem`; same for `farDem`.
6. `zones = opts.zones ? new ZoneMap({toLngLat, toLocal, landcover: coast.landcover, sea: ocean.length ? sea.has : undefined, bounds: farBounds}) : null`.
7. `treeModels = opts.cspTrees ? MODEL_NAMES : TREE_SPECIES names`.
8. **Area roundabouts** (only with an area): candidate ways = OSM roundabout rings (with lanes) + tileRings (no lanes), each fitted (`fitCircle`), kept when `4 ≤ r ≤ 40` and `rms < 2.5`. Group ways whose fitted centres are within 8 m of any way already in a group (first-fit, in order). Per group: refit all points (fallback to the first way's fit); skip when the centre is outside the area, or within `rb.r + 10` of an existing plan roundabout. Lanes = max(1, lanes of the group). Push `{c, r, w: max(7, lanes ≥ 2 ? lanes·4.6 : 0), lanes, hc: 0, sIn: NaN, sOut: NaN, crossings: [], kerbed: true}` onto `plan.roundabouts`.
9. `applyElevation(plan, dem, opts)`; `index = new SegmentIndex(plan)`; `terrainAt = makeTerrainFn(plan, index, dem, opts)`.
10. `cover = makeCover(index, opts, area)`; `inCover(x, y, k = 0) = cover(x, y) ≤ corridor − k`.
11. `chunks = planTerrainChunks(plan, index, opts, area)`; `backdrop = planBackdrop(plan, index, opts, area)`.

Produces `dem, farDem, bounds, farBounds, ocean, piers, beaches, onJetty, jettyFeatures, sea, zones, treeModels, index, terrainAt, cover, inCover, chunks, backdrop`. Note `terrainAt` reads `plan.samples[*].kerb` and `plan.roundabouts` **live** (B1).

### S4. The base material kit (old 559–654)

Registers the fixed textures and materials, in the exact order of section 6, steps 1–9. Reads `opts.detailShaders, zones, ocean, photoSea, jettyFeatures`. Defines the registry helpers the rest of the build uses (section 13: `addScenery`, `reliefScenery`, `buildingScenery`, `photoMask`, `photoGroundMaterial`). `photoSea = opts.photoSea !== false && ocean.length > 0`.

### S5. Aerial imagery (old 656–749)

Only when `sources.imagery && opts.imageryZoom > 0`. Reads `opts.imageryZoom, textureSize, horizonZoom, carParks, buildings, detectBuildings, parkedCars, carParkIslands, detailShaders, trees`.

Before the loop (only with `carParks`, else empty): `streetLines` = local street lines except classes matching `^(path|footway|cycleway|track|steps|pedestrian|bridleway)` plus the route's sample positions as one more line; `parkingLines` = lines with class `^(service|parking_aisle)`; `osmRings` = OSM building rings, local.

Jobs: every terrain chunk `{zoom: imageryZoom, size: textureSize, prefix: "terrain"}` then every backdrop chunk `{zoom: horizonZoom, size: 512, prefix: "backdrop"}`. **Sequentially**, in that order; before each, `progress("Fetching aerial imagery", done/jobs)`. `img = await sources.imagery(proj, chunk, zoom, size)`; null → skip (chunk stays untextured).

Per job with an image:
1. **Paint out parked cars** (carParks && img.rgba && terrain): roofs = `detectBuildings(...)` rings when buildings && detectBuildings, else none; `clean = paintOutCars(rgba, size, span/size, footprintMask([...osmRings, ...roofs]), {carParks: lineMask(parkingLines, 15), streets: lineMask(streetLines, 14)})`.
2. If clean: `carsPainted += clean.cars`; with `parkedCars`, each spot becomes a `PhotoCar {at: [minX + (px+.5)·m, maxY − (py+.5)·m], dir: [dir0, −dir1], paint: paintFor(rgb), row?}`; with `carParkIslands`, `findIslands(clean.rgba)` rings are kept with their chunk.
3. Sea photos (photoSea && rgba && `sea.near(chunk centre, span·0.71)`): `{chunk, rgba, size}` kept (the raw photo).
4. `toned = beachLook?.tone(chunk, clean?.rgba ?? img.rgba, size)` (beachLook = photoSea ? `new BeachLook(beaches, sea)` : null); count `beachChunks`.
5. Texture name `${prefix}_${chunk.key}.${clean || toned ? "dds" : img.ext}`; data = DXT1 of `toned ?? clean.rgba` when either, else `img.data` untouched.
6. Material `${prefix}_${key}`: with detailShaders and a photo (toned ?? clean ?? img.rgba) on a terrain chunk → push texture, then `groundMaterial(name, tex, photoMask(name, photo, size, size, chunk), photoLight)`, wrapped in `withSandDetail` when toned. Else push texture and `material(name, tex, photoLight)`. `photoLight = {ambient .6, diffuse .2, specular 0, exp 1}`.
7. `textured.add(chunk.key)`.
8. Terrain chunk with rgba: tree spots (`treeSpotsFromImagery(rgba, size, chunk, opts.trees)`), detected buildings (buildings && detectBuildings), and the **raw** photo into `photos` (for frontage, ring photos, kerb returns, groundAlbedo).
9. Backdrop chunk with rgba and `opts.trees > 0`: far tree spots (density 1).

After the loop (these run whether or not imagery ran):
- `seaLayer = photoSea ? buildPhotoSea({ocean, piers, photos: seaPhotos, bounds: farBounds}) : null`; its textures, then materials.
- photoSea → `addScenery("shore_foam.png", foamTexture(), foamMaterial())`.
- beachChunks && detailShaders → texture `ground_sand.dds`.

Produces `textured, treeSpots, farTreeSpots, detected, parkedSpots, carsPainted, islandsFound, photos, seaLayer`.

Note detectBuildings runs **twice** per terrain chunk when carParks is on (once on the raw photo for the paint-out mask, once for `detected`); identical input, so identical output (a cost, not a bug).

### S6. Side streets (old 751–773)

Reads `opts.sideStreets, traceRoads`, `sources.streets`.

1. `streetPlan = planSideStreets(opts.sideStreets ? streets.lines : [], streets.names ?? [], plan, index, opts, proj, area)`. (Uses `plan.roundabouts` including the area rings from S3.8.)
2. Area street photo: with area && raster && traceRoads && sources.raster: progress #5; `far` = streets with any point not within 60 m of the route (`!index.nearest(x, y, 60)`); `extra = far.length ? await sources.raster(proj, farPts, 14, 19) : null`; `streetRaster` = a sampler trying `raster` then `extra`, with `display` combined the same way. Else `streetRaster = raster`.
3. `sideTraced = streetRaster && traceRoads ? traceSideStreets(streetPlan.streets, streetRaster, opts, index) : 0`.
4. `streetIndex = new LineIndex(streetPlan.streets)`.
5. `mouthList = streetPlan.junctions` (replaced in S9 with networkCore); `mouth(side, sd)` = some junction on that side with `|j.s − sd| < j.width/2 + 1.5`, or `net?.routeSInside(sd)`.

### S7. Buildings plan (old 775–850)

Reads `opts.buildings, detectBuildings, buildingRadius, vergeWidth`, `sources.osm.buildings, pois`.

1. **Determinism sorts**: `detected` by centroid (y, then x); `parkedSpots` by (at.y, at.x, dir.x, paint).
2. `mapped = opts.buildings ? osm.buildings.map((b, i) => fromOsm(localRing, tags, i)) : []`.
3. `photo = chunkPhotoSampler(photos)` (null with no photos).
4. **Frontage houses** (photo && buildings && detectBuildings): `realStreets` = streets with class `^(primary|secondary|tertiary|minor)`; `builtUp(x, y)` cached per 50 m cell: ≥ 4 known building centroids (mapped + detected) within 150 m of the cell centre, or ≥ 3 real streets with a point within 120 m. `onRoad(x, y)`: within route half-width + 1, or `streetIndex.clearance < 1`. `frontageHouses([route line with half widths, ...street lines with half widths], photo, onRoad, builtUp, [...mapped, ...detected], nS)`.
5. `kept = filterBuildings([...mapped, ...detected, ...frontage], index, opts, buildingRadius)` then drop: any vertex in a roundabout (margin vergeWidth + 2); any vertex with street clearance `< 1` (detected/frontage) or `< −0.5` (osm); centroid on a jetty, or inside a jetty building whose outline touches a jetty or the sea.
6. `dressBuildings(kept, {roadEdge, pois})` (section 5a below).
7. `finishes = usedFinishes(kept)`; register each facade (`facadeScenery`) then each roof (`buildingScenery("roof_<name>", roofTexture(c), {.45, .45, metal ? .25 : .05, 25}, 4)`), in Set order.

**5a. dressBuildings** (keep exactly; B4 is about unifying later). For each building: if no `front` and ≥ 3 points, find the wall: edges of length ≥ 3 m whose midpoint is nearest a road edge (`roadEdge` < best, starting at 25) **and** whose outward point 2 m out is more than 1 m closer to a road; set `front`, `setback`. Ring orientation from `ringArea ≥ 0` (ccw) picks the outward normal. POIs inside the ring: the first shop-like one (`^(shop|grocery|clothing_store|cafe|restaurant|fast_food|bar|pub)$`) or the first. `knownHeight` = tags height or building:levels or render_height ≠ "5". Call `dressBuilding({height: osm && knownHeight ? b.height : undefined, kind: tags.building, area: |ringArea|, poi: cls, photoRoof: (source ≠ osm || tags["roof:colour"]) ? roofColour : undefined, rectangle: isRectangle, fronted: setback < 15, seed})` with `seed = (imul(round(cx·10)|0, 73856093) ^ imul(round(cy·10)|0, 19349663)) >>> 0` of the centroid; `Object.assign(b, dress, {garage: dress.garage ?? b.garage})`.

`roadEdge(x, y) = min(route nearest (40 m) dist − width/2, streetIndex.clearance)`. The same function is later called `roadGap` (B5).

### S8. Road materials, town level, speed (old 852–961)

Material factories (they register on first use, so **call order decides texture order**, section 6):
- `roadMaterial(ci, meanWidth, mid)`: kind = `opts.roadSurface` if `asphalt|chipseal`, else asphalt when road class at mid matches `^(motorway|trunk|primary)`, or ≥ 8 kept-building first vertices within 150 m, or `mid.kerb` is set; else chipseal. Name `road_${kind}_${twoLane ? 2 : 1}_${ci % 3}` (twoLane = meanWidth ≥ 5.5). First use: `sealTexture(kind, twoLane, ci % 3)` into previewTextures as `${name}.dds`; with detailShaders: texture `${name}.dds` = DXT5 of the rgba with alpha zeroed, `${name}_nm.dds` = DXT1 of `normalFromHeight(rgba, 3)`, `multiMapMaterial(name, tex, light, {normal, maps: "maps_asphalt.png", detail: "detail_${kind}.png", detailUV: 9, sunSpecular: .15})`; else the texture's own `dds` and `material`. Light `{.4, .45, asphalt ? .08 : .04, 20}`.
- `gravelMaterial(ci, meanWidth)`: sets `anyUnsealed = true`; name `${GRAVEL_MATERIAL}_${1|2}_${ci % 3}`; same pattern with `gravelTexture`, normal strength 4, maps `maps_ground.png`, detail `detail_chipseal.png`, sunSpecular .02; light `{.42, .45, .02, 10}`.
- `chunkMaterial(ci, w, mid, a, b)` (route chunks): with `roadSurface === "photo"`, raster, trace and `a ≥ 0`: if ≥ 30% of samples a..b (wrapping) have conf > 0.7, register `road_photo_${ci padded to 3}` (`photoRoadTexture(plan, displayOf(raster), a, b, trusted)`, DXT1, preview, light `{.42, .45, .06, 20}`) and return `{material, perChunk: true}`; else `roadMaterial(ci, w, mid)`.
- **Unsealed**: `gravelOn = opts.gravelRoads !== false`; `unsealedAt = (gravelOn || opts.unsealed) ? unsealedSamples(plan, gravelOn ? osm.unsealed local : [], !!opts.unsealed) : zeros(nS)`; `anyUnsealed = unsealedAt.includes(1)` (and set again by gravelMaterial).
- **Town level** per sample, computed at every 5th sample and copied forward: 0 if the road class matches `^(motorway|trunk)`; else with `houses` = kept first vertices within 150 m and `grid` = real streets with a point within 120 m: 2 if houses ≥ 20 or grid ≥ 5, 1 if houses ≥ 8 or grid ≥ 3, else 0.
- **speedAt(i)**: motorway/trunk → town ? 70 : 100; primary → town ? 60 : 90; else town ≥ 1 ? 50 : 80.

### S9. Network core (old 962–976)

Only `opts.networkCore && area`. `net = planJunctionCore({lines (all street lines local), rings (OSM roundabout rings local), route: {samples, closed, length, crown, nearest}, streets, builtRings: plan.roundabouts, terrain: terrainAt(x,y).h, inArea: area.signed < −5, routeRowOk: unsealedAt[i] !== 1, streetOk: !(gravelOn && isUnsealed(street))})`; `mouthList = junctions not covered by net (coversRouteRow(j.seg))`. Runs **before kerbs are recorded**, so it sees kerb-less terrain (B1). Off in every route today.

### S10. Kerbs (old 977–1019)

Only `opts.kerbs` (else all zero).
1. `evidence = raster && trace ? kerbEvidence(plan, raster, conf > .7) : null`.
2. `kerbBlocked(i, side)`: inside net's route rows; a mouth on that side within `j.width/2 + 4`; the inside of a turn tighter than `reach + 3` (reach = half + vergeWidth + STRIP_EXTRA, inside = curvature·side > 0 and 1/inside < reach + 3); or at any of t = half + 0.3, half + KERB_BACK, half + 1.5, reach out on that side: in a roundabout (1.5), street clearance < 0.5, or on another stretch of route asphalt (nearest within 30 has dist < width/2 − 0.2).
3. `kerbs = planKerbs(plan, evidence, i => town[i], kerbBlocked)`; zero both sides wherever `unsealedAt` is 1.
4. Each route roundabout (sIn not NaN): `kerbed` = some sample with a kerb within `outerRadius + 30`. Area rings keep `kerbed: true`.
5. **Record on the samples**: `smp.kerb = [k0, k1]` where either side > 0 (terrainAt and roadMaterial read it from now on).
6. `kerbAt(i, side) = kerbs[side 1 → 0, −1 → 1][wrap(i)] > 0`.

### S11. Road surfaces (old 1020–1188)

In this order (texture order depends on it):
1. `roadMeshes = buildRoadMeshes(plan, opts, chunkMaterial, (i, side) => mouth(side, s_i) || kerbAt(i, side), anyUnsealed ? {at: unsealedAt[i % nS] === 1, material: gravelMaterial} : undefined, net ? {quad: net.routeQuadSkip, ring: net.handlesRing} : undefined)`.
2. **Ring openings**: per roundabout k: `roadMeshes.openings[k]` plus, for each side street end point within `outerRadius + 6` of the centre, the angular gap `atan2 ± (st.width/2 + 2.5)/Ro`; set `rb.openings` when any.
3. `stripMaterial(ci, a, b)`: no raster or imageryZoom ≤ 0 → `{material: "grass", photo: false}`; else register `strip_photo_${ci padded}` (stripPhotoTexture, DXT1, preview, `photoGroundMaterial`).
4. `surface = streetSurface(plan, index, opts, terrainH)`; `streetAt` = for each mouth, the street with a join point within 4 m of the route edge at the mouth; `streetEdge(ji, c, R)` walks that street from the join, from R to R + 40 m along it, giving edge points `{pos, out, z: surface(st, k, sideSt·w)}`, stopping near the route (after R + 4, within width/2 + 4) or in a roundabout (4); null with ≤ 4 points. (Keep the geometry exactly: `sideSt` from the sign of `tan·c·(−d0y, d0x)`.)
5. Kerb returns (kerbs on): `buildKerbReturns(plan, opts, mouthList, kerbs, roadMaterial(0, 6, {...samples[0], kerb: [1,1]}), raster && imageryZoom > 0 ? displayOf(raster) : undefined, streetEdge, photo ?? undefined, streetIndex.clearance)`. Note the `roadMaterial(0, 6, kerbed)` argument is evaluated (registered) **before** the call. Then `sidestrips_photo.dds` (texture, preview, photoGroundMaterial) if `sideAtlas`, then `returns_photo.dds` if `atlas`.
6. `verge = kerbs && raster ? readVerge(plan, raster, kerbs, stripOuter, streetClearance < .5) : null` (stripOuter = vergeWidth + STRIP_EXTRA).
7. `kerbMeshes = buildKerbs(plan, opts, kerbs, stripMaterial, net ? union(returns.noRamp, net.noRamp) : returns?.noRamp, verge ? laybacks(nS, verge) : undefined)`.
8. `vergeConcrete = verge ? buildVergeConcrete(plan, verge, vergeGround) : []`, `vergeGround` = strip top (`surfaceHeight` at the road edge on that side + KERB_H) within the strip, else terrain.
9. **Side streets**: `photoStreets` (roadSurface photo && raster): traced streets with > 50% conf > .7, nearest 40 to the route. `sideStreets = buildSideStreets(streets, plan, index, opts, net ? net.streetGround(terrainH) : terrainH, materialFor, net?.streetSkip)`, where materialFor(st, i) = `side_photo_${i padded}` (128 × h, h the power of two from 64 to 2048 with h ≥ length/0.12; `perStreet: true`) for photo streets with a streetRaster; else gravel when `gravelOn && isUnsealed`; else `roadMaterial(i, st.width, {...samples[0], pos: mid point})`.
10. **Markings** (progress #7 when markings && raster && trace): `imageLines = findLines(plan, paintCandidates(plan, raster, trusted), trusted)`; `covered(i)` = trusted and within 40 m (in samples) of a found line. Discrete marks from `sources.seen` (`marking--discrete--...` values: stop-line, give-way, crosswalk-zebra, arrow--*, text--*, symbol--bicycle), snapped to the route within 15 m and inside width/2 + 1, deduplicated (same kind within 8 m; arrows/text/symbols only when on the same side within 1.6 m). Plus start and finish marks at the timed samples. `markings = opts.markings ? buildMarkings(plan, opts, skip, noEdge, {lines, covered}, marks) : []`, skip(sd) = in a roundabout (1) or unsealed at `round(sd/spacing)` or `net.routeSInside(sd)`; noEdge(side, sd) = mouth or kerbAt(round(sd/spacing)).

### S12. Roundabouts, junctions, kerbside (old 1189–1240)

1. `ringPhoto(rb, k)`: 256 px square over `vergeOuterRadius + 1`; null unless ≥ 90% of pixels are covered by `photo`; registers `rbphoto_${k}` (DXT1, preview, photoGroundMaterial). Missing pixels (0.45, 0.45, 0.4).
2. `ringGround = meshTop(terrainAt, opts)`. For each ring not handled by net: `nearest` = sample with s closest to `rb.sIn`; `buildRingMeshes(rb, k, opts, roadMaterial(floor(index(nearest)/120), rb.w, nearest), ringPhoto(rb, k), ringGround)`; push `road, island, verge, ...kerb` to `ringNodes`; with markings, `buildRingMarkings(rb, k)` into markings. (Argument order: roadMaterial is registered before ringPhoto.)
3. `netMeshes = net?.build({routeKerb, stripOut, vergeWidth, markings, roadMaterial: pj => roadMaterial(pj.id, 4, {...samples[0], pos: pj.j.centre, kerb: [1,1]})})`; `netNodes = [...road, ...dress]`; its markings appended.
4. **Kerbside** (markings && kerbside): `kerbsideForTrack(plan, sideStreets ? streets : [], index, opts, terrainH, osm.kerbside ?? [], toLocal, parkedSpots)`; its nodes into markings. `bayBoxes = kerbside && opts.laneBayClear !== false ? kerbside.boxes : []`.

### S13. Terrain and the one ground (old 1241–1275)

1. `groundAt = underStreets(terrainAt, streetCeiling([...sideStreets, ...kerbReturns.filter(isStreetNode), ...netNodes], opts.terrainStep))`.
2. Terrain chunks in order, with progress #6 fraction i/chunks: `buildTerrainChunk(chunk, groundAt, opts, textured.has(key), area, streetClearance < 4)`; non-null into `terrainNodes`.
3. `farGround = backdropSurface(farDem, index, opts, area ? cover : undefined, terrainH)`; backdrop chunks: `buildBackdropChunk(chunk, farDem, index, opts, textured.has(key), area ? cover : undefined, terrainH)`.
4. `walls = buildWalls(plan, opts, terrainH, index)` (invisible walls on the analytic terrain).
5. `onRoad = onRoute(plan, index)`; `kerbsClear = keepOffRoute([...gutter, ...kerb, ...strip, ...kerbReturns, ...vergeConcrete], onRoad)`; `ringsClear = keepOffRoute(meshes of ringNodes, onRoad)`.
6. **`ground = sceneGround([...road, ...verge, ...sideStreets, ...kerbsClear.nodes, ...ringsClear.nodes, ...netNodes, ...terrainNodes], terrainH)`**: the topmost physics mesh, else analytic terrain. Has `ground(x,y)`, `.mesh(x,y)` (null off every mesh), `.underRing(ring)`, `.forRing(ring)`.
7. `poleOnRoad = opts.poleClear !== false ? onRoadFrom(topSurface([...road, ...sideStreets, ...kerbsClear, ...ringsClear, ...netNodes], ROAD_SURFACE)) : undefined`.

### S14. Scenery (old 1276–1533), progress #8

In this order (several register textures):
1. **Trees**: `kerbedNear[i]` = a kerbed sample within ±150 m (in samples, wrapping on loops). `plantCtx = {zones, models, cspTrees, where: t => ({town: kerbedNear[nearest within corridor + 10], foreshore: ocean && sea.near(t, 120)}), toLngLat}`. `planted0 = filterTrees(treeSpots, index, opts, maxTrees, area ? cover : undefined).map(plantTree).filter(nonNull)`; with zones filter again. `treesKept` = off rings (vergeWidth + 3), street clearance > 1.5, not `cleared(x, y, true)`. `trees = cspTrees ? [] : buildTrees(treesKept, ground, "TREES")`; `trunks = treeTrunks(treesKept, ground)` (always, even with CSP trees).
2. **Horizon trees**: far spots with `!inCover(x, y, −5)`, `cover < 1000`, not sea; subsample by `farStep = max(1, n/3000)` (index `floor(i·farStep)`); `horizonTree(t, zones, species names)`; `buildTrees(..., (x,y) => farGround − 0.6, "HORIZONTREES", 0.3)` with `castShadows: false`.
3. **Barriers**: `buildBarriers(osm.barriers local, index, opts, ground, ok = streetClearance > 1.5 && !inRoundabout(vergeWidth + 3), area ? cover : undefined)`.
4. **Farm** (`opts.farmland`): `buildFarmland(farmland local, barriers local, index, opts, ground, ok && !cleared, cover)`; `vine_leaf.png` registered when `vineMetres`.
5. **Island trees**: per ring with `trees > 0` and `innerRadius ≥ 4`: a centre tree (scale min(.9, ri/12), variant 0) and `floor(ri)` shrubs at 0.55·ri (scale .22, variant k % 2); `buildTrees(..., ground, "ISLANDTREES")`.
6. **Paths** (`opts.paths` && sources.paths): `pathOnRoad = onRoadFrom(topSurface([road, sideStreets, kerbsClear, ringsClear], PATH_BLOCK))` (note: no netNodes); `serviceIndex` of service/parking_aisle lines (not bridges/tunnels, width 5); `buildPaths(lines, ground, ok(x, y, half, kind), inCover(x, y, 5))` with ok = outside every ring's `vergeOuterRadius + half + .3`, outside route width/2 + .5 + half, (foot only) not on the photo's verge concrete band ±1 m, service clearance ≥ half + .3, street clearance > half + .3, not in a roundabout (half + 2), `!footOnRoad`. Textures `path_shared.png`, `path_foot.png` then their materials, when any mesh.
7. `ringWalls = rings.map(buildRingWall(rb, k, opts, terrainH))`.
8. **Rails**: `osmRails` (guardRails); `needs = railNeeds(plan, opts, terrainH, osmRails, index)`; with armco && guardRails: `armcoNeeds(plan, opts, needs, {ground: terrainH, index, speedAt, crossings local})`. Then clear: everything without guardRails; across mouths; near rings (`inRoundabout(sample, 15)`); kerbed samples. `rails = armco ? buildArmco(...) : buildGuardRails(plan, opts, needs, ground)`. `postMask = needs || nearRing || mouth || kerbAt`; `posts = guidePosts ? buildGuidePosts(plan, opts, postMask, ground) : []`.
9. **Farm roadsides** (`farmRoadsides`): `buildFarmRoadsides({lines, cattleGrids, plan, index, opts, ground, drawn: streetClearance < .5, blocked: !inCover(3) || streetClearance < .2 || in a kept building || inRoundabout(3), skip: town ≥ 2 || kerbAt})`.
10. **Traffic lights** (`trafficLights !== false` and OSM signals): `findSignalSites(signals local, [route line (closed loops repeat the first point) as main, ...streets except parking_aisle/driveway/drive-through when sideStreets], inRoundabout(6))`; `buildTrafficLights({sites, roadZ: ground, groundZ: ground, onRoad: within route width/2 + .3 || streetClearance < .3 || poleOnRoad})`. Register `trafficLightMaterials()` when signals, then `farmTextures()` when farmRoad.
11. Ground helpers for buildings: `horizonGround = farGround − 0.6`; `onBase(x,y) = inCover(x, y, 1) || ground.mesh(x, y) !== null`; `buildingGround = onBase ? ground : horizonGround`; `onBaseRing(ring) = any vertex onBase || centroid onBase`; `shoreGround = inCover(1) ? terrainH : horizonGround`.
12. **Utilities**: `seenLocal = mergeSightings(seen local)`; `placeUtilities({poles: seen utility poles + OSM poles, lamps: seen street lights + OSM lamps, lines: OSM power lines}, plan, index, opts, ground, town, blocked: streetClearance < 1 || in a kept building, poleOnRoad)`.
13. **Car park lights**: `carParkLights(parking_aisle lines local, ground, blocked: !inCover(5) || near route (width/2 + 2) || streetClearance < 1.5 || inRoundabout(3) || in a kept building || a parked spot within 3 m, utilities.lights, poleOnRoad)`.
14. **Jetty**: `jettyLamps = piers ? jettyLights(piers, shoreGround, sea) : empty`; `jettyPrecinct = jettyFeatures ? buildJettyPrecinct(jettyFeatures, pierDeckZ(shoreGround, sea), onJetty, SEA_LEVEL) : empty`.
15. **Race dressing** (`raceDress`): `raceDressing(plan, opts, art, {ground, blocked: route width/2 + .2 || streetClearance < .8 || in a kept building}, opts.sponsors)`; registers race_concrete, race_tyres, marshal, then cutouts race_fence, race_crowd, race_spectators (`ksPerPixelAT`, alpha tested). `raceFlags = race && wavingFlags !== false ? takeRaceFlags(race.pieces) : null`; `flag_race.png` when any flags.
16. **Pieces** (one `ArtList`), in order: street signs (streetSigns), landmarks signs (landmarks: POIs local; clearance = min(streetClearance, −1 inside any kept building)), seen features (seen local, minus traffic lights within 35 m of a signal site when signals were built), race pieces (`raceFlags.rest ?? race.pieces`) or `gateSigns`, kangaroo signs (streetSigns: town 0, speed ≥ 80, not kerbedNear; skip at mouths and within j.width/2 + 6 of a junction), utilities pieces, car park pieces, letterboxes (verge).
17. `atlas = sources.renderArt && art.list.length ? await renderArt(art.list) : null` → texture `signart.png`, material `signart` (alpha tested). `furniture = buildPieces(pieces, atlas)`.

### S15. Houses (old 1534–1707)

1. `roadGap` = roadEdge from S7. `shown = horizon > 0 ? kept : kept with every vertex inCover(1)`; `homes = shown` with 4 points, roof ≠ flat, height ≤ 7.5. (Both are mutable lists from here.)
2. `houseStyle`: each home of type `house` gets `facadeForStyle(houseStyle.facades, centroid)` when defined.
3. Homes without a front: the nearest of the 4 edge midpoints by roadGap (< 25); set front, setback.
4. **Looks** (`sources.houseLooks`, in order, index k): skip when `cleared(x, y)`.
   - **Spec** (look.spec and a finite roadGap): `toRoad` from `look.facing` (degrees from north: [sin, cos]) or minus the roadGap gradient (central differences ±1 m). Probe build at z 0 for footprints; `z = min over footprints of (onBaseRing ? ground.underRing(f) : horizonGround(centroid))`, or `buildingGround(x, y)` with none; build again at z. Remove from `shown` and `homes` every building whose centroid or any vertex is inside a footprint. Register the house's facades (buildingScenery, no dedupe), roofs not yet in finishes, solids (flag → flagMaterial unless wavingFlags false; surface → buildingScenery(surfaceTexture); else solid), signs (1024 × h, h = clamp(64, 512, round(1024·height/width/32)·32), drawn with `sources.drawSigns` or a solid board). Push nodes, trees; `housesLooked++`; next look.
   - **Match**: the home whose front midpoint is within 8 m (nearest); else a home containing the point; else the home whose centroid is within 6 m; such a match without a front gets the nearest edge of length ≥ 4 m.
   - **Place** (no match, look.place, finite roadGap): a 15 × 13 m plain house (`plainHouse(houseRoof(() => .3), surfmist, 3)`) facing the road, ring ccw with the front edge first, source "detected", setback max(2, roadGap(front[0])); push to shown and homes; register the surfmist roof if new.
   - Apply: facade (`facadeForLook(look.facade, look.colour, best.facade)`), frontKind, hedgeHeight; trees spread across the front yard halfway between the wall and the road (scale .85); `housesLooked++` when any of facade/front/trees applied.
5. Facades homes now wear that aren't registered yet: register (facadeScenery).
6. **Shopfronts** (buildings): `findShopfronts(shown minus cleared centroids, POIs local, roadGap, buildingGround, isHome)`; `buildShopfronts(shopfronts, buildingGround)`; when any: textures shop_sign.png, shop_window.png; materials shop_sign, shop_window, verandah; then texture verandah.png (`roofTexture(ROOF_COLOURS[1])`).

### S16. Parked cars, first pass (old 1708–1743)

1. `streetCentres = LineIndex(streetLines, width 0)`.
2. With `parkedBays !== false`: `placeParked(parkedSpots, {aisles: parking_aisle lines (width 6) when there are parkingLines, slots: kerbside slots with street ≠ 0, blocked(x, y, kerb): !inCover(5) || route width/2 + .3 || in a ring (outer + .5) || (!kerb && through-street clearance < .2) || in a shown building || in an island ring})`; `bayQuads = placed.bays`; `parked = placed.cars`.
3. Else the legacy filter on parkedSpots: inCover(5), off route (width/2 + .5), street centre clearance ≥ 2.4, street clearance ≥ −0.3, outside rings (outer + 2.5), not in a shown building.

### S17. Clears, buildings, islands, lots (old 1744–1791)

1. With clears: remove from shown and homes every building whose centroid is cleared; remove house trees cleared (trees rule).
2. `houses = buildBuildings(shown, buildingGround, b => onBaseRing ? SINK : 0.4, b => onBaseRing ? ground.forRing(ring) : horizonGround)`.
3. **Car park islands**: each found ring kept when every vertex is > width/2 + 2 off the route, street clearance ≥ .5, not in a ring (3), not in a kept building; `buildIslands(ok, ground, chunk, "terrain_<key>", key)`. Shrubs: grid every 1.8 m inset .8 m; draws `placeRandom(x, y, 0x5b00 + k)`, k = 0..5: jitter ±.4 (d0, d1), inside the ring, skip when d2 < .35 or the builder already has > 60,000 vertices; `shrub(builder, p, .6 + d3·.6, d4 < .5 ? 0 : 1, d5·π, top)` with top = max ground on the ring + .15. Mesh `ISLAND_SHRUBS` (material shrubs, casts shadows) when non-empty.
4. `lots = buildings ? buildLots(homes fully inCover(1), buildingGround, {roadGap}) : []`.

### S18. Assemble the model (old 1793–1842)

Section 7. `railsClear = keepOffRoute(rails.rails, onRoad)`; fences, farm, lots each through `keepOffRoute(..., onRoad).nodes`.

### S19. Traffic, parked cars second pass, CSP trees (old 1844–1993)

1. **Traffic data** (only `opts.traffic`): route runs split where "wide" changes (width ≥ 12, majority over ±30 m in samples, wrapping on loops), consecutive runs share their boundary sample; runs of ≥ 2 samples become roads `{pts, h, width: median, speed: median speedAt, speeds?: (trafficZones) per point}`. Loops: one run → `closed: true`; several → the last run merged into the first. Street roads: streets except parking_aisle/driveway/drive-through, `h = terrainAt + 0.1` (B15), speed 50, oneway, cls. Rings `{c, h: hc, rIn, rOut}`. trafficZones → `zoneRoads([...routeRoads with per-point cls, ...streetRoads], townCentreFromMap(toLocal, landuse, pois))`, else roads without cls. `withBayBands(roads, bayBoxes)` when any bays. `trafficInput = {roads, roundabouts}`; `trafficText = addTrafficLights(trafficJson(roads, rbs, trafficSetting), signals ? signalSites : [])`.
2. Parked within 1.8 m of a traffic lane (lanes from trafficText, AC points mapped back `[x, −z]`) dropped.
3. `clearParked(parked, {road: topSurface([road, kerbsClear, ringsClear], ROUTE_ROAD), street: through-street clearance, rings, lane})` → `parkedDropped = {...dropped, offAsphalt: 0, uneven: 0}`.
4. With cars left: `padClear !== false` and bays → `clearBays(bayQuads, parked, feetNear(model.root.children, bayQuads, ground))`, adding drops to `placed.dropped.blocked`. Pads `buildBayPads(bayQuads, ground, bayHeight(ground, topSurface(asphaltBuilt, BAY_ASPHALT)))` appended to the root as a **second** `CARPARKS` group (B7). Off-asphalt filter (`offAsphaltAt` with top = max(ground.mesh, islands/pads PHYSICS_GROUND), asphalt = asphaltBuilt + pads by ASPHALT). Uneven filter (`carSeat(c, carGround).sink ≤ TYRE_SINK + 1e-6`, carGround = max(ground, pad top)). `buildParkedCars(parked, carGround)`: non-`1WALL` meshes → `cullable([group PARKED_CARS])`, `1WALL` meshes → group `PARKED_CAR_WALLS`. Texture parked_car.png, material parked_car.
5. **CSP trees** (`cspTrees`): all = treesKept + houseTrees; model of a tree = `t.model ?? t.variant`; used = distinct valid models in first-seen order; `${slug}/extension/trees/<MODEL>.bin` per used model, `trees.txt` = `treeList` of trees with a used model, `pos: toAc(x, y, ground − 0.1)`, angle `cspTreeAngle(x, y)`, size scale.

### S20. Files, result, stats (old 1994–2166), progress #9 and #10

`kn5 = writeKn5(model)` (after every texture, material and node is in). `aiPoints = buildAiLine(plan, {keepLeft: aiKeepLeft, bays: bayBoxes with street 0})`. Landmarks for the test = `sources.landmarks` + spec looks (`name ?? "landmark"`), local; `shotList = landmarkShots(aiPoints, landmarkList)`. Files: section 8. Then layouts: `laid = opts.layout ? asLayout(files, slug, layout, dummiesKn5(layout, trackObjects(plan, opts))) : files`. Stats: section 9. `houses` = homes with a front: front and ring in lng/lat, height, facade name, source, roof, pitch, roofRgb.

---

## 6. Texture and material order (byte-identical kn5)

`textures` and `materials` are two ordered arrays; the kn5 writes them in array order and meshes refer to materials by index, so **order is output**. The rewrite keeps one ordered registry (section 13) and calls it in this order. Within a step, "T" is a texture push, "M" a material push; `addScenery` = T then M; `reliefScenery(name)` = (no detailShaders) T `name.png` M, (detailShaders) T `name.png`, T `name_nm.png`, M nmMaterial; `buildingScenery(name)` = T `name.dds` (+ preview), then (detailShaders) T `name_nm.dds`, M nmMaterial, else M material; `photoGroundMaterial(name)` = (detailShaders) T `name_mask.dds` then M groundMaterial, else M.

1. T verge.png (zones verge texture or plain), grass.png, wall.png; M verge, grass, wall.
2. addScenery: trees (ksPerPixelAT, alphaTested), paint, paint_yellow, rrpm, timber, glass, canopy, lamp, signal, rail.
3. reliefScenery `barrier_<b>` for each of BARRIERS (strength 2 for hedge, else 3).
4. addScenery: window, door, garage, letterbox.
5. detailShaders only: T detail_asphalt.png, detail_chipseal.png, ground_grass.dds, ground_dirt.dds, ground_plain.dds, black.png, mask_grass.png, mask_dirt.png; **replace in place** M grass → groundMaterial(grass, mask_grass), M verge → groundMaterial(verge, mask_dirt); T flat_nm.png, maps_ground.png, maps_asphalt.png.
6. addScenery: wire, steel, concrete, guidepost.
7. sea.png: photoSea → seaSurfaceTexture/seaSurfaceMaterial; else seaTexture + material sea. (Always registered, sea or not.)
8. reliefScenery rock (4); addScenery jetty_deck; JETTY_MATERIALS (only with jettyFeatures); addScenery jetty_timber.
9. reliefScenery `fence_<c>` per FENCE_COLOURS (2); frontwall_limestone, frontwall_brick (3); addScenery hedge, mulch, shrubs (alpha tested).
10. Imagery, per job in order (S5.5–6).
11. seaLayer textures, seaLayer materials; shore_foam; T ground_sand.dds.
12. Building finishes: facades, then roofs (S7.7).
13. Road surfaces as first used, in call order: buildRoadMeshes' chunk materials (road_*, gravel_*, road_photo_*), returns' `roadMaterial(0, 6, kerbed)`, sidestrips_photo, returns_photo, strip_photo_* (buildKerbs), side streets (side_photo_*, gravel, road), per ring: roadMaterial then rbphoto_k, net road materials.
14. vine_leaf; path_shared/path_foot (T, T, M, M); traffic light materials; farm textures; race (3 addScenery + 3 cutouts); flag_race; signart.
15. Spec looks' facades/roofs/solids/signs; placed-house surfmist roof; homes' new facades; shop textures (T sign, T window, M sign, M window, M verandah, T verandah).
16. parked_car (T, M), after the model is assembled.

Previews: `previewTextures` gets the raw RGBA of every DXT texture the 3D preview can't decode (building finishes, road and gravel seals, photo road/strip/side/ring/return textures). Order doesn't matter (an object keyed by name).

---

## 7. The model tree

Root: group `slug`, identity transform, children in this order:

```
cullable([                                   // split by area, small detail given draw distances (cull.ts)
  ROAD          roadMeshes.road
  SIDESTREETS   sideStreets
  JUNCTIONS     netNodes
  FURNITURE     furniture
  RACE          race.nodes + buildRaceFlags(flags)
  WIRES         utilities.wires
  ROUNDABOUTS   ringsClear.nodes, island tree meshes (ISLANDTREES*), ringWalls
  MARKINGS      markings (incl. ring markings, net markings, kerbside nodes)
  VERGE         roadMeshes.verge
  KERBS         kerbsClear.nodes
  TREES         trees (TREES*) + HOUSETREES* (house trees, not with cspTrees)
  RAILS         railsClear.nodes + rails.posts
  GUIDEPOSTS    posts
  FARMROAD      farmRoad.nodes
  TRAFFICLIGHTS signals.nodes
  BUILDINGS     houses + spec house nodes
  SHOPS         shopMeshes
  FENCES        keepOffRoute(barriers)
  FARM          keepOffRoute(farm.nodes)
  PATHS         pathMeshes
  LOTS          keepOffRoute(lots)
  CARPARKS      islandNodes (+ ISLAND_SHRUBS)
  JETTY         piers ? buildPiers(piers, shoreGround, sea) + jettyLamps.nodes + jettyPrecinct.nodes : []
  SEAWALL       ocean ? buildSeawall(beaches, shoreGround, sea, within 250 m of the route, piers) + buildGroynes(osm.groynes, shoreGround) : []
])
TERRAIN         terrainNodes                     (not culled: already chunked)
HORIZON         backdropNodes + horizonTrees
SEA             ocean ? buildSea(ocean, photoSea ? {transparent} : {}) + seaLayer.nodes + (photoSea ? buildShoreFoam) : []
WALLS           walls + trunks + house tree trunks
AC_* dummies    trackObjects(plan, opts), only when !opts.layout (section 7a)
--- appended in S19, only when parked cars remain:
CARPARKS        bay pads (second group of this name, not culled)
PARKED_CARS     cullable(car meshes)
PARKED_CAR_WALLS 1WALL car boxes
```

Groups are created even when empty (an empty group is still written). Keep the order and the empty groups for the golden.

**Who depends on the names** (don't rename without changing them too):
- `groundCheck.ts`: `SURFACE_GROUPS` = ROAD, SIDESTREETS, VERGE, KERBS, ROUNDABOUTS, TERRAIN, CARPARKS (the ground); `PLACED_GROUPS` = FURNITURE, TRAFFICLIGHTS, TREES, BUILDINGS, SHOPS, FENCES, FARM, FARMROAD, PATHS, LOTS, RAILS, GUIDEPOSTS, PARKED_CARS; `PLACED_MESHES` `^(ISLANDTREES|ISLAND_SHRUBS)` (placed things inside ground groups); `SKIP_MESHES` `^(MARKINGS|PATH_EDGE|ARMCO_|1WALL_RAIL|1WALL_ARMCO|1WALL_CAR|1WALL_TREE)`; PARKED_CARS also checked against the route road. `groupsOf` merges same-named top-level groups (so the two CARPARKS groups count as one). JUNCTIONS is in neither set (B-note: net junction surfaces aren't judged as ground by the check).
- `poleCheck.ts`: `POLE_GROUPS` = FURNITURE, TRAFFICLIGHTS, GUIDEPOSTS; ground from SURFACE_GROUPS.
- `padClear.ts`: `STANDING_GROUPS` = FURNITURE, TRAFFICLIGHTS, GUIDEPOSTS, BUILDINGS, SHOPS, FENCES, FARM, LOTS, RAILS (read from `model.root.children` **before** the pads are added: S19.4).
- `parkedCheck.ts`: SURFACE_GROUPS.
- `cull.ts` draw distances by mesh-name prefix: MARKINGS, RRPM, FURNITURE, GUIDEPOSTS, RAILPOSTS, ARMCOPOSTS, ARMCO_, WIRES.
- `scripts/check/autotest_report.py`: RACE.
- Physics by mesh-name prefix (digit + surface key, `data/surfaces.ini` from acFiles.surfacesIni): `sceneGround.PHYSICS_GROUND` `^\d(?!WALL)`, `ROAD_SURFACE`, `parkedClear.ROUTE_ROAD`, `parkedCheck.ASPHALT`/`BAY_PAD`, `bayGround.BAY_ASPHALT`, `paths.PATH_BLOCK`, `layouts.surfaceHeight` `^\d(ROAD|STREET|KERB|UNSEALED|UNPAVED)`, `terrain.isStreetNode`, `rainHollows` surface meshes. These names come from the submodules (roadMesh, kerbs, sideStreets, roundabout, terrain, carpark, parkedPlacement…); `track.ts` itself only names TREES/HORIZONTREES/ISLANDTREES/HOUSETREES (buildTrees prefixes), ISLAND_SHRUBS, the `terrain_<key>` material for islands, and filters parked meshes by `1WALL`.

### 7a. trackObjects(plan, opts)

Pure; called three times (root, challengeFiles, layout dummies; B13). `width = samples[0].width`, `rows = ceil(pitCount/2)`.
- `slot(k, lineS)`: if the width at `lineS − 8` is under 8 m: single file on the centre line, `s = lineS − 8 − 8k`, t 0. Else `row = floor(k/2)`, `t = ±width/4` (even k left +, odd right −), `s = lineS − 8 − 8·row`.
- `place(name, s, t, lift)`: `along(plan, s, t, lift, crown)`, transform `frameTransform(pos, fwd)` (Z along the driving direction).
- Loop: line 0; for k < pitCount: `AC_START_k` and `AC_PIT_k` at the same slot, lift .5; `AC_HOTLAP_START_0` at `length − 150`; `AC_TIME_0_L/R` at s 0, t ±(width/2 + 1), lift 1.
- Point to point: `startLine = timed ? max(GRID_DEPTH + 8·rows, s[timed.start]) : GRID_DEPTH + 8·rows`; START/PIT slots as above; `AC_HOTLAP_START_0` at s 4; `AC_AB_START_L/R` at startLine, t ±(width there/2 + 1); `finish = timed ? min(end − 25, s[timed.finish]) : end − 25`; `AC_AB_FINISH_L/R` likewise.
- `along(plan, s, t, lift, crown)`: wrap s on loops, clamp otherwise; start from the uniform-spacing index estimate and walk to the sample with `s_i ≤ s < s_{i+1}`; no interpolation (the sample's own frame); `z = surfaceHeight(sample, t, crown) + lift`.

---

## 8. Files (`TrackResult.files`)

Before layout wrapping, keyed `${slug}/…`, in this insertion order (zip order follows object order):

| Path | Condition | Content |
|---|---|---|
| `extension/sfx/README.txt` | sounds non-empty | `soundReadme(sounds, mode)` |
| `extension/<SOUND_SCRIPT>` | sounds and mode "lua" | `soundLua(sounds)` |
| `<slug>.kn5` | always | the model |
| `ai/fast_lane.ai` | always | `writeFastLaneAi(aiPoints)` |
| `data/ai_hints.ini` | always | `aiHintsIni(aiPoints, d => speedAt(round(d/total·(nS−1))), !closed)` |
| `data/surfaces.ini` | always | `surfacesIni(traffic, streetsValid ?? !!area, centre, anyUnsealed, true)` (track scripts always allowed, for the autotest) |
| `data/traffic.json` | traffic | trafficText |
| `data/map.ini` | always | `trackMap(outline2d).ini` |
| challenge files | per challengeFiles | `challengeFiles(slug, opts, {plan, dummies: trackObjects, nearest, toLocal, ground: terrainH, pois, routeNames, junctions, streets, parked: final car points, buildings: shown rings})` |
| cruise files | per cruiseFiles | `cruiseFiles(slug, name, {ai, closed, landmarks, streets, route: {pts, names, limits per sample}, sideLimit: builtUp ? 50 : undefined, limitAt})` |
| `data/cameras_1.ini` | always | `camerasIni(placeCameras(plan, opts, terrainH, in a kept building))` |
| `data/autotest.ini` | always | `[AUTOTEST]\nCLOSED=<bool>\nLIMITS=<100 values>\n` + `SHOTS=<list>\n` when shots |
| `extension/autotest.lua` | always | the lua with `__CLOSED__` and `__LIMITS__` (", "-joined) replaced |
| CSP tree files | cspTrees | S19.5 |
| `extension/jetty_train.lua` | precinct has a train && jettyTrain !== false | `jettyTrainLua(script, train)` |
| `baked_shadow_params.ini` | always | `bakedShadowParams()` |
| `extension/ext_config.ini` | always | `extConfig(lights, {...})` below |
| `map.png` | always | trackMap png |
| `extension/street_map.png`, `.ini` | always | `streetMap(streets (y flipped), route (y flipped, closed repeats first))` |
| `ui/ui_track.json` | always | `uiTrackJson({name, ...meta}, {length: timedLength, width: meanWidth, pitboxes, closed, centre, traffic})` |
| `ui/outline.png`, `ui/preview.png` | always | from outline2d |
| `README.txt` | always | `readme(meta, textured.size ? credit ?? "aerial imagery" : null, {elevation credit, mapillary})` |
| `network/junctions.json` or the preview files | net, else networkCore | `net.json()`, or `networkPreview(...)` |

- `LIMITS` = `speedAt(min(nS−1, round((k + .5)/100·(nS−1))))` for k = 0..99 (computed twice; B14).
- `outline2d = simplify(sample positions, 0.5)` with y flipped; loops repeat the first point.
- ext_config options: lights = utilities.lights + carPark.lights + jettyLamps.lights; `autotest: true`, `flags: wavingFlags !== false`, `jettyTrain`, `drySummer` (centre lng in (112, 119.5) and lat in (−36, −30)), `sea: ocean.length > 0`, `photoSea`, `trees: "trees/trees.txt"` when CSP tree files exist, `vines: !!farm.vineMetres`, `hollows` (rainHollows: `trackHollows(model.root)`, after parked groups are in), `sounds`, `soundMode`, `builtUp` (more than half the samples town ≥ 1), `radiusKm` (max distance of outline points from the first / 2000; B18), `pure` (pureTuning !== false: `{at: centre, albedo: groundAlbedo(photos), coast, photoLight}`).
- Sounds (`soundMode(opts.trackSounds)` truthy): `surfEmitters(ocean, so)` + `birdEmitters(treesKept with bush = variant is tuart, so)`, `so = {roads: [route, ...streets], ground: terrainH}`.
- README mapillary flag: `seen` non-empty, or any look without a spec.
- Credits are read **at this point** (`imageryCredit` / `elevationCredit` may be functions; they're only right after fetching).

**Layout wrapping** (`opts.layout` set): `asLayout` moves `ai/`, `data/`, `map.png` to `${slug}/${id}/…`, `ui/*` to `${slug}/ui/${id}/…`, adds `layout_${id}.kn5` (the dummies) and `models_${id}.ini`; the world kn5 then has no dummies (section 7).

---

## 9. Stats

`length` (plan.length), `timedLength`, `closed`, `minElevation`/`maxElevation` (sample h), `climb` (sum of positive h steps), `meanWidth`, `vertices`/`triangles` (whole model tree, including parked cars and pads), `terrainChunks` (terrain meshes built), `kn5Bytes`, `trees` (kn5 tree mesh vertices / 24: TREES only, 0 with cspTrees; B17), `buildings` (kept.length; B2), `buildingsDetected` (kept not osm), `traced` (trace.coverage or 0), `photoLines`, `photoChunks` (materials named `road_photo_*`), `sideStreets`, `sideTraced`, `kerbMetres` ((sum of both kerb arrays)·spacing), `poles`, `carsPainted`, `parkedCars`, `parkedDropped`, `parkedBays` (when placed: carPark/kerb counts of the final cars, placed.dropped), `kerbside` (bays, rounded bike lane metres, symbols), `trafficLights` (sites, poles, heads, working = sites with sidesOk), `housesLooked`, `shops`/`verandahs`/`shopNames` (shopStats), `carParkIslands`, `footpathMetres` ((photo path samples both sides)·spacing), `driveways`, `streetLights`, `carParkLights` (lights / 2), `race` (stats or null), `streetSigns` (pieces of kind blade), `signs` (kind face), `railMetres` (needs·spacing).

The headless build writes stats to `out/<slug>.stats.json` and `scripts/check/all.mjs`/`base.mjs` compare them; keep every key and its meaning.

---

## 10. Options read here

Passed whole to submodules too (planRoad, terrain, scenery…): only what `track.ts` itself reads is listed. "Absent" = the meaning when undefined (OPTIONAL_OPTION_KEYS).

| Option | Where | Notes |
|---|---|---|
| name | slug, readme meta, cruise | |
| origin | S1 | absent = route bbox centre |
| clears | S1, S14, S15, S17 | absent = none; `trees` absent = true |
| area | S1 (areaRings) | absent = no area |
| pitCount, runUp, runOff | S1, trackObjects, ui | |
| traceRoads, traceGuard, noTrace | S2, S6 | |
| corridor, terrainBlend, demZoom, horizon | S3, S14, S15 | horizon 0 = one DEM, no horizon trees' ground, shown limited to cover |
| sea | S3 | |
| photoSea | S4/S5, files | absent = on (with ocean) |
| zones | S3, S4, S5, S14 | absent = off |
| cspTrees | S3, S14, S18, S19 | absent = off |
| detailShaders | S4, S5, S7, S8, S11 | |
| imageryZoom, textureSize, horizonZoom | S5, S11 | imageryZoom 0 = no imagery, grass strips |
| carParks, carParkIslands, parkedCars | S5 | |
| buildings, detectBuildings, buildingRadius | S5, S7, S15, S17 | |
| sideStreets | S6, S12, S14 | |
| roadSurface | S8, S11 | auto, asphalt, chipseal, photo |
| gravelRoads | S8, S9, S11 | absent = on |
| unsealed | S8 | absent = off |
| networkCore | S9, files | absent = off; needs area for the core, else preview files only |
| kerbs | S10, S11 | |
| vergeWidth, crown, spacing, defaultWidth, terrainStep | many | |
| markings, kerbside, laneBayClear | S11, S12 | kerbside absent = off; laneBayClear absent = on |
| poleClear | S13 | absent = on |
| trees, maxTrees | S5, S14 | |
| paths, guardRails, armco, guidePosts | S14 | armco absent = off |
| farmland, farmRoadsides | S14 | absent = off |
| trafficLights | S14 | absent = on |
| raceDress, sponsors, wavingFlags | S14, S15, files | wavingFlags absent = on |
| streetSigns, landmarks | S14 | |
| houseStyle | S15 | |
| parkedBays, padClear | S16, S19 | absent = on |
| traffic, trafficZones, trafficSetting | S19, files | |
| aiKeepLeft | S20 | passed as is |
| rainHollows, trackSounds, pureTuning, jettyTrain | files | rainHollows absent = off; pureTuning, jettyTrain absent = on |
| streetsValid | files | absent = !!area |
| layout | S18, files | absent = single layout with dummies in the kn5 |

---

## 11. Ordering constraints (and why)

1. proj before anything converts lng/lat; origin fixed so layers line up.
2. Circles (route roundabouts) before `planRoad`: it plans the road round them.
3. Length check after planning, before tracing (the error comes fast).
4. Trace before the DEM bounds and `applyElevation`: tracing moves samples and changes widths and `s`.
5. Area roundabouts appended after tracing (they're not on the route; applyTrace would otherwise remap their NaN sIn) and before `applyElevation`, `makeTerrainFn`, chunk planning and `planSideStreets` (the terrain flattens under rings; streets stop at them).
6. Seabed DEM before `applyElevation` (the road's heights come from it; matters only at the shore).
7. Base material kit before imagery (texture order).
8. Imagery before buildings (detected roofs, frontage photos), trees, parked spots, sea photos, ring photos, kerb return photos, groundAlbedo.
9. `detected` and `parkedSpots` sorted before any use.
10. Buildings `kept` before road materials and the town level (both count nearby buildings), and their finishes registered before road materials (texture order).
11. networkCore before kerbs (mouths), and before kerbs are recorded on samples (as built today; B1).
12. Kerbs recorded on samples **before** `buildRoadMeshes` (roadMaterial reads `mid.kerb`), before `streetSurface`, kerb returns, terrain chunks (terrainAt reads kerbs live) and tree planting (kerbedNear).
13. `rb.kerbed` set before `buildRingMeshes`; `rb.openings` set from `roadMeshes.openings` after `buildRoadMeshes` and before `buildRingMeshes`.
14. Side streets, street-type kerb returns and net nodes before `underStreets` and the terrain chunks.
15. All ground meshes (road, verge, streets, kerbs, rings, net, terrain) built before `sceneGround`; `sceneGround` before every placement (trees, barriers, farm, paths, rails, posts, lights, furniture, buildings, islands, parked cars).
16. Kerbside before parked placement (kerb slots), traffic (bay bands) and the AI line (route bays).
17. Signals before pieces (seen traffic lights near signal sites are dropped).
18. All pieces collected before `renderArt`, then `buildPieces`.
19. Spec looks before the facade top-up, shopfronts, parked placement and clears removal (they remove buildings from shown/homes).
20. Parked placement uses `shown` **before** clears remove buildings from it (as built; B3).
21. Clears removal before `buildBuildings` and `buildLots`.
22. Model assembled before the second parked pass: `feetNear` reads the standing groups from `model.root.children`; pads and car groups are appended after.
23. Traffic lanes before the second parked pass (no car near a lane).
24. Everything in the model before `writeKn5`, `trackHollows` and the stats' geometry count.
25. Credits read after imagery (pipeline sets them as it fetches).
26. Layout wrapping last.

---

## 12. Determinism rules

The frozen snapshot rebuild (generate-freeze-polish) depends on the same inputs giving the same bytes.

1. No `Math.random`, `Date`, timers or locale in the build. Randomness comes from position: `random.placeRandom(x, y, salt)` (island shrubs salt `0x5b00 + k`), building dress seed from the centroid (S7), tree picks from position (treePick).
2. Inputs whose order can vary are sorted by place before use: `detected` (centroid y, x), `parkedSpots` (at y, x, dir x, paint).
3. Imagery jobs run **sequentially** in chunk order (terrain then backdrop). Don't parallelise without sorting every output they feed (tree spots, detected, photos, seaPhotos, textures, materials).
4. Texture and material registration order (section 6) and node order (section 7) are output.
5. Sets and Maps are iterated in insertion order (finishes, surfaceMaterials, CSP tree models): insertion order must stay the same.
6. Order-dependent caps: island shrubs stop at 60,000 vertices in island order; horizon trees subsample by index; photo streets take the nearest 40 (stable sort). Keep the iteration orders.
7. Floating point: keep the same formulas and operation order where they feed output (e.g. `kerbMetres`, `climb`, ring angles). A refactor that reassociates a sum changes bytes.
8. Not deterministic today: `network/junctions.json` and the networkCore preview include `ms` timings (`Date.now()` in network/phase1.ts and preview.ts). Off on every route; B9.
9. The zip's entry times are fixed in zip.ts (outside).

---

## 13. Proposed modules

Rule of the split: a stage is a function `(ctx, inputs) → outputs` with plain data in and out; the only shared mutable things are the **registry** (textures, materials, previews: order matters) and the **plan** (mutated by S2, S3.8, S10, S11.2; make each mutation an explicit, named step). Stages don't call each other; the orchestrator passes outputs on.

```
src/core/stages/
  types.ts        DataSources, OsmFeatures, TrackResult, Progress (moved), BuildContext, stage output types
  context.ts      makeContext(route, opts, sources): proj, centre, local, slug, clears + cleared(), area, rings, areaPts,
                  toLocal helpers (line/ring/point converters used by every stage)
  registry.ts     class Registry: textures[], materials[], previews{}; add(tex), addMaterial(m), replaceMaterial(m),
                  scenery(), relief(), building(), photoMask(), photoGround(); has(name) (for a future dedupe)
  routePlan.ts    S1 + trackObjects/along/sampleNearPin (route-only geometry); GRID_DEPTH, MIN_LENGTH
  traceRoute.ts   S2
  ground.ts       S3: DEMs, coast, sea mask, zones, area roundabouts, applyElevation, index, terrainAt, cover, chunks, backdrop plan
  kit.ts          S4: the fixed material kit (section 6 steps 1-9)
  imagery.ts      S5 (+ the two determinism sorts at its end, so its outputs are always sorted)
  streets.ts      S6: street plan, area street raster, side tracing, streetIndex, mouth()
  buildingPlan.ts S7: mapped, frontage, kept + filters, dressBuildings, finishes registration, roadEdge
  surfaces.ts     S8: roadMaterial, gravelMaterial, chunkMaterial, unsealedAt, town[], speedAt (+ sampleAtS helper)
  network.ts      S9 (thin wrapper over network/phase1)
  kerbing.ts      S10: kerbBlocked, planKerbs, unsealed strip, ring kerbed, record on samples
  roadMeshes.ts   S11.1-9: road meshes, ring openings, strips, returns, verge, kerbs, verge concrete, side streets
  marks.ts        S11.10 + ring/net/kerbside markings collection, bayBoxes
  rings.ts        S12.1-3: ring photos and meshes, net meshes
  groundMeshes.ts S13: underStreets, terrain + backdrop chunks, walls, keepOffRoute, sceneGround, poleOnRoad
                  (not "sceneGround.ts": core/sceneGround.ts exists)
  placeScenery.ts S14.1-10, 12-17 (trees, barriers, farm, paths, rails, lights, utilities, jetty, race, pieces, atlas)
                  (not "scenery.ts": core/scenery.ts exists)
  houses.ts       S14.11 ground helpers, S15, S17.1-2, S17.4 (looks, places, facades, shops, clears, buildBuildings, lots)
  islands.ts      S17.3
  parked.ts       placeParkedFirst (S16), finishParked (S19.2-4: needs model root, lanes)
  assemble.ts     S18: group order (section 7) in one function, so the names live in one place
  traffic.ts      S19.1 (route runs, street roads, zones, bay bands, lights) -> {trafficInput, trafficText}
  files.ts        S19.5 CSP trees + S20 files + layout wrapping
  stats.ts        S20 stats and houses
track.ts          orchestrator: re-exports, buildTrack() calling the stages in order with the progress calls
```

Orchestrator sketch (the whole of the new `track.ts`, roughly 150 lines):

```ts
export async function buildTrack(route, partial, sources, meta = {}, progress = () => {}) {
  const opts = withDefaults(partial);
  if (route.length < 2) throw new Error("Pick a start and a finish on the map first");
  await progress("Laying out the road");
  const ctx = makeContext(route, opts, sources);
  const rp = planRoute(ctx);                         // throws on short roads
  const tr = await traceRoute(ctx, rp, progress);
  await progress("Fetching elevation");
  const g = await prepareGround(ctx, rp);            // appends area rings, elevates, terrainAt
  const reg = new Registry(opts);
  addKit(reg, ctx, g);
  const img = await fetchImagery(ctx, g, reg, progress);
  const st = await planStreets(ctx, rp, tr, g, progress);
  const bp = planBuildings(ctx, rp, g, st, img, reg);
  await progress("Building road and terrain meshes");
  const sf = makeSurfaces(ctx, rp, tr, g, st, bp, reg);
  const net = planNetwork(ctx, rp, g, st, sf);       // may narrow st.mouths
  const kb = planKerbing(ctx, rp, tr, g, st, sf, net);
  const rm = buildRoadSurfaces(ctx, rp, tr, g, st, img, sf, kb, net, reg);
  const mk = await buildMarks(ctx, rp, tr, g, st, sf, kb, net, img, progress);
  const rn = buildRings(ctx, rp, g, img, sf, net, kb, mk, reg);
  const gm = await buildGroundMeshes(ctx, rp, g, st, rm, rn, img, progress);
  await progress("Placing scenery");
  const sc = await placeScenery(ctx, rp, g, st, bp, sf, kb, rm, rn, gm, img, reg, sources);
  const hs = buildHouses(ctx, g, st, bp, gm, reg, sources);
  const p1 = placeParkedFirst(ctx, rp, g, st, img, mk, hs);
  const isl = buildIslands(ctx, rp, g, st, bp, gm, img);
  hs.finish(ctx, isl);                               // clears, buildBuildings, lots
  const model = assemble(ctx, reg, {rm, rn, gm, sc, hs, isl, mk, ...});
  const tf = ctx.opts.traffic ? trafficFor(ctx, rp, g, st, sf, mk, sc) : null;
  const parked = finishParked(ctx, model, reg, p1, tf, rm, rn, gm, isl);
  await progress("Writing track files");
  const out = writeFiles(ctx, model, {...}, meta, sources);
  await progress("Done", 1);
  return result(ctx, model, out, ...);
}
```

Stage boundaries chosen so that: each module has one reason to change; the plan mutations are in four named places (traceRoute, prepareGround, planKerbing, buildRoadSurfaces); every registry call stays in the same relative order; and the long argument lists show the real dependencies (shrink them later with small typed bundles, not one god-context). `ctx` holds only things fixed after S1 (opts, proj, sources, clears, area, slug).

### 13a. Delete instead of rewriting

CLAUDE.md (31 Oct): Mac approved deleting anything not actually used (the browser UI, unused options, features, exports). Every item below is **off in the Busselton build**, so deleting it doesn't change the golden (they register no textures and emit no nodes when off). Grep of `routes/` and `scripts/headless/presets.mjs` on 31 Oct:

| Item | Used by | Proposal |
|---|---|---|
| Spec houses in `houseLooks` (S15.4 spec branch, `facing`, `spec`, `name` fields; spec looks in `landmarkList`) | no route (headless strips specs; landmarks are layers via landmarkLayer.ts); `test/flags.test.ts` | delete; move the flag test to landmarkLayer |
| `raceDress`, `sponsors`, `wavingFlags` race flags (S14.15, RACE group, 7 materials, `stats.race`) | no route; only a UI checkbox | delete with raceDress.ts/flags' race parts (keep `wavingFlags` for landmark flags: ext_config `flags`) — or keep if Mac races on these maps (ROADMAP lists it as his call) |
| `carParkIslands` (S5.2 islands, S17.3, `stats.carParkIslands`) | no route (default false) | delete, with carpark.ts findIslands/buildIslands |
| `roadSurface` other than auto (`photo` road/side textures, forced asphalt/chipseal) | no route; UI select | delete `photo` (S8 chunkMaterial photo, S11.9 side_photo_*, `stats.photoChunks`); keep auto only |
| `trackSounds` | no route | ask: it's a recent fork feature, maybe waiting for a test |
| `networkCore` | no route; in progress (the new road core) | keep the hooks |
| `legacy parked filter` (`parkedBays: false`) | no route | delete; parked cars always go in bays |
| `stats` read only by the UI result table (e.g. `photoLines`, `sideTraced`) | build-track.mjs writes all stats | keep (stats.json is compared by base.mjs) |
| `export { material, nmMaterial }`, `pointInside` | nothing | delete |

Rewrite order (stage 2), each step golden-checked: registry + kit + context first (pure moves); then files/stats/assemble (end of the build, easy to diff); then the middle stages one at a time, outward from the ground.

---

## 14. Bugs and oddities (fix after the golden passes, not in the rewrite)

Each fix changes output: its own commit, a base upgrade (`base.mjs build|accept`), and a note in the commit of what moved.

- **B1. `terrainAt` changes over time.** It reads `samples[*].kerb` and `plan.roundabouts` live. Anything that samples it before S10.5 sees kerb-less ground: networkCore's planning (S9) does. Fix: build the terrain function after kerbs are final, from an immutable snapshot of the plan; pass kerbs explicitly.
- **B2. Obstacles use `kept`, not what's built.** Utilities, car park lights, farm roadsides, race dressing, landmark signs, island filtering and cameras avoid buildings that spec looks or clears later removed (and, with horizon 0, buildings outside the cover that aren't shown). Gaps with nothing in them. `stats.buildings` counts them too. Fix: decide the final building list (spec, place, clears) before placement and use it everywhere.
- **B3.** Parked placement checks `shown` before clears remove buildings; cars are dropped for buildings that aren't built. Folded into B2.
- **B4. Three street-wall rules**: dressBuildings (edges ≥ 3 m, facing test, < 25 m), the homes pass (any of 4 edges, < 25 m, no facing test), looks (edges ≥ 4 m, no limit). One rule in buildingPlan.
- **B5. Duplicates**: `roadEdge`/`roadGap` are the same function; `pointInside` = `pointInRing`; the route+street "on road" test appears in five shapes with different margins (keep the margins, name them).
- **B6. Spec houses in the base**: headless builds never send specs now (landmarks are layers). The branch, `buildSpecHouse` probing and its texture registration (facades without dedupe) go, with `landmarkList` taking only `sources.landmarks`. See section 13a (deleting unused code is approved).
- **B7. Two `CARPARKS` groups**: islands (culled) and pads (appended, not culled). Merge into one culled group.
- **B8.** Dummies sit between WALLS and the appended parked groups; cosmetic. Put dummies last when B7 is done.
- **B9.** networkCore output carries `ms` timings: not reproducible. Drop timings from files (log them instead).
- **B10.** Area rings (sIn NaN): the ring material's "nearest sample to sIn" is always sample 0 (NaN comparisons), so chunk index 0. Make it explicit (nearest sample to the ring centre, or a fixed variant).
- **B11. Index from distance assumes uniform spacing**: `round(sd/spacing)` in markings' kerb/unsealed tests and `sampleNear`; `round(d/total·(nS−1))` for AI hint and cruise limits; `(k+.5)/100·(nS−1)` for test limits. After tracing, `s ≠ i·spacing`. One `sampleAtS(s)` (binary search) for all.
- **B12. Grid stagger width** is `samples[0].width`, not the width at the grid (point to point starts elsewhere). And `AC_PIT_k` = `AC_START_k`: pit boxes on the grid (works, but pits and grid collide in a race with pits).
- **B13.** `trackObjects` computed up to three times; compute once.
- **B14.** The LIMITS list and the "built up" majority are each computed twice.
- **B15. Traffic heights**: street lanes take `terrainAt + 0.1`, not the street as built (sceneGround); lanes can float or dip where the built street differs (networkCore streets, flattened mouths).
- **B16.** Several things still stand on the analytic terrain, not the built ground: walls (fine: invisible), ring walls, rail needs, cameras, challenge ground, sound emitters, jetty/sea wall/groynes (`shoreGround`, marked "for now").
- **B17. Stats**: `trees` assumes 24 vertices a tree and is 0 with CSP trees (count spots instead); `photoChunks` counts materials by name.
- **B18.** `radiusKm` is half the largest distance from the first outline point (not a radius about the centre); `drySummer` is a hard-coded lng/lat box (fine for now; name it).
- **B19.** `streetLines` (street centre filter for legacy parked cars) only exists with carParks on; harmless since parked spots need carParks, but couple them explicitly.
- **B20.** JUNCTIONS (net surfaces) isn't in groundCheck's SURFACE_GROUPS, so things on junction surfaces aren't judged against them; add it when networkCore goes on.
- **B21.** `detectBuildings` runs twice per chunk with car parks on (cost only): run once, reuse.
- **B22.** Trunks are built (WALLS) even with CSP trees, where the tree has no kn5 crown: check whether CSP trees want the collision trunks (probably yes; confirm, then comment).
- **B23.** `kangarooSigns`' skip test checks `mouth(side, s)` and then a wider version of the same test; the first is redundant.

---

## 15. Tests to write

Fresh tests (the old `test/track.test.ts`, `gates`, `kangaroo`, `origin`, `roundabout`, `streets` are on UPSTREAM-FILES.txt and get rewritten too).

**Golden (the gate for every stage-2 step).**
1. **Full Busselton golden (lead's build).** Before the rewrite starts: build Busselton twice from the frozen snapshot with the current code (`SNAPSHOT=out/snapshots/busselton-2026-10-30 node scripts/headless/build-track.mjs routes/busselton.json`) and confirm the two zips are byte-identical (if not, find the nondeterminism first: that's a bug to fix and accept as a base before the rewrite). Keep that zip as the reference. After each stage-2 step, rebuild and compare **every zip entry byte for byte**; the layer and landmark entries (`layer_*`, `lm_*`, models*.ini) come from outside and must match too. Needs a small comparer, `scripts/check/zip_same.mjs <a.zip> <b.zip>`: lists entries only in one, and differing entries; for a differing kn5, decodes both (`readKn5`) and reports the first difference (texture list, material list, node path and name, then the first differing vertex), so a failure says which stage moved. `out/accepted/busselton.zip` was built at an earlier commit, so compare against the fresh reference, not that file.
2. **Small golden in vitest** (runs in seconds, no network): `test/trackGolden.test.ts` builds three synthetic tracks with injected sources: (a) a point-to-point winding road on hills, imagery off; (b) a loop with an area polygon, synthetic street lines, two roundabouts (one hinted, one a tile ring), OSM buildings, kerbside tags, traffic on, a layout id; (c) (b) with deterministic synthetic imagery (`imagery()` returning a generated RGBA: grey road band, green lawns, a few dark "roofs" and car-sized bright blobs), detailShaders on, sea polygon and a pier. For each, SHA-256 of every `files` entry, plus the stats object, written to `test/fixtures/track-golden.json` **with the old code** before stage 2 starts; the test fails on any change. Regenerate only in a commit that also accepts a base.
3. **Determinism**: build (c) twice in one process and with imagery returning chunks in a different call order (the source keyed by chunk, results identical); file hashes equal.

**Contract tests (from this spec).**
4. Errors: one pin → the "Pick a start" message; a 200 m road → "Road is 200 m; make it at least 300 m".
5. Progress: the strings appear in section 4's order for (b)/(c); "Done" last with fraction 1; imagery fractions rise from 0 to < 1.
6. Model groups: root children names in section 7's order, every group present (empty ones too); with `layout` no `AC_` dummies in the world and a `layout_<id>.kn5` holding them; the names in groundCheck's SURFACE_GROUPS/PLACED_GROUPS, poleCheck's POLE_GROUPS and padClear's STANDING_GROUPS all exist in the root (so a rename can't silently empty a check).
7. Registry: no two textures and no two materials share a name (catches B6-type duplicates); every material's textures exist; with detailShaders off no `_nm`/`_mask` textures.
8. trackObjects: loop has START/PIT 0..pitCount−1, HOTLAP, TIME_0_L/R; point to point has AB_START/FINISH L/R on the timed samples (within a sample), grid behind the start line by ≥ 8 m, finish ≥ 25 m before the end; single file under 8 m wide; spawn Z axis points along the road direction.
9. Clears: a clear circle over a mapped building and trees → no building or tree mesh vertex inside it, house looks inside it ignored; `trees: false` keeps the trees.
10. Area roundabouts: a closed tile ring inside the area becomes a plan roundabout with NaN sIn, `kerbed`, and a ring mesh; one outside the area doesn't; two OSM ways of one ring merge into one.
11. Kerbs: recorded on samples exactly where the kerb arrays are > 0; none on unsealed samples; a ring near kerbs is kerbed, one in the country isn't.
12. sceneGround: everything in PLACED_GROUPS passes `checkGround` with 5 cm tolerance on (b)/(c) (the existing check, run in the test).
13. Traffic: `trafficInput` present only with traffic; route runs split at a 12 m width change (not at a 40 m blip); a loop with one width gives one closed road; no parking_aisle street in the roads; no parked car within 1.8 m of a lane.
14. Parked cars: none over ROUTE_ROAD surfaces (groundCheck's parkedOnRoad empty); stats.parkedCars = result.parked.length; with `parkedBays: false` the legacy filter runs.
15. Files: section 8's table per option (traffic on/off, cspTrees, jettyTrain, trackSounds, networkCore without area → preview files); `surfaces.ini` streets-valid default follows the area; autotest LIMITS has 100 values; README credits the elevation source and Mapillary when `seen` is non-empty.
16. Stats: every key in section 9 present with the right type; `timedLength` equals finish − start on point to point; `kerbMetres` = kerb sum · spacing.
17. Per-stage unit tests as each module lands (stage 2): routePlan (pins, run-up/off, timed samples), registry order, surfaces (town level and speed table), traffic runs, assemble order — each against small hand-made inputs, not a whole build.

---

## 16. Open questions

1. **Section 13a's list**: confirm each deletion is "not actually used" (approved in general on 31 Oct). The two that need Mac's word: race dressing (ROADMAP: "rewrite or delete, Mac's call") and `trackSounds`. Delete before stage 2 rewrites the stages they touch, so they're never rewritten.
2. **Order of deletions vs golden**: deletions of off-by-default branches are golden-safe for Busselton, but the small vitest golden (section 15, item 2) should be generated **after** them, so it doesn't pin code that's about to go.
3. **networkCore** (off everywhere, ~40 lines here plus network/): keeping the hooks through the rewrite is assumed; say if it should be parked instead.
4. **Golden scope**: is byte-identical required for every stage-2 step, or is "identical after normalising texture/material order" acceptable for the registry step? Byte-identical is stricter and is what this spec assumes.
5. **Fix order for B1/B2**: both change the Busselton base noticeably (terrain under junctions; poles and lights moving into gaps). Do them right after the rewrite, or batch with the week's other base upgrades?
