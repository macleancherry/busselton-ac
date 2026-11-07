# Caves Road, Boranup

**Tier:** drive-anywhere base (Boranup a showcase later, with 3D karri). **Route:** `routes/caves-road-boranup.json`. **Build:** `out/caves_road_boranup.zip`.

Caves Road (Tourist Drive 250) south of Margaret River, from near Mammoth and Lake caves through the Boranup karri forest to just south of where Boranup Drive comes back in. Point to point, about 16 km, sealed and winding.

## Status

- **Built** 2 Nov; every check passes, 1.24M triangles (the karri is dense).
- **Landmarks:** CaveWorks and the Lake Cave visitor centre (two specs, `routes/landmarks/caves_road_boranup_looks.json`), on a landmark patch of detailed ground (`build.area`). Added 7 Nov, after the 2 Nov build: the next base build adds the patch and clears the generated building there.
- **Heights:** not on GA's 5 m LiDAR; about 30 m global heights.
- **Roadsides:** no farm gates or mailboxes (`farmRoadsides: false`): the tracks off this stretch are national park 4WD tracks.
- **Boranup Drive** (the unsealed limestone scenic drive just west) is its own track: [Boranup Drive](../boranup_drive/README.md), `routes/boranup-drive.json`.
- **In game:** not driven yet; one AI run in retest 6.

## Next

1. Drive it with Boranup Drive; later they could be two layouts on one map.
