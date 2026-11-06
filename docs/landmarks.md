# Landmarks

The buildings and places locals would point at, each built from its own spec (`routes/landmarks/`, `src/core/specHouse.ts`) instead of a generated house, or, where a spec can't say it (figures, curved roofs, fine detail), as a Blender detail layer (`routes/layers/`, scripted in `scripts/blender/landmarks/`). Both compile to their own small models (`lm_<slug>.kn5`, layers), so a new one goes in without a base rebuild. Each one gets a description first (`docs/landmarks/<slug>.md`), from the Landgate aerial and reference photos. The photos are only for reading shapes, sizes and colours; they never go into the track. Reference photos live in `out/refs/<slug>/`, which is not committed. Names on signs are plain lettering, with no logos.

Places near home are private: their descriptions and specs go in `routes/private/landmarks/` and appear in the private whole map only.

Status: ✅ built · 📝 described · 📷 gathering photos · ⬜ to do

## Busselton (Foreshore and town centre)

In the accepted base of 2 Nov: 37 spec landmarks (listed in `routes/landmarks/looks.json`) and five Blender layers.

| # | Landmark | Where | Status |
| --- | --- | --- | --- |
| 1 | Busselton Jetty, Interpretive Centre boatsheds, Underwater Observatory, jetty train | Foreshore | ✅ (`src/core/jetty.ts`) |
| 2 | Rocky Ridge Brewing Co | 10 Marine Tce | ✅ (`routes/landmarks/rocky_ridge.json`), pergola and festoon lights as a Blender layer |
| 3 | Esplanade Hotel | 30-38 Marine Tce | ✅ ([description](landmarks/esplanade_hotel.md)) |
| 4 | The Goose | Foreshore, by the jetty | ✅ ([description](landmarks/the_goose.md)) |
| 5 | Old Courthouse group and the Old Post Office Cafe | Queen St | ✅ ([description](landmarks/old_courthouse.md)) |
| 6 | Hilton Garden Inn | Foreshore Pde and Jetty Way | ✅ ([description](landmarks/hilton_garden_inn.md)) |
| 7 | Busselton Visitor Centre (Railway House) | Foreshore Pde | ✅ ([description](landmarks/visitor_centre.md)) |
| 8 | Busselton Museum (the old Butter Factory) | Peel Tce, by the Vasse River | ✅ ([description](landmarks/busselton_museum.md)) |
| 9 | Sea Play on the Bay playground and the Transition sculpture | Foreshore | ✅ Blender layers ([description](landmarks/sea_play.md)) |
| 10 | Foreshore cafes: Kyst, Sandbox | Foreshore | ✅ ([description](landmarks/foreshore_cafes.md)) |
| 11 | Geographe Bay Yacht Club | Geographe Bay Rd | ✅ ([description](landmarks/yacht_club.md)) |
| 12 | Orana Cinemas | Albert St | ✅ ([description](landmarks/orana_cinemas.md)) |
| 13 | The Tav, the Ship Inn (and its stables wing), the Banksia Tavern | Town centre | ✅ ([The Tav](landmarks/the_tav.md), [Ship Inn](landmarks/ship_inn.md), [Banksia](landmarks/banksia_tavern.md)) |
| 14 | Busselton Pioneer Cemetery | Marine Tce | ✅ ([description](landmarks/pioneer_cemetery.md)) |
| 15 | Busselton Volunteer Fire and Rescue station | Town centre | ✅ ([description](landmarks/fire_station.md)) |
| 16 | Busselton Bowling Club, Churchill Park, Barnard Park | East of the jetty | ✅ bowling club ([description](landmarks/busselton_bowling_club.md)); [Churchill Park](landmarks/churchill_park.md) and [Barnard Park](landmarks/barnard_park_pavilion.md) specced, outside the built area |
| 17 | Victoria Square, Mitchell Park, the Japanese Friendship Garden | Town centre | ✅ ([Victoria Square](landmarks/victoria_square_memorial.md), [Mitchell Park](landmarks/mitchell_park.md), [Japanese garden](landmarks/japanese_friendship_garden.md)) |
| 18 | Busselton Jetty Tourist Park (the old Kookaburra Caravan Park) | Marine Tce and Brown St | ✅ ([description](landmarks/kookaburra_caravan_park.md)) |
| 19 | St Mary's Anglican Church (1845, the oldest stone church in WA) and bell tower | Queen St and Peel Tce | ✅ ([description](landmarks/st_marys.md)) |
| 20 | Swimming jetty | Foreshore, west of the jetty base | ✅ built low by the generator (`swimJetties`; [notes](landmarks/swim_jetties.md)) |
| 21 | Saltwater (performing arts and convention centre, opened May 2026) | 9 Queen St | ✅ 2 Nov ([description](landmarks/saltwater.md)); from the aerial, no photo of the finished building yet |
| 22 | Old Agricultural Bank (ArtGeo) | 7 Queen St, at the Marine Tce roundabout | ✅ 2 Nov ([description](landmarks/artgeo.md)) |
| 23 | Weld Theatre | 13 Queen St | ✅ 2 Nov ([description](landmarks/weld_theatre.md)) |
| 24 | The Fire Station (bar) | Queen St | ✅ 2 Nov ([description](landmarks/fire_station_bar.md)) |
| 25 | Surf Life Saving Club and youth building (two specs) | Foreshore, east of the jetty base | ✅ 2 Nov ([description](landmarks/surf_club.md)); the angled blades squared off |
| 26 | Busselton Central: Kent St and Prince St entries, Reading Cinemas, Busselton Pavilion (four specs) | Kent St and Prince St | ✅ 2 Nov ([description](landmarks/busselton_central.md)); entries partly guessed |
| 27 | Roadside pylon signs: McDonald's, Hungry Jack's, Paradise Motor Inn, Busselton Motel | Albert St and Bussell Hwy | ✅ 2 Nov, lettered both sides ([description](landmarks/roadside_pylons.md)) |
| 28 | Signal Park toilets (market stalls as an optional spec, off) | Foreshore, west of Queen St | ✅ 2 Nov ([description](landmarks/signal_park.md)) |
| 29 | Settlement Art Project bronzes | Round the courthouse precinct | ✅ 2 Nov, Blender layer ([description](landmarks/settlement_art.md)); 3 of 6 positions are guesses |
| 30 | Shelter Brewing Co | Foreshore Pde, behind the Visitor Centre | ✅ 2 Nov, Blender layer ([description](landmarks/shelter_brewing.md)) |
| 31 | Origins Market | South of the built area | ⬜ only if the map grows south |

Where they came from and what's next: [docs/plans/tourism-places.md](plans/tourism-places.md).

## Margaret River (main street)

9 spec landmarks (`routes/landmarks/margaret_river_looks.json`) and one Blender layer. Audit: [docs/plans/margaret-river-places.md](plans/margaret-river-places.md).

| Landmark | Where | Status |
| --- | --- | --- |
| Margaret River Hotel | 125 Bussell Hwy, Willmott Ave corner | ✅ ([description](landmarks/margaret_river_hotel.md)) |
| Margaret River Visitor Centre | 100 Bussell Hwy, Tunbridge St corner | ✅ ([description](landmarks/margaret_river_visitor_centre.md)) |
| Settlers Tavern | 114 Bussell Hwy | ✅ ([description](landmarks/settlers_tavern.md)) |
| International Trading Company store (REDSEA Gallery) | 83 Bussell Hwy | ✅ ([description](landmarks/itc_store.md)) |
| Rotary Park (Old Kate, the footbridge, the gate) | Bussell Hwy, north of the bridge | ✅ Blender layer ([description](landmarks/margaret_river_rotary_park.md)) |
| The Good Olive building and Dome | Bussell Hwy | ✅ 2 Nov ([description](landmarks/margaret_river_good_olive.md)) |
| Fearn Avenue town square | Bussell Hwy, opposite Willmott Ave | ✅ 2 Nov ([description](landmarks/margaret_river_town_square.md)) |
| Bridgefield (La Scarpetta) | Bussell Hwy | ✅ 2 Nov ([description](landmarks/margaret_river_bridgefield.md)) |
| NAB building (former Goldsbrough Mort) | Bussell Hwy | ✅ 2 Nov ([description](landmarks/margaret_river_nab.md)) |
| The Tuckshop, ANZ and Morries, Arc of Iris | Bussell Hwy | ✅ 2 Nov ([description](landmarks/margaret_river_morries.md)) |

## The capes and Yallingup

| Landmark | Track | Status |
| --- | --- | --- |
| Cape Naturaliste lighthouse | Cape Naturaliste Road | ✅ Blender layer ([description](landmarks/cape_naturaliste_lighthouse.md)); its old spec kept for reference only |
| Cape Naturaliste keepers' cottages | Cape Naturaliste Road | ✅ ([description](landmarks/cape_naturaliste_cottages.md)) |
| Cape Leeuwin lighthouse | Cape Leeuwin | ✅ Blender layer ([description](landmarks/cape_leeuwin_lighthouse.md)) |
| Cape Leeuwin keepers' cottages and waterwheel | Cape Leeuwin | ✅ ([cottages](landmarks/cape_leeuwin_cottages.md), [waterwheel](landmarks/cape_leeuwin_waterwheel.md)) |
| Caves House Hotel and the Yallingup General Store | Caves Road, Dunsborough to Yallingup | ✅ ([Caves House](landmarks/caves_house.md), [store](landmarks/yallingup_store.md)) |
| CaveWorks and the Lake Cave visitor centre (two specs) | Caves Road Boranup | ✅ 7 Nov ([description](landmarks/lake_cave_caveworks.md)); on a landmark patch, needs a base build |

## Dunsborough (Busselton to Dunsborough)

The drive stays on Caves Road, south of the town centre, so only the edge of town is in its 70 m corridor (`routes/landmarks/busselton_to_dunsborough_looks.json`).

| Landmark | Where | Status |
| --- | --- | --- |
| Dunsborough Tavern | 2 Dunsborough Place, by the Dunn Bay Road roundabout | ✅ ([description](landmarks/dunsborough_tavern.md)); mostly past the corridor, on the terrain's height |
| Dunsborough Bakery | Dunn Bay Road, about 220 m north of the drive | ⬜ outside the built area |
| Dunsborough Centrepoint (Coles) | 55-57 Dunn Bay Road, 110 to 230 m north of the drive | ⬜ outside the built area |

## The whole map (private)

Listed in `routes/private/landmarks/README.md`.

## The South West, still to do

Ngilgi Cave's entrance, Sugarloaf Rock, Meelup, the surf car parks at Yallingup and Surfers Point, wineries and cellar doors along Caves Road, Augusta's town centre.

Checked 7 Nov and left out, because no track's drive can see them:

- **Ngilgi Cave visitor building** (115.03443,-33.64228): 440 m north of Caves Road at Yallingup, through solid bush. It needs a track up Yallingup Caves Road.
- **Bootleg Brewery**, Wilyabrup (115.05511,-33.75678): 2.3 km east of Caves Road.
- **Leeuwin Estate** (115.06699,-34.01407): 6 km from the nearest track (Margaret River's south end, and the Boranup track's north end).
