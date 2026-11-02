# Signal Park

ROADMAP Phase B tourism item 9. Specs: `routes/landmarks/signal_park.json` (the toilet block) and `routes/landmarks/signal_park_market.json` (optional Sunday market stalls, off by default).

## What it is

Signal Park is the big foreshore lawn west of Queen St and north of Marine Tce, between the West St car park and the shared path that curves down to Queen St. The City lists it under Queen St. The Busselton Foreshore Markets and the Rotary Markets run here on alternate Sunday mornings (1st, 3rd and 5th Sundays for the Foreshore Markets). Fairs and circuses also use it: the Landgate aerial (Oct 2026) shows a carnival set up on the fenced lawn by the path. The rest is open lawn with a sports oval marked out, big trees round the edges, and the 24-hour public toilets.

What stands up is the toilet block. **No shade structures show in the aerial:** the shade is the trees along the edges, and the "shaded benches" in visitor reviews are under them. So the spec has the toilet block and no sails or shelters.

## Footprint

Measured from the Landgate aerial `out/refs/signal_park/sp_toilet.jpg` (centre 115.34215,-33.64600, half 22 m, 0.043 m/px) with a pixel grid, and checked against the two OSM toilets nodes (4159452194 and 11799136648), which sit just in front of its south side. The base has no building here, only grass, so the block is missing from the map today. About ±0.5 m.

- **Middle:** **115.342142, -33.645950**.
- **Orientation:** the long axis runs at bearing 69° (WSW-ENE). The front faces 159° (SSE), to the oval and the paths that come in from the south-east.
- **Size:** roof about 16.2 x 6.9 m, single storey.
- **Entry court:** a recess in the south front, about 3 m wide and 2.4 m deep, 10 to 13 m from the west end.
- **Surroundings:** big trees close on the north and west, and pale concrete paving along the front and into the recess.

## Walls and roof

- **Roof:** low-pitch Colorbond gable, pale grey-white `#dcdfda` (reads near white in the aerial), about 12°.
- **Walls (not confirmed):** drawn as pale rendered masonry `#d8cfb9` with a darker plinth band, dark doors `#3b4046` and high louvre strips under the eaves.
- **Recess:** a darker inset band `#8d8a82` with two doors and a small TOILETS sign in plain lettering.
- **Height:** walls about 2.9 m, ridge about 3.6 m.
- **Budget:** 250 triangles.

## Market stalls (optional)

`signal_park_market.json` is a representative Sunday market, not a survey of one: two facing rows of ten 3 x 3 m pop-up gazebos, each with a trestle table on the aisle side, either side of a 4 m aisle. It sits on the fenced lawn west of the shared path, where the aerial shows the fair. Most canopies are white, with a few blue, green and red, and a valance on the front and back so the colour shows from eye height. The legs come from the spec's sail posts. 4,920 triangles.

It is **not in looks.json**, so no build has it. A route turns it on by adding its looks entry (below) to a looks file it lists. A "Sunday" layout could add it to its own looks file.

## What a driver sees

From Marine Tce and the West St corner, across the oval:

1. A long low pale building under the trees on the far side of the lawn.
2. Its front with dark doors and the TOILETS sign in the recess.

With the market on: rows of white gazebos with a few coloured ones, on the lawn by the curving path down to Queen St, from Queen St and Marine Tce.

## Looks entries

```json
{"at": [115.342142, -33.64595], "specFile": "routes/landmarks/signal_park.json", "name": "Signal Park toilets", "facing": 159}
{"at": [115.34283, -33.646259], "specFile": "routes/landmarks/signal_park_market.json", "name": "Signal Park market stalls (Sunday)", "facing": 82}
```

## Unsure

- **Wall finish and colours:** no photo of the block found. Limestone, brick or render are all likely for a City of Busselton foreshore toilet.
- **Doors:** the number and positions of the doors (only the recess is clear in the aerial).
- **Market position:** whether the markets set up on the fenced lawn by the path (as drawn) or on the oval side. The stall count changes from week to week.
- **The planter and sign at the Queen St / Marine Tce corner:** a low L-shaped planter wall and a small sign on two legs. They may be the park's name sign, but it couldn't be read, so they're left out.
- Base trees on the lawn may poke through some gazebos when the market is turned on. Check that in the build before a route uses it.

## Sources

- City of Busselton, Signal Park: https://www.busselton.wa.gov.au/community/parks-facilities-and-venues/signal-park.aspx
- Margaret River Busselton Tourism, Signal Park (markets on alternate Sundays, 24-hour toilets, playground): https://www.margaretriver.com/?p=1850762
- WA Holiday Guide, Signal Park ("Signal Park, Queen Street"): https://www.waholidayguide.com.au/western-australia-accommodation/signal-park
- Margaret River Find the Fun, Busselton Foreshore Markets (Signal Park, 1st, 3rd and 5th Sundays): https://margaretriverfindthefun.com.au/listing/busselton-foreshore-markets
- Wanderlog, Signal Park (Google Maps pin 115.342465,-33.646373, on the oval): https://wanderlog.com/place/details/4177243
- OpenStreetMap: toilets nodes 4159452194 and 11799136648 (ODbL)
- Landgate Locate aerial (references only), around 115.3427,-33.6462 and 115.34215,-33.64600
