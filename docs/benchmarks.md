# Benchmarks

Five fixed places on the Busselton map, rendered and measured the same way every time, so a change to the road core or to how things are placed can be judged against a baseline (recommendation 1 of docs/external-review-2026-10-31.md).

| Site | What it's for |
| --- | --- |
| `roundabout` | The busy Bussell Hwy roundabout (the map has no two-lane one): seams where arms meet the ring, island planting |
| `t_junction` | The steepest T-junction in town (about 1.5 m of fall within 30 m): overlapping road meshes, kerb returns |
| `side_street` | A kerbed street with a row of kerbside parking: kerbs, gutters, cars' wheels on the road |
| `car_park` | A town centre car park: cars in bays, the car park surface |
| `signals` | A signalised crossroads: signal and light poles, heads, junction seams |

Each site has an overview and one or two close-ups: 15 views in all, listed with what to look for in `benchmarks/views.json`. Don't move a view once a baseline exists; add a new one.

## Run it

```
BLENDER=<blender or a Python with bpy> npx tsx scripts/check/benchmark.ts out/busselton.zip --label <label>
npx tsx scripts/check/benchmark.ts compare busselton <labelA> <labelB>
```

The first writes `out/benchmarks/busselton/<label>/`: a PNG per view, `sheet.png` (every view grouped by site, its numbers under it), `metrics.json` and `metrics.md`. `--no-render` redoes only the numbers; `--only roundabout,signals_lamp` limits it to some sites or views. The renders take about 15 minutes on the cloud workspace (Cycles, 16 samples, 960x540), so run them under the heavy lock there.

`compare` writes `out/benchmarks/busselton/compare/<A>_vs_<B>.png` (the two labels side by side, view by view) and prints the numbers that moved.

Label each run with what it is and the date, for example `baseline-2026-10-31` or `network-core-2026-11-12`. The baseline is `baseline-2026-10-31`, from the build of 30 Oct.

## The numbers

Measured within each view's `radius` of its `focus`, from the zip's own physics meshes (`scripts/check/dump_surface.ts` output; `out/<slug>.surface.json` is reused when it's newer than the zip):

- **Steps**: neighbouring drivable points 25 cm apart whose heights differ by more than 3 cm. Kerbs aren't drivable here, so their intended step doesn't count. This is the jolt at a seam.
- **Lips**: points with two drivable meshes 1 to 25 cm apart: overlapping road meshes, which show as z-fighting and a lip across the lane.
- **Floating / sunk**: each parked car, pole, light, signal, guidepost, verandah post and tree (split out of the base's merged meshes; landmark layers aren't measured) against the highest physics surface under its base. More than 5 cm up is floating. Down counts as sunk for cars at 5 cm; posts, poles and trunks are planted on purpose (20 to 80 cm), so for them only more than 1 m down counts.
  A lamp head with no pole or arm joined to it is its own kind, `lamp head`, and shows as floating about 8 m up.
- **In the road**: trees, poles and posts standing on a drivable mesh.
- **Cars on**: what surface each parked car stands on (route road, street, roundabout, grass, path); cars overlapping another car (oriented footprints overlapping by more than 10 cm); and how many are within 1.6 m of a traffic lane.

Code: `scripts/check/benchmark.ts` (the run), `scripts/check/benchmarkLib.ts` (the numbers, tested in `test/benchmark.test.ts`).

## Still to add

The review also asks for a Street2Sim build and a Worldlaps free-tier build of the same square kilometre of town, rendered from the same views, when they're available.
