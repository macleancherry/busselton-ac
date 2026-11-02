# Margaret River

**Tier:** drive-anywhere base (showcase later, landmark by landmark). **Route:** `routes/margaret-river.json`. **Build:** `out/margaret_river.zip`.

The main street: Bussell Highway into town from the north-east, south through the shops past the visitor centre and the Wallcliffe Road roundabout to the river. Point to point, about 2 km. A small area build (about 0.9 by 1.4 km) around it makes every street in the town centre drivable, like Busselton's one map. Town preset (no banking, fine terrain grid), with traffic.

## Status

- **Built** 2 Nov; every check passes, 1.07M triangles. A pin by the visitor centre snapped into a side lane, so there's no pin between the Carters Road corner and the Wallcliffe roundabout.
- **Landmarks** ([docs/landmarks.md](../../docs/landmarks.md), audit in [docs/plans/margaret-river-places.md](../../docs/plans/margaret-river-places.md)): 9 specs (`routes/landmarks/margaret_river_looks.json`): the Margaret River Hotel, the Visitor Centre, Settlers Tavern, the ITC store, and since 2 Nov the Good Olive building and Dome, the Fearn Avenue town square, Bridgefield, the NAB building and the Morries block. Rotary Park is a Blender layer (`routes/layers/margaret_river/`).
- **Heights:** not on GA's 5 m LiDAR. The river valley is on about 30 m global heights, so check the main street's slope and the bridge.
- **In game:** not driven yet; one AI run in retest 6.

## Next

1. A drive; the landmarks seen in game.
2. Later: a loop layout through the town, and more landmarks from the audit.
