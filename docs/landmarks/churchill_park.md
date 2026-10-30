# Churchill Park grandstand and halls

## What it is

Churchill Park is Busselton's main sporting ground, east of the town centre. It has a harness-racing track around a turf oval (the Busselton Trots run here over summer, with the Boxing Day meeting), a cricket and football oval, and a large grass field on the west. The bowling club is on its south-west corner ([description](busselton_bowling_club.md)). The park itself is ground and trees, which the base already makes. What stands up is the row of buildings along the north side of the track: the old grandstand, a stewards' tower, two big halls (one is Churchill Park Hall, a hire venue) and a green-roofed building at the east end, with concrete terraces and a shelter on the apron.

## Footprint

Measured from the Landgate aerial `out/refs/parks/churchill_stand.jpg` (centre 115.3512,-33.6466, 0.107 m/px). Low buildings, but the tower and halls lean a little. About ±1 m.

- **Orientation:** the same grid as the bowling club, long axis about 76.5°. The fronts face the track, bearing about 166.5° (SSE). The street runs behind them on the north.
- **Middle of the group:** **115.351267, -33.646464**. It is about 100 m wide.
- **West to east:**
  - **Grandstand:** about 37 x 13 m. A low-pitched roof over the rooms and seats, with a striped green-and-white valance along the front over a flat canopy about 4 m deep.
  - **Stewards' tower:** about 4 x 5 m, in front of the grandstand on the apron, about 6 m to the eaves. Its shadow is long and narrow.
  - **Link:** about 6 x 10 m, flat roof.
  - **West hall:** about 20.5 x 13.5 m, pale Colorbond gable roof with its ridge along the row.
  - **East hall:** about 15.5 x 15 m, same.
  - **East building:** about 19.5 x 16 m, pale green gable roof. It carries on past the edge of the aerial with a white-roofed building.
- **Apron:** asphalt between the buildings and the track, about 20 m deep, with:
  - two banks of open concrete terraces (4 and 3 steps, about 19 and 18 m long)
  - a green open-fronted shelter about 15 x 3 m
  - the white rail fence along the track

## Walls and roof

From the aerial only. Hex values are approximate.

- **Roofs:** the halls and the grandstand's back roof are off-white or pale Colorbond and zincalume (`#d9dacd`). The grandstand's front slope is a grey-green (`#bdbfba`). The tower, the east building and the shelter are pale green (`#9fbfa4`), which the build draws as the nearest grey.
- **Valance:** green `#2f7d5b` and white stripes, about 1.85 m each. Drawn as panels along the canopy fascia.
- **Walls:** not visible. Drawn as:
  - pale corrugated cladding for the halls
  - cream weatherboard for the grandstand
  - white for the tower
  - face brick for the link and the east building
  
  **These are guesses.**
- **Signage:** none drawn. I don't know what the club signs say.

## What a driver sees

From the street on the north: the backs of the halls and the grandstand, which are big plain gable ends and long roofs, with the tower's hipped top over the grandstand. From the bowling club car park: the west end of the grandstand. Drivers don't get onto the track. The front views are for the track-side camera and anyone looking across the oval from the east.

## Unsure

- Wall finishes and colours, and which hall is Churchill Park Hall.
- Whether the tower is the judges' or stewards' box. Its shadow says it's tall and narrow.
- The white-roofed building at the west end (just off the west edge of the stand) and the one east of the green building are left out.
- The group is just east of the town area's polygon (`build.area` east edge 115.3505). It is drawn only where the map reaches.

## Sources

- Landgate Locate aerial; OpenStreetMap (Churchill Park, way 1372610087)
- City of Busselton, Churchill Park and Churchill Park Hall venue pages: https://www.busselton.wa.gov.au/community/parks-facilities-and-venues/churchill-park.aspx
- Busselton Mail, trotting at Churchill Park: https://busseltonmail.com.au/busselton-trotting-season-off-and-racing/
- Reference files: `out/refs/parks/` (churchill_stand.jpg, churchill_ov.jpg, churchill_bowls.jpg, trot_0.jpg)
