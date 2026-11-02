# Cape Leeuwin visitor centre and cafe

## What it is

The north keepers' cottage of 1896 (the granite one, nearest the car park) is now the lighthouse's visitor centre: the interpretive centre, the gift shop and the ticket desk inside, and the Cape Leeuwin Lighthouse Cafe in its enclosed verandah. A timber deck with a white balustrade runs along its north side, where the path from the car park arrives, and down the east side to steps.

The cottage itself is in the keepers' cottages spec (`cape_leeuwin_cottages.json`). This spec adds the cafe enclosure under its north eave, the signs and the deck. It is built to stand under that spec's roof, so keep the two together.

Route: **cape-leeuwin.json**. Looks file: `routes/landmarks/cape_leeuwin_looks.json`.

## Footprint

From the Landgate aerial `out/refs/cape_leeuwin_gate/gate.jpg` (centre 115.1362,-34.3720, half 45 m) and the cottages spec.

- **Enclosure:** the strip between the cottage's north wall and its eave line, 16.6 x 2 m. Middle **115.136409, -34.372146** (the spec's centre).
- **Deck:** 20 x 2.5 m along the north side past both corners, and 2.2 m wide down the east side for 9.4 m, with a gap for the steps.
- **Facing:** the spec's front faces bearing **0°** (north, to the car park). Its axes match the cottages spec's.

## Walls and roof

- Enclosure: cream sheet `#ECE6D6`, glazed on three sides, under the cottage's grey pyramid roof (no roof of its own).
- Deck: grey-brown timber `#8D7A62`; balustrade white `#F2EFE6`.
- Signs on the enclosure's fascia: "LIGHTHOUSE CAFE" and "VISITOR CENTRE", plain cream lettering on dark blue `#24384A`.

## What a driver sees

At the end of the car park, through the gate and across the lawn: the grey-roofed cottage with its glazed verandah, signs and deck facing you.

## Approximations

- The enclosure's height is set so its top meets the cottage roof's eave line: the cottages' slab is 13.60 m and this spec's 13.84 m in the current build. After a rebuild with different ground, recheck that the enclosure still sits under the roof.
- The deck is a block 0.3 m high over a plinth. No tables: spec tables stand on the ground, not on a deck.
- The build's ground here (30 m fallback heights) falls about 2.7 m from the path west of the cottage to its east side, far steeper than the real ground. The deck's west end and the cottage's west wall sink into the slope, and the east side stands on plinths. That's the same for the cottages spec. Better heights, or levelled ground under landmarks, would fix both.

## Unsure

- Which sides of the verandah are enclosed (north assumed) and the window layout.
- Whether the deck is at floor level or lower; its real height above the ground.
- The signs' wording and colours.

## Sources

- Landgate Locate aerial; Mapillary (bob3bob3, 2019, reference only); OpenStreetMap (Visitor Centre and Cape Leeuwin Lighthouse Cafe nodes)
- Margaret River Region, Cape Leeuwin Lighthouse (interpretive centre "set within an original lightkeepers' cottage", reviews of the cafe on its enclosed verandah): https://www.margaretriver.com/stories-new-interpretive-centre-cape-leeuwin-lighthouse/
- Heritage Council inHerit, Cape Leeuwin Lighthouse precinct: https://inherit.dplh.wa.gov.au/public/inventory/printsinglerecord/7f85a6ae-2b40-4efd-8189-22f40df1a0c7
