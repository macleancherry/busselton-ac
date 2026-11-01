# Spec: what the last upstream-era build tests checked

Status: written 1 Nov 2026 from the old `test/track.test.ts`, `test/roundabout.test.ts`, `test/streets.test.ts`, `test/gates.test.ts`, `test/kangaroo.test.ts` and `test/origin.test.ts` (all on `UPSTREAM-FILES.txt`), so they can be deleted. Each item below is a behaviour none of the newer tests checks; the fresh tests (`test/buildEndToEnd.test.ts`, `test/ringOnRoute.test.ts`, `test/sideStreetsBuild.test.ts`) are written from this page, not from the old files. Behaviours the newer tests already cover are listed at the end and not repeated.

## A. A point-to-point road over hills, with a hairpin (`buildEndToEnd.test.ts`)

Scene: a winding road of 2 to 3 km on synthetic hills (a smooth height formula that climbs more than 10 m), ending in a tight hairpin, 6 to 7 m wide, imagery off.

1. Every mesh is either a physics mesh (a digit, then a surface key the build writes: ROAD, STREET, GRASS, WALL, KERB) or a visual mesh with no digit; every position and normal is finite. There is at least one `1ROAD_` mesh and one terrain mesh (`1GRASS_t...`).
2. The dummies a point-to-point needs are there: `AC_START_0`, `AC_HOTLAP_START_0`, `AC_AB_START_L/R`, `AC_AB_FINISH_L/R`, and 8 pit boxes `AC_PIT_0..7`.
3. The start and finish lines (the midpoint of each L/R pair) sit within 1 m of the timed start and finish samples, which are the pins. The road carries on at least 100 m past the finish (room to stop); `stats.timedLength` is the distance between them.
4. Every spawn (first and last grid slot, pit 0, hot lap start) is behind the start line, on the asphalt (laterally at least 0.5 m inside the edge) and faces up the road.
5. Nothing on the keep-off list (`KEEP_OFF` in clearance.ts: kerbs, strips, gutters, paths, rails, Armco) is left standing on the route.
6. The terrain stays at least 0.1 m below the asphalt wherever both have a vertex in the same 1.5 m cell, checked at more than 100 places.
7. The AI line has one point per sample; its last distance is 99% to 102% of the road length (it runs along the 3D road); every speed is 3 to 70 m/s and the hairpin forces one under 25 m/s. `ai_hints.ini` slows the AI for the hairpin and carries the 80 km/h country limit (`VALUE=0.8`).
8. The road follows the DEM: a sample a third of the way along is within 3 m of the height formula; `stats.climb` is over 10 m.
9. Zipped and unzipped, the kn5 comes back the size `stats.kn5Bytes` says.
10. The road's own materials (`road_asphalt_*`, `road_chipseal_*`) in the built kn5 use the detail-mapped `ksPerPixelMultiMap` with `useDetail` on (the material builders are unit-tested; this checks the build picks them).
11. Point to point: `data/challenges.ini` has a `[TT_START]` and a `[TT_FINISH]`, `extension/autotest.lua` says `local CLOSED = false`, and `data/surfaces.ini` allows track scripts (`[_SCRIPTING_PHYSICS]`, `ALLOW_TRACK_SCRIPTS=1`).

Other small scenes in the same file:

12. **Fixed origin.** With `origin` set, `proj.origin` is that point and a shorter route through the same points maps them to the same local coordinates. Without it the map centres on the route, so the shorter route moves them (more than 10 m here).
13. **Pins on a long jittered road.** A 4 km road drawn with 1.5 m of zig-zag jitter (as routing data often is) still puts the timed start and finish within 5 m of the first and last route points.
14. **Kangaroo signs** (the hairpin scene will do). A country road over 2 km with nothing built along it asks the art renderer for `warning:kangaroo` art of kind `warning`.
15. **Gate signs** (the hairpin scene will do). On a timed road the START and FINISH sign art (`FURNITURE_SIGNART` meshes) stands on both sides of the road at each line, more than half the width plus 1 m from the centreline, and more than 1.8 m above the road's height there.
16. **Photo ground.** With imagery on, every ground material (`terrain_*`, `grass`, `verge`) uses `ksMultilayer` and its mask texture is in the kn5.

## B. A roundabout on the route (`ringOnRoute.test.ts`)

1. `fitCircle` recovers the centre and radius of a 120 degree arc to 3 decimals.
2. `resolveRoundabouts` takes the OSM ring first (its radius and lane count), then a circle through the driven arc, then a 12 m guess on the side clockwise traffic turns about (heading east, the centre is 12 m south).
3. A route through a hinted 15 m roundabout (straight in from the west, round the north side, straight out east): one roundabout in the plan, radius 15; more than 15 samples between `sIn` and `sOut`, each within 0.3 m of the circle and with curvature under 1/10.
4. The build has `1ROAD_RB0`, `1GRASS_RBISLAND0`, `1GRASS_RBVERGE0` and `1WALL_RB0`. The ring road goes all the way round (vertices more than 10 m south of the centre), faces up (normal y over 0.99), and there are two `1ROAD_RBC0_` connector pieces.
5. Kerbed (town), `buildRingMeshes` gives a gutter (`1ROAD_RBGUTTER0`) and a kerb (`1KERB_RB0`); the kerb's top is 0.15 m over the ring's outer edge, but within 2 cm of it where the route crosses the edge, and across the whole of a wide entry opening (50 degrees).
6. The straight road ribbon (`1ROAD_<n>`) stops at the ring: no triangle centre inside the outer radius minus 1 m.
7. Give-way markings: `MARKINGS_RB0` is built. For one opening centred on angle 0 (east), the paint covers only the entering half (south, as traffic keeps left), outside the outer radius minus 0.45 m, 1.5 cm over the ring surface, facing up, dashed 0.6 m on and 0.6 m off from 2.5 m in.
8. A two-lane ring (9.2 m wide) gets a broken lane line on its circulating radius (within 6 cm), about a third painted (3 m on, 6 m off).
9. The AI line through the ring stays more than 1.4 m outside the island and has no kink: within 20 m of the ring no point turns more than 0.35 rad from its neighbours.
10. `ringsOnRoute` finds a 10 m ring the route crosses, even from two half rings; it ignores a ring the route doesn't touch, a quarter arc (a curved arm) and a ring already found.
11. `aiHintsIni`: a town limit below the corner's speed wins (0.5, no 0.6); with a high limit the corner's 0.6 shows; an open end adds a 0.15 crawl at the end, a closed road doesn't.

## C. Side streets, names and street furniture (`sideStreetsBuild.test.ts`)

Scene: an 800 m straight route (a secondary road) at a constant height, 7 m wide, with a minor T junction on the north side, a minor crossroads, a motorway crossing and a minor street on a bridge; street names for the route and the two minor streets; a bus stop, a named servo and a named cafe; Mapillary sightings of a stop sign, a 60 sign, a utility pole and a street light standing on the road.

1. Three side streets (the T and both arms of the crossroads); nothing along the motorway or the bridge.
2. The T junction's street runs right up to the route's edge.
3. The verge is open at the T junction's mouth (no verge triangle on that side within 2.5 m of the street's line).
4. Name blades for all three names; `stats.streetSigns` is 6 (three mouths, each with the side street and the route); the sign art material is alpha tested (`ksPerPixelAT`).
5. Art for the bus stop, the stop sign, the 60 sign and sign backs, and POI art for the servo and the cafe by name; canopy, timber, lamp and sign art furniture meshes are built (wide meshes may be split into `_T<n>` tiles).
6. The street light seen on the road is moved off it: its steel stands more than 3.5 m from the centreline.

## Already covered elsewhere (not repeated)

Road material registers and detail (`materials.test.ts`, `ac-kn5.test.ts`); the ksMultilayer register layout and detail textures (`materials.test.ts`); Grass FX and occluding materials, rain relief and sound banks (`cspConfig.test.ts`, `rainHollows.test.ts`, `trackSounds.test.ts`); time-trial lines (`timeTrial.test.ts`); zip layout (`zip.test.ts`); keep-off clipping (`clearance.test.ts`); grid behind the start and the spawn axis (`trackStages.test.ts`); gate sign and kangaroo sign placement, Mapillary value mapping and merging repeat sightings (`furniture.test.ts`).
