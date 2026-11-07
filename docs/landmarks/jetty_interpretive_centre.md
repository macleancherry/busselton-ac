# Busselton Jetty Interpretive Centre

## What it is

The row of four blue gabled "boatsheds" on the jetty deck at the start of the Busselton Jetty, about 50 m out from the beach. Built in 2001. It holds the jetty shop, ticketing for the train and the Underwater Observatory, and a small museum. The jetty train's shore stop (Roy Morris Platform) is beside it on the walkway side. inHerit calls the sheds "of little heritage significance".

The base already builds a plain version of these sheds from the OSM outline (`src/core/jetty.ts`, `JETTY_SHEDS`). This landmark is the detailed one, laid over it.

## Footprint

Measured from the Landgate aerial (`out/refs/jetty_interpretive_centre/aerial40.jpg`, 0.078 m/px, and `grid40.jpg`, the same turned so the jetty runs up the page, with a 2 m grid) and checked against the OSM outline (way 217605383, `building=yes`, `layer=1`, `name=Busselton Jetty`).

- **Shape:** four gabled sheds side by side in a row along the jetty, all the same depth. The row's long axis runs on a bearing of about 327°/147° (OSM; the aerial reads 324°).
- **Row:** about 26.2 m long in the aerial (sheds about 6.7, 6.4, 6.4 and 6.7 m wide, NW to shore), 26.7 m in OSM.
- **Depth (walkway gable to sea gable):** about 9.8 m in the aerial, 11.0 m in OSM.
- **Verandah:** a flat white roof about 4 m deep along the walkway side of the three NW sheds (not the shore shed).
- **Faces:** the gables face the jetty walkway (SW, about 237°) and the sea (NE). The shore shed's long side faces the beach (SE, about 147°): that's the face everyone walking out from the beach sees, with the name on it.
- **Placement:** the aerial puts the building about 3 m further shoreward and 1.5 m further east than the OSM outline, and its south end would then hang off the base's jetty deck (built from OSM). The landmark follows the OSM outline and the base's deck instead, so it sits on what the base builds.
- **Centre (lng,lat):** **115.344678,-33.643905** (middle of the OSM outline and of the landmark's row). The middle of the row in the aerial is about 115.34470,-33.64392.

## Walls and roof

- **On the deck:** the jetty deck is 3.85 m above the map's zero here (the base's `JETTY_DECK`), and it isn't physics ground (nothing under it but sea and sand). The look sets `"floor": 3.85` so the landmark stands on the deck.
- **Storeys:** one. Eaves about 3.0 m above the deck. Steep gables, about 48° (from the gable proportions in the photos), so the ridges are about 6.9 m up.
- **Walls:** blue weatherboard, about `#5580b8`. The 2010 and 2015 photos show a paler blue-grey; the 2021 photos show a stronger blue, which is what's used.
- **Shore shed:** navy weatherboard below the eaves on its beach face and its walkway gable, about `#1d3a76`, with light blue gables above. On the beach face: five white-framed windows and the name above them.
- **Trim:** white bargeboards, fascias, window frames, verandah posts and roof, about `#f2f2ee`.
- **Roofs:** light corrugated metal, near white (`#e6e6e2`, the nearest roof finish is Surfmist).
- **Verandah:** flat, white, about 2.75 m up, on slim white posts along the walkway, with a mustard yellow band (`#e2b84c`) between it and the eaves, and a yellow wall round the main entry doors of the third shed.
- **Windows:**
  - walkway side: two or three small white-framed windows per shed, glass entry doors on the third and fourth sheds
  - sea gables: two each
  - the NW shed's long side (facing the observatory end): three
  - the second and third sheds have a white diamond vent high in the walkway gable; drawn as small square windows (the spec has no diamond)
- **Signage:** plain lettering only.
  - "BUSSELTON JETTY" in white on the shore shed's navy beach face, above the windows (2021 photos; in 2010 to 2015 it read "INTERPRETIVE CENTRE", with "SOUVENIRS GIFTS MUSEUM" under it).
  - Not drawn: the "BUSSELTON JETTY" board on the third shed's walkway gable and the "UNDERWATER OBSERVATORY AND MARINE SANCTUARY" board under the verandah. Spec signs face only the front or back, and the front here is the beach face.

## Grounds

None of its own. The base builds the deck, railings, rails, lamps and the Roy Morris Platform shelter round it.

## Sized to cover the base's sheds

The base's plain sheds (`src/core/jetty.ts`) are 26.4 x 11 m, 3.0 m to the eaves and 38° roofs, on the OSM outline. A polish layer can't remove them, so the landmark is sized to enclose them:
- the row is 26.7 m long
- it is 11.2 m deep, 1.4 m more than the aerial
- its eaves are no lower and its roofs are steeper, so it is taller everywhere

Only slivers of their roof edges under the eaves could show. If a later base build skips jetty buildings inside a landmark's clear, the depth can come back to the measured 9.8 m.

## What a driver sees

There's no road on the jetty. From Foreshore Parade and the jetty car park, about 100 to 150 m away across the foreshore lawn and beach:
1. a row of four steep white-roofed gables on the jetty, standing on piles over the water
2. strong blue walls, with the shore shed darker
3. the white verandah on the walkway side and the name on the beach face

## Unsure

- **Wall colours:** the paint has changed over the years (pale blue and navy in 2010 to 2015, brighter blue in 2021). The current shade is a judgement from phone photos.
- **Depth and exact position:** see "Placement" and "Sized to cover the base's sheds".
- **Window and door positions** on the walkway side under the verandah, and on the sea gables: approximate.
- **Verandah depth:** the aerial reads about 4 m. Built 3 m, to keep its posts clear of the platform and train in the base.

## Sources

- Aerial: Landgate Locate (`exportImage` by bbox, personal use), `out/refs/jetty_interpretive_centre/aerial40.jpg`, `aerial90.jpg`, `grid40.jpg`
- Outline: OpenStreetMap way 217605383 (as built in the base, `JETTY_SHEDS`); deck height from the base's `JETTY_DECK`
- Photos (reference only), `out/refs/jetty_interpretive_centre/web/`:
  - Wikimedia Commons, "Busselton Jetty, 2015 (01)" to "(09)" (`c_04` to `c_12`), "Busselton Jetty, Busselton, WA, June 2022" series (`c_14` to `c_26`), "Busselton Jetty (30 12 2010)" series (`c_27` to `c_30`), "00 1701 Busselton Jetty" (`c_02`)
  - buggybuddys.com.au, Busselton Jetty Underwater Observatory post (2021), `out/refs/jetty_observatory/web/bb_01.jpg`, `bb_02.jpg`
- Text: docs/jetty.md section 3, with Caravan World ("four nautical blue A-framed shacks featuring white tin roofs"), the official site and inHerit
