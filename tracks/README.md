# Tracks

One folder per track (ROADMAP.md, "generate, freeze, polish"). Each holds:

- `README.md`: what the track is, its tier, its status, what's next.
- `snapshot.json`: the manifest of its frozen inputs (`scripts/snapshot/snapshot.mjs`). The snapshot itself is in the share's `snapshots\` folder, because the imagery licence keeps it out of GitHub.
- `base.json`: the accepted base: when, from which commit and snapshot, and its check numbers (`scripts/upgrade/base.mjs accept`).

The route stays in `routes/` and the landmarks in `routes/landmarks/`. Private tracks, such as the whole map with the estate, keep their folders in `routes/private/tracks/`.

| Track | Tier | Route | 5 m LiDAR |
| --- | --- | --- | --- |
| [Busselton](busselton/README.md) | Showcase | `routes/busselton.json` | Yes |
| [Tuart Drive](tuart_drive/README.md) | Drive-anywhere | `routes/tuart-drive.json` | Yes |
| [Caves Road, Dunsborough to Yallingup](caves_road_yallingup/README.md) | Drive-anywhere | `routes/caves-road.json` | Dunsborough end only |
| [Busselton to Dunsborough](busselton_to_dunsborough/README.md) | Drive-anywhere | `routes/busselton-dunsborough.json` | Yes |
| [Cape Naturaliste Road](cape_naturaliste_road/README.md) | Drive-anywhere (showcase later) | `routes/cape-naturaliste.json` | First 3 km only |
| [Margaret River](margaret_river/README.md) | Drive-anywhere (showcase later) | `routes/margaret-river.json` | No |
| [Caves Road, Boranup](caves_road_boranup/README.md) | Drive-anywhere (showcase later) | `routes/caves-road-boranup.json` | No |
| [Cape Leeuwin](cape_leeuwin/README.md) | Drive-anywhere (showcase later) | `routes/cape-leeuwin.json` | No |
| [Collie Motorplex](collie_motorplex/README.md) | Showcase (blocked: OSRM won't route the raceway) | `routes/collie-motorplex.json` | No |

Where the 5 m LiDAR stops (`STATE_DEMS.wa.box` in `src/services/tiles.ts`, and GA's coverage stops short of that box west of Dunsborough), the build falls back to about 30 m global heights.

## Working on a track

**Polish (landmarks):** edit or add a spec in `routes/landmarks/`, list it in `routes/landmarks/looks.json`. Then run:

```
npx tsx scripts/polish/landmarks.ts routes/<route>.json out/<slug>.zip
```

That takes about 20 s, and its polish zip goes on with `install-track.ps1 -Zip <it> -Overlay`. A new landmark also needs its spot cleared in the base, so it waits for the next base build (or goes in on top of what's there until then).

**Freeze the inputs:**
1. Build once from live data.
2. Run `node scripts/snapshot/snapshot.mjs make <slug>`. This writes this folder's `snapshot.json`.
3. Run `node scripts/snapshot/snapshot.mjs zip out/snapshots/<slug>-<date>`. The zip goes in the share's `snapshots\` folder.

**Upgrade the base** (showcase tracks change only this way):
1. Run `node scripts/upgrade/base.mjs build routes/<route>.json`. It rebuilds from the snapshot, runs every check and compares against the accepted base, writing the result to `out/<slug>.upgrade.md`.
2. Then run `base.mjs accept routes/<route>.json` to keep it, or `base.mjs rollback routes/<route>.json` to go back.

**Drive-anywhere tracks** are simply rebuilt whenever the generator improves (with the same checks). No polish, so nothing to protect. A new one is a route file with `"preset": "country"`, its pins and a `build.origin`; the preset (`scripts/headless/presets.mjs`) fills in the country settings, and anything the route sets itself wins. Flat towns use `"preset": "town"`. The country preset turns on landscape zones (`build.zones`, `src/core/zones.ts`): the tiles' landcover, the distance to the sea and a coarse map of the South West pick the tree species and how many trees, the ground detail mix and the verge colour (coast, capes heath, tuart, jarrah-marri, karri, paddocks, vineyards, wetland). Towns and the foreshore keep their street trees.
