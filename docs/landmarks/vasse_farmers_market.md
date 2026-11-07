# Vasse Village by Bunbury Farmers Market

## What it is

The Bunbury Farmers Market's second store, a single-storey market hall in Vasse Village, beside Bussell Highway just west of the Busselton Bypass West Rotary (the "Vasse Roundabout", where Bussell Hwy, the Busselton Bypass and Vasse Hwy meet). Address 4 Orchard Place, Vasse. It opened on 5 December 2024. 3,552 m² in two fire compartments (a 3,452 m² market and a 100 m² alfresco), built 2021 to 2024. It's the biggest building in the village and the nearest to the highway: leaving the rotary westbound, it sits ahead on the left behind a strip of bush, with Coles and the other shops further back on Napoleon Promenade.

Spec: `routes/landmarks/vasse_farmers_market.json`, listed in `routes/landmarks/vasse_looks.json`.

## Footprint

Measured from the Landgate aerial (`out/refs/vasse/bfm120.jpg`, 0.10 m/px, and `village400.jpg`, 0.20 m/px) and the OSM outline (way 1548080043), which match to a metre or two (the aerial leans the roof a few metres south-west).

- **Shape:** a rectangle, about **73 m** along the side facing the highway (north-east, bearing 117°/297°) by **50 m** deep (bearing 27°/207°). OSM has two small notches at the west and south corners (4 to 5 m), left out.
- **Corners (OSM):** north 115.249206,-33.672342; east 115.249913,-33.672641; south 115.249666,-33.673046; west 115.248979,-33.672714.
- **Centre:** 115.249441,-33.672686 (the middle of the four corners).
- **Front:** the south-east face (50 m), onto the village street, with a planted strip and footpath between it and the kerb. It faces bearing 117°, so it's the face a driver sees end-on coming off the rotary. In the spec, x runs along it from the south corner (left) to the east corner (right); y runs back north-west.
- **North-east face** (73 m): to the highway, with a service yard and roof plant at its north end, behind 30 to 40 m of bush and the shared path.
- **North-west face:** onto the car park. **South-west face:** the alfresco, under tan shade sails, then the street.

## Walls and roof

- **Height:** single storey; parapet about 8 m (from the photo, against the street light and the posters). The sign box stands about 1.5 m above it.
- **Walls:** black or very dark charcoal flat panels, about `#24262a`.
- **Copper-brown trim:** a capping band along the parapet top, a low base band and three pilasters on the front (both corners and about two-thirds along). About `#8c5a3e`.
- **Front, left to right:**
  1. A large rust-steel laser-cut relief over the left third: orchard trees, a white river winding across, and crates of apples at the lower left standing proud of the wall. Modelled as a rust panel (`#8a5634`) with a white river band and a deeper crate block.
  2. The framed sign box, copper frame, dark face, "Vasse Village" in white script with "BUNBURY FARMERS MARKET" in green below. It breaks the parapet line.
  3. A large screen (on opening day: "An apple a day SUPPORTS LOCAL GROWERS", red header over a growers' photo).
  4. A copper pilaster, then a poster, "Welcome to the home of 100% MARKET MADE".
  5. A round green "WA grown" badge high on the right corner (left out).
- **Roof:** green Colorbond (Cottage Green or similar; the aerial reads `#3b8179` through haze), hidden behind the parapet from the street: a low-pitch north-east half and a row of four low gables on the south-west half, their ends on the south-west face. Modelled as a flat green deck just under the parapet top, since a driver never sees it.

## Grounds

- **Alfresco** off the south-west face near the south corner: tables under about six overlapping tan shade sails (`#ddcdad`), with small green-roofed kiosks around it. Three sails in the spec.
- **Front strip:** footpath along the wall, a planted bed of low natives, then the street kerb.
- **Car park** to the north-west, with long green-roofed shade structures and shops beyond.
- **North-east:** a concrete service yard at the north end, then native bush and the shared path to the highway.

## What a driver sees

1. A long black box with a copper-brown top edge, low behind the bush on the left after the rotary.
2. Its south-east end wall turned towards the rotary: the rust orchard relief, the framed Vasse Village sign above the parapet, the screen and poster.
3. The tan shade sails at the far left corner.

## Unsure

- **Which face the photo shows:** the south-east face is the best fit (the planted strip and kerb in front, and a green-roofed kiosk at the left corner as in the aerial), but the north-east face to the highway hasn't been seen in any photo. It's modelled plain black with the copper cap.
- **Positions along the front** of the relief, sign, screen and poster, read from one photo at an angle: a few metres either way.
- **Parapet height** (8 m) is an estimate; no drawings found.
- **Roof gables** on the south-west half and the gable profile of that wall are left out.
- **Rotary:** the rotary itself has no sign or sculpture to build. Its centre is low native shrubs on gravel with a small concrete pad, and the only sign is a standard green direction sign (Landgate aerial `out/refs/vasse/rotary120.jpg`; Mapillary, Oct 2026).

## Sources

- Aerial: Landgate Locate, `out/refs/vasse/bfm120.jpg`, `village400.jpg`, `rotary120.jpg`
- Building outline and roads: OpenStreetMap (way 1548080043; Busselton Bypass West Rotary)
- Photo: The West / South Western Times, opening day, `out/refs/vasse/west_opening.jpg`: https://www.swtimes.com.au/news/regional/an-icon-of-the-south-west-has-opened-the-doors-of-its-second-store-in-the-heart-of-the-region-c-17046841
- Mapillary (CC BY-SA, reference only), Oct 2026, at the rotary: `out/refs/vasse/mly_2026-10_*.jpg`
- Floor area and dates: Jensen Hughes project profile, https://www.jensenhughes.com/pacific/insights/vasse-village-by-bunbury-farmers-market
- Opening date: https://vasse.com.au/vasse-vilage-by-bunbury-farmers-market-opens-5-december-2024
- The "Vasse Roundabout" name: Main Roads WA, https://www.mainroads.wa.gov.au/projects-initiatives/all-projects/regional/bussell-highway-causeway-road-to-vasse-roundabout/
