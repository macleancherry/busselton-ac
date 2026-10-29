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

1. ✅ **Area builds from a boundary** (29 Oct). `build.area: [[lng, lat], ...]` in a route file builds every street inside the polygon, with ground, photo, trees, fences and houses over all of it, and the streets count as track (`STREET` is `IS_VALID_TRACK=1`). Inside the area the streets come from OSM itself (Overpass) rather than the map tiles, whose lines can sit 10 to 20 m off and leave a street out. Code: `src/core/area.ts`. Streets away from the route are traced from their own aerial photo (zoom 19), like the route's side streets.
2. ✅ **Layouts** (29 Oct). `layout: { id, name }` names the route's own drive; `layouts: [...]` adds more, each `{ id, name, pins, loop? }` (a route over the world's roads) or `{ id, name, spawns: [{ at: [lng, lat], heading }] }` (free roam). The world goes in `<slug>.kn5` with no dummies; each layout gets `layout_<id>.kn5`, `models_<id>.ini`, `<id>/ai`, `<id>/data`, `<id>/map.png` and `ui/<id>/`. Extra layouts are laid on the world's own road surface (`src/core/layouts.ts`). Check with `npx tsx scripts/check/layout_check.ts out/<slug>.zip`: spawns on the road, AI lines on the road. The test run takes `-Layout <id>`.
3. ✅ **Spawn points** (30 Oct). Free roam starts in the ten biggest car parks (the middle of each one's longest aisle, from OSM's parking aisles, at least 180 m apart).
4. ✅ **Traffic** over the whole network: it builds from every street the world has, and every layout shares it.
5. ✅ **Budget.** The Foreshore and town as one area: about 1.28M triangles, within the RTX 4060 limits as built. The private whole map (adding the estate and the Home Run between) came to 1.71M; it fits at 1.31M with a 2 m terrain grid (`build.terrainStep: 2`; kerb-edge steps unchanged at a 17 cm median), a 1 km horizon (`build.horizon: 1000`) and looser ground far from the route (`build.terrainLodFarTol: 0.15`; the ground stays tight within 4 m of every street). The terrain is still the biggest group, then the horizon and the parked cars.
6. ✅ **Roundabouts on every street** (30 Oct). Rings inside an area are built like the route's own, and side streets run on to the ring's edge. The town layout's AI line is now fully on the road.
7. ✅ **Several polygons** (30 Oct): `build.area` can list several, so two suburbs join along the route between them (the private whole map: the estate, and the Foreshore and town, joined by the Home Run).
8. ✅ **A map in the game** (30 Oct): the Busselton Map app (`apps/lua/BusseltonMap`) shows every street with you and the other cars on it, from the `extension/street_map.png` each build ships.

The first one-map route is `routes/busselton.json` (public: the Foreshore and town centre). The estate stays private (`routes/private/`), so a map with it in does too, and its builds never go anywhere public.
