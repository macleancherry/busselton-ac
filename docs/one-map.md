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

Estimated from the separate builds, a combined map looked over. Built for real as one area (29 Oct) the Foreshore and town come to 1.26M triangles, inside the limit: they overlap, and an area build has no duplicate corridor ground. The estate on top will need detail thinned where nobody drives.

## Steps

1. ✅ **Area builds from a boundary** (29 Oct). `build.area: [[lng, lat], ...]` in a route file builds every street inside the polygon, with ground, photo, trees, fences and houses over all of it, and the streets count as track (`STREET` is `IS_VALID_TRACK=1`). Inside the area the streets come from OSM itself (Overpass) rather than the map tiles, whose lines can sit 10 to 20 m off and leave a street out. Code: `src/core/area.ts`. Streets away from the route aren't traced from the photo yet; they follow OSM's centre lines and widths by class.
2. ✅ **Layouts** (29 Oct). `layout: { id, name }` names the route's own drive; `layouts: [...]` adds more, each `{ id, name, pins, loop? }` (a route over the world's roads) or `{ id, name, spawns: [{ at: [lng, lat], heading }] }` (free roam). The world goes in `<slug>.kn5` with no dummies; each layout gets `layout_<id>.kn5`, `models_<id>.ini`, `<id>/ai`, `<id>/data`, `<id>/map.png` and `ui/<id>/`. Extra layouts are laid on the world's own road surface (`src/core/layouts.ts`). Check with `npx tsx scripts/check/layout_check.ts out/<slug>.zip`: spawns on the road, AI lines on the road. The test run takes `-Layout <id>`.
3. 🔨 **Spawn points.** Free roam has spawns on the streets round the Foreshore and town. Still to do: real car parks (the foreshore, the shopping centre, the jetty).
4. ✅ **Traffic** over the whole network: it builds from every street the world has, and every layout shares it.
5. **Budget.** First combined build (Foreshore and town centre as one 1.9 x 1.1 km area, three layouts): about 1.26M triangles, 2,200 draw calls, 120 MB video memory, 142 MB kn5: within the RTX 4060 limits without a thinning pass. Adding the estate will need one.
6. ⬜ **Roundabouts on every street.** Only the main route's roundabouts are built as rings; on the other streets the roads cross straight through. The town layout's AI goes round three of them on bare street (about 5% of its line off the road in `layout_check.ts`). Next job for area builds.

The first one-map route is `routes/busselton.json` (public: the Foreshore and town centre). The estate stays private (`routes/private/`), so a map with it in does too, and its builds never go anywhere public.
