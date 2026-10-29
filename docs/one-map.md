# One Busselton map: the plan

One track folder with the town centre, the Foreshore and a residential estate, the roads between them, and several layouts. Tuart Drive stays its own track. (Roadmap, Phase 3.)

## Why it isn't one map yet

- The builder makes one route at a time: the road and a strip of ground, photo and buildings either side of it (the corridor). A whole-estate build is a loop with a 180 m corridor, which only reaches streets within 180 m of the loop.
- Separate routes overlap (the Foreshore and town loops share Queen St and Marine Tce), so building them separately and gluing them together would build those streets twice.
- AC loads the whole map at once.

## What fits (29 Oct builds, against `scripts/check/budget.ts` limits for the RTX 4060)

| | Triangles | Draw calls | Video memory | kn5 |
| --- | --- | --- | --- | --- |
| Town loop | 444k | 521 | 66 MB | 53 MB |
| Foreshore | 773k | 1,107 | 96 MB | 87 MB |
| Estate | 727k | 971 | 169 MB | 172 MB |
| **Sum** | **1.94M** (limit 1.5M) | 2,599 (limit 4,000) | 331 MB (limit 1,500) | 312 MB (limit 600) |
| Tuart Drive (separate) | 1.25M | 1,922 | 190 MB | 218 MB |

The town and Foreshore overlap, and the linking roads add some back, so a combined map lands around 1.8 to 2M triangles: over. Everything else fits. So the combined build needs detail thinned where nobody drives: a coarser terrain grid and fewer trees and houses away from the streets (the terrain is the biggest group in every build).

## Steps

1. **Area builds from a boundary.** Build every street inside a polygon (from a route file: `area: [[lng, lat], ...]`), not a corridor round one route. Every street is road (`1ROAD`, valid track) rather than a side street. Ground, photo and scenery cover the polygon; the horizon starts at its edge.
2. **Layouts.** The shared world goes in one kn5 with no start, pit or timing dummies. Each layout gets a small kn5 of its own with its dummies (and any layout-only walls), listed with the shared one in `models_<layout>.ini`, plus `<layout>/ai/fast_lane.ai`, `<layout>/data/*` (surfaces, AI hints, map, cameras, challenges) and `ui/<layout>/ui_track.json`. Layouts: the Foreshore circuit, the town loop, the estate loop, and free roam.
3. **Spawn points.** Free roam's grid and pit spots in real car parks (the foreshore, the shopping centre, the jetty), so you can start anywhere.
4. **Traffic** over the whole network (it already builds from every street the track has).
5. **A budget pass** on the combined build: coarser terrain and thinner scenery away from the streets until it's under 1.5M triangles.

The estate stays private (`routes/private/`), so the combined map's route file does too, and its builds never go anywhere public.
