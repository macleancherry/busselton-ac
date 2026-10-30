# Geographe Bay Yacht Club

## What it is

The Geographe Bay Yacht Club (GBYC) clubhouse, on the dune at the end of a service road off Geographe Bay Rd, Busselton, west of King St. The club started at the base of the jetty in 1959 and moved here in 1971. It shares the grounds and lawn with the Geographe Outriggers and the Naturaliste Game and Sport Fishing Club. A road runs past its west side down to the boat ramp.

Inside: a main hall (140 seated) with big windows to the bay, a lounge room and the Sunset Bar. In 2023 the club extended the verandah and deck about 6 m toward the bay, with a retaining wall, balustrade, picnic tables and shade sails.

**Outside the Busselton build area.** The clubhouse centre is about 86 m west of `routes/busselton.json` `build.area`'s west edge (lng 115.33), and the nearest part (the shade sails on its east side) is about 70 m outside. Its latitude is inside the area. It needs the area pushed west to about 115.3285, or it waits for a larger area build.

## Footprint

Measured from the Landgate aerial (`out/refs/yacht_club/aerial40.jpg`, 0.078 m/px, rotated to the building's axes) and checked against the OSM outline (way 485331705, about 27 x 29 m with the verandah). Everything is single storey except the tower, so lean is small.

- **Axes:** the long walls run on a bearing of about 76°/256°. The building is turned about 14° off north.
- **Main hall:** 26.8 m (east to west) x 16.7 m, with a low pale roof. A low gable fits the aerial best.
- **Verandah:** a 3 m deep pale strip along the whole north face.
- **Race tower:** a raised box about 6.8 x 4.4 m on the north-west corner. Its roof is lighter, and it casts a 2 m shadow onto the hall roof.
- **South wing:** 18.7 x 7.3 m, lower, with three arrays of solar panels (each about 5 x 4 m) behind a light parapet rim.
- **Entry block:** 7.6 x 9.3 m at the south-east, flat light-grey roof. It sticks out about 2 m past the south wing.
- **East annex:** 5.5 x 8 m, flat roof, off the south-east corner.
- **Faces:** the club faces the bay (north, bearing about 346°): lawn, deck and sails. The car park wraps around the west and south sides (angle bays on the west, a strip of bays on the south). The ramp road runs past the west side.
- **Centre (lng,lat):** **115.329073,-33.650602** (middle of the main blocks). OSM outline centre: 115.329044,-33.650569 (it includes the verandah strip, so it sits a few metres further north).

## Walls and roof

From club photos (lawn side, and a drone shot from the south):

- **Walls:** cream-tan face brick all round, about `#d6b98c`.
- **Race tower:** two storeys, about 7 m to the top of the fascia.
  - Ground floor: brick.
  - Above the verandah line: a brick band carrying **"G.B.Y.C." in big royal-blue letters** (about `#1f3fbf`), facing the bay.
  - Upper storey: a white band with a ribbon of windows (the race office), wrapping onto the west face.
  - Top: a flat roof with a dark green fascia (about `#2e4a3e`), plus a floodlight, a loudspeaker, a weather vane and an antenna.
- **Verandah:** flat or low white roof on slim white posts. It runs east from the tower across the hall's glass wall.
- **Hall north wall:** a long run of sliding glass doors and windows to the bay.
- **Roofs:** pale corrugated metal (Surfmist-like, `#e4e2d8`). The solar panels are on the south wing.

## Grounds

- **North (bay side):**
  - The 2023 deck: timber, with picnic tables, and a cream limestone-block retaining wall about 0.7 m high with a timber rail.
  - **Six blue shade sails** (about `#1e6fc4`) in a row over the deck and lawn, about 31 m long and 6 m deep. The row runs past the hall's east end.
  - Earlier photos show green market umbrellas instead.
  - Beyond: "acres of lawn" for rigging boats, then the dune and beach.
- **East:** a brick-paved BBQ courtyard under **four teal sails** (2 x 2, about 10 x 12 m in all), then a tall hedge and big trees.
- **West:** a concrete footpath, then the car park and the boat ramp road. Boats and trailers stand at the south-west.
- **South:** car park bays along the south wing, and a big tree by the service road.

## What a driver sees

Driving in from King St along the service road or the car park:
1. A long, low **tan-brick clubhouse** with a solar-panelled roof.
2. On the far (north-west) corner, a **two-storey tower** with a white window band and dark fascia.
3. Coming round the west side toward the ramp: the **blue "G.B.Y.C."** letters on the tower, and the **blue sails** over the deck facing the bay.

## Unsure

- **The south and east faces:** no photos found, so their walls, windows and doors are guessed (tan brick, no openings modelled). The main entrance is probably on the south or west, from the car park.
- **The hall roof form:** a low gable, from aerial shading only.
- **Tower height:** about 7 m, judged from the photo.
- **Deck extent and finish:** the aerial shows lawn under parts of the sail row. The deck may be smaller than modelled.
- **No Mapillary coverage** within 150 m.

## Sources

- Aerial: Landgate Locate (via scratchpad `aerial.mjs`), `out/refs/yacht_club/aerial40.jpg`
- Outline and roads: OpenStreetMap via Overpass (`out/refs/yacht_club/osm.json`)
- Club photos (reference only): gbyc.com.au venue hire page, sailing.org.au "Club in Focus", `out/refs/yacht_club/web_*.jpg`
- https://www.sailing.org.au/news/club-in-focus-geographe-bay-yacht-club-gbyc
- https://busseltonmail.com.au/all-hands-on-deck-for-yacht-club-expansion/ (2023 deck and sails)
- https://www.gbyc.com.au/venue-hire
