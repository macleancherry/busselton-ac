# Spec: power poles, overhead wires, street lights and car park lights

Replaces `src/core/utilities.ts` (upstream-derived apart from the car park lights, which are the fork's). Heights follow the height contract in [scenery.md](scenery.md#the-height-contract-applies-to-every-placement-spec-in-this-group): one `ground(x, y)` passed in, SINK at every foot.

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
- Record: position, nearest sample, side, the unit vector across the road away from it, and the ground height at the position.

### Poles and lamps

- Poles: all known poles plus every power-line vertex, snapped, then de-duplicated within 4 m (first kept). Lamps: known lamps snapped, de-duplicated within 4 m.
- **Default lights:** walk the route every 50 m starting at 25 m. Skip samples where `town` is below 1. One side on a narrow street (under 10 m wide): the left. On a wide street, alternate sides each step. Position 1.0 m behind the road edge. Skip if a known or already-placed light is within 30 m, if blocked, or within 3 m of a ring. If a pole is within 18 m, the light goes on that pole instead.
- Sort known inputs by position before de-duplicating so the same ones survive every build.

### Geometry

All heights from `ground` at the pole's or lamp post's own foot.

- **Power pole:** a 0.28 m square timber post from SINK below ground to 11 m above (the old module buried it 1 m; with the one surface, SINK is enough and the ground check measures it). A 2.2 m timber crossarm across the road at 10.3 to 10.42 m.
- **Street light:** if a pole is within 3 m, mounted on the pole; otherwise its own 0.16 m steel post from SINK below ground to 8.5 m. An outreach arm 2.2 m long toward the road at 8.35 to 8.44 m, and a 0.7 x 0.32 m `lamp` lantern at the tip, 8.2 to 8.36 m. Light position just under the lantern.
- Materials: `timber`, `steel`, `lamp`.

### Wire spans

- Along each mapped line: consecutive vertices whose nearest poles (within 6 m) are two different poles.
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
- An 0.18 m steel pole from SINK below ground to 8.2 m; a lantern each way across the aisle, 1.1 m out, 0.8 x 0.35 m, 7.9 to 8.06 m; a light position under each.
- Returns pieces and light positions.
- The alternation and the 20 m rule depend on input order: sort aisles by position (for example by their first vertex) first.

## Call sites

- `src/core/track.ts`: `placeUtilities` with Mapillary poles and lights (after `mergeSightings`) plus OSM poles, lamps and power lines; `carParkLights` with OSM `service=parking_aisle` lines and `utilities.lights`. Both feed the pieces list; lights feed the CSP lighting config; `poles` and light counts feed the stats.
- Tests now: `test/utilities.test.ts`.

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

## Could be deleted instead of rewritten (for Mac)

Nothing obvious. The Busselton build has 65 poles, 96 street lights and 111 car park lights, and they light the town at night.
