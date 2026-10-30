# The Ship Inn

## What it is

The pub at 8 Albert Street, on the south-east corner of Albert and West Streets, where Bussell Highway comes into town. George Guerrier built a limestone tavern, the Ship Inn, here in 1847, on the old road from the beach to Castle Bay. The limestone stables probably date from then. The present two-storey hotel was designed by J. L. Ochiltree for A. F. Palandri and opened in October 1928. It has many later additions: bars, a bistro, a beer garden with a playground, and the Nightcap motel rooms behind.

Still open, run by Endeavour Group: the pub plus "Nightcap at The Ship Inn". On the City of Busselton heritage list (inHerit "Ship Hotel & Site": Federation Filigree hotel, Victorian Georgian stables).

Two specs, because the hotel sits square to West Street and the stables wing square to Albert Street, about 10-14° apart:

- `ship_inn.json`: the 1928 hotel
- `ship_inn_stables.json`: the stables wing and the beer garden gate

## Footprint

Measured from the Landgate aerial `out/refs/ship_inn/aerial_z.jpg` (centre 115.34194,-33.65302, half 32 m, so 0.0625 m/px). West Street and Albert Street in OSM match the aerial to within a metre. The OSM building outlines here are about 4-5 m off, so the aerial wins. About ±1 m.

- **Hotel:**
  - **Orientation:** square to the compass, long side on West Street. **Front faces Albert Street, bearing 0.**
  - **Middle:** **115.341789, -33.652997**.
  - **Size:** 17.3 m along Albert Street by 26.6 m deep, plus a single-storey wing at the back (8 x 4 m). A 2.4 m balcony overhangs the Albert Street footpath.
  - **Roof:** pale grey hips. A front range across Albert Street with its ridge east-west, and a long main roof behind with its ridge north-south.
- **Stables wing:**
  - **Orientation:** along Albert Street (bearing 80). **Front faces about 350.**
  - **Middle:** **115.341955, -33.652897**.
  - **Size:** 12.7 m along the street by 6.5 m deep. A 5.6 m cross gable sits towards the street, and a 1.5 m verandah runs along the front.
  - **Roof:** a steep gable, ridge along the street, with the gable end to the east.
- **Behind:** long low ranges (bistro and motel rooms), the Dan Murphy's shed to the south-east, and the car park to the east.

## Walls and roof

Hex values are approximate.

- **Hotel:**
  - **Walls:** white-painted brick `#ECEBE6` with dark timber sash windows.
  - **Height:** two storeys, walls about 7 m.
  - **Balcony:**
    - a deep cantilevered first-floor balcony along Albert Street, on dark metal brackets with a circular motif
    - dark grey slatted balustrade `#4B4F53`
    - roofed by the main roof carried out over it
    - red **THE SHIP INN** banners `#C4122F` hung on it (white lettering; the brand logo left out)
  - **Roof:** corrugated, pale grey `#C9CCCB`, hipped.
  - **Other:** a white chimney. The main entrance is on the West Street corner.
- **Stables wing:**
  - **Walls:**
    - east gable end and back: bare limestone `#CDB68C`
    - street wall: painted white
  - **Cross gable:** steep (about 42°), with white barges and a small vent window in the apex.
  - **Verandah:** a bracketed skillion on either side of the cross gable.
  - **Roof:** grey corrugated `#B9BCBC`.
- **Beer garden gate:** east of the stables. A dark timber gabled pergola, a low limestone wall and a black palisade fence. Trees behind.

## Grounds

- **Footpaths:** red brick paving on Albert and West Streets.
- **Beer garden (behind the gate):** shade sails, white chairs and a playground. Not modelled; only the gate is.
- **Neighbours:**
  - KFC and A.C. Forster & Son across West Street and Bussell Highway
  - Domino's and the shops opposite on Albert Street

## What a driver sees

Driving west along Albert Street towards the West Street lights:

1. The dark gabled pergola and a low stone wall.
2. A bare limestone gable end, then a white wall with a steep decorated gable.
3. The two-storey white hotel with its deep dark balcony and red THE SHIP INN banners over the footpath.

From Bussell Highway coming into town, the hotel's corner and balcony face you across the West Street junction.

## Unsure

- **Storeys.** Whether the whole hotel block is two storeys. The front range certainly is. The main roof behind is drawn two storeys at 6.6 m, but may be partly single storey.
- **The balcony's ends.** The balcony is drawn across the whole Albert Street front. The photos show it reaching the West Street corner, but its east end and any return down West Street aren't clear.
- **Missing details.** The balcony brackets' circular motif and the cross gable's filigree barge are drawn plain.
- **Photo age.** The street photos are from October 2019. The banners and colours may have changed since.
- **Which building is the stables.** The limestone building facing the street is assumed to be the heritage-listed stables. inHerit puts the stables "behind the present hotel", with a pergola on the north.

## Sources

- inHerit, Ship Hotel & Site: https://inherit.dplh.wa.gov.au/Public/Inventory/PrintSingleRecord/9769c512-d485-4c2f-8289-d6d76a414d0a
- Summerstar, Busselton breweries and pubs (Ship Inn, 8 Albert St): https://summerstar.com.au/blog/busselton-breweries
- Endeavour Group careers listing (venue manager, The Ship Inn Busselton): https://endeavourgroupcareers.com.au/job/publican-venue-manager-the-ship-inn-in-busselton-wa-6280-jid-8438
- Mapillary 2019 dashcam frames (Albert Street westbound)
- Landgate Locate aerial; OpenStreetMap (node 3744179433 "The Ship Inn")
- Reference files: `out/refs/ship_inn/` (aerial.jpg, aerial_z.jpg, aerial_grid.jpg, mly*.jpg, mly_sheet.jpg, summerstar.jpg)
