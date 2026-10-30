# External review: is ac-track-builder still the right base?

31 October 2026. An independent review requested by Mac, for the agent building Busselton AC to consider. It is advice, not instructions: check each claim against the code before acting on it, and push back where it's wrong.

## The question

The project has moved on from "turn a real road into a track" to "the South West as a set of maps where every street is drivable, with traffic and polished landmarks". Renders still show persistent problems:

- roundabouts and junctions that don't join cleanly
- parked cars on roads
- objects floating above or sunk into the ground

So: is the fork of honestjams/ac-track-builder still the right foundation? Is there something more complete to build on? And how does it compare with Street2Sim?

## Summary

0. **Upstream is a source of ideas, not a partner.** Its owner has moved on to other projects. Stop designing around clean merges (untouched upstream docs, long-lived PR branches) and work towards owning all the code (see Owning the code). This means changing the Upstream section of `CLAUDE.md`. It currently says to take general features from upstream by merging, and to fetch and merge after every piece of work. Replace that with: look at upstream occasionally, take ideas, and write the code fresh. Don't merge upstream code into files we've rewritten.
1. **Keep the fork. Don't restart.** No free or open tool does more of what this project needs. The fork's own work is the valuable part, and nothing on the market has it: the kn5 writer, AI lines and tests, CSP traffic lanes, the build checks, landmark layers, challenges, and WA LiDAR with Landgate imagery.
2. **Rebuild the road core.** The generator is route-first: one ribbon along the route, with side streets and roundabouts stitched on. The new goal is network-first. Most of the junction artefacts come from that mismatch, and adding features on top won't fix them.
3. **Put one surface in charge of all heights.** Scenery heights come from several different height functions, and only some of them know about the road meshes that were actually built.
4. **Pause new features** until steps 2 and 3 are done and benchmarked.

## Findings from the code

These are hypotheses with code references. Verify each one before you act on it.

### F1. Junctions are stitched, not modelled

- `src/core/sideStreets.ts`: side streets "are cut away where they overlap the route itself, and are draped on the terrain". Where one meets the route, it's extended to the route's edge and the verge opens up for the junction mouth.
- `src/core/roundabout.ts`: the ring is an annulus. "The road ribbon stops at the ring and short connector pieces join the two."
- Grade-separated roads are left out entirely.

There's no single junction surface anywhere: every junction is two or three meshes meeting, each with its own height rule (route `surfaceHeight` with crown and bank, side streets draped on terrain, the ring at `hc`). Seams, lips and steps at junctions follow directly from that. The checks (`surface_check.py`, `street_ground.py`) catch symptoms one at a time. Each recent fix ("ground kept under return fills at street mouths", "roundabout lip", "dip at roundabout entries") is a patch on the same root cause.

### F2. Scenery heights come from several sources, and most don't see the road meshes

In `src/core/track.ts`:

- `ground` is the analytic terrain (`terrainAt(x, y).h`).
- `onMesh` (`meshTop` in `terrain.ts`) rebuilds the **terrain grid** surface. It doesn't read the road, kerb, side-street or roundabout meshes.
- Paths, car-park lights, parked cars and signals all use `Math.max(ground, onMesh)`: terrain only.
- Signals use the route's own `surfaceHeight` near the route, and fall back to `ground + 0.1` everywhere else, including side streets and roundabouts.
- Trees and trunks use `ground`.
- Buildings use `ground` in the corridor and the horizon mesh minus 0.6 m beyond it.

Wherever a road was flattened, cut in or raised (`terrainUnderRoad`, crown, kerbs, flat roundabouts), terrain height and road height disagree. Anything placed by terrain height will float or sink there by that difference.

`landmarkGround.ts` already does this properly. It reads the base's physics meshes, then nearby physics ground, then the horizon mesh, then the DEM. That approach should become the rule for all scenery.

### F3. Parked cars come from photo detection, with a ratio filter

`carpark.ts` decides a detection is a parked car using pixel ratios against the asphalt and paint masks (for example, `road / border < 0.65`). Nothing checks the final position against the built road polygons and lanes. `traffic_check.py` checks lanes for parked cars, but by then it's reporting the problem, not stopping it.

### F4. The work has gone into features more than foundations

There are about 28k lines of TypeScript and 106 commits, mostly recent. The roadmap's latest items (waving flags, the jetty train, track sounds, Pure haze) all sit on a base whose junctions still show artefacts in renders. That's reasonable for a fun project. But every feature added now gets placed on a surface that will change.

## The alternatives

| Option | What it is | Cost / licence | Fit |
| --- | --- | --- | --- |
| **Keep the fork** | Route-first browser generator, heavily extended | Free; upstream code unlicensed | Best overall. Needs a new road core |
| **Worldlaps** (worldlaps.com) | Windows app that builds a whole drawn area (streets, buildings, terrain). Claims all of Formentera (120 km², 15.5M triangles) at 120 fps, with junctions, roundabouts and bridges as on the real road | Proprietary. Free up to 1 km², €19 for the full version. Pre-launch, with a waitlist | Closest to the new goal, but closed, unverified and not free. Use it as a benchmark, and maybe for drive-anywhere bases |
| **Street2Sim** | Paid service: pins on a road, built on a remote rig, emailed zip. Also small area builds | $5/km sliding to $2/km, or $49.99/month. Closed | Route-based. Avoids most junctions by design |
| **osm2streets** (a-b-street) | Rust library (JS and Python bindings) that turns OSM into lane and intersection polygons. Handles dual carriageways, dog-legs and complex junctions | Open source. API "not stable yet"; activity has slowed | The strongest candidate for the new road core, or a reference for writing one |
| **OSM2World** | Java tool, OSM to 3D (roads with junctions, buildings, terrain), exports glTF | Open source, actively maintained (FOSDEM 2026 talk) | Partial. Its junction and road surface code is worth studying or using; its terrain is SRTM-grade |
| **Race Track Builder** | Desktop track editor with intersections, AC export | Paid (Steam), Google Maps billing for imagery and heights | Manual. Wrong fit for automated regional builds |
| **Blender + Blosm / Roadscape** | OSM roads into Blender, then into kn5 | Cheap or paid add-ons | Higher quality ceiling, mostly manual. Fine for showcase polish, not for bases |

Nothing open and free gives a more complete starting point than what this fork already is.

## Versus Street2Sim

- **Ahead:** traffic lanes and density zones, landmarks as layers, challenges, automatic AI tests, CSP and Pure config, cost (free). Terrain too: this repo's own research notes (`docs/how-street2sim-works.md`) say Street2Sim uses Copernicus DEM outside the US, about 30 m, against our 5 m LiDAR.
- **Unknown:** how good the core road surface looks. There are no independent reviews. Street2Sim builds single routes, so it hits far fewer junctions than our whole-area builds.
- **How to settle it:** buy one build of about 3 km that overlaps the Busselton Foreshore track (roughly US$15). Render both with `render_track` and compare the same views in game.

## Recommendations, in order

1. **Benchmarks first (a day or two).** Pick five fixed views: a two-lane roundabout, a T-junction on a slope, a kerbed side street, a car park, and a street with poles and signals. Render them now as the baseline. Add the Street2Sim build and a Worldlaps free-tier build of the same 1 km² of town when available.
2. **One surface for all heights.** After the base is built, place everything (paths, lights, signals, poles, trees, parked cars, buildings) by sampling the built physics meshes, the way `landmarkGround.ts` does. Delete the per-feature height rules. Add a check that fails the build when any object's base is more than about 5 cm off that surface. This is small, and it should remove most of the floating and sunk objects.
3. **Parked cars against the built roads.** Drop any car whose footprint overlaps a traffic lane or roundabout polygon after the build. Keep the photo filter as the first pass.
4. **A network-first road core** (the big one). Build the road network as a graph: roads between nodes, and each junction as its own polygon (lane-level where OSM supports it). Give every junction one height field, blended from the roads that meet there, then build road, kerb and verge meshes from that, so the route becomes just a path through the network. Either use osm2streets through its JS or Python bindings, or write our own on its model. Try it on one roundabout and one T-junction against the benchmarks before replacing anything. AI lines, traffic lanes and layouts should then come from the same graph, which also fixes how traffic lanes overlap at junctions.
5. **Then resume features.** Landmarks and polish carry over, because they sit on fixed coordinates (the generate, freeze, polish strategy still holds). Rebuild the frozen bases once with the new core, using the base-upgrade process (A3).

## Owning the code (a long-term goal)

Upstream has no licence and isn't expected to add one, so legally the fork has no clear right to change, share or sell it. The goal over time: **no upstream code left**, so Busselton AC is ours to use however we want, commercially included. Image and data licences are a separate problem, for later.

**Done (31 Oct 2026).** The fork's own code is now under the PolyForm Noncommercial License 1.0.0 (`LICENSE`): free for anyone to use non-commercially, with commercial rights kept by Mac. Upstream-derived files are excluded and listed in `UPSTREAM-FILES.txt`, which `scripts/provenance/upstream_overlap.py` generates. Rerun it with `--write` after each rewrite, and keep the list accurate: anything on it isn't ours to license.

**Where it stands (31 Oct 2026).** About 39% of the fork's meaningful code lines (13.6k of about 35k) still match upstream line for line, across 96 upstream-derived files (tests and config included). The heaviest:
- `kn5.ts`, `road.ts`, `markings.ts`, `raceDress.ts`, `footpaths.ts`, `frontage.ts`, `photoSurface.ts`: 100%
- `buildings`, `buildingStyles`, `textures`, `kerbs`, `ui/main`, `trace`: 95–99%
- `track.ts`: about 51%

Mac's four PRs merged upstream are his own work and don't count against us.

**The rules:**
1. **Rewrite, don't edit.** Copyright protects the code as written, not the ideas or file formats. Replace each upstream module with a fresh implementation.
2. **Spec first, then a separate build.** One session reads the old module and writes a behaviour spec into `docs/specs/`: inputs, outputs, edge cases and the file format, with no code in it. A different session writes the new module from that spec and the public format notes, without the old file open. Tests are written fresh from the spec too.
3. **Delete before you rewrite.** Anything we don't use goes, not gets rewritten. The likely list: race-day dressing, sponsors and the browser UI, if headless builds are all we use. Check this with Mac first.
4. **Track provenance.** `scripts/provenance/upstream_overlap.py` measures how much of the code still matches upstream, overall and file by file. Add it to CI as a report. Make every rewrite take a file off `UPSTREAM-FILES.txt`. It's also the progress number for this goal.
5. **Start clean history at the end.** Once the script reports 0%, start a new repo (or orphan branch) with fresh history, so the upstream code isn't carried along in old commits.

**The order:** go with the roadmap, not against it.
1. The road core (recommendation 4 above). It replaces `road`, `roadMesh`, `sideStreets`, `roundabout`, `kerbs`, `markings` and `trace` anyway.
2. Placement and scenery (recommendation 2): `scenery`, `furniture`, `footpaths`, `utilities`.
3. The AC file writers: `kn5`, `aiSpline`, `dds`, `png`, from the community's format documentation.
4. Buildings and textures.
5. The `track.ts` pipeline itself, last.

**Caveats.** This isn't legal advice: get an IP lawyer to look at it before selling anything. And whether code written mostly by AI can be copyrighted is unsettled. That doesn't stop us using or selling it, but it may limit stopping others copying it.

## What not to do

- Don't move to Blender hand-modelling for the bases. It throws away AI, traffic and the checks, and it doesn't scale to a region.
- Don't restart on a closed tool. Worldlaps or Street2Sim output could be a base for drive-anywhere tracks at most, and only after the benchmark.
- Don't keep patching individual junction artefacts with more special cases.

## Sources

- honestjams/ac-track-builder: https://github.com/honestjams/ac-track-builder
- Worldlaps: https://worldlaps.com/en/
- Street2Sim: https://www.street2sim.com/
- osm2streets: https://github.com/a-b-street/osm2streets
- OSM2World (FOSDEM 2026): https://fosdem.org/2026/schedule/event/osm2world_3d_rendering_openstreetmap_data
- Race Track Builder: https://store.steampowered.com/sub/73739
- This repo: `src/core/track.ts`, `sideStreets.ts`, `roundabout.ts`, `terrain.ts` (`meshTop`), `landmarkGround.ts`, `carpark.ts`, `docs/how-street2sim-works.md`
