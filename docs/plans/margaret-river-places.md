# Margaret River main street: what we have, what to add

ROADMAP Phase D: Margaret River's main street gets the showcase treatment. This is the audit behind it, like `docs/plans/tourism-places.md` for Busselton.

Scope: `routes/margaret-river.json`, Bussell Hwy from north of the river bridge, south through the shops past the Wallcliffe Rd roundabout, plus the town-centre `build.area`. What counts is what a visitor would recognise from the road.

## How this was checked

- **What's there:**
  - OSM: every named feature and building in the town box (Overpass, 2 Nov 2026)
  - the Margaret River and Districts Historical Society's Main Street Historic Walk (67 sites)
  - inHerit, the Margaret River Busselton Tourism listings and food guides (Broadsheet, Time Out)
  - the Landgate aerial (Oct 2026)
  - the 2019 Mapillary dashcam run south down the main street, and a 2017 run north (reference only)
- **What we have:** `routes/landmarks/margaret_river_looks.json` (four specs) and `routes/layers/margaret_river/` (Rotary Park).
- **Which side is which:** driving south, the west side (on the right) has the Visitor Centre, the IGA, Settlers Tavern, Target, RiverSmith, the town square, Coles and the NAB. The east side (on the left) has the Reddy Express servo, Bridgefield, the REDSEA gallery, the bakery, The Good Olive and Dome, the hotel, then ANZ and Morries.
- **Off the main street:** Memorial Park, the post office, Woolworths and the police station face the back street east of the shops, about 100 m from Bussell Hwy. You can't see them from the route.

**Recommendation key:**
- **High detail:** a Blender layer.
- **Spec:** a spec landmark (`src/core/specHouse.ts`).
- **Generic:** a generic building is fine, ideally with its real name on the sign.
- **Skip:** not visible, closed, or too minor.

## The list

| Name | Where | Have now | Recommendation | Why |
| --- | --- | --- | --- | --- |
| Rotary Park, Old Kate, the footbridge and the gate | East side, north of the bridge | ✅ layer | Done | |
| Margaret River Visitor Centre | West side, Tunbridge St corner | ✅ spec | Done | |
| Settlers Tavern | West side | ✅ spec | Done | |
| Margaret River Hotel | East side, Willmott Ave corner | ✅ spec | Done | The Heytesbury redevelopment is still going on behind it. Recheck the aerial before polishing. |
| REDSEA Gallery (old International Trading Company store) | East side | ✅ spec | Done | |
| **1. The Good Olive building and Dome** | East side, opposite the Visitor Centre | Generic (one 30 x 72 m OSM footprint) | **Spec** (done: `margaret_river_good_olive`) | The two-storey white verandah building and the sand-rendered Dome fill the view as you reach the shops. |
| **2. Fearn Ave town square** | West side, opposite Willmott Ave | Missing. OSM has it as a pedestrian way, so the base shows a plain strip. | **Spec** (done: `margaret_river_town_square`) | The centrepiece of the 2020-22 Main Street Makeover (an AILA 2023 award). It's the obvious gap on the route. |
| **3. Bridgefield (La Scarpetta)** | East side, at the north entrance | Missing (no OSM building) | **Spec** (done: `margaret_river_bridgefield`) | A 1929-30 brick house with an octagonal corner pavilion behind a lawn and picket fence. It's the first heritage building you pass coming into town. |
| **4. NAB building (old Goldsbrough Mort, 1952)** | West side, south of the hotel | Generic | **Spec** (done: `margaret_river_nab`) | The only two-storey red-roofed building in the south half of the shops. |
| **5. The Tuckshop, ANZ and Morries, Arc of Iris** | East side, south end of the shops | Generic (one 59 m OSM footprint) | **Spec** (done: `margaret_river_morries`) | Morries is in every guide. The dark gabled ANZ front and the green-roofed Arc of Iris mark the south end of the shops. |
| 6. Margaret River Bakery (1927-28 bakehouse) and the gallery row | East side, number 89 | Generic | **Generic, with names** (spec later) | Heritage, but set back up the bank behind a car park and trees, so you only glimpse it from the road. |
| 7. Margaret River Brewhouse | North of the bridge, 35 Bussell Hwy | Nothing (outside `build.area`) | **Generic, plus a roadside sign** | The only brewery in town, but it's about 70 m off the road among karri trees, outside the area and the 60 m corridor. From the road you see a white cottage and a sign board at the car park entrance. Do a small sign spec if the area grows north. |
| 8. RiverSmith (1955 Wise garage) | West side, north corner of the town square | Generic | **Generic, with name** | It was renovated and extended past recognition as a garage. A name sign is enough. |
| St Thomas More Catholic Church (1983, rammed earth) | 20 Wallcliffe Rd, about 320 m west of the main street | Generic | **Skip** for this route | Striking (rammed-earth piers and arches by Chris Wilcox), but you can't see it from Bussell Hwy. It's on the area's west edge. It would be a good spec for a later Wallcliffe Rd layout. |
| Reddy Express servo (was Shell) | East side, at the north entrance | Generic | **Generic**, pylon later | A canopy and a pylon. The 2017-19 photos show Shell; it's Reddy Express now. |
| Old Settlement, Historical Society museum, The Hairy Marron | South bank, east of the bridge | Generic | **Skip** | It's behind bush and under trees. You can only see it from the paths. |
| Memorial Park, post office, Woolworths, police | Back street, east | Generic | **Skip** | Not on the main street. |
| Settlers Arcade, IGA, Target, Coles, Lloyds, Fudge Factory, Normal Van, Miki's Open Kitchen, Wild Thyme, Toastface Grillah, Drift, El Toro | Main street | Generic, 31 shop names in the last build | **Generic, with names** | Ordinary shopfronts. The name pass handles them. Miki's and Normal Van are in the guides, so check that they make it onto signs. |
| The three Main Street Makeover roundabouts | Bussell Hwy | Built by the base | **Generic** | The Wallcliffe Rd roundabout has a red brick apron and a low planted bed (aerial). There's nothing tall to model. |
| Margaret River Chocolate Company, Fishbone | Not in town | | **Skip** | The chocolate factory is at Metricup. Fishbone is a winery at Wilyabrup. |

## Not represented, and why

- **Round and curved shapes:** Bridgefield's octagonal pavilion and its lantern are drawn square, the Dome's arched windows are rectangles, and the barrel roof behind the Dome is flat. Specs only do rectangles.
- **Wraparound balconies:** The Good Olive building's balcony runs round the north side too. The spec only does the street side.
- **The town square's sculptural seats and rain garden:** these are drawn as low timber fences and a dark planted bed.

## Sources

- MRDHS, Main Street Historic Walk index: https://mrdhs.com.au/qr/ (sites 2, 8, 12-13, 34-36, 44, 50)
- inHerit, St Thomas More Church: https://inherit.dplh.wa.gov.au/Public/Inventory/Details/08bb9f69-e228-4426-bf20-79db6a191384
- St Thomas More Catholic Church listing: https://www.margaretriver.com/members/st-thomas-more-catholic-church/
- Hassell, Reinventing Margaret River: https://www.hassellstudio.com/news-event/reinventing-margaret-river-small-in-stature-big-on-vitality
- South West Development Commission, World-class precinct delivered: https://swdc.wa.gov.au/world-class-precinct-delivered-for-south-west-tourist-town/
- Shire of Augusta Margaret River, Main Street Makeover: https://yoursay.amrshire.wa.gov.au/margaret-river-main-street-development
- Margaret River Brewhouse listing: https://www.margaretriver.com/?p=1849832
- Night-time dining, Margaret River region: https://www.margaretriver.com/things-to-do/eat-drink/restaurants-cafes/night-time-dining-margaret-river-region/
- Broadsheet, best restaurants in Margaret River: https://www.broadsheet.com.au/perth/guides/best-restaurants-margaret-river
- Time Out, Pizzica: https://www.timeout.com/perth/restaurants/pizzica
- Fishbone Wines: https://winecompanion.com.au/wineries/western-australia/margaret-river/fishbone-wines
- OpenStreetMap (ODbL); Landgate Locate aerial; Mapillary (CC BY-SA, reference only)
