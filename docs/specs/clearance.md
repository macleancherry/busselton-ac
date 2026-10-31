# Spec: keeping solid meshes off the driving line (`src/core/clearance.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"). `clearance.ts` and `test/clearance.test.ts` are on `UPSTREAM-FILES.txt`. Write the new module from this page without the old file open; tests are written fresh from the "Tests to write" list.

## What the module is for

Kerbs, nature strips, gutters, guard rails, fences, farm fences and lot walls come from many builders (road edges, kerb returns, side streets, roundabout rings, OSM barriers, lots), and real road networks have odd corners. As a last pass before the model is assembled, any triangle of those meshes whose centre lands on the route's asphalt (or a roundabout's carriageway) is dropped, so nothing solid ever stands on the driving line.

## Does the network core replace it?

**No, not as a whole.** `docs/specs/road-network.md` makes kerbs and gutters come from one boundary per road, so they can't land on the road by construction, but fences, farm meshes, lots and rails stay outside that spec's scope and still need this pass. Rewrite `clearOfRoute` and `keepOffRoute` as generic helpers (they take any point predicate). Only `onRoute` is tied to the old `RoadPlan`; when the network core builds the route, replace its predicate with one built from the graph (the route's edges and the junction polygons it uses), and keep the rest.

## Conventions

- Predicates take local metres, **x east, y north** (the `geo.ts` frame).
- Mesh positions are in **AC space: x east, y up, z south**. So local (x, y) = (pos.x, −pos.z).
- `Kn5MeshNode` is from `kn5.ts`: `positions` (Float32Array, xyz per vertex), `indices` (Uint16Array, three per triangle), plus normals, uvs and flags that this module never touches.

## Public API (keep these names and shapes)

- `KEEP_OFF: RegExp`: which mesh names are cleared.
- `onRoute(plan: RoadPlan, index: SegmentIndex, margin = 0.15): (x: number, y: number) => boolean`
- `clearOfRoute(node: Kn5MeshNode, on: (x: number, y: number) => boolean): { node: Kn5MeshNode | null; dropped: number }`
- `keepOffRoute(nodes: Kn5MeshNode[], on: (x: number, y: number) => boolean): { nodes: Kn5MeshNode[]; dropped: number }`

## Rules

### KEEP_OFF

1. A mesh is cleared when its name **starts with** one of:
   - `1KERB`, `1GRASS_STRIP`, `1ROAD_GUTTER`, `1STREET_GUTTER`, `1STREET_PATH`, `1STREET_DRIVE`, `1WALL_RAIL`, `1WALL_FENCE`, `1WALL_ARMCO` (physics meshes), or
   - `ARMCO_` (visual Armco).
   Matching is a prefix test, case-sensitive: `1KERB_RET`, `1KERB_J004`, `1WALL_RAIL_L_000`, `1GRASS_STRIP_J001` all match; `1ROAD_000`, `1GRASS_VERGE_000`, `1STREET_000`, `xKERB` don't.
2. Keep it exported as a RegExp (equivalent: `^(1(KERB|GRASS_STRIP|ROAD_GUTTER|STREET_GUTTER|STREET_PATH|STREET_DRIVE|WALL_RAIL|WALL_FENCE|WALL_ARMCO)|ARMCO_)`).

### onRoute

3. Returns a predicate. A point (x, y) is on the route when either:
   - **Asphalt**: the nearest point of the route centreline within 25 m (`index.nearest(x, y, 25)`) exists and its distance is **strictly less than** `w/2 − margin`, where w is the asphalt width interpolated at that nearest point (`index.at(nearest).width`). Default margin 0.15 m, so a 15 cm band inside each road edge doesn't count (that's where kerbs and gutters legitimately sit).
   - **Roundabout**: for any roundabout in `plan.roundabouts`, the distance d from its centre `c` satisfies `innerRadius(rb) < d < outerRadius(rb) − margin`, with `outerRadius = r + w/2` and `innerRadius = max(1.5, r − w/2)` (from `roundabout.ts`). Both comparisons strict.
4. The route test is tried first; the roundabout test only when it fails. Closed and open plans both work (the segment index handles the wrap).

### clearOfRoute

5. For each triangle (indices t, t+1, t+2) compute the centroid of its three vertices in AC space, convert to local (x, −z), and drop the triangle if `on(x, y)` is true. Count dropped triangles.
6. Nothing dropped: return the **same node object** and `dropped: 0`.
7. Everything dropped: return `node: null` and the count.
8. Otherwise return a shallow copy of the node with only the kept triangles' indices, in their original order and winding, as a new Uint16Array. Positions, normals, uvs and every other field are shared and unchanged (unused vertices are left in place; compacting them is optional, see "Edge cases").

### keepOffRoute

9. For each node in order: if its name doesn't match `KEEP_OFF`, pass it through unchanged (same object). Otherwise apply `clearOfRoute`; add its count; keep the result if it isn't null.
10. Returns the surviving nodes in input order and the total dropped triangle count.

## Callers (from `grep`, 31 Oct 2026)

- `src/core/track.ts`: `onRoute(plan, index)` once after the road is built (the default margin); `keepOffRoute` on: route kerbs, gutters, strips, kerb returns and verge concrete; roundabout ring meshes; guard rails; OSM barriers (`FENCES`); farm meshes (`FARM`); lots (`LOTS`). It reads `.nodes` everywhere and `.dropped` nowhere today (keep the count; it's cheap and useful in stats).
- `clearOfRoute` and `KEEP_OFF`: no importer outside the module and its test; keep them exported.

## Edge cases

- A mesh with no triangles: nothing dropped, same node back.
- Centroid test only: a large triangle crossing the road whose centre is off it (a long rail panel at a skew) is kept, and a sliver whose centre is on the asphalt is dropped even if most of it is off. Builders keep triangles small near roads, so this is accepted. Don't silently change to a vertex or overlap test: the stats and checks are tuned on the centroid rule.
- Unused vertices after dropping: allowed. The rewrite may compact them (remap indices, copy the used vertex data), provided rule 6 still returns the same object when nothing is dropped and the kept triangles are geometrically identical.
- Points beyond 25 m of the centreline are never route asphalt (no road is 50 m wide).

## Known bugs and quirks (fix, don't copy)

1. The roundabout band has the margin only on its outer edge; the inner edge (the island kerb) has none, so a triangle centred just outside the island kerb is dropped. Apply the margin on both edges: `innerRadius + margin < d < outerRadius − margin`. Island kerbs are built on the island side, so this only stops over-clearing.
2. Doc only: the old header says "kerbs, strips, gutters, guard rails", but fences, paths, driveways and Armco are cleared too (rule 1).

## Tests to write

Build an 8 m wide straight road along y = 0 (`planRoad` of points every 20 m from x = 0 to 200, `widthOverride: 8`) and its `SegmentIndex`. Test meshes are 1 m quads (two triangles) centred at given local points, written in AC space (z = −y).

1. `clearOfRoute` on `1KERB_000` with quads at (100, 0), (100, 4.6), (100, 7): drops 2 (only the first quad), keeps 12 indices.
2. Margin (use single small triangles whose centroid is exactly the test point, since a quad's two triangle centroids sit 1/6 m either side of its centre): the limit is w/2 − 0.15 = 3.85 m. Centroid at y = 3.9 is kept, y = 3.8 is dropped; with `onRoute(plan, index, 0)`, y = 3.9 is dropped.
3. Nothing dropped returns the same object; everything dropped returns null.
4. Kept triangles keep their order and winding; positions array is the same object.
5. `keepOffRoute` on `1KERB_RET` at (50, 1), `1GRASS_STRIP_000` at (60, −6), `1ROAD_000` at (70, 0), `1WALL_RAIL_L_000` at (80, 0.5): dropped 4, surviving names `["1GRASS_STRIP_000", "1ROAD_000"]` (the road is never cleared, the strip is off the road).
6. `KEEP_OFF` prefix table: each listed prefix matches with a suffix; `ARMCO_POST` matches; `1ROAD_000`, `1GRASS_VERGE_0`, `1STREET_0`, `X1KERB` don't.
7. Roundabout: a plan with one roundabout (c, r = 12, w = 8): a point at d = 12 is on, d = 15.9 is off (outer 16 − 0.15), d = 8.05 is off after bug fix 1 (inner 8 + 0.15), d = 9 is on.
8. Closed loop plan: a point on the closing segment counts as on the route.
