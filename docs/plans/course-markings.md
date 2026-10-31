# Course markings for the race layouts: the plan

Mac, 31 Oct: in the race layouts (town, sights, foreshore) it's too hard to tell which way the course goes at each junction and roundabout, and where it starts. Free roam is fine as it is. He wants something low-key that shows the way, "maybe even just red and white ripple strips".

Renders: `out/course_marks/before.png` and `after.png` (town layout, the Queen St / Kent St roundabout, southbound, about 15 m before the ring: the course goes straight through and both Kent St exits are closed). It's a Blender mock-up over the accepted build exported with `export_base.ts`, not a game build.

## What real events do

**Street circuits close the side streets with walls, but that's for spectator safety at racing speed.** Townsville's 2.86 km street circuit takes 1,295 concrete blocks and 1,545 debris-fence panels, and about 3.5 weeks to build ([Supercars](https://www.supercars.com/news/inside-the-unique-townsville-circuit-build-supercars), [Supercars 2013](https://www.supercars.com/news/building-a-street-circuit)). Monaco puts up about 21 km of rail and 20,000 m² of fencing over six weeks ([Formula 1](https://www.formula1.com/en/latest/features/2014/5/Monte-Carlos-miracle---making-Monaco-race-ready.html)). Formula E builds its tracks in about two weeks to an FIA-approved plan ([Formula E](https://www.fiaformulae.com/en/news/483933)). Under the walls the course is a "normal" road: the side streets just end at a barrier. That reads clearly, but it's the opposite of unobtrusive, and in AC a wall at every side street would turn each wrong turn into a crash.

**Closed-road rallies and hillclimbs use far lighter gear.** Targa Tasmania and Tarmac West run on public roads closed for a few hours ([Tasmania Police](https://www.police.tas.gov.au/news-events/media-releases/temporary-road-closures-for-targa-tasmania-rally/), [City of Kalamunda](https://www.kalamunda.wa.gov.au/news-details/2025/09/02/notice-of-road-closures-tarmac-west-2025)). The FIA hillclimb guidelines want every access road marked with signs, including an "access road closure" sign, and chicanes marked on the road surface. Where protection is needed they list straw bales, tyre walls and "filled water tanks connected together" ([FIA hill climb guidelines](https://www.fia.com/sites/default/files/hill_climb_guidelines_2026_0.pdf)).

**Motorkhana, khanacross and autocross mark the way with markers and gates.** Markers at least 1.2 m high (at night), garages 4 m × 10 m with a marker at each corner, and a finish line running 4 m past each side of the finish garage ([Motorsport Australia Khanacross regulations](https://motorsport.org.au/wpblob0fe832abcb/wp-content/uploads/2023/12/5.02-2025-Khanacross-Standing-Regulations.pdf)). In autocross a gate is two cones a car's width apart, and an extra "pointer" cone on one side shows which way to go ([The Mustang Source](https://themustangsource.com/?p=8887)).

**Kerbs and ripple strips mark the edge, not the route.** On circuits kerbs sit mostly at corners: inside, to stop cars cutting the corner, and outside and at exits, to mark the limit while letting cars run a bit wide. They're nearly always red and white, and fast corners get lower, flatter profiles than slow ones ([Flow Racers](https://flowracers.com/blog/why-f1-tracks-have-kerbs/)). FIA Appendix O wants a white edge line at least 10 cm wide and verges flush with the track ([FIA Appendix O 2025](https://www.fia.com/sites/default/files/appendix_o_2025_published_15.01.2025.pdf)). I found no public standard for kerb dimensions. Bands about 1 m long and 0.3 to 1.5 m wide are what you see at most tracks, not a rule.

**Australian event traffic management uses devices that guide without blocking.** WA events follow Main Roads WA's code of practice, which defers to AS 1742.3. Closures are "ROAD CLOSED" signs with barricades. Lightweight interlocking water-ballasted modules are allowed for delineation where no safety barrier is needed, but they must then be marked "NOT A SAFETY BARRIER" ([MRWA Traffic Management for Events CoP](https://www.mainroads.wa.gov.au/globalassets/technical-commercial/working-on-roads/traffic-management/traffic-management-for-events-code-of-practice.pdf)). Cones at closures are at least 450 mm, fluoro red with Class 1 reflective tape, at most 4 m apart; fluoro red bollards can stand in for them ([MRWA example event TMP](https://www.mainroads.wa.gov.au/globalassets/technical-commercial/working-on-roads/traffic-management/example-traffic-management-plan-tmp-for-events-category-4-event.pdf)). A typical AU temporary bollard is 1,150 mm, fluoro red with reflective bands, on a 6 kg base ([Verdex](https://www.verdex.com.au/t-top-plastic-bollards)). Common water-filled modules are 1,410 × 360 × 800 mm and 2,000 × 450 × 1,000 mm, in red or yellow ([Trade-Line GuardX 800](https://www.trade-line.com.au/shop/waterbarr-r-guardx-800tm-water-barrier-red-1410-l-x-360-w-x-800-h-mm-34894), [GuardX 1000](https://trade-line.com.au/shop/waterbarr1000-r-guardx-1000tm-hd-water-barrier-red-2000-l-x-450-w-x-1000-h-mm-38917)). Australian barrier boards are 2.5 m long and yellow and black; red and white is the European colour ([Wikipedia](https://en.wikipedia.org/wiki/Barrier_board)). The NSW temporary collapsible chevron delineator (T5-7) is an AS 1742.3 device ([Transport for NSW](https://www.transport.nsw.gov.au/operations/roads-and-waterways/traffic-signs/t5-7-temporary-collapsible-chevron-delineator)). Curve chevrons go on the outside of the curve, at least three per direction, with at least two always in view, at least 1 m off the road and turned 5 to 10° away from the driver's line of sight ([NZTA TCD manual](https://nzta2.cwp.govt.nz/roads-and-rail/traffic-control-devices-manual/part-5-traffic-control-devices-for-general-use-between-intersections/treatment-of-curves/installation/curve-chevrons)).

**What reads at town speed and stays out of the way:**
- **A line across the closed mouth, on the road.** A low red-white strip flush with the course's own edge says "the road ends here" without hiding the street. It's the kerb Mac suggested, used where real events would put a barrier line.
- **A short, low barrier line a few metres back.** Water-filled modules, red and white, about knee height. They're big enough to see from 50 m, too low to block the view of the town, and they're what WA events actually use.
- **Chevron boards only on the outside of a turn.** That's where they mean "turn here" in every road manual. Used everywhere else they turn into noise.
- **A start that looks like a start:** painted grid boxes, a line, and something upright at the line.
- **Upstream already has heavy race-day dressing** (concrete walls, debris fence, banners, crowds and gantries on the start straight and tight corners; upstream commit `bd0c844`, not in the fork). Its roadmap's next step is "a full-circuit option that closes the side streets", which is this plan. We take the idea and write our own, lighter version (CLAUDE.md "Upstream").

## The design (default)

| Where | What | Size | Physics |
| --- | --- | --- | --- |
| **Side-street mouth the course passes** (street junctions, also car park entries) | Red-white ripple strip across the mouth, in line with the course's kerb or edge line; low red-white water-filled barriers about 3.5 m back, kerb to kerb | Strip 0.6 m wide, 4 cm high, 1 m bands. Barriers 1.6 m × 0.4 m × 0.55 m with an 8 cm gap | Strip: `1KERB`-like (a new `RIPPLE` key with rumble). Barriers: visual only. Behind the strip: a `CLOSED` patch, invalid track |
| **Roundabout exits the course doesn't take** | The same strip and barriers in each exit, at the ring's edge | as above | as above |
| **Roundabouts the course uses** | Island kerb painted red and white all round; one chevron board on the island facing each course entry, pointing left (the way in; AU rings run clockwise) | Board 1.8 m × 0.6 m, bottom edge 0.5 m up, white chevrons on red | Visual |
| **The course's own turns at junctions** (e.g. Queen St left into Albert St) | The straight-on branch gets the closed-mouth treatment, plus 2 or 3 chevron boards on top of its barrier line, pointing the way of the turn. Red-white strip on the inside of the turn, at the apex | Boards 1.0 m × 0.5 m, bottom 0.35 m | Boards visual |
| **Closed mouth on a curve's outside** | Chevrons as above, spaced so two are always in view | | |
| **Start/finish and grid** | Painted grid boxes with numbers, a white start line with a chequered band, a light start arch over the line (two red-white posts and a beam with plain lettering, "START FINISH"); a single "STARTING GRID" board at the first box | Arch 2 posts 0.3 m, beam 1 m deep at 5 m clear | Posts physical (`1WALL`, on the footpath, never on the road); the rest visual |
| **Next turn** | An arrow board 60 to 80 m before each course turn, on the left verge: white arrow on red, same style as the chevrons. Optional: the Busselton Map app shows the next turn as an arrow at the top of the screen (no geometry) | 0.9 m × 0.6 m | Visual |

Colours: one red (sRGB about 200, 20, 20) and one off-white for everything, so it reads as one system. No logos or sponsor text. Car park entries and private driveways: strip only, no barriers (they're too many and too small; the strip reads well enough).

Physics, in short: nothing a car can hit at speed except the arch posts, which stand on the footpath. A wrong turn crosses a 4 cm strip (a rumble you can feel) into a `CLOSED` surface patch (`IS_VALID_TRACK=0`): AC flags a cut and the lap is invalid, but the car isn't wrecked, and in practice the strip and barriers are enough to stop you before you get there. The barriers have no collision, so a car that goes past them drives through. That's the price of never wrecking anyone; if it feels too cheap in game, phase 3 has a solid option.

## How it'd be generated

**The data we already have** (in `layoutFiles`, `src/core/layouts.ts`):
- the layout's own AI line and road plan (`routeAi`: plan samples, distance, left and right widths), so we know which streets the course is on and which way it turns;
- `world.lines`: every street centreline in the area (from OSM, `area.ts`);
- `world.rings`: every roundabout's centre, outer edge and island edge;
- `surfaceHeight(world.model)`: road height and edges anywhere, to sit things on the road and find each mouth's kerb-to-kerb width (as the mock-up does by ray casting);
- `world.bays` (kerbside bays), so barriers don't sit on parked cars.

**Finding the mouths** (a new pure module, `src/core/courseMarks.ts`, unit-tested in `test/courseMarks.test.ts`):
1. Walk the course's centreline. At each world line that meets or crosses it (end point or crossing within the road's half-width plus 2 m), each branch that leaves the course for more than 15 m is a closed mouth. On a ring, each branch that meets the ring's outer edge and isn't the layout's entry or exit is a closed exit. My quick check on the town layout found 8 rings, about 10 street junctions with closed branches, and about 7 car park or driveway entries.
2. Classify each mouth: **side** (the course goes straight past it), **outside of a turn** (the course turns more than 45° within the junction and this branch is the straight-on one), or **ring exit**. Note the turn direction for the chevrons.
3. Put the strip on the course's edge line across the mouth's width (from the surface), the barrier line 3.5 m back, chevrons on outside-of-turn mouths, and the arrow board 70 m back up the course before each turn (on the left verge, clear of driveways and poles).
4. Grid and arch from the layout's own dummies (`AC_START_*`, `AC_TIME_0_L/R`), so they always match.

**Per-layout files, so free roam stays open:** the markings go into each race layout's own kn5 alongside its dummies (`layout_<id>.kn5`, already listed in `models_<id>.ini`), or into a separate `marks_<id>.kn5` added to that layout's models ini. Free roam's layout never gets them. The world kn5 doesn't change, so the world rebuilds the same with or without the option. The `CLOSED` and `RIPPLE` surface keys go only into the race layouts' own `data/surfaces.ini` (each layout already has its own).

**The option:** `courseMarks` in `src/core/options.ts`: `false | true | { barriers?: boolean, chevrons?: boolean, arch?: boolean, arrows?: boolean, solid?: boolean }`, off by default. On, it applies to every layout with pins (race and sights) and never to a `spawns` layout. Routes switch it on in their `options`; the main layout (the route's own drive) gets it through the same code.

**Traffic:** each layout has its own `data/traffic.json`. With course marks on, a race layout's traffic must drop the lanes into closed mouths (or the layout runs without traffic), or traffic cars drive through the barriers. Simplest first step: race layouts with marks ship no traffic; free roam keeps it.

**AI line:** no change. The markings sit outside the course, the AI follows `fast_lane.ai`, and the barriers have no collision, so the AI can't snag on them. The strip sits on the course's edge line, so the AI line (0.5 m in from the edge at worst, `keepOnSurface`) stays off it. Check with `layout_check.ts` that no strip lies under the AI line.

**Budget** (RTX 4060 limits from `scripts/check/budget.ts`: 1.5M triangles, 4,000 draw calls):
- Strip: 20 triangles a metre. Barrier module: 20. Chevron board: about 40. A closed mouth (8 m of strip, 5 barriers, sometimes a board) is about 300 triangles.
- Town layout, about 30 mouths, 8 island rings (about 40 m of strip each) and 15 boards and arrows: about 17k triangles. The whole set for the three race layouts stays under 50k, about 3% of the limit, and only one layout loads at a time.
- Draw calls: merge by material (red, white, board texture, grey posts) in 200 m tiles so AC can still cull them: about 30 to 40 a layout. Textures: one 512 × 256 atlas (chevron, arrow, "START FINISH", grid numbers), well under 1 MB.

**Checks to add:** `scripts/check/course_marks_check.ts`: every closed mouth has a strip and barriers, nothing on the AI line, nothing on a parked car or a traffic lane the layout keeps, the arch posts off the road, and free roam's kn5 has no marks. Add it to `scripts/check/all.mjs`.

## Phases

1. **Mouths and strips (half a day).** `courseMarks.ts` finds the mouths and lays the strips and island rings into `layout_<id>.kn5`; `CLOSED` patches and surface keys; unit tests; the check. Build the town layout, look at the overlay and renders (SHOTS at three rings and two turns).
2. **Barriers and chevrons (half a day).** Barrier lines, chevron boards on outside-of-turn mouths and ring islands. Race layouts drop traffic.
3. **Start and next turn (half a day).** Grid boxes, start arch, arrow boards; the Busselton Map app's next-turn arrow. Option `solid`: barriers as low `1WALL` for anyone who wants hard closures (off by default).
4. **Tune by driving.** Mac drives each layout on the rig and reports what's still unclear or too much; adjust spacing and sizes, maybe drop the barriers at minor mouths if the strip is enough.

## What to test in game

- **Workstation, automatic run** (`run-test.ps1 busselton -Layout town`, then the sights): the AI completes a lap with no new off-tracks or stops; `autotest_report.py` shows the same lap time (±2%) as before; screenshots at the rings show the markings.
- **Rig, Mac driving:**
  - Can you follow the town layout first time, with no wrong turns, without the map app?
  - At 50 to 60 km/h, can you see each closed mouth from about 50 m, and each chevron before you need to turn?
  - Does it look like Busselton with an event on, not a walled circuit? Do the barriers hide shopfronts or landmarks?
  - Does a wrong turn give a cut warning and invalidate the lap, without wrecking the car?
  - Is the start obvious from the pits or the grid?
  - Free roam: are the markings gone and every street open?
- **Performance:** frame rate at the busiest ring against the build without marks (CSP FPS counter, same camera); `budget.ts` passes.
