# Road network core: behaviour spec

Status: design, with a prototype in `src/core/network/` behind `networkCore` (off by default). Nothing in the build uses it yet. This spec is the brief for the replacement of the route-first core (`road`, `roadMesh`, `sideStreets`, `roundabout`, `kerbs`, `markings`, `trace`), per recommendation 4 of `docs/external-review-2026-10-31.md`. It describes behaviour, not code. The new modules are written from this spec, not from the old files.

## Why

Today the route is one ribbon and everything else is attached to it: side streets are cut back and draped on the terrain, roundabouts are annuli with connector pieces, and each piece has its own height rule. Every junction is two or three meshes meeting, which is where the lips, steps, dips and overlaps come from. The new core models the network first: roads between junctions, and each junction as one surface with one height field. The route, the AI line and the traffic lanes become paths through that network.

## Terms

- **Way**: an OSM way as fetched (drivable `highway=*`), with its tags.
- **Vertex**: a point where ways connect. OSM connects ways only through shared nodes, so two ways cross without connecting (bridges, tunnels, `layer`) unless they share a node.
- **Edge**: a stretch of road between two graph nodes, with one centreline, one width profile and one height profile.
- **Junction**: a graph node where three or more edge ends meet, or a roundabout. It owns a polygon and a height field.
- **Leg**: one edge end at a junction.
- **Cap**: the straight line across a leg where the edge ribbon ends and the junction surface starts. Both meshes share it.

## Inputs

1. **Ways**: polylines in local metres (the build's projection, `build.origin`) with: road class (`highway`), `oneway`, `junction=roundabout|circular`, `lanes`, `width`, `layer`, `bridge`/`tunnel`, `name`, `surface`, `service`. From the Overpass response the build already fetches (`out tags geom`). That response has no node ids, so **shared nodes are found by identical coordinates** (lng/lat to 7 decimals). This works because a shared OSM node has one coordinate. Never snap by distance: two ways a few centimetres apart are not connected, and treating them as connected is how fake crossings get made.
2. **Traced widths and lines** (optional): per edge, from the aerial photo trace (the trace's job is unchanged: where the asphalt is and how wide). A traced line may move an edge's centreline sideways by up to 3 m. It never moves a vertex or a cap, so topology never changes.
3. **Heights**: a terrain height function (DEM, LiDAR where available). One function for the whole build.
4. **The route** (optional): OSRM steps or a list of OSM way ids, used only to choose a path through the network (see "The route").
5. **Options**: default widths by class, the fillet (kerb return) radius by class pair, the crown, the transition lengths below, and the junction height tolerance.

## Outputs

1. **The graph**: nodes (position, kind: junction, roundabout, dead end, or a mid-road vertex kept for a tag change), edges (centreline, width per sample, class, one-way, lanes, name, layer), and for each junction its ordered legs (anticlockwise by outward direction).
2. **Junction polygons**: one simple polygon per junction (roundabouts have one hole, the island, plus one hole per splitter island). Boundary = road edges joined by fillets, and one straight cap per leg.
3. **One height field per junction**: `h(x, y)`, defined over the polygon and a 1 m margin. It matches every leg's cap exactly.
4. **Edge height profiles**: centre height and cross-slope per sample, matching the junction fields at both caps.
5. **Meshes**: road surface (edges and junctions), kerb and gutter, verge or nature strip, markings. All take their heights from the same functions: edge profiles and junction fields. The physics surface is exactly the visual one.
6. **One height query for everything else**: `surfaceAt(x, y)` returns the built road height wherever there is road (the junction field or the edge profile) and the terrain elsewhere. Scenery placement (recommendation 2) uses it.
7. **Lanes**: per edge, lane centrelines and directions. Per junction, connectors (movements) from each incoming lane to each allowed outgoing lane, as curves on the junction field. AI lines and CSP traffic lanes are built from these. Nothing is fitted again afterwards.

## Building the graph

1. Keep drivable ways: motorway through service, `_link` roads, `living_street`, `road`, `track` when unsealed roads are on. Drop `area=yes`, `highway=construction`, `access=no` (unless the route uses it).
2. Every coordinate used by two or more ways, or twice by one way, or at the end of a way, is a vertex. Split ways at vertices.
3. Merge through degree-2 vertices: two edges meeting end to end at a vertex used by nothing else become one edge. The width, class and tags change along it, eased over 20 m. A vertex is kept (as a "mid" node) only where the layer, bridge or tunnel state, or one-way changes.
4. **Roundabouts**: union every edge tagged `junction=roundabout|circular` into clusters by shared vertices. Each cluster is one roundabout junction. Its circle is a least-squares fit to the ring's points. A ring that doesn't fit a circle (RMS > 15% of radius) is an oval or a "circular" road: build it as ordinary edges and junctions. Its carriageway width is the tagged width, else 4.6 m a lane for `lanes>=2`, else at least 7 m. Ring edges are internal to the junction: they don't become edges.
5. **Splitter islands**: two one-way edges that leave the same outer vertex and both end on the same roundabout within 40 m are one approach. The outer vertex becomes the leg. The area between the two one-way edges, inset by their half widths, is a splitter island. It is a hole in the junction polygon, with a mountable kerb.
6. **Dual carriageways**: two one-way edges in opposite directions, parallel within 30 m for more than 50 m, are one road with a median. They keep separate edges and lanes, and their junctions merge into one junction when their nodes are within the sum of the half widths plus 12 m. (Not in the prototype.)
7. **Complex junctions**: junction nodes closer together than the sum of their trims (below) merge into one junction. This covers dog-legs and staggered T-junctions. The edges between them become internal.
8. **Grade separation**: ways that don't share a vertex never connect, whatever their layer. Bridges and tunnels are edges whose heights come from their ends (linear between the caps, with a vertical curve), not from the terrain.

## Junction polygons

The polygon is the union of the legs' road areas near the node, with fillets between neighbouring legs, cut off at each leg's cap.

1. **Leg shapes**: each leg is its edge's centreline from the node out to the cap, buffered by its half width (the traced width when there is one), with a flat end at the cap.
2. **Fillets**: neighbouring legs are joined by a smooth union with radius r: 6 m between roads of class tertiary or higher, 4 m for residential roads and anything smaller, 2 m for service roads and driveways. This is the kerb return. The polygon edge between two legs is one smooth curve, never a notch.
3. **Trim (cap distance)**: walk out along each leg in 0.25 m steps. The cap is the first position where every point on the cap line is more than r + 0.5 m outside all the other legs' shapes (and outside a roundabout's outer circle). If two legs are nearly opposite (a through road), the trim is half the widest other leg plus r. A trim never goes past the next node or more than 60% of the edge's length. If it would, the two junctions merge (step 7 above).
4. **Roundabouts**: the shape is the disc of the outer radius (centre-line radius + half width), minus the island disc, plus each approach's leg shape, joined with the fillet radius of that leg's class. Each splitter island is a hole.
5. **Output**: the polygon's outline, anticlockwise, with holes clockwise, at a spacing of at most 0.5 m on fillets. The caps are exact straight segments.

## Heights

Heights come from one rule per piece, applied in this order: junctions first, then edges conform to them.

### Junction fields

1. **Leg planes**: for each leg, take the terrain along its edge, smoothed (Gaussian, sigma 15 m along the edge), at the cap: height `h_i`, and grade `g_i` along the leg's outward direction. A leg plane is `P_i(p) = h_i + g_i · ((p − c_i) · d_i)`, with no crossfall (the crown is gone at a junction).
2. **Base plane B**: the priority road decides it.
   - **Through road**: the two highest-class legs, if they are the same class and more than 135° apart, form a through road. B is the plane through their two cap centres, sloping along their common axis, with the cross slope of a least-squares plane fitted to the terrain over the polygon.
   - **Otherwise** (equal roads, T-junctions of minor roads, roundabouts): B is the least-squares plane through all the leg cap centres, weighted by class.
   - B's grade is limited to 4% (2.5% on roundabouts). The rest goes to the edges.
3. **Conform or blend**: the residual of each leg is `r_i = h_i − B(c_i)`.
   - If every `|r_i|` is at most the junction tolerance (0.10 m; most of the South West), every leg conforms. Its plane becomes B, and **the field is B**: one plane.
   - Otherwise the field is B plus a Shepard blend of the leg residual planes: `h(p) = (B(p)/D² + Σ P_i(p)/d_i(p)²) / (1/D² + Σ 1/d_i(p)²)`, where `d_i` is the distance from p to cap i (a segment, so `d_i = 0` along the whole cap) and D is half the junction's size. The field equals `P_i` exactly on cap i and is smooth inside. Legs belonging to the through road always take B (it doesn't bend for a side street).
4. **Roundabout crossfall**: the circulating carriageway falls outward at 2%: `h = B(p) − 0.02 · (clamp(ρ, r_in, R_out) − r_in)`, where ρ is the distance to the centre. Outside the ring, ρ is held at R_out, so the approaches and caps stay planar. The island sits at the field plus 0.15 m (its kerb).
5. **Water**: the field's lowest boundary point should be at a cap or a gutter, not in the middle. Check: no local minimum inside a junction deeper than 5 mm (it's where rain pools; `rainHollows` reads it).

### Edge profiles

1. **Centre height**: the terrain along the centreline, smoothed (sigma 15 m). At each end, the difference to the junction field at the cap centre is eased in over the transition length L: `h(s) = smooth(s) + Δ_start · e(s / L) + Δ_end · e((len − s) / L)`, with `e(t) = 1 − smoothstep(t)` for t < 1 and 0 beyond. L = 15 m, or half the edge's length if it's shorter than 30 m. On a very short edge between two junctions the two transitions overlap and add, which keeps both ends exact.
2. **Cross-section**: on the edge's body, the crown (2%) and any banking. Over the last 8 m before a cap, the crown eases to 0 and the cross slope eases to the junction field's slope across the cap. At the cap the edge surface is a straight line equal to the field there.
3. **Bridges and tunnels**: the profile is the straight line between the two caps, with a vertical curve (parabola) at each end over 20 m. The terrain isn't used.
4. **Dead ends**: the far end just keeps the smoothed terrain. A turning circle (OSM `turning_circle`) is a small junction with one leg and a disc of 8 m radius.

### Continuity rules (tests)

- Along every cap, the edge mesh and the junction mesh agree within 1 mm, at every vertex of either mesh.
- No step over 5 mm anywhere on the drivable surface, except at kerbs (kerb meshes are the only intended steps).
- No drivable triangle covers another drivable triangle (no overlapping road meshes at all; today's base has thousands of these at junctions).
- Gradient jumps: across a cap the surface's slope changes by no more than 2% (the edge transition takes the rest).

## Meshes

1. **Edges**: a ribbon per edge between its caps, sampled every 2 m (finer where the terrain bends, as `densifyStreet` does today). Cap rows use every junction boundary vertex that lies on the cap, so there are no T-vertices.
2. **Junctions**: a constrained triangulation of the polygon (outline, holes and caps as constraints), plus interior points where the field isn't planar: on a 2 m grid where the Shepard blend is active, none where the field is B. A planar junction is a few dozen triangles.
3. **Kerb and gutter**: one continuous band along every road boundary: edge sides and junction fillets together, as one polyline per kerb run. A kerb run ends only at a driveway layback, a cap onto an unkerbed road, or a dead end. The gutter's inner edge is the road boundary. Its height comes from the road field at that point, with the 150 mm kerb above it. Kerbs at fillets therefore come with the junction and need no special return code.
4. **Verge and nature strip**: from the kerb back (or the road edge where there's no kerb), out to the frontage line or the verge width. The ground mesh is cut to the outer edge, and its heights there are set to the verge's, so the terrain can't rise through a road (no more `terrainUnderRoad` drop).
5. **Markings**: from the lanes, not the edge outlines. Edge lines and centre lines run along edges and stop at the cap. In a junction there are only give-way and stop lines at the caps (from OSM `stop`, `give_way`, signals), the roundabout's circulating lane line, and turn arrows on the approach. Markings sit 15 mm above the field.
6. **Mesh names**: unchanged (`1ROAD_*`, `1STREET_*`, `1KERB_*`, `1GRASS_*`) so `surfaces.ini`, the checks and the AI tests keep working. Junction meshes are `1ROAD_J<n>` or `1STREET_J<n>`, depending on whether the route uses the junction (a route-valid surface) or not.

## The route

The route becomes a path through the graph, not the source of the geometry.

1. **Map matching**: the OSRM geometry (or the listed way ids) is matched to a sequence of edges. Walk the OSRM polyline. At each step take the edge whose centreline is within 8 m and whose direction is within 45°, preferring the edge connected to the previous one. A gap (no matching edge for more than 30 m) is an error in the build report, not a silent detour.
2. **Through a junction**: the path's line is the movement connector from the incoming lane to the outgoing lane (below). Through a roundabout, it follows the circulating lane's arc between the entry and exit connectors.
3. **What the route still decides**: start/finish, the pit and grid positions, timing gates, and which junctions and edges are "valid track" (the `1ROAD_` surfaces). Layouts are other paths through the same graph. Free roam is the whole graph.
4. **What it no longer decides**: road shape, width or height. Building the route and building the area use the same geometry, so a street driven as part of a layout is the same mesh as when it isn't.

## Lanes, AI line and traffic

1. **Lanes per edge**: from `lanes`, `lanes:forward/backward`, `oneway`, else by class (2 for a two-way road, 1 for one-way). Lane width = traced width / lane count. Keep left: lane centres at ±w/4 on a two-lane road.
2. **Movements**: for each pair of legs at a junction, the lane connections allowed (no U-turn unless it's a dead end or a roundabout; `turn:lanes` when tagged; `restriction` relations when fetched). Each connector is a cubic curve from the incoming lane's cap point to the outgoing one, tangent to both lanes. Heights come from the junction field. On roundabouts: entry curve, then the circulating lane's arc, then the exit curve.
3. **AI line** (`fast_lane.ai`): the route's path built from lane centres and connectors, smoothed only within each junction (never across a cap by more than the lane half width). Keep-left falls out of the lanes. Speed hints come from connector curvature.
4. **Traffic lanes** (CSP): every lane and connector, exported directly. Intersections in CSP's traffic file are the junction polygons, so lanes can't overlap outside them. This removes the overlap fixes in `traffic.ts`.
5. **Layout checks**: a layout is valid when its path is connected in the graph. `layout_check` checks that on the graph, not the meshes.

## Tracing

The trace keeps its job (`trace.ts` today, to be rewritten from its own spec): along each edge, find the real asphalt edges and centre. Its results go onto edges only: a lateral offset (limited to 3 m, eased to 0 within 10 m of every cap) and a width per sample. Junction polygons are built after tracing, from the traced leg widths. The trace never runs inside a junction (it can't read one: paint, wide asphalt, cars).

## Edge cases

- **Missing Overpass data**: no graph. The build stops with "MISSING DATA" as it does today. There's no fallback to vector-tile lines, which have no shared nodes.
- **Ways that touch the area edge**: an edge leaving the area polygon runs 30 m past it and ends as a dead end, blended to the terrain.
- **Very short edges (< 2 m)** between two junctions: the junctions merge.
- **Junctions with more than 6 legs, or polygons that self-intersect**: log them, and fall back to the merged polygon of the legs without fillets.
- **Car parks and driveways** (`service=parking_aisle|driveway`): edges like any other, with service fillets. Car park surfaces themselves stay with `carpark.ts`.
- **Levels and bridges over roads**: bridges get decks from their profile, and the road below stays on the terrain. Nothing connects them.
- **Roundabout without OSM ring** (only an OSRM hint): no roundabout junction. Report it. (Today's circle fit to the route's arc goes away.)

## Performance budget

The Busselton town area has about 340 junctions and 470 edges (osm2streets on the cached Overpass data: 334 intersections, 474 roads). Targets: graph and polygons under 1 s, heights and meshes under 5 s, and junction triangles under 150k in total (planar junctions are small; only blended ones get interior points).

## Not in scope

Buildings, trees, footpaths and scenery placement (recommendation 2 is a separate spec built on `surfaceAt`), kn5 writing, and imagery.

## osm2streets (evaluated 31 Oct 2026)

[osm2streets](https://github.com/a-b-street/osm2streets) (Apache-2.0) does the 2D half of this: lane and intersection polygons from OSM. Its npm build, `osm2streets-js` 0.1.4 (WASM, 1.9 MB, published June 2023 and not since), runs in Node. On the cached Busselton town Overpass response (converted to OSM XML with node ids made from the coordinates), it built 474 roads and 334 intersections in about 0.25 s. We don't depend on it, for these reasons:

- **2D only.** It has no heights, meshes, kerbs or verges. That's most of the work here, and all of the junction artefacts.
- **Roundabouts are a ring of short roads with a small intersection at every entry**, not one junction. That's the same stitching this spec gets rid of.
- **The published build is old, and the API is marked unstable.** The README says "the API isn't stable yet", and `toJson()` is documented as having no compatibility guarantees. Repository activity has slowed: 28 commits in the year to the last snapshot, no releases. Taking a newer version means building the Rust and WASM ourselves.
- **Its output needs work before it's usable.** It logs "trimmed into oblivion" and "intersection_polygon called with no roads" on Busselton's short links. Default widths ignore our traces, and it needs OSM XML with node ids, which we'd have to make up.

The licence would allow it (Apache-2.0 is permissive and compatible with owning the code; it needs its notice kept). Use it instead as a design reference (dual-carriageway merging and complex-junction collapsing are worth reading) and as a dev-time oracle: a script can compare our junction polygons with its intersection polygons on the same data.

## Prototype (what exists now)

`src/core/network/` (fresh code, no imports from the old core or other upstream-derived files):

- `graph.ts`: ways to vertices and edges by identical coordinates, merging through degree-2 vertices, roundabout clusters, splitter-island approaches (step 5), and merging junctions joined by an edge under 15 m (step 7).
- `junction.ts`: leg shapes as signed distance functions, smooth-union fillets, trims by the walk above, a roundabout as an annulus plus legs, and paired one-way legs (a dual carriageway or a long splitter) trimmed together with the median as a hole.
- `heights.ts`: leg planes, the base plane with the through-road rule, conform-or-blend, roundabout crossfall, and edge profiles with eased ends.
- `mesh.ts`: the junction surface as a 0.5 m grid clipped to the polygon (marching squares; the outline comes from the same pass), and edge ribbons from cap to cap.
- `index.ts`: `buildNetwork(ways, height, opts)`. `preview.ts` is the `networkCore` option (off): when it's on, the build writes `network/network.json` (junctions, legs, trims, fields, polygons) into the zip, for inspection only. AC ignores the folder.
- `scripts/network/`: `compare.ts` (prototype against a built zip, junction by junction: overlap and lip metrics, glbs), `plot_compare.py`, `render_compare.py` (Blender, clay, heights exaggerated), `whole.ts` (every junction in an Overpass response: timing and failures), `debug_node.ts`.

What it leaves out: dual carriageways as one road (only their junction ends are paired), CDT meshing (the grid makes 3,000 to 15,000 triangles per junction), clipping edge ribbons against neighbouring junctions (where a trim hits its limit, a ribbon can lie under a junction for a metre or two), kerbs, verges, markings, lanes, route matching, tracing, and the through-road rule for dual carriageways (the paired legs should count as one road). The Shepard blend adds up to about 2% of slope where caps disagree. If that shows in driving, replace it with a membrane (Laplace) solve over the junction grid, with the caps fixed, which can't overshoot.
