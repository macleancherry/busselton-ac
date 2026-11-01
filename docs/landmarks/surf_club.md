# Busselton Surf Life Saving Club and Youth and Community Activities Building

## What it is

One building, opened in 2018 and designed by D'Agostino and Luff with Surf Life Saving WA and the club. It is on the foreshore east of the jetty base, in the Busselton Youth Precinct, beside the skate park, with the Marine Tce car park to the south-west.

- **Surf club side:** training, communications, storage, administration and first aid.
- **Youth side:** the City's meeting and function rooms with a kitchen. The Shift youth team runs Friday nights here.

**OSM:** way 749124331, about 1,350 m².

**The accepted base has no building here.** It has been cleared, probably by a neighbouring landmark's clear circle (not checked which), so the spot is empty.

## Footprint

From the Landgate aerial (`out/refs/surf_club/slsc_aer.jpg`, centre 115.34665,-33.6446, half 50 m, 0.098 m/px), rectified two ways: `slsc_w.jpg` (facing 235) and `slsc_e.jpg` (facing 171).

**Layout:** a fan of about six white blades round a grey-roofed spine that runs NNW to SSE, about 25 m long.

- **West:** three blades step down toward the car park:
  - the north-west one carries solar panels and faces the beach
  - a middle one
  - a lower one with a fenced boat yard on its south-east side
- **East:** three more blades face the youth precinct lawn and the skate park, the north-east one with solar panels.
- **Skew:** the blades fan out up to about 18° from each other.

## Walls and roof

No close photo. 2021 Mapillary views from the car park show it only at a distance.

- **Walls:** white `#ECEBE6`.
- **Roofs:** white low-pitch Colorbond `#EEF0EC`, with a grey spine roof `#9EA3A3`.
- **Solar:** arrays on two blades.
- **Openings:** roller doors, upper-floor glazing and glass doors are drawn where they'd usually be. They are guesses.
- **Sign:** "BUSSELTON SURF LIFE SAVING CLUB" in plain red letters on the middle blade's car park end. It's a guess. There is no sign on the east spec, because its wording isn't known.

## How the spec draws it

specHouse blocks are square to their spec, so the fan is split into **two specs, each square to its own blades**:

- `routes/landmarks/surf_club_west.json` (facing 235): the three west blades and the spine. The spine is a 12° gable.
- `routes/landmarks/surf_club_east.json` (facing 171): the three east blades.

Both come from `gen_surf_club.py`.

- **Roofs:** each blade is a low hip (4°). Heights 6.3 to 8.8 m are guesses, stepped to match the aerial's shadows.
- **Solar:** thin dark slabs just above the roof.
- **Fit:** the overlay (`chk_slsc.jpg`) shows each blade's area matching the aerial to within a couple of metres. The skew between blades is lost.
- **Clear circles:** 28 m (west) and 25 m (east). No generated building falls inside. They do clear the palms around the building, so the west spec puts three trees back on the car park side.

## Unsure

- **Which half is which:** which half is the club and which is the youth building.
- **Building details:** all the openings, wall heights and the signs.
- **The fan shape:** it can only be approximated. A Blender layer would do it properly.

## Sources

- Busselton Mail, "Youth building opens" (2018): https://www.busseltonmail.com.au/story/5171799/youth-building-opens/
- City of Busselton, Busselton Foreshore Youth Precinct: https://busselton.wa.gov.au/connect/youth/youth-spaces-and-programs.aspx
- OpenStreetMap (way 749124331); Landgate Locate aerial (Oct 2026); Mapillary (CC BY-SA, reference only), 2021-01
