# Augusta Hotel

## What it is

The Augusta Hotel on Blackwood Avenue, the town's pub, on the left at the start of the Cape Leeuwin route. Its street front is the reception and restaurant verandah, the green AUGUSTA HOTEL board, and the gabled glazed dining room that sticks out to the footpath. Two more specs cover the rest of the front: the drive-in bottle shop and bars to the north (`augusta_hotel_bottleshop.md`) and the two-storey motel wing to the south (`augusta_hotel_motel.md`).

Route: **cape-leeuwin.json**. Looks file: `routes/landmarks/cape_leeuwin_looks.json`.

## Footprint

From the Landgate aerials `out/refs/augusta_hotel/hotel.jpg` (centre 115.1605,-34.3168, half 40 m) and `hotel_wide.jpg` (centre 115.1608,-34.3175, half 130 m), and the 2019 Mapillary dashcam run.

- All three specs share one frame. Its origin is the route's first centreline point (115.1602323, -34.316908). x runs along the road the way you drive (bearing 158°), y back from the centre line. The building line is 9.6 m back.
- **Main body:** 31 x 17 m, single storey, from 6 m before the start to 25 m after it.
- **Dining room:** 5.2 x 11.2 m, gable end to the footpath, 12 to 17 m after the start.
- **Verandah:** 12 m along the front, north of the dining room. A white entry canopy is north of the verandah, and a lower hipped wing south of the dining room.
- Middle **115.160482, -34.316917** (the spec's centre).
- **Facing:** the spec's front faces bearing **248°** (west-south-west, across the road).

## Walls and roof

- Cream render `#EFE7D3`, red Colorbond roofs (built as `manorred`).
- Dining room: white `#F3F1EA`, glazed on three sides, dark half-timbering `#3B2F28` in the gable, pink streamers `#D0609A` along the eaves.
- Signs: "RECEPTION & RESTAURANT" on the verandah fascia and the "AUGUSTA HOTEL" board on its post, both in plain cream lettering on dark green `#2E5A3A`.
- A low rendered planter wall with red brick capping along the footpath, and a garden bed in front of the verandah.

## What a driver sees

On the grid, the hotel is on your left: the verandah, the green sign and the glazed gable with its pink streamers. The motel follows as you pull away.

## Approximations

- Red Colorbond is built as manorred, darker than the real red. The brighter red picks a cement tile finish.
- The half-timbering is a band and three upright strips (no diagonals).
- The base builds the whole hotel complex as one generated 76 x 102 m block (its OSM outline). The clear removes it, so the rear wings, kitchens and beer garden behind the three specs are left empty. You can't see them from the road. A rear block was tried, but it pushed the clear across the road.

## Unsure

- The verandah roof's colour (it looks darker than the main roofs on the aerial).
- The exact width of the dining room's gable.

## Sources

- Landgate Locate aerial; Mapillary (bob3bob3, 2019, reference only); OpenStreetMap (Augusta Hotel/Motel)
