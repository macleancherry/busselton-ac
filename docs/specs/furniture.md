# Spec: street furniture (signs, bus stops, servo canopies, Mapillary objects, gate and kangaroo signs)

Replaces `src/core/furniture.ts` (upstream-derived). Heights follow the height contract in [scenery.md](scenery.md#the-height-contract-applies-to-every-placement-spec-in-this-group): one `ground(x, y)` passed in, `SINK` at every foot, no road-formula heights.

## Shape of the module

Placement and geometry are separate steps:

1. **Placers** return a flat list of *pieces*. Sign artwork is requested from an art list (`src/core/art.ts`, `ArtList.add({ key, kind, text?, colour? })` returns the key) while placing, so the pipeline can draw every sign into one atlas before any mesh is built.
2. **`buildPieces(pieces, atlas)`** turns pieces into meshes.

Other modules also produce pieces (utilities, footpaths' letterboxes, flags, raceDress, farmRoadsides), so the piece type is a shared contract. Keep it in a small types module so those modules don't import the furniture code.

### Pieces

- **box:** centre, unit length direction, length, depth, bottom and top heights, material name. A post, beam, slab or canopy.
- **blade:** centre, unit direction of the blade's long axis, centre height, height, art key. A street-name blade printed on both faces.
- **face:** centre, unit normal (the way it faces), bottom height, height, art key, optionally two-sided. A sign face; width comes from the art cell's aspect ratio.

### Common geometry

- *Facing traffic:* traffic keeps left. A sign on the left of the route (positive lateral offset) faces traffic coming forward, so its normal points back along the route; on the right, forward.
- *Offset:* a point at lateral offset t from a sample is the sample position plus t along the sample's left vector.
- *Heights:* every piece's base is `ground` at that piece's own (x, y) minus SINK; tops and sign heights are measured up from the same ground value. A sign face uses the ground at its post. (The old module had its own verge-slope height model, `vergeZ`, and exported it to utilities; that goes.)
- *Clear of rings:* each placer skips spots inside or near a roundabout (radius given per placer).

### Ground and poles off the road (main, 31 Oct 2026)

- *The ground* is the one-surface sampler (`src/core/sceneGround.ts`): the caller passes its `SceneGround` as a plain `ground(x, y)`; tests pass any height function. `SINK` comes from that module.
- *Poles off the road:* `streetSigns` and `seenFeatures` take an optional last argument `onRoad(x, y)` (`src/core/poleSpot.ts` `OnRoad`, true on a built drivable mesh: route, gutters, rings, side streets, gravel). Each post's foot goes through `clearSpot(at, onRoad, { radius, away })`: kept if clear, else moved to the nearest clear spot (straight out from the route on its side first), or the whole sign or signal dropped if nothing is clear within reach. Radius: the post's half width plus a 15 cm gap; `away`: the route's left vector times the side. Everything hung on the post (blades, faces, signal head) moves with it. No `onRoad` (option `poleClear: false`): spots as placed. Islands and medians aren't road meshes, so a post on one stays. `scripts/check/ground_check.ts` (`poleCheck.ts`) fails a build with a post on a drivable mesh.
- *Mapillary signals at OSM junctions:* the caller (`track.ts`) drops Mapillary traffic lights within 35 m of a junction `trafficLights.ts` already signals, before calling `seenFeatures`. Nothing in this module.
- *Held up:* the ground check passes a piece over the ground only if something standing touches it, so every raised piece must touch its post or legs (a bench gets two small legs; a sign face sits close enough to its post).

## Small exports used elsewhere

- `off(sample, t)`: the point at lateral offset t (utilities.ts).
- `signArt(value, art)`: the art key for a Mapillary sign value (rules under Mapillary objects), registering it with the art list, or null. Keys: `speed:NN`, `stop`, `giveway`, `noentry`, `keepleft`, `chevron:left|right`, `warning:<name>`.
- `Piece`, re-exported from the shared types module (`src/core/pieces.ts`).

## Placers

### Street name signs (`streetSigns`)

**Inputs:** side-street plan (junctions: distance along the route `s`, side, mouth width, unit direction of the side street, name, route segment), the road plan, options, art list. Route names per segment come from the street plan.

- One corner sign per named junction: on the junction's side, at the sample just before the mouth (mouth half-width plus 2.5 m back along the route, in the direction of travel for that side), 60% of the verge width out from the asphalt edge.
- Skip if that spot is within 6 m of a roundabout.
- A 65 mm square steel post, SINK into the ground, 3.0 m tall.
- A blade naming the side street, parallel to the side street, centred 2.62 m up, 0.2 m high.
- Above it, centred 2.86 m up, a blade naming the route (parallel to the route), if the route has a name there and it differs.
- Art: kind `street`, key from `streetKey(name)`.

### Landmarks, bus stops and servo canopies (`landmarks`)

**Inputs:** points of interest (position, class, subclass, optional name), the road plan, segment index, options, art list, and a clearance function (distance to the nearest street or building edge; negative inside a building).

Each POI is matched to the nearest route segment within 60 m; skip if the matched sample is within 10 m of a roundabout. Signs on one side keep at least 12 m apart along the route (first come, first served; sort the POIs by position first so it's the same every build). At most 80 named signs per build.

- **Bus stop** (class `bus`, within 25 m, spot free): a post at 70% of the verge width out, 2.7 m tall, with a 0.6 m `bus` sign facing traffic at 2.0 m. A shelter 2.3 m beyond the verge edge if the clearance there is over 2.5 m: a 3.6 x 1.7 m steel roof slab at 2.35 to 2.45 m, a glass back wall (3.6 m long, 6 cm thick, set 0.75 m further back, up to 2.35 m), a steel post at each end of the back wall, and a 2.2 x 0.4 m bench at 0.4 to 0.48 m set 0.4 m toward the back, on two 6 cm steel legs 0.9 m either side of its middle (without them the ground check calls it floating). The shelter stands on the ground at the shelter (the old code used the verge edge height for all of it).
- **Service station** (class and subclass `fuel`), if it's more than verge + 6 m from the route: a 13 x 8 m canopy, square to the road, 5.0 to 5.8 m up, on four 0.35 m steel columns at (plus or minus 4 m along, plus or minus 2.5 m across). Each column stands on the ground at its own foot; the canopy height is from the lowest column foot. Material `canopy` for the slab, `steel` for the columns. A fuel POI then also gets a sign (below).
- **Named sign** for attractions and these classes: fast_food, restaurant, cafe, ice_cream, bakery, grocery, shop, clothing_store, pharmacy, bank, beer, alcohol_shop, lodging, car, hospital, school, college, place_of_worship, library, police, post, fire_station, cinema, hairdresser, doctors, dentist, veterinary, sports_centre, fuel. Name from the POI; unnamed fuel says FUEL; an unnamed viewpoint says Lookout; otherwise unnamed POIs get none.
  - A pylon at the property line: lateral offset = the smaller of the POI's distance and (half road + verge + 2.5 m); if that would put it on the road or verge (under half road + verge), it goes at the property line (so a POI on the road still gets its pylon at the property line, per the edge cases).
  - The whole panel (points 1.3 m either side, across the road) must have clearance of at least 1 m, or no sign.
  - Two 0.12 m steel legs 0.75 m either side, set 0.1 m behind the panel; panel faces traffic, printed both sides. Fuel: 5.2 m tall legs, 1.6 m panel at the top. Others: 3.2 m, 0.9 m panel.
  - Art: attractions kind `tourist`, key `tourist:<name>`; others kind `poi`, key `poi:<class>:<name>`, with a colour per class (a table of brand-neutral colours, one per class above; default a dark slate). Pick your own palette; the old one is plain reds, greens, blues and browns by trade.
- The art list always gets the plain grey sign back (`back`).

### Mapillary objects (`seenFeatures`, `mergeSightings`)

**Merging:** Mapillary reports one detection per side an object was seen from. Group detections of the same category within a radius and replace each group with one at the average position, keeping the first value. Categories: utility poles (5 m), street lights (5 m), traffic lights (4 m), each road marking value on its own (6 m), and anything else by its value with any trailing `--gN` version removed (6 m). Grouping is greedy: a detection joins the first group of its category with any member within the radius.

**Placing** (after merging):
- Skip markings (painted on the road, handled elsewhere) and utility poles and street lights (utilities module).
- Match to the nearest route segment within the corridor minus 2 m; skip within 2 m of a roundabout.
- A detection on the road or its edge (closer than half road + 60% of the verge) is moved straight across to 70% of the verge on its side; otherwise it stays where it was seen.
- **Traffic light:** a 0.14 m steel pole 3.5 m tall; a 0.36 x 0.3 m `signal` head box from 2.4 to 3.4 m, 0.2 m toward the traffic. (The fork's `trafficLights.ts` builds proper signals from OSM; see deletions.)
- **Signs** (only within 40 m of the route): art from the value:
  - `maximum-speed-limit-NN` anywhere in the value: kind `speed`, text NN.
  - starts `regulatory--stop`: `stop`; `regulatory--yield`: `giveway`; `regulatory--no-entry`: `noentry`; `regulatory--keep-left`: `keepleft`.
  - starts `complementary--chevron-left` / `-right`: kind `chevron`, text left / right.
  - starts `warning--<name>`: kind `warning`, text the name (up to the next `--`).
  - anything else: no sign.
  - Sign size 0.6 m for speed and chevron, 0.75 m otherwise. A 65 mm post to 2.2 m + size; the face 5 cm in front of the post toward traffic, bottom at 2.1 m.

### START and FINISH (`gateSigns`)

Only for a plan with timing gates (`plan.timed`, a point-to-point route). At each gate sample (skip within 8 m of a ring): on both sides, beyond the verge plus 1.8 m, a two-sided sign 0.62 m high at 2.2 m, facing back along the route, on two 8 cm posts 0.75 m either side, 2.9 m tall. Art kind `gate`, key `gate-START` / `gate-FINISH`.

### Kangaroo signs (`kangarooSigns`)

**Inputs:** plan, options, art list, `rural(i)` (sample i is out of town), `blocked(i, side)` (junction mouth).

- Find runs of rural samples. Runs shorter than 1 km get nothing.
- In each run: traffic going forward gets a sign on the left about 300 m in, then every 4 km, stopping 150 m short of the run's end. Traffic coming back gets the same on the right, counted from the far end.
- If the spot is blocked or within 15 m of a ring, try nudging 5, -5, 10, -10, 20, -20 m along; give up if none works.
- A 65 mm post 2.9 m tall at 70% of the verge; a 0.9 m warning face (kind `warning`, key `warning:kangaroo`, text kangaroo) 5 cm toward traffic at 2.0 m.

## Building pieces (`buildPieces`)

- Boxes: by material, using the shared box builder.
- Pieces whose art key has no cell in the atlas (or no atlas at all: art not rendered) are skipped; their posts still build.
- Blade: width = height times the cell's aspect. Two faces 1 cm either side of the centre, each facing out and each reading left to right from its own side.
- Face: width from the aspect. Front face toward the normal. Behind it, 1 cm back, either the same art again (two-sided) or the atlas's `back` cell mirrored, so the back reads as plain grey.
- UVs: the art cell's u0..u1, v0 at the top, v1 at the bottom; normals horizontal.
- Meshes grouped by material, chunked: `FURNITURE_<MATERIAL>_NNN`, material as given (sign faces `signart`). `cull.ts` gives `FURNITURE` a 600 m draw distance by name, so keep the prefix.

## Call sites

Signatures (argument order as `track.ts` calls them):
- `streetSigns(streetPlan, plan, opts, art, ground, onRoad?)`
- `landmarks(pois, plan, index, opts, art, clearance, ground)` (POIs in local metres: `{ at, cls, subclass, name? }`)
- `seenFeatures(seen, plan, index, opts, art, ground, onRoad?)` and `mergeSightings(seen)` (`{ at, value }`, local metres)
- `gateSigns(plan, opts, art, ground)`
- `kangarooSigns(plan, opts, art, rural, blocked, ground)`
- `buildPieces(pieces, atlas | null)` returns kn5 mesh nodes

- `src/core/track.ts`: `streetSigns`, `landmarks`, `seenFeatures`, `mergeSightings` (also feeds utilities), `gateSigns` (when there's no race dressing), `kangarooSigns`, `buildPieces` for the whole pieces list.
- `src/core/utilities.ts`: `off`, `vergeZ`, `Piece`. With the height contract, utilities needs only `off` and `Piece`.
- Piece type: `raceDress.ts`, `flags.ts`, `footpaths.ts`, `farmRoadsides.ts`.
- Tests now: `test/streets.test.ts` (signArt, mergeSightings), `test/gates.test.ts`, `test/kangaroo.test.ts`, `test/flags.test.ts` and `test/utilities.test.ts` (Piece type).

## Edge cases

- Junction with no name; route name same as the side street's.
- Two POIs within 12 m on one side: only the first (in position order) gets a sign.
- POI right on the road (distance 0): the pylon offset caps at the property line on the side the POI rounds to; a POI exactly on the centreline goes on the left.
- No atlas: no faces or blades, posts only.
- Closed loop: kangaroo runs don't wrap across the start (acceptable; note it).
- Mapillary value with no version suffix; with extra parts after the warning name.

## Test list (write fresh)

1. Street sign: one post and one blade for a named junction, a second blade when the route has a different name, none when the junction has no name, none near a roundabout; blade directions follow the side street and the route.
2. Sign posts: base SINK under `ground` at the post for a tilted ground; blade heights measured from the same ground.
3. Landmarks: a cafe within 60 m gets a two-legged sign facing traffic on its side; a second cafe 8 m along the same side gets none; one on the other side does; the 80-sign cap; an unnamed fuel POI says FUEL; a panel crossing a building (clearance under 1 m) gets none; output identical when the POI list is shuffled.
4. Bus stop: post and sign; shelter only with room; shelter pieces stand on the ground at the shelter.
5. Servo canopy: four columns and a slab only when the POI is off the road.
6. Mapillary merge: three detections of one traffic light 2 m apart merge to one at their mean; a pole 10 m away stays separate; different sign versions (`--g1`, `--g2`) merge.
7. Mapillary placement: a stop sign seen on the asphalt is moved to the verge; signs beyond 40 m skipped; poles and lights skipped; art kinds from each value pattern, including unknown values giving none.
8. Gate signs: none without timing gates; two each side for START and FINISH when timed.
9. Kangaroo signs: a 3 km rural run gets one sign each way about 300 m from each end; a 900 m run none; a blocked spot is nudged; a spot with every nudge blocked gets none.
10. buildPieces: boxes grouped by material with `FURNITURE_` names; a face without an atlas cell is skipped; a one-sided face gets a mirrored back; blade faces both read correctly (u runs left to right seen from each side).

## Could be deleted instead of rewritten (for Mac)

- **`gateSigns`.** Only for timed point-to-point routes when race dressing is off. Worth keeping if point-to-point drives (Busselton to Dunsborough, Cape Leeuwin) should show START/FINISH; otherwise drop.
- **Traffic lights from Mapillary** in `seenFeatures`: the fork's `trafficLights.ts` builds signals from OSM with heads and stop lines. Two sources can double up at a junction. Suggest dropping the Mapillary pole-and-box version and keeping Mapillary only for signs.
- **Servo canopy.** Crude (a slab on four columns at the POI point, square to the route, not to the forecourt). Busselton's servos may be better as landmark layers. Keep only if Mac likes it in game.
- **Bus shelters** are fine for town; keep.
