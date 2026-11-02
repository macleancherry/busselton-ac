# Caves Road, Yallingup to Wilyabrup

**Tier:** drive-anywhere. **Route:** `routes/caves-road-wilyabrup.json`. **Build:** `out/caves_road_yallingup_to_wilyabrup.zip`.

Caves Road (Tourist Drive 250) south from Yallingup, where [Caves Road, Dunsborough to Yallingup](../caves_road_yallingup/README.md) ends, along the ridge through peppermint, marri and vineyards to Wilyabrup. Point to point, about 16.5 km. The first half of Caves Road from Yallingup to Margaret River: 35 km is too long for one track's triangle budget, so [Wilyabrup to Margaret River](../caves_road_wilyabrup_to_margaret_river/README.md) carries on from here.

## Status

- **Route ready**, first build pending. All pins on Caves Road, mid-block; OSRM routes it as one road, no U-turns.
- **Heights:** not on GA's 5 m LiDAR; about 30 m global heights.
- **Budget:** Tuart Drive at 16.8 km came to 1.33M triangles, so it should fit. If `budget.ts` fails, set `build.terrainStep` to 3.

## Next

1. First build and checks.
2. A drive.
3. Rebuild when better heights arrive.
