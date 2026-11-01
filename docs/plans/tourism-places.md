# Tourist and hospitality places in the Busselton map: what we have, what to add

Mac, 1 Nov: "research all tourists and hospitality places and whether we have them along with a recommendation on whether to include or not."

Scope: the Busselton built area (`routes/busselton.json` `build.area`: the town box, the jetty precinct and foreshore, the yacht club), plus places just outside it that a visitor would expect to see from those streets.

## How this was checked

- **What's there:**
  - OSM: Overpass for tourism, hospitality, leisure, historic and brewery tags plus every named feature in the box, and OpenFreeMap's z14 tiles (the POIs our build actually reads)
  - the City of Busselton and Margaret River Busselton Tourism sites and their Discover Busselton map
  - food guides and news, for anything new, moved or closed
- **What we have:**
  - `routes/landmarks/looks.json` (22 spec landmarks), `routes/layers/` (Transition, Sea Play, Rocky Ridge's pergola), `src/core/jetty.ts`, `docs/landmarks.md`, ROADMAP Phase B
  - for everything else: whether OSM has a footprint (which the base builds as a generic building) and whether the name made it onto a shop sign
- **Signs in the accepted base:** the sign atlas in `out/accepted/busselton.zip` carries 13 real names: Woolworths, Red Rooster, Westpac, KFC, baked., ANZ, Emerald, Two Groupers Busselton, The Good Egg, Dan Murphy's, Great Wall, Dymocks and Busselton Thai. There are only 26 shopfronts in the whole map (`shops`/`shopNames` in the stats). Everything else on Queen St is a plain generic building.
- **Why so few names:** two reasons.
  - OpenFreeMap's z14 POI layer drops low-ranked POIs, so places OSM has never reach the build (Pan & Grill, Mano Wraps, Hummingbird, Little Peach and others).
  - A name only goes on a front with a verandah within 9 m of a street. Pads set back in car parks, like McDonald's and Hungry Jack's, never qualify.

**Which layouts pass what:**
- **Foreshore:** Bussell Hwy, Geographe Bay Rd past the yacht club, Marine Tce, then down Queen St and back along Albert St and Bussell Hwy.
- **Town:** Queen St, Kent and Prince St, Peel Tce, Brown St and Marine Tce.
- **Sights:** Marine Tce, the Queen St roundabout, Stanley St and Adelaide St.
- **No race layout uses Foreshore Pde.** The jetty precinct is seen across the car parks from Marine Tce, and up close only in free roam.

**Recommendation key:**
- **High detail:** a Blender layer, for something iconic that's seen up close.
- **Spec:** a spec landmark, for a recognisable shape and signage.
- **Generic:** a generic building is fine, ideally with its real name on the sign.
- **Skip:** not visible, closed, or too minor.

## Jetty precinct and foreshore

| Name | Type | Where | Have now | Recommendation | Why |
| --- | --- | --- | --- | --- | --- |
| Busselton Jetty, jetty train, Interpretive Centre boatsheds, Underwater Observatory | Attraction | Foreshore, out to 1.8 km | ✅ `jetty.ts`, `jettyTrain.ts` | Done | The icon. The observatory is at the far end, outside the area but part of the jetty build. A bigger "Australian Underwater Discovery Centre" was planned to replace it (2021 design). Its status is unverified, so don't model it until it exists. |
| **Shelter Brewing Co** | Brewery, restaurant | 11 Foreshore Pde, 115.34516,-33.64523 (OSM way 749124330, about 42 × 40 m) | Generic box from the OSM footprint (1,306 m²) | **High detail** (already on the roadmap) | Confirmed and placed. It's the large dark sawtooth barn about 100 m south-west of The Goose, directly behind Railway House, on the corner of Foreshore Pde and the jetty car park. One of the two top venues in every food guide. The aerial shows a charcoal sawtooth roof over three bays, with a beer garden on the west and north. |
| The Goose | Restaurant, bar | 15 Foreshore Pde | ✅ spec | Done | |
| Kyst and Sandbox (the old Equinox) | Restaurant, cafe | 1 Foreshore Pde | ✅ spec | Done | The Discover Busselton map (Jan 2024) still says "The Equinox". It's the same building, now Kyst and Sandbox. |
| Busselton Visitor Centre (Railway House), Ballaarat engine shed | Visitor services, heritage | Foreshore Pde | ✅ spec | Done | The Ballaarat steam engine is shown inside the shed, so it isn't visible from the street. |
| Hilton Garden Inn | Hotel | 4 Jetty Way | ✅ spec | Done | |
| Sea Play on the Bay, Transition sculpture | Playground, artwork | Foreshore lawn | ✅ layers | Done | |
| Barrel (artwork) | Artwork | OSM node 2771171275 | Not built | **Skip** | Not found on the ground (sea_play.md). Probably removed in the 2017-18 redevelopment. Drop it from ROADMAP's to-do list. |
| **Busselton Surf Life Saving Club and Youth and Community Activities Building, with the skate park** | Club, youth precinct | East of the jetty base, 115.3465,-33.6445 | Generic box (one 1,351 m² OSM footprint). The skate park is ground only. | **Spec** | The big white building with solar roofs east of the jetty, about 50 m from Marine Tce car parks. It's the second-largest building on the foreshore after the Hilton, and anyone at the beach knows it. The skate bowls could be a later layer. |
| Signal Park (markets, water play, toilets) | Park, market | Foreshore green by the playground | Ground and trees (not named in OSM) | **Generic**, small spec later | The Busselton Foreshore Markets and Rotary Markets run here on alternate Sunday mornings. There's little that stands up apart from a toilet block and shade. Worth a market-day stall layer only if Mac wants a "Sunday" look. |
| Foreshore amphitheatre | Event space | Foreshore | Ground | **Skip** for now | Low terraced lawn that reads fine as ground. |
| Swim jetties and stinger net | Beach | West of the jetty | `swimJetty.ts` | Done | |
| Busselton foreshore beach | Beach | Whole frontage | Coast and sand from the aerial | Done (ROADMAP Phase E "beach and water") | |
| Alchemy Saunas | Wellness | Unclear | None | **Skip** | On the 2024 Discover map, but no Busselton site could be confirmed. |
| Underwater Sculpture Park, Mermaid's Cave | Underwater attraction | Off the jetty | None | **Skip** | Underwater, so not visible from any street. |

## Cultural precinct and Marine Tce

| Name | Type | Where | Have now | Recommendation | Why |
| --- | --- | --- | --- | --- | --- |
| **Saltwater (Busselton Performing Arts and Convention Centre), with the Weld Theatre** | Theatre, gallery, convention centre | 9 Queen St, on the Queen St / Marine Tce roundabout, opposite the Old Courthouse | Only the old Weld Theatre's OSM footprint (about 560 m²) as a generic box. The new building isn't in OSM, so it's probably missing from the base: check in the build. | **Spec** (top 3) | Opened 9 May 2026. Three levels: a 640-seat theatre, a ground-floor gallery and a level 2 conference suite with a balcony over the bay. The aerial shows a pale block about 50 × 50 m behind the heritage gabled hall on the corner. Both the Foreshore and Sights layouts drive round this roundabout, so it's the biggest gap in the map. A spec suits its big plain masses; it could step up to a layer later for the glazing. |
| Old Courthouse group, Old Post Office Cafe / Lockup Coffee House, Busselton Art Society | Heritage, cafe | Queen St | ✅ spec | Done | |
| Busselton Settlement Art Project (life-size bronzes) | Public art | Cultural precinct and Queen St | None | **High detail, later** | Recognisable and right on the Sights route, but they're human figures, which a spec can't do. A small Blender layer of 4 to 6 statues is the most it needs. |
| Rocky Ridge Brewing Co (Taphouse) | Bar | 10 Marine Tce | ✅ spec and pergola layer | Done | |
| Esplanade Hotel and Thirsty Camel | Pub, hotel, bottle shop | Marine Tce and Adelaide St | ✅ spec for the hotel. The bottle shop is a generic box. | Done | |
| Busselton Pioneer Cemetery | Heritage | Marine Tce | ✅ spec | Done | |
| Busselton Jetty Tourist Park (the old Kookaburra Caravan Park) | Caravan park | Marine Tce and Brown St | ✅ spec | Done | ROADMAP still lists "the Kookaburra Caravan Park" as to do, which is stale. The City has sought a long-term lease and redevelopment (2025), so the park may change: keep its spec light. |
| Observatory Guesthouse | B&B | 7 Brown St | Generic house | **Generic** | A small house on a quiet street. |
| DPaW office, Bovell's Cottage, Lady Campion Hostel | Offices, heritage house, aged care | Around Queen St and Marine Tce | Generic | **Skip** | Not tourist places. |

## Queen St and the town centre

| Name | Type | Where | Have now | Recommendation | Why |
| --- | --- | --- | --- | --- | --- |
| **The Fire Station** (small bar, in the old fire station) | Bar | 68 Queen St | Generic box (114 m² OSM footprint), no sign | **Spec** | A heritage building used as a bar, on the Foreshore and Town routes. Small, so it's cheap to do. Not the DFES station, which is already a spec. |
| **Busselton Central** (Coles, Reading Cinemas, Timezone, Busselton Pavilion megapub, Inara, Benesse) | Shopping centre, cinema, gastropub | Kent St to Prince St, west of Queen St | Generic box (one 15,000 m² footprint), no signs | **Spec, street faces only** | Recently redeveloped. The Town loop passes it, and the Pavilion is now one of the town's main venues. Model the Kent St and Prince St entries with plain-lettered signs (Reading Cinemas, Busselton Pavilion). The roof can stay generic. |
| Orana Cinemas | Cinema | 27 Albert St | ✅ spec | Done | |
| The Tav (Vasse Tavern), The Banksia Tavern, The Ship Inn (and Nightcap at The Ship Inn) | Pubs, motel | Town centre | ✅ specs | Done | The Nightcap motel rooms behind the Ship Inn are generic, which is fine. |
| Woolworths, Westpac, ANZ, baked., Emerald, Two Groupers, Great Wall, Busselton Thai, The Good Egg, Dymocks | Shops, eateries | Queen St and Prince St | ✅ generic with name sign | Done | |
| Bistro Breton, Zen, Pan & Grill, Coco's Thai, Mano Wraps, Mr Kebab, Hummingbird, Little Peach, Kent Street Bakery, Muffin Break, Everyday Gourmet, Figtree Lane | Cafes, restaurants | Queen St, Kent St, Figtree Lane | Generic, no names | **Generic, with names** | They're in OSM but dropped by the tile POI rank filter. A name pass (top 10, item 5) would put them on their fronts. |
| Alberta's, Burger Bones (55 Queen St), Albies (117 Queen St), Poppy & Pip, Millies, Sugar Chef, Chapel Café, Cod Rocks | Cafes, restaurants | Queen St and nearby | Generic, not in OSM | **Generic, with names** | Alberta's and Burger Bones are named in every 2025-26 guide. Add them by hand in the name pass. The rest are unverified, so add a name only when a 2026 listing confirms it. |
| Pizza Hut, Jade Cafe, Thai Lemongrass, Domino's | Takeaways | Albert St, Prince St | Generic, no names | **Generic** | Name them if the name pass reaches them. |
| Paradise Motor Inn | Motel | Albert St, by Victoria Square | Generic | **Generic, with a roadside motel sign** | On the Foreshore route. A pylon sign is the only thing that makes a motel read as a motel. |
| Victoria Square and memorial, Mitchell Park, Japanese Friendship Garden, St Mary's | Parks, heritage | Town centre | ✅ specs | Done | |
| Rotary Park and playground | Park | Peel Tce by the river | Ground, trees and a generic playground | **Generic** | |
| Busselton Museum (Old Butter Factory) | Museum | Peel Tce | ✅ spec | Done | |
| City of Busselton offices | Civic | 2 Southern Dr | Generic | **Skip** | Not a visitor place. |

## Bussell Hwy west and the yacht club

| Name | Type | Where | Have now | Recommendation | Why |
| --- | --- | --- | --- | --- | --- |
| Geographe Bay Yacht Club | Club, function venue | Geographe Bay Rd | ✅ spec | Done | |
| Busselton Motel | Motel | 25-31 Bussell Hwy | Generic | **Generic, with a roadside motel sign** | On the Foreshore route. |
| Gale Street Motel and Villas | Motel | 40 Gale St | Generic | **Generic** | Side street. |
| Rise & Co | Restaurant | 51 Bussell Hwy | Generic (charcoal skillion), no name | **Generic, with name** | On the Foreshore route. A bold modern building, so its name on the fascia is enough. |
| Al Forno, The Urban Coffee House, Subway | Restaurant, cafe | 19 Bussell Hwy | Generic, no names | **Generic, with names** | |
| Red Rooster, KFC, Dan Murphy's | Fast food, bottle shop | Bussell Hwy, Albert St | ✅ generic with name sign | Done | |
| McDonald's, Hungry Jack's | Fast food | Albert St | Generic pads, no names | **Generic**, with a pylon sign later | Too far back for the shopfront rule. A plain-lettered pylon by the road would place them. No logos. |
| Busselton Youth and Community Centre | Community | Bussell Hwy west | Generic | **Skip** | |
| Origins Market | Indoor market, food stalls | Bussell Hwy at the south edge (115.3388,-33.6560) | Generic box (3,300 m²), at the area's edge | **Generic** now; **Spec** if the area grows south | Award-winning and on the tourism sites, but it sits just past the town box, behind the highway. |
| Reading Cinemas | Cinema | Busselton Central (above) | | See Busselton Central | |

## Just outside the built area

| Name | Type | Where | Have now | Recommendation | Why |
| --- | --- | --- | --- | --- | --- |
| Churchill Park (trots, grandstand), Barnard Park pavilion | Sport, events | East of the town box | Specced, not placed (outside) | **Spec** when the map grows east | Already described and specced. |
| Busselton Tennis Club | Sport | Barnard Park East | None | **Skip** | |
| Ithaca hotel; Busselton Holiday Village; an unnamed caravan park (115.3534,-33.6452) | Accommodation | Marine Tce and the river, 300 to 1,000 m east | None | **Skip** | Can't be seen from the built streets. |
| Busselton Bird Hide (Vasse River) | Nature | South-east | None | **Skip** | Not visible from the built streets. |

## Top 10 to do next, in order

1. **Shelter Brewing Co: high detail layer.** At 115.34516,-33.64523, 11 Foreshore Pde, OSM way 749124330, about 42 × 40 m. Charcoal sawtooth roof, glazing, deck and beer garden, plain-lettered name. Already on the roadmap. It replaces the generic box from its OSM footprint, so the layer sidecar needs a `replaces` circle of about 30 m there.
2. **Saltwater and the Weld Theatre: spec.** At 9 Queen St, on the Queen St roundabout. It opened in May 2026, both the Foreshore and Sights layouts pass it, and the base most likely shows only the old hall. Check the build there first.
3. **Surf Life Saving Club and Youth and Community Activities Building: spec.** The big white solar-roofed building east of the jetty base. The skate park can come later.
4. **The Fire Station bar: spec.** The old fire station at 68 Queen St, on two layouts. Small and quick.
5. **Name pass for eateries: generic with names.** A code task.
   - Take shop names from Overpass, which the pipeline already queries, as well as the tile POIs, so OSM's lower-ranked cafes reach the signs.
   - Add a small hand list for places not in OSM (Alberta's, Burger Bones, Busselton Pavilion), as plain lettering.
   - The cheapest way to make Queen St read as Busselton.
6. **Busselton Central's street faces: spec.** Kent St and Prince St entries with Reading Cinemas and Busselton Pavilion signs. On the Town loop.
7. **Roadside pylon signs: generic.** A small spec part for Busselton Motel, Paradise Motor Inn, McDonald's and Hungry Jack's on the Foreshore route, all plain lettering.
8. **Settlement Art Project bronzes: small Blender layer.** 4 to 6 life-size figures around the cultural precinct, on the Sights route.
9. **Signal Park: small spec.** The toilet block and shade structures, plus an optional Sunday-market stall layer.
10. **Origins Market: spec,** once the area reaches south past Bussell Hwy. Until then, generic.

## Housekeeping for the roadmap (for the lead)

- Phase B "to do: the Kookaburra Caravan Park" is done: it's in looks.json as the Busselton Jetty Tourist Park.
- Phase B "the Barrel sculpture (not found on the ground)": recommend dropping it.
- docs/landmarks.md has nothing for Saltwater, Shelter or the surf club. They'd be rows 20 to 22 if Mac agrees.

## Sources

- OpenStreetMap via Overpass and OpenFreeMap tiles (fetched 1 Nov 2026), ODbL.
- Saltwater:
  - City of Busselton, [Saltwater fact sheet](https://busselton.wa.gov.au/Profiles/busselton/Assets/ClientData/Documents/Saltwater/Saltwater_Fact_Sheet_December_2024.pdf) (9 Queen St, 640 seats, gallery, conference suite)
  - [Saltwater Busselton set to open in May 2026](https://www.busselton.wa.gov.au/news/saltwater-busselton-set-to-open-in-may-2026/1008)
  - [Inside Local Government](https://insidelocalgovernment.com.au/surfs-up-for-city-of-busselton-saltwater-arts-centre/)
- ArtGeo: [Busselton Mail](https://www.busseltonmail.com.au/story/7592503/artgeo-in-busselton-closes-to-make-way-for-new-performing-arts-centre/), on ArtGeo closing for the performing arts centre.
- Margaret River Busselton Tourism:
  - [Discover Busselton map (Jan 2024)](https://www.margaretriver.com/wp-content/uploads/2024/04/20240117_Discover-Busselton-Map_MRBTA.pdf)
  - [Busselton town page](https://www.margaretriver.com/towns/busselton/)
  - [Busselton Central](https://www.margaretriver.com/things-to-do/attractions/busselton-central/)
  - [Signal Park](https://www.margaretriver.com/?p=1850762)
- Markets:
  - [Margaret River Find the Fun: Busselton Foreshore Markets](https://margaretriverfindthefun.com.au/listing/busselton-foreshore-markets) (Signal Park, 1st, 3rd and 5th Sundays)
  - City of Busselton, [Signal Park](https://busselton.wa.gov.au/connect/parks-facilities-and-venues/signal-park.aspx)
- Food guides:
  - [Perth is OK: best restaurants in Busselton](https://perthisok.com/eat-drink/best-restaurants-busselton)
  - [WA Good Food Guide: guide to Busselton](https://wagoodfoodguide.com/guide-to-busselton/)
  - [Broadsheet: Busselton Pavilion](https://www.broadsheet.com.au/margaret-river/busselton/restaurants/busselton-pavilion)
- Busselton Jetty Tourist Park, [long-term lease and redevelopment notice](https://busselton.wa.gov.au/publicnotices/long-term-lease-and-re-development-busselton-jetty-tourist-park/11112).
- Observatory: [The Urban Developer: Australian Underwater Discovery Centre design](https://www.theurbandeveloper.com/articles/busseltons-30m-underwater-discovery-centre-design).
- Observatory Guesthouse address, [Whitepages](https://www.whitepages.com.au/observatory-guest-house-10332108/busselton-wa-10332107B).
- Ballaarat engine, [Railway House and Ballaarat Steam Engine](https://www.westernaustralia.com/au/attraction/railway-house-and-ballaarat-steam-engine/5cfdb60a0b9584cc1df983e3).
- Settlement Art Project, [City of Busselton](https://www.busselton.wa.gov.au/discover/arts-culture-and-heritage/busselton-settlement-art-project.aspx).
- Landgate Locate aerial (references only), around 115.3441,-33.6476 and 115.3460,-33.6450.
