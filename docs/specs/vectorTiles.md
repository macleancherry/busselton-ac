# Spec: vector map tiles (`src/services/vectorTiles.ts`)

Status: spec for a clean rewrite ("Owning the code" in ROADMAP.md). `vectorTiles.ts` is on `UPSTREAM-FILES.txt`. Written from the old code on 31 Oct 2026 so a separate session can write a fresh module without the old file open.

Runs in the browser (build worker or page) and in Node scripts (`scripts/tmp/*.ts` call `fetchTileFeatures` under tsx). Uses `fetch` (through `fetchRetry`), and the `@mapbox/vector-tile` and `pbf` packages (BSD/MIT dependencies, not upstream code: keep using them; the current API is `new VectorTile(new PbfReader(bytes))`, layers by name, `feature(i)`, `.type` 1 point / 2 line / 3 polygon, `.properties`, `.loadGeometry()` giving rings/lines of `{x, y}` in tile units, `layer.extent`).

## What the module is for

OpenFreeMap vector tiles (OpenMapTiles schema), keyless from a CDN, so reliably up where the public Overpass servers often aren't:
- z14: building footprints with their tags, roads with class/surface/bridge/one-way/service, road names, points of interest, waterways, retail/commercial landuse.
- z13: the sea, piers, beaches and landcover polygons.
- Helpers: class widths when Overpass failed, road class at a point, polygon clipping to a tile, signed area.

## Public API (keep these names and shapes)

```
tileTemplate(): Promise<string>
interface TileBuilding { ring: LngLat[]; tags: Record<string, string> }
interface TileRoad { pts: LngLat[]; cls: string; subclass?: string; bicycle?: string; surface?: string; brunnel?: string; oneway?: 1 | -1; service?: string }
interface TileName { pts: LngLat[]; name: string; cls: string }
interface TilePoi { at: LngLat; cls: string; subclass: string; name?: string; rank?: number }
interface TileWaterway { pts: LngLat[]; cls: string; brunnel?: string }
interface TileFeatures { buildings; roads; names; pois; waterways; landuse: { ring: LngLat[]; cls: string }[] }
type P = { x: number; y: number }
clipToTile(ring: P[], extent: number): P[]
signedArea(r: P[]): number
fetchTileFeatures(bbox: [w, s, e, n]): Promise<TileFeatures>
classWidths(roads: TileRoad[]): { width: number; pts: LngLat[] }[]
roadClassLookup(roads: TileRoad[], lat: number): (p: LngLat) => string | undefined
interface TilePolygon { rings: LngLat[][]; edge: boolean[][] }
fetchCoast(bbox: [w, s, e, n]): Promise<{ ocean: TilePolygon[]; piers: TilePolygon[]; beaches: TilePolygon[]; landcover: LandcoverPolygon[] }>
```

`LandcoverPolygon` is from `src/core/zones.ts` (`{ cls, subclass?, rings }`).

## Callers (from `grep`, 31 Oct 2026)

- `src/services/pipeline.ts`: `fetchTileFeatures` (box padded by `buildingRadius + 50` m), `fetchCoast` (padded by `horizon + 1200` m), `classWidths`, `roadClassLookup` (lat = route's first point).
- `src/services/landcover.ts` (farmland): `tileTemplate`, `clipToTile`, `signedArea`, type `P`.
- `scripts/tmp/{roads,allpois,streets,caves,pois}.ts`: `fetchTileFeatures` (throwaway exploration scripts).
- Depends on `dataWarnings.ts` (`fetchRetry`, `warnMissing`), core `geo` (`lngLatToPixel`, `pixelToLngLat`: global pixel coordinates on 256-px tiles at a zoom).

## Rules

### Tile index: `tileTemplate()`

- GET `https://tiles.openfreemap.org/planet` (TileJSON) with `fetchRetry`; not OK or null: fail with "map tile index unavailable". The template is `tiles[0]` (a URL with `{z}`, `{x}`, `{y}`; it carries a dated planet version, so it changes when OpenFreeMap publishes; snapshots freeze the TileJSON answer and so the template).
- Cached as one promise for the session; on failure the cache is cleared so the next call tries again.
- Tile URL: the template with `{z}`, `{x}`, `{y}` replaced (first occurrence each). Keep exactly this (no extra query parameters): the headless cache and snapshots key on the URL.

### `fetchTileFeatures(bbox)` (z14)

1. Template (throws if unavailable: the pipeline turns that into a data warning).
2. Tile range from the box's north-west `[w, n]` and south-east `[e, s]` corners at z14: `floor(pixel / 256)` each. More than 400 tiles: throw `Error("Area too large for building tiles")`.
3. Fetch every tile at once, **rows (y) outer, columns (x) inner**, each into its own result slot; after all settle, concatenate the slots **in that order**. (Pushing into shared lists as tiles arrived gave a different order on every build, and everything chosen at random per house or tree downstream came out different on each rebuild.)
4. Per tile: `fetchRetry(url)`. Null, or not OK: if not a 404, count it missing; 404 is an empty tile. Then decode and read the layers below. A tile whose decode or reading throws is dropped (see bugs).
5. Tile units to lng/lat: `pixelToLngLat([(tx + x/extent) * 256, (ty + y/extent) * 256], 14)`.
6. After all: missing count > 0: `warnMissing("<n> map tiles (buildings, streets, shops)")`.

Layers:
- **building** (any geometry type as given): tags = every property as a string. For each ring of the geometry: skip rings with signed area <= 0 (holes; exterior rings are positive in tile coordinates, y down); drop the ring's closing point, `clipToTile` to `[0, extent]`; keep if 3+ points, as `{ ring, tags }`. A multipolygon's several exteriors become several buildings with the same tags.
- **transportation**, lines only (type 2): `cls` = class (or ""); `surface`, `brunnel`, `subclass`, `bicycle` as strings when present; `oneway` when the property is 1 or -1 (numeric compare after `Number()`); `service` when present. Each line of the geometry is one road (not clipped: lines extend into the tile buffer, so a road crossing a seam overlaps a little with its neighbour's copy; keep it, downstream copes).
- **waterway**, lines only: `{ pts, cls: class or "", brunnel when present }`.
- **transportation_name**, lines with a `name`: one `{ pts, name, cls }` per line.
- **poi**, points only (type 1): the first point of the first geometry part; **skip it if outside `[0, extent)`** on either axis (a point in the buffer appears in two tiles; keep the owner's copy). `{ at, cls: class or "", subclass: subclass or "", name if present, rank if a number }`.
- **landuse**, polygons only (type 3) with class `retail` or `commercial`: exterior rings as for buildings, `{ ring, cls }`.

### `fetchCoast(bbox)` (z13)

1. Template; tile range at z13 as above; more than 100 tiles: throw `Error("Area too large for coast tiles")`.
2. Per tile `fetchRetry`. Null counts missing; not OK (including 404) is skipped silently today (see bugs).
3. A polygon reader for (layer, filter, output list, optional callback), polygons only (type 3), filtered on properties. For each feature, a "current polygon" starts empty; for each ring:
   - drop the closing point, `clipToTile`; under 3 points, skip;
   - `edge[i]` (edge from point i to i+1, wrapping) is **false when both ends lie on the same tile border** (both x <= 0, both x >= extent, both y <= 0 or both y >= extent): that edge is a tile seam, not a real coastline;
   - the clipped ring to lng/lat at z13;
   - the **unclipped** ring's signed area > 0: a new exterior; start a polygon `{ rings: [ring], edge: [edge] }`, push it to the output, call the callback; otherwise (a hole) append ring and edge flags to the current polygon (a hole before any exterior is dropped).
4. Readers:
   - ocean: layer `water`, class `ocean`.
   - piers: layer `transportation`, class `pier` (polygon piers only; line piers aren't read).
   - beaches: layer `landcover`, class `sand` with subclass `beach` or no subclass.
   - landcover: layer `landcover`, class in {wood, forest, wetland, farmland, grass, sand, rock}; output to a throwaway list, the callback pushes `{ cls, subclass (string or undefined), rings }` (no edge flags) to `landcover`. Sand polygons appear in both beaches and landcover; that's intended.
5. Missing > 0: `warnMissing("<n> coast tiles (sea, piers, beaches)")`.

### `classWidths(roads)` and `roadClassLookup(roads, lat)`

Width by OpenMapTiles class: motorway, trunk, primary 7.5; secondary 7; tertiary 6.5; minor 6; service 4; track 3.5; raceway 10. Others (path, rail, ferry...) aren't drivable.
- `classWidths`: the drivable roads as `{ width, pts }`, in input order (fed to `osm.ts widthLookup` when Overpass failed).
- `roadClassLookup`: `p => cls` of the drivable road with the nearest segment within 12 m (first found on ties), else undefined; same flat-frame distance as `widthLookup` (x = dLng * cos(lat) * 111320, y = dLat * 111320, clamped point-to-segment, zero length as 1e-9).

### `clipToTile(ring, extent)`

Sutherland-Hodgman against x >= 0, x <= extent, y >= 0, y <= extent, in that order. For each edge (previous point a, current b, starting with a = the last point): b inside: if a outside, add the crossing point, then b; b outside and a inside: add the crossing point. Crossing on a vertical border at x = c: `y = a.y + (b.y - a.y) * (c - a.x) / (b.x - a.x)`, likewise for horizontal. Stop early if a pass leaves nothing. Input ring is open (no closing repeat); output open. Points exactly on a border count as inside.

### `signedArea(r)`

Half the shoelace sum over the open ring (wrapping). Positive for rings that are clockwise on screen (y down), which is OpenMapTiles' exterior orientation.

## Edge cases

- A box straddling a tile row/column boundary fetches both; a box inside one tile fetches one.
- An empty tile (404) is fine and not counted missing in `fetchTileFeatures`.
- POIs exactly on the right/bottom border (`x == extent`) belong to the next tile.
- Buildings split across tiles come back as two clipped pieces that meet exactly on the seam (no merge).
- Coast polygons clipped to tiles meet without overlap; the `edge` flags tell the sea builder which edges are seams.

## Bugs to fix (rather than copy)

1. **`fetchCoast` collects in arrival order** (the same bug `fetchTileFeatures` had): ocean, pier, beach and landcover polygons come out in a different order each build, so the sea mesh and zones can differ byte for byte between identical builds. Use per-tile slots joined in row-major order, as `fetchTileFeatures` does. (`src/services/landcover.ts` likely has the same pattern; check it when that module is rewritten.) This reorders polygons once: run the base comparison (`scripts/check/all.mjs`) and accept it deliberately.
2. **Failures that aren't counted**: a tile whose bytes don't decode, or whose layers throw, is dropped silently in both functions (the per-tile `catch`), and in `fetchCoast` a non-404 error status (e.g. 403) is silently skipped. Count both as missing so the headless build reports MISSING DATA and is retried. A 404 stays an empty tile.
3. **Too large isn't transient**: "Area too large" throws, and the pipeline turns it into a "missing data" warning that a rebuild can never clear. Keep the throw, but let the pipeline show it as an error with the real reason (see pipeline.md), or raise the limits with care: at z13 a tile is about 4.9 x 4.1 km here, so 100 tiles is about 49 x 41 km; long routes with the sea on (horizon 1500 + 1200 m padding) can hit it.

## Tests to write

Pure:
1. `clipToTile`: a square inside is unchanged; a square straddling the right border is cut at x = extent with the right crossing points; a ring entirely outside gives `[]`; a triangle covering the whole tile gives a polygon with area `extent^2` whose points all lie on the tile's border.
2. `signedArea`: a clockwise-on-screen square (y down) is positive; reversed is negative; area value right.
3. `classWidths`: drops path/rail, keeps order, widths per class.
4. `roadClassLookup`: nearest within 12 m; none beyond; only drivable classes considered (a path nearer than a minor road is ignored).

With a stubbed `fetch` serving small hand-built MVT tiles (encode with the `pbf` package or a tiny fixture; or stub `VectorTile`):
5. TileJSON fetched once and reused; a failed TileJSON is retried on the next call; a tile URL is exactly the template with z/x/y filled in.
6. `fetchTileFeatures`: buildings' holes skipped and rings clipped; road properties carried (`oneway` only for 1/-1); POI in the buffer skipped; landuse only retail/commercial; tiles resolving in reverse order still give features in row-major tile order (determinism); a 500 tile counts missing and warns "1 map tiles (buildings, streets, shops)"; a 404 doesn't; over 400 tiles throws before any tile fetch.
7. `fetchCoast`: an ocean polygon with a hole gives one polygon with two rings; seam edges flagged false and coastline edges true; beaches from sand with subclass beach or none; landcover classes filtered; deterministic order regardless of arrival (bug 1); a decode failure counts missing (bug 2).
