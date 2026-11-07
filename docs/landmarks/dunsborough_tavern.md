# Dunsborough Tavern

## What it is

The town's big family pub at 2 Dunsborough Place, just north of the Caves Road and Dunn Bay Road roundabout. It has a bistro and bars open every day, the Inji Bar (live bands), a function room, a big beer garden with a screen, and a kids' indoor play area you can see from the road. OSM has it as a pub node named "The Dunsborough" (10026647121) with an older unnamed pub node beside it (704988966). Gig and review sites still call it the Dunsborough Tavern (see Unsure).

Route: **busselton-dunsborough.json** (Busselton to Dunsborough). Looks file: `routes/landmarks/busselton_to_dunsborough_looks.json`.

## Footprint

Measured from the Landgate aerial `out/refs/dunsborough_tavern/aerial_raw.jpg` (centre 115.1067,-33.6168, half 50 m, so 0.083 m/px). It was rotated to the building's axes with a 2 m grid (`rot_clean.png`, back up, front down), and checked against the compiled layer drawn over the aerial. About ±1 m on the walls.

- **Overall:** about 54 m (south-east to north-west) by 52 m deep, including the beer garden and the small outbuildings. Axes at 152° and 62°.
- **Middle:** **115.106715, -33.616895** (the middle of the main blocks; the OSM pub node is about 10 m east of it).
- **Facing:** the spec's front faces bearing **62°** (north-east), towards Dunsborough Place, the main car park and the beer garden.
- **Plan** (as seen from the front, x left to right = south-east to north-west):
  - a wide main hall, about 45 by 18 m, under one big hip
  - two hipped front wings on its right half, the right one with a glazed lantern in the roof
  - a square hipped entry porch, about 6.5 by 8 m, standing out in front of the right wing (the car park entrance)
  - a brick corner tower on the left front corner, about 8.5 by 8 m, with a brown pyramid roof and a small glazed lantern
  - a hipped back wing, about 29 by 18 m, on the left half behind the hall (towards Caves Road), with a flat deck in the middle
  - small outbuildings: a flat-roofed store on the left side, a hipped gazebo at the back-left corner by the car park, and a flat plant deck behind the hall
- **Neighbours:** a flat-roofed shopping block adjoins on the right (north-west); the service yard sits between it and the back wing. The OSM building way (370557832) runs the tavern and part of that block together.

## Walls and roof

From visitor photos of the beer garden (Buggybuddys, 2019) and the aerial. Hex values are approximate.

- **Walls:** red face brick `#9C4D3A`. Single storey, eaves about 3.6 m; ridges about 7.5 m on the hall.
- **Verandah:** along the hall's front over the beer garden, dark stained timber posts `#4A3A2E`.
- **Roofs:** pale grey metal, Surfmist-like `#D4D5CA`, hips at about 22°, the front wings about 25°.
- **Tower:** a brown pyramid roof `#8E5C48` with a finial, over a glazed lantern with dark green frames `#3F5A46`.
- **Side store:** pale grey corrugated cladding `#C4C8C6` (seen beside the garden in the photos).
- **Signs:** **DUNSBOROUGH TAVERN** in plain cream lettering on a dark board, over the front wing and on the entry porch. No logo.

## Grounds

- **Beer garden** (front left, about 30 by 14 m):
  - artificial turf and red brick paths `#A66A55`
  - chunky pine tables with bench seats
  - white market umbrellas
  - a white shade sail and a teal one `#3F8F8F`
  - hanging baskets (left out)
- **Front:** red brick paving between the front wings and the car park.
- **Car parks** on the front and south-east sides; a few trees along the back by the Caves Road car park.

## What a driver sees

The route passes about 50 m south of the back wing on Caves Road and goes round the Dunn Bay Road roundabout 80 m south-east of the front. From the road it's a long red-brick building with pale grey hip roofs behind the car park trees, and the brown tower roof over the beer garden at its south-east end.

## Approximations

- The main hall's roof is one plain hip. The aerial shows broken ridges and skylights; the front lantern is left out.
- The tower's lantern is a tall block rising through the tower roof.
- The entry porch is a closed block. It may be open on posts.
- The outbuildings are flat or simple hips.
- The hall's ridge, the back deck and the service yard sheds aren't modelled.

## Outside the corridor

In the 2 Nov base, only the back wing and the gazebo stand on detailed terrain (the country preset keeps about 70 m either side of Caves Road). The rest is over the horizon mesh, which the base holds about 3 m under the terrain near the corridor.

- **Height:** the whole landmark sits at the detailed terrain's height (7.0 m). From the drive its base meets the terrain edge and looks right.
- **From the car park:** off the built ground (not drivable), it would float about 3 m over the horizon.
- **The fix:** the route now has a landmark patch like Caves House's (`build.area` with `streetsValid: false`, from the roundabout to the tavern), so it gets real ground at the next base build. `test/landmarkReach.test.ts` needs the patch anyway.

## Unsure

- **The name on the building.** OSM calls it "The Dunsborough". If the pub has been renamed, change the sign text.
- **Where the entrances are,** and whether the entry porch is open.
- **Wall finish on the back and the Caves Road side:** brick assumed all round. Window positions there are guesses.
- **Roof heights and pitch:** from shadows and photos, not measured.

## Sources

- Buggybuddys, The Dunsborough Tavern (photos of the beer garden and play area): https://buggybuddys.com.au/the-dunsborough-tavern/
- Moshtix venue page: https://www.moshtix.com.au/v2/venues/dunsborough-tavern/790
- Touringuide, The Dunsborough (same location): https://touringuide.com/au/pubs/wa/the-dunsborough
- Landgate Locate aerial; OpenStreetMap (nodes 10026647121 and 704988966, way 370557832)
- Reference files: `out/refs/dunsborough_tavern/` (aerial.jpg with OSM outlines, aerial_raw.jpg, wide.jpg, rot.png and rot_clean.png)
