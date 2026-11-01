# Shelter Brewing Co

Tourism item 1 (ROADMAP Phase B; docs/plans/tourism-places.md): the brewery and pub on the foreshore, directly behind the Visitor Centre. A hand-made Blender detail layer, like Transition and Sea Play: `scripts/blender/landmarks/shelter_brewing.py`, built end to end with `scripts/blender/landmarks/build.sh shelter_brewing`, giving `routes/layers/shelter_brewing.kn5` and its sidecar.

## What it is

Shelter Brewing Co, 11 Foreshore Pde (OSM way 749124330). Designed by Paul Burnham Architect, it opened in November 2020 and won a 2021 WA Architecture Award (Commercial). The form is taken from the old jetty railway sheds: one big utilitarian shed with twin gables, double-height inside, a commercial brewery, a pub for about 650 and a function room. Up to 80% of its power comes from the roof's solar panels.

It is **not a sawtooth roof** (the plan and ROADMAP said sawtooth). It's two parallel gabled sheds. From above, the dark roofs covered in panels look like a sawtooth.

## Footprint

Measured from the Landgate aerial (`out/refs/shelter/aerial35.jpg`, `aerial80.jpg`, plus the zooms `west12.jpg` and `west10b.jpg`, resampled into the building's frame in `frame.png` and `frame80.png`). Checked against the OSM outline (fetched from the OSM API on 1 Nov 2026).

- **OSM outline:** about 42 × 40 m. The long sides run at bearings of 139° and 49°. Corners:
  - west 115.3448434,-33.6452773
  - north 115.3451949,-33.6450373
  - east 115.3454808,-33.6453135
  - south 115.3450305,-33.6454279
- **Frame:** u runs along the ridges (bearing 139°, from the lawn towards Foreshore Pde) and v runs across them (bearing 49°, towards the Visitor Centre). The origin is at 115.34516,-33.64523.
- **East shed:** 12.3 m wide and 38 m long (u -15.0 to 22.8, v 2.6 to 14.9). It runs all the way from the lawn front to the Foreshore Pde forecourt.
- **West shed:** 11.4 m wide and 31 m long (u -15.0 to 15.6, v -12.4 to -1.0). It stops 7 m short, leaving a yard where the silo stands.
- **Link:** a 3.6 m glazed link between the sheds with a flat roof at about 7 m. A glazed roof lantern runs along its north half. On it is a plant deck with four fan units (in the aerial, behind a rail) and a plant box.
- **Back-of-house block:** about 15 × 21 m on the south-west (u -12.5 to 8.4, v -27.5 to -12.4), with a flat roof at about 6 m and two flues.
- **Silo:** a stainless grain silo, 3.7 m across, at about u 17.8, v -2.6, in front of the west shed's back gable.
- **Beer garden:** a strip about 6 m deep along the lawn front.
  - a row of about ten red umbrellas just past the canopy
  - long timber tables and round tables
  - planters, and a low limestone wall with openings onto the lawn path
- **East terrace:** a row of five or six smaller umbrellas along the east path (v about 18, u 5 to 17).
- **West courtyard:** a small walled courtyard at the west corner under a dark grey shade sail, with a palm.
- **Forecourt:** a paved forecourt on Foreshore Pde in front of the glass gable, with a planter bed and boulders at the foot of the glass, and black bollards.

## Heights and form

From the photos, scaled by people and the 12.3 m gable width:

- **Eaves:** about 8.5 m.
- **Pitch:** about 28° (the glass gable measures 27 to 29°), so the ridges are at about 11.8 m.
- **"10-metre floor-to-ceiling windows"**, as the reviews put it, on both lawn gables.
- **Canopies:** the front canopy and the east canopy are flat, about 3.9 m up and 2.4 m deep. Each has a charcoal fascia, a timber soffit and festoon lights.

## Colours and materials

Hex values are approximate.

- **Roofs:** charcoal Colorbond (Monument-like), `#34373b`, almost covered in solar panels (`#1e2733`).
- **Lawn gables:** full glazing in charcoal steel frames. A deep portal frame runs round the outline. Above the canopy, a close screen of vertical dark battens covers the whole gable, with one heavier horizontal rail.
- **Forecourt gable** (east shed, on Foreshore Pde): a full glass gable in a deep dark bronze/charcoal frame. It has a grid of mullions and a band of louvres about 7 m up. "Shelter / Brewing Co." is in white letters on the glass, and the stainless brewing tanks show through.
- **East wall** (towards the Visitor Centre):
  - weathering steel (Corten, `#7c4227`) from the canopy to the eaves, which carries the slogan "BORN & BREWED IN BUSSELTON" in big white letters
  - a glazed shopfront under the canopy, on a limestone plinth with ramps
  - near the north end, two board-formed concrete piers frame a big lounge opening, with a raised jarrah deck and a top-hung glass awning swung up and out
- **West shed's back gable:** Corten.
- **Back block:** pale beige-grey cladding (`#a59a84`). A mural-painted screen wall stands by the service yard.
- **Silo:** silver corrugated stainless, on four legs with a hopper, with two fill pipes up the side and over to the brewhouse.
- **Ground:**
  - pale exposed-aggregate and limestone paving (`#cfc4a8`)
  - limestone block garden walls
  - umbrellas: red, as in the 2020 opening photos (Mac's call, 2 Nov; the current aerial shows cream tops)

## What a driver sees

- **Foreshore Pde, from the south-east and the Queen St end:**
  - the tall glass gable with "SHELTER" on it
  - the silver silo against the rust-red gable behind it
  - the beige back block on the left
  - the east canopy and its umbrellas on the right
- **Foreshore Pde's bend, west of the building:**
  - the twin dark battened gables over the beer garden's umbrellas
  - the dark shade sail over the west courtyard in front
- **The Visitor Centre side and the jetty car park:**
  - the long rust-red wall over a glazed shopfront and canopy
  - the concrete piers and the glass awning

## The layer

Everything is built in the base's own coordinates against the accepted Busselton base (`out/accepted/busselton.zip`, exported with `--radius 90 --layers` so the Visitor Centre, The Goose and Hilton specs show in the renders).

- **Size:** 10,342 triangles, 19 meshes and 12 materials (`shelter_*`, solid colours, no textures).
- **Floor:** at track z 2.6. The base terrain under the site is bumpy (2.0 to 3.0 m). Walls run 1.2 m down into the ground on a concrete plinth. The beer garden and the courtyard are level with the floor, and never lower than the ground. The forecourts and the east path are draped 3.5 cm over the base ground, and stop at any street mesh.
- **Physics** (`1WALL_`), all else visual:
  - `1WALL_shelter`: one inset box inside the walls of each block (east shed, west shed, link, back block)
  - `1WALL_shelter_garden`: the low limestone walls and the service-yard screen
  - `1WALL_shelter_silo`: a box round the silo legs
  - `1WALL_shelter_bollards`: the forecourt bollards
- **Signs:** plain lettering only, in Blender's built-in font, white and no logo.
  - "SHELTER" on the front canopy at the east corner, facing the lawn
  - "SHELTER / BREWING CO." on the forecourt gable's glass
  - a small "SHELTER" on the east canopy's forecourt end
  - "BORN & BREWED IN / BUSSELTON" in two lines on the east wall's Corten, south of the lounge opening, facing the Visitor Centre (added at Mac's request, 2 Nov)
- **Sidecar:** `replaces` is a 31 m circle at 115.345142,-33.645288 (the middle of the building and garden). It clears any generic box and the generated trees there (two large generated trees stand where the beer garden is). The Visitor Centre spec is about 59 m away, so it isn't touched.
- **Renders:** `out/landmark_renders/shelter_south.png` (Foreshore Pde), `shelter_north.png` (the bend west of the building) and `shelter_slogan.png` (`--view east`, from the Visitor Centre side). Draft view: `--view top`. The south and north renders predate the red umbrellas and the slogan.

## What it can't show

- **Glass is opaque.** The layer converter has no transparent materials. Through the glass you can't see the brewing tanks, the steel trusses, the mezzanine or the timber fans. The glazing is a dark blue-grey.
- **Not modelled:**
  - festoon lights (no night look; Rocky Ridge's pergola has an emissive bulb approach that could be reused)
  - downlights, the solar panels' cell pattern and the roof's corrugations
  - the mural on the yard wall
  - the palm and planter shrubs (green boxes)
  - the stainless handrail cage on the silo, its ladder and the hip feature across the valley in the middle of the roof
- **Open-air details simplified:**
  - the shade sail is one flat two-triangle sail, not a tensioned hypar
  - umbrellas are 8-sided cones
  - tables and benches are boxes
- **Heights are estimates** from photos, about ±0.5 m: the eaves, the link roof and the back block.
- **The back of house is a guess:** the back block's west and south faces (doors and windows) and the service yard aren't in any photo found.
- **The base has no building here.** No generic Shelter box is in `out/accepted/busselton.zip`, only bumpy grass. The `replaces` circle matters for the trees, and for any rebuild that brings the OSM box back.

## Sources

- Landgate Locate aerial (personal, non-commercial use), fetched 1 Nov 2026 with the scratchpad `aerial.mjs`.
- OpenStreetMap way 749124330 (ODbL), via the OSM API.
- Photos, used only as modelling references (none are in the track):
  - CO-Architecture, [Shelter Brewing Co](https://site.co-architecture.com/all/shelter-brewing-co/) (twin gables, Corten, north glazing, sun screens, awnings, PV, Robert Frith photos)
  - Australian Institute of Architects, [2021 WA awards, Commercial: Shelter](https://www.architecture.com.au/awards/commercial-shelter) (Paul Burnham Architect; the railway-shed reference)
  - Architecture & Design, [Busselton brewery architecture celebrates location](https://architectureanddesign.com.au/news/busselton-brewery-architecture-celebrates-location) (north-facing glazing, steel frame)
  - Broadsheet, [Shelter Brewing Co](https://www.broadsheet.com.au/margaret-river/busselton/bars/shelter-brewing-co) (the east wall and canopy, the lounge opening, 10 m windows)
