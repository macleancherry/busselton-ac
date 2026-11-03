# Busselton Settlement Art Project bronzes

ROADMAP Phase B tourism item 8. A hand-made detail layer, not a spec: a spec can't do figures. Layer: `routes/layers/settlement_art.kn5` and its sidecar, made by `scripts/blender/landmarks/settlement_art.py` (`scripts/blender/landmarks/build.sh settlement_art`). `routes/busselton.json` lists `routes/layers`, so the next Busselton build picks it up.

## What it is

Six life-size bronze figures by Greg James (Fremantle), commissioned by the City of Busselton for the Settlement Art Project. Each one tells a part of the town's settlement story. They stand round the Queen St cultural precinct, at the beach end of Queen St (numbers 4 to 9), between the Marine Tce and Adelaide St roundabouts:

| Figure | Unveiled | What it shows |
| --- | --- | --- |
| Whaler's Wife | 14 March 2014 | A pregnant woman with her right hand on her belly and books tied with twine in her left. Her hair blows back as she watches her husband's ship leave. A sea chest stands beside her. |
| Timber Worker | September 2015 | A man in a wide-brimmed hat, sleeves rolled up, chopping a felled log with an axe. |
| John Garrett Bussell | September 2016 | Long frock coat. He lifts his top hat to passers-by with his right hand and holds a book in his left. |
| Spanish Settler | 14 October 2017 | A man rolling a wooden wine barrel, for the Spanish families who farmed and made wine at Yoongarillup. |
| Gaywal | 2018-19 | A Wadandi Elder at the time of settlement, chosen by the local Aboriginal community. The sculptor's research shows in the mullet and the fishing gidgees. |
| Pioneer Woman | December 2019 | The women who farmed, raised children and traded goods when ships came in. |

None of the six includes an animal, apart from Gaywal's fish.

## Where each one stands

Positions come from what the sources say, checked against the specs already in the map (Old Courthouse, ArtGeo, Saltwater and the Weld Theatre) so that no plinth lands in a building, a tree or the road. No source gives coordinates, and OSM and Mapillary have none of them (Mapillary has only six 2021 frames of this block of Queen St).

| Figure | at [lng, lat] | Faces | Placed | How sure |
| --- | --- | --- | --- | --- |
| Whaler's Wife | 115.3436939, -33.6469034 | 345° (out to sea) | On the ArtGeo paving on Queen St, across from the courthouse (moved 2 m east on 3 Nov 2026, off the built street, between its kerb and ArtGeo's front) | Fairly: a 2014 visitor put it "on Queen Street, across from the Court House, in front of the [ArtGeo] building" |
| John Garrett Bussell | 115.3436076, -33.6472672 | 76° (to Queen St) | In the courthouse forecourt between the main group and the police cottages | Fairly: the City's photo shows him in front of the limestone wall with "OLD COURTHOUSE" lettering, which faces Queen St across that forecourt |
| Pioneer Woman | 115.3439529, -33.6476310 | 225° (to the corner) | Outside the south end of the Weld Theatre, on the Queen St / Adelaide St corner | Fairly: the Times said it would stand outside the Weld Theatre, and it was unveiled at that corner |
| Spanish Settler | 115.3437986, -33.6472941 | 257° (to Queen St) | On the Saltwater frontage, 2.5 m off the glass | Not very: it was unveiled in 2017 at 7-9 Queen St, between the Weld Theatre and ArtGeo. That frontage is now Saltwater (opened May 2026), so it may have moved |
| Timber Worker | 115.3438353, -33.6474334 | 257° (to Queen St) | On the Saltwater frontage, south of the Spanish Settler | Guess: the sources say only "the cultural precinct" |
| Gaywal | 115.3437641, -33.6468135 | 300° (to the roundabout and the bay) | On the lawn at the ArtGeo corner by the Marine Tce roundabout | Guess: the sources say "the cultural complex end of Queen Street", and a 2020 photo is tagged ArtGeo |

## How they're built

- **Figures:** low-poly bronze (`#5b4532`, smooth shaded) built from tapered tubes, lofted rings and small balls. Each is about 1.7 m tall in its own frame, then turned to its bearing. Props (sea chest, book, axe head, barrel hoops, fish) are a darker bronze, and handles, the barrel and the gidgees are timber-toned:
  - Whaler's Wife: long skirt, belly forward, hair blown back, the books in her left hand, a strapped sea chest at her right side
  - Timber Worker: feet apart behind a log lying across in front of him, bent forward with the axe raised over his right shoulder, a wide brim
  - Bussell: frock coat to the knee, a beard, his right arm up with the top hat held above his head, a book at his left hip
  - Spanish Settler: striding, bent low, both hands on a barrel lying on its side, a flat cap
  - Gaywal: standing with two gidgees upright in his right hand, a mullet hanging from his left, a cloak down his back from the left shoulder
  - Pioneer Woman: long dress, bonnet, a basket held in front on her left forearm
- **Plinths:** a low limestone block (`#d6cdb6`), 0.32 m above the ground and sunk 0.25 m below it, sized to each group (1.0 x 1.0 m for single figures, up to 2.3 x 1.25 m for the Timber Worker and his log). A `1WALL_settlement` box inside each one stops cars. The figures themselves are visual only.
- **Plaques:** a dark bronze plate on the front face of each plinth with the title in plain cream capitals (Blender's built-in font, no logos): THE WHALER'S WIFE, TIMBER WORKER, JOHN GARRETT BUSSELL, SPANISH SETTLER, GAYWAL, PIONEER WOMAN.
- **Heights:** each plinth sits on the lowest of its four corners on the base ground, or on the neighbouring spec's paving where that's higher (the courthouse forecourt, the ArtGeo paving), so nothing floats or sinks.
- **Budget:** 6,642 triangles in 6 meshes (one per material), against a limit of 15,000. That's about 930 to 1,240 per figure, plinth and plaque included.
- **Clears nothing:** `replaces` is empty. They're small additions on footpaths and forecourts.

## What a driver sees

Sights and Foreshore routes, round the Queen St / Marine Tce roundabout and down Queen St:

1. On the left after the roundabout, a bronze woman beside a chest in front of the red-roofed ArtGeo, looking out to sea, with a bronze Elder on the corner lawn.
2. On the right, in the courthouse forecourt, a man in a frock coat holding his top hat up.
3. On the left, along the glass front of Saltwater, a man bent over a barrel, then an axeman over a log.
4. At the Adelaide St roundabout, a woman with a basket outside the Weld Theatre.

## Can't represent

- The likenesses, faces, clothing folds and patina. These are stand-ins of the right size, pose and props, not portraits.
- **The real bases:** Greg James's street figures often stand at ground level, or on a low base or paving. The plinths and title plaques follow the brief, not photos.
- The real plaques' text (the story panels).
- Small props the sources don't mention.

## Unsure

- Four of the six positions (see the table). A walk down Queen St, or one photo per statue, would settle them: move the entry in `STATUES` and rerun `build.sh settlement_art`.
- **Pioneer Woman's pose:** no description found. The basket of farm goods is a guess from the City's description (trading farm goods when ships came in).
- **Gaywal's pose and dress:** only the fish and the gidgees are confirmed. The cloak is a guess.
- Whether the Spanish Settler and the Timber Worker were moved for Saltwater's construction (2023 to 2026).

## Sources

- City of Busselton, Busselton Settlement Art Project (dates, subjects; scale models in the Council Chambers): https://www.busselton.wa.gov.au/Community-Services/Cultural-Development/Busselton-Settlement-Art-Project
- Busselton Cultural Precinct, Settlement Sculpture Walk (all six, 4-9 Queen St): https://www.busseltonculturalprecinct.com.au/sculpture-walk
- Collections WA, Whaler's Wife (maquette description): https://collectionswa.net.au/items/feb1ea4f-a512-417c-81fe-5d628e3a22bb
- Public Art Around The World: Timber Worker, John Garrett Bussell, Whalers Wife and Spanish Settler pages, e.g. https://publicartaroundtheworld.com/public-art-in-australia/public-art-in-busselton/timber-worker-statue/
- Just a Little Further, "Bustle-less Busselton" (Whaler's Wife "in front of the GeoArt building", across from the courthouse): https://justalittlefurther.com/just-a-little-further/oceania/australia/buste-less-busselton
- Busselton Mail, "Busselton sculpture celebrates history" (2017 unveiling at 7-9 Queen St, between the Weld Theatre and ArtGeo): https://www.busseltonmail.com.au/story/4986583/celebration-of-busselton-history/
- Busselton Mail, "Welcome Gaywal" (cultural complex end of Queen St; mullet and gidgees): https://www.busseltonmail.com.au/story/5861627/gaywal-unveiled-to-huge-crowd/
- Busselton-Dunsborough Times, "Hat tip to a pioneer as statue unveiled" (Bussell's raised hat): https://www.bdtimes.com.au/news/south-west/hat-tip-to-a-pioneer-as-statue-unveiled-ng-ya-117709
- Busselton-Dunsborough Times, "Pioneers honoured" (Pioneer Woman outside the Weld Theatre, unveiling at Queen St and Adelaide St): https://www.bdtimes.com.au/news/busselton-dunsborough-times/pioneers-honoured-ng-b881409099z
- Alamy, "Bronze statue Gaywal ... on Queen Street" (2020, tagged ArtGeo): https://www.alamy.com/bronze-statue-gaywal-by-sculptor-greg-james-on-queen-street-busselton-western-australia-image384907128.html
- `out/refs/old_courthouse/bcpo_0.jpg` (Bussell in the courthouse forecourt). Photos are modelling references only.
