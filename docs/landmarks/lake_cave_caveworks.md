# CaveWorks and the Lake Cave visitor centre

## What it is

The visitor centre for Lake Cave, in the Leeuwin-Naturaliste National Park off Caves Road, about 20 minutes south of Margaret River (Lake Cave Road, from the Conto Road corner). It holds the ticket desk and shop, the CaveWorks interpretive centre (a walk-through cave model, displays, a film) and the Lake Cave tearooms. Run by the Margaret River Busselton Tourism Association. A boardwalk east of the building leads to a viewing platform over the Lake Cave doline, and about 300 steps go down to the cave. OSM: building way 219411451 ("Caveworks"), car park way 219411452.

Route: **caves-road-boranup.json** (Caves Road Boranup). Looks file: `routes/landmarks/caves_road_boranup_looks.json`. Two specs, because the tearoom wing is set at 64° to the rest:

- `routes/landmarks/lake_cave_caveworks.json`: the hall, the shop arm with the entry canopy, and the lower parts on the south-east side.
- `routes/landmarks/lake_cave_caveworks_wing.json`: the tearoom wing to the north-west.

## Footprint

From the Landgate aerial `out/refs/lake_cave/cw.jpg` (centre 115.02940,-34.07898, half 40 m, 0.1 m/px), rotated to the hall's axis with a 2 m grid (`out/refs/lake_cave/cw_rot.png`). The wider crop `lake.jpg` (0.2 m/px) shows the doline, the car park loop and Caves Road. About ±1 m.

- **Hall:** about 22 m (east-north-east) by 12.5 m, its long axis at bearing **65°**, solar panels in two rows on the south-south-east slope. Its east-north-east end faces Caves Road.
- **Shop arm:** about 9.4 m wide, running 22 m west-south-west from the hall to the entry. The last 5 m of that is the entry canopy.
- **Lower strip and south-east wing:** a 3.4 m strip along the hall's south-south-east side, and a skewed wing about 7 x 10 m off it (squared off here).
- **Tearoom wing:** about 26 m by 7.9 m, its long axis at bearing **124°/304°**, running north-west from the junction of the hall and the shop arm. A dark verandah about 4.6 m deep along its south-west side.
- **Middles:** main spec **115.029428, -34.079013**, facing **245°** (the entry, towards the forecourt and the car park). Wing **115.029241, -34.078929**, facing **214°** (the forecourt).
- **Around it:** the red-gravel car park loop to the south-west, a paved forecourt between the car park and the entry, karri, marri and peppermint all round, and the doline about 40 m east of the hall, between the building and Caves Road.

## Walls and roof

From a 2014 photo of the entry (`out/refs/lake_cave/fp2785_s.jpg`) and 2021 Mapillary photos round the forecourt (`out/refs/lake_cave/mly_sheet.jpg`; CC BY-SA, reference only).

- **Walls:** coursed cream limestone blocks `#D8C8A2`; footings a shade darker `#CFBE96`.
- **Roofs:** pale Zincalume or Surfmist sheeting `#E4E2D5`, low pitches (10 to 15°). The hall is the tallest part, with a glazed band under its eaves.
- **Entry:** a tall glazed wall in dark navy frames `#26303C`, under a curved canopy of pale corrugated sheeting on navy steel arches and posts.
- **Tearoom verandah:** a dark grey skillion `#3D4246` on navy posts, with picnic tables under it. "Lake Cave Tearooms" in small plain lettering on the limestone wall.
- **Signs:** a free-standing blue board by the entry (the real one says tickets, information, tearooms and toilets, with a logo); here it says "LAKE CAVE" in plain lettering.

## What a driver sees

Caves Road passes about 100 m east, on the far side of the doline, through tall forest. Heading south from Mammoth Cave, the hall's pale gable end and glazed band show through the trunks on the right, with the low tearoom wing behind it. The building stands just outside the road's 70 m corridor, so the route has a landmark patch (`build.area`) to give it detailed ground.

## Approximations

- The curved canopy is a flat slab on four posts.
- The south-east wing's skew is squared off.
- The solar panels and the doline boardwalk are left out.
- Limestone skirts go down 1.2 m under the walls, because the ground falls about 1.5 m to the north-east across the site.

## Unsure

- **Where each room is:** the hall is taken as the CaveWorks exhibition (an inside photo shows a gable ceiling and glazing onto a deck), and the north-west wing as the tearooms.
- **The south-east wing and the lower strip:** heights and use are guesses; only their roofs are seen.
- **The hall's glazed band:** from the 2014 photo's curved glazed roof behind the canopy; how far it runs is assumed.
- **Ground:** on the 2 Nov base the main spec finds corridor ground 3.8 m above the horizon mesh the wing stands on. It needs a base build with the landmark patch.

## Sources

- Parks and Wildlife (DBCA), Cave Works and Lake Cave: https://exploreparks.dbca.wa.gov.au/site/cave-works-and-lake-cave
- showcaves.com, Lake Cave: https://showcaves.com/english/au/showcaves/Lake.html
- The Food Pornographer, Lake Cave (photos, 2014): https://thefoodpornographer.com/2014/06/lake-cave-margaret-river/
- Mapillary (2021, CC BY-SA, reference only)
- Landgate Locate aerial; OpenStreetMap
