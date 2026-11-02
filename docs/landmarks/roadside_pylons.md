# Roadside pylon signs (Foreshore route)

## What it is

Four roadside signs on the Foreshore layout's return leg, westbound along Albert St and then Bussell Hwy:

| Sign | Where | Real sign |
| --- | --- | --- |
| McDonald's | Albert St, kerb island at the east side of the restaurant's driveway | Tall post with arches and a lettered panel |
| Hungry Jack's | Albert St, planting strip at the front of the shared car park just west of the restaurant | Tall slab |
| Paradise Motor Inn (6 Pries Ave) | Albert St, corner of the motel's front lot by the rock garden | Not known |
| Busselton Motel (25-31 Bussell Hwy) | Bussell Hwy, lawn at the motel's east corner by the side street | Low white board on posts |

**Why they're needed:** the base builds McDonald's and Hungry Jack's as generic pads and the motels as generic buildings, none with names. The pads sit too far back for the shopfront rule (`tourism-places.md`), so a sign by the road is what places them.

## Positions

| Sign | at | Facing | Evidence |
| --- | --- | --- | --- |
| McDonald's | 115.34384,-33.65243 | 77 | **Aerial (Oct 2026):** a tall pole in the island with a 7 m shadow (`albert.jpg`, `zooms.jpg`). **Mapillary (Oct 2019):** the sign is there, square to the road and facing westbound traffic (`115.34430_..._2019-10.jpg`). |
| Hungry Jack's | 115.34320,-33.65260 | 77 | **Aerial:** its top and long shadow in the planting strip (`albert_w.jpg`, `zooms.jpg`). **Mapillary (2019):** a tall slab in front of the retail block, facing westbound traffic (`115.34382_..._2019-10.jpg`). |
| Paradise Motor Inn | 115.34397,-33.65243 | 77 | **Aerial:** only a slim pole and a small box at the lot's corner. **2019:** the lot was fenced, with no pylon visible. |
| Busselton Motel | 115.33874,-33.65329 | 117 | **Mapillary (2019):** BUSSELTON MOTEL on a low white board (`m_115.33903_..._2019-10.jpg`). **Aerial:** its top under the tree (`motel_corner.jpg`). Angled to face the highway and the corner. |

The reference images are in `out/refs/roadside_pylons/`. Each spot is on grass or footpath in the accepted base, not on a road.

## How the specs draw it

**Shared parts:** all four come from one small generic pylon in `gen_pylons.py` (scratchpad), each with its own text:

- `pylon(slug, name, at, facing, note, lines, width, height, kind)`
- `kind` is one of:
  - `post`: a grey post with a cabinet on top
  - `slab`: a solid slab with lettered panels on its face
  - `board`: a low board on two posts over a plinth

A spec's text lives in the spec, not in looks.json, so reusing it means one small file per sign.

**Colours:** neutral throughout, with no logos and no brand colours:

- galvanised grey posts `#8C8F92`
- light grey cabinet `#D6D6D2`
- off-white faces `#F1F1ED`
- charcoal plain lettering `#2A2C30`

| Spec | Kind | Size | Lettering | Clear |
| --- | --- | --- | --- | --- |
| `pylon_mcdonalds.json` | post | 8.6 m post, 3.2 m cabinet | McDONALD'S / DRIVE THRU | 3.0 m |
| `pylon_hungry_jacks.json` | slab | 2.1 × 0.5 × 7.5 m | HUNGRY JACK'S / DRIVE THRU | 2.6 m |
| `pylon_paradise_motor_inn.json` | post | 4.4 m post, 3.0 m cabinet | PARADISE MOTOR INN / MOTEL | 2.9 m |
| `pylon_busselton_motel.json` | board | 2.7 m board, top at 1.9 m | BUSSELTON MOTEL | 2.9 m |

**Clear circles:** no generated building centroid falls inside any of them. The nearest is 25 m away.

**Physics:** the post, slab or plinth is solid (it's the spec's block). The cabinet isn't, but it sits above car height.

## What it couldn't represent

- **One lettered side only.** A spec sign faces only its front. The three Albert St signs face westbound traffic, the Foreshore direction; eastbound drivers see a plain grey back. A sign option for a back face (specHouse `signs`) would fix that.
- **No logos.** The arches and the burger logo are left out on purpose. So are the red and yellow, which read as logos.

## Unsure

- **Paradise Motor Inn:** its sign's design and exact spot, and whether its main sign is on Pries Ave instead.
- **Heights:** the McDonald's and Hungry Jack's heights are read from shadows and 2019 dashcam frames.
- **Changes since 2019:** whether the Busselton Motel board has changed.

## Sources

- Mapillary dashcam sequences, Albert St and Bussell Hwy (October 2019, January 2017), CC BY-SA, used as references only
- Landgate Locate aerial (Oct 2026)
- OpenStreetMap: McDonald's way 316526728, Hungry Jack's way 370713135, Paradise Motor Inn way 370713128, Busselton Motel way 1041574734
- Paradise Motor Inn, 6 Pries Ave: https://www.top4.com.au/business/paradise-motor-inn-122839
