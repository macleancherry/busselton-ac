# Sea Play on the Bay, the Barrel and Transition

Row 9 of the list: the foreshore playground west of the jetty, and two artworks OSM puts near it. Specs: `routes/landmarks/sea_play.json` and `routes/landmarks/transition.json`. The Barrel has no spec (see below).

## Sea Play on the Bay

### What it is

The Busselton Foreshore Playspace (OSM `alt_name`), known as Sea Play on the Bay. It was designed by PLAN E, built by Phase3 Landscape Construction and opened on 2 November 2018. It won the 2019 AILA National Award of Excellence for play spaces and the PLA WA Park of the Year.

The theme is the town's sea history. A big timber clipper ship lies heeled over in white sand, as if it's leaving the beach for Perth. Around it are a giant squid and a whale, wharf piles, boulders and water play.

### Footprint

Measured from the Landgate aerial (`out/refs/sea_play/aerial40.jpg`, centre 115.34422,-33.644943, half 40 m, 0.078 m/px, with zooms `west16.jpg` and `east16.jpg`). Checked against the OSM outline (way 749124328).

- **Outline:** an irregular blob about 52 m east-west by 33 m north-south, bounded by low curving concrete walls and grassed or bouldered mounds. OSM bounding box: 115.34393 to 115.34449, -33.64508 to -33.64478.
- **Where:** on the foreshore lawn between the beach promenade (about 12 m to the north) and the shared path to the south. The jetty and the Interpretive Centre boatsheds are about 120 m to the east-north-east.
- **The ship:** about **25 m long and 4.5 m wide**. Its axis runs at a bearing of **76°** (ENE), with the **bow at the east end** and the stern at the west.
  - The hull is sunk in the sand. Its sides stand about 1.5 m high amidships. The stern castle stands about 3 m and the bow rises to about 3.5 m.
  - **Stern** centre: 115.344047,-33.645000. **Bow:** 115.344317,-33.644943.
  - Three masts lean towards the beach (north) by about 25 to 30°. In the aerial they show as lines about 5 to 6 m long running north from the deck.
- **The wharf:** an elevated timber jetty of grey recycled wharf timber, about 7.5 x 3 m and about 1 m high, running west off the stern. A field of old wharf piles stands to the west and along the north-west, about 0.3 m thick and 1.6 to 4 m tall.
- **North-west wet play:** blue non-slip concrete, about 15 x 12 m, with the **whale** at about 115.344006,-33.644907.
- **North-east pool:** a blue-rimmed pool, about 15 x 15 m, with the **squid**. Its lattice mantle lies at about 115.344360,-33.644843, with tentacles across the sand to the south and west.
- **Bow wave:** a blue concrete "bow wave" wraps round the bow.
- **Middle (for the looks entry):** the stern castle, **115.344074,-33.644993**. It's the spec's only block (see "Clears" below).

### Colours and parts

From the PLAN E photos (2018), Buggybuddys (Oct 2018) and a 2020 Commons photo. Hex values are approximate.

- **Hull:** varnished red-brown hardwood (jarrah), `#7a3a22`, with a lighter deck `#9a6a44`. A rounded stern with a small timber deckhouse and crates amidships.
  - The 2020 photo shows a nameplate on the stern that looks like "HALCYON" (unsure).
- **Masts and yards:** white steel `#f1f1ee`, about 10 to 12 m tall, each with three or four yards. A long bowsprit at the bow.
- **Crow's nest:** a slatted timber barrel, about 1.8 m across, partway up the main (middle) mast. Black rope climbing nets run up to it.
- **Wharf piles:** weathered grey-brown timber `#7b6a58`, with the bottom 0.6 to 0.8 m painted green `#4c8f52`.
- **Whale:** blue steel `#2e64ad`. The tail rises out of the water on a curved stalk, with a long blue canopy about 3 m up. Water runs off the tail.
- **Squid:** bright orange steel `#e8581c`.
  - A big lattice mantle with an eye and a slide, about 6 m long and 2.5 m high.
  - Tube tentacles that arch out of the sand, 1 to 2 m high.
  - One tall tentacle tip, about 5 m, with a spotted paddle.
  - An orange arch with a black basket swing.
- **By the bow:** a navy lattice arch (like whale ribs, `#25416a`) over a timber ramp, and a white lattice fish.
- **Ground:**
  - white play sand `#ece6d6`
  - blue concrete `#3a8fd0` with lighter swirls `#86c8e8`
  - tan sandstone and granite boulders `#c69c62` on the mounds, west and east
  - low in-situ concrete seat walls `#d3cec4` round the edge
- **Shade:** mature Norfolk Island pines round the edge, with timber platform benches under them. Coloured lights at night.

### What a driver sees

There is no street. From the promenade and the shared path, and across the lawn from the jetty end:

1. Three white masts leaning hard towards the sea, with yards and the barrel crow's nest, among the Norfolk pines.
2. The red-brown hull low in white sand.
3. Bright orange arches and the lattice squid to the east, and a blue whale canopy to the west.

### Spec notes and what needs a Blender layer

The spec frame is turned to the ship (x along it from the stern, y across it towards the beach), and the front faces 166°. Everything is axis-aligned blocks and panels:

- **Only the stern castle is a block.** It's the one physics wall. Everything else is panels, which have no physics.
- **Masts** are stepped bars, so the lean shows. Yards are flat bars across the ship, and the heel's tilt is left out.
- **Arches** (tentacles, the squid mantle, the swing, the navy ribs and the fish) are inverted Us made of three boxes.
- **Ground surfaces** (sand, blue) are 4 to 8 cm panels laid on the ground at the centre's height.
- **Boulders** are pairs of overlapping boxes.

What a Blender detail layer should do instead:

- **The hull:** a real curved, heeled hull with a rounded stern and a raked bow; the spec is boxes. The heel itself (hull and deck tilted about 25° to the north) can't be shown.
- **The masts and yards** as straight round tubes, the rigging and climbing nets, and the crow's nest as a slatted cylinder.
- **The squid:** a lattice mantle, curved tentacle tubes and the tentacle paddle.
- **The whale:** the curved tail stalk, the flukes and the canopy shape.
- **The navy rib arch and white lattice fish** at the bow, and the timber ramp and slides.
- **Ground:** mounds, round boulders, and the sinuous seat walls.
- **Trees:** the Norfolk pines are the base's trees. A spec can't pick a tree species (spec trees are always peppermint), so the spec has none.

### Clears

The base clears generated buildings and trees within a landmark's reach: its blocks, paving, fences, awnings and signs, plus 1.5 m. Here that's only the stern castle, so the clear is about **4.8 m** round the stern and the pines stay.

If the hull is ever made blocks for physics, the reach grows to about 15 m and would take out the big pine on the ship's north side and others. That needs a way to clear buildings but keep trees, or a species field for spec trees.

## The Barrel

- **OSM:** node 2771171275, `tourism=artwork`, `name=Barrel`, at 115.3439362,-33.6447522. It was added in April 2014 and never edited, with no artist or material tags.
- **The spot today:** that's the edge of the beach promenade, about 30 m north-west of the playground's middle, by the wall above the sand (`out/refs/sea_play/barrel12_grid.jpg`). The aerial shows a lamp post, a bench-sized pale object and people there, and nothing that reads as a sculpture.
- **No other record:** I found no photo, council page or news item for a "Barrel" artwork on the foreshore. The node predates the foreshore redevelopment and the playground (2017-18), so the work may have been removed or moved. (The playground's crow's nest is a barrel, but it came four years later.)
- **No spec.** Worth Mac checking on the ground. If it's there, a photo would do: a barrel is a short cylinder that the spec can only do as boxes.

## Transition

### What it is

*Transition* (2016) by **Harrie Fasher** (NSW). It's an abstract steel horse rising out of the ground, after an Icelandic myth of a horse that travels between worlds. It won the $50,000 Rio Tinto Sculpture Award at Sculpture by the Sea, Cottesloe 2018, and Rio Tinto gifted it to the City. It was installed on the foreshore in August 2018, the third of three such gifts after *Column of Sound* and *Parallel Thinking Space*.

### Where and how big

- **OSM:** node 12512448707 at **115.3428368,-33.645031** (`artist_name=Harrie Fasher`, `material=metal`).
- **Aerial:** the aerial (`out/refs/transition/transition15_grid.jpg`, 0.029 m/px) shows it right at the node. It stands in a diamond-shaped lawn bed edged with concrete kerbs, just south of a path junction on the foreshore, about 125 m west-south-west of the playground.
  - Its shadow runs about 5.5 m north to south.
  - A pale trapezoid round it, about 4 m wide at the north end, 2 m at the south end and 6 m long, is the line of bollards and wire.
- **Size:** about **6 m long and 4 m high**, from the 2018 installation photo against 1 m timber bollards.
- **Facing:** the head and the reaching foreleg point about **165°** (SSE). The haunches are at the north end, at about 115.342837,-33.645028.
- **Middle (for the looks entry):** **115.3428445,-33.645035**, the small base plate under the haunches.

### What it looks like

- An open frame of **rusted steel flat bar** `#7d4127`, with a few flat plates `#8a4a2b` at the cheek, shoulder and haunch.
- The haunches sit on the grass. The body rears up to an arched neck about 4 m high, and the head bows forward and down.
- One foreleg is folded under the chest. The other reaches about 3.5 m forward, flat along the grass, ending in a hoof.
- Low timber bollards (about 1 m) with a wire round it, and a small sign.

### Spec notes and what needs a Blender layer

- The horse is drawn in side view as bars of 8 to 10 cm in planes across its body, plus ties and plates. Diagonal bars are stepped boxes (0.22 m steps), so up close they look beaded.
- The bollards and wire are an open rail on a rectangle, because spec fences must be axis-aligned. The real line is a trapezoid, and the spec's top rail is heavier than one wire.
- **A Blender layer** should model it properly: twisted, angled flat bar, the curled hoof ring, and the plates at their real angles. It's a prime candidate. It sits off the roads, so it's seen side-on from the path at walking distance.

## Unsure

- **The ship's length.** Measured at 25 m from the aerial. The hull's ends are partly under pine shadow, so ±1.5 m. The mast heights (10 to 12 m) and lean are from photos.
- **Which features are where** in the north-east pool: the tentacle arch positions are indicative, not measured one by one. The navy arch and white fish by the bow are placed from photos only.
- **Ground height:** the playground has mounds. Spec panels sit flat at the centre's height plus 5 to 8 cm, so a panel may float or sink a little where the ground isn't flat.
- **The Barrel:** see above.
- **Transition's heading:** the aerial shadow says about 175° and the photo about 140-150°. I used 165°.

## Sources

- PLAN E, Sea Play on the Bay: https://www.plane.com.au/works/sea-play-on-the-bay and the case study https://www.plane.com.au/case-studies/sea-play-by-the-bay (photos `plane_a..e.jpg`)
- Busselton Mail, "a maritime adventure for all": https://www.busseltonmail.com.au/story/5727489/a-maritime-adventure-for-all/
- Landscape Australia, 2019 AILA award jury citation: https://landscapeaustralia.com/articles/2019-national-landscape-architecture-awards-award-of-excellence-for-play-spaces/
- Buggybuddys, opening-week photos (Oct 2018): https://buggybuddys.com.au/things-to-do/playgrounds-and-parks-in-perth/busselton-foreshore-adventure-play-space/ (`bb_0..9.jpg`)
- Wikimedia Commons, "Busselton Foreshore Adventure Playspace, August 2020 02.jpg" (`commons_play2.jpg`)
- City of Busselton, Sea Play on the Bay: https://www.busselton.wa.gov.au/connect/parks-facilities-and-venues/sea-play-on-the-bay.aspx
- Sculpture by the Sea, "Transition (2016) finds new home in Busselton": https://sculpturebythesea.com/?p=16083 (photo `out/refs/transition/sxs_busselton.jpg`), and the Cottesloe 2018 photo https://sculpturebythesea.com/?p=12809 (`sxs_cottesloe.jpg`)
- Busselton Mail, "a permanent home in Busselton for award winning sculpture": https://www.busseltonmail.com.au/story/5602211/a-permanent-home-in-busselton-for-award-winning-sculpture/
- Busselton-Dunsborough Times, "Final sculpture completes foreshore's outdoor gallery": https://bdtimes.com.au/news/busselton-dunsborough-times/final-sculpture-completes-foreshores-outdoor-gallery-ng-b88936669z
- OpenStreetMap: way 749124328, nodes 2771171275 and 12512448707 (ODbL); Landgate Locate aerial
- Reference files: `out/refs/sea_play/` and `out/refs/transition/`
