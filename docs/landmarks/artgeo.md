# Old Agricultural Bank (ArtGeo)

## What it is

The former Office of the Department of Agriculture, built as the Agricultural Bank in 1931 and later the ArtGeo Gallery. It is at 7 Queen St, on the corner of Marine Tce at the roundabout.

- **Heritage:** on the State Register (place 00405) and classified by the National Trust.
- **Saltwater:** it was the builders' site office during construction, and the City is turning it into Saltwater's bar and restaurant (see `saltwater.md`).

**OSM:** way 737080959.

**The accepted base has no building here.** It is cleared, most likely by the Old Courthouse landmark's circle across the road, so the corner is empty until this spec goes in.

## Footprint

From the Landgate aerial (`out/refs/saltwater/salt_rect.jpg`, same frame as Saltwater, facing 257).

- **Main building:** hipped terracotta roof about 13 m along Queen St by 24 m deep. The narrow end faces Queen St.
- **Porch:** drawn as a 3.8 by 2.4 m rendered porch on that end.
- **Back-of-house block:** a small dark-roofed block (about 11 by 6 m) stands behind, toward Marine Tce. It sits on the box the base builds there (OSM way 737080960), so the spec carries it as an outbuilding.

## Walls and roof

From the inHerit record and a 2021 Mapillary view from the roundabout (`2021-01_81m_from317.jpg`).

- **Walls:** red stretcher-bond brick `#8E4A36`, with a cream render plinth and frieze `#E8DFC6`.
- **Roof:** clay tiles `#B8613F` with boxed eaves, pitch about 28°.
- **Front:** symmetrical, with two big twelve-pane double-hung windows. The cream porch has arched sides and a timber double door with a fanlight.
- **Frieze:** reads "Agriculture WESTERN AUSTRALIA" in black letters.
- **Sides and chimney:** six sash windows down each side, and a rendered chimney on the south side near the back.

## How the spec draws it

`routes/landmarks/artgeo.json`, from `gen_saltwater.py`.

- **Main building:** a hip block 4.6 m to the eaves.
- **Porch:** a flat-topped cream block.
- **Frieze lettering:** two plain boards on the band, "AGRICULTURE" and "WESTERN AUSTRALIA".
- **Outbuildings:** the chimney and the admin block.
- **Not drawn:** the porch arches, modillions and window panes (specHouse windows are plain).

## Unsure

- Which way the porch faces. The inHerit text, the aerial and the photo all point to Queen St.
- The porch's size and height.
- The admin block's walls.
- Whether the bar has added an awning or signs.

## Sources

- inHerit, Office of the Department of Agriculture: https://inherit.dplh.wa.gov.au/Public/Inventory/Details/b78e0e64-7d80-467c-9f4e-9199ee7f8b07
- OpenStreetMap (way 737080959); Landgate Locate aerial (Oct 2026); Mapillary (CC BY-SA, reference only), 2021-01
