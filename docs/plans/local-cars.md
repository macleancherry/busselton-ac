# Local cars

Plan, 3 Nov 2026. Swap the boxy parked cars (and later the traffic cars) for the cars you actually
see in a WA regional town: white dual-cab utes everywhere, LandCruiser and Prado-type wagons,
RAV4 and CX-5-type SUVs, Corolla and i30-type hatches, Camry-type sedans, HiAce-type vans, the odd
tradie ute with a canopy, a caravan or a boat trailer.

Rules: our own generated geometry only. No logos, badges, grilles copied from a real car or
manufacturer models. Each body is built from a handful of published overall dimensions (length,
width, height, wheelbase), so it reads as "a Hilux-type ute" without being anyone's design. The
generators are covered by the fork's licence like the rest of our code.

Prototype on this branch: a dual-cab ute (`src/core/vehicles/ute.ts` over `src/core/vehicles/vehicle.ts`),
282 triangles near and 86 far. Renders are in `out/local_cars/` (see the end).

## How it works today

### Parked cars

- **Where they come from.** `carpark.ts` paints the cars out of the aerial photo and records each
  one's spot, heading and colour. `parkedPlacement.ts` (with `parkedBays`) moves each into a real
  bay (car park aisles at AS 2890.1 sizes, 2.6 x 5.4 m, or kerbside slots). `stages/parked.ts`
  then drops any on roads, rings, traffic lanes, kerbs, off the asphalt or on uneven ground.
- **The mesh.** `parkedCars.ts` `addCar`: one box for the lower body (4.5 x 1.8 m), a tapered box
  for the cabin (glass sides, painted roof) and four wheel blocks. **44 triangles, 88 vertices** (the
  comment says "about 60"). Colour from a 14-swatch atlas (`parked_car.png`): 12 paints, glass,
  tyre. `paintFor` turns the photo's colour into a paint (neutrals by brightness unless the photo
  is clearly coloured).
- **Seating.** `carSeat` tilts each car to the ground under its four wheels (fixed positions
  `WHEELS` = ±1.4 m, ±0.74 m) and drops cars whose tyres would sink.
- **Output.** All cars merge into `PARKED_CARS_nn` meshes (split at 65,535 vertices) in one group,
  through `cullable` (120 m tiles; no draw distance for this group), plus invisible `1WALL_CAR`
  boxes (4.4 x 1.75 x 1.7 m) to hit.
- **Busselton now:** 386 parked cars (`out/accepted/busselton.stats.json`), so about 17,000
  triangles. The whole build is 1.39 to 1.41 million triangles against `budget.ts`'s 1.5 million
  limit: about 90,000 to spare.

### Traffic cars

- The track ships only `data/traffic.json` (lanes, intersections, zones). It ships **no car
  models**.
- **CSP's traffic planner** loads its cars from the CSP install, not the track:
  `extension\lua\tools\csp-traffic-tool\data\*.json`, each naming three kn5 files (`main`, `lod`,
  `collider`), with optional `chance`, `color`, `maxSpeed`, `lights`, `dimensions`, `physics`.
  Converted cars have everything but the wheels under a node `BODY`. Details and sources in
  [traffic-cars.md](../traffic-cars.md). The stock pack is LODs of Kunos cars; there is no Aussie
  pack.
- **AI Flood and AssettoServer** drive ordinary AC cars from `content\cars` (full physics).
- So: planner traffic can take our own models, written by our own kn5 writer, as long as they're
  installed into the CSP folder. AI Flood would need full AC car mods (physics, sounds), which is a
  different, much bigger job.

## The vehicle set

Rough mix for a WA regional town's parked fleet. These are estimates from new-car sales leaders
(Ranger, Hilux, RAV4, Everest, CX-5, Corolla, i30, LandCruiser and Prado) and what's still on the
road (older Commodores, Falcons and Camrys, plenty of work utes), weighted towards utes and 4WDs
for the South West. They're fine-tuned by eye in a test build, not researched to the percent.

| Body | Real-world examples (reference only) | Share | Notes |
| --- | --- | --- | --- |
| Dual-cab 4x4 ute | Hilux, Ranger, Triton, D-Max, BT-50, Navara | 22% | Variants: plain, sports bar, canopy, ladder rack; bull bar, snorkel, roof rack |
| Single or extra cab, alloy tray | Hilux and LandCruiser 70 work utes | 5% | Flat alloy tray with headboard, toolboxes |
| Large 4WD wagon | LandCruiser 300/200, Prado, Everest, Pajero Sport | 12% | Tall, square, often bull bar and roof rack, spare on the back door (Prado) |
| Medium SUV | RAV4, CX-5, Tucson, X-Trail, Outlander, Model Y | 18% | |
| Small SUV | CX-3, Kona, ASX, Atto 3 | 7% | The medium SUV spec, shorter and lower |
| Small hatch | Corolla, i30, Mazda3, Yaris | 14% | |
| Sedan | Camry, Commodore, Falcon | 10% | Older long sedans still common |
| Passenger ute | Commodore and Falcon utes | 2% | The sedan's front half with a tray |
| Van | HiAce (van and commuter), Trafic | 4% | Mostly white, tradie roof racks |
| Station wagon | Outback, Commodore Sportwagon | 3% | |
| Towables | caravan, boat on a trailer | 3% of spots near the foreshore and boat ramps | Behind a wagon or ute, long bays only |

**Colours.** White dominates out here, overwhelmingly on work vehicles. Per body (sum 100):

| | White | Silver | Grey | Black | Blue | Red | Other (green, beige, orange) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Utes, vans | 55 | 9 | 15 | 8 | 6 | 4 | 3 |
| Wagons | 40 | 15 | 18 | 10 | 6 | 3 | 8 (beige, green) |
| Cars, SUVs | 26 | 18 | 22 | 14 | 9 | 7 | 4 |

The photo still wins when it's clear (`paintFor`'s coloured branch): a car the photo shows red
stays red. Only the neutral photo colours (most of them) are re-drawn from the body's table, so
the utes come out mostly white even where the photo's white and silver are hard to tell apart.

## How a model is made

A model is a parametric spec in TypeScript, in the spirit of `specHouse.ts` and
`scripts/blender/house.py`'s parts mode: a few numbers in, a low-poly mesh out, with no hand
modelling. The building blocks in `src/core/vehicles/vehicle.ts`:

- **Lower body from a side silhouette.** A list of points round the side profile (nose, bonnet,
  belt, tailgate, bumpers, and the wheel arches cut out of the bottom) with a half width at each.
  Both sides are the silhouette, triangulated (earcut); every edge round it becomes a strip across
  the car. Per point: `inset` and `drop` round the shoulders and nose, `ds` rounds the corners in
  plan. Per edge: what it is (`body`, `across` for arch liners, `skip` for the underside) and what
  colour its middle and corners are. Lamps are free: the grille edge's corner chamfers are the
  headlights, the tailgate's are the tail lamps.
- **Glasshouse.** Windscreen, roof and back face, and the sides split at stations into pillars
  (paint) and windows (glass), with tumblehome (narrower at the roof than at the belt).
- **Parts.** An open tray (rails, liner, floor), wheels (8 sides with a drawn alloy face near,
  plain blocks far), arch flares, mirrors, and boxes for the extras: bull bar, snorkel, sports
  bar, canopy, ladder rack, roof rack. Later: alloy tray and toolboxes, spare wheel, tow bar,
  number plates (plain white rectangles, never text).
- **One atlas** (512 x 128): the 12 paints and 9 fixed swatches (glass, tyre, black trim, alloy,
  headlight, tail lamp, tray liner, chrome, canvas) in the top row, and two drawn tiles (wheel
  face, grille). Every car shares one material. Paint vertices are flagged in the template, so a
  car's copy only rewrites those uvs: one template per model and LOD serves every colour.

Each body gets its own `<body>.ts` with defaults from published overall dimensions only (the ute's
are a current Hilux or Ranger dual cab's length, width, height and wheelbase). Variants are spec
flags, so "white Ranger with canopy, bull bar and snorkel" is one line.

### LODs and triangles

| LOD | Shown | Ute | Cap per body | What's left out |
| --- | --- | --- | --- | --- |
| 0 | 0 to 70 m | 282 tris (plain), 312 (sports bar), 354 (tradie: canopy, bull bar, snorkel, roof rack) | 300 plain, 400 with extras | |
| 1 | 70 to 600 m | 86 tris (plain), 146 (tradie) | 100 plain, 160 with extras | rounding, lamps, mirrors, flares, pillars, wheel faces, tray inside |

Today's car is 44 triangles. 386 cars x (282 + 86) is about 142,000 stored triangles against
about 17,000 now, which would take Busselton to roughly 1.52 million: **over budget.ts's 1.5
million** if it keeps adding up every LOD. But what the GPU draws at once is far less: only the cars
within 70 m are at LOD 0. At the busiest car park, say 60 cars in range, that's
60 x 282 + 326 x 86, about 45,000, so 28,000 more than today. So:

- **budget.ts learns LODs**: meshes with a draw distance count at the worst viewpoint (sample
  points along the drive and every layout, add up what's within each mesh's lodIn to lodOut), not
  stored. That's the honest figure for the RTX 4060 anyway. Stored triangles and kn5 size stay
  limited as they are.
- **Cars are clustered for LOD.** lodIn and lodOut apply per mesh, by its centre, so LOD 0 meshes
  are 40 m clusters (a car park's rows), not 120 m tiles. Draw calls: about 60 to 100 more meshes,
  well inside the 4,000 limit.
- **Vertices.** Flat shading means about 590 vertices per ute at LOD 0 (88 now), so about 110 cars
  per mesh before the 65,535 split. Kn5 size goes up about 15 MB. Fine.
- If a build is still tight, LOD 0 only for cars within 30 m of a drivable road (the ones you see
  close up), and the rest LOD 1 only.

## Parked cars: picking a model and a colour

Deterministic per bay, so a bay's car never changes between rebuilds unless its bay moves:

1. **Seed** = a hash of the bay's centre rounded to 0.5 m and the track slug.
2. **Context weights.** The base mix above, nudged by where the bay is: town centre and shops
   (more hatches and SUVs), beach and foreshore car parks (more wagons and utes; towables in long
   bays near boat ramps and the caravan parks), industrial land (more utes and vans), residential
   kerbs (base mix). Context from OSM landuse and the existing traffic zones.
3. **Fit.** A body is only chosen if it fits the bay: 90-degree bays are 5.4 m, so the 5.3 m ute
   just fits and a ute with a trailer never does. Kerbside slots take anything, towables only in
   slots 12 m or longer.
4. **Variant** (canopy, bull bar, rack) and **colour**: next draws from the same seed; colour by the
   photo when it's clearly coloured, else from the body's colour table.
5. **Heading.** The photo's heading as now (nose in or out as the photo had it).

What has to change with it: `carSeat`'s wheel positions come from the model (wheelbase and track,
not the fixed ±1.4 / ±0.74 m), the `1WALL_CAR` box takes the model's size, and the checks
(`parkedCheck.ts` footprints in bays, `groundCheck.ts`'s PARKED_CARS ground test,
`lane_bay_check`) read the model's length and width instead of 4.5 x 1.8.

## Traffic cars

What's actually possible:

- **CSP traffic planner: yes, with our own models.** A script writes each model as a planner car:
  `main.kn5` (LOD 0, everything but the wheels under `BODY`, four wheel nodes), `lod.kn5` (LOD 1),
  `collider.kn5` (a box), and the JSON (dimensions from the spec, `chance` from the mix, lights
  pointing at the lamp meshes). Colour: if the planner's `color: "modern"` tints a named paint
  material, one car per body is enough; if not, one car per body and colour, with `chance` carrying
  the colour mix (works either way, about 30 small cars). Files go in the share's `traffic-cars\`;
  `install-track.ps1` copies them into CSP's tool folder with a `bsn_` prefix, and a switch moves
  the stock cars aside so only local cars spawn. They're global to CSP, not per track.
- **What has to be checked first** (on the workstation, before writing the converter): the exact
  wheel node names, how `color` is applied, and whether `lights` needs separate meshes (the lamp
  chamfers would then go in their own small meshes). Copy one stock car's JSON and kn5 into the
  share; our `kn5.ts` reads them.
- **Towing in traffic:** a ute with a trailer or caravan can only be one rigid model with a long
  `dimensions.rear`. Fine on straights and the big roundabouts, wrong in tight turns. Later, maybe.
- **AI Flood and AssettoServer:** need real AC cars with physics. Out of scope; use car mods there
  ([traffic-cars.md](../traffic-cars.md)), or much later a "skin" of our body on a car whose data
  we're allowed to use.

## What the workstation tests

1. **Parked cars build** (smoke test plus a drive): cars load, sit on their wheels in every car
   park, no floating or sinking; collision boxes match the bodies (drive into one gently); LOD
   switch at 70 m isn't distracting from the driver's seat; colours look right under CSP's
   lighting; no z-fighting on the lamp and seam strips.
2. **Frame rate** at the busiest car park (the foreshore), before and after, same spot and view,
   CSP's FPS counter. The new budget figure should predict the change.
3. **Traffic planner cars** (phase 4): the planner loads them (CSP log), wheels turn, colours and
   lights work, collisions work, and traffic-test.md T1 to T13 still pass.

## Phases

| Phase | What | Effort |
| --- | --- | --- |
| 0 | This plan, the building blocks and the dual-cab ute prototype with renders (done on `feat/local-cars`) | done |
| 1 | The rest of the set: wagon, medium/small SUV, hatch, sedan, van, single-cab alloy tray, passenger ute, station wagon. One spec each, renders and tests. Number plates, tow bar, spare wheel | 2 to 3 sessions (about 2 to 3 hours a body) |
| 2 | Parked integration behind a `localCars` option: model and colour per bay, LOD meshes in 40 m clusters with lodIn/lodOut, per-model wheels for `carSeat`, collision boxes and check footprints, budget.ts LOD-aware count, render_diff before and after, one Busselton build through `all.mjs` | 1 to 2 sessions, plus a build and a workstation drive |
| 3 | Context and towables: weights by landuse and zone, caravans and boat trailers in long bays and near ramps and caravan parks | 1 session |
| 4 | Traffic planner cars: check the format on the workstation, then the converter, the share folder and the installer switch; traffic test | 1 session plus a workstation run |
| 5 | Polish: night lamps (CSP emissive on the lamp swatches), two-tone and dirt variants, more extras (trailer hitch bike racks, kayaks on roof racks) | as wanted |

## Prototype

- Code: `src/core/vehicles/vehicle.ts` (building blocks, atlas), `src/core/vehicles/ute.ts` (the
  dual-cab ute spec and builder), `test/vehicles.test.ts`.
- Export and render:

  ```
  npx tsx scripts/cars/export_vehicles.ts <dir>
  python3 scripts/cars/render_vehicles.py -- --dir <dir> --out <png> --cars ute_lod0[,boxy_car,...] --view front34|side|rear34|driver
  ```

  (`python3` being Blender's bpy module, or `blender --background --python`.) The export writes
  the ute's variants and today's boxy car (built by `buildParkedCars` itself), and prints each
  triangle count.
- Triangles: ute 282 (LOD 0), 86 (LOD 1); with sports bar 312; tradie (canopy, bull bar, snorkel,
  roof rack) 354 and 146; blue ute with ladder rack and bull bar 422 (the rack is the costly part:
  trim it in phase 1). Today's car: 44.
- Renders (960 x 540, 16 samples, not committed): `out/local_cars/ute_front34.png`,
  `ute_side.png`, `compare_side.png` and `compare_boxy_vs_ute.png` (today's car next to the ute and
  the tradie ute), `ute_variants_rear34.png` (sports bar, canopy, ladder rack).
- Not done yet: it isn't in the build. Nothing in `src/core/stages` uses it.
