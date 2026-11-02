# Dressing Collie Motorplex: the plan

Collie is the one real circuit we have (`routes/collie-motorplex.json`, `out/collie_motorplex.zip`). Right now it's a bare loop: asphalt, edge lines, generic houses. This lists what is really there, where it is, and how each item gets into the track: as a spec landmark (no code), or as code.

Everything below was read from the Landgate aerial (Oct 2026). A few event photos (Barbagallo's Passione Ferrari 2024 gallery) helped with the pit garages and the paddock, and club pages gave the facility list. Positions are `lng, lat`.

## What's there

| Item | Where | Notes |
| --- | --- | --- |
| **Start line and grid** | Line across the main straight at **116.24327, -33.43013** | A thick white line level with the race tower. Staggered grid boxes, two abreast, run about 50 m back up the straight (NE). Cars race SW down the straight, so the circuit runs anticlockwise, as the route says. |
| **Race tower** | 116.243457, -33.430311, paddock side, 18 m off the track edge | Two storeys, white upper floor with glazing, flat roof. **Spec.** |
| **Pedestrian bridge** | 116.243021, -33.430472, 45 m after the line | Covered footbridge, 47 m, square to the straight. The only thing over the track: Collie has **no start gantry**. **Spec.** |
| **Pit garages** | 116.243974, -33.430932, in the paddock 67-126 m from the straight | Sawtooth of gabled steel sheds, deep verandah over 12 open bays (the club says 42 in all). **Spec.** |
| **Clubrooms or canteen** | 116.243686, -33.430225 | Long, low, khaki flat roof, round shade canopies. **Spec.** |
| **Spectator lawn** | 116.243369, -33.430533 | Lawn with shade sails, a barbecue square and jacarandas. There is no grandstand and no built spectator mound. **Spec.** |
| **Amenities** | about 116.24325, -33.43075 (west of the paddock road) | Three brick buildings with hip roofs (toilets, office, bunkhouse?). The base builds one generic house here. Later spec. |
| **Timing hut** | by the paddock wall, 18 m SW of the tower | In the race tower spec. |
| **Pit lane** | Leaves the inside of the north hairpin (about 116.2447, -33.4285) and runs SSW, between tyre walls, into the paddock road at about 116.2441, -33.4300 | An asphalt lane, not beside the straight. There is no pit wall in the F1 sense. |
| **Walls along the main straight** | Both sides of the straight, 15-25 m out | Concrete barrier lines (dark lines in the aerial) on the outfield side and the paddock side, plus a fence on the paddock side. |
| **Tyre walls** | Outside of most corners, both sides of the long-layout extension, round the pit lane | About 800 m of triple tyre wall was added with the 2019 extension (Shire of Collie). In the aerial they show as black dotted lines along nearly the whole southern half. |
| **Kerbs (red and white)** | Inside of the north hairpin, both sides of the bend at the foot of the main straight, the infield corners where short and long layouts split, the kink on the extension, and both sides of the south-east hairpin | Standard red-white bands, visible in the aerial at the apexes and exits. |
| **Runoff** | Orange gravel traps on the outside of the north hairpin, the east side and the extension's hairpin; pale sand and dirt elsewhere | |
| **Burnout pad** | about 116.24372, -33.43178, south end of the paddock | Black asphalt square ringed with tyres. |
| **Paved pad west of the straight** | about 116.24350, -33.42958 | About 60 x 11 m of asphalt parallel to the straight, about 25 m west of it. Possibly the drag-strip staging or a second burnout or drift pad. |
| **Drag strip** | Not separately visible | The club lists a 1/8 mile club-level strip. It most likely uses the main straight (it's straight and wide for about 300 m). |
| **Drift and skid area** | Big orange dirt area NW of the north hairpin, with donut marks | |
| **Signage** | | No readable venue signage in the photos. Anything we add is plain lettering ("COLLIE MOTORPLEX" on the bridge, "RACE CONTROL" on the tower). Both are invented. |

## Spec landmarks (done, waiting for the lead to add them)

Five specs in `routes/landmarks/` with docs in `docs/landmarks/`:

- `collie_pit_garages`
- `collie_race_tower`
- `collie_clubrooms`
- `collie_spectator_lawn`
- `collie_pedestrian_bridge`

They need a looks file for the Collie route (proposed: `routes/landmarks/collie_looks.json`, listed in the route's `"looks"`).

**The paddock needs an area patch.** The pit garages stand 67-126 m from the track edge, beyond the route's 60 m corridor, so they would sit on the horizon mesh. A small `build.area` like Cape Leeuwin's patch fixes that: detailed ground, and the paddock roads built. Proposed: `[[116.2430,-33.4299],[116.2446,-33.4299],[116.2446,-33.4316],[116.2430,-33.4316]]`, with `streetsValid: false`.

Later specs, cheap and no code: the amenity buildings and the shed south of the pit garages.

## Needs code (recommendations, in order)

1. **The real start/finish line, grid and pits (route plus a small build change).** Move the start to the line at 116.24327, -33.43013: the first pin, or a `build.startAt`. Put `AC_START_n` on the real grid boxes (two abreast, about 8 m rows, back up the straight) and `AC_PIT_n` in the 12 verandah bays. Bay centres, facing out at 286°, are listed at the end of this file. The pits only work if the pit lane and paddock road are drivable surface joined to the track (item 4).
2. **Circuit kerbs at corners.** Red-white bands at apexes and exits, placed from the centreline's curvature (raceway builds only). About 1 m bands, 1-1.2 m wide, low profile, with a `KERB` surface key with rumble. The course-marks ripple strip (`courseMarks.ts`) is close: reuse its band mesh and surface. Better still, hand-list the corners as centreline fractions in the route, since the real kerbs aren't on every bend.
3. **Barriers: tyre walls and concrete walls.** A generic barrier along hand-traced polylines in the route (`build.barriers: [{ kind: "tyres" | "concrete", line: [[lng,lat], ...] }]`). Tyres are stacks of black tyres three high, as an instanced or merged mesh with a solid wall. Concrete is a plain grey wall about 0.8-1 m. Tracing the lines from the aerial is an afternoon's work. The Armco code is the nearest existing thing (`armco` is off for this route). An offset-from-centreline option would be quicker, but the real walls aren't at a fixed offset.
4. **Pit lane and paddock surface.** The pit lane (hairpin to paddock) and the paddock road as asphalt, drivable, ideally from OSM ways if they're mapped (check: Overpass was down while this was written). Otherwise trace them in the route like `ways`. The area patch above builds any OSM streets inside it.
5. **Runoff surfaces.** Gravel traps (orange) as a gravel physics surface, sand and dirt runoff as dirt, the paddock as asphalt. These could come from a few hand-drawn polygons in the route (`build.runoff`), or from the photo's colour inside the corridor.
6. **Grid paint.** Raceway markings currently give edge lines and a start/finish line only. Add numbered grid boxes at the real grid.
7. **Start lights.** Nothing visible from above. Probably a light box on a post at the wall by the line. A small post-and-lights model as part of the start/finish code; there's no point guessing it as a spec.

Not worth code: the drag strip (it's the main straight) and the drift area (it's dirt).

## Can't be done as specs

- Anything over the track that needs physics (the bridge deck has none, which is fine at 5.4 m).
- Kerbs, tyre walls, walls and fences along curves: spec blocks are axis-aligned boxes.
- Sloped or stepped ground: a landmark sits flat at the ground height of its middle.

## Pit bay centres (for `AC_PIT_n`, facing 286°, under the verandah)

```
[[116.243858,-33.430648],[116.243845,-33.430685],[116.243832,-33.430723],[116.24382,-33.43076],
 [116.243807,-33.430797],[116.243794,-33.430835],[116.243781,-33.430872],[116.243768,-33.430909],
 [116.243756,-33.430947],[116.243743,-33.430984],[116.24373,-33.431021],[116.243717,-33.431059]]
```

## Sources

- Landgate Locate aerial (Oct 2026); OSM raceway ways 89374807 and 733256017
- Collie Motor Sport Club, track page (42 undercover pit bays, race tower, pedestrian bridge, anticlockwise, 13 corners): https://colliemotorsportcomau.r6d.dev/
- MCRCWA, Collie Motorplex (2.7 km circuit, 1/8 mile club drag strip, burnout pad): https://www.mcrcwa.com.au/collie-motorplex/
- Shire of Collie, long track approved for racing (May 2019; 2.55 km, 800 m of triple tyre wall): https://www.collie.wa.gov.au/news/collie-motorplex-long-track-approved-for-racing/
- Barbagallo Motors, Passione Ferrari Collie Motorplex 2024 (pit verandah and paddock photos): https://www.barbagallo.com.au/passione-ferrari-collie-motorplex-2024/
