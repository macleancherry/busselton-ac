# Weld Theatre

## What it is

The Weld Theatre (Weld Hall), Victorian Italianate, from 1874 with later additions. It stands at 13 Queen St on the Adelaide St corner, just south of Saltwater.

- **Kept and joined to Saltwater:** the City describes it as "functionally integrated" with the new centre but able to run on its own.
- **New work behind:** a new covered courtyard behind the old theatre, a scene dock leveller and an upgraded back of house.

**OSM:** way 749126947. **The accepted base builds it as a generic box.**

## Footprint

From the Landgate aerial (`out/refs/saltwater/weld_rect.jpg`, Saltwater's frame, facing 257).

- **Hall:** hipped, about 18 m along Queen St by 10.5 m, with its ridge along the street.
- **Entrance porch:** gabled, about 6 by 6.5 m, pushing out to Queen St.
- **Stage house:** taller and gabled, behind the hall (8 by 5 m).
- **Side wing:** gabled, toward Adelaide St.
- **Behind:** two long low roofs, about 30 by 7 m each: the covered courtyard and the back of house. They are outbuildings in the spec, so the clear circle doesn't strand them as generated boxes.

## Walls and roof

From inHerit only (brick walls, corrugated iron roof). **No photo of the street front was found.**

- **Walls:** brick `#9A5A44`, with a cream rendered porch `#E6DCC2` and a band under its gable.
- **Roof:** pale grey corrugated iron `#C9CDCF`, pitch 25 to 30°.
- **Sign:** "WELD THEATRE" in plain letters over the door.

## How the spec draws it

`routes/landmarks/weld_theatre.json`, from `gen_saltwater.py`. The porch gable faces the street.

**Clear circle:** about 34 m. Plotted against OSM, the nearest generated building east of it (the white-roofed block on the car park) stays outside.

## Unsure

- **The whole street front:** whether it has an Italianate parapet, its colours and its openings.
- **Wall heights.**
- **The back roofs:** whether they belong to the theatre or to Saltwater.

## Sources

- inHerit, Weld Hall Theatre: https://inherit.dplh.wa.gov.au/Public/Inventory/PrintSingleRecord/adecfba3-ae35-4304-9787-58b5c3da436b
- City of Busselton, "An Integrated Design Solution": https://www.busselton.wa.gov.au/news/an-integrated-design-solution/65?c=2
- OpenStreetMap (way 749126947); Landgate Locate aerial (Oct 2026)
