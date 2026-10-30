# Boranup Drive

**Tier:** drive-anywhere base (a showcase later, with the karri). **Route:** `routes/boranup-drive.json`. **Build:** `out/boranup_drive.zip`.

The graded limestone scenic drive through the Boranup karri forest, just west of Caves Road south of Margaret River. Point to point, north to south, about 13.5 km of gravel, from just off Caves Road near Allan Road to just before it rejoins Caves Road at the southern end.

## Status

- **Route:** ready, not built yet. OSRM won't route it, so the centreline comes from the OSM way (`"ways": [31541578]`, one way, both ends on Caves Road). Checked offline: the three pins route 13.47 km along it, north to south.
- **Surface:** forced unsealed end to end (`build.unsealed`): gravel physics, gravel texture, no line markings or kerbs.
- **Settings:** country preset, with no banking, no Armco, no farm gates or mailboxes (the side tracks are national park 4WD tracks) and no traffic.
- **Heights:** not on GA's 5 m LiDAR; about 30 m global heights. Check the grades over the ridges.
- **Width:** OSM has no width tag, so it takes the 6.5 m default. The real road is narrower in places.

## Next

1. Build, then the usual checks (centreline, surface, budget); look at the karri density and the budget.
2. A drive: does the gravel grip feel right, and do the 30 m heights make it lumpy?
3. Later: a layout on one map with Caves Road, Boranup ([Caves Road, Boranup](../caves_road_boranup/README.md)).
