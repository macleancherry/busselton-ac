# Rotary Park, Margaret River: Old Kate, the footbridge and the gate

A Blender detail layer, not a spec: `scripts/blender/landmarks/margaret_river_rotary_park.py`, built by `scripts/blender/landmarks/build.sh margaret_river_rotary_park` into `routes/layers/margaret_river/margaret_river_rotary_park.kn5` and its sidecar.

## What it is

Rotary Park is the riverside park on the east side of Bussell Highway at the north entrance to town, just north of the highway bridge over the Margaret River (OSM way 675740507, Shire of Augusta Margaret River). It's the site of the first settlement in Margaret River and the start of the town's heritage, river and Bunnitj Biddi trails. It has a car park off the highway, toilets, BBQs, a playground and big karri and marri trees.

- **Old Kate:** a small steam locomotive, imported in 1890 by the timber man M C Davies for his Karridale mills and named after his daughter Katherine. Built in Leeds in 1889 by T F Green and Sons, 8 tons. She hauled logs in the Capes until 1909, was sent to the Wyndham jetty in 1917, and came back to Margaret River in 1962-63 as a memorial to the timber pioneers. Restored in 2001 (asbestos boiler lagging removed) and repainted by Rotary volunteers in March 2024. She stands at the park's main entrance, by the car park, in an open-sided gabled timber shelter, with a log bogie behind her and a history board (inHerit, "Kate - Steam Locomotive").
- **The footbridge:** a narrow timber footbridge carries the path from the car park across a river channel towards the playground side.
- **The gate:** a white timber entrance arch, two posts and a beam reading "ROTARY PARK", on the car park.

## Where and how big

- **Kate:** OSM node 2646449749 "Old Kate" at **115.073906,-33.944812**, with the history board (node 2646449751) 20 m north. The shelter doesn't show in the Landgate aerial: it's under the canopy. I put it on the node with its long axis at a bearing of **42°**, parallel to the concrete path that runs past it from the highway underpass towards the footbridge (OSM 345704334), and shifted it 1.8 m north-west so that path passes beside it rather than through it. The model's middle is 115.073892,-33.944801.
  - Shelter: about **12 x 6 m**, eaves 2.85 m, ridge 4.05 m, six bays of posts a side.
  - Kate: about **5.3 m** over the buffers, 1.85 m wide, cab roof 2.8 m and chimney top 3.55 m above rail. The smokebox faces north-east (towards the playground); her log bogie (3.8 m) is coupled behind her to the south-west.
- **Footbridge:** measured from the Landgate aerial (centre 115.07440,-33.94478, half 22 m, 0.043 m/px): **24.6 m** long at a bearing of **142°**, from 115.074280,-33.944716 (car park end) to 115.074443,-33.944891. The deck is about 1.5 m wide. OSM's line for it (way 259278875) is about 8 m west of the bridge in the aerial; I used the aerial.
- **Gate:** from a 2019 Mapillary photo (image 824704838137469, taken at 115.073869,-33.944400 looking 119°). The arch stands about 7 m ahead of the camera, on the east side of the car park aisle, at about **115.07395,-33.94444**, and you walk through it heading about 119°. About 6 m between posts, beam about 3.25 m up.

All three are inside `routes/margaret-river.json` `build.area` except the gate, which is about 7 m north of the area's north edge (-33.9445). The base's ground reaches it, so it sits on the terrain.

## What it looks like

From 2024 visitor photos (modelling reference only) and the 1968 Rail Heritage WA photo record. Hex values are approximate.

- **Kate:** a 0-4-0 tank engine on 3 ft 6 in track.
  - Cab and boiler bright red `#b5221b`; cab front sheet with two round spectacle windows; open sides above the waist; a plain plaque on the back of the cab.
  - Dome and safety valve bright yellow `#f2c318`, and yellow brackets (saddles) under the boiler and on the axleboxes.
  - Smokebox, tall plain chimney, frames, wheels and cylinders black `#1d1d1d`; red buffer beams.
  - A yellow bunker behind the cab.
- **The log bogie:** red-brown timber `#8e3c2c` on four small black wheels, carrying three weathered grey logs `#b7ada0` (two below, one on top) with a chain over them.
- **The shelter:** white `#ecebe4` square timber posts, wall plates and trusses (tie beam, king post, struts), knee braces, corrugated zincalume roof `#9fa4a6` with timber battens showing underneath, white bargeboards and a white picket frieze on the gable ends. Grey gravel floor `#a19c92`. A timber platform and ramp with a white rail up to footplate level on the south-east side (the path side).
- **The footbridge:** weathered grey timber `#8c8170` deck, stringers, posts and top rail, with mesh rails (drawn as five wires) and pairs of round timber piles under every other post.
- **The gate:** white round timber posts and a white beam with "ROTARY PARK" in plain black lettering on both faces (no Rotary logo).

## What a driver sees

Driving into town from the north, just before the river bridge, on the left:

1. The white "ROTARY PARK" arch by the car park.
2. Through the trees, the white posts and grey roof of the shelter, and the red and black engine inside it.
3. The footbridge is about 50 m off the road, under the trees: you only see it from the car park and paths.

## Physics

Only simple walls: the shelter posts (`1WALL_rp_posts`), Kate's frame block (`1WALL_rp_kate`, frame height, under the footplate), the bogie frame (`1WALL_rp_bogie`) and the gate posts (`1WALL_rp_gate`). Everything else is visual. The footbridge has no physics (it's on a path, not a street).

## Clears

The sidecar clears generated buildings and trees in four circles: 9 m round Kate's shelter, 3.5 m at two points along the footbridge, and 4.5 m round the gate. There are no OSM buildings in these circles; it's to keep generated trees out of the shelter, the bridge deck and the arch.

## Not done, and why

- **The old railway bridge:** the Busselton to Margaret River railway (built 1923-25, the Wadandi Track now) crossed the river about **800 m north-west** of Rotary Park, at about 115.0689,-33.9381 (OSM way 733266464). That's outside the town build area, so it isn't in this layer. The footbridge in the park isn't the railway bridge.
- **The Bramley school hall:** the 1922 Bramley School was moved into Rotary Park, then in 1988 to the Old Settlement on the south bank, and moved another 10-15 m east in 2011 (inHerit 04982). It's about 100 m east of the highway behind bush, not visible from the road, so I left it out. It's a long weatherboard and fibro-cement building with a corrugated iron gable roof and a small front porch, if it's ever wanted.
- **The river:** the base has no water and no channel under the footbridge (the valley is on the 30 m DEM fallback), so the bridge crosses grass about 0.3 m up. If the base gets the river, raise the deck (the script keeps it clear of whatever ground is there).

## Unsure

- **The shelter's heading and spot:** not visible from above. Bearing 42° along the path is a guess from the layout; it could be square to the car park instead. Kate's direction (smokebox north-east) is also a guess.
- **Sizes:** Kate's dimensions are estimated from the photos against the 3 ft 6 in track and an 8-ton loco of her type, ±10%. The shelter size is from the photos (about five or six bays), ±1.5 m.
- **The gate's spot:** ±3 m (one dashcam photo, no aerial view of it under the trees).
- **The frieze:** the real gable frieze is cut fretwork; the model has a rail with alternating pickets.

## Sources

- inHerit, "Kate - Steam Locomotive": https://inherit.dplh.wa.gov.au/public/inventory/printsinglerecord/4462a597-40a5-4735-b86c-0fc097950caf
- Augusta-Margaret River Times, Rotarians restore Old Kate (2024): https://www.amrtimes.com.au/news/augusta-margaret-river-times/rotarians-young-and-old-chip-in-to-restore-popular-old-kate-locomotive-at-margaret-rivers-rotary-park-c-14075156
- Collections WA, "Kate" locomotive at Margaret River (Rail Heritage WA, 1968): https://collectionswa.net.au/items/bfd4cbaa-8211-4d96-96b0-271a2ac5083c
- Wanderlog visitor photos of Kate and the footbridge: https://wanderlog.com/place/details/7666717/kate
- Margaret River and Districts Historical Society, Heritage Trail: https://mrdhs.com.au/documents/MRHeritageTrail.pdf
- inHerit, The Old Settlement (Bramley School): https://inherit.dplh.wa.gov.au/public/inventory/details/680f6531-085a-484c-b8d4-1ee09a61dbf9
- inHerit, Margaret River Railway Station Group Site: https://inherit.dplh.wa.gov.au/Public/Inventory/Details/6a44b94e-131d-4a4e-889d-25df82b00666
- Trails WA, Rotary South Bank River Trail: https://trailswa.com.au/trails/rotary-south-bank-river-trail/about
- Mapillary image 824704838137469 (2019, CC BY-SA; reference only)
- OpenStreetMap (ODbL): way 675740507, nodes 2646449749 and 2646449751, ways 259278875, 345704334 and 733266464; Landgate Locate aerial
