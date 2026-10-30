# Aussie traffic cars

Research only, 30 Oct 2026. Nothing here has been downloaded or tested. The goal is cars you'd
actually see in Busselton (Hilux, Ranger, Corolla, i30, utes towing trailers, caravans) for the
three kinds of traffic in [traffic-test.md](traffic-test.md).

## Short answer

- **AI Flood (Track Day) and AssettoServer traffic use ordinary AC cars** from `content\cars`.
  Any car mod below drops straight in, nothing to convert.
- **CSP's traffic planner can't use AC cars as they are.** It loads its own lightweight models
  (see "The planner's car format" below). An AC car can be converted from its low-detail LODs,
  but each one is a small job by hand.
- **There's no ready-made Aussie traffic pack.** Every free pack I found is Japanese or European
  (made for Shutoko and similar maps). Hilux, Ranger and Commodore/Falcon ute mods exist on their
  own. I found no i30 except the N performance versions, and no towable caravan or trailer.
- **Licences are the weak spot.** Most of these cars are only on rehost sites that name no licence,
  and sometimes not even the author. Keep any of them on our own machines (we never publish builds
  anyway) and never redistribute them, converted or not.

## The planner's car format

From the planner's source (CSP's `acc-lua-internal`, `included-tools/traffic`, by x4fab, CC0):

- Cars are read from `extension\lua\tools\csp-traffic-tool\data\*.json`, one JSON per car, not
  from `content\cars`
  ([CarsList.lua](https://raw.githubusercontent.com/ac-custom-shaders-patch/acc-lua-internal/main/included-tools/traffic/src/simulation/CarsList.lua)).
- Each JSON names three model files in that folder: `main`, `lod` and `collider`. The car is
  skipped if any is missing. Optional fields:
  - `maxSpeed` (km/h, default 120), `chance` (how often it spawns), `color` (`"modern"` or vintage
    paint list)
  - `lights` (mesh names for `headlights`, `rear`, `rearCombined`, `brakes`)
  - `dimensions` (`front`, `rear`, `width`, `wheelRadius`, `turningOffset`, shadow size)
  - `physics` (`mass`, `width`, `length`, suspension)
- The stock data pack is "LOD C and D of a couple of original cars" (Kunos cars). To add one: "use
  those LODs and move all nodes but wheels to a node 'BODY'"
  ([csp-traffic-tool-extended readme](https://github.com/jakzo/csp-traffic-tool-extended/blob/main/readme.md)).
  Data pack download link: in the tool's
  [manifest.ini](https://raw.githubusercontent.com/ac-custom-shaders-patch/acc-lua-internal/main/included-tools/traffic/manifest.ini).
- Our own `src/core/kn5.ts` reads and writes kn5. A script could take a car mod's LOD C kn5, put
  everything but the wheels under `BODY`, and write the JSON. That's possible future work, not
  built.
- 2REAL's free pack ("More Traffic Cars for Traffic Tool", 6 extra cars, a bigger one on Patreon)
  is a modified copy of the tool folder and needs the source cars installed. They're
  Japanese/European, and adding your own cars is "not that easy"
  ([Overtake thread](https://www.overtake.gg/threads/2real-more-traffic-cars-for-traffic-tool-2real.251326/)).
  A paid €1.99 patch fixes planner behaviour; it adds no cars
  ([Gumroad](https://4rthefuture.gumroad.com/l/2real-csp-traffic-planner-patch)).

## Cars found

"Seen at" means the listing I found. Most links go to rehost or aggregator sites (AssettoWorld,
assettocorsamods.io, ModsLab, CrashMods, modhub.us, Modland). Those copy mods from their original
pages, often without saying who made them or whether they may. Wherever I could, I note the real
author. Before using one, look for the author's own page (Overtake/RaceDepartment, GTPlanet
downloads, Patreon or Discord) and get it there. I couldn't open many of these pages (blocked), so
the version, size and quality are unchecked.

### Hilux

| Car | Author | Seen at | Notes |
| --- | --- | --- | --- |
| 1992 Toyota Hilux (complete rework) | not seen (page blocked) | [Overtake](https://www.overtake.gg/downloads/1992-toyota-hilux-complete-rework.71023/) | Original site. Old shape, but plenty still on WA roads |
| Toyota Hilux Revo GRS (2023) | "unknown" per the host | [CrashMods](https://crashmods.com/mods/toyota-hilux-revo-grs-2023-pickup-truck/), [assettocorsamods.io](https://assettocorsamods.io/cars/Pickup/toyota_hilux_revo_grs/) | Current shape (Thai GR Sport). No licence, author unknown: treat as unclear origin |
| Toyota Hilux Arctic Truck | not seen | [AssettoWorld](https://www.assettoworld.com/car/toyota-hilux-arctic-truck), [Modland](https://www.modland.net/assetto-corsa-mods/cars/toyota-hilux-arctic-truck.html) | Lifted. Rehost only |
| Toyota Hilux Revo Z Edition Gazoo Racing | not seen | [AssettoWorld](https://www.assettoworld.com/car/toyota-hilux-revo-z-edition-gazoo-racing) | Rehost only |
| Toyota Hilux Vigo Champ Smart Cab / Single Cab | not seen | [Modland](https://www.modland.net/assetto-corsa-mods/cars/toyota-hilux-vigo-champ-smart-cab.html), [assettocorsamods.io](https://assettocorsamods.io/cars/street/toyota_hilux_vigo_champ_single_cab/) | 2005 to 2015 shape (Thai market name, same as our SR/SR5 of that era). Single cab is a good work ute |

### Ranger

| Car | Author | Seen at | Notes |
| --- | --- | --- | --- |
| Ford Ranger 2015 Wildtrak | Armgarage | [ModsLab](https://modslab.net/en/assetto_corsa/mods/eykftyhfbk/), [modhub.us](https://www.modhub.us/assetto-corsa-mods/ford-ranger-2015-wildtrak-v10), [AssettoWorld](https://www.assettoworld.com/car/ford-ranger-2015-wildtrak) | PX, the most common Ranger here. v1.0, needs CSP. No licence stated |
| Ford Ranger Raptor | brucektrain | [ModsLab](https://modslab.net/en/assetto_corsa/mods/iQe9bedTEN/), [assettocorsamods.io](https://assettocorsamods.io/cars/street/ford_ranger_raptor/) | v1.0, about 49 MB, needs CSP. No licence stated |
| Ford Ranger 3.2 TDCi Wildtrak Street (BWORX) | BWORX | [AssettoWorld](https://www.assettoworld.com/car/bworx-ford-ranger-32-tdci-wildtrack-street) | Lowered "street" version |
| Ford Ranger offroad | not seen | [AssettoWorld](https://www.assettoworld.com/car/ford-ranger-offroad) | Rehost only |

### Corolla

| Car | Author | Seen at | Notes |
| --- | --- | --- | --- |
| Toyota Corolla/Altis SP3 | Patrik Marek (with Bill Wiskins, David Massieux, Abbo90, Fonsecker) | [Overtake / RaceDepartment](https://www.overtake.gg/downloads/toyota-corolla-altis-sp3.13639/) | Original site. Race spec of a sedan, so it needs the wing and livery dropped for traffic. Based on a bought 3dKen model. Author asks people to link, not rehost |
| TPCA Corolla 2021 | not seen (page blocked) | [Overtake](https://www.overtake.gg/downloads/tpca-corolla-2021.34575/) | Original site. Likely a race car, unchecked |
| Toyota Corolla SR5 | not seen | [assettocorsamods.io](https://assettocorsamods.io/cars/street/toyota_corolla_sr51/) | Probably an old (KE/AE) SR5, unchecked |

No current (E210) Corolla hatch road car found.

### i30

Only the performance versions: Hyundai i30 N Performance, i30 Fastback N, i30 N "Gray Rims"
([Modland](https://www.modland.net/assetto-corsa-mods/cars/hyundai-i30-n-performance.html),
[ModsLab](https://modslab.net/en/assetto_corsa/mods/KBHnZy9AQB/)), plus TCR race cars. From a
distance an i30 N looks like an ordinary PD i30 hatch, so it would pass as traffic in a plain paint
with smaller wheels. No author or licence seen.

### Utes (Commodore and Falcon)

| Car | Author | Seen at | Notes |
| --- | --- | --- | --- |
| Holden Commodore VY SS ute | not seen | [AssettoWorld](https://www.assettoworld.com/car/holden-commodore-vy-ss-ute), [assettocorsamods.io](https://assettocorsamods.io/cars/street/holden_commodore_vy_ss_ute/), [Modland](https://www.modland.net/assetto-corsa-mods/cars/holden-commodore-vy-ss-ute.html) | v2.1 per Modland. Also a "tuned" version |
| Holden Commodore VU ute v2 | not seen | [Modland](https://www.modland.net/assetto-corsa-mods/cars/holden-commodore-vu-ute.html) | |
| Holden Commodore Ute 2003 (Burnout / Hoonigan) | not seen | [CrashMods](https://crashmods.com/mods/holden-commodore-ute-2003-burnout-aussie-smoke-machine/), [AssettoWorld](https://www.assettoworld.com/car/holden-commodore-ute-2003-hoonigan) | Burnout build, not traffic |
| Ford Falcon BA XR6 Turbo / FGX XR6 Turbo (sedans) | not seen | [AssettoWorld BA](https://www.assettoworld.com/car/ford-falcon-ba-xr6-turbo), [AssettoWorld FGX](https://www.assettoworld.com/car/ford-falcon-xr6-turbo-2015-fgx) | Sedans. No Falcon ute found |
| 2005 Ford BA MkII Falcon | not seen | [acsupply](https://www.acsupply.cx/mod/117) | Sedan |

Also worth a look: Izaiah's free bundle of Australian street cars, shown in
["The Best FREE Aussie Street Cars"](https://www.youtube.com/watch?v=wlU_iAEzx7E). It's given away
through his Patreon (xizaiah) and Discord, with links in the video description. The car list and
licence are unchecked. Older index:
[Steam thread on Aussie cars](https://steamcommunity.com/app/244210/discussions/0/2263564102373798769)
(V8 Supercars, the Australian Vintage Race Pack, and Assettoland's Holden and Ford lists).

### Trailers and caravans

None found. Plain AC can't tow: there's no hitch in its physics. "Caravan 78" and "Chevrolet
Caravan" are Brazilian Chevrolet wagons, not caravans. Ways round it:

- **Planner traffic:** a planner car is just a model moving along a lane, with collisions. A ute
  and trailer could be one rigid model with a long `dimensions.rear`. It would look wrong in tight
  turns (the trailer can't swing) but fine on straights and big roundabouts. Same for a 4WD towing
  a caravan.
- **Scenery:** parked caravans and boat trailers as props in driveways and the caravan parks. That
  belongs with the track's own scenery (kerbside parking).

## Traffic cars for AI Flood and AssettoServer

Ordinary road cars work, but AI tries to race a car with lots of grip and power. Packs made for
traffic ("traffic_mod" cars) have the power and AI tuned for cruising:
[Steam discussion](https://steamcommunity.com/app/244210/discussions/0/3819663388893459328). The
Shutoko traffic car pack on the SRP Discord is the best known; it's Japanese cars. For Aussie cars,
the simplest fix is in our hands: a lower AI level (75 to 85) and the free roam's speed hints (see
traffic-test.md) keep any of the cars above at town speed.

## Suggested next steps

1. On the workstation, try two or three of the cars from the authors' own pages (PX Ranger,
   Vigo/Revo Hilux, VY ute) in AI Flood on Free Roam. Check they drive sensibly with AI (some mods
   have poor AI data).
2. If they're good, write a converter (kn5 LOD C → planner `BODY` model + JSON) and keep the
   converted cars local, in the share. Never commit them.
3. If a car (or a conversion of it) ever has to leave our machines, ask its author first.
