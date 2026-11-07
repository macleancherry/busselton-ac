# Cowaramup cow statues

The reason Cowaramup is "Cowtown". Specs: `routes/landmarks/cowaramup_cows_<group>.json` (12 groups) plus the two on Candy Cow's verandah (`candy_cow.json`), all listed in `routes/landmarks/bussell_highway_looks.json`. Built with the spec's `cows` part (`src/core/specHouse.ts`, `SpecCow`), added for these.

## What they are

Life-size fibreglass Friesian cows and calves, painted black and white with textured coats and painted udders. The Cowaramup Lions Club ran the project with the shire's approval (idea from Loraine Teasdale, painted by about 15 volunteers), and local businesses sponsored a cow each (red ear tags name the sponsor). They went in around 2012: about 42 in all, 32 cows and 10 calves, in parks, in garden beds, outside shops and on street corners, many along Bussell Hwy through town.

The golden "Free As A Cow" ("Rump on a Stump", Ron Roozen, 2010) in Pioneer Park is a separate artwork, not one of the herd. Not built.

## Where they stand

No source lists the cows' spots, and OSM has none of them. I found them in the October 2019 Mapillary dashcam runs along Bussell Hwy (osaka78, both directions, a frame every 20 m, full-size crops), then put each one on the Landgate aerial (Oct 2026) by what it stands next to: a garden bed, a sign, a shopfront, a fence. Two cows were placed by crossing the camera bearings from two frames. Positions are about ±3 m (GPS on those runs sits a few metres west of the real lane). Only the cows a driver on the highway can see are built: 21 of the 42 (15 cows, 6 calves). The rest are in side streets and parks.

Every herd's look has facing 180, so in its spec x is east, y north and `heading` is the real bearing of the head.

| Group (slug `cowaramup_cows_...`) | Centre [lng, lat] | Cows | Pose and heading | How sure |
| --- | --- | --- | --- | --- |
| `wine_centre` | 115.102427, -33.851569 | 1 | standing, 130 | Fairly: on the lawn at the Bottrill St corner, left of the Wine Centre sign (frames 17, 66, 67) |
| `moon_haven` | 115.102628, -33.851282 | cow + calf | both lying; cow head up to the road (300), calf 20 | Sure of the spot: the garden bed in front of the yellow weatherboard Moon Haven shop (frame 19) |
| `moon_haven_fence` | 115.10265, -33.851367 | 1 | grazing, 120 | Fairly: by the paling fence on Moon Haven's south side (frames 17, 18) |
| `east_footpath` | 115.102793, -33.851133 | 2 cows + calf | standing, along the footpath | Fairly: footpath between Moon Haven and Cowaramup Agencies (frames 19, 64) |
| `agencies` | 115.103098, -33.850804 | 1 | standing, 315 | Fairly: Agencies' south-west corner (frames 20, 21) |
| `general_store` | 115.102731, -33.850931 | cow + calf | both lying, 135 / 160 | Fairly: outside the general store and post office, west side (frame 19) |
| `cowtown_cafe` | 115.10295, -33.85068 | 1 | standing, 225 | Fairly: under the café verandah, west side (frame 21) |
| `bakery` | 115.103132, -33.850536 | 1 | lying, 225 | Not very: by the French Bakery / Two Moody Cows, west side (frame 22) |
| `hall_rd_garden` | 115.103279, -33.850685 | 2 | standing 300, grazing 250 | Fairly: garden beds at the car park entrance by Hall Rd (frame 22) |
| `tennis_garden` | 115.10352, -33.85045 | 1 | standing, 230 | Not very: the garden strip along the tennis courts (frame 23) |
| `tennis_sign` | 115.10372, -33.85032 | 1 | standing, 230 | Guess at ±8 m: by the Cowaramup Tennis Club sign (frame 24, one bearing and the cow's size) |
| `park` | 115.101616, -33.851629 | cow + 2 calves | standing, a calf grazing | Not very: the park lawn west of the highway, north of Memorial Drive (frames 68, 69; a white shape on the aerial) |
| on `candy_cow` | its verandah | cow + calf | standing, facing north | Fairly (frame 17) |

Frame numbers are the ones in my scratch survey (Mapillary sequences `o918n0s2n5zhti4s3a03ri` north-bound and `od50sgig56dwhj8iu0v1cg` south-bound, both 2019).

Groups are kept small because a landmark stands at one height (its centre's ground) and the base clears generated buildings whose middle is inside its reach. The widest herd reaches about 6 m.

## How they're built

- **Shape:** each cow is 9 to 12 rounded parts (super-ellipsoids): body, neck, head, two ears, four legs, udder, tail. Standing: 1.46 m to the top of the head, 2.35 m nose to tail, 0.66 m wide. Grazing: the head down at grass level. Lying: legs folded, body on the ground, head up, under 1 m. Calves are 0.62 times the size with no udder.
- **Coat:** every face is white (`#eeede8`), black (`#1c1b1b`) or pink (`#dea8a0`: udder and muzzle), from a smooth blotch pattern seeded per cow, so no two match. Heads mostly black with a white blaze, lower legs white with black hooves. Smooth normals, so they shade round.
- **Triangles:** about 650 a cow.
- **Physics:** an invisible box round each body (to 1.45 m standing, 0.8 m lying), so cars stop on them.
- **Keeping off the road:** a cow that would stand within its own reach of the built road or kerb is left out and the compile says so ("n of m cows left off the road").
- **Plain:** no ear tags, sponsor names, Christmas hats or painted designs.

## What a driver sees

North-bound from the BP: calves on the park lawn on the left, then at the Bottrill St corner on the right a cow on the Wine Centre lawn, Candy Cow's pair on its verandah, a cow grazing by Moon Haven's fence and a pair lying in its garden, a little group on the footpath, then cows each side outside the shops, in the car park gardens and along the tennis courts.

## Unsure

- Whether the 2019 layout still holds: cows get moved, repainted and replaced. Check a newer photo or the drive before polishing.
- The `tennis_sign`, `tennis_garden`, `bakery` and `park` spots (see the table).
- Ground height: each herd sits on the ground at its middle plus 5 cm, so on a slope a cow can float or sink a few centimetres.

## Sources

- Margaret River Mail, "Cowaramup cows udderly accepted": https://www.margaretrivermail.com.au/story/224107/cowaramup-cows-udderly-accepted/ (count, 32 cows and 10 calves, Lions Club, painting)
- Busselton-Dunsborough Mail, "The cows in Cowaramup are invading the streets": https://www.busseltonmail.com.au/story/272081/the-cows-in-cowaramup-are-invading-the-streets/ (ear tags, sponsors, on footpaths)
- Wikipedia, Cowaramup: https://en.wikipedia.org/wiki/Cowaramup,_Western_Australia (42 in 2012, the golden cow)
- Australia's South West, Cowaramup: https://australiassouthwest.com/destination/cowaramup
- Big4, "Cowaramup, Cow Town to the locals": https://www.big4.com.au/caravan-parks/wa/south-west/taunton-farm-margaret-river/whats-local/cowaramup-cow-town-to-the-locals
- Mapillary (CC BY-SA, reference only, nothing copied into the build); Landgate Locate aerial; OpenStreetMap
