# Landmarks

The buildings and places locals would point at, each built from its own spec (`routes/landmarks/`, `src/core/specHouse.ts`) instead of a generated house. Each one gets a description first (`docs/landmarks/<slug>.md`), from the Landgate aerial and reference photos. The photos are only for reading shapes, sizes and colours; they never go into the track. Reference photos live in `out/refs/<slug>/`, which is not committed. Names on signs are plain lettering, with no logos.

Places near home are private: their descriptions and specs go in `routes/private/landmarks/` and appear in the private whole map only.

Status: ✅ built · 📝 described · 📷 gathering photos · ⬜ to do

## The public map (Foreshore and town centre)

| # | Landmark | Where | Status |
| --- | --- | --- | --- |
| 1 | Busselton Jetty, Interpretive Centre boatsheds, Underwater Observatory, jetty train | Foreshore | ✅ (`src/core/jetty.ts`) |
| 2 | Rocky Ridge Brewing Co | 10 Marine Tce | ✅ (`routes/landmarks/rocky_ridge.json`) |
| 3 | Esplanade Hotel | 30-38 Marine Tce | ✅ ([description](landmarks/esplanade_hotel.md)) |
| 4 | The Goose | Foreshore, by the jetty | ✅ ([description](landmarks/the_goose.md)) |
| 5 | Old Courthouse group and the Old Post Office Cafe | Queen St | ✅ ([description](landmarks/old_courthouse.md)) |
| 6 | Hilton Garden Inn | Foreshore Pde and Jetty Way | ✅ ([description](landmarks/hilton_garden_inn.md)) |
| 7 | Busselton Visitor Centre (Railway House) | Foreshore Pde | ✅ ([description](landmarks/visitor_centre.md)) |
| 8 | Busselton Museum (the old Butter Factory) | Peel Tce, by the Vasse River | ✅ ([description](landmarks/busselton_museum.md)) |
| 9 | Sea Play on the Bay playground, the Barrel and Transition sculptures | Foreshore | ✅ ([description](landmarks/sea_play.md)) |
| 10 | Foreshore cafes: Kyst, Sandbox | Foreshore | ✅ ([description](landmarks/foreshore_cafes.md)) |
| 11 | Geographe Bay Yacht Club | Geographe Bay Rd | ✅ ([description](landmarks/yacht_club.md)) |
| 12 | Orana Cinemas | Albert St | ✅ ([description](landmarks/orana_cinemas.md)) |
| 13 | The Tav, the Ship Inn, the Banksia Tavern | Town centre | ✅ ([descriptions](landmarks/the_tav.md), [Ship Inn](landmarks/ship_inn.md), [Banksia](landmarks/banksia_tavern.md)) |
| 14 | Busselton Pioneer Cemetery | Marine Tce | ✅ ([description](landmarks/pioneer_cemetery.md)) |
| 15 | Busselton Volunteer Fire and Rescue station | Town centre | ✅ ([description](landmarks/fire_station.md)) |
| 16 | Busselton Bowling Club, Churchill Park, Barnard Park | East of the jetty | ✅ bowling club; Churchill and Barnard specced, outside the built area |
| 17 | Victoria Square, Mitchell Park, the Japanese Friendship Garden | Town centre | ✅ |
| 18 | Kookaburra Caravan Park | Marine Tce | ⬜ |
| 19 | St Mary's Anglican Church (1845, the oldest stone church in WA) and bell tower | Queen St and Peel Tce | ✅ ([description](landmarks/st_marys.md)) |

## The whole map (private)

Listed in `routes/private/landmarks/README.md`.

## The South West (later, with those tracks)

Cape Naturaliste and Cape Leeuwin lighthouses, Ngilgi Cave's entrance, Sugarloaf Rock, Meelup, the surf car parks at Yallingup and Surfers Point, wineries and cellar doors along Caves Road, Margaret River's main street, Augusta.
