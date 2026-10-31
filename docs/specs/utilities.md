# Spec: power poles, overhead wires, street lights and car park lights

Replaces `src/core/utilities.ts`. Heights follow the height contract in [scenery.md](scenery.md#the-height-contract-applies-to-every-placement-spec-in-this-group): one `ground(x, y)` passed in, SINK at every foot.

## What it does

Lines an Australian street above head height:

- **Power poles** where they're known (Mapillary sightings, OSM poles, and vertices of OSM power lines). Never invented: newer estates have power underground.
- **Overhead wires** between poles: along each mapped power line, and between neighbouring poles on the same side of the street.
- **Street lights** where known (Mapillary, OSM lamps), and in town at a typical spacing where none are known. A light near a pole is mounted on it.
- **Car park lights** along OSM parking aisles.
- Light positions for night lighting (the CSP config).

## Inputs (`placeUtilities`)

- Known positions, local metres: poles, lamps, power lines (each a list of vertices; the vertices are poles).
- Road plan (samples, total length), segment index, options (corridor).
- `town(i)`: how built-up sample i is (0 country, 1 edge of town, 2 town).
- `blocked(x, y)`: no pole here (a side street, a driveway, a building). The pipeline passes "within 1 m of a side street, or inside a building".
- `ground(x, y)` (new; replaces the module's own verge-and-kerb height rule).
- `onRoad(x, y)` (optional): true on a built drivable mesh (poleSpot.ts `OnRoad`; the pipeline passes the route, side streets, kerbs and rings over `ROAD_SURFACE`, or nothing when `poleClear` is false). Without it nothing is moved off the road and no lamp gets a second arm.

## Output

- Pieces (see furniture spec) for poles, crossarms, lamp posts, outreach arms and lanterns.
- Wire meshes.
- Light positions (x, y, height) at each lantern.
- The number of poles (for the build stats).

## Rules

### Snapping a known position

- Match to the nearest route segment within the corridor minus 2 m; drop if none, or within 2 m of a roundabout.
- A position on the road or close to it (closer than half road + 1 m set-back + 1.5 m) moves straight across onto the verge, 1.0 m behind the road edge on its side, keeping its place along the street. Further out it stays.
- Drop anything more than 25 m beyond the road edge.
- Record: position, nearest sample, distance along the route, side, the unit vector across the road away from it (`out`), and the ground height at the position.
- **Off the road (poleSpot.ts).** With `onRoad`, every pole and lamp post foot then goes through `clearSpot(at, onRoad, { away: out })` (default 0.4 m radius, 6 m reach): left alone when clear, else moved to the nearest clear spot (straight out first), else dropped. This catches poles on side streets, roundabout aprons and the far side of a junction, which the route-only snap can't see. The ground height is taken at the final spot.

### Poles and lamps

- Poles: all known poles plus every power-line vertex, snapped, then de-duplicated within 4 m (first kept). Lamps: known lamps snapped, de-duplicated within 4 m.
- **Default lights:** walk the route every 50 m starting at 25 m. Skip samples where `town` is below 1. One side on a narrow street (under 10 m wide): the left. On a wide street, alternate sides each step. Position 1.0 m behind the road edge. Skip if a known or already-placed light is within 30 m, if blocked, or within 3 m of a ring. If a pole is within 18 m, the light goes on that pole instead.
- Sort known inputs by position before de-duplicating so the same ones survive every build.
- A pole carries at most one light: a default light doesn't go on a pole that already has one (it gets its own post instead, if it passes the other rules).
- **A seen lantern keeps its place.** A lamp is seen where its lantern is, usually over the road. When a known lamp was over the asphalt (inside the route's half width, or `onRoad` there) and its post ended up 0.5 to 6 m away (moved to the verge or off a side street, or the pole it's mounted on), the arm reaches from the post to the seen spot and the lantern hangs centred there. Otherwise the arm takes the normal length.

### Geometry

All heights from `ground` at the pole's or lamp post's own foot.

- **Power pole:** a 0.28 m square timber post from SINK below ground to 11 m above (the old module buried it 1 m; with the one surface, SINK is enough and the ground check measures it). A 2.2 m timber crossarm across the road at 10.3 to 10.42 m.
- **Street light:** if a pole is within 3 m, mounted on the pole; otherwise its own 0.16 m steel post from SINK below ground to 8.5 m.
- **Arms (`lampArms`).** One arm toward the road (opposite `out`), or toward the seen lantern (above). Its length reaches past the route's road edge: the distance from the post to the edge plus 0.8 m plus half a lantern, at least 2.2 m and at most 6 m; a post more than 3 m from the route's edge (on a side street) takes 2.2 m. **Double outreach at a median:** with `onRoad`, if a drivable surface starts within 4 m straight behind the post (along `out`) and also runs along the street there (on road 0.5 m further in, 8 m either way along the street), a second arm reaches over it, its length worked out the same way from that surface's edge. A street that only ends behind the post (a T) doesn't count.
- **Arm and lantern (`outreach(at, ground, dir, length)`).** The arm starts at the post's centre (inside it, so they join) and runs `length` along `dir`, 8.35 to 8.44 m up, 0.08 m thick, `steel`. The 0.7 x 0.32 m `lamp` lantern, its long side along the arm, hangs under the arm's end: its outer end flush with the arm's end, 8.23 to 8.39 m (4 cm up into the arm). One light position per lantern, at the lantern's centre, 5 cm under it. A lamp with two arms has two lights.
- Materials: `timber`, `steel`, `lamp`.

### Wire spans

- Along each mapped line: consecutive vertices whose poles (the pole each vertex became, after merging) are two different poles. A vertex that was dropped breaks the line there.
- Along each side of the street: poles on that side in order of distance along the route; consecutive ones form a span if they're 15 to 75 m apart along the route and the straight distance is at least 85% of that (not a chord across a bend).
- No pair twice. Keep spans 8 to 90 m long.

### Wires

- Four conductors per span: three high-voltage on the crossarm (0.9 m either side of the pole and the middle, 18 cm above the arm, 2.5 cm wide) and a low-voltage bundle at 8.4 m, 0.25 m out, 5 cm wide.
- If the far pole's arm faces the other way (opposite side of the street), mirror its offsets so conductors don't cross.
- Sag: a parabola, depth = 0.0005 times span length squared, at most 1.2 m; 10 segments per conductor.
- Each segment is two crossed thin ribbons (one flat, one upright), both two-sided, so a wire reads from any angle.
- Mesh `WIRES_NNN`, material `wire`, no shadows. `cull.ts` gives `WIRES` a 350 m draw distance by name.

## Car park lights (`carParkLights`)

**Inputs:** aisle lines (local), `ground`, `blocked(x, y)` (road, aisle, street, parked car, building, outside the built area), and the lights already placed (so they keep their distance).

- Along each aisle, a pole every 35 m, the first 17 m in; the distance to the next pole carries across the aisle's segments.
- Each pole 9 m off the aisle's centre, alternating left and right (the alternation runs across all aisles in order).
- Skip if blocked, or within 20 m of any light already placed (including the street lights passed in).
- An 0.18 m steel pole from SINK below ground to 8.2 m. Two arms, each way across the aisle, from the pole's centre 1.5 m out, 8.02 to 8.11 m, `steel`. Under each arm's end a lantern, 0.8 m along the arm by 0.35 m, centred 1.1 m out (its outer end flush with the arm's end), 7.9 to 8.06 m; a light position 5 cm under each. Lanterns must sit wholly under an arm: the ground check fails any lamp head not joined to a pole standing on the ground (poleCheck.ts).
- Returns pieces and light positions.
- The alternation and the 20 m rule depend on input order: sort aisles by position (for example by their first vertex) first.

## Call sites

- `src/core/track.ts`: `placeUtilities` with Mapillary poles and lights (after `mergeSightings`) plus OSM poles, lamps and power lines; `carParkLights` with OSM `service=parking_aisle` lines and `utilities.lights`. Both feed the pieces list; lights feed the CSP lighting config; `poles` and light counts feed the stats.
- `test/poleSpot.test.ts` also uses `placeUtilities` (with `onRoad`), `lampArms`, `outreach` and `carParkLights`, and runs `checkPoles` on the pieces: no loose lamp heads, no poles on the road.
- Tests: `test/utilities.test.ts`.

## Public API

- `placeUtilities(known, plan, index, opts, ground, town, blocked?, onRoad?) -> { pieces, wires, lights, poles }`; `known` is `{ poles, lamps, lines }`, lights are `[x, y, z]`.
- `carParkLights(aisles, ground, blocked, existing?) -> { pieces, lights }`.
- `lampArms({ at, out }, seen | undefined, plan, index, onRoad?) -> { dir, length }[]` (the first arm is the main one).
- `outreach(at, ground, dir, length) -> { pieces: [arm, lantern], light }`.

## Edge cases

- A power line whose vertices are all off the route (beyond the corridor): no poles, no spans.
- Two lines sharing a vertex: one pole, spans to both.
- A pole on a roundabout: dropped.
- Closed loop: the 50 m walk doesn't wrap (acceptable).
- Very short aisles (under 17 m): no lights.
- Zero-length aisle segments: skipped.

## Test list (write fresh)

1. A pole seen on the asphalt moves to 1 m behind the road edge on its side, same distance along.
2. Two sightings 3 m apart become one pole.
3. Power-line vertices become poles and consecutive ones get wires; poles on the same side 40 m apart get a span; 100 m apart don't; across a bend whose chord is short don't.
4. No poles are invented on a town street with no data; lights are: one about every 50 m, on the left on a narrow street and staggered on a wide one; none in the country.
5. A default light within 18 m of a pole is mounted on it (no separate steel post).
6. Light positions: one per lamp, at the lantern.
7. Every pole and lamp post base is at `ground` at its foot minus SINK for a tilted ground; crossarm and lantern heights measured from that.
8. Wire sag: midpoint 0.0005 L squared below the chord, capped at 1.2 m.
9. Car park lights: every 35 m alternating sides, none blocked, none within 20 m of an existing light; identical output with the aisle list shuffled.
10. With `onRoad`: a pole seen on a side street is moved off it; one with nowhere clear is dropped; a seen lantern over the road keeps its place with its post on the verge.
11. A post in a median gets two arms; one with a street ending behind it gets one.
12. `outreach`: the arm starts at the post's centre and the lantern's outer end is flush with the arm's end, overlapping it in height.

## Could be deleted instead of rewritten (for Mac)

Nothing obvious. The Busselton build has 65 poles, 96 street lights and 111 car park lights, and they light the town at night.
