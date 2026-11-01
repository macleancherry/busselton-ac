# The Fire Station (bar)

## What it is

The Fire Station, a small bar and restaurant in the former Busselton Fire Station (No 2) at 68 Queen St. It was built from 1936 and is on the City's heritage list.

- **Where:** west side of Queen St, between the ANZ bank (north) and Mitchell Park (south).
- **Not the DFES station:** `fire_station.json` / `fire_station.md` are the working Busselton Volunteer Fire and Rescue station on Albert St, a different building.

**OSM:** pub node 6982509835. The building's footprint is misplaced in OSM. Way 746586422, a 114 m² box, sits about 6 m east of the real building, half over the footpath. **The accepted base builds that box, with no sign.** Its centroid falls inside this spec's clear circle, so the spec replaces it.

## Footprint

From the Landgate aerial (`out/refs/fire_station_bar/fire_aer.jpg`, centre 115.34445,-33.65025, half 30 m, 0.059 m/px), rectified square to Queen St (`fire_rect.jpg`, facing 76).

- **Hall:** about 7.7 m to the street by 20.5 m deep, under a hipped terracotta roof with its ridge running back from Queen St.
- **North side:** hard against the bank.
- **Courtyard:** paved, on the south side (about 7 by 16 m), toward Mitchell Park. Four white canopy strips about 5.3 by 1.5 m run across it, with a white umbrella and a tree at the back.
- **Footpath:** tables with dark umbrellas outside the front.

## Walls and roof

From inHerit and the Busselton Mail (2011).

- **Walls:** brick, "partly rendered, partly face brick".
- **Front:** a parapet with simple rendered pilasters, chamfered at the edges, flanking the appliance doors. The roof is tile.
- **Colours:** the bar restored a 1930s colour scheme. Its actual colours are a guess:
  - face brick `#93503A`
  - cream render `#E4D8B8`
  - deep green frames `#3F5A4A`
  - roof tiles `#B5603F`
- **Sign:** "THE FIRE STATION" in plain red letters on the parapet. Its wording and place are a guess.

## What a driver sees

On the Foreshore and Town routes, heading up Queen St:

1. A narrow cream parapet front between the bank and the park.
2. Its two wide glazed openings where the appliance doors were.
3. White canopies in the courtyard to the left.

## How the spec draws it

`routes/landmarks/fire_station_bar.json`, from `gen_fire_bar.py`.

- **Hall:** one hip block 4.2 m to the eaves.
- **Parapet front:** a render panel to 6.1 m standing in front of the hip, with a stepped middle to 6.6 m, three proud pilasters and a brick plinth.
- **Openings:** two glazed openings with doors.
- **Courtyard:** brick paving, awnings on posts, tables, a low open fence.
- **Clear circle:** 16 m, kept tight on purpose. At about 18 m it would take in the bank's centroid and delete the bank. That's why the footpath tables have no paving under them.

## Unsure

- **The front:** parapet shape and height, the number and size of the openings, the colours, the signs.
- **The back:** whether the rear part (the last 5 m) is a lower wing. The aerial hints at a change in the roof there.
- **The canopies:** whether the courtyard's white strips are sails, umbrellas or a pergola.

## Sources

- inHerit, Busselton Fire Station (No 2) fmr: https://inherit.dplh.wa.gov.au/Public/Inventory/Details/2547383a-ecd2-42f2-ba1c-1d205adbdf67
- Busselton Mail, "Small bar for old fire station": https://www.busseltonmail.com.au/story/226640/small-bar-for-old-fire-station/
- OpenStreetMap (node 6982509835, way 746586422); Landgate Locate aerial (Oct 2026)
