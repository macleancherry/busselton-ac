# Augusta main street: what we have, what to add

ROADMAP Phase D, the capes. This audit covers Augusta's main street on the Cape Leeuwin route, like `docs/plans/margaret-river-places.md`.

Scope: `routes/cape-leeuwin.json` through town, with no `build.area` in Augusta (the only area is the landmark patch at the lighthouse). What counts is what you'd recognise from the road.

## The catch: the route starts at the south end of the shops

The route's first centreline point is on Blackwood Avenue at 115.16023, -34.31691, beside the Augusta Hotel. From there it heads south out of town. Nothing is built north of the start: no road, only terrain and a few paths. So:

- **On the route:** the hotel, its bottle shop and its motel wing (east side, the first 60 m), and the retirement units opposite.
- **Behind the start, in the 70 m corridor but with no road:** the Deckchair Cafe and IGA centre (west side, 35 to 65 m back) and the small shops east of the road (Cacao, the Art and Craft Co-op, Bottlemart, the real estate office at number 71).
- **Outside:** the rest of the shops, on Bussell Highway north of the Blackwood Avenue junction (115.15977, -34.31592): the pharmacy, butcher, BP, Hungry Pelican, Two Oceans fish and chips, Thousand Suns Cafe and the Lions Bookshop, 100 to 240 m north. Further on are the **Augusta Historical Museum** (115.15906, -34.31400, 330 m north) and the **Augusta Bakery and Cafe** (115.15825, -34.31235, 520 m north).
- **River front:** the Blackwood River and Hardy Inlet foreshore (Ellis St, Turner Holiday Park) is 200 to 300 m east, behind the hotel paddock. You can't see it from the route. The water ahead as you drive south is Flinders Bay.

## How this was checked

- OSM: every named feature and building in the town box (Overpass, 2 Nov 2026), and Nominatim for the museum, bakery and hotel.
- The Landgate aerial (Oct 2026).
- The 2019 Mapillary dashcam runs along Blackwood Avenue and Bussell Highway (reference only).
- The current build's meshes (`out/cape_leeuwin.surface.json`) for ground heights and what the base already builds.

**Recommendation key:** as in the Margaret River audit (Spec, Generic, Skip).

## The list

| Name | Where | Have now | Recommendation | Why |
| --- | --- | --- | --- | --- |
| **1. Augusta Hotel (reception, restaurant, glazed dining gable)** | East side, at the start | Generic: one 76 x 102 m block for the whole complex | **Spec** (done: `augusta_hotel`) | The town's landmark. It fills the left of the view on the grid. |
| **2. Hotel drive-in bottle shop and bars** | East side, 7 to 40 m behind the start | Same block | **Spec** (done: `augusta_hotel_bottleshop`) | It's in the mirrors and the grid view, and has a clear sign. |
| **3. Hotel motel wing** | East side, first 25 to 55 m | Same block | **Spec** (done: `augusta_hotel_motel`) | A long two-storey tiled block: the first thing you pass. |
| 4. Deckchair Cafe and IGA (Augusta Centre) | West side, 35 to 65 m behind the start | Generic (one 52 x 75 m OSM retail footprint) | **Generic for now; spec after the route change** | Its grey sawtooth gables are distinctive. Without the street built north of the start, though, the build's ground there is a hump 3 to 4 m above the road (30 m fallback heights), so a spec would sit on a bank. |
| 5. East-side shops north of the hotel (Cacao, Art and Craft Co-op, Crafters Croft, real estate) | 50 to 110 m behind the start | Generic or missing | Generic, with names, after the route change | Small verandah shops. |
| 6. Bussell Hwy shops (pharmacy, butcher, BP, Hungry Pelican, Thousand Suns) | 100 to 240 m north | Outside | Generic, with names, after the route change | The heart of the shops. |
| 7. Augusta Historical Museum | Bussell Hwy, 330 m north | Outside | Spec after the route change | Recognisable, and in the guides. |
| 8. Augusta Bakery and Cafe | Bussell Hwy, 520 m north | Outside | Spec after the route change | The town's best-known stop. |
| 9. River front (foreshore, Ellis St jetty) | 200 to 300 m east | Outside, not visible | Skip | You can't see it from Blackwood Avenue. |
| 10. Retirement units opposite the motel | West side | Generic | Generic | Fine as is. |

## Proposed change (not made)

Start the route further north, so the drive runs the whole main street. Add a first pin on Bussell Highway mid-block north of the bakery, about **115.15762, -34.31151** (between OSM nodes 115.157502, -34.311274 and 115.157729, -34.311751 on way 1556045112). That adds about 650 m. The museum (about 20 m east of the road line) and the bakery (about 25 m west) are then in the corridor, and so is everything in rows 4 to 8, on a built street at road level. The current first pin can stay. A `build.area` over the main street instead would only give scenery seen from the grid, with no road to drive past it.

## Found on the way

- **A stray building in the road.** The base builds a "frontage" filler house (fibro_white, about 22 x 7 m) on Blackwood Avenue itself, at 115.16004, -34.31655, about 40 m behind the start. It's there because the street isn't built north of the start, so nothing keeps fillers off the road reserve. The route change would also fix this.
